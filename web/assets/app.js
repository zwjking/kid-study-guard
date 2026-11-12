/* ===========================================================
   学习守护 · 原型逻辑
   =========================================================== */

/* ---------- 工具 ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const pad = n => String(n).padStart(2, '0');
const fmt = m => pad(Math.floor(m / 60)) + ':' + pad(Math.round(m % 60));
/* ---------- 三套时间窗：工作日 / 周六 / 周日 ----------
   工作日是晚上两小时；周日是孩子自己定的下午两点到六点；
   周六不排时间轴，走自主计划板（weekend.js）。
   下面三个必须是 let —— 跨天和切到周末时要在运行期换掉。 */
const STORE_VER = 2;              // 存档结构版本，用于一次性迁移

const PROFILES = {
  week: {
    key: 'week', label: '工作日',
    start: 19 * 60, wrap: 21 * 60,
    tailPractice: 35, tailPlain: 20     // 练习15+休息5+复习8+预习5+收工2 / 去掉练习
  },
  sun: {
    key: 'sun', label: '周日',
    start: 14 * 60, wrap: 18 * 60,
    tailPractice: 150, tailPlain: 145   // 练习15+5 + 复盘25+5 + 预习25+5 + 阅读30 + 整理20 + 缓冲30
  },
  sat: {
    key: 'sat', label: '周六',
    start: 9 * 60 + 30, wrap: 11 * 60,
    tailPractice: 0, tailPlain: 0
  }
};

let ACTIVE_PROFILE = PROFILES.week;
let LIGHT_OUT = 21 * 60 + 30;
let DAY_START = PROFILES.week.start;
let WRAP_LINE = PROFILES.week.wrap;

/* 排程常量。必须定义在 buildSchedule 被调用之前 —— const 有暂时性死区，
   放在文件后面会导致启动时直接抛 ReferenceError。 */
const SEG_BREAK = 5;              // 每块作业之后的休息分钟数
const TAIL_MIN = 35;              // 工作日固定尾段（含练习）
const TAIL_NO_PRACTICE = 20;      // 工作日尾段去掉练习

/* 星期判定：0 = 周日，6 = 周六。
   PROFILE_OVERRIDE 只供验收脚本固定档位（网址加 ?p=week|sat|sun），
   正常访问不带这个参数，恒为 null，按真实星期走。 */
let PROFILE_OVERRIDE = (() => {
  try {
    const p = new URLSearchParams(location.search).get('p');
    return p && PROFILES[p] ? p : null;
  } catch (e) { return null; }
})();

function profileFor(d) {
  if (PROFILE_OVERRIDE && PROFILES[PROFILE_OVERRIDE]) return PROFILES[PROFILE_OVERRIDE];
  const wd = (d || new Date()).getDay();
  return wd === 6 ? PROFILES.sat : wd === 0 ? PROFILES.sun : PROFILES.week;
}
function applyDayProfile(p) {
  ACTIVE_PROFILE = p || profileFor(new Date());
  DAY_START = ACTIVE_PROFILE.start;
  WRAP_LINE = ACTIVE_PROFILE.wrap;
  return ACTIVE_PROFILE;
}
function isSaturday() { return ACTIVE_PROFILE.key === 'sat'; }
function isSunday() { return ACTIVE_PROFILE.key === 'sun'; }

/* 界面上的时间词：周日是下午四小时，不是晚上两小时。
   写死「今晚」会让周日下午的提示全错。 */
function todayWord() { return isSunday() ? '今天下午' : '今晚'; }

/* 每次渲染前对一次日历：跨过午夜、或从周五进到周六，时间窗要跟着换。
   切了 profile 必须重建时间轴，否则 19:00 的旧块会留在周日下午的页面上。 */
function ensureDayProfile() {
  const p = profileFor(new Date());
  const changed = S._profileKey !== p.key;
  S._profileKey = p.key;
  applyDayProfile(p);
  if (changed && S.tasks) rebuildSchedule();
  return changed;
}

/* 演示模式：只有验收时在链接后面加 ?demo=1 才开启。
   孩子端、家长端默认都是真实时间，页面上不出现任何加速入口。 */
const DEMO = (() => {
  try { return new URLSearchParams(location.search).get('demo') === '1'; } catch (e) { return false; }
})();

/* 真实时间，单位分钟（0–1439） */
function realNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/* ---------- 状态 ---------- */
const KEY = 'study-guardian-v1';

/* 时间轴由「固定框架 + 动态作业项」拼出来，每次作业项变化就重建一次。
   渲染层只读 SCHEDULE，所以重建后所有界面自动跟着变。 */
let SCHEDULE = [];

function defaultState() {
  const tasks = {};
  SCHEDULE.forEach(s => { tasks[s.id] = { status: 'todo', evidence: null, evidencePath: null, evidenceMime: null, evidenceAt: null }; });
  return {
    role: 'child',
    page: 'home',
    clock: DAY_START,        // 仅演示模式（?demo=1）用的虚拟时钟，真实模式不读它
    speed: DEMO ? 1 : 0,     // 仅演示模式用的加速开关，真实模式恒为 0
    afterHours: false,       // 熄灯后点了"继续补"才为 true
    _v: STORE_VER,
    items: [],               // 今日作业项（动态），时间轴由它生成
    tasks,
    coins: 380,
    earnedToday: 0,
    streak: 7,
    reworkFlag: false,
    shopCat: 'screen',
    owned: [],
    pending: [],
    orders: [],            // 兑换单：扣了币就得留一张，否则孩子拿不到凭证、家长不知道欠什么
    refundLog: [],         // 最近被驳回退币的单子，孩子端要有个说法
    pet: null,             // 当前宠物，null = 还没领养或在回忆册里
    petBag: {},            // 宠物耗材：{ 用品id: 份数 }
    petOwn: [],            // 宠物买断品：玩具 / 家具 / 装扮
    petGrave: [],          // 回忆册：走掉的宠物，永久留存
    skin: 'default',       // 当前计时页配色
    title: '',             // 当前显示的称号（空 = 不显示）
    haveSkin: false,       // 是否买过皮肤包
    haveTitle: false,      // 是否买过称号
    redeems: [],           // 云端兑换记录（家长端读这个，以前拉回来就丢了）
    books: JSON.parse(JSON.stringify(BOOKS)),
    history: [],
    lastDoneAt: null,
    planDate: null,        // 云端对齐的日期（YYYY-MM-DD）
    familyCode: null,      // 6 位家庭码，首次推送时生成
    childName: '孩子',
    synced: false,         // 是否已完成一次云端同步
    _dirty: {},            // 本地改过、还没推上云的任务 id（防止全量覆盖对面设备的进度）
    _dirtyAll: true        // 全新设备首次同步时把整份任务推上去
  };
}

let S = load();
/* 老存档可能带着 v1.2.9 留下的重复兑换单，开机先归一一次 */
dedupeOrders();

/* 今天还没结束，不能出现在「历史」里。
   v1.4.0 的同步故障把云端日期卡在旧的一天，每次同步都误判跨天，
   顺手把「今天」的半截快照归档进了 history。这里开机清一次。 */
try {
  const _todayStr = (function () {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  })();
  if (Array.isArray(S.history)) {
    S.history = S.history.filter(h => h && h.date && h.date < _todayStr);
  }
} catch (e) {}

/* 重建时间轴：从存档里的作业项生成，再补齐每块的完成状态 */
SCHEDULE = buildSchedule(S.items);
SCHEDULE.forEach(s => {
  if (!S.tasks[s.id]) {
    S.tasks[s.id] = { status: 'todo', evidence: null, evidencePath: null, evidenceMime: null, evidenceAt: null };
  }
});

/* 角色锁定：网页带 ?role=child / ?role=parent 时锁死；APK 由壳注入。
   不带参数时（本地验收）保留右上角的切换按钮。 */
const FORCED_ROLE = (() => {
  try {
    const v = new URLSearchParams(location.search).get('role');
    return (v === 'child' || v === 'parent') ? v : null;
  } catch (e) { return null; }
})();

if (FORCED_ROLE) {
  S.role = FORCED_ROLE;
  S.page = FORCED_ROLE === 'parent' ? 'p-home' : 'home';
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && o.tasks) {
        const s = Object.assign(defaultState(), o);
        // v1 存档把「演示加速」当默认开着存了下来，这里强制收回实时
        if (!o._v || o._v < STORE_VER) { s.speed = 0; s.clock = DAY_START; s._v = STORE_VER; }
        if (!DEMO) s.speed = 0;      // 非演示模式下加速永不生效，哪怕存档里写着 1
        // 旧结构是固定 8 个科目块，没有 items 字段。升级后旧块状态作废，重新列作业。
        if (!Array.isArray(o.items)) { s.items = []; s.tasks = {}; }
        return s;
      }
    }
  } catch (e) {}
  return defaultState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  queueSync();
}

/* 记下本地改过的任务，推送时只发这些，避免覆盖另一端的进度 */
function markDirty(id) {
  if (!id) return;
  if (!S._dirty) S._dirty = {};
  S._dirty[id] = 1;
}

/* ===========================================================
   排程引擎
   作业项 → 时间轴。三条规则：
   1) 思考型排最前（精力高峰），机械型居中，记忆型放最后（睡前巩固）
   2) 单段不超过类型上限，作文这类长的强制拆成两段，中间必须休息
   3) 总量超过收工线就如实报出来，不假装能塞进去
   =========================================================== */

/* 排程常量见文件顶部（buildSchedule 启动时就会被调用，必须提前定义） */

function splitItem(it) {
  const cap = (ITEM_TYPES[it.type] || ITEM_TYPES.mech).cap;
  const est = Math.max(5, Number(it.est) || 10);
  if (est <= cap) return [{ itemId: it.id, item: it, dur: est, part: 1, parts: 1 }];
  const parts = Math.ceil(est / cap);
  const out = [];
  let left = est;
  for (let p = 1; p <= parts; p++) {
    const d = Math.min(left, cap);
    out.push({ itemId: it.id, item: it, dur: d, part: p, parts: parts });
    left -= d;
    if (left <= 0) break;
  }
  return out;
}

/* 排序：思考型优先，太长时中间插一个机械型当缓冲，记忆型压最后。
   机械型内部按科目聚在一起 —— 孩子的换本子成本不低，别让她来回翻。 */
function orderItems(items) {
  const g = { think: [], mech: [], mem: [] };
  items.forEach(i => { (g[i.type] || g.mech).push(i); });
  TYPE_ORDER.forEach(k => g[k].sort((a, b) => (b.est || 0) - (a.est || 0)));

  // 机械型按科目聚合：同一科的排在一起，科目之间按总时长降序
  const bySub = {};
  g.mech.forEach(i => { const s = i.subject || '其他'; (bySub[s] = bySub[s] || []).push(i); });
  const subOrder = Object.keys(bySub).sort((a, b) => {
    const sa = bySub[a].reduce((x, i) => x + (i.est || 0), 0);
    const sb = bySub[b].reduce((x, i) => x + (i.est || 0), 0);
    return sb - sa;
  });
  const mechList = [];
  subOrder.forEach(s => {
    bySub[s].sort((a, b) => (b.est || 0) - (a.est || 0));
    mechList.push(...bySub[s]);
  });

  const out = [];
  const thinkTotal = g.think.reduce((a, i) => a + (i.est || 0), 0);

  if (g.think.length && thinkTotal > 40 && mechList.length) {
    // 思考型总量超过 40 分钟，前半段思考 → 一个机械活换脑子 → 后半段思考
    const half = Math.ceil(g.think.length / 2);
    out.push(...g.think.slice(0, half));
    out.push(mechList.shift());
    out.push(...g.think.slice(half));
  } else {
    out.push(...g.think);
  }
  out.push(...mechList);
  out.push(...g.mem);
  return out;
}

/* 一段作业项是否算「已交」：优先看任务行（家长可能已退回，退回要重排），
   其次才看作业项自身的状态。 */
function segIsDone(id, item) {
  const tk = S.tasks[id];
  if (tk) return tk.status === 'done';
  return !!(item && item.status === 'done');
}

/* 生成时间轴。items 为空时只出框架块，首页会引导去列作业。
   v1.2.3：做完的作业项不再从清单里删掉，而是留在时间轴上占 0 分钟。
   以前直接过滤掉，同时错三件事：
     ① 孩子做完一项，进度分母跟着变小，「做完反而没进度」；
     ② 家长端拿不到这一项，做完的作业看不见，也没法退回重查；
     ③ 云端已交的照片记录对不上任务行，被整条丢弃。 */
function buildSchedule(items) {
  const all = (items || []).filter(i => i.status !== 'skipped');
  const out = [];
  let t = DAY_START;

  /* 周六：不排时间轴。给一个占位块，让依赖 SCHEDULE 的逻辑不至于空转，
     首页会被 renderSaturday() 整个接管，这块不会出现在孩子眼前。 */
  if (ACTIVE_PROFILE.key === 'sat') {
    return [{
      id: 'satfree', start: DAY_START, dur: 0, kind: 'free', grid: null, icon: 'bolt',
      title: '周六 · 自己安排', desc: '今天没有固定清单，想做什么自己定。', slot: '自由'
    }];
  }

  out.push({
    id: 'warmup', start: t, dur: 10, kind: 'ritual', grid: null, icon: 'bolt',
    title: '启动仪式 + 热身',
    desc: isSunday()
      ? '收桌面、看一眼今天要做哪几件。下午刚睡醒，先用低负荷的开工。'
      : '收拾书包、口算 10 题。饭后低谷只做低负荷。'
  });
  t += 10;

  /* 先按原规则排好顺序，再按「已交 / 未交」分成两批。
     已交的统一沉到最上面（不影响后面的时间），未交的照常占时间。 */
  const doneSegs = [];
  const todoSegs = [];
  orderItems(all).forEach(it => {
    splitItem(it).forEach(p => {
      const id = 'it' + p.itemId + (p.parts > 1 ? '-' + p.part : '');
      (segIsDone(id, p.item) ? doneSegs : todoSegs).push({ p, id });
    });
  });

  const segOf = (p, id, done) => {
    const sub = p.item.subject || '';
    return {
      id, start: t, dur: done ? 0 : p.dur, kind: 'hw', grid: 'homework',
      icon: p.item.type === 'think' ? 'book' : p.item.type === 'mem' ? 'recall' : 'pen',
      subject: sub, itemId: p.itemId, part: p.part, parts: p.parts, done,
      title: `${sub} · ${p.item.name}` + (p.parts > 1 ? ` · ${p.part}/${p.parts}` : ''),
      desc: ITEM_TYPES[p.item.type].desc
    };
  };

  // 已交的：占 0 分钟，也不给它排后面的休息
  doneSegs.forEach(({ p, id }) => out.push(segOf(p, id, true)));

  todoSegs.forEach(({ p, id }, i) => {
    out.push(segOf(p, id, false));
    t += p.dur;
    out.push({
      id: 'brk' + i, start: t, dur: SEG_BREAK, kind: 'break', grid: null, icon: 'rest',
      title: '起身动一下',
      desc: p.parts > 1 && p.part < p.parts ? '这段先停，剩下的不用一口气写完。' : '离开桌子，别碰平板。'
    });
    t += SEG_BREAK;
  });

  // 课外练习是软的，作业是硬的。
  // 作业量把时间吃光了，就让练习自动让位，别硬排出 21:10 这种结果。
  const canPractice = (WRAP_LINE - t - ACTIVE_PROFILE.tailPlain) >= 15;

  if (canPractice) {
    out.push({
      id: 'practice', start: t, dur: 15, kind: 'practice', grid: 'practice', icon: 'target',
      title: '课外练习 · 随机 15 题',
      desc: '数学 5 道、语文 5 道、英语 5 道，一科一段，答完当场判分。'
    });
    t += 15;

    out.push({
      id: 'brk-p', start: t, dur: 5, kind: 'break', grid: null, icon: 'rest',
      title: '休息',
      desc: isSunday()
        ? '接下来是复盘和预习，先放松一下。'
        : '马上进睡前黄金窗口，先放松一下。'
    });
    t += 5;
  } else {
    // 不给练习，把最后一个作业后的休息延长，别让两段休息白挤在一起
    const lastBrk = out[out.length - 1];
    if (lastBrk && lastBrk.kind === 'break') {
      lastBrk.dur = 10;
      lastBrk.desc = (isSunday() ? '今天下午' : '今晚') + '作业偏多，这段多歇一会儿。';
      t += 5;
    }
  }

  if (isSunday()) {
    /* 周日下午四小时：作业只占五十分钟，剩下的全给「重要不紧急」。
       周末才有的整块时间，用来清一周的账、开下周的机，不是再多写几页题。 */
    out.push({
      id: 'review', start: t, dur: 25, kind: 'review', grid: 'review', icon: 'recall', locked: true,
      title: '本周错题复盘', desc: '把这周错过的题翻一遍。同一类错两次的，挑出来重做。'
    });
    t += 25;

    out.push({
      id: 'brk-r', start: t, dur: 5, kind: 'break', grid: null, icon: 'rest',
      title: '休息', desc: '站起来走两圈，别坐着。'
    });
    t += 5;

    out.push({
      id: 'preview', start: t, dur: 25, kind: 'preview', grid: 'preview', icon: 'eye', locked: true,
      title: '下周预习', desc: '语文读课文、数学看例题、英语过单词，各八分钟就够。'
    });
    t += 25;

    out.push({
      id: 'brk-p2', start: t, dur: 5, kind: 'break', grid: null, icon: 'rest',
      title: '休息', desc: '喝口水。'
    });
    t += 5;

    out.push({
      id: 'reading', start: t, dur: 30, kind: 'read', grid: 'read', icon: 'book',
      title: '自由阅读', desc: '自己挑书，不写读后感，也不考你。'
    });
    t += 30;

    out.push({
      id: 'tidyup', start: t, dur: 20, kind: 'wrap', grid: null, icon: 'flag',
      title: '整理书包 + 看本周战绩', desc: '按周一课表装好。这一步做完，这周就结束了。'
    });
    t += 20;

    /* 缓冲块不推云端、不算完成率 —— 它的作用是被超时吃掉。
       没有这一格，前面任何一块拖了，都会顺延成「全家赶工」。 */
    out.push({
      id: 'buffer', start: t, dur: 30, kind: 'buffer', grid: null, icon: 'rest',
      title: '机动缓冲', desc: '前面哪块超时，从这儿扣；没用完就归你。'
    });
    t += 30;
  } else {
    out.push({
      id: 'review', start: t, dur: 8, kind: 'review', grid: 'review', icon: 'recall', locked: true,
      title: '复习 · 合书复述', desc: '合上书，讲 30 秒今天学了什么。讲不出来就是没学会。'
    });
    t += 8;

    out.push({
      id: 'preview', start: t, dur: 5, kind: 'preview', grid: 'preview', icon: 'eye', locked: true,
      title: '预习 · 标 3 处不懂', desc: '明早 7:50，系统会问你昨晚标的这 3 个问题。'
    });
    t += 5;

    out.push({
      id: 'wrapup', start: t, dur: 2, kind: 'wrap', grid: null, icon: 'flag',
      title: '收工仪式', desc: '打勾、看今日战绩，给这一天一个句号。'
    });
    t += 2;
  }

  out.forEach(b => {
    // 已交的作业项不占时间，没有时间段可显示
    b.slot = (b.kind === 'hw' && b.dur === 0) ? '已完成' : fmt(b.start) + '–' + fmt(b.start + b.dur);
  });
  return out;
}

/* 预计收工时间 = 最后一块的结束时刻 */
function planEndTime() {
  const last = SCHEDULE[SCHEDULE.length - 1];
  return last ? last.start + last.dur : DAY_START;
}

/* 作业总量的账：需要多少分钟、有多少可用。
   练习能塞进 75 分钟就塞；塞不下就自动让位，容量放宽到 90 分钟。
   口径必须和 buildSchedule 一致：已交的段不占时间，被退回的段要重新算。 */
function planLoad() {
  const all = (S.items || []).filter(i => i.status !== 'skipped');
  const segs = [];
  const todoItems = new Set();
  orderItems(all).forEach(it => {
    splitItem(it).forEach(p => {
      const id = 'it' + p.itemId + (p.parts > 1 ? '-' + p.part : '');
      if (segIsDone(id, p.item)) return;
      segs.push(p);
      todoItems.add(p.itemId);
    });
  });

  const work = segs.reduce((a, p) => a + p.dur, 0);
  const brk = segs.length * SEG_BREAK;
  const need = work + brk;
  const havePractice = WRAP_LINE - (DAY_START + 10) - ACTIVE_PROFILE.tailPractice;
  const haveNoPractice = WRAP_LINE - (DAY_START + 10) - ACTIVE_PROFILE.tailPlain;
  const withPractice = need <= havePractice;
  const have = withPractice ? havePractice : haveNoPractice;
  const over = need - have;
  return { count: segs.length, work, brk, need, have, over, items: todoItems.size, withPractice };
}

