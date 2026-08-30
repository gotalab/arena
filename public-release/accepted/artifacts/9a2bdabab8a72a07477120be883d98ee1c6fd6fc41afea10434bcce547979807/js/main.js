(function () {
  var D = window.DELVE;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  var canvas = document.getElementById('game');
  var audio = D.audio.createAudio();
  var renderer = D.render.createRenderer(canvas);
  var sim = D.sim.createSim(0);
  renderer.reset(0);

  var input = sim.input;
  var keys = { left: false, right: false };
  var lastSeenSeq = 0;
  var last = performance.now();
  var prevPhase = sim.phase;
  var startPulse = false;
  var lastSeenMs = 0;

  function restart() {
    sim.reset(sim.seed);
    renderer.reset(sim.seed);
    audio.reset();
    lastSeenSeq = 0;
    prevPhase = sim.phase;
    startPulse = false;
  }

  // ---------- POINTER (touch + mouse one-thumb stick) ----------
  var ptr = null;
  var DEAD = 12, RANGE = 64;

  function beginPointer(x, y, id) {
    audio.firstInput();
    if (sim.phase === 'gameover') {
      sim.reset(sim.seed);
      renderer.reset(sim.seed);
      audio.reset();
      lastSeenSeq = 0;
      prevPhase = sim.phase;
      input.accel = true; // a simple tap starts the next run
      startPulse = true;
    }
    ptr = { id: id, ox: x, oy: y, cx: x, cy: y };
  }
  function movePointer(x, y) {
    if (!ptr) return;
    ptr.cx = x; ptr.cy = y;
    var dx = ptr.cx - ptr.ox, dy = ptr.cy - ptr.oy;
    input.accel = dy > DEAD;
    input.steer = Math.abs(dx) > DEAD ? clamp((dx - (dx > 0 ? DEAD : -DEAD)) / RANGE, -1, 1) : 0;
  }
  function endPointer() {
    if (!ptr) return;
    ptr = null;
    input.accel = false;
    input.steer = 0;
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    beginPointer(e.clientX, e.clientY, e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (ptr && e.pointerId === ptr.id) movePointer(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (ptr && e.pointerId === ptr.id) endPointer();
  });
  canvas.addEventListener('pointercancel', function (e) {
    if (ptr && e.pointerId === ptr.id) endPointer();
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- KEYBOARD ----------
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowDown' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (e.repeat) return;
      audio.firstInput();
      if (sim.phase === 'gameover') {
        restart();
        startPulse = true;
      }
      input.accel = true;
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (e.repeat) return;
      if (k === 'ArrowLeft') keys.left = true; else keys.right = true;
      input.steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    } else if (k === 'r' || k === 'R') {
      restart();
    }
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowDown' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      input.accel = false;
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (k === 'ArrowLeft') keys.left = false; else keys.right = false;
      input.steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    }
  });

  // ---------- MUTE BUTTON ----------
  var muteBtn = document.getElementById('mute');
  muteBtn.addEventListener('click', function () {
    var m = audio.toggleMute();
    muteBtn.classList.toggle('muted', m);
  });

  // ---------- MAIN LOOP ----------
  function frame(now) {
    var dt = now - last;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 250) dt = 250;

    // If the platform is scrubbing the simulation externally (advance calls that
    // jump time well ahead of our real-time cadence), defer to it this frame.
    if (sim.timeMs - (lastSeenMs + dt) > 250) dt = 0;
    lastSeenMs = sim.timeMs;

    if (startPulse && sim.phase === 'ready' && !input.accel) input.accel = true;
    sim.advance(dt);
    if (startPulse && sim.phase === 'playing') startPulse = false;

    var ph = sim.phase;
    if (ph === 'playing' && prevPhase !== 'playing') audio.startRun();
    if (ph === 'gameover' && prevPhase !== 'gameover') audio.gameOver();
    prevPhase = ph;

    var evs = sim.events;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (ev.seq > lastSeenSeq) {
        lastSeenSeq = ev.seq;
        audio.event(ev.kind, sim);
        renderer.event(ev.kind, sim);
      }
    }

    audio.update(sim, dt);
    renderer.render(sim, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- ARENA RUNTIME INTERFACE ----------
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      sim.reset(seed | 0);
      renderer.reset(seed | 0);
      audio.reset();
      lastSeenSeq = 0;
      prevPhase = sim.phase;
      startPulse = false;
    },
    snapshot: function () {
      return sim.snapshot();
    },
    advance: function (ms) {
      sim.advance(ms);
      prevPhase = sim.phase;
      return sim.snapshot();
    }
  };
})();