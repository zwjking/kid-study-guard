/**
 * v1.2.2 应用壳验证：底栏滚动是否真的不动
 * 用法: node tools/test-shell.js <baseUrl>
 * 关键断言：滚动内容区之后，底栏的 top/bottom 必须与滚动前完全一致，且始终贴着视口底
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9336;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✔' : '✘'} ${m}`); };

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--remote-debugging-port=' + PORT, '--window-size=414,736', 'about:blank'], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {}
  }
  if (!ver) { console.log('浏览器启动失败'); proc.kill(); process.exit(1); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
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
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return '[异常] ' + (r.exceptionDetails.exception || {}).description;
    return r.result && r.result.value;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(name, Buffer.from(r.data, 'base64'));
    console.log('  截图 →', name);
  };

  /* iPhone 6s Plus：414×736 逻辑像素，dpr=3 */
  await send('Emulation.setDeviceMetricsOverride',
    { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);

  await send('Page.navigate', { url: withWeek(BASE) }, sessionId);
  await sleep(3500);

  // 去掉登录门，直接进家长端
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  await ev('S.role="parent"; S.page="p-home"; render();');
  await sleep(500);

  const VH = await ev('window.innerHeight');
  console.log('\n===== 家长端 · 壳结构 =====');
  console.log('  视口高 =', VH, '| 版本 =', await ev('window.APP_VERSION'));
  ok(await ev('!!document.getElementById("shellScroll")'), '滚动容器 #shellScroll 存在');
  ok(await ev('!!document.getElementById("shellTab")'), '底栏 #shellTab 存在');
  ok(await ev('getComputedStyle(document.getElementById("shellScroll")).overflowY') === 'auto', '滚动容器的 overflow-y = auto');
  ok(await ev('document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1'), 'html 不再纵向滚动（body 级滚动已关闭）');
  ok(await ev('document.body.scrollHeight <= document.body.clientHeight + 1'), 'body 不再纵向滚动');

  const tb0 = await ev('JSON.stringify(document.getElementById("shellTab").getBoundingClientRect())');
  const r0 = JSON.parse(tb0);
  ok(Math.abs((r0.top + r0.height) - VH) <= 1, `滚动前底栏贴住视口底（bottom=${(r0.top + r0.height).toFixed(1)}，视口=${VH}）`);

  console.log('\n===== 家长端 · 滚动后底栏是否原地不动 =====');
  const canScroll = await ev('(function(){var s=document.getElementById("shellScroll");return s.scrollHeight - s.clientHeight})()');
  console.log('  可滚动距离 =', canScroll, 'px');
  ok(canScroll > 50, '内容够长，存在真实滚动');

  await ev('document.getElementById("shellScroll").scrollTop = 300');
  await sleep(350);
  const r1 = JSON.parse(await ev('JSON.stringify(document.getElementById("shellTab").getBoundingClientRect())'));
  console.log(`  滚 300px 后底栏 top=${r1.top.toFixed(1)} bottom=${(r1.top + r1.height).toFixed(1)}`);
  ok(Math.abs(r1.top - r0.top) <= 0.5, `底栏 top 未变（差 ${Math.abs(r1.top - r0.top).toFixed(2)}px）`);
  ok(Math.abs((r1.top + r1.height) - VH) <= 1, '底栏仍贴视口底');

  await ev('document.getElementById("shellScroll").scrollTop = 99999');
  await sleep(350);
  const r2 = JSON.parse(await ev('JSON.stringify(document.getElementById("shellTab").getBoundingClientRect())'));
  ok(Math.abs(r2.top - r0.top) <= 0.5, `滚到底（${await ev('document.getElementById("shellScroll").scrollTop')}px）底栏依然不动`);

  // 最后一段内容是否被底栏压住
  const clear = await ev(`(function(){
    var s=document.getElementById('shellScroll'), t=document.getElementById('shellTab');
    var kids=[].slice.call(s.querySelectorAll('.app > *')).filter(function(e){return e.offsetHeight>0});
    if(!kids.length) return 'no-kids';
    var last=kids[kids.length-1].getBoundingClientRect();
    return (last.bottom <= t.getBoundingClientRect().top + 1) ? 'clear' : 'covered:'+(last.bottom-t.getBoundingClientRect().top).toFixed(0);
  })()`);
  ok(clear === 'clear', `滚到底时最后一块内容没有被底栏盖住（${clear}）`);

  console.log('\n===== 家长端 · 底栏外观 =====');
  const tabs = await ev('document.querySelectorAll("#shellTab .tab").length');
  ok(tabs === 4, `家长端 4 个 tab（实际 ${tabs}）`);
  ok(await ev('document.querySelectorAll("#shellTab .tab svg").length') === 4, '4 个 tab 都有 SVG 图标');
  const h = await ev('document.querySelector("#shellTab .tab").getBoundingClientRect().height');
  ok(h >= 48 && h <= 56, `底栏高度 ${h.toFixed(1)}px（微信约 49–52）`);
  ok(await ev('getComputedStyle(document.getElementById("shellTab")).backdropFilter') === 'none', '底栏已无 backdrop-filter（规避 WebKit #173250）');
  ok(await ev('getComputedStyle(document.querySelector(".topbar")).position') === 'relative', '顶栏不再用 sticky');
  ok(await ev('getComputedStyle(document.querySelector(".topbar")).backdropFilter') === 'none', '顶栏已无 backdrop-filter');
  await shot('.shot_shell_parent.png');

  console.log('\n===== 切 tab 是否回到顶部 =====');
  await ev('go("p-books")');
  await sleep(400);
  ok(await ev('document.getElementById("shellScroll").scrollTop') === 0, '切到资料库后滚动归零');
  ok(await ev('document.querySelectorAll("#shellTab .tab.on").length') === 1, '只有一个 tab 处于选中态');
  await shot('.shot_shell_books.png');

  console.log('\n===== 孩子端 · 同样壳结构 =====');
  await ev('S.role="child"; S.page="home"; render();');
  await sleep(500);
  const ct = await ev('document.querySelectorAll("#shellTab .tab").length');
  ok(ct === 5, `孩子端 5 个 tab（实际 ${ct}）`);
  const cr = JSON.parse(await ev('JSON.stringify(document.getElementById("shellTab").getBoundingClientRect())'));
  ok(Math.abs((cr.top + cr.height) - VH) <= 1, '孩子端底栏也贴视口底');
  await ev('document.getElementById("shellScroll").scrollTop = 400');
  await sleep(300);
  const cr2 = JSON.parse(await ev('JSON.stringify(document.getElementById("shellTab").getBoundingClientRect())'));
  ok(Math.abs(cr2.top - cr.top) <= 0.5, '孩子端滚动后底栏不动');
  await shot('.shot_shell_child.png');

  console.log('\n===== 计时页：底栏应隐藏 =====');
  await ev('S.page="timer"; render();');
  await sleep(400);
  ok(await ev('getComputedStyle(document.getElementById("shellTab")).display') === 'none', '计时页底栏隐藏');
  ok(await ev('!!document.querySelector(".timer-wrap")'), '计时页正常渲染');
  await shot('.shot_shell_timer.png');
  await ev('S.page="home"; render();');
  await sleep(300);
  ok(await ev('getComputedStyle(document.getElementById("shellTab")).display') !== 'none', '退出计时页底栏恢复');

  console.log('\n===== 运行期异常 =====');
  console.log(errors.length ? errors.join('\n') : '（无）');
  ok(errors.length === 0, '零运行时异常');

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  ws.close(); proc.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
