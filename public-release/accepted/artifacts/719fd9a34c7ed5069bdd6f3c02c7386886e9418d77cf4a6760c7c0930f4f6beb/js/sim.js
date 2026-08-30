// Deterministic PRNG: Mulberry32
class PRNG {
  constructor(seed = 12345) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }
  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

class GameSimulation {
  constructor(seed = 12345) {
    // Stage geometry
    this.stageWidth = 400;
    this.stageHeight = 700;
    this.groundY = 600;
    this.lowLaneY = 380;
    this.highLaneY = 200;

    // Physics constants
    this.machineGravity = 1200;
    this.machineJumpSpeed = 450;
    this.machineSpeed = 300;
    this.machineRadius = 24;

    this.ballGravity = 700;
    this.ballRadius = 10;
    this.ballCollisionRadius = 10;

    // machine normal apex Y = groundY - (v^2 / (2*g))
    this.machineNormalApexY = this.groundY - (this.machineJumpSpeed * this.machineJumpSpeed) / (2 * this.machineGravity); // 515.625

    this.reset(seed);
  }

  reset(seed = 12345) {
    this.seed = seed;
    this.rng = new PRNG(seed);
    this.rngState = this.rng.state;

    this.phase = 'ready'; // 'ready' | 'playing' | 'gameover'
    this.tick = 0;
    this.elapsedMs = 0;
    this.startingMs = 75000;
    this.remainingMs = this.startingMs;
    this.score = 0;
    this.difficulty = 1;

    // Telemetry counters
    this.topHits = 0;
    this.airEnemiesDefeated = 0;
    this.wrongSideHits = 0;
    this.ballDrops = 0;
    this.currentCleanSequence = 0;
    this.longestCleanSequence = 0;

    // Events history
    this.eventSequence = 0;
    this.recentEvents = [];
    this.lastEvent = null;

    // Inputs
    this.input = {
      left: false,
      right: false,
      jump: false,
    };
    this.jumpQueued = false;

    // Machine state
    this.machine = {
      x: this.stageWidth / 2,
      y: this.groundY,
      vx: 0,
      vy: 0,
      radius: this.machineRadius,
      grounded: true,
      jumpCount: 0,
      overlappingWalkers: new Set(),
    };

    // Ball state
    this.ball = {
      x: this.stageWidth / 2,
      y: this.groundY - this.machineRadius - this.ballRadius,
      vx: 0,
      vy: 0,
      radius: this.ballRadius,
      collisionRadius: this.ballCollisionRadius,
      active: false,
      lastBounceKind: null, // null | 'weak' | 'normal' | 'power'
      recoveryTicks: 0,
      overlappingEnemies: new Set(),
    };

    // Enemies
    this.enemies = [];
    this.enemyIdCounter = 1;

    // Spawner state
    this.nextSpawnTick = 30;
    this.nextWalkerTick = 180;
    this.lastSpawnedLane = 'high'; // so first is 'low'
    this.hasDestroyedFirstAirEnemy = false;

    // Advance accumulation
    this.accumulatedAdvanceMs = 0;
  }

  recordEvent({ kind, enemyId = null, amountMs = 0, source, contact = null }) {
    this.eventSequence += 1;
    const ev = {
      sequence: this.eventSequence,
      kind,
      tick: this.tick,
      enemyId,
      amountMs,
      source,
      contact,
    };
    this.recentEvents.push(ev);
    if (this.recentEvents.length > 100) {
      this.recentEvents.shift();
    }
    this.lastEvent = ev;
  }

  getRank() {
    if (this.score >= 15000) return 'S+';
    if (this.score >= 10000) return 'S';
    if (this.score >= 6000) return 'A';
    if (this.score >= 3000) return 'B';
    if (this.score >= 1000) return 'C';
    return 'D';
  }

  updateDifficulty() {
    if (this.score >= 12000) {
      this.difficulty = Math.max(this.difficulty, 5);
    } else if (this.score >= 7000) {
      this.difficulty = Math.max(this.difficulty, 4);
    } else if (this.score >= 3500) {
      this.difficulty = Math.max(this.difficulty, 3);
    } else if (this.score >= 1500) {
      this.difficulty = Math.max(this.difficulty, 2);
    } else {
      this.difficulty = Math.max(this.difficulty, 1);
    }
  }

