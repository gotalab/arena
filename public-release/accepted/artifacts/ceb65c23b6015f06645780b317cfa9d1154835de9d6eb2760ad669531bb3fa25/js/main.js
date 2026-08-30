/* EMBER — boot, layout, pointer input, fixed-step driver, Arena interface. */
(function () {
  'use strict';
  var E = window.EMBER;
  var C = E.C, Audio = E.Audio;
  var clamp = E.clamp;

  var canvas = document.getElementById('flue');
  var stage = document.getElementById('stage');
  var probe = document.getElementById('safeprobe');

  /* seed: the platform owns it via reset(seed); a query/hash seed makes a link
     shareable. Nothing in the simulation reads the clock. */
  function bootSeed() {
    try {
      var m = /(?:[?#&])seed=([0-9a-zA-Z_-]{1,16})/.exec(location.search + location.hash);
      if (m) {
        var n = parseInt(m[1], 10);
        if (isFinite(n) && n > 0) return n >>> 0;
        var h = 2166136261;
        for (var i = 0; i < m[1].length; i++) { h ^= m[1].charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
      }
    } catch (err) { /* sandboxed location access — fall through */ }
    return 0x5eed10;
  }

  var sim = new E.Sim(bootSeed());
  var renderer = new E.Renderer();
  renderer.init(canvas);

  /* ------------------------------------------------------------- layout */
  var insets = { top: 0, right: 0, bottom: 0, left: 0 };
  function readInsets() {
    try {
      var cs = getComputedStyle(probe);
      insets.top = parseFloat(cs.paddingTop) || 0;
      insets.bottom = parseFloat(cs.paddingBottom) || 0;
      insets.left = parseFloat(cs.paddingLeft) || 0;
      insets.right = parseFloat(cs.paddingRight) || 0;
    } catch (err) { /* ignore */ }
  }

  function resize() {
    readInsets();
    var w = stage.clientWidth || window.innerWidth || 360;
    var h = stage.clientHeight || window.innerHeight || 640;
    if (window.visualViewport) {
      // the frame can be resized by the player; follow the visible box
      w = Math.min(w, Math.round(window.visualViewport.width)) || w;
      h = Math.min(h, Math.round(window.visualViewport.height)) || h;
    }
    w = Math.max(160, w); h = Math.max(220, h);
    // capped: the flue is fill-rate heavy and 2x is already crisp on a phone
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    renderer.layout(w, h, dpr, insets);
    var r = canvas.getBoundingClientRect();
    renderer.rectLeft = r.left; renderer.rectTop = r.top;
  }

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(stage);
    ro.observe(document.documentElement);
  }
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(resize, 60); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize, { passive: true });
    window.visualViewport.addEventListener('scroll', resize, { passive: true });
  }
  resize();

  /* -------------------------------------------------------------- input */
  var activeId = null;
  var origin = { cx: 0, cy: 0 };
  var lastWindupPower = 0;

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    Audio.unlock();

    if (sim.phase === 'gameover') {
      if (renderer.overT > 1.35) {
        sim.reset(sim.seed);
        Audio.restart();
      }
      return;
    }
    if (activeId !== null) return;
    if (renderer.hitMute(e.clientX, e.clientY)) {
      Audio.toggleMute();
      return;
    }

    activeId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    origin.cx = e.clientX; origin.cy = e.clientY;
    lastWindupPower = 0;
    sim.setDrag(true, e.clientX, e.clientY, 0, 0, 0, 0);
  }

  function onMove(e) {
    if (activeId === null || e.pointerId !== activeId) return;
    e.preventDefault();
    var dx = e.clientX - origin.cx;
    var dy = e.clientY - origin.cy;
    var s = renderer.scale || 1;
    var wx = dx / s, wy = dy / s;
    sim.setDrag(true, origin.cx, origin.cy, dx, dy, wx, wy);

    var len = Math.sqrt(wx * wx + wy * wy);
    var p = clamp((len - C.DEAD) / (C.MAX_PULL - C.DEAD), 0, 1);
    if (len > C.DEAD && Math.abs(p - lastWindupPower) > 0.08) {
      lastWindupPower = p;
      Audio.windup(p);
    }
  }

  function onUp(e) {
    if (activeId === null || e.pointerId !== activeId) return;
    e.preventDefault();
    var dx = e.clientX - origin.cx;
    var dy = e.clientY - origin.cy;
    var s = renderer.scale || 1;
    sim.release(dx / s, dy / s);
    sim.setDrag(false, 0, 0, 0, 0, 0, 0);
    activeId = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onCancel(e) {
    if (activeId === null || e.pointerId !== activeId) return;
    sim.setDrag(false, 0, 0, 0, 0, 0, 0);
    activeId = null;
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  window.addEventListener('blur', function () {
    if (activeId !== null) { sim.setDrag(false, 0, 0, 0, 0, 0, 0); activeId = null; }
  });

  /* --------------------------------------------------------------- loop */
  var STEP = 1 / 60;
  var acc = 0;
  var last = 0;

  function loop(now) {
    if (!last) last = now;
    var dtReal = (now - last) / 1000;
    last = now;
    if (dtReal > 0.25) dtReal = 0.25;

    // holding an aim slows the world but never stops it
    var dilate = (sim.input.dragging && sim.phase === 'playing') ? 0.42 : 1;
    acc += dtReal * dilate;

    var steps = 0;
    while (acc >= STEP && steps < 6) { sim.step(); acc -= STEP; steps++; }
    if (acc > STEP * 6) acc = 0;

    renderer.frame(sim, dtReal, clamp(acc / STEP, 0, 1));
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /* ---------------------------------------------------- Arena interface */
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      sim.reset(seed);
      if (activeId !== null) { activeId = null; }
      sim.setDrag(false, 0, 0, 0, 0, 0, 0);
      acc = 0;
      return sim.snapshot();
    },
    snapshot: function () {
      return sim.snapshot();
    }
  };
})();
