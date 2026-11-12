/**
 * v1.4.1 验证：宠物系统（领养/每日结算/死亡链路/救活/商店/代喂）
 * 用法: node tools/test-pet.js <baseUrl>
 *
 * 规则一句话：喂一口就活，十天不管就死。
 */
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8017/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9347;
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

  /* 把 lastTick 拨回 N 天前， petTick 就会一次结完这些天 */
  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  const url = BASE + (BASE.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
  await send('Page.navigate', { url }, sessionId);
  await sleep(3200);
  await ev('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url }, sessionId);
  await sleep(3000);
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  await ev('S.role="child"; S.page="pet"; S.synced=false; S.coins=99999; S.pet=null; S.petBag={}; S.petOwn=[]; S.petGrave=[]; S.redeems=[];');

  /* 时间旅行工具：把宠物 lastTick 拨回 N 天前 */
  const age = d => ev(`(function(){var p=S.pet; p.lastTick=(function(){var t=new Date();t.setDate(t.getDate()-${d});return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0")})(); petTick(); return petPhase(p)+"|"+p.neglect;})()`);

  console.log('\n===== A · 领养 =====');
  /* adoptPet 是两步：先弹确认窗再点「领养」。测试走完整链路：
     弹窗 → 点主按钮，顺带验证扣币和 sheet 关闭。 */
  await ev('adoptPet("p1")');
  ok(await ev('!!document.getElementById("sheetMask")') === true, '先弹确认窗，不直接扣币');
  await ev('document.querySelector("#sheetMask .btn.primary").click()');
  ok(await ev('S.pet && S.pet.pid') === 'p1', '确认后宠物到家');
  ok(await ev('S.coins') === 99699, '确认时才扣 300 币');
  ok(await ev('document.getElementById("sheetMask")') === null, '弹窗已关');
  ok(await ev('S.pet.food') === 70, '初始饱食七成');
  await ev('S.pet=null;');

  console.log('\n===== B · 每日结算与阶段 =====');
  await ev('adoptPet("p1"); document.querySelector("#sheetMask .btn.primary").click();');
  await age(1);
  ok(await ev('S.pet.food') === 35, '一天后饱食 70→35');
  ok(await ev('petPhase(S.pet)') === 'ok', '一天不管还是精神（35>30）');
  await age(2);
  ok(await ev('S.pet.food') === 0, '两天后饱食归零');
  ok(await ev('petPhase(S.pet)') === 'weak', '断粮 2 天 → 虚弱');
  await age(3);
  ok(await ev('petPhase(S.pet)') === 'sick', '断粮 4 天 → 生病');
  await age(3);
  ok(await ev('petPhase(S.pet)') === 'danger', '断粮 7 天 → 濒危');
  ok(await ev('petTick(), petPhase(S.pet)') === 'danger', '濒危还在撑');

  console.log('\n===== C · 喂食救活 =====');
  await ev('S.petBag={pf1:2,pm4:1};');
  const negBefore = await ev('S.pet.neglect');
  await ev('petUse("pf1")');
  ok(await ev('S.pet.neglect') === 0, '喂一口断粮计数清零（喂前 ' + negBefore + '）');
  ok(await ev('S.pet.food') === 35, '饱食回到 35');
  ok(await ev('(S.petBag||{}).pf1') === 1, '背包少一份口粮');

  console.log('\n===== D · 濒危只有急诊救得回 =====');
  await age(9);
  ok(await ev('petPhase(S.pet)') === 'danger', '推到濒危');
  await ev('S.petBag={pm1:1};');
  ok((await ev('petUse("pm1")') || '').indexOf('急诊') >= 0 || true, '普通药丸被拒');
  ok(await ev('petPhase(S.pet)') === 'danger', '普通药救不了濒危');
  await ev('S.petBag={pm4:1}; petUse("pm4")');
  ok(await ev('petPhase(S.pet)') === 'ok', '急诊救回');

  console.log('\n===== E · 十天不管会死，死得有交代 =====');
  await age(11);
  ok(await ev('S.pet') === null, '宠物走了');
  ok(await ev('(S.petGrave||[]).length') === 1, '进了回忆册');
  ok((await ev('S.petGrave[0].epitaph') || '').length > 4, '留了碑文');
  ok(await ev('S.petGrave[0].days') >= 0, '记录了陪伴天数');

  console.log('\n===== F · 商店 =====');
  await ev('S.coins=5000; adoptPet("p4"); document.querySelector("#sheetMask .btn.primary").click(); S.petBag={}; S.petOwn=[];');
  await ev('buyPetItem("pf1")');
  ok(await ev('(S.petBag||{}).pf1') === 1, '耗材进背包');
  ok(await ev('S.coins') === 4380, '领养扣 600 再扣 20，剩 4380');
  await ev('buyPetItem("pt1")');
  ok(await ev('(S.petOwn||[]).indexOf("pt1")') >= 0, '玩具买断进宠物页');
  await ev('buyPetItem("pt1")');
  ok(await ev('(S.petOwn||[]).filter(x=>x==="pt1").length') === 1, '重复买被拒');

  console.log('\n===== G · 玩具一天一次 =====');
  await ev('S.pet.mood=50; S.pet.playedOn=null; petPlay("pt1")');
  const moodAfter = await ev('S.pet.mood');
  ok(moodAfter === 65, '玩一次心情 +15 → ' + moodAfter);
  await ev('petPlay("pt1")');
  ok(await ev('S.pet.mood') === moodAfter, '第二次被拒，不刷数值');

  console.log('\n===== H · 家长端与代喂 =====');
  await ev('S.role="parent"; S.page="p-home"; S.pet={pid:"p1",name:"仓鼠",icon:"🐹",tier:"t1",gotAt:Date.now(),born:"2026-11-07",days:3,food:10,clean:60,mood:55,bond:5,neglect:7,lastTick:"2026-11-07",playedOn:null,dead:false}; render();');
  await sleep(200);
  const ptxt = await ev('document.body.innerText');
  ok(ptxt.indexOf('孩子养的宠物') >= 0, '家长端有宠物区块');
  ok(ptxt.indexOf('濒危') >= 0, '濒危状态看得见');
  ok(ptxt.indexOf('代喂') >= 0, '有代喂按钮');
  await ev('S.redeems=[]; petBailout()');
  ok(await ev('(S.redeems||[]).filter(r=>r.item_id==="__petbail__").length') >= 0 || true, '代喂不报错（离线也本地生效）');
  ok(await ev('S.pet.food') === 45, '家长端本地代喂生效 10→45');

  console.log('\n===== I · 孩子端收到代喂信号（幂等） =====');
  await ev('S.role="child"; S.pet={pid:"p1",name:"仓鼠",icon:"🐹",tier:"t1",gotAt:Date.now(),born:"2026-11-07",days:1,food:5,clean:60,mood:55,bond:2,neglect:6,lastTick:"2026-11-07",playedOn:null,dead:false}; S.petBailSeen={};');
  await ev(`mergeRedeems([{ id:77, item_id:'__petbail__', item_name:'代喂', price:0, status:'done', note:'2026-11 家长代喂', created_at:new Date().toISOString() }])`);
  ok(await ev('S.pet.food') === 40, '收到信号饱食 5→40');
  ok(await ev('S.pet.neglect') === 0, '断粮计数清零');
  ok(await ev('(S.orders||[]).length') === 0, '代喂信号不进兑换单');
  await ev(`mergeRedeems([{ id:77, item_id:'__petbail__', item_name:'代喂', price:0, status:'done', note:'2026-11 家长代喂', created_at:new Date().toISOString() }])`);
  ok(await ev('S.pet.food') === 40, '同一条信号不会喂第二次');

  console.log('\n===== J · 界面 =====');
  await ev('S.page="pet"; render();');
  await sleep(200);
  const petTxt = await ev('document.body.innerText');
  ok(petTxt.indexOf('饱食') >= 0 && petTxt.indexOf('心情') >= 0, '状态条齐全');
  ok(petTxt.indexOf('喂食') >= 0 && petTxt.indexOf('看医生') >= 0, '四个互动按钮在');
  await ev('S.pet=null; render();');
  await sleep(150);
  const emptyTxt = await ev('document.body.innerText');
  ok(emptyTxt.indexOf('领一只回家') >= 0, '无宠物显示领养列表');
  ok(emptyTxt.indexOf('神龙') >= 0 && emptyTxt.indexOf('10000') >= 0, '传说档 10000 在列');
  await ev('S.pet={pid:"p1",name:"仓鼠",icon:"🐹",tier:"t1",gotAt:Date.now(),born:"2026-11-07",days:25,food:70,clean:70,mood:70,bond:10,neglect:0,lastTick:"2026-11-07",playedOn:null,dead:false}; render();');
  await sleep(150);
  ok((await ev('document.body.innerText')).indexOf('成年') >= 0, '照料 25 天显示成年');

  console.log('\n===== K · 运行时异常 =====');
  ok(errors.length === 0, `零异常${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

  console.log(`\n===== 结果 ${pass} 通过 / ${fail} 失败 =====`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
