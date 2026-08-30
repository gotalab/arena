/* DELVE — input. One thumb, one mouse, or the keys.
 *
 * Pointer: touching the playfield plants a stick where the finger lands.
 * Pushing down from that point holds the accelerator; offsetting sideways
 * steers. The two axes are independent, so easing back up releases the
 * throttle while a sideways offset keeps steering. Release lets go of both.
 * The mouse drives exactly the same stick, so every state reachable with a
 * thumb is reachable with the mouse alone.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});

  var ACCEL_DEAD = 11;   // px of downward travel before the throttle engages
  var ACCEL_FULL = 46;
  var STEER_DEAD = 7;
  var STEER_FULL = 52;

  function Input(canvas, hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.keys = {};
    this.muted = false;
    this.touch = false;
    this.safeTop = 0;
    this.safeBottom = 0;
    this.stick = { active: false, ax: 0, ay: 0, dx: 0, dy: 0, throttle: 0, id: null };
    this.state = { accel: false, left: false, right: false, steer: 0 };
    this.attach();
  }

  Input.prototype.attach = function () {
    var self = this;
    var STOP = { ArrowDown: 1, ArrowUp: 1, ArrowLeft: 1, ArrowRight: 1, ' ': 1, Spacebar: 1, Space: 1 };

    // Document level, so the game answers as soon as the frame has focus and
    // never needs a click first.
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (STOP[k] || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      self.keys[k.length === 1 ? k.toLowerCase() : k] = true;
      if (e.code === 'Space') self.keys[' '] = true;
      if (k === 'r' || k === 'R') self.hooks.restart(true);
      else if ((k === 'ArrowDown' || k === ' ' || e.code === 'Space') && self.hooks.isOver()) self.hooks.restart(false);
      self.hooks.firstInput();
      self.sync();
    }, { passive: false });

    document.addEventListener('keyup', function (e) {
      var k = e.key;
      if (STOP[k] || e.code === 'Space') e.preventDefault();
      self.keys[k.length === 1 ? k.toLowerCase() : k] = false;
      if (e.code === 'Space') self.keys[' '] = false;
      self.sync();
    }, { passive: false });

    window.addEventListener('blur', function () { self.keys = {}; self.release(); self.sync(); });

    var c = this.canvas;
    var down = function (e) {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') self.touch = true;
      if (self.stick.id !== null && self.stick.id !== e.pointerId) return;
      e.preventDefault();
      var p = self.pos(e);
      if (self.hooks.hitMute(p.x, p.y)) {
        self.muted = !self.muted;
        self.hooks.setMuted(self.muted);
        self.hooks.firstInput();
        return;
      }
      if (self.hooks.isOver()) { self.hooks.restart(false); }
      self.stick.active = true;
      self.stick.id = e.pointerId;
      self.stick.ax = p.x; self.stick.ay = p.y;
      self.stick.dx = 0; self.stick.dy = 0; self.stick.throttle = 0;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      self.hooks.firstInput();
      self.sync();
    };
    var move = function (e) {
      if (!self.stick.active || e.pointerId !== self.stick.id) return;
      e.preventDefault();
      var p = self.pos(e);
      self.stick.dx = p.x - self.stick.ax;
      self.stick.dy = p.y - self.stick.ay;
      // Let the anchor trail a finger that wanders far, so a long drag never
      // pins the stick at full deflection for the rest of the run.
      var maxR = 96;
      if (self.stick.dy < -maxR) { self.stick.ay += self.stick.dy + maxR; self.stick.dy = -maxR; }
      if (self.stick.dy > maxR * 1.6) { self.stick.ay += self.stick.dy - maxR * 1.6; self.stick.dy = maxR * 1.6; }
      if (self.stick.dx > maxR) { self.stick.ax += self.stick.dx - maxR; self.stick.dx = maxR; }
      if (self.stick.dx < -maxR) { self.stick.ax += self.stick.dx + maxR; self.stick.dx = -maxR; }
      self.sync();
    };
    var up = function (e) {
      if (e.pointerId !== self.stick.id) return;
      e.preventDefault();
      self.release();
      self.sync();
    };

    c.addEventListener('pointerdown', down, { passive: false });
    c.addEventListener('pointermove', move, { passive: false });
    c.addEventListener('pointerup', up, { passive: false });
    c.addEventListener('pointercancel', up, { passive: false });
    c.addEventListener('lostpointercapture', up, { passive: false });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // belt and braces against the page ever scrolling under a thumb
    document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });

    if (window.matchMedia && window.matchMedia('(hover: none)').matches) this.touch = true;
  };

  Input.prototype.pos = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  Input.prototype.release = function () {
    this.stick.active = false;
    this.stick.id = null;
    this.stick.dx = this.stick.dy = 0;
    this.stick.throttle = 0;
  };

  Input.prototype.sync = function () {
    var k = this.keys;
    var kAccel = !!(k['ArrowDown'] || k[' ']);
    var kLeft = !!k['ArrowLeft'], kRight = !!k['ArrowRight'];

    var s = this.stick;
    var pAccel = false, pSteer = 0;
    if (s.active) {
      s.throttle = Math.max(0, Math.min(1, (s.dy - ACCEL_DEAD) / (ACCEL_FULL - ACCEL_DEAD)));
      pAccel = s.throttle > 0;
      var ax = Math.abs(s.dx);
      if (ax > STEER_DEAD) {
        pSteer = Math.sign(s.dx) * Math.min(1, (ax - STEER_DEAD) / (STEER_FULL - STEER_DEAD));
      }
    }

    var steer = (kRight ? 1 : 0) - (kLeft ? 1 : 0);
    if (steer === 0) steer = pSteer;

    this.state.accel = kAccel || pAccel;
    this.state.left = kLeft || pSteer < -0.5;
    this.state.right = kRight || pSteer > 0.5;
    this.state.steer = steer;
    // Push it straight into the simulation rather than waiting for a frame, so
    // an input followed by advance() behaves the same with or without a screen.
    if (this.hooks.onInput) this.hooks.onInput(this.state);
  };

  Input.prototype.readSafeArea = function (probe) {
    if (!probe) return;
    var cs = getComputedStyle(probe);
    this.safeTop = parseFloat(cs.paddingTop) || 0;
    this.safeBottom = parseFloat(cs.paddingBottom) || 0;
  };

  DELVE.Input = Input;
})(typeof window !== 'undefined' ? window : globalThis);
