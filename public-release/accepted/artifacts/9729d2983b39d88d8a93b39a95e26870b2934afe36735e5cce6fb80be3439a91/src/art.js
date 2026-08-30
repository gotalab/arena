/* DELVE — procedural art. Every mark on screen is drawn here in code.
 * View-only: nothing in this file is read by the rules.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});
  var Art = (DELVE.Art = {});

  // ------------------------------------------------------------- palette --
  var P = Art.palette = {
    void0: '#05040c',
    void1: '#0b0819',
    rockDeep: '#130e28',
    rockMid: '#1e1740',
    rockHi: '#2f2359',
    rockEdge: '#4a3585',
    rim: '#8f6ce0',
    tunnel0: '#0a0716',
    tunnel1: '#171034',
    amber: '#ffb347',
    amberHot: '#ffe9b8',
    amberDeep: '#c8641f',
    mint: '#6ff2c8',
    mintDeep: '#1fa887',
    gold: '#ffd166',
    rose: '#ff5fa2',
    danger: '#ff5a52',
    ink: '#150a26',
    text: '#efe9ff',
    textDim: '#9d92c9'
  };

  Art.FONT = '"Trebuchet MS","Avenir Next","Segoe UI",system-ui,-apple-system,sans-serif';

  function hash(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  Art.hash = hash;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ------------------------------------------------------- glow sprites ---
  // Radial-gradient sprites, cached. Far cheaper than ctx.shadowBlur, which is
  // what would otherwise kill this on a phone.
  var glowCache = {};
  Art.glow = function (color, px) {
    px = Math.max(8, Math.round(px));
    var key = color + '|' + px;
    var c = glowCache[key];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = px * 2;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(px, px, 0, px, px, px);
    grd.addColorStop(0, color);
    grd.addColorStop(0.35, hexA(color, 0.45));
    grd.addColorStop(1, hexA(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, px * 2, px * 2);
    if (Object.keys(glowCache).length > 90) glowCache = {};
    glowCache[key] = c;
    return c;
  };
  Art.blob = function (ctx, x, y, r, color, alpha) {
    var s = Art.glow(color, r);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };

  function hexA(hex, a) {
    if (hex.charAt(0) !== '#') return hex;
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  Art.a = hexA;

  // ------------------------------------------------------- rock texture ---
  Art.rockTile = function (size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    g.fillStyle = P.rockMid;
    g.fillRect(0, 0, size, size);
    var i, j;
    // grain
    for (i = 0; i < size * size * 0.05; i++) {
      var x = Math.random() * size, y = Math.random() * size;
      var v = Math.random();
      g.fillStyle = v > 0.55 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.07)';
      g.fillRect(x, y, 1 + (v > 0.9 ? 1 : 0), 1);
    }
    // fissures
    g.lineCap = 'round';
    for (i = 0; i < 22; i++) {
      var px = Math.random() * size, py = Math.random() * size;
      var ang = Math.random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(px, py);
      for (j = 0; j < 5; j++) {
        ang += (Math.random() - 0.5) * 1.1;
        px += Math.cos(ang) * 7; py += Math.sin(ang) * 7;
        g.lineTo(px, py);
      }
      g.strokeStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(150,120,220,0.07)';
      g.lineWidth = Math.random() * 1.6 + 0.4;
      g.stroke();
    }
    // embedded crystals
    for (i = 0; i < 26; i++) {
      var cx = Math.random() * size, cy = Math.random() * size, r = Math.random() * 2.4 + 0.8;
      g.beginPath();
      g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.7, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.7, cy);
      g.closePath();
      g.fillStyle = Math.random() > 0.55 ? 'rgba(111,242,200,0.10)' : 'rgba(255,179,71,0.09)';
      g.fill();
    }
    return c;
  };

  // strata bands: the rock the corridor is cut through, banded by depth
  Art.strataColor = function (band) {
    var h = hash(band * 3.77);
    var h2 = hash(band * 9.11 + 4);
    var base = [
      [19, 14, 40], [30, 22, 58], [24, 16, 46], [37, 25, 62], [16, 14, 38], [43, 27, 66]
    ][Math.floor(h * 6) % 6];
    var warm = h2 > 0.82;
    return 'rgb(' + Math.round(base[0] + (warm ? 22 : 0)) + ',' +
      Math.round(base[1] + (warm ? 8 : 0)) + ',' + base[2] + ')';
  };

  // ---------------------------------------------------------------- rock --
  // Faceted, hand-cut look: a dark body, one lit facet, cracks, and a couple
  // of embedded crystals so rocks belong to the same world as the fragments.
  Art.rockPath = function (ctx, r, seed) {
    var n = 7 + Math.floor(hash(seed * 5.5) * 4);
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + hash(seed + i) * 0.32;
      var rr = r * (0.78 + hash(seed * 2.1 + i * 1.7) * 0.34);
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.94;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  Art.drawRock = function (ctx, x, y, r, seed, opts) {
    opts = opts || {};
    ctx.save();
    ctx.translate(x, y);

    // it sits in the shaft, so it casts into it
    ctx.beginPath();
    ctx.ellipse(r * 0.16, r * 0.62, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4,2,12,0.5)';
    ctx.fill();

    ctx.rotate((hash(seed * 7.3) - 0.5) * 0.9);

    // heavy dark silhouette first: rocks must never read as thin outlines
    Art.rockPath(ctx, r * 1.06, seed);
    ctx.fillStyle = '#08050f';
    ctx.fill();

    Art.rockPath(ctx, r, seed);
    var g = ctx.createLinearGradient(-r * 0.8, -r, r * 0.7, r);
    g.addColorStop(0, '#6e5aa6');
    g.addColorStop(0.34, '#42327a');
    g.addColorStop(0.72, '#251a4a');
    g.addColorStop(1, '#150e2c');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // one broad lit facet, catching the machine's lamp
    ctx.beginPath();
    ctx.moveTo(-r * 1.3, -r * 1.3);
    ctx.lineTo(r * 0.45, -r * 1.3);
    ctx.lineTo(-r * 0.1, r * 0.2);
    ctx.lineTo(-r * 1.3, -r * 0.05);
    ctx.closePath();
    ctx.fillStyle = 'rgba(196,172,255,0.22)';
    ctx.fill();
    // a darker underside so the mass has a bottom
    ctx.beginPath();
    ctx.moveTo(-r * 1.3, r * 0.35);
    ctx.lineTo(r * 1.3, r * 0.05);
    ctx.lineTo(r * 1.3, r * 1.3);
    ctx.lineTo(-r * 1.3, r * 1.3);
    ctx.closePath();
    ctx.fillStyle = 'rgba(6,3,16,0.42)';
    ctx.fill();
    // cracks
    ctx.strokeStyle = 'rgba(8,4,18,0.7)';
    ctx.lineWidth = Math.max(0.7, r * 0.085);
    ctx.lineCap = 'round';
    for (var k = 0; k < 3; k++) {
      var a0 = hash(seed * 3.1 + k) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r * 0.95, Math.sin(a0) * r * 0.95);
      ctx.lineTo(Math.cos(a0 + 1.1) * r * 0.22, Math.sin(a0 + 1.1) * r * 0.22);
      ctx.lineTo(Math.cos(a0 + 2.6) * r * 0.75, Math.sin(a0 + 2.6) * r * 0.75);
      ctx.stroke();
    }
    ctx.restore();

    // top-lit rim, then the hard edge
    Art.rockPath(ctx, r, seed);
    ctx.strokeStyle = 'rgba(150,124,220,0.55)';
    ctx.lineWidth = Math.max(0.8, r * 0.09);
    ctx.stroke();

    // embedded crystals — the same mineral family as the time fragments
    if (r > 9) {
      var nn = 1 + Math.floor(hash(seed * 11.9) * 2);
      for (var q = 0; q < nn; q++) {
        var aa = hash(seed * 4.4 + q * 3) * Math.PI * 2;
        var rr = r * 0.42;
        var cx = Math.cos(aa) * rr, cy = Math.sin(aa) * rr;
        var cs = r * 0.17;
        ctx.beginPath();
        ctx.moveTo(cx, cy - cs); ctx.lineTo(cx + cs * 0.6, cy);
        ctx.lineTo(cx, cy + cs); ctx.lineTo(cx - cs * 0.6, cy);
        ctx.closePath();
        ctx.fillStyle = hash(seed + q) > 0.5 ? 'rgba(111,242,200,0.55)' : 'rgba(255,179,71,0.45)';
        ctx.fill();
      }
    }
    ctx.restore();

    // while powered, a rock stops being a hazard and starts being a target
    if (opts.target) {
      ctx.save();
      ctx.translate(x, y);
      var pulse = 0.55 + 0.45 * Math.sin((opts.t || 0) * 7 + seed);
      Art.blob(ctx, 0, 0, r * 1.7, P.rose, 0.16 + 0.1 * pulse);
      ctx.rotate((opts.t || 0) * 1.1);
      ctx.strokeStyle = 'rgba(255,120,180,' + (0.4 + 0.35 * pulse) + ')';
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.lineCap = 'round';
      for (var c2 = 0; c2 < 4; c2++) {
        var ang = c2 * Math.PI / 2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.24, ang - 0.28, ang + 0.28);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  // ------------------------------------------------------------ fragment --
  Art.drawFragment = function (ctx, x, y, r, t, seed) {
    var spin = t * 1.7 + seed * 9;
    var pulse = 0.86 + 0.14 * Math.sin(t * 4.2 + seed * 11);
    Art.blob(ctx, x, y, r * 2.0 * pulse, P.mint, 0.30);
    ctx.save();
    ctx.translate(x, y);
    var sq = Math.cos(spin);
    ctx.scale(0.42 + 0.58 * Math.abs(sq), 1);
    var g = ctx.createLinearGradient(0, -r * 1.3, 0, r * 1.3);
    g.addColorStop(0, '#dffff4');
    g.addColorStop(0.45, P.mint);
    g.addColorStop(1, P.mintDeep);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.28);
    ctx.lineTo(r * 0.86, -r * 0.4);
    ctx.lineTo(r * 0.62, r * 1.0);
    ctx.lineTo(-r * 0.62, r * 1.0);
    ctx.lineTo(-r * 0.86, -r * 0.4);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(223,255,244,0.85)';
    ctx.lineWidth = r * 0.13;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.95);
    ctx.lineTo(r * 0.12, -r * 0.1);
    ctx.lineTo(-r * 0.05, r * 0.78);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = r * 0.16;
    ctx.stroke();
    ctx.restore();
  };

  // --------------------------------------------------------- power item ---
  Art.drawPower = function (ctx, x, y, r, t) {
    var spin = t * 1.25;
    var pulse = 0.9 + 0.18 * Math.sin(t * 5.5);
    Art.blob(ctx, x, y, r * 3.4 * pulse, P.rose, 0.34);
    Art.blob(ctx, x, y, r * 2.1 * pulse, P.gold, 0.5);
    ctx.save();
    ctx.translate(x, y);

    // orbiting sparks
    for (var i = 0; i < 3; i++) {
      var a = spin * 1.6 + (i / 3) * Math.PI * 2;
      var ox = Math.cos(a) * r * 1.9, oy = Math.sin(a) * r * 1.9 * 0.7;
      Art.blob(ctx, ox, oy, r * 0.5, P.gold, 0.85);
    }

    ctx.rotate(spin);
    // eight-point star gem
    ctx.beginPath();
    for (var k = 0; k < 8; k++) {
      var ang = (k / 8) * Math.PI * 2;
      var rr = k % 2 === 0 ? r * 1.25 : r * 0.5;
      var px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.25);
    g.addColorStop(0, '#fffbe8');
    g.addColorStop(0.5, P.gold);
    g.addColorStop(1, P.rose);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,251,232,0.9)';
    ctx.lineWidth = r * 0.12;
    ctx.stroke();
    ctx.rotate(-spin * 2.2);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf4';
    ctx.fill();
    ctx.restore();
  };

  // ------------------------------------------------------------ the machine
  // "BURROW-7": a drill pod with a face. Everything about its posture, light
  // and exhaust is driven by what the run is doing to it.
  //
  // m = { expr, throttle, speedFrac, steer, lean, squash, stretch, drill,
  //       blink, powered, t, dim, shake }
  Art.drawMachine = function (ctx, u, m) {
    var expr = m.expr;
    var t = m.t;
    var sf = m.speedFrac;
    var stretch = m.stretch, squash = m.squash;

    ctx.save();
    ctx.scale(u, u);
    ctx.rotate(m.lean * 0.5);
    ctx.scale(squash, stretch);

    var glowA = 0.5 + 0.5 * sf;

    // ---- headlight cone from the drill tip
    if (!m.dim) {
      var lg = ctx.createLinearGradient(0, 10, 0, 10 + 52 * (0.6 + sf));
      lg.addColorStop(0, 'rgba(255,214,150,' + (0.3 + 0.22 * sf) + ')');
      lg.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.beginPath();
      ctx.moveTo(-2.5, 11);
      ctx.lineTo(2.5, 11);
      ctx.lineTo(15 + 14 * sf, 12 + 56 * (0.6 + sf));
      ctx.lineTo(-15 - 14 * sf, 12 + 56 * (0.6 + sf));
      ctx.closePath();
      ctx.fillStyle = lg;
      ctx.fill();
    }

    // ---- powered aura
    if (m.powered) {
      ctx.save();
      ctx.rotate(t * 2.4);
      for (var pa = 0; pa < 6; pa++) {
        var an = (pa / 6) * Math.PI * 2;
        Art.blob(ctx, Math.cos(an) * 15, Math.sin(an) * 15, 7, pa % 2 ? P.gold : P.rose, 0.6);
      }
      ctx.restore();
      Art.blob(ctx, 0, 0, 22, P.gold, 0.3);
    }

    // ---- rear thruster fins
    var finTilt = m.steer * 0.5;
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(s * 8.6, -4);
      ctx.rotate(s * (0.16 + finTilt * s * 0.55));
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(s * 5.6, -1.5);
      ctx.lineTo(s * 4.4, 6.5);
      ctx.lineTo(0, 5);
      ctx.closePath();
      var fg = ctx.createLinearGradient(0, -6, 0, 7);
      fg.addColorStop(0, '#8e5bd8');
      fg.addColorStop(1, '#43266f');
      ctx.fillStyle = fg;
      ctx.fill();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.restore();
    }

    // ---- exhaust ports (top)
    var ex = 0.25 + 0.75 * m.throttle;
    for (var e = -1; e <= 1; e += 2) {
      Art.blob(ctx, e * 5.2, -14 - 2 * ex, 2.8 + 2.6 * ex, P.amber, 0.5 * ex + 0.12);
    }

    // ---- drill
    ctx.save();
    ctx.translate(0, 8.5);
    var dg = ctx.createLinearGradient(-7, 0, 7, 14);
    dg.addColorStop(0, '#f5f1ff');
    dg.addColorStop(0.4, '#b9a8e8');
    dg.addColorStop(1, '#6a52a8');
    ctx.beginPath();
    ctx.moveTo(-7.2, -1);
    ctx.quadraticCurveTo(-6.4, 9, 0, 14.5);
    ctx.quadraticCurveTo(6.4, 9, 7.2, -1);
    ctx.closePath();
    ctx.fillStyle = dg;
    ctx.fill();
    // helical flutes
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(40,22,70,0.55)';
    ctx.lineWidth = 1.5;
    for (var fl = 0; fl < 4; fl++) {
      var off = ((m.drill + fl / 4) % 1) * 15;
      ctx.beginPath();
      ctx.moveTo(-8, -2 + off);
      ctx.quadraticCurveTo(0, -6 + off, 8, -2 + off);
      ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-7.2, -1);
    ctx.quadraticCurveTo(-6.4, 9, 0, 14.5);
    ctx.quadraticCurveTo(6.4, 9, 7.2, -1);
    ctx.closePath();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (!m.dim) Art.blob(ctx, 0, 14, 5 + 6 * sf, m.powered ? P.gold : P.amberHot, 0.55 + 0.35 * sf);
    ctx.restore();

    // ---- body
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.quadraticCurveTo(9.5, -14, 10.6, -4);
    ctx.quadraticCurveTo(11.4, 5, 6.4, 9.4);
    ctx.lineTo(-6.4, 9.4);
    ctx.quadraticCurveTo(-11.4, 5, -10.6, -4);
    ctx.quadraticCurveTo(-9.5, -14, 0, -15);
    ctx.closePath();
    var bg = ctx.createLinearGradient(-9, -15, 8, 10);
    if (m.dim) { bg.addColorStop(0, '#8a6a4a'); bg.addColorStop(0.5, '#6b4a2e'); bg.addColorStop(1, '#3a2418'); }
    else { bg.addColorStop(0, '#ffe0a8'); bg.addColorStop(0.42, P.amber); bg.addColorStop(1, P.amberDeep); }
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // belly plate
    ctx.beginPath();
    ctx.moveTo(-6.2, 4.4);
    ctx.lineTo(6.2, 4.4);
    ctx.lineTo(5.2, 9.2);
    ctx.lineTo(-5.2, 9.2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,30,20,0.45)';
    ctx.fill();

    // side lamps
    var lampOn = m.dim ? 0.15 : 0.55 + 0.45 * Math.sin(t * 6 + 1) * (0.3 + 0.7 * m.throttle);
    for (var L = -1; L <= 1; L += 2) {
      Art.blob(ctx, L * 9.4, 1.5, 3.6, m.powered ? P.rose : P.mint, clamp(lampOn, 0, 1) * 0.9);
    }

    // ---- dome
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -5.4, 7.6, 6.9, 0, 0, Math.PI * 2);
    ctx.closePath();
    var domeG = ctx.createLinearGradient(-6, -12, 6, 2);
    domeG.addColorStop(0, 'rgba(180,235,255,0.55)');
    domeG.addColorStop(0.55, 'rgba(70,120,190,0.4)');
    domeG.addColorStop(1, 'rgba(24,18,52,0.75)');
    ctx.fillStyle = domeG;
    ctx.fill();
    ctx.save();
    ctx.clip();
    Art.drawFace(ctx, m, t);
    ctx.restore();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // specular
    ctx.beginPath();
    ctx.ellipse(-3.4, -8.6, 3.1, 1.7, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    if (expr === 'hit') {
      ctx.beginPath();
      ctx.moveTo(-6, -9); ctx.lineTo(-2, -5.5); ctx.lineTo(-4, -2.5); ctx.lineTo(1, 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();

    // ---- antenna with a lagging bobble
    ctx.beginPath();
    ctx.moveTo(1.6, -14.4);
    ctx.quadraticCurveTo(4.2 + m.bob * 2.2, -19.5, 3.2 + m.bob * 5, -22.6);
    ctx.strokeStyle = m.dim ? '#5d4a84' : '#b79ae8';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    Art.blob(ctx, 3.2 + m.bob * 5, -22.9, 3.4, m.powered ? P.gold : (m.dim ? '#6b5a8a' : P.mint), 0.95);

    // ---- wind lines at dangerous speed
    if (sf > 0.62 && !m.dim) {
      ctx.strokeStyle = 'rgba(255,230,190,' + (0.16 + 0.3 * (sf - 0.62) / 0.38) + ')';
      ctx.lineWidth = 1.1;
      for (var w = 0; w < 3; w++) {
        var wy = -18 - w * 6 - ((t * 90) % 7);
        ctx.beginPath();
        ctx.moveTo(-6 - w * 2, wy);
        ctx.lineTo(-6 - w * 2, wy + 5);
        ctx.moveTo(6 + w * 2, wy);
        ctx.lineTo(6 + w * 2, wy + 5);
        ctx.stroke();
      }
    }

    ctx.restore();
    void glowA;
  };

  // The face carries every state the run puts the machine through.
  Art.drawFace = function (ctx, m, t) {
    var expr = m.expr;
    var eyeY = -5.6;
    var eyeDX = 3.5;
    var px = clamp(m.steer, -1, 1) * 0.95 + m.lean * 1.2;
    var py = 0.55 + m.speedFrac * 0.35;
    var open = 1, pupil = 1.05, browed = 0;

    if (expr === 'ready') { open = 1 + 0.06 * Math.sin(t * 2.2); pupil = 1.1; py = 0.2; px += Math.sin(t * 0.9) * 0.9; }
    else if (expr === 'dig') { open = 0.72; pupil = 0.95; browed = 1; }
    else if (expr === 'fast') { open = 1.22; pupil = 0.62; browed = 1; }
    else if (expr === 'graze') { open = 1.45; pupil = 0.45; }
    else if (expr === 'coast') { open = 0.5; pupil = 1.0; py = 0.1; }
    else if (expr === 'hit') { open = 0; }
    else if (expr === 'end') { open = 0; }

    open *= m.blink;

    if (expr === 'hit') {
      // dazed: crossed eyes
      ctx.strokeStyle = '#20122f';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (var s = -1; s <= 1; s += 2) {
        var cx = s * eyeDX;
        ctx.beginPath();
        ctx.moveTo(cx - 2, eyeY - 2); ctx.lineTo(cx + 2, eyeY + 2);
        ctx.moveTo(cx + 2, eyeY - 2); ctx.lineTo(cx - 2, eyeY + 2);
        ctx.stroke();
      }
    } else if (expr === 'end') {
      // spent: closed, downturned
      ctx.strokeStyle = '#20122f';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        ctx.beginPath();
        ctx.arc(s2 * eyeDX, eyeY + 1.4, 2.3, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    } else {
      for (var e = -1; e <= 1; e += 2) {
        var ex = e * eyeDX;
        var eh = 2.9 * open;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, 2.5, Math.max(0.28, eh), 0, 0, Math.PI * 2);
        ctx.fillStyle = '#fdfaff';
        ctx.fill();
        if (eh > 0.7) {
          ctx.beginPath();
          ctx.ellipse(ex + px * 0.75, eyeY + py, 1.35 * pupil, 1.5 * pupil * Math.min(1, open), 0, 0, Math.PI * 2);
          ctx.fillStyle = '#1b0f2c';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(ex + px * 0.75 - 0.5, eyeY + py - 0.6, 0.42, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.fill();
        }
        if (browed) {
          ctx.beginPath();
          ctx.moveTo(ex - 2.6 * e, eyeY - 3.1 - (expr === 'fast' ? 0.7 : 0));
          ctx.lineTo(ex + 2.4 * e, eyeY - 1.9);
          ctx.strokeStyle = '#20122f';
          ctx.lineWidth = 1.15;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      }
    }

    // mouth
    ctx.strokeStyle = '#20122f';
    ctx.lineWidth = 1.25;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (expr === 'fast') {
      ctx.moveTo(-2.6, -0.6);
      ctx.quadraticCurveTo(0, 2.6, 2.6, -0.6);
      ctx.closePath();
      ctx.fillStyle = '#2a1236';
      ctx.fill();
    } else if (expr === 'graze') {
      ctx.ellipse(0, 0.4, 1.5, 1.9, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#2a1236';
      ctx.fill();
    } else if (expr === 'hit') {
      ctx.moveTo(-2.8, 0.6);
      ctx.lineTo(-1.4, -0.4); ctx.lineTo(0, 0.6); ctx.lineTo(1.4, -0.4); ctx.lineTo(2.8, 0.6);
      ctx.stroke();
    } else if (expr === 'end') {
      ctx.moveTo(-2.2, 1.1);
      ctx.quadraticCurveTo(0, -0.5, 2.2, 1.1);
      ctx.stroke();
    } else if (expr === 'dig') {
      ctx.moveTo(-2.4, 0.4);
      ctx.quadraticCurveTo(0, 1.2, 2.4, 0.4);
      ctx.stroke();
    } else {
      ctx.moveTo(-2.2, -0.2);
      ctx.quadraticCurveTo(0, 2.0, 2.2, -0.2);
      ctx.stroke();
    }

    // a bead of sweat on a close one
    if (expr === 'graze') {
      ctx.beginPath();
      ctx.ellipse(m.grazeSide > 0 ? -6.2 : 6.2, -8.2 + (t * 9 % 1) * 2, 1.0, 1.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(160,230,255,0.9)';
      ctx.fill();
    }
  };

  // ---------------------------------------------------------------- title --
  Art.drawTitle = function (ctx, cx, cy, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + size + 'px ' + Art.FONT;
    var text = 'DELVE';
    ctx.lineJoin = 'round';

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 1.06);
    // struck into the rock: a short, dark extrusion rather than a slab
    for (var i = 5; i >= 1; i--) {
      ctx.fillStyle = 'rgba(14,8,30,' + (0.42 - i * 0.045) + ')';
      ctx.fillText(text, 0, i * size * 0.026);
    }
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = size * 0.13;
    ctx.strokeText(text, 0, 0);
    var g = ctx.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
    g.addColorStop(0, '#fff3d6');
    g.addColorStop(0.45, P.amber);
    g.addColorStop(0.52, '#ff9a3c');
    g.addColorStop(1, '#d0561a');
    ctx.fillStyle = g;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    ctx.restore();
  };

  // ---------------------------------------------------------- rank badge --
  var GRADE_COLORS = {
    'D': ['#6c6390', '#3a3358'],
    'C': ['#66b0d8', '#2a5a84'],
    'B': ['#6ff2c8', '#1c7a63'],
    'A': ['#ffd166', '#a86a12'],
    'S': ['#ff9f5a', '#b23c14'],
    'S+': ['#ff5fa2', '#8c1a52'],
    'SS': ['#fff3d6', '#c22a6a']
  };
  Art.gradeColors = function (g) { return GRADE_COLORS[g] || GRADE_COLORS.D; };

  Art.drawBadge = function (ctx, cx, cy, r, grade, t, pop) {
    var cols = Art.gradeColors(grade);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    Art.blob(ctx, 0, 0, r * 2.1, cols[0], 0.4);
    ctx.rotate(Math.sin(t * 1.4) * 0.03);
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, cols[0]);
    g.addColorStop(1, cols[1]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(12,8,24,0.9)';
    ctx.lineWidth = r * 0.1;
    ctx.stroke();
    ctx.beginPath();
    for (var j = 0; j < 6; j++) {
      var a2 = (j / 6) * Math.PI * 2 - Math.PI / 2;
      var x2 = Math.cos(a2) * r * 0.82, y2 = Math.sin(a2) * r * 0.82;
      if (j === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = r * 0.045;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 ' + (r * (grade.length > 1 ? 0.86 : 1.16)) + 'px ' + Art.FONT;
    ctx.fillStyle = 'rgba(12,8,24,0.85)';
    ctx.fillText(grade, 0, r * 0.06);
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(grade, 0, r * 0.02);
    ctx.restore();
  };

  // ------------------------------------------------------------- helpers --
  Art.roundRect = function (ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
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
  };

  // faceted panel — the crystal shape language, reused by every UI surface
  Art.panel = function (ctx, x, y, w, h, cut) {
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
  };

  Art.lerp = lerp;
  Art.clamp = clamp;
})(typeof window !== 'undefined' ? window : globalThis);
