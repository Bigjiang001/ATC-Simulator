(async function () {
  const $ = id => document.getElementById(id), config = window.ATC_ANALYTICS_CONFIG;
  const status = $('status'), login = $('login'), logout = $('logout'), refresh = $('refresh'), panel = $('panel');
  const local = window.ATC_LOCAL_DASHBOARD === true;
  let allowed = false, pending = false, requestDashboard, currentData, auth;
  const number = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const date = day => new Date(day + 28800000).toISOString().slice(0, 10);
  function clear() { allowed = false; panel.hidden = true; $('rows').replaceChildren(); }
  function chart() {
    if (!currentData) return;
    const metric = $('metric').value;
    const names = { views: '页面浏览量', visitors: '网站访客', players: '实际玩家', starts: '游戏开局数', activeMs: '有效游玩时长（分钟）' };
    $('chart-title').textContent = names[metric] + '趋势';
    const values = currentData.history.map(d => metric === 'activeMs' ? d.activeMs / 60000 : d[metric] || 0);
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 240'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', names[metric] + '历史趋势，详细数值见下方表格');
    const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = text; svg.appendChild(n); return n; };
    const max = Math.max(1, ...values), left = 65, width = 910, height = 165;
    for (let i = 0; i <= 4; i++) {
      const y = 20 + i * height / 4;
      add('line', { x1: left, x2: left + width, y1: y, y2: y, stroke: '#263b50', 'stroke-dasharray': '4 5' });
      add('text', { x: left - 10, y: y + 4, fill: '#93a9be', 'text-anchor': 'end', 'font-size': 12 }, number(max * (1 - i / 4)));
    }
    const points = values.map((v, i) => [left + i * width / Math.max(1, values.length - 1), 20 + height - v / max * height]);
    if (points.length) {
      add('polygon', { points: `${left},185 ${points.map(p => p.join(',')).join(' ')} ${points.at(-1)[0]},185`, fill: '#5de0c3', opacity: '.09' });
      add('polyline', { points: points.map(p => p.join(',')).join(' '), fill: 'none', stroke: '#5de0c3', 'stroke-width': 3 });
      points.forEach((p, i) => {
        const circle = add('circle', { cx: p[0], cy: p[1], r: 3.5, fill: '#7be8d0' });
        const title = document.createElementNS(ns, 'title'); title.textContent = date(currentData.history[i].day) + ' · ' + number(values[i]); circle.appendChild(title);
      });
      for (const index of [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])])
        add('text', { x: points[index][0], y: 218, fill: '#93a9be', 'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', 'font-size': 12 }, date(currentData.history[index].day));
    }
    $('chart').replaceChildren(svg);
  }
  function render(data) {
    currentData = data;
    const today = data.history.at(-1);
    for (const [id, value] of Object.entries({ views: today.views, visitors: today.visitors, gameVisitors: today.gameVisitors,
      players: today.players, online: data.online, starts: today.starts, duration: today.activeMs / 60000 })) $(id).textContent = number(value);
    const totals = data.history.reduce((a, d) => ({ views: a.views + (d.views || 0), starts: a.starts + d.starts, minutes: a.minutes + d.activeMs / 60000 }), { views: 0, starts: 0, minutes: 0 });
    $('range-summary').textContent = `所选时段：浏览 ${number(totals.views)} 次 · 开局 ${number(totals.starts)} 局 · 有效游玩 ${number(totals.minutes)} 分钟`;
    const rows = $('rows'); rows.replaceChildren();
    for (const d of [...data.history].reverse()) {
      const tr = document.createElement('tr');
      for (const value of [date(d.day), d.views || 0, d.visitors, d.gameVisitors, d.players, d.starts, (d.activeMs / 60000).toFixed(1)]) {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      }
      rows.appendChild(tr);
    }
    chart(); panel.hidden = false;
    $('empty').hidden = data.hasRecords !== false;
    $('connection').textContent = '● Firebase 已连接';
    status.textContent = '更新于 ' + new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' · 北京时间 · 每 15 秒自动刷新';
  }
  async function load() {
    if (!allowed || pending || !requestDashboard) return;
    pending = true; refresh.disabled = true; const uid = auth?.currentUser?.uid;
    try {
      const data = await requestDashboard(Number($('days').value));
      if (!allowed || (auth && auth.currentUser?.uid !== uid)) return;
      render(data);
    } catch (error) {
      $('connection').textContent = '● 连接中断';
      if (error.code === 'functions/permission-denied' || error.code === 'functions/unauthenticated') clear();
      status.textContent = '读取失败：' + (error.message || error.code) + '。正在等待重试。';
    } finally { pending = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', () => void load());
  $('days').addEventListener('change', () => void load());
  $('metric').addEventListener('change', chart);
  setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
  if (!config?.enabled) { login.hidden = true; status.textContent = '统计尚未启用。'; return; }
  if (local) {
    login.hidden = true; logout.hidden = false; logout.textContent = '锁定面板';
    allowed = true;
    $('mode').textContent = '本机安全访问 · Spark 免费方案 · 仅展示汇总';
    requestDashboard = async days => {
      const response = await fetch('/api/dashboard?days=' + days, { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '数据暂不可用');
      return body;
    };
    logout.addEventListener('click', async () => { clear(); await fetch('/api/logout', { method: 'POST' }); location.reload(); });
    await load(); return;
  }
  if (config.dashboardMode === 'local') {
    login.hidden = true;
    status.textContent = '本项目使用免绑卡的本机统计面板。请在管理员电脑中双击“打开统计面板.command”，即可查看访问量、实时玩家、游玩时长和图表。';
    return;
  }
  try {
    const base = 'https://www.gstatic.com/firebasejs/12.4.0/';
    const [a, authSDK, f] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-functions.js')]);
    const app = a.initializeApp(config.firebase, 'atc-admin');
    if (config.appCheckSiteKey) {
      const ac = await import(base + 'firebase-app-check.js');
      ac.initializeAppCheck(app, { provider: new ac.ReCaptchaV3Provider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }
    auth = authSDK.getAuth(app); await authSDK.setPersistence(auth, authSDK.browserSessionPersistence);
    const dashboard = f.httpsCallable(f.getFunctions(app, config.functionsRegion), 'dashboard');
    requestDashboard = async days => (await dashboard({ days })).data;
    login.addEventListener('click', async () => {
      try { await authSDK.signInWithPopup(auth, new authSDK.GoogleAuthProvider()); }
      catch (error) { status.textContent = '登录失败：' + (error.code || error.message); }
    });
    logout.addEventListener('click', async () => { clear(); await authSDK.signOut(auth); });
    authSDK.onAuthStateChanged(auth, async user => {
      clear(); logout.hidden = !user; login.hidden = !!user;
      if (!user) { status.textContent = '请使用获授权的 Google 管理员账号登录。'; return; }
      const uid = user.uid;
      try {
        const token = await user.getIdTokenResult(true);
        if (auth.currentUser?.uid !== uid) return;
        allowed = token.claims.admin === true && !user.isAnonymous;
        if (!allowed) { status.textContent = '此账号没有管理员权限。'; return; }
        await load();
      } catch (error) { status.textContent = '认证失败：' + (error.code || error.message); }
    });
  } catch (error) { status.textContent = '统计服务加载失败：' + (error.code || error.message); }
})();
