/* EMBER — scene composition, HUD and the two screens.
 *
 * The camera window is a fixed 100 x 180 world box, letterboxed to fit whatever
 * frame the player gives us: portrait proportions are kept and centred, never
 * stretched, and the flue simply continues into any spare space so a wide frame
 * reads as a dark interior rather than black bars.
 *
 * Nothing in this file writes to sim state.
 */
(function (E) {
  'use strict';

  var C = E.C, A = E.Art, Fx = E.Fx;
  var css = A.css, mix = A.mix, PAL = A.PAL, psin = E.psin;
  var clamp = E.clamp;

  var DISPLAY = 'Georgia, "Times New Roman", Times, serif';
  var UI = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  var R = {
    canvas: null, ctx: null,
    cw: 0, ch: 0, dpr: 1, s: 1,
    safe: { t: 0, r: 0, b: 0, l: 0 },
    brick: null, brickW: 32,
    stage: { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0 },
    hud: { l: 0, t: 0, r: 0, b: 0 }
  };

  var V = {
    camY: 60, t: 0,
    intro: 1,
    burstT: 0, dim: 0, prox: 0, alt: 0,
    pip: [0, 0, 0, 0, 0, 0, 0, 0],
    chainPop: 0,
    scoreShown: 0, goT: 0,
    hintAir: 0, airIdle: 0,
    aim: { down: false, ox: 0, oy: 0, len: 0, dirX: 0, dirY: 1, power: 0, power2: 0, valid: false },
    muteRect: [0, 0, 0, 0],
    started: false
  };

  var shx = 0, shy = 0;

  /* ================================================================ setup */

  function makeBrick() {
    var px = 128;
    var cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    var c = cv.getContext('2d');
    c.fillStyle = css(mix(PAL.stoneDark, PAL.ink, 0.45), 1);
    c.fillRect(0, 0, px, px);
    var rows = 4, bw = px / 3, bh = px / rows;
    for (var r = 0; r < rows; r++) {
      var off = (r % 2) ? -bw / 2 : 0;
      for (var i = -1; i < 4; i++) {
        var x = off + i * bw, y = r * bh;
        var h = E.hashf(r * 31 + i * 7 + 3);
        c.fillStyle = css(mix(mix(PAL.stoneDark, PAL.ink, 0.2), PAL.stone, 0.12 + h * 0.5), 1);
        c.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        c.fillStyle = 'rgba(255,235,220,0.045)';
        c.fillRect(x + 1.5, y + 1.5, bw - 3, 2);
        c.fillStyle = 'rgba(0,0,0,0.32)';
        c.fillRect(x + 1.5, y + bh - 5, bw - 3, 3.5);
        for (var k = 0; k < 5; k++) {
          var h2 = E.hashf(r * 811 + i * 97 + k * 13);
          var h3 = E.hashf(r * 337 + i * 61 + k * 29);
          c.fillStyle = 'rgba(0,0,0,' + (0.10 + h3 * 0.16).toFixed(3) + ')';
          c.beginPath();
          c.arc(x + 3 + h2 * (bw - 6), y + 3 + h3 * (bh - 6), 1 + h2 * 3.2, 0, 6.2832);
          c.fill();
        }
      }
    }
    R.brick = cv;
  }

  function init(canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d', { alpha: false });
    makeBrick();
  }

  function resize(cw, ch, dpr, safe) {
    R.cw = cw; R.ch = ch; R.dpr = dpr; R.safe = safe;
    R.canvas.width = Math.max(1, Math.round(cw * dpr));
    R.canvas.height = Math.max(1, Math.round(ch * dpr));
    var s = Math.min(cw / C.WORLD_W, ch / C.VIEW_H);
    R.s = s;
    R.stage.w = C.WORLD_W * s; R.stage.h = C.VIEW_H * s;
    R.stage.l = cw / 2 - R.stage.w / 2;
    R.stage.t = ch / 2 - R.stage.h / 2;
    R.stage.r = R.stage.l + R.stage.w;
    R.stage.b = R.stage.t + R.stage.h;
    // The HUD hugs the stage box horizontally so it frames the flue, but it
    // never drifts far from the frame edge vertically on a very tall screen.
    var pad = 2.6 * s;
    R.hud.l = Math.max(R.stage.l, 0) + safe.l + pad;
    R.hud.r = Math.min(R.stage.r, cw) - safe.r - pad;
    R.hud.t = Math.max(safe.t, Math.min(Math.max(R.stage.t, 0), ch * 0.05)) + pad;
    R.hud.b = Math.min(ch - safe.b, Math.max(R.stage.b, ch * 0.95)) - pad;
  }

  /* ----------------------------------------------------------- transforms */

  function world(camYp) {
    var k = R.s * R.dpr;
    R.ctx.setTransform(k, 0, 0, -k,
      R.dpr * R.cw / 2 - 50 * k + shx,
      R.dpr * R.ch / 2 + camYp * k + shy);
  }
  function screen() { R.ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); }
  function toScreenX(wx) { return R.cw / 2 + (wx - 50) * R.s + shx / R.dpr; }
  function toScreenY(wy) { return R.ch / 2 - (wy - V.camY) * R.s + shy / R.dpr; }
  function centreX() { return (Math.max(R.stage.l, 0) + Math.min(R.stage.r, R.cw)) / 2; }

  function viewBounds() {
    var hw = (R.cw / 2) / R.s, hh = (R.ch / 2) / R.s;
    return { x0: 50 - hw, x1: 50 + hw, y0: V.camY - hh, y1: V.camY + hh, hh: hh };
  }

  /* ============================================================ backdrop */

  function tile(ctx, img, x0, x1, y0, y1, w, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    var i0 = Math.floor(x0 / w), i1 = Math.ceil(x1 / w);
    var j0 = Math.floor(y0 / w), j1 = Math.ceil(y1 / w);
    for (var i = i0; i <= i1; i++) {
      for (var j = j0; j <= j1; j++) {
        ctx.drawImage(img, i * w, (j + 1) * w, w, w);
      }
    }
    ctx.restore();
  }

  // everything that belongs inside the shaft is clipped to it, so a wide frame
  // shows the outside of the chimney instead of a stretched playfield
  function clipInterior(ctx) {
    ctx.beginPath();
    ctx.rect(C.WALL_L, -100000, C.WALL_R - C.WALL_L, 200000);
    ctx.clip();
  }

  function drawBackdrop(ctx, b) {
    var alt = V.alt;
    screen();
    var g = ctx.createLinearGradient(0, 0, 0, R.ch);
    g.addColorStop(0, css(mix([21, 13, 27], [28, 25, 60], alt), 1));
    g.addColorStop(0.45, css(mix([15, 9, 19], [17, 14, 34], alt), 1));
    g.addColorStop(1, css([7, 5, 11], 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, R.cw, R.ch);

    var mg = ctx.createRadialGradient(R.cw * 0.5, -R.ch * 0.2, 0, R.cw * 0.5, -R.ch * 0.2, R.ch);
    mg.addColorStop(0, 'rgba(150,172,255,' + (0.045 + 0.15 * alt).toFixed(3) + ')');
    mg.addColorStop(1, 'rgba(150,172,255,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, R.cw, R.ch);

    var hearth = clamp(1 - V.camY / 430, 0, 1);
    if (hearth > 0.01) {
      var hy = toScreenY(-14);
      var hg = ctx.createRadialGradient(R.cw / 2, hy, 0, R.cw / 2, hy, R.stage.w);
      hg.addColorStop(0, 'rgba(255,132,46,' + (0.24 * hearth).toFixed(3) + ')');
      hg.addColorStop(0.45, 'rgba(255,96,40,' + (0.08 * hearth).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(255,96,40,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, R.cw, R.ch);
    }

    // far interior, receding upward
    var pf = 0.16;
    world(V.camY * pf);
    ctx.save();
    clipInterior(ctx);
    var period = 150;
    var base = Math.floor((V.camY * pf - 180) / period) * period;
    for (var i = 0; i < 7; i++) {
      var yy = base + i * period;
      var h = E.hashf(Math.round(yy) * 3 + 11);
      ctx.fillStyle = css(mix([26, 16, 32], [32, 29, 56], alt), 0.42);
      ctx.beginPath();
      ctx.ellipse(50 + (h - 0.5) * 24, yy, 44 + h * 22, 24 + h * 15, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    // parallaxed brick: the far side of the shaft
    var pb = 0.42;
    var bb = viewBounds();
    world(V.camY * pb);
    ctx.save();
    clipInterior(ctx);
    tile(ctx, R.brick, C.WALL_L - 4, C.WALL_R + 4,
      V.camY * pb - bb.hh - 4, V.camY * pb + bb.hh + 4, R.brickW, 0.34);
    ctx.restore();

    // depth: the middle of the shaft is further away, so it is darker
    world(V.camY);
    ctx.save();
    clipInterior(ctx);
    var dg = ctx.createLinearGradient(C.WALL_L, 0, C.WALL_R, 0);
    dg.addColorStop(0, 'rgba(4,3,8,0)');
    dg.addColorStop(0.5, 'rgba(4,3,8,0.42)');
    dg.addColorStop(1, 'rgba(4,3,8,0)');
    ctx.fillStyle = dg;
    ctx.fillRect(C.WALL_L, b.y0 - 10, C.WALL_R - C.WALL_L, (b.y1 - b.y0) + 20);
    ctx.restore();

    // hanging soot strands
    var ps = 0.72;
    world(V.camY * ps);
    ctx.save();
    clipInterior(ctx);
    ctx.strokeStyle = 'rgba(8,5,12,0.85)';
    ctx.lineCap = 'round';
    for (var s2 = 0; s2 < 10; s2++) {
      var hs = E.hashf(s2 * 977 + 3);
      var hy2 = (V.camY * ps - bb.hh) + ((hs * 617 + s2 * 41) % (bb.hh * 2));
      var hx = 8 + hs * 84;
      var ln = 9 + hs * 16;
      ctx.lineWidth = 0.2 + hs * 0.4;
      ctx.beginPath();
      ctx.moveTo(hx, hy2 + ln);
      ctx.quadraticCurveTo(hx + psin(V.t * 0.09 + hs) * 1.1, hy2 + ln * 0.45,
        hx + psin(V.t * 0.07 + hs) * 1.8, hy2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAsh(ctx, factor, n, big) {
    world(V.camY * factor);
    ctx.save();
    clipInterior(ctx);
    ctx.globalCompositeOperation = 'lighter';
    var span = 250;
    for (var i = 0; i < n; i++) {
      var h1 = E.hashf(i * 313 + (big ? 7777 : 1));
      var h2 = E.hashf(i * 691 + (big ? 131 : 5));
      var sp = 3 + h2 * 12;
      var yy = V.camY * factor - span * 0.5 + ((h1 * span + V.t * sp) % span);
      var xx = 2 + h1 * 96 + psin(V.t * (0.05 + h2 * 0.12) + h1 * 6.28) * (2 + h2 * 5);
      var sz = big ? (1.4 + h2 * 3) : (0.18 + h2 * 0.5);
      var a = big ? 0.045 : 0.12 + 0.2 * h2;
      A.glow(ctx, xx, yy, sz * (big ? 3 : 2.4), big ? [130, 118, 150] : PAL.ember, a);
    }
    ctx.restore();
  }

  /* =============================================================== walls */

  function drawWalls(ctx, b) {
    world(V.camY);
    var y0 = b.y0 - 8, y1 = b.y1 + 8;

    ctx.fillStyle = css([9, 6, 13], 1);
    ctx.fillRect(b.x0 - 8, y0, C.WALL_L - b.x0 + 8, y1 - y0);
    ctx.fillRect(C.WALL_R, y0, b.x1 - C.WALL_R + 8, y1 - y0);

    for (var side = 0; side < 2; side++) {
      var inner = side === 0 ? C.WALL_L : C.WALL_R;
      var dir = side === 0 ? -1 : 1;
      var outer = side === 0 ? b.x0 - 8 : b.x1 + 8;
      var lo = Math.min(inner, outer), wdt = Math.abs(outer - inner);

      ctx.save();
      ctx.beginPath();
      ctx.rect(lo, y0, wdt, y1 - y0);
      ctx.clip();
      tile(ctx, R.brick, lo - 4, lo + wdt + 4, y0 - 4, y1 + 4, R.brickW, 0.95);

      for (var i = 0; i < 14; i++) {
        var band = Math.floor(y0 / 55) + i;
        var h = E.hashf(band * 733 + side * 17);
        var h2 = E.hashf(band * 199 + side * 91);
        var sy = band * 55 + h * 55;
        var sx = inner + dir * (0.5 + h2 * 4.2);
        var g = ctx.createLinearGradient(sx, sy, sx, sy + 36 + h * 48);
        g.addColorStop(0, 'rgba(6,4,9,0)');
        g.addColorStop(0.35, 'rgba(6,4,9,' + (0.32 + h2 * 0.35).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(6,4,9,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 1.6 - h * 1.4, sy, 3.2 + h * 2.8, 36 + h * 48);
      }

      for (var j = 0; j < 4; j++) {
        var bd = Math.floor(y0 / 130) + j;
        var hh = E.hashf(bd * 4441 + side * 7);
        if (hh < 0.48) { continue; }
        var cyy = bd * 130 + hh * 120;
        var cxx = inner + dir * (1.1 + hh * 2.4);
        var col = mix(PAL.emberDeep, [168, 168, 236], clamp(cyy / 2600, 0, 0.8));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        A.glow(ctx, cxx, cyy, 7 + hh * 5, col, 0.15);
        ctx.strokeStyle = css(col, 0.45);
        ctx.lineWidth = 0.28;
        ctx.beginPath();
        ctx.moveTo(cxx - dir * 1.2, cyy - 8 - hh * 6);
        ctx.lineTo(cxx + dir * 0.6, cyy - 2);
        ctx.lineTo(cxx - dir * 0.8, cyy + 3);
        ctx.lineTo(cxx + dir * 1.4, cyy + 9 + hh * 7);
        ctx.stroke();
        ctx.restore();
      }
      // beyond the wall face there is only cold stone: fade the detail out so
      // spare space in a wide frame never competes with the flue
      var fg = ctx.createLinearGradient(inner, 0, inner + dir * 20, 0);
      fg.addColorStop(0, 'rgba(5,4,8,0)');
      fg.addColorStop(0.45, 'rgba(5,4,8,0.65)');
      fg.addColorStop(1, 'rgba(5,4,8,0.98)');
      ctx.fillStyle = fg;
      ctx.fillRect(lo, y0, wdt, y1 - y0);
      ctx.restore();

      var lit = mix(PAL.emberDeep, [168, 168, 236], clamp(V.camY / 2600, 0, 0.8));
      var rg = ctx.createLinearGradient(inner, 0, inner + dir * 5.5, 0);
      rg.addColorStop(0, css(lit, 0.32));
      rg.addColorStop(0.35, css(lit, 0.09));
      rg.addColorStop(1, css(lit, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(Math.min(inner, inner + dir * 5.5), y0, 5.5, y1 - y0);

      var sg = ctx.createLinearGradient(inner, 0, inner + dir * 2.2, 0);
      sg.addColorStop(0, 'rgba(196,210,232,0.11)');
      sg.addColorStop(1, 'rgba(196,210,232,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(Math.min(inner, inner + dir * 2.2), y0, 2.2, y1 - y0);

      ctx.strokeStyle = css(lit, 0.5);
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.moveTo(inner, y0); ctx.lineTo(inner, y1);
      ctx.stroke();
    }

    // the hearth we climbed out of
    if (b.y0 < 10) {
      ctx.save();
      clipInterior(ctx);
      var fl = 2.5;
      var g2 = ctx.createLinearGradient(0, fl, 0, b.y0 - 8);
      g2.addColorStop(0, 'rgba(36,17,14,1)');
      g2.addColorStop(0.35, 'rgba(18,9,11,1)');
      g2.addColorStop(1, 'rgba(8,5,9,1)');
      ctx.fillStyle = g2;
      ctx.fillRect(C.WALL_L, b.y0 - 8, C.WALL_R - C.WALL_L, fl - b.y0 + 8);

      // rubble line, so the floor is not a flat edge
      ctx.fillStyle = 'rgba(28,16,20,1)';
      ctx.beginPath();
      ctx.moveTo(C.WALL_L, fl - 3);
      for (var rx = C.WALL_L; rx <= C.WALL_R + 2; rx += 4) {
        var hr = E.hashf(Math.round(rx) * 91);
        ctx.lineTo(rx, fl - 1.2 + hr * 2.4);
        ctx.lineTo(rx + 2, fl - 2.2 + E.hashf(Math.round(rx) * 37) * 2.2);
      }
      ctx.lineTo(C.WALL_R, fl - 4);
      ctx.closePath();
      ctx.fill();

      ctx.globalCompositeOperation = 'lighter';
      A.glow(ctx, 50, fl - 1, 34, PAL.emberDeep, 0.16);
      for (var ce = 0; ce < 9; ce++) {
        var hc = E.hashf(ce * 613);
        var f2 = ((V.t * (0.2 + hc * 0.3) + hc) % 1);
        A.glow(ctx, C.WALL_L + 4 + hc * 80, fl - 1 + f2 * 5,
          1.2 + hc * 1.6, PAL.ember, 0.35 * (1 - f2));
      }
      ctx.restore();
    }
  }

  /* ================================================================ damp */

  function drawDamp(ctx, S, b) {
    var dampY = S.dampY;
    if (dampY < b.y0 - 26) { return; }
    world(V.camY);
    var t = V.t;
    var x0 = b.x0 - 10, x1 = b.x1 + 10;
    var breathe = 0.62 + 0.38 * psin(t * 0.13);
    var prox = V.prox;

    // Tongues of vapour that rise, reach and sink back. Narrow and tall so the
    // front reads as something groping upward, never as a wave.
    var fingers = [];
    for (var f = 0; f < 9; f++) {
      var hf = E.hashf(f * 8171 + 3);
      var fx = x0 + ((hf * (x1 - x0) + t * (1.5 + hf * 3)) % (x1 - x0));
      var cyc = (t * (0.11 + hf * 0.15) + hf) % 1;
      var reach = Math.abs(psin(cyc));
      var amp = (4 + hf * 12) * (0.15 + 0.85 * reach * reach) * (0.65 + 0.85 * prox) * breathe;
      fingers.push([fx, amp, 1.6 + hf * 2.4]);
    }

    function surf(x, k) {
      var y = dampY
        + 1.6 * psin(t * 0.19 + x * 0.0125)
        + 1.1 * psin(t * 0.31 - x * 0.031)
        + 0.6 * psin(t * 0.63 + x * 0.071);
      for (var i = 0; i < fingers.length; i++) {
        var d = (x - fingers[i][0]) / fingers[i][2];
        if (d > -3.2 && d < 3.2) { y += fingers[i][1] * (k || 1) * Math.exp(-d * d); }
      }
      return y;
    }

    var N = 72, step = (x1 - x0) / N, i2, xx;

    function frontPath(k, lift) {
      ctx.beginPath();
      ctx.moveTo(x0, b.y0 - 60);
      ctx.lineTo(x0, surf(x0, k) + lift);
      for (i2 = 1; i2 <= N; i2++) {
        xx = x0 + i2 * step;
        ctx.lineTo(xx, surf(xx, k) + lift);
      }
      ctx.lineTo(x1, b.y0 - 60);
      ctx.closePath();
    }

    // haze: three translucent skins above the body, each reaching a little
    // further, so the boundary is vapour instead of a shoreline
    ctx.save();
    for (var h2 = 3; h2 >= 1; h2--) {
      frontPath(1 + h2 * 0.55, h2 * 2.6);
      ctx.fillStyle = 'rgba(46,150,158,' + (0.055 + 0.03 * prox).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();

    frontPath(1, 0);
    var g = ctx.createLinearGradient(0, dampY + 18, 0, dampY - 100);
    g.addColorStop(0, 'rgba(96,206,198,0.34)');
    g.addColorStop(0.13, 'rgba(52,158,164,0.72)');
    g.addColorStop(0.2, 'rgba(20,92,108,0.93)');
    g.addColorStop(0.32, 'rgba(9,52,68,0.98)');
    g.addColorStop(0.6, 'rgba(4,26,38,0.99)');
    g.addColorStop(1, 'rgba(2,11,17,1)');
    ctx.fillStyle = g;
    ctx.fill();

    // curdled texture inside the body: slow blobs turning over each other
    ctx.save();
    frontPath(1, 0);
    ctx.clip();
    for (var c2 = 0; c2 < 14; c2++) {
      var hc2 = E.hashf(c2 * 3313 + 11);
      var cy2 = (t * (0.05 + hc2 * 0.07) + hc2) % 1;
      var bx = x0 + hc2 * (x1 - x0) + psin(t * 0.07 + hc2 * 6.28) * 9;
      var by = dampY - 4 - cy2 * 46;
      var br = 5 + hc2 * 13;
      ctx.fillStyle = hc2 > 0.5
        ? 'rgba(74,176,178,' + (0.05 * (1 - cy2)).toFixed(3) + ')'
        : 'rgba(2,20,28,' + (0.16 * (1 - cy2)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.55, hc2, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // cold rim on the front, brighter where a tongue is reaching
    ctx.strokeStyle = css(PAL.dampLit, 0.34 + 0.26 * prox);
    ctx.lineWidth = 0.5;
    ctx.shadowColor = css(PAL.dampLit, 0.5);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x0, surf(x0));
    for (i2 = 1; i2 <= N; i2++) {
      xx = x0 + i2 * step;
      ctx.lineTo(xx, surf(xx));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // wisps torn off the tongues, drifting up into the flue and thinning out
    for (var m = 0; m < 20; m++) {
      var hm = E.hashf(m * 5171 + 7);
      var cyc2 = (t * (0.12 + hm * 0.22) + hm) % 1;
      var mx = x0 + hm * (x1 - x0) + psin(t * 0.2 + hm * 6.28) * 5;
      var my = surf(mx) + cyc2 * (14 + 22 * prox);
      A.glow(ctx, mx, my, 2 + hm * 4 + cyc2 * 7, PAL.dampLit,
        0.075 * (1 - cyc2) * (0.5 + prox));
    }

    // the walls go wet and cold where the damp has reached them
    var wg = ctx.createLinearGradient(0, dampY + 26, 0, dampY - 10);
    wg.addColorStop(0, css(PAL.dampLit, 0));
    wg.addColorStop(1, css(PAL.dampLit, 0.1 + 0.08 * prox));
    ctx.fillStyle = wg;
    ctx.fillRect(x0, dampY - 10, 6, 36);
    ctx.fillRect(x1 - 6, dampY - 10, 6, 36);
    ctx.restore();
  }

  /* ================================================================= aim */

  function drawAim(ctx, S, rx, ry) {
    var a = V.aim;
    if (!a.down) { return; }
    var dead = C.DEAD_ZONE * R.s;
    var empty = S.jumpsLeft <= 0;
    var col = empty ? [156, 172, 184] : [255, 190, 96];

    screen();
    ctx.save();
    ctx.strokeStyle = css(col, 0.45);
    ctx.lineWidth = Math.max(1, 0.3 * R.s);
    ctx.setLineDash([0.9 * R.s, 0.9 * R.s]);
    ctx.beginPath();
    ctx.arc(a.ox, a.oy, dead, 0, 6.2832);
    ctx.stroke();
    ctx.setLineDash([]);

    if (a.len > 0.5) {
      var maxPx = C.MAX_PULL * R.s;
      var dl = Math.min(a.len * R.s, maxPx * 1.06);
      var px = a.ox - a.dirX * dl, py = a.oy + a.dirY * dl;
      var nx = -(py - a.oy), ny = (px - a.ox);
      var nl = Math.max(0.001, Math.sqrt(nx * nx + ny * ny));
      nx /= nl; ny /= nl;
      var spread = dead * 0.7;
      ctx.strokeStyle = css(col, 0.8);
      ctx.lineWidth = Math.max(1, (0.5 - 0.16 * a.power) * R.s);
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        ctx.beginPath();
        ctx.moveTo(a.ox + nx * spread * s2, a.oy + ny * spread * s2);
        ctx.quadraticCurveTo(
          (a.ox + px) / 2 + nx * spread * s2 * 0.3, (a.oy + py) / 2 + ny * spread * s2 * 0.3,
          px, py);
        ctx.stroke();
      }
      ctx.fillStyle = css(col, 0.88);
      ctx.beginPath();
      ctx.arc(px, py, dead * 0.34, 0, 6.2832);
      ctx.fill();

      var al = dead + (maxPx - dead) * a.power;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = css(col, 0.5);
      ctx.lineWidth = Math.max(1, 0.42 * R.s);
      ctx.beginPath();
      ctx.moveTo(a.ox, a.oy);
      ctx.lineTo(a.ox + a.dirX * al, a.oy - a.dirY * al);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    var sx = toScreenX(rx), sy = toScreenY(ry);
    ctx.save();
    if (empty) {
      ctx.strokeStyle = css([172, 192, 202], 0.7);
      ctx.lineWidth = Math.max(1, 0.3 * R.s);
      var rr2 = C.PLAYER_R * 2 * R.s;
      ctx.beginPath(); ctx.arc(sx, sy, rr2, 0, 6.2832); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - rr2 * 0.7, sy + rr2 * 0.7);
      ctx.lineTo(sx + rr2 * 0.7, sy - rr2 * 0.7);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (a.valid) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,214,120,0.85)';
      ctx.lineWidth = Math.max(1.5, 0.5 * R.s);
      ctx.beginPath();
      ctx.arc(sx, sy, C.PLAYER_R * 2.2 * R.s, -Math.PI / 2, -Math.PI / 2 + 6.2832 * a.power);
      ctx.stroke();

      var vx = a.dirX * C.LAUNCH_V * a.power2;
      var vy = a.dirY * C.LAUNCH_V * a.power2;
      var x = rx, y = ry, dt = 1 / 45;
      ctx.fillStyle = 'rgba(255,224,156,1)';
      for (var i = 0; i < 24; i++) {
        vy -= C.G * dt;
        vx *= (1 - C.AIR_DRAG * dt);
        x += vx * dt; y += vy * dt;
        var f = 1 - i / 24;
        // the guide tells the truth: soot catches the line at either wall
        var hitL = x - C.PLAYER_R <= C.WALL_L;
        var hitR = x + C.PLAYER_R >= C.WALL_R;
        if (hitL || hitR) {
          x = hitL ? C.WALL_L + C.PLAYER_R : C.WALL_R - C.PLAYER_R;
          ctx.globalAlpha = f * 0.8;
          ctx.beginPath();
          ctx.arc(toScreenX(x), toScreenY(y), 0.9 * R.s, 0, 6.2832);
          ctx.fill();
          break;
        }
        ctx.globalAlpha = f * f * 0.8;
        ctx.beginPath();
        ctx.arc(toScreenX(x), toScreenY(y), (0.4 + 0.4 * f) * R.s * 0.8, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ================================================================= HUD */

  function tracked(ctx, text, x, y, sp, align) {
    var w = 0, i;
    for (i = 0; i < text.length; i++) { w += ctx.measureText(text[i]).width + sp; }
    w -= sp;
    var cx = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
    for (i = 0; i < text.length; i++) {
      ctx.fillText(text[i], cx, y);
      cx += ctx.measureText(text[i]).width + sp;
    }
    return w;
  }
  function trackedWidth(ctx, text, sp) {
    var w = 0;
    for (var i = 0; i < text.length; i++) { w += ctx.measureText(text[i]).width + sp; }
    return w - sp;
  }

  function pipPath(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.35);
    ctx.bezierCurveTo(x + r * 1.05, y - r * 0.25, x + r * 0.62, y + r * 1.15, x, y + r * 1.2);
    ctx.bezierCurveTo(x - r * 0.62, y + r * 1.15, x - r * 1.05, y - r * 0.25, x, y - r * 1.35);
    ctx.closePath();
  }

  function drawHud(ctx, S, rx, ry) {
    screen();
    var u = R.s, t = V.t;
    var cx = centreX();

    // a breath of shade so the readouts never fight the flue behind them
    var top = Math.max(R.stage.t, 0);
    var sg = ctx.createLinearGradient(0, top, 0, top + 22 * u);
    sg.addColorStop(0, 'rgba(7,5,11,0.62)');
    sg.addColorStop(0.55, 'rgba(7,5,11,0.28)');
    sg.addColorStop(1, 'rgba(7,5,11,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, top, R.cw, 22 * u);

    /* glow pips: the stock, countable at a glance */
    var pr = 1.9 * u;
    var px = R.hud.l + pr * 1.3;
    var py = R.hud.t + pr * 1.7;
    for (var i = 0; i < S.jumpCapacity; i++) {
      var full = i < S.jumpsLeft;
      var anim = V.pip[i] || 0;
      var x = px + i * pr * 2.7;
      if (full) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        A.glow(ctx, x, py, pr * (2.4 + anim * 2), PAL.ember, 0.32 + anim * 0.4);
        ctx.restore();
        var g = ctx.createLinearGradient(x, py - pr * 1.4, x, py + pr * 1.3);
        g.addColorStop(0, css(PAL.emberHot, 1));
        g.addColorStop(0.5, css(PAL.ember, 1));
        g.addColorStop(1, css(PAL.emberDeep, 1));
        ctx.fillStyle = g;
        pipPath(ctx, x, py + psin(t * 0.7 + i * 0.3) * pr * 0.08, pr * (1 + anim * 0.5));
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,240,0.85)';
        pipPath(ctx, x, py + pr * 0.3, pr * 0.4);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(196,158,148,0.32)';
        ctx.lineWidth = Math.max(1, 0.22 * u);
        pipPath(ctx, x, py, pr);
        ctx.stroke();
        ctx.fillStyle = 'rgba(120,90,90,0.16)';
        ctx.fill();
      }
    }
    if (S.jumpsLeft === 0 && S.phase === 'playing') {
      var pulse = 0.45 + 0.55 * Math.abs(psin(t * 1.7));
      ctx.font = '600 ' + (2.3 * u).toFixed(1) + 'px ' + UI;
      ctx.fillStyle = 'rgba(255,124,92,' + (0.55 * pulse).toFixed(3) + ')';
      ctx.textBaseline = 'middle';
      tracked(ctx, 'NO GLOW', px - pr * 1.2, py + pr * 3.2, 0.18 * u, 'left');
      ctx.textBaseline = 'alphabetic';
    }

    /* score + height */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.save();
    ctx.font = '600 ' + (7.4 * u).toFixed(1) + 'px ' + DISPLAY;
    ctx.shadowColor = 'rgba(255,150,60,0.5)';
    ctx.shadowBlur = 7;
    ctx.fillStyle = 'rgba(255,240,216,0.97)';
    tracked(ctx, String(S.score), cx, R.hud.t + 6.4 * u, 0.22 * u, 'center');
    ctx.restore();

    ctx.font = '600 ' + (2.5 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(255,202,152,0.62)';
    var hTxt = String(Math.floor(S.height));
    var hw = trackedWidth(ctx, hTxt, 0.2 * u);
    tracked(ctx, hTxt, cx + 1.1 * u, R.hud.t + 10.2 * u, 0.2 * u, 'center');
    ctx.strokeStyle = 'rgba(255,192,124,0.6)';
    ctx.lineWidth = Math.max(1, 0.26 * u);
    var chx = cx - hw / 2 - 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(chx - 0.85 * u, R.hud.t + 9.9 * u);
    ctx.lineTo(chx, R.hud.t + 8.85 * u);
    ctx.lineTo(chx + 0.85 * u, R.hud.t + 9.9 * u);
    ctx.stroke();

    if (S.sessionBest > 0) {
      ctx.font = '500 ' + (2.05 * u).toFixed(1) + 'px ' + UI;
      ctx.fillStyle = 'rgba(212,202,222,0.34)';
      tracked(ctx, 'BEST ' + S.sessionBest, cx, R.hud.t + 13.4 * u, 0.14 * u, 'center');
    }

    /* mute */
    var mr = 2.3 * u;
    var mx = R.hud.r - mr * 1.1, my = R.hud.t + mr * 1.1;
    // a thumb-sized target even on a small phone, whatever the icon's size
    var mhit = Math.max(mr * 4.2, 46);
    V.muteRect = [mx - mhit * 0.5, my - mhit * 0.5, mhit, mhit];
    ctx.strokeStyle = 'rgba(232,214,204,0.32)';
    ctx.fillStyle = 'rgba(232,214,204,0.32)';
    ctx.lineWidth = Math.max(1, 0.2 * u);
    ctx.beginPath();
    ctx.moveTo(mx - mr * 0.8, my - mr * 0.32);
    ctx.lineTo(mx - mr * 0.32, my - mr * 0.32);
    ctx.lineTo(mx + mr * 0.22, my - mr * 0.88);
    ctx.lineTo(mx + mr * 0.22, my + mr * 0.88);
    ctx.lineTo(mx - mr * 0.32, my + mr * 0.32);
    ctx.lineTo(mx - mr * 0.8, my + mr * 0.32);
    ctx.closePath();
    ctx.fill();
    if (E.Audio.isMuted()) {
      ctx.beginPath();
      ctx.moveTo(mx + mr * 0.55, my - mr * 0.5);
      ctx.lineTo(mx + mr * 1.15, my + mr * 0.5);
      ctx.moveTo(mx + mr * 1.15, my - mr * 0.5);
      ctx.lineTo(mx + mr * 0.55, my + mr * 0.5);
      ctx.stroke();
    } else {
      for (var w2 = 0; w2 < 2; w2++) {
        ctx.beginPath();
        ctx.arc(mx + mr * 0.3, my, mr * (0.62 + w2 * 0.44), -0.85, 0.85);
        ctx.stroke();
      }
    }

    /* live chain by the spark */
    if (S.chainCount > 0 && S.phase !== 'gameover') {
      var ccol = Fx.chainCol(S.chainCount);
      var bx = toScreenX(rx), by = toScreenY(ry) - 8 * u;
      var pop = 1 + V.chainPop * 0.9;
      var sz = (3.7 + Math.min(S.chainCount, 12) * 0.44) * u * pop;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.font = '700 ' + sz.toFixed(1) + 'px ' + DISPLAY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = Fx.rgba(ccol, 0.9);
      ctx.shadowBlur = 8 + 16 * V.chainPop;
      ctx.fillStyle = Fx.rgba(ccol, 0.95);
      ctx.fillText('\u00d7' + S.chainCount, bx, by);
      ctx.restore();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    /* the damp closing in */
    var prox = V.prox;
    if (prox > 0.02) {
      var bot = Math.min(R.stage.b, R.ch);
      var hgt = 26 * u * prox;
      var gg = ctx.createLinearGradient(0, bot, 0, bot - hgt);
      gg.addColorStop(0, 'rgba(72,224,214,' + (0.22 * prox).toFixed(3) + ')');
      gg.addColorStop(1, 'rgba(72,224,214,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(0, bot - hgt, R.cw, hgt);
      if (prox > 0.4) {
        var fl = 0.5 + 0.5 * Math.abs(psin(V.t * (1 + prox)));
        ctx.strokeStyle = 'rgba(154,246,236,' + (0.55 * (prox - 0.4) / 0.6 * fl).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, 0.3 * u);
        for (var c2 = -1; c2 <= 1; c2++) {
          var ax = cx + c2 * 7 * u;
          ctx.beginPath();
          ctx.moveTo(ax - 1.7 * u, R.hud.b - 1.1 * u);
          ctx.lineTo(ax, R.hud.b - 2.9 * u);
          ctx.lineTo(ax + 1.7 * u, R.hud.b - 1.1 * u);
          ctx.stroke();
        }
      }
    }
  }

  function drawBanners(ctx) {
    screen();
    var u = R.s, cx = centreX();
    var baseY = Math.max(R.stage.t, 0) + Math.min(R.stage.h, R.ch) * 0.3;
    for (var i = 0; i < Fx.banners.length; i++) {
      var b = Fx.banners[i];
      var k = b.t / b.life;
      var a = k < 0.12 ? k / 0.12 : (k > 0.68 ? 1 - (k - 0.68) / 0.32 : 1);
      var rise = -k * 5 * u;
      var pop = k < 0.16 ? 1 + (1 - k / 0.16) * 0.38 : 1;
      var sz = (4.2 + Math.min(b.level, 10) * 0.58) * u * pop;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + sz.toFixed(1) + 'px ' + DISPLAY;
      ctx.shadowColor = Fx.rgba(b.col, 0.85);
      ctx.shadowBlur = 10 + b.level * 1.6;
      ctx.fillStyle = Fx.rgba(b.col, a);
      tracked(ctx, b.text, cx, baseY + rise - i * 5.6 * u, 0.3 * u, 'center');
      if (b.sub) {
        ctx.font = '600 ' + (2.35 * u).toFixed(1) + 'px ' + UI;
        ctx.shadowBlur = 5;
        ctx.fillStyle = Fx.rgba(b.col, a * 0.85);
        tracked(ctx, b.sub, cx, baseY + rise - i * 5.6 * u + sz * 0.7, 0.12 * u, 'center');
      }
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /* =============================================================== ready */

  function drawReady(ctx, rx, ry) {
    if (V.intro <= 0.002) { return; }
    screen();
    var u = R.s, a = V.intro, cx = centreX();
    var top = Math.max(R.stage.t, 0);

    var flick = 0.9 + 0.07 * psin(V.t * 2.3) + 0.04 * psin(V.t * 7.1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + (10.5 * u).toFixed(1) + 'px ' + DISPLAY;
    ctx.shadowColor = 'rgba(255,140,50,' + (0.7 * a).toFixed(3) + ')';
    ctx.shadowBlur = 22 * flick;
    var g = ctx.createLinearGradient(0, top + 17 * u, 0, top + 30 * u);
    g.addColorStop(0, 'rgba(255,246,220,' + (a * flick).toFixed(3) + ')');
    g.addColorStop(0.6, 'rgba(255,184,78,' + (a * flick).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255,106,52,' + (a * flick).toFixed(3) + ')');
    ctx.fillStyle = g;
    tracked(ctx, 'EMBER', cx, top + 24 * u, 1.9 * u, 'center');
    ctx.restore();

    ctx.save();
    ctx.font = '500 ' + (2.4 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(228,208,216,' + (0.45 * a).toFixed(3) + ')';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    tracked(ctx, 'A SPARK CLIMBS THE FLUE', cx, top + 32.5 * u, 0.42 * u, 'center');
    ctx.restore();

    if (!V.aim.down) {
      var cyc = (V.t * 0.5) % 1;
      var phase = cyc < 0.2 ? 0 : (cyc < 0.6 ? 1 : (cyc < 0.7 ? 2 : 3));
      var k = phase === 1 ? (cyc - 0.2) / 0.4 : (phase >= 2 ? 1 : 0);
      var ease = k * k * (3 - 2 * k);
      var gx = toScreenX(74);
      var gy = toScreenY(ry + 2);
      var pull = 13 * u * ease;
      var aG = a * (phase === 3 ? clamp(1 - (cyc - 0.7) / 0.3, 0, 1) : 1);

      ctx.save();
      ctx.globalAlpha = aG;
      ctx.strokeStyle = 'rgba(255,206,140,0.45)';
      ctx.lineWidth = Math.max(1, 0.26 * u);
      ctx.setLineDash([0.8 * u, 0.8 * u]);
      ctx.beginPath();
      ctx.arc(gx, gy, C.DEAD_ZONE * u, 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
      var tx = gx - pull * 0.5, ty = gy + pull;
      if (phase >= 1) {
        ctx.strokeStyle = 'rgba(255,206,140,0.75)';
        ctx.lineWidth = Math.max(1, 0.4 * u);
        ctx.beginPath();
        ctx.moveTo(gx, gy); ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,190,110,0.5)';
        ctx.lineWidth = Math.max(1, 0.4 * u);
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + pull * 0.5, gy - pull);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,190,110,0.5)';
        ctx.beginPath();
        ctx.moveTo(gx + pull * 0.5, gy - pull);
        ctx.lineTo(gx + pull * 0.5 - 1.7 * u, gy - pull + 0.5 * u);
        ctx.lineTo(gx + pull * 0.5 + 0.4 * u, gy - pull + 2.1 * u);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(255,234,204,' + (phase === 2 ? 0.95 : 0.62) + ')';
      ctx.beginPath();
      ctx.arc(phase >= 1 ? tx : gx, phase >= 1 ? ty : gy, (phase === 2 ? 2.7 : 2.1) * u, 0, 6.2832);
      ctx.fill();

      ctx.font = '600 ' + (2.25 * u).toFixed(1) + 'px ' + UI;
      ctx.fillStyle = 'rgba(255,222,182,0.45)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      tracked(ctx, 'PULL BACK  \u2022  RELEASE', cx, gy - 13 * u, 0.3 * u, 'center');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
  }

  function drawAirHint(ctx, rx, ry) {
    if (V.hintAir <= 0.01) { return; }
    screen();
    var u = R.s;
    ctx.save();
    ctx.globalAlpha = V.hintAir;
    ctx.font = '600 ' + (2.4 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(255,224,176,0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    tracked(ctx, 'AGAIN \u2014 IN THE AIR', toScreenX(rx), toScreenY(ry) - 10 * u, 0.28 * u, 'center');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /* =========================================================== game over */

  var TIER_COL = [
    [158, 148, 158], [212, 162, 122], [255, 176, 96],
    [255, 202, 100], [255, 230, 140], [176, 240, 255], [236, 216, 255]
  ];

  function emblem(ctx, x, y, r, col, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    A.glow(ctx, 0, 0, r * 2.2, col, 0.3);
    ctx.restore();
    // hexagonal badge
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * 6.2832 - Math.PI / 2;
      var xx = Math.cos(a) * r, yy = Math.sin(a) * r;
      if (i) { ctx.lineTo(xx, yy); } else { ctx.moveTo(xx, yy); }
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, 'rgba(38,26,34,0.95)');
    g.addColorStop(1, 'rgba(16,12,20,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = Fx.rgba(col, 0.8);
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.stroke();
    // flame mark inside
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var fr = r * 0.5;
    var fg = ctx.createLinearGradient(0, -fr * 1.4, 0, fr * 1.3);
    fg.addColorStop(0, Fx.rgba(col, 0.95));
    fg.addColorStop(1, 'rgba(255,120,60,0.75)');
    ctx.fillStyle = fg;
    pipPath(ctx, 0, fr * 0.05 + psin(t * 0.8) * fr * 0.05, fr);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawGameOver(ctx, S) {
    screen();
    var u = R.s;
    var e = clamp(V.goT / 0.5, 0, 1);
    e = e * e * (3 - 2 * e);
    var cx = R.cw / 2, cy = R.ch / 2;

    ctx.fillStyle = 'rgba(4,16,22,' + (0.66 * e).toFixed(3) + ')';
    ctx.fillRect(0, 0, R.cw, R.ch);
    var vg = ctx.createRadialGradient(cx, cy, R.stage.w * 0.12, cx, cy, R.stage.w * 0.95);
    vg.addColorStop(0, 'rgba(8,34,42,0)');
    vg.addColorStop(1, 'rgba(3,18,26,' + (0.8 * e).toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, R.cw, R.ch);

    var pw = Math.min(R.stage.w * 0.88, R.cw - 8 * u);
    var ph = Math.min(101 * u, Math.min(R.stage.h, R.ch) - 10 * u);
    var pl = cx - pw / 2, pt = cy - ph / 2;

    ctx.save();
    ctx.globalAlpha = e;
    var pg = ctx.createLinearGradient(0, pt, 0, pt + ph);
    pg.addColorStop(0, 'rgba(28,18,30,0.95)');
    pg.addColorStop(1, 'rgba(11,8,16,0.97)');
    ctx.fillStyle = pg;
    A.rr(ctx, pl, pt, pw, ph, 4.5 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,160,80,0.22)';
    ctx.lineWidth = Math.max(1, 0.24 * u);
    ctx.stroke();

    var tier = E.rankIndexFor(S.score);
    var tcol = TIER_COL[tier];
    var st = function (delay, dur) {
      var k = clamp((V.goT - delay) / dur, 0, 1);
      return k * k * (3 - 2 * k);
    };

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var y = pt + 8 * u;
    ctx.save();
    ctx.globalAlpha = e * st(0.05, 0.4);
    ctx.font = '600 ' + (2.5 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(142,222,222,0.72)';
    tracked(ctx, 'THE DAMP TOOK YOU', cx, y, 0.52 * u, 'center');
    ctx.restore();

    /* rank */
    y += 15 * u;
    var s1 = st(0.3, 0.45);
    ctx.save();
    ctx.globalAlpha = e * s1;
    emblem(ctx, cx, y, 9 * u * (0.72 + 0.28 * s1), tcol, V.t);
    ctx.restore();

    y += 14.5 * u;
    ctx.save();
    ctx.globalAlpha = e * st(0.42, 0.4);
    ctx.font = '700 ' + (5.6 * u).toFixed(1) + 'px ' + DISPLAY;
    ctx.shadowColor = Fx.rgba(tcol, 0.6);
    ctx.shadowBlur = 10;
    ctx.fillStyle = Fx.rgba(tcol, 0.98);
    tracked(ctx, S.rank ? S.rank.toUpperCase() : '', cx, y, 0.7 * u, 'center');
    ctx.restore();

    /* score */
    y += 12.5 * u;
    ctx.save();
    ctx.globalAlpha = e * st(0.55, 0.3);
    ctx.font = '600 ' + (2.15 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(226,212,222,0.42)';
    tracked(ctx, 'SCORE', cx, y, 0.4 * u, 'center');
    y += 8.5 * u;
    ctx.font = '600 ' + (11 * u).toFixed(1) + 'px ' + DISPLAY;
    ctx.shadowColor = 'rgba(255,150,60,0.55)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(255,242,220,0.98)';
    tracked(ctx, String(Math.floor(V.scoreShown)), cx, y, 0.3 * u, 'center');
    ctx.restore();

    /* stat row */
    y += 11 * u;
    var s3 = st(0.95, 0.4);
    ctx.save();
    ctx.globalAlpha = e * s3;
    ctx.strokeStyle = 'rgba(255,180,120,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pl + 9 * u, y - 4.5 * u);
    ctx.lineTo(pl + pw - 9 * u, y - 4.5 * u);
    ctx.stroke();

    var cols = [
      ['BEST', String(S.sessionBest), S.newBest],
      ['BEST CHAIN', '\u00d7' + S.chainBest, S.chainBest >= 4],
      ['HEIGHT', String(Math.floor(S.height)), false]
    ];
    for (var i = 0; i < 3; i++) {
      var colx = pl + pw * (0.5 + (i - 1) * 0.29);
      ctx.font = '600 ' + (1.95 * u).toFixed(1) + 'px ' + UI;
      ctx.fillStyle = 'rgba(220,206,218,0.36)';
      tracked(ctx, cols[i][0], colx, y + 0.5 * u, 0.24 * u, 'center');
      ctx.font = '600 ' + (4.1 * u).toFixed(1) + 'px ' + DISPLAY;
      if (cols[i][2]) {
        ctx.shadowColor = 'rgba(255,200,110,0.8)';
        ctx.shadowBlur = 9;
        ctx.fillStyle = 'rgba(255,226,158,0.98)';
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(240,228,224,0.8)';
      }
      tracked(ctx, cols[i][1], colx, y + 6.3 * u, 0.2 * u, 'center');
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    if (S.newBest && S.sessionBest > 0) {
      ctx.save();
      ctx.globalAlpha = e * st(1.15, 0.35) * (0.7 + 0.3 * Math.abs(psin(V.t * 1.3)));
      ctx.globalCompositeOperation = 'lighter';
      ctx.font = '700 ' + (2.5 * u).toFixed(1) + 'px ' + UI;
      ctx.fillStyle = 'rgba(255,222,150,0.95)';
      tracked(ctx, 'NEW SESSION BEST', cx, pt + ph - 14 * u, 0.5 * u, 'center');
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = e * st(1.3, 0.4) * (0.72 + 0.28 * Math.abs(psin(V.t * 0.75)));
    ctx.font = '600 ' + (2.4 * u).toFixed(1) + 'px ' + UI;
    ctx.fillStyle = 'rgba(255,214,178,0.85)';
    tracked(ctx, 'TAP TO CLIMB AGAIN', cx, pt + ph - 6.5 * u, 0.5 * u, 'center');
    ctx.restore();

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /* =============================================================== frame */

  function sparkState(S) {
    if (S.phase === 'gameover') { return 'taken'; }
    if (V.burstT > 0) { return 'burst'; }
    if (V.aim.down && S.jumpsLeft > 0) { return 'aim'; }
    if (S.anchorKind === 'wall') { return 'cling'; }
    if (S.anchored) { return 'rest'; }
    if (S.jumpsLeft <= 0) { return 'panic'; }
    return 'flight';
  }

  function frame(sim, dt, alpha) {
    var S = sim.state, ctx = R.ctx;
    V.t += dt;

    var rx = S.px + (S.x - S.px) * alpha;
    var ry = S.py + (S.y - S.py) * alpha;
    if (S.phase === 'ready') { rx = S.x; ry = S.y; }

    /* camera: keep the spark low in frame so the climb above is legible, and
       never show much of the world below the hearth floor */
    var hh = (R.ch / 2) / R.s;
    var camMin = hh - 24;
    var target = ry + C.VIEW_H * 0.12;
    if (target < camMin) { target = camMin; }
    var lead = S.vy > 0 ? 0.10 : 0.055;
    V.camY += (target - V.camY) * Math.min(1, dt * (1 / lead));
    if (S.phase === 'ready') { V.camY = target; }

    /* view-only timers */
    V.prox = clamp(1 - (ry - S.dampY) / 105, 0, 1);
    V.alt = clamp(S.height / 2300, 0, 1);
    V.burstT = Math.max(0, V.burstT - dt);
    V.chainPop = Math.max(0, V.chainPop - dt * 3.2);
    for (var i = 0; i < V.pip.length; i++) { V.pip[i] = Math.max(0, V.pip[i] - dt * 3.4); }
    if (S.phase === 'gameover') {
      V.goT += dt;
      V.dim = clamp(V.goT / 0.8, 0, 1);
      V.scoreShown += (S.score - V.scoreShown) * Math.min(1, dt * 4.5);
      if (V.goT > 1.4) { V.scoreShown = S.score; }
    } else {
      V.goT = 0; V.dim = 0; V.scoreShown = 0;
    }
    if (S.phase !== 'ready') { V.intro = Math.max(0, V.intro - dt * 2.2); }

    // reveal the mid-air launch only when it is about to be useful
    if (S.phase === 'playing' && !S.anchored && S.jumpsLeft > 0 &&
      S.midairLaunches === 0 && S.vy < 20 && !V.aim.down) {
      V.airIdle += dt;
    } else if (S.anchored || S.midairLaunches > 0 || V.aim.down) {
      V.airIdle = 0;
    }
    var wantHint = S.midairLaunches === 0 && V.airIdle > 0.45 && !S.anchored;
    V.hintAir += ((wantHint ? 1 : 0) - V.hintAir) * Math.min(1, dt * 6);

    /* trail */
    if (S.phase === 'playing' && !S.anchored) {
      var sp = Math.sqrt(S.vx * S.vx + S.vy * S.vy);
      if (sp > 45) { Fx.trail(rx, ry, S.vx, S.vy, Math.min(1, sp / 200)); }
    }

    Fx.update(dt);
    var sh = Fx.shakeOffset();
    shx = sh[0] * R.s * R.dpr;
    shy = sh[1] * R.s * R.dpr;

    /* ---- draw ---- */
    var b = viewBounds();
    drawBackdrop(ctx, b);
    drawAsh(ctx, 0.55, 26, false);
    drawWalls(ctx, b);

    world(V.camY);
    var L = sim.gen.ledges, it = sim.gen.items, k;
    for (k = 0; k < L.length; k++) {
      if (L[k].y < b.y0 - 12 || L[k].y > b.y1 + 12) { continue; }
      A.drawLedge(ctx, L[k], V.t);
    }
    for (k = 0; k < it.length; k++) {
      var o = it[k];
      if (!o.active || o.y < b.y0 - 12 || o.y > b.y1 + 12) { continue; }
      if (o.type === 'glimmer') { A.drawGlimmer(ctx, o, V.t); }
      else { A.drawMoth(ctx, o, V.t, false); }
    }

    Fx.drawWorld(ctx);

    world(V.camY);
    A.drawSpark(ctx, {
      x: rx, y: ry, r: C.PLAYER_R,
      vx: S.vx, vy: S.vy,
      state: sparkState(S), t: V.t,
      aimX: V.aim.dirX, aimY: V.aim.dirY,
      power: V.aim.power, wall: S.x < 50 ? -1 : 1,
      dim: V.dim
    });

    drawDamp(ctx, S, b);
    drawAsh(ctx, 1.25, 12, true);

    // vignette keeps the eye in the flue
    screen();
    var vg2 = ctx.createRadialGradient(R.cw / 2, R.ch / 2, Math.min(R.cw, R.ch) * 0.32,
      R.cw / 2, R.ch / 2, Math.max(R.cw, R.ch) * 0.75);
    vg2.addColorStop(0, 'rgba(0,0,0,0)');
    vg2.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg2;
    ctx.fillRect(0, 0, R.cw, R.ch);

    var fa = Fx.flashAlpha();
    if (fa > 0.002) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = Fx.rgba(Fx.flashColor(), fa);
      ctx.fillRect(0, 0, R.cw, R.ch);
      ctx.restore();
    }

    if (S.phase !== 'gameover') {
      drawAim(ctx, S, rx, ry);
      drawHud(ctx, S, rx, ry);
      drawBanners(ctx);
      drawAirHint(ctx, rx, ry);
      drawReady(ctx, rx, ry);
    } else {
      drawBanners(ctx);
      drawGameOver(ctx, S);
    }
  }

  function resetView(S) {
    V.camY = S.y + C.VIEW_H * 0.12;
    var camMin = (R.ch / 2) / Math.max(0.001, R.s) - 24;
    if (V.camY < camMin) { V.camY = camMin; }
    V.intro = 1; V.burstT = 0; V.dim = 0; V.goT = 0;
    V.scoreShown = 0; V.chainPop = 0; V.hintAir = 0; V.airIdle = 0;
    for (var i = 0; i < V.pip.length; i++) { V.pip[i] = 0; }
  }

  E.Render = {
    R: R, V: V,
    init: init, resize: resize, frame: frame, resetView: resetView,
    toScreenX: toScreenX, toScreenY: toScreenY
  };

})(window.EMBER);
