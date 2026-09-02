// Lumen Yard - touch, mouse, keyboard and gamepad input.
// All paths funnel into controller.dispatch(action) / controller.dispatchRestart()
// so human input and Arena actions operate identical state.
(function (root) {
  'use strict';

  var DIR_VEC = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };

  function setupInput(controller) {
    var canvas = controller.canvas;
    var renderer = controller.renderer;

    function onFirstGesture() {
      controller.primeAudio();
    }

    // ---- keyboard --------------------------------------------------
    window.addEventListener('keydown', function (ev) {
      if (controller.isTypingTarget(ev.target)) return;
      if (ev.key === 'Escape') { controller.onEscape(); return; }
      // Every move here is a deliberate, committed step (matching the tap/
      // swipe paths) -- ignore OS key-repeat from a held key.
      if (ev.repeat) return;
      // While a drawer is open, let Tab/Enter/Space work normally on its
      // controls instead of moving the robot underneath it.
      if (controller.isModalOpen && controller.isModalOpen()) return;
      var dir = null;
      switch (ev.key) {
        case 'ArrowUp': case 'w': case 'W': dir = 'up'; break;
        case 'ArrowDown': case 's': case 'S': dir = 'down'; break;
        case 'ArrowLeft': case 'a': case 'A': dir = 'left'; break;
        case 'ArrowRight': case 'd': case 'D': dir = 'right'; break;
        case 'u': case 'U': case 'Backspace':
          onFirstGesture();
          ev.preventDefault();
          controller.dispatch({ type: 'undo' }, { source: 'keyboard' });
          return;
        case 'r': case 'R':
          onFirstGesture();
          ev.preventDefault();
          controller.dispatchRestart({ source: 'keyboard' });
          return;
        default:
          return;
      }
      onFirstGesture();
      ev.preventDefault();
      controller.dispatch({ type: 'move', direction: dir }, { source: 'keyboard' });
    });

    // ---- pointer: click/tap adjacent tile ---------------------------
    function tileFromEvent(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left - renderer.offsetX;
      var y = clientY - rect.top - renderer.offsetY;
      var col = Math.floor(x / renderer.tileSize);
      var row = Math.floor(y / renderer.tileSize);
      return { row: row, col: col };
    }

    function directionToAdjacentTile(row, col) {
      var state = controller.getState();
      var pr = state.player.row, pc = state.player.col;
      for (var name in DIR_VEC) {
        var v = DIR_VEC[name];
        if (pr + v.dr === row && pc + v.dc === col) return name;
      }
      return null;
    }

    canvas.addEventListener('click', function (ev) {
      onFirstGesture();
      var t = tileFromEvent(ev.clientX, ev.clientY);
      var dir = directionToAdjacentTile(t.row, t.col);
      if (dir) controller.dispatch({ type: 'move', direction: dir }, { source: 'pointer' });
    });

    // ---- touch: swipe or tap adjacent tile ---------------------------
    var touchStart = null;
    canvas.addEventListener('touchstart', function (ev) {
      onFirstGesture();
      if (ev.touches.length !== 1) return;
      var t = ev.touches[0];
      touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });

    canvas.addEventListener('touchend', function (ev) {
      if (!touchStart) return;
      var t = ev.changedTouches[0];
      var dx = t.clientX - touchStart.x;
      var dy = t.clientY - touchStart.y;
      var dist = Math.hypot(dx, dy);
      var swipeThreshold = Math.max(24, renderer.tileSize * 0.4);

      if (dist >= swipeThreshold) {
        var dir;
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
        else dir = dy > 0 ? 'down' : 'up';
        controller.dispatch({ type: 'move', direction: dir }, { source: 'touch' });
      } else {
        var tile = tileFromEvent(t.clientX, t.clientY);
        var adjDir = directionToAdjacentTile(tile.row, tile.col);
        if (adjDir) controller.dispatch({ type: 'move', direction: adjDir }, { source: 'touch' });
      }
      touchStart = null;
      ev.preventDefault();
    }, { passive: false });

    // ---- gamepad -------------------------------------------------------
    var gpState = { lastDir: null, lastDirTime: 0, lastButtons: [] };
    var REPEAT_DELAY = 320, REPEAT_RATE = 140;
    var AXIS_THRESHOLD = 0.5;

    function pollGamepad(ts) {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      var pad = null;
      for (var i = 0; i < pads.length; i++) { if (pads[i]) { pad = pads[i]; break; } }
      if (pad) {
        var dir = null;
        var lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
        var up = (pad.buttons[12] && pad.buttons[12].pressed) || ly < -AXIS_THRESHOLD;
        var down = (pad.buttons[13] && pad.buttons[13].pressed) || ly > AXIS_THRESHOLD;
        var left = (pad.buttons[14] && pad.buttons[14].pressed) || lx < -AXIS_THRESHOLD;
        var right = (pad.buttons[15] && pad.buttons[15].pressed) || lx > AXIS_THRESHOLD;
        if (up) dir = 'up'; else if (down) dir = 'down'; else if (left) dir = 'left'; else if (right) dir = 'right';
        var modalOpen = controller.isModalOpen && controller.isModalOpen();

        if (dir && !modalOpen) {
          var now = performance.now();
          if (dir !== gpState.lastDir) {
            onFirstGesture();
            controller.dispatch({ type: 'move', direction: dir }, { source: 'gamepad' });
            gpState.lastDir = dir;
            gpState.lastDirTime = now;
          } else if (now - gpState.lastDirTime > REPEAT_DELAY) {
            controller.dispatch({ type: 'move', direction: dir }, { source: 'gamepad' });
            gpState.lastDirTime = now - REPEAT_DELAY + REPEAT_RATE;
          }
        } else if (!dir) {
          gpState.lastDir = null;
        }

        var btn = function (i) { return pad.buttons[i] && pad.buttons[i].pressed; };
        var prev = gpState.lastButtons;
        if (btn(0) && !prev[0]) { onFirstGesture(); controller.onGamepadPrimary(); }
        if (btn(1) && !prev[1] && !modalOpen) { onFirstGesture(); controller.dispatch({ type: 'undo' }, { source: 'gamepad' }); }
        if (btn(9) && !prev[9]) { onFirstGesture(); controller.onGamepadStart(); }
        gpState.lastButtons = pad.buttons.map(function (b) { return b.pressed; });
      }
      requestAnimationFrame(pollGamepad);
    }
    requestAnimationFrame(pollGamepad);
  }

  root.LumenInput = { setup: setupInput };
})(typeof window !== 'undefined' ? window : this);