  spawnEnemy(type, lane, side = null) {
    const id = this.enemyIdCounter++;
    const isLow = lane === 'low';
    const isGround = lane === 'ground';
    const y = isGround ? this.groundY - 14 : isLow ? this.lowLaneY : this.highLaneY;

    const fromLeft = side !== null ? side === 'left' : this.rng.next() < 0.5;
    const x = fromLeft ? -25 : this.stageWidth + 25;

    let baseSpeed = 55;
    if (type === 'fastFlyer') {
      baseSpeed = 95 + (this.difficulty - 1) * 8;
    } else if (type === 'slowFlyer') {
      baseSpeed = 50 + (this.difficulty - 1) * 4;
    } else if (type === 'walker') {
      baseSpeed = 40 + (this.difficulty - 1) * 6;
    }

    const vx = fromLeft ? baseSpeed : -baseSpeed;
    const visualRadius = isGround ? 20 : 24;
    const collisionRadius = isGround ? 18 : 22; // collision <= 1.1 * visual

    const enemy = {
      id,
      type,
      lane,
      x,
      y,
      vx,
      active: true,
      hitsTaken: 0,
      hitsRequired: isGround ? 1 : 3,
      visualRadius,
      collisionRadius,
      deathTicks: 0,
    };

    this.enemies.push(enemy);
    return enemy;
  }

  updateSpawner() {
    const dt = 1;

    // Check if player has destroyed first air enemy
    if (this.airEnemiesDefeated >= 1) {
      this.hasDestroyedFirstAirEnemy = true;
    }

    if (!this.hasDestroyedFirstAirEnemy) {
      // OPENING PROMISE:
      // Keep slow flyers active in low and high lanes
      const activeFlyer = this.enemies.find((e) => e.active && (e.type === 'slowFlyer' || e.type === 'fastFlyer'));
      if (!activeFlyer) {
        if (this.nextSpawnTick <= this.tick) {
          const nextLane = this.lastSpawnedLane === 'low' ? 'high' : 'low';
          this.lastSpawnedLane = nextLane;
          this.spawnEnemy('slowFlyer', nextLane);
          this.nextSpawnTick = this.tick + 90; // will re-evaluate when enemy leaves or dies
        }
      } else {
        // As long as an active flyer is present, schedule next spawn shortly after it disappears
        this.nextSpawnTick = this.tick + 60;
      }

      // Walkers during opening
      if (this.tick >= this.nextWalkerTick) {
        this.spawnEnemy('walker', 'ground');
        this.nextWalkerTick = this.tick + Math.floor(this.rng.range(300, 450));
      }
    } else {
      // POST-FIRST-DEFEAT: Full dynamic scaling
      if (this.tick >= this.nextSpawnTick) {
        const activeFlyers = this.enemies.filter((e) => e.active && e.lane !== 'ground');
        const maxFlyers = this.difficulty >= 4 ? 2 : 1;

        if (activeFlyers.length < maxFlyers) {
          const lane = this.rng.next() < 0.5 ? 'low' : 'high';
          const type = this.difficulty >= 2 && this.rng.next() < 0.35 + this.difficulty * 0.1 ? 'fastFlyer' : 'slowFlyer';
          this.spawnEnemy(type, lane);
        }

        const minInterval = Math.max(65, 140 - this.difficulty * 15);
        const maxInterval = Math.max(90, 200 - this.difficulty * 20);
        this.nextSpawnTick = this.tick + Math.floor(this.rng.range(minInterval, maxInterval));
      }

      // Walkers
      if (this.tick >= this.nextWalkerTick) {
        const activeWalkers = this.enemies.filter((e) => e.active && e.lane === 'ground');
        if (activeWalkers.length < 1) {
          this.spawnEnemy('walker', 'ground');
        }
        const walkerInterval = Math.max(160, 320 - this.difficulty * 25);
        this.nextWalkerTick = this.tick + Math.floor(this.rng.range(walkerInterval, walkerInterval + 100));
      }
    }
  }

  step() {
    if (this.phase === 'gameover') {
      return;
    }

    // Check transition from ready to playing on any input
    if (this.phase === 'ready') {
      if (this.input.left || this.input.right || this.input.jump || this.jumpQueued) {
        this.phase = 'playing';
        // Launch ball on start
        this.ball.active = true;
        this.ball.vy = -620;
        this.ball.vx = 0;
        this.ball.lastBounceKind = 'normal';
        this.recordEvent({
          kind: 'ball_bounce_normal',
          source: 'ball',
          contact: 'top',
        });
      } else {
        // Frozen ready state
        return;
      }
    }

    const dt = 1 / 60; // 60Hz step
    this.tick += 1;
    this.elapsedMs = Math.round(this.tick * (1000 / 60));

    // Drain clock
    this.remainingMs -= 1000 / 60;
    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'gameover';
      return;
    }

