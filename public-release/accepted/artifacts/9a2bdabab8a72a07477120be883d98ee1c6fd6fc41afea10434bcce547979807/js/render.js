(function () {
  var D = window.DELVE;
  var CONST = D.sim.CONST;
  var WORLD_W = CONST.WORLD_W, WORLD_H = CONST.WORLD_H, VIEW_BACK = CONST.VIEW_BACK;
  var FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function fmt(n) { return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function roundRect(ctx, x, y, w, h, r) {
    if (w < 0 || h < 0) return;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rankColor(rank) {
    var map = {
      Dirt: '#8a8f9e', Gravel: '#b9a97c', Shale: '#7f9fd0', Limestone: '#d7cfc0',
      Granite: '#e8e2d8', Obsidian: '#b18bf0', Bedrock: '#ffd75e'
    };
    return map[rank] || '#f2f6ff';
  }

  function createRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1, scale = 1, offX = 0, offY = 0;
    var visRng = D.rng.makeRng(1);
    var strata = [], specks = [];
    var cur = null;

    var view = {
      shake: 0, grazeT: 0, grazeDir: 1, hitT: 0, powerPop: 0,
      flash: { a: 0, color: '#fff' },
      best: 0, time: 0, blinkT: 1, blinkDur: 0.1, exAcc: 0,
      particles: [], seed: 0
    };

    function resize() {
      var wrap = document.getElementById('wrap') || document.body;
      W = wrap.clientWidth; H = wrap.clientHeight;
      if (W < 2 || H < 2) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      scale = Math.min(W / WORLD_W, H / WORLD_H);
      offX = (W - WORLD_W * scale) / 2;
      offY = (H - WORLD_H * scale) / 2;
    }
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      try { new ResizeObserver(resize).observe(document.getElementById('wrap') || document.body); } catch (e) {}
    }

    function buildStrata() {
      var layers = [];
      for (var li = 0; li < 2; li++) {
        var period = li === 0 ? 90 : 150;
        var arr = [];
        var n = Math.ceil(WORLD_H / period) + 3;
        for (var i = 0; i < n; i++) {
          arr.push({ off: i * period, amp: visRng.next() * 14 + 5, phase: visRng.next() * Math.PI * 2, freq: visRng.next() * 0.02 + 0.01 });
        }
        layers.push({ parallax: li === 0 ? 0.35 : 0.65, period: period, alpha: li === 0 ? 0.3 : 0.2, color: li === 0 ? '#1c2949' : '#152038', arr: arr });
      }
      return layers;
    }
    function buildSpecks() {
      var a = [];
      for (var i = 0; i < 34; i++) a.push({ x: visRng.next() * WORLD_W, y: visRng.next() * WORLD_H * 2, size: 0.5 + visRng.next() * 1.4, ph: visRng.next() * 6.28 });
      return a;
    }

    function reset(seed) {
      visRng = D.rng.makeRng((seed | 0) ^ 0x9e3779b9);
      strata = buildStrata();
      specks = buildSpecks();
      view.shake = 0; view.grazeT = 0; view.hitT = 0; view.powerPop = 0;
      view.flash = { a: 0, color: '#fff' };
      view.particles.length = 0;
      view.seed = seed | 0;
    }

    function toScreen(x, depth) {
      var vtop = cur.depth - VIEW_BACK;
      return { x: offX + x * scale, y: offY + (depth - vtop) * scale };
    }

    // ---------- BACKGROUND ----------
    function drawBackground() {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#121a38');
      g.addColorStop(0.45, '#0d1330');
      g.addColorStop(1, '#0a1020');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      var vtop = cur.depth - VIEW_BACK;
      for (var li = 0; li < strata.length; li++) {
        var layer = strata[li];
        var shift = vtop * (1 - layer.parallax);
        var n = Math.ceil(WORLD_H / layer.period) + 2;
        var baseK = Math.floor(shift / layer.period);
        ctx.strokeStyle = layer.color;
        ctx.globalAlpha = layer.alpha;
        ctx.lineWidth = 1;
        for (var k = baseK; k < baseK + n; k++) {
          var ln = layer.arr[((k % layer.arr.length) + layer.arr.length) % layer.arr.length];
          var baseY = offY + (k * layer.period - shift) * scale;
          if (baseY < -60 || baseY > H + 60) continue;
          ctx.beginPath();
          for (var wx = 0; wx <= WORLD_W; wx += 30) {
            var wy = ln.amp * Math.sin(wx * ln.freq + ln.phase + vtop * 0.005);
            var sx = offX + wx * scale;
            var sy = baseY + wy * scale * 0.4;
            if (wx === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // distant specks drifting
      ctx.fillStyle = '#8fb8dd';
      for (var i = 0; i < specks.length; i++) {
        var sp = specks[i];
        var sy = (sp.y * scale - vtop * 0.55 * scale) % (H + 30);
        if (sy < 0) sy += H + 30;
        sy = offY + sy - 15;
        if (sy < 0 || sy > H) continue;
        ctx.globalAlpha = 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(view.time * 2 + sp.ph));
        ctx.beginPath();
        ctx.arc(offX + sp.x * scale, sy, sp.size * scale, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    // ---------- CORRIDOR ----------
    function drawCorridor() {
      var vtop = cur.depth - VIEW_BACK;
      var N = Math.ceil(WORLD_H / 8);
      var pts = [];
      for (var i = 0; i <= N; i++) {
        var d = vtop + i * 8;
        var g = cur.geom(d);
        pts.push({ d: d, lx: g.cx - g.hw, rx: g.cx + g.hw, sy: offY + i * 8 * scale });
      }

      // interior
      ctx.beginPath();
      ctx.moveTo(offX + pts[0].lx * scale, pts[0].sy);
      for (var pi = 0; pi < pts.length; pi++) ctx.lineTo(offX + pts[pi].lx * scale, pts[pi].sy);
      for (var pj = pts.length - 1; pj >= 0; pj--) ctx.lineTo(offX + pts[pj].rx * scale, pts[pj].sy);
      ctx.closePath();
      var ig = ctx.createLinearGradient(0, pts[0].sy, 0, pts[pts.length - 1].sy);
      ig.addColorStop(0, '#263153');
      ig.addColorStop(1, '#1a2340');
      ctx.fillStyle = ig;
      ctx.fill();

      // walls
      wallFill('left', pts, vtop);
      wallFill('right', pts, vtop);

      // faint inner shadow along walls
      for (var side = 0; side < 2; side++) {
        var xk = side === 0 ? 'lx' : 'rx';
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 6 * scale;
        ctx.beginPath();
        for (var qi = 0; qi < pts.length; qi++) {
          var px = offX + pts[qi][xk] * scale;
          if (qi === 0) ctx.moveTo(px, pts[qi].sy); else ctx.lineTo(px, pts[qi].sy);
        }
        ctx.stroke();
      }
    }

    function wallFill(side, pts, vtop) {
      ctx.beginPath();
      if (side === 'left') {
        ctx.moveTo(0, pts[0].sy);
        ctx.lineTo(offX + pts[0].lx * scale, pts[0].sy);
        for (var i = 0; i < pts.length; i++) ctx.lineTo(offX + pts[i].lx * scale, pts[i].sy);
        ctx.lineTo(0, pts[pts.length - 1].sy);
      } else {
        ctx.moveTo(W, pts[0].sy);
        ctx.lineTo(offX + pts[0].rx * scale, pts[0].sy);
        for (var j = 0; j < pts.length; j++) ctx.lineTo(offX + pts[j].rx * scale, pts[j].sy);
        ctx.lineTo(W, pts[pts.length - 1].sy);
      }
      ctx.closePath();
      var wg = ctx.createLinearGradient(0, pts[0].sy, 0, pts[pts.length - 1].sy);
      wg.addColorStop(0, '#1d2540');
      wg.addColorStop(1, '#141b30');
      ctx.fillStyle = wg;
      ctx.fill();
      ctx.save();
      ctx.clip();
      wallStrata(vtop, side);
      ctx.restore();
      ctx.beginPath();
      for (var k = 0; k < pts.length; k++) {
        var x = offX + (side === 'left' ? pts[k].lx : pts[k].rx) * scale;
        if (k === 0) ctx.moveTo(x, pts[k].sy); else ctx.lineTo(x, pts[k].sy);
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(140,190,255,0.6)';
      ctx.shadowColor = 'rgba(130,185,255,0.95)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function wallStrata(vtop) {
      var step = 30;
      var off = (vtop * 0.2) % step;
      ctx.lineWidth = 1;
      for (var y = -step + off; y < H + step; y += step) {
        var k = Math.round(y / step);
        var amp = (2 + hash(k) * 8) * 0.4;
        var ph = hash(k + 7) * 6.283;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.03 + hash(k + 31) * 0.04) + ')';
        ctx.beginPath();
        for (var x = 0; x <= W; x += 24) {
          var yy = y + amp * Math.sin(x * 0.02 + ph);
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }

    // ---------- SPEED STREAKS ----------
    function drawSpeedStreaks() {
      if (cur.phase !== 'playing') return;
      var sf = (cur.speed - 90) / 550;
      if (sf <= 0.55) return;
      var a = (sf - 0.55) * 0.5;
      ctx.strokeStyle = '#bfe4ff';
      ctx.lineWidth = 1;
      for (var i = 0; i < 12; i++) {
        var x = offX + hash(i * 3) * WORLD_W * scale;
        var t = (hash(i * 7) + view.time * 0.09) % 1;
        var y = t * H * 1.2 - H * 0.1;
        ctx.globalAlpha = a * (0.3 + 0.7 * hash(i * 5));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + H * 0.12 * sf);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---------- ROCKS ----------
    function drawRocks() {
      var inv = cur.invincibleUntilMs > cur.timeMs;
      var v0 = cur.depth - VIEW_BACK - 80, v1 = cur.depth + WORLD_H - VIEW_BACK + 80;
      for (var i = 0; i < cur.rocks.length; i++) {
        var r = cur.rocks[i];
        if (!r.active) continue;
        if (r.depth < v0 || r.depth > v1) continue;
        var p = toScreen(r.x, r.depth);
        drawRock(p.x, p.y, r.visualRadius * scale, r.id);
        if (inv) {
          ctx.globalAlpha = 0.2 + 0.12 * Math.sin(view.time * 8);
          ctx.strokeStyle = '#ffd75e';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r.visualRadius * scale * 1.25, 0, 6.283);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    function drawRock(sx, sy, r, id) {
      if (r < 1) return;
      ctx.save();
      ctx.translate(sx, sy);
      var rg = ctx.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.2, 0, 0, r * 1.1);
      rg.addColorStop(0, '#5d6679');
      rg.addColorStop(0.5, '#3c4456');
      rg.addColorStop(1, '#222838');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, 6.283);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,160,74,0.5)';
      ctx.lineWidth = Math.max(1, r * 0.07);
      var a0 = hash(id) * 6.283;
      var a1 = hash(id + 1) * 6.283;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r * 0.3, Math.sin(a0) * r * 0.3);
      ctx.lineTo(Math.cos(a0 + 0.4) * r * 0.75, Math.sin(a0 + 0.4) * r * 0.75);
      ctx.moveTo(Math.cos(a1) * r * 0.2, Math.sin(a1) * r * 0.2);
      ctx.lineTo(Math.cos(a1 + 0.5) * r * 0.6, Math.sin(a1 + 0.5) * r * 0.6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, -Math.PI * 0.9, -Math.PI * 0.2);
      ctx.stroke();
      ctx.restore();
    }

    // ---------- ITEMS ----------
    function drawItems() {
      var v0 = cur.depth - VIEW_BACK - 80, v1 = cur.depth + WORLD_H - VIEW_BACK + 80;
      for (var i = 0; i < cur.items.length; i++) {
        var it = cur.items[i];
        if (!it.active) continue;
        if (it.depth < v0 || it.depth > v1) continue;
        var p = toScreen(it.x, it.depth);
        if (it.type === 'fragment') drawFragment(p.x, p.y, it.id, it.visualRadius);
        else drawPowerItem(p.x, p.y, it.id, it.visualRadius);
      }
    }

    function drawFragment(sx, sy, id, vr) {
      var r = vr * scale * (0.92 + 0.08 * Math.sin(view.time * 5 + id));
      var rot = cur.timeMs * 0.002 + hash(id) * 6.283;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.shadowColor = 'rgba(80,220,255,0.8)';
      ctx.shadowBlur = 10;
      var g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#d8fbff');
      g.addColorStop(0.5, '#67d9f0');
      g.addColorStop(1, '#1e93b8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.55, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.55, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.5);
      ctx.lineTo(0, r * 0.5);
      ctx.stroke();
      ctx.restore();
    }

    function drawPowerItem(sx, sy, id, vr) {
      var r = vr * scale * (1 + 0.1 * Math.sin(view.time * 4));
      var rot = cur.timeMs * 0.001 + hash(id) * 6.283;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.shadowColor = 'rgba(255,210,90,0.9)';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = 'rgba(255,220,120,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = rot + i * Math.PI / 4;
        ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
      }
      ctx.stroke();
      var g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
      g.addColorStop(0, '#fff7d8');
      g.addColorStop(0.4, '#ffd75e');
      g.addColorStop(1, '#e8a33d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      var pr = 1 + 0.15 * Math.sin(view.time * 6);
      ctx.strokeStyle = 'rgba(255,215,94,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.7 * pr, 0, 6.283);
      ctx.stroke();
      ctx.restore();
    }

    // ---------- MACHINE ----------
    function drawMachine() {
      var ph = cur.phase;
      var speed = cur.speed;
      var sf = (speed - 90) / 550;
      var accel = cur.input.accel;
      var inv = cur.invincibleUntilMs > cur.timeMs;
      var p = toScreen(cur.x, cur.depth);
      var s = scale;

      var lean = -cur.input.steer * 0.18;
      if (view.grazeT > 0) lean += view.grazeDir * view.grazeT * 0.28;
      var bobY = 0;
      if (ph === 'ready') bobY = Math.sin(view.time * 1.6) * 2.2 * s;
      else if (ph === 'playing' && !accel && sf < 0.25) bobY = Math.sin(view.time * 1.1) * 1.2 * s;

      var stretch = 1 + sf * 0.09;
      var sxS = 1, syS = stretch;
      if (view.hitT > 0) { sxS = 1 + view.hitT * 0.32; syS = 1 - view.hitT * 0.3; }
      if (view.powerPop > 0) { sxS *= 1 + view.powerPop * 0.14; syS *= 1 - view.powerPop * 0.11; }

      var jx = 0, jy = 0;
      if (ph === 'playing' && sf > 0.7) { jx = (Math.random() * 2 - 1) * 1.4 * sf * s; jy = (Math.random() * 2 - 1) * 1.4 * sf * s; }
      if (view.hitT > 0) { jx += (Math.random() * 2 - 1) * view.hitT * 5 * s; jy += (Math.random() * 2 - 1) * view.hitT * 3 * s; }
      var cx = p.x + jx, cy = p.y + jy + bobY;

      // soft back-glow to separate machine from dark scene
      var mg = ctx.createRadialGradient(cx, cy, 4 * s, cx, cy, 60 * s);
      mg.addColorStop(0, 'rgba(255,190,110,0.30)');
      mg.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(cx - 80 * s, cy - 80 * s, 160 * s, 160 * s);

      // resting pad on the dock
      if (ph === 'ready') {
        var padA = 0.10 + 0.05 * Math.sin(view.time * 1.6);
        ctx.strokeStyle = 'rgba(127,214,255,' + padA + ')';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 52 * s, 34 * s, 8 * s, 0, 0, 6.283);
        ctx.stroke();
        ctx.fillStyle = 'rgba(127,214,255,' + padA * 0.4 + ')';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 52 * s, 34 * s, 8 * s, 0, 0, 6.283);
        ctx.fill();
      }

      // headlight cone
      var coneA = ph === 'playing' ? (0.10 + accel * 0.10 + sf * 0.06) : 0.05;
      if (ph === 'gameover') coneA = 0.02;
      var coneL = H / s;
      var coneG = ctx.createLinearGradient(0, cy, 0, H);
      coneG.addColorStop(0, 'rgba(255,233,192,' + coneA + ')');
      coneG.addColorStop(1, 'rgba(255,233,192,0)');
      ctx.fillStyle = coneG;
      ctx.beginPath();
      ctx.moveTo(cx - 5 * s, cy + 4 * s);
      ctx.lineTo(cx + 5 * s, cy + 4 * s);
      ctx.lineTo(cx + 70 * s, cy + coneL * s);
      ctx.lineTo(cx - 70 * s, cy + coneL * s);
      ctx.closePath();
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(lean);
      ctx.scale(sxS * 1.28, syS * 1.28);

      // antenna
      ctx.strokeStyle = '#8a8f9e';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(-6 * s, -26 * s);
      ctx.quadraticCurveTo(-11 * s, -31 * s, -9 * s, -37 * s);
      ctx.stroke();
      var tipGlow = inv ? 1 : (ph === 'gameover' ? 0.12 : 0.6 + 0.3 * Math.sin(view.time * 3));
      ctx.fillStyle = inv ? '#ffd75e' : 'rgba(140,230,255,' + tipGlow + ')';
      ctx.shadowColor = inv ? '#ffd75e' : '#8ce6ff';
      ctx.shadowBlur = 7 * s;
      ctx.beginPath();
      ctx.arc(-9 * s, -38 * s, 2.6 * s, 0, 6.283);
      ctx.fill();
      ctx.shadowBlur = 0;

      // side fins
      ctx.fillStyle = '#2a2018';
      roundRect(ctx, -25 * s, -10 * s, 6 * s, 18 * s, 3 * s);
      ctx.fill();
      roundRect(ctx, 19 * s, -10 * s, 6 * s, 18 * s, 3 * s);
      ctx.fill();
      ctx.fillStyle = '#3a2b1f';
      for (var n = 0; n < 3; n++) {
        ctx.beginPath(); ctx.arc(-22 * s, -4 * s + n * 5 * s, 1.4 * s, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(22 * s, -4 * s + n * 5 * s, 1.4 * s, 0, 6.283); ctx.fill();
      }

      // body
      var bodyG = ctx.createRadialGradient(-8 * s, -18 * s, 4 * s, 0, -4 * s, 46 * s);
      bodyG.addColorStop(0, '#ffc266');
      bodyG.addColorStop(0.55, '#f08a2e');
      bodyG.addColorStop(1, '#c65e16');
      ctx.fillStyle = bodyG;
      ctx.beginPath();
      ctx.moveTo(-26 * s, -26 * s);
      ctx.quadraticCurveTo(-30 * s, 2 * s, 0, 26 * s);
      ctx.quadraticCurveTo(30 * s, 2 * s, 26 * s, -26 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,26,10,0.5)';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      // dark band
      ctx.fillStyle = '#3a2b1f';
      roundRect(ctx, -18 * s, -15 * s, 36 * s, 8 * s, 4 * s);
      ctx.fill();

      // face
      var eyeY = -8 * s;
      var lidOpen = 1, pupil = 1;
      if (ph === 'gameover') lidOpen = 0;
      else if (view.hitT > 0) lidOpen = 0.15;
      else if (ph === 'playing' && sf > 0.7) { lidOpen = 1; pupil = 1.35; }
      else if (accel) { lidOpen = 0.85; pupil = 1.1; }
      else if (ph === 'playing') { lidOpen = 0.6; pupil = 0.9; }
      else { lidOpen = 1; pupil = 1; }
      var blinkPhase = view.blinkT < view.blinkDur ? Math.sin((1 - view.blinkT / view.blinkDur) * Math.PI) : 0;
      var lid = clamp(lidOpen - blinkPhase * 0.9, 0, 1);
      if (lid <= 0.05) {
        ctx.strokeStyle = '#2b1a08';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(-12 * s, eyeY); ctx.lineTo(-4 * s, eyeY);
        ctx.moveTo(4 * s, eyeY); ctx.lineTo(12 * s, eyeY);
        ctx.stroke();
      } else {
        var dirs = [-1, 1];
        for (var d = 0; d < dirs.length; d++) {
          var ex = dirs[d] * 9 * s;
          ctx.fillStyle = '#2b1a08';
          ctx.beginPath();
          ctx.arc(ex, eyeY, 6.5 * s * lid, 0, 6.283);
          ctx.fill();
          if (inv) {
            ctx.strokeStyle = '#ffd75e';
            ctx.lineWidth = 1.6 * s;
            ctx.beginPath();
            ctx.arc(ex, eyeY - 1 * s, 5 * s * lid, Math.PI * 1.15, Math.PI * 1.85);
            ctx.stroke();
          } else {
            ctx.fillStyle = '#fff3d6';
            var pr2 = pupil * 2.4 * s * lid;
            ctx.beginPath();
            ctx.arc(ex, eyeY, pr2, 0, 6.283);
            ctx.fill();
            ctx.fillStyle = '#3a2b1f';
            ctx.beginPath();
            ctx.arc(ex + 0.8 * s, eyeY - 0.8 * s, pr2 * 0.45, 0, 6.283);
            ctx.fill();
          }
        }
      }

      // mouth
      var my = 2 * s;
      ctx.strokeStyle = '#2b1a08';
      ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (view.hitT > 0) {
        ctx.moveTo(-6 * s, my); ctx.lineTo(-2 * s, my + 2 * s); ctx.lineTo(2 * s, my - 1 * s); ctx.lineTo(6 * s, my + 2 * s);
      } else if (ph === 'playing' && sf > 0.7) {
        ctx.arc(0, my + 2 * s, 3 * s, 0, 6.283);
      } else if (accel || ph === 'playing') {
        ctx.moveTo(-5 * s, my); ctx.lineTo(5 * s, my);
      } else {
        ctx.moveTo(-5 * s, my); ctx.quadraticCurveTo(0, my + 3 * s, 5 * s, my);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';

      // drill
      var drillSpin = ph === 'playing' ? cur.timeMs * 0.02 + speed * 0.02 : view.time * 6;
      ctx.save();
      ctx.translate(0, 20 * s);
      var dg = ctx.createLinearGradient(-9 * s, 0, 9 * s, 0);
      dg.addColorStop(0, '#aeb9c4');
      dg.addColorStop(0.5, '#e8eef4');
      dg.addColorStop(1, '#7e8a96');
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.moveTo(-9 * s, 0);
      ctx.lineTo(-4 * s, 26 * s);
      ctx.lineTo(4 * s, 26 * s);
      ctx.lineTo(9 * s, 0);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-9 * s, 0);
      ctx.lineTo(-4 * s, 26 * s);
      ctx.lineTo(4 * s, 26 * s);
      ctx.lineTo(9 * s, 0);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = 'rgba(40,48,56,0.7)';
      ctx.lineWidth = 1.6 * s;
      var ph2 = drillSpin * 0.6;
      for (var fl = 0; fl < 3; fl++) {
        var off = ((fl / 3 + ph2) % 1) * 26 * s;
        ctx.beginPath();
        ctx.moveTo(-9 * s, off);
        ctx.quadraticCurveTo(0, off + 4 * s, 9 * s, off);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 26 * s, 2.5 * s, 0, 6.283);
      ctx.fill();
      ctx.restore();

      ctx.restore();

      // invincible aura
      if (inv) {
        var pulse = 1 + 0.08 * Math.sin(view.time * 9);
        ctx.strokeStyle = 'rgba(255,215,94,0.7)';
        ctx.lineWidth = 3 * s;
        ctx.shadowColor = 'rgba(255,215,94,0.9)';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, 34 * s * pulse, 0, 6.283);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // timer ring around machine when low
      if (ph === 'playing') {
        var frac = clamp(cur.remainingMs / CONST.START_TIME, 0, 1);
        if (frac < 0.5) {
          var rr = 40 * s;
          var col = frac < 0.2 ? '#ff5c5c' : (frac < 0.35 ? '#ffb35c' : '#7fe0ff');
          var aa = 0.45 + 0.25 * Math.sin(view.time * (frac < 0.2 ? 10 : 6));
          ctx.strokeStyle = col;
          ctx.globalAlpha = aa;
          ctx.lineWidth = 3 * s;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // run-end dim
      if (ph === 'gameover') {
        var dg2 = ctx.createRadialGradient(cx, cy, 2 * s, cx, cy, 60 * s);
        dg2.addColorStop(0, 'rgba(8,10,18,0.5)');
        dg2.addColorStop(1, 'rgba(8,10,18,0)');
        ctx.fillStyle = dg2;
        ctx.fillRect(cx - 90 * s, cy - 90 * s, 180 * s, 180 * s);
      }
    }

    // ---------- PARTICLES ----------
    function updateParticles(dts) {
      var arr = view.particles;
      for (var i = arr.length - 1; i >= 0; i--) {
        var p = arr[i];
        p.life -= dts;
        if (p.life <= 0) { arr.splice(i, 1); continue; }
        p.x += p.vx * dts;
        p.depth += p.vd * dts;
        if (p.grav) p.vd += p.grav * dts;
        p.rot += (p.vrot || 0) * dts;
      }
    }

    function drawParticles() {
      for (var i = 0; i < view.particles.length; i++) {
        var p = view.particles[i];
        var sp = toScreen(p.x, p.depth);
        var a = clamp(p.life / p.maxLife, 0, 1);
        if (p.kind === 'dust') {
          ctx.globalAlpha = a * 0.5;
          ctx.fillStyle = p.color || '#9aa4c0';
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, p.size * scale, 0, 6.283);
          ctx.fill();
        } else if (p.kind === 'spark') {
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.5);
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          ctx.lineTo(sp.x - p.vx * scale * 0.04, sp.y - p.vd * scale * 0.04);
          ctx.stroke();
        } else if (p.kind === 'shard') {
          ctx.globalAlpha = a;
          ctx.save();
          ctx.translate(sp.x, sp.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size * scale);
          ctx.lineTo(p.size * 0.8 * scale, 0);
          ctx.lineTo(0, p.size * scale);
          ctx.lineTo(-p.size * 0.6 * scale, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.kind === 'ring') {
          var t = 1 - a;
          ctx.globalAlpha = a * 0.8;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, p.size * scale * (0.3 + t * 0.7), 0, 6.283);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    function addPuff() {
      var jx = (Math.random() * 2 - 1) * 8;
      view.particles.push({
        kind: 'dust', x: cur.x + jx, depth: cur.depth - 30,
        vx: (Math.random() * 2 - 1) * 14, vd: -(18 + Math.random() * 20),
        life: 0.6 + Math.random() * 0.4, maxLife: 1,
        size: 2 + Math.random() * 2.4, color: Math.random() < 0.5 ? '#c9b393' : '#aeb7cc', grav: -6
      });
    }
    function spawnAmbient(dts) {
      var rate = 0;
      if (cur.phase === 'playing') rate = cur.input.accel ? 30 : (cur.speed < 150 ? 6 : 12);
      else if (cur.phase === 'ready') rate = 4;
      view.exAcc += rate * dts;
      while (view.exAcc > 1) { view.exAcc -= 1; addPuff(); }
      if (cur.phase === 'playing' && cur.speed > 500 && Math.random() < 0.3) {
        var side = Math.random() < 0.5 ? 1 : -1;
        view.particles.push({
          kind: 'dust', x: cur.x + side * (60 + Math.random() * 140), depth: cur.depth - (30 + Math.random() * 60),
          vx: side * (20 + Math.random() * 40), vd: 60 + Math.random() * 120,
          life: 0.3 + Math.random() * 0.2, maxLife: 0.5, size: 1.2 + Math.random() * 1.6, color: '#8fb8dd'
        });
      }
    }

    function sparksAt(x, depth, color, n, spd) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.283, s = spd * (0.3 + Math.random() * 0.7);
        view.particles.push({ kind: 'spark', x: x, depth: depth, vx: Math.cos(a) * s, vd: Math.sin(a) * s * 0.6, life: 0.35 + Math.random() * 0.3, maxLife: 0.65, size: 1.5 + Math.random() * 1.5, color: color });
      }
    }
    function shardsAt(x, depth, n) {
      var colors = ['#6b7689', '#454e63', '#d98a3a'];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * 6.283, s = 90 + Math.random() * 220;
        view.particles.push({ kind: 'shard', x: x, depth: depth, vx: Math.cos(a) * s, vd: Math.sin(a) * s * 0.8, life: 0.6 + Math.random() * 0.4, maxLife: 1, size: 2 + Math.random() * 3, color: colors[Math.floor(Math.random() * 3)], rot: a, vrot: (Math.random() * 2 - 1) * 6, grav: 420 });
      }
    }
    function burstAt(x, depth, color, n) {
      sparksAt(x, depth, color, n, 260);
      view.particles.push({ kind: 'ring', x: x, depth: depth, vx: 0, vd: 0, life: 0.4, maxLife: 0.4, size: 26, color: color });
    }
    function ringAt(x, depth, color, size) {
      view.particles.push({ kind: 'ring', x: x, depth: depth, vx: 0, vd: 0, life: 0.45, maxLife: 0.45, size: size, color: color });
    }

    function recentRock() {
      var best = null;
      for (var i = 0; i < cur.rocks.length; i++) {
        var r = cur.rocks[i];
        if (!r.active && Math.abs(r.depth - cur.depth) < 320) { if (!best || r.id > best.id) best = r; }
      }
      return best;
    }
    function recentItem() {
      var best = null;
      for (var i = 0; i < cur.items.length; i++) {
        var it = cur.items[i];
        if (!it.active && Math.abs(it.depth - cur.depth) < 240) { if (!best || it.id > best.id) best = it; }
      }
      return best;
    }

    // ---------- EVENT REACTIONS ----------
    function event(kind, sim) {
      cur = sim;
      if (kind === 'near_miss') {
        view.grazeT = 1;
        view.grazeDir = Math.random() < 0.5 ? 1 : -1;
        var s = Math.min(5, sim.nearStreak || 1);
        var closeness = 0.6;
        for (var nm = 0; nm < sim.rocks.length; nm++) {
          var nr = sim.rocks[nm];
          if (nr.active && nr.nearFired && nr.depth < sim.depth) {
            closeness = clamp(1 - nr.minGap / CONST.NEAR_MISS_GAP, 0, 1);
            break;
          }
        }
        view.shake = Math.max(view.shake, (1.2 + s * 0.8) * (0.5 + closeness * 0.5));
        var p = toScreen(sim.x, sim.depth);
        sparksAt(sim.x, sim.depth, '#bfe4ff', Math.round(4 + s * 3 + closeness * 6), 220);
        view.flash = { a: 0.08 + s * 0.03 + closeness * 0.06, color: '#bfe4ff' };
      } else if (kind === 'wall_contact') {
        view.hitT = 1;
        view.shake = Math.max(view.shake, 5);
        var p2 = toScreen(sim.x, sim.depth);
        shardsAt(sim.x, sim.depth, 8);
        ringAt(sim.x, sim.depth, '#ff9d5c', 40);
        view.flash = { a: 0.10, color: '#ff9d5c' };
      } else if (kind === 'rock_hit') {
        view.hitT = 1;
        view.shake = Math.max(view.shake, 6);
        var rock = recentRock();
        var px = rock ? toScreen(rock.x, rock.depth) : toScreen(sim.x, sim.depth);
        shardsAt(rock ? rock.x : sim.x, rock ? rock.depth : sim.depth, 14);
        ringAt(rock ? rock.x : sim.x, rock ? rock.depth : sim.depth, '#ffb066', 46);
        view.flash = { a: 0.14, color: '#ffb066' };
      } else if (kind === 'rock_broken') {
        view.shake = Math.max(view.shake, 5);
        var rock2 = recentRock();
        var rx = rock2 ? rock2.x : sim.x, rd = rock2 ? rock2.depth : sim.depth;
        burstAt(rx, rd, '#ffd75e', 12);
        ringAt(rx, rd, '#ffd75e', 50);
        view.flash = { a: 0.12, color: '#ffe08a' };
      } else if (kind === 'fragment') {
        var it = recentItem();
        var ix = it ? it.x : sim.x, id = it ? it.depth : sim.depth;
        sparksAt(ix, id, '#9ff3ff', 5, 180);
        view.flash = { a: 0.06, color: '#9ff3ff' };
      } else if (kind === 'power') {
        view.powerPop = 1;
        view.shake = Math.max(view.shake, 3);
        var pp = toScreen(sim.x, sim.depth);
        ringAt(sim.x, sim.depth, '#ffd75e', 60);
        burstAt(sim.x, sim.depth, '#ffd75e', 16);
        view.flash = { a: 0.28, color: '#ffe08a' };
      }
    }

    // ---------- HUD ----------
    function drawHUD() {
      var pad = 12;
      ctx.textBaseline = 'top';

      ctx.fillStyle = 'rgba(8,12,24,0.45)';
      roundRect(ctx, pad, pad, 148, 56, 12);
      ctx.fill();
      ctx.fillStyle = '#7fd6ff';
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillText('SCORE', pad + 12, pad + 8);
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '800 25px ' + FONT;
      ctx.fillText(fmt(cur.score), pad + 12, pad + 24);

      // time
      var bw = Math.min(210, Math.max(44, W - 148 - 118 - 28)), bx = (W - bw) / 2, by = pad;
      ctx.fillStyle = 'rgba(8,12,24,0.45)';
      roundRect(ctx, bx - 6, by - 6, bw + 12, 40, 12);
      ctx.fill();
      var frac = clamp(cur.remainingMs / CONST.START_TIME, 0, 1);
      var tcol = frac < 0.2 ? '#ff5c5c' : (frac < 0.35 ? '#ffb35c' : '#7fe0ff');
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, bx, by + 8, bw, 10, 5);
      ctx.fill();
      ctx.fillStyle = tcol;
      roundRect(ctx, bx, by + 8, bw * clamp(frac, 0, 1), 10, 5);
      ctx.fill();
      var secs = Math.max(0, cur.remainingMs / 1000);
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '800 13px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(secs.toFixed(1) + 's', bx + bw / 2, by + 22);
      ctx.textAlign = 'left';

      // depth
      ctx.fillStyle = 'rgba(8,12,24,0.45)';
      var dw = 118;
      roundRect(ctx, W - pad - dw, pad, dw, 56, 12);
      ctx.fill();
      ctx.fillStyle = '#7fd6ff';
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText('DEPTH', W - pad - 12, pad + 8);
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '800 25px ' + FONT;
      ctx.fillText(Math.round(cur.depth / 100) + 'm', W - pad - 12, pad + 24);
      ctx.textAlign = 'left';

      // danger vignette
      if (cur.phase === 'playing' && cur.remainingMs < 5000) {
        var d = 1 - clamp(cur.remainingMs / 5000, 0, 1);
        var va = 0.16 + 0.22 * d + 0.08 * Math.sin(view.time * 10);
        var vg2 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
        vg2.addColorStop(0, 'rgba(255,40,40,0)');
        vg2.addColorStop(1, 'rgba(255,40,40,' + clamp(va, 0, 0.5) + ')');
        ctx.fillStyle = vg2;
        ctx.fillRect(0, 0, W, H);
      }
      if (cur.phase === 'playing' && cur.invincibleUntilMs > cur.timeMs) {
        var vg3 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.65);
        vg3.addColorStop(0, 'rgba(255,215,94,0)');
        vg3.addColorStop(1, 'rgba(255,200,80,' + (0.08 + 0.07 * Math.sin(view.time * 8)) + ')');
        ctx.fillStyle = vg3;
        ctx.fillRect(0, 0, W, H);
      }
    }

    function drawFlash() {
      if (view.flash.a <= 0.01) return;
      ctx.fillStyle = view.flash.color;
      ctx.globalAlpha = clamp(view.flash.a, 0, 1);
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // ---------- SCREENS ----------
    function drawReady() {
      ctx.fillStyle = 'rgba(5,8,16,0.32)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '800 52px ' + FONT;
      ctx.shadowColor = 'rgba(120,200,255,0.55)';
      ctx.shadowBlur = 20;
      ctx.fillText('DELVE', W / 2, H * 0.055);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a93b8';
      ctx.font = '700 12px ' + FONT;
      ctx.fillText('A DEEP-DIGGING RUN', W / 2, H * 0.055 + 60);

      var pulse = 0.55 + 0.35 * Math.sin(view.time * 2.4);
      var ay = H * 0.78;
      ctx.strokeStyle = 'rgba(127,214,255,' + pulse + ')';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 11, ay);
      ctx.lineTo(W / 2, ay + 15);
      ctx.lineTo(W / 2 + 11, ay);
      ctx.stroke();
      ctx.fillStyle = 'rgba(127,214,255,' + pulse + ')';
      ctx.font = '800 15px ' + FONT;
      ctx.fillText('HOLD TO DIG', W / 2, H * 0.78 + 28);
      ctx.fillStyle = 'rgba(138,147,184,0.85)';
      ctx.font = '700 11px ' + FONT;
      ctx.fillText('drag down  ·  or hold the down key', W / 2, H * 0.78 + 52);
      ctx.lineCap = 'butt';
      ctx.textAlign = 'left';
    }

    function drawGameOver() {
      ctx.fillStyle = 'rgba(4,6,12,0.6)';
      ctx.fillRect(0, 0, W, H);
      var cw = Math.min(W - 40, 360), ch = Math.min(H * 0.64, 440);
      var cx0 = W / 2, cy0 = H / 2;
      ctx.fillStyle = 'rgba(12,18,34,0.9)';
      roundRect(ctx, cx0 - cw / 2, cy0 - ch / 2, cw, ch, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,255,0.28)';
      ctx.lineWidth = 2;
      roundRect(ctx, cx0 - cw / 2, cy0 - ch / 2, cw, ch, 18);
      ctx.stroke();
      ctx.textAlign = 'center';

      ctx.fillStyle = '#7fd6ff';
      ctx.font = '700 12px ' + FONT;
      ctx.fillText('RUN COMPLETE', cx0, cy0 - ch / 2 + 24);
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '800 42px ' + FONT;
      ctx.fillText(fmt(cur.score), cx0, cy0 - ch / 2 + 44);
      ctx.fillStyle = '#8a93b8';
      ctx.font = '700 12px ' + FONT;
      ctx.fillText('BEST  ' + fmt(view.best), cx0, cy0 - ch / 2 + 80);

      var rcol = rankColor(cur.rank);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.arc(cx0, cy0 - ch / 2 + 120, 27, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = rcol;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx0, cy0 - ch / 2 + 120, 27, 0, 6.283);
      ctx.stroke();
      ctx.fillStyle = rcol;
      ctx.font = '800 15px ' + FONT;
      ctx.fillText(cur.rank, cx0, cy0 - ch / 2 + 115);

      if (cur.signature) {
        ctx.fillStyle = '#ffd75e';
        ctx.font = '700 10px ' + FONT;
        ctx.fillText(cur.signature.label, cx0, cy0 - ch / 2 + 152);
        ctx.fillStyle = '#fff3d6';
        ctx.font = '800 17px ' + FONT;
        ctx.fillText(cur.signature.value, cx0, cy0 - ch / 2 + 168);
      }

      var stats = [
        ['DEPTH', Math.round(cur.depth / 100) + ' m'],
        ['FRAGMENTS', cur.fragmentsCollected],
        ['ROCKS', cur.rocksBroken],
        ['HITS', cur.hits],
        ['NEAR MISSES', cur.nearMisses],
        ['WALLS', cur.wallContacts]
      ];
      var cw2 = (cw - 44) / 3, chh = 36;
      var baseY = cy0 + ch / 2 - 168;
      for (var i = 0; i < stats.length; i++) {
        var col = i % 3, row = Math.floor(i / 3);
        var x0 = cx0 - cw / 2 + 14 + col * cw2, y0 = baseY + row * (chh + 8);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, x0, y0, cw2 - 8, chh, 8);
        ctx.fill();
        ctx.fillStyle = '#8a93b8';
        ctx.font = '700 9px ' + FONT;
        ctx.fillText(stats[i][0], x0 + (cw2 - 8) / 2, y0 + 5);
        ctx.fillStyle = '#f2f6ff';
        ctx.font = '800 14px ' + FONT;
        ctx.fillText(String(stats[i][1]), x0 + (cw2 - 8) / 2, y0 + 17);
      }

      var pulse = 0.6 + 0.4 * Math.sin(view.time * 2.6);
      ctx.fillStyle = 'rgba(127,214,255,' + pulse + ')';
      ctx.font = '800 13px ' + FONT;
      ctx.fillText('TAP OR PRESS SPACE TO DIG AGAIN', cx0, cy0 + ch / 2 - 22);
      ctx.textAlign = 'left';
    }

    // ---------- MAIN RENDER ----------
    function render(sim, dt) {
      cur = sim;
      view.time += dt / 1000;
      var dts = dt / 1000;

      view.shake *= Math.pow(0.001, dts);
      if (view.shake < 0.1) view.shake = 0;
      view.grazeT *= Math.pow(0.001, dts);
      view.hitT *= Math.pow(0.001, dts);
      view.powerPop *= Math.pow(0.001, dts);
      view.flash.a *= Math.pow(0.001, dts);

      view.blinkT -= dts;
      if (view.blinkT <= 0) { view.blinkDur = 0.08 + hash(sim.tick) * 0.08; view.blinkT = 2 + hash(sim.tick + 5) * 3; }

      if (sim.phase === 'playing' && sim.score > view.best) view.best = sim.score;

      updateParticles(dts);
      spawnAmbient(dts);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var shx = (Math.random() * 2 - 1) * view.shake, shy = (Math.random() * 2 - 1) * view.shake;
      ctx.save();
      ctx.translate(shx, shy);

      drawBackground();
      drawCorridor();
      drawSpeedStreaks();
      drawRocks();
      drawItems();
      drawParticles();
      drawMachine();

      ctx.restore();

      drawFlash();
      drawHUD();
      if (sim.phase === 'ready') drawReady();
      if (sim.phase === 'gameover') drawGameOver();
    }

    resize();
    reset(0);

    return { render: render, resize: resize, reset: reset, event: event };
  }

  D.render = { createRenderer: createRenderer };
})();