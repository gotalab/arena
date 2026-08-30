/* DELVE — the view. Composes the scene, the HUD and the two screens.
 * Reads simulation state, never writes it.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});
  var Art = DELVE.Art;
  var P = Art.palette;
  var C = DELVE.C;
  var clamp = Art.clamp, lerp = Art.lerp;

  var MAX_STAGE_ASPECT = 0.62; // the play column never gets wider than this

  function Renderer(canvas, game, fx) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.fx = fx;
    this.t = 0;
    this.dpr = 1;

    this.rockTile = Art.rockTile(220);
    this.pattern = this.ctx.createPattern(this.rockTile, 'repeat');

    // character state (view-only)
    this.expr = 'ready';
    this.exprUntil = 0;
    this.grazeSide = 1;
    this.blink = 1;
    this.blinkAt = 1.5;
    this.drill = 0;
    this.bob = 0;
    this.bobV = 0;
    this.hitPunch = 0;
    this.lean = 0;
    this.smoothSpeed = C.IDLE_SPEED;
    this.tint = 0;
    this.padOpen = 0;
    this.gaugeA = 0;

    // ceremony state
    this.overAt = -1;
    this.scoreShown = 0;
    this.best = 0;
    this.newBest = false;
    this.signature = null;

    // progressive hints
    this.hasSteered = false;
    this.steerHint = 0;
    this.runsPlayed = 0;

    this.cam = { u: 1, cx: 0, py: 0, d0: 0, h: 0, streak: 0, sx: null, sy: null };
    var cam = this.cam;
    cam.sx = function (x) { return cam.cx + x * cam.u; };
    cam.sy = function (d) { return cam.py + (d - cam.d0) * cam.u; };

    this.resize();
  }

  Renderer.prototype.resize = function () {
    var w = Math.max(160, this.canvas.clientWidth || window.innerWidth);
    var h = Math.max(200, this.canvas.clientHeight || window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    this.dpr = dpr;
    this.cssW = w; this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);

    this.stageW = Math.min(w, h * MAX_STAGE_ASPECT);
    this.stageH = h;
    this.stageX = (w - this.stageW) / 2;
    this.baseU = Math.min(this.stageW / C.VIEW_W, this.stageH / C.VIEW_H);
    this.ui = clamp(this.stageW / 390, 0.66, 2.0);
    this.pattern = this.ctx.createPattern(this.rockTile, 'repeat');
  };

  // ------------------------------------------------------------ character --
  Renderer.prototype.setExpr = function (name, dur) {
    var pri = { end: 6, hit: 5, graze: 4, fast: 2, dig: 1, coast: 1, ready: 3 };
    if (this.t < this.exprUntil && (pri[this.expr] || 0) > (pri[name] || 0)) return;
    this.expr = name;
    this.exprUntil = this.t + (dur || 0);
  };

  Renderer.prototype.onEvent = function (kind, data) {
    var g = this.game;
    var fx = this.fx;
    var sx, sd;
    if (kind === 'rock_hit') {
      sx = data.x; sd = data.depth;
      fx.rockHit(sx, sd, data.r, g.x);
      this.setExpr('hit', 0.75);
      this.hitPunch = 1;
    } else if (kind === 'wall_contact') {
      fx.wallHit(data.x + data.side * C.PLAYER_RADIUS, data.depth, data.side);
      this.setExpr('hit', 0.65);
      this.hitPunch = 0.85;
    } else if (kind === 'rock_broken') {
      fx.rockBreak(data.x, data.depth, data.r, data.powered);
      if (data.powered) this.hitPunch = Math.max(this.hitPunch, 0.35);
    } else if (kind === 'fragment') {
      fx.fragment(data.x, data.depth, data.chain);
    } else if (kind === 'near_miss') {
      fx.nearMiss(data.x, data.depth, data.r, data.gap, data.combo, data.side);
      this.grazeSide = data.side;
      this.setExpr('graze', 0.42);
    } else if (kind === 'power') {
      fx.power(data.x, data.depth);
    } else if (kind === 'run_end') {
      fx.runEnd(g.x, g.depth);
      this.endRun();
    }
  };

  Renderer.prototype.endRun = function () {
    var g = this.game;
    this.overAt = this.t;
    this.scoreShown = 0;
    this.runsPlayed++;
    var score = Math.floor(g.score);
    this.newBest = score > this.best;
    if (this.newBest) this.best = score;

    // the run's own bragging right: whichever number tells its story
    if (g.maxCombo >= 4) {
      this.signature = { label: 'LONGEST GRAZE CHAIN', value: g.maxCombo + '\u00d7', sub: 'rocks threaded back to back' };
    } else if (g.bestThrottle >= 5200) {
      this.signature = { label: 'LONGEST BURN', value: (g.bestThrottle / 1000).toFixed(1) + 's', sub: 'held at full throttle' };
    } else if (g.closestShave < 3.2) {
      this.signature = { label: 'CLOSEST SHAVE', value: Math.round(g.closestShave * 10) + 'cm', sub: 'of clear rock, and no more' };
    } else {
      this.signature = { label: 'DEEPEST POINT', value: Math.round(g.depth / 10) + 'm', sub: 'below the surface' };
    }
  };

  Renderer.prototype.resetView = function () {
    this.overAt = -1;
    this.expr = 'ready';
    this.exprUntil = 0;
    this.hitPunch = 0;
    this.smoothSpeed = C.IDLE_SPEED;
    this.steerHint = 0;
    this.hasSteered = false;
    this.padOpen = 0;
    this.gaugeA = 0;
    this.fx.clear();
  };

  // ----------------------------------------------------------------- frame --
  Renderer.prototype.frame = function (dt, io) {
    this.t += dt;
    var g = this.game, fx = this.fx, ctx = this.ctx;
    var t = this.t;

    var sf = clamp((g.speed - C.IDLE_SPEED) / (C.MAX_SPEED - C.IDLE_SPEED), 0, 1);
    this.smoothSpeed = lerp(this.smoothSpeed, g.speed, 1 - Math.pow(0.001, dt));
    var powered = g.phase === 'playing' && g.timeMs < g.invincibleUntilMs;

    // expression
    if (t >= this.exprUntil) {
      if (g.phase === 'ready') this.setExpr('ready', 0);
      else if (g.phase === 'gameover') this.setExpr('end', 0);
      else if (sf > 0.62) this.setExpr('fast', 0);
      else if (g.input.accel) this.setExpr('dig', 0);
      else this.setExpr('coast', 0);
    }
    if (g.phase === 'gameover') this.setExpr('end', 0.01);

    // blink
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) { this.blinkAt = 1.6 + Math.random() * 3.2; this.blinkT = 0.13; }
    if (this.blinkT > 0) { this.blinkT -= dt; this.blink = clamp(Math.abs(this.blinkT - 0.065) / 0.065, 0.05, 1); }
    else this.blink = 1;

    this.drill = (this.drill + dt * (0.5 + sf * 7) * (g.phase === 'gameover' ? 0.06 : 1)) % 1;
    this.hitPunch *= Math.pow(0.004, dt);
    this.lean = lerp(this.lean, clamp(g.vx / 95, -1, 1), 1 - Math.pow(0.0005, dt));

    // antenna bobble: a little spring that lags behind everything
    var drive = -this.lean * 0.7 + (g.input.accel ? -0.25 : 0.1) - this.hitPunch * 1.6;
    this.bobV += (drive - this.bob) * 190 * dt - this.bobV * 9 * dt;
    this.bob += this.bobV * dt;
    this.bob = clamp(this.bob, -1.4, 1.4);

    if (g.input.steer !== 0) this.hasSteered = true;

    // camera: a touch of zoom-out and extra lookahead as speed builds
    var cam = this.cam;
    cam.u = this.baseU / (1 + 0.05 * sf);
    cam.cx = this.stageX + this.stageW / 2;
    cam.py = this.stageH * lerp(C.PLAYER_SCREEN_Y, C.PLAYER_SCREEN_Y - 0.07, sf);
    cam.d0 = g.depth;
    cam.h = this.stageH;
    cam.streak = sf;

    // ambient world dressing
    if (g.phase === 'playing') {
      fx.ambient(g.course.centerAt(g.depth + 180), g.depth, g.course.halfAt(g.depth + 180), sf);
      if (g.input.accel) fx.exhaust(g.x, g.depth, 1, sf, powered);
    }
    fx.update(dt);

    // ---- paint
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    this.drawSurround();

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.stageX, 0, this.stageW, this.stageH);
    ctx.clip();

    var sh = fx.shake;
    if (sh > 0.05) {
      ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    }

    this.drawRockField();
    this.drawCorridor(powered);
    fx.draw(ctx, cam, cam.u, true);
    this.drawEntities(powered);
    this.padOpen = g.phase === 'ready' ? 0 : Math.min(1, this.padOpen + dt * 3.4);
    if (this.padOpen < 1) this.drawPad();
    this.drawMachine(sf, powered);
    fx.draw(ctx, cam, cam.u, false);
    this.drawSpeedLines(sf);

    ctx.restore(); // shake + stage clip

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.stageX, 0, this.stageW, this.stageH);
    ctx.clip();
    this.drawGrade(sf, powered);
    this.drawHud(sf, powered, io, dt);
    if (g.phase === 'ready') this.drawReady(io);
    if (g.phase === 'gameover') this.drawOver(dt, io);
    this.drawStick(io);
    ctx.restore();

    ctx.restore();
  };

  // ------------------------------------------------------------- surround --
  // On a wide frame the play column is flanked by solid rock, so the game
  // never stretches out of its intended portrait shape.
  Renderer.prototype.drawSurround = function () {
    var ctx = this.ctx;
    if (this.stageX < 1) return;
    var sideW = this.stageX;
    ctx.fillStyle = P.void0;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = this.pattern;
    ctx.translate(0, -((this.game.depth * this.baseU * 0.22) % 220));
    ctx.fillRect(0, 0, this.cssW, this.cssH + 220);
    ctx.restore();

    var g = ctx.createLinearGradient(0, 0, this.cssW, 0);
    g.addColorStop(0, 'rgba(4,3,10,0.94)');
    g.addColorStop(0.5, 'rgba(4,3,10,0.4)');
    g.addColorStop(1, 'rgba(4,3,10,0.94)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // the flanks are dressed, not left over: a standing wordmark and a lip of
    // lit rock along each side of the shaft
    if (sideW > 70) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 ' + Math.min(sideW * 0.42, 64) + 'px ' + Art.FONT;
      ctx.globalAlpha = 0.16;
      for (var s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(s < 0 ? sideW / 2 : this.cssW - sideW / 2, this.cssH / 2);
        ctx.rotate(s * Math.PI / 2);
        ctx.fillStyle = P.rim;
        ctx.fillText('D E L V E', 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    var edge = ctx.createLinearGradient(this.stageX - 26, 0, this.stageX, 0);
    edge.addColorStop(0, 'rgba(143,108,224,0)');
    edge.addColorStop(1, 'rgba(143,108,224,0.22)');
    ctx.fillStyle = edge;
    ctx.fillRect(this.stageX - 26, 0, 26, this.cssH);
    var edge2 = ctx.createLinearGradient(this.stageX + this.stageW + 26, 0, this.stageX + this.stageW, 0);
    edge2.addColorStop(0, 'rgba(143,108,224,0)');
    edge2.addColorStop(1, 'rgba(143,108,224,0.22)');
    ctx.fillStyle = edge2;
    ctx.fillRect(this.stageX + this.stageW, 0, 26, this.cssH);
  };

  // ------------------------------------------------------------ rock field --
  Renderer.prototype.drawRockField = function () {
    var ctx = this.ctx, cam = this.cam;
    var x0 = this.stageX, w = this.stageW, h = this.stageH;

    var vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, P.rockDeep);
    vg.addColorStop(1, P.void1);
    ctx.fillStyle = vg;
    ctx.fillRect(x0, 0, w, h);

    // strata: the banded rock the corridor is cut through
    var band = 78;
    var dTop = cam.d0 + (0 - cam.py) / cam.u;
    var dBot = cam.d0 + (h - cam.py) / cam.u;
    var b0 = Math.floor(dTop / band), b1 = Math.ceil(dBot / band);
    for (var b = b0; b <= b1; b++) {
      var y = cam.sy(b * band);
      var hh = band * cam.u;
      ctx.fillStyle = Art.strataColor(b);
      ctx.fillRect(x0, y, w, hh + 1);
      ctx.fillStyle = 'rgba(8,5,18,0.4)';
      ctx.fillRect(x0, y, w, Math.max(1, cam.u * 1.6));
      // mineral vein
      if (Art.hash(b * 2.3) > 0.74) {
        ctx.strokeStyle = Art.hash(b) > 0.5 ? 'rgba(111,242,200,0.10)' : 'rgba(255,179,71,0.09)';
        ctx.lineWidth = Math.max(1, cam.u * (1 + Art.hash(b * 5) * 2));
        ctx.beginPath();
        var vy = y + hh * (0.2 + Art.hash(b * 7) * 0.6);
        ctx.moveTo(x0, vy);
        ctx.bezierCurveTo(x0 + w * 0.3, vy - hh * 0.3, x0 + w * 0.7, vy + hh * 0.35, x0 + w, vy - hh * 0.1);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this.pattern;
    var off = (cam.d0 * cam.u) % 220;
    ctx.translate(x0, -off);
    ctx.fillRect(0, 0, w, h + 240);
    ctx.restore();
  };

  // -------------------------------------------------------------- corridor --
  Renderer.prototype.corridorPoints = function () {
    var cam = this.cam, g = this.game;
    var dTop = cam.d0 + (-40 - cam.py) / cam.u;
    var dBot = cam.d0 + (this.stageH + 40 - cam.py) / cam.u;
    var stepPx = 7;
    var stepW = Math.max(2.5, stepPx / cam.u);
    var pts = [];
    for (var d = dTop; d <= dBot; d += stepW) {
      var a = g.course.at(d);
      pts.push({ d: d, y: cam.sy(d), l: cam.sx(a.x - a.half), r: cam.sx(a.x + a.half), c: cam.sx(a.x), hw: a.half * cam.u });
    }
    var last = g.course.at(dBot);
    pts.push({ d: dBot, y: cam.sy(dBot), l: cam.sx(last.x - last.half), r: cam.sx(last.x + last.half), c: cam.sx(last.x), hw: last.half * cam.u });
    return pts;
  };

  Renderer.prototype.corridorPath = function (pts) {
    var ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].l, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].l, pts[i].y);
    for (var j = pts.length - 1; j >= 0; j--) ctx.lineTo(pts[j].r, pts[j].y);
    ctx.closePath();
  };

  Renderer.prototype.drawCorridor = function (powered) {
    var ctx = this.ctx, cam = this.cam, g = this.game;
    var pts = this.corridorPoints();
    this.pts = pts;
    var u = cam.u;

    ctx.save();
    this.corridorPath(pts);
    ctx.clip();

    // the shaft itself, dark and deep
    var tg = ctx.createLinearGradient(0, 0, 0, this.stageH);
    tg.addColorStop(0, '#070512');
    tg.addColorStop(0.5, P.tunnel0);
    tg.addColorStop(1, '#0d0920');
    ctx.fillStyle = tg;
    ctx.fillRect(this.stageX, 0, this.stageW, this.stageH);

    // a far wall receding behind the near one: parallax at 0.45 gives the
    // shaft real depth instead of a flat cut-out
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.pattern;
    ctx.translate(this.stageX, -((cam.d0 * u * 0.45) % 220));
    ctx.fillRect(0, 0, this.stageW, this.stageH + 240);
    ctx.restore();

    // dig rings scrolling up the shaft — the readout of how fast you are going
    var ring = 24;
    var r0 = Math.floor((cam.d0 - 60) / ring), r1 = Math.ceil((cam.d0 + 320) / ring);
    ctx.lineWidth = Math.max(1, u * 1.1);
    for (var k = r0; k <= r1; k++) {
      var d = k * ring;
      var a = g.course.at(d);
      var y = cam.sy(d);
      if (y < -20 || y > this.stageH + 20) continue;
      var fade = clamp(1 - Math.abs(y - cam.py) / (this.stageH * 0.85), 0.05, 1);
      ctx.strokeStyle = 'rgba(120,96,190,' + (0.1 + 0.16 * fade) + ')';
      ctx.beginPath();
      ctx.moveTo(cam.sx(a.x - a.half), y);
      ctx.quadraticCurveTo(cam.sx(a.x), y + 7 * u * 0.5, cam.sx(a.x + a.half), y);
      ctx.stroke();
    }

    // the machine's own light pooling on the shaft floor
    var mx = cam.sx(g.x), my = cam.sy(g.depth);
    Art.blob(ctx, mx, my + 34 * u, 105 * u, powered ? P.gold : '#ffb861', 0.14 + 0.1 * cam.streak);
    ctx.restore();

    // ---- wall bodies: rim, teeth, highlight
    ctx.save();
    this.corridorPath(pts);
    ctx.strokeStyle = '#0a0716';
    ctx.lineWidth = Math.max(2, u * 2.4);
    ctx.stroke();

    // Crystalline shoulders along the walls. They are drawn strictly *outside*
    // the corridor so the boundary the player reads is exactly the boundary the
    // rules collide against, and so wall texture is never mistaken for a rock.
    var teeth = 30;
    var t0 = Math.floor((cam.d0 - 80) / teeth), t1 = Math.ceil((cam.d0 + 340) / teeth);
    for (var q = t0; q <= t1; q++) {
      var dq = q * teeth + Art.hash(q * 3.3) * 18;
      var aq = g.course.at(dq);
      var yq = cam.sy(dq);
      if (yq < -30 || yq > this.stageH + 30) continue;
      for (var s = -1; s <= 1; s += 2) {
        if (Art.hash(q * 7.7 + s) < 0.42) continue;
        var wx = cam.sx(aq.x + s * aq.half);
        var size = (3 + Art.hash(q * 11 + s * 2) * 6) * u;
        ctx.beginPath();
        ctx.moveTo(wx, yq - size);
        ctx.lineTo(wx + s * size * 1.1, yq + Art.hash(q + s) * size * 0.5);
        ctx.lineTo(wx, yq + size * 1.05);
        ctx.closePath();
        ctx.fillStyle = 'rgba(70,52,124,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(140,110,215,0.4)';
        ctx.lineWidth = Math.max(0.6, u * 0.35);
        ctx.stroke();
      }
    }

    // inner rim light: warm where the machine's lamp reaches, cold beyond it
    var glowGrad = ctx.createLinearGradient(0, cam.py - this.stageH * 0.5, 0, cam.py + this.stageH * 0.45);
    var warm = powered ? '255,209,102' : '255,168,90';
    glowGrad.addColorStop(0, 'rgba(140,110,220,0.22)');
    glowGrad.addColorStop(0.42, 'rgba(' + warm + ',0.5)');
    glowGrad.addColorStop(0.62, 'rgba(' + warm + ',0.34)');
    glowGrad.addColorStop(1, 'rgba(120,96,190,0.14)');
    this.corridorPath(pts);
    ctx.strokeStyle = glowGrad;
    ctx.lineWidth = Math.max(1.2, u * 0.85);
    ctx.stroke();
    ctx.restore();
  };

  // -------------------------------------------------------------- entities --
  Renderer.prototype.drawEntities = function (powered) {
    var ctx = this.ctx, cam = this.cam, g = this.game, u = cam.u, t = this.t;
    var dTop = cam.d0 - 60, dBot = cam.d0 + (this.stageH + 60 - cam.py) / u;
    var i, o;

    // formation guides: a faint thread through a shape so it reads as one
    // sweepable object rather than loose dots
    var groups = {};
    for (i = g.itemStart; i < g.items.length; i++) {
      o = g.items[i];
      if (o.depth > dBot) break;
      if (o.depth < dTop || o.type !== 'fragment') continue;
      (groups[o.formationId] || (groups[o.formationId] = [])).push(o);
    }
    ctx.save();
    ctx.setLineDash([3 * u, 3.5 * u]);
    ctx.lineWidth = Math.max(0.8, u * 0.55);
    for (var key in groups) {
      var list = groups[key];
      if (list.length < 2) continue;
      ctx.beginPath();
      var started = false;
      for (i = 0; i < list.length; i++) {
        if (!list[i].active) { started = false; continue; }
        var px = cam.sx(list[i].x), py = cam.sy(list[i].depth);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(111,242,200,0.24)';
      ctx.stroke();
    }
    ctx.restore();

    for (i = g.rockStart; i < g.rocks.length; i++) {
      o = g.rocks[i];
      if (o.depth > dBot) break;
      if (!o.active || o.depth < dTop) continue;
      Art.drawRock(ctx, cam.sx(o.x), cam.sy(o.depth), o.visualRadius * u, o.seed * 100,
        { target: powered, t: t });
    }

    for (i = g.itemStart; i < g.items.length; i++) {
      o = g.items[i];
      if (o.depth > dBot) break;
      if (!o.active || o.depth < dTop) continue;
      if (o.type === 'fragment') Art.drawFragment(ctx, cam.sx(o.x), cam.sy(o.depth), o.visualRadius * u * 0.8, t, o.seed * 20);
      else {
        // a rare thing announces itself
        var py2 = cam.sy(o.depth);
        var lg = ctx.createLinearGradient(0, py2 - 90 * u, 0, py2);
        lg.addColorStop(0, 'rgba(255,209,102,0)');
        lg.addColorStop(1, 'rgba(255,209,102,0.16)');
        ctx.fillStyle = lg;
        ctx.fillRect(cam.sx(o.x) - 14 * u, py2 - 90 * u, 28 * u, 90 * u);
        Art.drawPower(ctx, cam.sx(o.x), py2, o.visualRadius * u * 0.85, t);
      }
    }
  };

  // The launch cradle the machine waits in. Its clamps let go the moment the
  // player first calls for throttle, so the start of a run has a gesture.
  Renderer.prototype.drawPad = function () {
    var ctx = this.ctx, cam = this.cam, u = cam.u;
    var open = Art.clamp(this.padOpen, 0, 1);
    var ease = open * open * (3 - 2 * open);
    var x = cam.sx(0), y = cam.sy(0);
    if (y < -120 || y > this.stageH + 120) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1 - ease * 0.85;

    // gantry beam above the pad
    ctx.strokeStyle = '#3a2c68';
    ctx.lineWidth = 3.4 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-24 * u, -30 * u);
    ctx.lineTo(24 * u, -30 * u);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(143,108,224,0.6)';
    ctx.lineWidth = 1.1 * u;
    ctx.beginPath();
    ctx.moveTo(-24 * u, -31.4 * u);
    ctx.lineTo(24 * u, -31.4 * u);
    ctx.stroke();

    // two clamp arms gripping the pod's flanks
    for (var s = -1; s <= 1; s += 2) {
      var slide = ease * 14 * u;
      ctx.save();
      ctx.translate(s * (13 * u + slide), 0);
      ctx.beginPath();
      ctx.moveTo(s * 9 * u, -12 * u);
      ctx.lineTo(s * 2 * u, -6 * u);
      ctx.lineTo(s * 2 * u, 5 * u);
      ctx.lineTo(s * 9 * u, 11 * u);
      ctx.closePath();
      var cg = ctx.createLinearGradient(0, -12 * u, 0, 11 * u);
      cg.addColorStop(0, '#6b57a8');
      cg.addColorStop(1, '#2c2050');
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = '#100a22';
      ctx.lineWidth = 1.2 * u * 0.8;
      ctx.stroke();
      Art.blob(ctx, s * 4 * u, 0, 3.6 * u, open > 0.1 ? P.amber : P.mint, 0.8);
      ctx.restore();
      // hanger cable
      ctx.strokeStyle = 'rgba(120,96,190,0.5)';
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      ctx.moveTo(s * 13 * u, -30 * u);
      ctx.lineTo(s * (13 * u + slide), -12 * u);
      ctx.stroke();
    }
    ctx.restore();
  };

  // --------------------------------------------------------------- machine --
  Renderer.prototype.drawMachine = function (sf, powered) {
    var ctx = this.ctx, cam = this.cam, g = this.game;
    var x = cam.sx(g.x), y = cam.sy(g.depth);
    var punch = this.hitPunch;
    var dim = g.phase === 'gameover';

    // afterimages while flying at the edge
    if (sf > 0.62 && !dim) {
      var n = 3;
      for (var i = 1; i <= n; i++) {
        ctx.save();
        ctx.globalAlpha = 0.1 * (sf - 0.62) / 0.38 * (1 - i / (n + 1));
        ctx.translate(x - g.vx * 0.012 * i * cam.u, y - g.speed * 0.016 * i * cam.u);
        Art.drawMachine(ctx, cam.u, this.machineParams(sf, powered, dim, 0));
        ctx.restore();
      }
    }

    ctx.save();
    ctx.translate(x, y);
    Art.drawMachine(ctx, cam.u, this.machineParams(sf, powered, dim, punch));
    ctx.restore();
  };

  Renderer.prototype.machineParams = function (sf, powered, dim, punch) {
    var g = this.game;
    var droop = g.phase === 'gameover' ? clamp((this.t - this.overAt) * 0.8, 0, 1) : 0;
    return {
      expr: this.expr,
      t: this.t,
      speedFrac: sf,
      throttle: g.input.accel && g.phase === 'playing' ? 1 : 0,
      steer: g.input.steer,
      lean: this.lean * 0.55 + droop * 0.18,
      stretch: (1 + 0.17 * sf) * (1 - punch * 0.3) * (1 - droop * 0.08),
      squash: (1 - 0.06 * sf) * (1 + punch * 0.26),
      drill: this.drill,
      blink: this.blink,
      bob: this.bob,
      powered: powered,
      dim: dim,
      grazeSide: this.grazeSide
    };
  };

  // ----------------------------------------------------------- speed lines --
  Renderer.prototype.drawSpeedLines = function (sf) {
    if (sf < 0.3) return;
    var ctx = this.ctx;
    var k = (sf - 0.3) / 0.7;
    var n = Math.round(6 + 26 * k);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,225,190,' + (0.05 + 0.16 * k) + ')';
    ctx.lineWidth = 1.1;
    var scroll = this.game.depth * this.cam.u;
    for (var i = 0; i < n; i++) {
      var hx = Art.hash(i * 3.1);
      var x = this.stageX + hx * this.stageW;
      var len = (26 + 130 * k) * (0.5 + Art.hash(i * 7.7));
      var y = ((scroll * (0.7 + hx * 0.6) + i * 137) % (this.stageH + len)) - len;
      var edge = Math.abs(x - (this.stageX + this.stageW / 2)) / (this.stageW / 2);
      ctx.globalAlpha = 0.35 + 0.65 * edge; // keep the centre line clear
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.restore();
  };

  // -------------------------------------------------- colour grade / flash --
  Renderer.prototype.drawGrade = function (sf, powered) {
    var ctx = this.ctx, fx = this.fx;
    var g = this.game;
    var x0 = this.stageX, w = this.stageW, h = this.stageH;

    // vignette, tighter and warmer the faster you go
    var vr = Math.max(w, h) * (0.78 - 0.16 * sf);
    var vg = ctx.createRadialGradient(x0 + w / 2, h * 0.46, vr * 0.3, x0 + w / 2, h * 0.46, vr);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, sf > 0.6 ? 'rgba(40,8,14,0.72)' : 'rgba(3,2,10,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(x0, 0, w, h);

    if (powered) {
      ctx.fillStyle = 'rgba(255,190,90,' + (0.05 + 0.04 * Math.sin(this.t * 9)) + ')';
      ctx.fillRect(x0, 0, w, h);
    }

    // the timer's own warning bleeds into the frame
    if (g.phase === 'playing' && g.remainingMs < 6000) {
      var urg = 1 - g.remainingMs / 6000;
      var pulse = 0.5 + 0.5 * Math.sin(this.t * (6 + 10 * urg));
      var eg = ctx.createRadialGradient(x0 + w / 2, h * 0.5, h * 0.34, x0 + w / 2, h * 0.5, h * 0.86);
      eg.addColorStop(0, 'rgba(255,60,60,0)');
      eg.addColorStop(1, 'rgba(255,50,50,' + (0.08 + 0.24 * urg * pulse) + ')');
      ctx.fillStyle = eg;
      ctx.fillRect(x0, 0, w, h);
    }

    if (fx.chroma > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = fx.chroma * 0.16;
      ctx.fillStyle = '#3a70ff';
      ctx.fillRect(x0 - 3 * fx.chroma, 0, w, h);
      ctx.fillStyle = '#ff3a70';
      ctx.fillRect(x0 + 3 * fx.chroma, 0, w, h);
      ctx.restore();
    }
    if (fx.flash > 0.02) {
      ctx.globalAlpha = Math.min(0.62, fx.flash);
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(x0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  };

  // -------------------------------------------------------------------- HUD --
  Renderer.prototype.drawHud = function (sf, powered, io, dt) {
    var ctx = this.ctx, g = this.game;
    var U = this.ui;
    var x0 = this.stageX;
    var pad = 13 * U;
    var top = pad + (io.safeTop || 0);
    var w = this.stageW - pad * 2;

    // ---- time meter
    var barH = 13 * U;
    var frac = clamp(g.remainingMs / C.MAX_TIME_MS, 0, 1);
    var low = g.remainingMs < 8000, crit = g.remainingMs < 4000;
    var pulse = crit ? 0.7 + 0.3 * Math.sin(this.t * 16) : low ? 0.85 + 0.15 * Math.sin(this.t * 8) : 1;

    ctx.save();
    Art.panel(ctx, x0 + pad, top, w, barH, barH * 0.42);
    ctx.fillStyle = 'rgba(10,7,22,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,220,0.35)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.save();
    Art.panel(ctx, x0 + pad, top, w, barH, barH * 0.42);
    ctx.clip();
    var fillW = w * frac;
    var bg = ctx.createLinearGradient(x0 + pad, 0, x0 + pad + w, 0);
    if (crit) { bg.addColorStop(0, '#ff4d4d'); bg.addColorStop(1, '#ff9a5a'); }
    else if (low) { bg.addColorStop(0, '#ffab3d'); bg.addColorStop(1, '#ffe08a'); }
    else { bg.addColorStop(0, P.mintDeep); bg.addColorStop(0.6, P.mint); bg.addColorStop(1, '#d8fff2'); }
    ctx.globalAlpha = pulse;
    ctx.fillStyle = bg;
    ctx.fillRect(x0 + pad, top, fillW, barH);
    ctx.globalAlpha = 1;

    // fresh time flashes in
    if (this.fx.timerPulse > 0.02) {
      ctx.fillStyle = 'rgba(255,255,255,' + this.fx.timerPulse * 0.5 + ')';
      ctx.fillRect(x0 + pad, top, fillW, barH);
    }
    // five-second ticks
    ctx.strokeStyle = 'rgba(8,5,18,0.4)';
    ctx.lineWidth = 1.4;
    for (var s = 5000; s < C.MAX_TIME_MS; s += 5000) {
      var tx = x0 + pad + w * (s / C.MAX_TIME_MS);
      ctx.beginPath();
      ctx.moveTo(tx, top); ctx.lineTo(tx, top + barH);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // the powered state gets its own slim bar rather than overprinting the clock
    if (powered) {
      var phh = 4 * U;
      var pw = w * clamp((g.invincibleUntilMs - g.timeMs) / C.POWER_MS, 0, 1);
      ctx.fillStyle = 'rgba(10,7,22,0.7)';
      Art.roundRect(ctx, x0 + pad, top + barH + 2.5 * U, w, phh, phh / 2);
      ctx.fill();
      var pg = ctx.createLinearGradient(x0 + pad, 0, x0 + pad + w, 0);
      pg.addColorStop(0, P.rose);
      pg.addColorStop(1, P.gold);
      ctx.fillStyle = pg;
      Art.roundRect(ctx, x0 + pad, top + barH + 2.5 * U, Math.max(phh, pw), phh, phh / 2);
      ctx.fill();
    }

    var timeTxt = (g.remainingMs / 1000).toFixed(1);
    ctx.font = '900 ' + (10.5 * U) + 'px ' + Art.FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // outlined, so the clock stays legible over the fill and over the empty rail alike
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(8,5,18,0.9)';
    ctx.strokeText(timeTxt, x0 + pad + w - 6 * U, top + barH / 2);
    ctx.fillStyle = crit ? '#ffd9d2' : '#f2ecff';
    ctx.fillText(timeTxt, x0 + pad + w - 6 * U, top + barH / 2);

    // ---- score and depth
    var ry = top + barH + (powered ? 13 : 8) * U;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '700 ' + (8.5 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.textDim;
    ctx.fillText('SCORE', x0 + pad + 1, ry);
    ctx.font = '900 ' + (21 * U) + 'px ' + Art.FONT;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,5,18,0.85)';
    ctx.lineWidth = 3.5 * U * 0.6;
    var sc = String(Math.floor(g.score));
    ctx.strokeText(sc, x0 + pad, ry + 10 * U);
    ctx.fillStyle = P.text;
    ctx.fillText(sc, x0 + pad, ry + 10 * U);

    ctx.textAlign = 'right';
    ctx.font = '700 ' + (8.5 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.textDim;
    ctx.fillText('DEPTH', x0 + pad + w, ry);
    ctx.font = '900 ' + (14 * U) + 'px ' + Art.FONT;
    ctx.strokeText(Math.round(g.depth / 10) + 'm', x0 + pad + w, ry + 12 * U);
    ctx.fillStyle = P.amber;
    ctx.fillText(Math.round(g.depth / 10) + 'm', x0 + pad + w, ry + 12 * U);

    // ---- speed gauge on the right edge, only while there is a speed to read
    this.gaugeA = lerp(this.gaugeA, g.phase === 'playing' ? 1 : 0, 1 - Math.pow(0.004, dt));
    if (this.gaugeA > 0.02) {
      var gh = this.stageH * 0.2, gw = 5 * U;
      var gx = x0 + this.stageW - pad - gw, gy = this.stageH * 0.40;
      ctx.save();
      ctx.globalAlpha = this.gaugeA;
      ctx.fillStyle = 'rgba(10,7,22,0.6)';
      Art.roundRect(ctx, gx, gy, gw, gh, gw / 2);
      ctx.fill();
      // danger band
      ctx.fillStyle = 'rgba(255,90,82,0.28)';
      Art.roundRect(ctx, gx, gy, gw, gh * (1 - C.DANGER_FRAC), gw / 2);
      ctx.fill();
      var sh2 = gh * Math.max(sf, 0.035);
      var sg = ctx.createLinearGradient(0, gy + gh, 0, gy);
      sg.addColorStop(0, P.mint);
      sg.addColorStop(0.68, P.amber);
      sg.addColorStop(1, P.danger);
      ctx.fillStyle = sg;
      Art.roundRect(ctx, gx, gy + gh - sh2, gw, sh2, gw / 2);
      ctx.fill();
      // the line where speed turns dangerous
      ctx.strokeStyle = 'rgba(255,140,120,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx - 3 * U, gy + gh * (1 - C.DANGER_FRAC));
      ctx.lineTo(gx + gw, gy + gh * (1 - C.DANGER_FRAC));
      ctx.stroke();
      if (sf > C.DANGER_FRAC) {
        Art.blob(ctx, gx + gw / 2, gy + gh - sh2, 10 * U, P.danger, 0.5 + 0.3 * Math.sin(this.t * 14));
      }
      ctx.restore();
    }

    // ---- graze chain, near the machine, out of the way of the line ahead
    if (g.combo >= 2 && g.phase === 'playing') {
      var cx = this.cam.sx(g.x), cy = this.cam.sy(g.depth) - 48 * this.cam.u;
      var pop = 1 + this.fx.comboPop * 0.45;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 ' + (13 * U) + 'px ' + Art.FONT;
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(10,6,20,0.9)';
      var col = g.combo >= 5 ? P.rose : g.combo >= 3 ? P.gold : '#cfe6ff';
      ctx.strokeText(g.combo + '\u00d7 GRAZE', 0, 0);
      ctx.fillStyle = col;
      ctx.fillText(g.combo + '\u00d7 GRAZE', 0, 0);
      ctx.restore();
    }

    // ---- POWER banner
    if (powered) {
      var left = (g.invincibleUntilMs - g.timeMs) / 1000;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 ' + (12 * U) + 'px ' + Art.FONT;
      var by = top + barH + 30 * U;
      ctx.save();
      ctx.globalAlpha = left < 1.6 ? 0.55 + 0.45 * Math.sin(this.t * 18) : 1;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,6,20,0.9)';
      ctx.strokeText('\u25c6 BREAK ROCKS \u25c6', x0 + this.stageW / 2, by);
      var pgr = ctx.createLinearGradient(x0 + this.stageW * 0.3, 0, x0 + this.stageW * 0.7, 0);
      pgr.addColorStop(0, P.rose);
      pgr.addColorStop(1, P.gold);
      ctx.fillStyle = pgr;
      ctx.fillText('\u25c6 BREAK ROCKS \u25c6', x0 + this.stageW / 2, by);
      ctx.restore();
    }

    // ---- steering hint, revealed only when it first becomes useful
    if (g.phase === 'playing' && !this.hasSteered && this.runsPlayed === 0 && g.tick > 20 && g.tick < 60 * 9) {
      var ha = clamp((g.tick - 20) / 40, 0, 1) * clamp((60 * 9 - g.tick) / 60, 0, 1);
      var hx = this.cam.sx(g.x), hy = this.cam.sy(g.depth);
      ctx.save();
      ctx.globalAlpha = ha * (0.4 + 0.3 * Math.sin(this.t * 4));
      ctx.strokeStyle = P.amber;
      ctx.lineWidth = 2.6 * U * 0.9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (var d2 = -1; d2 <= 1; d2 += 2) {
        var ax = hx + d2 * 34 * U * 0.8;
        for (var k2 = 0; k2 < 2; k2++) {
          var kx = ax + d2 * k2 * 7 * U;
          ctx.beginPath();
          ctx.moveTo(kx, hy - 6.5 * U);
          ctx.lineTo(kx + d2 * 5 * U, hy);
          ctx.lineTo(kx, hy + 6.5 * U);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ---- mute toggle (optional control, never required)
    var mr = 11 * U;
    var mx2 = x0 + this.stageW - pad - mr, my2 = this.stageH - pad - mr - (io.safeBottom || 0);
    this.muteHit = { x: mx2, y: my2, r: mr * 1.9 };
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(mx2, my2, mr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,7,22,0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,120,220,0.4)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = P.text;
    ctx.beginPath();
    ctx.moveTo(mx2 - 4.5 * U, my2 - 2 * U);
    ctx.lineTo(mx2 - 1.5 * U, my2 - 2 * U);
    ctx.lineTo(mx2 + 1.8 * U, my2 - 5.2 * U);
    ctx.lineTo(mx2 + 1.8 * U, my2 + 5.2 * U);
    ctx.lineTo(mx2 - 1.5 * U, my2 + 2 * U);
    ctx.lineTo(mx2 - 4.5 * U, my2 + 2 * U);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = P.text;
    ctx.lineWidth = 1.4;
    if (io.muted) {
      ctx.beginPath();
      ctx.moveTo(mx2 + 3.4 * U, my2 - 3.4 * U);
      ctx.lineTo(mx2 + 7.4 * U, my2 + 3.4 * U);
      ctx.moveTo(mx2 + 7.4 * U, my2 - 3.4 * U);
      ctx.lineTo(mx2 + 3.4 * U, my2 + 3.4 * U);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(mx2 + 2.4 * U, my2, 4 * U, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(mx2 + 2.4 * U, my2, 6.8 * U, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ------------------------------------------------------------ ready screen
  Renderer.prototype.drawReady = function (io) {
    var ctx = this.ctx;
    var U = this.ui;
    var x0 = this.stageX, w = this.stageW, h = this.stageH;
    var cx = x0 + w / 2;
    var t = this.t;

    var vg = ctx.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(6,4,14,0.86)');
    vg.addColorStop(0.42, 'rgba(6,4,14,0.35)');
    vg.addColorStop(1, 'rgba(6,4,14,0.0)');
    ctx.fillStyle = vg;
    ctx.fillRect(x0, 0, w, h);

    Art.drawTitle(ctx, cx, h * 0.15, Math.min(w * 0.24, 74 * U), 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (9.5 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.textDim;
    ctx.fillText('D O W N   I S   D E E P E R', cx, h * 0.15 + Math.min(w * 0.135, 44 * U));

    // the one instruction the player needs to begin
    var chipW = Math.min(w * 0.66, 236 * U), chipH = 34 * U;
    var chipY = h * 0.735;
    var breathe = 0.5 + 0.5 * Math.sin(t * 2.6);
    ctx.save();
    ctx.globalAlpha = 0.78 + 0.22 * breathe;
    Art.panel(ctx, cx - chipW / 2, chipY, chipW, chipH, 10 * U);
    ctx.fillStyle = 'rgba(12,8,26,0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,179,71,' + (0.35 + 0.4 * breathe) + ')';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.font = '900 ' + (11.5 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.amber;
    ctx.fillText(io.touch ? 'PRESS AND DRAG DOWN TO DIG' : 'HOLD  \u25bc  TO DIG', cx, chipY + chipH / 2 + 0.5);
    ctx.restore();

    // a small down-arrow trail, pulling the eye downward
    ctx.save();
    for (var i = 0; i < 3; i++) {
      var ph = (t * 1.5 + i * 0.33) % 1;
      ctx.globalAlpha = 0.42 * Math.sin(ph * Math.PI);
      var ay = chipY + chipH + 14 * U + ph * 26 * U;
      ctx.beginPath();
      ctx.moveTo(cx - 8 * U, ay);
      ctx.lineTo(cx, ay + 8 * U);
      ctx.lineTo(cx + 8 * U, ay);
      ctx.strokeStyle = P.amber;
      ctx.lineWidth = 2.6 * U * 0.7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  };

  // --------------------------------------------------------- end-of-run ----
  Renderer.prototype.drawOver = function (dt, io) {
    var ctx = this.ctx, g = this.game;
    var U = this.ui;
    var x0 = this.stageX, w = this.stageW, h = this.stageH;
    var cx = x0 + w / 2;
    var age = this.t - this.overAt;
    var rise = 1 - Math.pow(1 - clamp(age / 0.42, 0, 1), 3);

    ctx.fillStyle = 'rgba(5,3,12,' + 0.72 * clamp(age / 0.3, 0, 1) + ')';
    ctx.fillRect(x0, 0, w, h);

    // The card is laid out from its own content, then shrunk until it leaves
    // the spent machine in view: a short desktop frame gets a smaller card,
    // never a cropped one.
    var pad, pw, badgeR, H_TITLE, H_BADGE, H_SCORE, H_BEST, H_SIG, H_STATS, H_PROMPT, ph;
    for (var pass = 0; pass < 2; pass++) {
      pad = 15 * U;
      pw = Math.min(w - pad * 2, 360 * U);
      badgeR = Math.min(pw * 0.15, 44 * U);
      H_TITLE = 26 * U; H_BADGE = badgeR * 2 + 22 * U; H_SCORE = 62 * U;
      H_BEST = 24 * U; H_SIG = 62 * U; H_STATS = 34 * U; H_PROMPT = 40 * U;
      ph = H_TITLE + H_BADGE + H_SCORE + H_BEST + H_SIG + H_STATS + H_PROMPT + 14 * U;
      var room = h * 0.62;
      if (pass === 0 && ph > room) U *= room / ph; else break;
    }
    ph = Math.min(ph, h - 2 * pad);
    var px = cx - pw / 2;
    // keep the spent machine in view above the panel wherever it can fit
    var py = Math.min(h - pad - ph, Math.max((h - ph) / 2, this.cam.py + 40 * U));
    py = Math.max(pad, py) + (1 - rise) * 60 * U;

    ctx.save();
    ctx.globalAlpha = rise;
    Art.panel(ctx, px, py, pw, ph, 22 * U);
    var pg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    pg.addColorStop(0, 'rgba(28,19,58,0.97)');
    pg.addColorStop(1, 'rgba(14,9,30,0.97)');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(143,108,224,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var y = py + H_TITLE * 0.62;
    ctx.font = '800 ' + (9.5 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.textDim;
    ctx.fillText('T H E   D I G   E N D S', cx, y);

    // rank stamp
    var stampT = clamp((age - 0.28) / 0.34, 0, 1);
    var pop = stampT < 1 ? 1.9 - 0.9 * (1 - Math.pow(1 - stampT, 3)) : 1 + 0.02 * Math.sin(this.t * 2.4);
    y = py + H_TITLE;
    if (stampT > 0) {
      Art.drawBadge(ctx, cx, y + badgeR + 6 * U, badgeR, g.rank || 'D', this.t, pop);
    }

    // score, counting up
    this.scoreShown = lerp(this.scoreShown, Math.floor(g.score), 1 - Math.pow(0.002, dt));
    if (Math.abs(this.scoreShown - Math.floor(g.score)) < 1.2) this.scoreShown = Math.floor(g.score);
    y = py + H_TITLE + H_BADGE;
    ctx.font = '800 ' + (9 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.textDim;
    ctx.fillText('SCORE', cx, y);
    ctx.font = '900 ' + (40 * U) + 'px ' + Art.FONT;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(8,5,18,0.8)';
    ctx.lineWidth = 5;
    var st = String(Math.round(this.scoreShown));
    ctx.strokeText(st, cx, y + 30 * U);
    var sg = ctx.createLinearGradient(0, y + 11 * U, 0, y + 47 * U);
    sg.addColorStop(0, '#fff4dc');
    sg.addColorStop(1, P.amber);
    ctx.fillStyle = sg;
    ctx.fillText(st, cx, y + 30 * U);

    y = py + H_TITLE + H_BADGE + H_SCORE;
    ctx.font = '800 ' + (10 * U) + 'px ' + Art.FONT;
    if (this.newBest) {
      ctx.fillStyle = P.mint;
      ctx.globalAlpha = rise * (0.6 + 0.4 * Math.sin(this.t * 7));
      ctx.fillText('\u2726 NEW SESSION BEST \u2726', cx, y);
      ctx.globalAlpha = rise;
    } else {
      ctx.fillStyle = P.textDim;
      ctx.fillText('SESSION BEST  ' + this.best, cx, y);
    }

    // the run's signature stat
    y = py + H_TITLE + H_BADGE + H_SCORE + H_BEST;
    var sigH = 46 * U, sigW = pw - 34 * U;
    Art.panel(ctx, cx - sigW / 2, y, sigW, sigH, 11 * U);
    ctx.fillStyle = 'rgba(111,242,200,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(111,242,200,0.3)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    var sig = this.signature || { label: '', value: '', sub: '' };
    ctx.font = '800 ' + (8 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = 'rgba(111,242,200,0.8)';
    ctx.fillText(sig.label, cx, y + 12 * U);
    ctx.font = '900 ' + (19 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.mint;
    ctx.fillText(sig.value, cx, y + 30 * U);

    // the rest of the run, in small
    y = py + H_TITLE + H_BADGE + H_SCORE + H_BEST + H_SIG;
    var cols = [
      ['DEPTH', Math.round(g.depth / 10) + 'm'],
      ['FRAGMENTS', String(g.fragmentsCollected)],
      ['GRAZES', String(g.maxCombo) + '\u00d7'],
      ['IMPACTS', String(g.hits + g.wallContacts)]
    ];
    // the signature already told that story; give the column to another one
    var dupe = { 'DEEPEST POINT': 'DEPTH', 'LONGEST GRAZE CHAIN': 'GRAZES' }[sig.label];
    for (var ci = 0; ci < cols.length; ci++) {
      if (cols[ci][0] === dupe) {
        cols[ci] = ['BEST BURN', (g.bestThrottle / 1000).toFixed(1) + 's'];
        break;
      }
    }
    var colW = (pw - 28 * U) / cols.length;
    for (var i = 0; i < cols.length; i++) {
      var ccx = px + 14 * U + colW * (i + 0.5);
      ctx.font = '700 ' + (7.5 * U) + 'px ' + Art.FONT;
      ctx.fillStyle = P.textDim;
      ctx.fillText(cols[i][0], ccx, y);
      ctx.font = '900 ' + (13 * U) + 'px ' + Art.FONT;
      ctx.fillStyle = P.text;
      ctx.fillText(cols[i][1], ccx, y + 15 * U);
    }

    // restart, one input away
    var prompt = io.touch ? 'TAP TO DIG AGAIN' : 'PRESS R \u00b7 OR CLICK TO DIG AGAIN';
    ctx.globalAlpha = rise * (0.62 + 0.38 * Math.sin(this.t * 3.4));
    ctx.font = '900 ' + (11 * U) + 'px ' + Art.FONT;
    ctx.fillStyle = P.amber;
    ctx.fillText(prompt, cx, py + ph - H_PROMPT * 0.5);
    ctx.restore();
  };

  // ------------------------------------------------------------ touch stick
  Renderer.prototype.drawStick = function (io) {
    if (!io.stick || !io.stick.active) return;
    var ctx = this.ctx;
    var s = io.stick;
    var U = this.ui;
    var R = 34 * U;
    ctx.save();
    ctx.globalAlpha = 0.5;
    // base
    ctx.beginPath();
    ctx.arc(s.ax, s.ay, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200,180,255,0.35)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // throttle arc: fills as the finger pushes down
    if (s.throttle > 0) {
      ctx.beginPath();
      ctx.arc(s.ax, s.ay, R, 0.35, 0.35 + 2.44 * s.throttle);
      ctx.strokeStyle = P.amber;
      ctx.lineWidth = 4.5 * U * 0.7;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    // steer marker
    var kx = s.ax + clamp(s.dx, -R, R), ky = s.ay + clamp(s.dy, -R, R);
    Art.blob(ctx, kx, ky, 20 * U, s.throttle > 0 ? P.amber : P.mint, 0.5);
    ctx.beginPath();
    ctx.arc(kx, ky, 9 * U, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.restore();
  };

  DELVE.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
