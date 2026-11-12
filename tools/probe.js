/**
 * 用 CDP 实跑页面，抓 console / 异常 / SDK 状态
 * 用法: node tools/probe.js "<url>"
 */
const { spawn } = require('child_process');
const path = require('path');

const URL_TARGET = process.argv[2] || 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=child';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9333;

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--remote-debugging-port=' + PORT,
    '--window-size=430,932',
    'about:blank'
  ], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      ver = await r.json();
      break;
    } catch (e) { /* 等待启动 */ }
  }
  if (!ver) { console.log('浏览器启动失败'); proc.kill(); process.exit(1); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

  await new Promise(r => ws.addEventListener('open', r));

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);

  await send('Page.navigate', { url: URL_TARGET }, sessionId);
  await sleep(9000);

  // 读运行时状态
  const evalExpr = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    return r.result && r.result.value;
  };

  const state = await evalExpr(`JSON.stringify({
    sdk: typeof window.WorkBuddyCloud,
    sdkErr: window.__SDK_ERR || null,
    diag: window.__DIAG || [],
    version: window.APP_VERSION || null,
    authWin: typeof window.AuthUI,
    cloudObj: typeof window.Cloud,
    bodyText: (document.body.innerText || '').slice(0, 120)
  })`);

  console.log('=== 运行时状态 ===');
  console.log(state);

  console.log('\n=== 异常 / 错误日志 ===');
  let count = 0;
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      count++;
      const d = e.params.exceptionDetails;
      console.log('[异常]', (d.exception && (d.exception.description || d.exception.value)) || d.text);
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      count++;
      console.log('[错误]', e.params.entry.text, e.params.entry.url || '');
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      count++;
      console.log('[console.error]', e.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
    }
  }
  if (!count) console.log('（无）');

  // 请求失败清单
  const failed = events.filter(e => e.method === 'Network.loadingFailed')
    .map(e => e.params.errorText + ' ' + (e.params.type || ''));
  console.log('\n=== 资源加载失败 ===');
  console.log(failed.length ? failed.slice(0, 10).join('\n') : '（无）');

  ws.close();
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('probe 失败:', e.message); process.exit(1); });
