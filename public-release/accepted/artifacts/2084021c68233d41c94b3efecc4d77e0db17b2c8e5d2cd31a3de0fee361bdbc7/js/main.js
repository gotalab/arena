/* SHOAL - wiring.
   One production state, three ways in: fingers, window.__ARENA_GAME__, and
   the arena.game.v1 bridge. They all call the same perform(). */
(function () {
  var S = window.SHOAL;

  var canvas = document.getElementById('stage');
  var app = document.getElementById('app');
  var titleEl = document.getElementById('title');
  var cerEl = document.getElementById('ceremony');
  var toastEl = document.getElementById('toast');
  var muteEl = document.getElementById('mute');

  // The seed is an input to the run, not rule state. A share link pins it.
  var seed = null;
  try {
    var q = new URLSearchParams(window.location.search);
    seed = q.get('seed');
  } catch (e) { seed = null; }
  if (!seed) {
    var boot = (Date.now() ^ Math.floor(window.performance.now() * 1000)) >>> 0;
    seed = 'tide-' + boot.toString(36);
  }

  var game = S.createGame(seed);
  var g = game.model;
  var view = S.createView(canvas, game);
  var audio = S.createAudio();
  var input = null;

  var lockUntil = 0;          // human input pause during a pool-clear flourish
  var cerShown = false, cerArmed = 0;
  var hintsSeen = {};
  var toastUntil = 0;
  var lastTideCue = 1;

  /* ------------------------------------------------------------------ view */

  function fit() {
    var w = app.clientWidth || window.innerWidth;
    var h = app.clientHeight || window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.resize(w, h, dpr);
  }

  function render() {
    view.begin(window.performance.now());
    drainFx();
    view.draw();
  }

  /* -------------------------------------------------------------- reactions */

  function toast(text, ms) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    toastUntil = window.performance.now() + (ms || 3400);
  }

  function hint(key, text) {
    if (hintsSeen[key]) return;
    hintsSeen[key] = true;
    toast(text, 4200);
  }

  function drainFx() {
    var fx = game.takeFx();
    if (!fx.length) return;
    view.consume(fx);
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.t === 'open') {
        if (f.cells.length > 1) audio.ripple(Math.min(f.cells.length, 12));
        else audio.tick(f.num || 1);
        if (f.cells.length >= 3) hint('pennant', 'hold a shell to plant a pennant');
      } else if (f.t === 'sweep') {
        audio.sweep();
        if (f.cells.length > 1) audio.ripple(Math.min(f.cells.length, 12));
      } else if (f.t === 'flag') {
        audio.flag();
        hint('sweep', 'tap a matched number to sweep it');
      } else if (f.t === 'unflag') {
        audio.unflag();
      } else if (f.t === 'clear') {
        audio.clear();
        lockUntil = window.performance.now() + 850;
      } else if (f.t === 'sting') {
        audio.sting();
      } else if (f.t === 'end') {
        window.setTimeout(function () { audio.ceremony(); }, 700);
      }
    }
  }

  /* ---------------------------------------------------------------- actions */

  function perform(action) {
    var res = game.applyAction(action);
    if (!res.ok && action && action.type === 'sweep') {
      // teach the sweep instead of silently refusing it
      var i = action.y * g.w + action.x;
      if (g.disp[i] <= 8 && g.disp[i] > 0) toast('pennants do not match that number', 1800);
    }
    return res;
  }

  var hooks = {
    perform: function (action) {
      var res = perform(action);
      if (res.ok) render();
      return res;
    },
    blocked: function () {
      return g.phase === 'ended' || window.performance.now() < lockUntil;
    },
    wake: function () { audio.start(); },
    nudge: function (i) { toast('lift the pennant first - hold it', 1800); },
    restart: function () { doRestart(); },
    toggleMute: function () { setMuted(audio.toggle()); }
  };

  function doRestart() {
    game.restart();
    cerShown = false;
    cerEl.classList.add('hidden');
    lockUntil = 0;
    view.layout();
    render();
  }

  /* --------------------------------------------------------------- overlays */

  function buildLadder(rank) {
    var ladder = S.RANKS;
    var out = '';
    for (var i = 0; i < ladder.length; i++) {
      var on = ladder[i].name === rank;
      out += '<span class="rung' + (on ? ' on' : '') + '">' + ladder[i].name + '</span>';
    }
    return out;
  }

  function showCeremony() {
    var s = game.state();
    document.getElementById('cerPearls').textContent = s.pearls;
    document.getElementById('cerRank').textContent = s.rank || '';
    document.getElementById('cerLadder').innerHTML = buildLadder(s.rank);
    document.getElementById('cerRipple').textContent = s.widestRipple;
    document.getElementById('cerPool').textContent = s.deepestPool;
    document.getElementById('cerShells').textContent = s.shellsTurned;
    var fresh = s.attempt > 1 && s.pearls >= s.sessionBest && s.pearls > 0;
    var flagEl = document.getElementById('cerFlag');
    flagEl.textContent = fresh ? 'a new session best' : 'session best ' + s.sessionBest;
    flagEl.classList.toggle('fresh', fresh);
    cerEl.classList.remove('hidden');
    cerShown = true;
    cerArmed = window.performance.now() + 900;
  }

  cerEl.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (window.performance.now() < cerArmed) return;
    audio.start();
    doRestart();
  });

  function setMuted(m) {
    muteEl.textContent = m ? 'sound off' : 'sound on';
    muteEl.setAttribute('aria-pressed', m ? 'true' : 'false');
  }
  muteEl.addEventListener('click', function (e) {
    e.stopPropagation();
    audio.start();
    setMuted(audio.toggle());
  });

  function syncOverlays(now) {
    // title: the pool is already running behind it
    var ready = g.phase === 'ready' && !g.firstTurnDone && g.pool === 1;
    titleEl.classList.toggle('gone', !ready);

    if (g.phase === 'ended' && !cerShown && view.stingAge() > 850) showCeremony();
    if (g.phase !== 'ended' && cerShown) { cerShown = false; cerEl.classList.add('hidden'); }

    if (toastUntil && now > toastUntil) { toastEl.classList.remove('show'); toastUntil = 0; }
  }

  /* ------------------------------------------------------------------ loop */

  var last = 0;
  function frame(now) {
    if (!last) last = now;
    var dt = now - last;
    last = now;
    if (dt > 250) dt = 250;              // a backgrounded tab must not dump tide

    game.advance(dt);
    if (input) input.frame(now);
    view.setCursor(input ? input.cursor() : -1, input ? input.cursor() >= 0 : false);

    view.begin(now);
    drainFx();
    view.draw();
    syncOverlays(now);

    var frac = game.tideFraction();
    if (Math.abs(frac - lastTideCue) > 0.02) {
      lastTideCue = frac;
      audio.tide(frac, g.phase === 'playing');
    }
    window.requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------- runtime interface */

  window.__ARENA_GAME__ = {
    reset: function (s) {
      game.reset(s);
      cerShown = false;
      cerEl.classList.add('hidden');
      lockUntil = 0;
      view.layout();
      render();
      return game.snapshot();
    },
    snapshot: function () { return game.snapshot(); },
    act: function (action) {
      var res = game.applyAction(action);
      if (res.ok) render();
      return game.snapshot();
    },
    restart: function () {
      doRestart();
      return game.snapshot();
    },
    advance: function (ms) {
      game.advance(ms);
      return game.snapshot();
    }
  };

  S.createBridge({
    state: function () { return game.state(); },
    revision: function () { return g.revision; },
    perform: function (action) { return game.applyAction(action); },
    restart: function () { doRestart(); },
    render: render
  });

  /* ------------------------------------------------------------------ boot */

  fit();
  input = S.createInput(canvas, view, game, hooks);
  setMuted(false);

  if (window.ResizeObserver) {
    new ResizeObserver(function () { fit(); }).observe(app);
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () { window.setTimeout(fit, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  window.requestAnimationFrame(frame);
})();
