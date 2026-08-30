import { createRng, hashSeed } from './rng.js';

export const TICK_MS = 1000 / 60;
export const STAGE_W = 360;
export const STAGE_H = 640;

// Y increases downward (canvas convention)
export const GROUND_Y = 560;
export const LOW_LANE_Y = 380;
export const HIGH_LANE_Y = 220;
export const MACHINE_NORMAL_APEX_Y = 420;

export const MACHINE_R = 22;
export const BALL_R = 10;
export const GRAVITY = 0.38;
export const MACHINE_SPEED = 4.2;
export const MACHINE_JUMP_VY = -9.5;
export const MACHINE_MAX_VX = 6;

const START_CLOCK_MS = 90000;
const DRAIN_MS_PER_TICK = 1000 / 60;
const BALL_DROP_PENALTY_MS = 3500;
const WRONG_SIDE_PENALTY_MS = 1800;
const WALKER_BODY_PENALTY_MS = 1200;

const TIME_REWARD = [2800, 4200, 7000];
const SCORE_REWARD = [120, 200, 480];

const MAX_EVENTS = 64;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rankForScore(score) {
  if (score >= 8000) return 'S';
  if (score >= 5000) return 'A';
  if (score >= 3000) return 'B';
  if (score >= 1500) return 'C';
  if (score >= 600) return 'D';
  return 'E';
}

function difficultyForScore(score) {
  if (score >= 5000) return 4;
  if (score >= 3000) return 3;
  if (score >= 1500) return 2;
  if (score >= 500) return 1;
  return 0;
}

let nextEnemyId = 1;

function makeEnemy(type, lane, x, y, vx, visualRadius) {
  const id = nextEnemyId++;
  const collisionRadius = visualRadius;
  return {
    id,
    type,
    lane,
    x,
    y,
    vx,
    active: true,
    hitsTaken: 0,
    hitsRequired: 3,
    visualRadius,
    collisionRadius,
    defeatTimer: 0,
    wrongSideCharged: false,
    bodyCharged: false,
  };
}

export class StompSim {
  constructor() {
    this.seed = 1;
    this.rng = createRng(1);
    this.reset(1);
  }

  reset(seed) {
    const s = hashSeed(seed);
    this.seed = s;
    this.rng = createRng(s);
    nextEnemyId = 1;

    this.tick = 0;
    this.elapsedMs = 0;
    this.phase = 'ready';
    this.remainingMs = START_CLOCK_MS;
    this.score = 0;
    this.difficulty = 0;
    this.rank = 'E';

    this.input = { left: false, right: false, jumpQueued: false };
    this.heldInput = { left: false, right: false, jumpQueued: false };

    this.machine = {
      x: STAGE_W / 2,
      y: GROUND_Y - MACHINE_R,
      vx: 0,
      vy: 0,
      radius: MACHINE_R,
      grounded: true,
      jumpCount: 0,
      facing: 1,
      squash: 0,
      expression: 'idle',
      expressionTimer: 0,
    };

    this.ball = {
      x: STAGE_W / 2,
      y: GROUND_Y - MACHINE_R - BALL_R - 2,
      vx: 0,
      vy: 0,
      radius: BALL_R,
      active: true,
      lastBounceKind: null,
      onMachine: true,
      recoveryTimer: 0,
    };

    this.enemies = [];
    this.eventSeq = 0;
    this.recentEvents = [];
    this.lastEvent = null;

    this.topHits = 0;
    this.airEnemiesDefeated = 0;
    this.wrongSideHits = 0;
    this.ballDrops = 0;
    this.longestCleanSequence = 0;
    this.currentCleanSequence = 0;

    this.spawnTimer = 0;
    this.openingLowSpawned = false;
    this.openingHighSpawned = false;
    this.firstAirDestroyed = false;
    this.pendingSlowLane = null;
    this.needsOpeningBounce = false;

    this.patternCooldown = 0;
    this.sessionBest = typeof localStorage !== 'undefined'
      ? Number(localStorage.getItem('stomp-best') || 0)
      : (this.sessionBest ?? 0);

    this._scheduleOpening();
  }

