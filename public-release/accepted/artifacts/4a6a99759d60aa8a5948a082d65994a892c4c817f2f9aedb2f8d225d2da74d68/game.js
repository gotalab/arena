/* ============================================================================
   SHOAL — presentation, input, sound, host, and platform integration.
   One board: human gestures, window.__ARENA_GAME__, and the arena.game.v1
   bridge all drive the same core (window.ShoalCore).
   ============================================================================ */
(function () {
  "use strict";

  var Core = window.ShoalCore;
  var game = new Core.ArenaGame();

  /* ---------------- DOM ---------------- */
  var canvas = document.getElementById("pool");
  var ctx = canvas.getContext("2d");
  var stageEl = document.getElementById("stage");
  var poolNoEl = document.getElementById("poolNo");
  var pearlsEl = document.getElementById("pearls");
  var urchinsEl = document.getElementById("urchins");
  var tideFillEl = document.getElementById("tideFill");
  var toastEl = document.getElementById("toast");
  var hintEl = document.getElementById("hint");
  var titleEl = document.getElementById("title");
  var ceremonyEl = document.getElementById("ceremony");
  var cerKickerEl = document.getElementById("cerKicker");
  var cerRankEl = document.getElementById("cerRank");
  var cerPearlsEl = document.getElementById("cerPearls");
  var cerBestEl = document.getElementById("cerBest");
  var cerPoolEl = document.getElementById("cerPool");
  var cerRippleEl = document.getElementById("cerRipple");
  var cerFastEl = document.getElementById("cerFast");
  var cerLadderEl = document.getElementById("cerLadder");
  var cerNoteEl = document.getElementById("cerNote");

  var NUM_COLORS = {
    0: "#7fd8c8", 1: "#a7e6c4", 2: "#3ec8ae", 3: "#43b5dd",
    4: "#5f86e0", 5: "#9d72d4", 6: "#d375bc", 7: "#ecab3f", 8: "#ff6b6b"
  };

  /* ---------------- view state ---------------- */
  var lastSnap = game.snapshot();
  var layout = { cell: 40, ox: 0, oy: 0 };
  var popTimes = Object.create(null); // "x,y" -> ms when shell popped open
  var effects = [];                   // cosmetic effect objects
  var shake = 0;                      // screen shake magnitude
  var stingFlash = 0;
  var host = { x: 0, face: 1, state: "idle", stateT: 0, bob: 0, blink: 0, eyes: 0, jump: 0 };
  var held = null;                    // {cellX, cellY, t0, x0, y0, toggled, cancelled}
  var holdProgress = 0;
  var toastTimer = 0;
  var toastTxt = "";
  var lastPool = 1;
  var lastTide = 1;
  var audioReady = false;
  var audioCtx = null;
  var audioOn = false;
  var ambientNodes = null;
  var tideLowHit = false;
  var wasEnded = false;
  var hintTimer = 0;
  var hintedFlag = false;
  var hintedSweep = false;
  var pendingCeremony = null;

  var HOLD_MS = 460;
  var DRAG_CANCEL = 16;
  var POP_STEP = 34;
  var POP_DUR = 220;

  /* ---------------- helpers ---------------- */
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeOutBack(t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  function cellKey(x, y) { return x + "," + y; }

  /* ---------------- sizing / layout ---------------- */
  var DPR = 1;
  function resize() {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    DPR = Math.min(2.5, (window.devicePixelRatio || 1));
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    computeLayout();
  }
  function hudTop() { return 52; }
  function hostH() { return 74; }
  function computeLayout() {
    var cw = stageEl.clientWidth, ch = stageEl.clientHeight;
    var W = lastSnap.gridWidth, H = lastSnap.gridHeight;
    var top = hudTop(), bottom = hostH();
    var availW = cw - 24;
    var availH = Math.max(80, ch - top - bottom);
    var cell = Math.min(availW / W, availH / H);
    if (cell > 96) cell = 96;
    layout.cell = cell;
    layout.ox = Math.round((cw - cell * W) / 2);
    layout.oy = Math.round(top + (availH - cell * H) / 2);
    layout.cols = W; layout.rows = H;
  }
  function cellCenter(x, y) {
    return { x: layout.ox + (x + 0.5) * layout.cell, y: layout.oy + (y + 0.5) * layout.cell };
  }
  function cellFromPoint(px, py) {
    var x = Math.floor((px - layout.ox) / layout.cell);
    var y = Math.floor((py - layout.oy) / layout.cell);
    if (x < 0 || x >= layout.cols || y < 0 || y >= layout.rows) return null;
    return { x: x, y: y };
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { resize(); }).observe(stageEl);
  }

  /* ---------------- deterministic per-shell phase ---------------- */
  function shellPhase(x, y) {
    var s = Core._seedHash(game.seed + "", [lastSnap.pool, x + "," + y, "anim"]);
    return (s % 10000) / 10000;
  }

  /* ==========================================================================
     PERFORM (unified action entry — human, interface, and bridge)
     ========================================================================== */
  function perform(action) {
    var before = lastSnap;
    var res = game.act(action);
    if (res.ok) {
      var after = res.state;
      onAccepted(before, after, action);
      lastSnap = after;
      render();
      return res;
    }
    feedback(res.error.code);
    render();
    return res;
  }

  function onAccepted(before, after, action) {
    var now = nowMs();
    if (after.pool !== before.pool) onPoolChange(before, after);
    var type = action.type;
    var ox = action.x, oy = action.y;

    if (type === "open" || type === "sweep") {
      // find newly revealed cells
      var fresh = [];
      for (var y = 0; y < after.gridHeight; y++) {
        for (var x = 0; x < after.gridWidth; x++) {
          var bc = before.rows[y] ? before.rows[y][x] : "#";
          var ac = after.rows[y][x];
          if (bc !== ac && ac >= "0" && ac <= "8") fresh.push({ x: x, y: y });
        }
      }
      var opened = fresh.length;
      // BFS order from the action origin
      var ordered = [];
      var seen = {};
      var q = [{ x: ox, y: oy }];
      while (q.length) {
        var c = q.shift();
        var k = c.x + "," + c.y;
        if (seen[k]) continue;
        seen[k] = 1;
        var hit = false;
        for (var i = 0; i < fresh.length; i++) {
          if (fresh[i].x === c.x && fresh[i].y === c.y) { hit = true; break; }
        }
        if (!hit) continue;
        ordered.push(c);
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var nx = c.x + dx, ny = c.y + dy;
          if (nx < 0 || nx >= after.gridWidth || ny < 0 || ny >= after.gridHeight) continue;
          for (var j = 0; j < fresh.length; j++) {
            if (fresh[j].x === nx && fresh[j].y === ny) { q.push({ x: nx, y: ny }); break; }
          }
        }
      }
      ordered.forEach(function (c, idx) {
        popTimes[cellKey(c.x, c.y)] = now + idx * POP_STEP;
      });
      // travelling ripple ring(s)
      if (ordered.length) {
        var span = Math.max(1, Math.sqrt(ordered.length));
        effects.push({
          kind: "ripple", x: ox, y: oy, t0: now,
          dur: POP_STEP * ordered.length + POP_DUR + 260,
          maxR: layout.cell * (1.2 + span * 0.9), color: "#bfeee2", phase: 0
        });
        if (type === "sweep") {
          effects.push({ kind: "sweepFlash", x: ox, y: oy, t0: now, dur: 320, r: layout.cell * 2.1, color: "#ffeebc" });
          audio.sweep();
        }
        audio.ripple(opened);
      }
      if (opened === 1 && type === "open") audio.tick();
      hostReact("ripple");
      if (before.phase === "ready") {
        // first turn of the run: reveal the hold gesture
        hint("hold a shell to plant a <b>pennant</b>", 3000);
      }
    } else if (type === "flag") {
      effects.push({ kind: "pennant", x: ox, y: oy, t0: now, dur: 380, plant: true });
      audio.pennant(true);
      hostReact("curious");
      if (!hintedSweep) {
        hintedSweep = true;
        hint("tap a number whose pennants match to <b>sweep</b>", 3000);
      }
    } else if (type === "unflag") {
      effects.push({ kind: "pennant", x: ox, y: oy, t0: now, dur: 380, plant: false });
      audio.pennant(false);
    }

    var ev = after.lastEvent;
    if (ev && ev.kind === "pool_clear") {
      toast("pool cleared  +" + ev.bonus + " pearls");
      effects.push({ kind: "clear", t0: now, dur: 1400 });
      audio.clear();
      hostReact("proud");
    }
    if (ev && ev.kind === "sting") {
      shake = 14;
      stingFlash = 0.85;
      effects.push({ kind: "sting", x: ev.x, y: ev.y, t0: now, dur: 900 });
      audio.sting();
      hostReact("stung");
    }
    if (after.phase === "ended" && before.phase !== "ended") {
      if (after.stungAt) {
        pendingCeremony = { snap: after, at: nowMs() + 850 }; // let the jolt land first
      } else {
        showCeremony(after);
      }
    }
  }

  function onPoolChange(before, after) {
    popTimes = Object.create(null);
    effects = effects.filter(function (e) { return e.kind === "sting" || e.kind === "clear"; });
    computeLayout();
    lastPool = after.pool;
  }

  function feedback(code) {
    if (code === "unsatisfied" || code === "bad_action") {
      audio.deny();
    }
  }

  function toast(text) {
    toastTxt = text;
    toastEl.innerHTML = '<span class="t">' + text + "</span>";
    toastEl.classList.add("show");
    toastTimer = nowMs();
  }
  function hint(text, dur) {
    hintEl.innerHTML = '<span class="h">' + text + "</span>";
    hintEl.classList.add("show");
    hintTimer = nowMs() + (dur || 2600);
  }
  function hideHint() {
    hintEl.classList.remove("show");
    hintTimer = 0;
  }

  /* ---------------- host reactions ---------------- */
  function hostReact(state) {
    host.state = state;
    host.stateT = nowMs();
  }

  /* ==========================================================================
     HUD
     ========================================================================== */
  function updateHud() {
    var s = lastSnap;
    poolNoEl.textContent = s.pool;
    pearlsEl.textContent = s.pearls;
    urchinsEl.textContent = s.urchinsLeft;
    var pct = Math.round(s.tideFraction * 100);
    tideFillEl.style.width = pct + "%";
    var low = s.tideFraction < 0.25;
    tideFillEl.classList.toggle("low", low);
    if (s.phase === "playing" && s.firstTurnDone && low && !tideLowHit) {
      tideLowHit = true;
      audio.hush();
    }
    if (s.firstTurnDone && !low) tideLowHit = false;
    if (toastTimer && nowMs() - toastTimer > 1600) {
      toastEl.classList.remove("show");
      toastTimer = 0;
    }
    if (hintTimer && nowMs() > hintTimer) hideHint();
    titleEl.classList.toggle("hide", s.phase !== "ready");
  }

  /* ==========================================================================
     CEREMONY
     ========================================================================== */
  function showCeremony(s) {
    var stung = !!s.stungAt;
    cerKickerEl.textContent = stung ? "stung by an urchin" : "the whole tide honored";
    cerRankEl.textContent = s.rank;
    cerPearlsEl.textContent = s.pearls;
    cerBestEl.textContent = Math.max(s.sessionBest, s.pearls);
    cerPoolEl.textContent = s.pool;
    cerRippleEl.textContent = s.biggestRipple;
    cerFastEl.textContent = s.fastestClearMs <= 0 ? "—" : formatClear(s.fastestClearMs);
    var ladder = "";
    for (var i = 0; i < s.rankLadder.length; i++) {
      var here = s.rankLadder[i] === s.rank;
      ladder += '<span class="gr' + (here ? " here" : "") + '">' + s.rankLadder[i] + "</span>";
    }
    cerLadderEl.innerHTML = ladder;
    cerNoteEl.textContent = stung
      ? "every urchin shows where it lay. the fatal shell is marked — look, then dive again."
      : "not a single guess. the water never lies.";
    ceremonyEl.hidden = false;
    stageEl.classList.add("ended");
  }
  function formatClear(ms) {
    var sec = Math.round(ms / 1000);
    return sec + "s";
  }
  function hideCeremony() {
    ceremonyEl.hidden = true;
    stageEl.classList.remove("ended");
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  var lastFrame = 0;
  function render() {
    var t = nowMs();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, stageEl.clientWidth, stageEl.clientHeight);
    ctx.save();
    if (shake > 0.1) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawWater(t);
    drawGrid(t);
    drawEffects(t);
    drawHost(t);
    ctx.restore();
    if (stingFlash > 0) {
      ctx.fillStyle = "rgba(255,40,40," + stingFlash * 0.28 + ")";
      ctx.fillRect(0, 0, stageEl.clientWidth, stageEl.clientHeight);
    }
    drawHoldRing(t);
  }

  /* ---------- water ---------- */
  var waterSpecks = [];
  (function () {
    for (var i = 0; i < 26; i++) {
      waterSpecks.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.4 + Math.random() * 1.2, p: Math.random() * 100 });
    }
  })();
  function drawWater(t) {
    var w = stageEl.clientWidth, h = stageEl.clientHeight;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0c445c");
    g.addColorStop(0.45, "#0b3a50");
    g.addColorStop(1, "#082c3e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // drifting light shafts
    for (var i = 0; i < 3; i++) {
      var sway = Math.sin(t * 0.0004 + i * 2.1) * 40;
      var x = (w * (0.25 + 0.25 * i)) + sway;
      var gg = ctx.createLinearGradient(x - 60, 0, x + 60, 0);
      gg.addColorStop(0, "rgba(140,220,210,0)");
      gg.addColorStop(0.5, "rgba(140,220,210,0.05)");
      gg.addColorStop(1, "rgba(140,220,210,0)");
      ctx.fillStyle = gg;
      ctx.fillRect(x - 60, 0, 120, h);
    }

    // sand floor hint
    var floorY = layout.oy + layout.rows * layout.cell + layout.cell * 0.5;
    if (floorY < h) {
      var fg = ctx.createLinearGradient(0, floorY, 0, h);
      fg.addColorStop(0, "rgba(214,190,138,0.32)");
      fg.addColorStop(0.7, "rgba(196,170,120,0.10)");
      fg.addColorStop(1, "rgba(196,170,120,0)");
      ctx.fillStyle = fg;
      ctx.fillRect(0, floorY, w, h - floorY);
    }

    // drifting specks
    ctx.fillStyle = "rgba(190,235,224,0.16)";
    for (var k = 0; k < waterSpecks.length; k++) {
      var sp = waterSpecks[k];
      var sy = ((sp.y + t * 0.00002 * sp.v) % 1) * h;
      var sx = (sp.x * w + Math.sin(t * 0.0005 + sp.p) * 8) % w;
      if (sx < 0) sx += w;
      ctx.beginPath();
      ctx.arc(sx, sy, sp.r, 0, 6.2832);
      ctx.fill();
    }
  }

  /* ---------- grid ---------- */
  function drawGrid(t) {
    var s = lastSnap;
    var cell = layout.cell;
    var ended = s.phase === "ended";
    for (var y = 0; y < layout.rows; y++) {
      for (var x = 0; x < layout.cols; x++) {
        var c = s.rows[y][x];
        var ctr = cellCenter(x, y);
        var pop = getPopScale(x, y, t);
        drawCell(c, x, y, ctr.x, ctr.y, cell, pop, t, ended);
      }
    }
    if (ended && s.stungAt) {
      var fc = cellCenter(s.stungAt.x, s.stungAt.y);
      var pulse = 0.5 + 0.5 * Math.sin(t * 0.005);
      ctx.strokeStyle = "rgba(255,90,90," + (0.3 + 0.45 * pulse) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, layout.cell * 0.6, 0, 6.2832);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,220,220," + (0.25 * pulse) + ")";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(fc.x, fc.y, layout.cell * 0.74, 0, 6.2832);
      ctx.stroke();
    }
  }
  function getPopScale(x, y, t) {
    var key = cellKey(x, y);
    if (!(key in popTimes)) return 1;
    var age = t - popTimes[key];
    if (age < 0) return 0.9;
    if (age > POP_DUR) return 1;
    var k = age / POP_DUR;
    return 0.9 + 0.1 * easeOutBack(k);
  }
  function cellGlow(x, y, t) {
    var key = cellKey(x, y);
    if (!(key in popTimes)) return 0;
    var age = t - popTimes[key];
    if (age < 0 || age > 400) return 0;
    return 1 - age / 400;
  }

  function drawCell(c, x, y, cx, cy, cell, pop, t, ended) {
    ctx.save();
    ctx.translate(cx, cy);
    var bob = Math.sin(t * 0.0016 + shellPhase(x, y) * 6.28) * cell * 0.012;
    ctx.translate(0, bob);
    var scale = pop;
    ctx.scale(scale, scale);
    var half = cell * 0.5;
    if (c === "#") drawCovered(half);
    else if (c === "F") drawPennanted(half, t);
    else if (c >= "0" && c <= "8") drawOpened(half, parseInt(c, 10), x, y, t);
    else if (c === "*") drawUrchin(half, false, false, t);
    else if (c === "X") drawUrchin(half, true, false, t);
    else if (c === "+") drawPennanted(half, t, true);
    else if (c === "-") drawPennanted(half, t, false, true);
    ctx.restore();
  }

  /* ---------- shell shapes ---------- */
  function roundedRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCovered(half) {
    var r = half * 0.92;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, half * 0.34, r * 0.62, r * 0.2, 0, 0, 6.2832);
    ctx.fill();
    // shell body
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.15);
    g.addColorStop(0, "#fdf6e6");
    g.addColorStop(0.55, "#f0dfb6");
    g.addColorStop(1, "#dcc18a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.92, 0, 0, 6.2832);
    ctx.fill();
    // ridges
    ctx.strokeStyle = "rgba(168,128,70,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (var i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (0.5 + Math.abs(i) * 0.18), r * 0.92, 0, i * 0.22, 0, 6.2832);
      ctx.stroke();
    }
    // rim
    ctx.strokeStyle = "rgba(190,150,95,0.6)";
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.92, 0, 0, 6.2832);
    ctx.stroke();
    // sheen
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 0.42, r * 0.22, r * 0.13, -0.5, 0, 6.2832);
    ctx.fill();
    // tiny hole
    ctx.fillStyle = "rgba(122,88,44,0.35)";
    ctx.beginPath();
    ctx.arc(r * 0.1, r * 0.28, r * 0.07, 0, 6.2832);
    ctx.fill();
  }

  function drawPennanted(half, t, correct, wrong) {
    drawCovered(half);
    var r = half * 0.92;
    // pennant stick
    ctx.strokeStyle = "#6b4a2b";
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, -r * 0.5);
    ctx.lineTo(-r * 0.18, -r * 1.35);
    ctx.stroke();
    // flag
    var wave = Math.sin(t * 0.008 + cellPhaseFlag) * r * 0.06;
    var baseX = -r * 0.18, baseY = -r * 1.35;
    ctx.fillStyle = correct ? "#7fd8c8" : (wrong ? "#ff8a7a" : "#ff9d7a");
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX + r * 0.62 + wave, baseY - r * 0.26);
    ctx.lineTo(baseX + r * 0.05, baseY - r * 0.5);
    ctx.closePath();
    ctx.fill();
    if (correct) {
      // small check
      ctx.strokeStyle = "#0b2a36";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseX + r * 0.14, baseY - r * 0.34);
      ctx.lineTo(baseX + r * 0.28, baseY - r * 0.2);
      ctx.lineTo(baseX + r * 0.46, baseY - r * 0.44);
      ctx.stroke();
    }
    if (wrong) {
      // red slash
      ctx.strokeStyle = "rgba(160,20,20,0.9)";
      ctx.lineWidth = Math.max(2, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(baseX - r * 0.14, baseY - r * 0.6);
      ctx.lineTo(baseX + r * 0.56, baseY - r * 0.04);
      ctx.stroke();
    }
  }
  var cellPhaseFlag = 0;

  function drawOpened(half, num, x, y, t) {
    var r = half * 0.92;
    var glow = cellGlow(x, y, t);
    // open shell halves
    ctx.save();
    ctx.rotate(-0.28);
    ctx.fillStyle = "#e8d2a2";
    ctx.beginPath();
    ctx.ellipse(-r * 0.9, 0, r * 0.5, r * 0.7, 0, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,120,70,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(0.28);
    ctx.fillStyle = "#e8d2a2";
    ctx.beginPath();
    ctx.ellipse(r * 0.9, 0, r * 0.5, r * 0.7, 0, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,120,70,0.5)";
    ctx.stroke();
    ctx.restore();

    // inner pool
    var innerR = r * 0.78;
    var g = ctx.createRadialGradient(0, 0, innerR * 0.2, 0, 0, innerR);
    g.addColorStop(0, "#124d61");
    g.addColorStop(1, "#0b3244");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = "rgba(127,216,200,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.stroke();

    if (glow > 0) {
      ctx.fillStyle = "rgba(190,240,225," + (glow * 0.5) + ")";
      ctx.beginPath();
      ctx.arc(0, 0, innerR, 0, 6.2832);
      ctx.fill();
    }

    // number
    if (num === 0) {
      ctx.strokeStyle = "rgba(127,216,200,0.55)";
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath();
      ctx.arc(0, 0, innerR * 0.28, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, innerR * 0.42, 0, 6.2832);
      ctx.stroke();
    } else {
      ctx.fillStyle = NUM_COLORS[num];
      ctx.font = "800 " + Math.round(half * 1.05) + "px ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = NUM_COLORS[num];
      ctx.shadowBlur = half * 0.22;
      ctx.fillText(String(num), 0, half * 0.04);
      ctx.shadowBlur = 0;
    }
  }

  function drawUrchin(half, fatal, t) {
    var r = half * 0.72;
    ctx.save();
    // spikes
    var spikes = 11;
    for (var i = 0; i < spikes; i++) {
      var a = (i / spikes) * 6.2832 + 0.3;
      var len = r * (0.55 + 0.12 * Math.sin(t * 0.004 + i * 2.3));
      ctx.strokeStyle = "#6d4a9e";
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
      ctx.lineTo(Math.cos(a) * (r * 0.55 + len), Math.sin(a) * (r * 0.55 + len));
      ctx.stroke();
    }
    // body
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#5a3a85");
    g.addColorStop(0.6, "#3d2460");
    g.addColorStop(1, "#241239");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, 6.2832);
    ctx.fill();
    // sleeping eyes
    ctx.strokeStyle = "#c9b3e6";
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(-r * 0.2, -r * 0.08, r * 0.1, 0.15, 3.14 - 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 0.2, -r * 0.08, r * 0.1, 0.15, 3.14 - 0.15);
    ctx.stroke();
    if (fatal) {
      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = Math.max(2, r * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.0, 0, 6.2832);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.42); ctx.lineTo(r * 0.28, -r * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.72); ctx.lineTo(r * 0.28, -r * 0.42);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- effects ---------- */
  function drawEffects(t) {
    for (var i = effects.length - 1; i >= 0; i--) {
      var e = effects[i];
      var age = t - e.t0;
      if (age > e.dur) { effects.splice(i, 1); continue; }
      var k = clamp(age / e.dur, 0, 1);
      if (e.kind === "ripple") {
        var c = cellCenter(e.x, e.y);
        var rad = easeOut(k) * e.maxR;
        ctx.strokeStyle = hexA(e.color, (1 - k) * 0.5);
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad, 0, 6.2832);
        ctx.stroke();
        ctx.strokeStyle = hexA("#ffffff", (1 - k) * 0.18);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, rad * 0.8, 0, 6.2832);
        ctx.stroke();
      } else if (e.kind === "sweepFlash") {
        var c2 = cellCenter(e.x, e.y);
        ctx.fillStyle = hexA(e.color, (1 - k) * 0.25);
        ctx.beginPath();
        ctx.arc(c2.x, c2.y, e.r * (0.5 + 0.5 * k), 0, 6.2832);
        ctx.fill();
      } else if (e.kind === "pennant") {
        var c3 = cellCenter(e.x, e.y);
        var pk = k < 0.25 ? easeOutBack(k / 0.25) : 1;
        ctx.strokeStyle = hexA("#ffeebc", (1 - k) * 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c3.x, c3.y, layout.cell * 0.42 * pk, 0, 6.2832);
        ctx.stroke();
      } else if (e.kind === "clear") {
        // rising bubbles
        for (var b = 0; b < 5; b++) {
          var bp = ((k * 1.6 + b * 0.2) % 1);
          var bx = layout.ox + (0.12 + 0.76 * ((b * 0.37) % 1)) * layout.cols * layout.cell;
          var by = layout.oy + layout.rows * layout.cell - bp * (layout.rows * layout.cell);
          ctx.fillStyle = "rgba(190,240,225," + (0.35 * (1 - bp)) + ")";
          ctx.beginPath();
          ctx.arc(bx, by, 2 + b * 0.8, 0, 6.2832);
          ctx.fill();
        }
        ctx.fillStyle = hexA("#ffeebc", 0.5 * (1 - k));
        ctx.font = "800 20px ui-rounded, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("the tide carries on", stageEl.clientWidth / 2, layout.oy + layout.rows * layout.cell + 26);
      } else if (e.kind === "sting") {
        // red shock ring on the fatal shell
        var c4 = cellCenter(e.x, e.y);
        var rad2 = 6 + k * layout.cell * 1.6;
        ctx.strokeStyle = hexA("#ff5a5a", (1 - k) * 0.8);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c4.x, c4.y, rad2, 0, 6.2832);
        ctx.stroke();
      }
    }
  }
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  /* ---------- hold progress ring ---------- */
  function drawHoldRing(t) {
    if (!held || held.cancelled || held.toggled) return;
    var p = clamp((t - held.t0) / HOLD_MS, 0, 1);
    if (p <= 0) return;
    var c = cellCenter(held.cx, held.cy);
    ctx.strokeStyle = "rgba(255,238,188," + (0.35 + 0.4 * p) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, layout.cell * 0.4, -1.5708, -1.5708 + p * 6.2832);
    ctx.stroke();
  }

  /* ==========================================================================
     HOST CREATURE — "Pip", a little hermit crab.
     ========================================================================== */
  function drawHost(t) {
    var s = lastSnap;
    var y = stageEl.clientHeight - 26;
    var x = layout.ox + layout.cols * layout.cell * 0.5;
    var cell = layout.cell;
    var scale = cell > 44 ? 1 : (cell / 44);
    if (scale < 0.6) scale = 0.6;

    // host state -> params
    var params = hostParams(t);
    ctx.save();
    ctx.translate(x, y + params.droop * 6);
    ctx.scale(scale, scale);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 8, 26, 7, 0, 0, 6.2832);
    ctx.fill();

    // legs
    ctx.strokeStyle = "#c97b4a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (var i = -2; i <= 2; i++) {
      if (i === 0) continue;
      var lx = i * 8 + params.sway * 2 * i;
      ctx.beginPath();
      ctx.moveTo(lx, 2);
      ctx.lineTo(lx - 5 * Math.sign(i), 12 + Math.sin(t * 0.006 + i) * 2 * params.step);
      ctx.stroke();
    }
    // body
    var bg = ctx.createLinearGradient(0, -14, 0, 8);
    bg.addColorStop(0, "#f2a679");
    bg.addColorStop(1, "#d97a4a");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, -4 + params.puff * 2, 20, 13, 0, 0, 6.2832);
    ctx.fill();
    // shell on back (spiral)
    ctx.fillStyle = "#7a4a2b";
    ctx.beginPath();
    ctx.arc(6, -12, 11, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = "#5a3118";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(6, -12, 7, 0, 6.2832);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(6, -12, 4, 0, 6.2832);
    ctx.stroke();
    // claws
    ctx.fillStyle = "#e08a55";
    ctx.beginPath();
    ctx.arc(-16, 4, 5, 0, 6.2832);
    ctx.arc(16, 4, 5, 0, 6.2832);
    ctx.fill();
    // eye stalks
    var stalkTilt = params.look * 0.25 + params.sway * 0.1;
    ctx.strokeStyle = "#d97a4a";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.lineTo(-9 + stalkTilt * 5, -22 - params.stretch);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, -12);
    ctx.lineTo(9 + stalkTilt * 5, -22 - params.stretch);
    ctx.stroke();
    // eyes
    var blink = params.blink;
    for (var e = -1; e <= 1; e += 2) {
      var ex = e * 9 + stalkTilt * 5, ey = -24 - params.stretch;
      ctx.fillStyle = "#fff8ec";
      ctx.beginPath();
      ctx.arc(ex, ey, 4.6, 0, 6.2832);
      ctx.fill();
      if (blink > 0.5) {
        ctx.strokeStyle = "#7a4a2b";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ex - 3.4, ey);
        ctx.lineTo(ex + 3.4, ey);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#3a2410";
        ctx.beginPath();
        ctx.arc(ex + params.pupil, ey + 0.6, 2, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex + params.pupil - 0.6, ey - 0.2, 0.8, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function hostParams(t) {
    var s = lastSnap;
    var since = (t - host.stateT) / 1000;
    var p = { sway: 0, step: 0, puff: 0, stretch: 0, droop: 0, look: 0, blink: 0, pupil: 0 };
    p.sway = Math.sin(t * 0.0011) * 0.5;
    p.step = 0.5;
    p.pupil = Math.sin(t * 0.0014) * 0.8;
    // blink occasionally
    if ((t % 3600) < 140) p.blink = 1;

    switch (host.state) {
      case "ripple":
        p.stretch = 3 * Math.exp(-since * 1.4);
        p.puff = 2 * Math.exp(-since * 1.4);
        p.look = 1;
        break;
      case "curious":
        p.look = 1;
        p.stretch = 1.5 * Math.exp(-since * 1.2);
        break;
      case "proud":
        p.puff = 3 * Math.exp(-since * 1.2) + 1;
        p.stretch = 2;
        p.look = 1;
        break;
      case "stung":
        p.droop = 1 * Math.min(1, since * 2) + (since < 0.5 ? Math.sin(since * 30) * 0.4 : 0);
        p.blink = 0;
        p.stretch = -1.5;
        p.look = 0;
        break;
      default:
        break;
    }
    // tension: few shells remain -> holding breath
    var covered = 0;
    if (s.phase === "playing") {
      for (var i = 0; i < s.rows.length; i++) {
        for (var j = 0; j < s.rows[i].length; j++) {
          var c = s.rows[i][j];
          if (c === "#" || c === "F") covered++;
        }
      }
      if (covered <= 6 && covered > 0 && s.firstTurnDone) {
        p.stretch = -1;
        p.puff = 0;
        p.step = 0;
        p.look = 0.6;
        p.tense = true;
      }
    }
    if (s.tideFraction < 0.25 && s.phase === "playing") {
      p.step *= 0.4;
      p.look = Math.max(p.look, 0.5);
    }
    return p;
  }

  /* ==========================================================================
     AUDIO — synthesized from one family.
     ========================================================================== */
  var audio = (function () {
    function ensure() {
      if (audioCtx) return audioCtx;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
      } catch (e) { return null; }
      master = audioCtx.createGain();
      master.gain.value = 0.5;
      master.connect(audioCtx.destination);
      startAmbient();
      return audioCtx;
    }
    var master = null;
    function startAmbient() {
      if (!audioCtx || ambientNodes) return;
      var src = audioCtx.createBufferSource();
      var len = audioCtx.sampleRate * 2;
      var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.35;
      }
      src.buffer = buf;
      var filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      var gain = audioCtx.createGain();
      gain.gain.value = 0.05;
      src.loop = true;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      ambientNodes = { src: src };
    }
    function tone(freq, dur, type, vol, when, slide) {
      if (!audioCtx) return;
      var t0 = audioCtx.currentTime + (when || 0);
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol, freq, when) {
      if (!audioCtx) return;
      var t0 = audioCtx.currentTime + (when || 0);
      var len = Math.floor(audioCtx.sampleRate * dur);
      var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      var f = audioCtx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      var g = audioCtx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(master);
      src.start(t0);
    }
    return {
      unlock: function () {
        audioOn = true;
        ensure();
        if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
      },
      tick: function () { tone(520, 0.09, "sine", 0.22); noise(0.05, 0.08, 2400); },
      ripple: function (n) {
        var base = 320;
        for (var i = 0; i < Math.min(n, 10); i++) {
          tone(base * Math.pow(1.11, i), 0.12, "sine", 0.14, i * 0.035, base * Math.pow(1.11, i) * 1.4);
        }
      },
      pennant: function (plant) {
        if (plant) { tone(760, 0.07, "square", 0.12); noise(0.04, 0.1, 3200); }
        else { tone(430, 0.08, "triangle", 0.14); }
      },
      sweep: function () { noise(0.22, 0.16, 1400, 0); tone(900, 0.14, "triangle", 0.12, 0, 1300); },
      deny: function () { tone(150, 0.08, "sawtooth", 0.06); },
      hush: function () { tone(220, 0.9, "sine", 0.06, 0, 180); },
      sting: function () {
        tone(220, 0.5, "sawtooth", 0.3, 0, 60);
        tone(150, 0.6, "square", 0.18, 0.05, 50);
        noise(0.4, 0.3, 300);
      },
      clear: function () {
        var seq = [392, 494, 587, 784];
        for (var i = 0; i < seq.length; i++) tone(seq[i], 0.16, "sine", 0.16, i * 0.09);
      },
      rank: function () { var seq = [523, 659, 784, 1047]; for (var i = 0; i < seq.length; i++) tone(seq[i], 0.2, "triangle", 0.14, i * 0.11); }
    };
  })();

  /* ==========================================================================
     INPUT
     ========================================================================== */
  function beginGesture(px, py, cx, cy) {
    var cell = cellFromPoint(px, py);
    if (!cell) return;
    var c = lastSnap.rows[cell.y][cell.x];
    if (c === "F") {
      held = { cx: cell.x, cy: cell.y, t0: nowMs(), x0: px, y0: py, toggled: false, cancelled: false, isFlag: true };
      return;
    }
    if (c >= "0" && c <= "8") {
      perform({ type: "sweep", x: cell.x, y: cell.y });
      return;
    }
    if (c === "#") {
      held = { cx: cell.x, cy: cell.y, t0: nowMs(), x0: px, y0: py, toggled: false, cancelled: false, isFlag: false };
    }
  }
  function moveGesture(px, py) {
    if (!held || held.cancelled) return;
    if (Math.abs(px - held.x0) > DRAG_CANCEL || Math.abs(py - held.y0) > DRAG_CANCEL) {
      held.cancelled = true;
    }
  }
  function endGesture() {
    if (!held) return;
    var h = held;
    held = null;
    if (h.cancelled) return;
    var now = nowMs();
    if (h.toggled) return;
    var c = lastSnap.rows[h.cy][h.cx];
    if ((now - h.t0) < HOLD_MS && !h.isFlag) {
      // a tap turns
      perform({ type: "open", x: h.cx, y: h.cy });
    } else if (h.isFlag && (now - h.t0) >= HOLD_MS) {
      perform({ type: "unflag", x: h.cx, y: h.cy });
    }
  }
  function togglePennant(cell) {
    if (!cell) return;
    var c = lastSnap.rows[cell.y][cell.x];
    if (c === "#") perform({ type: "flag", x: cell.x, y: cell.y });
    else if (c === "F") perform({ type: "unflag", x: cell.x, y: cell.y });
  }
  // hold detection inside the frame loop
  function checkHold(t) {
    if (!held || held.cancelled || held.toggled) return;
    if (t - held.t0 >= HOLD_MS) {
      held.toggled = true;
      togglePennant({ x: held.cx, y: held.cy });
      audio.unlock();
    }
  }

  var pointers = new Map();
  var primary = null;

  canvas.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return; // left button / touch only
    audio.unlock();
    e.preventDefault();
    if (primary !== null) return; // single-thumb game
    primary = e.pointerId;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture(e.clientX, e.clientY, 0, 0);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (e.pointerId !== primary) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moveGesture(e.clientX, e.clientY);
  });
  function finishPointer(e) {
    if (e.pointerId !== primary) return;
    pointers.delete(e.pointerId);
    primary = null;
    endGesture();
  }
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", function (e) {
    if (e.pointerId !== primary) return;
    pointers.delete(e.pointerId);
    primary = null;
    held = null;
  });
  canvas.addEventListener("pointerleave", function (e) {
    if (e.pointerId === primary && e.buttons === 0) finishPointer(e);
  });

  // right-click pennant (browser menu suppressed on the board)
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    audio.unlock();
    var cell = cellFromPoint(e.clientX, e.clientY);
    togglePennant(cell);
  });

  // keyboard: R restarts at any moment
  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      audio.unlock();
      restartGame();
    }
  });

  // ceremony tap restarts
  ceremonyEl.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    audio.unlock();
    audio.rank();
    restartGame();
  });

  function restartGame() {
    hideCeremony();
    pendingCeremony = null;
    game.restart();
    popTimes = Object.create(null);
    effects = [];
    shake = 0;
    stingFlash = 0;
    hostReact("idle");
    lastSnap = game.snapshot();
    computeLayout();
    render();
  }

  /* ==========================================================================
     MAIN LOOP
     ========================================================================== */
  var lastFrameT = 0;
  function loop(t) {
    var dt = lastFrameT ? t - lastFrameT : 16;
    lastFrameT = t;
    if (dt > 250) dt = 250;
    // live simulation clock
    game.stepWall(dt);
    lastSnap = game.snapshot();
    updateHud();
    checkHold(t);
    if (pendingCeremony && t >= pendingCeremony.at) {
      showCeremony(pendingCeremony.snap);
      pendingCeremony = null;
    }
    // decay shake / flash
    shake *= 0.88;
    if (shake < 0.1) shake = 0;
    stingFlash *= 0.9;
    if (stingFlash < 0.01) stingFlash = 0;
    render();
    requestAnimationFrame(loop);
  }

  /* ==========================================================================
     RUNTIME INTERFACE
     ========================================================================== */
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      var s = game.reset(seed);
      afterHardReset();
      return s;
    },
    snapshot: function () { return game.snapshot(); },
    act: function (action) {
      var r = perform(action);
      return r.state;
    },
    restart: function () {
      var s = game.restart();
      afterHardReset();
      return s;
    },
    advance: function (ms) { game.advance(ms); }
  };

  function afterHardReset() {
    popTimes = Object.create(null);
    effects = [];
    shake = 0;
    stingFlash = 0;
    pendingCeremony = null;
    hideCeremony();
    hostReact("idle");
    lastSnap = game.snapshot();
    computeLayout();
    render();
  }

  /* ==========================================================================
     ARENA BRIDGE (arena.game.v1)
     ========================================================================== */
  var bridgePort = null, bridgeSession = null, bridgeGen = null;

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.protocol !== "arena.game.v1" || d.type !== "connect") return;
    if (typeof d.sessionId !== "string" || !Number.isInteger(d.generation)) return;
    var port = e.ports && e.ports[0];
    if (!port) return;
    bridgePort = port;
    bridgeSession = d.sessionId;
    bridgeGen = d.generation;
    port.onmessage = onPortMessage;
    port.postMessage({
      protocol: "arena.game.v1",
      type: "ready",
      sessionId: bridgeSession,
      generation: bridgeGen,
      accepted: true,
      revision: game.revision,
      state: game.visibleState()
    });
  });

  function onPortMessage(e) {
    var d = e.data;
    if (!d || d.protocol !== "arena.game.v1") return;
    if (d.sessionId !== bridgeSession || d.generation !== bridgeGen) return;
    if (d.type !== "request") return;
    var requestId = d.requestId;
    var respond = function (accepted, state, error) {
      var msg = {
        protocol: "arena.game.v1",
        type: "response",
        requestId: requestId,
        sessionId: bridgeSession,
        generation: bridgeGen,
        accepted: accepted,
        revision: state.revision,
        state: state
      };
      if (error) msg.error = error;
      bridgePort.postMessage(msg);
    };
    switch (d.command) {
      case "observe":
        respond(true, game.visibleState(), null);
        break;
      case "act": {
        if (!Number.isInteger(d.expectedRevision) || d.expectedRevision !== game.revision) {
          respond(false, game.visibleState(), { code: "stale_revision", message: "stale revision: expected " + game.revision });
          break;
        }
        var res = perform(d.action);
        if (res.ok) {
          render(); // render the visible board before reporting the mutation
          respond(true, res.state, null);
        } else {
          respond(false, game.visibleState(), res.error);
        }
        break;
      }
      case "restart": {
        if (!Number.isInteger(d.expectedRevision) || d.expectedRevision !== game.revision) {
          respond(false, game.visibleState(), { code: "stale_revision", message: "stale revision: expected " + game.revision });
          break;
        }
        var s = game.restart();
        afterHardReset();
        render();
        respond(true, s, null);
        break;
      }
      default:
        respond(false, game.visibleState(), { code: "bad_command", message: "unknown command" });
    }
  }

  /* ---------------- boot ---------------- */
  resize();
  computeLayout();
  render();
  requestAnimationFrame(loop);
})();