import { CourseGenerator, PREVIEW_HORIZON_DISTANCE, PLAYER_RADIUS } from './course.js';

export { PLAYER_RADIUS };
export const CRAWL_SPEED = 42;
export const MAX_SPEED = 200;
export const ACCELERATION = 220;
export const DECELERATION = 140;
export const INITIAL_REMAINING_MS = 25000;
export const MAX_REMAINING_MS = 30000;
export const FIXED_DT_MS = 1000 / 60; // 16.6666667 ms
export const FIXED_DT_SEC = 1 / 60;

export class DelveGame {
  constructor(seed = 1337) {
    this.initialSeed = seed;
    this.course = new CourseGenerator(seed);
    this.sessionBestScore = 0;
    this.reset(seed);
  }

  reset(seed = this.initialSeed) {
    this.seed = seed >>> 0;
    this.course.reset(this.seed);

    this.phase = 'ready'; // 'ready' | 'playing' | 'gameover'
    this.tick = 0;
    this.elapsedMs = 0;
    this.timeMs = 0;
    this.remainingMs = INITIAL_REMAINING_MS;
    this.difficulty = 1.0;
    this.score = 0;
    this.depth = 0;

    // Player state
    this.x = 0;
    this.playerRadius = PLAYER_RADIUS;
    this.speed = CRAWL_SPEED;
    this.maxSpeed = MAX_SPEED;

    // Counters
    this.hits = 0;
    this.wallContacts = 0;
    this.fragmentsCollected = 0;
    this.rocksBroken = 0;
    this.invincibleUntilMs = 0;
    this.rank = null;

    // Inputs
    this.input = {
      down: false,
      left: false,
      right: false
    };

    // Events history
    this.events = [];
    this.eventSeq = 0;
    this.lastEvent = null;

    // Internal simulation & juice counters
    this.wallContactCooldown = 0;
    this.nearMissStreak = 0;
    this.lastNearMissTick = 0;
    this.closestShave = 999;
    this.fullThrottleDuration = 0;
    this.longestThrottleStreak = 0;
    this.currentThrottleStreak = 0;

    // Time step accumulator for advance()
    this.timeAccumulator = 0;
  }

  recordEvent(kind) {
    this.eventSeq++;
    const evt = {
      seq: this.eventSeq,
      kind: kind,
      tick: this.tick
    };
    this.events.push(evt);
    if (this.events.length > 150) {
      this.events.shift();
    }
    this.lastEvent = evt;
    return evt;
  }

  setInput(down, left, right) {
    this.input.down = !!down;
    this.input.left = !!left;
    this.input.right = !!right;

    // First accelerator input starts the run from 'ready'
    if (this.phase === 'ready' && (this.input.down || this.input.left || this.input.right)) {
      this.phase = 'playing';
    }
  }

  advance(ms) {
    if (this.phase === 'ready' || this.phase === 'gameover' || ms <= 0) {
      return;
    }

    this.timeAccumulator += ms;
    while (this.timeAccumulator >= FIXED_DT_MS) {
      if (this.phase !== 'playing') break;
      this.step();
      this.timeAccumulator -= FIXED_DT_MS;
    }
  }

