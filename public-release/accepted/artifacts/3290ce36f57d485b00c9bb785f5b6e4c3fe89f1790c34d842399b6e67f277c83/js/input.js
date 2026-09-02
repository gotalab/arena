/* SHOAL - hands on the pool.

   Thumb, mouse and keyboard all reach the same four actions. Nothing here
   knows a rule; it only decides which action a gesture meant. */
(function (g) {
  'use strict';

  var S = g.SHOAL;

  var HOLD_MS = 470;      // long enough that a stray tap never plants
  var MOVE_CANCEL = 14;   // drag off the shell to call the whole thing off

  var press = null;
  var canvas = null;
  var keyCursor = null;

  function state() { return S.game.state(); }

  function cellIndex(x, y) { return y * state().w + x; }

  // A tap means "turn" on a covered shell and "sweep" on a turned number.
  function tap(x, y) {
    var st = state();
    var i = cellIndex(x, y);
    if (st.open[i]) {
      S.app.perform({ type: 'sweep', x: x, y: y });
    } else if (st.flag[i]) {
      S.app.refuse(x, y, 'A pennant guards this shell — hold to lift it');
    } else {
      S.app.perform({ type: 'open', x: x, y: y });
    }
  }

  function togglePennant(x, y) {
    var st = state();
    var i = cellIndex(x, y);
    if (st.open[i]) { S.app.refuse(x, y, null); return; }
    S.app.perform({ type: st.flag[i] ? 'unflag' : 'flag', x: x, y: y });
  }

  function endPress(cancelled) {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
    S.view.setPress(null);
  }

  function onPointerDown(ev) {
    if (S.app.isCeremony()) return;
    S.app.wake();
    var cell = S.view.hit(ev.clientX, ev.clientY);
    if (!cell) return;
    ev.preventDefault();

    if (ev.button === 2 || (ev.pointerType === 'mouse' && ev.ctrlKey)) {
      togglePennant(cell.x, cell.y);
      return;
    }
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;

    endPress();
    press = {
      id: ev.pointerId,
      x: cell.x,
      y: cell.y,
      startX: ev.clientX,
      startY: ev.clientY,
      t0: (g.performance && g.performance.now ? g.performance.now() : 0),
      fired: false,
      timer: null
    };
    var open = state().open[cellIndex(cell.x, cell.y)];
    if (!open) {
      press.timer = setTimeout(function () {
        if (!press || press.fired) return;
        press.fired = true;
        togglePennant(press.x, press.y);
        S.view.setPress(null);
      }, HOLD_MS);
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  }

  function onPointerMove(ev) {
    if (!press || ev.pointerId !== press.id) return;
    var dx = ev.clientX - press.startX;
    var dy = ev.clientY - press.startY;
    if (dx * dx + dy * dy > MOVE_CANCEL * MOVE_CANCEL) endPress(true);
  }

  function onPointerUp(ev) {
    if (!press || ev.pointerId !== press.id) return;
    var fired = press.fired;
    var x = press.x, y = press.y;
    endPress();
    if (fired) return;
    var cell = S.view.hit(ev.clientX, ev.clientY);
    if (!cell || cell.x !== x || cell.y !== y) return;
    tap(x, y);
  }

  function onKey(ev) {
    var k = ev.key;
    if (k === 'r' || k === 'R') {
      S.app.wake();
      S.app.restart();
      ev.preventDefault();
      return;
    }
    if (S.app.isCeremony()) {
      if (k === 'Enter' || k === ' ') { S.app.restart(); ev.preventDefault(); }
      return;
    }
    var st = state();
    if (!keyCursor) keyCursor = { x: (st.w / 2) | 0, y: (st.h / 2) | 0 };
    var moved = false;
    if (k === 'ArrowLeft') { keyCursor.x = Math.max(0, keyCursor.x - 1); moved = true; }
    else if (k === 'ArrowRight') { keyCursor.x = Math.min(st.w - 1, keyCursor.x + 1); moved = true; }
    else if (k === 'ArrowUp') { keyCursor.y = Math.max(0, keyCursor.y - 1); moved = true; }
    else if (k === 'ArrowDown') { keyCursor.y = Math.min(st.h - 1, keyCursor.y + 1); moved = true; }
    if (moved) {
      S.view.setCursor(keyCursor);
      ev.preventDefault();
      return;
    }
    if (k === ' ' || k === 'Enter') {
      S.app.wake();
      S.view.setCursor(keyCursor);
      tap(keyCursor.x, keyCursor.y);
      ev.preventDefault();
    } else if (k === 'f' || k === 'F') {
      S.app.wake();
      S.view.setCursor(keyCursor);
      togglePennant(keyCursor.x, keyCursor.y);
      ev.preventDefault();
    }
  }

  function tickPress() {
    if (!press || press.fired) return;
    var open = state().open[cellIndex(press.x, press.y)];
    if (open) return;
    var nowMs = g.performance && g.performance.now ? g.performance.now() : 0;
    var p = Math.min(1, (nowMs - press.t0) / HOLD_MS);
    S.view.setPress({ x: press.x, y: press.y, progress: p });
  }

  S.input = {
    init: function (el) {
      canvas = el;
      canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
      canvas.addEventListener('pointermove', onPointerMove, { passive: false });
      canvas.addEventListener('pointerup', onPointerUp, { passive: false });
      canvas.addEventListener('pointercancel', function () { endPress(true); });
      canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      canvas.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
      g.addEventListener('keydown', onKey);
    },
    tick: tickPress,
    clear: function () { endPress(true); keyCursor = null; if (S.view.setCursor) S.view.setCursor(null); }
  };
})(window);
