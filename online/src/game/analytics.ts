// Emit lifecycle metadata only. No dependency on a network SDK, and no effect on simulation state.
let generation = 0;
export function markAnalyticsRound<T>(state: T): T {
  generation++;
  return state;
}
let previous = '';
export function reportAnalyticsState(state: {
  status: string; isPaused: boolean; showPreGameLobby: boolean;
  settings: { airportId: string }; difficulty: string;
}): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const detail = { generation, status: state.showPreGameLobby ? 'BRIEFING' : state.status,
    paused: state.isPaused, airport: state.settings.airportId, difficulty: state.difficulty };
  const key = JSON.stringify(detail);
  if (key === previous) return;
  previous = key;
  (window as Window & { __ATC_GAME_STATE__?: typeof detail }).__ATC_GAME_STATE__ = detail;
  try { window.dispatchEvent(new CustomEvent('atc:state', { detail })); } catch { /* Optional telemetry. */ }
}