  step() {
    if (this.phase !== 'playing') return;

    this.tick++;
    this.elapsedMs += FIXED_DT_MS;
    this.timeMs += FIXED_DT_MS;
    this.remainingMs = Math.max(0, this.remainingMs - FIXED_DT_MS);

    const prevDepth = this.depth;
    const isPowered = this.timeMs < this.invincibleUntilMs;

    // 1. Longitudinal Speed (Depth progress)
    if (this.input.down) {
      this.speed = Math.min(this.maxSpeed, this.speed + ACCELERATION * FIXED_DT_SEC);
      this.currentThrottleStreak += FIXED_DT_SEC;
      if (this.currentThrottleStreak > this.longestThrottleStreak) {
        this.longestThrottleStreak = this.currentThrottleStreak;
      }
    } else {
      this.speed = Math.max(CRAWL_SPEED, this.speed - DECELERATION * FIXED_DT_SEC);
      this.currentThrottleStreak = 0;
    }

    this.depth += this.speed * FIXED_DT_SEC;
    this.difficulty = Math.round((1.0 + this.depth / 10000) * 100) / 100;

    // 2. Lateral Steering Authority
    // At crawl speed (42), high steering rate (~195 units/s)
    // At max speed (200), low steering rate (~68 units/s)
    const speedRatio = (this.speed - CRAWL_SPEED) / (this.maxSpeed - CRAWL_SPEED);
    const steerAuthority = 195 - speedRatio * 127;

    let steerDir = 0;
    if (this.input.left && !this.input.right) steerDir = -1;
    if (this.input.right && !this.input.left) steerDir = 1;

    this.x += steerDir * steerAuthority * FIXED_DT_SEC;

    // 3. Wall Collisions
    const corridorCenter = this.course.getCenter(this.depth);
    const halfW = this.course.getHalfWidth(this.depth);
    const leftWall = corridorCenter - halfW;
    const rightWall = corridorCenter + halfW;

    if (this.wallContactCooldown > 0) {
      this.wallContactCooldown--;
    }

    let hitWall = false;
    if (this.x - this.playerRadius <= leftWall) {
      this.x = leftWall + this.playerRadius;
      hitWall = true;
    } else if (this.x + this.playerRadius >= rightWall) {
      this.x = rightWall - this.playerRadius;
      hitWall = true;
    }

    if (hitWall) {
      if (this.wallContactCooldown === 0) {
        this.wallContacts++;
        this.speed = CRAWL_SPEED; // Speed collapses to idle crawl within instant
        this.wallContactCooldown = 15; // 0.25s cooldown
        this.recordEvent('wall_contact');
      }
    }

    // 4. Entities (Rocks, Items, Near-miss)
    const { rocks, items } = this.course.getEntitiesInHorizon(this.depth);

    // Check rock collisions and near-misses
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (!rock.active) continue;

      const rDepth = rock.position.depth;
      const rX = rock.position.x;
      const rRad = rock.collisionRadius;

      // Distance check
      const dx = this.x - rX;
      const dd = this.depth - rDepth;
      const dist = Math.sqrt(dx * dx + dd * dd);

      if (dist <= this.playerRadius + rRad) {
        // Direct Hit!
        rock.active = false;
        if (isPowered) {
          this.rocksBroken++;
          this.remainingMs = Math.min(MAX_REMAINING_MS, this.remainingMs + 1800);
          this.recordEvent('rock_broken');
        } else {
          this.hits++;
          this.speed = CRAWL_SPEED;
          this.recordEvent('rock_hit');
        }
      } else if (prevDepth < rDepth && this.depth >= rDepth) {
        // Player just passed the rock's depth without hitting it -> Check Near Miss
        const lateralGap = Math.abs(dx) - this.playerRadius - rRad;
        const oneMachineWidth = this.playerRadius * 2;

        if (lateralGap >= 0 && lateralGap < oneMachineWidth) {
          // Near miss!
          this.recordEvent('near_miss');
          if (this.tick - this.lastNearMissTick < 180) {
            this.nearMissStreak++;
          } else {
            this.nearMissStreak = 1;
          }
          this.lastNearMissTick = this.tick;
          if (lateralGap < this.closestShave) {
            this.closestShave = Math.round(lateralGap * 10) / 10;
          }
        }
      }
    }

    // Check item pickups (Fragments and Power items)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.active) continue;

      const iDepth = item.position.depth;
      const iX = item.position.x;
      const iRad = item.collisionRadius;

      const dx = this.x - iX;
      const dd = this.depth - iDepth;
      const dist = Math.sqrt(dx * dx + dd * dd);

