// Core Deterministic Game Engine for STOMP

import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  GROUND_Y,
  LOW_LANE_Y,
  HIGH_LANE_Y,
  MACHINE_NORMAL_APEX_Y,
  MACHINE_RADIUS,
  MACHINE_GROUND_Y,
  START_CLOCK_MS,
  TICK_MS,
  BOUNCE_WEAK_VY,
  BOUNCE_NORMAL_VY,
  BOUNCE_POWER_VY,
  BALL_REBOUND_VY,
  TIME_REWARD_HIT_1,
  TIME_REWARD_HIT_2,
  TIME_REWARD_HIT_3,
  TIME_REWARD_STOMP,
  TIME_PENALTY_WRONG_SIDE,
  TIME_PENALTY_BALL_DROP,
  TIME_PENALTY_BODY_HIT,
  SCORE_HIT_1,
  SCORE_HIT_2,
  SCORE_HIT_3,
  SCORE_STOMP,
  FLYER_SLOW_VISUAL_RADIUS,
  FLYER_SLOW_COLLISION_RADIUS,
  FLYER_FAST_VISUAL_RADIUS,
  FLYER_FAST_COLLISION_RADIUS,
  WALKER_VISUAL_RADIUS,
  WALKER_COLLISION_RADIUS,
  getRankForScore
} from './constants.js';

import { PRNG } from './prng.js';
import { EventManager } from './events.js';
import { audio } from './audio.js';
import { Machine, Ball, Enemy, Particle, FloatingText } from './entities.js';

export class Game {
  constructor(initialSeed = 1337) {
    this.initialSeed = initialSeed;
    this.sessionBestScore = 0;
    this.reset(initialSeed);
  }

  reset(seed = null) {
    this.seed = (seed !== null && seed !== undefined) ? seed : this.initialSeed;
    this.rng = new PRNG(this.seed);

    this.phase = 'ready'; // 'ready' | 'playing' | 'game_over'
    this.tickCount = 0;
    this.elapsedMs = 0;
    this.remainingMs = START_CLOCK_MS;
    this.score = 0;
    this.difficulty = 0;
    this.rank = 'C';

    this.input = {
      left: false,
      right: false,
      jump: false
    };

    // Entities
    this.machine = new Machine(STAGE_WIDTH / 2);
    this.ball = new Ball(
      STAGE_WIDTH / 2,
      MACHINE_GROUND_Y - MACHINE_RADIUS - 10
    );

    // Counters
    this.counters = {
      topHits: 0,
      airEnemiesDefeated: 0,
      wrongSideHits: 0,
      ballDrops: 0,
      longestCleanSequence: 0
    };
    this.currentCleanSequence = 0;

    // Enemies
    this.enemies = [];
    this.nextEnemyId = 1;

    // Spawning timetable and state
    this.nextAirSpawnTick = 120; // First slow flyer at t = 2.0s
    this.nextWalkerSpawnTick = 900; // First walker at t = 15.0s
    this.openingLaneToggle = 'low'; // Alternates low -> high

    // Telemetry Events
    this.events = new EventManager(250);

    // Time accumulator for fixed-step advance
    this.timeAccumulator = 0;

    // Visual juice (view-only dressing)
    this.particles = [];
    this.floatingTexts = [];
    this.screenShake = 0;
    this.lastSecondWarned = -1;
  }

  setInput(key, value) {
    if (this.input[key] !== undefined) {
      this.input[key] = !!value;
    }

    // First movement or jump starts the clock immediately
    if (this.phase === 'ready' && (this.input.left || this.input.right || this.input.jump)) {
      this.startRun();
    }
  }

  startRun() {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';

    // Ball soft launch upwards on start
    this.ball.vy = -10.5;
    this.ball.lastBounceKind = 'normal';
    this.ball.setExpression('excited', 30);
    this.machine.setExpression('bounce', 20);
    audio.play('bounceNormal');
  }

  addFloatingText(x, y, text, color) {
    this.floatingTexts.push(new FloatingText({ x, y, text, color }));
  }

