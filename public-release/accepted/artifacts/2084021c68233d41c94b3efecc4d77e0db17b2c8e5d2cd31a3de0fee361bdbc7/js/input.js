/* SHOAL - hands on the pool.
   Tap turns. Press and hold plants or lifts a pennant. Tapping a satisfied
   number sweeps. Right click is the mouse shortcut for the pennant. A drag
   cancels, so a stray thumb never turns a shell. */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});

  var HOLD_MS = 480;      // long enough that a tap never plants, short enough to flag in rhythm
  var MOVE_TOL = 12;      // css px of travel that cancels a press

  S.createInput = function (canvas, view, game, hooks) {
    var g = game.model;
    var press = null;       // {id, i, x, y, t, held, moved}
    var cursor = 0, cursorOn = false;

    function xy(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function toggleFlag(i) {
      if (i < 0) return;
      var d = g.disp[i];
      if (d === S.CODES.FLG) hooks.perform({ type: 'unflag', x: i % g.w, y: (i / g.w) | 0 });
      else if (d === S.CODES.COV) hooks.perform({ type: 'flag', x: i % g.w, y: (i / g.w) | 0 });
    }

    function primary(i) {
      if (i < 0) return;
      var d = g.disp[i];
      var x = i % g.w, y = (i / g.w) | 0;
      if (d === S.CODES.COV) hooks.perform({ type: 'open', x: x, y: y });
      else if (d <= 8) hooks.perform({ type: 'sweep', x: x, y: y });
      else if (d === S.CODES.FLG) hooks.nudge(i);   // the pennant is the safety catch
    }

    function endPress(commit) {
      if (!press) return;
      var p = press;
      press = null;
      view.setPress(-1, 0);
      if (commit && !p.held && !p.moved) primary(p.i);
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (hooks.blocked()) return;
      hooks.wake();
      var p = xy(e);
      var i = view.cellAt(p.x, p.y);
      if (i < 0) { return; }
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
      if (e.button === 2) { toggleFlag(i); return; }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      press = { id: e.pointerId, i: i, x: p.x, y: p.y, t: performance.now(), held: false, moved: false };
      view.setPress(i, 0);
    }, { passive: false });

    canvas.addEventListener('pointermove', function (e) {
      var p = xy(e);
      if (e.pointerType === 'mouse' && !press) view.setHover(view.cellAt(p.x, p.y));
      if (!press || e.pointerId !== press.id) return;
      if (Math.abs(p.x - press.x) > MOVE_TOL || Math.abs(p.y - press.y) > MOVE_TOL) {
        press.moved = true;
        view.setPress(-1, 0);
      }
    }, { passive: true });

    canvas.addEventListener('pointerup', function (e) {
      if (!press || e.pointerId !== press.id) return;
      e.preventDefault();
      endPress(true);
    }, { passive: false });

    canvas.addEventListener('pointercancel', function () { endPress(false); });
    canvas.addEventListener('pointerleave', function () { view.setHover(-1); });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // the hold is resolved on the frame clock so the ring fills smoothly
    function frame(now) {
      if (!press) return;
      if (press.i >= g.n || hooks.blocked()) {   // the pool changed under the thumb
        press = null;
        view.setPress(-1, 0);
        return;
      }
      if (press.moved) return;
      var prog = (now - press.t) / HOLD_MS;
      if (prog >= 1 && !press.held) {
        press.held = true;
        view.setPress(-1, 0);
        toggleFlag(press.i);
        return;
      }
      view.setPress(press.held ? -1 : press.i, prog);
    }

    function moveCursor(dx, dy) {
      cursorOn = true;
      var x = (cursor % g.w) + dx, y = ((cursor / g.w) | 0) + dy;
      x = Math.max(0, Math.min(g.w - 1, x));
      y = Math.max(0, Math.min(g.h - 1, y));
      cursor = y * g.w + x;
      view.setCursor(cursor, true);
    }

    window.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'r' || k === 'R') { hooks.restart(); e.preventDefault(); return; }
      if (k === 'm' || k === 'M') { hooks.toggleMute(); return; }
      if (hooks.blocked()) return;
      if (cursor >= g.n) cursor = 0;
      if (k === 'ArrowLeft') { moveCursor(-1, 0); e.preventDefault(); }
      else if (k === 'ArrowRight') { moveCursor(1, 0); e.preventDefault(); }
      else if (k === 'ArrowUp') { moveCursor(0, -1); e.preventDefault(); }
      else if (k === 'ArrowDown') { moveCursor(0, 1); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') { hooks.wake(); cursorOn = true; view.setCursor(cursor, true); primary(cursor); e.preventDefault(); }
      else if (k === 'f' || k === 'F') { hooks.wake(); cursorOn = true; view.setCursor(cursor, true); toggleFlag(cursor); e.preventDefault(); }
    });

    return { frame: frame, cursor: function () { return cursorOn ? cursor : -1; } };
  };
})();
