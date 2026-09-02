/* SHOAL - the proof engine.
   This is the guarantee behind "the water never lies": a candidate pool is
   only shipped to the player if this solver can clear it from its first turn
   using nothing but what the screen shows - the numbers, the shells already
   turned, and the public urchin counter.

   Three layers of reasoning, cheapest first:
     1. per-number rules   (satisfied -> rest safe / cornered -> rest urchins)
     2. subset rules       (one number's cells contained in another's)
     3. exact enumeration  of each frontier component, combined against the
        urchin counter, which is what makes the counter load bearing late.

   Because information is monotone, a board this solver can clear without a
   guess also guarantees that ANY position a proof-only player can reach has
   at least one provably safe covered shell. */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});

  var nbCache = {};
  function neighbors(w, h) {
    var key = w + 'x' + h;
    if (nbCache[key]) return nbCache[key];
    var n = w * h, arr = new Array(n);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var list = [];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
          }
        }
        arr[y * w + x] = Int32Array.from(list);
      }
    }
    nbCache[key] = arr;
    return arr;
  }
  S.neighbors = neighbors;

  var MAX_COMP = 30;      // frontier cells enumerated exactly
  var MAX_SOL = 30000;    // solutions per component before we give up on it
  var OPS_BUDGET = 3e6;   // deterministic work cap (no wall clock anywhere)

  function maskUpTo(k) {
    if (k < 0) return 0;
    if (k >= 30) return 0x3fffffff;
    return ((1 << (k + 1)) - 1) | 0;
  }

  /* Returns true when the board is fully clearable by proof alone. */
  S.solveNoGuess = function (w, h, mine, num, first, totalMines) {
    var n = w * h, nb = neighbors(w, h);
    var st = new Uint8Array(n); // 0 covered-unknown, 1 open, 2 proven urchin
    var opened = 0, known = 0, ops = 0;
    var target = n - totalMines;
    var stack = [];
    var unsound = false;   // belt and braces: a deduction must never open an urchin

    function openCell(i) {
      if (st[i] !== 0) return;
      stack.length = 0;
      stack.push(i);
      while (stack.length) {
        var c = stack.pop();
        if (st[c] !== 0) continue;
        if (mine[c]) { unsound = true; return; }
        st[c] = 1; opened++;
        if (num[c] === 0) {
          var l = nb[c];
          for (var k = 0; k < l.length; k++) if (st[l[k]] === 0) stack.push(l[k]);
        }
      }
    }

    if (mine[first]) return false;
    openCell(first);

    function trivialPass() {
      var changed = false;
      for (var i = 0; i < n; i++) {
        if (st[i] !== 1 || num[i] === 0) continue;
        var l = nb[i], k = 0, u = 0, j;
        for (j = 0; j < l.length; j++) {
          var s = st[l[j]];
          if (s === 2) k++; else if (s === 0) u++;
        }
        if (u === 0) continue;
        ops += l.length;
        var need = num[i] - k;
        if (need === 0) {
          for (j = 0; j < l.length; j++) if (st[l[j]] === 0) openCell(l[j]);
          changed = true;
        } else if (need === u) {
          for (j = 0; j < l.length; j++) if (st[l[j]] === 0) { st[l[j]] = 2; known++; }
          changed = true;
        }
      }
      return changed;
    }

    function buildConstraints() {
      var cons = [];
      for (var i = 0; i < n; i++) {
        if (st[i] !== 1 || num[i] === 0) continue;
        var l = nb[i], k = 0, cells = [];
        for (var j = 0; j < l.length; j++) {
          var s = st[l[j]];
          if (s === 2) k++; else if (s === 0) cells.push(l[j]);
        }
        if (cells.length) cons.push({ cells: cells, need: num[i] - k });
      }
      return cons;
    }

    var stamp = new Int32Array(n), stampId = 0;

    function subsetPass() {
      var cons = buildConstraints();
      var c = cons.length, i, j, a, b;
      var safeList = [], mineList = [];
      for (i = 0; i < c; i++) {
        b = cons[i];
        stampId++;
        for (j = 0; j < b.cells.length; j++) stamp[b.cells[j]] = stampId;
        for (var m = 0; m < c; m++) {
          if (m === i) continue;
          a = cons[m];
          if (a.cells.length >= b.cells.length) continue;
          ops += a.cells.length;
          var sub = true;
          for (j = 0; j < a.cells.length; j++) {
            if (stamp[a.cells[j]] !== stampId) { sub = false; break; }
          }
          if (!sub) continue;
          var d = b.need - a.need;
          var extra = b.cells.length - a.cells.length;
          if (d !== 0 && d !== extra) continue;
          // mark a's cells with a second stamp so we can find the difference
          var diff = [];
          for (j = 0; j < b.cells.length; j++) {
            var cell = b.cells[j], inA = false;
            for (var q = 0; q < a.cells.length; q++) if (a.cells[q] === cell) { inA = true; break; }
            if (!inA) diff.push(cell);
          }
          if (d === 0) { for (j = 0; j < diff.length; j++) safeList.push(diff[j]); }
          else { for (j = 0; j < diff.length; j++) mineList.push(diff[j]); }
        }
        if (safeList.length || mineList.length) break;
      }
      var changed = false;
      for (i = 0; i < safeList.length; i++) if (st[safeList[i]] === 0) { openCell(safeList[i]); changed = true; }
      for (i = 0; i < mineList.length; i++) if (st[mineList[i]] === 0) { st[mineList[i]] = 2; known++; changed = true; }
      return changed;
    }

    function conv(a, b, lim) {
      var r = 0;
      for (var k = 0; k <= lim; k++) if ((a >>> k) & 1) r |= (b << k);
      return r & maskUpTo(lim);
    }
    function anyPair(mask, T, R) {
      for (var k = 0; k <= R; k++) {
        if (((mask >>> k) & 1) && ((T >>> (R - k)) & 1)) return true;
      }
      return false;
    }

    /* Exact enumeration of the frontier, combined with the public counter. */
    function enumPass() {
      var cons = buildConstraints();
      var R = totalMines - known;
      if (R < 0) return false;
      var LIM = maskUpTo(R);

      var fid = new Int32Array(n).fill(-1);
      var fcells = [];
      var i, j, k;
      for (i = 0; i < cons.length; i++) {
        var cc = cons[i].cells;
        for (j = 0; j < cc.length; j++) {
          if (fid[cc[j]] < 0) { fid[cc[j]] = fcells.length; fcells.push(cc[j]); }
        }
      }
      var outside = [];
      for (i = 0; i < n; i++) if (st[i] === 0 && fid[i] < 0) outside.push(i);
      var O = outside.length;

      // union-find over frontier cells sharing a constraint
      var par = new Int32Array(fcells.length);
      for (i = 0; i < par.length; i++) par[i] = i;
      function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      function uni(a, b) { a = find(a); b = find(b); if (a !== b) par[b] = a; }
      for (i = 0; i < cons.length; i++) {
        var cl = cons[i].cells;
        for (j = 1; j < cl.length; j++) uni(fid[cl[0]], fid[cl[j]]);
      }
      var groups = new Map();
      for (i = 0; i < fcells.length; i++) {
        var r = find(i);
        if (!groups.has(r)) groups.set(r, { cells: [], cons: [] });
        groups.get(r).cells.push(i);
      }
      for (i = 0; i < cons.length; i++) {
        if (!cons[i].cells.length) continue;
        groups.get(find(fid[cons[i].cells[0]])).cons.push(cons[i]);
      }

      var comps = [];
      groups.forEach(function (grp) {
        var m = grp.cells.length;
        if (m > MAX_COMP) { comps.push({ countMask: maskUpTo(Math.min(m, R)), cells: null }); return; }
        var res = enumerateComponent(grp, R, LIM, fid);
        if (!res) comps.push({ countMask: maskUpTo(Math.min(m, R)), cells: null });
        else comps.push(res);
      });
      if (!comps.length && O === 0) return false;

      var K = comps.length;
      var pre = new Array(K + 1), suf = new Array(K + 1);
      pre[0] = 1;
      for (i = 0; i < K; i++) pre[i + 1] = conv(pre[i], comps[i].countMask, R);
      suf[K] = 1;
      for (i = K - 1; i >= 0; i--) suf[i] = conv(suf[i + 1], comps[i].countMask, R);
      var outMask = maskUpTo(Math.min(O, R));

      var safeList = [], mineList = [];
      for (i = 0; i < K; i++) {
        var comp = comps[i];
        if (!comp.cells) continue;
        var T = conv(conv(pre[i], suf[i + 1], R), outMask, R);
        for (j = 0; j < comp.cells.length; j++) {
          var gcell = fcells[comp.cells[j]];
          if (st[gcell] !== 0) continue;
          var canMine = anyPair(comp.mineMask[j], T, R);
          var canSafe = anyPair(comp.safeMask[j], T, R);
          if (!canMine && canSafe) safeList.push(gcell);
          else if (!canSafe && canMine) mineList.push(gcell);
        }
      }

      if (O > 0) {
        var A = pre[K], anyMine = false, anyNotAll = false;
        for (k = 0; k <= R; k++) {
          if (!((A >>> k) & 1)) continue;
          var o = R - k;
          if (o < 0 || o > O) continue;
          if (o > 0) anyMine = true;
          if (o < O) anyNotAll = true;
        }
        if (!anyMine && anyNotAll) { for (i = 0; i < O; i++) safeList.push(outside[i]); }
        else if (anyMine && !anyNotAll) { for (i = 0; i < O; i++) mineList.push(outside[i]); }
      }

      var changed = false;
      for (i = 0; i < safeList.length; i++) if (st[safeList[i]] === 0) { openCell(safeList[i]); changed = true; }
      for (i = 0; i < mineList.length; i++) if (st[mineList[i]] === 0) { st[mineList[i]] = 2; known++; changed = true; }
      return changed;
    }

    function enumerateComponent(grp, R, LIM, fid) {
      var cells = grp.cells, m = cells.length;
      var local = new Map();
      for (var i = 0; i < m; i++) local.set(cells[i], i);
      var cs = [];
      for (i = 0; i < grp.cons.length; i++) {
        var src = grp.cons[i], arr = [];
        for (var j = 0; j < src.cells.length; j++) arr.push(local.get(fid[src.cells[j]]));
        cs.push({ cells: arr, need: src.need, mines: 0, un: arr.length });
      }
      var cellCons = new Array(m);
      for (i = 0; i < m; i++) cellCons[i] = [];
      for (i = 0; i < cs.length; i++) for (j = 0; j < cs[i].cells.length; j++) cellCons[cs[i].cells[j]].push(i);

      // order cells constraint by constraint so pruning bites early
      var order = [], seen = new Uint8Array(m);
      for (i = 0; i < cs.length; i++) {
        for (j = 0; j < cs[i].cells.length; j++) {
          var c = cs[i].cells[j];
          if (!seen[c]) { seen[c] = 1; order.push(c); }
        }
      }
      for (i = 0; i < m; i++) if (!seen[i]) { seen[i] = 1; order.push(i); }

      var asg = new Uint8Array(m);
      var mineMask = new Int32Array(m), safeMask = new Int32Array(m);
      var countMask = 0, sols = 0, aborted = false;

      function dfs(pos, total) {
        if (aborted) return;
        if (++ops > OPS_BUDGET) { aborted = true; return; }
        if (total > R) return;
        if (pos === m) {
          if (++sols > MAX_SOL) { aborted = true; return; }
          ops += m; // recording a solution is real work; keep the budget honest
          countMask |= (1 << total);
          for (var i2 = 0; i2 < m; i2++) {
            if (asg[i2]) mineMask[i2] |= (1 << total);
            else safeMask[i2] |= (1 << total);
          }
          return;
        }
        var cell = order[pos], lst = cellCons[cell];
        for (var v = 1; v >= 0; v--) {
          var ok = true, q;
          for (q = 0; q < lst.length; q++) {
            var c2 = cs[lst[q]];
            c2.mines += v; c2.un--;
            if (c2.mines > c2.need || c2.mines + c2.un < c2.need) ok = false;
          }
          if (ok) { asg[cell] = v; dfs(pos + 1, total + v); }
          for (q = 0; q < lst.length; q++) {
            var c3 = cs[lst[q]];
            c3.mines -= v; c3.un++;
          }
          if (aborted) return;
        }
      }

      dfs(0, 0);
      if (aborted || countMask === 0) return null;
      return { cells: cells, mineMask: mineMask, safeMask: safeMask, countMask: countMask & LIM };
    }

    for (;;) {
      while (trivialPass()) { if (unsound) return false; if (opened === target) return true; }
      if (unsound) return false;
      if (opened === target) return true;
      if (ops > OPS_BUDGET) return false;
      if (subsetPass()) { if (unsound) return false; continue; }
      if (ops > OPS_BUDGET) return false;
      if (enumPass()) { if (unsound) return false; continue; }
      return false;
    }
  };
})();
