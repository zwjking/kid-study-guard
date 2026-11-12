/** 家长端查看凭证：真实上传一张图 → 家长端点开 → 确认图片真的加载出来 → 清理 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9342; const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn(CH, ['--headless','--disable-gpu','--no-sandbox','--hide-scrollbars','--remote-debugging-port='+PORT,'--window-size=430,932','about:blank'], {stdio:'ignore'});
  let ver=null; for(let i=0;i<40;i++){await sleep(250); try{ver=await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();break;}catch(e){}}
  const ws=new WebSocket(ver.webSocketDebuggerUrl); let id=0; const pending=new Map();
  const send=(m,p={},sid)=>new Promise((res,rej)=>{const mid=++id;pending.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p,sessionId:sid}));});
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId); await send('Page.enable',{},sessionId);
  await send('Page.navigate',{url:'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=parent'},sessionId);
  await sleep(9000);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)return 'ERR: '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text);return r.result&&r.result.value;};

  console.log('1) 登录并上传一张真图:', await ev(`(async function(){
    var r = await Cloud.signIn('zwjking@126.com','123456');
    if(!r.ok) return 'login fail '+r.msg;
    var cv=document.createElement('canvas'); cv.width=1600; cv.height=1200;
    var c=cv.getContext('2d');
    c.fillStyle='#FFFDF6'; c.fillRect(0,0,1600,1200);
    c.strokeStyle='#D8DEE9'; for(var i=0;i<14;i++){c.beginPath();c.moveTo(0,90+i*80);c.lineTo(1600,90+i*80);c.stroke();}
    c.fillStyle='#2A3566'; c.font='bold 90px sans-serif'; c.fillText('数学作业 第 12 页', 110, 260);
    c.font='60px sans-serif'; c.fillText('1) 36 + 48 = 84', 140, 460);
    c.fillText('2) 7 x 8 = 56', 140, 640);
    c.fillText('3) 96 / 4 = 24', 140, 820);
    var blob=await new Promise(function(res){cv.toBlob(res,'image/jpeg',0.9);});
    var up = await Cloud.uploadEvidence(blob, '2026-10-29', 'zz-selftest-parent');
    window.__lastPath = up.path;
    return JSON.stringify(up);
  })()`));

  console.log('2) 造一条带凭证的任务并进家长端:', await ev(`(function(){
    var g=document.getElementById('authGate'); if(g) g.remove();
    document.body.classList.remove('auth-locked');
    var up = window.__lastPath;
    S.tasks['hw1'].status='done';
    S.tasks['hw1'].evidence='photo';
    S.tasks['hw1'].evidencePath = up;
    S.tasks['hw1'].evidenceMime='image/jpeg';
    S.tasks['hw1'].evidenceAt=new Date().toISOString();
    S.role='parent'; S.page='p-review'; render();
    var btns=[].slice.call(document.querySelectorAll('.mini-btn')).map(function(b){return b.textContent;});
    return JSON.stringify({有看照片按钮: btns.indexOf('看照片')>=0, 全部按钮: btns});
  })()`));

  console.log('3) 点开凭证:', await ev(`(async function(){
    await showEvidence('hw1');
    await new Promise(function(r){setTimeout(r,2500);});
    var img=document.querySelector('#evBox img');
    return JSON.stringify({
      弹窗出现: !!document.getElementById('sheetMask'),
      图片元素: !!img,
      图片已加载: !!(img && img.naturalWidth>0),
      图片尺寸: img ? (img.naturalWidth+'x'+img.naturalHeight) : 'none'
    });
  })()`));

  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_parent_evidence.png', Buffer.from(r.data, 'base64'));
  console.log('4) 截图 → .shot_parent_evidence.png');

  console.log('5) 清理上传文件:', await ev(`(async function(){
    var p = window.__lastPath;
    if(!p) return 'no path';
    var ok = await Cloud.deleteEvidence(p);
    return 'deleted='+ok;
  })()`));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
