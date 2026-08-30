/* Ember simulation — 60 Hz, seeded, snapshot-stable.
 * Snapshot precision: world positions/velocities 4 dp; score 2 dp;
 * height, dampY, dampSpeed, difficulty, launchReach, radii 4 dp;
 * elapsedMs 4 dp; integers unchanged.
 */
(function (root) {
  var DT = 1 / 60;
  var WALL_LEFT = 0;
  var WALL_RIGHT = 268;
  var PLAYER_R = 10.5;
  var JUMP_CAP = 3;
  var GRAVITY = 520;
  var MAX_SPEED = 490;
  var LAUNCH_REACH = (MAX_SPEED * MAX_SPEED) / (2 * GRAVITY);
  var WALL_SLIDE = 26;
  var LEDGE_THICK = 14;
  var LEAVE_TICKS = 8;
  var AIM_SLOW = 0.52;
  var DEADZONE = 18;
  var FULL_PULL = 152;
  var MOTH_VIS = 13;
  var MOTH_COL = 11;
  var GLIM_VIS = 9.5;
  var GLIM_COL = 8.2;
  var MOTH_KICK = 248;
  var HEIGHT_SCORE = 12;
  var START_Y = 92;
  var START_X = (WALL_LEFT + WALL_RIGHT) * 0.5;
  var DAMP_START_GAP = 280;

  var RANKS = [
    { name: "CINDER", min: 0 },
    { name: "WICK", min: 1600 },
    { name: "EMBER", min: 4200 },
    { name: "FLAME", min: 9000 },
    { name: "BLAZE", min: 18000 },
    { name: "BEACON", min: 36000 },
    { name: "SKYFIRE", min: 88000 }
  ];

  function r4(n) {
    return Math.round(n * 10000) / 10000;
  }
  function r2(n) {
    return Math.round(n * 100) / 100;
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }
  function hypot(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function createRng(seed) {
    var s = seed >>> 0;
    if (s === 0) s = 0xC2B2AE35;
    function next() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    }
    return {
      next: next,
      float: function (a, b) {
        return a + next() * (b - a);
      },
      int: function (a, b) {
        return Math.floor(a + next() * (b - a));
      },
      chance: function (p) {
        return next() < p;
      },
      getState: function () {
        return s;
      }
    };
  }

  function rankFor(score) {
    var name = RANKS[0].name;
    for (var i = 0; i < RANKS.length; i++) {
      if (score >= RANKS[i].min) name = RANKS[i].name;
    }
    return name;
  }

  function difficultyAt(y) {
    var h = Math.max(0, y - START_Y);
    return h / 380;
  }

  function dampSpeedAt(y) {
    var h = Math.max(0, y - START_Y);
    return 8.1 + Math.pow(h / 210, 1.13) * 4.35;
  }

  function glimmerValue(chainCount) {
    return 1600 * (1 + 0.4 * chainCount);
  }

  function chainBankValue(n) {
    if (n <= 0) return 0;
    return 36 * n * n;
  }

  function createState(seed, sessionBest) {
    var rng = createRng(seed >>> 0);
    var st = {
      phase: "ready",
      tick: 0,
      elapsedMs: 0,
      seed: seed >>> 0,
      rng: rng,
      spawnIndex: 1,
      input: {
        dragging: false,
        originX: 0,
        originY: 0,
        dx: 0,
        dy: 0,
        stageDx: 0,
        stageDy: 0
      },
      releaseQueued: false,
      x: START_X,
      y: START_Y + LEDGE_THICK * 0.5 + PLAYER_R,
      vx: 0,
      vy: 0,
      playerRadius: PLAYER_R,
      anchored: true,
      anchorKind: "ledge",
      jumpCapacity: JUMP_CAP,
      jumpsLeft: JUMP_CAP,
      launches: 0,
      midairLaunches: 0,
      landings: 0,
      refunds: 0,
      glimmersCollected: 0,
      chainCount: 0,
      chainBest: 0,
      chainBonusScore: 0,
      glimmerScore: 0,
      dampY: START_Y - DAMP_START_GAP,
      wallLeftX: WALL_LEFT,
      wallRightX: WALL_RIGHT,
      launchReach: LAUNCH_REACH,
      ledges: [],
      items: [],
      generatedUntil: -40,
      spineX: START_X,
      spineY: START_Y,
      lastEvent: null,
      height: START_Y + LEDGE_THICK * 0.5 + PLAYER_R,
      score: 0,
      sessionBest: sessionBest || 0,
      rank: null,
      leaveTicks: 0,
      worldTime: 0,
      startY: START_Y + LEDGE_THICK * 0.5 + PLAYER_R,
      anchorLedgeId: 0,
      face: "rest"
    };
    placeStartLedge(st);
    generateUntil(st, START_Y + LAUNCH_REACH * 8);
    snapToLedge(st, st.ledges[0]);
    st.height = st.y;
    recomputeScore(st);
    return st;
  }

  function nextId(st) {
    var id = st.spawnIndex;
    st.spawnIndex += 1;
    return id;
  }

  function placeStartLedge(st) {
    st.ledges.push({
      id: nextId(st),
      x: START_X,
      y: START_Y,
      halfWidth: 46,
      thick: LEDGE_THICK,
      active: true
    });
  }

  function addLedge(st, x, y, halfWidth) {
    var hw = halfWidth;
    var minX = WALL_LEFT + hw + 2;
    var maxX = WALL_RIGHT - hw - 2;
    x = clamp(x, minX, maxX);
    st.ledges.push({
      id: nextId(st),
      x: x,
      y: y,
      halfWidth: hw,
      thick: LEDGE_THICK,
      active: true
    });
    return st.ledges[st.ledges.length - 1];
  }

  function addItem(st, type, x, y, extra) {
    var it = {
      id: nextId(st),
      type: type,
      x: x,
      y: y,
      homeX: x,
      homeY: y,
      phase: extra.phase || 0,
      amp: extra.amp || 0,
      freq: extra.freq || 0,
      visualRadius: type === "moth" ? MOTH_VIS : GLIM_VIS,
      collisionRadius: type === "moth" ? MOTH_COL : GLIM_COL,
      active: true
    };
    var sparkX = st.x;
    var sparkY = st.y;
    var d = hypot(it.x - sparkX, it.y - sparkY);
    if (d < PLAYER_R + it.collisionRadius + 18) {
      it.y += 40;
      it.homeY = it.y;
    }
    st.items.push(it);
    return it;
  }

  function blocked(st, x, y, rad) {
    if (hypot(x - st.x, y - st.y) < PLAYER_R + rad + 20) return true;
    var n = st.ledges.length;
    var from = n > 8 ? n - 8 : 0;
    for (var i = from; i < n; i++) {
      var L = st.ledges[i];
      if (Math.abs(y - L.y) < 24 && Math.abs(x - L.x) < L.halfWidth + rad + 10) return true;
    }
    return false;
  }

  function generateUntil(st, untilY) {
    if (st.generatedUntil >= untilY) return;
    var rng = st.rng;
    if (st.ledges.length === 0) placeStartLedge(st);
    var y = st.spineY;
    var x = st.spineX;

    while (y < untilY) {
      var diff = clamp(difficultyAt(y), 0, 3.4);
      var t = clamp(diff / 2.6, 0, 1);
      var gap = mix(0.44, 0.62, t) * LAUNCH_REACH;
      gap += rng.float(-8, 8);
      gap = clamp(gap, 0.4 * LAUNCH_REACH, 0.68 * LAUNCH_REACH);

      var hw = mix(38, 24, t) + rng.float(-3, 4);
      hw = clamp(hw, 22, 44);

      var nx;
      var roll = rng.next();
      if (roll < 0.34) {
        nx = WALL_LEFT + hw + rng.float(2, 22);
      } else if (roll < 0.68) {
        nx = WALL_RIGHT - hw - rng.float(2, 22);
      } else {
        nx = mix(WALL_LEFT + 58, WALL_RIGHT - 58, rng.next());
      }
      var maxDx = LAUNCH_REACH * mix(0.48, 0.38, t);
      nx = clamp(nx, x - maxDx, x + maxDx);
      nx = clamp(nx, WALL_LEFT + hw + 2, WALL_RIGHT - hw - 2);

      var ny = y + gap;
      var midY = (y + ny) * 0.5;
      var openX = mix(WALL_LEFT + 70, WALL_RIGHT - 70, rng.next());

      var prevX = x;
      var prevY = y;
      x = nx;
      y = ny;
      addLedge(st, x, y, hw);
      st.spineX = x;
      st.spineY = y;

      if (t < 0.55 && rng.chance(mix(0.55, 0.18, t))) {
        var extraHw = rng.float(22, 32);
        var side = prevX < (WALL_LEFT + WALL_RIGHT) * 0.5 ? 1 : -1;
        var ex = clamp(
          prevX + side * rng.float(36, 70),
          WALL_LEFT + extraHw + 2,
          WALL_RIGHT - extraHw - 2
        );
        var ey = prevY + gap * rng.float(0.28, 0.55);
        if (Math.abs(ey - y) > 28 && Math.abs(ey - prevY) > 28) {
          addLedge(st, ex, ey, extraHw);
        }
      }

      var center = (WALL_LEFT + WALL_RIGHT) * 0.5;
      var glimmerChance = mix(0.42, 0.7, t);
      if (rng.chance(glimmerChance)) {
        var gx = mix(center - 28, center + 28, rng.next());
        gx = mix(gx, openX, 0.55);
        gx = clamp(gx, WALL_LEFT + 42, WALL_RIGHT - 42);
        var gy = midY + rng.float(-18, 22);
        if (Math.abs(gx - x) > 26 && Math.abs(gx - prevX) > 26 && !blocked(st, gx, gy, GLIM_COL)) {
          addItem(st, "glimmer", gx, gy, {
            phase: rng.float(0, Math.PI * 2),
            amp: rng.float(4, 9),
            freq: rng.float(1.1, 1.8)
          });
        }
      }

      var mothChance = mix(0.38, 0.72, t);
      if (rng.chance(mothChance)) {
        var count = 1;
        if (rng.chance(mix(0.12, 0.38, t))) count = 2;
        if (rng.chance(0.1 + t * 0.12)) count = 3;
        var stair = rng.chance(0.45);
        var mx = clamp(openX + rng.float(-24, 24), WALL_LEFT + 48, WALL_RIGHT - 48);
        var my = prevY + gap * 0.35;
        for (var i = 0; i < count; i++) {
          var px = stair
            ? mx + (i - (count - 1) * 0.5) * rng.float(18, 34)
            : mx + rng.float(-30, 30);
          var py = stair ? my + i * (gap * 0.28) : my + rng.float(-10, gap * 0.45);
          px = clamp(px, WALL_LEFT + 40, WALL_RIGHT - 40);
          if (py > prevY + 22 && py < y - 18 && !blocked(st, px, py, MOTH_COL)) {
            addItem(st, "moth", px, py, {
              phase: rng.float(0, Math.PI * 2),
              amp: rng.float(10, 22),
              freq: rng.float(0.55, 1.05)
            });
          }
        }
      }

      if (rng.chance(0.22 + t * 0.12)) {
        var mx2 = clamp(
          center + rng.float(-50, 50),
          WALL_LEFT + 44,
          WALL_RIGHT - 44
        );
        var my2 = midY + rng.float(10, gap * 0.4);
        if (my2 < y - 20 && !blocked(st, mx2, my2, MOTH_COL)) {
          addItem(st, "moth", mx2, my2, {
            phase: rng.float(0, Math.PI * 2),
            amp: rng.float(8, 16),
            freq: rng.float(0.6, 1.1)
          });
        }
      }
    }
    st.generatedUntil = y;
  }

  function snapToLedge(st, ledge) {
    var top = ledge.y + ledge.thick * 0.5;
    st.x = clamp(st.x, ledge.x - ledge.halfWidth + 2, ledge.x + ledge.halfWidth - 2);
    st.y = top + PLAYER_R;
    st.vx = 0;
    st.vy = 0;
    st.anchored = true;
    st.anchorKind = "ledge";
    st.anchorLedgeId = ledge.id;
  }

  function recomputeScore(st) {
    var climbed = Math.max(0, st.height - st.startY);
    st.score = climbed * HEIGHT_SCORE + st.glimmerScore + st.chainBonusScore;
  }

  function setEvent(st, kind) {
    st.lastEvent = { kind: kind, tick: st.tick };
  }

  function tryLaunch(st) {
    var dx = st.input.stageDx;
    var dy = st.input.stageDy;
    var pull = hypot(dx, dy);
    if (pull < DEADZONE) return false;
    if (st.jumpsLeft <= 0) return false;

    var t = clamp((pull - DEADZONE) / (FULL_PULL - DEADZONE), 0, 1);
    var speed = t * MAX_SPEED;
    var nx = dx / pull;
    var ny = dy / pull;
    var wasAnchored = st.anchored;
    var wasReady = st.phase === "ready";

    if (wasReady) st.phase = "playing";

    st.jumpsLeft -= 1;
    st.launches += 1;
    st.anchored = false;
    st.anchorKind = null;
    st.anchorLedgeId = 0;
    st.vx = -nx * speed;
    st.vy = ny * speed;
    st.leaveTicks = LEAVE_TICKS;
    setEvent(st, "launch");

    if (!wasAnchored) {
      st.midairLaunches += 1;
      st.chainCount += 1;
      setEvent(st, "chain");
    }

    return true;
  }

  function updateItems(st, dt) {
    for (var i = 0; i < st.items.length; i++) {
      var it = st.items[i];
      if (!it.active) continue;
      if (it.type === "moth") {
        it.x = it.homeX + Math.sin(st.worldTime * it.freq + it.phase) * it.amp;
        it.y = it.homeY + Math.cos(st.worldTime * it.freq * 0.73 + it.phase * 1.17) * it.amp * 0.34;
        it.x = clamp(it.x, WALL_LEFT + 28, WALL_RIGHT - 28);
      } else {
        it.x = it.homeX + Math.sin(st.worldTime * it.freq + it.phase) * it.amp * 0.35;
        it.y = it.homeY + Math.cos(st.worldTime * it.freq * 0.9 + it.phase) * it.amp * 0.5;
      }
    }
  }

  function landOn(st, kind, ledge) {
    var chained = st.chainCount;
    st.anchored = true;
    st.anchorKind = kind;
    st.vx = 0;
    if (kind === "ledge") {
      snapToLedge(st, ledge);
    } else {
      st.vy = -WALL_SLIDE;
    }
    st.jumpsLeft = st.jumpCapacity;
    st.landings += 1;
    setEvent(st, "land");
    if (chained > 0) {
      st.chainBonusScore += chainBankValue(chained);
      if (chained > st.chainBest) st.chainBest = chained;
      st.chainCount = 0;
      setEvent(st, "chainBank");
    } else {
      st.chainCount = 0;
    }
    recomputeScore(st);
  }

  function collectGlimmer(st, it) {
    it.active = false;
    st.glimmersCollected += 1;
    st.glimmerScore += glimmerValue(st.chainCount);
    setEvent(st, "glimmer");
    recomputeScore(st);
  }

  function burstMoth(st, it) {
    it.active = false;
    if (st.jumpsLeft < st.jumpCapacity) {
      st.jumpsLeft += 1;
      st.refunds += 1;
    }
    if (st.vy < MOTH_KICK) st.vy = MOTH_KICK;
    else st.vy += MOTH_KICK * 0.22;
    if (st.vy > MAX_SPEED * 1.2) st.vy = MAX_SPEED * 1.2;
    st.vx *= 0.82;
    st.anchored = false;
    st.anchorKind = null;
    setEvent(st, "bounce");
    st.chainCount += 1;
    setEvent(st, "chain");
  }

  function collideItems(st) {
    var r = PLAYER_R;
    for (var i = 0; i < st.items.length; i++) {
      var it = st.items[i];
      if (!it.active) continue;
      var dx = st.x - it.x;
      var dy = st.y - it.y;
      var rad = r + it.collisionRadius;
      if (dx * dx + dy * dy <= rad * rad) {
        if (it.type === "glimmer") collectGlimmer(st, it);
        else burstMoth(st, it);
      }
    }
  }

  function collideLedges(st, prevY) {
    if (st.leaveTicks > 0) return;
    var r = PLAYER_R;
    for (var i = 0; i < st.ledges.length; i++) {
      var L = st.ledges[i];
      if (!L.active) continue;
      if (Math.abs(st.y - L.y) > 80) continue;
      var top = L.y + L.thick * 0.5;
      var left = L.x - L.halfWidth;
      var right = L.x + L.halfWidth;
      if (st.x < left - r * 0.15 || st.x > right + r * 0.15) continue;
      var feetPrev = prevY - r;
      var feet = st.y - r;
      if (st.vy <= 90 && feetPrev >= top - 6 && feet <= top + 7) {
        landOn(st, "ledge", L);
        return;
      }
    }
  }

  function collideWalls(st) {
    if (st.leaveTicks > 0 && st.anchorKind !== "wall") {
      if (st.x - PLAYER_R < WALL_LEFT) {
        st.x = WALL_LEFT + PLAYER_R;
        if (st.vx < 0) st.vx *= -0.15;
      }
      if (st.x + PLAYER_R > WALL_RIGHT) {
        st.x = WALL_RIGHT - PLAYER_R;
        if (st.vx > 0) st.vx *= -0.15;
      }
      return;
    }
    if (st.anchored && st.anchorKind === "ledge") return;
    if (st.x - PLAYER_R <= WALL_LEFT + 0.4) {
      st.x = WALL_LEFT + PLAYER_R;
      if (!st.anchored || st.anchorKind !== "wall") {
        landOn(st, "wall", null);
      }
      st.x = WALL_LEFT + PLAYER_R;
      st.vx = 0;
    } else if (st.x + PLAYER_R >= WALL_RIGHT - 0.4) {
      st.x = WALL_RIGHT - PLAYER_R;
      if (!st.anchored || st.anchorKind !== "wall") {
        landOn(st, "wall", null);
      }
      st.x = WALL_RIGHT - PLAYER_R;
      st.vx = 0;
    }
  }

  function updateFace(st) {
    if (st.phase === "gameover") {
      st.face = "out";
      return;
    }
    if (st.anchored && st.anchorKind === "wall") {
      st.face = "cling";
      return;
    }
    if (st.input.dragging && (st.anchored || st.jumpsLeft > 0)) {
      st.face = "aim";
      return;
    }
    if (!st.anchored && st.jumpsLeft <= 0) {
      st.face = "fall";
      return;
    }
    if (!st.anchored) {
      st.face = "fly";
      return;
    }
    st.face = "rest";
  }

  function step(st) {
    if (st.phase === "gameover") {
      updateFace(st);
      return;
    }

    var wasPlaying = st.phase === "playing";
    if (wasPlaying) {
      st.tick += 1;
      st.elapsedMs = st.tick * (1000 / 60);
    }

    if (st.releaseQueued) {
      tryLaunch(st);
      st.releaseQueued = false;
      st.input.dragging = false;
      st.input.originX = 0;
      st.input.originY = 0;
      st.input.dx = 0;
      st.input.dy = 0;
      st.input.stageDx = 0;
      st.input.stageDy = 0;
    }

    if (st.phase !== "playing") {
      updateFace(st);
      return;
    }

    var ts = st.input.dragging ? AIM_SLOW : 1;
    var dt = DT * ts;
    st.worldTime += dt;

    if (st.leaveTicks > 0) st.leaveTicks -= 1;

    generateUntil(st, st.y + LAUNCH_REACH * 5);

    var prevY = st.y;

    if (st.anchored && st.anchorKind === "ledge") {
      st.vx = 0;
      st.vy = 0;
    } else if (st.anchored && st.anchorKind === "wall") {
      st.vy = -WALL_SLIDE;
      st.y += st.vy * dt;
      st.vx = 0;
      collideLedges(st, prevY);
    } else {
      st.vy -= GRAVITY * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;
    }

    updateItems(st, dt);
    collideItems(st);

    if (!st.anchored || st.anchorKind === "wall") {
      collideLedges(st, prevY);
    }
    collideWalls(st);

    if (st.y > st.height) st.height = st.y;

    st.dampY += dampSpeedAt(st.height) * dt;
    if (st.dampY > st.y - PLAYER_R * 0.15) {
      st.phase = "gameover";
      st.rank = rankFor(st.score);
      if (st.score > st.sessionBest) st.sessionBest = st.score;
      st.vx = 0;
      st.vy = 0;
      st.input.dragging = false;
      st.releaseQueued = false;
      st.face = "out";
      recomputeScore(st);
      return;
    }

    recomputeScore(st);
    updateFace(st);
  }

  function pointerDown(st, pageX, pageY, stageDx, stageDy) {
    if (st.phase === "gameover") return;
    st.input.dragging = true;
    st.input.originX = pageX;
    st.input.originY = pageY;
    st.input.dx = 0;
    st.input.dy = 0;
    st.input.stageDx = 0;
    st.input.stageDy = 0;
  }

  function pointerMove(st, pageX, pageY, stageDx, stageDy) {
    if (!st.input.dragging) return;
    st.input.dx = pageX - st.input.originX;
    st.input.dy = pageY - st.input.originY;
    st.input.stageDx = stageDx;
    st.input.stageDy = stageDy;
  }

  function pointerUp(st) {
    if (!st.input.dragging) return;
    if (st.phase === "gameover") {
      st.input.dragging = false;
      return;
    }
    st.releaseQueued = true;
    st.input.dragging = false;
    st.input.originX = 0;
    st.input.originY = 0;
    st.input.dx = 0;
    st.input.dy = 0;
  }

  function filterSpan(arr, y, reach, pick) {
    var lo = y - reach;
    var hi = y + reach * 2;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      var py = pick(e);
      if (py >= lo && py <= hi) out.push(e);
      else if (!e.active && py < lo) continue;
    }
    out.sort(function (a, b) {
      return a.id - b.id;
    });
    return out;
  }

  function snapshot(st) {
    var reach = st.launchReach;
    var ledges = filterSpan(st.ledges, st.y, reach, function (e) {
      return e.y;
    }).map(function (L) {
      return {
        id: L.id,
        position: { x: r4(L.x), y: r4(L.y) },
        halfWidth: r4(L.halfWidth),
        active: L.active
      };
    });
    var items = filterSpan(st.items, st.y, reach, function (e) {
      return e.y;
    }).map(function (it) {
      return {
        id: it.id,
        type: it.type,
        position: { x: r4(it.x), y: r4(it.y) },
        active: it.active,
        visualRadius: r4(it.visualRadius),
        collisionRadius: r4(it.collisionRadius)
      };
    });

    var dragging = !!st.input.dragging;
    return {
      phase: st.phase,
      tick: st.tick,
      elapsedMs: r4(st.elapsedMs),
      seed: st.seed,
      rngState: st.rng.getState(),
      spawnIndex: st.spawnIndex,
      input: {
        dragging: dragging,
        originX: dragging ? r4(st.input.originX) : 0,
        originY: dragging ? r4(st.input.originY) : 0,
        dx: dragging ? r4(st.input.dx) : 0,
        dy: dragging ? r4(st.input.dy) : 0
      },
      difficulty: r4(difficultyAt(st.height)),
      score: r2(st.score),
      height: r4(st.height),
      sessionBest: r2(st.sessionBest),
      rank: st.phase === "gameover" ? st.rank : null,
      x: r4(st.x),
      y: r4(st.y),
      vx: r4(st.vx),
      vy: r4(st.vy),
      playerRadius: r4(st.playerRadius),
      anchored: !!st.anchored,
      anchorKind: st.anchored ? st.anchorKind : null,
      jumpCapacity: st.jumpCapacity,
      jumpsLeft: st.jumpsLeft,
      launches: st.launches,
      midairLaunches: st.midairLaunches,
      landings: st.landings,
      refunds: st.refunds,
      glimmersCollected: st.glimmersCollected,
      chainCount: st.chainCount,
      chainBest: st.chainBest,
      dampY: r4(st.dampY),
      dampSpeed: r4(dampSpeedAt(st.height)),
      wallLeftX: r4(st.wallLeftX),
      wallRightX: r4(st.wallRightX),
      launchReach: r4(st.launchReach),
      ledges: ledges,
      items: items,
      lastEvent: st.lastEvent
        ? { kind: st.lastEvent.kind, tick: st.lastEvent.tick }
        : null
    };
  }

  root.EmberSim = {
    DT: DT,
    WALL_LEFT: WALL_LEFT,
    WALL_RIGHT: WALL_RIGHT,
    PLAYER_R: PLAYER_R,
    JUMP_CAP: JUMP_CAP,
    GRAVITY: GRAVITY,
    MAX_SPEED: MAX_SPEED,
    LAUNCH_REACH: LAUNCH_REACH,
    DEADZONE: DEADZONE,
    FULL_PULL: FULL_PULL,
    START_X: START_X,
    START_Y: START_Y,
    RANKS: RANKS,
    create: createState,
    step: step,
    snapshot: snapshot,
    pointerDown: pointerDown,
    pointerMove: pointerMove,
    pointerUp: pointerUp,
    rankFor: rankFor,
    glimmerValue: glimmerValue,
    chainBankValue: chainBankValue,
    difficultyAt: difficultyAt,
    dampSpeedAt: dampSpeedAt
  };
})(typeof window !== "undefined" ? window : globalThis);
