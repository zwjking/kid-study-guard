/**
 * 把云服务 SDK 语法降级到 iOS 15 / Safari 15 能解析的水平
 *
 * 病因（iPhone 6s Plus / iOS 15.8.8 实测）：
 *   SDK 里用了 32 处「类静态初始化块」`static { ... }`，
 *   这是 Safari 16.4（2023-03）才支持的语法。
 *   iOS 15 的 Safari 解析到它直接报 SyntaxError: Unexpected token '{'，
 *   整个脚本块不执行 → WorkBuddyCloud 是 undefined → 页面报「云服务没准备好」。
 *
 * 做法：esbuild transform + target: safari15，把静态块等新语法转成等价旧写法。
 * 输出：cloud-sdk.es15.js（原文件保留，作为源）
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const dir = path.join(__dirname, '..', 'web', 'assets', 'vendor');
const src = path.join(dir, 'cloud-sdk.js');
const dst = path.join(dir, 'cloud-sdk.es15.js');

const code = fs.readFileSync(src, 'utf8');

const r = esbuild.transformSync(code, {
  target: ['safari15', 'ios15'],
  minify: false,
  legalComments: 'none',
  charset: 'utf8'
});

// 自检：降级后不该再有静态块
const leftStatic = (r.code.match(/static\s*\{/g) || []).length;
if (leftStatic > 0) {
  console.error('✗ 仍有 ' + leftStatic + ' 处 static{} 未降级');
  process.exit(1);
}

fs.writeFileSync(dst, r.code, 'utf8');

const kbIn = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
const kbOut = (Buffer.byteLength(r.code, 'utf8') / 1024).toFixed(1);
console.log('✓ 降级完成');
console.log('  输入 cloud-sdk.js      ' + kbIn + ' KB（静态块 32 处）');
console.log('  输出 cloud-sdk.es15.js ' + kbOut + ' KB（静态块 ' + leftStatic + ' 处）');
if (r.warnings && r.warnings.length) {
  console.log('  警告：', r.warnings.map(w => w.text).join('; '));
}
