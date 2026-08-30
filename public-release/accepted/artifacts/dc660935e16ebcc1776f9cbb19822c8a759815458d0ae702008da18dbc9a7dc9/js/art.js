/* EMBER — the cast, drawn in code.
 *
 * Everything is drawn inside the world transform (y up, one unit = one world
 * unit) unless a function says otherwise. One palette, one shape language:
 * warm rounded flame forms for everything alive, cold flat curves for the damp,
 * chunky soot-crusted slabs for the flue.
 */
(function (E) {
  'use strict';

  var C = E.C;
  var psin = E.psin;

  var PAL = {
    ink: [12, 8, 16],
    stone: [58, 40, 56],
    stoneDark: [26, 17, 28],
    stoneLit: [96, 62, 74],
    emberHot: [255, 246, 214],
    ember: [255, 176, 68],
    emberDeep: [255, 96, 46],
    gold: [255, 222, 148],
    soot: [44, 34, 48],
    sootLit: [92, 78, 100],
    dust: [206, 190, 214],
    damp: [16, 74, 84],
    dampLit: [116, 232, 224],
    cold: [122, 176, 196]
  };

  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rr(ctx, x, y, w, h, r) {
    var rx = Math.min(r, Math.abs(w) / 2), ry = Math.min(r, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rx, y);
    ctx.lineTo(x + w - rx, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + (h > 0 ? ry : -ry));
    ctx.lineTo(x + w, y + h - (h > 0 ? ry : -ry));
    ctx.quadraticCurveTo(x + w, y + h, x + w - rx, y + h);
    ctx.lineTo(x + rx, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - (h > 0 ? ry : -ry));
    ctx.lineTo(x, y + (h > 0 ? ry : -ry));
    ctx.quadraticCurveTo(x, y, x + rx, y);
    ctx.closePath();
  }

  function glow(ctx, x, y, r, col, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(col, a));
    g.addColorStop(0.45, css(col, a * 0.35));
    g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.fill();
  }

  /* =================================================================== */
  /* the spark                                                            */
  /* =================================================================== */

  function flamePath(ctx, r, w, tipX, tipY) {
    ctx.beginPath();
    ctx.moveTo(-w, -0.3 * r);
    ctx.bezierCurveTo(-w * 1.18, 0.55 * r, -w * 0.6, tipY * 0.62, tipX, tipY);
    ctx.bezierCurveTo(w * 0.6, tipY * 0.62, w * 1.18, 0.55 * r, w, -0.3 * r);
    ctx.bezierCurveTo(w * 0.86, -1.08 * r, -w * 0.86, -1.08 * r, -w, -0.3 * r);
    ctx.closePath();
  }

  // o: { x, y, r, vx, vy, state, t, aimX, aimY, power, wall, dim }
  function drawSpark(ctx, o) {
    var r = o.r, t = o.t, st = o.state;
    var cold = st === 'taken' ? E.clamp(o.dim, 0, 1) : 0;
    var sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);

    var ang = 0, sx = 1, sy = 1;
    var bob = 0;

    if (st === 'flight' || st === 'panic') {
      ang = Math.atan2(o.vy, o.vx) - Math.PI / 2;
      var str = Math.min(0.5, sp / 620);
      sy = 1 + str; sx = 1 / (1 + str * 0.85);
      if (st === 'panic') { ang = psin(t * 2.1) * 0.22; sy = 1.04; sx = 0.98; }
    } else if (st === 'aim') {
      ang = Math.atan2(o.aimY, o.aimX) - Math.PI / 2;
      sy = 1 - 0.3 * o.power; sx = 1 + 0.26 * o.power;
    } else if (st === 'cling') {
      ang = (o.wall < 0 ? 0.34 : -0.34);
      sx = 1.18; sy = 0.9;
    } else if (st === 'burst') {
      ang = Math.atan2(o.vy, o.vx) - Math.PI / 2;
      sx = 1.3; sy = 1.3;
    } else if (st === 'taken') {
      sx = 1 - 0.5 * cold; sy = 1 - 0.5 * cold;
    } else {
      bob = psin(t * 0.55) * 0.16 * r;
      sy = 1 + psin(t * 0.55 + 0.25) * 0.05;
      sx = 1 / sy;
    }

    var cx = o.x, cy = o.y + bob;
    var hot = mix(PAL.emberHot, PAL.cold, cold * 0.85);
    var mid = mix(PAL.ember, PAL.cold, cold * 0.9);
    var deep = mix(PAL.emberDeep, PAL.damp, cold * 0.9);

    /* --- aura --- */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var flick = 0.85 + 0.15 * psin(t * 3.7 + 0.3);
    var auraR = r * (st === 'burst' ? 5.6 : 3.3) * flick * (1 - cold * 0.7);
    glow(ctx, cx, cy + r * 0.2, auraR, mid, (st === 'burst' ? 0.62 : 0.34) * (1 - cold * 0.8));
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(sx, sy);

    /* --- body --- */
    var w = r * 0.98;
    var tipY = r * (st === 'flight' ? 2.35 : 2.0) * (1 - cold * 0.4);
    var tipX = psin(t * 1.9) * r * 0.2 + (st === 'flight' ? 0 : psin(t * 0.9) * r * 0.08);

    var g = ctx.createRadialGradient(0, r * 0.15, r * 0.1, 0, r * 0.35, r * 2.1);
    g.addColorStop(0, css(hot, 1));
    g.addColorStop(0.34, css(mix(hot, mid, 0.75), 1));
    g.addColorStop(0.72, css(mid, 0.98));
    g.addColorStop(1, css(deep, 0.86));
    ctx.fillStyle = st === 'burst' ? css([255, 255, 250], 1) : g;
    flamePath(ctx, r, w, tipX, tipY);
    ctx.fill();

    // rim of soot so the silhouette reads against the bright aura
    ctx.strokeStyle = css(mix([120, 44, 26], PAL.damp, cold), 0.5);
    ctx.lineWidth = r * 0.1;
    ctx.stroke();

    // inner core
    ctx.fillStyle = css(mix([255, 253, 240], PAL.cold, cold), 0.85);
    flamePath(ctx, r * 0.52, w * 0.5, tipX * 0.4, tipY * 0.46);
    ctx.fill();
    ctx.restore();

    /* --- limbs: two ember wisps --- */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = css(mix(mid, PAL.cold, cold), 0.9);
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.2;
    var la, lb;
    if (st === 'cling') { la = o.wall < 0 ? 2.5 : 0.6; lb = o.wall < 0 ? 1.9 : 1.2; }
    else if (st === 'panic') { la = 2.3 + psin(t * 5) * 0.2; lb = 0.85 - psin(t * 5) * 0.2; }
    else if (st === 'flight') { la = 2.5; lb = 0.65; }
    else if (st === 'aim') { la = 2.0; lb = 1.15; }
    else if (st === 'burst') { la = 2.7; lb = 0.45; }
    else { la = 2.2 + psin(t * 0.9) * 0.12; lb = 0.95 - psin(t * 0.9) * 0.12; }
    var armR = r * (st === 'flight' ? 1.15 : 1.0);
    [la, lb].forEach(function (a) {
      var ox = Math.cos(a) * r * 0.82, oy = Math.sin(a) * r * 0.2 + r * 0.1;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.quadraticCurveTo(Math.cos(a) * armR * 1.25, oy + Math.sin(a) * armR * 0.75,
        Math.cos(a) * armR * 1.5, oy + Math.sin(a) * armR * 1.25);
      ctx.stroke();
    });
    ctx.restore();

    /* --- face --- */
    var faceTilt = 0;
    if (st === 'flight') { faceTilt = E.clamp(o.vx / 500, -0.3, 0.3); }
    else if (st === 'cling') { faceTilt = o.wall < 0 ? 0.2 : -0.2; }
    else if (st === 'aim') { faceTilt = E.clamp(-o.aimX * 0.28, -0.28, 0.28); }

    ctx.save();
    ctx.translate(cx, cy + r * 0.42);
    ctx.rotate(faceTilt);
    var eyeCol = css(mix([46, 18, 12], [12, 40, 48], cold), 0.92);
    var ex = r * 0.4, ey = 0;
    var look = 0, lookY = 0;
    var blink = 1;

    if (st === 'rest') {
      var cyc = t * 0.32;
      var f = cyc - Math.floor(cyc);
      blink = f > 0.94 ? 0.12 : 1;
      look = psin(t * 0.19) * 0.35;
    } else if (st === 'aim') {
      blink = 0.5; look = E.clamp(-o.aimX, -1, 1) * 0.4; lookY = E.clamp(-o.aimY, -1, 1) * 0.3;
    } else if (st === 'flight') {
      blink = 1.35; look = E.clamp(o.vx / 260, -1, 1) * 0.35; lookY = 0.2;
    } else if (st === 'panic') {
      blink = 1.6;
    } else if (st === 'cling') {
      blink = 0.42;
    } else if (st === 'taken') {
      blink = Math.max(0.06, 1 - cold * 1.4);
    }

    function eye(sgn) {
      var x = sgn * ex;
      if (st === 'burst') {
        // starry-eyed from the kick
        ctx.fillStyle = css([70, 26, 10], 0.9);
        ctx.save();
        ctx.translate(x, ey);
        ctx.beginPath();
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * 6.2832;
          var rad = (i % 2 === 0 ? r * 0.4 : r * 0.15);
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        return;
      }
      if (st === 'taken' && cold > 0.55) {
        ctx.strokeStyle = eyeCol;
        ctx.lineWidth = r * 0.12;
        ctx.lineCap = 'round';
        var s2 = r * 0.2;
        ctx.beginPath();
        ctx.moveTo(x - s2, ey - s2); ctx.lineTo(x + s2, ey + s2);
        ctx.moveTo(x + s2, ey - s2); ctx.lineTo(x - s2, ey + s2);
        ctx.stroke();
        return;
      }
      var rw = r * 0.25, rh = r * 0.29 * blink;
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(x, ey, rw, Math.max(r * 0.03, rh), 0, 0, 6.2832);
      ctx.fill();
      if (blink > 0.6) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(x + look * r * 0.16 + rw * 0.3, ey + lookY * r * 0.1 + rh * 0.3, r * 0.09, 0, 6.2832);
        ctx.fill();
      }
      // brow, angled by mood
      var browA = 0;
      if (st === 'aim') { browA = sgn * 0.5; }
      else if (st === 'cling') { browA = sgn * 0.75; }
      else if (st === 'panic') { browA = -sgn * 0.35; }
      if (browA !== 0) {
        ctx.strokeStyle = eyeCol;
        ctx.lineWidth = r * 0.11;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - r * 0.24, ey + r * 0.42 - browA * r * 0.12);
        ctx.lineTo(x + r * 0.24, ey + r * 0.42 + browA * r * 0.12);
        ctx.stroke();
      }
    }
    eye(-1); eye(1);

    // mouth
    var my = -r * 0.42;
    ctx.strokeStyle = eyeCol;
    ctx.fillStyle = eyeCol;
    ctx.lineWidth = r * 0.11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (st === 'flight' || st === 'burst') {
      ctx.ellipse(0, my - r * 0.05, r * 0.26, r * 0.22, 0, 0, 6.2832);
      ctx.fill();
    } else if (st === 'panic') {
      ctx.arc(0, my, r * 0.17, 0, 6.2832);
      ctx.fill();
    } else if (st === 'cling') {
      ctx.moveTo(-r * 0.22, my); ctx.lineTo(r * 0.22, my);
      ctx.stroke();
      ctx.lineWidth = r * 0.06;
      ctx.beginPath();
      ctx.moveTo(-r * 0.07, my - r * 0.07); ctx.lineTo(-r * 0.07, my + r * 0.07);
      ctx.moveTo(r * 0.09, my - r * 0.07); ctx.lineTo(r * 0.09, my + r * 0.07);
      ctx.stroke();
    } else if (st === 'aim') {
      ctx.moveTo(-r * 0.16, my - r * 0.03);
      ctx.quadraticCurveTo(0, my - r * 0.12, r * 0.16, my - r * 0.03);
      ctx.stroke();
    } else if (st === 'taken') {
      ctx.moveTo(-r * 0.14, my); ctx.lineTo(r * 0.14, my);
      ctx.stroke();
    } else {
      ctx.moveTo(-r * 0.2, my + r * 0.06);
      ctx.quadraticCurveTo(0, my - r * 0.14, r * 0.2, my + r * 0.06);
      ctx.stroke();
    }
    ctx.restore();

    /* --- strain sparks while clinging --- */
    if (st === 'cling') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 3; i++) {
        var f2 = ((t * 1.4 + i * 0.33) % 1);
        var yy = cy + r * 1.2 - f2 * r * 3.2;
        glow(ctx, cx + o.wall * r * 0.7, yy, r * 0.5, PAL.ember, 0.4 * (1 - f2));
      }
      ctx.restore();
    }
  }

  /* =================================================================== */
  /* soot-moth                                                            */
  /* =================================================================== */

  function drawMoth(ctx, m, t, hi) {
    var r = C.MOTH_R;
    var flap = psin(t * 2.35 + m.phase * 6.283);
    var open = 0.52 + 0.48 * Math.abs(flap);
    var tilt = E.clamp((m.x - m.bx) / Math.max(1, m.amp) * -0.28, -0.3, 0.3);
    var bobA = psin(t * 1.1 + m.phase * 3.1) * 0.12;

    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(tilt + bobA);

    // dusty aura so it reads against the dark
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, r * 2.0, PAL.dust, 0.09 + (hi ? 0.06 : 0));
    ctx.restore();

    var wingLit = mix(PAL.sootLit, PAL.dust, 0.22);

    function wingPair(sgn) {
      ctx.save();
      ctx.scale(sgn * open, 1);

      // hindwing, behind
      ctx.fillStyle = css(mix(PAL.soot, PAL.sootLit, 0.25), 0.95);
      ctx.beginPath();
      ctx.moveTo(r * 0.08, r * 0.05);
      ctx.bezierCurveTo(r * 0.75, -r * 0.35, r * 1.05, -r * 0.8, r * 0.5, -r * 0.92);
      ctx.bezierCurveTo(r * 0.2, -r * 0.98, r * 0.04, -r * 0.45, r * 0.08, r * 0.05);
      ctx.closePath();
      ctx.fill();

      // forewing: a broad swept leaf, pale enough to read in the dark
      var wg = ctx.createLinearGradient(0, 0, r * 1.6, r * 0.4);
      wg.addColorStop(0, css(mix(PAL.soot, wingLit, 0.35), 0.98));
      wg.addColorStop(0.55, css(wingLit, 0.96));
      wg.addColorStop(1, css(mix(wingLit, PAL.dust, 0.5), 0.9));
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.moveTo(r * 0.06, r * 0.3);
      ctx.bezierCurveTo(r * 0.85, r * 0.72, r * 1.62, r * 0.62, r * 1.5, r * 0.12);
      ctx.bezierCurveTo(r * 1.4, -r * 0.32, r * 0.7, -r * 0.52, r * 0.06, -r * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = css(PAL.dust, 0.4);
      ctx.lineWidth = r * 0.05;
      ctx.stroke();

      // markings: a vein and two soot eye-spots
      ctx.strokeStyle = css(mix(PAL.soot, PAL.ink, 0.4), 0.5);
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(r * 0.16, r * 0.1);
      ctx.quadraticCurveTo(r * 0.8, r * 0.3, r * 1.42, r * 0.16);
      ctx.stroke();
      ctx.fillStyle = css(mix(PAL.soot, PAL.ink, 0.45), 0.55);
      ctx.beginPath();
      ctx.arc(r * 0.92, r * 0.34, r * 0.15, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 1.22, r * 0.08, r * 0.09, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    wingPair(-1); wingPair(1);

    // furry body
    var bg = ctx.createLinearGradient(-r * 0.3, 0, r * 0.3, 0);
    bg.addColorStop(0, css(mix(PAL.soot, PAL.ink, 0.5), 1));
    bg.addColorStop(0.45, css(mix(PAL.soot, PAL.sootLit, 0.4), 1));
    bg.addColorStop(1, css(mix(PAL.soot, PAL.ink, 0.55), 1));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.14, r * 0.27, r * 0.62, 0, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = css(PAL.dust, 0.32);
    ctx.lineWidth = r * 0.05;
    for (var i = 0; i < 5; i++) {
      var yy = -r * 0.62 + i * r * 0.24;
      ctx.beginPath();
      ctx.moveTo(-r * 0.24, yy);
      ctx.lineTo(-r * 0.44, yy + r * 0.08);
      ctx.moveTo(r * 0.24, yy);
      ctx.lineTo(r * 0.44, yy + r * 0.08);
      ctx.stroke();
    }
    // fuzzy head and collar
    ctx.fillStyle = css(mix(PAL.soot, PAL.sootLit, 0.45), 1);
    ctx.beginPath();
    ctx.arc(0, r * 0.5, r * 0.26, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = css(mix(PAL.sootLit, PAL.dust, 0.3), 0.55);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 0.3, r * 0.12, 0, 0, 6.2832);
    ctx.fill();
    // antennae
    ctx.strokeStyle = css(PAL.sootLit, 0.9);
    ctx.lineWidth = r * 0.055;
    ctx.lineCap = 'round';
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.1, r * 0.66);
      ctx.quadraticCurveTo(s * r * 0.45, r * 1.05, s * r * 0.28, r * 1.28);
      ctx.stroke();
      ctx.fillStyle = css(PAL.dust, 0.7);
      ctx.beginPath();
      ctx.arc(s * r * 0.28, r * 1.28, r * 0.07, 0, 6.2832);
      ctx.fill();
    }
    // ember eyes: small, but they are what makes it alive
    ctx.fillStyle = css([28, 16, 20], 0.9);
    for (var e2 = -1; e2 <= 1; e2 += 2) {
      ctx.beginPath();
      ctx.arc(e2 * r * 0.12, r * 0.55, r * 0.1, 0, 6.2832);
      ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var e = -1; e <= 1; e += 2) {
      glow(ctx, e * r * 0.12, r * 0.55, r * 0.15, PAL.ember, 0.5);
    }
    ctx.restore();
    ctx.restore();
  }

  /* =================================================================== */
  /* glimmer                                                              */
  /* =================================================================== */

  // A small cut gem of trapped firelight. Kept deliberately compact: a prize
  // has to be desirable without blowing out the read of the flue behind it.
  function drawGlimmer(ctx, g, t) {
    var r = C.GLIMMER_R;
    var pulse = 0.9 + 0.1 * psin(t * 0.85 + g.phase * 6.283);
    var spin = t * 0.1 + g.phase;

    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, r * 2.1 * pulse, PAL.gold, 0.2);

    ctx.save();
    ctx.rotate(spin * 6.283);
    function star(len, wid, col, a) {
      ctx.fillStyle = css(col, a);
      ctx.beginPath();
      ctx.moveTo(0, len); ctx.lineTo(wid, 0); ctx.lineTo(0, -len); ctx.lineTo(-wid, 0);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(len, 0); ctx.lineTo(0, wid); ctx.lineTo(-len, 0); ctx.lineTo(0, -wid);
      ctx.closePath(); ctx.fill();
    }
    star(r * 1.5 * pulse, r * 0.2, PAL.gold, 0.34);
    ctx.rotate(0.785);
    star(r * 0.8 * pulse, r * 0.14, [255, 250, 226], 0.3);
    ctx.restore();

    // faceted core: two lit facets and two in shade, so it reads as cut stone
    var cr = r * 0.62 * pulse;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css([255, 250, 226], 0.98);
    ctx.beginPath();
    ctx.moveTo(0, cr * 1.25);
    ctx.lineTo(cr * 0.72, 0);
    ctx.lineTo(0, -cr * 1.25);
    ctx.lineTo(-cr * 0.72, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(mix(PAL.gold, PAL.emberDeep, 0.35), 0.9);
    ctx.beginPath();
    ctx.moveTo(0, cr * 1.25);
    ctx.lineTo(cr * 0.72, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(PAL.gold, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, -cr * 1.25);
    ctx.lineTo(-cr * 0.72, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 2; i++) {
      var a = (t * 0.26 + i / 2 + g.phase) * 6.2832;
      var rad = r * (1.15 + 0.18 * psin(t * 0.7 + i));
      glow(ctx, Math.cos(a) * rad, psin(t * 0.26 + i / 2 + g.phase) * rad * 0.45,
        r * 0.26, [255, 244, 206], 0.45);
    }
    ctx.restore();
  }

  /* =================================================================== */
  /* ledge                                                                */
  /* =================================================================== */

  function drawLedge(ctx, L, t) {
    var hw = L.hw, h = C.LEDGE_HT * 2;
    var top = L.y + C.LEDGE_HT;
    var x0 = L.x - hw, w = hw * 2;
    var touchL = x0 <= C.WALL_L + 0.6;
    var touchR = L.x + hw >= C.WALL_R - 0.6;

    // bracket into the wall
    if (touchL || touchR) {
      ctx.fillStyle = css(PAL.stoneDark, 1);
      var bx = touchL ? C.WALL_L - 3 : C.WALL_R - 3;
      rr(ctx, bx, top - h * 1.5, 6, h * 1.5, 0.8);
      ctx.fill();
    }

    // slab
    var g = ctx.createLinearGradient(0, top, 0, top - h * 1.6);
    g.addColorStop(0, css(PAL.stoneLit, 1));
    g.addColorStop(0.28, css(PAL.stone, 1));
    g.addColorStop(1, css(PAL.stoneDark, 1));
    ctx.fillStyle = g;
    rr(ctx, x0, top, w, -h, Math.min(1.5, hw * 0.3));
    ctx.fill();

    // soot underside drips
    ctx.fillStyle = css(mix(PAL.stoneDark, PAL.ink, 0.5), 0.9);
    var n = Math.max(2, Math.round(hw / 3.2));
    for (var i = 0; i < n; i++) {
      var hx = E.hashf(L.id * 71 + i * 13);
      var dx = x0 + 1.2 + (w - 2.4) * (i + 0.5) / n + (hx - 0.5) * 1.4;
      var dl = 1.0 + hx * 3.2;
      ctx.beginPath();
      ctx.moveTo(dx - 0.7, top - h + 0.2);
      ctx.quadraticCurveTo(dx, top - h - dl, dx + 0.7, top - h + 0.2);
      ctx.closePath();
      ctx.fill();
    }

    // the landable crust: a warm ember line that says "stand here"
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var lg = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    lg.addColorStop(0, css(PAL.emberDeep, 0.15));
    lg.addColorStop(0.5, css(PAL.ember, 0.5));
    lg.addColorStop(1, css(PAL.emberDeep, 0.15));
    ctx.fillStyle = lg;
    ctx.fillRect(x0 + 0.3, top - 0.75, w - 0.6, 0.75);

    var cn = Math.max(2, Math.round(hw / 2.6));
    for (var j = 0; j < cn; j++) {
      var h2 = E.hashf(L.id * 977 + j * 31);
      var f = ((t * (0.25 + h2 * 0.4) + h2) % 1);
      var a = 0.28 + 0.5 * Math.abs(psin(f));
      glow(ctx, x0 + 1 + (w - 2) * h2, top + 0.25, 1.5 + h2, PAL.ember, a * 0.75);
    }
    ctx.restore();

    // top highlight edge
    ctx.strokeStyle = css(PAL.stoneLit, 0.75);
    ctx.lineWidth = 0.28;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, top - 0.06);
    ctx.lineTo(x0 + w - 0.5, top - 0.06);
    ctx.stroke();
  }

  E.Art = {
    PAL: PAL,
    css: css,
    mix: mix,
    rr: rr,
    glow: glow,
    drawSpark: drawSpark,
    drawMoth: drawMoth,
    drawGlimmer: drawGlimmer,
    drawLedge: drawLedge
  };

})(window.EMBER);
