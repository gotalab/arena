/* DELVE — wiring. Frame loop, platform interface, nothing else.
 *
 * The real-time loop and the replay viewer walk through exactly the same door:
 * game.advance(ms). There is no second path that can move the simulation.
 */
(function (root) {
  'use strict';
  var DELVE = root.DELVE;
  var C = DELVE.C;

  function pickSeed() {
    // A shareable run is a seeded run, so honour one from the URL when the
    // platform provides it and otherwise ship a stable default.
    try {
      var q = new URLSearchParams(root.location.search || '');
      var s = q.get('seed') || (root.location.hash || '').replace(/^#seed=/, '');
      if (s && /^\d+$/.test(s)) return (parseInt(s, 10) >>> 0) || 1;
    } catch (e) { /* sandboxed frames may refuse; the default is fine */ }
    return 20260826;
  }

  function boot() {
    var canvas = document.getElementById('stage');
    var probe = document.getElementById('safe-probe');

    var seed = pickSeed();
    var game = new DELVE.Game(seed);
    var fx = new DELVE.Fx();
    var renderer = new DELVE.Renderer(canvas, game, fx);
    var audio = new DELVE.Audio();

    var soundArmed = false;

    var io = {
      touch: false, muted: false, stick: null, safeTop: 0, safeBottom: 0
    };

    var input = new DELVE.Input(canvas, {
      isOver: function () { return game.phase === 'gameover'; },
      restart: function () { doReset(game.seed); },
      onInput: function (state) { game.setInput(state); },
      firstInput: function () {
        if (!soundArmed) { soundArmed = true; audio.start(); audio.event('start', {}, null); }
        else audio.resume();
      },
      hitMute: function (x, y) {
        var m = renderer.muteHit;
        if (!m) return false;
        return (x - m.x) * (x - m.x) + (y - m.y) * (y - m.y) < m.r * m.r;
      },
      setMuted: function (m) { audio.setMuted(m); }
    });

    function doReset(s) {
      game.reset(s);
      renderer.resetView();
      game.setInput(input.state);
    }

    // ---- layout
    function fit() {
      var vv = root.visualViewport;
      var w = Math.round(vv ? vv.width : root.innerWidth);
      var h = Math.round(vv ? vv.height : root.innerHeight);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      renderer.resize();
      input.readSafeArea(probe);
    }
    root.addEventListener('resize', fit);
    root.addEventListener('orientationchange', function () { setTimeout(fit, 120); });
    if (root.visualViewport) {
      root.visualViewport.addEventListener('resize', fit);
      root.visualViewport.addEventListener('scroll', fit);
    }
    fit();

    // ---- frame loop
    var last = 0;
    function frame(now) {
      root.requestAnimationFrame(frame);
      if (!last) last = now;
      var dtMs = now - last;
      last = now;
      // The loop clamps its own frame delta; advance() itself never does, so a
      // replay scrub of the same span lands on the same state.
      if (dtMs > 100) dtMs = 100;
      if (dtMs < 0) dtMs = 0;

      game.setInput(input.state);
      game.advance(dtMs);
      drain();

      io.touch = input.touch;
      io.muted = input.muted;
      io.stick = input.stick;
      io.safeTop = input.safeTop;
      io.safeBottom = input.safeBottom;

      var dt = dtMs / 1000;
      renderer.frame(dt, io);
      audio.drive(dt, {
        speedFrac: (game.speed - C.IDLE_SPEED) / (C.MAX_SPEED - C.IDLE_SPEED),
        throttle: game.input.accel,
        phase: game.phase,
        combo: game.combo,
        powered: game.phase === 'playing' && game.timeMs < game.invincibleUntilMs,
        remainingMs: game.remainingMs
      });
    }

    // The simulation publishes what it already did; the view and the sound
    // only listen. Neither can award or alter anything.
    function drain() {
      var q = game.fx;
      if (!q.length) return;
      for (var i = 0; i < q.length; i++) {
        renderer.onEvent(q[i].kind, q[i].data);
        audio.event(q[i].kind, q[i].data, null);
      }
      q.length = 0;
    }

    root.requestAnimationFrame(frame);

    // ---------------------------------------------------- platform interface
    root.__ARENA_GAME__ = {
      reset: function (s) {
        doReset(s === undefined ? game.seed : (s >>> 0));
        return null;
      },
      snapshot: function () { return game.snapshot(); },
      advance: function (ms) {
        game.advance(typeof ms === 'number' && ms > 0 ? ms : 0);
        drain();
        return null;
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
