// Main entrypoint and event loop for STOMP
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const sim = new GameSimulation(Date.now() & 0xfffffff);
  const renderer = new GameRenderer(canvas);
  const audio = new AudioSystem();

  // Expose platform telemetry
  window.__ARENA_GAME__ = {
    reset: (seed = Date.now() & 0xfffffff) => {
      sim.reset(seed);
      return sim.snapshot();
    },
    snapshot: () => sim.snapshot(),
    advance: (ms) => {
      sim.advance(ms);
      return sim.snapshot();
    },
  };

  // Audio mute button
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isMuted = audio.toggleMute();
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
    });
  }

  // Audio triggers from recentEvents
  let lastAudioEventSeq = 0;
  function processAudioEvents() {
    for (const ev of sim.recentEvents) {
      if (ev.sequence > lastAudioEventSeq) {
        lastAudioEventSeq = ev.sequence;
        if (ev.kind === 'machine_jump') {
          audio.playJump();
        } else if (ev.kind === 'machine_land') {
          audio.playLand();
        } else if (ev.kind === 'ball_bounce_power') {
          audio.playBounce('power');
        } else if (ev.kind === 'ball_bounce_normal') {
          audio.playBounce('normal');
        } else if (ev.kind === 'ball_bounce_weak') {
          audio.playBounce('weak');
        } else if (ev.kind === 'top_hit') {
          const enemy = sim.enemies.find((e) => e.id === ev.enemyId);
          audio.playTopHit(enemy ? enemy.hitsTaken : 1);
        } else if (ev.kind === 'ground_stomp') {
          audio.playStomp();
        } else if (ev.kind === 'wrong_side_hit') {
          audio.playWrongSide();
        } else if (ev.kind === 'ball_drop') {
          audio.playBallDrop();
        }
      }
    }
    if (sim.phase === 'gameover' && sim.remainingMs === 0 && !sim._gameOverSoundPlayed) {
      sim._gameOverSoundPlayed = true;
      audio.playGameOver();
    }
  }

  // Input state
  const keys = {
    left: false,
    right: false,
    jump: false,
  };

  function updateSimInput() {
    let left = keys.left;
    let right = keys.right;

    if (touchSteerActive) {
      const dx = touchSteerCurrentX - touchSteerAnchorX;
      if (dx < -12) {
        left = true;
        right = false;
      } else if (dx > 12) {
        right = true;
        left = false;
      }
    }

    sim.setInput(left, right, keys.jump || touchJumpActive);
  }

  // Keyboard Handlers
  window.addEventListener('keydown', (e) => {
    audio.resume();
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      keys.left = true;
      updateSimInput();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      keys.right = true;
      updateSimInput();
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      keys.jump = true;
      sim.queueJump();
      updateSimInput();
    } else if (e.code === 'KeyR') {
      if (sim.phase === 'gameover') {
        sim.reset(Date.now() & 0xfffffff);
      } else {
        sim.reset(sim.seed);
      }
      sim._gameOverSoundPlayed = false;
      lastAudioEventSeq = 0;
      renderer.lastProcessedEventSeq = 0;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      keys.left = false;
      updateSimInput();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      keys.right = false;
      updateSimInput();
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      keys.jump = false;
      updateSimInput();
    }
  });

  // Touch & Mouse Pointer tracking
  let touchSteerId = null;
  let touchJumpId = null;
  let touchSteerActive = false;
  let touchJumpActive = false;
  let touchSteerAnchorX = 0;
  let touchSteerAnchorY = 0;
  let touchSteerCurrentX = 0;
  let touchSteerCurrentY = 0;

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function handlePointerDown(id, clientX, clientY) {
    audio.resume();

    // Restart on tap if gameover
    if (sim.phase === 'gameover') {
      sim.reset(Date.now() & 0xfffffff);
      sim._gameOverSoundPlayed = false;
      lastAudioEventSeq = 0;
      renderer.lastProcessedEventSeq = 0;
      return;
    }

    const coords = getCanvasCoords(clientX, clientY);

    // Check if bottom-left (Steer) or bottom-right (Jump)
    if (coords.x < canvas.width * 0.5) {
      touchSteerId = id;
      touchSteerActive = true;
      touchSteerAnchorX = coords.x;
      touchSteerAnchorY = coords.y;
      touchSteerCurrentX = coords.x;
      touchSteerCurrentY = coords.y;

      renderer.touchSteerActive = true;
      renderer.touchSteerAnchorX = coords.x;
      renderer.touchSteerAnchorY = coords.y;
      renderer.touchSteerCurrentX = coords.x;
      renderer.touchSteerCurrentY = coords.y;
    } else {
      touchJumpId = id;
      touchJumpActive = true;
      renderer.touchJumpActive = true;
      sim.queueJump();
    }
    updateSimInput();
  }

  function handlePointerMove(id, clientX, clientY) {
    if (touchSteerActive && touchSteerId === id) {
      const coords = getCanvasCoords(clientX, clientY);
      touchSteerCurrentX = coords.x;
      touchSteerCurrentY = coords.y;
      renderer.touchSteerCurrentX = coords.x;
      renderer.touchSteerCurrentY = coords.y;
      updateSimInput();
    }
  }

  function handlePointerUp(id) {
    if (touchSteerId === id) {
      touchSteerId = null;
      touchSteerActive = false;
      renderer.touchSteerActive = false;
    }
    if (touchJumpId === id) {
      touchJumpId = null;
      touchJumpActive = false;
      renderer.touchJumpActive = false;
    }
    updateSimInput();
  }

  // Touch Events
  canvas.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handlePointerDown(t.identifier, t.clientX, t.clientY);
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handlePointerMove(t.identifier, t.clientX, t.clientY);
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchend',
    (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handlePointerUp(t.identifier);
      }
    },
    { passive: false }
  );

  canvas.addEventListener(
    'touchcancel',
    (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        handlePointerUp(t.identifier);
      }
    },
    { passive: false }
  );

  // Mouse Events
  let isMouseDown = false;
  canvas.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    handlePointerDown('mouse', e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (isMouseDown) {
      handlePointerMove('mouse', e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isMouseDown) {
      isMouseDown = false;
      handlePointerUp('mouse');
    }
  });

  // Animation Loop (Fixed 60Hz step with requestAnimationFrame)
  let lastTime = performance.now();
  let accumulator = 0;
  const DT = 1000 / 60;

  function loop(currentTime) {
    const delta = Math.min(100, currentTime - lastTime);
    lastTime = currentTime;
    accumulator += delta;

    while (accumulator >= DT) {
      sim.step();
      accumulator -= DT;
    }

    processAudioEvents();
    renderer.render(sim);
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
