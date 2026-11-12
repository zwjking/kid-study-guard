/**
 * v1.3.0 验证：兑换单去重 + 退币闭环
 * 用法: node tools/test-refund.js <baseUrl>
 *
 * 这一版修两件事：
 * 1) 买一次、兑现区出现两个 —— 本地单和云端副本没归一
 * 2) 退币只加币不还商品，且孩子端毫无感知、家长点错了撤不回
 */
const { spawn } = require('child_process');
const path = require('path');

const BASE = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const PORT = 9344;
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
  const url = BASE + (BASE.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
  await send('Page.navigate', { url }, sessionId);
  await sleep(3200);
  await ev('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url }, sessionId);
  await sleep(3000);
  await ev('var g=document.getElementById("authGate"); if(g) g.remove(); document.body.classList.remove("auth-locked");');
  await ev('S.role="child"; S.page="shop"; S.synced=false; S.coins=99999; S.owned=[]; S.orders=[]; S.refundLog=[];');

  console.log('\n===== A · 买一次只出现一条 =====');
  await ev('window.__i = SHOP.find(i => !i.lottery && !i.approve && i.id!=="c2" && i.id!=="c3"); buy(__i.id);');
  await sleep(200);
  ok(await ev('S.orders.length') === 1, '兑换一次生成 1 张单');
  ok(await ev('waitOrders().length') === 1, '待兑现列表只有 1 条');
  const orderId = await ev('S.orders[0].id');

  console.log('\n===== B · 云端副本归一（就是这个 BUG 的根因） =====');
  // 模拟：本地那条 cid 已写、云端又补了一条同 cid 的副本
  await ev(`(function(){
    var o = S.orders[0]; o.cid = 501;
    S.orders.push({ id:'rcopy', cid:501, itemId:o.itemId, name:o.name, price:o.price,
      due:o.due, at:o.at, status:'wait', doneAt:null, fromCloud:true });
  })()`);
  ok(await ev('S.orders.length') === 2, '脏数据：同 cid 两条并存');
  ok(await ev('waitOrders().length') === 1, '渲染层已去重，只显示 1 条');

  await ev('dedupeOrders()');
  ok(await ev('S.orders.length') === 1, 'dedupeOrders 合并同 cid 副本');
  ok(await ev('!S.orders[0].fromCloud'), '保留的是本地那条（有真实下单时刻）');

  // 另一种脏法：本地单 cid 没写上，云端副本单独存在
  await ev(`(function(){
    S.orders = [{ id:'olocal', cid:null, itemId:'zz', name:'测试项', price:80,
      due:'当天', at:Date.now()-1000, status:'wait', doneAt:null }];
    S.orders.push({ id:'rcl', cid:777, itemId:'zz', name:'测试项', price:80,
      due:'当天', at:Date.now(), status:'wait', doneAt:null, fromCloud:true });
  })()`);
  await ev('dedupeOrders()');
  ok(await ev('S.orders.length') === 1, 'cid 为空的本地单认领同商品副本');
  ok(await ev('S.orders[0].cid') === 777, 'cid 已从副本并过来');
  ok(await ev('!S.orders[0].fromCloud'), '留下的是本地单');

  // 不同商品不该被误合并
  await ev(`(function(){
    S.orders = [
      { id:'a1', cid:null, itemId:'aa', name:'甲', price:50, due:'当天', at:Date.now(), status:'wait' },
      { id:'b1', cid:null, itemId:'bb', name:'乙', price:50, due:'当天', at:Date.now(), status:'wait' }
    ];
  })()`);
  await ev('dedupeOrders()');
  ok(await ev('S.orders.length') === 2, '不同商品不会被误合并');

  console.log('\n===== C · 家长点退币 =====');
  await ev('S.role="parent"; S.orders=[{id:"o1",cid:null,itemId:"c1",name:"测试商品",price:120,due:"当天",at:Date.now(),status:"wait"}]; S.coins=500;');
  const coinsBefore = await ev('S.coins');
  await ev('orderReject("o1")');
  ok(await ev('S.orders[0].status') === 'rejected', '状态改为 rejected');
  ok(await ev('S.coins') === coinsBefore, '家长端不加币（架构约束：coins 只认孩子端）');
  ok(await ev('waitOrders().length') === 0, '待兑现里消失');

  console.log('\n===== D · 孩子端结算退币 =====');
  await ev('S.role="child"; S.coins=500; S.owned=["c1"]; S.refundLog=[]; S.orders=[{id:"o1",cid:null,itemId:"c1",name:"测试商品",price:120,due:"当天",at:Date.now(),status:"wait"}];');
  await ev(`mergeRedeems([{ id:9, item_id:'c1', item_name:'测试商品', price:120,
      status:'rejected', note:'限期 当天', created_at:new Date().toISOString(),
      resolved_at:new Date().toISOString() }])`);
  ok(await ev('S.coins') === 620, '孩子端加回 120 币');
  ok(await ev('S.owned.indexOf("c1")') === -1, '商品所有权一并回滚，商店不再显示已拥有');
  ok(await ev('(S.refundLog||[]).length') === 1, '退币记录留痕，孩子看得到原因');

  const c2 = await ev('S.coins');
  await ev(`mergeRedeems([{ id:9, item_id:'c1', item_name:'测试商品', price:120,
      status:'rejected', note:'限期 当天', created_at:new Date().toISOString(),
      resolved_at:new Date().toISOString() }])`);
  ok(await ev('S.coins') === c2, '重复同步不重复加币（幂等）');

  console.log('\n===== E · 皮肤包和称号只退币、不夺权限 =====');
  await ev('S.coins=0; S.owned=["c2"]; S.haveSkin=true; S.orders=[{id:"o2",cid:null,itemId:"c2",name:"皮肤包",price:300,due:"当天",at:Date.now(),status:"rejected"}];');
  await ev('refundIfNeeded(S.orders[0])');
  ok(await ev('S.coins') === 300, '皮肤包退币');
  ok(await ev('S.haveSkin') === true, '已选配色不被没收');
  ok(await ev('S.owned.indexOf("c2")') >= 0, 'owned 不动');

  console.log('\n===== F · 撤销退币 =====');
  await ev('S.role="parent"; S.coins=0; S.orders=[{id:"o3",cid:null,itemId:"c1",name:"测试商品",price:120,due:"当天",at:Date.now(),status:"rejected",refunded:true}]');
  await ev('orderUndoReject("o3"); document.querySelector(".sheet-mask .btn-primary, .sheet-mask .primary, .sheet-mask button:last-child").click();');
  await sleep(120);
  ok(await ev('S.orders[0].status') === 'wait', '撤销后回到待兑现');
  ok(await ev('S.orders[0].refunded') === false, 'refunded 标记清掉，下次驳回能再退');

  await ev('S.role="child"; S.coins=500; S.orders=[{id:"o3",cid:9,itemId:"c1",name:"测试商品",price:120,due:"当天",at:Date.now(),status:"rejected",refunded:true}]');
  await ev(`mergeRedeems([{ id:9, item_id:'c1', item_name:'测试商品', price:120,
      status:'wait', note:'限期 当天', created_at:new Date().toISOString(), resolved_at:null }])`);
  ok(await ev('S.orders[0].status') === 'wait', '孩子端同步到撤销，状态回等待');
  ok(await ev('S.coins') === 380, '孩子端把已退的 120 币扣回去');
  ok(await ev('S.orders[0].refunded') === false, '标记清掉');

  console.log('\n===== G · 界面 =====');
  await ev('S.role="parent"; S.page="p-home"; S.orders=[{id:"o9",cid:null,itemId:"c1",name:"看电影",price:200,due:"当晚",at:Date.now()-3600000,status:"rejected",doneAt:Date.now()}]; render();');
  await sleep(200);
  ok((await ev('document.body.innerText')).indexOf('已处理') >= 0, '家长端出现「已处理」区块');
  ok((await ev('document.body.innerText')).indexOf('撤销退币') >= 0, '驳回的单子可撤销');

  await ev('S.role="child"; S.page="shop"; S.refundLog=[{name:"看电影",price:200,at:Date.now()}]; S.orders=[]; render();');
  await sleep(200);
  const childTxt = await ev('document.body.innerText');
  ok(childTxt.indexOf('家长没同意') >= 0, '孩子端显示退币原因');
  ok(childTxt.indexOf('退回 200 币') >= 0, '孩子端显示退回多少币');

  console.log('\n===== H · 运行时异常 =====');
  ok(errors.length === 0, `零异常${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

  console.log(`\n===== 结果 ${pass} 通过 / ${fail} 失败 =====`);
  proc.kill();
  process.exit(fail ? 1 : 0);
})();