/* 作业项变了就重建时间轴，再补齐新块的完成状态 */
function rebuildSchedule() {
  SCHEDULE = buildSchedule(S.items);
  SCHEDULE.forEach(s => {
    if (!S.tasks[s.id]) {
      S.tasks[s.id] = { status: 'todo', evidence: null, evidencePath: null, evidenceMime: null, evidenceAt: null };
    }
  });
}

/* ---------- 云端同步 ---------- */
function queueSync() {
  if (!S.synced || !window.Cloud) return;
  Cloud.schedule(pushAll, 700);
}

function buildTaskRows() {
  /* 休息、机动缓冲、周六占位块都不是「要做的事」，不推云端：
     推上去会拉低完成率，也会让家长在历史里看到一堆没意义的行。 */
  return SCHEDULE
    .filter(s => s.kind !== 'break' && s.kind !== 'buffer' && s.kind !== 'free')
    .map(s => {
    const t = S.tasks[s.id] || { status: 'todo', evidence: null };
    return {
      task_id: s.id,
      task_title: s.title,
      task_kind: s.kind,
      status: t.status || 'todo',
      evidence_type: t.evidence || null,
      evidence_path: t.evidencePath || null,
      evidence_mime: t.evidenceMime || null,
      evidence_at: t.evidenceAt || null,
      rework_reason: t.status === 'rework' ? '家长退回' : null,
      done_at: t.status === 'done' ? new Date().toISOString() : null
    };
  });
}

function buildHousehold() {
  const h = {
    child_name: S.childName || null,
    family_code: S.familyCode || null,
    coins: S.coins,
    earned_today: S.earnedToday,
    streak: S.streak,
    bonus_cleared: !!S.bonusCleared,
    plan_date: S.planDate || Cloud.today(),
    /* 宠物跟随 household 上云，不单开表。
       家长端要能看见孩子在养什么、养得怎么样，否则「养宠物」这件事
       在孩子眼里就是单机的，缺少被看见的分量。 */
    pet: S.pet || null,
    pet_bag: S.petBag || {},
    pet_own: S.petOwn || [],
    pet_grave: S.petGrave || []
  };
  // 作业清单归孩子端所有。家长端本地清单为空时不能回写，
  // 否则一刷新就把孩子列好的作业抹掉；孩子端删光清单是合法操作，照常推。
  if (S.role === 'child' || (S.items || []).length) {
    h.plan_items = S.items || [];
  }
  return h;
}

function buildBookRows() {
  return S.books.map(b => ({
    name: b.name,
    subject: b.subject || '综合',
    total_pages: b.total,
    done_pages: b.done
  }));
}

async function pushAll() {
  if (!S.synced) return;
  if (!S.planDate) S.planDate = Cloud.today();

  /* 只推本地真正改过的任务行。
     全量推会让「家长端点退回」把孩子在另一台设备上刚完成、刚挣到的记录冲掉。 */
  const all = buildTaskRows();
  const rows = S._dirtyAll ? all : all.filter(r => S._dirty && S._dirty[r.task_id]);
  if (rows.length) {
    const ok = await Cloud.pushTasks(rows, S.planDate);
    if (ok) { S._dirty = {}; S._dirtyAll = false; }
  }

  /* 积分、家庭码、作业清单归孩子端所有。
     家长端只改任务状态，不回写这些，否则它手里的旧快照会盖掉孩子刚挣的币。 */
  if (S.role === 'child') {
    await Cloud.pushHousehold(buildHousehold());
    if (S.books.length) await Cloud.pushBooks(buildBookRows());
  }
}

function genFamilyCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* 跨天前把这一天存成本地快照。
   云端 day_tasks 有任务状态，但练习成绩和周六清单没上云，
   这两项只有本机有 —— 归档必须带上，否则历史里永远缺一块。 */
function archiveDaySnapshot() {
  const day = S.planDate;
  if (!day) return;
  /* 今天还没过完，归档进去就是半截记录。
     同步故障期间「误判跨天 → 清空 → 归档」会把当天的残缺快照反复塞进历史，
     家长端看到的就是一条莫名其妙的「今天」。这条直接把口子堵死。 */
  if (day === Cloud.today()) return;
  const rows = SCHEDULE.filter(s => s.kind !== 'break' && s.kind !== 'buffer' && s.kind !== 'free');
  if (!rows.length) return;

  const touched = rows.some(s => {
    const t = S.tasks[s.id];
    return t && t.status && t.status !== 'todo';
  });
  const prac = (S.practice && S.practice.done && S.practice.date === day) ? S.practice : null;
  const satHit = (S.satPlan && S.satPlan.date === day && S.satPlan.items && S.satPlan.items.length)
    ? S.satPlan : null;
  if (!touched && !prac && !satHit) return;      // 这一天什么都没有，不占历史坑位

  const snap = {
    date: day,
    items: (S.items || []).map(i => ({ id: i.id, name: i.name, subject: i.subject, type: i.type })),
    tasks: {},
    practice: prac ? { right: prac.right || 0, total: prac.total || 0 } : null,
    satPlan: satHit
  };
  rows.forEach(s => {
    const t = S.tasks[s.id] || {};
    snap.tasks[s.id] = { title: s.title, kind: s.kind, status: t.status || 'todo', evidence: t.evidence || null };
  });

  S.history = (S.history || []).filter(h => h && h.date !== day);
  S.history.unshift(snap);
  S.history = S.history.slice(0, 30);
}

function resetTasksForNewDay() {
  archiveDaySnapshot();          // 先存再清。不存的话，昨天就真的没了
  // 新的一天从零开始：作业项清空，孩子重新列一遍（这个动作每天都要做，是训练）
  S.items = [];
  S.tasks = {};
  rebuildSchedule();
  S.earnedToday = 0;
  S.bonusCleared = false;
  S.clock = DAY_START;
  S.afterHours = false;
  S.reworkFlag = false;
  S._dirty = {};
  S._dirtyAll = false;
}

/* 把云端数据合到本地状态 */
function applyRemote(r) {
  if (!r) return false;
  const today = r.day;
  const h = r.household || {};
  let dayChanged = false;

  // 跨天：云端还停在旧的一天，本地是否也要跟着清？
  // 只有「本地也还停在旧的一天」才清。
  // 本地 planDate 已经是今天，说明今天要么已经列过清单、要么已经清过一次；
  // 此时云端落后只能代表推送没成功，再清一次就是把孩子刚列好的清单吃掉。
  // v1.4.0 的「周日清单列完就消失」就是这条被云端旧日期反复触发。
  if (h.plan_date && h.plan_date !== today) {
    if (S.planDate !== today) {
      dayChanged = true;
      resetTasksForNewDay();
    } else {
      // 本地已是今天：补推一次，把云端的 plan_date 追平，而不是清本地
      S._needPush = true;
      S._dirtyAll = true;
    }
  }

  S.coins = typeof h.coins === 'number' ? h.coins : S.coins;
  S.earnedToday = typeof h.earned_today === 'number' ? h.earned_today : 0;
  S.streak = typeof h.streak === 'number' ? h.streak : 0;
  S.bonusCleared = !!h.bonus_cleared;
  S.familyCode = h.family_code || null;
  S.childName = h.child_name || S.childName;

  /* 宠物合并。规则和孩子端写 coins 一致：孩子端本地是权威，
     家长端只拿快照看，不回写。
     「本地有」的判定用 pet 或 petGrave —— 宠物死光后 pet 是 null，
     只看 pet 会把云端旧数据当成「从没养过」，把死掉的宠物复活回来。 */
  if (S.role === 'child') {
    const localHasPet = !!S.pet || (S.petGrave || []).length > 0;
    if (!localHasPet) {
      S.pet = h.pet || null;
      S.petBag = h.pet_bag || {};
      S.petOwn = h.pet_own || [];
      S.petGrave = h.pet_grave || [];
    } else {
      /* 本地权威：只从云端补它独有的买断品和回忆册条目（另一台设备买的/死的） */
      const gKeys = new Set((S.petGrave || []).map(g => g.name + '|' + g.died));
      (h.pet_grave || []).forEach(g => {
        if (!gKeys.has(g.name + '|' + g.died)) { (S.petGrave || (S.petGrave = [])).unshift(g); gKeys.add(g.name + '|' + g.died); }
      });
      (h.pet_own || []).forEach(id => {
        if ((S.petOwn || []).indexOf(id) < 0) { (S.petOwn || (S.petOwn = [])).push(id); S._needPush = true; }
      });
    }
  } else {
    /* 家长端：只读快照。绝不清掉，也绝不回写 */
    S.pet = h.pet || null;
    S.petOwn = h.pet_own || [];
    S.petGrave = h.pet_grave || [];
    if (!S.petBag) S.petBag = {};
  }

  /* 作业清单必须先落地，时间轴由它生成；
     时间轴有了，下面挂任务状态才有对应的 id 可接。
     不先做这一步，家长端会因为 S.tasks 为空把云端记录全部丢弃。 */
  if (!dayChanged && Array.isArray(h.plan_items)) {
    const remoteItems = h.plan_items;
    const localItems = S.items || [];
    /* 迁移保护：v1.2.0 的清单从来没上过云，孩子端本地那份才是真的。
       同一天、云端空、本地有 → 保留本地的，稍后补推上去，别把它抹掉。 */
    const keepLocal = S.role === 'child' && remoteItems.length === 0 &&
                      localItems.length > 0 && S.planDate === today;
    if (!keepLocal) S.items = remoteItems;
    else { S._needPush = true; S._dirtyAll = true; }   // 本地清单要补推，连任务行一起推
  }
  rebuildSchedule();

  if (!dayChanged) {
    (r.tasks || []).forEach(t => {
      const tk = S.tasks[t.task_id];
      if (!tk) return;
      tk.status = t.status || 'todo';
      tk.evidence = t.evidence_type || null;
      tk.evidencePath = t.evidence_path || null;
      tk.evidenceMime = t.evidence_mime || null;
      tk.evidenceAt = t.evidence_at || null;
    });
  }

  /* 任务状态套完再重建一次：家长可能刚把某段退回了，
     那一段要重新占用时间，不能停在「已交 = 0 分钟」。
     不重建的话，退回的作业在排程里没有时间，预计收工会算早。 */
  if (!dayChanged) rebuildSchedule();

  if (r.books && r.books.length) {
    S.books = r.books.map(b => ({
      id: 'b' + b.id,
      name: b.name,
      subject: b.subject || '综合',
      total: b.total_pages || 0,
      done: b.done_pages || 0,
      color: '#4F63E0'
    }));
  }

  /* 兑换单也要并回来。
     两端常常是不同设备：孩子在孩子手机上换，家长在家长手机上看。
     云端 redeems 是唯一能对齐两边的东西，以前拉回来直接丢掉，
     所以家长端永远显示「暂无」，孩子那边也看不到家长点了已兑现。 */
  mergeRedeems(r.redeems);

  S.planDate = today;
  S.synced = true;
  // 数据刚从云端下来，本地与云端一致，没有待推的行
  if (!S._needPush) { S._dirty = {}; S._dirtyAll = false; }
  return true;
}

/* ---------- 音效（Web Audio，无外部资源） ---------- */
let AC = null;
function beep(kind) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === 'coin' ? [880, 1180] : kind === 'done' ? [660, 990] : [520];
    seq.forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = AC.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(AC.destination);
      o.start(t); o.stop(t + 0.24);
    });
  } catch (e) {}
}

/* ---------- 屏幕保活 ----------
   孩子端最怕一件事：手一离屏，页面被系统挂起，计时和响铃一起失联。
   iOS 15 拿不到 Screen Wake Lock（那是 16.4 才有的），所以两条腿走：
   1) 循环播放一段 3.7KB 的黑屏视频 —— 系统当你在看视频，不自动锁屏
      （noSleep.js 的同一套办法，iOS 上目前唯一经得住验证的）
   2) 新设备有标准 Wake Lock 就直接用，比播视频省电
   播放媒体必须由用户手势触发，所以进入计时那一刻（点了"开始"）就启动。 */

/* 极小黑屏 MP4（3.7KB）——来自 NoSleep.js v0.12.0（MIT）。
   iOS 15 没有 Screen Wake Lock API，网页想阻止屏幕自动锁定只能靠循环播放一段真实视频，
   这是目前唯一经得住验证的做法。必须 playsinline + muted + loop，否则 iOS 会拒绝播放。 */
const WAKE_MP4 =
  'AAAAHGZ0eXBNNFYgAAACAGlzb21pc28yYXZjMQAAAAhmcmVlAAAGF21kYXTeBAAAbGliZmFhYyAxLjI4AABCAJMgBDIARwAA' +
  'ArEGBf//rdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNDIgcjIgOTU2YzhkOCAtIEguMjY0L01QRUctNCBBVkMgY29k' +
  'ZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTQgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBj' +
  'YWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3Jk' +
  'PTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAg' +
  'ZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJl' +
  'YWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25z' +
  'dHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQw' +
  'IGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBt' +
  'aW49MCBxcG1heD02OSBxcHN0ZXA9NCB2YnZfbWF4cmF0ZT03NjggdmJ2X2J1ZnNpemU9MzAwMCBjcmZfbWF4PTAuMCBuYWxf' +
  'aHJkPW5vbmUgZmlsbGVyPTAgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAFZliIQL8mKAAKvMnJycnJycnJycnXXXXXXX' +
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXiEASZACGQAjgCEA' +
  'SZACGQAjgAAAAAdBmjgX4GSAIQBJkAIZACOAAAAAB0GaVAX4GSAhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZpgL8DJIQBJkAIZ' +
  'ACOAIQBJkAIZACOAAAAABkGagC/AySEASZACGQAjgAAAAAZBmqAvwMkhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZrAL8DJIQBJ' +
  'kAIZACOAAAAABkGa4C/AySEASZACGQAjgCEASZACGQAjgAAAAAZBmwAvwMkhAEmQAhkAI4AAAAAGQZsgL8DJIQBJkAIZACOA' +
  'IQBJkAIZACOAAAAABkGbQC/AySEASZACGQAjgCEASZACGQAjgAAAAAZBm2AvwMkhAEmQAhkAI4AAAAAGQZuAL8DJIQBJkAIZ' +
  'ACOAIQBJkAIZACOAAAAABkGboC/AySEASZACGQAjgAAAAAZBm8AvwMkhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZvgL8DJIQBJ' +
  'kAIZACOAAAAABkGaAC/AySEASZACGQAjgCEASZACGQAjgAAAAAZBmiAvwMkhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZpAL8DJ' +
  'IQBJkAIZACOAAAAABkGaYC/AySEASZACGQAjgCEASZACGQAjgAAAAAZBmoAvwMkhAEmQAhkAI4AAAAAGQZqgL8DJIQBJkAIZ' +
  'ACOAIQBJkAIZACOAAAAABkGawC/AySEASZACGQAjgAAAAAZBmuAvwMkhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZsAL8DJIQBJ' +
  'kAIZACOAAAAABkGbIC/AySEASZACGQAjgCEASZACGQAjgAAAAAZBm0AvwMkhAEmQAhkAI4AhAEmQAhkAI4AAAAAGQZtgL8DJ' +
  'IQBJkAIZACOAAAAABkGbgCvAySEASZACGQAjgCEASZACGQAjgAAAAAZBm6AnwMkhAEmQAhkAI4AhAEmQAhkAI4AhAEmQAhkA' +
  'I4AhAEmQAhkAI4AAAAhubW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAABDcAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAA' +
  'AAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAzB0cmFrAAAAXHRraGQA' +
  'AAADAAAAAAAAAAAAAAABAAAAAAAAA+kAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABA' +
  'AAAAALAAAACQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPpAAAAAAABAAAAAAKobWRpYQAAACBtZGhkAAAAAAAAAAAA' +
  'AAAAAAB1MAAAdU5VxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACU21pbmYAAAAU' +
  'dm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAhNzdGJsAAAAr3N0c2QAAAAA' +
  'AAAAAQAAAJ9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAALAAkABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAGP//AAAALWF2Y0MBQsAN/+EAFWdCwA3ZAsTsBEAAAPpAADqYA8UKkgEABWjLg8sgAAAAHHV1aWRr' +
  'aEDyXyRPxbo5pRvPAyPzAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAeAAAD6QAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MA' +
  'AAAAAAAAAQAAAAEAAAABAAAAAQAAAIxzdHN6AAAAAAAAAAAAAAAeAAADDwAAAAsAAAALAAAACgAAAAoAAAAKAAAACgAAAAoA' +
  'AAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoAAAAKAAAACgAAAAoA' +
  'AAAKAAAACgAAAAoAAAAKAAAAiHN0Y28AAAAAAAAAHgAAAEYAAANnAAADewAAA5gAAAO0AAADxwAAA+MAAAP2AAAEEgAABCUA' +
  'AARBAAAEXQAABHAAAASMAAAEnwAABLsAAATOAAAE6gAABQYAAAUZAAAFNQAABUgAAAVkAAAFdwAABZMAAAWmAAAFwgAABd4A' +
  'AAXxAAAGDQAABGh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAABDcAAAAAAAAAAAAAAAEBAAAAAAEAAAAAAAAA' +
  'AAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAQkAAADcAABAAAA' +
  'AAPgbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAC7gAAAykBVxAAAAAAALWhkbHIAAAAAAAAAAHNvdW4AAAAAAAAAAAAAAABT' +
  'b3VuZEhhbmRsZXIAAAADi21pbmYAAAAQc21oZAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAAB' +
  'AAADT3N0YmwAAABnc3RzZAAAAAAAAAABAAAAV21wNGEAAAAAAAAAAQAAAAAAAAAAAAIAEAAAAAC7gAAAAAAAM2VzZHMAAAAA' +
  'A4CAgCIAAgAEgICAFEAVBbjYAAu4AAAADcoFgICAAhGQBoCAgAECAAAAIHN0dHMAAAAAAAAAAgAAADIAAAQAAAAAAQAAAkAA' +
  'AAFUc3RzYwAAAAAAAAAbAAAAAQAAAAEAAAABAAAAAgAAAAIAAAABAAAAAwAAAAEAAAABAAAABAAAAAIAAAABAAAABgAAAAEA' +
  'AAABAAAABwAAAAIAAAABAAAACAAAAAEAAAABAAAACQAAAAIAAAABAAAACgAAAAEAAAABAAAACwAAAAIAAAABAAAADQAAAAEA' +
  'AAABAAAADgAAAAIAAAABAAAADwAAAAEAAAABAAAAEAAAAAIAAAABAAAAEQAAAAEAAAABAAAAEgAAAAIAAAABAAAAFAAAAAEA' +
  'AAABAAAAFQAAAAIAAAABAAAAFgAAAAEAAAABAAAAFwAAAAIAAAABAAAAGAAAAAEAAAABAAAAGQAAAAIAAAABAAAAGgAAAAEA' +
  'AAABAAAAGwAAAAIAAAABAAAAHQAAAAEAAAABAAAAHgAAAAIAAAABAAAAHwAAAAQAAAABAAAA4HN0c3oAAAAAAAAAAAAAADMA' +
  'AAAaAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkA' +
  'AAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkA' +
  'AAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAAAJAAAACQAAAAkAAACMc3RjbwAAAAAA' +
  'AAAfAAAALAAAA1UAAANyAAADhgAAA6IAAAO+AAAD0QAAA+0AAAQAAAAEHAAABC8AAARLAAAEZwAABHoAAASWAAAEqQAABMUA' +
  'AATYAAAE9AAABRAAAAUjAAAFPwAABVIAAAVuAAAFgQAABZ0AAAWwAAAFzAAABegAAAX7AAAGFwAAAGJ1ZHRhAAAAWm1ldGEA' +
  'AAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZm' +
  'NTUuMzMuMTAw';

const WAKE = { video: null, on: false, lock: null, tried: false };

function startWake() {
  if (WAKE.on) { requestLock(); paintWake(); return true; }
  try {
    if (!WAKE.video) {
      const v = document.createElement('video');
      v.src = 'data:video/mp4;base64,' + WAKE_MP4;
      v.loop = true;
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.appendChild(v);
      WAKE.video = v;
    }
    const p = WAKE.video.play();
    if (p && p.catch) p.catch(() => { WAKE.on = false; paintWake(); });
    WAKE.on = true;
  } catch (e) { WAKE.on = false; }
  requestLock();
  paintWake();
  return WAKE.on;
}

