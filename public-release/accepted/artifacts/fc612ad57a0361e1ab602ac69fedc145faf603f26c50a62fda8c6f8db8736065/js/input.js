/* Lumen Yard — touch, mouse, keyboard and gamepad input. All paths drive the
   same production state through Lumen.main. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;

  var KEYMAP = {
    arrowup: 'up', w: 'up',
    arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left',
    arrowright: 'right', d: 'right',
  };

  function init() {
    var canvas = root.document.getElementById('board');
    var ui = Lumen.UI;
    var pd = null;

    canvas.addEventListener('pointerdown', function (e) {
      Lumen.main.beginPlay();
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      pd = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!pd || pd.id !== e.pointerId) return;
      var dx = e.clientX - pd.x, dy = e.clientY - pd.y;
      pd = null;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) > 22) {
        var dir = adx > ady ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        Lumen.main.doMove(dir);
      } else {
        tapAt(e, canvas);
      }
    });
    canvas.addEventListener('pointercancel', function () { pd = null; });

    function tapAt(e, c) {
      var game = Lumen.game;
      var tile = Lumen.renderer.tile;
      var rect = c.getBoundingClientRect();
      var col = Math.floor((e.clientX - rect.left) / tile);
      var row = Math.floor((e.clientY - rect.top) / tile);
      if (row < 0 || col < 0 || row >= game.rows || col >= game.cols) return;
      var dr = row - game.player.row, dc = col - game.player.col;
      if (Math.abs(dr) + Math.abs(dc) !== 1) return;
      var dir = dr === 1 ? 'down' : dr === -1 ? 'up' : dc === 1 ? 'right' : 'left';
      if (game.moveLegal(dir)) Lumen.main.doMove(dir);
    }

    root.addEventListener('keydown', function (e) {
      if (ui.isDrawerOpen()) {
        var k = e.key.toLowerCase();
        if (e.key === 'Escape') { e.preventDefault(); ui.closeDrawer(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.selectFocusedCell(); }
        else if (k === 'arrowup' || k === 'w') { e.preventDefault(); ui.gridNav('up'); }
        else if (k === 'arrowdown' || k === 's') { e.preventDefault(); ui.gridNav('down'); }
        else if (k === 'arrowleft' || k === 'a') { e.preventDefault(); ui.gridNav('left'); }
        else if (k === 'arrowright' || k === 'd') { e.preventDefault(); ui.gridNav('right'); }
        return;
      }
      if (ui.isSettingsOpen()) {
        var k2 = e.key.toLowerCase();
        if (e.key === 'Escape') { e.preventDefault(); ui.closeSettings(); }
        else if (k2 === 'arrowup' || k2 === 'w') { e.preventDefault(); ui.focusSetting(0); }
        else if (k2 === 'arrowdown' || k2 === 's') { e.preventDefault(); ui.focusSetting(1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (root.document.activeElement) root.document.activeElement.click(); }
        return;
      }
      if (ui.isCompletionVisible() && e.key === 'Escape') { e.preventDefault(); Lumen.main.hideCompletion(); return; }
      var kk = e.key.toLowerCase();
      if (KEYMAP[kk]) { e.preventDefault(); Lumen.main.doMove(KEYMAP[kk]); return; }
      if (kk === 'u' || e.key === 'Backspace') { e.preventDefault(); Lumen.main.doUndo(); return; }
      if (kk === 'r') { e.preventDefault(); Lumen.main.doRestart(); return; }
    });
  }

  // gamepad (supplements touch/mouse)
  var prevPads = new Map();

  function pollGamepad() {
    var pads = (root.navigator.getGamepads && root.navigator.getGamepads()) || [];
    var ui = Lumen.UI;
    for (var i = 0; i < pads.length; i++) {
      var pad = pads[i];
      if (!pad) continue;
      var key = pad.id;
      var prev = prevPads.get(key) || { dir: '', buttons: {} };
      var down = function (idx) { return !!(pad.buttons[idx] && pad.buttons[idx].pressed); };
      var ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      var dir = '';
      if (Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5) {
        dir = Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : (ay < 0 ? 'up' : 'down');
      }
      if (down(12)) dir = 'up'; else if (down(13)) dir = 'down'; else if (down(14)) dir = 'left'; else if (down(15)) dir = 'right';
      if (dir && dir !== prev.dir) {
        if (ui.isDrawerOpen()) ui.gridNav(dir);
        else if (ui.isSettingsOpen()) ui.focusSetting(dir === 'up' ? 0 : 1);
        else Lumen.main.gamepadDir(dir);
      }
      if (down(0) && !prev.buttons[0]) Lumen.main.gamepadPrimary();
      if (down(1) && !prev.buttons[1]) Lumen.main.gamepadSecondary();
      if (down(9) && !prev.buttons[9]) Lumen.main.gamepadStart();
      prevPads.set(key, { dir: dir, buttons: { 0: down(0), 1: down(1), 9: down(9) } });
    }
  }

  setInterval(pollGamepad, 50);
  root.addEventListener('gamepadconnected', function () {
    if (root.navigator.getGamepads) root.navigator.getGamepads();
  });

  Lumen.Input = { init: init };
})(typeof window !== 'undefined' ? window : globalThis);