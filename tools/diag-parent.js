/**
 * 诊断：孩子端已推的作业清单，家长端为何看不到
 * 用真实账号登录线上家长端，逐步打印同步状态
 */
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL = process.argv[2] || 'https://YOUR_APP_HOST/?sharecode=YOUR_SHARECODE';
const PORT = 9341, sleep = ms => new Promise(r => setTimeout(r, ms));

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

  await send('Page.navigate',{url:URL},sessionId);
  await sleep(7000);
  console.log('版本 =', await ev('window.APP_VERSION'));
  console.log('登录门可见 =', await ev('!document.getElementById("authGate").classList.contains("gone")'));

  console.log('\n--- 登录（真实账号）---');
  console.log('signIn =', JSON.stringify(await ev('Cloud.signIn("zwjking@126.com","123456")')));
  await sleep(1500);
  console.log('bootAfterAuth 完成');
  await ev('App.bootAfterAuth()');
  await sleep(3000);

  console.log('\n--- 同步后本地状态 ---');
  console.log('S.role      =', await ev('S.role'));
  console.log('S.synced    =', await ev('S.synced'));
  console.log('S.planDate  =', await ev('S.planDate'));
  console.log('S.items 数  =', await ev('(S.items||[]).length'));
  console.log('S.items     =', String(await ev('JSON.stringify((S.items||[]).map(function(i){return i.name+"["+i.type+"/"+i.est+"分]"}))')).slice(0,400));
  console.log('SCHEDULE 数 =', await ev('SCHEDULE.length'));
  console.log('非休息块    =', await ev('SCHEDULE.filter(function(s){return s.kind!=="break"}).length'));

  console.log('\n--- 云端原始返回 ---');
  const raw = await ev('(async function(){var r=await Cloud.pull();return JSON.stringify({day:r.day,plan_date:r.household&&r.household.plan_date,plan_date类型:typeof (r.household&&r.household.plan_date),items数:(r.household&&r.household.plan_items||[]).length,tasks数:(r.tasks||[]).length,tasks日期:(r.tasks||[]).map(function(t){return t.plan_date})[0]});})()');
  console.log(raw);

  console.log('\n--- 家长端 tab 页实际渲染 ---');
  await ev('S.role="parent"; S.page="p-home"; render();');
  await sleep(600);
  console.log('看板页文本：', String(await ev('(document.getElementById("viewInner")||{}).innerText')).replace(/\n+/g,' | ').slice(0,400));
  await ev('S.page="p-review"; render();');
  await sleep(500);
  console.log('返工页文本：', String(await ev('(document.getElementById("viewInner")||{}).innerText')).replace(/\n+/g,' | ').slice(0,400));

  const r = await send('Page.captureScreenshot',{format:'png'},sessionId);
  fs.writeFileSync('diag_parent.png', Buffer.from(r.data,'base64'));
  console.log('\n截图 → diag_parent.png');
  console.log('异常 =', errs.length?errs.join(' | ').slice(0,400):'（无）');
  ws.close(); proc.kill(); process.exit(0);
})().catch(e=>{console.error('诊断失败:', e.message); process.exit(1)});