  _scheduleOpening() {
    this.openingLowSpawned = false;
    this.openingHighSpawned = false;
    this.spawnTimer = 30;
    this.pendingSlowLane = 'low';
  }

  _pushEvent(kind, extra = {}) {
    this.eventSeq += 1;
    const ev = {
      sequence: this.eventSeq,
      kind,
      tick: this.tick,
      enemyId: extra.enemyId ?? null,
      amountMs: extra.amountMs ?? 0,
      source: extra.source ?? 'system',
      contact: extra.contact ?? null,
    };
    this.recentEvents.push(ev);
    if (this.recentEvents.length > MAX_EVENTS) {
      this.recentEvents.shift();
    }
    this.lastEvent = ev;
  }

  _addTime(ms) {
    this.remainingMs = Math.min(999999, this.remainingMs + ms);
  }

  _removeTime(ms) {
    this.remainingMs = Math.max(0, this.remainingMs - ms);
    if (this.remainingMs <= 0 && this.phase === 'playing') {
      this.phase = 'ended';
      this.machine.expression = 'spent';
      if (this.score > this.sessionBest) {
        this.sessionBest = this.score;
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('stomp-best', String(this.score));
          }
        } catch { /* ignore */ }
      }
    }
  }

  _updateDifficulty() {
    const d = difficultyForScore(this.score);
    if (d > this.difficulty) this.difficulty = d;
    this.rank = rankForScore(this.score);
  }

  setInput(input) {
    this.heldInput = { ...input };
    if (this.phase === 'ready' || this.phase === 'playing') {
      this.input = { ...input };
    }
  }

  _consumeJumpQueue() {
    if (this.input.jumpQueued && this.machine.grounded) {
      this.machine.vy = MACHINE_JUMP_VY;
      this.machine.grounded = false;
      this.machine.jumpCount = 1;
      this.machine.expression = 'jump';
      this._pushEvent('machine_jump', { source: 'machine' });
    }
    this.input.jumpQueued = false;
  }

  _spawnSlowFlyer(lane) {
    const fromLeft = this.rng.next() < 0.5;
    const x = fromLeft ? -30 : STAGE_W + 30;
    const vx = (fromLeft ? 1 : -1) * (1.1 + this.rng.next() * 0.3);
    const y = lane === 'low' ? LOW_LANE_Y : HIGH_LANE_Y;
    const vr = lane === 'low' ? 16 : 14;
    this.enemies.push(makeEnemy('slowFlyer', lane, x, y, vx, vr));
  }

  _spawnFastFlyer(lane) {
    const fromLeft = this.rng.next() < 0.5;
    const x = fromLeft ? -30 : STAGE_W + 30;
    const speed = 2.0 + this.difficulty * 0.35 + this.rng.next() * 0.4;
    const vx = (fromLeft ? 1 : -1) * speed;
    const y = lane === 'low' ? LOW_LANE_Y : HIGH_LANE_Y;
    const vr = lane === 'low' ? 15 : 13;
    this.enemies.push(makeEnemy('fastFlyer', lane, x, y, vx, vr));
  }

  _spawnWalker() {
    const fromLeft = this.rng.next() < 0.5;
    const x = fromLeft ? -20 : STAGE_W + 20;
    const vx = (fromLeft ? 1 : -1) * (0.8 + this.rng.next() * 0.4);
    const y = GROUND_Y - 12;
    this.enemies.push(makeEnemy('walker', 'ground', x, y, vx, 14));
  }

  _updateSpawning() {
    if (this.phase !== 'playing') return;

    const activeSlowAir = this.enemies.filter(
      (e) => e.active && (e.type === 'slowFlyer' || e.type === 'fastFlyer')
    );

    if (!this.firstAirDestroyed) {
      if (this.spawnTimer > 0) {
        this.spawnTimer -= 1;
        return;
      }

      const needLow = !this.openingLowSpawned ||
        !activeSlowAir.some((e) => e.lane === 'low' && e.type === 'slowFlyer');
      const needHigh = !this.openingHighSpawned ||
        !activeSlowAir.some((e) => e.lane === 'high' && e.type === 'slowFlyer');

      if (needLow && this.pendingSlowLane !== 'high') {
        this._spawnSlowFlyer('low');
        this.openingLowSpawned = true;
        this.pendingSlowLane = null;
        this.spawnTimer = 90;
        return;
      }
      if (needHigh) {
        this._spawnSlowFlyer('high');
        this.openingHighSpawned = true;
        this.spawnTimer = 90;
        return;
      }

      const hasSlow = activeSlowAir.some((e) => e.type === 'slowFlyer');
      if (!hasSlow) {
        const lane = this.rng.pick(['low', 'high']);
        this._spawnSlowFlyer(lane);
        this.spawnTimer = 70 + Math.floor(this.rng.next() * 40);
      }
      return;
    }

    if (this.patternCooldown > 0) {
      this.patternCooldown -= 1;
      return;
    }

    const tier = this.difficulty;
    const roll = this.rng.next();

    if (tier === 0) {
      this._spawnSlowFlyer(this.rng.pick(['low', 'high']));
      this.patternCooldown = 100 + Math.floor(this.rng.next() * 60);
    } else if (tier === 1) {
      if (roll < 0.5) this._spawnSlowFlyer(this.rng.pick(['low', 'high']));
      else this._spawnFastFlyer('low');
      this.patternCooldown = 80 + Math.floor(this.rng.next() * 50);
    } else if (tier === 2) {
      if (roll < 0.3) {
        this._spawnSlowFlyer(this.rng.pick(['low', 'high']));
      } else if (roll < 0.7) {
        this._spawnFastFlyer(this.rng.pick(['low', 'high']));
      } else {
        this._spawnFastFlyer('low');
        this.patternCooldown = 40;
        this._spawnWalker();
      }
      if (this.patternCooldown <= 0) {
        this.patternCooldown = 70 + Math.floor(this.rng.next() * 40);
      }
    } else if (tier === 3) {
      if (roll < 0.2) this._spawnSlowFlyer('low');
      else if (roll < 0.55) this._spawnFastFlyer(this.rng.pick(['low', 'high']));
      else {
        this._spawnFastFlyer('high');
        this.patternCooldown = 35;
        this._spawnWalker();
      }
      if (this.patternCooldown <= 0) {
        this.patternCooldown = 55 + Math.floor(this.rng.next() * 35);
      }
    } else {
      if (roll < 0.15) this._spawnFastFlyer('low');
      else if (roll < 0.5) this._spawnFastFlyer('high');
      else if (roll < 0.75) {
        this._spawnFastFlyer(this.rng.pick(['low', 'high']));
        this.patternCooldown = 30;
        this._spawnWalker();
      } else {
        this._spawnFastFlyer('high');
        this._spawnFastFlyer('low');
      }
      if (this.patternCooldown <= 0) {
        this.patternCooldown = 45 + Math.floor(this.rng.next() * 30);
      }
    }

    if (tier >= 1 && this.rng.next() < 0.12 + tier * 0.04) {
      if (!this.enemies.some((e) => e.active && e.type === 'walker')) {
        this._spawnWalker();
      }
    }
  }

  _updateMachine() {
    const m = this.machine;
    let ax = 0;
    if (this.input.left) ax -= 1;
    if (this.input.right) ax += 1;

    if (ax !== 0) {
      m.vx += ax * 0.9;
      m.facing = ax > 0 ? 1 : -1;
      if (m.grounded && m.expression !== 'jump' && m.expression !== 'hit') {
        m.expression = 'move';
      }
    } else if (m.grounded) {
      m.vx *= 0.75;
      if (Math.abs(m.vx) < 0.1) {
        m.vx = 0;
        if (m.expression === 'move') m.expression = 'idle';
      }
    } else {
      m.vx *= 0.98;
    }

    m.vx = clamp(m.vx, -MACHINE_MAX_VX, MACHINE_MAX_VX);
    if (Math.abs(m.vx) > 0.3 && !m.grounded) {
      m.vx = clamp(m.vx, -MACHINE_MAX_VX * 0.7, MACHINE_MAX_VX * 0.7);
    }

    m.vy += GRAVITY;
    m.x += m.vx;
    m.y += m.vy;

    m.x = clamp(m.x, m.radius, STAGE_W - m.radius);

    const groundTop = GROUND_Y - m.radius;
    if (m.y >= groundTop) {
      if (!m.grounded && m.vy > 0) {
        this._pushEvent('machine_land', { source: 'machine' });
        m.squash = 1;
      }
      m.y = groundTop;
      m.vy = 0;
      m.grounded = true;
      m.jumpCount = 0;
      if (m.expression === 'jump') m.expression = 'idle';
    }

    if (m.squash > 0) m.squash -= 0.12;
    if (m.expressionTimer > 0) {
      m.expressionTimer -= 1;
      if (m.expressionTimer <= 0 && m.grounded && m.expression !== 'idle' && m.expression !== 'move') {
        m.expression = m.grounded && Math.abs(m.vx) > 0.3 ? 'move' : 'idle';
      }
    }
  }

  _bounceBall(kind) {
    const b = this.ball;
    const m = this.machine;
    b.onMachine = false;
    b.lastBounceKind = kind;
    b.x = m.x;
    b.y = m.y - m.radius - b.radius - 1;

    const hInfluence = clamp(m.vx * 0.22, -4, 4);

    if (kind === 'weak') {
      b.vy = -7.5;
      b.vx = hInfluence * 0.6;
      this._pushEvent('ball_bounce_weak', { source: 'ball' });
      m.expression = 'weak';
    } else if (kind === 'normal') {
      b.vy = -10.5;
      b.vx = hInfluence;
      this._pushEvent('ball_bounce_normal', { source: 'ball' });
      m.expression = 'ready';
      m.squash = 0.8;
    } else {
      b.vy = -13.5;
      b.vx = hInfluence * 1.3;
      this._pushEvent('ball_bounce_power', { source: 'ball' });
      m.expression = 'power';
      m.squash = 1;
    }
    m.expressionTimer = 18;
  }

  _detectBounceKind() {
    const m = this.machine;
    if (m.vy > 1.5) return 'weak';
    if (m.vy < -1) return 'power';
    return 'normal';
  }

  _updateBallMachineContact() {
    const b = this.ball;
    const m = this.machine;

    if (b.recoveryTimer > 0) {
      b.recoveryTimer -= 1;
      b.x = m.x;
      b.y = m.y - m.radius - b.radius - 2;
      b.vx = 0;
      b.vy = 0;
      b.onMachine = true;
      return;
    }

    if (b.onMachine) {
      b.x = m.x + Math.sin(this.tick * 0.08) * 0.5;
      b.y = m.y - m.radius - b.radius - 2 + Math.sin(this.tick * 0.12) * 1.5;
      return;
    }

    const topY = m.y - m.radius;
    const dx = b.x - m.x;
    const dy = b.y + b.radius - topY;

    if (b.vy > 0 && Math.abs(dx) < m.radius + b.radius - 2 && dy >= -4 && dy < 12) {
      const kind = this._detectBounceKind();
      this._bounceBall(kind);
    }
  }

  _updateBall() {
    const b = this.ball;
    if (!b.active || b.onMachine || b.recoveryTimer > 0) return;

    b.vy += GRAVITY;
    b.x += b.vx;
    b.y += b.vy;

    if (b.x < b.radius) {
      b.x = b.radius;
      b.vx = Math.abs(b.vx) * 0.7;
    }
    if (b.x > STAGE_W - b.radius) {
      b.x = STAGE_W - b.radius;
      b.vx = -Math.abs(b.vx) * 0.7;
    }

    if (b.y - b.radius > GROUND_Y + 4) {
      this._handleBallDrop();
    }
  }

  _handleBallDrop() {
    const b = this.ball;
    const m = this.machine;
    this.ballDrops += 1;
    this.currentCleanSequence = 0;
    this._removeTime(BALL_DROP_PENALTY_MS);
    this._pushEvent('ball_drop', { source: 'ball', amountMs: BALL_DROP_PENALTY_MS });
    m.expression = 'drop';
    m.expressionTimer = 40;

    b.vx = 0;
    b.vy = 0;
    b.onMachine = true;
    b.recoveryTimer = 55;
    b.lastBounceKind = null;
    b.y = m.y - m.radius - b.radius - 2;
    b.x = m.x;
  }

  _circleOverlap(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    const r = ar + br;
    return dx * dx + dy * dy < r * r;
  }

  _handleBallEnemy(enemy) {
    const b = this.ball;
    if (!enemy.active || b.onMachine || b.recoveryTimer > 0) return;

    const dx = b.x - enemy.x;
    const dy = b.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = b.radius + enemy.collisionRadius;
    if (dist >= minDist) {
      enemy.wrongSideCharged = false;
      return;
    }

    const nx = dx / (dist || 1);
    const ny = dy / (dist || 1);

    const isTopHit = b.vy > 0 && ny < -0.45 && b.y < enemy.y;

    if (isTopHit) {
      enemy.hitsTaken += 1;
      this.topHits += 1;
      this.currentCleanSequence += 1;
      if (this.currentCleanSequence > this.longestCleanSequence) {
        this.longestCleanSequence = this.currentCleanSequence;
      }

      const hitIndex = Math.min(enemy.hitsTaken, 3) - 1;
      const timeGain = TIME_REWARD[hitIndex];
      const scoreGain = SCORE_REWARD[hitIndex];
      this._addTime(timeGain);
      this.score += scoreGain;
      this._updateDifficulty();

      this._pushEvent('top_hit', {
        source: 'ball',
        contact: 'top',
        enemyId: enemy.id,
        amountMs: timeGain,
      });

      this.machine.expression = 'hit';
      this.machine.expressionTimer = 20;

      b.vy = -Math.abs(b.vy) * 0.85 - 4;
      b.vx += enemy.vx * 0.3 + nx * 2;
      b.y = enemy.y - enemy.collisionRadius - b.radius - 1;

      if (enemy.hitsTaken >= enemy.hitsRequired) {
        enemy.active = false;
        enemy.defeatTimer = 45;
        this.airEnemiesDefeated += 1;
        if (enemy.type === 'slowFlyer' || enemy.type === 'fastFlyer') {
          if (!this.firstAirDestroyed) {
            this.firstAirDestroyed = true;
            this.spawnTimer = 60;
          }
        }
        this._pushEvent('enemy_defeated', {
          source: 'ball',
          contact: 'top',
          enemyId: enemy.id,
          amountMs: timeGain,
        });
      }
    } else if (!enemy.wrongSideCharged) {
      enemy.wrongSideCharged = true;
      this.wrongSideHits += 1;
      this.currentCleanSequence = 0;
      this._removeTime(WRONG_SIDE_PENALTY_MS);
      this._pushEvent('wrong_side_hit', {
        source: 'ball',
        contact: 'non_top',
        enemyId: enemy.id,
        amountMs: WRONG_SIDE_PENALTY_MS,
      });
      this.machine.expression = 'bite';
      this.machine.expressionTimer = 25;
      b.vx = nx * Math.abs(b.vx) * 0.6 + 2 * nx;
      b.vy = ny * Math.abs(b.vy) * 0.4;
    }
  }

  _handleMachineEnemy(enemy) {
    if (!enemy.active || enemy.type !== 'walker') return;
    const m = this.machine;
    const dx = m.x - enemy.x;
    const dy = m.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = m.radius + enemy.collisionRadius;

    if (dist >= minDist) {
      enemy.bodyCharged = false;
      return;
    }

    const stomp = m.vy > 2 && m.y < enemy.y - 4;
    if (stomp) {
      enemy.active = false;
      enemy.defeatTimer = 30;
      this.score += 50;
      this._updateDifficulty();
      this._pushEvent('ground_stomp', {
        source: 'machine',
        contact: 'top',
        enemyId: enemy.id,
      });
      m.vy = MACHINE_JUMP_VY * 0.55;
      m.grounded = false;
    } else if (!enemy.bodyCharged) {
      enemy.bodyCharged = true;
      this._removeTime(WALKER_BODY_PENALTY_MS);
      this._pushEvent('wrong_side_hit', {
        source: 'machine',
        contact: 'body',
        enemyId: enemy.id,
        amountMs: WALKER_BODY_PENALTY_MS,
      });
      m.expression = 'bite';
      m.expressionTimer = 20;
      m.vx = dx > 0 ? 3 : -3;
    }
  }

  _updateEnemies() {
    for (const e of this.enemies) {
      if (!e.active) {
        if (e.defeatTimer > 0) e.defeatTimer -= 1;
        continue;
      }
      e.x += e.vx;
      if (e.x < -60 || e.x > STAGE_W + 60) {
        e.active = false;
        e.defeatTimer = 1;
      }
    }
  }

  step() {
    if (this.phase === 'ended') return;

    const hadInput = this.input.left || this.input.right || this.input.jumpQueued;
    if (this.phase === 'ready') {
      if (hadInput || this.heldInput.left || this.heldInput.right || this.heldInput.jumpQueued) {
        this.phase = 'playing';
        this.input = { ...this.heldInput };
        this.needsOpeningBounce = true;
      } else {
        return;
      }
    }

    this._consumeJumpQueue();

    if (this.needsOpeningBounce) {
      this.needsOpeningBounce = false;
      this._bounceBall('normal');
    }

    if (this.phase === 'playing') {
      this.elapsedMs += TICK_MS;
      this.remainingMs -= DRAIN_MS_PER_TICK;
      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.phase = 'ended';
        this.machine.expression = 'spent';
        if (this.score > this.sessionBest) {
          this.sessionBest = this.score;
          try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('stomp-best', String(this.score));
          }
        } catch { /* ignore */ }
        }
      }
    }

    this._updateMachine();
    this._updateBall();
    this._updateBallMachineContact();
    this._updateBall();

    for (const e of this.enemies) {
      if (e.type !== 'walker') this._handleBallEnemy(e);
      this._handleMachineEnemy(e);
    }

    this._updateEnemies();
    this._updateSpawning();

    this.tick += 1;
  }

  advance(ms) {
    if (this.phase === 'ready' || this.phase === 'ended') return;
    const ticks = Math.floor(ms / TICK_MS);
    for (let i = 0; i < ticks; i++) {
      this.input = { ...this.heldInput };
      this.step();
      if (this.phase === 'ended') break;
    }
  }

  snapshot() {
    const enemies = [...this.enemies]
      .sort((a, b) => a.id - b.id)
      .map((e) => ({
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
      }));

    return {
      run: {
        phase: this.phase,
        tick: this.tick,
        elapsedMs: this.elapsedMs,
        remainingMs: this.remainingMs,
        seed: this.seed,
        rngState: this.rng.state(),
        score: this.score,
        difficulty: this.difficulty,
        rank: this.rank,
        input: { ...this.input },
      },
      geometry: {
        groundY: GROUND_Y,
        lowLaneY: LOW_LANE_Y,
        highLaneY: HIGH_LANE_Y,
        machineNormalApexY: MACHINE_NORMAL_APEX_Y,
      },
      machine: {
        x: this.machine.x,
        y: this.machine.y,
        vx: this.machine.vx,
        vy: this.machine.vy,
        radius: this.machine.radius,
        grounded: this.machine.grounded,
        jumpCount: this.machine.jumpCount,
      },
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        radius: this.ball.radius,
        active: this.ball.active,
        lastBounceKind: this.ball.lastBounceKind,
      },
      counters: {
        topHits: this.topHits,
        airEnemiesDefeated: this.airEnemiesDefeated,
        wrongSideHits: this.wrongSideHits,
        ballDrops: this.ballDrops,
        longestCleanSequence: this.longestCleanSequence,
      },
      enemies,
      recentEvents: this.recentEvents.map((e) => ({ ...e })),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
    };
  }

  getPresentationState() {
    return {
      phase: this.phase,
      remainingMs: this.remainingMs,
      score: this.score,
      rank: this.rank,
      sessionBest: this.sessionBest,
      airEnemiesDefeated: this.airEnemiesDefeated,
      longestCleanSequence: this.longestCleanSequence,
      machine: this.machine,
      ball: this.ball,
      enemies: this.enemies,
      tick: this.tick,
      difficulty: this.difficulty,
    };
  }
}

export function createGameApi(sim) {
  return {
    reset(seed) {
      sim.reset(seed ?? Date.now());
    },
    snapshot() {
      return sim.snapshot();
    },
    advance(ms) {
      sim.advance(ms);
    },
  };
}
