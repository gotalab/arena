/**
 * DELVE — deterministic simulation (60 Hz).
 *
 * Snapshot rounding (stable, documented):
 *   integers: tick, seq, seed, rngState, spawnIndex, hits, wallContacts,
 *             fragmentsCollected, rocksBroken, input flags
 *   3 dp ms:  elapsedMs, timeMs, remainingMs, invincibleUntilMs, previewMs
 *   4 dp:     positions, radii, speeds, difficulty, score, steer, widths
 *
 * Rule state never reads Date.now() or Math.random().
 */
(function (root) {
  "use strict";

  var STEP_MS = 1000 / 60;
  var HORIZON = 800;
  var BEHIND = 96;
  var GEN_LOOKAHEAD = HORIZON + 520;
  var WP_GAP = 20;

  var PLAYER_RADIUS = 15;
  var CRAWL = 90;
  var MAX_SPEED = 600;
  var ACCEL = 380;
  var DECEL = 265;
  var STALL_MS = 250;

  var LAT_CRAWL = 505;
  var LAT_FAST = 128;
  var STEER_RESP_CRAWL = 16;
  var STEER_RESP_FAST = 7;

  var START_REMAINING = 20000;
  var MAX_REMAINING = 25500;
  var FRAGMENT_MS = 960;
  var POWER_ROCK_MS = 820;
  var POWER_MS = 5400;

  var SCORE_PER_DEPTH = 1.15;
  var SCORE_FRAGMENT = 7;
  var SCORE_POWER_ROCK = 28;

  var RANKS = [
    { name: "D", min: 0 },
    { name: "C", min: 2800 },
    { name: "B", min: 6500 },
    { name: "A", min: 12000 },
    { name: "S", min: 20000 },
    { name: "SS", min: 34000 }
  ];

  var FORMATION_KINDS = ["line", "chevron", "triangle", "wave", "arc"];

  function r3(n) {
    return Math.round(n * 1000) / 1000;
  }
  function r4(n) {
    return Math.round(n * 10000) / 10000;
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function approach(cur, target, rate, dt) {
    var max = rate * dt;
    var d = target - cur;
    if (d > max) return cur + max;
    if (d < -max) return cur - max;
    return target;
  }
  function hashSeed(seed) {
    if (typeof seed === "number" && isFinite(seed)) return seed >>> 0;
    var s = String(seed == null ? 1 : seed);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rankFor(score) {
    var name = "D";
    for (var i = 0; i < RANKS.length; i++) {
      if (score >= RANKS[i].min) name = RANKS[i].name;
    }
    return name;
  }

  function RNG(state) {
    this.s = state >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }
  RNG.prototype.next = function () {
    var a = (this.s + 0x6d2b79f5) >>> 0;
    this.s = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (a, b) {
    return a + this.next() * (b - a);
  };
  RNG.prototype.int = function (a, b) {
    return Math.floor(this.range(a, b));
  };
  RNG.prototype.pick = function (arr) {
    return arr[this.int(0, arr.length)];
  };

  function createSim() {
    var S = {};
    resetInternal(S, 1);
    return S;
  }

  function resetInternal(S, seed) {
    var s = hashSeed(seed);
    S.seed = s;
    S.rng = new RNG(s ^ 0x51ed);
    S.phase = "ready";
    S.tick = 0;
    S.elapsedMs = 0;
    S.timeMs = 0;
    S.remainingMs = START_REMAINING;
    S.accMs = 0;
    S.spawnIndex = 1;
    S.difficulty = 0;
    S.score = 0;
    S.bonusScore = 0;
    S.depth = 0;
    S.x = 0;
    S.vx = 0;
    S.speed = CRAWL;
    S.playerRadius = PLAYER_RADIUS;
    S.maxSpeed = MAX_SPEED;
    S.hits = 0;
    S.wallContacts = 0;
    S.fragmentsCollected = 0;
    S.rocksBroken = 0;
    S.invincibleUntilMs = 0;
    S.rank = null;
    S.input = { accel: false, left: false, right: false, steer: 0 };
    S.events = [];
    S.lastEvent = null;
    S.rocks = [];
    S.items = [];
    S.waypoints = [];
    S.genDepth = 0;
    S.cx = 0;
    S.heading = 0;
    S.hw = 162;
    S.segKind = "straight";
    S.segEnd = 280;
    S.segAmp = 0.00015;
    S.segSign = 1;
    S.segPhase = 0;
    S.laneX = 0;
    S.nextRockDepth = 420;
    S.nextFormDepth = 380;
    S.firstPowerDepth = 0;
    S.secondPowerDepth = 0;
    S.nextPowerDepth = 0;
    S.powersPlaced = 0;
    S.formSeq = 1;
    S.lastFormKind = "";
    S.wallLatched = false;
    S.stallMs = 0;
    S.stallFrom = CRAWL;
    S.passedNear = {};
    S.hitRockIds = {};
    S.closestShave = 1e9;
    S.throttleStreak = 0;
    S.maxThrottleStreak = 0;
    S.nearMissStreak = 0;
    S.maxNearMissStreak = 0;
    S.sinceNearMiss = 0;
    S.maxDepth = 0;

    S.firstPowerDepth = 7600 + S.rng.range(0, 2800);
    S.secondPowerDepth = 21000 + S.rng.range(0, 9000);

    pushWaypoint(S, 0);
    generateUntil(S, GEN_LOOKAHEAD);
  }

  function emit(S, kind) {
    var seq = S.lastEvent ? S.lastEvent.seq + 1 : 1;
    var e = { seq: seq, kind: kind, tick: S.tick };
    S.events.push(e);
    if (S.events.length > 100) S.events.shift();
    S.lastEvent = e;
  }

  function allocId(S) {
    var id = S.spawnIndex;
    S.spawnIndex += 1;
    return id;
  }

  function difficultyAt(depth) {
    return depth / 4200;
  }

  function hwAt(depth) {
    var d = difficultyAt(depth);
    return lerp(164, 128, clamp(d / 3.2, 0, 1));
  }

  function pushWaypoint(S, depth) {
    S.waypoints.push({ depth: depth, cx: S.cx, hw: S.hw });
    if (S.waypoints.length > 2400) {
      var cut = S.depth - BEHIND - 80;
      while (S.waypoints.length > 400 && S.waypoints[1] && S.waypoints[1].depth < cut) {
        S.waypoints.shift();
      }
    }
  }

  function samplePath(S, depth) {
    var wps = S.waypoints;
    if (!wps.length) return { cx: 0, hw: 160 };
    if (depth <= wps[0].depth) return { cx: wps[0].cx, hw: wps[0].hw };
    var last = wps[wps.length - 1];
    if (depth >= last.depth) return { cx: last.cx, hw: last.hw };
    var lo = 0;
    var hi = wps.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (wps[mid].depth <= depth) lo = mid;
      else hi = mid;
    }
    var a = wps[lo];
    var b = wps[hi];
    var span = b.depth - a.depth || 1;
    var t = (depth - a.depth) / span;
    return { cx: lerp(a.cx, b.cx, t), hw: lerp(a.hw, b.hw, t) };
  }

  function pickSegment(S) {
    var d = difficultyAt(S.genDepth);
    var r = S.rng.next();
    var kind;
    if (S.genDepth < 320) kind = "straight";
    else if (r < 0.16 - clamp(d, 0, 0.08)) kind = "straight";
    else if (r < 0.52) kind = "gentle";
    else if (r < 0.78 + clamp(d * 0.04, 0, 0.1)) kind = "ess";
    else kind = "switch";
    S.segKind = kind;
    var len;
    if (kind === "straight") len = S.rng.range(200, 360);
    else if (kind === "gentle") len = S.rng.range(260, 480);
    else if (kind === "ess") len = S.rng.range(340, 560);
    else len = S.rng.range(210, 340);
    S.segEnd = S.genDepth + len;
    S.segAmp = (kind === "straight" ? 0.00015 : kind === "gentle" ? 0.00055 : kind === "ess" ? 0.0008 : 0.00135);
    S.segAmp *= 1 + clamp(d * 0.55, 0, 1.6);
    S.segSign = S.rng.next() < 0.5 ? -1 : 1;
    S.segPhase = S.rng.range(0, Math.PI * 2);
  }

  function stepGenerate(S) {
    if (S.genDepth >= S.segEnd) pickSegment(S);
    var d = difficultyAt(S.genDepth);
    var kind = S.segKind;
    var amp = S.segAmp;
    var t = S.genDepth;
    var turn = 0;
    if (kind === "straight") {
      turn = -S.heading * 0.08;
    } else if (kind === "gentle") {
      turn = Math.sin(t * 0.012 + S.segPhase) * amp * S.segSign * 18;
    } else if (kind === "ess") {
      turn = Math.sin(t * 0.02 + S.segPhase) * amp * S.segSign * 26;
    } else {
      turn = S.segSign * amp * 42 + Math.sin(t * 0.03) * amp * 8;
    }
    S.heading += turn;
    S.heading += -S.cx * 0.00022;
    S.heading *= 0.986;
    var maxH = 0.42 + clamp(d, 0, 2) * 0.12;
    S.heading = clamp(S.heading, -maxH, maxH);
    S.cx += S.heading * WP_GAP;
    S.cx = clamp(S.cx, -220, 220);
    S.hw = hwAt(S.genDepth);
    S.laneX = approach(S.laneX, S.cx, 55, WP_GAP / 90);
    S.laneX = clamp(S.laneX, S.cx - S.hw + 36, S.cx + S.hw - 36);
    pushWaypoint(S, S.genDepth);
    maybeRock(S);
    maybeFormation(S);
    maybePower(S);
    S.genDepth += WP_GAP;
  }

  function generateUntil(S, until) {
    if (S.waypoints.length === 0) pushWaypoint(S, 0);
    var guard = 0;
    while (S.genDepth < until && guard++ < 8000) stepGenerate(S);
  }

  function rockClear(S, x, depth, rad) {
    var p = samplePath(S, depth);
    var margin = PLAYER_RADIUS + 10;
    if (x - rad < p.cx - p.hw + 6) return false;
    if (x + rad > p.cx + p.hw - 6) return false;
    var laneHalf = PLAYER_RADIUS + 12;
    if (Math.abs(x - S.laneX) < rad + laneHalf) return false;
    for (var i = 0; i < S.rocks.length; i++) {
      var r = S.rocks[i];
      if (!r.active) continue;
      var dd = r.position.depth - depth;
      var dx = r.position.x - x;
      var need = r.collisionRadius + rad + 8;
      if (dx * dx + dd * dd < need * need) return false;
    }
    return true;
  }

  function addRock(S, x, depth, vis) {
    vis = clamp(vis, 11, 40);
    var col = vis * 0.86;
    if (!rockClear(S, x, depth, col)) return false;
    S.rocks.push({
      id: allocId(S),
      position: { x: x, depth: depth },
      active: true,
      visualRadius: vis,
      collisionRadius: col
    });
    return true;
  }

  function maybeRock(S) {
    if (S.genDepth < S.nextRockDepth) return;
    var d = difficultyAt(S.genDepth);
    var p = samplePath(S, S.genDepth);
    var gap = PLAYER_RADIUS * 2 + lerp(28, 14, clamp(d / 2.8, 0, 1));
    var innerL = p.cx - p.hw + 18 + gap * 0.5;
    var innerR = p.cx + p.hw - 18 - gap * 0.5;
    if (innerR < innerL) {
      S.laneX = p.cx;
    } else {
      var wander = S.rng.range(-48, 48) * (0.45 + clamp(d * 0.2, 0, 0.7));
      S.laneX = clamp(S.laneX + wander, innerL, innerR);
    }
    var styleRoll = S.rng.next();
    var placed = 0;
    var depth = S.genDepth + S.rng.range(0, 8);

    if (styleRoll < 0.28) {
      var side = S.rng.next() < 0.5 ? -1 : 1;
      var big = S.rng.range(22, 36 + clamp(d * 4, 0, 8));
      var x = S.laneX + side * (gap * 0.5 + big + S.rng.range(6, 18));
      if (addRock(S, x, depth, big)) placed++;
    } else if (styleRoll < 0.58) {
      var g2 = gap * S.rng.range(0.92, 1.08);
      var leftX = S.laneX - g2 * 0.5;
      var rightX = S.laneX + g2 * 0.5;
      var rv = S.rng.range(16, 28);
      var path = samplePath(S, depth);
      var xl = lerp(path.cx - path.hw + rv + 10, leftX - rv - 4, 0.85);
      var xr = lerp(path.cx + path.hw - rv - 10, rightX + rv + 4, 0.85);
      if (addRock(S, xl, depth, rv + S.rng.range(-2, 4))) placed++;
      if (addRock(S, xr, depth + S.rng.range(8, 30), rv + S.rng.range(-2, 6))) placed++;
    } else if (styleRoll < 0.82) {
      var n = 2 + S.rng.int(0, d > 0.8 ? 3 : 2);
      for (var i = 0; i < n; i++) {
        var sd = depth + i * S.rng.range(36, 58);
        var sp = samplePath(S, sd);
        var side2 = S.rng.next() < 0.5 ? -1 : 1;
        if (i === 1) side2 = -side2;
        var vis = S.rng.range(13, 24);
        var x2 = S.laneX + side2 * (gap * 0.5 + vis + S.rng.range(4, 16));
        x2 = clamp(x2, sp.cx - sp.hw + vis + 12, sp.cx + sp.hw - vis - 12);
        if (addRock(S, x2, sd, vis)) placed++;
      }
    } else {
      var visN = S.rng.range(18, 30);
      var off = (S.rng.next() < 0.5 ? -1 : 1) * S.rng.range(8, 22);
      addRock(S, S.laneX + off, depth, visN);
      placed++;
    }

    var base = lerp(980, 560, clamp(d / 2.4, 0, 1));
    if (placed === 0) base *= 0.45;
    S.nextRockDepth = S.genDepth + S.rng.range(base * 0.75, base * 1.2);
    if (S.genDepth < 520) S.nextRockDepth = Math.max(S.nextRockDepth, 560);
  }

  function addItem(S, type, x, depth, extra) {
    var vis = type === "power" ? 17 : 12;
    var col = type === "power" ? 14 : 10.5;
    var it = {
      id: allocId(S),
      type: type,
      position: { x: x, depth: depth },
      active: true,
      visualRadius: vis,
      collisionRadius: col
    };
    if (type === "fragment") {
      it.formationId = extra.formationId;
      it.formationKind = extra.formationKind;
      it.formationIndex = extra.formationIndex;
    }
    S.items.push(it);
  }

  function maybeFormation(S) {
    if (S.genDepth < S.nextFormDepth) return;
    if (S.genDepth < 300) {
      S.nextFormDepth = 360;
      return;
    }
    var kinds = FORMATION_KINDS.slice();
    if (S.lastFormKind) {
      kinds = kinds.filter(function (k) {
        return k !== S.lastFormKind;
      });
    }
    var kind = S.rng.pick(kinds);
    S.lastFormKind = kind;
    var n = 3 + S.rng.int(0, 3);
    var fid = S.formSeq++;
    var p0 = samplePath(S, S.genDepth);
    var side = S.rng.next() < 0.5 ? -1 : 1;
    var risk = S.rng.next();
    var x0;
    if (risk < 0.38) x0 = S.laneX;
    else if (risk < 0.7) x0 = lerp(S.laneX, p0.cx, 0.55);
    else x0 = S.laneX + side * S.rng.range(18, 42);

    var depthGap = S.rng.range(82, 112);
    var latStep = S.rng.range(13, 20);
    var i;
    for (i = 0; i < n; i++) {
      var depth = S.genDepth + 10 + i * depthGap;
      var x = x0;
      if (kind === "line") {
        x = x0 + i * latStep * 0.35 * side;
      } else if (kind === "chevron") {
        var half = (n - 1) / 2;
        var u = i <= half ? i : n - 1 - i;
        x = x0 + u * latStep * side;
      } else if (kind === "triangle") {
        x = x0 + (i - (n - 1) / 2) * latStep * 0.7;
      } else if (kind === "wave") {
        x = x0 + Math.sin((i / Math.max(1, n - 1)) * Math.PI) * latStep * 1.35 * side;
      } else {
        x = x0 + Math.sin((i / Math.max(1, n - 1)) * Math.PI) * latStep * 1.6 * side;
      }
      var p = samplePath(S, depth);
      var m = 22;
      x = clamp(x, p.cx - p.hw + m, p.cx + p.hw - m);
      addItem(S, "fragment", x, depth, {
        formationId: fid,
        formationKind: kind,
        formationIndex: i
      });
    }
    var d = difficultyAt(S.genDepth);
    var gap = lerp(2100, 1680, clamp(d / 2.5, 0, 1));
    S.nextFormDepth = S.genDepth + n * depthGap + S.rng.range(gap * 0.65, gap);
  }

  function maybePower(S) {
    var target;
    if (S.powersPlaced === 0) target = S.firstPowerDepth;
    else if (S.powersPlaced === 1) target = S.secondPowerDepth;
    else target = S.nextPowerDepth;
    if (S.genDepth < target) return;
    var p = samplePath(S, S.genDepth);
    var x = clamp(p.cx, p.cx - p.hw + 28, p.cx + p.hw - 28);
    addItem(S, "power", x, S.genDepth + 6, null);
    S.powersPlaced += 1;
    S.nextPowerDepth = S.genDepth + 12000 + S.rng.range(6000, 14000);
  }

  function isPowered(S) {
    return S.timeMs < S.invincibleUntilMs;
  }

  function beginIfNeeded(S) {
    if (S.phase === "ready" && S.input.accel) S.phase = "playing";
  }

  function setInput(S, next) {
    if (next.accel != null) S.input.accel = !!next.accel;
    if (next.left != null) S.input.left = !!next.left;
    if (next.right != null) S.input.right = !!next.right;
    if (next.steer != null && isFinite(next.steer)) {
      S.input.steer = clamp(next.steer, -1, 1);
    } else {
      var st = 0;
      if (S.input.left && !S.input.right) st = -1;
      if (S.input.right && !S.input.left) st = 1;
      S.input.steer = st;
    }
    beginIfNeeded(S);
  }

  function circlesHit(ax, ad, ar, bx, bd, br) {
    var dx = ax - bx;
    var dd = ad - bd;
    var need = ar + br;
    return dx * dx + dd * dd < need * need;
  }

  function step(S) {
    if (S.phase !== "playing") return;
    S.tick += 1;
    S.elapsedMs += STEP_MS;
    S.timeMs += STEP_MS;
    S.remainingMs -= STEP_MS;

    generateUntil(S, S.depth + GEN_LOOKAHEAD);

    var dt = STEP_MS / 1000;
    var span = clamp((S.speed - CRAWL) / (MAX_SPEED - CRAWL), 0, 1);
    var accelHeld = !!S.input.accel;

    if (S.stallMs > 0) {
      S.stallMs -= STEP_MS;
      var t = clamp(S.stallMs / STALL_MS, 0, 1);
      S.speed = CRAWL + (S.stallFrom - CRAWL) * t;
      if (S.stallMs <= 0) {
        S.stallMs = 0;
        S.speed = CRAWL;
      }
    } else if (accelHeld) {
      S.speed = Math.min(MAX_SPEED, S.speed + ACCEL * dt);
    } else {
      S.speed = Math.max(CRAWL, S.speed - DECEL * dt);
    }
    if (S.speed < CRAWL) S.speed = CRAWL;

    if (S.speed > MAX_SPEED * 0.88) {
      S.throttleStreak += STEP_MS;
      if (S.throttleStreak > S.maxThrottleStreak) S.maxThrottleStreak = S.throttleStreak;
    } else {
      S.throttleStreak = 0;
    }

    var steer = S.input.steer;
    if (S.input.left || S.input.right) {
      if (S.input.left && !S.input.right) steer = -1;
      else if (S.input.right && !S.input.left) steer = 1;
    }
    steer = clamp(steer, -1, 1);
    var feel = span * span;
    var maxLat = lerp(LAT_CRAWL, LAT_FAST, feel);
    var resp = lerp(STEER_RESP_CRAWL, STEER_RESP_FAST, feel);
    var targetVx = steer * maxLat;
    S.vx = approach(S.vx, targetVx, resp * maxLat, dt);
    S.x += S.vx * dt;
    S.depth += S.speed * dt;
    if (S.depth > S.maxDepth) S.maxDepth = S.depth;
    S.difficulty = difficultyAt(S.depth);
    S.score = S.depth * SCORE_PER_DEPTH + S.bonusScore;

    var path = samplePath(S, S.depth);
    var left = path.cx - path.hw;
    var right = path.cx + path.hw;
    var pr = S.playerRadius;
    var hitWall = S.x - pr < left || S.x + pr > right;
    if (hitWall) {
      S.x = clamp(S.x, left + pr, right - pr);
      S.vx *= 0.15;
      if (!S.wallLatched) {
        S.wallLatched = true;
        S.wallContacts += 1;
        S.stallMs = STALL_MS;
        S.stallFrom = Math.max(S.speed, CRAWL);
        emit(S, "wall_contact");
      }
    } else {
      S.wallLatched = false;
    }

    var i;
    for (i = 0; i < S.rocks.length; i++) {
      var rock = S.rocks[i];
      if (!rock.active) continue;
      if (circlesHit(S.x, S.depth, pr, rock.position.x, rock.position.depth, rock.collisionRadius)) {
        rock.active = false;
        S.hitRockIds[rock.id] = 1;
        S.rocksBroken += 1;
        if (isPowered(S)) {
          S.remainingMs = Math.min(MAX_REMAINING, S.remainingMs + POWER_ROCK_MS);
          S.bonusScore += SCORE_POWER_ROCK;
          emit(S, "rock_broken");
        } else {
          S.hits += 1;
          S.stallMs = STALL_MS;
          S.stallFrom = Math.max(S.speed, CRAWL);
          emit(S, "rock_hit");
          emit(S, "rock_broken");
        }
      }
    }

    for (i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!it.active) continue;
      if (circlesHit(S.x, S.depth, pr, it.position.x, it.position.depth, it.collisionRadius)) {
        it.active = false;
        if (it.type === "fragment") {
          S.remainingMs = Math.min(MAX_REMAINING, S.remainingMs + FRAGMENT_MS);
          S.fragmentsCollected += 1;
          S.bonusScore += SCORE_FRAGMENT;
          emit(S, "fragment");
        } else {
          S.invincibleUntilMs = Math.max(S.invincibleUntilMs, S.timeMs) + POWER_MS;
          emit(S, "power");
        }
      }
    }

    S.sinceNearMiss += STEP_MS;
    if (S.sinceNearMiss > 1400) S.nearMissStreak = 0;
    for (i = 0; i < S.rocks.length; i++) {
      var rk = S.rocks[i];
      if (S.passedNear[rk.id] || S.hitRockIds[rk.id]) continue;
      if (S.depth >= rk.position.depth && S.depth - S.speed * dt < rk.position.depth) {
        S.passedNear[rk.id] = 1;
        if (!rk.active && S.hitRockIds[rk.id]) continue;
        var edge = Math.abs(S.x - rk.position.x) - pr - rk.collisionRadius;
        if (edge < pr * 2) {
          emit(S, "near_miss");
          S.nearMissStreak += 1;
          S.sinceNearMiss = 0;
          if (S.nearMissStreak > S.maxNearMissStreak) S.maxNearMissStreak = S.nearMissStreak;
          if (edge < S.closestShave) S.closestShave = Math.max(0, edge);
        }
      }
    }

    S.score = S.depth * SCORE_PER_DEPTH + S.bonusScore;
    if (S.tick % 30 === 0) prune(S);

    if (S.remainingMs <= 0) {
      S.remainingMs = 0;
      S.phase = "gameover";
      S.rank = rankFor(S.score);
    }
  }

  function startRun(S) {
    if (S.phase === "ready") S.phase = "playing";
  }

  function prune(S) {
    var minD = S.depth - BEHIND;
    var maxD = S.depth + GEN_LOOKAHEAD + 240;
    var keepR = [];
    var i;
    for (i = 0; i < S.rocks.length; i++) {
      var r = S.rocks[i];
      if (r.position.depth >= minD && r.position.depth <= maxD) keepR.push(r);
    }
    S.rocks = keepR;
    var keepI = [];
    for (i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (it.position.depth >= minD && it.position.depth <= maxD) keepI.push(it);
    }
    S.items = keepI;
  }

  function inHorizon(depth, S) {
    return depth >= S.depth - BEHIND && depth <= S.depth + HORIZON;
  }

  function snapshotWalls(S) {
    var out = [];
    var d0 = Math.max(0, S.depth - 40);
    var d1 = S.depth + HORIZON;
    for (var d = d0; d <= d1 + 0.01; d += 16) {
      var p = samplePath(S, d);
      out.push({ depth: r4(d), leftX: r4(p.cx - p.hw), rightX: r4(p.cx + p.hw) });
    }
    return out;
  }

  function rockIntervalAt(S, depth, left, right) {
    var cuts = [{ a: left, b: right }];
    for (var i = 0; i < S.rocks.length; i++) {
      var rk = S.rocks[i];
      if (!rk.active) continue;
      var dd = Math.abs(rk.position.depth - depth);
      if (dd > rk.collisionRadius + 4) continue;
      var y = Math.sqrt(Math.max(0, rk.collisionRadius * rk.collisionRadius - dd * dd));
      var rl = rk.position.x - y;
      var rr = rk.position.x + y;
      var next = [];
      for (var c = 0; c < cuts.length; c++) {
        var a = cuts[c].a;
        var b = cuts[c].b;
        if (rr <= a || rl >= b) {
          next.push(cuts[c]);
        } else {
          if (rl > a + 2) next.push({ a: a, b: Math.min(b, rl) });
          if (rr < b - 2) next.push({ a: Math.max(a, rr), b: b });
        }
      }
      cuts = next;
    }
    var best = 0;
    for (var k = 0; k < cuts.length; k++) best = Math.max(best, cuts[k].b - cuts[k].a);
    return best;
  }

  function safeHalfWidth(S) {
    var worst = 1e9;
    var d1 = S.depth + HORIZON;
    for (var d = S.depth; d <= d1; d += 18) {
      var p = samplePath(S, d);
      var w = rockIntervalAt(S, d, p.cx - p.hw, p.cx + p.hw);
      if (w < worst) worst = w;
    }
    if (worst > 1e8) {
      var p0 = samplePath(S, S.depth);
      worst = p0.hw * 2;
    }
    return Math.max(PLAYER_RADIUS + 4, worst * 0.5);
  }

  function copyRocks(S) {
    var list = [];
    for (var i = 0; i < S.rocks.length; i++) {
      var r = S.rocks[i];
      if (!inHorizon(r.position.depth, S)) continue;
      list.push({
        id: r.id,
        position: { x: r4(r.position.x), depth: r4(r.position.depth) },
        active: r.active,
        visualRadius: r4(r.visualRadius),
        collisionRadius: r4(r.collisionRadius)
      });
    }
    list.sort(function (a, b) {
      return a.id - b.id;
    });
    return list;
  }

  function copyItems(S) {
    var list = [];
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!inHorizon(it.position.depth, S)) continue;
      var o = {
        id: it.id,
        type: it.type,
        position: { x: r4(it.position.x), depth: r4(it.position.depth) },
        active: it.active,
        visualRadius: r4(it.visualRadius),
        collisionRadius: r4(it.collisionRadius)
      };
      if (it.type === "fragment") {
        o.formationId = it.formationId;
        o.formationKind = it.formationKind;
        o.formationIndex = it.formationIndex;
      }
      list.push(o);
    }
    list.sort(function (a, b) {
      return a.id - b.id;
    });
    return list;
  }

  function snapshot(S) {
    generateUntil(S, S.depth + GEN_LOOKAHEAD);
    prune(S);
    var path = samplePath(S, S.depth);
    var powered = isPowered(S);
    return {
      phase: S.phase,
      tick: S.tick,
      elapsedMs: r3(S.elapsedMs),
      timeMs: r3(S.timeMs),
      remainingMs: r3(S.remainingMs),
      seed: S.seed,
      rngState: S.rng.s >>> 0,
      spawnIndex: S.spawnIndex,
      input: {
        accel: !!S.input.accel,
        left: !!S.input.left,
        right: !!S.input.right,
        steer: r4(S.input.steer)
      },
      difficulty: r4(S.difficulty),
      score: r4(S.score),
      depth: r4(S.depth),
      x: r4(S.x),
      playerRadius: r4(S.playerRadius),
      speed: r4(S.speed),
      maxSpeed: r4(S.maxSpeed),
      hits: S.hits,
      wallContacts: S.wallContacts,
      fragmentsCollected: S.fragmentsCollected,
      rocksBroken: S.rocksBroken,
      invincibleUntilMs: r3(S.invincibleUntilMs),
      rank: S.phase === "gameover" ? S.rank : null,
      courseCenterX: r4(path.cx),
      corridorHalfWidth: r4(path.hw),
      walls: snapshotWalls(S),
      safeHalfWidth: r4(safeHalfWidth(S)),
      previewMs: r3((HORIZON / MAX_SPEED) * 1000),
      rocks: copyRocks(S),
      items: copyItems(S),
      events: S.events.map(function (e) {
        return { seq: e.seq, kind: e.kind, tick: e.tick };
      }),
      lastEvent: S.lastEvent ? { seq: S.lastEvent.seq, kind: S.lastEvent.kind, tick: S.lastEvent.tick } : null,
      powered: powered,
      closestShave: S.closestShave >= 1e8 ? null : r4(S.closestShave),
      maxThrottleStreak: r3(S.maxThrottleStreak),
      maxNearMissStreak: S.maxNearMissStreak,
      signature: S.phase === "gameover" ? signatureOf(S) : null
    };
  }

  function signatureOf(S) {
    if (S.closestShave < 1e8) {
      return {
        key: "shave",
        label: "Closest shave",
        value: r4(S.closestShave),
        text: (S.closestShave / (PLAYER_RADIUS * 2)).toFixed(2) + " widths"
      };
    }
    return {
      key: "commit",
      label: "Longest charge",
      value: r3(S.maxThrottleStreak),
      text: (S.maxThrottleStreak / 1000).toFixed(2) + "s at the edge"
    };
  }

  function advance(S, ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return;
    if (S.phase === "ready" || S.phase === "gameover") return;
    S.accMs += ms;
    var guard = 0;
    while (S.accMs + 1e-9 >= STEP_MS && guard++ < 12000) {
      S.accMs -= STEP_MS;
      step(S);
      if (S.phase !== "playing") break;
    }
  }

  function reset(S, seed) {
    resetInternal(S, seed == null ? S.seed : seed);
  }

  var api = {
    STEP_MS: STEP_MS,
    HORIZON: HORIZON,
    PLAYER_RADIUS: PLAYER_RADIUS,
    CRAWL: CRAWL,
    MAX_SPEED: MAX_SPEED,
    START_REMAINING: START_REMAINING,
    create: createSim,
    reset: reset,
    snapshot: snapshot,
    advance: advance,
    setInput: setInput,
    beginIfNeeded: beginIfNeeded,
    startRun: startRun,
    samplePath: samplePath,
    isPowered: isPowered,
    signatureOf: signatureOf,
    rankFor: rankFor
  };

  root.DelveSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