    // 1. Update Machine
    // Horizontal movement
    let targetVx = 0;
    if (this.input.left && !this.input.right) {
      targetVx = -this.machineSpeed;
    } else if (this.input.right && !this.input.left) {
      targetVx = this.machineSpeed;
    }
    // High responsiveness
    this.machine.vx = targetVx;
    this.machine.x += this.machine.vx * dt;

    // Clamp machine within screen
    if (this.machine.x < this.machine.radius) {
      this.machine.x = this.machine.radius;
      this.machine.vx = 0;
    } else if (this.machine.x > this.stageWidth - this.machine.radius) {
      this.machine.x = this.stageWidth - this.machine.radius;
      this.machine.vx = 0;
    }

    // Jump handling
    if ((this.input.jump || this.jumpQueued) && this.machine.grounded) {
      this.machine.vy = -this.machineJumpSpeed;
      this.machine.grounded = false;
      this.machine.jumpCount += 1;
      this.jumpQueued = false;
      this.recordEvent({
        kind: 'machine_jump',
        source: 'machine',
        contact: null,
      });
    }

    // Machine vertical physics
    if (!this.machine.grounded) {
      this.machine.vy += this.machineGravity * dt;
      this.machine.y += this.machine.vy * dt;

      if (this.machine.y >= this.groundY) {
        this.machine.y = this.groundY;
        this.machine.vy = 0;
        this.machine.grounded = true;
        this.recordEvent({
          kind: 'machine_land',
          source: 'machine',
          contact: 'body',
        });
      }
    }

    // 2. Update Ball
    if (this.ball.recoveryTicks > 0) {
      this.ball.recoveryTicks -= 1;
      // Ball floats above machine during recovery
      this.ball.x = this.machine.x;
      this.ball.y = this.groundY - 140;
      this.ball.vx = 0;
      this.ball.vy = 0;
      if (this.ball.recoveryTicks === 0) {
        this.ball.active = true;
        this.ball.vy = 120; // gentle drop
      }
    } else if (this.ball.active) {
      this.ball.vy += this.ballGravity * dt;
      this.ball.x += this.ball.vx * dt;
      this.ball.y += this.ball.vy * dt;

      // Ball wall bounces
      if (this.ball.x - this.ball.radius <= 0) {
        this.ball.x = this.ball.radius;
        this.ball.vx = Math.abs(this.ball.vx) * 0.95;
      } else if (this.ball.x + this.ball.radius >= this.stageWidth) {
        this.ball.x = this.stageWidth - this.ball.radius;
        this.ball.vx = -Math.abs(this.ball.vx) * 0.95;
      }

      // Ball ceiling bounce
      if (this.ball.y - this.ball.radius <= 0) {
        this.ball.y = this.ball.radius;
        this.ball.vy = Math.abs(this.ball.vy) * 0.85;
      }

      // Ball - Machine Top Contact Check
      // Machine top surface is at machine.y - machine.radius
      const machineTopY = this.machine.y - this.machine.radius;
      const ballBottomY = this.ball.y + this.ball.radius;
      const dxToMachine = Math.abs(this.ball.x - this.machine.x);

      if (
        this.ball.vy > 0 &&
        ballBottomY >= machineTopY &&
        this.ball.y <= this.machine.y &&
        dxToMachine <= this.machine.radius + this.ball.radius * 0.85
      ) {
        // Snap to top
        this.ball.y = machineTopY - this.ball.radius;

        // Influence horizontal velocity based on machine movement and contact offset
        const offset = (this.ball.x - this.machine.x) / this.machine.radius;
        this.ball.vx = this.machine.vx * 0.65 + offset * 180;
        this.ball.vx = Math.max(-320, Math.min(320, this.ball.vx));

        // Determine 3 bands:
        // Rising machine -> power bounce (high lane)
        // Grounded machine -> normal bounce (low lane)
        // Descending machine -> weak bounce (below low lane)
        if (this.machine.vy < -40) {
          this.ball.vy = -760;
          this.ball.lastBounceKind = 'power';
          this.recordEvent({
            kind: 'ball_bounce_power',
            source: 'ball',
            contact: 'top',
          });
        } else if (this.machine.grounded || Math.abs(this.machine.vy) <= 40) {
          this.ball.vy = -620;
          this.ball.lastBounceKind = 'normal';
          this.recordEvent({
            kind: 'ball_bounce_normal',
            source: 'ball',
            contact: 'top',
          });
        } else {
          this.ball.vy = -450;
          this.ball.lastBounceKind = 'weak';
          this.recordEvent({
            kind: 'ball_bounce_weak',
            source: 'ball',
            contact: 'top',
          });
        }
      }

      // Ball Ground Drop
      if (this.ball.y + this.ball.radius >= this.groundY) {
        this.ballDrops += 1;
        this.currentCleanSequence = 0;
        const penalty = -5000;
        this.remainingMs = Math.max(0, this.remainingMs + penalty);

        this.recordEvent({
          kind: 'ball_drop',
          amountMs: penalty,
          source: 'system',
          contact: 'non_top',
        });

        if (this.remainingMs <= 0) {
          this.phase = 'gameover';
          return;
        }

        // Enter recovery
        this.ball.active = false;
        this.ball.recoveryTicks = 45; // ~0.75s
        this.ball.x = this.machine.x;
        this.ball.y = this.groundY - 140;
        this.ball.vx = 0;
        this.ball.vy = 0;
      }
    }