function stopWake() {
  WAKE.on = false;
  try { if (WAKE.video) WAKE.video.pause(); } catch (e) {}
  releaseLock();
  paintWake();
}

async function requestLock() {
  if (WAKE.lock || WAKE.tried) return;
  WAKE.tried = true;
  try {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    WAKE.lock = await navigator.wakeLock.request('screen');
    WAKE.lock.addEventListener('release', () => { WAKE.lock = null; paintWake(); });
    paintWake();
  } catch (e) {}
}

function releaseLock() {
  try { if (WAKE.lock) WAKE.lock.release(); } catch (e) {}
  WAKE.lock = null;
}

/* 系统在页面进后台时会自动释放唤醒锁，回到前台必须重新申请 */
function rearmWake() {
  if (!T.id || T.fired || T.paused) return;
  if (!WAKE.on) startWake();
  if (!WAKE.lock) { WAKE.tried = false; requestLock(); }
}

/* 计时页那一行状态：现在到底护住了没有，一眼可见 */
function paintWake() {
  const el = document.getElementById('wakeLine');
  if (!el) return;
  if (T.paused) {
    el.className = 'wake-line off';
    el.textContent = '⏸ 已暂停，时间停住不会走';
    el.onclick = null;
    paintTimer();
    return;
  }
  const kept = WAKE.on || !!WAKE.lock;
  el.className = 'wake-line ' + (kept ? 'on' : 'off');
  el.textContent = kept
    ? '☀️ 屏幕已保活，铃会准时响'
    : '⚠️ 保活没启动，点这里重新开启';
  el.onclick = kept ? null : () => { unlockAudio(); startWake(); };
  paintTimer();
}

/* ---------- 到点强提醒 ----------
   旧版到点只响两声、音量 0.13，隔个房间就当没响。
   现在 3 轮 × 每轮 3 声方波，音量 0.45，轮间隔 2.4 秒，安卓端同时震动。 */
let RING = { t: null, n: 0 };

function ringAlarm(rounds) {
  if (RING.t) clearTimeout(RING.t);
  const total = rounds || 3;
  RING.n = 0;
  const once = () => {
    RING.n++;
    loudBeep();
    if (navigator.vibrate) { try { navigator.vibrate([220, 110, 220, 110, 320]); } catch (e) {} }
    if (RING.n < total) RING.t = setTimeout(once, 2400);
  };
  once();
}
function stopRing() { if (RING.t) { clearTimeout(RING.t); RING.t = null; } }

function loudBeep() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const t0 = AC.currentTime;
    [880, 1180, 880].forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square';
      o.frequency.value = f;
      const t = t0 + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
      o.connect(g); g.connect(AC.destination);
      o.start(t); o.stop(t + 0.19);
    });
  } catch (e) {}
}

/* iOS 铁律：没有用户手势时创建的 AudioContext 永远 suspended，到点就是一片安静。
   所以在第一次点屏幕时把它激活，顺手放一个空 buffer 出去占住通道。 */
function unlockAudio() {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    if (!AC._primed) {
      AC._primed = true;
      const b = AC.createBuffer(1, 1, 22050);
      const s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    }
  } catch (e) {}
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2100);
}

