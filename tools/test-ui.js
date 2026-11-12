/**
 * 本地 UI 实测：跳过登录门，检查真实模式/演示模式的时间行为
 * 用法: node tools/test-ui.js <baseUrl>
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--remote-debugging-port=' + PORT, '--window-size=430,932', 'about:blank'], { stdio: 'ignore' });

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
  const text = async () => ev('(document.body.innerText||"").replace(/\\n{2,}/g,"\\n").slice(0,700)');
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(name, Buffer.from(r.data, 'base64'));
    console.log('  截图 →', name);
  };

  /* ---------- 场景 A：真实模式，当前真实时间已过 21:30 ---------- */
  await send('Page.navigate', { url: BASE }, sessionId);
  await sleep(3000);
  console.log('\n===== A · 真实模式（现在 ' + new Date().toTimeString().slice(0, 5) + '） =====');
  console.log('DEMO =', await ev('typeof DEMO !== "undefined" ? DEMO : "未定义"'));
  console.log('nowMin() =', await ev('typeof nowMin === "function" ? nowMin() : "无"'));
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  console.log('render 结果 =', await ev('(function(){try{render();return "ok, #app 长度="+(document.getElementById("app").innerHTML||"").length;}catch(e){return "抛错: "+e.message+" @ "+String(e.stack).split("\\n")[1];}})()'));
  await sleep(400);
  console.log('--- 首屏文本 ---');
  console.log(await text());
  await shot('.shot_a_afterhours.png');

  /* ---------- 场景 A2：点"继续补"后回到时间轴 ---------- */
  console.log('\n===== A2 · 点「确实没做完，继续补」 =====');
  await ev('allowAfterHours()');
  await sleep(400);
  console.log('S.afterHours =', await ev('S.afterHours'));
  console.log('--- 文本 ---');
  console.log((await text()).slice(0, 300));
  await shot('.shot_a2_continue.png');

  /* ---------- 场景 B：计时器是否按真实秒走 ---------- */
  console.log('\n===== B · 计时器真实走秒（4 秒观察） =====');
  console.log('speed 当前值 =', await ev('S.speed'));
  const before = await ev('startTimer(SCHEDULE[1]); T.left');
  await sleep(4200);
  const after = await ev('T.left');
  console.log(`T.left 起始=${before}，4.2 秒后=${after}，实际减少 ${before - after} 秒`);
  console.log(before - after <= 6 ? '  ✔ 按真实秒走（约 4 秒）' : '  ✘ 仍在加速！');
  await shot('.shot_b_timer.png');
  await ev('stopTimer(); S.page="home"; render();');

  /* ---------- 场景 C：演示模式 ---------- */
  console.log('\n===== C · 演示模式 ?demo=1 =====');
  await send('Page.navigate', { url: BASE + '?demo=1' }, sessionId);
  await sleep(3000);
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  console.log('render 结果 =', await ev('(function(){try{render();return "ok, #app 长度="+(document.getElementById("app").innerHTML||"").length;}catch(e){return "抛错: "+e.message+" @ "+String(e.stack).split("\\n")[1];}})()'));
  await sleep(400);
  console.log('DEMO =', await ev('DEMO'), '| speed =', await ev('S.speed'), '| 顶部时钟 =', await ev('document.querySelector(".clock-box").innerText.replace(/\\n/g," ")'));
  console.log('--- 首屏文本 ---');
  console.log((await text()).slice(0, 400));
  await shot('.shot_c_demo.png');

  console.log('\n===== 运行期异常 =====');
  console.log(errors.length ? errors.join('\n') : '（无）');

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
