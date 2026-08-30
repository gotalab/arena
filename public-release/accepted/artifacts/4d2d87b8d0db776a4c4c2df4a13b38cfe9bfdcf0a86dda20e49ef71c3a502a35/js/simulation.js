'use strict';

const Simulation = (() => {
  const TICK_HZ = 60;
  const DT = 1 / TICK_HZ;
  const PLAYER_RADIUS = 11;
  const JUMP_CAPACITY = 3;
  const WALL_SLIDE_SPEED = 38;
  const MOTH_KICK = 340;
  const PULL_DEADZONE = 14;
  const MAX_PULL_PX = 95;
  const AIR_DRAG = 0.12;
  const DAMP_BASE = 28;
  const DAMP_HEIGHT_FACTOR = 0.055;
  const DAMP_ACCEL = 0.4;

  const RANKS = [
    { min: 0, grade: 'Ash' },
    { min: 400, grade: 'Cinder' },
    { min: 900, grade: 'Ember' },
    { min: 1600, grade: 'Flare' },
    { min: 2600, grade: 'Blaze' },
    { min: 4000, grade: 'Inferno' },
    { min: 6000, grade: 'Supernova' },
  ];

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  function rankForScore(score) {
    let grade = RANKS[0].grade;
    for (const r of RANKS) {
      if (score >= r.min) grade = r.grade;
    }
    return grade;
  }

  let state = null;
  let sessionBest = 0;

  function createState(seed) {
    const rng = ArenaRng.createRng(seed >>> 0 || 1);
    const world = WorldGen.generate(rng, 90);
    const startLedge = world.ledges[0];

    return {
      seed: seed >>> 0 || 1,
      rng,
      rngState: rng.state(),
      world,
      phase: 'ready',
      tick: 0,
      elapsedMs: 0,
      spawnIndex: world.spawnIndex,
      difficulty: 1,
      score: 0,
      bonusScore: 0,
      height: startLedge.position.y,
      peakHeight: startLedge.position.y,
      sessionBest: 0,
      rank: null,
      input: { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0 },
      player: {
        x: startLedge.position.x,
        y: startLedge.position.y + 14,
        vx: 0,
        vy: 0,
        playerRadius: PLAYER_RADIUS,
        anchored: true,
        anchorKind: 'ledge',
        wallSide: null,
        expression: 'rest',
        squash: 1,
        stretch: 1,
        animT: 0,
      },
      jumpCapacity: JUMP_CAPACITY,
      jumpsLeft: JUMP_CAPACITY,
      launches: 0,
      midairLaunches: 0,
      landings: 0,
      refunds: 0,
      glimmersCollected: 0,
      chainCount: 0,
      chainBest: 0,
      dampY: 0,
      dampSpeed: DAMP_BASE,
      dampBreath: 0,
      lastEvent: null,
      cameraY: startLedge.position.y,
      mothKickCooldown: 0,
    };
  }

  function syncScore() {
    const heightScore = Math.floor(Math.max(0, (state.peakHeight - 90) * 1.8));
    state.score = heightScore + state.bonusScore;
  }

  function setEvent(kind) {
    state.lastEvent = { kind, tick: state.tick };
  }

  function bankChainOnLand() {
    const ended = state.chainCount;
    if (ended <= 0) return 0;
    const bonus = ended * ended * 12;
    state.bonusScore += bonus;
    if (ended > state.chainBest) state.chainBest = ended;
    state.chainCount = 0;
    setEvent('chainBank');
    syncScore();
    return ended;
  }

  function updateMoths(dt) {
    const t = state.tick * DT;
    for (const item of state.world.items) {
      if (!item.active || item.type !== 'moth') continue;
      item.position.x = item.baseX + Math.sin(t * 0.7 + item.phase) * item.driftX;
      item.position.y = item.baseY + Math.cos(t * 0.5 + item.phase * 1.3) * item.driftY;
    }
    for (const item of state.world.items) {
      if (!item.active || item.type !== 'glimmer') continue;
      item.position.y += Math.sin(t * 2 + item.phase) * 0.3;
      item.position.x += Math.cos(t * 1.5 + item.phase) * 0.15;
    }
  }

  function tryLaunch(pullDx, pullDy, pullLen) {
    if (state.jumpsLeft <= 0) return null;
    if (pullLen < PULL_DEADZONE) return null;

    const wasMidair = !state.player.anchored && state.phase === 'playing';
    const strength = Math.min(1, pullLen / MAX_PULL_PX);
    const angle = Math.atan2(pullDy, pullDx);
    const speed = WorldGen.MAX_LAUNCH_SPEED * strength;

    state.player.vx = -Math.cos(angle) * speed;
    state.player.vy = -Math.sin(angle) * speed;
    state.player.anchored = false;
    state.player.anchorKind = null;
    state.player.wallSide = null;
    state.player.expression = 'flight';
    state.player.squash = 0.7;
    state.player.stretch = 1.35;

    state.jumpsLeft--;
    state.launches++;
    if (wasMidair) state.midairLaunches++;
    setEvent('launch');

    if (wasMidair) {
      state.chainCount++;
      setEvent('chain');
    }

    if (state.phase === 'ready') state.phase = 'playing';
    state.mothKickCooldown = 0;
    return strength;
  }

  function landOnLedge(ledge) {
    const p = state.player;
    p.y = ledge.position.y + PLAYER_RADIUS + 1;
    p.x = Math.max(
      ledge.position.x - ledge.halfWidth + PLAYER_RADIUS,
      Math.min(ledge.position.x + ledge.halfWidth - PLAYER_RADIUS, p.x),
    );
    p.vx = 0;
    p.vy = 0;
    p.anchored = true;
    p.anchorKind = 'ledge';
    p.wallSide = null;
    p.expression = 'rest';
    p.squash = 1.25;
    p.stretch = 0.8;

    state.jumpsLeft = state.jumpCapacity;
    state.landings++;
    setEvent('land');
    bankChainOnLand();
  }

  function landOnWall(side) {
    const p = state.player;
    p.anchored = true;
    p.anchorKind = 'wall';
    p.wallSide = side;
    p.vx = 0;
    p.vy = 0;
    p.x = side === 'left'
      ? WorldGen.WALL_LEFT + PLAYER_RADIUS
      : WorldGen.WALL_RIGHT - PLAYER_RADIUS;
    p.expression = 'cling';
    p.squash = 1.1;
    p.stretch = 0.95;

    state.jumpsLeft = state.jumpCapacity;
    state.landings++;
    setEvent('land');
    bankChainOnLand();
  }

  function burstMoth(moth) {
    moth.active = false;
    state.player.vy = MOTH_KICK;
    state.player.vx *= 0.6;
    state.player.expression = 'burst';
    state.player.squash = 1.4;
    state.player.stretch = 0.7;
    state.refunds++;
    state.jumpsLeft = Math.min(state.jumpCapacity, state.jumpsLeft + 1);
    state.mothKickCooldown = 0.15;
    setEvent('bounce');
    state.chainCount++;
    setEvent('chain');
  }

  function collectGlimmer(glimmer) {
    glimmer.active = false;
    const chainMult = 1 + state.chainCount * 0.35;
    state.bonusScore += Math.floor(55 * chainMult);
    state.glimmersCollected++;
    state.player.expression = 'burst';
    setEvent('glimmer');
    syncScore();
  }

  function resolveCollisions() {
    const p = state.player;
    if (p.anchored) return;

    for (const item of state.world.items) {
      if (!item.active) continue;
      const dx = p.x - item.position.x;
      const dy = p.y - item.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER_RADIUS + item.collisionRadius) {
        if (item.type === 'moth' && state.mothKickCooldown <= 0) {
          burstMoth(item);
        } else if (item.type === 'glimmer') {
          collectGlimmer(item);
        }
      }
    }

    if (p.x - PLAYER_RADIUS <= WorldGen.WALL_LEFT && p.vx < 0) {
      landOnWall('left');
      return;
    }
    if (p.x + PLAYER_RADIUS >= WorldGen.WALL_RIGHT && p.vx > 0) {
      landOnWall('right');
      return;
    }

    if (p.vy <= 0) return;
    for (const ledge of state.world.ledges) {
      if (!ledge.active) continue;
      const top = ledge.position.y;
      const left = ledge.position.x - ledge.halfWidth;
      const right = ledge.position.x + ledge.halfWidth;
      const prevY = p.y - p.vy * DT;
      if (p.y + PLAYER_RADIUS >= top && prevY + PLAYER_RADIUS <= top + 10) {
        if (p.x >= left - PLAYER_RADIUS * 0.5 && p.x <= right + PLAYER_RADIUS * 0.5) {
          landOnLedge(ledge);
          return;
        }
      }
    }
  }

  function updatePlayer(dt) {
    const p = state.player;
    p.animT += dt;

    if (p.anchored && p.anchorKind === 'wall') {
      p.y -= WALL_SLIDE_SPEED * dt;
      p.expression = 'cling';
      if (p.y < state.dampY + PLAYER_RADIUS + 20) {
        endRun();
        return;
      }
    } else if (!p.anchored) {
      p.vy -= WorldGen.GRAVITY * dt;
      p.vx *= (1 - AIR_DRAG * dt);
      p.vy *= (1 - AIR_DRAG * dt * 0.5);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (state.jumpsLeft <= 0 && p.vy < 0) {
        p.expression = 'falling';
      } else if (p.expression !== 'burst') {
        p.expression = 'flight';
      }

      if (p.x - PLAYER_RADIUS < WorldGen.WALL_LEFT) {
        p.x = WorldGen.WALL_LEFT + PLAYER_RADIUS;
        if (p.vx < 0) landOnWall('left');
      }
      if (p.x + PLAYER_RADIUS > WorldGen.WALL_RIGHT) {
        p.x = WorldGen.WALL_RIGHT - PLAYER_RADIUS;
        if (p.vx > 0) landOnWall('right');
      }

      resolveCollisions();
    }

    p.squash += (1 - p.squash) * Math.min(1, dt * 8);
    p.stretch += (1 - p.stretch) * Math.min(1, dt * 8);

    if (state.mothKickCooldown > 0) state.mothKickCooldown -= dt;

    if (p.y > state.peakHeight) {
      state.peakHeight = p.y;
      state.height = p.y;
      syncScore();
    }
  }

  function updateDamp(dt) {
    if (state.phase !== 'playing') return;
    state.difficulty = 1 + Math.max(0, (state.peakHeight - 90) / 400);
    const targetSpeed = DAMP_BASE + state.peakHeight * DAMP_HEIGHT_FACTOR;
    state.dampSpeed += (targetSpeed - state.dampSpeed) * DAMP_ACCEL * dt;
    state.dampY += state.dampSpeed * dt;
    state.dampBreath += dt;

    const dampFront = state.dampY + 8 + Math.sin(state.dampBreath * 2) * 6;
    if (state.player.y <= dampFront + PLAYER_RADIUS) {
      state.player.expression = 'damp';
      endRun();
    }
  }

  function endRun() {
    if (state.phase === 'gameover') return;
    state.phase = 'gameover';
    state.player.anchored = true;
    state.player.expression = 'damp';
    syncScore();
    if (state.score > sessionBest) sessionBest = state.score;
    state.sessionBest = sessionBest;
    state.rank = rankForScore(state.score);
  }

  function step() {
    if (state.phase === 'gameover') return;
    if (state.phase === 'ready') {
      state.lastEvent = null;
      return;
    }

    state.tick++;
    state.elapsedMs = Math.round(state.tick * 1000 / TICK_HZ);
    state.rngState = state.rng.state();

    updateMoths(DT);
    updatePlayer(DT);
    updateDamp(DT);
    state.cameraY += (state.player.y - state.cameraY) * Math.min(1, DT * 4);
  }

  function processPointerRelease() {
    if (state.phase === 'gameover') return 'restart';
    if (!state.input.dragging) return null;

    const pullLen = Math.sqrt(
      state.input.dx * state.input.dx + state.input.dy * state.input.dy,
    );
    const strength = tryLaunch(state.input.dx, state.input.dy, pullLen);
    state.input.dragging = false;
    state.input.dx = 0;
    state.input.dy = 0;
    return strength;
  }

  function reset(seed) {
    const s = seed !== undefined ? (seed >>> 0) : ((Math.random() * 0xffffffff) >>> 0);
    state = createState(s);
    state.sessionBest = sessionBest;
    Particles.clear();
    return state;
  }

  function getState() {
    return state;
  }

  function snapshot() {
    if (!state) return null;
    const p = state.player;
    const spanLow = p.y - WorldGen.LAUNCH_REACH;
    const spanHigh = p.y + WorldGen.LAUNCH_REACH * 2;

    const ledges = state.world.ledges
      .filter((l) => l.active && l.position.y >= spanLow && l.position.y <= spanHigh)
      .map((l) => ({
        id: l.id,
        position: { x: round3(l.position.x), y: round3(l.position.y) },
        halfWidth: round3(l.halfWidth),
        active: l.active,
      }))
      .sort((a, b) => a.id - b.id);

    const items = state.world.items
      .filter((it) => it.position.y >= spanLow && it.position.y <= spanHigh)
      .map((it) => ({
        id: it.id,
        type: it.type,
        position: { x: round3(it.position.x), y: round3(it.position.y) },
        active: it.active,
        visualRadius: round3(it.visualRadius),
        collisionRadius: round3(it.collisionRadius),
      }))
      .sort((a, b) => a.id - b.id);

    return {
      phase: state.phase,
      tick: state.tick,
      elapsedMs: state.elapsedMs,
      seed: state.seed,
      rngState: state.rngState,
      spawnIndex: state.spawnIndex,
      input: { ...state.input },
      difficulty: round3(state.difficulty),
      score: Math.floor(state.score),
      height: round3(state.height),
      sessionBest: Math.floor(state.sessionBest),
      rank: state.rank,
      x: round3(p.x),
      y: round3(p.y),
      vx: round3(p.vx),
      vy: round3(p.vy),
      playerRadius: round3(p.playerRadius),
      anchored: p.anchored,
      anchorKind: p.anchorKind,
      jumpCapacity: state.jumpCapacity,
      jumpsLeft: state.jumpsLeft,
      launches: state.launches,
      midairLaunches: state.midairLaunches,
      landings: state.landings,
      refunds: state.refunds,
      glimmersCollected: state.glimmersCollected,
      chainCount: state.chainCount,
      chainBest: state.chainBest,
      dampY: round3(state.dampY),
      dampSpeed: round3(state.dampSpeed),
      wallLeftX: round3(WorldGen.WALL_LEFT),
      wallRightX: round3(WorldGen.WALL_RIGHT),
      launchReach: round3(WorldGen.LAUNCH_REACH),
      ledges,
      items,
      lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
    };
  }

  return {
    TICK_HZ,
    DT,
    PULL_DEADZONE,
    MAX_PULL_PX,
    PLAYER_RADIUS,
    reset,
    step,
    getState,
    snapshot,
    processPointerRelease,
    setInput(patch) {
      Object.assign(state.input, patch);
    },
    rankForScore,
    RANKS,
  };
})();

window.Simulation = Simulation;
