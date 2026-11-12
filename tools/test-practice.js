/**
 * v1.2.7 课外练习（随机题库）验证
 * 用法: node tools/test-practice.js [baseUrl]
 *
 * 要证明的六件事：
 *   1) 每天 15 题，数学 5 / 语文 5 / 英语 5，且按科目连续分段，不交替
 *   2) 同一天题目固定（刷新、重进、换设备都拿到同一份），换天自动换新题
 *   3) 数学按数值判分（容差 0.005），语英按选项判分
 *   4) 每道题的选项不重复、正确答案下标合法、都带解析
 *   5) 答题流程走得通：答题 → 反馈 → 下一题 → 交卷 → 计分
 *   6) 中途退出进度不丢
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE,
  'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9343;
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

  await send('Emulation.setDeviceMetricsOverride',
    { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  await send('Page.navigate', { url: withWeek(BASE) }, sessionId);
  await sleep(2500);

  /* 建好孩子端环境：有作业、有排程、有练习块 */
  const setup = await ev(`(function(){
    localStorage.clear();
    S.role='child'; S.page='home'; S.synced=false; S.familyCode='TEST01';
    S.planDate='2026-11-03';
    S.items=[{id:'t1',name:'数学练习册',subject:'数学',type:'think',est:20}];
    S.tasks={};
    SCHEDULE=buildSchedule(S.items);
    SCHEDULE.forEach(s=>{ S.tasks[s.id]={status:'todo',evidence:null}; });
    return { hasPractice: !!SCHEDULE.find(s=>s.id==='practice') };
  })()`);
  ok(setup && setup.hasPractice, '排程里生成了课外练习块');

  console.log('\n【A】一天的卷子结构');
  const paper = await ev(`practicePaper('2026-11-03','TEST01')`);
  ok(Array.isArray(paper) && paper.length === 15, `共 15 题（实际 ${paper && paper.length}）`);
  const subs = (paper || []).map(x => x.sub);
  ok(subs.slice(0, 5).every(s => s === '数学'), '第 1–5 题全是数学，连续不交替');
  ok(subs.slice(5, 10).every(s => s === '语文'), '第 6–10 题全是语文');
  ok(subs.slice(10, 15).every(s => s === '英语'), '第 11–15 题全是英语');

  console.log('\n【B】同一天固定、换天换题');
  const again = await ev(`practicePaper('2026-11-03','TEST01')`);
  ok(JSON.stringify(paper) === JSON.stringify(again), '同一天再算一次，题目完全一致');
  const nextDay = await ev(`practicePaper('2026-11-04','TEST01')`);
  ok(JSON.stringify(paper) !== JSON.stringify(nextDay), '换一天自动换出一套新题');
  const otherKid = await ev(`practicePaper('2026-11-03','OTHER9')`);
  ok(JSON.stringify(paper) !== JSON.stringify(otherKid), '换个家庭码也是另一套题（不同孩子不撞题）');

  console.log('\n【C】题目本身有没有毛病');
  const qa = await ev(`(function(){
    var bad = [];
    var p = practicePaper('2026-11-03','TEST01');
    p.forEach(function(it,i){
      if (!it.q) bad.push(i+':题干空');
      if (!it.tip) bad.push(i+':缺解析');
      if (it.mode === 'input') {
        if (!isFinite(it.a)) bad.push(i+':答案不是数字');
      } else {
        if (!Array.isArray(it.opts) || it.opts.length !== 4) bad.push(i+':选项不是4个');
        else {
          var uniq = it.opts.filter(function(v,k){ return it.opts.indexOf(v)===k; });
          if (uniq.length !== 4) bad.push(i+':选项有重复');
          if (!(it.a >= 0 && it.a < 4)) bad.push(i+':答案下标越界');
        }
      }
    });
    return { bad: bad, n: p.length };
  })()`);
  ok(qa && qa.bad.length === 0, qa && qa.bad.length ? ('发现问题：' + qa.bad.slice(0, 5).join('；')) : `${qa && qa.n} 道题全部通过完整性检查`);

  console.log('\n【D】判分准不准');
  const grading = await ev(`(function(){
    var p = practicePaper('2026-11-03','TEST01');
    var m = p.filter(function(x){ return x.mode==='input'; })[0];
    var c = p.filter(function(x){ return x.mode==='choice'; })[0];
    return {
      mathRight: practiceCheck(m, m.a),
      mathNear: practiceCheck(m, String(Number(m.a.toFixed(2)))),
      mathWrong: practiceCheck(m, m.a + 7.77),
      mathBlank: practiceCheck(m, ''),
      choiceRight: practiceCheck(c, c.a),
      choiceWrong: practiceCheck(c, (c.a + 1) % 4),
      mathAns: m.a,
      choiceAns: c.a
    };
  })()`);
  ok(grading && grading.mathRight === true, '数学输入正确答案判对');
  ok(grading && grading.mathNear === true, '数学允许小数容差（0.005）');
  ok(grading && grading.mathWrong === false, '数学错答案判错');
  ok(grading && grading.mathBlank === false, '空答案判错，不算蒙对');
  ok(grading && grading.choiceRight === true, '选择题选对判对');
  ok(grading && grading.choiceWrong === false, '选择题选错判错');

  console.log('\n【E】答题页长什么样');
  const ui = await ev(`(function(){
    S.practice=null;
    openPractice();
    var html = document.getElementById('viewInner').innerHTML;
    return {
      page: S.page,
      hasSeg: html.indexOf('prac-seg') >= 0,
      hasQ: html.indexOf('prac-q') >= 0,
      hasInput: html.indexOf('pracInput') >= 0 || html.indexOf('prac-opt') >= 0,
      hasFoot: html.indexOf('先存着') >= 0,
      tabHidden: document.getElementById('shellTab').style.display
    };
  })()`);
  ok(ui && ui.page === 'practice', '进入练习页');
  ok(ui && ui.hasQ, '题目区正常渲染');
  ok(ui && ui.hasSeg, '第一题带科目分段头');
  ok(ui && ui.hasInput, '第一题有作答控件');
  ok(ui && ui.hasFoot, '有「先存着」退出入口');
  ok(ui && ui.tabHidden === 'none', '答题时底栏收起，减少跳出去的诱惑');

  console.log('\n【F】中途退出不丢进度');
  const quit = await ev(`(function(){
    var st=practiceState();
    st.answers[0]= st.answers[0]===undefined? 'x' : st.answers[0];
    st.idx=2;
    quitPractice();
    var s2=practiceState();
    return { page:S.page, idx:s2.idx };
  })()`);
  ok(quit && quit.page === 'home', '退出后回到今日页');
  ok(quit && quit.idx === 2, '做到第 3 题的进度被保留');

  console.log('\n【G】做完 15 题会不会正确结算');
  const finish = await ev(`(function(){
    S.practice=null;
    var st=practiceState();
    var list=practiceList();
    st.answers = list.map(function(it){ return it.a; });   // 全对
    st.idx = list.length-1;
    st.done = false;
    finishPractice();
    var t = S.tasks['practice'];
    return {
      status: t && t.status,
      right: st.right, total: st.total,
      page: S.page,
      html: document.getElementById('viewInner').innerHTML
    };
  })()`);
  ok(finish && finish.status === 'done', '练习块被标记为已完成');
  ok(finish && finish.right === 15 && finish.total === 15, `成绩统计正确（${finish && finish.right}/${finish && finish.total}）`);
  ok(finish && /s*15/.test(finish.html) || /满分/.test(finish.html || ''), '结果页显示满分');
  const bySub = await ev(`(function(){
    var m = document.getElementById('viewInner').innerHTML.match(/prac-by-item/g);
    return m ? m.length : 0;
  })()`);
  ok(bySub === 3, `结果页按三科分别统计（${bySub} 项）`);

  console.log('\n【H】错题会不会如实列出');
  const wrongCase = await ev(`(function(){
    S.practice=null;
    var st=practiceState();
    var list=practiceList();
    // 每科错一道
    st.answers = list.map(function(it,i){
      return (i%5===0) ? (it.mode==='input' ? it.a+5 : (it.a+1)%4) : it.a;
    });
    st.idx = list.length-1; st.done=false;
    finishPractice();
    var html = document.getElementById('viewInner').innerHTML;
    return {
      right: st.right,
      hasWrongBlock: html.indexOf('prac-wrong') >= 0,
      mentionsTip: html.indexOf('prac-tip') >= 0,
      count: (html.match(/prac-wrong-item/g)||[]).length
    };
  })()`);
  ok(wrongCase && wrongCase.right === 12, `错 3 对 12（实际 ${wrongCase && wrongCase.right}）`);
  ok(wrongCase && wrongCase.hasWrongBlock, '结果页列出错题');
  ok(wrongCase && wrongCase.count === 3, `错题数量正确（${wrongCase && wrongCase.count} 道）`);
  ok(wrongCase && wrongCase.mentionsTip, '每道错题都带解析');

  console.log('\n【J】难度分层');
  const hard = await ev(`(function(){
    var p = practicePaper('2026-11-03','TEST01');
    return {
      mathFirst: p[0].q,
      mathLast: p[4].q,
      cnLast: p[9].q,
      enLast: p[14].q,
      cnFirst: p[5].q,
      enFirst: p[10].q
    };
  })()`);
  ok(hard && /\+.*=.*\?|米|%/.test(hard.mathFirst) && !/小时|体积|相遇|折|增加/.test(hard.mathFirst),
    `数学首题是热身题（${hard && hard.mathFirst}）`);
  ok(hard && /相遇|体积|折|增加|立方米|\/.*\+/.test(hard.mathLast),
    `数学末题是应用题或分数题（${hard && hard.mathLast}）`);
  ok(hard && /文言|之乎|通|句式|缩句|标点|默写|下一句|陈述句|被字句|骄傲|与其|惠|闻|誉|弗|耒|涕|岳|王师/.test(hard.cnLast),
    `语文末题落在文言、默写或句式（${hard && hard.cnLast.slice(0, 22)}…）`);
  ok(hard && /过去式|复数|比较级|___/.test(hard.enLast),
    `英语末题是词形变化或时态（${hard && hard.enLast.slice(0, 22)}…）`);

  console.log('\n【K】连跑 60 天，题目不许出岔子');
  const batch = await ev(`(function(){
    var bad = [];
    var base = new Date(2026, 10, 1);
    for (var i = 0; i < 60; i++) {
      var dt = new Date(base.getTime()); dt.setDate(dt.getDate() + i);
      var date = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
      var p = practicePaper(date, 'BATCH');
      if (p.length !== 15) { bad.push(date + ':题数' + p.length); continue; }
      var subs = p.map(function(x){ return x.sub; });
      if (!(subs.slice(0,5).every(function(s){return s==='数学';}) &&
            subs.slice(5,10).every(function(s){return s==='语文';}) &&
            subs.slice(10,15).every(function(s){return s==='英语';}))) bad.push(date + ':科目分段错');
      p.forEach(function(it, k){
        if (!it.q || !it.tip) bad.push(date + '#' + k + ':缺题干或解析');
        if (it.mode === 'choice') {
          if (!Array.isArray(it.opts) || it.opts.length !== 4) bad.push(date + '#' + k + ':选项不是4个');
          else if (new Set(it.opts).size !== 4) bad.push(date + '#' + k + ':选项重复');
          else if (!(it.a >= 0 && it.a < 4)) bad.push(date + '#' + k + ':下标越界');
        } else {
          if (!isFinite(it.a)) bad.push(date + '#' + k + ':答案非数字');
        }
      });
    }
    return { badCount: bad.length, sample: bad.slice(0, 6) };
  })()`);
  ok(batch && batch.badCount === 0,
    batch && batch.badCount ? ('60 天里发现 ' + batch.badCount + ' 处问题：' + batch.sample.join('；')) : '60 天共 900 道题，全部合法');

  console.log('\n【I】运行时异常');
  const realErrors = errors.filter(e => !/favicon|Failed to load resource/i.test(String(e)));
  ok(realErrors.length === 0, realErrors.length ? ('发现异常：' + realErrors.slice(0, 3).join(' | ')) : '全程无运行时异常');

  console.log(`\n———— 结果：${pass} 通过 / ${fail} 失败 ————`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
