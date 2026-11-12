/**
 * 同步逻辑验证（纯本地，mock 云层，不碰线上数据）
 * 覆盖：家长端恢复作业清单 / 迁移保护 / 跨天不回写 / 只推脏行 / 家长端不覆盖积分
 */
const { spawn } = require('child_process');
const path = require('path');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9360;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}, sid) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  const errs = [];
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && d.exception.description) || d.text); } });
  await send('Page.navigate', { url: 'http://127.0.0.1:8150/index.html?t=' + Date.now() }, sessionId);
  await sleep(3500);
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  const pass = (n, ok, extra) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  ' + extra : ''));

  // 统一准备：解锁登录门
  await ev(`(function(){var g=document.getElementById('authGate');if(g)g.remove();document.body.classList.remove('auth-locked');})()`);

  const ITEMS = `[
    {id:'a1',subject:'语文',name:'抄第12课生字',type:'mech',est:15,status:'todo'},
    {id:'a2',subject:'语文',name:'写作文《难忘的一件事》',type:'think',est:40,status:'todo'},
    {id:'a3',subject:'数学',name:'练习册第32页',type:'think',est:20,status:'todo'}
  ]`;

  /* ---------- 1. 家长端：本地空清单，云端有清单 ---------- */
  console.log('\n=== 1. 家长端从云端恢复作业清单 ===');
  console.log(await ev(`(function(){
    var r = applyRemote({
      day: Cloud.today(),
      household: { plan_date: Cloud.today(), coins: 520, earned_today: 60, streak: 9,
                   family_code:'ABCDEF', child_name:'孩子', plan_items: ${ITEMS} },
      tasks: [
        {task_id:'it a1'.replace(' ',''), status:'done', evidence_type:'photo', evidence_path:'users/x/1.jpg'},
        {task_id:'ita3', status:'timeout'}
      ],
      books: [], redeems: []
    });
    var hw = SCHEDULE.filter(function(s){return s.kind==='hw';});
    return JSON.stringify({
      applyRemote返回: r,
      清单项数: (S.items||[]).length,
      时间轴作业块: hw.length,
      时间轴标题: hw.map(function(x){return x.title;}),
      a1已套完成: S.tasks['ita1'] ? S.tasks['ita1'].status : '缺失',
      a1凭证: S.tasks['ita1'] ? !!S.tasks['ita1'].evidencePath : false,
      a3状态: S.tasks['ita3'] ? S.tasks['ita3'].status : '缺失',
      币: S.coins, 连续: S.streak, 家庭码: S.familyCode
    }, null, 1);
  })()`));

  /* ---------- 2. 家长端不会因为拉取而启动推送 ---------- */
  console.log('\n=== 2. 拉取后待推队列应为空 ===');
  console.log(await ev(`JSON.stringify({dirty:Object.keys(S._dirty||{}).length, dirtyAll:S._dirtyAll, needPush:!!S._needPush})`));

  /* ---------- 3. 家长端退回：只推这一行，不动积分 ---------- */
  console.log('\n=== 3. 家长端点「退回」只推脏行 ===');
  console.log(await ev(`(async function(){
    window.__pushed=null; window.__house=null;
    var oldPush = Cloud.pushTasks, oldHouse = Cloud.pushHousehold;
    Cloud.pushTasks = async function(rows, day){ window.__pushed={count:rows.length, ids:rows.map(function(r){return r.task_id;}), status:rows.map(function(r){return r.status;})}; return true; };
    Cloud.pushHousehold = async function(row){ window.__house=row; return true; };
    S.role='parent'; S.synced=true;
    reworkTask('ita1');
    S._dirtyAll=false;
    await pushAll();
    Cloud.pushTasks=oldPush; Cloud.pushHousehold=oldHouse;
    return JSON.stringify({推送行数: window.__pushed && window.__pushed.count, 推送id: window.__pushed && window.__pushed.ids, 推送状态: window.__pushed && window.__pushed.status, 推送household: window.__house}, null, 1);
  })()`));

  /* ---------- 4. 迁移保护：孩子端本地有清单、云端为空 ---------- */
  console.log('\n=== 4. 迁移保护（孩子端本地清单不被空云端覆盖） ===');
  console.log(await ev(`(function(){
    S.role='child';
    S.items = ${ITEMS};
    S.planDate = Cloud.today();
    S.tasks = {};
    rebuildSchedule();
    applyRemote({
      day: Cloud.today(),
      household: { plan_date: Cloud.today(), coins:100, earned_today:0, streak:1, plan_items: [] },
      tasks: [], books: [], redeems: []
    });
    return JSON.stringify({
      清单仍保留: (S.items||[]).length,
      待补推: !!S._needPush,
      整份重推: !!S._dirtyAll
    }, null, 1);
  })()`));

  /* ---------- 5. 跨天：云端旧日，清展示但不回写 ---------- */
  console.log('\n=== 5. 跨天不污染云端 ===');
  console.log(await ev(`(function(){
    S.role='child'; S.items = ${ITEMS}; S.planDate = Cloud.today();
    S.tasks={}; rebuildSchedule();
    var oldPush = Cloud.pushHousehold;
    window.__wrote = false;
    Cloud.pushHousehold = async function(){ window.__wrote = true; return true; };
    applyRemote({
      day: Cloud.today(),
      household: { plan_date: '2026-10-30', coins:300, earned_today:80, streak:3, plan_items: ${ITEMS} },
      tasks: [{task_id:'ita1', status:'done'}], books: [], redeems: []
    });
    Cloud.pushHousehold = oldPush;
    return JSON.stringify({
      清单已清: (S.items||[]).length,
      回写过云端: window.__wrote,
      币保留: S.coins,
      旧任务未采纳: S.tasks['ita1'] ? S.tasks['ita1'].status : '缺失'
    }, null, 1);
  })()`));

  /* ---------- 6. 孩子端完成一项：只推这一行 ---------- */
  console.log('\n=== 6. 孩子端完成只推脏行 ===');
  console.log(await ev(`(async function(){
    S.role='child'; S.items = ${ITEMS}; S.tasks={}; rebuildSchedule();
    S.planDate = Cloud.today(); S.synced = true; S._dirtyAll=false; S._dirty={};
    window.__p2=null;
    var oldPush = Cloud.pushTasks, oldHouse = Cloud.pushHousehold, oldBooks = Cloud.pushBooks;
    Cloud.pushTasks = async function(rows){ window.__p2={count:rows.length, ids:rows.map(function(r){return r.task_id;})}; return true; };
    Cloud.pushHousehold = async function(){ return true; };
    Cloud.pushBooks = async function(){ return true; };
    completeTask('ita1', 'tell');
    await pushAll();
    Cloud.pushTasks=oldPush; Cloud.pushHousehold=oldHouse; Cloud.pushBooks=oldBooks;
    return JSON.stringify({推送行数: window.__p2 && window.__p2.count, 推送id: window.__p2 && window.__p2.ids, 队列已清: Object.keys(S._dirty||{}).length}, null, 1);
  })()`));

  console.log('\n=== 运行时异常 ===');
  console.log(errs.length ? errs.join('\n') : '无');

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