  spawnDefeatBurst(x, y) {
    const colors = ['#00ffcc', '#ffeb3b', '#ff3366', '#ffffff', '#39ff14'];
    for (let i = 0; i < 28; i++) {
      const angle = (Math.PI * 2 * i) / 28 + (this.rng.next() - 0.5) * 0.4;
      const speed = this.rng.rangeFloat(2.5, 7.5);
      this.particles.push(new Particle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: this.rng.rangeInt(30, 50),
        color: this.rng.choose(colors),
        size: this.rng.rangeFloat(3, 6),
        shape: this.rng.choose(['circle', 'star', 'spark'])
      }));
    }
  }

  spawnBounceSparks(x, y, count = 10, color = '#39ff14') {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle({
        x,
        y,
        vx: this.rng.rangeFloat(-3.5, 3.5),
        vy: this.rng.rangeFloat(-4.5, -1.0),
        life: this.rng.rangeInt(15, 30),
        color,
        size: this.rng.rangeFloat(2, 4),
        shape: 'spark'
      }));
    }
  }

  triggerScreenShake(intensity = 6) {
    this.screenShake = Math.max(this.screenShake, intensity);
  }

  updateRank() {
    this.rank = getRankForScore(this.score);
  }

  updateDifficulty() {
    // Attack score is the progression meter
    // Only advances after first destruction
    if (this.counters.airEnemiesDefeated < 1) {
      this.difficulty = 0;
      return;
    }

    let calculatedTier = 0;
    if (this.score >= 3200) {
      calculatedTier = 3;
    } else if (this.score >= 1800) {
      calculatedTier = 2;
    } else if (this.score >= 800) {
      calculatedTier = 1;
    }

    // Difficulty tier is strictly nondecreasing
    if (calculatedTier > this.difficulty) {
      this.difficulty = calculatedTier;
    }
  }

  spawnEnemies() {
    // Handle airborne spawning
    // Rule: Until the player has destroyed a first airborne target:
    // Whenever current slow target leaves screen or is destroyed,
    // another slow target follows within a couple of seconds (120 ticks).
    const activeFlyers = this.enemies.filter(e => (e.type === 'slowFlyer' || e.type === 'fastFlyer') && e.active);

    if (this.counters.airEnemiesDefeated === 0) {
      // Opening Promise Stage
      if (activeFlyers.length === 0 && this.tickCount >= this.nextAirSpawnTick) {
        // Alternate between low and high lanes
        const lane = this.openingLaneToggle;
        const laneY = (lane === 'low') ? LOW_LANE_Y : HIGH_LANE_Y;
        const movingRight = (lane === 'low'); // Low from left, high from right
        const x = movingRight ? -FLYER_SLOW_COLLISION_RADIUS : STAGE_WIDTH + FLYER_SLOW_COLLISION_RADIUS;
        const vx = movingRight ? 0.95 : -0.95;

        const flyer = new Enemy({
          id: this.nextEnemyId++,
          type: 'slowFlyer',
          lane,
          x,
          y: laneY,
          vx,
          hitsRequired: 3,
          visualRadius: FLYER_SLOW_VISUAL_RADIUS,
          collisionRadius: FLYER_SLOW_COLLISION_RADIUS
        });

        this.enemies.push(flyer);

        // Toggle lane for next spawn
        this.openingLaneToggle = (this.openingLaneToggle === 'low') ? 'high' : 'low';
        // Next check will be scheduled when this target leaves or dies
        this.nextAirSpawnTick = this.tickCount + 999999;
      }
    } else {
      // Post-first destruction: Scaled spawning
      const maxConcurrent = this.difficulty >= 2 ? 2 : 1;
      if (activeFlyers.length < maxConcurrent && this.tickCount >= this.nextAirSpawnTick) {
        // Choose type based on difficulty
        const useFast = (this.difficulty >= 1) && (this.rng.next() < (0.35 + this.difficulty * 0.15));
        const type = useFast ? 'fastFlyer' : 'slowFlyer';
        const lane = this.rng.next() < 0.5 ? 'low' : 'high';
        const laneY = (lane === 'low') ? LOW_LANE_Y : HIGH_LANE_Y;

        const movingRight = this.rng.next() < 0.5;
        const radius = useFast ? FLYER_FAST_COLLISION_RADIUS : FLYER_SLOW_COLLISION_RADIUS;
        const vRadius = useFast ? FLYER_FAST_VISUAL_RADIUS : FLYER_SLOW_VISUAL_RADIUS;
        const speed = useFast ? this.rng.rangeFloat(1.5, 1.8) : this.rng.rangeFloat(0.9, 1.15);

        const x = movingRight ? -radius : STAGE_WIDTH + radius;
        const vx = movingRight ? speed : -speed;

        const flyer = new Enemy({
          id: this.nextEnemyId++,
          type,
          lane,
          x,
          y: laneY,
          vx,
          hitsRequired: 3,
          visualRadius: vRadius,
          collisionRadius: radius
        });

        this.enemies.push(flyer);

        // Next spawn with recovery beat
        const delay = this.rng.rangeInt(100, 160);
        this.nextAirSpawnTick = this.tickCount + delay;
      }
    }

    // Ground Walkers Spawning
    const activeWalkers = this.enemies.filter(e => e.type === 'walker' && e.active);
    if (activeWalkers.length === 0 && this.tickCount >= this.nextWalkerSpawnTick) {
      const movingRight = this.rng.next() < 0.5;
      const x = movingRight ? -WALKER_COLLISION_RADIUS : STAGE_WIDTH + WALKER_COLLISION_RADIUS;
      const vx = movingRight ? 0.85 : -0.85;

      const walker = new Enemy({
        id: this.nextEnemyId++,
        type: 'walker',
        lane: 'ground',
        x,
        y: GROUND_Y - WALKER_COLLISION_RADIUS,
        vx,
        hitsRequired: 1,
        visualRadius: WALKER_VISUAL_RADIUS,
        collisionRadius: WALKER_COLLISION_RADIUS
      });

      this.enemies.push(walker);

      const delay = this.rng.rangeInt(1200, 1800); // every 20-30s
      this.nextWalkerSpawnTick = this.tickCount + delay;
    }
  }

  // Single discrete 60Hz tick
  tick() {
    if (this.phase !== 'playing') return;

    this.tickCount += 1;
    this.elapsedMs = this.tickCount * TICK_MS;
    this.remainingMs -= TICK_MS;

    // Urgent low-time warning sound
    if (this.remainingMs > 0 && this.remainingMs <= 10000) {
      const sec = Math.ceil(this.remainingMs / 1000);
      if (sec !== this.lastSecondWarned) {
        this.lastSecondWarned = sec;
        audio.play('tickWarning');
      }
    }

    if (this.remainingMs <= 0) {
      this.remainingMs = 0;
      this.phase = 'game_over';
      this.sessionBestScore = Math.max(this.sessionBestScore, this.score);
      this.machine.setExpression('spent', 99999);
      this.ball.active = false;
      return;
    }

    // Update screen shake
    if (this.screenShake > 0) {
      this.screenShake *= 0.88;
      if (this.screenShake < 0.2) this.screenShake = 0;
    }

    // 1. Update Machine Physics
    const { jumped, landed } = this.machine.updatePhysics(this.input);
    if (jumped) {
      this.events.emit({
        kind: 'machine_jump',
        tick: this.tickCount,
        source: 'machine',
        contact: null,
        amountMs: 0
      });
      audio.play('jump');
    }
    if (landed) {
      this.events.emit({
        kind: 'machine_land',
        tick: this.tickCount,
        source: 'machine',
        contact: null,
        amountMs: 0
      });
      audio.play('land');
    }

    // 2. Update Ball Physics
    this.ball.updatePhysics();

    // Machine pre-contact anticipation (windup)
    const distBallMachineY = (this.machine.y - this.machine.radius) - this.ball.y;
    if (distBallMachineY > 0 && distBallMachineY < 90 && this.ball.vy > 1.0) {
      const distBallMachineX = Math.abs(this.ball.x - this.machine.x);
      if (distBallMachineX < this.machine.radius * 1.6) {
        if (this.machine.expression === 'normal') {
          this.machine.setExpression('windup', 8);
        }
      }
    }

    // 3. Ball - Machine Contact Detection
    if (this.ball.active) {
      const machineTopY = this.machine.y - this.machine.radius;
      const ballBottomY = this.ball.y + this.ball.radius;
      const horizDist = Math.abs(this.ball.x - this.machine.x);

      // Contact window: account for high closing velocity when machine is rising
      const closingSpeed = Math.abs(this.machine.vy) + Math.abs(this.ball.vy);
      const isTouchingTop = (ballBottomY >= machineTopY - 6) && (ballBottomY <= machineTopY + Math.max(22, closingSpeed + 6));
      const isAboveMachineCenter = (this.ball.y <= this.machine.y + 6);
      const isWithinPlatform = (horizDist <= this.machine.radius + this.ball.radius * 0.85);

      if (isTouchingTop && isWithinPlatform && isAboveMachineCenter && (this.ball.vy > 0 || this.machine.vy < 0)) {
        // Resolve position to sit cleanly atop bumper
        this.ball.y = machineTopY - this.ball.radius;

        // Aiming influence
        const contactOffset = (this.ball.x - this.machine.x) / this.machine.radius; // [-1.0, 1.0]
        this.ball.vx = Math.max(-4.6, Math.min(4.6, this.ball.vx * 0.3 + this.machine.vx * 0.65 + contactOffset * 2.2));

        // Three ordered return bands
        if (this.machine.vy < -1.0) {
          // Band 3: High power return (machine rising)
          this.ball.vy = BOUNCE_POWER_VY;
          this.ball.lastBounceKind = 'power';
          this.events.emit({
            kind: 'ball_bounce_power',
            tick: this.tickCount,
            source: 'machine',
            contact: 'top',
            amountMs: 0
          });
          audio.play('bouncePower');
          this.machine.setExpression('bounce', 25);
          this.ball.setExpression('power', 30);
          this.spawnBounceSparks(this.ball.x, this.ball.y + this.ball.radius, 14, '#ffeb3b');
          this.triggerScreenShake(3);
        } else if (this.machine.grounded) {
          // Band 2: Normal dependable return (machine grounded)
          this.ball.vy = BOUNCE_NORMAL_VY;
          this.ball.lastBounceKind = 'normal';
          this.events.emit({
            kind: 'ball_bounce_normal',
            tick: this.tickCount,
            source: 'machine',
            contact: 'top',
            amountMs: 0
          });
          audio.play('bounceNormal');
          this.machine.setExpression('bounce', 20);
          this.ball.setExpression('excited', 25);
          this.spawnBounceSparks(this.ball.x, this.ball.y + this.ball.radius, 8, '#00ffcc');
        } else {
          // Band 1: Weak recovery return (descending machine or late contact)
          this.ball.vy = BOUNCE_WEAK_VY;
          this.ball.lastBounceKind = 'weak';
          this.events.emit({
            kind: 'ball_bounce_weak',
            tick: this.tickCount,
            source: 'machine',
            contact: 'top',
            amountMs: 0
          });
          audio.play('bounceWeak');
          this.machine.setExpression('normal', 15);
          this.ball.setExpression('normal', 20);
          this.spawnBounceSparks(this.ball.x, this.ball.y + this.ball.radius, 4, '#888888');
        }
      }
    }

    // 4. Ball Drop Detection (Ball reaches ground)
    if (this.ball.active && (this.ball.y + this.ball.radius >= GROUND_Y)) {
      this.counters.ballDrops += 1;
      this.currentCleanSequence = 0;
      const penalty = TIME_PENALTY_BALL_DROP; // -6000 ms
      this.remainingMs += penalty;

      this.events.emit({
        kind: 'ball_drop',
        tick: this.tickCount,
        enemyId: null,
        amountMs: penalty,
        source: 'ball',
        contact: null
      });

      audio.play('ballDrop');
      this.addFloatingText(this.ball.x, GROUND_Y - 30, '-6s DROP!', '#ff0055');
      this.triggerScreenShake(6);

      // Return ball to short readable recovery above machine (~1 second float)
      this.ball.x = this.machine.x;
      this.ball.y = this.machine.y - this.machine.radius - 32;
      this.ball.vx = 0;
      this.ball.vy = -6.4; // float up gently then fall back
      this.ball.lastBounceKind = 'normal';

      this.machine.setExpression('deflated', 40);
      this.ball.setExpression('dizzy', 35);

      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.phase = 'game_over';
        this.sessionBestScore = Math.max(this.sessionBestScore, this.score);
        this.machine.setExpression('spent', 99999);
        this.ball.active = false;
        return;
      }
    }

    // 5. Spawn and Update Enemies
    this.spawnEnemies();

    for (const enemy of this.enemies) {
      enemy.updatePhysics();

      // Flyer vs Ball Collisions
      if ((enemy.type === 'slowFlyer' || enemy.type === 'fastFlyer') && enemy.active && this.ball.active) {
        const dx = this.ball.x - enemy.x;
        const dy = this.ball.y - enemy.y;
        const dist = Math.hypot(dx, dy);
        const colDist = this.ball.radius + enemy.collisionRadius;

        if (dist <= colDist) {
          // Check for valid top hit
          // Requirement: descending ball contacting target's top
          const isBallDescending = (this.ball.vy > 0);
          const isBallAboveTop = (this.ball.y < enemy.y - enemy.collisionRadius * 0.22);

          if (isBallDescending && isBallAboveTop) {
            // VALID CLEAN TOP HIT
            enemy.hitsTaken += 1;
            this.counters.topHits += 1;
            this.currentCleanSequence += 1;
            if (this.currentCleanSequence > this.counters.longestCleanSequence) {
              this.counters.longestCleanSequence = this.currentCleanSequence;
            }

            enemy.flashTimer = 18;
            enemy.overlappingWrongSide = false;

            // Upward rebound
            this.ball.vy = BALL_REBOUND_VY;
            this.ball.vx = Math.max(-4.5, Math.min(4.5, this.ball.vx * 0.5 + enemy.vx * 0.4 + (dx / enemy.collisionRadius) * 2.0));
            this.ball.y = enemy.y - enemy.collisionRadius - this.ball.radius - 2;

            let earnedMs = 0;
            let earnedScore = 0;

            if (enemy.hitsTaken === 1) {
              earnedMs = TIME_REWARD_HIT_1; // +3000
              earnedScore = SCORE_HIT_1;     // +100
              audio.play('topHit1');
              this.events.emit({
                kind: 'top_hit',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: earnedMs,
                source: 'ball',
                contact: 'top'
              });
              this.addFloatingText(enemy.x, enemy.y - 24, '+3s [HIT 1/3]', '#00ffcc');
            } else if (enemy.hitsTaken === 2) {
              earnedMs = TIME_REWARD_HIT_2; // +6000
              earnedScore = SCORE_HIT_2;     // +200
              audio.play('topHit2');
              this.events.emit({
                kind: 'top_hit',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: earnedMs,
                source: 'ball',
                contact: 'top'
              });
              this.addFloatingText(enemy.x, enemy.y - 24, '+6s [HIT 2/3!]', '#39ff14');
            } else if (enemy.hitsTaken >= 3) {
              earnedMs = TIME_REWARD_HIT_3; // +12000
              earnedScore = SCORE_HIT_3;     // +500
              enemy.active = false;
              enemy.defeatTimer = 35; // remain observable briefly
              this.counters.airEnemiesDefeated += 1;

              audio.play('topHit3');
              this.events.emit({
                kind: 'top_hit',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: earnedMs,
                source: 'ball',
                contact: 'top'
              });
              this.events.emit({
                kind: 'enemy_defeated',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: earnedMs,
                source: 'ball',
                contact: 'top'
              });

              this.addFloatingText(enemy.x, enemy.y - 28, 'BURST! +12s', '#ffeb3b');
              this.spawnDefeatBurst(enemy.x, enemy.y);
              this.triggerScreenShake(7);

              // Schedule next air target if during opening promise
              if (this.counters.airEnemiesDefeated <= 1) {
                this.nextAirSpawnTick = this.tickCount + 120; // 2 seconds
              }
            }

            this.remainingMs += earnedMs;
            this.score += earnedScore;
            this.updateRank();
            this.updateDifficulty();
            this.machine.setExpression('sparkle', 25);
            this.ball.setExpression('excited', 25);
          } else {
            // NON-TOP WRONG-SIDE HIT (Mistake)
            // Charge at most once during continuous overlap
            if (!enemy.overlappingWrongSide) {
              enemy.overlappingWrongSide = true;
              this.counters.wrongSideHits += 1;
              this.currentCleanSequence = 0;
              const penalty = TIME_PENALTY_WRONG_SIDE; // -4000
              this.remainingMs += penalty;

              this.events.emit({
                kind: 'wrong_side_hit',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: penalty,
                source: 'ball',
                contact: 'non_top'
              });

              audio.play('wrongSideHit');
              this.addFloatingText(this.ball.x, this.ball.y - 18, '-4s WRONG-SIDE!', '#ff3366');
              this.triggerScreenShake(5);
              enemy.flashTimer = 16;

              // Deflect ball away
              this.ball.vy = Math.max(this.ball.vy, 2.5);
              this.ball.vx = (this.ball.x < enemy.x ? -2.8 : 2.8);

              this.machine.setExpression('dismay', 30);
              this.ball.setExpression('dizzy', 30);

              if (this.remainingMs <= 0) {
                this.remainingMs = 0;
                this.phase = 'game_over';
                this.sessionBestScore = Math.max(this.sessionBestScore, this.score);
                this.machine.setExpression('spent', 99999);
                this.ball.active = false;
                return;
              }
            }
          }
        } else if (dist > colDist + 6) {
          enemy.overlappingWrongSide = false;
        }
      }

      // Ground Walker vs Machine Collisions
      if (enemy.type === 'walker' && enemy.active) {
        const dx = Math.abs(this.machine.x - enemy.x);
        const dy = Math.abs(this.machine.y - enemy.y);
        const overlapX = dx < (this.machine.radius + enemy.collisionRadius * 0.8);
        const overlapY = dy < (this.machine.radius + enemy.collisionRadius);

        if (overlapX && overlapY) {
          // Check for stomp: machine descending and machine bottom lands on walker top
          const isStomp = (this.machine.vy > 0) && (this.machine.y < enemy.y - 6);

          if (isStomp) {
            // Successful Stomp
            enemy.active = false;
            enemy.defeatTimer = 25;
            this.machine.vy = -8.2; // stomp hop
            const earnedMs = TIME_REWARD_STOMP; // +2000
            const earnedScore = SCORE_STOMP;   // +150
            this.remainingMs += earnedMs;
            this.score += earnedScore;
            this.updateRank();

            this.events.emit({
              kind: 'ground_stomp',
              tick: this.tickCount,
              enemyId: enemy.id,
              amountMs: earnedMs,
              source: 'machine',
              contact: 'top'
            });

            audio.play('stomp');
            this.addFloatingText(enemy.x, enemy.y - 20, '+2s STOMP!', '#00ffcc');
            this.spawnDefeatBurst(enemy.x, enemy.y);
            this.machine.setExpression('bounce', 20);
          } else {
            // Horizontal Body Contact Penalty
            if (!enemy.overlappingHurt) {
              enemy.overlappingHurt = true;
              enemy.active = false;
              enemy.defeatTimer = 25;
              const penalty = TIME_PENALTY_BODY_HIT; // -3000
              this.remainingMs += penalty;

              this.events.emit({
                kind: 'wrong_side_hit',
                tick: this.tickCount,
                enemyId: enemy.id,
                amountMs: penalty,
                source: 'machine',
                contact: 'body'
              });

              audio.play('wrongSideHit');
              this.addFloatingText(this.machine.x, this.machine.y - 25, '-3s CONTACT!', '#ff3366');
              this.machine.setExpression('dismay', 30);

              if (this.remainingMs <= 0) {
                this.remainingMs = 0;
                this.phase = 'game_over';
                this.sessionBestScore = Math.max(this.sessionBestScore, this.score);
                this.machine.setExpression('spent', 99999);
                this.ball.active = false;
                return;
              }
            }
          }
        }
      }
    }

    // Clean up enemies that left the screen or finished their defeat animation
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const offScreenLeft = e.vx < 0 && e.x < -e.visualRadius - 30;
      const offScreenRight = e.vx > 0 && e.x > STAGE_WIDTH + e.visualRadius + 30;
      const defeatExpired = !e.active && e.defeatTimer <= 0;

      if (offScreenLeft || offScreenRight || defeatExpired) {
        // If an opening flyer escaped without defeat, schedule next slow flyer within 2 seconds
        if (this.counters.airEnemiesDefeated === 0 && (e.type === 'slowFlyer' || e.type === 'fastFlyer') && e.active) {
          this.nextAirSpawnTick = this.tickCount + 120;
        }
        this.enemies.splice(i, 1);
      }
    }

    // 6. Update View-Only Particles and Floaters
    this.particles = this.particles.filter(p => p.update());
    this.floatingTexts = this.floatingTexts.filter(f => f.update());
  }

  // advance(ms): fixed-step production simulation runner
  advance(ms) {
    if (ms <= 0) return;

    // Check if held input should awaken game from ready state
    if (this.phase === 'ready') {
      if (this.input.left || this.input.right || this.input.jump) {
        this.startRun();
      } else {
        // "Before the first movement or jump, the ready state is frozen."
        return;
      }
    }

    if (this.phase === 'game_over') {
      // Frozen after clock has emptied
      return;
    }

    this.timeAccumulator += ms;
    while (this.timeAccumulator >= TICK_MS) {
      this.timeAccumulator -= TICK_MS;
      this.tick();
      if (this.phase !== 'playing') {
        this.timeAccumulator = 0;
        break;
      }
    }
  }

  // Telemetry Snapshot
  snapshot() {
    return {
      phase: this.phase,
      tick: this.tickCount,
      elapsedMs: this.elapsedMs,
      remainingMs: Math.max(0, this.remainingMs),
      seed: this.seed,
      rngState: this.rng.getState(),
      score: this.score,
      difficulty: this.difficulty,
      rank: this.rank,
      input: {
        left: !!this.input.left,
        right: !!this.input.right,
        jump: !!this.input.jump
      },
      groundY: GROUND_Y,
      lowLaneY: LOW_LANE_Y,
      highLaneY: HIGH_LANE_Y,
      machineNormalApexY: MACHINE_NORMAL_APEX_Y,
      machine: {
        x: this.machine.x,
        y: this.machine.y,
        vx: this.machine.vx,
        vy: this.machine.vy,
        radius: this.machine.radius,
        grounded: this.machine.grounded,
        jumpCount: this.machine.jumpCount
      },
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        radius: this.ball.radius,
        active: this.ball.active,
        lastBounceKind: this.ball.lastBounceKind
      },
      counters: {
        topHits: this.counters.topHits,
        airEnemiesDefeated: this.counters.airEnemiesDefeated,
        wrongSideHits: this.counters.wrongSideHits,
        ballDrops: this.counters.ballDrops,
        longestCleanSequence: this.counters.longestCleanSequence
      },
      enemies: this.enemies
        .slice()
        .sort((a, b) => a.id - b.id)
        .map(e => ({
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
        })),
      recentEvents: [...this.events.recentEvents],
      lastEvent: this.events.lastEvent ? { ...this.events.lastEvent } : null
    };
  }
}
