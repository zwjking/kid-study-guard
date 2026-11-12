/**
 * v1.2.5 同步可靠性专项测试
 * 验证：唤醒入口是否真的发出请求、去重是否生效、看门狗能否自愈、状态行是否如实反映
 * 判定依据一律是可计数的请求次数与 DOM 实际文本，不靠截图肉眼判断。
 */
const { spawn } = require('child_process');

/* 这些用例验证的是工作日晚间排程，固定档位再跑，不受当天是星期几影响 */
const withWeek = u => u + (u.indexOf('?') >= 0 ? '&' : '?') + 'p=week';
const path = require('path'), fs = require('fs');
const CH = path.join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe');
const URL_P = process.argv[2] || 'http://127.0.0.1:8130/index.html';
const PORT = 9371, sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
  if (ok) { pass++; console.log('  ✔ ' + name + (extra ? '（' + extra + '）' : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '（' + extra + '）' : '')); }
};

(async () => {
  const proc = spawn(CH, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-proxy-server', '--proxy-bypass-list=*', '--remote-debugging-port=' + PORT, 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) {} }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const send = (m, p = {}, sid) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p, sessionId: sid })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { errs.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text); }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 414, height: 736, deviceScaleFactor: 2, mobile: true }, sessionId);
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) return '[异]' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || '').slice(0, 200);
    return r.result && r.result.value;
  };

  await send('Page.navigate', { url: withWeek(URL_P) }, sessionId);
  await sleep(4500);

  console.log('版本 =', await ev('window.APP_VERSION'));
  ck('版本为 v1.4.1', String(await ev('window.APP_VERSION')) === 'v1.4.1');

  /* ---------- 一、fetch 包装 ---------- */
  console.log('\n【一】云接口请求不走缓存');
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  const posWrap = html.indexOf("init.cache = 'no-store'");
  const posSdk = html.indexOf('cloud-sdk.es15.js');
  ck('包装脚本存在且设置 no-store', posWrap > 0);
  ck('包装在 SDK 加载之前（否则包不住）', posWrap > 0 && posWrap < posSdk, '包装@' + posWrap + ' SDK@' + posSdk);
  ck('运行时 fetch 已被替换（不是原生 toString）', String(await ev('String(window.fetch)')).indexOf('native code') < 0);

  // 用一个能记录参数的假 fetch 复现同一段注入逻辑，确认云域名会带上 no-store、其它域名不动
  const w1 = JSON.parse(await ev(`(function(){
    var out = {};
    var CLOUD = 'YOUR_APP_HOST';
    var mk = function(){ var seen=null; var f=function(input,init){
      try{var url=typeof input==='string'?input:(input&&input.url)||'';
        if(url&&url.indexOf(CLOUD)>=0){init=init?Object.assign({},init):{};if(init.cache===undefined)init.cache='no-store';}}catch(e){}
      seen={url:String(input),cache:init&&init.cache};return 'ok';};
      return {f:f, get:function(){return seen;}}; };
    var a=mk(); a.f(CLOUD+'/rest/v1/household'); out.cloud=(a.get()||{}).cache;
    var b=mk(); b.f('https://example.com/x'); out.other=(b.get()||{}).cache;
    var c=mk(); c.f(CLOUD+'/rest/v1/x',{cache:'force-cache'}); out.preset=(c.get()||{}).cache;
    return JSON.stringify(out);
  })()`));
  ck('云域名请求被标为 no-store', w1.cloud === 'no-store', 'cloud=' + w1.cloud);
  ck('非云域名不受影响', w1.other === undefined, 'other=' + w1.other);
  ck('已有 cache 设置不被覆盖', w1.preset === 'force-cache', 'preset=' + w1.preset);

  /* ---------- 二、唤醒入口 ---------- */
  console.log('\n【二】四种回到前台的方式都能触发同步');
  await ev(`(function(){
    AuthUI.hide();
    S.role='parent'; S.page='p-home'; S.synced=true; S._syncAt=Date.now();
    render();
    window.__n=0;
    Cloud.pull = async function(){ window.__n++; return null; };   // 只计数，不真的打网络
    App.startAutoRefresh();
    return 1;
  })()`);
  await sleep(500);
  ck('看板出现同步状态行', await ev('!!document.getElementById("syncBadge")'));

  const base = await ev('window.__n');
  await ev(`(function(){ document.dispatchEvent(new Event('visibilitychange')); return 1 })()`);
  await sleep(400);
  const n1 = await ev('window.__n');
  ck('visibilitychange 触发一次同步', n1 === base + 1, base + '→' + n1);

  await sleep(1400);   // 越过 1.2 秒去重窗口
  await ev(`(function(){ window.dispatchEvent(new Event('pageshow')); return 1 })()`);
  await sleep(400);
  const n2 = await ev('window.__n');
  ck('pageshow（bfcache 恢复）触发一次', n2 === n1 + 1, n1 + '→' + n2);

  await sleep(1400);
  await ev(`(function(){ window.dispatchEvent(new Event('focus')); return 1 })()`);
  await sleep(400);
  const n3 = await ev('window.__n');
  ck('focus 触发一次', n3 === n2 + 1, n2 + '→' + n3);

  await sleep(1400);
  await ev(`(function(){ window.dispatchEvent(new Event('online')); return 1 })()`);
  await sleep(400);
  const n4 = await ev('window.__n');
  ck('online 触发一次', n4 === n3 + 1, n3 + '→' + n4);

  await sleep(1400);
  await ev(`(function(){ document.dispatchEvent(new Event('resume')); return 1 })()`);
  await sleep(400);
  const n5 = await ev('window.__n');
  ck('resume 触发一次', n5 === n4 + 1, n4 + '→' + n5);

  // 去重：同一瞬间连发四个事件，只应发一次请求
  await sleep(1400);
  const b2 = await ev('window.__n');
  await ev(`(function(){
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    return 1;
  })()`);
  await sleep(600);
  const n6 = await ev('window.__n');
  ck('四事件并发只发一次（去重生效）', n6 === b2 + 1, b2 + '→' + n6);

  // 有弹窗时不打断
  await sleep(1400);
  const b3 = await ev('window.__n');
  await ev(`(function(){ var d=document.createElement('div'); d.className='sheet-mask'; d.id='__m'; document.body.appendChild(d); window.dispatchEvent(new Event('focus')); return 1 })()`);
  await sleep(500);
  const n7 = await ev('window.__n');
  ck('弹窗打开时不重绘、不打断', n7 === b3, b3 + '→' + n7);
  await ev(`(function(){ var d=document.getElementById('__m'); if(d) d.remove(); return 1 })()`);

  /* ---------- 三、状态行 ---------- */
  console.log('\n【三】同步状态如实反映');
  const txtBad = String(await ev('document.getElementById("syncBadge").textContent')).trim();
  ck('失败时显示「连接不上」并给重试入口', txtBad.indexOf('连接不上') >= 0, txtBad);
  ck('失败态是按钮，可点重试', await ev('document.querySelector(".sync-line.bad") && document.querySelector(".sync-line.bad").tagName') === 'BUTTON');

  await ev(`(function(){ S._syncErr=false; S._syncAt=new Date(2026,10,2,21,12,0).getTime(); refreshSyncBadge(); return 1 })()`);
  const txtOk = String(await ev('document.getElementById("syncBadge").textContent')).trim();
  ck('成功后显示已同步时间', txtOk === '已同步 21:12', txtOk);

  await ev(`(function(){ S.role='child'; S.page='home'; render(); return 1 })()`);
  await sleep(400);
  ck('孩子端不显示这行字（保持干净）', (await ev('!!document.getElementById("syncBadge")')) === false);
  await ev(`(function(){ S.role='parent'; S.page='p-home'; render(); return 1 })()`);

  /* ---------- 四、看门狗 ---------- */
  console.log('\n【四】看门狗：70 秒没成功就自动补拉（等 16 秒实测）');
  // 只留看门狗，停掉 25 秒轮询，避免两种机制混在一起数不清是谁拉的
  await ev(`(function(){ if(App._auto) clearInterval(App._auto); S._syncAt = Date.now() - 80000; window.__n=0; return 1 })()`);
  await sleep(16000);
  const nwd = await ev('window.__n');
  ck('超时未同步时自动补拉', nwd >= 1, '补拉 ' + nwd + ' 次');

  // 刚成功过就不该补拉
  await ev(`(function(){ S._syncAt = Date.now(); window.__n=0; return 1 })()`);
  await sleep(16000);
  const nwd2 = await ev('window.__n');
  ck('刚同步过不重复拉（看门狗不空转）', nwd2 === 0, '补拉 ' + nwd2 + ' 次');

  /* ---------- 五、轮询间隔 ---------- */
  const appjs = fs.readFileSync(path.join(__dirname, '../web/assets/app.js'), 'utf8');
  ck('轮询从 45 秒缩短到 25 秒', appjs.indexOf('}, 25000);') > 0 && appjs.indexOf('}, 45000);') < 0);
  ck('看门狗间隔 15 秒', appjs.indexOf('}, 15000);') > 0);

  console.log('\n异常 = ' + (errs.length ? errs.join(' | ').slice(0, 400) : '（无）'));
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  ws.close(); proc.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
