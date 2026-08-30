(function (root) {
'use strict';

function createInput(core, opts) {
  opts = opts || {};
  var stage = opts.stage;
  var onFirstGesture = opts.onFirstGesture || function () {};
  var stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  var PT = core.input.pt;
  var KB = core.input.kb;
  var api = {};
  var gestureSeen = false;
  var RESTART_COOLDOWN_MS = 350;

  function firstGesture() {
    if (!gestureSeen) { gestureSeen = true; onFirstGesture(); }
  }

  /* ---------------- pointer (touch + mouse) ---------------- */

  function toLocal(e) {
    var r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e) {
    firstGesture();
    var p = toLocal(e);
    if (core.viewState().phase === 'gameover') {
      var blocked = opts.restartBlocked && opts.restartBlocked();
      if (blocked) return;
      core.restart('new');
      if (opts.onRestart) opts.onRestart();
      return;
    }
    if (stick.active && e.pointerId !== stick.id) return;
    stick.active = true; stick.id = e.pointerId;
    stick.ox = p.x; stick.oy = p.y; stick.dx = 0; stick.dy = 0;
    PT.accel = false; PT.stickX = 0;
    if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    if (e.cancelable) e.preventDefault();
  }

  function move(e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    var p = toLocal(e);
    stick.dx = p.x - stick.ox;
    stick.dy = p.y - stick.oy;
    if (Math.abs(stick.dx) < 5 && Math.abs(stick.dy) < 8) return void syncStick();
    syncStick();
    if (e.cancelable) e.preventDefault();
  }

  function syncStick() {
    var ACC_T = 16, DEAD = 7, SPAN = 58;
    var dy = stick.dy - 3;
    PT.accel = dy > ACC_T;
    var dx = stick.dx;
    PT.stickX = Math.abs(dx) < DEAD ? 0 : Math.max(-1, Math.min(1, (dx - Math.sign(dx) * DEAD) / SPAN));
  }

  function up(e) {
    if (!stick.active || e.pointerId !== stick.id) return;
    releaseStick();
    if (e.cancelable) e.preventDefault();
  }

  function releaseStick() {
    stick.active = false; stick.id = null;
    stick.dx = 0; stick.dy = 0;
    PT.accel = false; PT.stickX = 0;
  }

  window.addEventListener('pointerdown', down, { passive: false });
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up, { passive: false });
  window.addEventListener('pointercancel', up, { passive: false });
  window.addEventListener('blur', function () { releaseStick(); KB.accel = KB.left = KB.right = false; });

  /* ---------------- keyboard ---------------- */

  var HANDLED_KEYS = { ArrowDown: 1, Space: 1, ' ': 1, ArrowLeft: 1, ArrowRight: 1 };

  var lastR = 0;
  document.addEventListener('keydown', function (e) {
    firstGesture();
    var k = e.key === ' ' ? 'Space' : e.key;
    if (k === 'ArrowDown' || k === 'Space') { KB.accel = true; if (e.cancelable) e.preventDefault(); }
    else if (k === 'ArrowLeft') { KB.left = true; if (e.cancelable) e.preventDefault(); }
    else if (k === 'ArrowRight') { KB.right = true; if (e.cancelable) e.preventDefault(); }
    else if (k === 'r' || k === 'R' || k === 'Backspace') {
      var nowMs = performance.now();
      if (nowMs - lastR > RESTART_COOLDOWN_MS) {
        lastR = nowMs;
        core.restart('retry');
        releaseStick();
        if (opts.onRestart) opts.onRestart();
      }
      if (e.cancelable) e.preventDefault();
    }
  }, false);

  document.addEventListener('keyup', function (e) {
    var k = e.key === ' ' ? 'Space' : e.key;
    if (k === 'ArrowDown' || k === 'Space') KB.accel = false;
    else if (k === 'ArrowLeft') KB.left = false;
    else if (k === 'ArrowRight') KB.right = false;
  }, false);

  api.stick = stick;
  api.releaseAll = function () { releaseStick(); KB.accel = KB.left = KB.right = false; };
  return api;
}

var rootObj = typeof self !== 'undefined' ? self : root;
rootObj.DelveInput = createInput;

})(typeof self !== 'undefined' ? self : this);
