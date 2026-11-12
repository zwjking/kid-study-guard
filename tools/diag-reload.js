/**
 * 复现"已登录态直接进入"的启动路径：
 * 先 signIn 让 SDK 存下会话，然后整页 reload，走 boot() → getSession() → bootAfterAuth()
 * 用法：node tools/diag-reload.js "<URL>"
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_X = process.argv[2] || 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=parent';
const PORT = 9357, sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p = {}, sid) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { errs.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 200)); }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return '[异]' + (((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '')).slice(0, 250);
    return r.result && r.result.value;
  };
  const snap = async tag => {
    await sleep(300);
    const d = JSON.parse(await ev(`JSON.stringify({
      ver: window.APP_VERSION,
      items: (typeof S!=='undefined' && S.items || []).length,
      sched: (typeof SCHEDULE!=='undefined') ? SCHEDULE.length : -1,
      rows: (typeof SCHEDULE!=='undefined') ? SCHEDULE.filter(function(s){return s.kind!=='break'}).length : -1,
      hw: (typeof SCHEDULE!=='undefined') ? SCHEDULE.filter(function(s){return s.kind==='hw'}).length : -1,
      role: (typeof S!=='undefined') ? S.role : '?',
      page: (typeof S!=='undefined') ? S.page : '?',
      synced: (typeof S!=='undefined') ? !!S.synced : null,
      planDate: (typeof S!=='undefined') ? S.planDate : null,
      gateHidden: document.getElementById('authGate') ? document.getElementById('authGate').classList.contains('gone') : null,
      domRows: document.querySelectorAll('#viewInner .p-row').length,
      domTitles: Array.prototype.map.call(document.querySelectorAll('#viewInner .p-row .pn'), function(e){return e.textContent}),
      navText: (document.querySelector('.balance .num')||{}).textContent || ''
    })`));
    console.log(`[${tag}] 版本=${d.ver} role=${d.role} page=${d.page} synced=${d.synced} planDate=${d.planDate}`);
    console.log(`         items=${d.items} SCHEDULE=${d.sched} 非休息=${d.rows} hw段=${d.hw} | 登录门隐藏=${d.gateHidden}`);
    console.log(`         页面行数=${d.domRows} 进度文本="${d.navText}"`);
    console.log(`         页面标题=${JSON.stringify(d.domTitles).slice(0, 700)}`);
    return d;
  };

  console.log('=== 第一步：首次进入并登录（建立会话）===');
  await send('Page.navigate', { url: URL_X }, sessionId);
  await sleep(6000);
  console.log('signIn =', await ev('Cloud.signIn("zwjking@126.com","123456").then(function(){return "ok"}).catch(function(e){return "ERR "+e.message})'));
  await sleep(2000);

  console.log('\n=== 第二步：整页刷新（模拟你手机上直接打开）===');
  await send('Page.reload', {}, sessionId);
  for (const d of [3000, 6000, 10000]) { await sleep(d === 3000 ? 3000 : 3000); await snap(d + 'ms'); }

  console.log('\n=== 第三步：切到家长端渲染 ===');
  await ev('S.role="parent"; S.page="p-home"; render();');
  await snap('强制家长');

  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_v124_reload.png', Buffer.from(r.data, 'base64'));
  console.log('\n截图 → .shot_v124_reload.png');
  console.log('异常 =', errs.length ? errs.join(' | ') : '（无）');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
