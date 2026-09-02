/* LUMEN YARD - the yard itself.
   Canvas presentation: copper bus lattice, relay cores, sockets, the LM-04
   maintenance unit, and the current that runs through all of it. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});

  var C = {
    void0: '#04060b',
    void1: '#0a1119',
    floor0: '#141d29',
    floor1: '#0e151f',
    seam: '#070b11',
    plateEdge: '#1e2b3a',
    wallFace: '#151f2b',
    wallTop: '#26364a',
    wallLip: '#3b5570',
    wallShadow: '#050810',
    copper: '#6d4a2b',
    copperHi: '#9c6a3c',
    live: '#7fe9ff',
    steel1: '#16202c',
    danger: '#ff7a52'
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function hash2(r, c, salt) {
    var h = (r * 374761393 + c * 668265263 + (salt || 0) * 2147483647) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 100000) / 100000;
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function Renderer(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.motion = true;
    this.dpr = 1;
    this.cell = 32;
    this.ox = 0;
    this.oy = 0;
    this.cssW = 0;
    this.cssH = 0;
    this.static = document.createElement('canvas');
    this.staticCtx = this.static.getContext('2d');
    this.staticKey = '';
    this.anim = null;
    this.effects = [];
    this.segEnergy = Object.create(null);
    this.network = null;
    this.shake = 0;
    this.intro = true;
    this.dawn = false;
    this.inset = 0;
    this.completeAt = -1;
    this.cheerAt = -1;
    this.facing = 'down';
    this.ambient = 0;
    this.surgeWave = null;
    this.rebuildNetwork();
  }

  /* ---------------------------------------------------------------- layout */

  Renderer.prototype.resize = function () {
    var rect = this.canvas.parentNode.getBoundingClientRect();
    var w = Math.max(80, Math.floor(rect.width));
    var h = Math.max(80, Math.floor(rect.height));
    var dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.static.width = this.canvas.width;
    this.static.height = this.canvas.height;

    var lv = this.game.level;
    var pad = Math.max(6, Math.min(w, h) * 0.02);
    // Keep the whole yard clear of whatever the shell is showing along the bottom.
    var avail = Math.max(h * 0.45, h - this.inset);
    var cell = Math.floor(Math.min((w - pad * 2) / lv.width, (avail - pad * 2) / lv.height));
    cell = Math.max(14, Math.min(cell, 108));
    this.cell = cell;
    this.ox = Math.round((w - cell * lv.width) / 2);
    this.oy = Math.round((avail - cell * lv.height) / 2);
    this.staticKey = '';
  };

  Renderer.prototype.cellFromPoint = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var x = clientX - rect.left - this.ox;
    var y = clientY - rect.top - this.oy;
    return { row: Math.floor(y / this.cell), col: Math.floor(x / this.cell) };
  };

  Renderer.prototype.setInset = function (px) {
    var next = Math.max(0, Math.round(px || 0));
    if (next === this.inset) return;
    this.inset = next;
    this.resize();
  };

  Renderer.prototype.setMotion = function (on) { this.motion = !!on; };
  Renderer.prototype.setDawn = function (on) { this.dawn = !!on; };

  /* --------------------------------------------------------- bus network */

  /* The yard is wired like a switchyard, not like a mesh: a main bus along the
     service aisle, a header bus under the socket bank, and vertical feeders
     between them. Every floor cell ends up fed from the one source post. */
  Renderer.prototype.rebuildNetwork = function () {
    var g = this.game;
    var lv = g.level;
    var W = lv.width, H = lv.height;
    var idx = function (r, c) { return r * W + c; };
    var isFloor = function (r, c) {
      return r >= 0 && c >= 0 && r < H && c < W && !lv.wallGrid[r][c];
    };
    var floors = [];
    var r, c;
    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) if (isFloor(r, c)) floors.push(idx(r, c));
    }

    var segs = Object.create(null);
    function add(a, b, kind) {
      var key = Math.min(a, b) + ':' + Math.max(a, b);
      if (!segs[key]) segs[key] = { a: a, b: b, kind: kind };
      else if (kind === 'bus') segs[key].kind = 'bus';
    }

    for (r = 0; r < H; r++) {
      for (c = 0; c < W; c++) {
        if (isFloor(r, c) && isFloor(r + 1, c)) add(idx(r, c), idx(r + 1, c), 'feed');
      }
    }
    var headerRow = H;
    for (var gi = 0; gi < lv.goals.length; gi++) headerRow = Math.min(headerRow, lv.goals[gi].row);
    var busRows = [headerRow, H - 2];
    for (var bi = 0; bi < busRows.length; bi++) {
      var br = busRows[bi];
      for (c = 0; c < W - 1; c++) {
        if (isFloor(br, c) && isFloor(br, c + 1)) add(idx(br, c), idx(br, c + 1), 'bus');
      }
    }

    var source = floors[0];
    for (var f = 0; f < floors.length; f++) {
      var fr = (floors[f] / W) | 0;
      if (fr === H - 2) { source = floors[f]; break; }
    }

    function adjacency() {
      var adj = Object.create(null);
      for (var key in segs) {
        var s = segs[key];
        (adj[s.a] || (adj[s.a] = [])).push(s.b);
        (adj[s.b] || (adj[s.b] = [])).push(s.a);
      }
      return adj;
    }
    function reachable() {
      var adj = adjacency();
      var seen = Object.create(null);
      var q = [source];
      seen[source] = true;
      var h = 0;
      while (h < q.length) {
        var cur = q[h++];
        var list = adj[cur] || [];
        for (var i = 0; i < list.length; i++) {
          if (!seen[list[i]]) { seen[list[i]] = true; q.push(list[i]); }
        }
      }
      return seen;
    }
    // Any pocket the buses miss gets a short horizontal tie-in.
    for (var pass = 0; pass < 12; pass++) {
      var seen = reachable();
      var missing = floors.filter(function (cell) { return !seen[cell]; });
      if (!missing.length) break;
      var added = false;
      for (var m = 0; m < missing.length; m++) {
        var mr = (missing[m] / W) | 0, mc = missing[m] % W;
        if (isFloor(mr, mc - 1)) { add(missing[m], idx(mr, mc - 1), 'tie'); added = true; }
        if (isFloor(mr, mc + 1)) { add(missing[m], idx(mr, mc + 1), 'tie'); added = true; }
      }
      if (!added) break;
    }

    var keys = Object.keys(segs);
    var adjFinal = Object.create(null);
    var degree = Object.create(null);
    for (var k2 = 0; k2 < keys.length; k2++) {
      var sg = segs[keys[k2]];
      (adjFinal[sg.a] || (adjFinal[sg.a] = [])).push(sg.b);
      (adjFinal[sg.b] || (adjFinal[sg.b] = [])).push(sg.a);
      degree[sg.a] = (degree[sg.a] || 0) + 1;
      degree[sg.b] = (degree[sg.b] || 0) + 1;
    }

    var parent = Object.create(null);
    var depth = Object.create(null);
    var queue = [source];
    parent[source] = -1;
    depth[source] = 0;
    var head = 0;
    while (head < queue.length) {
      var cur2 = queue[head++];
      var nbrs = adjFinal[cur2] || [];
      for (var n2 = 0; n2 < nbrs.length; n2++) {
        if (!(nbrs[n2] in parent)) {
          parent[nbrs[n2]] = cur2;
          depth[nbrs[n2]] = depth[cur2] + 1;
          queue.push(nbrs[n2]);
        }
      }
    }

    var srcRow = (source / W) | 0, srcCol = source % W;
    this._feeder = {
      row: srcRow,
      col: srcCol - 1 >= 0 && lv.wallGrid[srcRow][srcCol - 1] ? srcCol - 1 : srcCol + 1,
      anchorRow: srcRow,
      anchorCol: srcCol
    };

    this.network = {
      W: W, H: H, source: source, parent: parent, depth: depth,
      segs: segs, keys: keys, floors: floors, degree: degree
    };
    this.segEnergy = Object.create(null);
    this._scenery = null;
    this.syncEnergy(true);
  };

  Renderer.prototype.pathToSource = function (cellIndex) {
    var net = this.network;
    var out = [];
    var cur = cellIndex;
    var guard = 0;
    while (net.parent[cur] !== undefined && net.parent[cur] !== -1 && guard++ < 500) {
      var p = net.parent[cur];
      out.push(Math.min(cur, p) + ':' + Math.max(cur, p));
      cur = p;
    }
    return out;
  };

  /* Light the cables that feed every powered socket, running outward in time. */
  Renderer.prototype.syncEnergy = function (instant) {
    var g = this.game;
    var net = this.network;
    var W = net.W;
    var now = performance.now();
    var wanted = Object.create(null);
    var complete = g.phase === 'complete';

    if (complete) {
      for (var k = 0; k < net.keys.length; k++) wanted[net.keys[k]] = 0;
    }
    for (var i = 0; i < g.crates.length; i++) {
      var cr = g.crates[i];
      if (!g.isGoal(cr.row, cr.col)) continue;
      var path = this.pathToSource(cr.row * W + cr.col);
      for (var j = 0; j < path.length; j++) {
        if (!(path[j] in wanted) || wanted[path[j]] > j) wanted[path[j]] = j;
      }
    }
    for (var key in this.segEnergy) {
      if (!(key in wanted)) this.segEnergy[key].target = 0;
    }
    for (var key2 in wanted) {
      var e = this.segEnergy[key2];
      var delay = instant || !this.motion ? 0 : wanted[key2] * 26;
      if (!e) {
        e = this.segEnergy[key2] = { v: instant ? 1 : 0, target: 1, start: now + delay };
      } else {
        if (e.target === 0) e.start = now + delay;
        e.target = 1;
      }
    }
  };

  /* ------------------------------------------------------------- events */

  Renderer.prototype.onEvent = function (evt) {
    var cell = this.cell;
    var now = performance.now();
    if (evt.type === 'move') {
      var plan = evt.plan;
      this.facing = plan.direction;
      this.intro = false;
      var dur = this.motion ? (plan.pushed ? 170 : 130) : 0;
      if (evt.source === 'arena') dur = 0;
      this.anim = {
        kind: 'move',
        t0: now,
        dur: dur,
        dir: plan.direction,
        pushed: plan.pushed,
        player: { fr: plan.from.row, fc: plan.from.col, tr: plan.to.row, tc: plan.to.col },
        crate: plan.pushed
          ? { key: plan.crateTo.row + ',' + plan.crateTo.col, fr: plan.crateFrom.row, fc: plan.crateFrom.col, tr: plan.crateTo.row, tc: plan.crateTo.col }
          : null
      };
      this.addDust(plan.from.row, plan.from.col, plan.direction);
      if (plan.pushed) {
        this.shake = this.motion ? Math.min(3.5, cell * 0.045) : 0;
        this.addSparks(plan.crateFrom.row, plan.crateFrom.col, plan.direction, 5);
      }
      if (plan.seats) {
        this.effects.push({ kind: 'seat', row: plan.crateTo.row, col: plan.crateTo.col, t0: now + dur * 0.6, dur: 700 });
        this.cheerAt = now + dur * 0.6;
      }
      this.syncEnergy(false);
      if (evt.completed) {
        this.completeAt = now + dur;
        this.surgeWave = { t0: now + dur, row: plan.crateTo ? plan.crateTo.row : plan.to.row, col: plan.crateTo ? plan.crateTo.col : plan.to.col };
        this.syncEnergy(false);
      }
    } else if (evt.type === 'blocked') {
      var d = LY.DIRECTIONS[evt.direction];
      if (d) {
        this.facing = evt.direction;
        this.anim = { kind: 'refuse', t0: now, dur: this.motion ? 220 : 90, dir: evt.direction };
        this.effects.push({
          kind: 'refuse', t0: now, dur: 420,
          row: this.game.player.row + d.dr, col: this.game.player.col + d.dc
        });
      }
      this.intro = false;
    } else if (evt.type === 'undo') {
      this.intro = false;
      var from = evt.from;
      var dur2 = this.motion ? 160 : 0;
      if (evt.source === 'arena') dur2 = 0;
      this.anim = {
        kind: 'rewind',
        t0: now, dur: dur2,
        player: { fr: from.player.row, fc: from.player.col, tr: this.game.player.row, tc: this.game.player.col },
        crate: null
      };
      // find the relay that moved back, if any
      for (var i = 0; i < from.crates.length; i++) {
        var a = from.crates[i];
        var still = false;
        for (var j = 0; j < this.game.crates.length; j++) {
          if (this.game.crates[j].row === a.row && this.game.crates[j].col === a.col) { still = true; break; }
        }
        if (!still) {
          // matching new position: the one not present in the old set
          for (var m = 0; m < this.game.crates.length; m++) {
            var b = this.game.crates[m];
            var wasThere = false;
            for (var n2 = 0; n2 < from.crates.length; n2++) {
              if (from.crates[n2].row === b.row && from.crates[n2].col === b.col) { wasThere = true; break; }
            }
            if (!wasThere) {
              this.anim.crate = { key: b.row + ',' + b.col, fr: a.row, fc: a.col, tr: b.row, tc: b.col };
              break;
            }
          }
          break;
        }
      }
      this.completeAt = -1;
      this.surgeWave = null;
      this.effects.push({ kind: 'rewind', t0: now, dur: 500 });
      this.syncEnergy(false);
    } else if (evt.type === 'restart' || evt.type === 'level' || evt.type === 'reset') {
      this.anim = null;
      this.effects.length = 0;
      this.completeAt = -1;
      this.surgeWave = null;
      this.cheerAt = -1;
      this.facing = 'down';
      this.shake = 0;
      this.staticKey = '';
      this.rebuildNetwork();
      this.resize();
      if (evt.type !== 'reset') this.intro = false;
    }
  };

  Renderer.prototype.addDust = function (row, col, dir) {
    if (!this.motion) return;
    var d = LY.DIRECTIONS[dir];
    for (var i = 0; i < 4; i++) {
      this.effects.push({
        kind: 'dust', t0: performance.now(), dur: 380 + i * 30,
        row: row, col: col,
        vx: -d.dc * (0.25 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.3,
        vy: -d.dr * (0.25 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.3 - 0.1
      });
    }
  };

  /* Answer to a tap on a tile the unit cannot reach in one step. */
  Renderer.prototype.hintLegal = function () {
    var g = this.game;
    if (g.phase !== 'playing') return;
    var now = performance.now();
    for (var i = 0; i < LY.DIRECTION_ORDER.length; i++) {
      var dir = LY.DIRECTION_ORDER[i];
      if (!g.probeMove(dir)) continue;
      var d = LY.DIRECTIONS[dir];
      this.effects.push({
        kind: 'hint', t0: now + i * 40, dur: 620,
        row: g.player.row + d.dr, col: g.player.col + d.dc
      });
    }
  };

  Renderer.prototype.addSparks = function (row, col, dir, n) {
    if (!this.motion) return;
    for (var i = 0; i < n; i++) {
      this.effects.push({
        kind: 'spark', t0: performance.now(), dur: 260 + Math.random() * 220,
        row: row, col: col,
        vx: (Math.random() - 0.5) * 1.1,
        vy: (Math.random() - 0.5) * 1.1 - 0.2
      });
    }
  };

  /* --------------------------------------------------------- static layer */

  Renderer.prototype.buildStatic = function () {
    var g = this.game;
    var lv = g.level;
    var ctx = this.staticCtx;
    var cell = this.cell;
    var ox = this.ox, oy = this.oy;
    var W = this.cssW, H = this.cssH;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#080e18');
    sky.addColorStop(0.55, C.void1);
    sky.addColorStop(1, C.void0);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // distant yard haze behind the slab
    var haze = ctx.createRadialGradient(
      ox + cell * lv.width * 0.5, oy + cell * lv.height * 0.35, cell * 0.5,
      ox + cell * lv.width * 0.5, oy + cell * lv.height * 0.35, cell * lv.width * 0.75
    );
    haze.addColorStop(0, 'rgba(46,96,124,0.20)');
    haze.addColorStop(1, 'rgba(6,12,20,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);

    this.paintScenery(ctx);

    // concrete slab under the whole yard
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = cell * 0.7;
    ctx.shadowOffsetY = cell * 0.16;
    ctx.fillStyle = '#0b121b';
    roundRect(ctx, ox - cell * 0.16, oy - cell * 0.16, cell * lv.width + cell * 0.32, cell * lv.height + cell * 0.32, cell * 0.22);
    ctx.fill();
    ctx.restore();

    var r, c;
    for (r = 0; r < lv.height; r++) {
      for (c = 0; c < lv.width; c++) {
        if (!lv.wallGrid[r][c]) this.paintFloor(ctx, r, c);
      }
    }
    this.paintLattice(ctx);
    for (r = 0; r < lv.height; r++) {
      for (c = 0; c < lv.width; c++) {
        if (lv.wallGrid[r][c]) this.paintWall(ctx, r, c);
      }
    }
    for (var i = 0; i < lv.goals.length; i++) {
      this.paintSocketBase(ctx, lv.goals[i].row, lv.goals[i].col);
    }
    this.paintFeeder(ctx);
    this.staticKey = lv.id + '|' + cell + '|' + this.cssW + 'x' + this.cssH;
  };

  Renderer.prototype.cx = function (col) { return this.ox + (col + 0.5) * this.cell; };
  Renderer.prototype.cy = function (row) { return this.oy + (row + 0.5) * this.cell; };

  Renderer.prototype.paintFloor = function (ctx, r, c) {
    var cell = this.cell;
    var x = this.ox + c * cell, y = this.oy + r * cell;
    var n = hash2(r, c, 1);
    var g = ctx.createLinearGradient(x, y, x, y + cell);
    g.addColorStop(0, C.floor0);
    g.addColorStop(1, C.floor1);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);

    ctx.fillStyle = 'rgba(255,255,255,' + (0.012 + n * 0.016).toFixed(3) + ')';
    roundRect(ctx, x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.08);
    ctx.fill();

    ctx.strokeStyle = 'rgba(6,10,16,0.85)';
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    ctx.strokeStyle = 'rgba(90,130,160,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + cell * 0.06, y + cell * 0.06);
    ctx.lineTo(x + cell * 0.94, y + cell * 0.06);
    ctx.stroke();

    // rivets
    if (n > 0.35) {
      ctx.fillStyle = 'rgba(150,180,205,0.10)';
      var rr = Math.max(0.9, cell * 0.022);
      var off = cell * 0.14;
      var pts = [[x + off, y + off], [x + cell - off, y + off], [x + off, y + cell - off], [x + cell - off, y + cell - off]];
      for (var i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // occasional painted hazard chevron / drain grate
    var n2 = hash2(r, c, 7);
    if (n2 > 0.90) {
      ctx.strokeStyle = 'rgba(190,140,60,0.13)';
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.beginPath();
      for (var k = 0; k < 3; k++) {
        ctx.moveTo(x + cell * (0.22 + k * 0.2), y + cell * 0.72);
        ctx.lineTo(x + cell * (0.32 + k * 0.2), y + cell * 0.58);
      }
      ctx.stroke();
    } else if (n2 < 0.07) {
      ctx.strokeStyle = 'rgba(10,16,24,0.9)';
      ctx.lineWidth = Math.max(1, cell * 0.035);
      ctx.beginPath();
      for (var m = 0; m < 3; m++) {
        ctx.moveTo(x + cell * 0.3, y + cell * (0.38 + m * 0.12));
        ctx.lineTo(x + cell * 0.7, y + cell * (0.38 + m * 0.12));
      }
      ctx.stroke();
    }
  };

  Renderer.prototype.segWidth = function (kind) {
    return this.cell * (kind === 'bus' ? 0.085 : 0.045);
  };

  Renderer.prototype.paintLattice = function (ctx) {
    var net = this.network;
    var cell = this.cell;
    var W = net.W;
    var i, s, ar, ac, br, bc, x1, y1, x2, y2;
    ctx.lineCap = 'round';

    // recessed channel the bar sits in
    for (i = 0; i < net.keys.length; i++) {
      s = net.segs[net.keys[i]];
      ar = (s.a / W) | 0; ac = s.a % W; br = (s.b / W) | 0; bc = s.b % W;
      x1 = this.cx(ac); y1 = this.cy(ar); x2 = this.cx(bc); y2 = this.cy(br);
      ctx.strokeStyle = 'rgba(3,6,11,0.9)';
      ctx.lineWidth = this.segWidth(s.kind) + cell * 0.05;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    for (i = 0; i < net.keys.length; i++) {
      s = net.segs[net.keys[i]];
      ar = (s.a / W) | 0; ac = s.a % W; br = (s.b / W) | 0; bc = s.b % W;
      x1 = this.cx(ac); y1 = this.cy(ar); x2 = this.cx(bc); y2 = this.cy(br);
      var w = this.segWidth(s.kind);
      ctx.strokeStyle = s.kind === 'bus' ? '#7d5530' : C.copper;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // brushed highlight along the top edge of the bar
      ctx.strokeStyle = 'rgba(226,170,110,0.20)';
      ctx.lineWidth = Math.max(0.8, w * 0.3);
      ctx.beginPath();
      var nx = (y2 - y1) === 0 ? 0 : w * 0.22;
      var ny = (x2 - x1) === 0 ? 0 : -w * 0.22;
      ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny);
      ctx.stroke();
    }
    // bolted junctions, bigger where the yard branches
    for (var f = 0; f < net.floors.length; f++) {
      var cellIdx = net.floors[f];
      var deg = net.degree[cellIdx] || 0;
      var fr = (cellIdx / W) | 0, fc = cellIdx % W;
      var x = this.cx(fc), y = this.cy(fr);
      if (deg < 2) {
        // a run that stops at a wall is terminated, not cut off
        ctx.fillStyle = '#0a1017';
        ctx.beginPath(); ctx.arc(x, y, cell * 0.085, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8d9aa4';
        roundRect(ctx, x - cell * 0.07, y - cell * 0.035, cell * 0.14, cell * 0.07, cell * 0.03);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        roundRect(ctx, x - cell * 0.06, y - cell * 0.028, cell * 0.12, cell * 0.02, cell * 0.01);
        ctx.fill();
        continue;
      }
      var rr = cell * (deg >= 3 ? 0.062 : 0.045);
      ctx.fillStyle = '#090e15';
      ctx.beginPath(); ctx.arc(x, y, rr + cell * 0.014, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a5f36';
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,214,168,0.28)';
      ctx.beginPath(); ctx.arc(x - rr * 0.25, y - rr * 0.3, rr * 0.42, 0, Math.PI * 2); ctx.fill();
    }
  };

  Renderer.prototype.paintWall = function (ctx, r, c) {
    var cell = this.cell;
    var lv = this.game.level;
    var x = this.ox + c * cell, y = this.oy + r * cell;
    var lip = cell * 0.22;
    var n = hash2(r, c, 3);
    var openBelow = r + 1 < lv.height && !lv.wallGrid[r + 1][c];

    ctx.fillStyle = C.wallShadow;
    ctx.fillRect(x, y, cell, cell + (openBelow ? cell * 0.12 : 0));

    var face = ctx.createLinearGradient(x, y, x, y + cell);
    face.addColorStop(0, C.wallTop);
    face.addColorStop(0.35, '#1d2939');
    face.addColorStop(1, C.wallFace);
    ctx.fillStyle = face;
    ctx.fillRect(x, y, cell, cell);

    // top lip catching the yard light
    var top = ctx.createLinearGradient(x, y, x, y + lip);
    top.addColorStop(0, C.wallLip);
    top.addColorStop(1, 'rgba(59,85,112,0)');
    ctx.fillStyle = top;
    ctx.fillRect(x, y, cell, lip);

    ctx.strokeStyle = 'rgba(2,5,9,0.9)';
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

    if (n > 0.78) {
      // hazard band
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + cell * 0.1, y + cell * 0.42, cell * 0.8, cell * 0.18);
      ctx.clip();
      ctx.fillStyle = 'rgba(120,88,30,0.55)';
      ctx.fillRect(x + cell * 0.1, y + cell * 0.42, cell * 0.8, cell * 0.18);
      ctx.strokeStyle = 'rgba(18,22,28,0.85)';
      ctx.lineWidth = cell * 0.07;
      ctx.beginPath();
      for (var i = -1; i < 7; i++) {
        ctx.moveTo(x + cell * (0.1 + i * 0.16), y + cell * 0.62);
        ctx.lineTo(x + cell * (0.22 + i * 0.16), y + cell * 0.40);
      }
      ctx.stroke();
      ctx.restore();
    } else if (n > 0.5) {
      // louvred vent
      ctx.strokeStyle = 'rgba(6,10,16,0.8)';
      ctx.lineWidth = Math.max(1, cell * 0.045);
      ctx.beginPath();
      for (var v = 0; v < 3; v++) {
        ctx.moveTo(x + cell * 0.24, y + cell * (0.42 + v * 0.15));
        ctx.lineTo(x + cell * 0.76, y + cell * (0.42 + v * 0.15));
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,160,190,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // conduit pins
    ctx.fillStyle = 'rgba(150,180,205,0.13)';
    var pr = Math.max(0.9, cell * 0.022);
    ctx.beginPath(); ctx.arc(x + cell * 0.13, y + cell * 0.12, pr, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + cell * 0.87, y + cell * 0.12, pr, 0, Math.PI * 2); ctx.fill();
  };

  /* Glass panes on the top wall: the sleeping rooms beyond the yard. */
  Renderer.prototype.windowCells = function () {
    if (this._windows && this._windowsFor === this.game.level.id) return this._windows;
    var lv = this.game.level;
    var out = [];
    for (var c = 1; c < lv.width - 1; c++) {
      if (lv.wallGrid[0][c] && hash2(0, c, 11) > 0.42) out.push({ row: 0, col: c });
    }
    this._windows = out;
    this._windowsFor = lv.id;
    return out;
  };

  Renderer.prototype.paintSocketBase = function (ctx, r, c) {
    var cell = this.cell;
    var x = this.cx(c), y = this.cy(r);
    var R = cell * 0.36;
    ctx.save();
    ctx.fillStyle = '#070c12';
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    var bowl = ctx.createRadialGradient(x, y - R * 0.3, R * 0.15, x, y, R);
    bowl.addColorStop(0, '#131c26');
    bowl.addColorStop(1, '#050a10');
    ctx.fillStyle = bowl;
    ctx.beginPath(); ctx.arc(x, y, R * 0.92, 0, Math.PI * 2); ctx.fill();
    // copper contact ring
    ctx.strokeStyle = C.copperHi;
    ctx.lineWidth = cell * 0.05;
    ctx.beginPath(); ctx.arc(x, y, R * 0.72, 0, Math.PI * 2); ctx.stroke();
    // three prongs
    ctx.strokeStyle = '#c98b4b';
    ctx.lineWidth = cell * 0.045;
    ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * R * 0.3, y + Math.sin(a) * R * 0.3);
      ctx.lineTo(x + Math.cos(a) * R * 0.62, y + Math.sin(a) * R * 0.62);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* The feeder post: where the yard's current comes in from outside. */
  Renderer.prototype.paintFeeder = function (ctx) {
    var cell = this.cell;
    var fd = this._feeder;
    if (!fd) return;
    var x = this.ox + fd.col * cell;
    var y = this.oy + fd.row * cell;
    var toward = fd.col < fd.anchorCol ? 1 : -1;
    ctx.save();
    // cabinet
    var cab = ctx.createLinearGradient(x, y, x + cell, y + cell);
    cab.addColorStop(0, '#31465c');
    cab.addColorStop(1, '#131d29');
    ctx.fillStyle = cab;
    roundRect(ctx, x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,190,220,0.3)';
    ctx.lineWidth = Math.max(1, cell * 0.028);
    ctx.stroke();
    // meter window
    ctx.fillStyle = '#060c13';
    roundRect(ctx, x + cell * 0.24, y + cell * 0.24, cell * 0.52, cell * 0.26, cell * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(127,233,255,0.35)';
    ctx.lineWidth = Math.max(1, cell * 0.02);
    ctx.beginPath();
    ctx.moveTo(x + cell * 0.29, y + cell * 0.42);
    ctx.lineTo(x + cell * 0.4, y + cell * 0.42);
    ctx.lineTo(x + cell * 0.45, y + cell * 0.3);
    ctx.lineTo(x + cell * 0.53, y + cell * 0.45);
    ctx.lineTo(x + cell * 0.58, y + cell * 0.37);
    ctx.lineTo(x + cell * 0.71, y + cell * 0.37);
    ctx.stroke();
    // ceramic insulators feeding the yard
    ctx.fillStyle = '#9aa7ae';
    for (var i = 0; i < 2; i++) {
      var iy = y + cell * (0.58 + i * 0.13);
      roundRect(ctx, x + cell * 0.3, iy, cell * 0.4, cell * 0.07, cell * 0.035);
      ctx.fill();
    }
    // takeoff bar toward the first junction
    ctx.strokeStyle = C.copperHi;
    ctx.lineWidth = cell * 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + cell * (toward > 0 ? 0.7 : 0.3), y + cell * 0.62);
    ctx.lineTo(x + cell * (toward > 0 ? 1.0 : 0.0), y + cell * 0.5);
    ctx.stroke();
    ctx.restore();
  };

  /* Everything past the fence: pylons, low sheds, and the greenhouse row that
     the yard is meant to wake. */
  Renderer.prototype.buildScenery = function () {
    var W = this.cssW, H = this.cssH;
    var top = this.oy;
    var bottom = H - (this.oy + this.cell * this.game.level.height);
    var pylons = [];
    var sheds = [];
    var stars = [];
    var i;
    if (top > 46) {
      var band = Math.min(top - 14, this.cell * 2.1);
      var n = Math.max(2, Math.round(W / 190));
      for (i = 0; i < n; i++) {
        var px = (i + 0.5) * (W / n) + (hash2(i, 3, 21) - 0.5) * W * 0.12;
        var ph = band * (0.62 + hash2(i, 9, 22) * 0.38);
        pylons.push({ x: px, base: top - 8, h: ph, w: ph * 0.42 });
      }
      for (i = 0; i < 26; i++) {
        stars.push({
          x: hash2(i, 1, 31) * W,
          y: hash2(i, 2, 32) * Math.max(10, top - 16),
          a: 0.1 + hash2(i, 3, 33) * 0.3
        });
      }
    }
    var ground = -1;
    if (bottom > 44) {
      ground = H - Math.min(bottom * 0.42, 16);
      var count = Math.max(3, Math.round(W / 118));
      for (i = 0; i < count; i++) {
        var slot = W / count;
        var sw = slot * (0.56 + hash2(i, 5, 41) * 0.3);
        var sh = Math.min(bottom - 22, 13 + hash2(i, 6, 42) * 20);
        sheds.push({
          x: (i + 0.5) * slot - sw / 2,
          y: ground - sh,
          w: sw,
          h: sh,
          roof: sh * (0.3 + hash2(i, 8, 44) * 0.25),
          panes: 3 + Math.floor(hash2(i, 7, 43) * 3)
        });
      }
    }
    this._scenery = { pylons: pylons, sheds: sheds, stars: stars, ground: ground };
    return this._scenery;
  };

  Renderer.prototype.paintScenery = function (ctx) {
    var sc = this.buildScenery();
    var i, j;
    for (i = 0; i < sc.stars.length; i++) {
      var st = sc.stars[i];
      ctx.fillStyle = 'rgba(200,225,245,' + st.a.toFixed(3) + ')';
      ctx.fillRect(st.x, st.y, 1.4, 1.4);
    }
    for (i = 0; i < sc.pylons.length; i++) {
      var p = sc.pylons[i];
      ctx.save();
      ctx.strokeStyle = 'rgba(24,36,50,0.95)';
      ctx.lineWidth = Math.max(1, p.h * 0.035);
      ctx.beginPath();
      ctx.moveTo(p.x - p.w / 2, p.base);
      ctx.lineTo(p.x - p.w * 0.14, p.base - p.h);
      ctx.moveTo(p.x + p.w / 2, p.base);
      ctx.lineTo(p.x + p.w * 0.14, p.base - p.h);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, p.h * 0.02);
      ctx.beginPath();
      for (j = 1; j < 6; j++) {
        var t = j / 6;
        var half = (p.w / 2) * (1 - t) + p.w * 0.14 * t;
        var yy = p.base - p.h * t;
        ctx.moveTo(p.x - half, yy);
        ctx.lineTo(p.x + half, yy);
        if (j < 5) {
          var t2 = (j + 1) / 6;
          var half2 = (p.w / 2) * (1 - t2) + p.w * 0.14 * t2;
          ctx.moveTo(p.x - half, yy);
          ctx.lineTo(p.x + half2, p.base - p.h * t2);
        }
      }
      ctx.stroke();
      // cross arms
      ctx.lineWidth = Math.max(1, p.h * 0.028);
      ctx.beginPath();
      ctx.moveTo(p.x - p.w * 0.62, p.base - p.h * 0.82);
      ctx.lineTo(p.x + p.w * 0.62, p.base - p.h * 0.82);
      ctx.stroke();
      ctx.restore();
    }
    // the greenhouse row the yard is meant to wake
    if (sc.ground > 0) {
      var gsky = ctx.createLinearGradient(0, sc.ground - 26, 0, this.cssH);
      gsky.addColorStop(0, 'rgba(20,34,48,0)');
      gsky.addColorStop(1, 'rgba(6,11,18,0.9)');
      ctx.fillStyle = gsky;
      ctx.fillRect(0, sc.ground - 26, this.cssW, this.cssH - sc.ground + 26);
      ctx.strokeStyle = 'rgba(58,84,110,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sc.ground + 0.5);
      ctx.lineTo(this.cssW, sc.ground + 0.5);
      ctx.stroke();
    }
    for (i = 0; i < sc.sheds.length; i++) {
      var s = sc.sheds[i];
      ctx.fillStyle = '#0b131c';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + s.h);
      ctx.lineTo(s.x, s.y + s.roof);
      ctx.lineTo(s.x + s.w / 2, s.y);
      ctx.lineTo(s.x + s.w, s.y + s.roof);
      ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(96,132,164,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x - 1, s.y + s.roof);
      ctx.lineTo(s.x + s.w / 2, s.y - 1);
      ctx.lineTo(s.x + s.w + 1, s.y + s.roof);
      ctx.stroke();
      // glazing bars
      ctx.strokeStyle = 'rgba(70,100,128,0.22)';
      for (j = 1; j < s.panes; j++) {
        var gx = s.x + (s.w * j) / s.panes;
        ctx.beginPath();
        ctx.moveTo(gx, s.y + s.roof);
        ctx.lineTo(gx, s.y + s.h);
        ctx.stroke();
      }
    }
  };

  /* --------------------------------------------------------------- frame */

  Renderer.prototype.animProgress = function (now) {
    if (!this.anim) return 1;
    if (this.anim.dur <= 0) return 1;
    return clamp((now - this.anim.t0) / this.anim.dur, 0, 1);
  };

  Renderer.prototype.draw = function (now) {
    var g = this.game;
    var lv = g.level;
    var ctx = this.ctx;
    var cell = this.cell;
    var key = lv.id + '|' + cell + '|' + this.cssW + 'x' + this.cssH;
    if (this.staticKey !== key) this.buildStatic();

    var p = this.animProgress(now);
    if (this.anim && p >= 1 && (this.anim.kind === 'move' || this.anim.kind === 'rewind')) this.anim = null;
    if (this.anim && p >= 1 && this.anim.kind === 'refuse') this.anim = null;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    var sx = 0, sy = 0;
    if (this.shake > 0.05) {
      sx = (Math.random() - 0.5) * this.shake * 2;
      sy = (Math.random() - 0.5) * this.shake * 2;
      this.shake *= 0.82;
    } else this.shake = 0;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.drawImage(this.static, 0, 0, this.cssW, this.cssH);

    // energy relaxation
    var complete = g.phase === 'complete';
    for (var k in this.segEnergy) {
      var e = this.segEnergy[k];
      if (now >= e.start) {
        var rate = this.motion ? 0.14 : 1;
        e.v += (e.target - e.v) * rate;
      }
      if (e.target === 0 && e.v < 0.01) e.v = 0;
    }

    var powered = g.poweredGoals();
    var ratio = lv.goals.length ? powered / lv.goals.length : 0;
    this.ambient += ((complete ? 1 : ratio * 0.75) - this.ambient) * (this.motion ? 0.08 : 1);

    this.drawEnergy(ctx, now);
    this.drawSockets(ctx, now);
    this.drawCrates(ctx, now, p);
    this.drawRobot(ctx, now, p);
    this.drawEffects(ctx, now);
    this.drawNight(ctx, now);
    this.drawSurge(ctx, now);
    if (this.intro) this.drawIntroTremble(ctx, now);
    ctx.restore();
  };

  Renderer.prototype.drawEnergy = function (ctx, now) {
    var net = this.network;
    var cell = this.cell;
    var W = net.W;
    var flow = this.motion ? (now / 24) % 1000 : 0;
    ctx.save();
    ctx.lineCap = 'round';
    for (var key in this.segEnergy) {
      var e = this.segEnergy[key];
      if (e.v <= 0.02) continue;
      var s = net.segs[key];
      if (!s) continue;
      var ar = (s.a / W) | 0, ac = s.a % W, br = (s.b / W) | 0, bc = s.b % W;
      var x1 = this.cx(ac), y1 = this.cy(ar), x2 = this.cx(bc), y2 = this.cy(br);
      ctx.globalAlpha = clamp(e.v, 0, 1);
      ctx.shadowColor = 'rgba(127,233,255,0.75)';
      ctx.shadowBlur = cell * 0.35 * e.v;
      ctx.strokeStyle = 'rgba(64,150,180,0.85)';
      ctx.lineWidth = cell * 0.07;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(190,247,255,0.95)';
      ctx.lineWidth = cell * 0.028;
      ctx.setLineDash([cell * 0.16, cell * 0.3]);
      ctx.lineDashOffset = -flow * cell * 0.02;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  Renderer.prototype.drawSockets = function (ctx, now) {
    var g = this.game;
    var cell = this.cell;
    var goals = g.level.goals;
    for (var i = 0; i < goals.length; i++) {
      var go = goals[i];
      var on = g.crateIndexAt(go.row, go.col) !== -1;
      var x = this.cx(go.col), y = this.cy(go.row);
      var R = cell * 0.36;
      ctx.save();
      if (on) {
        var glow = ctx.createRadialGradient(x, y, R * 0.1, x, y, R * 2.1);
        glow.addColorStop(0, 'rgba(140,240,255,0.42)');
        glow.addColorStop(0.5, 'rgba(80,190,230,0.15)');
        glow.addColorStop(1, 'rgba(60,160,210,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, R * 2.1, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(190,247,255,0.95)';
        ctx.lineWidth = cell * 0.05;
        ctx.beginPath(); ctx.arc(x, y, R * 0.86, 0, Math.PI * 2); ctx.stroke();
      } else {
        // empty socket: dashed collar + pilot lamp, readable without colour
        var pulse = this.motion ? 0.5 + 0.5 * Math.sin(now / 520 + i) : 0.7;
        ctx.strokeStyle = 'rgba(255,190,120,' + (0.35 + pulse * 0.3).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, cell * 0.035);
        ctx.setLineDash([cell * 0.1, cell * 0.09]);
        ctx.beginPath(); ctx.arc(x, y, R * 0.88, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,183,87,' + (0.4 + pulse * 0.45).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, cell * 0.055, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,170,0.5)';
        ctx.lineWidth = Math.max(1, cell * 0.02);
        ctx.beginPath();
        ctx.moveTo(x - cell * 0.11, y);
        ctx.lineTo(x - cell * 0.05, y);
        ctx.moveTo(x + cell * 0.05, y);
        ctx.lineTo(x + cell * 0.11, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Renderer.prototype.tweenPos = function (item, p) {
    var t = easeOut(p);
    return {
      row: lerp(item.fr, item.tr, t),
      col: lerp(item.fc, item.tc, t)
    };
  };

  Renderer.prototype.drawCrates = function (ctx, now, p) {
    var g = this.game;
    var moving = this.anim && this.anim.crate && p < 1 ? this.anim.crate : null;
    var list = [];
    for (var i = 0; i < g.crates.length; i++) {
      var cr = g.crates[i];
      var pos = { row: cr.row, col: cr.col };
      if (moving && moving.key === cr.row + ',' + cr.col) pos = this.tweenPos(moving, p);
      list.push({ pos: pos, seated: g.isGoal(cr.row, cr.col), settle: moving && moving.key === cr.row + ',' + cr.col ? p : 1 });
    }
    list.sort(function (a, b) { return a.pos.row - b.pos.row; });
    for (var j = 0; j < list.length; j++) {
      this.drawCore(ctx, list[j].pos, list[j].seated, now, list[j].settle);
    }
  };

  Renderer.prototype.drawCore = function (ctx, pos, seated, now, settle) {
    var cell = this.cell;
    var x = this.ox + (pos.col + 0.5) * cell;
    var y = this.oy + (pos.row + 0.5) * cell;
    var w = cell * 0.80, h = cell * 0.88;
    var settleSquash = settle < 1 && this.motion ? 1 + Math.sin(settle * Math.PI) * 0.05 : 1;
    var i;

    ctx.save();
    ctx.translate(x, y);

    // heavy contact shadow: these things weigh a tonne
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.ellipse(w * 0.05, h * 0.40, w * 0.52, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();

    if (seated) {
      // locking collar and clamps: a shape change, not only a colour change
      ctx.strokeStyle = 'rgba(206,250,255,0.92)';
      ctx.lineWidth = cell * 0.05;
      ctx.beginPath(); ctx.arc(0, h * 0.30, w * 0.56, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = cell * 0.055;
      for (i = 0; i < 4; i++) {
        var a = Math.PI / 4 + i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * w * 0.5, h * 0.30 + Math.sin(a) * w * 0.5);
        ctx.lineTo(Math.cos(a) * w * 0.68, h * 0.30 + Math.sin(a) * w * 0.68);
        ctx.stroke();
      }
    }

    ctx.scale(1, settleSquash);

    // cast base
    var bp = ctx.createLinearGradient(0, h * 0.08, 0, h * 0.4);
    bp.addColorStop(0, '#54697e');
    bp.addColorStop(0.35, '#33465a');
    bp.addColorStop(1, '#0d151f');
    ctx.fillStyle = bp;
    roundRect(ctx, -w * 0.5, h * 0.1, w, h * 0.3, cell * 0.06);
    ctx.fill();
    ctx.strokeStyle = 'rgba(2,5,9,0.95)';
    ctx.lineWidth = Math.max(1.2, cell * 0.032);
    ctx.stroke();
    // hex bolts on the base
    ctx.fillStyle = 'rgba(180,205,228,0.22)';
    for (i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-w * 0.3 + i * w * 0.3, h * 0.31, cell * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }

    // glass envelope
    var bodyTop = -h * 0.42, bodyH = h * 0.56;
    var body = ctx.createLinearGradient(-w * 0.44, 0, w * 0.44, 0);
    body.addColorStop(0, 'rgba(16,34,46,0.96)');
    body.addColorStop(0.22, 'rgba(70,118,138,0.85)');
    body.addColorStop(0.55, 'rgba(34,64,82,0.88)');
    body.addColorStop(0.86, 'rgba(58,100,122,0.8)');
    body.addColorStop(1, 'rgba(12,26,36,0.96)');
    ctx.fillStyle = body;
    roundRect(ctx, -w * 0.44, bodyTop, w * 0.88, bodyH, cell * 0.1);
    ctx.fill();

    // inner glow behind the filament
    var innerGlow = ctx.createRadialGradient(0, bodyTop + bodyH * 0.5, cell * 0.02, 0, bodyTop + bodyH * 0.5, w * 0.5);
    if (seated) {
      innerGlow.addColorStop(0, 'rgba(180,245,255,0.55)');
      innerGlow.addColorStop(1, 'rgba(120,220,255,0)');
    } else {
      innerGlow.addColorStop(0, 'rgba(255,196,120,0.22)');
      innerGlow.addColorStop(1, 'rgba(255,170,90,0)');
    }
    ctx.fillStyle = innerGlow;
    roundRect(ctx, -w * 0.44, bodyTop, w * 0.88, bodyH, cell * 0.1);
    ctx.fill();

    // filament
    var flick = this.motion ? 0.88 + 0.12 * Math.sin(now / 90 + pos.col * 2) : 1;
    ctx.save();
    ctx.shadowColor = seated ? 'rgba(150,240,255,0.95)' : 'rgba(255,180,90,0.6)';
    ctx.shadowBlur = cell * (seated ? 0.55 : 0.22) * flick;
    ctx.strokeStyle = seated ? 'rgba(226,252,255,0.98)' : 'rgba(255,199,126,' + (0.5 * flick + 0.25).toFixed(2) + ')';
    ctx.lineWidth = Math.max(1.4, cell * 0.052);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (i = 0; i <= 6; i++) {
      var yy = bodyTop + bodyH * 0.14 + (bodyH * 0.72 * i) / 6;
      var xx = (i % 2 === 0 ? -1 : 1) * w * 0.14;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.restore();

    // glass edge and specular
    ctx.strokeStyle = 'rgba(168,214,238,0.30)';
    ctx.lineWidth = Math.max(1, cell * 0.022);
    roundRect(ctx, -w * 0.44, bodyTop, w * 0.88, bodyH, cell * 0.1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, -w * 0.35, bodyTop + bodyH * 0.08, w * 0.12, bodyH * 0.72, cell * 0.05);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(ctx, w * 0.24, bodyTop + bodyH * 0.14, w * 0.06, bodyH * 0.6, cell * 0.03);
    ctx.fill();

    // finned cap
    var capTop = -h * 0.56;
    var cap = ctx.createLinearGradient(0, capTop, 0, capTop + h * 0.18);
    cap.addColorStop(0, '#6b8399');
    cap.addColorStop(0.5, '#3a4f64');
    cap.addColorStop(1, '#141e29');
    ctx.fillStyle = cap;
    roundRect(ctx, -w * 0.5, capTop, w, h * 0.17, cell * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(2,5,9,0.95)';
    ctx.lineWidth = Math.max(1.2, cell * 0.03);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10,16,24,0.75)';
    ctx.lineWidth = Math.max(1, cell * 0.024);
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      ctx.moveTo(-w * 0.33 + i * w * 0.22, capTop + h * 0.025);
      ctx.lineTo(-w * 0.33 + i * w * 0.22, capTop + h * 0.145);
    }
    ctx.stroke();
    // terminal stud on top
    ctx.fillStyle = seated ? 'rgba(200,250,255,0.95)' : '#8a5f36';
    ctx.beginPath();
    ctx.arc(0, capTop - cell * 0.01, cell * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  var CHEER_MS = 620;

  Renderer.prototype.drawRobot = function (ctx, now, p) {
    var g = this.game;
    var cell = this.cell;
    var pos = { row: g.player.row, col: g.player.col };
    var pushing = false;
    var lean = 0;
    if (this.anim && (this.anim.kind === 'move' || this.anim.kind === 'rewind') && p < 1) {
      pos = this.tweenPos(this.anim.player, p);
      pushing = !!this.anim.pushed;
      if (pushing) lean = Math.sin(p * Math.PI) * 0.09;
    }
    var dir = this.facing;
    var d = LY.DIRECTIONS[dir] || LY.DIRECTIONS.down;

    if (this.anim && this.anim.kind === 'refuse') {
      var rp = clamp((now - this.anim.t0) / Math.max(1, this.anim.dur), 0, 1);
      var bump = Math.sin(rp * Math.PI) * 0.16 * (this.motion ? 1 : 0.5);
      pos = { row: pos.row + d.dr * bump * 0.5, col: pos.col + d.dc * bump * 0.5 };
      lean = bump * 0.4;
    }

    var x = this.ox + (pos.col + 0.5) * cell;
    var y = this.oy + (pos.row + 0.5) * cell;
    var bob = this.motion ? Math.sin(now / 620) * cell * 0.012 : 0;
    var cheer = 0;
    if (this.cheerAt > 0 && now - this.cheerAt < CHEER_MS) {
      var ct = (now - this.cheerAt) / CHEER_MS;
      cheer = Math.abs(Math.sin(ct * Math.PI * 2)) * (1 - ct) * cell * 0.14 * (this.motion ? 1 : 0.3);
    }
    x += d.dc * lean * cell;
    y += d.dr * lean * cell - bob - cheer;

    var s = cell;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.14, 1.14);

    // ground shadow stays flat on the floor
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.30, s * 0.31, s * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    // LM-04 is drawn nose-down and turned to face its heading
    var ANGLE = { down: 0, left: Math.PI / 2, up: Math.PI, right: -Math.PI / 2 };
    var lampOn = this.game.phase === 'complete';
    var facingAway = dir === 'up';
    ctx.rotate(ANGLE[dir] === undefined ? 0 : ANGLE[dir]);

    // work light thrown on the floor ahead
    var lg = ctx.createRadialGradient(0, s * 0.3, s * 0.03, 0, s * 0.3, s * 0.62);
    lg.addColorStop(0, 'rgba(190,235,255,0.15)');
    lg.addColorStop(0.6, 'rgba(170,225,255,0.05)');
    lg.addColorStop(1, 'rgba(150,220,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.36, s * 0.5, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // tracks either side of the hull
    var trackPhase = this.motion ? (now / 110) % 1 : 0;
    var i;
    for (var side = -1; side <= 1; side += 2) {
      var tx = side * s * 0.28;
      ctx.fillStyle = '#0d151e';
      roundRect(ctx, tx - s * 0.075, -s * 0.25, s * 0.15, s * 0.5, s * 0.055);
      ctx.fill();
      ctx.strokeStyle = 'rgba(2,5,9,0.9)';
      ctx.lineWidth = Math.max(1, s * 0.02);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,175,205,0.26)';
      ctx.lineWidth = Math.max(1, s * 0.018);
      for (i = 0; i < 4; i++) {
        var ty = -s * 0.22 + ((i / 4 + trackPhase) % 1) * s * 0.44;
        ctx.beginPath();
        ctx.moveTo(tx - s * 0.06, ty);
        ctx.lineTo(tx + s * 0.06, ty);
        ctx.stroke();
      }
    }

    // hull
    var bodyG = ctx.createLinearGradient(0, -s * 0.28, 0, s * 0.26);
    bodyG.addColorStop(0, facingAway ? '#31445a' : '#5f809b');
    bodyG.addColorStop(0.45, '#36495e');
    bodyG.addColorStop(1, C.steel1);
    ctx.fillStyle = bodyG;
    roundRect(ctx, -s * 0.25, -s * 0.26, s * 0.5, s * 0.52, s * 0.11);
    ctx.fill();
    ctx.strokeStyle = 'rgba(3,7,12,0.95)';
    ctx.lineWidth = Math.max(1.2, s * 0.03);
    ctx.stroke();
    // panel line and shoulder highlight
    ctx.strokeStyle = 'rgba(190,225,255,0.20)';
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.beginPath();
    ctx.moveTo(-s * 0.17, -s * 0.19);
    ctx.lineTo(s * 0.17, -s * 0.19);
    ctx.stroke();

    // service lamp on the deck
    ctx.fillStyle = lampOn ? 'rgba(190,247,255,0.95)' : 'rgba(255,183,87,0.9)';
    ctx.shadowColor = lampOn ? 'rgba(150,240,255,0.9)' : 'rgba(255,180,90,0.7)';
    ctx.shadowBlur = s * 0.16;
    ctx.beginPath(); ctx.arc(0, -s * 0.04, s * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // trailing antenna with its slow blink
    ctx.strokeStyle = '#6f8ba3';
    ctx.lineWidth = Math.max(1, s * 0.022);
    var sway = this.motion ? Math.sin(now / 700) * s * 0.02 : 0;
    ctx.beginPath();
    ctx.moveTo(s * 0.15, -s * 0.24);
    ctx.quadraticCurveTo(s * 0.21, -s * 0.36, s * 0.23 + sway, -s * 0.46);
    ctx.stroke();
    ctx.fillStyle = (now % 1600) < 260 ? 'rgba(255,140,120,0.95)' : 'rgba(120,150,170,0.55)';
    ctx.beginPath(); ctx.arc(s * 0.23 + sway, -s * 0.47, s * 0.028, 0, Math.PI * 2); ctx.fill();

    // sensor pod at the front
    var podG = ctx.createLinearGradient(0, s * 0.1, 0, s * 0.32);
    podG.addColorStop(0, '#41586f');
    podG.addColorStop(1, '#1a2532');
    ctx.fillStyle = podG;
    roundRect(ctx, -s * 0.19, s * 0.1, s * 0.38, s * 0.22, s * 0.07);
    ctx.fill();
    ctx.strokeStyle = 'rgba(3,7,12,0.95)';
    ctx.lineWidth = Math.max(1, s * 0.025);
    ctx.stroke();

    // visor
    ctx.fillStyle = '#070f18';
    roundRect(ctx, -s * 0.16, s * 0.14, s * 0.32, s * 0.15, s * 0.05);
    ctx.fill();
    var blink = (now % 4200) < 130 && this.motion;
    var eyeH = blink ? s * 0.014 : s * 0.062;
    ctx.fillStyle = lampOn ? 'rgba(210,252,255,1)' : 'rgba(140,230,255,0.95)';
    ctx.shadowColor = 'rgba(130,225,255,0.9)';
    ctx.shadowBlur = s * (facingAway ? 0.1 : 0.2);
    ctx.globalAlpha = facingAway ? 0.5 : 1;
    roundRect(ctx, -s * 0.075, s * 0.215 - eyeH / 2, s * 0.15, eyeH, s * 0.02);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // push arms bite into the relay, drawn over the hull so the effort shows
    if (pushing || lean > 0.02) {
      var reach = s * (0.34 + Math.min(lean * 1.6, 0.1));
      ctx.strokeStyle = '#7a97b0';
      ctx.lineWidth = s * 0.06;
      ctx.lineCap = 'round';
      for (var arm = -1; arm <= 1; arm += 2) {
        ctx.beginPath();
        ctx.moveTo(arm * s * 0.14, s * 0.13);
        ctx.lineTo(arm * s * 0.14, reach);
        ctx.stroke();
      }
      var padG = ctx.createLinearGradient(0, reach - s * 0.04, 0, reach + s * 0.06);
      padG.addColorStop(0, '#9db6cc');
      padG.addColorStop(1, '#3d556c');
      ctx.fillStyle = padG;
      roundRect(ctx, -s * 0.21, reach - s * 0.035, s * 0.42, s * 0.085, s * 0.035);
      ctx.fill();
      ctx.strokeStyle = 'rgba(4,8,14,0.9)';
      ctx.lineWidth = Math.max(1, s * 0.02);
      ctx.stroke();
    }

    // rear vent grille, the side you see when it walks away
    ctx.strokeStyle = 'rgba(140,175,205,0.28)';
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.beginPath();
    for (i = 0; i < 3; i++) {
      ctx.moveTo(-s * 0.12, -s * 0.30 + i * s * 0.045);
      ctx.lineTo(s * 0.06, -s * 0.30 + i * s * 0.045);
    }
    ctx.stroke();

    ctx.restore();
  };

  Renderer.prototype.drawEffects = function (ctx, now) {
    var cell = this.cell;
    var keep = [];
    for (var i = 0; i < this.effects.length; i++) {
      var e = this.effects[i];
      var t = (now - e.t0) / e.dur;
      if (now < e.t0) { keep.push(e); continue; }
      if (t >= 1) continue;
      keep.push(e);
      var x, y;
      if (e.kind === 'dust') {
        x = this.cx(e.col) + e.vx * cell * t * 0.7;
        y = this.cy(e.row) + e.vy * cell * t * 0.7 + cell * 0.2;
        ctx.fillStyle = 'rgba(150,180,205,' + (0.22 * (1 - t)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, cell * (0.03 + t * 0.05), 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'spark') {
        x = this.cx(e.col) + e.vx * cell * t;
        y = this.cy(e.row) + e.vy * cell * t + cell * t * t * 0.5;
        ctx.fillStyle = 'rgba(255,214,150,' + (0.9 * (1 - t)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, cell * 0.022 * (1 - t) + 0.5, 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'seat') {
        x = this.cx(e.col); y = this.cy(e.row);
        var rr = cell * (0.35 + easeOut(t) * 0.85);
        ctx.strokeStyle = 'rgba(190,247,255,' + (0.75 * (1 - t)).toFixed(3) + ')';
        ctx.lineWidth = cell * 0.06 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
      } else if (e.kind === 'hint') {
        x = this.cx(e.col); y = this.cy(e.row);
        var ha = Math.sin(t * Math.PI) * 0.55;
        ctx.save();
        ctx.globalAlpha = ha;
        ctx.strokeStyle = 'rgba(190,247,255,0.9)';
        ctx.lineWidth = Math.max(1.5, cell * 0.035);
        ctx.setLineDash([cell * 0.12, cell * 0.1]);
        roundRect(ctx, x - cell * 0.36, y - cell * 0.36, cell * 0.72, cell * 0.72, cell * 0.12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (e.kind === 'refuse') {
        x = this.cx(e.col); y = this.cy(e.row);
        var a = (1 - t);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = C.danger;
        ctx.lineWidth = Math.max(2, cell * 0.06);
        ctx.lineCap = 'round';
        var q = cell * 0.16;
        ctx.beginPath();
        ctx.moveTo(x - q, y - q); ctx.lineTo(x + q, y + q);
        ctx.moveTo(x + q, y - q); ctx.lineTo(x - q, y + q);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,122,82,0.5)';
        ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.strokeRect(x - cell * 0.4, y - cell * 0.4, cell * 0.8, cell * 0.8);
        ctx.restore();
      } else if (e.kind === 'rewind') {
        // current sliding backwards through the lattice
        var net = this.network;
        ctx.save();
        ctx.globalAlpha = 0.5 * (1 - t);
        ctx.strokeStyle = 'rgba(180,200,255,0.9)';
        ctx.lineWidth = cell * 0.03;
        ctx.setLineDash([cell * 0.1, cell * 0.5]);
        ctx.lineDashOffset = t * cell * 3;
        for (var kk = 0; kk < net.keys.length; kk++) {
          var s2 = net.segs[net.keys[kk]];
          var ar = (s2.a / net.W) | 0, ac = s2.a % net.W, br = (s2.b / net.W) | 0, bc = s2.b % net.W;
          ctx.beginPath();
          ctx.moveTo(this.cx(ac), this.cy(ar));
          ctx.lineTo(this.cx(bc), this.cy(br));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    this.effects = keep;
  };

  /* Night veil lifts as sockets come alive. */
  Renderer.prototype.drawNight = function (ctx, now) {
    var a = 0.42 * (1 - this.ambient);
    if (a > 0.004) {
      ctx.fillStyle = 'rgba(3,7,14,' + a.toFixed(3) + ')';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
    // the world beyond the fence wakes with the yard
    var sc = this._scenery || this.buildScenery();
    var warmNow = this.dawn && this.game.phase === 'complete';
    for (var si = 0; si < sc.sheds.length; si++) {
      var sd = sc.sheds[si];
      var slit = this.ambient * (0.5 + 0.5 * hash2(si, 2, 51));
      if (slit < 0.02) continue;
      ctx.save();
      var halo = ctx.createRadialGradient(sd.x + sd.w / 2, sd.y + sd.h * 0.4, 1, sd.x + sd.w / 2, sd.y + sd.h * 0.4, sd.w);
      halo.addColorStop(0, warmNow
        ? 'rgba(255,190,120,' + (0.20 * slit).toFixed(3) + ')'
        : 'rgba(150,205,240,' + (0.14 * slit).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(120,180,220,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(sd.x - sd.w, sd.y - sd.h, sd.w * 3, sd.h * 3);
      for (var wj = 0; wj < sd.panes; wj++) {
        var ww = sd.w / sd.panes;
        var wx = sd.x + ww * wj + ww * 0.18;
        var wy = sd.y + sd.roof + Math.max(1, sd.h * 0.08);
        var wh = Math.max(2, sd.y + sd.h - wy - Math.max(1, sd.h * 0.1));
        var pane = slit * (0.6 + 0.4 * hash2(si, wj, 52));
        ctx.fillStyle = warmNow
          ? 'rgba(255,206,140,' + (0.18 + pane * 0.62).toFixed(3) + ')'
          : 'rgba(186,224,250,' + (0.08 + pane * 0.4).toFixed(3) + ')';
        ctx.fillRect(wx, wy, ww * 0.64, wh);
      }
      ctx.restore();
    }
    if (sc.pylons.length && this.ambient > 0.05) {
      for (var pi = 0; pi < sc.pylons.length; pi++) {
        var pl = sc.pylons[pi];
        var blinkOn = this.motion ? ((now + pi * 500) % 2400) < 900 : true;
        if (!blinkOn) continue;
        ctx.fillStyle = 'rgba(255,120,110,' + (0.25 + this.ambient * 0.5).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(pl.x, pl.base - pl.h - 1, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // windows in the top wall wake with the yard
    var wins = this.windowCells();
    var cell = this.cell;
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      var x = this.ox + w.col * cell, y = this.oy + w.row * cell;
      var lit = this.ambient;
      var warm = this.dawn && this.game.phase === 'complete' ? 1 : 0;
      ctx.save();
      ctx.fillStyle = 'rgba(10,16,24,0.95)';
      roundRect(ctx, x + cell * 0.22, y + cell * 0.28, cell * 0.56, cell * 0.42, cell * 0.05);
      ctx.fill();
      var gl = ctx.createLinearGradient(0, y, 0, y + cell);
      gl.addColorStop(0, 'rgba(' + (warm ? '255,214,150' : '150,205,235') + ',' + (0.1 + lit * 0.55).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(' + (warm ? '255,170,110' : '110,170,210') + ',' + (0.04 + lit * 0.3).toFixed(3) + ')');
      ctx.fillStyle = gl;
      roundRect(ctx, x + cell * 0.24, y + cell * 0.3, cell * 0.52, cell * 0.38, cell * 0.04);
      ctx.fill();
      ctx.strokeStyle = 'rgba(6,10,16,0.9)';
      ctx.lineWidth = Math.max(1, cell * 0.03);
      ctx.beginPath();
      ctx.moveTo(x + cell * 0.5, y + cell * 0.3);
      ctx.lineTo(x + cell * 0.5, y + cell * 0.68);
      ctx.stroke();
      ctx.restore();
    }
  };

  Renderer.prototype.drawSurge = function (ctx, now) {
    if (!this.surgeWave || this.completeAt < 0) return;
    var t = (now - this.surgeWave.t0) / 1500;
    if (t < 0) return;
    var cell = this.cell;
    if (t < 1) {
      var x = this.cx(this.surgeWave.col), y = this.cy(this.surgeWave.row);
      var maxR = Math.max(this.cssW, this.cssH) * 1.1;
      var rr = easeOut(clamp(t * 1.15, 0, 1)) * maxR;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var ring = ctx.createRadialGradient(x, y, Math.max(1, rr * 0.72), x, y, rr);
      ring.addColorStop(0, 'rgba(120,220,255,0)');
      ring.addColorStop(0.75, 'rgba(150,235,255,' + (0.30 * (1 - t)).toFixed(3) + ')');
      ring.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = ring;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 0.35 * Math.max(0, 1 - t * 2.2);
      ctx.fillStyle = '#dff6ff';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.restore();
    }
    // steady state after the surge
    var settled = clamp((now - this.surgeWave.t0 - 600) / 1400, 0, 1);
    if (settled > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (this.dawn) {
        var dg = ctx.createLinearGradient(0, 0, 0, this.cssH);
        dg.addColorStop(0, 'rgba(255,178,104,' + (0.24 * settled).toFixed(3) + ')');
        dg.addColorStop(0.5, 'rgba(255,142,96,' + (0.10 * settled).toFixed(3) + ')');
        dg.addColorStop(1, 'rgba(120,150,255,0)');
        ctx.fillStyle = dg;
      } else {
        var cg = ctx.createRadialGradient(this.cssW / 2, this.cssH / 2, 0, this.cssW / 2, this.cssH / 2, Math.max(this.cssW, this.cssH) * 0.7);
        cg.addColorStop(0, 'rgba(120,200,235,' + (0.10 * settled).toFixed(3) + ')');
        cg.addColorStop(1, 'rgba(40,90,140,0)');
        ctx.fillStyle = cg;
      }
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.restore();
    }
  };

  /* Before the first input, current is already trembling at the feeder. */
  Renderer.prototype.drawIntroTremble = function (ctx, now) {
    if (!this._feeder) return;
    var cell = this.cell;
    var x = this.ox + (this._feeder.col + 0.5) * cell;
    var y = this.oy + (this._feeder.row + 0.5) * cell;
    var flick = this.motion
      ? (Math.sin(now / 130) * 0.5 + 0.5) * (Math.sin(now / 47) * 0.35 + 0.65)
      : 0.6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(x, y, 0, x, y, cell * 1.1);
    g.addColorStop(0, 'rgba(150,235,255,' + (0.20 * flick).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(90,190,230,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, cell * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(210,250,255,' + (0.5 + 0.5 * flick).toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(x, y - cell * 0.06, cell * 0.05, 0, Math.PI * 2); ctx.fill();

    // a short lick of current toward the first junction
    var ax = this.ox + (this._feeder.anchorCol + 0.5) * cell;
    var ay = this.oy + (this._feeder.anchorRow + 0.5) * cell;
    ctx.strokeStyle = 'rgba(190,247,255,' + (0.35 * flick).toFixed(3) + ')';
    ctx.lineWidth = cell * 0.04;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(lerp(x, ax, 0.4 + 0.5 * flick), lerp(y, ay, 0.4 + 0.5 * flick));
    ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype.describe = function () {
    var g = this.game;
    var lv = g.level;
    return 'Yard ' + lv.name + ', board ' + lv.number + ' of 20. Robot at row ' +
      (g.player.row + 1) + ', column ' + (g.player.col + 1) + '. ' +
      g.poweredGoals() + ' of ' + lv.goals.length + ' sockets powered. ' +
      g.moveCount + ' moves, ' + g.pushCount + ' pushes.' +
      (g.phase === 'complete' ? ' Yard powered.' : '');
  };

  LY.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
