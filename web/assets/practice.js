/* ===========================================================
   学习守护 · 课外练习引擎
   三科随机出题：数学程序生成 / 语文精编题 / 英语词表配对
   同一孩子同一天题目固定（用日期做随机种子），刷新不会换一套。
   =========================================================== */

/* ---------- 随机 ----------
   不用 Math.random：每天要能重算出同一份卷子，
   所以必须用「种子 → 固定序列」的可复现随机。 */
function sgHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function sgRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rgInt = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const rgPick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
function rgShuffle(rnd, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ---------- 数学：程序生成 ----------
   三个难度档，组卷按「易 1 · 中 3 · 难 1」抽取。
   五年级的硬骨头集中在：小数乘除、分数加减、方程、行程与体积应用题，
   所以难题全压在这几类上，不去靠加大数字刷人。
   答案一律设计成整数或有限小数，手机数字键盘就能敲。 */
const mNum = (q, a, hint) => ({
  sub: '数学', mode: 'input', q, a, hint,
  tip: hint || '答案填数字，小数直接写小数点'
});
const mPick = (q, opts, a, hint) => ({
  sub: '数学', mode: 'choice', q, opts, a, hint, tip: hint
});

function gcd(a, b) { return b ? gcd(b, a % b) : Math.abs(a); }

/* 易：热身，建立手感 */
const MATH_EASY = [
  (rnd) => {
    const a = rgInt(rnd, 15, 95) / 10, b = rgInt(rnd, 5, 60) / 10;
    return mNum(`${a} + ${b} = ?`, Math.round((a + b) * 10) / 10, '小数点对齐再相加');
  },
  (rnd) => {
    const v = rgInt(rnd, 15, 98) / 10;
    const p = rgPick(rnd, [
      { from: '米', to: '厘米', k: 100 },
      { from: '千克', to: '克', k: 1000 },
      { from: '升', to: '毫升', k: 1000 },
      { from: '平方米', to: '平方分米', k: 100 }
    ]);
    return mNum(`${v} ${p.from} = ? ${p.to}`, Math.round(v * p.k * 100) / 100, `1 ${p.from} = ${p.k} ${p.to}`);
  },
  (rnd) => {
    const total = rgPick(rnd, [40, 60, 80, 120, 200, 250]);
    const p = rgPick(rnd, [10, 20, 25, 50]);
    return mNum(`${total} 的 ${p}% 是多少？`, Math.round(total * p / 100 * 100) / 100, `把 ${total} 平均分成 100 份，取其中 ${p} 份`);
  }
];

/* 中：本学期主体，占大头 */
const MATH_MID = [
  (rnd) => {
    const a = rgInt(rnd, 11, 99) / 10, b = rgInt(rnd, 11, 49) / 10;
    return mNum(`${a} × ${b} = ?`, Math.round(a * b * 100) / 100, '先按整数相乘，再看两个因数一共几位小数');
  },
  (rnd) => {
    const b = rgInt(rnd, 2, 9) / 10, q = rgInt(rnd, 3, 40);
    const a = Math.round(b * q * 10) / 10;
    return mNum(`${a} ÷ ${b} = ?`, q, '除数是小数，先把它变成整数再除');
  },
  (rnd) => {
    const k = rgPick(rnd, [25, 125, 45, 55]);
    const base = rgPick(rnd, [4, 8, 2, 20]);
    const m = rgInt(rnd, 11, 39) / 10;
    return mNum(`${k / 10} × ${m} × ${base / 10} = ?`,
      Math.round((k * base / 100) * m * 100) / 100, `把 ${k / 10} 和 ${base / 10} 先乘起来凑整`);
  },
  (rnd) => {
    const x = rgInt(rnd, 12, 89) / 10, b = rgInt(rnd, 10, 50) / 10;
    const c = Math.round((x + b) * 10) / 10;
    return mNum(`x + ${b} = ${c}，x = ?`, x, '两边同时减去同一个数，等式仍然成立');
  },
  (rnd) => {
    const base = rgInt(rnd, 78, 94);
    const arr = [-3, -1, 2, 2].map(d => base + d + rgInt(rnd, -1, 1));
    return mNum(`${arr.join('、')} 的平均数是多少？`,
      Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100) / 100, '平均数 = 总和 ÷ 个数');
  },
  (rnd) => {
    const a = rgInt(rnd, 12, 68) / 10, b = rgInt(rnd, 11, 45) / 10;
    return mNum(`长 ${a} 米、宽 ${b} 米的长方形，面积是多少平方米？`,
      Math.round(a * b * 100) / 100, '长方形的面积 = 长 × 宽');
  }
];

