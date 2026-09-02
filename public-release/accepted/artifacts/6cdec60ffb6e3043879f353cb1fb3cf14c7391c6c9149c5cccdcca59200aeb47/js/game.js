import { SeededRNG, hashSeed } from './rng.js';
import { neighbors, isSolvable, verifyWaterNeverLies } from './solver.js';

export const RANK_LADDER = [
  'Tidal Pool',
  'Sand Dollar',
  'Sea Glass',
  'Moon Jelly',
  'Pearl Diver',
  'King Tide',
];

const RANK_THRESHOLDS = [0, 40, 120, 280, 550, 900];
export const TICK_MS = 1000 / 60;
export const TIDE_DRAIN_PER_TICK = 1 / (60 * 120); // ~2 min to empty at 60Hz

export function getPoolConfig(pool) {
  const w = Math.min(5 + pool, 11);
  const h = Math.min(7 + pool, 14);
  const maxUrchins = Math.floor(w * h * 0.18);
  const urchins = Math.min(2 + pool + Math.floor(pool / 2), maxUrchins);
  return { width: w, height: h, urchins: Math.max(urchins, 2) };
}

function poolBonus(pool) {
  return 10 + pool * 8;
}

function computeRank(pearls) {
  let rank = RANK_LADDER[0];
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (pearls >= RANK_THRESHOLDS[i]) {
      rank = RANK_LADDER[i];
      break;
    }
  }
  return rank;
}

function emptyGrid(w, h) {
  return Array.from({ length: h }, () => '#'.repeat(w));
}

function key(x, y) {
  return `${x},${y}`;
}

export class Game {
  constructor() {
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed >>> 0 || hashSeed(seed || 1);
    this.attempt = (this.attempt || 0) + 1;
    this.sessionBest = this.sessionBest || 0;
    this.revision = 0;
    this.phase = 'ready';
    this.tick = 0;
    this.elapsedMs = 0;
    this.pool = 1;
    this.pearls = 0;
    this.moves = 0;
    this.rank = null;
    this.events = [];
    this.eventSeq = 0;
    this.signatureRipple = 0;
    this.fastestPoolMs = null;
    this.poolStartTick = null;

    // Internal board state
    this._solution = null; // -1 = urchin, 0-8 = number
    this._flags = new Set();
    this._opened = new Set();
    this._stungAt = null;
    this._firstTurnDone = false;
    this._firstTurnPos = null;
    this._tideFraction = 1;
    this._tideActive = false;
    this._pendingAnim = null;

    this._initPool();
  }

  restart() {
    const seed = this.seed;
    const best = this.sessionBest;
    this.sessionBest = best;
    this.reset(seed);
  }

  _initPool() {
    const cfg = getPoolConfig(this.pool);
    this.gridWidth = cfg.width;
    this.gridHeight = cfg.height;
    this.urchinsTotal = cfg.urchins;
    this._flags = new Set();
    this._opened = new Set();
    this._solution = null;
    this._stungAt = null;
    this._firstTurnDone = false;
    this._firstTurnPos = null;
    this._tideFraction = 1;
    this._tideActive = false;
    this.poolStartTick = null;
    this.visible = emptyGrid(this.gridWidth, this.gridHeight);
  }

