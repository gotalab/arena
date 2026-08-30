// DELVE — input handling. Keyboard is attached at document level (no click
// needed first) and a single planted-stick pointer control drives both touch
// and mouse identically. Nothing here touches simulation state directly.
(function (global) {
  'use strict';

  function create(opts) {
    var canvas = opts.canvas;
    var onRestart = opts.onRestart || function () {};
    var onFirstInput = opts.onFirstInput || function () {};
    var isGameOver = opts.isGameOver || function () { return false; };

    var keyState = { left: false, right: false, accel: false };
    var pointerActive = false;
    var pointerId = null;
    var origin = { x: 0, y: 0 };
    var current = { x: 0, y: 0 };
    var firstInputFired = false;

    function fireFirstInput() {
      if (!firstInputFired) { firstInputFired = true; onFirstInput(); }
    }

    var DIGIT_KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'accel', Space: 'accel' };

    function onKeyDown(e) {
      var code = e.code || e.key;
      var mapped = DIGIT_KEYS[code] || (e.key === ' ' ? 'accel' : null);
      if (mapped) {
        e.preventDefault();
        keyState[mapped] = true;
        fireFirstInput();
      } else if (e.key === 'r' || e.key === 'R') {
        onRestart();
      }
    }
    function onKeyUp(e) {
      var code = e.code || e.key;
      var mapped = DIGIT_KEYS[code] || (e.key === ' ' ? 'accel' : null);
      if (mapped) {
        e.preventDefault();
        keyState[mapped] = false;
      }
    }

    document.addEventListener('keydown', onKeyDown, { passive: false });
    document.addEventListener('keyup', onKeyUp, { passive: false });

    function pointFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e) {
      if (isGameOver()) {
        onRestart();
        return;
      }
      if (pointerActive) return;
      pointerActive = true;
      pointerId = e.pointerId;
      origin = pointFromEvent(e);
      current = { x: origin.x, y: origin.y };
      fireFirstInput();
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!pointerActive || e.pointerId !== pointerId) return;
      current = pointFromEvent(e);
      e.preventDefault();
    }
    function endPointer(e) {
      if (e && e.pointerId !== pointerId) return;
      pointerActive = false;
      pointerId = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', endPointer, { passive: false });
    canvas.addEventListener('pointercancel', endPointer, { passive: false });
    canvas.addEventListener('pointerleave', function (e) { /* keep captured stick alive while dragging */ });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var DEADZONE_Y = 10;
    var MAX_OFFSET_X = 60;

    function getInput() {
      var steer = 0, accel = false;
      if (pointerActive) {
        var dx = current.x - origin.x;
        var dy = current.y - origin.y;
        steer = Math.max(-1, Math.min(1, dx / MAX_OFFSET_X));
        accel = dy > DEADZONE_Y;
      }
      if (keyState.left) steer = -1;
      if (keyState.right) steer = 1;
      if (keyState.accel) accel = true;
      return { steer: steer, accel: accel };
    }

    function getStickVisual() {
      if (!pointerActive) return null;
      return {
        x: origin.x, y: origin.y,
        dx: Math.max(-MAX_OFFSET_X, Math.min(MAX_OFFSET_X, current.x - origin.x)),
        dy: Math.max(-10, Math.min(80, current.y - origin.y))
      };
    }

    function destroy() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    }

    return { getInput: getInput, getStickVisual: getStickVisual, destroy: destroy };
  }

  global.DelveInput = { create: create };
})(typeof window !== 'undefined' ? window : this);
