(function () {
  'use strict';

  var sim = window.Ember.simApi.createSim();
  var audio = window.Ember.createAudio();
  var WORLD_WIDTH = window.Ember.WORLD_WIDTH;
  var VIEW_HEIGHT = window.Ember.VIEW_HEIGHT;
  var STEP_MS = sim.constants.STEP_MS;

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('gameCanvas');
  var renderer = window.Ember.createRenderer(canvas);

  // ---------- initial seed (not part of deterministic rule state) ----------
  function pickInitialSeed() {
    var t = Date.now() >>> 0;
    var r = Math.floor(Math.random() * 0xffffffff) >>> 0;
    return (t ^ r) >>> 0 || 1;
  }
  var lastAudioTick = -1;
  var lastPhase = 'ready';
  var prevItemActiveAudio = Object.create(null);

  function doReset(seed) {
    sim.reset(seed);
    renderer.resetView();
    lastAudioTick = -1;
    lastPhase = 'ready';
    prevItemActiveAudio = Object.create(null);
  }
  doReset(pickInitialSeed());

  // ---------- runtime interface for the platform ----------
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      doReset(seed);
    },
    snapshot: function () {
      return sim.snapshot();
    }
  };

  // ---------- responsive stage sizing (letterboxed portrait, no scroll) ----------
  function viewportSize() {
    if (window.visualViewport) {
      return { w: window.visualViewport.width, h: window.visualViewport.height };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function fitStage() {
    var v = viewportSize();
    var aspect = WORLD_WIDTH / VIEW_HEIGHT;
    var w = v.w, h = v.h;
    var stageW, stageH;
    if (w / h > aspect) {
      stageH = h;
      stageW = stageH * aspect;
    } else {
      stageW = w;
      stageH = stageW / aspect;
    }
    stageW = Math.max(1, Math.floor(stageW));
    stageH = Math.max(1, Math.floor(stageH));
    stage.style.width = stageW + 'px';
    stage.style.height = stageH + 'px';

    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var bw = Math.round(stageW * dpr);
    var bh = Math.round(stageH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
  }

  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitStage);
  }
  fitStage();

  // ---------- pointer input ----------
  function toWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / Math.max(1, rect.width);
    var sy = canvas.height / Math.max(1, rect.height);
    var px = (clientX - rect.left) * sx;
    var py = (clientY - rect.top) * sy;
    var worldScale = canvas.width / WORLD_WIDTH;
    var cameraY = renderer.getCameraY();
    return {
      x: px / worldScale,
      y: cameraY + (canvas.height - py) / worldScale
    };
  }

  var activePointerId = null;
  var dragWorldOrigin = null;
  var curWorldDx = 0, curWorldDy = 0;

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    audio.start();

    var snap = sim.snapshot();
    if (snap.phase === 'gameover') {
      doReset(snap.seed);
      e.preventDefault();
      return;
    }

    activePointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var w = toWorld(e.clientX, e.clientY);
    dragWorldOrigin = w;
    curWorldDx = 0; curWorldDy = 0;
    sim.pointerDown(e.clientX, e.clientY, w.x, w.y);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    var w = toWorld(e.clientX, e.clientY);
    if (dragWorldOrigin) {
      curWorldDx = w.x - dragWorldOrigin.x;
      curWorldDy = w.y - dragWorldOrigin.y;
    }
    sim.pointerMove(e.clientX, e.clientY, w.x, w.y);
    e.preventDefault();
  }

  function endDrag(e, cancel) {
    if (e.pointerId !== activePointerId) return;
    if (cancel) {
      sim.pointerCancel();
    } else {
      var w = toWorld(e.clientX, e.clientY);
      sim.pointerUp(e.clientX, e.clientY, w.x, w.y);
    }
    activePointerId = null;
    dragWorldOrigin = null;
    curWorldDx = 0; curWorldDy = 0;
    e.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', function (e) { endDrag(e, false); }, { passive: false });
  canvas.addEventListener('pointercancel', function (e) { endDrag(e, true); }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  // ---------- audio reactions to snapshot events (view-only, never affects sim) ----------
  // Per spec, a same-tick 'chain' always overwrites a 'bounce' or midair 'launch' in
  // lastEvent, and 'chainBank' always overwrites a same-tick 'land'. So moth bursts and
  // glimmer pickups are detected via each item's own active flag (robust regardless of
  // masking), and 'chainBank' explicitly also plays the landing sound it always implies.
  function handleAudio(snap) {
    for (var i = 0; i < snap.items.length; i++) {
      var it = snap.items[i];
      var was = prevItemActiveAudio[it.id];
      if (was === true && it.active === false) {
        if (it.type === 'moth') audio.bounce(); else audio.glimmer();
      }
      prevItemActiveAudio[it.id] = it.active;
    }

    if (snap.lastEvent && snap.lastEvent.tick !== lastAudioTick) {
      lastAudioTick = snap.lastEvent.tick;
      switch (snap.lastEvent.kind) {
        case 'launch': audio.launch(); break;
        case 'land': audio.land(); break;
        case 'chainBank': audio.land(); audio.chainBank(snap.chainBest); break;
        case 'chain': audio.chainLink(snap.chainCount); break;
      }
    }
    if (snap.phase === 'gameover' && lastPhase !== 'gameover') {
      audio.gameOver();
    }
    lastPhase = snap.phase;

    var gap = (snap.player.y - snap.dampY);
    var proximity = 1 - Math.max(0, Math.min(1, gap / 320));
    audio.updateDampPressure(proximity);
  }

  // ---------- fixed-step loop ----------
  var acc = 0;
  var lastT = null;

  function frame(t) {
    if (lastT == null) lastT = t;
    var dtMs = t - lastT;
    lastT = t;
    if (dtMs > 250) dtMs = 250;
    acc += dtMs;
    var steps = 0;
    while (acc >= STEP_MS && steps < 8) {
      sim.step();
      acc -= STEP_MS;
      steps++;
    }
    var snap = sim.snapshot();
    handleAudio(snap);
    renderer.draw(snap, dtMs, curWorldDx, curWorldDy);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