/* 难：每份卷子只有一道，考的是方法而不是力气 */
const MATH_HARD = [
  (rnd) => {
    const a = rgInt(rnd, 26, 64) / 10, b = rgInt(rnd, 14, 36) / 10,
      k = rgInt(rnd, 11, 25) / 10, d = rgInt(rnd, 5, 30) / 10;
    return mNum(`(${a} + ${b}) × ${k} - ${d} = ?`,
      Math.round(((a + b) * k - d) * 100) / 100, '先算括号，再算乘，最后算减');
  },
  (rnd) => {
    const v1 = rgInt(rnd, 40, 70), v2 = rgInt(rnd, 30, 60), h = rgInt(rnd, 2, 5);
    return mNum(`两地相距 ${(v1 + v2) * h} 千米，甲车每小时 ${v1} 千米，乙车每小时 ${v2} 千米，两车同时相向开出，几小时相遇？`,
      h, '相遇时间 = 总路程 ÷ 两车速度和');
  },
  (rnd) => {
    const a = rgInt(rnd, 12, 30) / 10, b = rgInt(rnd, 10, 25) / 10, c = rgInt(rnd, 8, 20) / 10;
    return mNum(`长 ${a} 米、宽 ${b} 米、高 ${c} 米的长方体，体积是多少立方米？`,
      Math.round(a * b * c * 1000) / 1000, '体积 = 长 × 宽 × 高');
  },
  (rnd) => {
    const price = rgPick(rnd, [80, 120, 150, 200, 240, 300]);
    const zhe = rgPick(rnd, [8, 7.5, 8.5, 9]);
    return mNum(`一件商品原价 ${price} 元，打 ${zhe} 折，现价多少元？`,
      Math.round(price * zhe / 10 * 100) / 100, `${zhe} 折就是原价 × ${zhe / 10}`);
  },
  (rnd) => {
    const orig = rgPick(rnd, [80, 100, 120, 160, 200, 240]);
    const pct = rgPick(rnd, [10, 20, 25, 50]);
    const total = Math.round(orig * (1 + pct / 100) * 100) / 100;
    return mNum(`某个数增加 ${pct}% 以后变成 ${total}，这个数原来是多少？`,
      orig, `原数 = ${total} ÷ (1 + ${pct}%)`);
  },
  (rnd) => {
    /* 异分母分数加法：考通分。答案有分数形式，只能出选择题 */
    const d1 = rgPick(rnd, [2, 3, 4, 5, 6]);
    const d2 = rgPick(rnd, [3, 4, 6, 8, 12]);
    if (d1 === d2) return null;
    const n1 = rgInt(rnd, 1, d1 - 1), n2 = rgInt(rnd, 1, d2 - 1);
    const num = n1 * d2 + n2 * d1, den = d1 * d2;
    const g = gcd(num, den);
    const rn = num / g, rd = den / g;
    const right = rd === 1 ? String(rn) : `${rn}/${rd}`;
    const opts = [right];
    [
      `${n1 + n2}/${d1 + d2}`,                 // 分母直接相加（最常见错法）
      `${n1 + n2}/${Math.max(d1, d2)}`,        // 只换大分母
      `${rn + 1}/${rd}`                        // 通分后算错分子
    ].forEach(x => {
      if (x !== right && opts.length < 4 && opts.indexOf(x) < 0) opts.push(x);
    });
    let k = 1;
    while (opts.length < 4 && k < 20) {
      const cand = `${rn + k}/${rd}`;
      if (cand !== right && opts.indexOf(cand) < 0) opts.push(cand);
      k++;
    }
    const shuffled = rgShuffle(rnd, opts);
    return mPick(`${n1}/${d1} + ${n2}/${d2} = ?`, shuffled, shuffled.indexOf(right),
      `分母不同要先通分，公分母取 ${d1 * d2}`);
  }
];

/* 组卷配比：首题热身、末题拔高、中间全给主体难度 */
function mathPlan(n) {
  const plan = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) plan.push('easy');
    else if (i === n - 1) plan.push('hard');
    else plan.push('mid');
  }
  return plan;
}

function genMath(rnd, n) {
  const pools = { easy: MATH_EASY, mid: MATH_MID, hard: MATH_HARD };
  const used = {};
  const out = [];
  mathPlan(n).forEach(lv => {
    let guard = 0, item = null;
    while (guard++ < 60) {
      const cand = rgPick(rnd, pools[lv])(rnd);
      if (!cand || used[cand.q]) continue;
      item = cand;
      break;
    }
    // 难题池可能凑不出（比如抽到 d1===d2 返回 null），退回中等题，不空着
    if (!item) {
      let g2 = 0;
      while (g2++ < 60) {
        const cand = rgPick(rnd, MATH_MID)(rnd);
        if (cand && !used[cand.q]) { item = cand; break; }
      }
    }
    if (item) { used[item.q] = 1; out.push(item); }
  });
  return out;
}

/* ---------- 语文：精编题 ----------
   手写而不是程序生成 —— 字音、字形、文言实词这类靠规则造题会出错，
   宁可题库小一点，也不能给孩子一道错题。
   分三档：易 12 / 中 26 / 难 18，组卷按「易 1 · 中 3 · 难 1」抽。
   难题集中在文言文、古诗默写、句式转换、成语辨析 —— 这是五年级真正的分水岭。 */
const cItem = (q, opts, a, tip) => ({ sub: '语文', mode: 'choice', q, opts, a, tip });

const CN_EASY = [
  cItem('下面哪个词没有错别字？', ['迫不急待', '再接再励', '精疲力尽', '一如继往'], 2, '应为迫不及待、再接再厉、一如既往'),
  cItem('下面哪个词没有错别字？', ['专心致志', '语无仑次', '赞不决口', '川流不熄'], 0, '应为语无伦次、赞不绝口、川流不息'),
  cItem('「____ 不拔」应填哪个字？', ['坚', '艰', '间', '监'], 0, '坚韧不拔：意志坚强，不可动摇'),
  cItem('「____ 精会神」应填哪个字？', ['聚', '具', '距', '剧'], 0, '聚精会神：集中精神'),
  cItem('下面哪个词是表示「看」的？', ['聆听', '凝视', '抚摸', '嗅闻'], 1, '凝视：集中注意力看'),
  cItem('「目不转睛」中「睛」指的是？', ['眼睛', '眼球', '瞳孔', '眉毛'], 0, '眼珠不动，形容注意力集中'),
  cItem('「画蛇添足」这个成语告诉我们什么？', ['做事要快', '多此一举反而坏事', '要多想办法', '做事要仔细'], 1, '比喻做了多余的事，反而把事情弄糟'),
  cItem('「刻舟求剑」比喻什么？', ['很会动脑筋', '做事死板不知变通', '坚持不放弃', '善于抓住机会'], 1, '情况已经变了，还照老办法办事'),
  cItem('「尺有所短，寸有所长」说明什么道理？', ['东西越大越好', '各有长处也各有不足', '要精打细算', '量东西要准确'], 1, '比喻各有长短，不能一概而论'),
  cItem('「一个巴掌拍不响」的意思最接近？', ['事情做不成', '矛盾不是单方面造成的', '没有帮手', '声音不够大'], 1, '指纠纷双方都有责任'),
  cItem('「乘」在下面哪个词里读音与其他三个不同？', ['乘车', '乘法', '乘客', '千乘之国'], 3, '千乘之国的「乘」读 shèng，是古代兵车单位'),
  cItem('「差」在哪个词里读 chāi？', ['差别', '出差', '差距', '差错'], 1, '出差、差事读 chāi，其余读 chā')
];

