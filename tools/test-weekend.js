/**
 * v1.2.9 验证：周末双模板 + 周六自主计划 + 家长端往日
 * 用法: node tools/test-weekend.js <baseUrl>
 *
 * 今天跑测试的日子不一定是周六，所以用 PROFILE_OVERRIDE 强制指定星期，
 * 逐个验三套时间窗；PROFILE_OVERRIDE 在正式运行里恒为 null。
 */
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9341;
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
    if (r.exceptionDetails) return '[异常] ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const setProfile = async k => {
    await ev(`PROFILE_OVERRIDE=${k ? `'${k}'` : 'null'}; S._profileKey=null; render();`);
    await sleep(260);
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  await send('Page.navigate', { url: BASE }, sessionId);
  await sleep(3200);

  // 干净起点：清存档后重载，避免上一次测试留下的清单干扰
  await ev('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url: BASE }, sessionId);
  await sleep(3000);
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');

  console.log('\n===== A · 周六：自己设计的一天 =====');
  await ev('S.role="child"; S.page="home";');
  await setProfile('sat');

  ok(await ev('window.APP_VERSION') === 'v1.4.1', `版本 = ${await ev('window.APP_VERSION')}`);
  ok(await ev('DAY_START') === 570, `周六起点 09:30（${await ev('DAY_START')} 分）`);
  ok(await ev('ACTIVE_PROFILE.key') === 'sat', '当前档位 = sat');
  ok(await ev('!!document.querySelector(".sat-hero")'), '首页出现「我的周六」');
  ok(await ev('document.querySelector(".sat-hero").textContent.includes("没有固定清单")'), '顶卡写明今天没有固定清单');
  ok(await ev('!document.querySelector(".tl")'), '周六不渲染时间轴（不排几点做）');
  ok(await ev('!document.querySelector(".grids")'), '周六不显示四格进度');

  const earn0 = await ev('S.earnedToday');
  ok(await ev("addSatItem('骑车','play')") === true, '可以自己加一项');
  await sleep(200);
  ok(await ev('satPlan().items.length') === 1, '清单多了一条');
  ok(await ev('S.earnedToday') === earn0, '加计划不加分（积分未变）');
  ok(await ev("addSatItem('骑车','play')") === false, '重复添加被挡住');
  ok(await ev("addSatItem('   ','play')") === false, '空白内容被挡住');

  const iid = await ev('satPlan().items[0].id');
  await ev(`toggleSatItem('${iid}')`);
  await sleep(200);
  ok(await ev('satPlan().items[0].done') === true, '打勾生效');
  ok(await ev('S.earnedToday') === earn0, '打勾也不加分（玩不是打工）');
  ok(await ev('document.querySelector(".sat-hero").classList.contains("full")'), '全部做完时顶卡换成完成态');
  ok(await ev('document.querySelector(".sat-num").textContent.includes("1")'), '顶卡数字跟着变');

  await ev("addSatIdea('拼乐高','play')");
  await sleep(150);
  ok(await ev('satPlan().items.length') === 2, '点灵感 chip 也能加进去');

  for (let i = 0; i < 15; i++) await ev(`addSatItem('测试项${i}','other')`);
  await sleep(200);
  ok(await ev('satPlan().items.length') === 12, `上限 12 条（实际 ${await ev('satPlan().items.length')}）`);

  ok(await ev('buildTaskRows().length') === 0, '周六不往云端推任何任务行');
  ok(await ev('typeof satSummaryHTML') === 'function', '家长端可读的周六摘要函数存在');

  await ev(`delSatItem('${iid}')`);
  await sleep(150);
  ok(await ev('satPlan().items.length') === 11, '可以删掉不想要的');

  console.log('\n===== B · 周日：下午两点到六点 =====');
  await ev('S.role="child"; S.page="home";');
  await setProfile('sun');

  ok(await ev('DAY_START') === 840, `周日起点 14:00（${await ev('DAY_START')} 分）`);
  ok(await ev('WRAP_LINE') === 1080, `周日收工线 18:00（${await ev('WRAP_LINE')} 分）`);
  ok(await ev('SCHEDULE[0].start') === 840, '时间轴第一块从 14:00 开始');
  ok(await ev('SCHEDULE.some(s=>s.kind==="read")'), '有自由阅读块');
  ok(await ev('SCHEDULE.some(s=>s.id==="tidyup")'), '有整理书包收心块');
  ok(await ev('SCHEDULE.some(s=>s.kind==="buffer")'), '有机动缓冲块');
  ok(await ev('!SCHEDULE.some(s=>s.id==="wrapup")'), '不再出现工作日的收工仪式');
  ok(await ev('SCHEDULE.find(s=>s.id==="review").dur') === 25, '复盘从 8 分钟延长到 25 分钟');
  ok(await ev('SCHEDULE.find(s=>s.id==="preview").dur') === 25, '预习从 5 分钟延长到 25 分钟');
  ok(await ev('(function(){var s=SCHEDULE.find(x=>x.id==="preview");return s.title.includes("下周")&&!s.desc.includes("明早 7:50")})()'), '预习改成「下周」，不再说「明早 7:50」');
  ok(await ev('SCHEDULE.some(s=>s.id==="practice")'), '课外练习照常派');
  ok(await ev('!document.querySelector(".sat-hero")'), '周日不是自主计划页');

  const last = await ev('JSON.stringify(SCHEDULE[SCHEDULE.length-1])');
  const lastB = JSON.parse(last);
  ok(lastB.kind === 'buffer', '最后一块是机动缓冲');
  ok(lastB.start + lastB.dur <= 1080 + 5, `空作业时收工 ${Math.floor((lastB.start + lastB.dur) / 60)}:${String((lastB.start + lastB.dur) % 60).padStart(2, '0')}，不晚于 18:00`);

  // 作业只排进去 50 分钟：验证书面作业占比不超政策口径
  await ev('S.items=[{id:1,name:"抄写",subject:"语文",type:"mech",est:"mid",status:"todo",dur:20},{id:2,name:"应用题",subject:"数学",type:"think",est:"long",status:"todo",dur:25}]');
  await ev('rebuildSchedule(); render();');
  await sleep(260);
  const hw = await ev('SCHEDULE.filter(s=>s.kind==="hw").reduce((a,s)=>a+s.dur,0)');
  ok(hw <= 60, `书面作业合计 ${hw} 分钟，符合小学高年级不超 60 分钟的口径`);
  const withHw = JSON.parse(await ev('JSON.stringify(SCHEDULE[SCHEDULE.length-1])'));
  ok(withHw.start + withHw.dur <= 1150, `有作业时收工 ${Math.floor((withHw.start + withHw.dur) / 60)}:${String((withHw.start + withHw.dur) % 60).padStart(2, '0')}，缓冲仍在 18:00 附近`);

  console.log('\n===== C · 工作日：还是晚上那一套 =====');
  await ev('S.role="child"; S.page="home"; S.items=[];');
  await setProfile('week');

  ok(await ev('DAY_START') === 1140, `工作日起点 19:00（${await ev('DAY_START')} 分）`);
  ok(await ev('WRAP_LINE') === 1260, `工作日收工线 21:00（${await ev('WRAP_LINE')} 分）`);
  ok(await ev('SCHEDULE.some(s=>s.id==="wrapup")'), '工作日照旧有收工仪式');
  ok(await ev('SCHEDULE.find(s=>s.id==="review").dur') === 8, '工作日复盘仍是 8 分钟');
  ok(await ev('SCHEDULE.find(s=>s.id==="preview").dur') === 5, '工作日预习仍是 5 分钟');
  ok(await ev('!SCHEDULE.some(s=>s.kind==="buffer")'), '工作日没有机动缓冲');
  ok(await ev('!SCHEDULE.some(s=>s.kind==="read")'), '工作日没有自由阅读块');
  ok(await ev('buildTaskRows().length > 0'), '工作日正常推任务行');

  console.log('\n===== D · 家长端往日 =====');
  await ev('S.role="parent"; S.page="p-home"; render();');
  await sleep(300);
  ok(await ev('document.querySelectorAll("#shellTab .tab").length') === 4, `家长端底栏 4 项（实际 ${await ev('document.querySelectorAll("#shellTab .tab").length')}）`);
  ok(await ev('document.body.textContent.includes("往日")'), '底栏有「往日」入口');
  ok(await ev('document.body.textContent.includes("看昨天的完成情况")'), '看板里有往日快捷入口');

  await ev('go("p-history")');
  await sleep(600);
  ok(await ev('S.page') === 'p-history', '能进往日页');
  ok(await ev('typeof Cloud.pullTasksByDate') === 'function', '云端已具备按日期查询');
  ok(await ev('!!HIST.date'), `默认落在昨天（${await ev('HIST.date')}）`);
  const yes = await ev('histDateStr(1)');
  const yest = new Date(Date.now() - 86400000);
  const ymd = yest.getFullYear() + '-' + String(yest.getMonth() + 1).padStart(2, '0') + '-' + String(yest.getDate()).padStart(2, '0');
  ok(yes === ymd, `昨天日期按本地时区算（${yes} = ${ymd}）`);
  ok(await ev('!!document.querySelector(".hist-nav")'), '有前一天/后一天翻页');
  ok(await ev('document.body.textContent.includes("往回 1 天")'), '翻页位置有提示');
  ok(await ev('histDateStr(0) !== histDateStr(1)'), '今天和昨天不是同一天');

  // 翻到前一天再翻回来，确认 offset 有界
  await ev('HIST.offset=30; histOpen(31)');
  await sleep(300);
  ok(await ev('HIST.offset') <= 30, `往回最多 30 天（当前 ${await ev('HIST.offset')}）`);

  /* 云端拉不到时不能一片空白：本机有快照就回退显示 */
  const fb = await ev(`(function(){
    var d = histDateStr(2);
    S.history=[{date:d, items:[], tasks:{
      'review':{title:'复习 · 合书复述', kind:'review', status:'done', evidence:null},
      'preview':{title:'预习 · 标 3 处不懂', kind:'preview', status:'todo', evidence:null}
    }}];
    HIST.date=d; HIST.offset=2; HIST.rows=[]; HIST.loading=false; HIST.err=false;
    render();
    return document.body.textContent;
  })()`);
  ok(fb.includes('来自本机记录'), '云端没数据时回退到本机快照');
  ok(fb.includes('复习 · 合书复述'), '回退后能看到那天做了什么');
  ok(await ev('document.querySelectorAll(".p-row").length') >= 2, '回退后明细行不是空的');
  ok(await ev('!!document.querySelector(".hist-pct")'), '完成率有独立的大号数字位');

  console.log('\n===== E · 归档：昨天不能凭空消失 =====');
  await ev('S.role="parent"; S.page="p-home";');
  const arch = await ev(`(function(){
    var t=new Date(Date.now()-86400000);
    S.planDate=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');
    S.items=[{id:1,name:'抄写',subject:'语文',type:'mech'}];
    S.tasks=Object.create(null);
    S.tasks['review']={status:'done',evidence:'photo',evidencePath:'u/x.jpg',evidenceMime:'image/jpeg',evidenceAt:Date.now()};
    S.practice={date:S.planDate,done:true,right:12,total:15,answers:[],idx:15};
    S.satPlan={date:S.planDate,items:[{id:'a',text:'骑车',tag:'play',done:true}]};
    archiveDaySnapshot();
    var h=(S.history||[]).find(function(x){return x.date===S.planDate});
    return h ? JSON.stringify({items:h.items.length,tasks:Object.keys(h.tasks).length,prac:h.practice&&h.practice.right,sat:h.satPlan&&h.satPlan.items.length}) : 'none';
  })()`);
  const a = JSON.parse(arch);
  ok(a.items === 1, '归档带上当天作业清单');
  ok(a.tasks >= 1, `归档带上任务状态（${a.tasks} 项）`);
  ok(a.prac === 12, '归档带上练习成绩（云端没存这项）');
  ok(a.sat === 1, '归档带上周六清单');
  ok(await ev('S.history.length') >= 1, '历史数组有记录');

  await ev('S.history=[]; S.tasks={}; S.practice=null; S.satPlan=null; archiveDaySnapshot();');
  ok(await ev('S.history.length') === 0, '当天什么都没做就不占历史坑位');

  console.log('\n===== F · 运行时异常 =====');
  await ev('PROFILE_OVERRIDE=null; S._profileKey=null; render();');
  await sleep(300);
  ok(errors.length === 0, `零运行时异常（${errors.length} 个）`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('    !', String(e).split('\n')[0]));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试自身出错:', e); process.exit(1); });
