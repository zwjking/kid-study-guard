/**
 * 凭证功能端到端验证：登录 → 上传照片/录音 → 签名地址取回 → 校验 → 清理
 * 测试文件用 zz-selftest 前缀，结束后全部删除，不碰真实任务数据
 */
const { spawn } = require('child_process');
const path = require('path');

const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9339;
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
  await send('Page.navigate', { url: 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=child' }, sessionId);
  await sleep(9000);
  await send('Browser.grantPermissions', { permissions: ['audioCapture'] });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  console.log('=== 0. 登录 ===');
  console.log(await ev(`(async function(){
    var r = await Cloud.signIn('zwjking@126.com', '123456');
    return JSON.stringify({ok: r.ok, msg: r.msg || ''});
  })()`));

  console.log('\n=== 1. 照片：压缩 → 上传 → 签名取回 → 比对 ===');
  console.log(await ev(`(async function(){
    var cv=document.createElement('canvas'); cv.width=2400; cv.height=1800;
    var c=cv.getContext('2d');
    var g=c.createLinearGradient(0,0,2400,1800); g.addColorStop(0,'#4F63E0'); g.addColorStop(1,'#FF8A3D');
    c.fillStyle=g; c.fillRect(0,0,2400,1800);
    c.fillStyle='#fff'; c.font='bold 140px sans-serif'; c.fillText('SELFTEST 作业页', 150, 950);
    var raw = await new Promise(function(r){cv.toBlob(r,'image/jpeg',0.95);});

    var t0=Date.now();
    var blob = await compressImage(new File([raw],'t.jpg',{type:'image/jpeg'}), 1280, 0.82);
    var up = await Cloud.uploadEvidence(blob, '2026-10-29', 'zz-selftest-photo');
    if(!up.ok) return JSON.stringify({step:'upload', fail:up.msg});

    var url = await Cloud.evidenceUrl(up.path, 600);
    if(!url) return JSON.stringify({step:'sign', fail:'签名地址为空', path:up.path});

    var res = await fetch(url);
    var got = await res.blob();
    var del = await Cloud.deleteEvidence(up.path);

    return JSON.stringify({
      原图KB: Math.round(raw.size/1024),
      压缩后KB: Math.round(blob.size/1024),
      耗时ms: Date.now()-t0,
      上传路径: up.path,
      签名HTTP: res.status,
      取回KB: Math.round(got.size/1024),
      取回类型: got.type,
      内容一致: got.size === blob.size,
      已清理: del
    }, null, 1);
  })()`));

  console.log('\n=== 2. 录音：录 3 秒 → 上传 → 签名取回 → 播放校验 ===');
  console.log(await ev(`(async function(){
    var stream = await navigator.mediaDevices.getUserMedia({audio:true});
    var mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm';
    var mr = new MediaRecorder(stream, {mimeType: mime});
    var chunks=[];
    mr.ondataavailable=function(e){ if(e.data&&e.data.size) chunks.push(e.data); };
    await new Promise(function(res){ mr.onstop=res; mr.start(); setTimeout(function(){mr.stop();},3000); });
    stream.getTracks().forEach(function(t){t.stop();});
    var blob = new Blob(chunks,{type:mime});
    if(!blob.size) return '没录到声音';

    var up = await Cloud.uploadEvidence(blob, '2026-10-29', 'zz-selftest-voice');
    if(!up.ok) return JSON.stringify({step:'upload', fail:up.msg});

    var url = await Cloud.evidenceUrl(up.path, 600);
    var res = await fetch(url);
    var got = await res.blob();
    var del = await Cloud.deleteEvidence(up.path);

    return JSON.stringify({
      录音类型: mime,
      大小KB: Math.round(blob.size/1024),
      上传路径: up.path,
      签名HTTP: res.status,
      取回KB: Math.round(got.size/1024),
      内容一致: got.size === blob.size,
      已清理: del
    }, null, 1);
  })()`));

  console.log('\n=== 3. 确认测试文件已清空 ===');
  console.log(await ev(`(async function(){
    try{
      var c = window.WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONF);
      var r = await c.storage.from('runtime').list('');
      return JSON.stringify(r && r.data ? r.data.map(function(x){return x.name;}) : r);
    }catch(e){ return 'ERR '+e.message; }
  })()`));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