const CN_MID = [
  cItem('「兴高采烈」的反义词是？', ['兴致勃勃', '无精打采', '兴味索然', '眉飞色舞'], 1, '无精打采指没有精神，与兴高采烈相反'),
  cItem('「小心翼翼」的近义词是？', ['粗心大意', '谨小慎微', '漫不经心', '大手大脚'], 1, '谨小慎微：说话做事十分小心谨慎'),
  cItem('「一鼓作气」的近义词是？', ['一蹶不振', '趁热打铁', '半途而废', '一败涂地'], 1, '两者都指趁劲头足时赶紧做'),
  cItem('「雪中送炭」的反义词是？', ['锦上添花', '落井下石', '雪上加霜', '火上浇油'], 0, '雪中送炭是急需时帮助，锦上添花是好事上再加好'),
  cItem('「夸夸其谈」形容什么？', ['说话很风趣', '说话浮夸不切实际', '说话很有条理', '说话声音很大'], 1, '贬义词，指空谈不实干'),
  cItem('「栩栩如生」一般用来形容？', ['文章写得好', '形象非常逼真', '声音好听', '图画颜色鲜艳'], 1, '栩栩：生动活泼的样子'),
  cItem('「迫不及待」中「及」的意思是？', ['来得及', '等到', '及格', '涉及'], 1, '急迫得不能再等待'),
  cItem('「不耻下问」的意思是什么？', ['不好意思问问题', '向学问不如自己的人请教也不觉得丢脸', '不愿意问别人', '只问比自己强的人'], 1, '出自《论语》，强调虚心求教'),
  cItem('「锲而不舍」中「锲」的意思是？', ['放弃', '雕刻', '坚持', '停止'], 1, '锲：雕刻。比喻有恒心有毅力'),
  cItem('「他学习很刻苦，成绩一直很好」中的「刻苦」可以换成？', ['辛苦', '勤奋', '痛苦', '劳累'], 1, '勤奋最贴合「刻苦」的本义'),
  cItem('「他跑得像一阵风」用了什么修辞手法？', ['拟人', '比喻', '夸张', '排比'], 1, '把人比作风，是比喻'),
  cItem('「小草偷偷地从土里钻出来」用了什么修辞手法？', ['比喻', '拟人', '反问', '设问'], 1, '「偷偷地」「钻」把小草当作人来写'),
  cItem('「难道我们不应该珍惜时间吗？」这句是？', ['疑问句', '反问句', '设问句', '感叹句'], 1, '用疑问的形式表达肯定的意思，是反问句'),
  cItem('关联词填空：「____ 明天下雨，我们 ____ 照常去。」', ['因为…所以…', '即使…也…', '只要…就…', '不但…而且…'], 1, '前后是让步关系，用「即使…也…」'),
  cItem('关联词填空：「____ 多读多写，作文 ____ 会进步。」', ['只有…才…', '虽然…但是…', '宁可…也不…', '无论…都…'], 0, '必要条件关系，用「只有…才…」'),
  cItem('下面哪个句子没有语病？', ['我们要养成讲卫生。', '他的写作水平明显改进了。', '我们要养成讲卫生的好习惯。', '通过这次活动，使我明白了道理。'], 2, 'A 缺宾语，B 搭配不当，D 缺主语'),
  cItem('下面哪个句子没有语病？', ['我估计他今天一定会来。', '他今天一定会来。', '我断定他今天可能会来。', '他今天也许会来一定。'], 1, '「估计」「断定」与「一定」「可能」前后矛盾'),
  cItem('「月落乌啼霜满天，江枫渔火对愁眠」出自哪首诗？', ['《静夜思》', '《枫桥夜泊》', '《山行》', '《泊船瓜洲》'], 1, '张继《枫桥夜泊》'),
  cItem('「不要人夸颜色好，只留清气满乾坤」写的是什么花？', ['菊花', '梅花', '荷花', '兰花'], 1, '王冕《墨梅》，写梅花'),
  cItem('「千磨万击还坚劲，任尔东西南北风」写的是什么？', ['竹子', '松树', '梅花', '柳树'], 0, '郑燮《竹石》，借竹子写坚韧'),
  cItem('「读书破万卷，下笔如有神」是谁说的？', ['李白', '杜甫', '白居易', '苏轼'], 1, '出自杜甫《奉赠韦左丞丈二十二韵》'),
  cItem('「春蚕到死丝方尽，蜡炬成灰泪始干」是谁的诗？', ['李商隐', '杜牧', '王维', '孟浩然'], 0, '李商隐《无题》'),
  cItem('「莫愁前路无知己，天下谁人不识君」表达的情感是？', ['悲伤绝望', '豪迈的送别之情', '思念家乡', '埋怨朋友'], 1, '高适《别董大》，送别却不悲切'),
  cItem('「海上生明月，天涯共此时」的作者是？', ['张九龄', '张继', '王之涣', '王昌龄'], 0, '张九龄《望月怀远》'),
  cItem('「胸有成竹」最初形容谁画竹？', ['吴道子', '文与可', '郑板桥', '唐伯虎'], 1, '出自苏轼《文与可画筼筜谷偃竹记》'),
  cItem('「欲穷千里目，更上一层楼」的前一句是？', ['白日依山尽', '黄河入海流', '处处闻啼鸟', '大漠孤烟直'], 0, '王之涣《登鹳雀楼》：白日依山尽，黄河入海流')
];

