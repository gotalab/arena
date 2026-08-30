/* EMBER — art. Every asset is drawn in code: textures baked once into offscreen
 * canvases, characters drawn live so they can act. Nothing here touches rules.
 */
(function () {
  'use strict';
  var E = window.EMBER;
  var clamp = E.clamp, lerp = E.lerp;
  var TAU = Math.PI * 2;

  var Art = {};

  /* ------------------------------------------------------------- palette */
  var P = Art.palette = {
    voidTop: '#0b0817',
    voidBot: '#140c14',
    brick: '#241a2e',
    brickHi: '#31243d',
    brickLo: '#170f1f',
    mortar: '#100a17',
    stone: '#2e2439',
    stoneTop: '#6d5573',
    rim: '#ffb066',
    emberA: '#fff3c4',
    emberB: '#ffb340',
    emberC: '#ff7a1e',
    emberD: '#c33f14',
    moth: '#4b3a63',
    mothHi: '#a08cc0',
    mothWing: '#6b5686',
    gold: '#ffe9a8',
    goldDeep: '#ffc24a',
    damp: '#0d3b3a',
    dampMid: '#155450',
    dampRim: '#7fe3d0',
    ink: '#0a0710'
  };

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ------------------------------------------------------- baked textures */
  function bakeBrick(w, h, seed, opts) {
    opts = opts || {};
    var c = mk(w, h), g = c.getContext('2d');
    var rng = new E.Rng(seed);
    g.fillStyle = opts.mortar || P.mortar;
    g.fillRect(0, 0, w, h);
    var rowH = opts.rowH || 26;
    var rows = Math.ceil(h / rowH);
    for (var r = 0; r < rows; r++) {
      var y = r * rowH;
      var off = (r % 2) * (opts.bw || 46) * 0.5 - rng.range(0, 10);
      var x = -60 + off;
      while (x < w + 60) {
        var bw = (opts.bw || 46) * rng.range(0.72, 1.35);
        var shade = rng.next();
        var base = shade > 0.82 ? (opts.hi || P.brickHi) : shade < 0.2 ? (opts.lo || P.brickLo) : (opts.base || P.brick);
        g.fillStyle = base;
        var px = Math.round(x) + 1.5, py = y + 1.5, pw = Math.round(bw) - 3, ph = rowH - 3;
        g.beginPath();
        var rr = 2.5;
        g.moveTo(px + rr, py);
        g.arcTo(px + pw, py, px + pw, py + ph, rr);
        g.arcTo(px + pw, py + ph, px, py + ph, rr);
        g.arcTo(px, py + ph, px, py, rr);
        g.arcTo(px, py, px + pw, py, rr);
        g.closePath();
        g.fill();
        // top bevel
        g.fillStyle = 'rgba(255,255,255,0.045)';
        g.fillRect(px + 2, py + 1, Math.max(0, pw - 4), 1.6);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(px + 2, py + ph - 2.4, Math.max(0, pw - 4), 2);
        // pitting
        var pits = rng.int(0, 3);
        for (var k = 0; k < pits; k++) {
          g.fillStyle = 'rgba(0,0,0,' + (0.1 + rng.next() * 0.2).toFixed(3) + ')';
          g.beginPath();
          g.arc(px + rng.range(3, Math.max(4, pw - 3)), py + rng.range(3, ph - 3), rng.range(0.7, 2.2), 0, TAU);
          g.fill();
        }
        x += bw;
      }
    }
    // soot streaks running down the flue
    for (var s = 0; s < (opts.streaks === undefined ? 14 : opts.streaks); s++) {
      var sx = rng.range(0, w), sw = rng.range(4, 22);
      var grad = g.createLinearGradient(sx, 0, sx + sw, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(4,2,8,' + (0.12 + rng.next() * 0.3).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(sx, 0, sw, h);
    }
    return c;
  }

  Art.build = function () {
    // tile heights are exact multiples of the row height (and an even number of
    // rows) so the vertical repeat never shows a seam or a doubled brick course
    Art.wallTile = bakeBrick(120, 250, 0x51de1, { bw: 44, rowH: 25 });
    Art.farTile = bakeBrick(320, 256, 0x7a11, {
      bw: 30, rowH: 16, base: '#191223', hi: '#20182c', lo: '#120c1a', mortar: '#0c0713', streaks: 14
    });
    Art.built = true;
  };

  /* ------------------------------------------------------------- the spark
   * p = { x, y, r, sx, sy, rot, temp, glow, alpha, flame, sway,
   *       eyeOpen, eyeShape, pupilX, pupilY, brow, mouth, mouthAmt,
   *       arms, sweat, sparkle }
   */
  Art.drawSpark = function (ctx, p) {
    var r = p.r, t = p.t || 0;
    var temp = p.temp === undefined ? 0 : p.temp;
    var alpha = p.alpha === undefined ? 1 : p.alpha;
    if (alpha <= 0.01) return;

    var coreCol, midCol, edgeCol, glowCol;
    if (temp >= 0) {
      var w = clamp(temp, 0, 1);
      coreCol = '#ffffff';
      midCol = w > 0.5 ? '#fff6d0' : P.emberA;
      edgeCol = w > 0.5 ? P.emberB : P.emberC;
      glowCol = '255,' + Math.round(150 + 70 * w) + ',' + Math.round(50 + 90 * w);
    } else {
      var c2 = clamp(-temp, 0, 1);
      coreCol = '#ffffff';
      midCol = 'rgb(' + Math.round(255 - 40 * c2) + ',' + Math.round(243 - 40 * c2) + ',' + Math.round(196 + 40 * c2) + ')';
      edgeCol = 'rgb(' + Math.round(255 - 110 * c2) + ',' + Math.round(179 - 60 * c2) + ',' + Math.round(64 + 90 * c2) + ')';
      glowCol = Math.round(255 - 110 * c2) + ',' + Math.round(150 - 20 * c2) + ',' + Math.round(50 + 120 * c2);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);

    /* halo */
    var gl = (p.glow === undefined ? 1 : p.glow);
    if (gl > 0.02) {
      var hr = r * (2.6 + 1.8 * gl);
      var hg = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, hr);
      hg.addColorStop(0, 'rgba(' + glowCol + ',' + (0.5 * gl).toFixed(3) + ')');
      hg.addColorStop(0.45, 'rgba(' + glowCol + ',' + (0.16 * gl).toFixed(3) + ')');
      hg.addColorStop(1, 'rgba(' + glowCol + ',0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, 0, hr, 0, TAU); ctx.fill();
      ctx.restore();
    }

    /* body: squash + stretch happens around the motion axis, the face stays upright */
    ctx.save();
    if (p.rot) ctx.rotate(p.rot);
    ctx.scale(p.sx === undefined ? 1 : p.sx, p.sy === undefined ? 1 : p.sy);
    if (p.rot) ctx.rotate(-p.rot);

    // flame crown
    var fl = (p.flame === undefined ? 1 : p.flame);
    var sway = p.sway || 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var f = 0; f < 3; f++) {
      var fx = (f - 1) * r * 0.44 + sway * r * (0.5 + f * 0.25);
      var fh = r * (1.15 + fl * 0.95) * (f === 1 ? 1 : 0.62) * (0.86 + 0.14 * Math.sin(t * 9 + f * 2.1));
      var fw = r * (f === 1 ? 0.42 : 0.3);
      var fg = ctx.createLinearGradient(0, -r * 0.4, 0, -r * 0.4 - fh);
      fg.addColorStop(0, 'rgba(' + glowCol + ',0.85)');
      fg.addColorStop(0.55, 'rgba(255,220,140,0.5)');
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(fx - fw, -r * 0.5);
      ctx.quadraticCurveTo(fx - fw * 0.7, -r * 0.5 - fh * 0.7, fx + sway * r * 0.5, -r * 0.5 - fh);
      ctx.quadraticCurveTo(fx + fw * 0.7, -r * 0.5 - fh * 0.7, fx + fw, -r * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // ember body
    var bg = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.08, 0, 0, r * 1.06);
    bg.addColorStop(0, coreCol);
    bg.addColorStop(0.35, midCol);
    bg.addColorStop(0.78, edgeCol);
    bg.addColorStop(1, temp < -0.4 ? 'rgba(120,110,170,0.85)' : P.emberD);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // rim light
    ctx.strokeStyle = 'rgba(255,240,200,0.5)';
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.94, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore(); // end squash

    /* arms — only when the spark needs them */
    if (p.arms) {
      var side = p.arms.side || 1, strain = p.arms.strain || 0;
      ctx.strokeStyle = edgeCol;
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.26;
      for (var a = 0; a < 2; a++) {
        var ay = (a === 0 ? -0.12 : 0.42) * r;
        var wob = Math.sin(t * 14 + a * 2) * strain * r * 0.08;
        ctx.beginPath();
        ctx.moveTo(side * r * 0.55, ay);
        ctx.quadraticCurveTo(side * r * 1.05, ay - r * 0.28 + wob, side * r * 1.25, ay - r * 0.5 + wob);
        ctx.stroke();
      }
    }

    /* face — always upright and unstretched so the expression reads */
    var eo = p.eyeOpen === undefined ? 1 : p.eyeOpen;
    var ex = r * 0.37, ey = -r * 0.08;
    var erx = r * 0.25, ery = r * 0.29 * eo;
    var shape = p.eyeShape || 'normal';
    var px = (p.pupilX || 0) * r * 0.1, py = (p.pupilY || 0) * r * 0.1;

    if (shape === 'x') {
      ctx.strokeStyle = '#4a1d12';
      ctx.lineWidth = r * 0.13;
      ctx.lineCap = 'round';
      for (var s = -1; s <= 1; s += 2) {
        var cx = s * ex;
        ctx.beginPath();
        ctx.moveTo(cx - erx * 0.8, ey - erx * 0.8); ctx.lineTo(cx + erx * 0.8, ey + erx * 0.8);
        ctx.moveTo(cx + erx * 0.8, ey - erx * 0.8); ctx.lineTo(cx - erx * 0.8, ey + erx * 0.8);
        ctx.stroke();
      }
    } else if (shape === 'star') {
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        Art.star(ctx, s2 * ex, ey, r * 0.34, r * 0.13, 4, '#fffbe8', t * 3);
      }
    } else {
      var wide = shape === 'wide' ? 1.32 : 1;
      var squint = shape === 'squint' ? 0.42 : 1;
      for (var s3 = -1; s3 <= 1; s3 += 2) {
        var exx = s3 * ex;
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.ellipse(exx, ey, erx * wide, ery * wide * squint, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,26,14,0.4)';
        ctx.lineWidth = r * 0.045;
        ctx.stroke();
        if (eo > 0.15) {
          ctx.fillStyle = '#3d1409';
          ctx.beginPath();
          var prx = erx * (shape === 'wide' ? 0.5 : 0.62), pry = ery * (shape === 'wide' ? 0.5 : 0.66) * squint;
          ctx.ellipse(exx + px, ey + py, prx, Math.max(0.6, pry), 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(exx + px - prx * 0.35, ey + py - pry * 0.4, Math.max(0.5, prx * 0.32), 0, TAU);
          ctx.fill();
        }
      }
    }

    // brows
    var brow = p.brow || 0;
    if (Math.abs(brow) > 0.05) {
      ctx.strokeStyle = 'rgba(90,30,14,0.75)';
      ctx.lineWidth = r * 0.11;
      ctx.lineCap = 'round';
      for (var s4 = -1; s4 <= 1; s4 += 2) {
        var bx = s4 * ex, by = ey - ery - r * 0.14 - (brow > 0 ? r * 0.08 * brow : 0);
        var tilt = brow * r * 0.16 * s4;
        ctx.beginPath();
        ctx.moveTo(bx - erx * 0.95, by + (brow < 0 ? -tilt : tilt));
        ctx.lineTo(bx + erx * 0.95, by - (brow < 0 ? -tilt : tilt));
        ctx.stroke();
      }
    }

    // mouth
    var my = r * 0.42, amt = p.mouthAmt === undefined ? 1 : p.mouthAmt;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (p.mouth) {
      case 'o':
        ctx.fillStyle = '#5c1c10';
        ctx.beginPath();
        ctx.ellipse(0, my, r * 0.17 * amt, r * 0.23 * amt, 0, 0, TAU);
        ctx.fill();
        break;
      case 'grin':
        ctx.fillStyle = '#5c1c10';
        ctx.beginPath();
        ctx.moveTo(-r * 0.34, my - r * 0.06);
        ctx.quadraticCurveTo(0, my + r * 0.42 * amt, r * 0.34, my - r * 0.06);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.moveTo(-r * 0.3, my - r * 0.04);
        ctx.lineTo(r * 0.3, my - r * 0.04);
        ctx.lineTo(r * 0.24, my + r * 0.08);
        ctx.lineTo(-r * 0.24, my + r * 0.08);
        ctx.closePath();
        ctx.fill();
        break;
      case 'grit':
        ctx.fillStyle = '#5c1c10';
        ctx.beginPath();
        ctx.rect(-r * 0.3, my - r * 0.1, r * 0.6, r * 0.2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,250,240,0.9)';
        ctx.lineWidth = r * 0.05;
        for (var gx = -2; gx <= 2; gx++) {
          ctx.beginPath();
          ctx.moveTo(gx * r * 0.12, my - r * 0.1);
          ctx.lineTo(gx * r * 0.12, my + r * 0.1);
          ctx.stroke();
        }
        break;
      case 'wobble':
        ctx.strokeStyle = '#5c1c10';
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        for (var wx = -3; wx <= 3; wx++) {
          var wpx = wx * r * 0.1;
          var wpy = my + Math.sin(wx * 1.9 + t * 12) * r * 0.07;
          if (wx === -3) ctx.moveTo(wpx, wpy); else ctx.lineTo(wpx, wpy);
        }
        ctx.stroke();
        break;
      case 'flat':
        ctx.strokeStyle = '#5c1c10';
        ctx.lineWidth = r * 0.1;
        ctx.beginPath();
        ctx.moveTo(-r * 0.22, my); ctx.lineTo(r * 0.22, my);
        ctx.stroke();
        break;
      default: // smile
        ctx.strokeStyle = '#5c1c10';
        ctx.lineWidth = r * 0.11;
        ctx.beginPath();
        ctx.arc(0, my - r * 0.12, r * 0.28, 0.18 * Math.PI, 0.82 * Math.PI);
        ctx.stroke();
    }

    // strain sweat
    if (p.sweat) {
      ctx.fillStyle = 'rgba(180,235,255,' + (0.55 * p.sweat).toFixed(2) + ')';
      var sxp = -(p.arms ? (p.arms.side || 1) : 1) * r * 0.75;
      var syp = -r * 0.7 + (Math.sin(t * 5) * 0.5 + 0.5) * r * 0.35;
      ctx.beginPath();
      ctx.moveTo(sxp, syp - r * 0.22);
      ctx.quadraticCurveTo(sxp + r * 0.13, syp, sxp, syp + r * 0.14);
      ctx.quadraticCurveTo(sxp - r * 0.13, syp, sxp, syp - r * 0.22);
      ctx.fill();
    }

    ctx.restore();
  };

  Art.star = function (ctx, x, y, outer, inner, points, color, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var rr = i % 2 ? inner : outer;
      var a = (i / (points * 2)) * TAU - Math.PI / 2;
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  };

  /* ---------------------------------------------------------------- moths */
  Art.drawMoth = function (ctx, x, y, r, id, t, alarm) {
    var h1 = E.hashf(id, 1), h2 = E.hashf(id, 2);
    var flap = Math.sin(t * (7.5 + h1 * 3) + h2 * 6.3);
    var open = 0.28 + 0.72 * Math.abs(flap);
    var tilt = Math.sin(t * 1.4 + h1 * 6.3) * 0.22 + flap * 0.06;
    alarm = alarm || 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // dust aura
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var ag = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.1);
    ag.addColorStop(0, 'rgba(180,150,220,0.20)');
    ag.addColorStop(1, 'rgba(150,120,200,0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, TAU); ctx.fill();
    ctx.restore();

    // wings
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.scale(s * open, 1);
      // upper wing
      var wg = ctx.createLinearGradient(0, -r * 0.6, r * 1.35, r * 0.4);
      wg.addColorStop(0, P.mothWing);
      wg.addColorStop(0.6, '#57446f');
      wg.addColorStop(1, '#3a2c4d');
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.35);
      ctx.bezierCurveTo(r * 0.95, -r * 1.5, r * 1.65, -r * 0.55, r * 1.05, r * 0.18);
      ctx.bezierCurveTo(r * 0.7, r * 0.5, r * 0.25, r * 0.35, 0, r * 0.2);
      ctx.closePath();
      ctx.fill();
      // lower wing
      ctx.fillStyle = '#3e3055';
      ctx.beginPath();
      ctx.moveTo(0, r * 0.05);
      ctx.bezierCurveTo(r * 0.75, r * 0.35, r * 0.95, r * 1.1, r * 0.35, r * 0.95);
      ctx.bezierCurveTo(r * 0.12, r * 0.85, r * 0.04, r * 0.5, 0, r * 0.3);
      ctx.closePath();
      ctx.fill();
      // eyespot + dust
      ctx.fillStyle = 'rgba(255,220,160,0.55)';
      ctx.beginPath(); ctx.ellipse(r * 0.92, -r * 0.4, r * 0.2, r * 0.14, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(20,12,30,0.7)';
      ctx.beginPath(); ctx.ellipse(r * 0.94, -r * 0.4, r * 0.09, r * 0.06, 0.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(200,180,235,0.35)';
      ctx.lineWidth = r * 0.05;
      ctx.beginPath();
      ctx.moveTo(r * 0.15, -r * 0.2);
      ctx.quadraticCurveTo(r * 0.8, -r * 0.55, r * 1.2, -r * 0.1);
      ctx.stroke();
      ctx.restore();
    }

    // body
    var bg = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.9);
    bg.addColorStop(0, '#5d4a78');
    bg.addColorStop(1, '#2b2140');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.3, r * 0.78, 0, 0, TAU);
    ctx.fill();
    // fluffy collar
    ctx.fillStyle = '#7a659b';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.44, r * 0.36, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,170,225,0.5)';
    ctx.lineWidth = r * 0.05;
    for (var f2 = 0; f2 < 6; f2++) {
      var a2 = -Math.PI + (f2 / 5) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a2) * r * 0.28, -r * 0.44 + Math.sin(a2) * r * 0.2);
      ctx.lineTo(Math.cos(a2) * r * 0.48, -r * 0.44 + Math.sin(a2) * r * 0.36);
      ctx.stroke();
    }
    // antennae
    ctx.strokeStyle = '#8a76ab';
    ctx.lineWidth = r * 0.07;
    ctx.lineCap = 'round';
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var wig = Math.sin(t * 3 + s2 + h2 * 4) * r * 0.1;
      ctx.beginPath();
      ctx.moveTo(s2 * r * 0.12, -r * 0.62);
      ctx.quadraticCurveTo(s2 * r * 0.5, -r * 1.15, s2 * r * 0.62 + wig, -r * 1.45);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,214,150,0.9)';
      ctx.beginPath(); ctx.arc(s2 * r * 0.62 + wig, -r * 1.45, r * 0.09, 0, TAU); ctx.fill();
    }
    // eyes: two warm coals
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      ctx.fillStyle = alarm > 0.3 ? 'rgba(255,180,120,0.95)' : 'rgba(255,206,140,0.85)';
      ctx.beginPath();
      ctx.arc(s3 * r * 0.16, -r * 0.5, r * (0.085 + 0.03 * alarm), 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();
  };

  /* -------------------------------------------------------------- glimmer */
  Art.drawGlimmer = function (ctx, x, y, r, id, t) {
    var h = E.hashf(id, 3);
    var pulse = 0.82 + 0.18 * Math.sin(t * 3.1 + h * 6.3);
    ctx.save();
    ctx.translate(x, y);

    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.0 * pulse);
    g.addColorStop(0, 'rgba(255,236,180,0.55)');
    g.addColorStop(0.3, 'rgba(255,190,90,0.22)');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 3.0 * pulse, 0, TAU); ctx.fill();

    ctx.rotate(t * 0.5 + h * 3);
    Art.star(ctx, 0, 0, r * 1.55 * pulse, r * 0.3, 4, 'rgba(255,232,170,0.95)', 0);
    ctx.rotate(Math.PI / 4);
    Art.star(ctx, 0, 0, r * 0.95 * pulse, r * 0.24, 4, 'rgba(255,255,235,0.9)', 0);
    ctx.rotate(-t * 0.5 - h * 3 - Math.PI / 4);

    ctx.fillStyle = 'rgba(255,255,245,0.98)';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.36 * pulse, 0, TAU); ctx.fill();

    // orbiting motes
    for (var i = 0; i < 3; i++) {
      var a = t * 1.6 + i * TAU / 3 + h * 6;
      var rr = r * (1.5 + 0.35 * Math.sin(t * 2 + i));
      ctx.fillStyle = 'rgba(255,220,150,' + (0.35 + 0.3 * Math.sin(t * 4 + i)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.7, r * 0.12, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------------------------------------------------------------- ledge */
  Art.drawLedge = function (ctx, x, y, hw, id, lit) {
    var th = E.C.LEDGE_THICK;
    var h1 = E.hashf(id, 11), h2 = E.hashf(id, 12), h3 = E.hashf(id, 13);
    ctx.save();
    ctx.translate(x, y);

    // body with a chipped underside
    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.lineTo(hw - 2 - h1 * 4, th * (0.55 + h2 * 0.4));
    var teeth = 3 + Math.floor(h1 * 3);
    for (var i = teeth - 1; i >= 0; i--) {
      var tx = -hw + (i / teeth) * hw * 2 + hw / teeth;
      var ty = th * (0.5 + E.hashf(id, 20 + i) * 0.85);
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(-hw + 2 + h3 * 4, th * (0.5 + h3 * 0.4));
    ctx.closePath();
    var g = ctx.createLinearGradient(0, -2, 0, th);
    g.addColorStop(0, '#4a3a54');
    g.addColorStop(0.35, P.stone);
    g.addColorStop(1, '#191223');
    ctx.fillStyle = g;
    ctx.fill();

    // warm top edge — the landable surface, always legible
    ctx.fillStyle = 'rgba(255,176,102,' + (0.5 + 0.5 * lit).toFixed(2) + ')';
    ctx.fillRect(-hw, -2.2, hw * 2, 2.2);
    ctx.fillStyle = 'rgba(255,236,190,' + (0.25 + 0.55 * lit).toFixed(2) + ')';
    ctx.fillRect(-hw + 2, -3.0, hw * 2 - 4, 1.1);

    // ember cracks
    ctx.strokeStyle = 'rgba(255,140,60,' + (0.25 + 0.35 * lit).toFixed(2) + ')';
    ctx.lineWidth = 0.9;
    for (var c = 0; c < 2; c++) {
      var cx = -hw + hw * 2 * E.hashf(id, 30 + c);
      ctx.beginPath();
      ctx.moveTo(cx, 1);
      ctx.lineTo(cx + (E.hashf(id, 40 + c) - 0.5) * 8, th * 0.55);
      ctx.stroke();
    }

    // soot tufts
    ctx.strokeStyle = 'rgba(12,8,20,0.75)';
    ctx.lineWidth = 1.5;
    for (var s = 0; s < 3; s++) {
      var sx = -hw + hw * 2 * E.hashf(id, 50 + s);
      var sl = 3 + E.hashf(id, 60 + s) * 9;
      ctx.beginPath();
      ctx.moveTo(sx, th * 0.7);
      ctx.quadraticCurveTo(sx + 2, th * 0.7 + sl * 0.6, sx - 1, th * 0.7 + sl);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ rank seal */
  Art.rankSeal = function (ctx, x, y, r, tier, t) {
    var cols = [
      ['#6b5a52', '#9a857a'],
      ['#8a5a3c', '#d08a55'],
      ['#b4622a', '#ffa347'],
      ['#c9451c', '#ff8a3d'],
      ['#e0631a', '#ffd070'],
      ['#ffb03a', '#fff3c4']
    ][clamp(tier, 0, 5)];
    ctx.save();
    ctx.translate(x, y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.2);
    g.addColorStop(0, 'rgba(255,190,110,' + (0.1 + tier * 0.06) + ')');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.2, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.rotate(Math.sin(t * 0.8) * 0.03);
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU - Math.PI / 2;
      var px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var fg = ctx.createLinearGradient(0, -r, 0, r);
    fg.addColorStop(0, cols[1]);
    fg.addColorStop(1, cols[0]);
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,0.55)';
    ctx.lineWidth = r * 0.07;
    ctx.stroke();

    // inner flame mark, one per tier
    ctx.save();
    ctx.scale(r / 26, r / 26);
    ctx.fillStyle = 'rgba(28,14,24,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 13);
    ctx.bezierCurveTo(-11, 8, -9, -4, 0, -14);
    ctx.bezierCurveTo(9, -4, 11, 8, 0, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,190,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.bezierCurveTo(-6, 5, -5, -2, 0, -9);
    ctx.bezierCurveTo(5, -2, 6, 5, 0, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // pips for the tier
    for (var p2 = 0; p2 < tier; p2++) {
      var aa = -Math.PI / 2 + (p2 - (tier - 1) / 2) * 0.42;
      ctx.fillStyle = 'rgba(255,225,170,0.95)';
      ctx.beginPath();
      ctx.arc(Math.cos(aa) * r * 1.42, Math.sin(aa) * r * 1.42, r * 0.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------ glow pips */
  Art.drawPip = function (ctx, x, y, r, filled, t, phase) {
    ctx.save();
    ctx.translate(x, y);
    if (filled) {
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
      g.addColorStop(0, 'rgba(255,215,130,0.85)');
      g.addColorStop(0.4, 'rgba(255,150,50,0.35)');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      var pr = r * (0.92 + 0.08 * Math.sin(t * 5 + phase));
      var bg = ctx.createRadialGradient(-r * 0.2, -r * 0.25, 0, 0, 0, pr);
      bg.addColorStop(0, '#fffbe8');
      bg.addColorStop(0.5, P.emberB);
      bg.addColorStop(1, P.emberC);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,190,120,0.32)';
      ctx.lineWidth = r * 0.34;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  };

  E.Art = Art;
})();
