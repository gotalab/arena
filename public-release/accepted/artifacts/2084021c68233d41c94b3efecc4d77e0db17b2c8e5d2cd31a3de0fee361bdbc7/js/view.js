/* SHOAL - everything you can see.
   The view reads the production state and never writes to it. All art is
   drawn in code. View-only animation may use the wall clock; it can never
   reach the board, the simulation clock, or a snapshot field. */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});
  var C = S.CODES;

  var PAL = {
    deep: '#04202a',
    mid: '#0a4150',
    shallow: '#0e5566',
    foam: 'rgba(190,255,250,0.20)',
    shellHi: '#fdf0d8',
    shellLo: '#d3ad7c',
    shellRim: '#a97f52',
    shellRidge: '#e6cba1',
    open: '#0a323e',
    openEdge: '#0f4759',
    pennant: '#ff6a48',
    pennantHi: '#ffab7f',
    pole: '#5b3b2e',
    urchin: '#241633',
    urchinSpine: '#4a2f6b',
    fatal: '#ff4d6a',
    ink: '#062028',
    cream: '#f6ecd9',
    gold: '#ffd166'
  };

  var NUMCOL = ['', '#7fe6ff', '#79f0a6', '#ff9d6e', '#c2a8ff', '#ffd05e', '#4fe0cf', '#ff8bc4', '#f2ece0'];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0 ? 0 : (t > 1 ? 1 : t * t * (3 - 2 * t)); }
  function hash2(i) { var h = Math.imul(i ^ 0x9e3779b9, 2246822519); h ^= h >>> 13; return ((h >>> 0) % 1000) / 1000; }

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

  S.createView = function (canvas, game) {
    var ctx = canvas.getContext('2d');
    var g = game.model;
    var L = { W: 0, H: 0, dpr: 1, cell: 20, bx: 0, by: 0, hudH: 60, hostH: 70 };
    var t0 = 0, T = 0;                     // view clock (ms since first frame)
    var sprites = { size: -1, shells: [], open: null };
    var reveal = null, lidStart = null, flagPop = null, boardId = -1;
    var rings = [], pops = [], bubbles = [], sparks = [];
    var shake = 0, shakeT = 0, shakeMag = 1, flash = 0, flashMag = 0.5, flashCol = '#ff4d6a';
    var lastBig = -9999, lastBigN = 0, clearT = -9999, clearInfo = null, stingT = -9999;
    var hover = -1, pressing = -1, holdProg = 0, cursor = -1, cursorOn = false;
    var sweepFx = { i: -1, t: -9999 };

    /* ------------------------------------------------------------- geometry */

    function resize(W, H, dpr) {
      L.W = W; L.H = H; L.dpr = dpr;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      layout();
    }

    function layout() {
      var W = L.W, H = L.H;
      var pad = clamp(W * 0.022, 6, 14);
      L.pad = pad;
      L.hudH = clamp(H * 0.105, 48, 78);
      L.hostH = clamp(H * 0.118, 52, 96);
      var availW = W - pad * 2;
      var availH = H - L.hudH - L.hostH - pad;
      var cw = g.w || 6, ch = g.h || 8;
      var cell = Math.floor(Math.min(availW / cw, availH / ch));
      cell = Math.max(8, Math.min(cell, 92));   // thumb-sized, never absurd on a desktop
      L.cell = cell;
      L.boardW = cell * cw;
      L.boardH = cell * ch;
      L.bx = Math.round((W - L.boardW) / 2);
      L.by = Math.round(L.hudH + pad * 0.5 + (availH - L.boardH) / 2);
      buildSprites(cell);
    }

    function cellAt(px, py) {
      var x = Math.floor((px - L.bx) / L.cell), y = Math.floor((py - L.by) / L.cell);
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
      return y * g.w + x;
    }
    function cellRect(i) {
      return { x: L.bx + (i % g.w) * L.cell, y: L.by + Math.floor(i / g.w) * L.cell, s: L.cell };
    }

    /* -------------------------------------------------------------- sprites */

    function buildSprites(cell) {
      if (sprites.size === cell) return;
      sprites.size = cell;
      sprites.shells = [];
      var dpr = L.dpr, S2 = Math.max(2, Math.round(cell * dpr));
      for (var v = 0; v < 4; v++) sprites.shells.push(shellSprite(S2, v, dpr));
      sprites.open = openSprite(S2, dpr);
    }

    function shellSprite(size, variant, dpr) {
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var c = cv.getContext('2d');
      var m = size * 0.055;                 // gap between shells
      var x = m, y = m, w = size - m * 2, h = size - m * 2;
      var r = w * 0.26;
      var tilt = (variant - 1.5) * 0.05;

      c.save();
      c.translate(size / 2, size / 2);
      c.rotate(tilt);
      c.translate(-size / 2, -size / 2);

      var grd = c.createLinearGradient(x, y, x + w * 0.4, y + h);
      grd.addColorStop(0, PAL.shellHi);
      grd.addColorStop(0.55, '#f0d6ad');
      grd.addColorStop(1, PAL.shellLo);
      roundRect(c, x, y, w, h, r);
      c.fillStyle = grd; c.fill();

      // fan ridges radiating from the base of the shell
      c.save();
      roundRect(c, x, y, w, h, r); c.clip();
      c.strokeStyle = 'rgba(169,127,82,0.34)';
      c.lineWidth = Math.max(1, w * 0.035);
      c.lineCap = 'round';
      var cxs = x + w / 2, cys = y + h * 1.02;
      for (var i = -2; i <= 2; i++) {
        var a = -Math.PI / 2 + i * 0.46;
        c.beginPath();
        c.moveTo(cxs + Math.cos(a) * w * 0.16, cys + Math.sin(a) * w * 0.16);
        c.lineTo(cxs + Math.cos(a) * w * 1.02, cys + Math.sin(a) * w * 1.02);
        c.stroke();
      }
      // growth arc
      c.strokeStyle = 'rgba(255,248,232,0.5)';
      c.lineWidth = Math.max(1, w * 0.03);
      c.beginPath();
      c.arc(cxs, cys, w * 0.62, Math.PI * 1.12, Math.PI * 1.88);
      c.stroke();
      c.restore();

      // rim + highlight
      roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r);
      c.strokeStyle = 'rgba(120,86,52,0.45)';
      c.lineWidth = Math.max(1, size * 0.02);
      c.stroke();
      c.beginPath();
      c.ellipse(x + w * 0.34, y + h * 0.26, w * 0.2, h * 0.13, -0.5, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill();
      c.restore();
      return cv;
    }

    function openSprite(size, dpr) {
      var cv = document.createElement('canvas');
      cv.width = size; cv.height = size;
      var c = cv.getContext('2d');
      var m = size * 0.04;
      var x = m, y = m, w = size - m * 2, h = size - m * 2, r = w * 0.2;
      var grd = c.createLinearGradient(x, y, x, y + h);
      grd.addColorStop(0, '#072a35');
      grd.addColorStop(1, '#0c3d4b');
      roundRect(c, x, y, w, h, r);
      c.fillStyle = grd; c.fill();
      c.save();
      roundRect(c, x, y, w, h, r); c.clip();
      c.strokeStyle = 'rgba(0,0,0,0.30)';
      c.lineWidth = Math.max(1, size * 0.05);
      c.beginPath(); c.moveTo(x, y + h * 0.06); c.lineTo(x + w, y + h * 0.06); c.stroke();
      c.strokeStyle = 'rgba(150,240,255,0.10)';
      c.lineWidth = Math.max(1, size * 0.03);
      c.beginPath(); c.moveTo(x, y + h * 0.97); c.lineTo(x + w, y + h * 0.97); c.stroke();
      c.restore();
      return cv;
    }

    /* ------------------------------------------------------------------ fx */

    function resetBoardFx() {
      var n = g.n;
      reveal = new Float32Array(n).fill(-1);
      lidStart = new Float32Array(n).fill(-1);
      flagPop = new Float32Array(n).fill(-9999);
      rings.length = 0; pops.length = 0; sparks.length = 0;
      boardId = g.boardId;
    }

    function consume(fxList) {
      for (var k = 0; k < fxList.length; k++) {
        var f = fxList[k];
        // A move that clears a pool hands the board over before the view sees
        // its fx; those belong to a pool that is already gone.
        if (f.bid !== undefined && f.bid !== g.boardId) continue;
        if (f.t === 'reset') {
          if (boardId !== g.boardId) resetBoardFx();
          rings.length = 0; pops.length = 0; bubbles.length = 0;
          clearT = -9999; stingT = -9999; clearInfo = null;
          shake = 0; flash = 0;
        }
        // begin() has usually reset for the new pool already; do not undo the
        // celebration that the clearing move just queued.
        else if (f.t === 'board') { if (boardId !== g.boardId) resetBoardFx(); }
        else if (f.t === 'open' || f.t === 'sweep') {
          if (!reveal || boardId !== g.boardId) resetBoardFx();
          var maxd = 0;
          for (var q = 0; q < f.cells.length; q++) {
            var d = f.dists[q];
            if (d > maxd) maxd = d;
            var delay = Math.min(d * 22, 200);
            lidStart[f.cells[q]] = T + delay;
            if (d % 2 === 0 || f.cells.length < 12) {
              var r0 = cellRect(f.cells[q]);
              rings.push({ x: r0.x + r0.s / 2, y: r0.y + r0.s / 2, t: T + delay, life: 420, r: r0.s * 1.25 });
            }
          }
          if (f.pearls > 0) {
            var rc = cellRect(f.i);
            pops.push({ x: rc.x + rc.s / 2, y: rc.y + rc.s / 2, t: T, text: '+' + f.pearls });
          }
          if (f.cells.length >= 6) { lastBig = T; lastBigN = f.cells.length; }
          if (f.t === 'sweep') { sweepFx.i = f.i; sweepFx.t = T; }
        }
        else if (f.t === 'flag' || f.t === 'unflag') {
          if (!flagPop || boardId !== g.boardId) resetBoardFx();
          flagPop[f.i] = f.t === 'flag' ? T : -1;
        }
        else if (f.t === 'clear') {
          clearT = T; clearInfo = { pool: f.pool, bonus: f.bonus };
          flash = 1; flashMag = 0.28; flashCol = '#9ff6ff';
          shake = 1; shakeMag = 0.35; shakeT = T;
          for (var b = 0; b < 40; b++) {
            bubbles.push({
              x: L.bx + Math.random() * L.boardW,
              y: L.by + L.boardH,
              t: T + Math.random() * 500, life: 1500, r: 3 + Math.random() * 8
            });
          }
          for (var w2 = 0; w2 < 5; w2++) {
            rings.push({
              x: L.bx + L.boardW / 2, y: L.by + L.boardH / 2,
              t: T + w2 * 90, life: 900, r: Math.max(L.boardW, L.boardH) * 0.75
            });
          }
        }
        else if (f.t === 'sting') {
          stingT = T; shake = 1; shakeMag = 1; shakeT = T;
          flash = 1; flashMag = 0.5; flashCol = PAL.fatal;
        }
      }
    }

    /* ---------------------------------------------------------------- water */

    function drawWater() {
      var W = L.W, H = L.H;
      var grd = ctx.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, PAL.deep);
      grd.addColorStop(0.45, PAL.mid);
      grd.addColorStop(1, '#062733');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);

      // caustic light bands
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 7; i++) {
        var p = i / 7;
        var yy = (p * H + Math.sin(T * 0.00035 + i) * H * 0.05) % H;
        var a = 0.020 + 0.016 * Math.sin(T * 0.0009 + i * 1.7);
        if (a <= 0) continue;
        ctx.strokeStyle = 'rgba(160,255,244,' + a.toFixed(3) + ')';
        ctx.lineWidth = H * 0.035;
        ctx.beginPath();
        for (var x = -20; x <= W + 20; x += 24) {
          var y2 = yy + Math.sin(x * 0.018 + T * 0.0012 + i * 2.1) * H * 0.018;
          if (x === -20) ctx.moveTo(x, y2); else ctx.lineTo(x, y2);
        }
        ctx.stroke();
      }
      ctx.restore();

      // motes
      ctx.save();
      for (var m = 0; m < 22; m++) {
        var hx = hash2(m * 7 + 3), hy = hash2(m * 13 + 11);
        var mx = (hx * W + Math.sin(T * 0.0004 + m) * 18) % W;
        var my = (H - ((T * 0.012 * (0.4 + hy)) + hy * H) % (H + 40));
        ctx.globalAlpha = 0.10 + 0.10 * Math.sin(T * 0.002 + m);
        ctx.fillStyle = '#cffcff';
        ctx.beginPath(); ctx.arc(mx, my, 1 + hx * 1.8, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }

    function drawWeeds() {
      var H = L.H, W = L.W;
      ctx.save();
      ctx.lineCap = 'round';
      for (var i = 0; i < 9; i++) {
        var hx = hash2(i * 31 + 5);
        var x = (i < 5 ? hx * W * 0.26 : W - hx * W * 0.26);
        var hgt = L.hostH * (0.7 + hx * 1.5);
        var sway = Math.sin(T * 0.0011 + i) * 10;
        ctx.strokeStyle = i % 2 ? 'rgba(26,110,96,0.55)' : 'rgba(18,86,86,0.5)';
        ctx.lineWidth = 4 + hx * 5;
        ctx.beginPath();
        ctx.moveTo(x, H + 4);
        ctx.quadraticCurveTo(x + sway * 0.6, H - hgt * 0.55, x + sway, H - hgt);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---------------------------------------------------------------- board */

    function drawBoard() {
      var cell = L.cell;

      // Once the run has ended the ceremony takes the bottom of the screen, so
      // the pool lifts and settles above it: the evidence stays in full view.
      var endK = 0;
      if (g.phase === 'ended') endK = ease(clamp((T - stingT - 400) / 650, 0, 1));
      ctx.save();
      if (endK > 0) {
        var room = L.H * 0.50 - L.hudH - L.pad;
        var fit = clamp(room / L.boardH, 0.5, 1);
        var sc = lerp(1, fit, endK);
        var ty = lerp(0, (L.hudH + L.pad) - L.by, endK);
        ctx.translate(L.W / 2, L.by + ty);
        ctx.scale(sc, sc);
        ctx.translate(-L.W / 2, -L.by);
      }

      // pool basin
      ctx.save();
      roundRect(ctx, L.bx - 6, L.by - 6, L.boardW + 12, L.boardH + 12, 14);
      ctx.fillStyle = 'rgba(3,26,34,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(126,230,255,0.16)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      for (var i = 0; i < g.n; i++) {
        var d = g.disp[i];
        var r = cellRect(i);
        var x = r.x, y = r.y, s = cell;
        var open = d <= 8;

        if (open) {
          drawOpenCell(i, x, y, s, d);
          var lid = lidStart[i];
          if (lid >= 0) {
            var la = 1 - ease((T - lid) / 150);
            if (la > 0.001) drawCoveredCell(i, x, y, s, la, 0);
            else lidStart[i] = -1;
          }
        } else if (d === C.COV) {
          var lift = 0;
          if (hover === i && g.phase !== 'ended') lift = 0.35;
          if (pressing === i) lift = -0.5;
          drawCoveredCell(i, x, y, s, 1, lift);
        } else if (d === C.FLG) {
          drawCoveredCell(i, x, y, s, 1, pressing === i ? -0.5 : 0);
          drawPennant(i, x, y, s, 1);
        } else if (d === C.URC) {
          drawOpenCell(i, x, y, s, -1);
          drawUrchin(x, y, s, false);
        } else if (d === C.FATAL) {
          drawOpenCell(i, x, y, s, -1);
          drawUrchin(x, y, s, true);
        } else if (d === C.FRIGHT) {
          drawCoveredCell(i, x, y, s, 1, 0);
          drawPennant(i, x, y, s, 1);
          markRing(x, y, s, PAL.gold);
        } else if (d === C.FWRONG) {
          drawCoveredCell(i, x, y, s, 1, 0);
          drawPennant(i, x, y, s, 0.45);
          markCross(x, y, s);
        }

        if (cursorOn && cursor === i) {
          ctx.save();
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = Math.max(2, s * 0.06);
          roundRect(ctx, x + 2, y + 2, s - 4, s - 4, s * 0.24);
          ctx.stroke();
          ctx.restore();
        }
      }

      // hold-to-pennant progress
      if (pressing >= 0 && holdProg > 0.02 && holdProg < 1) {
        var pr = cellRect(pressing);
        ctx.save();
        ctx.strokeStyle = PAL.pennant;
        ctx.lineWidth = Math.max(2.5, cell * 0.09);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(pr.x + cell / 2, pr.y + cell / 2, cell * 0.36, -Math.PI / 2, -Math.PI / 2 + holdProg * 6.283);
        ctx.stroke();
        ctx.restore();
      }

      // sweep stroke
      var sw = T - sweepFx.t;
      if (sw < 320 && sweepFx.i >= 0) {
        var sr = cellRect(sweepFx.i);
        var k = ease(sw / 320);
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.strokeStyle = '#bdf7ff';
        ctx.lineWidth = Math.max(2, cell * 0.12);
        ctx.beginPath();
        ctx.arc(sr.x + cell / 2, sr.y + cell / 2, cell * (0.5 + k * 1.4), 0, 6.283);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();   // end-of-run lift
    }

    function drawCoveredCell(i, x, y, s, alpha, lift) {
      var sp = sprites.shells[(i * 7 + (i % 5)) & 3];
      if (!sp) return;
      ctx.save();
      if (alpha < 1) ctx.globalAlpha = alpha;
      var off = lift * (s * 0.04);
      ctx.drawImage(sp, x, y - off, s, s);
      ctx.restore();
    }

    function drawOpenCell(i, x, y, s, value) {
      if (sprites.open) ctx.drawImage(sprites.open, x, y, s, s);
      if (value > 0) {
        var lid = lidStart[i];
        var a = lid >= 0 ? clamp((T - lid) / 150, 0, 1) : 1;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = NUMCOL[value];
        ctx.font = '700 ' + Math.round(s * 0.56) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (value >= 4) {
          ctx.shadowColor = NUMCOL[value];
          ctx.shadowBlur = s * 0.28;
        }
        ctx.fillText(String(value), x + s / 2, y + s * 0.54);
        ctx.restore();
      }
    }

    function drawPennant(i, x, y, s, alpha) {
      var pop = flagPop[i];
      var age = pop > 0 ? T - pop : 9999;
      var k = age < 260 ? 1 + Math.sin(ease(age / 260) * Math.PI) * 0.28 : 1;
      var a = age < 160 ? ease(age / 160) : 1;
      ctx.save();
      ctx.globalAlpha = alpha * (pop > 0 ? a : 1);
      ctx.translate(x + s / 2, y + s / 2);
      ctx.scale(k, k);
      var ph = s * 0.5;
      ctx.strokeStyle = PAL.pole;
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.06, ph * 0.52);
      ctx.lineTo(-s * 0.06, -ph * 0.5);
      ctx.stroke();
      var wobble = Math.sin(T * 0.006 + i) * s * 0.03;
      ctx.beginPath();
      ctx.moveTo(-s * 0.06, -ph * 0.5);
      ctx.quadraticCurveTo(s * 0.16, -ph * 0.36 + wobble, s * 0.26, -ph * 0.14);
      ctx.quadraticCurveTo(s * 0.10, -ph * 0.10 + wobble, -s * 0.06, -ph * 0.06);
      ctx.closePath();
      var pg = ctx.createLinearGradient(-s * 0.06, -ph * 0.5, s * 0.26, 0);
      pg.addColorStop(0, PAL.pennantHi);
      pg.addColorStop(1, PAL.pennant);
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-s * 0.06, ph * 0.54, s * 0.055, 0, 6.283);
      ctx.fillStyle = PAL.pole; ctx.fill();
      ctx.restore();
    }

    function drawUrchin(x, y, s, fatal) {
      var cx = x + s / 2, cy = y + s / 2, r = s * 0.26;
      ctx.save();
      if (fatal) {
        ctx.shadowColor = PAL.fatal;
        ctx.shadowBlur = s * 0.5;
      }
      ctx.strokeStyle = fatal ? '#ff7d92' : PAL.urchinSpine;
      ctx.lineWidth = Math.max(1.5, s * 0.055);
      ctx.lineCap = 'round';
      for (var i = 0; i < 11; i++) {
        var a = (i / 11) * 6.283 + 0.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
        ctx.lineTo(cx + Math.cos(a) * r * 1.75, cy + Math.sin(a) * r * 1.75);
        ctx.stroke();
      }
      var gr = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
      gr.addColorStop(0, fatal ? '#6b2233' : '#3d2757');
      gr.addColorStop(1, fatal ? '#2a0d16' : PAL.urchin);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283);
      ctx.fillStyle = gr; ctx.fill();
      ctx.beginPath(); ctx.arc(cx - r * 0.32, cy - r * 0.35, r * 0.22, 0, 6.283);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
      ctx.restore();
      if (fatal) markRing(x, y, s, PAL.fatal);
    }

    function markRing(x, y, s, col) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, s * 0.07);
      roundRect(ctx, x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88, s * 0.24);
      ctx.stroke();
      ctx.restore();
    }

    function markCross(x, y, s) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.lineCap = 'round';
      var p = s * 0.28;
      ctx.beginPath();
      ctx.moveTo(x + p, y + p); ctx.lineTo(x + s - p, y + s - p);
      ctx.moveTo(x + s - p, y + p); ctx.lineTo(x + p, y + s - p);
      ctx.stroke();
      ctx.restore();
    }

    /* ------------------------------------------------------------------ hud */

    var FONT = '"Trebuchet MS", "Avenir Next", ui-rounded, system-ui, sans-serif';

    function drawHud() {
      var W = L.W, h = L.hudH, pad = L.pad + 4;
      var s = {
        pool: g.pool,
        pearls: g.pearls,
        urchinsLeft: g.urchins - g.flags,
        tideFraction: game.tideFraction()
      };
      ctx.save();
      ctx.textBaseline = 'middle';

      // pool depth
      ctx.fillStyle = 'rgba(190,238,246,0.62)';
      ctx.font = '700 ' + Math.round(h * 0.20) + 'px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillText('POOL', pad, h * 0.30);
      ctx.fillStyle = PAL.cream;
      ctx.font = '700 ' + Math.round(h * 0.40) + 'px ' + FONT;
      ctx.fillText(String(s.pool), pad, h * 0.62);

      // urchins left
      var cx = W / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(190,238,246,0.62)';
      ctx.font = '700 ' + Math.round(h * 0.20) + 'px ' + FONT;
      ctx.fillText('URCHINS', cx, h * 0.30);
      var left = s.urchinsLeft;
      ctx.fillStyle = left < 0 ? PAL.fatal : PAL.pennant;
      ctx.font = '700 ' + Math.round(h * 0.44) + 'px ' + FONT;
      ctx.fillText(String(left), cx, h * 0.64);

      // pearls
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(190,238,246,0.62)';
      ctx.font = '700 ' + Math.round(h * 0.20) + 'px ' + FONT;
      ctx.fillText('PEARLS', W - pad, h * 0.30);
      ctx.fillStyle = PAL.cream;
      ctx.font = '700 ' + Math.round(h * 0.40) + 'px ' + FONT;
      ctx.fillText(String(s.pearls), W - pad, h * 0.62);

      // tide meter
      var bx = pad, bw = W - pad * 2, by = h * 0.84, bh = Math.max(4, h * 0.10);
      roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = 'rgba(4,28,36,0.75)'; ctx.fill();
      var frac = s.tideFraction;
      if (frac > 0.001) {
        var fw = Math.max(bh, bw * frac);
        roundRect(ctx, bx, by, fw, bh, bh / 2);
        var tg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        var low = frac < 0.28;
        tg.addColorStop(0, low ? '#ffb45e' : '#5fe3d0');
        tg.addColorStop(1, low ? '#ff7a4d' : '#8ff3ff');
        ctx.fillStyle = tg;
        if (low) { ctx.shadowColor = '#ff9a5e'; ctx.shadowBlur = 8 + 5 * Math.sin(T * 0.008); }
        ctx.fill();
      }
      ctx.restore();
    }

    /* ----------------------------------------------------------------- host */

    function hostMood() {
      if (g.phase === 'ended') return 'stung';
      if (T - clearT < 1500) return 'proud';
      if (T - lastBig < 1300) return 'delight';
      if (g.firstTurnDone) {
        var leftSafe = (g.n - g.urchins) - g.opened;
        if (leftSafe > 0 && leftSafe <= 6) return 'tense';
      }
      if (g.phase === 'ready') return 'idle';
      return 'curious';
    }

    function drawHost() {
      var mood = hostMood();
      var baseY = L.H - L.hostH * 0.18;
      var s = L.hostH * 0.62;
      var cx = L.W * 0.20 + Math.sin(T * 0.0006) * (mood === 'idle' ? 10 : 3);
      drawRock(L.W * 0.20, baseY, s);
      drawNib(cx, baseY - s * 0.06, s, mood);
    }

    function drawRock(cx, by, s) {
      ctx.save();
      ctx.fillStyle = 'rgba(6,40,50,0.9)';
      ctx.beginPath();
      ctx.ellipse(cx, by + s * 0.08, s * 1.15, s * 0.24, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = 'rgba(11,66,78,0.8)';
      ctx.beginPath();
      ctx.ellipse(cx, by + s * 0.03, s * 0.9, s * 0.16, 0, 0, 6.283);
      ctx.fill();
      ctx.restore();
    }

    /* Nib: the pool's host. Drawn entirely in code. */
    function drawNib(cx, by, s, mood) {
      var t = T;
      var breathe = Math.sin(t * 0.0027) * 0.028;
      var sqx = 1, sqy = 1, armUp = 0, tilt = 0;
      var eye = 'normal', mouth = 'smile';
      var bodyTop = '#ffa987', bodyBot = '#f2705a';

      if (mood === 'idle') { tilt = Math.sin(t * 0.0012) * 0.10; mouth = 'smile'; }
      else if (mood === 'curious') { tilt = Math.sin(t * 0.0018) * 0.06; eye = 'normal'; }
      else if (mood === 'delight') {
        armUp = 1; eye = 'happy'; mouth = 'open';
        sqy = 1 + Math.abs(Math.sin(t * 0.012)) * 0.10;
        sqx = 1 - Math.abs(Math.sin(t * 0.012)) * 0.06;
      } else if (mood === 'tense') {
        eye = 'wide'; mouth = 'o';
        sqx = 1.10 + Math.sin(t * 0.02) * 0.012;
        sqy = 0.95;
        tilt = Math.sin(t * 0.03) * 0.02;
        bodyTop = '#ffc79c'; bodyBot = '#f08a63';
      } else if (mood === 'stung') {
        eye = 'x'; mouth = 'flat'; sqy = 0.84; sqx = 1.10;
        bodyTop = '#9d93ab'; bodyBot = '#6f6780';
      } else if (mood === 'proud') {
        armUp = 1; eye = 'happy'; mouth = 'open';
        sqy = 1 + Math.sin(t * 0.009) * 0.06;
      }
      sqy += breathe; sqx -= breathe * 0.5;

      var bw = s * 0.62 * sqx, bh = s * 0.72 * sqy;
      ctx.save();
      ctx.translate(cx, by);
      ctx.rotate(tilt);

      // fins
      ctx.fillStyle = 'rgba(255,150,120,0.75)';
      var flut = Math.sin(t * 0.009) * 0.5;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        ctx.save();
        ctx.translate(sgn * bw * 0.52, -bh * 0.42);
        ctx.rotate(sgn * (0.5 + flut * 0.35));
        ctx.beginPath();
        ctx.ellipse(0, 0, bw * 0.30, bh * 0.16, 0, 0, 6.283);
        ctx.fill();
        ctx.restore();
      }

      // arms
      ctx.strokeStyle = '#f2825f';
      ctx.lineWidth = s * 0.10;
      ctx.lineCap = 'round';
      for (sgn = -1; sgn <= 1; sgn += 2) {
        var ax = sgn * bw * 0.5, ay = -bh * 0.18;
        var wave = Math.sin(t * 0.006 + sgn) * s * 0.05;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        if (armUp) {
          ctx.quadraticCurveTo(ax + sgn * s * 0.22, ay - s * 0.24 + wave,
                               ax + sgn * s * 0.16, ay - s * 0.46 + wave * 0.5);
        } else {
          ctx.quadraticCurveTo(ax + sgn * s * 0.20, ay + s * 0.10 + wave,
                               ax + sgn * s * 0.10, ay + s * 0.26);
        }
        ctx.stroke();
      }

      // body
      var bg = ctx.createLinearGradient(0, -bh, 0, bh * 0.2);
      bg.addColorStop(0, bodyTop);
      bg.addColorStop(1, bodyBot);
      ctx.beginPath();
      ctx.moveTo(0, -bh * 1.05);
      ctx.bezierCurveTo(bw * 0.95, -bh * 0.92, bw * 1.02, bh * 0.06, 0, bh * 0.08);
      ctx.bezierCurveTo(-bw * 1.02, bh * 0.06, -bw * 0.95, -bh * 0.92, 0, -bh * 1.05);
      ctx.closePath();
      ctx.fillStyle = bg; ctx.fill();

      // belly
      ctx.beginPath();
      ctx.ellipse(0, -bh * 0.18, bw * 0.52, bh * 0.34, 0, 0, 6.283);
      ctx.fillStyle = 'rgba(255,232,214,0.55)'; ctx.fill();

      // antenna
      ctx.strokeStyle = bodyBot;
      ctx.lineWidth = s * 0.045;
      var ab = Math.sin(t * 0.005) * s * 0.06;
      ctx.beginPath();
      ctx.moveTo(0, -bh * 1.0);
      ctx.quadraticCurveTo(s * 0.06, -bh * 1.28, s * 0.02 + ab, -bh * 1.42);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.02 + ab, -bh * 1.46, s * 0.055, 0, 6.283);
      ctx.fillStyle = mood === 'stung' ? '#8f86a0' : PAL.gold;
      ctx.fill();

      // eyes
      var ex = bw * 0.36, ey = -bh * 0.52;
      var er = s * (eye === 'wide' ? 0.125 : 0.10);
      var blink = (Math.sin(t * 0.0013) > 0.985) && eye === 'normal';
      for (sgn = -1; sgn <= 1; sgn += 2) {
        ctx.save();
        ctx.translate(sgn * ex, ey);
        if (eye === 'x') {
          ctx.strokeStyle = '#3b3348';
          ctx.lineWidth = s * 0.045;
          ctx.lineCap = 'round';
          var q = s * 0.07;
          ctx.beginPath();
          ctx.moveTo(-q, -q); ctx.lineTo(q, q);
          ctx.moveTo(q, -q); ctx.lineTo(-q, q);
          ctx.stroke();
        } else if (eye === 'happy') {
          ctx.strokeStyle = '#2c1a22';
          ctx.lineWidth = s * 0.045;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, s * 0.03, s * 0.09, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        } else if (blink) {
          ctx.strokeStyle = '#2c1a22';
          ctx.lineWidth = s * 0.04;
          ctx.beginPath();
          ctx.moveTo(-s * 0.08, 0); ctx.lineTo(s * 0.08, 0);
          ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(0, 0, er, 0, 6.283);
          ctx.fillStyle = '#2c1a22'; ctx.fill();
          var lookx = 0, looky = 0;
          if (hover >= 0 || cursor >= 0) {
            var hr = cellRect(hover >= 0 ? hover : cursor);
            var dx = (hr.x - cx) , dy = (hr.y - by);
            var dl = Math.hypot(dx, dy) || 1;
            lookx = (dx / dl) * er * 0.32; looky = (dy / dl) * er * 0.32;
          }
          ctx.beginPath();
          ctx.arc(lookx - er * 0.26, looky - er * 0.3, er * 0.34, 0, 6.283);
          ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
        }
        ctx.restore();
      }

      // mouth
      ctx.strokeStyle = '#8a3f36';
      ctx.lineWidth = s * 0.035;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (mouth === 'smile') ctx.arc(0, -bh * 0.26, s * 0.08, 0.15 * Math.PI, 0.85 * Math.PI);
      else if (mouth === 'open') { ctx.ellipse(0, -bh * 0.22, s * 0.06, s * 0.075, 0, 0, 6.283); }
      else if (mouth === 'o') { ctx.ellipse(0, -bh * 0.22, s * 0.045, s * 0.05, 0, 0, 6.283); }
      else { ctx.moveTo(-s * 0.07, -bh * 0.24); ctx.lineTo(s * 0.07, -bh * 0.24); }
      ctx.stroke();

      ctx.restore();

      // emotes
      if (mood === 'tense') {
        var hb = (Math.sin(t * 0.0016) * 0.5 + 0.5);
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = '#cffcff';
        ctx.lineWidth = s * 0.03;
        ctx.beginPath();
        ctx.arc(cx + s * 0.42, by - s * 0.62, s * (0.06 + hb * 0.10), 0, 6.283);
        ctx.stroke();
        ctx.restore();
      } else if (mood === 'delight' || mood === 'proud') {
        for (var i = 0; i < 5; i++) {
          var ph = (t * 0.0016 + i * 0.2) % 1;
          ctx.save();
          ctx.globalAlpha = (1 - ph) * 0.7;
          ctx.fillStyle = '#d8fbff';
          ctx.beginPath();
          ctx.arc(cx + Math.sin(i * 2.1 + t * 0.002) * s * 0.5,
                  by - s * 0.9 - ph * s * 0.9, s * 0.05 * (1 - ph * 0.4), 0, 6.283);
          ctx.fill();
          ctx.restore();
        }
      } else if (mood === 'stung') {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#2a2140';
        for (var b2 = 0; b2 < 4; b2++) {
          var pp = ((T - stingT) * 0.0006 + b2 * 0.22) % 1;
          ctx.beginPath();
          ctx.arc(cx + (b2 - 1.5) * s * 0.28, by - s * 0.7 - pp * s * 0.7, s * (0.10 + pp * 0.14), 0, 6.283);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    /* --------------------------------------------------------------- overlay fx */

    function drawFx() {
      var i, f;
      for (i = rings.length - 1; i >= 0; i--) {
        f = rings[i];
        var a = (T - f.t) / f.life;
        if (a < 0) continue;
        if (a > 1) { rings.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = (1 - a) * 0.5;
        ctx.strokeStyle = '#a9f6ff';
        ctx.lineWidth = Math.max(1, L.cell * 0.08 * (1 - a));
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.25 + a * 1.15), 0, 6.283);
        ctx.stroke();
        ctx.restore();
      }
      for (i = pops.length - 1; i >= 0; i--) {
        f = pops[i];
        var p = (T - f.t) / 900;
        if (p > 1) { pops.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = PAL.gold;
        ctx.font = '700 ' + Math.round(L.cell * 0.5) + 'px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y - p * L.cell * 1.4);
        ctx.restore();
      }
      for (i = bubbles.length - 1; i >= 0; i--) {
        f = bubbles[i];
        var bp = (T - f.t) / f.life;
        if (bp < 0) continue;
        if (bp > 1) { bubbles.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = (1 - bp) * 0.75;
        ctx.strokeStyle = '#c8fbff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(f.x + Math.sin(bp * 6 + f.r) * 10, f.y - bp * L.boardH * 0.9, f.r, 0, 6.283);
        ctx.stroke();
        ctx.restore();
      }
    }

    function drawBanner() {
      var age = T - clearT;
      if (age > 1300 || !clearInfo) return;
      var k = age < 200 ? ease(age / 200) : (age > 1000 ? 1 - ease((age - 1000) / 300) : 1);
      ctx.save();
      ctx.globalAlpha = k;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var cy = L.by + L.boardH * 0.42 - ease(age / 1500) * 30;
      ctx.fillStyle = 'rgba(4,26,34,0.72)';
      roundRect(ctx, L.W * 0.1, cy - L.hudH * 0.6, L.W * 0.8, L.hudH * 1.25, 14);
      ctx.fill();
      ctx.fillStyle = PAL.cream;
      ctx.font = '700 ' + Math.round(L.hudH * 0.36) + 'px ' + FONT;
      ctx.fillText('POOL ' + clearInfo.pool + ' CLEARED', L.W / 2, cy - L.hudH * 0.06);
      ctx.fillStyle = PAL.gold;
      ctx.font = '700 ' + Math.round(L.hudH * 0.30) + 'px ' + FONT;
      ctx.fillText('tide bonus +' + clearInfo.bonus, L.W / 2, cy + L.hudH * 0.36);
      ctx.restore();
    }

    /* ---------------------------------------------------------------- frame */

    function begin(nowMs) {
      if (!t0) t0 = nowMs;
      T = nowMs - t0;
      if (boardId !== g.boardId || !reveal || reveal.length !== g.n) {
        layout();          // a new pool may be a different shape
        resetBoardFx();
      }
    }

    function draw() {
      ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
      ctx.clearRect(0, 0, L.W, L.H);

      var sh = 0;
      if (shake > 0) {
        var sa = 1 - clamp((T - shakeT) / 520, 0, 1);
        shake = sa;
        sh = sa * sa * 12 * shakeMag;
      }
      ctx.save();
      if (sh > 0.2) {
        ctx.translate(Math.sin(T * 0.09) * sh, Math.cos(T * 0.13) * sh * 0.7);
      }

      drawWater();
      drawWeeds();
      drawBoard();
      drawFx();
      drawHud();
      drawHost();
      drawBanner();

      ctx.restore();

      if (flash > 0) {
        var fa = 1 - clamp((T - shakeT) / 420, 0, 1);
        flash = fa;
        if (fa > 0) {
          ctx.save();
          ctx.globalAlpha = fa * flashMag;
          ctx.fillStyle = flashCol;
          ctx.fillRect(0, 0, L.W, L.H);
          ctx.restore();
        }
      }

      if (g.phase === 'ended') {
        // enough to settle the scene, never enough to hide the evidence
        var da = clamp((T - stingT - 500) / 700, 0, 1) * 0.26;
        if (da > 0) {
          ctx.save();
          ctx.globalAlpha = da;
          ctx.fillStyle = '#04161d';
          ctx.fillRect(0, 0, L.W, L.H);
          ctx.restore();
        }
      }
    }

    return {
      resize: resize,
      layout: layout,
      begin: begin,
      consume: consume,
      draw: draw,
      cellAt: cellAt,
      cellRect: cellRect,
      setHover: function (i) { hover = i; },
      setPress: function (i, prog) { pressing = i; holdProg = prog; },
      setCursor: function (i, on) { cursor = i; cursorOn = on; },
      stingAge: function () { return T - stingT; },
      now: function () { return T; }
    };
  };
})();
