(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ShoalEngine = api.ShoalEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RANKS = ['DRIFT', 'GLINT', 'CURRENT', 'DEEPWATER', 'MOONPEARL'];
  const DIRS = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1];
  const STEP = 1000 / 60;

  function hashText(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
    return h >>> 0;
  }
  function rngFor(text) {
    let s = hashText(text) || 0x9e3779b9;
    return function () {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function neighbors(i, w, h) {
    const x = i % w, y = (i / w) | 0, out = [];
    for (let d = 0; d < DIRS.length; d += 2) {
      const nx = x + DIRS[d], ny = y + DIRS[d + 1];
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
    return out;
  }
  function countsFor(mines, w, h) {
    const c = new Uint8Array(w * h);
    for (let i = 0; i < c.length; i++) if (!mines[i]) {
      for (const n of neighbors(i, w, h)) c[i] += mines[n] ? 1 : 0;
    }
    return c;
  }
  function flood(open, start, mines, counts, w, h, blocked) {
    const queue = [start]; let q = 0;
    while (q < queue.length) {
      const i = queue[q++];
      if (open[i] || mines[i] || (blocked && blocked[i])) continue;
      open[i] = 1;
      if (counts[i] === 0) for (const n of neighbors(i, w, h)) {
        if (!open[n] && !mines[n] && !(blocked && blocked[n])) queue.push(n);
      }
    }
  }
  function logicSolves(mines, counts, first, w, h, total) {
    const open = new Uint8Array(w * h), known = new Uint8Array(w * h);
    flood(open, first, mines, counts, w, h);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < open.length; i++) if (open[i]) {
        const ns = neighbors(i, w, h);
        let flags = 0; const unknown = [];
        for (const n of ns) known[n] ? flags++ : (!open[n] && unknown.push(n));
        if (unknown.length && counts[i] - flags === unknown.length) {
          for (const n of unknown) if (!known[n]) { known[n] = 1; changed = true; }
        }
        if (unknown.length && flags === counts[i]) {
          for (const n of unknown) if (!mines[n] && !open[n]) { flood(open, n, mines, counts, w, h); changed = true; }
        }
      }
      let knownCount = 0; for (const v of known) knownCount += v;
      if (knownCount === total) {
        for (let i = 0; i < open.length; i++) if (!known[i] && !open[i] && !mines[i]) { flood(open, i, mines, counts, w, h); changed = true; }
      }
    }
    for (let i = 0; i < open.length; i++) if (!mines[i] && !open[i]) return false;
    return true;
  }
  function poolSpec(pool) {
    if (pool === 1) return { w: 5, h: 6, mines: 5, tide: 95 };
    if (pool === 2) return { w: 6, h: 7, mines: 8, tide: 125 };
    if (pool === 3) return { w: 7, h: 8, mines: 11, tide: 155 };
    if (pool === 4) return { w: 8, h: 9, mines: 15, tide: 190 };
    return { w: 8, h: 10, mines: Math.min(25, 16 + pool), tide: Math.min(260, 185 + pool * 12) };
  }
  function generate(seed, pool, first, spec) {
    const size = spec.w * spec.h;
    const forbidden = new Uint8Array(size); forbidden[first] = 1;
    for (const n of neighbors(first, spec.w, spec.h)) forbidden[n] = 1;
    const available = []; for (let i = 0; i < size; i++) if (!forbidden[i]) available.push(i);
    for (let attempt = 0; attempt < 1800; attempt++) {
      const random = rngFor(seed + '|' + pool + '|' + first + '|' + attempt);
      const bag = available.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = (random() * (i + 1)) | 0; const t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
      const mines = new Uint8Array(size);
      for (let i = 0; i < spec.mines; i++) mines[bag[i]] = 1;
      const counts = countsFor(mines, spec.w, spec.h);
      const initial = new Uint8Array(size); flood(initial, first, mines, counts, spec.w, spec.h);
      let initialOpened = 0; for (const v of initial) initialOpened += v;
      if (initialOpened < size - spec.mines && logicSolves(mines, counts, first, spec.w, spec.h, spec.mines)) return { mines, counts };
    }
    // Deterministic fallback: clustered far-edge urchins; validation still gates the layout.
    for (let shift = 0; shift < available.length; shift++) {
      const mines = new Uint8Array(size);
      const sorted = available.slice().sort((a, b) => {
        const ax = a % spec.w, ay = (a / spec.w) | 0, bx = b % spec.w, by = (b / spec.w) | 0;
        const fx = first % spec.w, fy = (first / spec.w) | 0;
        return (Math.abs(bx-fx)+Math.abs(by-fy)) - (Math.abs(ax-fx)+Math.abs(ay-fy)) || a-b;
      });
      for (let i = 0; i < spec.mines; i++) mines[sorted[(i + shift) % sorted.length]] = 1;
      const counts = countsFor(mines, spec.w, spec.h);
      const initial = new Uint8Array(size); flood(initial, first, mines, counts, spec.w, spec.h);
      let initialOpened = 0; for (const v of initial) initialOpened += v;
      if (initialOpened < size - spec.mines && logicSolves(mines, counts, first, spec.w, spec.h, spec.mines)) return { mines, counts };
    }
    throw new Error('Unable to shape this pool');
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  class ShoalEngine {
    constructor(seed) {
      this.sessionBest = 0; this.attempt = 0; this.reset(seed == null ? 'shoal' : seed);
    }
    reset(seed) {
      this.seed = String(seed == null ? 'shoal' : seed);
      this.attempt++; this.revision = 0; this.tick = 0; this._fraction = 0;
      this.phase = 'ready'; this.pool = 1; this.pearls = 0; this.moves = 0;
      this.rank = null; this.events = []; this.nextSeq = 1; this.biggestRipple = 0;
      this.deepestPool = 1; this._newPool(); return this.snapshot();
    }
    restart() { return this.reset(this.seed); }
    _newPool() {
      const s = poolSpec(this.pool); this.w = s.w; this.h = s.h; this.total = s.mines;
      this.tideTicks = Math.round(s.tide * 60); this.poolStartTick = this.tick;
      this.firstTurnDone = false; this.mines = null; this.counts = null; this.stungAt = null;
      this.open = new Uint8Array(this.w * this.h); this.flags = new Uint8Array(this.w * this.h);
    }
    _event(kind, extra) {
      const e = Object.assign({ seq: this.nextSeq++, kind, tick: this.tick }, extra || {});
      this.events.push(e); if (this.events.length > 240) this.events.shift(); return e;
    }
    _index(action) {
      if (!action || !Number.isInteger(action.x) || !Number.isInteger(action.y)) return -1;
      if (action.x < 0 || action.y < 0 || action.x >= this.w || action.y >= this.h) return -1;
      return action.y * this.w + action.x;
    }
    _tide() {
      if (!this.firstTurnDone) return 1;
      return Math.max(0, 1 - (this.tick - this.poolStartTick) / this.tideTicks);
    }
    _reveal(i) {
      const before = this._openCount(); flood(this.open, i, this.mines, this.counts, this.w, this.h, this.flags);
      return this._openCount() - before;
    }
    _openCount() { let n = 0; for (const v of this.open) n += v; return n; }
    _clearIfDone() {
      if (this._openCount() !== this.w * this.h - this.total) return false;
      const cleared = this.pool;
      this.pearls += Math.round((24 + cleared * 16) * this._tide());
      this._event('pool_clear', { pool: cleared });
      this.pool++; this.deepestPool = Math.max(this.deepestPool, this.pool); this._newPool();
      return true;
    }
    _end(x, y) {
      this.stungAt = { x, y }; this.phase = 'ended';
      this._event('sting'); this._event('run_end');
      this.sessionBest = Math.max(this.sessionBest, this.pearls);
      const p = this.pearls; this.rank = RANKS[p >= 900 ? 4 : p >= 450 ? 3 : p >= 190 ? 2 : p >= 65 ? 1 : 0];
    }
    perform(action) {
      if (this.phase === 'ended' || !action || typeof action.type !== 'string') return { accepted: false, error: 'illegal_action', state: this.snapshot() };
      const i = this._index(action); if (i < 0) return { accepted: false, error: 'out_of_bounds', state: this.snapshot() };
      let opened = 0;
      if (action.type === 'flag') {
        if (this.open[i] || this.flags[i]) return { accepted: false, error: 'illegal_action', state: this.snapshot() };
        this.flags[i] = 1; this.moves++; this.revision++; this._event('flag');
      } else if (action.type === 'unflag') {
        if (!this.flags[i] || this.open[i]) return { accepted: false, error: 'illegal_action', state: this.snapshot() };
        this.flags[i] = 0; this.moves++; this.revision++; this._event('unflag');
      } else if (action.type === 'open') {
        if (this.open[i] || this.flags[i]) return { accepted: false, error: 'illegal_action', state: this.snapshot() };
        if (!this.firstTurnDone) {
          const board = generate(this.seed, this.pool, i, poolSpec(this.pool)); this.mines = board.mines; this.counts = board.counts;
          this.firstTurnDone = true; this.poolStartTick = this.tick; if (this.phase === 'ready') this.phase = 'playing';
        }
        this.moves++; this.revision++;
        if (this.mines[i]) { this.open[i] = 1; this._event('open', { opened: 1 }); this._end(action.x, action.y); }
        else { opened = this._reveal(i); this.pearls += opened; this.biggestRipple = Math.max(this.biggestRipple, opened); this._event('open', { opened }); this._clearIfDone(); }
      } else if (action.type === 'sweep') {
        if (!this.open[i] || !this.firstTurnDone) return { accepted: false, error: 'illegal_action', state: this.snapshot() };
        const ns = neighbors(i, this.w, this.h); let fc = 0; for (const n of ns) fc += this.flags[n];
        if (fc !== this.counts[i]) return { accepted: false, error: 'unsatisfied_sweep', state: this.snapshot() };
        const targets = ns.filter(n => !this.open[n] && !this.flags[n]);
        if (!targets.length) return { accepted: false, error: 'illegal_action', state: this.snapshot() };
        this.moves++; this.revision++;
        let fatal = -1;
        for (const n of targets) if (this.mines[n]) { fatal = n; break; }
        if (fatal >= 0) {
          for (const n of targets) { if (this.mines[n]) { this.open[n] = 1; break; } opened += this._reveal(n); }
          this.pearls += opened; this._event('sweep', { opened }); this._end(fatal % this.w, (fatal / this.w) | 0);
        } else {
          for (const n of targets) opened += this._reveal(n);
          this.pearls += opened; this.biggestRipple = Math.max(this.biggestRipple, opened); this._event('sweep', { opened }); this._clearIfDone();
        }
      } else return { accepted: false, error: 'unknown_action', state: this.snapshot() };
      return { accepted: true, state: this.snapshot() };
    }
    act(action) { return this.perform(action).state; }
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) return this.snapshot();
      if (this.phase !== 'playing') return this.snapshot();
      this._fraction += ms;
      const steps = Math.floor((this._fraction + 1e-9) / STEP);
      if (steps) { this.tick += steps; this._fraction -= steps * STEP; }
      return this.snapshot();
    }
    snapshot() {
      let flagsPlaced = 0; for (const v of this.flags) flagsPlaced += v;
      const rows = [];
      for (let y = 0; y < this.h; y++) {
        let row = '';
        for (let x = 0; x < this.w; x++) {
          const i = y * this.w + x; let ch = '#';
          if (this.phase === 'ended' && this.firstTurnDone) {
            if (this.stungAt && x === this.stungAt.x && y === this.stungAt.y) ch = 'X';
            else if (this.flags[i]) ch = this.mines[i] ? '+' : '-';
            else if (this.mines[i]) ch = '*';
            else if (this.open[i]) ch = String(this.counts[i]);
          } else if (this.flags[i]) ch = 'F';
          else if (this.open[i]) ch = String(this.counts[i]);
          row += ch;
        }
        rows.push(row);
      }
      const out = {
        phase: this.phase, tick: this.tick, elapsedMs: this.tick * STEP, seed: this.seed,
        attempt: this.attempt, revision: this.revision, pool: this.pool, pearls: this.pearls,
        sessionBest: this.sessionBest, moves: this.moves, rank: this.rank, rankLadder: RANKS.slice(),
        gridWidth: this.w, gridHeight: this.h, urchinsTotal: this.total, flagsPlaced,
        urchinsLeft: this.total - flagsPlaced, tideFraction: this._tide(), firstTurnDone: this.firstTurnDone,
        stungAt: this.stungAt ? { x: this.stungAt.x, y: this.stungAt.y } : null, rows,
        events: this.events.map(e => Object.assign({}, e)), lastEvent: this.events.length ? Object.assign({}, this.events[this.events.length - 1]) : null
      };
      return clone(out);
    }
  }
  return { ShoalEngine };
});
