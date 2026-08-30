(function (root) {
'use strict';

function boot() {
  var canvas = document.getElementById('stage-canvas');
  if (!canvas) return;

  var seedMatch = /(?:^|[?&])seed=(\d+)/.exec(root.location.search);
  var startSeed = seedMatch ? (parseInt(seedMatch[1], 10) >>> 0) : ((Math.random() * 4294967296) >>> 0);

  var core = root.DelveCore.createGame(startSeed);
  var audio = root.DelveAudio();
  var session = { best: 0, runs: 0 };

  var pointer = { kind: 'touch' };
  window.addEventListener('pointerdown', function (e) {
    pointer.kind = e.pointerType || 'mouse';
    audio.init();
  }, { capture: true, passive: true });
  document.addEventListener('keydown', function () { audio.init(); }, { capture: true, once: false });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'm' || e.key === 'M') {
      visual.muteFlash(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
    }
  });

  var restartBlockUntil = 0;
  var visual = root.DelveVisual(core, canvas, {
    session: session,
    pointer: pointer,
    sound: function (name, opt) { audio.play(name, opt); },
    onRestartHook: null
  });

  core.hooks.newSeed = function () {
    return (Math.random() * 4294967296) >>> 0;
  };

  var inputApi = root.DelveInput(core, {
    stage: canvas,
    restartBlocked: function () {
      return performance.now() < restartBlockUntil;
    },
    onFirstGesture: function () { audio.init(); },
    onRestart: function () {}
  });
  visual.stick = inputApi.stick;

  /* runtime interface */
  root.__ARENA_GAME__ = {
    reset: function (seed) { core.reset(seed); },
    snapshot: function () { return core.snapshot(); },
    advance: function (ms) { core.advance(ms); }
  };

  /* main loop */
  var STEP_MS = 1000 / 60;
  var acc = 0;
  var last = performance.now();
  var wasGameover = false;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = now - last;
    last = now;
    if (dt > 100) dt = 100;

    if (core.viewState().phase === 'ready') {
      core.pumpStart();
    } else if (core.viewState().phase === 'playing') {
      acc += dt;
      var guard = 0;
      while (acc >= STEP_MS && guard++ < 10) { acc -= STEP_MS; core.stepOnce(); }
      if (acc >= STEP_MS) acc = 0;
    } else {
      acc = 0;
    }

    if (core.viewState().phase === 'gameover') {
      if (!wasGameover) restartBlockUntil = performance.now() + 700;
    } else {
      wasGameover = false;
    }
    wasGameover = core.viewState().phase === 'gameover';

    visual.frame(now);

    var vs = core.viewState();
    var snN = Math.max(0, Math.min(1, (core.consts.top - vs.player.speed) / (core.consts.top - core.consts.crawl)));
    audio.update(dt / 1000, { sn: snN, accel: !!(core.input.kb.accel || core.input.pt.accel) });
  }

  try {
    canvas.focus({ preventScroll: true });
  } catch (e) { try { canvas.focus(); } catch (e2) {} }
  root.addEventListener('keydown', function () {
    try { canvas.focus({ preventScroll: true }); } catch (e) {}
  }, { capture: false });

  if (typeof root.ResizeObserver === 'function') {
    try {
      new ResizeObserver(function () { window.dispatchEvent(new Event('resize')); })
        .observe(document.documentElement);
    } catch (e) {}
  }

  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else boot();

})(typeof self !== 'undefined' ? self : this);
