/* SHOAL - the production state.

   One board, one truth. Human gestures, window.__ARENA_GAME__ and the Arena
   bridge all call into this file and nothing else mutates a shell. */
(function (g) {
  'use strict';

  var S = g.SHOAL;
  var STEP_MS = 1000 / 60;
  var EVENT_CAP = 200;

  var RANK_LADDER = ['Driftwood', 'Barnacle', 'Cowrie', 'Nautilus', 'Moonsnail', 'Abalone', 'Pearl Crown'];
  var RANK_MIN = [0, 60, 200, 450, 900, 1700, 3000];

  var PEARLS_PER_SHELL = 1;
  // Clearing pays depth times the tide left. Run the meter dry and the clear
  // pays nothing at all; turning shells still pays, so progress never stops.
  var CLEAR_BONUS_BASE = 90;

  function rankFor(pearls) {
    var out = RANK_LADDER[0];
    for (var i = 0; i < RANK_MIN.length; i++) if (pearls >= RANK_MIN[i]) out = RANK_LADDER[i];
    return out;
  }

  var listeners = [];
  var sessionAttempts = 0;
  var sessionBest = 0;
  var st = null;

  function emit(ev) {
    for (var i = 0; i < listeners.length; i++) listeners[i](ev);
  }

  /* ------------------------------------------------------------ pool setup */

  function setupPool(state, n) {
    var cfg = S.gen.poolConfig(n);
    state.pool = n;
    state.w = cfg.w;
    state.h = cfg.h;
    state.urchinsTotal = cfg.mines;
    state.tideTicks = cfg.tideTicks;
    state.mine = null;
    state.val = null;
    state.open = new Uint8Array(cfg.w * cfg.h);
    state.flag = new Uint8Array(cfg.w * cfg.h);
    state.flagsPlaced = 0;
    state.firstTurnDone = false;
    state.poolTick = 0;
    state.safeOpened = 0;
    state.safeTotal = cfg.w * cfg.h - cfg.mines;
    if (n > state.stats.deepest) state.stats.deepest = n;
  }

  function makeState(seed) {
    sessionAttempts++;
    var state = {
      seed: seed,
      seedHash: S.rng.hashSeed(seed),
      attempt: sessionAttempts,
      revision: 0,
      moves: 0,
      phase: 'ready',
      tick: 0,
      acc: 0,
      pearls: 0,
      rank: null,
      stungAt: null,
      events: [],
      seq: 0,
      stats: { ripple: 0, cleared: 0, fastestTicks: null, deepest: 1 }
    };
    setupPool(state, 1);
    return state;
  }

  function pushEvent(state, kind, extra) {
    var ev = { seq: ++state.seq, kind: kind, tick: state.tick };
    if (extra) for (var k in extra) ev[k] = extra[k];
    state.events.push(ev);
    if (state.events.length > EVENT_CAP) state.events.splice(0, state.events.length - EVENT_CAP);
    return ev;
  }

  /* ----------------------------------------------------------------- clock */

  function stepOnce() {
    st.tick++;
    if (st.firstTurnDone && st.poolTick < st.tideTicks) st.poolTick++;
  }

  // The tick is derived from the total simulated time rather than counted by
  // repeated subtraction, so a slice-by-slice advance and a single long one
  // land on exactly the same step.
  function advance(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return;
    if (st.phase !== 'playing') return;
    st.acc += ms;
    var target = Math.floor((st.acc * 60) / 1000 + 1e-9);
    var budget = 4000000;
    while (st.tick < target && budget-- > 0) stepOnce();
  }

  function tideFraction(state) {
    if (!state.firstTurnDone) return 1;
    if (state.tideTicks <= 0) return 0;
    var f = 1 - state.poolTick / state.tideTicks;
    return f > 0 ? (f < 1 ? f : 1) : 0;
  }

  /* --------------------------------------------------------------- actions */

  function fail(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function ensureBoard(x, y) {
    if (st.firstTurnDone) return;
    var board = S.gen.generate(st.seedHash, st.pool, x, y);
    st.mine = board.mine;
    st.val = board.val;
    st.urchinsTotal = board.mines;
    st.safeTotal = st.w * st.h - board.mines;
    st.tideTicks = board.tideTicks;
    st.firstTurnDone = true;
    st.poolTick = 0;
    if (st.phase === 'ready') {
      st.phase = 'playing';
      st.acc = 0;
    }
  }

  // Breadth-first so the opened list arrives in wave order for the ripple.
  function floodOpen(start, out) {
    var nb = S.gen.neighbors(st.w, st.h);
    var queue = [start];
    var head = 0;
    var queued = {};
    queued[start] = 1;
    while (head < queue.length) {
      var c = queue[head++];
      if (st.open[c] || st.flag[c]) continue;
      st.open[c] = 1;
      st.safeOpened++;
      out.push(c);
      if (st.val[c] === 0) {
        var L = nb[c];
        for (var k = 0; k < L.length; k++) {
          var m = L[k];
          if (!st.open[m] && !st.flag[m] && !queued[m]) { queued[m] = 1; queue.push(m); }
        }
      }
    }
  }

  function sting(cell) {
    st.phase = 'ended';
    st.stungAt = { x: cell % st.w, y: (cell / st.w) | 0 };
    pushEvent(st, 'sting', null);
    st.rank = rankFor(st.pearls);
    if (st.pearls > sessionBest) sessionBest = st.pearls;
    pushEvent(st, 'run_end', null);
    emit({ type: 'sting', x: st.stungAt.x, y: st.stungAt.y });
  }

  function clearPool() {
    var frac = tideFraction(st);
    var bonus = Math.round(CLEAR_BONUS_BASE * st.pool * frac);
    st.pearls += bonus;
    st.stats.cleared++;
    if (st.stats.fastestTicks === null || st.poolTick < st.stats.fastestTicks) {
      st.stats.fastestTicks = st.poolTick;
    }
    var cleared = st.pool;
    pushEvent(st, 'pool_clear', { pool: cleared });
    // The next pool exists before anyone is told, so listeners lay out the
    // board they are about to draw rather than the one just finished.
    setupPool(st, cleared + 1);
    emit({ type: 'clear', pool: cleared, bonus: bonus, tide: frac });
  }

  function act(action) {
    if (!action || typeof action !== 'object') return fail('bad_action', 'Action must be an object');
    var type = action.type;
    if (type !== 'open' && type !== 'flag' && type !== 'unflag' && type !== 'sweep') {
      return fail('bad_action', 'Unknown action type');
    }
    if (st.phase === 'ended') return fail('run_ended', 'The run has ended');
    var x = action.x, y = action.y;
    if (typeof x !== 'number' || typeof y !== 'number' || (x | 0) !== x || (y | 0) !== y) {
      return fail('bad_action', 'Coordinates must be integers');
    }
    if (x < 0 || y < 0 || x >= st.w || y >= st.h) return fail('out_of_bounds', 'Outside the pool');
    var cell = y * st.w + x;

    if (type === 'flag') {
      if (st.open[cell]) return fail('already_open', 'That shell is already turned');
      if (st.flag[cell]) return fail('already_flagged', 'A pennant already stands there');
      st.flag[cell] = 1;
      st.flagsPlaced++;
      commit('flag', null);
      emit({ type: 'flag', x: x, y: y });
      return { ok: true };
    }

    if (type === 'unflag') {
      if (!st.flag[cell]) return fail('not_flagged', 'No pennant stands there');
      st.flag[cell] = 0;
      st.flagsPlaced--;
      commit('unflag', null);
      emit({ type: 'unflag', x: x, y: y });
      return { ok: true };
    }

    if (type === 'open') {
      if (st.open[cell]) return fail('already_open', 'That shell is already turned');
      if (st.flag[cell]) return fail('flagged', 'Lift the pennant first');
      ensureBoard(x, y);
      if (st.mine[cell]) {
        commit('open', { opened: 0 });
        sting(cell);
        return { ok: true };
      }
      var opened = [];
      floodOpen(cell, opened);
      st.pearls += opened.length * PEARLS_PER_SHELL;
      if (opened.length > st.stats.ripple) st.stats.ripple = opened.length;
      emit({ type: 'open', cells: opened, origin: cell, w: st.w });
      commit('open', { opened: opened.length });
      if (st.safeOpened === st.safeTotal) clearPool();
      return { ok: true };
    }

    // sweep
    if (!st.open[cell]) return fail('not_open', 'Only a turned number can be swept');
    var value = st.val[cell];
    var nb = S.gen.neighbors(st.w, st.h);
    var L = nb[cell];
    var flags = 0;
    var targets = [];
    for (var k = 0; k < L.length; k++) {
      var m = L[k];
      if (st.flag[m]) flags++;
      else if (!st.open[m]) targets.push(m);
    }
    if (flags !== value) return fail('unsatisfied', 'Its pennants do not match its number');
    if (!targets.length) return fail('nothing_to_sweep', 'Nothing left to turn there');

    var swept = [];
    var stungHere = false;
    for (var t = 0; t < targets.length; t++) {
      var tc = targets[t];
      if (st.open[tc] || st.flag[tc]) continue;
      if (st.mine[tc]) {
        commit('sweep', { opened: swept.length });
        if (swept.length) emit({ type: 'open', cells: swept, origin: cell, w: st.w, sweep: true });
        sting(tc);
        stungHere = true;
        break;
      }
      var part = [];
      floodOpen(tc, part);
      st.pearls += part.length * PEARLS_PER_SHELL;
      for (var p = 0; p < part.length; p++) swept.push(part[p]);
    }
    if (stungHere) return { ok: true };
    emit({ type: 'open', cells: swept, origin: cell, w: st.w, sweep: true });
    commit('sweep', { opened: swept.length });
    if (st.safeOpened === st.safeTotal) clearPool();
    return { ok: true };
  }

  // Every accepted, state-changing action lands here exactly once.
  function commit(kind, extra) {
    st.revision++;
    st.moves++;
    pushEvent(st, kind, extra);
  }

  /* -------------------------------------------------------------- snapshot */

  var CH_COVERED = '#';

  function buildRows() {
    var rows = new Array(st.h);
    var ended = st.phase === 'ended';
    var stungCell = st.stungAt ? st.stungAt.y * st.w + st.stungAt.x : -1;
    for (var y = 0; y < st.h; y++) {
      var line = '';
      for (var x = 0; x < st.w; x++) {
        var i = y * st.w + x;
        var isMine = st.mine ? !!st.mine[i] : false;
        if (ended && isMine) {
          line += i === stungCell ? 'X' : (st.flag[i] ? '+' : '*');
        } else if (st.open[i]) {
          line += String(st.val[i]);
        } else if (st.flag[i]) {
          line += ended ? '-' : 'F';
        } else {
          line += CH_COVERED;
        }
      }
      rows[y] = line;
    }
    return rows;
  }

  function baseState() {
    return {
      phase: st.phase,
      tick: st.tick,
      elapsedMs: Math.round(st.tick * STEP_MS * 1000) / 1000,
      seed: st.seed,
      attempt: st.attempt,
      revision: st.revision,
      pool: st.pool,
      pearls: st.pearls,
      sessionBest: sessionBest,
      moves: st.moves,
      rank: st.rank,
      rankLadder: RANK_LADDER.slice(),
      gridWidth: st.w,
      gridHeight: st.h,
      urchinsTotal: st.urchinsTotal,
      flagsPlaced: st.flagsPlaced,
      urchinsLeft: st.urchinsTotal - st.flagsPlaced,
      tideFraction: Math.round(tideFraction(st) * 1e6) / 1e6,
      firstTurnDone: st.firstTurnDone,
      stungAt: st.stungAt ? { x: st.stungAt.x, y: st.stungAt.y } : null,
      rows: buildRows()
    };
  }

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (var k in o) deepFreeze(o[k]);
    }
    return o;
  }

  function visibleState() {
    return deepFreeze(baseState());
  }

  function snapshot() {
    var s = baseState();
    var events = new Array(st.events.length);
    for (var i = 0; i < st.events.length; i++) {
      var e = st.events[i];
      var copy = {};
      for (var k in e) copy[k] = e[k];
      events[i] = copy;
    }
    s.events = events;
    s.lastEvent = events.length ? events[events.length - 1] : null;
    return deepFreeze(s);
  }

  /* ------------------------------------------------------------- lifecycle */

  function reset(seed) {
    var next = seed === undefined || seed === null ? (st ? st.seed : 'tidepool') : seed;
    st = makeState(next);
    emit({ type: 'reset' });
    return st;
  }

  function restart() {
    return reset(st ? st.seed : undefined);
  }

  S.game = {
    STEP_MS: STEP_MS,
    RANK_LADDER: RANK_LADDER,
    RANK_MIN: RANK_MIN,
    on: function (fn) { listeners.push(fn); },
    reset: reset,
    restart: restart,
    act: act,
    advance: advance,
    snapshot: snapshot,
    visibleState: visibleState,
    tideFraction: function () { return tideFraction(st); },
    rankFor: rankFor,
    state: function () { return st; },
    sessionBest: function () { return sessionBest; },
    // View-only helpers; they never mutate anything.
    valueAt: function (x, y) { return st.val ? st.val[y * st.w + x] : 0; },
    coveredSafeLeft: function () { return st.safeTotal - st.safeOpened; }
  };
})(window);
