/* ===========================================================
   学习守护 · 数据层
   原型用的全部静态数据（排程 / 任务 / 商品 / 练习册）
   =========================================================== */

const CFG = {
  bedtime: '21:30',      // 熄灯线，自由时间余额的终点
  lightoutAt: 21 * 60 + 30,
  dayCap: 150,           // 每日积分封顶
};

/* ---------- 作业项类型 ----------
   作业的最小单位是「项」，不是「科目」。
   一项语文作业里可能包含抄写、听写、作文三件事，耗时差三四倍。
   类型决定：单段上限、排在时间轴的哪个位置、用什么方式交凭证。
--------------------------------------------- */
const ITEM_TYPES = {
  think: {
    key: 'think', name: '思考型', short: '想', color: '#8B5CF6', cap: 25,
    desc: '最费脑，排在精力最好的前段',
    hint: '作文、应用题、阅读理解',
    evidence: 'photo'
  },
  mech: {
    key: 'mech', name: '机械型', short: '写', color: '#4F63E0', cap: 20,
    desc: '不用想，疲劳时做损耗最小',
    hint: '抄写、组词、口算',
    evidence: 'photo'
  },
  mem: {
    key: 'mem', name: '记忆型', short: '记', color: '#23A26D', cap: 15,
    desc: '放最后，睡觉时大脑帮你存下来',
    hint: '背诵、听写、朗读',
    evidence: 'voice'
  }
};

const TYPE_ORDER = ['think', 'mech', 'mem'];

/* 科目 */
const SUBJECTS = ['语文', '数学', '英语', '其他'];

/* 时长三档：不让孩子填分钟，她只需要凭感觉点一下 */
const DUR_CHOICES = [
  { key: 'short', label: '一会儿就好', min: 10, note: '抄几个词、几道口算' },
  { key: 'mid',   label: '得要一阵',   min: 20, note: '一张练习页' },
  { key: 'long',  label: '这个费劲',   min: 40, note: '作文、手抄报' }
];

/* 从作业名自动判类型。顺序有意义：思考型关键词最具体，先判。 */
const TYPE_KEYWORDS = {
  think: ['作文', '写话', '日记', '周记', '读后感', '习作', '手抄报', '续写', '改写', '看图写',
          '应用题', '阅读', '理解', '思维', '论述', '小练笔'],
  mem:   ['背诵', '默写', '朗读', '背', '听写', '单词', '古诗', '复述', '口述', '熟读'],
  mech:  ['抄', '组词', '造句', '口算', '计算', '竖式', '填空', '改错', '订正',
          '预习', '复习', '练习', '写', '做', '题']
};

/* 判断顺序固定为 思考 > 记忆 > 机械。
   机械型的关键词最宽泛（「写」一个字就能命中听写、默写），必须放最后判。 */
function guessItemType(name) {
  const s = String(name || '');
  if (!s) return 'mech';
  const order = ['think', 'mem', 'mech'];
  for (const t of order) {
    if (TYPE_KEYWORDS[t].some(k => s.indexOf(k) >= 0)) return t;
  }
  return 'mech';
}

/* ---------- 四格（学习闭环） ---------- */
const GRIDS = [
  { id: 'preview',  name: '预习', short: '预', color: 'blue',
    rule: '读明天内容，标 3 处不懂', evidence: 'voice' },
  { id: 'homework', name: '作业', short: '业', color: 'indigo',
    rule: '按作业项拆，一项一块，每块拍照', evidence: 'photo' },
  { id: 'review',   name: '复习', short: '复', color: 'teal',
    rule: '合上书复述 30 秒', evidence: 'voice' },
  { id: 'practice', name: '练习', short: '练', color: 'orange',
    rule: '系统派单 1 页，计时完成', evidence: 'photo' },
];

/* ---------- 练习册资料库（示例，家长端可编辑） ---------- */
const BOOKS = [
  { id: 'b1', name: '口算天天练',     subject: '数学', total: 120, done: 38, color: '#4F63E0' },
  { id: 'b2', name: '阅读理解训练',   subject: '语文', total: 80,  done: 12, color: '#23A26D' },
  { id: 'b3', name: '英语同步练习',   subject: '英语', total: 96,  done: 0,  color: '#FF8A3D' },
  { id: 'b4', name: '数学思维拓展',   subject: '数学', total: 60,  done: 4,  color: '#8B5CF6' },
];

