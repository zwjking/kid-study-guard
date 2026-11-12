/** 作业项录入 + 排程引擎 验证 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9350;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = process.argv[2] || 'http://127.0.0.1:8130/index.html';

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--window-size=430,932', 'about:blank'], { stdio: 'ignore' });

  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {} }
  if (!ver) { console.error('浏览器启动失败'); process.exit(1); }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}, sid) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid }));
  });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  // 收集运行时异常
  const errs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && d.exception.description) || d.text);
    }
  });

  await send('Page.navigate', { url: URL }, sessionId);
  await sleep(4000);

  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return 'ERR: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  const log = (t, v) => console.log(t + '\n  ' + (typeof v === 'string' ? v : JSON.stringify(v, null, 1)).replace(/\n/g, '\n  '));

  // 清场
  await ev(`(function(){
    var g=document.getElementById('authGate'); if(g) g.remove();
    document.body.classList.remove('auth-locked');
    try{ localStorage.removeItem('study-guardian-v1'); }catch(e){}
    S.items=[]; S.tasks={}; S.role='child'; S.page='home';
    rebuildSchedule(); render();
    return 'ok';
  })()`);

  console.log('\n===== 1 · 类型自动判定 =====');
  const cases = ['抄第12课生字', '听写第12课词语', '写作文《难忘的一件事》', '背诵古诗两首',
    '数学练习册 p32', '口算 20 题', '预习第13课', '阅读短文回答问题', '默写单词',
    '组词造句', '手抄报一张', '朗读课文三遍'];
  const judge = await ev(`(function(){
    var names=${JSON.stringify(cases)};
    return names.map(function(n){ return n+' → '+ITEM_TYPES[guessItemType(n)].name; }).join('\\n');
  })()`);
  console.log(judge);

  console.log('\n===== 2 · 空状态首页 =====');
  log('S.items 为空时:', await ev(`(function(){
    var h=document.getElementById('app').innerHTML;
    return { 有引导卡: h.indexOf('plan-empty')>=0, 有开始按钮: h.indexOf('开始列')>=0, 显示时间轴: h.indexOf('今天的路线')>=0 };
  })()`));

  console.log('\n===== 3 · 录入语文三项（抄写15 / 听写10 / 作文40） =====');
  log('录入结果:', await ev(`(function(){
    addItem({subject:'语文', name:'抄第12课生字', type:guessItemType('抄第12课生字'), est:15});
    addItem({subject:'语文', name:'听写第12课词语', type:guessItemType('听写第12课词语'), est:10});
    addItem({subject:'语文', name:'写作文《难忘的一件事》', type:guessItemType('写作文《难忘的一件事》'), est:40});
    rebuildSchedule(); render();
    return S.items.map(function(i){ return i.subject+' / '+i.name+' / '+ITEM_TYPES[i.type].name+' / '+i.est+'分钟'; });
  })()`));

  console.log('\n===== 4 · 生成的时间轴 =====');
  console.log(await ev(`(function(){
    return SCHEDULE.map(function(s){
      return s.slot+'  '+(s.kind==='break'?'[休息]':s.kind==='hw'?'[作业]':s.kind==='ritual'?'[仪式]':s.kind==='practice'?'[练习]':s.kind==='review'?'[复习]':s.kind==='preview'?'[预习]':'[收工]')+'  '+s.title;
    }).join('\\n');
  })()`));

  console.log('\n===== 5 · 分块是否正确（作文 40 应拆成 25+15） =====');
  log('作文相关块:', await ev(`(function(){
    return SCHEDULE.filter(function(s){ return s.itemId && s.title.indexOf('作文')>=0; }).map(function(s){
      return { 标题:s.title, 时长:s.dur, 段:s.part+'/'+s.parts, 时间:s.slot };
    });
  })()`));

  console.log('\n===== 6 · 容量核算 =====');
  log('planLoad:', await ev(`(function(){ var L=planLoad(); return { 项数:L.items, 净时长:L.work, 块数:L.count, 含休息:L.need, 可用:L.have, 超出:L.over, 预计收工:fmt(planEndTime()) }; })()`));

  console.log('\n===== 7 · 首页负载条 =====');
  log('渲染:', await ev(`(function(){
    render();
    var h=document.getElementById('app').innerHTML;
    return { 有负载条: h.indexOf('plan-bar')>=0, 超时警示: h.indexOf('plan-bar over')>=0, 显示时间轴: h.indexOf('今天的路线')>=0 };
  })()`));

  let r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_plan_home.png', Buffer.from(r.data, 'base64'));

  console.log('\n===== 8 · 打开录入面板 =====');
  log('面板:', await ev(`(function(){
    openItemAdd();
    var m=document.getElementById('itemAddMask');
    if(!m) return '没打开';
    return { 面板: !!m, 科目芯片: m.querySelectorAll('#iaSub button').length, 时长档位: m.querySelectorAll('#iaDur button').length, 默认选中时长: m.querySelector('#iaDur button.on') ? m.querySelector('#iaDur button.on').textContent.trim().replace(/\\s+/g,' ') : '无' };
  })()`));
  await sleep(400);
  r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync('.shot_plan_add.png', Buffer.from(r.data, 'base64'));

  console.log('\n===== 9 · 面板里打字看类型提示 =====');
  log('输入「写作文」后:', await ev(`(function(){
    var inp=document.getElementById('iaName');
    inp.value='写作文《我的妈妈》';
    inp.dispatchEvent(new Event('input'));
    return document.getElementById('iaType').textContent.trim();
  })()`));

  console.log('\n===== 10 · 超时判定（时间到不等于完成） =====');
  log('markTimeout:', await ev(`(function(){
    closeItemAdd();
    var hw=SCHEDULE.filter(function(s){ return s.kind==='hw'; }).pop();
    markTimeout(hw.id);
    var t=S.tasks[hw.id];
    var it=S.items.filter(function(i){ return i.id===hw.itemId; })[0];
    return { 块状态:t.status, 作业项状态:it?it.status:'无', 给币:S.earnedToday };
  })()`));

  console.log('\n===== 11 · 超时后再补做完成，应标 wasTimeout =====');
  log('补做:', await ev(`(function(){
    var hw=SCHEDULE.filter(function(s){ return s.kind==='hw'; }).pop();
    completeTask(hw.id, 'tell');
    var it=S.items.filter(function(i){ return i.id===hw.itemId; })[0];
    return { 作业项状态:it.status, 曾超时:!!it.wasTimeout };
  })()`));

  console.log('\n===== 运行时异常 =====\n  ' + (errs.length ? errs.join('\n  ') : '无'));

  ws.close(); proc.kill(); process.exit(0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
