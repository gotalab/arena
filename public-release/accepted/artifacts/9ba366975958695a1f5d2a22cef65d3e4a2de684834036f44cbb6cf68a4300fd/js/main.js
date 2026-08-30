(function (global) {
  'use strict';

  var CFG = global.EmberConfig;

  function init() {
    var canvas = document.getElementById('game');
    var sim = new global.EmberSim();
    sim.reset(((Math.random() * 0x7fffffff) >>> 0));
    var renderer = new global.Renderer(canvas);
    var audio = new global.AudioEngine();
    renderer.audio = audio;

    var acc = 0;
    var last = performance.now();

    function resetGame(seed) {
      sim.reset(seed);
      renderer.reset();
    }

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      var guard = 0;
      while (acc >= CFG.STEP && guard < 6) {
        sim.step();
        acc -= CFG.STEP;
        guard++;
      }
      if (guard >= 6) acc = 0;
      renderer.render(sim, dt);
    }

    function resize() {
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      var sat = 0;
      try {
        sat = parseFloat(getComputedStyle(document.body).getPropertyValue('--sat')) || 0;
      } catch (e) {}
      renderer.resize(global.innerWidth, global.innerHeight, dpr, sat);
    }

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (sim.phase === 'gameover') {
        audio.ensure();
        audio.relight();
        resetGame(sim.seed);
        return;
      }
      audio.ensure();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      sim.setInput({ dragging: true, originX: e.clientX, originY: e.clientY, dx: 0, dy: 0, wantLaunch: false });
    }, { passive: false });

    function onMove(e) {
      if (!sim.input.dragging) return;
      e.preventDefault();
      sim.setInput({
        dragging: true,
        originX: sim.input.originX,
        originY: sim.input.originY,
        dx: e.clientX - sim.input.originX,
        dy: e.clientY - sim.input.originY,
        wantLaunch: false
      });
    }

    function onUp(e) {
      if (!sim.input.dragging) return;
      var dx = sim.input.dx, dy = sim.input.dy;
      var len = Math.hypot(dx, dy);
      sim.setInput({
        dragging: false, originX: 0, originY: 0, dx: 0, dy: 0,
        wantLaunch: len >= CFG.DEAD_ZONE,
        launchDx: dx, launchDy: dy
      });
    }

    function onCancel() {
      if (!sim.input.dragging) return;
      sim.setInput({ dragging: false, originX: 0, originY: 0, dx: 0, dy: 0, wantLaunch: false });
    }

    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onCancel);
    global.addEventListener('pointermove', onMove, { passive: false });
    global.addEventListener('pointerup', onUp);
    global.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    global.addEventListener('resize', function () {
      var raf;
      return function () {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(resize);
      };
    }());

    resize();
    requestAnimationFrame(frame);

    global.__ARENA_GAME__ = {
      reset: function (seed) {
        resetGame(seed);
      },
      snapshot: function () {
        return sim.snapshot();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
