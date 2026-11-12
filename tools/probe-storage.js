/**
 * 探测云客户端暴露的存储接口形状
 */
const { spawn } = require('child_process');
const path = require('path');

const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9335;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
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

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  console.log('=== 客户端顶层成员 ===');
  console.log(await ev(`(function(){
    try{
      var c = window.WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONF);
      return JSON.stringify({
        keys: Object.keys(c),
        storageType: typeof c.storage,
        storageProto: c.storage ? Object.getOwnPropertyNames(Object.getPrototypeOf(c.storage)) : null,
        storageOwn: c.storage ? Object.keys(c.storage) : null
      });
    }catch(e){ return 'ERR '+e.message; }
  })()`));

  console.log('\n=== storage.from 探测 ===');
  console.log(await ev(`(function(){
    try{
      var c = window.WorkBuddyCloud.createWorkBuddyCloud(CLOUD_CONF);
      if(typeof c.storage.from !== 'function') return 'from 不是方法: '+typeof c.storage.from;
      var b = c.storage.from('evidence');
      var proto = Object.getOwnPropertyNames(Object.getPrototypeOf(b));
      return JSON.stringify({ bucketProto: proto, bucketId: b.bucketId, url: b.url });
    }catch(e){ return 'ERR '+e.message; }
  })()`));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
