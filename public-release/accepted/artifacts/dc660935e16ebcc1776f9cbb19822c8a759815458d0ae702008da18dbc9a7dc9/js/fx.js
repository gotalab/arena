/* EMBER — view-only juice.
 *
 * Every particle, ring, banner and shake in here is dressing: it is spawned
 * from events the rules already produced, it is driven by real frame time, and
 * it can never touch the simulation or a collision. Budget first — feedback
 * clears out fast so it never hides the aim, the next perch, or the damp.
 */
(function (E) {
  'use strict';

  var MAX = 620;
  var P = [];            // world-space particles
  var RINGS = [];
  var BANNERS = [];      // screen-space celebration text
  var shakeMag = 0, shakeT = 0, shakeDur = 0.001;
  var flashA = 0, flashCol = [255, 200, 120];

  function rnd(a, b) { return a + (b - a) * Math.random(); }

  function push(p) {
    if (P.length >= MAX) { P.shift(); }
    P.push(p);
  }

  function part(kind, x, y, vx, vy, life, size, col, opt) {
    opt = opt || {};
    push({
      k: kind, x: x, y: y, vx: vx, vy: vy,
      t: 0, life: life, size: size, col: col,
      grav: opt.grav === undefined ? 0 : opt.grav,
      drag: opt.drag === undefined ? 1.1 : opt.drag,
      rot: opt.rot === undefined ? rnd(0, 1) : opt.rot,
      vrot: opt.vrot === undefined ? rnd(-2, 2) : opt.vrot,
      grow: opt.grow === undefined ? 0 : opt.grow,
      add: opt.add === undefined ? true : opt.add
    });
  }

  function reset() {
    P.length = 0; RINGS.length = 0; BANNERS.length = 0;
    shakeMag = 0; shakeT = 0; flashA = 0;
  }

  /* ------------------------------------------------------------ spawners */

  var EMBER_COLS = [[255, 236, 180], [255, 186, 76], [255, 132, 48], [255, 92, 46]];
  var CHAIN_COLS = [
    [255, 190, 90], [255, 214, 110], [255, 236, 150], [255, 250, 205],
    [220, 250, 255], [190, 245, 255], [235, 220, 255]
  ];

  function chainCol(link) {
    var i = Math.min(CHAIN_COLS.length - 1, Math.floor((link - 1) * 0.9));
    return CHAIN_COLS[i];
  }

  function trail(x, y, vx, vy, amt) {
    var n = amt > 0.7 ? 2 : 1;
    for (var i = 0; i < n; i++) {
      part('ember', x + rnd(-1, 1), y + rnd(-1, 1),
        -vx * 0.06 + rnd(-8, 8), -vy * 0.06 + rnd(-8, 8),
        rnd(0.2, 0.44), rnd(0.3, 0.72),
        EMBER_COLS[Math.floor(rnd(0, 2.99))], { grav: 12, drag: 2.2 });
    }
  }

  function launchBurst(x, y, dx, dy, power) {
    var n = 10 + Math.round(10 * power);
    for (var i = 0; i < n; i++) {
      var a = rnd(-0.9, 0.9);
      var sp = rnd(20, 90) * (0.5 + power);
      var ux = -dx, uy = -dy;
      var rx = ux * Math.cos(a) - uy * Math.sin(a);
      var ry = ux * Math.sin(a) + uy * Math.cos(a);
      part('ember', x, y, rx * sp, ry * sp, rnd(0.25, 0.6), rnd(0.34, 0.9),
        EMBER_COLS[Math.floor(rnd(0, 3.99))], { grav: 40, drag: 2.4 });
    }
    ring(x, y, 1.2, 4.5 + 3 * power, [255, 180, 90], 0.2, 0.6);
  }

  function landBurst(x, y, kind, hard) {
    var n = kind === 'wall' ? 7 : 11;
    for (var i = 0; i < n; i++) {
      part('soot', x + rnd(-2.5, 2.5), y - 2 + rnd(-1, 1),
        rnd(-24, 24), rnd(2, 24), rnd(0.35, 0.75), rnd(0.9, 2.0),
        [58, 44, 58], { grav: -6, drag: 1.7, grow: 2.2, add: false });
    }
    for (var j = 0; j < 6; j++) {
      part('ember', x + rnd(-3, 3), y - 2, rnd(-40, 40), rnd(10, 55),
        rnd(0.2, 0.5), rnd(0.3, 0.7), EMBER_COLS[1], { grav: 60, drag: 2.6 });
    }
    ring(x, y - 2.5, 1.5, 6, [255, 160, 80], 0.2, 0.5);
    shake(hard ? 3.2 : 1.6);
  }

  function mothBurst(x, y, link) {
    var col = chainCol(link);
    for (var i = 0; i < 16; i++) {
      var a = rnd(0, 1) * Math.PI * 2;
      var sp = rnd(14, 74);
      part('soot', x, y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.35, 0.85),
        rnd(0.8, 1.9), [52, 42, 60], { grav: -8, drag: 1.9, grow: 2.4, add: false });
    }
    for (var j = 0; j < 10; j++) {
      var b = rnd(0, 1) * Math.PI * 2;
      part('dust', x, y, Math.cos(b) * rnd(10, 55), Math.sin(b) * rnd(10, 55),
        rnd(0.5, 1.1), rnd(0.5, 1.3), [206, 188, 214], { grav: -14, drag: 1.3, add: false });
    }
    for (var k = 0; k < 8; k++) {
      part('ember', x, y, rnd(-60, 60), rnd(-30, 90), rnd(0.25, 0.6), rnd(0.34, 0.85),
        col, { grav: 30, drag: 2.4 });
    }
    ring(x, y, 1.2, 6 + Math.min(link, 8) * 1.1, col, 0.24, 0.7);
    flash(0.10 + Math.min(link, 8) * 0.015, col);
    shake(2.4 + Math.min(link, 9) * 0.55);
  }

  function glimmerPop(x, y, chain) {
    for (var i = 0; i < 14; i++) {
      var a = rnd(0, 1) * Math.PI * 2;
      var sp = rnd(16, 70);
      part('shard', x, y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.35, 0.8),
        rnd(0.5, 1.25), [255, 226, 150], { grav: 20, drag: 2.0 });
    }
    for (var j = 0; j < 5; j++) {
      part('mote', x + rnd(-3, 3), y + rnd(-3, 3), rnd(-8, 8), rnd(14, 34),
        rnd(0.6, 1.2), rnd(0.5, 1.1), [255, 244, 200], { drag: 1.2 });
    }
    ring(x, y, 1.2, 6.5, [255, 224, 150], 0.24, 0.55);
    flash(0.07, [255, 226, 160]);
    shake(1.4);
  }

  function chainPulse(x, y, link) {
    var col = chainCol(link);
    var k = Math.min(link, 10);
    ring(x, y, 1.5, 5.5 + k * 1.7, col, 0.26 + 0.02 * k, 0.45 + 0.1 * k);
    if (link >= 3) { ring(x, y, 1, 3.5 + k * 1.2, [255, 255, 255], 0.16, 0.3); }
    for (var i = 0; i < 3 + k; i++) {
      var a = rnd(0, 1) * Math.PI * 2;
      part('ember', x, y, Math.cos(a) * rnd(20, 40 + k * 9), Math.sin(a) * rnd(20, 40 + k * 9),
        rnd(0.3, 0.7), rnd(0.34, 0.85), col, { grav: 25, drag: 2.2 });
    }
  }

  function bankBurst(x, y, links) {
    var big = Math.min(1, links / 8);
    for (var i = 0; i < 18 + Math.round(26 * big); i++) {
      part('ember', x + rnd(-4, 4), y + rnd(-2, 2), rnd(-70, 70), rnd(30, 150 + 90 * big),
        rnd(0.45, 1.05), rnd(0.32, 0.85), EMBER_COLS[Math.floor(rnd(0, 3.99))],
        { grav: 130, drag: 1.5 });
    }
    ring(x, y, 1.5, 8 + 9 * big, [255, 214, 130], 0.34, 0.6 + big * 0.5);
    flash(0.08 + 0.1 * big, [255, 210, 140]);
    shake(3 + 5 * big);
  }

  function deathFx(x, y) {
    for (var i = 0; i < 26; i++) {
      var a = rnd(0, 1) * Math.PI * 2;
      part('mist', x + rnd(-6, 6), y + rnd(-4, 4), Math.cos(a) * rnd(4, 26),
        Math.abs(Math.sin(a)) * rnd(6, 40), rnd(0.8, 1.8), rnd(2, 5.5),
        [120, 220, 224], { grav: -4, drag: 1.1, grow: 5, add: false });
    }
    for (var j = 0; j < 12; j++) {
      part('ember', x, y, rnd(-30, 30), rnd(-10, 40), rnd(0.4, 1.0), rnd(0.32, 0.8),
        [120, 200, 220], { grav: 40, drag: 2 });
    }
    ring(x, y, 1.5, 12, [140, 235, 230], 0.55, 0.8);
    shake(7);
    flash(0.16, [90, 200, 210]);
  }

  function ring(x, y, r0, r1, col, life, w) {
    if (RINGS.length > 40) { RINGS.shift(); }
    RINGS.push({ x: x, y: y, r0: r0, r1: r1, col: col, t: 0, life: life, w: w });
  }

  function banner(text, sub, level, col) {
    if (BANNERS.length > 5) { BANNERS.shift(); }
    BANNERS.push({ text: text, sub: sub || '', level: level || 1, t: 0, life: 1.15, col: col || [255, 214, 130] });
  }

  function shake(m) { if (m > shakeMag) { shakeMag = m; shakeT = 0; shakeDur = 0.18 + m * 0.02; } }
  function flash(a, col) { if (a > flashA) { flashA = a; flashCol = col || flashCol; } }

  /* -------------------------------------------------------------- update */

  function update(dt) {
    var i, p;
    for (i = P.length - 1; i >= 0; i--) {
      p = P[i];
      p.t += dt;
      if (p.t >= p.life) { P.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      var d = 1 - p.drag * dt;
      if (d < 0) { d = 0; }
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.grow) { p.size += p.grow * dt; }
    }
    for (i = RINGS.length - 1; i >= 0; i--) {
      RINGS[i].t += dt;
      if (RINGS[i].t >= RINGS[i].life) { RINGS.splice(i, 1); }
    }
    for (i = BANNERS.length - 1; i >= 0; i--) {
      BANNERS[i].t += dt;
      if (BANNERS[i].t >= BANNERS[i].life) { BANNERS.splice(i, 1); }
    }
    shakeT += dt;
    if (shakeT >= shakeDur) { shakeMag = 0; }
    flashA -= dt * 0.9;
    if (flashA < 0) { flashA = 0; }
  }

  function shakeOffset() {
    if (shakeMag <= 0) { return [0, 0]; }
    var k = 1 - shakeT / shakeDur;
    var m = shakeMag * k * k;
    return [(Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m];
  }

  /* ---------------------------------------------------------------- draw */

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // called inside the world transform (y up, units = world units)
  function drawWorld(ctx) {
    var i, p, a, s;
    ctx.save();

    // additive pass
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < P.length; i++) {
      p = P[i];
      if (!p.add) { continue; }
      a = 1 - p.t / p.life;
      s = p.size * (0.4 + 0.6 * a);
      if (p.k === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * 6.283);
        ctx.fillStyle = rgba(p.col, a * 0.95);
        ctx.beginPath();
        ctx.moveTo(0, s * 2.2); ctx.lineTo(s * 0.5, 0);
        ctx.lineTo(0, -s * 2.2); ctx.lineTo(-s * 0.5, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (p.k === 'ember') {
        // a spark, not a bubble: hot core, soft halo, stretched by its own speed
        var sp2 = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        ctx.save();
        ctx.translate(p.x, p.y);
        if (sp2 > 2) { ctx.rotate(Math.atan2(p.vy, p.vx)); }
        ctx.scale(1 + (sp2 > 200 ? 2 : sp2 / 100), 1);
        ctx.fillStyle = rgba(p.col, a * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.15, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = rgba(p.col, a * 0.92);
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.5, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = rgba(p.col, a * 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s * 0.8, 0, 6.2832);
        ctx.fill();
      }
    }
    for (i = 0; i < RINGS.length; i++) {
      var r = RINGS[i];
      var k = r.t / r.life;
      var rr = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      var ra = (1 - k) * (1 - k) * 0.62;
      ctx.save();
      ctx.strokeStyle = rgba(r.col, ra);
      ctx.lineWidth = r.w * (1 - k * 0.55);
      ctx.shadowColor = rgba(r.col, ra * 0.8);
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rr, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }

    // soft pass (soot, dust, mist)
    ctx.globalCompositeOperation = 'source-over';
    for (i = 0; i < P.length; i++) {
      p = P[i];
      if (p.add) { continue; }
      a = 1 - p.t / p.life;
      s = p.size * (0.6 + 0.7 * (1 - a));
      if (p.k === 'dust') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * 6.283);
        ctx.fillStyle = rgba(p.col, a * 0.6);
        ctx.fillRect(-s, -s * 0.4, s * 2, s * 0.8);
        ctx.restore();
      } else {
        ctx.fillStyle = rgba(p.col, a * (p.k === 'mist' ? 0.35 : 0.34));
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  E.Fx = {
    reset: reset,
    update: update,
    drawWorld: drawWorld,
    shakeOffset: shakeOffset,
    banners: BANNERS,
    flashAlpha: function () { return flashA; },
    flashColor: function () { return flashCol; },
    rgba: rgba,
    chainCol: chainCol,
    trail: trail,
    launchBurst: launchBurst,
    landBurst: landBurst,
    mothBurst: mothBurst,
    glimmerPop: glimmerPop,
    chainPulse: chainPulse,
    bankBurst: bankBurst,
    deathFx: deathFx,
    ring: ring,
    banner: banner,
    shake: shake,
    flash: flash,
    count: function () { return P.length; }
  };

})(window.EMBER);