      if (dist <= this.playerRadius + iRad) {
        item.active = false;
        if (item.type === 'fragment') {
          this.fragmentsCollected++;
          this.remainingMs = Math.min(MAX_REMAINING_MS, this.remainingMs + 1800);
          this.recordEvent('fragment');
        } else if (item.type === 'power') {
          this.invincibleUntilMs = this.timeMs + 7000;
          this.recordEvent('power');
        }
      }
    }

    // 5. Score calculation
    this.score = Math.floor(
      this.depth * 1.0 +
      this.fragmentsCollected * 45 +
      this.rocksBroken * 120
    );

    // 6. Check Game Over
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'gameover';
      this.rank = this._calculateRank(this.score);
      if (this.score > this.sessionBestScore) {
        this.sessionBestScore = this.score;
      }
    }
  }

  _calculateRank(score) {
    if (score >= 26000) return 'S';
    if (score >= 17000) return 'A';
    if (score >= 9500) return 'B';
    if (score >= 4200) return 'C';
    return 'D';
  }

  getSignatureStat() {
    if (this.longestThrottleStreak >= 10) {
      return {
        label: 'Throttle Demon',
        value: `${Math.round(this.longestThrottleStreak * 10) / 10}s Full Throttle`
      };
    } else if (this.closestShave < 10) {
      return {
        label: 'Closest Shave',
        value: `${this.closestShave}px Grazed Gap`
      };
    } else if (this.rocksBroken >= 5) {
      return {
        label: 'Rock Crusher',
        value: `${this.rocksBroken} Boulders Smashed`
      };
    } else {
      return {
        label: 'Deepest Delve',
        value: `${Math.floor(this.depth)}m Below Surface`
      };
    }
  }

  snapshot() {
    const horizonMax = this.depth + PREVIEW_HORIZON_DISTANCE;
    const { rocks, items } = this.course.getEntitiesInHorizon(this.depth);
    const walls = this.course.sampleWalls(this.depth, horizonMax, 25);
    const safeHW = this.course.computeSafeHalfWidth(this.depth, horizonMax);
    const previewMs = Math.round((PREVIEW_HORIZON_DISTANCE / MAX_SPEED) * 1000);

    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.round(this.elapsedMs * 100) / 100,
      timeMs: Math.round(this.timeMs * 100) / 100,
      remainingMs: Math.round(this.remainingMs * 100) / 100,
      seed: this.seed,
      rngState: this.course.prng.getState(),
      spawnIndex: this.course.generatedDepth,
      input: {
        down: this.input.down,
        left: this.input.left,
        right: this.input.right
      },
      difficulty: this.difficulty,
      score: this.score,
      depth: Math.round(this.depth * 100) / 100,
      x: Math.round(this.x * 100) / 100,
      playerRadius: this.playerRadius,
      speed: Math.round(this.speed * 100) / 100,
      maxSpeed: this.maxSpeed,
      hits: this.hits,
      wallContacts: this.wallContacts,
      fragmentsCollected: this.fragmentsCollected,
      rocksBroken: this.rocksBroken,
      invincibleUntilMs: Math.round(this.invincibleUntilMs * 100) / 100,
      rank: this.rank,
      courseCenterX: Math.round(this.course.getCenter(this.depth) * 100) / 100,
      corridorHalfWidth: Math.round(this.course.getHalfWidth(this.depth) * 100) / 100,
      walls: walls,
      safeHalfWidth: safeHW,
      previewMs: previewMs,
      rocks: rocks.map(r => ({
        id: r.id,
        position: {
          x: r.position.x,
          depth: r.position.depth
        },
        active: r.active,
        visualRadius: r.visualRadius,
        collisionRadius: r.collisionRadius
      })),
      items: items.map(it => {
        const obj = {
          id: it.id,
          type: it.type,
          position: {
            x: it.position.x,
            depth: it.position.depth
          },
          active: it.active,
          visualRadius: it.visualRadius,
          collisionRadius: it.collisionRadius
        };
        if (it.type === 'fragment') {
          obj.formationId = it.formationId;
          obj.formationKind = it.formationKind;
          obj.formationIndex = it.formationIndex;
        }
        return obj;
      }),
      events: this.events.slice(),
      lastEvent: this.lastEvent
    };
  }
}
