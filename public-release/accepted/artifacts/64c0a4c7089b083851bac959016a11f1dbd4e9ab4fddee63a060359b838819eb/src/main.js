/**
 * Entry point & Platform Interface for DELVE
 * Sets up canvas, game loop, audio event hooks, and exposes window.__ARENA_GAME__.
 */
(() => {
  const canvas = document.getElementById("gameCanvas");
  const soundEngine = new SoundEngine();
  const game = new DelveGame(Math.floor(Math.random() * 1000000));
  const inputManager = new InputManager(game, soundEngine, canvas);
  const renderer = new GameRenderer(canvas, game, inputManager);

  // Sound event hook
  let lastSoundEventSeq = 0;
  function processAudioEvents() {
    const events = game.events;
    while (lastSoundEventSeq < events.length) {
      const ev = events[lastSoundEventSeq];
      lastSoundEventSeq++;

      if (ev.kind === "wall_contact") {
        soundEngine.playCollision(true);
      } else if (ev.kind === "rock_hit") {
        soundEngine.playCollision(false);
      } else if (ev.kind === "rock_broken") {
        soundEngine.playRockBroken();
      } else if (ev.kind === "fragment") {
        soundEngine.playFragmentPickup(game.fragmentsCollected);
      } else if (ev.kind === "power") {
        soundEngine.playPowerPickup();
      } else if (ev.kind === "near_miss") {
        soundEngine.playNearMiss(game.nearMissCombo);
      }
    }

    // Continuous audio parameters
    const speedRatio = (game.speed - game.CRAWL_SPEED) / (game.maxSpeed - game.CRAWL_SPEED);
    const isDigging = game.input.down && game.phase === "playing";
    const isPowered = game.timeMs < game.invincibleUntilMs;
    const isGameOver = game.phase === "gameover";

    soundEngine.updateContinuous(speedRatio, isDigging, isPowered, isGameOver);

    // Warning alarm when timer is critically low
    if (game.phase === "playing" && game.remainingMs < 4500 && game.remainingMs > 0) {
      soundEngine.playWarningTick();
    }
  }

  // Handle Game Over sound trigger
  let prevPhase = "ready";
  function checkPhaseTransition() {
    if (prevPhase === "playing" && game.phase === "gameover") {
      soundEngine.playGameOver();
    }
    prevPhase = game.phase;
  }

  // Real-time animation loop
  let lastFrameTime = performance.now();
  let accumulatedTime = 0;
  const FIXED_STEP_MS = 1000 / 60;

  function loop(now) {
    const dt = Math.min(100, now - lastFrameTime);
    lastFrameTime = now;

    if (game.phase === "playing") {
      accumulatedTime += dt;
      while (accumulatedTime >= FIXED_STEP_MS) {
        game.step();
        accumulatedTime -= FIXED_STEP_MS;
      }
    } else {
      accumulatedTime = 0;
    }

    processAudioEvents();
    checkPhaseTransition();
    renderer.render(dt / 1000);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // Expose Arena Runtime Interface
  window.__ARENA_GAME__ = {
    reset(seed) {
      game.reset(seed);
      lastSoundEventSeq = 0;
      renderer.lastObservedEventSeq = 0;
    },
    snapshot() {
      return game.snapshot();
    },
    advance(ms) {
      game.advance(ms);
      processAudioEvents();
      checkPhaseTransition();
    }
  };
})();
