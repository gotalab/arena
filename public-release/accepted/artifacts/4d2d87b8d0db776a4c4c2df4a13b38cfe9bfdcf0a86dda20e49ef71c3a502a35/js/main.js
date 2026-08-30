'use strict';

(function main() {
  const canvas = document.getElementById('game-canvas');
  Renderer.init(canvas);
  Renderer.resize();

  let accum = 0;
  let lastTime = performance.now();
  let prevEvent = null;
  let prevChain = 0;
  let prevPhase = 'ready';
  let audioReady = false;

  const defaultSeed = 0xe08e801;
  Simulation.reset(defaultSeed);

  window.__ARENA_GAME__ = {
    reset(seed) {
      Simulation.reset(seed);
      prevEvent = null;
      prevChain = 0;
      prevPhase = 'ready';
      accum = 0;
      return Simulation.snapshot();
    },
    snapshot() {
      return Simulation.snapshot();
    },
  };

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function onPointerDown(e) {
    e.preventDefault();
    AudioEngine.unlock();
    audioReady = true;
    canvas.setPointerCapture(e.pointerId);

    const state = Simulation.getState();
    if (state.phase === 'gameover') return;

    const pos = pointerPos(e);
    Simulation.setInput({
      dragging: true,
      originX: pos.x,
      originY: pos.y,
      dx: 0,
      dy: 0,
    });
    state.player.expression = 'aim';
  }

  function onPointerMove(e) {
    const state = Simulation.getState();
    if (!state.input.dragging) return;
    e.preventDefault();
    const pos = pointerPos(e);
    Simulation.setInput({
      dx: pos.x - state.input.originX,
      dy: pos.y - state.input.originY,
    });
  }

  function onPointerUp(e) {
    e.preventDefault();
    const state = Simulation.getState();

    if (state.phase === 'gameover') {
      window.__ARENA_GAME__.reset(state.seed);
      return;
    }

    const result = Simulation.processPointerRelease();
    if (typeof result === 'number') {
      AudioEngine.launch(result);
      Particles.spawnBurst(
        state.player.x,
        state.player.y,
        8 + Math.floor(result * 8),
        Renderer.PAL.sparkHot,
        80 + result * 120,
        0.4,
      );
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => Renderer.resize());

  function handleEvents(state) {
    const ev = state.lastEvent;
    if (!ev || (prevEvent && prevEvent.kind === ev.kind && prevEvent.tick === ev.tick)) {
      // still check chain visual
    } else if (ev) {
      switch (ev.kind) {
        case 'land':
          AudioEngine.land(state.player.anchorKind);
          Renderer.flashLand();
          Particles.spawnBurst(
            state.player.x, state.player.y, 12,
            Renderer.PAL.ledgeGlow, 60, 0.35,
          );
          break;
        case 'bounce':
          AudioEngine.mothBurst();
          Particles.spawnBurst(
            state.player.x, state.player.y, 16,
            Renderer.PAL.mothWing, 100, 0.3,
          );
          break;
        case 'glimmer':
          AudioEngine.glimmer();
          Particles.spawnBurst(
            state.player.x, state.player.y, 10,
            Renderer.PAL.glimmer, 70, 0.4,
          );
          break;
        case 'chain':
          AudioEngine.chain(state.chainCount);
          Renderer.flashChain(state.chainCount);
          break;
        case 'chainBank':
          AudioEngine.chainBank(state.chainBest);
          break;
        default:
          break;
      }
      prevEvent = { ...ev };
    }

    if (state.chainCount > prevChain) {
      Renderer.flashChain(state.chainCount);
    }
    prevChain = state.chainCount;

    if (state.phase === 'gameover' && prevPhase !== 'gameover') {
      AudioEngine.gameOver();
    }
    prevPhase = state.phase;

    if (state.phase === 'playing' && audioReady) {
      const dampProximity = Math.max(0, 1 - (state.player.y - state.dampY) / 300);
      if (dampProximity > 0.2 && state.tick % 30 === 0) {
        AudioEngine.dampHum(dampProximity);
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    accum += dt;

    const step = 1 / Simulation.TICK_HZ;
    while (accum >= step) {
      Simulation.step();
      accum -= step;
    }

    const state = Simulation.getState();
    handleEvents(state);

    if (state.phase === 'playing' && !state.player.anchored) {
      Particles.spawnSparkTrail(
        state.player.x,
        state.player.y,
        Renderer.PAL.sparkCore,
      );
    }

    Particles.update(dt);
    Renderer.updateFlashes(dt);
    Renderer.render(state, state.input);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
