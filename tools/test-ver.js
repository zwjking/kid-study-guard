/**
 * v1.2.4 版本角标验证
 * 用法：node tools/test-ver.js "<URL>"
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_X = process.argv[2] || 'http://127.0.0.1:8128/index.html';
const PORT = 9361, sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ✔ ' : '  ✘ ') + n + (extra ? '  → ' + extra : '')); };

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
    if (r.exceptionDetails) return '[异]' + (((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '')).slice(0, 220);
    return r.result && r.result.value;
  };

  await send('Page.navigate', { url: withWeek(URL_X) }, sessionId);
  await sleep(4500);

  console.log('== 版本角标 ==');
  console.log('  页面版本 =', await ev('window.APP_VERSION'));

  const probe = async () => JSON.parse(await ev(`(function(){
    var b = document.querySelector('.topbar .ver');
    var cb = document.querySelector('.topbar .clock-box');
    var out = { has: !!b };
    if (b) {
      var r = b.getBoundingClientRect(), c = cb ? cb.getBoundingClientRect() : null;
      out.text = b.textContent.trim();
      out.w = Math.round(r.width); out.h = Math.round(r.height);
      out.left = Math.round(r.left); out.right = Math.round(r.right); out.top = Math.round(r.top);
      var cs = getComputedStyle(b);
      out.fontSize = cs.fontSize; out.color = cs.color; out.bg = cs.backgroundColor;
      out.overlapClock = c ? !(r.right <= c.left + 0.5 || r.left >= c.right - 0.5) : null;
      out.inViewport = r.left >= 0 && r.right <= window.innerWidth + 0.5;
      out.clickable = cs.cursor !== 'not-allowed';
      out.inApp = !!b.closest('#app');
    }
    out.viewport = window.innerWidth;
    out.errs = 0;
    return JSON.stringify(out);
  })()`));

  let d = await probe();
  ck('角标存在', d.has === true);
  ck('角标文案 = 页面版本', d.text === (await ev('window.APP_VERSION')), d.text);
  ck('角标在移动端可见（有宽高）', d.w > 0 && d.h > 0, d.w + '×' + d.h);
  ck('未与时钟框重叠', d.overlapClock === false);
  ck('未超出屏幕右边界', d.inViewport === true, 'right=' + d.right + ' / 视口=' + d.viewport);
  ck('字号小、不抢视线（≤11px）', parseFloat(d.fontSize) <= 11, d.fontSize);
  ck('有底色区分（非透明）', d.bg !== 'rgba(0, 0, 0, 0)', d.bg);
  ck('挂在应用壳内（不是浮层）', d.inApp === true);

  console.log('\n== 孩子端 / 家长端都显示 ==');
  for (const [role, page] of [['child', 'home'], ['parent', 'p-home'], ['parent', 'p-review']]) {
    const t = await ev(`(function(){S.role='${role}';S.page='${page}';render();var b=document.querySelector('.topbar .ver');return b?b.textContent.trim():'(无)'})()`);
    ck(`角色=${role} 页面=${page} 有角标`, t.startsWith('v'), t);
  }

  console.log('\n== 点击强制更新 ==');
  const before = String(await ev('location.href'));
  await ev(`(function(){var b=document.querySelector('.topbar .ver'); b.click(); return 1})()`);
  await sleep(2500);
  const after = String(await ev('location.href'));
  ck('点击后地址带 _r 参数', /[?&]_r=/.test(after), after.slice(-46));
  ck('分享码未丢失', /sharecode=/.test(after) === /sharecode=/.test(before), '前:' + /sharecode=/.test(before) + ' 后:' + /sharecode=/.test(after));
  ck('role 参数未丢失', /role=/.test(after) === /role=/.test(before));
  const verAfter = await ev('window.APP_VERSION');
  ck('更新后页面仍正常加载', typeof verAfter === 'string' && /^v\d/.test(verAfter), verAfter);
  const d2 = await probe();
  ck('更新后角标仍在', d2.has === true);

  console.log('\n  异常 =', errs.length ? errs.join(' | ') : '（无）');
  ck('零运行时异常', errs.length === 0);

  const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_v124_ver.png', Buffer.from(r.data, 'base64'));
  console.log('\n截图 → .shot_v124_ver.png');
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  ws.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
