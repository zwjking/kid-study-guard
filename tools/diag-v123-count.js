/**
 * 诊断：家长端今日明细行数与云端作业项数不一致
 * 用法：node tools/diag-v123-count.js "<家长端URL>"
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_X = process.argv[2] || 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=parent';
const PORT = 9355, sleep = ms => new Promise(r => setTimeout(r, ms));

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

  await send('Page.navigate', { url: URL_X }, sessionId);
  await sleep(7000);
  console.log('版本        =', await ev('window.APP_VERSION'));
  console.log('落地域名    =', await ev('location.hostname'));

  console.log('\n--- 登录前 ---');
  console.log('SCHEDULE 数 =', await ev('typeof SCHEDULE!=="undefined"?SCHEDULE.length:"未定义"'));

  console.log('\n--- 登录 ---');
  console.log('signIn      =', await ev('Cloud.signIn("zwjking@126.com","123456").then(function(){return "ok"}).catch(function(e){return "ERR "+e.message})'));
  await sleep(1500);
  await ev('App.bootAfterAuth()');
  await sleep(4000);

  console.log('\n--- 登录后本地状态 ---');
  console.log('S.role      =', await ev('S.role'), '| S.page =', await ev('S.page'));
  console.log('S.planDate  =', await ev('S.planDate'));
  console.log('S.items 数  =', await ev('(S.items||[]).length'));
  console.log('items 明细  =', String(await ev('JSON.stringify((S.items||[]).map(function(i){return i.subject+"/"+i.name+"["+i.status+"/"+i.est+"分]"})).slice(0,700)')));
  console.log('SCHEDULE 数 =', await ev('SCHEDULE.length'));
  console.log('非休息块数  =', await ev('SCHEDULE.filter(function(s){return s.kind!=="break"}).length'));
  console.log('hw 段数     =', await ev('SCHEDULE.filter(function(s){return s.kind==="hw"}).length'));
  console.log('hw 已交数   =', await ev('SCHEDULE.filter(function(s){return s.kind==="hw"&&s.done}).length'));
  console.log('非休息块标题= ', String(await ev('JSON.stringify(SCHEDULE.filter(function(s){return s.kind!=="break"}).map(function(s){return (s.done?"[已交]":"")+s.title}))').slice(0, 900)));

  console.log('\n--- 页面实际渲染 ---');
  await ev('S.role="parent"; S.page="p-home"; render();');
  await sleep(600);
  console.log('看板 progress 文本 =', String(await ev('(function(){var e=document.querySelector(".balance .num");return e?e.textContent:""})()')));
  console.log('看板明细行数       =', await ev('document.querySelectorAll("#viewInner .p-row").length'));
  console.log('看板明细标题       =', String(await ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#viewInner .p-row .pn"),function(e){return e.textContent}))')).slice(0, 900));

  await ev('S.page="p-review"; render();');
  await sleep(500);
  console.log('返工页行数         =', await ev('document.querySelectorAll("#viewInner .p-row").length'));
  console.log('返工页标题         =', String(await ev('JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#viewInner .p-row .pn"),function(e){return e.textContent}))')).slice(0, 900));

  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_v124_diag.png', Buffer.from(r.data, 'base64'));
  console.log('\n截图 → .shot_v124_diag.png');
  console.log('异常 =', errs.length ? errs.join(' | ') : '（无）');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('诊断失败:', e.message); process.exit(1); });
