/* DELVE — deterministic simulation core.
 * Pure rules. No DOM, no Date.now, no Math.random. Runs identically in a
 * browser and in node (tools/verify.js drives it headless).
 *
 * Units: "u" of world space. Depth increases downward. x shares its axis with
 * the corridor centre. Time advances only on the fixed 60 Hz tick.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});

  // ---------------------------------------------------------------- config
  var C = {
    STEP_MS: 1000 / 60,

    // stage guarantee: the renderer always shows at least this world box
    VIEW_W: 156,
    VIEW_H: 300,
    PLAYER_SCREEN_Y: 0.305,
    PREVIEW_DIST: 200,

    PLAYER_RADIUS: 10,

    IDLE_SPEED: 25,
    MAX_SPEED: 168,
    ACCEL: 105,
    COAST_DECEL: 50,
    STALL_MS: 210,
    STALL_DECEL: 800,

    LAT_SLOW: 108,
    LAT_FAST: 40,
    LAT_ACC_SLOW: 820,
    LAT_ACC_FAST: 280,
    LAT_CURVE: 0.75,

    DANGER_FRAC: 0.7,

    START_TIME_MS: 25000,
    MAX_TIME_MS: 30000,
    FRAGMENT_MS: 1550,
    POWER_BREAK_MS: 800,
    POWER_MS: 6000,

    SCORE_DEPTH: 0.11,
    SCORE_SPEED_BONUS: 2.3,
    SCORE_FRAGMENT: 20,
    SCORE_BREAK: 45,
    SCORE_GRAZE: 18,

    CORRIDOR_HALF_START: 38,
    CORRIDOR_HALF_DEEP: 26,
    CENTER_LIMIT: 34,

    NEAR_MISS_WINDOW: 20, // one machine width
    COMBO_HOLD_MS: 2600,

    GRADES: [
      { g: 'D', s: 0 },
      { g: 'C', s: 800 },
      { g: 'B', s: 1800 },
      { g: 'A', s: 3400 },
      { g: 'S', s: 5600 },
      { g: 'S+', s: 8400 },
      { g: 'SS', s: 12500 }
    ]
  };
  DELVE.C = C;

  // ------------------------------------------------------------- utilities
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function approach(v, target, maxDelta) {
    var d = target - v;
    if (d > maxDelta) return v + maxDelta;
    if (d < -maxDelta) return v - maxDelta;
    return target;
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  DELVE.clamp = clamp;
  DELVE.lerp = lerp;
  DELVE.smoothstep = smoothstep;

  // mulberry32 — small and fully reproducible from a uint32 state
  function Rng(seed) { this.s = (seed >>> 0) || 1; }
  Rng.prototype.next = function () {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  Rng.prototype.int = function (n) { return Math.min(n - 1, Math.floor(this.next() * n)); };
  Rng.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };

  // Pressure ramp: continuous, already measurable a few seconds into a run.
  // Drives bend sharpness, corridor width and rock density.
  function diff01(depth) { return 1 - Math.exp(-depth / 4200); }
  // Scarcity ramp: slower, and separate on purpose. Fragments thin out over a
  // whole run rather than over its first few seconds, so the clock closes in
  // late instead of strangling the opening.
  function scarce01(depth) { return 1 - Math.exp(-depth / 11000); }

  function insertByDepth(arr, obj) {
    var i = arr.length;
    while (i > 0 && arr[i - 1].depth > obj.depth) i--;
    if (i === arr.length) arr.push(obj);
    else arr.splice(i, 0, obj);
  }

  // ------------------------------------------------------------ the course
  // The corridor is a chain of smoothstep bend segments. Rocks, fragment
  // formations and power items are scheduled along one depth cursor, and every
  // rock group picks its escape gap before it places any mass, so generation
  // cannot produce an unavoidable wall.

  var FORMATIONS = ['line', 'chevron', 'arc', 'zigzag', 'wedge'];

  function Course(game) {
    this.g = game;
    var half = C.CORRIDOR_HALF_START;
    this.segments = [{ d0: -600, d1: 185, x0: 0, x1: 0, w0: half, w1: half }];
    this.genDepth = 185;
    this.lastDir = 1;
    this.spawnDepth = 320;
    this.turn = 'frag';
    this.lastFormation = '';
    this.lastGap = 0;
    this.nextPowerDepth = 600 + game.rng.next() * 380;
  }

  Course.prototype.at = function (depth) {
    var segs = this.segments;
    var lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (depth < segs[mid].d1) hi = mid; else lo = mid + 1;
    }
    var s = segs[lo];
    var t = clamp((depth - s.d0) / (s.d1 - s.d0), 0, 1);
    var e = smoothstep(t);
    return { x: s.x0 + (s.x1 - s.x0) * e, half: s.w0 + (s.w1 - s.w0) * e };
  };
  Course.prototype.centerAt = function (d) { return this.at(d).x; };
  Course.prototype.halfAt = function (d) { return this.at(d).half; };

  Course.prototype.pushSegment = function (len, dx, half) {
    var last = this.segments[this.segments.length - 1];
    var x1 = clamp(last.x1 + dx, -C.CENTER_LIMIT, C.CENTER_LIMIT);
    this.segments.push({
      d0: last.d1, d1: last.d1 + len,
      x0: last.x1, x1: x1,
      w0: last.w1, w1: half
    });
    this.genDepth = last.d1 + len;
  };

  Course.prototype.genSegment = function () {
    var rng = this.g.rng;
    var dd = diff01(this.genDepth);
    var baseHalf = lerp(C.CORRIDOR_HALF_START, C.CORRIDOR_HALF_DEEP, dd);
    var half = clamp(baseHalf + rng.range(-4, 4), 24, 40);

    var wStraight = Math.max(0.04, 0.13 - 0.09 * dd);
    var wGentle = Math.max(0.2, 0.42 - 0.15 * dd);
    var wSharp = 0.29 + 0.1 * dd;
    var wSwitch = 0.16 + 0.14 * dd;
    var pick = rng.next() * (wStraight + wGentle + wSharp + wSwitch);
    var kind = pick < wStraight ? 'straight'
      : pick < wStraight + wGentle ? 'gentle'
        : pick < wStraight + wGentle + wSharp ? 'sharp' : 'switch';

    var last = this.segments[this.segments.length - 1];
    var dir;
    if (last.x1 > C.CENTER_LIMIT * 0.5) dir = -1;
    else if (last.x1 < -C.CENTER_LIMIT * 0.5) dir = 1;
    else dir = rng.next() < 0.66 ? -this.lastDir : this.lastDir;

    if (kind === 'straight') {
      this.pushSegment(rng.range(140, 240), 0, half);
    } else if (kind === 'gentle') {
      var lg = rng.range(230, 360);
      this.pushSegment(lg, dir * (rng.range(0.11, 0.2) * lg / 1.5), half);
      this.lastDir = dir;
    } else if (kind === 'sharp') {
      var ls = rng.range(145, 235);
      this.pushSegment(ls, dir * ((rng.range(0.25, 0.36) + 0.06 * dd) * ls / 1.5), half);
      this.lastDir = dir;
    } else {
      var n = 2 + (rng.next() < 0.35 ? 1 : 0);
      for (var k = 0; k < n; k++) {
        var lk = rng.range(125, 190);
        var sk = rng.range(0.26, 0.37) + 0.08 * dd;
        this.pushSegment(lk, (k % 2 === 0 ? dir : -dir) * (sk * lk / 1.5), half);
      }
      this.lastDir = n % 2 === 0 ? dir : -dir;
    }
  };

  // -- entity helpers ------------------------------------------------------
  Course.prototype.addRock = function (depth, rel, radius) {
    var g = this.g;
    insertByDepth(g.rocks, {
      id: g.nextId++,
      x: this.centerAt(depth) + rel,
      depth: depth,
      active: true,
      visualRadius: radius,
      collisionRadius: radius * 0.9,
      seed: g.rng.next(),
      passed: false,
      shape: g.rng.next()
    });
  };
  Course.prototype.addItem = function (depth, rel, type, extra) {
    this.addItemAbs(depth, this.centerAt(depth) + rel, type, extra);
  };
  Course.prototype.addItemAbs = function (depth, x, type, extra) {
    var g = this.g;
    var it = {
      id: g.nextId++,
      type: type,
      x: x,
      depth: depth,
      active: true,
      visualRadius: type === 'power' ? 13 : 8,
      collisionRadius: type === 'power' ? 13 : 8,
      seed: g.rng.next(),
      formationId: 0,
      formationKind: '',
      formationIndex: 0
    };
    if (extra) { it.formationId = extra.id; it.formationKind = extra.kind; it.formationIndex = extra.index; }
    insertByDepth(g.items, it);
  };

  function minSafeAt(depth) { return lerp(18, 14.5, diff01(depth)); }

  // Lay a formation down as real world positions. The shape is authored in
  // corridor-relative space, then the *absolute* step between neighbours is
  // capped, because that is the lateral ground the machine actually has to
  // cover: a bend sliding under the shape counts against the sweep too.
  Course.prototype.placeFragments = function (depths, rels, kind, margin) {
    var n = depths.length, i, xs = [];
    for (i = 0; i < n; i++) xs.push(this.centerAt(depths[i]) + rels[i]);
    var limit = 0.34;
    for (var pass = 0; pass < 3; pass++) {
      for (i = 1; i < n; i++) {
        var dz = depths[i] - depths[i - 1];
        var maxStep = limit * dz;
        var d = xs[i] - xs[i - 1];
        if (d > maxStep) xs[i] = xs[i - 1] + maxStep;
        else if (d < -maxStep) xs[i] = xs[i - 1] - maxStep;
      }
      for (i = n - 1; i >= 0; i--) {
        var a = this.at(depths[i]);
        var lo = a.x - a.half + margin, hi = a.x + a.half - margin;
        xs[i] = clamp(xs[i], Math.min(lo, hi), Math.max(lo, hi));
      }
    }
    var fid = ++this.g.formationCount;
    for (i = 0; i < n; i++) {
      this.addItemAbs(depths[i], xs[i], 'fragment', { id: fid, kind: kind, index: i });
    }
  };

  // -- rock groups ---------------------------------------------------------
  Course.prototype.rockGroup = function (d) {
    var rng = this.g.rng;
    var dd = diff01(d);
    var minSafe = minSafeAt(d);
    var half = this.halfAt(d);
    var wSingle = 0.32, wPinch = 0.2, wBoulder = 0.18, wCluster = 0.3 + 0.12 * dd;
    var pick = rng.next() * (wSingle + wPinch + wBoulder + wCluster);
    var span = 30;

    if (pick < wSingle) {
      // one rock, sized so at least one side of it stays generously open
      var rad = clamp(rng.range(8, 15) + 5 * dd, 7, half - minSafe - 2);
      var A = half - rad;
      var m = Math.max(0, 2 * minSafe - A);
      var c = rng.sign() * (m + (A - m) * Math.pow(rng.next(), 0.7));
      this.addRock(d, c, rad);
      this.lastGap = c > 0 ? -(half - (A + c) / 2) : (half - (A - c) / 2);
      span = rad;
    } else if (pick < wSingle + wPinch) {
      // pinch: two shoulders with one threadable gap between them
      var gapW = minSafe * 2 + rng.range(2, 10);
      var lim = Math.max(0, half - gapW / 2 - 4);
      var gc = rng.range(-lim, lim);
      var leftW = (gc - gapW / 2) + half;
      var rightW = half - (gc + gapW / 2);
      if (leftW > 12) this.addRock(d, -half + leftW / 2, leftW / 2);
      if (rightW > 12) this.addRock(d, half - rightW / 2, rightW / 2);
      this.lastGap = gc;
      span = 26;
    } else if (pick < wSingle + wPinch + wBoulder) {
      // boulder: closes about half the corridor, forces an early commitment
      var brad = clamp(rng.range(15, 21) + 3 * dd, 12, half - minSafe - 2);
      var side = rng.sign();
      this.addRock(d, side * (half - brad), brad);
      var gapCenter = -side * brad;
      if (rng.next() < 0.45) {
        // a treat for taking the tight line past the boulder
        var td = [d - 38, d, d + 38];
        var tr = [gapCenter + rng.range(-3, 3), gapCenter, gapCenter + rng.range(-3, 3)];
        this.placeFragments(td, tr, 'thread', 9);
      }
      this.lastGap = gapCenter;
      span = brad + 50;
    } else {
      // cluster: a staggered slalom. Consecutive gaps stay inside what a
      // machine that eases off can reach, and outside what full throttle can.
      var n = 3 + rng.int(2 + Math.round(2 * dd));
      var dz = rng.range(50, 68);
      var gap = this.lastGap;
      for (var j = 0; j < n; j++) {
        var dj = d + j * dz;
        var hj = this.halfAt(dj);
        var msj = minSafeAt(dj);
        var room = Math.max(1, hj - msj);
        gap = clamp(gap + rng.range(-0.34, 0.34) * dz, -room, room);
        var leftFree = gap - msj + hj;
        var rightFree = hj - gap - msj;
        var useLeft = leftFree > rightFree;
        var fw = useLeft ? leftFree : rightFree;
        if (fw > 13) {
          var rr = clamp(fw / 2, 7, 18);
          this.addRock(dj, useLeft ? -hj + rr : hj - rr, rr);
        }
        var ow = useLeft ? rightFree : leftFree;
        if (rng.next() < 0.35 && ow > 15) {
          var rr2 = clamp(ow / 2, 7, 13);
          this.addRock(dj, useLeft ? hj - rr2 : -hj + rr2, rr2);
        }
      }
      this.lastGap = gap;
      span = (n - 1) * dz + 40;
    }
    return span;
  };

  // -- fragment formations -------------------------------------------------
  Course.prototype.formationOffsets = function (kind, n, a) {
    var o = [], i;
    if (kind === 'line') {
      for (i = 0; i < n; i++) o.push(0);
    } else if (kind === 'chevron') {
      var mid = Math.floor((n - 1) / 2);
      for (i = 0; i < n; i++) o.push(-a * (i <= mid ? i : 2 * mid - i));
    } else if (kind === 'arc') {
      for (i = 0; i < n; i++) o.push(a * 1.3 * Math.sin((Math.PI * i) / (n - 1)));
    } else if (kind === 'zigzag') {
      for (i = 0; i < n; i++) o.push((i % 2 === 0 ? -1 : 1) * a * 0.7);
    } else { // wedge — a leaning run that walks across the corridor
      for (i = 0; i < n; i++) o.push(a * (i - (n - 1) / 2) * 0.85);
    }
    return o;
  };

  Course.prototype.formation = function (d) {
    var rng = this.g.rng;
    var sc = scarce01(d);
    var n = 3 + rng.int(sc > 0.55 ? 2 : 4);
    var kind = FORMATIONS[rng.int(FORMATIONS.length)];
    if (kind === this.lastFormation) {
      kind = FORMATIONS[(FORMATIONS.indexOf(kind) + 1 + rng.int(FORMATIONS.length - 1)) % FORMATIONS.length];
    }
    this.lastFormation = kind;

    var dz = rng.range(38, 54);
    var a = rng.range(8, 14);
    var offs = this.formationOffsets(kind, n, a);

    // sweepable, literally: no lateral step between neighbours may exceed what
    // a machine already descending flows through, so the shape is taken with
    // one committed steering movement rather than a sideways dart.
    var maxStep = 0, i;
    for (i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(offs[i] - offs[i - 1]));
    var limit = 0.3 * dz;
    if (maxStep > limit) {
      var k = limit / maxStep;
      for (i = 0; i < n; i++) offs[i] *= k;
    }

    var maxOff = 0;
    for (i = 0; i < n; i++) maxOff = Math.max(maxOff, Math.abs(offs[i]));

    var minHalf = 99;
    for (i = 0; i < n; i++) minHalf = Math.min(minHalf, this.halfAt(d + i * dz));
    // Formations lean off the corridor's easy middle: sweeping one is a
    // decision to leave the line you were already driving.
    var room = Math.max(0, minHalf - maxOff - 9);
    var base = rng.sign() * room * (0.5 + 0.5 * Math.pow(rng.next(), 0.6));

    var depths = [], rels = [];
    for (i = 0; i < n; i++) { depths.push(d + i * dz); rels.push(base + offs[i]); }
    this.placeFragments(depths, rels, kind, 9);
    return (n - 1) * dz;
  };

  Course.prototype.spawnNext = function () {
    var rng = this.g.rng;
    var d = this.spawnDepth;
    var dd = diff01(d);
    this.g.spawnIndex++;

    if (d >= this.nextPowerDepth) {
      // the first one sits on the corridor's own line: a player who simply
      // holds the accelerator meets it well inside the first minute
      var half = this.halfAt(d);
      var rel = this.g.powerCount === 0 ? 0 : rng.range(-(half - 18), half - 18);
      this.addItem(d, rel, 'power', null);
      this.g.powerCount++;
      this.nextPowerDepth = d + rng.range(2800, 5200);
      this.spawnDepth = d + rng.range(150, 240);
      return;
    }

    if (this.turn === 'rock') {
      var span = this.rockGroup(d);
      this.spawnDepth = d + span + rng.range(150, 280) * (1 - 0.35 * dd);
      this.turn = rng.next() < 0.26 ? 'rock' : 'frag';
    } else {
      var fspan = this.formation(d);
      this.spawnDepth = d + fspan + rng.range(160, 280) + 780 * scarce01(d);
      this.turn = 'rock';
    }
  };

  Course.prototype.ensure = function (depth) {
    var horizon = depth + C.PREVIEW_DIST + 260;
    var guard = 0;
    while (this.genDepth < horizon + 500 && guard++ < 400) this.genSegment();
    guard = 0;
    while (this.spawnDepth < horizon && guard++ < 200) this.spawnNext();
  };

  // ------------------------------------------------------------------ game
  function Game(seed) { this.reset(seed === undefined ? 1 : seed); }

  Game.prototype.reset = function (seed) {
    this.seed = (seed >>> 0) || 1;
    this.rng = new Rng(this.seed);
    this.phase = 'ready';
    this.tick = 0;
    this.acc = 0;
    this.timeMs = 0;
    this.remainingMs = C.START_TIME_MS;
    this.spawnIndex = 0;
    this.formationCount = 0;
    this.powerCount = 0;
    this.nextId = 1;

    this.rocks = [];
    this.items = [];
    this.rockStart = 0;
    this.itemStart = 0;
    this.events = [];
    this.seq = 0;
    this.fx = [];

    this.input = { accel: false, left: false, right: false, steer: 0 };

    this.x = 0;
    this.depth = 0;
    this.vx = 0;
    this.speed = C.IDLE_SPEED;
    this.stallMs = 0;
    this.invincibleUntilMs = -1;

    this.score = 0;
    this.hits = 0;
    this.wallContacts = 0;
    this.fragmentsCollected = 0;
    this.rocksBroken = 0;
    this.rank = null;

    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.closestShave = Infinity;
    this.throttleRun = 0;
    this.bestThrottle = 0;
    this.wallCooldown = 0;
    this.formationChain = 0;
    this.formationChainId = -1;

    this.course = new Course(this);
    this.course.ensure(0);
    this.x = this.course.centerAt(0);
    return this;
  };

  Game.prototype.setInput = function (inp) {
    this.input.accel = !!inp.accel;
    this.input.left = !!inp.left;
    this.input.right = !!inp.right;
    var s = inp.steer;
    if (typeof s !== 'number' || s !== s) s = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    this.input.steer = clamp(s, -1, 1);
  };

  Game.prototype.emit = function (kind, data) {
    this.seq++;
    this.events.push({ seq: this.seq, kind: kind, tick: this.tick });
    if (this.events.length > 140) this.events.splice(0, this.events.length - 140);
    this.signal(kind, data);
  };
  // view-only channel: never read by any rule
  Game.prototype.signal = function (kind, data) {
    if (this.fx.length < 80) this.fx.push({ kind: kind, data: data || null });
  };

  Game.prototype.gradeFor = function (score) {
    var g = C.GRADES[0].g;
    for (var i = 0; i < C.GRADES.length; i++) if (score >= C.GRADES[i].s) g = C.GRADES[i].g;
    return g;
  };

  Game.prototype.speedFrac = function () {
    return clamp((this.speed - C.IDLE_SPEED) / (C.MAX_SPEED - C.IDLE_SPEED), 0, 1);
  };

  Game.prototype.stall = function () {
    this.stallMs = C.STALL_MS;
    this.combo = 0;
    this.comboTimer = 0;
    this.throttleRun = 0;
  };

  Game.prototype.step = function () {
    var dt = 1 / 60;
    var stepMs = C.STEP_MS;
    this.tick++;
    this.timeMs = this.tick * stepMs;

    var inp = this.input;

    // ---- forward speed: momentum is structural, the crawl is the floor
    if (this.stallMs > 0) {
      this.stallMs -= stepMs;
      this.speed = Math.max(C.IDLE_SPEED, this.speed - C.STALL_DECEL * dt);
    } else if (inp.accel) {
      this.speed = Math.min(C.MAX_SPEED, this.speed + C.ACCEL * dt);
    } else {
      this.speed = Math.max(C.IDLE_SPEED, this.speed - C.COAST_DECEL * dt);
    }

    if (inp.accel && this.stallMs <= 0) {
      this.throttleRun += stepMs;
      if (this.throttleRun > this.bestThrottle) this.bestThrottle = this.throttleRun;
    } else if (!inp.accel) {
      this.throttleRun = 0;
    }

    // ---- lateral authority falls away with speed
    var f = this.speedFrac();
    var curve = Math.pow(f, C.LAT_CURVE);
    var latMax = C.LAT_SLOW + (C.LAT_FAST - C.LAT_SLOW) * curve;
    var latAcc = C.LAT_ACC_SLOW + (C.LAT_ACC_FAST - C.LAT_ACC_SLOW) * curve;
    if (inp.steer !== 0) this.vx = approach(this.vx, inp.steer * latMax, latAcc * dt);
    else this.vx = approach(this.vx, 0, latAcc * 1.15 * dt);

    var prevDepth = this.depth;
    var prevX = this.x;
    this.x += this.vx * dt;
    var ds = this.speed * dt;
    this.depth += ds;

    this.course.ensure(this.depth);

    // ---- score moves continuously with depth, weighted by committed speed
    this.score += ds * C.SCORE_DEPTH * (1 + C.SCORE_SPEED_BONUS * Math.pow(f, 1.4));

    // ---- walls: real, permanent, and exactly as costly as a rock
    var here = this.course.at(this.depth);
    var pr = C.PLAYER_RADIUS;
    if (this.wallCooldown > 0) this.wallCooldown -= stepMs;
    var leftX = here.x - here.half, rightX = here.x + here.half;
    if (this.x - pr < leftX) {
      this.x = leftX + pr;
      if (this.vx < 0) this.vx = -this.vx * 0.18;
      if (this.wallCooldown <= 0) {
        this.wallCooldown = 320; this.wallContacts++; this.stall();
        this.emit('wall_contact', { x: this.x, depth: this.depth, side: -1 });
      }
    } else if (this.x + pr > rightX) {
      this.x = rightX - pr;
      if (this.vx > 0) this.vx = -this.vx * 0.18;
      if (this.wallCooldown <= 0) {
        this.wallCooldown = 320; this.wallContacts++; this.stall();
        this.emit('wall_contact', { x: this.x, depth: this.depth, side: 1 });
      }
    }

    var powered = this.timeMs < this.invincibleUntilMs;
    var i, o, dx, dz, rr;

    // ---- rocks
    while (this.rockStart < this.rocks.length && this.rocks[this.rockStart].depth < this.depth - 300) this.rockStart++;
    for (i = this.rockStart; i < this.rocks.length; i++) {
      o = this.rocks[i];
      if (o.depth > this.depth + 60) break;
      if (!o.active) continue;
      dx = this.x - o.x;
      dz = this.depth - o.depth;
      rr = pr + o.collisionRadius;
      if (dx * dx + dz * dz < rr * rr) {
        o.active = false;
        this.rocksBroken++;
        if (powered) {
          this.remainingMs = Math.min(C.MAX_TIME_MS, this.remainingMs + C.POWER_BREAK_MS);
          this.score += C.SCORE_BREAK;
          this.emit('rock_broken', { x: o.x, depth: o.depth, r: o.visualRadius, powered: true, dx: dx });
        } else {
          this.hits++;
          this.stall();
          this.emit('rock_hit', { x: o.x, depth: o.depth, r: o.visualRadius, dx: dx });
          this.emit('rock_broken', { x: o.x, depth: o.depth, r: o.visualRadius, powered: false, dx: dx });
        }
        continue;
      }
      // near miss, resolved at the instant of passing, edge to edge
      if (!o.passed && this.depth >= o.depth) {
        o.passed = true;
        if (prevDepth < o.depth) {
          var t = ds > 1e-6 ? (o.depth - prevDepth) / ds : 0;
          var px = prevX + (this.x - prevX) * t;
          var gap = Math.abs(px - o.x) - (pr + o.collisionRadius);
          if (gap >= 0 && gap < C.NEAR_MISS_WINDOW) {
            this.combo++;
            this.comboTimer = C.COMBO_HOLD_MS;
            if (this.combo > this.maxCombo) this.maxCombo = this.combo;
            if (gap < this.closestShave) this.closestShave = gap;
            this.score += C.SCORE_GRAZE * Math.min(this.combo, 8);
            this.emit('near_miss', {
              x: o.x, depth: o.depth, r: o.visualRadius,
              gap: gap, combo: this.combo, side: px > o.x ? 1 : -1
            });
          }
        }
      }
    }

    // ---- items
    while (this.itemStart < this.items.length && this.items[this.itemStart].depth < this.depth - 300) this.itemStart++;
    for (i = this.itemStart; i < this.items.length; i++) {
      o = this.items[i];
      if (o.depth > this.depth + 60) break;
      if (!o.active) continue;
      dx = this.x - o.x;
      dz = this.depth - o.depth;
      rr = pr + o.collisionRadius;
      if (dx * dx + dz * dz < rr * rr) {
        o.active = false;
        if (o.type === 'fragment') {
          this.fragmentsCollected++;
          this.remainingMs = Math.min(C.MAX_TIME_MS, this.remainingMs + C.FRAGMENT_MS);
          this.score += C.SCORE_FRAGMENT;
          if (o.formationId === this.formationChainId) this.formationChain++;
          else { this.formationChainId = o.formationId; this.formationChain = 1; }
          this.emit('fragment', {
            x: o.x, depth: o.depth, chain: this.formationChain,
            kind: o.formationKind, index: o.formationIndex
          });
        } else {
          this.invincibleUntilMs = this.timeMs + C.POWER_MS;
          powered = true;
          this.emit('power', { x: o.x, depth: o.depth });
        }
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= stepMs;
      if (this.comboTimer <= 0) { this.combo = 0; this.comboTimer = 0; }
    }

    // ---- the clock is the antagonist
    this.remainingMs -= stepMs;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'gameover';
      this.rank = this.gradeFor(Math.floor(this.score));
      this.signal('run_end', { score: Math.floor(this.score) });
    }
  };

  Game.prototype.advance = function (ms) {
    if (this.phase === 'ready') {
      if (!this.input.accel) { this.acc = 0; return; }
      this.phase = 'playing';
      this.acc = 0;
    }
    if (this.phase !== 'playing') { this.acc = 0; return; }
    // No ceiling here: advance(ms) means exactly that many milliseconds of
    // simulated time, so a replay scrub lands on the same state the player saw.
    // The real-time loop is the one that clamps its frame delta.
    this.acc += ms;
    while (this.acc >= C.STEP_MS - 1e-9) {
      this.acc -= C.STEP_MS;
      this.step();
      if (this.phase !== 'playing') { this.acc = 0; break; }
    }
  };

  // --------------------------------------------------------------- queries
  Game.prototype.computeSafeHalf = function () {
    var best = 999;
    for (var k = 0; k <= 25; k++) {
      var d = this.depth + (C.PREVIEW_DIST * k) / 25;
      var a = this.course.at(d);
      var lo = a.x - a.half, hi = a.x + a.half;
      var blocks = [];
      for (var i = this.rockStart; i < this.rocks.length; i++) {
        var o = this.rocks[i];
        if (o.depth > d + 40) break;
        if (!o.active) continue;
        var dz = d - o.depth;
        if (Math.abs(dz) >= o.collisionRadius) continue;
        var h = Math.sqrt(o.collisionRadius * o.collisionRadius - dz * dz);
        blocks.push([o.x - h, o.x + h]);
      }
      blocks.sort(function (p, q) { return p[0] - q[0]; });
      var cur = lo, widest = 0;
      for (var b = 0; b < blocks.length; b++) {
        if (blocks[b][0] > cur) widest = Math.max(widest, blocks[b][0] - cur);
        if (blocks[b][1] > cur) cur = blocks[b][1];
      }
      if (hi - cur > widest) widest = hi - cur;
      if (widest < best) best = widest;
    }
    return Math.max(0, best / 2);
  };

  Game.prototype.wallSamples = function (n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var d = this.depth + (C.PREVIEW_DIST * i) / (n - 1);
      var a = this.course.at(d);
      out.push({ depth: r2(d), leftX: r2(a.x - a.half), rightX: r2(a.x + a.half) });
    }
    return out;
  };

  Game.prototype.snapshot = function () {
    var lo = this.depth - 40, hi = this.depth + C.PREVIEW_DIST;
    var rocks = [], items = [], i, o;
    for (i = this.rockStart; i < this.rocks.length; i++) {
      o = this.rocks[i];
      if (o.depth > hi) break;
      if (o.depth < lo) continue;
      rocks.push({
        id: o.id, position: { x: r2(o.x), depth: r2(o.depth) }, active: o.active,
        visualRadius: r2(o.visualRadius), collisionRadius: r2(o.collisionRadius)
      });
    }
    for (i = this.itemStart; i < this.items.length; i++) {
      o = this.items[i];
      if (o.depth > hi) break;
      if (o.depth < lo) continue;
      var e = {
        id: o.id, type: o.type, position: { x: r2(o.x), depth: r2(o.depth) }, active: o.active,
        visualRadius: r2(o.visualRadius), collisionRadius: r2(o.collisionRadius)
      };
      if (o.type === 'fragment') {
        e.formationId = o.formationId;
        e.formationKind = o.formationKind;
        e.formationIndex = o.formationIndex;
      }
      items.push(e);
    }
    rocks.sort(function (a, b) { return a.id - b.id; });
    items.sort(function (a, b) { return a.id - b.id; });

    var here = this.course.at(this.depth);
    var ev = [];
    for (i = Math.max(0, this.events.length - 100); i < this.events.length; i++) ev.push(this.events[i]);

    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: r2(this.timeMs),
      timeMs: r2(this.timeMs),
      remainingMs: r2(this.remainingMs),
      seed: this.seed,
      rngState: this.rng.s >>> 0,
      spawnIndex: this.spawnIndex,
      input: {
        accel: this.input.accel, left: this.input.left,
        right: this.input.right, steer: r3(this.input.steer)
      },
      difficulty: r3(1 + 3 * diff01(this.depth)),
      score: Math.floor(this.score),
      depth: r2(this.depth),

      x: r2(this.x),
      playerRadius: C.PLAYER_RADIUS,
      speed: r2(this.speed),
      maxSpeed: C.MAX_SPEED,

      hits: this.hits,
      wallContacts: this.wallContacts,
      fragmentsCollected: this.fragmentsCollected,
      rocksBroken: this.rocksBroken,
      invincibleUntilMs: r2(this.invincibleUntilMs),
      rank: this.rank,

      courseCenterX: r2(here.x),
      corridorHalfWidth: r2(here.half),
      walls: this.wallSamples(21),
      safeHalfWidth: r2(this.computeSafeHalf()),
      previewMs: r2((C.PREVIEW_DIST / C.MAX_SPEED) * 1000),

      rocks: rocks,
      items: items,
      events: ev,
      lastEvent: ev.length ? ev[ev.length - 1] : null
    };
  };

  DELVE.Game = Game;
  DELVE.Rng = Rng;
  DELVE.diff01 = diff01;
  DELVE.minSafeAt = minSafeAt;
})(typeof window !== 'undefined' ? window : globalThis);
