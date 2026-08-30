/**
 * DELVE — canvas production. View-only: particles and juice never write sim.
 */
(function (root) {
  "use strict";

  function irand(id, k) {
    var x = Math.imul((id + 17) ^ Math.imul(k + 3, 374761393), 1597334677) >>> 0;
    return (x % 10000) / 10000;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function DelveView(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.stage = { x: 0, y: 0, w: 360, h: 640, scale: 1 };
    this.camX = 0;
    this.camD = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.parts = [];
    this.floaters = [];
    this.lastSeq = 0;
    this.crashT = 0;
    this.grazeT = 0;
    this.grazeSide = 1;
    this.collectT = 0;
    this.powerT = 0;
    this.combo = 0;
    this.comboT = 0;
    this.blink = 0;
    this.t = 0;
    this.best = 0;
    this.stick = null;
    this.grain = null;
    this.mood = "ready";
    this._makeGrain();
  }

  DelveView.prototype._makeGrain = function () {
    var c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    var g = c.getContext("2d");
    var img = g.createImageData(64, 64);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 80 + Math.random() * 50;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 28;
    }
    g.putImageData(img, 0, 0);
    this.grain = c;
  };

  DelveView.prototype.resize = function () {
    var vv = window.visualViewport;
    var w = Math.max(1, Math.floor(vv ? vv.width : window.innerWidth));
    var h = Math.max(1, Math.floor(vv ? vv.height : window.innerHeight));
    this.dpr = Math.min(2.25, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    var aspect = 9 / 16;
    var sw;
    var sh;
    if (w / h > aspect) {
      sh = h;
      sw = h * aspect;
    } else {
      sw = w;
      sh = w / aspect;
    }
    this.stage.w = sw;
    this.stage.h = sh;
    this.stage.x = (w - sw) * 0.5;
    this.stage.y = (h - sh) * 0.5;
    this.stage.scale = sh / 640;
    this.viewW = w;
    this.viewH = h;
  };

  DelveView.prototype.worldScale = function () {
    return this.stage.scale * (640 / 1040);
  };

  DelveView.prototype.w2s = function (x, depth) {
    var sc = this.worldScale();
    var ox = (this.stage.x + this.stage.w * 0.5 + this.shakeX) * this.dpr;
    var oy = (this.stage.y + 96 * this.stage.scale + this.shakeY) * this.dpr;
    return {
      x: ox + (x - this.camX) * sc * this.dpr,
      y: oy + (depth - this.camD) * sc * this.dpr
    };
  };

  DelveView.prototype.burst = function (x, depth, n, color, speed, life) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = (0.3 + Math.random()) * (speed || 80);
      this.parts.push({
        x: x,
        d: depth,
        vx: Math.cos(a) * s,
        vd: Math.sin(a) * s * 0.7,
        life: life || 0.45,
        age: 0,
        r: 1.5 + Math.random() * 3.5,
        color: color
      });
    }
  };

  DelveView.prototype.floater = function (x, depth, text, color) {
    this.floaters.push({ x: x, d: depth, text: text, color: color, age: 0, life: 0.7 });
  };

  DelveView.prototype.ingest = function (sim, snap) {
    var events = snap.events || [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      if (snap.tick - e.tick > 2) continue;
      this._onEvent(sim, snap, e);
    }
    if (snap.phase === "ready") this.lastSeq = 0;
  };

  DelveView.prototype._onEvent = function (sim, snap, e) {
    var x = snap.x;
    var d = snap.depth;
    if (e.kind === "fragment") {
      this.collectT = 1;
      this.burst(x, d, 10, "#7dffe0", 70, 0.4);
      this.floater(x, d, "+time", "#9ffff0");
      if (this.audio) this.audio.fragment();
    } else if (e.kind === "power") {
      this.powerT = 1;
      this.burst(x, d, 22, "#ff90c8", 110, 0.6);
      this.floater(x, d, "HEART", "#ffb3da");
      if (this.audio) this.audio.power();
    } else if (e.kind === "rock_hit") {
      this.crashT = 1;
      this.shake = Math.min(1, 0.35 + snap.speed / snap.maxSpeed * 0.55);
      this.burst(x, d, 18, "#c4b39a", 140, 0.5);
      this.burst(x, d, 8, "#6a5848", 90, 0.55);
      if (this.audio) this.audio.collision(true);
    } else if (e.kind === "rock_broken") {
      this.burst(x, d, 12, "#d8c4a8", 100, 0.4);
      if (this.audio && snap.invincibleUntilMs > snap.timeMs) this.audio.rockBreak(true);
    } else if (e.kind === "wall_contact") {
      this.crashT = 1;
      this.shake = 0.45 + snap.speed / snap.maxSpeed * 0.4;
      this.burst(x, d, 14, "#8a9aaa", 90, 0.4);
      if (this.audio) this.audio.collision(false);
    } else if (e.kind === "near_miss") {
      this.comboT = 1.1;
      this.combo = Math.min(8, this.combo + 1);
      this.grazeT = Math.min(1.2, 0.45 + this.combo * 0.12);
      this.grazeSide = x > (snap.courseCenterX || 0) ? 1 : -1;
      var amt = 6 + this.combo * 3;
      this.burst(x, d, amt, "#ffe0a0", 60 + this.combo * 12, 0.28 + this.combo * 0.03);
      this.shake = Math.min(0.55, 0.08 + this.combo * 0.05);
      if (this.audio) this.audio.nearMiss(this.combo);
    }
  };

  DelveView.prototype.setStick = function (stick) {
    this.stick = stick;
  };

  DelveView.prototype.stepView = function (dt, snap) {
    this.t += dt;
    this.crashT = Math.max(0, this.crashT - dt * 2.4);
    this.grazeT = Math.max(0, this.grazeT - dt * 2.1);
    this.collectT = Math.max(0, this.collectT - dt * 3.2);
    this.powerT = Math.max(0, this.powerT - dt * 1.6);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    this.shake *= Math.pow(0.04, dt);
    this.shakeX = (Math.random() * 2 - 1) * this.shake * 10;
    this.shakeY = (Math.random() * 2 - 1) * this.shake * 8;
    this.blink -= dt;
    if (this.blink < -0.12) this.blink = 2.2 + Math.random() * 2.4;
    var follow = snap.phase === "ready" ? 0.08 : 0.18;
    this.camX += (snap.courseCenterX * 0.72 + snap.x * 0.28 - this.camX) * Math.min(1, follow * 60 * dt);
    var targetD = snap.depth - 8;
    this.camD += (targetD - this.camD) * Math.min(1, 0.22 * 60 * dt);
    if (snap.phase === "ready") {
      this.camD = -36;
      this.camX = 0;
    }
    var i;
    if (this.parts.length > 90) this.parts.splice(0, this.parts.length - 90);
    for (i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.d += p.vd * dt;
      p.vx *= 0.92;
      p.vd *= 0.92;
      if (p.age >= p.life) this.parts.splice(i, 1);
    }
    for (i = this.floaters.length - 1; i >= 0; i--) {
      var f = this.floaters[i];
      f.age += dt;
      f.d -= 28 * dt;
      if (f.age >= f.life) this.floaters.splice(i, 1);
    }
    var span = clamp((snap.speed - 90) / (snap.maxSpeed - 90 || 1), 0, 1);
    var digging = snap.phase === "playing" && snap.input && snap.input.accel;
    if (digging && Math.random() < 0.5 + span * 0.45) {
      this.parts.push({
        x: snap.x + (Math.random() - 0.5) * 8,
        d: snap.depth - 10,
        vx: (Math.random() - 0.5) * 20,
        vd: -30 - span * 50,
        life: 0.28,
        age: 0,
        r: 2 + span * 2,
        color: span > 0.75 ? "#ffc070" : "#d4a078"
      });
    }
    if (snap.phase === "ready") this.mood = "ready";
    else if (snap.phase === "gameover") this.mood = "spent";
    else if (this.crashT > 0.35) this.mood = "crash";
    else if (this.grazeT > 0.2) this.mood = "graze";
    else if (span > 0.78) this.mood = "thrill";
    else if (snap.input && snap.input.accel) this.mood = "dig";
    else this.mood = "coast";
  };

  DelveView.prototype.draw = function (sim, snap) {
    var ctx = this.ctx;
    var w = this.canvas.width;
    var h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this._drawBackdrop(ctx, snap);
    ctx.save();
    var sx = this.stage.x * this.dpr;
    var sy = this.stage.y * this.dpr;
    var sw = this.stage.w * this.dpr;
    var sh = this.stage.h * this.dpr;
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    this._drawWorld(ctx, sim, snap);
    ctx.restore();
    this._drawHud(ctx, snap);
    if (this.stick) this._drawStick(ctx);
    if (snap.phase === "ready") this._drawReady(ctx, snap);
    if (snap.phase === "gameover") this._drawOver(ctx, snap);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.drawImage(this.grain, 0, 0, w, h);
    ctx.restore();
  };

  DelveView.prototype._drawBackdrop = function (ctx, snap) {
    var w = this.canvas.width;
    var h = this.canvas.height;
    var span = clamp((snap.speed - 90) / (snap.maxSpeed - 90 || 1), 0, 1);
    var g = ctx.createLinearGradient(0, 0, 0, h);
    if (snap.invincibleUntilMs > snap.timeMs && snap.phase === "playing") {
      g.addColorStop(0, "#1a1020");
      g.addColorStop(0.45, "#140c18");
      g.addColorStop(1, "#07060a");
    } else if (span > 0.75) {
      g.addColorStop(0, "#1c1410");
      g.addColorStop(0.5, "#100e12");
      g.addColorStop(1, "#07070a");
    } else {
      g.addColorStop(0, "#121820");
      g.addColorStop(0.4, "#0c1218");
      g.addColorStop(1, "#07090c");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    var d = snap.depth || 0;
    ctx.save();
    ctx.globalAlpha = 0.18;
    for (var i = 0; i < 7; i++) {
      var par = 0.12 + i * 0.05;
      var y = ((d * par * 0.35 + i * 90) % (h / this.dpr + 120)) * this.dpr;
      ctx.fillStyle = i % 2 ? "#1c2830" : "#18222a";
      ctx.beginPath();
      ctx.ellipse(w * (0.12 + (i % 3) * 0.38), y, 90 * this.dpr, 40 * this.dpr, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  DelveView.prototype._drawWorld = function (ctx, sim, snap) {
    var walls = snap.walls || [];
    var span = clamp((snap.speed - 90) / (snap.maxSpeed - 90 || 1), 0, 1);
    this._drawCorridorFill(ctx, walls, snap, span);
    this._drawWalls(ctx, walls, snap, span);
    this._drawVignette(ctx, snap, span);
    this._drawItems(ctx, snap);
    this._drawRocks(ctx, snap);
    this._drawParts(ctx);
    this._drawFloaters(ctx);
    this._drawMachine(ctx, snap, span);
    if (span > 0.72 && snap.phase === "playing") this._drawStreaks(ctx, snap, span);
  };

  DelveView.prototype._drawVignette = function (ctx, snap, span) {
    var sx = this.stage.x * this.dpr;
    var sy = this.stage.y * this.dpr;
    var sw = this.stage.w * this.dpr;
    var sh = this.stage.h * this.dpr;
    var g = ctx.createRadialGradient(sx + sw * 0.5, sy + sh * 0.28, sw * 0.15, sx + sw * 0.5, sy + sh * 0.4, sh * 0.75);
    var edge = snap.invincibleUntilMs > snap.timeMs ? "rgba(40,8,24,0.55)" : span > 0.78 ? "rgba(30,12,6,0.5)" : "rgba(0,0,0,0.42)";
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, edge);
    ctx.fillStyle = g;
    ctx.fillRect(sx, sy, sw, sh);
    if (this.grazeT > 0 && this.combo > 1) {
      ctx.fillStyle = "rgba(255,200,120," + (0.04 + this.combo * 0.015) * this.grazeT + ")";
      ctx.fillRect(sx, sy, sw, sh);
    }
  };

  DelveView.prototype._drawCorridorFill = function (ctx, walls, snap, span) {
    if (walls.length < 2) return;
    ctx.beginPath();
    var i;
    for (i = 0; i < walls.length; i++) {
      var a = this.w2s(walls[i].leftX, walls[i].depth);
      if (i === 0) ctx.moveTo(a.x, a.y);
      else ctx.lineTo(a.x, a.y);
    }
    for (i = walls.length - 1; i >= 0; i--) {
      var b = this.w2s(walls[i].rightX, walls[i].depth);
      ctx.lineTo(b.x, b.y);
    }
    ctx.closePath();
    var p0 = this.w2s(snap.courseCenterX, snap.depth);
    var p1 = this.w2s(snap.courseCenterX, snap.depth + 500);
    var g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    var rush = (snap.depth * 0.15) % 1;
    var c1 = snap.invincibleUntilMs > snap.timeMs ? "#241828" : "#1a242c";
    var c2 = snap.invincibleUntilMs > snap.timeMs ? "#1a1018" : "#12181e";
    g.addColorStop(0, c1);
    g.addColorStop(Math.min(0.99, 0.2 + rush * 0.1), c2);
    g.addColorStop(1, "#0c1014");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,200,120," + (0.03 + span * 0.06) + ")";
    ctx.lineWidth = 2 * this.dpr;
    var sc = this.worldScale() * this.dpr;
    var step = 28;
    var start = Math.floor(snap.depth / step) * step;
    for (var d = start; d < snap.depth + 760; d += step) {
      var q = this.w2s(snap.courseCenterX, d);
      ctx.globalAlpha = 0.12 + span * 0.2;
      ctx.beginPath();
      ctx.moveTo(q.x - 200 * sc, q.y);
      ctx.lineTo(q.x + 200 * sc, q.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  DelveView.prototype._drawWalls = function (ctx, walls, snap, span) {
    if (walls.length < 2) return;
    var thick = 90;
    this._fillWallBand(ctx, walls, true, thick, snap);
    this._fillWallBand(ctx, walls, false, thick, snap);
    ctx.lineWidth = (2.2 + span * 1.4) * this.dpr;
    ctx.strokeStyle = snap.invincibleUntilMs > snap.timeMs ? "rgba(255,140,190,0.35)" : "rgba(255,186,110,0.28)";
    ctx.beginPath();
    var i;
    for (i = 0; i < walls.length; i++) {
      var L = this.w2s(walls[i].leftX, walls[i].depth);
      if (i === 0) ctx.moveTo(L.x, L.y);
      else ctx.lineTo(L.x, L.y);
    }
    ctx.stroke();
    ctx.beginPath();
    for (i = 0; i < walls.length; i++) {
      var R = this.w2s(walls[i].rightX, walls[i].depth);
      if (i === 0) ctx.moveTo(R.x, R.y);
      else ctx.lineTo(R.x, R.y);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 170, 90, 0.09)";
    for (i = 0; i < walls.length; i += 3) {
      var w = walls[i];
      var vein = this.w2s(w.leftX - 8, w.depth);
      ctx.beginPath();
      ctx.arc(vein.x, vein.y, 3 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  DelveView.prototype._fillWallBand = function (ctx, walls, left, thick, snap) {
    ctx.beginPath();
    var i;
    for (i = 0; i < walls.length; i++) {
      var x = left ? walls[i].leftX : walls[i].rightX;
      var p = this.w2s(x, walls[i].depth);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    for (i = walls.length - 1; i >= 0; i--) {
      var x2 = left ? walls[i].leftX - thick : walls[i].rightX + thick;
      var q = this.w2s(x2, walls[i].depth);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(this.stage.x * this.dpr, 0, (this.stage.x + this.stage.w) * this.dpr, 0);
    if (left) {
      g.addColorStop(0, "#0a0c10");
      g.addColorStop(0.7, "#2a343c");
      g.addColorStop(1, "#3a2e28");
    } else {
      g.addColorStop(0, "#3a2e28");
      g.addColorStop(0.3, "#2a343c");
      g.addColorStop(1, "#0a0c10");
    }
    ctx.fillStyle = g;
    ctx.fill();
  };

  DelveView.prototype._rockPoly = function (id, cx, cy, r) {
    var n = 6 + Math.floor(irand(id, 1) * 3);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + irand(id, i + 2) * 0.4;
      var rr = r * (0.78 + irand(id, i + 9) * 0.32);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.92 });
    }
    return pts;
  };

  DelveView.prototype._drawRocks = function (ctx, snap) {
    var rocks = snap.rocks || [];
    var powered = snap.invincibleUntilMs > snap.timeMs;
    for (var i = 0; i < rocks.length; i++) {
      var r = rocks[i];
      if (!r.active) continue;
      var p = this.w2s(r.position.x, r.position.depth);
      var rad = r.visualRadius * this.worldScale() * this.dpr;
      var pts = this._rockPoly(r.id, p.x, p.y, rad);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath();
      var grd = ctx.createRadialGradient(p.x - rad * 0.3, p.y - rad * 0.3, rad * 0.1, p.x, p.y, rad);
      if (powered) {
        grd.addColorStop(0, "#e8b48a");
        grd.addColorStop(0.55, "#c45a6a");
        grd.addColorStop(1, "#5a2030");
      } else {
        grd.addColorStop(0, "#8a9088");
        grd.addColorStop(0.5, "#4a524c");
        grd.addColorStop(1, "#2a302c");
      }
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = powered ? "rgba(255,210,160,0.55)" : "rgba(20,24,22,0.55)";
      ctx.lineWidth = 1.4 * this.dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[Math.floor(pts.length / 3)].x, pts[Math.floor(pts.length / 3)].y);
      ctx.stroke();
      if (powered) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,140,90,0.45)";
        ctx.lineWidth = 2 * this.dpr;
        ctx.arc(p.x, p.y, rad + 4 * this.dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };

  DelveView.prototype._drawItems = function (ctx, snap) {
    var items = snap.items || [];
    var t = this.t;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.active) continue;
      var p = this.w2s(it.position.x, it.position.depth);
      if (it.type === "power") this._drawHeart(ctx, p.x, p.y, it.visualRadius * this.worldScale() * this.dpr, t);
      else this._drawShard(ctx, p.x, p.y, it.visualRadius * this.worldScale() * this.dpr, t + it.id);
    }
  };

  DelveView.prototype._drawShard = function (ctx, x, y, r, t) {
    var bob = Math.sin(t * 4) * r * 0.12;
    y += bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 1.6) * 0.2);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.15);
    ctx.lineTo(r * 0.7, r * 0.2);
    ctx.lineTo(0, r * 0.95);
    ctx.lineTo(-r * 0.7, r * 0.2);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, "#e8fff8");
    g.addColorStop(0.4, "#5dffd2");
    g.addColorStop(1, "#1a8a78");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(200,255,240,0.7)";
    ctx.lineWidth = 1.2 * this.dpr;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.fillStyle = "rgba(90,255,210,0.16)";
    ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
    ctx.fill();
  };

  DelveView.prototype._drawHeart = function (ctx, x, y, r, t) {
    var pulse = 1 + Math.sin(t * 6) * 0.08;
    r *= pulse;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,90,170,0.18)";
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,180,220,0.5)";
    ctx.lineWidth = 2 * this.dpr;
    ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.85);
    ctx.bezierCurveTo(r, r * 0.1, r * 0.7, -r * 0.7, 0, -r * 0.25);
    ctx.bezierCurveTo(-r * 0.7, -r * 0.7, -r, r * 0.1, 0, r * 0.85);
    ctx.fillStyle = "#ff6aa8";
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.15, r * 0.18, r * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  DelveView.prototype._drawParts = function (ctx) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var a = 1 - p.age / p.life;
      var s = this.w2s(p.x, p.d);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r * this.dpr * this.stage.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  DelveView.prototype._drawFloaters = function (ctx) {
    ctx.font = "600 " + 11 * this.dpr * this.stage.scale + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    for (var i = 0; i < this.floaters.length; i++) {
      var f = this.floaters[i];
      var s = this.w2s(f.x, f.d);
      ctx.globalAlpha = 1 - f.age / f.life;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  };

  DelveView.prototype._drawStreaks = function (ctx, snap, span) {
    var n = Math.floor(6 + span * 10);
    ctx.save();
    ctx.strokeStyle = "rgba(255,220,170," + (0.08 + span * 0.12) + ")";
    ctx.lineWidth = 1.2 * this.dpr;
    for (var i = 0; i < n; i++) {
      var x = snap.x + (irand(i + 3, Math.floor(snap.depth)) - 0.5) * 90;
      var d0 = snap.depth - 20 + i * 18;
      var a = this.w2s(x, d0);
      var b = this.w2s(x, d0 + 30 + span * 40);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  DelveView.prototype._drawMachine = function (ctx, snap, span) {
    var p = this.w2s(snap.x, snap.depth);
    var sc = this.worldScale() * this.dpr;
    var R = snap.playerRadius * sc;
    var mood = this.mood;
    var t = this.t;
    var squashX = 1;
    var squashY = 1;
    var tilt = (snap.input ? snap.input.steer : 0) * 0.28;
    var glow = "#7bffd4";
    var eyeOpen = 1;
    var drill = t * (8 + span * 22);
    if (mood === "ready") {
      p.y += Math.sin(t * 3.2) * 2.2 * this.dpr;
      tilt += Math.sin(t * 1.4) * 0.05;
      drill = t * 3;
      glow = "#8cffda";
    } else if (mood === "dig") {
      squashY = 1.06;
      squashX = 0.96;
      glow = "#7bffd4";
    } else if (mood === "thrill") {
      squashY = 1.18;
      squashX = 0.88;
      glow = "#ffe08a";
      eyeOpen = 1.15;
      p.x += Math.sin(t * 40) * span * 0.8 * this.dpr;
    } else if (mood === "graze") {
      squashX = 1.16;
      squashY = 0.9;
      p.x += this.grazeSide * this.grazeT * 6 * this.dpr;
      glow = "#ffd080";
    } else if (mood === "crash") {
      squashX = 1.22;
      squashY = 0.78;
      glow = "#ff8a6a";
      eyeOpen = 0.35;
    } else if (mood === "coast") {
      squashY = 1.0;
      glow = "#9ae0c8";
      eyeOpen = 0.82;
      drill = t * 5;
    } else if (mood === "spent") {
      squashY = 0.86;
      squashX = 1.1;
      glow = "#4a6058";
      eyeOpen = Math.max(0.08, 0.4 - (1 - Math.min(1, this.t % 10)) * 0);
      drill = t * 0.6;
    }
    if (snap.phase === "playing" && snap.remainingMs < 3000) glow = "#ffb070";
    if (this.blink > 0 && this.blink < 0.08 && mood !== "crash") eyeOpen *= 0.1;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(tilt);
    ctx.scale(squashX, squashY);

    ctx.beginPath();
    ctx.fillStyle = "rgba(255,190,110,0.13)";
    ctx.moveTo(-R * 1.6, R * 0.2);
    ctx.lineTo(0, R * 8);
    ctx.lineTo(R * 1.6, R * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(40, 28, 20, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, R * 1.15, R * 0.95, R * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(0, R * 0.95);
    ctx.rotate(drill);
    ctx.fillStyle = "#c9a36a";
    ctx.strokeStyle = "#6a4a28";
    ctx.lineWidth = 1.2 * this.dpr;
    for (var k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(R * 0.55, R * 0.2, 0, R * 0.85);
      ctx.quadraticCurveTo(-R * 0.55, R * 0.2, 0, 0);
      ctx.fill();
      ctx.stroke();
      ctx.rotate((Math.PI * 2) / 3);
    }
    ctx.restore();

    var body = ctx.createRadialGradient(-R * 0.25, -R * 0.35, R * 0.1, 0, 0, R * 1.15);
    body.addColorStop(0, "#f0c8a0");
    body.addColorStop(0.45, "#d4895a");
    body.addColorStop(1, "#6a3a24");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.08, R * 1.05, R * 1.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,40,20,0.45)";
    ctx.lineWidth = 1.6 * this.dpr;
    ctx.stroke();

    ctx.fillStyle = "#e8c48a";
    ctx.beginPath();
    ctx.arc(-R * 0.72, -R * 0.55, R * 0.16, 0, Math.PI * 2);
    ctx.arc(R * 0.72, -R * 0.55, R * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b07848";
    ctx.beginPath();
    ctx.arc(-R * 0.72, -R * 0.55, R * 0.07, 0, Math.PI * 2);
    ctx.arc(R * 0.72, -R * 0.55, R * 0.07, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c48454";
    ctx.beginPath();
    ctx.ellipse(-R * 1.12, R * 0.15, R * 0.22, R * 0.38, -0.4, 0, Math.PI * 2);
    ctx.ellipse(R * 1.12, R * 0.15, R * 0.22, R * 0.38, 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "#1a2422";
    ctx.ellipse(0, -R * 0.18, R * 0.62, R * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    var vis = ctx.createRadialGradient(-R * 0.1, -R * 0.3, R * 0.05, 0, -R * 0.1, R * 0.6);
    vis.addColorStop(0, glow);
    vis.addColorStop(0.55, mood === "spent" ? "#2a4038" : "#1c8a72");
    vis.addColorStop(1, "#0a201c");
    ctx.fillStyle = vis;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.18, R * 0.54, R * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();

    var ew = R * 0.13 * (mood === "thrill" ? 1.25 : 1);
    var eh = R * 0.16 * eyeOpen;
    var lookX = tilt * 6;
    var lookY = mood === "ready" ? Math.sin(t * 0.8) * 2 : mood === "dig" || mood === "thrill" ? 2.2 : 0;
    ctx.fillStyle = "#10211c";
    ctx.beginPath();
    ctx.ellipse(-R * 0.18 + lookX, -R * 0.22 + lookY, ew, Math.max(0.6, eh), 0, 0, Math.PI * 2);
    ctx.ellipse(R * 0.18 + lookX, -R * 0.22 + lookY, ew, Math.max(0.6, eh), 0, 0, Math.PI * 2);
    ctx.fill();
    if (eyeOpen > 0.4) {
      ctx.fillStyle = "#f4fff8";
      ctx.beginPath();
      ctx.arc(-R * 0.22 + lookX, -R * 0.28 + lookY, R * 0.045, 0, Math.PI * 2);
      ctx.arc(R * 0.14 + lookX, -R * 0.28 + lookY, R * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    if (mood === "thrill") {
      ctx.strokeStyle = "rgba(20,40,30,0.55)";
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.beginPath();
      ctx.arc(0, -R * 0.02, R * 0.16, 0.15, Math.PI - 0.15);
      ctx.stroke();
    } else if (mood === "crash") {
      ctx.strokeStyle = "rgba(40,20,20,0.6)";
      ctx.beginPath();
      ctx.moveTo(-R * 0.28, -R * 0.32);
      ctx.lineTo(-R * 0.12, -R * 0.16);
      ctx.moveTo(-R * 0.12, -R * 0.32);
      ctx.lineTo(-R * 0.28, -R * 0.16);
      ctx.moveTo(R * 0.12, -R * 0.32);
      ctx.lineTo(R * 0.28, -R * 0.16);
      ctx.moveTo(R * 0.28, -R * 0.32);
      ctx.lineTo(R * 0.12, -R * 0.16);
      ctx.stroke();
    } else if (mood === "spent") {
      ctx.strokeStyle = "rgba(10,20,18,0.4)";
      ctx.beginPath();
      ctx.arc(0, R * 0.02, R * 0.14, Math.PI + 0.2, -0.2);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(232, 196, 138, 0.7)";
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    ctx.arc(0, -R * 0.18, R * 0.62, -0.9, 0.4);
    ctx.stroke();

    if (mood === "dig" || mood === "thrill") {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = mood === "thrill" ? "#ffc070" : "#d8a070";
      ctx.beginPath();
      ctx.ellipse(0, -R * 1.15, R * 0.18, R * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (snap.invincibleUntilMs > snap.timeMs && snap.phase === "playing") {
      ctx.strokeStyle = "rgba(255,110,180," + (0.4 + Math.sin(t * 10) * 0.2) + ")";
      ctx.lineWidth = 3 * this.dpr;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    if (snap.phase === "ready") this._drawPad(ctx, snap);
  };

  DelveView.prototype._drawPad = function (ctx, snap) {
    var p = this.w2s(0, -8);
    var sc = this.worldScale() * this.dpr;
    ctx.save();
    ctx.fillStyle = "rgba(12, 16, 22, 0.55)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 8 * sc, 70 * sc, 16 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(232, 180, 110, 0.5)";
    ctx.lineWidth = 2.4 * this.dpr;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 16 * sc, 52 * sc, 11 * sc, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(232, 180, 110, 0.18)";
    ctx.lineWidth = 6 * this.dpr;
    ctx.stroke();
    ctx.fillStyle = "rgba(232, 180, 110, 0.07)";
    ctx.fill();
    ctx.restore();
  };

  DelveView.prototype._drawHud = function (ctx, snap) {
    var dpr = this.dpr;
    var x = (this.stage.x + 18) * dpr;
    var y = (this.stage.y + 16) * dpr;
    var w = (this.stage.w - 36) * dpr;
    var meterH = 10 * dpr;
    var frac = clamp(snap.remainingMs / 20000, 0, 1);
    var low = snap.remainingMs < 6000;
    var crit = snap.remainingMs < 3000;
    ctx.save();
    roundRect(ctx, x, y, w, meterH + 18 * dpr, 9 * dpr);
    ctx.fillStyle = "rgba(8,12,16,0.55)";
    ctx.fill();
    roundRect(ctx, x + 8 * dpr, y + 12 * dpr, w - 16 * dpr, meterH, 5 * dpr);
    ctx.fillStyle = "#1a2228";
    ctx.fill();
    var fillW = (w - 16 * dpr) * frac;
    var mg = ctx.createLinearGradient(x, 0, x + w, 0);
    if (crit) {
      mg.addColorStop(0, "#ff6a4a");
      mg.addColorStop(1, "#ffb070");
    } else if (low) {
      mg.addColorStop(0, "#ffb04a");
      mg.addColorStop(1, "#ffe08a");
    } else {
      mg.addColorStop(0, "#2fbfa0");
      mg.addColorStop(1, "#7bffd4");
    }
    ctx.save();
    roundRect(ctx, x + 8 * dpr, y + 12 * dpr, Math.max(0, fillW), meterH, 5 * dpr);
    ctx.fillStyle = mg;
    if (crit && snap.phase === "playing") ctx.globalAlpha = 0.65 + Math.sin(this.t * 12) * 0.35;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(220,210,190,0.7)";
    ctx.font = "600 " + 9 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("LIGHT", x + 10 * dpr, y + 9 * dpr);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,230,180,0.9)";
    ctx.font = "700 " + 13 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(Math.floor(snap.score)), x + w - 10 * dpr, y + 10 * dpr);

    var depthY = (this.stage.y + this.stage.h - 28) * dpr;
    ctx.textAlign = "left";
    ctx.font = "600 " + 10 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(200,210,220,0.45)";
    ctx.fillText("DEPTH  " + Math.floor(snap.depth), x, depthY);

    if (snap.invincibleUntilMs > snap.timeMs && snap.phase === "playing") {
      var left = Math.max(0, snap.invincibleUntilMs - snap.timeMs);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ff9ac8";
      ctx.fillText("HEART  " + (left / 1000).toFixed(1) + "s", x + w, depthY);
    }
    ctx.restore();
  };

  DelveView.prototype._drawStick = function (ctx) {
    var s = this.stick;
    var dpr = this.dpr;
    var ox = s.originX * dpr;
    var oy = s.originY * dpr;
    var nx = s.x * dpr;
    var ny = s.y * dpr;
    ctx.save();
    ctx.strokeStyle = "rgba(232,180,110,0.35)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(ox, oy, 28 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(232,180,110,0.18)";
    ctx.arc(ox, oy, 52 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "rgba(232,180,110,0.55)";
    ctx.arc(nx, ny, 11 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  DelveView.prototype._drawReady = function (ctx, snap) {
    var dpr = this.dpr;
    var cx = (this.stage.x + this.stage.w * 0.5) * dpr;
    var y = (this.stage.y + 58) * dpr;
    ctx.save();
    this._logo(ctx, cx, y, dpr * this.stage.scale);
    ctx.fillStyle = "rgba(210,200,180,0.55)";
    ctx.font = "500 " + 11 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("keep the lantern fed", cx, y + 28 * dpr);
    var pulse = 0.45 + Math.sin(this.t * 3) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#e8c48a";
    ctx.beginPath();
    var ay = (this.stage.y + 168) * dpr;
    ctx.moveTo(cx, ay + 14 * dpr);
    ctx.lineTo(cx - 8 * dpr, ay);
    ctx.lineTo(cx + 8 * dpr, ay);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  DelveView.prototype._logo = function (ctx, cx, y, s) {
    ctx.save();
    ctx.translate(cx, y);
    ctx.shadowColor = "rgba(255,180,90,0.4)";
    ctx.shadowBlur = 16 * s;
    ctx.fillStyle = "#f0d2a8";
    ctx.font = "800 " + 26 * s + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    var letters = ["D", "E", "L", "V", "E"];
    var gap = 22 * s;
    var start = -((letters.length - 1) * gap) / 2;
    for (var i = 0; i < letters.length; i++) ctx.fillText(letters[i], start + i * gap, 0);
    ctx.restore();
  };

  DelveView.prototype._drawOver = function (ctx, snap) {
    var dpr = this.dpr;
    var x = this.stage.x * dpr;
    var y = this.stage.y * dpr;
    var w = this.stage.w * dpr;
    var h = this.stage.h * dpr;
    ctx.save();
    ctx.fillStyle = "rgba(6,8,10,0.46)";
    ctx.fillRect(x, y, w, h);
    var cardW = Math.min(w * 0.84, 300 * dpr);
    var cardH = 210 * dpr;
    var cx = x + (w - cardW) / 2;
    var cy = y + h * 0.38;
    roundRect(ctx, cx, cy, cardW, cardH, 18 * dpr);
    ctx.fillStyle = "rgba(16, 20, 24, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(232,180,110,0.35)";
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8c48a";
    ctx.font = "800 " + 36 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(snap.rank || "D", cx + cardW / 2, cy + 52 * dpr);
    ctx.fillStyle = "#f4efe6";
    ctx.font = "700 " + 22 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    ctx.fillText(String(Math.floor(snap.score)), cx + cardW / 2, cy + 84 * dpr);
    ctx.fillStyle = "rgba(210,200,180,0.55)";
    ctx.font = "500 " + 11 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    var best = Math.max(this.best, Math.floor(snap.score));
    ctx.fillText("best  " + best, cx + cardW / 2, cy + 104 * dpr);
    var sig = snap.signature;
    if (sig) {
      ctx.fillStyle = "#7bffd4";
      ctx.font = "600 " + 12 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
      ctx.fillText(sig.label.toUpperCase() + "  ·  " + sig.text, cx + cardW / 2, cy + 132 * dpr);
    }
    ctx.fillStyle = "rgba(232,180,110,0.8)";
    ctx.font = "600 " + 12 * dpr + "px Trebuchet MS, Segoe UI, sans-serif";
    var pulse = 0.55 + Math.sin(this.t * 3.2) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.fillText("tap to delve again", cx + cardW / 2, cy + 168 * dpr);
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  root.DelveView = DelveView;
})(typeof window !== "undefined" ? window : globalThis);
