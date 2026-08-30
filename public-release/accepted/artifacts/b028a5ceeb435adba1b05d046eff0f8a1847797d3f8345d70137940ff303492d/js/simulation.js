import { createRng, roundStable } from './rng.js';
import {
  TICK_MS,
  PRECISION,
  CRAWL_SPEED,
  CRUISE_SPEED,
  MAX_SPEED,
  INITIAL_TIME_MS,
  FRAGMENT_TIME_MS,
  POWER_TIME_MS,
  POWER_DURATION_MS,
  STALL_MS,
  PLAYER_RADIUS,
  NEAR_MISS_DIST,
  PREVIEW_DEPTH,
  SPAWN_AHEAD,
  DESPAWN_BEHIND,
  BASE_HALF_WIDTH,
  MIN_HALF_WIDTH,
  RANKS,
  FORMATION_KINDS,
} from './constants.js';

function courseCenterX(depth, seed) {
  const d = depth * 0.0048;
  const w1 = Math.sin(d * 1.15 + seed * 0.01) * 62;
  const w2 = Math.sin(d * 2.45 + 1.7) * 32;
  const w3 = Math.sin(d * 0.62 + 0.4) * 42;
  const switchback = Math.sin(d * 0.32) > 0.55 ? Math.sin(d * 4.5) * 48 : 0;
  const hairpin = Math.sin(d * 0.18 + 2.1) > 0.82 ? Math.sin(d * 6.2) * 35 : 0;
  return w1 + w2 + w3 + switchback + hairpin;
}

function corridorHalfWidth(depth, difficulty) {
  const taper = Math.max(MIN_HALF_WIDTH, BASE_HALF_WIDTH - difficulty * 18);
  const ripple = Math.sin(depth * 0.012) * 8;
  return taper + ripple;
}

function difficultyAt(depth) {
  return Math.min(3.5, depth / 2200);
}

function rankForScore(score) {
  let grade = 'D';
  for (const r of RANKS) {
    if (score >= r.min) grade = r.grade;
  }
  return grade;
}

let nextEntityId = 1;

export class DelveSimulation {
  constructor() {
    this.visualState = {
      nearMissStreak: 0,
      shake: 0,
      flash: 0,
      lastMood: 'ready',
    };
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed >>> 0 || 1;
    this.rng = createRng(this.seed);
    nextEntityId = 1;

    this.phase = 'ready';
    this.tick = 0;
    this.elapsedMs = 0;
    this.timeMs = 0;
    this.remainingMs = INITIAL_TIME_MS;
    this.spawnIndex = 0;
    this.difficulty = 0;
    this.score = 0;
    this.depth = 0;
    this.hits = 0;
    this.wallContacts = 0;
    this.fragmentsCollected = 0;
    this.rocksBroken = 0;
    this.invincibleUntilMs = 0;
    this.rank = null;

    this.input = { accelerate: false, steer: 0 };
    this.player = {
      x: 0,
      playerRadius: PLAYER_RADIUS,
      speed: CRAWL_SPEED,
      maxSpeed: MAX_SPEED,
      vx: 0,
    };

    this.stallUntilMs = 0;
    this.stallStartMs = 0;
    this.stallFromSpeed = CRAWL_SPEED;
    this.wallTouching = false;
    this.events = [];
    this.eventSeq = 0;
    this.nearMissedRocks = new Set();

    this.rocks = [];
    this.items = [];
    this.wallSamples = [];

    this.nextSpawnDepth = 80;
    this.formationCounter = 0;
    this.powerPlaced = 0;
    this.powerTargetDepth = this._powerFirstDepth();

    this.stats = {
      maxDepth: 0,
      maxSpeedHeldMs: 0,
      currentFullThrottleMs: 0,
      longestFullThrottleMs: 0,
      closestShave: Infinity,
    };

    this._pregenerate(0, SPAWN_AHEAD);
    this.visualState = {
      nearMissStreak: 0,
      shake: 0,
      flash: 0,
      lastMood: 'ready',
    };
  }

  _powerFirstDepth() {
    const rng = createRng(this.seed ^ 0x9e3779b9);
    return rng.float(500, 3200);
  }

  _emit(kind) {
    this.eventSeq += 1;
    const ev = { seq: this.eventSeq, kind, tick: this.tick };
    this.events.push(ev);
    if (this.events.length > 100) this.events.shift();
    this.lastEvent = ev;
    return ev;
  }

  _pregenerate(fromDepth, toDepth) {
    while (this.nextSpawnDepth < toDepth) {
      this._spawnChunk();
    }
  }

