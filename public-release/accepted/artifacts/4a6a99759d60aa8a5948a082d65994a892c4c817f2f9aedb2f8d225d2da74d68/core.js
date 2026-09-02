/* ============================================================================
   SHOAL — core logic
   The production state machine. Pure JS, no DOM. Shared by the human input,
   the runtime interface (window.__ARENA_GAME__) and the Arena parent bridge.
   ============================================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ShoalCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TICKS_PER_SEC = 60;
  var TICK_MS = 1000 / TICKS_PER_SEC;

  /* ---------------- deterministic RNG ---------------- */
  function xmur3(str) {
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function mulberry32(a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedHash(seed, parts) {
    var s = String(seed);
    for (var i = 0; i < parts.length; i++) s += "|" + parts[i];
    return xmur3(s)();
  }

  /* ---------------- ladder configuration ---------------- */
  var MAX_POOLS = 16;
  var CELL_BUDGET_MS = 2000; // tide budget ms per cell of the pool
  var SHELL_PEARL = 1;
  var BONUS_BASE = 10;
  var BONUS_PER_POOL = 8;

  var RANK_LADDER = ["Pebble", "Sand Dollar", "Starfish", "Hermit Crab", "Lobster", "Tidecaller", "Urchin King"];
  var RANK_THRESHOLDS = [0, 50, 120, 200, 290, 390, 500];

  function poolSpec(pool) {
    var w, h, u;
    if (pool <= 0) { w = 0; h = 0; u = 0; }
    else if (pool === 1) { w = 5; h = 7; u = 4; }
    else if (pool === 2) { w = 5; h = 8; u = 5; }
    else if (pool === 3) { w = 6; h = 8; u = 6; }
    else if (pool === 4) { w = 6; h = 9; u = 7; }
    else if (pool === 5) { w = 7; h = 9; u = 8; }
    else if (pool === 6) { w = 7; h = 10; u = 9; }
    else if (pool === 7) { w = 8; h = 10; u = 11; }
    else {
      w = 8; h = 10; u = 11 + (pool - 7) * 2;
      if (u > 18) u = 18;
    }
    return { w: w, h: h, urchins: u };
  }

  /* ---------------- grid helpers ---------------- */
  function idx(W, x, y) { return y * W + x; }
  function nbrs(W, H, i) {
    var x = i % W, y = (i / W) | 0;
    var out = [];
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(idx(W, nx, ny));
      }
    }
    return out;
  }
  function numAt(W, H, urch, i) {
    var c = 0;
    var ns = nbrs(W, H, i);
    for (var k = 0; k < ns.length; k++) if (urch[ns[k]]) c++;
    return c;
  }

  /* ---------------- flood reveal (ripple) ---------------- */
  // urch: Uint8Array length W*H. rev: Uint8Array mutated.
  function revealFlood(W, H, urch, rev, start) {
    var stack = [start];
    while (stack.length) {
      var i = stack.pop();
      if (rev[i]) continue;
      rev[i] = 1;
      if (numAt(W, H, urch, i) === 0) {
        var ns = nbrs(W, H, i);
        for (var k = 0; k < ns.length; k++) {
          var j = ns[k];
          if (!urch[j] && !rev[j]) stack.push(j);
        }
      }
    }
  }

  /* ---------------- solvability solver ---------------- */
  // Returns true if the whole board can be cleared using trivial + pairwise
  // subset deduction starting from the initial ripple at (fx,fy).
  function isSolvable(W, H, urch, fx, fy) {
    var total = W * H;
    var rev = new Uint8Array(total);
    revealFlood(W, H, urch, rev, idx(W, fx, fy));
    var known = new Uint8Array(total); // deduced urchins
    var allRevealed = [];
    var coveredOf = new Array(total);
    function covered(i) {
      var ns = nbrs(W, H, i), arr = [];
      for (var k = 0; k < ns.length; k++) if (!rev[ns[k]]) arr.push(ns[k]);
      return arr;
    }
    var numCache = new Array(total);
    for (var i = 0; i < total; i++) numCache[i] = numAt(W, H, urch, i);

    function reveal(i) {
      if (rev[i]) return 0;
      rev[i] = 1;
      if (numCache[i] === 0) {
        var ns = nbrs(W, H, i);
        for (var k = 0; k < ns.length; k++) {
          var j = ns[k];
          if (!urch[j] && !rev[j]) reveal(j);
        }
      }
      return 1;
    }

    var guard = 0;
    while (true) {
      if (++guard > total * total * 4) return false;
      var changed = false;

      // trivial constraints
      var items = [];
      for (i = 0; i < total; i++) if (rev[i]) items.push(i);
      for (var a = 0; a < items.length; a++) {
        var ci = items[a];
        var cov = covered(ci);
        var n = numCache[ci];
        var knownAm = 0, unk = [];
        for (var k = 0; k < cov.length; k++) {
          if (known[cov[k]]) knownAm++;
          else unk.push(cov[k]);
        }
        if (knownAm === n) {
          for (k = 0; k < unk.length; k++) { reveal(unk[k]); changed = true; }
        } else if (knownAm + unk.length === n) {
          for (k = 0; k < unk.length; k++) { known[unk[k]] = 1; changed = true; }
        }
      }

      // pairwise subset (covered neighbor sets)
      for (var ai = 0; ai < items.length && !changed; ai++) {
        var ia = items[ai];
        var A = covered(ia);
        var nA = numCache[ia];
        var knownA = 0, unkA = [];
        for (var ka = 0; ka < A.length; ka++) { if (known[A[ka]]) knownA++; else unkA.push(A[ka]); }
        for (var bi = 0; bi < items.length; bi++) {
          if (ai === bi) continue;
          var ib = items[bi];
          var B = covered(ib);
          // subset A ⊆ B
          var ok = A.length > 0 && A.length <= B.length;
          if (ok) {
            for (var m = 0; m < A.length; m++) {
              var found = false;
              for (var m2 = 0; m2 < B.length; m2++) if (B[m2] === A[m]) { found = true; break; }
              if (!found) { ok = false; break; }
            }
          }
          if (!ok) continue;
          var nB = numCache[ib];
          var knownB = 0, unkB = [];
          for (var kb = 0; kb < B.length; kb++) { if (known[B[kb]]) knownB++; else unkB.push(B[kb]); }
          var needA = nA - knownA;
          var needB = nB - knownB;
          // extra = B \ A
          var extraUnk = [];
          for (kb = 0; kb < unkB.length; kb++) {
            var inA = false;
            for (m = 0; m < A.length; m++) if (A[m] === unkB[kb]) { inA = true; break; }
            if (!inA) extraUnk.push(unkB[kb]);
          }
          if (needB - needA === extraUnk.length && extraUnk.length > 0) {
            for (m = 0; m < extraUnk.length; m++) { known[extraUnk[m]] = 1; changed = true; }
          } else if (needB === needA && extraUnk.length > 0) {
            for (m = 0; m < extraUnk.length; m++) { reveal(extraUnk[m]); changed = true; }
          }
          if (changed) break;
        }
      }

      if (!changed) break;
    }

    for (i = 0; i < total; i++) if (!urch[i] && !rev[i]) return false;
    return true;
  }

  /* ---------------- board generation ---------------- */
  // Returns Uint8Array urch placement, or throws if none found.
  function generateBoard(seed, pool, fx, fy) {
    var spec = poolSpec(pool);
    var W = spec.w, H = spec.h, target = spec.urchins;
    var total = W * H;
    var start = idx(W, fx, fy);
    var blocked = nbrs(W, H, start);
    blocked.push(start);
    var blockedSet = new Uint8Array(total);
    for (var b = 0; b < blocked.length; b++) blockedSet[blocked[b]] = 1;
    var candidates = [];
    for (var i = 0; i < total; i++) if (!blockedSet[i]) candidates.push(i);
    if (candidates.length < target) throw new Error("pool too dense");

    for (var salt = 0; salt < 6000; salt++) {
      var rng = mulberry32(seedHash(seed, [pool, fx + "," + fy, salt]));
      var urch = new Uint8Array(total);
      // weighted scatter: pick target distinct candidates
      var picked = [];
      var poolArr = candidates.slice();
      for (var t = 0; t < target; t++) {
        var r = Math.floor(rng() * poolArr.length);
        picked.push(poolArr[r]);
        poolArr[r] = poolArr[poolArr.length - 1];
        poolArr.pop();
      }
      for (t = 0; t < picked.length; t++) urch[picked[t]] = 1;
      if (isSolvable(W, H, urch, fx, fy)) return urch;
    }
    throw new Error("no solvable board for seed " + seed + " pool " + pool);
  }

  /* ==========================================================================
     The game core
     ========================================================================== */
  function ArenaGame() {
    this.attempt = 0;
    this.sessionBest = 0;
    this.seed = 1;
    this._resetState();
  }

  ArenaGame.prototype._resetState = function () {
    this.phase = "ready";
    this.tick = 0;
    this.elapsedMs = 0;
    this.revision = 0;
    this.pool = 1;
    this.pearls = 0;
    this.moves = 0;
    this.rank = null;
    this.rankLadder = RANK_LADDER.slice();
    this.events = [];
    this.lastEvent = null;
    this.seq = 0;

    // pool state
    this.gridWidth = poolSpec(1).w;
    this.gridHeight = poolSpec(1).h;
    this.urchinsTotal = poolSpec(1).urchins;
    this.flagsPlaced = 0;
    this.urchinsLeft = this.urchinsTotal;
    this.tideFraction = 1;
    this.tideStartTick = 0;
    this.tideBudget = 0;
    this.firstTurnDone = false;
    this.stungAt = null;
    this._accMs = 0;
    this._extBudgetMs = 0;

    // board internals
    this._urch = null;          // Uint8Array once first turn done
    this._rev = new Uint8Array(this.gridWidth * this.gridHeight); // revealed
    this._flg = new Uint8Array(this.gridWidth * this.gridHeight); // pennants

    // run stats
    this.biggestRipple = 0;
    this.fastestClearMs = Infinity;
    this.poolStartTick = 0;
    this._poolClearRipple = 0;
  };

  ArenaGame.prototype._initPool = function (pool) {
    var spec = poolSpec(pool);
    this.pool = pool;
    this.gridWidth = spec.w;
    this.gridHeight = spec.h;
    this.urchinsTotal = spec.urchins;
    this.urchinsLeft = this.urchinsTotal;
    this.flagsPlaced = 0;
    this.firstTurnDone = false;
    this.stungAt = null;
    this.tideFraction = 1;
    this.tideBudget = spec.w * spec.h * CELL_BUDGET_MS;
    this._urch = null;
    this._rev = new Uint8Array(spec.w * spec.h);
    this._flg = new Uint8Array(spec.w * spec.h);
    this.poolStartTick = this.tick;
  };

  ArenaGame.prototype.reset = function (seed) {
    this.seed = (seed === undefined || seed === null) ? 1 : seed;
    this.attempt++;
    this._resetState();
    this._initPool(1);
    return this.snapshot();
  };

  ArenaGame.prototype.restart = function () {
    return this.reset(this.seed);
  };

  ArenaGame.prototype.snapshot = function () {
    return this._snapshot(true);
  };

  ArenaGame.prototype._snapshot = function (includeEvents) {
    var s = {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.floor(this.elapsedMs),
      seed: this.seed,
      attempt: this.attempt,
      revision: this.revision,
      pool: this.pool,
      pearls: this.pearls,
      sessionBest: this.sessionBest,
      moves: this.moves,
      rank: this.rank,
      rankLadder: this.rankLadder,

      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      urchinsTotal: this.urchinsTotal,
      flagsPlaced: this.flagsPlaced,
      urchinsLeft: this.urchinsLeft,
      tideFraction: round2(this.tideFraction),
      firstTurnDone: this.firstTurnDone,
      stungAt: this.stungAt ? { x: this.stungAt.x, y: this.stungAt.y } : null,
      biggestRipple: this.biggestRipple,
      fastestClearMs: this.fastestClearMs === Infinity ? -1 : this.fastestClearMs,

      rows: this._rows()
    };
    if (includeEvents) {
      s.events = this.events.slice();
      s.lastEvent = this.lastEvent ? shallow(this.lastEvent) : null;
    }
    return s;
  };

  function round2(n) { return Math.round(n * 100) / 100; }
  function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  ArenaGame.prototype._rows = function () {
    var W = this.gridWidth, H = this.gridHeight;
    var ended = this.phase === "ended";
    var rows = [];
    for (var y = 0; y < H; y++) {
      var line = "";
      for (var x = 0; x < W; x++) {
        var i = idx(W, x, y);
        line += this._cellChar(i, ended);
      }
      rows.push(line);
    }
    return rows;
  };

  ArenaGame.prototype._cellChar = function (i, ended) {
    var W = this.gridWidth;
    var fl = this._flg[i];
    var rv = this._rev[i];
    var isU = this._urch ? this._urch[i] : false;
    if (ended) {
      if (fl) return isU ? "+" : "-";
      if (rv) {
        if (isU) {
          if (this.stungAt && idx(W, this.stungAt.x, this.stungAt.y) === i) return "X";
          return "*";
        }
        return String(numAt(W, this.gridHeight, this._urch, i));
      }
      return isU ? "*" : "#";
    }
    // playing / ready
    if (fl) return "F";
    if (rv) {
      // only safe cells are revealed while playing
      return String(numAt(W, this.gridHeight, this._urch, i));
    }
    return "#";
  };

  /* ---- actions ---- */
  ArenaGame.prototype.act = function (action) {
    if (!action || typeof action !== "object") return this._reject("bad_action", "malformed action");
    var type = action.type;
    var x = action.x, y = action.y;
    var W = this.gridWidth, H = this.gridHeight;
    if (typeof x !== "number" || typeof y !== "number" || x !== (x | 0) || y !== (y | 0)) {
      return this._reject("bad_action", "malformed action");
    }
    if (x < 0 || x >= W || y < 0 || y >= H) return this._reject("out_of_bounds", "off the board");
    if (this.phase === "ended") return this._reject("run_over", "the run has ended");

    var i = idx(W, x, y);
    switch (type) {
      case "open": return this._open(x, y, i);
      case "flag": return this._flag(x, y, i);
      case "unflag": return this._unflag(x, y, i);
      case "sweep": return this._sweep(x, y, i);
      default: return this._reject("bad_action", "unknown action");
    }
  };

  ArenaGame.prototype._reject = function (code, message) {
    return { ok: false, error: { code: code, message: message }, state: this.snapshot() };
  };
  ArenaGame.prototype._accept = function () {
    this.revision++;
    return { ok: true, error: null, state: this.snapshot() };
  };

  ArenaGame.prototype._begin = function () {
    if (this.phase === "ready") {
      this.phase = "playing";
    }
  };

  ArenaGame.prototype._open = function (x, y, i) {
    if (this._rev[i] || this._flg[i]) return this._reject("already", "cannot turn that shell");
    this._begin();
    this._ensureBoard(x, y);
    if (this._urch[i]) return this._sting(x, y, i);
    var opened = this._revealCell(i);
    this._addEvent("open", { opened: opened });
    this.moves++;
    this._afterOpen();
    this._checkClear();
    return this._accept();
  };

  ArenaGame.prototype._flag = function (x, y, i) {
    if (this._rev[i]) return this._reject("already", "that shell is already open");
    if (this._flg[i]) return this._reject("already", "pennant already planted");
    this._flg[i] = 1;
    this.flagsPlaced++;
    this.urchinsLeft = this.urchinsTotal - this.flagsPlaced;
    this.moves++;
    this._addEvent("flag", {});
    return this._accept();
  };

  ArenaGame.prototype._unflag = function (x, y, i) {
    if (!this._flg[i]) return this._reject("already", "no pennant to lift");
    this._flg[i] = 0;
    this.flagsPlaced--;
    this.urchinsLeft = this.urchinsTotal - this.flagsPlaced;
    this.moves++;
    this._addEvent("unflag", {});
    return this._accept();
  };

  ArenaGame.prototype._sweep = function (x, y, i) {
    if (!this._rev[i] || this._urch[i]) return this._reject("bad_action", "not a turned number");
    this._begin();
    var n = numAt(this.gridWidth, this.gridHeight, this._urch, i);
    var ns = nbrs(this.gridWidth, this.gridHeight, i);
    var flags = 0, unknown = [];
    for (var k = 0; k < ns.length; k++) {
      var j = ns[k];
      if (this._flg[j]) flags++;
      else if (!this._rev[j]) unknown.push(j);
    }
    if (flags !== n) return this._reject("unsatisfied", "pennants do not match that number");
    // check for urchins among unknown
    for (k = 0; k < unknown.length; k++) {
      if (this._urch[unknown[k]]) return this._sting(x, y, unknown[k]);
    }
    var opened = 0;
    for (k = 0; k < unknown.length; k++) opened += this._revealCell(unknown[k]);
    this._addEvent("sweep", { opened: opened });
    this.moves++;
    this._afterOpen();
    this._checkClear();
    return this._accept();
  };

  ArenaGame.prototype._ensureBoard = function (fx, fy) {
    if (this._urch) return;
    this._urch = generateBoard(this.seed, this.pool, fx, fy);
    this.firstTurnDone = true;
    this.tideStartTick = this.tick;
  };

  // Reveal a single safe cell with ripple; returns count opened.
  ArenaGame.prototype._revealCell = function (start) {
    var W = this.gridWidth, H = this.gridHeight;
    var urch = this._urch, rev = this._rev, flg = this._flg;
    var count = 0;
    var stack = [start];
    while (stack.length) {
      var i = stack.pop();
      if (rev[i] || urch[i]) continue;
      rev[i] = 1;
      count++;
      if (numAt(W, H, urch, i) === 0) {
        var ns = nbrs(W, H, i);
        for (var k = 0; k < ns.length; k++) {
          var j = ns[k];
          if (!urch[j] && !rev[j] && !flg[j]) stack.push(j);
        }
      }
    }
    this.pearls += count * SHELL_PEARL;
    this._poolClearRipple = Math.max(this._poolClearRipple, count);
    return count;
  };

  ArenaGame.prototype._afterOpen = function () {
    this.biggestRipple = Math.max(this.biggestRipple, this._poolClearRipple);
  };

  ArenaGame.prototype._checkClear = function () {
    var W = this.gridWidth, H = this.gridHeight;
    var urch = this._urch, rev = this._rev;
    for (var i = 0; i < W * H; i++) {
      if (!urch[i] && !rev[i]) return; // still safe shells covered
    }
    // pool cleared
    var tide = this.tideFraction;
    var bonus = Math.round((BONUS_BASE + BONUS_PER_POOL * this.pool) * tide);
    this.pearls += bonus;
    if (this.biggestRipple === 0) this.biggestRipple = this._poolClearRipple;
    var clearMs = (this.tick - this.poolStartTick) * TICK_MS;
    if (clearMs < this.fastestClearMs) this.fastestClearMs = clearMs;
    this._addEvent("pool_clear", { pool: this.pool, bonus: bonus });
    var next = this.pool + 1;
    if (next > MAX_POOLS) {
      this._endRun();
    } else {
      this._initPool(next);
      this._poolClearRipple = 0;
    }
  };

  ArenaGame.prototype._sting = function (x, y, i) {
    this.stungAt = { x: x, y: y };
    this._rev[i] = 1; // the fatal shell counts as revealed ('X')
    this.phase = "ended";
    this._addEvent("sting", { x: x, y: y });
    this._endRun();
    return this._accept();
  };

  ArenaGame.prototype._endRun = function () {
    this.phase = "ended";
    this.rank = this._grade(this.pearls);
    if (this.pearls > this.sessionBest) this.sessionBest = this.pearls;
    this._addEvent("run_end", { rank: this.rank });
  };

  ArenaGame.prototype._grade = function (pearls) {
    var g = RANK_LADDER[0];
    for (var i = 0; i < RANK_THRESHOLDS.length; i++) {
      if (pearls >= RANK_THRESHOLDS[i]) g = RANK_LADDER[i];
    }
    return g;
  };

  ArenaGame.prototype._addEvent = function (kind, extra) {
    this.seq++;
    var ev = { seq: this.seq, kind: kind, tick: this.tick };
    for (var k in extra) ev[k] = extra[k];
    this.events.push(ev);
    if (this.events.length > 200) this.events.shift();
    this.lastEvent = ev;
  };

  /* ---- clock ---- */
  ArenaGame.prototype.advance = function (ms) {
    if (this.phase !== "playing") return;
    if (!(ms > 0)) return;
    this._extBudgetMs += ms;
    this._accMs += ms;
    while (this._accMs >= TICK_MS) {
      this._accMs -= TICK_MS;
      this._step();
    }
  };

  // Called by the game's own frame loop with real wall-clock elapsed ms.
  // External advance(ms) is treated as already-covered wall time so the two
  // never double-count: the snapshot after advance(ms) equals waiting ms.
  ArenaGame.prototype.stepWall = function (dt) {
    if (this.phase !== "playing") return;
    if (!(dt > 0)) return;
    var eff = dt;
    if (this._extBudgetMs > 0) {
      var spent = this._extBudgetMs < eff ? this._extBudgetMs : eff;
      this._extBudgetMs -= spent;
      eff -= spent;
    }
    if (eff <= 0) return;
    this._accMs += eff;
    while (this._accMs >= TICK_MS) {
      this._accMs -= TICK_MS;
      this._step();
    }
  };

  ArenaGame.prototype._step = function () {
    this.tick++;
    if (this.firstTurnDone && this.phase === "playing") {
      var frac = 1 - (this.tick - this.tideStartTick) * TICK_MS / this.tideBudget;
      this.tideFraction = frac < 0 ? 0 : frac;
    }
    this.elapsedMs = this.tick * TICK_MS;
  };

  /* ---- bridge-facing helpers ---- */
  ArenaGame.prototype.visibleState = function () {
    return this._snapshot(false);
  };

  return {
    ArenaGame: ArenaGame,
    RANK_LADDER: RANK_LADDER,
    RANK_THRESHOLDS: RANK_THRESHOLDS,
    poolSpec: poolSpec,
    generateBoard: generateBoard,
    isSolvable: isSolvable,
    TICK_MS: TICK_MS,
    MAX_POOLS: MAX_POOLS,
    _seedHash: seedHash,
    _mulberry32: mulberry32
  };
});
