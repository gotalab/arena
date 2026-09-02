/* Lumen Yard — HUD, board browser, settings and result cards. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;
  var LEVEL_ORDER = Lumen.LEVEL_ORDER;
  var LEVEL_META = Lumen.LEVEL_META;

  function $(id) { return root.document.getElementById(id); }

  function UI() {
    this.focusedCell = 0;
    this._drawerOpen = false;
    this._settingsOpen = false;
    this._completionVisible = false;
    this.el = {};
    this._sound = true;
    this._motion = false;
  }

  UI.prototype.init = function () {
    var ids = [
      'hud-index', 'hud-name', 'hud-powered', 'hud-powered-count',
      'hud-moves', 'hud-best', 'hud-pushes', 'btn-banner',
      'title-band', 'title-word', 'title-tag', 'title-sub', 'stage',
      'drawer', 'board-grid', 'drawer-progress',
      'btn-boards', 'btn-undo', 'btn-restart', 'btn-settings',
      'settings', 'toggle-sound', 'toggle-motion', 'btn-drawer-close', 'btn-settings-close',
      'completion', 'comp-eyebrow', 'comp-title', 'comp-sub', 'comp-stats', 'comp-actions', 'comp-credit',
      'toast',
    ];
    for (var i = 0; i < ids.length; i++) this.el[ids[i]] = $(ids[i]);
    this.buildGrid();
    this.bind();
  };

  UI.prototype.buildGrid = function () {
    var self = this;
    var grid = this.el['board-grid'];
    grid.innerHTML = '';
    this.cells = [];
    for (var i = 0; i < LEVEL_ORDER.length; i++) {
      var id = LEVEL_ORDER[i];
      var cell = root.document.createElement('button');
      cell.className = 'board-cell';
      cell.dataset.index = String(i);
      cell.dataset.level = id;
      cell.tabIndex = -1;
      cell.setAttribute('aria-label', LEVEL_META[id].name);
      grid.appendChild(cell);
      this.cells.push(cell);
      cell.addEventListener('click', (function (lid) {
        return function () {
          self.closeDrawer();
          Lumen.main.selectLevel(lid);
        };
      })(id));
    }
  };

  UI.prototype.bind = function () {
    var self = this;
    this.el['btn-boards'].addEventListener('click', function () { self.openDrawer(); });
    this.el['btn-banner'].addEventListener('click', function () { self.openDrawer(); });
    this.el['btn-undo'].addEventListener('click', function () { Lumen.main.doUndo(); });
    this.el['btn-restart'].addEventListener('click', function () { Lumen.main.doRestart(); });
    this.el['btn-settings'].addEventListener('click', function () { self.openSettings(); });
    this.el['btn-drawer-close'].addEventListener('click', function () { self.closeDrawer(); });
    this.el['btn-settings-close'].addEventListener('click', function () { self.closeSettings(); });
    this.el['drawer'].addEventListener('pointerdown', function (e) {
      if (e.target === self.el['drawer'] || (e.target.classList && e.target.classList.contains('drawer-scrim'))) self.closeDrawer();
    });
    this.el['settings'].addEventListener('pointerdown', function (e) {
      if (e.target === self.el['settings'] || (e.target.classList && e.target.classList.contains('settings-scrim'))) self.closeSettings();
    });
  };

  UI.prototype.bindSettings = function (handlers) {
    var self = this;
    this.el['toggle-sound'].addEventListener('click', function () {
      var v = !self._sound;
      self._sound = v;
      self.setSoundToggle(v);
      handlers.onSound(v);
      if (v) Lumen.Audio.play('ui');
    });
    this.el['toggle-motion'].addEventListener('click', function () {
      var v = !self._motion;
      self._motion = v;
      self.setMotionToggle(v);
      handlers.onMotion(v);
    });
  };

  UI.prototype.setSoundToggle = function (v) {
    this._sound = !!v;
    this.el['toggle-sound'].setAttribute('aria-checked', String(!!v));
  };
  UI.prototype.setMotionToggle = function (v) {
    this._motion = !!v;
    this.el['toggle-motion'].setAttribute('aria-checked', String(!!v));
  };

  UI.prototype.updateHUD = function (game, save) {
    var idx = LEVEL_ORDER.indexOf(game.levelId);
    this.el['hud-index'].textContent = String(idx + 1).padStart(2, '0');
    this.el['hud-name'].textContent = LEVEL_META[game.levelId].name;
    this.el['hud-powered-count'].textContent = game.poweredGoals + '/' + game.goals.size;
    this.el['hud-powered'].classList.toggle('on', game.phase === 'complete');
    this.el['hud-moves'].textContent = game.moveCount;
    this.el['hud-pushes'].textContent = game.pushCount;
    var best = save.best[game.levelId];
    this.el['hud-best'].textContent = best != null ? best : '—';
    this.el['btn-undo'].disabled = !game.undoAvailable;
  };

  UI.prototype.updateGrid = function (game, save) {
    var doneCount = 0;
    for (var i = 0; i < this.cells.length; i++) {
      var cell = this.cells[i];
      var id = LEVEL_ORDER[i];
      var best = save.best[id];
      if (best != null) doneCount++;
      cell.classList.toggle('done', best != null);
      cell.classList.toggle('current', id === game.levelId);
      cell.innerHTML =
        '<span class="bc-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="bc-name">' + LEVEL_META[id].short + '</span>' +
        (best != null ? '<span class="bc-best">' + best + '</span>' : '');
    }
    this.el['drawer-progress'].textContent = doneCount + '/' + LEVEL_ORDER.length + ' restored';
  };

  // title
  UI.prototype.showTitle = function (opts) {
    opts = opts || {};
    this.el['title-word'].textContent = opts.word || 'LUMEN YARD';
    this.el['title-tag'].textContent = opts.tag || 'Restore the grid.';
    var sub = opts.sub || '';
    this.el['title-sub'].textContent = sub;
    this.el['title-sub'].style.display = sub ? 'block' : 'none';
    this.el['title-band'].classList.add('show');
  };
  UI.prototype.hideTitle = function () {
    this.el['title-band'].classList.remove('show');
  };

  // board browser
  UI.prototype.isDrawerOpen = function () { return this._drawerOpen; };
  UI.prototype.openDrawer = function () {
    var self = this;
    this._drawerOpen = true;
    this.el['drawer'].hidden = false;
    this.updateGrid(Lumen.game, Lumen.main.getSave());
    requestAnimationFrame(function () { self.el['drawer'].classList.add('open'); });
    var cur = -1;
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i].classList.contains('current')) { cur = i; break; }
    }
    this.focusCell(cur >= 0 ? cur : 0);
    Lumen.Audio.play('ui');
  };
  UI.prototype.closeDrawer = function () {
    if (!this._drawerOpen) return;
    var self = this;
    this._drawerOpen = false;
    this.el['drawer'].classList.remove('open');
    setTimeout(function () { if (!self._drawerOpen) self.el['drawer'].hidden = true; }, 240);
    this.el['btn-boards'].focus();
  };
  UI.prototype.focusCell = function (i) {
    if (!this.cells.length) return;
    if (i < 0) i = 0;
    if (i >= this.cells.length) i = this.cells.length - 1;
    this.focusedCell = i;
    for (var k = 0; k < this.cells.length; k++) this.cells[k].tabIndex = k === i ? 0 : -1;
    this.cells[i].focus();
  };
  UI.prototype.gridNav = function (dir) {
    var cols = 5;
    var i = this.focusedCell;
    var r = Math.floor(i / cols), c = i % cols;
    if (dir === 'up') r--;
    else if (dir === 'down') r++;
    else if (dir === 'left') c--;
    else if (dir === 'right') c++;
    if (c < 0 || c >= cols) return;
    if (r < 0 || r >= Math.ceil(this.cells.length / cols)) return;
    var ni = r * cols + c;
    if (ni >= 0 && ni < this.cells.length) this.focusCell(ni);
  };
  UI.prototype.selectFocusedCell = function () {
    var cell = this.cells[this.focusedCell];
    if (!cell) return;
    var id = cell.dataset.level;
    this.closeDrawer();
    Lumen.main.selectLevel(id);
  };

  // settings
  UI.prototype.isSettingsOpen = function () { return this._settingsOpen; };
  UI.prototype.openSettings = function () {
    var self = this;
    this._settingsOpen = true;
    this.el['settings'].hidden = false;
    requestAnimationFrame(function () { self.el['settings'].classList.add('open'); });
    this.focusSetting(0);
    Lumen.Audio.play('ui');
  };
  UI.prototype.closeSettings = function () {
    if (!this._settingsOpen) return;
    var self = this;
    this._settingsOpen = false;
    this.el['settings'].classList.remove('open');
    setTimeout(function () { if (!self._settingsOpen) self.el['settings'].hidden = true; }, 240);
  };
  UI.prototype.focusSetting = function (i) {
    var ids = ['toggle-sound', 'toggle-motion'];
    if (i < 0) i = 0;
    if (i > 1) i = 1;
    this.el[ids[i]].focus();
  };

  // completion
  UI.prototype.isCompletionVisible = function () { return this._completionVisible; };
  UI.prototype.showCompletion = function (d) {
    var self = this;
    this._completionVisible = true;
    var el = this.el['completion'];
    el.classList.toggle('chapter', d.className === 'chapter');
    el.classList.toggle('finale', d.className === 'finale');
    el.classList.toggle('early', d.className === 'early');
    this.el['comp-eyebrow'].textContent = d.eyebrow || '';
    this.el['comp-title'].textContent = d.title || '';
    this.el['comp-sub'].textContent = d.sub || '';
    var stats = this.el['comp-stats'];
    stats.innerHTML = '';
    (d.stats || []).forEach(function (s) {
      var col = root.document.createElement('div');
      col.className = 'cstat';
      var b = root.document.createElement('b');
      b.textContent = s.value;
      var sp = root.document.createElement('span');
      sp.textContent = s.label;
      col.appendChild(b);
      col.appendChild(sp);
      stats.appendChild(col);
    });
    var acts = this.el['comp-actions'];
    acts.innerHTML = '';
    (d.actions || []).forEach(function (a) {
      var btn = root.document.createElement('button');
      btn.className = 'btn ' + (a.class || '');
      btn.textContent = a.label;
      btn.addEventListener('click', a.handler);
      acts.appendChild(btn);
    });
    this.el['comp-credit'].textContent = d.credit || '';
    this.el['comp-credit'].style.display = d.credit ? 'block' : 'none';
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      var first = acts.querySelector('.btn');
      if (first) first.focus();
    }, 60);
  };
  UI.prototype.hideCompletion = function () {
    if (!this._completionVisible) return;
    var self = this;
    this._completionVisible = false;
    var el = this.el['completion'];
    el.classList.remove('show');
    setTimeout(function () { if (!self._completionVisible) el.hidden = true; }, 240);
  };

  // toast
  UI.prototype.toast = function (msg) {
    var t = this.el['toast'];
    t.textContent = msg;
    t.hidden = false;
    if (this._toastT) clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { t.hidden = true; }, 1700);
  };

  Lumen.UI = new UI();
})(typeof window !== 'undefined' ? window : globalThis);