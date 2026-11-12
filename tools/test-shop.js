/**
 * v1.2.9 验证：商品价格翻倍 + 兑换闭环（下单/待兑现/已兑现/退币）+ 收藏三项
 * 用法: node tools/test-shop.js <baseUrl>
 *
 * 这一版修的核心是「点一下兑换币就没了」：
 * 旧版兑完只弹一句提示，没有任何凭证，家长端也看不到欠了什么。
 * 现在每一笔都要落一张单，走 待兑现 → 已兑现 的闭环。
 */
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9343;
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

  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, sessionId);
  await send('Page.navigate', { url: BASE + (BASE.indexOf('?') >= 0 ? '&' : '?') + 'p=week' }, sessionId);
  await sleep(3200);
  await ev('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url: BASE + (BASE.indexOf('?') >= 0 ? '&' : '?') + 'p=week' }, sessionId);
  await sleep(3000);
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  await ev('S.role="child"; S.page="shop"; S.synced=false;');

  console.log('\n===== A · 价格翻倍 =====');
  ok(await ev('window.APP_VERSION') === 'v1.4.1', `版本 = ${await ev('window.APP_VERSION')}`);
  ok(await ev('SHOP.length') === 38, `商品共 38 项（${await ev('SHOP.length')}）`);
  ok(await ev("SHOP.find(i=>i.id==='s1').price") === 80, '换 20 分钟动画 40→80');
  ok(await ev("SHOP.find(i=>i.id==='s2').price") === 120, '额外 30 分钟屏幕 60→120');
  ok(await ev("SHOP.find(i=>i.id==='s6').price") === 300, '完整电影 150→300');
  ok(await ev("SHOP.find(i=>i.id==='o5').price") === 1000, '半天短途 500→1000');
  ok(await ev("SHOP.find(i=>i.id==='f1').price") === 60, '零食 30→60');
  ok(await ev("SHOP.find(i=>i.id==='c1').price") === 100, '盲盒 50→100');
  ok(await ev('CFG.dayCap') === 150, '每日封顶仍是 150（未动）');
  const allEven = await ev('SHOP.every(i=>i.price%10===0)');
  ok(allEven, '所有价格都是整十（没有零散尾数）');
  const minP = await ev('Math.min.apply(null,SHOP.map(i=>i.price))');
  const maxP = await ev('Math.max.apply(null,SHOP.map(i=>i.price))');
  ok(minP === 60 && maxP === 1000, `价格区间 60–1000（实际 ${minP}–${maxP}）`);

  console.log('\n===== B · 兑换必落一张单 =====');
  await ev('S.orders=[]; S.owned=[]; S.coins=2000; S.haveSkin=false; S.haveTitle=false; save(); render();');
  const c0 = await ev('S.coins');
  await ev("buy('f1')");
  await sleep(250);
  ok(await ev('S.orders.length') === 1, '兑换后生成 1 张兑换单');
  ok(await ev('S.orders[0].status') === 'wait', '单据状态 = 待兑现');
  ok(await ev('S.orders[0].name') === '零食自选一份', '单据商品名正确');
  ok(await ev('S.orders[0].price') === 60, '单据金额 = 60');
  ok(await ev('S.coins') === c0 - 60, `币扣了 60（${c0} → ${await ev('S.coins')}）`);
  ok(await ev('S.orders[0].due') === '当天', '兑现期限 = 当天');
  ok(await ev('document.body.innerText.includes("待兑现")'), '商店页出现「待兑现」区');
  ok(await ev('document.body.innerText.includes("零食自选一份")'), '待兑现列表里能看到这一项');

  console.log('\n===== C · 已兑现 =====');
  const oid = await ev('S.orders[0].id');
  await ev(`orderDone('${oid}')`);
  await sleep(220);
  ok(await ev('S.orders[0].status') === 'done', '状态转为已兑现');
  ok(await ev('S.orders[0].doneAt > 0'), '记录了兑现时间');
  ok(await ev('waitOrders().length') === 0, '待兑现列表清空');
  ok(await ev('[].slice.call(document.querySelectorAll(".sec-h h2")).every(function(h){return h.textContent.trim()!=="待兑现";})'), '商店页不再显示待兑现区');

  console.log('\n===== D · 驳回要退币 =====');
  await ev('S.orders=[]; S.coins=1000; save(); render();');
  await ev("buy('f2')");
  await sleep(220);
  const before = await ev('S.coins');
  const oid2 = await ev('S.orders[0].id');
  await ev(`orderReject('${oid2}')`);
  await sleep(220);
  ok(await ev('S.orders[0].status') === 'rejected', '状态转为已驳回');
  ok(await ev('S.coins') === before + 120, `币退回来了 120（${before} → ${await ev('S.coins')}）`);
  ok(await ev('S.orders[0].refunded') === true, '标记已退币，不会重复退');
  await ev(`orderReject('${oid2}')`);
  await sleep(180);
  ok(await ev('S.coins') === before + 120, '再点一次不会重复退币');

  console.log('\n===== E · 盲盒必中，不出现空气 =====');
  await ev('S.orders=[]; S.coins=5000; save();');
  let gotOrder = 0, gotCoin = 0, bad = 0;
  for (let i = 0; i < 24; i++) {
    const n0 = await ev('S.orders.length');
    const c1 = await ev('S.coins');
    await ev("buy('c1')");
    await sleep(90);
    const n1 = await ev('S.orders.length');
    const c2 = await ev('S.coins');
    /* 抽一次的账：扣 100，抽到实物净扣 100，抽到积分回馈净扣 50。
       用「单子涨了」或「只扣了 50」两种方式认定有产物，两者都不是才是空气。 */
    if (n1 > n0) gotOrder++;
    else if (c2 - c1 === -50) gotCoin++;
    else bad++;
    await ev('closeSheet && closeSheet();');
  }
  ok(bad === 0, `24 次抽奖全部有产物（落单 ${gotOrder} 次 / 返币 ${gotCoin} 次 / 空气 ${bad} 次）`);
  const names = await ev('JSON.stringify(LOTTERY_POOL.map(x=>x.name))');
  ok(String(names).indexOf('谢谢参与') < 0, '奖池里没有「谢谢参与」这类空气项');
  const allInPool = await ev('S.orders.every(o=>LOTTERY_POOL.some(p=>p.name===o.name))');
  ok(allInPool, '所有抽到的单子都在奖池清单内');

  console.log('\n===== F · 皮肤包真能换色 =====');
  await ev('S.haveSkin=false; S.skin="default"; S.coins=3000; save(); render();');
  ok(await ev("typeof pickSkin") === 'function', '皮肤切换函数存在');
  await ev("pickSkin('mint')");
  await sleep(150);
  ok(await ev('S.skin') === 'default', '没买皮肤包时换不了（仍是默认）');
  await ev("buy('c2')");
  await sleep(220);
  ok(await ev('S.haveSkin') === true, '买完标记为已拥有');
  ok(await ev('S.orders.some(o=>o.itemId==="c2")'), '皮肤包也落了一张单');
  const before2 = await ev('S.coins');
  await ev("buy('c2')");
  await sleep(180);
  ok(await ev('S.coins') === before2, '重复购买被挡住，不再扣币');
  await ev("S.skin='default'; S.timerTask=SCHEDULE[1].id; S.page='timer'; render();");
  await sleep(300);
  ok(await ev('!!document.querySelector(".skin-bar")'), '计时页出现皮肤切换条');
  ok(await ev('document.querySelectorAll(".skin-dot").length') === 4, '4 套配色可选');
  const col0 = await ev('document.querySelector("#g1 stop").getAttribute("stop-color")');
  await ev("pickSkin('sunset')");
  await sleep(400);
  ok(await ev('S.skin') === 'sunset', '换成日落配色');
  const col1 = await ev('document.querySelector("#g1 stop").getAttribute("stop-color")');
  ok(col0 !== col1, `圆环颜色真的变了（${col0} → ${col1}）`);
  await ev("S.page='home'; render();");

  console.log('\n===== G · 称号替代头像框 =====');
  await ev('S.haveTitle=false; S.title=""; save();');
  await ev("S.page='growth'; render();");
  await sleep(250);
  ok(await ev('!document.querySelector(".title-bar")'), '没买称号时不显示称号条');
  await ev("S.page='shop'; S.shopCat='collect'; render();");
  await sleep(200);
  ok(await ev("document.body.innerText.includes('专属称号')"), '商城里有「专属称号」这一项');
  ok(await ev("!document.body.innerText.includes('头像框')"), '「头像框」已消失（本就没有头像可挂）');
  await ev("buy('c3')");
  await sleep(220);
  ok(await ev('S.haveTitle') === true, '称号买到了');
  await ev("S.page='growth'; render();");
  await sleep(280);
  ok(await ev('!!document.querySelector(".title-bar")'), '成长页出现称号条');
  await ev('pickTitle()');
  await sleep(200);
  const t1 = await ev('S.title');
  ok(!!t1, `称号可以切换（当前 ${t1}）`);
  ok(await ev('document.querySelector(".title-chip").textContent') === await ev('curTitle()'), '称号条显示的就是当前称号');

  console.log('\n===== H · 家长端看得到欠什么 =====');
  await ev('S.orders=[]; S.coins=3000; save();');
  await ev("buy('f3')"); await sleep(150); await ev('closeSheet&&closeSheet();');
  await ev("buy('s1')"); await sleep(150); await ev('closeSheet&&closeSheet();');
  await sleep(200);
  const waitN = await ev('waitOrders().length');
  ok(waitN === 2, `孩子端下了 2 张单（实际 ${waitN}）`);
  await ev("S.role='parent'; S.page='p-home'; render();");
  await sleep(400);
  ok(await ev('document.body.innerText.includes("待兑现")'), '家长端出现「待兑现」区');
  ok(await ev('document.body.innerText.includes("奶茶")') || await ev('document.body.innerText.includes("零食")'), '家长端能看到具体商品名');
  ok(await ev('document.body.innerText.includes("已兑现")'), '家长端有「已兑现」按钮');
  ok(await ev('document.querySelectorAll(".p-card").length > 0'), '家长端卡片正常渲染');
  const pid = await ev('waitOrders()[0].id');
  await ev(`orderDone('${pid}')`);
  await sleep(250);
  ok(await ev('waitOrders().length') === 1, '家长点已兑现后少一张');

  console.log('\n===== I · 云端记录并回本地 =====');
  const merged = await ev(`(function(){
    S.orders=[]; 
    mergeRedeems([
      {id: 901, item_id:'s1', item_name:'换一部 20 分钟动画', price:80, status:'wait', note:'限期 当天', created_at:new Date().toISOString()},
      {id: 902, item_id:'f1', item_name:'零食自选一份', price:60, status:'done', note:'限期 当天', created_at:new Date().toISOString(), resolved_at:new Date().toISOString()}
    ]);
    return JSON.stringify(S.orders.map(o=>({cid:o.cid, name:o.name, st:o.status})));
  })()`);
  const arr = JSON.parse(merged);
  ok(arr.length === 2, `另一台设备下的 2 张单并进来了（${arr.length}）`);
  ok(arr.some(o => o.cid === 901 && o.st === 'wait'), '待兑现那条状态正确');
  ok(arr.some(o => o.cid === 902 && o.st === 'done'), '已兑现那条状态正确');
  ok(await ev('S.redeems.length') === 2, '云端原始记录也留下来了');

  console.log('\n===== J · 运行时异常 =====');
  await ev("S.role='child'; S.page='shop'; S.shopCat='collect'; render();");
  await sleep(300);
  ok(errors.length === 0, `零运行时异常（${errors.length} 个）`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('    !', String(e).split('\n')[0]));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试自身出错:', e); process.exit(1); });
