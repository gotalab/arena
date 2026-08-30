/* EMBER — renderer. View only: reads the simulation, never writes to it.
 * Particles, camera, shake and expressions are all downstream of rule state.
 */
(function () {
  'use strict';
  var E = window.EMBER;
  var C = E.C, Art = E.Art, Audio = E.Audio;
  var clamp = E.clamp, lerp = E.lerp;
  var TAU = Math.PI * 2;

  var FONT = '"Trebuchet MS", "Avenir Next", "Segoe UI", system-ui, sans-serif';

  // drawing radii chosen so each silhouette matches its collision circle:
  // the moth's wingspan and the glimmer's star sit right on the hitbox edge.
  var GLIMMER_DRAW = 11;
  var MOTH_DRAW = 13;

  function R() {
    this.canvas = null;
    this.ctx = null;
    this.camBottom = -218;
    this.camInit = false;
    this.visibleH = 640;
    this.scale = 1;
    this.ox = 0; this.oy = 0;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.t = 0;
    this.parts = [];
    this.floats = [];
    this.motes = [];
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this.flash = 0;
    this.burstT = 0;
    this.landT = 0;
    this.launchT = 0;
    this.chainPulse = 0;
    this.chainShown = 0;
    this.blink = 0.4;
    this.blinkT = 2.2;
    this.look = 0;
    this.deathT = 0;
    this.overT = 0;
    this.scoreShown = 0;
    this.hint = { pull: true, midair: false, midairT: 0, empty: false, emptyT: 0, seenMidair: false, seenEmpty: false };
    this.rng = new E.Rng(0xa11ce);
    this.mute = false;
    this.muteBtn = { x: 0, y: 0, r: 15 };
    this.dampPhase = 0;
    this.tendrils = [];
    this.beganAt = 0;
    this.lastChain = 0;
  }

  R.prototype.init = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!Art.built) Art.build();
    for (var i = 0; i < 10; i++) {
      this.tendrils.push({ x: this.rng.range(40, 320), w: this.rng.range(16, 44), p: this.rng.range(0, 6.28), s: this.rng.range(0.35, 0.9), h: this.rng.range(10, 34) });
    }
  };

  R.prototype.layout = function (cssW, cssH, dpr, insets) {
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.insets = insets;
    var scale = cssW / C.STAGE_W;
    var visH = cssH / scale;
    if (visH < 520) { scale = cssH / 520; visH = 520; }
    else if (visH > 1000) { scale = cssH / 1000; visH = 1000; }
    this.scale = scale;
    this.visibleH = visH;
    this.ox = (cssW - C.STAGE_W * scale) * 0.5;
    this.oy = (cssH - visH * scale) * 0.5;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.padTop = insets.top / scale;
    this.padBottom = insets.bottom / scale;
  };

  /* page pointer coordinates -> stage view units */
  R.prototype.toView = function (px, py) {
    return {
      x: (px - (this.rectLeft || 0) - this.ox) / this.scale,
      y: (py - (this.rectTop || 0) - this.oy) / this.scale
    };
  };
  R.prototype.vy = function (worldY) { return this.camBottom + this.visibleH - worldY; };

  /* ------------------------------------------------------------ particles */
  R.prototype.spawn = function (o) {
    if (this.parts.length > 340) this.parts.shift();
    this.parts.push(o);
  };
  R.prototype.burstParts = function (x, y, n, opt) {
    opt = opt || {};
    for (var i = 0; i < n; i++) {
      var a = this.rng.range(0, TAU);
      var sp = this.rng.range(opt.spMin || 40, opt.spMax || 240);
      this.spawn({
        kind: opt.kind || 'ember',
        x: x, y: y,
        vx: Math.cos(a) * sp + (opt.vx || 0),
        vy: Math.sin(a) * sp + (opt.vy || 0),
        g: opt.g === undefined ? -260 : opt.g,
        life: opt.life || this.rng.range(0.35, 0.9),
        max: 0,
        r: opt.r || this.rng.range(1.2, 3.4),
        col: opt.col || null,
        rot: this.rng.range(0, TAU),
        spin: this.rng.range(-8, 8),
        drag: opt.drag === undefined ? 1.6 : opt.drag
      });
      this.parts[this.parts.length - 1].max = this.parts[this.parts.length - 1].life;
    }
  };
  R.prototype.ring = function (x, y, r0, r1, life, col, w) {
    this.spawn({ kind: 'ring', x: x, y: y, r: r0, r1: r1, life: life, max: life, col: col || '255,190,90', w: w || 2.5, vx: 0, vy: 0, g: 0, drag: 0 });
  };
  R.prototype.float = function (x, y, text, size, col, glow) {
    if (this.floats.length > 24) this.floats.shift();
    this.floats.push({ x: x, y: y, text: text, size: size, col: col, glow: glow || 0, life: 1.25, max: 1.25, vy: 46 });
  };

  R.prototype.updateParts = function (dt) {
    var p, i;
    for (i = this.parts.length - 1; i >= 0; i--) {
      p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      if (p.kind === 'ring') { p.r += (p.r1 - p.r) * Math.min(1, dt * 7); continue; }
      p.vy += p.g * dt;
      if (p.drag) { var f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (i = this.floats.length - 1; i >= 0; i--) {
      var fl = this.floats[i];
      fl.life -= dt;
      fl.y += fl.vy * dt;
      fl.vy *= Math.max(0, 1 - 1.4 * dt);
      if (fl.life <= 0) this.floats.splice(i, 1);
    }
  };

  /* ------------------------------------------------------- event handling */
  R.prototype.consume = function (sim) {
    var q = sim.viewEvents;
    for (var i = 0; i < q.length; i++) {
      var ev = q[i];
      switch (ev.kind) {
        case 'launch': {
          this.launchT = 1;
          this.shake = Math.max(this.shake, 1.4 + 2.2 * ev.power);
          var ang = Math.atan2(-ev.vy, ev.vx);
          this.burstParts(ev.x, ev.y, 10 + Math.round(10 * ev.power), {
            spMin: 30, spMax: 130 + 120 * ev.power, life: 0.5,
            vx: -ev.vx * 0.16, vy: -ev.vy * 0.16, g: -200, r: 2.2
          });
          this.ring(ev.x, ev.y, 6, 30 + 26 * ev.power, 0.3, '255,200,120', 2.4);
          Audio.launch(ev.power, ev.midair ? ev.chain : 0);
          break;
        }
        case 'land': {
          this.landT = 1;
          this.shake = Math.max(this.shake, 1.2 + 2.6 * ev.hard);
          this.burstParts(ev.x, ev.y - 8, 8 + Math.round(10 * ev.hard), {
            kind: 'dust', spMin: 20, spMax: 90 + 90 * ev.hard, g: 40, life: 0.65,
            col: '120,104,140', r: 3.2, drag: 2.6
          });
          this.ring(ev.x, ev.y - 6, 4, 26 + 20 * ev.hard, 0.34, '255,180,110', 2);
          Audio.land(ev.hard);
          break;
        }
        case 'bounce': {
          this.burstT = 1;
          var n = ev.chain;
          var mag = Math.min(1, 0.3 + n * 0.12);
          this.shake = Math.max(this.shake, 2.2 + 3.4 * mag);
          this.flash = Math.max(this.flash, 0.18 + 0.22 * mag);
          this.burstParts(ev.x, ev.y, 14 + n * 3, { kind: 'scrap', spMin: 60, spMax: 200 + 40 * n, g: -160, life: 0.8, col: '150,126,190', r: 2.6 });
          this.burstParts(ev.x, ev.y, 10 + n * 2, { spMin: 40, spMax: 180 + 30 * n, g: -240, life: 0.55, r: 2.2 });
          this.ring(ev.x, ev.y, 8, 44 + 12 * n, 0.36, '200,170,255', 3);
          Audio.burst(n);
          break;
        }
        case 'glimmer': {
          this.flash = Math.max(this.flash, 0.14);
          this.shake = Math.max(this.shake, 1.6);
          this.burstParts(ev.x, ev.y, 16, { spMin: 50, spMax: 220, g: -120, life: 0.75, col: '255,225,150', r: 2.4 });
          this.ring(ev.x, ev.y, 6, 40, 0.4, '255,225,150', 2.6);
          this.float(ev.x, ev.y - 12, '+' + ev.value, 15, '#ffe9a8', 1);
          Audio.glimmer(ev.chain);
          break;
        }
        case 'chain': {
          var k = ev.n;
          this.chainPulse = 1;
          this.chainShown = k;
          this.ring(ev.x, ev.y, 10, 40 + 16 * k, 0.45 + 0.03 * k, k >= 5 ? '255,240,210' : '255,180,110', 2 + 0.5 * Math.min(k, 6));
          if (k >= 2) {
            this.burstParts(ev.x, ev.y, Math.min(26, 4 + k * 3), { spMin: 60, spMax: 120 + 30 * k, g: -180, life: 0.6 + 0.04 * k, r: 2 });
          }
          if (k >= 3) this.float(ev.x, ev.y - 20, '×' + k, 13 + Math.min(k, 8) * 1.6, k >= 6 ? '#fff6d8' : '#ffc76a', 1);
          break;
        }
        case 'chainBank': {
          this.flash = Math.max(this.flash, 0.1 + 0.03 * ev.n);
          this.shake = Math.max(this.shake, 2 + Math.min(6, ev.n));
          this.float(ev.x, ev.y + 16, 'CHAIN ×' + ev.n, 15, '#ffd27a', 1);
          this.float(ev.x, ev.y + 34, '+' + ev.value, 19, '#fff3c4', 1);
          this.burstParts(ev.x, ev.y, 12 + ev.n * 4, { spMin: 70, spMax: 180 + 26 * ev.n, g: -140, life: 0.9, col: '255,205,120', r: 2.6 });
          this.ring(ev.x, ev.y, 10, 60 + 14 * ev.n, 0.6, '255,220,150', 3);
          Audio.bank(ev.n);
          break;
        }
        case 'empty':
          this.shake = Math.max(this.shake, 1.4);
          Audio.empty();
          break;
        case 'slip':
          this.burstParts(ev.x, ev.y, 2, { kind: 'dust', spMin: 8, spMax: 30, g: 60, life: 0.5, col: '110,96,130', r: 2 });
          Audio.slip();
          break;
        case 'death':
          this.deathT = 0.0001;
          this.shake = Math.max(this.shake, 9);
          this.flash = Math.max(this.flash, 0.2);
          this.burstParts(ev.x, ev.y, 26, { kind: 'dust', spMin: 40, spMax: 200, g: 120, life: 1.1, col: '110,200,190', r: 3 });
          Audio.death();
          Audio.rank(ev.tier);
          break;
        case 'begin':
          this.hint.pull = false;
          this.beganAt = this.t;
          break;
        case 'reset':
          this.parts.length = 0;
          this.floats.length = 0;
          this.deathT = 0; this.overT = 0; this.scoreShown = 0;
          this.chainShown = 0; this.chainPulse = 0;
          this.shake = 0; this.flash = 0;
          this.camInit = false;
          this.hint.pull = true;
          this.hint.midairT = 0; this.hint.emptyT = 0;
          break;
      }
    }
    q.length = 0;
  };

  /* ----------------------------------------------------------------- text */
  function setFont(ctx, size, weight) {
    ctx.font = (weight || 700) + ' ' + size.toFixed(1) + 'px ' + FONT;
  }
  function text(ctx, str, x, y, size, col, align, weight, glow) {
    setFont(ctx, size, weight);
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.7;
      ctx.fillStyle = col;
      ctx.fillText(str, x, y);
      ctx.restore();
    }
    ctx.fillStyle = col;
    ctx.fillText(str, x, y);
  }
  function tracked(ctx, str, x, y, size, col, track, align, glow) {
    setFont(ctx, size, 700);
    var w = 0, i;
    for (i = 0; i < str.length; i++) w += ctx.measureText(str[i]).width + track;
    w -= track;
    var sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.textAlign = 'left';
    if (glow) { ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = size * 0.8; }
    ctx.fillStyle = col;
    for (i = 0; i < str.length; i++) {
      ctx.fillText(str[i], sx, y);
      sx += ctx.measureText(str[i]).width + track;
    }
    if (glow) ctx.restore();
    return w;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- frame */
  R.prototype.frame = function (sim, dt, alpha) {
    var ctx = this.ctx;
    this.t += dt;
    this.consume(sim);
    this.updateParts(dt);

    // interpolated spark position for a smooth ride
    var pxw = sim.phase === 'gameover' ? sim.x : lerp(sim.px, sim.x, alpha);
    var pyw = sim.phase === 'gameover' ? sim.y : lerp(sim.py, sim.y, alpha);

    // camera
    var visH = this.visibleH;
    var targetBottom = Math.max(pyw - visH * 0.36, sim.dampY - visH * 0.06);
    targetBottom = Math.max(targetBottom, C.FLOOR_Y - 60);
    if (!this.camInit) { this.camBottom = targetBottom; this.camInit = true; }
    else {
      var k = 1 - Math.pow(0.0016, dt);
      this.camBottom += (targetBottom - this.camBottom) * k;
    }

    // decays
    this.launchT = Math.max(0, this.launchT - dt * 4.5);
    this.landT = Math.max(0, this.landT - dt * 3.6);
    this.burstT = Math.max(0, this.burstT - dt * 5.5);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.chainPulse = Math.max(0, this.chainPulse - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.dampPhase += dt;
    if (sim.phase === 'gameover') { this.deathT += dt; this.overT += dt; }
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = this.rng.range(1.6, 4.5); this.blink = 0.18; }
    this.blink = Math.max(0, this.blink - dt);
    this.look += dt;

    var sh = Math.min(this.shake, 8);
    this.shakeX = Math.sin(this.t * 62) * sh * 0.6;
    this.shakeY = Math.cos(this.t * 71) * sh * 0.6;

    // ambient motes
    if (this.motes.length < 46 && this.rng.next() < 0.5) {
      this.motes.push({
        x: this.rng.range(C.WALL_L, C.WALL_R),
        y: this.camBottom - 10,
        vy: this.rng.range(14, 46),
        vx: this.rng.range(-8, 8),
        r: this.rng.range(0.5, 1.7),
        a: this.rng.range(0.15, 0.5),
        p: this.rng.range(0, 6.3)
      });
    }
    for (var mi = this.motes.length - 1; mi >= 0; mi--) {
      var mo = this.motes[mi];
      mo.y += mo.vy * dt;
      mo.x += Math.sin(this.t * 0.7 + mo.p) * 6 * dt + mo.vx * dt;
      if (mo.y > this.camBottom + visH + 20) this.motes.splice(mi, 1);
    }

    /* ---- paint ---- */
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#06050a';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.ox, this.dpr * this.oy);
    ctx.beginPath();
    ctx.rect(0, 0, C.STAGE_W, visH);
    ctx.clip();

    this.drawBackground(ctx, sim);

    ctx.save();
    ctx.translate(this.shakeX, this.shakeY);
    this.drawWalls(ctx, sim);
    this.drawLedges(ctx, sim);
    this.drawParts(ctx, 'back');
    this.drawItems(ctx, sim);
    this.drawSpark(ctx, sim, pxw, pyw);
    this.drawParts(ctx, 'front');
    this.drawFloats(ctx);
    this.drawDamp(ctx, sim);
    ctx.restore();

    this.drawAim(ctx, sim, pxw, pyw);
    this.drawHud(ctx, sim, pxw, pyw);
    this.drawHints(ctx, sim, pxw, pyw);
    if (sim.phase === 'gameover') this.drawGameOver(ctx, sim);

    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,236,200,' + (this.flash * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, C.STAGE_W, visH);
    }
    ctx.restore();

    // surround edges for wide frames
    if (this.ox > 0.5) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      var gg = ctx.createLinearGradient(this.ox - 18, 0, this.ox, 0);
      gg.addColorStop(0, 'rgba(0,0,0,0)');
      gg.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = gg;
      ctx.fillRect(this.ox - 18, 0, 18, this.cssH);
      var gg2 = ctx.createLinearGradient(this.cssW - this.ox + 18, 0, this.cssW - this.ox, 0);
      gg2.addColorStop(0, 'rgba(0,0,0,0)');
      gg2.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = gg2;
      ctx.fillRect(this.cssW - this.ox, 0, 18, this.cssH);
    }

    // audio ambience follows the damp
    var gapNow = sim.y - sim.dampY;
    Audio.setDamp(1 - clamp((gapNow - 60) / 420, 0, 1), clamp(sim.dampSpeed / 120, 0, 1));
    Audio.setTension(clamp(sim.difficulty / 6, 0, 1));
  };

  /* ----------------------------------------------------------- background */
  R.prototype.drawBackground = function (ctx, sim) {
    var visH = this.visibleH;
    var d = clamp(sim.height / 9000, 0, 1);
    var g = ctx.createLinearGradient(0, 0, 0, visH);
    g.addColorStop(0, d > 0.4 ? '#100b22' : '#0b0817');
    g.addColorStop(0.55, '#0d0913');
    g.addColorStop(1, '#160d15');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, C.STAGE_W, visH);

    // the far mouth of the flue: a cold sky glow that strengthens with height
    var sg = ctx.createLinearGradient(0, 0, 0, visH * 0.34);
    sg.addColorStop(0, 'rgba(120,150,220,' + (0.03 + 0.11 * d).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(120,150,220,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, C.STAGE_W, visH * 0.34);

    // far brick layer, parallax
    var tile = Art.farTile;
    var off = ((this.camBottom * 0.42) % tile.height + tile.height) % tile.height;
    if (!this.farPat) this.farPat = ctx.createPattern(tile, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(0, off);
    ctx.fillStyle = this.farPat;
    ctx.fillRect(C.WALL_L - 8, -off, C.WALL_R - C.WALL_L + 16, visH + tile.height);
    ctx.restore();

    // depth haze in the middle of the shaft
    var hz = ctx.createLinearGradient(C.WALL_L, 0, C.WALL_R, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0.55)');
    hz.addColorStop(0.5, 'rgba(20,14,30,0.12)');
    hz.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = hz;
    ctx.fillRect(C.WALL_L, 0, C.WALL_R - C.WALL_L, visH);

    // mid-depth ironwork: brackets and hanging chains, stable per section
    // layer scroll factor f: screenY = visH - wy + camBottom*f
    var sec = 170, f = 0.72;
    var startSec = Math.floor((this.camBottom * f) / sec) - 1;
    var count = Math.ceil(visH / sec) + 3;
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (var s = 0; s < count; s++) {
      var idx = startSec + s;
      var wy = idx * sec;
      var yv = visH - wy + this.camBottom * f;
      if (yv < -60 || yv > visH + 60) continue;
      var h = E.hashf(idx, 71);
      var side = h > 0.5 ? 1 : -1;
      var bx = side < 0 ? C.WALL_L + 14 : C.WALL_R - 14;
      ctx.strokeStyle = 'rgba(70,58,86,0.85)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(bx, yv);
      ctx.lineTo(bx + side * (16 + h * 26), yv + 3);
      ctx.stroke();
      // chain
      var cx = bx + side * (16 + h * 26);
      var links = 4 + Math.floor(E.hashf(idx, 72) * 6);
      ctx.strokeStyle = 'rgba(56,46,70,0.9)';
      ctx.lineWidth = 1.8;
      for (var l = 0; l < links; l++) {
        var ly = yv + 5 + l * 7;
        var wob = Math.sin(this.t * 0.5 + idx + l * 0.4) * 1.2;
        ctx.beginPath();
        ctx.ellipse(cx + wob, ly, 2.6, 3.6, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();

    // ambient motes
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      var y = this.vy(m.y);
      if (y < -10 || y > visH + 10) continue;
      ctx.fillStyle = 'rgba(255,190,120,' + (m.a * (0.6 + 0.4 * Math.sin(this.t * 2 + m.p))).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(m.x, y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------------------------------------------------------------- walls */
  R.prototype.drawWalls = function (ctx, sim) {
    var visH = this.visibleH;
    var tile = Art.wallTile;
    var off = (this.camBottom % tile.height + tile.height) % tile.height;
    if (!this.wallPat) this.wallPat = ctx.createPattern(tile, 'repeat');
    ctx.save();
    ctx.translate(0, off);
    ctx.fillStyle = this.wallPat;
    ctx.fillRect(-40, -off, C.WALL_L + 40, visH + tile.height);
    ctx.fillRect(C.WALL_R, -off, C.STAGE_W - C.WALL_R + 40, visH + tile.height);
    ctx.restore();

    // inner faces: warm rim + slick soot sheen (the walls read as slippery)
    for (var s = -1; s <= 1; s += 2) {
      var x = s < 0 ? C.WALL_L : C.WALL_R;
      var g = ctx.createLinearGradient(x, 0, x - s * 26, 0);
      g.addColorStop(0, 'rgba(255,166,92,0.18)');
      g.addColorStop(0.35, 'rgba(120,70,120,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x, x - s * 26), 0, 26, visH);
      ctx.fillStyle = 'rgba(255,196,130,0.5)';
      ctx.fillRect(x - (s < 0 ? 2 : 0), 0, 2, visH);
      // slick highlight, scrolls with the camera so the soot reads as wet
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var sg = ctx.createLinearGradient(x, 0, x - s * 8, 0);
      sg.addColorStop(0, 'rgba(190,210,255,0.10)');
      sg.addColorStop(1, 'rgba(190,210,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(Math.min(x, x - s * 8), 0, 8, visH);
      ctx.restore();
    }

    // vignette
    var vg = ctx.createRadialGradient(C.STAGE_W / 2, visH * 0.45, visH * 0.24, C.STAGE_W / 2, visH * 0.45, visH * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, C.STAGE_W, visH);
  };

  /* --------------------------------------------------------------- ledges */
  R.prototype.drawLedges = function (ctx, sim) {
    var visH = this.visibleH;
    for (var i = 0; i < sim.ledges.length; i++) {
      var L = sim.ledges[i];
      var y = this.vy(L.y);
      if (y < -40 || y > visH + 60) continue;
      var lit = (sim.anchored && sim.anchorKind === 'ledge' && sim.anchorLedgeId === L.id) ? 1 : 0;
      if (L.hearth) {
        this.drawHearth(ctx, L, y);
      } else {
        Art.drawLedge(ctx, L.x, y, L.hw, L.id, lit);
      }
      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createRadialGradient(sim.x, y, 0, sim.x, y, 46);
        g.addColorStop(0, 'rgba(255,170,80,0.30)');
        g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(L.x - L.hw - 40, y - 40, L.hw * 2 + 80, 46);
        ctx.restore();
      }
    }
  };

  R.prototype.drawHearth = function (ctx, L, y) {
    ctx.save();
    ctx.translate(L.x, y);
    var g = ctx.createLinearGradient(0, -6, 0, 60);
    g.addColorStop(0, '#4a3a54');
    g.addColorStop(0.2, '#2b2135');
    g.addColorStop(1, '#0b0712');
    ctx.fillStyle = g;
    ctx.fillRect(-L.hw, -4, L.hw * 2, 90);
    ctx.fillStyle = 'rgba(255,176,102,0.55)';
    ctx.fillRect(-L.hw, -5, L.hw * 2, 2.4);
    // ember bed
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 22; i++) {
      var ex = -L.hw + 8 + E.hashf(i, 5) * (L.hw * 2 - 16);
      var ey = 4 + E.hashf(i, 6) * 20;
      var a = 0.14 + 0.3 * (0.5 + 0.5 * Math.sin(this.t * 2 + i));
      ctx.fillStyle = 'rgba(255,' + Math.round(120 + 60 * E.hashf(i, 7)) + ',40,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(ex, ey, 1.2 + 2.2 * E.hashf(i, 8), 0, TAU);
      ctx.fill();
    }
    var gg = ctx.createRadialGradient(0, 0, 4, 0, 0, L.hw);
    gg.addColorStop(0, 'rgba(255,140,50,0.20)');
    gg.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(-L.hw, -30, L.hw * 2, 60);
    ctx.restore();
    ctx.restore();
  };

  /* ---------------------------------------------------------------- items */
  R.prototype.drawItems = function (ctx, sim) {
    var visH = this.visibleH;
    for (var i = 0; i < sim.items.length; i++) {
      var it = sim.items[i];
      if (!it.active) continue;
      var y = this.vy(it.y);
      if (y < -50 || y > visH + 50) continue;
      if (it.type === 'glimmer') {
        Art.drawGlimmer(ctx, it.x, y, GLIMMER_DRAW, it.id, this.t);
      } else {
        var dx = it.x - sim.x, dy = it.y - sim.y;
        var alarm = clamp(1 - Math.sqrt(dx * dx + dy * dy) / 130, 0, 1);
        Art.drawMoth(ctx, it.x, y, MOTH_DRAW, it.id, this.t, alarm);
      }
    }
  };

  /* -------------------------------------------------------- the character */
  R.prototype.drawSpark = function (ctx, sim, pxw, pyw) {
    var x = pxw, y = this.vy(pyw);
    var r = C.R;
    var p = { x: x, y: y, r: r, t: this.t, sx: 1, sy: 1, rot: 0, temp: 0, glow: 1, alpha: 1, flame: 1, sway: 0, eyeOpen: 1, mouth: 'smile', brow: 0 };

    var dragging = sim.input.dragging;
    var pull = Math.sqrt(sim.pull.x * sim.pull.x + sim.pull.y * sim.pull.y);
    var power = clamp((pull - C.DEAD) / (C.MAX_PULL - C.DEAD), 0, 1);
    var aiming = dragging && pull > C.DEAD && sim.phase !== 'gameover' && sim.jumpsLeft > 0;
    var speed = Math.sqrt(sim.vx * sim.vx + sim.vy * sim.vy);

    var state;
    if (sim.phase === 'gameover') state = 'taken';
    else if (this.burstT > 0.35) state = 'burst';
    else if (aiming) state = 'aim';
    else if (sim.anchored && sim.anchorKind === 'wall') state = 'cling';
    else if (sim.anchored) state = 'rest';
    else if (sim.jumpsLeft === 0) state = 'empty';
    else state = 'flight';

    var blinkAmt = this.blink > 0 ? 0.08 : 1;

    switch (state) {
      case 'rest': {
        var bob = Math.sin(this.t * 2.6) * 1.2;
        var impatient = Math.max(0, Math.sin(this.t * 0.7)) > 0.985 ? 1 : 0;
        p.y += bob;
        p.sx = 1 + Math.sin(this.t * 2.6) * 0.03 + this.landT * 0.32;
        p.sy = 1 - Math.sin(this.t * 2.6) * 0.03 - this.landT * 0.3;
        p.eyeOpen = blinkAmt;
        p.pupilX = Math.sin(this.look * 0.8) * 2.2;
        p.pupilY = Math.sin(this.look * 0.53) * 1.1;
        p.mouth = this.landT > 0.4 ? 'grin' : 'smile';
        p.flame = 1 + Math.sin(this.t * 4.1) * 0.12 + impatient * 0.5;
        p.sway = Math.sin(this.t * 1.9) * 0.28;
        p.glow = 1 + this.landT * 0.5;
        break;
      }
      case 'aim': {
        var ang = Math.atan2(-sim.pull.y, -sim.pull.x); // launch direction in view space
        p.rot = ang;
        p.sx = 1 - 0.26 * power;
        p.sy = 1 + 0.20 * power;
        p.eyeShape = 'squint';
        p.eyeOpen = 1;
        p.brow = -1;
        p.mouth = 'grit';
        p.pupilX = Math.cos(ang) * 2.5;
        p.pupilY = Math.sin(ang) * 2.5;
        p.flame = 0.7 + 0.9 * power;
        p.sway = -Math.cos(ang) * 0.9 * power;
        p.glow = 1 + 0.9 * power;
        p.temp = 0.3 * power;
        var shiver = power * 0.9;
        p.x += Math.sin(this.t * 40) * shiver;
        p.y += Math.cos(this.t * 37) * shiver * 0.6;
        break;
      }
      case 'flight': {
        var sp = clamp(speed / 800, 0, 1.2);
        var a2 = Math.atan2(-sim.vy, sim.vx);
        p.rot = a2;
        p.sx = 1 + 0.34 * sp + this.launchT * 0.2;
        p.sy = 1 - 0.24 * sp - this.launchT * 0.14;
        p.eyeShape = 'wide';
        p.eyeOpen = 1;
        p.pupilX = Math.cos(a2) * 3;
        p.pupilY = Math.sin(a2) * 3;
        p.mouth = sim.chainCount > 0 ? 'grin' : 'o';
        p.mouthAmt = sim.chainCount > 0 ? 1 : 0.85;
        p.brow = sim.chainCount > 1 ? -0.5 : 0;
        p.flame = 1.1 + 0.7 * sp;
        p.sway = -Math.cos(a2) * 1.1;
        p.glow = 1.15 + 0.35 * Math.min(sim.chainCount, 6) * 0.2;
        p.temp = Math.min(0.6, 0.1 + sim.chainCount * 0.08);
        // trail
        if (speed > 120 && this.rng.next() < 0.8) {
          this.spawn({
            kind: 'ember', x: pxw - sim.vx * 0.012, y: pyw - sim.vy * 0.012,
            vx: -sim.vx * 0.08 + this.rng.range(-16, 16), vy: -sim.vy * 0.08 + this.rng.range(-16, 16),
            g: -60, life: this.rng.range(0.25, 0.5), max: 0.5, r: this.rng.range(1.2, 2.8),
            rot: 0, spin: 0, drag: 2.4
          });
        }
        break;
      }
      case 'burst': {
        var pop = this.burstT;
        p.sx = 1 + 0.42 * pop;
        p.sy = 1 + 0.42 * pop;
        p.eyeShape = 'star';
        p.mouth = 'grin';
        p.temp = 1;
        p.glow = 1.6 + pop;
        p.flame = 1.8;
        break;
      }
      case 'cling': {
        var side = sim.wallSide || (sim.x < 180 ? -1 : 1);
        p.rot = 0;
        p.sx = 0.86;
        p.sy = 1.12;
        p.x += side * 1.5;
        p.eyeShape = 'squint';
        p.brow = 0.7;
        p.mouth = 'grit';
        p.arms = { side: side, strain: 1 };
        p.sweat = 0.7 + 0.3 * Math.sin(this.t * 3);
        p.flame = 0.7 + 0.1 * Math.sin(this.t * 9);
        p.sway = -side * 0.5;
        p.glow = 0.85;
        p.pupilX = side * 1.5;
        p.x += Math.sin(this.t * 22) * 0.5;
        break;
      }
      case 'empty': {
        p.eyeShape = 'wide';
        p.eyeOpen = 1;
        p.brow = 1;
        p.mouth = 'o';
        p.mouthAmt = 0.62;
        p.temp = -0.65;
        p.glow = 0.45 + 0.1 * Math.sin(this.t * 8);
        p.flame = 0.34;
        p.sway = Math.sin(this.t * 6) * 0.5;
        p.rot = Math.sin(this.t * 5) * 0.12;
        p.sx = 1.02; p.sy = 0.98;
        p.pupilY = 2.2;
        break;
      }
      case 'taken': {
        var dtk = clamp(this.deathT / 1.1, 0, 1);
        p.eyeShape = 'x';
        p.mouth = 'flat';
        p.temp = -1;
        p.glow = Math.max(0, 1 - dtk * 1.4);
        p.flame = Math.max(0, 0.8 - dtk * 1.6);
        p.alpha = Math.max(0, 1 - dtk * 1.15);
        p.sx = 1 - dtk * 0.35;
        p.sy = 1 - dtk * 0.35;
        p.y += dtk * 10;
        if (dtk < 0.5 && this.rng.next() < 0.3) {
          this.spawn({ kind: 'ember', x: pxw + this.rng.range(-8, 8), y: pyw, vx: this.rng.range(-30, 30), vy: this.rng.range(10, 60), g: -80, life: 0.6, max: 0.6, r: 1.6, rot: 0, spin: 0, drag: 2 });
        }
        break;
      }
    }

    Art.drawSpark(ctx, p);

    // glow pips ride with the spark: the stock is always readable in the scene
    var cap = sim.jumpCapacity, left = sim.jumpsLeft;
    if (sim.phase !== 'gameover') {
      var pipR = 3.1;
      var spread = 9.5;
      var baseY = y - r * 2.55 - (state === 'aim' ? 4 : 0);
      var shakeP = left === 0 ? Math.sin(this.t * 26) * 1.4 : 0;
      for (var i = 0; i < cap; i++) {
        var px2 = x + (i - (cap - 1) / 2) * spread + shakeP;
        var py2 = baseY - Math.abs(i - (cap - 1) / 2) * 1.6;
        Art.drawPip(ctx, px2, py2, pipR, i < left, this.t, i * 1.3);
      }
      if (left === 0) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 7);
        text(ctx, 'NO GLOW', x, baseY - 8, 7.5, '#ff9a7a', 'center', 700, 'rgba(255,80,40,0.8)');
        ctx.restore();
      }
    }

    // chain badge
    if (sim.chainCount > 0 && sim.phase !== 'gameover') {
      var n = sim.chainCount;
      var pulse = 1 + this.chainPulse * 0.5;
      var cs = (11 + Math.min(n, 8) * 1.5) * pulse;
      var cy = y + r * 2.9;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var cg = ctx.createRadialGradient(x, cy - cs * 0.3, 0, x, cy - cs * 0.3, cs * 2.2);
      var warm = n >= 5 ? '255,240,200' : '255,180,90';
      cg.addColorStop(0, 'rgba(' + warm + ',' + (0.28 + 0.06 * Math.min(n, 6)).toFixed(2) + ')');
      cg.addColorStop(1, 'rgba(' + warm + ',0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(x, cy - cs * 0.3, cs * 2.2, 0, TAU); ctx.fill();
      ctx.restore();
      text(ctx, '×' + n, x, cy + cs * 0.35, cs, n >= 5 ? '#fff6d8' : '#ffd08a', 'center', 700, 'rgba(255,150,60,0.9)');
      // link ticks
      var ticks = Math.min(n, 8);
      for (var ti = 0; ti < ticks; ti++) {
        var ta = -Math.PI / 2 + (ti - (ticks - 1) / 2) * 0.34;
        ctx.fillStyle = 'rgba(255,220,160,0.9)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(ta) * (cs * 1.5), cy + cs * 0.1 + Math.sin(ta) * (cs * 0.5), 1.5, 0, TAU);
        ctx.fill();
      }
    }
  };

  /* ------------------------------------------------------------ particles */
  R.prototype.drawParts = function (ctx, layer) {
    var ctx2 = ctx;
    ctx2.save();
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var back = p.kind === 'dust';
      if ((layer === 'back') !== back) continue;
      var y = this.vy(p.y);
      if (y < -60 || y > this.visibleH + 60) continue;
      var a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'ring') {
        ctx2.globalCompositeOperation = 'lighter';
        ctx2.strokeStyle = 'rgba(' + p.col + ',' + (a * 0.8).toFixed(3) + ')';
        ctx2.lineWidth = p.w * a;
        ctx2.beginPath();
        ctx2.arc(p.x, y, p.r, 0, TAU);
        ctx2.stroke();
      } else if (p.kind === 'dust') {
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.fillStyle = 'rgba(' + (p.col || '120,104,140') + ',' + (a * 0.5).toFixed(3) + ')';
        ctx2.beginPath();
        ctx2.arc(p.x, y, p.r * (1.4 - a * 0.4), 0, TAU);
        ctx2.fill();
      } else if (p.kind === 'scrap') {
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.save();
        ctx2.translate(p.x, y);
        ctx2.rotate(p.rot);
        ctx2.fillStyle = 'rgba(' + (p.col || '150,126,190') + ',' + (a * 0.85).toFixed(3) + ')';
        ctx2.beginPath();
        ctx2.ellipse(0, 0, p.r * 1.6, p.r * 0.8, 0, 0, TAU);
        ctx2.fill();
        ctx2.restore();
      } else {
        ctx2.globalCompositeOperation = 'lighter';
        var col = p.col || (a > 0.6 ? '255,240,190' : '255,150,60');
        ctx2.fillStyle = 'rgba(' + col + ',' + (a * 0.9).toFixed(3) + ')';
        ctx2.beginPath();
        ctx2.arc(p.x, y, p.r * a + 0.4, 0, TAU);
        ctx2.fill();
      }
    }
    ctx2.restore();
  };

  R.prototype.drawFloats = function (ctx) {
    for (var i = 0; i < this.floats.length; i++) {
      var f = this.floats[i];
      var a = clamp(f.life / f.max, 0, 1);
      var y = this.vy(f.y);
      ctx.save();
      ctx.globalAlpha = a;
      var pop = 1 + (1 - a) * 0.12;
      text(ctx, f.text, f.x, y, f.size * pop, f.col, 'center', 700, f.glow ? 'rgba(255,160,60,0.9)' : null);
      ctx.restore();
    }
  };

  /* ----------------------------------------------------------------- damp */
  R.prototype.drawDamp = function (ctx, sim) {
    var visH = this.visibleH;
    var surface = this.vy(sim.dampY);
    var t = this.dampPhase;

    if (surface < visH + 30) {
      var breathe = Math.sin(t * 0.9) * 2.4 + Math.sin(t * 2.3) * 1.1;
      var top = surface;
      ctx.save();

      // body
      var g = ctx.createLinearGradient(0, top - 10, 0, Math.min(visH, top + 260));
      g.addColorStop(0, 'rgba(46,120,116,0.85)');
      g.addColorStop(0.12, 'rgba(21,84,80,0.95)');
      g.addColorStop(0.6, 'rgba(10,48,50,0.98)');
      g.addColorStop(1, 'rgba(4,22,28,1)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-10, visH + 40);
      ctx.lineTo(-10, top);
      var step = 12;
      for (var x = -10; x <= C.STAGE_W + 10; x += step) {
        var w = Math.sin(x * 0.035 + t * 1.6) * 5.2
          + Math.sin(x * 0.017 - t * 1.05) * 7.5
          + Math.sin(x * 0.08 + t * 2.6) * 2.2 + breathe;
        ctx.lineTo(x, top - w);
      }
      ctx.lineTo(C.STAGE_W + 10, visH + 40);
      ctx.closePath();
      ctx.fill();

      // reaching tendrils — they never rise above the readable rim by much
      ctx.globalCompositeOperation = 'source-over';
      for (var i = 0; i < this.tendrils.length; i++) {
        var td = this.tendrils[i];
        var ph = t * td.s + td.p;
        var reach = Math.max(0, Math.sin(ph)) * td.h;
        if (reach < 1) continue;
        var tx = td.x + Math.sin(t * 0.4 + td.p) * 12;
        ctx.fillStyle = 'rgba(24,92,88,0.75)';
        ctx.beginPath();
        ctx.moveTo(tx - td.w * 0.5, top + 6);
        ctx.quadraticCurveTo(tx - td.w * 0.2, top - reach * 0.7, tx + Math.sin(ph * 2) * 4, top - reach);
        ctx.quadraticCurveTo(tx + td.w * 0.2, top - reach * 0.7, tx + td.w * 0.5, top + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(127,227,208,0.35)';
        ctx.beginPath();
        ctx.arc(tx + Math.sin(ph * 2) * 4, top - reach, 2.2, 0, TAU);
        ctx.fill();
      }

      // the rim: the one crisp line the player reads
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(127,227,208,0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (var x2 = -10, first = true; x2 <= C.STAGE_W + 10; x2 += step) {
        var w2 = Math.sin(x2 * 0.035 + t * 1.6) * 5.2
          + Math.sin(x2 * 0.017 - t * 1.05) * 7.5
          + Math.sin(x2 * 0.08 + t * 2.6) * 2.2 + breathe;
        if (first) { ctx.moveTo(x2, top - w2); first = false; }
        else ctx.lineTo(x2, top - w2);
      }
      ctx.stroke();

      // haze above the surface
      var hg = ctx.createLinearGradient(0, top - 46, 0, top + 6);
      hg.addColorStop(0, 'rgba(80,190,175,0)');
      hg.addColorStop(1, 'rgba(80,190,175,0.16)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, top - 46, C.STAGE_W, 52);

      // bubbles
      ctx.globalCompositeOperation = 'source-over';
      for (var b = 0; b < 12; b++) {
        var bp = (t * (0.3 + E.hashf(b, 3) * 0.5) + E.hashf(b, 4)) % 1;
        var bx = 20 + E.hashf(b, 5) * (C.STAGE_W - 40);
        var by = top + 120 - bp * 120;
        if (by > visH + 10 || by < top - 4) continue;
        ctx.fillStyle = 'rgba(140,230,215,' + (0.2 * (1 - bp)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(bx, by, 1.5 + 3 * E.hashf(b, 6) * (1 - bp * 0.5), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // proximity dread at the bottom edge when the damp is still below the view
    var gap = sim.y - sim.dampY;
    var danger = clamp(1 - (gap - 90) / 380, 0, 1);
    if (danger > 0.01) {
      var pulse = 0.6 + 0.4 * Math.sin(this.t * (3 + danger * 4));
      var dg = ctx.createLinearGradient(0, visH, 0, visH - 150 * danger);
      dg.addColorStop(0, 'rgba(60,200,180,' + (0.30 * danger * pulse).toFixed(3) + ')');
      dg.addColorStop(1, 'rgba(40,160,150,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(0, visH - 150 * danger, C.STAGE_W, 150 * danger);
      if (surface > visH + 6) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.4 * pulse;
        for (var c = 0; c < 3; c++) {
          var cy2 = visH - 10 - c * 7;
          ctx.strokeStyle = 'rgba(140,235,215,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(C.STAGE_W / 2 - 14, cy2 + 5);
          ctx.lineTo(C.STAGE_W / 2, cy2);
          ctx.lineTo(C.STAGE_W / 2 + 14, cy2 + 5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  };

  /* ------------------------------------------------------------------ aim */
  R.prototype.drawAim = function (ctx, sim, pxw, pyw) {
    if (sim.phase === 'gameover') return;
    var inp = sim.input;
    if (!inp.dragging) return;
    var o = this.toView(inp.originX, inp.originY);
    var cur = this.toView(inp.originX + inp.dx, inp.originY + inp.dy);
    var pull = Math.sqrt(sim.pull.x * sim.pull.x + sim.pull.y * sim.pull.y);
    var power = clamp((pull - C.DEAD) / (C.MAX_PULL - C.DEAD), 0, 1);
    var live = pull > C.DEAD;
    var has = sim.jumpsLeft > 0;
    var sx = pxw, sy = this.vy(pyw);

    var warm = has ? '255,196,110' : '150,150,168';
    var hot = has ? '255,240,200' : '190,190,205';

    // sling at the hand: dead-zone ring + power arc
    ctx.save();
    ctx.strokeStyle = 'rgba(' + warm + ',0.25)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(o.x, o.y, C.DEAD, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + warm + ',0.18)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.arc(o.x, o.y, C.MAX_PULL, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (live) {
      ctx.strokeStyle = 'rgba(' + hot + ',0.9)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(o.x, o.y, C.DEAD + 6, -Math.PI / 2, -Math.PI / 2 + TAU * power);
      ctx.stroke();
      // cord from hand to pouch
      ctx.strokeStyle = 'rgba(' + warm + ',0.55)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + hot + ',0.9)';
      ctx.beginPath(); ctx.arc(cur.x, cur.y, 4.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    if (!live) return;

    // the sling in the scene: prongs at the spark, band stretched behind it
    var ang = Math.atan2(-sim.pull.y, -sim.pull.x);
    var stretch = 8 + 26 * power;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.strokeStyle = 'rgba(' + warm + ',0.85)';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(-2, s * 9);
      ctx.quadraticCurveTo(-stretch * 0.55, s * (12 + power * 5), -stretch, s * 3.2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(' + hot + ',0.95)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-stretch, -3.2);
    ctx.lineTo(-stretch, 3.2);
    ctx.stroke();
    ctx.restore();

    // predicted line — dots through the air, stopped at what it hits
    if (has) {
      var t = clamp((pull - C.DEAD) / (C.MAX_PULL - C.DEAD), 0, 1);
      var speed = C.V_MIN + (C.V_MAX - C.V_MIN) * t;
      var vx = Math.cos(ang) * speed, vy = -Math.sin(ang) * speed; // world vy up
      // leaving a cling breaks contact first, exactly as the launch does
      var wx = pxw + (sim.anchored && sim.anchorKind === 'wall' ? (sim.wallSide < 0 ? 1.6 : -1.6) : 0);
      var wy = pyw;
      var dt = 1 / 60, hitX = null, hitY = null, hitKind = null;
      ctx.save();
      // deliberately short: enough to read the line and its first landing,
      // not enough to solve the launch for the player
      for (var i = 1; i <= 52; i++) {
        var prevY = wy;
        vy -= C.G * dt;
        wx += vx * dt; wy += vy * dt;
        if (wx - C.R <= C.WALL_L) { hitX = C.WALL_L + C.R; hitY = wy; hitKind = 'wall'; break; }
        if (wx + C.R >= C.WALL_R) { hitX = C.WALL_R - C.R; hitY = wy; hitKind = 'wall'; break; }
        // a moth on the line is the read the whole gamble turns on
        for (var mi2 = 0; mi2 < sim.items.length; mi2++) {
          var it2 = sim.items[mi2];
          if (!it2.active || it2.type !== 'moth') continue;
          var ddx = it2.x - wx, ddy = it2.y - wy, cr2 = C.MOTH_R + C.R;
          if (ddx * ddx + ddy * ddy < cr2 * cr2) { hitX = it2.x; hitY = it2.y; hitKind = 'moth'; break; }
        }
        if (hitKind) break;
        if (vy <= 0) {
          for (var li = 0; li < sim.ledges.length; li++) {
            var L = sim.ledges[li];
            // the perch being left cannot catch the spark for a few ticks
            if (i <= 8 && sim.anchored && sim.anchorKind === 'ledge' && L.id === sim.anchorLedgeId) continue;
            if (L.y > prevY - C.R + 1 || L.y < wy - C.R - 1) continue;
            if (Math.abs(wx - L.x) > L.hw + C.R * C.LEDGE_GRAB) continue;
            hitX = wx; hitY = L.y + C.R; hitKind = 'ledge';
            break;
          }
          if (hitKind) break;
        }
        if (wy < sim.dampY) { hitX = wx; hitY = sim.dampY; hitKind = 'damp'; break; }
        if (i % 4 === 0) {
          var yy = this.vy(wy);
          if (yy > -30 && yy < this.visibleH + 30) {
            var fade = 1 - i / 62;
            ctx.fillStyle = 'rgba(' + hot + ',' + (0.55 * fade).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(wx, yy, 2.4 * fade + 0.7, 0, TAU);
            ctx.fill();
          }
        }
      }
      if (hitKind) {
        var hy = this.vy(hitY);
        if (hy > -30 && hy < this.visibleH + 30) {
          var col = hitKind === 'damp' ? '120,235,215'
            : hitKind === 'ledge' ? '255,220,150'
              : hitKind === 'moth' ? '214,186,255' : '200,190,255';
          ctx.strokeStyle = 'rgba(' + col + ',0.9)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(hitX, hy, (hitKind === 'moth' ? 16 : 7) + Math.sin(this.t * 8) * 1.2, 0, TAU);
          ctx.stroke();
          if (hitKind === 'moth') {
            ctx.beginPath();
            ctx.moveTo(hitX - 5, hy - 12); ctx.lineTo(hitX, hy - 19); ctx.lineTo(hitX + 5, hy - 12);
            ctx.stroke();
          }
          if (hitKind === 'damp') {
            ctx.beginPath();
            ctx.moveTo(hitX - 4, hy - 4); ctx.lineTo(hitX + 4, hy + 4);
            ctx.moveTo(hitX + 4, hy - 4); ctx.lineTo(hitX - 4, hy + 4);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(this.t * 8);
      text(ctx, 'NO GLOW', sx, sy - 34, 10, '#ff9a7a', 'center', 700, 'rgba(255,80,40,0.8)');
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------------ HUD */
  R.prototype.drawHud = function (ctx, sim, pxw, pyw) {
    var visH = this.visibleH;
    var top = 16 + this.padTop;

    // score
    ctx.save();
    text(ctx, String(sim.score), 16, top + 22, 27, '#ffeec2', 'left', 700, 'rgba(255,150,50,0.55)');
    setFont(ctx, 27, 700);
    var w = ctx.measureText(String(sim.score)).width;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var eg = ctx.createRadialGradient(16 + w + 12, top + 14, 0, 16 + w + 12, top + 14, 11);
    eg.addColorStop(0, 'rgba(255,200,120,0.55)');
    eg.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(16 + w + 12, top + 14, 11, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffb340';
    ctx.beginPath();
    ctx.moveTo(16 + w + 12, top + 20);
    ctx.bezierCurveTo(16 + w + 5, top + 16, 16 + w + 7, top + 9, 16 + w + 12, top + 6);
    ctx.bezierCurveTo(16 + w + 17, top + 9, 16 + w + 19, top + 16, 16 + w + 12, top + 20);
    ctx.closePath();
    ctx.fill();

    text(ctx, 'BEST  ' + sim.sessionBest, 16, top + 38, 10.5, 'rgba(255,220,180,0.5)', 'left', 700);

    // height, right side
    var hm = Math.floor(sim.height / 10);
    text(ctx, hm + 'm', C.STAGE_W - 16, top + 22, 20, 'rgba(255,232,200,0.9)', 'right', 700, 'rgba(255,150,50,0.35)');
    text(ctx, 'CHAIN ' + (sim.chainBest > 0 ? '×' + sim.chainBest : '–'), C.STAGE_W - 16, top + 38, 10.5, 'rgba(255,220,180,0.5)', 'right', 700);
    ctx.restore();

    // mute
    this.muteBtn.x = C.STAGE_W - 22;
    this.muteBtn.y = top + 62;
    this.drawMute(ctx, this.muteBtn.x, this.muteBtn.y, 9);
  };

  R.prototype.drawMute = function (ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(255,225,190,0.9)';
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.28);
    ctx.lineTo(-r * 0.28, -r * 0.28);
    ctx.lineTo(0.05 * r, -r * 0.72);
    ctx.lineTo(0.05 * r, r * 0.72);
    ctx.lineTo(-r * 0.28, r * 0.28);
    ctx.lineTo(-r * 0.7, r * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,225,190,0.9)';
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    if (Audio.isMuted()) {
      ctx.beginPath();
      ctx.moveTo(r * 0.3, -r * 0.42); ctx.lineTo(r * 0.85, r * 0.42);
      ctx.moveTo(r * 0.85, -r * 0.42); ctx.lineTo(r * 0.3, r * 0.42);
      ctx.stroke();
    } else {
      for (var i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(r * 0.1, 0, r * 0.36 * i + r * 0.1, -0.9, 0.9);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  R.prototype.hitMute = function (px, py) {
    var v = this.toView(px, py);
    var dx = v.x - this.muteBtn.x, dy = v.y - this.muteBtn.y;
    return dx * dx + dy * dy < 19 * 19;
  };

  /* ---------------------------------------------------------------- hints */
  R.prototype.drawHints = function (ctx, sim, pxw, pyw) {
    var x = pxw, y = this.vy(pyw);

    // first gesture, shown in the scene until the first launch
    if (sim.phase === 'ready' && !sim.input.dragging) {
      var loop = (this.t * 0.62) % 1;
      var ease = loop < 0.72 ? (loop / 0.72) : 1;
      var released = loop >= 0.72;
      var hx = x + 42, hy = y + 30;
      var pullLen = 34 * ease;
      ctx.save();
      ctx.globalAlpha = released ? clamp(1 - (loop - 0.72) / 0.28, 0, 1) : Math.min(1, loop * 6);
      ctx.strokeStyle = 'rgba(255,205,140,0.55)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + pullLen * 0.5, hy + pullLen);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,235,200,' + (released ? 0.3 : 0.85) + ')';
      ctx.beginPath();
      ctx.arc(hx + pullLen * 0.5, hy + pullLen, released ? 9 : 6.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,235,200,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, TAU);
      ctx.stroke();
      // arrow showing where it goes
      ctx.strokeStyle = 'rgba(255,205,140,' + (0.25 + 0.5 * ease) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 18);
      ctx.lineTo(x - pullLen * 0.5, y - 18 - pullLen);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - pullLen * 0.5, y - 18 - pullLen);
      ctx.lineTo(x - pullLen * 0.5 + 5, y - 14 - pullLen);
      ctx.lineTo(x - pullLen * 0.5 - 2, y - 12 - pullLen);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,205,140,' + (0.25 + 0.5 * ease) + ')';
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(this.t * 2);
      text(ctx, 'pull back  •  let go', C.STAGE_W / 2, y + 96, 12, '#ffd7a0', 'center', 700);
      ctx.restore();

      // title, composed with the scene rather than on a start screen
      var titleY = Math.min(this.visibleH * 0.3, y - 120);
      ctx.save();
      ctx.globalAlpha = 0.95;
      tracked(ctx, 'EMBER', C.STAGE_W / 2, titleY, 46, '#ffd9a0', 7, 'center', 'rgba(255,120,40,0.85)');
      ctx.globalAlpha = 0.5;
      tracked(ctx, 'CLIMB THE FLUE', C.STAGE_W / 2, titleY + 20, 11, '#c9a9c9', 4.5, 'center');
      ctx.restore();
    }

    // mid-air launch, revealed the moment it becomes useful
    if (!this.hint.seenMidair && sim.phase === 'playing' && !sim.anchored && sim.jumpsLeft > 0 && sim.launches >= 1 && sim.midairLaunches === 0) {
      this.hint.midairT = Math.min(1, this.hint.midairT + 0.016);
    } else if (sim.midairLaunches > 0) {
      this.hint.seenMidair = true;
    }
    if (this.hint.midairT > 0 && !this.hint.seenMidair) {
      ctx.save();
      ctx.globalAlpha = clamp(this.hint.midairT * 2, 0, 1) * (0.6 + 0.3 * Math.sin(this.t * 3));
      text(ctx, 'pull again in mid-air', pxw, this.vy(pyw) - 54, 11.5, '#ffd7a0', 'center', 700, 'rgba(255,140,60,0.6)');
      ctx.restore();
    }

    // empty stock, once
    if (!this.hint.seenEmpty && sim.phase === 'playing' && sim.jumpsLeft === 0 && !sim.anchored) {
      this.hint.emptyT = Math.min(1.6, this.hint.emptyT + 0.016);
      if (this.hint.emptyT > 1.5) this.hint.seenEmpty = true;
    }
    if (this.hint.emptyT > 0 && this.hint.emptyT < 1.5 && !sim.anchored) {
      ctx.save();
      ctx.globalAlpha = clamp(this.hint.emptyT * 3, 0, 1) * 0.9;
      text(ctx, 'burst a moth or find a perch', C.STAGE_W / 2, this.visibleH * 0.24, 12, '#9fe6d8', 'center', 700, 'rgba(60,180,160,0.7)');
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------- ceremony */
  R.prototype.drawGameOver = function (ctx, sim) {
    var visH = this.visibleH;
    var t = this.overT;
    var swallow = clamp(t / 0.9, 0, 1);

    // the flue goes cold
    ctx.fillStyle = 'rgba(8,24,30,' + (0.62 * swallow).toFixed(3) + ')';
    ctx.fillRect(0, 0, C.STAGE_W, visH);

    if (t < 0.75) return;
    var e = clamp((t - 0.75) / 0.5, 0, 1);
    var ease = 1 - Math.pow(1 - e, 3);

    var target = sim.score;
    this.scoreShown += (target - this.scoreShown) * Math.min(1, 0.09);
    if (target - this.scoreShown < 1) this.scoreShown = target;

    var pw = Math.min(300, C.STAGE_W - 34);
    var ph = 268;
    var px = (C.STAGE_W - pw) / 2;
    var py = visH * 0.5 - ph * 0.52 + (1 - ease) * 26;

    ctx.save();
    ctx.globalAlpha = ease;

    // plate
    roundRect(ctx, px, py, pw, ph, 16);
    var g = ctx.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, 'rgba(30,20,36,0.96)');
    g.addColorStop(1, 'rgba(16,11,22,0.97)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,90,0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var eg = ctx.createLinearGradient(0, py, 0, py + 60);
    eg.addColorStop(0, 'rgba(255,150,60,0.14)');
    eg.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = eg;
    roundRect(ctx, px, py, pw, 60, 16);
    ctx.fill();
    ctx.restore();

    var cx = C.STAGE_W / 2;
    var y = py + 30;

    text(ctx, 'THE DAMP TOOK YOU', cx, y, 10.5, 'rgba(150,225,210,0.75)', 'center', 700);
    y += 46;

    Art.rankSeal(ctx, cx - pw * 0.30, y - 6, 21, sim.rankTier || 0, this.t);
    tracked(ctx, sim.rank || 'EMBER', cx + 22, y + 3, 25, '#ffdca6', 3.2, 'center', 'rgba(255,140,50,0.8)');
    text(ctx, 'RANK', cx + 22, y + 18, 9, 'rgba(255,210,170,0.45)', 'center', 700);

    y += 46;
    // score block
    text(ctx, String(Math.round(this.scoreShown)), cx, y + 14, 38, '#fff0cc', 'center', 700, 'rgba(255,150,50,0.6)');
    text(ctx, 'SCORE', cx, y + 28, 9, 'rgba(255,210,170,0.45)', 'center', 700);

    y += 54;
    ctx.strokeStyle = 'rgba(255,180,110,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 26, y - 8); ctx.lineTo(px + pw - 26, y - 8);
    ctx.stroke();

    // three reasons to go again
    var colX = [px + pw * 0.22, px + pw * 0.5, px + pw * 0.78];
    var labels = ['BEST', 'CHAIN', 'HEIGHT'];
    var vals = [String(sim.sessionBest), '×' + sim.chainBest, Math.floor(sim.height / 10) + 'm'];
    for (var i = 0; i < 3; i++) {
      text(ctx, vals[i], colX[i], y + 14, 17, i === 1 && sim.chainBest >= 4 ? '#ffd27a' : '#f4e2c6', 'center', 700);
      text(ctx, labels[i], colX[i], y + 27, 8.5, 'rgba(255,210,170,0.42)', 'center', 700);
    }

    if (sim.beatBest) {
      ctx.save();
      ctx.globalAlpha = ease * (0.7 + 0.3 * Math.sin(this.t * 5));
      text(ctx, 'NEW BEST', colX[0], y - 14, 9.5, '#ffd27a', 'center', 700, 'rgba(255,150,50,0.9)');
      ctx.restore();
    }

    // chain pips
    var pipY = y + 42;
    var n = Math.min(sim.chainBest, 10);
    for (var k = 0; k < n; k++) {
      var pxp = cx + (k - (n - 1) / 2) * 11;
      Art.drawPip(ctx, pxp, pipY, 3, true, this.t, k * 0.7);
    }

    y = py + ph - 22;
    ctx.save();
    ctx.globalAlpha = ease * (0.55 + 0.45 * Math.sin(this.t * 3.4));
    text(ctx, 'TAP TO CLIMB AGAIN', cx, y, 12.5, '#ffd9a0', 'center', 700, 'rgba(255,140,50,0.7)');
    ctx.restore();

    ctx.restore();
  };

  E.Renderer = R;
})();
