/**
 * v1.2.3 端到端：真实账号登录，验证家长端能看到孩子今天已交的作业项
 * 只读为主：家长端不推 household，不会覆盖孩子端的币和清单。
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const BASE = process.argv[2] || 'http://127.0.0.1:8125/index.html';
const URL_T = BASE + (BASE.indexOf('?') >= 0 ? '&' : '?') + 'role=parent';
const PORT = 9347, sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, ex) => { ok ? pass++ : fail++; console.log('  ' + (ok ? '\u2714' : '\u2718') + ' ' + n + (ex !== undefined ? '\uff08' + ex + '\uff09' : '')); };

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
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)return '[异]'+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text||'').slice(0,300);return r.result&&r.result.value};
  const shot = async n => { const r = await send('Page.captureScreenshot',{format:'png'},sessionId); fs.writeFileSync(n, Buffer.from(r.data,'base64')); };

  await send('Page.navigate',{url:URL_T},sessionId);
  await sleep(5000);
  console.log('版本 =', await ev('window.APP_VERSION'), '| 角色参数 =', await ev('typeof FORCED_ROLE!=="undefined"?FORCED_ROLE:"?"'));

  console.log('\n--- 登录 ---');
  const si = await ev('Cloud.signIn("zwjking@126.com","123456").then(function(){return "ok"}).catch(function(e){return "ERR "+e.message})');
  console.log('signIn =', si);
  await sleep(1200);
  await ev('App.bootAfterAuth()');
  await sleep(3500);

  const st = JSON.parse(await ev(`JSON.stringify({
    role: S.role, page: S.page, synced: S.synced, planDate: S.planDate,
    items: (S.items||[]).length,
    hwSegs: SCHEDULE.filter(function(s){return s.kind==='hw'}).length,
    hwDoneSegs: SCHEDULE.filter(function(s){return s.kind==='hw'&&S.tasks[s.id].status==='done'}).length,
    hwMissing: SCHEDULE.filter(function(s){return s.kind==='hw'&&!S.tasks[s.id]}).length,
    withEvidence: SCHEDULE.filter(function(s){return S.tasks[s.id]&&S.tasks[s.id].evidencePath}).length,
    grid: gridProgress('homework'),
    rows: SCHEDULE.filter(function(s){return s.kind!=='break'}).length,
    rowDone: SCHEDULE.filter(function(s){return s.kind!=='break'&&S.tasks[s.id].status==='done'}).length,
    titles: SCHEDULE.filter(function(s){return s.kind==='hw'}).map(function(s){return s.title+(s.dur===0?'[已交]':'['+s.dur+'分]')})
  })`));
  console.log('\n--- 拉到云端后 ---');
  console.log('清单项数 =', st.items, '| 作业段 =', st.hwSegs, '| 其中已交 =', st.hwDoneSegs);
  console.log('带凭证的段 =', st.withEvidence);
  st.titles.forEach(t => console.log('   ·', t));

  console.log('\n--- 断言 ---');
  ck('云端清单已拉到本地', st.items > 0, st.items + ' 项');
  ck('时间轴已按清单生成', st.hwSegs > 0, st.hwSegs + ' 段');
  ck('已交的作业段留在时间轴', st.hwDoneSegs > 0, st.hwDoneSegs + ' 段');
  ck('每个作业段都有任务行', st.hwMissing === 0, st.hwMissing + ' 段缺行');
  ck('凭证记录能对上任务行', st.withEvidence > 0, st.withEvidence + ' 段有照片/录音');
  ck('四格分母包含已交项', st.grid.total === st.hwSegs, st.grid.done + '/' + st.grid.total);
  ck('家长端分母不变小', st.rows >= st.hwSegs, st.rowDone + '/' + st.rows);

  await ev(`S.role='parent'; S.page='p-home'; render();`);
  await sleep(800);
  const pHome = String(await ev('document.getElementById("viewInner").innerText'));
  console.log('\n--- 家长看板 ---');
  console.log(pHome.split('\n').filter(x => x.trim()).slice(0, 14).join(' | '));
  ck('看板出现"已完成"标签', (pHome.match(/已完成/g) || []).length >= 1, (pHome.match(/已完成/g) || []).length + ' 处');
  ck('看板出现照片/录音按钮', pHome.indexOf('看照片') >= 0 || pHome.indexOf('听录音') >= 0);
  await shot('.shot_v123_parent_live.png');

  await ev(`S.page='p-review'; render();`);
  await sleep(600);
  const pRev = String(await ev('document.getElementById("viewInner").innerText'));
  ck('返工页出现"退回"按钮', pRev.indexOf('退回') >= 0);
  await shot('.shot_v123_review_live.png');

  console.log('\n异常 =', errs.length ? errs.join(' | ').slice(0, 300) : '（无）');
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
