/* STOMP — deterministic simulation core.
 * World Y increases DOWNWARD. groundY is the largest meaningful Y.
 * Nothing in this file knows about pixels, canvases or effects. */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- geometry */
  var W = 360, H = 640;
  var GROUND_Y = 574;
  var MACHINE_HALF_W = 22;
  var MACHINE_HALF_H = 20;
  var MACHINE_REST_Y = GROUND_Y - MACHINE_HALF_H;      // 554
  var LOW_LANE_Y = 330;
  var HIGH_LANE_Y = 196;

  /* ---------------------------------------------------------------- dynamics */
  var G = 600;
  var MACHINE_SPEED = 400;
  var ACC_GROUND = 3200;
  var ACC_AIR = 1400;
  var JUMP_RISE = 120;                                  // apex stays far below the low lane
  var JUMP_V = Math.sqrt(2 * G * JUMP_RISE);
  var MACHINE_APEX_Y = MACHINE_REST_Y - JUMP_RISE;      // 434

  var BALL_R = 10;
  /* The three return bands are ABSOLUTE apex heights, not impulses, so the band
     a contact belongs to always reads the same in the world no matter how high
     off the ground the machine met the ball.
        low lane band  309..351      high lane band  175..217
        weak  apex 372 -> ball top 362, just under the low lane
        normal apex 274 -> clears the low lane, stays under the high lane
        power apex 134 -> clears the high lane                                */
  var APEX_WEAK = 372;
  var APEX_NORMAL = 274;
  var APEX_POWER = 134;
  var WEAK_RISE_CAP = 110;
  var BALL_VX_MAX = 130;
  var BALL_RESPAWN_Y = 280;

  /* ---------------------------------------------------------------- economy  */
  var STEP_MS = 1000 / 60;
  var START_MS = 80000;   // a first run must outlast a minute of pure returning
  var MAX_MS = 95000;
  var HIT_TIME = [1600, 2400, 3400];   // strictly increasing
  var HIT_SCORE = [120, 200, 400];
  var DEFEAT_TIME = 2600;              // pursuit total = 10.0s of clock
  var DEFEAT_SCORE = 300;
  var WRONG_TIME = -4000;
  var DROP_TIME = -6000;
  var BITE_TIME = -3000;
  var STOMP_TIME = 600;
  var STOMP_SCORE = 60;

  var TIER_SCORES = [0, 1000, 2400, 4200, 6500, 9500];
  var RANKS = [
    [0, 'SCRAP'], [900, 'BOLT'], [2400, 'SPARK'],
    [4500, 'SURGE'], [7200, 'NOVA'], [11000, 'STOMP']
  ];
  var EVENT_LIMIT = 48;

  /* ---------------------------------------------------------------- helpers  */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function hashSeed(seed) {
    if (seed === undefined || seed === null) return null;
    if (typeof seed === 'number' && isFinite(seed)) return (Math.floor(seed) | 0) >>> 0;
    var s = String(seed), h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function rankFor(score) {
    var name = RANKS[0][1];
    for (var i = 0; i < RANKS.length; i++) if (score >= RANKS[i][0]) name = RANKS[i][1];
    return name;
  }

  function tierFor(score) {
    var t = 0;
    for (var i = 0; i < TIER_SCORES.length; i++) if (score >= TIER_SCORES[i]) t = i;
    return t;
  }

  /* ================================================================ Sim ==== */
  function Sim(seed) {
    this.defaultSeed = hashSeed(seed) === null ? 20260826 : hashSeed(seed);
    this.reset(this.defaultSeed);
  }

  Sim.prototype.reset = function (seed) {
    var s = hashSeed(seed);
    this.seed = s === null ? (this.seed === undefined ? this.defaultSeed : this.seed) : s;
    this._rngA = this.seed | 0;

    this.phase = 'ready';
    this.tick = 0;
    this.elapsedMs = 0;
    this.remainingMs = START_MS;
    this.score = 0;
    this.difficulty = 0;
    this.accumulator = 0;

    this.machine = {
      x: W / 2, y: MACHINE_REST_Y, vx: 0, vy: 0,
      radius: MACHINE_HALF_W, grounded: true, jumpCount: 0
    };
    this.ball = {
      x: W / 2, y: MACHINE_REST_Y - MACHINE_HALF_H - BALL_R, vx: 0, vy: 0,
      radius: BALL_R, active: true, lastBounceKind: null
    };
    this.input = { axis: 0, left: false, right: false, jump: false };
    this._jumpBuffer = 0;
    this._lastBounceTick = -99;
    this._prevMachineY = MACHINE_REST_Y;
    this._prevMachineTop = MACHINE_REST_Y - MACHINE_HALF_H;

    this.topHits = 0;
    this.airEnemiesDefeated = 0;
    this.wrongSideHits = 0;
    this.ballDrops = 0;
    this.longestCleanSequence = 0;
    this._cleanSequence = 0;

    this.enemies = [];
    this._nextId = 1;
    this.recentEvents = [];
    this.lastEvent = null;
    this._sequence = 0;

    /* director */
    this.pendingAir = { type: 'slowFlyer', lane: 'low', dir: this.rng() < 0.5 ? 1 : -1, at: 500 };
    this.airSpawnCount = 0;
    this.lastAirLane = 'high';
    this.nextWalkerAt = 20000;   // the ball game gets the opening to itself
    return this;
  };

  /* mulberry32 with an inspectable state word */
  Sim.prototype.rng = function () {
    var a = (this._rngA + 0x6D2B79F5) | 0;
    this._rngA = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Sim.prototype.range = function (lo, hi) { return lo + this.rng() * (hi - lo); };

  /* ------------------------------------------------------------- events ---- */
  Sim.prototype.emit = function (kind, opts) {
    opts = opts || {};
    this._sequence++;
    var ev = {
      sequence: this._sequence,
      kind: kind,
      tick: this.tick,
      enemyId: opts.enemyId === undefined ? null : opts.enemyId,
      amountMs: opts.amountMs === undefined ? 0 : opts.amountMs,
      source: opts.source || 'system',
      contact: opts.contact === undefined ? null : opts.contact
    };
    this.recentEvents.push(ev);
    if (this.recentEvents.length > EVENT_LIMIT) this.recentEvents.shift();
    this.lastEvent = ev;
    return ev;
  };

  /* ------------------------------------------------------------- input ----- */
  Sim.prototype.setAxis = function (axis) {
    axis = clamp(Number(axis) || 0, -1, 1);
    if (this.phase === 'ended') { this.input.axis = 0; this.input.left = false; this.input.right = false; return; }
    if (this.phase === 'ready' && axis !== 0) this.startRun();
    this.input.axis = axis;
    this.input.left = axis < -0.02;
    this.input.right = axis > 0.02;
  };

  Sim.prototype.pressJump = function () {
    if (this.phase === 'ended') return;
    if (this.phase === 'ready') this.startRun();
    this._jumpBuffer = 9;                 // ~150ms of forgiveness, deterministic in ticks
    this.input.jump = true;
  };

  Sim.prototype.startRun = function () {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';
    this.emit('run_start', { source: 'system' });
  };

  Sim.prototype.endRun = function () {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.remainingMs = 0;
    this.input.axis = 0; this.input.left = false; this.input.right = false;
    this.emit('run_end', { source: 'system' });
  };

  /* ------------------------------------------------------------- economy --- */
  Sim.prototype.addTime = function (ms) {
    this.remainingMs = clamp(this.remainingMs + ms, 0, MAX_MS);
    if (this.remainingMs <= 0) this.endRun();
  };

  Sim.prototype.addScore = function (n) {
    this.score += n;
    var t = tierFor(this.score);
    if (t > this.difficulty) this.difficulty = t;   // nondecreasing
  };

  Sim.prototype.noteClean = function () {
    this._cleanSequence++;
    if (this._cleanSequence > this.longestCleanSequence) this.longestCleanSequence = this._cleanSequence;
  };
  Sim.prototype.breakClean = function () { this._cleanSequence = 0; };

  /* ------------------------------------------------------------- stepping -- */
  Sim.prototype.advance = function (ms) {
    ms = Number(ms);
    if (!isFinite(ms) || ms <= 0) return;
    if (this.phase !== 'playing') return;            // frozen before first input / after the clock empties
    this.accumulator += ms;
    var guard = 0;
    while (this.accumulator >= STEP_MS && this.phase === 'playing' && guard++ < 200000) {
      this.accumulator -= STEP_MS;
      this.step();
    }
    if (this.phase !== 'playing') this.accumulator = 0;
  };

  Sim.prototype.step = function () {
    var dt = 1 / 60;
    this.tick++;
    this.elapsedMs = this.tick * STEP_MS;

    this.stepMachine(dt);
    this.stepBall(dt);
    this.stepEnemies(dt);
    this.collideBallEnemies();
    this.collideMachineWalkers();
    this.stepDirector();

    this.remainingMs -= STEP_MS;
    if (this.remainingMs <= 0) { this.remainingMs = 0; this.endRun(); }
  };

  Sim.prototype.stepMachine = function (dt) {
    var m = this.machine;
    this._prevMachineY = m.y;
    this._prevMachineTop = m.y - MACHINE_HALF_H;

    var acc = (m.grounded ? ACC_GROUND : ACC_AIR) * dt;
    var target = this.input.axis * MACHINE_SPEED;
    var d = target - m.vx;
    m.vx += clamp(d, -acc, acc);
    m.x += m.vx * dt;
    if (m.x < MACHINE_HALF_W) { m.x = MACHINE_HALF_W; if (m.vx < 0) m.vx = 0; }
    if (m.x > W - MACHINE_HALF_W) { m.x = W - MACHINE_HALF_W; if (m.vx > 0) m.vx = 0; }

    if (this._jumpBuffer > 0) this._jumpBuffer--;
    this.input.jump = this._jumpBuffer > 0;

    if (this._jumpBuffer > 0 && m.grounded) {
      this._jumpBuffer = 0;
      this.input.jump = false;
      m.vy = -JUMP_V;
      m.grounded = false;
      m.jumpCount = 1;
      this.emit('machine_jump', { source: 'machine' });
    }

    if (!m.grounded) {
      m.vy += G * dt;
      m.y += m.vy * dt;
      if (m.y >= MACHINE_REST_Y) {
        m.y = MACHINE_REST_Y; m.vy = 0; m.grounded = true; m.jumpCount = 0;
        this.emit('machine_land', { source: 'machine' });
      }
    }
  };

  Sim.prototype.stepBall = function (dt) {
    var b = this.ball, m = this.machine;
    var prevBottom = b.y + b.radius;

    b.vy += G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - b.radius < 0) { b.x = b.radius; b.vx = Math.abs(b.vx) * 0.94; }
    else if (b.x + b.radius > W) { b.x = W - b.radius; b.vx = -Math.abs(b.vx) * 0.94; }
    if (b.y - b.radius < 0) { b.y = b.radius; b.vy = Math.abs(b.vy) * 0.5; }

    /* machine top surface — relative crossing test so a rising machine still catches */
    var topY = m.y - MACHINE_HALF_H;
    var dx = b.x - m.x;
    /* kept inside the drawn silhouette: the catch span is 24 against a body
       that is drawn 25 half-wide and a reported radius of 22 */
    var withinSpan = Math.abs(dx) <= MACHINE_HALF_W + b.radius * 0.2;
    var wasAbove = (prevBottom - this._prevMachineTop) <= 0.0001;
    var nowThrough = (b.y + b.radius - topY) >= 0;
    var settled = (this.tick - this._lastBounceTick) > 2;   // backstop against contact bursts
    if (withinSpan && wasAbove && nowThrough && settled) {
      this.bounceOffMachine(dx);
      return;
    }

    /* side of the body: nudge out, no penalty */
    if (Math.abs(dx) < MACHINE_HALF_W + b.radius &&
        b.y > topY && b.y < m.y + MACHINE_HALF_H) {
      var push = (MACHINE_HALF_W + b.radius) - Math.abs(dx);
      b.x += dx >= 0 ? push : -push;
      b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
      b.x = clamp(b.x, b.radius, W - b.radius);
    }

    if (b.y + b.radius >= GROUND_Y) this.dropBall();
  };

  Sim.prototype.bounceOffMachine = function (dx) {
    var b = this.ball, m = this.machine;
    var edge = Math.abs(dx) > MACHINE_HALF_W * 0.80;   // a late, off-centre catch
    var kind;
    /* Rising is tested FIRST, and unconditionally.  Two reasons: the brief says a
       contact while the machine is rising is the power return, and it also keeps
       the outgoing ball strictly faster than the plate underneath it.  A rising
       machine that produced a slow weak return could overtake its own ball on the
       next tick and bounce it again, spraying duplicate contacts. */
    if (!m.grounded && m.vy < -20) kind = 'power';
    else if (m.vy > 20 || edge) kind = 'weak';
    else kind = 'normal';

    var contactY = (m.y - MACHINE_HALF_H) - b.radius;
    var apex;
    if (kind === 'weak') apex = Math.max(APEX_WEAK, contactY - WEAK_RISE_CAP);
    else if (kind === 'normal') apex = APEX_NORMAL;
    else apex = APEX_POWER;
    var rise = Math.max(6, contactY - apex);

    b.y = contactY;
    b.vy = -Math.sqrt(2 * G * rise);
    b.vx = clamp(dx * 4.6 + m.vx * 0.30 + b.vx * 0.12, -BALL_VX_MAX, BALL_VX_MAX);
    b.lastBounceKind = kind;
    this._lastBounceTick = this.tick;
    this.emit('ball_bounce_' + kind, { source: 'ball', contact: 'top' });
  };

  Sim.prototype.dropBall = function () {
    var b = this.ball;
    this.ballDrops++;
    this.breakClean();
    this.emit('ball_drop', { source: 'ball', amountMs: DROP_TIME });
    this.addTime(DROP_TIME);

    b.x = clamp(this.machine.x, 44, W - 44);
    b.y = BALL_RESPAWN_Y;
    b.vx = 0; b.vy = 0;
    b.lastBounceKind = null;
    for (var i = 0; i < this.enemies.length; i++) this.enemies[i].contactState = 0;
  };

  /* ------------------------------------------------------------- enemies --- */
  Sim.prototype.spawnFlyer = function (type, lane, dir) {
    var laneY = lane === 'high' ? HIGH_LANE_Y : LOW_LANE_Y;
    var vr = 21, cr = 20;
    var base = type === 'fastFlyer'
      ? Math.min(118, 88 + this.difficulty * 6)
      : Math.min(60, 44 + this.difficulty * 3);
    var e = {
      id: this._nextId++, type: type, lane: lane,
      x: dir > 0 ? -vr - 8 : W + vr + 8, y: laneY,
      vx: dir * base, dir: dir, baseSpeed: base, speedMul: 1,
      active: true, hitsTaken: 0, hitsRequired: 3,
      visualRadius: vr, collisionRadius: cr,
      contactState: 0, deadTimer: 0, spawnTick: this.tick
    };
    this.enemies.push(e);
    this.lastAirLane = lane;
    return e;
  };

  Sim.prototype.spawnWalker = function (dir) {
    var vr = 15;
    var base = Math.min(96, 58 + this.difficulty * 6);
    var e = {
      id: this._nextId++, type: 'walker', lane: 'ground',
      x: dir > 0 ? -vr - 8 : W + vr + 8, y: GROUND_Y - vr,
      vx: dir * base, dir: dir, baseSpeed: base, speedMul: 1,
      active: true, hitsTaken: 0, hitsRequired: 1,
      visualRadius: vr, collisionRadius: 14,
      contactState: 0, deadTimer: 0, spawnTick: this.tick
    };
    this.enemies.push(e);
    return e;
  };

  Sim.prototype.stepEnemies = function (dt) {
    for (var i = this.enemies.length - 1; i >= 0; i--) {
      var e = this.enemies[i];
      if (!e.active) {
        e.deadTimer -= dt;
        if (e.deadTimer <= 0) this.enemies.splice(i, 1);
        continue;
      }
      e.vx = e.dir * e.baseSpeed * e.speedMul;
      e.x += e.vx * dt;
      if (e.x < -90 || e.x > W + 90) this.enemies.splice(i, 1);
    }
  };

  Sim.prototype.collideBallEnemies = function () {
    var b = this.ball;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.active) continue;
      var dx = b.x - e.x, dy = b.y - e.y;
      var rr = b.radius + e.collisionRadius;
      var overlapping = (dx * dx + dy * dy) < rr * rr;
      if (!overlapping) { e.contactState = 0; continue; }
      if (e.contactState === 1) continue;
      e.contactState = 1;

      var fromTop = b.vy > 0 && (e.y - b.y) > e.collisionRadius * 0.30;
      if (e.lane === 'ground') {
        if (fromTop) this.ballStompWalker(e);
        else e.contactState = 0;                 // walkers are the machine's problem, not the ball's
      } else if (fromTop) {
        this.topHit(e);
      } else {
        this.wrongSide(e, dx, dy);
      }
    }
  };

  Sim.prototype.topHit = function (e) {
    var b = this.ball;
    e.hitsTaken++;
    this.topHits++;
    this.noteClean();

    var idx = Math.min(e.hitsTaken, 3) - 1;
    this.emit('top_hit', { enemyId: e.id, amountMs: HIT_TIME[idx], source: 'ball', contact: 'top' });
    this.addTime(HIT_TIME[idx]);
    this.addScore(HIT_SCORE[idx]);

    /* Rebound: a sharp pop that leaves the lane, then a long readable fall back
       to the machine.  A low-lane rebound is capped so a success never throws
       the ball up through the high lane into an underside it cannot see. */
    var contactY = e.y - e.collisionRadius - b.radius;
    var apex = contactY - 165;
    apex = e.lane === 'low' ? Math.max(apex, 236) : Math.max(apex, 108);
    var rise = Math.max(40, contactY - apex);
    b.y = contactY - 0.5;
    b.vy = -Math.sqrt(2 * G * rise);
    b.vx = clamp(b.vx * 0.85 + (b.x - e.x) * 1.2, -BALL_VX_MAX, BALL_VX_MAX);
    b.lastBounceKind = null;

    if (e.hitsTaken >= e.hitsRequired) {
      e.active = false;
      e.deadTimer = 0.8;
      this.airEnemiesDefeated++;
      this.emit('enemy_defeated', { enemyId: e.id, amountMs: DEFEAT_TIME, source: 'ball', contact: 'top' });
      this.addTime(DEFEAT_TIME);
      this.addScore(DEFEAT_SCORE);
      if (this.pendingAir) this.pendingAir.at = Math.max(this.pendingAir.at, this.elapsedMs + 1500);
    } else {
      e.speedMul = e.type === 'fastFlyer'
        ? [1, 0.65, 0.42][e.hitsTaken]
        : [1, 0.78, 0.55][e.hitsTaken];
    }
  };

  Sim.prototype.wrongSide = function (e, dx, dy) {
    var b = this.ball;
    this.wrongSideHits++;
    this.breakClean();
    this.emit('wrong_side_hit', { enemyId: e.id, amountMs: WRONG_TIME, source: 'ball', contact: 'non_top' });
    this.addTime(WRONG_TIME);

    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / len, ny = dy / len;
    var rr = b.radius + e.collisionRadius;
    b.x = clamp(e.x + nx * (rr + 1), b.radius, W - b.radius);
    b.y = e.y + ny * (rr + 1);
    b.vx = clamp(b.vx * 0.3 + nx * 70, -BALL_VX_MAX, BALL_VX_MAX);
    b.vy = b.vy * 0.35 + ny * 90;
    b.lastBounceKind = null;
  };

  Sim.prototype.ballStompWalker = function (e) {
    var b = this.ball;
    e.active = false; e.deadTimer = 0.6;
    this.emit('ground_stomp', { enemyId: e.id, amountMs: STOMP_TIME, source: 'ball', contact: 'top' });
    this.addTime(STOMP_TIME);
    this.addScore(STOMP_SCORE);
    b.y = e.y - e.collisionRadius - b.radius - 0.5;
    b.vy = -Math.sqrt(2 * G * 150);
  };

  Sim.prototype.collideMachineWalkers = function () {
    var m = this.machine;
    var bottom = m.y + MACHINE_HALF_H;
    var prevBottom = this._prevMachineY + MACHINE_HALF_H;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.active || e.lane !== 'ground') continue;
      var dx = Math.abs(m.x - e.x);
      if (dx > MACHINE_HALF_W + e.collisionRadius) { e.contactState = 0; continue; }

      var top = e.y - e.collisionRadius;
      if (m.vy > 0 && prevBottom <= top + 4 && bottom >= top) {
        e.active = false; e.deadTimer = 0.6;
        this.emit('ground_stomp', { enemyId: e.id, amountMs: STOMP_TIME, source: 'machine', contact: 'top' });
        this.addTime(STOMP_TIME);
        this.addScore(STOMP_SCORE);
        m.vy = -Math.sqrt(2 * G * 55);
        m.grounded = false;
        continue;
      }
      if (bottom > top + 4 && e.contactState === 0) {
        e.contactState = 1;
        e.active = false; e.deadTimer = 0.5;
        this.emit('walker_bite', { enemyId: e.id, amountMs: BITE_TIME, source: 'machine', contact: 'body' });
        this.addTime(BITE_TIME);
      }
    }
  };

  /* ------------------------------------------------------------- director -- */
  Sim.prototype.countActiveAir = function () {
    var n = 0;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.active && e.lane !== 'ground') n++;
    }
    return n;
  };
  Sim.prototype.countActiveWalkers = function () {
    var n = 0;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.active && e.lane === 'ground') n++;
    }
    return n;
  };

  Sim.prototype.planAir = function (delayMs) {
    var opening = this.airEnemiesDefeated === 0;
    var type, lane;
    if (opening) {
      type = 'slowFlyer';
      /* first low, then high, then alternate — both lanes are promised early */
      if (this.airSpawnCount === 0) lane = 'low';
      else if (this.airSpawnCount === 1) lane = 'high';
      else lane = this.lastAirLane === 'low' ? 'high' : 'low';
    } else {
      var fastChance = [0.18, 0.32, 0.45, 0.55, 0.62, 0.68][this.difficulty] || 0.68;
      type = this.rng() < fastChance ? 'fastFlyer' : 'slowFlyer';
      lane = this.rng() < 0.5 ? 'low' : 'high';
    }
    var dir = this.rng() < 0.5 ? 1 : -1;
    this.pendingAir = { type: type, lane: lane, dir: dir, at: this.elapsedMs + delayMs };
  };

  Sim.prototype.stepDirector = function () {
    var now = this.elapsedMs;
    var opening = this.airEnemiesDefeated === 0;
    var tier = this.difficulty;

    if (this.pendingAir && now >= this.pendingAir.at) {
      var cap = opening ? 2 : (tier >= 3 ? 3 : 2);
      if (this.countActiveAir() < cap) {
        var p = this.pendingAir;
        this.spawnFlyer(p.type, p.lane, p.dir);
        this.airSpawnCount++;
        this.pendingAir = null;

        if (opening) {
          /* the low lane opens the show; the high lane follows a few returns later,
             then the stage keeps a slow target alive until the first destruction */
          this.planAir(this.airSpawnCount === 1 ? 4800 : 1400);
        } else {
          var lo = [4.4, 3.9, 3.4, 3.0, 2.8, 2.6][tier] || 2.6;
          var hi = [6.0, 5.4, 4.8, 4.4, 4.0, 3.8][tier] || 3.8;
          var delay = this.range(lo, hi) * 1000;
          if (this.airSpawnCount % 5 === 0) delay *= 1.7;      // a breather between peaks
          this.planAir(delay);
          if (tier >= 2 && this.rng() < 0.35) {
            this.nextWalkerAt = Math.min(this.nextWalkerAt, now + 900);  // divide attention
          }
        }
      } else {
        this.pendingAir.at = now + 700;
      }
    }

    if (now >= this.nextWalkerAt) {
      var wcap = opening ? 1 : (tier >= 3 ? 2 : 1);
      if (this.countActiveWalkers() < wcap) {
        this.spawnWalker(this.rng() < 0.5 ? 1 : -1);
        var wlo = opening ? 12 : Math.max(4.5, 9 - tier * 0.8);
        var whi = opening ? 18 : Math.max(7.0, 14 - tier * 1.2);
        this.nextWalkerAt = now + this.range(wlo, whi) * 1000;
      } else {
        this.nextWalkerAt = now + 900;
      }
    }
  };

  /* ------------------------------------------------------------- snapshot -- */
  function copyEvent(e) {
    return {
      sequence: e.sequence, kind: e.kind, tick: e.tick, enemyId: e.enemyId,
      amountMs: e.amountMs, source: e.source, contact: e.contact
    };
  }

  Sim.prototype.snapshot = function () {
    var m = this.machine, b = this.ball;
    var enemies = this.enemies.slice().sort(function (p, q) { return p.id - q.id; }).map(function (e) {
      return {
        id: e.id, type: e.type, lane: e.lane, x: e.x, y: e.y, vx: e.active ? e.vx : 0,
        active: e.active, hitsTaken: e.hitsTaken, hitsRequired: e.hitsRequired,
        visualRadius: e.visualRadius, collisionRadius: e.collisionRadius
      };
    });
    var events = [];
    for (var i = 0; i < this.recentEvents.length; i++) events.push(copyEvent(this.recentEvents[i]));
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      remainingMs: this.remainingMs,
      seed: this.seed,
      rngState: this._rngA >>> 0,
      score: this.score,
      difficulty: this.difficulty,
      rank: rankFor(this.score),
      input: { axis: this.input.axis, left: this.input.left, right: this.input.right, jump: this.input.jump },
      groundY: GROUND_Y,
      lowLaneY: LOW_LANE_Y,
      highLaneY: HIGH_LANE_Y,
      machineNormalApexY: MACHINE_APEX_Y,
      machine: {
        x: m.x, y: m.y, vx: m.vx, vy: m.vy, radius: m.radius,
        grounded: m.grounded, jumpCount: m.jumpCount
      },
      ball: {
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, radius: b.radius,
        active: b.active, lastBounceKind: b.lastBounceKind
      },
      topHits: this.topHits,
      airEnemiesDefeated: this.airEnemiesDefeated,
      wrongSideHits: this.wrongSideHits,
      ballDrops: this.ballDrops,
      longestCleanSequence: this.longestCleanSequence,
      enemies: enemies,
      recentEvents: events,
      lastEvent: this.lastEvent ? copyEvent(this.lastEvent) : null
    };
  };

  Sim.CONST = {
    W: W, H: H, GROUND_Y: GROUND_Y, LOW_LANE_Y: LOW_LANE_Y, HIGH_LANE_Y: HIGH_LANE_Y,
    MACHINE_HALF_W: MACHINE_HALF_W, MACHINE_HALF_H: MACHINE_HALF_H,
    MACHINE_REST_Y: MACHINE_REST_Y, MACHINE_APEX_Y: MACHINE_APEX_Y,
    START_MS: START_MS, MAX_MS: MAX_MS, STEP_MS: STEP_MS, G: G,
    BALL_R: BALL_R, TIER_SCORES: TIER_SCORES, RANKS: RANKS
  };
  Sim.rankFor = rankFor;

  global.StompSim = Sim;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
