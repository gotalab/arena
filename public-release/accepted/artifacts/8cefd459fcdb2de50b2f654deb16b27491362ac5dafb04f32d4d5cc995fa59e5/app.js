(function () {
  'use strict';

  var STORAGE_KEY = 'lumenyard.save.v1';

  function safeLoad() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function safeSave(data) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // No persistence available; the game stays fully playable this session.
    }
  }

  var initialSaved = safeLoad();

  var engine = new LumenEngine({
    persist: safeSave,
    load: function () { return initialSaved; }
  });

  if (!initialSaved) {
    var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    engine.setSettings({ motion: !prefersReduced });
  }

  var els = {
    hud: document.getElementById('hud'),
    boardName: document.getElementById('board-name'),
    statMoves: document.getElementById('stat-moves'),
    statPushes: document.getElementById('stat-pushes'),
    statPower: document.getElementById('stat-power'),
    stageWrap: document.getElementById('stage-wrap'),
    canvas: document.getElementById('stage'),
    invitation: document.getElementById('invitation'),
    completionPanel: document.getElementById('completion-panel'),
    liveRegion: document.getElementById('live-region'),
    btnUndo: document.getElementById('btn-undo'),
    btnRestart: document.getElementById('btn-restart'),
    btnBoards: document.getElementById('btn-boards'),
    btnSettings: document.getElementById('btn-settings'),
    scrim: document.getElementById('scrim'),
    drawerBoards: document.getElementById('drawer-boards'),
    drawerSettings: document.getElementById('drawer-settings'),
    closeBoards: document.getElementById('close-boards'),
    closeSettings: document.getElementById('close-settings'),
    boardGrid: document.getElementById('board-grid'),
    toggleSound: document.getElementById('toggle-sound'),
    toggleMotion: document.getElementById('toggle-motion')
  };

  var renderer = new LumenRenderer(els.canvas);
  var audio = new LumenAudio();
  audio.setEnabled(engine.campaign.settings.sound);
  renderer.setMotion(engine.campaign.settings.motion);
  renderer.loadLevel(engine.getState());

  var hasActed = false;

  function nextLevelId(id) {
    var idx = LumenLevels.order.indexOf(id);
    if (idx === -1 || idx >= LumenLevels.order.length - 1) return null;
    return LumenLevels.order[idx + 1];
  }

  function completionVariant(state) {
    if (state.levelId === 'black-start') return 'chapter';
    if (state.levelId === 'dawn-sequence') {
      return engine.campaignSummary().allRestored ? 'campaign' : 'earlyDawn';
    }
    return 'normal';
  }

  function makeButton(label, onClick, primary) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (!primary) b.className = 'secondary';
    b.addEventListener('click', onClick);
    return b;
  }

  function hideCompletion() {
    els.completionPanel.hidden = true;
    els.completionPanel.className = '';
    els.completionPanel.innerHTML = '';
  }

  function showCompletion(variant, state) {
    var panel = els.completionPanel;
    panel.innerHTML = '';
    panel.hidden = false;

    var card = document.createElement('div');
    card.className = 'cp-card';
    var h2 = document.createElement('h2');
    var p = document.createElement('p');
    var actions = document.createElement('div');
    actions.className = 'cp-actions';

    var best = engine.campaign.bestMoves.get(state.levelId);

    if (variant === 'normal') {
      panel.className = 'mode-banner';
      h2.textContent = LumenLevels.displayName(state.levelId) + ' Restored';
      if (best === state.moveCount) {
        p.textContent = state.moveCount + ' moves — new best.';
      } else if (best !== undefined) {
        p.textContent = state.moveCount + ' moves — best ' + best + '.';
      } else {
        p.textContent = state.moveCount + ' moves.';
      }
      actions.appendChild(makeButton('Replay', function () { dispatchRestart({ source: 'ui' }); }));
      var nid = nextLevelId(state.levelId);
      if (nid) {
        actions.appendChild(makeButton('Next Board', function () {
          dispatch({ type: 'select_level', levelId: nid }, { source: 'ui' });
        }, true));
      }
    } else if (variant === 'chapter') {
      panel.className = 'mode-full';
      h2.textContent = 'GRID RESTORED';
      p.textContent = 'Three relays answered together. The yard’s first chapter is complete.';
      actions.appendChild(makeButton('Replay', function () { dispatchRestart({ source: 'ui' }); }));
      actions.appendChild(makeButton('Continue', function () {
        dispatch({ type: 'select_level', levelId: 'split-bus' }, { source: 'ui' });
      }, true));
    } else if (variant === 'earlyDawn') {
      panel.className = 'mode-full';
      var summary = engine.campaignSummary();
      var remaining = summary.totalBoards - summary.restoredCount;
      h2.textContent = 'FIRST DAWN';
      p.textContent = 'The horizon yard is lit, but ' + remaining + ' of ' + summary.totalBoards +
        ' circuits across the site are still dark. Restore them to finish the campaign.';
      actions.appendChild(makeButton('Replay', function () { dispatchRestart({ source: 'ui' }); }));
      actions.appendChild(makeButton('Board Map', function () { openBoardsDrawer(); }, true));
    } else if (variant === 'campaign') {
      panel.className = 'mode-full';
      var summary2 = engine.campaignSummary();
      h2.textContent = 'CAMPAIGN COMPLETE';
      p.textContent = summary2.restoredCount + '/' + summary2.totalBoards + ' restored · total best moves ' +
        summary2.totalBestMoves + '. Thank you for standing the night watch — the Lumen Yard crew can rest.';
      actions.appendChild(makeButton('Replay', function () { dispatchRestart({ source: 'ui' }); }));
      actions.appendChild(makeButton('Board Map', function () { openBoardsDrawer(); }, true));
    }

    card.appendChild(h2);
    card.appendChild(p);
    card.appendChild(actions);
    panel.appendChild(card);
  }

  function buildBoardGrid() {
    var state = engine.getState();
    els.boardGrid.innerHTML = '';
    LumenLevels.order.forEach(function (id, idx) {
      var isCurrent = id === state.levelId;
      var isDone = engine.campaign.completed.has(id);
      var btn = document.createElement('button');
      btn.className = 'board-tile' + (isCurrent ? ' current' : '') + (isDone ? ' completed' : '');
      if (isCurrent) btn.setAttribute('aria-current', 'true');

      var name = document.createElement('div');
      name.className = 'b-name';
      name.textContent = (idx + 1) + '. ' + LumenLevels.displayName(id);

      var meta = document.createElement('div');
      meta.className = 'b-meta';
      if (isDone) {
        var check = document.createElement('span');
        check.className = 'b-check';
        check.textContent = '✓ Restored';
        meta.appendChild(check);
        meta.appendChild(document.createTextNode(' · Best ' + engine.campaign.bestMoves.get(id) + ' moves'));
      } else {
        meta.textContent = 'Not yet restored';
      }

      btn.appendChild(name);
      btn.appendChild(meta);
      btn.addEventListener('click', function () {
        closeDrawers();
        dispatch({ type: 'select_level', levelId: id }, { source: 'ui' });
      });
      els.boardGrid.appendChild(btn);
    });
  }

  function updateHud(state) {
    els.boardName.textContent = LumenLevels.displayName(state.levelId);
    els.statMoves.textContent = String(state.moveCount);
    els.statPushes.textContent = String(state.pushCount);
    els.statPower.textContent = state.poweredGoals + '/' + state.goals.length;
    els.btnUndo.disabled = !state.undoAvailable;
  }

  function announce(text) {
    els.liveRegion.textContent = text;
  }

  // ---- drawers -----------------------------------------------------

  var lastFocused = null;

  function openDrawer(drawer, trigger) {
    closeDrawers();
    lastFocused = document.activeElement;
    els.scrim.hidden = false;
    drawer.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    var focusable = drawer.querySelector('button, [tabindex]');
    if (focusable) focusable.focus();
  }

  function closeDrawers() {
    var wasOpen = !els.drawerBoards.hidden || !els.drawerSettings.hidden;
    els.drawerBoards.hidden = true;
    els.drawerSettings.hidden = true;
    els.scrim.hidden = true;
    els.btnBoards.setAttribute('aria-expanded', 'false');
    els.btnSettings.setAttribute('aria-expanded', 'false');
    if (wasOpen && lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function openBoardsDrawer() {
    buildBoardGrid();
    openDrawer(els.drawerBoards, els.btnBoards);
  }
  function openSettingsDrawer() {
    openDrawer(els.drawerSettings, els.btnSettings);
  }

  els.btnBoards.addEventListener('click', function () {
    if (!els.drawerBoards.hidden) { closeDrawers(); return; }
    openBoardsDrawer();
  });
  els.btnSettings.addEventListener('click', function () {
    if (!els.drawerSettings.hidden) { closeDrawers(); return; }
    openSettingsDrawer();
  });
  els.closeBoards.addEventListener('click', closeDrawers);
  els.closeSettings.addEventListener('click', closeDrawers);
  els.scrim.addEventListener('click', closeDrawers);

  function refreshSettingsUI() {
    var s = engine.campaign.settings;
    els.toggleSound.setAttribute('aria-pressed', s.sound ? 'true' : 'false');
    els.toggleSound.textContent = 'Sound: ' + (s.sound ? 'On' : 'Off');
    els.toggleMotion.setAttribute('aria-pressed', s.motion ? 'true' : 'false');
    els.toggleMotion.textContent = 'Motion: ' + (s.motion ? 'On' : 'Off');
  }
  els.toggleSound.addEventListener('click', function () {
    engine.setSettings({ sound: !engine.campaign.settings.sound });
    audio.setEnabled(engine.campaign.settings.sound);
    refreshSettingsUI();
  });
  els.toggleMotion.addEventListener('click', function () {
    engine.setSettings({ motion: !engine.campaign.settings.motion });
    renderer.setMotion(engine.campaign.settings.motion);
    refreshSettingsUI();
  });
  refreshSettingsUI();

  // ---- core dispatch -------------------------------------------------

  function hideInvitation() {
    if (!hasActed) {
      hasActed = true;
      els.invitation.classList.add('hidden');
    }
  }

  function onStateChange(prevState, newState, meta) {
    var animate = meta.animate !== false;
    var pushed = newState.pushCount > prevState.pushCount;
    renderer.applyState(prevState, newState, { animate: animate, pushed: pushed });

    if (meta.action) {
      if (meta.action.type === 'move') {
        if (pushed) audio.push(); else audio.step();
        if (newState.poweredGoals > prevState.poweredGoals && newState.phase !== 'complete') audio.socket();
      } else if (meta.action.type === 'undo') {
        audio.undo();
      } else if (meta.action.type === 'select_level') {
        audio.selectLevel();
      }
    }

    if (prevState.phase === 'playing' && newState.phase === 'complete') {
      var big = newState.levelId === 'black-start' || newState.levelId === 'dawn-sequence';
      audio.surge(big);
      showCompletion(completionVariant(newState), newState);
      announce(LumenLevels.displayName(newState.levelId) + ' restored. ' + newState.poweredGoals + ' of ' + newState.goals.length + ' sockets powered.');
    } else if (newState.phase === 'playing' && els.completionPanel.hidden === false) {
      hideCompletion();
    }

    if (meta.action && (meta.action.type === 'select_level' || meta.action.type === 'restart')) {
      hideCompletion();
    }

    updateHud(newState);
    if (!els.drawerBoards.hidden) buildBoardGrid();

    if (!meta.animate) {
      renderer.tick(performance.now());
    }
  }

  function dispatch(action, opts) {
    opts = opts || {};
    hideInvitation();
    if (opts.source !== 'api') audio.unlock();
    var prevState = engine.getState();
    var result = engine.attemptAction(action);
    if (!result.ok) {
      if (opts.source !== 'api') {
        if (action.type === 'move') renderer.flashBlocked(action.direction);
        audio.blocked();
      }
      return { ok: false, code: result.code, message: result.message, state: prevState };
    }
    var newState = engine.getState();
    onStateChange(prevState, newState, { action: action, animate: opts.animate !== false, source: opts.source });
    return { ok: true, state: newState };
  }

  function dispatchRestart(opts) {
    opts = opts || {};
    hideInvitation();
    if (opts.source !== 'api') audio.unlock();
    var prevState = engine.getState();
    engine.doRestart();
    var newState = engine.getState();
    onStateChange(prevState, newState, { action: { type: 'restart' }, animate: opts.animate !== false, source: opts.source });
    return newState;
  }

  els.btnUndo.addEventListener('click', function () { dispatch({ type: 'undo' }, { source: 'ui' }); });
  els.btnRestart.addEventListener('click', function () { dispatchRestart({ source: 'ui' }); });

  // ---- input wiring ----------------------------------------------------

  var controller = {
    canvas: els.canvas,
    renderer: renderer,
    getState: function () { return engine.getState(); },
    dispatch: dispatch,
    dispatchRestart: dispatchRestart,
    primeAudio: function () { audio.unlock(); },
    isTypingTarget: function (el) {
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    },
    onEscape: function () { closeDrawers(); },
    isModalOpen: function () { return !els.drawerBoards.hidden || !els.drawerSettings.hidden; },
    onGamepadPrimary: function () {
      var active = document.activeElement;
      if (active && typeof active.click === 'function' &&
        (els.drawerBoards.contains(active) || els.drawerSettings.contains(active) || els.completionPanel.contains(active))) {
        active.click();
        return;
      }
      if (!els.completionPanel.hidden) {
        var primaryBtn = els.completionPanel.querySelector('button:not(.secondary)');
        if (primaryBtn) primaryBtn.click();
      }
    },
    onGamepadStart: function () {
      if (!els.completionPanel.hidden) {
        var btn = els.completionPanel.querySelector('button');
        if (btn) { btn.click(); return; }
      }
      if (!els.drawerBoards.hidden || !els.drawerSettings.hidden) { closeDrawers(); return; }
      openBoardsDrawer();
    }
  };
  LumenInput.setup(controller);

  // ---- resize / render loop --------------------------------------------

  function resize() {
    var rect = els.stageWrap.getBoundingClientRect();
    renderer.resize(rect.width, rect.height);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(els.stageWrap);
  }
  resize();

  function loop(ts) {
    renderer.tick(ts);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  updateHud(engine.getState());

  // ---- window.__ARENA_GAME__ -------------------------------------------

  function apiError(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      var prev = engine.getState();
      engine.doReset(seed);
      var next = engine.getState();
      onStateChange(prev, next, { action: { type: 'reset' }, animate: false, source: 'api' });
      return next;
    },
    snapshot: function () {
      return engine.getState();
    },
    act: function (action) {
      var result = dispatch(action, { source: 'api', animate: false });
      if (!result.ok) throw apiError(result.code, result.message);
      return result.state;
    },
    restart: function () {
      return dispatchRestart({ source: 'api', animate: false });
    }
  };

  // ---- arena.game.v1 bridge --------------------------------------------

  var bridgeConnection = null;

  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.protocol !== 'arena.game.v1' || data.type !== 'connect') return;
    if (typeof data.sessionId !== 'string') return;
    if (!Number.isInteger(data.generation)) return;
    var port = ev.ports && ev.ports[0];
    if (!port) return;

    if (bridgeConnection && bridgeConnection.port) {
      try { bridgeConnection.port.close(); } catch (e) { /* already closed */ }
    }
    var conn = { port: port, sessionId: data.sessionId, generation: data.generation };
    bridgeConnection = conn;

    port.onmessage = function (reqEv) { handleBridgeRequest(conn, reqEv.data); };

    var state = engine.getState();
    port.postMessage({
      protocol: 'arena.game.v1',
      type: 'ready',
      sessionId: conn.sessionId,
      generation: conn.generation,
      accepted: true,
      revision: state.revision,
      state: state
    });
  });

  function handleBridgeRequest(conn, data) {
    if (bridgeConnection !== conn) return;
    if (!data || data.protocol !== 'arena.game.v1') return;
    if (data.sessionId !== conn.sessionId || data.generation !== conn.generation) return;

    var requestId = data.requestId;
    var command = data.command;

    function respond(accepted, error) {
      var state = engine.getState();
      var msg = {
        protocol: 'arena.game.v1',
        type: 'response',
        requestId: requestId,
        sessionId: conn.sessionId,
        generation: conn.generation,
        accepted: accepted,
        revision: state.revision,
        state: state
      };
      if (error) msg.error = error;
      conn.port.postMessage(msg);
    }

    if (command === 'observe') {
      respond(true);
      return;
    }

    if (command === 'act') {
      if (data.expectedRevision !== engine.revision) {
        respond(false, { code: 'stale_revision', message: 'expectedRevision does not match current revision.' });
        return;
      }
      var result = dispatch(data.action, { source: 'api', animate: false });
      if (!result.ok) {
        respond(false, { code: result.code, message: result.message });
        return;
      }
      respond(true);
      return;
    }

    if (command === 'restart') {
      if (data.expectedRevision !== engine.revision) {
        respond(false, { code: 'stale_revision', message: 'expectedRevision does not match current revision.' });
        return;
      }
      dispatchRestart({ source: 'api', animate: false });
      respond(true);
      return;
    }

    respond(false, { code: 'unknown_command', message: 'Unknown command: ' + command });
  }
})();
