/* DELVE — deterministic simulation.
 *
 * Fixed 60 Hz step. Everything a rule reads comes from this module's state
 * plus the seeded RNG. No Date.now(), no Math.random(), no DOM.
 *
 * SNAPSHOT PRECISION (stable, documented):
 *   x / depth / positions / radii / wall samples / safeHalfWidth /
 *   corridorHalfWidth / courseCenterX / speed / maxSpeed  -> 2 decimals
 *   difficulty                                            -> 4 decimals
 *   score, tick, counters, previewMs                      -> integers
 *   elapsedMs / timeMs / remainingMs / invincibleUntilMs   -> integers (ms)
 *
 * WORLD UNITS: x spans the corridor axis, depth increases downward.
 * 10 world units == 1 displayed metre.
 */
(function () {
  var D = window.DELVE;
  var R = D.rng;

  var STEP_MS = 1000 / 60;

  var K = {
    STEP_MS: STEP_MS,
    WORLD_HALF: 180,      // nominal half-width of the whole dig
    PLAYER_R: 13,         // machine collision radius (machine width = 26)
    V_MIN: 58,            // the crawl — the floor, never breached while playable
    V_MAX: 420,           // top speed  (crawl is ~1/5 of comfortable cruise ~290)
    ACCEL: 260,
    DECEL: 230,
    STALL_TICKS: 12,      // 200 ms: wall OR rock collapses speed to the crawl
    LAT_CRAWL: 235,       // lateral authority at the crawl (units/s)
    LAT_TOP: 130,         // ...at full throttle. Same key, ~55% of the ground/s,
                          //    and ~7% of the ground per unit of depth.
    LATA_CRAWL: 1500,     // how fast lateral velocity itself can change
    LATA_TOP: 520,        //    (the arc widens with speed)
    PREVIEW_DEPTH: 520,   // fixed world-space preview horizon (never view-dependent)
    TIME_START: 20000,
    TIME_CAP: 26000,
    FRAG_TIME: 1400,
    BREAK_TIME: 850,
    POWER_MS: 5200,
    NEAR_GAP: 26,         // one machine width
    COMBO_TICKS: 150,
    WALL_CD: 20,
    EVENT_MAX: 120
  };
  D.K = K;

  var LADDER = [
    { g: 'D',  s: 0,     name: 'ROOKIE DIGGER' },
    { g: 'C',  s: 2600,  name: 'PROSPECTOR' },
    { g: 'B',  s: 6500,  name: 'TUNNEL RAT' },
    { g: 'A',  s: 12500, name: 'DEEP RUNNER' },
    { g: 'S',  s: 21000, name: 'CORE BREAKER' },
    { g: 'SS', s: 34000, name: 'MANTLE LEGEND' }
  ];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r4(v) { return Math.round(v * 10000) / 10000; }

  /* ---------------------------------------------------------------- course */

  function diffAt(depth) { return Math.pow(Math.max(0, depth) / 16000, 0.72); }

  /* Corridor half-width: narrows with depth, breathes with a seeded wobble. */
  function halfW(S, depth) {
    var d = Math.min(1, diffAt(depth));
    var w = 96 - 26 * d
      + 6 * Math.sin(depth * 0.0021 + S.hwPhase)
      + 4 * Math.sin(depth * 0.0053 + S.hwPhase * 2.3);
    return w < 64 ? 64 : w;
  }

  /* Centre-line: a chain of smoothstep segments. Slope (dx per unit depth) is
     the personality dial — a switchback late in a run runs at ~0.28, and the
     machine can only manage ~0.31 at full throttle, so it has to ease off. */
  function centerXAt(S, depth) {
    var segs = S.segs;
    if (!segs.length) return 0;
    if (depth <= segs[0].d0) return segs[0].x0;
    var last = segs[segs.length - 1];
    if (depth >= last.d1) return last.x1;
    var lo = 0, hi = segs.length - 1, mid;
    while (lo < hi) { mid = (lo + hi) >> 1; if (segs[mid].d1 <= depth) lo = mid + 1; else hi = mid; }
    var s = segs[lo];
    return s.x0 + (s.x1 - s.x0) * smooth((depth - s.d0) / (s.d1 - s.d0));
  }

  function ensureSegments(S, toDepth) {
    var guard = 0;
    while (S.segEnd < toDepth && guard++ < 300) {
      var d0 = S.segEnd, x0 = S.segX;
      var dd = Math.min(1, diffAt(d0));
      var roll = R.f(S);
      var slope, dx, isSwitch = false;
      if (roll < 0.11) { slope = 0; dx = 0; }                                   // breather
      else if (roll < 0.45) { slope = 0.070 + 0.050 * dd; dx = R.range(S, 46, 104); }  // drift
      else if (roll < 0.80) { slope = 0.130 + 0.062 * dd; dx = R.range(S, 66, 140); }  // bend
      else { slope = 0.190 + 0.092 * dd; dx = R.range(S, 88, 152); isSwitch = true; }  // switchback

      var dir = isSwitch ? -S.lastDir : (R.f(S) < 0.5 ? -1 : 1);
      if (!dir) dir = 1;
      var lim = 68 + 26 * dd;
      var tx = x0 + dir * dx;
      if (tx > lim || tx < -lim) { dir = -dir; tx = x0 + dir * dx; }
      tx = clamp(tx, -lim, lim);
      var realDx = tx - x0;
      var L = (slope <= 0 || Math.abs(realDx) < 2)
        ? R.range(S, 190, 360)
        : Math.max(130, 1.5 * Math.abs(realDx) / slope);
      S.segs.push({ d0: d0, d1: d0 + L, x0: x0, x1: tx });
      S.segEnd = d0 + L; S.segX = tx;
      if (Math.abs(realDx) >= 2) S.lastDir = dir;
    }
  }

  /* The "gap line": a guaranteed traversable lane threading the rock field.
     Rocks are never allowed to intrude on it, which is what makes
     "a safe line always exists" structural rather than hopeful. */
  function ensureGapNodes(S, toDepth) {
    var guard = 0;
    while (S.gapEnd < toDepth && guard++ < 300) {
      var prev = S.gapNodes[S.gapNodes.length - 1];
      var step = R.range(S, 150, 250);
      var d = prev.depth + step;
      var dd = Math.min(1, diffAt(d));
      var half = (K.PLAYER_R + 32) - 16 * dd;   // 45 -> 29 (machine radius is 13)
      var lim = Math.max(2, halfW(S, d) - half - 4);
      var maxMove = 0.075 * step;
      var off = clamp(prev.off + R.range(S, -maxMove, maxMove), -lim, lim);
      S.gapNodes.push({ depth: d, off: off, half: half });
      S.gapEnd = d;
    }
  }

  function gapAt(S, depth) {
    var n = S.gapNodes, off, half;
    if (depth <= n[0].depth) { off = n[0].off; half = n[0].half; }
    else if (depth >= n[n.length - 1].depth) { off = n[n.length - 1].off; half = n[n.length - 1].half; }
    else {
      var lo = 0, hi = n.length - 1, mid;
      while (lo < hi - 1) { mid = (lo + hi) >> 1; if (n[mid].depth <= depth) lo = mid; else hi = mid; }
      var a = n[lo], b = n[lo + 1];
      var t = smooth((depth - a.depth) / (b.depth - a.depth));
      off = a.off + (b.off - a.off) * t;
      half = a.half + (b.half - a.half) * t;
    }
    var cx = centerXAt(S, depth);
    var lim = Math.max(2, halfW(S, depth) - half - 3);
    return { cx: cx + clamp(off, -lim, lim), half: half };
  }

  /* ------------------------------------------------------------ generation */

  function pad6(n) { var s = '' + n; while (s.length < 6) s = '0' + s; return s; }

  function addRock(S, x, depth, r) {
    var g = gapAt(S, depth);
    if (Math.abs(x - g.cx) < g.half + r * 0.9 + 2) return false;   // never block the lane
    var cx = centerXAt(S, depth), hw = halfW(S, depth);
    if (x - r < cx - hw - 6 || x + r > cx + hw + 6) return false;  // rocks live INSIDE the corridor
    var i, o, ddx, ddd, need;
    for (i = 0; i < S.rocks.length; i++) {
      o = S.rocks[i]; ddx = o.x - x; ddd = o.depth - depth; need = o.vr + r + 10;
      if (ddx * ddx + ddd * ddd < need * need) return false;
    }
    for (i = 0; i < S.items.length; i++) {
      o = S.items[i]; ddx = o.x - x; ddd = o.depth - depth;
      need = r + (o.type === 'power' ? 64 : 34);
      if (ddx * ddx + ddd * ddd < need * need) return false;
    }
    S.spawnIndex++;
    S.rocks.push({
      id: 'r' + pad6(S.spawnIndex), x: x, depth: depth,
      vr: r, cr: r * 0.86, active: true, minGap: Infinity, passed: false
    });
    return true;
  }

  function emitBand(S, db) {
    var dd = Math.min(1.2, diffAt(db));
    var g = gapAt(S, db);
    var cx = centerXAt(S, db), hw = halfW(S, db);
    var spans = [];
    var a1 = cx - hw + 3, b1 = g.cx - g.half - 2;
    var a2 = g.cx + g.half + 2, b2 = cx + hw - 3;
    if (b1 - a1 > 20) spans.push([a1, b1]);
    if (b2 - a2 > 20) spans.push([a2, b2]);
    if (!spans.length) return;

    var n = 1;
    if (R.f(S) < 0.40 + 0.28 * dd) n++;
    if (R.f(S) < 0.08 + 0.26 * dd) n++;

    for (var i = 0; i < n; i++) {
      var sp;
      if (spans.length === 1) sp = spans[0];
      else {
        var w0 = spans[0][1] - spans[0][0], w1 = spans[1][1] - spans[1][0];
        sp = R.f(S) < w0 / (w0 + w1) ? spans[0] : spans[1];
      }
      var avail = sp[1] - sp[0];
      if (avail < 22) continue;
      var rmax = Math.min(46, avail / 2 - 1);
      var roll = R.f(S), r;
      if (roll < 0.34) r = 10 + R.f(S) * 4;          // pebble
      else if (roll < 0.68) r = 16 + R.f(S) * 6;     // stone
      else if (roll < 0.90) r = 24 + R.f(S) * 9;     // boulder
      else r = 34 + R.f(S) * 12;                     // monolith: eats half the corridor
      if (r > rmax) r = rmax;
      if (r < 9) continue;
      var x = R.range(S, sp[0] + r, sp[1] - r);
      var depth = db + R.range(S, -34, 34);
      addRock(S, x, depth, r);
    }
  }

  /* Fragment formations. Neighbours are always within ~22 units laterally over
     a ~66 unit depth step, which is inside the machine's reach even at full
     throttle — a shape is swept, never darted between. */
  var SHAPES = ['line', 'chevron', 'stair', 'arc', 'wave'];

  function shapeOffsets(kind, n) {
    var o = [], i, t, v;
    for (i = 0; i < n; i++) {
      t = n > 1 ? i / (n - 1) : 0;
      if (kind === 'line') v = 0;
      else if (kind === 'chevron') v = 26 * (Math.abs(t - 0.5) * 2) - 13;      // く
      else if (kind === 'stair') v = 17 * (t - 0.5) * 2;                        // diagonal sweep
      else if (kind === 'arc') v = 22 * (1 - 4 * (t - 0.5) * (t - 0.5)) - 11;   // bulge
      else v = 15 * Math.sin(t * Math.PI * 2);                                  // wave
      o.push(v);
    }
    return o;
  }

  function emitFormation(S, d0) {
    var kind = R.pick(S, SHAPES);
    if (kind === S.lastShape) {
      var idx = SHAPES.indexOf(kind);
      kind = SHAPES[(idx + 1 + Math.floor(R.f(S) * (SHAPES.length - 1))) % SHAPES.length];
    }
    S.lastShape = kind;

    var n = 3 + Math.floor(R.f(S) * 3.999);         // 3..6 — a shape, never a pair
    var spacing = 62 + R.f(S) * 14;
    var offs = shapeOffsets(kind, n);
    var lo = offs[0], hi = offs[0], i;
    for (i = 1; i < n; i++) { if (offs[i] < lo) lo = offs[i]; if (offs[i] > hi) hi = offs[i]; }
    var spread = hi - lo;

    var midD = d0 + spacing * (n - 1) / 2;
    var room = Math.max(6, halfW(S, midD) - 20 - spread / 2);
    /* biased outward: most formations ask the player to leave the easy lane */
    var base = (R.f(S) < 0.5 ? -1 : 1) * Math.pow(R.f(S), 0.55) * room;

    /* Lay the shape out, then keep whichever mirror of it survives the rock
       field better — a formation is never allowed to decay into a pair. */
    function layout(bx) {
      var pts = [], prevX = null, j, o, ax, ad, need;
      for (var q = 0; q < n; q++) {
        var depth = d0 + q * spacing;
        var g = gapAt(S, depth);
        var cx = centerXAt(S, depth), hw = halfW(S, depth);
        var x = clamp(g.cx + bx + offs[q], cx - hw + 17, cx + hw - 17);
        if (prevX !== null) {
          var dxm = x - prevX;
          if (Math.abs(dxm) > 22) x = prevX + (dxm < 0 ? -22 : 22);   // stay sweepable
        }
        var bad = false;
        for (j = 0; j < S.rocks.length; j++) {
          o = S.rocks[j]; ax = o.x - x; ad = o.depth - depth; need = o.vr + 30;
          if (ax * ax + ad * ad < need * need) { bad = true; break; }
        }
        if (bad) continue;
        prevX = x;
        pts.push({ x: x, depth: depth });
      }
      return pts;
    }
    var pts = layout(base);
    if (pts.length < 3) {
      var alt = layout(-base);
      if (alt.length > pts.length) pts = alt;
    }
    if (pts.length < 3) return;

    S.formationSeq++;
    var fid = 'F' + S.formationSeq;
    for (i = 0; i < pts.length; i++) {
      S.spawnIndex++;
      S.items.push({
        id: 'i' + pad6(S.spawnIndex), type: 'fragment', x: pts[i].x, depth: pts[i].depth,
        vr: 10, cr: 9, active: true,
        formationId: fid, formationKind: kind, formationIndex: i
      });
    }
  }

  function emitPower(S, d0) {
    var depth = d0;
    for (var attempt = 0; attempt < 6; attempt++) {
      var g = gapAt(S, depth);
      var x = g.cx + R.range(S, -1, 1) * Math.min(26, g.half * 0.7);
      var bad = false, i, o, dx, dd, need;
      for (i = 0; i < S.rocks.length; i++) {
        o = S.rocks[i]; dx = o.x - x; dd = o.depth - depth; need = o.vr + 70;
        if (dx * dx + dd * dd < need * need) { bad = true; break; }
      }
      if (!bad) for (i = 0; i < S.items.length; i++) {
        o = S.items[i]; dx = o.x - x; dd = o.depth - depth;
        if (dx * dx + dd * dd < 46 * 46) { bad = true; break; }
      }
      if (!bad) {
        S.spawnIndex++;
        S.items.push({
          id: 'i' + pad6(S.spawnIndex), type: 'power', x: x, depth: depth,
          vr: 17, cr: 16, active: true,
          formationId: null, formationKind: null, formationIndex: 0
        });
        return;
      }
      depth += 90;
    }
  }

  function genTo(S, target) {
    /* +700 so a formation or a nudged power item scheduled at `target`
       still queries gap/centre data that really exists. */
    ensureSegments(S, target + 700);
    ensureGapNodes(S, target + 700);
    var guard = 0;
    while (guard++ < 400) {
      var nb = S.nextBandDepth, nf = S.nextFormDepth, np = S.nextPowerDepth;
      var m = Math.min(nb, nf, np);
      if (m > target) break;
      if (m === nf) {
        emitFormation(S, nf);
        S.nextFormDepth = nf + R.range(S, 820, 1080);
      } else if (m === np) {
        emitPower(S, np);
        S.nextPowerDepth = np + R.range(S, 6500, 12000);
      } else {
        emitBand(S, nb);
        var dd = Math.min(1, diffAt(nb));
        S.nextBandDepth = nb + R.range(S, 300, 440) * (1 - 0.32 * dd);
      }
    }
  }

  function cull(S) {
    var back = S.depth - 300, i;
    while (S.rocks.length && S.rocks[0].depth < back) S.rocks.shift();
    while (S.items.length && S.items[0].depth < back) S.items.shift();
    /* rocks/items are appended in ascending depth-ish order; sweep the rest */
    for (i = S.rocks.length - 1; i >= 0; i--) if (S.rocks[i].depth < back) S.rocks.splice(i, 1);
    for (i = S.items.length - 1; i >= 0; i--) if (S.items[i].depth < back) S.items.splice(i, 1);
    while (S.segs.length > 2 && S.segs[0].d1 < S.depth - 700) S.segs.shift();
    while (S.gapNodes.length > 3 && S.gapNodes[1].depth < S.depth - 700) S.gapNodes.shift();
  }

  /* ----------------------------------------------------------------- state */

  var S = {};
  D.state = S;

  function pushEvent(kind) {
    S.seq++;
    var e = { seq: S.seq, kind: kind, tick: S.tick };
    S.events.push(e);
    if (S.events.length > K.EVENT_MAX) S.events.shift();
    S.lastEvent = e;
  }

  /* View-only side channel. Never read by rules, never in the snapshot. */
  function fx(o) { S.fxQueue.push(o); if (S.fxQueue.length > 80) S.fxQueue.shift(); }

  function stall() {
    S.stallFrom = Math.max(S.speed, K.V_MIN);
    S.stallTicks = K.STALL_TICKS;
    S.combo = 0; S.comboTimer = 0;
  }

  function rankFor(score) {
    var g = LADDER[0];
    for (var i = 0; i < LADDER.length; i++) if (score >= LADDER[i].s) g = LADDER[i];
    return g.g;
  }

  function reset(seed) {
    seed = (seed >>> 0) || 1;
    S.seed = seed;
    S.rng = seed >>> 0;
    R.next(S); R.next(S); R.next(S);           // decorrelate low seeds

    S.phase = 'ready';
    S.tick = 0; S.acc = 0;
    S.x = 0; S.vx = 0; S.depth = 0;
    S.speed = K.V_MIN; S.stallTicks = 0; S.stallFrom = K.V_MIN;
    S.remainingMs = K.TIME_START;
    S.scoreAcc = 0;
    S.hits = 0; S.wallContacts = 0; S.fragmentsCollected = 0; S.rocksBroken = 0;
    S.invincibleUntilMs = 0; S.rank = null;
    S.wallCd = 0;
    S.events = []; S.seq = 0; S.lastEvent = null; S.fxQueue = [];
    S.spawnIndex = 0; S.formationSeq = 0; S.lastShape = null;
    S.rocks = []; S.items = [];
    S.difficulty = 0;
    S.input = { accel: false, steer: 0, left: false, right: false };

    S.hwPhase = R.f(S) * Math.PI * 2;
    S.segs = [{ d0: -600, d1: 520, x0: 0, x1: 0 }];   // a straight runway to start on
    S.segEnd = 520; S.segX = 0;
    S.lastDir = R.f(S) < 0.5 ? -1 : 1;
    S.gapNodes = [{ depth: -300, off: 0, half: K.PLAYER_R + 32 }];
    S.gapEnd = -300;

    S.nextBandDepth = 660 + R.f(S) * 120;
    S.nextFormDepth = 380 + R.f(S) * 90;
    /* The promise: holding the accelerator from the pad meets a power item
       well inside the first sixty seconds, on any seed — even for a player
       who keeps stalling into walls and averages a third of top speed. */
    S.nextPowerDepth = 1200 + R.f(S) * 1000;

    S.combo = 0; S.comboTimer = 0; S.bestCombo = 0; S.closestRatio = Infinity;
    S.maxDepth = 0; S.topSpeed = K.V_MIN;
    S.throttleTicks = 0; S.bestThrottleTicks = 0;

    genTo(S, K.PREVIEW_DEPTH + 700);
  }

  /* ------------------------------------------------------------------ step */

  function step() {
    if (S.phase !== 'playing') return;
    S.tick++;
    var dt = 1 / 60;
    var tMs = S.tick * STEP_MS;
    var i, o, dx, dd, dist2, rr;

    /* ---- speed: momentum you cannot take back instantly ---- */
    if (S.stallTicks > 0) {
      S.stallTicks--;
      S.speed = K.V_MIN + (S.stallFrom - K.V_MIN) * (S.stallTicks / K.STALL_TICKS);
    } else if (S.input.accel) {
      S.speed = Math.min(K.V_MAX, S.speed + K.ACCEL * dt);
    } else {
      S.speed = Math.max(K.V_MIN, S.speed - K.DECEL * dt);
    }
    if (S.speed < K.V_MIN) S.speed = K.V_MIN;   // the machine is always digging

    /* ---- lateral authority falls away with speed ---- */
    var sN = clamp((S.speed - K.V_MIN) / (K.V_MAX - K.V_MIN), 0, 1);
    var latMax = K.LAT_CRAWL + (K.LAT_TOP - K.LAT_CRAWL) * Math.pow(sN, 0.75);
    var latAcc = K.LATA_CRAWL + (K.LATA_TOP - K.LATA_CRAWL) * Math.pow(sN, 0.70);
    var target = clamp(S.input.steer, -1, 1) * latMax;
    var dv = latAcc * dt;
    if (S.vx < target) S.vx = Math.min(target, S.vx + dv);
    else if (S.vx > target) S.vx = Math.max(target, S.vx - dv);

    S.x += S.vx * dt;
    S.depth += S.speed * dt;

    /* ---- walls: solid, permanent, and they cost exactly what a rock costs ---- */
    var cx = centerXAt(S, S.depth), hw = halfW(S, S.depth);
    var loX = cx - hw + K.PLAYER_R, hiX = cx + hw - K.PLAYER_R;
    if (S.wallCd > 0) S.wallCd--;
    if (S.x < loX) {
      S.x = loX; if (S.vx < 0) S.vx = 0;
      if (S.wallCd === 0) {
        S.wallContacts++; S.wallCd = K.WALL_CD;
        stall(); pushEvent('wall_contact');
        fx({ kind: 'wall', x: S.x, depth: S.depth, side: -1, speed: S.stallFrom });
      }
    } else if (S.x > hiX) {
      S.x = hiX; if (S.vx > 0) S.vx = 0;
      if (S.wallCd === 0) {
        S.wallContacts++; S.wallCd = K.WALL_CD;
        stall(); pushEvent('wall_contact');
        fx({ kind: 'wall', x: S.x, depth: S.depth, side: 1, speed: S.stallFrom });
      }
    }

    genTo(S, S.depth + K.PREVIEW_DEPTH + 420);

    var inv = tMs < S.invincibleUntilMs;

    /* ---- rocks ----
       `hits`        counts ordinary (unpowered) rock collisions only.
       `rocksBroken` counts every rock destroyed, by either route — a rock
                     shatters whether it stopped you or you rammed it. */
    for (i = 0; i < S.rocks.length; i++) {
      o = S.rocks[i];
      if (!o.active) continue;
      dx = S.x - o.x; dd = S.depth - o.depth;
      dist2 = dx * dx + dd * dd;
      rr = K.PLAYER_R + o.cr;
      if (dist2 < rr * rr) {
        o.active = false;
        if (inv) {
          S.rocksBroken++;
          S.remainingMs = Math.min(K.TIME_CAP, S.remainingMs + K.BREAK_TIME);
          S.scoreAcc += 55;
          pushEvent('rock_broken');
          fx({ kind: 'smash', x: o.x, depth: o.depth, r: o.vr, powered: true });
        } else {
          S.hits++;
          pushEvent('rock_hit');
          S.rocksBroken++;
          pushEvent('rock_broken');
          stall();
          fx({ kind: 'smash', x: o.x, depth: o.depth, r: o.vr, powered: false, speed: S.stallFrom });
        }
        continue;
      }
      if (dd > -180 && dd < 90) {
        var gap = Math.sqrt(dist2) - rr;
        if (gap < o.minGap) o.minGap = gap;
      }
      if (!o.passed && o.depth < S.depth - 2) {
        o.passed = true;
        if (o.minGap < K.NEAR_GAP) {
          S.combo++; S.comboTimer = K.COMBO_TICKS;
          if (S.combo > S.bestCombo) S.bestCombo = S.combo;
          var ratio = Math.max(0, o.minGap) / K.NEAR_GAP;
          if (ratio < S.closestRatio) S.closestRatio = ratio;
          S.scoreAcc += 16 * Math.min(S.combo, 8);
          pushEvent('near_miss');
          fx({ kind: 'near', x: o.x, depth: o.depth, r: o.vr, gap: o.minGap, combo: S.combo });
        }
      }
    }

    /* ---- collectibles ---- */
    for (i = 0; i < S.items.length; i++) {
      o = S.items[i];
      if (!o.active) continue;
      dx = S.x - o.x; dd = S.depth - o.depth;
      rr = K.PLAYER_R + o.cr;
      if (dx * dx + dd * dd < rr * rr) {
        o.active = false;
        if (o.type === 'fragment') {
          S.fragmentsCollected++;
          S.remainingMs = Math.min(K.TIME_CAP, S.remainingMs + K.FRAG_TIME);
          S.scoreAcc += 14;
          pushEvent('fragment');
          fx({ kind: 'frag', x: o.x, depth: o.depth, idx: o.formationIndex });
        } else {
          S.invincibleUntilMs = Math.max(S.invincibleUntilMs, tMs) + K.POWER_MS;
          pushEvent('power');
          fx({ kind: 'power', x: o.x, depth: o.depth });
        }
      }
    }

    /* ---- clock, score, bookkeeping ---- */
    S.remainingMs -= STEP_MS;
    S.scoreAcc += (S.speed * dt) * (0.22 + 0.68 * sN);   // depth, weighted by bravery

    if (S.comboTimer > 0) { S.comboTimer--; if (S.comboTimer === 0) S.combo = 0; }
    if (S.depth > S.maxDepth) S.maxDepth = S.depth;
    if (S.speed > S.topSpeed) S.topSpeed = S.speed;
    if (S.input.accel && S.stallTicks === 0) {
      S.throttleTicks++;
      if (S.throttleTicks > S.bestThrottleTicks) S.bestThrottleTicks = S.throttleTicks;
    } else S.throttleTicks = 0;

    S.difficulty = diffAt(S.depth);
    if ((S.tick & 15) === 0) cull(S);

    if (S.remainingMs <= 0) {
      S.remainingMs = 0;
      S.phase = 'gameover';
      S.rank = rankFor(Math.floor(S.scoreAcc));
      fx({ kind: 'end' });
    }
  }

  function advance(ms) {
    if (S.phase !== 'playing') return;      // frozen in ready and after the run
    if (!(ms > 0)) return;
    S.acc += ms;
    var guard = 0;
    while (S.acc >= STEP_MS && guard++ < 20000) {
      S.acc -= STEP_MS;
      step();
      if (S.phase !== 'playing') { S.acc = 0; break; }
    }
  }

  /* -------------------------------------------------------------- snapshot */

  function snapshot() {
    var i, d, dep, c, h, o;

    var walls = [];
    for (d = 0; d <= K.PREVIEW_DEPTH + 0.001; d += 20) {
      dep = S.depth + d; c = centerXAt(S, dep); h = halfW(S, dep);
      walls.push({ depth: r2(dep), leftX: r2(c - h), rightX: r2(c + h) });
    }

    var safe = Infinity;
    for (d = 0; d <= K.PREVIEW_DEPTH + 0.001; d += 20) {
      dep = S.depth + d; c = centerXAt(S, dep); h = halfW(S, dep);
      var free = [[c - h, c + h]];
      for (i = 0; i < S.rocks.length; i++) {
        o = S.rocks[i];
        if (!o.active) continue;
        var od = o.depth - dep;
        if (od * od >= o.cr * o.cr) continue;
        var hh = Math.sqrt(o.cr * o.cr - od * od);
        var a = o.x - hh, b = o.x + hh, nf = [];
        for (var k = 0; k < free.length; k++) {
          var iv = free[k];
          if (b <= iv[0] || a >= iv[1]) { nf.push(iv); continue; }
          if (a > iv[0]) nf.push([iv[0], a]);
          if (b < iv[1]) nf.push([b, iv[1]]);
        }
        free = nf;
      }
      var widest = 0;
      for (i = 0; i < free.length; i++) if (free[i][1] - free[i][0] > widest) widest = free[i][1] - free[i][0];
      if (widest / 2 < safe) safe = widest / 2;
    }
    if (!isFinite(safe)) safe = halfW(S, S.depth);

    var loD = S.depth - 80, hiD = S.depth + K.PREVIEW_DEPTH;
    var rocks = [], items = [];
    for (i = 0; i < S.rocks.length; i++) {
      o = S.rocks[i];
      if (o.depth < loD || o.depth > hiD) continue;
      rocks.push({
        id: o.id, position: { x: r2(o.x), depth: r2(o.depth) }, active: o.active,
        visualRadius: r2(o.vr), collisionRadius: r2(o.cr)
      });
    }
    for (i = 0; i < S.items.length; i++) {
      o = S.items[i];
      if (o.depth < loD || o.depth > hiD) continue;
      var e = {
        id: o.id, type: o.type, position: { x: r2(o.x), depth: r2(o.depth) }, active: o.active,
        visualRadius: r2(o.vr), collisionRadius: r2(o.cr)
      };
      if (o.type === 'fragment') {
        e.formationId = o.formationId;
        e.formationKind = o.formationKind;
        e.formationIndex = o.formationIndex;
      }
      items.push(e);
    }
    rocks.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    items.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });

    var evts = [];
    for (i = 0; i < S.events.length; i++) {
      evts.push({ seq: S.events[i].seq, kind: S.events[i].kind, tick: S.events[i].tick });
    }

    var tMs = Math.round(S.tick * STEP_MS);
    var cxNow = centerXAt(S, S.depth);

    return {
      phase: S.phase,
      tick: S.tick,
      elapsedMs: tMs,
      timeMs: tMs,
      remainingMs: Math.round(S.remainingMs),
      seed: S.seed,
      rngState: S.rng >>> 0,
      spawnIndex: S.spawnIndex,
      input: {
        accel: !!S.input.accel,
        steer: r2(clamp(S.input.steer, -1, 1)),
        left: !!S.input.left,
        right: !!S.input.right
      },
      difficulty: r4(S.difficulty),
      score: Math.floor(S.scoreAcc),
      depth: r2(S.depth),

      x: r2(S.x),
      playerRadius: r2(K.PLAYER_R),
      speed: r2(S.speed),
      maxSpeed: r2(K.V_MAX),

      hits: S.hits,
      wallContacts: S.wallContacts,
      fragmentsCollected: S.fragmentsCollected,
      rocksBroken: S.rocksBroken,
      invincibleUntilMs: Math.round(S.invincibleUntilMs),
      rank: S.rank,

      courseCenterX: r2(cxNow),
      corridorHalfWidth: r2(halfW(S, S.depth)),
      walls: walls,
      safeHalfWidth: r2(safe),
      previewMs: Math.round(K.PREVIEW_DEPTH / K.V_MAX * 1000),

      rocks: rocks,
      items: items,

      events: evts,
      lastEvent: S.lastEvent ? { seq: S.lastEvent.seq, kind: S.lastEvent.kind, tick: S.lastEvent.tick } : null
    };
  }

  /* Input is delivered by DOM events; this is the single door into it. */
  function setInput(accel, steer, left, right) {
    S.input.accel = !!accel;
    S.input.steer = clamp(steer || 0, -1, 1);
    S.input.left = !!left;
    S.input.right = !!right;
    if (S.phase === 'ready' && S.input.accel) S.phase = 'playing';
  }

  D.sim = {
    K: K, LADDER: LADDER, S: S,
    reset: reset, step: step, advance: advance, snapshot: snapshot,
    setInput: setInput, rankFor: rankFor,
    centerXAt: centerXAt, halfW: halfW, gapAt: gapAt, diffAt: diffAt
  };
})();
