/* ===========================================================
   学习守护 · 周六自主计划
   周六不排时间轴。孩子自己列「今天想做什么」，玩也算正事。
   三条设计红线，别改：
   1) 不给时间点 —— 一排时间就变成任务，孩子会开始应付；
   2) 不计分不给币 —— 一旦有奖励，玩就成了打工；
   3) 家长端只读，不设评价入口 —— 看得到，但说不上话。
   =========================================================== */

/* 灵感清单：空白页最难写，给点现成的降低门槛。
   分五组是因为孩子想事情本来就是按「在哪、跟谁、干什么」想的。 */
const SAT_IDEAS = [
  { g: '出去玩', tag: 'play',  list: ['骑车', '去公园', '约同学', '逛书店', '看电影'] },
  { g: '在家玩', tag: 'play',  list: ['拼乐高', '画画', '做手工', '看动画', '玩游戏'] },
  { g: '动一动', tag: 'sport', list: ['打羽毛球', '跳绳', '跑步', '轮滑'] },
  { g: '帮家里', tag: 'chore', list: ['帮做饭', '整理房间', '浇花', '倒垃圾'] },
  { g: '想学点', tag: 'study', list: ['看课外书', '练字', '写作业', '做小实验'] }
];

const SAT_TAGS = {
  play:  { name: '玩',   color: '#FF8A3D', soft: '#FFF1E7' },
  sport: { name: '运动', color: '#1FA36B', soft: '#E6F7EF' },
  chore: { name: '家务', color: '#D99322', soft: '#FDF3E0' },
  study: { name: '学习', color: '#4F63E0', soft: '#EDEFFE' },
  other: { name: '其他', color: '#98A0B0', soft: '#F1F3F7' }
};

function satPad(n) { return String(n).padStart(2, '0'); }

/* 按本地日期取 key。不能用 toISOString —— 那是 UTC，晚上会算成第二天。 */
function satDateKey() {
  const d = new Date();
  return d.getFullYear() + '-' + satPad(d.getMonth() + 1) + '-' + satPad(d.getDate());
}

/* 换周不继承旧清单：每个周六都从空白开始，才叫「自己设计」。
   旧的先归档进 history，家长端往日后翻还能看到那天列了什么。 */
function satPlan() {
  const key = satDateKey();
  if (!S.satPlan || S.satPlan.date !== key) {
    if (S.satPlan && Array.isArray(S.satPlan.items) && S.satPlan.items.length) {
      satPushSnapshot(S.satPlan);
    }
    S.satPlan = { date: key, items: [] };
  }
  if (!Array.isArray(S.satPlan.items)) S.satPlan.items = [];
  return S.satPlan;
}

function satPushSnapshot(old) {
  S.history = Array.isArray(S.history) ? S.history : [];
  const hit = S.history.find(h => h && h.date === old.date);
  if (hit) { hit.satPlan = old; return; }
  S.history.unshift({ date: old.date, items: [], tasks: {}, satPlan: old });
  S.history = S.history.slice(0, 30);
}

function satStat(plan) {
  const p = plan || satPlan();
  const total = p.items.length;
  const done = p.items.filter(i => i.done).length;
  return { total, done };
}

function addSatItem(text, tag) {
  const t = String(text || '').trim().slice(0, 24);
  if (!t) { toast('先写点什么再点加上'); return false; }
  const p = satPlan();
  if (p.items.length >= 12) { toast('列得够多了，留点空给临时想做的事'); return false; }
  if (p.items.some(i => i.text === t)) { toast('这条已经在清单里了'); return false; }
  p.items.push({
    id: 's' + Date.now().toString(36) + Math.floor(Math.random() * 900 + 100),
    text: t,
    tag: SAT_TAGS[tag] ? tag : 'other',
    done: false,
    doneAt: null
  });
  save(); render();
  return true;
}

function addSatFromInput() {
  const el = $('#satIn');
  if (!el) return;
  if (addSatItem(el.value, 'other')) el.value = '';
}

function addSatIdea(text, tag) {
  addSatItem(text, tag);
}

function toggleSatItem(id) {
  const p = satPlan();
  const it = p.items.find(i => i.id === id);
  if (!it) return;
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : null;
  const st = satStat(p);
  save(); render();
  if (st.total > 1 && st.done === st.total) toast('全都做到了，这个周六归你');
}

