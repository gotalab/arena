import { DelveGame, FIXED_DT_MS, CRAWL_SPEED, MAX_SPEED } from './game.js';
import { SoundSystem } from './audio.js';
import { GameRenderer } from './renderer.js';
import { InputController } from './input.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const container = document.getElementById('gameContainer');

  const game = new DelveGame(1337);
  const sound = new SoundSystem();
  const renderer = new GameRenderer(canvas);
  const input = new InputController(canvas, game, sound);

  let lastProcessedEventSeq = 0;
  let prevPhase = game.phase;

  // Responsive canvas resizing maintaining crisp aspect ratio
  function resizeCanvas() {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    renderer.ctx.scale(dpr, dpr);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Handle game events for juice and audio
  function processGameEvents() {
    if (game.phase === 'gameover' && prevPhase !== 'gameover') {
      sound.playGameOver();
    }
    prevPhase = game.phase;

    while (lastProcessedEventSeq < game.eventSeq) {
      lastProcessedEventSeq++;
      const evt = game.events.find(e => e.seq === lastProcessedEventSeq);
      if (!evt) continue;

      switch (evt.kind) {
        case 'wall_contact':
          sound.playWallContact();
          break;
        case 'rock_hit':
          sound.playRockHit();
          renderer.triggerRockShatter(game.x, game.depth, 20);
          break;
        case 'rock_broken':
          sound.playRockBroken();
          renderer.triggerRockShatter(game.x, game.depth, 24, true);
          break;
        case 'fragment':
          sound.playFragmentPickup(game.fragmentsCollected);
          renderer.triggerFragmentPickup(game.x, game.depth);
          break;
        case 'power':
          sound.playPowerPickup();
          renderer.triggerPowerPickup(game.x, game.depth);
          break;
        case 'near_miss':
          sound.playNearMiss(game.nearMissStreak);
          renderer.triggerNearMissEffect(game.x, game.depth, game.nearMissStreak);
          break;
      }
    }
  }

  // Animation frame loop
  let lastTime = performance.now();
  let accumulator = 0;

  function loop(currentTime) {
    const dt = Math.min(currentTime - lastTime, 100);
    lastTime = currentTime;

    if (game.phase === 'playing') {
      accumulator += dt;
      while (accumulator >= FIXED_DT_MS) {
        game.step();
        accumulator -= FIXED_DT_MS;
      }
    }

    processGameEvents();

    const speedRatio = (game.speed - CRAWL_SPEED) / (MAX_SPEED - CRAWL_SPEED);
    const isPowered = game.timeMs < game.invincibleUntilMs;
    sound.update(speedRatio, isPowered, game.phase === 'playing', game.remainingMs, game.nearMissStreak);

    renderer.render(game, input.touchStick);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // Platform Runtime Interface for Arena Replay & Telemetry
  window.__ARENA_GAME__ = {
    reset: (seed) => {
      lastProcessedEventSeq = 0;
      prevPhase = 'ready';
      game.reset(seed !== undefined ? seed : 1337);
    },
    snapshot: () => {
      return game.snapshot();
    },
    advance: (ms) => {
      game.advance(ms);
      processGameEvents();
    }
  };
});
