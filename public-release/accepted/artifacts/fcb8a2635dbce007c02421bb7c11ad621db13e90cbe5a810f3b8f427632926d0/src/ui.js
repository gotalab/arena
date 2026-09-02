/* LUMEN YARD - shell, input and campaign memory. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});
  var doc = root.document;
  var SAVE_KEY = 'lumen-yard.save.v1';

  function $(id) { return doc.getElementById(id); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* ------------------------------------------------------------- storage */

  function defaultSave() {
    var prefers = false;
    try {
      prefers = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { prefers = false; }
    return { v: 1, best: {}, completed: {}, last: LY.LEVELS[0].id, sound: true, motion: !prefers };
  }

  function loadSave() {
    var base = defaultSave();
    try {
      var raw = root.localStorage.getItem(SAVE_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return base;
      if (parsed.best && typeof parsed.best === 'object') base.best = parsed.best;
      if (parsed.completed && typeof parsed.completed === 'object') base.completed = parsed.completed;
      if (typeof parsed.last === 'string' && LY.getLevel(parsed.last)) base.last = parsed.last;
      if (typeof parsed.sound === 'boolean') base.sound = parsed.sound;
      if (typeof parsed.motion === 'boolean') base.motion = parsed.motion;
    } catch (e) { /* private mode or no storage: play on without memory */ }
    return base;
  }

  function App() {
    this.save = loadSave();
    this.game = new LY.Game();
    this.audio = new LY.Audio();
    this.audio.setEnabled(this.save.sound);
    this.bannerTimer = 0;
    this.confirmWipe = false;
    this.lastOpener = null;
    this.gamepad = { dir: null, at: 0, buttons: {} };
    this.started = false;
  }

  App.prototype.persist = function () {
    try {
      root.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch (e) { /* keep playing without saved memory */ }
  };

  App.prototype.completedCount = function () {
    var n = 0;
    for (var i = 0; i < LY.LEVELS.length; i++) if (this.save.completed[LY.LEVELS[i].id]) n++;
    return n;
  };

  App.prototype.totalBest = function () {
    var t = 0;
    for (var i = 0; i < LY.LEVELS.length; i++) {
      var b = this.save.best[LY.LEVELS[i].id];
      if (typeof b === 'number') t += b;
    }
    return t;
  };

  App.prototype.allRestored = function () {
    return this.completedCount() === LY.LEVELS.length;
  };

  App.prototype.firstUnfinished = function () {
    for (var i = 0; i < LY.LEVELS.length; i++) {
      if (!this.save.completed[LY.LEVELS[i].id]) return LY.LEVELS[i];
    }
    return null;
  };

  /* ---------------------------------------------------------------- boot */

  App.prototype.mount = function () {
    var self = this;
    this.el = {
      app: $('app'),
      stage: $('stage'),
      canvas: $('yard'),
      boardNum: $('boardNum'),
      boardName: $('boardName'),
      boardNote: $('boardNote'),
      statMoves: $('statMoves'),
      statPushes: $('statPushes'),
      statSockets: $('statSockets'),
      statBest: $('statBest'),
      progressBar: $('progressBar'),
      btnUndo: $('btnUndo'),
      btnRestart: $('btnRestart'),
      btnMap: $('btnMap'),
      btnSettings: $('btnSettings'),
      titleCard: $('titleCard'),
      banner: $('banner'),
      bannerEyebrow: $('bannerEyebrow'),
      bannerTitle: $('bannerTitle'),
      bannerBody: $('bannerBody'),
      bannerStats: $('bannerStats'),
      bannerActions: $('bannerActions'),
      bannerCredit: $('bannerCredit'),
      sheetMap: $('sheetMap'),
      sheetSettings: $('sheetSettings'),
      scrim: $('scrim'),
      boardList: $('boardList'),
      mapProgress: $('mapProgress'),
      mapTotal: $('mapTotal'),
      toggleSound: $('toggleSound'),
      toggleMotion: $('toggleMotion'),
      btnWipe: $('btnWipe'),
      live: $('live')
    };

    this.renderer = new LY.Renderer(this.el.canvas, this.game);
    this.renderer.setMotion(this.save.motion);

    if (this.save.last && LY.getLevel(this.save.last) && this.save.last !== this.game.level.id) {
      this.game.selectLevel(this.save.last, { source: 'boot' });
      this.game.revision = 0;
      this.renderer.intro = true;
    }
    this.renderer.setDawn(this.allRestored());

    this.game.on(function (evt) { self.onGameEvent(evt); });

    LY.installArena(this.game, {
      renderNow: function () { self.renderer.draw(performance.now()); }
    });

    this.buildBoardList();
    this.bindControls();
    this.bindStageInput();
    this.bindKeys();
    this.syncSettingsUi();
    this.refresh();
    this.observeSize();
    this.loop();
  };

  App.prototype.observeSize = function () {
    var self = this;
    var apply = function () { self.renderer.resize(); self.renderer.draw(performance.now()); };
    apply();
    if (root.ResizeObserver) {
      var ro = new ResizeObserver(function () { apply(); });
      ro.observe(this.el.stage);
    }
    root.addEventListener('resize', apply);
    root.addEventListener('orientationchange', function () { setTimeout(apply, 120); });
    if (root.visualViewport) root.visualViewport.addEventListener('resize', apply);
  };

  App.prototype.loop = function () {
    var self = this;
    function tick(now) {
      if (!doc.hidden) {
        self.pollGamepad(now);
        self.renderer.draw(now);
      }
      root.requestAnimationFrame(tick);
    }
    root.requestAnimationFrame(tick);
  };

  /* -------------------------------------------------------------- events */

  App.prototype.onGameEvent = function (evt) {
    this.renderer.onEvent(evt);
    if (evt.type !== 'reset' && evt.type !== 'blocked') this.liftTitle();

    if (evt.type === 'move') {
      if (evt.plan.pushed) this.audio.push(); else this.audio.step();
      if (evt.plan.seats) this.audio.seat();
      else if (evt.plan.leaves) this.audio.unseat();
      if (evt.completed) this.onComplete(evt);
    } else if (evt.type === 'blocked') {
      this.audio.blocked();
      this.announce('Blocked.');
    } else if (evt.type === 'undo') {
      this.audio.undo();
      this.hideBanner();
      this.announce('Rewound one move.');
    } else if (evt.type === 'restart') {
      this.audio.restart();
      this.hideBanner();
      this.announce('Attempt restarted.');
    } else if (evt.type === 'level' || evt.type === 'reset') {
      this.hideBanner();
      this.save.last = this.game.level.id;
      this.persist();
      this.renderer.setDawn(this.allRestored());
      this.buildBoardList();
      this.announce(this.game.level.name + ' loaded. ' + this.game.level.note);
    }
    this.refresh();
  };

  App.prototype.onComplete = function () {
    var lv = this.game.level;
    var moves = this.game.moveCount;
    var prevBest = this.save.best[lv.id];
    var improved = typeof prevBest !== 'number' || moves < prevBest;
    this.save.completed[lv.id] = true;
    if (improved) this.save.best[lv.id] = moves;
    this.save.last = lv.id;
    this.persist();
    this.buildBoardList();

    var isFinal = lv.id === LY.FINAL_LEVEL;
    var isChapter = lv.id === LY.CHAPTER_ONE_END;
    var full = this.allRestored();
    this.renderer.setDawn(isFinal && full);

    this.audio.surge();
    if (isChapter || (isFinal && full)) {
      var self = this;
      setTimeout(function () { self.audio.chapter(); }, 900);
    }
    this.announce(lv.name + ' restored in ' + moves + ' moves.' + (improved ? ' New best.' : ''));

    var delay = this.save.motion ? 1150 : 450;
    var app = this;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(function () {
      app.showCompletionBanner({ improved: improved, prevBest: prevBest, moves: moves });
    }, delay);
  };

  /* -------------------------------------------------------------- actions */

  /* The invitation clears the moment the yard is played, whoever is playing.
     Audio still waits for a real gesture, so it never starts unasked. */
  App.prototype.liftTitle = function () {
    if (this.titleLifted) return;
    this.titleLifted = true;
    this.el.titleCard.classList.add('is-gone');
    this.renderer.intro = false;
  };

  App.prototype.begin = function () {
    this.liftTitle();
    if (!this.started) {
      this.started = true;
      this.audio.start();
      this.audio.setEnabled(this.save.sound);
    }
  };

  App.prototype.tryMove = function (dir) {
    this.begin();
    try {
      this.game.move(dir, { source: 'human' });
    } catch (e) {
      if (e && e.code === 'board_complete') {
        this.audio.blocked();
        this.announce('The yard is powered. Undo, restart or choose another board.');
      }
      // a blocked push has already refused on screen and in sound
    }
  };

  App.prototype.tryUndo = function () {
    this.begin();
    try {
      this.game.undo({ source: 'human' });
    } catch (e) {
      this.audio.blocked();
      this.announce('Nothing to rewind.');
    }
  };

  App.prototype.doRestart = function () {
    this.begin();
    this.game.restart({ source: 'human' });
  };

  App.prototype.doSelect = function (id) {
    this.begin();
    try {
      this.game.selectLevel(id, { source: 'human' });
    } catch (e) { /* unknown board never comes from our own UI */ }
  };

  /* -------------------------------------------------------------- refresh */

  App.prototype.refresh = function () {
    var g = this.game;
    var lv = g.level;
    var el = this.el;
    var total = lv.goals.length;
    var powered = g.poweredGoals();

    el.boardNum.textContent = pad2(lv.number);
    el.boardName.textContent = lv.name;
    el.boardNote.textContent = lv.note;
    el.statMoves.textContent = String(g.moveCount);
    el.statPushes.textContent = String(g.pushCount);
    el.statSockets.textContent = powered + '/' + total;
    var best = this.save.best[lv.id];
    el.statBest.textContent = typeof best === 'number' ? String(best) : '--';

    el.progressBar.style.setProperty('--fill', total ? (powered / total) : 0);
    el.progressBar.setAttribute('aria-valuenow', String(powered));
    el.progressBar.setAttribute('aria-valuemax', String(total));
    el.progressBar.setAttribute('aria-valuetext', powered + ' of ' + total + ' sockets powered');

    el.btnUndo.disabled = !g.canUndo();
    el.app.classList.toggle('is-complete', g.phase === 'complete');
    el.canvas.setAttribute('aria-label', this.renderer.describe());

    var chip = doc.getElementById('mapCount');
    if (chip) chip.textContent = this.completedCount() + '/20';
  };

  App.prototype.announce = function (text) {
    this.el.live.textContent = text;
  };

  /* -------------------------------------------------------------- banner */

  App.prototype.hideBanner = function () {
    clearTimeout(this.bannerTimer);
    this.el.banner.classList.remove('is-open', 'banner--chapter', 'banner--final');
    this.el.banner.setAttribute('aria-hidden', 'true');
    this.el.banner.inert = true;
    if (this.renderer) this.renderer.setInset(0);
  };

  App.prototype.buildBannerActions = function (actions) {
    var el = this.el.bannerActions;
    el.innerHTML = '';
    var self = this;
    actions.forEach(function (a, i) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (i === 0 ? 'btn--primary' : 'btn--ghost');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        self.audio.ui(true);
        a.run();
      });
      el.appendChild(b);
    });
  };

  App.prototype.showCompletionBanner = function (info) {
    var lv = this.game.level;
    var el = this.el;
    var self = this;
    if (this.game.phase !== 'complete') return;

    var next = LY.LEVELS[lv.index + 1] || null;
    var unfinished = this.firstUnfinished();
    var isChapter = lv.id === LY.CHAPTER_ONE_END;
    var isFinal = lv.id === LY.FINAL_LEVEL;
    var full = this.allRestored();
    var best = this.save.best[lv.id];

    el.banner.classList.remove('banner--chapter', 'banner--final');
    el.bannerCredit.hidden = true;
    el.bannerBody.hidden = false;

    var statLine = 'Moves ' + info.moves + ' · Pushes ' + this.game.pushCount +
      ' · Best ' + (typeof best === 'number' ? best : info.moves) +
      (info.improved && typeof info.prevBest === 'number' ? ' (was ' + info.prevBest + ')' : '');
    el.bannerStats.textContent = statLine;

    if (isFinal && full) {
      el.banner.classList.add('banner--final');
      el.bannerEyebrow.textContent = 'Campaign complete';
      el.bannerTitle.textContent = 'The yard wakes';
      el.bannerBody.textContent = '20 / 20 circuits restored. Total of your best runs: ' +
        this.totalBest() + ' moves. Sunrise is on the glass and the greenhouses are drinking current again.';
      el.bannerStats.textContent = statLine;
      el.bannerCredit.hidden = false;
      this.buildBannerActions([
        { label: 'Replay Dawn Sequence', run: function () { self.doRestart(); } },
        { label: 'Board map', run: function () { self.hideBanner(); self.openSheet(el.sheetMap, el.btnMap); } }
      ]);
    } else if (isFinal && !full) {
      el.banner.classList.add('banner--chapter');
      el.bannerEyebrow.textContent = 'Dawn holds';
      el.bannerTitle.textContent = 'Sequence stable';
      el.bannerBody.textContent = 'Dawn Sequence is live, but ' + (20 - this.completedCount()) +
        ' circuit' + (20 - this.completedCount() === 1 ? ' is' : 's are') +
        ' still dark. The sun waits for the whole yard.';
      this.buildBannerActions([
        unfinished
          ? { label: 'Go to ' + unfinished.name, run: function () { self.doSelect(unfinished.id); } }
          : { label: 'Board map', run: function () { self.hideBanner(); self.openSheet(el.sheetMap, el.btnMap); } },
        { label: 'Replay', run: function () { self.doRestart(); } },
        { label: 'Board map', run: function () { self.hideBanner(); self.openSheet(el.sheetMap, el.btnMap); } }
      ]);
    } else if (isChapter) {
      el.banner.classList.add('banner--chapter');
      el.bannerEyebrow.textContent = 'Chapter one';
      el.bannerTitle.textContent = 'GRID RESTORED';
      el.bannerBody.textContent = 'Three circuits hold and the yard has a heartbeat. ' +
        'There is enough current now to open the split bus.';
      this.buildBannerActions([
        { label: 'Continue to Split Bus', run: function () { self.doSelect('split-bus'); } },
        { label: 'Replay', run: function () { self.doRestart(); } },
        { label: 'Board map', run: function () { self.hideBanner(); self.openSheet(el.sheetMap, el.btnMap); } }
      ]);
    } else {
      el.bannerEyebrow.textContent = 'Circuit live';
      el.bannerTitle.textContent = lv.name + ' restored';
      el.bannerBody.hidden = true;
      var acts = [];
      if (next) acts.push({ label: 'Next: ' + next.name, run: function () { self.doSelect(next.id); } });
      acts.push({ label: 'Replay', run: function () { self.doRestart(); } });
      acts.push({ label: 'Board map', run: function () { self.hideBanner(); self.openSheet(el.sheetMap, el.btnMap); } });
      this.buildBannerActions(acts);
    }

    el.banner.classList.add('is-open');
    el.banner.setAttribute('aria-hidden', 'false');
    el.banner.inert = false;
    root.requestAnimationFrame(function () {
      // lift the yard clear of the tray so the restored board stays visible
      self.renderer.setInset(el.banner.offsetHeight + 20);
    });
    var first = el.bannerActions.querySelector('button');
    if (first) first.focus();
  };

  /* ------------------------------------------------------------ board map */

  App.prototype.buildBoardList = function () {
    var el = this.el.boardList;
    if (!el) return;
    var self = this;
    el.innerHTML = '';
    LY.LEVELS.forEach(function (lv) {
      var done = !!self.save.completed[lv.id];
      var current = lv.id === self.game.level.id;
      var best = self.save.best[lv.id];
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'board' + (done ? ' is-done' : '') + (current ? ' is-current' : '');
      b.dataset.id = lv.id;
      if (current) b.setAttribute('aria-current', 'true');
      b.innerHTML =
        '<span class="board__num">' + pad2(lv.number) + '</span>' +
        '<span class="board__name">' + lv.name + '</span>' +
        '<span class="board__state">' +
        '<span class="board__glyph" aria-hidden="true">' + (done ? '&#10003;' : (current ? '&#9656;' : '&#9675;')) + '</span>' +
        (done ? 'Best ' + best : (current ? 'Playing' : 'Dark')) +
        '</span>';
      b.setAttribute('aria-label',
        'Board ' + lv.number + ', ' + lv.name + '. ' +
        (done ? 'Restored, best ' + best + ' moves.' : (current ? 'Currently playing.' : 'Not yet restored.')));
      b.addEventListener('click', function () {
        self.audio.ui(true);
        self.closeSheets();
        self.doSelect(lv.id);
      });
      el.appendChild(b);
    });
    var done = this.completedCount();
    this.el.mapProgress.textContent = done + ' / 20 restored';
    this.el.mapTotal.textContent = done ? 'Best-run total ' + this.totalBest() + ' moves' : 'No circuits restored yet';
    var chip = doc.getElementById('mapCount');
    if (chip) chip.textContent = done + '/20';
  };

  /* --------------------------------------------------------------- sheets */

  App.prototype.openSheet = function (sheet, opener) {
    this.closeSheets(true);
    this.lastOpener = opener || null;
    sheet.classList.add('is-open');
    sheet.setAttribute('aria-hidden', 'false');
    sheet.inert = false;
    this.el.scrim.classList.add('is-open');
    this.el.app.classList.add('has-sheet');
    var focusable = sheet.querySelector('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
    this.audio.ui(true);
  };

  App.prototype.closeSheets = function (silent) {
    var open = this.el.app.classList.contains('has-sheet');
    [this.el.sheetMap, this.el.sheetSettings].forEach(function (s) {
      s.classList.remove('is-open');
      s.setAttribute('aria-hidden', 'true');
      s.inert = true;
    });
    this.el.scrim.classList.remove('is-open');
    this.el.app.classList.remove('has-sheet');
    this.confirmWipe = false;
    if (this.el.btnWipe) this.el.btnWipe.textContent = 'Clear saved progress';
    if (open && !silent) {
      this.audio.ui(false);
      if (this.lastOpener) this.lastOpener.focus();
    }
    this.lastOpener = null;
  };

  App.prototype.syncSettingsUi = function () {
    var s = this.el.toggleSound;
    var m = this.el.toggleMotion;
    s.setAttribute('aria-checked', this.save.sound ? 'true' : 'false');
    s.querySelector('.switch__label').textContent = this.save.sound ? 'On' : 'Off';
    m.setAttribute('aria-checked', this.save.motion ? 'true' : 'false');
    m.querySelector('.switch__label').textContent = this.save.motion ? 'On' : 'Off';
    doc.body.classList.toggle('calm', !this.save.motion);
  };

  /* --------------------------------------------------------------- inputs */

  App.prototype.bindControls = function () {
    var self = this;
    var el = this.el;

    el.btnUndo.addEventListener('click', function () { self.tryUndo(); });
    el.btnRestart.addEventListener('click', function () { self.doRestart(); });
    el.btnMap.addEventListener('click', function () { self.openSheet(el.sheetMap, el.btnMap); });
    el.btnSettings.addEventListener('click', function () { self.openSheet(el.sheetSettings, el.btnSettings); });
    el.scrim.addEventListener('click', function () { self.closeSheets(); });

    Array.prototype.forEach.call(doc.querySelectorAll('[data-close-sheet]'), function (b) {
      b.addEventListener('click', function () { self.closeSheets(); });
    });

    el.toggleSound.addEventListener('click', function () {
      self.save.sound = !self.save.sound;
      self.audio.start();
      self.audio.setEnabled(self.save.sound);
      self.persist();
      self.syncSettingsUi();
      if (self.save.sound) self.audio.ui(true);
      self.announce('Sound ' + (self.save.sound ? 'on' : 'off'));
    });

    el.toggleMotion.addEventListener('click', function () {
      self.save.motion = !self.save.motion;
      self.renderer.setMotion(self.save.motion);
      self.persist();
      self.syncSettingsUi();
      self.audio.ui(self.save.motion);
      self.announce('Motion ' + (self.save.motion ? 'on' : 'off'));
    });

    el.btnWipe.addEventListener('click', function () {
      if (!self.confirmWipe) {
        self.confirmWipe = true;
        el.btnWipe.textContent = 'Tap again to erase all progress';
        return;
      }
      self.confirmWipe = false;
      el.btnWipe.textContent = 'Clear saved progress';
      var keepSound = self.save.sound, keepMotion = self.save.motion;
      self.save = defaultSave();
      self.save.sound = keepSound;
      self.save.motion = keepMotion;
      self.persist();
      self.renderer.setDawn(false);
      self.buildBoardList();
      self.refresh();
      self.announce('Saved progress cleared.');
    });
  };

  App.prototype.bindStageInput = function () {
    var self = this;
    var stage = this.el.stage;
    var start = null;

    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== undefined && ev.button !== 0) return;
      start = { x: ev.clientX, y: ev.clientY, t: performance.now(), id: ev.pointerId };
      try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    });

    stage.addEventListener('pointerup', function (ev) {
      if (!start || start.id !== ev.pointerId) return;
      var dx = ev.clientX - start.x;
      var dy = ev.clientY - start.y;
      var dist = Math.hypot(dx, dy);
      start = null;
      if (self.el.app.classList.contains('has-sheet')) return;

      var threshold = 22;
      if (dist >= threshold) {
        var dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
        self.tryMove(dir);
        return;
      }
      // tap: step onto an adjacent tile
      self.begin();
      var cellPos = self.renderer.cellFromPoint(ev.clientX, ev.clientY);
      var g = self.game;
      var dr = cellPos.row - g.player.row;
      var dc = cellPos.col - g.player.col;
      if (Math.abs(dr) + Math.abs(dc) === 1) {
        self.tryMove(dr === -1 ? 'up' : dr === 1 ? 'down' : dc === -1 ? 'left' : 'right');
      } else if (g.phase === 'playing') {
        self.renderer.hintLegal();
      }
    });

    stage.addEventListener('pointercancel', function () { start = null; });
    stage.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  };

  App.prototype.bindKeys = function () {
    var self = this;
    var MOVES = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', a: 'left', s: 'down', d: 'right',
      W: 'up', A: 'left', S: 'down', D: 'right'
    };
    doc.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var key = ev.key;
      var target = ev.target;
      var onControl = target && target.tagName === 'BUTTON';

      if (key === 'Escape') {
        if (self.el.app.classList.contains('has-sheet')) { self.closeSheets(); ev.preventDefault(); }
        return;
      }
      // While a sheet is open the keyboard belongs to the sheet.
      if (self.el.app.classList.contains('has-sheet')) {
        if (key === 'b' || key === 'B') { ev.preventDefault(); self.closeSheets(); }
        return;
      }
      if (MOVES[key]) {
        ev.preventDefault();
        self.tryMove(MOVES[key]);
        return;
      }
      if (key === 'u' || key === 'U' || key === 'Backspace') {
        ev.preventDefault();
        self.tryUndo();
        return;
      }
      if ((key === 'r' || key === 'R') && !onControl) {
        ev.preventDefault();
        self.doRestart();
        return;
      }
      if (key === 'b' || key === 'B') {
        ev.preventDefault();
        self.openSheet(self.el.sheetMap, self.el.btnMap);
      }
    });
  };

  /* Optional gamepad layer on top of the complete touch and mouse paths. */
  App.prototype.pollGamepad = function (now) {
    if (!root.navigator || !root.navigator.getGamepads) return;
    var pads = root.navigator.getGamepads();
    var pad = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    if (!pad) return;

    var ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    var dz = 0.55;
    var dir = null;
    if (pad.buttons[12] && pad.buttons[12].pressed) dir = 'up';
    else if (pad.buttons[13] && pad.buttons[13].pressed) dir = 'down';
    else if (pad.buttons[14] && pad.buttons[14].pressed) dir = 'left';
    else if (pad.buttons[15] && pad.buttons[15].pressed) dir = 'right';
    else if (Math.abs(ax) > dz || Math.abs(ay) > dz) {
      dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : (ay > 0 ? 'down' : 'up');
    }

    if (dir) {
      var repeat = this.gamepad.dir === dir ? 165 : 0;
      if (now - this.gamepad.at >= repeat) {
        this.gamepad.at = now;
        this.gamepad.dir = dir;
        if (!this.el.app.classList.contains('has-sheet')) this.tryMove(dir);
      }
    } else {
      this.gamepad.dir = null;
      this.gamepad.at = 0;
    }

    var self = this;
    function edge(index, fn) {
      var b = pad.buttons[index];
      var down = !!(b && b.pressed);
      if (down && !self.gamepad.buttons[index]) fn();
      self.gamepad.buttons[index] = down;
    }
    edge(0, function () {
      var banner = self.el.banner;
      if (banner.classList.contains('is-open')) {
        var b = banner.querySelector('button');
        if (b) { b.click(); return; }
      }
      var active = doc.activeElement;
      if (active && active.tagName === 'BUTTON') active.click();
    });
    edge(1, function () { self.tryUndo(); });
    edge(9, function () {
      if (self.el.app.classList.contains('has-sheet')) self.closeSheets();
      else self.openSheet(self.el.sheetMap, self.el.btnMap);
    });
    edge(8, function () { self.doRestart(); });
  };

  LY.App = App;

  function boot() {
    var app = new LY.App();
    LY.app = app;
    app.mount();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
