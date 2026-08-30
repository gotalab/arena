/* STOMP - deterministic simulation core.
 *
 * World Y increases DOWNWARD. groundY is the largest of the three fixed
 * vertical references, highLaneY the smallest. Every entity y and vertical
 * velocity follows that same orientation (vy < 0 means travelling upward).
 *
 * Geometry is tuned around one invariant: from anywhere on the ground the
 * machine reaches the landing point of any legal return before the ball
 * arrives. See STOMP.audit() for the numeric proof.
 */
(function (global) {
  'use strict';

  var STEP_MS = 1000 / 60;
  var DT = STEP_MS / 1000;

  var K = {
    W: 360,
    H: 640,

    GROUND_Y: 596,
    LOW_LANE_Y: 412,
    HIGH_LANE_Y: 246,

    MACH_HALF_W: 30,
    MACH_HALF_H: 23,
    MACH_SPEED: 268,
    MACH_ACCEL: 2300,
    MACH_BRAKE: 2900,
    MACH_GRAV: 1520,
    JUMP_V: 516,

    BALL_R: 11,
    BALL_GRAV: 620,
    BALL_VX_MAX: 168,
    WALL_KEEP: 0.92,

    // Bands are declared as the altitude the return has to reach, not as a
    // launch speed. The machine's deck sits 88px higher at its jump apex than
    // on the ground, so a fixed speed would let a late airborne catch outrun
    // the lane it belongs to. Solving for the speed instead keeps weak below
    // the low lane, normal between the lanes, and power above the high lane
    // from every contact height the machine can produce.
    BAND_APEX: { weak: 446, normal: 316, power: 150 },
    BOUNCE_MIN: 150,
    EDGE_FRAC: 0.62,

    START_MS: 78000,
    MAX_MS: 120000,

    WRONG_SIDE_MS: -4000,
    BALL_DROP_MS: -6500,
    WALKER_BODY_MS: -2500,
    WALKER_GRACE: 100,
    STOMP_MS: 400,
    STOMP_SCORE: 60,

    BALL_RESPAWN_TICKS: 30,
    BALL_RESPAWN_H: 300,

    JUMP_BUFFER: 8,
    EVENT_CAP: 48,
    CORPSE_TICKS: 45,

    SCORE_TIERS: [1400, 3400, 6200, 10500, 16000],
    RANKS: [
      { at: 0, name: 'RUST' },
      { at: 1500, name: 'BOLT' },
      { at: 3600, name: 'PISTON' },
      { at: 7000, name: 'HAMMER' },
      { at: 12000, name: 'ANVIL' },
      { at: 18000, name: 'TITAN' }
    ]
  };

  K.MACH_GROUND_Y = K.GROUND_Y - K.MACH_HALF_H;
  K.MACH_APEX_Y = K.MACH_GROUND_Y - (K.JUMP_V * K.JUMP_V) / (2 * K.MACH_GRAV);
  K.BALL_REST_Y = K.MACH_GROUND_Y - K.MACH_HALF_H - K.BALL_R;

  // Launch speed that carries a ball leaving `contactY` up to its band altitude.
  K.bandSpeed = function (contactY, kind) {
    var rise = contactY - K.BAND_APEX[kind];
    var v = rise > 0 ? Math.sqrt(2 * K.BALL_GRAV * rise) : 0;
    return Math.max(K.BOUNCE_MIN, v);
  };

  var SPEC = {
    slowFlyer: {
      lane: null,
      visualRadius: 19,
      collisionRadius: 18,
      hitsRequired: 3,
      speed: [30, 33, 36, 39, 43, 47],
      timeRewards: [1900, 3100, 6000],
      scoreRewards: [120, 180, 700],
      rebound: [424, 442, 462]
    },
    fastFlyer: {
      visualRadius: 17,
      collisionRadius: 16,
      hitsRequired: 3,
      speed: [74, 74, 82, 90, 99, 108],
      timeRewards: [2100, 3300, 6600],
      scoreRewards: [170, 250, 1000],
      rebound: [424, 442, 462]
    },
    walker: {
      visualRadius: 16,
      collisionRadius: 15,
      boxW: 1,
      boxH: 0.86,
      hitsRequired: 1,
      speed: [55, 55, 60, 64, 70, 76]
    }
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------------------------------------------------------------- sim */

  function Sim(seed) {
    this.reset(seed);
  }

  Sim.prototype.reset = function (seed) {
    var s = (seed === undefined || seed === null) ? this.seed : seed;
    s = (s >>> 0) || 0;
    this.seed = s;
    this.rngState = (s ^ 0x9e3779b9) >>> 0;
    if (this.rngState === 0) this.rngState = 0x6d2b79f5;

    this.tick = 0;
    this.simTimeMs = 0;
    this.phase = 'ready';
    this.elapsedMs = 0;
    this.remainingMs = K.START_MS;
    this.score = 0;
    this.difficulty = 0;

    this.machine = {
      x: K.W / 2,
      y: K.MACH_GROUND_Y,
      vx: 0,
      vy: 0,
      grounded: true,
      jumpCount: 0,
      graceTicks: 0
    };

    this.ball = {
      x: K.W / 2,
      y: K.BALL_REST_Y,
      vx: 0,
      vy: 0,
      active: true,
      lastBounceKind: null,
      respawnTicks: 0
    };

    this.topHits = 0;
    this.airEnemiesDefeated = 0;
    this.wrongSideHits = 0;
    this.ballDrops = 0;
    this.longestCleanSequence = 0;
    this.cleanSequence = 0;

    this.enemies = [];
    this.nextEnemyId = 1;
    this.pending = [];

    this.dir = {
      lastLane: 'high',
      secondDemoAt: 270,
      secondDemoDone: false,
      nextWalkerAt: 1080,
      nextSpawnAt: 0
    };

    this.events = [];
    this.sequence = 0;
    this.lastEvent = null;

    this.input = { moveAxis: 0, jumpHeld: false, jumpQueued: false };
    this._jumpBuffer = 0;
    this._prevBallBottom = this.ball.y + K.BALL_R;
    this._prevMachTop = this.machine.y - K.MACH_HALF_H;
    return this;
  };

  /* -------------------------------------------------------------- random */

  Sim.prototype.rnd = function () {
    var x = this.rngState;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.rngState = x;
    return x / 4294967296;
  };

  Sim.prototype.rndInt = function (n) { return Math.floor(this.rnd() * n); };

  /* -------------------------------------------------------------- events */

  Sim.prototype.emit = function (kind, opts) {
    opts = opts || {};
    this.sequence += 1;
    var e = {
      sequence: this.sequence,
      kind: kind,
      tick: this.tick,
      enemyId: opts.enemyId === undefined ? null : opts.enemyId,
      amountMs: opts.amountMs === undefined ? 0 : opts.amountMs,
      source: opts.source || 'system',
      contact: opts.contact === undefined ? null : opts.contact
    };
    this.events.push(e);
    if (this.events.length > K.EVENT_CAP) this.events.shift();
    this.lastEvent = e;
    return e;
  };

  Sim.prototype.addTime = function (ms) {
    var before = this.remainingMs;
    this.remainingMs = clamp(this.remainingMs + ms, 0, K.MAX_MS);
    return this.remainingMs - before;
  };

  Sim.prototype.addScore = function (base) {
    var gain = Math.round(base * (1 + this.difficulty * 0.1));
    this.score += gain;
    var t = 0;
    for (var i = 0; i < K.SCORE_TIERS.length; i++) if (this.score >= K.SCORE_TIERS[i]) t = i + 1;
    if (t > this.difficulty) this.difficulty = t;
    return gain;
  };

  Sim.prototype.rank = function () {
    var name = K.RANKS[0].name;
    for (var i = 0; i < K.RANKS.length; i++) if (this.score >= K.RANKS[i].at) name = K.RANKS[i].name;
    return name;
  };

  /* --------------------------------------------------------------- input */

  Sim.prototype.setMove = function (axis) {
    axis = clamp(axis || 0, -1, 1);
    this.input.moveAxis = axis;
    if (Math.abs(axis) > 0.14) this.begin();
  };

  Sim.prototype.setJumpHeld = function (held) { this.input.jumpHeld = !!held; };

  Sim.prototype.queueJump = function () {
    this._jumpBuffer = K.JUMP_BUFFER;
    this.input.jumpQueued = true;
    this.begin();
  };

  Sim.prototype.begin = function () {
    if (this.phase === 'ready') {
      this.phase = 'run';
      this.simTimeMs = 0;
    }
  };

  Sim.prototype.frozen = function () { return this.phase !== 'run'; };

  /* ---------------------------------------------------------------- pump */

  // Single entry point for time. Real-time frames and advance(ms) both feed
  // this, so both paths consume the identical fixed-step sequence.
  //
  // The step count is derived from a running total rather than by repeatedly
  // subtracting the step length, so feeding 6000ms as one call, six calls, or
  // six hundred calls all land on exactly the same tick.
  Sim.prototype.pump = function (ms, maxSteps) {
    if (this.frozen()) { this.simTimeMs = this.tick * STEP_MS; return 0; }
    this.simTimeMs += ms;
    var target = Math.floor(this.simTimeMs / STEP_MS + 1e-9);
    var cap = maxSteps || Infinity;
    var n = 0;
    while (this.tick < target && n < cap) {
      this.step();
      n++;
      if (this.frozen()) break;
    }
    // A stalled frame must not snowball into a fast-forward.
    if (this.tick < target) this.simTimeMs = this.tick * STEP_MS;
    return n;
  };

  /* ---------------------------------------------------------------- step */

  Sim.prototype.step = function () {
    this.tick += 1;
    var m = this.machine;
    var b = this.ball;

    if (this._jumpBuffer > 0) this._jumpBuffer -= 1;
    this.input.jumpQueued = this._jumpBuffer > 0;
    if (m.graceTicks > 0) m.graceTicks -= 1;

    this._prevBallBottom = b.y + K.BALL_R;
    this._prevMachTop = m.y - K.MACH_HALF_H;

    /* machine horizontal */
    var want = this.input.moveAxis * K.MACH_SPEED;
    if (want === 0) {
      if (m.vx > 0) m.vx = Math.max(0, m.vx - K.MACH_BRAKE * DT);
      else if (m.vx < 0) m.vx = Math.min(0, m.vx + K.MACH_BRAKE * DT);
    } else if (want > m.vx) {
      m.vx = Math.min(want, m.vx + K.MACH_ACCEL * DT);
    } else if (want < m.vx) {
      m.vx = Math.max(want, m.vx - K.MACH_ACCEL * DT);
    }
    m.x += m.vx * DT;
    if (m.x < K.MACH_HALF_W) { m.x = K.MACH_HALF_W; if (m.vx < 0) m.vx = 0; }
    if (m.x > K.W - K.MACH_HALF_W) { m.x = K.W - K.MACH_HALF_W; if (m.vx > 0) m.vx = 0; }

    /* machine jump + vertical */
    if (this._jumpBuffer > 0 && m.grounded) {
      m.vy = -K.JUMP_V;
      m.grounded = false;
      m.jumpCount = 1;
      this._jumpBuffer = 0;
      this.input.jumpQueued = false;
      this.emit('machine_jump', { source: 'machine' });
    }
    if (!m.grounded) {
      m.vy += K.MACH_GRAV * DT;
      m.y += m.vy * DT;
      if (m.y >= K.MACH_GROUND_Y) {
        m.y = K.MACH_GROUND_Y;
        m.vy = 0;
        m.grounded = true;
        m.jumpCount = 0;
        this.emit('machine_land', { source: 'machine' });
      }
    }

    /* ball */
    if (b.active) {
      b.vy += K.BALL_GRAV * DT;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      if (b.x < K.BALL_R) { b.x = K.BALL_R; b.vx = Math.abs(b.vx) * K.WALL_KEEP; }
      else if (b.x > K.W - K.BALL_R) { b.x = K.W - K.BALL_R; b.vx = -Math.abs(b.vx) * K.WALL_KEEP; }
      if (b.y < K.BALL_R) { b.y = K.BALL_R; b.vy = Math.abs(b.vy) * 0.5; }
    } else {
      b.respawnTicks -= 1;
      if (b.respawnTicks <= 0) {
        b.x = m.x;
        b.y = K.GROUND_Y - K.BALL_RESPAWN_H;
        b.vx = 0;
        b.vy = 0;
        b.active = true;
        b.lastBounceKind = null;
      }
    }

    this.moveEnemies();
    this.direct();
    if (b.active) this.ballVsMachine();
    if (b.active) this.ballVsEnemies();
    this.machineVsWalkers();
    if (b.active) this.ballVsGround();

    /* clock */
    this.elapsedMs += STEP_MS;
    this.remainingMs -= STEP_MS;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'over';
    }
  };

  /* ------------------------------------------------------- ball vs machine */

  Sim.prototype.ballVsMachine = function () {
    var m = this.machine;
    var b = this.ball;
    var topY = m.y - K.MACH_HALF_H;
    var dx = b.x - m.x;
    var reach = K.MACH_HALF_W + K.BALL_R * 0.6;

    if (Math.abs(dx) <= reach &&
        (b.vy - m.vy) > -1 &&
        this._prevBallBottom <= this._prevMachTop + 2 &&
        b.y + K.BALL_R >= topY) {
      var kind;
      if (!m.grounded && m.vy < -60) kind = 'power';
      else if (!m.grounded) kind = 'weak';
      else kind = 'normal';
      if (Math.abs(dx) > K.MACH_HALF_W * K.EDGE_FRAC) {
        kind = kind === 'power' ? 'normal' : 'weak';
      }
      b.y = topY - K.BALL_R - 0.5;
      b.vy = -K.bandSpeed(b.y, kind);
      b.vx = clamp(b.vx * 0.30 + m.vx * 0.62 + dx * 3.6, -K.BALL_VX_MAX, K.BALL_VX_MAX);
      b.lastBounceKind = kind;
      this.emit('ball_bounce_' + kind, { source: 'machine', contact: 'top' });
      return;
    }

    /* not a top catch: shove the ball clear of the body so it cannot lodge */
    if (Math.abs(dx) < K.MACH_HALF_W + K.BALL_R &&
        Math.abs(b.y - m.y) < K.MACH_HALF_H + K.BALL_R * 0.6) {
      var side = dx >= 0 ? 1 : -1;
      b.x = m.x + side * (K.MACH_HALF_W + K.BALL_R + 0.5);
      b.vx = side * Math.max(Math.abs(b.vx) * 0.7, 90);
      b.x = clamp(b.x, K.BALL_R, K.W - K.BALL_R);
    }
  };

  /* ------------------------------------------------------- ball vs enemies */

  // The flyer's collision shape is exactly the circle the snapshot reports, and
  // the verdict is the one the player's eyes already reached: coming down onto
  // its upper half is a stomp, anything else is a bite. No hidden shoulders, no
  // punished graze on a descent the player aimed.
  Sim.prototype.ballVsEnemies = function () {
    var b = this.ball;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.active || e.lane === 'ground') continue;

      var dx = b.x - e.x;
      var dy = b.y - e.y;
      var R = K.BALL_R + e.collisionRadius;
      if (dx * dx + dy * dy >= R * R) { e.overlap = false; continue; }
      if (e.overlap) continue;
      e.overlap = true;

      if (b.vy > 20 && dy <= 0) this.topHit(e);
      else this.wrongSide(e, dx, dy);
      if (!b.active) return;
    }
  };

  Sim.prototype.topHit = function (e) {
    var b = this.ball;
    var spec = SPEC[e.type];
    var idx = e.hitsTaken;
    e.hitsTaken += 1;
    e.flashTick = this.tick;
    this.topHits += 1;
    this.cleanSequence += 1;
    if (this.cleanSequence > this.longestCleanSequence) this.longestCleanSequence = this.cleanSequence;

    var gained = this.addTime(spec.timeRewards[idx]);
    this.addScore(spec.scoreRewards[idx]);

    b.y = e.y - e.collisionRadius - K.BALL_R - 1;
    b.vy = -spec.rebound[idx];
    b.vx = clamp(b.vx * 0.55 + (b.x - e.x) * 4.6, -150, 150);
    b.lastBounceKind = 'power';

    this.emit('top_hit', {
      enemyId: e.id, amountMs: gained, source: 'ball', contact: 'top'
    });

    if (e.hitsTaken >= e.hitsRequired) {
      e.active = false;
      e.corpse = K.CORPSE_TICKS;
      this.airEnemiesDefeated += 1;
      this.emit('enemy_defeated', {
        enemyId: e.id, amountMs: 0, source: 'ball', contact: 'top'
      });
      // recovery beat after every kill
      this.dir.nextSpawnAt = Math.max(this.dir.nextSpawnAt, this.tick + 72);
    }
  };

  Sim.prototype.wrongSide = function (e, dx, dy) {
    var b = this.ball;
    this.wrongSideHits += 1;
    this.cleanSequence = 0;
    var lost = this.addTime(K.WRONG_SIDE_MS);
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / len, ny = dy / len;
    var R = e.collisionRadius + K.BALL_R + 1;
    b.x = clamp(e.x + nx * R, K.BALL_R, K.W - K.BALL_R);
    b.y = e.y + ny * R;
    // Swatted sideways with a small pop, never spiked at the floor: the cost of
    // a wrong-side bite is the clock, not an unavoidable second penalty.
    b.vx = clamp(nx * 160 + b.vx * 0.3, -K.BALL_VX_MAX, K.BALL_VX_MAX);
    b.vy = -170;
    b.lastBounceKind = 'weak';
    e.hurtTick = this.tick;
    this.emit('wrong_side_hit', {
      enemyId: e.id, amountMs: lost, source: 'ball', contact: 'non_top'
    });
    if (this.remainingMs <= 0) { this.remainingMs = 0; this.phase = 'over'; }
  };

  /* ------------------------------------------------------------ ball drop */

  Sim.prototype.ballVsGround = function () {
    var b = this.ball;
    if (b.y + K.BALL_R < K.GROUND_Y) return;
    b.active = false;
    b.y = K.GROUND_Y - K.BALL_R;
    b.vx = 0;
    b.vy = 0;
    b.respawnTicks = K.BALL_RESPAWN_TICKS;
    b.lastBounceKind = null;
    this.ballDrops += 1;
    this.cleanSequence = 0;
    for (var i = 0; i < this.enemies.length; i++) this.enemies[i].overlap = false;
    var lost = this.addTime(K.BALL_DROP_MS);
    this.emit('ball_drop', { amountMs: lost, source: 'system', contact: 'body' });
    if (this.remainingMs <= 0) { this.remainingMs = 0; this.phase = 'over'; }
  };

  /* -------------------------------------------------- machine vs walkers */

  Sim.prototype.machineVsWalkers = function () {
    var m = this.machine;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.active || e.lane !== 'ground') continue;
      var halfW = e.halfW;
      var halfH = e.halfH;
      var overlapX = Math.abs(m.x - e.x) < K.MACH_HALF_W + halfW;
      if (!overlapX) { e.overlap = false; continue; }
      var mBottom = m.y + K.MACH_HALF_H;
      var eTop = e.y - halfH;
      var overlapY = mBottom > eTop && (m.y - K.MACH_HALF_H) < e.y + halfH;
      if (!overlapY) { e.overlap = false; continue; }

      if (!m.grounded && m.vy > 40 && mBottom - eTop < halfH * 1.9) {
        e.active = false;
        e.corpse = K.CORPSE_TICKS;
        e.hitsTaken = 1;
        m.vy = -380;
        var g = this.addTime(K.STOMP_MS);
        this.addScore(K.STOMP_SCORE);
        this.emit('ground_stomp', {
          enemyId: e.id, amountMs: g, source: 'machine', contact: 'top'
        });
        continue;
      }

      if (!e.overlap && m.graceTicks <= 0) {
        e.overlap = true;
        m.graceTicks = K.WALKER_GRACE;
        e.stun = 40;
        e.hurtTick = this.tick;
        m.x = clamp(m.x - Math.sign(m.x - e.x || 1) * -6, K.MACH_HALF_W, K.W - K.MACH_HALF_W);
        m.vx *= -0.3;
        var lost = this.addTime(K.WALKER_BODY_MS);
        this.emit('walker_body_hit', {
          enemyId: e.id, amountMs: lost, source: 'machine', contact: 'body'
        });
        if (this.remainingMs <= 0) { this.remainingMs = 0; this.phase = 'over'; }
      }
    }
  };

  /* -------------------------------------------------------------- enemies */

  Sim.prototype.moveEnemies = function () {
    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      if (!e.active) {
        e.corpse -= 1;
        if (e.corpse <= 0) this.enemies.splice(i, 1);
        continue;
      }
      if (e.stun > 0) { e.stun -= 1; }
      else { e.x += e.vx * DT; }
      var pad = e.visualRadius + 34;
      if (e.x < -pad || e.x > K.W + pad) this.enemies.splice(i, 1);
    }
  };

  Sim.prototype.laneY = function (lane) {
    if (lane === 'low') return K.LOW_LANE_Y;
    if (lane === 'high') return K.HIGH_LANE_Y;
    return K.GROUND_Y - SPEC.walker.collisionRadius * 0.86;
  };

  Sim.prototype.schedule = function (type, lane, delay) {
    var side = this.rnd() < 0.5 ? -1 : 1;
    this.pending.push({ type: type, lane: lane, side: side, at: this.tick + delay });
    if (lane !== 'ground') this.dir.lastLane = lane;
  };

  Sim.prototype.spawn = function (p) {
    var spec = SPEC[p.type];
    var tier = Math.min(this.difficulty, spec.speed.length - 1);
    var speed = spec.speed[tier];
    var r = spec.visualRadius;
    var e = {
      id: this.nextEnemyId++,
      type: p.type,
      lane: p.lane,
      x: p.side < 0 ? -(r + 8) : K.W + r + 8,
      y: this.laneY(p.lane),
      vx: p.side < 0 ? speed : -speed,
      active: true,
      hitsTaken: 0,
      hitsRequired: spec.hitsRequired,
      visualRadius: r,
      collisionRadius: spec.collisionRadius,
      halfW: spec.collisionRadius * (spec.boxW || 1),
      halfH: spec.collisionRadius * (spec.boxH || 1),
      overlap: false,
      corpse: 0,
      stun: 0,
      flashTick: -999,
      hurtTick: -999,
      bornTick: this.tick
    };
    this.enemies.push(e);
    return e;
  };

  /* ------------------------------------------------------------- director */

  Sim.prototype.direct = function () {
    var i;
    for (i = this.pending.length - 1; i >= 0; i--) {
      if (this.tick >= this.pending[i].at) {
        this.spawn(this.pending[i]);
        this.pending.splice(i, 1);
      }
    }

    var flyers = 0, walkers = 0, pendFly = 0, pendWalk = 0;
    var laneCount = { low: 0, high: 0 };
    var only = null;
    for (i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.active) continue;
      if (e.lane === 'ground') walkers++;
      else { flyers++; only = e; laneCount[e.lane]++; }
    }
    for (i = 0; i < this.pending.length; i++) {
      if (this.pending[i].lane === 'ground') pendWalk++;
      else { pendFly++; laneCount[this.pending[i].lane]++; }
    }

    var d = this.dir;
    var opening = this.airEnemiesDefeated === 0;

    if (opening) {
      // The opening is a promise, not a draw: a slow flyer is always crossing,
      // and a replacement follows within two seconds of the last one leaving.
      if (flyers + pendFly === 0) {
        var lane = d.lastLane === 'low' ? 'high' : 'low';
        this.schedule('slowFlyer', lane, this.tick === 0 ? 40 : 54 + this.rndInt(46));
        return;
      }
      if (!d.secondDemoDone && this.tick >= d.secondDemoAt && flyers + pendFly === 1) {
        var other = only && only.lane === 'low' ? 'high' : 'low';
        this.schedule('slowFlyer', other, 6);
        d.secondDemoDone = true;
        return;
      }
      if (walkers + pendWalk === 0 && this.tick >= d.nextWalkerAt) {
        this.schedule('walker', 'ground', 30);
        d.nextWalkerAt = this.tick + 900 + this.rndInt(420);
      }
      return;
    }

    if (this.tick < d.nextSpawnAt) return;
    var tier = this.difficulty;
    var maxFly = tier >= 3 ? 3 : 2;
    var gaps = [216, 198, 174, 156, 140, 128];
    var fastP = [0, 0.14, 0.28, 0.40, 0.50, 0.56];
    var walkP = [0.10, 0.16, 0.22, 0.28, 0.34, 0.40];

    if (flyers + pendFly < maxFly) {
      var type = this.rnd() < fastP[tier] ? 'fastFlyer' : 'slowFlyer';
      var pick = this.rnd() < 0.5 ? 'low' : 'high';
      if (laneCount[pick] >= 2) pick = pick === 'low' ? 'high' : 'low';
      this.schedule(type, pick, 42);
      d.nextSpawnAt = this.tick + gaps[tier] + this.rndInt(38);

      // divided attention only from tier 2 up, and never more than one walker
      if (tier >= 2 && walkers + pendWalk === 0 && this.rnd() < walkP[tier]) {
        this.schedule('walker', 'ground', 66 + this.rndInt(40));
      }
    } else {
      d.nextSpawnAt = this.tick + 40;
      if (walkers + pendWalk === 0 && this.rnd() < walkP[tier] * 0.5) {
        this.schedule('walker', 'ground', 40);
      }
    }
  };

  /* ------------------------------------------------------------- snapshot */

  Sim.prototype.snapshot = function () {
    var out = {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.round(this.elapsedMs),
      remainingMs: Math.round(this.remainingMs),
      seed: this.seed,
      rngState: this.rngState >>> 0,
      score: this.score,
      difficulty: this.difficulty,
      rank: this.rank(),
      input: {
        moveAxis: this.input.moveAxis,
        jumpHeld: this.input.jumpHeld,
        jumpQueued: this.input.jumpQueued
      },

      groundY: K.GROUND_Y,
      lowLaneY: K.LOW_LANE_Y,
      highLaneY: K.HIGH_LANE_Y,
      machineNormalApexY: K.MACH_APEX_Y,

      machine: {
        x: this.machine.x,
        y: this.machine.y,
        vx: this.machine.vx,
        vy: this.machine.vy,
        radius: K.MACH_HALF_W,
        grounded: this.machine.grounded,
        jumpCount: this.machine.jumpCount
      },

      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        radius: K.BALL_R,
        active: this.ball.active,
        lastBounceKind: this.ball.lastBounceKind
      },

      topHits: this.topHits,
      airEnemiesDefeated: this.airEnemiesDefeated,
      wrongSideHits: this.wrongSideHits,
      ballDrops: this.ballDrops,
      longestCleanSequence: this.longestCleanSequence,

      enemies: [],
      recentEvents: [],
      lastEvent: null,

      /* presentation-only extras (not part of the contract) */
      telegraphs: [],
      worldW: K.W,
      worldH: K.H
    };

    var list = this.enemies.slice().sort(function (a, b) { return a.id - b.id; });
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      out.enemies.push({
        id: e.id,
        type: e.type,
        lane: e.lane,
        x: e.x,
        y: e.y,
        vx: e.vx,
        active: e.active,
        hitsTaken: e.hitsTaken,
        hitsRequired: e.hitsRequired,
        visualRadius: e.visualRadius,
        collisionRadius: e.collisionRadius
      });
    }
    for (i = 0; i < this.events.length; i++) {
      var ev = this.events[i];
      out.recentEvents.push({
        sequence: ev.sequence, kind: ev.kind, tick: ev.tick,
        enemyId: ev.enemyId, amountMs: ev.amountMs,
        source: ev.source, contact: ev.contact
      });
    }
    if (this.lastEvent) {
      var l = this.lastEvent;
      out.lastEvent = {
        sequence: l.sequence, kind: l.kind, tick: l.tick,
        enemyId: l.enemyId, amountMs: l.amountMs,
        source: l.source, contact: l.contact
      };
    }
    for (i = 0; i < this.pending.length; i++) {
      var p = this.pending[i];
      out.telegraphs.push({
        type: p.type, lane: p.lane, side: p.side,
        ticks: Math.max(0, p.at - this.tick)
      });
    }
    return out;
  };

  /* ----------------------------------------------------------------- meta */

  Sim.prototype.viewState = function () { return this; };

  global.STOMP_K = K;
  global.STOMP_SPEC = SPEC;
  global.STOMP_STEP_MS = STEP_MS;
  global.StompSim = Sim;

  /* Fairness / band audit, callable from the console. */
  global.STOMP_audit = function () {
    // Both extremes of the deck: grounded, and the machine's jump apex.
    var lowest = K.MACH_GROUND_Y - K.MACH_HALF_H - K.BALL_R;
    var highest = K.MACH_APEX_Y - K.MACH_HALF_H - K.BALL_R;
    var rows = ['weak', 'normal', 'power'].map(function (k) {
      var arcs = [lowest, highest].map(function (contact) {
        var v = K.bandSpeed(contact, k);
        var apexY = contact - (v * v) / (2 * K.BALL_GRAV);
        return {
          apexY: apexY,
          v: v,
          // full arc: up from this deck height, back down to the grounded deck
          t: v / K.BALL_GRAV + Math.sqrt(2 * (lowest - apexY) / K.BALL_GRAV)
        };
      });
      var shortest = Math.min(arcs[0].t, arcs[1].t);
      // The ball leaves from wherever the machine caught it, so the ground it
      // has to re-cover is the ball's own drift over the arc, minus the ramp
      // the machine spends reaching top speed.
      var reach = K.MACH_SPEED * shortest - 0.5 * K.MACH_SPEED * (K.MACH_SPEED / K.MACH_ACCEL);
      var drift = K.BALL_VX_MAX * shortest;
      return {
        kind: k,
        apexY: [+Math.min(arcs[0].apexY, arcs[1].apexY).toFixed(1),
                +Math.max(arcs[0].apexY, arcs[1].apexY).toFixed(1)],
        launch: [+Math.min(arcs[0].v, arcs[1].v).toFixed(1),
                 +Math.max(arcs[0].v, arcs[1].v).toFixed(1)],
        flightS: +shortest.toFixed(3),
        maxBallDrift: +drift.toFixed(1),
        machineReach: +reach.toFixed(1),
        coversWholeStage: reach > K.W - 2 * K.MACH_HALF_W,
        fair: reach > drift
      };
    });
    return {
      bands: rows,
      lowLaneY: K.LOW_LANE_Y,
      highLaneY: K.HIGH_LANE_Y,
      machineApexY: +K.MACH_APEX_Y.toFixed(1),
      jumpStaysBelowLowLane: K.MACH_APEX_Y - K.MACH_HALF_H > K.LOW_LANE_Y,
      hitboxRatios: {
        machine: 1,
        ball: 1,
        slowFlyer: +(SPEC.slowFlyer.collisionRadius / SPEC.slowFlyer.visualRadius).toFixed(3),
        fastFlyer: +(SPEC.fastFlyer.collisionRadius / SPEC.fastFlyer.visualRadius).toFixed(3),
        walker: +(SPEC.walker.collisionRadius / SPEC.walker.visualRadius).toFixed(3)
      },
      pursuitTimeReward: SPEC.slowFlyer.timeRewards.reduce(function (a, b) { return a + b; }, 0),
      bandOrder: {
        weakBelowLow: K.BAND_APEX.weak > K.LOW_LANE_Y,
        normalBetweenLanes: K.BAND_APEX.normal < K.LOW_LANE_Y &&
                            K.BAND_APEX.normal > K.HIGH_LANE_Y,
        powerAboveHigh: K.BAND_APEX.power < K.HIGH_LANE_Y
      }
    };
  };
})(window);
