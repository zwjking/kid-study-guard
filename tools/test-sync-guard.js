/**
 * v1.4.1 验证：同步故障修复 + 周日排程顺序
 * 用法: node tools/test-sync-guard.js <baseUrl>
 *
 * 背景：v1.4.0 给 household 加了四个宠物字段，云端没有对应列，
 * 整行更新被拒绝 → plan_date 卡在旧日期 → 每次同步被判「跨天」→
 * 孩子刚列的清单被反复清空。本测试盯住三件事：
 *   1) 云端日期落后时，本地今天的清单不能再被吞
 *   2) 真正的跨天仍然要清（不能把功能改死）
 *   3) 推送缺列时必须降级到核心字段
 * 另外验证周日排程「先作业、后计划」的顺序和收工时间口径。
 */
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8017/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9351;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✔' : '✘'} ${m}`); };

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--remote-debugging-port=' + PORT, '--window-size=414,900', 'about:blank'], { stdio: 'ignore' });

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
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
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
    if (r.exceptionDetails) return '[EX] ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  const open = async url => {
    await send('Page.navigate', { url }, sessionId);
    await sleep(3200);
    await ev('try{var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");}catch(e){}');
  };

  await send('Page.navigate', { url: BASE + '?p=sun' }, sessionId);
  await sleep(2500);
  await ev('try{localStorage.clear()}catch(e){}');
  await open(BASE + '?p=sun');

  console.log('\n===== A · 基础 =====');
  ok(await ev('window.APP_VERSION') === 'v1.4.1', `版本 = ${await ev('window.APP_VERSION')}`);
  ok(await ev('ACTIVE_PROFILE.key') === 'sun', '当前档位 = 周日');
  ok(await ev('DAY_START') === 840 && await ev('WRAP_LINE') === 1080, '周日时间窗 14:00–18:00');

  console.log('\n===== B · 周日排程：先作业，后计划 =====');
  await ev(`S.role='child'; S.synced=false; S.items=[
    {id:'i1',name:'数学练习册',type:'mech',subject:'数学',est:25,status:'todo'},
    {id:'i2',name:'语文抄写',type:'mech',subject:'语文',est:20,status:'todo'},
    {id:'i3',name:'英语单词',type:'mem',subject:'英语',est:15,status:'todo'}
  ]; rebuildSchedule(); render();`);
  const kinds = await ev('SCHEDULE.map(s=>s.kind).join(",")');
  ok(kinds.indexOf('hw') > 0, `排程含作业块：${kinds}`);
  const hwLast = await ev('(function(){var m=-1;SCHEDULE.forEach(function(s,i){if(s.kind==="hw")m=i});return m})()');
  const reviewFirst = await ev('(function(){var m=-1;SCHEDULE.forEach(function(s,i){if(s.kind==="review"&&m<0)m=i});return m})()');
  ok(hwLast >= 0 && reviewFirst > hwLast, `所有作业排在复盘之前（最后作业 #${hwLast} < 复盘 #${reviewFirst}）`);
  ok(await ev('SCHEDULE[0].kind') === 'ritual', '第一块是启动仪式');
  const hwItems = await ev('Array.from(new Set(SCHEDULE.filter(s=>s.kind==="hw").map(s=>s.itemId))).length');
  ok(hwItems === 3, `三项作业全部进时间轴（拆块后仍归为 ${hwItems} 项）`);
  ok(await ev('SCHEDULE[SCHEDULE.length-1].kind') === 'buffer', '末块是机动缓冲');
  const firstHw = await ev('SCHEDULE.find(s=>s.kind==="hw").start');
  ok(firstHw >= 850, `作业不早于 14:10 开始（实际 ${firstHw} 分）`);

  console.log('\n===== C · 云端日期落后，本地今天的清单不能被吞（本次故障） =====');
  const keep = await ev(`(function(){
    S.role='child'; S.planDate=Cloud.today();
    S.items=[{id:'i1',name:'数学练习册',type:'mech',subject:'数学',est:25,status:'todo'}];
    rebuildSchedule();
    var before=S.items.length;
    applyRemote({day:Cloud.today(), household:{plan_date:'2026-11-07', coins:200, plan_items:[]},
                 tasks:[], books:[], redeems:[]});
    return before+'|'+S.items.length+'|'+S.planDate;
  })()`);
  const [b1, a1] = String(keep).split('|');
  ok(b1 === '1' && a1 === '1', `云端 plan_date 落后时清单保留（${b1} → ${a1}）`);
  ok(String(keep).split('|')[2] === await ev('Cloud.today()'), '本地 planDate 仍是今天');
  ok(await ev('S._needPush') === true, '标记了补推，会把云端日期追平');

  console.log('\n===== D · 真正的跨天仍然要清（不能改死功能） =====');
  const clear = await ev(`(function(){
    S.role='child'; S.planDate='2026-11-07';
    S.items=[{id:'i1',name:'数学练习册',type:'mech',subject:'数学',est:25,status:'todo'}];
    rebuildSchedule();
    var before=S.items.length;
    applyRemote({day:Cloud.today(), household:{plan_date:'2026-11-07', coins:200, plan_items:[]},
                 tasks:[], books:[], redeems:[]});
    return before+'|'+S.items.length;
  })()`);
  const [b2, a2] = String(clear).split('|');
  ok(b2 === '1' && a2 === '0', `本地也在旧日期时正常清空（${b2} → ${a2}）`);

  console.log('\n===== E · 推送缺列降级 =====');
  ok(await ev('typeof Cloud.__pickCore') === 'function', '降级函数已挂出');
  const core = await ev(`JSON.stringify(Cloud.__pickCore({coins:1, plan_date:'x', plan_items:[], pet:{a:1}, pet_bag:{}, pet_own:[], pet_grave:[]}))`);
  ok(core.indexOf('pet') < 0, '核心字段里剔除了宠物字段');
  ok(core.indexOf('"coins":1') >= 0 && core.indexOf('plan_date') >= 0, '核心字段保留了积分与日期');
  ok(await ev(`Cloud.__isMissingColumn({message:"Could not find the 'pet' column of 'household' in the schema cache", code:"PGRST204"})`) === true, '识别缺列错误');
  ok(await ev(`Cloud.__isMissingColumn({message:"permission denied"})`) === false, '普通错误不误判为缺列');

  console.log('\n===== H · 今天的半截记录不能进历史 =====');
  const todaySnap = await ev(`(function(){
    S.role='child'; S.planDate=Cloud.today();
    S.items=[{id:'i1',name:'数学练习册',type:'mech',subject:'数学',est:25,status:'todo'}];
    rebuildSchedule();
    S.practice={done:true,date:Cloud.today()};
    S.history=[];
    archiveDaySnapshot();
    return S.history.length;
  })()`);
  ok(todaySnap === 0, `今天不归档（history 条数 ${todaySnap}）`);

  const yestSnap = await ev(`(function(){
    S.planDate='2026-11-07';
    S.practice={done:true,date:'2026-11-07'};
    S.history=[];
    archiveDaySnapshot();
    return S.history.length;
  })()`);
  ok(yestSnap === 1, `往日正常归档（history 条数 ${yestSnap}）`);

  console.log('\n===== F · 周日文案口径 =====');
  await ev(`S.role='child'; S.page='home'; S.planDate=Cloud.today();
    S.items=Array.from({length:9},(_,i)=>({id:'x'+i,name:'作业'+i,type:'mech',subject:'语文',est:30,status:'todo'}));
    rebuildSchedule(); render();`);
  const txt = await ev('document.body.innerText');
  ok(txt.indexOf('18:00') >= 0, '超时提示按 18:00 算收工');
  ok(txt.indexOf('比 21:00 晚') < 0, '不再出现写死的 21:00');
  ok(txt.indexOf('今晚') < 0 || txt.indexOf('今天下午') >= 0, '周日用「今天下午」措辞');

  console.log('\n===== G · 运行时异常 =====');
  ok(errors.length === 0, `零运行时异常${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
