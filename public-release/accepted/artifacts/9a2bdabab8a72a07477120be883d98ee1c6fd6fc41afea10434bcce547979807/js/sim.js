(function () {
  var D = window.DELVE;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Snapshot floats are rounded to a stable 3-decimal precision.
  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }

  var STEP_MS = 1000 / 60;
  var WORLD_W = 540, WORLD_H = 1000, VIEW_BACK = 220, HORIZON = 900, PRUNE_BEHIND = 420;
  var CS = 8;

  var CRAWL = 90, MAX_SPEED = 640, ACCEL = 820, DECEL = 520, STALL_TICKS = 15, STALL_LERP = 0.25;
  var LAT_CRAWL = 340, LAT_MAX = 150, LAT_ACCEL = 1500;
  var PLAYER_R = 26;

  var START_TIME = 34000;
  var FRAG_TIME = 850;
  var POWER_DURATION = 7000;
  var ROCK_TIME = 600;
  var NEAR_MISS_GAP = 52;
  var NMS_WINDOW = 1800;

  var REF_DIFF = 40000, DIFF_BASE = 0.18;

  var FRAG_COLL = 12, FRAG_VIS = 16, POWER_COLL = 18, POWER_VIS = 24;

  function difficulty(depth) { return DIFF_BASE + (1 - DIFF_BASE) * clamp(depth / REF_DIFF, 0, 1); }
  function latCap(v) { var f = (v - CRAWL) / (MAX_SPEED - CRAWL); return lerp(LAT_CRAWL, LAT_MAX, f); }

  var RANKS = [
    { s: 0, n: 'Dirt' },
    { s: 20000, n: 'Gravel' },
    { s: 50000, n: 'Shale' },
    { s: 90000, n: 'Limestone' },
    { s: 140000, n: 'Granite' },
    { s: 200000, n: 'Obsidian' },
    { s: 280000, n: 'Bedrock' }
  ];
  function rankFor(score) { var r = RANKS[0]; for (var i = 0; i < RANKS.length; i++) { if (score >= RANKS[i].s) r = RANKS[i]; } return r.n; }

  function Corridor(rng) {
    this.rng = rng;
    this.samples = [{ depth: 0, cx: WORLD_W / 2, hw: 172 }];
    this.lastDepth = 0;
    this.cx = WORLD_W / 2;
    this.hw = 172;
    this.trend = 0;
  }
  Corridor.prototype.ensure = function (depth) {
    while (this.lastDepth + CS < depth) this.step();
  };
Corridor.prototype.step = function () {
    var d = this.lastDepth + CS;
    var diff = difficulty(d);
    var hwMin = lerp(150, 136, diff), hwMax = lerp(178, 170, diff);
    this.hw = clamp(this.hw + (this.rng.next() * 2 - 1) * 2.4, hwMin, hwMax);
    var gentle = 0.25 + 0.75 * clamp(d / 2000, 0, 1);
    var baseStep = lerp(3.4, 6.6, diff) * gentle;
    var maxStep = lerp(5.2, 9.2, diff) * gentle;
    this.trend = clamp(this.trend * 0.9 + (this.rng.next() * 2 - 1) * 0.42, -1, 1);
    var delta = this.trend * baseStep;
    if (this.rng.next() < 0.03) delta += -Math.sign(this.trend || 1) * baseStep * 1.6;
    delta = clamp(delta, -maxStep, maxStep);
    this.cx += delta;
    var cmin = this.hw + 10, cmax = WORLD_W - this.hw - 10;
    if (this.cx < cmin) this.cx += (cmin - this.cx) * 0.85;
    if (this.cx > cmax) this.cx -= (this.cx - cmax) * 0.85;
    this.cx = clamp(this.cx, cmin, cmax);
    this.samples.push({ depth: d, cx: this.cx, hw: this.hw });
    this.lastDepth = d;
  };
  Corridor.prototype.at = function (depth) {
    var s = this.samples;
    if (depth <= s[0].depth) { var p0 = s[0]; return { cx: p0.cx, hw: p0.hw }; }
    var last = s[s.length - 1];
    if (depth >= last.depth) return { cx: last.cx, hw: last.hw };
    var lo = 0, hi = s.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (s[mid].depth <= depth) lo = mid; else hi = mid - 1; }
    var a = s[lo], b = s[lo + 1];
    var span = (b.depth - a.depth) || 1;
    var t = (depth - a.depth) / span;
    return { cx: lerp(a.cx, b.cx, t), hw: lerp(a.hw, b.hw, t) };
  };

  function Sim(seed) { this.reset(seed | 0); }

  Sim.prototype.reset = function (seed) {
    this.seed = seed | 0;
    this.rng = D.rng.makeRng(this.seed);
    this.corr = new Corridor(this.rng);
    this.corr.ensure(HORIZON);
    this.powerSchedule = [9000 + this.rng.next() * 6000];
    this.formSeq = 0;
    this.nextSlotDepth = 700;
    this.spawnIndex = 0;

    this.x = WORLD_W / 2; this.depth = 0; this.speed = CRAWL; this.latVel = 0; this.stallTicks = 0;
    this.phase = 'ready'; this.tick = 0; this.timeMs = 0; this.elapsedMs = 0;
    this.remainingMs = START_TIME;
    this.difficulty = difficulty(0);
    this.score = 0;

    this.hits = 0; this.wallContacts = 0; this.fragmentsCollected = 0; this.rocksBroken = 0;
    this.nearMisses = 0;
    this.invincibleUntilMs = 0;
    this.rank = null; this.signature = null;
    this.nearStreak = 0; this.nearStreakT = 0; this.closestShave = Infinity;
    this.longThrottleCur = 0; this.longThrottleMs = 0;

    this.rocks = []; this.items = [];
    this.idSeq = 1;
    this.events = []; this.lastEvent = null; this.seq = 0;
    if (this.input) { this.input.accel = false; this.input.steer = 0; }
    else this.input = { accel: false, steer: 0 };
    this.accMs = 0;

    this.ensureSlots(HORIZON);
  };

  Sim.prototype.advance = function (ms) {
    if (this.phase === 'gameover') return;
    if (!(ms > 0) || ms > 1e9) return;
    if (this.phase === 'ready' && !this.input.accel) return;
    this.accMs += ms;
    var g = 0;
    while (this.accMs >= STEP_MS && g < 200000) {
      this.accMs -= STEP_MS;
      this.step();
      g++;
      if (this.phase === 'gameover') break;
    }
  };

  Sim.prototype.step = function () {
    if (this.phase === 'ready') {
      if (this.input.accel) this.phase = 'playing';
      else return;
    }
    this.tick++;
    this.timeMs += STEP_MS;
    this.elapsedMs = this.timeMs;
    var dt = STEP_MS / 1000;

    if (this.stallTicks > 0) {
      this.stallTicks--;
      this.speed = lerp(this.speed, CRAWL, STALL_LERP);
    } else if (this.input.accel) {
      this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
    } else {
      this.speed = Math.max(CRAWL, this.speed - DECEL * dt);
    }

    var cap = latCap(this.speed);
    var target = clamp(this.input.steer, -1, 1) * cap;
    var dv = clamp(target - this.latVel, -LAT_ACCEL * dt, LAT_ACCEL * dt);
    this.latVel += dv;
    this.x += this.latVel * dt;

    this.depth += this.speed * dt;
    this.difficulty = difficulty(this.depth);

    var g = this.corr.at(this.depth);
    var lx = g.cx - g.hw + PLAYER_R;
    var rx = g.cx + g.hw - PLAYER_R;
    if (this.x < lx || this.x > rx) {
      this.x = clamp(this.x, lx, rx);
      this.latVel = 0;
      this.startStall();
      this.wallContacts++;
      this.fire('wall_contact');
    }

    var inv = this.timeMs < this.invincibleUntilMs;
    for (var i = 0; i < this.rocks.length; i++) {
      var rock = this.rocks[i];
      if (!rock.active) continue;
      var dx = this.x - rock.x, dy = this.depth - rock.depth;
      var rr = rock.collisionRadius + PLAYER_R;
      var d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        rock.active = false;
        if (inv) {
          this.rocksBroken++;
          this.remainingMs += ROCK_TIME;
          this.fire('rock_broken');
        } else {
          this.hits++;
          this.startStall();
          this.fire('rock_hit');
        }
        continue;
      }
      var gap = Math.sqrt(d2) - rr;
      if (gap < rock.minGap) rock.minGap = gap;
      if (!rock.nearFired && rock.depth < this.depth - rock.visualRadius && rock.minGap < NEAR_MISS_GAP) {
        rock.nearFired = true;
        this.nearStreak++;
        this.nearStreakT = 0;
        this.nearMisses++;
        if (rock.minGap < this.closestShave) this.closestShave = rock.minGap;
        this.fire('near_miss');
      }
    }

    for (var j = 0; j < this.items.length; j++) {
      var it = this.items[j];
      if (!it.active) continue;
      var idx = this.x - it.x, idy = this.depth - it.depth;
      var irr = it.collisionRadius + PLAYER_R;
      if (idx * idx + idy * idy <= irr * irr) {
        it.active = false;
        if (it.type === 'fragment') {
          this.fragmentsCollected++;
          this.remainingMs += FRAG_TIME;
          this.fire('fragment');
        } else {
          this.invincibleUntilMs = this.timeMs + POWER_DURATION;
          this.fire('power');
        }
      }
    }

    if (this.nearStreak > 0) {
      this.nearStreakT += STEP_MS;
      if (this.nearStreakT > NMS_WINDOW) { this.nearStreak = 0; this.nearStreakT = 0; }
    }

    if (this.speed > MAX_SPEED * 0.94) {
      this.longThrottleCur += STEP_MS;
      if (this.longThrottleCur > this.longThrottleMs) this.longThrottleMs = this.longThrottleCur;
    } else {
      this.longThrottleCur = 0;
    }

    this.score = Math.floor(this.depth) + this.fragmentsCollected * 10 + this.rocksBroken * 15;

    this.remainingMs -= STEP_MS;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.endRun();
      return;
    }

    this.corr.ensure(this.depth + HORIZON);
    this.ensureSlots(this.depth + HORIZON);

    var behind = this.depth - PRUNE_BEHIND;
    if (this.rocks.length && this.rocks[0].depth < behind) this.rocks = this.rocks.filter(function (r) { return r.depth >= behind; });
    if (this.items.length && this.items[0].depth < behind) this.items = this.items.filter(function (i) { return i.depth >= behind; });
  };

  Sim.prototype.startStall = function () { this.stallTicks = STALL_TICKS; };

  Sim.prototype.fire = function (kind) {
    this.seq++;
    var ev = { seq: this.seq, kind: kind, tick: this.tick };
    this.events.push(ev);
    if (this.events.length > 100) this.events.shift();
    this.lastEvent = ev;
  };

  Sim.prototype.endRun = function () {
    this.phase = 'gameover';
    this.rank = rankFor(Math.round(this.score));
    var sig = [];
    if (this.closestShave < NEAR_MISS_GAP) sig.push({ label: 'CLOSEST SHAVE', value: Math.max(1, Math.round(this.closestShave)) + ' cm' });
    if (this.longThrottleMs >= 4000) sig.push({ label: 'FULL-THROTTLE STREAK', value: (this.longThrottleMs / 1000).toFixed(1) + ' s' });
    sig.push({ label: 'DEEPEST DIG', value: Math.round(this.depth / 100) + ' m' });
    this.signature = sig[0];
  };

  Sim.prototype.geom = function (depth) { return this.corr.at(depth); };

  Sim.prototype.ensureSlots = function (limit) {
    while (this.nextSlotDepth < limit) this.genSlot();
  };

  Sim.prototype.genSlot = function () {
    var d0 = this.nextSlotDepth;
    var diff = difficulty(d0);
    var type = null, powerAt = null;
    var P = this.powerSchedule[0];
    if (P !== undefined && P - d0 < 400) {
      this.powerSchedule.shift();
      powerAt = Math.max(P, d0);
      type = 'power';
    } else {
      type = this.rollType(d0, diff);
    }
    var bandEnd;
    switch (type) {
      case 'power': bandEnd = this.spawnPower(powerAt, diff); break;
      case 'single': bandEnd = this.spawnSingle(d0, diff); break;
      case 'pair': bandEnd = this.spawnPair(d0, diff); break;
      case 'wide': bandEnd = this.spawnWide(d0, diff); break;
      case 'cluster': bandEnd = this.spawnCluster(d0, diff); break;
      case 'form': bandEnd = this.spawnForm(d0, diff); break;
      default: bandEnd = d0 + 40;
    }
    this.spawnIndex++;
    var gap = lerp(260, 160, diff) * (0.8 + this.rng.next() * 0.5);
    this.nextSlotDepth = bandEnd + gap;
  };

  Sim.prototype.rollType = function (d0, diff) {
    var gentle = clamp(1 - (d0 - 1200) / 2600, 0, 1);
    var w;
    if (gentle > 0) {
      w = { single: 0.15, pair: 0.08, wide: 0.02, cluster: 0.02, form: 0.46, empty: 0.27 };
    } else {
      w = { single: 0.24, pair: 0.17, wide: 0.11, cluster: 0.13, form: 0.24, empty: 0.11 };
    }
    var keys = ['single', 'pair', 'wide', 'cluster', 'form', 'empty'];
    var total = 0, k;
    for (k = 0; k < keys.length; k++) total += w[keys[k]];
    var r = this.rng.next() * total;
    for (k = 0; k < keys.length; k++) { r -= w[keys[k]]; if (r <= 0) return keys[k]; }
    return 'form';
  };

  Sim.prototype.addRock = function (depth, x, r) {
    this.rocks.push({ id: this.idSeq++, active: true, x: x, depth: depth, visualRadius: r, collisionRadius: r * 0.92, minGap: Infinity, nearFired: false });
  };
  Sim.prototype.addItem = function (type, depth, x, cr, vr, formId, kind, idx) {
    this.items.push({ id: this.idSeq++, type: type, active: true, x: x, depth: depth, visualRadius: vr, collisionRadius: cr, formationId: formId, formationKind: kind, formationIndex: idx });
  };

