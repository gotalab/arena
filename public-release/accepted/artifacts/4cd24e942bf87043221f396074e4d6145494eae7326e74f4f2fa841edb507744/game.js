/**
 * EMBER - Production Game & Arena Runtime
 * A one-finger vertical climbing arcade game.
 */

(function () {
  'use strict';

  // --- Mulberry32 Seeded Deterministic PRNG ---
  class PRNG {
    constructor(seed = 123456789) {
      this.initialSeed = typeof seed === 'number' ? seed : this._hashString(String(seed));
      this.state = this.initialSeed >>> 0;
    }

    _hashString(str) {
      let hash = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
        hash = (hash << 13) | (hash >>> 19);
      }
      return hash >>> 0;
    }

    // Returns float in [0, 1)
    random() {
      let t = (this.state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Returns integer in [min, max]
    randInt(min, max) {
      return Math.floor(this.random() * (max - min + 1)) + min;
    }

    // Returns float in [min, max]
    randFloat(min, max) {
      return min + this.random() * (max - min);
    }
  }

  // --- Web Audio Procedural Synthesizer ---
  class SoundFX {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.masterGain = null;
      this.dampGain = null;
      this.dampOsc = null;
      this.initialized = false;
      // Musical pentatonic scale frequencies for chain crescendo
      this.scaleNotes = [
        261.63, // C4
        293.66, // D4
        329.63, // E4
        392.00, // G4
        440.00, // A4
        523.25, // C5
        587.33, // D5
        659.25, // E5
        783.99, // G5
        880.00, // A5
        1046.50 // C6
      ];
    }

    init() {
      if (this.initialized) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
        this.initialized = true;
      } catch (e) {
        console.warn('Web Audio initialization error:', e);
      }
    }

    resume() {
      if (!this.initialized) this.init();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.4, this.ctx.currentTime);
      }
      return !this.muted;
    }

    getNoteFreq(index) {
      const idx = Math.min(index, this.scaleNotes.length - 1);
      return this.scaleNotes[idx];
    }

    // Slingshot release launch sound
    playLaunch(isMidair, chainCount) {
      if (this.muted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;

      // Punchy swoosh
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = isMidair ? 'triangle' : 'sine';
      
      const baseFreq = isMidair ? this.getNoteFreq(chainCount + 1) : 180;
      osc.frequency.setValueAtTime(baseFreq * 0.8, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, t + 0.12);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);

      // Noise puff
      this._playNoise(0.08, 600, 1800, 0.2);
    }

    // Landing on ledge or wall
    playLand(isWall) {
      if (this.muted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isWall ? 220 : 160, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.13);

      // Soft stone thud
      this._playNoise(0.06, 200, 600, 0.15);
    }

    // Moth burst sound - bright ascending pop
    playMothBurst(chainCount) {
      if (this.muted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const freq = this.getNoteFreq(chainCount + 2);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq * 0.9, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.18);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.23);

      // Harmonic bell overtone
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.0, t);
      osc2.frequency.exponentialRampToValueAtTime(freq * 2.5, t + 0.2);
      gain2.gain.setValueAtTime(0.2, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc2.connect(gain2);
      gain2.connect(this.masterGain);
      osc2.start(t);
      osc2.stop(t + 0.22);

      this._playNoise(0.05, 1200, 3500, 0.18);
    }

    // Glimmer collection sound
    playGlimmer(chainCount) {
      if (this.muted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;
      const base = this.getNoteFreq(chainCount + 3);

      // Celestial chime chord
      [base, base * 1.2599, base * 1.4983].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + i * 0.02);
        osc.frequency.exponentialRampToValueAtTime(f * 1.05, t + i * 0.02 + 0.35);

        gain.gain.setValueAtTime(0.2, t + i * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.02 + 0.38);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + i * 0.02);
        osc.stop(t + i * 0.02 + 0.4);
      });
    }

    // Banked chain celebration
    playChainBank(chainCount) {
      if (this.muted || !this.ctx || chainCount <= 0) return;
      this.resume();
      const t = this.ctx.currentTime;
      const numNotes = Math.min(chainCount + 2, 6);

      for (let i = 0; i < numNotes; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const noteTime = t + i * 0.06;
        const freq = this.getNoteFreq(i + 2);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.25, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.3);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(noteTime);
        osc.stop(noteTime + 0.32);
      }
    }

    // Extinguished in damp / game over
    playGameOver() {
      if (this.muted || !this.ctx) return;
      this.resume();
      const t = this.ctx.currentTime;

      // Sizzle out
      this._playNoise(0.5, 400, 150, 0.35);

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(35, t + 0.7);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.75);
    }

    _playNoise(duration, filterFreqStart, filterFreqEnd, vol) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(filterFreqStart, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(filterFreqEnd, 20), t + duration);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      noise.start(t);
      noise.stop(t + duration);
    }
  }

  // --- Visual Particle & Floating Text System ---
  class FXSystem {
    constructor() {
      this.particles = [];
      this.texts = [];
      this.shockwaves = [];
      this.screenShake = 0;
    }

    reset() {
      this.particles = [];
      this.texts = [];
      this.shockwaves = [];
      this.screenShake = 0;
    }

    addShake(amount) {
      this.screenShake = Math.min(this.screenShake + amount, 16);
    }

    emitSparks(x, y, count, color, speed = 180, life = 0.6) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = speed * (0.3 + Math.random() * 0.7);
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          life: 0,
          maxLife: life * (0.6 + Math.random() * 0.8),
          size: 2.5 + Math.random() * 3.5,
          color,
          type: 'spark'
        });
      }
    }

    emitSoot(x, y, count) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 80;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd + 15,
          life: 0,
          maxLife: 0.8 + Math.random() * 0.6,
          size: 4 + Math.random() * 5,
          color: 'rgba(30, 25, 35, ',
          type: 'soot'
        });
      }
    }

    emitShockwave(x, y, maxRadius, color = '#ff9944') {
      this.shockwaves.push({
        x,
        y,
        radius: 4,
        maxRadius,
        life: 0,
        maxLife: 0.35,
        color
      });
    }

    addFloatingText(x, y, text, color = '#ffd27d', size = 16) {
      this.texts.push({
        x,
        y,
        text,
        color,
        size,
        life: 0,
        maxLife: 0.9
      });
    }

    update(dt) {
      this.screenShake = Math.max(0, this.screenShake - dt * 28);

      // Update particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.type === 'spark') {
          p.vy -= 160 * dt; // gravity
          p.vx *= 0.96;
        } else if (p.type === 'soot') {
          p.vy += 20 * dt; // gentle float
          p.vx *= 0.94;
        }
      }

      // Update shockwaves
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.life += dt;
        if (sw.life >= sw.maxLife) {
          this.shockwaves.splice(i, 1);
          continue;
        }
        const progress = sw.life / sw.maxLife;
        sw.radius = 4 + (sw.maxRadius - 4) * Math.sin(progress * Math.PI * 0.5);
      }

      // Update floating texts
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const ft = this.texts[i];
        ft.life += dt;
        if (ft.life >= ft.maxLife) {
          this.texts.splice(i, 1);
          continue;
        }
        ft.y += 45 * dt;
      }
    }
  }

  // --- Main Simulation & Game Class ---
  class EmberGame {
    constructor() {
      // Configuration Constants
      this.WALL_LEFT = -170;
      this.WALL_RIGHT = 170;
      this.GRAVITY = -950;
      this.MAX_LAUNCH_SPEED = 620;
      this.PLAYER_RADIUS = 14;
      this.JUMP_CAPACITY = 3;
      this.LAUNCH_REACH = (this.MAX_LAUNCH_SPEED * this.MAX_LAUNCH_SPEED) / (2 * Math.abs(this.GRAVITY)); // ~202.32
      this.MAX_DRAG_PIXELS = 130;
      this.DEAD_ZONE_PIXELS = 14;
      this.DAMP_BASE_SPEED = 38;

      // Systems
      this.sound = new SoundFX();
      this.fx = new FXSystem();

      // State containers
      this.sessionBest = 0;
      this.seed = 12345;
      this.prng = new PRNG(this.seed);

      // Simulation State
      this.phase = 'ready'; // 'ready' | 'playing' | 'gameover'
      this.tick = 0;
      this.elapsedMs = 0;
      this.spawnIndex = 0;
      this.highestGeneratedY = 0;
      this.lastSafeLedge = null;
      this.difficulty = 1.0;
      this.score = 0;
      this.height = 0;
      this.rank = null;

      // Player State
      this.player = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        playerRadius: this.PLAYER_RADIUS,
        anchored: true,
        anchorKind: 'ledge', // 'ledge' | 'wall' | null
        anchorLedgeId: 0,
        jumpsLeft: this.JUMP_CAPACITY,
        jumpCapacity: this.JUMP_CAPACITY,
        squishScaleX: 1,
        squishScaleY: 1,
        blinkTimer: 2.0,
        blink: 0,
        flameRotation: 0
      };

      // Glow & Economy Stats
      this.stats = {
        launches: 0,
        midairLaunches: 0,
        landings: 0,
        refunds: 0,
        glimmersCollected: 0
      };

      // Chain
      this.chainCount = 0;
      this.chainBest = 0;

      // World
      this.dampY = -140;
      this.dampSpeed = this.DAMP_BASE_SPEED;

      // Entities
      this.ledges = [];
      this.items = []; // { id, type: 'glimmer'|'moth', position: {x, y}, basePos: {x, y}, active, visualRadius, collisionRadius, seedOffset }

      // Events
      this.lastEvent = null; // { kind, tick }

      // Input State (Screen pointer coordinates)
      this.input = {
        dragging: false,
        originX: 0,
        originY: 0,
        currentX: 0,
        currentY: 0,
        dx: 0,
        dy: 0,
        pointerId: null
      };

      // Camera
      this.cameraY = 60;
      this.targetCameraY = 60;
      this.cameraFollowSpeed = 6.0;

      // DOM & Canvas
      this.canvas = document.getElementById('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.container = document.getElementById('game-container');
      this.uiHeight = document.getElementById('ui-height');
      this.uiScore = document.getElementById('ui-score');
      this.uiChainBadge = document.getElementById('ui-chain-badge');
      this.uiChainText = document.getElementById('ui-chain-text');
      this.soundBtn = document.getElementById('sound-toggle');

      this.viewportWidth = 360;
      this.viewportHeight = 640;
      this.scale = 1;

      // Setup
      this.setupDOM();
      this.reset(Date.now() & 0x7fffffff);
      this.startLoop();
    }

    setupDOM() {
      // Resize handling
      window.addEventListener('resize', () => this.handleResize());
      this.handleResize();

      // Sound button
      if (this.soundBtn) {
        this.soundBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const unmuted = this.sound.toggleMute();
          this.soundBtn.textContent = unmuted ? '🔊' : '🔇';
        });
      }

      // Pointer Events for single finger/mouse control
      const target = this.canvas;
      target.addEventListener('pointerdown', (e) => this.onPointerDown(e), { passive: false });
      window.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: false });
      window.addEventListener('pointerup', (e) => this.onPointerUp(e), { passive: false });
      window.addEventListener('pointercancel', (e) => this.onPointerCancel(e), { passive: false });

      // Prevent gestures
      target.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    handleResize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.viewportWidth = rect.width;
      this.viewportHeight = rect.height;
      this.scale = rect.width / 380; // 380 world units across flue with padding
    }

    // --- Deterministic Reset ---
    reset(seed) {
      this.seed = typeof seed === 'number' ? seed : (seed ? this.prng._hashString(String(seed)) : 12345);
      this.prng = new PRNG(this.seed);

      this.phase = 'ready';
      this.tick = 0;
      this.elapsedMs = 0;
      this.spawnIndex = 0;
      this.highestGeneratedY = 0;
      this.difficulty = 1.0;
      this.score = 0;
      this.height = 0;
      this.rank = null;

      this.player.x = 0;
      this.player.y = this.PLAYER_RADIUS;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.anchored = true;
      this.player.anchorKind = 'ledge';
      this.player.anchorLedgeId = 1;
      this.player.jumpsLeft = this.JUMP_CAPACITY;
      this.player.squishScaleX = 1;
      this.player.squishScaleY = 1;

      this.stats = {
        launches: 0,
        midairLaunches: 0,
        landings: 0,
        refunds: 0,
        glimmersCollected: 0
      };

      this.chainCount = 0;
      this.chainBest = 0;

      this.dampY = -140;
      this.dampSpeed = this.DAMP_BASE_SPEED;

      this.ledges = [];
      this.items = [];
      this.lastEvent = null;

      this.input.dragging = false;
      this.input.dx = 0;
      this.input.dy = 0;
      this.input.pointerId = null;

      this.cameraY = 80;
      this.targetCameraY = 80;

      this.fx.reset();

      // Spawn initial world
      this.generateInitialWorld();
      this.updateUI();
    }

    generateInitialWorld() {
      // Starting platform ledge at (0, 0)
      this.spawnIndex++;
      const startLedge = {
        id: this.spawnIndex,
        position: { x: 0, y: 0 },
        halfWidth: 65,
        active: true
      };
      this.ledges.push(startLedge);
      this.lastSafeLedge = startLedge;
      this.highestGeneratedY = 0;

      // Generate ahead
      this.ensureWorldGeneratedUpTo(this.LAUNCH_REACH * 6);
    }

    ensureWorldGeneratedUpTo(targetY) {
      while (this.highestGeneratedY < targetY) {
        // Compute reach and spacing with safe road guarantee
        const maxVerticalReach = this.LAUNCH_REACH * 0.78; // comfortable jump
        const minSpacing = 75;
        const spacing = this.prng.randFloat(minSpacing, maxVerticalReach);
        const nextY = this.lastSafeLedge.position.y + spacing;

        // Choose x position reachable from previous safe ledge
        const prevX = this.lastSafeLedge.position.x;
        const maxHorizontalShift = 100;
        let nextX = prevX + this.prng.randFloat(-maxHorizontalShift, maxHorizontalShift);
        nextX = Math.max(this.WALL_LEFT + 45, Math.min(this.WALL_RIGHT - 45, nextX));

        // Create the safe ledge
        this.spawnIndex++;
        const halfWidth = Math.max(22, 45 - (nextY / 2500) * 15);
        const safeLedge = {
          id: this.spawnIndex,
          position: { x: Math.round(nextX), y: Math.round(nextY) },
          halfWidth: Math.round(halfWidth),
          active: true
        };
        this.ledges.push(safeLedge);
        this.lastSafeLedge = safeLedge;

        // Optionally spawn a side ledge for branching route
        if (this.prng.random() < 0.55) {
          this.spawnIndex++;
          const sideX = (nextX > 0) ? this.prng.randFloat(this.WALL_LEFT + 40, -20) : this.prng.randFloat(20, this.WALL_RIGHT - 40);
          const sideY = nextY + this.prng.randFloat(-30, 30);
          this.ledges.push({
            id: this.spawnIndex,
            position: { x: Math.round(sideX), y: Math.round(sideY) },
            halfWidth: Math.round(halfWidth * 0.85),
            active: true
          });
        }

        // Spawn items (Glimmers and Soot-moths)
        // Moth placement: staircase in the open space between perches
        if (this.prng.random() < 0.65) {
          this.spawnIndex++;
          const mothX = this.prng.randFloat(this.WALL_LEFT + 40, this.WALL_RIGHT - 40);
          const mothY = nextY - spacing * 0.45 + this.prng.randFloat(-15, 15);
          this.items.push({
            id: this.spawnIndex,
            type: 'moth',
            position: { x: Math.round(mothX), y: Math.round(mothY) },
            basePos: { x: Math.round(mothX), y: Math.round(mothY) },
            active: true,
            visualRadius: 13,
            collisionRadius: 13,
            seedOffset: this.prng.random() * 10
          });
        }

        // Glimmer placement: tempt off the safe road
        if (this.prng.random() < 0.60) {
          this.spawnIndex++;
          // Place high in open center
          const glimX = this.prng.randFloat(this.WALL_LEFT + 30, this.WALL_RIGHT - 30);
          const glimY = nextY + this.prng.randFloat(15, 45);
          this.items.push({
            id: this.spawnIndex,
            type: 'glimmer',
            position: { x: Math.round(glimX), y: Math.round(glimY) },
            basePos: { x: Math.round(glimX), y: Math.round(glimY) },
            active: true,
            visualRadius: 11,
            collisionRadius: 11,
            seedOffset: this.prng.random() * 10
          });
        }

        this.highestGeneratedY = nextY;
      }
    }

    // --- Input Handling ---
    onPointerDown(e) {
      e.preventDefault();
      this.sound.resume();

      if (this.phase === 'gameover') {
        // Simple tap on end screen restarts
        this.reset(this.seed);
        return;
      }

      this.input.pointerId = e.pointerId;
      this.input.originX = e.clientX;
      this.input.originY = e.clientY;
      this.input.currentX = e.clientX;
      this.input.currentY = e.clientY;
      this.input.dx = 0;
      this.input.dy = 0;
      this.input.dragging = true;
    }

    onPointerMove(e) {
      if (!this.input.dragging || e.pointerId !== this.input.pointerId) return;
      e.preventDefault();
      this.input.currentX = e.clientX;
      this.input.currentY = e.clientY;
      this.input.dx = e.clientX - this.input.originX;
      this.input.dy = e.clientY - this.input.originY;
    }

    onPointerUp(e) {
      if (!this.input.dragging || (this.input.pointerId !== null && e.pointerId !== this.input.pointerId)) return;
      e.preventDefault();

      const dx = this.input.dx;
      const dy = this.input.dy;
      const dist = Math.hypot(dx, dy);

      this.input.dragging = false;
      this.input.pointerId = null;
      this.input.dx = 0;
      this.input.dy = 0;

      // Check dead zone
      if (dist >= this.DEAD_ZONE_PIXELS) {
        this.executeLaunch(dx, dy, dist);
      }
    }

    onPointerCancel(e) {
      this.input.dragging = false;
      this.input.pointerId = null;
      this.input.dx = 0;
      this.input.dy = 0;
    }

    executeLaunch(dx, dy, dist) {
      if (this.phase === 'gameover') return;

      // If ready, first launch starts the game
      if (this.phase === 'ready') {
        this.phase = 'playing';
      }

      if (this.player.jumpsLeft <= 0) {
        // Empty stock - can't launch
        return;
      }

      // Compute launch power & vector (opposite to drag)
      const clampedDist = Math.min(dist, this.MAX_DRAG_PIXELS);
      const powerRatio = clampedDist / this.MAX_DRAG_PIXELS;
      const speed = powerRatio * this.MAX_LAUNCH_SPEED;

      // In screen coords, dy > 0 is pulling down -> launch up (+vy)
      const angle = Math.atan2(-dy, -dx);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;

      const wasMidair = !this.player.anchored;

      // Spend glow
      this.player.jumpsLeft--;
      this.stats.launches++;
      this.player.anchored = false;
      this.player.anchorKind = null;
      this.player.vx = vx;
      this.player.vy = vy;

      // Squash and stretch along flight angle
      this.player.squishScaleX = 0.65;
      this.player.squishScaleY = 1.45;
      this.player.flameRotation = angle - Math.PI / 2;

      // Event & Chain bookkeeping
      if (wasMidair) {
        this.stats.midairLaunches++;
        this.chainCount++;
        this.lastEvent = { kind: 'chain', tick: this.tick };
        this.sound.playLaunch(true, this.chainCount);
        this.fx.addFloatingText(this.player.x, this.player.y + 20, `CHAIN x${this.chainCount}!`, '#ffb347', 15);
        this.fx.emitSparks(this.player.x, this.player.y, 14, '#ff9933', 220);
        this.fx.addShake(3.5);
      } else {
        this.lastEvent = { kind: 'launch', tick: this.tick };
        this.sound.playLaunch(false, 0);
        this.fx.emitSparks(this.player.x, this.player.y, 10, '#ffaa44', 180);
        this.fx.addShake(2.0);
      }
    }

    // --- Fixed Step Physics & Simulation (60Hz) ---
    step(dt) {
      if (this.phase !== 'playing') return;

      this.tick++;
      this.elapsedMs = Math.round(this.tick * (1000 / 60));
      this.difficulty = 1.0 + (this.height / 1200) * 0.6;

      // 1. Update Damp (Rising Menace)
      this.dampSpeed = this.DAMP_BASE_SPEED + (this.height * 0.016);
      this.dampY += this.dampSpeed * dt;

      // Check if damp swallows spark
      if (this.player.y - this.PLAYER_RADIUS <= this.dampY) {
        this.triggerGameOver();
        return;
      }

      // 2. Update Moth Oscillations
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        if (item.type === 'moth' && item.active) {
          const t = this.tick * 0.05 + item.seedOffset;
          item.position.x = item.basePos.x + Math.sin(t * 1.2) * 16;
          item.position.y = item.basePos.y + Math.cos(t * 1.8) * 10;
        }
      }

      // 3. Update Spark State
      if (this.player.anchored) {
        if (this.player.anchorKind === 'wall') {
          // Slide down soot wall
          const slideSpeed = 44;
          this.player.y -= slideSpeed * dt;
          this.player.vy = -slideSpeed;
          this.player.vx = 0;

          // Wall slide soot particles
          if (this.tick % 4 === 0) {
            this.fx.emitSoot(this.player.x, this.player.y, 2);
          }

          // Check if damp overtook while sliding
          if (this.player.y - this.PLAYER_RADIUS <= this.dampY) {
            this.triggerGameOver();
            return;
          }
        } else {
          // Resting on ledge
          this.player.vx = 0;
          this.player.vy = 0;
        }
      } else {
        // In flight
        const prevX = this.player.x;
        const prevY = this.player.y;

        // Apply Gravity
        this.player.vy += this.GRAVITY * dt;
        this.player.x += this.player.vx * dt;
        this.player.y += this.player.vy * dt;

        // Air drag
        this.player.vx *= Math.pow(0.985, dt * 60);

        // Flight rotation
        const speed = Math.hypot(this.player.vx, this.player.vy);
        if (speed > 40) {
          this.player.flameRotation = Math.atan2(this.player.vy, this.player.vx) - Math.PI / 2;
        }

        // --- Collision Check: Walls ---
        if (this.player.x - this.PLAYER_RADIUS <= this.WALL_LEFT) {
          this.player.x = this.WALL_LEFT + this.PLAYER_RADIUS;
          this.handleLanding('wall');
        } else if (this.player.x + this.PLAYER_RADIUS >= this.WALL_RIGHT) {
          this.player.x = this.WALL_RIGHT - this.PLAYER_RADIUS;
          this.handleLanding('wall');
        }

        // --- Collision Check: Ledges ---
        // Only land when falling downwards
        if (!this.player.anchored && this.player.vy <= 0) {
          for (let i = 0; i < this.ledges.length; i++) {
            const ledge = this.ledges[i];
            if (!ledge.active) continue;

            const ledgeTop = ledge.position.y;
            // Check if spark crossed the top surface
            if (prevY >= ledgeTop + this.PLAYER_RADIUS - 3 &&
                this.player.y <= ledgeTop + this.PLAYER_RADIUS + 5 &&
                Math.abs(this.player.x - ledge.position.x) <= ledge.halfWidth + this.PLAYER_RADIUS * 0.45) {
              
              this.player.y = ledgeTop + this.PLAYER_RADIUS;
              this.player.anchorLedgeId = ledge.id;
              this.handleLanding('ledge');
              break;
            }
          }
        }

        // --- Collision Check: Items (Moths & Glimmers) ---
        for (let i = 0; i < this.items.length; i++) {
          const item = this.items[i];
          if (!item.active) continue;

          const dist = Math.hypot(this.player.x - item.position.x, this.player.y - item.position.y);
          if (dist <= this.PLAYER_RADIUS + item.collisionRadius) {
            if (item.type === 'moth') {
              this.handleMothBurst(item);
            } else if (item.type === 'glimmer') {
              this.handleGlimmerCollect(item);
            }
          }
        }
      }

      // 4. Update Height & Score
      if (this.player.y > this.height) {
        const diff = this.player.y - this.height;
        this.height = this.player.y;
        this.score += Math.round(diff * 1.2);
      }

      // 5. Expand World Generation Ahead
      this.ensureWorldGeneratedUpTo(this.player.y + this.LAUNCH_REACH * 5);
    }

    handleLanding(kind) {
      this.player.anchored = true;
      this.player.anchorKind = kind;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.squishScaleX = 1.4;
      this.player.squishScaleY = 0.7;

      // Refill glow stock completely
      this.player.jumpsLeft = this.JUMP_CAPACITY;
      this.stats.landings++;

      this.sound.playLand(kind === 'wall');
      this.fx.emitSparks(this.player.x, this.player.y, 8, '#ffc266', 140);
      this.fx.addShake(kind === 'wall' ? 1.5 : 2.5);

      if (this.chainCount > 0) {
        // Bank the chain!
        const banked = this.chainCount;
        if (banked > this.chainBest) {
          this.chainBest = banked;
        }

        // Chain bonus score
        const chainBonus = banked * (banked + 1) * 60;
        this.score += chainBonus;

        this.lastEvent = { kind: 'chainBank', tick: this.tick };
        this.sound.playChainBank(banked);
        this.fx.addFloatingText(this.player.x, this.player.y + 25, `BANKED +${chainBonus}!`, '#ffd700', 18);
        this.fx.emitShockwave(this.player.x, this.player.y, 45, '#ffd700');
        this.chainCount = 0;
      } else {
        this.lastEvent = { kind: 'land', tick: this.tick };
      }
    }

    handleMothBurst(moth) {
      moth.active = false;
      this.stats.refunds++;

      // Refund 1 glow up to capacity
      this.player.jumpsLeft = Math.min(this.JUMP_CAPACITY, this.player.jumpsLeft + 1);

      // Upward kick
      this.player.vy = Math.max(this.player.vy + 390, 490);
      this.player.anchored = false;
      this.player.anchorKind = null;

      // Increment chain
      this.chainCount++;
      this.lastEvent = { kind: 'chain', tick: this.tick };

      this.sound.playMothBurst(this.chainCount);
      this.fx.emitShockwave(moth.position.x, moth.position.y, 35, '#ff8833');
      this.fx.emitSoot(moth.position.x, moth.position.y, 10);
      this.fx.emitSparks(moth.position.x, moth.position.y, 16, '#ffcc55', 240);
      this.fx.addFloatingText(moth.position.x, moth.position.y + 15, `+1 GLOW (x${this.chainCount})`, '#ffdd66', 15);
      this.fx.addShake(3.0);
    }

    handleGlimmerCollect(glimmer) {
      glimmer.active = false;
      this.stats.glimmersCollected++;

      // Bonus scales with chain count
      const bonus = Math.round(300 * (1 + this.chainCount * 0.5));
      this.score += bonus;
      this.lastEvent = { kind: 'glimmer', tick: this.tick };

      this.sound.playGlimmer(this.chainCount);
      this.fx.emitShockwave(glimmer.position.x, glimmer.position.y, 30, '#00ffff');
      this.fx.emitSparks(glimmer.position.x, glimmer.position.y, 18, '#66ffff', 220);
      this.fx.addFloatingText(glimmer.position.x, glimmer.position.y + 15, `+${bonus}`, '#80ffff', 16);
      this.fx.addShake(1.8);
    }

    triggerGameOver() {
      this.phase = 'gameover';
      this.player.anchored = false;
      this.player.anchorKind = null;
      this.player.vx = 0;
      this.player.vy = 0;

      // Monotonic rank grading derived from final score
      this.rank = this.computeRank(this.score);

      if (this.score > this.sessionBest) {
        this.sessionBest = this.score;
      }

      this.sound.playGameOver();
      this.fx.emitSoot(this.player.x, this.player.y, 25);
      this.fx.emitSparks(this.player.x, this.player.y, 20, '#4488ff', 160);
      this.fx.addShake(8.0);
    }

    computeRank(score) {
      if (score >= 9000) return 'S+ Inferno Master';
      if (score >= 6000) return 'S Blaze Walker';
      if (score >= 3500) return 'A Flare Seeker';
      if (score >= 1800) return 'B Bright Flame';
      if (score >= 700) return 'C Rising Spark';
      return 'D Faint Ember';
    }

    // --- Animation & Rendering Loop ---
    startLoop() {
      let lastTime = performance.now();
      const fixedDt = 1 / 60;
      let accumulator = 0;

      const frame = (time) => {
        let delta = (time - lastTime) / 1000;
        if (delta > 0.1) delta = 0.1; // clamp long frame spikes
        lastTime = time;

        // Slow motion bullet-time while dragging during flight
        let timeScale = 1.0;
        if (this.input.dragging && this.phase === 'playing') {
          timeScale = 0.30;
        }

        accumulator += delta * timeScale;
        while (accumulator >= fixedDt) {
          this.step(fixedDt);
          accumulator -= fixedDt;
        }

        // Update visual effects with real time delta
        this.fx.update(delta);
        this.updateVisualState(delta);

        // Smooth camera follow
        this.targetCameraY = Math.max(80, this.player.y + 70);
        this.cameraY += (this.targetCameraY - this.cameraY) * Math.min(1.0, delta * this.cameraFollowSpeed);

        this.render();
        this.updateUI();

        requestAnimationFrame(frame);
      };

      requestAnimationFrame(frame);
    }

    updateVisualState(dt) {
      // Squash & stretch recovery
      this.player.squishScaleX += (1 - this.player.squishScaleX) * Math.min(1, dt * 12);
      this.player.squishScaleY += (1 - this.player.squishScaleY) * Math.min(1, dt * 12);

      // Blinking timer
      this.player.blinkTimer -= dt;
      if (this.player.blinkTimer <= 0) {
        this.player.blink = 1;
        if (this.player.blinkTimer <= -0.15) {
          this.player.blink = 0;
          this.player.blinkTimer = 2.5 + Math.random() * 3.0;
        }
      }
    }

    updateUI() {
      if (this.uiHeight) {
        this.uiHeight.textContent = `${Math.max(0, Math.floor(this.height / 10))}m`;
      }
      if (this.uiScore) {
        this.uiScore.textContent = `${this.score}`;
      }
      if (this.uiChainBadge) {
        if (this.chainCount > 1) {
          this.uiChainBadge.style.display = 'block';
          this.uiChainText.textContent = `CHAIN x${this.chainCount}!`;
        } else {
          this.uiChainBadge.style.display = 'none';
        }
      }
    }

    // --- Render Pipeline ---
    render() {
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      const w = this.viewportWidth;
      const h = this.viewportHeight;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Clear & Background
      ctx.fillStyle = '#07070d';
      ctx.fillRect(0, 0, w, h);

      // Screen Shake
      if (this.fx.screenShake > 0) {
        const shakeX = (Math.random() * 2 - 1) * this.fx.screenShake;
        const shakeY = (Math.random() * 2 - 1) * this.fx.screenShake;
        ctx.translate(shakeX, shakeY);
      }

      // World Transform Setup
      // Center world X=0 at w / 2, world Y transforms to screen Y
      const centerX = w / 2;
      const centerY = h * 0.65;
      const scale = this.scale;

      const worldToScreenX = (wx) => centerX + wx * scale;
      const worldToScreenY = (wy) => centerY - (wy - this.cameraY) * scale;

      // 1. Draw Flue Background & Walls
      this.renderFlue(ctx, worldToScreenX, worldToScreenY, scale, w, h);

      // 2. Draw Ledges
      this.renderLedges(ctx, worldToScreenX, worldToScreenY, scale);

      // 3. Draw Items (Moths & Glimmers)
      this.renderItems(ctx, worldToScreenX, worldToScreenY, scale);

      // 4. Draw Rising Damp
      this.renderDamp(ctx, worldToScreenX, worldToScreenY, scale, w, h);

      // 5. Draw Aiming Slingshot Preview
      if (this.input.dragging && this.phase !== 'gameover') {
        this.renderAimTether(ctx, worldToScreenX, worldToScreenY, scale);
      }

      // 6. Draw Spark Character
      this.renderSpark(ctx, worldToScreenX, worldToScreenY, scale);

      // 7. Draw Visual FX (Particles, Shockwaves, Floating Text)
      this.renderFX(ctx, worldToScreenX, worldToScreenY, scale);

      // 8. Draw Overlay Screens (Ready / Tutorial, Game Over Ceremony)
      if (this.phase === 'ready') {
        this.renderReadyScreen(ctx, w, h, worldToScreenX, worldToScreenY);
      } else if (this.phase === 'gameover') {
        this.renderGameOverScreen(ctx, w, h);
      }

      ctx.restore();
    }

    renderFlue(ctx, toScreenX, toScreenY, scale, w, h) {
      const leftWallScreenX = toScreenX(this.WALL_LEFT);
      const rightWallScreenX = toScreenX(this.WALL_RIGHT);

      // Flue Interior gradient
      const flueGrad = ctx.createLinearGradient(leftWallScreenX, 0, rightWallScreenX, 0);
      flueGrad.addColorStop(0, '#0a0a14');
      flueGrad.addColorStop(0.2, '#10101f');
      flueGrad.addColorStop(0.5, '#151528');
      flueGrad.addColorStop(0.8, '#10101f');
      flueGrad.addColorStop(1, '#0a0a14');
      ctx.fillStyle = flueGrad;
      ctx.fillRect(leftWallScreenX, 0, rightWallScreenX - leftWallScreenX, h);

      // Brick pattern in interior flue
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;
      const brickHeight = 28 * scale;
      const brickWidth = 60 * scale;
      const startY = (toScreenY(0) % brickHeight);
      for (let y = startY - brickHeight; y < h + brickHeight; y += brickHeight) {
        ctx.beginPath();
        ctx.moveTo(leftWallScreenX, y);
        ctx.lineTo(rightWallScreenX, y);
        ctx.stroke();

        const rowOffset = (Math.floor(y / brickHeight) % 2) * (brickWidth / 2);
        for (let x = leftWallScreenX + rowOffset; x < rightWallScreenX; x += brickWidth) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + brickHeight);
          ctx.stroke();
        }
      }

      // Left Wall (Solid Outer Masonry)
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, leftWallScreenX, h);
      // Left Wall Rim Highlight
      const leftRim = ctx.createLinearGradient(leftWallScreenX - 8, 0, leftWallScreenX, 0);
      leftRim.addColorStop(0, 'rgba(40, 40, 60, 0)');
      leftRim.addColorStop(1, 'rgba(255, 150, 70, 0.25)');
      ctx.fillStyle = leftRim;
      ctx.fillRect(leftWallScreenX - 8, 0, 8, h);

      // Right Wall (Solid Outer Masonry)
      ctx.fillStyle = '#05050a';
      ctx.fillRect(rightWallScreenX, 0, w - rightWallScreenX, h);
      // Right Wall Rim Highlight
      const rightRim = ctx.createLinearGradient(rightWallScreenX, 0, rightWallScreenX + 8, 0);
      rightRim.addColorStop(0, 'rgba(255, 150, 70, 0.25)');
      rightRim.addColorStop(1, 'rgba(40, 40, 60, 0)');
      ctx.fillStyle = rightRim;
      ctx.fillRect(rightWallScreenX, 0, 8, h);
    }

    renderLedges(ctx, toScreenX, toScreenY, scale) {
      for (let i = 0; i < this.ledges.length; i++) {
        const ledge = this.ledges[i];
        if (!ledge.active) continue;

        const sx = toScreenX(ledge.position.x);
        const sy = toScreenY(ledge.position.y);
        const sw = ledge.halfWidth * 2 * scale;
        const sh = 10 * scale;

        // Skip offscreen
        if (sy < -40 || sy > this.viewportHeight + 40) continue;

        // Ledge Body
        ctx.save();
        ctx.translate(sx, sy);

        // Stone shelf
        ctx.fillStyle = '#1e1c28';
        ctx.beginPath();
        ctx.roundRect(-sw / 2, 0, sw, sh, [2, 2, 6, 6]);
        ctx.fill();

        // Glowing warm ember rim on top edge
        ctx.strokeStyle = 'rgba(255, 180, 80, 0.7)';
        ctx.lineWidth = 2.5 * scale;
        ctx.beginPath();
        ctx.moveTo(-sw / 2 + 2, 0);
        ctx.lineTo(sw / 2 - 2, 0);
        ctx.stroke();

        // Warm underside shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(-sw / 2, sh - 2, sw, 3);

        ctx.restore();
      }
    }

    renderItems(ctx, toScreenX, toScreenY, scale) {
      const now = performance.now() * 0.003;

      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        if (!item.active) continue;

        const sx = toScreenX(item.position.x);
        const sy = toScreenY(item.position.y);

        if (sy < -40 || sy > this.viewportHeight + 40) continue;

        ctx.save();
        ctx.translate(sx, sy);

        if (item.type === 'moth') {
          // --- Soot-Moth Art ---
          const flap = Math.sin(now * 16 + item.seedOffset) * 0.7;

          // Moth Glow
          const mothGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 24 * scale);
          mothGlow.addColorStop(0, 'rgba(255, 140, 40, 0.4)');
          mothGlow.addColorStop(1, 'rgba(255, 100, 20, 0)');
          ctx.fillStyle = mothGlow;
          ctx.beginPath();
          ctx.arc(0, 0, 24 * scale, 0, Math.PI * 2);
          ctx.fill();

          // Left Wing
          ctx.save();
          ctx.scale(1, flap);
          ctx.fillStyle = '#221c22';
          ctx.strokeStyle = '#ff9933';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(-8 * scale, -2 * scale, 10 * scale, 6 * scale, -Math.PI / 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // Right Wing
          ctx.save();
          ctx.scale(1, flap);
          ctx.fillStyle = '#221c22';
          ctx.strokeStyle = '#ff9933';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(8 * scale, -2 * scale, 10 * scale, 6 * scale, Math.PI / 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // Fuzzy Moth Body & Eyes
          ctx.fillStyle = '#110e14';
          ctx.beginPath();
          ctx.ellipse(0, 0, 3.5 * scale, 7 * scale, 0, 0, Math.PI * 2);
          ctx.fill();

          // Cute glowing antenna / eye dots
          ctx.fillStyle = '#ffaa33';
          ctx.beginPath();
          ctx.arc(-2 * scale, -5 * scale, 1.2 * scale, 0, Math.PI * 2);
          ctx.arc(2 * scale, -5 * scale, 1.2 * scale, 0, Math.PI * 2);
          ctx.fill();

        } else if (item.type === 'glimmer') {
          // --- Glimmer Crystal Art ---
          const rot = now * 1.5 + item.seedOffset;
          const pulse = 1 + Math.sin(now * 4 + item.seedOffset) * 0.15;

          // Radiant aura
          const glimGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22 * scale * pulse);
          glimGlow.addColorStop(0, 'rgba(120, 255, 255, 0.7)');
          glimGlow.addColorStop(0.5, 'rgba(0, 200, 255, 0.3)');
          glimGlow.addColorStop(1, 'rgba(0, 150, 255, 0)');
          ctx.fillStyle = glimGlow;
          ctx.beginPath();
          ctx.arc(0, 0, 22 * scale * pulse, 0, Math.PI * 2);
          ctx.fill();

          // Rotating diamond/star
          ctx.rotate(rot);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#33ddff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const r = 8 * scale * pulse;
          ctx.moveTo(0, -r * 1.3);
          ctx.lineTo(r * 0.7, 0);
          ctx.lineTo(0, r * 1.3);
          ctx.lineTo(-r * 0.7, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Inner sparkle
          ctx.fillStyle = '#b3f0ff';
          ctx.beginPath();
          ctx.arc(0, 0, 3 * scale, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    renderDamp(ctx, toScreenX, toScreenY, scale, w, h) {
      const dampScreenY = toScreenY(this.dampY);
      if (dampScreenY > h + 50) return; // Too far below

      const now = performance.now() * 0.002;

      ctx.save();
      // Multi-layered undulating mist
      for (let layer = 0; layer < 3; layer++) {
        const offset = layer * 14 * scale;
        const speed = (layer + 1) * 0.8;
        const alpha = 0.4 + layer * 0.25;

        ctx.fillStyle = layer === 2 ? 'rgba(8, 12, 28, 0.95)' : `rgba(18, 28, 55, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, h);
        ctx.lineTo(0, dampScreenY - offset);

        for (let x = 0; x <= w; x += 15) {
          const wave = Math.sin(x * 0.02 + now * speed + layer) * 12 * scale +
                       Math.cos(x * 0.04 - now * 0.5) * 6 * scale;
          ctx.lineTo(x, dampScreenY - offset + wave);
        }

        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }

      // Reaching glowing damp tendril sparks
      const dampRimGrad = ctx.createLinearGradient(0, dampScreenY - 30 * scale, 0, dampScreenY + 10 * scale);
      dampRimGrad.addColorStop(0, 'rgba(40, 180, 220, 0)');
      dampRimGrad.addColorStop(1, 'rgba(50, 200, 255, 0.3)');
      ctx.fillStyle = dampRimGrad;
      ctx.fillRect(0, dampScreenY - 30 * scale, w, 40 * scale);

      ctx.restore();
    }

    renderAimTether(ctx, toScreenX, toScreenY, scale) {
      const px = toScreenX(this.player.x);
      const py = toScreenY(this.player.y);

      const dx = this.input.dx;
      const dy = this.input.dy;
      const dist = Math.hypot(dx, dy);

      if (dist < this.DEAD_ZONE_PIXELS) return;

      const clampedDist = Math.min(dist, this.MAX_DRAG_PIXELS);
      const ratio = clampedDist / this.MAX_DRAG_PIXELS;
      const angle = Math.atan2(-dy, -dx); // Launch direction

      ctx.save();

      // Slingshot trajectory dotted prediction arc
      const speed = ratio * this.MAX_LAUNCH_SPEED;
      const simVx = Math.cos(angle) * speed;
      const simVy = Math.sin(angle) * speed;
      const numDots = 14;
      const dt = 0.035;

      let curX = this.player.x;
      let curY = this.player.y;
      let vX = simVx;
      let vY = simVy;

      ctx.fillStyle = '#ffbb44';
      for (let i = 1; i <= numDots; i++) {
        vY += this.GRAVITY * dt;
        curX += vX * dt;
        curY += vY * dt;

        const dotSx = toScreenX(curX);
        const dotSy = toScreenY(curY);
        const alpha = 1.0 - (i / numDots);
        const radius = Math.max(1.5, (4 - i * 0.2) * scale);

        ctx.fillStyle = `rgba(255, 190, 80, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(dotSx, dotSy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Drag tether line behind spark
      const pullX = px - Math.cos(angle) * (clampedDist * 0.45);
      const pullY = py + Math.sin(angle) * (clampedDist * 0.45);

      ctx.strokeStyle = `rgba(255, 120, 30, ${0.4 + ratio * 0.5})`;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(pullX, pullY);
      ctx.stroke();

      ctx.restore();
    }

    renderSpark(ctx, toScreenX, toScreenY, scale) {
      const sx = toScreenX(this.player.x);
      const sy = toScreenY(this.player.y);
      const r = this.PLAYER_RADIUS * scale;

      ctx.save();
      ctx.translate(sx, sy);

      // Squish & Stretch Transform
      ctx.rotate(this.player.flameRotation);
      ctx.scale(this.player.squishScaleX, this.player.squishScaleY);
      ctx.rotate(-this.player.flameRotation);

      const now = performance.now() * 0.005;

      // Outer Flame Aura Glow
      const glowGrad = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 3.2);
      if (this.player.jumpsLeft > 0) {
        glowGrad.addColorStop(0, 'rgba(255, 160, 40, 0.85)');
        glowGrad.addColorStop(0.4, 'rgba(255, 80, 10, 0.4)');
        glowGrad.addColorStop(1, 'rgba(255, 40, 0, 0)');
      } else {
        // Empty stock - panicked dim blue-ish flame
        glowGrad.addColorStop(0, 'rgba(180, 200, 255, 0.7)');
        glowGrad.addColorStop(0.4, 'rgba(80, 100, 220, 0.3)');
        glowGrad.addColorStop(1, 'rgba(40, 50, 150, 0)');
      }
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Flame Body
      const flameGrad = ctx.createRadialGradient(0, 2, 2, 0, 0, r * 1.3);
      if (this.player.jumpsLeft > 0) {
        flameGrad.addColorStop(0, '#ffffff');
        flameGrad.addColorStop(0.2, '#fff176');
        flameGrad.addColorStop(0.6, '#ff9800');
        flameGrad.addColorStop(1, '#e65100');
      } else {
        flameGrad.addColorStop(0, '#f0f4ff');
        flameGrad.addColorStop(0.4, '#82b1ff');
        flameGrad.addColorStop(1, '#2962ff');
      }

      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // Dancing Flame Top Wisp
      const wispOffset = Math.sin(now * 8) * 3 * scale;
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.3);
      ctx.quadraticCurveTo(0, -r * 1.8 + wispOffset, r * 0.7, -r * 0.3);
      ctx.closePath();
      ctx.fill();

      // --- Expressive Face ---
      this.renderSparkFace(ctx, r, scale);

      ctx.restore();

      // Orbiting Glow Indicators (Stock left)
      if (this.player.jumpsLeft > 0) {
        this.renderGlowOrbs(ctx, sx, sy, r, scale, now);
      }
    }

    renderSparkFace(ctx, r, scale) {
      const isAiming = this.input.dragging && this.phase !== 'gameover';
      const isEmptyFall = this.player.jumpsLeft === 0 && !this.player.anchored && this.player.vy < -40;
      const isClinging = this.player.anchorKind === 'wall';
      const isBlinking = this.player.blink > 0;

      ctx.fillStyle = '#1a0c00';

      if (isEmptyFall) {
        // Terrified wide eyes & wobbly mouth (O_O)
        ctx.fillStyle = '#0a1020';
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.1, 4 * scale, 0, Math.PI * 2);
        ctx.arc(r * 0.35, -r * 0.1, 4 * scale, 0, Math.PI * 2);
        ctx.fill();

        // White highlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-r * 0.35 - 1, -r * 0.1 - 1, 1.5 * scale, 0, Math.PI * 2);
        ctx.arc(r * 0.35 - 1, -r * 0.1 - 1, 1.5 * scale, 0, Math.PI * 2);
        ctx.fill();

        // O mouth
        ctx.strokeStyle = '#0a1020';
        ctx.lineWidth = 1.5 * scale;
        ctx.beginPath();
        ctx.arc(0, r * 0.35, 3 * scale, 0, Math.PI * 2);
        ctx.stroke();

      } else if (isAiming) {
        // Determined squinting / intense focus face (>_<)
        ctx.strokeStyle = '#220a00';
        ctx.lineWidth = 2 * scale;
        // Left eye
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.2);
        ctx.lineTo(-r * 0.2, -r * 0.05);
        ctx.stroke();
        // Right eye
        ctx.beginPath();
        ctx.moveTo(r * 0.5, -r * 0.2);
        ctx.lineTo(r * 0.2, -r * 0.05);
        ctx.stroke();

        // Confident smirk
        ctx.beginPath();
        ctx.arc(0, r * 0.2, 3.5 * scale, 0, Math.PI);
        ctx.stroke();

      } else if (isClinging) {
        // Straining wall cling face
        ctx.strokeStyle = '#220a00';
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(-r * 0.35, -r * 0.1, 2.5 * scale, Math.PI, 0);
        ctx.arc(r * 0.35, -r * 0.1, 2.5 * scale, Math.PI, 0);
        ctx.stroke();

        // Gritting teeth
        ctx.beginPath();
        ctx.moveTo(-r * 0.25, r * 0.3);
        ctx.lineTo(r * 0.25, r * 0.3);
        ctx.stroke();

      } else if (isBlinking) {
        // Closed blinking eyes
        ctx.strokeStyle = '#1a0c00';
        ctx.lineWidth = 1.8 * scale;
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, -r * 0.1);
        ctx.lineTo(-r * 0.2, -r * 0.1);
        ctx.moveTo(r * 0.2, -r * 0.1);
        ctx.lineTo(r * 0.5, -r * 0.1);
        ctx.stroke();

      } else {
        // Default happy, lively, curious eyes
        ctx.fillStyle = '#1a0c00';
        ctx.beginPath();
        ctx.ellipse(-r * 0.35, -r * 0.1, 3 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
        ctx.ellipse(r * 0.35, -r * 0.1, 3 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();

        // Big white sparkle reflections
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-r * 0.35 - 1 * scale, -r * 0.1 - 1.5 * scale, 1.6 * scale, 0, Math.PI * 2);
        ctx.arc(r * 0.35 - 1 * scale, -r * 0.1 - 1.5 * scale, 1.6 * scale, 0, Math.PI * 2);
        ctx.fill();

        // Cheerful mouth
        ctx.strokeStyle = '#1a0c00';
        ctx.lineWidth = 1.6 * scale;
        ctx.beginPath();
        ctx.arc(0, r * 0.22, 2.8 * scale, 0, Math.PI);
        ctx.stroke();
      }
    }

    renderGlowOrbs(ctx, sx, sy, r, scale, now) {
      const count = this.player.jumpsLeft;
      const orbitRadius = r * 1.7;

      for (let i = 0; i < count; i++) {
        const angle = now * 3 + (i * (Math.PI * 2 / count));
        const ox = sx + Math.cos(angle) * orbitRadius;
        const oy = sy + Math.sin(angle) * (orbitRadius * 0.6);

        ctx.fillStyle = '#fff9c4';
        ctx.beginPath();
        ctx.arc(ox, oy, 3.5 * scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 180, 50, 0.5)';
        ctx.beginPath();
        ctx.arc(ox, oy, 7 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    renderFX(ctx, toScreenX, toScreenY, scale) {
      // Particles
      for (let i = 0; i < this.fx.particles.length; i++) {
        const p = this.fx.particles[i];
        const sx = toScreenX(p.x);
        const sy = toScreenY(p.y);
        const alpha = 1.0 - (p.life / p.maxLife);

        ctx.fillStyle = p.type === 'soot' ? `${p.color}${alpha * 0.7})` : p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      // Shockwaves
      for (let i = 0; i < this.fx.shockwaves.length; i++) {
        const sw = this.fx.shockwaves[i];
        const sx = toScreenX(sw.x);
        const sy = toScreenY(sw.y);
        const alpha = 1.0 - (sw.life / sw.maxLife);

        ctx.strokeStyle = sw.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5 * scale;
        ctx.beginPath();
        ctx.arc(sx, sy, sw.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;

      // Floating Texts
      for (let i = 0; i < this.fx.texts.length; i++) {
        const ft = this.fx.texts[i];
        const sx = toScreenX(ft.x);
        const sy = toScreenY(ft.y);
        const alpha = 1.0 - (ft.life / ft.maxLife);

        ctx.font = `900 ${ft.size * scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText(ft.text, sx, sy);
      }
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;
    }

    renderReadyScreen(ctx, w, h, toScreenX, toScreenY) {
      const px = toScreenX(this.player.x);
      const py = toScreenY(this.player.y);

      ctx.save();
      ctx.fillStyle = 'rgba(10, 10, 20, 0.4)';
      ctx.fillRect(0, 0, w, h);

      // Title & Tutorial prompt
      ctx.textAlign = 'center';
      
      // Title
      ctx.font = '900 38px sans-serif';
      ctx.fillStyle = '#ff8833';
      ctx.shadowColor = 'rgba(255, 120, 20, 0.8)';
      ctx.shadowBlur = 15;
      ctx.fillText('EMBER', w / 2, h * 0.22);

      ctx.font = '600 13px sans-serif';
      ctx.fillStyle = 'rgba(255, 210, 160, 0.8)';
      ctx.shadowBlur = 0;
      ctx.fillText('THE SPARK ASCENDING', w / 2, h * 0.26);

      // Animated slingshot hint gesture
      const now = performance.now() * 0.003;
      const pullY = Math.sin(now * 3) * 25 + 30;

      ctx.strokeStyle = 'rgba(255, 180, 50, 0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + pullY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Hint Finger / Arrow
      ctx.fillStyle = '#ffd27d';
      ctx.font = '700 14px sans-serif';
      ctx.fillText('PULL & RELEASE TO LAUNCH', w / 2, py + 85);

      ctx.restore();
    }

    renderGameOverScreen(ctx, w, h) {
      ctx.save();
      // Backdrop blur
      ctx.fillStyle = 'rgba(8, 8, 16, 0.85)';
      ctx.fillRect(0, 0, w, h);

      const panelY = h * 0.22;
      ctx.textAlign = 'center';

      // Title
      ctx.font = '900 32px sans-serif';
      ctx.fillStyle = '#ff4422';
      ctx.shadowColor = 'rgba(255, 60, 20, 0.7)';
      ctx.shadowBlur = 16;
      ctx.fillText('TAKEN BY DAMP', w / 2, panelY);
      ctx.shadowBlur = 0;

      // Stats Card
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = 'rgba(255, 200, 150, 0.6)';
      ctx.fillText('RUN SCORE', w / 2, panelY + 45);

      ctx.font = '900 36px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${this.score}`, w / 2, panelY + 85);

      // Rank Grade
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = 'rgba(255, 200, 150, 0.6)';
      ctx.fillText('RANK AWARDED', w / 2, panelY + 125);

      ctx.font = '900 22px sans-serif';
      ctx.fillStyle = '#ffd27d';
      ctx.fillText(this.rank || 'Faint Ember', w / 2, panelY + 155);

      // Best Chain & Session Best
      const col1X = w * 0.32;
      const col2X = w * 0.68;

      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = 'rgba(255, 200, 150, 0.6)';
      ctx.fillText('BEST CHAIN', col1X, panelY + 200);
      ctx.fillText('SESSION BEST', col2X, panelY + 200);

      ctx.font = '900 20px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`x${this.chainBest}`, col1X, panelY + 228);
      ctx.fillText(`${this.sessionBest}`, col2X, panelY + 228);

      // Tap to restart prompt
      const now = performance.now() * 0.004;
      const alpha = 0.6 + Math.sin(now * 3) * 0.4;
      ctx.font = '700 15px sans-serif';
      ctx.fillStyle = `rgba(255, 210, 140, ${alpha})`;
      ctx.fillText('TAP ANYWHERE TO ASCEND AGAIN', w / 2, panelY + 300);

      ctx.restore();
    }

    // --- Arena Platform Runtime Interface (__ARENA_GAME__) ---
    snapshot() {
      // Return exact specification schema
      const spanMinY = this.player.y - this.LAUNCH_REACH;
      const spanMaxY = this.player.y + this.LAUNCH_REACH * 2.5;

      // Filter and format ledges in span
      const visibleLedges = this.ledges
        .filter(l => l.position.y >= spanMinY && l.position.y <= spanMaxY)
        .map(l => ({
          id: l.id,
          position: { x: l.position.x, y: l.position.y },
          halfWidth: l.halfWidth,
          active: l.active
        }))
        .sort((a, b) => a.id - b.id);

      // Filter and format items in span
      const visibleItems = this.items
        .filter(it => it.position.y >= spanMinY && it.position.y <= spanMaxY)
        .map(it => ({
          id: it.id,
          type: it.type,
          position: { x: Math.round(it.position.x * 100) / 100, y: Math.round(it.position.y * 100) / 100 },
          active: it.active,
          visualRadius: it.visualRadius,
          collisionRadius: it.collisionRadius
        }))
        .sort((a, b) => a.id - b.id);

      return {
        phase: this.phase,
        tick: this.tick,
        elapsedMs: this.elapsedMs,
        seed: this.seed,
        rngState: this.prng.state,
        spawnIndex: this.spawnIndex,
        input: {
          dragging: this.input.dragging,
          originX: this.input.originX,
          originY: this.input.originY,
          dx: this.input.dx,
          dy: this.input.dy
        },
        difficulty: Math.round(this.difficulty * 1000) / 1000,
        score: this.score,
        height: Math.round(this.height * 100) / 100,
        sessionBest: this.sessionBest,
        rank: this.rank,
        player: {
          x: Math.round(this.player.x * 100) / 100,
          y: Math.round(this.player.y * 100) / 100,
          vx: Math.round(this.player.vx * 100) / 100,
          vy: Math.round(this.player.vy * 100) / 100,
          playerRadius: this.player.playerRadius,
          anchored: this.player.anchored,
          anchorKind: this.player.anchorKind
        },
        jumpCapacity: this.player.jumpCapacity,
        jumpsLeft: this.player.jumpsLeft,
        launches: this.stats.launches,
        midairLaunches: this.stats.midairLaunches,
        landings: this.stats.landings,
        refunds: this.stats.refunds,
        glimmersCollected: this.stats.glimmersCollected,
        chainCount: this.chainCount,
        chainBest: this.chainBest,
        dampY: Math.round(this.dampY * 100) / 100,
        dampSpeed: Math.round(this.dampSpeed * 100) / 100,
        wallLeftX: this.WALL_LEFT,
        wallRightX: this.WALL_RIGHT,
        launchReach: Math.round(this.LAUNCH_REACH * 100) / 100,
        ledges: visibleLedges,
        items: visibleItems,
        lastEvent: this.lastEvent ? { kind: this.lastEvent.kind, tick: this.lastEvent.tick } : null
      };
    }
  }

  // Instantiate Game and bind to window.__ARENA_GAME__
  const game = new EmberGame();

  window.__ARENA_GAME__ = {
    reset: (seed) => game.reset(seed),
    snapshot: () => game.snapshot()
  };

})();
