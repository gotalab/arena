/**
 * DELVE — input, frame loop, Arena runtime interface.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("game");
  var sim = DelveSim.create();
  var view = new DelveView(canvas);
  var audio = new DelveAudio();
  view.audio = audio;

  var keys = { accel: false, left: false, right: false };
  var pointer = null;
  var lastTs = 0;
  var endedOnce = false;

  function layout() {
    view.resize();
  }

  function applyInput() {
    var accel = keys.accel;
    var steer;
    var left = keys.left;
    var right = keys.right;
    if (pointer) {
      accel = accel || pointer.accel;
      steer = pointer.steer;
      left = false;
      right = false;
    } else {
      steer = left && !right ? -1 : right && !left ? 1 : 0;
    }
    DelveSim.setInput(sim, { accel: accel, left: left, right: right, steer: steer });
  }

  function unlock() {
    audio.unlock();
  }

  function restartSameSeed() {
    var seed = sim.seed;
    DelveSim.reset(sim, seed);
    view.lastSeq = 0;
    view.crashT = 0;
    view.grazeT = 0;
    view.combo = 0;
    view.comboT = 0;
    endedOnce = false;
    applyInput();
  }

  function startNextFromTouch() {
    DelveSim.reset(sim, sim.seed);
    view.lastSeq = 0;
    endedOnce = false;
    DelveSim.startRun(sim);
  }

  function pointerFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function updateStick(e) {
    if (!pointer) return;
    var p = pointerFromEvent(e);
    pointer.x = p.x;
    pointer.y = p.y;
    var dx = p.x - pointer.originX;
    var dy = p.y - pointer.originY;
    pointer.accel = dy > 16;
    var ax = Math.abs(dx);
    if (ax < 12) pointer.steer = 0;
    else pointer.steer = Math.max(-1, Math.min(1, dx / 58));
    applyInput();
    view.setStick({
      originX: pointer.originX,
      originY: pointer.originY,
      x: p.x,
      y: p.y
    });
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    unlock();
    if (sim.phase === "gameover") startNextFromTouch();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
    var p = pointerFromEvent(e);
    pointer = {
      id: e.pointerId,
      originX: p.x,
      originY: p.y,
      x: p.x,
      y: p.y,
      accel: false,
      steer: 0
    };
    updateStick(e);
  }

  function onPointerMove(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    e.preventDefault();
    updateStick(e);
  }

  function onPointerUp(e) {
    if (!pointer || (e.pointerId != null && e.pointerId !== pointer.id)) return;
    pointer = null;
    view.setStick(null);
    applyInput();
  }

  function isAccelCode(code) {
    return code === "ArrowDown" || code === "Space" || code === "NumpadEnter";
  }

  function onKeyDown(e) {
    var code = e.code;
    if (isAccelCode(code) || code === "ArrowLeft" || code === "ArrowRight" || code === "KeyR" || code === "Space") {
      e.preventDefault();
    }
    if (e.repeat && code === "KeyR") return;
    unlock();
    if (code === "KeyR") {
      restartSameSeed();
      return;
    }
    if (code === "KeyM") {
      audio.toggleMute();
      return;
    }
    if (isAccelCode(code)) keys.accel = true;
    if (code === "ArrowLeft") keys.left = true;
    if (code === "ArrowRight") keys.right = true;
    applyInput();
  }

  function onKeyUp(e) {
    var code = e.code;
    if (isAccelCode(code) || code === "ArrowLeft" || code === "ArrowRight" || code === "Space") {
      e.preventDefault();
    }
    if (isAccelCode(code)) keys.accel = false;
    if (code === "ArrowLeft") keys.left = false;
    if (code === "ArrowRight") keys.right = false;
    applyInput();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });
  document.addEventListener("keydown", onKeyDown, { capture: true });
  document.addEventListener("keyup", onKeyUp, { capture: true });
  document.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("resize", layout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", layout);
    window.visualViewport.addEventListener("scroll", layout);
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;
    applyInput();
    DelveSim.advance(sim, dt);
    var snap = DelveSim.snapshot(sim);
    if (snap.phase === "gameover") {
      if (!endedOnce) {
        endedOnce = true;
        var sc = Math.floor(snap.score);
        if (sc > view.best) view.best = sc;
        audio.gameover();
      }
    } else {
      endedOnce = false;
    }
    view.ingest(sim, snap);
    view.stepView(dt / 1000, snap);
    audio.tick(snap, view.combo);
    view.draw(sim, snap);
  }

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      pointer = null;
      view.setStick(null);
      DelveSim.reset(sim, seed);
      view.lastSeq = 0;
      view.crashT = 0;
      view.grazeT = 0;
      view.combo = 0;
      endedOnce = false;
    },
    snapshot: function () {
      return DelveSim.snapshot(sim);
    },
    advance: function (ms) {
      DelveSim.advance(sim, ms);
    }
  };

  layout();
  requestAnimationFrame(frame);
})();
