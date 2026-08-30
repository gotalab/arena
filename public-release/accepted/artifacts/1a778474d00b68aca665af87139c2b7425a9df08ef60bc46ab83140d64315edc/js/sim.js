// DELVE — deterministic simulation core.
// Pure logic, no DOM, no Date.now(), no Math.random(). Fixed 60Hz step.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DelveSim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TICK_MS = 1000 / 60;
  var TICK_S = TICK_MS / 1000;

  // ---- tuning constants -----------------------------------------------
  var CRAWL_SPEED = 42;          // depth units / sec, absolute floor
  var MAX_SPEED = 232;           // full throttle
  var CRUISE_SPEED = MAX_SPEED * 0.5;
  var SPEED_ACCEL_RATE = 2.15;   // exponential approach rate toward maxSpeed
  var SPEED_DECEL_RATE = 0.85;   // exponential approach rate toward crawl (coast)
  var LATERAL_MAX_CRAWL = 205;   // lateral units/sec at crawl
  var LATERAL_MAX_FULL = 52;     // lateral units/sec at full throttle
  var LATERAL_RESPONSE_RATE = 9.5; // exponential smoothing rate for lateral velocity
  var PLAYER_RADIUS = 13;

  var BASE_HALF_WIDTH = 96;
  var MIN_HALF_WIDTH = 54;
  var MAX_HALF_WIDTH = 118;
  var CENTER_LIMIT = 82; // corridor centre stays within [-CENTER_LIMIT, CENTER_LIMIT]

  var PREVIEW_DEPTH = 950; // world units always generated/reported ahead of player
  var PRUNE_BEHIND = 40;   // margin before dropping entities behind the player

  var INITIAL_TIME_MS = 24000;
  var FRAGMENT_TIME_MS = 2500;
  var ROCK_BREAK_TIME_MS = 1400;
  var POWER_DURATION_MS = 6000;
  var FIRST_POWER_DEPTH = 3000; // guarantees < 60s even accounting for ramp-up
  var POWER_MIN_GAP_DEPTH = 3600;
  var POWER_MAX_GAP_DEPTH = 6200;

  var SCORE_DEPTH_SCALE = 1.0;
  var SCORE_FRAGMENT_BONUS = 15;
  var SCORE_ROCK_BREAK_BONUS = 60;

  var RANK_LADDER = [
    { grade: 'D', min: 0 },
    { grade: 'C', min: 2500 },
    { grade: 'B', min: 6000 },
    { grade: 'A', min: 11000 },
    { grade: 'S', min: 18000 }
  ];

  // ---- seeded RNG -------------------------------------------------------
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function seedToUint32(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return (seed >>> 0) || 1;
    var str = String(seed == null ? 'delve' : seed);
    var gen = xmur3(str);
    var v = gen() >>> 0;
    return v || 1;
  }

  function makeRng(seed) {
    var a = seedToUint32(seed);
    return {
      get state() { return a >>> 0; },
      set state(v) { a = v >>> 0; },
      next: function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: function (lo, hi) { return lo + (hi - lo) * this.next(); },
      pick: function (arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
    };
  }

  // ---- math helpers -------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function expApproach(current, target, rate, dt) {
    var k = 1 - Math.exp(-rate * dt);
    return current + (target - current) * k;
  }
  // snapshot precision contract: positions/speeds/depth/score round to 2
  // decimals, millisecond and count fields round to whole numbers.
  function round2(v) { return Math.round(v * 100) / 100; }
  function round0(v) { return Math.round(v); }

  // ---- corridor -----------------------------------------------------------
  // Control points are generated ahead of the player as depth advances.
  function genControlPoint(state, prev) {
    var rng = state.rng;
    var difficulty = prev.depth / 1400;
    var calm = state.segmentsSinceCalm >= 4 && rng.next() < 0.55;
    var segLen;
    var swing;
    var halfWidth;

    if (calm) {
      segLen = rng.range(260, 360);
      swing = rng.range(-18, 18);
      halfWidth = rng.range(MAX_HALF_WIDTH - 10, MAX_HALF_WIDTH);
      state.segmentsSinceCalm = 0;
    } else {
      segLen = rng.range(190, 340) - Math.min(60, difficulty * 14);
      segLen = Math.max(150, segLen);
      var maxSwing = Math.min(96, 46 + difficulty * 11);
      swing = rng.range(-maxSwing, maxSwing);
      var narrowBias = Math.min(1, difficulty / 5.5);
      var hwLo = lerp(MAX_HALF_WIDTH - 22, MIN_HALF_WIDTH, narrowBias);
      var hwHi = lerp(MAX_HALF_WIDTH, MIN_HALF_WIDTH + 24, narrowBias);
      halfWidth = rng.range(hwLo, hwHi);
      state.segmentsSinceCalm++;
    }

    halfWidth = clamp(halfWidth, MIN_HALF_WIDTH, MAX_HALF_WIDTH);
    var centerX = clamp(prev.centerX + swing, -CENTER_LIMIT, CENTER_LIMIT);
    return {
      depth: prev.depth + segLen,
      centerX: centerX,
      halfWidth: halfWidth
    };
  }

  function corridorAt(state, depth) {
    var pts = state.controlPoints;
    var i = 0;
    while (i < pts.length - 1 && pts[i + 1].depth < depth) i++;
    var p0 = pts[i];
    var p1 = pts[Math.min(i + 1, pts.length - 1)];
    if (p0 === p1) return { centerX: p0.centerX, halfWidth: p0.halfWidth };
    var t = (depth - p0.depth) / (p1.depth - p0.depth);
    var e = smoothstep(t);
    return {
      centerX: lerp(p0.centerX, p1.centerX, e),
      halfWidth: lerp(p0.halfWidth, p1.halfWidth, e)
    };
  }

  function ensureCorridorGenerated(state, uptoDepth) {
    var pts = state.controlPoints;
    while (pts[pts.length - 1].depth < uptoDepth) {
      pts.push(genControlPoint(state, pts[pts.length - 1]));
    }
  }

  // ---- entity generation ----------------------------------------------------
  var FORMATION_KINDS = ['line', 'chevron', 'triangle', 'arc'];

  function nextId(state) { state.nextEntityId++; return state.nextEntityId; }

  function placeRockCluster(state, atDepth) {
    var rng = state.rng;
    var shape = corridorAt(state, atDepth);
    var difficulty = atDepth / 1400;
    var openHalf = shape.halfWidth - PLAYER_RADIUS - 8;
    if (openHalf < 24) return; // corridor too tight here, skip

    var bigOne = rng.next() < Math.min(0.22, 0.06 + difficulty * 0.03);
    var side = rng.pick([-1, 0, 1]); // where the SAFE gap sits
    var gapWidth = Math.max(PLAYER_RADIUS * 2 + 20, shape.halfWidth * rng.range(0.42, 0.6));
    var gapCenter = side === 0 ? shape.centerX : shape.centerX + side * (shape.halfWidth - gapWidth * 0.5 - 6);
    gapCenter = clamp(gapCenter, shape.centerX - shape.halfWidth + gapWidth * 0.5 + 4, shape.centerX + shape.halfWidth - gapWidth * 0.5 - 4);

    var leftWall = shape.centerX - shape.halfWidth;
    var rightWall = shape.centerX + shape.halfWidth;
    var gapLo = gapCenter - gapWidth / 2;
    var gapHi = gapCenter + gapWidth / 2;

    var spans = [];
    if (gapLo - leftWall > PLAYER_RADIUS * 1.6) spans.push([leftWall + 6, gapLo]);
    if (rightWall - gapHi > PLAYER_RADIUS * 1.6) spans.push([gapHi, rightWall - 6]);

    if (bigOne && spans.length) {
      var span = spans[0];
      var r = Math.min((span[1] - span[0]) / 2 - 4, rng.range(30, 46));
      if (r > 10) {
        var cx = (span[0] + span[1]) / 2;
        state.rocks.push({ id: nextId(state), x: cx, depth: atDepth, visualRadius: r, collisionRadius: r * 0.86, active: true, nearMissDone: false });
      }
      return;
    }

    for (var s = 0; s < spans.length; s++) {
      var lo = spans[s][0], hi = spans[s][1];
      var width = hi - lo;
      if (width < 14) continue;
      var count = width > 60 ? 2 : 1;
      var chunk = width / count;
      for (var c = 0; c < count; c++) {
        var cLo = lo + chunk * c, cHi = lo + chunk * (c + 1);
        var maxR = Math.min(chunk / 2 - 3, 30);
        if (maxR < 9) continue;
        var radius = rng.range(9, maxR);
        var cx2 = clamp(rng.range(cLo + radius, cHi - radius), cLo, cHi);
        var jitterDepth = atDepth + rng.range(-14, 14);
        state.rocks.push({ id: nextId(state), x: cx2, depth: jitterDepth, visualRadius: radius, collisionRadius: radius * 0.86, active: true, nearMissDone: false });
      }
    }
  }

  function rocksNear(state, depth, spread) {
    var out = [];
    for (var i = 0; i < state.rocks.length; i++) {
      var r = state.rocks[i];
      if (Math.abs(r.depth - depth) < spread) out.push(r);
    }
    return out;
  }

  function nudgeOffRocks(state, x, depth, shape) {
    var blockers = rocksNear(state, depth, 26);
    for (var b = 0; b < blockers.length; b++) {
      var rk = blockers[b];
      if (Math.abs(x - rk.x) < rk.visualRadius + 14) {
        x = x + (x < rk.x ? -1 : 1) * (rk.visualRadius + 16);
        x = clamp(x, shape.centerX - shape.halfWidth + 14, shape.centerX + shape.halfWidth - 14);
      }
    }
    return x;
  }

  function placeFormation(state, startDepth) {
    var rng = state.rng;
    var kind = FORMATION_KINDS[state.formationCursor % FORMATION_KINDS.length];
    state.formationCursor++;
    var count = kind === 'triangle' ? 4 + (rng.next() < 0.5 ? 1 : 0) : (3 + (rng.next() < 0.4 ? 1 : 0));
    var spacing = rng.range(34, 46);
    var formationId = 'f' + nextId(state);
    var shape = corridorAt(state, startDepth);
    var baseX = clamp(shape.centerX + rng.range(-shape.halfWidth * 0.4, shape.halfWidth * 0.4), shape.centerX - shape.halfWidth + 20, shape.centerX + shape.halfWidth - 20);

    for (var i = 0; i < count; i++) {
      var depth = startDepth + i * spacing;
      var s = corridorAt(state, depth);
      var lateralOffset = 0;
      var span = Math.min(s.halfWidth - 24, 38);
      var u = count > 1 ? i / (count - 1) : 0;
      if (kind === 'line') {
        // straight run along the path
        lateralOffset = 0;
      } else if (kind === 'chevron') {
        // symmetric V, apex at the middle: opens across the corridor
        var mid = (count - 1) / 2;
        lateralOffset = span * (Math.abs(i - mid) / Math.max(1, mid));
      } else if (kind === 'triangle') {
        // single smooth ramp up then down, peak off-centre
        var peak = 0.34;
        var t = u < peak ? (u / peak) : (1 - (u - peak) / (1 - peak));
        lateralOffset = span * t;
      } else { // arc: one gentle bulge to a single side
        lateralOffset = span * Math.sin(Math.PI * u);
      }
      var x = clamp(baseX + lateralOffset, s.centerX - s.halfWidth + 16, s.centerX + s.halfWidth - 16);
      x = nudgeOffRocks(state, x, depth, s);

      state.items.push({
        id: nextId(state), type: 'fragment', x: x, depth: depth,
        visualRadius: 9, collisionRadius: 9, active: true,
        formationId: formationId, formationKind: kind, formationIndex: i
      });
    }
  }

  function placePower(state, atDepth) {
    var shape = corridorAt(state, atDepth);
    var rng = state.rng;
    var x = clamp(shape.centerX + rng.range(-shape.halfWidth * 0.3, shape.halfWidth * 0.3), shape.centerX - shape.halfWidth + 18, shape.centerX + shape.halfWidth - 18);
    x = nudgeOffRocks(state, x, atDepth, shape);
    state.items.push({
      id: nextId(state), type: 'power', x: x, depth: atDepth,
      visualRadius: 13, collisionRadius: 13, active: true,
      formationId: null, formationKind: null, formationIndex: 0
    });
  }

  function ensureEntitiesGenerated(state, uptoDepth) {
    while (state.rockGenDepth < uptoDepth) {
      var difficulty = state.rockGenDepth / 1400;
      var spacing = state.rng.range(220, 320) - Math.min(90, difficulty * 20);
      state.rockGenDepth += Math.max(150, spacing);
      if (state.rockGenDepth > 300) placeRockCluster(state, state.rockGenDepth);
    }
    while (state.formationGenDepth < uptoDepth) {
      state.formationGenDepth += state.rng.range(320, 520);
      if (state.formationGenDepth > 140) placeFormation(state, state.formationGenDepth);
    }
    while (state.powerGenDepth < uptoDepth) {
      if (!state.firstPowerPlaced) {
        placePower(state, FIRST_POWER_DEPTH);
        state.firstPowerPlaced = true;
        state.powerGenDepth = FIRST_POWER_DEPTH + state.rng.range(POWER_MIN_GAP_DEPTH, POWER_MAX_GAP_DEPTH);
      } else {
        placePower(state, state.powerGenDepth);
        state.powerGenDepth += state.rng.range(POWER_MIN_GAP_DEPTH, POWER_MAX_GAP_DEPTH);
      }
    }
  }

  // ---- events -----------------------------------------------------------
  function pushEvent(state, kind) {
    state.eventSeq++;
    var ev = { seq: state.eventSeq, kind: kind, tick: state.tick };
    state.events.push(ev);
    if (state.events.length > 100) state.events.shift();
    state.lastEvent = ev;
  }

  // ---- core state ---------------------------------------------------------
  function freshState(seed) {
    var rng = makeRng(seed);
    var s = {
      seed: seed,
      rng: rng,
      phase: 'ready',
      tick: 0,
      timeMs: 0,
      remainingMs: INITIAL_TIME_MS,
      accumulatorMs: 0,
      x: 0,
      depth: 0,
      speed: CRAWL_SPEED,
      lateralVel: 0,
      score: 0,
      hits: 0,
      wallContacts: 0,
      fragmentsCollected: 0,
      rocksBroken: 0,
      invincibleUntilMs: 0,
      rank: null,
      input: { accel: false, steer: 0 },
      wallContactActive: false,
      nextEntityId: 0,
      rocks: [],
      items: [],
      controlPoints: [{ depth: 0, centerX: 0, halfWidth: BASE_HALF_WIDTH }],
      segmentsSinceCalm: 0,
      rockGenDepth: 0,
      formationGenDepth: 0,
      formationCursor: 0,
      powerGenDepth: 0,
      firstPowerPlaced: false,
      events: [],
      eventSeq: 0,
      lastEvent: null,
      closestShaveGap: null,
      longestFullThrottleMs: 0,
      currentFullThrottleMs: 0,
      maxDepthReached: 0
    };
    ensureCorridorGenerated(s, PREVIEW_DEPTH + 50);
    ensureEntitiesGenerated(s, PREVIEW_DEPTH + 50);
    return s;
  }

  function computeRank(score) {
    var grade = RANK_LADDER[0].grade;
    for (var i = 0; i < RANK_LADDER.length; i++) {
      if (score >= RANK_LADDER[i].min) grade = RANK_LADDER[i].grade;
    }
    return grade;
  }

  function pruneEntities(state) {
    var cut = state.depth - PRUNE_BEHIND;
    state.rocks = state.rocks.filter(function (r) { return r.depth >= cut; });
    state.items = state.items.filter(function (it) { return it.depth >= cut; });
  }

  function tick(state) {
    if (state.phase === 'gameover') return;
    if (state.phase === 'ready') {
      if (state.input.accel) {
        state.phase = 'playing';
      } else {
        return;
      }
    }

    state.tick++;
    state.timeMs += TICK_MS;

    var powered = state.timeMs < state.invincibleUntilMs;

    // --- longitudinal speed ---
    var targetSpeed = state.input.accel ? MAX_SPEED : CRAWL_SPEED;
    var rate = state.input.accel ? SPEED_ACCEL_RATE : SPEED_DECEL_RATE;
    state.speed = expApproach(state.speed, targetSpeed, rate, TICK_S);
    state.speed = clamp(state.speed, CRAWL_SPEED, MAX_SPEED);

    if (state.speed >= MAX_SPEED * 0.92) {
      state.currentFullThrottleMs += TICK_MS;
      if (state.currentFullThrottleMs > state.longestFullThrottleMs) {
        state.longestFullThrottleMs = state.currentFullThrottleMs;
      }
    } else {
      state.currentFullThrottleMs = 0;
    }

    // --- lateral steering ---
    var normSpeed = clamp((state.speed - CRAWL_SPEED) / (MAX_SPEED - CRAWL_SPEED), 0, 1);
    var lateralCap = LATERAL_MAX_CRAWL * Math.pow(LATERAL_MAX_FULL / LATERAL_MAX_CRAWL, normSpeed);
    var targetLateral = clamp(state.input.steer, -1, 1) * lateralCap;
    state.lateralVel = expApproach(state.lateralVel, targetLateral, LATERAL_RESPONSE_RATE, TICK_S);

    var prevX = state.x;
    var prevDepth = state.depth;
    state.x = state.x + state.lateralVel * TICK_S;
    state.depth = state.depth + state.speed * TICK_S;
    if (state.depth > state.maxDepthReached) state.maxDepthReached = state.depth;

    // --- ensure world generated ahead ---
    ensureCorridorGenerated(state, state.depth + PREVIEW_DEPTH + 50);
    ensureEntitiesGenerated(state, state.depth + PREVIEW_DEPTH + 50);

    // --- wall clamp / contact ---
    var shape = corridorAt(state, state.depth);
    var lo = shape.centerX - shape.halfWidth + PLAYER_RADIUS;
    var hi = shape.centerX + shape.halfWidth - PLAYER_RADIUS;
    var clamped = false;
    if (state.x < lo) { state.x = lo; clamped = true; }
    else if (state.x > hi) { state.x = hi; clamped = true; }

    if (clamped) {
      if (!state.wallContactActive) {
        state.wallContactActive = true;
        state.wallContacts++;
        state.speed = CRAWL_SPEED;
        state.lateralVel = 0;
        pushEvent(state, 'wall_contact');
      }
    } else {
      state.wallContactActive = false;
    }

    // --- rocks ---
    for (var i = 0; i < state.rocks.length; i++) {
      var rock = state.rocks[i];
      if (rock.depth < state.depth - PRUNE_BEHIND) continue;
      if (rock.active) {
        var dx = state.x - rock.x;
        var dd = state.depth - rock.depth;
        var dist = Math.sqrt(dx * dx + dd * dd);
        var hitDist = rock.collisionRadius + PLAYER_RADIUS;
        if (dist <= hitDist) {
          rock.active = false;
          if (powered) {
            state.rocksBroken++;
            state.remainingMs += ROCK_BREAK_TIME_MS;
            pushEvent(state, 'rock_broken');
          } else {
            state.hits++;
            state.speed = CRAWL_SPEED;
            pushEvent(state, 'rock_hit');
          }
          rock.nearMissDone = true;
        }
      }
      // near-miss detection: rock just passed by (depth crossed) without collision
      if (!rock.nearMissDone && rock.depth <= state.depth && rock.depth > prevDepth - 0.0001) {
        var travel = state.depth - prevDepth;
        var tCross = travel > 0 ? clamp((rock.depth - prevDepth) / travel, 0, 1) : 1;
        var xAtCross = lerp(prevX, state.x, tCross);
        var gap = Math.abs(xAtCross - rock.x) - (rock.collisionRadius + PLAYER_RADIUS);
        var machineWidth = PLAYER_RADIUS * 2;
        if (gap >= 0 && gap < machineWidth) {
          pushEvent(state, 'near_miss');
          if (state.closestShaveGap === null || gap < state.closestShaveGap) {
            state.closestShaveGap = gap;
          }
        }
        rock.nearMissDone = true;
      } else if (!rock.nearMissDone && rock.depth <= prevDepth) {
        rock.nearMissDone = true;
      }
    }

    // --- items (fragments / power) ---
    for (var j = 0; j < state.items.length; j++) {
      var item = state.items[j];
      if (!item.active) continue;
      if (item.depth < state.depth - PRUNE_BEHIND) continue;
      var idx = state.x - item.x;
      var idd = state.depth - item.depth;
      var idist = Math.sqrt(idx * idx + idd * idd);
      if (idist <= item.collisionRadius + PLAYER_RADIUS) {
        item.active = false;
        if (item.type === 'fragment') {
          state.fragmentsCollected++;
          state.remainingMs += FRAGMENT_TIME_MS;
          pushEvent(state, 'fragment');
        } else if (item.type === 'power') {
          state.invincibleUntilMs = state.timeMs + POWER_DURATION_MS;
          pushEvent(state, 'power');
        }
      }
    }

    pruneEntities(state);

    // --- score & timer ---
    state.score = state.depth * SCORE_DEPTH_SCALE +
      state.fragmentsCollected * SCORE_FRAGMENT_BONUS +
      state.rocksBroken * SCORE_ROCK_BREAK_BONUS;

    state.remainingMs -= TICK_MS;
    if (state.remainingMs <= 0) {
      state.remainingMs = 0;
      state.phase = 'gameover';
      state.rank = computeRank(state.score);
    }
  }

  function advance(state, ms) {
    state.accumulatorMs += Math.max(0, ms);
    var guard = 0;
    while (state.accumulatorMs >= TICK_MS && state.phase !== 'gameover' && guard < 100000) {
      tick(state);
      state.accumulatorMs -= TICK_MS;
      guard++;
    }
    if (state.phase === 'gameover') state.accumulatorMs = 0;
  }

  function difficultyOf(state) { return state.depth / 1000; }

  function buildWalls(state) {
    var out = [];
    var steps = 14;
    var span = PREVIEW_DEPTH;
    for (var i = 0; i <= steps; i++) {
      var d = state.depth + (span * i) / steps;
      var shape = corridorAt(state, d);
      out.push({
        depth: round2(d),
        leftX: round2(shape.centerX - shape.halfWidth),
        rightX: round2(shape.centerX + shape.halfWidth)
      });
    }
    return out;
  }

  function computeSafeHalfWidth(state) {
    // narrowest continuous gap within the preview horizon, accounting for rocks
    var shape = corridorAt(state, state.depth);
    var best = shape.halfWidth * 2;
    var samples = 20;
    for (var i = 0; i <= samples; i++) {
      var d = state.depth + (PREVIEW_DEPTH * i) / samples;
      var s = corridorAt(state, d);
      var left = s.centerX - s.halfWidth;
      var right = s.centerX + s.halfWidth;
      var blockers = rocksNear(state, d, 30).filter(function (r) { return r.active; });
      var bestGapHere = 0;
      var segs = [];
      for (var b = 0; b < blockers.length; b++) {
        segs.push([blockers[b].x - blockers[b].visualRadius, blockers[b].x + blockers[b].visualRadius]);
      }
      segs.sort(function (a, b) { return a[0] - b[0]; });
      var pos = left;
      for (var k = 0; k < segs.length; k++) {
        if (segs[k][0] > pos) bestGapHere = Math.max(bestGapHere, segs[k][0] - pos);
        pos = Math.max(pos, segs[k][1]);
      }
      bestGapHere = Math.max(bestGapHere, right - pos);
      var widthHere = Math.min(bestGapHere, right - left);
      best = Math.min(best, widthHere);
    }
    return round2(Math.max(0, best / 2));
  }

  function snapshotItem(it) {
    var o = {
      id: it.id, type: it.type,
      position: { x: round2(it.x), depth: round2(it.depth) },
      active: it.active,
      visualRadius: round2(it.visualRadius),
      collisionRadius: round2(it.collisionRadius)
    };
    if (it.type === 'fragment') {
      o.formationId = it.formationId;
      o.formationKind = it.formationKind;
      o.formationIndex = it.formationIndex;
    }
    return o;
  }

  function snapshot(state) {
    var shape = corridorAt(state, state.depth);
    var rocksSorted = state.rocks.slice().sort(function (a, b) { return a.id - b.id; });
    var itemsSorted = state.items.slice().sort(function (a, b) { return a.id - b.id; });

    return {
      phase: state.phase,
      tick: state.tick,
      elapsedMs: round0(state.timeMs),
      timeMs: round0(state.timeMs),
      remainingMs: round0(state.remainingMs),
      seed: state.seed,
      rngState: state.rng.state,
      spawnIndex: state.nextEntityId,
      input: { accel: !!state.input.accel, steer: round2(state.input.steer) },
      difficulty: round2(difficultyOf(state)),
      score: round2(state.score),
      depth: round2(state.depth),

      x: round2(state.x),
      playerRadius: round2(PLAYER_RADIUS),
      speed: round2(state.speed),
      maxSpeed: round2(MAX_SPEED),

      hits: state.hits,
      wallContacts: state.wallContacts,
      fragmentsCollected: state.fragmentsCollected,
      rocksBroken: state.rocksBroken,
      invincibleUntilMs: round0(state.invincibleUntilMs),
      rank: state.rank,

      courseCenterX: round2(shape.centerX),
      corridorHalfWidth: round2(shape.halfWidth),
      walls: buildWalls(state),
      safeHalfWidth: computeSafeHalfWidth(state),
      previewMs: round0((PREVIEW_DEPTH / MAX_SPEED) * 1000),

      rocks: rocksSorted.map(function (r) {
        return {
          id: r.id,
          position: { x: round2(r.x), depth: round2(r.depth) },
          active: r.active,
          visualRadius: round2(r.visualRadius),
          collisionRadius: round2(r.collisionRadius)
        };
      }),
      items: itemsSorted.map(snapshotItem),

      events: state.events.slice(),
      lastEvent: state.lastEvent,

      signature: {
        closestShaveGap: state.closestShaveGap === null ? null : round2(state.closestShaveGap),
        longestFullThrottleMs: round0(state.longestFullThrottleMs),
        deepestDepth: round2(state.maxDepthReached)
      }
    };
  }

  function reset(state, seed) {
    var s = freshState(seed === undefined ? state.seed : seed);
    // copy into same object reference so external holders stay valid
    Object.keys(state).forEach(function (k) { delete state[k]; });
    Object.keys(s).forEach(function (k) { state[k] = s[k]; });
    return state;
  }

  function create(seed) {
    return freshState(seed);
  }

  function setInput(state, patch) {
    if (patch.accel !== undefined) state.input.accel = !!patch.accel;
    if (patch.steer !== undefined) state.input.steer = clamp(patch.steer, -1, 1);
  }

  return {
    TICK_MS: TICK_MS,
    CRAWL_SPEED: CRAWL_SPEED,
    MAX_SPEED: MAX_SPEED,
    PLAYER_RADIUS: PLAYER_RADIUS,
    PREVIEW_DEPTH: PREVIEW_DEPTH,
    POWER_DURATION_MS: POWER_DURATION_MS,
    create: create,
    reset: reset,
    advance: advance,
    snapshot: snapshot,
    setInput: setInput,
    computeRank: computeRank,
    RANK_LADDER: RANK_LADDER
  };
});
