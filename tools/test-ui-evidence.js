/** UI 层胶水验证：openCamera 建 input → change → 压缩 → 调上传 → 调 completeTask（全程 mock，不写云端） */
const { spawn } = require('child_process');
const path = require('path');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9341; const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn(CH, ['--headless','--disable-gpu','--no-sandbox','--remote-debugging-port='+PORT,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','about:blank'], {stdio:'ignore'});
  let ver=null; for(let i=0;i<40;i++){await sleep(250); try{ver=await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();break;}catch(e){}}
  const ws=new WebSocket(ver.webSocketDebuggerUrl); let id=0; const pending=new Map();
  const send=(m,p={},sid)=>new Promise((res,rej)=>{const mid=++id;pending.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p,sessionId:sid}));});
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId); await send('Page.enable',{},sessionId);
  await send('Page.navigate',{url:'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=child'},sessionId);
  await sleep(9000);
  await send('Browser.grantPermissions',{permissions:['audioCapture']});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)return 'ERR: '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text);return r.result&&r.result.value;};

  console.log('=== 登录 + 进入孩子端 ===');
  console.log(await ev(`(async function(){
    var r = await Cloud.signIn('zwjking@126.com','123456');
    if(!r.ok) return 'login fail '+r.msg;
    S.synced = true;
    var g=document.getElementById('authGate'); if(g) g.remove();
    document.body.classList.remove('auth-locked');
    S.role='child'; S.page='home'; render();
    return 'ok, 页面已进孩子端';
  })()`));

  console.log('\n=== 拍照 UI 全链路（mock 上传与落库） ===');
  console.log(await ev(`(async function(){
    window.__up=null; window.__done=null;
    Cloud.uploadEvidence = async function(blob, day, tid){ window.__up={size:blob.size,type:blob.type,day:day,tid:tid}; return {ok:true, path:'users/fake/x.jpg'}; };
    completeTask = function(id, evd, asset){ window.__done = {id:id, evd:evd, asset:asset}; };

    openCamera('hw1');
    await new Promise(function(r){setTimeout(r,400);});
    var inp = document.querySelector('input[type=file]');
    if(!inp) return '输错：没生成 input';

    var cv=document.createElement('canvas'); cv.width=2000; cv.height=1500;
    var c=cv.getContext('2d'); c.fillStyle='#4F63E0'; c.fillRect(0,0,2000,1500);
    var blob=await new Promise(function(r){cv.toBlob(r,'image/jpeg',0.95);});
    var file=new File([blob],'shot.jpg',{type:'image/jpeg'});
    var dt=new DataTransfer(); dt.items.add(file);
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));

    await new Promise(function(r){setTimeout(r,2500);});
    return JSON.stringify({
      input属性: {type: inp.type, accept: inp.accept, capture: inp.getAttribute('capture')},
      上传收到: window.__up,
      任务落库: window.__done
    }, null, 1);
  })()`));

  console.log('\n=== 录音 UI 全链路（分步） ===');
  console.log('1) 面板打开:', await ev("(async function(){ window.__up=null; window.__done=null; try{ await openRecorder('hw1'); }catch(e){ return 'openRecorder threw: '+e.message; } await new Promise(function(r){setTimeout(r,800);}); var m=document.getElementById('sheetMask'); var t=document.getElementById('recTime'); return JSON.stringify({sheetOpen: !!m, time: t?t.textContent:'none'}); })()"));
  await sleep(2200);
  console.log('2) 2 秒后计时:', await ev("(function(){ var t=document.getElementById('recTime'); return t?t.textContent:'none'; })()"));
  console.log('3) 停止并上传:', await ev("(async function(){ stopRecorder(); await new Promise(function(r){setTimeout(r,2500);}); return JSON.stringify({upload: window.__up, done: window.__done}); })()"));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
