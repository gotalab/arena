/**
 * DELVE: Deep Core Descent
 * Timed Digging Arcade Game
 * Built for the Arena platform
 */

(function() {
  'use strict';

  // --- DETERMINISTIC PSEUDO-RANDOM NUMBER GENERATOR (Mulberry32) ---
  class PRNG {
    constructor(seed = 1337) {
      this.seed = (seed >>> 0) || 1337;
      this.state = this.seed;
    }

    next() {
      let t = (this.state += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    range(min, max) {
      return min + this.next() * (max - min);
    }

    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    }
  }

  // --- AUDIO SYNTHESIS ENGINE (Web Audio API) ---
  class SoundFX {
    constructor() {
      this.ctx = null;
      this.initialized = false;
      this.engineOsc = null;
      this.engineGain = null;
      this.engineFilter = null;
      this.lastHeartbeatMs = 0;
    }

    init() {
      if (this.initialized) return;
      try {
        const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }

        // Persistent engine drone
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);

        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.setValueAtTime(220, this.ctx.currentTime);

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);

        this.engineOsc.start();
        this.initialized = true;
      } catch (e) {
        // Fallback silently if Web Audio is unsupported
      }
    }

    updateEngine(speed, maxSpeed, isInvincible, phase) {
      if (!this.initialized || !this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      if (phase !== 'playing') {
        this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.1);
        return;
      }

      const ratio = Math.max(0, Math.min(1, speed / maxSpeed));
      const freq = isInvincible ? 160 + ratio * 280 : 70 + ratio * 220;
      const cutoff = isInvincible ? 800 + ratio * 1400 : 250 + ratio * 900;
      const vol = isInvincible ? 0.08 : 0.035 + ratio * 0.045;

      this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
      this.engineFilter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.05);
      this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);
    }

    playRockHit() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.22);
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.26);

      this.playNoiseBurst(0.18, 500, 0.2);
    }

    playRockBroken() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(880, t + 0.18);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.23);

      this.playNoiseBurst(0.15, 1800, 0.22);
    }

    playWallContact() {
      if (!this.initialized || !this.ctx) return;
      this.playNoiseBurst(0.12, 700, 0.15);
    }

    playFragmentPickup(combo = 0) {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
      const note = scale[combo % scale.length];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(note, t);
      osc.frequency.exponentialRampToValueAtTime(note * 1.5, t + 0.12);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    }

    playPowerPickup() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + i * 0.05);
        gain.gain.setValueAtTime(0.2, t + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t + i * 0.05);
        osc.stop(t + 0.5);
      });
    }

    playNearMiss(streak = 1) {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const baseFreq = 400 + Math.min(10, streak) * 70;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.8, t + 0.14);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(baseFreq * 1.2, t);
      filter.Q.value = 4.0;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.16);
    }

    playLowTimeHeartbeat() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.16);
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.19);
    }

    playGameOver() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.6);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(350, t);
      filter.exponentialRampToValueAtTime(80, t + 0.6);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.68);
    }

    playNoiseBurst(duration, cutoff, volume) {
      if (!this.ctx) return;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = cutoff;
      filter.Q.value = 2.0;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      whiteNoise.start();
    }
  }

  // Stable rounding helper for snapshots
  function round(val, decimals = 2) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }

  // --- CORE GAME SIMULATION ---
  class DelveSimulation {
    constructor(seed = 1337) {
      this.sound = new SoundFX();
      this.reset(seed);
    }

    reset(seed = 1337) {
      this.seed = (seed >>> 0) || 1337;
      this.prng = new PRNG(this.seed);

      // Simulation constants
      this.FIXED_DT = 1 / 60; // 60 Hz step
      this.FIXED_DT_MS = 1000 / 60;
      this.PLAYER_RADIUS = 14;
      this.MIN_SPEED = 90;    // Idle crawl floor (~1/5th cruise)
      this.CRUISE_SPEED = 280;
      this.MAX_SPEED = 460;   // Full throttle
      this.ACCEL_RATE = 350;  // Units/s²
      this.COAST_DRAG = 180;  // Units/s²
      this.STALL_DECEL = 1600; // Units/s² (collapses speed in < 0.25s)
      this.PREVIEW_DISTANCE = 920; // Fixed world-space preview horizon

      // Procedural corridor seed offsets
      this.seedOffsets = [
        this.prng.range(0, 100),
        this.prng.range(0, 100),
        this.prng.range(0, 100),
        this.prng.range(0, 100),
        this.prng.range(0, 100)
      ];

      // Run state
      this.phase = 'ready'; // "ready" | "playing" | "gameover"
      this.tick = 0;
      this.elapsedMs = 0;
      this.timeMs = 0;
      this.remainingMs = 18000;
      this.MAX_REMAINING_MS = 24000; // 20.0s starting chronometer
      this.spawnIndex = 0;
      this.difficulty = 1.0;
      this.score = 0;
      this.depth = 0;

      // Player physical state
      this.x = 0;
      this.vx = 0;
      this.speed = this.MIN_SPEED;
      this.stallTimeRemaining = 0;

      // Held input state
      this.input = {
        down: false,
        left: false,
        right: false,
        steer: 0,
        accel: 0
      };

      // Counters & Events
      this.hits = 0;
      this.wallContacts = 0;
      this.fragmentsCollected = 0;
      this.rocksBroken = 0;
      this.invincibleUntilMs = 0;
      this.rank = null;

      // Event history (bounded, ordered, sequential)
      this.events = [];
      this.eventSeq = 0;

      // Entities
      this.nextEntityId = 1;
      this.rocks = [];
      this.items = [];

      // Tracking stats for end of run ceremony
      this.nearMissStreak = 0;
      this.maxNearMissStreak = 0;
      this.fullThrottleDurationMs = 0;
      this.closestShavePx = 999;
      this.lastWallContactTick = -99;

      // World generation tracker
      this.generatedDepth = 0;
      this.formationCounter = 1;
      this.nextPowerDepth = 4200;
      this.lastFormationDepth = -250; // First power item guaranteed ~12,500 (~35-45s of digging)

      // Initial chunk generation
      this.generateCourseUpTo(this.PREVIEW_DISTANCE + 400);
    }

    addEvent(kind) {
      this.eventSeq++;
      const ev = {
        seq: this.eventSeq,
        kind: kind,
        tick: this.tick
      };
      this.events.push(ev);
      if (this.events.length > 200) {
        this.events.splice(0, this.events.length - 100);
      }
      return ev;
    }

    getCorridorCenter(d) {
      if (d < 250) return 0;
      const u = d - 250;
      const amp = Math.min(135, 55 + u * 0.0032);
      return amp * (
        0.60 * Math.sin(u * 0.0019 + this.seedOffsets[0]) +
        0.30 * Math.sin(u * 0.0042 + this.seedOffsets[1]) +
        0.15 * Math.sin(u * 0.0084 + this.seedOffsets[2])
      );
    }

    getCorridorHalfWidth(d) {
      return Math.max(132, Math.min(185, 162 + 16 * Math.cos(d * 0.0024 + this.seedOffsets[3]) - Math.min(22, d * 0.00032)));
    }

    getSafeX(d) {
      const center = this.getCorridorCenter(d);
      const halfW = this.getCorridorHalfWidth(d);
      return center + 0.45 * halfW * Math.sin(d * 0.0033 + this.seedOffsets[4]);
    }

    generateCourseUpTo(targetDepth) {
      const step = 280;
      while (this.generatedDepth < targetDepth) {
        const startD = Math.max(350, this.generatedDepth);
        const endD = startD + step;
        this.spawnChunk(startD, endD);
        this.generatedDepth = endD;
      }
    }

    spawnChunk(startD, endD) {
      this.spawnIndex++;
      const currentDiff = 1.0 + Math.min(3.5, startD / 8000);

      // 1. Spawning Rocks
      const rockSpacing = Math.max(120, 240 - currentDiff * 25);
      for (let d = startD; d < endD; d += rockSpacing + this.prng.range(-20, 20)) {
        const center = this.getCorridorCenter(d);
        const halfW = this.getCorridorHalfWidth(d);
        const safeX = this.getSafeX(d);

        const roll = this.prng.next();
        let visualRadius, collisionRadius;
        if (roll < 0.45) {
          visualRadius = 18;
          collisionRadius = 15;
        } else if (roll < 0.8) {
          visualRadius = 26;
          collisionRadius = 22;
        } else {
          visualRadius = 36;
          collisionRadius = 31;
        }

        const side = this.prng.next() > 0.5 ? 1 : -1;
        const minOffsetFromSafe = collisionRadius + this.PLAYER_RADIUS + 24;
        let rockX = safeX + side * (minOffsetFromSafe + this.prng.range(10, 45));

        const minX = center - halfW + collisionRadius + 12;
        const maxX = center + halfW - collisionRadius - 12;

        if (rockX < minX) {
          rockX = safeX - side * (minOffsetFromSafe + this.prng.range(10, 30));
        } else if (rockX > maxX) {
          rockX = safeX - side * (minOffsetFromSafe + this.prng.range(10, 30));
        }
        rockX = Math.max(minX, Math.min(maxX, rockX));

        if (Math.abs(rockX - safeX) >= minOffsetFromSafe) {
          this.rocks.push({
            id: this.nextEntityId++,
            position: { x: rockX, depth: d },
            active: true,
            visualRadius: visualRadius,
            collisionRadius: collisionRadius
          });
        }
      }

      // 2. Spawning Fragment Formations (spaced every ~700-900 depth units)
      if (startD - this.lastFormationDepth >= this.prng.range(520, 720)) {
        this.lastFormationDepth = startD;
        const formationKindList = ['line', 'chevron', 'triangle', 'arc'];
        const formationKind = formationKindList[this.prng.int(0, formationKindList.length - 1)];
        const fId = this.formationCounter++;
        const formD = startD + this.prng.range(40, 80);

        const fragRadius = 10;
        let count = 4;
        if (formationKind === 'chevron' || formationKind === 'arc') count = 5;
        if (formationKind === 'line') count = 4;
        if (formationKind === 'triangle') count = 3;

        // Formations veer intentionally so player must actively steer to sweep
        const lateralBias = (this.prng.next() > 0.5 ? 1 : -1) * this.prng.range(25, 55);

        for (let i = 0; i < count; i++) {
          const itemD = formD + i * 38; // strictly increasing depth order without gaps
          const cX = this.getCorridorCenter(itemD);
          const sX = this.getSafeX(itemD) + lateralBias;
          let itemX = sX;

          if (formationKind === 'line') {
            itemX = sX + (i - (count - 1) / 2) * 20;
          } else if (formationKind === 'chevron') {
            const offset = i <= 2 ? i * 26 : (4 - i) * 26;
            itemX = sX - 26 + offset;
          } else if (formationKind === 'triangle') {
            const offsets = [0, -28, 28];
            itemX = sX + (offsets[i] || 0);
          } else if (formationKind === 'arc') {
            itemX = sX + Math.sin((i / (count - 1)) * Math.PI) * 40;
          }

          const halfW = this.getCorridorHalfWidth(itemD);
          itemX = Math.max(cX - halfW + 22, Math.min(cX + halfW - 22, itemX));

          this.items.push({
            id: this.nextEntityId++,
            type: 'fragment',
            position: { x: itemX, depth: itemD },
            active: true,
            visualRadius: fragRadius,
            collisionRadius: fragRadius,
            formationId: fId,
            formationKind: formationKind,
            formationIndex: i
          });
        }
      }

      // 3. Rare Power Item Spawning
      if (startD >= this.nextPowerDepth) {
        const powerD = startD + 120;
        const powerX = this.getSafeX(powerD);
        this.items.push({
          id: this.nextEntityId++,
          type: 'power',
          position: { x: powerX, depth: powerD },
          active: true,
          visualRadius: 16,
          collisionRadius: 14
        });
        this.nextPowerDepth += 28000;
      }
    }

    step() {
      // Transition from ready to playing upon first accelerator input
      if (this.phase === 'ready') {
        if (this.input.down || this.input.accel > 0) {
          this.phase = 'playing';
        } else {
          return;
        }
      }

      // Frozen once run ends
      if (this.phase === 'gameover') {
        return;
      }

      const dt = this.FIXED_DT;
      this.tick++;
      this.timeMs += this.FIXED_DT_MS;
      this.elapsedMs = this.timeMs;
      this.remainingMs -= this.FIXED_DT_MS;

      // Chronometer countdown
      if (this.remainingMs <= 0) {
        this.remainingMs = 0;
        this.phase = 'gameover';
        this.rank = this.calculateRank(this.score);
        this.sound.playGameOver();
        return;
      }

      // Low time heartbeat warning
      if (this.remainingMs < 5000 && this.timeMs - this.sound.lastHeartbeatMs > 750) {
        this.sound.lastHeartbeatMs = this.timeMs;
        this.sound.playLowTimeHeartbeat();
      }

      this.difficulty = 1.0 + Math.min(4.0, this.depth / 8000);
      const isInvincible = this.timeMs < this.invincibleUntilMs;

      // 1. SPEED & ACCELERATION
      const isThrottling = this.input.down || this.input.accel > 0;
      if (isThrottling) {
        this.fullThrottleDurationMs += this.FIXED_DT_MS;
      }

      if (this.stallTimeRemaining > 0) {
        this.stallTimeRemaining -= dt;
        this.speed = Math.max(this.MIN_SPEED, this.speed - this.STALL_DECEL * dt);
      } else if (isThrottling) {
        const throttleIntensity = this.input.accel > 0 ? this.input.accel : 1.0;
        const targetSpeed = this.MIN_SPEED + (this.MAX_SPEED - this.MIN_SPEED) * throttleIntensity;
        if (this.speed < targetSpeed) {
          this.speed = Math.min(targetSpeed, this.speed + this.ACCEL_RATE * dt);
        } else {
          this.speed = Math.max(targetSpeed, this.speed - this.COAST_DRAG * dt);
        }
      } else {
        this.speed = Math.max(this.MIN_SPEED, this.speed - this.COAST_DRAG * dt);
      }

      const prevDepth = this.depth;
      this.depth += this.speed * dt;
      this.score = Math.floor(this.depth);

      this.sound.updateEngine(this.speed, this.MAX_SPEED, isInvincible, this.phase);

      // 2. LATERAL AUTHORITY & MOMENTUM (Speed vs Control Tension)
      const speedRatio = Math.max(0, Math.min(1, (this.speed - this.MIN_SPEED) / (this.MAX_SPEED - this.MIN_SPEED)));

      // At crawl (speedRatio=0): maxVx = 250 px/s, lateralAccel = 1900 px/s²
      // At top speed (speedRatio=1): maxVx = 110 px/s, lateralAccel = 550 px/s²
      const currentMaxVx = 250 - speedRatio * 140;
      const currentLateralAccel = 1900 - speedRatio * 1350;

      let steerInput = 0;
      if (this.input.steer !== 0) {
        steerInput = this.input.steer;
      } else {
        if (this.input.left) steerInput -= 1;
        if (this.input.right) steerInput += 1;
      }

      const targetVx = steerInput * currentMaxVx;
      if (this.vx < targetVx) {
        this.vx = Math.min(targetVx, this.vx + currentLateralAccel * dt);
      } else if (this.vx > targetVx) {
        this.vx = Math.max(targetVx, this.vx - currentLateralAccel * dt);
      }

      this.x += this.vx * dt;

      // 3. CORRIDOR WALL COLLISIONS
      const courseCenterX = this.getCorridorCenter(this.depth);
      const corridorHalfWidth = this.getCorridorHalfWidth(this.depth);
      const leftWallX = courseCenterX - corridorHalfWidth;
      const rightWallX = courseCenterX + corridorHalfWidth;

      let hitWall = false;
      if (this.x - this.PLAYER_RADIUS <= leftWallX) {
        this.x = leftWallX + this.PLAYER_RADIUS;
        this.vx = Math.max(0, this.vx);
        hitWall = true;
      } else if (this.x + this.PLAYER_RADIUS >= rightWallX) {
        this.x = rightWallX - this.PLAYER_RADIUS;
        this.vx = Math.min(0, this.vx);
        hitWall = true;
      }

      if (hitWall) {
        this.stallTimeRemaining = 0.25;
        this.speed = Math.max(this.MIN_SPEED, this.speed - this.STALL_DECEL * dt * 2.5);
        if (this.tick - this.lastWallContactTick > 15) {
          this.wallContacts++;
          this.lastWallContactTick = this.tick;
          this.addEvent('wall_contact');
          this.sound.playWallContact();
        }
      }

      // 4. ENTITY INTERACTIONS & NEAR-MISS DETECTION
      this.generateCourseUpTo(this.depth + this.PREVIEW_DISTANCE + 400);

      // Rocks interaction
      for (let i = 0; i < this.rocks.length; i++) {
        const rock = this.rocks[i];
        if (!rock.active) continue;

        const dDepth = rock.position.depth - this.depth;
        if (dDepth < -100 || dDepth > this.PREVIEW_DISTANCE + 100) continue;

        const dx = this.x - rock.position.x;
        const dist = Math.hypot(dx, this.depth - rock.position.depth);
        const contactDist = this.PLAYER_RADIUS + rock.collisionRadius;

        // Collision Check
        if (dist <= contactDist) {
          rock.active = false;
          if (isInvincible) {
            this.rocksBroken++;
            this.remainingMs = Math.min(this.MAX_REMAINING_MS, this.remainingMs + 1600); // +2.2s
            this.addEvent('rock_broken');
            this.sound.playRockBroken();
          } else {
            this.hits++;
            this.stallTimeRemaining = 0.25;
            this.speed = Math.max(this.MIN_SPEED, this.speed - this.STALL_DECEL * dt * 3.0);
            this.nearMissStreak = 0;
            this.addEvent('rock_hit');
            this.sound.playRockHit();
          }
          continue;
        }

        // Near-Miss Check (machine passes rock without contact, gap < 2*playerRadius)
        if (prevDepth < rock.position.depth && this.depth >= rock.position.depth) {
          const edgeGap = Math.abs(dx) - contactDist;
          if (edgeGap > 0 && edgeGap < 2 * this.PLAYER_RADIUS) {
            this.nearMissStreak++;
            if (this.nearMissStreak > this.maxNearMissStreak) {
              this.maxNearMissStreak = this.nearMissStreak;
            }
            if (edgeGap < this.closestShavePx) {
              this.closestShavePx = edgeGap;
            }
            this.addEvent('near_miss');
            this.sound.playNearMiss(this.nearMissStreak);
          }
        }
      }

      // Collectibles (Fragments & Power Items)
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        if (!item.active) continue;

        const dDepth = item.position.depth - this.depth;
        if (dDepth < -50 || dDepth > this.PREVIEW_DISTANCE + 50) continue;

        const dist = Math.hypot(this.x - item.position.x, this.depth - item.position.depth);
        if (dist <= this.PLAYER_RADIUS + item.collisionRadius) {
          item.active = false;
          if (item.type === 'fragment') {
            this.fragmentsCollected++;
            this.remainingMs = Math.min(this.MAX_REMAINING_MS, this.remainingMs + 750); // +1.6s
            this.addEvent('fragment');
            this.sound.playFragmentPickup(this.fragmentsCollected);
          } else if (item.type === 'power') {
            this.invincibleUntilMs = this.timeMs + 6500; // 6.5s invincibility
            this.addEvent('power');
            this.sound.playPowerPickup();
          }
        }
      }

      // Prune entities well behind the player to maintain performance
      const pruneThreshold = this.depth - 200;
      if (this.rocks.length > 0 && this.rocks[0].position.depth < pruneThreshold) {
        this.rocks = this.rocks.filter(r => r.position.depth >= pruneThreshold);
      }
      if (this.items.length > 0 && this.items[0].position.depth < pruneThreshold) {
        this.items = this.items.filter(it => it.position.depth >= pruneThreshold);
      }
    }

    calculateRank(score) {
      if (score >= 45000) return 'S+';
      if (score >= 28000) return 'S';
      if (score >= 15000) return 'A';
      if (score >= 7000) return 'B';
      if (score >= 3000) return 'C';
      return 'D';
    }

    getRankTitle(rank) {
      switch (rank) {
        case 'S+': return 'ABYSSAL LEGEND';
        case 'S': return 'MANTLE MASTER';
        case 'A': return 'CORE SEEKER';
        case 'B': return 'DEPTH RUNNER';
        case 'C': return 'STRATA BREAKER';
        default: return 'CAVERN DRIFTER';
      }
    }

    advance(ms) {
      if (this.phase === 'ready' || this.phase === 'gameover') {
        return;
      }
      let remaining = ms;
      while (remaining >= this.FIXED_DT_MS) {
        this.step();
        remaining -= this.FIXED_DT_MS;
      }
    }

    snapshot() {
      const courseCenterX = round(this.getCorridorCenter(this.depth));
      const corridorHalfWidth = round(this.getCorridorHalfWidth(this.depth));

      const walls = [];
      const sampleStep = 30;
      for (let d = this.depth; d <= this.depth + this.PREVIEW_DISTANCE; d += sampleStep) {
        const cX = this.getCorridorCenter(d);
        const hW = this.getCorridorHalfWidth(d);
        walls.push({
          depth: round(d),
          leftX: round(cX - hW),
          rightX: round(cX + hW)
        });
      }

      const safeHalfWidth = round(this.PLAYER_RADIUS + 22);
      const previewMs = Math.round((this.PREVIEW_DISTANCE / this.MAX_SPEED) * 1000);

      const visibleRocks = this.rocks
        .filter(r => r.position.depth >= this.depth - 50 && r.position.depth <= this.depth + this.PREVIEW_DISTANCE)
        .sort((a, b) => a.id - b.id)
        .map(r => ({
          id: r.id,
          position: { x: round(r.position.x), depth: round(r.position.depth) },
          active: Boolean(r.active),
          visualRadius: round(r.visualRadius),
          collisionRadius: round(r.collisionRadius)
        }));

      const visibleItems = this.items
        .filter(it => it.position.depth >= this.depth - 50 && it.position.depth <= this.depth + this.PREVIEW_DISTANCE)
        .sort((a, b) => a.id - b.id)
        .map(it => {
          const itemSnap = {
            id: it.id,
            type: it.type,
            position: { x: round(it.position.x), depth: round(it.position.depth) },
            active: Boolean(it.active),
            visualRadius: round(it.visualRadius),
            collisionRadius: round(it.collisionRadius)
          };
          if (it.type === 'fragment') {
            itemSnap.formationId = it.formationId;
            itemSnap.formationKind = it.formationKind;
            itemSnap.formationIndex = it.formationIndex;
          }
          return itemSnap;
        });

      return {
        phase: this.phase,
        tick: this.tick,
        elapsedMs: round(this.elapsedMs),
        timeMs: round(this.timeMs),
        remainingMs: round(this.remainingMs),
        seed: this.seed,
        rngState: this.prng.state,
        spawnIndex: this.spawnIndex,
        input: {
          down: Boolean(this.input.down),
          left: Boolean(this.input.left),
          right: Boolean(this.input.right),
          steer: round(this.input.steer),
          accel: round(this.input.accel)
        },
        difficulty: round(this.difficulty),
        score: this.score,
        depth: round(this.depth),

        x: round(this.x),
        playerRadius: this.PLAYER_RADIUS,
        speed: round(this.speed),
        maxSpeed: this.MAX_SPEED,

        hits: this.hits,
        wallContacts: this.wallContacts,
        fragmentsCollected: this.fragmentsCollected,
        rocksBroken: this.rocksBroken,
        invincibleUntilMs: round(this.invincibleUntilMs),
        rank: this.rank,

        courseCenterX: courseCenterX,
        corridorHalfWidth: corridorHalfWidth,
        walls: walls,
        safeHalfWidth: safeHalfWidth,
        previewMs: previewMs,

        rocks: visibleRocks,
        items: visibleItems,

        events: this.events.slice(-100),
        lastEvent: this.events.length > 0 ? this.events[this.events.length - 1] : null
      };
    }
  }

  // --- RENDERING & JUICE ---
  class DelveRenderer {
    constructor(canvas, sim) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sim = sim;

      this.particles = [];
      this.shakeIntensity = 0;
      this.lastHitCount = 0;
      this.lastNearMissCount = 0;
      this.drillAngle = 0;
      this.eyeBlinkTimer = 0;
      this.eyeBlink = false;

      this.resize();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => this.resize());
      }
    }

    resize() {
      if (!this.canvas || !this.canvas.parentElement) return;
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      this.width = rect.width || 400;
      this.height = rect.height || 700;
      this.canvas.width = Math.floor(this.width * dpr);
      this.canvas.height = Math.floor(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      this.scale = this.width / 390;
    }

    triggerShake(amount) {
      this.shakeIntensity = Math.min(24, this.shakeIntensity + amount);
    }

    update(dt) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 45);
      this.drillAngle += (this.sim.speed / 50) * dt * 25;

      this.eyeBlinkTimer -= dt;
      if (this.eyeBlinkTimer <= 0) {
        this.eyeBlink = !this.eyeBlink;
        this.eyeBlinkTimer = this.eyeBlink ? 0.14 : Math.random() * 3 + 2;
      }

      if (this.sim.hits > this.lastHitCount) {
        this.triggerShake(14);
        this.lastHitCount = this.sim.hits;
      }
      if (this.sim.nearMissStreak > this.lastNearMissCount) {
        this.triggerShake(Math.min(8, 2 + this.sim.nearMissStreak));
        this.lastNearMissCount = this.sim.nearMissStreak;
      } else if (this.sim.nearMissStreak === 0) {
        this.lastNearMissCount = 0;
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.depth += p.vDepth * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
        }
      }
    }

    render() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;

      ctx.save();

      if (this.shakeIntensity > 0) {
        const sx = (Math.random() * 2 - 1) * this.shakeIntensity;
        const sy = (Math.random() * 2 - 1) * this.shakeIntensity;
        ctx.translate(sx, sy);
      }

      const playerY = h * 0.28;
      const camDepth = this.sim.depth;

      // Subterranean background
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      const strataOffset = (camDepth * 0.3) % 120;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1.5;
      for (let y = -120 + strataOffset; y < h + 120; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + 15);
        ctx.stroke();
      }
      ctx.restore();

      const worldToScreen = (wx, wd) => {
        return {
          x: w / 2 + wx * this.scale,
          y: playerY + (wd - camDepth) * this.scale
        };
      };

      // Corridor Walls
      ctx.save();
      const renderHorizon = 850;
      const step = 25;

      // Left Wall
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let d = camDepth - 100; d <= camDepth + renderHorizon; d += step) {
        const cX = this.sim.getCorridorCenter(d);
        const hW = this.sim.getCorridorHalfWidth(d);
        const p = worldToScreen(cX - hW, d);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = '#111722';
      ctx.fill();
      ctx.strokeStyle = '#223046';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Right Wall
      ctx.beginPath();
      ctx.moveTo(w, 0);
      for (let d = camDepth - 100; d <= camDepth + renderHorizon; d += step) {
        const cX = this.sim.getCorridorCenter(d);
        const hW = this.sim.getCorridorHalfWidth(d);
        const p = worldToScreen(cX + hW, d);
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = '#111722';
      ctx.fill();
      ctx.strokeStyle = '#223046';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Wall bioluminescent crystal veins
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let d = camDepth - 80; d <= camDepth + renderHorizon; d += step * 2) {
        const cX = this.sim.getCorridorCenter(d);
        const hW = this.sim.getCorridorHalfWidth(d);
        const lp = worldToScreen(cX - hW + 4, d);
        ctx.moveTo(lp.x - 6, lp.y - 12);
        ctx.lineTo(lp.x, lp.y);
        ctx.lineTo(lp.x - 8, lp.y + 14);

        const rp = worldToScreen(cX + hW - 4, d);
        ctx.moveTo(rp.x + 6, rp.y - 10);
        ctx.lineTo(rp.x, rp.y);
        ctx.lineTo(rp.x + 8, rp.y + 12);
      }
      ctx.stroke();
      ctx.restore();

      // Speed Streaks
      const speedRatio = Math.max(0, Math.min(1, (this.sim.speed - this.sim.MIN_SPEED) / (this.sim.MAX_SPEED - this.sim.MIN_SPEED)));
      if (speedRatio > 0.45 && this.sim.phase === 'playing') {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 204, 0, ${0.12 * speedRatio})`;
        ctx.lineWidth = 1.5;
        const streakCount = Math.floor(speedRatio * 16);
        for (let i = 0; i < streakCount; i++) {
          const rx = (Math.sin(i * 99 + this.sim.tick * 0.1) * 0.5 + 0.5) * w;
          const ry = ((i * 45 + this.sim.tick * 18) % h);
          const len = 40 + speedRatio * 80;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx, ry - len);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Collectibles
      for (const item of this.sim.items) {
        if (!item.active) continue;
        const sp = worldToScreen(item.position.x, item.position.depth);
        if (sp.y < -30 || sp.y > h + 40) continue;

        const rad = item.visualRadius * this.scale;
        ctx.save();
        ctx.translate(sp.x, sp.y);

        if (item.type === 'fragment') {
          ctx.shadowColor = '#00e5ff';
          ctx.shadowBlur = 12;

          ctx.fillStyle = '#00e5ff';
          ctx.beginPath();
          ctx.moveTo(0, -rad * 1.3);
          ctx.lineTo(rad * 0.9, 0);
          ctx.lineTo(0, rad * 1.3);
          ctx.lineTo(-rad * 0.9, 0);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(0, -rad * 1.1);
          ctx.lineTo(rad * 0.45, 0);
          ctx.lineTo(0, rad * 0.5);
          ctx.lineTo(-rad * 0.45, 0);
          ctx.closePath();
          ctx.fill();
        } else if (item.type === 'power') {
          const pulse = 1.0 + 0.15 * Math.sin(this.sim.tick * 0.15);
          ctx.shadowColor = '#ff9900';
          ctx.shadowBlur = 24;

          const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, rad * pulse);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.4, '#ffcc00');
          grad.addColorStop(1, '#ff3300');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, rad * pulse, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, rad * 1.4 * pulse, this.sim.tick * 0.08, this.sim.tick * 0.08 + 1.8);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Rocks
      const isOverdrive = this.sim.timeMs < this.sim.invincibleUntilMs;
      for (const rock of this.sim.rocks) {
        if (!rock.active) continue;
        const sp = worldToScreen(rock.position.x, rock.position.depth);
        if (sp.y < -50 || sp.y > h + 60) continue;

        const rad = rock.visualRadius * this.scale;
        ctx.save();
        ctx.translate(sp.x, sp.y);

        if (isOverdrive) {
          ctx.shadowColor = 'rgba(255, 68, 0, 0.6)';
          ctx.shadowBlur = 14;
        }

        ctx.fillStyle = isOverdrive ? '#4a2520' : '#283344';
        ctx.strokeStyle = isOverdrive ? '#ff5522' : '#45556d';
        ctx.lineWidth = 2;

        ctx.beginPath();
        const verts = 7;
        for (let i = 0; i < verts; i++) {
          const a = (i / verts) * Math.PI * 2;
          const rVar = 0.82 + 0.36 * Math.sin(rock.id * 13 + i * 4);
          const px = Math.cos(a) * rad * rVar;
          const py = Math.sin(a) * rad * rVar;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = isOverdrive ? '#ff8833' : '#1c2432';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-rad * 0.3, -rad * 0.2);
        ctx.lineTo(rad * 0.2, rad * 0.1);
        ctx.lineTo(rad * 0.4, rad * 0.4);
        ctx.stroke();

        ctx.restore();
      }

      // Machine Character
      const playerScreen = worldToScreen(this.sim.x, this.sim.depth);
      this.renderMachine(ctx, playerScreen.x, playerScreen.y, isOverdrive);

      ctx.restore();
    }

    renderMachine(ctx, px, py, isOverdrive) {
      ctx.save();
      ctx.translate(px, py);

      const speedRatio = Math.max(0, Math.min(1, (this.sim.speed - this.sim.MIN_SPEED) / (this.sim.MAX_SPEED - this.sim.MIN_SPEED)));
      const isCrashed = this.sim.stallTimeRemaining > 0;
      const isGameOver = this.sim.phase === 'gameover';
      const isReady = this.sim.phase === 'ready';

      const steerTilt = (this.sim.vx / 200) * 0.22;
      ctx.rotate(steerTilt);

      let scaleX = 1.0;
      let scaleY = 1.0;
      if (isCrashed) {
        scaleX = 1.35;
        scaleY = 0.7;
      } else if (speedRatio > 0.7) {
        scaleX = 0.88;
        scaleY = 1.18;
      } else if (isReady) {
        scaleY = 1.0 + 0.04 * Math.sin(this.sim.tick * 0.08);
      }
      ctx.scale(scaleX, scaleY);

      if (isOverdrive) {
        ctx.save();
        ctx.shadowColor = '#ffbb00';
        ctx.shadowBlur = 25;
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 24 * this.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Exhaust Thruster
      if (this.sim.phase === 'playing' && !isGameOver) {
        ctx.save();
        const flameLen = (12 + speedRatio * 26) * this.scale;
        const flameWidth = (8 + speedRatio * 8) * this.scale;

        const flameGrad = ctx.createLinearGradient(0, -18 * this.scale, 0, -18 * this.scale - flameLen);
        flameGrad.addColorStop(0, '#ffffff');
        flameGrad.addColorStop(0.3, isOverdrive ? '#ffea00' : '#00e5ff');
        flameGrad.addColorStop(1, 'rgba(255, 68, 0, 0)');

        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.moveTo(-flameWidth / 2, -16 * this.scale);
        ctx.lineTo(flameWidth / 2, -16 * this.scale);
        ctx.lineTo(0, -16 * this.scale - flameLen);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Pod Body
      const podW = 26 * this.scale;
      const podH = 30 * this.scale;

      ctx.save();
      ctx.fillStyle = isOverdrive ? '#e65c00' : '#2266aa';
      ctx.strokeStyle = '#d0e4ff';
      ctx.lineWidth = 2 * this.scale;

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(-podW / 2, -podH / 2, podW, podH, 12 * this.scale);
      } else {
        ctx.rect(-podW / 2, -podH / 2, podW, podH);
      }
      ctx.fill();
      ctx.stroke();

      // Side fins
      ctx.fillStyle = '#164373';
      ctx.fillRect(-podW / 2 - 4 * this.scale, -4 * this.scale, 4 * this.scale, 12 * this.scale);
      ctx.fillRect(podW / 2, -4 * this.scale, 4 * this.scale, 12 * this.scale);
      ctx.restore();

      // Expressive Dome Visor / Eye
      ctx.save();
      const eyeY = -2 * this.scale;
      const eyeR = 7.5 * this.scale;

      ctx.fillStyle = '#0a101d';
      ctx.beginPath();
      ctx.arc(0, eyeY, eyeR + 1.5, 0, Math.PI * 2);
      ctx.fill();

      if (isGameOver) {
        ctx.strokeStyle = '#4a5d78';
        ctx.lineWidth = 2 * this.scale;
        ctx.beginPath();
        ctx.moveTo(-eyeR * 0.7, eyeY);
        ctx.lineTo(eyeR * 0.7, eyeY);
        ctx.stroke();
      } else if (isCrashed) {
        ctx.strokeStyle = '#ffdd44';
        ctx.lineWidth = 1.5 * this.scale;
        ctx.beginPath();
        ctx.arc(0, eyeY, eyeR * 0.6, this.sim.tick * 0.4, this.sim.tick * 0.4 + 4.5);
        ctx.stroke();
      } else {
        const eyeGrad = ctx.createRadialGradient(0, eyeY, 1, 0, eyeY, eyeR);
        eyeGrad.addColorStop(0, '#ffffff');
        eyeGrad.addColorStop(0.7, isOverdrive ? '#ffcc00' : '#00e5ff');
        eyeGrad.addColorStop(1, '#0088cc');

        ctx.fillStyle = eyeGrad;
        ctx.beginPath();
        ctx.arc(0, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();

        if (speedRatio > 0.75 || this.eyeBlink) {
          ctx.fillStyle = '#164373';
          ctx.beginPath();
          ctx.arc(0, eyeY, eyeR + 1, Math.PI * 1.1, Math.PI * 1.9);
          ctx.fill();
        }

        const pupilOffset = Math.max(-3, Math.min(3, (this.sim.vx / 200) * 3)) * this.scale;
        ctx.fillStyle = '#06101e';
        ctx.beginPath();
        ctx.arc(pupilOffset, eyeY + 1 * this.scale, eyeR * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Conical Drill Bit
      ctx.save();
      const drillY = podH / 2;
      const drillLen = 16 * this.scale;
      const drillW = 18 * this.scale;

      ctx.fillStyle = '#9fb3cc';
      ctx.strokeStyle = '#e0ecff';
      ctx.lineWidth = 1.5 * this.scale;

      ctx.beginPath();
      ctx.moveTo(-drillW / 2, drillY);
      ctx.lineTo(drillW / 2, drillY);
      ctx.lineTo(0, drillY + drillLen);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#5a708c';
      ctx.lineWidth = 1.8 * this.scale;
      ctx.beginPath();
      const groovePhase = (this.drillAngle % (Math.PI * 2));
      const gOffset = Math.sin(groovePhase) * (drillW * 0.3);
      ctx.moveTo(gOffset, drillY + 2 * this.scale);
      ctx.lineTo(0, drillY + drillLen);
      ctx.stroke();

      ctx.restore();
      ctx.restore();
    }
  }

  // --- SINGLETON SIMULATION INSTANCE ---
  // Guarantees single source of truth for UI, headless replay, and platform runtime interface
  const globalSim = new DelveSimulation(1337);

  // Expose window.__ARENA_GAME__ interface immediately
  if (typeof window !== 'undefined') {
    window.__ARENA_GAME__ = {
      reset: function(seed) {
        globalSim.reset(seed);
        if (appInstance) {
          appInstance.syncUIOnReset();
        }
        return globalSim.snapshot();
      },

      advance: function(ms) {
        globalSim.advance(ms);
        if (appInstance) {
          appInstance.updateUI();
        }
      },

      snapshot: function() {
        return globalSim.snapshot();
      }
    };
  }

  // --- APP CONTROLLER (DOM, Controls & Display) ---
  let appInstance = null;

  class GameApp {
    constructor(sim) {
      this.sim = sim;
      this.canvas = document.getElementById('game-canvas');
      this.renderer = this.canvas ? new DelveRenderer(this.canvas, this.sim) : null;

      // DOM UI Elements
      this.uiDepth = document.getElementById('val-depth');
      this.uiTimer = document.getElementById('val-timer');
      this.uiTimerBar = document.getElementById('val-timer-bar');
      this.hudTimer = document.getElementById('hud-timer');
      this.uiSpeed = document.getElementById('val-speed');
      this.overdriveBanner = document.getElementById('overdrive-banner');
      this.startPrompt = document.getElementById('start-prompt');
      this.streakIndicator = document.getElementById('streak-indicator');
      this.uiStreak = document.getElementById('val-streak');

      this.gameoverScreen = document.getElementById('gameover-screen');
      this.goRank = document.getElementById('go-rank');
      this.goRankTitle = document.getElementById('go-rank-title');
      this.goDepth = document.getElementById('go-depth');
      this.goScore = document.getElementById('go-score');
      this.goBest = document.getElementById('go-best');
      this.goFragments = document.getElementById('go-fragments');
      this.goSigLabel = document.getElementById('go-sig-label');
      this.goSigValue = document.getElementById('go-sig-value');
      this.goRestartBtn = document.getElementById('go-restart-btn');

      this.touchStick = document.getElementById('touch-stick');
      this.touchNub = document.getElementById('touch-nub');

      this.sessionBestScore = 0;
      this.touchActive = false;
      this.touchStartX = 0;
      this.touchStartY = 0;

      this.lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this.animFrameId = null;

      this.setupControls();
      this.startLoop();
    }

    setupControls() {
      if (typeof window === 'undefined') return;

      // Keyboard input attached at document level with preventDefault for game keys
      window.addEventListener('keydown', (e) => {
        this.sim.sound.init();

        if (e.code === 'ArrowDown' || e.code === 'Space') {
          if (e.preventDefault) e.preventDefault();
          this.sim.input.down = true;
          if (this.sim.phase === 'ready') {
            this.sim.phase = 'playing';
            if (this.startPrompt) this.startPrompt.style.opacity = '0';
          }
        }
        if (e.code === 'ArrowLeft') {
          if (e.preventDefault) e.preventDefault();
          this.sim.input.left = true;
        }
        if (e.code === 'ArrowRight') {
          if (e.preventDefault) e.preventDefault();
          this.sim.input.right = true;
        }
        if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
          if (e.preventDefault) e.preventDefault();
          this.sim.reset(this.sim.seed);
          this.syncUIOnReset();
        }
      }, { passive: false });

      window.addEventListener('keyup', (e) => {
        if (e.code === 'ArrowDown' || e.code === 'Space') {
          this.sim.input.down = false;
        }
        if (e.code === 'ArrowLeft') {
          this.sim.input.left = false;
        }
        if (e.code === 'ArrowRight') {
          this.sim.input.right = false;
        }
      });

      // Pointer / Touch controls: Planted stick on touch down, independent axes
      const container = document.getElementById('game-container');
      if (container) {
        container.addEventListener('pointerdown', (e) => {
          this.sim.sound.init();

          if (this.sim.phase === 'gameover') {
            this.sim.reset(this.sim.seed);
            this.syncUIOnReset();
            return;
          }

          this.touchActive = true;
          this.touchStartX = e.clientX;
          this.touchStartY = e.clientY;

          if (this.touchStick) {
            this.touchStick.style.display = 'block';
            this.touchStick.style.left = `${this.touchStartX}px`;
            this.touchStick.style.top = `${this.touchStartY}px`;
          }
          if (this.touchNub) {
            this.touchNub.style.left = '45px';
            this.touchNub.style.top = '45px';
          }
        });
      }

      window.addEventListener('pointermove', (e) => {
        if (!this.touchActive) return;

        const dx = e.clientX - this.touchStartX;
        const dy = e.clientY - this.touchStartY;

        if (this.touchNub) {
          const dist = Math.hypot(dx, dy);
          const maxDist = 42;
          const clampedX = dist > 0 ? (dx / dist) * Math.min(dist, maxDist) : 0;
          const clampedY = dist > 0 ? (dy / dist) * Math.min(dist, maxDist) : 0;
          this.touchNub.style.left = `${45 + clampedX}px`;
          this.touchNub.style.top = `${45 + clampedY}px`;
        }

        // Downward drag holds accelerator (pushing down is pushing deeper)
        const deadzoneY = 12;
        if (dy > deadzoneY) {
          this.sim.input.down = true;
          this.sim.input.accel = Math.min(1.0, (dy - deadzoneY) / 45);
          if (this.sim.phase === 'ready') {
            this.sim.phase = 'playing';
            if (this.startPrompt) this.startPrompt.style.opacity = '0';
          }
        } else {
          this.sim.input.down = false;
          this.sim.input.accel = 0;
        }

        // Horizontal offset steers left / right
        const deadzoneX = 8;
        if (Math.abs(dx) > deadzoneX) {
          const sign = Math.sign(dx);
          const rawSteer = (Math.abs(dx) - deadzoneX) / 40;
          this.sim.input.steer = Math.max(-1, Math.min(1, sign * rawSteer));
          this.sim.input.left = this.sim.input.steer < -0.2;
          this.sim.input.right = this.sim.input.steer > 0.2;
        } else {
          this.sim.input.steer = 0;
          this.sim.input.left = false;
          this.sim.input.right = false;
        }
      });

      const endTouch = () => {
        this.touchActive = false;
        if (this.touchStick) this.touchStick.style.display = 'none';
        this.sim.input.down = false;
        this.sim.input.accel = 0;
        this.sim.input.steer = 0;
        this.sim.input.left = false;
        this.sim.input.right = false;
      };

      window.addEventListener('pointerup', endTouch);
      window.addEventListener('pointercancel', endTouch);

      if (this.goRestartBtn) {
        this.goRestartBtn.addEventListener('click', (e) => {
          if (e.stopPropagation) e.stopPropagation();
          this.sim.reset(this.sim.seed);
          this.syncUIOnReset();
        });
      }
    }

    syncUIOnReset() {
      if (this.gameoverScreen) this.gameoverScreen.style.display = 'none';
      if (this.startPrompt) this.startPrompt.style.opacity = '1';
      if (this.streakIndicator) this.streakIndicator.classList.remove('active');
      if (this.overdriveBanner) this.overdriveBanner.style.display = 'none';
      this.updateUI();
    }

    updateUI() {
      if (this.uiDepth) this.uiDepth.textContent = `${Math.floor(this.sim.depth)}m`;
      if (this.uiSpeed) this.uiSpeed.textContent = `${Math.floor(this.sim.speed)}`;

      if (this.uiTimer) {
        const remSec = (this.sim.remainingMs / 1000).toFixed(1);
        this.uiTimer.textContent = `${remSec}s`;
      }
      if (this.uiTimerBar) {
        const timerRatio = Math.max(0, Math.min(1, this.sim.remainingMs / 20000));
        this.uiTimerBar.style.width = `${timerRatio * 100}%`;
      }

      if (this.hudTimer) {
        if (this.sim.remainingMs <= 5000 && this.sim.phase === 'playing') {
          this.hudTimer.classList.add('warning');
        } else {
          this.hudTimer.classList.remove('warning');
        }
      }

      if (this.overdriveBanner) {
        const isOverdrive = this.sim.timeMs < this.sim.invincibleUntilMs;
        this.overdriveBanner.style.display = isOverdrive ? 'block' : 'none';
      }

      if (this.streakIndicator) {
        if (this.sim.nearMissStreak >= 2) {
          this.streakIndicator.classList.add('active');
          if (this.uiStreak) this.uiStreak.textContent = `x${this.sim.nearMissStreak}`;
        } else {
          this.streakIndicator.classList.remove('active');
        }
      }

      if (this.gameoverScreen) {
        if (this.sim.phase === 'gameover' && this.gameoverScreen.style.display !== 'flex') {
          if (this.sim.score > this.sessionBestScore) {
            this.sessionBestScore = this.sim.score;
          }

          if (this.goRank) this.goRank.textContent = this.sim.rank || 'D';
          if (this.goRankTitle) this.goRankTitle.textContent = this.sim.getRankTitle(this.sim.rank);
          if (this.goDepth) this.goDepth.textContent = `${Math.floor(this.sim.depth)}m`;
          if (this.goScore) this.goScore.textContent = `${this.sim.score}`;
          if (this.goBest) this.goBest.textContent = `${this.sessionBestScore}`;
          if (this.goFragments) this.goFragments.textContent = `${this.sim.fragmentsCollected}`;

          if (this.sim.maxNearMissStreak >= 3) {
            if (this.goSigLabel) this.goSigLabel.textContent = 'MAX GRAZE STREAK';
            if (this.goSigValue) this.goSigValue.textContent = `${this.sim.maxNearMissStreak} IN A ROW`;
          } else if (this.sim.closestShavePx < 15) {
            if (this.goSigLabel) this.goSigLabel.textContent = 'CLOSEST SHAVE';
            if (this.goSigValue) this.goSigValue.textContent = `${this.sim.closestShavePx.toFixed(1)}px GAP`;
          } else {
            const throttlePct = this.sim.timeMs > 0 ? Math.round((this.sim.fullThrottleDurationMs / this.sim.timeMs) * 100) : 0;
            if (this.goSigLabel) this.goSigLabel.textContent = 'THROTTLE HELD';
            if (this.goSigValue) this.goSigValue.textContent = `${throttlePct}% OF RUN`;
          }

          this.gameoverScreen.style.display = 'flex';
        }
      }
    }

    startLoop() {
      if (typeof requestAnimationFrame === 'undefined') return;

      let accumulator = 0;
      const loop = (timestamp) => {
        const now = timestamp || performance.now();
        const elapsed = Math.min(100, now - this.lastFrameTime);
        this.lastFrameTime = now;

        accumulator += elapsed;
        while (accumulator >= this.sim.FIXED_DT_MS) {
          this.sim.step();
          accumulator -= this.sim.FIXED_DT_MS;
        }

        const dt = elapsed / 1000;
        if (this.renderer) {
          this.renderer.update(dt);
          this.renderer.render();
        }
        this.updateUI();

        this.animFrameId = requestAnimationFrame(loop);
      };
      this.animFrameId = requestAnimationFrame(loop);
    }
  }

  // Initialization when DOM is ready
  function initGame() {
    if (!appInstance && typeof document !== 'undefined') {
      appInstance = new GameApp(globalSim);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initGame);
    } else {
      initGame();
    }
  }

})();
