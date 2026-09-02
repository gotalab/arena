/* Lumen Yard - the yard itself.
   A night-time power yard drawn on canvas: copper conduit, cabinet steel,
   glass relay cores, recessed sockets and one small maintenance robot. */
(function (global) {
  'use strict';

  var BIG = 9999;

  function hash(a, b, c) {
    var h = (a * 374761393 + b * 668265263 + (c || 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function roundRect(g, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  var DIRV = {
    up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 }
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.s = 32; this.ox = 0; this.oy = 0;
    this.level = null;
    this.motion = true;
    this.effects = [];
    this.anim = null;
    this.shake = null;
    this.relief = 0;
    this.effort = 0;
    this.wave = null;
    this.dawn = 0;
    this.dawnWarm = 0;
    this.needsDraw = true;
    this.time = 0;
    this.static = document.createElement('canvas');
    this.motes = [];
  }

  Renderer.prototype.setMotion = function (on) {
    this.motion = !!on;
    this.needsDraw = true;
  };

  Renderer.prototype.setLevel = function (level, state) {
    this.level = level;
    this.model = {
      player: { row: state.player.row, col: state.player.col },
      crates: state.crates.slice(),
      facing: 'down',
      phase: state.phase
    };
    this.anim = null;
    this.effects.length = 0;
    this.wave = null;
    this.dawn = 0;
    this.relief = 0;
    this.effort = 0;
    this._buildTopology();
    this._computeEnergy();
    this.resize(true);
    this.needsDraw = true;
  };

  /* ---------------------------------------------------------------- layout */

  Renderer.prototype.resize = function (force) {
    var canvas = this.canvas;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(1, Math.round(rect.width));
    var cssH = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    if (!force && cssW === this.w && cssH === this.h && dpr === this.dpr) return false;
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (!this.level) return true;

    var pad = Math.max(4, Math.min(cssW, cssH) * 0.02);
    // The yard always fits the frame it is given, however small.
    var s = Math.min((cssW - pad * 2) / this.level.width, (cssH - pad * 2) / this.level.height);
    s = Math.max(4, Math.min(s, 104));
    this.s = s;
    this.ox = Math.round((cssW - s * this.level.width) / 2);
    this.oy = Math.round((cssH - s * this.level.height) / 2);
    this._paintStatic();
    this._seedMotes();
    this.needsDraw = true;
    return true;
  };

  Renderer.prototype.cellFromPoint = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var x = clientX - rect.left - this.ox;
    var y = clientY - rect.top - this.oy;
    var col = Math.floor(x / this.s);
    var row = Math.floor(y / this.s);
    if (!this.level) return null;
    if (row < 0 || col < 0 || row >= this.level.height || col >= this.level.width) return null;
    return { row: row, col: col };
  };

  Renderer.prototype.cellCenter = function (row, col) {
    return { x: this.ox + (col + 0.5) * this.s, y: this.oy + (row + 0.5) * this.s };
  };

  /* ------------------------------------------------------------- topology */

  Renderer.prototype._buildTopology = function () {
    var lvl = this.level, W = lvl.width, H = lvl.height, r, c;
    this.open = [];
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) this.open[r * W + c] = !lvl.wallAt(r, c);
    }
    // Conduit runs between neighbouring open cells.
    this.segments = [];
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (!this.open[r * W + c]) continue;
        if (c + 1 < W && this.open[r * W + c + 1]) this.segments.push([r, c, r, c + 1]);
        if (r + 1 < H && this.open[(r + 1) * W + c]) this.segments.push([r, c, r + 1, c]);
      }
    }
    // Feeder cabinet: the wall cell left of the leftmost open cell nearest mid-height.
    var target = Math.floor(H / 2), bestScore = BIG, best = null;
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (!this.open[r * W + c]) continue;
        if (c === 0 || this.open[r * W + c - 1]) continue;
        var score = Math.abs(r - target) * 4 + c;
        if (score < bestScore) { bestScore = score; best = { row: r, col: c }; }
      }
    }
    this.source = best || { row: 1, col: 1 };
    this.sourceDist = this._bfs([this.source]);

    // Wall lamps: on wall cells that face open floor below.
    this.lamps = [];
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (this.open[r * W + c]) continue;
        if (r + 1 < H && this.open[(r + 1) * W + c] && hash(r, c, 7) > 0.62) {
          this.lamps.push({ row: r, col: c, phase: hash(r, c, 11) * 6.28 });
        }
      }
    }
  };

  Renderer.prototype._bfs = function (sources) {
    var W = this.level.width, H = this.level.height;
    var dist = new Float32Array(W * H);
    var i;
    for (i = 0; i < dist.length; i++) dist[i] = BIG;
    var queue = [];
    for (i = 0; i < sources.length; i++) {
      var idx = sources[i].row * W + sources[i].col;
      if (dist[idx] !== 0) { dist[idx] = 0; queue.push(idx); }
    }
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      var r = Math.floor(cur / W), c = cur % W;
      var d = dist[cur] + 1;
      var n = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (i = 0; i < 4; i++) {
        var nr = n[i][0], nc = n[i][1];
        if (nr < 0 || nc < 0 || nr >= H || nc >= W) continue;
        var ni = nr * W + nc;
        if (!this.open[ni] || dist[ni] <= d) continue;
        dist[ni] = d;
        queue.push(ni);
      }
    }
    return dist;
  };

  Renderer.prototype._computeEnergy = function () {
    var lvl = this.level;
    var seated = [];
    for (var i = 0; i < this.model.crates.length; i++) {
      var cr = this.model.crates[i];
      if (lvl.goalAt(cr.row, cr.col)) seated.push(cr);
    }
    this.seatedCells = seated;
    this.poweredDist = seated.length ? this._bfs(seated) : null;
  };

  Renderer.prototype._seedMotes = function () {
    this.motes = [];
    var count = Math.round(clamp(this.w * this.h / 26000, 8, 26));
    for (var i = 0; i < count; i++) {
      this.motes.push({
        x: hash(i, 3, 1) * this.w,
        y: hash(i, 5, 2) * this.h,
        r: 0.6 + hash(i, 7, 3) * 1.4,
        sp: 3 + hash(i, 9, 4) * 9,
        ph: hash(i, 11, 5) * 6.28
      });
    }
  };

  /* ---------------------------------------------------------------- update */

  /* Called after every accepted mutation. `event` describes what moved so the
     yard can respond with weight; `instant` settles it immediately. */
  Renderer.prototype.sync = function (state, event, instant) {
    var motion = this.motion && !instant;
    this.model = this.model || {};
    this.model.crates = state.crates.slice();
    this.model.phase = state.phase;

    var dur = 0;
    if (event && (event.kind === 'move' || event.kind === 'undo')) {
      dur = motion ? (event.push ? 165 : 125) : 0;
      if (event.kind === 'undo') dur = motion ? 155 : 0;
      this.anim = dur > 0 ? {
        t0: this.time,
        dur: dur,
        kind: event.kind,
        playerFrom: event.from,
        playerTo: event.to,
        crateFrom: event.push ? event.push.from : null,
        crateTo: event.push ? event.push.to : null
      } : null;
      this.model.player = { row: event.to.row, col: event.to.col };
      if (event.kind === 'move' && event.dir) this.model.facing = event.dir;
      if (event.kind === 'undo') {
        var dr = event.to.row - event.from.row, dc = event.to.col - event.from.col;
        this.model.facing = dr < 0 ? 'up' : dr > 0 ? 'down' : dc < 0 ? 'left' : dc > 0 ? 'right' : this.model.facing;
      }
      if (event.push) {
        this.effort = this.time;
        var c0 = this.cellCenter(event.push.from.row, event.push.from.col);
        this._spark(c0.x, c0.y, motion ? 5 : 0, 0.5);
      }
      if (event.kind === 'undo') this._rewind(event);
    } else {
      this.model.player = { row: state.player.row, col: state.player.col };
      this.anim = null;
    }

    if (event && event.seated && event.seated.length) {
      for (var i = 0; i < event.seated.length; i++) {
        var cc = this.cellCenter(event.seated[i].row, event.seated[i].col);
        this.effects.push({ type: 'ring', x: cc.x, y: cc.y, t0: this.time + dur * 0.6, dur: motion ? 620 : 420 });
        this._spark(cc.x, cc.y, motion ? 10 : 4, 1);
      }
      this.relief = this.time + dur;
    }

    this._computeEnergy();

    if (state.phase === 'complete' && !this.wave) {
      var origin = event && event.seated && event.seated.length ? event.seated[0] : this.source;
      this.waveDist = this._bfs([origin]);
      this.wave = { t0: this.time + dur, dur: this.motion ? 1250 : 420 };
    }
    if (state.phase !== 'complete') { this.wave = null; this.dawn = 0; }

    this.needsDraw = true;
    return dur;
  };

  Renderer.prototype.setDawnWarm = function (v) { this.dawnWarm = v; this.needsDraw = true; };

  Renderer.prototype.settle = function () {
    this.anim = null;
    this.needsDraw = true;
  };

  Renderer.prototype.refuse = function (dir, row, col) {
    var d = DIRV[dir];
    if (!d) return;
    this.model.facing = dir;
    var c = this.cellCenter(row, col);
    this.effects.push({
      type: 'refuse', x: c.x + d.dc * this.s * 0.42, y: c.y + d.dr * this.s * 0.42,
      dir: dir, t0: this.time, dur: this.motion ? 380 : 300
    });
    this.shake = { t0: this.time, dur: this.motion ? 260 : 120, mag: this.motion ? this.s * 0.05 : this.s * 0.015 };
    this._spark(c.x + d.dc * this.s * 0.45, c.y + d.dr * this.s * 0.45, this.motion ? 5 : 0, 0.6);
    this.needsDraw = true;
  };

  Renderer.prototype._spark = function (x, y, count, power) {
    for (var i = 0; i < count; i++) {
      var a = hash(Math.round(x), Math.round(y), i * 13) * 6.283;
      var sp = (0.35 + hash(i, 3, Math.round(x)) * 0.9) * this.s * power;
      this.effects.push({
        type: 'spark', x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - this.s * 0.25 * power,
        t0: this.time, dur: 320 + hash(i, 7, 2) * 260
      });
    }
  };

  Renderer.prototype._rewind = function (event) {
    var from = this.cellCenter(event.from.row, event.from.col);
    var to = this.cellCenter(event.to.row, event.to.col);
    this.effects.push({ type: 'rewind', x0: from.x, y0: from.y, x1: to.x, y1: to.y, t0: this.time, dur: this.motion ? 340 : 220 });
  };

  /* ----------------------------------------------------------- static art */

  Renderer.prototype._paintStatic = function () {
    var lvl = this.level;
    if (!lvl) return;
    var s = this.s, dpr = this.dpr;
    var cv = this.static;
    cv.width = Math.max(1, Math.round(this.w * dpr));
    cv.height = Math.max(1, Math.round(this.h * dpr));
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    var W = lvl.width, H = lvl.height, ox = this.ox, oy = this.oy;
    var bw = W * s, bh = H * s;

    // Night beyond the yard.
    var sky = g.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, '#05070d');
    sky.addColorStop(0.55, '#070b13');
    sky.addColorStop(1, '#04060b');
    g.fillStyle = sky;
    g.fillRect(0, 0, this.w, this.h);

    // Yard slab with a soft drop shadow.
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.75)';
    g.shadowBlur = s * 0.55;
    g.shadowOffsetY = s * 0.14;
    g.fillStyle = '#0a1019';
    roundRect(g, ox, oy, bw, bh, Math.min(s * 0.22, 16));
    g.fill();
    g.restore();

    var r, c, x, y;

    // Floor plates.
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (!this.open[r * W + c]) continue;
        x = ox + c * s; y = oy + r * s;
        var tint = hash(r, c, 1);
        var grd = g.createLinearGradient(x, y, x, y + s);
        grd.addColorStop(0, tint > 0.5 ? '#111a27' : '#0f1723');
        grd.addColorStop(1, '#0a111b');
        g.fillStyle = grd;
        g.fillRect(x, y, s, s);
        // plate inset
        g.strokeStyle = 'rgba(150,190,235,0.05)';
        g.lineWidth = Math.max(1, s * 0.02);
        roundRect(g, x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88, s * 0.09);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.moveTo(x + s * 0.06, y + s * 0.94);
        g.lineTo(x + s * 0.94, y + s * 0.94);
        g.stroke();
        // occasional plate detail: grate or bolt pair
        var d = hash(r, c, 3);
        if (d > 0.86) {
          g.strokeStyle = 'rgba(140,180,225,0.055)';
          g.lineWidth = Math.max(1, s * 0.035);
          for (var k = 0; k < 3; k++) {
            g.beginPath();
            g.moveTo(x + s * 0.28, y + s * (0.36 + k * 0.14));
            g.lineTo(x + s * 0.72, y + s * (0.36 + k * 0.14));
            g.stroke();
          }
        } else if (d > 0.72) {
          g.fillStyle = 'rgba(150,185,225,0.07)';
          g.beginPath(); g.arc(x + s * 0.2, y + s * 0.2, s * 0.035, 0, 6.283); g.fill();
          g.beginPath(); g.arc(x + s * 0.8, y + s * 0.8, s * 0.035, 0, 6.283); g.fill();
        }
      }
    }

    // Copper conduit under the plates.
    g.lineCap = 'round';
    for (var i = 0; i < this.segments.length; i++) {
      var sg = this.segments[i];
      var a = this.cellCenter(sg[0], sg[1]);
      var b = this.cellCenter(sg[2], sg[3]);
      g.strokeStyle = 'rgba(120,72,36,0.55)';
      g.lineWidth = Math.max(1.4, s * 0.075);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = 'rgba(196,126,64,0.42)';
      g.lineWidth = Math.max(1, s * 0.035);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // Junction nodes.
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (!this.open[r * W + c]) continue;
        var cc = this.cellCenter(r, c);
        g.fillStyle = 'rgba(140,88,44,0.5)';
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.062, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(20,14,10,0.55)';
        g.beginPath(); g.arc(cc.x, cc.y, s * 0.028, 0, 6.283); g.fill();
      }
    }

    // Cabinet steel.
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (this.open[r * W + c]) continue;
        x = ox + c * s; y = oy + r * s;
        var wg = g.createLinearGradient(x, y, x, y + s);
        wg.addColorStop(0, '#232f42');
        wg.addColorStop(0.42, '#1a2434');
        wg.addColorStop(1, '#121a27');
        g.fillStyle = wg;
        g.fillRect(x, y, s, s);
        // panel seam bevel
        g.strokeStyle = 'rgba(180,210,245,0.07)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x + 0.5, y + s - 0.5); g.lineTo(x + 0.5, y + 0.5); g.lineTo(x + s - 0.5, y + 0.5);
        g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.beginPath();
        g.moveTo(x + s - 0.5, y + 0.5); g.lineTo(x + s - 0.5, y + s - 0.5); g.lineTo(x + 0.5, y + s - 0.5);
        g.stroke();
        // vents on interior pillars
        var interior = r > 0 && c > 0 && r < H - 1 && c < W - 1;
        if (interior) {
          g.strokeStyle = 'rgba(9,13,20,0.75)';
          g.lineWidth = Math.max(1, s * 0.045);
          for (var v = 0; v < 3; v++) {
            g.beginPath();
            g.moveTo(x + s * 0.24, y + s * (0.32 + v * 0.16));
            g.lineTo(x + s * 0.76, y + s * (0.32 + v * 0.16));
            g.stroke();
          }
          g.fillStyle = 'rgba(190,215,245,0.05)';
          g.fillRect(x + s * 0.2, y + s * 0.16, s * 0.6, s * 0.06);
        } else if (hash(r, c, 5) > 0.55) {
          g.fillStyle = 'rgba(150,180,215,0.045)';
          g.fillRect(x + s * 0.18, y + s * 0.26, s * 0.64, s * 0.1);
        }
        // rivets
        g.fillStyle = 'rgba(200,225,255,0.09)';
        g.beginPath(); g.arc(x + s * 0.14, y + s * 0.14, s * 0.03, 0, 6.283); g.fill();
        g.beginPath(); g.arc(x + s * 0.86, y + s * 0.14, s * 0.03, 0, 6.283); g.fill();
        // lip where steel meets floor
        if (r + 1 < H && this.open[(r + 1) * W + c]) {
          g.fillStyle = 'rgba(196,126,64,0.16)';
          g.fillRect(x, y + s - Math.max(1, s * 0.04), s, Math.max(1, s * 0.04));
        }
      }
    }

    // Feeder cabinet beside the source cell.
    var src = this.source;
    if (src.col > 0 && !this.open[src.row * W + src.col - 1]) {
      var fx = ox + (src.col - 1) * s, fy = oy + src.row * s;
      roundRect(g, fx + s * 0.14, fy + s * 0.1, s * 0.72, s * 0.8, s * 0.1);
      g.fillStyle = '#26344a';
      g.fill();
      g.strokeStyle = 'rgba(200,230,255,0.12)';
      g.lineWidth = Math.max(1, s * 0.025);
      g.stroke();
      g.fillStyle = '#0d141e';
      roundRect(g, fx + s * 0.24, fy + s * 0.2, s * 0.52, s * 0.3, s * 0.05);
      g.fill();
      g.strokeStyle = 'rgba(196,126,64,0.5)';
      g.lineWidth = Math.max(1, s * 0.03);
      g.beginPath();
      g.moveTo(fx + s * 0.5, fy + s * 0.56);
      g.lineTo(fx + s * 0.5, fy + s * 0.8);
      g.lineTo(fx + s * 0.95, fy + s * 0.8);
      g.stroke();
    }

    // Yard rim.
    g.strokeStyle = 'rgba(150,195,240,0.1)';
    g.lineWidth = Math.max(1, s * 0.03);
    roundRect(g, ox + 0.5, oy + 0.5, bw - 1, bh - 1, Math.min(s * 0.22, 16));
    g.stroke();
  };

  /* ---------------------------------------------------------------- frame */

  Renderer.prototype.lightAt = function (r, c, t) {
    var W = this.level.width;
    var idx = r * W + c;
    var light = 0;
    if (this.poweredDist) {
      var pd = this.poweredDist[idx];
      if (pd < BIG) light = Math.max(light, clamp(1 - pd / 2.7, 0, 1) * 0.92);
    }
    var sd = this.sourceDist[idx];
    if (sd < BIG) {
      var falloff = clamp(1 - sd / 10, 0, 1);
      var pulse = this.motion ? (0.5 + 0.5 * Math.sin(t * 0.0022 - sd * 0.72)) : 0.5;
      light = Math.max(light, 0.055 + 0.14 * falloff * pulse);
    }
    if (this.wave && this.waveDist) {
      var p = clamp((t - this.wave.t0) / this.wave.dur, 0, 1);
      var radius = easeOut(p) * (this.level.width + this.level.height);
      var wd = this.waveDist[idx];
      if (wd < BIG) {
        var front = clamp((radius - wd) / 1.6, 0, 1);
        light = Math.max(light, front * (0.75 + 0.25 * p));
      }
    }
    return clamp(light, 0, 1);
  };

  Renderer.prototype.draw = function (now) {
    this.time = now;
    if (!this.level) return;
    var motion = this.motion;
    var active = !!(this.anim || this.effects.length || this.shake || this.wave || motion);
    if (!active && !this.needsDraw) return;
    this.needsDraw = false;

    var g = this.g, s = this.s, t = now;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);

    // Camera shake for refusals.
    var sx = 0, sy = 0;
    if (this.shake) {
      var sp = (t - this.shake.t0) / this.shake.dur;
      if (sp >= 1) { this.shake = null; }
      else {
        var damp = (1 - sp) * this.shake.mag;
        sx = Math.sin(sp * 46) * damp;
        sy = Math.cos(sp * 39) * damp * 0.5;
      }
    }
    g.save();
    g.translate(sx, sy);

    g.drawImage(this.static, 0, 0, this.w, this.h);

    this._drawEnergy(g, t);
    this._drawLamps(g, t);
    this._drawSockets(g, t);
    this._drawCores(g, t);
    this._drawRobot(g, t);
    this._drawEffects(g, t);
    if (motion) this._drawMotes(g, t);

    g.restore();

    this._drawAtmosphere(g, t);
  };

  Renderer.prototype._drawEnergy = function (g, t) {
    var s = this.s, W = this.level.width, H = this.level.height;
    g.save();
    g.globalCompositeOperation = 'lighter';

    // Lit conduit.
    g.lineCap = 'round';
    for (var i = 0; i < this.segments.length; i++) {
      var sg = this.segments[i];
      var l = (this.lightAt(sg[0], sg[1], t) + this.lightAt(sg[2], sg[3], t)) * 0.5;
      if (l < 0.04) continue;
      var a = this.cellCenter(sg[0], sg[1]);
      var b = this.cellCenter(sg[2], sg[3]);
      g.strokeStyle = 'rgba(126,226,255,' + (l * 0.5).toFixed(3) + ')';
      g.lineWidth = Math.max(1, s * 0.04 + l * s * 0.03);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      if (l > 0.4) {
        g.strokeStyle = 'rgba(226,250,255,' + ((l - 0.4) * 0.5).toFixed(3) + ')';
        g.lineWidth = Math.max(1, s * 0.02);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }

    // Pooled light on the plates.
    for (var r = 0; r < H; r++) {
      for (var c = 0; c < W; c++) {
        if (!this.open[r * W + c]) continue;
        var lv = this.lightAt(r, c, t);
        if (lv < 0.06) continue;
        var cc = this.cellCenter(r, c);
        var rad = s * (0.4 + lv * 0.5);
        var grd = g.createRadialGradient(cc.x, cc.y, 0, cc.x, cc.y, rad);
        grd.addColorStop(0, 'rgba(96,196,235,' + (lv * 0.2).toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(96,196,235,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(cc.x, cc.y, rad, 0, 6.283); g.fill();
      }
    }
    g.restore();
  };

  Renderer.prototype._drawLamps = function (g, t) {
    var s = this.s;
    var powered = this.model.phase === 'complete';
    for (var i = 0; i < this.lamps.length; i++) {
      var lp = this.lamps[i];
      var c = this.cellCenter(lp.row, lp.col);
      var y = c.y + s * 0.3;
      var blink = this.motion ? (0.55 + 0.45 * Math.sin(t * 0.0016 + lp.phase)) : 0.8;
      var lit = powered ? 1 : 0.35 * blink;
      // housing
      g.fillStyle = '#0e1420';
      roundRect(g, c.x - s * 0.11, y - s * 0.09, s * 0.22, s * 0.13, s * 0.04);
      g.fill();
      g.save();
      g.globalCompositeOperation = 'lighter';
      var col = powered ? '160,240,255' : '235,168,86';
      g.fillStyle = 'rgba(' + col + ',' + (0.55 * lit).toFixed(3) + ')';
      roundRect(g, c.x - s * 0.075, y - s * 0.065, s * 0.15, s * 0.075, s * 0.03);
      g.fill();
      var grd = g.createRadialGradient(c.x, y, 0, c.x, y, s * 0.55);
      grd.addColorStop(0, 'rgba(' + col + ',' + (0.24 * lit).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(c.x, y, s * 0.55, 0, 6.283); g.fill();
      g.restore();
    }
  };

  Renderer.prototype._crateAt = function (row, col) {
    for (var i = 0; i < this.model.crates.length; i++) {
      if (this.model.crates[i].row === row && this.model.crates[i].col === col) return true;
    }
    return false;
  };

  Renderer.prototype._drawSockets = function (g, t) {
    var s = this.s, goals = this.level.goals;
    for (var i = 0; i < goals.length; i++) {
      var gl = goals[i];
      var occupied = this._crateAt(gl.row, gl.col);
      var c = this.cellCenter(gl.row, gl.col);
      var R = s * 0.3;

      // Recess.
      var rg = g.createRadialGradient(c.x, c.y - R * 0.2, R * 0.1, c.x, c.y, R * 1.15);
      rg.addColorStop(0, '#05080d');
      rg.addColorStop(1, 'rgba(6,10,16,0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(c.x, c.y, R * 1.15, 0, 6.283); g.fill();

      g.fillStyle = '#080d14';
      g.beginPath(); g.arc(c.x, c.y, R * 0.86, 0, 6.283); g.fill();

      // Copper collar.
      g.strokeStyle = occupied ? 'rgba(224,168,96,0.95)' : 'rgba(168,108,54,0.85)';
      g.lineWidth = Math.max(1.2, s * 0.055);
      g.beginPath(); g.arc(c.x, c.y, R, 0, 6.283); g.stroke();

      // Three contacts - always visible, empty or powered.
      for (var k = 0; k < 3; k++) {
        var ang = -Math.PI / 2 + k * (Math.PI * 2 / 3);
        var ix = c.x + Math.cos(ang) * R * 0.62, iy = c.y + Math.sin(ang) * R * 0.62;
        g.fillStyle = occupied ? 'rgba(240,206,150,0.95)' : 'rgba(150,100,56,0.9)';
        g.save();
        g.translate(ix, iy); g.rotate(ang);
        roundRect(g, -R * 0.16, -R * 0.1, R * 0.32, R * 0.2, R * 0.06);
        g.fill();
        g.restore();
      }

      if (!occupied) {
        // Waiting: a broken inner ring that slowly turns.
        g.save();
        g.translate(c.x, c.y);
        if (this.motion) g.rotate((t * 0.0004) % 6.283);
        g.strokeStyle = 'rgba(150,200,235,0.34)';
        g.lineWidth = Math.max(1, s * 0.025);
        for (var d = 0; d < 4; d++) {
          g.beginPath();
          g.arc(0, 0, R * 0.5, d * 1.5708 + 0.24, d * 1.5708 + 1.33);
          g.stroke();
        }
        g.restore();
      } else {
        // Powered: closed ring plus radiating spokes (shape, not colour alone).
        g.save();
        g.globalCompositeOperation = 'lighter';
        var pulse = this.motion ? 0.75 + 0.25 * Math.sin(t * 0.004) : 0.85;
        var hg = g.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R * 2.3);
        hg.addColorStop(0, 'rgba(150,235,255,' + (0.34 * pulse).toFixed(3) + ')');
        hg.addColorStop(1, 'rgba(150,235,255,0)');
        g.fillStyle = hg;
        g.beginPath(); g.arc(c.x, c.y, R * 2.3, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(190,245,255,' + (0.7 * pulse).toFixed(3) + ')';
        g.lineWidth = Math.max(1, s * 0.03);
        for (var sp = 0; sp < 8; sp++) {
          var sa = sp * 0.7854 + (this.motion ? t * 0.0006 : 0);
          g.beginPath();
          g.moveTo(c.x + Math.cos(sa) * R * 1.16, c.y + Math.sin(sa) * R * 1.16);
          g.lineTo(c.x + Math.cos(sa) * R * 1.5, c.y + Math.sin(sa) * R * 1.5);
          g.stroke();
        }
        g.restore();
      }
    }
  };

  Renderer.prototype._animCratePos = function (cr, t) {
    var a = this.anim;
    if (a && a.crateTo && a.crateTo.row === cr.row && a.crateTo.col === cr.col) {
      var p = clamp((t - a.t0) / a.dur, 0, 1);
      var e = a.kind === 'undo' ? easeInOut(p) : easeOut(p);
      return { row: lerp(a.crateFrom.row, a.crateTo.row, e), col: lerp(a.crateFrom.col, a.crateTo.col, e), p: p };
    }
    return { row: cr.row, col: cr.col, p: 1 };
  };

  Renderer.prototype._drawCores = function (g, t) {
    var s = this.s;
    for (var i = 0; i < this.model.crates.length; i++) {
      var cr = this.model.crates[i];
      var pos = this._animCratePos(cr, t);
      var seated = this.level.goalAt(cr.row, cr.col) && pos.p >= 1;
      var cx = this.ox + (pos.col + 0.5) * s;
      var cy = this.oy + (pos.row + 0.5) * s;
      var justSeated = this.level.goalAt(cr.row, cr.col) && pos.p < 1;
      this._drawCore(g, cx, cy, s, seated, justSeated, t, i);
    }
  };

  Renderer.prototype._drawCore = function (g, cx, cy, s, seated, arriving, t, idx) {
    var W = s * 0.78, H = s * 0.78;
    var x = cx - W / 2, y = cy - H / 2;

    // Weight: a tight contact shadow.
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.ellipse(cx, cy + H * 0.46, W * 0.46, H * 0.14, 0, 0, 6.283);
    g.fill();
    g.restore();

    // Steel frame.
    var fg = g.createLinearGradient(x, y, x, y + H);
    fg.addColorStop(0, seated ? '#4a6274' : '#3d4c60');
    fg.addColorStop(0.5, '#26313f');
    fg.addColorStop(1, '#161d28');
    g.fillStyle = fg;
    roundRect(g, x, y, W, H, s * 0.11);
    g.fill();
    g.strokeStyle = 'rgba(8,11,16,0.9)';
    g.lineWidth = Math.max(1, s * 0.035);
    g.stroke();
    g.strokeStyle = 'rgba(205,230,255,0.16)';
    g.lineWidth = 1;
    roundRect(g, x + 1, y + 1, W - 2, H - 2, s * 0.1);
    g.stroke();

    // Glass core.
    var inset = W * 0.19;
    var flick = this.motion ? 0.9 + 0.1 * Math.sin(t * 0.006 + idx * 1.7) : 1;
    var gx = x + inset, gy = y + inset * 0.72, gw = W - inset * 2, gh = H - inset * 1.44;
    g.fillStyle = '#070b11';
    roundRect(g, gx, gy, gw, gh, s * 0.05);
    g.fill();

    g.save();
    roundRect(g, gx, gy, gw, gh, s * 0.05);
    g.clip();
    g.globalCompositeOperation = 'lighter';
    var col = seated ? '150,238,255' : '236,168,74';
    var glow = g.createRadialGradient(cx, cy, 0, cx, cy, gw * 1.1);
    glow.addColorStop(0, 'rgba(' + col + ',' + (seated ? 0.95 : 0.6 * flick).toFixed(3) + ')');
    glow.addColorStop(0.55, 'rgba(' + col + ',' + (seated ? 0.4 : 0.2 * flick).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = glow;
    g.fillRect(gx, gy, gw, gh);
    // filament
    g.strokeStyle = 'rgba(255,255,255,' + (seated ? 0.85 : 0.4).toFixed(2) + ')';
    g.lineWidth = Math.max(1, s * 0.028);
    g.beginPath();
    g.moveTo(cx, gy + gh * 0.16);
    g.lineTo(cx, gy + gh * 0.84);
    g.stroke();
    g.restore();

    g.strokeStyle = 'rgba(10,14,20,0.85)';
    g.lineWidth = Math.max(1, s * 0.022);
    roundRect(g, gx, gy, gw, gh, s * 0.05);
    g.stroke();

    // Bands and bolts.
    g.fillStyle = 'rgba(16,22,31,0.9)';
    g.fillRect(x + W * 0.04, y + H * 0.16, W * 0.92, H * 0.06);
    g.fillRect(x + W * 0.04, y + H * 0.78, W * 0.92, H * 0.06);
    g.fillStyle = 'rgba(210,232,255,0.2)';
    var bolts = [[0.13, 0.13], [0.87, 0.13], [0.13, 0.87], [0.87, 0.87]];
    for (var b = 0; b < 4; b++) {
      g.beginPath();
      g.arc(x + W * bolts[b][0], y + H * bolts[b][1], s * 0.03, 0, 6.283);
      g.fill();
    }

    if (seated || arriving) {
      // Latches close over the frame - readable without colour.
      g.save();
      var ext = seated ? 1 : 0.4;
      g.strokeStyle = seated ? 'rgba(226,250,255,0.9)' : 'rgba(226,250,255,0.45)';
      g.lineWidth = Math.max(1.5, s * 0.05);
      g.lineCap = 'round';
      var L = W * 0.2 * ext;
      var corners = [[x, y, 1, 1], [x + W, y, -1, 1], [x, y + H, 1, -1], [x + W, y + H, -1, -1]];
      for (var q = 0; q < 4; q++) {
        var cxx = corners[q][0], cyy = corners[q][1], dx = corners[q][2], dy = corners[q][3];
        g.beginPath();
        g.moveTo(cxx + dx * W * 0.06, cyy + dy * H * 0.06 + dy * L);
        g.lineTo(cxx + dx * W * 0.06, cyy + dy * H * 0.06);
        g.lineTo(cxx + dx * W * 0.06 + dx * L, cyy + dy * H * 0.06);
        g.stroke();
      }
      g.restore();
    }
    if (seated) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      var hp = this.motion ? 0.7 + 0.3 * Math.sin(t * 0.0035 + idx) : 0.8;
      var hgl = g.createRadialGradient(cx, cy, W * 0.2, cx, cy, W * 1.25);
      hgl.addColorStop(0, 'rgba(140,232,255,' + (0.3 * hp).toFixed(3) + ')');
      hgl.addColorStop(1, 'rgba(140,232,255,0)');
      g.fillStyle = hgl;
      g.beginPath(); g.arc(cx, cy, W * 1.25, 0, 6.283); g.fill();
      g.restore();
    }
  };

  Renderer.prototype._drawRobot = function (g, t) {
    var s = this.s;
    var a = this.anim;
    var pr = this.model.player.row, pc = this.model.player.col;
    var p = 1;
    if (a) {
      p = clamp((t - a.t0) / a.dur, 0, 1);
      var e = a.kind === 'undo' ? easeInOut(p) : easeOut(p);
      pr = lerp(a.playerFrom.row, a.playerTo.row, e);
      pc = lerp(a.playerFrom.col, a.playerTo.col, e);
      if (p >= 1) this.anim = null;
    }
    var cx = this.ox + (pc + 0.5) * s;
    var cy = this.oy + (pr + 0.5) * s;
    var dir = this.model.facing || 'down';
    var d = DIRV[dir];

    var idle = this.motion ? Math.sin(t * 0.0024) * s * 0.016 : 0;
    var pushing = a && a.crateTo && p < 1;
    var effortT = clamp((t - this.effort) / 260, 0, 1);
    var lean = pushing ? s * 0.06 : (1 - effortT) * s * 0.02;
    var reliefT = clamp((t - this.relief) / 520, 0, 1);
    var hop = this.relief && reliefT < 1 ? -Math.sin(reliefT * Math.PI) * s * (this.motion ? 0.1 : 0.02) : 0;

    var bx = cx + d.dc * lean;
    var by = cy + d.dr * lean + idle + hop;

    // Headlamp on the floor ahead.
    g.save();
    g.globalCompositeOperation = 'lighter';
    var lx = bx + d.dc * s * 0.5, ly = by + d.dr * s * 0.5;
    var cone = g.createRadialGradient(lx, ly, 0, lx, ly, s * 0.75);
    cone.addColorStop(0, 'rgba(180,226,255,0.14)');
    cone.addColorStop(1, 'rgba(180,226,255,0)');
    g.fillStyle = cone;
    g.beginPath(); g.arc(lx, ly, s * 0.75, 0, 6.283); g.fill();
    g.restore();

    // Shadow.
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.ellipse(cx, cy + s * 0.34, s * 0.3, s * 0.1, 0, 0, 6.283);
    g.fill();

    var W = s * 0.62, H = s * 0.54;
    var x = bx - W / 2, y = by - H / 2 - s * 0.02;

    // Treads.
    g.fillStyle = '#0f151f';
    roundRect(g, bx - W * 0.56, by + H * 0.24, W * 1.12, H * 0.3, s * 0.06);
    g.fill();
    g.strokeStyle = 'rgba(190,220,250,0.12)';
    g.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      var tx = bx - W * 0.44 + i * W * 0.29;
      g.beginPath();
      g.moveTo(tx, by + H * 0.26);
      g.lineTo(tx, by + H * 0.52);
      g.stroke();
    }

    // Chassis.
    var cg = g.createLinearGradient(x, y, x, y + H);
    cg.addColorStop(0, '#5b6f86');
    cg.addColorStop(0.45, '#3a4a5e');
    cg.addColorStop(1, '#212b3a');
    g.fillStyle = cg;
    roundRect(g, x, y, W, H, s * 0.13);
    g.fill();
    g.strokeStyle = 'rgba(8,11,17,0.9)';
    g.lineWidth = Math.max(1, s * 0.03);
    g.stroke();
    g.strokeStyle = 'rgba(220,240,255,0.18)';
    g.lineWidth = 1;
    roundRect(g, x + 1, y + 1, W - 2, H - 2, s * 0.12);
    g.stroke();

    // Antenna with a working light.
    g.strokeStyle = '#26303f';
    g.lineWidth = Math.max(1, s * 0.028);
    g.beginPath();
    g.moveTo(bx + W * 0.3, y + H * 0.08);
    g.lineTo(bx + W * 0.36, y - H * 0.34);
    g.stroke();
    var blink = reliefT < 1 ? 1 : (this.motion ? 0.4 + 0.6 * Math.pow(Math.sin(t * 0.0018), 8) : 0.5);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(255,205,120,' + (0.5 + 0.5 * blink).toFixed(3) + ')';
    g.beginPath(); g.arc(bx + W * 0.36, y - H * 0.36, s * 0.035, 0, 6.283); g.fill();
    g.restore();

    // Visor - the face, always pointing where it will move.
    var vw = (dir === 'left' || dir === 'right') ? W * 0.42 : W * 0.62;
    var vh = H * 0.34;
    var vx = bx + d.dc * W * 0.14 - vw / 2;
    var vy = by + d.dr * H * 0.1 - vh / 2 - H * 0.04;
    g.fillStyle = '#070b12';
    roundRect(g, vx, vy, vw, vh, vh * 0.42);
    g.fill();

    g.save();
    roundRect(g, vx, vy, vw, vh, vh * 0.42);
    g.clip();
    g.globalCompositeOperation = 'lighter';
    var eyeGlow = reliefT < 1 ? 1 : 0.72;
    var scan = this.motion ? Math.sin(t * 0.0011) * vw * 0.16 : 0;
    var pupilX = vx + vw / 2 + d.dc * vw * 0.16 + scan;
    var pupilY = vy + vh / 2 + d.dr * vh * 0.12;
    var eg = g.createRadialGradient(pupilX, pupilY, 0, pupilX, pupilY, vw * 0.7);
    eg.addColorStop(0, 'rgba(190,246,255,' + (0.95 * eyeGlow).toFixed(2) + ')');
    eg.addColorStop(0.45, 'rgba(96,206,255,' + (0.55 * eyeGlow).toFixed(2) + ')');
    eg.addColorStop(1, 'rgba(96,206,255,0)');
    g.fillStyle = eg;
    g.fillRect(vx, vy, vw, vh);
    g.restore();
    g.strokeStyle = 'rgba(150,190,230,0.25)';
    g.lineWidth = 1;
    roundRect(g, vx, vy, vw, vh, vh * 0.42);
    g.stroke();

    // Effort: bracing marks while a core is under the shoulder.
    if (pushing) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,220,160,0.5)';
      g.lineWidth = Math.max(1, s * 0.03);
      for (var k = 0; k < 2; k++) {
        var ex = bx - d.dc * s * (0.4 + k * 0.1);
        var ey = by - d.dr * s * (0.4 + k * 0.1);
        g.beginPath();
        g.moveTo(ex - Math.abs(d.dr) * s * 0.1 - Math.abs(d.dc) * 0, ey - Math.abs(d.dc) * s * 0.1);
        g.lineTo(ex + Math.abs(d.dr) * s * 0.1, ey + Math.abs(d.dc) * s * 0.1);
        g.stroke();
      }
      g.restore();
    }
  };

  Renderer.prototype._drawEffects = function (g, t) {
    var s = this.s;
    for (var i = this.effects.length - 1; i >= 0; i--) {
      var fx = this.effects[i];
      var p = (t - fx.t0) / fx.dur;
      if (p < 0) continue;
      if (p >= 1) { this.effects.splice(i, 1); continue; }
      g.save();
      g.globalCompositeOperation = 'lighter';
      if (fx.type === 'spark') {
        var life = 1 - p;
        var px = fx.x + fx.vx * p, py = fx.y + fx.vy * p + s * 0.9 * p * p;
        g.fillStyle = 'rgba(255,226,168,' + (life * 0.85).toFixed(3) + ')';
        g.beginPath(); g.arc(px, py, s * 0.028 * life + 0.5, 0, 6.283); g.fill();
      } else if (fx.type === 'ring') {
        var rp = easeOut(p);
        g.strokeStyle = 'rgba(180,244,255,' + ((1 - p) * 0.8).toFixed(3) + ')';
        g.lineWidth = Math.max(1, s * 0.05 * (1 - p) + 1);
        g.beginPath(); g.arc(fx.x, fx.y, s * (0.25 + rp * 0.75), 0, 6.283); g.stroke();
      } else if (fx.type === 'rewind') {
        var q = easeInOut(p);
        var hx = lerp(fx.x0, fx.x1, q), hy = lerp(fx.y0, fx.y1, q);
        var grd = g.createRadialGradient(hx, hy, 0, hx, hy, s * 0.4);
        grd.addColorStop(0, 'rgba(150,210,255,' + ((1 - p) * 0.5).toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(150,210,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(hx, hy, s * 0.4, 0, 6.283); g.fill();
        g.strokeStyle = 'rgba(190,225,255,' + ((1 - p) * 0.55).toFixed(3) + ')';
        g.lineWidth = Math.max(1, s * 0.03);
        g.beginPath(); g.moveTo(fx.x0, fx.y0); g.lineTo(hx, hy); g.stroke();
      } else if (fx.type === 'refuse') {
        // A hard bar across the way, plus a flash. Shape, not colour alone.
        var fp = 1 - p;
        var d = DIRV[fx.dir];
        var len = s * 0.44;
        g.strokeStyle = 'rgba(255,176,120,' + (fp * 0.95).toFixed(3) + ')';
        g.lineWidth = Math.max(2, s * 0.075 * fp + 1.5);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(fx.x - Math.abs(d.dr) * len / 2 - Math.abs(d.dc) * 0, fx.y - Math.abs(d.dc) * len / 2);
        g.lineTo(fx.x + Math.abs(d.dr) * len / 2, fx.y + Math.abs(d.dc) * len / 2);
        g.stroke();
        g.strokeStyle = 'rgba(255,210,170,' + (fp * 0.6).toFixed(3) + ')';
        g.lineWidth = Math.max(1, s * 0.035);
        for (var k = -1; k <= 1; k += 2) {
          g.beginPath();
          var ox2 = fx.x - d.dc * s * 0.12, oy2 = fx.y - d.dr * s * 0.12;
          g.moveTo(ox2 + Math.abs(d.dr) * k * len * 0.34, oy2 + Math.abs(d.dc) * k * len * 0.34);
          g.lineTo(fx.x + Math.abs(d.dr) * k * len * 0.34, fx.y + Math.abs(d.dc) * k * len * 0.34);
          g.stroke();
        }
      }
      g.restore();
    }
  };

  Renderer.prototype._drawMotes = function (g, t) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      var y = m.y - ((t * 0.001 * m.sp) % (this.h + 40));
      if (y < -20) y += this.h + 40;
      var tw = 0.25 + 0.25 * Math.sin(t * 0.001 + m.ph);
      g.fillStyle = 'rgba(170,210,245,' + tw.toFixed(3) + ')';
      g.beginPath(); g.arc(m.x, y, m.r, 0, 6.283); g.fill();
    }
    g.restore();
  };

  Renderer.prototype._drawAtmosphere = function (g, t) {
    var w = this.w, h = this.h;

    // Completion bloom / dawn beyond the yard.
    if (this.wave) {
      var p = clamp((t - this.wave.t0) / this.wave.dur, 0, 1);
      this.dawn = Math.max(this.dawn, easeOut(p));
    }
    if (this.dawn > 0.001) {
      var warm = this.dawnWarm;
      g.save();
      g.globalCompositeOperation = 'lighter';
      var top = g.createLinearGradient(0, 0, 0, h * 0.75);
      var col = warm > 0 ? '255,196,124' : '120,214,255';
      top.addColorStop(0, 'rgba(' + col + ',' + (0.2 * this.dawn).toFixed(3) + ')');
      top.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = top;
      g.fillRect(0, 0, w, h * 0.75);
      var flash = (this.wave && t >= this.wave.t0)
        ? clamp(1 - (t - this.wave.t0) / (this.wave.dur * 0.5), 0, 1) : 0;
      if (flash > 0) {
        g.fillStyle = 'rgba(190,240,255,' + (flash * 0.12).toFixed(3) + ')';
        g.fillRect(0, 0, w, h);
      }
      g.restore();
    }

    // Vignette keeps the night around the yard.
    var vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  };

  global.LumenRenderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