Sim.prototype.spawnPower = function (P, diff) {
    this.powerSchedule.push(P + 16000 + this.rng.next() * 14000);
    // Find a low-curvature stretch near P so a full-throttle driver on the
    // natural line actually meets it.
    var best = P, bestCurv = Infinity;
    for (var d = P - 500; d <= P + 500; d += 40) {
      var a = this.corr.at(d), b = this.corr.at(d + 80);
      var curv = Math.abs(b.cx - a.cx);
      if (curv < bestCurv) { bestCurv = curv; best = d; }
    }
    var g = this.corr.at(best);
    this.addItem('power', best, g.cx, POWER_COLL, POWER_VIS, null, null, null);
    var formId = this.formSeq++;
    for (var i = 0; i < 3; i++) {
      var dd = best + 26 + i * 34;
      var gg = this.corr.at(dd);
      var off = Math.sin((i + 1) / 4 * Math.PI) * 34;
      var x = clamp(gg.cx + off, gg.cx - gg.hw + FRAG_COLL + 10, gg.cx + gg.hw - FRAG_COLL - 10);
      this.addItem('fragment', dd, x, FRAG_COLL, FRAG_VIS, formId, 'crown', i);
    }
    return best + 70;
  };

  Sim.prototype.spawnSingle = function (d0, diff) {
    var r = lerp(16, 42, diff) * this.rng.range(0.8, 1.25);
    var dd = d0 + this.rng.next() * 40;
    var g = this.corr.at(dd);
    var lo = g.cx - g.hw + r + 8, hi = g.cx + g.hw - r - 8;
    var x;
    if (lo < hi) {
      var side = this.rng.next() * 2 - 1;
      var off = side * 0.7 * (g.hw - r - 10) * this.rng.next();
      x = clamp(g.cx + off, lo, hi);
    } else {
      x = (lo + hi) / 2;
    }
    this.addRock(dd, x, r);
    return dd + 44;
  };

  Sim.prototype.spawnPair = function (d0, diff) {
    var r1 = lerp(18, 32, diff), r2 = lerp(18, 32, diff);
    var dd = d0 + this.rng.next() * 30;
    var g = this.corr.at(dd);
    var G = lerp(78, 60, diff) + this.rng.next() * 34;
    var mid = g.cx + (this.rng.next() * 2 - 1) * g.hw * 0.35;
    var x1 = mid - r1 - G / 2, x2 = mid + r2 + G / 2;
    x1 = clamp(x1, g.cx - g.hw + r1 + 8, g.cx + g.hw - r1 - 8);
    x2 = clamp(x2, g.cx - g.hw + r2 + 8, g.cx + g.hw - r2 - 8);
    this.addRock(dd, x1, r1);
    this.addRock(dd + 16, x2, r2);
    return dd + 46;
  };

  Sim.prototype.spawnWide = function (d0, diff) {
    var r = lerp(34, 54, diff) * this.rng.range(0.9, 1.1);
    var dd = d0 + this.rng.next() * 30;
    var g = this.corr.at(dd);
    var lo = g.cx - g.hw + r + 8, hi = g.cx + g.hw - r - 8;
    if (lo >= hi) { this.addRock(dd, g.cx, Math.min(r, g.hw - 20)); return dd + 50; }
    var side = this.rng.next() * 2 - 1;
    var x = clamp(g.cx + side * (g.hw - r - 8) * 0.85, lo, hi);
    this.addRock(dd, x, r);
    return dd + 52;
  };

  Sim.prototype.spawnCluster = function (d0, diff) {
    var count = 3 + (this.rng.next() < 0.5 ? 1 : 0);
    var band = d0 + 20;
    for (var i = 0; i < count; i++) {
      var dd = d0 + i * 42 + this.rng.next() * 12;
      var g = this.corr.at(dd);
      var r = lerp(15, 22, diff);
      var side = (i % 2 === 0) ? 1 : -1;
      var off = side * g.hw * 0.4;
      var x = clamp(g.cx + off, g.cx - g.hw + r + 8, g.cx + g.hw - r - 8);
      this.addRock(dd, x, r);
      band = dd + 40;
    }
    return band;
  };

  Sim.prototype.spawnForm = function (d0, diff) {
    var kinds = ['line', 'chevron', 'triangle', 'arc'];
    var kind = this.rng.pick(kinds);
    var count = 3 + Math.floor(this.rng.next() * 3);
    var spacing = lerp(78, 62, diff) * this.rng.range(0.9, 1.12);
    var formId = this.formSeq++;
    var g0 = this.corr.at(d0);
    var hw = g0.hw;
    var baseOff = (this.rng.next() * 2 - 1) * 0.30 * hw;
    for (var i = 0; i < count; i++) {
      var dd = d0 + i * spacing;
      var g = this.corr.at(dd);
      var off;
      var t = count > 1 ? i / (count - 1) : 0;
      if (kind === 'line') off = baseOff + (this.rng.next() * 2 - 1) * 6;
      else if (kind === 'chevron') off = lerp(-0.42, 0.42, t) * hw + baseOff;
      else if (kind === 'triangle') off = Math.sin(t * Math.PI) * 0.42 * hw + baseOff;
      else off = Math.sin(t * Math.PI) * 0.3 * hw + baseOff + (this.rng.next() * 2 - 1) * 8;
      var x = clamp(g.cx + off, g.cx - g.hw + FRAG_COLL + 10, g.cx + g.hw - FRAG_COLL - 10);
      this.addItem('fragment', dd, x, FRAG_COLL, FRAG_VIS, formId, kind, i);
    }
    return d0 + count * spacing + 20;
  };

  Sim.prototype.sampleWalls = function () {
    var out = [];
    var d0 = this.depth;
    for (var d = d0; d <= d0 + HORIZON; d += 40) {
      var g = this.corr.at(d);
      out.push({ depth: r3(d), leftX: r3(g.cx - g.hw), rightX: r3(g.cx + g.hw) });
    }
    return out;
  };

  Sim.prototype.safeHalfWidth = function () {
    var minGap = Infinity;
    for (var d = this.depth; d <= this.depth + HORIZON; d += 30) {
      var g = this.corr.at(d);
      var obs = [];
      for (var i = 0; i < this.rocks.length; i++) {
        var rock = this.rocks[i];
        if (!rock.active) continue;
        if (Math.abs(rock.depth - d) <= rock.collisionRadius) obs.push([rock.x - rock.collisionRadius, rock.x + rock.collisionRadius]);
      }
      var free = [[g.cx - g.hw, g.cx + g.hw]];
      for (var oi = 0; oi < obs.length; oi++) {
        var o = obs[oi];
        var nf = [];
        for (var fi = 0; fi < free.length; fi++) {
          var f = free[fi];
          if (o[1] <= f[0] || o[0] >= f[1]) nf.push(f);
          else {
            if (o[0] > f[0]) nf.push([f[0], o[0]]);
            if (o[1] < f[1]) nf.push([o[1], f[1]]);
          }
        }
        free = nf;
      }
      var best = 0;
      for (var bi = 0; bi < free.length; bi++) { var w = free[bi][1] - free[bi][0]; if (w > best) best = w; }
      if (best < minGap) minGap = best;
    }
    return minGap / 2;
  };

  Sim.prototype.previewMs = function () {
    var req = Infinity;
    for (var i = 0; i < this.rocks.length; i++) {
      var rock = this.rocks[i];
      if (!rock.active) continue;
      if (rock.depth > this.depth) { var rd = rock.depth - rock.collisionRadius; if (rd < req) req = rd; }
    }
    if (req === Infinity) {
      for (var d = this.depth + 200; d <= this.depth + HORIZON; d += 40) {
        var g = this.corr.at(d);
        if (Math.abs(g.cx - this.x) > g.hw * 0.55) { req = d; break; }
      }
    }
    if (req === Infinity) return 4000;
    return clamp((req - this.depth) / MAX_SPEED * 1000, 0, 4000);
  };

  Sim.prototype.snapshot = function () {
    var g = this.corr.at(this.depth);
    var rocks = this.rocks.slice().sort(function (a, b) { return a.id - b.id; }).map(function (r) {
      return { id: r.id, position: { x: r3(r.x), depth: r3(r.depth) }, active: r.active, visualRadius: r3(r.visualRadius), collisionRadius: r3(r.collisionRadius) };
    });
    var items = this.items.slice().sort(function (a, b) { return a.id - b.id; }).map(function (it) {
      return { id: it.id, type: it.type, position: { x: r3(it.x), depth: r3(it.depth) }, active: it.active, visualRadius: r3(it.visualRadius), collisionRadius: r3(it.collisionRadius), formationId: it.formationId, formationKind: it.formationKind, formationIndex: it.formationIndex };
    });
    return {
      phase: this.phase, tick: this.tick, elapsedMs: r3(this.timeMs), timeMs: r3(this.timeMs), remainingMs: r3(this.remainingMs),
      seed: this.seed, rngState: this.rng.state, spawnIndex: this.spawnIndex,
      input: { accel: this.input.accel, steer: r3(this.input.steer) },
      difficulty: r3(this.difficulty), score: Math.round(this.score), depth: r3(this.depth),
      x: r3(this.x), playerRadius: PLAYER_R, speed: r3(this.speed), maxSpeed: MAX_SPEED,
      hits: this.hits, wallContacts: this.wallContacts, fragmentsCollected: this.fragmentsCollected, rocksBroken: this.rocksBroken,
      nearMisses: this.nearMisses, invincibleUntilMs: r3(this.invincibleUntilMs), rank: this.rank,
      courseCenterX: r3(g.cx), corridorHalfWidth: r3(g.hw),
      walls: this.sampleWalls(),
      safeHalfWidth: r3(this.safeHalfWidth()),
      previewMs: r3(this.previewMs()),
      rocks: rocks, items: items,
      events: this.events, lastEvent: this.lastEvent
    };
  };

  D.sim = {
    createSim: function (seed) { return new Sim(seed | 0); },
    CONST: {
      WORLD_W: WORLD_W, WORLD_H: WORLD_H, VIEW_BACK: VIEW_BACK, CRAWL: CRAWL, MAX_SPEED: MAX_SPEED,
      PLAYER_R: PLAYER_R, STEP_MS: STEP_MS, START_TIME: START_TIME, NEAR_MISS_GAP: NEAR_MISS_GAP, POWER_DURATION: POWER_DURATION
    }
  };
})();