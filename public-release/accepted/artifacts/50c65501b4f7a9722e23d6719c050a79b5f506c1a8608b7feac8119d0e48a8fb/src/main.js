/* DELVE — input, frame loop, layout, and the Arena runtime interface. */
(function () {
  var D = window.DELVE;
  var SIM = D.sim;
  var S = D.state;
  var V = D.view;

  var frameEl = document.getElementById('frame');
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d', { alpha: false });

  var cw = 1, ch = 1, dpr = 1;

  /* ------------------------------------------------------------- layout */

  function readInsets() {
    var probe = document.getElementById('safe');
    if (!probe) return;
    var cs = getComputedStyle(probe);
    V.insets.t = parseFloat(cs.paddingTop) || 0;
    V.insets.r = parseFloat(cs.paddingRight) || 0;
    V.insets.b = parseFloat(cs.paddingBottom) || 0;
    V.insets.l = parseFloat(cs.paddingLeft) || 0;
  }

  function layout() {
    var vv = window.visualViewport;
    var w = vv ? vv.width : (document.documentElement.clientWidth || window.innerWidth);
    var h = vv ? vv.height : (document.documentElement.clientHeight || window.innerHeight);
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    frameEl.style.width = w + 'px';
    frameEl.style.height = h + 'px';

    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = w; ch = h;
    var pw = Math.max(1, Math.round(w * dpr)), phh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== phh) {
      canvas.width = pw; canvas.height = phh;
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    readInsets();
  }

  window.addEventListener('resize', layout, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(layout, 120); }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', layout, { passive: true });
    window.visualViewport.addEventListener('scroll', layout, { passive: true });
  }
  if (window.ResizeObserver) {
    try { new ResizeObserver(layout).observe(document.documentElement); } catch (e) { }
  }

  /* -------------------------------------------------------------- input */

  var kb = { accel: false, left: false, right: false };
  var stick = { active: false, ox: 0, oy: 0, kx: 0, ky: 0, r: 60, accel: false, steer: 0, throttle: 0, id: null };
  V.stick = stick;

  function syncInput() {
    var accel = kb.accel || stick.accel;
    var steer = (kb.right ? 1 : 0) - (kb.left ? 1 : 0) + (stick.active ? stick.steer : 0);
    if (steer > 1) steer = 1; else if (steer < -1) steer = -1;
    SIM.setInput(accel, steer, steer < -0.02, steer > 0.02);
  }

  function firstInput() { D.audio.init(); }

  /* --- keyboard: document level so the frame responds as soon as it has focus --- */
  var GAME_KEYS = { ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1, KeyR: 1 };

  document.addEventListener('keydown', function (e) {
    var c = e.code;
    if (GAME_KEYS[c] || e.key === ' ') e.preventDefault();
    if (e.repeat) return;
    firstInput();
    if (c === 'ArrowDown' || c === 'Space' || e.key === ' ') kb.accel = true;
    else if (c === 'ArrowLeft') kb.left = true;
    else if (c === 'ArrowRight') kb.right = true;
    else if (c === 'KeyR' || e.key === 'r' || e.key === 'R') { restart(S.seed); return; }
    else return;
    syncInput();
  }, { passive: false });

  document.addEventListener('keyup', function (e) {
    var c = e.code;
    if (GAME_KEYS[c] || e.key === ' ') e.preventDefault();
    if (c === 'ArrowDown' || c === 'Space' || e.key === ' ') kb.accel = false;
    else if (c === 'ArrowLeft') kb.left = false;
    else if (c === 'ArrowRight') kb.right = false;
    else return;
    syncInput();
  }, { passive: false });

  function releaseAll() {
    kb.accel = kb.left = kb.right = false;
    stick.active = false; stick.accel = false; stick.steer = 0; stick.throttle = 0; stick.id = null;
    syncInput();
  }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });

  /* --- one-thumb planted stick: identical semantics for touch and mouse --- */

  function localPt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  function stickRadius() {
    return Math.max(46, Math.min(108, Math.min(V.stage.w, ch) * 0.16));
  }

  function updateStick(p) {
    var r = stick.r;
    // rubber-band the plant point so the thumb can always re-engage
    var dx = p.x - stick.ox, dy = p.y - stick.oy;
    if (dy > r * 1.7) stick.oy = p.y - r * 1.7;
    else if (dy < -r * 1.2) stick.oy = p.y + r * 1.2;
    if (dx > r * 1.7) stick.ox = p.x - r * 1.7;
    else if (dx < -r * 1.7) stick.ox = p.x + r * 1.7;

    dx = p.x - stick.ox; dy = p.y - stick.oy;
    stick.kx = p.x; stick.ky = p.y;

    // the two axes are independent
    var dead = r * 0.26;
    stick.accel = dy > dead;
    stick.throttle = Math.max(0, Math.min(1, (dy - dead) / (r * 0.8)));

    var sdead = r * 0.12;
    var ax = Math.abs(dx);
    var s = ax <= sdead ? 0 : (ax - sdead) / (r * 0.78);
    if (s > 1) s = 1;
    stick.steer = (dx < 0 ? -s : s);
    syncInput();
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    firstInput();
    var p = localPt(e);

    if (inRect(p, V.muteRect())) { D.audio.toggleMute(); return; }

    if (S.phase === 'gameover') { restart(nextSeed(S.seed)); return; }

    stick.id = e.pointerId;
    stick.active = true;
    stick.r = stickRadius();
    stick.ox = p.x; stick.oy = p.y;
    stick.kx = p.x; stick.ky = p.y;
    stick.accel = false; stick.steer = 0; stick.throttle = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    syncInput();
  }, { passive: false });

  canvas.addEventListener('pointermove', function (e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    e.preventDefault();
    updateStick(localPt(e));
  }, { passive: false });

  function endPointer(e) {
    if (e.pointerId !== stick.id) return;
    stick.active = false; stick.accel = false; stick.steer = 0; stick.throttle = 0; stick.id = null;
    syncInput();
  }
  canvas.addEventListener('pointerup', endPointer, { passive: true });
  canvas.addEventListener('pointercancel', endPointer, { passive: true });
  canvas.addEventListener('lostpointercapture', endPointer, { passive: true });

  // belt and braces against page scroll / zoom gestures inside the frame
  ['touchstart', 'touchmove', 'touchend'].forEach(function (t) {
    canvas.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ------------------------------------------------------------- restart */

  function nextSeed(seed) {
    var t = ((seed >>> 0) + 0x9e3779b9) >>> 0;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) || 1;
  }

  function clearView() {
    V.parts.length = 0; V.pops.length = 0; V.trail.length = 0;
    V.shake = 0; V.flash = 0; V.grazeT = 0; V.crashT = 0; V.powerFlash = 0;
    V.endT = 0; V.readyT = 0; V.padFall = 0; V.tickAt = -1;
    V.hintSteer = 0; V.hintPower = 0; V.bestBeaten = false; V.lastSig = null;
    V.edgeHold = 0; V.zoom = 1; V.playerYF = 0.26;
    V.prevPhase = 'ready';
  }

  function restart(seed) {
    SIM.reset(seed);
    clearView();
    syncInput();     // holding the accelerator is all it takes to begin again
  }

  /* ---------------------------------------------------------------- loop */

  var last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    var dtMs = ts - last;
    last = ts;
    if (dtMs < 0) dtMs = 0;
    if (dtMs > 100) dtMs = 100;      // never let a stall fast-forward the course

    SIM.advance(dtMs);               // exactly the path the replay viewer uses

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    D.render.frame(ctx, cw, ch, dtMs / 1000);
  }

  /* ------------------------------------------------------ Arena interface */

  function bootSeed() {
    var m = /[?&#]seed=(\d+)/.exec(location.search + location.hash);
    if (m) return (parseInt(m[1], 10) >>> 0) || 1;
    var t = 0;
    try { t = Math.floor((window.performance && performance.now ? performance.now() : 0) * 1000); } catch (e) { }
    var d = 0;
    try { d = Date.now(); } catch (e) { }
    return (((d ^ t) >>> 0) || 12345);
  }

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      restart(seed === undefined || seed === null ? S.seed : seed);
    },
    snapshot: function () { return SIM.snapshot(); },
    advance: function (ms) { SIM.advance(ms); }
  };

  layout();
  restart(bootSeed());
  requestAnimationFrame(loop);
})();
