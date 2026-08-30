/* DELVE — presentation layer.
 *
 * Everything here is view-only dressing. It reads simulation state, it never
 * writes it. Particles may use Math.random freely because nothing they do
 * can reach a snapshot or a collision.
 *
 * One identity: deep violet earth, warm amber mineral light, a mint-green
 * machine. Shape language is chiselled facets and soft round hulls.
 */
(function () {
  var D = window.DELVE;
  var S = D.state;
  var K = D.K;
  var SIM = D.sim;
  var H = D.rng.hash;

  var TAU = Math.PI * 2;

  var C = {
    void0: '#05040c', void1: '#0d0817',
    earth0: '#1c1226', earth1: '#2b1c38', earth2: '#120b1b',
    strata: ['#3a2748', '#241633', '#432d50', '#1d1129', '#513462'],
    vein: '#8c5fb0',
    cav0: '#0a0713', cav1: '#150d20',
    rim: '#ffa955', rimHot: '#ff6a3d',
    rock0: '#7a6b8f', rock1: '#4a3d5c', rock2: '#2d2440', rockLite: '#a89bbd',
    frag: '#ffd166', fragHot: '#fff3c4',
    power: '#ff5fd2', power2: '#8f6bff',
    hull0: '#68f5da', hull1: '#22a79f', hull2: '#0d5d6b',
    ink: '#07222b',
    lamp: '#ffe2a8',
    ui: '#e8e2f5', uiDim: '#8d82a8',
    good: '#7ef0c8', warn: '#ffb347', bad: '#ff5d6c'
  };

  var V = {
    t: 0, dpr: 1,
    zoom: 1, playerYF: 0.26,
    shake: 0, shx: 0, shy: 0,
    flash: 0, flashCol: 'rgba(255,255,255,',
    lastSeq: 0,
    parts: [], pops: [], trail: [], motes: [],
    grazeT: 0, grazeSide: 0, grazeAmt: 0, grazeCombo: 0,
    crashT: 0, crashDir: 0,
    powerFlash: 0,
    blink: 0, blinkNext: 1.6,
    ant: { x: 0, v: 0 },
    edgeHold: 0,
    best: 0, bestBeaten: false,
    endT: 0, startFlare: 0,
    padFall: 0,
    tickAt: -1,
    hintSteer: 0, shownSteer: false,
    hintPower: 0, shownPower: false,
    readyT: 0,
    stage: { x: 0, y: 0, w: 1, h: 1 },
    insets: { t: 0, r: 0, b: 0, l: 0 },
    base: 1, scale: 1, ox: 0, oy: 0,
    stick: null,
    prevPhase: 'ready',
    lastSig: null
  };
  D.view = V;

  /* --------------------------------------------------------------- helpers */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function fmt(n) {
    n = Math.floor(n);
    var s = '' + n, out = '', c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s[i] + out; c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  }

  function font(ctx, weight, px, ls) {
    ctx.font = weight + ' ' + px.toFixed(1) + 'px "Trebuchet MS", "Avenir Next", system-ui, -apple-system, sans-serif';
    try { ctx.letterSpacing = (ls || 0).toFixed(1) + 'px'; } catch (e) { }
  }

  function sx(x) { return V.ox + x * V.scale + V.shx; }
  function sy(d) { return V.oy + (d - S.depth) * V.scale + V.shy; }
  function dAt(py) { return S.depth + (py - V.oy - V.shy) / V.scale; }

  /* ------------------------------------------------------------- particles */

  function part(o) { if (V.parts.length < 460) V.parts.push(o); }

  function spark(x, d, n, col, spd, life, size) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), s = rnd(spd * 0.35, spd);
      part({
        k: 's', x: x, d: d, vx: Math.cos(a) * s, vd: Math.sin(a) * s,
        l: rnd(life * 0.55, life), m: life, c: col, r: rnd(size * 0.5, size), g: 0
      });
    }
  }

  function shards(x, d, n, radius, col) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), s = rnd(60, 240);
      var pts = [];
      for (var j = 0; j < 4; j++) pts.push({ a: j / 4 * TAU + rnd(-0.3, 0.3), r: rnd(0.4, 1) });
      part({
        k: 'f', x: x + Math.cos(a) * radius * 0.4, d: d + Math.sin(a) * radius * 0.4,
        vx: Math.cos(a) * s, vd: Math.sin(a) * s - 30,
        rot: rnd(0, TAU), vr: rnd(-7, 7),
        l: rnd(0.5, 1.0), m: 1.0, c: col, r: rnd(radius * 0.16, radius * 0.4), g: 300
      });
    }
  }

  function ring(x, d, r0, r1, col, life, w) {
    part({ k: 'r', x: x, d: d, r0: r0, r1: r1, l: life, m: life, c: col, w: w || 2 });
  }

  function pop(x, d, str, col, size) {
    V.pops.push({ x: x, d: d, s: str, c: col, l: 0.95, m: 0.95, sz: size || 13 });
    if (V.pops.length > 14) V.pops.shift();
  }

  function updateParts(dt) {
    var i, p;
    for (i = V.parts.length - 1; i >= 0; i--) {
      p = V.parts[i];
      p.l -= dt;
      if (p.l <= 0) { V.parts.splice(i, 1); continue; }
      if (p.k === 'r') continue;
      p.x += p.vx * dt; p.d += p.vd * dt;
      if (p.g) p.vd += p.g * dt;
      p.vx *= (1 - 1.6 * dt); p.vd *= (1 - 1.6 * dt);
      if (p.k === 'f') p.rot += p.vr * dt;
      if (p.d < S.depth - 420) { V.parts.splice(i, 1); }
    }
    for (i = V.pops.length - 1; i >= 0; i--) {
      p = V.pops[i]; p.l -= dt; p.d -= 34 * dt;
      if (p.l <= 0) V.pops.splice(i, 1);
    }
  }

  function drawParts(ctx) {
    var i, p, a;
    ctx.save();
    for (i = 0; i < V.parts.length; i++) {
      p = V.parts[i];
      a = p.l / p.m;
      var px = sx(p.x), py = sy(p.d);
      if (py < -80 || py > V.stage.h + 80) continue;
      if (p.k === 's') {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.c;
        var rr2 = p.r * V.scale * (0.4 + 0.6 * a);
        ctx.beginPath(); ctx.arc(px, py, Math.max(0.5, rr2), 0, TAU); ctx.fill();
      } else if (p.k === 'f') {
        ctx.globalAlpha = a;
        ctx.save(); ctx.translate(px, py); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        for (var j = 0; j < 4; j++) {
          var ang = j / 4 * TAU, rad = p.r * V.scale * (0.6 + 0.4 * ((j % 2) ? 1 : 0.6));
          if (j === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
          else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (p.k === 'r') {
        var t = 1 - a;
        ctx.globalAlpha = a * a;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = p.w * V.scale * a;
        ctx.beginPath();
        ctx.arc(px, py, (p.r0 + (p.r1 - p.r0) * ease(t)) * V.scale, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPops(ctx) {
    for (var i = 0; i < V.pops.length; i++) {
      var p = V.pops[i], a = clamp(p.l / p.m, 0, 1);
      var px = sx(p.x), py = sy(p.d);
      ctx.save();
      ctx.globalAlpha = a * a;
      var s = p.sz * V.base * (1 + 0.35 * (1 - a));
      font(ctx, '700', s, 0.5);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, s * 0.22); ctx.strokeStyle = 'rgba(6,4,14,0.85)';
      ctx.strokeText(p.s, px, py);
      ctx.fillStyle = p.c;
      ctx.fillText(p.s, px, py);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------ background */

  function drawBackdrop(ctx, cw, ch) {
    var g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, C.void1); g.addColorStop(1, C.void0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
  }

  /* Layered earth behind the corridor: three parallax depths + veins. */
  function drawEarth(ctx, st) {
    var g = ctx.createLinearGradient(0, 0, 0, st.h);
    g.addColorStop(0, C.earth1); g.addColorStop(0.55, C.earth0); g.addColorStop(1, C.earth2);
    ctx.fillStyle = g; ctx.fillRect(st.x, 0, st.w, st.h);

    var layers = [
      { p: 0.28, band: 74, a: 0.30, w: 1.0 },
      { p: 0.55, band: 46, a: 0.26, w: 0.7 },
      { p: 0.86, band: 28, a: 0.22, w: 0.45 }
    ];
    ctx.save();
    ctx.beginPath(); ctx.rect(st.x, 0, st.w, st.h); ctx.clip();
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var off = S.depth * L.p;
      var b0 = Math.floor((off - 200 / V.scale) / L.band);
      var b1 = Math.ceil((off + (st.h + 200) / V.scale) / L.band);
      for (var b = b0; b <= b1; b++) {
        var h1 = H(b * 7919 + li * 131);
        var yy = V.oy + (b * L.band - off) * V.scale + V.shy * L.p;
        var hh = L.band * V.scale * (0.35 + 0.6 * h1);
        if (yy > st.h + 60 || yy + hh < -60) continue;
        ctx.fillStyle = C.strata[Math.floor(h1 * C.strata.length) % C.strata.length];
        ctx.globalAlpha = L.a * (0.5 + 0.5 * H(b * 3301 + li));
        var skew = (H(b * 51 + li * 7) - 0.5) * st.w * 0.5;
        ctx.fillRect(st.x - 40 + skew * 0.3, yy, st.w + 80, hh);
      }
      // mineral veins
      ctx.globalAlpha = 0.14 * L.w;
      ctx.strokeStyle = C.vein;
      ctx.lineWidth = Math.max(1, 2.2 * V.base * L.w);
      for (var v = b0; v <= b1; v += 3) {
        var hv = H(v * 12345 + li * 77);
        if (hv > 0.42) continue;
        var vy = V.oy + (v * L.band - off) * V.scale;
        var vx0 = st.x + hv * st.w * 2.2 - st.w * 0.3;
        ctx.beginPath();
        ctx.moveTo(vx0, vy);
        ctx.quadraticCurveTo(vx0 + st.w * 0.18, vy + L.band * V.scale * 1.2,
          vx0 + st.w * (0.06 + hv * 0.3), vy + L.band * V.scale * 2.4);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------------------------------------------------------- the corridor */

  function corridorSamples(st) {
    var out = [];
    var top = -70, bot = st.h + 70;
    for (var py = top; py <= bot; py += 13) {
      var d = dAt(py);
      var c = SIM.centerXAt(S, d), h = SIM.halfW(S, d);
      out.push({ y: py, d: d, l: c - h, r: c + h });
    }
    return out;
  }

  function drawCorridor(ctx, st, samp, sN) {
    var i;
    // the dug-out void
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx(samp[0].l), samp[0].y);
    for (i = 1; i < samp.length; i++) ctx.lineTo(sx(samp[i].l), samp[i].y);
    for (i = samp.length - 1; i >= 0; i--) ctx.lineTo(sx(samp[i].r), samp[i].y);
    ctx.closePath();
    ctx.clip();

    var g = ctx.createLinearGradient(0, 0, 0, st.h);
    g.addColorStop(0, C.cav0); g.addColorStop(0.5, C.cav1); g.addColorStop(1, C.cav0);
    ctx.fillStyle = g; ctx.fillRect(st.x - 20, -10, st.w + 40, st.h + 20);

    // drill grooves — scroll at 1x, sell the machine's own passage
    var step = 42;
    var d0 = Math.floor((S.depth - 260 / V.scale) / step) * step;
    var d1 = S.depth + (st.h + 100) / V.scale;
    ctx.lineWidth = Math.max(1, 1.6 * V.base);
    for (var d = d0; d < d1; d += step) {
      var yy = sy(d);
      var cxv = SIM.centerXAt(S, d), hw = SIM.halfW(S, d);
      ctx.globalAlpha = 0.05 + 0.05 * H(Math.floor(d / step) * 991);
      ctx.strokeStyle = '#6a4f86';
      ctx.beginPath();
      ctx.moveTo(sx(cxv - hw), yy);
      ctx.quadraticCurveTo(sx(cxv), yy + 9 * V.scale, sx(cxv + hw), yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function wallEdge(ctx, st, samp, side, sN, dangerT) {
    var i, pts = [];
    for (i = 0; i < samp.length; i++) {
      var x = side < 0 ? samp[i].l : samp[i].r;
      pts.push({ x: sx(x), y: samp[i].y, wx: x });
    }
    // solid earth beyond the wall, with a chiselled bite pattern (outward only,
    // so the drawn edge is never nearer than the real collision line)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) {
      var bite = H(Math.floor(samp[i].d / 21) * 613 + (side < 0 ? 5 : 91));
      var px = pts[i].x - side * bite * 7 * V.base;
      ctx.lineTo(px, pts[i].y);
    }
    var far = side < 0 ? st.x - 60 : st.x + st.w + 60;
    ctx.lineTo(far, pts[pts.length - 1].y);
    ctx.lineTo(far, pts[0].y);
    ctx.closePath();
    ctx.clip();

    var gg = ctx.createLinearGradient(far, 0, pts[0].x, 0);
    gg.addColorStop(0, 'rgba(10,6,18,0.0)');
    gg.addColorStop(1, 'rgba(10,6,18,0.55)');
    ctx.fillStyle = gg;
    ctx.fillRect(st.x - 60, -10, st.w + 120, st.h + 20);
    ctx.restore();

    // rim light along the true boundary
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    var hot = clamp(dangerT, 0, 1);
    ctx.strokeStyle = hot > 0.02 ? C.rimHot : C.rim;
    ctx.globalAlpha = 0.30 + 0.36 * sN + 0.3 * hot;
    ctx.lineWidth = Math.max(1.6, (2.0 + 2.4 * sN + 3 * hot) * V.base);
    ctx.shadowColor = hot > 0.02 ? C.rimHot : C.rim;
    ctx.shadowBlur = (9 + 16 * sN + 22 * hot) * V.base;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // inner sheen
    ctx.globalAlpha = 0.10 + 0.14 * sN;
    ctx.strokeStyle = '#ffd9a8';
    ctx.lineWidth = Math.max(1, 1.1 * V.base);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* -------------------------------------------------------------- entities */

  function drawRock(ctx, o, sN) {
    var px = sx(o.x), py = sy(o.depth);
    if (py < -90 || py > V.stage.h + 90) return;
    var R = o.vr * V.scale;
    var n = parseInt(o.id.slice(1), 10);
    var sides = 7 + Math.floor(H(n * 3) * 3);
    var spin = H(n * 11) * TAU;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(spin);

    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = i / sides * TAU;
      var rad = R * (0.76 + 0.30 * H(n * 97 + i * 17));
      var x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.94;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    var g = ctx.createLinearGradient(-R, -R, R * 0.6, R);
    g.addColorStop(0, C.rock0); g.addColorStop(0.5, C.rock1); g.addColorStop(1, C.rock2);
    ctx.fillStyle = g; ctx.fill();

    ctx.lineWidth = Math.max(1.2, 2.0 * V.base);
    ctx.strokeStyle = '#1a1328';
    ctx.stroke();

    // top-left facet catches the machine's lamp
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = C.rockLite;
    ctx.beginPath();
    ctx.moveTo(-R, -R); ctx.lineTo(R * 0.25, -R); ctx.lineTo(-R * 0.55, R * 0.35); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#120c1e';
    ctx.beginPath();
    ctx.moveTo(R, R); ctx.lineTo(-R * 0.2, R); ctx.lineTo(R * 0.7, -R * 0.25); ctx.closePath();
    ctx.fill();
    // crack line on big rocks
    if (o.vr > 21) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = '#1c1430';
      ctx.lineWidth = Math.max(1, 1.8 * V.base);
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, -R * 0.5);
      ctx.lineTo(-R * 0.05, R * 0.05);
      ctx.lineTo(R * 0.35, -R * 0.15);
      ctx.lineTo(R * 0.6, R * 0.6);
      ctx.stroke();
    }
    ctx.restore();

    // mineral specks — the family resemblance to fragments
    for (var s = 0; s < 2; s++) {
      var ha = H(n * 401 + s * 7) * TAU, hr = R * (0.15 + 0.4 * H(n * 601 + s));
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = s ? '#c8a2ff' : C.frag;
      ctx.beginPath();
      var cxp = Math.cos(ha) * hr, cyp = Math.sin(ha) * hr, sr = Math.max(1, R * 0.09);
      ctx.moveTo(cxp, cyp - sr); ctx.lineTo(cxp + sr, cyp);
      ctx.lineTo(cxp, cyp + sr); ctx.lineTo(cxp - sr, cyp);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawFragment(ctx, o, t) {
    var px = sx(o.x), py = sy(o.depth);
    if (py < -60 || py > V.stage.h + 60) return;
    var wave = Math.sin(t * 3.4 - (o.formationIndex || 0) * 0.55);
    var R = o.vr * V.scale * (1 + 0.10 * wave);
    var rot = t * 1.5 + (o.formationIndex || 0) * 0.4;

    ctx.save();
    ctx.translate(px, py + wave * 1.6 * V.base);

    ctx.globalAlpha = 0.30 + 0.14 * wave;
    var gg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 3.4);
    gg.addColorStop(0, 'rgba(255,209,102,0.75)');
    gg.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, R * 3.4, 0, TAU); ctx.fill();

    ctx.globalAlpha = 1;
    ctx.rotate(rot);
    // faceted crystal
    ctx.beginPath();
    ctx.moveTo(0, -R * 1.25); ctx.lineTo(R * 0.82, 0);
    ctx.lineTo(0, R * 1.25); ctx.lineTo(-R * 0.82, 0);
    ctx.closePath();
    var g2 = ctx.createLinearGradient(-R, -R, R, R);
    g2.addColorStop(0, C.fragHot); g2.addColorStop(0.45, C.frag); g2.addColorStop(1, '#e08b2f');
    ctx.fillStyle = g2; ctx.fill();
    ctx.strokeStyle = 'rgba(255,246,214,0.85)';
    ctx.lineWidth = Math.max(1, 1.3 * V.base);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -R * 1.25); ctx.lineTo(-R * 0.82, 0); ctx.lineTo(0, R * 0.25); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
    ctx.restore();
  }

  function drawPowerItem(ctx, o, t) {
    var px = sx(o.x), py = sy(o.depth);
    if (py < -80 || py > V.stage.h + 80) return;
    var R = o.vr * V.scale;
    var pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.save();
    ctx.translate(px, py);

    ctx.globalAlpha = 0.55 + 0.25 * pulse;
    var gg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 4.2);
    gg.addColorStop(0, 'rgba(255,95,210,0.8)');
    gg.addColorStop(0.5, 'rgba(143,107,255,0.32)');
    gg.addColorStop(1, 'rgba(143,107,255,0)');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(0, 0, R * 4.2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    // orbit ring
    ctx.save();
    ctx.rotate(t * 1.1);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, 1.6 * V.base);
    ctx.beginPath(); ctx.ellipse(0, 0, R * 2.0, R * 0.72, 0, 0, TAU); ctx.stroke();
    ctx.restore();

    ctx.rotate(-t * 1.7);
    ctx.beginPath();
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * TAU;
      var rad = R * ((i % 2) ? 0.52 : 1.15 + 0.1 * pulse);
      var x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.2);
    g2.addColorStop(0, '#fff0ff'); g2.addColorStop(0.4, C.power); g2.addColorStop(1, C.power2);
    ctx.fillStyle = g2; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1, 1.2 * V.base);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------- MOLE-9, the machine
   * A drill-pod with a visor face. Everything about it is expressive:
   * squash/stretch, brows, pupils, mouth, lamp, antenna lag, exhaust.
   */

  function drawEye(ctx, x, y, rx, ry, m, side) {
    ctx.save();
    ctx.translate(x, y);
    if (m.eye === 'x') {
      ctx.strokeStyle = '#0b1f2a';
      ctx.lineWidth = 2.0; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.8, -ry * 0.8); ctx.lineTo(rx * 0.8, ry * 0.8);
      ctx.moveTo(rx * 0.8, -ry * 0.8); ctx.lineTo(-rx * 0.8, ry * 0.8);
      ctx.stroke();
      ctx.restore(); return;
    }
    if (m.eye === 'closed') {
      ctx.strokeStyle = '#e7fbff';
      ctx.lineWidth = 1.7; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.85, 0);
      ctx.quadraticCurveTo(0, m.happyClose ? -ry * 0.9 : ry * 0.85, rx * 0.85, 0);
      ctx.stroke();
      ctx.restore(); return;
    }

    var open = clamp(m.open, 0.06, 1);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry * open, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = '#f2fdff';
    ctx.fillRect(-rx - 1, -ry - 1, rx * 2 + 2, ry * 2 + 2);

    var px = m.pupilX * rx * 0.42, py = m.pupilY * ry * 0.42;
    if (m.eye === 'star') {
      ctx.fillStyle = '#ff4fbf';
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = i / 8 * TAU - Math.PI / 2;
        var rad = (i % 2) ? rx * 0.22 : rx * 0.62;
        var xx = px + Math.cos(a) * rad, yy = py + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.closePath(); ctx.fill();
    } else {
      var pr = rx * (m.eye === 'wide' ? 0.34 : 0.50);
      ctx.fillStyle = '#0c2230';
      ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 1.06, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.arc(px - pr * 0.34, py - pr * 0.42, pr * 0.34, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // lid line for determined squint
    if (m.lid > 0.01) {
      ctx.fillStyle = C.ink;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(0, 0, rx + 0.6, ry + 0.6, 0, 0, TAU); ctx.clip();
      ctx.fillRect(-rx - 1, -ry - 1, rx * 2 + 2, (ry * 2 + 2) * m.lid * 0.62);
      ctx.restore();
    }

    // brow
    if (m.brow !== 0 || m.eye === 'determined') {
      ctx.save();
      ctx.translate(0, -ry * 1.35);
      ctx.rotate(m.brow * side);
      ctx.fillStyle = '#0a3a44';
      rr(ctx, -rx * 0.95, -0.9, rx * 1.9, 1.8, 0.9);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawMouth(ctx, m) {
    ctx.save();
    ctx.translate(0, 4.6);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var w = 5.0 * m.mouthW;
    if (m.mouth === 'grin') {
      ctx.fillStyle = '#0c2230';
      ctx.beginPath();
      ctx.moveTo(-w, -1.0);
      ctx.quadraticCurveTo(0, 3.2 * m.mouthH, w, -1.0);
      ctx.quadraticCurveTo(0, 0.6, -w, -1.0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff7f9e';
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, 1.0);
      ctx.quadraticCurveTo(0, 3.0 * m.mouthH, w * 0.5, 1.0);
      ctx.closePath(); ctx.fill();
    } else if (m.mouth === 'o') {
      ctx.fillStyle = '#0c2230';
      ctx.beginPath();
      ctx.ellipse(0, 0.4, w * 0.60, Math.min(3.1, 1.5 + 1.4 * m.mouthH), 0, 0, TAU);
      ctx.fill();
    } else if (m.mouth === 'wave') {
      ctx.strokeStyle = '#0c2230'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.lineTo(-w * 0.5, -1.4); ctx.lineTo(0, 0.4);
      ctx.lineTo(w * 0.5, -1.4); ctx.lineTo(w, 0);
      ctx.stroke();
    } else if (m.mouth === 'flat') {
      ctx.strokeStyle = '#0c2230'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-w * 0.7, 0); ctx.lineTo(w * 0.7, 0); ctx.stroke();
    } else { // smile
      ctx.strokeStyle = '#0c2230'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.75, -0.5);
      ctx.quadraticCurveTo(0, 2.2 * m.mouthH, w * 0.75, -0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMachine(ctx, m) {
    ctx.save();
    ctx.translate(sx(S.x), sy(S.depth));
    ctx.scale(V.scale, V.scale);
    ctx.globalAlpha = m.alpha;

    // --- lamp cone, cast ahead into the dark ---
    if (m.lamp > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.13 * m.lamp * m.alpha;
      var lg = ctx.createLinearGradient(0, 12, 0, 12 + 86);
      lg.addColorStop(0, 'rgba(255,226,168,0.95)');
      lg.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(-5, 12);
      ctx.lineTo(-30 - 12 * m.lamp, 12 + 92);
      ctx.lineTo(30 + 12 * m.lamp, 12 + 92);
      ctx.lineTo(5, 12);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // --- overdrive aura ---
    if (m.aura > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * m.aura;
      var ag = ctx.createRadialGradient(0, -3, 4, 0, -3, 34);
      ag.addColorStop(0, 'rgba(255,120,225,0.55)');
      ag.addColorStop(0.55, 'rgba(150,110,255,0.28)');
      ag.addColorStop(1, 'rgba(150,110,255,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(0, -3, 34, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.rotate(m.tilt);
    ctx.scale(m.sx, m.sy);

    // --- exhaust, behind the hull ---
    if (m.exhaust > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var e = -1; e <= 1; e += 2) {
        var len = 8 + 30 * m.exhaust + Math.sin(V.t * 40 + e) * 2.4 * m.exhaust;
        var fg = ctx.createLinearGradient(0, -17, 0, -17 - len);
        fg.addColorStop(0, m.powered ? 'rgba(255,140,235,0.95)' : 'rgba(180,255,240,0.9)');
        fg.addColorStop(0.4, m.powered ? 'rgba(190,110,255,0.5)' : 'rgba(90,220,255,0.45)');
        fg.addColorStop(1, 'rgba(90,150,255,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(e * 7 - 3.4, -16);
        ctx.quadraticCurveTo(e * 7, -16 - len, e * 7 + 3.4, -16);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // --- side fins ---
    ctx.fillStyle = C.hull2;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    for (var f = -1; f <= 1; f += 2) {
      ctx.save(); ctx.scale(f, 1);
      ctx.beginPath();
      ctx.moveTo(8, -6);
      ctx.lineTo(16.5, -1 + m.finLag);
      ctx.lineTo(15.0, 6 + m.finLag);
      ctx.lineTo(8.5, 5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // --- drill bit ---
    ctx.save();
    ctx.translate(0, 10);
    ctx.beginPath();
    ctx.moveTo(-8.6, 0); ctx.lineTo(8.6, 0);
    ctx.quadraticCurveTo(4.2, 12, 0, 17.5);
    ctx.quadraticCurveTo(-4.2, 12, -8.6, 0);
    ctx.closePath();
    var dg = ctx.createLinearGradient(-8, 0, 8, 8);
    dg.addColorStop(0, '#dfe9f2'); dg.addColorStop(0.5, '#8fa2b8'); dg.addColorStop(1, '#4b5a70');
    ctx.fillStyle = dg; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,30,45,0.7)'; ctx.lineWidth = 1.9;
    for (var b = 0; b < 4; b++) {
      var yy = ((m.drill * 8 + b * 4.6) % 18);
      ctx.beginPath();
      ctx.moveTo(-9, yy);
      ctx.quadraticCurveTo(0, yy + 3.2, 9, yy - 1.5);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();

    // --- hull ---
    ctx.beginPath();
    ctx.moveTo(-12, -7);
    ctx.arc(0, -7, 12, Math.PI, 0);
    ctx.lineTo(12, -7);
    ctx.bezierCurveTo(11.6, 3, 10.6, 8, 8.8, 11.2);
    ctx.lineTo(-8.8, 11.2);
    ctx.bezierCurveTo(-10.6, 8, -11.6, 3, -12, -7);
    ctx.closePath();
    var hg = ctx.createLinearGradient(-12, -19, 10, 12);
    if (m.powered) {
      hg.addColorStop(0, '#ffb0f0'); hg.addColorStop(0.45, '#c47bff'); hg.addColorStop(1, '#5b39a8');
    } else {
      hg.addColorStop(0, C.hull0); hg.addColorStop(0.5, C.hull1); hg.addColorStop(1, C.hull2);
    }
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.7; ctx.stroke();

    // hull accent stripe
    ctx.save(); ctx.clip();
    ctx.fillStyle = m.powered ? 'rgba(255,240,160,0.85)' : 'rgba(255,202,95,0.9)';
    ctx.fillRect(-13, 5.4, 26, 2.6);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath(); ctx.ellipse(-6, -12, 5.2, 3.4, -0.5, 0, TAU); ctx.fill();
    ctx.restore();

    // --- antenna with lagging bobble ---
    ctx.strokeStyle = C.hull2; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.quadraticCurveTo(m.ant * 0.5, -24, m.ant, -29.5);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(m.ant, -30.4, 2.5, 0, TAU);
    ctx.fillStyle = m.lampOn ? '#ffe27a' : '#5b6b7a';
    ctx.fill();
    if (m.lampOn) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(255,220,120,0.8)';
      ctx.beginPath(); ctx.arc(m.ant, -30.4, 5.4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(m.ant, -30.4, 2.5, 0, TAU); ctx.stroke();

    // --- visor ---
    ctx.beginPath(); ctx.ellipse(0, -7.5, 9.6, 7.6, 0, 0, TAU);
    var vg = ctx.createLinearGradient(0, -15, 0, 0);
    vg.addColorStop(0, '#123043'); vg.addColorStop(1, '#071a26');
    ctx.fillStyle = vg; ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();

    // face inside the visor
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, -7.5, 9.4, 7.4, 0, 0, TAU); ctx.clip();
    drawEye(ctx, -4.1, -10.4 + m.eyeY, 2.9 * m.eyeScale, 3.1 * m.eyeScale, m, -1);
    drawEye(ctx, 4.1, -10.4 + m.eyeY, 2.9 * m.eyeScale, 3.1 * m.eyeScale, m, 1);
    ctx.translate(0, -8.6);
    drawMouth(ctx, m);
    if (m.blush > 0.01) {
      ctx.globalAlpha = m.blush * 0.65;
      ctx.fillStyle = '#ff7a9c';
      ctx.beginPath(); ctx.ellipse(-6.8, 1.4, 2.2, 1.3, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6.8, 1.4, 2.2, 1.3, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // visor glass shine
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#bfefff';
    ctx.beginPath(); ctx.ellipse(-3.6, -11.0, 4.4, 1.9, -0.42, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    // --- startled sweat drop ---
    if (m.sweat > 0.02) {
      ctx.globalAlpha = m.sweat;
      ctx.fillStyle = '#9fe6ff';
      ctx.beginPath();
      var sxp = -m.grazeDir * 12.5, syp = -17 + (1 - m.sweat) * 5;
      ctx.moveTo(sxp, syp - 3.4);
      ctx.quadraticCurveTo(sxp + 2.4, syp + 1.2, sxp, syp + 2.6);
      ctx.quadraticCurveTo(sxp - 2.4, syp + 1.2, sxp, syp - 3.4);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- dizzy stars after a crunch ---
    if (m.stars > 0.02) {
      ctx.globalAlpha = m.stars;
      for (var st = 0; st < 3; st++) {
        var aa = V.t * 4.5 + st / 3 * TAU;
        var sxx = Math.cos(aa) * 13, syy = -25 + Math.sin(aa) * 4.2;
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        for (var q = 0; q < 8; q++) {
          var an = q / 8 * TAU - Math.PI / 2;
          var rd = (q % 2) ? 1.1 : 2.9;
          var xx2 = sxx + Math.cos(an) * rd, yy2 = syy + Math.sin(an) * rd;
          if (q === 0) ctx.moveTo(xx2, yy2); else ctx.lineTo(xx2, yy2);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- the spent wisp at run's end ---
    if (m.smoke > 0.02) {
      ctx.globalAlpha = m.smoke * 0.5;
      ctx.fillStyle = '#8f88a8';
      for (var w = 0; w < 3; w++) {
        var ph = (V.t * 0.6 + w * 0.33) % 1;
        ctx.beginPath();
        ctx.arc(Math.sin(ph * 6 + w) * 3.5, -20 - ph * 24, 2.2 + ph * 3.5, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function machineMood(sN, alive, powered, dt) {
    var m = {
      sx: 1, sy: 1, tilt: 0, eye: 'normal', open: 1, lid: 0, brow: 0,
      pupilX: 0, pupilY: 0.15, eyeScale: 1, eyeY: 0,
      mouth: 'smile', mouthW: 1, mouthH: 1,
      lamp: 0.35, lampOn: true, drill: 0, exhaust: 0,
      blush: 0, sweat: 0, stars: 0, aura: 0, smoke: 0,
      ant: 0, finLag: 0, alpha: 1, powered: powered, grazeDir: 1
    };

    // antenna & fin lag: secondary motion off lateral velocity
    var targetAnt = clamp(-S.vx / 90, -1.6, 1.6) * 4.6;
    V.ant.v += (targetAnt - V.ant.x) * 34 * dt;
    V.ant.v *= Math.pow(0.0016, dt);
    V.ant.x += V.ant.v * dt;
    m.ant = V.ant.x;
    m.finLag = clamp(-S.vx / 200, -1, 1) * 1.6;
    m.tilt = clamp(S.vx / 620, -0.30, 0.30);
    m.drill = V.drillPhase || 0;

    if (S.phase === 'gameover') {
      m.eye = 'closed'; m.happyClose = false;
      m.mouth = 'flat'; m.mouthW = 0.8;
      m.sy = 0.90; m.sx = 1.06;
      m.lamp = clamp(1 - V.endT * 1.1, 0, 1) * 0.35;
      m.lampOn = V.endT < 0.9;
      m.exhaust = 0; m.smoke = clamp(V.endT * 1.2, 0, 1);
      m.tilt = clamp(S.vx / 620, -0.3, 0.3) * 0.4 + 0.06;
      return m;
    }

    if (S.phase === 'ready') {
      // alive and a little impatient
      var bob = Math.sin(V.t * 2.2) * 0.03;
      m.sy = 1 + bob; m.sx = 1 - bob * 0.7;
      var imp = ((V.t * 0.42) % 1);
      if (imp > 0.90) { // a shudder — get on with it
        m.sx = 1 + Math.sin(V.t * 60) * 0.05;
        m.sy = 1 - Math.sin(V.t * 60) * 0.05;
        m.brow = 0.16; m.mouth = 'flat'; m.mouthW = 0.85;
      } else {
        m.mouth = 'smile'; m.mouthH = 1.0;
      }
      m.pupilY = 0.45 + Math.sin(V.t * 1.1) * 0.25;
      m.pupilX = Math.sin(V.t * 0.7) * 0.3;
      m.lamp = 0.30 + 0.08 * Math.sin(V.t * 2.5);
      m.drill = V.drillPhase || 0;
      m.exhaust = 0.05 + 0.04 * Math.sin(V.t * 3.1);
      if (V.blink > 0) { m.eye = 'closed'; m.happyClose = true; }
      return m;
    }

    // ---- playing ----
    var accel = S.input.accel && S.stallTicks === 0;
    var danger = clamp((sN - 0.66) / 0.34, 0, 1);

    m.exhaust = accel ? (0.35 + 0.65 * sN) : (0.06 + 0.12 * sN);
    m.lamp = 0.32 + 0.55 * sN;
    m.drill = V.drillPhase || 0;

    // stretched by its own momentum
    m.sy = 1 + 0.13 * sN + 0.06 * danger;
    m.sx = 1 - 0.09 * sN - 0.04 * danger;

    if (accel) {
      m.eye = 'determined'; m.lid = 0.34 - 0.22 * danger;
      m.brow = 0.30 - 0.5 * danger;
      m.mouth = 'grin'; m.mouthW = 0.95 + 0.35 * danger; m.mouthH = 0.8 + 1.0 * danger;
      m.pupilY = 0.45;
    } else {
      // composed, gathering itself
      m.eye = 'normal'; m.open = 0.62; m.lid = 0.10;
      m.mouth = 'smile'; m.mouthH = 0.8; m.mouthW = 0.85;
      m.pupilY = 0.25;
    }

    if (danger > 0.02) {   // thrilled
      m.eye = 'wide'; m.open = 1; m.lid = 0;
      m.eyeScale = 1 + 0.26 * danger;
      m.brow = -0.22 * danger;
      m.mouth = 'o'; m.mouthW = 1.0 + 0.5 * danger; m.mouthH = 0.9 + 0.9 * danger;
      m.blush = danger * 0.9;
      var jit = danger * 0.6;
      m.tilt += (Math.random() - 0.5) * 0.02 * jit;
    }

    if (powered) {
      m.eye = 'star'; m.open = 1; m.lid = 0; m.brow = -0.2;
      m.mouth = 'grin'; m.mouthW = 1.25; m.mouthH = 1.5;
      m.aura = 1; m.blush = 0.8;
    }

    if (V.grazeT > 0) {     // a near-miss registered in the body
      var g = V.grazeT / 0.42;
      m.grazeDir = V.grazeSide;
      m.eye = 'wide'; m.open = 1; m.lid = 0;
      m.eyeScale = Math.max(m.eyeScale, 1 + 0.4 * g * V.grazeAmt);
      m.pupilX = -V.grazeSide * 0.95;
      m.brow = -0.4 * g;
      m.sweat = g * V.grazeAmt;
      m.tilt += V.grazeSide * 0.22 * g * V.grazeAmt;
      m.sx *= 1 - 0.10 * g * V.grazeAmt;
      m.sy *= 1 + 0.10 * g * V.grazeAmt;
      m.mouth = 'o'; m.mouthW = 0.8; m.mouthH = 1.2;
    }

    if (V.crashT > 0) {     // crumpled by the stop
      var c = V.crashT / 0.5;
      m.eye = 'x'; m.mouth = 'wave'; m.mouthW = 1.1;
      m.sx = 1 + 0.42 * c; m.sy = 1 - 0.34 * c;
      m.stars = c; m.blush = 0; m.aura = powered ? 1 : 0;
      m.tilt = V.crashDir * 0.3 * c;
      m.exhaust *= 0.2;
    }

    if (V.blink > 0 && !powered && V.grazeT <= 0 && V.crashT <= 0 && danger < 0.2 && !accel) {
      m.eye = 'closed'; m.happyClose = true;
    }

    if (S.remainingMs < 3200 && ((V.t * 4) % 1) < 0.5 && V.crashT <= 0) {
      m.brow = 0.4; m.sweat = Math.max(m.sweat, 0.55); m.grazeDir = 1;
    }
    return m;
  }

  /* ------------------------------------------------------------------ trail */

  function drawTrail(ctx, sN) {
    if (V.trail.length < 3) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var first = V.trail[0], last = V.trail[V.trail.length - 1];
    var y0 = sy(first.d), y1 = sy(last.d);
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(60,220,200,0)');
    g.addColorStop(0.6, 'rgba(70,230,215,' + (0.10 + 0.16 * sN).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(190,255,245,' + (0.24 + 0.30 * sN).toFixed(3) + ')');
    ctx.strokeStyle = g;
    ctx.lineWidth = (12 + 6 * sN) * V.scale;
    ctx.beginPath();
    ctx.moveTo(sx(first.x), y0);
    for (var i = 1; i < V.trail.length; i++) ctx.lineTo(sx(V.trail[i].x), sy(V.trail[i].d));
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(1, 2.2 * V.base);
    ctx.strokeStyle = 'rgba(255,225,170,' + (0.10 + 0.25 * sN).toFixed(3) + ')';
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ speed */

  function drawStreaks(ctx, st, sN) {
    if (sN < 0.18) return;
    var n = Math.floor(6 + 30 * sN);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(190,225,255,' + (0.05 + 0.13 * sN).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1, 1.4 * V.base);
    var t = V.t;
    for (var i = 0; i < n; i++) {
      var h1 = H(i * 977 + Math.floor(t * 3 + i) * 31);
      var h2 = H(i * 313 + Math.floor(t * 3 + i) * 17);
      var x = st.x + h1 * st.w;
      var y = ((h2 * st.h + t * (900 + 2600 * sN) * V.base * 0.12) % (st.h + 200)) - 100;
      var len = (28 + 150 * sN) * V.base * (0.4 + h1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMotes(ctx, st, sN) {
    if (!V.motes.length) {
      for (var i = 0; i < 40; i++) V.motes.push({ x: rnd(-190, 190), d: rnd(-200, 800), r: rnd(0.5, 2.2), p: rnd(0.4, 1) });
    }
    ctx.save();
    for (var j = 0; j < V.motes.length; j++) {
      var mo = V.motes[j];
      var py = sy(mo.d);
      if (py > st.h + 40) { mo.d = S.depth - 120 - Math.random() * 120; mo.x = rnd(-190, 190); }
      else if (py < -60) { mo.d = S.depth + (st.h + 100) / V.scale; mo.x = rnd(-190, 190); }
      ctx.globalAlpha = 0.10 + 0.22 * mo.p * (0.4 + 0.6 * sN);
      ctx.fillStyle = '#d8c8ff';
      ctx.beginPath(); ctx.arc(sx(mo.x), py, mo.r * V.base, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* -------------------------------------------------------------------- HUD */

  function drawHUD(ctx, st, sN, powered, tMs) {
    var u = V.base;
    var pad = 13 * u + Math.max(V.insets.l, V.insets.r);
    var top = 12 * u + V.insets.t;
    var x0 = st.x + pad, w = st.w - pad * 2;

    // ---- time meter: the antagonist ----
    var barH = 15 * u;
    var frac = clamp(S.remainingMs / K.TIME_CAP, 0, 1);
    var secs = S.remainingMs / 1000;
    var low = secs < 5;
    var pulse = low ? (0.5 + 0.5 * Math.sin(V.t * 12)) : 0;

    ctx.save();
    // frame
    rr(ctx, x0, top, w, barH, barH * 0.5);
    ctx.fillStyle = 'rgba(12,8,22,0.72)'; ctx.fill();
    ctx.strokeStyle = 'rgba(190,170,230,0.28)'; ctx.lineWidth = Math.max(1, 1.2 * u); ctx.stroke();

    // fill
    ctx.save();
    rr(ctx, x0 + 1.5 * u, top + 1.5 * u, Math.max(0, (w - 3 * u) * frac), barH - 3 * u, (barH - 3 * u) * 0.5);
    ctx.clip();
    var fg = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    if (secs < 5) { fg.addColorStop(0, '#ff3d5a'); fg.addColorStop(1, '#ff8a5c'); }
    else if (secs < 10) { fg.addColorStop(0, '#ff9d3d'); fg.addColorStop(1, '#ffd166'); }
    else { fg.addColorStop(0, '#3fd6a8'); fg.addColorStop(0.7, '#7ef0c8'); fg.addColorStop(1, '#c9ffe9'); }
    ctx.fillStyle = fg;
    ctx.fillRect(x0, top, w, barH);
    // moving glints
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = '#fff';
    for (var gi = 0; gi < 12; gi++) {
      var gx = x0 + ((gi * 47 * u + V.t * 90 * u) % w);
      ctx.save(); ctx.translate(gx, top); ctx.rotate(0.35);
      ctx.fillRect(0, -barH, 3 * u, barH * 3); ctx.restore();
    }
    ctx.restore();

    if (low) {
      ctx.globalAlpha = 0.25 + 0.45 * pulse;
      rr(ctx, x0, top, w, barH, barH * 0.5);
      ctx.strokeStyle = '#ff5d6c'; ctx.lineWidth = Math.max(1.5, 2.4 * u);
      ctx.shadowColor = '#ff5d6c'; ctx.shadowBlur = 14 * u;
      ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    // tick marks at each notional 5s
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, 1 * u);
    for (var tkm = 5000; tkm < K.TIME_CAP; tkm += 5000) {
      var tx = x0 + w * (tkm / K.TIME_CAP);
      ctx.beginPath(); ctx.moveTo(tx, top + 2 * u); ctx.lineTo(tx, top + barH - 2 * u); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // seconds
    font(ctx, '700', 11.5 * u, 0.6);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,6,18,0.75)';
    ctx.fillText(secs.toFixed(1), x0 + 8 * u + 0.8 * u, top + barH / 2 + 0.8 * u);
    ctx.fillStyle = secs < 5 ? '#fff' : 'rgba(8,20,18,0.9)';
    ctx.fillText(secs.toFixed(1), x0 + 8 * u, top + barH / 2);
    ctx.restore();

    // ---- depth / score ----
    var ry = top + barH + 13 * u;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    font(ctx, '600', 9 * u, 1.6);
    ctx.fillStyle = C.uiDim;
    ctx.textAlign = 'left'; ctx.fillText('DEPTH', x0 + 1 * u, ry);
    ctx.textAlign = 'right'; ctx.fillText('SCORE', x0 + w - 1 * u, ry);

    font(ctx, '700', 19 * u, 0.4);
    ctx.fillStyle = C.ui;
    ctx.textAlign = 'left';
    ctx.fillText(fmt(S.depth / 10) + ' m', x0 + 1 * u, ry + 18 * u);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(S.scoreAcc), x0 + w - 1 * u, ry + 18 * u);
    ctx.restore();

    // ---- speed gauge, right edge ----
    var gw = 6 * u, gh = st.h * 0.26;
    var gx = st.x + st.w - pad - gw, gy = st.h * 0.44;
    ctx.save();
    rr(ctx, gx, gy, gw, gh, gw * 0.5);
    ctx.fillStyle = 'rgba(12,8,22,0.6)'; ctx.fill();
    ctx.strokeStyle = 'rgba(190,170,230,0.20)'; ctx.lineWidth = 1; ctx.stroke();
    // danger zone
    ctx.globalAlpha = 0.30;
    rr(ctx, gx, gy, gw, gh * 0.34, gw * 0.5);
    ctx.fillStyle = '#ff5d6c'; ctx.fill();
    ctx.globalAlpha = 1;
    var fh = gh * sN;
    ctx.save();
    rr(ctx, gx, gy, gw, gh, gw * 0.5); ctx.clip();
    var sg = ctx.createLinearGradient(0, gy + gh, 0, gy);
    sg.addColorStop(0, '#4de8d0'); sg.addColorStop(0.62, '#ffd166'); sg.addColorStop(1, '#ff5d6c');
    ctx.fillStyle = sg;
    ctx.fillRect(gx, gy + gh - fh, gw, fh);
    ctx.restore();
    ctx.restore();

    // ---- overdrive banner ----
    if (powered) {
      var left = Math.max(0, S.invincibleUntilMs - tMs);
      var pf = clamp(left / K.POWER_MS, 0, 1);
      var by = ry + 30 * u;
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var bw = 132 * u, bh = 21 * u, bx = st.x + st.w / 2 - bw / 2;
      rr(ctx, bx, by, bw, bh, bh * 0.5);
      ctx.fillStyle = 'rgba(30,8,44,0.8)'; ctx.fill();
      ctx.save(); rr(ctx, bx + 2 * u, by + 2 * u, (bw - 4 * u) * pf, bh - 4 * u, (bh - 4 * u) * 0.5); ctx.clip();
      var og = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      og.addColorStop(0, '#ff5fd2'); og.addColorStop(1, '#8f6bff');
      ctx.fillStyle = og; ctx.fillRect(bx, by, bw, bh);
      ctx.restore();
      font(ctx, '700', 10.5 * u, 2.4);
      ctx.fillStyle = '#fff';
      ctx.fillText('OVERDRIVE', st.x + st.w / 2, by + bh / 2);
      ctx.restore();
    }

    // ---- graze chain ----
    if (S.combo > 1 && S.phase === 'playing') {
      var cy = sy(S.depth) - 40 * V.scale;
      var ca = clamp(S.comboTimer / 60, 0, 1);
      ctx.save();
      ctx.globalAlpha = ca;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var csz = (13 + Math.min(S.combo, 9) * 1.3) * u;
      font(ctx, '700', csz, 1.2);
      ctx.lineWidth = Math.max(2, csz * 0.22); ctx.strokeStyle = 'rgba(6,4,14,0.85)';
      var txt = '×' + S.combo + '  GRAZE';
      ctx.strokeText(txt, sx(S.x), cy);
      var cg = ctx.createLinearGradient(0, cy - csz, 0, cy + csz);
      cg.addColorStop(0, '#fff3c4'); cg.addColorStop(1, S.combo > 4 ? '#ff8ad4' : '#ffd166');
      ctx.fillStyle = cg;
      ctx.fillText(txt, sx(S.x), cy);
      ctx.restore();
    }

    // ---- mute ----
    var mb = muteRect();
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = C.uiDim; ctx.fillStyle = C.uiDim;
    ctx.lineWidth = Math.max(1.2, 1.6 * u);
    var mx = mb.x + mb.w / 2, my = mb.y + mb.h / 2, ms = 5.5 * u;
    ctx.beginPath();
    ctx.moveTo(mx - ms, my - ms * 0.45); ctx.lineTo(mx - ms * 0.35, my - ms * 0.45);
    ctx.lineTo(mx + ms * 0.4, my - ms); ctx.lineTo(mx + ms * 0.4, my + ms);
    ctx.lineTo(mx - ms * 0.35, my + ms * 0.45); ctx.lineTo(mx - ms, my + ms * 0.45);
    ctx.closePath(); ctx.fill();
    if (D.audio.muted) {
      ctx.beginPath();
      ctx.moveTo(mx + ms * 0.8, my - ms * 0.6); ctx.lineTo(mx + ms * 1.7, my + ms * 0.6);
      ctx.moveTo(mx + ms * 1.7, my - ms * 0.6); ctx.lineTo(mx + ms * 0.8, my + ms * 0.6);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(mx + ms * 0.55, my, ms * 0.75, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(mx + ms * 0.55, my, ms * 1.35, -0.8, 0.8); ctx.stroke();
    }
    ctx.restore();
  }

  function muteRect() {
    var u = V.base, st = V.stage;
    var s = 34 * u;
    return { x: st.x + st.w - s - 10 * u - V.insets.r, y: st.h - s - 10 * u - V.insets.b, w: s, h: s };
  }
  V.muteRect = muteRect;

  /* ------------------------------------------------------------- the stick */

  function drawStick(ctx) {
    var s = V.stick;
    if (!s || !s.active) return;
    if (S.phase === 'gameover') return;   // never over the end-of-run ceremony
    var u = V.base;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(210,235,255,0.55)';
    ctx.lineWidth = Math.max(1.4, 1.8 * u);
    ctx.beginPath(); ctx.arc(s.ox, s.oy, s.r, 0, TAU); ctx.stroke();

    // downward throttle arc fills as the finger pushes deeper
    if (s.throttle > 0) {
      ctx.globalAlpha = 0.35 + 0.5 * s.throttle;
      ctx.strokeStyle = '#7ef0c8';
      ctx.lineWidth = Math.max(2.5, 4 * u);
      ctx.beginPath();
      ctx.arc(s.ox, s.oy, s.r, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(230,245,255,0.75)';
    ctx.beginPath(); ctx.arc(s.kx, s.ky, s.r * 0.30, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(230,245,255,0.9)';
    ctx.lineWidth = Math.max(1, 1.4 * u);
    ctx.beginPath(); ctx.moveTo(s.ox, s.oy); ctx.lineTo(s.kx, s.ky); ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------- overlays */

  function drawVignette(ctx, st, sN, powered) {
    var g = ctx.createRadialGradient(
      st.x + st.w / 2, st.h * 0.42, st.h * 0.16,
      st.x + st.w / 2, st.h * 0.5, st.h * 0.78);
    var edge = 0.42 + 0.26 * sN;
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.62, 'rgba(4,2,10,' + (edge * 0.28).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(3,1,8,' + edge.toFixed(3) + ')');
    ctx.fillStyle = g; ctx.fillRect(st.x, 0, st.w, st.h);

    if (S.remainingMs < 5000 && S.phase === 'playing') {
      var p = (1 - S.remainingMs / 5000);
      var a = (0.10 + 0.24 * p) * (0.45 + 0.55 * Math.sin(V.t * 12));
      var g2 = ctx.createRadialGradient(
        st.x + st.w / 2, st.h * 0.5, st.h * 0.22,
        st.x + st.w / 2, st.h * 0.5, st.h * 0.72);
      g2.addColorStop(0, 'rgba(255,40,70,0)');
      g2.addColorStop(1, 'rgba(255,40,70,' + Math.max(0, a).toFixed(3) + ')');
      ctx.fillStyle = g2; ctx.fillRect(st.x, 0, st.w, st.h);
    }
    if (powered) {
      var a2 = 0.06 + 0.05 * Math.sin(V.t * 7);
      var g3 = ctx.createRadialGradient(
        st.x + st.w / 2, st.h * 0.5, st.h * 0.2,
        st.x + st.w / 2, st.h * 0.5, st.h * 0.8);
      g3.addColorStop(0, 'rgba(255,95,210,0)');
      g3.addColorStop(1, 'rgba(255,95,210,' + a2.toFixed(3) + ')');
      ctx.fillStyle = g3; ctx.fillRect(st.x, 0, st.w, st.h);
    }
  }

  function drawTitle(ctx, st) {
    var u = V.base;
    var cx = st.x + st.w / 2;
    var ty = st.h * 0.13 + V.insets.t;
    var letters = 'DELVE';
    var size = Math.min(st.w * 0.20, 66 * u);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    font(ctx, '700', size, size * 0.13);
    var total = ctx.measureText(letters).width;
    var startX = cx - total / 2;
    var px = startX;
    for (var i = 0; i < letters.length; i++) {
      var ch = letters[i];
      var wch = ctx.measureText(ch).width + size * 0.13;
      var wob = Math.sin(V.t * 1.6 + i * 0.7) * size * 0.045;
      var lx = px + wch / 2 - size * 0.065;
      ctx.save();
      ctx.translate(lx, ty + wob);
      // chisel shadow
      ctx.fillStyle = 'rgba(6,3,14,0.85)';
      ctx.fillText(ch, 0, size * 0.06);
      var g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
      g.addColorStop(0, '#fff6d8'); g.addColorStop(0.45, C.frag); g.addColorStop(1, '#c2662a');
      ctx.fillStyle = g;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      px += wch;
    }
    // underline crystal rule
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = 'rgba(255,209,102,0.5)';
    ctx.lineWidth = Math.max(1, 1.4 * u);
    ctx.beginPath();
    ctx.moveTo(cx - total * 0.42, ty + size * 0.56);
    ctx.lineTo(cx + total * 0.42, ty + size * 0.56);
    ctx.stroke();
    ctx.globalAlpha = 1;
    font(ctx, '600', 10.5 * u, 3.4);
    ctx.fillStyle = C.uiDim;
    ctx.fillText('DESCEND · SWEEP · SURVIVE', cx, ty + size * 0.56 + 15 * u);
    ctx.restore();
  }

  function drawReady(ctx, st) {
    drawTitle(ctx, st);
    if (V.readyT < 1.0) return;
    var u = V.base;
    var a = clamp((V.readyT - 1.0) / 0.6, 0, 1) * (0.72 + 0.28 * Math.sin(V.t * 3.2));
    var cx = st.x + st.w / 2;
    var py = sy(S.depth) + 92 * V.scale;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // an animated push-down gesture
    var bob = (Math.sin(V.t * 3.2) * 0.5 + 0.5);
    var ax = cx, ay = py + bob * 14 * u;
    ctx.strokeStyle = '#7ef0c8';
    ctx.lineWidth = Math.max(2, 3 * u); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay - 16 * u); ctx.lineTo(ax, ay + 8 * u);
    ctx.moveTo(ax - 8 * u, ay - 1 * u); ctx.lineTo(ax, ay + 8 * u); ctx.lineTo(ax + 8 * u, ay - 1 * u);
    ctx.stroke();
    ctx.globalAlpha = a * 0.35;
    ctx.beginPath(); ctx.arc(ax, ay - 4 * u, 20 * u + bob * 5 * u, 0, TAU); ctx.stroke();

    ctx.globalAlpha = a;
    font(ctx, '700', 12 * u, 2.2);
    ctx.fillStyle = C.ui;
    ctx.fillText('HOLD TO DIG', cx, py + 34 * u);
    font(ctx, '600', 9.5 * u, 1.8);
    ctx.fillStyle = C.uiDim;
    ctx.fillText('DRAG DOWN   ·   ↓ / SPACE', cx, py + 50 * u);
    ctx.restore();
  }

  function signature() {
    var chain = S.bestCombo;
    var thr = S.bestThrottleTicks * K.STEP_MS;
    var shave = S.closestRatio;
    if (chain >= 5) return { l: 'GRAZE CHAIN', v: '×' + chain, n: 'rocks kissed in a row' };
    if (thr >= 6000) return { l: 'FULL THROTTLE', v: (thr / 1000).toFixed(1) + 's', n: 'held without letting go' };
    if (isFinite(shave) && shave < 0.35) return { l: 'CLOSEST SHAVE', v: (shave * K.NEAR_GAP).toFixed(1) + 'u', n: 'gap at the rock' };
    return { l: 'DEEPEST POINT', v: fmt(S.maxDepth / 10) + ' m', n: 'below the surface' };
  }

  function rankMeta(g) {
    for (var i = 0; i < SIM.LADDER.length; i++) if (SIM.LADDER[i].g === g) return SIM.LADDER[i];
    return SIM.LADDER[0];
  }

  function drawGameOver(ctx, st) {
    var u = V.base;
    var T = V.endT;
    var a = ease(clamp(T / 0.45, 0, 1));
    ctx.save();
    ctx.fillStyle = 'rgba(5,3,12,' + (0.74 * a).toFixed(3) + ')';
    ctx.fillRect(st.x, 0, st.w, st.h);

    var pw = Math.min(st.w - 26 * u, 330 * u);
    var ph = Math.min(st.h - 40 * u - V.insets.t - V.insets.b, 400 * u);
    var pxp = st.x + (st.w - pw) / 2;
    var pyp = (st.h - ph) / 2 + V.insets.t * 0.4 - (1 - a) * 22 * u;

    ctx.globalAlpha = a;
    rr(ctx, pxp, pyp, pw, ph, 18 * u);
    var pg = ctx.createLinearGradient(0, pyp, 0, pyp + ph);
    pg.addColorStop(0, 'rgba(30,19,44,0.96)');
    pg.addColorStop(1, 'rgba(13,8,22,0.96)');
    ctx.fillStyle = pg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.30)';
    ctx.lineWidth = Math.max(1, 1.4 * u); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var y = pyp + 26 * u;

    font(ctx, '600', 9.5 * u, 3.2);
    ctx.fillStyle = C.uiDim;
    ctx.fillText('THE DIG ENDS', pxp + pw / 2, y);
    y += 26 * u;

    // ---- rank badge ----
    var meta = rankMeta(S.rank || 'D');
    var badgeA = ease(clamp((T - 0.35) / 0.45, 0, 1));
    var br = 34 * u;
    ctx.save();
    ctx.translate(pxp + pw / 2, y + br * 0.62);
    ctx.scale(0.6 + 0.4 * badgeA, 0.6 + 0.4 * badgeA);
    ctx.globalAlpha = a * badgeA;
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var an = i / 6 * TAU - Math.PI / 2;
      var xx = Math.cos(an) * br, yy = Math.sin(an) * br;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    var bgg = ctx.createLinearGradient(0, -br, 0, br);
    bgg.addColorStop(0, '#463063'); bgg.addColorStop(1, '#1a1029');
    ctx.fillStyle = bgg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = Math.max(1.4, 2 * u); ctx.stroke();
    font(ctx, '700', br * 1.05, 0);
    var lg = ctx.createLinearGradient(0, -br * 0.6, 0, br * 0.6);
    lg.addColorStop(0, '#fff6d8'); lg.addColorStop(0.5, C.frag); lg.addColorStop(1, '#d2762c');
    ctx.fillStyle = lg;
    ctx.fillText(meta.g, 0, br * 0.04);
    ctx.restore();

    y += br * 1.5;
    ctx.globalAlpha = a * badgeA;
    font(ctx, '700', 11 * u, 2.6);
    ctx.fillStyle = C.frag;
    ctx.fillText(meta.name, pxp + pw / 2, y);
    ctx.globalAlpha = a;
    y += 24 * u;

    // ---- score vs best ----
    var cnt = ease(clamp((T - 0.25) / 0.7, 0, 1));
    var shown = Math.floor(Math.floor(S.scoreAcc) * cnt);
    font(ctx, '600', 9 * u, 2.2);
    ctx.fillStyle = C.uiDim;
    ctx.fillText('SCORE', pxp + pw * 0.30, y);
    ctx.fillText('SESSION BEST', pxp + pw * 0.70, y);
    y += 22 * u;
    font(ctx, '700', 26 * u, 0.4);
    ctx.fillStyle = C.ui;
    ctx.fillText(fmt(shown), pxp + pw * 0.30, y);
    ctx.fillStyle = V.bestBeaten ? C.frag : C.uiDim;
    font(ctx, '700', 22 * u, 0.4);
    ctx.fillText(fmt(V.best), pxp + pw * 0.70, y);
    if (V.bestBeaten) {
      font(ctx, '700', 8.5 * u, 1.6);
      ctx.fillStyle = C.frag;
      ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(V.t * 6));
      ctx.fillText('NEW BEST', pxp + pw * 0.70, y + 15 * u);
      ctx.globalAlpha = a;
    }
    y += 30 * u;

    // ---- signature stat ----
    var sig = V.lastSig || signature();
    rr(ctx, pxp + 16 * u, y, pw - 32 * u, 50 * u, 12 * u);
    ctx.fillStyle = 'rgba(255,209,102,0.09)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,102,0.24)'; ctx.lineWidth = 1; ctx.stroke();
    font(ctx, '600', 8.5 * u, 2.4);
    ctx.fillStyle = C.uiDim;
    ctx.fillText(sig.l, pxp + pw / 2, y + 13 * u);
    font(ctx, '700', 22 * u, 0.5);
    ctx.fillStyle = '#fff3c4';
    ctx.fillText(sig.v, pxp + pw / 2, y + 32 * u);
    font(ctx, '400', 8 * u, 0.6);
    ctx.fillStyle = 'rgba(141,130,168,0.8)';
    ctx.fillText(sig.n, pxp + pw / 2, y + 45 * u);
    y += 64 * u;

    // ---- small stats row ----
    var stats = [
      ['DEPTH', fmt(S.maxDepth / 10) + 'm'],
      ['SHARDS', '' + S.fragmentsCollected],
      ['GRAZES', '' + S.bestCombo],
      ['HITS', '' + (S.hits + S.wallContacts)]
    ];
    for (var si = 0; si < stats.length; si++) {
      var sxp = pxp + pw * ((si + 0.5) / stats.length);
      font(ctx, '600', 8 * u, 1.4);
      ctx.fillStyle = C.uiDim;
      ctx.fillText(stats[si][0], sxp, y);
      font(ctx, '700', 13 * u, 0.3);
      ctx.fillStyle = C.ui;
      ctx.fillText(stats[si][1], sxp, y + 15 * u);
    }
    y += 34 * u;

    // ---- the next target ----
    var sc = Math.floor(S.scoreAcc), next = null;
    for (var li = 0; li < SIM.LADDER.length; li++) if (SIM.LADDER[li].s > sc) { next = SIM.LADDER[li]; break; }
    font(ctx, '600', 9 * u, 1.4);
    ctx.fillStyle = C.uiDim;
    ctx.fillText(next ? ('NEXT RANK  ' + next.g + '  AT  ' + fmt(next.s))
      : 'TOP OF THE LADDER — HOLD IT', pxp + pw / 2, y);

    // ---- restart ----
    var by = pyp + ph - 30 * u;
    var pulse = 0.72 + 0.28 * Math.sin(V.t * 4);
    ctx.globalAlpha = a * pulse;
    font(ctx, '700', 13 * u, 2.4);
    ctx.fillStyle = C.good;
    ctx.fillText('TAP TO DIG AGAIN', pxp + pw / 2, by - 8 * u);
    ctx.globalAlpha = a * 0.7;
    font(ctx, '600', 8.5 * u, 1.4);
    ctx.fillStyle = C.uiDim;
    ctx.fillText('R  —  RETRY THIS SEED', pxp + pw / 2, by + 9 * u);
    ctx.restore();
  }

  function drawHints(ctx, st) {
    var u = V.base;
    if (V.hintSteer > 0) {
      var a = clamp(V.hintSteer, 0, 1) * clamp(V.hintSteer / 0.6, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, a) * 0.85;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var yy = sy(S.depth) - 70 * V.scale;
      font(ctx, '600', 10 * u, 2.2);
      ctx.fillStyle = C.ui;
      ctx.fillText('◀  SLIDE / ARROWS  ▶', st.x + st.w / 2, yy);
      ctx.restore();
    }
    if (V.hintPower > 0) {
      var a2 = clamp(V.hintPower / 0.7, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, a2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      font(ctx, '700', 13 * u, 2.4);
      ctx.fillStyle = C.power;
      ctx.fillText('RAM THE ROCKS!', st.x + st.w / 2, st.h * 0.63);
      ctx.restore();
    }
  }

  function drawPad(ctx) {
    // the launch pad the machine rests on before the first input
    var f = V.padFall;
    if (f > 1.6) return;
    var yOff = f > 0 ? f * f * 260 : 0;
    var rot = f * 0.9;
    ctx.save();
    ctx.globalAlpha = clamp(1 - f / 1.6, 0, 1);
    ctx.translate(sx(S.phase === 'ready' ? S.x : V.padX || 0), sy(S.phase === 'ready' ? S.depth : (V.padD || 0)) + yOff);
    ctx.scale(V.scale, V.scale);
    ctx.rotate(rot * 0.25);
    ctx.fillStyle = '#241a33';
    ctx.strokeStyle = '#0f0a19';
    ctx.lineWidth = 1.4;
    rr(ctx, -23, 26, 46, 7, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2b4e';
    rr(ctx, -17, 20, 8, 8, 2); ctx.fill(); ctx.stroke();
    rr(ctx, 9, 20, 8, 8, 2); ctx.fill(); ctx.stroke();
    var glow = 0.5 + 0.5 * Math.sin(V.t * 4);
    ctx.fillStyle = 'rgba(255,169,85,' + (0.5 + 0.5 * glow).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(-19, 29.5, 1.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(19, 29.5, 1.8, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* --------------------------------------------------------------- events */

  function consumeEvents() {
    var q = S.fxQueue, i, e;
    for (i = 0; i < q.length; i++) {
      e = q[i];
      switch (e.kind) {
        case 'frag':
          spark(e.x, e.depth, 10, C.frag, 200, 0.5, 2.4);
          ring(e.x, e.depth, 6, 30, 'rgba(255,209,102,0.9)', 0.35, 2);
          pop(e.x, e.depth - 8, '+' + (K.FRAG_TIME / 1000).toFixed(1) + 's', '#ffe9a8', 12);
          D.audio.sfx('fragment', e.idx || 0);
          break;
        case 'near':
          V.grazeT = 0.42;
          V.grazeAmt = clamp(1 - Math.max(0, e.gap) / K.NEAR_GAP, 0.18, 1);
          V.grazeSide = e.x > S.x ? 1 : -1;
          V.grazeCombo = e.combo;
          var mag = V.grazeAmt * (0.6 + 0.5 * Math.min(e.combo, 8) / 8);
          ring(e.x, e.depth, e.r * 0.9, e.r * 0.9 + 34 + 26 * mag,
            e.combo > 3 ? 'rgba(255,138,212,0.9)' : 'rgba(190,235,255,0.85)', 0.30 + 0.12 * mag, 2 + 2 * mag);
          spark(e.x, e.depth, Math.floor(3 + 9 * mag), e.combo > 3 ? '#ff8ad4' : '#cfe9ff', 170, 0.35, 2);
          V.shake = Math.max(V.shake, 2.2 + 7 * mag);
          V.flash = Math.max(V.flash, 0.06 + 0.14 * mag);
          V.flashCol = e.combo > 3 ? 'rgba(255,150,220,' : 'rgba(200,240,255,';
          D.audio.sfx('near', e.combo);
          break;
        case 'smash':
          shards(e.x, e.depth, e.powered ? 16 : 12, e.r, C.rock0);
          spark(e.x, e.depth, 8, '#c9b8e0', 190, 0.5, 2.2);
          ring(e.x, e.depth, e.r * 0.6, e.r * 2.6, e.powered ? 'rgba(255,95,210,0.9)' : 'rgba(200,180,230,0.7)', 0.32, 3);
          if (e.powered) {
            pop(e.x, e.depth - 8, '+' + (K.BREAK_TIME / 1000).toFixed(2) + 's', '#ff9ee0', 12);
            V.shake = Math.max(V.shake, 7);
            D.audio.sfx('smash');
          } else {
            V.crashT = 0.5; V.crashDir = e.x > S.x ? 1 : -1;
            V.shake = Math.max(V.shake, 9 + 13 * clamp((e.speed || 0) / K.V_MAX, 0, 1));
            V.flash = Math.max(V.flash, 0.30);
            V.flashCol = 'rgba(255,180,140,';
            pop(S.x, S.depth - 26, 'STALL', '#ff8f7a', 13);
            D.audio.sfx('rock_hit');
          }
          break;
        case 'wall':
          V.crashT = 0.5; V.crashDir = -e.side;
          V.shake = Math.max(V.shake, 8 + 12 * clamp((e.speed || 0) / K.V_MAX, 0, 1));
          V.flash = Math.max(V.flash, 0.24);
          V.flashCol = 'rgba(255,150,110,';
          spark(e.x, e.depth, 14, '#c2a2e0', 210, 0.55, 2.6);
          shards(e.x, e.depth, 8, 16, '#4a3d5c');
          ring(e.x, e.depth, 4, 40, 'rgba(255,140,90,0.8)', 0.32, 3);
          pop(S.x, S.depth - 26, 'STALL', '#ff8f7a', 13);
          D.audio.sfx('wall');
          break;
        case 'power':
          V.powerFlash = 1;
          V.shake = Math.max(V.shake, 6);
          V.flash = Math.max(V.flash, 0.3); V.flashCol = 'rgba(255,120,225,';
          for (var k2 = 0; k2 < 3; k2++) ring(e.x, e.depth, 8 + k2 * 10, 90 + k2 * 26, 'rgba(255,95,210,0.85)', 0.55 + k2 * 0.1, 3);
          spark(e.x, e.depth, 26, '#ff9ee0', 320, 0.8, 3);
          if (!V.shownPower) { V.shownPower = true; V.hintPower = 2.0; }
          D.audio.sfx('power');
          break;
        case 'end':
          V.endT = 0;
          V.shake = Math.max(V.shake, 10);
          if (Math.floor(S.scoreAcc) > V.best) { V.best = Math.floor(S.scoreAcc); V.bestBeaten = true; }
          else V.bestBeaten = false;
          V.lastSig = signature();
          D.audio.sfx('end');
          if (V.bestBeaten) setTimeout(function () { D.audio.sfx('best'); }, 900);
          break;
      }
    }
    q.length = 0;
  }

  /* ---------------------------------------------------------------- frame */

  V.drillPhase = 0;

  function frame(ctx, cw, ch, dt) {
    V.t += dt;

    var sN = clamp((S.speed - K.V_MIN) / (K.V_MAX - K.V_MIN), 0, 1);
    var tMs = S.tick * K.STEP_MS;
    var powered = S.phase === 'playing' && tMs < S.invincibleUntilMs;
    var alive = S.phase === 'playing';

    consumeEvents();

    // ---- camera: zoom OUT with speed, so the horizon never shrinks ----
    var zt = 1 + 0.085 * sN;
    V.zoom += (zt - V.zoom) * Math.min(1, dt * 5);
    var yft = 0.26 - 0.028 * sN;
    V.playerYF += (yft - V.playerYF) * Math.min(1, dt * 5);

    V.base = Math.min(cw / 360, ch / 720);
    V.scale = V.base / V.zoom;
    var stW = Math.min(cw, 760 * V.base);
    V.stage.x = (cw - stW) / 2; V.stage.y = 0; V.stage.w = stW; V.stage.h = ch;
    var st = V.stage;
    V.ox = cw / 2; V.oy = ch * V.playerYF;

    // ---- view timers ----
    V.drillPhase += dt * (S.phase === 'ready' ? 1.6 : (2 + 16 * sN));
    V.shake *= Math.pow(0.0009, dt);
    if (V.shake < 0.05) V.shake = 0;
    var vib = alive ? Math.max(0, sN - 0.68) * 2.4 : 0;
    V.shx = (Math.random() - 0.5) * (V.shake + vib) * V.base * 2;
    V.shy = (Math.random() - 0.5) * (V.shake + vib) * V.base * 2;
    V.flash *= Math.pow(0.0006, dt);
    V.grazeT = Math.max(0, V.grazeT - dt);
    V.crashT = Math.max(0, V.crashT - dt);
    V.powerFlash = Math.max(0, V.powerFlash - dt * 1.6);
    V.hintPower = Math.max(0, V.hintPower - dt);
    if (S.phase === 'ready') V.readyT += dt; else V.readyT = 0;
    if (S.phase === 'gameover') V.endT += dt;

    V.blink -= dt;
    if (V.blink < -V.blinkNext) { V.blink = 0.12; V.blinkNext = 1.4 + Math.random() * 2.6; }

    // phase transitions (view-side)
    if (V.prevPhase !== S.phase) {
      if (S.phase === 'playing' && V.prevPhase === 'ready') {
        V.padX = S.x; V.padD = S.depth; V.padFall = 0.001;
        V.startFlare = 1;
        D.audio.sfx('start');
      }
      if (S.phase === 'ready') { V.padFall = 0; V.endT = 0; V.trail.length = 0; V.parts.length = 0; V.pops.length = 0; }
      V.prevPhase = S.phase;
    }
    if (V.padFall > 0) V.padFall += dt;

    // steer hint: the first time a bend actually demands it
    if (alive && !V.shownSteer) {
      var cAhead = SIM.centerXAt(S, S.depth + 220);
      if (Math.abs(cAhead - S.x) > 34 || S.tick > 150) { V.shownSteer = true; V.hintSteer = 3.2; }
    }
    if (V.hintSteer > 0) V.hintSteer -= dt;

    // trail
    if (alive) {
      V.trail.push({ x: S.x, d: S.depth });
      if (V.trail.length > 74) V.trail.shift();
      while (V.trail.length && V.trail[0].d < S.depth - 300) V.trail.shift();
    }

    // low-time ticking
    if (alive && S.remainingMs < 5000) {
      var whole = Math.ceil(S.remainingMs / 1000);
      if (whole !== V.tickAt) { V.tickAt = whole; D.audio.sfx('tick'); }
    } else V.tickAt = -1;

    // engine + the edge tone
    var wantEdge = sN > 0.72 ? 1 : 0;
    V.edgeHold += (wantEdge - V.edgeHold) * Math.min(1, dt * (wantEdge ? 1.4 : 3.0));
    var edge = clamp(Math.max(V.edgeHold * (0.35 + 0.65 * sN), Math.min(1, S.combo / 6)), 0, 1);
    D.audio.update(sN, edge, powered, alive, dt);

    updateParts(dt);

    // ---------------- draw ----------------
    ctx.save();
    drawBackdrop(ctx, cw, ch);

    ctx.save();
    ctx.beginPath(); ctx.rect(st.x, 0, st.w, st.h); ctx.clip();

    drawEarth(ctx, st);
    var samp = corridorSamples(st);
    drawCorridor(ctx, st, samp, sN);
    drawMotes(ctx, st, sN);

    /* Wall rim runs hot as the machine crowds it — a warning you read from
       the scene, plus an afterglow on the wall you just clipped. */
    var crashHot = clamp(V.crashT / 0.5, 0, 1) * 0.7;
    var cxN = SIM.centerXAt(S, S.depth), hwN = SIM.halfW(S, S.depth);
    var lProx = alive ? clamp(1 - ((S.x - (cxN - hwN)) - K.PLAYER_R) / 34, 0, 1) : 0;
    var rProx = alive ? clamp(1 - (((cxN + hwN) - S.x) - K.PLAYER_R) / 34, 0, 1) : 0;
    wallEdge(ctx, st, samp, -1, sN, Math.max(crashHot * (V.crashDir > 0 ? 1 : 0.4), lProx * 0.85));
    wallEdge(ctx, st, samp, 1, sN, Math.max(crashHot * (V.crashDir < 0 ? 1 : 0.4), rProx * 0.85));

    drawTrail(ctx, sN);

    var i;
    for (i = 0; i < S.rocks.length; i++) if (S.rocks[i].active) drawRock(ctx, S.rocks[i], sN);
    for (i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!it.active) continue;
      if (it.type === 'fragment') drawFragment(ctx, it, V.t);
      else drawPowerItem(ctx, it, V.t);
    }

    drawParts(ctx);
    if (S.phase === 'ready' || V.padFall > 0) drawPad(ctx);
    drawMachine(ctx, machineMood(sN, alive, powered, dt));
    drawPops(ctx);

    drawStreaks(ctx, st, sN);
    drawVignette(ctx, st, sN, powered);

    if (V.flash > 0.005) {
      // capped: impact is felt, the line ahead is never lost
      ctx.fillStyle = V.flashCol + Math.min(0.40, V.flash).toFixed(3) + ')';
      ctx.fillRect(st.x, 0, st.w, st.h);
    }

    drawHUD(ctx, st, sN, powered, tMs);
    drawHints(ctx, st);
    if (S.phase === 'ready') drawReady(ctx, st);
    if (S.phase === 'gameover') drawGameOver(ctx, st);
    drawStick(ctx);

    ctx.restore();

    // letterbox edges on wide frames
    if (st.w < cw - 1) {
      ctx.fillStyle = C.void0;
      ctx.fillRect(0, 0, st.x, ch);
      ctx.fillRect(st.x + st.w, 0, cw - st.x - st.w, ch);
      ctx.strokeStyle = 'rgba(255,169,85,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(st.x + 0.5, 0); ctx.lineTo(st.x + 0.5, ch);
      ctx.moveTo(st.x + st.w - 0.5, 0); ctx.lineTo(st.x + st.w - 0.5, ch);
      ctx.stroke();
    }
    ctx.restore();
  }

  D.render = { frame: frame, V: V, signature: signature };
})();
