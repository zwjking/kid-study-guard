/**
 * 凭证链路分段自检：压缩 → 录音 → 上传调用
 * 上传这一步未登录会失败，重点看错误码是否说明"权限"而不是"接口不存在"
 */
const { spawn } = require('child_process');
const path = require('path');

const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9337;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {}
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}, sid) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid }));
  });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' }, sessionId);
  await sleep(3500);
  await send('Browser.grantPermissions', { permissions: ['audioCapture'] });

  const ev = async (expr, awaitP = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: awaitP }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');

  /* ---- 1. 图片压缩 ---- */
  console.log('=== 1. 拍照压缩（造一张 2400×1800 的图） ===');
  console.log(await ev(`(async function(){
    function makeCanvas(w,h){
      var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      var c=cv.getContext('2d');
      var g=c.createLinearGradient(0,0,w,h); g.addColorStop(0,'#4F63E0'); g.addColorStop(1,'#FF8A3D');
      c.fillStyle=g; c.fillRect(0,0,w,h);
      c.fillStyle='#fff'; c.font='bold 120px sans-serif'; c.fillText('作业本 测试页', 120, 900);
      return cv;
    }
    var cv = makeCanvas(2400,1800);
    var blob = await new Promise(function(r){ cv.toBlob(r, 'image/jpeg', 0.95); });
    var file = new File([blob], 'test.jpg', {type:'image/jpeg'});
    var t0 = Date.now();
    var small = await compressImage(file, 1280, 0.82);
    return JSON.stringify({
      原图KB: Math.round(blob.size/1024),
      原图尺寸: '2400x1800',
      压缩后KB: Math.round(small.size/1024),
      压缩后类型: small.type,
      耗时ms: Date.now()-t0
    }, null, 1);
  })()`));

  /* ---- 2. 录音 ---- */
  console.log('\n=== 2. 录音（假麦克风，录 2 秒） ===');
  console.log(await ev(`(async function(){
    try{
      var stream = await navigator.mediaDevices.getUserMedia({audio:true});
      var cands=['audio/mp4','audio/webm;codecs=opus','audio/webm',''];
      var mime='';
      for (var i=0;i<cands.length;i++){ if(cands[i]===''||MediaRecorder.isTypeSupported(cands[i])){mime=cands[i];break;} }
      var mr = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);
      var chunks=[];
      mr.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
      await new Promise(function(res){
        mr.onstop=res;
        mr.start();
        setTimeout(function(){ mr.stop(); }, 2000);
      });
      stream.getTracks().forEach(function(t){t.stop();});
      var blob = new Blob(chunks,{type: mime||mr.mimeType||'audio/mp4'});
      return JSON.stringify({ 选用格式: mime||mr.mimeType, 实际类型: blob.type, 大小KB: Math.round(blob.size/1024) });
    }catch(e){ return '录音失败: '+e.name+' '+e.message; }
  })()`));

  /* ---- 3. 上传调用（未登录，预期失败在权限） ---- */
  console.log('\n=== 3. 上传调用（未登录，看错误性质） ===');
  console.log(await ev(`(async function(){
    var cv=document.createElement('canvas'); cv.width=400; cv.height=300;
    cv.getContext('2d').fillRect(0,0,400,300);
    var blob = await new Promise(function(r){ cv.toBlob(r,'image/jpeg',0.8); });
    var r = await Cloud.uploadEvidence(blob, '2026-10-29', 'hw1');
    return JSON.stringify(r);
  })()`));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
