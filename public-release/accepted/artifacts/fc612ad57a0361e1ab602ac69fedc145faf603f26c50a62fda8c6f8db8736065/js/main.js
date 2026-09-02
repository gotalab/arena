/* Lumen Yard — wiring: save/load, ceremony, and the single source of truth. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;
  var game = Lumen.game;
  var LEVEL_ORDER = Lumen.LEVEL_ORDER;
  var LEVEL_META = Lumen.LEVEL_META;

  var renderer = new Lumen.Renderer(root.document.getElementById('board'));
  var ui = Lumen.UI;
  var audio = Lumen.Audio;

  var SAVE_KEY = 'lumen-yard-save-v1';
  var save = load();
  var titleVisible = true;
  var cardToken = 0;
  var booted = false;

  function load() {
    var d = { best: {}, lastLevelId: 'first-light', sound: true, motion: null };
    try {
      var raw = root.localStorage.getItem(SAVE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          if (p.best && typeof p.best === 'object') d.best = p.best;
          if (typeof p.lastLevelId === 'string') d.lastLevelId = p.lastLevelId;
          if (typeof p.sound === 'boolean') d.sound = p.sound;
          if (typeof p.motion === 'boolean') d.motion = p.motion;
        }
      }
    } catch (e) {}
    return d;
  }

  function persist() {
    try { root.localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }

  function reducedMotion() {
    return save.motion != null
      ? save.motion
      : (root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  }

  function beginPlay() {
    if (titleVisible) {
      titleVisible = false;
      ui.hideTitle();
      audio.start();
    }
  }

  function capture() {
    return {
      player: { row: game.player.row, col: game.player.col },
      crates: new Set(game.crates),
    };
  }

  function layout() {
    if (!booted) return;
    renderer.layout(ui.el.stage.clientWidth, ui.el.stage.clientHeight, game);
  }

  function refreshUI() {
    ui.updateHUD(game, save);
    ui.updateGrid(game, save);
  }

  function renderNow() {
    if (!booted) return;
    cardToken++;
    ui.hideCompletion();
    renderer.resetFx();
    layout();
    renderer.render(game, { reducedMotion: reducedMotion() });
    refreshUI();
  }

  function doMove(dir) {
    beginPlay();
    var from = capture();
    var res;
    try {
      res = game.tryMove(dir);
    } catch (err) {
      renderer.blocked();
      audio.play('block');
      refreshUI();
      return;
    }
    renderer.animateTransition(from, capture(), { dir: dir, push: res.pushed, seated: res.seated, undo: false });
    renderer.robotFacing = dir;
    if (res.pushed) {
      if (res.seated) {
        audio.play('seatPush');
        var p = res.crateTo.split(',');
        renderer.seatFlash(+p[0], +p[1]);
      } else {
        audio.play('push');
      }
    } else {
      audio.play('step');
    }
    refreshUI();
    if (res.completed) onComplete(true);
  }

  function doUndo() {
    beginPlay();
    if (!game.history.length) return;
    var from = capture();
    var und = game.undo();
    var opp = { up: 'down', down: 'up', left: 'right', right: 'left' }[und.dir] || 'down';
    renderer.animateTransition(from, capture(), { dir: opp, push: false, undo: true });
    renderer.robotFacing = opp;
    audio.play('undo');
    hideCompletion();
    refreshUI();
  }

  function doRestart() {
    beginPlay();
    game.restart();
    renderer.resetFx();
    renderer.robotFacing = 'down';
    hideCompletion();
    audio.play('restart');
    refreshUI();
    ui.toast('Restarted ' + LEVEL_META[game.levelId].name);
  }

  function selectLevel(id) {
    if (!Lumen.LEVELS[id]) return;
    beginPlay();
    var changed = id !== game.levelId;
    game.selectLevel(id);
    if (changed) {
      save.lastLevelId = id;
      persist();
    }
    renderer.resetFx();
    renderer.robotFacing = 'down';
    hideCompletion();
    audio.play('select');
    refreshUI();
    if (changed) ui.toast('Now restoring: ' + LEVEL_META[id].name);
  }

  function completedCount() {
    var n = 0;
    for (var i = 0; i < LEVEL_ORDER.length; i++) {
      if (save.best[LEVEL_ORDER[i]] != null) n++;
    }
    return n;
  }

  function totalBest() {
    var s = 0;
    for (var i = 0; i < LEVEL_ORDER.length; i++) {
      var b = save.best[LEVEL_ORDER[i]];
      if (b != null) s += b;
    }
    return s;
  }

  function onComplete(fromHuman) {
    var id = game.levelId;
    var b = save.best[id];
    var isNewBest = b == null || game.moveCount < b;
    if (isNewBest) save.best[id] = game.moveCount;
    save.lastLevelId = id;
    persist();
    renderer.startSurge(reducedMotion());
    audio.play('surge');
    refreshUI();
    if (fromHuman) {
      audio.play('powered');
      var token = ++cardToken;
      var wait = (reducedMotion() ? 700 : 1500) + 160;
      setTimeout(function () {
        if (token !== cardToken) return;
        if (game.phase !== 'complete' || game.levelId !== id) return;
        showCompletionCard(id, isNewBest);
      }, wait);
    }
  }

  function hideCompletion() {
    cardToken++;
    ui.hideCompletion();
  }

  function showCompletionCard(id, isNewBest) {
    var idx = LEVEL_ORDER.indexOf(id);
    var meta = LEVEL_META[id];
    var moves = game.moveCount;
    var pushes = game.pushCount;
    var best = save.best[id];
    var allDone = completedCount() === LEVEL_ORDER.length;
    var next = LEVEL_ORDER[idx + 1];
    var replayBtn = { label: 'Replay', handler: function () { hideCompletion(); doRestart(); } };
    var mapBtn = { label: 'Board Map', class: 'btn-primary', handler: function () { hideCompletion(); ui.openDrawer(); } };
    var stats;
    var eyebrow, title, sub, className, actions, credit;

    if (idx === 2) {
      className = 'chapter';
      eyebrow = 'Chapter One Complete';
      title = 'GRID RESTORED';
      sub = 'The first circuit breathes again.' + (isNewBest ? ' A new best: ' + moves + ' moves.' : '');
      stats = [
        { label: 'Moves', value: moves },
        { label: 'Pushes', value: pushes },
        { label: 'Best', value: best != null ? best : '—' },
      ];
      actions = [
        { label: 'Continue', class: 'btn-primary', handler: function () { hideCompletion(); selectLevel(LEVEL_ORDER[3]); } },
        replayBtn,
        { label: 'Board Map', class: 'btn-ghost', handler: function () { hideCompletion(); ui.openDrawer(); } },
      ];
    } else if (idx === LEVEL_ORDER.length - 1) {
      if (allDone) {
        className = 'finale';
        eyebrow = 'Campaign Complete';
        title = 'THE YARD AWAKENS';
        sub = '20/20 circuits restored' + (isNewBest ? ' · new best!' : '');
        stats = [
          { label: 'Boards', value: '20/20' },
          { label: 'Total best', value: totalBest() },
          { label: 'Moves', value: moves },
        ];
        credit = '— with thanks to the yard crew —';
        actions = [replayBtn, mapBtn];
      } else {
        className = 'early';
        eyebrow = 'First Dawn';
        title = 'DAWN LIGHTS THE YARD';
        sub = (LEVEL_ORDER.length - completedCount()) + ' of ' + LEVEL_ORDER.length + ' circuits are still dark. Finish them all for the true dawn.';
        stats = [
          { label: 'Boards', value: completedCount() + '/' + LEVEL_ORDER.length },
          { label: 'Moves', value: moves },
          { label: 'Best', value: best != null ? best : '—' },
        ];
        actions = [mapBtn, replayBtn];
      }
    } else {
      eyebrow = 'Yard Restored';
      title = meta.name.toUpperCase();
      sub = 'All sockets powered' + (isNewBest ? ' · new best: ' + moves + ' moves' : '');
      stats = [
        { label: 'Moves', value: moves },
        { label: 'Pushes', value: pushes },
        { label: 'Best', value: best != null ? best : '—' },
      ];
      actions = [];
      if (next) actions.push({ label: 'Next Board', class: 'btn-primary', handler: function () { hideCompletion(); selectLevel(next); } });
      actions.push(replayBtn);
      actions.push({ label: 'View yard', class: 'btn-ghost', handler: hideCompletion });
    }

    ui.showCompletion({
      eyebrow: eyebrow,
      title: title,
      sub: sub,
      stats: stats,
      actions: actions,
      className: className,
      credit: credit,
    });
  }

  var main = {
    getSave: function () { return save; },
    beginPlay: beginPlay,
    doMove: doMove,
    doUndo: doUndo,
    doRestart: doRestart,
    selectLevel: selectLevel,
    hideCompletion: hideCompletion,
    refresh: renderNow,
    gamepadDir: doMove,
    gamepadPrimary: function () {
      if (ui.isDrawerOpen()) { ui.selectFocusedCell(); return; }
      var ae = root.document.activeElement;
      if (ae && ae.tagName === 'BUTTON') { ae.click(); return; }
      if (ui.isCompletionVisible()) { hideCompletion(); return; }
      doRestart();
    },
    gamepadSecondary: function () {
      if (ui.isDrawerOpen()) ui.closeDrawer();
      else if (ui.isSettingsOpen()) ui.closeSettings();
      else if (ui.isCompletionVisible()) hideCompletion();
      else doUndo();
    },
    gamepadStart: function () {
      if (ui.isDrawerOpen()) ui.closeDrawer();
      else ui.openDrawer();
    },
    init: function () {
      audio.enabled = save.sound;
      ui.init();
      booted = true;
      var returning = Object.keys(save.best).length > 0;
      var startId = save.lastLevelId || 'first-light';
      if (!Lumen.LEVELS[startId]) startId = 'first-light';
      game.startAt(startId);
      renderer.resetFx();
      layout();
      renderer.render(game, { reducedMotion: reducedMotion() });
      refreshUI();
      ui.showTitle({
        tag: returning ? 'The yard remembers.' : 'Restore the grid.',
        sub: returning ? 'Continue: ' + LEVEL_META[game.levelId].name : '',
      });
      titleVisible = true;
      ui.setSoundToggle(save.sound);
      ui.setMotionToggle(reducedMotion());
      ui.bindSettings({
        onSound: function (v) { save.sound = v; audio.enabled = v; persist(); },
        onMotion: function (v) { save.motion = v; persist(); },
      });
      Lumen.renderer = renderer;
      Lumen.Input.init();

      function loop() {
        renderer.render(game, { reducedMotion: reducedMotion() });
        root.requestAnimationFrame(loop);
      }
      root.requestAnimationFrame(loop);

      root.addEventListener('resize', layout);
      if (root.ResizeObserver) new root.ResizeObserver(layout).observe(ui.el.stage);
    },
  };

  Lumen.main = main;
})(typeof window !== 'undefined' ? window : globalThis);