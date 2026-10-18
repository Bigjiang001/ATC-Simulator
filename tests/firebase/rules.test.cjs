const { test, before, after } = require('node:test');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, set, get, remove } = require('firebase/database');
let env;
const tab = '12345678-1234-4234-8234-123456789abc';
const now = Date.now(), day = String(now - ((now + 28800000) % 86400000));
const activity = { site: true, game: true, player: true, starts: 1, ends: 0, activeMs: 1000, updatedAt: now };
const anonymous = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).database();
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-atc-statistics', database: {
    host: '127.0.0.1', port: 9000, rules: fs.readFileSync('../../firebase/database.rules.json', 'utf8') } });
});
after(async () => { await env?.cleanup(); });
test('anonymous identity may write own valid activity only; nobody can read the activity root', async () => {
  const alice = anonymous('alice'), bob = anonymous('bob');
  await assertSucceeds(set(ref(alice, `activity/${day}/alice/${tab}`), activity));
  await assertSucceeds(get(ref(alice, `activity/${day}/alice/${tab}`)));
  await assertFails(set(ref(bob, `activity/${day}/alice/${tab}`), activity));
  await assertFails(get(ref(bob, `activity/${day}/alice/${tab}`)));
  await assertFails(get(ref(alice, 'activity')));
  await assertFails(remove(ref(alice, `activity/${day}/alice/${tab}`)));
  await assertFails(set(ref(alice, `activity/${day}/alice/${tab}`), { ...activity, activeMs: -1 }));
  await assertFails(set(ref(alice, `activity/${day}/alice/${tab}`), { ...activity, email: 'no personal fields' }));
  await assertFails(set(ref(alice, `activity/${day}/alice/__proto__`), activity));
  await assertFails(set(ref(alice, `activity/9999999999999/alice/${tab}`), activity));
  await assertFails(set(ref(alice, `activity/${day}/alice/${tab}`), { ...activity, activeMs: 86400001 }));
});
test('unauthenticated and non-anonymous clients cannot submit telemetry', async () => {
  await assertFails(set(ref(env.unauthenticatedContext().database(), `activity/${day}/guest/${tab}`), activity));
  const admin = env.authenticatedContext('admin', { admin: true, firebase: { sign_in_provider: 'google.com' } }).database();
  await assertFails(set(ref(admin, `activity/${day}/admin/${tab}`), activity));
  await assertFails(get(ref(admin, 'activity')));
  await assertFails(get(ref(admin, 'reports')));
  await assertFails(set(ref(anonymous('alice'), `reports/${day}/summary`), { players: 999 }));
});
test('presence ownership, schema and time are enforced; own disconnect deletion is allowed', async () => {
  const alice = anonymous('alice'), bob = anonymous('bob'), p = ref(alice, `presence/${tab}`);
  await assertSucceeds(set(p, { uid: 'alice', active: true, lastSeen: Date.now() }));
  await assertFails(set(ref(bob, `presence/${tab}`), { uid: 'bob', active: true, lastSeen: Date.now() }));
  await assertFails(remove(ref(bob, `presence/${tab}`)));
  await assertFails(get(ref(alice, 'presence')));
  await assertFails(set(p, { uid: 'alice', active: true, lastSeen: Date.now() + 60000 }));
  await assertFails(set(p, { uid: 'alice', active: true, lastSeen: Date.now() - 100000 }));
  await assertSucceeds(remove(p));
});
