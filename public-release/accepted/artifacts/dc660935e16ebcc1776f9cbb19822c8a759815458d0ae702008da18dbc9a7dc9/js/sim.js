/* EMBER — the rules.
 *
 * One fixed 60 Hz step. reset(seed) plus the same tick-aligned launch sequence
 * always produces the same snapshots. Nothing in here reads Date.now(),
 * Math.random(), the renderer, or the audio.
 *
 * Snapshot precision: world positions, velocities, dampY, dampSpeed and
 * launchReach are rounded to 3 decimals; height to 3; difficulty to 4;
 * elapsedMs to 3; entity radii to 3; score, counters and ticks are integers.
 */
(function (E) {
  'use strict';

  var C = E.C;
  var clamp = E.clamp;

  function create() {
    var sim = {
      gen: E.Gen.create(),
      queue: [],           // tick-aligned player actions
      frameEvents: [],     // drained by view + audio; never read by the rules
      state: null
    };

    sim.state = {
      phase: 'ready',
      tick: 0,
      seed: 0,
      resetToken: 0,

      x: 50, y: C.START_Y + C.PLAYER_R, vx: 0, vy: 0,
      px: 50, py: C.START_Y + C.PLAYER_R,
      anchored: true, anchorKind: 'ledge',
      anchorLedgeId: 0,
      noLandId: -1, noLandT: 0,

      jumpCapacity: C.JUMP_CAP,
      jumpsLeft: C.JUMP_CAP,
      launches: 0, midairLaunches: 0, landings: 0,
      refunds: 0, glimmersCollected: 0,

      chainCount: 0, chainBest: 0,

      maxY: C.START_Y + C.PLAYER_R,
      height: 0, bonus: 0, score: 0,
      sessionBest: 0, newBest: false, rank: null,

      dampY: 0, dampSpeed: 0,
      lastEvent: null,

      input: { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0 }
    };

    /* ------------------------------------------------------------ events */

    function emit(kind, data) {
      var S = sim.state;
      S.lastEvent = { kind: kind, tick: S.tick };
      sim.frameEvents.push({ kind: kind, tick: S.tick, data: data || null });
    }

    /* ------------------------------------------------------------- reset */

    function reset(seed) {
      var S = sim.state;
      if (seed === undefined || seed === null) { seed = S.seed; }
      seed = (seed | 0) >>> 0;

      S.phase = 'ready';
      S.tick = 0;
      S.seed = seed;

      S.x = 50; S.y = C.START_Y + C.LEDGE_HT + C.PLAYER_R; S.vx = 0; S.vy = 0;
      S.px = S.x; S.py = S.y;
      S.anchored = true; S.anchorKind = 'ledge';
      S.anchorLedgeId = 0;
      S.noLandId = -1; S.noLandT = 0;

      S.jumpsLeft = C.JUMP_CAP;
      S.launches = 0; S.midairLaunches = 0; S.landings = 0;
      S.refunds = 0; S.glimmersCollected = 0;
      S.chainCount = 0; S.chainBest = 0;

      S.maxY = S.y;
      S.height = 0; S.bonus = 0; S.score = 0;
      S.newBest = false; S.rank = null;

      S.dampY = S.y - C.DAMP_START_GAP;
      S.dampSpeed = dampRate(S.dampY);
      S.lastEvent = null;

      S.input.dragging = false;
      S.input.originX = 0; S.input.originY = 0; S.input.dx = 0; S.input.dy = 0;

      sim.queue.length = 0;
      sim.frameEvents.length = 0;

      E.Gen.reset(sim.gen, seed);
      E.Gen.ensure(sim.gen, S.x, S.y);

      S.resetToken++;
      return sim;
    }

    /* ------------------------------------------------------------ pieces */

    function dampRate(dy) {
      var d = dy > 0 ? dy : 0;
      var v = 5.6 + d * 0.019 + d * d * 0.0000026;
      return v > C.DAMP_CAP ? C.DAMP_CAP : v;
    }

    function ledgeTop(L) { return L.y + C.LEDGE_HT; }

    function land(kind, ledge) {
      var S = sim.state;
      var before = S.jumpsLeft;
      S.anchored = true;
      S.anchorKind = kind;
      S.jumpsLeft = C.JUMP_CAP;
      S.landings++;
      emit('land', { kind: kind, x: S.x, y: S.y, refilled: C.JUMP_CAP - before });

      var n = S.chainCount;
      if (n > 0) {
        if (n > S.chainBest) { S.chainBest = n; }
        var pts = 0;
        for (var li = 1; li <= n; li++) {
          pts += C.CHAIN_LINK_VALUE * (li < C.CHAIN_LINK_CAP ? li : C.CHAIN_LINK_CAP);
        }
        S.bonus += pts;
        S.chainCount = 0;
        emit('chainBank', { links: n, points: pts, x: S.x, y: S.y });
      }
      if (ledge) { S.anchorLedgeId = ledge.id; }
    }

    function tryLaunch(act) {
      var S = sim.state;
      if (S.jumpsLeft <= 0) { return false; }

      var wasAnchored = S.anchored;
      var kind = S.anchorKind;

      S.jumpsLeft--;
      S.launches++;
      S.anchored = false;
      S.anchorKind = null;

      var p = C.MIN_POWER + (1 - C.MIN_POWER) * act.t;
      S.vx = act.dx * C.LAUNCH_V * p;
      S.vy = act.dy * C.LAUNCH_V * p;

      if (wasAnchored) {
        if (kind === 'wall') {
          // step off the soot so the same wall does not catch us again
          S.x += (S.x < 50 ? 0.7 : -0.7);
        } else {
          S.noLandId = (S.anchorLedgeId === undefined ? -1 : S.anchorLedgeId);
          S.noLandT = 7;
        }
      }

      emit('launch', { power: p, midair: !wasAnchored, x: S.x, y: S.y, dx: act.dx, dy: act.dy });

      if (!wasAnchored) {
        S.midairLaunches++;
        S.chainCount++;
        emit('chain', { link: S.chainCount, kind: 'launch', x: S.x, y: S.y });
      }
      return true;
    }

    function mothPos(m, t) {
      m.x = m.bx + m.amp * E.psin(m.phase + t * m.rate);
      m.y = m.by + m.vamp * E.psin(m.phase * 1.7 + 0.37 + t * m.rate * 1.6);
    }

    function items() {
      var S = sim.state;
      var arr = sim.gen.items;
      var t = S.tick * C.DT;
      var pr = C.PLAYER_R;

      for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (it.y < S.y - 120 || it.y > S.y + 260) { continue; }
        if (it.type === 'moth') { mothPos(it, t); }
        if (!it.active) { continue; }

        var dx = it.x - S.x, dy = it.y - S.y;
        var rr = (it.type === 'moth' ? C.MOTH_CR : C.GLIMMER_CR) + pr;
        if (dx * dx + dy * dy > rr * rr) { continue; }

        if (it.type === 'glimmer') {
          it.active = false;
          var mult = 1 + C.GLIMMER_CHAIN * Math.min(S.chainCount, C.GLIMMER_CHAIN_CAP);
          var pts = Math.round(C.GLIMMER_BASE * mult);
          S.bonus += pts;
          S.glimmersCollected++;
          emit('glimmer', { points: pts, chain: S.chainCount, x: it.x, y: it.y });
        } else {
          it.active = false;
          S.anchored = false;
          S.anchorKind = null;
          S.vy = C.BOUNCE_V;
          S.vx = S.vx * 0.55;
          if (S.jumpsLeft < C.JUMP_CAP) { S.jumpsLeft++; S.refunds++; }
          S.chainCount++;
          emit('bounce', { x: it.x, y: it.y, link: S.chainCount });
          emit('chain', { link: S.chainCount, kind: 'bounce', x: it.x, y: it.y });
        }
      }
    }

    function collideWorld() {
      var S = sim.state;
      var r = C.PLAYER_R;
      var arr = sim.gen.ledges;

      // ledges: landable from above only, so the spark can always launch up
      // through them
      var vyEff = (S.anchorKind === 'wall') ? -C.WALL_SLIDE : S.vy;
      if (vyEff <= 0) {
        for (var i = 0; i < arr.length; i++) {
          var L = arr[i];
          if (L.y < S.y - 40 || L.y > S.y + 40) { continue; }
          if (S.noLandT > 0 && L.id === S.noLandId) { continue; }
          var top = ledgeTop(L);
          if (S.py - r < top - 0.75) { continue; }
          if (S.y - r > top) { continue; }
          if (Math.abs(S.x - L.x) > L.hw + r * 0.55) { continue; }
          S.y = top + r;
          S.vx = 0; S.vy = 0;
          if (!S.anchored || S.anchorKind !== 'ledge') { land('ledge', L); }
          else { S.anchorLedgeId = L.id; }
          return;
        }
      }

      // walls: always catchable, but slick
      if (S.x - r <= C.WALL_L + 0.0001) {
        S.x = C.WALL_L + r;
        S.vx = 0;
        if (!S.anchored || S.anchorKind !== 'wall') { S.vy = -C.WALL_SLIDE * 0.35; land('wall', null); }
      } else if (S.x + r >= C.WALL_R - 0.0001) {
        S.x = C.WALL_R - r;
        S.vx = 0;
        if (!S.anchored || S.anchorKind !== 'wall') { S.vy = -C.WALL_SLIDE * 0.35; land('wall', null); }
      } else if (S.anchored && S.anchorKind === 'wall') {
        S.anchored = false;
        S.anchorKind = null;
      }
    }

    /* -------------------------------------------------------------- step */

    function step() {
      var S = sim.state;
      var q = sim.queue;
      var i;

      if (S.phase === 'gameover') { q.length = 0; return; }

      if (S.phase === 'ready') {
        var starts = false;
        for (i = 0; i < q.length; i++) {
          if (q[i].type === 'launch') { starts = true; break; }
        }
        if (!starts || S.jumpsLeft <= 0) { q.length = 0; return; }
        S.phase = 'playing';
      }

      S.tick++;

      for (i = 0; i < q.length; i++) {
        if (q[i].type === 'launch') { tryLaunch(q[i]); }
      }
      q.length = 0;

      if (S.noLandT > 0) { S.noLandT--; }

      S.px = S.x; S.py = S.y;

      if (S.anchored) {
        if (S.anchorKind === 'wall') {
          S.vy = -C.WALL_SLIDE;
          S.y += S.vy * C.DT;
        } else {
          S.vx = 0; S.vy = 0;
        }
      } else {
        S.vy -= C.G * C.DT;
        if (S.vy < -C.MAX_FALL) { S.vy = -C.MAX_FALL; }
        S.vx *= (1 - C.AIR_DRAG * C.DT);
        S.x += S.vx * C.DT;
        S.y += S.vy * C.DT;
      }

      items();
      if (!(S.anchored && S.anchorKind === 'ledge')) { collideWorld(); }

      if (S.y > S.maxY) { S.maxY = S.y; }
      S.height = S.maxY - (C.START_Y + C.LEDGE_HT + C.PLAYER_R);
      if (S.height < 0) { S.height = 0; }
      S.score = Math.floor(S.height * C.HEIGHT_SCORE + S.bonus);

      // the damp: rises always, and closes in if the spark pulls too far ahead
      var y0 = S.dampY;
      var rate = dampRate(S.dampY);
      S.dampY += rate * C.DT;
      var gap = S.y - S.dampY;
      if (gap > C.DAMP_MAX_GAP) {
        S.dampY += (gap - C.DAMP_MAX_GAP) * C.DAMP_CHASE * C.DT;
      }
      S.dampSpeed = (S.dampY - y0) / C.DT;

      E.Gen.ensure(sim.gen, S.x, S.y);
      E.Gen.prune(sim.gen, S.y);

      if (S.dampY >= S.y - C.PLAYER_R * 0.25) {
        S.phase = 'gameover';
        S.rank = E.rankFor(S.score);
        S.newBest = S.score > S.sessionBest;
        if (S.newBest) { S.sessionBest = S.score; }
      }
    }

    /* ---------------------------------------------------------- snapshot */

    function snapshot() {
      var S = sim.state;
      var R3 = E.round3;
      var lo = S.y - C.REACH - 2;
      var hi = S.y + 2.6 * C.REACH;

      var ledges = [];
      var src = sim.gen.ledges;
      for (var i = 0; i < src.length; i++) {
        var L = src[i];
        if (L.y < lo || L.y > hi) { continue; }
        ledges.push({
          id: L.id,
          position: { x: R3(L.x), y: R3(L.y) },
          halfWidth: R3(L.hw),
          active: true
        });
      }

      var its = [];
      var isrc = sim.gen.items;
      for (var j = 0; j < isrc.length; j++) {
        var it = isrc[j];
        if (it.y < lo || it.y > hi) { continue; }
        its.push({
          id: it.id,
          type: it.type,
          position: { x: R3(it.x), y: R3(it.y) },
          active: it.active,
          visualRadius: it.type === 'moth' ? C.MOTH_R : C.GLIMMER_R,
          collisionRadius: it.type === 'moth' ? C.MOTH_CR : C.GLIMMER_CR
        });
      }
      its.sort(function (a, b) { return a.id - b.id; });

      return {
        phase: S.phase,
        tick: S.tick,
        elapsedMs: R3(S.tick * 1000 / 60),
        seed: S.seed,
        rngState: sim.gen.rng ? (sim.gen.rng.s >>> 0) : 0,
        spawnIndex: sim.gen.spawnIndex,
        input: {
          dragging: S.input.dragging,
          originX: R3(S.input.originX),
          originY: R3(S.input.originY),
          dx: R3(S.input.dx),
          dy: R3(S.input.dy)
        },
        difficulty: E.round4(S.height / 500),
        score: S.score,
        height: R3(S.height),
        sessionBest: S.sessionBest,
        rank: S.rank,

        x: R3(S.x), y: R3(S.y), vx: R3(S.vx), vy: R3(S.vy),
        playerRadius: C.PLAYER_R,
        anchored: S.anchored,
        anchorKind: S.anchorKind,

        jumpCapacity: S.jumpCapacity,
        jumpsLeft: S.jumpsLeft,
        launches: S.launches,
        midairLaunches: S.midairLaunches,
        landings: S.landings,
        refunds: S.refunds,
        glimmersCollected: S.glimmersCollected,

        chainCount: S.chainCount,
        chainBest: S.chainBest,

        dampY: R3(S.dampY),
        dampSpeed: R3(S.dampSpeed),
        wallLeftX: C.WALL_L,
        wallRightX: C.WALL_R,
        launchReach: R3(C.REACH),

        ledges: ledges,
        items: its,

        lastEvent: S.lastEvent ? { kind: S.lastEvent.kind, tick: S.lastEvent.tick } : null
      };
    }

    // A release longer than the dead zone becomes one queued launch. The pull
    // is handed over already converted to world units and normalised, so the
    // rules never see pixels.
    function queueLaunch(dirX, dirY, t) {
      sim.queue.push({ type: 'launch', dx: dirX, dy: dirY, t: clamp(t, 0, 1) });
    }

    sim.reset = reset;
    sim.step = step;
    sim.snapshot = snapshot;
    sim.queueLaunch = queueLaunch;
    sim.dampRate = dampRate;
    return sim;
  }

  E.Sim = { create: create };

})(window.EMBER);
