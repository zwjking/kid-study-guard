/** 校验 SDK 已无 iOS15 不支持的语法：二次转译若无改动即通过 */
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const f = path.join(__dirname, '..', 'web', 'assets', 'vendor', 'cloud-sdk.es15.js');
const code = fs.readFileSync(f, 'utf8');
const r = esbuild.transformSync(code, { target: ['safari15', 'ios15'], minify: false, legalComments: 'none', charset: 'utf8' });
const same = r.code.trim() === code.trim();
console.log('幂等（二次转译无改动）:', same ? '是 → 已完全兼容 iOS 15' : '否 → 仍有语法被降级，长度 ' + code.length + ' -> ' + r.code.length);
process.exit(same ? 0 : 1);
