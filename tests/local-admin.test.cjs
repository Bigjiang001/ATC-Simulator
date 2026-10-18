const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs');
process.env.ATC_ADMIN_PORT = '18835';
const { serve, sessionFile } = require('../scripts/open-admin.cjs');
const { summarize } = require('../scripts/admin-data.cjs');
const { dayKey, DAY } = require('../firebase/functions/aggregate.cjs');
let server, control, cookie, reads = 0;
const base = 'http://127.0.0.1:18835';
const request = (route, options = {}) => new Promise((resolve, reject) => {
  const req = require('node:http').request(base + route, { ...options, headers: { Host: 'localhost:18835', ...options.headers } }, res => {
    let body = ''; res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: { get: key => res.headers[key]?.toString() }, json: async () => JSON.parse(body) }));
  });
  req.on('error', reject); req.end();
});
before(async () => {
  server = serve({ loadConfig: () => ({ firebase: { projectId: 'test' } }), createDataSource: () => ({ dashboard: async days => { reads++; return { online: 2, history: Array.from({length: days}, () => ({ visitors: 1 })), source: 'test' }; } }) });
  await new Promise(resolve => server.on('listening', resolve));
  control = JSON.parse(fs.readFileSync(sessionFile, 'utf8')).control;
});
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(sessionFile, { force: true }); });
test('raw per-UID activity becomes aggregate-only history, with PV and cross-tab UV deduplication', () => {
  const now = Date.now(), day = dayKey(now), r = { views: 1, site: true, game: true, player: true, starts: 1, ends: 0, activeMs: 30000 };
  const history = summarize({ [day]: { secretUID: { tab1: r, tab2: r } } }, 7, now);
  assert.equal(history.length, 7); assert.equal(history.at(-1).views, 2); assert.equal(history.at(-1).visitors, 1);
  assert.equal(history.at(-1).players, 1); assert.equal(history.at(-1).starts, 2); assert.equal(history.at(-1).activeMs, 60000);
  assert.equal(JSON.stringify(history).includes('secretUID'), false);
  assert.equal(history[0].day, Number(day) - 6 * DAY);
});
test('only a one-time launcher ticket can open an HttpOnly local administrator session', async () => {
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/__atc_admin_launch', { method: 'POST' })).status, 403);
  const response = await request('/__atc_admin_launch', { method: 'POST', headers: { Authorization: 'Bearer ' + control } });
  const { url } = await response.json();
  const route = new URL(url).pathname + new URL(url).search;
  const unlock = await request(route);
  assert.equal(unlock.status, 303);
  const setCookie = unlock.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(';')[0];
  assert.equal((await request(route)).status, 401, 'ticket cannot be replayed');
  assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
});
test('local API protects against cross-origin requests, invalid host, invalid date range and file traversal', async () => {
  const headers = { Cookie: cookie };
  assert.equal((await request('/api/dashboard?days=7', { headers: { ...headers, Origin: 'https://example.com' } })).status, 401);
  assert.equal((await request('/api/dashboard?days=7', { headers: { ...headers, Host: 'example.com' } })).status, 403);
  assert.equal((await request('/api/dashboard?days=999', { headers })).status, 400);
  assert.equal((await request('/analytics/config.local.json', { headers })).status, 404);
  const result = await request('/api/dashboard?days=7', { headers }); assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(await result.json()).sort(), ['history', 'online', 'source']); assert.equal(reads, 1);
});
test('locking the dashboard invalidates its current session', async () => {
  assert.equal((await request('/api/logout', { method: 'POST', headers: { Cookie: cookie } })).status, 200);
  assert.equal((await request('/api/dashboard', { headers: { Cookie: cookie } })).status, 401);
});