/* 难：文言、默写、句式转换、成语辨析、标点 —— 五年级真正的分水岭 */
const CN_HARD = [
  cItem('《杨氏之子》中「甚聪惠」的「惠」通哪个字？', ['慧', '会', '绘', '彙'], 0, '惠通「慧」，聪明之意'),
  cItem('《杨氏之子》中「未闻孔雀是夫子家禽」的「闻」是什么意思？', ['闻到', '听说', '新闻', '闻名'], 1, '闻：听说。句意为没听说过孔雀是您家的鸟'),
  cItem('《自相矛盾》中「誉之曰」的「誉」是什么意思？', ['荣誉', '夸耀', '称赞别人', '名誉'], 1, '誉：夸耀，指卖矛的人自夸'),
  cItem('《自相矛盾》中「其人弗能应也」的「弗」是什么意思？', ['不', '突然', '于是', '竟然'], 0, '弗：不。弗能应即不能回答'),
  cItem('「守株待兔」中「因释其耒而守株」的「耒」指的是？', ['农具', '树桩', '田地', '兔子'], 0, '耒是古代翻土的农具，说明他放下了农活'),
  cItem('「剑外忽传收蓟北」的下一句是？', ['初闻涕泪满衣裳', '却看妻子愁何在', '漫卷诗书喜欲狂', '白日放歌须纵酒'], 0, '杜甫《闻官军收河南河北》'),
  cItem('「却看妻子愁何在」的下一句是？', ['初闻涕泪满衣裳', '漫卷诗书喜欲狂', '青春作伴好还乡', '南望王师又一年'], 1, '杜甫《闻官军收河南河北》'),
  cItem('「三万里河东入海」的下一句是？', ['五千仞岳上摩天', '遗民泪尽胡尘里', '南望王师又一年', '铁马冰河入梦来'], 0, '陆游《秋夜将晓出篱门迎凉有感》'),
  cItem('「遗民泪尽胡尘里」的下一句是？', ['南望王师又一年', '五千仞岳上摩天', '三万里河东入海', '王师北定中原日'], 0, '陆游《秋夜将晓出篱门迎凉有感》'),
  cItem('「这比山还高比海还深的情谊，我们怎么会忘记？」改成陈述句，正确的是？', ['这比山还高比海还深的情谊，我们不会忘记。', '这比山还高比海还深的情谊，我们会忘记吗？', '这比山还高比海还深的情谊，我们怎么忘记。', '这情谊我们忘记。'], 0, '反问改陈述：去掉反问语气，否定词保留一次'),
  cItem('「我把窗户擦干净了」改成被字句，正确的是？', ['窗户被我擦干净了。', '我被窗户擦干净了。', '窗户把擦干净了。', '窗户擦干净被我。'], 0, '被字句：受动者 + 被 + 施动者 + 动作'),
  cItem('「他穿着一件红色的羽绒服」缩句，最恰当的是？', ['他穿着羽绒服。', '他穿羽绒服。', '他穿着红色羽绒服。', '他穿一件。'], 0, '缩句保留主干，去掉数量、颜色等修饰'),
  cItem('「这部小说情节跌宕起伏，抑扬顿挫，很吸引人」这句话的问题是？', ['没有语病', '「抑扬顿挫」用错了，它形容声音', '「跌宕起伏」用错', '缺少主语'], 1, '抑扬顿挫只形容声音高低起伏，不能形容情节'),
  cItem('下面哪个句子中「骄傲」是贬义？', ['我为祖国感到骄傲。', '他考了满分，很骄傲。', '取得一点成绩就骄傲，会退步。', '这是我们的骄傲。'], 2, '「骄傲」表示自满时是贬义，表示自豪时是褒义'),
  cItem('「他说话的声音越来越大，情绪也越来越激动」用了什么修辞？', ['比喻', '排比', '夸张', '对比'], 1, '两个结构相似的短语连用，是排比'),
  cItem('「太阳一出来，地上的霜就化了」中「一……就……」表示？', ['条件关系', '因果关系', '转折关系', '并列关系'], 0, '前一个动作是后一个动作的条件'),
  cItem('下列句子标点使用正确的是？', ['他问我："你去哪儿？"', '他问我："你去哪儿"。', '他问我"你去哪儿？"', '他问我：你去哪儿？'], 0, '完整引用时，问号在引号内，句末不再加句号'),
  cItem('「与其临渊羡鱼，不如退而结网」的意思最接近？', ['站在河边想鱼', '光想没用，不如动手去做', '要保护环境', '做事要选时机'], 1, '比喻只有愿望而不行动，不如实际去做')
];

/* 组卷：跟数学同一套配比 */
function cnPlan(n) {
  const plan = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) plan.push('easy');
    else if (i === n - 1) plan.push('hard');
    else plan.push('mid');
  }
  return plan;
}