/* ---------- 兑换商店：9 类 ----------
   后两类不进 SHOP（宠物和宠物用品是独立数据集），
   分类按钮照样由 SHOP_CATS 生成，渲染时按 id 分支。 */
const SHOP_CATS = [
  { id: 'screen',  name: '屏幕时间', icon: '📱' },
  { id: 'autonomy',name: '自主权',   icon: '🎯' },
  { id: 'escape',  name: '逃生舱',   icon: '🪂' },
  { id: 'food',    name: '吃喝',     icon: '🍜' },
  { id: 'outing',  name: '体验出行', icon: '🎡' },
  { id: 'bond',    name: '亲子',     icon: '💛' },
  { id: 'collect', name: '收藏',     icon: '🏅' },
  { id: 'petzone', name: '宠物',     icon: '🐾' },
  { id: 'petitem', name: '宠物用品', icon: '🛁' },
];

const SHOP = [
  /* A · 屏幕时间 8 */
  { id: 's1', cat: 'screen', name: '换一部 20 分钟动画', price: 80,  note: '当天用' },
  { id: 's2', cat: 'screen', name: '当天额外 30 分钟屏幕时间', price: 120, note: '当天用', hot: true },
  { id: 's3', cat: 'screen', name: '睡前听 15 分钟故事音频', price: 160, note: '当晚用' },
  { id: 's4', cat: 'screen', name: '当天额外 60 分钟屏幕时间', price: 200, note: '当天用' },
  { id: 's5', cat: 'screen', name: '周末游戏时长 +1 小时', price: 240, note: '周末用' },
  { id: 's6', cat: 'screen', name: '完整看一部电影', price: 300, note: '周末用' },
  { id: 's7', cat: 'screen', name: '周末游戏时长 +2 小时', price: 400, note: '周末用', big: true },
  { id: 's8', cat: 'screen', name: '去同学家玩 2 小时', price: 500, note: '含往返约 2.5 小时', big: true, approve: true, safety: true },

  /* B · 自主权 7 */
  { id: 'a1', cat: 'autonomy', name: '晚饭吃什么由我定', price: 120,  note: '当天用' },
  { id: 'a2', cat: 'autonomy', name: '明天自己排任务顺序', price: 160,  note: '不用家长审核', hot: true },
  { id: 'a3', cat: 'autonomy', name: '明天自己定每块休息时长', price: 200, note: '5–10 分钟内' },
  { id: 'a4', cat: 'autonomy', name: '周末一天不排学习任务', price: 240, note: '周末用', big: true },
  { id: 'a5', cat: 'autonomy', name: '自己决定周末去哪半天', price: 300, note: '周末用', big: true },
  { id: 'a6', cat: 'autonomy', name: '一次「全家听我安排」两小时', price: 400, note: '周末用', big: true },
  { id: 'a7', cat: 'autonomy', name: '下个月自己定一个学习目标', price: 500, note: '家长不干预', big: true, approve: true },

  /* C · 逃生舱 5 */
  { id: 'e1', cat: 'escape', name: '一次拖延豁免', price: 100,  note: '晚开始 15 分钟不计' },
  { id: 'e2', cat: 'escape', name: '免做一页券', price: 200, note: '练习册任意一页', hot: true },
  { id: 'e3', cat: 'escape', name: '免做一整项', price: 300, note: '作业除外' },
  { id: 'e4', cat: 'escape', name: '「今天状态不好」假条', price: 400, note: '提前 1 小时申请，任务顺延', approve: true },
  { id: 'e5', cat: 'escape', name: '一周免抽查券', price: 600, note: '仅免抽查，不免完成', big: true, approve: true },

  /* D · 吃喝 6 */
  { id: 'f1', cat: 'food', name: '零食自选一份', price: 60,  note: '当天' },
  { id: 'f2', cat: 'food', name: '冰淇淋一个', price: 120,  note: '当天' },
  { id: 'f3', cat: 'food', name: '一杯奶茶', price: 160,  note: '当天', hot: true },
  { id: 'f4', cat: 'food', name: '早餐自己点', price: 200, note: '次日早' },
  { id: 'f5', cat: 'food', name: '点一次想吃的外卖', price: 300, note: '周末' },
  { id: 'f6', cat: 'food', name: '一次想吃的大餐', price: 400, note: '周末', big: true },

  /* E · 体验出行 5 */
  { id: 'o1', cat: 'outing', name: '一次电影院', price: 500, note: '周末', big: true, approve: true },
  { id: 'o2', cat: 'outing', name: '游乐场 / 电玩城', price: 600, note: '周末', big: true, approve: true },
  { id: 'o3', cat: 'outing', name: '书店自由购（限 50 元）', price: 700, note: '周末', big: true, approve: true },
  { id: 'o4', cat: 'outing', name: '动物园 / 科技馆', price: 800, note: '周末', big: true, approve: true },
  { id: 'o5', cat: 'outing', name: '半天短途玩', price: 1000, note: '需提前计划', big: true, approve: true },

  /* F · 亲子 4 */
  { id: 'b1', cat: 'bond', name: '全家看我选的电影', price: 200, note: '当晚' },
  { id: 'b2', cat: 'bond', name: '爸爸陪打一局游戏', price: 300, note: '当晚' },
  { id: 'b3', cat: 'bond', name: '一次亲子夜聊（我定话题）', price: 400, note: '当晚', approve: true },
  { id: 'b4', cat: 'bond', name: '和爸妈单独出去吃早饭', price: 500, note: '周末', big: true },

  /* G · 收藏与盲盒 3 */
  { id: 'c1', cat: 'collect', name: '盲盒抽一次', price: 100, note: '必中，抽到什么当场进待兑现', lottery: true, hot: true },
  { id: 'c2', cat: 'collect', name: '计时页皮肤包', price: 160, note: '4 套配色，买完随时换' },
  { id: 'c3', cat: 'collect', name: '专属称号', price: 160, note: '成长页显示，不含任何特权' },
];

