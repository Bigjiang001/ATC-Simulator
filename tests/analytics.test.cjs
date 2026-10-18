const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const context = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../analytics/core.js'), 'utf8'), context);
const { Tracker, dayKey, DAY, IDLE } = context.ATCAnalyticsCore;
const { mergeReport, onlineCount, authorize } = require('../firebase/functions/aggregate.cjs');
const base = Date.parse('2026-10-18T04:00:00Z');
const running = { status: 'RUNNING', paused: false, generation: 1, airport: 'ZSHB', difficulty: 'NORMAL' };
function game(now = base) {
  const events = [], t = new Tracker('game', now, (name, p) => events.push([name, p]));
  t.environment({ connected: true }, now); t.game(running, now);
  return { t, events };
}
test('website, lobby visitors, actual players and rounds have separate definitions', () => {
  const home = new Tracker('home', base), lobby = new Tracker('game', base);
  assert.equal(home.record(base).site, true); assert.equal(home.record(base).game, false);
  assert.equal(lobby.record(base).game, true); assert.equal(lobby.record(base).player, false);
  const { t, events } = game();
  t.game(running, base + 10); t.tick(base + 1000);
  assert.equal(t.record(base).starts, 1); assert.equal(t.record(base).player, true);
  assert.equal(events.filter(e => e[0] === 'game_start').length, 1);
});
test('real time excludes pause, hidden tab, disconnection and idle; resume is not a new round', () => {
  const { t } = game(); t.tick(base + 1000);
  let now = base + 1000;
  for (const patch of [{ paused: true }, { visible: false }, { connected: false }]) {
    t.environment(patch, now); now += 1000; t.tick(now);
    assert.equal(t.record(base).activeMs, 1000);
    t.environment({ paused: false, visible: true, connected: true }, now);
  }
  t.environment({ lastInput: base - IDLE }, now); t.tick(now + 1000);
  const before = t.record(base).activeMs; t.tick(base + IDLE * 10);
  assert.equal(t.record(base).activeMs, before);
  t.input(base + IDLE * 10); t.tick(base + IDLE * 10 + 1000);
  assert.equal(t.record(base).starts, 1); assert.equal(t.record(base).activeMs, before + 1000);
});
test('suspended timers cannot backfill hours; midnight splits active time and does not duplicate starts', () => {
  const midnight = Number(dayKey(base)) + DAY;
  const { t } = game(midnight - 500); t.tick(midnight + 500);
  assert.equal(t.record(midnight - 1).activeMs, 500); assert.equal(t.record(midnight).activeMs, 500);
  assert.equal(t.record(midnight).starts, 0); assert.equal(t.record(midnight).player, true);
  t.input(midnight + 1000); t.tick(midnight + 100000);
  assert(t.record(midnight).activeMs <= 3500);
});
test('restart, terminal states and exit end a round exactly once; pause never ends it', () => {
  const { t, events } = game();
  t.game({ ...running, status: 'PAUSED', paused: true }, base + 1000);
  assert.equal(t.record(base).ends, 0);
  t.game({ ...running, generation: 2 }, base + 2000);
  assert.equal(t.record(base).starts, 2); assert.equal(t.record(base).ends, 1);
  t.game({ ...running, generation: 2, status: 'GAMEOVER' }, base + 3000);
  t.finish('pagehide', base + 4000);
  assert.equal(t.record(base).ends, 2);
  assert.equal(events.filter(e => e[0] === 'game_end').length, 2);
});
test('aggregates deduplicate UID visits across tabs, tolerate duplicate and reordered deliveries', () => {
  const a = { site: true, game: true, player: true, starts: 1, ends: 0, activeMs: 30000 };
  let report = mergeReport(null, 'alice', 'tabA', a);
  report = mergeReport(report, 'alice', 'tabA', a);
  report = mergeReport(report, 'alice', 'tabA', { ...a, activeMs: 1000 });
  report = mergeReport(report, 'alice', 'tabB', a);
  report = mergeReport(report, 'bob', 'tabC', { ...a, player: false, starts: 0, activeMs: 0 });
  assert.deepEqual(report.summary, { views: 0, visitors: 2, gameVisitors: 2, players: 1, starts: 2, ends: 0, activeMs: 60000 });
});
test('presence counts unique active identities with a lease, ignoring stale/future entries', () => {
  assert.equal(onlineCount({ a: { uid: 'a', active: true, lastSeen: base },
    b: { uid: 'a', active: true, lastSeen: base - 10 },
    c: { uid: 'b', active: true, lastSeen: base - 90001 },
    d: { uid: 'c', active: false, lastSeen: base },
    e: { uid: 'd', active: true, lastSeen: base + 5001 } }, base), 1);
});
test('server requires an admin claim and rejects anonymous admin identities', () => {
  assert.equal(authorize(null), false); assert.equal(authorize({ token: {} }), false);
  assert.equal(authorize({ token: { admin: true, firebase: { sign_in_provider: 'anonymous' } } }), false);
  assert.equal(authorize({ token: { admin: true, firebase: { sign_in_provider: 'google.com' } } }), true);
});
test('build config defaults to disabled and rejects credentials, invalid config and duplicate injection', () => {
  const { loadConfig, inject } = require('../scripts/analytics-build.cjs');
  const saved = process.env.ATC_ANALYTICS_CONFIG_JSON;
  process.env.ATC_ANALYTICS_CONFIG_JSON = JSON.stringify({ enabled: false });
  assert.equal(loadConfig().enabled, false);
  process.env.ATC_ANALYTICS_CONFIG_JSON = JSON.stringify({ enabled: false, private_key: 'never publish' });
  assert.throws(loadConfig, /Unknown/);
  process.env.ATC_ANALYTICS_CONFIG_JSON = JSON.stringify({ enabled: true, firebase: {} });
  assert.throws(loadConfig, /Missing Firebase/);
  process.env.ATC_ANALYTICS_CONFIG_JSON = JSON.stringify({ enabled: false });
  const html = inject('<html><head></head></html>', 'game');
  assert.match(html, /atc-page/); assert.match(html, /onDisconnect/);
  assert.throws(() => inject(html, 'game'), /twice/);
  if (saved === undefined) delete process.env.ATC_ANALYTICS_CONFIG_JSON;
  else process.env.ATC_ANALYTICS_CONFIG_JSON = saved;
});
test('both build paths keep telemetry, admin and project-relative game deployment intact', () => {
  const root = path.join(__dirname, '..');
  for (const file of ['dist/index.html', 'dist/game/index.html', 'dist/admin/index.html', 'online/dist/index.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal((html.match(/<meta name="atc-page"/g) || []).length, 1, file);
    assert.match(html, /ATC_ANALYTICS_CONFIG/);
  }
  assert.match(fs.readFileSync(path.join(root, 'dist/game/index.html'), 'utf8'), /atc:state/);
  assert.match(fs.readFileSync(path.join(root, 'dist/admin/index.html'), 'utf8'), /httpsCallable/);
});
