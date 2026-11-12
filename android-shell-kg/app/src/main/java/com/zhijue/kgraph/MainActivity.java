package com.zhijue.kgraph;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;

/**
 * 中小学·高中知识图谱 · GeckoView 壳
 *
 * 为什么套壳：台电 X98 Air II 是 Android 5.0 + 原厂 WebView 内核 Chromium 37，
 * 跑不了现代前端，直接开网页必白屏。GeckoView 自带 Gecko 引擎（Firefox 100），
 * 与系统内核无关。引擎版本锁在 100：101 起不再提供 x86 32 位原生库。
 *
 * 加载地址（2026-11-08 实测）：
 *   直接加载 CDN 上的静态站点入口，绕过 WorkBuddy 的 SPA 发布外壳。
 *   外壳页 https://workbuddy.link/p/YOUR_PAGE_ID 内部再 iframe 一层，
 *   多一层就多一份卡顿，且带品牌栏；CDN 里就是站点本身。
 *   CDN 前缀带 hash（co75KPCjods-），换版本会变，所以要更新时重新取。
 *
 * 与「学习守护」壳的差别：这个是学习工具，不锁机——返回键正常后退/退出。
 */
public class MainActivity extends Activity {

    /** 兜底：本地服务起不来时才用线上地址（2026-11-08 实测平板访问该 CDN 打不开，仅应急） */
    private static final String ONLINE_URL =
            "https://workbuddy-space-static.codebuddy.work/page/YOUR_PAGE_ID/YOUR_BUILD_ID/index.html";

    /** 引擎进程内只初始化一次 */
    private static GeckoRuntime sRuntime;

    private GeckoView geckoView;
    private GeckoSession session;
    private TextView splash;
    private LocalSiteServer siteServer;
    private boolean canGoBack = false;
    private String startUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // 站点整包放在 APK 里（assets/site），用本地 http 服务提供，
        // 这样不依赖外网，孩子随时能查知识点。
        siteServer = new LocalSiteServer(getAssets(), "site");
        int port = siteServer.start();
        if (port > 0) {
            startUrl = "http://127.0.0.1:" + port + "/index.html";
        } else {
            siteServer = null;
            startUrl = ONLINE_URL;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F7F8FC"));

        if (sRuntime == null) {
            GeckoRuntimeSettings settings = new GeckoRuntimeSettings.Builder()
                    .aboutConfigEnabled(false)
                    .build();
            sRuntime = GeckoRuntime.create(getApplicationContext(), settings);
        }

        session = new GeckoSession();
        session.open(sRuntime);

        geckoView = new GeckoView(this);
        geckoView.setSession(session);
        geckoView.setBackgroundColor(Color.parseColor("#F7F8FC"));

        root.addView(geckoView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        // 引擎首次启动要解压 libxul，遮罩同时兼作「加载失败」提示
        splash = new TextView(this);
        splash.setText("正在加载知识图谱…");
        splash.setTextSize(18f);
        splash.setTextColor(Color.parseColor("#2A3566"));
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(Color.parseColor("#F7F8FC"));
        splash.setOnClickListener(v -> {
            splash.setText("正在重新加载…");
            session.reload();
        });
        root.addView(splash, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override
            public void onCrash(GeckoSession s) {
                if (s != null) s.loadUri(startUrl);
            }
        });

        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStop(GeckoSession s, boolean success) {
                if (success) {
                    splash.setVisibility(View.GONE);
                } else {
                    // 断网/超时：别让孩子对着白屏，给一句能看懂的话 + 点一下重试
                    splash.setText("网络没连上\n\n点这里重新加载");
                    splash.setVisibility(View.VISIBLE);
                }
            }
        });

        // GeckoView 100 没有 session.canGoBack()，自己跟历史索引
        session.setHistoryDelegate(new GeckoSession.HistoryDelegate() {
            @Override
            public void onHistoryStateChange(GeckoSession s,
                                             GeckoSession.HistoryDelegate.HistoryList list) {
                canGoBack = list != null && list.size() > 1 && list.getCurrentIndex() > 0;
            }
        });

        setContentView(root);
        session.loadUri(startUrl);
    }

    /* ---------- 状态栏与导航栏：显示，不隐藏 ----------
     *
     * 2026-11-08 君哥定：平板原厂自带应用都不隐藏系统栏，套壳保持一致的观感。
     * 正解就是**不碰 systemUiVisibility** —— 系统栏照常显示，Window 内容区
     * 本来就在状态栏下方、导航栏上方，不需要任何 padding，也不会遮挡。
     *
     * 不要加 SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN / HIDE_NAVIGATION：
     * 一加就得自己算 insets 补偿，会重新掉进「顶部标题被压、底部被盖」的坑。
     * 状态栏图标是白色的（Android 5.0 无 LIGHT_STATUS_BAR），
     * 所以 statusBarColor 用深色，见 res/values/styles.xml。
     */

    /* ---------- 返回键：网页有历史就后退，没有就退出 ---------- */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (session != null && canGoBack) {
                session.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (geckoView != null) {
            geckoView.releaseSession();
            geckoView = null;
        }
        if (session != null) {
            session.close();
            session = null;
        }
        if (siteServer != null) {
            siteServer.stop();
            siteServer = null;
        }
        splash = null;
        super.onDestroy();
    }
}