function genChinese(rnd, n) {
  const pools = { easy: CN_EASY, mid: CN_MID, hard: CN_HARD };
  const picked = [];
  const seen = {};
  cnPlan(n).forEach(lv => {
    const pool = rgShuffle(rnd, pools[lv]);
    for (const it of pool) {
      if (seen[it.q]) continue;
      seen[it.q] = 1;
      picked.push(it);
      return;
    }
  });
  // 选项打乱，否则答案总在原位
  return picked.map(it => {
    const order = rgShuffle(rnd, it.opts.map((o, i) => i));
    return {
      sub: '语文', mode: 'choice', q: it.q,
      opts: order.map(i => it.opts[i]),
      a: order.indexOf(it.a),
      tip: it.tip
    };
  });
}

/* ---------- 英语：词表 + 规则生成 ----------
   易：常见词义互译；中：整表词义 + 介词搭配；难：不规则变化和时态。
   词表是五年级高频词，干扰项从同一批词里抽，不能靠「看着不像」排除。 */
const EN_WORDS = [
  ['library', '图书馆'], ['breakfast', '早餐'], ['weekend', '周末'], ['holiday', '假日'],
  ['mountain', '山'], ['forest', '森林'], ['village', '村庄'], ['bridge', '桥'],
  ['weather', '天气'], ['season', '季节'], ['autumn', '秋天'], ['winter', '冬天'],
  ['favourite', '最喜爱的'], ['delicious', '美味的'], ['exercise', '锻炼'], ['homework', '家庭作业'],
  ['dinner', '晚餐'], ['afternoon', '下午'], ['evening', '傍晚'], ['teacher', '老师'],
  ['doctor', '医生'], ['farmer', '农民'], ['policeman', '警察'], ['artist', '艺术家'],
  ['musician', '音乐家'], ['dancer', '舞蹈者'], ['writer', '作家'], ['singer', '歌手'],
  ['engineer', '工程师'], ['nurse', '护士'], ['hospital', '医院'], ['restaurant', '餐馆'],
  ['supermarket', '超市'], ['cinema', '电影院'], ['museum', '博物馆'], ['playground', '操场'],
  ['classroom', '教室'], ['blackboard', '黑板'], ['dictionary', '字典'], ['newspaper', '报纸'],
  ['vegetable', '蔬菜'], ['tomato', '西红柿'], ['potato', '土豆'], ['chicken', '鸡肉'],
  ['banana', '香蕉'], ['orange', '橙子'], ['watermelon', '西瓜'], ['grape', '葡萄'],
  ['happy', '高兴的'], ['angry', '生气的'], ['tired', '疲倦的'], ['hungry', '饿的'],
  ['busy', '忙的'], ['careful', '仔细的'], ['friendly', '友好的'], ['quiet', '安静的'],
  ['dangerous', '危险的'], ['different', '不同的'], ['important', '重要的'], ['interesting', '有趣的'],
  ['listen', '听'], ['watch', '观看'], ['borrow', '借入'], ['return', '归还'],
  ['arrive', '到达'], ['invite', '邀请'], ['remember', '记得'], ['forget', '忘记'],
  ['answer', '回答'], ['question', '问题'], ['problem', '难题'], ['because', '因为'],
  ['always', '总是'], ['usually', '通常'], ['sometimes', '有时'], ['never', '从不'],
  ['excited', '兴奋的'], ['afraid', '害怕的'], ['surprised', '惊讶的'], ['nervous', '紧张的'],
  ['spring', '春天'], ['summer', '夏天'], ['cloudy', '多云的'], ['windy', '有风的'],
  ['umbrella', '雨伞'], ['clothes', '衣服'], ['shoes', '鞋'], ['jacket', '夹克'],
  ['pencil', '铅笔'], ['ruler', '尺子'], ['eraser', '橡皮'], ['notebook', '笔记本']
];

/* 不规则过去式：五年级必须背下来的一批 */
const EN_PAST = [
  ['go', 'went'], ['have', 'had'], ['do', 'did'], ['see', 'saw'], ['eat', 'ate'],
  ['take', 'took'], ['make', 'made'], ['come', 'came'], ['get', 'got'], ['buy', 'bought'],
  ['teach', 'taught'], ['catch', 'caught'], ['run', 'ran'], ['swim', 'swam'], ['sing', 'sang'],
  ['write', 'wrote'], ['draw', 'drew'], ['fly', 'flew'], ['drink', 'drank'], ['give', 'gave'],
  ['know', 'knew'], ['put', 'put'], ['read', 'read'], ['say', 'said'], ['tell', 'told']
];

/* 特殊复数 */
const EN_PLURAL = [
  ['child', 'children'], ['man', 'men'], ['woman', 'women'], ['foot', 'feet'], ['tooth', 'teeth'],
  ['mouse', 'mice'], ['sheep', 'sheep'], ['fish', 'fish'], ['box', 'boxes'], ['watch', 'watches'],
  ['city', 'cities'], ['baby', 'babies'], ['knife', 'knives'], ['leaf', 'leaves'], ['photo', 'photos']
];

/* 比较级 */
const EN_COMP = [
  ['tall', 'taller'], ['big', 'bigger'], ['happy', 'happier'], ['good', 'better'],
  ['bad', 'worse'], ['many', 'more'], ['hot', 'hotter'], ['easy', 'easier'],
  ['thin', 'thinner'], ['fat', 'fatter'], ['long', 'longer'], ['beautiful', 'more beautiful']
];

