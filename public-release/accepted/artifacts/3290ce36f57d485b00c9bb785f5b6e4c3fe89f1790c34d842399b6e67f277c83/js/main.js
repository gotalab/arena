/* SHOAL - the app shell.

   Boots the pool, keeps the HUD honest, runs the ceremony, and publishes the
   runtime interface. Every path in here funnels into SHOAL.game. */
(function (g) {
  'use strict';

  var S = g.SHOAL;
  var el = {};
  var running = false;
  var lastFrame = 0;
  var ceremony = { open: false, tapAt: 0, shown: 0, target: 0 };
  var hints = { pennant: false, sweep: false, nextCheck: 0 };
  var toastTimer = null, bannerTimer = null, endTimer = null;
  var hud = { pool: -1, urchins: -1, pearls: -1, best: -1, tide: -1, hush: false };

  function $(id) { return document.getElementById(id); }

  // The seed is chosen once, outside the rules, and everything downstream of
  // it is a pure function of that choice.
  function pickSeed() {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var out = '';
    for (var i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  /* ------------------------------------------------------------ chrome bits */

  // Feedback that repeats forever turns into nagging, so each message has a
  // small budget per attempt.
  var toastBudget = {};

  function toastOnce(key, text, budget) {
    var used = toastBudget[key] || 0;
    if (used >= (budget || 2)) return;
    toastBudget[key] = used + 1;
    toast(text);
  }

  function toast(text, force) {
    if (!text) return;
    el.toast.textContent = text;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, force ? 3200 : 2200);
  }

  function banner(big, sub, ms) {
    el.banner.innerHTML = '';
    var b = document.createElement('div');
    b.className = 'big';
    b.textContent = big;
    el.banner.appendChild(b);
    if (sub) {
      var s = document.createElement('div');
      s.className = 'sub';
      s.textContent = sub;
      el.banner.appendChild(s);
    }
    el.banner.classList.add('show');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { el.banner.classList.remove('show'); }, ms || 1700);
  }

  function bump(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  /* ------------------------------------------------------------------- HUD */

  function syncHud() {
    var st = S.game.state();
    if (st.pool !== hud.pool) { hud.pool = st.pool; el.poolVal.textContent = st.pool; bump(el.poolVal); }
    var left = st.urchinsTotal - st.flagsPlaced;
    if (left !== hud.urchins) {
      hud.urchins = left;
      el.urchinVal.textContent = left;
      // Over-pennanting is legal and the counter stays honest about it.
      el.urchinStat.classList.toggle('over', left < 0);
      bump(el.urchinVal);
    }
    if (st.pearls !== hud.pearls) { hud.pearls = st.pearls; el.pearlVal.textContent = st.pearls; bump(el.pearlVal); }
    var best = S.game.sessionBest();
    if (best !== hud.best) { hud.best = best; el.bestVal.textContent = best; }

    var tide = S.game.tideFraction();
    var pct = Math.round(tide * 1000) / 10;
    if (pct !== hud.tide) {
      hud.tide = pct;
      el.tideFill.style.width = pct + '%';
      el.tideFill.className = tide <= 0 ? 'out' : tide < 0.28 ? 'low' : '';
    }
    var wantHush = st.phase === 'playing' && st.firstTurnDone && tide < 0.28 && tide > 0;
    if (wantHush !== hud.hush) { hud.hush = wantHush; S.audio.hush(wantHush); }

    if (st.phase === 'ready') el.title.classList.add('show');
    else el.title.classList.remove('show');
  }

  /* ------------------------------------------------------------- ceremony */

  function openCeremony() {
    if (ceremony.open) return;
    var st = S.game.state();
    ceremony.open = true;
    ceremony.tapAt = nowMs() + 500; // a beat, so the fatal tap cannot restart
    ceremony.shown = 0;
    ceremony.target = st.pearls;

    el.cerRank.textContent = st.rank || S.game.RANK_LADDER[0];
    el.cerStatLabel.textContent = 'widest ripple';
    el.cerStat.textContent = st.stats.ripple + (st.stats.ripple === 1 ? ' shell' : ' shells');
    el.cerDepth.textContent = 'pool ' + st.stats.deepest;
    el.cerBest.textContent = S.game.sessionBest();

    var ladder = S.game.RANK_LADDER;
    var idx = ladder.indexOf(st.rank);
    el.cerLadder.innerHTML = '';
    for (var i = 0; i < ladder.length; i++) {
      var pip = document.createElement('i');
      if (i <= idx) pip.className = 'on';
      if (i === idx) pip.className = 'on cur';
      pip.title = ladder[i];
      el.cerLadder.appendChild(pip);
    }
    el.ceremony.classList.remove('hidden');
    var card = el.ceremony.firstElementChild;
    S.view.setCeremony(true, (card ? card.offsetHeight : 200) + 14);
    S.audio.ceremony();
  }

  function closeCeremony() {
    ceremony.open = false;
    el.ceremony.classList.add('hidden');
    S.view.setCeremony(false, 0);
  }

  function tickCeremony(dt) {
    if (!ceremony.open) return;
    if (ceremony.shown < ceremony.target) {
      var stepv = Math.max(1, Math.ceil(ceremony.target * dt * 1.4));
      ceremony.shown = Math.min(ceremony.target, ceremony.shown + stepv);
      el.cerPearls.textContent = ceremony.shown;
    } else if (el.cerPearls.textContent !== String(ceremony.target)) {
      el.cerPearls.textContent = ceremony.target;
    }
  }

  function nowMs() { return g.performance && g.performance.now ? g.performance.now() : Date.now(); }

  /* --------------------------------------------------------------- effects */

  function onGameEvent(ev) {
    if (ev.type === 'open') {
      if (ev.cells.length >= 4) S.audio.ripple(ev.cells.length);
      else if (ev.cells.length) S.audio.tick(ev.cells.length);
      if (ev.sweep) S.audio.sweep();
    } else if (ev.type === 'flag') {
      S.audio.flag(true);
    } else if (ev.type === 'unflag') {
      S.audio.flag(false);
    } else if (ev.type === 'sting') {
      S.audio.sting();
      if (endTimer) clearTimeout(endTimer);
      endTimer = setTimeout(openCeremony, 900);
    } else if (ev.type === 'clear') {
      S.audio.clear();
      banner('POOL ' + ev.pool + ' CLEARED', '+' + ev.bonus + ' pearls', 1800);
      setTimeout(function () {
        if (S.game.state().phase === 'playing') S.audio.poolStart();
      }, 900);
    } else if (ev.type === 'reset') {
      if (endTimer) clearTimeout(endTimer);
      closeCeremony();
      el.banner.classList.remove('show');
      el.toast.classList.remove('show');
      hud.pool = hud.urchins = hud.pearls = hud.best = hud.tide = -1;
      hints.nextCheck = 0;
      toastBudget = {};
      if (S.input && S.input.clear) S.input.clear();
    }
  }

  /* ----------------------------------------------------------------- hints
     The gesture set is revealed as it becomes useful, never as a manual. */

  function checkHints() {
    var t = nowMs();
    if (t < hints.nextCheck) return;
    hints.nextCheck = t + 600;
    var st = S.game.state();
    if (st.phase !== 'playing' || ceremony.open) return;

    if (!hints.pennant && st.firstTurnDone && st.flagsPlaced === 0) {
      var openCount = 0;
      for (var i = 0; i < st.open.length; i++) if (st.open[i]) openCount++;
      if (openCount >= 8 && st.moves >= 2) {
        hints.pennant = true;
        toast('hold a shell to plant a pennant', true);
        return;
      }
    }
    if (hints.pennant && !hints.sweep && st.flagsPlaced > 0) {
      var nb = S.gen.neighbors(st.w, st.h);
      for (var c = 0; c < st.open.length; c++) {
        if (!st.open[c] || st.val[c] <= 0) continue;
        var flags = 0, cov = 0;
        var L = nb[c];
        for (var k = 0; k < L.length; k++) {
          if (st.flag[L[k]]) flags++;
          else if (!st.open[L[k]]) cov++;
        }
        if (flags === st.val[c] && cov > 0) {
          hints.sweep = true;
          toast('tap a matched number to sweep it', true);
          return;
        }
      }
    }
  }

  /* ------------------------------------------------------------------ loop */

  function frame(t) {
    var dt = Math.min(250, t - lastFrame);
    lastFrame = t;
    S.game.advance(dt);
    S.input.tick();
    S.view.frame(dt);
    syncHud();
    tickCeremony(dt / 1000);
    checkHints();
    g.requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- layout */

  function fitViewport() {
    var vv = g.visualViewport;
    var h = vv ? vv.height : g.innerHeight;
    el.app.style.height = Math.max(200, Math.round(h)) + 'px';
    S.view.resize();
  }

  /* -------------------------------------------------------------- app hook */

  var app = {
    perform: function (action) {
      var res = S.game.act(action);
      if (!res.ok) {
        S.view.nudge(action.x, action.y);
        if (res.error.code === 'unsatisfied' || res.error.code === 'flagged') {
          toastOnce(res.error.code, res.error.message, 2);
        }
        return res;
      }
      app.renderNow();
      return res;
    },
    refuse: function (x, y, message) {
      S.view.nudge(x, y);
      if (message) toastOnce('refuse', message, 2);
    },
    wake: function () { S.audio.start(); },
    isCeremony: function () { return ceremony.open; },
    restart: function () {
      if (ceremony.open && nowMs() < ceremony.tapAt) return;
      S.game.restart();
      app.renderNow();
    },
    onRestart: function () { closeCeremony(); },
    afterAction: function () { },
    renderNow: function () {
      if (!running) return;
      syncHud();
      S.view.drawNow();
    }
  };
  S.app = app;

  // A pool exists from the moment the scripts load, so the runtime interface
  // and the bridge are usable before the DOM is ready.
  S.game.reset(pickSeed());

  /* ------------------------------------------------------------------ boot */

  function boot() {
    el.app = $('app');
    el.board = $('board');
    el.title = $('title');
    el.toast = $('toast');
    el.banner = $('banner');
    el.ceremony = $('ceremony');
    el.cerPearls = $('cerPearls');
    el.cerRank = $('cerRank');
    el.cerLadder = $('cerLadder');
    el.cerStat = $('cerStat');
    el.cerStatLabel = $('cerStatLabel');
    el.cerDepth = $('cerDepth');
    el.cerBest = $('cerBest');
    el.poolVal = $('poolVal');
    el.urchinVal = $('urchinVal');
    el.pearlVal = $('pearlVal');
    el.bestVal = $('bestVal');
    el.tideFill = $('tideFill');
    el.soundBtn = $('soundBtn');
    el.urchinStat = $('urchinStat');

    S.game.on(onGameEvent);
    S.view.init(el.board);
    S.input.init(el.board);
    running = true;

    fitViewport();
    g.addEventListener('resize', fitViewport);
    g.addEventListener('orientationchange', function () { setTimeout(fitViewport, 120); });
    if (g.visualViewport) {
      g.visualViewport.addEventListener('resize', fitViewport);
      g.visualViewport.addEventListener('scroll', fitViewport);
    }

    el.ceremony.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      app.restart();
    });

    el.soundBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      S.audio.start();
      var on = !S.audio.isOn();
      S.audio.setEnabled(on);
      el.soundBtn.classList.toggle('off', !on);
    });

    // Sound may only begin after the player has touched the game.
    var wakeOnce = function () {
      S.audio.start();
      g.removeEventListener('pointerdown', wakeOnce);
      g.removeEventListener('keydown', wakeOnce);
    };
    g.addEventListener('pointerdown', wakeOnce);
    g.addEventListener('keydown', wakeOnce);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) lastFrame = nowMs();
    });

    lastFrame = nowMs();
    g.requestAnimationFrame(frame);

    // The engine namespace is only wiring between this build's own scripts,
    // which captured it at load. Retracting it from the global object keeps
    // the pool's secrets equal for every reader: there is no path from
    // outside to a covered shell's contents.
    try { delete g.SHOAL; } catch (e) { g.SHOAL = undefined; }
  }

  // Geometry only: where a shell is drawn. It says nothing about what any
  // covered shell hides, and exists so the board can be driven at the pixel
  // level by automation the same way a thumb drives it.
  g.__SHOAL_CELL_RECT__ = function (x, y) {
    var r = S.view.cellRect(x, y);
    var c = el.board ? el.board.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: c.left + r.x, y: c.top + r.y, size: r.s };
  };

  /* -------------------------------------------------------- runtime interface */

  g.__ARENA_GAME__ = {
    reset: function (seed) {
      S.game.reset(seed);
      app.renderNow();
      return S.game.snapshot();
    },
    snapshot: function () {
      return S.game.snapshot();
    },
    act: function (action) {
      var res = S.game.act(action);
      if (res.ok) app.renderNow();
      return S.game.snapshot();
    },
    restart: function () {
      S.game.restart();
      app.renderNow();
      return S.game.snapshot();
    },
    advance: function (ms) {
      S.game.advance(ms);
      return S.game.snapshot();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
