/* STOMP — bootstrap: layout, input surfaces, frame loop, platform telemetry. */
(function () {
  'use strict';

  var Sim = window.StompSim;
  var View = window.StompView;
  var Snd = window.StompAudio;
  var C = Sim.CONST;
  var W = C.W, H = C.H;

  var canvas = document.getElementById('stage');
  var overlay = document.getElementById('overlay');
  var padMove = document.getElementById('pad-move');
  var padJump = document.getElementById('pad-jump');
  var thumb = padMove.querySelector('.pad-thumb');
  var hint = document.getElementById('hint');
  var endcard = document.getElementById('endcard');
  var muteBtn = document.getElementById('mute');

  var sim = new Sim(20260826);
  View.init(canvas);

  var driven = false;              // true while the platform is stepping the sim
  var lastPhase = 'ready';
  var best = 0;
  try { best = parseInt(window.localStorage.getItem('stomp.best') || '0', 10) || 0; } catch (e) {}

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ============================================================== layout == */
  function relayout() {
    var vv = window.visualViewport;
    var vw = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
    var vh = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
    var dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    var probe = document.getElementById('safe-probe');
    var safeB = probe ? probe.offsetHeight : 0;
    var L = View.layout(vw, vh, dpr, safeB);
    var s = L.scale;

    overlay.style.left = L.ox + 'px';
    overlay.style.top = L.oy + 'px';
    overlay.style.width = L.stageW + 'px';
    overlay.style.height = L.stageH + 'px';
    overlay.style.setProperty('--s', s);

    var barTop = H * s;
    var padTop = barTop + 13 * s;
    var padH = Math.max(48, (L.barH - 30) * s);

    padMove.style.left = (10 * s) + 'px';
    padMove.style.width = (150 * s) + 'px';
    padMove.style.top = padTop + 'px';
    padMove.style.height = padH + 'px';

    padJump.style.left = (200 * s) + 'px';
    padJump.style.width = (150 * s) + 'px';
    padJump.style.top = padTop + 'px';
    padJump.style.height = padH + 'px';

    muteBtn.style.left = (167 * s) + 'px';
    muteBtn.style.top = (barTop + 15 * s) + 'px';
    muteBtn.style.width = (26 * s) + 'px';
    muteBtn.style.height = (26 * s) + 'px';

    hint.style.left = '0px';
    hint.style.width = L.stageW + 'px';
    hint.style.top = (604 * s) + 'px';

    endcard.style.left = '0px';
    endcard.style.top = '0px';
    endcard.style.width = L.stageW + 'px';
    endcard.style.height = (H * s) + 'px';
  }

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', function () { setTimeout(relayout, 60); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', relayout);
    window.visualViewport.addEventListener('scroll', relayout);
  }
  relayout();

  /* =============================================================== input == */
  var touchAxis = null;            // non-null while a pointer steers
  var keyLeft = false, keyRight = false;

  function syncAxis() {
    var a = touchAxis !== null ? touchAxis : ((keyRight ? 1 : 0) + (keyLeft ? -1 : 0));
    sim.setAxis(a);
  }

  function wake() {
    driven = false;
    Snd.resume();
  }

  function queueJump() {
    wake();
    if (sim.phase === 'ended') { restart(sim.seed); return; }   // retry stays under the thumb
    sim.pressJump();
    padJump.classList.remove('fire');
    void padJump.offsetWidth;
    padJump.classList.add('fire');
  }

  function setThumb(px) {
    thumb.style.setProperty('--tx', px + 'px');
  }

  /* --- movement surface: origin plants on touch-down, release is neutral -- */
  var moveId = null, originX = 0, originY = 0, flickArmed = true;

  padMove.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    wake();
    try { padMove.setPointerCapture(e.pointerId); } catch (err) {}
    moveId = e.pointerId;
    originX = e.clientX; originY = e.clientY;
    flickArmed = true;
    touchAxis = 0;
    padMove.classList.add('on');
    setThumb(0);
    syncAxis();
  });

  padMove.addEventListener('pointermove', function (e) {
    if (e.pointerId !== moveId) return;
    e.preventDefault();
    var range = Math.max(24, padMove.clientWidth * 0.32);
    var dead = range * 0.11;
    var dx = e.clientX - originX;
    var mag = Math.abs(dx);
    var a = 0;
    if (mag > dead) a = clamp((mag - dead) / (range - dead), 0, 1) * (dx < 0 ? -1 : 1);
    touchAxis = a;
    setThumb(clamp(dx, -range, range));
    syncAxis();

    /* flick up to jump: one pointer can play the whole game, mouse included */
    var dy = originY - e.clientY;
    if (dy > 30 && flickArmed) { flickArmed = false; queueJump(); }
    else if (dy < 12) flickArmed = true;
  });

  function endMove(e) {
    if (moveId === null || (e && e.pointerId !== moveId)) return;
    moveId = null;
    touchAxis = null;
    padMove.classList.remove('on');
    setThumb(0);
    syncAxis();
  }
  padMove.addEventListener('pointerup', endMove);
  padMove.addEventListener('pointercancel', endMove);
  padMove.addEventListener('lostpointercapture', endMove);

  /* --- jump surface: one grounded jump per touch-down -------------------- */
  padJump.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { padJump.setPointerCapture(e.pointerId); } catch (err) {}
    padJump.classList.add('on');
    queueJump();
  });
  function endJump() { padJump.classList.remove('on'); }
  padJump.addEventListener('pointerup', endJump);
  padJump.addEventListener('pointercancel', endJump);
  padJump.addEventListener('lostpointercapture', endJump);

  /* --- keyboard supplements the surfaces on desktop ---------------------- */
  window.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { wake(); keyLeft = true; syncAxis(); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { wake(); keyRight = true; syncAxis(); e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'w' || k === 'W') {
      e.preventDefault();
      if (sim.phase === 'ended') { restart(sim.seed); return; }
      if (!e.repeat) queueJump();
    } else if (k === 'r' || k === 'R') {
      e.preventDefault();
      restart(sim.seed);
    } else if (k === 'Enter') {
      if (sim.phase === 'ended') { e.preventDefault(); restart(sim.seed); }
    } else if (k === 'm' || k === 'M') {
      toggleMute();
    }
  });
  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keyLeft = false; syncAxis(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keyRight = false; syncAxis(); }
  });
  window.addEventListener('blur', function () {
    keyLeft = keyRight = false;
    touchAxis = null; moveId = null;
    padMove.classList.remove('on');
    padJump.classList.remove('on');
    setThumb(0);
    syncAxis();
  });

  /* prevent the page itself from ever moving under the game */
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });

  /* ================================================================ mute == */
  function toggleMute() {
    Snd.resume();
    Snd.setMuted(!Snd.muted);
    muteBtn.classList.toggle('muted', Snd.muted);
  }
  muteBtn.classList.toggle('muted', Snd.muted);
  muteBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); toggleMute(); });

  /* ============================================================= restart == */
  function restart(seed) {
    sim.reset(seed);
    View.resetFx();
    driven = false;
    lastPhase = 'ready';
    endcard.classList.remove('show');
    hint.classList.remove('gone');
    document.body.classList.remove('running');
    syncAxis();
  }

  document.getElementById('again').addEventListener('click', function (e) {
    e.stopPropagation();
    Snd.resume();
    restart(sim.seed);
  });
  document.getElementById('newseed').addEventListener('click', function (e) {
    e.stopPropagation();
    Snd.resume();
    restart((Math.random() * 4294967295) >>> 0);
  });
  endcard.addEventListener('pointerdown', function (e) {
    if (e.target === endcard) { Snd.resume(); restart(sim.seed); }
  });

  /* ============================================================= end card = */
  function showEnd() {
    var snap = sim.snapshot();
    if (snap.score > best) {
      best = snap.score;
      try { window.localStorage.setItem('stomp.best', String(best)); } catch (e) {}
    }
    document.getElementById('e-rank').textContent = snap.rank;
    document.getElementById('e-score').textContent = snap.score;
    document.getElementById('e-best').textContent = best;
    document.getElementById('e-kills').textContent = snap.airEnemiesDefeated;
    document.getElementById('e-chain').textContent = snap.longestCleanSequence;
    document.getElementById('e-seed').textContent = 'seed ' + snap.seed;
    endcard.classList.add('show');
  }

  function syncDom() {
    if (sim.phase !== lastPhase) {
      if (sim.phase === 'playing') {
        hint.classList.add('gone');
        document.body.classList.add('running');
        endcard.classList.remove('show');
      } else if (sim.phase === 'ended') {
        showEnd();
      } else {
        hint.classList.remove('gone');
        document.body.classList.remove('running');
        endcard.classList.remove('show');
      }
      lastPhase = sim.phase;
    }
  }

  /* ================================================================ loop == */
  var last = (window.performance || Date).now();
  function frame(now) {
    var dt = now - last;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 250) dt = 250;              // a backgrounded tab must not fast-forward

    if (!driven) sim.advance(dt);
    View.update(dt / 1000, sim, Snd);
    View.render(sim);
    syncDom();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', function () {
    last = (window.performance || Date).now();
  });
  requestAnimationFrame(function (t) { last = t; requestAnimationFrame(frame); });

  /* ========================================================== telemetry === */
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      restart(seed === undefined ? sim.seed : seed);
      return sim.snapshot();
    },
    snapshot: function () {
      return sim.snapshot();
    },
    advance: function (ms) {
      driven = true;                     // external stepping is authoritative
      sim.advance(ms);
      return sim.snapshot();
    }
  };
})();
