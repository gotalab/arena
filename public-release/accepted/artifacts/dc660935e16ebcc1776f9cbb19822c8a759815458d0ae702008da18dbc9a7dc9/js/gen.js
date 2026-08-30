/* EMBER — the flue generator.
 *
 * Streams ledges upward from a seeded RNG. Two hard guarantees:
 *
 *  1. The safe road always exists. Every ledge is placed so that it is
 *     reachable with a single full-strength launch from the previous ledge AND
 *     from either wall at that height, measured against the true ballistic
 *     envelope  dy <= safety * (REACH - dx^2 / (4*REACH)).
 *  2. Nothing materialises on top of the spark. Prizes are only committed once
 *     the generator's frontier has moved well past them, which is always far
 *     above the player.
 *
 * Everything above the guarantees is placement with intent: prizes sit off the
 * ledge line so that reaching them costs glow the ledges will not pay back.
 */
(function (E) {
  'use strict';

  var C = E.C;
  var clamp = E.clamp;

  function reachDy(dx, safety) {
    var R = C.REACH;
    var v = R - (dx * dx) / (4 * R);
    if (v < 0) { v = 0; }
    return safety * v;
  }

  // Strictest reachable rise for a ledge of half-width hw centred on cx, taking
  // the previous perch and both walls as possible anchors.
  function maxRise(cx, hw, prevX, safety) {
    var ax = [prevX, C.WALL_L + C.PLAYER_R, C.WALL_R - C.PLAYER_R];
    var best = 1e9;
    for (var i = 0; i < 3; i++) {
      var dx = Math.abs(cx - ax[i]) - hw;
      if (dx < 0) { dx = 0; }
      var d = reachDy(dx, safety);
      if (d < best) { best = d; }
    }
    return best;
  }

  function create() {
    return {
      rng: null,
      seed: 0,
      genY: 0,
      lastX: 0, lastY: 0, lastHw: 0,
      side: 1,
      index: 0,          // ledges emitted since the start of the run
      spawnIndex: 0,
      ledges: [],
      items: [],
      nextLedgeId: 0,
      nextItemId: 0,
      pending: []
    };
  }

  function reset(g, seed) {
    g.rng = new E.Rng(seed ^ 0x5bf03635);
    g.seed = seed;
    g.ledges.length = 0;
    g.items.length = 0;
    g.pending.length = 0;
    g.nextLedgeId = 0;
    g.nextItemId = 0;
    g.spawnIndex = 0;
    g.index = 0;
    g.side = 1;

    // The hearth ledge: wide, centred, unmistakably a place to stand.
    var hw = 16;
    g.ledges.push({ id: g.nextLedgeId++, x: 50, y: C.START_Y, hw: hw, home: true });
    g.spawnIndex++;
    g.lastX = 50; g.lastY = C.START_Y; g.lastHw = hw;
    g.genY = C.START_Y;
  }

  /* ------------------------------------------------------------- prizes */

  function ledgeBlocks(g, x, y, r) {
    for (var i = g.ledges.length - 1; i >= 0; i--) {
      var L = g.ledges[i];
      if (L.y < y - 30) { break; }
      if (Math.abs(L.y - y) < C.LEDGE_HT + r + 3.5 &&
        Math.abs(L.x - x) < L.hw + r + 3.0) { return true; }
    }
    return false;
  }

  function itemBlocks(g, x, y) {
    for (var i = g.items.length - 1; i >= 0; i--) {
      var it = g.items[i];
      var dx = it.bx - x, dy = it.by - y;
      if (dx * dx + dy * dy < 12 * 12) { return true; }
    }
    return false;
  }

  function commit(g, p, playerX, playerY) {
    var r = p.type === 'moth' ? C.MOTH_R : C.GLIMMER_R;
    var x = clamp(p.x, C.WALL_L + r + 1.5, C.WALL_R - r - 1.5);
    var y = p.y;
    if (ledgeBlocks(g, x, y, r) || itemBlocks(g, x, y)) { return; }
    var dx = x - playerX, dy = y - playerY;
    if (dx * dx + dy * dy < 20 * 20) { return; }   // never on top of the spark

    var it = {
      id: g.nextItemId++,
      type: p.type,
      x: x, y: y,
      bx: x, by: y,
      active: true,
      amp: 0, vamp: 0, rate: 0, phase: 0
    };
    if (p.type === 'moth') {
      it.amp = g.rng.range(6, 17);
      it.vamp = g.rng.range(1.6, 4.2);
      it.rate = g.rng.range(0.11, 0.26);          // drift cycles per second
      it.phase = g.rng.next();
      it.wing = g.rng.range(0, 1);
      // keep the whole drift arc inside the flue
      var lim = Math.min(it.bx - (C.WALL_L + C.MOTH_R + 1.5),
        (C.WALL_R - C.MOTH_R - 1.5) - it.bx);
      if (it.amp > lim) { it.amp = Math.max(0, lim); }
    } else {
      it.phase = g.rng.next();
    }
    g.items.push(it);
    g.spawnIndex++;
  }

  function flushPending(g, playerX, playerY) {
    // Only commit prizes the ledge frontier has cleared, so a later ledge can
    // never be generated on top of one.
    var keep = [];
    for (var i = 0; i < g.pending.length; i++) {
      var p = g.pending[i];
      if (p.y < g.lastY - 12) { commit(g, p, playerX, playerY); }
      else { keep.push(p); }
    }
    g.pending = keep;
  }

  /* ------------------------------------------------------------- ledges */

  function pushLedge(g, cx, cy, hw) {
    g.ledges.push({ id: g.nextLedgeId++, x: cx, y: cy, hw: hw, home: false });
    g.spawnIndex++;
    g.lastX = cx; g.lastY = cy; g.lastHw = hw;
    g.genY = cy;
    g.index++;
  }

  // Place one ledge above the last one, plus the prizes that make the gap
  // interesting. Always ends with exactly one reachable ledge.
  function nextBand(g) {
    var rng = g.rng;
    var f = clamp(g.lastY / 1700, 0, 1);          // layout pressure with height
    var safety = 0.80 + 0.10 * f;
    var hw = clamp(13.5 - 6.0 * f + rng.range(-1.3, 1.3), 6.2, 15);
    var minDy = 18 + 7 * f;

    var motif;
    if (g.index < 3) {
      // An unhurried opening that teaches itself: a hop, a prize worth
      // leaving the ledge for, then a moth sitting in a gap.
      motif = ['ladder', 'centerPost', 'bigGap'][g.index];
    } else {
      var w = [
        ['ladder', 3.2 - 1.7 * f],
        ['centerPost', 1.2],
        ['bigGap', 0.5 + 1.6 * f],
        ['mothStair', 0.35 + 1.5 * f],
        ['treasure', 0.65 + 0.7 * f]
      ];
      var total = 0, i;
      for (i = 0; i < w.length; i++) { total += w[i][1]; }
      var pick = rng.next() * total;
      motif = w[w.length - 1][0];
      for (i = 0; i < w.length; i++) {
        pick -= w[i][1];
        if (pick <= 0) { motif = w[i][0]; break; }
      }
    }

    g.side = -g.side;
    var side = g.side;
    var cx, dyWant;

    if (motif === 'centerPost' || motif === 'bigGap') {
      cx = 50 + side * rng.range(0, 11);
    } else if (motif === 'ladder') {
      // hug a wall, or step just off it
      var off = rng.chance(0.45) ? hw : hw + rng.range(4, 15);
      cx = side > 0 ? C.WALL_L + off : C.WALL_R - off;
    } else {
      cx = 50 + side * rng.range(6, 24);
    }
    cx = clamp(cx, C.WALL_L + hw, C.WALL_R - hw);

    if (motif === 'bigGap') { dyWant = 999; }
    else if (motif === 'ladder') { dyWant = E.lerp(26, 42, f) + rng.range(-5, 6); }
    else { dyWant = E.lerp(29, 45, f) + rng.range(-5, 7); }

    var cap = maxRise(cx, hw, g.lastX, safety);
    if (cap < minDy) {
      // Extreme lane: pull it toward the middle until the guarantee holds.
      var tries = 0;
      while (cap < minDy && tries < 8) {
        cx += (50 - cx) * 0.35;
        cap = maxRise(cx, hw, g.lastX, safety);
        tries++;
      }
      if (cap < minDy) { minDy = cap; }
    }
    var dy = clamp(dyWant, minDy, cap);
    var y0 = g.lastY;
    var y1 = y0 + dy;

    pushLedge(g, cx, y1, hw);

    /* ---- prizes, queued for later commit ---- */
    var mid = y0 + dy * 0.55;

    if (motif === 'centerPost') {
      // A glimmer hanging one hop past the perch: cheap to see, not to take.
      g.pending.push({
        type: 'glimmer',
        x: cx - side * rng.range(14, 26),
        y: y1 + rng.range(15, 26)
      });
    } else if (motif === 'bigGap') {
      // A moth that turns a two-glow gamble into a one-glow bargain.
      g.pending.push({
        type: 'moth',
        x: clamp(cx + side * rng.range(-26, -8), 20, 80),
        y: mid + rng.range(-3, 6)
      });
      if (rng.chance(0.55)) {
        g.pending.push({ type: 'glimmer', x: 50 - side * rng.range(6, 20), y: y1 + rng.range(10, 20) });
      }
    } else if (motif === 'mothStair') {
      // A staircase through open air for anyone bold enough to read it.
      var n = rng.chance(0.35 + 0.3 * f) ? 3 : 2;
      var sx = clamp(cx + side * rng.range(-8, 8), 24, 76);
      var sy = y1 + rng.range(16, 24);
      for (var k = 0; k < n; k++) {
        g.pending.push({ type: 'moth', x: sx, y: sy });
        if (k === n - 1 || rng.chance(0.2)) {
          g.pending.push({ type: 'glimmer', x: sx - side * rng.range(9, 16), y: sy + rng.range(13, 20) });
        }
        sx = clamp(sx - side * rng.range(13, 24), 22, 78);
        sy += rng.range(29, 38);
      }
    } else if (motif === 'treasure') {
      // A glimmer line: an arc through the open middle, three bursts wide.
      var m = rng.chance(0.5) ? 3 : 2;
      var ax = 50 + side * rng.range(-18, 8);
      var ay = y1 + rng.range(14, 22);
      var spread = rng.range(11, 19);
      for (var j = 0; j < m; j++) {
        g.pending.push({ type: 'glimmer', x: clamp(ax + side * j * spread, 16, 84), y: ay + j * rng.range(11, 17) });
      }
      if (rng.chance(0.4 + 0.3 * f)) {
        g.pending.push({ type: 'moth', x: clamp(ax + side * (m - 0.4) * spread, 20, 80), y: ay + m * 13 + 8 });
      }
    } else {
      if (rng.chance(0.32)) {
        g.pending.push({ type: 'glimmer', x: 50 + side * rng.range(-16, 16), y: mid + rng.range(-4, 8) });
      }
      if (rng.chance(0.22 + 0.2 * f)) {
        g.pending.push({ type: 'moth', x: 50 - side * rng.range(2, 24), y: y1 + rng.range(12, 22) });
      }
    }
  }

  function ensure(g, playerX, playerY) {
    var target = playerY + 3 * C.REACH;
    var guard = 0;
    while (g.genY < target && guard < 400) {
      nextBand(g);
      flushPending(g, playerX, playerY);
      guard++;
    }
    flushPending(g, playerX, playerY);
  }

  function prune(g, playerY) {
    var cut = playerY - 4 * C.REACH;
    var i = 0;
    while (i < g.ledges.length && g.ledges[i].y < cut && g.ledges.length - i > 4) { i++; }
    if (i > 0) { g.ledges.splice(0, i); }
    i = 0;
    while (i < g.items.length && g.items[i].y < cut) { i++; }
    if (i > 0) { g.items.splice(0, i); }
  }

  E.Gen = {
    create: create,
    reset: reset,
    ensure: ensure,
    prune: prune,
    maxRise: maxRise,
    reachDy: reachDy
  };

})(window.EMBER);
