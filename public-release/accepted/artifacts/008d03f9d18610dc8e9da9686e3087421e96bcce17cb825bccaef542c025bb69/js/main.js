/* STOMP - shell: layout, input, frame loop, platform telemetry. */
(function (global) {
  'use strict';

  var K = global.STOMP_K;
  var R = global.StompRender;
  var A = global.StompAudio;

  var canvas = document.getElementById('stage');
  var shell = document.getElementById('shell');
  var probe = document.getElementById('safeprobe');

  var sim = new global.StompSim(1);
  R.init(canvas);

  var L = { cw: 1, ch: 1, dpr: 1, stage: { x: 0, y: 0, w: 1, h: 1, s: 1 }, band: { y: 0, h: 1 }, padL: {}, padR: {}, split: 0 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------------------------------------------- layout */

  // Two arrangements, one rule: the portrait stage is never stretched and the
  // two control surfaces are always fully on screen and inside thumb reach.
  //  - tall frames stack the controls in a band under the stage
  //  - wide frames tuck them into the letterbox columns beside it
  function layout() {
    var vv = global.visualViewport;
    var cw = Math.max(200, Math.round(vv ? vv.width : global.innerWidth));
    var ch = Math.max(240, Math.round(vv ? vv.height : global.innerHeight));

    shell.style.width = cw + 'px';
    shell.style.height = ch + 'px';

    var safeB = probe ? Math.min(48, probe.offsetHeight || 0) : 0;
    var dpr = clamp(global.devicePixelRatio || 1, 1, 2.5);
    var inset = 8;

    L.cw = cw; L.ch = ch; L.dpr = dpr;

    var wide = cw >= ch * 1.12 && cw >= 620;
    if (wide) {
      var col = clamp(cw * 0.15, 116, 210);
      var s2 = Math.min((ch - safeB) / K.H, (cw - col * 2 - 32) / K.W, 4);
      var sw2 = K.W * s2, sh2 = K.H * s2;
      L.mode = 'side';
      L.stage = {
        x: Math.round((cw - sw2) / 2 * 100) / 100,
        y: Math.round(Math.max(0, (ch - safeB - sh2) / 2) * 100) / 100,
        w: sw2, h: sh2, s: s2
      };
      L.band = { y: ch - safeB, h: 0 };
      var ph2 = clamp(ch * 0.2, 96, 172);
      var py2 = ch - safeB - inset - ph2;
      var jw2 = Math.min(col, 132);
      L.padL = { x: inset, y: py2, w: Math.min(col, 220), h: ph2 };
      L.padR = { x: cw - inset - jw2, y: py2, w: jw2, h: ph2 };
      L.split = cw / 2;
    } else {
      var band = ch < 460 ? clamp(ch * 0.235, 58, 104) : clamp(ch * 0.185, 92, 158);
      var availH = Math.max(120, ch - band - safeB);
      var s = Math.min(cw / K.W, availH / K.H);
      var sw = K.W * s, sh = K.H * s;
      L.mode = 'band';
      L.stage = {
        x: Math.round((cw - sw) / 2 * 100) / 100,
        y: Math.round(Math.max(0, (availH - sh) / 2) * 100) / 100,
        w: sw, h: sh, s: s
      };
      L.band = { y: availH, h: band };

      var left = Math.max(inset, L.stage.x + 2);
      var right = Math.min(cw - inset, L.stage.x + sw - 2);
      /* a stage narrower than the controls keeps them clustered under it,
         rather than flinging them to the far corners of the frame */
      var minCluster = Math.min(cw - inset * 2, 240);
      if (right - left < minCluster) {
        var mid = (left + right) / 2;
        left = clamp(mid - minCluster / 2, inset, cw - inset - minCluster);
        right = left + minCluster;
      }
      var usable = right - left;
      var gap = clamp(usable * 0.05, 10, 26);
      var jw = clamp(band * 0.95, 66, Math.min(usable * 0.38, 132));
      var mw = Math.min(usable - jw - gap, 250);

      var py = availH + Math.max(6, band * 0.08);
      var phh = band - Math.max(12, band * 0.16);
      L.padL = { x: left, y: py, w: mw, h: phh };
      L.padR = { x: right - jw, y: py, w: jw, h: phh };
      L.split = (left + mw + (right - jw)) / 2;
    }

    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    R.setLayout(L);
  }

  /* -------------------------------------------------------------- input */

  var keys = { left: false, right: false };
  var ptr = { move: false, moveId: -1, moveOx: 0, moveX: 0, axis: 0, jumpFlash: 0 };

  var DEAD = 5;
  var SPAN = 46;

  function applyMove() {
    var axis = 0;
    if (ptr.move) axis = ptr.axis;
    else axis = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    sim.setMove(clamp(axis, -1, 1));
  }

  function restart() {
    sim.reset(sim.seed);
    R.resetView();
    A.lastTick = -1;
    applyMove();
  }

  global.addEventListener('keydown', function (e) {
    if (e.repeat) {
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': keys.left = true; applyMove(); e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': keys.right = true; applyMove(); e.preventDefault(); break;
      case 'Space': case 'ArrowUp': case 'KeyW':
        A.ensure();
        if (sim.phase === 'over') restart();
        else { sim.setJumpHeld(true); sim.queueJump(); ptr.jumpFlash = 0.18; }
        e.preventDefault();
        break;
      case 'KeyR': A.ensure(); restart(); e.preventDefault(); break;
      case 'KeyM': A.toggle(); e.preventDefault(); break;
    }
  }, { passive: false });

  global.addEventListener('keyup', function (e) {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': keys.left = false; applyMove(); break;
      case 'ArrowRight': case 'KeyD': keys.right = false; applyMove(); break;
      case 'Space': case 'ArrowUp': case 'KeyW': sim.setJumpHeld(false); break;
    }
  });

  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function within(r, p, pad) {
    return p.x >= r.x - pad && p.x <= r.x + r.w + pad &&
           p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  }

  function regionOf(p) {
    if (within(L.padL, p, 22)) return 'move';
    if (within(L.padR, p, 22)) return 'jump';
    if (L.mode === 'band' && p.y >= L.band.y - 12) return p.x < L.split ? 'move' : 'jump';
    return null;
  }

  function setAxisFrom(x) {
    var dx = x - ptr.moveOx;
    var a = 0;
    if (Math.abs(dx) > DEAD) {
      a = clamp((Math.abs(dx) - DEAD) / SPAN, 0, 1) * (dx < 0 ? -1 : 1);
    }
    ptr.axis = a;
    ptr.moveX = x;
  }

  function capture(id) {
    try { if (canvas.setPointerCapture) canvas.setPointerCapture(id); } catch (err) { /* synthetic or stale pointer */ }
  }

  canvas.addEventListener('pointerdown', function (e) {
    A.ensure();
    var p = localPoint(e);

    if (R.muteHitTest(p.x, p.y)) { A.toggle(); e.preventDefault(); return; }

    if (sim.phase === 'over') { restart(); e.preventDefault(); return; }

    var region = regionOf(p);
    if (region === 'move') {
      capture(e.pointerId);
      ptr.move = true;
      ptr.moveId = e.pointerId;
      ptr.moveOx = p.x;
      ptr.moveX = p.x;
      ptr.axis = 0;
      applyMove();
    } else if (region === 'jump') {
      sim.setJumpHeld(true);
      sim.queueJump();
      ptr.jumpFlash = 0.18;
      ptr.jumpId = e.pointerId;
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', function (e) {
    if (!ptr.move || e.pointerId !== ptr.moveId) return;
    setAxisFrom(localPoint(e).x);
    applyMove();
    e.preventDefault();
  }, { passive: false });

  function release(e) {
    if (ptr.move && e.pointerId === ptr.moveId) {
      ptr.move = false; ptr.moveId = -1; ptr.axis = 0;
      applyMove();
    }
    if (ptr.jumpId === e.pointerId) { sim.setJumpHeld(false); ptr.jumpId = -1; }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  /* --------------------------------------------------------------- loop */

  var last = 0;
  var prevPhase = sim.phase;

  function frame(now) {
    if (!last) last = now;
    var raw = now - last;
    last = now;
    var dtMs = clamp(raw, 0, 100);

    sim.pump(dtMs, 8);

    if (sim.phase === 'run' && sim.remainingMs < 5200) {
      A.tick(Math.ceil(sim.remainingMs / 1000));
    }
    if (prevPhase !== 'over' && sim.phase === 'over') {
      R.submitBest(sim.score);
      A.over();
    }
    if (prevPhase === 'over' && sim.phase !== 'over') A.lastTick = -1;
    prevPhase = sim.phase;

    ptr.jumpFlash = Math.max(0, ptr.jumpFlash - dtMs / 1000);

    R.frame(sim, dtMs / 1000, {
      audio: A,
      muted: A.muted,
      pointer: ptr
    });
    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------- telemetry */

  global.__ARENA_GAME__ = {
    reset: function (seed) {
      sim.reset(seed === undefined ? sim.seed : seed);
      R.resetView();
      A.lastTick = -1;
      applyMove();
    },
    snapshot: function () { return sim.snapshot(); },
    advance: function (ms) {
      var amount = Number(ms);
      if (!isFinite(amount) || amount <= 0) return;
      sim.pump(amount);
    }
  };

  /* --------------------------------------------------------------- boot */

  layout();
  global.addEventListener('resize', layout);
  global.addEventListener('orientationchange', function () { setTimeout(layout, 120); });
  if (global.visualViewport) {
    global.visualViewport.addEventListener('resize', layout);
    global.visualViewport.addEventListener('scroll', layout);
  }
  if (global.ResizeObserver) new ResizeObserver(layout).observe(document.documentElement);
  global.addEventListener('pageshow', layout);

  requestAnimationFrame(frame);
})(window);
