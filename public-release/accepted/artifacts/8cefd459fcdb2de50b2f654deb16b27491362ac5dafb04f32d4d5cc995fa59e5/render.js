// Lumen Yard - canvas renderer. Turns the abstract grid into a small
// electrical world: copper sockets, heavy relay cores, a maintenance robot.
(function (root) {
  'use strict';

  var DIR_VEC = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function posKey(r, c) { return r + ',' + c; }

  function LumenRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tileSize = 32;
    this.offsetX = 0;
    this.offsetY = 0;
    this.levelId = null;
    this.motion = true;
    this.player = null; // {row,col,visRow,visCol,startRow,startCol,startTime,duration,facing,effort,blockedUntil,blockedDir}
    this.crates = new Map(); // id -> visual crate
    this.walls = [];
    this.goals = [];
    this.goalSet = new Set();
    this.boardW = 1;
    this.boardH = 1;
    this.completionEffect = null;
    this.sparks = [];
    this.time = 0;
    this.idlePhase = Math.random() * 10;
  }

  LumenRenderer.prototype.setMotion = function (motion) {
    this.motion = motion;
  };

  // Nudges the robot toward a direction and springs back, without any
  // underlying state mutation. Used for rejected/blocked move feedback.
  LumenRenderer.prototype.flashBlocked = function (direction) {
    if (!this.player) return;
    var now = performance.now();
    this.player.blockedUntil = now + 220;
    this.player.blockedDir = direction;
  };

  LumenRenderer.prototype.resize = function (containerW, containerH) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.viewW = containerW;
    this.viewH = containerH;
    this.canvas.width = Math.max(1, Math.round(containerW * dpr));
    this.canvas.height = Math.max(1, Math.round(containerH * dpr));
    this.canvas.style.width = containerW + 'px';
    this.canvas.style.height = containerH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._layout();
  };

  LumenRenderer.prototype._layout = function () {
    if (!this.viewW || !this.viewH) return;
    var pad = Math.max(8, Math.min(this.viewW, this.viewH) * 0.035);
    var availW = this.viewW - pad * 2;
    var availH = this.viewH - pad * 2;
    var ts = Math.floor(Math.min(availW / this.boardW, availH / this.boardH));
    this.tileSize = Math.max(8, ts);
    var boardPxW = this.tileSize * this.boardW;
    var boardPxH = this.tileSize * this.boardH;
    this.offsetX = (this.viewW - boardPxW) / 2;
    this.offsetY = (this.viewH - boardPxH) / 2;
  };

  // ---- state ingestion -----------------------------------------------

  LumenRenderer.prototype.loadLevel = function (state) {
    this.levelId = state.levelId;
    this.boardW = state.width;
    this.boardH = state.height;
    this.walls = state.walls;
    this.goals = state.goals;
    this.goalSet = new Set(state.goals.map(function (g) { return posKey(g.row, g.col); }));
    this.wallSet = new Set(state.walls.map(function (w) { return posKey(w.row, w.col); }));
    this._layout();

    var now = performance.now();
    this.player = {
      row: state.player.row, col: state.player.col,
      visRow: state.player.row, visCol: state.player.col,
      facing: 'down', effort: 0, blockedUntil: 0, blockedDir: null
    };
    this.crates = new Map();
    this._nextCrateId = 0;
    var self = this;
    state.crates.forEach(function (c) {
      var id = self._nextCrateId++;
      self.crates.set(id, {
        row: c.row, col: c.col, visRow: c.row, visCol: c.col,
        seatedGlow: self.goalSet.has(posKey(c.row, c.col)) ? 1 : 0
      });
    });
    this._prevSortedCrates = state.crates.map(function (c) { return { row: c.row, col: c.col }; });
    this._prevCrateIds = state.crates.map(function (c, i) { return i; });
    this.completionEffect = null;
    this.sparks = [];
  };

  // Applies a new authoritative state. animate=false snaps instantly
  // (used for programmatic/API-driven mutations); animate=true tweens
  // (used for human input) unless reduced motion is active.
  LumenRenderer.prototype.applyState = function (prevState, state, opts) {
    opts = opts || {};
    var animate = opts.animate !== false && this.motion;
    var now = performance.now();

    if (!this.player || state.levelId !== this.levelId) {
      this.loadLevel(state);
      return;
    }

    // player
    var p = this.player;
    var dr = state.player.row - p.row;
    var dc = state.player.col - p.col;
    if (dr !== 0 || dc !== 0) {
      p.facing = dr < 0 ? 'up' : dr > 0 ? 'down' : dc < 0 ? 'left' : 'right';
    }
    p.startRow = p.visRow; p.startCol = p.visCol;
    p.row = state.player.row; p.col = state.player.col;
    p.startTime = now;
    p.duration = animate ? (opts.pushed ? 190 : 140) : 0;
    if (!animate) { p.visRow = p.row; p.visCol = p.col; }
    if (opts.pushed) p.effort = 1;

    if (opts.blocked) {
      p.blockedUntil = now + 220;
      p.blockedDir = opts.blocked;
    }

    // crates: match old sorted list to new sorted list by position identity
    var oldSorted = this._prevSortedCrates;
    var newSorted = state.crates;
    var oldIds = this._prevCrateIds;

    var oldMap = new Map();
    oldSorted.forEach(function (c, i) { oldMap.set(posKey(c.row, c.col), oldIds[i]); });
    var newIds = new Array(newSorted.length);
    var usedOld = new Set();
    var unmatchedNewIdx = [];
    newSorted.forEach(function (c, i) {
      var k = posKey(c.row, c.col);
      if (oldMap.has(k) && !usedOld.has(k)) {
        newIds[i] = oldMap.get(k);
        usedOld.add(k);
      } else {
        unmatchedNewIdx.push(i);
      }
    });
    var unmatchedOldIds = [];
    oldSorted.forEach(function (c, i) {
      var k = posKey(c.row, c.col);
      if (!usedOld.has(k)) unmatchedOldIds.push(oldIds[i]);
      else usedOld.delete(k); // allow duplicate-key edge safety
    });
    unmatchedNewIdx.forEach(function (i, j) {
      newIds[i] = unmatchedOldIds[j] !== undefined ? unmatchedOldIds[j] : (this._nextCrateId++);
    }, this);

    var self = this;
    var seatedNow = [];
    newSorted.forEach(function (c, i) {
      var id = newIds[i];
      var vis = self.crates.get(id);
      var wasSeated = self.goalSet.has(posKey(vis ? vis.row : c.row, vis ? vis.col : c.col));
      if (!vis) {
        vis = { row: c.row, col: c.col, visRow: c.row, visCol: c.col, seatedGlow: self.goalSet.has(posKey(c.row, c.col)) ? 1 : 0 };
        self.crates.set(id, vis);
      } else {
        var moved = vis.row !== c.row || vis.col !== c.col;
        vis.startRow = vis.visRow; vis.startCol = vis.visCol;
        vis.row = c.row; vis.col = c.col;
        vis.startTime = now;
        vis.duration = animate ? 190 : 0;
        if (!animate) { vis.visRow = vis.row; vis.visCol = vis.col; }
        if (moved && self.goalSet.has(posKey(c.row, c.col))) {
          seatedNow.push({ row: c.row, col: c.col });
        }
      }
    });
    // drop crates no longer present (shouldn't normally happen mid-level)
    var keepIds = new Set(newIds);
    Array.from(this.crates.keys()).forEach(function (id) {
      if (!keepIds.has(id)) self.crates.delete(id);
    });

    this._prevSortedCrates = newSorted.map(function (c) { return { row: c.row, col: c.col }; });
    this._prevCrateIds = newIds;

    if (seatedNow.length && this.motion) {
      seatedNow.forEach(function (pos) {
        self._spawnSparks(pos.row, pos.col);
      });
    }

    if (prevState && prevState.phase === 'playing' && state.phase === 'complete') {
      this.completionEffect = { startTime: now, duration: this.motion ? 1500 : 260 };
    }
    if (state.phase === 'playing') {
      this.completionEffect = null;
    }
  };

  LumenRenderer.prototype._spawnSparks = function (row, col) {
    var cx = col + 0.5, cy = row + 0.5;
    for (var i = 0; i < 10; i++) {
      var a = (Math.PI * 2 * i) / 10 + Math.random() * 0.3;
      this.sparks.push({
        x: cx, y: cy,
        vx: Math.cos(a) * (0.9 + Math.random() * 0.6),
        vy: Math.sin(a) * (0.9 + Math.random() * 0.6),
        life: 1, born: performance.now()
      });
    }
  };

  // ---- drawing ----------------------------------------------------------

  LumenRenderer.prototype.tick = function (timestamp) {
    this.time = timestamp;
    this.draw();
  };

  LumenRenderer.prototype.draw = function () {
    var ctx = this.ctx;
    var now = this.time || performance.now();
    ctx.save();
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    var bg = ctx.createLinearGradient(0, 0, 0, this.viewH);
    bg.addColorStop(0, '#070c16');
    bg.addColorStop(1, '#0b1220');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    if (!this.player) { ctx.restore(); return; }

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    var ts = this.tileSize;

    this._updatePlayerTween(now);
    this._updateCrateTweens(now);

    this._drawFloor(ctx, ts, now);
    this._drawCables(ctx, ts, now);
    this._drawWalls(ctx, ts);
    this._drawSockets(ctx, ts, now);
    this._drawCrates(ctx, ts, now);
    this._drawRobot(ctx, ts, now);
    this._drawSparks(ctx, ts, now);
    this._drawCompletionOverlay(ctx, ts, now);

    ctx.restore();
    ctx.restore();
  };

  LumenRenderer.prototype._updatePlayerTween = function (now) {
    var p = this.player;
    if (p.duration && now - p.startTime < p.duration) {
      var t = easeOutQuad(clamp01((now - p.startTime) / p.duration));
      p.visRow = lerp(p.startRow, p.row, t);
      p.visCol = lerp(p.startCol, p.col, t);
    } else {
      p.visRow = p.row; p.visCol = p.col;
    }
    if (p.effort > 0) {
      p.effort = Math.max(0, p.effort - 0.045);
    }
  };

  LumenRenderer.prototype._updateCrateTweens = function (now) {
    this.crates.forEach(function (c) {
      if (c.duration && now - c.startTime < c.duration) {
        var t = easeOutQuad(clamp01((now - c.startTime) / c.duration));
        c.visRow = lerp(c.startRow, c.row, t);
        c.visCol = lerp(c.startCol, c.col, t);
      } else {
        c.visRow = c.row; c.visCol = c.col;
      }
    });
  };

  LumenRenderer.prototype._drawFloor = function (ctx, ts, now) {
    for (var r = 0; r < this.boardH; r++) {
      for (var c = 0; c < this.boardW; c++) {
        if (this.wallSet.has(posKey(r, c))) continue;
        var x = c * ts, y = r * ts;
        var checker = (r + c) % 2 === 0;
        ctx.fillStyle = checker ? '#101c2f' : '#0d1728';
        ctx.fillRect(x, y, ts, ts);
        ctx.strokeStyle = 'rgba(120,170,220,0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
      }
    }
  };

  LumenRenderer.prototype._drawCables = function (ctx, ts, now) {
    var self = this;
    var pulse = this.motion ? (Math.sin(now / 420 + this.idlePhase) * 0.15 + 0.55) : 0.55;
    this.goals.forEach(function (g) {
      var powered = self._crateAt(g.row, g.col);
      var x0 = -ts * 0.4, y0 = -ts * 0.4;
      var x2 = g.col * ts + ts / 2, y2 = g.row * ts + ts / 2;
      var midX = x0, midY = y2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(midX, midY);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = Math.max(1.5, ts * 0.05);
      if (powered) {
        ctx.strokeStyle = 'rgba(124,249,196,' + (0.55 + pulse * 0.35) + ')';
        ctx.shadowColor = '#7CF9C4';
        ctx.shadowBlur = ts * 0.35;
      } else {
        ctx.strokeStyle = 'rgba(120,170,220,' + (0.10 + (self.motion ? pulse * 0.05 : 0)) + ')';
        ctx.shadowBlur = 0;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
    // source node marker
    ctx.beginPath();
    var srcR = ts * 0.16;
    var sx = -ts * 0.4, sy = -ts * 0.4;
    var glow = this.motion ? (0.5 + Math.sin(now / 260) * 0.3) : 0.6;
    ctx.fillStyle = 'rgba(224,164,88,' + glow + ')';
    ctx.shadowColor = '#e0a458';
    ctx.shadowBlur = ts * 0.4;
    ctx.arc(sx, sy, srcR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  // Uses the crate's current visual (tweened) position rather than its
  // logical position, so sockets/cables light up exactly as a pushed crate
  // visually arrives rather than an animation frame early.
  LumenRenderer.prototype._crateAt = function (row, col) {
    var found = false;
    this.crates.forEach(function (c) {
      if (c.visRow === row && c.visCol === col) found = true;
    });
    return found;
  };

  LumenRenderer.prototype._drawWalls = function (ctx, ts) {
    for (var i = 0; i < this.walls.length; i++) {
      var w = this.walls[i];
      var x = w.col * ts, y = w.row * ts;
      var g = ctx.createLinearGradient(x, y, x, y + ts);
      g.addColorStop(0, '#28324a');
      g.addColorStop(1, '#141c2c');
      ctx.fillStyle = g;
      var rad = ts * 0.12;
      this._roundRect(ctx, x + 1, y + 1, ts - 2, ts - 2, rad);
      ctx.fill();
      ctx.strokeStyle = 'rgba(224,164,88,0.18)';
      ctx.lineWidth = Math.max(1, ts * 0.04);
      ctx.beginPath();
      ctx.moveTo(x + ts * 0.15, y + ts * 0.22);
      ctx.lineTo(x + ts * 0.85, y + ts * 0.22);
      ctx.stroke();
    }
  };

  LumenRenderer.prototype._roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  LumenRenderer.prototype._drawSockets = function (ctx, ts, now) {
    var self = this;
    var pulse = this.motion ? (Math.sin(now / 500 + this.idlePhase) * 0.5 + 0.5) : 0.5;
    this.goals.forEach(function (g) {
      var cx = g.col * ts + ts / 2, cy = g.row * ts + ts / 2;
      var powered = self._crateAt(g.row, g.col);
      var rOuter = ts * 0.34;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      if (powered) {
        ctx.fillStyle = '#0c2a22';
        ctx.fill();
        ctx.lineWidth = Math.max(2, ts * 0.07);
        ctx.strokeStyle = 'rgba(124,249,196,' + (0.75 + pulse * 0.25) + ')';
        ctx.shadowColor = '#7CF9C4';
        ctx.shadowBlur = ts * (0.35 + pulse * 0.15);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#d8fff0';
        ctx.fill();
        // explicit non-colour "seated" mark, legible independent of hue
        ctx.save();
        ctx.strokeStyle = '#0c2a22';
        ctx.lineWidth = Math.max(1.5, ts * 0.035);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - rOuter * 0.18, cy + rOuter * 0.02);
        ctx.lineTo(cx - rOuter * 0.03, cy + rOuter * 0.18);
        ctx.lineTo(cx + rOuter * 0.22, cy - rOuter * 0.16);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = '#1a130c';
        ctx.fill();
        ctx.lineWidth = Math.max(2, ts * 0.06);
        ctx.strokeStyle = '#8a5a30';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#3a2716';
        ctx.fill();
        ctx.strokeStyle = 'rgba(224,164,88,0.5)';
        ctx.lineWidth = Math.max(1, ts * 0.02);
        ctx.stroke();
      }
    });
  };

  LumenRenderer.prototype._drawCrates = function (ctx, ts, now) {
    var self = this;
    this.crates.forEach(function (c) {
      var cx = c.visCol * ts + ts / 2, cy = c.visRow * ts + ts / 2;
      var seated = self.goalSet.has(posKey(c.row, c.col)) && c.visRow === c.row && c.visCol === c.col;
      var size = ts * 0.72;
      var squash = 1;
      if (c.duration && now - c.startTime < c.duration) {
        var t = clamp01((now - c.startTime) / c.duration);
        squash = 1 - Math.sin(t * Math.PI) * 0.08;
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 / squash, squash);
      var g = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
      if (seated) {
        g.addColorStop(0, '#bfe9d8');
        g.addColorStop(1, '#4f9a82');
      } else {
        g.addColorStop(0, '#9fb0c8');
        g.addColorStop(1, '#48566e');
      }
      ctx.fillStyle = g;
      self._roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.18);
      ctx.fill();
      ctx.strokeStyle = seated ? 'rgba(124,249,196,0.6)' : 'rgba(20,26,38,0.7)';
      ctx.lineWidth = Math.max(1, ts * 0.035);
      ctx.stroke();
      // bolt/vent accents
      ctx.fillStyle = seated ? 'rgba(20,60,45,0.6)' : 'rgba(20,26,38,0.55)';
      var bolt = size * 0.1;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p[0] * size * 0.32, p[1] * size * 0.32, bolt * 0.5, 0, Math.PI * 2);
        ctx.fill();
      });
      // core glow slit
      ctx.fillStyle = seated ? '#e8fff6' : '#cdd8e8';
      self._roundRect(ctx, -size * 0.22, -size * 0.08, size * 0.44, size * 0.16, size * 0.05);
      ctx.fill();
      ctx.restore();
    });
  };

  LumenRenderer.prototype._drawRobot = function (ctx, ts, now) {
    var p = this.player;
    var cx = p.visCol * ts + ts / 2, cy = p.visRow * ts + ts / 2;
    var bob = 0;
    if (this.motion) {
      bob = Math.sin(now / 480 + this.idlePhase) * ts * 0.02;
    }
    if (now < p.blockedUntil) {
      var bt = 1 - (p.blockedUntil - now) / 220;
      var v = DIR_VEC[p.blockedDir] || { dr: 0, dc: 0 };
      var amt = Math.sin(bt * Math.PI * 3) * (1 - bt) * ts * 0.14;
      cx += v.dc * amt; cy += v.dr * amt;
    }
    var size = ts * 0.62;
    var leanX = 0, leanY = 0;
    if (p.effort > 0) {
      var v2 = DIR_VEC[p.facing] || { dr: 0, dc: 0 };
      leanX = v2.dc * p.effort * ts * 0.05;
      leanY = v2.dr * p.effort * ts * 0.05;
    }

    ctx.save();
    ctx.translate(cx + leanX, cy + bob + leanY);

    // shadow
    ctx.beginPath();
    ctx.ellipse(0, size * 0.42, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    var rot = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[p.facing] || Math.PI / 2;

    // body
    var bodyGrad = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
    bodyGrad.addColorStop(0, '#eef2f7');
    bodyGrad.addColorStop(1, '#aab6c8');
    ctx.fillStyle = bodyGrad;
    this._roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(15,20,30,0.55)';
    ctx.lineWidth = Math.max(1, ts * 0.03);
    ctx.stroke();

    // copper trim stripe across the "chest"
    ctx.fillStyle = '#e0a458';
    this._roundRect(ctx, -size * 0.42, size * 0.06, size * 0.84, size * 0.1, size * 0.05);
    ctx.fill();

    // directional visor (eye) showing facing
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    var eyeR = size * 0.16;
    ctx.arc(size * 0.18, 0, eyeR, 0, Math.PI * 2);
    var visorGlow = this.motion ? (0.7 + Math.sin(now / 300) * 0.2) : 0.85;
    ctx.fillStyle = 'rgba(124,249,196,' + visorGlow + ')';
    ctx.shadowColor = '#7CF9C4';
    ctx.shadowBlur = size * 0.3;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // antenna with idle blink
    var blink = this.motion ? (Math.sin(now / 700 + this.idlePhase) * 0.5 + 0.5) : 0.6;
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, -size / 2 - size * 0.18);
    ctx.strokeStyle = 'rgba(180,196,214,0.9)';
    ctx.lineWidth = Math.max(1, ts * 0.025);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -size / 2 - size * 0.18, size * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(224,164,88,' + (0.5 + blink * 0.5) + ')';
    ctx.fill();

    ctx.restore();
  };

  LumenRenderer.prototype._drawSparks = function (ctx, ts, now) {
    var self = this;
    this.sparks = this.sparks.filter(function (s) { return now - s.born < 500; });
    if (!this.motion) { this.sparks.length = 0; return; }
    this.sparks.forEach(function (s) {
      var age = (now - s.born) / 500;
      var x = (s.x + s.vx * age) * ts;
      var y = (s.y + s.vy * age) * ts;
      var alpha = 1 - age;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, ts * 0.045 * (1 - age)), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(124,249,196,' + alpha + ')';
      ctx.fill();
    });
  };

  LumenRenderer.prototype._drawCompletionOverlay = function (ctx, ts, now) {
    if (!this.completionEffect) return;
    var e = this.completionEffect;
    var t = clamp01((now - e.startTime) / e.duration);
    if (t >= 1) { return; }
    var boardW = this.boardW * ts, boardH = this.boardH * ts;
    var alpha = (1 - t) * 0.5;
    var g = ctx.createRadialGradient(
      boardW / 2, boardH / 2, 0,
      boardW / 2, boardH / 2, Math.max(boardW, boardH) * (0.3 + t * 0.9)
    );
    g.addColorStop(0, 'rgba(216,255,240,' + alpha + ')');
    g.addColorStop(1, 'rgba(124,249,196,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-ts, -ts, boardW + ts * 2, boardH + ts * 2);
  };

  root.LumenRenderer = LumenRenderer;
})(typeof window !== 'undefined' ? window : this);
