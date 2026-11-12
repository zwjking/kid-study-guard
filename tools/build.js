/**
 * 把 index.html + assets 打成一个自包含的单文件 HTML
 * 用途：上传到资料库（只接受单文件 page）
 * 前置：先跑 tools/inline-sdk.js，SDK 已内联进 index.html；本脚本只负责把剩余 assets 也内联
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'web');
const outDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

// 内联 CSS（含登录页样式）。引用可能带 ?v=xxx 版本号
const css = [read('assets/style.css'), read('assets/auth.css')].join('\n\n');
html = html.replace(
  /<link[^>]*href="assets\/style\.css[^"]*"[^>]*>\s*<link[^>]*href="assets\/auth\.css[^"]*"[^>]*>/,
  '<style>\n' + css + '\n</style>'
);

// 内联 JS：data -> cloud -> authui -> practice -> app，顺序不能变（引用可能带 ?v=xxx）
// practice 必须在 app 之前：buildSchedule 启动时就要读「今天派哪一科」
const js = ['assets/data.js', 'assets/cloud.js', 'assets/authui.js', 'assets/practice.js', 'assets/weekend.js', 'assets/app.js']
  .map(f => '<script>\n' + read(f) + '\n</script>')
  .join('\n');

html = html.replace(
  /<script[^>]*src="assets\/data\.js[^"]*"[^>]*><\/script>[\s\S]*?<script[^>]*src="assets\/app\.js[^"]*"[^>]*><\/script>/,
  js
);

// 单文件版没有同域 assets 目录：第二级"加载同域 SDK"的 document.write 必须去掉
// （第一级已内联同一份 es15 SDK，若它执行异常，二级重复执行同样会异常，无意义）
html = html.replace(
  /document\.write\('<script src="assets\/vendor\/cloud-sdk\.es15\.js[^']*"><\\\/script>'\);/g,
  "/* 单文件版：已跳过同域兜底（第一级已内联同一份 SDK） */"
);

const out = path.join(outDir, 'study-guardian.html');
fs.writeFileSync(out, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);

// 自检：不该残留 assets/ 引用
const left = html.match(/src="assets\/[^"]*"|href="assets\/[^"]*"/g) || [];
if (left.length) {
  console.error('⚠ 仍有未内联的 assets 引用:', left);
  process.exit(1);
}

console.log('built ->', out, kb + ' KB');