/* ---------- 盲盒奖池 ----------
   旧版 4 个奖品里只有「积分回馈」真给了东西，另外两项抽中后连记录都没有，
   等于花 100 币有 75% 概率抽到空气。现在每一项都必须有实物：
   要么生成一张待兑现单，要么直接返币。 */
const LOTTERY_POOL = [
  { id: 'L1', name: '额外 15 分钟屏幕', price: 120, note: '当天用', weight: 3 },
  { id: 'L2', name: '零食自选一份',     price: 60,  note: '当天',   weight: 4 },
  { id: 'L3', name: '免做一页券',       price: 200, note: '练习册任意一页', weight: 2 },
  { id: 'L4', name: '积分回馈 50 币',   coins: 50,                  weight: 3 }
];

/* ---------- 皮肤包 ----------
   纯外观。以前买了只在 owned 里塞个字符串，界面一点不变，属于空壳。 */
const SKINS = [
  { id: 'default', name: '深蓝', ring1: '#6B7CF0', ring2: '#4F63E0' },
  { id: 'mint',    name: '薄荷', ring1: '#5DCAA5', ring2: '#1D9E75' },
  { id: 'sunset',  name: '日落', ring1: '#F0997B', ring2: '#D85A30' },
  { id: 'violet',  name: '紫夜', ring1: '#AFA9EC', ring2: '#534AB7' }
];

/* ---------- 称号 ----------
   原来的「头像框」没有载体——孩子端根本没有头像，买了没地方显示。
   改成称号，挂在成长页。 */
const TITLES = [
  { id: 'steady', name: '稳扎稳打' },
  { id: 'clean',  name: '零返工选手' },
  { id: 'focus',  name: '专注力满格' }
];

