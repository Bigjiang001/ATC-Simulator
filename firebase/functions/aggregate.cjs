'use strict';
const DAY = 86400000, OFFSET = 28800000, LEASE = 90000;
const dayKey = now => String(now - ((now + OFFSET) % DAY));
const empty = () => ({ views: 0, visitors: 0, gameVisitors: 0, players: 0, starts: 0, ends: 0, activeMs: 0 });
function mergeReport(report, uid, tab, incoming) {
  report ||= { summary: empty(), users: {} };
  report.users ||= {}; report.summary = { ...empty(), ...report.summary };
  const user = report.users[uid] ||= { tabs: {}, site: false, game: false, player: false };
  const previous = user.tabs[tab] || { starts: 0, ends: 0, activeMs: 0 };
  // Monotonic cumulative values make duplicate delivery and reverse trigger order harmless.
  const next = {};
  for (const key of ['views', 'starts', 'ends', 'activeMs']) {
    next[key] = Math.max(previous[key] || 0, incoming[key] || 0);
    report.summary[key] += next[key] - (previous[key] || 0);
  }
  for (const [key, counter] of [['site', 'visitors'], ['game', 'gameVisitors'], ['player', 'players']]) {
    if (incoming[key] && !user[key]) { user[key] = true; report.summary[counter]++; }
  }
  user.tabs[tab] = next;
  return report;
}
function onlineCount(records, now) {
  return new Set(Object.values(records || {}).filter(p => p.active === true &&
    p.lastSeen >= now - LEASE && p.lastSeen <= now + 5000).map(p => p.uid)).size;
}
function authorize(auth) {
  return !!auth && auth.token.admin === true && auth.token.firebase?.sign_in_provider !== 'anonymous';
}
module.exports = { mergeReport, onlineCount, authorize, dayKey, empty, DAY };