/* 时态：五年级覆盖一般现在、现在进行、一般将来、一般过去 */
const EN_TENSE = [
  { q: 'He ___ to school by bike every day.', a: 'goes', opts: ['go', 'goes', 'going', 'went'], tip: 'every day 表示经常发生，主语 he 是第三人称单数，动词加 s' },
  { q: 'Look! The children ___ in the playground.', a: 'are playing', opts: ['play', 'plays', 'are playing', 'played'], tip: 'Look! 提示动作正在进行，用现在进行时 be + 动词ing' },
  { q: 'They ___ football yesterday afternoon.', a: 'played', opts: ['play', 'plays', 'played', 'playing'], tip: 'yesterday 是过去时间，动词要用过去式' },
  { q: 'We ___ visit the museum tomorrow.', a: 'are going to', opts: ['are going to', 'is going to', 'go to', 'went to'], tip: 'tomorrow 表将来，主语 we 用 are going to' },
  { q: 'There ___ some milk in the glass.', a: 'is', opts: ['is', 'are', 'be', 'have'], tip: 'milk 是不可数名词，there be 句型用 is' },
  { q: '___ you like apples? — Yes, I do.', a: 'Do', opts: ['Do', 'Does', 'Are', 'Is'], tip: '主语是 you，一般现在时用 Do 提问' },
  { q: 'She ___ her homework now.', a: 'is doing', opts: ['do', 'does', 'is doing', 'did'], tip: 'now 提示正在进行，用现在进行时' },
  { q: 'I ___ to Beijing last summer.', a: 'went', opts: ['go', 'goes', 'went', 'going'], tip: 'last summer 是过去时间，go 的过去式是 went' }
];

/* 介词与固定搭配 */
const EN_PREP = [
  { q: 'I get up ___ seven o\'clock.', a: 'at', opts: ['at', 'in', 'on', 'for'], tip: '具体钟点前面用 at' },
  { q: 'We have four classes ___ the morning.', a: 'in', opts: ['at', 'in', 'on', 'for'], tip: 'morning / afternoon / evening 前面用 in' },
  { q: 'My birthday is ___ May 1st.', a: 'on', opts: ['at', 'in', 'on', 'for'], tip: '具体到某一天前面用 on' },
  { q: 'She is good ___ English.', a: 'at', opts: ['at', 'in', 'on', 'with'], tip: 'be good at 是固定搭配，意思是擅长' },
  { q: 'Thanks ___ your help.', a: 'for', opts: ['for', 'to', 'of', 'at'], tip: 'thanks for 表示因为某事而感谢' },
  { q: 'Please listen ___ me carefully.', a: 'to', opts: ['to', 'at', 'for', 'with'], tip: 'listen to 是固定搭配' },
  { q: 'He is different ___ his brother.', a: 'from', opts: ['from', 'with', 'to', 'of'], tip: 'be different from 与……不同' }
];

/* 从候选池里凑够 4 个不重复选项，并把正确答案的位置打乱 */
function enOpts(rnd, right, pool) {
  const opts = [right];
  let guard = 0;
  while (opts.length < 4 && guard++ < 150) {
    const v = pool[Math.floor(rnd() * pool.length)];
    if (v && opts.indexOf(v) < 0) opts.push(v);
  }
  return rgShuffle(rnd, opts);
}

function enVocab(rnd, pool) {
  const [en, cn] = rgPick(rnd, pool);
  const zh2en = rnd() < 0.5;
  const right = zh2en ? en : cn;
  const opts = enOpts(rnd, right, EN_WORDS.map(x => zh2en ? x[0] : x[1]));
  return {
    sub: '英语', mode: 'choice',
    q: zh2en ? `「${cn}」的英文是？` : `「${en}」的意思是？`,
    opts, a: opts.indexOf(right),
    tip: `${en} = ${cn}`
  };
}

function enForm(rnd) {
  const kind = rgPick(rnd, ['past', 'plural', 'comp']);
  if (kind === 'past') {
    const [base, past] = rgPick(rnd, EN_PAST);
    const opts = enOpts(rnd, past, EN_PAST.map(x => x[1]));
    return {
      sub: '英语', mode: 'choice', q: `动词「${base}」的过去式是？`,
      opts, a: opts.indexOf(past),
      tip: `${base} → ${past}，属于不规则变化，必须单独记`
    };
  }
  if (kind === 'plural') {
    const [one, many] = rgPick(rnd, EN_PLURAL);
    const opts = enOpts(rnd, many, EN_PLURAL.map(x => x[1]));
    return {
      sub: '英语', mode: 'choice', q: `「${one}」的复数形式是？`,
      opts, a: opts.indexOf(many),
      tip: `${one} → ${many}`
    };
  }
  const [base, comp] = rgPick(rnd, EN_COMP);
  const opts = enOpts(rnd, comp, EN_COMP.map(x => x[1]));
  return {
    sub: '英语', mode: 'choice', q: `「${base}」的比较级是？`,
    opts, a: opts.indexOf(comp),
    tip: `${base} → ${comp}`
  };
}

function enTense(rnd) {
  const t = rgPick(rnd, EN_TENSE);
  const opts = rgShuffle(rnd, t.opts);
  return {
    sub: '英语', mode: 'choice', q: t.q,
    opts, a: opts.indexOf(t.a), tip: t.tip
  };
}

function enPrep(rnd) {
  const t = rgPick(rnd, EN_PREP);
  const opts = rgShuffle(rnd, t.opts);
  return {
    sub: '英语', mode: 'choice', q: t.q,
    opts, a: opts.indexOf(t.a), tip: t.tip
  };
}

