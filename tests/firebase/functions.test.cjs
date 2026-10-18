const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously, signInWithCustomToken } = require('firebase/auth');
const { getDatabase, connectDatabaseEmulator, ref, set, goOffline, onDisconnect } = require('firebase/database');
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require('firebase/functions');
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const admin = require('../../firebase/functions/node_modules/firebase-admin');
const projectId = 'demo-atc-statistics';
let app, auth, db, dashboard, adminApp, testEnv, adminClientApp;
const now = Date.now(), day = String(now - ((now + 28800000) % 86400000));
before(async () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
  testEnv = await initializeTestEnvironment({ projectId, database: { host: '127.0.0.1', port: 9000, rules: fs.readFileSync('../../firebase/database.rules.json', 'utf8') } });
  adminApp = admin.initializeApp({ projectId, databaseURL: `http://127.0.0.1:9000/?ns=${projectId}` }, 'integration-admin');
  await adminApp.database().ref().set(null);
  app = initializeApp({ projectId, apiKey: 'demo-key', databaseURL: `https://${projectId}.firebaseio.com` }, 'integration-client');
  auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  db = getDatabase(app); connectDatabaseEmulator(db, '127.0.0.1', 9000);
  const functions = getFunctions(app, 'us-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  dashboard = httpsCallable(functions, 'dashboard');
});
after(async () => { goOffline(db); adminApp.database().goOffline(); await deleteApp(app); if (adminClientApp) await deleteApp(adminClientApp); await adminApp.delete(); await testEnv.cleanup(); });
test('trusted aggregation, aggregate-only dashboard, authentication, bounds and immediate revocation', async () => {
  await assert.rejects(dashboard({ days: 7 }), /Administrator/);
  const { user } = await signInAnonymously(auth);
  await assert.rejects(dashboard({ days: 7 }), /Administrator/);
  const tab1 = '11111111-1111-4111-8111-111111111111', tab2 = '22222222-2222-4222-8222-222222222222';
  const value = { site: true, game: true, player: true, starts: 1, ends: 0, activeMs: 1000, updatedAt: Date.now() };
  await set(ref(db, `activity/${day}/${user.uid}/${tab1}`), value);
  await set(ref(db, `activity/${day}/${user.uid}/${tab2}`), value);
  await onDisconnect(ref(db, `presence/${tab1}`)).remove();
  await onDisconnect(ref(db, `presence/${tab2}`)).remove();
  await set(ref(db, `presence/${tab1}`), { uid: user.uid, active: true, lastSeen: Date.now() });
  await set(ref(db, `presence/${tab2}`), { uid: user.uid, active: true, lastSeen: Date.now() });
  const deadline = Date.now() + 15000;
  let summary;
  while (Date.now() < deadline) {
    summary = (await adminApp.database().ref(`reports/${day}/summary`).get()).val();
    if (summary?.starts === 2) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.deepEqual(summary, { views: 0, visitors: 1, gameVisitors: 1, players: 1, starts: 2, ends: 0, activeMs: 2000 });
  await adminApp.auth().createUser({ uid: 'test-admin' });
  await adminApp.auth().setCustomUserClaims('test-admin', { admin: true });
  const token = await adminApp.auth().createCustomToken('test-admin');
  adminClientApp = initializeApp({ projectId, apiKey: 'demo-key' }, 'separate-admin-client');
  const adminAuth = getAuth(adminClientApp); connectAuthEmulator(adminAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInWithCustomToken(adminAuth, token);
  const adminFunctions = getFunctions(adminClientApp, 'us-central1'); connectFunctionsEmulator(adminFunctions, '127.0.0.1', 5001);
  dashboard = httpsCallable(adminFunctions, 'dashboard');
  const { data } = await dashboard({ days: 7 });
  assert.equal(data.online, 1); assert.equal(data.history.length, 7);
  assert.equal(data.history.at(-1).visitors, 1);
  assert.equal(JSON.stringify(data).includes(user.uid), false);
  assert.equal(JSON.stringify(data).includes('users'), false);
  await assert.rejects(dashboard({ days: 91 }), /days/);
  goOffline(db);
  const disconnectDeadline = Date.now() + 5000;
  while ((await adminApp.database().ref('presence').get()).exists() && Date.now() < disconnectDeadline)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await dashboard({ days: 7 })).data.online, 0, 'actual socket disconnect removes both tabs');
  await adminApp.auth().setCustomUserClaims('test-admin', {});
  // Deliberately keep the old client ID token with admin=true: the server must still reject it.
  await assert.rejects(dashboard({ days: 7 }), /revoked/);
});
