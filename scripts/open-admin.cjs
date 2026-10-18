const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { inject, loadConfig } = require('./analytics-build.cjs');
const { createDataSource } = require('./admin-data.cjs');
const root = path.resolve(__dirname, '..'), port = Number(process.env.ATC_ADMIN_PORT || 4174), origin = `http://localhost:${port}`;
const version = 'spark-local-2';
const marker = crypto.createHash('sha256').update(root + version + port).digest('hex');
const sessionFile = path.join(os.tmpdir(), `atc-admin-${marker.slice(0, 16)}.json`);
const secret = () => crypto.randomBytes(32).toString('hex');
function equal(a, b) { const x = Buffer.from(a || ''), y = Buffer.from(b || ''); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function serve(dependencies = {}) {
  const sourceFactory = dependencies.createDataSource || createDataSource;
  const configLoader = dependencies.loadConfig || loadConfig;
  const control = secret(), sessions = new Map(), tickets = new Map(); let source, sourceKey;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host)) return json(403, { error: 'Invalid host' });
    const url = new URL(req.url, origin), route = url.pathname;
    for (const [key, expires] of sessions) if (expires < Date.now()) sessions.delete(key);
    for (const [key, expires] of tickets) if (expires < Date.now()) tickets.delete(key);
    if (route === '/__atc_admin_health') return json(200, { marker, version });
    if (route === '/__atc_admin_launch' && req.method === 'POST') {
      if (req.headers.origin || !equal(req.headers.authorization, 'Bearer ' + control)) return json(403, { error: 'Forbidden' });
      const ticket = secret(); tickets.set(ticket, Date.now() + 30000);
      return json(200, { url: origin + '/unlock?ticket=' + ticket });
    }
    if (route === '/unlock') {
      const ticket = url.searchParams.get('ticket');
      if (!tickets.has(ticket)) return json(401, { error: '入口已过期，请重新双击打开统计面板。' });
      tickets.delete(ticket); const session = secret(); sessions.set(session, Date.now() + 8 * 3600000);
      res.writeHead(303, { Location: '/admin/', 'Set-Cookie': `atc_admin=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` }); return res.end();
    }
    const cookie = /(?:^|;\s*)atc_admin=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const authorized = sessions.has(cookie);
    if (route === '/api/dashboard' || route === '/api/logout') {
      if (!authorized || (req.headers.origin && req.headers.origin !== origin) || !['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site'])) return json(401, { error: '请双击“打开统计面板.command”进入。' });
      if (route === '/api/logout' && req.method === 'POST') { sessions.delete(cookie); return json(200, { ok: true }); }
      if (route !== '/api/dashboard' || req.method !== 'GET') return json(405, { error: 'Method not allowed' });
      const days = Number(url.searchParams.get('days') || 30);
      if (!Number.isInteger(days) || days < 1 || days > 90) return json(400, { error: '日期范围须为 1–90 天。' });
      try {
        const config = configLoader(), key = JSON.stringify(config.firebase);
        if (sourceKey !== key) { source = sourceFactory(config); sourceKey = key; }
        return json(200, await source.dashboard(days));
      } catch (error) { console.error('[local dashboard]', error.message); return json(503, { error: '暂时无法连接 Firebase，请检查网络或本机 Firebase 登录。' }); }
    }
    if (route === '/' || route === '/admin/' || route === '/admin') {
      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ATC 统计面板</title><body style="font:18px system-ui;padding:40px"><h1>请双击“打开统计面板.command”</h1><p>入口会自动验证本机身份并打开面板，无需另行注册或填写账单。</p></body></html>');
      }
      try {
        let html = inject(fs.readFileSync(path.join(root, 'website/admin/index.html'), 'utf8'), 'admin');
        html = html.replace('</head>', '<script>window.ATC_LOCAL_DASHBOARD=true;</script></head>');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      } catch (error) { return json(503, { error: '配置文件有误，请联系维护者检查。' }); }
    }
    return json(404, { error: 'Not found' });
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => fs.writeFileSync(sessionFile, JSON.stringify({ control, pid: process.pid, marker }), { mode: 0o600 }));
  return server;
}
function request(route, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${route}`, { ...options, headers: { Host: `localhost:${port}`, ...options.headers }, timeout: 1500 }, res => {
      let data = ''; res.on('data', c => { if (data.length < 16384) data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid local service response')); } });
    }); req.on('timeout', () => req.destroy()); req.on('error', reject); req.end();
  });
}
async function probe() { try { return (await request('/__atc_admin_health')).marker === marker; } catch { return false; } }
function networkEnv() {
  const env = { ...process.env };
  if (process.platform === 'darwin' && !env.HTTPS_PROXY) {
    try {
      const proxy = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' });
      const host = /HTTPSProxy\s*:\s*(\S+)/.exec(proxy)?.[1], proxyPort = /HTTPSPort\s*:\s*(\d+)/.exec(proxy)?.[1];
      if (/HTTPSEnable\s*:\s*1/.test(proxy) && host && proxyPort) env.HTTPS_PROXY = env.HTTP_PROXY = `http://${host}:${proxyPort}`;
    } catch { /* Normal direct connection. */ }
  }
  return env;
}
async function open() {
  if (!await probe()) {
    // Replace only this workspace's previously authenticated launcher process.
    try {
      const old = await request('/__atc_admin_health');
      const oldMarker = crypto.createHash('sha256').update(root).digest('hex');
      if (old.marker === oldMarker) throw new Error('请先关闭旧版统计面板服务，再重新打开。');
    } catch (error) { if (error.message.includes('旧版')) throw error; }
    const log = fs.openSync(path.join(os.tmpdir(), `atc-admin-${marker.slice(0, 12)}.log`), 'a');
    const child = spawn(process.execPath, [__filename, '--serve'], { cwd: root, env: networkEnv(), detached: true, stdio: ['ignore', log, log] });
    child.unref(); fs.closeSync(log);
    for (let i = 0; i < 40 && !await probe(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!await probe()) throw new Error('面板启动失败，请检查本地端口 4174。');
  }
  const control = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).control;
  const { url } = await request('/__atc_admin_launch', { method: 'POST', headers: { Authorization: 'Bearer ' + control } });
  if (!url) throw new Error('无法验证本机身份，请重新启动面板。');
  if (process.argv.includes('--no-open')) console.log(url);
  else {
    if (process.platform === 'darwin') execFileSync('open', [url]);
    else if (process.platform === 'win32') spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    console.log('统计面板已打开。');
  }
}
if (require.main === module) {
  if (process.argv.includes('--serve')) serve();
  else open().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { serve, marker, sessionFile, port, equal };