function delSatItem(id) {
  const p = satPlan();
  p.items = p.items.filter(i => i.id !== id);
  save(); render();
}

/* ---------- 周六页面 ---------- */
function renderSaturday() {
  const p = satPlan();
  const st = satStat(p);
  const allDone = st.total > 0 && st.done === st.total;
  const sub = st.total === 0
    ? '想做什么就写下来。玩也算正事，不用写作业。'
    : allDone ? '都做完了。剩下的时间随便用，没人再给你派事。'
    : '做到一件就打一个勾。先做哪件、几点做，都你自己定。';

  return `
  <div class="sat-hero${allDone ? ' full' : ''}">
    <div class="sat-cap">周六 · 今天没有固定清单</div>
    <div class="sat-num">${st.done}<small>/${st.total} 件</small></div>
    <div class="sat-sub">${sub}</div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>我想做的事</h2><span class="hint">想不出来的话，点下面的</span></div>
    <div class="p-card">
      <div class="sat-add">
        <input id="satIn" class="sat-in" placeholder="比如：骑车去公园" maxlength="24"
               onkeydown="if(event.key==='Enter')addSatFromInput()">
        <button class="btn primary sat-add-btn" onclick="addSatFromInput()">加上</button>
      </div>
      <div class="sat-ideas">
        ${SAT_IDEAS.map(g => `
          <div class="sat-idea-g">
            <div class="sat-idea-t">${g.g}</div>
            <div class="sat-idea-chips">
              ${g.list.map(x => `<button class="sat-chip" onclick="addSatIdea('${x}','${g.tag}')">${x}</button>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>今天的清单</h2><span class="hint">顺序你自己排</span></div>
    <div class="p-card">
      ${p.items.length ? p.items.map(i => {
        const tg = SAT_TAGS[i.tag] || SAT_TAGS.other;
        return `<div class="sat-row${i.done ? ' done' : ''}">
          <button class="sat-tick" onclick="toggleSatItem('${i.id}')" aria-label="打勾">
            ${i.done ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.8l4.4 4.4L19 6.6"/></svg>' : ''}
          </button>
          <span class="sat-text">${i.text}</span>
          <span class="sat-tag" style="color:${tg.color};background:${tg.soft}">${tg.name}</span>
          <button class="sat-del" onclick="delSatItem('${i.id}')" aria-label="删掉">×</button>
        </div>`;
      }).join('') : '<div class="empty">还没列。想到什么就加什么，不用凑满。</div>'}
    </div>
  </div>

  <div class="sec">
    <div class="sec-h"><h2>今天的一句话</h2></div>
    <div class="p-card" style="background:var(--brand-soft);border-color:#DDE2FD">
      <div style="font-size:14.5px;line-height:2;color:#2A3566">
        这一天是你自己安排的，做多做少都没人扣分。<br>
        <span style="font-size:12.5px;color:#5A6BA8">明天下午两点，我们再把作业那摊事收一收。</span>
      </div>
    </div>
  </div>`;
}

/* 家长端只读卡片：孩子列了什么、做完了什么，不给评价按钮 */
function satSummaryHTML(date) {
  let plan = null;
  if (!date || date === satDateKey()) {
    plan = (S.satPlan && S.satPlan.date === date) ? S.satPlan : null;
    if (!date) plan = S.satPlan;
  }
  if (!plan) {
    const h = (S.history || []).find(x => x && x.date === date);
    plan = h && h.satPlan ? h.satPlan : null;
  }
  if (!plan || !plan.items || !plan.items.length) return '';
  const st = satStat(plan);
  return `
  <div class="sec">
    <div class="sec-h"><h2>周六自主安排</h2><span class="hint">他自己定的，只看看</span></div>
    <div class="p-card">
      <div class="sat-sum-top">列了 ${st.total} 件，做完 ${st.done} 件</div>
      ${plan.items.map(i => `<div class="p-row">
        <span class="pn">${i.done ? '✓ ' : '· '}${i.text}</span>
        <span class="ps">${(SAT_TAGS[i.tag] || SAT_TAGS.other).name}</span>
      </div>`).join('')}
    </div>
  </div>`;
}
