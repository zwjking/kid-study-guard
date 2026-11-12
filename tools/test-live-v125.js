/**
 * v1.2.5 线上验收：真实账号登录家长端，验证
 * ① 版本已更新 ② 每次同步都真的发出网络请求（不是复用缓存）
 * ③ 明细行数仍是 12 行 / 7 项 ④ 状态行如实显示
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_P = process.argv[2] || 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=parent';
const PORT = 9377, sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, ex) => { if (ok) { pass++; console.log('  ✔ ' + n + (ex ? '（' + ex + '）' : '')); } else { fail++; console.log('  ✘ ' + n + (ex ? '（' + ex + '）' : '')); } };

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-proxy-server', '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = []; const reqs = []; const cachedFrom = [];
  const send = (m, p = {}, sid) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text); }
    else if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.url.indexOf('/.cloud/') >= 0) cachedFrom.push({ url: r.url.slice(-40), disk: !!r.fromDiskCache, mem: !!r.fromMemoryCache });
    }
    else if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (u.indexOf('YOUR_APP_HOST') >= 0 && u.indexOf('/.cloud/') >= 0) reqs.push(u);
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return '[异]' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200);
    return r.result && r.result.value;
  };

  await send('Page.navigate', { url: URL_P }, sessionId);
  await sleep(7000);

  console.log('线上版本 =', await ev('window.APP_VERSION'));
  ck('线上已是 v1.2.5', String(await ev('window.APP_VERSION')) === 'v1.2.5');
  console.log('资源版本 =', await ev('(document.querySelector("link[href*=style]")||{}).getAttribute&&document.querySelector("link[href*=style]").getAttribute("href")'));

  /* 真实登录 */
  console.log('\n--- 真实账号登录 ---');
  console.log('signIn =', String(await ev('Cloud.signIn("zwjking@126.com","123456").then(function(){return "ok"}).catch(function(e){return "ERR "+e.message})')));
  await sleep(1200);
  await ev('App.bootAfterAuth()');
  await ev('App.startAutoRefresh()');   // 登录门在真实路径里会调，这里手动补上
  await sleep(3000);

  console.log('items =', await ev('(S.items||[]).length'));
  console.log('非休息块 =', await ev('SCHEDULE.filter(function(s){return s.kind!=="break"}).length'));
  const rows = await ev('(document.getElementById("viewInner")||{}).innerHTML');
  const rowCount = (String(rows).match(/class="p-row"/g) || []).length;
  ck('今日明细仍为 12 行', rowCount === 12, rowCount + ' 行');
  ck('清单 7 项完好', (await ev('(S.items||[]).length')) === 7, (await ev('(S.items||[]).length')) + ' 项');

  /* 每次同步是否真的发请求 */
  console.log('\n--- 同步是否真的走网络 ---');
  const before = reqs.length;
  await ev('syncOnce()');
  await sleep(1500);
  const after1 = reqs.length;
  ck('第一次同步发出了网络请求', after1 > before, before + '→' + after1);

  await ev('syncOnce()');
  await sleep(1500);
  const after2 = reqs.length;
  ck('第二次同步同样发出新请求（没复用缓存）', after2 > after1, after1 + '→' + after2);

  const anyCached = cachedFrom.filter(c => c.disk || c.mem);
  ck('同步响应没有一条来自内存/磁盘缓存', anyCached.length === 0,
     cachedFrom.length + ' 个响应，命中缓存 ' + anyCached.length + ' 个');

  /* 状态行 */
  const badge = String(await ev('(document.getElementById("syncBadge")||{}).textContent||""')).trim();
  console.log('状态行 =', JSON.stringify(badge));
  ck('状态行显示已同步时间', /^已同步 \d{2}:\d{2}$/.test(badge), badge);
  ck('没有误报连接失败', badge.indexOf('连接不上') < 0);

  /* 唤醒一次看是否触发 */
  const b3 = reqs.length;
  await ev('(function(){ window.dispatchEvent(new Event("focus")); return 1 })()');
  await sleep(1800);
  ck('模拟回到前台立刻触发同步', reqs.length > b3, b3 + '→' + reqs.length);

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_v125_live.png', Buffer.from(shot.data, 'base64'));
  console.log('\n截图 → .shot_v125_live.png');
  console.log('云请求总数 =', reqs.length, '| 异常 =', errs.length ? errs.join(' | ').slice(0, 300) : '（无）');
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收失败:', e.message); process.exit(1); });
