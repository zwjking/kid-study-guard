/**
 * 线上端到端同步验证
 * A 端（孩子）推作业清单 → B 端（家长，全新会话）拉取 → 验证能看到
 * 只动 household.plan_items，任务行、积分原值回写，测完清空 plan_items
 */
const { spawn } = require('child_process');
const path = require('path');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL = 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE&role=child';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mkPage(port, idx) {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + port,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'sg-' + port + '-' + Date.now()), 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch (e) {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}, sid) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: URL }, sessionId);
  await sleep(9000);
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  return { proc, ws, ev, send, sessionId };
}

(async () => {
  console.log('== A 端：孩子端，真实登录并推送作业清单 ==');
  const A = await mkPage(9361);
  console.log(await A.ev(`(async function(){
    var r = await Cloud.signIn('zwjking@126.com','123456');
    if(!r.ok) return 'login fail: '+r.msg;
    var before = await Cloud.pull();
    window.__snap = before && before.household;
    return JSON.stringify({ok:true, 原清单项:(before.household.plan_items||[]).length, 原任务数:(before.tasks||[]).length, 原币:before.household.coins});
  })()`));

  console.log(A.ev(`(async function(){
    var h = window.__snap;
    var items = [
      {id:'zz1',subject:'语文',name:'【自测】抄写生字',type:'mech',est:15,status:'todo'},
      {id:'zz2',subject:'语文',name:'【自测】写作文',type:'think',est:40,status:'todo'},
      {id:'zz3',subject:'数学',name:'【自测】练习册第32页',type:'think',est:20,status:'todo'}
    ];
    var ok = await Cloud.pushHousehold({
      child_name: h.child_name, family_code: h.family_code,
      coins: h.coins, earned_today: h.earned_today, streak: h.streak,
      bonus_cleared: h.bonus_cleared, plan_date: h.plan_date,
      plan_items: items
    });
    return 'pushHousehold -> ' + ok;
  })()`));

  console.log('   校验云端已写入:');
  console.log(await A.ev(`(async function(){
    var p = await Cloud.pull();
    return JSON.stringify({清单项:(p.household.plan_items||[]).length, 名称:(p.household.plan_items||[]).map(function(i){return i.name;})});
  })()`));

  console.log('\n== B 端：家长端，全新会话（无本地存档）拉取 ==');
  const B = await mkPage(9362);
  console.log(await B.ev(`(async function(){
    try { localStorage.clear(); } catch(e){}
    var r = await Cloud.signIn('zwjking@126.com','123456');
    if(!r.ok) return 'login fail: '+r.msg;
    var remote = await Cloud.pull();
    applyRemote(remote);
    S.role='parent'; S.page='p-review'; render();
    var hw = SCHEDULE.filter(function(s){return s.kind==='hw';});
    var html = document.getElementById('app').innerHTML;
    return JSON.stringify({
      拉到清单项:(S.items||[]).length,
      时间轴作业块:hw.length,
      块标题:hw.map(function(x){return x.title;}),
      页面含自测作文: html.indexOf('【自测】写作文')>=0,
      页面含自测生字: html.indexOf('【自测】抄写生字')>=0,
      待推队列:Object.keys(S._dirty||{}).length
    }, null, 1);
  })()`));

  console.log('\n== 清理：恢复 household 原值，plan_items 置空 ==');
  console.log(await A.ev(`(async function(){
    var h = window.__snap;
    var ok = await Cloud.pushHousehold({
      child_name: h.child_name, family_code: h.family_code,
      coins: h.coins, earned_today: h.earned_today, streak: h.streak,
      bonus_cleared: h.bonus_cleared, plan_date: h.plan_date,
      plan_items: []
    });
    var p = await Cloud.pull();
    return JSON.stringify({恢复: ok, 现有清单项:(p.household.plan_items||[]).length, 币:p.household.coins, 任务数:(p.tasks||[]).length});
  })()`));

  A.ws.close(); A.proc.kill();
  B.ws.close(); B.proc.kill();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
