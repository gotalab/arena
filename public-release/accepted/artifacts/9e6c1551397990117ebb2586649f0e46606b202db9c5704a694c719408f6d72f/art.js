/* STOMP — presentation.  Reads the simulation, never writes to it.
 * Everything here is view-only dressing: particles, expressions, shake, glow.  */
(function (global) {
  'use strict';

  var C = global.StompSim.CONST;
  var W = C.W, H = C.H;
  var GROUND_Y = C.GROUND_Y, LOW = C.LOW_LANE_Y, HIGH = C.HIGH_LANE_Y;
  var MHW = C.MACHINE_HALF_W, MHH = C.MACHINE_HALF_H;
  var TAU = Math.PI * 2;

  var PAL = {
    ink: '#07061a',
    deep: '#0d0a2b',
    mid: '#291a55',
    warm: '#4b2367',
    cyan: '#9ffcff',
    cyanDim: '#4fd8ea',
    teal: '#35f0c8',
    violet: '#b57bff',
    amber: '#ffb03a',
    amberDeep: '#e8741a',
    rose: '#ff4d7d',
    red: '#ff3b5c',
    slate: '#241a3d',
    slowBody: '#8f6ce0',
    slowBodyDark: '#5b3fa8',
    fastBody: '#ff5f8d',
    fastBodyDark: '#c02a58',
    walker: '#ff9a3c',
    walkerDark: '#b85a12'
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

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

  /* additive soft glow — cheaper and steadier than shadowBlur on phones */
  function glow(ctx, x, y, r, color, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function setFont(ctx, weight, size, spacing) {
    ctx.font = weight + ' ' + size + 'px ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
    try { ctx.letterSpacing = (spacing || 0) + 'px'; } catch (e) {}
  }

  /* ============================================================ backdrop == */
  function makeBackdrop() {
    var q = 2;
    var cv = document.createElement('canvas');
    cv.width = W * q; cv.height = H * q;
    var x = cv.getContext('2d');
    x.scale(q, q);

    var sky = x.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0.00, '#06051a');
    sky.addColorStop(0.28, '#150e35');
    sky.addColorStop(0.58, '#2a1550');
    sky.addColorStop(0.86, '#4a1c5c');
    sky.addColorStop(1.00, '#6b2158');
    x.fillStyle = sky;
    x.fillRect(0, 0, W, GROUND_Y);

    /* a low sun sinking behind the skyline */
    var sunY = 470, sunR = 96;
    var sg = x.createRadialGradient(212, sunY, 4, 212, sunY, sunR);
    sg.addColorStop(0, 'rgba(255,190,120,0.85)');
    sg.addColorStop(0.35, 'rgba(255,120,110,0.34)');
    sg.addColorStop(1, 'rgba(255,80,140,0)');
    x.fillStyle = sg;
    x.fillRect(0, sunY - sunR, W, sunR * 2);
    x.globalAlpha = 0.5;
    x.fillStyle = '#ffd9a0';
    x.beginPath(); x.arc(212, sunY, 30, 0, TAU); x.fill();
    x.globalAlpha = 1;

    /* deterministic starfield */
    var seed = 1337;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    for (var i = 0; i < 90; i++) {
      var sx = rnd() * W, sy = rnd() * 430, r = 0.5 + rnd() * 1.2;
      x.globalAlpha = 0.18 + rnd() * 0.55;
      x.fillStyle = rnd() < 0.22 ? '#ffd7f0' : '#dff3ff';
      x.beginPath(); x.arc(sx, sy, r, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;

    /* three parallax skyline layers */
    function skyline(baseY, hMin, hMax, wMin, wMax, fill, alpha) {
      x.globalAlpha = alpha;
      x.fillStyle = fill;
      var px = -20;
      while (px < W + 20) {
        var bw = wMin + rnd() * (wMax - wMin);
        var bh = hMin + rnd() * (hMax - hMin);
        x.fillRect(px, baseY - bh, bw, bh);
        /* antenna + lit windows for the near layer */
        if (alpha > 0.6 && rnd() < 0.35) x.fillRect(px + bw * 0.45, baseY - bh - 10, 1.5, 10);
        if (alpha > 0.6) {
          for (var wy = baseY - bh + 5; wy < baseY - 4; wy += 7) {
            for (var wx = px + 3; wx < px + bw - 4; wx += 6) {
              if (rnd() < 0.22) {
                x.save();
                x.globalAlpha = 0.35 + rnd() * 0.4;
                x.fillStyle = rnd() < 0.3 ? '#ffd08a' : '#8fe6ff';
                x.fillRect(wx, wy, 2, 3);
                x.restore();
              }
            }
          }
        }
        px += bw + 2 + rnd() * 7;
      }
      x.globalAlpha = 1;
    }
    skyline(GROUND_Y - 34, 26, 78, 16, 34, '#2b1a4e', 0.45);
    skyline(GROUND_Y - 14, 30, 96, 14, 30, '#1c1038', 0.72);
    skyline(GROUND_Y + 2, 22, 62, 18, 40, '#100a25', 0.95);

    /* haze over the horizon */
    var hz = x.createLinearGradient(0, GROUND_Y - 130, 0, GROUND_Y);
    hz.addColorStop(0, 'rgba(255,110,160,0)');
    hz.addColorStop(1, 'rgba(255,110,160,0.16)');
    x.fillStyle = hz;
    x.fillRect(0, GROUND_Y - 130, W, 130);

    /* ground slab */
    var gr = x.createLinearGradient(0, GROUND_Y, 0, H);
    gr.addColorStop(0, '#3a1f5e');
    gr.addColorStop(0.18, '#1d1039');
    gr.addColorStop(1, '#0a0620');
    x.fillStyle = gr;
    x.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    /* perspective floor grid */
    x.strokeStyle = 'rgba(255,90,160,0.16)';
    x.lineWidth = 1;
    for (var gx = -6; gx <= 12; gx++) {
      x.beginPath();
      x.moveTo(W / 2 + gx * 20, GROUND_Y);
      x.lineTo(W / 2 + gx * 62, H);
      x.stroke();
    }
    for (var gy = 0; gy < 6; gy++) {
      var yy = GROUND_Y + Math.pow(gy / 5, 1.9) * (H - GROUND_Y);
      x.globalAlpha = 0.5 - gy * 0.06;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke();
    }
    x.globalAlpha = 1;

    return cv;
  }

  /* ============================================================== View ==== */
  var View = {
    canvas: null, ctx: null, backdrop: null,
    scale: 1, ox: 0, oy: 0, barH: 130, vw: 0, vh: 0, dpr: 1,
    t: 0,
    lastSeq: 0,
    fx: null
  };

  View.init = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.backdrop = makeBackdrop();
    this.resetFx();
  };

  View.resetFx = function () {
    this.lastSeq = 0;
    this.fx = {
      parts: [], texts: [], rings: [],
      shake: 0, shakeX: 0, shakeY: 0,
      flash: 0, flashCol: '255,255,255',
      squash: 0, tilt: 0, tiltV: 0,
      expr: 'idle', exprT: 0,
      blink: 1.4, blinkT: 0,
      wheel: 0,
      antA: 0, antV: 0,
      ballSquash: 0, ballSpin: 0, ballGlow: 0,
      trail: [],
      laneGlow: { low: 0, high: 0 },
      enemy: {},
      tierSeen: 0,
      tierBanner: 0,
      lastSecond: -1,
      warned: -1,
      respawn: 0,
      idleT: 0
    };
  };

  /* bottomInset keeps the control surfaces clear of a phone's home indicator */
  View.layout = function (vw, vh, dpr, bottomInset) {
    this.vw = vw; this.vh = vh; this.dpr = dpr;
    var avail = Math.max(120, vh - (bottomInset || 0));
    var MIN_BAR = 112, MAX_BAR = 224;
    var scale = Math.min(vw / W, avail / (H + MIN_BAR));
    var logicalH = clamp(avail / scale, H + MIN_BAR, H + MAX_BAR);
    var barH = logicalH - H;
    var stageW = W * scale, stageH = logicalH * scale;
    this.scale = scale;
    this.barH = barH;
    this.ox = Math.round((vw - stageW) / 2);
    this.oy = Math.round((avail - stageH) / 2);

    this.canvas.width = Math.max(1, Math.round(vw * dpr));
    this.canvas.height = Math.max(1, Math.round(vh * dpr));
    this.canvas.style.width = vw + 'px';
    this.canvas.style.height = vh + 'px';
    return { scale: scale, ox: this.ox, oy: this.oy, barH: barH, stageW: stageW, stageH: stageH };
  };

  /* ------------------------------------------------------------- effects -- */
  function part(fx, o) {
    if (fx.parts.length > 340) fx.parts.shift();
    fx.parts.push({
      x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0,
      g: o.g === undefined ? 380 : o.g,
      life: o.life, max: o.life,
      r: o.r || 2, col: o.col || '#fff',
      kind: o.kind || 'spark', drag: o.drag === undefined ? 0.98 : o.drag,
      rot: o.rot || 0, spin: o.spin || 0
    });
  }
  function ring(fx, x, y, r0, r1, life, col, wid) {
    fx.rings.push({ x: x, y: y, r0: r0, r1: r1, life: life, max: life, col: col, w: wid || 3 });
  }
  function text(fx, x, y, s, col, size) {
    fx.texts.push({ x: x, y: y, s: s, col: col, size: size || 13, life: 0.95, max: 0.95 });
  }
  function burst(fx, x, y, n, spread, col, speed, life, rad) {
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + Math.random() * spread;
      var sp = speed * (0.55 + Math.random() * 0.75);
      part(fx, {
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: life * (0.6 + Math.random() * 0.6), r: rad * (0.6 + Math.random() * 0.8), col: col
      });
    }
  }
  function enemyFx(fx, id) {
    if (!fx.enemy[id]) fx.enemy[id] = { flash: 0, wob: 0, shake: 0 };
    return fx.enemy[id];
  }
  function fmtTime(ms) { return (ms >= 0 ? '+' : '') + (ms / 1000).toFixed(1) + 's'; }

  /* ---------------------------------------------------------- event feed -- */
  View.consume = function (sim, Snd) {
    var fx = this.fx;
    var evs = sim.recentEvents;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      if (ev.sequence <= this.lastSeq) continue;
      this.lastSeq = ev.sequence;
      this.react(sim, ev, Snd);
    }
  };

  View.react = function (sim, ev, Snd) {
    var fx = this.fx;
    var m = sim.machine, b = sim.ball;
    var topY = m.y - MHH;
    var k = ev.kind;

    if (k === 'machine_jump') {
      Snd.play('machine_jump');
      fx.squash = -0.30;
      for (var i = 0; i < 7; i++) {
        part(fx, { x: m.x + (Math.random() - 0.5) * 30, y: GROUND_Y - 2,
          vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 50, life: 0.4, r: 2.4,
          col: 'rgba(255,180,220,0.75)', g: 120 });
      }
      ring(fx, m.x, GROUND_Y - 1, 6, 30, 0.32, 'rgba(255,140,200,0.6)', 2);
    } else if (k === 'machine_land') {
      Snd.play('machine_land');
      fx.squash = 0.34;
      fx.shake = Math.max(fx.shake, 1.6);
      for (var j = 0; j < 9; j++) {
        part(fx, { x: m.x + (Math.random() - 0.5) * 38, y: GROUND_Y - 2,
          vx: (Math.random() - 0.5) * 150, vy: -Math.random() * 70, life: 0.42, r: 2.6,
          col: 'rgba(255,200,235,0.7)', g: 260 });
      }
      ring(fx, m.x, GROUND_Y - 1, 4, 36, 0.30, 'rgba(255,160,210,0.55)', 2.5);
    } else if (k === 'ball_bounce_weak' || k === 'ball_bounce_normal' || k === 'ball_bounce_power') {
      var kind = k.slice(12);
      Snd.play('bounce_' + kind);
      fx.ballSquash = kind === 'power' ? 0.55 : kind === 'normal' ? 0.42 : 0.28;
      fx.squash = kind === 'power' ? 0.52 : kind === 'normal' ? 0.36 : 0.24;
      fx.antV += kind === 'power' ? -13 : -7;
      fx.expr = kind === 'power' ? 'power' : 'launch';
      fx.exprT = kind === 'power' ? 0.5 : 0.32;
      fx.ballGlow = kind === 'power' ? 1 : 0.55;
      var col = kind === 'power' ? PAL.amber : kind === 'weak' ? '#8fb6d8' : PAL.cyan;
      ring(fx, b.x, topY, 6, kind === 'power' ? 52 : 34, 0.36, col, kind === 'power' ? 3.5 : 2.5);
      var n = kind === 'power' ? 14 : kind === 'normal' ? 8 : 4;
      for (var q = 0; q < n; q++) {
        var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
        var sp = (kind === 'power' ? 200 : 120) * (0.5 + Math.random());
        part(fx, { x: b.x, y: topY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.45, r: 2.2, col: col, g: 420 });
      }
      if (kind === 'power') { fx.flash = 0.22; fx.flashCol = '255,190,110'; fx.shake = Math.max(fx.shake, 2.4); }
    } else if (k === 'top_hit') {
      var e = findEnemy(sim, ev.enemyId);
      var n2 = e ? e.hitsTaken : 1;
      Snd.play('top_hit', n2);
      var ex = e ? e.x : b.x, ey = e ? e.y : b.y;
      var ef = enemyFx(fx, ev.enemyId);
      ef.flash = 1; ef.shake = 5 + n2 * 2;
      fx.shake = Math.max(fx.shake, 2.5 + n2 * 1.4);
      fx.ballSquash = 0.5;
      fx.ballGlow = 1;
      fx.expr = 'happy'; fx.exprT = 0.55;
      var lane = e ? e.lane : 'low';
      fx.laneGlow[lane] = 1;
      var hcol = n2 >= 3 ? '#fff2a8' : n2 === 2 ? '#ffd36e' : PAL.cyan;
      ring(fx, ex, ey - 14, 4, 34 + n2 * 8, 0.34, hcol, 3);
      burst(fx, ex, ey - 12, 6 + n2 * 4, 0.5, hcol, 190 + n2 * 40, 0.5, 2.4);
      text(fx, ex, ey - 30, fmtTime(ev.amountMs), '#8dffd0', 12 + n2);
      fx.flash = Math.max(fx.flash, 0.10 * n2);
      fx.flashCol = '255,240,200';
    } else if (k === 'enemy_defeated') {
      var e2 = findEnemy(sim, ev.enemyId);
      var dx2 = e2 ? e2.x : b.x, dy2 = e2 ? e2.y : b.y;
      Snd.play('enemy_defeated');
      fx.shake = Math.max(fx.shake, 9);
      fx.flash = 0.46; fx.flashCol = '255,255,235';
      fx.expr = 'happy'; fx.exprT = 1.0;
      ring(fx, dx2, dy2, 6, 74, 0.42, '#ffffff', 4);
      ring(fx, dx2, dy2, 6, 108, 0.60, PAL.cyan, 3);
      ring(fx, dx2, dy2, 6, 146, 0.82, PAL.violet, 2);
      burst(fx, dx2, dy2, 26, 0.8, '#fff6c8', 300, 0.85, 3.2);
      burst(fx, dx2, dy2, 14, 0.9, PAL.rose, 210, 0.95, 2.6);
      for (var c = 0; c < 9; c++) {
        var ca = Math.random() * TAU, cs = 90 + Math.random() * 210;
        part(fx, { x: dx2, y: dy2, vx: Math.cos(ca) * cs, vy: Math.sin(ca) * cs - 60,
          life: 1.1, r: 3.4 + Math.random() * 2.6,
          col: e2 && e2.type === 'fastFlyer' ? PAL.fastBodyDark : PAL.slowBodyDark,
          kind: 'chunk', g: 640, spin: (Math.random() - 0.5) * 22 });
      }
      text(fx, dx2, dy2 - 34, fmtTime(ev.amountMs), '#8dffd0', 17);
      text(fx, dx2, dy2 - 54, 'DOWN!', '#fff2a8', 15);
    } else if (k === 'wrong_side_hit') {
      var e3 = findEnemy(sim, ev.enemyId);
      Snd.play('wrong_side_hit');
      var wx = e3 ? e3.x : b.x, wy = e3 ? e3.y : b.y;
      fx.shake = Math.max(fx.shake, 6);
      fx.flash = 0.34; fx.flashCol = '255,60,90';
      fx.expr = 'hurt'; fx.exprT = 1.0;
      fx.ballSquash = 0.45;
      burst(fx, b.x, b.y, 14, 0.7, PAL.red, 200, 0.6, 2.6);
      ring(fx, wx, wy + 12, 6, 44, 0.34, PAL.red, 3);
      text(fx, b.x, b.y - 22, fmtTime(ev.amountMs), '#ff859c', 15);
      var ef3 = enemyFx(fx, ev.enemyId); ef3.wob = 0.5;
    } else if (k === 'ball_drop') {
      Snd.play('ball_drop');
      fx.shake = Math.max(fx.shake, 5);
      fx.flash = 0.24; fx.flashCol = '120,140,200';
      fx.expr = 'sad'; fx.exprT = 1.3;
      fx.trail.length = 0;
      fx.respawn = 1;
      for (var d = 0; d < 16; d++) {
        part(fx, { x: b.x, y: GROUND_Y - 3, vx: (Math.random() - 0.5) * 230, vy: -Math.random() * 150,
          life: 0.7, r: 2.8, col: 'rgba(190,200,240,0.8)', g: 520 });
      }
      ring(fx, b.x, GROUND_Y - 2, 4, 60, 0.42, 'rgba(160,180,240,0.7)', 3);
      text(fx, b.x, GROUND_Y - 40, fmtTime(ev.amountMs), '#a9b6ff', 16);
    } else if (k === 'ground_stomp') {
      var e4 = findEnemy(sim, ev.enemyId);
      Snd.play('ground_stomp');
      var gx = e4 ? e4.x : m.x;
      fx.shake = Math.max(fx.shake, 3.5);
      burst(fx, gx, GROUND_Y - 10, 12, 0.6, PAL.amber, 190, 0.55, 2.6);
      ring(fx, gx, GROUND_Y - 6, 4, 40, 0.32, PAL.amber, 2.5);
      text(fx, gx, GROUND_Y - 46, fmtTime(ev.amountMs), '#ffd08a', 12);
    } else if (k === 'walker_bite') {
      var e5 = findEnemy(sim, ev.enemyId);
      Snd.play('walker_bite');
      fx.shake = Math.max(fx.shake, 4.5);
      fx.flash = 0.26; fx.flashCol = '255,80,60';
      fx.expr = 'hurt'; fx.exprT = 0.9;
      burst(fx, e5 ? e5.x : m.x, GROUND_Y - 14, 10, 0.7, PAL.red, 170, 0.55, 2.4);
      text(fx, m.x, GROUND_Y - 60, fmtTime(ev.amountMs), '#ff859c', 14);
    } else if (k === 'run_end') {
      Snd.play('run_end');
      fx.expr = 'spent'; fx.exprT = 999;
      fx.flash = 0.5; fx.flashCol = '255,90,120';
      fx.shake = Math.max(fx.shake, 7);
    } else if (k === 'run_start') {
      fx.expr = 'launch'; fx.exprT = 0.3;
    }
  };

  function findEnemy(sim, id) {
    for (var i = 0; i < sim.enemies.length; i++) if (sim.enemies[i].id === id) return sim.enemies[i];
    return null;
  }

  /* The resting expression: the pair braces itself in the beat before a return. */
  View.baseExpr = function (sim) {
    if (sim.phase === 'ended') return 'spent';
    if (sim.phase === 'ready') return 'idle';
    var b = sim.ball, m = sim.machine;
    if (b.vy > 60 && b.y > 350 && b.y < 545 && Math.abs(b.x - m.x) < 105) return 'windup';
    return 'idle';
  };

  /* Idle stage breathing.  View-only: the rules are frozen, the stage is not. */
  View.idleBob = function (sim) {
    if (sim.phase !== 'ready') return { m: 0, b: 0 };
    var t = this.t;
    return {
      m: Math.sin(t * 1.7) * 1.7,
      b: Math.sin(t * 1.7) * 1.7 - Math.abs(Math.sin(t * 2.35)) * 5.5
    };
  };

  /* ------------------------------------------------------------- update --- */
  View.update = function (dt, sim, Snd) {
    var fx = this.fx;
    this.t += dt;
    if (sim.phase === 'ready') fx.idleT += dt;

    this.consume(sim, Snd);

    /* tier ceremony */
    if (sim.difficulty > fx.tierSeen) {
      fx.tierSeen = sim.difficulty;
      fx.tierBanner = 1.5;
      Snd.play('tier_up');
      text(fx, W / 2, 250, 'TIER ' + sim.difficulty, PAL.violet, 20);
    }
    fx.tierBanner = Math.max(0, fx.tierBanner - dt);

    /* incoming-threat warning chime, once per pattern */
    if (sim.phase === 'playing' && sim.pendingAir) {
      var lead = sim.pendingAir.at - sim.elapsedMs;
      if (lead < 1150 && lead > 0 && fx.warned !== sim.pendingAir.at) {
        fx.warned = sim.pendingAir.at;
        Snd.play('warn');
      }
    }

    /* last-ten-seconds heartbeat */
    if (sim.phase === 'playing') {
      var sec = Math.ceil(sim.remainingMs / 1000);
      if (sec !== fx.lastSecond) {
        if (fx.lastSecond >= 0 && sec <= 10) Snd.play('tick', sec <= 5);
        fx.lastSecond = sec;
      }
    }

    /* machine body springs */
    fx.squash += (0 - fx.squash) * Math.min(1, dt * 13);
    fx.antV += (-fx.antA * 190 - fx.antV * 5.2) * dt;
    fx.antA += fx.antV * dt;
    fx.antA = clamp(fx.antA, -0.7, 0.7);
    fx.antV -= sim.machine.vx * dt * 0.09;
    fx.wheel += sim.machine.vx * dt * 0.14;
    fx.tiltV += (-fx.tilt * 220 - fx.tiltV * 9) * dt;
    fx.tilt += fx.tiltV * dt;
    fx.tilt = clamp(fx.tilt + sim.machine.vx * dt * 0.0016, -0.16, 0.16);

    fx.blinkT += dt;
    if (fx.blinkT > fx.blink) { fx.blinkT = 0; fx.blink = 2.2 + Math.random() * 3.4; }

    if (fx.exprT < 900) fx.exprT = Math.max(0, fx.exprT - dt);
    if (fx.exprT === 0) fx.expr = this.baseExpr(sim);
    if (sim.phase === 'ended') { fx.expr = 'spent'; fx.exprT = 999; }

    fx.ballSquash *= Math.pow(0.0016, dt);
    fx.ballGlow *= Math.pow(0.06, dt);
    fx.respawn = Math.max(0, fx.respawn - dt * 1.1);
    fx.ballSpin += (sim.ball.vx * 0.012) * dt * 60 * 0.016;
    fx.laneGlow.low *= Math.pow(0.05, dt);
    fx.laneGlow.high *= Math.pow(0.05, dt);

    /* ball trail */
    if (sim.phase !== 'ready') {
      fx.trail.push({ x: sim.ball.x, y: sim.ball.y });
      if (fx.trail.length > 15) fx.trail.shift();
    } else {
      fx.trail.length = 0;
    }

    /* shake + flash */
    fx.shake *= Math.pow(0.0009, dt);
    if (fx.shake < 0.05) fx.shake = 0;
    fx.shakeX = (Math.random() - 0.5) * fx.shake * 2;
    fx.shakeY = (Math.random() - 0.5) * fx.shake * 2;
    fx.flash = Math.max(0, fx.flash - dt * 2.4);

    /* per-enemy fx, pruned against live ids */
    var live = {};
    for (var i = 0; i < sim.enemies.length; i++) live[sim.enemies[i].id] = 1;
    for (var id in fx.enemy) {
      if (!live[id]) { delete fx.enemy[id]; continue; }
      var ef = fx.enemy[id];
      ef.flash = Math.max(0, ef.flash - dt * 4.2);
      ef.shake *= Math.pow(0.002, dt);
      ef.wob *= Math.pow(0.02, dt);
    }

    /* particles */
    for (var p = fx.parts.length - 1; p >= 0; p--) {
      var o = fx.parts[p];
      o.life -= dt;
      if (o.life <= 0) { fx.parts.splice(p, 1); continue; }
      o.vy += o.g * dt;
      o.vx *= Math.pow(o.drag, dt * 60);
      o.x += o.vx * dt; o.y += o.vy * dt;
      o.rot += o.spin * dt;
    }
    for (var r2 = fx.rings.length - 1; r2 >= 0; r2--) {
      fx.rings[r2].life -= dt;
      if (fx.rings[r2].life <= 0) fx.rings.splice(r2, 1);
    }
    for (var tx = fx.texts.length - 1; tx >= 0; tx--) {
      var T = fx.texts[tx];
      T.life -= dt;
      T.y -= dt * 34;
      if (T.life <= 0) fx.texts.splice(tx, 1);
    }
  };

  /* =============================================================== draw === */
  View.render = function (sim) {
    var ctx = this.ctx, fx = this.fx;
    var s = this.scale, ox = this.ox, oy = this.oy;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#04030d';
    ctx.fillRect(0, 0, this.vw, this.vh);

    /* letterbox atmosphere */
    var stageW = W * s, stageH = (H + this.barH) * s;
    var bg = ctx.createRadialGradient(ox + stageW / 2, oy + stageH * 0.4, stageW * 0.2,
      ox + stageW / 2, oy + stageH * 0.4, Math.max(this.vw, this.vh) * 0.75);
    bg.addColorStop(0, 'rgba(70,30,110,0.42)');
    bg.addColorStop(1, 'rgba(4,3,13,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.vw, this.vh);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.rect(0, 0, W, H + this.barH);
    ctx.clip();

    this.drawBar(ctx, sim);

    /* world, shaken */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.translate(fx.shakeX, fx.shakeY);

    ctx.drawImage(this.backdrop, 0, 0, W, H);
    this.drawStars(ctx);
    this.drawLanes(ctx, sim);
    this.drawGroundEdge(ctx, sim);
    this.drawWarning(ctx, sim);

    var i;
    for (i = 0; i < sim.enemies.length; i++) this.drawShadow(ctx, sim.enemies[i]);
    this.drawMachineShadow(ctx, sim);
    for (i = 0; i < sim.enemies.length; i++) {
      var e = sim.enemies[i];
      if (e.lane === 'ground') this.drawWalker(ctx, e);
      else this.drawFlyer(ctx, e);
    }
    this.drawBall(ctx, sim);
    this.drawMachine(ctx, sim);
    this.drawParticles(ctx);
    this.drawTexts(ctx);
    this.drawTension(ctx, sim);
    ctx.restore();

    this.drawHud(ctx, sim);

    /* full-stage flash */
    if (fx.flash > 0.003) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(' + fx.flashCol + ',' + (fx.flash * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    ctx.restore();
  };

  View.drawStars = function (ctx) {
    var t = this.t;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 16; i++) {
      var x = ((i * 97) % 340) + 10;
      var y = ((i * 53) % 340) + 24;
      var a = 0.20 + 0.44 * (0.5 + 0.5 * Math.sin(t * (1.1 + i * 0.19) + i));
      ctx.globalAlpha = a;
      ctx.fillStyle = i % 3 === 0 ? '#ffd7f0' : '#cfefff';
      ctx.beginPath(); ctx.arc(x, y, 1.1, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ the lanes - */
  View.drawLanes = function (ctx, sim) {
    this.drawLane(ctx, HIGH, PAL.violet, '181,123,255', this.fx.laneGlow.high, 1);
    this.drawLane(ctx, LOW, PAL.teal, '53,240,200', this.fx.laneGlow.low, 0);
  };

  View.drawLane = function (ctx, y, col, rgb, hot, idx) {
    var t = this.t;
    var breathe = 0.5 + 0.5 * Math.sin(t * 1.25 + idx * 1.9);
    var h = 21;
    var a = 0.055 + breathe * 0.05 + hot * 0.28;

    var g = ctx.createLinearGradient(0, y - h, 0, y + h);
    g.addColorStop(0, 'rgba(' + rgb + ',0)');
    g.addColorStop(0.5, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - h, W, h * 2);

    /* the two rails that bound the lane read as its top and bottom */
    ctx.save();
    ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.30 + breathe * 0.16 + hot * 0.5).toFixed(3) + ')';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([13, 9]);
    ctx.lineDashOffset = -(t * 16 + idx * 7) % 22;
    ctx.beginPath(); ctx.moveTo(0, y - h); ctx.lineTo(W, y - h); ctx.stroke();
    ctx.setLineDash([5, 11]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(0, y + h); ctx.lineTo(W, y + h); ctx.stroke();
    ctx.restore();

    /* edge markers */
    ctx.save();
    ctx.globalAlpha = clamp(0.35 + breathe * 0.3 + hot * 0.6, 0, 1);
    ctx.fillStyle = col;
    for (var side = 0; side < 2; side++) {
      var x = side ? W - 3 : 0;
      ctx.fillRect(x, y - 9, 3, 18);
    }
    ctx.restore();
    if (hot > 0.02) glow(ctx, W / 2, y, 200, 'rgba(' + rgb + ',0.16)', hot);
  };

  View.drawGroundEdge = function (ctx, sim) {
    var t = this.t;
    var pulse = 0.6 + 0.4 * Math.sin(t * 2.1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createLinearGradient(0, GROUND_Y - 16, 0, GROUND_Y + 3);
    g.addColorStop(0, 'rgba(255,70,150,0)');
    g.addColorStop(1, 'rgba(255,90,165,' + (0.20 * pulse).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y - 16, W, 19);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,140,200,' + (0.75 + pulse * 0.25).toFixed(3) + ')';
    ctx.fillRect(0, GROUND_Y - 1.5, W, 2.4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, GROUND_Y - 1.5, W, 0.8);
  };

  /* ------------------------------------------------------- threat warning - */
  View.drawWarning = function (ctx, sim) {
    if (sim.phase !== 'playing' || !sim.pendingAir) return;
    var p = sim.pendingAir;
    var lead = p.at - sim.elapsedMs;
    if (lead > 1150 || lead < -60) return;
    var y = p.lane === 'high' ? HIGH : LOW;
    var right = p.dir < 0;
    var x = right ? W - 12 : 12;
    var k = 1 - clamp(lead / 1150, 0, 1);
    var pulse = 0.45 + 0.55 * Math.abs(Math.sin(this.t * 9));
    var col = p.type === 'fastFlyer' ? PAL.rose : PAL.violet;
    var rgb = p.type === 'fastFlyer' ? '255,77,125' : '181,123,255';

    ctx.save();
    ctx.globalAlpha = (0.35 + k * 0.65) * pulse;
    glow(ctx, x, y, 30, 'rgba(' + rgb + ',0.5)', 0.7);
    ctx.fillStyle = col;
    ctx.translate(x, y);
    if (right) ctx.scale(-1, 1);
    for (var i = 0; i < 2; i++) {
      var off = i * 9 - k * 5;
      ctx.beginPath();
      ctx.moveTo(off, -9); ctx.lineTo(off + 8, 0); ctx.lineTo(off, 9);
      ctx.lineTo(off + 3, 0); ctx.closePath();
      ctx.globalAlpha *= 0.72;
      ctx.fill();
    }
    ctx.restore();
  };

  /* -------------------------------------------------------------- shadows - */
  View.drawShadow = function (ctx, e) {
    if (!e.active) return;
    var k = clamp(1 - (GROUND_Y - e.y) / 520, 0.12, 1);
    ctx.save();
    ctx.globalAlpha = 0.26 * k;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(e.x, GROUND_Y + 5, e.visualRadius * (0.5 + k * 0.7), 3.6 * (0.5 + k), 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  View.drawMachineShadow = function (ctx, sim) {
    var m = sim.machine;
    var k = clamp(1 - (C.MACHINE_REST_Y - m.y) / 160, 0.35, 1);
    ctx.save();
    ctx.globalAlpha = 0.38 * k;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(m.x, GROUND_Y + 4, 24 * k, 5 * k, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  /* ================================================== the machine: STOMPER = */
  View.drawMachine = function (ctx, sim) {
    var fx = this.fx, m = sim.machine;
    var expr = fx.expr;
    var hurt = expr === 'hurt';
    var spent = expr === 'spent';
    var sad = expr === 'sad';

    ctx.save();
    ctx.translate(m.x, m.y + this.idleBob(sim).m);
    var sq = clamp(fx.squash, -0.45, 0.45);
    if (sim.phase === 'ready') sq += Math.sin(this.t * 1.7 + 1.1) * 0.035;
    ctx.translate(0, MHH);
    ctx.scale(1 + sq * 0.5, 1 - sq * 0.5);
    ctx.rotate(fx.tilt + (spent ? 0.13 : 0));
    ctx.translate(0, -MHH);

    var body = hurt ? '#ff6f6f' : sad ? '#c78e4e' : spent ? '#9a6a34' : PAL.amber;
    var bodyDark = hurt ? '#c62c46' : spent ? '#6a4620' : PAL.amberDeep;
    var line = '#241237';

    /* treads */
    ctx.fillStyle = '#191029';
    rr(ctx, -24, 2, 48, 19, 8); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = '#0e0819';
    for (var tI = 0; tI < 6; tI++) {
      var tx2 = -21 + ((tI * 7 + (fx.wheel * 7) % 7) + 42) % 42;
      ctx.fillRect(tx2, 4.5, 2.6, 14);
    }
    /* wheels */
    for (var wI = -1; wI <= 1; wI += 2) {
      var wx = wI * 13, wy = 11.5;
      ctx.fillStyle = '#2f2145';
      ctx.beginPath(); ctx.arc(wx, wy, 6.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.save();
      ctx.translate(wx, wy); ctx.rotate(fx.wheel);
      ctx.strokeStyle = 'rgba(255,190,120,0.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
      ctx.restore();
    }

    /* body: a chunky rounded trapezoid */
    ctx.beginPath();
    ctx.moveTo(-19, -19);
    ctx.lineTo(19, -19);
    ctx.quadraticCurveTo(23, -19, 23.5, -13);
    ctx.lineTo(25, 5);
    ctx.quadraticCurveTo(25.5, 10, 20, 10);
    ctx.lineTo(-20, 10);
    ctx.quadraticCurveTo(-25.5, 10, -25, 5);
    ctx.lineTo(-23.5, -13);
    ctx.quadraticCurveTo(-23, -19, -19, -19);
    ctx.closePath();
    var bg2 = ctx.createLinearGradient(0, -20, 0, 10);
    bg2.addColorStop(0, body);
    bg2.addColorStop(0.55, body);
    bg2.addColorStop(1, bodyDark);
    ctx.fillStyle = bg2;
    ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 2.4; ctx.stroke();

    /* side vents */
    ctx.fillStyle = 'rgba(40,18,55,0.55)';
    for (var v = 0; v < 3; v++) {
      ctx.fillRect(-22 + v * 1.2, -8 + v * 4, 5, 2.4);
      ctx.fillRect(17 - v * 1.2, -8 + v * 4, 5, 2.4);
    }
    /* rivets */
    ctx.fillStyle = 'rgba(255,235,190,0.5)';
    ctx.beginPath(); ctx.arc(-17, 5, 1.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(17, 5, 1.3, 0, TAU); ctx.fill();

    /* the top plate — the bounce surface, always the brightest thing on him */
    var plateHot = clamp(fx.ballGlow, 0, 1);
    if (sim.phase === 'ready') plateHot = 0.32 + 0.30 * (0.5 + 0.5 * Math.sin(this.t * 2.2));
    ctx.save();
    glow(ctx, 0, -20, 26 + plateHot * 18, 'rgba(159,252,255,0.55)', 0.35 + plateHot * 0.55);
    var pg = ctx.createLinearGradient(0, -23.5, 0, -16);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.5, PAL.cyan);
    pg.addColorStop(1, '#2ba7c4');
    ctx.fillStyle = pg;
    rr(ctx, -20, -23.5, 40, 7.5, 3.2); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.fillStyle = 'rgba(20,60,80,0.55)';
    for (var cvi = -1; cvi <= 1; cvi++) {
      ctx.beginPath();
      ctx.moveTo(cvi * 9 - 3.4, -18.2);
      ctx.lineTo(cvi * 9, -21.6);
      ctx.lineTo(cvi * 9 + 3.4, -18.2);
      ctx.lineTo(cvi * 9, -19.6);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    /* antenna */
    ctx.save();
    ctx.translate(-15, -19);
    ctx.rotate(fx.antA);
    ctx.strokeStyle = '#2b1a3f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-3, -9, -5, -15); ctx.stroke();
    var bulb = hurt ? PAL.red : spent ? '#6a5a78' : PAL.rose;
    glow(ctx, -5, -15, 9, bulb, 0.7);
    ctx.fillStyle = bulb;
    ctx.beginPath(); ctx.arc(-5, -15, 3.1, 0, TAU); ctx.fill();
    ctx.restore();

    /* face plate */
    ctx.fillStyle = '#160c28';
    rr(ctx, -15.5, -14, 31, 18, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();

    var blinking = fx.blinkT < 0.11 && !spent && !hurt;
    var lookX = clamp((sim.ball.x - m.x) / 90, -1, 1) * 2.1;
    var lookY = clamp((sim.ball.y - m.y) / 220, -1, 1) * 1.6;
    this.drawMachineFace(ctx, expr, lookX, lookY, blinking);

    ctx.restore();
  };

  View.drawMachineFace = function (ctx, expr, lx, ly, blinking) {
    var eyeCol = expr === 'hurt' ? '#ff5f7a'
      : expr === 'sad' ? '#7f9ad8'
      : expr === 'spent' ? '#5a5f80'
      : expr === 'power' ? '#fff2a8'
      : PAL.cyan;
    var cy = -6.5;
    ctx.save();
    ctx.strokeStyle = eyeCol;
    ctx.fillStyle = eyeCol;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';

    for (var s = -1; s <= 1; s += 2) {
      var ex = s * 8;
      ctx.save();
      ctx.translate(ex, cy);
      if (expr === 'hurt') {
        ctx.beginPath();
        ctx.moveTo(-3.6, -3.6); ctx.lineTo(3.6, 3.6);
        ctx.moveTo(3.6, -3.6); ctx.lineTo(-3.6, 3.6);
        ctx.stroke();
      } else if (expr === 'spent' || blinking) {
        ctx.beginPath(); ctx.moveTo(-4.2, 0); ctx.lineTo(4.2, 0); ctx.stroke();
      } else if (expr === 'sad') {
        ctx.beginPath(); ctx.arc(0, 1.6, 4, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      } else if (expr === 'power' || expr === 'happy') {
        /* a four-point spark */
        ctx.beginPath();
        for (var i = 0; i < 4; i++) {
          var a = i * Math.PI / 2;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * 5.2, Math.sin(a) * 5.2);
        }
        ctx.lineWidth = 2.6;
        ctx.stroke();
        glow(ctx, 0, 0, 9, eyeCol, 0.55);
      } else if (expr === 'windup') {
        ctx.beginPath();
        rr(ctx, -4.2, -1.4, 8.4, 3.4, 1.6);
        ctx.fill();
      } else if (expr === 'launch') {
        ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0d0722';
        ctx.beginPath(); ctx.arc(lx * 0.6, ly * 0.6, 1.7, 0, TAU); ctx.fill();
        ctx.fillStyle = eyeCol;
      } else {
        /* idle lens with a tracking pupil */
        ctx.beginPath();
        rr(ctx, -4.2, -4.6, 8.4, 9.2, 3.4);
        ctx.fill();
        ctx.fillStyle = '#0d0722';
        ctx.beginPath(); ctx.arc(lx, ly, 1.9, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(-1.6, -2.4, 1, 0, TAU); ctx.fill();
        ctx.fillStyle = eyeCol;
      }
      ctx.restore();
    }

    /* mouth */
    ctx.lineWidth = 2;
    ctx.strokeStyle = eyeCol;
    ctx.beginPath();
    if (expr === 'hurt') {
      ctx.moveTo(-5, 2.2); ctx.lineTo(-2.5, -0.4); ctx.lineTo(0, 2.2); ctx.lineTo(2.5, -0.4); ctx.lineTo(5, 2.2);
      ctx.stroke();
    } else if (expr === 'sad') {
      ctx.arc(0, 4.6, 4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    } else if (expr === 'spent') {
      ctx.moveTo(-4, 1.6); ctx.lineTo(4, 1.6); ctx.stroke();
    } else if (expr === 'power' || expr === 'launch' || expr === 'happy') {
      ctx.fillStyle = eyeCol;
      ctx.ellipse(0, 1.4, 4.4, expr === 'power' ? 4 : 3, 0, 0, TAU);
      ctx.fill();
    } else if (expr === 'windup') {
      ctx.moveTo(-3.4, 1.6); ctx.lineTo(3.4, 1.6); ctx.stroke();
    } else {
      ctx.arc(0, -0.6, 4, Math.PI * 0.16, Math.PI * 0.84); ctx.stroke();
    }
    ctx.restore();
  };

  /* ====================================================== the ball: PIP ==== */
  View.drawBall = function (ctx, sim) {
    var b = sim.ball, fx = this.fx;
    if (!b.active) return;

    /* trail */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < fx.trail.length; i++) {
      var p = fx.trail[i];
      var k = i / fx.trail.length;
      ctx.globalAlpha = k * k * 0.36;
      ctx.fillStyle = PAL.cyan;
      ctx.beginPath(); ctx.arc(p.x, p.y, b.radius * (0.25 + k * 0.72), 0, TAU); ctx.fill();
    }
    ctx.restore();

    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    var ang = Math.atan2(b.vy, b.vx);
    var k2 = clamp(sp / 2400 + fx.ballSquash * 0.45, 0, 0.40);

    ctx.save();
    ctx.translate(b.x, b.y + this.idleBob(sim).b);

    /* respawn beacon so the recovery is never a surprise */
    if (fx.respawn > 0.01) {
      var rr2 = 14 + (1 - fx.respawn) * 40;
      ctx.save();
      ctx.globalAlpha = fx.respawn * 0.8;
      ctx.strokeStyle = PAL.cyan; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, rr2, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    glow(ctx, 0, 0, b.radius * (3.0 + fx.ballGlow * 2.6), 'rgba(120,240,255,0.55)', 0.55 + fx.ballGlow * 0.45);

    ctx.save();
    ctx.rotate(ang);
    ctx.scale(1 + k2, 1 - k2);
    ctx.rotate(-ang);

    var g = ctx.createRadialGradient(-b.radius * 0.32, -b.radius * 0.38, b.radius * 0.12, 0, 0, b.radius);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, PAL.cyan);
    g.addColorStop(1, '#2f9fc4');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(20,60,80,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();

    /* face — eyes lead the direction of travel */
    var fxx = clamp(b.vx / 190, -1, 1) * 2.2;
    var fyy = clamp(b.vy / 700, -1, 1) * 2.0;
    ctx.fillStyle = '#123244';
    var sqz = fx.ballSquash > 0.3 ? 0.42 : 1;
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      ctx.beginPath();
      ctx.ellipse(s2 * 3 + fxx, -1.4 + fyy, 1.5, 2.1 * sqz, 0, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#123244'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath();
    if (fx.ballSquash > 0.3) ctx.arc(fxx, 2.2 + fyy, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    else ctx.arc(fxx, 1.6 + fyy, 2.2, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(-b.radius * 0.36, -b.radius * 0.44, b.radius * 0.22, 0, TAU); ctx.fill();
    ctx.restore();

    /* power sparkle */
    if (fx.ballGlow > 0.25) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fx.ballGlow;
      ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (var q = 0; q < 4; q++) {
        var a2 = this.t * 5 + q * Math.PI / 2;
        var r3 = b.radius + 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a2) * r3, Math.sin(a2) * r3);
        ctx.lineTo(Math.cos(a2) * (r3 + 5), Math.sin(a2) * (r3 + 5));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  /* ================================================ airborne targets ====== */
  View.drawFlyer = function (ctx, e) {
    var fx = this.fx;
    var ef = fx.enemy[e.id] || { flash: 0, wob: 0, shake: 0 };
    var t = this.t;
    var fast = e.type === 'fastFlyer';
    var R = e.visualRadius;
    var dmg = Math.min(e.hitsTaken, 3);
    var dying = !e.active;

    ctx.save();
    ctx.translate(e.x + (Math.random() - 0.5) * ef.shake, e.y + (Math.random() - 0.5) * ef.shake);
    if (dying) {
      var k = clamp(e.deadTimer / 0.8, 0, 1);
      ctx.globalAlpha = k * 0.8;
      ctx.scale(1 + (1 - k) * 0.8, 1 + (1 - k) * 0.8);
      ctx.rotate((1 - k) * 2.4);
    }
    ctx.rotate(Math.sin(t * (3 + dmg * 3.4) + e.id) * (0.03 + dmg * 0.055) + ef.wob * Math.sin(t * 40));
    var shrink = 1 - dmg * 0.07;
    ctx.scale(shrink * (e.dir > 0 ? 1 : -1), shrink);

    var bodyCol = fast ? PAL.fastBody : PAL.slowBody;
    var darkCol = fast ? PAL.fastBodyDark : PAL.slowBodyDark;
    if (dmg >= 1) { bodyCol = fast ? '#e05579' : '#7d5cc6'; }
    if (dmg >= 2) { bodyCol = fast ? '#b8465f' : '#634aa0'; }

    /* speed streaks behind a fast flyer */
    if (fast && !dying) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(255,120,170,0.6)';
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (var sI = 0; sI < 3; sI++) {
        var yy = -6 + sI * 6;
        var len = 12 + Math.abs(Math.sin(t * 12 + sI)) * 9;
        ctx.beginPath(); ctx.moveTo(-R - 4, yy); ctx.lineTo(-R - 4 - len, yy); ctx.stroke();
      }
      ctx.restore();
    }

    /* wings */
    var flap = Math.sin(t * (fast ? 17 : 8) + e.id * 1.7);
    for (var wS = -1; wS <= 1; wS += 2) {
      if (dmg >= 1 && wS === -1) continue;         // damage tears a wing off
      ctx.save();
      ctx.translate(-R * 0.25, -R * 0.15);
      ctx.rotate(wS * (0.5 + flap * 0.42));
      ctx.fillStyle = fast ? 'rgba(255,150,190,0.52)' : 'rgba(190,160,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(-R * 0.35, -R * 0.55, R * 0.44, R * 0.82, 0.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,14,52,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }

    /* body */
    ctx.beginPath();
    if (fast) {
      ctx.moveTo(R * 1.16, 0);
      ctx.quadraticCurveTo(R * 0.5, -R * 0.86, -R * 0.42, -R * 0.72);
      ctx.quadraticCurveTo(-R * 1.05, -R * 0.3, -R * 1.0, 0);
      ctx.quadraticCurveTo(-R * 1.05, R * 0.3, -R * 0.42, R * 0.72);
      ctx.quadraticCurveTo(R * 0.5, R * 0.86, R * 1.16, 0);
    } else {
      ctx.ellipse(0, 0, R * 1.0, R * 0.84, 0, 0, TAU);
    }
    ctx.closePath();
    var bg = ctx.createLinearGradient(0, -R, 0, R);
    bg.addColorStop(0, bodyCol);
    bg.addColorStop(1, darkCol);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = '#1c0f33'; ctx.lineWidth = 2.2; ctx.stroke();

    /* UNDERSIDE — red teeth, the thing that bites */
    ctx.save();
    ctx.fillStyle = dmg >= 2 ? '#c22a44' : PAL.red;
    ctx.strokeStyle = '#1c0f33'; ctx.lineWidth = 1.3;
    for (var sp = -2; sp <= 2; sp++) {
      var a = Math.PI * 0.5 + sp * 0.30;
      var bx = Math.cos(a) * R * 0.86, by = Math.sin(a) * R * 0.74;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a - Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-3.4, 0); ctx.lineTo(0, 8.4); ctx.lineTo(3.4, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    /* TOP PLATE — the strike surface, the brightest band on the target */
    var plateCol = dmg === 0 ? '#e6ffff' : dmg === 1 ? '#ffe08a' : '#ff9c5e';
    var plateRgb = dmg === 0 ? '230,255,255' : dmg === 1 ? '255,224,138' : '255,156,94';
    ctx.save();
    glow(ctx, 0, -R * 0.55, R * 1.5, 'rgba(' + plateRgb + ',0.45)', 0.55 + ef.flash * 0.45);
    ctx.strokeStyle = plateCol;
    ctx.lineWidth = 5.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.9, R * 0.76, 0, Math.PI * 1.20, Math.PI * 1.80);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(28,15,51,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    /* strike chevron */
    ctx.strokeStyle = 'rgba(30,20,60,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.6, -R * 0.78); ctx.lineTo(0, -R * 0.60); ctx.lineTo(4.6, -R * 0.78);
    ctx.stroke();
    ctx.restore();

    /* damage: cracks, dents, sparks */
    if (dmg >= 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(20,8,36,0.85)';
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-R * 0.55, -R * 0.15); ctx.lineTo(-R * 0.18, R * 0.12);
      ctx.lineTo(-R * 0.32, R * 0.34); ctx.lineTo(R * 0.05, R * 0.44);
      ctx.stroke();
      ctx.restore();
    }
    if (dmg >= 2) {
      ctx.save();
      ctx.fillStyle = '#150a2c';
      ctx.beginPath();
      ctx.moveTo(R * 0.30, -R * 0.42); ctx.lineTo(R * 0.74, -R * 0.18);
      ctx.lineTo(R * 0.46, R * 0.18); ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 26 + e.id));
      ctx.fillStyle = '#fff0b0';
      ctx.beginPath(); ctx.arc(R * 0.5, -R * 0.2, 2.2, 0, TAU); ctx.fill();
      ctx.restore();
    }

    /* eyes */
    var eyeY = -R * 0.06, eyeX = R * 0.34;
    ctx.save();
    ctx.fillStyle = '#fff';
    if (dmg >= 2) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeX - 2.6, eyeY - 2.6); ctx.lineTo(eyeX + 2.6, eyeY + 2.6);
      ctx.moveTo(eyeX + 2.6, eyeY - 2.6); ctx.lineTo(eyeX - 2.6, eyeY + 2.6);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(eyeX, eyeY, 3.4, dmg >= 1 ? 2.0 : 3.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1b0f30';
      ctx.beginPath(); ctx.arc(eyeX + 1.1, eyeY + 0.3, 1.5, 0, TAU); ctx.fill();
      /* angry brow */
      ctx.strokeStyle = '#1b0f30'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(eyeX - 4, eyeY - 5.4); ctx.lineTo(eyeX + 4, eyeY - 3.4);
      ctx.stroke();
    }
    ctx.restore();

    /* white-hot strike flash */
    if (ef.flash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ef.flash * 0.85;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.04, R * 0.9, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* three damage pips, upright above the target */
    if (!dying) {
      ctx.save();
      ctx.translate(e.x, e.y - R - 9);
      for (var pI = 0; pI < 3; pI++) {
        var px = (pI - 1) * 8;
        var done = pI < dmg;
        ctx.beginPath();
        ctx.moveTo(px, -3.4); ctx.lineTo(px + 3.2, 0); ctx.lineTo(px, 3.4); ctx.lineTo(px - 3.2, 0);
        ctx.closePath();
        if (done) {
          ctx.fillStyle = 'rgba(255,255,255,0.13)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.stroke();
        } else {
          ctx.fillStyle = fast ? PAL.rose : PAL.cyan;
          ctx.fill();
        }
      }
      ctx.restore();
    }
  };

  /* ---------------------------------------------------------- ground walker */
  View.drawWalker = function (ctx, e) {
    var t = this.t;
    var R = e.visualRadius;
    var dying = !e.active;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (dying) {
      var k = clamp(e.deadTimer / 0.6, 0, 1);
      ctx.globalAlpha = k;
      ctx.scale(1 + (1 - k) * 0.5, Math.max(0.12, k));
    }
    ctx.scale(e.dir > 0 ? 1 : -1, 1);

    /* legs */
    ctx.strokeStyle = '#5a2a0c'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (var l = -1; l <= 1; l++) {
      var ph = t * 13 + l * 2.1;
      ctx.beginPath();
      ctx.moveTo(l * 7, R * 0.5);
      ctx.lineTo(l * 7 + Math.sin(ph) * 4, R * 1.05);
      ctx.stroke();
    }

    /* body */
    ctx.beginPath();
    rr(ctx, -R, -R * 0.72, R * 2, R * 1.4, 6);
    var g = ctx.createLinearGradient(0, -R * 0.8, 0, R * 0.7);
    g.addColorStop(0, PAL.walker);
    g.addColorStop(1, PAL.walkerDark);
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#3d1a06'; ctx.lineWidth = 2; ctx.stroke();

    /* soft stompable cap */
    ctx.fillStyle = 'rgba(255,226,170,0.85)';
    rr(ctx, -R * 0.7, -R * 0.84, R * 1.4, 4.4, 2.2); ctx.fill();
    ctx.strokeStyle = '#3d1a06'; ctx.lineWidth = 1.2; ctx.stroke();

    /* face */
    ctx.fillStyle = '#2b1105';
    ctx.beginPath(); ctx.arc(R * 0.36, -R * 0.1, 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b1105'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(R * 0.12, -R * 0.46); ctx.lineTo(R * 0.62, -R * 0.24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(R * 0.12, R * 0.42); ctx.lineTo(R * 0.62, R * 0.42);
    ctx.stroke();
    ctx.restore();
  };

  /* ------------------------------------------------------------ particles - */
  View.drawParticles = function (ctx) {
    var fx = this.fx, i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < fx.rings.length; i++) {
      var R2 = fx.rings[i];
      var k = 1 - R2.life / R2.max;
      var rad = lerp(R2.r0, R2.r1, 1 - Math.pow(1 - k, 2.2));
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = R2.col;
      ctx.lineWidth = R2.w * (1 - k * 0.7);
      ctx.beginPath(); ctx.arc(R2.x, R2.y, rad, 0, TAU); ctx.stroke();
    }
    for (i = 0; i < fx.parts.length; i++) {
      var p = fx.parts[i];
      var a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      if (p.kind === 'chunk') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillRect(-p.r, -p.r * 0.7, p.r * 2, p.r * 1.4);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.35 + a * 0.75), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  View.drawTexts = function (ctx) {
    var fx = this.fx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < fx.texts.length; i++) {
      var T = fx.texts[i];
      var a = clamp(T.life / T.max, 0, 1);
      var pop = 1 + (1 - a) * 0.16;
      setFont(ctx, '800', T.size * pop, 0.5);
      ctx.globalAlpha = Math.min(1, a * 1.7);
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(8,4,22,0.85)';
      ctx.strokeText(T.s, T.x, T.y);
      ctx.fillStyle = T.col;
      ctx.fillText(T.s, T.x, T.y);
    }
    ctx.restore();
  };

  /* ------------------------------------------- last seconds tighten up ---- */
  View.drawTension = function (ctx, sim) {
    if (sim.phase !== 'playing') return;
    var left = sim.remainingMs;
    if (left > 10000) return;
    var k = 1 - left / 10000;
    var beat = 0.5 + 0.5 * Math.sin(this.t * (5 + k * 7));
    var a = (0.10 + k * 0.30) * (0.55 + beat * 0.45);
    var g = ctx.createRadialGradient(W / 2, H * 0.52, W * 0.22, W / 2, H * 0.52, W * 0.92);
    g.addColorStop(0, 'rgba(255,40,80,0)');
    g.addColorStop(1, 'rgba(255,30,70,' + a.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };

  /* ================================================================ HUD === */
  View.drawHud = function (ctx, sim) {
    var fx = this.fx;
    var left = sim.remainingMs;
    var frac = clamp(left / C.MAX_MS, 0, 1);
    var danger = left <= 10000;
    var beat = 0.5 + 0.5 * Math.sin(this.t * 8);

    /* top scrim keeps the HUD legible over any sky */
    var scr = ctx.createLinearGradient(0, 0, 0, 78);
    scr.addColorStop(0, 'rgba(4,3,16,0.80)');
    scr.addColorStop(1, 'rgba(4,3,16,0)');
    ctx.fillStyle = scr;
    ctx.fillRect(0, 0, W, 78);

    /* clock bar */
    var bx = 14, by = 15, bw = 218, bh = 15;
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    rr(ctx, bx, by, bw, bh, 7.5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1; ctx.stroke();

    var fillW = Math.max(0, bw * frac);
    if (fillW > 2) {
      ctx.save();
      rr(ctx, bx, by, bw, bh, 7.5); ctx.clip();
      var cg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      if (danger) {
        cg.addColorStop(0, '#ff2f5e');
        cg.addColorStop(1, beat > 0.5 ? '#ffb0c0' : '#ff6b86');
      } else {
        cg.addColorStop(0, PAL.teal);
        cg.addColorStop(0.6, PAL.cyan);
        cg.addColorStop(1, '#e9ffff');
      }
      ctx.fillStyle = cg;
      ctx.fillRect(bx, by, fillW, bh);
      /* moving sheen */
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#fff';
      var shx = bx + ((this.t * 60) % (bw + 60)) - 30;
      ctx.fillRect(shx, by, 14, bh);
      ctx.restore();
      glow(ctx, bx + fillW, by + bh / 2, 16, danger ? 'rgba(255,60,100,0.7)' : 'rgba(140,250,255,0.65)', 0.7);
    }
    /* the start-clock notch: how much a run began with */
    var notch = bx + bw * (C.START_MS / C.MAX_MS);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(notch, by - 2, 1.2, bh + 4);

    /* numeric clock */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    var secs = (Math.ceil(left / 100) / 10).toFixed(1);
    var pop = danger ? 1 + beat * 0.10 : 1;
    setFont(ctx, '800', 25 * pop, 0);
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(6,3,18,0.9)';
    ctx.strokeText(secs, 242, by + bh / 2 + 1);
    ctx.fillStyle = danger ? (beat > 0.5 ? '#ffffff' : '#ff5f7f') : '#ffffff';
    ctx.fillText(secs, 242, by + bh / 2 + 1);
    var numW = ctx.measureText(secs).width;      // measured in the size it was drawn
    setFont(ctx, '700', 9, 1);
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    ctx.fillText('s', 244 + numW, by + bh / 2 + 7);
    ctx.restore();

    /* score */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setFont(ctx, '700', 8, 2.4);
    ctx.fillStyle = 'rgba(200,220,255,0.45)';
    ctx.fillText('SCORE', 15, 46);
    setFont(ctx, '800', 20, 0.6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(sim.score), 15, 64);
    ctx.restore();

    /* targets down */
    ctx.save();
    ctx.textAlign = 'center';
    setFont(ctx, '700', 8, 2);
    ctx.fillStyle = 'rgba(200,220,255,0.45)';
    ctx.fillText('DOWN', 150, 46);
    setFont(ctx, '800', 18, 0.6);
    ctx.fillStyle = PAL.cyan;
    ctx.fillText(String(sim.airEnemiesDefeated), 150, 64);
    ctx.restore();

    /* tier pips */
    ctx.save();
    ctx.textAlign = 'right';
    setFont(ctx, '700', 8, 2);
    ctx.fillStyle = 'rgba(200,220,255,0.45)';
    ctx.fillText('TIER', W - 15, 46);
    for (var i = 0; i < 6; i++) {
      var px = W - 15 - (5 - i) * 11;
      var on = i <= sim.difficulty;
      ctx.beginPath();
      ctx.moveTo(px, 54); ctx.lineTo(px + 4, 59); ctx.lineTo(px, 64); ctx.lineTo(px - 4, 59);
      ctx.closePath();
      if (on) {
        ctx.fillStyle = i >= 4 ? PAL.rose : PAL.violet;
        ctx.fill();
        if (i === sim.difficulty && fx.tierBanner > 0) glow(ctx, px, 59, 12, PAL.violet, fx.tierBanner);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();

    /* live pursuit counter */
    if (sim._cleanSequence >= 2 && sim.phase === 'playing') {
      ctx.save();
      ctx.textAlign = 'left';
      setFont(ctx, '800', 11, 1.6);
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(this.t * 7);
      ctx.fillStyle = '#8dffd0';
      ctx.fillText('CLEAN x' + sim._cleanSequence, 15, 80);
      ctx.restore();
    }
  };

  /* ---------------------------------------------------- control bar art --- */
  View.drawBar = function (ctx, sim) {
    var y0 = H, h = this.barH;
    var g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, '#0d0a24');
    g.addColorStop(1, '#050414');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, h);

    /* neon seam between stage and controls */
    ctx.fillStyle = 'rgba(159,252,255,0.30)';
    ctx.fillRect(0, y0, W, 1.4);
    glow(ctx, W / 2, y0 + 1, 150, 'rgba(90,220,255,0.16)', 0.6);

    /* faint hardware grid */
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = '#8fd8ff';
    ctx.lineWidth = 1;
    for (var x = 10; x < W; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, y0 + 6); ctx.lineTo(x, y0 + h - 6); ctx.stroke();
    }
    ctx.restore();

    /* wordmark, quietly, on the lip below the pads */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setFont(ctx, '800', 7, 2.5);
    ctx.fillStyle = 'rgba(159,252,255,0.20)';
    ctx.fillText('STOMP', W / 2, y0 + h - 7.5);
    ctx.restore();
  };

  global.StompView = View;
})(typeof window !== 'undefined' ? window : globalThis);