  _spawnChunk() {
    const depth = this.nextSpawnDepth;
    const diff = difficultyAt(depth);
    const rng = this.rng;

    if (this.powerPlaced < 2 && depth >= this.powerTargetDepth) {
      const cx = courseCenterX(depth, this.seed);
      this.items.push({
        id: nextEntityId++,
        type: 'power',
        position: { x: cx, depth },
        active: true,
        visualRadius: 14,
        collisionRadius: 12,
      });
      this.powerPlaced += 1;
      if (this.powerPlaced === 1) {
        this.powerTargetDepth = depth + this.rng.float(3500, 7000);
      }
    }

    const roll = rng.next();
    if (roll < 0.38) {
      this._spawnFormation(depth, diff);
    } else if (roll < 0.62) {
      this._spawnRocks(depth, diff, rng.int(1, 2));
    } else if (roll < 0.78) {
      this._spawnRocks(depth + 60, diff, rng.int(2, 3));
    }

    this.nextSpawnDepth += rng.float(55, 110);
    this.spawnIndex += 1;
  }

  _spawnFormation(startDepth, diff) {
    const kind = FORMATION_KINDS[this.formationCounter % FORMATION_KINDS.length];
    this.formationCounter += 1;
    const fid = this.formationCounter;
    const cx = courseCenterX(startDepth, this.seed);
    const hw = corridorHalfWidth(startDepth, diff);
    const spacing = 38;
    const offsets = this._formationOffsets(kind, hw);
    offsets.forEach((ox, i) => {
      const d = startDepth + i * spacing;
      const center = courseCenterX(d, this.seed);
      this.items.push({
        id: nextEntityId++,
        type: 'fragment',
        position: { x: center + ox, depth: d },
        active: true,
        visualRadius: 9,
        collisionRadius: 8,
        formationId: fid,
        formationKind: kind,
        formationIndex: i,
      });
    });
  }

  _formationOffsets(kind, hw) {
    const w = hw * 0.55;
    switch (kind) {
      case 'line':
        return [-w * 0.35, -w * 0.1, w * 0.15, w * 0.4].slice(0, 4);
      case 'chevron':
        return [-w * 0.85, -w * 0.25, w * 0.25, w * 0.85];
      case 'triangle':
        return [-w * 0.55, w * 0.55, 0, w * 0.15];
      case 'arc':
        return [-w * 0.75, -w * 0.25, w * 0.2, w * 0.65];
      case 'vee':
        return [w * 0.65, w * 0.15, -w * 0.15, -w * 0.65];
      default:
        return [-w * 0.4, 0, w * 0.4];
    }
  }

  _spawnRocks(depth, diff, count) {
    const cx = courseCenterX(depth, this.seed);
    const hw = corridorHalfWidth(depth, diff);
    const gap = hw * this.rng.float(0.35, 0.75);
    const side = this.rng.next() < 0.5 ? -1 : 1;

    for (let i = 0; i < count; i++) {
      const d = depth + i * 45;
      const center = courseCenterX(d, this.seed);
      const half = corridorHalfWidth(d, diff);
      const size = this.rng.float(10, 22 + diff * 4);
      let x;
      if (i === 0 && count > 1) {
        x = center + side * (half - size - 8);
      } else {
        const lane = this.rng.float(-half + size + 12, half - size - 12);
        if (Math.abs(lane) < gap) {
          x = center + lane + side * (gap + size);
        } else {
          x = center + lane;
        }
      }
      this.rocks.push({
        id: nextEntityId++,
        position: { x, depth: d },
        active: true,
        visualRadius: size,
        collisionRadius: size * 0.88,
      });
    }
  }

  _wallBounds(depth) {
    const cx = courseCenterX(depth, this.seed);
    const hw = corridorHalfWidth(depth, difficultyAt(depth));
    return { cx, hw, leftX: cx - hw, rightX: cx + hw };
  }

  advance(ms) {
    if (this.phase === 'ready' || this.phase === 'gameover') return;
    const ticks = Math.round(ms / TICK_MS);
    for (let i = 0; i < ticks; i++) this._step();
  }

  _step() {
    if (this.phase !== 'playing') return;

    const dt = TICK_MS / 1000;
    this.tick += 1;
    this.elapsedMs += TICK_MS;
    this.timeMs = this.elapsedMs;
    this.remainingMs -= TICK_MS;

    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'gameover';
      this.rank = rankForScore(this.score);
      return;
    }

