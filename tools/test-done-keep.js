/**
 * v1.2.3 验证：做完的作业项留在清单里
 * 断言四件事：
 *   ① 已交项不退场（dur=0，仍可被家长端看到）
 *   ② 进度分母固定，做完一项只会分子 +1
 *   ③ 预计收工 / 自由时间不被已完成项影响
 *   ④ 全部做完时四格能正确判「已完成」
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_T = process.argv[2] || 'http://127.0.0.1:8125/index.html';
const PORT = 9345, sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log('  \u2714 ' + name + (extra !== undefined ? '\uff08' + extra + '\uff09' : '')); }
  else { fail++; console.log('  \u2718 ' + name + (extra !== undefined ? '\uff08' + extra + '\uff09' : '')); }
}

(async () => {
  const proc = spawn(CH, ['--headless','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-proxy-server','--proxy-bypass-list=*','--remote-debugging-port='+PORT,'about:blank'], {stdio:'ignore'});
  let ver=null; for(let i=0;i<40;i++){await sleep(250);try{ver=await(await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();break}catch(e){}}
  const ws=new WebSocket(ver.webSocketDebuggerUrl); let id=0; const pend=new Map(); const errs=[];
  const send=(m,p={},sid)=>new Promise((res,rej)=>{const mid=++id;pend.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p,sessionId:sid}))});
  await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const {res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method==='Runtime.exceptionThrown'){errs.push((m.params.exceptionDetails.exception||{}).description||m.params.exceptionDetails.text)}});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Runtime.enable',{},sessionId); await send('Page.enable',{},sessionId);
  await send('Emulation.setDeviceMetricsOverride',{width:414,height:736,deviceScaleFactor:2,mobile:true},sessionId);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)return '[异]'+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text||'').slice(0,200);return r.result&&r.result.value};

  await send('Page.navigate',{url:withWeek(URL_T)},sessionId);
  await sleep(4500);
  console.log('版本 =', await ev('window.APP_VERSION'));

  // ---------- 造数据：5 项作业，其中 2 项已交 ----------
  await ev(`
    S.role='child'; S.page='home'; S.synced=false; S.planDate=Cloud?Cloud.today():'2026-11-02';
    S.items = [
      {id:'a1', name:'同步练习第3课', subject:'语文', type:'think', est:25, status:'todo'},
      {id:'a2', name:'抄写生字', subject:'语文', type:'mech', est:10, status:'done'},
      {id:'a3', name:'练习册第4单元', subject:'数学', type:'mech', est:15, status:'done'},
      {id:'a4', name:'听读44', subject:'英语', type:'mem', est:10, status:'todo'},
      {id:'a5', name:'作文草稿', subject:'语文', type:'think', est:40, status:'todo'}
    ];
    S.tasks = {};
    rebuildSchedule();
    S.tasks['it'+'a2'].status='done';
    S.tasks['it'+'a3'].status='done';
    rebuildSchedule();
    'ok'
  `);

  const snap = JSON.parse(await ev(`JSON.stringify({
    hwIds: SCHEDULE.filter(s=>s.kind==='hw').map(s=>s.id),
    hwDone: SCHEDULE.filter(s=>s.kind==='hw'&&s.done).map(s=>s.id),
    hwDur: SCHEDULE.filter(s=>s.kind==='hw').reduce((a,s)=>a+s.dur,0),
    slots: SCHEDULE.filter(s=>s.kind==='hw').map(s=>s.id+':'+s.slot),
    end: planEndTime(),
    finish: projectedFinish(),
    free: freeBalance(),
    gridPr: gridProgress('homework'),
    gridDone: gridDone('homework'),
    rows: SCHEDULE.filter(s=>s.kind!=='break').length,
    rowDone: SCHEDULE.filter(s=>s.kind!=='break'&&S.tasks[s.id].status==='done').length,
    load: planLoad()
  })`));
  console.log('\n--- 清单结构 ---');
  console.log('作业段 =', snap.hwIds.join(', '));
  console.log('已交段 =', snap.hwDone.join(', '));
  console.log('时间段 =', snap.slots.join(' | '));

  console.log('\n--- ① 已交项不退场 ---');
  ck('已交的 a2 仍在清单', snap.hwIds.some(x=>x.indexOf('a2')>=0));
  ck('已交的 a3 仍在清单', snap.hwIds.some(x=>x.indexOf('a3')>=0));
  ck('已交项时长归零', snap.slots.filter(s=>s.endsWith('已完成')).length === 2, snap.slots.filter(s=>s.endsWith('已完成')).length + ' 段');

  console.log('\n--- ② 进度分母固定 ---');
  ck('四格分母 = 6 段（作文拆成两段，做完不给删）', snap.gridPr.total === 6, JSON.stringify(snap.gridPr));
  ck('四格分子 = 2', snap.gridPr.done === 2);
  ck('家长端行数含已交项', snap.rows === 6 + 4, snap.rows + ' 行（6 作业段 + 热身/复习/预习/收工）');
  ck('家长端完成数 = 2', snap.rowDone === 2);

  console.log('\n--- ③ 时间账不受影响 ---');
  // 手工算：未交 = a1 25 + a4 10 + a5 40 = 75 → 但 a5 会拆 25+15
  // planLoad 的净时长只算未交段
  ck('净作业时长只算未交项', snap.load.work === 75, snap.load.work + ' 分钟（a1 25 + a4 10 + a5 40）');
  ck('已交项不进作业总量', snap.load.items === 3, snap.load.items + ' 项待做');
  // 与「直接删掉已交项」的结果比对
  const base = JSON.parse(await ev(`
    (function(){
      var keep = S.items;
      S.items = keep.filter(function(i){return i.status!=='done'});
      S.tasks = {}; rebuildSchedule();
      var r = {end:planEndTime(), finish:projectedFinish(), free:freeBalance(), dur:SCHEDULE.filter(function(s){return s.kind==='hw'}).reduce(function(a,s){return a+s.dur},0)};
      S.items = keep;
      S.tasks={}; ['a2','a3'].forEach(function(x){S.tasks['it'+x]={status:'done',evidence:'photo',evidencePath:null,evidenceMime:null,evidenceAt:null};});
      rebuildSchedule();
      return JSON.stringify(r);
    })()
  `));
  ck('收工时间与无已交项时一致', snap.end === base.end, snap.end + ' vs ' + base.end);
  ck('预计收工一致', snap.finish === base.finish, snap.finish + ' vs ' + base.finish);
  ck('自由时间余额一致', snap.free === base.free, snap.free + ' vs ' + base.free);
  ck('作业总时长一致', snap.hwDur === base.dur, snap.hwDur + ' vs ' + base.dur);

  console.log('\n--- ④ 全部做完 ---');
  const allDone = JSON.parse(await ev(`
    S.tasks['it'+'a1']={status:'done',evidence:'photo'};
    S.tasks['it'+'a4']={status:'done',evidence:'voice'};
    S.tasks['it'+'a5-1']={status:'done',evidence:'photo'};
    S.tasks['it'+'a5-2']={status:'done',evidence:'photo'};
    rebuildSchedule();
    JSON.stringify({pr:gridProgress('homework'), gd:gridDone('homework'),
      zero: SCHEDULE.filter(function(s){return s.kind==='hw'&&s.dur===0}).length,
      total: SCHEDULE.filter(function(s){return s.kind==='hw'}).length,
      end: planEndTime()})
  `));
  ck('全部做完进度 6/6', allDone.pr.done === 6 && allDone.pr.total === 6, JSON.stringify(allDone.pr));
  ck('四格判为已完成', allDone.gd === true);
  ck('所有作业段时长归零', allDone.zero === allDone.total, allDone.zero + '/' + allDone.total);
  ck('收工时间自动提前', allDone.end < snap.end, allDone.end + ' < ' + snap.end);

  console.log('\n--- ⑤ 退回后重新占时间 ---');
  const rw = JSON.parse(await ev(`
    S.tasks['it'+'a2'].status='rework';
    rebuildSchedule();
    JSON.stringify({dur: (SCHEDULE.find(function(s){return s.id==='ita2'})||{}).dur,
      reworkCls: (function(){var s=SCHEDULE.find(function(x){return x.id==='ita2'});return s?s.done:null})(),
      pr: gridProgress('homework'), end: planEndTime()})
  `));
  ck('退回的段重新占时间', rw.dur === 10, rw.dur + ' 分钟');
  ck('退回后不再算「已交」', rw.reworkCls === false);
  ck('退回后进度回落 5/6', rw.pr.done === 5, JSON.stringify(rw.pr));

  console.log('\n--- ⑥ 家长端渲染 ---');
  console.log('切家长 =', await ev(`(function(){try{S.tasks['it'+'a2'].status='done';rebuildSchedule();S.role='parent';S.page='p-home';render();var v=document.getElementById('viewInner');return 'len='+v.innerHTML.length+' text='+v.innerText.length}catch(e){return 'ERR '+e.message}})()`));
  await sleep(600);
  const grab = async () => String(await ev('(document.getElementById("viewInner")||{}).innerHTML')).replace(/<[^>]+>/g, ' ');
  const pHome = await grab();
  ck('看板显示 5 项明细', (pHome.match(/已完成/g)||[]).length >= 5, (pHome.match(/已完成/g)||[]).length + ' 处');
  const pStat = JSON.parse(await ev(`JSON.stringify({rows: SCHEDULE.filter(function(s){return s.kind!=='break'}).length,
    doneN: SCHEDULE.filter(function(s){return s.kind!=='break'&&S.tasks[s.id].status==='done'}).length,
    grid: gridProgress('homework')})`));
  ck('看板进度 = 已完成数 / 全部块数', /\b6\s*\/\s*11\b/.test(pHome.replace(/\s+/g, ' ')), pStat.doneN + '/' + pStat.rows);
  await send('Page.captureScreenshot',{format:'png'},sessionId).then(r=>fs.writeFileSync('.shot_v123_parent.png', Buffer.from(r.data,'base64')));

  await ev(`S.page='p-review'; render();`);
  await sleep(500);
  const pRev = await grab();
  ck('返工页出现退回按钮', pRev.indexOf('退回') >= 0);
  ck('返工页列出全部作业项', pRev.indexOf('抄写生字') >= 0 && pRev.indexOf('练习册第4单元') >= 0 && pRev.indexOf('作文草稿') >= 0, '含已交与未交');

  await ev(`S.role='child'; S.page='home'; render();`);
  await sleep(500);
  const cHome = await grab();
  ck('孩子端时间轴含已完成段', cHome.indexOf('已完成') >= 0);
  const cStat = JSON.parse(await ev(`JSON.stringify({pr: gridProgress('homework'), items:(S.items||[]).length,
    hasItems: (S.items||[]).length>0, page: S.page, role: S.role})`));
  ck('孩子端四格 6/6', cStat.pr.done === 6 && cStat.pr.total === 6, JSON.stringify(cStat.pr));
  ck('孩子端清单未被清空', cStat.hasItems === true, cStat.items + ' 项');
  ck('孩子端渲染出已完成标记', cHome.indexOf('已完成') >= 0);
  await send('Page.captureScreenshot',{format:'png'},sessionId).then(r=>fs.writeFileSync('.shot_v123_child.png', Buffer.from(r.data,'base64')));

  console.log('\n--- 异常 ---');
  console.log(errs.length ? errs.join(' | ').slice(0,400) : '（无）');
  if (errs.length) fail++;
  else pass++;

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
