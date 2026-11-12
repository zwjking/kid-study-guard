/* ===========================================================
   学习守护 · 云同步层
   职责：初始化 SDK、手机号+密码登录/注册、改密、云端读写
   本文件不碰 UI，只提供能力；UI 与状态由 app.js 驱动
   =========================================================== */

const CLOUD_CONF = {
  // 自托管配置：把占位符换成你自己的 WorkBuddy 应用配置（oauthRelayBaseUrl 是平台公共地址，无需改动）
  endpoint: 'https://YOUR_APP_HOST',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'YOUR_PUBLISHABLE_KEY'
};

const Cloud = (() => {
  let client = null;
  let ready = false;
  let lastError = '';
  let pendingOtp = null;      // 注册时暂存 sendOtp 的返回
  let pendingReset = null;    // 重置密码时暂存的 challenge
  let pushTimer = null;
  let pushing = false;

  /* ---------- 初始化 ---------- */
  function init() {
    if (ready) return true;
    try {
      const root = window.WorkBuddyCloud;
      if (!root || typeof root.createWorkBuddyCloud !== 'function') {
        lastError = 'SDK 未加载';
        return false;
      }
      client = root.createWorkBuddyCloud({
        endpoint: CLOUD_CONF.endpoint,
        oauthRelayBaseUrl: CLOUD_CONF.oauthRelayBaseUrl,
        publishableKey: CLOUD_CONF.publishableKey
      });
      ready = true;
      return true;
    } catch (e) {
      lastError = (e && e.message) || '初始化失败';
      return false;
    }
  }

  function errText(e) {
    if (!e) return '未知错误';
    if (typeof e === 'string') return e;
    return e.message || e.error_description || JSON.stringify(e);
  }

  /* ---------- 会话 ---------- */
  async function getSession() {
    if (!init()) return null;
    try {
      const r = await client.auth.getSession();
      if (r && r.error) { lastError = errText(r.error); return null; }
      return (r && r.data) || null;
    } catch (e) { lastError = errText(e); return null; }
  }

  /* ---------- 登录：邮箱 + 密码 ---------- */
  async function signIn(email, password) {
    if (!init()) return { ok: false, msg: lastError };
    if (!isEmail(email)) return { ok: false, msg: '请输入正确的邮箱地址' };
    if (!password || password.length < 6) return { ok: false, msg: '密码至少 6 位' };
    try {
      const r = await client.auth.signInWithPassword({ email, password });
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      return { ok: true, session: r && r.data };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  /* ---------- 注册第一步：发邮箱验证码 ---------- */
  async function sendCode(email) {
    if (!init()) return { ok: false, msg: lastError };
    if (!isEmail(email)) return { ok: false, msg: '请输入正确的邮箱地址' };
    try {
      const r = await client.auth.sendOtp({ email });
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      if (!r || !r.data) return { ok: false, msg: '验证码发送失败' };
      pendingOtp = {
        email,
        verificationId: r.data.verificationId,
        isExistingUser: r.data.isExistingUser
      };
      return { ok: true, isExistingUser: r.data.isExistingUser };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  /* ---------- 注册第二步：验证码 + 设密码 ---------- */
  async function verifyAndSignUp(email, code, password) {
    if (!init()) return { ok: false, msg: lastError };
    const p = pendingOtp;
    if (!p || p.email !== email) return { ok: false, msg: '请先获取验证码' };
    if (!code) return { ok: false, msg: '请输入验证码' };
    if (!password || password.length < 6) return { ok: false, msg: '密码至少 6 位' };
    try {
      const r = await client.auth.verifyOtp({
        email: p.email,
        verificationId: p.verificationId,
        isExistingUser: p.isExistingUser,
        token: code,
        password: p.isExistingUser ? undefined : password
      });
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      pendingOtp = null;
      return { ok: true, session: r && r.data };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  /* ---------- 忘记密码（仅邮箱支持） ---------- */
  async function resetPassword(email) {
    if (!init()) return { ok: false, msg: lastError };
    if (!isEmail(email)) return { ok: false, msg: '请输入正确的邮箱地址' };
    try {
      const r = await client.auth.resetPasswordForEmail(email.trim());
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      if (!r.data || typeof r.data.updateUser !== 'function') {
        return { ok: false, msg: '重置流程不可用' };
      }
      pendingReset = r.data;
      return { ok: true };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  async function finishReset(code, newPassword) {
    if (!pendingReset) return { ok: false, msg: '请先获取重置验证码' };
    if (!newPassword || newPassword.length < 6) return { ok: false, msg: '新密码至少 6 位' };
    try {
      const r = await pendingReset.updateUser({ nonce: code, password: newPassword });
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      pendingReset = null;
      return { ok: true };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  /* ---------- 改密码 ---------- */
  async function changePassword(oldPassword, newPassword) {
    if (!init()) return { ok: false, msg: lastError };
    if (!newPassword || newPassword.length < 6) return { ok: false, msg: '新密码至少 6 位' };
    try {
      const r = await client.auth.resetPasswordForOld({ oldPassword, newPassword });
      if (r && r.error) return { ok: false, msg: friendly(r.error) };
      return { ok: true };
    } catch (e) { return { ok: false, msg: errText(e) }; }
  }

  async function signOut() {
    if (!init()) return;
    try { await client.auth.signOut(); } catch (e) {}
  }

  function friendly(e) {
    const m = errText(e);
    if (/Username or password incorrect|Wrong account or password|invalid.?grant|Invalid login/i.test(m)) return '邮箱或密码不对';
    if (/not.?found|no such user|User not found/i.test(m)) return '这个邮箱还没注册';
    if (/已存在|already registered|User already/i.test(m)) return '该邮箱已注册，请直接登录';
    if (/rate|frequen|too many/i.test(m)) return '发送太频繁，稍后再试';
    if (/verification|token|验证码/i.test(m)) return '验证码不对或已过期';
    return m;
  }

  /* ---------- 工具 ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function unwrap(r) {
    if (r && r.error) throw new Error(errText(r.error));
    return r && r.data;
  }

  /* ---------- 拉取云端数据 ---------- */
  async function pull() {
    if (!init()) return null;
    const db = client.database;
    const day = today();
    try {
      const [h, t, b, rd] = await Promise.all([
        db.from('household').select('*').limit(1),
        db.from('day_tasks').select('*').eq('plan_date', day),
        db.from('books').select('*').order('created_at', { ascending: true }),
        db.from('redeems').select('*').order('created_at', { ascending: false }).limit(50)
      ]);
      return {
        day,
        household: (unwrap(h) || [])[0] || null,
        tasks: unwrap(t) || [],
        books: unwrap(b) || [],
        redeems: unwrap(rd) || []
      };
    } catch (e) {
      lastError = errText(e);
      return null;
    }
  }

  /* ---------- 按日期拉历史任务 ----------
     day_tasks 是按 plan_date 存的，往日记录一直都在，
     只是 pull() 固定只拉今天，所以界面上「昨天」就消失了。
     返回 null 表示查询失败（网络/权限），返回 [] 表示这一天确实没有记录。
     两者在界面上必须区分开，否则失败会被误读成「孩子那天没做」。 */
  async function pullTasksByDate(day) {
    if (!init() || !day) return null;
    try {
      const r = await client.database
        .from('day_tasks')
        .select('*')
        .eq('plan_date', day);
      return unwrap(r) || [];
    } catch (e) { lastError = errText(e); return null; }
  }

  /* ---------- 推送：任务状态（逐条 upsert） ---------- */
  async function pushTasks(rows, day) {
    if (!init() || !rows.length) return false;
    try {
      const r = await client.database
        .from('day_tasks')
        .upsert(rows.map(x => ({ ...x, plan_date: day })), {
          onConflict: 'owner_id,plan_date,task_id'
        });
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  /* ---------- 推送：家庭设置 / 积分 ----------
     表结构演进的容错，这条是血换来的：
     给 household 加新字段（v1.4.0 的 pet / pet_bag / pet_own / pet_grave）时，
     如果云端还没建对应的列，数据库会整行拒绝更新 —— 连带 coins、plan_date、
     plan_items 一起写不进去。结果是每日清单卡在旧日期，下次同步被判成「跨天」
     反复清空，孩子列好的作业一遍遍消失。
     所以命中「列不存在」时，退到核心字段再写一次，扩展字段失败不能拖死主链路。 */
  const HOUSEHOLD_CORE = ['child_name', 'family_code', 'coins', 'earned_today',
                          'streak', 'bonus_cleared', 'plan_date', 'plan_items'];

  function pickCore(row) {
    const o = {};
    HOUSEHOLD_CORE.forEach(k => { if (row && k in row) o[k] = row[k]; });
    return o;
  }

  function isMissingColumn(e) {
    const s = errText(e) + ' ' + (e ? JSON.stringify(e) : '');
    return /column|schema cache|PGRST204|42703/i.test(s);
  }

  async function pushHousehold(row) {
    if (!init()) return false;
    const write = async payload => {
      const cur = await client.database.from('household').select('id').limit(1);
      const list = unwrap(cur) || [];
      return list.length
        ? client.database.from('household').update(payload).eq('id', list[0].id)
        : client.database.from('household').insert(payload);
    };
    try {
      const r = await write(row);
      if (!r || !r.error) return true;
      lastError = errText(r.error);
      if (!isMissingColumn(r.error)) return false;
      const r2 = await write(pickCore(row));
      if (r2 && r2.error) { lastError = errText(r2.error); return false; }
      return true;
    } catch (e) {
      lastError = errText(e);
      try {
        const r2 = await write(pickCore(row));
        if (r2 && r2.error) { lastError = errText(r2.error); return false; }
        return true;
      } catch (e2) { lastError = errText(e2); return false; }
    }
  }

  /* ---------- 推送：练习册 ---------- */
  async function pushBooks(rows) {
    if (!init() || !rows.length) return false;
    try {
      const r = await client.database
        .from('books')
        .upsert(rows, { onConflict: 'owner_id,name' });
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  async function deleteBook(name) {
    if (!init()) return false;
    try {
      const r = await client.database.from('books').delete().eq('name', name);
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  /* ---------- 兑换申请 ----------
     返回插入后的记录（含云端 id），拿不到就返回 null。
     旧版只返回 true/false，本地没法把「自己的单」和云端那条对上，
     家长在另一台设备点已兑现后，孩子端就同步不回来。 */
  async function addRedeem(row) {
    if (!init()) return null;
    try {
      const r = await client.database.from('redeems').insert(row);
      if (r && r.error) { lastError = errText(r.error); return null; }
      const d = r && r.data;
      return Array.isArray(d) ? (d[0] || true) : (d || true);
    } catch (e) { lastError = errText(e); return null; }
  }

  async function setRedeemStatus(id, status, note) {
    if (!init()) return false;
    try {
      const r = await client.database
        .from('redeems')
        .update({ status, approve_note: note || null, resolved_at: new Date().toISOString() })
        .eq('id', id);
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  /* ---------- 积分流水 ---------- */
  async function addCoin(amount, reason, day) {
    if (!init()) return false;
    try {
      const r = await client.database
        .from('coin_logs')
        .insert({ amount, reason, plan_date: day || today() });
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  /* ---------- 凭证文件：照片 / 录音 ----------
     平台只放行 runtime 这一个 bucket；路径用 userPath() 生成，
     自带 owner/<uid>/ 前缀，天然按用户隔离，配合 RLS 别人拿不到 */
  const EVIDENCE_BUCKET = 'runtime';

  /* 存储路径必须是 users/<uid>/... ，uid 从当前会话取 */
  async function currentUid() {
    const s = await getSession();
    return (s && s.user && s.user.id) || '';
  }

  async function uploadEvidence(blob, day, taskId) {
    if (!init()) return { ok: false, msg: '云服务没准备好' };
    if (!blob || !blob.size) return { ok: false, msg: '文件是空的' };
    const uid = await currentUid();
    if (!uid) return { ok: false, msg: '还没登录，凭证存不上去' };
    try {
      const isImg = String(blob.type || '').indexOf('image') === 0;
      const ext = isImg ? 'jpg' : (String(blob.type || '').indexOf('mp4') >= 0 ? 'm4a' : 'webm');
      const rel = `${day}/${taskId}-${Date.now()}.${ext}`;
      const path = client.storage.userPath(uid, rel);
      const r = await client.storage.from(EVIDENCE_BUCKET).upload(path, blob, {
        contentType: blob.type || (isImg ? 'image/jpeg' : 'audio/mp4'),
        upsert: true
      });
      if (r && r.error) { lastError = errText(r.error); return { ok: false, msg: lastError }; }
      return { ok: true, path: (r && r.data && r.data.path) || path };
    } catch (e) {
      lastError = errText(e);
      return { ok: false, msg: lastError };
    }
  }

  /* 家长端看照片/听录音用的临时地址，默认 1 小时有效 */
  async function evidenceUrl(path, seconds) {
    if (!init() || !path) return '';
    try {
      const r = await client.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, seconds || 3600);
      if (r && r.error) { lastError = errText(r.error); return ''; }
      const d = (r && r.data) || {};
      return d.signedUrl || d.signedURL || '';
    } catch (e) { lastError = errText(e); return ''; }
  }

  async function deleteEvidence(path) {
    if (!init() || !path) return false;
    try {
      const r = await client.storage.from(EVIDENCE_BUCKET).remove([path]);
      if (r && r.error) { lastError = errText(r.error); return false; }
      return true;
    } catch (e) { lastError = errText(e); return false; }
  }

  /* ---------- 防抖推送（由 app.js 的 save() 调用） ---------- */
  function schedule(localPush, delay) {
    if (!init()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (pushing) { schedule(localPush, 600); return; }
      pushing = true;
      try { await localPush(); } catch (e) { lastError = errText(e); }
      pushing = false;
    }, delay || 700);
  }

  return {
    init, getSession, signIn, sendCode, verifyAndSignUp, changePassword, signOut,
    resetPassword, finishReset, isEmail,
    pull, pullTasksByDate, pushTasks, pushHousehold, pushBooks, deleteBook, addRedeem, setRedeemStatus,
    addCoin, schedule,
    uploadEvidence, evidenceUrl, deleteEvidence,
    today,
    /* 内部函数，仅供验收脚本验证「缺列降级」这一层，业务代码不要调 */
    __pickCore: pickCore, __isMissingColumn: isMissingColumn,
    get error() { return lastError; },
    get lastError() { return lastError; }
  };
})();

window.Cloud = Cloud;
