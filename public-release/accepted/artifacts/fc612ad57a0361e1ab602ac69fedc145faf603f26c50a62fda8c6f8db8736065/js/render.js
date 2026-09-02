/* Lumen Yard — canvas renderer. The yard is a place, not a grid. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;
  var TAU = Math.PI * 2;

  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var PAL = {
    copperDim: 'rgba(138,90,52,0.45)',
    copperLit: '255,178,90',
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tile = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.dpr = 1;
    this.time = 0;
    this.anim = null;
    this.fx = [];
    this.glints = [];
    this.surge = null;
    this.blockT = 0;
    this.winGlow = 0;
    this.cables = null;
    this.cableSig = '';
    this.robotFacing = 'down';
    this._interp = null;
    this._glintTimer = 0;
  }

  Renderer.prototype.resetFx = function () {
    this.anim = null;
    this.fx.length = 0;
    this.glints.length = 0;
    this.surge = null;
    this.blockT = 0;
  };

  Renderer.prototype.layout = function (availW, availH, game, pad) {
    pad = pad || 10;
    var W = Math.max(40, availW - pad * 2);
    var H = Math.max(40, availH - pad * 2);
    var tile = Math.max(18, Math.floor(Math.min(W / game.cols, H / game.rows)));
    this.tile = tile;
    var cssW = tile * game.cols;
    var cssH = tile * game.rows;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var sig = game.levelId + '|' + game.cols + 'x' + game.rows;
    if (sig !== this.cableSig) {
      this.buildCables(game);
      this.cableSig = sig;
    }
  };

  Renderer.prototype.buildCables = function (game) {
    var edges = new Map();
    var visited = new Set();
    var dist = new Map();
    var queue = [];
    var self = this;
    game.goals.forEach(function (k) { visited.add(k); dist.set(k, 0); queue.push(k); });

    function edgeKey(r1, c1, r2, c2) {
      return r1 <= r2 ? r1 + ',' + c1 + '-' + r2 + ',' + c2 : r2 + ',' + c2 + '-' + r1 + ',' + c1;
    }
    function addEdge(a, b, d) {
      var p1 = a.split(',');
      var p2 = b.split(',');
      var r1 = +p1[0], c1 = +p1[1], r2 = +p2[0], c2 = +p2[1];
      var key = edgeKey(r1, c1, r2, c2);
      if (!edges.has(key)) edges.set(key, { key: key, r1: r1, c1: c1, r2: r2, c2: c2, dist: d });
    }

    var D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var head = 0;
    while (head < queue.length) {
      var k = queue[head++];
      var p = k.split(',');
      var r = +p[0], c = +p[1];
      for (var i = 0; i < 4; i++) {
        var dr = D[i][0], dc = D[i][1];
        var nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= game.rows || nc >= game.cols) continue;
        var nk = nr + ',' + nc;
        if (game.walls.has(nk) || game.goals.has(nk)) continue;
        if (visited.has(nk)) continue;
        visited.add(nk);
        dist.set(nk, dist.get(k) + 1);
        addEdge(k, nk, dist.get(nk));
        queue.push(nk);
      }
    }
    // stray copper joins for texture
    for (var rr = 0; rr < game.rows; rr++) {
      for (var cc = 0; cc < game.cols; cc++) {
        var kk = rr + ',' + cc;
        if (game.walls.has(kk) || game.goals.has(kk)) continue;
        var pairD = [[0, 1], [1, 0]];
        for (var j = 0; j < 2; j++) {
          var ddr = pairD[j][0], ddc = pairD[j][1];
          var nrr = rr + ddr, ncc = cc + ddc;
          if (nrr >= game.rows || ncc >= game.cols) continue;
          var nkk = nrr + ',' + ncc;
          if (game.walls.has(nkk) || game.goals.has(nkk)) continue;
          if (!edges.has(edgeKey(rr, cc, nrr, ncc)) && hash(rr * 31 + cc * 47 + ddr * 7 + ddc * 13) < 0.42) {
            var d0 = dist.get(kk);
            var d1 = dist.get(nkk);
            if (d0 === undefined) d0 = 99;
            if (d1 === undefined) d1 = 99;
            addEdge(kk, nkk, Math.min(d0, d1) + 1);
          }
        }
      }
    }
    var maxDist = 0;
    edges.forEach(function (e) { if (e.dist > maxDist) maxDist = e.dist; });
    self.cables = { edges: edges, maxDist: maxDist };
  };

  // ---- animation API ----
  Renderer.prototype.animateTransition = function (from, to, opts) {
    this.anim = {
      from: from,
      to: to,
      dir: opts.dir || null,
      push: !!opts.push,
      seated: !!opts.seated,
      undo: !!opts.undo,
      t0: root.performance.now(),
      dur: opts.undo ? 210 : (opts.push ? 200 : 130),
    };
  };

  Renderer.prototype.blocked = function () {
    this.blockT = root.performance.now();
  };

  Renderer.prototype.seatFlash = function (row, col) {
    var t = this.tile;
    var self = this;
    for (var i = 0; i < 10; i++) {
      self.fx.push({
        x: (col + 0.5) * t,
        y: (row + 0.4) * t,
        vx: (Math.random() - 0.5) * 95,
        vy: -Math.random() * 130,
        life: 0,
        max: 0.4 + Math.random() * 0.35,
        size: 1.5 + Math.random() * 2,
      });
    }
  };

  Renderer.prototype.startSurge = function (reduced) {
    this.surge = { t: 0, dur: reduced ? 0.7 : 1.55 };
  };

  // ---- per frame ----
  Renderer.prototype.render = function (game, opts) {
    var ctx = this.ctx;
    var self = this;
    var t = this.tile;
    var reduced = !!(opts && opts.reducedMotion);
    var now = root.performance.now();
    this.time += 1 / 60;
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (this.surge) {
      this.surge.t += 1 / 60;
      if (clamp01(this.surge.t / this.surge.dur) >= 1) this.surge = null;
    }
    if (game.phase === 'complete') {
      this.winGlow = Math.min(1, this.winGlow + 1 / 30);
    } else {
      this.winGlow = Math.max(0, this.winGlow - 1 / 18);
    }

    // movement interpolation
    this._interp = null;
    if (this.anim) {
      var curAnim = this.anim;
      var ap = clamp01((now - curAnim.t0) / curAnim.dur);
      var e = easeOutCubic(ap);
      if (ap >= 1) this.anim = null;
      this._interp = this.computeInterp(curAnim, e, game);
    }

    var r, c, gk, k;

    // floor
    for (r = 0; r < game.rows; r++) {
      for (c = 0; c < game.cols; c++) {
        if (!game.walls.has(r + ',' + c)) this.floor(r, c, t);
      }
    }

    // walls
    for (r = 0; r < game.rows; r++) {
      for (c = 0; c < game.cols; c++) {
        if (game.walls.has(r + ',' + c)) this.wall(r, c, t, game, reduced, now);
      }
    }

    // cable traces
    this.cablesAll(game, t, reduced, now);

    // sockets
    game.goals.forEach(function (gkey) {
      var p = gkey.split(',');
      var powered = game.crates.has(gkey);
      self.socket(+p[0], +p[1], t, powered, reduced, now);
    });

    // crates
    var cratePos = new Map();
    if (this._interp) {
      for (var ck in this._interp.crates) cratePos.set(ck, this._interp.crates[ck]);
    }
    game.crates.forEach(function (ck) {
      var p = ck.split(',');
      var cx = (+p[1] + 0.5) * t;
      var cy = (+p[0] + 0.5) * t;
      var ip = cratePos.get(ck);
      if (ip) { cx = ip.x; cy = ip.y; }
      self.crate(cx, cy, t, game.goals.has(ck), game.phase === 'complete', reduced, now);
    });

    // robot
    var pr = game.player.row, pc = game.player.col;
    if (this._interp && this._interp.player) { pr = this._interp.player.r; pc = this._interp.player.c; }
    var block = this.blockT && (now - this.blockT < 230);
    this.robot((pc + 0.5) * t, (pr + 0.5) * t, t, reduced, now, block, this.anim, this.blockT);

    // particles
    this.particles(t);

    // completion bloom
    if (this.winGlow > 0.01) {
      ctx.fillStyle = 'rgba(255,190,110,' + (0.08 * this.winGlow).toFixed(3) + ')';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    if (this.winGlow > 0.55) {
      var bg = ctx.createRadialGradient(this.cssW / 2, this.cssH / 2, 0, this.cssW / 2, this.cssH / 2, this.cssW * 0.75);
      bg.addColorStop(0, 'rgba(255,205,130,' + ((0.13 * (this.winGlow - 0.55) / 0.45)).toFixed(3) + ')');
      bg.addColorStop(1, 'rgba(255,205,130,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
  };

  Renderer.prototype.computeInterp = function (anim, e, game) {
    var t = this.tile;
    var res = { player: null, crates: {} };
    var pf = anim.from.player, pt = anim.to.player;
    res.player = { r: lerp(pf.row, pt.row, e), c: lerp(pf.col, pt.col, e) };
    var added = null, removed = null;
    anim.to.crates.forEach(function (k) { if (!anim.from.crates.has(k)) added = k; });
    anim.from.crates.forEach(function (k) { if (!anim.to.crates.has(k)) removed = k; });
    if (added && removed) {
      var fr = removed.split(',').map(Number);
      var to = added.split(',').map(Number);
      res.crates[added] = {
        x: lerp((fr[1] + 0.5) * t, (to[1] + 0.5) * t, e),
        y: lerp((fr[0] + 0.5) * t, (to[0] + 0.5) * t, e),
      };
    }
    return res;
  };

  Renderer.prototype.floor = function (r, c, t) {
    var ctx = this.ctx;
    var x = c * t, y = r * t;
    var h = hash(r * 73 + c * 137 + 17);
    var g = ctx.createLinearGradient(x, y, x, y + t);
    g.addColorStop(0, '#1a202c');
    g.addColorStop(1, '#12161f');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = 'rgba(6,9,14,' + (0.16 + h * 0.22).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(x + h * t * 0.65, y + (1 - h) * t * 0.6, t * 0.22, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,11,16,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
    for (var i = 0; i < 3; i++) {
      var hh = hash(r * 997 + c * 613 + i * 131);
      ctx.fillStyle = 'rgba(0,0,0,' + (0.08 + hh * 0.14).toFixed(2) + ')';
      ctx.fillRect(x + hh * t, y + hash(r * 31 + c * 97 + i * 77) * t, 1.6, 1.6);
    }
  };

  Renderer.prototype.wall = function (r, c, t, game, reduced, now) {
    var ctx = this.ctx;
    var x = c * t, y = r * t;
    var h = hash(r * 91 + c * 61);
    var g = ctx.createLinearGradient(x, y, x + t, y);
    g.addColorStop(0, '#222b3b');
    g.addColorStop(0.5, '#181f2b');
    g.addColorStop(1, '#121823');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = '#2b3646';
    ctx.fillRect(x, y, t, t * 0.16);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x + 1, y + 1, t - 2, 1.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + t);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + t, y);
    ctx.lineTo(x + t, y + t);
    ctx.stroke();
    // hazard stripe near the base
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + t - t * 0.13, t, t * 0.13);
    ctx.clip();
    var st = t * 0.11;
    ctx.fillStyle = 'rgba(232,162,58,0.28)';
    for (var sx = x - t; sx < x + t; sx += st) {
      ctx.beginPath();
      ctx.moveTo(sx, y + t);
      ctx.lineTo(sx + t * 0.13, y + t - t * 0.13);
      ctx.lineTo(sx + t * 0.13 + st, y + t - t * 0.13);
      ctx.lineTo(sx + st, y + t);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // warning lamp on some wall posts
    if (h > 0.66) {
      var on = this.winGlow;
      var flick = on >= 0.5 ? 1 : 0.72 + 0.28 * Math.sin(now / 280 + r * 3 + c * 5);
      var lx = x + t * (c === 0 ? 0.22 : r === 0 ? 0.5 : 0.78);
      var ly = y + t * 0.46;
      ctx.fillStyle = 'rgba(255,205,120,' + (0.5 + 0.45 * on).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(lx, ly, Math.max(1.4, t * 0.045) * flick, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,205,120,' + (0.16 * (0.5 + on)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(lx, ly, t * 0.12 * flick, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype.cablesAll = function (game, t, reduced, now) {
    var ctx = this.ctx;
    var self = this;
    var edges = this.cables ? this.cables.edges : new Map();
    var maxDist = this.cables ? this.cables.maxDist : 0;
    var wave = -1;
    if (this.surge) {
      wave = clamp01(this.surge.t / this.surge.dur) * (maxDist + 2);
    } else if (game.phase === 'complete') {
      wave = maxDist + 2;
    }
    edges.forEach(function (e) {
      var x1 = (e.c1 + 0.5) * t, y1 = (e.r1 + 0.5) * t;
      var x2 = (e.c2 + 0.5) * t, y2 = (e.r2 + 0.5) * t;
      ctx.strokeStyle = PAL.copperDim;
      ctx.lineWidth = Math.max(1, t * 0.045);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      var lit = 0;
      if (wave >= 0) {
        lit = clamp01(wave - e.dist + 0.6);
      } else {
        var sh = 0.5 + 0.5 * Math.sin(now / 1000 + e.dist * 1.3 + hash(e.r1 * 7 + e.c1 * 3 + e.r2 * 11 + e.c2 * 5) * 9);
        lit = reduced ? 0.09 : 0.05 + 0.09 * sh;
        if (!reduced) {
          for (var i = 0; i < self.glints.length; i++) {
            var gl = self.glints[i];
            if (gl.key === e.key) {
              var gp = clamp01((now - gl.t0) / 900);
              lit = Math.max(lit, 0.55 * Math.sin(gp * Math.PI));
            }
          }
        }
      }
      if (lit > 0.02) {
        ctx.strokeStyle = 'rgba(' + PAL.copperLit + ',' + Math.min(1, lit * 0.9).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, t * 0.065);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(' + PAL.copperLit + ',' + Math.min(0.5, lit * 0.22).toFixed(3) + ')';
        ctx.lineWidth = Math.max(2, t * 0.16);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    });
    if (!reduced && wave < 0 && edges.size) {
      if (!this._glintTimer) this._glintTimer = now;
      if (now - this._glintTimer > 1500) {
        this._glintTimer = now;
        var arr = [];
        edges.forEach(function (e) { arr.push(e); });
        var near = [];
        for (var j = 0; j < arr.length; j++) if (arr[j].dist <= 3) near.push(arr[j]);
        var pool = near.length ? near : arr;
        var pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) this.glints.push({ key: pick.key, t0: now });
      }
    }
    this.glints = this.glints.filter(function (g) { return now - g.t0 < 900; });
  };

  Renderer.prototype.socket = function (r, c, t, powered, reduced, now) {
    var ctx = this.ctx;
    var cx = (c + 0.5) * t, cy = (r + 0.55) * t;
    var R = t * 0.30;
    var ring = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.3, R * 0.1, cx, cy, R);
    if (powered) {
      ring.addColorStop(0, '#ffe8b4');
      ring.addColorStop(0.5, '#ffb45a');
      ring.addColorStop(1, '#8a4a1c');
    } else {
      ring.addColorStop(0, '#c9853f');
      ring.addColorStop(0.6, '#7a4a26');
      ring.addColorStop(1, '#4a2c14');
    }
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.48, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = powered ? '#3a1c08' : '#241407';
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.62, R * 0.30, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = powered ? '#ffe8b4' : '#6a3a18';
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.28, R * 0.13, 0, 0, TAU);
    ctx.fill();
    var pulse = 0.5 + 0.5 * Math.sin(now / 700 + r * 2 + c * 3);
    var glowA = powered ? 0.5 + 0.22 * pulse : (reduced ? 0.09 : 0.12 + 0.08 * pulse);
    var gr = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    gr.addColorStop(0, 'rgba(255,186,90,' + glowA.toFixed(2) + ')');
    gr.addColorStop(1, 'rgba(255,186,90,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 2.1, 0, TAU);
    ctx.fill();
    if (powered) {
      ctx.fillStyle = 'rgba(255,214,150,' + (0.10 + 0.06 * pulse).toFixed(2) + ')';
      ctx.fillRect(cx - R * 0.45, cy - t * 0.55, R * 0.9, t * 0.55);
    }
  };

  Renderer.prototype.crate = function (cx, cy, t, seated, alive, reduced, now) {
    var ctx = this.ctx;
    var w = t * 0.52, h = t * 0.44;
    var y = cy - h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + t * 0.18, w * 0.75, t * 0.09, 0, 0, TAU);
    ctx.fill();
    var g = ctx.createLinearGradient(cx, y, cx + w, y);
    g.addColorStop(0, '#3d4858');
    g.addColorStop(0.5, '#252d3a');
    g.addColorStop(1, '#19202b');
    ctx.fillStyle = g;
    roundRect(ctx, cx - w / 2, y, w, h, t * 0.06);
    ctx.fill();
    ctx.fillStyle = '#4b5666';
    ctx.fillRect(cx - w / 2, y, w, t * 0.07);
    ctx.fillStyle = '#394252';
    ctx.fillRect(cx - w / 2, y + h - t * 0.055, w, t * 0.055);
    var glass = ctx.createLinearGradient(cx, y + t * 0.08, cx, y + h - t * 0.08);
    glass.addColorStop(0, 'rgba(32,42,56,0.96)');
    glass.addColorStop(1, 'rgba(14,20,30,0.96)');
    ctx.fillStyle = glass;
    roundRect(ctx, cx - w / 2 + t * 0.05, y + t * 0.1, w - t * 0.1, h - t * 0.2, t * 0.04);
    ctx.fill();
    var glow = seated ? (0.75 + 0.25 * Math.sin(now / 380 + cx)) : (alive ? 0.5 : 0.2 + 0.1 * Math.sin(now / 900 + cx * 3));
    var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, t * 0.2);
    rg.addColorStop(0, 'rgba(255,210,130,' + (0.14 + glow * 0.55).toFixed(2) + ')');
    rg.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,150,' + (0.2 + glow * 0.8).toFixed(2) + ')';
    ctx.fillRect(cx - t * 0.055, cy - t * 0.045, t * 0.11, t * 0.09);
    if (seated && !reduced) {
      var tw = 0.5 + 0.5 * Math.sin(now / 240 + cx * 3 + cy * 5);
      ctx.fillStyle = 'rgba(255,240,200,' + (0.35 * tw).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx + t * 0.12, cy - t * 0.12, t * 0.03 * tw + 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    roundRect(ctx, cx - w / 2 + t * 0.04, y + t * 0.12, w - t * 0.14, t * 0.09, t * 0.03);
    ctx.fill();
    if (seated) {
      var pulse = 0.6 + 0.4 * Math.sin(now / 600 + cx);
      ctx.strokeStyle = 'rgba(255,186,90,' + (0.22 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy + t * 0.1, w * 0.8, t * 0.1, 0, 0, TAU);
      ctx.stroke();
    }
  };

  Renderer.prototype.robot = function (cx, cy, t, reduced, now, block, anim, blockT) {
    var ctx = this.ctx;
    var face = anim && anim.dir ? anim.dir : this.robotFacing;
    this.robotFacing = face;
    var push = 0;
    if (anim && anim.push) push = 1 - Math.min(1, (now - anim.t0) / anim.dur);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + t * 0.26, t * 0.22, t * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    if (!reduced) ctx.translate(0, -Math.sin(now / 420) * t * 0.012);
    if (block && blockT) {
      var k = Math.sin((now - blockT) / 230 * Math.PI * 3) * t * 0.02;
      ctx.translate(k, 0);
    }
    var dirVec = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[face] || { x: 0, y: 0 };
    ctx.translate(dirVec.x * push * t * 0.06, dirVec.y * push * t * 0.06);
    var bodyW = t * 0.3, bodyH = t * 0.34;
    ctx.fillStyle = '#10141c';
    ctx.beginPath();
    ctx.arc(-bodyW * 0.45, bodyH * 0.46, t * 0.075, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bodyW * 0.45, bodyH * 0.46, t * 0.075, 0, TAU);
    ctx.fill();
    var bg = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH / 2);
    bg.addColorStop(0, '#4a7a86');
    bg.addColorStop(0.5, '#3c6672');
    bg.addColorStop(1, '#2c4d58');
    ctx.fillStyle = bg;
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH, t * 0.1);
    ctx.fill();
    var hg = ctx.createLinearGradient(0, -bodyH / 2 - t * 0.1, 0, -bodyH / 2 + t * 0.02);
    hg.addColorStop(0, '#5a8b96');
    hg.addColorStop(1, '#3c6672');
    ctx.fillStyle = hg;
    roundRect(ctx, -bodyW / 2, -bodyH / 2 - t * 0.1, bodyW, t * 0.13, t * 0.05);
    ctx.fill();
    var vx = face === 'left' ? -bodyW / 2 - t * 0.02 : face === 'right' ? bodyW / 2 - t * 0.02 : 0;
    var vy = face === 'up' ? -bodyH / 2 - t * 0.06 : face === 'down' ? -bodyH / 2 + t * 0.01 : -bodyH / 2 - t * 0.02;
    ctx.fillStyle = block ? '#ff6a5a' : '#8ff0d8';
    roundRect(ctx, vx - t * 0.09, vy - t * 0.025, t * 0.18, t * 0.05, t * 0.02);
    ctx.fill();
    ctx.fillStyle = block ? 'rgba(255,90,70,0.4)' : 'rgba(143,240,216,0.35)';
    ctx.beginPath();
    ctx.arc(vx, vy + t * 0.004, t * 0.13, 0, TAU);
    ctx.fill();
    // facing chevron
    var chx = face === 'right' ? bodyW / 2 + t * 0.04 : face === 'left' ? -bodyW / 2 - t * 0.04 : 0;
    var chy = face === 'down' ? bodyH / 2 + t * 0.04 : face === 'up' ? -bodyH / 2 - t * 0.14 : 0;
    ctx.fillStyle = 'rgba(230,240,245,0.55)';
    ctx.beginPath();
    if (face === 'right') { ctx.moveTo(chx - t * 0.03, chy - t * 0.04); ctx.lineTo(chx + t * 0.03, chy); ctx.lineTo(chx - t * 0.03, chy + t * 0.04); }
    else if (face === 'left') { ctx.moveTo(chx + t * 0.03, chy - t * 0.04); ctx.lineTo(chx - t * 0.03, chy); ctx.lineTo(chx + t * 0.03, chy + t * 0.04); }
    else if (face === 'down') { ctx.moveTo(chx - t * 0.04, chy - t * 0.03); ctx.lineTo(chx, chy + t * 0.03); ctx.lineTo(chx + t * 0.04, chy - t * 0.03); }
    else { ctx.moveTo(chx - t * 0.04, chy + t * 0.03); ctx.lineTo(chx, chy - t * 0.03); ctx.lineTo(chx + t * 0.04, chy + t * 0.03); }
    ctx.closePath();
    ctx.fill();
    // antenna
    ctx.strokeStyle = '#5a8b96';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH / 2 - t * 0.1);
    ctx.lineTo(0, -bodyH / 2 - t * 0.19);
    ctx.stroke();
    var blink = 0.5 + 0.5 * Math.sin(now / 500);
    ctx.fillStyle = 'rgba(255,210,120,' + (0.4 + 0.6 * blink).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(0, -bodyH / 2 - t * 0.21, t * 0.025 + 0.3, 0, TAU);
    ctx.fill();
    if (push > 0.05) {
      var eg = ctx.createRadialGradient(0, 0, 0, 0, 0, t * 0.32);
      eg.addColorStop(0, 'rgba(255,170,80,' + (0.2 * push).toFixed(2) + ')');
      eg.addColorStop(1, 'rgba(255,170,80,0)');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(0, 0, t * 0.32, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  Renderer.prototype.particles = function (t) {
    var ctx = this.ctx;
    for (var i = this.fx.length - 1; i >= 0; i--) {
      var p = this.fx[i];
      p.life += 1 / 60;
      if (p.life >= p.max) { this.fx.splice(i, 1); continue; }
      p.x += p.vx / 60;
      p.y += p.vy / 60;
      p.vy += 300 / 60;
      var a = 1 - p.life / p.max;
      ctx.fillStyle = 'rgba(255,210,130,' + (0.85 * a).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU);
      ctx.fill();
    }
  };

  Lumen.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);