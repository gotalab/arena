(function (global) {
  'use strict';

  var STEP = 1 / 60;
  var TICK_MS = 1000 / 60;
  var GRAVITY = 660;
  var WALL_LEFT = -78;
  var WALL_RIGHT = 78;
  var PLAYER_R = 11;
  var JUMP_CAPACITY = 3;
  var LAUNCH_REACH = 235;
  var FULL_SPEED = Math.sqrt(2 * GRAVITY * LAUNCH_REACH);
  var PULL_MAX = 96;
  var DEAD_ZONE = 10;
  var WALL_SLIDE = 15;
  var MOTH_KICK = 235;
  var MOTH_KICK_UP = 95;
  var DAMP_BASE = 28;
  var DAMP_RAMP_PER = 0.018;
  var DAMP_CAP = 150;
  var DIFF_H = 2600;
  var DAMP_START_Y = -190;
  var GLIMMER_BASE = 80;
  var CHAIN_BASE = 24;
  var HEIGHT_SCORE = 1;
  var GAP_MIN = 115;
  var GAP_MAX = 205;
  var LATERAL_MIN = 16;
  var LATERAL_MAX = 42;
  var MAX_X = 44;
  var SPAWN_AHEAD = 2.4 * LAUNCH_REACH;
  var AIM_TIME_SCALE = 0.72;
  var ITEM_SPAN_LO = -LAUNCH_REACH;
  var ITEM_SPAN_HI = 2 * LAUNCH_REACH;
  var PRUNE_BUFFER = 240;

  var RANKS = [
    { min: 0, name: 'Ember', color: '#ffb74d' },
    { min: 900, name: 'Sparrow', color: '#ffd76a' },
    { min: 2600, name: 'Tinder', color: '#ff8a3c' },
    { min: 5200, name: 'Flame', color: '#ff5e3a' },
    { min: 9000, name: 'Blaze', color: '#ff3d68' },
    { min: 15000, name: 'Inferno', color: '#c95ef2' }
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function rankFor(score) {
    var r = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) { if (score >= RANKS[i].min) r = RANKS[i]; }
    return r;
  }

  function EmberSim() {
    this.sessionBest = 0;
    this.reset(1);
  }

  EmberSim.prototype.reset = function (seed) {
    if (typeof seed === 'number' && isFinite(seed)) this.seed = seed >>> 0;
    this.rng = new global.SeededRng(this.seed);
    this.phase = 'ready';
    this.tick = 0;
    this.spawnIndex = 0;
    this.difficulty = 0;
    this.score = 0;
    this.height = 0;
    this.rank = null;
    this.input = { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0, wantLaunch: false };
    this.pendingLaunch = null;
    this.px = 0; this.py = 0; this.vx = 0; this.vy = 0;
    this.anchored = true; this.anchorKind = 'ledge';
    this.jumpsLeft = JUMP_CAPACITY;
    this.launches = 0; this.midairLaunches = 0; this.landings = 0; this.refunds = 0; this.glimmersCollected = 0;
    this.chainCount = 0; this.chainBest = 0;
    this.lastChainBanked = 0;
    this.lastLaunchPower = 0;
    this.dampY = DAMP_START_Y;
    this.dampSpeed = DAMP_BASE;
    this.ledges = [];
    this.items = [];
    this.lastEvent = null;
    this.nextLedgeId = 1;
    this.nextItemId = 1;
    this.highestGenY = 0;
    this.ledges.push({ id: 0, x: 0, y: 0, halfWidth: 55, active: true });
    this.ensureSpawn();
  };

  EmberSim.prototype.difficultyAt = function (y) {
    return clamp(y / DIFF_H, 0, 1);
  };

  EmberSim.prototype.setInput = function (inp) {
    this.input.dragging = !!inp.dragging;
    this.input.originX = inp.originX || 0;
    this.input.originY = inp.originY || 0;
    this.input.dx = inp.dx || 0;
    this.input.dy = inp.dy || 0;
    this.input.wantLaunch = !!inp.wantLaunch;
    if (this.input.wantLaunch) {
      this.pendingLaunch = {
        dx: inp.launchDx !== undefined ? inp.launchDx : (inp.dx || 0),
        dy: inp.launchDy !== undefined ? inp.launchDy : (inp.dy || 0)
      };
    }
  };

  EmberSim.prototype.itemPos = function (it) {
    var t = this.tick;
    return {
      x: it.baseX + Math.sin(t * it.freqX + it.phaseX) * it.ampX,
      y: it.baseY + Math.sin(t * it.freqY + it.phaseY) * it.ampY
    };
  };

  EmberSim.prototype.step = function () {
    if (this.phase === 'gameover') { this.input.wantLaunch = false; return; }
    if (this.phase === 'ready') {
      if (!this.input.wantLaunch) return;
      this.tick = 1;
      if (!this.tryConsumeLaunch()) { this.tick = 0; return; }
      this.phase = 'playing';
    } else {
      this.tick++;
      if (this.input.wantLaunch) this.tryConsumeLaunch();
    }
    this.update();
  };

  EmberSim.prototype.tryConsumeLaunch = function () {
    this.input.wantLaunch = false;
    var pl = this.pendingLaunch;
    this.pendingLaunch = null;
    if (this.jumpsLeft <= 0) return false;
    var len = Math.hypot(pl.dx, pl.dy);
    if (len < DEAD_ZONE) return false;
    var wasAnchored = this.anchored;
    var ratio = Math.min(1, len / PULL_MAX);
    var speed = FULL_SPEED * ratio;
    this.lastLaunchPower = ratio;
    this.vx = (-pl.dx / len) * speed;
    this.vy = (pl.dy / len) * speed;
    this.anchored = false;
    this.anchorKind = null;
    this.jumpsLeft--;
    this.launches++;
    this.lastEvent = { kind: 'launch', tick: this.tick };
    if (!wasAnchored) {
      this.midairLaunches++;
      this.chainCount++;
      this.lastEvent = { kind: 'chain', tick: this.tick };
    }
    return true;
  };

  EmberSim.prototype.update = function () {
    this.ensureSpawn();
    this.difficulty = clamp(this.height / DIFF_H, 0, 1);
    this.dampSpeed = Math.min(DAMP_CAP, DAMP_BASE + DAMP_RAMP_PER * this.height);
    var wdt = STEP * (this.input.dragging && !this.anchored ? AIM_TIME_SCALE : 1);
    var prevY = this.py;
    if (!this.anchored) {
      this.vy -= GRAVITY * wdt;
      this.px += this.vx * wdt;
      this.py += this.vy * wdt;
      if (this.py > this.height) {
        this.score += (this.py - this.height) * HEIGHT_SCORE;
        this.height = this.py;
      }
      this.collideWalls();
      this.checkLedgeLandings(prevY);
      this.checkItems();
    } else if (this.anchorKind === 'wall') {
      this.py -= WALL_SLIDE * wdt;
    }
    this.dampY += this.dampSpeed * STEP;
    if (this.dampY >= this.py - PLAYER_R * 0.5) {
      this.endRun();
      return;
    }
    this.prune();
  };

  EmberSim.prototype.collideWalls = function () {
    if (this.px - PLAYER_R <= WALL_LEFT) {
      this.px = WALL_LEFT + PLAYER_R;
      if (this.vy > 80) {
        this.vx = -this.vx * 0.5;
        this.vy *= 0.94;
      } else {
        this.vx = 0; this.vy = 0;
        this.landOn('wall');
      }
    } else if (this.px + PLAYER_R >= WALL_RIGHT) {
      this.px = WALL_RIGHT - PLAYER_R;
      if (this.vy > 80) {
        this.vx = -this.vx * 0.5;
        this.vy *= 0.94;
      } else {
        this.vx = 0; this.vy = 0;
        this.landOn('wall');
      }
    }
  };

  EmberSim.prototype.checkLedgeLandings = function (prevY) {
    if (this.vy > 0) return;
    var bottom = this.py - PLAYER_R;
    var prevBottom = prevY - PLAYER_R;
    for (var i = 0; i < this.ledges.length; i++) {
      var l = this.ledges[i];
      if (!l.active) continue;
      if (Math.abs(this.px - l.x) > l.halfWidth) continue;
      if (bottom <= l.y && prevBottom >= l.y) {
        this.px = clamp(this.px, l.x - l.halfWidth, l.x + l.halfWidth);
        this.py = l.y + PLAYER_R;
        this.vx = 0; this.vy = 0;
        this.landOn('ledge');
        return;
      }
    }
  };

  EmberSim.prototype.checkItems = function () {
    var r = PLAYER_R;
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (!it.active) continue;
      var p = this.itemPos(it);
      var dx = p.x - this.px;
      var dy = p.y - this.py;
      var rr = r + it.collisionRadius;
      if (dx * dx + dy * dy <= rr * rr) {
        if (it.type === 'glimmer') {
          it.active = false;
          this.glimmersCollected++;
          var mult = this.chainCount > 0 ? 1 + this.chainCount * 0.5 : 1;
          this.score += Math.round(GLIMMER_BASE * mult);
          this.lastEvent = { kind: 'glimmer', tick: this.tick };
        } else {
          it.active = false;
          this.refunds++;
          this.jumpsLeft = Math.min(JUMP_CAPACITY, this.jumpsLeft + 1);
          if (this.anchored) { this.anchored = false; this.anchorKind = null; }
          this.chainCount++;
          var dl = Math.hypot(dx, dy) || 1;
          this.vx += (dx / dl) * MOTH_KICK * 0.5;
          this.vy += (dy / dl) * MOTH_KICK + MOTH_KICK_UP;
          if (this.vy < 120) this.vy = 120;
          this.lastEvent = { kind: 'bounce', tick: this.tick };
          this.lastEvent = { kind: 'chain', tick: this.tick };
        }
      }
    }
  };

  EmberSim.prototype.landOn = function (kind) {
    this.anchored = true;
    this.anchorKind = kind;
    this.landings++;
    this.jumpsLeft = JUMP_CAPACITY;
    var len = this.chainCount;
    this.chainCount = 0;
    this.lastEvent = { kind: 'land', tick: this.tick };
    if (len > 0) {
      var bonus = CHAIN_BASE * (len * (len + 1)) / 2;
      this.score += bonus;
      this.lastChainBanked = len;
      if (len > this.chainBest) this.chainBest = len;
      this.lastEvent = { kind: 'chainBank', tick: this.tick };
    } else {
      this.lastChainBanked = 0;
    }
  };

  EmberSim.prototype.endRun = function () {
    if (this.phase === 'gameover') return;
    this.phase = 'gameover';
    this.rank = rankFor(this.score).name;
    if (this.score > this.sessionBest) this.sessionBest = this.score;
  };

  EmberSim.prototype.ensureSpawn = function () {
    var guard = 0;
    while (this.highestGenY < this.py + SPAWN_AHEAD && guard < 40) {
      this.genNext();
      guard++;
    }
  };

  EmberSim.prototype.genNext = function () {
    var prev = this.ledges[this.ledges.length - 1];
    var diff = this.difficultyAt(prev.y);
    var gap = lerp(GAP_MIN, GAP_MAX, easeOut(diff)) + this.rng.range(-10, 10);
    var drift = lerp(LATERAL_MIN, LATERAL_MAX, easeOut(diff)) * this.rng.range(-1, 1);
    var nx = clamp(prev.x + drift, -MAX_X, MAX_X);
    var d = Math.abs(nx - prev.x);
    var maxH = LAUNCH_REACH - (d * d) / (4 * LAUNCH_REACH) - 12;
    var dFar = Math.max(Math.abs(WALL_LEFT - nx), Math.abs(WALL_RIGHT - nx));
    var maxHWall = LAUNCH_REACH - (dFar * dFar) / (4 * LAUNCH_REACH) - 14;
    gap = clamp(gap, GAP_MIN * 0.6, Math.min(maxH, maxHWall));
    var ny = prev.y + gap;
    var hw = clamp(lerp(46, 27, diff) + this.rng.range(-5, 5), 20, 50);
    var ledge = { id: this.nextLedgeId++, x: nx, y: ny, halfWidth: hw, active: true };
    this.ledges.push(ledge);
    this.spawnIndex++;
    this.genGapItems(prev, ledge);
    this.highestGenY = ny;
  };

  EmberSim.prototype.genGapItems = function (prev, cur) {
    var h = cur.y - prev.y;
    var diff = this.difficultyAt(cur.y);
    var midX = (prev.x + cur.x) / 2;
    var placed = [];
    var self = this;

    function tooClose(x, y) {
      for (var i = 0; i < placed.length; i++) {
        var q = placed[i];
        if (Math.hypot(q.x - x, q.y - y) < 48) return true;
      }
      var start = Math.max(0, self.items.length - 5);
      for (var i2 = start; i2 < self.items.length; i2++) {
        var it = self.items[i2];
        if (it.active && Math.abs(it.baseY - y) < 60 && Math.hypot(it.baseX - x, it.baseY - y) < 48) return true;
      }
      return false;
    }

    function place(type, x, y) {
      x = clamp(x, -MAX_X - 6, MAX_X + 6);
      if (tooClose(x, y)) return false;
      self.items.push(self.makeItem(type, x, y));
      placed.push({ x: x, y: y });
      self.spawnIndex++;
      return true;
    }

    if (this.rng.chance(0.32 + 0.5 * diff)) {
      var gy = prev.y + Math.max(30, h * (0.3 + this.rng.next() * 0.32));
      if (cur.y - gy > 24) {
        var gx = midX + (this.rng.chance(0.5) ? -1 : 1) * (14 + this.rng.next() * 30);
        place('glimmer', gx, gy);
      }
    }

    if (this.rng.chance(0.22 + 0.38 * diff)) {
      var gy2 = cur.y + 44 + this.rng.next() * 26;
      var gx2 = cur.x + (this.rng.chance(0.5) ? -1 : 1) * (16 + this.rng.next() * 30);
      if (place('glimmer', gx2, gy2) && this.rng.chance(0.5)) {
        place('moth', gx2 + this.rng.range(-20, 20), gy2 + 50 + this.rng.next() * 24);
      }
    }

    var mothCount = this.rng.chance(0.12 + 0.5 * diff) ? 1 : 0;
    if (diff > 0.3 && this.rng.chance(0.4)) mothCount++;
    for (var i = 0; i < mothCount; i++) {
      var t = Math.min(0.85, 0.4 + i * 0.24);
      var my = prev.y + Math.max(52, h * t);
      if (cur.y - my < 26) continue;
      var mx = midX + (i % 2 === 0 ? 1 : -1) * (18 + this.rng.next() * 26);
      place('moth', mx, my);
    }
  };

  EmberSim.prototype.makeItem = function (type, x, y) {
    var it = { id: this.nextItemId++, type: type, baseX: x, baseY: y, active: true };
    if (type === 'moth') {
      it.freqX = this.rng.range(0.35, 0.85);
      it.freqY = this.rng.range(0.5, 1.0);
      it.ampX = this.rng.range(8, 15);
      it.ampY = this.rng.range(5, 8);
      it.phaseX = this.rng.next() * Math.PI * 2;
      it.phaseY = this.rng.next() * Math.PI * 2;
      it.visualRadius = 15;
      it.collisionRadius = 12;
    } else {
      it.freqX = 0;
      it.freqY = this.rng.range(1.4, 2.2);
      it.ampX = 0;
      it.ampY = this.rng.range(3, 6);
      it.phaseX = 0;
      it.phaseY = this.rng.next() * Math.PI * 2;
      it.visualRadius = 11;
      it.collisionRadius = 9;
    }
    return it;
  };

  EmberSim.prototype.prune = function () {
    var lo = this.py + ITEM_SPAN_LO - PRUNE_BUFFER;
    while (this.ledges.length && this.ledges[0].y < lo) this.ledges.shift();
    while (this.items.length && this.items[0].baseY - 14 < lo) this.items.shift();
  };

  EmberSim.prototype.snapshot = function () {
    var lo = this.py + ITEM_SPAN_LO;
    var hi = this.py + ITEM_SPAN_HI;
    var ledges = [];
    var items = [];
    for (var i = 0; i < this.ledges.length; i++) {
      var l = this.ledges[i];
      if (l.y < lo || l.y > hi) continue;
      ledges.push({ id: l.id, position: { x: r3(l.x), y: r3(l.y) }, halfWidth: r3(l.halfWidth), active: l.active });
    }
    for (var j = 0; j < this.items.length; j++) {
      var it = this.items[j];
      if (it.baseY < lo - 14 || it.baseY > hi) continue;
      var p = this.itemPos(it);
      items.push({
        id: it.id,
        type: it.type,
        position: { x: r3(p.x), y: r3(p.y) },
        active: it.active,
        visualRadius: it.visualRadius,
        collisionRadius: it.collisionRadius
      });
    }
    var inp = {
      dragging: this.input.dragging,
      originX: r3(this.input.originX),
      originY: r3(this.input.originY),
      dx: r3(this.input.dx),
      dy: r3(this.input.dy)
    };
    if (!inp.dragging) { inp.originX = 0; inp.originY = 0; inp.dx = 0; inp.dy = 0; }
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: Math.round(this.tick * TICK_MS * 1000) / 1000,
      seed: this.seed,
      rngState: this.rng.state(),
      spawnIndex: this.spawnIndex,
      input: inp,
      difficulty: r3(this.difficulty),
      score: r3(this.score),
      height: r3(this.height),
      sessionBest: r3(this.sessionBest),
      rank: this.rank,
      x: r3(this.px), y: r3(this.py), vx: r3(this.vx), vy: r3(this.vy),
      playerRadius: PLAYER_R,
      anchored: this.anchored,
      anchorKind: this.anchorKind,
      jumpCapacity: JUMP_CAPACITY,
      jumpsLeft: this.jumpsLeft,
      launches: this.launches,
      midairLaunches: this.midairLaunches,
      landings: this.landings,
      refunds: this.refunds,
      glimmersCollected: this.glimmersCollected,
      chainCount: this.chainCount,
      chainBest: this.chainBest,
      dampY: r3(this.dampY),
      dampSpeed: r3(this.dampSpeed),
      wallLeftX: WALL_LEFT,
      wallRightX: WALL_RIGHT,
      launchReach: LAUNCH_REACH,
      ledges: ledges,
      items: items,
      lastEvent: this.lastEvent ? { kind: this.lastEvent.kind, tick: this.lastEvent.tick } : null
    };
  };

  global.EmberConfig = {
    STEP: STEP,
    TICK_MS: TICK_MS,
    GRAVITY: GRAVITY,
    WALL_LEFT: WALL_LEFT,
    WALL_RIGHT: WALL_RIGHT,
    PLAYER_R: PLAYER_R,
    JUMP_CAPACITY: JUMP_CAPACITY,
    LAUNCH_REACH: LAUNCH_REACH,
    FULL_SPEED: FULL_SPEED,
    PULL_MAX: PULL_MAX,
    DEAD_ZONE: DEAD_ZONE,
    WALL_SLIDE: WALL_SLIDE,
    DAMP_START_Y: DAMP_START_Y,
    GLIMMER_BASE: GLIMMER_BASE,
    CHAIN_BASE: CHAIN_BASE,
    RANKS: RANKS,
    rankFor: rankFor
  };
  global.EmberSim = EmberSim;
})(typeof window !== 'undefined' ? window : globalThis);
