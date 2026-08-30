/**
 * Core DELVE Game Simulation Engine
 * Implements deterministic 60Hz physics, rules, event dispatch, and runtime interface.
 */
class DelveGame {
  constructor(seed = 12345) {
    this.PREVIEW_HORIZON = 1200; // World units ahead
    this.PLAYER_RADIUS = 18;
    this.CRAWL_SPEED = 120;
    this.MAX_SPEED = 540;
    this.ACCEL_RATE = 380; // Units/s^2
    this.COAST_DECAY = 240; // Units/s^2
    this.START_TIME_MS = 18000; // 18 seconds initial countdown
    this.MAX_TIME_MS = 26000; // Maximum timer capacity

    // Session-wide bests (in-memory)
    this.sessionBestScore = 0;
    this.sessionBestDepth = 0;

    // Events ring buffer
    this.events = [];
    this.eventSeq = 1;

    // Input state
    this.input = {
      down: false,
      left: false,
      right: false
    };

    this.reset(seed);
  }

  reset(seed = null) {
    if (seed !== null && seed !== undefined) {
      this.seed = seed;
    } else if (!this.seed) {
      this.seed = Math.floor(Math.random() * 1000000);
    }

    this.course = new CourseGenerator(this.seed);
    this.course.generateUpTo(this.PREVIEW_HORIZON + 800);

    // Run State
    this.phase = "ready"; // "ready" | "playing" | "gameover"
    this.tick = 0;
    this.elapsedMs = 0;
    this.timeMs = 0;
    this.remainingMs = this.START_TIME_MS;
    this.score = 0;
    this.depth = 0;
    this.difficulty = 1.0;

    // Player State
    this.x = this.course.getCenter(0);
    this.speed = this.CRAWL_SPEED;
    this.playerRadius = this.PLAYER_RADIUS;
    this.maxSpeed = this.MAX_SPEED;

    // Counters & Status
    this.hits = 0;
    this.wallContacts = 0;
    this.fragmentsCollected = 0;
    this.rocksBroken = 0;
    this.invincibleUntilMs = 0;
    this.rank = null;

    // Internal timers & combos
    this.lastWallContactTick = -999;
    this.nearMissCombo = 0;
    this.lastNearMissTick = -999;
    this.stallTimeRemaining = 0; // ms remaining in collision stall

    // Signature stat tracking
    this.stats = {
      maxSpeedStreakMs: 0,
      currentSpeedStreakMs: 0,
      closestShave: 999,
      nearMissCount: 0,
      maxNearMissStreak: 0,
      longestFullThrottleMs: 0,
      currentFullThrottleMs: 0
    };

    // Events history
    this.events = [];
    this.eventSeq = 1;
    this.lastEvent = null;

    // Reset input state (keep held if desired or clean)
    this.input = { down: false, left: false, right: false };

    return this;
  }

  addEvent(kind) {
    const ev = {
      seq: this.eventSeq++,
      kind: kind,
      tick: this.tick
    };
    this.events.push(ev);
    if (this.events.length > 150) {
      this.events.shift();
    }
    this.lastEvent = ev;
    return ev;
  }

  // Handle external input changes
  setInput(down, left, right) {
    this.input.down = !!down;
    this.input.left = !!left;
    this.input.right = !!right;

    // First accelerator input starts the run
    if (this.phase === "ready" && this.input.down) {
      this.phase = "playing";
    }
  }

