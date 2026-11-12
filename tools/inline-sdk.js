/**
 * 生成 web/index.html 的「云服务 SDK 段」——带完整兼容层
 *
 * 背景（iOS Safari 实测故障）：
 *   SDK 内部调 localStorage / sessionStorage。iOS Safari 一旦打开「阻止所有 Cookie」
 *   或处于隐私浏览，这两个存储一读就抛 SecurityError，SDK 的 IIFE 整体中断，
 *   结果 window.WorkBuddyCloud 是 undefined，页面报「云服务没准备好」。
 *   而我们自己的 cloud.js 里包了 try/catch，所以 Cloud 对象照常存在——
 *   这就是「Cloud=object 但 SDK=undefined」这个矛盾现象的来源。
 *
 * 本脚本做的事：
 *   1. 探测 localStorage / sessionStorage 是否真能读写，不能就换成内存版
 *   2. 全程捕获 SDK 的解析/运行错误，写进 window.__SDK_ERR，显示在页面上
 *   3. 三级加载：内联 → 同域文件 → CDN，每一级失败都有记录
 *   4. assets 加版本号，破缓存
 *
 * 源模板：backup/index.html.bak（原始未内联版本），输出：web/index.html
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const VER = 'v1.0.4';

const tpl = fs.readFileSync(path.join(root, 'backup', 'index.html.bak'), 'utf8');
const sdk = fs.readFileSync(path.join(root, 'web', 'assets', 'vendor', 'cloud-sdk.es15.js'), 'utf8');

// ---------- 兼容保护层 ----------
const guard = `<script>
/* ===== 兼容层：存储兜底 + 错误捕获 =====
   iOS Safari「阻止所有 Cookie」或隐私浏览下，localStorage/sessionStorage 一读就抛
   SecurityError，云 SDK 初始化会整个中断。这里先探测，不可用就换内存版顶上。 */
(function () {
  window.__DIAG = window.__DIAG || [];
  window.__SDK_ERR = window.__SDK_ERR || '';
  function note(s) { try { window.__DIAG.push(s); } catch (e) {} }

  function usable(name) {
    try {
      var s = window[name];
      if (!s) { note(name + ':不存在'); return false; }
      var k = '__p' + Math.random().toString(36).slice(2);
      s.setItem(k, '1');
      if (s.getItem(k) !== '1') { note(name + ':写入无效'); return false; }
      s.removeItem(k);
      return true;
    } catch (e) {
      note(name + ':' + ((e && e.name) || '错误'));
      return false;
    }
  }

  function memoryStore() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      clear: function () { m = {}; },
      key: function (i) { var ks = Object.keys(m); return i < ks.length ? ks[i] : null; },
      get length() { return Object.keys(m).length; }
    };
  }

  ['localStorage', 'sessionStorage'].forEach(function (name) {
    if (usable(name)) return;
    try {
      Object.defineProperty(window, name, {
        value: memoryStore(), configurable: true, writable: false
      });
      note(name + '→内存版');
    } catch (e) { note(name + '→替换失败'); }
  });

  // 任何脚本错误都记下来，页面上能看见
  window.addEventListener('error', function (ev) {
    if (!window.__SDK_ERR) {
      window.__SDK_ERR = (ev.message || 'unknown') + ' @line' + (ev.lineno || '?');
    }
  }, true);
})();
</script>`;

// ---------- 第一级：内联 SDK ----------
const sdkInline = `<script>
/* ===== 云服务 SDK（内联，第一级）===== */
try {
${sdk}
} catch (e) {
  window.__SDK_ERR = 'SDK执行异常 ' + ((e && (e.name + ': ' + e.message)) || e);
}
</script>`;

// ---------- 第二级 / 第三级：同步回退 ----------
const fallback = `<script>
/* 第二级：内联失败则同步加载同域文件（document.write 在解析期同步执行，后续脚本能看到） */
if (typeof window.WorkBuddyCloud === 'undefined') {
  window.__DIAG.push('内联SDK未生效→试同域文件');
  document.write('<script src="assets/vendor/cloud-sdk.es15.js?v=${VER}"><\\/script>');
}
</script>
<script>
/* 第三级：仍失败则退回公网 CDN */
if (typeof window.WorkBuddyCloud === 'undefined') {
  window.__DIAG.push('同域文件也失败→试CDN');
  document.write('<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"><\\/script>');
}
</script>
<script>window.APP_VERSION = "${VER}";</script>`;

// 把模板里的 SDK 外链段整体替换
const START = '<!-- 云服务 SDK';
const start = tpl.indexOf(START);
if (start < 0) {
  console.error('✗ 模板里找不到 SDK 段');
  process.exit(1);
}
const endMark = '</script>';
const firstClose = tpl.indexOf(endMark, start);
if (firstClose < 0) {
  console.error('✗ 模板 SDK 段结构异常');
  process.exit(1);
}
const end = firstClose + endMark.length;

let html = tpl.slice(0, start) + guard + '\n\n' + sdkInline + '\n\n' + fallback + tpl.slice(end);

// assets 加版本号
html = html
  .replace(/src="assets\/data\.js"/, 'src="assets/data.js?' + VER + '"')
  .replace(/src="assets\/cloud\.js"/, 'src="assets/cloud.js?' + VER + '"')
  .replace(/src="assets\/authui\.js"/, 'src="assets/authui.js?' + VER + '"')
  .replace(/src="assets\/app\.js"/, 'src="assets/app.js?' + VER + '"')
  .replace(/href="assets\/style\.css"/, 'href="assets/style.css?' + VER + '"')
  .replace(/href="assets\/auth\.css"/, 'href="assets/auth.css?' + VER + '"');

fs.writeFileSync(path.join(root, 'web', 'index.html'), html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✓ index.html 已生成，版本', VER, '，大小', kb, 'KB');
console.log('  兼容层：storage 探测 + 内存兜底 + 错误捕获');
console.log('  加载级数：内联 → 同域文件 → CDN');
