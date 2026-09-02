// Main Entry Point & Platform Telemetry Integration

import { STAGE_WIDTH, STAGE_HEIGHT, TICK_MS } from './constants.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { audio } from './audio.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  canvas.width = STAGE_WIDTH;
  canvas.height = STAGE_HEIGHT;

  const game = new Game(1337);
  const renderer = new Renderer(canvas);

  // Expose Platform Telemetry Contract immediately
  window.__ARENA_GAME__ = {
    reset(seed) {
      game.reset(seed);
    },
    snapshot() {
      return game.snapshot();
    },
    advance(ms) {
      game.advance(ms);
    }
  };

  // DOM Elements
  const steerArea = document.getElementById('steerArea');
  const steerThumb = document.getElementById('steerThumb');
  const jumpBtn = document.getElementById('jumpBtn');
  const muteBtn = document.getElementById('muteBtn');
  const restartBtn = document.getElementById('restartBtn');

  // Audio mute button
  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isMuted = audio.toggleMute();
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
      muteBtn.setAttribute('aria-label', isMuted ? 'Unmute audio' : 'Mute audio');
    });
  }

  // Restart button
  if (restartBtn) {
    restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      game.reset(game.seed);
    });
  }

  // Canvas click to restart when game over or unlock audio
  canvas.addEventListener('pointerdown', (e) => {
    audio.ensureContext();
    if (game.phase === 'game_over') {
      game.reset(game.seed);
    }
  });

  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    audio.ensureContext();

    if (e.code === 'KeyR') {
      game.reset(game.seed);
      return;
    }

    if (game.phase === 'game_over') {
      if (e.code === 'Space' || e.code === 'Enter') {
        game.reset(game.seed);
        return;
      }
    }

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      game.setInput('left', true);
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      game.setInput('right', true);
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      game.setInput('jump', true);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      game.setInput('left', false);
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      game.setInput('right', false);
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      game.setInput('jump', false);
    }
  });

  // Touch & Mouse: Steer Surface
  // "The bottom-left touch surface plants its origin on touch-down. Horizontal displacement controls movement until release. Returning toward origin approaches neutral."
  let steerPointerId = null;
  let steerOriginX = 0;
  let steerCurrentX = 0;
  const STEER_DEADZONE = 12;

  function updateSteerMovement() {
    const deltaX = steerCurrentX - steerOriginX;
    if (Math.abs(deltaX) < STEER_DEADZONE) {
      game.setInput('left', false);
      game.setInput('right', false);
    } else if (deltaX < 0) {
      game.setInput('left', true);
      game.setInput('right', false);
    } else {
      game.setInput('right', true);
      game.setInput('left', false);
    }

    // Update visual thumb position
    if (steerThumb) {
      const maxDisplace = 35;
      const clampedDelta = Math.max(-maxDisplace, Math.min(maxDisplace, deltaX));
      steerThumb.style.transform = `translate(${clampedDelta}px, 0px)`;
    }
  }

  function onSteerStart(clientX, pointerId) {
    audio.ensureContext();
    steerPointerId = pointerId;
    steerOriginX = clientX;
    steerCurrentX = clientX;
    updateSteerMovement();
    if (steerThumb) steerThumb.classList.add('active');
  }

  function onSteerMove(clientX) {
    steerCurrentX = clientX;
    updateSteerMovement();
  }

  function onSteerEnd() {
    steerPointerId = null;
    game.setInput('left', false);
    game.setInput('right', false);
    if (steerThumb) {
      steerThumb.style.transform = 'translate(0px, 0px)';
      steerThumb.classList.remove('active');
    }
  }

  if (steerArea) {
    steerArea.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      steerArea.setPointerCapture(e.pointerId);
      onSteerStart(e.clientX, e.pointerId);
    });

    steerArea.addEventListener('pointermove', (e) => {
      if (steerPointerId === e.pointerId) {
        e.preventDefault();
        onSteerMove(e.clientX);
      }
    });

    const endSteer = (e) => {
      if (steerPointerId === e.pointerId) {
        e.preventDefault();
        onSteerEnd();
      }
    };
    steerArea.addEventListener('pointerup', endSteer);
    steerArea.addEventListener('pointercancel', endSteer);
  }

  // Touch & Mouse: Jump Surface
  // "The bottom-right touch surface queues one grounded jump per touch-down."
  // "Clicking the jump surface queues one grounded jump."
  if (jumpBtn) {
    jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.ensureContext();
      if (game.phase === 'game_over') {
        game.reset(game.seed);
        return;
      }
      game.setInput('jump', true);
      jumpBtn.classList.add('active');

      // Consume jump input after current physics step so it acts as single queue
      setTimeout(() => {
        game.setInput('jump', false);
      }, 35);
    });

    const endJump = (e) => {
      e.preventDefault();
      jumpBtn.classList.remove('active');
      game.setInput('jump', false);
    };
    jumpBtn.addEventListener('pointerup', endJump);
    jumpBtn.addEventListener('pointercancel', endJump);
  }

  // Animation & Interactive Frame Loop
  let lastTimestamp = performance.now();
  let accumulator = 0;

  function loop(now) {
    const elapsed = Math.min(100, now - lastTimestamp);
    lastTimestamp = now;

    if (game.phase === 'playing') {
      accumulator += elapsed;
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS;
        game.tick();
      }
    }

    // Render every frame
    renderer.render(game);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
