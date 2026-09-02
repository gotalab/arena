/* SHOAL - the production state.
   One board, one truth. A finger, window.__ARENA_GAME__ and the Arena bridge
   all call straight into this module; there is no second game underneath.
   Nothing here reads Date.now() or Math.random(). */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});

  var STEP = 1000 / 60;

  // display codes (0..8 are turned numbers)
  var COV = 9, FLG = 10, URC = 11, FATAL = 12, FRIGHT = 13, FWRONG = 14;
  var CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '#', 'F', '*', 'X', '+', '-'];
  S.CODES = { COV: COV, FLG: FLG, URC: URC, FATAL: FATAL, FRIGHT: FRIGHT, FWRONG: FWRONG };

  // A short ladder of grades, monotone in pearls, lowest first.
  var RANKS = [
    { name: 'Pebble', min: 0 },
    { name: 'Cowrie', min: 300 },
    { name: 'Conch', min: 1100 },
    { name: 'Nautilus', min: 2800 },
    { name: 'Abalone', min: 6000 },
    { name: 'Pearl', min: 13000 }
  ];
  var RANK_NAMES = RANKS.map(function (r) { return r.name; });
  S.RANKS = RANKS;

  var EVENT_CAP = 200;

  S.createGame = function (initialSeed) {
    var g = {
      seed: 'shoal',
      attempt: 0,
      sessionBest: 0,
      phase: 'ready',
      tick: 0,
      acc: 0,
      revision: 0,
      pool: 1,
      pearls: 0,
      moves: 0,
      w: 0, h: 0, n: 0,
      urchins: 0,
      mine: null, num: null,
      st: null,          // 0 covered, 1 turned, 2 pennanted
      disp: null,        // what the screen (and rows) show
      nb: null,
      flags: 0,
      opened: 0,
      firstTurnDone: false,
      poolStart: -1,
      tideTicks: 1,
      stungAt: null,
      rank: null,
      events: [],
      seq: 0,
      bestRipple: 0,
      deepest: 1,
      shellsTurned: 0,
      fastestClearTicks: null,
      boardId: 0,
      fx: []
    };

    /* ---------------------------------------------------------------- pools */

    function setupPool() {
      var sp = S.poolSpec(g.pool);
      g.w = sp.w; g.h = sp.h; g.n = sp.w * sp.h;
      g.urchins = sp.urchins;
      g.nb = S.neighbors(g.w, g.h);
      g.mine = null; g.num = null;
      g.st = new Uint8Array(g.n);
      g.disp = new Uint8Array(g.n); g.disp.fill(COV);
      g.flags = 0; g.opened = 0;
      g.firstTurnDone = false;
      g.poolStart = -1;
      g.tideTicks = S.tideTicksFor(g.pool, g.n);
      g.boardId++;
      g.fx.push({ t: 'board', pool: g.pool });
    }

    function ensureBoard(first) {
      if (g.firstTurnDone) return;
      var built = S.generateBoard(g.seed, g.pool, first % g.w, (first / g.w) | 0,
        { w: g.w, h: g.h, urchins: g.urchins });
      g.mine = built.mine;
      g.num = built.num;
      g.urchins = built.urchins; // the counter stays true, whatever was built
      g.firstTurnDone = true;
      g.poolStart = g.tick;
      if (g.phase === 'ready') g.phase = 'playing';
    }

    function tideFraction() {
      if (g.poolStart < 0) return 1;
      var f = 1 - (g.tick - g.poolStart) / g.tideTicks;
      return f < 0 ? 0 : (f > 1 ? 1 : f);
    }

    function shellValue() { return 5 * g.pool; }

    /* --------------------------------------------------------------- events */

    function pushEvent(kind, extra) {
      var e = { seq: ++g.seq, kind: kind, tick: g.tick };
      if (extra) for (var k in extra) e[k] = extra[k];
      g.events.push(e);
      if (g.events.length > EVENT_CAP) g.events.splice(0, g.events.length - EVENT_CAP);
      return e;
    }

    /* --------------------------------------------------------------- turning */

    function floodOpen(start) {
      var cells = [], dists = [], q = [start], qd = [0], head = 0;
      g.st[start] = 1; g.disp[start] = g.num[start];
      while (head < q.length) {
        var c = q[head], d = qd[head]; head++;
        cells.push(c); dists.push(d);
        if (g.num[c] === 0) {
          var l = g.nb[c];
          for (var k = 0; k < l.length; k++) {
            var j = l[k];
            if (g.st[j] === 0) {           // a standing pennant turns the water aside
              g.st[j] = 1; g.disp[j] = g.num[j];
              q.push(j); qd.push(d + 1);
            }
          }
        }
      }
      g.opened += cells.length;
      return { cells: cells, dists: dists };
    }

    function rankFor(pearls) {
      var name = RANKS[0].name;
      for (var i = 0; i < RANKS.length; i++) if (pearls >= RANKS[i].min) name = RANKS[i].name;
      return name;
    }

    function revealAll(fatal) {
      for (var i = 0; i < g.n; i++) {
        if (g.mine && g.mine[i]) {
          if (i === fatal) g.disp[i] = FATAL;
          else if (g.st[i] === 2) g.disp[i] = FRIGHT;
          else g.disp[i] = URC;
        } else if (g.st[i] === 2) {
          g.disp[i] = FWRONG;
        } else if (g.st[i] === 1) {
          g.disp[i] = g.num[i];
        } else {
          g.disp[i] = COV;
        }
      }
    }

    function endRun() {
      g.phase = 'ended';
      g.rank = rankFor(g.pearls);
      if (g.pearls > g.sessionBest) g.sessionBest = g.pearls;
      pushEvent('run_end');
      g.fx.push({ t: 'end' });
    }

    function sting(i) {
      g.st[i] = 1;
      g.stungAt = { x: i % g.w, y: (i / g.w) | 0 };
      revealAll(i);
      pushEvent('sting');
      g.fx.push({ t: 'sting', bid: g.boardId, i: i });
      endRun();
    }

    function checkClear() {
      if (g.phase === 'ended') return false;
      if (g.opened !== g.n - g.urchins) return false;
      var frac = tideFraction();
      var safeCells = g.n - g.urchins;
      var bonus = Math.round(safeCells * shellValue() * frac);
      g.pearls += bonus;
      var dur = g.poolStart >= 0 ? g.tick - g.poolStart : 0;
      if (g.fastestClearTicks === null || dur < g.fastestClearTicks) g.fastestClearTicks = dur;
      pushEvent('pool_clear', { pool: g.pool });
      g.fx.push({ t: 'clear', pool: g.pool, bonus: bonus, tide: frac });
      g.pool++;
      if (g.pool > g.deepest) g.deepest = g.pool;
      setupPool();
      return true;
    }

    function award(count) {
      var gained = count * shellValue();
      g.pearls += gained;
      g.shellsTurned += count;
      if (count > g.bestRipple) g.bestRipple = count;
      return gained;
    }

    /* -------------------------------------------------------------- actions */

    function bad(code, message) { return { ok: false, code: code, message: message }; }
    var OK = { ok: true };

    function doOpen(i) {
      if (g.st[i] === 1) return bad('illegal_action', 'That shell is already turned.');
      if (g.st[i] === 2) return bad('illegal_action', 'Lift the pennant before turning that shell.');
      ensureBoard(i);
      if (g.mine[i]) {
        pushEvent('open', { opened: 0 });
        sting(i);
        return OK;
      }
      var r = floodOpen(i);
      var gained = award(r.cells.length);
      pushEvent('open', { opened: r.cells.length });
      g.fx.push({ t: 'open', bid: g.boardId, cells: r.cells, dists: r.dists, pearls: gained, i: i, num: g.num[i] });
      checkClear();
      return OK;
    }

    function doFlag(i) {
      if (g.st[i] === 1) return bad('illegal_action', 'A pennant only stands on a covered shell.');
      if (g.st[i] === 2) return bad('illegal_action', 'A pennant already stands there.');
      g.st[i] = 2; g.disp[i] = FLG; g.flags++;
      pushEvent('flag');
      g.fx.push({ t: 'flag', bid: g.boardId, i: i });
      return OK;
    }

    function doUnflag(i) {
      if (g.st[i] !== 2) return bad('illegal_action', 'No pennant stands there.');
      g.st[i] = 0; g.disp[i] = COV; g.flags--;
      pushEvent('unflag');
      g.fx.push({ t: 'unflag', bid: g.boardId, i: i });
      return OK;
    }

    function doSweep(i) {
      if (g.st[i] !== 1) return bad('illegal_action', 'Only a turned number can sweep.');
      if (g.num[i] === 0) return bad('illegal_action', 'Quiet water has nothing to sweep.');
      var l = g.nb[i], f = 0, targets = [], k, j;
      for (k = 0; k < l.length; k++) {
        j = l[k];
        if (g.st[j] === 2) f++;
        else if (g.st[j] === 0) targets.push(j);
      }
      if (f !== g.num[i]) return bad('illegal_action', 'That number is not matched by its pennants.');

      var cells = [], dists = [], stungAt = -1, base = 0;
      for (k = 0; k < targets.length; k++) {
        j = targets[k];
        if (g.st[j] !== 0) continue;          // an earlier ripple already took it
        if (g.mine[j]) { stungAt = j; break; }
        var r = floodOpen(j);
        for (var q = 0; q < r.cells.length; q++) {
          cells.push(r.cells[q]);
          dists.push(base + r.dists[q]);
        }
        base += 1;
      }
      var gained = award(cells.length);
      pushEvent('sweep', { opened: cells.length });
      g.fx.push({ t: 'sweep', bid: g.boardId, i: i, cells: cells, dists: dists, pearls: gained });
      if (stungAt >= 0) { sting(stungAt); return OK; }
      checkClear();
      return OK;
    }

    var HANDLERS = { open: doOpen, flag: doFlag, unflag: doUnflag, sweep: doSweep };

    function applyAction(a) {
      if (!a || typeof a !== 'object') return bad('bad_action', 'Action must be an object.');
      var fn = HANDLERS[a.type];
      if (!fn) return bad('bad_action', 'Unknown action type.');
      if (g.phase === 'ended') return bad('run_over', 'The run has ended; restart to dive again.');
      var x = a.x, y = a.y;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= g.w || y >= g.h) {
        return bad('out_of_bounds', 'Those coordinates are outside the pool.');
      }
      var res = fn(y * g.w + x);
      if (res.ok) { g.revision++; g.moves++; }
      return res;
    }

    /* ------------------------------------------------------------- snapshot */

    function rows() {
      var out = new Array(g.h);
      for (var y = 0; y < g.h; y++) {
        var s = '';
        for (var x = 0; x < g.w; x++) s += CHARS[g.disp[y * g.w + x]];
        out[y] = s;
      }
      return out;
    }

    function state() {
      return {
        phase: g.phase,
        tick: g.tick,
        elapsedMs: Math.round(g.tick * STEP),
        seed: g.seed,
        attempt: g.attempt,
        revision: g.revision,
        pool: g.pool,
        pearls: g.pearls,
        sessionBest: g.sessionBest,
        moves: g.moves,
        rank: g.rank,
        rankLadder: RANK_NAMES.slice(),
        gridWidth: g.w,
        gridHeight: g.h,
        urchinsTotal: g.urchins,
        flagsPlaced: g.flags,
        urchinsLeft: g.urchins - g.flags,
        tideFraction: tideFraction(),
        firstTurnDone: g.firstTurnDone,
        stungAt: g.stungAt ? { x: g.stungAt.x, y: g.stungAt.y } : null,
        rows: rows(),
        // run signature, all pure functions of seed + actions + clock
        widestRipple: g.bestRipple,
        deepestPool: g.deepest,
        shellsTurned: g.shellsTurned
      };
    }

    function snapshot() {
      var s = state();
      var evs = new Array(g.events.length);
      for (var i = 0; i < g.events.length; i++) {
        var e = g.events[i], c = {};
        for (var k in e) c[k] = e[k];
        evs[i] = Object.freeze(c);
      }
      s.events = Object.freeze(evs);
      s.lastEvent = evs.length ? evs[evs.length - 1] : null;
      Object.freeze(s.rows);
      Object.freeze(s.rankLadder);
      if (s.stungAt) Object.freeze(s.stungAt);
      return Object.freeze(s);
    }

    /* ---------------------------------------------------------------- clock */

    function advance(ms) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return;
      if (g.phase !== 'playing') return;   // frozen while ready, frozen once ended
      g.acc += ms;
      var guard = 0;
      while (g.acc >= STEP && guard++ < 200000) { g.acc -= STEP; g.tick++; }
    }

    function reset(seed) {
      if (seed !== undefined && seed !== null) g.seed = String(seed);
      g.attempt++;
      g.phase = 'ready';
      g.tick = 0; g.acc = 0;
      g.revision = 0;
      g.pool = 1;
      g.pearls = 0;
      g.moves = 0;
      g.stungAt = null;
      g.rank = null;
      g.events = []; g.seq = 0;
      g.bestRipple = 0; g.deepest = 1; g.shellsTurned = 0; g.fastestClearTicks = null;
      g.fx.length = 0;
      g.fx.push({ t: 'reset' });
      setupPool();
    }

    if (initialSeed !== undefined && initialSeed !== null) g.seed = String(initialSeed);
    reset(g.seed);   // attempt 1 of the session

    return {
      model: g,                       // view-side read access; never exported to a global
      reset: reset,
      restart: function () { reset(g.seed); },
      advance: advance,
      applyAction: applyAction,
      state: state,
      snapshot: snapshot,
      tideFraction: tideFraction,
      takeFx: function () { var f = g.fx.slice(); g.fx.length = 0; return f; }
    };
  };
})();
