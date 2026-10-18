// Trusted local backend. Raw UID/tab records stay in this process, never in browser responses.
const path = require('node:path');
const { DAY, dayKey, empty, mergeReport, onlineCount } = require('../firebase/functions/aggregate.cjs');
function summarize(activity, days, now) {
  const today = Number(dayKey(now)), history = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = today - i * DAY;
    let report = null;
    for (const [uid, tabs] of Object.entries(activity?.[day] || {}))
      for (const [tab, record] of Object.entries(tabs || {})) report = mergeReport(report, uid, tab, record);
    history.push({ day, ...(report?.summary || empty()) });
  }
  return history;
}
function createDataSource(config) {
  const cliRoot = path.dirname(require.resolve('../tests/firebase/node_modules/firebase-tools/package.json'));
  const auth = require(path.join(cliRoot, 'lib/auth'));
  const { requireAuth } = require(path.join(cliRoot, 'lib/requireAuth'));
  const { Client } = require(path.join(cliRoot, 'lib/apiv2'));
  const client = new Client({ urlPrefix: config.firebase.databaseURL.replace(/\/$/, '') });
  let cachedHistory, historyAt = 0, historyDays = 0, inFlight;
  async function dashboard(days) {
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Invalid history range');
    // A CLI account with project permissions is the server identity, backed by Google's OAuth.
    const account = auth.getGlobalDefaultAccount();
    if (!account) throw new Error('本机 Firebase 登录已失效，请重新运行 Firebase CLI 登录。');
    const options = { project: config.firebase.projectId, nonInteractive: true };
    auth.setActiveAccount(options, account); await requireAuth(options);
    const now = Date.now();
    const read = async (node, queryParams) => (await client.get('/' + node + '.json', {
      queryParams, timeout: 20000, skipLog: { body: true, responseBody: true }
    })).body;
    const [presence, activity] = await Promise.all([
      read('presence', { orderBy: '"lastSeen"', startAt: now - 90000 }),
      cachedHistory && historyDays === days && now - historyAt < 30000 ? null :
        read('activity', { orderBy: '"$key"', startAt: JSON.stringify(String(Number(dayKey(now)) - (days - 1) * DAY)), endAt: JSON.stringify(dayKey(now)) })
    ]);
    if (activity !== null || !cachedHistory || historyDays !== days || now - historyAt >= 30000) {
      cachedHistory = summarize(activity, days, now); historyAt = now; historyDays = days;
    }
    return { generatedAt: now, timezone: 'Asia/Shanghai', online: onlineCount(presence, now),
      history: cachedHistory, source: 'Firebase Realtime Database', mode: 'local',
      hasRecords: cachedHistory.some(d => d.visitors > 0), historyUpdatedAt: historyAt };
  }
  return { dashboard(days) {
    if (inFlight && historyDays === days) return inFlight;
    const promise = dashboard(days); inFlight = promise;
    promise.finally(() => { if (inFlight === promise) inFlight = null; }).catch(() => {});
    return promise;
  } };
}
module.exports = { summarize, createDataSource };