  _generateBoard(fx, fy) {
    const { gridWidth: w, gridHeight: h, urchinsTotal: count } = this;
    const forbidden = new Set([key(fx, fy)]);
    for (const [nx, ny] of neighbors(fx, fy, w, h)) forbidden.add(key(nx, ny));

    for (let attempt = 0; attempt < 500; attempt++) {
      const rng = new SeededRNG(
        hashSeed(this.seed, this.pool, fx, fy, attempt)
      );
      const cells = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!forbidden.has(key(x, y))) cells.push([x, y]);
        }
      }
      const shuffled = rng.shuffle(cells);
      const urchinSet = new Set();
      for (let i = 0; i < count && i < shuffled.length; i++) {
        urchinSet.add(key(...shuffled[i]));
      }

      const solution = Array.from({ length: h }, () => Array(w).fill(0));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (urchinSet.has(key(x, y))) {
            solution[y][x] = -1;
          } else {
            let n = 0;
            for (const [nx, ny] of neighbors(x, y, w, h)) {
              if (urchinSet.has(key(nx, ny))) n++;
            }
            solution[y][x] = n;
          }
        }
      }

      // Build post-first-turn visible state for solvability check
      const vis = emptyGrid(w, h);
      const opened = new Set();
      this._floodOpen(fx, fy, solution, opened, vis, w, h);

      if (isSolvable(vis, w, h, count, solution) &&
          verifyWaterNeverLies(vis, w, h, count, solution)) {
        return solution;
      }
    }

    // Fallback: sparse board
    const solution = Array.from({ length: h }, () => Array(w).fill(0));
    return solution;
  }

  _floodOpen(x, y, solution, opened, vis, w, h, flags) {
    const stack = [[x, y]];
    let count = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const k = key(cx, cy);
      if (opened.has(k)) continue;
      if (flags && flags.has(k)) continue;
      if (solution[cy][cx] === -1) continue;
      opened.add(k);
      vis[cy] = vis[cy].substring(0, cx) + String(solution[cy][cx]) + vis[cy].substring(cx + 1);
      count++;
      if (solution[cy][cx] === 0) {
        for (const [nx, ny] of neighbors(cx, cy, w, h)) {
          if (!opened.has(key(nx, ny))) stack.push([nx, ny]);
        }
      }
    }
    return count;
  }

  _buildRows() {
    const { gridWidth: w, gridHeight: h } = this;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        const k = key(x, y);
        if (this.phase === 'ended') {
          if (this._stungAt && this._stungAt.x === x && this._stungAt.y === y) {
            row += 'X';
          } else if (this._solution && this._solution[y][x] === -1) {
            if (this._flags.has(k)) row += '+';
            else row += '*';
          } else if (this._flags.has(k)) {
            row += '-';
          } else if (this._opened.has(k)) {
            row += String(this._solution[y][x]);
          } else {
            row += '#';
          }
        } else if (this._flags.has(k)) {
          row += 'F';
        } else if (this._opened.has(k)) {
          row += String(this._solution[y][x]);
        } else {
          row += '#';
        }
      }
      rows.push(row);
    }
    return rows;
  }

  _pushEvent(kind, extra = {}) {
    this.eventSeq++;
    const ev = { seq: this.eventSeq, kind, tick: this.tick, ...extra };
    this.events.push(ev);
    if (this.events.length > 200) this.events.shift();
    return ev;
  }

  _startTide() {
    if (!this._tideActive) {
      this._tideActive = true;
      this.poolStartTick = this.tick;
    }
  }

  _advanceTide() {
    if (this._tideActive && this.phase === 'playing') {
      this._tideFraction = Math.max(0, this._tideFraction - TIDE_DRAIN_PER_TICK);
    }
  }

  advance(ms) {
    if (this.phase !== 'playing') return;
    const ticks = Math.floor(ms / TICK_MS);
    for (let i = 0; i < ticks; i++) {
      this.tick++;
      this.elapsedMs += TICK_MS;
      this._advanceTide();
    }
    const remainder = ms - ticks * TICK_MS;
    if (remainder > 0 && ticks === 0) {
      // partial ms still counts as no tick at 60Hz
    }
  }

  snapshot() {
    const flagsPlaced = this._flags.size;
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      seed: this.seed,
      attempt: this.attempt,
      revision: this.revision,
      pool: this.pool,
      pearls: this.pearls,
      sessionBest: this.sessionBest,
      moves: this.moves,
      rank: this.rank,
      rankLadder: RANK_LADDER.slice(),
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      urchinsTotal: this.urchinsTotal,
      flagsPlaced,
      urchinsLeft: this.urchinsTotal - flagsPlaced,
      tideFraction: this._tideFraction,
      firstTurnDone: this._firstTurnDone,
      stungAt: this._stungAt ? { ...this._stungAt } : null,
      rows: this._buildRows(),
      events: this.events.map((e) => ({ ...e })),
      lastEvent: this.events.length ? { ...this.events[this.events.length - 1] } : null,
    };
  }

  bridgeSnapshot() {
    const s = this.snapshot();
    const { events, lastEvent, signatureRipple, fastestPoolMs, ...rest } = s;
    return rest;
  }

  act(action) {
    if (!action || !action.type) return { ok: false, error: 'invalid_action' };

    const { type, x, y } = action;
    if (typeof x !== 'number' || typeof y !== 'number') {
      return { ok: false, error: 'invalid_coords' };
    }

    if (this.phase === 'ended') {
      return { ok: false, error: 'run_ended' };
    }

    const { gridWidth: w, gridHeight: h } = this;
    if (x < 0 || x >= w || y < 0 || y >= h) {
      return { ok: false, error: 'out_of_bounds' };
    }

    const k = key(x, y);

    switch (type) {
      case 'open':
        return this._actOpen(x, y, k);
      case 'flag':
        return this._actFlag(x, y, k);
      case 'unflag':
        return this._actUnflag(x, y, k);
      case 'sweep':
        return this._actSweep(x, y, k);
      default:
        return { ok: false, error: 'unknown_action' };
    }
  }

  _accept() {
    this.revision++;
    this.moves++;
    if (this.phase === 'ready') {
      this.phase = 'playing';
    }
    return { ok: true, state: this.snapshot() };
  }

  _actOpen(x, y, k) {
    if (this._flags.has(k)) return { ok: false, error: 'flagged' };
    if (this._opened.has(k)) return { ok: false, error: 'already_open' };

    if (!this._firstTurnDone) {
      this._firstTurnDone = true;
      this._firstTurnPos = { x, y };
      this._solution = this._generateBoard(x, y);
      this._startTide();
    }

    if (this._solution[y][x] === -1) {
      this._opened.add(k);
      this._stungAt = { x, y };
      this.phase = 'ended';
      this.revision++;
      this.moves++;
      this._pushEvent('sting');
      this._pushEvent('run_end');
      this.rank = computeRank(this.pearls);
      if (this.pearls > this.sessionBest) this.sessionBest = this.pearls;
      return { ok: true, state: this.snapshot(), sting: true };
    }

    const opened = this._openCell(x, y);
    this.pearls += opened;
    if (opened > this.signatureRipple) this.signatureRipple = opened;
    this._pushEvent('open', { opened });

    if (this._isPoolCleared()) {
      return this._clearPool();
    }

    return this._accept();
  }

  _openCell(x, y) {
    const { gridWidth: w, gridHeight: h } = this;
    const vis = this._buildRows();
    const opened = new Set(this._opened);
    let count = 0;

    const openOne = (cx, cy) => {
      const ck = key(cx, cy);
      if (opened.has(ck)) return;
      if (this._flags.has(ck)) return;
      if (this._solution[cy][cx] === -1) return;
      opened.add(ck);
      this._opened.add(ck);
      vis[cy] = vis[cy].substring(0, cx) + String(this._solution[cy][cx]) + vis[cy].substring(cx + 1);
      count++;
      if (this._solution[cy][cx] === 0) {
        for (const [nx, ny] of neighbors(cx, cy, w, h)) {
          openOne(nx, ny);
        }
      }
    };

    openOne(x, y);
    return count;
  }

  _actFlag(x, y, k) {
    if (this._opened.has(k)) return { ok: false, error: 'already_open' };
    if (this._flags.has(k)) return { ok: false, error: 'already_flagged' };
    this._flags.add(k);
    this._pushEvent('flag');
    return this._accept();
  }

  _actUnflag(x, y, k) {
    if (!this._flags.has(k)) return { ok: false, error: 'not_flagged' };
    this._flags.delete(k);
    this._pushEvent('unflag');
    return this._accept();
  }

  _actSweep(x, y, k) {
    if (!this._opened.has(k)) return { ok: false, error: 'not_open' };
    const num = this._solution[y][x];
    const { gridWidth: w, gridHeight: h } = this;
    const nbrs = neighbors(x, y, w, h);
    let flagged = 0;
    const hidden = [];
    for (const [nx, ny] of nbrs) {
      const nk = key(nx, ny);
      if (this._flags.has(nk)) flagged++;
      else if (!this._opened.has(nk)) hidden.push([nx, ny]);
    }
    if (flagged !== num) return { ok: false, error: 'unsatisfied' };
    if (hidden.length === 0) return { ok: false, error: 'nothing_to_sweep' };

    let totalOpened = 0;
    for (const [nx, ny] of hidden) {
      const nk = key(nx, ny);
      if (this._solution[ny][nx] === -1) {
        this._opened.add(nk);
        this._stungAt = { x: nx, y: ny };
        this.phase = 'ended';
        this.revision++;
        this.moves++;
        this._pushEvent('sweep', { opened: 0 });
        this._pushEvent('sting');
        this._pushEvent('run_end');
        this.rank = computeRank(this.pearls);
        if (this.pearls > this.sessionBest) this.sessionBest = this.pearls;
        return { ok: true, state: this.snapshot(), sting: true };
      }
    }

    for (const [nx, ny] of hidden) {
      totalOpened += this._openCell(nx, ny);
    }
    this.pearls += totalOpened;
    if (totalOpened > this.signatureRipple) this.signatureRipple = totalOpened;
    this._pushEvent('sweep', { opened: totalOpened });

    if (this._isPoolCleared()) {
      return this._clearPool();
    }

    return this._accept();
  }

  _isPoolCleared() {
    const { gridWidth: w, gridHeight: h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (this._solution[y][x] !== -1 && !this._opened.has(key(x, y))) return false;
      }
    }
    return true;
  }

  _clearPool() {
    const bonus = Math.floor(poolBonus(this.pool) * this._tideFraction);
    this.pearls += bonus;
    const poolMs = this.poolStartTick != null ? (this.tick - this.poolStartTick) * TICK_MS : 0;
    if (this.fastestPoolMs == null || poolMs < this.fastestPoolMs) {
      this.fastestPoolMs = poolMs;
    }
    this._pushEvent('pool_clear', { pool: this.pool, poolMs });

    this.pool++;
    this._initPool();
    this.revision++;
    this.moves++;

    return { ok: true, state: this.snapshot(), poolClear: true };
  }
}

export function createArenaGame() {
  const game = new Game();
  return {
    reset(seed) {
      game.sessionBest = game.sessionBest || 0;
      game.reset(seed);
      return game.snapshot();
    },
    snapshot() {
      return game.snapshot();
    },
    bridgeSnapshot() {
      return game.bridgeSnapshot();
    },
    act(action) {
      const result = game.act(action);
      if (result.ok) return result.state;
      throw new Error(result.error || 'rejected');
    },
    restart() {
      game.restart();
      return game.snapshot();
    },
    advance(ms) {
      game.advance(ms);
    },
    _game: game,
  };
}
