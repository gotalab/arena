/* EMBER — simulation.
 *
 * The single source of truth for every rule: physics, the glow economy, chains,
 * generation of the flue, the damp, scoring and rank. Fixed 60 Hz steps, seeded
 * RNG only, never reads Date.now()/Math.random(). The snapshot is a read-only
 * projection of exactly this state — no reward path lives anywhere else.
 */
(function () {
  'use strict';
  var E = window.EMBER;
  var clamp = E.clamp;

  var C = {
    STAGE_W: 360,          // world units across the stage
    WALL_L: 30,            // inner face of the left wall
    WALL_R: 330,           // inner face of the right wall
    G: 1500,               // gravity, units/s^2
    V_MIN: 400,            // weakest launch speed past the dead zone
    V_MAX: 800,            // full-strength launch speed
    MAX_FALL: 1250,
    R: 14,                 // spark radius — big enough for the face to act
    CAP: 3,                // glow stock cap
    WALL_SLIDE: 44,        // soot slip, units/s downward
    MOTH_KICK: 700,        // upward kick from a burst
    DEAD: 10,              // pull dead zone (world units)
    MAX_PULL: 115,         // pull length for full strength (world units)
    DAMP_START: -400,
    FLOOR_Y: -150,
    GLIMMER_R: 15, GLIMMER_VIS: 18,
    MOTH_R: 17, MOTH_VIS: 19,
    LEDGE_GRAB: 0.7,       // extra landing tolerance as a fraction of the radius
    LEDGE_THICK: 16
  };
  C.REACH = (C.V_MAX * C.V_MAX) / (2 * C.G); // 213.33 world units, straight up from rest

  var RANKS = [
    { min: 9000, name: 'STARFIRE', tier: 5 },
    { min: 5800, name: 'WILDFIRE', tier: 4 },
    { min: 3600, name: 'BLAZE', tier: 3 },
    { min: 2000, name: 'FLICKER', tier: 2 },
    { min: 900, name: 'CINDER', tier: 1 },
    { min: -1e9, name: 'EMBER', tier: 0 }
  ];
  function rankFor(score) {
    for (var i = 0; i < RANKS.length; i++) if (score >= RANKS[i].min) return RANKS[i];
    return RANKS[RANKS.length - 1];
  }

  function r2(v) { return Math.round(v * 100) / 100; }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  function Sim(seed) {
    this.sessionBest = 0;
    this.viewEvents = [];      // view-only mailbox (particles + audio). Never read by rules.
    this.seed = (seed >>> 0) || 0x5eed10;
    this.reset(this.seed);
  }

  Sim.prototype.reset = function (seed) {
    if (seed !== undefined && seed !== null) this.seed = seed >>> 0;
    this.rng = new E.Rng(this.seed);

    this.phase = 'ready';
    this.tick = 0;
    this.spawnIndex = 0;
    this.nextId = 1;

    this.x = 180; this.y = C.R;
    this.px = this.x; this.py = this.y;   // previous-step position (view interpolation + sweeps)
    this.vx = 0; this.vy = 0;
    this.anchored = true; this.anchorKind = 'ledge';
    this.anchorLedgeId = 0;

    this.jumpCapacity = C.CAP;
    this.jumpsLeft = C.CAP;
    this.launches = 0; this.midairLaunches = 0; this.landings = 0;
    this.refunds = 0; this.glimmersCollected = 0;

    this.chainCount = 0; this.chainBest = 0;
    this.bonus = 0; this.score = 0;
    this.height = 0; this.maxY = this.y;
    this.difficulty = 0;

    this.dampY = C.DAMP_START;
    this.dampSpeed = 0;

    this.ledges = [];
    this.items = [];
    this.lastEvent = null;
    this.rank = null;

    this.pending = [];         // launches queued by pointer releases
    this.input = { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0 };
    this.pull = { x: 0, y: 0 };  // current pull in world units (screen-space delta / scale)

    this.lastBank = null;      // view sugar for the bank number
    this.deathTick = 0;
    this.wallSide = 0;
    this.rankTier = 0;
    this.beatBest = false;
    this.ignoreLedgeId = -1;
    this.ignoreTicks = 0;

    // the hearth floor at the base of the flue, then the first perch above it
    var hearth = this._makeLedge(180, C.FLOOR_Y, 132);
    hearth.hearth = true;
    this.ledges.push(hearth);
    var start = this._makeLedge(180, 0, 62);
    this.ledges.push(start);
    this.genY = 0;
    this.prevLedge = start;
    this.ledgeCount = 1;
    this.stairCountdown = 4;
    this.pruneY = C.FLOOR_Y - 100;
    this._generate();
    this.viewEvents.length = 0;
    this.viewEvents.push({ kind: 'reset', tick: 0 });
  };

  Sim.prototype._makeLedge = function (x, y, hw) {
    this.spawnIndex++;
    return { id: this.nextId++, x: x, y: y, hw: hw, active: true };
  };

  /* ---------------------------------------------------------------- events */
  // `kind` values that reach lastEvent are exactly the six production events.
  Sim.prototype.emit = function (kind, data) {
    this.lastEvent = { kind: kind, tick: this.tick };
    var ev = data || {};
    ev.kind = kind; ev.tick = this.tick;
    this.viewEvents.push(ev);
  };
  // view-only signal: never enters lastEvent
  Sim.prototype.cue = function (kind, data) {
    var ev = data || {};
    ev.kind = kind; ev.tick = this.tick;
    this.viewEvents.push(ev);
  };

  /* ------------------------------------------------------------ generation */
  Sim.prototype.difficultyAt = function (y) {
    return clamp(y / 1600, 0, 6);
  };

  Sim.prototype._generate = function () {
    var target = Math.max(this.y, this.maxY) + C.REACH * 3.2;
    var guard = 0;
    while (this.genY < target && guard++ < 400) this._genStep();
  };

  Sim.prototype._genStep = function () {
    var rng = this.rng;
    var prev = this.prevLedge;
    var d = this.difficultyAt(prev.y);
    var reach = C.REACH;

    // Vertical spacing widens with height but never past the safe-road guarantee.
    var gmin = reach * (0.34 + 0.046 * d);
    var gmax = Math.min(reach * 0.74, reach * (0.47 + 0.052 * d));
    var gap = rng.range(gmin, gmax);
    var y = prev.y + gap;

    var hw = Math.max(22, (58 - 4.4 * d) * rng.range(0.82, 1.18));

    // Safe-road guarantee. A full-strength launch clears dy at lateral distance dx
    // when dy <= REACH - dx^2 / (4*REACH); inverted, that is the lateral budget for
    // this vertical gap. Applied from the previous ledge AND from both wall faces,
    // so every anchor in the flue — ledge or cling — has a perch it can reach.
    var maxLat = 2 * Math.sqrt(reach * Math.max(0, reach - gap)) * 0.88;
    var lo = Math.max(C.WALL_L + hw + 4, prev.x - maxLat, (C.WALL_R - C.R) - maxLat);
    var hi = Math.min(C.WALL_R - hw - 4, prev.x + maxLat, (C.WALL_L + C.R) + maxLat);
    if (hi < lo) { var m = (lo + hi) * 0.5; lo = hi = m; }

    // Push the next perch away from the last one so the climb keeps moving sideways.
    var wantLeft = prev.x > 180 ? rng.chance(0.78) : rng.chance(0.22);
    var x;
    var spread = Math.min(maxLat, 210) * rng.range(0.35, 1.0);
    x = wantLeft ? prev.x - spread : prev.x + spread;
    if (x < lo || x > hi) x = wantLeft ? prev.x + spread : prev.x - spread;
    x = clamp(x, lo, hi);

    var ledge = this._makeLedge(x, y, hw);
    this.ledges.push(ledge);
    this.ledgeCount++;
    this.genY = y;

    // a perch carved above an earlier prize lifts it clear rather than burying it
    for (var k = this.items.length - 1; k >= 0 && k > this.items.length - 24; k--) {
      var old = this.items[k];
      if (Math.abs(old.by - y) < 30 && Math.abs(old.bx - x) < hw + 26) {
        old.by = y + 40;
        old.y = old.by;
      }
    }

    this._placeItems(prev, ledge, gap, d);
    this.prevLedge = ledge;
  };

  Sim.prototype._addItem = function (type, x, y, phase) {
    x = clamp(x, C.WALL_L + 22, C.WALL_R - 22);
    // never materialise on top of the spark
    var dx = x - this.x, dy = y - this.y;
    if (dx * dx + dy * dy < 90 * 90) return null;
    // never bury a prize inside a perch
    for (var i = this.ledges.length - 1; i >= 0 && i > this.ledges.length - 8; i--) {
      var L = this.ledges[i];
      if (Math.abs(y - L.y) < 30 && Math.abs(x - L.x) < L.hw + 26) return null;
    }
    this.spawnIndex++;
    var it = {
      id: this.nextId++, type: type, active: true,
      x: x, y: y, bx: x, by: y,
      phase: phase || 0,
      amp: type === 'moth' ? 20 + 14 * this.rng.next() : 0,
      ampY: type === 'moth' ? 10 + 10 * this.rng.next() : 0,
      w1: type === 'moth' ? 0.010 + 0.008 * this.rng.next() : 0,
      w2: type === 'moth' ? 0.014 + 0.010 * this.rng.next() : 0
    };
    this.items.push(it);
    return it;
  };

  /* Placement asks questions: every prize is a wager against the glow in hand. */
  Sim.prototype._placeItems = function (prev, ledge, gap, d) {
    var rng = this.rng;
    var reach = C.REACH;
    var midY = prev.y + gap * 0.5;
    var lineX = (prev.x + ledge.x) * 0.5;

    // A moth parked in a wide gap turns a two-glow crossing into a one-glow bargain.
    var mothP = 0.3 + 0.35 * (gap / (reach * 0.74)) + 0.06 * d;
    if (rng.chance(Math.min(0.82, mothP))) {
      var mx = lineX + rng.range(-1, 1) * (70 + 30 * d);
      this._addItem('moth', mx, prev.y + gap * rng.range(0.5, 0.78), rng.range(0, 6.28));
    }

    // A glimmer hung one launch off the safe line.
    if (rng.chance(0.5 + 0.05 * d)) {
      var far = lineX < 180 ? 1 : -1;
      var gx = 180 + far * rng.range(80, 128);
      this._addItem('glimmer', gx, midY + rng.range(-18, 34));
    }

    // Occasionally a whole line of treasure through the open middle.
    if (rng.chance(0.16)) {
      var n = rng.int(3, 4);
      var cx = rng.range(C.WALL_L + 60, C.WALL_R - 60);
      var dir = rng.chance(0.5) ? 1 : -1;
      for (var i = 0; i < n; i++) {
        this._addItem('glimmer', cx + dir * i * rng.range(26, 40), ledge.y + 26 + i * rng.range(30, 44));
      }
    }

    // The staircase: moths read as steps through open air, treasure at the top.
    this.stairCountdown--;
    if (this.stairCountdown <= 0) {
      this.stairCountdown = rng.int(4, 7);
      var sx = rng.range(C.WALL_L + 70, C.WALL_R - 70);
      var sdir = sx > 180 ? -1 : 1;
      var sy = ledge.y + rng.range(60, 110);
      var steps = rng.int(2, 3) + (d > 3 ? 1 : 0);
      for (var s = 0; s < steps; s++) {
        this._addItem('moth', sx + sdir * s * rng.range(52, 78), sy + s * rng.range(120, 155), rng.range(0, 6.28));
      }
      this._addItem('glimmer', sx + sdir * steps * rng.range(52, 78), sy + steps * rng.range(120, 150) + 10);
      this._addItem('glimmer', sx + sdir * steps * rng.range(52, 78) + sdir * 30, sy + steps * rng.range(120, 150) + 40);
    }
  };

  Sim.prototype._prune = function () {
    // The damp only rises and the spark always sits above it, so anything well
    // below the damp can never re-enter the reported span.
    var floor = this.dampY - 320;
    if (floor <= this.pruneY) return;
    this.pruneY = floor;
    var i = 0;
    while (i < this.ledges.length && this.ledges[i].y < floor) i++;
    if (i > 0) this.ledges.splice(0, i);
    i = 0;
    while (i < this.items.length && this.items[i].by < floor) i++;
    if (i > 0) this.items.splice(0, i);
  };

  /* ----------------------------------------------------------------- input */
  Sim.prototype.setDrag = function (dragging, originX, originY, dx, dy, wx, wy) {
    this.input.dragging = !!dragging;
    this.input.originX = originX || 0;
    this.input.originY = originY || 0;
    this.input.dx = dx || 0;
    this.input.dy = dy || 0;
    this.pull.x = wx || 0;
    this.pull.y = wy || 0;
  };

  /* Release: pull vector in world units. Launch flies opposite the pull. */
  Sim.prototype.release = function (wx, wy) {
    var len = Math.sqrt(wx * wx + wy * wy);
    if (len < C.DEAD) { this.cue('cancel'); return; }
    if (this.phase === 'gameover') return;
    var t = clamp((len - C.DEAD) / (C.MAX_PULL - C.DEAD), 0, 1);
    var speed = C.V_MIN + (C.V_MAX - C.V_MIN) * t;
    // screen pull (x right, y down) -> world direction (x right, y up), reversed
    var dirx = -wx / len, diry = wy / len;
    this.pending.push({ dx: dirx, dy: diry, speed: speed, power: t });
  };

  Sim.prototype._doLaunch = function (L) {
    if (this.jumpsLeft <= 0) { this.cue('empty'); return; }
    var midair = !this.anchored;
    var fromWall = this.anchored && this.anchorKind === 'wall';
    var fromLedge = this.anchored && this.anchorKind === 'ledge';
    this.jumpsLeft--;
    this.launches++;
    if (midair) this.midairLaunches++;
    this.anchored = false;
    this.anchorKind = null;
    this.vx = L.dx * L.speed;
    this.vy = L.dy * L.speed;
    // leaving a cling always breaks contact, so a launch along the wall flies
    if (fromWall) this.x += (this.wallSide < 0 ? 1.6 : -1.6);
    // and the perch just left cannot re-catch the spark for a few ticks, so a
    // shallow launch skims away instead of sticking
    if (fromLedge) { this.ignoreLedgeId = this.anchorLedgeId; this.ignoreTicks = 8; }
    this.emit('launch', { power: L.power, midair: midair, chain: this.chainCount, x: this.x, y: this.y, vx: this.vx, vy: this.vy });
    if (midair) {
      this.chainCount++;
      this.emit('chain', { n: this.chainCount, x: this.x, y: this.y, from: 'launch' });
    }
  };

  /* ---------------------------------------------------------------- landing */
  Sim.prototype._land = function (kind, ledge, hard) {
    this.anchored = true;
    this.anchorKind = kind;
    this.anchorLedgeId = ledge ? ledge.id : 0;
    this.vx = 0; this.vy = 0;
    this.jumpsLeft = this.jumpCapacity;
    this.landings++;
    this.emit('land', { kind: kind, x: this.x, y: this.y, hard: hard || 0, chain: this.chainCount });
    if (this.chainCount > 0) {
      var n = this.chainCount;
      if (n > this.chainBest) this.chainBest = n;
      var val = 6 * n * (n + 1);       // later links are worth more than earlier ones
      this.bonus += val;
      this.lastBank = { n: n, v: val, tick: this.tick };
      this.chainCount = 0;
      this.emit('chainBank', { n: n, value: val, x: this.x, y: this.y });
    }
  };

  /* ------------------------------------------------------------------ step */
  Sim.prototype.step = function () {
    if (this.phase === 'gameover') { this.pending.length = 0; return; }

    if (this.phase === 'ready') {
      if (!this.pending.length) return;   // frozen: tick and elapsedMs stay at zero
      this.phase = 'playing';
      this.cue('begin');
    }

    this.tick++;
    var dt = 1 / 60;

    this.px = this.x; this.py = this.y;
    if (this.ignoreTicks > 0) this.ignoreTicks--;

    // 1) launches queued since the last step
    while (this.pending.length) this._doLaunch(this.pending.shift());

    // 2) motion
    if (this.anchored) {
      if (this.anchorKind === 'wall') {
        this.vx = 0;
        this.vy = -C.WALL_SLIDE;
        this.y -= C.WALL_SLIDE * dt;
        if ((this.tick % 26) === 0) this.cue('slip', { x: this.x, y: this.y });
        // slipping down onto a perch settles the spark on it
        var caught = this._ledgeSweep();
        if (caught) { this.y = caught.y + C.R; this._land('ledge', caught, 0); }
      } else {
        this.vx = 0; this.vy = 0;
      }
    } else {
      this.vy -= C.G * dt;
      if (this.vy < -C.MAX_FALL) this.vy = -C.MAX_FALL;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    // 3) moth drift (rule state: the burst target moves)
    var i, it;
    for (i = 0; i < this.items.length; i++) {
      it = this.items[i];
      if (!it.active || it.type !== 'moth') continue;
      it.x = clamp(it.bx + Math.sin(this.tick * it.w1 + it.phase) * it.amp, C.WALL_L + 20, C.WALL_R - 20);
      it.y = it.by + Math.sin(this.tick * it.w2 + it.phase * 1.7) * it.ampY;
    }

    // 4) contacts
    if (!this.anchored) this._contacts();

    // 5) height, difficulty, damp
    if (this.y > this.maxY) this.maxY = this.y;
    this.height = Math.max(0, this.maxY);
    this.difficulty = this.difficultyAt(this.height);

    var gap = this.y - this.dampY;
    var base = 26 + 12 * this.difficulty;
    var catchup = 1 + clamp((gap - 340) / 460, 0, 1) * 1.7;
    this.dampSpeed = base * catchup;
    this.dampY += this.dampSpeed * dt;

    this.score = Math.floor(this.height * 0.5 + this.bonus);

    // 6) generation + housekeeping
    this._generate();
    this._prune();

    // 7) the damp takes the spark
    if (this.y - C.R * 0.35 <= this.dampY) this._die();
  };

  /* One-way perch test: the ledge surface crossed downward since the last step. */
  Sim.prototype._ledgeSweep = function () {
    if (this.vy > 0) return null;
    var topPrev = this.py - C.R, topNow = this.y - C.R;
    for (var i = 0; i < this.ledges.length; i++) {
      var L = this.ledges[i];
      if (this.ignoreTicks > 0 && L.id === this.ignoreLedgeId) continue;
      if (L.y > topPrev + 1 || L.y < topNow - 1) continue;
      if (Math.abs(this.x - L.x) > L.hw + C.R * C.LEDGE_GRAB) continue;
      return L;
    }
    return null;
  };

  Sim.prototype._contacts = function () {
    var i, it, dx, dy, rr;

    // prizes first: a moth burst can save a landing that was about to happen
    for (i = 0; i < this.items.length; i++) {
      it = this.items[i];
      if (!it.active) continue;
      dx = it.x - this.x; dy = it.y - this.y;
      var cr = (it.type === 'moth' ? C.MOTH_R : C.GLIMMER_R) + C.R;
      if (dx * dx + dy * dy > cr * cr) continue;
      if (it.type === 'glimmer') {
        it.active = false;
        this.glimmersCollected++;
        var val = Math.round(60 * (1 + 0.6 * Math.min(this.chainCount, 6)));
        this.bonus += val;
        this.emit('glimmer', { x: it.x, y: it.y, value: val, chain: this.chainCount });
      } else {
        it.active = false;
        this.vy = C.MOTH_KICK;
        this.vx *= 0.6;
        if (this.jumpsLeft < this.jumpCapacity) { this.jumpsLeft++; this.refunds++; }
        this.emit('bounce', { x: it.x, y: it.y, chain: this.chainCount + 1 });
        this.chainCount++;
        this.emit('chain', { n: this.chainCount, x: it.x, y: it.y, from: 'bounce' });
      }
    }

    // ledges: one-way perches, caught on the way down
    var L = this._ledgeSweep();
    if (L) {
      var hard = clamp(-this.vy / 900, 0, 1);
      this.y = L.y + C.R;
      this.x = clamp(this.x, C.WALL_L + C.R, C.WALL_R - C.R);
      this._land('ledge', L, hard);
      return;
    }

    // walls: they hold, but soot slips
    if (this.x - C.R <= C.WALL_L) {
      this.x = C.WALL_L + C.R;
      this.wallSide = -1;
      this._land('wall', null, clamp(Math.abs(this.vx) / 700, 0, 1));
      return;
    }
    if (this.x + C.R >= C.WALL_R) {
      this.x = C.WALL_R - C.R;
      this.wallSide = 1;
      this._land('wall', null, clamp(Math.abs(this.vx) / 700, 0, 1));
      return;
    }
  };

  Sim.prototype._die = function () {
    this.phase = 'gameover';
    this.deathTick = this.tick;
    this.y = this.dampY + C.R * 0.35;
    this.vx = 0; this.vy = 0;
    this.anchored = false; this.anchorKind = null;
    var r = rankFor(this.score);
    this.rank = r.name;
    this.rankTier = r.tier;
    this.beatBest = this.score > this.sessionBest;
    if (this.score > this.sessionBest) this.sessionBest = this.score;
    this.cue('death', { x: this.x, y: this.y, tier: r.tier });
  };

  /* -------------------------------------------------------------- snapshot
   * A read-only projection of the state above. It computes nothing the game
   * does not already have, and reading it changes nothing.
   *
   * Precision (stable across builds):
   *   positions, velocities, height, dampY, dampSpeed, launchReach,
   *   halfWidth, input      -> 2 decimals
   *   difficulty            -> 3 decimals
   *   score, sessionBest, elapsedMs, tick, all counters -> integers
   *   playerRadius, wallLeftX, wallRightX, visualRadius, collisionRadius
   *                         -> exact integer constants
   * Reported entity span: one launchReach below the spark to 2.6 above it.
   */
  Sim.prototype.snapshot = function () {
    var lo = this.y - C.REACH, hi = this.y + C.REACH * 2.6;
    var ledges = [], items = [], i, L, it;
    for (i = 0; i < this.ledges.length; i++) {
      L = this.ledges[i];
      if (L.y < lo || L.y > hi) continue;
      ledges.push({ id: L.id, position: { x: r2(L.x), y: r2(L.y) }, halfWidth: r2(L.hw), active: L.active !== false });
    }
    for (i = 0; i < this.items.length; i++) {
      it = this.items[i];
      if (it.y < lo || it.y > hi) continue;
      items.push({
        id: it.id, type: it.type,
        position: { x: r2(it.x), y: r2(it.y) },
        active: !!it.active,
        visualRadius: it.type === 'moth' ? C.MOTH_VIS : C.GLIMMER_VIS,
        collisionRadius: it.type === 'moth' ? C.MOTH_R : C.GLIMMER_R
      });
    }
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.round(this.tick * 1000 / 60),
      seed: this.seed,
      rngState: this.rng.s >>> 0,
      spawnIndex: this.spawnIndex,
      input: {
        dragging: this.input.dragging,
        originX: r2(this.input.originX), originY: r2(this.input.originY),
        dx: r2(this.input.dx), dy: r2(this.input.dy)
      },
      difficulty: r3(this.difficulty),
      score: this.score,
      height: r2(this.height),
      sessionBest: this.sessionBest,
      rank: this.rank,

      x: r2(this.x), y: r2(this.y), vx: r2(this.vx), vy: r2(this.vy),
      playerRadius: C.R,
      anchored: !!this.anchored,
      anchorKind: this.anchored ? this.anchorKind : null,

      jumpCapacity: this.jumpCapacity,
      jumpsLeft: this.jumpsLeft,
      launches: this.launches,
      midairLaunches: this.midairLaunches,
      landings: this.landings,
      refunds: this.refunds,
      glimmersCollected: this.glimmersCollected,

      chainCount: this.chainCount,
      chainBest: this.chainBest,

      dampY: r2(this.dampY),
      dampSpeed: r2(this.dampSpeed),
      wallLeftX: C.WALL_L,
      wallRightX: C.WALL_R,
      launchReach: r2(C.REACH),

      ledges: ledges,
      items: items,
      lastEvent: this.lastEvent ? { kind: this.lastEvent.kind, tick: this.lastEvent.tick } : null
    };
  };

  E.C = C;
  E.Sim = Sim;
  E.rankFor = rankFor;
  E.RANKS = RANKS;
})();
