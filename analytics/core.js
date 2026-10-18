/* Shared by the browser and Node tests. All times are real milliseconds, never simulation time. */
(function (root) {
  'use strict';
  const DAY = 86400000, OFFSET = 28800000, IDLE = 300000, LEASE = 90000;
  const dayKey = now => String(now - ((now + OFFSET) % DAY));
  class Tracker {
    constructor(kind, now, emit = () => {}) {
      this.kind = kind; this.emit = emit; this.records = {}; this.round = false;
      this.status = 'BRIEFING'; this.paused = true; this.visible = true;
      this.connected = false; this.lastInput = now; this.lastWall = now;
      this.roundMs = 0; this.generation = -1; this.previousActive = false;
      this.record(now).views = 1;
    }
    record(now) {
      const key = dayKey(now);
      return this.records[key] ||= { views: 0, site: true, game: this.kind === 'game', player: false, starts: 0, ends: 0, activeMs: 0 };
    }
    active(now) {
      return this.kind === 'game' && this.round && this.status === 'RUNNING' && !this.paused &&
        this.visible && this.connected && now - this.lastInput < IDLE;
    }
    tick(now) {
      const active = this.active(now);
      // A suspended process must never backfill hours of imaginary play.
      const elapsed = Math.max(0, Math.min(1500, now - this.lastWall));
      if (this.previousActive && active && elapsed) {
        let from = now - elapsed;
        while (from < now) {
          const until = Math.min(now, Number(dayKey(from)) + DAY);
          const r = this.record(from); r.player = true; r.activeMs += until - from;
          this.roundMs += until - from; from = until;
        }
      }
      if (this.visible) this.record(now);
      this.lastWall = now; this.previousActive = active;
    }
    environment(patch, now) {
      this.tick(now); Object.assign(this, patch); this.previousActive = this.active(now);
    }
    input(now) { this.environment({ lastInput: now }, now); }
    finish(reason, now) {
      if (!this.round) return;
      this.record(now).ends++; this.emit('game_end', { reason, active_seconds: Math.floor(this.roundMs / 1000) });
      this.round = false; this.roundMs = 0;
    }
    game(state, now) {
      this.tick(now);
      if (this.generation !== -1 && state.generation !== this.generation) this.finish('restart', now);
      this.generation = state.generation;
      if (['BRIEFING', 'VICTORY', 'GAMEOVER'].includes(state.status)) this.finish(state.status.toLowerCase(), now);
      this.status = state.status; this.paused = state.paused;
      if (!this.round && this.status === 'RUNNING' && !this.paused) {
        this.round = true; this.roundMs = 0; this.lastInput = now;
        const r = this.record(now); r.starts++; r.player = true;
        this.emit('game_start', { airport: state.airport, difficulty: state.difficulty });
      }
      this.previousActive = this.active(now);
    }
  }
  root.ATCAnalyticsCore = { Tracker, dayKey, DAY, OFFSET, IDLE, LEASE };
})(typeof globalThis === 'object' ? globalThis : window);
