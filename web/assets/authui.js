/* ===========================================================
   学习守护 · 登录门
   三种状态：登录 / 注册（邮箱验证码 + 设密码）/ 忘记密码
   只在未登录时显示；登录成功后整层移除，孩子端日常再也见不到
   =========================================================== */

const AuthUI = (() => {
  let mode = 'login';        // login | register | reset
  let busy = false;
  let codeSent = false;
  let resetSent = false;
  let msg = '';
  let msgType = '';

  function el() { return document.getElementById('authGate'); }

  function setMsg(t, type) {
    msg = t || '';
    msgType = type || '';
    paint();
  }

  function paint() {
    const g = el();
    if (!g) return;

    const tip = msg
      ? `<div class="auth-msg ${msgType}">${msg}</div>`
      : '';

    if (mode === 'login') {
      g.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo"><div class="dot">学</div></div>
        <h1>学习守护</h1>
        <p class="auth-sub">五年级晚间学习闭环 · 家长与孩子同一账号</p>

        <label class="auth-label">邮箱</label>
        <input id="af-email" class="auth-input" type="email" inputmode="email"
               autocomplete="username" placeholder="你的邮箱，用于登录和找回密码">

        <label class="auth-label">密码</label>
        <input id="af-pass" class="auth-input" type="password"
               autocomplete="current-password" placeholder="密码">

        ${tip}

        <button class="auth-btn" id="af-submit" ${busy ? 'disabled' : ''}>
          ${busy ? '登录中…' : '登录'}
        </button>

        <div class="auth-links">
          <button class="auth-link" onclick="AuthUI.go('register')">第一次用？注册</button>
          <button class="auth-link" onclick="AuthUI.go('reset')">忘记密码</button>
        </div>

        <p class="auth-foot">
          孩子平板第一次配好之后，她每天打开就直接进，不用再登录。
        </p>
        <p class="auth-ver">版本 ${window.APP_VERSION || '未知'} · SDK ${typeof window.WorkBuddyCloud !== 'undefined' ? '已就绪' : '未加载'}</p>
      </div>`;
      bindLogin();
    }

    if (mode === 'register') {
      g.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo"><div class="dot">学</div></div>
        <h1>注册</h1>
        <p class="auth-sub">一个邮箱，两端共用。验证码只发这一次。</p>

        <label class="auth-label">邮箱</label>
        <div class="auth-row">
          <input id="af-email" class="auth-input" type="email" inputmode="email"
                 autocomplete="username" placeholder="你的邮箱">
          <button class="auth-code" id="af-send" ${busy ? 'disabled' : ''}>
            ${codeSent ? '重新发送' : '获取验证码'}
          </button>
        </div>

        ${codeSent ? `
        <label class="auth-label">验证码</label>
        <input id="af-code" class="auth-input" type="text" inputmode="numeric"
               autocomplete="one-time-code" placeholder="邮件里的 6 位验证码">

        <label class="auth-label">设置密码</label>
        <input id="af-pass" class="auth-input" type="password" value="123456"
               autocomplete="new-password" placeholder="默认 123456，可改">
        <div class="auth-hint">默认密码已填好，想改直接改。至少 6 位。</div>
        ` : ''}

        ${tip}

        <button class="auth-btn" id="af-reg" ${(!codeSent || busy) ? 'disabled' : ''}>
          ${busy ? '处理中…' : '完成注册'}
        </button>

        <div class="auth-links">
          <button class="auth-link" onclick="AuthUI.go('login')">已经有账号，去登录</button>
        </div>
      </div>`;
      bindRegister();
    }

    if (mode === 'reset') {
      g.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo"><div class="dot">学</div></div>
        <h1>重置密码</h1>
        <p class="auth-sub">验证码会发到你的邮箱。</p>

        <label class="auth-label">邮箱</label>
        <div class="auth-row">
          <input id="af-email" class="auth-input" type="email" inputmode="email"
                 autocomplete="username" placeholder="注册时用的邮箱">
          <button class="auth-code" id="af-send" ${busy ? 'disabled' : ''}>
            ${resetSent ? '重新发送' : '获取验证码'}
          </button>
        </div>

        ${resetSent ? `
        <label class="auth-label">验证码</label>
        <input id="af-code" class="auth-input" type="text" inputmode="numeric"
               autocomplete="one-time-code" placeholder="邮件里的验证码">

        <label class="auth-label">新密码</label>
        <input id="af-pass" class="auth-input" type="password"
               autocomplete="new-password" placeholder="至少 6 位">
        ` : ''}

        ${tip}

        <button class="auth-btn" id="af-reset" ${(!resetSent || busy) ? 'disabled' : ''}>
          ${busy ? '处理中…' : '设置新密码'}
        </button>

        <div class="auth-links">
          <button class="auth-link" onclick="AuthUI.go('login')">返回登录</button>
        </div>
      </div>`;
      bindReset();
    }
  }

  function val(id) {
    const n = document.getElementById(id);
    return n ? n.value.trim() : '';
  }

  function guard() {
    if (busy) return true;
    return false;
  }

  function bindLogin() {
    const sub = document.getElementById('af-submit');
    if (sub) sub.onclick = doLogin;
    const pass = document.getElementById('af-pass');
    if (pass) pass.onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  }

  async function doLogin() {
    if (guard()) return;
    const email = val('af-email'), pass = val('af-pass');
    if (!email) return setMsg('先填邮箱', 'err');
    if (!pass) return setMsg('先填密码', 'err');
    busy = true; setMsg('');
    const r = await Cloud.signIn(email, pass);
    busy = false;
    if (!r.ok) return setMsg(r.msg, 'err');
    await onSignedIn();
  }

  function bindRegister() {
    const send = document.getElementById('af-send');
    if (send) send.onclick = doSendCode;
    const reg = document.getElementById('af-reg');
    if (reg) reg.onclick = doRegister;
  }

  async function doSendCode() {
    if (guard()) return;
    const email = val('af-email');
    if (!Cloud.isEmail(email)) return setMsg('邮箱格式不对', 'err');
    busy = true; setMsg('');
    const r = await Cloud.sendCode(email);
    busy = false;
    if (!r.ok) return setMsg(r.msg, 'err');
    codeSent = true;
    paint();
    setMsg(r.isExistingUser
      ? '这个邮箱注册过了。输入邮件里的验证码后，直接进。'
      : '验证码已发到邮箱，去收一下。', 'ok');
  }

  async function doRegister() {
    if (guard()) return;
    const email = val('af-email'), code = val('af-code'), pass = val('af-pass');
    if (!code) return setMsg('填一下验证码', 'err');
    if (!pass || pass.length < 6) return setMsg('密码至少 6 位', 'err');
    busy = true; setMsg('');
    const r = await Cloud.verifyAndSignUp(email, code, pass);
    busy = false;
    if (!r.ok) return setMsg(r.msg, 'err');
    await onSignedIn();
  }

  function bindReset() {
    const send = document.getElementById('af-send');
    if (send) send.onclick = doSendReset;
    const rs = document.getElementById('af-reset');
    if (rs) rs.onclick = doFinishReset;
  }

  async function doSendReset() {
    if (guard()) return;
    const email = val('af-email');
    if (!Cloud.isEmail(email)) return setMsg('邮箱格式不对', 'err');
    busy = true; setMsg('');
    const r = await Cloud.resetPassword(email);
    busy = false;
    if (!r.ok) return setMsg(r.msg, 'err');
    resetSent = true;
    paint();
    setMsg('重置验证码已发到邮箱。', 'ok');
  }

  async function doFinishReset() {
    if (guard()) return;
    const code = val('af-code'), pass = val('af-pass');
    if (!code) return setMsg('填一下验证码', 'err');
    if (!pass || pass.length < 6) return setMsg('新密码至少 6 位', 'err');
    busy = true; setMsg('');
    const r = await Cloud.finishReset(code, pass);
    busy = false;
    if (!r.ok) return setMsg(r.msg, 'err');
    mode = 'login';
    resetSent = false;
    paint();
    setMsg('密码已改，用新密码登录。', 'ok');
  }

  async function onSignedIn() {
    const g = el();
    if (g) g.classList.add('gone');
    try {
      await App.bootAfterAuth();
    } catch (e) {
      if (g) g.classList.remove('gone');
      setMsg('数据加载失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  function go(m) {
    mode = m;
    msg = '';
    codeSent = false;
    resetSent = false;
    busy = false;
    paint();
  }

  function show(text) {
    const g = el();
    if (!g) return;
    g.classList.remove('gone');
    document.body.classList.add('auth-locked');
    paint();
    if (text) setMsg(text, 'err');
  }

  function hide() {
    const g = el();
    if (g) g.classList.add('gone');
    document.body.classList.remove('auth-locked');
  }

  return { go, show, hide, paint, get mode() { return mode; } };
})();

window.AuthUI = AuthUI;
