/**
 * STOMP — deterministic simulation (60 Hz).
 * World Y increases upward. Renderers must honor groundY / lane Y.
 */
(function (root) {
  "use strict";

  const STEP_MS = 1000 / 60;
  const WORLD_W = 360;
  const WORLD_H = 640;
  const GROUND_Y = 118;
  const LOW_LANE_Y = 308;
  const HIGH_LANE_Y = 454;
  const MACHINE_R = 16;
  const BALL_R = 11;
  const PAD_HALF = 20;
  const MAX_SPEED = 308;
  const GRAVITY = 900;
  const JUMP_HEIGHT = 78;
  const JUMP_VEL = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
  const MACHINE_GROUNDED_Y = GROUND_Y + MACHINE_R;
  const MACHINE_NORMAL_APEX_Y = MACHINE_GROUNDED_Y + JUMP_HEIGHT;
  const BALL_VX_MAX = 205;
  const START_MS = 90000;
  const DROP_PENALTY = 8000;
  const WRONG_PENALTY = 4200;
  const BODY_PENALTY = 2400;
  const STOMP_TIME = 400;
  const STOMP_SCORE = 80;
  const HIT_TIME = [0, 3000, 5000, 11000];
  const HIT_SCORE = [0, 150, 320, 900];
  const BOUNCE_VY = { weak: 392, normal: 602, power: 808 };
  const JUMP_BUFFER_TICKS = 8;
  const EVENT_CAP = 96;
  const INACTIVE_KEEP_TICKS = 96;
  const AXIS_DEAD = 0.18;
  const RECOVER_LIFT = 46;

  const BOUNDS = Object.freeze({
    STEP_MS,
    WORLD_W,
    WORLD_H,
    GROUND_Y,
    LOW_LANE_Y,
    HIGH_LANE_Y,
    MACHINE_R,
    BALL_R,
    MACHINE_GROUNDED_Y,
    MACHINE_NORMAL_APEX_Y,
  });

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function createRng(seed) {
    let s = (seed >>> 0) || 0xA341316C;
    return {
      get state() {
        return s >>> 0;
      },
      set state(v) {
        s = v >>> 0;
      },
      next() {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
      },
      signed() {
        return this.next() < 0.5 ? -1 : 1;
      },
      range(a, b) {
        return a + (b - a) * this.next();
      },
    };
  }

  function rankFromScore(score) {
    if (score >= 9000) return "SS";
    if (score >= 5800) return "S";
    if (score >= 3400) return "A";
    if (score >= 1700) return "B";
    if (score >= 600) return "C";
    return "D";
  }

  function difficultyFrom(score, firstAirDefeated) {
    if (!firstAirDefeated) return 0;
    if (score >= 7200) return 4;
    if (score >= 4200) return 3;
    if (score >= 2200) return 2;
    return 1;
  }

  function emptyInput() {
    return { left: false, right: false, jump: false, axis: 0 };
  }

  function wantsStart(state) {
    const i = state.input;
    if (i.jump || state.jumpQueued) return true;
    if (i.left || i.right) return true;
    if (Math.abs(i.axis) >= AXIS_DEAD) return true;
    return false;
  }

  function moveAxis(state) {
    const i = state.input;
    let m = 0;
    if (i.left) m -= 1;
    if (i.right) m += 1;
    const a = i.axis || 0;
    if (Math.abs(a) >= AXIS_DEAD) m += a;
    return clamp(m, -1, 1);
  }

  function pushEvent(state, kind, extra) {
    state.eventSeq += 1;
    const ev = {
      sequence: state.eventSeq,
      kind: kind,
      tick: state.tick,
      enemyId: extra && extra.enemyId != null ? extra.enemyId : null,
      amountMs: extra && extra.amountMs != null ? extra.amountMs : 0,
      source: (extra && extra.source) || "system",
      contact: (extra && extra.contact) || "body",
    };
    state.recentEvents.push(ev);
    if (state.recentEvents.length > EVENT_CAP) state.recentEvents.shift();
    state.lastEvent = ev;
    return ev;
  }

  function addTime(state, ms) {
    if (state.phase !== "playing") return;
    state.remainingMs = Math.max(0, state.remainingMs + ms);
  }

  function flyerRadii(type) {
    if (type === "fastFlyer") return { visual: 20, collision: 19 };
    return { visual: 24, collision: 23 };
  }

  function walkerRadii() {
    return { visual: 15, collision: 14 };
  }

  function spawnFlyer(state, type, lane, dir) {
    const rad = flyerRadii(type);
    const y = lane === "high" ? HIGH_LANE_Y : LOW_LANE_Y;
    const d = state.difficulty;
    let speed = type === "fastFlyer" ? 76 + d * 6 : 30 + d * 1.2;
    speed = Math.min(speed, 104);
    const x = dir > 0 ? -rad.visual - 6 : WORLD_W + rad.visual + 6;
    const e = {
      id: state.nextId++,
      type: type,
      lane: lane,
      x: x,
      y: y,
      vx: dir > 0 ? speed : -speed,
      vy: 0,
      active: true,
      hitsTaken: 0,
      hitsRequired: 3,
      visualRadius: rad.visual,
      collisionRadius: rad.collision,
      ballContact: null,
      machineContact: null,
      inactiveTick: 0,
    };
    state.enemies.push(e);
    state.lastAirLane = lane;
    state.lastAirExitAt = null;
    return e;
  }

  function spawnWalker(state, dir) {
    const rad = walkerRadii();
    const x = dir > 0 ? -rad.visual - 4 : WORLD_W + rad.visual + 4;
    const speed = 48 + state.difficulty * 6;
    const e = {
      id: state.nextId++,
      type: "walker",
      lane: "ground",
      x: x,
      y: GROUND_Y + rad.visual,
      vx: dir > 0 ? speed : -speed,
      vy: 0,
      active: true,
      hitsTaken: 0,
      hitsRequired: 1,
      visualRadius: rad.visual,
      collisionRadius: rad.collision,
      ballContact: null,
      machineContact: null,
      inactiveTick: 0,
    };
    state.enemies.push(e);
    return e;
  }

  function pruneEnemies(state) {
    const keep = [];
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.active) keep.push(e);
      else if (state.tick - e.inactiveTick < INACTIVE_KEEP_TICKS) keep.push(e);
    }
    state.enemies = keep;
  }

  function deactivate(state, e) {
    e.active = false;
    e.inactiveTick = state.tick;
    e.vx = 0;
    e.ballContact = null;
    e.machineContact = null;
  }

  function create(seed) {
    const s = seed == null ? 1 : seed >>> 0;
    const rng = createRng(s);
    const machineY = MACHINE_GROUNDED_Y;
    const padTop = machineY + MACHINE_R;
    return {
      seed: s,
      rng: rng,
      phase: "ready",
      tick: 0,
      elapsedMs: 0,
      remainingMs: START_MS,
      accMs: 0,
      score: 0,
      difficulty: 0,
      rank: "D",
      input: emptyInput(),
      jumpQueued: false,
      jumpBuffer: 0,
      machine: {
        x: WORLD_W * 0.5,
        y: machineY,
        vx: 0,
        vy: 0,
        radius: MACHINE_R,
        grounded: true,
        jumpCount: 0,
      },
      ball: {
        x: WORLD_W * 0.5,
        y: padTop + BALL_R,
        vx: 0,
        vy: 0,
        radius: BALL_R,
        active: true,
        lastBounceKind: null,
        seated: true,
        recoverTicks: 0,
      },
      enemies: [],
      nextId: 1,
      eventSeq: 0,
      recentEvents: [],
      lastEvent: null,
      firstAirDefeated: false,
      openedLow: false,
      openedHigh: false,
      lastAirLane: "low",
      lastAirExitAt: 0,
      nextAirAt: 0,
      nextWalkerAt: 22000,
      recoveryUntil: 0,
      cleanStreak: 0,
      longestCleanSequence: 0,
      topHits: 0,
      airEnemiesDefeated: 0,
      wrongSideHits: 0,
      ballDrops: 0,
      currentPursuitHits: 0,
      longestPursuit: 0,
    };
  }

  function beginPlay(state) {
    state.phase = "playing";
  }

  function maybeEnd(state) {
    if (state.remainingMs <= 0) {
      state.remainingMs = 0;
      state.phase = "ended";
      state.jumpQueued = false;
      state.jumpBuffer = 0;
    }
  }

  function applyScore(state, n) {
    state.score += n;
    const d = difficultyFrom(state.score, state.firstAirDefeated);
    if (d > state.difficulty) state.difficulty = d;
    state.rank = rankFromScore(state.score);
  }

  function registerMistake(state) {
    state.cleanStreak = 0;
    state.currentPursuitHits = 0;
  }

  function bounceBall(state, kind) {
    const m = state.machine;
    const b = state.ball;
    const padTop = m.y + m.radius;
    b.seated = false;
    b.vy = BOUNCE_VY[kind];
    b.vx = clamp(m.vx * 0.9 + b.vx * 0.2, -BALL_VX_MAX, BALL_VX_MAX);
    b.y = padTop + b.radius + 0.4;
    b.lastBounceKind = kind;
    b.recoverTicks = 0;
    const kinds = {
      weak: "ball_bounce_weak",
      normal: "ball_bounce_normal",
      power: "ball_bounce_power",
    };
    pushEvent(state, kinds[kind], { source: "ball", contact: "top", amountMs: 0 });
  }

  function classifyBounce(state) {
    const m = state.machine;
    if (m.grounded) return "normal";
    if (m.vy > 40) return "power";
    return "weak";
  }

  function handleJump(state) {
    const m = state.machine;
    if (state.input.jump) {
      /* jump is a held flag; queue is edge-triggered from the host */
    }
    if (state.jumpQueued) {
      state.jumpBuffer = 1;
      state.jumpQueued = false;
    }
    if (state.jumpBuffer > 0 && m.grounded && m.jumpCount === 0) {
      m.vy = JUMP_VEL;
      m.grounded = false;
      m.jumpCount = 1;
      state.jumpBuffer = 0;
      pushEvent(state, "machine_jump", { source: "machine", contact: "body" });
    }
  }

  function integrateMachine(state) {
    const m = state.machine;
    const dt = STEP_MS / 1000;
    const axis = moveAxis(state);
    m.vx = axis * MAX_SPEED;
    if (!m.grounded) {
      m.vy -= GRAVITY * dt;
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    const minX = m.radius + 4;
    const maxX = WORLD_W - m.radius - 4;
    if (m.x < minX) {
      m.x = minX;
      m.vx = 0;
    } else if (m.x > maxX) {
      m.x = maxX;
      m.vx = 0;
    }
    if (m.y <= MACHINE_GROUNDED_Y) {
      const wasAir = !m.grounded;
      m.y = MACHINE_GROUNDED_Y;
      m.vy = 0;
      m.grounded = true;
      if (wasAir) {
        m.jumpCount = 0;
        pushEvent(state, "machine_land", { source: "machine", contact: "body" });
      }
    } else {
      m.grounded = false;
    }
  }

  function integrateBall(state) {
    const b = state.ball;
    const m = state.machine;
    const dt = STEP_MS / 1000;
    if (b.seated) {
      b.x = m.x;
      b.y = m.y + m.radius + b.radius;
      b.vx = m.vx;
      b.vy = 0;
      return;
    }
    if (b.recoverTicks > 0) {
      b.recoverTicks -= 1;
      const lift = RECOVER_LIFT * (0.35 + 0.65 * (b.recoverTicks / 50));
      b.x += (m.x - b.x) * 0.28;
      b.y = m.y + m.radius + b.radius + lift;
      b.vx = 0;
      b.vy = b.recoverTicks <= 1 ? -60 : 0;
      return;
    }
    b.vy -= GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.radius + 2) {
      b.x = b.radius + 2;
      b.vx = Math.abs(b.vx) * 0.92;
    } else if (b.x > WORLD_W - b.radius - 2) {
      b.x = WORLD_W - b.radius - 2;
      b.vx = -Math.abs(b.vx) * 0.92;
    }
  }

  function collideBallMachine(state) {
    const b = state.ball;
    const m = state.machine;
    if (b.seated) {
      bounceBall(state, classifyBounce(state));
      return;
    }
    if (b.recoverTicks > 0) return;
    const dt = STEP_MS / 1000;
    const padTop = m.y + m.radius;
    const ballBottom = b.y - b.radius;
    const prevBottom = ballBottom - b.vy * dt;
    const onPad = Math.abs(b.x - m.x) <= PAD_HALF + b.radius * 0.55;
    const crossed = b.vy <= 80 && prevBottom >= padTop - 8 && ballBottom <= padTop + 6;
    const nested = b.vy <= 80 && ballBottom <= padTop + 5 && ballBottom >= padTop - 24 && b.y >= m.y;
    if (onPad && (crossed || nested)) {
      bounceBall(state, classifyBounce(state));
    }
  }

  function ballHitsGround(state) {
    const b = state.ball;
    if (b.seated || b.recoverTicks > 0) return;
    if (b.y - b.radius > GROUND_Y) return;
    state.ballDrops += 1;
    registerMistake(state);
    addTime(state, -DROP_PENALTY);
    pushEvent(state, "ball_drop", {
      source: "ball",
      contact: "body",
      amountMs: -DROP_PENALTY,
    });
    maybeEnd(state);
    if (state.phase !== "playing") return;
    const m = state.machine;
    b.x = m.x;
    b.y = m.y + m.radius + b.radius + RECOVER_LIFT;
    b.vx = 0;
    b.vy = 110;
    b.recoverTicks = 50;
    b.seated = false;
  }

  function overlapCircles(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy <= r * r;
  }

  function collideBallEnemies(state) {
    const b = state.ball;
    if (b.seated || b.recoverTicks > 0) return;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active || e.type === "walker") {
        if (!e.active) e.ballContact = null;
        continue;
      }
      const hit = overlapCircles(b.x, b.y, b.radius, e.x, e.y, e.collisionRadius);
      const near = overlapCircles(b.x, b.y, b.radius, e.x, e.y, e.collisionRadius + 5);
      if (!near) {
        e.ballContact = null;
        continue;
      }
      if (!hit) continue;
      if (e.ballContact) continue;
      const descending = b.vy < -20;
      const fromAbove = b.y > e.y;
      const topish = fromAbove && descending;
      if (topish) {
        e.ballContact = "top";
        e.hitsTaken = Math.min(e.hitsRequired, e.hitsTaken + 1);
        state.topHits += 1;
        state.cleanStreak += 1;
        if (state.cleanStreak > state.longestCleanSequence) {
          state.longestCleanSequence = state.cleanStreak;
        }
        state.currentPursuitHits += 1;
        if (state.currentPursuitHits > state.longestPursuit) {
          state.longestPursuit = state.currentPursuitHits;
        }
        const n = e.hitsTaken;
        const tGain = HIT_TIME[n];
        const sGain = HIT_SCORE[n];
        addTime(state, tGain);
        applyScore(state, sGain);
        pushEvent(state, "top_hit", {
          enemyId: e.id,
          amountMs: tGain,
          source: "ball",
          contact: "top",
        });
        b.y = e.y + e.collisionRadius + b.radius + 1.2;
        b.vy = 390 + n * 12;
        b.vx = clamp(b.vx * 0.82 + e.vx * 0.28, -BALL_VX_MAX, BALL_VX_MAX);
        if (e.hitsTaken >= e.hitsRequired) {
          state.airEnemiesDefeated += 1;
          state.firstAirDefeated = true;
          state.currentPursuitHits = 0;
          pushEvent(state, "enemy_defeated", {
            enemyId: e.id,
            amountMs: tGain,
            source: "ball",
            contact: "top",
          });
          deactivate(state, e);
          const d = difficultyFrom(state.score, true);
          if (d > state.difficulty) state.difficulty = d;
          state.recoveryUntil = state.elapsedMs + (state.difficulty >= 3 ? 1600 : 2200);
        }
      } else {
        e.ballContact = "non_top";
        state.wrongSideHits += 1;
        registerMistake(state);
        addTime(state, -WRONG_PENALTY);
        pushEvent(state, "wrong_side_hit", {
          enemyId: e.id,
          amountMs: -WRONG_PENALTY,
          source: "ball",
          contact: "non_top",
        });
        maybeEnd(state);
      }
    }
  }

  function collideMachineWalkers(state) {
    const m = state.machine;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active || e.type !== "walker") {
        if (!e.active) e.machineContact = null;
        continue;
      }
      const hit = overlapCircles(m.x, m.y, m.radius, e.x, e.y, e.collisionRadius);
      const near = overlapCircles(m.x, m.y, m.radius, e.x, e.y, e.collisionRadius + 6);
      if (!near) {
        e.machineContact = null;
        continue;
      }
      if (!hit) continue;
      if (e.machineContact) continue;
      const stomping = !m.grounded && m.vy < 0 && m.y > e.y;
      if (stomping) {
        e.machineContact = "stomp";
        e.hitsTaken = 1;
        addTime(state, STOMP_TIME);
        applyScore(state, STOMP_SCORE);
        pushEvent(state, "ground_stomp", {
          enemyId: e.id,
          amountMs: STOMP_TIME,
          source: "machine",
          contact: "top",
        });
        pushEvent(state, "enemy_defeated", {
          enemyId: e.id,
          amountMs: STOMP_TIME,
          source: "machine",
          contact: "top",
        });
        deactivate(state, e);
        m.vy = Math.max(m.vy, 140);
      } else {
        e.machineContact = "body";
        registerMistake(state);
        addTime(state, -BODY_PENALTY);
        pushEvent(state, "walker_bump", {
          enemyId: e.id,
          amountMs: -BODY_PENALTY,
          source: "machine",
          contact: "body",
        });
        maybeEnd(state);
        const pushDir = m.x >= e.x ? 1 : -1;
        m.x += pushDir * 6;
      }
    }
  }

  function integrateEnemies(state) {
    const dt = STEP_MS / 1000;
    let airAlive = false;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active) continue;
      e.x += e.vx * dt;
      const margin = e.visualRadius + 12;
      const off = e.x < -margin || e.x > WORLD_W + margin;
      if (off) {
        if (e.lane !== "ground") {
          state.lastAirExitAt = state.elapsedMs;
          state.lastAirLane = e.lane;
        }
        deactivate(state, e);
      } else if (e.lane !== "ground") {
        airAlive = true;
      }
    }
    if (!airAlive && state.lastAirExitAt == null) {
      /* still opening or empty */
    }
    pruneEnemies(state);
  }

  function countActive(state, pred) {
    let n = 0;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.active && pred(e)) n += 1;
    }
    return n;
  }

  function director(state) {
    if (state.phase !== "playing") return;
    const t = state.elapsedMs;
    if (!state.firstAirDefeated) {
      if (!state.openedLow && t >= 1200) {
        spawnFlyer(state, "slowFlyer", "low", 1);
        state.openedLow = true;
      }
      if (!state.openedHigh && t >= 4000) {
        spawnFlyer(state, "slowFlyer", "high", -1);
        state.openedHigh = true;
      }
      const air = countActive(state, function (e) {
        return e.lane !== "ground";
      });
      if (state.openedLow && air === 0) {
        const gone = state.lastAirExitAt == null ? t : state.lastAirExitAt;
        if (t >= gone + 1700) {
          const lane = state.lastAirLane === "low" ? "high" : "low";
          spawnFlyer(state, "slowFlyer", lane, state.rng.signed());
        }
      }
      if (t >= state.nextWalkerAt && countActive(state, function (e) {
        return e.type === "walker";
      }) === 0) {
        spawnWalker(state, state.rng.signed());
        state.nextWalkerAt = t + 16000 + state.rng.range(0, 4000);
      }
      return;
    }

    const d = state.difficulty;
    const air = countActive(state, function (e) {
      return e.lane !== "ground";
    });
    const walkers = countActive(state, function (e) {
      return e.type === "walker";
    });
    const maxAir = d >= 1 ? 2 : 1;
    const maxWalk = 1;
    if (t < state.recoveryUntil) return;

    if (air < maxAir && t >= state.nextAirAt) {
      const useFast = d >= 1 && state.rng.next() < (d >= 4 ? 0.65 : d >= 3 ? 0.48 : d >= 2 ? 0.3 : 0.14);
      const type = useFast ? "fastFlyer" : "slowFlyer";
      let lane;
      if (air === 1) {
        const existing = state.enemies.find(function (e) {
          return e.active && e.lane !== "ground";
        });
        lane = existing && existing.lane === "low" ? "high" : "low";
      } else {
        lane = state.rng.next() < 0.5 ? "low" : "high";
      }
      spawnFlyer(state, type, lane, state.rng.signed());
      const gap = d >= 4 ? 1400 : d >= 3 ? 1800 : d >= 2 ? 2400 : 3000;
      state.nextAirAt = t + gap + state.rng.range(0, 600);
      if (useFast && d >= 3 && state.rng.next() < 0.4) {
        state.recoveryUntil = t + 2000;
      }
    }

    if (walkers < maxWalk && t >= state.nextWalkerAt) {
      const overlapOk = d >= 2;
      if (overlapOk || air === 0) {
        spawnWalker(state, state.rng.signed());
        state.nextWalkerAt = t + (d >= 4 ? 7000 : 10000) + state.rng.range(0, 3500);
      } else {
        state.nextWalkerAt = t + 800;
      }
    }
  }

  function step(state) {
    if (state.phase === "ended") return;
    if (state.phase === "ready") {
      if (!wantsStart(state)) return;
      beginPlay(state);
    }

    state.tick += 1;
    state.elapsedMs = state.tick * STEP_MS;
    state.remainingMs -= STEP_MS;

    handleJump(state);
    integrateMachine(state);
    integrateBall(state);
    collideBallMachine(state);
    collideBallEnemies(state);
    collideMachineWalkers(state);
    ballHitsGround(state);
    integrateEnemies(state);
    director(state);

    if (state.remainingMs <= 0) {
      state.remainingMs = 0;
      state.phase = "ended";
    }
  }

  function advance(state, ms) {
    if (typeof ms !== "number" || !(ms > 0)) return;
    state.accMs += ms;
    let guard = 0;
    while (state.accMs >= STEP_MS - 1e-9 && guard++ < 12000) {
      if (state.phase === "ended") {
        state.accMs = 0;
        break;
      }
      if (state.phase === "ready" && !wantsStart(state)) {
        state.accMs = 0;
        break;
      }
      step(state);
      state.accMs -= STEP_MS;
      if (state.accMs < 1e-9) state.accMs = 0;
    }
  }

  function queueJump(state) {
    state.jumpQueued = true;
    state.input.jump = true;
  }

  function releaseJump(state) {
    state.input.jump = false;
  }

  function snapshot(state) {
    const enemies = state.enemies
      .map(function (e) {
        return {
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
          collisionRadius: e.collisionRadius,
        };
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
    const recent = state.recentEvents.map(function (ev) {
      return {
        sequence: ev.sequence,
        kind: ev.kind,
        tick: ev.tick,
        enemyId: ev.enemyId,
        amountMs: ev.amountMs,
        source: ev.source,
        contact: ev.contact,
      };
    });
    return {
      phase: state.phase,
      tick: state.tick,
      elapsedMs: state.elapsedMs,
      remainingMs: state.remainingMs,
      seed: state.seed,
      rngState: state.rng.state,
      score: state.score,
      difficulty: state.difficulty,
      rank: state.rank,
      input: {
        left: !!state.input.left,
        right: !!state.input.right,
        jump: !!state.input.jump,
        axis: state.input.axis || 0,
      },
      groundY: GROUND_Y,
      lowLaneY: LOW_LANE_Y,
      highLaneY: HIGH_LANE_Y,
      machineNormalApexY: MACHINE_NORMAL_APEX_Y,
      machine: {
        x: state.machine.x,
        y: state.machine.y,
        vx: state.machine.vx,
        vy: state.machine.vy,
        radius: state.machine.radius,
        grounded: state.machine.grounded,
        jumpCount: state.machine.jumpCount,
      },
      ball: {
        x: state.ball.x,
        y: state.ball.y,
        vx: state.ball.vx,
        vy: state.ball.vy,
        radius: state.ball.radius,
        active: state.ball.active,
        lastBounceKind: state.ball.lastBounceKind,
      },
      topHits: state.topHits,
      airEnemiesDefeated: state.airEnemiesDefeated,
      wrongSideHits: state.wrongSideHits,
      ballDrops: state.ballDrops,
      longestCleanSequence: state.longestCleanSequence,
      enemies: enemies,
      recentEvents: recent,
      lastEvent: state.lastEvent
        ? recent.length
          ? recent[recent.length - 1]
          : null
        : null,
    };
  }

  const api = {
    STEP_MS,
    BOUNDS,
    create,
    step,
    advance,
    snapshot,
    queueJump,
    releaseJump,
    wantsStart,
    rankFromScore,
    createRng,
  };

  root.STOMP_SIM = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