function genEnglish(rnd, n) {
  const plan = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) plan.push('easy');
    else if (i === n - 1) plan.push('hard');
    else plan.push('mid');
  }
  const easyPool = EN_WORDS.slice(0, 40);
  const seen = {};
  const out = [];
  plan.forEach(lv => {
    let item = null, guard = 0;
    while (guard++ < 80) {
      let cand;
      if (lv === 'easy') cand = enVocab(rnd, easyPool);
      else if (lv === 'mid') cand = (rnd() < 0.65) ? enVocab(rnd, EN_WORDS) : enPrep(rnd);
      else cand = (rnd() < 0.55) ? enForm(rnd) : enTense(rnd);
      if (!cand || seen[cand.q]) continue;
      item = cand;
      break;
    }
    if (item) { seen[item.q] = 1; out.push(item); }
  });
  return out;
}

/* ---------- 组卷 ----------
   每天固定 15 题：数学 5 + 语文 5 + 英语 5。
   三科都要练，但**按科目分段连着出**，不是一题数学一题语文来回跳 ——
   小学生换一次科目要重新进状态，交替出题等于把难度白抬一截。
   段与段之间在页面上有明显分隔，孩子知道「数学这 5 道做完了」。 */
const PRACTICE_PER_SUB = 5;
const PRACTICE_SUBJECTS = ['数学', '语文', '英语'];

function practiceTotal() { return PRACTICE_PER_SUB * PRACTICE_SUBJECTS.length; }

function practicePaper(dateStr, tag) {
  const seed = sgHash(String(tag || 'sg') + '|' + dateStr);
  return [].concat(
    genMath(sgRand(seed ^ 0x9E3779B9), PRACTICE_PER_SUB),
    genChinese(sgRand(seed ^ 0x85EBCA6B), PRACTICE_PER_SUB),
    genEnglish(sgRand(seed ^ 0xC2B2AE35), PRACTICE_PER_SUB)
  );
}

/* ---------- 答题状态 ----------
   题目不进存档：只要日期固定，题目就能重算出来，刷新不会变。
   存档只记「做到第几题、每题答了什么」，这样数据量小、也不怕同步冲突。 */
function localDateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/* 日期口径统一走本地日历。用 toISOString 会在凌晨 0–8 点算成前一天，
   孩子早上七点打开会拿到昨天那份卷子。 */
function practiceDateStr() {
  try { if (typeof S !== 'undefined' && S && S.planDate) return S.planDate; } catch (e) {}
  return localDateStr();
}

function practiceTodayKey() { return practiceDateStr(); }

function practiceState() {
  if (!S.practice || S.practice.date !== practiceTodayKey()) {
    S.practice = {
      date: practiceTodayKey(),
      idx: 0,
      answers: [],
      done: false,
      startedAt: Date.now(),
      usedMs: 0
    };
  }
  return S.practice;
}

function practiceList() {
  const tag = S.familyCode || (S.childName || '') + (S.role || '');
  return practicePaper(practiceTodayKey(), tag);
}

/* 判定：数学按数值比，语文英语按选项序号 */
function practiceCheck(item, ans) {
  if (ans === null || ans === undefined || ans === '') return false;
  if (item.mode === 'input') {
    const v = parseFloat(String(ans).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(v)) return false;
    return Math.abs(v - item.a) < 0.005;
  }
  return Number(ans) === item.a;
}

/* ---------- 答题页 ---------- */
function openPractice() {
  const st = practiceState();
  const list = practiceList();
  if (st.done || st.idx >= list.length) { openPracticeResult(); return; }
  S.page = 'practice';
  save(); render();
}

function renderPractice() {
  const st = practiceState();
  const list = practiceList();
  if (st.done || st.idx >= list.length) return renderPracticeResult();

  const item = list[st.idx];
  const n = list.length;
  const prev = st.answers[st.idx];
  const right = st.answers.filter((v, i) => practiceCheck(list[i], v)).length;
  const pct = Math.round((st.idx / n) * 100);
  // 每换一科就给一个明显的段落头，孩子知道这一段还剩几道
  const showSeg = st.idx === 0 || list[st.idx - 1].sub !== item.sub;
  const inSub = list.filter((it, i) => it.sub === item.sub && i < st.idx).length;
  const subCls = item.sub === '数学' ? 'math' : item.sub === '语文' ? 'cn' : 'en';

  const body = item.mode === 'input'
    ? `<div class="prac-input-row">
         <input id="pracInput" class="prac-input" type="text" inputmode="decimal"
           autocomplete="off" autocorrect="off" spellcheck="false"
           placeholder="填答案" value="${prev !== undefined && prev !== null ? prev : ''}">
       </div>
       <button class="btn primary prac-submit" onclick="submitPractice()">确认</button>`
    : `<div class="prac-opts">
         ${item.opts.map((o, i) => {
           const cls = prev === undefined || prev === null ? ''
             : (i === item.a ? ' right' : (i === prev ? ' wrong' : ' dim'));
           return `<button class="prac-opt${cls}" onclick="answerPractice(${i})">
             <span class="prac-key">${'ABCD'[i]}</span><span class="prac-txt">${o}</span>
           </button>`;
         }).join('')}
       </div>`;

  const answered = prev !== undefined && prev !== null;
  const feedback = answered
    ? `<div class="prac-fb ${practiceCheck(item, prev) ? 'ok' : 'no'}">
         ${practiceCheck(item, prev) ? '✔ 答对了' : '✘ 正确答案：' + (item.mode === 'input' ? item.a : item.opts[item.a])}
         ${item.tip ? `<div class="prac-tip">${item.tip}</div>` : ''}
       </div>
       <button class="btn primary prac-submit" onclick="nextPractice()">
         ${st.idx === n - 1 ? '看结果' : '下一题'}
       </button>`
    : '';

  return `
  <div class="prac-wrap">
    <div class="prac-head">
      ${showSeg ? `<div class="prac-seg seg-${subCls}">
        <b>${item.sub}</b><span>这一段 ${PRACTICE_PER_SUB} 道，做完再换下一科</span>
      </div>` : ''}
      <div class="prac-meta">
        <span class="prac-sub sub-${subCls}">${item.sub} ${inSub + 1}/${PRACTICE_PER_SUB}</span>
        <span class="prac-count">第 ${st.idx + 1} / ${n} 题</span>
        <span class="prac-score">已对 ${right}</span>
      </div>
      <div class="prac-bar"><i style="width:${pct}%"></i></div>
    </div>

    <div class="prac-q">${item.q}</div>
    ${body}
    ${feedback}

    <div class="prac-foot">
      <button class="btn ghost" onclick="quitPractice()">先存着，待会儿做</button>
    </div>
  </div>`;
}

