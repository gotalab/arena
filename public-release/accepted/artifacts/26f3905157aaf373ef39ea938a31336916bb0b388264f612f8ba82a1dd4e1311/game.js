// EMBER - Core Simulation & Platform Integration Engine
// 60 Hz deterministic fixed-step simulation, fully reproducible from seed and input timeline.

(function() {
  'use strict';

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  // 32-bit Mulberry32 PRNG
  class PRNG {
    constructor(seed) {
      this.initialSeed = (seed >>> 0) || 1337;
      this.state = this.initialSeed;
    }
    next() {
      let t = this.state += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) {
      return min + this.next() * (max - min);
    }
    rangeInt(min, max) {
      return Math.floor(this.range(min, max + 1));
    }
  }

  class EmberGame {
    constructor() {
      // Configuration & Physics constants
      this.GRAVITY = 820;             // world units / s^2
      this.MAX_LAUNCH_SPEED = 620;    // world units / s
      this.MIN_LAUNCH_SPEED = 240;    // world units / s
      this.SOOT_SLIDE_SPEED = 26;     // wall slide speed in world units / s
      this.DEAD_ZONE = 12;            // pointer drag deadzone in px
      this.MAX_DRAG_DIST = 125;       // pointer drag max pull in px
      this.SLO_MO_FACTOR = 0.42;      // time scale while aiming
      this.BASE_DAMP_SPEED = 40;      // world units / s
      
      // World boundaries
      this.wallLeftX = -160;
      this.wallRightX = 160;
      this.launchReach = round2((this.MAX_LAUNCH_SPEED * this.MAX_LAUNCH_SPEED) / (2 * this.GRAVITY)); // 234.39

      this.jumpCapacity = 3;
      this.playerRadius = 12;

      // Session persistent state
      this.sessionBest = 0;
      this.currentSeed = 1337;

      // Visual callbacks / event observers (view-only)
      this.visualListener = null;

      // Initialize run state
      this.reset(this.currentSeed);
    }

    reset(seed) {
      if (seed === undefined || seed === null) {
        seed = this.currentSeed;
      } else {
        seed = Number(seed) >>> 0;
      }
      this.seed = seed;
      this.currentSeed = seed;
      this.rng = new PRNG(this.seed);

      // Run state
      this.phase = 'ready'; // "ready" | "playing" | "gameover"
      this.tick = 0;
      this.elapsedMs = 0;
      this.spawnIndex = 0;
      this.difficulty = 0;
      this.score = 0;
      this.height = 0;
      this.rank = null;
      this.lastEvent = null;

      // Internal score tracking
      this.bonusScore = 0;

      // Pointer / input state
      this.input = {
        dragging: false,
        originX: 0,
        originY: 0,
        dx: 0,
        dy: 0
      };

      // Player state
      this.x = 0;
      this.y = this.playerRadius; // on top of starting ledge at y = 0
      this.vx = 0;
      this.vy = 0;
      this.anchored = true;
      this.anchorKind = 'ledge';

      // Glow economy
      this.jumpsLeft = this.jumpCapacity;
      this.launches = 0;
      this.midairLaunches = 0;
      this.landings = 0;
      this.refunds = 0;
      this.glimmersCollected = 0;

      // Chain
      this.chainCount = 0;
      this.chainBest = 0;

      // World state
      this.dampY = -170;
      this.dampSpeed = this.BASE_DAMP_SPEED;

      // Entities
      this.ledges = [];
      this.items = [];
      this.ledgeIdCounter = 1;
      this.itemIdCounter = 1;
      this.highestGeneratedY = 0;
      this.lastSafeLedge = null;

      // Generate starting flue slice
      this.initFlue();

      if (this.visualListener && this.visualListener.onReset) {
        this.visualListener.onReset();
      }

      return this.snapshot();
    }

    initFlue() {
      // Base landing ledge at y = 0
      const startLedge = {
        id: this.ledgeIdCounter++,
        x: 0,
        y: 0,
        halfWidth: 72,
        active: true
      };
      this.ledges.push(startLedge);
      this.lastSafeLedge = startLedge;
      this.highestGeneratedY = 0;

      // Generate up to 4x launchReach ahead initially
      this.generateFlueUpTo(this.launchReach * 4.5);
    }

    generateFlueUpTo(targetY) {
      while (this.highestGeneratedY < targetY) {
        this.spawnIndex++;
        
        // 1. Guaranteed Safe Road Ledge
        // Vertical step: 45% to 72% of launch reach
        const minDy = this.launchReach * 0.44; // ~103
        const maxDy = this.launchReach * 0.72; // ~168
        const dy = this.rng.range(minDy, maxDy);
        const nextY = this.lastSafeLedge.y + dy;

        // Progressively narrower ledges at high altitudes, minimum 28 halfwidth
        const altProgress = Math.min(1.0, nextY / 4500);
        const hw = Math.round(50 - altProgress * 22);

        // Lateral range: ensure ledge sits safely inside flue
        const minX = this.wallLeftX + hw + 14;
        const maxX = this.wallRightX - hw - 14;
        
        // Pick an X reachable from lastSafeLedge
        let nextX = this.rng.range(minX, maxX);
        const maxHorizDelta = 175; // easily reachable in a single full launch
        if (nextX - this.lastSafeLedge.x > maxHorizDelta) {
          nextX = this.lastSafeLedge.x + maxHorizDelta;
        } else if (this.lastSafeLedge.x - nextX > maxHorizDelta) {
          nextX = this.lastSafeLedge.x - maxHorizDelta;
        }
        nextX = Math.max(minX, Math.min(maxX, nextX));

        const newSafeLedge = {
          id: this.ledgeIdCounter++,
          x: round2(nextX),
          y: round2(nextY),
          halfWidth: hw,
          active: true
        };
        this.ledges.push(newSafeLedge);

        // 2. Optional Secondary Ledge
        if (this.rng.next() < 0.62) {
          const isLeft = this.rng.next() < 0.5;
          const secHw = this.rng.rangeInt(24, 36);
          const secX = isLeft ? (this.wallLeftX + secHw + 4) : (this.wallRightX - secHw - 4);
          const secY = this.lastSafeLedge.y + this.rng.range(30, dy - 25);
          
          // Verify it does not overlap existing ledge
          if (Math.abs(secY - newSafeLedge.y) > 28) {
            this.ledges.push({
              id: this.ledgeIdCounter++,
              x: round2(secX),
              y: round2(secY),
              halfWidth: secHw,
              active: true
            });
          }
        }

        // 3. Soot-moths (Airborne lifelines)
        if (this.rng.next() < 0.58) {
          const mothX = this.rng.range(this.wallLeftX + 35, this.wallRightX - 35);
          const mothY = this.lastSafeLedge.y + this.rng.range(25, dy - 25);
          
          this.items.push({
            id: this.itemIdCounter++,
            type: 'moth',
            x: round2(mothX),
            y: round2(mothY),
            currentX: round2(mothX),
            currentY: round2(mothY),
            active: true,
            visualRadius: 14,
            collisionRadius: 14,
            // Drift parameters (deterministic sine modulation)
            ampX: this.rng.range(12, 22),
            ampY: this.rng.range(6, 12),
            freqX: this.rng.range(0.035, 0.055),
            freqY: this.rng.range(0.025, 0.045),
            phaseX: this.rng.range(0, Math.PI * 2),
            phaseY: this.rng.range(0, Math.PI * 2)
          });
        }

        // 4. Glimmers (Treasure tempting players into open air)
        if (this.rng.next() < 0.52) {
          // Often placed mid-shaft away from ledges
          const glimX = this.rng.range(this.wallLeftX + 30, this.wallRightX - 30);
          const glimY = this.lastSafeLedge.y + this.rng.range(35, dy - 15);

          this.items.push({
            id: this.itemIdCounter++,
            type: 'glimmer',
            x: round2(glimX),
            y: round2(glimY),
            currentX: round2(glimX),
            currentY: round2(glimY),
            active: true,
            visualRadius: 12,
            collisionRadius: 12,
            phase: this.rng.range(0, Math.PI * 2)
          });
        }

        this.lastSafeLedge = newSafeLedge;
        this.highestGeneratedY = nextY;
      }
    }

    updateItemPositions() {
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (!it.active) continue;

        if (it.type === 'moth') {
          it.currentX = round2(it.x + it.ampX * Math.sin(this.tick * it.freqX + it.phaseX));
          it.currentY = round2(it.y + it.ampY * Math.cos(this.tick * it.freqY + it.phaseY));
        } else if (it.type === 'glimmer') {
          it.currentX = it.x;
          it.currentY = round2(it.y + 3.5 * Math.sin(this.tick * 0.065 + it.phase));
        }
      }
    }

    calculateRank(finalScore) {
      if (finalScore >= 5500) return 'S+';
      if (finalScore >= 3500) return 'S';
      if (finalScore >= 2000) return 'A';
      if (finalScore >= 1000) return 'B';
      if (finalScore >= 400) return 'C';
      return 'D';
    }

    calculateBankBonus(chain) {
      if (chain <= 0) return 0;
      // Escalating reward: chain of 1 is 150, chain of 3 is 630, chain of 5 is 1350!
      return chain * 120 + chain * chain * 30;
    }

    // Advance 1 fixed 60Hz tick
    tickStep() {
      if (this.phase === 'ready') {
        // Simulation is completely frozen in 'ready' phase
        return;
      }

      if (this.phase === 'gameover') {
        return;
      }

      this.tick++;
      this.elapsedMs = Math.round(this.tick * (1000 / 60));

      const isSlowMo = this.input.dragging;
      const timeScale = isSlowMo ? this.SLO_MO_FACTOR : 1.0;
      const dt = (1 / 60) * timeScale;

      // Update difficulty
      this.difficulty = round2(Math.min(5.0, this.height / 850));
      this.dampSpeed = round2(this.BASE_DAMP_SPEED + this.difficulty * 16);

      // Advance rising damp
      this.dampY = round2(this.dampY + this.dampSpeed * dt);

      // Check damp engulfing spark
      if (this.y - this.playerRadius <= this.dampY) {
        this.y = this.dampY + this.playerRadius;
        this.vx = 0;
        this.vy = 0;
        this.phase = 'gameover';
        this.rank = this.calculateRank(this.score);
        if (this.score > this.sessionBest) {
          this.sessionBest = this.score;
        }
        if (this.visualListener && this.visualListener.onGameOver) {
          this.visualListener.onGameOver();
        }
        return;
      }

      // Update moth & glimmer animated positions
      this.updateItemPositions();

      // Ensure flue is generated ahead of spark
      if (this.y + this.launchReach * 3.5 > this.highestGeneratedY) {
        this.generateFlueUpTo(this.y + this.launchReach * 4.5);
      }

      const prevX = this.x;
      const prevY = this.y;

      // Physics integration
      if (this.anchored) {
        if (this.anchorKind === 'wall') {
          // Slick with soot: slides down
          this.vy = -this.SOOT_SLIDE_SPEED;
          this.y += this.vy * dt;
          this.vx = 0;
        } else {
          // Ledge rest
          this.vx = 0;
          this.vy = 0;
        }
      } else {
        // Free airborne flight
        this.vy -= this.GRAVITY * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
      }

      // Wall collisions
      if (this.x - this.playerRadius <= this.wallLeftX) {
        this.x = this.wallLeftX + this.playerRadius;
        this.vx = 0;
        if (!this.anchored) {
          this.handleLanding('wall');
        }
      } else if (this.x + this.playerRadius >= this.wallRightX) {
        this.x = this.wallRightX - this.playerRadius;
        this.vx = 0;
        if (!this.anchored) {
          this.handleLanding('wall');
        }
      }

      // Ledge landings (only when falling downwards)
      if (!this.anchored && this.vy <= 0) {
        for (let i = 0; i < this.ledges.length; i++) {
          const ledge = this.ledges[i];
          if (!ledge.active) continue;

          // Check if spark passed through ledge surface this tick
          const crossedY = (prevY - this.playerRadius >= ledge.y - 4) &&
                           (this.y - this.playerRadius <= ledge.y + 4);
          
          const withinX = (this.x >= ledge.x - ledge.halfWidth - this.playerRadius * 0.4) &&
                          (this.x <= ledge.x + ledge.halfWidth + this.playerRadius * 0.4);

          if (crossedY && withinX) {
            this.x = Math.max(ledge.x - ledge.halfWidth, Math.min(ledge.x + ledge.halfWidth, this.x));
            this.y = ledge.y + this.playerRadius;
            this.vx = 0;
            this.vy = 0;
            this.handleLanding('ledge');
            break;
          }
        }
      }

      // Items interaction (Moths & Glimmers)
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (!it.active) continue;

        const distSq = (this.x - it.currentX) ** 2 + (this.y - it.currentY) ** 2;
        const hitRadius = this.playerRadius + it.collisionRadius;

        if (distSq <= hitRadius * hitRadius) {
          it.active = false;

          if (it.type === 'moth') {
            // Moth burst!
            this.refunds++;
            this.jumpsLeft = Math.min(this.jumpCapacity, this.jumpsLeft + 1);

            // Upward kick boost
            this.vy = Math.max(this.vy + 440, 520);
            this.vx *= 0.75;
            this.anchored = false;
            this.anchorKind = null;

            // Chain link increment
            this.chainCount++;
            this.lastEvent = { kind: 'chain', tick: this.tick };

            if (this.visualListener && this.visualListener.onMothBurst) {
              this.visualListener.onMothBurst(it, this.chainCount);
            }
          } else if (it.type === 'glimmer') {
            // Glimmer collection!
            this.glimmersCollected++;
            const multiplier = 1 + 0.5 * this.chainCount;
            const pts = Math.round(150 * multiplier);
            this.bonusScore += pts;
            this.lastEvent = { kind: 'glimmer', tick: this.tick };

            if (this.visualListener && this.visualListener.onGlimmer) {
              this.visualListener.onGlimmer(it, pts, this.chainCount);
            }
          }
        }
      }

      // Track peak height reached
      if (this.y > this.height) {
        this.height = round2(this.y);
      }

      // Score = height * 10 + banked bonuses
      const heightScore = Math.max(0, Math.round(this.height * 10));
      this.score = heightScore + this.bonusScore;
    }

    handleLanding(kind) {
      this.anchored = true;
      this.anchorKind = kind;
      this.jumpsLeft = this.jumpCapacity; // full refill!
      this.landings++;

      const endedChain = this.chainCount;
      if (endedChain > 0) {
        if (endedChain > this.chainBest) {
          this.chainBest = endedChain;
        }
        const bankBonus = this.calculateBankBonus(endedChain);
        this.bonusScore += bankBonus;

        // Ordering: land then chainBank in same tick -> chainBank is lastEvent!
        this.lastEvent = { kind: 'chainBank', tick: this.tick };
        this.chainCount = 0;

        if (this.visualListener && this.visualListener.onChainBank) {
          this.visualListener.onChainBank(endedChain, bankBonus, kind);
        }
      } else {
        this.lastEvent = { kind: 'land', tick: this.tick };
        if (this.visualListener && this.visualListener.onLand) {
          this.visualListener.onLand(kind);
        }
      }
    }

    // Pointer Input Handling
    onPointerDown(screenX, screenY) {
      if (this.phase === 'gameover') {
        // Tap anywhere on end-of-run screen starts the next run
        this.reset(this.currentSeed);
        return;
      }

      this.input.dragging = true;
      this.input.originX = round2(screenX);
      this.input.originY = round2(screenY);
      this.input.dx = 0;
      this.input.dy = 0;

      if (window.emberAudio) {
        window.emberAudio.ensureContext();
      }
    }

    onPointerMove(screenX, screenY) {
      if (!this.input.dragging) return;
      this.input.dx = round2(screenX - this.input.originX);
      this.input.dy = round2(screenY - this.input.originY);

      if (window.emberAudio) {
        const pullDist = Math.hypot(this.input.dx, this.input.dy);
        const power = Math.min(1.0, Math.max(0, (pullDist - this.DEAD_ZONE) / (this.MAX_DRAG_DIST - this.DEAD_ZONE)));
        if (power > 0.1) {
          window.emberAudio.playAimStretch(power);
        }
      }
    }

    onPointerUp() {
      if (!this.input.dragging) return;

      const pullDist = Math.hypot(this.input.dx, this.input.dy);

      if (pullDist >= this.DEAD_ZONE) {
        this.executeLaunch(this.input.dx, this.input.dy, pullDist);
      }

      // Reset pointer state
      this.input.dragging = false;
      this.input.originX = 0;
      this.input.originY = 0;
      this.input.dx = 0;
      this.input.dy = 0;
    }

    executeLaunch(dx, dy, dist) {
      if (this.jumpsLeft <= 0) {
        // Dry empty launch attempt
        if (window.emberAudio) {
          window.emberAudio.playEmptyStock();
        }
        if (this.visualListener && this.visualListener.onDryLaunch) {
          this.visualListener.onDryLaunch();
        }
        return;
      }

      const wasAnchored = this.anchored;

      // Spend 1 glow
      this.jumpsLeft--;
      this.launches++;
      this.anchored = false;
      this.anchorKind = null;

      // Calculate sling impulse
      // Pull down (dy > 0) -> launch UP (vy > 0)
      // Pull left (dx < 0) -> launch RIGHT (vx > 0)
      const power = Math.min(1.0, (dist - this.DEAD_ZONE) / (this.MAX_DRAG_DIST - this.DEAD_ZONE));
      const launchSpeed = this.MIN_LAUNCH_SPEED + (this.MAX_LAUNCH_SPEED - this.MIN_LAUNCH_SPEED) * power;
      const angle = Math.atan2(dy, -dx);

      this.vx = Math.cos(angle) * launchSpeed;
      this.vy = Math.sin(angle) * launchSpeed;

      if (!wasAnchored) {
        // Mid-air launch extends the chain!
        this.midairLaunches++;
        this.chainCount++;
        // Ordering: launch then chain -> chain is lastEvent!
        this.lastEvent = { kind: 'chain', tick: this.tick };
      } else {
        this.lastEvent = { kind: 'launch', tick: this.tick };
      }

      if (this.phase === 'ready') {
        this.phase = 'playing';
      }

      if (window.emberAudio) {
        window.emberAudio.playLaunch(!wasAnchored, this.chainCount);
      }

      if (this.visualListener && this.visualListener.onLaunch) {
        this.visualListener.onLaunch(this.vx, this.vy, !wasAnchored, this.chainCount);
      }
    }

    // Platform snapshot API
    snapshot() {
      const minY = this.y - this.launchReach;
      const maxY = this.y + 2 * this.launchReach;

      // Filter ledges in span [spark.y - reach, spark.y + 2*reach]
      const spanLedges = [];
      for (let i = 0; i < this.ledges.length; i++) {
        const l = this.ledges[i];
        if (l.y >= minY && l.y <= maxY) {
          spanLedges.push({
            id: l.id,
            position: { x: round2(l.x), y: round2(l.y) },
            halfWidth: round2(l.halfWidth),
            active: l.active
          });
        }
      }
      spanLedges.sort((a, b) => a.id - b.id);

      // Filter items in same span
      const spanItems = [];
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (it.y >= minY && it.y <= maxY) {
          spanItems.push({
            id: it.id,
            type: it.type,
            position: { x: round2(it.currentX), y: round2(it.currentY) },
            active: it.active,
            visualRadius: it.visualRadius,
            collisionRadius: it.collisionRadius
          });
        }
      }
      spanItems.sort((a, b) => a.id - b.id);

      const snap = {
        // Run state
        phase: this.phase,
        tick: this.tick,
        elapsedMs: this.elapsedMs,
        seed: this.seed,
        rngState: this.rng.state,
        spawnIndex: this.spawnIndex,
        input: {
          dragging: this.input.dragging,
          originX: this.input.originX,
          originY: this.input.originY,
          dx: this.input.dx,
          dy: this.input.dy
        },
        difficulty: round2(this.difficulty),
        score: this.score,
        height: round2(this.height),
        sessionBest: this.sessionBest,
        rank: this.rank,

        // Player state
        x: round2(this.x),
        y: round2(this.y),
        vx: round2(this.vx),
        vy: round2(this.vy),
        playerRadius: this.playerRadius,
        anchored: this.anchored,
        anchorKind: this.anchorKind,

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
        dampY: round2(this.dampY),
        dampSpeed: round2(this.dampSpeed),
        wallLeftX: this.wallLeftX,
        wallRightX: this.wallRightX,
        launchReach: this.launchReach,

        // Entities
        ledges: spanLedges,
        items: spanItems,

        // Events
        lastEvent: this.lastEvent ? { kind: this.lastEvent.kind, tick: this.lastEvent.tick } : null
      };

      // Also attach player sub-object for convenience if telemetry inspects snapshot.player
      snap.player = {
        x: snap.x,
        y: snap.y,
        vx: snap.vx,
        vy: snap.vy,
        playerRadius: snap.playerRadius,
        anchored: snap.anchored,
        anchorKind: snap.anchorKind
      };

      return snap;
    }
  }

  // Create singleton and expose Platform Interface
  const game = new EmberGame();
  window.__ARENA_GAME__ = {
    reset: (seed) => game.reset(seed),
    snapshot: () => game.snapshot()
  };
  window.emberGame = game;

})();
