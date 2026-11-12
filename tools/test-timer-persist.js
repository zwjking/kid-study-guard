/**
 * v1.2.9 计时持久化 + 屏幕保活 + 到点提醒 验证
 * 用法: node tools/test-timer-persist.js [baseUrl]
 *
 * 这一版要证明的四件事：
 *   1) 计时靠「终点时刻」而不是「每秒自减」，页面重开后剩余时间按真实时钟校准
 *   2) 离开期间已经过点的，回来后立刻补响并告知超时多久
 *   3) 屏幕保活能起来（安卓走 Wake Lock，其它走隐藏视频兜底）
 *   4) 到点提醒是循环三声不是响一下就完
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE,
  'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9341;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✔' : '✘'} ${m}`); };

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=*', '--autoplay-policy=no-user-gesture-required',
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
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return '[异常] ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result && r.result.value;
  };
  const load = async (url, wait = 2200) => {
    await send('Page.navigate', { url: withWeek(url) }, sessionId);
    await sleep(wait);
  };

  await send('Emulation.setDeviceMetricsOverride',
    { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);

  /* 建立一个干净的孩子端环境：直接往内存里塞一份排程，绕开登录门 */
  const setUp = `
    (function(){
      localStorage.clear();
      S.role='child'; S.page='home';
      S.items=[{id:'t1',name:'数学练习册',subject:'数学',type:'think',est:20},
               {id:'t2',name:'语文抄写',subject:'语文',type:'mech',est:15}];
      S.tasks={};
      SCHEDULE = buildSchedule(S.items);
      SCHEDULE.forEach(s=>{ S.tasks[s.id]={status:'todo',evidence:null}; });
      var c = SCHEDULE.find(s=>s.kind!=='break'&&s.kind!=='wrap');
      S.timerTask=c.id; S.page='timer';
      render(); startTimer(c);
      return { id:c.id, dur:c.dur, total:T.total, endAt:T.endAt };
    })()`;

  console.log('\n【A】资源与启动');
  await load(BASE);
  const boot = await ev(`({
    ver: window.APP_VERSION,
    hasFn: typeof startTimer === 'function' && typeof restoreTimer === 'function',
    mp4len: (typeof WAKE_MP4 === 'string') ? WAKE_MP4.length : -1,
    tkey: typeof TKEY === 'string' ? TKEY : null
  })`);
  ok(boot && boot.ver === 'v1.4.1', `版本号 = v1.4.1（实际 ${boot && boot.ver}）`);
  ok(boot && boot.hasFn, '计时与恢复函数都已加载');
  ok(boot && boot.mp4len === 5004, `内嵌保活视频完整（base64 ${boot && boot.mp4len} 字符）`);
  ok(boot && boot.tkey, '持久化键名已定义');

  console.log('\n【B】开始计时后有没有把终点钉下来');
  const st = await ev(setUp);
  ok(st && st.total > 0, `计时已启动，总时长 ${st && Math.round(st.total / 60000)} 分钟`);
  const snap = await ev(`(function(){ try{ return JSON.parse(localStorage.getItem(TKEY)); }catch(e){ return null; } })()`);
  ok(!!snap, '本地已写入计时快照');
  ok(snap && snap.id === st.id, '快照记录了正确的任务 id');
  ok(snap && Math.abs(snap.endAt - st.endAt) < 60, '快照的终点时刻与内存一致');
  ok(snap && snap.endAt > Date.now(), '终点时刻在未来，快照没写反');

  console.log('\n【C】秒数是否真的在跳');
  const c1 = await ev(`document.getElementById('clockNum').textContent`);
  await sleep(1300);
  const c2 = await ev(`document.getElementById('clockNum').textContent`);
  ok(c1 && c2 && c1 !== c2, `时钟在走（${c1} → ${c2}）`);

  console.log('\n【D】暂停与继续');
  await ev(`pauseTimer()`);
  await sleep(300);
  const p1 = await ev(`(function(){ var o=JSON.parse(localStorage.getItem(TKEY)); return {paused:o.paused, remain:o.remainMs, end:T.endAt}; })()`);
  ok(p1 && p1.paused === true, '快照标记为已暂停');
  ok(p1 && p1.remain > 0, '暂停时冻结了剩余毫秒数');
  await sleep(1100);
  const p2 = await ev(`(function(){ var o=JSON.parse(localStorage.getItem(TKEY)); return o.remainMs; })()`);
  ok(p2 === p1.remain, '暂停期间剩余时间不再减少');
  await ev(`pauseTimer()`);
  await sleep(300);
  const p3 = await ev(`(function(){ var o=JSON.parse(localStorage.getItem(TKEY)); return {paused:o.paused, end:o.endAt}; })()`);
  ok(p3 && p3.paused === false, '继续后快照解除暂停');
  ok(p3 && p3.end > p1.end, '继续后终点时刻按剩余量重新推算');

  console.log('\n【E】屏幕保活');
  const wake = await ev(`(function(){
    return {
      on: WAKE.on,
      hasVideo: !!(WAKE.video && WAKE.video.parentNode),
      muted: WAKE.video ? WAKE.video.muted : null,
      loop: WAKE.video ? WAKE.video.loop : null,
      inline: WAKE.video ? WAKE.video.getAttribute('playsinline') : null,
      line: (function(){ var el=document.getElementById('wakeLine'); return el?{cls:el.className, txt:el.textContent}:null; })()
    };
  })()`);
  ok(wake && wake.hasVideo, '保活视频元素已挂到页面上');
  ok(wake && wake.muted === true && wake.loop === true, '视频 muted + loop（iOS 硬性要求）');
  ok(wake && wake.inline !== null, '视频带 playsinline，不会被 iOS 全屏劫持');
  ok(wake && wake.line && /已保活|保活没启动/.test(wake.line.txt), `计时页有保活状态行：「${wake && wake.line && wake.line.txt}」`);

  console.log('\n【F】重开恢复：还剩一半时关掉再打开');
  await ev(`(function(){
    localStorage.setItem(TKEY, JSON.stringify({
      id: S.timerTask, total: 20*60*1000, endAt: Date.now() + 12*60*1000,
      remainMs: 12*60*1000, paused: false, at: Date.now()
    }));
  })()`);
  await load(BASE);
  const rs = await ev(`(function(){
    ${setUp.replace(/^\(function\(\)\{|\}\)\(\)$/g, '')}
    return null;
  })()`);
  // 重新载入会清空上面 setUp 里的 localStorage，所以恢复流程单独跑一次
  const back = await ev(`(function(){
    S.items=[{id:'t1',name:'数学练习册',subject:'数学',type:'think',est:20}];
    S.tasks={}; SCHEDULE=buildSchedule(S.items);
    SCHEDULE.forEach(s=>{ S.tasks[s.id]={status:'todo'}; });
    var c=SCHEDULE.find(s=>s.kind!=='break'&&s.kind!=='wrap');
    localStorage.setItem(TKEY, JSON.stringify({
      id:c.id, total:20*60*1000, endAt: Date.now()+12*60*1000,
      remainMs:12*60*1000, paused:false, at:Date.now()
    }));
    stopTimer(); T.id=null; T.fired=false;
    var got = restoreTimer();
    return { got: got, page: S.page, clock: (document.getElementById('clockNum')||{}).textContent, tid: T.id };
  })()`);
  ok(back && back.got === true, '恢复函数返回成功');
  ok(back && back.page === 'timer', '重开后自动回到计时页');
  ok(back && /^(11|12):/.test(back.clock || ''), `剩余时间按真实时钟校准（显示 ${back && back.clock}，预期 11~12 分钟）`);

  console.log('\n【G】重开恢复：离开期间已经过点');
  const late = await ev(`(function(){
    stopTimer(); T.id=null; T.fired=false;
    S.page='home'; render();
    var c=SCHEDULE.find(s=>s.kind!=='break'&&s.kind!=='wrap');
    S.tasks[c.id]={status:'todo'};
    localStorage.setItem(TKEY, JSON.stringify({
      id:c.id, total:20*60*1000, endAt: Date.now()-8*60*1000,
      remainMs:0, paused:false, at:Date.now()
    }));
    return restoreTimer();
  })()`);
  await sleep(900);
  const sheet = await ev(`(function(){
    var m=document.querySelector('.sheet-mask');
    return m ? m.innerText.replace(/\\s+/g,' ').slice(0,120) : null;
  })()`);
  ok(late === true, '过期快照被识别');
  ok(!!sheet, '回来立刻弹出到点询问框');
  ok(sheet && /超出/.test(sheet), '文案如实说明已经超出多久');
  ok(sheet && /早就到点/.test(sheet), '标题区分了「早就到点」与普通到点');

  console.log('\n【H】完成或放弃后不留残渣');
  const cleaned = await ev(`(function(){
    var m=document.querySelector('.sheet-mask'); if(m) m.remove();
    stopRing(); clearTimerSnap();
    return localStorage.getItem(TKEY);
  })()`);
  ok(cleaned === null, '放弃后快照被清除，下次开机不会误恢复');

  console.log('\n【I】到点提醒是循环而不是响一下');
  const ring = await ev(`(function(){
    ringAlarm(3);
    return { n: RING.n, hasTimer: !!RING.t };
  })()`);
  await sleep(2600);
  const ring2 = await ev(`RING.n`);
  ok(ring && ring.n === 1, '第一轮铃声立即触发');
  ok(ring2 >= 2, `2.6 秒后已进入下一轮（第 ${ring2} 轮），说明是循环提醒`);
  await ev(`stopRing()`);

  console.log('\n【J】运行时异常');
  const realErrors = errors.filter(e => !/favicon|Failed to load resource/i.test(String(e)));
  ok(realErrors.length === 0, realErrors.length ? ('发现异常：' + realErrors.slice(0, 3).join(' | ')) : '全程无运行时异常');

  console.log(`\n———— 结果：${pass} 通过 / ${fail} 失败 ————`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
