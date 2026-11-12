const fs=require('fs'),path=require('path'),esbuild=require('esbuild');
const f=path.join(__dirname,'..','web','assets','vendor','cloud-sdk.es15.js');
const a=fs.readFileSync(f,'utf8');
const b=esbuild.transformSync(a,{target:['safari15','ios15'],minify:false,legalComments:'none'}).code;
// 找第一处差异
let i=0; while(i<a.length&&i<b.length&&a[i]===b[i]) i++;
console.log('第一处差异位置:', i);
console.log('原:', JSON.stringify(a.slice(Math.max(0,i-90), i+70)));
console.log('新:', JSON.stringify(b.slice(Math.max(0,i-90), i+70)));
