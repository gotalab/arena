/* SHOAL — canvas view. Dressing only; never writes production state. */
(function (global) {
  "use strict";

  var NUM_COL = [
    null,
    "#4ecdc8",
    "#7bc96f",
    "#e07a4a",
    "#8b7cf0",
    "#e85d75",
    "#3aa7c9",
    "#f0eef5",
    "#f4b8c8",
  ];

  function createView(canvas) {
    var ctx = canvas.getContext("2d");
    var layout = null;
    var dpr = 1;
    var cssW = 1;
    var cssH = 1;
    var shake = 0;
    var flash = 0;
    var clearFlash = 0;
    var bubbles = [];
    var motes = [];
    var lastRows = null;
    var unfolding = [];
    var host = { x: 0.5, face: 1, bob: 0, mood: "idle", moodUntil: 0, lookX: 0.5 };

    for (var i = 0; i < 18; i++) {
      motes.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.4 + Math.random() * 1.4,
        s: 0.15 + Math.random() * 0.4,
        p: Math.random() * Math.PI * 2,
      });
    }
    for (i = 0; i < 7; i++) {
      bubbles.push({
        x: 0.15 + Math.random() * 0.7,
        y: Math.random(),
        r: 1.2 + Math.random() * 2.5,
        s: 0.08 + Math.random() * 0.18,
      });
    }

    function fit(width, height) {
      cssW = Math.max(1, width);
      cssH = Math.max(1, height);
      dpr = Math.min(2.5, global.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function computeLayout(snap) {
      var w = snap.gridWidth;
      var h = snap.gridHeight;
      var pad = Math.max(10, Math.min(cssW, cssH) * 0.035);
      var hud = Math.max(58, Math.min(84, cssH * 0.12));
      var hostH = Math.max(48, Math.min(72, cssH * 0.1));
      var availW = cssW - pad * 2;
      var availH = cssH - hud - hostH - pad;
      var cell = Math.floor(Math.min(availW / w, availH / h, 72));
      cell = Math.max(22, cell);
      var bw = cell * w;
      var bh = cell * h;
      var bx = Math.floor((cssW - bw) / 2);
      var by = Math.floor(hud + (availH - bh) / 2);
      layout = {
        pad: pad,
        hud: hud,
        hostH: hostH,
        cell: cell,
        w: w,
        h: h,
        bx: bx,
        by: by,
        bw: bw,
        bh: bh,
      };
      return layout;
    }

    function cellAt(px, py) {
      if (!layout) return null;
      var x = Math.floor((px - layout.bx) / layout.cell);
      var y = Math.floor((py - layout.by) / layout.cell);
      if (x < 0 || y < 0 || x >= layout.w || y >= layout.h) return null;
      return { x: x, y: y };
    }

    function roundRect(x, y, w, h, r) {
      var rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function drawWater(t) {
      var g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, "#0a3038");
      g.addColorStop(0.45, "#0c3d42");
      g.addColorStop(1, "#071820");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);

      ctx.save();
      ctx.globalAlpha = 0.22;
      var i, y;
      for (i = 0; i < 5; i++) {
        y = ((t * 0.018 + i * 37) % (cssH + 80)) - 40;
        ctx.strokeStyle = i % 2 ? "rgba(120, 220, 210, 0.35)" : "rgba(230, 250, 240, 0.2)";
        ctx.lineWidth = 10 - i;
        ctx.beginPath();
        ctx.moveTo(-20, y);
        for (var x = 0; x <= cssW + 20; x += 12) {
          ctx.lineTo(x, y + Math.sin(x * 0.02 + t * 0.002 + i) * (8 + i * 2));
        }
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.35;
      for (i = 0; i < bubbles.length; i++) {
        var b = bubbles[i];
        var bx = b.x * cssW + Math.sin(t * 0.0006 + i) * 10;
        var by = cssH - ((t * b.s * 0.04 + b.y * cssH) % (cssH + 20));
        ctx.strokeStyle = "rgba(210, 255, 245, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < motes.length; i++) {
        var m = motes[i];
        var mx = m.x * cssW + Math.sin(t * 0.0008 + m.p) * 18;
        var my = ((m.y * cssH - t * m.s * 0.012) % cssH + cssH) % cssH;
        ctx.fillStyle = "rgba(210, 255, 240," + (0.08 + m.r * 0.04) + ")";
        ctx.beginPath();
        ctx.arc(mx, my, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawBasin() {
      var L = layout;
      var x = L.bx - L.cell * 0.18;
      var y = L.by - L.cell * 0.18;
      var w = L.bw + L.cell * 0.36;
      var h = L.bh + L.cell * 0.42;
      ctx.save();
      roundRect(x, y, w, h, L.cell * 0.35);
      ctx.fillStyle = "rgba(6, 28, 32, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(186, 140, 88, 0.45)";
      ctx.lineWidth = Math.max(3, L.cell * 0.08);
      ctx.stroke();
      ctx.strokeStyle = "rgba(90, 70, 48, 0.35)";
      ctx.lineWidth = Math.max(8, L.cell * 0.16);
      ctx.stroke();
      ctx.restore();
    }

    function drawShell(cx, cy, size, t, seed) {
      var rx = size * 0.42;
      var ry = size * 0.36;
      ctx.save();
      ctx.translate(cx, cy + size * 0.04);
      ctx.rotate(Math.sin(seed) * 0.08);
      var g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.4, 2, 0, 0, rx);
      g.addColorStop(0, "#f3e2c2");
      g.addColorStop(0.55, "#d7b07a");
      g.addColorStop(1, "#a57a48");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(90, 58, 32, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 245, 220, 0.28)";
      ctx.beginPath();
      ctx.ellipse(0, 2, rx * 0.62, ry * 0.22, 0, 0, Math.PI);
      ctx.stroke();
      var gl = 0.18 + 0.12 * Math.sin(t * 0.002 + seed);
      ctx.fillStyle = "rgba(255,255,240," + gl + ")";
      ctx.beginPath();
      ctx.ellipse(-rx * 0.28, -ry * 0.32, rx * 0.28, ry * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawOpen(cx, cy, size, n, t) {
      var r = size * 0.4;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = "rgba(8, 36, 40, 0.72)";
      ctx.beginPath();
      ctx.ellipse(0, 2, r, r * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      var g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0, "rgba(196, 168, 112, 0.35)");
      g.addColorStop(1, "rgba(40, 28, 16, 0.0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.92, r * 0.78, 0, 0, Math.PI * 2);
      ctx.fill();
      if (n > 0) {
        ctx.fillStyle = NUM_COL[n] || "#fff";
        ctx.font = "600 " + Math.max(12, size * 0.46) + "px Georgia, Palatino, serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = 4;
        ctx.fillText(String(n), 0, 1);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = "rgba(90, 200, 190, 0.18)";
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18 + Math.sin(t * 0.004) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function drawPennant(cx, cy, size, wrong) {
      ctx.save();
      ctx.translate(cx, cy - size * 0.06);
      ctx.strokeStyle = "#5a3a22";
      ctx.lineWidth = Math.max(1.4, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(0, size * 0.28);
      ctx.lineTo(0, -size * 0.28);
      ctx.stroke();
      ctx.fillStyle = wrong ? "#c4b8a4" : "#ff5a45";
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.28);
      ctx.lineTo(size * 0.32, -size * 0.14);
      ctx.lineTo(0, -size * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function drawUrchin(cx, cy, size, fatal) {
      var r = size * 0.18;
      var i, a;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = fatal ? "#6b1030" : "#2a1038";
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fatal ? "#ff7a9a" : "#c9a0e8";
      ctx.lineWidth = Math.max(1.2, size * 0.035);
      for (i = 0; i < 11; i++) {
        a = (i / 11) * Math.PI * 2 + 0.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(Math.cos(a) * size * 0.34, Math.sin(a) * size * 0.34);
        ctx.stroke();
      }
      if (fatal) {
        ctx.strokeStyle = "rgba(255, 90, 80, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.38, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function sweepReady(snap, x, y) {
      var ch = snap.rows[y][x];
      if (ch < "0" || ch > "8") return false;
      var n = +ch;
      var flags = 0;
      var cov = 0;
      var dx, dy, nx, ny, c;
      for (dy = -1; dy <= 1; dy++) {
        for (dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          nx = x + dx;
          ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= snap.gridWidth || ny >= snap.gridHeight) continue;
          c = snap.rows[ny][nx];
          if (c === "F") flags++;
          else if (c === "#") cov++;
        }
      }
      return flags === n && cov > 0;
    }

    function drawCell(ch, x, y, t, hover, press, ready) {
      var L = layout;
      var size = L.cell;
      var cx = L.bx + x * size + size / 2;
      var cy = L.by + y * size + size / 2;
      var seed = x * 13 + y * 7;
      if (ready) {
        ctx.strokeStyle = "rgba(232, 184, 109," + (0.35 + 0.25 * Math.sin(t * 0.006)) + ")";
        ctx.lineWidth = Math.max(1.5, size * 0.045);
        roundRect(L.bx + x * size + 3, L.by + y * size + 3, size - 6, size - 6, 8);
        ctx.stroke();
      }
      if (hover) {
        ctx.fillStyle = "rgba(232, 184, 109, 0.12)";
        roundRect(L.bx + x * size + 2, L.by + y * size + 2, size - 4, size - 4, 8);
        ctx.fill();
      }
      if (press) {
        cy += 1;
      }
      if (ch === "#") drawShell(cx, cy, size, t, seed);
      else if (ch === "F") {
        drawShell(cx, cy, size, t, seed);
        drawPennant(cx, cy, size, false);
      } else if (ch === "*") drawUrchin(cx, cy, size, false);
      else if (ch === "X") drawUrchin(cx, cy, size, true);
      else if (ch === "+") {
        drawUrchin(cx, cy, size, false);
        drawPennant(cx, cy, size, false);
      } else if (ch === "-") {
        drawOpen(cx, cy, size, 0, t);
        drawPennant(cx, cy, size, true);
      } else {
        drawOpen(cx, cy, size, ch === "0" ? 0 : +ch, t);
      }
    }

    function drawNib(t, snap, now) {
      var L = layout;
      var remain = 0;
      var rows = snap.rows;
      var y, x;
      for (y = 0; y < rows.length; y++) {
        for (x = 0; x < rows[y].length; x++) {
          if (rows[y][x] === "#" || rows[y][x] === "F") remain++;
        }
      }
      if (now > host.moodUntil) {
        if (snap.phase === "ended") host.mood = "stung";
        else if (clearFlash > 0.4) host.mood = "proud";
        else if (snap.phase === "playing" && remain > 0 && remain <= 7 && snap.firstTurnDone) host.mood = "hold";
        else host.mood = snap.phase === "ready" ? "idle" : "idle";
      }
      var wander = snap.phase === "ready" ? Math.sin(t * 0.00035) * 0.28 : Math.sin(t * 0.0002) * 0.12;
      host.x += ((0.5 + wander) - host.x) * 0.04;
      var px = L.bx + host.x * L.bw;
      var py = L.by + L.bh + L.cell * 0.22;
      var hop = 0;
      var squish = 1;
      var pale = 1;
      if (host.mood === "joy") hop = Math.abs(Math.sin((host.moodUntil - now) * 0.02)) * 10;
      if (host.mood === "curious") hop = 3;
      if (host.mood === "proud") hop = 6;
      if (host.mood === "hold") squish = 0.82;
      if (host.mood === "stung") {
        hop = -4;
        pale = 0.55;
        squish = 0.7;
      }
      ctx.save();
      ctx.translate(px, py - hop);
      ctx.scale(host.face, squish);
      ctx.globalAlpha = pale;
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, 10, 18, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f3ead8";
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      var stripe = ctx.createLinearGradient(-10, -6, 10, 6);
      stripe.addColorStop(0, "rgba(78, 205, 200, 0.1)");
      stripe.addColorStop(0.5, host.mood === "proud" ? "rgba(232, 184, 109, 0.85)" : "rgba(78, 205, 200, 0.55)");
      stripe.addColorStop(1, "rgba(78, 205, 200, 0.1)");
      ctx.fillStyle = stripe;
      ctx.beginPath();
      ctx.ellipse(0, -2, 11, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e8dcc4";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-4, -7);
      ctx.quadraticCurveTo(-6, -18, -8, -22);
      ctx.moveTo(4, -7);
      ctx.quadraticCurveTo(6, -18, 8, -22);
      ctx.stroke();
      ctx.fillStyle = "#4ecdc8";
      ctx.beginPath();
      ctx.arc(-8, -22, 2.1, 0, Math.PI * 2);
      ctx.arc(8, -22, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e2430";
      var blink = Math.sin(t * 0.004) > 0.96 ? 0.2 : 1;
      ctx.beginPath();
      ctx.ellipse(-5, -1, 1.6, 1.6 * blink, 0, 0, Math.PI * 2);
      ctx.ellipse(3, -1, 1.6, 1.6 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      if (host.mood === "stung") {
        ctx.strokeStyle = "rgba(255,90,69,0.7)";
        ctx.beginPath();
        ctx.moveTo(10, -2);
        ctx.lineTo(16, -6);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawHud(snap, t) {
      var L = layout;
      ctx.save();
      ctx.fillStyle = "rgba(243, 234, 216, 0.92)";
      ctx.font = "600 " + Math.max(18, L.cell * 0.42) + "px Georgia, Palatino, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("SHOAL", L.pad, 12);

      ctx.textAlign = "right";
      ctx.fillStyle = "#e8b86d";
      ctx.font = "600 " + Math.max(18, L.cell * 0.4) + "px Georgia, Palatino, serif";
      ctx.fillText(String(snap.pearls), cssW - L.pad, 12);
      ctx.font = "500 10px Georgia, Palatino, serif";
      ctx.fillStyle = "rgba(215,239,232,0.5)";
      ctx.fillText("PEARLS", cssW - L.pad, 12 + Math.max(18, L.cell * 0.4) + 2);

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(215,239,232,0.7)";
      ctx.font = "500 " + Math.max(11, L.cell * 0.22) + "px Georgia, Palatino, serif";
      var poolLabel = "pool " + snap.pool;
      var secondY = 12 + Math.max(18, L.cell * 0.42) + 6;
      ctx.textBaseline = "middle";
      ctx.fillText(poolLabel, L.pad, secondY);
      var after = L.pad + ctx.measureText(poolLabel).width + 14;
      ctx.fillStyle = "#2a1038";
      ctx.beginPath();
      ctx.arc(after + 7, secondY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c9a0e8";
      ctx.lineWidth = 1.2;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(after + 7 + Math.cos(a) * 2.5, secondY + Math.sin(a) * 2.5);
        ctx.lineTo(after + 7 + Math.cos(a) * 9, secondY + Math.sin(a) * 9);
        ctx.stroke();
      }
      ctx.fillStyle = "#f3ead8";
      ctx.font = "600 15px Georgia, Palatino, serif";
      ctx.textAlign = "left";
      ctx.fillText(String(snap.urchinsLeft), after + 20, secondY);

      var barW = Math.min(cssW - L.pad * 2, L.bw);
      var barX = (cssW - barW) / 2;
      var barY = L.by - 16;
      if (barY < L.hud - 8) barY = L.hud - 10;
      roundRect(barX, barY, barW, 7, 4);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      var tf = snap.phase === "ready" || !snap.firstTurnDone ? 1 : snap.tideFraction;
      var low = tf < 0.22 && snap.firstTurnDone;
      ctx.fillStyle = low ? "#e07a4a" : "#4ecdc8";
      if (low && Math.sin(t * 0.008) > 0) ctx.globalAlpha = 0.7;
      roundRect(barX, barY, Math.max(0, barW * tf), 7, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function drawTitle(snap, t) {
      if (snap.phase !== "ready" || snap.moves > 0) return;
      var L = layout;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(243,234,216," + (0.55 + 0.15 * Math.sin(t * 0.002)) + ")";
      ctx.font = "500 " + Math.max(12, L.cell * 0.22) + "px Georgia, Palatino, serif";
      ctx.fillText("turn a shell", cssW / 2, L.by + L.bh * 0.52);
      ctx.restore();
    }

    function drawClearBanner(now) {
      if (clearFlash <= 0) return;
      var a = Math.min(1, clearFlash);
      ctx.save();
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = "rgba(232, 184, 109, 0.16)";
      ctx.fillRect(0, cssH * 0.38, cssW, 44);
      ctx.fillStyle = "#f3ead8";
      ctx.textAlign = "center";
      ctx.font = "600 20px Georgia, Palatino, serif";
      ctx.fillText("the pool yields", cssW / 2, cssH * 0.38 + 28);
      ctx.restore();
    }

    function drawUnfolding(now) {
      var L = layout;
      if (!L || !unfolding.length) return;
      ctx.save();
      for (var i = 0; i < unfolding.length; i++) {
        var u = unfolding[i];
        var age = now - u.at;
        if (age < -50 || age > 380) continue;
        var x = u.idx % L.w;
        var y = (u.idx / L.w) | 0;
        var cx = L.bx + x * L.cell + L.cell / 2;
        var cy = L.by + y * L.cell + L.cell / 2;
        var k = age < 0 ? 0 : age / 380;
        var r = L.cell * (0.12 + k * 0.42);
        var a = age < 0 ? 0.4 : 0.4 * (1 - k);
        ctx.strokeStyle = "rgba(170, 240, 230," + a + ")";
        ctx.lineWidth = Math.max(1.5, L.cell * 0.05);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function applyJuice(juice, now, gridWidth) {
      if (!juice) return;
      unfolding = [];
      if (juice.opened && juice.opened.length) {
        for (var i = 0; i < juice.opened.length; i++) {
          unfolding.push({ idx: juice.opened[i], at: now + i * 26 });
        }
      }
      if (juice.origin) host.face = juice.origin.x < (gridWidth || 6) / 2 ? -1 : 1;
      if (juice.sting) {
        shake = 1;
        flash = 1;
        host.mood = "stung";
        host.moodUntil = now + 4000;
      } else if (juice.clear) {
        clearFlash = 1;
        host.mood = "proud";
        host.moodUntil = now + 1400;
      } else if (juice.kind === "open" && juice.opened && juice.opened.length > 4) {
        host.mood = "joy";
        host.moodUntil = now + 900;
      } else if (juice.kind === "flag") {
        host.mood = "curious";
        host.moodUntil = now + 400;
      }
    }

    function draw(snap, t, extra) {
      extra = extra || {};
      if (extra.resizeW) fit(extra.resizeW, extra.resizeH);
      computeLayout(snap);
      if (shake > 0) shake *= 0.86;
      if (flash > 0) flash *= 0.9;
      if (clearFlash > 0) clearFlash *= 0.965;
      var ox = (Math.random() * 2 - 1) * shake * 6;
      var oy = (Math.random() * 2 - 1) * shake * 6;
      ctx.save();
      ctx.translate(ox, oy);
      drawWater(t);
      drawBasin();
      var hover = extra.hover;
      var press = extra.press;
      var y, x, ch;
      for (y = 0; y < snap.gridHeight; y++) {
        for (x = 0; x < snap.gridWidth; x++) {
          ch = snap.rows[y][x];
          drawCell(
            ch,
            x,
            y,
            t,
            hover && hover.x === x && hover.y === y,
            press && press.x === x && press.y === y,
            snap.phase !== "ended" && sweepReady(snap, x, y)
          );
        }
      }
      drawNib(t, snap, extra.now || t);
      drawUnfolding(extra.now || t);
      ctx.restore();
      drawHud(snap, t);
      drawTitle(snap, t);
      drawClearBanner(extra.now || t);
      if (flash > 0.05) {
        ctx.fillStyle = "rgba(120, 16, 40," + flash * 0.32 + ")";
        ctx.fillRect(0, 0, cssW, cssH);
      }
      lastRows = snap.rows;
    }

    return {
      fit: fit,
      draw: draw,
      cellAt: cellAt,
      applyJuice: applyJuice,
      layout: function () {
        return layout;
      },
    };
  }

  global.createShoalView = createView;
})(typeof window !== "undefined" ? window : globalThis);
