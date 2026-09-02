/* SHOAL - the pool, drawn.

   Everything here is view-only dressing. It reads production state and never
   writes it, and no effect ever hides a number the player needs. */
(function (g) {
  'use strict';

  var S = g.SHOAL;

  var PALETTE = {
    deep: '#031a24',
    water: '#0a3140',
    shallow: '#12586a',
    glow: '#39b8b0',
    foam: '#d9f7f3',
    sand: '#d9c49a',
    rim: '#123241',
    coral: '#ff7a5c',
    gold: '#ffd479',
    urchin: '#221436'
  };

  // Each number gets its own hue so a frontier full of digits reads as a
  // pattern instead of a soup.
  var NUM_COLORS = [
    '#5ecfa8', // 0 (unused as text)
    '#8ddcff', // 1
    '#7cf0a6', // 2
    '#ff9576', // 3
    '#c8a6ff', // 4
    '#ffd166', // 5
    '#57e6e0', // 6
    '#ff87c2', // 7
    '#ffffff'  // 8
  ];

  var canvas = null;
  var ctx = null;
  var W = 0, H = 0, dpr = 1;
  var cs = 0, ox = 0, oy = 0, hostH = 0, boardW = 0, boardH = 0;
  var gridW = 0, gridH = 0;
  var tiles = null;
  var vt = 0;               // view clock, seconds; never touches the rules
  var rand = Math.random;
  var calm = false;         // honours prefers-reduced-motion

  var fx = {
    cell: {},          // cell -> pop start time
    wash: {},          // cell -> time the wave front reaches it
    rings: [],
    particles: [],
    flagPop: {},
    shake: 0,
    flash: 0,
    flashColor: '210,90,80',
    stingAt: null,
    revealT: 0,
    clearGlow: 0,
    lastRipple: 0,
    lastRippleSize: 0,
    press: null,
    cursor: null,
    refuse: null
  };

  var host = {
    mood: 'idle',
    moodT: 0,
    lean: 0, rise: 0, eye: 1, claw: 0, tilt: 0,
    blink: 0, nextBlink: 2.4,
    hop: 0
  };

  var bubbles = [];
  var fishes = [];

  // When the ceremony rises, the pool lifts and shrinks so the post-mortem
  // stays visible above the card. The evidence is the content.
  var cer = { on: false, reserve: 0, t: 0, k: 1 };

  /* ------------------------------------------------------------- utilities */

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  /* ------------------------------------------------------------------ tiles */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function shellTile(size, variant) {
    var c = makeCanvas(size, size);
    var q = c.getContext('2d');
    var pad = Math.max(1, size * 0.05);
    var x = pad, y = pad, w = size - pad * 2, h = size - pad * 2;
    var r = size * 0.28;

    q.save();
    roundRect(q, x, y + size * 0.045, w, h, r);
    q.fillStyle = 'rgba(2,16,24,0.5)';
    q.fill();
    q.restore();

    // Three near-identical tints so a covered field looks gathered, not printed.
    var TINTS = [
      ['#f3fbf9', '#cfe6e4', '#a4c7cd', '#7ea8b3'],
      ['#f6faf5', '#d6e4de', '#aec7c5', '#87a7ac'],
      ['#f2fbf7', '#cde7de', '#a2c8c4', '#7ba8ab']
    ][variant % 3];
    var grad = q.createLinearGradient(x, y, x + w * 0.5, y + h);
    grad.addColorStop(0, TINTS[0]);
    grad.addColorStop(0.4, TINTS[1]);
    grad.addColorStop(0.78, TINTS[2]);
    grad.addColorStop(1, TINTS[3]);
    roundRect(q, x, y, w, h, r);
    q.fillStyle = grad;
    q.fill();

    // A fan of ridges, like a scallop lying face down.
    q.save();
    roundRect(q, x, y, w, h, r);
    q.clip();
    var cx = x + w / 2, cy = y + h * 1.08;
    var spread = 0.34 + variant * 0.03;
    for (var i = -2; i <= 2; i++) {
      var ang = -Math.PI / 2 + i * spread;
      var len = h * 1.35;
      q.beginPath();
      q.moveTo(cx, cy);
      q.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      q.strokeStyle = 'rgba(74,120,132,0.42)';
      q.lineWidth = Math.max(0.7, size * 0.034);
      q.stroke();
      q.beginPath();
      q.moveTo(cx + size * 0.035, cy);
      q.lineTo(cx + Math.cos(ang) * len + size * 0.035, cy + Math.sin(ang) * len);
      q.strokeStyle = 'rgba(255,255,255,0.6)';
      q.lineWidth = Math.max(0.5, size * 0.022);
      q.stroke();
    }
    // hinge
    q.beginPath();
    q.ellipse(cx, y + h * 0.98, w * 0.16, h * 0.07, 0, 0, Math.PI * 2);
    q.fillStyle = 'rgba(120,160,168,0.5)';
    q.fill();
    q.restore();

    // wet highlight
    q.save();
    roundRect(q, x, y, w, h, r);
    q.clip();
    q.beginPath();
    q.ellipse(x + w * 0.34, y + h * 0.26, w * 0.30, h * 0.17, -0.5, 0, Math.PI * 2);
    q.fillStyle = 'rgba(255,255,255,0.5)';
    q.fill();
    q.restore();

    roundRect(q, x + 0.5, y + 0.5, w - 1, h - 1, r);
    q.strokeStyle = 'rgba(255,255,255,0.55)';
    q.lineWidth = Math.max(0.6, size * 0.02);
    q.stroke();
    return c;
  }

  function pocketTile(size, seedIndex) {
    var c = makeCanvas(size, size);
    var q = c.getContext('2d');
    var pad = Math.max(1, size * 0.05);
    var x = pad, y = pad, w = size - pad * 2, h = size - pad * 2;
    var r = size * 0.24;

    var grad = q.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#052430');
    grad.addColorStop(0.55, '#09323f');
    grad.addColorStop(1, '#0d4050');
    roundRect(q, x, y, w, h, r);
    q.fillStyle = grad;
    q.fill();

    // sand grains on the pool floor
    var rr = S.rng.mulberry32(1234 + seedIndex * 77);
    q.save();
    roundRect(q, x, y, w, h, r);
    q.clip();
    for (var i = 0; i < 7; i++) {
      var px = x + rr() * w, py = y + rr() * h;
      q.beginPath();
      q.arc(px, py, Math.max(0.4, size * (0.012 + rr() * 0.014)), 0, Math.PI * 2);
      q.fillStyle = 'rgba(197,175,133,' + (0.10 + rr() * 0.16).toFixed(3) + ')';
      q.fill();
    }
    // inner shadow under the lip
    var sh = q.createLinearGradient(x, y, x, y + h * 0.5);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    q.fillStyle = sh;
    q.fillRect(x, y, w, h * 0.5);
    q.restore();

    roundRect(q, x + 0.5, y + 0.5, w - 1, h - 1, r);
    q.strokeStyle = 'rgba(120,200,205,0.16)';
    q.lineWidth = Math.max(0.5, size * 0.016);
    q.stroke();
    return c;
  }

  function buildTiles(size) {
    var t = { size: size, shells: [], pockets: [] };
    for (var i = 0; i < 3; i++) t.shells.push(shellTile(size, i));
    for (var j = 0; j < 3; j++) t.pockets.push(pocketTile(size, j));
    return t;
  }

  /* ----------------------------------------------------------------- layout */

  function resize() {
    if (!canvas) return;
    var rect = canvas.parentNode.getBoundingClientRect();
    W = Math.max(120, Math.round(rect.width));
    H = Math.max(160, Math.round(rect.height));
    dpr = Math.min(2.5, g.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var st = S.game.state();
    gridW = st.w;
    gridH = st.h;
    hostH = clamp(H * 0.15, 46, 112);
    var padX = Math.max(4, W * 0.02);
    var padTop = 4;
    var availW = W - padX * 2;
    var availH = H - hostH - padTop - 2;
    cs = Math.floor(Math.min(availW / st.w, availH / st.h));
    cs = Math.max(9, cs);
    boardW = cs * st.w;
    boardH = cs * st.h;
    ox = Math.round((W - boardW) / 2);
    oy = Math.round(padTop + Math.max(0, (availH - boardH) / 2));

    if (!tiles || tiles.size !== cs) tiles = buildTiles(cs);

    bubbles.length = 0;
    for (var i = 0; i < 16; i++) {
      bubbles.push({
        x: rand() * W,
        y: rand() * H,
        r: 1 + rand() * 2.6,
        sp: 6 + rand() * 16,
        w: 0.4 + rand() * 1.2,
        ph: rand() * 6.28
      });
    }
    fishes.length = 0;
    for (var f = 0; f < 3; f++) {
      fishes.push({
        x: rand() * W,
        y: 0,
        sp: (10 + rand() * 14) * (rand() < 0.5 ? -1 : 1),
        depth: 0.15 + rand() * 0.7,
        size: 3 + rand() * 3,
        ph: rand() * 6.28
      });
    }
  }

  function cellRect(x, y) {
    return { x: ox + x * cs, y: oy + y * cs, s: cs };
  }

  function hit(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var st = S.game.state();
    var x = Math.floor((px - ox) / cs);
    var y = Math.floor((py - oy) / cs);
    if (x < 0 || y < 0 || x >= st.w || y >= st.h) return null;
    return { x: x, y: y };
  }

  /* ----------------------------------------------------------------- events */

  function onGameEvent(ev) {
    var st = S.game.state();
    if (ev.type === 'reset') {
      fx.cell = {}; fx.wash = {}; fx.rings.length = 0; fx.particles.length = 0;
      fx.flagPop = {}; fx.shake = 0; fx.flash = 0; fx.stingAt = null; fx.revealT = 0;
      fx.clearGlow = 0; fx.lastRippleSize = 0;
      setMood('idle');
      resize();
      return;
    }
    if (ev.type === 'open') {
      var w = ev.w;
      var oxc = ev.origin % w, oyc = (ev.origin / w) | 0;
      var maxDelay = 0;
      for (var i = 0; i < ev.cells.length; i++) {
        var c = ev.cells[i];
        var cx = c % w, cy = (c / w) | 0;
        var d = Math.max(Math.abs(cx - oxc), Math.abs(cy - oyc));
        var delay = calm ? 0 : Math.min(0.62, d * 0.042);
        maxDelay = Math.max(maxDelay, delay);
        fx.wash[c] = vt + delay;
        fx.cell[c] = vt + delay;
        if (ev.cells.length > 3 && i % 2 === 0) spawnDroplets(cx, cy, vt + delay, 2);
      }
      fx.rings.push({
        x: ox + (oxc + 0.5) * cs,
        y: oy + (oyc + 0.5) * cs,
        t0: vt,
        dur: 0.28 + maxDelay,
        r1: cs * (1.4 + Math.min(7, ev.cells.length * 0.45)),
        wide: ev.sweep ? 2.6 : 1.6
      });
      fx.lastRipple = vt;
      fx.lastRippleSize = ev.cells.length;
      if (ev.cells.length >= 6) setMood('happy');
      else setMood('curious');
      return;
    }
    if (ev.type === 'flag' || ev.type === 'unflag') {
      fx.flagPop[ev.y * st.w + ev.x] = { t0: vt, on: ev.type === 'flag' };
      return;
    }
    if (ev.type === 'sting') {
      fx.shake = calm ? 0 : 1;
      fx.flash = calm ? 0.4 : 1;
      fx.flashColor = '255,86,74';
      fx.stingAt = { x: ev.x, y: ev.y };
      fx.revealT = vt;
      setMood('hurt');
      return;
    }
    if (ev.type === 'clear') {
      fx.clearGlow = 1;
      fx.cell = {}; fx.wash = {}; fx.flagPop = {};
      setMood('proud');
      for (var b = 0; b < 26; b++) {
        fx.particles.push({
          x: ox + rand() * boardW,
          y: oy + boardH * (0.2 + rand() * 0.8),
          vx: (rand() - 0.5) * 30,
          vy: -30 - rand() * 70,
          life: 0, max: 1.1 + rand() * 0.8,
          size: 1.5 + rand() * 2.6,
          kind: 'pearl'
        });
      }
      resize();
    }
  }

  function spawnDroplets(cx, cy, at, n) {
    if (calm || fx.particles.length > 220) return;
    for (var i = 0; i < n; i++) {
      fx.particles.push({
        x: ox + (cx + 0.5) * cs,
        y: oy + (cy + 0.5) * cs,
        vx: (rand() - 0.5) * cs * 2.2,
        vy: -rand() * cs * 1.7,
        life: -(at - vt), max: 0.42 + rand() * 0.3,
        size: Math.max(1, cs * (0.04 + rand() * 0.05)),
        kind: 'drop'
      });
    }
  }

  function setMood(m) {
    if (host.mood === 'hurt' && m !== 'idle') return;
    host.mood = m;
    host.moodT = 0;
    if (m === 'happy' || m === 'proud') host.hop = 1;
  }

  /* ------------------------------------------------------------ host moods */

  function updateHost(dt) {
    var st = S.game.state();
    host.moodT += dt;
    if (st.phase === 'ended') host.mood = 'hurt';
    else if (host.mood === 'hurt') host.mood = 'idle';
    else if ((host.mood === 'happy' || host.mood === 'proud') && host.moodT > 1.8) host.mood = 'idle';
    else if (host.mood === 'curious' && host.moodT > 2.4) host.mood = 'idle';

    if (st.phase === 'playing' && host.mood === 'idle') {
      var left = S.game.coveredSafeLeft();
      if (st.firstTurnDone && left > 0 && left <= Math.max(4, st.safeTotal * 0.12)) host.mood = 'tense';
    }

    var target = { lean: 0, rise: 0, eye: 1, claw: 0, tilt: 0 };
    if (host.mood === 'curious') { target.lean = 0.5; target.eye = 1.15; }
    else if (host.mood === 'happy') { target.rise = 1; target.claw = 1; target.eye = 0.75; }
    else if (host.mood === 'proud') { target.rise = 0.7; target.claw = 1.25; target.eye = 0.8; }
    else if (host.mood === 'tense') { target.rise = -0.6; target.eye = 1.35; target.claw = -0.35; }
    else if (host.mood === 'hurt') { target.rise = -1; target.eye = 0; target.tilt = 0.5; target.claw = -0.7; }

    var k = 1 - Math.pow(0.001, dt);
    host.lean = lerp(host.lean, target.lean, k);
    host.rise = lerp(host.rise, target.rise, k);
    host.eye = lerp(host.eye, target.eye, k);
    host.claw = lerp(host.claw, target.claw, k);
    host.tilt = lerp(host.tilt, target.tilt, k);
    host.hop = Math.max(0, host.hop - dt * 2.2);

    host.nextBlink -= dt;
    if (host.nextBlink <= 0) { host.blink = 0.16; host.nextBlink = 1.8 + rand() * 3.4; }
    host.blink = Math.max(0, host.blink - dt);
  }

  /* ------------------------------------------------------------------ paint */

  var waterGrad = null;
  var waterGradH = -1;

  function drawWater() {
    if (!waterGrad || waterGradH !== H) {
      waterGrad = ctx.createLinearGradient(0, 0, 0, H);
      waterGrad.addColorStop(0, '#0a3746');
      waterGrad.addColorStop(0.45, '#072b39');
      waterGrad.addColorStop(1, '#04202c');
      waterGradH = H;
    }
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, 0, W, H);

    // caustics: slow interfering bands of light on the pool floor
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 3; i++) {
      var t = vt * (0.16 + i * 0.05);
      ctx.beginPath();
      var amp = 16 + i * 9;
      var yb = H * (0.18 + i * 0.3);
      ctx.moveTo(-20, yb);
      for (var x = -20; x <= W + 20; x += 14) {
        var y = yb + Math.sin(x * 0.014 + t * 2.1 + i) * amp + Math.sin(x * 0.031 - t * 1.3) * amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W + 20, yb + 90);
      ctx.lineTo(-20, yb + 90);
      ctx.closePath();
      ctx.fillStyle = 'rgba(60,190,190,' + (0.028 - i * 0.006).toFixed(3) + ')';
      ctx.fill();
    }
    // light shafts
    for (var s = 0; s < 3; s++) {
      var sx = W * (0.15 + s * 0.34) + Math.sin(vt * 0.25 + s) * 22;
      var lg = ctx.createLinearGradient(sx, 0, sx + 40, H);
      lg.addColorStop(0, 'rgba(150,240,235,0.10)');
      lg.addColorStop(1, 'rgba(150,240,235,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(sx - 16, 0);
      ctx.lineTo(sx + 26, 0);
      ctx.lineTo(sx + 78, H);
      ctx.lineTo(sx + 8, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // bubbles
    ctx.save();
    for (var b = 0; b < bubbles.length; b++) {
      var bu = bubbles[b];
      bu.y -= bu.sp * 0.016;
      if (bu.y < -6) { bu.y = H + 6; bu.x = rand() * W; }
      var bx = bu.x + Math.sin(vt * bu.w + bu.ph) * 6;
      ctx.beginPath();
      ctx.arc(bx, bu.y, bu.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(190,240,240,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRim() {
    var base = H - hostH;
    ctx.save();
    // sand shelf
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, base + 14);
    for (var x = 0; x <= W; x += 18) {
      ctx.lineTo(x, base + 12 + Math.sin(x * 0.03 + 1.2) * 4 + Math.sin(x * 0.011) * 3);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    var gr = ctx.createLinearGradient(0, base, 0, H);
    gr.addColorStop(0, '#1d4a52');
    gr.addColorStop(0.35, '#2a4b48');
    gr.addColorStop(1, '#3d4438');
    ctx.fillStyle = gr;
    ctx.fill();

    // pebbles
    var pr = S.rng.mulberry32(99);
    for (var i = 0; i < 9; i++) {
      var px = pr() * W, py = base + 16 + pr() * (hostH * 0.5);
      var rr = 2 + pr() * 4;
      ctx.beginPath();
      ctx.ellipse(px, py, rr, rr * 0.75, pr() * 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(210,225,215,' + (0.05 + pr() * 0.10).toFixed(3) + ')';
      ctx.fill();
    }

    // seaweed, swaying
    for (var s = 0; s < 5; s++) {
      var wx = (s + 0.5) * (W / 5) + Math.sin(s * 2.1) * 12;
      var hgt = hostH * (0.55 + ((s * 37) % 10) / 20);
      ctx.beginPath();
      ctx.moveTo(wx, base + 16);
      for (var t = 0; t <= 1.001; t += 0.2) {
        var sway = Math.sin(vt * 1.1 + s + t * 2.4) * (7 * t);
        ctx.lineTo(wx + sway, base + 16 - hgt * t);
      }
      ctx.strokeStyle = 'rgba(74,168,132,0.5)';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFish() {
    ctx.save();
    for (var i = 0; i < fishes.length; i++) {
      var f = fishes[i];
      f.x += f.sp * 0.016;
      if (f.sp > 0 && f.x > W + 30) f.x = -30;
      if (f.sp < 0 && f.x < -30) f.x = W + 30;
      var fy = oy + boardH * f.depth + Math.sin(vt * 1.4 + f.ph) * 7;
      if (fy > H - hostH - 6) fy = H - hostH - 10;
      var dir = f.sp > 0 ? 1 : -1;
      ctx.save();
      ctx.translate(f.x, fy);
      ctx.scale(dir, 1);
      ctx.globalAlpha = 0.32;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.size * 1.9, f.size, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9beede';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-f.size * 1.8, 0);
      ctx.lineTo(-f.size * 3.1, -f.size * 0.9 + Math.sin(vt * 9 + f.ph) * 1.6);
      ctx.lineTo(-f.size * 3.1, f.size * 0.9 + Math.sin(vt * 9 + f.ph) * 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function numberFont(size) {
    return '700 ' + Math.round(size) + 'px ui-rounded, "Avenir Next", "Segoe UI", system-ui, sans-serif';
  }

  function drawUrchin(cx, cy, r, alpha, hostile) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (var i = 0; i < 11; i++) {
      var a = (i / 11) * Math.PI * 2 + vt * 0.25;
      ctx.moveTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
      ctx.lineTo(cx + Math.cos(a) * r * 1.22, cy + Math.sin(a) * r * 1.22);
    }
    ctx.strokeStyle = hostile ? '#ff8a7a' : '#8f6fd8';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.lineCap = 'round';
    ctx.stroke();
    var gr = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.25, r * 0.1, cx, cy, r * 0.75);
    gr.addColorStop(0, hostile ? '#6b2440' : '#4a2f78');
    gr.addColorStop(1, '#1b1030');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - r * 0.2, cy - r * 0.22, r * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
    ctx.restore();
  }

  function drawPennant(cx, cy, size, pop, dead, right) {
    ctx.save();
    ctx.translate(cx, cy);
    var sc = 1;
    if (pop !== null) {
      var p = clamp((vt - pop.t0) / 0.26, 0, 1);
      sc = pop.on ? 0.4 + easeOut(p) * 0.75 + Math.sin(p * Math.PI) * 0.16 : 1 - p * 0.5;
      ctx.globalAlpha = pop.on ? clamp(p * 2.5, 0, 1) : 1 - p;
    }
    ctx.scale(sc, sc);
    var sway = Math.sin(vt * 3.1 + cx * 0.05) * 0.08;
    var poleH = size * 0.62;
    ctx.beginPath();
    ctx.moveTo(-size * 0.02, poleH * 0.42);
    ctx.lineTo(size * 0.02, -poleH * 0.55);
    ctx.strokeStyle = dead ? '#7d8b8e' : '#f3ede0';
    ctx.lineWidth = Math.max(1.2, size * 0.075);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size * 0.02, -poleH * 0.5);
    ctx.quadraticCurveTo(size * 0.36, -poleH * 0.36 + sway * size, size * 0.34, -poleH * 0.1 + sway * size);
    ctx.lineTo(size * 0.02, -poleH * 0.06);
    ctx.closePath();
    ctx.fillStyle = dead ? '#6a7476' : (right ? '#ffd479' : PALETTE.coral);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, poleH * 0.44, size * 0.16, size * 0.06, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();
    if (dead) {
      ctx.beginPath();
      ctx.moveTo(-size * 0.22, -size * 0.2);
      ctx.lineTo(size * 0.22, size * 0.16);
      ctx.moveTo(size * 0.22, -size * 0.2);
      ctx.lineTo(-size * 0.22, size * 0.16);
      ctx.strokeStyle = 'rgba(255,120,110,0.85)';
      ctx.lineWidth = Math.max(1.2, size * 0.07);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBoard() {
    var st = S.game.state();
    var ended = st.phase === 'ended';
    var press = fx.press;
    for (var y = 0; y < st.h; y++) {
      for (var x = 0; x < st.w; x++) {
        var i = y * st.w + x;
        var bx = ox + x * cs, by = oy + y * cs;
        var variant = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 3;
        var isMine = ended && st.mine && st.mine[i];
        var opened = st.open[i];

        if (opened || (ended && isMine)) {
          var pop = fx.cell[i];
          var scale = 1, lift = 0;
          if (pop !== undefined && vt >= pop) {
            var p = clamp((vt - pop) / 0.3, 0, 1);
            scale = 0.88 + easeOut(p) * 0.12 + Math.sin(p * Math.PI) * 0.05;
            lift = -Math.sin(p * Math.PI) * cs * 0.05;
          } else if (pop !== undefined && vt < pop) {
            scale = 0.94;
          }
          ctx.save();
          ctx.translate(bx + cs / 2, by + cs / 2 + lift);
          ctx.scale(scale, scale);
          ctx.drawImage(tiles.pockets[variant], -cs / 2, -cs / 2, cs, cs);
          ctx.restore();

          if (opened && st.val[i] > 0) {
            var v = st.val[i];
            ctx.save();
            ctx.translate(bx + cs / 2, by + cs / 2 + lift);
            ctx.font = numberFont(cs * 0.56);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = Math.max(2, cs * 0.12);
            ctx.fillStyle = NUM_COLORS[v];
            ctx.fillText(String(v), 0, cs * 0.02);
            ctx.shadowBlur = 0;
            if (v >= 6) {
              ctx.beginPath();
              ctx.arc(0, 0, cs * 0.38, 0, Math.PI * 2);
              ctx.strokeStyle = NUM_COLORS[v];
              ctx.globalAlpha = 0.32;
              ctx.lineWidth = Math.max(1, cs * 0.035);
              ctx.stroke();
            }
            ctx.restore();
          }

          if (ended && isMine) {
            var ra = clamp((vt - fx.revealT - (x + y) * 0.018) / 0.35, 0, 1);
            var fatal = fx.stingAt && fx.stingAt.x === x && fx.stingAt.y === y;
            if (fatal) {
              ctx.save();
              ctx.beginPath();
              ctx.arc(bx + cs / 2, by + cs / 2, cs * 0.62, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255,80,70,' + (0.18 + Math.sin(vt * 4) * 0.06).toFixed(3) + ')';
              ctx.fill();
              ctx.restore();
            }
            drawUrchin(bx + cs / 2, by + cs / 2, cs * 0.3 * (0.6 + ra * 0.4), ra, !!fatal);
            if (st.flag[i]) drawPennant(bx + cs / 2, by + cs / 2, cs * 0.8, null, false, true);
            if (fatal) {
              ctx.save();
              ctx.strokeStyle = 'rgba(255,120,110,0.95)';
              ctx.lineWidth = Math.max(1.5, cs * 0.07);
              roundRect(ctx, bx + cs * 0.08, by + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.22);
              ctx.stroke();
              ctx.restore();
            }
          }

          // the leading edge of the ripple: a wash of foam that never hides a number
          var washAt = fx.wash[i];
          if (washAt !== undefined) {
            var wp = (vt - washAt) / 0.34;
            if (wp < 1) {
              ctx.save();
              if (wp < 0) {
                ctx.globalAlpha = 0.22;
                roundRect(ctx, bx + cs * 0.06, by + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.24);
                ctx.fillStyle = 'rgba(210,255,250,0.5)';
                ctx.fill();
              } else {
                ctx.globalAlpha = (1 - wp) * 0.7;
                ctx.beginPath();
                ctx.arc(bx + cs / 2, by + cs / 2, cs * (0.2 + wp * 0.5), 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(215,255,250,0.9)';
                ctx.lineWidth = Math.max(1, cs * 0.07 * (1 - wp));
                ctx.stroke();
              }
              ctx.restore();
            }
          }
        } else {
          // covered shell, bobbing on the water
          var bob = Math.sin(vt * 1.5 + (x * 0.8 + y * 1.25)) * cs * 0.016;
          var psc = 1;
          if (press && press.x === x && press.y === y) {
            psc = 1 - press.progress * 0.07;
            bob += press.progress * cs * 0.02;
          }
          ctx.save();
          ctx.translate(bx + cs / 2, by + cs / 2 + bob);
          ctx.scale(psc, psc);
          ctx.drawImage(tiles.shells[variant], -cs / 2, -cs / 2, cs, cs);
          ctx.restore();

          if (press && press.x === x && press.y === y && press.progress > 0.08) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(bx + cs / 2, by + cs / 2 + bob, cs * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * press.progress);
            ctx.strokeStyle = 'rgba(255,196,110,0.95)';
            ctx.lineWidth = Math.max(1.6, cs * 0.08);
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.restore();
          }

          if (st.flag[i] || (fx.flagPop[i] && !fx.flagPop[i].on && vt - fx.flagPop[i].t0 < 0.26)) {
            var fp = fx.flagPop[i] && vt - fx.flagPop[i].t0 < 0.3 ? fx.flagPop[i] : null;
            var wrong = ended && st.mine && !st.mine[i];
            drawPennant(bx + cs / 2, by + cs / 2 + bob, cs * 0.8, fp, wrong, false);
          }
        }
      }
    }

    // a refused gesture: the shell shrugs the finger off
    if (fx.refuse) {
      var rp = (vt - fx.refuse.t0) / 0.4;
      if (rp >= 1) fx.refuse = null;
      else {
        var rr2 = cellRect(fx.refuse.x, fx.refuse.y);
        ctx.save();
        ctx.globalAlpha = (1 - rp) * 0.9;
        ctx.translate(Math.sin(rp * 34) * cs * 0.05 * (1 - rp), 0);
        roundRect(ctx, rr2.x + cs * 0.06, rr2.y + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.24);
        ctx.strokeStyle = 'rgba(255,170,120,0.9)';
        ctx.lineWidth = Math.max(1.4, cs * 0.06);
        ctx.stroke();
        ctx.restore();
      }
    }

    // keyboard cursor, only while the keyboard is in use
    if (fx.cursor) {
      var cr = cellRect(fx.cursor.x, fx.cursor.y);
      ctx.save();
      roundRect(ctx, cr.x + 1.5, cr.y + 1.5, cs - 3, cs - 3, cs * 0.26);
      ctx.strokeStyle = 'rgba(255,212,121,' + (0.55 + Math.sin(vt * 5) * 0.25).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.5, cs * 0.06);
      ctx.stroke();
      ctx.restore();
    }

    // board frame
    ctx.save();
    roundRect(ctx, ox - 3, oy - 3, boardW + 6, boardH + 6, Math.max(6, cs * 0.3));
    ctx.strokeStyle = 'rgba(140,220,215,0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawEffects() {
    var i;
    for (i = fx.rings.length - 1; i >= 0; i--) {
      var r = fx.rings[i];
      var p = (vt - r.t0) / r.dur;
      if (p >= 1) { fx.rings.splice(i, 1); continue; }
      if (p < 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.arc(r.x, r.y, easeOut(p) * r.r1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200,255,250,' + ((1 - p) * 0.4).toFixed(3) + ')';
      ctx.lineWidth = r.wide * (1 - p) + 0.6;
      ctx.stroke();
      ctx.restore();
    }

    for (i = fx.particles.length - 1; i >= 0; i--) {
      var pt = fx.particles[i];
      pt.life += 0.016;
      if (pt.life < 0) continue;
      if (pt.life > pt.max) { fx.particles.splice(i, 1); continue; }
      var t = pt.life / pt.max;
      pt.x += pt.vx * 0.016;
      pt.y += pt.vy * 0.016;
      pt.vy += (pt.kind === 'pearl' ? 42 : 150) * 0.016;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = pt.kind === 'pearl' ? '#ffe9b0' : 'rgba(206,247,244,0.9)';
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------- host */

  function hostSize() { return clamp(hostH * 0.72, 32, 76); }

  // How much room the host needs under the board once the ceremony lifts it.
  function hostClearance() { return hostSize() * 1.15 + 10; }

  function drawHost() {
    var st = S.game.state();
    var size = hostSize();
    var base = H - hostH * 0.34;
    if (cer.t > 0.001) {
      // Stand it in the gap the ceremony opened, clear of the card below.
      base = lerp(base, H - cer.reserve - size * 0.55, cer.t);
    }
    var hx = Math.max(size * 0.85, W * 0.17) + host.lean * size * 0.5;
    var hop = Math.sin(clamp(host.hop, 0, 1) * Math.PI) * size * 0.45;
    var hy = base - size * 0.16 - host.rise * size * 0.12 - hop + Math.sin(vt * 1.7) * size * 0.05;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(host.tilt * 0.5);

    // shadow
    ctx.beginPath();
    ctx.ellipse(0, size * 0.52, size * 0.6, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    // spiral shell
    ctx.save();
    ctx.rotate(-0.2 + host.lean * 0.1);
    var sg = ctx.createLinearGradient(-size * 0.5, -size * 0.5, size * 0.5, size * 0.5);
    sg.addColorStop(0, '#ffd9b0');
    sg.addColorStop(0.5, '#ffab7d');
    sg.addColorStop(1, '#d2705a');
    ctx.beginPath();
    ctx.arc(-size * 0.06, -size * 0.06, size * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.beginPath();
    for (var a = 0; a < Math.PI * 3.4; a += 0.12) {
      var rr = size * 0.44 * (1 - a / (Math.PI * 3.9));
      var px = -size * 0.06 + Math.cos(a + 0.6) * rr;
      var py = -size * 0.06 + Math.sin(a + 0.6) * rr;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(150,64,48,0.55)';
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-size * 0.22, -size * 0.24, size * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
    ctx.restore();

    // legs, tucked under the body
    ctx.strokeStyle = '#3aa091';
    ctx.lineWidth = Math.max(1.2, size * 0.058);
    ctx.lineCap = 'round';
    for (var l = 0; l < 3; l++) {
      var lp = Math.sin(vt * 4 + l * 1.3) * size * 0.045 * (host.mood === 'idle' ? 1 : 1.8);
      var lx = size * (0.16 + l * 0.13);
      ctx.beginPath();
      ctx.moveTo(lx, size * 0.3);
      ctx.quadraticCurveTo(lx + size * 0.07, size * 0.44 + lp, lx + size * 0.02, size * 0.5);
      ctx.stroke();
    }

    // body
    ctx.beginPath();
    ctx.ellipse(size * 0.3, size * 0.16, size * 0.29, size * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#54c9b4';
    ctx.fill();

    // claws, out where they can be read
    var CLAWS = [
      { x: 0.62, y: 0.02, s: 1.0, w: 1 },
      { x: 0.40, y: 0.32, s: 0.78, w: 0.6 }
    ];
    for (var c = 0; c < 2; c++) {
      var cf = CLAWS[c];
      var lift = host.claw * size * 0.46 * cf.w;
      var cxp = size * cf.x;
      var cyp = size * cf.y - lift + Math.sin(vt * 3 + c * 1.7) * size * 0.018;
      ctx.save();
      ctx.translate(cxp, cyp);
      ctx.rotate(-host.claw * 0.6 + (c === 1 ? 0.5 : -0.1));
      ctx.scale(cf.s, cf.s);
      ctx.strokeStyle = '#3aa091';
      ctx.lineWidth = Math.max(1.4, size * 0.075);
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, size * 0.06);
      ctx.lineTo(-size * 0.02, 0);
      ctx.stroke();
      // pincer: two halves with a gap that opens when the host is pleased
      var gap = 0.10 + Math.max(0, host.claw) * 0.16;
      ctx.save();
      ctx.translate(size * 0.08, 0);
      ctx.rotate(-gap);
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.045, size * 0.13, size * 0.062, -0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#ff9a7a';
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(size * 0.08, 0);
      ctx.rotate(gap);
      ctx.beginPath();
      ctx.ellipse(0, size * 0.045, size * 0.13, size * 0.062, 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#f2876a';
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }

    // eyestalks
    for (var e = 0; e < 2; e++) {
      var ex = size * (0.24 + e * 0.17);
      var ey = size * (-0.02 - e * 0.03);
      var stalk = size * (0.28 + host.eye * 0.05);
      var eyeX = ex + host.lean * size * 0.07;
      var eyeY = ey - stalk + size * 0.1;
      ctx.beginPath();
      ctx.moveTo(ex, size * 0.1);
      ctx.lineTo(eyeX, eyeY + size * 0.04);
      ctx.strokeStyle = '#3aa091';
      ctx.lineWidth = Math.max(1.2, size * 0.055);
      ctx.stroke();
      var eyeR = size * 0.115 * clamp(host.eye, 0.55, 1.5);
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#f7fffd';
      ctx.fill();
      if (host.mood === 'hurt') {
        ctx.strokeStyle = '#2a3b44';
        ctx.lineWidth = Math.max(1, size * 0.04);
        ctx.beginPath();
        ctx.moveTo(eyeX - eyeR * 0.6, eyeY - eyeR * 0.6);
        ctx.lineTo(eyeX + eyeR * 0.6, eyeY + eyeR * 0.6);
        ctx.moveTo(eyeX + eyeR * 0.6, eyeY - eyeR * 0.6);
        ctx.lineTo(eyeX - eyeR * 0.6, eyeY + eyeR * 0.6);
        ctx.stroke();
      } else if (host.blink > 0) {
        ctx.beginPath();
        ctx.moveTo(eyeX - eyeR, eyeY);
        ctx.lineTo(eyeX + eyeR, eyeY);
        ctx.strokeStyle = '#2a3b44';
        ctx.lineWidth = Math.max(1, size * 0.045);
        ctx.stroke();
      } else {
        var look = host.lean * 0.4 + (host.mood === 'tense' ? Math.sin(vt * 9) * 0.12 : 0);
        ctx.beginPath();
        ctx.arc(eyeX + eyeR * look, eyeY - eyeR * 0.12, eyeR * 0.52, 0, Math.PI * 2);
        ctx.fillStyle = '#17313c';
        ctx.fill();
      }
    }
    ctx.restore();

    // little emotes, drawn in the water beside the host
    if (host.mood === 'happy' || host.mood === 'proud') {
      for (var b = 0; b < 3; b++) {
        var t = (vt * 0.9 + b * 0.33) % 1;
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.beginPath();
        ctx.arc(hx + size * 0.7 + Math.sin(t * 6 + b) * 5, hy - size * 0.5 - t * size * 1.5, 2 + b, 0, Math.PI * 2);
        ctx.strokeStyle = '#cdfaf3';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    } else if (host.mood === 'tense') {
      ctx.save();
      ctx.globalAlpha = 0.75 + Math.sin(vt * 6) * 0.2;
      ctx.beginPath();
      var dx = hx + size * 0.72, dy = hy - size * 0.62 + Math.sin(vt * 2) * 2;
      ctx.moveTo(dx, dy - 5);
      ctx.quadraticCurveTo(dx + 4, dy + 2, dx, dy + 4);
      ctx.quadraticCurveTo(dx - 4, dy + 2, dx, dy - 5);
      ctx.fillStyle = '#a9e6ff';
      ctx.fill();
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ frame */

  function paint() {
    if (!ctx) return;
    var shake = fx.shake > 0 ? fx.shake : 0;
    ctx.save();
    if (shake > 0) {
      ctx.translate((rand() - 0.5) * shake * 14, (rand() - 0.5) * shake * 14);
    }
    drawWater();
    drawFish();
    ctx.save();
    if (cer.k < 0.999) {
      ctx.translate(W / 2, oy);
      ctx.scale(cer.k, cer.k);
      ctx.translate(-W / 2, -oy);
    }
    drawBoard();
    drawEffects();
    ctx.restore();
    drawRim();
    drawHost();
    ctx.restore();

    if (fx.clearGlow > 0) {
      ctx.save();
      ctx.globalAlpha = fx.clearGlow * 0.4;
      var cg = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H * 0.45, Math.max(W, H) * 0.7);
      cg.addColorStop(0, 'rgba(190,255,240,0.55)');
      cg.addColorStop(1, 'rgba(190,255,240,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (fx.flash > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(' + fx.flashColor + ',' + (fx.flash * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // a low tide darkens the water at the edges: the hush, made visible
    var st = S.game.state();
    var tide = S.game.tideFraction();
    if (st.phase === 'playing' && st.firstTurnDone && tide < 0.3) {
      var k = (0.3 - tide) / 0.3;
      ctx.save();
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
      vg.addColorStop(0, 'rgba(10,20,30,0)');
      vg.addColorStop(1, 'rgba(6,14,22,' + (k * 0.5).toFixed(3) + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function frame(dtMs) {
    var dt = Math.min(0.05, dtMs / 1000);
    vt += dt;
    var gs = S.game.state();
    if (gs.w !== gridW || gs.h !== gridH) resize();
    fx.shake = Math.max(0, fx.shake - dt * 2.6);
    fx.flash = Math.max(0, fx.flash - dt * 1.8);
    fx.clearGlow = Math.max(0, fx.clearGlow - dt * 1.1);
    var targetK = 1;
    if (cer.on && boardH > 0) {
      targetK = clamp((H - cer.reserve - oy - hostClearance()) / boardH, 0.42, 1);
    }
    cer.t = lerp(cer.t, cer.on ? 1 : 0, 1 - Math.pow(0.004, dt));
    cer.k = lerp(1, targetK, cer.t);
    updateHost(dt);
    paint();
  }

  S.view = {
    init: function (el) {
      canvas = el;
      ctx = canvas.getContext('2d');
      try {
        var mq = g.matchMedia('(prefers-reduced-motion: reduce)');
        calm = mq.matches;
        if (mq.addEventListener) mq.addEventListener('change', function (e) { calm = e.matches; });
      } catch (e) { calm = false; }
      resize();
      S.game.on(onGameEvent);
    },
    resize: resize,
    frame: frame,
    drawNow: paint,
    hit: hit,
    cellRect: cellRect,
    setPress: function (p) { fx.press = p; },
    setCursor: function (c) { fx.cursor = c ? { x: c.x, y: c.y } : null; },
    setCeremony: function (on, reserve) { cer.on = !!on; cer.reserve = reserve || 0; },
    nudge: function (x, y) {
      fx.refuse = { x: x, y: y, t0: vt };
      fx.rings.push({
        x: ox + (x + 0.5) * cs, y: oy + (y + 0.5) * cs,
        t0: vt, dur: 0.3, r1: cs * 0.9, wide: 2.2
      });
    },
    palette: PALETTE,
    numColors: NUM_COLORS,
    host: host,
    lastRippleSize: function () { return fx.lastRippleSize; }
  };
})(window);
