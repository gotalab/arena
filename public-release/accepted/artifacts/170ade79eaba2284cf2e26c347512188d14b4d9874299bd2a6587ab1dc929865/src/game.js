import { CONSTANTS, getRank, getChainScore } from './constants.js';
import { SeededRNG } from './rng.js';
import { SoundEngine } from './audio.js';
import { WorldGenerator } from './world.js';
import { VFXManager } from './vfx.js';
import { Renderer } from './renderer.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.audio = new SoundEngine();
    this.vfx = new VFXManager();
    this.renderer = new Renderer(canvas);

    this.sessionBest = 0;
    this.seed = 1337;
    this.rng = new SeededRNG(this.seed);
    this.world = new WorldGenerator(this.rng);

    // Run State
    this.phase = 'ready'; // 'ready' | 'playing' | 'gameover'
    this.tick = 0;
    this.elapsedMs = 0;
    this.difficulty = 0;
    this.score = 0;
    this.height = 0;
    this.rank = null;
    this.spawnIndex = 0;

    // Player State
    this.spark = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      playerRadius: CONSTANTS.PLAYER_RADIUS,
      anchored: true,
      anchorKind: 'ledge',
      currentLedgeId: 1,
      stretchX: 1.0,
      stretchY: 1.0
    };

    // Glow Economy Counters
    this.jumpCapacity = CONSTANTS.JUMP_CAPACITY;
    this.jumpsLeft = CONSTANTS.JUMP_CAPACITY;
    this.launches = 0;
    this.midairLaunches = 0;
    this.landings = 0;
    this.refunds = 0;
    this.glimmersCollected = 0;

    // Chain State
    this.chainCount = 0;
    this.chainBest = 0;

    // Damp State
    this.dampY = CONSTANTS.DAMP_INITIAL_Y;
    this.dampSpeed = CONSTANTS.BASE_DAMP_SPEED;

    // Input Aim State
    this.input = {
      dragging: false,
      originX: 0,
      originY: 0,
      dx: 0,
      dy: 0
    };

    // Events
    this.lastEvent = null;

    // Timing & Loop
    this.lastTime = 0;
    this.accumulator = 0;

    this.bindEvents();
    this.reset(this.seed);
  }

  reset(seed = 1337) {
    this.seed = seed;
    this.rng.reset(seed);
    this.world.reset();
    this.vfx.reset();

    this.phase = 'ready';
    this.tick = 0;
    this.elapsedMs = 0;
    this.difficulty = 0;
    this.score = 0;
    this.height = 0;
    this.rank = null;
    this.spawnIndex = this.world.nextLedgeId + this.world.nextItemId;

    // Starting on initial ledge at y = 0
    this.spark = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      playerRadius: CONSTANTS.PLAYER_RADIUS,
      anchored: true,
      anchorKind: 'ledge',
      currentLedgeId: 1,
      stretchX: 1.0,
      stretchY: 1.0
    };

    this.jumpCapacity = CONSTANTS.JUMP_CAPACITY;
    this.jumpsLeft = CONSTANTS.JUMP_CAPACITY;
    this.launches = 0;
    this.midairLaunches = 0;
    this.landings = 0;
    this.refunds = 0;
    this.glimmersCollected = 0;

    this.chainCount = 0;
    this.chainBest = 0;

    this.dampY = CONSTANTS.DAMP_INITIAL_Y;
    this.dampSpeed = CONSTANTS.BASE_DAMP_SPEED;

    this.input = {
      dragging: false,
      originX: 0,
      originY: 0,
      dx: 0,
      dy: 0
    };

    this.lastEvent = null;
  }

  bindEvents() {
    const el = this.canvas;

    const getPointerCoords = (e) => {
      const rect = el.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();

      if (this.phase === 'gameover') {
        this.reset(this.seed);
        return;
      }

      const coords = getPointerCoords(e);
      this.input.dragging = true;
      this.input.originX = Math.round(coords.x);
      this.input.originY = Math.round(coords.y);
      this.input.dx = 0;
      this.input.dy = 0;

      if (this.jumpsLeft > 0) {
        this.audio.startAimTone(0);
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.input.dragging) return;
      const coords = getPointerCoords(e);
      this.input.dx = Math.round(coords.x - this.input.originX);
      this.input.dy = Math.round(coords.y - this.input.originY);

      const dragDist = Math.hypot(this.input.dx, this.input.dy);
      const intensity = Math.min(
        Math.max(0, dragDist - CONSTANTS.DRAG_DEADZONE_PX) / (CONSTANTS.DRAG_MAX_PX - CONSTANTS.DRAG_DEADZONE_PX),
        1.0
      );

      if (this.jumpsLeft > 0) {
        this.audio.updateAimTone(intensity);
      }
    });

    const endPointer = (e) => {
      if (!this.input.dragging) return;
      this.audio.stopAimTone();

      const dragDist = Math.hypot(this.input.dx, this.input.dy);

      // Check deadzone
      if (dragDist >= CONSTANTS.DRAG_DEADZONE_PX) {
        if (this.jumpsLeft > 0) {
          this.executeLaunch(this.input.dx, this.input.dy, dragDist);
        } else {
          this.audio.playEmptyLaunch();
        }
      }

      this.input.dragging = false;
      this.input.originX = 0;
      this.input.originY = 0;
      this.input.dx = 0;
      this.input.dy = 0;
    };

    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
  }

  executeLaunch(dx, dy, dragDist) {
    if (this.phase === 'ready') {
      this.phase = 'playing';
    }

    const wasMidair = !this.spark.anchored;
    this.spark.anchored = false;
    this.spark.anchorKind = null;
    this.spark.currentLedgeId = null;

    // Deduct 1 glow
    this.jumpsLeft = Math.max(0, this.jumpsLeft - 1);
    this.launches++;

    // Launch speed calculation: pull down (dy > 0) launches up (vy > 0)
    const dragNorm = Math.min(
      (dragDist - CONSTANTS.DRAG_DEADZONE_PX) / (CONSTANTS.DRAG_MAX_PX - CONSTANTS.DRAG_DEADZONE_PX),
      1.0
    );
    const speed = CONSTANTS.MIN_LAUNCH_SPEED + (CONSTANTS.MAX_LAUNCH_SPEED - CONSTANTS.MIN_LAUNCH_SPEED) * dragNorm;
    const angle = Math.atan2(dy, -dx);

    this.spark.vx = Math.cos(angle) * speed;
    this.spark.vy = Math.sin(angle) * speed;

    // Visual squash / stretch
    this.spark.stretchX = 0.65;
    this.spark.stretchY = 1.45;

    // VFX & Audio
    this.vfx.spawnLaunchBlast(this.spark.x, this.spark.y, angle, dragNorm);
    this.audio.playLaunch(wasMidair, this.chainCount);

    if (wasMidair) {
      this.midairLaunches++;
      this.chainCount++;
      this.lastEvent = { kind: 'launch', tick: this.tick };
      this.lastEvent = { kind: 'chain', tick: this.tick };
      this.audio.playChainEscalation(this.chainCount);
    } else {
      this.lastEvent = { kind: 'launch', tick: this.tick };
    }
  }

  // --- Fixed 60Hz Deterministic Simulation Step ---
  updateSimulation(dt) {
    if (this.phase !== 'playing') return;

    this.tick++;
    this.elapsedMs = Math.round(this.tick * (1000 / CONSTANTS.TICK_RATE));

    // Update Difficulty based on max height climbed
    this.difficulty = +(Math.min(this.height / 2500, 2.5)).toFixed(3);

    // Update Rising Damp
    this.dampSpeed = +(CONSTANTS.BASE_DAMP_SPEED + this.difficulty * 24).toFixed(2);
    this.dampY += this.dampSpeed * dt;

    // Update Entities (moths drift, glimmers bob)
    this.world.updateEntities(this.tick);
    this.spawnIndex = this.world.nextLedgeId + this.world.nextItemId;

    // Check if Damp caught Spark
    if (this.spark.y - this.spark.playerRadius <= this.dampY) {
      this.phase = 'gameover';
      this.rank = getRank(this.score);
      this.audio.playGameOver();
      this.vfx.spawnDampDeath(this.spark.x, this.spark.y);
      return;
    }

    // 1. Update Spark Physics if not anchored
    if (!this.spark.anchored) {
      // Gravity
      this.spark.vy += CONSTANTS.GRAVITY * dt;
      this.spark.x += this.spark.vx * dt;
      this.spark.y += this.spark.vy * dt;

      // Air resistance (subtle)
      this.spark.vx *= Math.pow(0.98, dt * 60);

      // Trailing VFX
      const isPanic = this.jumpsLeft === 0 && this.spark.vy < -50;
      this.vfx.spawnTrail(this.spark.x, this.spark.y, this.spark.vx, this.spark.vy, isPanic);

      // Collision with Left & Right Walls (Wall Cling)
      const r = this.spark.playerRadius;
      if (this.spark.x <= CONSTANTS.WALL_LEFT_X + r) {
        this.spark.x = CONSTANTS.WALL_LEFT_X + r;
        this.spark.vx = 0;
        this.spark.vy = CONSTANTS.WALL_SLIP_SPEED;
        this.anchorSpark('wall');
      } else if (this.spark.x >= CONSTANTS.WALL_RIGHT_X - r) {
        this.spark.x = CONSTANTS.WALL_RIGHT_X - r;
        this.spark.vx = 0;
        this.spark.vy = CONSTANTS.WALL_SLIP_SPEED;
        this.anchorSpark('wall');
      }

      // Collision with Ledges (Landing)
      if (this.spark.vy <= 0) {
        const { ledges } = this.world.getEntitiesInSpan(this.spark.y);
        for (let i = 0; i < ledges.length; i++) {
          const ledge = ledges[i];
          if (!ledge.active) continue;

          const ly = ledge.position.y;
          const lx = ledge.position.x;
          const hw = ledge.halfWidth;

          // Check if spark's bottom crosses the top face of the ledge
          const prevSparkY = this.spark.y - this.spark.vy * dt;
          if (
            this.spark.y - r <= ly + 4 &&
            prevSparkY - r >= ly - 6 &&
            this.spark.x >= lx - hw - 4 &&
            this.spark.x <= lx + hw + 4
          ) {
            this.spark.y = ly + r;
            this.spark.vx = 0;
            this.spark.vy = 0;
            this.spark.currentLedgeId = ledge.id;
            this.anchorSpark('ledge');
            break;
          }
        }
      }

      // Check collision with Items (Glimmers & Moths)
      const { items } = this.world.getEntitiesInSpan(this.spark.y);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.active) continue;

        const dist = Math.hypot(this.spark.x - item.position.x, this.spark.y - item.position.y);
        if (dist <= this.spark.playerRadius + item.collisionRadius) {
          // Deactivate item
          const realItem = this.world.items.find(it => it.id === item.id);
          if (realItem) realItem.active = false;
          item.active = false;

          if (item.type === 'moth') {
            // Moth Burst: Kick upward, refund 1 glow, extend chain
            this.spark.vy = Math.max(this.spark.vy + 420, CONSTANTS.MOTH_BOUNCE_VY);
            // Slight horizontal kick toward center
            this.spark.vx += (0 - this.spark.x) * 0.4;
            this.jumpsLeft = Math.min(this.jumpCapacity, this.jumpsLeft + 1);
            this.refunds++;
            this.chainCount++;

            this.spark.stretchX = 0.7;
            this.spark.stretchY = 1.4;

            this.vfx.spawnMothBurst(item.position.x, item.position.y, this.chainCount);
            this.audio.playMothBurst(this.chainCount);

            this.lastEvent = { kind: 'bounce', tick: this.tick };
            this.lastEvent = { kind: 'chain', tick: this.tick };
            this.audio.playChainEscalation(this.chainCount);
            this.vfx.addFloatingText(`BURST!`, item.position.x, item.position.y + 15, '#ffca28', 1.1);
          } else if (item.type === 'glimmer') {
            // Glimmer Collection: Score bonus with chain multiplier
            this.glimmersCollected++;
            const chainMultiplier = 1.0 + this.chainCount * 0.5;
            const glimmerPts = Math.round(150 * chainMultiplier);
            this.score += glimmerPts;

            this.vfx.spawnGlimmerPickup(item.position.x, item.position.y, this.chainCount);
            this.audio.playGlimmer(this.chainCount);

            this.lastEvent = { kind: 'glimmer', tick: this.tick };
            this.vfx.addFloatingText(`+${glimmerPts}`, item.position.x, item.position.y + 15, '#4dd0e1', 1.2);
          }
        }
      }
    } else {
      // Anchored state updates
      if (this.spark.anchorKind === 'wall') {
        // Slide down slick wall
        this.spark.vy = CONSTANTS.WALL_SLIP_SPEED;
        this.spark.y += this.spark.vy * dt;
        if (Math.random() < 0.25) {
          this.vfx.spawnTrail(this.spark.x, this.spark.y, 0, -20, true);
        }
      }
    }

    // Height & Score Tracking
    if (this.spark.y > this.height) {
      const heightGain = this.spark.y - this.height;
      this.height = this.spark.y;
      this.score += heightGain;
    }

    if (this.score > this.sessionBest) {
      this.sessionBest = Math.floor(this.score);
    }
  }

  anchorSpark(kind) {
    this.spark.anchored = true;
    this.spark.anchorKind = kind;
    this.spark.stretchX = 1.35;
    this.spark.stretchY = 0.65;

    // Refill jumps completely
    this.jumpsLeft = this.jumpCapacity;
    this.landings++;

    const isWall = kind === 'wall';
    this.vfx.spawnLandPuff(this.spark.x, this.spark.y, isWall);
    this.audio.playLand(isWall);

    const bankedChain = this.chainCount;
    if (bankedChain > 0) {
      if (bankedChain > this.chainBest) {
        this.chainBest = bankedChain;
      }
      const chainScore = getChainScore(bankedChain);
      this.score += chainScore;
      this.vfx.addFloatingText(`BANK +${chainScore}!`, this.spark.x, this.spark.y + 20, '#ff9800', 1.3);
      this.audio.playChainBank(bankedChain);
      this.chainCount = 0;

      this.lastEvent = { kind: 'land', tick: this.tick };
      this.lastEvent = { kind: 'chainBank', tick: this.tick };
    } else {
      this.lastEvent = { kind: 'land', tick: this.tick };
    }
  }

  // --- Main Animation Loop ---
  start() {
    this.lastTime = performance.now();
    const frame = (now) => {
      const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      // Handle Slow-Mo when aiming during flight
      const isSlowMo = this.input.dragging && !this.spark.anchored && this.jumpsLeft > 0 && this.phase === 'playing';
      const effectiveDt = isSlowMo ? deltaSec * CONSTANTS.SLOW_MO_SCALE : deltaSec;

      this.accumulator += effectiveDt;
      const simDt = CONSTANTS.DT;

      while (this.accumulator >= simDt) {
        this.updateSimulation(simDt);
        this.accumulator -= simDt;
      }

      // Update view-only VFX
      this.vfx.update(deltaSec, this.renderer.cameraY);

      // Render Scene
      this.renderer.render(this, deltaSec);

      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // --- Platform Snapshot Interface ---
  snapshot() {
    const { ledges, items } = this.world.getEntitiesInSpan(this.spark.y);

    return {
      // Run state
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      seed: this.seed,
      rngState: this.rng.getState(),
      spawnIndex: this.spawnIndex,
      input: {
        dragging: this.input.dragging,
        originX: this.input.originX,
        originY: this.input.originY,
        dx: this.input.dx,
        dy: this.input.dy
      },
      difficulty: +(this.difficulty.toFixed(3)),
      score: +(this.score.toFixed(2)),
      height: +(this.height.toFixed(2)),
      sessionBest: +(this.sessionBest.toFixed(2)),
      rank: this.phase === 'gameover' ? getRank(this.score) : null,

      // Player
      x: +(this.spark.x.toFixed(2)),
      y: +(this.spark.y.toFixed(2)),
      vx: +(this.spark.vx.toFixed(2)),
      vy: +(this.spark.vy.toFixed(2)),
      playerRadius: this.spark.playerRadius,
      anchored: this.spark.anchored,
      anchorKind: this.spark.anchorKind,

      // Glow economy
      jumpCapacity: this.jumpCapacity,
      jumpsLeft: this.jumpsLeft,
      launches: this.launches,
      midairLaunches: this.midairLaunches,
      landings: this.landings,
      refunds: this.refunds,
      glimmersCollected: this.glimmersCollected,

      // Chain
      chainCount: this.chainCount,
      chainBest: this.chainBest,

      // World
      dampY: +(this.dampY.toFixed(2)),
      dampSpeed: +(this.dampSpeed.toFixed(2)),
      wallLeftX: CONSTANTS.WALL_LEFT_X,
      wallRightX: CONSTANTS.WALL_RIGHT_X,
      launchReach: +(CONSTANTS.LAUNCH_REACH.toFixed(2)),

      // Entities
      ledges: ledges.map(l => ({
        id: l.id,
        position: { x: +(l.position.x.toFixed(2)), y: +(l.position.y.toFixed(2)) },
        halfWidth: +(l.halfWidth.toFixed(2)),
        active: l.active
      })),

      items: items.map(it => ({
        id: it.id,
        type: it.type,
        position: { x: +(it.position.x.toFixed(2)), y: +(it.position.y.toFixed(2)) },
        active: it.active,
        visualRadius: it.visualRadius,
        collisionRadius: it.collisionRadius
      })),

      // Events
      lastEvent: this.lastEvent ? { kind: this.lastEvent.kind, tick: this.lastEvent.tick } : null
    };
  }
}
