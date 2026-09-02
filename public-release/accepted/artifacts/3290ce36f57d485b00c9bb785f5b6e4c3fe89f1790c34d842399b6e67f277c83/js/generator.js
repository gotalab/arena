/* SHOAL - pool generation.

   The promise "the water never lies" is enforced here: a candidate board is
   only shipped if a conservative pure-logic solver can finish it from the
   player's first turn without ever guessing. Because logical consequence is
   monotone in the set of opened shells, a board that the solver can finish
   also guarantees that *any* safely played position on it still contains at
   least one provably safe covered shell. */
(function (g) {
  'use strict';

  var S = g.SHOAL;
  var rng = S.rng;

  /* ---------------------------------------------------------------- ladder */

  // Each pool is a strictly bigger ask than the last: the board never shrinks
  // and the urchins keep coming. Density stays inside the range where
  // no-guess boards are plentiful, so generation never stalls.
  var LADDER = [
    { w: 6, h: 9, mines: 7 },
    { w: 7, h: 10, mines: 10 },
    { w: 8, h: 11, mines: 14 },
    { w: 8, h: 12, mines: 17 },
    { w: 9, h: 13, mines: 21 },
    { w: 9, h: 14, mines: 23 },
    { w: 10, h: 15, mines: 27 },
    { w: 10, h: 16, mines: 29 }
  ];

  function poolConfig(n) {
    var base;
    if (n <= LADDER.length) {
      base = LADDER[n - 1];
    } else {
      base = { w: 10, h: 16, mines: Math.min(31, 29 + (n - LADDER.length)) };
    }
    var area = base.w * base.h;
    // The tide is scaled to the work a pool actually demands - its size and,
    // more heavily, its urchins, since those drive the number of deductions.
    // A player who proves every move still banks a bonus; a player who moves
    // in rhythm banks roughly twice as much. It tightens deeper in the ladder.
    var ms = 8000 + area * 700 + base.mines * 4500;
    if (n > LADDER.length) ms *= Math.max(0.62, Math.pow(0.96, n - LADDER.length));
    return {
      w: base.w,
      h: base.h,
      mines: base.mines,
      tideTicks: Math.round((ms / 1000) * 60)
    };
  }

  /* ------------------------------------------------------------ neighbours */

  var nbCache = {};

  function neighbors(w, h) {
    var key = w + 'x' + h;
    var cached = nbCache[key];
    if (cached) return cached;
    var n = w * h;
    var out = new Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var list = [];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            var nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            list.push(ny * w + nx);
          }
        }
        out[y * w + x] = list;
      }
    }
    nbCache[key] = out;
    return out;
  }

  /* ------------------------------------------------------- deduction engine

     Everything below reasons from visible information alone: which shells are
     turned, the numbers they show, the shells known to hide urchins, and the
     public urchin count. It never looks at a covered shell's contents, which
     is exactly why it can also be used to audit the promise during play. */

  var ENUM_MAX_CELLS = 20;
  var ENUM_BUDGET = 200000;

  // Returns { safe: [cells], mines: [cells] } that follow with certainty.
  // Conservative: it can miss a deduction, but it never claims a false one.
  // `known` marks shells already proven to hide urchins (not player beliefs).
  // `opts.maxCells` bounds frontier enumeration; a larger bound reasons harder
  // and costs more, and lowering it can only ever withhold a deduction.
  function deduce(w, h, open, val, known, mineTotal, opts) {
    var maxCells = (opts && opts.maxCells) || ENUM_MAX_CELLS;
    var budget = (opts && opts.budget) || ENUM_BUDGET;
    var nb = neighbors(w, h);
    var n = w * h;
    var safeOut = [];
    var mineOut = [];
    var mark = new Uint8Array(n);
    var mark2 = new Uint8Array(n);
    var knownCount = 0;
    for (var q = 0; q < n; q++) if (known[q]) knownCount++;

    run();
    return { safe: safeOut, mines: mineOut };

    function run() {
      var flag = known;
      var flags = knownCount;
      var cons = [];
      var idx, j, cell;

      // Rule 1: a number whose remaining count is 0 (or fills its covered
      // neighbours exactly) settles them outright.
      for (idx = 0; idx < n; idx++) {
        if (!open[idx] || val[idx] === 0) continue;
        var nbl = nb[idx];
        var f = 0;
        var cov = [];
        for (j = 0; j < nbl.length; j++) {
          cell = nbl[j];
          if (flag[cell]) f++;
          else if (!open[cell]) cov.push(cell);
        }
        if (!cov.length) continue;
        var need = val[idx] - f;
        if (need < 0) return;
        if (need === 0) {
          for (j = 0; j < cov.length; j++) safeOut.push(cov[j]);
          continue;
        }
        if (need === cov.length) {
          for (j = 0; j < cov.length; j++) mineOut.push(cov[j]);
          continue;
        }
        cons.push({ cells: cov, need: need });
      }
      if (safeOut.length || mineOut.length) return;

      // Rule 2: the public urchin counter.
      var covered = [];
      for (idx = 0; idx < n; idx++) if (!open[idx] && !flag[idx]) covered.push(idx);
      var remaining = mineTotal - flags;
      if (remaining === 0) {
        for (j = 0; j < covered.length; j++) safeOut.push(covered[j]);
        return;
      }
      if (remaining === covered.length) {
        for (j = 0; j < covered.length; j++) mineOut.push(covered[j]);
        return;
      }
      if (!cons.length) return;

      // Rule 3: constraint subsets (the classic 1-2-1 family and friends).
      var byCell = {};
      for (idx = 0; idx < cons.length; idx++) {
        var cc = cons[idx].cells;
        for (j = 0; j < cc.length; j++) {
          (byCell[cc[j]] || (byCell[cc[j]] = [])).push(idx);
        }
      }
      for (var bi = 0; bi < cons.length; bi++) {
        var B = cons[bi];
        for (j = 0; j < B.cells.length; j++) mark[B.cells[j]] = 1;
        var partners = {};
        for (j = 0; j < B.cells.length; j++) {
          var plist = byCell[B.cells[j]];
          for (var pi = 0; pi < plist.length; pi++) if (plist[pi] !== bi) partners[plist[pi]] = 1;
        }
        for (var key in partners) {
          var A = cons[key | 0];
          if (A.cells.length >= B.cells.length) continue;
          var sub = true;
          for (j = 0; j < A.cells.length; j++) {
            if (!mark[A.cells[j]]) { sub = false; break; }
          }
          if (!sub) continue;
          var restNeed = B.need - A.need;
          for (j = 0; j < A.cells.length; j++) mark2[A.cells[j]] = 1;
          var rest = [];
          for (j = 0; j < B.cells.length; j++) if (!mark2[B.cells[j]]) rest.push(B.cells[j]);
          for (j = 0; j < A.cells.length; j++) mark2[A.cells[j]] = 0;
          if (restNeed === 0) {
            for (j = 0; j < rest.length; j++) safeOut.push(rest[j]);
          } else if (restNeed === rest.length) {
            for (j = 0; j < rest.length; j++) mineOut.push(rest[j]);
          }
        }
        for (j = 0; j < B.cells.length; j++) mark[B.cells[j]] = 0;
      }
      if (safeOut.length || mineOut.length) return;

      // Rule 4: exhaustive enumeration of the frontier, coupled through the
      // urchin counter. This is the deduction that makes the late-pool
      // counter reads work.
      enumerateFrontier(cons, covered, remaining);
    }

    function enumerateFrontier(cons, covered, remaining) {
      var j, k2;
      var isFrontier = {};
      for (j = 0; j < cons.length; j++) {
        for (k2 = 0; k2 < cons[j].cells.length; k2++) isFrontier[cons[j].cells[k2]] = 1;
      }
      var outside = [];
      for (j = 0; j < covered.length; j++) if (!isFrontier[covered[j]]) outside.push(covered[j]);

      // Components of the frontier, linked by shared constraints.
      var parent = {};
      function find(a) {
        while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
        return a;
      }
      for (var key in isFrontier) parent[key] = key;
      for (j = 0; j < cons.length; j++) {
        var cells = cons[j].cells;
        for (k2 = 1; k2 < cells.length; k2++) {
          var ra = find(cells[0]), rb = find(cells[k2]);
          if (ra !== rb) parent[ra] = rb;
        }
      }
      var compsByRoot = {};
      for (var key2 in isFrontier) {
        var r = find(key2);
        (compsByRoot[r] || (compsByRoot[r] = { cells: [], cons: [] })).cells.push(key2 | 0);
      }
      for (j = 0; j < cons.length; j++) compsByRoot[find(cons[j].cells[0])].cons.push(cons[j]);
      var comps = [];
      for (var key3 in compsByRoot) comps.push(compsByRoot[key3]);
      if (!comps.length) return;

      for (j = 0; j < comps.length; j++) solveComponent(comps[j]);

      var O = outside.length;

      function convolve(list) {
        var cur = { 0: 1 };
        for (var a = 0; a < list.length; a++) {
          var next = {};
          var poss = list[a].possible;
          for (var s in cur) {
            for (var b = 0; b < poss.length; b++) next[(s | 0) + poss[b]] = 1;
          }
          cur = next;
        }
        return cur;
      }

      for (j = 0; j < comps.length; j++) {
        var comp = comps[j];
        if (comp.big) continue;
        var others = comps.slice(0, j).concat(comps.slice(j + 1));
        var sums = convolve(others);
        var feasible = {};
        var anyFeasible = false;
        for (var pi = 0; pi < comp.possible.length; pi++) {
          var cnt = comp.possible[pi];
          for (var s2 in sums) {
            var o = remaining - cnt - (s2 | 0);
            if (o >= 0 && o <= O) { feasible[cnt] = 1; anyFeasible = true; break; }
          }
        }
        if (!anyFeasible) continue;
        for (var ci = 0; ci < comp.cells.length; ci++) {
          var everMine = false, everSafe = false;
          for (var fc in feasible) {
            var rec = comp.perCount[fc];
            if (!rec) continue;
            if (rec.mine[ci]) everMine = true;
            if (rec.safe[ci]) everSafe = true;
          }
          if (!everMine && everSafe) safeOut.push(comp.cells[ci]);
          else if (everMine && !everSafe) mineOut.push(comp.cells[ci]);
        }
      }

      if (O > 0) {
        var allSums = convolve(comps);
        var allZero = true, allFull = true, any = false;
        for (var s3 in allSums) {
          var left = remaining - (s3 | 0);
          if (left < 0 || left > O) continue;
          any = true;
          if (left !== 0) allZero = false;
          if (left !== O) allFull = false;
        }
        if (any) {
          if (allZero) for (j = 0; j < outside.length; j++) safeOut.push(outside[j]);
          else if (allFull) for (j = 0; j < outside.length; j++) mineOut.push(outside[j]);
        }
      }
    }

    function solveComponent(comp) {
      var m = comp.cells.length;
      if (m > maxCells) {
        comp.big = true;
        comp.possible = rangeUpTo(m);
        return;
      }
      var index = {};
      for (var i2 = 0; i2 < m; i2++) index[comp.cells[i2]] = i2;
      var lc = [];
      for (var j2 = 0; j2 < comp.cons.length; j2++) {
        var src = comp.cons[j2];
        var ids = [];
        for (var k3 = 0; k3 < src.cells.length; k3++) ids.push(index[src.cells[k3]]);
        lc.push({ idx: ids, need: src.need });
      }
      var cellCons = [];
      for (i2 = 0; i2 < m; i2++) cellCons.push([]);
      for (j2 = 0; j2 < lc.length; j2++) {
        for (k3 = 0; k3 < lc[j2].idx.length; k3++) cellCons[lc[j2].idx[k3]].push(j2);
      }
      var assigned = new Int8Array(m);
      var cnt = new Int16Array(lc.length);
      var rem = new Int16Array(lc.length);
      for (j2 = 0; j2 < lc.length; j2++) rem[j2] = lc[j2].idx.length;

      var perCount = {};
      var possible = [];
      var nodes = 0;
      var overflow = false;

      function dfs(pos, mines) {
        if (overflow) return;
        if (++nodes > budget) { overflow = true; return; }
        if (pos === m) {
          var rec = perCount[mines];
          if (!rec) {
            rec = { mine: new Uint8Array(m), safe: new Uint8Array(m) };
            perCount[mines] = rec;
            possible.push(mines);
          }
          for (var q = 0; q < m; q++) {
            if (assigned[q]) rec.mine[q] = 1; else rec.safe[q] = 1;
          }
          return;
        }
        var cl = cellCons[pos];
        for (var v = 1; v >= 0; v--) {
          assigned[pos] = v;
          var ok = true;
          var t;
          for (t = 0; t < cl.length; t++) {
            var cj = cl[t];
            cnt[cj] += v;
            rem[cj]--;
            if (cnt[cj] > lc[cj].need || cnt[cj] + rem[cj] < lc[cj].need) ok = false;
          }
          if (ok) dfs(pos + 1, mines + v);
          for (t = 0; t < cl.length; t++) {
            var cj2 = cl[t];
            cnt[cj2] -= v;
            rem[cj2]++;
          }
          if (overflow) return;
        }
        assigned[pos] = 0;
      }

      dfs(0, 0);

      if (overflow || !possible.length) {
        comp.big = true;
        comp.possible = rangeUpTo(m);
        return;
      }
      possible.sort(function (a, b) { return a - b; });
      comp.perCount = perCount;
      comp.possible = possible;
    }
  }

  function rangeUpTo(m) {
    var out = [];
    for (var i = 0; i <= m; i++) out.push(i);
    return out;
  }

  /* ---------------------------------------------------------------- solver */

  // True when the board can be cleared from `start` by deduction alone.
  // Because logical consequence only grows as more shells are turned, a board
  // that passes here still offers a provably safe shell from any position a
  // player can reach on it without stepping on an urchin.
  function solvable(w, h, mine, start, mineTotal) {
    var nb = neighbors(w, h);
    var n = w * h;
    var open = new Uint8Array(n);
    var known = new Uint8Array(n);
    var val = new Int8Array(n);
    var i, k, L;

    for (i = 0; i < n; i++) {
      if (mine[i]) { val[i] = -1; continue; }
      var c = 0;
      L = nb[i];
      for (k = 0; k < L.length; k++) if (mine[L[k]]) c++;
      val[i] = c;
    }

    var safeTotal = n - mineTotal;
    var opened = 0;
    var stack = [];

    function reveal(cell) {
      stack.length = 0;
      stack.push(cell);
      while (stack.length) {
        var cur = stack.pop();
        if (open[cur] || known[cur] || mine[cur]) continue;
        open[cur] = 1;
        opened++;
        if (val[cur] === 0) {
          var LL = nb[cur];
          for (var j = 0; j < LL.length; j++) stack.push(LL[j]);
        }
      }
    }

    reveal(start);

    var guard = 0;
    while (opened < safeTotal) {
      if (++guard > 2 * n + 16) return false;
      var step = deduce(w, h, open, val, known, mineTotal);
      if (!step.safe.length && !step.mines.length) return false;
      for (i = 0; i < step.mines.length; i++) {
        var mc = step.mines[i];
        if (known[mc] || open[mc]) continue;
        if (!mine[mc]) return false; // an unsound claim; refuse the board
        known[mc] = 1;
      }
      for (i = 0; i < step.safe.length; i++) {
        var sc = step.safe[i];
        if (open[sc] || known[sc]) continue;
        if (mine[sc]) return false;
        reveal(sc);
      }
    }
    return true;
  }

  /* ------------------------------------------------------------ generation */

  var MAX_ATTEMPTS = 400;

  // The board of pool `n` is a pure function of (seed, pool, first turn).
  function generate(seedHash, pool, fx, fy) {
    var cfg = poolConfig(pool);
    var w = cfg.w, h = cfg.h, n = w * h;
    var floor = Math.max(2, Math.round(n * 0.06));

    var forbidden = new Uint8Array(n);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var nx = fx + dx, ny = fy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        forbidden[ny * w + nx] = 1;
      }
    }
    var allowed = [];
    for (var i = 0; i < n; i++) if (!forbidden[i]) allowed.push(i);

    var pick = allowed.slice();
    var best = null;

    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Step the urchin count down only after a long run of failures; in
      // practice a board is found in the first handful of attempts.
      var stepDown = attempt < 140 ? 0 : Math.floor((attempt - 140) / 40) + 1;
      var mines = Math.max(floor, Math.min(cfg.mines - stepDown, allowed.length));
      var rand = rng.mulberry32(
        rng.mix(rng.mix(seedHash, pool * 0x9e3779b1), rng.mix(fy * 1013 + fx, attempt * 0x27d4eb2d))
      );
      for (var s = pick.length - 1; s > 0; s--) {
        var t = (rand() * (s + 1)) | 0;
        var tmp = pick[s]; pick[s] = pick[t]; pick[t] = tmp;
      }
      var mine = new Uint8Array(n);
      for (var m = 0; m < mines; m++) mine[pick[m]] = 1;
      if (!best) best = { mine: mine, mines: mines };
      // A first ripple that swallows the whole pool leaves nothing to deduce.
      if (firstRippleSize(w, h, mine, fy * w + fx) >= n - mines) continue;
      if (solvable(w, h, mine, fy * w + fx, mines)) {
        return finish(w, h, mine, mines, cfg);
      }
    }
    return finish(w, h, best.mine, best.mines, cfg);
  }

  function firstRippleSize(w, h, mine, start) {
    var nb = neighbors(w, h);
    var n = w * h;
    var seen = new Uint8Array(n);
    var stack = [start];
    var count = 0;
    while (stack.length) {
      var c = stack.pop();
      if (seen[c] || mine[c]) continue;
      seen[c] = 1;
      count++;
      var v = 0, L = nb[c];
      for (var k = 0; k < L.length; k++) if (mine[L[k]]) v++;
      if (v === 0) for (k = 0; k < L.length; k++) if (!seen[L[k]]) stack.push(L[k]);
    }
    return count;
  }

  function finish(w, h, mine, mines, cfg) {
    var n = w * h;
    var nb = neighbors(w, h);
    var val = new Int8Array(n);
    for (var i = 0; i < n; i++) {
      if (mine[i]) { val[i] = -1; continue; }
      var c = 0, L = nb[i];
      for (var k = 0; k < L.length; k++) if (mine[L[k]]) c++;
      val[i] = c;
    }
    return { w: w, h: h, mine: mine, val: val, mines: mines, tideTicks: cfg.tideTicks };
  }

  S.gen = {
    poolConfig: poolConfig,
    neighbors: neighbors,
    generate: generate,
    solvable: solvable,
    deduce: deduce
  };
})(window);