    // 3. Update Enemies & Spawner
    this.updateSpawner();

    // Iterate through enemies for movement and collisions
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];

      if (!enemy.active) {
        enemy.deathTicks += 1;
        if (enemy.deathTicks >= 30) {
          this.enemies.splice(i, 1);
        }
        continue;
      }

      // Enemy horizontal movement
      enemy.x += enemy.vx * dt;

      // Screen exit check
      if ((enemy.vx < 0 && enemy.x < -60) || (enemy.vx > 0 && enemy.x > this.stageWidth + 60)) {
        this.enemies.splice(i, 1);
        continue;
      }

      // Collision checks with Ball (for airborne flyers)
      if (enemy.lane !== 'ground' && this.ball.active && this.ball.recoveryTicks === 0) {
        const dx = this.ball.x - enemy.x;
        const dy = this.ball.y - enemy.y;
        const distSq = dx * dx + dy * dy;
        const hitDist = this.ball.collisionRadius + enemy.collisionRadius;

        if (distSq <= hitDist * hitDist) {
          // Check clean top hit
          // Ball is falling (vy > 0) and ball center is above enemy center
          const isTopHit = this.ball.vy > 0 && this.ball.y <= enemy.y - enemy.collisionRadius * 0.15;

          if (isTopHit) {
            // Clean top hit!
            enemy.hitsTaken += 1;
            this.topHits += 1;
            this.currentCleanSequence += 1;
            this.longestCleanSequence = Math.max(this.longestCleanSequence, this.currentCleanSequence);

            // Rebound ball upward
            this.ball.vy = -470;
            this.ball.vx = this.ball.vx * 0.5 + dx * 3.5;
            this.ball.vx = Math.max(-300, Math.min(300, this.ball.vx));

            let amountMs = 3000;
            let addScore = 150;

            if (enemy.hitsTaken === 2) {
              amountMs = 5000;
              addScore = 350;
            } else if (enemy.hitsTaken >= 3) {
              amountMs = 10000;
              addScore = 800;
              enemy.active = false;
              enemy.deathTicks = 0;
              this.airEnemiesDefeated += 1;
            }

            this.remainingMs += amountMs;
            this.score += addScore;
            this.updateDifficulty();

            this.recordEvent({
              kind: 'top_hit',
              enemyId: enemy.id,
              amountMs,
              source: 'ball',
              contact: 'top',
            });

            if (enemy.hitsTaken >= 3) {
              this.recordEvent({
                kind: 'enemy_defeated',
                enemyId: enemy.id,
                amountMs,
                source: 'ball',
                contact: 'top',
              });
            }
          } else {
            // Wrong-side hit (non-top collision)
            if (!this.ball.overlappingEnemies.has(enemy.id)) {
              this.ball.overlappingEnemies.add(enemy.id);
              this.wrongSideHits += 1;
              this.currentCleanSequence = 0;
              const penalty = -3000;
              this.remainingMs = Math.max(0, this.remainingMs + penalty);

              // Glance / deflection
              if (this.ball.vy < 0) {
                this.ball.vy = Math.abs(this.ball.vy) * 0.5 + 40;
              }

              this.recordEvent({
                kind: 'wrong_side_hit',
                enemyId: enemy.id,
                amountMs: penalty,
                source: 'ball',
                contact: 'non_top',
              });

              if (this.remainingMs <= 0) {
                this.phase = 'gameover';
                return;
              }
            }
          }
        } else if (distSq > (hitDist + 5) * (hitDist + 5)) {
          this.ball.overlappingEnemies.delete(enemy.id);
        }
      }

      // Collision checks with Machine (for ground Walkers)
      if (enemy.lane === 'ground') {
        const dx = Math.abs(this.machine.x - enemy.x);
        const dy = Math.abs(this.machine.y - enemy.y);
        const hitRadius = this.machine.radius + enemy.collisionRadius;

        if (dx <= hitRadius && dy <= hitRadius) {
          // Check if machine stomps on walker from above
          const isStomp = this.machine.vy > 0 && this.machine.y < enemy.y - 8;

          if (isStomp) {
            enemy.hitsTaken = 1;
            enemy.active = false;
            enemy.deathTicks = 0;
            this.machine.vy = -360; // bounce machine up
            const bonusMs = 1000;
            this.remainingMs += bonusMs;
            this.score += 300;
            this.updateDifficulty();

            this.recordEvent({
              kind: 'ground_stomp',
              enemyId: enemy.id,
              amountMs: bonusMs,
              source: 'machine',
              contact: 'top',
            });
          } else {
            // Body contact with walker
            if (!this.machine.overlappingWalkers.has(enemy.id)) {
              this.machine.overlappingWalkers.add(enemy.id);
              this.wrongSideHits += 1;
              this.currentCleanSequence = 0;
              const penalty = -2000;
              this.remainingMs = Math.max(0, this.remainingMs + penalty);

              this.recordEvent({
                kind: 'wrong_side_hit',
                enemyId: enemy.id,
                amountMs: penalty,
                source: 'machine',
                contact: 'body',
              });

              if (this.remainingMs <= 0) {
                this.phase = 'gameover';
                return;
              }
            }
          }
        } else if (dx > hitRadius + 8) {
          this.machine.overlappingWalkers.delete(enemy.id);
        }
      }
    }

    this.rngState = this.rng.state;
  }

  advance(ms) {
    if (ms <= 0) return;
    this.accumulatedAdvanceMs += ms;
    const DT_MS = 1000 / 60;
    while (this.accumulatedAdvanceMs >= DT_MS - 1e-6) {
      this.step();
      this.accumulatedAdvanceMs -= DT_MS;
    }
  }

  queueJump() {
    this.jumpQueued = true;
  }

  setInput(left, right, jump) {
    this.input.left = !!left;
    this.input.right = !!right;
    this.input.jump = !!jump;
    if (jump) {
      this.jumpQueued = true;
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      remainingMs: Math.max(0, Math.round(this.remainingMs)),
      seed: this.seed,
      rngState: this.rngState,
      score: this.score,
      difficulty: this.difficulty,
      rank: this.getRank(),
      input: {
        left: !!this.input.left,
        right: !!this.input.right,
        jump: !!this.input.jump,
      },
      groundY: this.groundY,
      lowLaneY: this.lowLaneY,
      highLaneY: this.highLaneY,
      machineNormalApexY: this.machineNormalApexY,
      machine: {
        x: Number(this.machine.x.toFixed(3)),
        y: Number(this.machine.y.toFixed(3)),
        vx: Number(this.machine.vx.toFixed(3)),
        vy: Number(this.machine.vy.toFixed(3)),
        radius: this.machine.radius,
        grounded: this.machine.grounded,
        jumpCount: this.machine.jumpCount,
      },
      ball: {
        x: Number(this.ball.x.toFixed(3)),
        y: Number(this.ball.y.toFixed(3)),
        vx: Number(this.ball.vx.toFixed(3)),
        vy: Number(this.ball.vy.toFixed(3)),
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
      enemies: this.enemies
        .map((e) => ({
          id: e.id,
          type: e.type,
          lane: e.lane,
          x: Number(e.x.toFixed(3)),
          y: Number(e.y.toFixed(3)),
          vx: Number(e.vx.toFixed(3)),
          active: e.active,
          hitsTaken: e.hitsTaken,
          hitsRequired: e.hitsRequired,
          visualRadius: e.visualRadius,
          collisionRadius: e.collisionRadius,
        }))
        .sort((a, b) => a.id - b.id),
      recentEvents: this.recentEvents.slice(),
      lastEvent: this.recentEvents.length > 0 ? this.recentEvents[this.recentEvents.length - 1] : null,
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameSimulation, PRNG };
}