/* ---------- 图标 ---------- */
const ICONS = {
  bolt:   '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"/>',
  math:   '<path d="M5 8h14M9.5 8v9.5M14.5 8v7.2c0 1.3.9 2.3 2.2 2.3"/>',
  book:   '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/><path d="M19 18v3H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  pen:    '<path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>',
  rest:   '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  recall: '<path d="M12 5a7 7 0 1 0 6.9 8.2"/><path d="M19 4v5h-5"/>',
  eye:    '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  flag:   '<path d="M5 21V4M5 4h11l-1.6 4L16 12H5"/>'
};
function icon(name, color) {
  const p = ICONS[name] || ICONS.flag;
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="${color || '#4F63E0'}" stroke-width="1.9" stroke-linejoin="round"
    stroke-linecap="round">${p}</svg>`;
}

/* ---------- 计算 ---------- */
/* 当前时间：真实模式读系统时钟；演示模式读可推进的虚拟指针 */
function nowMin() { return DEMO ? S.clock : realNow(); }

/* 熄灯之后（真实模式）——任务清单收起，换成收工页 */
function isAfterHours() { return !DEMO && realNow() >= LIGHT_OUT && !S.afterHours; }

function remainingMinutes() {
  return SCHEDULE.filter(s => S.tasks[s.id].status !== 'done').reduce((a, s) => a + s.dur, 0);
}
function projectedFinish() {
  // 白天打开时别把整个白天算成可自由时间，一律从 19:00 起算
  return Math.max(nowMin(), DAY_START) + remainingMinutes();
}
function freeBalance() {
  return Math.max(0, LIGHT_OUT - projectedFinish());
}

function gridDone(gid) {
  const items = SCHEDULE.filter(s => s.grid === gid);
  if (!items.length) return false;
  return items.every(s => S.tasks[s.id].status === 'done');
}
function gridProgress(gid) {
  const items = SCHEDULE.filter(s => s.grid === gid);
  const d = items.filter(s => S.tasks[s.id].status === 'done').length;
  return { done: d, total: items.length };
}
function gridsAllClear() {
  // 今天没派单的格子（作业多时练习会自动让位）不参与判定，否则奖励永远拿不到
  return GRIDS.every(g => {
    const items = SCHEDULE.filter(s => s.grid === g.id);
    if (!items.length) return true;
    return items.every(s => S.tasks[s.id].status === 'done');
  });
}

/* ---------- 积分 ---------- */
function award(n, label) {
  const room = CFG.dayCap - S.earnedToday;
  const real = Math.max(0, Math.min(n, room));
  S.coins += real;
  S.earnedToday += real;
  if (real > 0) {
    flyPoint('+' + real);
    beep('coin');
    if (S.synced && window.Cloud) {
      Cloud.addCoin(real, label || '完成', S.planDate || Cloud.today());
    }
  }
  save();
  return real;
}
function flyPoint(text) {
  const el = document.createElement('div');
  el.className = 'fly-pt';
  el.textContent = text;
  el.style.left = '50%';
  el.style.top = '46%';
  el.style.transform = 'translateX(-50%)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ---------- 动作 ---------- */
function completeTask(id, evidence, asset) {
  const t = S.tasks[id];
  const cfg = SCHEDULE.find(s => s.id === id);
  if (!cfg || t.status === 'done') return;

  t.status = 'done';
  markDirty(id);
  t.evidence = evidence || 'none';
  // 照片/录音的真实文件路径，家长端凭它换临时地址查看
  t.evidencePath = (asset && asset.path) || null;
  t.evidenceMime = (asset && asset.mime) || null;
  t.evidenceAt = asset && asset.path ? new Date().toISOString() : null;
  if (DEMO) S.clock += cfg.dur;           // 只有演示模式才手动推进时钟
  S.lastDoneAt = id;

  // 作业项回写：拆成多段的，最后一段做完才算整项完成
  if (cfg.itemId) {
    const it = (S.items || []).find(i => i.id === cfg.itemId);
    if (it) {
      const isLast = !cfg.parts || !cfg.part || cfg.part >= cfg.parts;
      if (isLast) {
        if (it.status === 'timeout') it.wasTimeout = true;   // 先记旧状态，再覆盖
        it.status = 'done';
        it.doneAt = Date.now();
      } else { it.progress = (it.progress || 0) + 1; }
    }
  }

  // 计分
  if (cfg.kind === 'break' || cfg.kind === 'wrap') {
    save(); render(); return;
  }
  let pts = cfg.kind === 'ritual' ? 5 : 20;   // 完成 10 + 交付 10
  const got = award(pts, cfg.title);

  // 四格全清
  if (gridsAllClear() && !S.bonusCleared) {
    S.bonusCleared = true;
    setTimeout(() => { award(20, '四格全清'); toast('四格全清，额外 +20 币'); render(); }, 420);
  }
  if (cfg.kind === 'preview') {
    setTimeout(() => toast('明早 7:50，我会问你昨晚标的这 3 个问题'), 900);
  }
  beep('done');
  save();
  /* 这一段已交 → 时间轴要立刻收紧：它从「占时间」变成「不占时间」，
     后面的块整体前移，剩余时间和预计收工才对得上。
     注意它不会被删掉，进度分母也就不会跟着变小。 */
  rebuildSchedule();
  S.page = 'home';
  render();
}

function reworkTask(id) {
  S.tasks[id].status = 'rework';
  markDirty(id);
  S.tasks[id].evidence = null;
  S.reworkFlag = true;
  // 退回的段要重新占用时间，回到待做区
  rebuildSchedule();
  save(); render();
  toast('已退回，孩子端会看到「需要重做」');
}

function passTask(id) {
  S.tasks[id].status = 'done';
  markDirty(id);
  // 通过的段不再占时间
  rebuildSchedule();
  save(); render();
  toast('已通过');
}

/* ===========================================================
   列作业
   设计原则：不让孩子填分钟、不让她选类型。
   她只要说「做什么」，时长点一个感觉，类型系统自己判。
   =========================================================== */
const ADD_UI = { sub: '语文', dur: 20 };

function itemTypeTag(type) {
  const t = ITEM_TYPES[type] || ITEM_TYPES.mech;
  return `<span class="itype" style="color:${t.color};border-color:${t.color}44;background:${t.color}14">${t.short}·${t.name}</span>`;
}

function addItem(o) {
  if (!S.items) S.items = [];
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  S.items.push({
    id,
    subject: o.subject || '其他',
    name: o.name,
    type: o.type || guessItemType(o.name),
    est: o.est || 20,
    status: 'todo',
    actual: null,
    createdAt: Date.now()
  });
  S._dirtyAll = true;      // 时间轴结构变了，任务行整份重推
  save();
}

function removeItem(id) {
  S.items = (S.items || []).filter(i => i.id !== id);
  Object.keys(S.tasks).forEach(k => { if (k.indexOf('it' + id) === 0) delete S.tasks[k]; });
  S._dirtyAll = true;
  save();
}

function openItemAdd() {
  closeSheet();
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'itemAddMask';
  mask.innerHTML = `
  <div class="sheet pop">
    <h3>今天要做什么</h3>
    <div class="sub">老师让做的每件事都算一项，别合并成「语文」两个字</div>

    <div class="ia-lb">哪一科</div>
    <div class="ia-chips" id="iaSub">
      ${SUBJECTS.map(s => `<button class="${s === ADD_UI.sub ? 'on' : ''}" data-v="${s}">${s}</button>`).join('')}
    </div>

    <div class="ia-lb">做什么</div>
    <input id="iaName" class="ia-input" placeholder="比如：抄第 12 课生字" autocomplete="off">
    <div class="ia-type" id="iaType"></div>

    <div class="ia-lb">大概要多久</div>
    <div class="ia-durs" id="iaDur">
      ${DUR_CHOICES.map(d => `<button class="${d.min === ADD_UI.dur ? 'on' : ''}" data-v="${d.min}">
        <b>${d.label}</b><span>${d.min}′ · ${d.note}</span></button>`).join('')}
    </div>

    <div class="ia-list" id="iaList"></div>

    <div class="sheet-actions">
      <button class="btn ghost" id="iaDone">列完了，排时间</button>
      <button class="btn primary" id="iaAdd">加进来</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  mask.addEventListener('click', e => { if (e.target === mask) closeItemAdd(); });

  const inp = $('#iaName');
  const typeBox = $('#iaType');

  function refreshType() {
    const v = inp.value.trim();
    if (!v) { typeBox.innerHTML = '<span class="ia-dim">按名字自动判断类型，估错了不影响</span>'; return; }
    const t = guessItemType(v);
    typeBox.innerHTML = `判定 ${itemTypeTag(t)} <span class="ia-dim">${ITEM_TYPES[t].desc}</span>`;
  }

  function drawList() {
    const box = $('#iaList');
    const list = S.items || [];
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="ia-lb">已加 ${list.length} 项</div>` + list.map((i, n) => `
      <div class="ia-row">
        <span class="ia-n">${n + 1}</span>
        <span class="ia-s">${i.subject}</span>
        <span class="ia-t">${i.name}</span>
        <span class="ia-m">${i.est}′</span>
        <button class="ia-x" data-id="${i.id}">×</button>
      </div>`).join('');
    box.querySelectorAll('.ia-x').forEach(b => {
      b.onclick = () => { removeItem(b.dataset.id); drawList(); };
    });
  }

  function doAdd() {
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    addItem({ subject: ADD_UI.sub, name, type: guessItemType(name), est: ADD_UI.dur });
    inp.value = '';
    refreshType();
    drawList();
    inp.focus();
  }

  mask.querySelectorAll('#iaSub button').forEach(b => {
    b.onclick = () => {
      ADD_UI.sub = b.dataset.v;
      mask.querySelectorAll('#iaSub button').forEach(x => x.classList.toggle('on', x === b));
    };
  });
  mask.querySelectorAll('#iaDur button').forEach(b => {
    b.onclick = () => {
      ADD_UI.dur = +b.dataset.v;
      mask.querySelectorAll('#iaDur button').forEach(x => x.classList.toggle('on', x === b));
    };
  });

  inp.addEventListener('input', refreshType);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  $('#iaAdd').onclick = doAdd;
  $('#iaDone').onclick = closeItemAdd;

  refreshType();
  drawList();
  setTimeout(() => { try { inp.focus(); } catch (e) {} }, 280);
}

function closeItemAdd() {
  const m = $('#itemAddMask');
  if (m) m.remove();
  rebuildSchedule();
  save();
  render();
}

function openTask(id) {
  const cfg = SCHEDULE.find(s => s.id === id);
  if (!cfg) return;
  if (cfg.kind === 'break' || cfg.kind === 'wrap') {
    // 休息/收工直接确认
    showSheet({
      title: cfg.kind === 'break' ? '起身动一下' : '收工仪式',
      sub: cfg.desc,
      body: `<div style="text-align:center;padding:10px 0 4px;font-size:44px">${cfg.kind === 'break' ? '🤸' : '🎉'}</div>`,
      actions: [
        { label: '稍后', ghost: true, act: closeSheet },
        { label: cfg.kind === 'break' ? '休息完了，继续' : '收工', primary: true, act: () => { closeSheet(); completeTask(id); } }
      ]
    });
    return;
  }
  // 课外练习不是「计时做一页纸」，是系统派题、当场作答、自动判分
  if (id === 'practice') { openPractice(); return; }
  S.page = 'timer';
  S.timerTask = id;
  render();
  startTimer(cfg);
}

/* ---------- 计时器 ----------
   旧做法是每秒把 T.left 减一。页面一进后台或锁屏，定时器停摆，数字就冻在原地——
   孩子关掉再打开，看到的还是关掉那一刻的剩余时间，等于白算。
   现在改成「只记终点时刻」：endAt 是墙上时钟的一个绝对毫秒数，页面活不活着都不影响它。
   所有显示都是 endAt - Date.now() 现算，所以关掉半小时再打开，剩余时间准确地少半小时。 */

const TKEY = 'study-guardian-timer-v1';

let T = {
  tick: null,
  id: null,
  total: 0,       // 毫秒
  endAt: 0,       // 绝对终点时刻（墙上时钟）
  remainMs: 0,    // 暂停时冻结的剩余毫秒
  left: 0,        // 仅演示模式（?demo=1）用的秒计数
  paused: false,
  fired: false
};

function tLeftMs() {
  if (DEMO && S.speed) return Math.max(0, T.left * 1000);
  if (T.paused) return Math.max(0, T.remainMs);
  return Math.max(0, T.endAt - Date.now());
}

/* 把进度钉在本地。iOS 杀掉页面后内存全没，只有这里能接上 */
function saveTimerSnap() {
  if (!T.id || T.fired || DEMO) {
    if (!T.id || T.fired) { try { localStorage.removeItem(TKEY); } catch (e) {} }
    return;
  }
  try {
    localStorage.setItem(TKEY, JSON.stringify({
      id: T.id,
      total: T.total,
      endAt: T.endAt,
      remainMs: T.paused ? T.remainMs : tLeftMs(),
      paused: T.paused,
      at: Date.now()
    }));
  } catch (e) {}
}

function startTimer(cfg, minutes, resume) {
  stopTimer();
  const m = minutes || cfg.dur;
  if (!resume) {
    T.id = cfg.id;
    T.total = m * 60 * 1000;
    T.endAt = Date.now() + T.total;
    T.remainMs = T.total;
    T.left = m * 60;
    T.paused = false;
  }
  T.fired = false;
  saveTimerSnap();
  startWake();               // 点了按钮才算用户手势，媒体此刻才播得出来
  unlockAudio();

  // 演示模式 1 秒 = 1 分钟，方便验收；真实模式 250ms 轮询，到点最多晚四分之一秒
  const step = (DEMO && S.speed) ? 1000 : 250;
  T.tick = setInterval(() => {
    if (T.fired) return;

    if (DEMO && S.speed) {
      if (T.paused) return;
      T.left -= 60;
      if (T.left <= 0) { T.left = 0; onTimeUp(); return; }
      paintTimer(cfg);
      return;
    }

    if (T.paused) return;
    if (T.endAt - Date.now() <= 0) { onTimeUp(); return; }
    paintTimer(cfg);
  }, step);

  paintTimer(cfg);
}
function stopTimer() { if (T.tick) { clearInterval(T.tick); T.tick = null; } }

/* 到点：先响铃，再问话。顺序不能反——
   弹窗万一被系统挡住或渲染慢，声音和震动已经先出去了 */
function onTimeUp() {
  if (T.fired) return;
  T.fired = true;
  stopTimer();
  stopWake();
  try { localStorage.removeItem(TKEY); } catch (e) {}
  ringAlarm();
  const cfg = SCHEDULE.find(s => s.id === T.id);
  if (cfg) askTimeout(cfg);
  else { S.page = 'home'; render(); }
}

/* 放弃 / 完成 / 判超时都要清掉快照，否则下次开机会误恢复这块 */
function clearTimerSnap() {
  stopTimer();
  T.fired = true;
  T.id = null;
  stopWake();
  stopRing();
  try { localStorage.removeItem(TKEY); } catch (e) {}
}

/* 时间到但没交成果物：不判完成，先问还差多少。
   估错本身是正常的（小学生时间预估误差率本来就高），所以不惩罚，
   但也不能算完成 —— 否则制度就在奖励糊任务。
   overdueMin 有值是「离开期间铃没响成」的迟到场景，要如实告诉孩子过了多久。 */
function askTimeout(cfg, overdueMin) {
  const t = S.tasks[cfg.id] || {};
  const late = overdueMin > 0
    ? `<div style="text-align:center;font-size:13px;color:#C2410C;line-height:1.95;margin-bottom:2px">
         刚才页面不在，铃没响成。已经超出约 ${overdueMin} 分钟。
       </div>`
    : '';
  showSheet({
    title: overdueMin > 0 ? '这块早就到点了' : '时间到了',
    sub: cfg.title,
    body: `<div style="text-align:center;padding:6px 0 2px;font-size:40px">${overdueMin > 0 ? '⌛' : '⏰'}</div>
      <div style="text-align:center;font-size:13.5px;color:var(--ink2);line-height:1.95">
        ${late}
        这块计划 ${cfg.dur} 分钟。现在做到哪一步了？<br>说实话就行，估错了不扣分。
      </div>`,
    actions: [
      { label: '还差不少', ghost: true, act: () => { closeSheet(); markTimeout(cfg.id); } },
      { label: t.extended ? '再延（已用过）' : '快好了，再给 5 分钟',
        act: () => { closeSheet(); extendTimer(cfg); } },
      { label: '做完了', primary: true, act: () => { closeSheet(); askEvidence(cfg); } }
    ]
  });
}

function extendTimer(cfg) {
  const t = S.tasks[cfg.id] || (S.tasks[cfg.id] = { status: 'todo' });
  if (t.extended) {
    toast('已经延过一次了，这块先算没完成');
    markTimeout(cfg.id);
    return;
  }
  t.extended = true;
  S.page = 'timer';
  S.timerTask = cfg.id;
  render();
  startTimer(cfg, 5);
  toast('再给 5 分钟，到点就停');
}

function markTimeout(id) {
  const t = S.tasks[id];
  const cfg = SCHEDULE.find(s => s.id === id);
  if (!t) return;
  t.status = 'timeout';
  markDirty(id);
  t.evidence = null;
  t.overAt = Date.now();
  // 作业项也标上，家长端要看「哪一项老是超时」
  if (cfg && cfg.itemId) {
    const it = (S.items || []).find(i => i.id === cfg.itemId);
    if (it) { it.status = 'timeout'; it.timeoutAt = Date.now(); }
  }
  S.reworkFlag = true;
  clearTimerSnap();
  save();
  S.page = 'home';
  render();
  toast('这块没做完，不扣币，但也不给币');
}

function paintTimer(cfg) {
  const c = $('#clockNum'), p = $('#ringProg');
  if (!c || !p) return;
  cfg = cfg || SCHEDULE.find(s => s.id === (T.id || S.timerTask));
  if (!cfg) return;
  const total = T.total || (cfg.dur * 60 * 1000);
  // 还没真正开始（只是打开了计时页）就按满格画，不然会出现一个空环，像已经走完
  const left = T.id ? tLeftMs() : total;
  const s = Math.ceil(left / 1000);
  // 秒位真实跳动。旧版写死 ':00'，孩子看不出在走，还以为卡住了
  c.textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  if (left > 0 && left <= 60000) c.classList.add('urgent'); else c.classList.remove('urgent');
  const R = 150, C = 2 * Math.PI * R;
  p.style.strokeDasharray = C;
  /* 环代表「还剩多少时间」：一开始是满的，随着时间流逝一圈圈退掉。
     旧公式写成 C*(left/total)，left=total 时算出来 offset=C，画出来是空环 ——
     与「还没开始按满格画」的本意正好相反，开计时前看到的是一圈灰。 */
  p.style.strokeDashoffset = C * (1 - left / total);
}

/* ---------- 重开恢复 ----------
   页面被杀掉之后回来的第一条命：把本地那份快照捡起来。
   还没到点 → 接着跑，显示的时间按真实时钟校准；
   已经过了 → 立刻补响，并如实告诉孩子超了多久，而不是装作无事发生。 */
function restoreTimer() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(TKEY) || 'null'); } catch (e) { o = null; }
  if (!o || !o.id) return false;

  const cfg = SCHEDULE.find(s => s.id === o.id);
  const st = S.tasks[o.id];
  if (!cfg || !st || st.status === 'done' || st.status === 'timeout') {
    try { localStorage.removeItem(TKEY); } catch (e) {}
    return false;
  }

  T.id = o.id;
  T.total = o.total || cfg.dur * 60000;
  T.endAt = o.endAt || 0;
  T.remainMs = o.remainMs || 0;
  T.paused = !!o.paused;
  T.fired = false;
  S.timerTask = o.id;

  const left = T.paused ? T.remainMs : (T.endAt - Date.now());

  if (!T.paused && left <= 0) {
    const over = Math.max(1, Math.round(-left / 60000));
    try { localStorage.removeItem(TKEY); } catch (e) {}
    T.fired = true;
    S.page = 'home';
    render();
    setTimeout(() => { ringAlarm(); askTimeout(cfg, over); }, 500);
    return true;
  }

  S.page = 'timer';
  render();
  startTimer(cfg, 0, true);         // resume：不重设 endAt，剩余时间才是准的
  setTimeout(() => toast('离开的时间也在走，还剩 ' + Math.max(1, Math.ceil(left / 60000)) + ' 分钟'), 800);
  return true;
}

/* 回到前台的第一件事：核对终点。
   系统会把后台定时器挂起，所以不能信定时器，只信墙上的钟。 */
function bindTimerWatch() {
  let last = 0;
  const check = () => {
    const now = Date.now();
    if (now - last < 400) return;
    last = now;
    if (!T.id || T.fired) return;
    if (T.paused) { rearmWake(); return; }
    if (T.endAt - Date.now() <= 0) { onTimeUp(); return; }
    rearmWake();
    paintTimer();
    saveTimerSnap();
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('pageshow', check);      // bfcache 整页从冻结里回来
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  document.addEventListener('resume', check);      // 部分 iOS 版本会发这个

  /* 首次用户手势：iOS 规定有声媒体和视频必须由真实动作触发，
     不在这儿提前激活，到点就是一片安静、屏幕也保不住 */
  const prime = () => {
    unlockAudio();
    if (T.id && !T.fired && !T.paused) startWake();
  };
  ['touchstart', 'touchend', 'click', 'keydown'].forEach(ev =>
    document.addEventListener(ev, prime, { passive: true })
  );
}


/* ---------- 交付成果物 ---------- */
function askEvidence(cfg) {
  const evs = [
    { k: 'photo', i: '📷', t: '拍照上传', d: '拍作业本当页，自动压缩后存云端' },
    { k: 'voice', i: '🎙', t: '录音 30 秒', d: '合上书讲一遍，家长能回放' },
    { k: 'tell',  i: '🗣', t: '当面讲给家长听', d: '讲完家长在手机端点确认' }
  ];
  showSheet({
    title: '交成果物 · ' + cfg.title,
    sub: '没成果物 = 没完成。选一种交付方式。',
    body: `<div class="ev-list">${evs.map(e => `
      <button class="ev" onclick="pickEvidence('${cfg.id}','${e.k}', this)">
        <div class="evi">${e.i}</div>
        <div><div class="evt">${e.t}</div><div class="evd">${e.d}</div></div>
      </button>`).join('')}</div>`,
    actions: [{ label: '还没做完', ghost: true, act: () => { closeSheet(); S.page = 'home'; render(); } }]
  });
}

function pickEvidence(id, kind, btn) {
  if (btn) {
    document.querySelectorAll('.ev').forEach(e => e.classList.remove('sel'));
    btn.classList.add('sel');
  }
  // 拍照和录音都必须在点击的同步调用栈里发起，否则 iOS 判为非法手势不给权限
  if (kind === 'photo' || kind === 'voice') {
    if (!S.synced) { closeSheet(); toast('照片和录音要登录后才存得住，先登录一下'); return; }
    if (navigator.onLine === false) { closeSheet(); toast('现在没网，照片传不上去。先当面讲给家长听'); return; }
  }
  if (kind === 'photo') { openCamera(id); return; }
  if (kind === 'voice') { openRecorder(id); return; }
  closeSheet();
  toast('已记录：当面口述完成');
  completeTask(id, 'tell');
}

/* ---------- 拍照 ---------- */
function openCamera(id) {
  closeSheet();
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.setAttribute('capture', 'environment');   // 直接调后置相机
  inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    setTimeout(() => inp.remove(), 100);
    if (!f) {
      toast('没拍照，这一块还没完成');
      S.page = 'home'; render();
      return;
    }
    handlePhoto(id, f);
  }, { once: true });
  inp.click();
}

/* 手机拍的图动辄 4 MB，先缩到 1280 宽再传，省流量也省存储 */
function compressImage(file, maxW, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#FFFFFF';          // 透明底转白，否则存成 jpg 会发黑
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), 'image/jpeg', quality);
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
    img.src = url;
  });
}

async function handlePhoto(id, file) {
  toast('正在压缩照片…');
  let blob = file;
  try {
    const small = await compressImage(file, 1280, 0.82);
    if (small && small.size) blob = small;
  } catch (e) { /* 压缩失败就直接传原图 */ }

  if (blob.size > 6 * 1024 * 1024) { toast('照片太大，重拍一张'); return; }

  toast('正在上传照片…');
  const day = S.planDate || Cloud.today();
  const r = await Cloud.uploadEvidence(blob, day, id);
  if (!r.ok) { toast('照片没传上去：' + r.msg); S.page = 'home'; render(); return; }
  completeTask(id, 'photo', { path: r.path, mime: blob.type || 'image/jpeg' });
}

/* ---------- 录音 ---------- */
let REC = null;

async function openRecorder(id) {
  closeSheet();
  const cfg = SCHEDULE.find(s => s.id === id);

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function'
      || typeof window.MediaRecorder === 'undefined') {
    toast('这个浏览器录不了音，改用拍照或当面讲');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('没拿到麦克风权限，去手机设置里允许一下，或改用拍照');
    return;
  }

  // iOS 优先 mp4，安卓走 webm
  const cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', ''];
  let mime = '';
  for (const m of cands) {
    if (m === '' || window.MediaRecorder.isTypeSupported(m)) { mime = m; break; }
  }

  let mr;
  try {
    mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    toast('这台设备开不了录音');
    return;
  }

  REC = { id, mr, stream, chunks: [], type: mr.mimeType || mime || 'audio/mp4', sec: 0, timer: null, done: false };
  mr.ondataavailable = e => { if (e.data && e.data.size) REC.chunks.push(e.data); };

  showSheet({
    title: '录音 · ' + (cfg ? cfg.title : ''),
    sub: '合上书，用自己的话讲今天学了什么。讲不清就是没学会。',
    body: `<div style="text-align:center;padding:16px 0 6px">
      <div id="recTime" style="font-size:46px;font-weight:800;letter-spacing:2px;color:#4F63E0">0:00</div>
      <div style="font-size:12.5px;color:#8A93A6;margin-top:8px">最长 30 秒，到点自动停</div>
      <div id="recDot" style="font-size:13px;color:#B33A3A;margin-top:14px">● 正在录音</div>
    </div>`,
    actions: [
      { label: '录完了，提交', primary: true, act: () => stopRecorder() },
      { label: '取消', ghost: true, act: () => cancelRecorder() }
    ]
  });

  mr.start();
  REC.timer = setInterval(() => {
    if (!REC) return;
    REC.sec++;
    const el = $('#recTime');
    if (el) el.textContent = '0:' + pad(REC.sec);
    if (REC.sec >= 30) stopRecorder();
  }, 1000);
}

function stopRecorder() {
  if (!REC || REC.done) return;
  REC.done = true;
  clearInterval(REC.timer);

  const cur = REC;
  cur.mr.onstop = async () => {
    try { cur.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    const blob = new Blob(cur.chunks, { type: cur.type });
    REC = null;
    closeSheet();

    if (!blob.size) { toast('没录到声音，再试一次'); S.page = 'home'; render(); return; }
    if (blob.size > 6 * 1024 * 1024) { toast('录太长了，重录短一点'); S.page = 'home'; render(); return; }

    toast('正在上传录音…');
    const day = S.planDate || Cloud.today();
    const r = await Cloud.uploadEvidence(blob, day, cur.id);
    if (!r.ok) { toast('录音没传上去：' + r.msg); S.page = 'home'; render(); return; }
    completeTask(cur.id, 'voice', { path: r.path, mime: cur.type });
  };

  try { cur.mr.stop(); } catch (e) {}
}

function cancelRecorder() {
  if (!REC) { closeSheet(); return; }
  const cur = REC;
  REC = null;
  clearInterval(cur.timer);
  try { cur.mr.stop(); } catch (e) {}
  try { cur.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  closeSheet();
  toast('已取消，这一块还没完成');
  S.page = 'home'; render();
}

/* ---------- 查看凭证（家长端） ---------- */
async function showEvidence(id) {
  const t = S.tasks[id];
  const cfg = SCHEDULE.find(s => s.id === id);
  if (!t || !t.evidencePath) { toast('这一块没有留下凭证'); return; }

  const isImg = String(t.evidenceMime || '').indexOf('image') === 0 || t.evidence === 'photo';
  showSheet({
    title: '凭证 · ' + (cfg ? cfg.title : ''),
    sub: t.evidenceAt ? ('提交于 ' + new Date(t.evidenceAt).toLocaleString('zh-CN')) : '',
    body: `<div id="evBox" style="text-align:center;padding:20px 0;color:#8A93A6;font-size:13px">正在加载…</div>`,
    actions: [{ label: '关闭', ghost: true, act: () => closeSheet() }]
  });

  const url = await Cloud.evidenceUrl(t.evidencePath, 3600);
  const box = $('#evBox');
  if (!box) return;
  if (!url) { box.textContent = '凭证读取失败，可能已过期'; return; }
  box.innerHTML = isImg
    ? `<img src="${url}" style="width:100%;border-radius:14px;display:block" alt="作业照片">`
    : `<audio controls src="${url}" style="width:100%"></audio>
       <div style="font-size:12.5px;color:#8A93A6;margin-top:10px">录音凭证</div>`;
}

/* ---------- 通用 Sheet ---------- */
function showSheet(o) {
  closeSheet();
  const mask = document.createElement('div');
  mask.className = 'sheet-mask';
  mask.id = 'sheetMask';
  mask.innerHTML = `
    <div class="sheet pop">
      <h3>${o.title}</h3>
      <div class="sub">${o.sub || ''}</div>
      ${o.body || ''}
      <div class="sheet-actions">
        ${(o.actions || []).map((a, i) => `<button class="btn ${a.primary ? 'primary' : a.ghost ? 'ghost' : ''}" data-i="${i}">${a.label}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(mask);
  mask.addEventListener('click', e => { if (e.target === mask) closeSheet(); });
  mask.querySelectorAll('.sheet-actions .btn').forEach(b => {
    b.onclick = () => o.actions[+b.dataset.i].act();
  });
}
function closeSheet() {
  const m = $('#sheetMask');
  if (m) m.remove();
}

/* ---------- 渲染 · 顶栏 ---------- */
/* iOS 把网页加到桌面后会长期缓存 index.html 本身，
   改个查询参数就能拿到新的一份，不用删图标重加。 */
function hardReload() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('_r', Date.now().toString(36));
    location.replace(u.toString());
  } catch (e) {
    location.reload();
  }
}
window.hardReload = hardReload;

function renderTop() {
  const mins = nowMin();
  const late = !DEMO && mins >= LIGHT_OUT;
  return `
  <div class="topbar">
    <div class="topbar-in">
      <div class="logo"><div class="dot">学</div><span class="lt">学习守护</span></div>
      <button class="ver" onclick="hardReload()" title="点一下强制更新到最新版本">${window.APP_VERSION || 'v?'}</button>
      <div class="spacer"></div>
      <div class="clock-box">
        <span class="lbl">${late ? '已熄灯' : DEMO ? '演示' : '现在'}</span>
        <span class="val" id="topClock">${fmt(mins)}</span>
        ${DEMO ? `<button onclick="advanceClock(5)" title="快进 5 分钟">+5′</button>
        <button onclick="toggleSpeed()" title="切换演示加速 / 实时">${S.speed ? '加速中' : '实时'}</button>` : ''}
      </div>
      <div class="role-switch" ${FORCED_ROLE ? 'style="display:none"' : ''}>
        <button class="${S.role === 'child' ? 'on' : ''}" onclick="setRole('child')">孩子</button>
        <button class="${S.role === 'parent' ? 'on' : ''}" onclick="setRole('parent')">家长</button>
      </div>
    </div>
  </div>`;
}
function allowAfterHours() {
  S.afterHours = true;
  save(); render();
  toast('已进补做模式，明天家长能看出来');
}

function advanceClock(m) {
  if (!DEMO) return;                      // 真实模式下没有手动快进
  S.clock += m;
  if (S.clock > LIGHT_OUT) S.clock = LIGHT_OUT;
  save(); render();
}
function toggleSpeed() {
  if (!DEMO) return;                      // 真实模式下计时永远按秒走
  S.speed = S.speed ? 0 : 1;
  save(); render();
  toast(S.speed ? '演示模式：1 秒 = 1 分钟' : '实时模式：按真实分钟走');
}
function setRole(r) {
  S.role = r;
  S.page = r === 'child' ? 'home' : 'p-home';
  stopTimer();
  save(); render();
}

/* ---------- 渲染 · 首页（今日） ---------- */
/* 熄灯之后：不再摆任务清单，只交代今天的结果和明天的时间 */
function renderAfterHours() {
  const real = SCHEDULE.filter(s => s.kind !== 'break');
  const done = real.filter(s => S.tasks[s.id].status === 'done').length;
  const left = real.filter(s => S.tasks[s.id].status !== 'done');

  const line = left.length === 0
    ? '四格全清，一块没落下。'
    : `还有 ${left.length} 块没做完：${left.map(s => s.title).join('、')}。`;

  return `
  <div class="balance zero">
    <div class="main">
      <div class="cap">今天已经收工了</div>
      <div class="num">${done}<small>/${real.length} 块</small></div>
      <div class="sub">今天挣了 ${S.earnedToday} 币 · 连续 ${S.streak} 天达标</div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>先睡觉</h2><span class="hint">21:30 之后学不进东西</span></div>
    <div class="p-card" style="font-size:13.5px;color:var(--ink2);line-height:1.95">
      <p style="margin:0 0 10px">${line}</p>
      <p style="margin:0 0 10px">这个点硬撑，第二天只会更困、更坐不住。睡觉的时候大脑才会把今天学的东西存下来，熬夜补的那点作业，早上基本剩不下。</p>
      <p style="margin:0">明天 19:00 重新开始，积分和连续天数都还在。</p>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>今天有特殊情况？</h2></div>
    <div class="p-card" style="font-size:13.5px;color:var(--ink2);line-height:1.95">
      <p style="margin:0 0 12px">真遇到要补的，点下面。补做的记录明天家长端能看出来。</p>
      <button class="btn ghost" onclick="allowAfterHours()">确实没做完，继续补</button>
    </div>
  </div>`;
}

/* 还没列作业：不急着摆时间轴，先让她把事说清楚 */
function renderPlanEmpty() {
  return `
  <div class="plan-empty">
    <div class="pe-ico">📝</div>
    <div class="pe-t">今天要做什么，先说清楚</div>
    <div class="pe-d">老师让做的每件事都算一项。抄写、听写、作文是三件不同的事，分开列，时间才算得准。</div>
    <button class="btn primary" onclick="openItemAdd()">开始列</button>
  </div>`;
}

/* 已经列了：把作业总量和可用时间摆在一起，超了就说超了 */
function renderPlanBar() {
  const L = planLoad();
  const end = planEndTime();
  const late = end > WRAP_LINE;
  const giveUpPractice = L.items > 0 && !L.withPractice;
  return `
  <div class="plan-bar ${late ? 'over' : 'ok'}">
    <div class="pb-top">
      <b>${L.items} 项作业</b>
      <span>净 ${L.work} 分钟 · 拆成 ${L.count} 块</span>
    </div>
    <div class="pb-sub">${late
      ? `按这个排，${fmt(end)} 才收工，比 ${fmt(WRAP_LINE)} 晚 ${end - WRAP_LINE} 分钟`
      : `预计 ${fmt(end)} 收工`}</div>
    ${giveUpPractice && !late ? `<div class="pb-note">作业占满了时间，课外练习${todayWord()}自动让位。</div>` : ''}
    ${late ? `<div class="pb-tip">三个办法：① 挑一项最简单的挪到明天 ② ${todayWord()}先不做课外练习 ③ 跟爸妈说${todayWord()}作业偏多</div>` : ''}
    <div class="pb-acts">
      <button class="mini-btn" onclick="openItemAdd()">调整作业项</button>
    </div>
  </div>`;
}

function renderHome() {
  if (isAfterHours()) return renderAfterHours();
  const b = freeBalance();
  const cls = b === 0 ? 'zero' : b < 20 ? 'low' : '';
  const notStarted = nowMin() < DAY_START;      // 还没到开工点（工作日 19:00 / 周日 14:00）
  const word = b === 0
    ? (notStarted ? todayWord() + '时间排满了' : '今天没剩时间了')
    : b < 20 ? '有点紧，抓紧' : b < 45 ? '正常节奏' : '很宽裕';
  const hasItems = (S.items || []).length > 0;

  return `
  <div class="balance ${cls}">
    <div class="main">
      <div class="cap">距离 ${CFG.bedtime} 熄灯，还有</div>
      <div class="num">${b}<small>分钟自由</small></div>
      <div class="sub">${word} · 做完四格，剩下的时间全归你</div>
    </div>
    <div class="side">
      <div>今天已挣 <b>${S.earnedToday}</b> 币</div>
      <div>连续 <b>${S.streak}</b> 天达标</div>
    </div>
  </div>

  ${hasItems ? renderPlanBar() : renderPlanEmpty()}

  <div class="grids">
    ${GRIDS.map(g => {
      const blocks = SCHEDULE.filter(s => s.grid === g.id);
      const pr = gridProgress(g.id);
      const none = blocks.length === 0;
      const st = none ? 'off' : gridDone(g.id) ? 'done'
        : (blocks.some(s => S.tasks[s.id].status === 'rework') ? 'rework' : '');
      const state = none ? '今天不用'
        : st === 'done' ? '已完成'
        : st === 'rework' ? '需重做'
        : pr.total > 1 ? pr.done + '/' + pr.total + ' 块' : '未开始';
      return `<div class="grid-card ${st}">
        <div class="badge-dot"></div>
        <div class="gname">${g.name}</div>
        <div class="gstate">${state}</div>
      </div>`;
    }).join('')}
  </div>

  ${hasItems ? `
  <div class="sec">
    <div class="sec-h"><h2>今天的路线</h2><span class="hint">照着走就行，不用想</span></div>
    <div class="tl">${SCHEDULE.map(s => tlItem(s)).join('')}</div>
  </div>` : ''}`;
}

function tlItem(s) {
  const t = S.tasks[s.id];
  const isNow = s.kind !== 'break' && t.status === 'todo' && firstTodoId() === s.id;
  const overLine = s.kind !== 'break' && s.dur > 0 && s.start >= LIGHT_OUT;   // 起点已过熄灯线
  let cls = '';
  if (t.status === 'done') cls = 'done';
  else if (t.status === 'rework') cls = 'rework';
  if (s.kind === 'break') cls += ' break';
  if (s.locked) cls += ' locked';
  if (isNow) cls += ' now';
  if (overLine) cls += ' overline';

  const icoColor = s.kind === 'break' ? '#98A0B0'
    : s.kind === 'review' || s.kind === 'preview' ? '#D99322'
    : s.kind === 'practice' ? '#FF8A3D' : '#4F63E0';

  const tag = overLine ? '<span class="tag re">超出熄灯</span>'
    : s.locked ? '<span class="tag lock">不可挤占</span>'
    : t.status === 'rework' ? '<span class="tag re">需重做</span>'
    : t.status === 'timeout' ? '<span class="tag re">超时未完成</span>'
    : isNow ? '<span class="tag new">现在</span>' : '';

  const btn = t.status === 'done'
    ? `<button class="go">已完成</button>`
    : `<button class="go" onclick="openTask('${s.id}')">${t.status === 'rework' ? '重做' : (s.kind === 'wrap' ? '收工' : '开始')}</button>`;

  return `
  <div class="tl-item ${cls}">
    <div class="time">${s.slot || (s.kind === 'break' ? '—' : '')}</div>
    <div class="ico">${icon(s.icon, icoColor)}</div>
    <div class="body">
      <div class="t">${s.title}${tag}</div>
      <div class="d">${s.desc}</div>
    </div>
    ${s.kind === 'break' ? '' : btn}
  </div>`;
}

function firstTodoId() {
  const hit = SCHEDULE.find(s => s.kind !== 'break' && s.kind !== 'wrap' && S.tasks[s.id].status !== 'done');
  return hit ? hit.id : null;
}

/* ---------- 渲染 · 计时页 ---------- */
function renderTimer() {
  const cfg = SCHEDULE.find(s => s.id === S.timerTask) || SCHEDULE[1];
  const m = Math.ceil((tLeftMs() || cfg.dur * 60000) / 60000);
  const sk = curSkin();
  return `
  <div class="timer-wrap" style="--skin1:${sk.ring1};--skin2:${sk.ring2}">
    <div class="tw-top">
      <div class="tw-task">${cfg.title}</div>
      <div class="tw-desc">${cfg.desc}</div>
    </div>
    <div class="ring">
      <svg viewBox="0 0 320 320">
        <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${sk.ring1}"/><stop offset="100%" stop-color="${sk.ring2}"/>
        </linearGradient></defs>
        <circle class="track" cx="160" cy="160" r="150"/>
        <circle class="prog" id="ringProg" cx="160" cy="160" r="150"
          stroke-dasharray="942.5" stroke-dashoffset="942.5"/>
      </svg>
      <div class="center">
        <div class="tnum" id="clockNum">${pad(m)}:00</div>
        <div class="tlabel" id="clockLabel">${DEMO && S.speed ? '演示加速中' : '专注中'}</div>
      </div>
    </div>
    <div class="timer-actions">
      <button class="btn" onclick="pauseTimer()" id="pauseBtn">${T.paused ? '继续' : '暂停'}</button>
      <button class="btn primary" onclick="finishEarly()">完成这一块</button>
      <button class="btn ghost" onclick="quitTimer()">放弃</button>
    </div>
    ${S.haveSkin ? `<div class="skin-bar">
      ${SKINS.map(s => `<button class="skin-dot ${S.skin === s.id ? 'on' : ''}"
        style="background:${s.ring1}" title="${s.name}" aria-label="${s.name}"
        onclick="pickSkin('${s.id}')"></button>`).join('')}
      <span class="skin-name">${sk.name}</span>
    </div>` : ''}
    <div class="wake-line" id="wakeLine"></div>
    <div class="timer-hint">
      手机先别锁屏、别按 Home 键。真关掉了也不要紧：时间照走，回来会告诉你过了多久。
    </div>
  </div>`;
}

/* 皮肤只改配色，不碰任何判定逻辑。买了才有得选。 */
function curSkin() {
  return (typeof SKINS !== 'undefined' && SKINS.find(s => s.id === S.skin)) || (typeof SKINS !== 'undefined' ? SKINS[0] : { id: 'default', name: '深蓝', ring1: '#6B7CF0', ring2: '#4F63E0' });
}
function pickSkin(id) {
  if (!S.haveSkin) { toast('先去商店买皮肤包'); return; }
  S.skin = id;
  save();
  render();
  setTimeout(() => { const c = SCHEDULE.find(s => s.id === T.id); if (c) paintTimer(c); }, 60);
  toast('配色换成「' + curSkin().name + '」');
}
function pauseTimer() {
  if (!T.id) return;
  if (!T.paused) {
    T.remainMs = tLeftMs();          // 冻结剩余量，endAt 作废
    T.paused = true;
    stopWake();                      // 暂停就没必要烧电保活了
  } else {
    T.paused = false;
    T.endAt = Date.now() + T.remainMs;   // 接着上次的位置继续跑
    startWake();
  }
  saveTimerSnap();
  const b = $('#pauseBtn');
  if (b) b.textContent = T.paused ? '继续' : '暂停';
  const lb = $('#clockLabel');
  if (lb && !(DEMO && S.speed)) lb.textContent = T.paused ? '已暂停' : '专注中';
  paintWake();
  toast(T.paused ? '已暂停，时间停住' : '继续专注');
}
function finishEarly() {
  const cfg = SCHEDULE.find(s => s.id === S.timerTask);
  beep('done');
  clearTimerSnap();
  askEvidence(cfg);
}
function quitTimer() {
  clearTimerSnap();
  S.page = 'home';
  save(); render();
  toast('这个块不计数，不扣分，随时可以再来');
}

/* ---------- 渲染 · 成长 ---------- */
/* 称号：原来是「头像框」，但孩子端没有头像，买了没地方显示。
   改成挂在成长页顶部的称号，有实际载体。 */
function curTitle() {
  if (typeof TITLES === 'undefined') return '';
  const t = TITLES.find(x => x.id === S.title);
  return t ? t.name : '';
}
function pickTitle() {
  if (!S.haveTitle) { toast('先去商店买专属称号'); return; }
  const list = [{ id: '', name: '不显示' }].concat(TITLES);
  const i = list.findIndex(x => x.id === S.title);
  const next = list[(i + 1) % list.length];
  S.title = next.id;
  save(); render();
  toast('称号：' + next.name);
}

function renderGrowth() {
  const doneToday = SCHEDULE.filter(s => S.tasks[s.id].status === 'done' && s.kind !== 'break' && s.kind !== 'wrap');
  const mins = doneToday.reduce((a, s) => a + s.dur, 0);
  const bookTotal = S.books.reduce((a, b) => a + b.total, 0);
  const bookDone = S.books.reduce((a, b) => a + b.done, 0);

  return `
  ${S.haveTitle ? `<div class="title-bar">
    <span class="title-chip">${curTitle() || '还没选称号'}</span>
    <button class="mini-btn" onclick="pickTitle()">换称号</button>
  </div>` : ''}
  <div class="stat-row">
    <div class="stat"><div class="v">${mins}</div><div class="k">今日专注（分钟）</div></div>
    <div class="stat"><div class="v">${S.streak}</div><div class="k">连续达标天数</div></div>
    <div class="stat"><div class="v">${bookDone}</div><div class="k">练习册已做页数</div></div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>练习册进度</h2><span class="hint">系统每天派 1 页，不需要你记</span></div>
    ${S.books.map(b => {
      const pct = Math.round(b.done / b.total * 100);
      return `<div class="book">
        <div class="bh">
          <span class="bname">${b.name}</span>
          <span class="bsub">${b.subject}</span>
          <span class="bnum">${b.done}/${b.total} 页</span>
        </div>
        <div class="bar"><i style="width:${pct}%;background:${b.color}"></i></div>
      </div>`;
    }).join('')}
  </div>

  <div class="sec">
    <div class="sec-h"><h2>徽章</h2><span class="hint">只和昨天的自己比</span></div>
    <div class="badges">
      ${BADGES.map(b => `<div class="bdg ${b.got ? '' : 'off'}">
        <div class="bi">${b.icon}</div><div class="bn">${b.name}</div>
        <div class="bneed">${b.got ? '已获得' : b.need}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>积分规则</h2><span class="hint">只奖过程，不奖分数</span></div>
    <div class="p-card">
      ${POINT_RULES.map(r => `<div class="p-row"><span class="pn">${r.name}</span><span class="chip ok">+${r.val} 币</span></div>`).join('')}
      <div class="p-row"><span class="pn">每日封顶</span><span class="chip wait">${CFG.dayCap} 币</span></div>
    </div>
  </div>`;
}

/* ---------- 渲染 · 商店 ---------- */
/* ===========================================================
   宠物系统
   -----------------------------------------------------------
   规则一句话：喂一口就活，十天不管就死。
   死得有代价，但不会莫名其妙死 —— 中途任何一天按下喂食，断粮计数清零。
   状态只由孩子端结算（和 coins 一样，家长端写会被覆盖）。
   =========================================================== */

function petToday() { return histDateStr(0); }

/* 两个 YYYY-MM-DD 之间差几天 */
function petDayDiff(from, to) {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 1;
  return Math.round((b - a) / 86400000);
}

function petClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function petDef(pid) { return PETS.find(x => x.id === pid) || null; }
function petItemDef(id) { return PET_ITEMS.find(x => x.id === id) || null; }

function newPet(def) {
  return {
    pid: def.id, name: def.name, icon: def.icon, tier: def.tier,
    gotAt: Date.now(), born: petToday(),
    days: 0,
    /* 初始给七成，不是满的 —— 一领回来就得动手照顾，才有参与感 */
    food: 70, clean: 70, mood: 70, bond: 0,
    neglect: 0,          // 连续断粮天数，喂一口就归零
    lastTick: petToday(),
    playedOn: null,      // 玩具每天只能玩一次，防止刷心情
    dead: false, deadAt: null, epitaph: ''
  };
}

/* 阶段由「连续断粮天数」推导，不存冗余字段，避免两处状态打架 */
function petPhase(p) {
  if (!p || p.dead) return 'dead';
  const n = p.neglect || 0;
  if (n >= 10) return 'dead';
  if (n >= 7) return 'danger';
  if (n >= 4) return 'sick';
  if (n >= 1) return 'weak';
  return 'ok';
}

function petStage(p) {
  const d = (p && p.days) || 0;
  let s = PET_STAGES[0];
  PET_STAGES.forEach(x => { if (d >= x.at) s = x; });
  return s;
}

/* 心情上限：买家具能抬，这是买断品真正的用处 */
function petMoodCap() {
  let cap = 100;
  (S.petOwn || []).forEach(id => {
    const it = petItemDef(id);
    if (it && it.effect && it.effect.cap) cap += it.effect.cap;
  });
  return cap;
}

/* 每日结算。跨了几天就结几天，最长按 30 天算，防止长时间不打开一次算爆 */
function petTick() {
  const p = S.pet;
  if (!p || p.dead) return false;
  const today = petToday();
  if (p.lastTick === today) return false;

  const diff = Math.max(1, Math.min(30, petDayDiff(p.lastTick, today)));
  for (let i = 0; i < diff; i++) {
    p.food = Math.max(0, p.food - PET_DECAY.food);
    p.clean = Math.max(0, p.clean - PET_DECAY.clean);
    p.mood = Math.max(0, p.mood - PET_DECAY.mood);

    /* 断粮计数：饱食归零才算一天没管，吃饱就清零 */
    if (p.food <= 0) p.neglect = (p.neglect || 0) + 1;

    /* 照料到位才算成长天数。断一天只是不加，不掉级 */
    if (p.food > 30 && p.mood > 30 && p.clean > 20) p.days = (p.days || 0) + 1;

    if (p.neglect >= 10) { petDie(p); break; }
  }
  p.lastTick = today;
  return true;
}

function petEpitaph(p) {
  const d = p.days || 0;
  if (d >= 21) return '它陪你走完了整段路。';
  if (d >= 7) return '它长大了不少，只是没等到最后。';
  if (d >= 3) return '它记住你了。下次别再让它饿着。';
  return '它来得不久，但你喂过它。';
}

function petDie(p) {
  p.dead = true;
  p.deadAt = Date.now();
  p.epitaph = petEpitaph(p);
  S.petGrave = S.petGrave || [];
  S.petGrave.unshift({
    name: p.name, icon: p.icon, tier: p.tier,
    born: p.born, died: petToday(),
    days: p.days || 0, stage: petStage(p).name,
    epitaph: p.epitaph
  });
  S.petGrave = S.petGrave.slice(0, 20);
  S.pet = null;
  S._needPush = true;
  beep('down');
  toast('「' + p.name + '」走了，陪了你 ' + (p.days || 0) + ' 天');
}

/* 把一个用品的效果作用到宠物身上 */
function petApplyEffect(it, opts) {
  const p = S.pet;
  if (!p || p.dead) return { ok: false, msg: '没有宠物' };
  const e = it.effect || {};
  const o = opts || {};

  if (e.food) p.food = Math.min(100, p.food + e.food);
  if (e.clean) p.clean = petClamp(p.clean + e.clean, 0, 100);
  if (e.mood) p.mood = Math.min(petMoodCap(), p.mood + e.mood);

  /* 吃饱了就不算断粮 —— 这条是「救得回来」的核心 */
  if (p.food > 30) p.neglect = 0;

  /* 药：med 1 治虚弱和生病，med 2（急诊）连濒危也救得回来 */
  if (e.med) {
    const ph = petPhase(p);
    if (e.med >= 2 || ph === 'weak' || ph === 'sick' || ph === 'ok') {
      p.neglect = 0;
    } else {
      return { ok: false, msg: '这个药不够，濒危只能用急诊' };
    }
  }

  if (!o.noBond) p.bond = Math.min(100, (p.bond || 0) + 2);
  return { ok: true };
}

/* 用掉一件耗材 */
function petUse(itemId) {
  const p = S.pet;
  if (!p || p.dead) { toast('先去领养一只'); return; }
  const it = petItemDef(itemId);
  if (!it) return;
  if (it.kind === 'own') { petPlay(itemId); return; }

  const n = (S.petBag || {})[itemId] || 0;
  if (!n) { toast('背包里没有' + it.name + '，去宠物用品买'); return; }

  const r = petApplyEffect(it);
  if (!r.ok) { toast(r.msg); return; }

  S.petBag[itemId] = n - 1;
  if (!S.petBag[itemId]) delete S.petBag[itemId];
  S._needPush = true;
  save(); render(); closeSheet();
  const ph = petPhase(p);
  toast(it.name + ' · ' + p.name + (ph === 'ok' ? '很满意' : '缓过来了'));
}

/* 玩玩具：买断品，不花钱，但一天只能玩一次 */
function petPlay(itemId) {
  const p = S.pet;
  if (!p || p.dead) { toast('先去领养一只'); return; }
  const it = petItemDef(itemId);
  if (!it) return;
  if ((S.petOwn || []).indexOf(it.id) < 0) { toast('这个还没买'); return; }

  const ph = petPhase(p);
  if (ph === 'sick' || ph === 'danger') { toast('它现在没力气玩，先治好再说'); return; }

  const day = petToday();
  if (p.playedOn === day) { toast('今天已经玩过了，明天再来'); return; }
  p.playedOn = day;

  p.mood = Math.min(petMoodCap(), p.mood + (it.effect.mood || 0));
  p.clean = Math.max(0, p.clean - 5);        // 玩会弄脏，一点点
  p.bond = Math.min(100, (p.bond || 0) + 3);
  S._needPush = true;
  save(); render(); closeSheet();
  toast('和' + p.name + '玩了一会儿');
}

/* 领养 */
function adoptPet(petId) {
  const def = petDef(petId);
  if (!def) return;
  if (S.pet && !S.pet.dead) { toast('先把现在这只照顾好'); return; }
  if (S.coins < def.price) { toast('还差 ' + (def.price - S.coins) + ' 币'); return; }

  showSheet({
    title: '领养 · ' + def.name,
    sub: def.trait + '。领养后每天要喂它，十天一次都不管，它会离开。',
    body: `<div style="text-align:center;font-size:64px;padding:10px 0">${def.icon}</div>
      <div style="font-size:13px;color:var(--ink2);line-height:1.8;padding:0 4px">
        领养价 ${def.price} 币。回家后先喂一顿，饱食度只有七成。
      </div>`,
    actions: [
      { label: '再想想', ghost: true, act: closeSheet },
      { label: '领养（' + def.price + ' 币）', primary: true, act: () => {
          S.coins -= def.price;
          S.pet = newPet(def);
          S._needPush = true;
          save(); closeSheet(); go('pet');
          toast(def.name + '跟你回家了');
        } }
    ]
  });
}

/* 买宠物用品：耗材进背包，买断品直接进宠物页 */
function buyPetItem(itemId) {
  const it = petItemDef(itemId);
  if (!it) return;
  if (S.coins < it.price) { toast('还差 ' + (it.price - S.coins) + ' 币'); return; }
  if (it.kind === 'own' && (S.petOwn || []).indexOf(it.id) >= 0) { toast('这个已经买过了'); return; }
  if (it.kind === 'use' && !S.pet) { toast('先领养一只，再买它的东西'); return; }

  S.coins -= it.price;
  if (it.kind === 'own') {
    S.petOwn = S.petOwn || [];
    S.petOwn.push(it.id);
  } else {
    S.petBag = S.petBag || {};
    S.petBag[it.id] = (S.petBag[it.id] || 0) + 1;
  }
  S._needPush = true;
  save(); render();
  beep('coin');
  toast('已买：' + it.name + (it.kind === 'own' ? ' · 去宠物页看' : ' · 放进背包'));
}

/* 练习换命：做练习能给宠物减断粮天数，这是不花钱的活路 */
function petPracticeRescue(pages) {
  const p = S.pet;
  if (!p || p.dead) return;
  const n = Math.max(1, pages || 1);
  p.neglect = Math.max(0, (p.neglect || 0) - n);
  if (p.neglect === 0) p.food = Math.max(p.food, 35);
  S._needPush = true;
  save();
  if (n >= 3) toast('做了 ' + n + ' 页练习，' + p.name + '缓过来了');
}

/* 打开某类用品的抽屉 */
function petOpenUse(cat) {
  const p = S.pet;
  if (!p || p.dead) { toast('先去领养一只'); return; }

  const isToy = cat === 'toy';
  const list = isToy
    ? (S.petOwn || []).map(petItemDef).filter(x => x && x.cat === 'toy')
    : PET_ITEMS.filter(x => x.cat === cat && x.kind === 'use' && ((S.petBag || {})[x.id] || 0) > 0);

  const titleMap = { food: '喂点什么', clean: '清洁', toy: '玩什么', med: '看医生' };
  let body = '';
  if (!list.length) {
    body = `<div style="padding:16px 4px;color:var(--ink2);font-size:13.5px;line-height:1.8">
      ${isToy ? '还没有玩具。去商店的宠物用品买一个，往后每天都能玩，不再花钱。'
              : '背包里没有能用的东西了。去商店的宠物用品补一点。'}
    </div>`;
  } else {
    body = list.map(it => `<div class="p-row" style="padding:10px 0">
      <span class="pn">${it.icon} ${it.name}</span>
      <span class="ps">${isToy ? '已买断' : '剩 ' + ((S.petBag || {})[it.id] || 0) + ' 个'}</span>
      <button class="mini-btn ok" onclick="${isToy ? 'petPlay' : 'petUse'}('${it.id}')">${isToy ? '玩' : '用'}</button>
    </div>`).join('');
  }

  showSheet({
    title: titleMap[cat] || '用品',
    sub: p.name + ' · ' + (PET_PHASES.find(x => x.id === petPhase(p)) || {}).name,
    body,
    actions: [{ label: '关闭', ghost: true, act: closeSheet }]
  });
}

/* ---------- 宠物页 ---------- */

function petBar(label, val, max, color) {
  const pct = Math.max(0, Math.min(100, Math.round((val / max) * 100)));
  const warn = pct <= 20;
  return `<div class="pet-bar">
    <span class="pb-l">${label}</span>
    <span class="pb-t"><i style="width:${pct}%;background:${warn ? '#D94A4A' : color}"></i></span>
    <span class="pb-v" style="${warn ? 'color:#D94A4A' : ''}">${Math.round(val)}</span>
  </div>`;
}

/* 领养列表：六档，按档位分组。宠物页和商店共用这一份 */
function petPickHTML() {
  return PET_TIERS.map(t => {
    const list = PETS.filter(p => p.tier === t.id);
    return `<div class="pet-tier-h"><i style="background:${t.color}"></i>${t.name}
      <em>${t.tag} · ${list[0].price} 币起</em></div>
      <div class="pet-pick">
        ${list.map(p => {
          const can = S.coins >= p.price;
          return `<button class="pet-card ${can ? '' : 'dis'}" onclick="adoptPet('${p.id}')">
            <span class="pc-ico">${p.icon}</span>
            <span class="pc-nm">${p.name}</span>
            <span class="pc-pr">${p.price}</span>
          </button>`;
        }).join('')}
      </div>`;
  }).join('');
}

/* 回忆册：走掉的宠物永久留在这里 */
function graveHTML() {
  const list = S.petGrave || [];
  if (!list.length) return '';
  return `<div class="sec">
    <div class="sec-h"><h2>回忆册</h2><span class="hint">${list.length} 只</span></div>
    <div class="p-card">
      ${list.map(g => `<div class="grave-row">
        <span class="gv-ico">${g.icon}</span>
        <span class="gv-body">
          <b>${g.name}</b>
          <em>${g.born} — ${g.died} · 陪了 ${g.days} 天 · ${g.stage}</em>
          <i>${g.epitaph}</i>
        </span>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderPet() {
  const p = S.pet;

  /* 还没领养（或者上一只已经走了） */
  if (!p || p.dead) {
    return `<div class="wallet">
      <div class="w-ico">🥚</div>
      <div>
        <div class="w-num">${S.coins}</div>
        <div class="w-cap">我的成长币</div>
      </div>
      <div class="w-right">领一只<br>陪你写作业</div>
    </div>
    <div class="sec">
      <div class="sec-h"><h2>领一只回家</h2><span class="hint">300 币起步，传说档 10000</span></div>
      ${petPickHTML()}
      <div class="pet-tip">领回来饱食只有七成，先喂一顿。之后每天喂一次，十天一次都不管，它会离开。</div>
    </div>
    ${graveHTML()}`;
  }

  const ph = petPhase(p);
  const st = petStage(p);
  const cap = petMoodCap();
  const phDef = PET_PHASES.find(x => x.id === ph) || PET_PHASES[0];
  const owns = S.petOwn || [];
  const wears = owns.map(petItemDef).filter(x => x && x.cat === 'wear');
  const furns = owns.map(petItemDef).filter(x => x && x.cat === 'furn');
  const bagN = Object.keys(S.petBag || {}).reduce((a, k) => a + (S.petBag[k] || 0), 0);

  /* 濒危倒计时：还剩几天 */
  const left = Math.max(0, 10 - (p.neglect || 0));

  let warn = '';
  if (ph === 'weak') {
    warn = `<div class="pet-warn warm">它饿了。喂一口就缓过来，断粮计数会清零。</div>`;
  } else if (ph === 'sick') {
    warn = `<div class="pet-warn bad">生病了，吃不下东西。用普通药，或者做 1 页练习也能救。</div>`;
  } else if (ph === 'danger') {
    warn = `<div class="pet-warn dead">濒危。只剩 ${left} 天，只有急诊（200 币）救得回来。</div>`;
  }

  return `<div class="pet-hero ph-${ph}">
      <div class="pet-hd">
        <span class="pet-nm">${p.name}</span>
        <span class="chip ${ph === 'ok' ? 'ok' : 'bad'}">${phDef.name}</span>
        <span class="pet-stg">${st.icon} ${st.name}</span>
      </div>
      <div class="pet-stage">
        ${wears.length ? `<div class="pet-wears">${wears.map(w => `<span>${w.icon}</span>`).join('')}</div>` : ''}
        <div class="pet-face">${p.icon}</div>
        ${furns.length ? `<div class="pet-furns">${furns.map(f => `<span>${f.icon}</span>`).join('')}</div>` : ''}
      </div>
      <div class="pet-meta">陪你 ${p.days} 天 · ${st.name}${st.id < 3 ? '（' + (PET_STAGES[st.id].at - p.days) + ' 天后长大）' : ''}</div>
    </div>

    ${warn}

    <div class="sec" style="margin-top:14px">
      <div class="p-card pet-bars">
        ${petBar('饱食', p.food, 100, '#E8894A')}
        ${petBar('干净', p.clean, 100, '#4FA3E0')}
        ${petBar('心情', p.mood, cap, '#D4437A')}
        ${petBar('亲密', p.bond, 100, '#23A26D')}
      </div>
    </div>

    <div class="pet-acts">
      <button class="pa" onclick="petOpenUse('food')"><b>🍚</b><span>喂食</span></button>
      <button class="pa" onclick="petOpenUse('clean')"><b>🛁</b><span>清洁</span></button>
      <button class="pa" onclick="petOpenUse('toy')"><b>🎾</b><span>玩耍</span></button>
      <button class="pa" onclick="petOpenUse('med')"><b>💊</b><span>看医生</span></button>
    </div>

    <div class="sec">
      <div class="sec-h"><h2>它的家当</h2><span class="hint">背包 ${bagN} 件 · 买断 ${owns.length} 件</span></div>
      <div class="p-card">
        ${owns.length ? owns.map(id => {
          const it = petItemDef(id);
          return it ? `<span class="own-chip">${it.icon} ${it.name}</span>` : '';
        }).join('') : `<div class="empty">还没有玩具和家具，去商店的宠物用品看看。</div>`}
      </div>
    </div>

    ${graveHTML()}`;
}

/* 商店里的宠物用品网格：7 类按顺序铺开 */
function petItemsHTML() {
  return PET_CATS.map(c => {
    const list = PET_ITEMS.filter(i => i.cat === c.id);
    return `<div class="pet-tier-h"><i style="background:#B9C0D4"></i>${c.icon} ${c.name}</div>
      <div class="shop-grid">
        ${list.map(i => {
          const can = S.coins >= i.price;
          const have = i.kind === 'own' && (S.petOwn || []).indexOf(i.id) >= 0;
          const cnt = (S.petBag || {})[i.id] || 0;
          return `<div class="item">
            <span class="corner ${i.kind === 'own' ? 'app' : 'big'}">${i.kind === 'own' ? '买断' : '耗材'}</span>
            <div class="nm">${i.icon} ${i.name}</div>
            <div class="nt">${i.desc || ''}${cnt ? ' · 有 ' + cnt + ' 个' : ''}</div>
            <div class="foot">
              <div class="price">${i.price}<span>币</span></div>
              ${have ? `<button class="buy dis">已拥有</button>`
                : `<button class="buy ${can ? '' : 'dis'}" onclick="buyPetItem('${i.id}')">购买</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');
}

/* ---------- 家长端 · 孩子养的宠物 ----------
   代喂不走 household（那是孩子端专属写权），走 redeems 表打标记：
   item_id = '__petbail__' 的记录不进兑换单，只当信号用。
   mergeRedeems 里看到这种行就给孩子宠物加饱食、清断粮计数。 */
function petBailCount() {
  const ym = petToday().slice(0, 7);
  return (S.redeems || []).filter(r =>
    r.item_id === '__petbail__' && String(r.note || '').indexOf(ym) === 0).length;
}

function petBailout() {
  const p = S.pet;
  if (!p || p.dead) { toast('孩子现在没有养宠物'); return; }
  const used = petBailCount();
  if (used >= 2) { toast('这个月已经代喂 2 次，用完了'); return; }
  const usedBefore = used;
  if (S.synced && window.Cloud) {
    Cloud.addRedeem({
      item_id: '__petbail__', item_name: '代喂', price: 0,
      status: 'done', note: petToday().slice(0, 7) + ' 家长代喂'
    });
  }
  /* 家长端本地也生效一次（快照），孩子端收到信号后会算正式的那次 */
  p.food = Math.min(100, p.food + 35);
  if (p.food > 30) p.neglect = 0;
  save(); render();
  toast('已代喂（本月 ' + (usedBefore + 1) + '/2）· 孩子端稍后会看到');
}

function petParentCardHTML() {
  const p = S.pet;
  if (!p) {
    const g = (S.petGrave || [])[0];
    return `<div class="sec">
      <div class="sec-h"><h2>孩子养的宠物</h2><span class="hint">养宠物是孩子自己挣币养出来的</span></div>
      <div class="p-card"><div class="empty">${g
        ? '上一只「' + g.name + '」在 ' + g.died + ' 离开了，留在孩子的回忆册里。'
        : '还没领养。攒够 300 币就能领第一只。'}</div></div>
    </div>`;
  }

  const ph = petPhase(p);
  const st = petStage(p);
  const phDef = PET_PHASES.find(x => x.id === ph) || PET_PHASES[0];
  const used = petBailCount();
  const left = Math.max(0, 10 - (p.neglect || 0));

  const mini = (l, v, c) => `<div class="pp-mini"><span>${l}</span><b style="color:${c}">${Math.round(v)}</b></div>`;

  return `<div class="sec">
    <div class="sec-h"><h2>孩子养的宠物</h2><span class="hint">${st.name} · 陪了 ${p.days} 天</span></div>
    <div class="p-card">
      <div class="pp-hero">
        <span class="pp-face ph-${ph}">${p.icon}</span>
        <span class="pp-name">${p.name}<em>${phDef.name}${ph === 'danger' ? ' · 剩 ' + left + ' 天' : ''}</em></span>
      </div>
      <div class="pp-grid">
        ${mini('饱食', p.food, p.food <= 20 ? '#D94A4A' : '#E8894A')}
        ${mini('干净', p.clean, '#4FA3E0')}
        ${mini('心情', p.mood, '#D4437A')}
        ${mini('亲密', p.bond, '#23A26D')}
      </div>
      ${ph === 'danger' || ph === 'sick'
        ? `<button class="mini-btn ok" style="width:100%;margin-top:10px" onclick="petBailout()">代喂一次（本月 ${used}/2，免费）</button>` : ''}
    </div>
  </div>`;
}

function renderShop() {
  const list = SHOP.filter(i => i.cat === S.shopCat);
  const wait = waitOrders();
  return `
  <div class="wallet">
    <div class="w-ico">🪙</div>
    <div>
      <div class="w-num">${S.coins}</div>
      <div class="w-cap">我的成长币</div>
    </div>
    <div class="w-right">
      今天已挣 ${S.earnedToday}<br>
      每天封顶 ${CFG.dayCap}
    </div>
  </div>

  ${(wait.length || (S.refundLog || []).length) ? `<div class="sec" style="margin-top:0">
    <div class="sec-h"><h2>待兑现</h2><span class="hint">${wait.length
      ? wait.length + ' 件 · 这些东西已经扣过币了，找爸妈要'
      : '没有欠着的，下面是最近被退回的'}</span></div>
    ${ordersCardHTML('child')}
  </div>` : ''}

  <div class="cats">
    ${SHOP_CATS.map(c => `<button class="cat ${S.shopCat === c.id ? 'on' : ''}" onclick="pickCat('${c.id}')">${c.icon} ${c.name}</button>`).join('')}
  </div>

  ${S.shopCat === 'petzone' ? petPickHTML()
    : S.shopCat === 'petitem' ? petItemsHTML()
    : `<div class="shop-grid">
    ${list.map(i => {
      const can = S.coins >= i.price;
      const owned = S.owned.filter(x => x === i.id).length;
      const has = (i.id === 'c2' && S.haveSkin) || (i.id === 'c3' && S.haveTitle);
      const corner = has ? '<span class="corner app">已拥有</span>'
        : i.approve ? '<span class="corner app">需批准</span>'
        : i.hot ? '<span class="corner hot">热门</span>'
        : i.big ? '<span class="corner big">大件</span>' : '';
      return `<div class="item">
        ${corner}
        <div class="nm">${i.name}</div>
        <div class="nt">${i.note || ''}${owned ? ' · 已换过 ' + owned + ' 次' : ''}</div>
        <div class="foot">
          <div class="price">${i.price}<span>币</span></div>
          ${has
            ? `<button class="buy" onclick="${i.id === 'c2' ? "toast('去计时页底部换配色')" : "go('growth')"}">去用</button>`
            : `<button class="buy ${can ? '' : 'dis'}" onclick="buy('${i.id}')">兑换</button>`}
        </div>
      </div>`;
    }).join('')}
  </div>`}

  <div class="sec">
    <div class="sec-h"><h2>兑换规则</h2></div>
    <div class="p-card" style="font-size:13.5px;color:var(--ink2);line-height:2">
      · 点兑换就扣币，同时生成一张单子，出现在上面的「待兑现」<br>
      · 单子上有期限：当天、当晚、次日、本周末 —— 到点给到就算兑现<br>
      · 家长端也能看到同一张单子，点「已兑现」两边一起消掉<br>
      · 家长不认可可以退币，不会白扣<br>
      · 只加分不扣分，做不到就是没得到<br>
      · 不能换钱、不能换分数、不能赎回本来就该有的权利
    </div>
  </div>`;
}
function pickCat(id) { S.shopCat = id; save(); render(); }

/* ---------- 兑换单 ----------
   扣了币就必须留一张单子。
   旧版兑完只弹一句「今天兑现，别拖」，孩子手上没有任何凭证，家长端也
   完全看不到欠了什么 —— 这就是「点一下币就没了」的根因。
   现在每一笔兑换都会生成一张单，走「待兑现 → 已兑现」的闭环。 */
function dueFromNote(note) {
  const t = String(note || '');
  if (t.indexOf('当晚') >= 0) return '当晚';
  if (t.indexOf('周末') >= 0) return '本周末';
  if (t.indexOf('次早') >= 0 || t.indexOf('次日') >= 0 || t.indexOf('明天') >= 0) return '次日';
  return '当天';
}

function newOrder(item, extra) {
  const o = Object.assign({
    id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    cid: null,                       // 云端记录 id，用来和另一台设备对齐
    itemId: item.id,
    name: item.name,
    price: item.price || 0,
    due: dueFromNote(item.note),
    at: Date.now(),
    status: 'wait',
    doneAt: null
  }, extra || {});
  S.orders.unshift(o);
  return o;
}

/* 推一条到云端。拿回 id 就记在单子上，家长端点了已兑现才同步得回来。 */
function pushOrderCloud(o) {
  if (!S.synced || !window.Cloud) return;
  Promise.resolve(Cloud.addRedeem({
    item_id: o.itemId, item_name: o.name, price: o.price,
    status: 'wait', note: '限期 ' + o.due
  })).then(r => {
    if (r && r.id) { o.cid = r.id; save(); }
  }).catch(() => {});
}

/* 孩子端自己确认收到。家长端那边也会把这个状态写回云端。 */
function orderDone(id) {
  const o = S.orders.find(x => x.id === id);
  if (!o) return;
  o.status = 'done';
  o.doneAt = Date.now();
  if (o.cid && S.synced && window.Cloud) Cloud.setRedeemStatus(o.cid, 'done', '孩子已确认收到');
  save(); render();
  toast('已兑现：' + o.name);
}

/* 兑换单去重 —— 修「买一次、兑现区出现两个」。
   根因：本地那张单要和云端 redeems 表对上，靠的是 addRedeem 回传的 id。
   只要回传慢一拍，或者只回了 true 没回 id，mergeRedeems 就把云端那条
   当成「另一台设备下的单」又补一条进来，待兑现里于是出现两份一模一样的。
   更坏的是副本一旦生下来就清不掉：两条 cid 相同，后面的 find 只命中前面
   那条，副本再也不会被更新、也不会被删，孩子点掉一个另一个还赖着。
   所以每次合并前先归一：cid 相同的只留本地那条；cid 空着的本地单，
   用「同一商品 + 同价 + 十分钟内」去认领对应的云端副本。 */
function dedupeOrders() {
  const list = S.orders || [];
  if (list.length < 2) return 0;

  /* 第一步：同 cid 归一，优先留本地下的单（它有真实下单时刻和限期） */
  const byCid = new Map();
  const kept = [];
  const rank = x => x.status === 'done' ? 2 : x.status === 'rejected' ? 1 : 0;

  list.forEach(o => {
    if (!o.cid) { kept.push(o); return; }
    const prev = byCid.get(o.cid);
    if (!prev) { byCid.set(o.cid, o); kept.push(o); return; }
    const winner = (prev.fromCloud && !o.fromCloud) ? o
      : (!prev.fromCloud && o.fromCloud) ? prev
      : rank(o) > rank(prev) ? o : prev;
    const loser = winner === o ? prev : o;
    if (!winner.cid) winner.cid = loser.cid;
    if (!winner.doneAt) winner.doneAt = loser.doneAt;
    if (winner.refunded || loser.refunded) winner.refunded = true;
    const at = kept.indexOf(prev);
    if (at >= 0) kept[at] = winner;
    byCid.set(winner.cid, winner);
  });

  /* 第二步：cid 空着的本地单，认领时间接近的云端副本 */
  kept.filter(o => !o.cid && !o.fromCloud).forEach(o => {
    const twin = kept.find(x => x !== o && x.fromCloud && !x.claimed
      && x.itemId === o.itemId && Number(x.price) === Number(o.price)
      && Math.abs((x.at || 0) - (o.at || 0)) < 600000);
    if (!twin) return;
    o.cid = twin.cid;
    twin.claimed = true;
    if (!o.doneAt) o.doneAt = twin.doneAt;
    if (twin.refunded) o.refunded = true;
    const at = kept.indexOf(twin);
    if (at >= 0) kept.splice(at, 1);
  });

  const removed = list.length - kept.length;
  if (removed > 0) {
    kept.sort((a, b) => (b.at || 0) - (a.at || 0));
    S.orders = kept;
  }
  return removed;
}

/* 家长驳回：退币。孩子误点或者家长不认可时，不能让孩子白亏。
   注意架构约束：coins 只由孩子端写回云端（pushHousehold 只在 role=child 时跑）。
   所以家长端只把状态标成 rejected，真正加币等孩子端拉到再结算，
   否则家长加的币下一次同步就被孩子端的旧值盖掉了。 */
function refundIfNeeded(o) {
  if (o.status !== 'rejected' || o.refunded) return false;
  o.refunded = true;

  /* 商品所有权要跟着退。只加币不删 owned 的话，币退回来了、商店里还写着
     「已换过 1 次」，孩子等于白得一件。
     皮肤包 c2 和称号 c3 是买断的，回滚会把孩子已经挑好的配色一起弄丢，
     这两项只退币、不动权限。 */
  if (o.itemId && o.itemId !== 'c2' && o.itemId !== 'c3') {
    const i = (S.owned || []).lastIndexOf(o.itemId);
    if (i >= 0) S.owned.splice(i, 1);
  }

  if (S.role === 'child') {
    S.coins += o.price;
    S._needPush = true;
    /* 孩子端必须留痕：币悄悄变多，孩子只会以为家长忘了兑现 */
    S.refundLog = (S.refundLog || []).slice(0, 4);
    S.refundLog.unshift({ name: o.name, price: o.price, at: Date.now() });
  }
  return true;
}

/* 撤销退币：家长点错了，把这单退回「待兑现」。
   币在孩子端已经加过了，所以撤销必须把币扣回去，否则等于白送一次。
   扣到 0 为止，不出现负币。 */
function orderUndoReject(id) {
  const o = S.orders.find(x => x.id === id);
  if (!o || o.status !== 'rejected') return;
  showSheet({
    title: '撤销退币',
    sub: '这单会回到「待兑现」。孩子端已经拿到的 ' + o.price + ' 币要扣回去。',
    body: '',
    actions: [
      { label: '算了', ghost: true, act: closeSheet },
      { label: '撤销，继续兑现', primary: true, act: () => {
          o.status = 'wait';
          o.refunded = false;
          o.doneAt = null;
          if (S.role === 'child') { S.coins = Math.max(0, S.coins - o.price); S._needPush = true; }
          if (o.cid && S.synced && window.Cloud) Cloud.setRedeemStatus(o.cid, 'wait', '家长撤销退币');
          save(); render();
          toast('已撤销，这单回到待兑现');
        } }
    ]
  });
}

function orderReject(id) {
  const o = S.orders.find(x => x.id === id);
  if (!o) return;
  o.status = 'rejected';
  o.doneAt = Date.now();
  refundIfNeeded(o);
  if (o.cid && S.synced && window.Cloud) Cloud.setRedeemStatus(o.cid, 'rejected', '家长驳回，已退币');
  save(); render();
  toast(S.role === 'child' ? '已退 ' + o.price + ' 币：' + o.name : '已驳回，孩子端下次同步会退币');
}

/* 云端兑换记录并回本地。
   两端是不同设备，家长那边点完已兑现，孩子这边下次拉取要能看到。 */
function mergeRedeems(list) {
  if (!Array.isArray(list)) return;

  /* 先清一次历史脏数据：v1.2.9 留下的重复单就在这一步被合并掉，
     孩子不用重装、不用清缓存，下次同步就正常了。 */
  const cleaned = dedupeOrders();

  S.redeems = list;
  const freshRefund = [];
  S.petBailSeen = S.petBailSeen || {};
  let bailToast = null;

  list.forEach(r => {
    /* 家长代喂信号：不进兑换单。按云端 id 记一次，别每 25 秒轮询就喂一遍 */
    if (r.item_id === '__petbail__') {
      if (!S.petBailSeen[r.id]) {
        S.petBailSeen[r.id] = 1;
        const keys = Object.keys(S.petBailSeen);
        if (keys.length > 60) { delete S.petBailSeen[keys[0]]; }
        const p = S.pet;
        if (p && !p.dead) {
          p.food = Math.min(100, p.food + 35);
          if (p.food > 30) p.neglect = 0;
          bailToast = '爸爸/妈妈喂了你 · ' + p.name + '吃饱了';
        }
        save();
      }
      return;
    }
    const local = S.orders.find(o => o.cid === r.id);
    if (local) {
      if (r.status === 'done' && local.status !== 'done') {
        local.status = 'done'; local.doneAt = Date.parse(r.resolved_at) || Date.now();
      } else if (r.status === 'rejected' && local.status !== 'rejected') {
        local.status = 'rejected'; local.doneAt = Date.parse(r.resolved_at) || Date.now();
        if (refundIfNeeded(local)) freshRefund.push(local);
      } else if (r.status !== 'rejected' && r.status !== 'done' && local.status === 'rejected') {
        /* 家长撤销了退币：状态回待兑现，孩子端把已经退到手的币扣回去 */
        local.status = 'wait';
        if (local.refunded) {
          local.refunded = false;
          if (S.role === 'child') {
            S.coins = Math.max(0, S.coins - local.price);
            S._needPush = true;
          }
        }
        local.doneAt = null;
      }
      return;
    }
    /* 本地没有 → 另一台设备下的单，补一条只读的进来，别让家长端看不到 */
    const nu = {
      id: 'r' + r.id, cid: r.id, itemId: r.item_id, name: r.item_name,
      price: r.price || 0,
      due: String(r.note || '').replace(/^限期\s*/, '') || '当天',
      at: Date.parse(r.created_at) || Date.now(),
      status: r.status === 'done' ? 'done' : r.status === 'rejected' ? 'rejected' : 'wait',
      doneAt: Date.parse(r.resolved_at) || null,
      fromCloud: true
    };
    S.orders.push(nu);
    if (refundIfNeeded(nu)) freshRefund.push(nu);
  });

  /* 本轮补进来的副本本身也可能是重复的，再归一一次 */
  const again = dedupeOrders();

  /* 孩子端要第一时间知道「哪一单被驳回了」。
     以前币悄悄变多，孩子想不通，还以为家长忘了兑现。 */
  if (freshRefund.length && S.role === 'child') {
    const one = freshRefund[0];
    toast('家长没同意 · 已退回 ' + one.price + ' 币：' + one.name
      + (freshRefund.length > 1 ? ' 等 ' + freshRefund.length + ' 单' : ''));
  }
  if (bailToast && S.role === 'child') toast(bailToast);

  /* 有变动就落盘，别等下一次 save 把退币记录丢掉 */
  if (freshRefund.length || cleaned || again) save();
}

/* 待兑现列表：孩子端和家长端共用一套渲染，按钮不同。
   渲染层再兜一次重：同商品 + 同价 + 五分钟内只算一单。
   数据层已经归一过了，这里防的是浏览器里存下来的旧脏数据。 */
function waitOrders() {
  const out = [];
  (S.orders || []).filter(o => o.status === 'wait')
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .forEach(o => {
      const dup = out.find(x => x.name === o.name
        && Number(x.price) === Number(o.price)
        && Math.abs((x.at || 0) - (o.at || 0)) < 300000);
      if (!dup) out.push(o);
    });
  return out;
}

/* 孩子端：最近被驳回退币的单子。
   币变多了总得有个说法，不然孩子只看见数字涨，不知道为什么。 */
function refundLogHTML() {
  const log = S.refundLog || [];
  if (!log.length) return '';
  return `<div class="p-card" style="border-left:3px solid #E8894A;margin-top:10px">
    ${log.map(r => {
      const mins = Math.floor((Date.now() - r.at) / 60000);
      const when = mins < 1 ? '刚刚' : mins < 60 ? mins + ' 分钟前'
        : mins < 1440 ? Math.floor(mins / 60) + ' 小时前' : Math.floor(mins / 1440) + ' 天前';
      return `<div class="p-row">
        <span class="pn">${r.name}</span>
        <span class="ps">家长没同意 · 退回 ${r.price} 币 · ${when}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* 家长端「已处理」：近 7 天兑现和驳回过的单子。
   以前驳回完就从列表里消失，点错了没处找、也撤不回来。 */
function handledOrders(days) {
  const since = Date.now() - (days || 7) * 86400000;
  return (S.orders || [])
    .filter(o => o.status !== 'wait' && (o.doneAt || o.at) >= since)
    .sort((a, b) => (b.doneAt || b.at) - (a.doneAt || a.at));
}

function handledCardHTML() {
  const list = handledOrders(7);
  if (!list.length) return '';
  return `<div class="sec">
    <div class="sec-h"><h2>已处理</h2><span class="hint">近 7 天 · 点错了可以撤销</span></div>
    <div class="p-card">
      ${list.map(o => {
        const d = new Date(o.doneAt || o.at);
        const md = (d.getMonth() + 1) + '/' + d.getDate();
        const bad = o.status === 'rejected';
        return `<div class="p-row">
          <span class="pn">${o.name}${bad ? ' <span class="chip bad">已退币</span>' : ''}</span>
          <span class="ps">${md} · ${o.price} 币</span>
          ${bad ? `<button class="mini-btn" onclick="orderUndoReject('${o.id}')">撤销退币</button>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function ordersCardHTML(who) {
  const list = waitOrders();
  const tail = who === 'child' ? refundLogHTML() : '';
  if (!list.length) {
    return `<div class="p-card"><div class="empty">${who === 'parent'
      ? '没有欠着的兑换。孩子换了东西会出现在这里。'
      : '暂时没有待兑现的东西。换完会出现在这里。'}</div></div>${tail}`;
  }
  return `<div class="p-card">
    ${list.map(o => {
      const days = Math.floor((Date.now() - o.at) / 86400000);
      const late = days >= 2;
      return `<div class="p-row">
        <span class="pn">${o.name}${late ? ' <span class="chip bad">等 ' + days + ' 天</span>' : ''}</span>
        <span class="ps">${o.due} · ${o.price} 币</span>
        ${who === 'parent'
          ? `<button class="mini-btn ok" onclick="orderDone('${o.id}')">已兑现</button>
             <button class="mini-btn" onclick="orderReject('${o.id}')">退币</button>`
          : `<button class="mini-btn" onclick="orderDone('${o.id}')">已收到</button>`}
      </div>`;
    }).join('')}
  </div>${tail}`;
}

function buy(id) {
  const item = SHOP.find(i => i.id === id);
  if (!item) return;
  if (S.coins < item.price) { toast('还差 ' + (item.price - S.coins) + ' 币'); return; }

  /* 皮肤包和称号各买一次就够，别让孩子重复花币 */
  if ((id === 'c2' && S.haveSkin) || (id === 'c3' && S.haveTitle)) {
    toast(id === 'c2' ? '皮肤包已经买过了，去计时页换配色' : '称号已经买过了，去成长页挑一个');
    return;
  }

  if (item.lottery) { drawLottery(item); return; }

  if (item.approve) {
    showSheet({
      title: '提交申请 · ' + item.name,
      sub: '这一项需要家长批准，提交后会推送到家长端。',
      body: item.safety
        ? `<label style="display:flex;gap:10px;align-items:flex-start;font-size:13.5px;padding:12px;background:#FDF3E0;border-radius:12px;line-height:1.7">
             <input type="checkbox" id="safeChk" style="margin-top:3px;width:18px;height:18px">
             <span>已确认对方家长知情并同意，往返由家长安排。本次实际占用约 2.5 小时。</span>
           </label>`
        : `<div style="font-size:13.5px;color:var(--ink2);padding:8px 0">批准后立即生效，币在批准时扣除。</div>`,
      actions: [
        { label: '取消', ghost: true, act: closeSheet },
        { label: '提交申请', primary: true, act: () => {
            if (item.safety) {
              const c = $('#safeChk');
              if (!c || !c.checked) { toast('请先勾选「对方家长知情」'); return; }
            }
            closeSheet();
            S.pending.push({ id: item.id, name: item.name, price: item.price });
            if (S.synced && window.Cloud) {
              Cloud.addRedeem({
                item_id: item.id, item_name: item.name, price: item.price,
                status: 'pending', note: '待家长批准'
              });
            }
            save();
            toast('已提交，等家长批准');
            render();
          } }
      ]
    });
    return;
  }

  S.coins -= item.price;
  S.owned.push(item.id);
  if (id === 'c2') S.haveSkin = true;
  if (id === 'c3') S.haveTitle = true;
  const o = newOrder(item);
  pushOrderCloud(o);
  save(); render();
  beep('coin');
  toast('已下单：' + item.name + ' · 在「待兑现」里');
}

/* ---------- 盲盒 ----------
   旧版 4 个奖品里只有「积分回馈」真给东西，另外两项抽中后连记录都没有，
   花 100 币有 75% 概率抽到空气。
   现在必中：抽到实物就落一张兑换单，抽到币就当场返。 */
function drawLottery(item) {
  S.coins -= item.price;
  const pool = LOTTERY_POOL;
  const total = pool.reduce((a, x) => a + (x.weight || 1), 0);
  let r = Math.random() * total;
  let got = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= (pool[i].weight || 1);
    if (r <= 0) { got = pool[i]; break; }
  }

  let line;
  if (got.coins) {
    S.coins += got.coins;
    line = '直接返你 ' + got.coins + ' 成长币，已经到账';
  } else {
    const o = newOrder(got);
    pushOrderCloud(o);
    line = '已放进「待兑现」，限期 ' + o.due;
  }
  save(); render();
  beep('coin');
  showSheet({
    title: '盲盒开出',
    sub: '抽到的东西已经落到你账上，不会白抽',
    body: `<div style="text-align:center;padding:14px 0 4px;font-size:21px;font-weight:800">${got.name}</div>
      <div style="text-align:center;font-size:13px;color:var(--ink2);line-height:1.9">${line}</div>`,
    actions: [{ label: '知道了', primary: true, act: () => { closeSheet(); } }]
  });
}

/* ---------- 渲染 · 家长看板 ---------- */
/* ---------- 同步状态 ---------- */
/* 一小行灰字，只在家长端看板出现。
   以前同步失败是完全静默的，界面分不清「没拉到」和「拉到了但没数据」，只能靠猜。
   有了这行，下次再有异常，看一眼就知道是网络断了还是数据侧的问题。 */
function hhmm(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function syncBadgeHTML() {
  if (S.role !== 'parent' || S.page !== 'p-home' || !S.synced) return '';
  if (S._syncErr) return '<button class="sync-line bad" onclick="App.refresh()">连接不上，点这里重试</button>';
  if (!S._syncAt) return '<div class="sync-line">正在同步…</div>';
  return '<div class="sync-line">已同步 ' + hhmm(S._syncAt) + '</div>';
}
/* 只更新这一行，不重绘整页，免得同步失败时打断正在滚动或操作的家长 */
function refreshSyncBadge() {
  const el = document.getElementById('syncBadge');
  if (el) el.innerHTML = syncBadgeHTML();
}

/* ===========================================================
   家长端 · 往日
   day_tasks 是按 plan_date 存的，往日记录一直都在，
   只是 pull() 固定只拉今天，所以昨天在界面上「消失」了。
   这一页按日期单独查，一天一个请求，往回最多 30 天。
   =========================================================== */
const HIST = { date: null, offset: 1, rows: null, loading: false, err: false };

function histDateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() - (offset || 0));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function histWeekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
}
function histOpen(offset) {
  const off = Math.max(1, Math.min(30, offset));
  HIST.offset = off;
  HIST.date = histDateStr(off);
  HIST.rows = null;
  HIST.err = false;
  HIST.loading = true;
  render();
  histLoad();
}
async function histLoad() {
  const day = HIST.date;
  if (!day) { HIST.loading = false; return; }
  if (!window.Cloud || !Cloud.pullTasksByDate) {
    HIST.loading = false; HIST.err = true; render(); return;
  }
  const rows = await Cloud.pullTasksByDate(day);
  if (HIST.date !== day) return;          // 已经翻到别的日期，这次结果作废
  HIST.loading = false;
  if (rows === null) { HIST.err = true; HIST.rows = null; }
  else { HIST.err = false; HIST.rows = rows; }
  render();
}
function histLocal(day) {
  return (S.history || []).find(h => h && h.date === day) || null;
}
async function showHistEvidence(path) {
  if (!path) return;
  const url = await Cloud.evidenceUrl(path, 600);
  if (!url) { toast('这个文件已经过期或被清理了'); return; }
  window.open(url, '_blank');
}

function renderParentHistory() {
  if (!HIST.date) {
    HIST.date = histDateStr(HIST.offset);
    setTimeout(histLoad, 0);
  }

  const day = HIST.date;
  const local = histLocal(day);
  let rows = (HIST.rows || []).filter(r => r.task_kind !== 'break' && r.task_kind !== 'buffer');
  let fromLocal = false;

  /* 云端拉不到（离线、没登录）或那一天云端本来就是空的时候，
     回退到本机快照 —— 家长昨天在这台设备上看过，就不该一片空白。 */
  if (!rows.length && !HIST.loading && local && local.tasks) {
    const keys = Object.keys(local.tasks);
    const localRows = keys.map(k => ({
      task_id: k,
      task_title: local.tasks[k].title,
      task_kind: local.tasks[k].kind,
      status: local.tasks[k].status,
      evidence_type: local.tasks[k].evidence
    })).filter(r => r.task_kind !== 'break' && r.task_kind !== 'buffer');
    if (localRows.length) { rows = localRows; fromLocal = true; }
  }

  const done = rows.filter(r => r.status === 'done').length;
  const back = rows.filter(r => r.status === 'rework').length;
  const pct = rows.length ? Math.round((done / rows.length) * 100) : 0;
  const canNewer = HIST.offset > 1;
  const canOlder = HIST.offset < 30;

  let body = '';
  if (HIST.loading) {
    body = '<div class="empty">正在拉这一天的记录…</div>';
  } else if (HIST.err) {
    body = `<div class="empty">
      没拉到这一天的记录，可能是网络或登录状态的问题。<br>
      <button class="mini-btn" onclick="histOpen(${HIST.offset})">再试一次</button>
    </div>`;
  } else if (!rows.length) {
    body = '<div class="empty">这一天没有可看的记录。往前翻几天试试。</div>';
  } else {
    body = `<div class="p-card">
      ${rows.map(r => {
        const chip = r.status === 'done' ? '<span class="chip ok">已完成</span>'
          : r.status === 'rework' ? '<span class="chip bad">已退回</span>'
          : r.status === 'timeout' ? '<span class="chip wait">超时未完成</span>'
          : '<span class="chip wait">未完成</span>';
        const ev = r.evidence_path
          ? `<button class="mini-btn" onclick="showHistEvidence('${r.evidence_path}')">${r.evidence_type === 'voice' ? '听录音' : '看照片'}</button>`
          : (r.evidence_type ? `<span class="ps">${{ photo: '已拍照', voice: '已录音', tell: '当面口述' }[r.evidence_type] || ''}</span>` : '');
        return `<div class="p-row">
          <span class="pn">${r.task_title || r.task_id || '未命名'}</span>
          <span class="ps">${ev}</span>
          ${chip}
        </div>`;
      }).join('')}
    </div>`;
  }

  /* 练习成绩和周六清单只存在本地快照里 —— 云端没存这两项。
     有就附上，没有不假装有。 */
  const prac = local && local.practice && local.practice.total
    ? `<div class="sec">
        <div class="sec-h"><h2>课外练习</h2><span class="hint">来自本机记录</span></div>
        <div class="p-card">
          <div class="p-row">
            <span class="pn">三科共 ${local.practice.total} 题</span>
            <span class="ps">答对 ${local.practice.right} 题</span>
            <span class="chip ok">${Math.round((local.practice.right / local.practice.total) * 100)} 分</span>
          </div>
        </div>
      </div>`
    : '';

  return `
  <div class="balance hist-head">
    <div class="main">
      <div class="cap">${day} · ${histWeekday(day)}${HIST.offset === 1 ? ' · 昨天' : ''}</div>
      <div class="num">${done}<small>/${rows.length || 0} 项</small></div>
      <div class="sub">${HIST.loading ? '正在查…'
        : HIST.err ? '没拉到记录'
        : !rows.length ? '这一天没有任务记录'
        : back ? `其中 ${back} 项被退回，${rows.length - done - back} 项没交`
        : done === rows.length ? '全部完成' : `${rows.length - done} 项没交`}</div>
    </div>
    <div class="side">
      <div>完成率</div>
      <div class="hist-pct">${pct}<small>%</small></div>
    </div>
  </div>
  <div class="hist-bar"><i style="width:${pct}%"></i></div>

  <div class="hist-nav">
    <button class="btn ghost" onclick="histOpen(${HIST.offset + 1})" ${canOlder ? '' : 'disabled'}>← 前一天</button>
    <span class="hist-pos">往回 ${HIST.offset} 天</span>
    <button class="btn ghost" onclick="histOpen(${HIST.offset - 1})" ${canNewer ? '' : 'disabled'}>后一天 →</button>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>那天做了什么</h2><span class="hint">${rows.length ? (fromLocal ? '来自本机记录' : '按时间轴顺序') : ''}</span></div>
    ${body}
  </div>
  ${prac}
  ${local && local.satPlan ? '<div id="histSat">' + satSummaryHTML(day) + '</div>' : ''}`;
}

function renderParentHome() {
  const rows = SCHEDULE.filter(s => s.kind !== 'break');
  const doneN = rows.filter(s => S.tasks[s.id].status === 'done').length;
  const b = freeBalance();
  return `
  <div class="balance ${b === 0 ? 'zero' : b < 20 ? 'low' : ''}">
    <div class="main">
      <div class="cap">今日进度</div>
      <div class="num">${doneN}<small>/${rows.length} 项</small></div>
      <div class="sub">预计 ${fmt(projectedFinish())} 收工 · 自由时间余额 ${b} 分钟</div>
    </div>
    <div class="side">
      <div>今日积分 <b>${S.earnedToday}</b></div>
      <div>连续 <b>${S.streak}</b> 天</div>
    </div>
  </div>
  <div id="syncBadge">${syncBadgeHTML()}</div>

  <div class="sec">
    <div class="sec-h"><h2>今日明细</h2><span class="hint">只在 20:30 未完成时推一次，其余零打扰</span></div>
    <div class="p-card">
      ${rows.map(s => {
        const t = S.tasks[s.id];
        const chip = t.status === 'done' ? '<span class="chip ok">已完成</span>'
          : t.status === 'rework' ? '<span class="chip bad">已退回</span>'
          : '<span class="chip wait">未完成</span>';
        const ev = t.evidencePath
          ? `<button class="mini-btn" onclick="showEvidence('${s.id}')">${t.evidence === 'voice' ? '听录音' : '看照片'}</button>`
          : (t.evidence ? ({ photo: '已拍照', voice: '已录音', tell: '当面口述', none: '' })[t.evidence] || '' : '');
        return `<div class="p-row">
          <span class="pn">${s.title}</span>
          <span class="ps">${ev}</span>
          ${chip}
        </div>`;
      }).join('')}
    </div>
  </div>

  ${isSaturday() ? satSummaryHTML(null) : ''}

  <div class="sec">
    <div class="sec-h"><h2>往日记录</h2><span class="hint">昨天做得怎么样</span></div>
    <div class="p-card">
      <div class="p-row">
        <span class="pn">看昨天的完成情况</span>
        <span class="ps">可往回翻 30 天</span>
        <button class="mini-btn" onclick="go('p-history')">打开</button>
      </div>
    </div>
  </div>

  ${petParentCardHTML()}

  <div class="sec">
    <div class="sec-h"><h2>待兑现</h2><span class="hint">孩子已经扣过币，欠着的</span></div>
    ${ordersCardHTML('parent')}
  </div>

  ${handledCardHTML()}

  <div class="sec">
    <div class="sec-h"><h2>待批申请</h2></div>
    <div class="p-card">
      ${S.pending.length ? S.pending.map((p, i) => `
        <div class="p-row">
          <span class="pn">${p.name}</span>
          <span class="ps">${p.price} 币</span>
          <button class="mini-btn ok" onclick="approve(${i})">批准</button>
          <button class="mini-btn" onclick="reject(${i})">驳回</button>
        </div>`).join('')
        : '<div class="empty">暂无待批申请</div>'}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>今日要说的一句话</h2></div>
    <div class="p-card" style="background:var(--brand-soft);border-color:#DDE2FD">
      <div style="font-size:14.5px;line-height:2;color:#2A3566">
        “这一项我看见你写得很赶，是时间不够，还是不会？”<br>
        <span style="font-size:12.5px;color:#5A6BA8">—— 把归因引向能力或时间，不引向态度。</span>
      </div>
    </div>
  </div>`;
}
function approve(i) {
  const p = S.pending[i];
  if (S.coins < p.price) { toast('余额不足，无法批准'); return; }
  S.coins -= p.price;
  S.owned.push(p.id);
  S.pending.splice(i, 1);
  /* 批准只是「同意换」，不等于已经给了。照样落一张待兑现单。 */
  const item = SHOP.find(x => x.id === p.id) || { id: p.id, name: p.name, price: p.price, note: '' };
  const o = newOrder(item);
  pushOrderCloud(o);
  save(); render();
  toast('已批准：' + p.name + ' · 已进待兑现');
}
function reject(i) {
  S.pending.splice(i, 1);
  save(); render();
  toast('已驳回，孩子端会看到原因');
}

/* ---------- 渲染 · 家长返工 ---------- */
function renderParentReview() {
  const rows = SCHEDULE.filter(s => s.kind !== 'break');
  return `
  <div class="sec" style="margin-top:0">
    <div class="sec-h"><h2>返工与抽查</h2><span class="hint">每天随机抽 1 项深查，其余只验成果物在不在</span></div>
    <div class="p-card">
      ${rows.map(s => {
        const t = S.tasks[s.id];
        return `<div class="p-row">
          <span class="pn">${s.title}</span>
          <span class="ps">${t.evidencePath
            ? `<button class="mini-btn" onclick="showEvidence('${s.id}')">${t.evidence === 'voice' ? '听录音' : '看照片'}</button>`
            : (t.evidence === 'photo' ? '已拍照' : t.evidence === 'voice' ? '已录音' : t.evidence === 'tell' ? '当面口述' : '')}</span>
          ${t.status === 'done'
            ? `<button class="mini-btn danger" onclick="reworkTask('${s.id}')">退回</button>`
            : t.status === 'rework'
              ? `<button class="mini-btn ok" onclick="passTask('${s.id}')">通过</button>`
              : t.status === 'timeout'
                ? '<span class="chip bad">超时未完</span>'
                : '<span class="chip wait">未交</span>'}
        </div>`;
      }).join('')}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>退回时说什么</h2></div>
    <div class="p-card" style="font-size:13.5px;line-height:2;color:var(--ink2)">
      ❌ 不说：“你又糊弄”“这么潦草重写”<br>
      ✅ 说：“这一项我看见写得很赶，是时间不够，还是不会？”<br><br>
      <span style="color:var(--ink3)">研究显示自我批评会增加任务厌恶，自我宽恕反而降低后续拖延。</span>
    </div>
  </div>`;
}

/* ---------- 渲染 · 家长资料库 ---------- */
function renderParentBooks() {
  return `
  <div class="sec" style="margin-top:0">
    <div class="sec-h"><h2>练习册资料库</h2><span class="hint">录进来，系统每天派 1 页</span></div>
    ${S.books.map((b, i) => {
      const pct = Math.round(b.done / b.total * 100);
      return `<div class="book">
        <div class="bh">
          <span class="bname">${b.name}</span>
          <span class="bsub">${b.subject}</span>
          <span class="bnum">${b.done}/${b.total}</span>
        </div>
        <div class="bar"><i style="width:${pct}%;background:${b.color}"></i></div>
        <div style="display:flex;gap:8px;margin-top:11px">
          <button class="mini-btn" onclick="bookStep(${i},1)">+1 页</button>
          <button class="mini-btn" onclick="bookStep(${i},-1)">-1 页</button>
          <button class="mini-btn danger" style="margin-left:auto" onclick="bookDel(${i})">移除</button>
        </div>
      </div>`;
    }).join('')}
    <button class="btn" style="width:100%;margin-top:6px" onclick="bookAdd()">+ 录入一本练习册</button>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>今天的派单</h2></div>
    <div class="p-card">
      <div style="font-size:14px;line-height:2">
        系统从进度最落后的一本里，派 <b>1 页</b>。<br>
        <span style="color:var(--ink3);font-size:12.5px">当前派单：《${nextBook().name}》第 ${nextBook().done + 1} 页</span>
      </div>
    </div>
  </div>`;
}
function nextBook() {
  const sorted = [...S.books].sort((a, b) => (a.done / a.total) - (b.done / b.total));
  return sorted[0] || { name: '—', done: 0 };
}
function bookStep(i, d) {
  S.books[i].done = Math.max(0, Math.min(S.books[i].total, S.books[i].done + d));
  save(); render();
}
function bookDel(i) {
  if (confirm('确定移除《' + S.books[i].name + '》？')) { S.books.splice(i, 1); save(); render(); }
}
function bookAdd() {
  showSheet({
    title: '录入练习册', sub: '录进来，之后就不用你记了',
    body: `<div style="display:grid;gap:10px">
      <input id="bn" placeholder="书名，如：口算天天练" style="padding:13px;border:1.5px solid #E7EAF1;border-radius:12px;font-size:14.5px;font-family:inherit">
      <input id="bs" placeholder="科目，如：数学" style="padding:13px;border:1.5px solid #E7EAF1;border-radius:12px;font-size:14.5px;font-family:inherit">
      <input id="bt" placeholder="总页数，如：120" type="number" style="padding:13px;border:1.5px solid #E7EAF1;border-radius:12px;font-size:14.5px;font-family:inherit">
    </div>`,
    actions: [
      { label: '取消', ghost: true, act: closeSheet },
      { label: '录入', primary: true, act: () => {
          const n = $('#bn').value.trim(), s = $('#bs').value.trim(), t = parseInt($('#bt').value);
          if (!n || !t) { toast('书名和页数要填'); return; }
          S.books.push({ id: 'b' + Date.now(), name: n, subject: s || '综合', total: t, done: 0, color: '#4F63E0' });
          save(); closeSheet(); render(); toast('已录入');
        } }
    ]
  });
}

/* ---------- 主渲染 ----------
   壳只建一次：顶栏 / 滚动区 / 底栏三段常驻，之后只换内容。
   切页不重建整页，滚动位置不丢，iOS 上也不闪。 */
function buildShell() {
  const app = $('#app');
  if (app.dataset.shell === '1') return;
  app.innerHTML =
    '<header class="shell-top" id="shellTop"></header>' +
    '<div class="shell-scroll" id="shellScroll"><div class="app" id="viewInner"></div></div>' +
    '<nav class="tabbar" id="shellTab"></nav>';
  app.dataset.shell = '1';
}

function render() {
  ensureDayProfile();

  /* 宠物每天结算一次。跨天打开就能看到它饿成什么样，不用等孩子点按钮。
     只让孩子端算 —— 家长端拿的是快照，写回去会被孩子端覆盖。 */
  if (S.role === 'child' && S.pet && !S.pet.dead) {
    /* 先存住引用：结算里宠物可能死掉并把 S.pet 置空，之后不能再用 S.pet 取字段 */
    const p = S.pet;
    const before = { food: p.food, n: p.neglect, d: p.days };
    if (petTick() && (before.food !== p.food || before.n !== p.neglect || before.d !== p.days)) {
      save();
    }
  }

  buildShell();
  const top = $('#shellTop'), view = $('#viewInner'), tab = $('#shellTab');
  let html = '';

  if (S.role === 'child') {
    if (S.page === 'practice') {
      top.innerHTML = renderTop();
      view.innerHTML = renderPractice();
      view.classList.remove('timer-host');
      tab.style.display = 'none';       // 答题时不留底栏，减少跳出去的诱惑
      return;
    }
    if (S.page === 'timer') {
      top.innerHTML = renderTop();
      view.innerHTML = renderTimer();
      view.classList.add('timer-host');
      tab.style.display = 'none';
      paintWake();               // 计时页重建后把保活状态和秒数补上
      /* 也要补一次 paintTimer：没启动计时直接进计时页时，
         分钟数由 renderTimer 算，但进度环和秒位只有 paintTimer 会画。 */
      const _tc = SCHEDULE.find(s => s.id === S.timerTask);
      if (_tc) paintTimer(_tc);
      return;
    }
    view.classList.remove('timer-host');
    tab.style.display = '';
    if (S.page === 'home') html = isSaturday() ? renderSaturday() : renderHome();
    else if (S.page === 'growth') html = renderGrowth();
    else if (S.page === 'pet') html = renderPet();
    else if (S.page === 'shop') html = renderShop();
    top.innerHTML = renderTop();
    view.innerHTML = html;
    tab.innerHTML = renderTabbar();
    return;
  }

  // 家长端
  view.classList.remove('timer-host');
  tab.style.display = '';
  if (S.page === 'p-home') html = renderParentHome();
  else if (S.page === 'p-history') html = renderParentHistory();
  else if (S.page === 'p-review') html = renderParentReview();
  else if (S.page === 'p-books') html = renderParentBooks();
  top.innerHTML = renderTop();
  view.innerHTML = html;
  tab.innerHTML = renderPTabbar();
}

/* 真实时间：每分钟自动刷新顶栏和自由时间。计时页自己走秒，不整体重建 */
let _lastTick = -1;
function startClockTick() {
  if (DEMO) return;
  _lastTick = realNow();
  setInterval(() => {
    const m = realNow();
    if (m === _lastTick) return;
    _lastTick = m;

    const clock = $('#topClock');
    if (clock) clock.textContent = fmt(m);

    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (S.page === 'timer' || typing) return;      // 别打断正在填的东西
    render();
  }, 1000);
}

/* ---------- 底栏图标：单色线性 SVG，选中随文字一起变品牌蓝（微信那套做法） ---------- */
const NAVI = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="4.8" width="17.6" height="16" rx="4.2"/><path d="M8 3.1v3.4M16 3.1v3.4M3.5 10.1h17"/><path d="M8.8 14.9l2 2 3.6-3.9"/></svg>',
  grow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 20.2h16.8"/><path d="M6.8 20v-5.6M12 20V9.2M17.2 20v-4.2"/><path d="M5.4 8.9l4.4-3.4 3.4 2.3 5-3.9"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M5.9 7.9h12.2l1.1 11.3a2 2 0 0 1-2 2.2H6.8a2 2 0 0 1-2-2.2L5.9 7.9z"/><path d="M9.1 8V6.5a2.9 2.9 0 0 1 5.8 0V8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 12.1S6 6.2 12 6.2s9.4 5.9 9.4 5.9-3.4 5.9-9.4 5.9-9.4-5.9-9.4-5.9z"/><circle cx="12" cy="12.1" r="2.9"/></svg>',
  board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="3.8" width="7.4" height="7.4" rx="2.2"/><rect x="13.2" y="3.8" width="7.4" height="7.4" rx="2.2"/><rect x="3.4" y="12.8" width="7.4" height="7.4" rx="2.2"/><rect x="13.2" y="12.8" width="7.4" height="7.4" rx="2.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M8.4 4.2H6.6A2.2 2.2 0 0 0 4.4 6.4v13a2.2 2.2 0 0 0 2.2 2.2h10.8a2.2 2.2 0 0 0 2.2-2.2v-13a2.2 2.2 0 0 0-2.2-2.2h-1.8"/><rect x="8.4" y="2.2" width="7.2" height="4" rx="1.6"/><path d="M8.6 13.6l2.3 2.3 4.4-4.6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.4C10.2 4.9 8 4.3 5.6 4.3H4v14.4h1.6c2.4 0 4.6.6 6.4 2.1 1.8-1.5 4-2.1 6.4-2.1H20V4.3h-1.6c-2.4 0-4.6.6-6.4 2.1z"/><path d="M12 6.4v14.4"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="4.8" width="17.6" height="16" rx="4.2"/><path d="M8 3.1v3.4M16 3.1v3.4M3.5 10.1h17"/><path d="M7.8 14.2h2.6M13.6 14.2h2.6M7.8 17.4h2.6"/></svg>',
  pet: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="16.6" rx="3.9" ry="3.3"/><ellipse cx="6.5" cy="11.6" rx="2.15" ry="2.5"/><ellipse cx="9.9" cy="7.4" rx="2.15" ry="2.6"/><ellipse cx="14.4" cy="7.3" rx="2.15" ry="2.6"/><ellipse cx="18" cy="11.2" rx="2.15" ry="2.5"/></svg>'
};

function renderTabbar() {
  const tabs = [
    { id: 'home', i: NAVI.today, n: '今日' },
    { id: 'pet', i: NAVI.pet, n: '宠物' },
    { id: 'growth', i: NAVI.grow, n: '成长' },
    { id: 'shop', i: NAVI.shop, n: '商店' }
  ];
  // 孩子端锁定后，家长入口整个不出现（不是藏起来，是根本没这个 tab）
  if (FORCED_ROLE !== 'child') {
    tabs.push({ id: 'p-home', i: NAVI.eye, n: '家长' });
  }
  return `<div class="tabbar-in" style="grid-template-columns:repeat(${tabs.length},1fr)">
    ${tabs.map(t => `<button class="tab ${S.page === t.id ? 'on' : ''}" onclick="go('${t.id}')">${t.i}<span class="tn">${t.n}</span></button>`).join('')}
  </div>`;
}
function renderPTabbar() {
  const tabs = [
    { id: 'p-home', i: NAVI.board, n: '看板' },
    { id: 'p-history', i: NAVI.cal, n: '往日' },
    { id: 'p-review', i: NAVI.check, n: '返工抽查' },
    { id: 'p-books', i: NAVI.book, n: '资料库' }
  ];
  return `<div class="tabbar-in" style="grid-template-columns:repeat(${tabs.length},1fr)">
    ${tabs.map(t => `<button class="tab ${S.page === t.id ? 'on' : ''}" onclick="go('${t.id}')">${t.i}<span class="tn">${t.n}</span></button>`).join('')}
  </div>`;
}

function go(p) {
  if (p === 'p-home' && S.role === 'child') { S.role = 'parent'; }
  S.page = p;
  save(); render();
  const sc = $('#shellScroll');
  if (sc) sc.scrollTop = 0;
  window.scrollTo(0, 0);
}

/* ---------- 启动 ---------- */
function resetAll() {
  if (!confirm('重置全部演示数据？')) return;
  localStorage.removeItem(KEY);
  S = defaultState();
  render();
}
window.resetAll = resetAll;

/* 拉一次云端并对齐本地画面。失败静默，不打断孩子正在做的事 */
async function syncOnce() {
  if (!S.synced) return false;
  const remote = await Cloud.pull();
  // 记下每次尝试的时间和结果：看门狗要靠它判断该不该补拉，界面也要靠它显示状态
  S._syncTry = Date.now();
  if (!remote) { S._syncErr = true; refreshSyncBadge(); return false; }
  S._syncErr = false;
  S._syncAt = Date.now();
  applyRemote(remote);
  if (S._needPush) { S._needPush = false; queueSync(); }
  render();
  return true;
}

/* ---------- 应用级接口（供登录门调用） ---------- */
const App = {
  /* 登录成功后：拉云端 → 合并 → 渲染 */
  async bootAfterAuth() {
    const remote = await Cloud.pull();
    if (remote && remote.household) {
      applyRemote(remote);
      if (S._needPush) { S._needPush = false; queueSync(); }
    } else {
      // 新账号：把初始数据推上去，并生成家庭码
      S.planDate = Cloud.today();
      if (!S.familyCode) S.familyCode = genFamilyCode();
      S.synced = true;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
      await pushAll();
    }
    AuthUI.hide();
    S.page = S.role === 'child' ? 'home' : 'p-home';
    render();
    // 孩子端：上次有一块没走完就接上。家长端不需要，别干扰看板
    if (S.role === 'child') {
      try { restoreTimer(); } catch (e) {}
    }
  },

  /* 手动刷新（另一端刚记完，这边要看到） */
  async refresh() {
    if (!S.synced) return;
    const ok = await syncOnce();
    toast(ok ? '已同步最新进度' : '同步没成功，检查一下网络');
  },

  /* 自动刷新：两端通用，家长端停留时每 25 秒拉一次 */
  startAutoRefresh() {
    if (App._auto) clearInterval(App._auto);
    App._auto = setInterval(() => {
      if (!S.synced || document.hidden) return;
      if (document.querySelector('.sheet-mask')) return;   // 有弹窗开着就不重绘，别打断操作
      syncOnce();
    }, 25000);

    /* 看门狗：只要页面可见、又超过 70 秒没成功同步过，就无条件补拉。
       iOS 独立模式下定时器会被挂起、事件也可能延迟或直接丢失，
       只靠事件和轮询都会漏，必须留一个「按时间差自愈」的兜底。 */
    if (App._wd) clearInterval(App._wd);
    App._wd = setInterval(() => {
      if (!S.synced || document.hidden) return;
      if (document.querySelector('.sheet-mask')) return;
      if (Date.now() - (S._syncAt || 0) < 70000) return;
      syncOnce();
    }, 15000);

    /* 唤醒入口补齐。手机回到前台可能有四种表现：切后台再切回、
       bfcache 整页恢复、窗口重新获得焦点、网络恢复。iOS 上哪一种会触发并不稳定，
       四个都挂上，再用 1.2 秒去重，避免同一次唤醒连发多次请求。 */
    if (!App._visBound) {
      App._visBound = true;
      let last = 0;
      const wake = () => {
        const now = Date.now();
        if (now - last < 1200) return;
        last = now;
        if (!S.synced || document.hidden) return;
        if (document.querySelector('.sheet-mask')) return;
        syncOnce();
      };
      document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
      window.addEventListener('pageshow', wake);          // bfcache 恢复（整页从冻结里回来）
      window.addEventListener('focus', wake);
      window.addEventListener('online', wake);            // 断网恢复
      document.addEventListener('resume', wake);          // 部分 iOS 版本会发这个
    }

    refreshSyncBadge();
  },

  async logout() {
    if (!confirm('退出登录？孩子端退出后需要重新配一次。')) return;
    await Cloud.signOut();
    try { localStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  },

  async changePassword(oldPass, newPass) {
    return Cloud.changePassword(oldPass, newPass);
  },

  get state() { return S; }
};
window.App = App;

/* ---------- 启动 ---------- */
async function boot() {
  applyDayProfile();                 // 先按今天星期把时间窗定下来，再画
  render();                          // 先画出来，登录门盖在上面
  startClockTick();                  // 真实时间每分钟跟着走
  bindTimerWatch();                  // 回到前台核对终点 + 首次手势解锁音频

  if (!Cloud.init()) {
    // 报错时把关键状态写在屏幕上，出问题截一张图就能定位，不用猜
    const flags = window.__DIAG || [];
    const diag = [
      'SDK=' + (typeof window.WorkBuddyCloud),
      window.__SDK_ERR ? ('错误=' + window.__SDK_ERR) : '',
      flags.length ? ('兼容=' + flags.join('，')) : '',
      '版本=' + (window.APP_VERSION || '?')
    ].filter(Boolean).join(' · ');
    AuthUI.show('云服务没准备好。' + diag);
    return;
  }

  let session = null;
  try { session = await Cloud.getSession(); } catch (e) {}

  if (!session) {
    AuthUI.show();
    return;
  }

  try {
    await App.bootAfterAuth();
    App.startAutoRefresh();
  } catch (e) {
    AuthUI.show('读取数据失败：' + (e && e.message ? e.message : e));
  }
}

boot();
