(function (root) {
'use strict';

var TAU = Math.PI * 2;
function hash01(n) {
  var s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

var PAL = {
  void0: '#060410',
  strata1: '#120c22', strata2: '#191129', strata3: '#211736',
  wallFace: '#2b2049', wallDeep: '#17102b', wallEdge: '#8d79d6',
  wallInner: '#43346e', rimWarm: 'rgba(255,190,110,0.05)',
  amber: '#ffb545', amberDim: '#c97e22', amberHi: '#ffe29a',
  cyan: '#4ef0cf', cyanDim: '#1e8f7c', iceWhite: '#dffcf4',
  magenta: '#ff5d8f',
  danger: '#ff4d5e',
  gunmetal: '#3a3050', steel: '#5b4f7d',
  ink: '#0a0714'
};

function createVisual(core, canvas, hooks) {
  hooks = hooks || {};
  var session = hooks.session || { best: 0, runs: 0 };
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1, S = 1;
  var vw = 1280;

  var VS = null;
  var pt = { x: 0, y: 0 };
  var camXs = 0, camInit = false;
  var trauma = 0, flash = 0, hurtT = 0, grazePulse = 0, lastGrazeCombo = 0;
  var powerFxT = 0, prevPowered = false;
  var overAt = 0, prevRank = null, prevPhase = '';
  var blinkT = 1.2, idleClock = 0, steerUsedT = -1, runStartSeen = false;
  var drillSpin = 0, exhAcc = 0;
  var tickSecPrev = -1;
  var newBestFlag = false;
  var particles = [], floaters = [], streaks = [];
  var pointerKind = (hooks.pointer && hooks.pointer.kind) || 'touch';
  var shakeSeed = Math.random() * 1000;

  var CON = core.consts;

  /* ---------- particles ---------- */
  function spawn(p) {
    if (particles.length < 360) particles.push(p);
  }
  function floatText(x, y, txt, col) {
    if (floaters.length < 14) floaters.push({ x: x, y: y, txt: txt, col: col, t: 0 });
  }

  function rockBurst(wx, wd, shade) {
    for (var i = 0; i < 12; i++) {
      spawn({
        kind: 'chip', x: wx, d: wd,
        vx: (Math.random() - 0.5) * 130, vy: -(Math.random() * 60),
        vr: Math.random() * 240 - 120,
        r: 2 + Math.random() * 4.5, t: 0, life: 0.55 + Math.random() * 0.4,
        c: shade
      });
    }
    spawn({ kind: 'ring', x: wx, d: wd, r: 6, t: 0, life: 0.32, c: PAL.amber });
  }

  function collectBurst(wx, wd, col) {
    for (var i = 0; i < 8; i++) {
      var a = Math.random() * TAU;
      spawn({
        kind: 'spark', x: wx, d: wd,
        vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40,
        r: 1.4 + Math.random() * 2.2, t: 0, life: 0.4 + Math.random() * 0.25, c: col
      });
    }
    spawn({ kind: 'ring', x: wx, d: wd, r: 4, t: 0, life: 0.3, c: col });
  }

  function puffSmoke(wx, wd, big) {
    spawn({ kind: 'puff', x: wx + (Math.random() - 0.5) * 12, d: wd,
            vy: -30 - Math.random() * 40, vx: (Math.random() - 0.5) * 26,
            r: (big ? 7 : 4) + Math.random() * 4, t: 0, life: 0.5 + Math.random() * 0.3,
            c: 'rgba(200,180,230,' });
  }

  function grazeFx(wxa, wda, wxb, wdb, combo) {
    var mx = (wxa + wxb) / 2, md = (wda + wdb) / 2;
    spawn({ kind: 'ring', x: mx, d: md, r: 8, t: 0, life: 0.26 + combo * 0.02, c: combo >= 3 ? PAL.magenta : PAL.cyan });
    for (var i = 0; i < 3 + combo; i++) {
      spawn({ kind: 'spark', x: mx, d: md,
              vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.5) * 160,
              r: 1.5, t: 0, life: 0.3, c: PAL.cyan });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      if (p.kind !== 'ring') {
        p.x += p.vx * dt; p.d += p.vy * dt;
        if (p.kind === 'chip') p.vr *= (1 - dt);
      }
      if (p.kind === 'ring') p.r += 340 * dt;
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.t += dt; f.d -= 46 * dt;
      if (f.t > 0.75) floaters.splice(i, 1);
    }
  }

  /* ---------- fx event routing ---------- */
  function feedEvents(dt) {
    var evs = core.consumeFx();
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      switch (e.kind) {
        case 'rock_hit':
        case 'wall_contact': {
          var isWall = e.kind === 'wall_contact';
          trauma = Math.min(1, trauma + (isWall ? 0.55 : 0.62));
          flash = Math.max(flash, isWall ? 0.1 : 0.13);
          hurtT = 0.5;
          if (!isWall && VS && VS.player.d) rockBurst(VS.player.x, VS.player.d + 10, '#8a76bb');
          if (hooks.sound) hooks.sound(isWall ? 'impact' : 'impact', {});
          break;
        }
        case 'rock_broken':
          trauma = Math.min(1, trauma + 0.3);
          if (VS) rockBurst(VS.player.x, VS.player.d + 8, '#a48fd6');
          if (hooks.sound) hooks.sound('shatter');
          break;
        case 'fragment':
          if (VS) {
            var cx = VS.player.x, cd2 = VS.player.d + 6;
            collectBurst(cx, cd2, PAL.cyan);
            floatText(cx, cd2 - 8, '+' + (CON.fragTime / 1000 * (1 - 0.3 * VS.difficulty)).toFixed(1) + 's', PAL.cyan);
          }
          if (hooks.sound) hooks.sound('fragment', { combo: VS ? VS.combo : 0 });
          break;
        case 'power':
          powerFxT = 0.9; prevPowered = true;
          if (hooks.sound) hooks.sound('power');
          break;
        case 'near_miss':
          if (VS) {
            lastGrazeCombo = VS.combo;
            grazePulse = Math.min(1, 0.45 + lastGrazeCombo * 0.09);
            grazeFx(VS.player.x, VS.player.d - 14, VS.player.x + 10, VS.player.d - 6, lastGrazeCombo);
          }
          trauma = Math.min(1, trauma + 0.08 + lastGrazeCombo * 0.04);
          if (hooks.sound) hooks.sound('graze', { combo: lastGrazeCombo });
          break;
      }
    }
  }

  /* ---------- layout ---------- */
  function resize() {
    DPR = clamp(root.devicePixelRatio || 1, 1, 2);
    W = canvas.clientWidth || root.innerWidth;
    H = canvas.clientHeight || root.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    S = Math.min(H / vw, W / 470);
  }

  /* coordinate transforms (css-px space) */
  var camDepth = 0;
  function X(wx) { return W / 2 + (wx - camXs) * S; }
  function Y(wd) { return H * 0.28 + (wd - camDepth) * S; }
  function invX(sx) { return (sx - W / 2) / S + camXs; }
  function invY(sy) { return (sy - H * 0.28) / S + camDepth; }

  /* ---------- text helpers ---------- */
  function caps(txt, x, y, size, align, color, spacing, weight) {
    ctx.save();
    ctx.font = (weight || 800) + ' ' + size + 'px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    spacing = spacing == null ? Math.max(1, size * 0.08) : spacing;
    var widths = [];
    var total = 0;
    for (var i = 0; i < txt.length; i++) { var w = ctx.measureText(txt[i]).width; widths.push(w); total += w + (i < txt.length - 1 ? spacing : 0); }
    var cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.fillStyle = color;
    for (i = 0; i < txt.length; i++) {
      ctx.fillText(txt[i], cx, y);
      cx += widths[i] + spacing;
    }
    ctx.restore();
    return total;
  }

  /* DELVE wordmark - hand-built block glyphs */
  var GLYPHS = {
    'D': [[[0, 0], [0.52, 0], [0.74, 0.2], [0.74, 0.8], [0.52, 1], [0, 1]],
           [[0.22, 0.2], [0.44, 0.2], [0.55, 0.31], [0.55, 0.69], [0.44, 0.8], [0.22, 0.8]]],
    'E': [[[0, 0], [0.68, 0], [0.68, 0.2], [0.22, 0.2], [0.22, 0.4], [0.55, 0.4], [0.55, 0.57], [0.22, 0.57], [0.22, 0.8], [0.68, 0.8], [0.68, 1], [0, 1]]],
    'L': [[[0, 0], [0.22, 0], [0.22, 0.8], [0.66, 0.8], [0.66, 1], [0, 1]]],
    'V': [[[0, 0], [0.24, 0], [0.5, 0.72], [0.76, 0], [1, 0], [0.64, 1], [0.36, 1]]]
  };
  function wordmark(cx, cy, hgt) {
    var seq = ['D', 'E', 'L', 'V', 'E'];
    var gw = hgt * 0.74, sp = hgt * 0.17;
    var totalW = seq.length * gw + (seq.length - 1) * sp;
    var x0 = cx - totalW / 2;
    for (var i = 0; i < seq.length; i++) {
      var g = GLYPHS[seq[i]];
      ctx.save();
      ctx.translate(x0 + i * (gw + sp), cy - hgt / 2);
      ctx.beginPath();
      for (var k = 0; k < g.length; k++) {
        var poly = g[k];
        for (var m = 0; m < poly.length; m++) {
          var px = poly[m][0] * gw, py = poly[m][1] * hgt;
          if (m === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      var gr = ctx.createLinearGradient(0, -hgt * 0.2, 0, hgt * 1.1);
      gr.addColorStop(0, PAL.amberHi); gr.addColorStop(0.55, PAL.amber); gr.addColorStop(1, '#c76a1d');
      ctx.fillStyle = gr;
      ctx.fill('evenodd');
      ctx.shadowColor = 'rgba(255,170,60,0.45)';
      ctx.shadowBlur = hgt * 0.4;
      ctx.fill('evenodd');
      ctx.restore();
    }
  }

  /* ---------- world helpers ---------- */
  var geoCache = { fromD: 0, toD: 0, arr: null };
  function sampleGeo(fromD, toD, step) {
    var n = Math.ceil((toD - fromD) / step) + 2;
    var arr = [];
    core.geometryAt(fromD - step, toD + step, n, function (d, c, w, ch) {
      arr.push([d, c, w]);
    });
    return arr;
  }
  function jitL(d) { return (hash01(Math.floor(d / 23) * 7.77) - 0.5) * 18; }
  function jitR(d) { return (hash01(Math.floor(d / 23) * 3.31 + 500) - 0.5) * 18; }

  function drawBackground(camDt) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, PAL.strata1);
    g.addColorStop(0.5, '#0d0819');
    g.addColorStop(1, PAL.void0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var layers = [
      { sc: 0.25, rmin: 40, rmax: 90, n: 9, c: 'rgba(38,27,66,0.55)' },
      { sc: 0.5, rmin: 26, rmax: 54, n: 11, c: 'rgba(52,38,92,0.4)' },
      { sc: 0.75, rmin: 14, rmax: 34, n: 14, c: 'rgba(70,52,118,0.3)' }
    ];
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var seedBase = Math.floor(camDepth * L.sc / 900) - 1;
      for (var k = 0; k < L.n; k++) {
        var idx = seedBase + ((k % 3) - 1);
        for (var j = 0; j < 3; j++) {
          var h1v = hash01(idx * 13.7 + li * 71.3 + j * 29.9);
          var hy = hash01(idx * 91.3 + j * 17.1 + li * 5.7);
          var blobD = (idx + h1v) * 900 + hy * 900;
          var sy = H * 0.7 + (blobD - camDepth * L.sc) * S;
          if (sy < -120 || sy > H + 120) continue;
          var bx = W * hash01(idx * 41.9 + j * 3.3 + li);
          var rr = (L.rmin + (L.rmax - L.rmin) * hash01(idx + j * 9.1)) * S * 0.5;
          ctx.fillStyle = L.c;
          ctx.beginPath();
          ctx.ellipse(bx, sy, rr * (1.3 + hash01(j * 3.7)), rr * 0.8, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    var moteN = 26;
    for (k = 0; k < moteN; k++) {
      var mv = hash01(k * 177.7);
      var myD = (mv * 1400 + k * 53 - ((camDepth * 0.55) % 1400));
      var sy2 = H * 0.7 + (myD % 1400 - 700) * S * 0.6;
      var sx2 = W * hash01(k * 43.21);
      var tw = 0.4 + 0.6 * Math.abs(Math.sin(idleClock * (1 + hash01(k)) + k));
      ctx.fillStyle = 'rgba(190,170,240,' + (0.06 + 0.1 * hash01(k * 3.1)) * tw + ')';
      ctx.fillRect(sx2, ((sy2 % (H + 40)) + H + 40) % (H + 40) - 20, 2, 2);
    }
  }

  function drawSkyRig(topOfShaftY) {
    if (topOfShaftY > H + 60 || topOfShaftY <= 6) return;
    var hh = Math.max(0, topOfShaftY);
    var sky = ctx.createLinearGradient(0, 0, 0, hh + 40);
    sky.addColorStop(0, '#141026');
    sky.addColorStop(1, '#241a3e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, hh);

    for (var i = 0; i < 40; i++) {
      var stx = hash01(i * 5.3) * W, sty = hash01(i * 9.1) * hh * 0.9;
      ctx.fillStyle = 'rgba(210,200,255,' + (0.25 + 0.5 * hash01(i * 1.7)) + ')';
      ctx.fillRect(stx, sty, 2, 2);
    }
    var rigCx = X(0);
    ctx.strokeStyle = '#161024'; ctx.lineWidth = 10 * S;
    ctx.beginPath(); ctx.moveTo(rigCx - 150 * S, hh); ctx.lineTo(rigCx - 105 * S, hh - 130 * S); ctx.lineTo(rigCx + 105 * S, hh - 130 * S); ctx.lineTo(rigCx + 150 * S, hh); ctx.stroke();
    ctx.lineWidth = 5 * S;
    ctx.beginPath(); ctx.moveTo(rigCx - 70 * S, hh); ctx.lineTo(rigCx, hh - 90 * S); ctx.lineTo(rigCx + 70 * S, hh); ctx.stroke();
    ctx.fillStyle = '#ffd98c';
    ctx.shadowColor = '#ffd98c'; ctx.shadowBlur = 22 * S;
    ctx.beginPath(); ctx.arc(rigCx, hh - 100 * S, 5 * S, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;

    var grd = ctx.createLinearGradient(0, hh - 6, 0, hh + 26);
    grd.addColorStop(0, '#171026'); grd.addColorStop(1, '#0f0a1c');
    ctx.fillStyle = grd;
    ctx.fillRect(0, hh - 4, W, 34);
  }

  function drawPadAndShaft(depthArr) {
    for (var i = 0; i < depthArr.length - 1; i++) {
      var d0 = depthArr[i], d1 = depthArr[i + 1];
      if (d0[0] < -50) continue;
      if (d0[0] > 40) break;
      var wmax = Math.max(d0[2], d1[2]) + 60;
      var y0 = Y(-40), y1 = Y(10);
      ctx.fillStyle = '#120c1f';
      ctx.fillRect(X(-wmax), y0 - 8 * S, wmax * 2 * S, y1 - y0 + 10 * S);
      var stripes = 9;
      for (var sI = 0; sI < stripes; sI++) {
        var sx0 = X(-wmax) + sI / stripes * wmax * 2 * S;
        ctx.fillStyle = sI % 2 === 0 ? 'rgba(255,181,69,0.85)' : 'rgba(20,12,30,0.9)';
        ctx.beginPath();
        ctx.moveTo(sx0, y0 - 8 * S);
        ctx.lineTo(sx0 + (wmax * 2 / stripes) * S, y0 - 8 * S);
        ctx.lineTo(sx0 + (wmax * 2 / stripes) * S - 9 * S, y0 + 6 * S);
        ctx.lineTo(sx0 - 9 * S, y0 + 6 * S);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawCorridor(depthArr) {
    ctx.lineJoin = 'round';

    function edgePath(sel, selJ) {
      ctx.beginPath();
      for (var i = 0; i < depthArr.length; i++) {
        var v = depthArr[i];
        var ex = X(v[1] + sel * (v[2] + selJ(v[0])));
        var ey = Y(v[0]);
        if (i === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
      }
    }

    for (var pass = 0; pass < 2; pass++) {
      var sel = pass === 0 ? -1 : 1;
      var beyondX = sel < 0 ? -W : W * 2;
      edgePath(sel, pass === 0 ? jitL : jitR);
      var lastPt = depthArr[depthArr.length - 1];
      var firstPt = depthArr[0];
      ctx.lineTo(beyondX, Y(lastPt[0]));
      ctx.lineTo(beyondX, Y(firstPt[0]));
      ctx.closePath();
      var wg = ctx.createLinearGradient(sel < 0 ? 0 : W, 0, sel < 0 ? W * 0.5 : W * 0.5, 0);
      wg.addColorStop(0, PAL.wallDeep);
      wg.addColorStop(0.75, '#221839');
      wg.addColorStop(1, PAL.wallFace);
      ctx.fillStyle = wg;
      ctx.fill();
      edgePath(sel, pass === 0 ? jitL : jitR);
      ctx.strokeStyle = 'rgba(155,133,232,0.8)';
      ctx.lineWidth = Math.max(2, 2.5 * S);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,205,150,0.14)';
      ctx.lineWidth = Math.max(1, 1.2 * S);
      ctx.stroke();
    }

    var innerStep = 8;
    for (var i = 0; i < depthArr.length - 1; i += 3) {
      var v0 = depthArr[i], v1 = depthArr[Math.min(depthArr.length - 1, i + 3)];
      if (hash01(Math.floor(v0[0] / 61) * 5.51) < 0.4) continue;
      var ly0 = Y(v0[0]), ly1 = Y(v1[0]);
      var side = hash01(Math.floor(v0[0] / 97) * 8.81) < 0.5 ? -1 : 1;
      var cxj = v0[1] + side * v0[2] * 0.55;
      ctx.fillStyle = 'rgba(20,13,36,0.5)';
      ctx.beginPath();
      ctx.ellipse(X(cxj), (ly0 + ly1) / 2, 5 * S, (ly1 - ly0) * 0.5, 0, 0, TAU);
      ctx.fill();
    }
  }

    function drawStreaks(sn, dt) {
    if (sn <= 0.05) { streaks.length = 0; return; }
    var want = Math.floor(sn * 26);
    while (streaks.length < want) streaks.push({ x: Math.random(), o: Math.random(), v: 0.7 + Math.random() * 0.8 });
    streaks.length = want;
    var fall = (600 + 1400 * sn) * S * dt * (0.4 + sn);
    ctx.save();
    for (var i = 0; i < streaks.length; i++) {
      var st = streaks[i];
      st.o += st.v * dt * (0.7 + sn);
      if (st.o > 1) { st.o -= 1; st.x = Math.random(); }
      var sxp = st.x * W;
      var len = (40 + 190 * sn * st.v) * S;
      var yy = (st.o * (H + 200)) % (H + 200) - 100 + fall * 0;
      var aa = 0.04 + 0.16 * sn;
      var gr = ctx.createLinearGradient(0, yy, 0, yy + len);
      gr.addColorStop(0, 'rgba(190,225,255,0)');
      gr.addColorStop(0.5, 'rgba(190,225,255,' + aa.toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(190,225,255,0)');
      ctx.fillStyle = gr;
      var wdt = Math.max(1, 2.2 * S * (0.5 + st.v * 0.5));
      ctx.fillRect(sxp, yy, wdt, len);
    }
    ctx.restore();
  }

  /* ---------- entities ---------- */

  function drawFragments(items, nowMs) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var y = Y(it.d);
      if (it.kind === 'fragment') {
        if (!it.active) continue;
        if (y < -30 || y > H + 30) continue;
        var ph = hash01(parseInt(it.id.slice(1), 10) * 0.117) * TAU;
        var pul = 0.82 + 0.18 * Math.sin(nowMs / 380 + ph);
        var x = X(it.x);
        var rr = 11 * S * pul;
        var gg = ctx.createRadialGradient(x, y, 1, x, y, rr * 2.6);
        gg.addColorStop(0, 'rgba(90,240,205,0.5)');
        gg.addColorStop(1, 'rgba(90,240,205,0)');
        ctx.fillStyle = gg;
        ctx.beginPath(); ctx.arc(x, y, rr * 2.6, 0, TAU); ctx.fill();

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(nowMs / 700 + ph) * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, -rr); ctx.lineTo(rr * 0.62, 0); ctx.lineTo(0, rr); ctx.lineTo(-rr * 0.62, 0);
        ctx.closePath();
        var fg = ctx.createLinearGradient(0, -rr, 0, rr);
        fg.addColorStop(0, PAL.iceWhite); fg.addColorStop(0.45, PAL.cyan); fg.addColorStop(1, PAL.cyanDim);
        ctx.fillStyle = fg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(230,255,250,0.8)';
        ctx.lineWidth = Math.max(1, 1.4 * S);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(x, y - rr * 0.15, Math.max(1.2, 2.1 * S * pul), 0, TAU); ctx.fill();
      } else {
        if (y < -40 || y > H + 40) continue;
        var px = X(it.x);
        var rot = nowMs / 600;
        ctx.save();
        ctx.translate(px, y);
        var pg = ctx.createRadialGradient(0, 0, 2, 0, 0, 34 * S);
        pg.addColorStop(0, 'rgba(255,206,90,0.55)');
        pg.addColorStop(1, 'rgba(255,206,90,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(0, 0, 34 * S, 0, TAU); ctx.fill();
        for (var ring = 0; ring < 2; ring++) {
          ctx.save();
          ctx.rotate(rot * (ring ? -1.3 : 1) + ring);
          ctx.strokeStyle = ring ? 'rgba(255,214,130,0.85)' : 'rgba(255,196,74,0.95)';
          ctx.lineWidth = Math.max(1.5, 2.6 * S);
          var radii = (ring ? 19 : 14) * S;
          for (var seg = 0; seg < 6; seg++) {
            ctx.beginPath();
            ctx.arc(0, 0, radii, seg * TAU / 6, seg * TAU / 6 + TAU / 9);
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.rotate(rot);
        ctx.beginPath();
        for (seg = 0; seg < 6; seg++) {
          var aa2 = seg * TAU / 6;
          var hx = Math.cos(aa2) * 9 * S, hy2 = Math.sin(aa2) * 9 * S;
          if (seg === 0) ctx.moveTo(hx, hy2); else ctx.lineTo(hx, hy2);
        }
        ctx.closePath();
        var hg = ctx.createLinearGradient(-9 * S, -9 * S, 9 * S, 9 * S);
        hg.addColorStop(0, '#fff3cd'); hg.addColorStop(0.5, PAL.amber); hg.addColorStop(1, '#d1741f');
        ctx.fillStyle = hg;
        ctx.fill();
        ctx.fillStyle = '#fffbe8';
        ctx.beginPath(); ctx.arc(0, 0, 2.6 * S, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawRocks(rocks) {
    for (var i = 0; i < rocks.length; i++) {
      var r = rocks[i];
      if (!r.active) continue;
      var y = Y(r.d);
      if (y < -60 || y > H + 60) continue;
      var x = X(r.x);
      var rad = r.rc * S;
      var seedN = parseInt(r.id.slice(1), 10) || 1;
      ctx.save();
      ctx.translate(x, y);
      var lump = [];
      var nv = 7 + Math.floor(hash01(seedN * 3.3) * 3);
      for (var vi = 0; vi < nv; vi++) {
        var an = vi / nv * TAU + hash01(seedN + vi) * 0.3;
        var rv = rad * (0.78 + 0.3 * hash01(seedN * 7.7 + vi * 3.1));
        lump.push([Math.cos(an) * rv, Math.sin(an) * rv]);
      }
      ctx.beginPath();
      for (vi = 0; vi < nv; vi++) {
        if (vi === 0) ctx.moveTo(lump[vi][0], lump[vi][1]); else ctx.lineTo(lump[vi][0], lump[vi][1]);
      }
      ctx.closePath();
      var base = r.shade < 0.5 ? '#392e59' : '#463a6e';
      var gb = ctx.createLinearGradient(-rad, -rad, rad, rad * 0.6);
      gb.addColorStop(0, r.shade < 0.5 ? '#4a3d70' : '#5a4c86');
      gb.addColorStop(0.55, base);
      gb.addColorStop(1, '#241b3f');
      ctx.fillStyle = gb;
      ctx.fill();
      ctx.strokeStyle = 'rgba(16,10,30,0.8)';
      ctx.lineWidth = Math.max(1, 1.5 * S);
      ctx.stroke();
      var abovePlayer = y > Y(VS.player.d);
      if (abovePlayer) {
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,196,120,' + (0.12 + 0.16 * (1 - Math.min(1, Math.abs(y - H * 0.7) / H))) + ')';
        ctx.lineWidth = Math.max(1.4, 2.6 * S);
        ctx.beginPath();
        var started = false;
        for (vi = 0; vi <= nv; vi++) {
          var vj = lump[vi % nv];
          if (vj[1] <= rad * 0.05) {
            if (!started) { ctx.moveTo(vj[0], vj[1]); started = true; }
            else ctx.lineTo(vj[0], vj[1]);
          } else if (started && vi >= nv) break;
        }
        ctx.stroke();
        var ncx = (hash01(seedN * 11.1) - 0.5) * rad;
        var ncy = (hash01(seedN * 13.7) - 0.5) * rad;
        ctx.strokeStyle = 'rgba(14,9,26,0.75)';
        ctx.lineWidth = Math.max(1, 1.8 * S);
        ctx.beginPath();
        ctx.moveTo(ncx, ncy);
        ctx.lineTo(ncx + (hash01(seedN * 3.1) - 0.5) * rad, ncy + rad * 0.5);
        ctx.lineTo(ncx + (hash01(seedN * 7.9) - 0.5) * rad, ncy + rad);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------- the machine ---------- */

  function poseFromState(vs, nowMs) {
    var pl = vs.player;
    var sn = clamp((CON.top - pl.speed) / (CON.top - CON.crawl), 0, 1);
    var accel = heldAccel;
    var mood = 'coast';
    if (vs.phase === 'ready') mood = 'idle';
    else if (vs.phase === 'gameover') mood = 'spent';
    else if (pl.stall || hurtT > 0.001) mood = 'hurt';
    else if (grazePulse > 0.02) mood = 'graze';
    else if (sn < 0.2 && accel && !pl.stall) mood = 'thrill';
    else if (accel) mood = 'dig';
    var tilt = clamp(pl.latV / 300, -1, 1) * 0.5;
    var speedJitter = (mood === 'thrill') ? Math.sin(nowMs * 0.09) * 1.2 : 0;
    var sqx = 1, sqy = 1;
    if (mood === 'thrill') { sqy = 1.1; sqx = 0.93; }
    else if (mood === 'dig') { sqy = 1.045; sqx = 0.985; }
    else if (mood === 'hurt') { sqy = 0.8; sqx = 1.16; }
    else if (mood === 'idle') { sqy = 1 + Math.sin(nowMs / 420) * 0.015; }
    return { mood: mood, sn: sn, accel: accel, tilt: tilt, sqx: sqx, sqy: sqy, jitter: speedJitter };
  }

  var heldAccel = false;
  function drawMachine(px2, pd2, pose, vs, nowMs, dt) {
    var sx = X(px2), sy = Y(pd2);
    drillSpin += (pose.accel ? 26 : 6) * dt;
    var s = S;
    ctx.save();
    ctx.translate(sx, sy + pose.jitter * s);
    ctx.rotate(clamp(pose.tilt, -0.6, 0.6));

    var invinc = vs.invincible;
    if (invinc) {
      var arot = nowMs / 220;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,201,77,0.85)';
      ctx.lineWidth = Math.max(2, 3 * s);
      for (var seg = 0; seg < 8; seg++) {
        ctx.beginPath();
        ctx.arc(0, -4 * s, 30 * s, arot + seg * TAU / 8, arot + seg * TAU / 8 + 0.5);
        ctx.stroke();
      }
      var gg = ctx.createRadialGradient(0, 0, 6, 0, 0, 44 * s);
      gg.addColorStop(0, 'rgba(255,201,77,0.16)');
      gg.addColorStop(1, 'rgba(255,201,77,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(0, 0, 44 * s, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.scale(pose.sqx, pose.sqy);
    var spentK = pose.mood === 'spent' ? 1 : 0;
    var hullDark = spentK ? '#6f6580' : '#a75e17';
    var bodyGrad = ctx.createLinearGradient(-16 * s, -22 * s, 16 * s, 20 * s);
    bodyGrad.addColorStop(0, spentK ? '#8d849c' : PAL.amberHi);
    bodyGrad.addColorStop(0.45, spentK ? '#7b7290' : PAL.amber);
    bodyGrad.addColorStop(1, spentK ? '#5e5670' : hullDark);
    ctx.lineWidth = Math.max(1.4, 2 * s);
    ctx.strokeStyle = spentK ? '#3c3650' : '#6b3d12';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    var bw = 15 * s, bh = 21 * s;
    ctx.moveTo(-bw, -bh * 0.5);
    ctx.quadraticCurveTo(-bw, -bh, 0, -bh);
    ctx.quadraticCurveTo(bw, -bh, bw, -bh * 0.5);
    ctx.lineTo(bw * 0.72, bh * 0.55);
    ctx.quadraticCurveTo(bw * 0.3, bh, 0, bh);
    ctx.quadraticCurveTo(-bw * 0.3, bh, -bw * 0.72, bh * 0.55);
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = spentK ? 'rgba(40,34,56,0.5)' : 'rgba(122,69,20,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.36, bw * 0.6, bh * 0.2, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = spentK ? '#4e4864' : PAL.steel;
    ctx.beginPath();
    ctx.moveTo(-bw - 2 * s, -2 * s);
    ctx.lineTo(-bw - 7 * s, 5 * s);
    ctx.lineTo(-bw - 1 * s, 7 * s);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bw + 2 * s, -2 * s);
    ctx.lineTo(bw + 7 * s, 5 * s);
    ctx.lineTo(bw + 1 * s, 7 * s);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = spentK ? '#565070' : '#8d5424';
    ctx.fillRect(-bw * 0.62, -bh - 6 * s, 4.6 * s, 7 * s);
    ctx.fillRect(bw * 0.62 - 4.6 * s, -bh - 6 * s, 4.6 * s, 7 * s);
    ctx.fillStyle = spentK ? '#3c3650' : '#2c2137';
    ctx.fillRect(-bw * 0.62 - 1 * s, -bh - 8 * s, 6.6 * s, 2.6 * s);
    ctx.fillRect(bw * 0.62 - 1 * s - 2.6 * s, -bh - 8 * s, 6.6 * s, 2.6 * s);

    var eyeY = 4 * s;
    var eyeR = 8.4 * s;
    var cg = ctx.createRadialGradient(0, eyeY, eyeR * 0.2, 0, eyeY, eyeR);
    cg.addColorStop(0, spentK ? '#20202e' : '#0f2f38');
    cg.addColorStop(1, spentK ? '#15151f' : '#071a22');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(0, eyeY, eyeR, 0, TAU); ctx.fill();
    ctx.strokeStyle = spentK ? '#393350' : '#7a4514';
    ctx.lineWidth = Math.max(1.5, 2.2 * s);
    ctx.stroke();

    var lookX = clamp(pose.tilt * -1.4, -1, 1);
    var lookY = pose.mood === 'dig' || pose.mood === 'thrill' ? 0.7 : 0;
    if (pose.mood === 'idle') { lookX = Math.sin(nowMs / 700) * 0.7; lookY = Math.cos(nowMs / 1100) * 0.4; }
    var lidClosed = 0;
    if (pose.mood === 'coast') lidClosed = 0.55;
    if (pose.mood === 'spent') lidClosed = 1;
    if (pose.mood === 'idle') lidClosed = blink(nowMs);
    if (pose.mood === 'graze') lidClosed = -0.3;
    if (pose.mood === 'thrill') lidClosed = -0.12;

    if (lidClosed < 0.96) {
      ctx.fillStyle = spentK ? 'rgba(200,220,235,0.5)' : '#eafcff';
      ctx.save();
      ctx.beginPath();
      ctx.rect(-eyeR, eyeY - eyeR, eyeR * 2, eyeR * 2 * (lidClosed <= 0 ? 1 : 1 - lidClosed));
      ctx.clip();
      var pupX = lookX * eyeR * 0.34, pupY = eyeY + lookY * eyeR * 0.3;
      if (pose.mood === 'hurt') {
        drawXPupil(pupX, pupY, eyeR * 0.42, s);
      } else {
        var squint = pose.mood === 'dig' ? 0.62 : pose.mood === 'graze' ? 1.15 : 1;
        ctx.fillStyle = '#101b22';
        ctx.beginPath();
        ctx.ellipse(pupX, pupY, eyeR * 0.34 / squint, eyeR * 0.34 * (pose.mood === 'graze' ? 1.35 : 1), 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,240,255,0.9)';
        ctx.beginPath();
        ctx.arc(pupX, pupY, eyeR * 0.12, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    } else {
      ctx.strokeStyle = 'rgba(230,250,255,0.6)';
      ctx.lineWidth = Math.max(1.2, 1.8 * s);
      ctx.beginPath(); ctx.arc(0, eyeY, eyeR * 0.8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }

    ctx.strokeStyle = spentK ? '#393350' : '#5c3210';
    ctx.lineWidth = Math.max(2, 3 * s);
    ctx.beginPath();
    var browY = eyeY - eyeR - 1.5 * s;
    if (pose.mood === 'dig' || pose.mood === 'thrill') {
      ctx.moveTo(-bw * 0.62, browY + 3.4 * s);
      ctx.lineTo(bw * 0.62, browY - 1.2 * s);
    } else if (pose.mood === 'graze') {
      ctx.moveTo(-bw * 0.62, browY - 3 * s);
      ctx.lineTo(bw * 0.62, browY + 2.4 * s);
    } else {
      ctx.moveTo(-bw * 0.58, browY);
      ctx.lineTo(bw * 0.58, browY);
    }
    ctx.stroke();

    var dh = 13 * s;
    ctx.fillStyle = spentK ? '#494264' : '#57607a';
    ctx.beginPath();
    ctx.moveTo(-9.5 * s, bh * 0.86);
    ctx.lineTo(9.5 * s, bh * 0.86);
    ctx.lineTo(4.5 * s, bh * 0.86 + dh);
    ctx.lineTo(-4.5 * s, bh * 0.86 + dh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#22283a';
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.stroke();
    if (!spentK) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-9.5 * s, bh * 0.86); ctx.lineTo(9.5 * s, bh * 0.86);
      ctx.lineTo(4.5 * s, bh * 0.86 + dh); ctx.lineTo(-4.5 * s, bh * 0.86 + dh);
      ctx.closePath(); ctx.clip();
      ctx.strokeStyle = 'rgba(20,26,40,0.8)';
      ctx.lineWidth = 2.6 * s;
      var offs = (drillSpin % 7) - 3.5;
      for (var zi = -2; zi < 3; zi++) {
        ctx.beginPath();
        ctx.moveTo((zi * 7 - 4 + offs) * s, bh * 0.86);
        ctx.lineTo((zi * 7 + 4 + offs) * s, bh * 0.86 + dh);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (pose.mood === 'idle' && !invinc) {
      var lampP = 0.5 + 0.5 * Math.sin(nowMs / 260);
      ctx.fillStyle = 'rgba(255,220,140,' + (0.5 + 0.3 * lampP) + ')';
      ctx.beginPath(); ctx.arc(-bw * 0.8, -bh * 0.35, 1.7 * s, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(bw * 0.8, -bh * 0.35, 1.7 * s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function drawXPupil(x, y, r, s) {
    ctx.strokeStyle = '#d9f6ff';
    ctx.lineWidth = Math.max(1.6, 2.6 * s);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }
  function blink(nowMs) {
    var cyc = (nowMs / 1000) % 3.1;
    if (cyc < 0.12) return cyc / 0.12;
    if (cyc > 2.9) return (3.1 - cyc) / 0.2;
    return 0;
  }

  function drawExhaust(pl, pose, dt, vs) {
    exhAcc += dt * (pose.accel ? 26 : pose.mood === 'idle' ? 3.4 : 5);
    while (exhAcc > 1) {
      exhAcc -= 1;
      var hot = pose.mood === 'thrill';
      puffSmoke(pl.x + (hash01(idleClock * 91) - 0.5) * 14, pl.d - 26 - Math.random() * 6, hot);
    }
  }

  function drawHeadlamp(px2, pd2, sn) {
    var sx = X(px2), sy = Y(pd2) + 12 * S;
    var len = (95 + 130 * sn) * S;
    var spread = 34 * S;
    var gr = ctx.createLinearGradient(sx, sy, sx, sy + len);
    gr.addColorStop(0, 'rgba(255,214,150,0.20)');
    gr.addColorStop(0.7, 'rgba(255,214,150,0.05)');
    gr.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(sx - 6 * S, sy);
    ctx.lineTo(sx + 6 * S, sy);
    ctx.lineTo(sx + spread, sy + len);
    ctx.lineTo(sx - spread, sy + len);
    ctx.closePath();
    ctx.fill();
  }

  function drawParticles(pxRef) {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var lt = p.t / p.life;
      var x = X(p.x), y = Y(p.d);
      ctx.save();
      if (p.kind === 'chip') {
        ctx.globalAlpha = 1 - lt;
        ctx.translate(x, y);
        ctx.rotate(p.vr * lt * 6);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r * S / 2, -p.r * S / 2, p.r * S, p.r * S * 0.72);
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = 1 - lt;
        ctx.fillStyle = typeof p.c === 'string' ? p.c : PAL.cyan;
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, p.r * S * (1 - lt * 0.5)), 0, TAU); ctx.fill();
      } else if (p.kind === 'puff') {
        ctx.globalAlpha = (1 - lt) * 0.32;
        ctx.fillStyle = p.c + (0.85 * (1 - lt)) + ')';
        ctx.beginPath(); ctx.arc(x, y, p.r * S * (1 + lt * 1.8), 0, TAU); ctx.fill();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = (1 - lt);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = Math.max(1, 3 * S * (1 - lt) + 1);
        ctx.beginPath();
        ctx.ellipse(x, y, p.r * S, p.r * S * 0.72, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var a = f.t < 0.1 ? f.t / 0.1 : 1 - Math.max(0, (f.t - 0.45) / 0.3);
      ctx.globalAlpha = clamp(a, 0, 1);
      caps(f.txt, X(f.x), Y(f.d), 15 * S + 2, 'center', f.col, 0.5, 800);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- HUD ---------- */

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hudSize() { return clamp(Math.min(W / 430, H / 900), 0.66, 1.5); }

  function drawTimerUIMS(nowMs, vs) {
    var hs = hudSize();
    var bw = Math.min(W * 0.52, 330 * hs);
    var bh = 26 * hs;
    var bx = W / 2 - bw / 2, by = 14 * hs;
    var frac = clamp(vs.remaining / CON.timeCap, 0, 1);
    var crit = vs.remaining < 9000 && vs.phase === 'playing';
    ctx.save();
    roundRect(bx - 4, by - 4, bw + 8, bh + 8, 13);
    ctx.fillStyle = 'rgba(10,6,20,0.72)';
    ctx.fill();
    ctx.strokeStyle = crit ? 'rgba(255,80,96,' + (0.6 + 0.4 * Math.sin(nowMs / 90)) + ')' : 'rgba(148,128,208,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    var iw = bw * frac;
    if (iw > 1) {
      ctx.save();
      roundRect(bx, by, bw, bh, 9);
      ctx.clip();
      var col = frac < 0.18 ? PAL.danger : frac < 0.38 ? '#ffa63d' : PAL.cyan;
      var surfg = ctx.createLinearGradient(0, by, 0, by + bh);
      surfg.addColorStop(0, 'rgba(255,255,255,0.35)');
      surfg.addColorStop(0.25, 'rgba(255,255,255,0.05)');
      var wvm = Math.sin(nowMs / 210) * 2.4 * hs;
      ctx.fillStyle = col;
      ctx.fillRect(bx, by + 6 * hs + wvm * 0.4, iw, bh - 9 * hs);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bx, by + bh - 6 * hs, iw, 4 * hs);
      ctx.fillStyle = surfg;
      ctx.fillRect(bx, by, iw, bh);
      ctx.restore();
    }

    var secs = (vs.remaining / 1000);
    var secTxt = secs >= 10 ? String(Math.ceil(secs)) : secs.toFixed(1);
    var pulse = crit ? 1 + 0.07 * Math.sin(nowMs / 90) : 1;
    caps(secTxt, W / 2, by + bh / 2 + 0.5, 17 * hs * pulse, 'center', '#fff', 1, 900);

    ctx.restore();
  }

  function drawScoreDepth(vs) {
    var hs = hudSize();
    caps('SCORE', 16 * hs, 20 * hs, 10 * hs, 'left', 'rgba(190,175,235,0.85)', 2.4, 700);
    caps(String(vs.score), 16 * hs, 38 * hs, 21 * hs, 'left', '#fff', 1, 900);
    caps('DEPTH ' + Math.floor(vs.depth * CON.unitsToMeters) + 'm', 16 * hs, 56 * hs, 10.5 * hs,
      'left', 'rgba(190,175,235,0.9)', 1.8, 700);
    if (session.best > 0) caps('BEST ' + session.best, 16 * hs, 71 * hs, 9.5 * hs, 'left', 'rgba(255,203,107,0.75)', 1.6, 700);
  }

    function drawPowerBar(vs, nowMs) {
    if (!vs.invincible) return;
    var hs = hudSize();
    var bw = 150 * hs, bx = W / 2 - bw / 2, by = 54 * hs;
    var fr = clamp(vs.invRemain / CON.powerMs, 0, 1);
    roundRect(bx, by, bw, 7 * hs, 4);
    ctx.fillStyle = 'rgba(10,6,20,0.7)'; ctx.fill();
    ctx.fillStyle = PAL.amber;
    roundRect(bx, by, bw * fr, 7 * hs, 4);
    ctx.fill();
  }

  function drawCombo(vs, nowMs) {
    if (vs.phase !== 'playing' || vs.combo < 2) return;
    var hs = hudSize();
    var pop = clamp(grazePulse * 1.4, 0, 1);
    var sz = (13 + vs.combo * 1.1) * hs * (1 + pop * 0.16);
    var col = vs.combo >= 4 ? PAL.magenta : PAL.cyan;
    ctx.save();
    ctx.translate(W / 2, 86 * hs);
    ctx.scale(1 + pop * 0.18, 1 + pop * 0.18);
    caps('GRAZE \u00d7' + vs.combo, 0, 0, sz, 'center', col, 1.5, 900);
    ctx.restore();
  }

  function warnVignette(vs, nowMs) {
    var sn = 1 - clamp((CON.top - vs.player.speed) / (CON.top - CON.crawl), 0, 1);
    var rush = sn > 0.6 ? (sn - 0.6) / 0.4 : 0;
    var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.75);
    var lowT = vs.remaining < 9000 && vs.phase === 'playing' ? 0.5 + 0.5 * Math.sin(nowMs / 140) : 0;
    var a = rush * 0.16 + lowT * 0.2;
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(' + (lowT > rush ? '255,60,70' : '120,80,255') + ',' + a.toFixed(3) + ')');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    return rush;
  }

  /* ---------- overlays ---------- */

  function drawStickWidget() {
    if (!stickActive()) return;
    var st = api.stick;
    var R = 54;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(200,185,240,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(st.ox, st.oy, R, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(160,140,220,0.12)';
    ctx.fill();
    var kx = st.ox + st.dx, ky = st.oy + st.dy;
    var dd = Math.hypot(st.dx, st.dy);
    if (dd > R) { kx = st.ox + st.dx / dd * R; ky = st.oy + st.dy / dd * R; }
    var kn = Math.hypot(st.dx, R);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(220,205,255,0.55)';
    ctx.beginPath(); ctx.arc(kx, ky, 22, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(kx, ky, 9, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function stickActive() { return api.stick && api.stick.active; }

  function drawReadyScreen(nowMs) {
    var hs = hudSize();
    var bob = Math.sin(nowMs / 520) * 3;
    wordmark(W / 2, H * 0.155 + bob * 0.4, Math.min(W * 0.17, 84 * hs));
    caps('A ONE-THUMB DESCENT', W / 2, H * 0.155 + Math.min(W * 0.17, 84 * hs) / 2 + 26 * hs, 11.5 * hs,
      'center', 'rgba(200,188,240,0.9)', 4.4, 700);
    if (session.best > 0)
      caps('SESSION BEST ' + session.best, W / 2, H * 0.155 + Math.min(W * 0.17, 84 * hs) / 2 + 48 * hs, 11 * hs,
        'center', 'rgba(255,203,107,0.9)', 2.2, 800);

    var isCoarse = pointerKind === 'touch';
    var py = H * 0.82;
    var pulse = 0.65 + 0.35 * Math.sin(nowMs / 240);
    ctx.save();
    roundRect(W / 2 - 128 * hs, py - 24 * hs, 256 * hs, 48 * hs, 24 * hs);
    ctx.fillStyle = 'rgba(20,13,38,0.82)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(78,240,207,' + (0.35 + 0.5 * pulse) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    var arrowY = py - 9 * hs + Math.sin(nowMs / 240) * 4 * hs;
    ctx.fillStyle = PAL.cyan;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 108 * hs, arrowY - 9 * hs);
    ctx.lineTo(W / 2 - 96 * hs, arrowY - 9 * hs);
    ctx.lineTo(W / 2 - 102 * hs, arrowY + 9 * hs);
    ctx.closePath(); ctx.fill();

    caps(isCoarse ? 'TOUCH & DRAG DOWN TO DIG' : 'PRESS DOWN / SPACE TO DIG',
      W / 2 + 8 * hs, py, 12.5 * hs, 'center', '#fff', 1.4, 800);
    caps(isCoarse ? 'DRAG SIDEWAYS TO STEER' : 'ARROWS OR MOUSE TO STEER',
      W / 2, py + 52 * hs, 10.5 * hs, 'center', 'rgba(190,178,235,0.75)', 2, 700);
  }

  function drawSteerHint(nowMs) {
    if (runStartSeen === false || VS.phase !== 'playing') return;
    var age = idleRunClock;
    if (age > 7 || steerHintDone) return;
    var a = age < 0.4 ? age / 0.4 : age > 6 ? 1 - (age - 6) : 1;
    ctx.globalAlpha = clamp(a, 0, 1) * 0.9;
    var hs = hudSize();
    caps('\u25c4  LEAN WITH THE ARROWS OR YOUR THUMB  \u25ba', W / 2, H * 0.62, 11.5 * hs,
      'center', 'rgba(220,210,250,0.95)', 1.6, 700);
    ctx.globalAlpha = 1;
  }
  var steerHintDone = false;
  var idleRunClock = 0;

  function fmtShave(u) {
    if (!isFinite(u)) return '\u2014';
    var mm = u * 10;
    if (mm < 10) return mm.toFixed(1) + ' mm';
    return (mm / 10).toFixed(1) + ' cm';
  }

  function drawGameOverScreen(nowMs) {
    var el = (nowMs - overAt) / 1000;
    var hs = hudSize();
    var ga = clamp(el / 0.35, 0, 1);
    ctx.fillStyle = 'rgba(6,4,14,' + (0.74 * ga) + ')';
    ctx.fillRect(0, 0, W, H);
    if (el < 0.05) return;

    var pw = Math.min(W * 0.9, 480 * hs);
    var ph = Math.min(H * 0.86, 640 * hs);
    var px0 = W / 2 - pw / 2, py0 = H / 2 - ph / 2 + (1 - ga) * 40;

    ctx.save();
    ctx.translate(0, (1 - ga) * 30);
    ctx.globalAlpha = ga;

    roundRect(px0, py0, pw, ph, 22);
    var pgr = ctx.createLinearGradient(0, py0, 0, py0 + ph);
    pgr.addColorStop(0, '#251b44');
    pgr.addColorStop(1, '#120c22');
    ctx.fillStyle = pgr;
    ctx.fill();
    ctx.strokeStyle = 'rgba(146,126,220,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    var scTarget = VS.score;
    var ct = clamp(el / 0.9, 0, 1);
    ct = 1 - Math.pow(1 - ct, 3);
    var shownScore = Math.round(scTarget * ct);

    caps('THE LIGHT GOES OUT', W / 2, py0 + 34 * hs, 13 * hs, 'center', 'rgba(200,186,245,0.95)', 3, 700);
    caps(String(shownScore), W / 2, py0 + 78 * hs, 44 * hs, 'center', '#fff', 1, 900);
    var beatBest = newBestFlag && shownScore === scTarget && scTarget > 0;
    caps(beatBest ? '\u26a1 NEW SESSION BEST' : 'BEST ' + session.best,
      W / 2, py0 + 112 * hs, 12.5 * hs, 'center',
      beatBest ? PAL.amber : 'rgba(255,203,107,0.8)', 2.4, 800);

    var statY = py0 + 146 * hs;
    var shave = VS.stats ? VS.stats.shave : Infinity;
    ctx.save();
    roundRect(px0 + pw * 0.14, statY - 17 * hs, pw * 0.72, 40 * hs, 12 * hs);
    ctx.fillStyle = 'rgba(78,240,207,0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(78,240,207,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    caps('CLOSEST SHAVE', W / 2, statY - 3 * hs, 9.5 * hs, 'center', 'rgba(190,215,240,0.8)', 3, 700);
    caps(fmtShave(shave), W / 2, statY + 12 * hs, 17 * hs, 'center', PAL.cyan, 0.5, 900);

    var ladderTop = statY + 40 * hs;
    var grades = VS.grades;
    var rh = Math.min((ph - (ladderTop - py0) - 46 * hs) / grades.length, 26 * hs);
    var achievedIdx = 0;
    for (var gi = 0; gi < grades.length; gi++) if (scTarget >= grades[gi][1]) achievedIdx = gi;
    var GCOLS = ['#8d8aa5', '#a58d6f', '#b8a48a', '#9fb8a4', '#8fc6d8', '#ffd166'];
    for (gi = 0; gi < grades.length; gi++) {
      var yy = ladderTop + gi * rh + rh / 2;
      var name = grades[gi][0];
      var need = grades[gi][1];
      var reached = scTarget >= need;
      var cur = gi === achievedIdx;
      ctx.save();
      if (cur) {
        roundRect(px0 + pw * 0.08, yy - rh * 0.42, pw * 0.84, rh * 0.84, 8);
        ctx.fillStyle = 'rgba(255,181,69,0.13)';
        ctx.fill();
      }
      caps(name, px0 + pw * 0.13, yy, 11.5 * hs * (cur ? 1.12 : 1), 'left',
        reached ? (cur ? PAL.amberHi : GCOLS[gi]) : 'rgba(130,120,165,0.55)', 1.6, cur ? 900 : 700);
      caps(reached ? String(need) : '', px0 + pw * 0.87, yy, 10 * hs, 'right',
        cur ? 'rgba(255,214,150,0.9)' : 'rgba(130,120,165,0.6)', 1, 700);
      if (cur) {
        caps('\u25c0', px0 + pw * 0.085, yy, 9 * hs, 'left', PAL.amber, 0, 900);
      }
      ctx.restore();
    }

    var statsRow = 'DEPTH ' + Math.floor(VS.depth * CON.unitsToMeters) + 'm   SHARDS ' +
      VS.fragmentsCollected + '   GRAZES ' + (VS.stats ? VS.stats.grazes : 0);
    caps(statsRow, W / 2, py0 + ph - 38 * hs, 10 * hs, 'center', 'rgba(195,183,240,0.85)', 1.2, 700);
    var bl = Math.sin(nowMs / 300) > -0.3;
    if (bl) caps(pointerKind === 'touch' ? 'TAP TO DIG AGAIN' : 'CLICK TO DIG AGAIN \u00b7 R RETRIES VEIN',
      W / 2, py0 + ph - 18 * hs, 10.5 * hs, 'center', 'rgba(255,255,255,0.85)', 1.4, 800);

    ctx.restore();
  }

  /* ---------- main frame ---------- */

  var api = {};
  api.stick = null;
  var lastFrame = performance.now();

  api.frame = function (nowMs) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H ||
       clamp((root.devicePixelRatio || 1), 1, 2) !== DPR) resize();

    var dt = clamp((nowMs - lastFrame) / 1000, 0, 0.1);
    lastFrame = nowMs;
    idleClock += dt;

    VS = core.viewState();
    if (hooks.pointer) pointerKind = hooks.pointer.kind;
    var pl = VS.player;
    feedEvents(dt);

    var phaseChangedReady = prevPhase !== 'gameover' && VS.phase === 'gameover';
    if (phaseChangedReady) {
      overAt = nowMs;
      if (hooks.sound) hooks.sound('gameover');
      var finalScore = VS.score;
      session.runs++;
      if (finalScore > session.best) {
        session.best = finalScore;
        newBestFlag = true;
        if (hooks.sound) hooks.sound('best');
      } else newBestFlag = false;
    }
    if (VS.phase === 'playing' && prevPhase !== 'playing') runStartSeen = true;
    if (VS.phase === 'playing' && prevPhase !== 'playing') idleRunClock = 0;
    if (VS.phase === 'playing') idleRunClock += dt;
    prevPhase = VS.phase;

    heldAccel = !!(core.input.kb.accel || core.input.pt.accel);
    if ((core.input.kb.left || core.input.kb.right || Math.abs(core.input.pt.stickX) > 0.05)) steerHintDone = true;

    hurtT = Math.max(0, hurtT - dt);
    grazePulse = Math.max(0, grazePulse - dt * 3.2);
    powerFxT = Math.max(0, powerFxT - dt);
    flash = Math.max(0, flash - dt * 3.4);
    trauma = Math.max(0, trauma - dt * 2.2);

    updateParticles(dt);

    var sn = clamp((CON.top - pl.speed) / (CON.top - CON.crawl), 0, 1);
    var lowTimeTick = VS.remaining < 9000 && VS.phase === 'playing';
    var secId = Math.floor(VS.remaining / 1000);
    if (lowTimeTick && secId !== tickSecPrev && secId <= 9 && secId >= 0) {
      tickSecPrev = secId;
      if (hooks.sound) hooks.sound('tick');
    } else if (!lowTimeTick) tickSecPrev = -1;

    /* camera */
    camDepth = pl.d;
    var tx = clamp(pl.x * 0.85, -150, 150);
    if (!camInit) { camXs = tx; camInit = true; }
    camXs += (tx - camXs) * Math.min(1, dt * 6);

    var shk = trauma * trauma;
    var shx = shk * 9 * (hash01(nowMs * 0.13 + shakeSeed) - 0.5) * 2;
    var shy = shk * 8 * (hash01(nowMs * 0.17 + shakeSeed + 50) - 0.5) * 2;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(shx, shy);

    drawBackground(camDepth);

    var backD = camDepth - H * 0.28 / S;
    var fwdD = camDepth + (H - H * 0.70) / S;
    var geo = sampleGeo(backD - 40, fwdD + 60, 26);

    drawSkyRig(Y(-10) );
    if (backD < 30) drawPadAndShaft(geo);
    drawCorridor(geo);
    drawHeadlamp(pl.x, pl.d, sn);

    drawRocks(core.getRocks());
    drawFragments(core.getItems(), nowMs);

    var pose = poseFromState(VS, nowMs);
    drawExhaust(pl, pose, dt, VS);
    if (VS.phase !== 'gameover' || (nowMs - overAt) < 2600) drawMachine(pl.x, pl.d, pose, VS, nowMs, dt);
    drawParticles(pl);
    drawStreaks(VS.phase === 'playing' ? sn : 0, dt);

    ctx.restore();

    var rush = warnVignette(VS, nowMs);
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,244,230,' + (flash * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (VS.phase !== 'ready') {
      drawTimerUIMS(nowMs, VS);
      drawScoreDepth(VS);
      drawPowerBar(VS, nowMs);
      drawCombo(VS, nowMs);
      if (rush > 0.05) drawHeatLines(nowMs, rush);
    }

    drawSteerHint(nowMs);
    drawStickWidget();

    if (VS.phase === 'ready') drawReadyScreen(nowMs);
    if (VS.phase === 'gameover') drawGameOverScreen(nowMs);

    if (audioMutedBadgeT > 0) {
      audioMutedBadgeT -= dt;
      ctx.globalAlpha = clamp(audioMutedBadgeT * 2, 0, 1);
      caps(mutedShownText, W / 2, H * 0.3, 12 * hudSize(), 'center', 'rgba(255,255,255,0.85)', 2, 800);
      ctx.globalAlpha = 1;
    }
  };

  var audioMutedBadgeT = 0, mutedShownText = '';
  api.muteFlash = function (txt) { mutedShownText = txt; audioMutedBadgeT = 1.5; };

  function drawHeatLines(nowMs, rush) {
    ctx.save();
    var n = 10;
    for (var i = 0; i < n; i++) {
      var t01 = (i + ((nowMs / 34) % 1)) / n;
      var y = t01 * H;
      ctx.strokeStyle = 'rgba(255,150,180,' + (rush * 0.05 * (1 - Math.abs(t01 - 0.5))).toFixed(3) + ')';
      ctx.lineWidth = 2;
      var wav = Math.sin(t01 * 9 + nowMs / 220) * 10;
      ctx.beginPath();
      ctx.moveTo(W * 0.02 + wav, y);
      ctx.lineTo(W * 0.06 + wav, y - 24);
      ctx.moveTo(W * 0.98 - wav, y);
      ctx.lineTo(W * 0.94 - wav, y - 24);
      ctx.stroke();
    }
    ctx.restore();
  }

  root.addEventListener('resize', resize);

  resize();
  return api;
}

var rootObj = typeof self !== 'undefined' ? self : root;
rootObj.DelveVisual = createVisual;

})(typeof self !== 'undefined' ? self : this);