  // Step simulation forward by dt (1/60s = ~16.66667ms)
  step() {
    if (this.phase !== "playing") return;

    const dt = 1 / 60; // 60 Hz fixed timestep
    const dtMs = 1000 / 60;

    this.tick++;
    this.elapsedMs += dtMs;
    this.timeMs += dtMs;
    this.remainingMs -= dtMs;

    // Update difficulty scalar
    this.difficulty = Math.round((1.0 + this.depth / 10000) * 100) / 100;

    // Power state check
    const isInvincible = this.timeMs < this.invincibleUntilMs;

    // 1. Acceleration / Deceleration / Stall Physics
    if (this.stallTimeRemaining > 0) {
      this.stallTimeRemaining -= dtMs;
      // Force speed down to crawl floor
      this.speed = Math.max(this.CRAWL_SPEED, this.speed - 900 * dt);
    } else if (this.input.down) {
      this.speed = Math.min(this.maxSpeed, this.speed + this.ACCEL_RATE * dt);
    } else {
      this.speed = Math.max(this.CRAWL_SPEED, this.speed - this.COAST_DECAY * dt);
    }

    // Full throttle streak tracking
    if (this.speed >= this.maxSpeed * 0.95 && this.input.down) {
      this.stats.currentFullThrottleMs += dtMs;
      this.stats.longestFullThrottleMs = Math.max(this.stats.longestFullThrottleMs, this.stats.currentFullThrottleMs);
    } else {
      this.stats.currentFullThrottleMs = 0;
    }

    // 2. Lateral Steering Authority
    // Falloff curve: at crawl speed -> 340 units/s, at max speed -> 145 units/s
    const speedRatio = (this.speed - this.CRAWL_SPEED) / Math.max(1, this.maxSpeed - this.CRAWL_SPEED);
    const steerAuthority = 340 - speedRatio * 195; // 340 at crawl, 145 at top speed

    if (this.input.left && !this.input.right) {
      this.x -= steerAuthority * dt;
    } else if (this.input.right && !this.input.left) {
      this.x += steerAuthority * dt;
    }

    // 3. Depth & Continuous Score
    const prevDepth = this.depth;
    this.depth += this.speed * dt;
    this.score += this.speed * dt * 0.12;

    // Ensure course generated ahead
    this.course.generateUpTo(this.depth + this.PREVIEW_HORIZON + 800);

    // 4. Wall Contact & Collision
    const wall = this.course.getWallsAt(this.depth);
    const leftLimit = wall.leftX + this.playerRadius;
    const rightLimit = wall.rightX - this.playerRadius;

    if (this.x <= leftLimit) {
      this.x = leftLimit;
      this.stallTimeRemaining = 250; // 0.25s stall
      if (this.tick - this.lastWallContactTick >= 15) {
        this.wallContacts++;
        this.addEvent("wall_contact");
        this.lastWallContactTick = this.tick;
        this.nearMissCombo = 0;
      }
    } else if (this.x >= rightLimit) {
      this.x = rightLimit;
      this.stallTimeRemaining = 250; // 0.25s stall
      if (this.tick - this.lastWallContactTick >= 15) {
        this.wallContacts++;
        this.addEvent("wall_contact");
        this.lastWallContactTick = this.tick;
        this.nearMissCombo = 0;
      }
    }

    // Near-miss combo decay if no near-miss for 1.8 seconds
    if (this.tick - this.lastNearMissTick > 110) {
      this.nearMissCombo = 0;
    }

    // 5. Rock Collisions and Near-Miss Detection
    const nearbyRocks = this.course.rocks.filter(
      (r) => r.active && r.position.depth >= prevDepth - 80 && r.position.depth <= this.depth + 80
    );

    for (let i = 0; i < nearbyRocks.length; i++) {
      const rock = nearbyRocks[i];
      const dx = this.x - rock.position.x;
      const dd = this.depth - rock.position.depth;
      const dist = Math.hypot(dx, dd);
      const hitDist = this.playerRadius + rock.collisionRadius;

      // Direct collision
      if (dist < hitDist) {
        if (isInvincible) {
          rock.active = false;
          this.rocksBroken++;
          this.remainingMs = Math.min(this.MAX_TIME_MS, this.remainingMs + 2000);
          this.score += 250;
          this.addEvent("rock_broken");
        } else {
          rock.active = false;
          this.hits++;
          this.stallTimeRemaining = 250; // 0.25s stall
          this.addEvent("rock_hit");
          this.nearMissCombo = 0;
        }
        continue;
      }

      // Near-miss detection: player passes the rock depth
      if (prevDepth <= rock.position.depth && this.depth >= rock.position.depth && rock.active) {
        const edgeGap = Math.abs(dx) - (this.playerRadius + rock.collisionRadius);
        // Gap within one machine diameter (2 * playerRadius = 36)
        if (edgeGap >= 0 && edgeGap <= this.playerRadius * 2.0) {
          this.nearMissCombo++;
          this.lastNearMissTick = this.tick;
          this.stats.nearMissCount++;
          this.stats.maxNearMissStreak = Math.max(this.stats.maxNearMissStreak, this.nearMissCombo);
          this.stats.closestShave = Math.min(this.stats.closestShave, Math.round(edgeGap * 10) / 10);
          this.score += 60 * this.nearMissCombo;
          this.addEvent("near_miss");
        }
      }
    }

    // 6. Collectible Items (Fragments & Power)
    const nearbyItems = this.course.items.filter(
      (item) => item.active && Math.abs(item.position.depth - this.depth) < 60
    );

    for (let i = 0; i < nearbyItems.length; i++) {
      const item = nearbyItems[i];
      const dx = this.x - item.position.x;
      const dd = this.depth - item.position.depth;
      const dist = Math.hypot(dx, dd);
      const grabDist = this.playerRadius + item.collisionRadius;

      if (dist < grabDist) {
        item.active = false;
        if (item.type === "fragment") {
          this.fragmentsCollected++;
          this.remainingMs = Math.min(this.MAX_TIME_MS, this.remainingMs + 1400);
          this.score += 120;
          this.addEvent("fragment");
        } else if (item.type === "power") {
          this.invincibleUntilMs = this.timeMs + 7500; // 7.5 seconds of supercharge
          this.remainingMs = Math.min(this.MAX_TIME_MS, this.remainingMs + 3500);
          this.score += 400;
          this.addEvent("power");
        }
      }
    }

    // 7. Time check & Game Over
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = "gameover";
      this.computeRank();
      // Update session bests
      this.sessionBestScore = Math.max(this.sessionBestScore, Math.round(this.score));
      this.sessionBestDepth = Math.max(this.sessionBestDepth, Math.round(this.depth));
    }
  }

  computeRank() {
    const s = this.score;
    if (s >= 20000) this.rank = "S+";
    else if (s >= 14000) this.rank = "S";
    else if (s >= 9000) this.rank = "A";
    else if (s >= 5000) this.rank = "B";
    else if (s >= 2500) this.rank = "C";
    else this.rank = "D";
    return this.rank;
  }

  // Advance simulation by given milliseconds (Replay & Telemetry API)
  advance(ms) {
    if (this.phase !== "playing") return;
    const stepMs = 1000 / 60;
    let accumulated = ms;
    while (accumulated >= stepMs - 0.001) {
      this.step();
      accumulated -= stepMs;
      if (this.phase !== "playing") break;
    }
  }

  // Exact snapshot conforming to Arena specification
  snapshot() {
    const curWall = this.course.getWallsAt(this.depth);
    const entityHorizon = this.course.getEntitiesInHorizon(this.depth, this.PREVIEW_HORIZON);
    const wallSamples = this.course.sampleWalls(this.depth, this.PREVIEW_HORIZON, 30);
    const safeHw = this.course.calculateSafeHalfWidth(this.depth, this.PREVIEW_HORIZON);
    const previewMs = Math.round((this.PREVIEW_HORIZON / this.maxSpeed) * 1000);

    return {
      // Run state
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.round(this.elapsedMs * 10) / 10,
      timeMs: Math.round(this.timeMs * 10) / 10,
      remainingMs: Math.max(0, Math.round(this.remainingMs * 10) / 10),
      seed: this.seed,
      rngState: this.course.prng.getState(),
      spawnIndex: this.course.entityIdCounter,
      input: {
        down: this.input.down,
        left: this.input.left,
        right: this.input.right
      },
      difficulty: this.difficulty,
      score: Math.round(this.score * 10) / 10,
      depth: Math.round(this.depth * 10) / 10,

      // Player
      x: Math.round(this.x * 10) / 10,
      playerRadius: this.playerRadius,
      speed: Math.round(this.speed * 10) / 10,
      maxSpeed: this.maxSpeed,

      // Counters
      hits: this.hits,
      wallContacts: this.wallContacts,
      fragmentsCollected: this.fragmentsCollected,
      rocksBroken: this.rocksBroken,
      invincibleUntilMs: Math.round(this.invincibleUntilMs * 10) / 10,
      rank: this.rank,

      // Course geometry near the player
      courseCenterX: Math.round(curWall.leftX + (curWall.rightX - curWall.leftX) * 0.5 * 10) / 10,
      corridorHalfWidth: Math.round(((curWall.rightX - curWall.leftX) * 0.5) * 10) / 10,
      walls: wallSamples,
      safeHalfWidth: safeHw,
      previewMs: previewMs,

      // Entities (sorted by ID)
      rocks: entityHorizon.rocks.map((r) => ({
        id: r.id,
        position: { x: r.position.x, depth: r.position.depth },
        active: r.active,
        visualRadius: r.visualRadius,
        collisionRadius: r.collisionRadius
      })),
      items: entityHorizon.items.map((it) => ({
        id: it.id,
        type: it.type,
        position: { x: it.position.x, depth: it.position.depth },
        active: it.active,
        visualRadius: it.visualRadius,
        collisionRadius: it.collisionRadius,
        ...(it.type === "fragment" ? {
          formationId: it.formationId,
          formationKind: it.formationKind,
          formationIndex: it.formationIndex
        } : {})
      })),

      // Events
      events: this.events.slice(-100),
      lastEvent: this.lastEvent
    };
  }
}

window.DelveGame = DelveGame;
