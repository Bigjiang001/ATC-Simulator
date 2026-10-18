'use strict';
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { mergeReport, onlineCount, authorize, dayKey, empty, DAY } = require('./aggregate.cjs');
initializeApp();
setGlobalOptions({ region: process.env.FUNCTIONS_EMULATOR === 'true' ? 'us-central1' : (process.env.STATISTICS_REGION || 'asia-southeast1'), maxInstances: 2, minInstances: 0 });
exports.aggregateActivity = onValueWritten({ ref: '/activity/{day}/{uid}/{tab}', retry: true }, async event => {
  const value = event.data.after.val();
  if (!value) return;
  // Old events must not recreate identity maps after retention cleanup.
  if (Number(event.params.day) < Number(dayKey(Date.now())) - 34 * DAY) return;
  await getDatabase().ref('reports/' + event.params.day).transaction(report =>
    mergeReport(report, event.params.uid, event.params.tab, value));
});
exports.dashboard = onCall({ enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true' }, async request => {
  if (!authorize(request.auth)) throw new HttpsError('permission-denied', 'Administrator access required');
  // Check current account state too: removed claims/disabled accounts take effect without waiting for token expiry.
  const account = await getAuth().getUser(request.auth.uid);
  if (account.disabled || account.customClaims?.admin !== true) throw new HttpsError('permission-denied', 'Administrator access revoked');
  const days = request.data?.days ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new HttpsError('invalid-argument', 'days must be 1–90');
  const now = Date.now(), today = Number(dayKey(now)), db = getDatabase();
  const [live, history] = await Promise.all([
    db.ref('presence').orderByChild('lastSeen').startAt(now - 90000).get(),
    Promise.all(Array.from({ length: days }, async (_, i) => {
      const day = today - (days - 1 - i) * DAY;
      return { day, ...(await db.ref(`reports/${day}/summary`).get()).val() || empty() };
    }))
  ]);
  // No UIDs, per-tab records, IPs or identity maps cross this boundary.
  return { generatedAt: now, timezone: 'Asia/Shanghai', online: onlineCount(live.val(), now), history };
});
exports.cleanupStatistics = onSchedule({ schedule: 'every day 03:20', timeZone: 'Asia/Shanghai' }, async () => {
  const db = getDatabase(), today = Number(dayKey(Date.now())), patch = {};
  const old = await db.ref('activity').orderByKey().endAt(String(today - 35 * DAY)).get();
  old.forEach(day => { patch['activity/' + day.key] = null; patch[`reports/${day.key}/users`] = null; });
  const stale = await db.ref('presence').orderByChild('lastSeen').endAt(Date.now() - DAY).get();
  stale.forEach(tab => { patch['presence/' + tab.key] = null; });
  if (Object.keys(patch).length) await db.ref().update(patch);
});