    this.difficulty = difficultyAt(this.depth);
    this._updatePhysics(dt);
    this._movePlayer(dt);
    this._collisions();
    this._collectItems();
    this._checkNearMisses();
    this._updateScore();
    this._cleanup();
    this._pregenerate(this.depth, this.depth + SPAWN_AHEAD);
  }

  startPlay() {
    if (this.phase === 'ready') {
      this.phase = 'playing';
    }
  }

  setInput(input) {
    const prev = this.input.accelerate;
    this.input = {
      accelerate: !!input.accelerate,
      steer: Math.max(-1, Math.min(1, input.steer || 0)),
    };
    if (this.phase === 'ready' && this.input.accelerate) {
      this.startPlay();
    }
    if (this.input.accelerate && this.player.speed > MAX_SPEED * 0.92) {
      this.stats.currentFullThrottleMs += TICK_MS;
      if (this.stats.currentFullThrottleMs > this.stats.longestFullThrottleMs) {
        this.stats.longestFullThrottleMs = this.stats.currentFullThrottleMs;
      }
    } else {
      this.stats.currentFullThrottleMs = 0;
    }
  }

  _updatePhysics(dt) {
    const p = this.player;
    const now = this.timeMs;

    if (now < this.stallUntilMs) {
      const elapsed = now - this.stallStartMs;
      const t = Math.min(1, elapsed / STALL_MS);
      const ease = 1 - (1 - t) ** 3;
      p.speed = this.stallFromSpeed + (CRAWL_SPEED - this.stallFromSpeed) * ease;
      p.speed = Math.max(CRAWL_SPEED, p.speed);
    } else if (this.input.accelerate) {
      const accel = 280;
      p.speed = Math.min(MAX_SPEED, p.speed + accel * dt);
    } else {
      const decay = 120;
      p.speed = Math.max(CRAWL_SPEED, p.speed - decay * dt);
    }
    p.speed = Math.max(CRAWL_SPEED, p.speed);

    const speedRatio = (p.speed - CRAWL_SPEED) / (MAX_SPEED - CRAWL_SPEED);
    const steerCap = 210 * (1 - speedRatio * 0.88);
    const steerForce = this.input.steer * steerCap;
    const damping = 6 + speedRatio * 10;
    p.vx += (steerForce - p.vx) * Math.min(1, damping * dt);
    const lateralCap = steerCap * 0.5 * (1 - speedRatio * 0.35);
    p.vx = Math.max(-lateralCap, Math.min(lateralCap, p.vx));
  }

  _movePlayer(dt) {
    const p = this.player;
    p.x += p.vx * dt;
    this.depth += p.speed * dt;
    if (this.depth > this.stats.maxDepth) this.stats.maxDepth = this.depth;
  }

  _collisions() {
    const p = this.player;
    const pr = p.playerRadius;
    const d = this.depth;
    const wall = this._wallBounds(d);
    const leftLimit = wall.leftX + pr;
    const rightLimit = wall.rightX - pr;

    if (p.x < leftLimit) {
      p.x = leftLimit;
      if (!this.wallTouching) {
        this.wallTouching = true;
        this._wallHit();
      }
    } else if (p.x > rightLimit) {
      p.x = rightLimit;
      if (!this.wallTouching) {
        this.wallTouching = true;
        this._wallHit();
      }
    } else {
      this.wallTouching = false;
    }

    const invincible = this.timeMs < this.invincibleUntilMs;

    for (const rock of this.rocks) {
      if (!rock.active) continue;
      const dx = p.x - rock.position.x;
      const dy = d - rock.position.depth;
      const dist = Math.hypot(dx, dy);
      const touch = pr + rock.collisionRadius;
      if (dist < touch) {
        if (invincible) {
          rock.active = false;
          this.rocksBroken += 1;
          this.remainingMs += POWER_TIME_MS;
          this._emit('rock_broken');
        } else {
          rock.active = false;
          this.hits += 1;
          this._stall();
          this._emit('rock_hit');
        }
      }
    }
  }

  _wallHit() {
    if (this.timeMs < this.stallUntilMs) return;
    this.wallContacts += 1;
    this._stall();
    this._emit('wall_contact');
  }

  _stall() {
    this.stallStartMs = this.timeMs;
    this.stallUntilMs = this.timeMs + STALL_MS;
    this.stallFromSpeed = this.player.speed;
    this.player.vx *= 0.3;
  }

  _collectItems() {
    const p = this.player;
    const pr = p.playerRadius;
    for (const item of this.items) {
      if (!item.active) continue;
      const dx = p.x - item.position.x;
      const dy = this.depth - item.position.depth;
      if (Math.hypot(dx, dy) < pr + item.collisionRadius) {
        item.active = false;
        if (item.type === 'fragment') {
          this.fragmentsCollected += 1;
          this.remainingMs += FRAGMENT_TIME_MS;
          this._emit('fragment');
        } else if (item.type === 'power') {
          this.invincibleUntilMs = this.timeMs + POWER_DURATION_MS;
          this._emit('power');
        }
      }
    }
  }

  _checkNearMisses() {
    const p = this.player;
    const pr = p.playerRadius;
    for (const rock of this.rocks) {
      if (!rock.active || this.nearMissedRocks.has(rock.id)) continue;
      const dy = this.depth - rock.position.depth;
      if (dy < 0 || dy > pr + rock.collisionRadius + 4) continue;
      const dx = Math.abs(p.x - rock.position.x);
      const edgeGap = dx - (pr + rock.collisionRadius);
      if (edgeGap >= 0 && edgeGap < NEAR_MISS_DIST) {
        this.nearMissedRocks.add(rock.id);
        this._emit('near_miss');
        const shave = edgeGap;
        if (shave < this.stats.closestShave) this.stats.closestShave = shave;
      }
    }
  }

  _updateScore() {
    this.score = this.depth * 0.45;
  }

  _cleanup() {
    const minD = this.depth - DESPAWN_BEHIND;
    this.rocks = this.rocks.filter((r) => r.active || r.position.depth > minD);
    this.items = this.items.filter((i) => i.active || i.position.depth > minD);
  }

  _sampleWalls() {
    const start = this.depth;
    const step = 30;
    const samples = [];
    for (let d = start; d < start + PREVIEW_DEPTH; d += step) {
      const w = this._wallBounds(d);
      samples.push({
        depth: roundStable(d),
        leftX: roundStable(w.leftX),
        rightX: roundStable(w.rightX),
      });
    }
    return samples;
  }

  _safeHalfWidth() {
    const p = this.player;
    const start = this.depth;
    const step = 40;
    let minGap = Infinity;
    for (let d = start; d < start + PREVIEW_DEPTH; d += step) {
      const w = this._wallBounds(d);
      let left = w.leftX;
      let right = w.rightX;
      for (const rock of this.rocks) {
        if (!rock.active) continue;
        if (Math.abs(rock.position.depth - d) > 25) continue;
        const rLeft = rock.position.x - rock.collisionRadius;
        const rRight = rock.position.x + rock.collisionRadius;
        if (rLeft > left && rLeft < right) {
          if (rock.position.x < w.cx) left = Math.max(left, rRight);
          else right = Math.min(right, rLeft);
        }
      }
      const gap = (right - left) * 0.5 - p.playerRadius;
      minGap = Math.min(minGap, gap);
    }
    return roundStable(Math.max(0, minGap));
  }

  _previewMs() {
    const steerTime = (PREVIEW_DEPTH * 0.6) / (MAX_SPEED * 0.55);
    return roundStable(steerTime * 1000, 1);
  }

  snapshot() {
    const sortById = (a, b) => a.id - b.id;
    const horizon = this.depth + PREVIEW_DEPTH;

    const rocks = this.rocks
      .filter((r) => r.position.depth <= horizon)
      .map((r) => ({
        id: r.id,
        position: { x: roundStable(r.position.x), depth: roundStable(r.position.depth) },
        active: r.active,
        visualRadius: roundStable(r.visualRadius),
        collisionRadius: roundStable(r.collisionRadius),
      }))
      .sort(sortById);

    const items = this.items
      .filter((i) => i.position.depth <= horizon)
      .map((i) => {
        const base = {
          id: i.id,
          type: i.type,
          position: { x: roundStable(i.position.x), depth: roundStable(i.position.depth) },
          active: i.active,
          visualRadius: roundStable(i.visualRadius),
          collisionRadius: roundStable(i.collisionRadius),
        };
        if (i.type === 'fragment') {
          base.formationId = i.formationId;
          base.formationKind = i.formationKind;
          base.formationIndex = i.formationIndex;
        }
        return base;
      })
      .sort(sortById);

    const w = this._wallBounds(this.depth);

    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      timeMs: this.timeMs,
      remainingMs: roundStable(this.remainingMs, 1),
      seed: this.seed,
      rngState: this.rng.state,
      spawnIndex: this.spawnIndex,
      input: { ...this.input },
      difficulty: roundStable(this.difficulty),
      score: roundStable(this.score),
      depth: roundStable(this.depth),
      x: roundStable(this.player.x),
      playerRadius: roundStable(this.player.playerRadius),
      speed: roundStable(this.player.speed),
      maxSpeed: roundStable(this.player.maxSpeed),
      hits: this.hits,
      wallContacts: this.wallContacts,
      fragmentsCollected: this.fragmentsCollected,
      rocksBroken: this.rocksBroken,
      invincibleUntilMs: roundStable(this.invincibleUntilMs, 1),
      rank: this.rank,
      courseCenterX: roundStable(w.cx),
      corridorHalfWidth: roundStable(w.hw),
      walls: this._sampleWalls(),
      safeHalfWidth: this._safeHalfWidth(),
      previewMs: this._previewMs(),
      rocks,
      items,
      events: this.events.map((e) => ({ ...e })),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
    };
  }
}

export function createGame() {
  const sim = new DelveSimulation();
  return {
    sim,
    reset(seed) {
      sim.reset(seed);
    },
    snapshot() {
      return sim.snapshot();
    },
    advance(ms) {
      sim.advance(ms);
    },
  };
}
