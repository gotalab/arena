/* STOMP - presentation layer.
 *
 * Everything here is view-only dressing. It reads the simulation and never
 * writes to it. Particles, shake, squash, moods and glow live in this module's
 * own state and use their own random source so the seeded run is untouched.
 */
(function (global) {
  'use strict';

  var K = global.STOMP_K;
  var TAU = Math.PI * 2;

  var C = {
    void0: '#05040f',
    void1: '#0d0a24',
    void2: '#1d1140',
    haze: '#3b1f6e',
    ground0: '#150e2c',
    ground1: '#0a0718',
    cyan: '#62f0ff',
    mag: '#ff5fd0',
    amber: '#ffbe3d',
    lime: '#a6ff5e',
    red: '#ff4d63',
    violet: '#8a5cff',
    steel0: '#2b3557',
    steel1: '#151b33',
    steel2: '#0d1124',
    ink: '#eaf6ff'
  };

  var FONT = '900 %spx "Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif';
  var FONT_M = '700 %spx system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  function f(size) { return FONT.replace('%s', size); }
  function fm(size) { return FONT_M.replace('%s', size); }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ------------------------------------------------------- glow sprites */

  var glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    var s = 128;
    var cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, hexA(color, 0.55));
    grad.addColorStop(0.7, hexA(color, 0.14));
    grad.addColorStop(1, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    glowCache[color] = cv;
    return cv;
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function glow(ctx, x, y, r, color, alpha) {
    if (r <= 0 || alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  /* --------------------------------------------------------------- view */

  var V = {
    t: 0,
    seq: 0,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    flash: 0,
    flashColor: C.cyan,
    parts: [],
    floats: [],
    rings: [],
    trail: [],
    lanePulse: { low: 0, high: 0 },
    machSquash: 0,
    machLean: 0,
    tread: 0,
    antenna: { x: 0, v: 0 },
    ballSquash: 0,
    blink: 0,
    nextBlink: 2,
    hitT: 0,
    burstT: 0,
    hurtT: 0,
    dropT: 0,
    powerT: 0,
    landT: 0,
    jumpT: 0,
    stompT: 0,
    tension: 0,
    motes: [],
    towers: [],
    rand: 12345,
    bestScore: 0,
    overT: 0,
    readyT: 0
  };

  function vr() {
    V.rand = (V.rand * 1664525 + 1013904223) >>> 0;
    return V.rand / 4294967296;
  }
  function vrr(a, b) { return a + vr() * (b - a); }

  function initScenery() {
    V.motes = [];
    for (var i = 0; i < 40; i++) {
      V.motes.push({
        x: vrr(0, K.W), y: vrr(40, K.GROUND_Y),
        r: vrr(0.6, 2.2), s: vrr(4, 15), p: vrr(0, TAU),
        c: vr() < 0.5 ? C.cyan : C.mag, a: vrr(0.12, 0.45)
      });
    }
    /* two skyline layers, both kept below the low lane so the rails stay clean */
    V.towers = [];
    for (var j = 0; j < 22; j++) {
      var far = j < 12;
      V.towers.push({
        x: vrr(-34, K.W + 14),
        w: far ? vrr(14, 30) : vrr(26, 58),
        h: far ? vrr(34, 92) : vrr(50, 140),
        d: far ? vrr(0.06, 0.18) : vrr(0.26, 0.5),
        lit: vr() < 0.7,
        tint: vr() < 0.5 ? C.cyan : C.mag
      });
    }
    V.towers.sort(function (a, b) { return a.d - b.d; });
    /* light shafts rising off the arena floor */
    V.shafts = [];
    for (var s = 0; s < 5; s++) {
      V.shafts.push({ x: vrr(20, K.W - 20), w: vrr(16, 44), p: vrr(0, TAU), c: vr() < 0.5 ? C.mag : C.cyan });
    }
    /* the crowd: a rim of tiny lights along the arena edge */
    V.crowd = [];
    for (var c2 = 0; c2 < 54; c2++) {
      V.crowd.push({ x: vrr(2, K.W - 2), y: vrr(2, 9), r: vrr(0.7, 1.7), p: vrr(0, TAU), c: vr() < 0.4 ? C.amber : (vr() < 0.5 ? C.cyan : C.mag) });
    }
  }

  /* ----------------------------------------------------- fx spawners */

  function burst(x, y, n, color, spd, life) {
    for (var i = 0; i < n; i++) {
      var a = vrr(0, TAU);
      var s = vrr(spd * 0.35, spd);
      V.parts.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - spd * 0.18,
        r: vrr(1.3, 3.4), life: 0, max: life || vrr(0.3, 0.72),
        c: color, g: 320, kind: 'spark'
      });
    }
  }
  function shards(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = vrr(-Math.PI, 0);
      var s = vrr(60, 250);
      V.parts.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: vrr(2.2, 5.2), life: 0, max: vrr(0.5, 1.0),
        c: color, g: 520, kind: 'shard', rot: vrr(0, TAU), spin: vrr(-9, 9)
      });
    }
  }
  function smoke(x, y, n, color) {
    for (var i = 0; i < n; i++) {
      V.parts.push({
        x: x + vrr(-4, 4), y: y + vrr(-4, 4),
        vx: vrr(-18, 18), vy: vrr(-38, -12),
        r: vrr(3, 7), life: 0, max: vrr(0.5, 1.1),
        c: color, g: -22, kind: 'smoke'
      });
    }
  }
  function ring(x, y, r0, r1, color, life, w) {
    V.rings.push({ x: x, y: y, r0: r0, r1: r1, c: color, life: 0, max: life, w: w || 3 });
  }
  function floatText(x, y, text, color, size) {
    // Readability beats spectacle: age out older labels rather than stacking
    // four of them over the lanes during a busy pattern.
    while (V.floats.length >= 3) V.floats.shift();
    for (var i = 0; i < V.floats.length; i++) {
      V.floats[i].life = Math.max(V.floats[i].life, V.floats[i].max * 0.55);
    }
    V.floats.push({ x: x, y: y, text: text, c: color, life: 0, max: 0.95, size: size || 13 });
  }

  /* -------------------------------------------------- event consumption */

  function findEnemy(sim, id) {
    for (var i = 0; i < sim.enemies.length; i++) if (sim.enemies[i].id === id) return sim.enemies[i];
    return null;
  }

  function consume(sim, audio) {
    for (var i = 0; i < sim.events.length; i++) {
      var e = sim.events[i];
      if (e.sequence <= V.seq) continue;
      V.seq = e.sequence;
      var en = e.enemyId != null ? findEnemy(sim, e.enemyId) : null;
      var b = sim.ball, m = sim.machine;

      switch (e.kind) {
        case 'ball_bounce_weak':
          V.ballSquash = 1; V.machSquash = 0.55;
          ring(b.x, b.y + 8, 4, 20, C.violet, 0.28, 2);
          burst(b.x, b.y + 9, 5, C.violet, 90);
          if (audio) audio.bounce('weak');
          break;
        case 'ball_bounce_normal':
          V.ballSquash = 1; V.machSquash = 0.8;
          ring(b.x, b.y + 8, 5, 30, C.cyan, 0.3, 2.5);
          burst(b.x, b.y + 9, 9, C.cyan, 140);
          if (audio) audio.bounce('normal');
          break;
        case 'ball_bounce_power':
          V.ballSquash = 1.4; V.machSquash = 1; V.powerT = 0.55; V.shake = Math.max(V.shake, 3);
          ring(b.x, b.y + 8, 6, 44, C.mag, 0.42, 3.5);
          ring(b.x, b.y + 8, 3, 26, C.ink, 0.24, 2);
          burst(b.x, b.y + 9, 16, C.mag, 210);
          if (audio) audio.bounce('power');
          break;
        case 'machine_jump':
          V.jumpT = 0.3; V.machSquash = -0.5;
          ring(m.x, m.y + K.MACH_HALF_H, 6, 32, C.cyan, 0.3, 2);
          for (var q = 0; q < 7; q++) {
            V.parts.push({
              x: m.x + vrr(-16, 16), y: m.y + K.MACH_HALF_H, vx: vrr(-70, 70), vy: vrr(-10, 40),
              r: vrr(1.5, 3), life: 0, max: vrr(0.2, 0.42), c: C.cyan, g: 200, kind: 'spark'
            });
          }
          if (audio) audio.jump();
          break;
        case 'machine_land':
          V.landT = 0.24; V.machSquash = 0.7;
          burst(m.x, m.y + K.MACH_HALF_H, 6, C.amber, 100, 0.3);
          if (audio) audio.land();
          break;
        case 'top_hit':
          V.hitT = 0.36; V.shake = Math.max(V.shake, 5);
          V.flash = 0.22; V.flashColor = C.ink;
          V.ballSquash = 1.3;
          if (en) {
            var pal = en.type === 'fastFlyer' ? C.amber : C.lime;
            ring(en.x, en.y - en.visualRadius * 0.5, 6, 46 + en.hitsTaken * 10, pal, 0.36, 3);
            burst(en.x, en.y - en.visualRadius * 0.6, 16 + en.hitsTaken * 5, pal, 250);
            shards(en.x, en.y - en.visualRadius * 0.5, 4 + en.hitsTaken * 2, C.ink);
            V.lanePulse[en.lane] = 1;
            floatText(en.x, en.y - en.visualRadius - 14, '+' + (e.amountMs / 1000).toFixed(1) + 's', pal, 13 + en.hitsTaken * 2);
          }
          if (audio) audio.topHit(en ? en.hitsTaken : 1);
          break;
        case 'enemy_defeated':
          V.burstT = 0.7; V.shake = Math.max(V.shake, 13);
          V.flash = 0.5; V.flashColor = C.ink;
          if (en) {
            var pc = en.type === 'fastFlyer' ? C.amber : C.lime;
            ring(en.x, en.y, 8, 130, pc, 0.62, 5);
            ring(en.x, en.y, 4, 78, C.ink, 0.4, 3);
            ring(en.x, en.y, 2, 190, pc, 0.9, 1.6);
            burst(en.x, en.y, 46, pc, 420, 0.95);
            burst(en.x, en.y, 22, C.ink, 300, 0.6);
            shards(en.x, en.y, 16, pc);
            smoke(en.x, en.y, 10, C.haze);
            V.lanePulse[en.lane] = 1.6;
            floatText(en.x, en.y - 30, 'DOWN!', pc, 20);
          }
          if (audio) audio.defeat();
          break;
        case 'wrong_side_hit':
          V.hurtT = 0.7; V.shake = Math.max(V.shake, 9);
          V.flash = 0.34; V.flashColor = C.red;
          if (en) {
            ring(b.x, b.y, 5, 54, C.red, 0.4, 3);
            burst(b.x, b.y, 18, C.red, 240);
            floatText(b.x, b.y - 22, (e.amountMs / 1000).toFixed(1) + 's', C.red, 16);
          }
          if (audio) audio.wrongSide();
          break;
        case 'walker_body_hit':
          V.hurtT = 0.6; V.shake = Math.max(V.shake, 8);
          V.flash = 0.28; V.flashColor = C.red;
          ring(m.x, m.y, 6, 48, C.red, 0.38, 3);
          burst(m.x, m.y, 14, C.red, 210);
          floatText(m.x, m.y - 40, (e.amountMs / 1000).toFixed(1) + 's', C.red, 15);
          if (audio) audio.wrongSide();
          break;
        case 'ground_stomp':
          V.stompT = 0.4; V.shake = Math.max(V.shake, 7);
          if (en) {
            ring(en.x, en.y + 8, 6, 52, C.lime, 0.36, 3);
            burst(en.x, en.y, 20, C.violet, 260);
            shards(en.x, en.y, 8, C.lime);
            floatText(en.x, en.y - 24, '+0.4s', C.lime, 13);
          }
          if (audio) audio.stomp();
          break;
        case 'ball_drop':
          V.dropT = 1.1; V.shake = Math.max(V.shake, 11);
          V.flash = 0.3; V.flashColor = C.red;
          ring(b.x, K.GROUND_Y, 6, 90, C.red, 0.5, 4);
          burst(b.x, K.GROUND_Y - 4, 24, C.red, 240);
          smoke(b.x, K.GROUND_Y - 6, 10, C.haze);
          floatText(b.x, K.GROUND_Y - 40, (e.amountMs / 1000).toFixed(1) + 's', C.red, 18);
          if (audio) audio.drop();
          break;
      }
    }
  }

  /* --------------------------------------------------------- fx update */

  function updateFx(sim, dt) {
    V.t += dt;
    V.shake = Math.max(0, V.shake - dt * 34);
    V.shakeX = V.shake ? vrr(-V.shake, V.shake) : 0;
    V.shakeY = V.shake ? vrr(-V.shake, V.shake) : 0;
    V.flash = Math.max(0, V.flash - dt * 2.4);
    ['hitT', 'burstT', 'hurtT', 'dropT', 'powerT', 'landT', 'jumpT', 'stompT'].forEach(function (k) {
      V[k] = Math.max(0, V[k] - dt);
    });
    V.machSquash *= Math.pow(0.0025, dt);
    V.ballSquash *= Math.pow(0.004, dt);
    V.lanePulse.low = Math.max(0, V.lanePulse.low - dt * 1.9);
    V.lanePulse.high = Math.max(0, V.lanePulse.high - dt * 1.9);

    var m = sim.machine;
    V.machLean = lerp(V.machLean, clamp(m.vx / K.MACH_SPEED, -1, 1), 1 - Math.pow(0.001, dt));
    V.tread += m.vx * dt * 0.35;
    var target = -V.machLean * 7;
    V.antenna.v += (target - V.antenna.x) * 130 * dt - V.antenna.v * 7 * dt;
    V.antenna.x += V.antenna.v * dt;

    V.blink -= dt;
    V.nextBlink -= dt;
    if (V.nextBlink <= 0) { V.blink = 0.12; V.nextBlink = vrr(2.2, 5.5); }

    var b = sim.ball;
    if (b.active) {
      V.trail.unshift({ x: b.x, y: b.y, a: 1 });
      if (V.trail.length > 13) V.trail.pop();
    } else if (V.trail.length) V.trail.pop();
    for (var i = 0; i < V.trail.length; i++) V.trail[i].a *= Math.pow(0.02, dt);

    var i2;
    for (i2 = V.parts.length - 1; i2 >= 0; i2--) {
      var p = V.parts[i2];
      p.life += dt;
      if (p.life >= p.max) { V.parts.splice(i2, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'shard') p.rot += p.spin * dt;
      if (p.kind !== 'smoke' && p.y > K.GROUND_Y - 1) {
        p.y = K.GROUND_Y - 1; p.vy *= -0.42; p.vx *= 0.72;
      }
    }
    for (i2 = V.rings.length - 1; i2 >= 0; i2--) {
      V.rings[i2].life += dt;
      if (V.rings[i2].life >= V.rings[i2].max) V.rings.splice(i2, 1);
    }
    for (i2 = V.floats.length - 1; i2 >= 0; i2--) {
      var fl = V.floats[i2];
      fl.life += dt; fl.y -= dt * 34;
      if (fl.life >= fl.max) V.floats.splice(i2, 1);
    }

    var lowClock = sim.phase === 'run' && sim.remainingMs < 9000;
    V.tension = lerp(V.tension, lowClock ? 1 - sim.remainingMs / 9000 : 0, 1 - Math.pow(0.06, dt));
    V.overT = sim.phase === 'over' ? Math.min(1, V.overT + dt * 2.2) : 0;
    V.readyT = sim.phase === 'ready' ? Math.min(1, V.readyT + dt * 2.2) : 0;

    /* critical-state smoke from wounded flyers (view-only) */
    for (i2 = 0; i2 < sim.enemies.length; i2++) {
      var e = sim.enemies[i2];
      if (e.active && e.lane !== 'ground' && e.hitsTaken >= 2 && vr() < dt * 22) {
        smoke(e.x + vrr(-8, 8), e.y + 4, 1, C.red);
      }
    }
  }

  /* --------------------------------------------------------- mood logic */

  function mood(sim) {
    if (sim.phase === 'over') return 'spent';
    if (sim.phase === 'ready') return 'rest';
    if (V.dropT > 0.2) return 'deflated';
    if (V.hurtT > 0.15) return 'dismayed';
    if (V.burstT > 0.15 || V.hitT > 0.05) return 'lit';
    if (V.powerT > 0.1) return 'stretch';
    var b = sim.ball, m = sim.machine;
    if (b.active && b.vy > 0 && (m.y - K.MACH_HALF_H) - b.y < 150 && Math.abs(b.x - m.x) < 90) return 'windup';
    return 'run';
  }

  /* ------------------------------------------------------------ drawing */

  var cvs, ctx, L;

  function init(canvas) {
    cvs = canvas;
    ctx = canvas.getContext('2d');
    initScenery();
    try { V.bestScore = parseInt(localStorage.getItem('stomp.best') || '0', 10) || 0; } catch (err) { V.bestScore = 0; }
  }

  function setLayout(layout) { L = layout; }

  function best() { return V.bestScore; }
  function submitBest(score) {
    if (score > V.bestScore) {
      V.bestScore = score;
      try { localStorage.setItem('stomp.best', String(score)); } catch (err) {}
    }
  }

  /* -- background ---------------------------------------------------- */

  var bgGrad = null, bgKey = '';
  function drawBackdrop(sim) {
    var key = K.W + 'x' + K.H;
    if (bgKey !== key) {
      bgGrad = ctx.createLinearGradient(0, 0, 0, K.H);
      bgGrad.addColorStop(0, C.void0);
      bgGrad.addColorStop(0.36, C.void1);
      bgGrad.addColorStop(0.74, C.void2);
      bgGrad.addColorStop(1, '#2a1148');
      bgKey = key;
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, K.W, K.H);

    var px = (sim.machine.x - K.W / 2) / K.W;
    var beat = 0.5 + Math.sin(V.t * 0.6) * 0.06;

    /* the arena core: a slow disc that gives the middle of the stage a subject */
    var coreY = 316;
    var coreR = 118 + Math.sin(V.t * 0.9) * 3;
    glow(ctx, K.W / 2 - px * 6, coreY, coreR * 1.45, C.haze, 0.20 + V.tension * 0.16);
    ctx.save();
    ctx.translate(K.W / 2 - px * 6, coreY);
    ctx.globalAlpha = 0.11;
    var cg = ctx.createRadialGradient(0, 0, coreR * 0.15, 0, 0, coreR);
    cg.addColorStop(0, hexA(C.mag, 0.55));
    cg.addColorStop(0.6, hexA(C.violet, 0.16));
    cg.addColorStop(1, hexA(C.violet, 0));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, 0, coreR, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.12 + V.tension * 0.18;
    ctx.strokeStyle = C.mag; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, coreR * 0.82, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.13;
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = -(V.t * 10) % 12;
    ctx.beginPath(); ctx.arc(0, 0, coreR * 0.64, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    /* tick marks around the rim */
    ctx.globalAlpha = 0.085;
    for (var tk = 0; tk < 24; tk++) {
      var an = tk / 24 * TAU + V.t * 0.08;
      var r0 = coreR * 0.9, r1 = coreR * (tk % 6 === 0 ? 0.97 : 0.94);
      ctx.beginPath();
      ctx.moveTo(Math.cos(an) * r0, Math.sin(an) * r0);
      ctx.lineTo(Math.cos(an) * r1, Math.sin(an) * r1);
      ctx.stroke();
    }
    ctx.restore();

    /* light shafts off the floor - kept faint; the play field has to stay dark */
    ctx.save();
    for (var sh = 0; sh < V.shafts.length; sh++) {
      var f2 = V.shafts[sh];
      var a2 = 0.026 + 0.018 * Math.sin(V.t * 0.8 + f2.p);
      var x2 = f2.x - px * 18;
      var sg2 = ctx.createLinearGradient(0, K.GROUND_Y, 0, 190);
      sg2.addColorStop(0, hexA(f2.c, a2 * 2.4));
      sg2.addColorStop(1, hexA(f2.c, 0));
      ctx.fillStyle = sg2;
      ctx.beginPath();
      ctx.moveTo(x2 - f2.w * 0.28, K.GROUND_Y);
      ctx.lineTo(x2 + f2.w * 0.28, K.GROUND_Y);
      ctx.lineTo(x2 + f2.w * 0.85, 190);
      ctx.lineTo(x2 - f2.w * 0.85, 190);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    glow(ctx, K.W * 0.5, K.GROUND_Y - 100, 160, C.haze, 0.20 * beat + V.tension * 0.16);

    /* a soft spotlight follows the machine so the pair always reads as the subject */
    var spot = ctx.createLinearGradient(0, K.GROUND_Y, 0, 210);
    spot.addColorStop(0, hexA(C.cyan, 0.055));
    spot.addColorStop(1, hexA(C.cyan, 0));
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.moveTo(sim.machine.x - 40, K.GROUND_Y);
    ctx.lineTo(sim.machine.x + 40, K.GROUND_Y);
    ctx.lineTo(sim.machine.x + 16, 210);
    ctx.lineTo(sim.machine.x - 16, 210);
    ctx.closePath(); ctx.fill();

    /* parallax skyline, two layers, all of it under the low lane */
    ctx.save();
    for (var i = 0; i < V.towers.length; i++) {
      var t = V.towers[i];
      var x = t.x - px * 40 * t.d;
      var top = K.GROUND_Y - 18 - t.h;
      ctx.globalAlpha = 0.24 + t.d * 0.46;
      ctx.fillStyle = t.d < 0.2 ? '#120c30' : '#09061c';
      ctx.fillRect(x, top, t.w, K.GROUND_Y - top);
      if (t.lit) {
        ctx.globalAlpha = 0.45 + t.d * 0.35;
        ctx.fillStyle = t.tint;
        ctx.fillRect(x + t.w * 0.5 - 1, top - 4, 2, 4);
        ctx.globalAlpha = 0.09 + t.d * 0.06;
        for (var wy = top + 7; wy < K.GROUND_Y - 22; wy += 10) {
          for (var wx = x + 3; wx < x + t.w - 4; wx += 8) {
            if ((wx * 7 + wy * 3) % 5 < 2) ctx.fillRect(wx, wy, 2.6, 3.4);
          }
        }
      }
    }
    ctx.restore();

    /* crowd lights along the very top rim of the stage */
    ctx.save();
    for (var cr = 0; cr < V.crowd.length; cr++) {
      var cd = V.crowd[cr];
      ctx.globalAlpha = 0.10 + 0.22 * Math.abs(Math.sin(V.t * 1.3 + cd.p));
      ctx.fillStyle = cd.c;
      ctx.beginPath(); ctx.arc(cd.x - px * 4, K.H - 4 - cd.y, cd.r, 0, TAU); ctx.fill();
    }
    ctx.restore();

    /* drifting motes */
    ctx.save();
    for (var mi = 0; mi < V.motes.length; mi++) {
      var mo = V.motes[mi];
      var yy = mo.y + Math.sin(V.t * 0.5 + mo.p) * 9 - (V.t * mo.s % (K.H + 60));
      yy = ((yy % (K.H + 60)) + K.H + 60) % (K.H + 60) - 30;
      ctx.globalAlpha = mo.a * (0.5 + 0.5 * Math.sin(V.t * 1.7 + mo.p));
      ctx.fillStyle = mo.c;
      ctx.beginPath();
      ctx.arc(mo.x + Math.sin(V.t * 0.4 + mo.p) * 8 - px * 12, yy, mo.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGround(sim) {
    var gy = K.GROUND_Y;
    var g = ctx.createLinearGradient(0, gy, 0, K.H);
    g.addColorStop(0, C.ground0);
    g.addColorStop(1, C.ground1);
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, K.W, K.H - gy);

    /* perspective floor lines */
    ctx.save();
    ctx.globalAlpha = 0.30;
    ctx.strokeStyle = C.cyan;
    ctx.lineWidth = 1;
    var off = (V.t * 16) % 14;
    for (var y = gy + 3 + off; y < K.H; y += 14) {
      ctx.globalAlpha = 0.05 + 0.2 * ((y - gy) / (K.H - gy));
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(K.W, y); ctx.stroke();
    }
    ctx.globalAlpha = 0.14;
    for (var i = -3; i <= 9; i++) {
      var vx = K.W / 2 + i * 44;
      ctx.beginPath(); ctx.moveTo(vx, gy); ctx.lineTo(K.W / 2 + i * 120, K.H); ctx.stroke();
    }
    ctx.restore();

    /* neon lip */
    glow(ctx, K.W / 2, gy, 190, C.cyan, 0.14 + V.tension * 0.1);
    ctx.fillStyle = hexA(C.cyan, 0.85);
    ctx.fillRect(0, gy - 2, K.W, 2.4);
    ctx.fillStyle = hexA(C.ink, 0.5);
    ctx.fillRect(0, gy - 2, K.W, 0.9);
  }

  function drawLane(sim, laneY, color, label, pulse) {
    var breathe = 0.42 + 0.2 * Math.sin(V.t * 1.5 + (label === 'LO' ? 0 : 1.6));
    var a = breathe + pulse * 0.6;
    ctx.save();
    glow(ctx, K.W / 2, laneY, 150, color, 0.09 * a + pulse * 0.16);
    ctx.strokeStyle = hexA(color, 0.24 + pulse * 0.4);
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(6, laneY); ctx.lineTo(K.W - 6, laneY); ctx.stroke();

    /* running dashes read as lane direction */
    ctx.globalAlpha = 0.5 + pulse * 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([9, 15]);
    ctx.lineDashOffset = -(V.t * 26) % 24;
    ctx.beginPath(); ctx.moveTo(6, laneY); ctx.lineTo(K.W - 6, laneY); ctx.stroke();
    ctx.setLineDash([]);

    /* end caps */
    ctx.globalAlpha = 0.75 + pulse * 0.25;
    ctx.fillStyle = color;
    [6, K.W - 6].forEach(function (x) {
      ctx.beginPath();
      ctx.moveTo(x === 6 ? x : x, laneY - 5);
      ctx.lineTo(x === 6 ? x + 5 : x - 5, laneY);
      ctx.lineTo(x === 6 ? x : x, laneY + 5);
      ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 0.5;
    ctx.font = fm(7);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, 13, laneY - 5);
    ctx.restore();
  }

  function drawTelegraphs(sim) {
    for (var i = 0; i < sim.pending.length; i++) {
      var p = sim.pending[i];
      if (p.lane === 'ground' || p.ticks > 70) continue;
      var ticks = Math.max(0, p.at - sim.tick);
      if (ticks > 62) continue;
      var laneY = p.lane === 'low' ? K.LOW_LANE_Y : K.HIGH_LANE_Y;
      var x = p.side < 0 ? 16 : K.W - 16;
      var dir = p.side < 0 ? 1 : -1;
      var col = p.type === 'fastFlyer' ? C.amber : C.lime;
      var blink = 0.4 + 0.6 * Math.abs(Math.sin(V.t * 9));
      ctx.save();
      ctx.globalAlpha = blink * (1 - ticks / 70);
      glow(ctx, x, laneY, 22, col, 0.5);
      ctx.fillStyle = col;
      for (var c = 0; c < 3; c++) {
        var cx = x + dir * c * 7;
        ctx.globalAlpha = blink * (1 - c * 0.28) * (1 - ticks / 70);
        ctx.beginPath();
        ctx.moveTo(cx, laneY - 7);
        ctx.lineTo(cx + dir * 6, laneY);
        ctx.lineTo(cx, laneY + 7);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  /* -- eyes ---------------------------------------------------------- */

  function drawEyePair(m, gap, size, look, color) {
    var open = 1, sy = 1, browed = 0;
    var blink = V.blink > 0 ? 0 : 1;
    switch (m) {
      case 'rest': open = 0.42; break;
      case 'windup': open = 1.15; sy = 1.2; break;
      case 'stretch': open = 1.25; sy = 0.7; break;
      case 'lit': open = 1.3; break;
      case 'dismayed': open = 0.6; browed = 1; break;
      case 'deflated': open = 0.5; sy = 0.7; break;
      case 'spent': open = 0.3; break;
    }
    open *= blink;
    for (var s = -1; s <= 1; s += 2) {
      var ex = s * gap;
      ctx.save();
      ctx.translate(ex, 0);
      if (m === 'spent') {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var a = 0; a < 9; a++) {
          var rr2 = size * 0.16 * a * 0.42;
          var ang = a * 1.1;
          var xx = Math.cos(ang) * rr2, yy = Math.sin(ang) * rr2;
          if (a === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (m === 'dismayed') {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
        var r2 = size * 0.6;
        ctx.beginPath(); ctx.moveTo(-r2, -r2); ctx.lineTo(r2, r2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r2, -r2); ctx.lineTo(-r2, r2); ctx.stroke();
        ctx.restore();
        continue;
      }
      if (m === 'lit') {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var an = k / 8 * TAU - Math.PI / 2;
          var rad = k % 2 ? size * 0.34 : size * 0.95;
          var X = Math.cos(an) * rad, Y = Math.sin(an) * rad;
          if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.62, size * 0.78 * open * sy + 0.4, 0, 0, TAU);
      ctx.fill();
      if (open > 0.5) {
        ctx.fillStyle = '#05040f';
        ctx.beginPath();
        ctx.ellipse(look.x * size * 0.24, look.y * size * 0.24, size * 0.24, size * 0.30, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hexA('#ffffff', 0.85);
        ctx.beginPath();
        ctx.arc(-size * 0.2, -size * 0.28, size * 0.15, 0, TAU);
        ctx.fill();
      }
      if (browed) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-size * 0.7, -size * 0.95);
        ctx.lineTo(size * 0.7, -size * 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* -- the machine --------------------------------------------------- */

  function drawMachine(sim) {
    var m = sim.machine;
    var md = mood(sim);
    var sq = clamp(V.machSquash, -0.6, 1.2);
    var sx = 1 + sq * 0.16;
    var sy = 1 - sq * 0.20;
    var lean = V.machLean;
    var idle = sim.phase === 'ready' ? Math.sin(V.t * 2.1) * 1.6 : 0;
    var breath = Math.sin(V.t * 3.1) * 0.6;

    var cx = m.x;
    var cy = m.y + idle * 0.3;

    /* shadow on the ground */
    var h = Math.max(0, K.MACH_GROUND_Y - m.y);
    ctx.save();
    ctx.globalAlpha = 0.34 * (1 - h / 130);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, K.GROUND_Y + 1, 31 - h * 0.09, 5.6 - h * 0.02, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    glow(ctx, cx, cy - 6, 62, md === 'dismayed' ? C.red : C.cyan, 0.13 + V.hitT * 0.5 + V.powerT * 0.3);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.rotate(lean * 0.06);

    /* --- treads --- */
    ctx.fillStyle = '#070914';
    rr(ctx, -33, 5, 66, 19, 9); ctx.fill();
    ctx.fillStyle = C.steel2;
    rr(ctx, -31, 6.2, 62, 16, 8); ctx.fill();
    ctx.save();
    ctx.beginPath(); rr(ctx, -31, 6.2, 62, 16, 8); ctx.clip();
    ctx.fillStyle = hexA(C.cyan, 0.22);
    for (var i = 0; i < 12; i++) {
      var tx = -34 + ((i * 7 + (V.tread % 7) + 84) % 84);
      ctx.fillRect(tx, 6.2, 2.8, 16);
    }
    ctx.fillStyle = hexA('#ffffff', 0.06);
    ctx.fillRect(-31, 6.2, 62, 4);
    ctx.restore();
    /* road wheels */
    [-19, -6.5, 6.5, 19].forEach(function (hx, k) {
      var big = k === 0 || k === 3;
      ctx.fillStyle = C.steel0;
      ctx.beginPath(); ctx.arc(hx, 14.2, big ? 5.8 : 4.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0b0f1e';
      ctx.beginPath(); ctx.arc(hx, 14.2, big ? 3.2 : 2.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexA(C.cyan, 0.55); ctx.lineWidth = 1.1;
      ctx.save();
      ctx.translate(hx, 14.2); ctx.rotate(V.tread * 0.2 + k);
      ctx.beginPath(); ctx.moveTo(-2.6, 0); ctx.lineTo(2.6, 0); ctx.stroke();
      ctx.restore();
    });

    /* --- chassis --- */
    var bodyG = ctx.createLinearGradient(0, -22, 0, 11);
    bodyG.addColorStop(0, '#3c4a76');
    bodyG.addColorStop(0.42, C.steel0);
    bodyG.addColorStop(0.8, C.steel1);
    bodyG.addColorStop(1, C.steel2);
    ctx.beginPath();
    ctx.moveTo(-27, -21);
    ctx.quadraticCurveTo(-32, -19, -31, -8);
    ctx.lineTo(-26, 8);
    ctx.lineTo(26, 8);
    ctx.lineTo(31, -8);
    ctx.quadraticCurveTo(32, -19, 27, -21);
    ctx.closePath();
    ctx.fillStyle = bodyG; ctx.fill();
    ctx.strokeStyle = hexA(C.cyan, 0.36); ctx.lineWidth = 1.3; ctx.stroke();

    /* rim light down the left shoulder */
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-26, -19);
    ctx.quadraticCurveTo(-30.5, -17.5, -29.6, -8);
    ctx.stroke();
    ctx.restore();

    /* side vents */
    ctx.fillStyle = hexA('#000', 0.45);
    for (var s = -1; s <= 1; s += 2) {
      for (var v = 0; v < 3; v++) {
        rr(ctx, s * 24 - 2.4, -14 + v * 5.4, 4.8, 3.2, 1.5);
        ctx.fill();
      }
    }
    /* bolts */
    ctx.fillStyle = hexA('#8fb4d8', 0.5);
    [[-22, -17], [22, -17], [-22, 4], [22, 4]].forEach(function (b2) {
      ctx.beginPath(); ctx.arc(b2[0], b2[1], 1.1, 0, TAU); ctx.fill();
    });

    /* amber hazard stripe */
    ctx.save();
    ctx.beginPath(); rr(ctx, -26, 1.5, 52, 6, 2.4); ctx.clip();
    ctx.fillStyle = hexA('#0b0f1e', 0.85);
    ctx.fillRect(-27, 1.5, 54, 6);
    ctx.fillStyle = hexA(C.amber, 0.68);
    for (var st = -32; st < 34; st += 9) {
      ctx.beginPath();
      ctx.moveTo(st, 7.5); ctx.lineTo(st + 4.5, 1.5); ctx.lineTo(st + 9, 1.5); ctx.lineTo(st + 4.5, 7.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    /* --- top pad: the bounce surface --- */
    var padLit = clamp(V.hitT * 2 + V.powerT * 1.6 + (md === 'windup' ? 0.5 : 0.12), 0, 1);
    var padG = ctx.createLinearGradient(0, -27, 0, -17);
    padG.addColorStop(0, '#f2feff');
    padG.addColorStop(0.45, C.cyan);
    padG.addColorStop(1, '#15637f');
    ctx.fillStyle = '#080e1c';
    rr(ctx, -30.5, -27.5, 61, 11, 5); ctx.fill();
    ctx.fillStyle = padG;
    rr(ctx, -29, -26.4, 58, 8.6, 4); ctx.fill();
    /* sweet spot: the part of the pad that keeps the full return band */
    ctx.globalAlpha = 0.5 + padLit * 0.5;
    ctx.fillStyle = '#ffffff';
    rr(ctx, -29 * K.EDGE_FRAC, -25.6, 58 * K.EDGE_FRAC, 3.6, 1.8); ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = hexA('#04121a', 0.55);
    ctx.fillRect(-29 * K.EDGE_FRAC - 1.4, -26.4, 1.4, 8.6);
    ctx.fillRect(29 * K.EDGE_FRAC, -26.4, 1.4, 8.6);
    ctx.globalAlpha = 1;
    glow(ctx, 0, -22, 34 + padLit * 20, C.cyan, 0.22 + padLit * 0.55);

    /* --- visor + face --- */
    ctx.fillStyle = '#06081a';
    rr(ctx, -19.5, -16, 39, 18, 7); ctx.fill();
    ctx.strokeStyle = hexA(C.cyan, 0.3); ctx.lineWidth = 1.1; ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#ffffff';
    rr(ctx, -17.5, -14.5, 35, 5, 3); ctx.fill();
    ctx.globalAlpha = 1;
    var faceCol = md === 'dismayed' || md === 'deflated' ? C.red : md === 'lit' ? '#fff8b0' : C.cyan;
    glow(ctx, 0, -7, 20, faceCol, 0.3 + V.hitT);
    ctx.save();
    ctx.translate(0, -7.4 + breath * 0.2);
    var look = { x: 0, y: 0 };
    if (sim.ball.active) {
      look.x = clamp((sim.ball.x - m.x) / 70, -1, 1);
      look.y = clamp((sim.ball.y - (m.y - 34)) / 90, -1, 1);
    }
    drawEyePair(md, 8.4, 5.8, look, faceCol);
    ctx.restore();

    /* mouth bar under the eyes */
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = md === 'dismayed' ? C.red : faceCol;
    var mw = md === 'stretch' ? 11 : md === 'lit' ? 13 : md === 'windup' ? 5 : 7;
    rr(ctx, -mw / 2, -0.6, mw, 1.8, 0.9); ctx.fill();
    ctx.globalAlpha = 1;

    /* shoulder beacons */
    for (var sb = -1; sb <= 1; sb += 2) {
      var on = 0.4 + 0.6 * Math.abs(Math.sin(V.t * 3 + (sb > 0 ? 1.6 : 0)));
      ctx.fillStyle = sb > 0 ? C.mag : C.amber;
      ctx.globalAlpha = on;
      ctx.beginPath(); ctx.arc(sb * 25.5, -18, 2.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      glow(ctx, sb * 25.5, -18, 11, sb > 0 ? C.mag : C.amber, on * 0.6);
    }

    /* antenna */
    var ax = V.antenna.x;
    ctx.strokeStyle = '#54648f'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, -26);
    ctx.quadraticCurveTo(-18 + ax * 0.5, -37, -16 + ax, -45);
    ctx.stroke();
    var bulbA = 0.55 + 0.45 * Math.sin(V.t * 4.2);
    ctx.fillStyle = md === 'dismayed' ? C.red : C.mag;
    ctx.beginPath(); ctx.arc(-16 + ax, -46, 3, 0, TAU); ctx.fill();
    glow(ctx, -16 + ax, -46, 15, md === 'dismayed' ? C.red : C.mag, 0.35 + bulbA * 0.4);

    ctx.restore();

    /* thruster puffs while moving fast */
    if (Math.abs(m.vx) > 150 && vr() < 0.35) {
      V.parts.push({
        x: cx - Math.sign(m.vx) * 27, y: cy + 5, vx: -Math.sign(m.vx) * vrr(30, 90), vy: vrr(-20, 10),
        r: vrr(1.6, 3.4), life: 0, max: vrr(0.16, 0.34), c: C.cyan, g: 40, kind: 'smoke'
      });
    }
  }

  /* -- the ball ------------------------------------------------------ */

  function ballColor(sim) {
    var k = sim.ball.lastBounceKind;
    if (k === 'power') return C.mag;
    if (k === 'weak') return C.violet;
    return C.cyan;
  }

  function drawBall(sim) {
    var b = sim.ball;
    var col = ballColor(sim);

    if (!b.active) {
      /* respawn telegraph above the machine */
      var frac = 1 - b.respawnTicks / 30;
      var tx = sim.machine.x, ty = K.GROUND_Y - K.BALL_RESPAWN_H;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(V.t * 12));
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(tx, ty, 9 + (1 - frac) * 16, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(tx, ty + 12); ctx.lineTo(tx, K.GROUND_Y - 40); ctx.stroke();
      ctx.restore();
      glow(ctx, tx, ty, 26 * frac + 8, C.cyan, 0.5 * frac);
      return;
    }

    /* trail */
    ctx.save();
    for (var i = V.trail.length - 1; i >= 1; i--) {
      var t = V.trail[i];
      var a = t.a * (1 - i / V.trail.length) * 0.5;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(t.x, t.y, K.BALL_R * (1 - i / (V.trail.length + 3)) * 0.95, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    var spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    var stretch = clamp(spd / 700, 0, 1) * 0.26 + clamp(V.ballSquash, 0, 1.5) * 0.10;
    var ang = Math.atan2(b.vy, b.vx);
    var r = K.BALL_R + 0.5;

    /* a soft shadow keeps the ball's height readable against the backdrop */
    var bh = Math.max(0, K.GROUND_Y - b.y);
    ctx.save();
    ctx.globalAlpha = 0.22 * clamp(1 - bh / 420, 0, 1);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(b.x, K.GROUND_Y + 1, 9 - bh * 0.008, 2.6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    glow(ctx, b.x, b.y, 38 + V.hitT * 44, col, 0.44 + V.hitT * 0.5);

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(ang);
    ctx.scale(1 + stretch, 1 - stretch * 0.75);
    ctx.rotate(-ang);

    var g = ctx.createRadialGradient(-r * 0.34, -r * 0.42, r * 0.12, 0, 0, r * 1.05);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, col);
    g.addColorStop(1, hexA(col, 0.85));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = hexA('#ffffff', 0.6); ctx.lineWidth = 1;
    ctx.stroke();

    /* little spark crown when powered */
    if (V.powerT > 0 || V.hitT > 0) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      var n = 6;
      for (var s2 = 0; s2 < n; s2++) {
        var a2 = s2 / n * TAU + V.t * 5;
        var l0 = r * 1.1, l1 = r * (1.5 + Math.max(V.powerT, V.hitT) * 1.6);
        ctx.globalAlpha = Math.max(V.powerT, V.hitT) * 1.4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a2) * l0, Math.sin(a2) * l0);
        ctx.lineTo(Math.cos(a2) * l1, Math.sin(a2) * l1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /* face */
    var md = mood(sim);
    var look = { x: clamp(b.vx / 160, -1, 1), y: clamp(b.vy / 400, -1, 1) };
    ctx.save();
    ctx.translate(0, -1);
    drawEyePair(md === 'rest' ? 'rest' : md, 3.6, 2.8, look, '#0b0a1c');
    ctx.restore();
    ctx.strokeStyle = '#0b0a1c'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    ctx.beginPath();
    if (md === 'lit' || md === 'stretch') {
      ctx.arc(0, 3.2, 2.6, 0.15 * Math.PI, 0.85 * Math.PI);
    } else if (md === 'dismayed' || md === 'deflated' || md === 'spent') {
      ctx.arc(0, 6.4, 2.6, 1.15 * Math.PI, 1.85 * Math.PI);
    } else {
      ctx.moveTo(-2, 4.2); ctx.lineTo(2, 4.2);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* -- flyers -------------------------------------------------------- */

  function drawFlyer(sim, e) {
    var R = e.visualRadius;
    var fast = e.type === 'fastFlyer';
    var body0 = fast ? '#ff8a3d' : '#3fd6a8';
    var body1 = fast ? '#8a2f1c' : '#14604f';
    var dome = fast ? '#ffe6c9' : '#dcfff4';
    var accent = fast ? C.amber : C.lime;
    var st = e.hitsTaken;
    var dying = !e.active;
    var flash = clamp(1 - (sim.tick - e.flashTick) / 9, 0, 1);
    var ph = e.id * 1.7;
    var wob = Math.sin(V.t * (fast ? 8 : 4.4) + ph);
    var dir = e.vx >= 0 ? 1 : -1;

    ctx.save();
    if (dying) {
      var d = 1 - e.corpse / 45;
      ctx.globalAlpha = Math.max(0, 1 - d * 1.6);
      ctx.translate(e.x, e.y + d * 40);
      ctx.rotate(d * 2.2 * dir);
      ctx.scale(1 + d * 0.5, 1 - d * 0.3);
    } else {
      ctx.translate(e.x, e.y);
    }
    if (st >= 2 && !dying) ctx.rotate(Math.sin(V.t * 22) * 0.05);

    glow(ctx, 0, 0, R * 2.4, st >= 2 ? C.red : accent, 0.16 + flash * 0.6 + (st >= 2 ? 0.14 : 0));

    /* wings / fins */
    ctx.fillStyle = hexA(accent, 0.42);
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(s * R * 1.15, -R * 0.1);
      ctx.rotate(s * (0.35 + wob * 0.34));
      ctx.beginPath();
      if (fast) {
        ctx.moveTo(0, 0); ctx.lineTo(s * R * 1.1, -R * 0.5); ctx.lineTo(s * R * 0.95, R * 0.35);
      } else {
        ctx.ellipse(s * R * 0.5, 0, R * 0.62, R * 0.22, 0, 0, TAU);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* body */
    var bg = ctx.createLinearGradient(0, -R * 0.9, 0, R * 0.6);
    bg.addColorStop(0, body0);
    bg.addColorStop(1, body1);
    ctx.beginPath();
    if (fast) {
      ctx.moveTo(dir * R * 1.5, 0);
      ctx.lineTo(dir * R * 0.2, -R * 0.78);
      ctx.lineTo(-dir * R * 1.25, -R * 0.5);
      ctx.lineTo(-dir * R * 1.35, R * 0.42);
      ctx.lineTo(dir * R * 0.3, R * 0.42);
      ctx.closePath();
    } else {
      ctx.ellipse(0, 0, R * 1.32, R * 0.86, 0, 0, TAU);
    }
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = hexA('#04030c', 0.6); ctx.lineWidth = 1.4; ctx.stroke();

    /* --- UNDERSIDE: the half that bites. Red jaw plate plus teeth that
       protrude past the silhouette, so top and bottom can never be confused. */
    ctx.save();
    ctx.beginPath();
    if (fast) {
      ctx.moveTo(dir * R * 1.5, 0);
      ctx.lineTo(dir * R * 0.2, -R * 0.78);
      ctx.lineTo(-dir * R * 1.25, -R * 0.5);
      ctx.lineTo(-dir * R * 1.35, R * 0.42);
      ctx.lineTo(dir * R * 0.3, R * 0.42);
      ctx.closePath();
    } else {
      ctx.ellipse(0, 0, R * 1.32, R * 0.86, 0, 0, TAU);
    }
    ctx.clip();
    var jawG = ctx.createLinearGradient(0, R * 0.05, 0, R * 0.9);
    jawG.addColorStop(0, hexA(C.red, 0));
    jawG.addColorStop(0.45, hexA(C.red, 0.55));
    jawG.addColorStop(1, '#8c1024');
    ctx.fillStyle = jawG;
    ctx.fillRect(-R * 1.6, R * 0.05, R * 3.2, R * 1.2);
    ctx.restore();

    var teeth = fast ? 5 : 6;
    var spanX = R * (fast ? 0.95 : 1.12);
    var jawY = R * (fast ? 0.34 : 0.66);
    ctx.fillStyle = st >= 2 ? '#ffa8b4' : '#ffd7dc';
    for (var i = 0; i < teeth; i++) {
      var tx = -spanX + (i + 0.5) * (spanX * 2 / teeth);
      var tw = R * 0.15;
      var th = R * (0.36 + 0.09 * Math.sin(V.t * 9 + i * 1.3 + ph));
      var edge = 1 - Math.pow(Math.abs(tx) / spanX, 2) * 0.45;
      ctx.beginPath();
      ctx.moveTo(tx - tw, jawY - R * 0.1);
      ctx.lineTo(tx + tw, jawY - R * 0.1);
      ctx.lineTo(tx, jawY + th * edge);
      ctx.closePath(); ctx.fill();
    }
    /* jaw rim */
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-spanX - R * 0.14, jawY - R * 0.12);
    ctx.lineTo(spanX + R * 0.14, jawY - R * 0.12);
    ctx.stroke();
    ctx.globalAlpha = 1;
    glow(ctx, 0, jawY + R * 0.2, R * 1.5, C.red, 0.3);

    /* dents as damage accrues */
    if (st >= 1) {
      ctx.strokeStyle = hexA('#04030c', 0.75); ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, R * 0.1); ctx.lineTo(-R * 0.2, -R * 0.15);
      ctx.lineTo(R * 0.1, R * 0.16); ctx.lineTo(R * 0.5, -R * 0.05);
      ctx.stroke();
    }

    /* --- TOP: the hittable dome --- */
    var domeY = -R * 0.62;
    ctx.save();
    if (st === 0) {
      ctx.fillStyle = dome;
      ctx.beginPath();
      ctx.ellipse(0, domeY + R * 0.18, R * 0.95, R * 0.5, 0, Math.PI, TAU);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA('#ffffff', 0.9); ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, domeY + R * 0.18, R * 0.95, R * 0.5, 0, Math.PI, TAU);
      ctx.stroke();
      /* gloss */
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-R * 0.32, domeY - R * 0.02, R * 0.24, R * 0.1, -0.5, 0, TAU);
      ctx.fill();
    } else if (st === 1) {
      ctx.fillStyle = hexA(dome, 0.82);
      ctx.beginPath();
      ctx.ellipse(0, domeY + R * 0.18, R * 0.95, R * 0.46, 0, Math.PI, TAU);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#04030c'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, domeY + R * 0.18);
      ctx.lineTo(-R * 0.16, domeY - R * 0.18);
      ctx.lineTo(R * 0.1, domeY + R * 0.06);
      ctx.lineTo(R * 0.46, domeY - R * 0.14);
      ctx.stroke();
      ctx.strokeStyle = hexA('#ffffff', 0.6); ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, domeY + R * 0.18, R * 0.95, R * 0.46, 0, Math.PI, TAU);
      ctx.stroke();
    } else {
      /* shattered: exposed core */
      var core = 0.5 + 0.5 * Math.abs(Math.sin(V.t * 13 + ph));
      ctx.strokeStyle = hexA(dome, 0.5); ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.9, domeY + R * 0.2);
      ctx.lineTo(-R * 0.55, domeY - R * 0.1);
      ctx.lineTo(-R * 0.3, domeY + R * 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(R * 0.9, domeY + R * 0.2);
      ctx.lineTo(R * 0.55, domeY - R * 0.08);
      ctx.lineTo(R * 0.3, domeY + R * 0.14);
      ctx.stroke();
      ctx.fillStyle = C.red;
      ctx.globalAlpha = 0.55 + core * 0.45;
      ctx.beginPath(); ctx.arc(0, domeY + R * 0.16, R * 0.32, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      glow(ctx, 0, domeY + R * 0.16, R * 1.1, C.red, 0.4 + core * 0.4);
    }
    ctx.restore();

    /* eye */
    var eyeCol = st >= 2 ? C.red : '#0a0a1e';
    ctx.fillStyle = '#f2ffff';
    ctx.beginPath();
    ctx.ellipse(dir * R * 0.28, R * 0.02, R * 0.34, R * (st >= 1 ? 0.22 : 0.32), 0, 0, TAU);
    ctx.fill();
    var bx = clamp((sim.ball.x - e.x) / 60, -1, 1), by = clamp((sim.ball.y - e.y) / 60, -1, 1);
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.arc(dir * R * 0.28 + bx * R * 0.11, R * 0.02 + by * R * 0.08, R * 0.15, 0, TAU);
    ctx.fill();
    if (st >= 1) {
      ctx.strokeStyle = '#04030c'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(dir * R * 0.28 - R * 0.34, -R * 0.34);
      ctx.lineTo(dir * R * 0.28 + R * 0.3, -R * 0.16);
      ctx.stroke();
    }

    /* thruster on the dart */
    if (fast) {
      var fl = 0.6 + 0.4 * Math.sin(V.t * 30 + ph);
      ctx.fillStyle = C.amber;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(-dir * R * 1.35, -R * 0.3);
      ctx.lineTo(-dir * R * (1.35 + fl * 0.8), 0);
      ctx.lineTo(-dir * R * 1.35, R * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      glow(ctx, -dir * R * 1.7, 0, R * 0.9, C.amber, 0.5);
    }

    /* damage pips: three, above the dome, unmistakable */
    var remain = e.hitsRequired - e.hitsTaken;
    for (var p = 0; p < e.hitsRequired; p++) {
      var px = (p - (e.hitsRequired - 1) / 2) * 7.5;
      var py = -R * 1.5;
      var filled = p < remain;
      ctx.beginPath();
      rr(ctx, px - 2.6, py - 2.6, 5.2, 5.2, 1.4);
      if (filled) {
        ctx.fillStyle = st >= 2 ? C.red : accent;
        ctx.fill();
        glow(ctx, px, py, 8, st >= 2 ? C.red : accent, 0.5);
      } else {
        ctx.strokeStyle = hexA('#ffffff', 0.35); ctx.lineWidth = 1; ctx.stroke();
      }
    }

    /* white-out on impact */
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.85;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 1.4, R * 0.95, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* -- walker -------------------------------------------------------- */

  function drawWalker(sim, e) {
    var R = e.visualRadius;
    var dying = !e.active;
    var ph = e.id * 2.3;
    var legs = Math.sin(V.t * 11 + ph);
    ctx.save();
    ctx.translate(e.x, e.y);
    if (dying) {
      var d = 1 - e.corpse / 45;
      ctx.globalAlpha = Math.max(0, 1 - d * 1.5);
      ctx.scale(1 + d * 0.5, Math.max(0.05, 1 - d * 1.1));
      ctx.translate(0, R * d * 0.8);
    }
    if (e.stun > 0) ctx.rotate(Math.sin(V.t * 40) * 0.12);

    glow(ctx, 0, 0, R * 1.9, C.violet, 0.18);

    /* legs */
    ctx.strokeStyle = '#4a2f8f'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (var i = -1; i <= 1; i += 2) {
      for (var j = 0; j < 2; j++) {
        var lx = i * (R * 0.4 + j * R * 0.5);
        var sw = legs * (j ? -1 : 1) * i * 3;
        ctx.beginPath();
        ctx.moveTo(lx, R * 0.2);
        ctx.lineTo(lx + sw, R * 0.75);
        ctx.stroke();
      }
    }
    /* pincers - the dangerous sides */
    ctx.fillStyle = C.red;
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(s * R * 1.0, R * 0.05);
      ctx.rotate(s * legs * 0.25);
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.22);
      ctx.lineTo(s * R * 0.52, -R * 0.34);
      ctx.lineTo(s * R * 0.42, R * 0.1);
      ctx.lineTo(0, R * 0.22);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    glow(ctx, 0, 0, R * 1.5, C.red, 0.12);

    /* shell */
    var sg = ctx.createLinearGradient(0, -R * 0.8, 0, R * 0.4);
    sg.addColorStop(0, '#b39bff');
    sg.addColorStop(1, '#4a2f8f');
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.95, R * 0.72, 0, 0, TAU);
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = '#1a0f38'; ctx.lineWidth = 1.3; ctx.stroke();

    /* stompable top plate */
    ctx.fillStyle = C.lime;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.38, R * 0.6, R * 0.2, 0, Math.PI, TAU);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    glow(ctx, 0, -R * 0.45, R * 0.9, C.lime, 0.35);

    /* eyes */
    ctx.fillStyle = '#fff';
    for (var ee = -1; ee <= 1; ee += 2) {
      ctx.beginPath(); ctx.arc(ee * R * 0.28, R * 0.05, R * 0.17, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#12082e';
    for (var e2 = -1; e2 <= 1; e2 += 2) {
      ctx.beginPath(); ctx.arc(e2 * R * 0.28 + clamp((sim.machine.x - e.x) / 80, -1, 1) * R * 0.06, R * 0.06, R * 0.09, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* -- particles / rings / floats ------------------------------------ */

  function drawFx() {
    var i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < V.parts.length; i++) {
      var p = V.parts[i];
      var k = 1 - p.life / p.max;
      ctx.globalAlpha = p.kind === 'smoke' ? k * 0.28 : k;
      if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8);
        ctx.restore();
      } else if (p.kind === 'smoke') {
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + (1 - k) * 1.8), 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k + 0.4, 0, TAU); ctx.fill();
      }
    }
    for (i = 0; i < V.rings.length; i++) {
      var g2 = V.rings[i];
      var t = g2.life / g2.max;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.strokeStyle = g2.c;
      ctx.lineWidth = g2.w * (1 - t) + 0.4;
      ctx.beginPath();
      ctx.arc(g2.x, g2.y, lerp(g2.r0, g2.r1, ease(t)), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    for (i = 0; i < V.floats.length; i++) {
      var fl = V.floats[i];
      var tt = fl.life / fl.max;
      ctx.globalAlpha = (1 - tt) * (tt < 0.15 ? tt / 0.15 : 1);
      ctx.font = f(fl.size * (1 + (1 - Math.min(1, tt * 5)) * 0.3));
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4,3,14,0.85)';
      ctx.strokeText(fl.text, fl.x, fl.y);
      ctx.fillStyle = fl.c;
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.restore();
  }

  /* -- HUD ----------------------------------------------------------- */

  function fmtClock(ms) {
    if (ms < 10000) return (ms / 1000).toFixed(1);
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* When the stage has to shrink into a squat frame, the readout grows in world
   * units so the clock and score stay legible. Readability wins over polish. */
  function hudK() { return clamp(0.62 / (L.stage.s || 1), 1, 1.55); }

  var muteRect = { x: 0, y: 0, r: 12 };

  function drawHud(sim, muted) {
    var crit = sim.remainingMs < 9000 && sim.phase === 'run';
    var pulse = crit ? 0.5 + 0.5 * Math.sin(V.t * 12) : 0;
    var hk = hudK();
    var ps = 1 + (hk - 1) * 0.85;
    var panelH = 38 * ps;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#07061a';
    rr(ctx, 10, 8, K.W - 20, panelH, 12); ctx.fill();
    ctx.strokeStyle = hexA(C.cyan, 0.25); ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;

    /* score */
    ctx.textAlign = 'left';
    ctx.font = fm(7.5 * hk);
    ctx.fillStyle = hexA(C.cyan, 0.7);
    ctx.fillText('SCORE', 22, 8 + 13 * ps);
    ctx.font = f(17 * hk);
    ctx.fillStyle = C.ink;
    ctx.fillText(String(sim.score), 22, 8 + 30 * ps);

    /* clock */
    var clockCol = crit ? (pulse > 0.5 ? C.red : '#ffd9de') : C.ink;
    ctx.textAlign = 'center';
    var jitter = crit ? Math.sin(V.t * 40) * pulse * 1.2 : 0;
    ctx.font = f((crit ? 26 + pulse * 3 : 25) * hk);
    glow(ctx, K.W / 2, 8 + 22 * ps, 46 * hk, crit ? C.red : C.cyan, 0.22 + pulse * 0.4);
    ctx.fillStyle = clockCol;
    ctx.fillText(fmtClock(sim.remainingMs), K.W / 2 + jitter, 8 + 29 * ps);

    /* rank + tier pips */
    ctx.textAlign = 'right';
    ctx.font = fm(7.5 * hk);
    ctx.fillStyle = hexA(C.mag, 0.8);
    ctx.fillText(sim.rank(), K.W - 22, 8 + 13 * ps);
    for (var i = 0; i < 5; i++) {
      var on = i < sim.difficulty;
      ctx.globalAlpha = on ? 1 : 0.22;
      ctx.fillStyle = on ? C.mag : '#ffffff';
      ctx.beginPath();
      rr(ctx, K.W - 26 - i * 7 * hk, 8 + 20 * ps, 4 * hk, 9 * ps, 1.4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* time bar */
    var barY = 8 + panelH + 4;
    var bw = K.W - 32;
    var frac = clamp(sim.remainingMs / K.START_MS, 0, 1);
    ctx.fillStyle = hexA('#ffffff', 0.10);
    rr(ctx, 16, barY, bw, 4, 2); ctx.fill();
    var barCol = crit ? C.red : sim.remainingMs > K.START_MS ? C.lime : C.cyan;
    ctx.fillStyle = barCol;
    rr(ctx, 16, barY, Math.max(2, bw * frac), 4, 2); ctx.fill();
    glow(ctx, 16 + bw * frac, barY + 2, 16, barCol, 0.5 + pulse * 0.4);

    /* stats line */
    var statY = barY + 12 * hk;
    ctx.textAlign = 'left';
    ctx.font = fm(7.5 * hk);
    ctx.fillStyle = hexA('#ffffff', 0.45);
    ctx.fillText('DOWN ' + sim.airEnemiesDefeated + '   RUN x' + sim.cleanSequence, 16, statY);
    ctx.textAlign = 'right';
    ctx.fillText('BEST ' + V.bestScore, K.W - 16, statY);

    /* mute button */
    var mr = 11 * hk;
    var mx = K.W - 18 - mr, my = statY + 10 + mr;
    muteRect = { x: mx, y: my, r: mr + 6 };
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#0b0a20';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.strokeStyle = hexA(C.cyan, 0.35); ctx.lineWidth = 1; ctx.stroke();
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(hk, hk);
    ctx.fillStyle = muted ? hexA('#ffffff', 0.35) : C.cyan;
    ctx.beginPath();
    ctx.moveTo(-4.5, -3); ctx.lineTo(-1.5, -3); ctx.lineTo(1.5, -6);
    ctx.lineTo(1.5, 6); ctx.lineTo(-1.5, 3); ctx.lineTo(-4.5, 3);
    ctx.closePath(); ctx.fill();
    if (muted) {
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(7, 6); ctx.stroke();
    } else {
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(2.5, 0, 5, -0.9, 0.9); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* -- ready / over overlays ---------------------------------------- */

  function drawReady(sim) {
    var a = ease(V.readyT);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';

    var bob = Math.sin(V.t * 1.6) * 3;
    var hp = clamp(hudK(), 1, 1.2);
    /* a readout that grew for a squat frame must not be crowded by the title */
    var ty = 150 + (hudK() - 1) * 80 + bob;
    ctx.translate(K.W / 2, ty);
    ctx.scale(hp, hp);
    ctx.translate(-K.W / 2, -ty);
    glow(ctx, K.W / 2, ty - 12, 120, C.mag, 0.22 + 0.06 * Math.sin(V.t * 2.2));

    /* title */
    ctx.font = f(58);
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#08061a';
    ctx.strokeText('STOMP', K.W / 2, ty);
    var tg = ctx.createLinearGradient(0, ty - 44, 0, ty + 6);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.5, C.cyan);
    tg.addColorStop(1, C.mag);
    ctx.fillStyle = tg;
    ctx.fillText('STOMP', K.W / 2, ty);

    /* single line of guidance, nothing more */
    var flick = 0.55 + 0.45 * Math.sin(V.t * 3.4);
    ctx.font = fm(11);
    ctx.globalAlpha = a * flick;
    ctx.fillStyle = C.ink;
    ctx.fillText('MOVE OR JUMP TO BEGIN', K.W / 2, ty + 28);
    ctx.restore();
  }

  function drawOver(sim) {
    var a = ease(V.overT);
    ctx.save();
    ctx.globalAlpha = a * 0.78;
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, K.W, K.H);
    ctx.globalAlpha = a;

    var y0 = 150;
    var hp = clamp(hudK(), 1, 1.2);
    ctx.translate(K.W / 2, y0);
    ctx.scale(hp, hp);
    ctx.translate(-K.W / 2, -y0);
    var pw = 280, px = (K.W - pw) / 2;
    glow(ctx, K.W / 2, y0 + 110, 190, C.mag, 0.18);
    ctx.fillStyle = 'rgba(10,8,30,0.94)';
    rr(ctx, px, y0, pw, 258, 18); ctx.fill();
    ctx.strokeStyle = hexA(C.mag, 0.5); ctx.lineWidth = 1.4; ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = f(13);
    ctx.fillStyle = hexA(C.red, 0.95);
    ctx.fillText('TIME OUT', K.W / 2, y0 + 30);

    ctx.font = f(46);
    var sg = ctx.createLinearGradient(0, y0 + 40, 0, y0 + 82);
    sg.addColorStop(0, '#fff'); sg.addColorStop(1, C.cyan);
    ctx.fillStyle = sg;
    ctx.fillText(String(sim.score), K.W / 2, y0 + 78);
    ctx.font = fm(8);
    ctx.fillStyle = hexA('#ffffff', 0.5);
    ctx.fillText('SCORE', K.W / 2, y0 + 92);

    /* rank badge */
    ctx.font = f(20);
    glow(ctx, K.W / 2, y0 + 115, 34, C.mag, 0.34);
    ctx.fillStyle = C.mag;
    ctx.fillText(sim.rank(), K.W / 2, y0 + 122);

    var rows = [
      ['SESSION BEST', String(V.bestScore)],
      ['TARGETS DOWN', String(sim.airEnemiesDefeated)],
      ['LONGEST PURSUIT', sim.longestCleanSequence + ' hits'],
      ['CLEAN TOPS', String(sim.topHits)]
    ];
    for (var i = 0; i < rows.length; i++) {
      var ry = y0 + 148 + i * 20;
      ctx.textAlign = 'left';
      ctx.font = fm(9);
      ctx.fillStyle = hexA('#ffffff', 0.55);
      ctx.fillText(rows[i][0], px + 22, ry);
      ctx.textAlign = 'right';
      ctx.font = f(11);
      ctx.fillStyle = C.ink;
      ctx.fillText(rows[i][1], px + pw - 22, ry);
    }

    var flick = 0.5 + 0.5 * Math.sin(V.t * 4.5);
    ctx.textAlign = 'center';
    ctx.font = f(13);
    ctx.globalAlpha = a * (0.6 + flick * 0.4);
    ctx.fillStyle = C.lime;
    ctx.fillText('TAP  or  R  TO RUN AGAIN', K.W / 2, y0 + 242);
    ctx.restore();
  }

  /* -- control surfaces --------------------------------------------- */

  function drawPads(sim, pointer) {
    var pl = L.padL, pr = L.padR;
    var hintA = sim.phase === 'ready' ? 0.55 + 0.45 * Math.sin(V.t * 3.2) : 1;

    /* band backdrop (tall frames only; wide frames use the letterbox columns) */
    if (L.mode !== 'side') {
      ctx.save();
      var bg = ctx.createLinearGradient(0, L.band.y, 0, L.band.y + L.band.h);
      bg.addColorStop(0, 'rgba(8,6,24,0.0)');
      bg.addColorStop(0.35, 'rgba(8,6,24,0.85)');
      bg.addColorStop(1, 'rgba(4,3,14,1)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, L.band.y - 6, L.cw, L.ch - L.band.y + 6);
      ctx.restore();
    }

    /* move pad */
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(14,12,36,0.9)';
    rr(ctx, pl.x, pl.y, pl.w, pl.h, 16); ctx.fill();
    ctx.strokeStyle = hexA(C.cyan, pointer.move ? 0.8 : 0.3);
    ctx.lineWidth = 1.4; ctx.stroke();

    var cxp = pl.x + pl.w / 2, cyp = pl.y + pl.h / 2;
    if (pointer.move) {
      var ox = clamp(pointer.moveOx, pl.x + 22, pl.x + pl.w - 22);
      var kx = clamp(pointer.moveX, pl.x + 22, pl.x + pl.w - 22);
      /* origin ghost */
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(ox, cyp, 14, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, cyp); ctx.lineTo(kx, cyp); ctx.stroke();
      ctx.globalAlpha = 1;
      var knobR = Math.min(20, pl.h * 0.3);
      glow(ctx, kx, cyp, knobR * 2.2, C.cyan, 0.5);
      var kg = ctx.createRadialGradient(kx - knobR * 0.3, cyp - knobR * 0.35, 1, kx, cyp, knobR);
      kg.addColorStop(0, '#ffffff'); kg.addColorStop(1, C.cyan);
      ctx.fillStyle = kg;
      ctx.beginPath(); ctx.arc(kx, cyp, knobR, 0, TAU); ctx.fill();
    } else {
      ctx.globalAlpha = 0.55 * hintA;
      glow(ctx, cxp, cyp, 40, C.cyan, 0.18 * hintA);
      ctx.fillStyle = C.cyan;
      var aw = clamp(Math.min(pl.w * 0.17, pl.h * 0.34), 13, 30);
      for (var s = -1; s <= 1; s += 2) {
        var ax2 = cxp + s * (aw + 8) + Math.sin(V.t * 2.6) * s * 2.5;
        ctx.beginPath();
        ctx.moveTo(ax2 + s * aw * 0.55, cyp);
        ctx.lineTo(ax2 - s * aw * 0.2, cyp - aw * 0.5);
        ctx.lineTo(ax2 - s * aw * 0.2, cyp + aw * 0.5);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 0.35 * hintA;
      ctx.fillStyle = C.ink;
      ctx.font = fm(clamp(Math.min(pl.w * 0.1, pl.h * 0.2), 8, 15));
      ctx.textAlign = 'center';
      ctx.fillText('DRAG', cxp, cyp + Math.min(pl.h * 0.34, 26));
    }
    ctx.restore();

    /* jump pad */
    ctx.save();
    var jHot = pointer.jumpFlash > 0;
    ctx.fillStyle = 'rgba(20,10,32,0.9)';
    rr(ctx, pr.x, pr.y, pr.w, pr.h, 16); ctx.fill();
    ctx.strokeStyle = hexA(C.mag, jHot ? 0.9 : 0.34);
    ctx.lineWidth = 1.4; ctx.stroke();
    var jx = pr.x + pr.w / 2, jy = pr.y + pr.h / 2;
    var jr = clamp(Math.min(pr.w, pr.h) * 0.33, 20, 46);
    var canJump = sim.machine.grounded;
    glow(ctx, jx, jy, jr * 2.6, C.mag, (canJump ? 0.3 : 0.1) + (jHot ? 0.5 : 0) * 1);
    ctx.globalAlpha = canJump ? 1 : 0.45;
    var jg = ctx.createRadialGradient(jx - jr * 0.3, jy - jr * 0.4, 1, jx, jy, jr * 1.2);
    jg.addColorStop(0, '#ffffff'); jg.addColorStop(0.6, C.mag); jg.addColorStop(1, '#6b1a56');
    ctx.fillStyle = jg;
    ctx.beginPath(); ctx.arc(jx, jy, jr * (jHot ? 0.88 : 1), 0, TAU); ctx.fill();
    /* chevron up */
    ctx.fillStyle = '#0b0620';
    ctx.beginPath();
    ctx.moveTo(jx, jy - jr * 0.45);
    ctx.lineTo(jx + jr * 0.5, jy + jr * 0.12);
    ctx.lineTo(jx + jr * 0.2, jy + jr * 0.12);
    ctx.lineTo(jx + jr * 0.2, jy + jr * 0.5);
    ctx.lineTo(jx - jr * 0.2, jy + jr * 0.5);
    ctx.lineTo(jx - jr * 0.2, jy + jr * 0.12);
    ctx.lineTo(jx - jr * 0.5, jy + jr * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* -- frame -------------------------------------------------------- */

  function frame(sim, dt, opts) {
    opts = opts || {};
    consume(sim, opts.audio);
    updateFx(sim, dt);

    var dpr = L.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.cw, L.ch);
    ctx.fillStyle = '#04030c';
    ctx.fillRect(0, 0, L.cw, L.ch);

    /* letterbox glow so a wide frame still feels composed */
    var st = L.stage;
    if (st.x > 2) {
      var lg = Math.min(st.x * 2.2, 280);
      glow(ctx, st.x, L.ch * 0.45, lg, C.mag, 0.10);
      glow(ctx, st.x + st.w, L.ch * 0.45, lg, C.cyan, 0.10);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(st.x, st.y, st.w, st.h);
    ctx.clip();
    ctx.translate(st.x, st.y);
    ctx.scale(st.s, st.s);
    ctx.translate(V.shakeX, V.shakeY);

    drawBackdrop(sim);
    drawLane(sim, K.HIGH_LANE_Y, C.mag, 'HI', V.lanePulse.high);
    drawLane(sim, K.LOW_LANE_Y, C.amber, 'LO', V.lanePulse.low);
    drawTelegraphs(sim);
    drawGround(sim);

    var i;
    for (i = 0; i < sim.enemies.length; i++) {
      if (sim.enemies[i].lane === 'ground') drawWalker(sim, sim.enemies[i]);
    }
    drawMachine(sim);
    for (i = 0; i < sim.enemies.length; i++) {
      if (sim.enemies[i].lane !== 'ground') drawFlyer(sim, sim.enemies[i]);
    }
    drawBall(sim);
    drawFx();

    /* always-on vignette for focus */
    var vg2 = ctx.createRadialGradient(K.W / 2, K.H * 0.46, K.H * 0.3, K.W / 2, K.H * 0.46, K.H * 0.75);
    vg2.addColorStop(0, 'rgba(0,0,0,0)');
    vg2.addColorStop(1, 'rgba(0,0,0,0.68)');
    ctx.fillStyle = vg2;
    ctx.fillRect(0, 0, K.W, K.H);

    /* the last seconds close in on the stage: painted over the focus vignette
       so it reads, and pulsed once per remaining second */
    if (V.tension > 0.01) {
      var beatT = Math.abs(Math.sin(Math.PI * (sim.remainingMs / 1000)));
      var ten = V.tension * (0.62 + 0.38 * beatT);
      var vg = ctx.createRadialGradient(K.W / 2, K.H * 0.5, K.H * (0.30 - 0.12 * V.tension),
                                        K.W / 2, K.H * 0.5, K.H * 0.68);
      vg.addColorStop(0, 'rgba(255,40,70,0)');
      vg.addColorStop(0.62, 'rgba(255,34,64,' + (0.16 * ten).toFixed(3) + ')');
      vg.addColorStop(1, 'rgba(255,26,58,' + (0.62 * ten).toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, K.W, K.H);
      ctx.globalAlpha = 0.5 * ten;
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 2 + 4 * ten;
      ctx.strokeRect(0, 0, K.W, K.H);
      ctx.globalAlpha = 1;
    }

    drawHud(sim, !!opts.muted);
    if (sim.phase === 'ready') drawReady(sim);
    if (sim.phase === 'over') drawOver(sim);

    if (V.flash > 0.005) {
      ctx.globalAlpha = Math.min(0.6, V.flash);
      ctx.fillStyle = V.flashColor;
      ctx.fillRect(0, 0, K.W, K.H);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    /* stage frame line */
    ctx.strokeStyle = hexA(C.cyan, 0.18);
    ctx.lineWidth = 1;
    ctx.strokeRect(st.x + 0.5, st.y + 0.5, st.w - 1, st.h - 1);

    drawPads(sim, opts.pointer || {});
  }

  function muteHitTest(x, y) {
    var st = L.stage;
    var wx = (x - st.x) / st.s, wy = (y - st.y) / st.s;
    var dx = wx - muteRect.x, dy = wy - muteRect.y;
    return dx * dx + dy * dy <= muteRect.r * muteRect.r;
  }

  global.StompRender = {
    init: init,
    setLayout: setLayout,
    frame: frame,
    best: best,
    submitBest: submitBest,
    muteHitTest: muteHitTest,
    resetView: function () {
      V.parts.length = 0; V.rings.length = 0; V.floats.length = 0; V.trail.length = 0;
      V.seq = 0; V.shake = 0; V.flash = 0; V.overT = 0; V.readyT = 0;
      V.hitT = V.burstT = V.hurtT = V.dropT = V.powerT = V.landT = V.jumpT = V.stompT = 0;
      V.tension = 0; V.machSquash = 0; V.ballSquash = 0;
    },
    C: C
  };
})(window);
