/* SHOAL — deterministic production engine. No DOM, no wall clock, no Math.random. */
(function (global) {
  "use strict";

  var TICK_HZ = 60;
  var EVENT_CAP = 200;
  var RANK_LADDER = ["foam", "ripple", "shoal", "current", "spring", "abyss"];
  var RANK_MIN = [0, 35, 110, 260, 480, 820];
  var D8 = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];

  function hashSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) {
      return seed >>> 0;
    }
    var s = String(seed == null ? 1 : seed);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mix32() {
    var h = 0x9e3779b9;
    for (var i = 0; i < arguments.length; i++) {
      h ^= arguments[i] >>> 0;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    var t = a >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      var x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rankFor(pearls) {
    var r = RANK_LADDER[0];
    for (var i = 0; i < RANK_LADDER.length; i++) {
      if (pearls >= RANK_MIN[i]) r = RANK_LADDER[i];
    }
    return r;
  }

  function poolConfig(pool) {
    var p = Math.max(1, pool | 0);
    var i = p - 1;
    var w = Math.min(8, 6 + Math.floor(i / 2));
    var h = Math.min(12, 8 + Math.floor(i * 0.65));
    var cells = w * h;
    var mines = Math.round(5 + i * 2.05 + cells * 0.035);
    var maxMines = Math.max(4, Math.floor((cells - 14) * 0.26));
    mines = Math.max(4, Math.min(mines, maxMines));
    var safe = cells - mines;
    var tideTicks = Math.round((10 + safe * 0.95) * TICK_HZ);
    return { w: w, h: h, mines: mines, tideTicks: tideTicks };
  }

  function buildGeom(w, h) {
    var n = w * h;
    var neigh = new Array(n);
    var i, x, y, dx, dy, nx, ny, list;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        list = [];
        for (dy = -1; dy <= 1; dy++) {
          for (dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            nx = x + dx;
            ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h) list.push(ny * w + nx);
          }
        }
        neigh[i] = list;
      }
    }
    return { w: w, h: h, n: n, neigh: neigh };
  }

  function idxOf(w, x, y) {
    return y * w + x;
  }

  function countsOf(geom, mines) {
    var c = new Uint8Array(geom.n);
    var i, k, nb;
    for (i = 0; i < geom.n; i++) {
      if (!mines[i]) continue;
      nb = geom.neigh[i];
      for (k = 0; k < nb.length; k++) c[nb[k]]++;
    }
    return c;
  }

  function floodOpen(geom, counts, mines, opened, flagged, start) {
    if (mines[start] || opened[start] || (flagged && flagged[start])) return 0;
    var stack = [start];
    var nOpen = 0;
    var i, k, nb, cell;
    opened[start] = 1;
    while (stack.length) {
      cell = stack.pop();
      nOpen++;
      if (counts[cell] !== 0) continue;
      nb = geom.neigh[cell];
      for (k = 0; k < nb.length; k++) {
        i = nb[k];
        if (opened[i] || mines[i]) continue;
        if (flagged && flagged[i]) continue;
        opened[i] = 1;
        stack.push(i);
      }
    }
    return nOpen;
  }

  function remainingSafe(geom, mines, opened) {
    var n = 0;
    for (var i = 0; i < geom.n; i++) if (!mines[i] && !opened[i]) n++;
    return n;
  }

  function applyTrivial(geom, counts, mines, minesTotal, opened, provenMine) {
    var progress = false;
    var i, k, nb, cell, unk, known, need, u;
    var unknown = [];
    for (cell = 0; cell < geom.n; cell++) {
      if (!opened[cell]) continue;
      need = counts[cell];
      nb = geom.neigh[cell];
      unk = 0;
      known = 0;
      unknown.length = 0;
      for (k = 0; k < nb.length; k++) {
        i = nb[k];
        if (provenMine[i]) known++;
        else if (!opened[i]) {
          unk++;
          unknown.push(i);
        }
      }
      need -= known;
      if (need < 0) continue;
      if (unk === 0) continue;
      if (need === 0) {
        for (k = 0; k < unknown.length; k++) {
          u = unknown[k];
          if (!opened[u] && !provenMine[u]) {
            floodOpen(geom, counts, mines, opened, provenMine, u);
            progress = true;
          }
        }
      } else if (need === unk) {
        for (k = 0; k < unknown.length; k++) {
          u = unknown[k];
          if (!provenMine[u]) {
            provenMine[u] = 1;
            progress = true;
          }
        }
      }
    }

    var hidden = 0;
    var hiddenMinesNeed = minesTotal;
    for (i = 0; i < geom.n; i++) {
      if (provenMine[i]) hiddenMinesNeed--;
      else if (!opened[i]) hidden++;
    }
    if (hiddenMinesNeed < 0) hiddenMinesNeed = 0;
    if (hidden > 0 && hiddenMinesNeed === 0) {
      for (i = 0; i < geom.n; i++) {
        if (!opened[i] && !provenMine[i]) {
          floodOpen(geom, counts, mines, opened, provenMine, i);
          progress = true;
        }
      }
    } else if (hidden > 0 && hiddenMinesNeed === hidden) {
      for (i = 0; i < geom.n; i++) {
        if (!opened[i] && !provenMine[i]) {
          provenMine[i] = 1;
          progress = true;
        }
      }
    }
    return progress;
  }

  function applySubsets(geom, counts, mines, opened, provenMine) {
    var progress = false;
    var numbered = [];
    var cell, i;
    for (cell = 0; cell < geom.n; cell++) if (opened[cell]) numbered.push(cell);
    var info = numbered.map(function (cell) {
      var nb = geom.neigh[cell];
      var unk = [];
      var known = 0;
      var i, k;
      for (k = 0; k < nb.length; k++) {
        i = nb[k];
        if (provenMine[i]) known++;
        else if (!opened[i]) unk.push(i);
      }
      return { need: counts[cell] - known, unk: unk };
    });

    function isSubset(a, setB) {
      for (var i = 0; i < a.length; i++) if (!setB[a[i]]) return false;
      return true;
    }

    var a, b, ia, ib, extra, diff, k, u, setB;
    for (a = 0; a < info.length; a++) {
      ia = info[a];
      if (ia.unk.length === 0 || ia.need < 0) continue;
      setB = null;
      for (b = 0; b < info.length; b++) {
        if (a === b) continue;
        ib = info[b];
        if (ib.unk.length <= ia.unk.length) continue;
        setB = [];
        for (k = 0; k < geom.n; k++) setB[k] = 0;
        for (k = 0; k < ib.unk.length; k++) setB[ib.unk[k]] = 1;
        if (!isSubset(ia.unk, setB)) continue;
        extra = [];
        for (k = 0; k < ib.unk.length; k++) {
          u = ib.unk[k];
          if (!ia.unk.includes(u)) extra.push(u);
        }
        if (extra.length === 0) continue;
        diff = ib.need - ia.need;
        if (diff === 0) {
          for (k = 0; k < extra.length; k++) {
            u = extra[k];
            if (!opened[u] && !provenMine[u]) {
                floodOpen(geom, counts, mines, opened, provenMine, u);
              progress = true;
            }
          }
        } else if (diff === extra.length && diff > 0) {
          for (k = 0; k < extra.length; k++) {
            u = extra[k];
            if (!provenMine[u]) {
              provenMine[u] = 1;
              progress = true;
            }
          }
        }
      }
    }
    return progress;
  }

  function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function applyEnumerate(geom, counts, mines, minesTotal, opened, provenMine) {
    var n = geom.n;
    var frontier = [];
    var isF = new Uint8Array(n);
    var i, k, cell, nb;
    for (cell = 0; cell < n; cell++) {
      if (!opened[cell]) continue;
      nb = geom.neigh[cell];
      for (k = 0; k < nb.length; k++) {
        i = nb[k];
        if (!opened[i] && !provenMine[i]) isF[i] = 1;
      }
    }
    for (i = 0; i < n; i++) if (isF[i]) frontier.push(i);
    if (frontier.length === 0) return false;

    var parent = frontier.map(function (_, idx) {
      return idx;
    });
    function find(a) {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    }
    function uni(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) parent[b] = a;
    }
    var fmap = {};
    for (k = 0; k < frontier.length; k++) fmap[frontier[k]] = k;
    for (cell = 0; cell < n; cell++) {
      if (!opened[cell]) continue;
      var group = [];
      nb = geom.neigh[cell];
      for (k = 0; k < nb.length; k++) {
        i = nb[k];
        if (isF[i]) group.push(fmap[i]);
      }
      for (k = 1; k < group.length; k++) uni(group[0], group[k]);
    }
    var buckets = {};
    for (k = 0; k < frontier.length; k++) {
      var r = find(k);
      if (!buckets[r]) buckets[r] = [];
      buckets[r].push(frontier[k]);
    }

    var provenMineCount = 0;
    var unknownTotal = 0;
    for (i = 0; i < n; i++) {
      if (provenMine[i]) provenMineCount++;
      else if (!opened[i]) unknownTotal++;
    }
    var minesLeft = minesTotal - provenMineCount;
    var progress = false;

    var keys = Object.keys(buckets);
    for (var bi = 0; bi < keys.length; bi++) {
      var cells = buckets[keys[bi]];
      var klen = cells.length;
      if (klen === 0 || klen > 16) continue;
      var idxOfCell = {};
      for (k = 0; k < klen; k++) idxOfCell[cells[k]] = k;

      var cons = [];
      for (cell = 0; cell < n; cell++) {
        if (!opened[cell]) continue;
        var mask = 0;
        var need = counts[cell];
        var touches = false;
        nb = geom.neigh[cell];
        var valid = true;
        for (k = 0; k < nb.length; k++) {
          i = nb[k];
          if (provenMine[i]) need--;
          else if (!opened[i]) {
            if (idxOfCell[i] !== undefined) {
              mask |= 1 << idxOfCell[i];
              touches = true;
            }
          }
        }
        if (!touches) continue;
        if (need < 0) {
          valid = false;
        }
        if (!valid) continue;
        cons.push({ mask: mask, need: need, bits: popcount(mask) });
      }

      var otherUnknown = unknownTotal - klen;
      var minM = Math.max(0, minesLeft - otherUnknown);
      var maxM = Math.min(klen, minesLeft);
      var alwaysMine = (1 << klen) - 1;
      var alwaysSafe = (1 << klen) - 1;
      var found = 0;
      var limit = 1 << klen;
      var mask, used, ok, ci, c;
      for (mask = 0; mask < limit; mask++) {
        used = popcount(mask);
        if (used < minM || used > maxM) continue;
        ok = true;
        for (ci = 0; ci < cons.length; ci++) {
          c = cons[ci];
          if (popcount(mask & c.mask) !== c.need) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        found++;
        alwaysMine &= mask;
        alwaysSafe &= ~mask;
        if (alwaysMine === 0 && alwaysSafe === 0) break;
      }
      if (found === 0) continue;
      for (k = 0; k < klen; k++) {
        if (alwaysMine & (1 << k)) {
          if (!provenMine[cells[k]]) {
            provenMine[cells[k]] = 1;
            progress = true;
          }
        } else if (alwaysSafe & (1 << k)) {
          if (!opened[cells[k]] && !provenMine[cells[k]]) {
            floodOpen(geom, counts, mines, opened, provenMine, cells[k]);
            progress = true;
          }
        }
      }
    }
    return progress;
  }

  function isSolvable(geom, mines, counts, sx, sy, mineCount) {
    var opened = new Uint8Array(geom.n);
    var provenMine = new Uint8Array(geom.n);
    var start = idxOf(geom.w, sx, sy);
    if (mines[start] || counts[start] !== 0) return false;
    floodOpen(geom, counts, mines, opened, provenMine, start);
    var guard = 0;
    while (remainingSafe(geom, mines, opened) > 0 && guard++ < geom.n * 6) {
      var progress = applyTrivial(geom, counts, mines, mineCount, opened, provenMine);
      if (!progress) progress = applySubsets(geom, counts, mines, opened, provenMine);
      if (!progress) progress = applyEnumerate(geom, counts, mines, mineCount, opened, provenMine);
      if (!progress) return false;
    }
    return remainingSafe(geom, mines, opened) === 0;
  }

  function placeMines(rng, geom, mineCount, sx, sy) {
    var mines = new Uint8Array(geom.n);
    var forbidden = {};
    var x, y, dx, dy, nx, ny;
    for (dy = -1; dy <= 1; dy++) {
      for (dx = -1; dx <= 1; dx++) {
        nx = sx + dx;
        ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < geom.w && ny < geom.h) {
          forbidden[idxOf(geom.w, nx, ny)] = 1;
        }
      }
    }
    var avail = [];
    for (var i = 0; i < geom.n; i++) if (!forbidden[i]) avail.push(i);
    var m = Math.min(mineCount, avail.length);
    for (i = avail.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = avail[i];
      avail[i] = avail[j];
      avail[j] = tmp;
    }
    for (i = 0; i < m; i++) mines[avail[i]] = 1;
    return { mines: mines, count: m };
  }

  function generateBoard(seedHash, pool, sx, sy, cfg) {
    var geom = buildGeom(cfg.w, cfg.h);
    var want = cfg.mines;
    var attempt, rng, placed, counts, start;
    start = idxOf(cfg.w, sx, sy);
    for (var reduce = 0; reduce < 8; reduce++) {
      var target = Math.max(3, want - reduce);
      for (attempt = 0; attempt < 90; attempt++) {
        rng = mulberry32(mix32(seedHash, pool, sx + 3, sy + 7, target, attempt + 1));
        placed = placeMines(rng, geom, target, sx, sy);
        counts = countsOf(geom, placed.mines);
        if (counts[start] !== 0) continue;
        if (isSolvable(geom, placed.mines, counts, sx, sy, placed.count)) {
          return {
            geom: geom,
            mines: placed.mines,
            counts: counts,
            mineCount: placed.count,
          };
        }
      }
    }
    return constructFallback(geom, sx, sy, want);
  }

  function constructFallback(geom, sx, sy, want) {
    var start = idxOf(geom.w, sx, sy);
    var forbid = {};
    var dx, dy, nx, ny, i, k;
    for (dy = -1; dy <= 1; dy++) {
      for (dx = -1; dx <= 1; dx++) {
        nx = sx + dx;
        ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < geom.w && ny < geom.h) forbid[idxOf(geom.w, nx, ny)] = 1;
      }
    }
    var cells = [];
    for (i = 0; i < geom.n; i++) {
      if (forbid[i]) continue;
      ny = (i / geom.w) | 0;
      nx = i - ny * geom.w;
      cells.push({ i: i, d: (nx - sx) * (nx - sx) + (ny - sy) * (ny - sy) });
    }
    cells.sort(function (a, b) {
      return b.d - a.d;
    });
    var m, mines, counts, placedN;
    for (m = Math.min(want, cells.length); m >= 1; m--) {
      mines = new Uint8Array(geom.n);
      for (k = 0; k < m; k++) mines[cells[k].i] = 1;
      counts = countsOf(geom, mines);
      if (counts[start] !== 0) continue;
      if (isSolvable(geom, mines, counts, sx, sy, m)) {
        return { geom: geom, mines: mines, counts: counts, mineCount: m };
      }
    }
    mines = new Uint8Array(geom.n);
    placedN = 0;
    for (i = 0; i < geom.n; i++) {
      if (!forbid[i]) {
        mines[i] = 1;
        placedN++;
      }
    }
    counts = countsOf(geom, mines);
    return { geom: geom, mines: mines, counts: counts, mineCount: placedN };
  }

  function cloneRows(rows) {
    var out = new Array(rows.length);
    for (var i = 0; i < rows.length; i++) out[i] = rows[i];
    return out;
  }

  function createShoalGame() {
    var sessionBest = 0;
    var attempt = 0;
    var seed = 1;
    var seedHash = 1;

    var phase, tick, elapsedMs, revision, pool, pearls, moves, rank;
    var cfg, geom, mines, counts, mineCount;
    var opened, flagged, firstTurnDone, stungAt;
    var flagsPlaced, tideTicks, poolPlayTicks, tideFraction;
    var events, lastEvent, seq;
    var maxRipple, poolsCleared, fastestClearTicks;
    var juice;

    function emptyJuice() {
      juice = {
        origin: null,
        opened: [],
        kind: null,
        sting: false,
        clear: false,
      };
    }

    function pushEvent(kind, extra) {
      seq += 1;
      var ev = { seq: seq, kind: kind, tick: tick };
      if (extra) {
        if (extra.opened != null) ev.opened = extra.opened;
        if (extra.pool != null) ev.pool = extra.pool;
      }
      events.push(ev);
      if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP);
      lastEvent = ev;
    }

    function paintRows() {
      var rows = [];
      var y, x, i, ch, line;
      for (y = 0; y < geom.h; y++) {
        line = "";
        for (x = 0; x < geom.w; x++) {
          i = idxOf(geom.w, x, y);
          if (phase === "ended") {
            if (stungAt && stungAt.x === x && stungAt.y === y) ch = "X";
            else if (flagged[i] && mines && mines[i]) ch = "+";
            else if (flagged[i] && mines && !mines[i]) ch = "-";
            else if (mines && mines[i]) ch = "*";
            else if (opened[i]) ch = String(counts[i]);
            else ch = "#";
          } else {
            if (flagged[i]) ch = "F";
            else if (opened[i]) ch = String(counts[i]);
            else ch = "#";
          }
          line += ch;
        }
        rows.push(line);
      }
      return rows;
    }

    function visibleState(withEvents) {
      var rows = paintRows();
      var state = {
        phase: phase,
        tick: tick,
        elapsedMs: elapsedMs,
        seed: seed,
        attempt: attempt,
        revision: revision,
        pool: pool,
        pearls: pearls,
        sessionBest: sessionBest,
        moves: moves,
        rank: rank,
        rankLadder: RANK_LADDER.slice(),
        gridWidth: geom.w,
        gridHeight: geom.h,
        urchinsTotal: mineCount,
        flagsPlaced: flagsPlaced,
        urchinsLeft: mineCount - flagsPlaced,
        tideFraction: tideFraction,
        firstTurnDone: firstTurnDone,
        stungAt: stungAt ? { x: stungAt.x, y: stungAt.y } : null,
        rows: cloneRows(rows),
      };
      if (withEvents) {
        state.events = events.map(function (e) {
          var o = { seq: e.seq, kind: e.kind, tick: e.tick };
          if (e.opened != null) o.opened = e.opened;
          if (e.pool != null) o.pool = e.pool;
          return o;
        });
        state.lastEvent = lastEvent
          ? (function () {
              var o = { seq: lastEvent.seq, kind: lastEvent.kind, tick: lastEvent.tick };
              if (lastEvent.opened != null) o.opened = lastEvent.opened;
              if (lastEvent.pool != null) o.pool = lastEvent.pool;
              return o;
            })()
          : null;
      }
      return state;
    }

    function setupPool() {
      cfg = poolConfig(pool);
      geom = buildGeom(cfg.w, cfg.h);
      mines = null;
      counts = null;
      mineCount = cfg.mines;
      opened = new Uint8Array(geom.n);
      flagged = new Uint8Array(geom.n);
      firstTurnDone = false;
      flagsPlaced = 0;
      tideTicks = cfg.tideTicks;
      poolPlayTicks = 0;
      tideFraction = 1;
      stungAt = null;
    }

    function beginRun() {
      phase = "ready";
      tick = 0;
      elapsedMs = 0;
      revision = 0;
      pool = 1;
      pearls = 0;
      moves = 0;
      rank = null;
      events = [];
      lastEvent = null;
      seq = 0;
      maxRipple = 0;
      poolsCleared = 0;
      fastestClearTicks = null;
      emptyJuice();
      setupPool();
    }

    function refreshTide() {
      if (!firstTurnDone || phase !== "playing") {
        if (!firstTurnDone) tideFraction = 1;
        return;
      }
      tideFraction =
        poolPlayTicks >= tideTicks ? 0 : (tideTicks - poolPlayTicks) / tideTicks;
    }

    function endRun(x, y) {
      phase = "ended";
      stungAt = { x: x, y: y };
      rank = rankFor(pearls);
      if (pearls > sessionBest) sessionBest = pearls;
      pushEvent("sting");
      pushEvent("run_end");
    }

    function maybeClear(openedCount) {
      if (remainingSafe(geom, mines, opened) > 0) return false;
      var bonus = Math.floor((8 + 10 * pool) * pool * tideFraction);
      pearls += bonus;
      poolsCleared += 1;
      if (fastestClearTicks == null || poolPlayTicks < fastestClearTicks) {
        fastestClearTicks = poolPlayTicks;
      }
      pushEvent("pool_clear", { pool: pool });
      juice.clear = true;
      juice.opened = [];
      pool += 1;
      setupPool();
      return true;
    }

    function neighborsFlags(i) {
      var nb = geom.neigh[i];
      var n = 0;
      for (var k = 0; k < nb.length; k++) if (flagged[nb[k]]) n++;
      return n;
    }

    function inBounds(x, y) {
      return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < geom.w && y < geom.h;
    }

    function collectFloodOrder(start) {
      var order = [];
      var seen = new Uint8Array(geom.n);
      var q = [start];
      seen[start] = 1;
      var head = 0;
      var cell, k, i, nb;
      while (head < q.length) {
        cell = q[head++];
        order.push(cell);
        if (counts[cell] !== 0) continue;
        nb = geom.neigh[cell];
        for (k = 0; k < nb.length; k++) {
          i = nb[k];
          if (seen[i] || !opened[i]) continue;
          seen[i] = 1;
          q.push(i);
        }
      }
      return order;
    }

    function doOpen(x, y) {
      var i = idxOf(geom.w, x, y);
      if (opened[i] || flagged[i]) return false;
      if (!firstTurnDone) {
        var gen = generateBoard(seedHash, pool, x, y, cfg);
        geom = gen.geom;
        mines = gen.mines;
        counts = gen.counts;
        mineCount = gen.mineCount;
        firstTurnDone = true;
        if (phase === "ready") phase = "playing";
      }
      juice.origin = { x: x, y: y };
      juice.kind = "open";
      juice.sting = false;
      juice.clear = false;
      juice.opened = [];
      if (mines[i]) {
        opened[i] = 1;
        pearls += 0;
        moves += 1;
        revision += 1;
        juice.sting = true;
        juice.opened = [i];
        pushEvent("open", { opened: 1 });
        endRun(x, y);
        return true;
      }
      var nOpen = floodOpen(geom, counts, mines, opened, flagged, i);
      pearls += nOpen;
      if (nOpen > maxRipple) maxRipple = nOpen;
      moves += 1;
      revision += 1;
      juice.opened = collectFloodOrder(i);
      pushEvent("open", { opened: nOpen });
      maybeClear(nOpen);
      return true;
    }

    function doFlag(x, y, on) {
      var i = idxOf(geom.w, x, y);
      if (on) {
        if (opened[i] || flagged[i]) return false;
        flagged[i] = 1;
        flagsPlaced += 1;
        juice.kind = "flag";
        juice.origin = { x: x, y: y };
        juice.opened = [];
        juice.sting = false;
        juice.clear = false;
        moves += 1;
        revision += 1;
        pushEvent("flag");
        return true;
      }
      if (!flagged[i]) return false;
      flagged[i] = 0;
      flagsPlaced -= 1;
      juice.kind = "unflag";
      juice.origin = { x: x, y: y };
      juice.opened = [];
      juice.sting = false;
      juice.clear = false;
      moves += 1;
      revision += 1;
      pushEvent("unflag");
      return true;
    }

    function doSweep(x, y) {
      var i = idxOf(geom.w, x, y);
      if (!opened[i]) return false;
      if (neighborsFlags(i) !== counts[i]) return false;
      var nb = geom.neigh[i];
      var targets = [];
      var k, t, tx, ty;
      for (k = 0; k < nb.length; k++) {
        t = nb[k];
        if (!opened[t] && !flagged[t]) targets.push(t);
      }
      if (targets.length === 0) return false;
      if (!firstTurnDone) return false;
      juice.origin = { x: x, y: y };
      juice.kind = "sweep";
      juice.sting = false;
      juice.clear = false;
      var nOpen = 0;
      var openedCells = [];
      var fatal = null;
      for (k = 0; k < targets.length; k++) {
        t = targets[k];
        if (mines[t]) {
          if (fatal == null) fatal = t;
          continue;
        }
        var before = remainingSafe(geom, mines, opened);
        floodOpen(geom, counts, mines, opened, flagged, t);
        var after = remainingSafe(geom, mines, opened);
        var gained = before - after;
        nOpen += gained;
        openedCells.push(t);
      }
      if (fatal != null) {
        opened[fatal] = 1;
        nOpen += 1;
        openedCells.push(fatal);
        ty = (fatal / geom.w) | 0;
        tx = fatal - ty * geom.w;
        pearls += Math.max(0, nOpen - 1);
        moves += 1;
        revision += 1;
        juice.sting = true;
        juice.opened = openedCells;
        pushEvent("sweep", { opened: nOpen });
        endRun(tx, ty);
        return true;
      }
      pearls += nOpen;
      if (nOpen > maxRipple) maxRipple = nOpen;
      moves += 1;
      revision += 1;
      juice.opened = openedCells;
      pushEvent("sweep", { opened: nOpen });
      maybeClear(nOpen);
      return true;
    }

    function act(action) {
      emptyJuice();
      if (!action || typeof action !== "object") return visibleState(true);
      if (phase === "ended") return visibleState(true);
      var type = action.type;
      var x = action.x;
      var y = action.y;
      if (!inBounds(x, y)) return visibleState(true);
      var ok = false;
      if (type === "open") ok = doOpen(x, y);
      else if (type === "flag") ok = doFlag(x, y, true);
      else if (type === "unflag") ok = doFlag(x, y, false);
      else if (type === "sweep") ok = doSweep(x, y);
      return visibleState(true);
    }

    function advance(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return;
      if (phase !== "playing") return;
      elapsedMs += ms;
      var targetTick = Math.floor((elapsedMs * TICK_HZ) / 1000);
      while (tick < targetTick) {
        tick += 1;
        if (firstTurnDone) {
          poolPlayTicks += 1;
          refreshTide();
        }
      }
    }

    function reset(nextSeed) {
      var unused =
        attempt > 0 &&
        phase === "ready" &&
        revision === 0 &&
        moves === 0 &&
        tick === 0 &&
        pearls === 0;
      seed = nextSeed == null ? 1 : nextSeed;
      seedHash = hashSeed(seed);
      if (attempt === 0) attempt = 1;
      else if (!unused) attempt += 1;
      beginRun();
      return visibleState(true);
    }

    function restart() {
      return reset(seed);
    }

    function snapshot() {
      return visibleState(true);
    }

    phase = "ready";
    tick = 0;
    elapsedMs = 0;
    revision = 0;
    moves = 0;
    pearls = 0;
    reset(1);

    return {
      reset: reset,
      snapshot: snapshot,
      act: act,
      restart: restart,
      advance: advance,
      lastJuice: function () {
        return juice;
      },
      runStats: function () {
        return {
          maxRipple: maxRipple,
          poolsCleared: poolsCleared,
          fastestClearTicks: fastestClearTicks,
        };
      },
      poolConfig: poolConfig,
      RANK_LADDER: RANK_LADDER,
    };
  }

  global.createShoalGame = createShoalGame;
  global.SHOAL_RANK_LADDER = RANK_LADDER;
  global.SHOAL_poolConfig = poolConfig;
  global.SHOAL_generateBoard = generateBoard;
  global.SHOAL_hashSeed = hashSeed;
})(typeof window !== "undefined" ? window : globalThis);
