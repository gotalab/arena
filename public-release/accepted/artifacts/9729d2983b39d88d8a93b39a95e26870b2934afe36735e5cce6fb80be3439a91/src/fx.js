/* DELVE — juice. Particles, shake, flashes, floating labels.
 * Strictly view-only: the rules never read anything in here, and nothing in
 * here is allowed to touch the simulation. Effects live in world space so they
 * scroll with the corridor, and they are budgeted so they can never bury the
 * line ahead, the next gap, or the timer.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});
  var Art = DELVE.Art;
  var P = Art.palette;

  var MAX = 220;

  function Fx() {
    this.p = [];
    this.shake = 0;
    this.shakeAng = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.chroma = 0;
    this.timerPulse = 0;
    this.powerPulse = 0;
    this.comboPop = 0;
    this.hitFreeze = 0;
  }

  Fx.prototype.clear = function () {
    this.p.length = 0;
    this.shake = this.flash = this.chroma = 0;
    this.timerPulse = this.powerPulse = this.comboPop = this.hitFreeze = 0;
  };

  Fx.prototype.add = function (o) {
    if (this.p.length >= MAX) this.p.shift();
    this.p.push(o);
    return o;
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------- kicks --
  Fx.prototype.kick = function (mag) { this.shake = Math.min(14, this.shake + mag); };

  Fx.prototype.sparkBurst = function (x, d, n, color, spread, speed, life) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, Math.PI * 2);
      var v = rnd(speed * 0.35, speed);
      this.add({
        t: 'spark', x: x, d: d,
        vx: Math.cos(a) * v * spread, vd: Math.sin(a) * v,
        life: rnd(life * 0.6, life), age: 0, r: rnd(0.9, 2.4), c: color
      });
    }
  };

  Fx.prototype.fragment = function (x, d, chain) {
    this.sparkBurst(x, d, 12, P.mint, 1, 62, 0.5);
    this.add({ t: 'ring', x: x, d: d, r0: 4, r1: 26, life: 0.36, age: 0, c: P.mint, w: 2.4 });
    this.add({
      t: 'label', x: x, d: d, life: 0.85, age: 0,
      text: '+' + (DELVE.C.FRAGMENT_MS / 1000).toFixed(1) + 's',
      c: P.mint, size: 11 + Math.min(4, chain)
    });
    this.timerPulse = 1;
    for (var i = 0; i < 3; i++) {
      this.add({
        t: 'shard', x: x, d: d, vx: rnd(-40, 40), vd: rnd(-50, 20),
        life: 0.45, age: 0, r: rnd(1.6, 3), spin: rnd(-9, 9), rot: rnd(0, 6), c: P.mint
      });
    }
  };

  Fx.prototype.rockBreak = function (x, d, r, powered) {
    var n = Math.min(18, 7 + Math.round(r * 0.55));
    for (var i = 0; i < n; i++) {
      var a = rnd(0, Math.PI * 2);
      var v = rnd(30, 90) * (powered ? 1.35 : 1);
      this.add({
        t: 'chunk', x: x + Math.cos(a) * r * 0.4, d: d + Math.sin(a) * r * 0.4,
        vx: Math.cos(a) * v, vd: Math.sin(a) * v - 20,
        life: rnd(0.45, 0.9), age: 0, r: rnd(r * 0.12, r * 0.32),
        spin: rnd(-11, 11), rot: rnd(0, 6), c: powered ? '#c98be0' : '#4a3a78'
      });
    }
    this.sparkBurst(x, d, powered ? 16 : 8, powered ? P.gold : '#b9a2f0', 1, 80, 0.4);
    this.add({ t: 'dust', x: x, d: d, r0: r * 0.8, r1: r * 3.2, life: 0.55, age: 0, c: '#6a58a0' });
    if (powered) {
      this.add({ t: 'ring', x: x, d: d, r0: r, r1: r * 4, life: 0.4, age: 0, c: P.gold, w: 3 });
      this.add({ t: 'label', x: x, d: d, life: 0.8, age: 0, text: '+' + (DELVE.C.POWER_BREAK_MS / 1000).toFixed(1) + 's', c: P.gold, size: 12 });
    }
  };

  Fx.prototype.rockHit = function (x, d, r, px) {
    this.kick(9);
    this.flash = 0.55;
    this.flashColor = '#ffd9b0';
    this.hitFreeze = 0.07;
    this.add({ t: 'ring', x: x, d: d, r0: r * 0.6, r1: r * 5, life: 0.42, age: 0, c: '#ffb0a0', w: 3.4 });
    this.sparkBurst(px, d, 14, '#ffd0a0', 1, 110, 0.45);
  };

  Fx.prototype.wallHit = function (x, d, side) {
    this.kick(7.5);
    this.flash = 0.35;
    this.flashColor = '#ffc59a';
    this.hitFreeze = 0.05;
    for (var i = 0; i < 14; i++) {
      this.add({
        t: 'spark', x: x, d: d + rnd(-6, 10),
        vx: -side * rnd(10, 60), vd: rnd(-90, -20),
        life: rnd(0.2, 0.5), age: 0, r: rnd(0.8, 2.2), c: i % 3 ? '#ffcf9a' : '#ff8f5a'
      });
    }
    this.add({ t: 'dust', x: x, d: d, r0: 4, r1: 26, life: 0.5, age: 0, c: '#7a63b8' });
  };

  // Consecutive near-misses escalate: each ring is wider, brighter and louder
  // in the body of the scene than the one before it.
  Fx.prototype.nearMiss = function (x, d, r, gap, combo, side) {
    var close = 1 - Math.min(1, gap / DELVE.C.NEAR_MISS_WINDOW); // 1 == hair's width
    var esc = Math.min(1, (combo - 1) / 6);
    var col = combo >= 5 ? P.rose : combo >= 3 ? P.gold : '#cfe6ff';
    this.add({
      t: 'ring', x: x, d: d, r0: r * 0.8, r1: r * (1.5 + 0.7 * close) + 6 * esc,
      life: 0.3 + 0.2 * esc, age: 0, c: col, w: 1.6 + 3.2 * close + 2 * esc
    });
    this.add({
      t: 'swoosh', x: x, d: d, side: side, r: r, life: 0.28 + 0.14 * esc, age: 0,
      c: col, mag: 0.5 + close + esc
    });
    this.kick(1.6 + 4.4 * close + 3.4 * esc);
    this.chroma = Math.max(this.chroma, 0.3 * close + 0.5 * esc);
    this.comboPop = 1;
    this.sparkBurst(x, d, Math.round(3 + 7 * close), col, 1, 60 + 60 * close, 0.32);
  };

  Fx.prototype.power = function (x, d) {
    this.flash = 0.7;
    this.flashColor = '#ffe9a8';
    this.powerPulse = 1;
    this.kick(6);
    for (var i = 0; i < 3; i++) {
      this.add({ t: 'ring', x: x, d: d, r0: 5 + i * 6, r1: 34 + i * 15, life: 0.5 + i * 0.12, age: -i * 0.07, c: i % 2 ? P.gold : P.rose, w: 3.4 - i * 0.8 });
    }
    this.sparkBurst(x, d, 26, P.gold, 1, 130, 0.75);
  };

  Fx.prototype.runEnd = function (x, d) {
    this.kick(10);
    this.flash = 0.5;
    this.flashColor = '#20143a';
    this.sparkBurst(x, d, 18, '#8f7ad0', 1, 60, 1.1);
    this.add({ t: 'dust', x: x, d: d, r0: 6, r1: 60, life: 1.1, age: 0, c: '#3b2c68' });
  };

  // exhaust trail while the accelerator is held
  Fx.prototype.exhaust = function (x, d, throttle, sf, powered) {
    if (Math.random() > 0.25 + 0.7 * throttle) return;
    var side = Math.random() < 0.5 ? -1 : 1;
    this.add({
      t: 'puff', x: x + side * 4.6, d: d - 13,
      vx: side * rnd(4, 22), vd: rnd(-60, -20) - sf * 60,
      life: rnd(0.28, 0.6), age: 0, r: rnd(2.2, 4.6) + sf * 2,
      c: powered ? P.gold : (sf > 0.65 ? '#ffd9a0' : P.amber)
    });
  };

  // dust motes streaming past — the world rushing
  Fx.prototype.ambient = function (x, d, halfW, sf) {
    if (Math.random() > 0.35 + 0.6 * sf) return;
    this.add({
      t: 'mote', x: x + rnd(-halfW, halfW), d: d + rnd(130, 230),
      vx: 0, vd: -rnd(10, 40), life: rnd(1.4, 2.6), age: 0,
      r: rnd(0.5, 1.6), c: Math.random() > 0.85 ? P.mint : '#8b7ac0'
    });
  };

  // ---------------------------------------------------------------- step --
  Fx.prototype.update = function (dt) {
    var p = this.p;
    for (var i = p.length - 1; i >= 0; i--) {
      var o = p[i];
      o.age += dt;
      if (o.age < 0) continue;
      if (o.age >= o.life) { p.splice(i, 1); continue; }
      if (o.vx !== undefined) { o.x += o.vx * dt; o.d += o.vd * dt; }
      if (o.t === 'chunk' || o.t === 'shard') { o.vd += 150 * dt; o.rot += o.spin * dt; }
      if (o.t === 'spark' || o.t === 'puff') { o.vx *= 1 - 2.2 * dt; o.vd *= 1 - 2.2 * dt; }
      if (o.t === 'label') o.d -= 26 * dt;
    }
    this.shake *= Math.pow(0.0016, dt);
    this.flash *= Math.pow(0.004, dt);
    this.chroma *= Math.pow(0.06, dt);
    this.timerPulse *= Math.pow(0.02, dt);
    this.powerPulse *= Math.pow(0.05, dt);
    this.comboPop *= Math.pow(0.01, dt);
    if (this.hitFreeze > 0) this.hitFreeze -= dt;
  };

  // ---------------------------------------------------------------- draw --
  // toScreen(x, depth) -> {sx, sy}; u = pixels per world unit
  Fx.prototype.draw = function (ctx, cam, u, back) {
    var p = this.p;
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < p.length; i++) {
      var o = p[i];
      if (o.age < 0) continue;
      var k = o.age / o.life;
      var alpha = 1 - k;
      var sx = cam.sx(o.x), sy = cam.sy(o.d);
      if (sy < -80 || sy > cam.h + 80) continue;
      var isBack = o.t === 'mote' || o.t === 'dust' || o.t === 'puff';
      if (isBack !== back) continue;

      if (o.t === 'spark') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = o.c;
        ctx.beginPath();
        ctx.arc(sx, sy, o.r * u * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (o.t === 'mote') {
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = o.c;
        ctx.fillRect(sx, sy, o.r * u, o.r * u * (1 + cam.streak * 6));
      } else if (o.t === 'puff') {
        Art.blob(ctx, sx, sy, o.r * u * (1 + k * 1.6), o.c, alpha * 0.42);
      } else if (o.t === 'dust') {
        Art.blob(ctx, sx, sy, (o.r0 + (o.r1 - o.r0) * k) * u, o.c, alpha * 0.34);
      } else if (o.t === 'chunk' || o.t === 'shard') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(o.rot);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = o.c;
        var rr = o.r * u;
        ctx.beginPath();
        ctx.moveTo(-rr, -rr * 0.7); ctx.lineTo(rr * 0.8, -rr);
        ctx.lineTo(rr, rr * 0.6); ctx.lineTo(-rr * 0.6, rr);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (o.t === 'ring') {
        var r = (o.r0 + (o.r1 - o.r0) * (1 - Math.pow(1 - k, 2))) * u;
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = o.c;
        ctx.lineWidth = o.w * (1 - k) * Math.max(0.6, u * 0.5);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (o.t === 'swoosh') {
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = o.c;
        ctx.lineWidth = (1.4 + 2.4 * o.mag) * Math.max(0.6, u * 0.5) * (1 - k);
        var rad = (o.r + 3 + 5 * o.mag + k * 7) * u;
        var a0 = o.side > 0 ? -0.62 : Math.PI - 0.62;
        var a1 = o.side > 0 ? 0.62 : Math.PI + 0.62;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, a0, a1);
        ctx.stroke();
      } else if (o.t === 'label') {
        ctx.globalAlpha = Math.min(1, alpha * 2.2);
        ctx.font = '900 ' + (o.size * u * 0.62 + 7) + 'px ' + Art.FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(12,8,24,0.85)';
        ctx.lineWidth = 3.5;
        ctx.strokeText(o.text, sx, sy);
        ctx.fillStyle = o.c;
        ctx.fillText(o.text, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  DELVE.Fx = Fx;
})(typeof window !== 'undefined' ? window : globalThis);