/* ---------- 徽章 ---------- */
const BADGES = [
  { id: 'd7',  name: '连续 7 天', icon: '🔥', need: '连续达标 7 天', got: true },
  { id: 'm100',name: '单日专注 100 分钟', icon: '⏱', need: '单日专注满 100 分钟', got: true },
  { id: 'bk1', name: '做完一本', icon: '📗', need: '任意练习册完成 100%', got: false },
  { id: 'nore', name: '整周无返工', icon: '✨', need: '一周零返工', got: false },
  { id: 'early',name: '提前收工', icon: '🌙', need: '连续 3 天 20:40 前收工', got: false },
];

/* ---------- 积分规则 ---------- */
const POINT_RULES = [
  { name: '完成一个专注块', val: 10 },
  { name: '交付一个成果物', val: 10 },
  { name: '四格全清',        val: 20 },
  { name: '全天无返工',      val: 10 },
];

/* ===========================================================
   宠物系统
   三条前提（2026-11-07 君哥定）：
   1) 六档，最高 10000 币是终极目标，不是日常消费
   2) 宠物会死。连续 10 天一次都不管才会死，中途喂一口就重新计时
   3) 用品要丰富，而且耗材和买断四六开 —— 全是耗材就成了无底洞，
      买断的玩具家具才让孩子有「把家建起来」的积累感
   =========================================================== */

const PET_TIERS = [
  { id: 't1', name: '初级', color: '#23A26D', tag: '第一只' },
  { id: 't2', name: '常见', color: '#4F63E0', tag: '主力档' },
  { id: 't3', name: '进阶', color: '#8B5CF6', tag: '有面子' },
  { id: 't4', name: '稀有', color: '#E8894A', tag: '中期目标' },
  { id: 't5', name: '史诗', color: '#D4437A', tag: '长线' },
  { id: 't6', name: '传说', color: '#B8860B', tag: '终极' }
];

/* 每只宠物一个性格，写得具体一点，孩子才觉得「这只是我的」 */
const PETS = [
  { id: 'p1',  tier: 't1', name: '仓鼠',   icon: '🐹', price: 300,   trait: '爱往腮帮子里塞东西，塞满了还想塞' },
  { id: 'p2',  tier: 't1', name: '小鸡',   icon: '🐤', price: 300,   trait: '跟着你走，你停它也停' },
  { id: 'p3',  tier: 't1', name: '金鱼',   icon: '🐟', price: 300,   trait: '记性只有七秒，但每天都认得你' },
  { id: 'p4',  tier: 't2', name: '小猫',   icon: '🐱', price: 600,   trait: '白天不理你，半夜踩你脸上' },
  { id: 'p5',  tier: 't2', name: '小狗',   icon: '🐶', price: 600,   trait: '你一进门它就开始摇尾巴' },
  { id: 'p6',  tier: 't2', name: '兔子',   icon: '🐰', price: 600,   trait: '耳朵一动一动，胆子比耳朵还小' },
  { id: 'p7',  tier: 't3', name: '鹦鹉',   icon: '🦜', price: 1200,  trait: '会学你说话，还会学你叹气' },
  { id: 'p8',  tier: 't3', name: '小狐狸', icon: '🦊', price: 1200,  trait: '机灵，藏东西的地方比你想的多' },
  { id: 'p9',  tier: 't3', name: '小鹿',   icon: '🦌', price: 1200,  trait: '安静，但会一直看着你在做什么' },
  { id: 'p10', tier: 't4', name: '熊猫',   icon: '🐼', price: 2500,  trait: '一天睡十六个小时，剩下八小时在吃' },
  { id: 'p11', tier: 't4', name: '白虎',   icon: '🐯', price: 2500,  trait: '看着凶，其实只是懒得理人' },
  { id: 'p12', tier: 't5', name: '独角兽', icon: '🦄', price: 5000,  trait: '只让心里干净的人靠近' },
  { id: 'p13', tier: 't5', name: '小龙',   icon: '🐲', price: 5000,  trait: '打喷嚏会喷出火星，家里得备水' },
  { id: 'p14', tier: 't6', name: '神龙',   icon: '🐉', price: 10000, trait: '传说级。养到它的人，全校不超过三个' },
  { id: 'p15', tier: 't6', name: '凤凰',   icon: '🦅', price: 10000, trait: '会老，会烧成灰，再从灰里回来' }
];