function answerPractice(i) {
  const st = practiceState();
  const list = practiceList();
  if (st.answers[st.idx] !== undefined && st.answers[st.idx] !== null) return;  // 已答不能改
  st.answers[st.idx] = i;
  save(); render();
  beep(practiceCheck(list[st.idx], i) ? 'coin' : 'tick');
}

function submitPractice() {
  const st = practiceState();
  const list = practiceList();
  const el = document.getElementById('pracInput');
  if (!el) return;
  const v = String(el.value || '').trim();
  if (!v) { toast('先填个答案'); return; }
  if (st.answers[st.idx] !== undefined && st.answers[st.idx] !== null) return;
  st.answers[st.idx] = v;
  save(); render();
  beep(practiceCheck(list[st.idx], v) ? 'coin' : 'tick');
}

function nextPractice() {
  const st = practiceState();
  const list = practiceList();
  if (st.idx >= list.length - 1) { finishPractice(); return; }
  st.idx++;
  save(); render();
}

/* 中途退出：进度留着，回来接着做同一份卷子 */
function quitPractice() {
  S.page = 'home';
  save(); render();
  toast('进度存着了，回来接着做');
}

function finishPractice() {
  const st = practiceState();
  const list = practiceList();
  st.done = true;
  st.usedMs = Date.now() - (st.startedAt || Date.now());
  const right = list.filter((it, i) => practiceCheck(it, st.answers[i])).length;
  st.right = right;
  st.total = list.length;
  save();
  // 做完这一份就算完成「课外练习」这块，正常计分
  completeTask('practice');
  /* 练习救宠：一份练习算 1 页，能把断粮计数往回拨。
     生病做 1 份能救，濒危要做 3 份 —— 不花钱的活路，但要真做题。 */
  try {
    if (window.petPracticeRescue && S.pet && !S.pet.dead) {
      const ph = petPhase(S.pet);
      const need = ph === 'danger' ? 3 : ph === 'sick' ? 1 : 0;
      if (need) petPracticeRescue(need);
    }
  } catch (e) {}
  S.page = 'practice';
  render();
}

function openPracticeResult() {
  S.page = 'practice';
  render();
}

function renderPracticeResult() {
  const st = practiceState();
  const list = practiceList();
  const right = st.right !== undefined
    ? st.right
    : list.filter((it, i) => practiceCheck(it, st.answers[i])).length;
  const total = st.total || list.length;
  const mins = Math.max(1, Math.round((st.usedMs || (Date.now() - (st.startedAt || Date.now()))) / 60000));
  const wrong = list.map((it, i) => ({ it, i })).filter(x => !practiceCheck(x.it, st.answers[x.i]));
  const tone = right >= total ? '满分，一题没错' : right >= total * 0.8 ? '做得不错' : '错的这几道值得再看一遍';
  // 分科统计才是家长真正要看的：哪科稳、哪科拖后腿
  const bySub = PRACTICE_SUBJECTS.map(s => {
    const arr = list.map((it, i) => ({ it, i })).filter(x => x.it.sub === s);
    const r = arr.filter(x => practiceCheck(x.it, st.answers[x.i])).length;
    return { s, r, t: arr.length };
  }).filter(x => x.t > 0);

  return `
  <div class="prac-wrap">
    <div class="prac-done">
      <div class="prac-big">${right}<span>/${total}</span></div>
      <div class="prac-tone">${tone}</div>
      <div class="prac-by">
        ${bySub.map(x => `<div class="prac-by-item">
          <span class="prac-by-k">${x.s}</span>
          <span class="prac-by-v">${x.r}/${x.t}</span>
        </div>`).join('')}
      </div>
      <div class="prac-sub2">共 ${total} 题 · 用了约 ${mins} 分钟</div>
    </div>

    ${wrong.length ? `
      <div class="prac-wrong">
        <div class="prac-wrong-t">错的 ${wrong.length} 道</div>
        ${wrong.map(({ it, i }) => `
          <div class="prac-wrong-item">
            <div class="prac-wrong-q">${i + 1}. ${it.q}</div>
            <div class="prac-wrong-a">
              你的答案：<b>${st.answers[i] === undefined || st.answers[i] === null ? '没答'
                : (it.mode === 'input' ? st.answers[i] : it.opts[st.answers[i]])}</b>
              · 正确：<b class="ok">${it.mode === 'input' ? it.a : it.opts[it.a]}</b>
            </div>
            ${it.tip ? `<div class="prac-tip">${it.tip}</div>` : ''}
          </div>`).join('')}
      </div>` : `<div class="prac-allclear">全部答对，明天换新的一份。</div>`}

    <div class="prac-foot">
      <button class="btn primary" onclick="go('home')">回今日</button>
    </div>
  </div>`;
}
