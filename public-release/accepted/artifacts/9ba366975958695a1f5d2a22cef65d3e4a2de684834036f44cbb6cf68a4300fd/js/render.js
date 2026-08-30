(function (global) {
  'use strict';

  var CFG = global.EmberConfig;
  var VIEW_H_UNITS = 460;
  var SPARK_ANCHOR = 0.55;
  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  if (typeof global.CanvasRenderingContext2D !== 'undefined' && !global.CanvasRenderingContext2D.prototype.roundRect) {
    global.CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      if (!Array.isArray(r)) r = [0, 0, 0, 0];
      var tl = r[0] || 0, tr = (r[1] === undefined ? tl : r[1]) || 0;
      var br = (r[2] === undefined ? tr : r[2]) || 0, bl = (r[3] === undefined ? tl : r[3]) || 0;
      this.moveTo(x + tl, y);
      this.arcTo(x + w, y, x + w, y + h, tr);
      this.arcTo(x + w, y + h, x, y + h, br);
      this.arcTo(x, y + h, x, y, bl);
      this.arcTo(x, y, x + w, y, tl);
      this.closePath();
      return this;
    };
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    this.viewX = 0; this.viewY = 0; this.viewW = 0; this.viewH = 0; this.scale = 1;
    this.camX = 0; this.camBottom = 0;
    this.safeTop = 0;
    this.t = 0;
    this.audio = null;

    this.particles = [];
    this.popups = [];
    this.trail = [];
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.shake = 0;
    this.deathStart = -1;
    this.deathT = 0;
    this.burstT = 0;
    this.landT = 0;
    this.prevEvent = null;
    this.prevJumps = CFG.JUMP_CAPACITY;
    this.prevPhase = 'ready';
    this.hintDone = false;
    this.ambientTimer = 0;

    this.sprites = {};
    this.backTile = null;
    this.wallTile = null;
    this.stars = null;
    this.backPattern = null;
    this.wallPattern = null;

    this._initSprites();
    this._initTiles();
  }

Renderer.prototype.resize = function (w, h, dpr, safeTop) {
  this.W = w; this.H = h; this.dpr = dpr || 1;
  this.safeTop = safeTop || 0;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.viewH = h;
    this.viewW = Math.min(w, h * 0.72);
    this.viewX = (w - this.viewW) / 2;
    this.viewY = 0;
    this.scale = this.viewH / VIEW_H_UNITS;
    this._makeStars();
  };

  Renderer.prototype.reset = function () {
    this.particles = [];
    this.popups = [];
    this.trail = [];
    this.flash = 0;
    this.shake = 0;
    this.deathStart = -1;
    this.deathT = 0;
    this.burstT = 0;
    this.landT = 0;
    this.pipPulse = 0;
    this.prevEvent = null;
    this.prevJumps = CFG.JUMP_CAPACITY;
    this.prevPhase = 'ready';
    this.ambientTimer = 0;
  };

  Renderer.prototype._initSprites = function () {
    var s = this.sprites;
    s.glowWarm = this._makeGlow('#ffb45c', '#ff7a2e', 1.0);
    s.glowCool = this._makeGlow('#5ebbd0', '#1f4b5c', 0.9);
    s.sparkle = this._makeSparkle();
    s.ember = this._makeDot('#ffd98a');
    s.soot = this._makeDot('#3a2f2a');
  };

  Renderer.prototype._makeGlow = function (c1, c2, alpha) {
    var size = 128;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.4, c2);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  };

  Renderer.prototype._makeSparkle = function () {
    var size = 64;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var c = size / 2;
    g.translate(c, c);
    g.fillStyle = '#fff3d0';
    var spikes = 4;
    var outer = size * 0.5, inner = size * 0.13;
    g.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (i * Math.PI) / spikes;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    return cv;
  };

  Renderer.prototype._makeDot = function (color) {
    var size = 32;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return cv;
  };

  Renderer.prototype._makeStars = function () {
    var cv = document.createElement('canvas');
    cv.width = this.viewW; cv.height = this.viewH;
    var g = cv.getContext('2d');
    var n = Math.floor(this.viewW * this.viewH / 9000);
    for (var i = 0; i < n; i++) {
      var x = Math.random() * this.viewW;
      var y = Math.random() * this.viewH * 0.55;
      var r = 0.4 + Math.random() * 1.1;
      var a = 0.25 + Math.random() * 0.5;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = 'rgba(255,235,200,' + a + ')';
      g.fill();
    }
    this.stars = cv;
  };

  Renderer.prototype._initTiles = function () {
    var back = document.createElement('canvas');
    back.width = 256; back.height = 256;
    var g = back.getContext('2d');
    var lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, '#181326');
    lg.addColorStop(1, '#0a0814');
    g.fillStyle = lg;
    g.fillRect(0, 0, 256, 256);
    var rowH = 30;
    for (var r = 0; r < 9; r++) {
      var off = (r % 2 === 0) ? 0 : 18;
      var y = r * rowH;
      g.fillStyle = 'rgba(32,26,52,0.9)';
      g.fillRect(0, y + 1, 256, rowH - 2);
      g.strokeStyle = 'rgba(8,6,15,0.8)';
      g.lineWidth = 1;
      var x = -off;
      while (x < 256) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + rowH);
        g.stroke();
        x += 52;
      }
    }
    for (var s = 0; s < 14; s++) {
      g.fillStyle = 'rgba(5,4,10,0.5)';
      var sx = Math.random() * 256;
      var sh = 20 + Math.random() * 90;
      g.fillRect(sx, Math.random() * 256, 3 + Math.random() * 5, sh);
    }
    this.backTile = back;
    this.backPattern = this.ctx.createPattern(back, 'repeat');

    var wall = document.createElement('canvas');
    wall.width = 128; wall.height = 256;
    var wg = wall.getContext('2d');
    var wl = wg.createLinearGradient(0, 0, 128, 0);
    wl.addColorStop(0, '#241814');
    wl.addColorStop(1, '#150d0b');
    wg.fillStyle = wl;
    wg.fillRect(0, 0, 128, 256);
    var bh = 24;
    for (var br = 0; br < 11; br++) {
      var by = br * bh;
      wg.fillStyle = 'rgba(44,30,24,0.85)';
      wg.fillRect(0, by + 1, 128, bh - 2);
      wg.strokeStyle = 'rgba(10,6,5,0.85)';
      wg.lineWidth = 1;
      var bx = 0;
      while (bx < 128) {
        wg.beginPath();
        wg.moveTo(bx, by);
        wg.lineTo(bx, by + bh);
        wg.stroke();
        bx += 44;
      }
    }
    for (var soot = 0; soot < 10; soot++) {
      wg.fillStyle = 'rgba(5,3,3,0.55)';
      var wx = 20 + Math.random() * 90;
      wg.fillRect(wx, Math.random() * 256, 4 + Math.random() * 9, 30 + Math.random() * 100);
    }
    this.wallTile = wall;
    this.wallPattern = this.ctx.createPattern(wall, 'repeat');
  };

  // ---- coordinate helpers ----
  Renderer.prototype.sx = function (wx) {
    return this.viewX + this.viewW / 2 + (wx - this.camX) * this.scale;
  };
  Renderer.prototype.sy = function (wy) {
    return this.viewY + this.viewH - (wy - this.camBottom) * this.scale;
  };
  Renderer.prototype._updateCamera = function (sim) {
    this.camBottom = sim.py - VIEW_H_UNITS * SPARK_ANCHOR;
    var halfW = (this.viewW / 2) / this.scale;
    if (halfW >= CFG.WALL_RIGHT) {
      this.camX = clamp(sim.px, CFG.WALL_RIGHT - halfW, CFG.WALL_LEFT + halfW);
    } else {
      this.camX = sim.px;
    }
  };

  // ---- main render ----
  Renderer.prototype.render = function (sim, dt) {
    var ctx = this.ctx;
    this.t += dt;
    this._updateCamera(sim);

    var shakeX = 0, shakeY = 0;
    if (this.shake > 0.2) {
      shakeX = (Math.random() * 2 - 1) * this.shake;
      shakeY = (Math.random() * 2 - 1) * this.shake;
    }
    this.flash *= Math.pow(0.002, dt);
    this.shake *= Math.pow(0.01, dt);
    if (this.pipPulse > 0) this.pipPulse -= dt * 2.2;
    if (this.burstT > 0) this.burstT -= dt;
    if (this.landT > 0) this.landT -= dt;

    this._detectEvents(sim);
    this._updateParticles(dt);
    this._updateTrail(sim, dt);
    this._updatePopups(dt);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(this.viewX + shakeX, this.viewY + shakeY);
    ctx.beginPath();
    ctx.rect(0, 0, this.viewW, this.viewH);
    ctx.clip();

    this._drawBackdrop(sim);
    this._drawWalls(sim);
    this._drawLedges(sim);
    this._drawItems(sim);
    this._drawTrail(sim);
    this._drawSling(sim);
    this._drawSpark(sim);
    this._drawParticles(sim);
    this._drawDamp(sim);
    this._drawChainOrbit(sim);
    this._drawPopups(sim);

    ctx.restore();

    this._drawVignette(sim);
    this._drawHUD(sim);
    if (sim.phase === 'gameover') this._drawGameOver(sim);
    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgba(' + this.flashColor + ',' + Math.min(1, this.flash) + ')';
      ctx.fillRect(0, 0, this.W, this.H);
    }
    this._drawHint(sim);
  };

  // ---- backdrop ----
  Renderer.prototype._drawBackdrop = function (sim) {
    var ctx = this.ctx;
    var off = ((this.camBottom * this.scale * 0.35) % 256 + 256) % 256;
    ctx.save();
    ctx.translate(0, off);
    ctx.fillStyle = this.backPattern;
    ctx.fillRect(0, -256, this.viewW, this.viewH + 512);
    ctx.restore();

    var sky = clamp(sim.height / 3000, 0, 1);
    var g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    var glow = ctx.createRadialGradient(this.viewW / 2, -this.viewH * 0.2, 10, this.viewW / 2, -this.viewH * 0.2, this.viewH * 0.75);
    glow.addColorStop(0, 'rgba(120,110,180,' + (0.05 + 0.12 * sky) + ')');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (this.stars) {
      var a = 0.5 + 0.5 * sky;
      ctx.globalAlpha = 0.35 + 0.65 * sky;
      ctx.drawImage(this.stars, 0, 0);
      ctx.globalAlpha = 1;
    }
  };

  // ---- walls ----
  Renderer.prototype._drawWalls = function (sim) {
    var ctx = this.ctx;
    var viewW = this.viewW, viewH = this.viewH, wallPattern = this.wallPattern;
    var off = ((this.camBottom * this.scale) % 256 + 256) % 256;
    var leftX = this.sx(CFG.WALL_LEFT);
    var rightX = this.sx(CFG.WALL_RIGHT);
    var drawWall = function (x0, x1) {
      if (x1 <= 0 || x0 >= viewW) return;
      var xa = Math.max(0, x0), xb = Math.min(viewW, x1);
      ctx.save();
      ctx.translate(0, off);
      ctx.fillStyle = wallPattern;
      ctx.fillRect(xa, -256, xb - xa, viewH + 512);
      ctx.restore();
      var wg = ctx.createLinearGradient(0, 0, 0, viewH);
      wg.addColorStop(0, 'rgba(10,6,5,0.25)');
      wg.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = wg;
      ctx.fillRect(xa, 0, xb - xa, viewH);
    };
    drawWall(-this.viewW, leftX);
    drawWall(rightX, this.viewW * 2);
    ctx.strokeStyle = 'rgba(120,95,70,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftX, 0);
    ctx.lineTo(leftX, this.viewH);
    ctx.moveTo(rightX, 0);
    ctx.lineTo(rightX, this.viewH);
    ctx.stroke();
  };

  // ---- ledges ----
  Renderer.prototype._drawLedges = function (sim) {
    var ctx = this.ctx;
    var litId = sim.anchored && sim.anchorKind === 'ledge' ? this._ledgeUnder(sim) : -1;
    for (var i = 0; i < sim.ledges.length; i++) {
      var l = sim.ledges[i];
      if (!l.active) continue;
      var topY = this.sy(l.y);
      if (topY < -120 || topY > this.viewH + 120) continue;
      this._drawLedge(l, topY, l.id === litId);
    }
  };

  Renderer.prototype._ledgeUnder = function (sim) {
    for (var i = 0; i < sim.ledges.length; i++) {
      var l = sim.ledges[i];
      if (l.active && Math.abs(sim.px - l.x) <= l.halfWidth && Math.abs(sim.py - (l.y + CFG.PLAYER_R)) < 1.5) return l.id;
    }
    return -1;
  };

  Renderer.prototype._drawLedge = function (l, topY, lit) {
    var ctx = this.ctx;
    var x0 = this.sx(l.x - l.halfWidth);
    var x1 = this.sx(l.x + l.halfWidth);
    var H = 24 * this.scale;
    var settle = this.landT > 0 && lit ? Math.sin(this.landT * 30) * 2 * this.landT : 0;
    var ty = topY + settle;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0 + 4, ty + 4, x1 - x0, H);

    var g = ctx.createLinearGradient(0, ty, 0, ty + H);
    g.addColorStop(0, '#33261e');
    g.addColorStop(1, '#19100c');
    ctx.fillStyle = g;
    ctx.fillRect(x0, ty, x1 - x0, H);

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, ty, x1 - x0, H);

    var lipG = ctx.createLinearGradient(0, ty - 3 * this.scale, 0, ty + 9 * this.scale);
    if (lit) {
      lipG.addColorStop(0, '#ffd98a');
      lipG.addColorStop(0.5, '#c98a4a');
      lipG.addColorStop(1, '#5a3a24');
    } else {
      lipG.addColorStop(0, '#7a5a3c');
      lipG.addColorStop(0.5, '#5a412c');
      lipG.addColorStop(1, '#33231a');
    }
    ctx.fillStyle = lipG;
    ctx.beginPath();
    ctx.roundRect(x0 - 2, ty - 3 * this.scale, (x1 - x0) + 4, 12 * this.scale, 4);
    ctx.fill();

    ctx.strokeStyle = lit ? 'rgba(255,224,150,0.5)' : 'rgba(120,95,70,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0 + 2, ty - 2 * this.scale);
    ctx.lineTo(x1 - 2, ty - 2 * this.scale);
    ctx.stroke();

    ctx.fillStyle = 'rgba(20,12,8,0.8)';
    for (var d = 0; d < 3; d++) {
      var dx = x0 + (l.id * 47 + d * 61) % Math.max(8, (x1 - x0));
      var dh = 6 + d * 5;
      ctx.fillRect(dx, ty + H - 2, 3, dh);
    }
  };

  // ---- items ----
  Renderer.prototype._drawItems = function (sim) {
    for (var i = 0; i < sim.items.length; i++) {
      var it = sim.items[i];
      if (!it.active) continue;
      var p = sim.itemPos(it);
      var sy = this.sy(p.y);
      if (sy < -60 || sy > this.viewH + 60) continue;
      var sx = this.sx(p.x);
      if (it.type === 'glimmer') this._drawGlimmer(sx, sy, it);
      else this._drawMoth(sx, sy, it, this.t);
    }
  };

  Renderer.prototype._drawGlimmer = function (x, y, it) {
    var ctx = this.ctx;
    var r = it.visualRadius * this.scale;
    var pulse = 1 + Math.sin(this.t * 3.2 + it.id * 1.7) * 0.14;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.sprites.glowWarm, x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var rot = this.t * 1.1 + it.id;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    var sc = r * 1.1 * pulse;
    ctx.drawImage(this.sprites.sparkle, -sc, -sc, sc * 2, sc * 2);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,240,0.95)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, TAU);
    ctx.fill();
  };

  Renderer.prototype._drawMoth = function (x, y, it, t) {
    var ctx = this.ctx;
    var r = it.visualRadius * this.scale;
    var flap = Math.sin(t * 11 + it.id * 3.1);
    var wing = 0.25 + Math.abs(flap) * 0.6;
    var wob = Math.sin(t * 2.2 + it.id) * r * 0.05;
    ctx.save();
    ctx.translate(x, y + wob);
    ctx.rotate(Math.sin(t * 1.3 + it.id) * 0.18);
    ctx.fillStyle = 'rgba(190,205,214,0.42)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, -r * 0.8 * wing, r * 0.55, r * 0.85 * wing, -0.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.7, -r * 0.8 * wing, r * 0.55, r * 0.85 * wing, 0.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.55, r * 0.7 * wing, r * 0.45, r * 0.7 * wing, 0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.55, r * 0.7 * wing, r * 0.45, r * 0.7 * wing, -0.5, 0, TAU);
    ctx.fill();
    var bg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
    bg.addColorStop(0, '#b8c4ce');
    bg.addColorStop(1, '#7f8d9a');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.5, r * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,72,82,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath();
    ctx.arc(r * 0.22, -r * 0.12, r * 0.16, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,125,138,0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.5);
    ctx.quadraticCurveTo(-r * 0.4, -r * 0.8, -r * 0.2, -r * 0.9);
    ctx.moveTo(r * 0.3, -r * 0.5);
    ctx.quadraticCurveTo(r * 0.4, -r * 0.8, r * 0.2, -r * 0.9);
    ctx.stroke();
    ctx.restore();
  };

  // ---- trail ----
  Renderer.prototype._updateTrail = function (sim, dt) {
    if (sim.phase === 'gameover' || sim.phase === 'ready') {
      if (this.trail.length) this.trail = [];
      return;
    }
    var spd = Math.hypot(sim.vx, sim.vy);
    var px = sim.px, py = sim.py;
    if (spd > 150 && !sim.anchored) {
      var last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - px, last.y - py) > 4) {
        this.trail.push({ x: px, y: py, t: this.t });
        if (this.trail.length > 34) this.trail.shift();
      }
    } else if (this.trail.length) {
      this.trail.shift();
    }
  };

  Renderer.prototype._drawTrail = function (sim) {
    if (this.trail.length < 2) return;
    var ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 1; i < this.trail.length; i++) {
      var a = this.trail[i - 1], b = this.trail[i];
      var f = i / this.trail.length;
      ctx.strokeStyle = 'rgba(255,160,60,' + (f * 0.28) + ')';
      ctx.lineWidth = 2.5 * f + 0.5;
      ctx.beginPath();
      ctx.moveTo(this.sx(a.x), this.sy(a.y));
      ctx.lineTo(this.sx(b.x), this.sy(b.y));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---- sling ----
  Renderer.prototype._predictedPath = function (sim) {
    var len = Math.hypot(sim.input.dx, sim.input.dy);
    if (len < CFG.DEAD_ZONE) return null;
    var ratio = Math.min(1, len / CFG.PULL_MAX);
    var speed = CFG.FULL_SPEED * ratio;
    var vx = (-sim.input.dx / len) * speed;
    var vy = (sim.input.dy / len) * speed;
    var x = sim.px, y = sim.py, t = 0;
    var pts = [];
    var landing = false;
    var prevBottom = y - CFG.PLAYER_R;
    while (t < 1.55 && pts.length < 46) {
      var dt = 0.09;
      vy -= CFG.GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      t += dt;
      if (x - CFG.PLAYER_R < CFG.WALL_LEFT) { x = CFG.WALL_LEFT + CFG.PLAYER_R; pts.push({ x: x, y: y }); break; }
      if (x + CFG.PLAYER_R > CFG.WALL_RIGHT) { x = CFG.WALL_RIGHT - CFG.PLAYER_R; pts.push({ x: x, y: y }); break; }
      var bottom = y - CFG.PLAYER_R;
      if (vy <= 0 && bottom <= prevBottom) {
        for (var i = 0; i < sim.ledges.length; i++) {
          var l = sim.ledges[i];
          if (!l.active) continue;
          if (Math.abs(x - l.x) <= l.halfWidth && bottom <= l.y && prevBottom >= l.y) {
            landing = true;
            pts.push({ x: x, y: y });
            return { pts: pts, landing: true };
          }
        }
      }
      prevBottom = bottom;
      pts.push({ x: x, y: y });
    }
    return { pts: pts, landing: landing };
  };

  Renderer.prototype._drawSling = function (sim) {
    if (!sim.input.dragging) return;
    if (sim.phase !== 'ready' && sim.phase !== 'playing') return;
    var ctx = this.ctx;
    var ox = sim.input.originX, oy = sim.input.originY;
    var px = ox + sim.input.dx, py = oy + sim.input.dy;
    var len = Math.hypot(sim.input.dx, sim.input.dy);
    var canLaunch = sim.jumpsLeft > 0 && len >= CFG.DEAD_ZONE;
    var ratio = clamp((len - CFG.DEAD_ZONE) / (CFG.PULL_MAX - CFG.DEAD_ZONE), 0, 1);

    if (!canLaunch) ratio = 0;

    var g = ctx.createLinearGradient(ox, oy, px, py);
    if (sim.jumpsLeft <= 0) {
      g.addColorStop(0, 'rgba(120,110,110,0.5)');
      g.addColorStop(1, 'rgba(120,110,110,0.5)');
    } else {
      g.addColorStop(0, 'rgba(255,190,90,0.5)');
      g.addColorStop(1, 'rgba(255,255,220,' + (0.5 + ratio * 0.5) + ')');
    }
    ctx.strokeStyle = g;
    ctx.lineWidth = 3 + ratio * 4;
    var mx = (ox + px) / 2 + (-sim.input.dy) * 0.25;
    var my = (oy + py) / 2 + (sim.input.dx) * 0.25;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(mx, my, px, py);
    ctx.stroke();

    ctx.strokeStyle = sim.jumpsLeft <= 0 ? 'rgba(140,130,130,0.8)' : 'rgba(255,230,170,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, 9 + ratio * 4, 0, TAU);
    ctx.stroke();
    if (ratio > 0.02) {
      ctx.strokeStyle = 'rgba(255,200,110,0.7)';
      ctx.beginPath();
      ctx.arc(ox, oy, 14 + ratio * 4, -Math.PI / 2, -Math.PI / 2 + ratio * TAU);
      ctx.stroke();
    }
    ctx.fillStyle = sim.jumpsLeft <= 0 ? 'rgba(140,130,130,0.9)' : 'rgba(255,240,200,0.95)';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, TAU);
    ctx.fill();

    if (canLaunch) {
      var path = this._predictedPath(sim);
      if (path) {
        for (var i = 0; i < path.pts.length; i++) {
          var p = path.pts[i];
          var f = 1 - i / path.pts.length;
          ctx.fillStyle = 'rgba(255,220,150,' + (0.1 + f * 0.4) + ')';
          var rr = 1.5 + f * 1.6;
          ctx.beginPath();
          ctx.arc(this.sx(p.x), this.sy(p.y), rr, 0, TAU);
          ctx.fill();
        }
        if (path.landing) {
          var lp = path.pts[path.pts.length - 1];
          ctx.strokeStyle = 'rgba(255,230,170,0.8)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(this.sx(lp.x), this.sy(lp.y), 8, 0, TAU);
          ctx.stroke();
        }
      }
    }
  };

  // ---- spark ----
  Renderer.prototype._sparkExpression = function (sim) {
    if (sim.phase === 'gameover') return 'douse';
    if (this.burstT > 0 && !sim.anchored) return 'burst';
    if (!sim.anchored) {
      if (sim.jumpsLeft <= 0) return 'falling';
      return 'flight';
    }
    if (sim.anchorKind === 'wall') return 'cling';
    if (sim.input.dragging) return 'aim';
    return 'idle';
  };

  Renderer.prototype._drawSpark = function (sim) {
    var ctx = this.ctx;
    var x = this.sx(sim.px);
    var y = this.sy(sim.py);
    var R = CFG.PLAYER_R * this.scale;
    var expr = this._sparkExpression(sim);
    var spd = Math.hypot(sim.vx, sim.vy);
    var f = clamp(spd / 900, 0, 1);

    var charge = 0;
    if (sim.input.dragging && sim.jumpsLeft > 0) {
      var l = Math.hypot(sim.input.dx, sim.input.dy);
      charge = clamp((l - CFG.DEAD_ZONE) / (CFG.PULL_MAX - CFG.DEAD_ZONE), 0, 1);
    }

    var douse = 0;
    if (expr === 'douse') douse = clamp(this.deathT * 1.5, 0, 1);

    var scX = 1, scY = 1;
    var offX = 0, offY = 0;
    var lookX = 0, lookY = -0.5;

    if (expr === 'flight' || expr === 'falling' || expr === 'burst') {
      var dirY = sim.vy / Math.max(60, spd);
      var dirX = sim.vx / Math.max(60, spd);
      scY = 1 + 0.5 * f * dirY;
      scX = 1 + 0.34 * f * Math.abs(dirX);
      lookX = dirX * 0.6;
      lookY = dirY * 0.6 - 0.2;
      offY = f * 3 * Math.sin(this.t * 22) * 0.3;
    } else if (expr === 'cling') {
      scX = 1.16; scY = 0.8;
      lookX = 0; lookY = -0.7;
      offX = Math.sin(this.t * 26) * R * 0.06;
    } else if (expr === 'aim') {
      var dl = Math.hypot(sim.input.dx, sim.input.dy) || 1;
      var ax = -sim.input.dx / dl, ay = sim.input.dy / dl;
      scY = 1 - 0.16 * charge;
      scX = 1 + 0.2 * charge;
      lookX = ax * 0.7; lookY = ay * 0.7;
      offX = ax * charge * R * 0.16;
      offY = -ay * charge * R * 0.16;
    } else {
      var b = Math.sin(this.t * 6) * 0.035;
      scX = 1 + b; scY = 1 - b;
      lookX = 0; lookY = -0.55;
    }

    var flicker = 0.85 + Math.sin(this.t * 14) * 0.1 + (expr === 'flight' ? f * 0.2 : 0);
    var glowA = 0.5 + charge * 0.35 + flicker * 0.15 + Math.min(sim.chainCount, 10) * 0.025;
    glowA *= (1 - douse * 0.9);

    ctx.save();
    ctx.translate(x + offX, y + offY);

    ctx.globalCompositeOperation = 'lighter';
    var gr = R * (2.6 + charge * 1.4 + f * 0.5) * flicker;
    ctx.globalAlpha = clamp(glowA, 0, 1);
    ctx.drawImage(this.sprites.glowWarm, -gr, -gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.scale(scX, scY);

    if (expr === 'douse' || expr === 'falling') {
      var tailA = Math.max(0, 0.8 - douse * 1.2);
      this._drawTail(0, R * 0.95, R * (0.7 + f * 0.5), tailA, expr === 'flight');
    } else if (expr === 'flight') {
      this._drawTail(0, R * 0.95, R * (0.8 + f * 0.6), 0.9, true);
    } else {
      this._drawTail(0, R * 0.95, R * 0.7, 0.8, false);
    }

    var body = this._sparkBodyColor(douse);
    var grad = ctx.createRadialGradient(-R * 0.2, -R * 0.25, R * 0.1, 0, 0, R * 1.05);
    grad.addColorStop(0, body[0]);
    grad.addColorStop(0.55, body[1]);
    grad.addColorStop(1, body[2]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, R, R * 0.94, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,50,20,' + (0.8 - douse * 0.6) + ')';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this._drawFace(R, expr, lookX, lookY, douse, sim);
    ctx.restore();

    if (expr === 'cling') {
      this._drawClingNubs(R, sim.px <= CFG.WALL_LEFT + CFG.PLAYER_R + 1);
    }
    ctx.restore();
  };

  Renderer.prototype._sparkBodyColor = function (douse) {
    var c0 = [255, 246, 220], c1 = [255, 192, 105], c2 = [255, 138, 53];
    var g = [120, 115, 115], g1 = [90, 86, 86], g2 = [60, 58, 58];
    var mix = function (a, b) {
      return [Math.round(lerp(a[0], b[0], douse)), Math.round(lerp(a[1], b[1], douse)), Math.round(lerp(a[2], b[2], douse))];
    };
    var toStr = function (a) { return 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')'; };
    return [toStr(mix(c0, g)), toStr(mix(c1, g1)), toStr(mix(c2, g2))];
  };

  Renderer.prototype._drawTail = function (x, y, r, alpha, stretch) {
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    var fl = Math.sin(this.t * 18) * 0.15;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    var grad = ctx.createLinearGradient(0, 0, 0, -r * (1 + fl * 0.3));
    grad.addColorStop(0, 'rgba(255,215,120,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.quadraticCurveTo(-r * 0.2, -r * 0.5, 0, -r);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.5, r * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  Renderer.prototype._drawFace = function (R, expr, lookX, lookY, douse, sim) {
    var ctx = this.ctx;
    var eR = R * 0.17;
    var ex = R * 0.34, ey = -R * 0.12;
    var eyeL = function (sx, sy, r, look) {
      ctx.fillStyle = 'rgba(40,18,8,' + (1 - douse * 0.6) + ')';
      ctx.beginPath();
      ctx.ellipse(sx, sy, r, r * 0.92, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(sx + look * r * 0.5, sy + look * r * 0.5 + r * 0.2, r * 0.3, 0, TAU);
      ctx.fill();
    };

    if (expr === 'idle') {
      var blink = (Math.sin(this.t * 0.9 + sim.tick * 0.01) > 0.94) ? 0.1 : 1;
      eyeL(-ex, ey, eR * blink, { x: 0, y: -0.3 });
      eyeL(ex, ey, eR * blink, { x: 0, y: -0.3 });
      this._mouth(R * 0.22, R * 0.28, 'smile');
      this._cheeks(R);
    } else if (expr === 'aim') {
      ctx.fillStyle = 'rgba(255,120,30,0.85)';
      ctx.strokeStyle = 'rgba(40,18,8,1)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-ex - eR * 1.1 + lookX * eR * 0.5, ey - eR * 0.9);
      ctx.lineTo(-ex + eR * 0.8 + lookX * eR * 0.5, ey - eR * 0.2);
      ctx.moveTo(ex + eR * 1.1 + lookX * eR * 0.5, ey - eR * 0.9);
      ctx.lineTo(ex - eR * 0.8 + lookX * eR * 0.5, ey - eR * 0.2);
      ctx.stroke();
      eyeL(-ex, ey, eR, { x: lookX, y: lookY });
      eyeL(ex, ey, eR, { x: lookX, y: lookY });
      this._mouth(R * 0.16, R * 0.34, 'line');
    } else if (expr === 'flight') {
      eyeL(-ex, ey, eR * 1.18, { x: lookX * 1.3, y: lookY * 1.3 });
      eyeL(ex, ey, eR * 1.18, { x: lookX * 1.3, y: lookY * 1.3 });
      this._mouth(R * 0.3, R * 0.3, 'grin');
    } else if (expr === 'burst') {
      this._happyEye(-ex, ey, eR * 1.15);
      this._happyEye(ex, ey, eR * 1.15);
      this._mouth(R * 0.26, R * 0.3, 'grin');
    } else if (expr === 'cling') {
      ctx.strokeStyle = 'rgba(40,18,8,1)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-ex - eR * 1.1, ey - eR * 0.8);
      ctx.lineTo(-ex + eR * 0.6, ey - eR * 0.35);
      ctx.moveTo(ex + eR * 1.1, ey - eR * 0.8);
      ctx.lineTo(ex - eR * 0.6, ey - eR * 0.35);
      ctx.stroke();
      eyeL(-ex, ey, eR * 1.2, { x: 0, y: -0.5 });
      eyeL(ex, ey, eR * 1.2, { x: 0, y: -0.5 });
      this._mouth(R * 0.18, R * 0.4, 'grimace');
    } else if (expr === 'falling') {
      eyeL(-ex, ey, eR * 1.3, { x: 0, y: -0.4 });
      eyeL(ex, ey, eR * 1.3, { x: 0, y: -0.4 });
      this._mouth(R * 0.15, R * 0.42, 'tinyO');
      ctx.globalAlpha = 1;
    } else if (expr === 'douse') {
      if (douse < 0.45) {
        eyeL(-ex, ey, eR * 1.3, { x: 0, y: -0.4 });
        eyeL(ex, ey, eR * 1.3, { x: 0, y: -0.4 });
      } else {
        ctx.strokeStyle = 'rgba(60,58,58,' + (1 - (douse - 0.45) * 2) + ')';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(-ex, ey, eR, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, eR, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    }
  };

  Renderer.prototype._happyEye = function (x, y, r) {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(40,18,8,1)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  };

  Renderer.prototype._cheeks = function (R) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,140,80,0.35)';
    ctx.beginPath();
    ctx.arc(-R * 0.52, R * 0.12, R * 0.14, 0, TAU);
    ctx.arc(R * 0.52, R * 0.12, R * 0.14, 0, TAU);
    ctx.fill();
  };

  Renderer.prototype._mouth = function (w, y, kind) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(60,24,10,0.9)';
    ctx.strokeStyle = 'rgba(60,24,10,0.9)';
    ctx.lineWidth = 1.4;
    if (kind === 'smile') {
      ctx.beginPath();
      ctx.arc(0, y + w * 0.2, w * 0.6, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else if (kind === 'grin') {
      ctx.beginPath();
      ctx.ellipse(0, y, w * 0.6, w * 0.45, 0, 0, TAU);
      ctx.fill();
    } else if (kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, y);
      ctx.lineTo(w * 0.5, y);
      ctx.stroke();
    } else if (kind === 'tinyO') {
      ctx.beginPath();
      ctx.arc(0, y, w * 0.28, 0, TAU);
      ctx.fill();
    } else if (kind === 'grimace') {
      ctx.beginPath();
      ctx.moveTo(-w * 0.4, y);
      ctx.lineTo(-w * 0.1, y - w * 0.3);
      ctx.lineTo(w * 0.1, y - w * 0.3);
      ctx.lineTo(w * 0.4, y);
      ctx.stroke();
    }
  };

  Renderer.prototype._drawClingNubs = function (R, leftWall) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,180,90,0.9)';
    var d = leftWall ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(d * R * 0.9, -R * 0.15, R * 0.2, R * 0.3, 0, 0, TAU);
    ctx.ellipse(d * R * 0.9, R * 0.35, R * 0.2, R * 0.3, 0, 0, TAU);
    ctx.fill();
  };

  // ---- damp ----
  Renderer.prototype._drawDamp = function (sim) {
    var ctx = this.ctx;
    var baseY = this.sy(sim.dampY);
    var deathLift = 0;
    if (sim.phase === 'gameover') deathLift = Math.min(90, this.deathT * 80);
    var frontY = baseY - deathLift;
    if (frontY > this.viewH + 20) return;

    var breathe = Math.sin(this.t * 0.7) + Math.sin(this.t * 0.37 + 2) * 0.5;
    var agitate = 0.5 + sim.difficulty * 1.3 + breathe * 0.25;
    var segments = 26;
    var xs = [], ys = [];
    for (var i = 0; i <= segments; i++) {
      var x = (i / segments) * this.viewW;
      var wob = Math.sin(x * 0.013 + this.t * 0.85) * (5 + breathe) * agitate
        + Math.sin(x * 0.041 - this.t * 0.6) * 3;
      var k = Math.floor(this.t * 0.5) + i;
      var h = Math.sin(x * 12.9898 + k * 78.233) * 43758.5453;
      var spike = (h - Math.floor(h)) * 30 * (0.4 + agitate * 0.5);
      xs.push(x);
      ys.push(frontY + wob - spike);
    }

    ctx.save();
    ctx.globalAlpha = 1;
    var grad = ctx.createLinearGradient(0, frontY - 40, 0, this.viewH);
    grad.addColorStop(0, 'rgba(40,86,102,0.92)');
    grad.addColorStop(0.35, 'rgba(24,50,62,0.96)');
    grad.addColorStop(1, 'rgba(10,20,26,0.99)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, this.viewH);
    ctx.lineTo(0, ys[0]);
    for (var j = 0; j <= segments; j++) ctx.lineTo(xs[j], ys[j]);
    ctx.lineTo(this.viewW, this.viewH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(110,190,205,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var q = 0; q <= segments; q++) {
      if (q === 0) ctx.moveTo(xs[q], ys[q]);
      else ctx.lineTo(xs[q], ys[q]);
    }
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    for (var b = 0; b < 6; b++) {
      var bx = (b / 6) * this.viewW + Math.sin(this.t * 0.4 + b) * 20;
      var by = frontY + 6 + Math.sin(this.t * 0.8 + b * 2) * 5;
      ctx.globalAlpha = 0.12 + Math.sin(this.t * 2 + b) * 0.05;
      ctx.drawImage(this.sprites.glowCool, bx - 46, by - 20, 92, 40);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (var bu = 0; bu < 16; bu++) {
      var ux = (bu * 97 % this.viewW);
      var uy = frontY + 20 + ((bu * 53) % Math.max(1, this.viewH - frontY - 20));
      var ur = 1.2 + (bu % 3);
      ctx.fillStyle = 'rgba(150,215,220,' + (0.1 + Math.sin(this.t + bu) * 0.05) + ')';
      ctx.beginPath();
      ctx.arc(ux, uy + ((this.t * 14 + bu * 37) % 26), ur, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  // ---- chain orbit ----
  Renderer.prototype._drawChainOrbit = function (sim) {
    if (sim.chainCount < 2) return;
    var ctx = this.ctx;
    var n = Math.min(sim.chainCount, 6);
    var R = CFG.PLAYER_R * this.scale * 2.0;
    var cx = this.sx(sim.px), cy = this.sy(sim.py);
    var colors = ['#ffd76a', '#ffb74d', '#ff8a3c', '#ff5e3a', '#ff3d68', '#d05ef2'];
    var col = colors[Math.min(n - 2, colors.length - 1)];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < n; i++) {
      var a = this.t * (1 + n * 0.15) + (i * TAU) / n;
      var rx = cx + Math.cos(a) * R;
      var ry = cy + Math.sin(a) * R * 0.5;
      var pr = 2 + Math.sin(this.t * 9 + i) * 1;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.sprites.glowWarm, rx - pr * 4, ry - pr * 4, pr * 8, pr * 8);
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(rx, ry, pr, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  // ---- particles ----
  Renderer.prototype._spawnParticle = function (p) {
    if (this.particles.length < 170) this.particles.push(p);
  };

  Renderer.prototype._updateParticles = function (dt) {
    var list = this.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.t -= dt;
      if (p.t <= 0) { list.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g || 0) * dt;
      if (p.type === 'ring') p.r += p.vr * dt;
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0 && this.prevPhase === 'playing') {
      this.ambientTimer = 0.25;
      this._spawnParticle({
        type: 'ember', x: CFG.WALL_LEFT + 6 + Math.random() * (CFG.WALL_RIGHT - CFG.WALL_LEFT - 12),
        y: this.camBottom - 20, vx: (Math.random() - 0.5) * 6, vy: 30 + Math.random() * 40,
        g: 8, t: 2 + Math.random() * 2, size: 2 + Math.random() * 3
      });
    }
  };

  Renderer.prototype._drawParticles = function (sim) {
    var ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var sx = this.sx(p.x), sy = this.sy(p.y);
      var a = clamp(p.t / p.maxT, 0, 1);
      if (p.type === 'ember' || p.type === 'spark') {
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(this.sprites.ember, sx - p.size, sy - p.size, p.size * 2, p.size * 2);
      } else if (p.type === 'soot' || p.type === 'puff') {
        ctx.globalAlpha = a * 0.55;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = p.type === 'puff' ? '#8a7a68' : '#2c2622';
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1 + (1 - a)), 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
      } else if (p.type === 'sparkle') {
        ctx.globalAlpha = a;
        var sc = p.size * (1.4 - a * 0.6);
        ctx.drawImage(this.sprites.sparkle, sx - sc, sy - sc, sc * 2, sc * 2);
      } else if (p.type === 'ring') {
        ctx.globalAlpha = a * 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 + (1 - a) * 3;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r, 0, TAU);
        ctx.stroke();
      } else if (p.type === 'star') {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        var rr = p.size * (1 - a * 0.5);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(this.t * 8);
        ctx.beginPath();
        ctx.moveTo(0, -rr);
        ctx.quadraticCurveTo(rr * 0.3, -rr * 0.3, rr, 0);
        ctx.quadraticCurveTo(rr * 0.3, rr * 0.3, 0, rr);
        ctx.quadraticCurveTo(-rr * 0.3, rr * 0.3, -rr, 0);
        ctx.quadraticCurveTo(-rr * 0.3, -rr * 0.3, 0, -rr);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  // ---- popups ----
  Renderer.prototype._addPopup = function (x, y, text, color) {
    if (this.popups.length > 6) this.popups.shift();
    this.popups.push({ x: x, y: y, text: text, color: color, t: 1.1, maxT: 1.1 });
  };

  Renderer.prototype._updatePopups = function (dt) {
    for (var i = this.popups.length - 1; i >= 0; i--) {
      var p = this.popups[i];
      p.t -= dt;
      p.y += 34 * dt;
      if (p.t <= 0) this.popups.splice(i, 1);
    }
  };

  Renderer.prototype._drawPopups = function (sim) {
    var ctx = this.ctx;
    for (var i = 0; i < this.popups.length; i++) {
      var p = this.popups[i];
      var a = clamp(p.t / p.maxT, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '700 ' + (15 * this.scale * 0.55 + 8) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      var sx = this.sx(p.x), sy = this.sy(p.y);
      ctx.strokeText(p.text, sx, sy);
      ctx.fillText(p.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  };

  // ---- event detection & feedback ----
  Renderer.prototype._detectEvents = function (sim) {
    var ev = sim.lastEvent;
    if (ev && (!this.prevEvent || this.prevEvent.kind !== ev.kind || this.prevEvent.tick !== ev.tick)) {
      this.prevEvent = { kind: ev.kind, tick: ev.tick };
      this._onEvent(sim, ev.kind);
    }

    if (sim.phase === 'playing' && this.prevPhase !== 'playing') {
      this.hintDone = true;
    }
    this.prevPhase = sim.phase;

    if (sim.phase === 'gameover' && this.prevPhase !== 'gameover') {
      this.deathStart = this.t;
      this.deathT = 0;
      this.shake = 9;
      if (this.audio) this.audio.gameover();
      this._spawnDouse(sim);
    }
    if (sim.phase === 'gameover') {
      this.deathT = this.t - this.deathStart;
    }

    if (sim.jumpsLeft !== this.prevJumps) {
      var before = this.prevJumps;
      this.prevJumps = sim.jumpsLeft;
      if (sim.jumpsLeft > before) this.pipPulse = 0.6;
    }
  };

  Renderer.prototype._onEvent = function (sim, kind) {
    var x = sim.px, y = sim.py;
    var ctx = this;
    if (!this.audio) return;
    if (kind === 'launch') {
      var ratio = sim.lastLaunchPower || 0;
      this.audio.launch(ratio);
      for (var i = 0; i < 10; i++) {
        this._spawnParticle({
          type: 'spark', x: x, y: y,
          vx: (Math.random() - 0.5) * 120, vy: Math.random() * 160,
          g: -60, t: 0.4, maxT: 0.4, size: 3 + Math.random() * 3
        });
      }
      if (sim.chainCount >= 2) this.shake = Math.min(this.shake + 3, 6);
    } else if (kind === 'land') {
      this.audio.land();
      this.landT = 0.3;
      for (var k = 0; k < 8; k++) {
        this._spawnParticle({
          type: 'puff', x: x + (Math.random() - 0.5) * 16, y: y - 6,
          vx: (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 20,
          g: 40, t: 0.5, maxT: 0.5, size: 3 + Math.random() * 3
        });
      }
    } else if (kind === 'bounce') {
      this.audio.bounce(sim.chainCount);
      this.burstT = 0.28;
      this.flash = Math.min(1, this.flash + 0.12);
      this.flashColor = '255,255,240';
      this._spawnParticle({ type: 'star', x: x, y: y, vx: 0, vy: 0, g: 0, t: 0.4, maxT: 0.4, size: 22 * this.scale, color: '#c9d2dc' });
      for (var s = 0; s < 6; s++) {
        var a2 = (s / 6) * TAU;
        this._spawnParticle({ type: 'spark', x: x, y: y, vx: Math.cos(a2) * 80, vy: Math.sin(a2) * 80, g: 0, t: 0.4, maxT: 0.4, size: 3 });
      }
    } else if (kind === 'chain') {
      this.audio.chainLink(sim.chainCount);
      var colors = ['#ffd76a', '#ffb74d', '#ff8a3c', '#ff5e3a', '#ff3d68', '#d05ef2'];
      var col = colors[Math.min(sim.chainCount - 1, colors.length - 1)];
      this._spawnParticle({
        type: 'ring', x: x, y: y, vx: 0, vy: 0, g: 0, t: 0.4, maxT: 0.4,
        r: 10 * this.scale, vr: 60 * this.scale * (1 + sim.chainCount * 0.2), color: col
      });
      if (sim.chainCount >= 3) this.shake = Math.min(this.shake + 1.5 * sim.chainCount, 8);
    } else if (kind === 'glimmer') {
      this.audio.glimmer(sim.chainCount);
      var val = Math.round(CFG.GLIMMER_BASE * (sim.chainCount > 0 ? 1 + sim.chainCount * 0.5 : 1));
      this._addPopup(x, y + 14, '+' + val, '#ffe9a8');
      for (var g2 = 0; g2 < 8; g2++) {
        var a3 = (g2 / 8) * TAU;
        this._spawnParticle({ type: 'sparkle', x: x, y: y, vx: Math.cos(a3) * 70, vy: Math.sin(a3) * 70, g: -40, t: 0.5, maxT: 0.5, size: 5 });
      }
    } else if (kind === 'chainBank') {
      var len = sim.lastChainBanked;
      this.audio.chainBank(len);
      var bonus = Math.round(CFG.CHAIN_BASE * (len * (len + 1)) / 2);
      this._addPopup(x, y + 20, '+' + bonus, '#ffd76a');
      this.flash = Math.min(0.5, this.flash + 0.18);
      this.flashColor = '255,215,120';
      this._spawnParticle({ type: 'ring', x: x, y: y, vx: 0, vy: 0, g: 0, t: 0.6, maxT: 0.6, r: 10 * this.scale, vr: 90 * this.scale, color: '#ffd76a' });
    }
  };

  Renderer.prototype._spawnDouse = function (sim) {
    for (var i = 0; i < 22; i++) {
      this._spawnParticle({
        type: 'ember', x: sim.px + (Math.random() - 0.5) * 18, y: sim.py + (Math.random() - 0.5) * 14,
        vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60,
        g: -20, t: 1 + Math.random() * 0.8, maxT: 1.6, size: 2 + Math.random() * 3
      });
    }
  };

  // ---- vignette ----
  Renderer.prototype._drawVignette = function (sim) {
    var ctx = this.ctx;
    var gap = sim.dampY - (sim.py - CFG.PLAYER_R);
    var prox = clamp(1 - gap / 240, 0, 1);
    if (prox > 0.02 && sim.phase === 'playing') {
      var beat = 0.6 + Math.sin(this.t * 4) * 0.4;
      var g = ctx.createLinearGradient(0, this.viewH - this.viewH * 0.3, 0, this.viewH);
      g.addColorStop(0, 'rgba(120,30,30,0)');
      g.addColorStop(1, 'rgba(120,40,60,' + (prox * 0.4 * beat) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(this.viewX, 0, this.viewW, this.viewH);
      if (this.audio) this.audio.setDamp(prox);
    } else if (this.audio) {
      this.audio.setDamp(0);
    }
  };

  // ---- HUD ----
  Renderer.prototype._uiScale = function () {
    return clamp(this.viewW / 420, 0.7, 1.7);
  };

  Renderer.prototype._drawHUD = function (sim) {
    var ctx = this.ctx;
    var ui = this._uiScale();
    var cx = this.viewX + this.viewW / 2;
    var top = this.safeTop;

    ctx.textAlign = 'center';
    ctx.font = '700 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,160,0.55)';
    ctx.fillText('S C O R E', cx, top + 18 * ui);
    ctx.font = '700 ' + Math.round(30 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,232,190,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    var scoreText = Math.floor(sim.score).toLocaleString();
    ctx.strokeText(scoreText, cx, top + 46 * ui);
    ctx.fillText(scoreText, cx, top + 46 * ui);

    ctx.font = '600 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,160,0.5)';
    ctx.fillText('best ' + Math.floor(sim.sessionBest).toLocaleString(), cx, top + 62 * ui);

    var pipW = 20 * ui;
    var py = top + 82 * ui;
    for (var i = 0; i < sim.jumpCapacity; i++) {
      var px = cx + (i - 1) * pipW * 1.25;
      var active = i < sim.jumpsLeft;
      var pulse = this.pipPulse > 0 ? 1 + Math.sin(this.pipPulse * 18) * 0.35 * this.pipPulse : 1;
      ctx.fillStyle = active ? 'rgba(255,180,80,0.9)' : 'rgba(80,70,60,0.6)';
      ctx.beginPath();
      ctx.arc(px, py, (active ? 6.5 * ui : 6 * ui) * pulse, 0, TAU);
      ctx.fill();
      if (active) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4 + Math.sin(this.t * 5 + i) * 0.15;
        ctx.drawImage(this.sprites.glowWarm, px - 16 * ui, py - 16 * ui, 32 * ui, 32 * ui);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.strokeStyle = 'rgba(255,180,80,0.3)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, 6.5 * ui, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.textAlign = 'left';
    ctx.font = '600 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,160,0.45)';
    ctx.fillText('depth ' + Math.floor(sim.height).toLocaleString(), this.viewX + 14, top + 20 * ui);

    if (sim.chainCount >= 2) {
      var colors = ['#ffd76a', '#ffb74d', '#ff8a3c', '#ff5e3a', '#ff3d68', '#d05ef2'];
      var col = colors[Math.min(sim.chainCount - 2, colors.length - 1)];
      var badgeR = 14 * ui + sim.chainCount * 0.8;
      var bx = this.viewX + this.viewW - badgeR - 12 * ui;
      var by = top + 22 * ui + badgeR;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.sprites.glowWarm, bx - badgeR * 2, by - badgeR * 2, badgeR * 4, badgeR * 4);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(bx, by, badgeR, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff3dc';
      ctx.font = '700 ' + Math.round(13 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('x' + sim.chainCount, bx, by + 4.5 * ui);
      ctx.textAlign = 'left';
    }
  };

  Renderer.prototype._drawHint = function (sim) {
    if (this.hintDone || sim.phase !== 'ready') return;
    var ctx = this.ctx;
    var ui = this._uiScale();
    var cx = this.viewX + this.viewW / 2;
    var cy = this.viewH * 0.44;
    var pulse = 0.5 + Math.sin(this.t * 2.4) * 0.5;
    ctx.globalAlpha = 0.5 + pulse * 0.4;
    ctx.strokeStyle = 'rgba(255,217,160,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 16 * ui, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,217,160,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16 * ui);
    ctx.lineTo(cx, cy - 30 * ui);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - 33 * ui, 3 * ui, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,217,160,0.9)';
    ctx.font = '600 ' + Math.round(14 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('pull & release to launch', cx, cy - 48 * ui);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  };

  // ---- game over ----
  Renderer.prototype._drawGameOver = function (sim) {
    var ctx = this.ctx;
    var ui = this._uiScale();
    var cx = this.viewX + this.viewW / 2;
    var cy = this.viewH * 0.5;
    var a = clamp(this.deathT / 0.9, 0, 1);
    var a2 = clamp((this.deathT - 0.9) / 0.5, 0, 1);

    ctx.globalAlpha = a * 0.72;
    ctx.fillStyle = '#030208';
    ctx.fillRect(this.viewX, 0, this.viewW, this.viewH);
    ctx.globalAlpha = 1;

    if (a2 <= 0) return;
    var ease = 1 - Math.pow(1 - a2, 3);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.6 + 0.4 * ease, 0.6 + 0.4 * ease);
    ctx.globalAlpha = ease;

    var cardW = Math.min(this.viewW * 0.86, 360 * ui);
    var cardH = 300 * ui;
    var g = ctx.createLinearGradient(0, -cardH / 2, 0, cardH / 2);
    g.addColorStop(0, 'rgba(30,22,26,0.96)');
    g.addColorStop(1, 'rgba(14,10,14,0.98)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 18 * ui);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,180,90,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,217,160,0.5)';
    ctx.font = '600 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('T H E   D A M P   T O O K   Y O U', 0, -cardH / 2 + 26 * ui);

    var rank = CFG.rankFor(sim.score);
    var rankColor = rank.color;
    var rr = 34 * ui;
    ctx.strokeStyle = rankColor;
    ctx.lineWidth = 3 * ui;
    ctx.beginPath();
    ctx.arc(0, -cardH / 2 + 74 * ui, rr, 0, TAU);
    ctx.stroke();
    this._flameEmblem(0, -cardH / 2 + 74 * ui, rr * 0.6, rankColor);
    ctx.fillStyle = rankColor;
    ctx.font = '700 ' + Math.round(22 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(rank.name, 0, -cardH / 2 + 122 * ui);

    ctx.font = '700 ' + Math.round(40 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#fff0d4';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 5;
    ctx.strokeText(Math.floor(sim.score).toLocaleString(), 0, -cardH / 2 + 164 * ui);
    ctx.fillText(Math.floor(sim.score).toLocaleString(), 0, -cardH / 2 + 164 * ui);

    ctx.font = '600 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,160,0.55)';
    ctx.fillText('session best  ' + Math.floor(sim.sessionBest).toLocaleString(), 0, -cardH / 2 + 186 * ui);

    ctx.strokeStyle = 'rgba(255,180,90,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-cardW * 0.32, -cardH / 2 + 200 * ui);
    ctx.lineTo(cardW * 0.32, -cardH / 2 + 200 * ui);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,217,160,0.8)';
    ctx.font = '700 ' + Math.round(15 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('longest chain  x' + sim.chainBest, 0, -cardH / 2 + 224 * ui);
    ctx.font = '600 ' + Math.round(11 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,217,160,0.5)';
    ctx.fillText('height ' + Math.floor(sim.height).toLocaleString() + '  ·  ' + sim.glimmersCollected + ' glimmers', 0, -cardH / 2 + 244 * ui);

    var pulse = 0.5 + Math.sin(this.t * 2.6) * 0.5;
    ctx.fillStyle = 'rgba(255,217,160,' + (0.5 + pulse * 0.5) + ')';
    ctx.font = '700 ' + Math.round(15 * ui) + 'px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('tap anywhere to relight', 0, cardH / 2 - 22 * ui);

    ctx.restore();
    ctx.globalAlpha = 1;
  };

  Renderer.prototype._flameEmblem = function (x, y, s, color) {
    var ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.6, -s * 0.3, s * 0.55, s * 0.2, s * 0.2, s * 0.42);
    ctx.bezierCurveTo(s * 0.02, s * 0.6, 0, s * 0.78, 0, s * 0.9);
    ctx.bezierCurveTo(0, s * 0.78, -s * 0.02, s * 0.6, -s * 0.2, s * 0.42);
    ctx.bezierCurveTo(-s * 0.55, s * 0.2, -s * 0.6, -s * 0.3, 0, -s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,210,0.8)';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.2, s * 0.22, s * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  global.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