/* ---------- 宠物用品：7 类 30 件 ----------
   kind = 'use' 是耗材，用掉就没了
   kind = 'own' 是买断，买了永久改变宠物页的画
   effect 里 food / clean / mood 直接加状态，cap 加心情上限 */
const PET_CATS = [
  { id: 'food',    name: '主食',     icon: '🍚' },
  { id: 'clean',   name: '清洁',     icon: '🛁' },
  { id: 'med',     name: '医疗',     icon: '💊' },
  { id: 'toy',     name: '玩具',     icon: '🎾' },
  { id: 'furn',    name: '家具',     icon: '🏠' },
  { id: 'wear',    name: '装扮',     icon: '👑' },
  { id: 'special', name: '特别',     icon: '🎁' }
];

const PET_ITEMS = [
  /* 主食 5 —— 越贵越省心，但日成本不能超过收入三成 */
  { id: 'pf1', cat: 'food', kind: 'use', name: '普通口粮', price: 20,  icon: '🍚', effect: { food: 35 },                    desc: '一天一份，够吃饱' },
  { id: 'pf2', cat: 'food', kind: 'use', name: '优质口粮', price: 50,  icon: '🍱', effect: { food: 60, mood: 10 },           desc: '吃得好，心情也跟着好' },
  { id: 'pf3', cat: 'food', kind: 'use', name: '高级罐头', price: 80,  icon: '🥫', effect: { food: 80, mood: 15 },           desc: '开罐那一下它就跑过来了' },
  { id: 'pf4', cat: 'food', kind: 'use', name: '营养膏',   price: 120, icon: '🧴', effect: { food: 100, mood: 10, clean: -5 },desc: '一次顶三天，但会弄脏毛' },
  { id: 'pf5', cat: 'food', kind: 'use', name: '节日大餐', price: 150, icon: '🍗', effect: { food: 100, mood: 40 },           desc: '生日、过节才舍得买' },

  /* 清洁 5 */
  { id: 'pc1', cat: 'clean', kind: 'use', name: '刷毛',     price: 15,  icon: '🪮', effect: { clean: 20, mood: 5 },  desc: '十五币，随手就能干' },
  { id: 'pc2', cat: 'clean', kind: 'use', name: '洗澡',     price: 25,  icon: '🛁', effect: { clean: 40 },           desc: '该洗了就别拖' },
  { id: 'pc3', cat: 'clean', kind: 'use', name: '洗牙棒',   price: 30,  icon: '🦷', effect: { clean: 25, mood: 5 },  desc: '顺便防口臭' },
  { id: 'pc4', cat: 'clean', kind: 'use', name: '香香喷雾', price: 40,  icon: '💨', effect: { clean: 30, mood: 15 }, desc: '喷完整个屋子都是香的' },
  { id: 'pc5', cat: 'clean', kind: 'use', name: '全套美容', price: 100, icon: '✨', effect: { clean: 100, mood: 25 },desc: '洗完吹干修剪，能干净好几天' },

  /* 医疗 4 —— 濒危只有急诊救得回来 */
  { id: 'pm1', cat: 'med', kind: 'use', name: '小药丸', price: 40,  icon: '💊', effect: { mood: 10, med: 1 }, desc: '治小病，虚弱和生病时用' },
  { id: 'pm2', cat: 'med', kind: 'use', name: '维生素', price: 60,  icon: '🍊', effect: { mood: 10, med: 1 }, desc: '日常保健，少生病' },
  { id: 'pm3', cat: 'med', kind: 'use', name: '体检',   price: 100, icon: '🩺', effect: { mood: 15, med: 1 }, desc: '查一遍，心里踏实' },
  { id: 'pm4', cat: 'med', kind: 'use', name: '急诊',   price: 200, icon: '🚑', effect: { mood: 20, med: 2 }, desc: '只有它能救濒危的命' },

  /* 玩具 5 —— 买断，每次玩都不花钱 */
  { id: 'pt1', cat: 'toy', kind: 'own', name: '小球',     price: 60,  icon: '⚽', effect: { mood: 15 }, desc: '最便宜的快乐' },
  { id: 'pt2', cat: 'toy', kind: 'own', name: '逗猫棒',   price: 90,  icon: '🎣', effect: { mood: 20 }, desc: '能玩很久' },
  { id: 'pt3', cat: 'toy', kind: 'own', name: '飞盘',     price: 120, icon: '🥏', effect: { mood: 25 }, desc: '要带出去跑' },
  { id: 'pt4', cat: 'toy', kind: 'own', name: '拼图玩具', price: 180, icon: '🧩', effect: { mood: 30 }, desc: '它玩它的，你写你的' },
  { id: 'pt5', cat: 'toy', kind: 'own', name: '电动玩具', price: 300, icon: '🤖', effect: { mood: 40 }, desc: '自己会动，最省心' },

  /* 家具 4 —— 买断，抬心情上限 */
  { id: 'ph1', cat: 'furn', kind: 'own', name: '小窝',     price: 150, icon: '🛏', effect: { cap: 10 }, desc: '总算有个自己的地方' },
  { id: 'ph2', cat: 'furn', kind: 'own', name: '秋千',     price: 250, icon: '🪜', effect: { cap: 15 }, desc: '一荡就是一下午' },
  { id: 'ph3', cat: 'furn', kind: 'own', name: '猫爬架',   price: 300, icon: '🗼', effect: { cap: 20 }, desc: '越高越有安全感' },
  { id: 'ph4', cat: 'furn', kind: 'own', name: '豪华别墅', price: 800, icon: '🏰', effect: { cap: 30 }, desc: '整间屋子都是它的' },

  /* 装扮 5 —— 纯好看，不解决任何数值 */
  { id: 'pw1', cat: 'wear', kind: 'own', name: '小帽子', price: 80,  icon: '🎩', effect: {}, desc: '戴上就显得很有学问' },
  { id: 'pw2', cat: 'wear', kind: 'own', name: '围巾',   price: 100, icon: '🧣', effect: {}, desc: '冬天看着暖和' },
  { id: 'pw3', cat: 'wear', kind: 'own', name: '眼镜',   price: 120, icon: '🕶', effect: {}, desc: '有点酷' },
  { id: 'pw4', cat: 'wear', kind: 'own', name: '项圈',   price: 150, icon: '📿', effect: {}, desc: '写上名字就是你的了' },
  { id: 'pw5', cat: 'wear', kind: 'own', name: '皇冠',   price: 500, icon: '👑', effect: {}, desc: '五百币的排面' },

  /* 特别 3 */
  { id: 'ps1', cat: 'special', kind: 'use', name: '拍照留念', price: 50,  icon: '📷', effect: { mood: 20 }, desc: '存进它的相册' },
  { id: 'ps2', cat: 'special', kind: 'use', name: '生日蛋糕', price: 200, icon: '🎂', effect: { mood: 100 }, desc: '一年一次，心情拉满' },
  { id: 'ps3', cat: 'special', kind: 'use', name: '宠物蛋',   price: 300, icon: '🥚', effect: {}, desc: '宠物走了以后，重新开始的那一颗' }
];

/* 死亡链路：连续不管的天数 → 阶段。
   喂一次（饱食回到 30 以上）或吃对症的药，计数清零重来。 */
const PET_PHASES = [
  { id: 'ok',     name: '精神', weak: 0,  desc: '活蹦乱跳' },
  { id: 'weak',   name: '虚弱', at: 1,    desc: '发蔫，动作变慢' },
  { id: 'sick',   name: '生病', at: 4,    desc: '趴着不动，吃不下' },
  { id: 'danger', name: '濒危', at: 7,    desc: '只剩一口气，只有急诊救得回来' },
  { id: 'dead',   name: '已离开', at: 11, desc: '它走了' }
];

/* 成长阶段：靠「照料到位的天数」，不靠花钱 */
const PET_STAGES = [
  { id: 1, name: '幼年', at: 0,  icon: '🥚' },
  { id: 2, name: '少年', at: 7,  icon: '🌱' },
  { id: 3, name: '成年', at: 21, icon: '🌳' }
];

/* 每天自然衰减 */
const PET_DECAY = { food: 35, clean: 20, mood: 25 };
