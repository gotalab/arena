/* Lumen Yard - controller.
   Human input, window.__ARENA_GAME__ and the arena.game.v1 bridge all drive
   the one production engine below. Nothing here knows a solution. */
(function (global) {
  'use strict';

  var doc = global.document;
  var levels = global.LumenLevels.all;
  var LEVEL_IDS = global.LumenLevels.ids;

  var engine = new global.LumenEngine(levels);
  var store = new global.LumenStore();
  var audio = new global.LumenAudio();

  var el = {
    body: doc.body,
    app: doc.getElementById('app'),
    stage: doc.getElementById('stage'),
    canvas: doc.getElementById('yard'),
    hudIndex: doc.getElementById('hud-index'),
    hudName: doc.getElementById('hud-name'),
    sockets: doc.getElementById('stat-sockets'),
    socketsBox: doc.querySelector('.stat--sockets'),
    moves: doc.getElementById('stat-moves'),
    pushes: doc.getElementById('stat-pushes'),
    best: doc.getElementById('stat-best'),
    banner: doc.getElementById('banner'),
    bannerName: doc.getElementById('banner-name'),
    bannerLine: doc.getElementById('banner-line'),
    veil: doc.getElementById('veil'),
    result: doc.getElementById('result'),
    undo: doc.getElementById('btn-undo'),
    restart: doc.getElementById('btn-restart'),
    map: doc.getElementById('btn-map'),
    settings: doc.getElementById('btn-settings'),
    mapBadge: doc.getElementById('map-badge'),
    sheetMap: doc.getElementById('sheet-map'),
    sheetSettings: doc.getElementById('sheet-settings'),
    mapGrid: doc.getElementById('map-grid'),
    mapSub: doc.getElementById('map-sub'),
    toggleSound: doc.getElementById('toggle-sound'),
    toggleMotion: doc.getElementById('toggle-motion'),
    stateSound: doc.getElementById('state-sound'),
    stateMotion: doc.getElementById('state-motion'),
    saveNote: doc.getElementById('save-note'),
    live: doc.getElementById('live')
  };

  var renderer = new global.LumenRenderer(el.canvas);

  var prefs = {
    sound: store.data.sound === null ? true : store.data.sound,
    motion: store.data.motion === null
      ? !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches)
      : store.data.motion
  };

  var ui = {
    started: false,
    bannerTimer: 0,
    resultTimer: 0,
    openSheet: null,
    lastFocus: null,
    pendingHint: 0
  };

  /* ------------------------------------------------------------- helpers */

  function levelOf(id) { return global.LumenLevels.byId(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) { deepFreeze(value[k]); });
      Object.freeze(value);
    }
    return value;
  }

  function announce(text) {
    if (el.live.textContent === text) el.live.textContent = '';
    el.live.textContent = text;
  }

  function bump(node) {
    if (!node) return;
    node.classList.remove('is-bumped');
    // reflow so the animation can restart
    void node.offsetWidth;
    node.classList.add('is-bumped');
    global.setTimeout(function () { node.classList.remove('is-bumped'); }, 420);
  }

  /* --------------------------------------------------------- presentation */

  function describeBoard(state) {
    var lvl = levelOf(state.levelId);
    return 'Board ' + (lvl.index + 1) + ' of 20, ' + lvl.name + '. Robot at row ' +
      (state.player.row + 1) + ', column ' + (state.player.col + 1) + '. ' +
      state.poweredGoals + ' of ' + state.goals.length + ' sockets powered. ' +
      state.moveCount + ' moves, ' + state.pushCount + ' pushes.' +
      (state.phase === 'complete' ? ' Board complete.' : '');
  }

  function updateHud(state, changed) {
    var lvl = levelOf(state.levelId);
    el.hudIndex.textContent = pad2(lvl.index + 1);
    el.hudName.textContent = lvl.name;
    el.sockets.textContent = state.poweredGoals + '/' + state.goals.length;
    el.socketsBox.classList.toggle('is-full', state.poweredGoals === state.goals.length);
    el.moves.textContent = state.moveCount;
    el.pushes.textContent = state.pushCount;
    var best = store.best(state.levelId);
    el.best.textContent = best === null ? '—' : best;
    el.undo.disabled = !state.undoAvailable;
    el.mapBadge.textContent = store.restoredCount(LEVEL_IDS) + '/20';
    el.canvas.setAttribute('aria-label', describeBoard(state));
    if (changed === 'sockets') bump(el.socketsBox);
  }

  function showBanner(lvl) {
    el.bannerName.textContent = pad2(lvl.index + 1) + ' · ' + lvl.name;
    el.bannerLine.textContent = lvl.line;
    el.banner.classList.add('is-shown');
    global.clearTimeout(ui.bannerTimer);
    ui.bannerTimer = global.setTimeout(function () {
      el.banner.classList.remove('is-shown');
    }, 2400);
  }

  function hideResult() {
    global.clearTimeout(ui.resultTimer);
    el.result.hidden = true;
    el.result.classList.remove('is-full');
    el.result.innerHTML = '';
  }

  /* --------------------------------------------------------------- endings */

  function campaignComplete() {
    return store.restoredCount(LEVEL_IDS) === 20 && store.isRestored('dawn-sequence');
  }

  function nextDarkBoard(fromId) {
    var start = levelOf(fromId).index;
    for (var i = 1; i <= levels.length; i++) {
      var lvl = levels[(start + i) % levels.length];
      if (!store.isRestored(lvl.id)) return lvl;
    }
    return null;
  }

  function actionButton(label, kind, primary) {
    return '<button class="action' + (primary ? ' action--primary' : '') + '" type="button" data-do="' + kind + '">' + label + '</button>';
  }

  function figure(k, v, record) {
    return '<span class="figure' + (record ? ' is-record' : '') + '"><span class="figure-k">' + k +
      '</span><span class="figure-v">' + v + '</span></span>';
  }

  function buildResult(state, record) {
    var lvl = levelOf(state.levelId);
    var best = store.best(state.levelId);
    var full = false;
    var html = '';
    var kicker, title, body, figures, actions, credit = '';

    var figs = figure('Moves', state.moveCount, record.improved || record.firstTime) +
      figure('Pushes', state.pushCount) +
      figure('Best', best === null ? '—' : best);

    // The finale belongs to the dawn, or to the push that finished the last
    // dark circuit - not to every board completed afterwards.
    if (campaignComplete() && (record.newlyCampaign || lvl.id === 'dawn-sequence')) {
      full = true;
      kicker = '20 / 20 circuits restored';
      title = 'The yard is awake';
      body = 'Every relay is seated and the whole yard is drawing current. Light runs past the fence, into the greenhouse rows, and on into the morning.';
      figures = figure('Restored', '20/20') + figure('Total best moves', store.totalBest(LEVEL_IDS));
      actions = actionButton('Replay this board', 'replay', true) + actionButton('Board map', 'map');
      credit = '<p class="credit">Yard crew &mdash; night shift design &amp; light: Vela Ostrom · relay sound: Juno Rask · the small robot answers to Pim. Thank you for staying until dawn.</p>';
    } else if (lvl.id === 'black-start') {
      full = true;
      kicker = 'Chapter one complete';
      title = 'Grid restored';
      body = 'Three relays, one shared floor, and the yard has a heartbeat again. The switchgear beyond the fence is still cold — the split bus is next.';
      figures = figs;
      actions = actionButton('Continue to Split Bus', 'next', true) +
        actionButton('Replay', 'replay') + actionButton('Board map', 'map');
    } else if (lvl.id === 'dawn-sequence') {
      full = true;
      var dark = 20 - store.restoredCount(LEVEL_IDS);
      var target = nextDarkBoard(lvl.id);
      kicker = 'Dawn sequence restored';
      title = 'The dawn still waits';
      body = 'This circuit is live, but ' + dark + ' ' + (dark === 1 ? 'board is' : 'boards are') +
        ' still dark. The yard cannot wake on one line alone.';
      figures = figs + figure('Still dark', dark);
      actions = (target ? actionButton('Go to ' + target.name, 'goto:' + target.id, true) : '') +
        actionButton('Replay', 'replay') + actionButton('Board map', 'map');
    } else {
      kicker = record.firstTime ? 'Circuit restored' : (record.improved ? 'New best route' : 'Circuit live');
      title = lvl.name + ' is powered';
      body = '';
      figures = figs;
      var nextLvl = levels[Math.min(lvl.index + 1, levels.length - 1)];
      actions = actionButton('Next board · ' + nextLvl.name, 'next', true) +
        actionButton('Replay', 'replay') + actionButton('Board map', 'map');
    }

    html = '<div class="result-card">' +
      '<span class="result-kicker">' + kicker + '</span>' +
      '<h2 class="result-title" id="result-title">' + title + '</h2>' +
      (body ? '<p class="result-body">' + body + '</p>' : '') +
      '<div class="result-figures">' + figures + '</div>' +
      '<div class="result-actions">' + actions + '</div>' +
      credit +
      '<button class="ghost" type="button" data-do="dismiss">View the yard</button>' +
      '</div>';

    el.result.innerHTML = html;
    el.result.classList.toggle('is-full', full);
    el.result.hidden = false;

    var first = el.result.querySelector('.action--primary') || el.result.querySelector('.action');
    if (first) first.focus({ preventScroll: true });
  }

  el.result.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-do]') : null;
    if (!btn) return;
    var todo = btn.getAttribute('data-do');
    audio.play('ui');
    if (todo === 'replay') {
      doRestart('human');
    } else if (todo === 'next') {
      var lvl = levelOf(engine.level.id);
      var target = lvl.id === 'black-start'
        ? levelOf('split-bus')
        : levels[Math.min(lvl.index + 1, levels.length - 1)];
      applyAction({ type: 'select_level', levelId: target.id }, 'human');
    } else if (todo === 'map') {
      openSheet('map');
    } else if (todo === 'dismiss') {
      hideResult();
      announce('Showing the powered yard. The board stays complete.');
    } else if (todo.indexOf('goto:') === 0) {
      applyAction({ type: 'select_level', levelId: todo.slice(5) }, 'human');
    }
  });

  /* ---------------------------------------------------------- the loop */

  function onLevelStarted(source) {
    var state = engine.state();
    var lvl = levelOf(state.levelId);
    renderer.setLevel(lvl, state);
    renderer.setDawnWarm(lvl.id === 'dawn-sequence' && campaignComplete() ? 1 : 0);
    hideResult();
    store.setLastLevel(lvl.id);
    updateHud(state);
    if (ui.started) showBanner(lvl);
    announce(describeBoard(state));
    if (source === 'arena') renderer.draw(now());
  }

  function handleCompletion(state, delay) {
    var wasCampaign = campaignComplete();
    var record = store.recordCompletion(state.levelId, state.moveCount);
    record.newlyCampaign = !wasCampaign && campaignComplete();
    var lvl = levelOf(state.levelId);
    var finale = campaignComplete() && (record.newlyCampaign || lvl.id === 'dawn-sequence');
    renderer.setDawnWarm(finale ? 1 : 0);
    updateHud(state, 'sockets');
    global.setTimeout(function () { audio.play('surge'); }, Math.max(0, delay - 40));
    if (finale || lvl.id === 'black-start') {
      global.setTimeout(function () { audio.play('chapter'); }, delay + 620);
    }
    global.clearTimeout(ui.resultTimer);
    ui.resultTimer = global.setTimeout(function () {
      // Only present the ending if the board is still complete (undo may have
      // rewound the last push in the meantime).
      if (engine.phase === 'complete') buildResult(engine.state(), record);
    }, delay + (prefs.motion ? 1150 : 420));
    announce(finale
      ? 'The yard is awake. All twenty circuits restored.'
      : lvl.name + ' restored in ' + state.moveCount + ' moves.');
  }

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  /* The single path every accepted mutation travels. */
  function applyAction(action, source) {
    var event = engine.apply(action);
    var state = engine.state();
    var instant = source === 'arena';

    if (event.kind === 'select_level') {
      dismissVeil();
      onLevelStarted(source);
      audio.play('open');
      return state;
    }

    dismissVeil();
    if (el.result.hidden === false && event.kind === 'undo') hideResult();

    var dur = renderer.sync(state, event, instant);

    if (event.kind === 'move') {
      audio.play(event.push ? 'push' : 'step');
      if (event.unseated) audio.play('unseat');
      if (event.seated && event.seated.length) {
        global.setTimeout(function () { audio.play('seat'); }, Math.max(0, dur - 30));
        if (!event.completed) {
          announce('Relay seated. ' + state.poweredGoals + ' of ' + state.goals.length + ' sockets powered.');
        }
      }
      updateHud(state, event.seated && event.seated.length ? 'sockets' : null);
      if (event.completed) handleCompletion(state, dur);
    } else if (event.kind === 'undo') {
      audio.play('undo');
      updateHud(state);
      announce('Rewound one move.');
    }

    if (instant) {
      renderer.settle();
      renderer.draw(now());
    }
    return state;
  }

  function doRestart(source) {
    engine.restart();
    onLevelStarted(source);
    if (source !== 'arena') audio.play('restart');
    return engine.state();
  }

  /* ---------------------------------------------------------- human input */

  function dismissVeil() {
    if (ui.started) return;
    ui.started = true;
    el.veil.classList.add('is-gone');
    global.setTimeout(function () { el.veil.hidden = true; }, 460);
  }

  function beginPlay() {
    if (prefs.sound) audio.start();
    dismissVeil();
  }

  function humanMove(dir) {
    beginPlay();
    if (ui.openSheet) return;
    try {
      applyAction({ type: 'move', direction: dir }, 'human');
    } catch (err) {
      if (err.code === 'blocked') {
        renderer.refuse(dir, engine.player.row, engine.player.col);
        audio.play('blocked');
        announce('Blocked.');
      } else if (err.code === 'level_complete') {
        audio.play('blocked');
        announce('This board is powered. Undo, restart, or choose another board.');
        if (el.result.hidden && engine.phase === 'complete') {
          buildResult(engine.state(), { firstTime: false, improved: false });
        }
      }
    }
  }

  function humanUndo() {
    beginPlay();
    try {
      applyAction({ type: 'undo' }, 'human');
    } catch (err) {
      audio.play('blocked');
      announce('Nothing to rewind.');
    }
  }

  function humanRestart() {
    beginPlay();
    doRestart('human');
  }

  /* Touch: swipe in a direction, or tap a neighbouring tile. */
  var ptr = null;

  el.stage.addEventListener('pointerdown', function (ev) {
    if (ui.openSheet) return;
    // The completion card owns its own pointers; everything else is the yard.
    if (!el.result.hidden && el.result.contains(ev.target)) return;
    ptr = {
      id: ev.pointerId,
      x0: ev.clientX, y0: ev.clientY,
      ax: ev.clientX, ay: ev.clientY,
      t0: now(), moved: false
    };
    try { el.stage.setPointerCapture(ev.pointerId); } catch (e) { /* capture is optional */ }
    beginPlay();
  });

  el.stage.addEventListener('pointermove', function (ev) {
    if (!ptr || ev.pointerId !== ptr.id) return;
    var threshold = Math.max(20, renderer.s * 0.45);
    var dx = ev.clientX - ptr.ax;
    var dy = ev.clientY - ptr.ay;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    var dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
    else dir = dy > 0 ? 'down' : 'up';
    ptr.ax = ev.clientX;
    ptr.ay = ev.clientY;
    ptr.moved = true;
    humanMove(dir);
  });

  function endPointer(ev) {
    if (!ptr || ev.pointerId !== ptr.id) return;
    var p = ptr;
    ptr = null;
    try { el.stage.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ }
    if (p.moved) return;
    if (now() - p.t0 > 700) return;
    var cell = renderer.cellFromPoint(ev.clientX, ev.clientY);
    if (!cell) return;
    var dr = cell.row - engine.player.row;
    var dc = cell.col - engine.player.col;
    if (Math.abs(dr) + Math.abs(dc) === 1) {
      humanMove(dr === -1 ? 'up' : dr === 1 ? 'down' : dc === -1 ? 'left' : 'right');
    } else if (Math.abs(dr) + Math.abs(dc) > 1) {
      hintNeighbours();
    }
  }

  el.stage.addEventListener('pointerup', endPointer);
  el.stage.addEventListener('pointercancel', function (ev) {
    if (ptr && ev.pointerId === ptr.id) ptr = null;
  });
  el.stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  el.stage.addEventListener('touchmove', function (ev) { ev.preventDefault(); }, { passive: false });

  /* Taps further away show which tiles the robot can actually reach. */
  function hintNeighbours() {
    var dirs = ['up', 'down', 'left', 'right'];
    var vectors = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    for (var i = 0; i < dirs.length; i++) {
      if (!engine.probe(dirs[i])) continue;
      var v = vectors[dirs[i]];
      var c = renderer.cellCenter(engine.player.row + v[0], engine.player.col + v[1]);
      renderer.effects.push({ type: 'ring', x: c.x, y: c.y, t0: now(), dur: 520 });
    }
    renderer.needsDraw = true;
  }

  el.veil.addEventListener('click', function () { beginPlay(); });

  var KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };

  doc.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var key = ev.key || '';

    if (key === 'Escape') {
      if (ui.openSheet) { ev.preventDefault(); closeSheet(); }
      else if (!el.result.hidden) { ev.preventDefault(); hideResult(); }
      return;
    }
    if (ui.openSheet) {
      if (key === 'Tab') {
        trapTab(ev);
      } else if (key.indexOf('Arrow') === 0) {
        ev.preventDefault();
        moveFocus(KEYS[key], sheetNode(ui.openSheet).querySelector('.sheet-panel'));
      }
      return;
    }

    if (KEYS[key]) {
      ev.preventDefault();
      humanMove(KEYS[key]);
      return;
    }
    if (key === 'u' || key === 'U' || key === 'Backspace') {
      ev.preventDefault();
      humanUndo();
      return;
    }
    if (key === 'r' || key === 'R') {
      ev.preventDefault();
      humanRestart();
      return;
    }
    if (key === 'm' || key === 'M') {
      ev.preventDefault();
      openSheet('map');
      return;
    }
    if ((key === 'Enter' || key === ' ') && !ui.started) {
      ev.preventDefault();
      beginPlay();
    }
  });

  el.undo.addEventListener('click', function () { humanUndo(); });
  el.restart.addEventListener('click', function () { humanRestart(); });
  el.map.addEventListener('click', function () { openSheet('map'); });
  el.settings.addEventListener('click', function () { openSheet('settings'); });

  /* ---------------------------------------------------------------- sheets */

  function sheetNode(name) { return name === 'map' ? el.sheetMap : el.sheetSettings; }
  function sheetOpener(name) { return name === 'map' ? el.map : el.settings; }

  function openSheet(name) {
    if (ui.openSheet === name) return;
    if (ui.openSheet) closeSheet();
    beginPlay();
    if (name === 'map') renderMap();
    var node = sheetNode(name);
    ui.lastFocus = doc.activeElement;
    node.hidden = false;
    ui.openSheet = name;
    sheetOpener(name).setAttribute('aria-expanded', 'true');
    audio.play('open');
    var target = node.querySelector('.map-card.is-current') || node.querySelector('button');
    if (target) target.focus({ preventScroll: true });
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
  }

  function closeSheet() {
    if (!ui.openSheet) return;
    var name = ui.openSheet;
    sheetNode(name).hidden = true;
    sheetOpener(name).setAttribute('aria-expanded', 'false');
    ui.openSheet = null;
    audio.play('ui');
    if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus({ preventScroll: true });
    ui.lastFocus = null;
  }

  function trapTab(ev) {
    var node = sheetNode(ui.openSheet).querySelector('.sheet-panel');
    var items = node.querySelectorAll('button:not(:disabled)');
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (ev.shiftKey && doc.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && doc.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  doc.addEventListener('click', function (ev) {
    var closer = ev.target.closest ? ev.target.closest('[data-close]') : null;
    if (closer) closeSheet();
  });

  var BOLT = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5 5.5 13.5H11l-1 8 8-11.5h-5.5z"/></svg>';
  var RING = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>';

  function renderMap() {
    var currentId = engine.level.id;
    var restored = store.restoredCount(LEVEL_IDS);
    el.mapSub.textContent = restored + ' of 20 circuits restored' +
      (store.available ? '' : ' · not saved on this device');
    var html = '';
    for (var i = 0; i < levels.length; i++) {
      var lvl = levels[i];
      var isRestored = store.isRestored(lvl.id);
      var isCurrent = lvl.id === currentId;
      var best = store.best(lvl.id);
      var flag = isRestored
        ? '<span class="map-flag">' + BOLT + 'Restored</span>'
        : '<span class="map-flag map-flag--dark">' + RING + 'Dark</span>';
      html += '<button class="map-card' + (isRestored ? ' is-restored' : '') + (isCurrent ? ' is-current' : '') +
        '" type="button" data-level="' + lvl.id + '"' + (isCurrent ? ' aria-current="true"' : '') + '>' +
        '<span class="map-top"><span class="map-no">' + pad2(i + 1) + (isCurrent ? ' · NOW' : '') + '</span>' + flag + '</span>' +
        '<span class="map-name">' + lvl.name + '</span>' +
        '<span class="map-meta">' + (best === null ? 'No best yet' : 'Best ' + best + ' moves') +
        ' · ' + lvl.goals.length + ' sockets</span>' +
        '</button>';
    }
    el.mapGrid.innerHTML = html;
  }

  el.mapGrid.addEventListener('click', function (ev) {
    var card = ev.target.closest ? ev.target.closest('[data-level]') : null;
    if (!card) return;
    var id = card.getAttribute('data-level');
    closeSheet();
    applyAction({ type: 'select_level', levelId: id }, 'human');
  });

  /* -------------------------------------------------------------- settings */

  function applySound(on, save) {
    prefs.sound = on;
    audio.setEnabled(on);
    // Nothing is created until the player has actually touched the yard.
    if (on && ui.started) audio.start();
    el.toggleSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.stateSound.textContent = on ? 'On' : 'Off';
    if (save) store.setPref('sound', on);
  }

  function applyMotion(on, save) {
    prefs.motion = on;
    renderer.setMotion(on);
    el.body.classList.toggle('no-motion', !on);
    el.toggleMotion.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.stateMotion.textContent = on ? 'On' : 'Off';
    if (save) store.setPref('motion', on);
  }

  el.toggleSound.addEventListener('click', function () {
    applySound(!prefs.sound, true);
    audio.play('ui');
    announce('Sound ' + (prefs.sound ? 'on' : 'off') + '.');
  });

  el.toggleMotion.addEventListener('click', function () {
    applyMotion(!prefs.motion, true);
    audio.play('ui');
    announce('Motion ' + (prefs.motion ? 'on' : 'off') + '.');
  });

  /* -------------------------------------------------------------- gamepad */

  var pad = { dir: null, next: 0, buttons: {} };

  function pollGamepad(t) {
    if (!global.navigator || !global.navigator.getGamepads) return;
    var pads;
    try {
      pads = global.navigator.getGamepads() || [];
    } catch (e) {
      return;
    }
    var gp = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    if (!gp) { pad.dir = null; return; }

    var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    var b = gp.buttons;
    var dir = null;
    if ((b[12] && b[12].pressed) || ay < -0.55) dir = 'up';
    else if ((b[13] && b[13].pressed) || ay > 0.55) dir = 'down';
    else if ((b[14] && b[14].pressed) || ax < -0.55) dir = 'left';
    else if ((b[15] && b[15].pressed) || ax > 0.55) dir = 'right';

    function nudge(d) {
      if (ui.openSheet) moveFocus(d, sheetNode(ui.openSheet).querySelector('.sheet-panel'));
      else if (!el.result.hidden) moveFocus(d, el.result);
      else humanMove(d);
    }

    if (!dir) {
      pad.dir = null;
    } else if (dir !== pad.dir) {
      pad.dir = dir;
      pad.next = t + 300;
      nudge(dir);
    } else if (t >= pad.next) {
      pad.next = t + 150;
      nudge(dir);
    }

    function edge(index) {
      var pressed = !!(b[index] && b[index].pressed);
      var was = !!pad.buttons[index];
      pad.buttons[index] = pressed;
      return pressed && !was;
    }

    if (edge(0)) {
      beginPlay();
      var focused = doc.activeElement;
      if (focused && focused !== doc.body && focused.click) focused.click();
      else if (!el.result.hidden) {
        var primary = el.result.querySelector('.action--primary');
        if (primary) primary.click();
      }
    }
    if (edge(1)) { if (ui.openSheet) closeSheet(); else humanUndo(); }
    if (edge(8)) humanRestart();
    if (edge(9)) { if (ui.openSheet) closeSheet(); else openSheet('map'); }
  }

  function moveFocus(dir, node) {
    if (!node) return;
    var items = Array.prototype.slice.call(node.querySelectorAll('button:not(:disabled)'));
    if (!items.length) return;
    var idx = items.indexOf(doc.activeElement);
    var cols = ui.openSheet === 'map' ? Math.max(1, Math.round(el.mapGrid.clientWidth / 112)) : 1;
    var step = (dir === 'left') ? -1 : (dir === 'right') ? 1 : (dir === 'up') ? -cols : cols;
    var target = Math.min(items.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + step));
    items[target].focus({ preventScroll: true });
    if (items[target].scrollIntoView) items[target].scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------------------------------------- frame loop */

  function setViewportVar() {
    var h = (global.visualViewport && global.visualViewport.height) || global.innerHeight;
    doc.documentElement.style.setProperty('--vh', (h / 100) + 'px');
  }

  function frame(t) {
    // Queue the next frame first so one bad frame can never stop the yard.
    global.requestAnimationFrame(frame);
    renderer.draw(t);
    pollGamepad(t);
  }

  function handleResize() {
    setViewportVar();
    if (renderer.resize()) {
      renderer.draw(now());
    }
  }

  if (global.ResizeObserver) {
    new global.ResizeObserver(handleResize).observe(el.stage);
  }
  global.addEventListener('resize', handleResize);
  global.addEventListener('orientationchange', function () {
    global.setTimeout(handleResize, 120);
  });
  if (global.visualViewport) {
    global.visualViewport.addEventListener('resize', handleResize);
    global.visualViewport.addEventListener('scroll', setViewportVar);
  }
  doc.addEventListener('visibilitychange', function () {
    if (!doc.hidden) handleResize();
  });

  /* ------------------------------------------------------------ arena API */

  function validateAction(action) {
    if (!action || typeof action !== 'object') {
      throw Object.assign(new Error('An action object is required.'), { code: 'bad_action' });
    }
    if (action.type === 'move') {
      if (['up', 'down', 'left', 'right'].indexOf(action.direction) < 0) {
        throw Object.assign(new Error('Unknown direction.'), { code: 'bad_action' });
      }
      return;
    }
    if (action.type === 'undo') return;
    if (action.type === 'select_level') {
      if (LEVEL_IDS.indexOf(action.levelId) < 0) {
        throw Object.assign(new Error('Unknown board id.'), { code: 'unknown_level' });
      }
      return;
    }
    throw Object.assign(new Error('Unknown action type.'), { code: 'bad_action' });
  }

  function arenaAct(action, source) {
    validateAction(action);
    return applyAction(action, source || 'arena');
  }

  global.__ARENA_GAME__ = {
    reset: function (seed) {
      engine.reset(seed);
      onLevelStarted('arena');
      return deepFreeze(engine.state());
    },
    snapshot: function () {
      return deepFreeze(engine.state());
    },
    act: function (action) {
      return deepFreeze(arenaAct(action, 'arena'));
    },
    restart: function () {
      return deepFreeze(doRestart('arena'));
    }
  };

  global.LumenArena.install({
    revision: function () { return engine.revision; },
    state: function () { return engine.state(); },
    act: function (action, source) { return arenaAct(action, source); },
    restart: function (source) { return doRestart(source || 'arena'); }
  });

  /* ------------------------------------------------------------- boot up */

  applySound(prefs.sound, false);
  applyMotion(prefs.motion, false);
  if (!store.available) {
    el.saveNote.textContent = 'This browser is not saving progress; the game plays on without it.';
  }

  var startId = store.data.lastLevel && levelOf(store.data.lastLevel) ? store.data.lastLevel : LEVEL_IDS[0];
  if (startId !== engine.level.id) {
    engine.selectLevel(startId);
  }

  setViewportVar();
  onLevelStarted('boot');
  renderer.resize(true);
  el.body.classList.remove('booting');
  global.requestAnimationFrame(frame);
})(typeof window !== 'undefined' ? window : globalThis);
