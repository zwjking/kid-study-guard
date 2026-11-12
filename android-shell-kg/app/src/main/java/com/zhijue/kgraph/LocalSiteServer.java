package com.zhijue.kgraph;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 极简本地静态服务器，把 APK 里 assets/site 下的知识图谱站点通过
 * http://127.0.0.1:&lt;port&gt;/ 提供出来。
 *
 * 为什么要绕这一层：
 *   GeckoView（和浏览器一样）把 file:// 页面的 origin 视为 null，
 *   页面里 fetch('data/topics.json') 会被同源策略拦掉，站点直接不可用。
 *   起一个本地 http 服务后，页面与数据同源，fetch 正常，且完全离线。
 *
 * 只支持 GET / HEAD，不做 Range、不做 gzip（站点没有大媒体文件）。
 * 端口用 0 让系统分配，避免和别的应用撞车。
 */
final class LocalSiteServer implements Runnable {

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("htm", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("mjs", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("svg", "image/svg+xml");
        MIME.put("ico", "image/x-icon");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("md", "text/plain; charset=utf-8");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
    }

    private final AssetManager assets;
    private final String prefix;      // 例如 "site"
    private ServerSocket server;
    private Thread thread;
    private volatile boolean running;

    LocalSiteServer(AssetManager assets, String prefix) {
        this.assets = assets;
        this.prefix = prefix;
    }

    /** 启动并返回端口；失败返回 -1 */
    int start() {
        try {
            server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            running = true;
            thread = new Thread(this, "local-site-server");
            thread.setDaemon(true);
            thread.start();
            return server.getLocalPort();
        } catch (IOException e) {
            return -1;
        }
    }

    void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
        }
        server = null;
    }

    @Override
    public void run() {
        while (running) {
            Socket s = null;
            try {
                s = server.accept();
                handle(s);
            } catch (IOException e) {
                if (!running) break;
            } catch (Throwable ignored) {
            } finally {
                if (s != null) {
                    try {
                        s.close();
                    } catch (IOException ignored) {
                    }
                }
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(15000);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            // 读请求行与头部，直到空行
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            int contentLength = 0;
            String header;
            while ((header = readLine(in)) != null && !header.isEmpty()) {
                String lower = header.toLowerCase(Locale.US);
                if (lower.startsWith("content-length:")) {
                    try {
                        contentLength = Integer.parseInt(header.substring(15).trim());
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            if (contentLength > 0) {
                // 丢弃请求体（本服务只处理 GET/HEAD，正常不会有体）
                byte[] skip = new byte[Math.min(contentLength, 8192)];
                int left = contentLength;
                while (left > 0) {
                    int n = in.read(skip, 0, Math.min(left, skip.length));
                    if (n <= 0) break;
                    left -= n;
                }
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                writeText(out, 400, "Bad Request");
                return;
            }
            boolean headOnly = "HEAD".equalsIgnoreCase(parts[0]);

            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            int hash = path.indexOf('#');
            if (hash >= 0) path = path.substring(0, hash);
            if (!path.startsWith("/")) path = "/" + path;

            // 平台发布页会请求这个注入脚本，镜像里没有，给个空的 200 免得飘红
            if (path.startsWith("/page/page_comm/")) {
                writeBytes(out, 200, "application/javascript; charset=utf-8",
                        new byte[0], headOnly);
                return;
            }

            if (path.endsWith("/")) path = path + "index.html";

            String assetPath = prefix + path;
            byte[] body = readAsset(assetPath);
            if (body == null) {
                // 目录访问（不带斜杠）：补一次 index.html
                byte[] index = readAsset(assetPath + "/index.html");
                if (index != null) {
                    writeBytes(out, 200, MIME.get("html"), index, headOnly);
                    return;
                }
                writeText(out, 404, "Not Found: " + path);
                return;
            }
            writeBytes(out, 200, mimeOf(path), body, headOnly);
        } catch (Throwable ignored) {
        }
    }

    private byte[] readAsset(String path) {
        InputStream is = null;
        try {
            is = assets.open(path);
            ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.max(1024, is.available()));
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } catch (IOException e) {
            return null;
        } finally {
            if (is != null) {
                try {
                    is.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot >= 0) {
            String ext = path.substring(dot + 1).toLowerCase(Locale.US);
            String m = MIME.get(ext);
            if (m != null) return m;
        }
        return "application/octet-stream";
    }

    private static void writeBytes(OutputStream out, int code, String type,
                                   byte[] body, boolean headOnly) throws IOException {
        String status = code == 200 ? "200 OK"
                : code == 404 ? "404 Not Found"
                : code == 400 ? "400 Bad Request" : "500 Internal Server Error";
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(status).append("\r\n");
        sb.append("Content-Type: ").append(type).append("\r\n");
        sb.append("Content-Length: ").append(body.length).append("\r\n");
        sb.append("Cache-Control: no-cache\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes("UTF-8"));
        if (!headOnly) out.write(body);
        out.flush();
    }

    private static void writeText(OutputStream out, int code, String text)
            throws IOException {
        writeBytes(out, code, "text/plain; charset=utf-8",
                text.getBytes("UTF-8"), false);
    }

    /** 读一行（\r\n 或 \n 结尾），返回去掉行尾的内容 */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') bos.write(c);
            if (bos.size() > 8192) break;
        }
        if (c == -1 && bos.size() == 0) return null;
        return bos.toString("UTF-8");
    }
}
