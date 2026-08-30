/*
 * STOMP - pure deterministic simulation core.
 * No DOM/window dependency so it can run identically in the browser and
 * under Node for headless verification.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.StompSim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STEP_MS = 1000 / 60;

  var W = 390, H = 844;
  var GROUND_Y = 760;
  var LOW_LANE_Y = 560;
  var HIGH_LANE_Y = 360;

  var MACHINE_RADIUS = 30;
  var BALL_RADIUS = 14;
  var GRAVITY = 1400;
  var MACHINE_GROUNDED_Y = GROUND_Y - MACHINE_RADIUS;
  var JUMP_V0 = 620;
  var MACHINE_APEX_Y = MACHINE_GROUNDED_Y - (JUMP_V0 * JUMP_V0) / (2 * GRAVITY);
  var MACHINE_SPEED = 360;
  var MACHINE_ACCEL = 3600;

  var WEAK_V0 = 420;
  var NORMAL_V0 = 680;
  var POWER_V0 = 1050;
  var BALL_MAX_VX = 200;
  var REBOUND_ENEMY_V0 = 480;
  var BALL_TERMINAL_VY = 950;

  var WALKER_RADIUS = 22;
  var SLOW_FLYER_SPEED = 55;
  var FAST_FLYER_SPEED = 85;
  var WALKER_SPEED = 70;

  var FLYER_VISUAL_R = 26, FLYER_COLLISION_R = 24;
  var WALKER_VISUAL_R = 22, WALKER_COLLISION_R = 21;

  var START_CLOCK_MS = 90000;
  var WRONG_SIDE_PENALTY = 3000;
  var BODY_PENALTY = 2200;
  var BALL_DROP_PENALTY = 6000;

  var HIT_REWARDS = [
    { time: 2200, score: 10 },
    { time: 3600, score: 20 },
    { time: 6200, score: 50 }
  ];
  var STOMP_REWARD = { time: 700, score: 5 };

  var RECENT_EVENTS_MAX = 60;
  var DIFFICULTY_THRESHOLDS = [0, 120, 300, 600];
  var MAX_ACTIVE_FLYERS = 4;

  var BALL_DROP_PAUSE_MS = 500;
  var BALL_DROP_FALL_HEIGHT = 160;
  var BALL_DROP_FALL_VY = 250;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function normalizeSeed(seed) {
    if (seed === undefined || seed === null) seed = 1;
    if (typeof seed === 'number' && isFinite(seed)) {
      var n = Math.floor(Math.abs(seed)) >>> 0;
      return n || 1;
    }
    var s = String(seed);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = h >>> 0;
    return h || 1;
  }

  function nextRand(st) {
    var x = st.rng >>> 0;
    x ^= (x << 13); x >>>= 0;
    x ^= (x >>> 17);
    x ^= (x << 5); x >>>= 0;
    st.rng = x >>> 0;
    return st.rng / 4294967296;
  }

  function randRange(st, lo, hi) { return lo + nextRand(st) * (hi - lo); }

  function rankForScore(score) {
    if (score >= 1000) return 'S';
    if (score >= 600) return 'A';
    if (score >= 300) return 'B';
    if (score >= 100) return 'C';
    return 'D';
  }

  function tierForScore(score) {
    var tier = 1;
    for (var i = 1; i < DIFFICULTY_THRESHOLDS.length; i++) {
      if (score >= DIFFICULTY_THRESHOLDS[i]) tier = i + 1;
    }
    return tier;
  }

  function createSim() {
    var st = null;

    function freshState(seed) {
      var normSeed = normalizeSeed(seed);
      var s = {
        seed: normSeed,
        rng: normSeed,
        phase: 'ready',
        tick: 0,
        elapsedMs: 0,
        remainingMs: START_CLOCK_MS,
        score: 0,
        difficulty: 1,
        _acc: 0,
        nextEnemyId: 1,
        machine: {
          x: W / 2, y: MACHINE_GROUNDED_Y, vx: 0, vy: 0,
          radius: MACHINE_RADIUS, grounded: true, jumpCount: 0
        },
        ball: {
          x: W / 2, y: MACHINE_GROUNDED_Y - MACHINE_RADIUS - BALL_RADIUS,
          vx: 0, vy: 0, radius: BALL_RADIUS, active: true, lastBounceKind: null,
          dropped: false, dropTimer: 0
        },
        enemies: [],
        input: {
          axis: 0, leftKey: false, rightKey: false,
          jumpRequestPending: false
        },
        topHits: 0,
        airEnemiesDefeated: 0,
        wrongSideHits: 0,
        ballDrops: 0,
        longestCleanSequence: 0,
        currentCleanStreak: 0,
        recentEvents: [],
        eventSeq: 0,
        lastEvent: null,
        director: {
          walkerTimer: 12000,
          slowChainId: null,
          slowRespawnTimer: 2200,
          slowLaneToggle: 'low',
          generalTimer: 1500,
          generalPrimed: false
        }
      };
      return s;
    }

    function pushEvent(kind, opts) {
      opts = opts || {};
      st.eventSeq += 1;
      var ev = {
        sequence: st.eventSeq,
        kind: kind,
        tick: st.tick,
        enemyId: opts.enemyId !== undefined ? opts.enemyId : null,
        amountMs: opts.amountMs !== undefined ? opts.amountMs : 0,
        source: opts.source || 'system',
        contact: opts.contact !== undefined ? opts.contact : null
      };
      st.recentEvents.push(ev);
      if (st.recentEvents.length > RECENT_EVENTS_MAX) st.recentEvents.shift();
      st.lastEvent = ev;
      return ev;
    }

    function findEnemy(id) {
      for (var i = 0; i < st.enemies.length; i++) {
        if (st.enemies[i].id === id) return st.enemies[i];
      }
      return null;
    }

    function tierScale(base, per) {
      return base * (1 + per * (st.difficulty - 1));
    }

    function spawnFlyer(type, lane) {
      var id = st.nextEnemyId++;
      var side = nextRand(st) < 0.5 ? -1 : 1;
      var r = FLYER_VISUAL_R;
      var x = side < 0 ? -r - 5 : W + r + 5;
      var baseSpeed = type === 'slowFlyer' ? SLOW_FLYER_SPEED : FAST_FLYER_SPEED;
      var speed = type === 'slowFlyer' ? tierScale(baseSpeed, 0.08) : tierScale(baseSpeed, 0.12);
      var vx = side < 0 ? speed : -speed;
      var laneY = lane === 'low' ? LOW_LANE_Y : HIGH_LANE_Y;
      st.enemies.push({
        id: id, type: type, lane: lane, x: x, y: laneY, baseY: laneY, vx: vx, vy: 0,
        active: true, hitsTaken: 0, hitsRequired: 3,
        visualRadius: FLYER_VISUAL_R, collisionRadius: FLYER_COLLISION_R,
        _overlapMachine: false, _overlapActive: false, deathTimer: 0,
        bobSeed: nextRand(st) * 1000
      });
      return id;
    }

    function spawnWalker() {
      var id = st.nextEnemyId++;
      var side = nextRand(st) < 0.5 ? -1 : 1;
      var x = side < 0 ? -WALKER_RADIUS - 5 : W + WALKER_RADIUS + 5;
      var speed = tierScale(WALKER_SPEED, 0.1);
      var vx = side < 0 ? speed : -speed;
      st.enemies.push({
        id: id, type: 'walker', lane: 'ground', x: x, y: GROUND_Y - WALKER_RADIUS, baseY: GROUND_Y - WALKER_RADIUS,
        vx: vx, vy: 0, active: true, hitsTaken: 0, hitsRequired: 1,
        visualRadius: WALKER_VISUAL_R, collisionRadius: WALKER_COLLISION_R,
        _overlapActive: false, deathTimer: 0, bobSeed: nextRand(st) * 1000
      });
      return id;
    }

    function runDirector(dt) {
      var dir = st.director;

      dir.walkerTimer -= dt;
      if (dir.walkerTimer <= 0) {
        spawnWalker();
        dir.walkerTimer = randRange(st, 9000, 15000) / (1 + 0.12 * (st.difficulty - 1));
      }

      if (st.airEnemiesDefeated === 0) {
        if (dir.slowChainId != null) {
          var e = findEnemy(dir.slowChainId);
          if (!e || !e.active) {
            dir.slowChainId = null;
            dir.slowRespawnTimer = randRange(st, 800, 2000);
          }
        } else {
          dir.slowRespawnTimer -= dt;
          if (dir.slowRespawnTimer <= 0) {
            var lane = dir.slowLaneToggle;
            dir.slowLaneToggle = lane === 'low' ? 'high' : 'low';
            dir.slowChainId = spawnFlyer('slowFlyer', lane);
          }
        }
      } else {
        if (!dir.generalPrimed) { dir.generalPrimed = true; dir.generalTimer = 1500; }
        dir.generalTimer -= dt;
        var activeFlyers = 0;
        for (var i = 0; i < st.enemies.length; i++) {
          if (st.enemies[i].active && st.enemies[i].type !== 'walker') activeFlyers++;
        }
        if (dir.generalTimer <= 0 && activeFlyers < MAX_ACTIVE_FLYERS) {
          var laneChoice = nextRand(st) < 0.5 ? 'low' : 'high';
          var pFast = Math.min(0.25 + 0.15 * st.difficulty, 0.75);
          var type = nextRand(st) < pFast ? 'fastFlyer' : 'slowFlyer';
          spawnFlyer(type, laneChoice);
          var baseInterval = Math.max(1800, 4200 - st.difficulty * 500);
          dir.generalTimer = randRange(st, baseInterval * 0.7, baseInterval * 1.3);
        }
      }
    }

    function registerCleanHit() {
      st.currentCleanStreak += 1;
      if (st.currentCleanStreak > st.longestCleanSequence) {
        st.longestCleanSequence = st.currentCleanStreak;
      }
    }

    function breakCleanStreak() {
      st.currentCleanStreak = 0;
    }

    function applyTimeReward(ms) {
      st.remainingMs = Math.min(START_CLOCK_MS * 4, st.remainingMs + ms);
    }

    function applyTimePenalty(ms) {
      st.remainingMs = Math.max(0, st.remainingMs - ms);
    }

    function updateDifficulty() {
      var t = tierForScore(st.score);
      if (t > st.difficulty) st.difficulty = t;
    }

    function stepMachine(dt) {
      var m = st.machine;
      var inp = st.input;
      var axis = clamp(inp.axis + (inp.rightKey ? 1 : 0) - (inp.leftKey ? 1 : 0), -1, 1);
      var targetVx = axis * MACHINE_SPEED;
      if (m.vx < targetVx) {
        m.vx = Math.min(targetVx, m.vx + MACHINE_ACCEL * dt);
      } else if (m.vx > targetVx) {
        m.vx = Math.max(targetVx, m.vx - MACHINE_ACCEL * dt);
      }

      if (inp.jumpRequestPending) {
        if (m.grounded && m.jumpCount === 0) {
          m.vy = -JUMP_V0;
          m.grounded = false;
          m.jumpCount = 1;
          pushEvent('machine_jump', { source: 'machine', amountMs: 0 });
        }
        inp.jumpRequestPending = false;
      }

      m.x += m.vx * dt;
      m.x = clamp(m.x, MACHINE_RADIUS, W - MACHINE_RADIUS);

      if (!m.grounded) {
        m.vy += GRAVITY * dt;
        m.y += m.vy * dt;
        if (m.y >= MACHINE_GROUNDED_Y && m.vy >= 0) {
          m.y = MACHINE_GROUNDED_Y;
          m.vy = 0;
          m.grounded = true;
          m.jumpCount = 0;
          pushEvent('machine_land', { source: 'machine', amountMs: 0 });
        }
      }
    }

    function respawnBallAboveMachine() {
      var b = st.ball;
      var m = st.machine;
      b.active = true;
      b.dropped = false;
      b.x = m.x;
      b.y = (m.y - MACHINE_RADIUS) - BALL_DROP_FALL_HEIGHT;
      b.vx = 0;
      b.vy = BALL_DROP_FALL_VY;
      b.lastBounceKind = null;
    }

    function stepBall(dt) {
      var b = st.ball;
      var m = st.machine;

      if (b.dropped) {
        b.dropTimer -= dt * 1000;
        if (b.dropTimer <= 0) respawnBallAboveMachine();
        return;
      }
      if (!b.active) return;

      b.vy += GRAVITY * dt;
      if (b.vy > BALL_TERMINAL_VY) b.vy = BALL_TERMINAL_VY;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x < BALL_RADIUS) { b.x = BALL_RADIUS; b.vx = Math.abs(b.vx) * 0.6; }
      if (b.x > W - BALL_RADIUS) { b.x = W - BALL_RADIUS; b.vx = -Math.abs(b.vx) * 0.6; }

      var dx = b.x - m.x, dy = b.y - m.y;
      var distSq = dx * dx + dy * dy;
      var rsum = b.radius + m.radius;
      if (b.vy > 0 && b.y < m.y && distSq <= rsum * rsum) {
        var kind;
        if (!m.grounded && m.vy < -20) kind = 'power';
        else if (m.grounded) kind = 'normal';
        else kind = 'weak';

        var v0 = kind === 'power' ? POWER_V0 : (kind === 'normal' ? NORMAL_V0 : WEAK_V0);
        var offset = clamp(dx / m.radius, -1, 1);
        b.vx = clamp(offset * BALL_MAX_VX * 0.6 + m.vx * 0.6, -BALL_MAX_VX, BALL_MAX_VX);
        b.vy = -v0;
        b.y = m.y - m.radius - b.radius - 0.5;
        b.lastBounceKind = kind;
        pushEvent('ball_bounce_' + kind, { source: 'ball', contact: 'top', amountMs: 0 });
      }

      if (b.y - b.radius >= GROUND_Y) {
        b.dropped = true;
        b.dropTimer = BALL_DROP_PAUSE_MS;
        b.active = false;
        st.ballDrops += 1;
        breakCleanStreak();
        applyTimePenalty(BALL_DROP_PENALTY);
        pushEvent('ball_drop', { source: 'ball', amountMs: -BALL_DROP_PENALTY, contact: null });
      }
    }

    function stepEnemyMovement(dt) {
      var enemies = st.enemies;
      for (var i = enemies.length - 1; i >= 0; i--) {
        var e = enemies[i];
        if (!e.active) {
          e.deathTimer -= dt * 1000;
          if (e.deathTimer <= 0) enemies.splice(i, 1);
          continue;
        }
        e.x += e.vx * dt;
        if (e.type !== 'walker') {
          e.y = e.baseY + Math.sin((st.tick + e.bobSeed) * 0.06) * 4;
        }
        if (e.x < -80 || e.x > W + 80) {
          enemies.splice(i, 1);
        }
      }
    }

    function stepCollisions() {
      var b = st.ball;
      var m = st.machine;
      var enemies = st.enemies;

      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.active) continue;

        if (e.type !== 'walker' && b.active && !b.dropped) {
          var dx = b.x - e.x, dy = b.y - e.y;
          var rsum = b.radius + e.collisionRadius;
          var overlapping = (dx * dx + dy * dy) <= rsum * rsum;
          if (overlapping && !e._overlapActive) {
            var isTop = b.vy > 0 && b.y < e.y;
            if (isTop) {
              e.hitsTaken += 1;
              var reward = HIT_REWARDS[Math.min(e.hitsTaken - 1, HIT_REWARDS.length - 1)];
              applyTimeReward(reward.time);
              st.score += reward.score;
              st.topHits += 1;
              registerCleanHit();
              updateDifficulty();
              b.vy = -REBOUND_ENEMY_V0;
              b.vx = clamp(b.vx * 0.5, -BALL_MAX_VX, BALL_MAX_VX);
              pushEvent('top_hit', { source: 'ball', contact: 'top', enemyId: e.id, amountMs: reward.time });
              if (e.hitsTaken >= e.hitsRequired) {
                e.active = false;
                e.deathTimer = 500;
                st.airEnemiesDefeated += 1;
                pushEvent('enemy_defeated', { source: 'ball', contact: 'top', enemyId: e.id, amountMs: 0 });
              }
            } else {
              st.wrongSideHits += 1;
              breakCleanStreak();
              applyTimePenalty(WRONG_SIDE_PENALTY);
              pushEvent('wrong_side_hit', { source: 'ball', contact: 'non_top', enemyId: e.id, amountMs: -WRONG_SIDE_PENALTY });
            }
          }
          e._overlapActive = overlapping;
        }

        if (e.type === 'walker') {
          var mdx = m.x - e.x, mdy = m.y - e.y;
          var mrsum = m.radius + e.collisionRadius;
          var mOverlap = (mdx * mdx + mdy * mdy) <= mrsum * mrsum;
          if (mOverlap && !e._overlapMachine) {
            var isStomp = !m.grounded && m.vy > 0 && m.y < e.y;
            if (isStomp) {
              e.active = false;
              e.deathTimer = 500;
              applyTimeReward(STOMP_REWARD.time);
              st.score += STOMP_REWARD.score;
              updateDifficulty();
              m.vy = -260;
              pushEvent('ground_stomp', { source: 'machine', contact: 'top', enemyId: e.id, amountMs: STOMP_REWARD.time });
            } else {
              breakCleanStreak();
              applyTimePenalty(BODY_PENALTY);
              pushEvent('wrong_side_hit', { source: 'machine', contact: 'body', enemyId: e.id, amountMs: -BODY_PENALTY });
            }
          }
          e._overlapMachine = mOverlap;
        }
      }
    }

    function stepOnce() {
      st.tick += 1;
      st.elapsedMs += STEP_MS;
      var dt = STEP_MS / 1000;

      st.remainingMs = Math.max(0, st.remainingMs - STEP_MS);

      stepMachine(dt);
      stepBall(dt);
      stepEnemyMovement(dt);
      stepCollisions();
      runDirector(STEP_MS);

      if (st.remainingMs <= 0) {
        st.remainingMs = 0;
        st.phase = 'ended';
      }
    }

    function inputIndicatesStart() {
      var inp = st.input;
      return inp.axis !== 0 || inp.leftKey || inp.rightKey || inp.jumpRequestPending;
    }

    function reset(seed) {
      st = freshState(seed);
      return snapshot();
    }

    function advance(ms) {
      if (!st) return snapshot();
      if (st.phase === 'ready') {
        if (inputIndicatesStart()) {
          st.phase = 'playing';
        } else {
          return snapshot();
        }
      }
      if (st.phase !== 'playing') return snapshot();
      if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return snapshot();

      st._acc += ms;
      var guard = 0;
      while (st._acc >= STEP_MS && st.phase === 'playing') {
        stepOnce();
        st._acc -= STEP_MS;
        guard++;
        if (guard > 1000000) break;
      }
      return snapshot();
    }

    function setAxis(v) {
      if (!st) return;
      st.input.axis = clamp(v, -1, 1);
    }

    function setKey(name, val) {
      if (!st) return;
      if (name === 'left') st.input.leftKey = !!val;
      else if (name === 'right') st.input.rightKey = !!val;
    }

    function queueJump() {
      if (!st) return;
      st.input.jumpRequestPending = true;
    }

    function snapshot() {
      if (!st) return null;
      var enemiesOut = st.enemies.slice().sort(function (a, b) { return a.id - b.id; }).map(function (e) {
        return {
          id: e.id, type: e.type, lane: e.lane, x: e.x, y: e.y, vx: e.vx,
          active: e.active, hitsTaken: e.hitsTaken, hitsRequired: e.hitsRequired,
          visualRadius: e.visualRadius, collisionRadius: e.collisionRadius
        };
      });
      return {
        phase: st.phase,
        tick: st.tick,
        elapsedMs: st.elapsedMs,
        remainingMs: st.remainingMs,
        seed: st.seed,
        rngState: st.rng,
        score: st.score,
        difficulty: st.difficulty,
        rank: rankForScore(st.score),
        input: {
          x: clamp(st.input.axis + (st.input.rightKey ? 1 : 0) - (st.input.leftKey ? 1 : 0), -1, 1),
          left: st.input.leftKey, right: st.input.rightKey,
          jumpQueued: st.input.jumpRequestPending
        },
        groundY: GROUND_Y, lowLaneY: LOW_LANE_Y, highLaneY: HIGH_LANE_Y,
        machineNormalApexY: MACHINE_APEX_Y,
        machine: {
          x: st.machine.x, y: st.machine.y, vx: st.machine.vx, vy: st.machine.vy,
          radius: st.machine.radius, grounded: st.machine.grounded, jumpCount: st.machine.jumpCount
        },
        ball: {
          x: st.ball.x, y: st.ball.y, vx: st.ball.vx, vy: st.ball.vy,
          radius: st.ball.radius, active: st.ball.active && !st.ball.dropped,
          lastBounceKind: st.ball.lastBounceKind
        },
        topHits: st.topHits,
        airEnemiesDefeated: st.airEnemiesDefeated,
        wrongSideHits: st.wrongSideHits,
        ballDrops: st.ballDrops,
        longestCleanSequence: st.longestCleanSequence,
        enemies: enemiesOut,
        recentEvents: st.recentEvents.slice(),
        lastEvent: st.lastEvent
      };
    }

    return {
      reset: reset,
      advance: advance,
      snapshot: snapshot,
      setAxis: setAxis,
      setKey: setKey,
      queueJump: queueJump
    };
  }

  return {
    create: createSim,
    constants: {
      W: W, H: H, GROUND_Y: GROUND_Y, LOW_LANE_Y: LOW_LANE_Y, HIGH_LANE_Y: HIGH_LANE_Y,
      MACHINE_RADIUS: MACHINE_RADIUS, BALL_RADIUS: BALL_RADIUS,
      MACHINE_GROUNDED_Y: MACHINE_GROUNDED_Y, MACHINE_APEX_Y: MACHINE_APEX_Y,
      START_CLOCK_MS: START_CLOCK_MS, STEP_MS: STEP_MS
    }
  };
});
