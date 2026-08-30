/* EMBER — loop, pointer input and the Arena runtime interface.
 *
 * One finger or one mouse button, through Pointer Events, identical for both.
 * The rules advance on a fixed 60 Hz step; the view interpolates between steps.
 */
(function (E) {
  'use strict';

  var C = E.C, Fx = E.Fx, Audio = E.Audio;
  var clamp = E.clamp;

  var canvas = document.getElementById('stage');
  var app = document.getElementById('app');
  var probe = document.getElementById('safeprobe');

  var sim = E.Sim.create();
  var Rr = E.Render;
  var V = Rr.V;

  /* ---------------------------------------------------------------- seed */

  function seedFromUrl() {
    try {
      var q = String(window.location.search || '') + String(window.location.hash || '');
      var m = /[?&#]seed=([0-9a-zA-Z]+)/.exec(q);
      if (m) {
        var n = parseInt(m[1], 36);
        if (isFinite(n) && n > 0) { return n >>> 0; }
      }
    } catch (err) { /* no location access: fall through */ }
    return 0x1f1aa5;
  }

  /* -------------------------------------------------------------- layout */

  function readSafe() {
    var s = { t: 0, r: 0, b: 0, l: 0 };
    try {
      var cs = window.getComputedStyle(probe);
      s.t = parseFloat(cs.paddingTop) || 0;
      s.r = parseFloat(cs.paddingRight) || 0;
      s.b = parseFloat(cs.paddingBottom) || 0;
      s.l = parseFloat(cs.paddingLeft) || 0;
    } catch (err) { /* defaults */ }
    return s;
  }

  function layout() {
    var cw = app.clientWidth || window.innerWidth || 320;
    var ch = app.clientHeight || window.innerHeight || 480;
    if (window.visualViewport) {
      cw = Math.min(cw, Math.max(1, Math.round(window.visualViewport.width)));
      ch = Math.min(ch, Math.max(1, Math.round(window.visualViewport.height)));
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    Rr.resize(cw, ch, dpr, readSafe());
  }

  /* --------------------------------------------------------------- input */

  var pid = null;
  var origin = { cx: 0, cy: 0, lx: 0, ly: 0 };
  var swallow = false;     // press that restarted a run must not also aim

  function clearAim() {
    var S = sim.state;
    V.aim.down = false;
    V.aim.len = 0; V.aim.power = 0; V.aim.power2 = 0; V.aim.valid = false;
    S.input.dragging = false;
    S.input.originX = 0; S.input.originY = 0;
    S.input.dx = 0; S.input.dy = 0;
  }

  function local(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inRect(r, x, y) {
    return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
  }

  function updateAim(e) {
    var S = sim.state;
    var p = local(e);
    var dx = e.clientX - origin.cx;
    var dy = e.clientY - origin.cy;
    S.input.dx = dx;
    S.input.dy = dy;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    var lenW = lenPx / Math.max(0.0001, Rr.R.s);
    V.aim.len = lenW;
    if (lenPx > 0.001) {
      V.aim.dirX = -dx / lenPx;
      V.aim.dirY = dy / lenPx;
    }
    var tp = clamp((lenW - C.DEAD_ZONE) / (C.MAX_PULL - C.DEAD_ZONE), 0, 1);
    V.aim.power = tp;
    V.aim.power2 = C.MIN_POWER + (1 - C.MIN_POWER) * tp;
    V.aim.valid = lenW >= C.DEAD_ZONE;
    V.aim.ox = origin.lx;
    V.aim.oy = origin.ly;
    return p;
  }

  function onDown(e) {
    if (pid !== null) { return; }
    if (e.pointerType === 'mouse' && e.button !== 0) { return; }
    e.preventDefault();
    Audio.ensure();

    var p = local(e);
    if (inRect(V.muteRect, p.x, p.y)) {
      Audio.setMuted(!Audio.isMuted());
      return;
    }

    var S = sim.state;
    if (S.phase === 'gameover') {
      if (V.goT > 0.35) { restart(); }
      swallow = true;
      pid = e.pointerId;
      return;
    }

    pid = e.pointerId;
    swallow = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    origin.cx = e.clientX; origin.cy = e.clientY;
    origin.lx = p.x; origin.ly = p.y;
    S.input.dragging = true;
    S.input.originX = e.clientX;
    S.input.originY = e.clientY;
    S.input.dx = 0; S.input.dy = 0;
    V.aim.down = true;
    V.aim.ox = p.x; V.aim.oy = p.y;
    V.aim.len = 0; V.aim.power = 0; V.aim.power2 = C.MIN_POWER; V.aim.valid = false;
  }

  function onMove(e) {
    if (e.pointerId !== pid || swallow) { return; }
    e.preventDefault();
    updateAim(e);
  }

  function onUp(e) {
    if (e.pointerId !== pid) { return; }
    e.preventDefault();
    pid = null;
    if (swallow) { swallow = false; return; }
    updateAim(e);
    if (V.aim.valid) {
      sim.queueLaunch(V.aim.dirX, V.aim.dirY, V.aim.power);
    }
    clearAim();
  }

  function onCancel(e) {
    if (e.pointerId !== pid) { return; }
    pid = null;
    swallow = false;
    clearAim();
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel, { passive: false });
  canvas.addEventListener('lostpointercapture', function (e) {
    if (e.pointerId === pid) { onCancel(e); }
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) {
    if (e.cancelable) { e.preventDefault(); }
  }, { passive: false });

  /* --------------------------------------------------------------- events */

  function handle(ev) {
    var S = sim.state;
    var d = ev.data || {};
    switch (ev.kind) {
      case 'launch':
        Fx.launchBurst(d.x, d.y, d.dx, d.dy, d.power);
        Audio.launch(d.power);
        V.pip[S.jumpsLeft] = 1;
        break;
      case 'land':
        Fx.landBurst(d.x, d.y, d.kind, (d.refilled || 0) >= 2);
        Audio.land(d.kind);
        if (d.refilled > 0) {
          Audio.refill(d.refilled);
          for (var i = 0; i < d.refilled; i++) { V.pip[S.jumpCapacity - 1 - i] = 1; }
        }
        break;
      case 'bounce':
        Fx.mothBurst(d.x, d.y, d.link);
        Audio.bounce(d.link);
        V.burstT = 0.19;
        break;
      case 'glimmer':
        Fx.glimmerPop(d.x, d.y, d.chain);
        Audio.glimmer(d.chain);
        if (d.chain >= 2) {
          Fx.banner('+' + d.points, '', Math.min(6, d.chain), [255, 232, 168]);
        }
        break;
      case 'chain':
        Fx.chainPulse(d.x, d.y, d.link);
        Audio.chainLink(d.link);
        V.chainPop = 1;
        if (d.link >= 3) {
          Fx.banner('CHAIN \u00d7' + d.link, d.link >= 6 ? 'ON FIRE' : '',
            d.link, Fx.chainCol(d.link));
        }
        break;
      case 'chainBank':
        Fx.bankBurst(d.x, d.y, d.links);
        Audio.bank(d.links);
        Fx.banner('+' + d.points, 'CHAIN \u00d7' + d.links + ' BANKED',
          Math.min(8, d.links), [255, 216, 140]);
        break;
      default:
        break;
    }
  }

  // Presentation must never be able to stall the rules: a failing voice or
  // effect is swallowed, the run carries on.
  var faults = 0;
  function drain() {
    var evs = sim.frameEvents;
    for (var i = 0; i < evs.length; i++) {
      try { handle(evs[i]); } catch (err) { faults++; }
    }
    evs.length = 0;
    if (faults > 24 && !Audio.isMuted()) { Audio.setMuted(true); }
  }

  /* -------------------------------------------------------------- restart */

  function restart() {
    var seed = sim.state.seed;
    var best = sim.state.sessionBest;
    sim.reset(seed);
    sim.state.sessionBest = best;
    Fx.reset();
    Rr.resetView(sim.state);
    clearAim();
  }

  /* ----------------------------------------------------------------- loop */

  var last = 0, acc = 0, wasPhase = 'ready';

  function loop(ts) {
    var dtReal = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (dtReal > 0.1) { dtReal = 0.1; }
    if (dtReal < 0) { dtReal = 0; }

    var S = sim.state;
    var scale = (V.aim.down && S.phase === 'playing') ? C.AIM_TIME_SCALE : 1;
    acc += dtReal * scale;
    var steps = 0;
    while (acc >= C.DT && steps < 6) {
      sim.step();
      drain();
      acc -= C.DT;
      steps++;
    }
    if (acc > C.DT * 3) { acc = 0; }

    if (S.phase === 'gameover' && wasPhase !== 'gameover') {
      try { Fx.deathFx(S.x, S.y); Audio.death(); } catch (err) { faults++; }
      clearAim();
      pid = null;
      if (S.newBest && S.score > 0) { window.setTimeout(function () { Audio.newBest(); }, 900); }
    }
    wasPhase = S.phase;

    try {
      Rr.frame(sim, dtReal, clamp(acc / C.DT, 0, 1));
      Audio.ambience(S.phase === 'gameover' ? 1 : V.prox, dtReal);
    } catch (err) { faults++; }

    window.requestAnimationFrame(loop);
  }

  /* ----------------------------------------------------------------- boot */

  Rr.init(canvas);
  layout();
  sim.reset(seedFromUrl());
  Fx.reset();
  Rr.resetView(sim.state);

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () {
    layout();
    window.setTimeout(layout, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', layout);
    window.visualViewport.addEventListener('scroll', layout);
  }
  if (window.ResizeObserver) {
    new window.ResizeObserver(layout).observe(app);
  }
  document.addEventListener('visibilitychange', function () { last = 0; acc = 0; });

  /* ---------------------------------------------- Arena runtime interface */

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      var best = sim.state.sessionBest;
      sim.reset(seed);
      sim.state.sessionBest = best;
      Fx.reset();
      Rr.resetView(sim.state);
      clearAim();
      pid = null;
      wasPhase = sim.state.phase;
      acc = 0;
    },
    snapshot: function () { return sim.snapshot(); }
  };

  window.requestAnimationFrame(loop);

})(window.EMBER);
