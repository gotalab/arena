/* EMBER simulation core.
 * Pure deterministic rules: fixed 60Hz step, seeded RNG only, no Date.now()/Math.random() in here.
 * Exposed as global Ember.sim (classic script, no bundler) and as a CommonJS export for Node tests.
 */
(function (root) {
  'use strict';

  // ---------- constants ----------
  var STEP_MS = 1000 / 60;
  var STEP_DT = 1 / 60;

  var WORLD_WIDTH = 280;
  var WALL_MARGIN = 40;
  var WALL_LEFT_X = WALL_MARGIN;
  var WALL_RIGHT_X = WORLD_WIDTH - WALL_MARGIN; // 240
  var CENTER_X = (WALL_LEFT_X + WALL_RIGHT_X) / 2;

  var GRAVITY = 1600; // world units / s^2
  var MAX_LAUNCH_SPEED = 800;
  var MIN_LAUNCH_SPEED = 260;
  var LAUNCH_REACH = (MAX_LAUNCH_SPEED * MAX_LAUNCH_SPEED) / (2 * GRAVITY); // 200

  var DEADZONE_WORLD = 10;
  var PULL_MAX_WORLD = 118;

  var JUMP_CAPACITY = 3;
  var PLAYER_RADIUS = 11;

  var WALL_SLIDE_SPEED = 34;

  var MOTH_KICK_SPEED = 430;

  var DAMP_BASE_SPEED = 20;
  var DAMP_HEIGHT_FACTOR = 0.045;
  var DAMP_START_GAP = 300;

  var HEIGHT_SCORE_RATE = 1.6;
  var GLIMMER_BASE_SCORE = 140;
  var GLIMMER_CHAIN_MULTIPLIER = 2;
  var CHAIN_LINK_VALUE = 36;

  var SAFETY_MARGIN = 0.82;
  var REACH_EFF = LAUNCH_REACH * SAFETY_MARGIN; // 164
  var MIN_ROW_GAP = 88;
  var MAX_ROW_GAP = 150;
  var DIFFICULTY_ROWS = 42; // rows over which spacing ramps to max

  var GEN_AHEAD = LAUNCH_REACH * 3.2;
  var PRUNE_BEHIND = LAUNCH_REACH * 1.3;
  var REPORT_BEHIND = LAUNCH_REACH * 1.0;
  var REPORT_AHEAD = LAUNCH_REACH * 2.0;

  var RANKS = [
    { min: 0, grade: 'Cinder' },
    { min: 1200, grade: 'Ember' },
    { min: 3000, grade: 'Blaze' },
    { min: 6000, grade: 'Wildfire' },
    { min: 11000, grade: 'Aurora' },
    { min: 20000, grade: 'Starfall' }
  ];

  // ---------- rng (mulberry32, explicit state for reporting) ----------
  function hashSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return (seed >>> 0) || 1;
    var str = String(seed == null ? 'ember' : seed);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = h >>> 0;
    return h || 1;
  }

  function rngNext(rng) {
    var a = rng.state | 0;
    a = (a + 0x6d2b79f5) | 0;
    rng.state = a >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function rngRange(rng, lo, hi) {
    return lo + rngNext(rng) * (hi - lo);
  }

  // ---------- helpers ----------
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  function maxDxAtGap(gap) {
    var val = REACH_EFF - gap;
    if (val <= 0) return 0;
    return Math.sqrt(4 * LAUNCH_REACH * val);
  }

  function computeRank(score) {
    var grade = RANKS[0].grade;
    for (var i = 0; i < RANKS.length; i++) {
      if (score >= RANKS[i].min) grade = RANKS[i].grade;
    }
    return grade;
  }

  // ---------- factory ----------
  function createSim() {
    var s = {
      sessionBest: 0
    };

    function freshState(seed) {
      var rng = { state: hashSeed(seed) };
      var st = {
        phase: 'ready',
        tick: 0,
        elapsedMs: 0,
        seed: seed,
        rng: rng,
        spawnIndex: 0,

        input: { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0 },
        _worldOriginX: 0, _worldOriginY: 0, _worldDx: 0, _worldDy: 0,

        difficulty: 0,
        score: 0,
        height: 0,

        rank: null,

        player: {
          x: CENTER_X, y: PLAYER_RADIUS, vx: 0, vy: 0,
          anchored: true, anchorKind: 'ledge', anchorSide: null
        },

        jumpCapacity: JUMP_CAPACITY,
        jumpsLeft: JUMP_CAPACITY,
        launches: 0,
        midairLaunches: 0,
        landings: 0,
        refunds: 0,
        glimmersCollected: 0,

        chainCount: 0,
        chainBest: 0,
        _glimmerScoreAccum: 0,
        _chainScoreAccum: 0,

        dampY: -DAMP_START_GAP,
        dampSpeed: DAMP_BASE_SPEED,
        wallLeftX: WALL_LEFT_X,
        wallRightX: WALL_RIGHT_X,
        launchReach: LAUNCH_REACH,

        ledges: [],
        items: [],

        lastEvent: null,

        rowIndex: 1,
        _lastRowY: 0,
        _lastRowLedges: [CENTER_X]
      };

      // starting ledge (row 0)
      st.ledges.push({
        id: st.spawnIndex++,
        position: { x: CENTER_X, y: 0 },
        halfWidth: 34,
        active: true
      });

      // fill initial frontier
      while (st._lastRowY < GEN_AHEAD) {
        generateRow(st);
      }

      return st;
    }

    function spawnItemsForBand(st, bandY0, bandY1, ledgeXs) {
      var gapHeight = bandY1 - bandY0;
      if (gapHeight < 40) return;
      var difficultyT = clamp01(st.rowIndex / DIFFICULTY_ROWS);
      var count = rngNext(st.rng) < lerp(0.55, 0.85, difficultyT) ? 1 : 0;
      if (rngNext(st.rng) < lerp(0.12, 0.35, difficultyT)) count++;
      for (var i = 0; i < count; i++) {
        var y = lerp(bandY0 + gapHeight * 0.25, bandY0 + gapHeight * 0.75, rngNext(st.rng));
        // tempt away from the nearest safe ledge x
        var nearestLedgeX = ledgeXs.length ? ledgeXs[Math.floor(rngNext(st.rng) * ledgeXs.length)] : CENTER_X;
        var side = rngNext(st.rng) < 0.5 ? -1 : 1;
        var offset = lerp(46, 92, difficultyT) * side;
        var x = clamp(nearestLedgeX + offset, WALL_LEFT_X + 16, WALL_RIGHT_X - 16);
        var isMoth = rngNext(st.rng) < 0.55;
        if (isMoth) {
          st.items.push({
            id: st.spawnIndex++,
            type: 'moth',
            base: { x: x, y: y },
            position: { x: x, y: y },
            active: true,
            visualRadius: 13,
            collisionRadius: 10,
            ampX: rngRange(st.rng, 16, 30),
            ampY: rngRange(st.rng, 8, 16),
            freq: rngRange(st.rng, 0.55, 1.05),
            phase: rngRange(st.rng, 0, Math.PI * 2)
          });
        } else {
          st.items.push({
            id: st.spawnIndex++,
            type: 'glimmer',
            base: { x: x, y: y },
            position: { x: x, y: y },
            active: true,
            visualRadius: 10,
            collisionRadius: 9
          });
        }
      }
    }

    function generateRow(st) {
      var difficultyT = clamp01(st.rowIndex / DIFFICULTY_ROWS);
      var rowGap = clamp(lerp(MIN_ROW_GAP, MAX_ROW_GAP, difficultyT), MIN_ROW_GAP, REACH_EFF - 8);
      var rowY = st._lastRowY + rowGap;

      var sources = [WALL_LEFT_X, WALL_RIGHT_X];
      for (var i = 0; i < st._lastRowLedges.length; i++) sources.push(st._lastRowLedges[i]);

      var candidates = [];
      var lateralSpread = lerp(28, 95, difficultyT);
      var featureRoll = rngNext(st.rng);
      var featureCount = st.rowIndex < 3 ? 1 : (featureRoll < lerp(0.7, 0.2, difficultyT) ? 2 : (rngNext(st.rng) < 0.85 ? 1 : 0));
      for (i = 0; i < featureCount; i++) {
        var fx = clamp(CENTER_X + (rngNext(st.rng) * 2 - 1) * lateralSpread, WALL_LEFT_X + 15, WALL_RIGHT_X - 15);
        candidates.push(fx);
      }

      // coverage: every resting place from the previous row must reach some ledge this row
      var maxDx = maxDxAtGap(rowGap);
      for (i = 0; i < sources.length; i++) {
        var sx = sources[i];
        var covered = false;
        for (var j = 0; j < candidates.length; j++) {
          if (Math.abs(candidates[j] - sx) <= maxDx) { covered = true; break; }
        }
        if (!covered) candidates.push(sx);
      }

      candidates.sort(function (a, b) { return a - b; });
      var merged = [];
      for (i = 0; i < candidates.length; i++) {
        var x = candidates[i];
        if (merged.length && Math.abs(x - merged[merged.length - 1]) < 14) continue;
        merged.push(x);
      }

      var ledgeXs = [];
      for (i = 0; i < merged.length; i++) {
        var hw = 22 + rngNext(st.rng) * 16;
        st.ledges.push({
          id: st.spawnIndex++,
          position: { x: merged[i], y: rowY },
          halfWidth: hw,
          active: true
        });
        ledgeXs.push(merged[i]);
      }

      spawnItemsForBand(st, st._lastRowY, rowY, ledgeXs);

      st._lastRowY = rowY;
      st._lastRowLedges = ledgeXs;
      st.rowIndex++;
    }

    function ensureGeneration(st) {
      while (st._lastRowY < st.player.y + GEN_AHEAD) {
        generateRow(st);
      }
    }

    function pruneOld(st) {
      var thresh = st.player.y - PRUNE_BEHIND;
      st.ledges = st.ledges.filter(function (l) { return l.position.y >= thresh; });
      st.items = st.items.filter(function (it) { return it.position.y >= thresh; });
    }

    function updateItemPositions(st) {
      var t = st.elapsedMs / 1000;
      for (var i = 0; i < st.items.length; i++) {
        var it = st.items[i];
        if (!it.active || it.type !== 'moth') continue;
        it.position.x = it.base.x + Math.sin(t * it.freq + it.phase) * it.ampX;
        it.position.y = it.base.y + Math.sin(t * it.freq * 0.6 + it.phase + 1.7) * it.ampY * 0.5;
      }
    }

    function recomputeScore(st) {
      var heightScore = Math.round(st.height * HEIGHT_SCORE_RATE);
      st.score = heightScore + st._glimmerScoreAccum + st._chainScoreAccum;
    }

    function doLaunch(st) {
      if (st.jumpsLeft <= 0) return;
      var dx = st._worldDx, dy = st._worldDy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < DEADZONE_WORLD) return; // cancel: dead zone

      var wasAnchored = st.player.anchored;
      var pull = Math.min(dist, PULL_MAX_WORLD);
      var t = clamp01((pull - DEADZONE_WORLD) / (PULL_MAX_WORLD - DEADZONE_WORLD));
      var speed = lerp(MIN_LAUNCH_SPEED, MAX_LAUNCH_SPEED, t);
      var nx = -dx / dist, ny = -dy / dist;

      if (st.phase === 'ready') {
        st.phase = 'playing';
      }

      st.player.vx = nx * speed;
      st.player.vy = ny * speed;
      st.player.anchored = false;
      st.player.anchorKind = null;
      st.player.anchorSide = null;

      st.jumpsLeft -= 1;
      st.launches += 1;
      st.lastEvent = { kind: 'launch', tick: st.tick };

      if (!wasAnchored) {
        st.midairLaunches += 1;
        st.chainCount += 1;
        st.lastEvent = { kind: 'chain', tick: st.tick };
      }
    }

    function landOn(st, kind, x, y, side) {
      st.player.x = x;
      st.player.y = y;
      st.player.vx = 0;
      st.player.vy = 0;
      st.player.anchored = true;
      st.player.anchorKind = kind;
      st.player.anchorSide = side || null;
      st.jumpsLeft = st.jumpCapacity;
      st.landings += 1;

      if (st.chainCount > 0) {
        st.chainBest = Math.max(st.chainBest, st.chainCount);
        var bonus = Math.round(CHAIN_LINK_VALUE * st.chainCount * (st.chainCount + 1) / 2);
        st._chainScoreAccum += bonus;
        st.chainCount = 0;
        st.lastEvent = { kind: 'land', tick: st.tick };
        st.lastEvent = { kind: 'chainBank', tick: st.tick };
      } else {
        st.lastEvent = { kind: 'land', tick: st.tick };
      }
    }

    function stepPhysics(st) {
      var p = st.player;

      if (p.anchored && p.anchorKind === 'wall') {
        p.y -= WALL_SLIDE_SPEED * STEP_DT;
      } else if (!p.anchored) {
        var prevY = p.y;
        p.vy -= GRAVITY * STEP_DT;
        p.x += p.vx * STEP_DT;
        p.y += p.vy * STEP_DT;

        // wall collision
        if (p.x - PLAYER_RADIUS <= WALL_LEFT_X && p.vx <= 0) {
          landOn(st, 'wall', WALL_LEFT_X + PLAYER_RADIUS, p.y, 'left');
        } else if (p.x + PLAYER_RADIUS >= WALL_RIGHT_X && p.vx >= 0) {
          landOn(st, 'wall', WALL_RIGHT_X - PLAYER_RADIUS, p.y, 'right');
        }

        if (!p.anchored) {
          updateItemPositions(st);
          // item collisions
          for (var i = 0; i < st.items.length; i++) {
            var it = st.items[i];
            if (!it.active) continue;
            var ddx = p.x - it.position.x, ddy = p.y - it.position.y;
            var rr = PLAYER_RADIUS + it.collisionRadius;
            if (ddx * ddx + ddy * ddy <= rr * rr) {
              it.active = false;
              if (it.type === 'glimmer') {
                st.glimmersCollected += 1;
                var mult = st.chainCount > 0 ? GLIMMER_CHAIN_MULTIPLIER : 1;
                st._glimmerScoreAccum += GLIMMER_BASE_SCORE * mult;
                st.lastEvent = { kind: 'glimmer', tick: st.tick };
              } else {
                st.refunds += 1;
                st.jumpsLeft = Math.min(st.jumpCapacity, st.jumpsLeft + 1);
                p.vy = Math.max(p.vy, MOTH_KICK_SPEED);
                st.lastEvent = { kind: 'bounce', tick: st.tick };
                st.chainCount += 1;
                st.lastEvent = { kind: 'chain', tick: st.tick };
              }
            }
          }
        }

        if (!p.anchored && p.vy <= 0) {
          var bottomPrev = prevY - PLAYER_RADIUS;
          var bottomNew = p.y - PLAYER_RADIUS;
          for (var k = 0; k < st.ledges.length; k++) {
            var l = st.ledges[k];
            if (!l.active) continue;
            var surfaceY = l.position.y;
            if (bottomPrev >= surfaceY && bottomNew <= surfaceY) {
              if (Math.abs(p.x - l.position.x) <= l.halfWidth + PLAYER_RADIUS * 0.4) {
                landOn(st, 'ledge', p.x, surfaceY + PLAYER_RADIUS, null);
                break;
              }
            }
          }
        }
      }

      st.height = Math.max(st.height, p.y);
      st.difficulty = st.height / LAUNCH_REACH;
      st.dampSpeed = DAMP_BASE_SPEED + DAMP_HEIGHT_FACTOR * st.height;
      st.dampY += st.dampSpeed * STEP_DT;

      if (p.y - PLAYER_RADIUS <= st.dampY) {
        st.phase = 'gameover';
        st.rank = computeRank(st.score);
        recomputeScore(st);
        s.sessionBest = Math.max(s.sessionBest, st.score);
        return;
      }

      ensureGeneration(st);
      pruneOld(st);
      recomputeScore(st);
      s.sessionBest = Math.max(s.sessionBest, st.score);
    }

    function reset(seed) {
      s.state = freshState(seed);
      return snapshot();
    }

    function pointerDown(rawX, rawY, worldX, worldY) {
      var st = s.state;
      if (!st || st.phase === 'gameover') return;
      st.input.dragging = true;
      st.input.originX = rawX;
      st.input.originY = rawY;
      st.input.dx = 0;
      st.input.dy = 0;
      st._worldOriginX = worldX;
      st._worldOriginY = worldY;
      st._worldDx = 0;
      st._worldDy = 0;
    }

    function pointerMove(rawX, rawY, worldX, worldY) {
      var st = s.state;
      if (!st || !st.input.dragging) return;
      st.input.dx = rawX - st.input.originX;
      st.input.dy = rawY - st.input.originY;
      st._worldDx = worldX - st._worldOriginX;
      st._worldDy = worldY - st._worldOriginY;
    }

    function pointerUp(rawX, rawY, worldX, worldY) {
      var st = s.state;
      if (!st) return;
      if (st.input.dragging) {
        st.input.dx = rawX - st.input.originX;
        st.input.dy = rawY - st.input.originY;
        st._worldDx = worldX - st._worldOriginX;
        st._worldDy = worldY - st._worldOriginY;
        doLaunch(st);
      }
      st.input.dragging = false;
      st.input.originX = 0; st.input.originY = 0; st.input.dx = 0; st.input.dy = 0;
      st._worldOriginX = 0; st._worldOriginY = 0; st._worldDx = 0; st._worldDy = 0;
    }

    function pointerCancel() {
      var st = s.state;
      if (!st) return;
      st.input.dragging = false;
      st.input.originX = 0; st.input.originY = 0; st.input.dx = 0; st.input.dy = 0;
      st._worldOriginX = 0; st._worldOriginY = 0; st._worldDx = 0; st._worldDy = 0;
    }

    function step() {
      var st = s.state;
      if (!st || st.phase !== 'playing') return;
      st.tick += 1;
      st.elapsedMs = round2(st.tick * STEP_MS);
      stepPhysics(st);
    }

    function snapshot() {
      var st = s.state;
      var loY = st.player.y - REPORT_BEHIND;
      var hiY = st.player.y + REPORT_AHEAD;
      var ledges = st.ledges
        .filter(function (l) { return l.position.y >= loY && l.position.y <= hiY; })
        .sort(function (a, b) { return a.id - b.id; })
        .map(function (l) {
          return {
            id: l.id,
            position: { x: round2(l.position.x), y: round2(l.position.y) },
            halfWidth: round2(l.halfWidth),
            active: l.active
          };
        });
      var items = st.items
        .filter(function (it) { return it.position.y >= loY && it.position.y <= hiY; })
        .sort(function (a, b) { return a.id - b.id; })
        .map(function (it) {
          return {
            id: it.id,
            type: it.type,
            position: { x: round2(it.position.x), y: round2(it.position.y) },
            active: it.active,
            visualRadius: it.visualRadius,
            collisionRadius: it.collisionRadius
          };
        });

      return {
        phase: st.phase,
        tick: st.tick,
        elapsedMs: st.elapsedMs,
        seed: st.seed,
        rngState: st.rng.state,
        spawnIndex: st.spawnIndex,
        input: {
          dragging: st.input.dragging,
          originX: st.input.originX,
          originY: st.input.originY,
          dx: st.input.dx,
          dy: st.input.dy
        },
        difficulty: round3(st.difficulty),
        score: st.score,
        height: round2(st.height),
        sessionBest: s.sessionBest,
        rank: st.rank,

        player: {
          x: round2(st.player.x),
          y: round2(st.player.y),
          vx: round2(st.player.vx),
          vy: round2(st.player.vy),
          playerRadius: PLAYER_RADIUS,
          anchored: st.player.anchored,
          anchorKind: st.player.anchorKind
        },

        jumpCapacity: st.jumpCapacity,
        jumpsLeft: st.jumpsLeft,
        launches: st.launches,
        midairLaunches: st.midairLaunches,
        landings: st.landings,
        refunds: st.refunds,
        glimmersCollected: st.glimmersCollected,

        chainCount: st.chainCount,
        chainBest: st.chainBest,

        dampY: round2(st.dampY),
        dampSpeed: round2(st.dampSpeed),
        wallLeftX: st.wallLeftX,
        wallRightX: st.wallRightX,
        launchReach: st.launchReach,

        ledges: ledges,
        items: items,

        lastEvent: st.lastEvent ? { kind: st.lastEvent.kind, tick: st.lastEvent.tick } : null
      };
    }

    return {
      reset: reset,
      snapshot: snapshot,
      step: step,
      pointerDown: pointerDown,
      pointerMove: pointerMove,
      pointerUp: pointerUp,
      pointerCancel: pointerCancel,
      constants: {
        STEP_MS: STEP_MS, WORLD_WIDTH: WORLD_WIDTH, WALL_LEFT_X: WALL_LEFT_X, WALL_RIGHT_X: WALL_RIGHT_X,
        LAUNCH_REACH: LAUNCH_REACH, PLAYER_RADIUS: PLAYER_RADIUS, JUMP_CAPACITY: JUMP_CAPACITY,
        CENTER_X: CENTER_X, DEADZONE_WORLD: DEADZONE_WORLD, PULL_MAX_WORLD: PULL_MAX_WORLD
      }
    };
  }

  var api = { createSim: createSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.Ember = root.Ember || {}; root.Ember.simApi = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
