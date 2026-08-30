/**
 * STOMP — presentation, input, audio, and arena harness.
 */
(function () {
  "use strict";

  const Sim = window.STOMP_SIM;
  const B = Sim.BOUNDS;
  const canvas = document.getElementById("game");
  const stage = document.getElementById("stage");
  const wrap = document.getElementById("wrap");
  const padMove = document.getElementById("pad-move");
  const padJump = document.getElementById("pad-jump");
  const endEl = document.getElementById("end");
  const ctx = canvas.getContext("2d");

  let state = Sim.create(1);
  let sessionBest = 0;
  let lastFrame = 0;
  let dpr = 1;
  let cssW = 360;
  let cssH = 640;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let endArmed = false;
  let endTimer = 0;
  let lastSeq = 0;
  let jumpLatch = false;

  const fx = {
    t: 0,
    shake: 0,
    hitFlash: 0,
    dropFlash: 0,
    tight: 0,
    land: 0,
    jump: 0,
    ballSquash: 1,
    ballStretch: 1,
    machineSquash: 1,
    face: "rest",
    faceT: 0,
    particles: [],
    pops: [],
    sparks: [],
    motes: [],
    burst: 0,
    clockPop: 0,
    padJumpPress: 0,
  };

  const ui = {
    moveId: null,
    jumpId: null,
    originX: 0,
    originY: 0,
    curX: 0,
    curY: 0,
    axis: 0,
    keysLeft: false,
    keysRight: false,
  };

  function loadBest() {
    try {
      const n = parseInt(sessionStorage.getItem("stomp.sessionBest") || "0", 10);
      if (n > 0) sessionBest = n;
    } catch (e) {}
  }

  function saveBest() {
    try {
      sessionStorage.setItem("stomp.sessionBest", String(sessionBest));
    } catch (e) {}
  }

  loadBest();

  /* ---------- audio ---------- */
  let actx = null;
  let master = null;
  let unlocked = false;

  function ensureAudio() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = actx || new AC();
      if (!master) {
        master = actx.createGain();
        master.gain.value = 0.22;
        master.connect(actx.destination);
      }
      if (actx.state === "suspended") actx.resume();
      unlocked = actx.state === "running";
    } catch (e) {}
  }

  function tone(freq, dur, type, gain, slide) {
    if (!actx || !master) return;
    const t0 = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    const f = actx.createBiquadFilter();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
    f.type = "lowpass";
    f.frequency.value = 2200;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur, gain, freq) {
    if (!actx || !master) return;
    const n = actx.createBuffer(1, Math.max(1, (actx.sampleRate * dur) | 0), actx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = actx.createBufferSource();
    src.buffer = n;
    const f = actx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq || 800;
    const g = actx.createGain();
    const t0 = actx.currentTime;
    g.gain.setValueAtTime(gain || 0.15, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
  }

  function sfx(kind) {
    if (!unlocked) return;
    switch (kind) {
      case "weak":
        tone(220, 0.12, "sine", 0.18, 160);
        break;
      case "normal":
        tone(320, 0.14, "triangle", 0.24, 240);
        noiseBurst(0.05, 0.08, 600);
        break;
      case "power":
        tone(420, 0.18, "triangle", 0.28, 280);
        tone(640, 0.1, "sine", 0.12, 400);
        break;
      case "jump":
        tone(180, 0.08, "square", 0.08, 280);
        break;
      case "land":
        noiseBurst(0.06, 0.1, 220);
        break;
      case "top":
        tone(520, 0.09, "square", 0.16);
        tone(780, 0.12, "sine", 0.1, 520);
        break;
      case "kill":
        tone(392, 0.1, "triangle", 0.2);
        tone(523, 0.14, "triangle", 0.16);
        tone(784, 0.22, "sine", 0.12, 520);
        noiseBurst(0.18, 0.16, 900);
        break;
      case "wrong":
        tone(110, 0.18, "sawtooth", 0.14, 70);
        break;
      case "drop":
        tone(240, 0.28, "sine", 0.16, 70);
        break;
      case "stomp":
        noiseBurst(0.1, 0.18, 140);
        tone(90, 0.12, "square", 0.1);
        break;
      default:
        break;
    }
  }

  /* ---------- layout ---------- */
  function layout() {
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    wrap.style.width = vw + "px";
    wrap.style.height = vh + "px";
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
    if (vv) {
      wrap.style.left = vv.offsetLeft + "px";
      wrap.style.top = vv.offsetTop + "px";
    }
    let w;
    let h;
    if (vw <= vh) {
      w = vw;
      h = vh;
    } else {
      h = vh;
      w = Math.min(vw, h * (9 / 16));
    }
    stage.style.width = Math.floor(w) + "px";
    stage.style.height = Math.floor(h) + "px";
    cssW = Math.floor(w);
    cssH = Math.floor(h);
    dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    if (cssW / Math.max(1, cssH) <= 9 / 16 + 0.01) {
      scale = cssW / B.WORLD_W;
      const worldH = B.WORLD_H * scale;
      const extra = cssH - worldH;
      if (extra >= 0) {
        ox = 0;
        oy = extra * 0.36;
      } else {
        scale = cssH / B.WORLD_H;
        ox = (cssW - B.WORLD_W * scale) / 2;
        oy = 0;
      }
    } else {
      scale = Math.min(cssW / B.WORLD_W, cssH / B.WORLD_H);
      ox = (cssW - B.WORLD_W * scale) / 2;
      oy = (cssH - B.WORLD_H * scale) / 2;
    }
    const pads = document.getElementById("pads");
    const padTop = sy(112);
    const padH = Math.max(72, cssH - padTop);
    pads.style.height = padH + "px";
  }

  layout();
  window.addEventListener("resize", layout);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", layout);
    window.visualViewport.addEventListener("scroll", layout);
  }

  function sx(x) {
    return ox + x * scale;
  }
  function sy(y) {
    return oy + (B.WORLD_H - y) * scale;
  }
  function s(n) {
    return n * scale;
  }

  /* ---------- particles (view only) ---------- */
  function addP(x, y, vx, vy, life, color, size, grav) {
    if (fx.particles.length > 140) fx.particles.shift();
    fx.particles.push({ x, y, vx, vy, life, max: life, color, size, grav: grav || 0 });
  }

  function burst(x, y, n, color, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * (spd || 80);
      addP(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.35 + Math.random() * 0.4, color, 1.4 + Math.random() * 2.2, -40);
    }
  }

  function addPop(x, y, text, color) {
    fx.pops.push({ x, y, text, color, t: 0 });
  }

  function consumeEvents() {
    const evs = state.recentEvents;
    if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.sequence <= lastSeq) continue;
      lastSeq = ev.sequence;
      onEvent(ev);
    }
  }

  function face(name, t) {
    fx.face = name;
    fx.faceT = t;
  }

  function onEvent(ev) {
    const m = state.machine;
    const b = state.ball;
    switch (ev.kind) {
      case "ball_bounce_weak":
        fx.ballSquash = 0.62;
        fx.machineSquash = 0.88;
        sfx("weak");
        burst(b.x, b.y - b.radius, 6, "#e7c27a", 50);
        break;
      case "ball_bounce_normal":
        fx.ballSquash = 0.52;
        fx.machineSquash = 0.8;
        face("wound", 0.18);
        sfx("normal");
        burst(b.x, b.y - 8, 10, "#ffe7b0", 70);
        break;
      case "ball_bounce_power":
        fx.ballStretch = 1.45;
        fx.ballSquash = 0.7;
        face("stretch", 0.45);
        sfx("power");
        burst(b.x, b.y, 14, "#fff6d8", 90);
        fx.shake = Math.max(fx.shake, 0.35);
        break;
      case "machine_jump":
        fx.jump = 1;
        fx.machineSquash = 1.18;
        sfx("jump");
        break;
      case "machine_land":
        fx.land = 1;
        fx.machineSquash = 0.72;
        sfx("land");
        burst(m.x, B.GROUND_Y + 4, 8, "#c4a06a", 40);
        break;
      case "top_hit": {
        fx.hitFlash = 1;
        face("lit", 0.35);
        sfx("top");
        fx.shake = Math.max(fx.shake, 0.45);
        fx.clockPop = 1;
        const en = state.enemies.find(function (e) {
          return e.id === ev.enemyId;
        });
        const x = en ? en.x : b.x;
        const y = en ? en.y : b.y;
        burst(x, y + 10, 16, "#fff2c4", 110);
        addPop(x, y + 28, "+" + Math.round(ev.amountMs / 1000) + "s", "#ffe7b0");
        fx.ballSquash = 0.7;
        break;
      }
      case "enemy_defeated":
        if (ev.source === "ball") {
          fx.burst = 1.2;
          face("lit", 0.55);
          sfx("kill");
          fx.shake = 0.85;
          const en = state.enemies.find(function (e) {
            return e.id === ev.enemyId;
          });
          if (en) burst(en.x, en.y, 28, "#ffd38a", 160);
        }
        break;
      case "wrong_side_hit":
        face("dismay", 0.5);
        sfx("wrong");
        fx.shake = 0.55;
        fx.dropFlash = 0.7;
        addPop(b.x, b.y, "ouch", "#ff8a90");
        break;
      case "ball_drop":
        face("deflate", 0.8);
        sfx("drop");
        fx.dropFlash = 1;
        fx.shake = 0.4;
        burst(b.x, B.GROUND_Y + 8, 12, "#c09070", 60);
        break;
      case "ground_stomp":
        sfx("stomp");
        fx.machineSquash = 0.7;
        fx.shake = 0.5;
        burst(m.x, B.GROUND_Y + 6, 14, "#d9a24a", 80);
        break;
      default:
        break;
    }
  }

  /* ---------- input ---------- */
  function syncMoveInput() {
    state.input.left = ui.keysLeft;
    state.input.right = ui.keysRight;
    state.input.axis = ui.moveId != null ? ui.axis : 0;
  }

  function pointerPos(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setAxisFrom(px) {
    const r = padMove.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const origin = ui.originX;
    const range = Math.max(42, r.width * 0.38);
    ui.axis = Math.max(-1, Math.min(1, (px + sr.left - origin) / range));
    if (Math.abs(ui.axis) < 0.08) ui.axis = 0;
    syncMoveInput();
  }

  function onMoveDown(e) {
    e.preventDefault();
    ensureAudio();
    if (ui.moveId != null) return;
    ui.moveId = e.pointerId;
    ui.originX = e.clientX;
    ui.originY = e.clientY;
    ui.curX = e.clientX;
    ui.curY = e.clientY;
    try {
      padMove.setPointerCapture(e.pointerId);
    } catch (err) {}
    setAxisFrom(pointerPos(e).x);
  }

  function onMoveMove(e) {
    if (e.pointerId !== ui.moveId) return;
    e.preventDefault();
    ui.curX = e.clientX;
    ui.curY = e.clientY;
    setAxisFrom(pointerPos(e).x);
  }

  function onMoveUp(e) {
    if (e.pointerId !== ui.moveId) return;
    ui.moveId = null;
    ui.axis = 0;
    syncMoveInput();
  }

  function onJumpDown(e) {
    e.preventDefault();
    ensureAudio();
    if (ui.jumpId != null) return;
    ui.jumpId = e.pointerId;
    fx.padJumpPress = 1;
    try {
      padJump.setPointerCapture(e.pointerId);
    } catch (err) {}
    if (state.phase === "ended" && endArmed) {
      restart();
      return;
    }
    Sim.queueJump(state);
    syncMoveInput();
  }

  function onJumpUp(e) {
    if (e.pointerId !== ui.jumpId) return;
    ui.jumpId = null;
    Sim.releaseJump(state);
  }

  padMove.addEventListener("pointerdown", onMoveDown);
  padMove.addEventListener("pointermove", onMoveMove);
  padMove.addEventListener("pointerup", onMoveUp);
  padMove.addEventListener("pointercancel", onMoveUp);
  padJump.addEventListener("pointerdown", onJumpDown);
  padJump.addEventListener("pointerup", onJumpUp);
  padJump.addEventListener("pointercancel", onJumpUp);

  window.addEventListener("keydown", function (e) {
    if (e.repeat) {
      if (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "Space") e.preventDefault();
      return;
    }
    ensureAudio();
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      ui.keysLeft = true;
      syncMoveInput();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      ui.keysRight = true;
      syncMoveInput();
    } else if (e.code === "Space") {
      e.preventDefault();
      if (state.phase === "ended" && endArmed) {
        restart();
        return;
      }
      Sim.queueJump(state);
    } else if (e.code === "KeyR") {
      e.preventDefault();
      restart();
    }
  });

  window.addEventListener("keyup", function (e) {
    if (e.code === "ArrowLeft") {
      ui.keysLeft = false;
      syncMoveInput();
    } else if (e.code === "ArrowRight") {
      ui.keysRight = false;
      syncMoveInput();
    } else if (e.code === "Space") {
      Sim.releaseJump(state);
    }
  });

  endEl.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    ensureAudio();
    if (state.phase === "ended" && endArmed) restart();
  });

  document.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
    },
    { passive: false }
  );
  stage.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  /* ---------- reset / arena ---------- */
  function hardReset(seed) {
    const s = seed == null ? state.seed : seed;
    state = Sim.create(s);
    lastSeq = 0;
    endArmed = false;
    endTimer = 0;
    jumpLatch = false;
    fx.particles.length = 0;
    fx.pops.length = 0;
    fx.face = "rest";
    fx.faceT = 0;
    fx.shake = 0;
    fx.burst = 0;
    fx.hitFlash = 0;
    fx.dropFlash = 0;
    endEl.classList.remove("show");
    syncMoveInput();
  }

  function restart() {
    hardReset(state.seed);
  }

  function updateSessionEnd() {
    if (state.score > sessionBest) {
      sessionBest = state.score;
      saveBest();
    }
    document.getElementById("end-rank").textContent = state.rank;
    document.getElementById("end-score").textContent = String(state.score);
    document.getElementById("end-best").textContent = String(sessionBest);
    document.getElementById("end-air").textContent = String(state.airEnemiesDefeated);
    document.getElementById("end-pursuit").textContent = String(state.longestPursuit);
    document.getElementById("end-streak").textContent = String(state.longestCleanSequence);
  }

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      hardReset(seed);
    },
    snapshot: function () {
      return Sim.snapshot(state);
    },
    advance: function (ms) {
      Sim.advance(state, ms);
      consumeEvents();
      if (state.phase === "ended") {
        updateSessionEnd();
      }
    },
  };

  /* ---------- drawing helpers ---------- */
  function roundRect(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawMotes(c, t) {
    if (!fx.motes.length) {
      for (let i = 0; i < 28; i++) {
        fx.motes.push({
          x: Math.random() * B.WORLD_W,
          y: 140 + Math.random() * 460,
          r: 0.6 + Math.random() * 1.4,
          s: 4 + Math.random() * 10,
          p: Math.random() * 6,
        });
      }
    }
    c.save();
    for (let i = 0; i < fx.motes.length; i++) {
      const m = fx.motes[i];
      const x = (m.x + Math.sin(t * 0.4 + m.p) * 8 + B.WORLD_W) % B.WORLD_W;
      const y = m.y + Math.cos(t * 0.25 + m.p) * 6;
      c.fillStyle = "rgba(255, 236, 200, 0.09)";
      c.beginPath();
      c.arc(sx(x), sy(y), s(m.r), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function drawStage(c, t) {
    const g = c.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, "#1c1630");
    g.addColorStop(0.45, "#14101f");
    g.addColorStop(1, "#0c0a12");
    c.fillStyle = g;
    c.fillRect(0, 0, cssW, cssH);

    c.fillStyle = "rgba(80, 40, 70, 0.18)";
    c.beginPath();
    c.ellipse(sx(180), sy(520), s(220), s(70), 0, 0, Math.PI * 2);
    c.fill();

    c.strokeStyle = "rgba(217, 162, 74, 0.18)";
    c.lineWidth = s(6);
    c.beginPath();
    c.moveTo(sx(18), sy(600));
    c.quadraticCurveTo(sx(30), sy(640), sx(80), sy(640));
    c.moveTo(sx(342), sy(600));
    c.quadraticCurveTo(sx(330), sy(640), sx(280), sy(640));
    c.stroke();

    drawLane(c, B.HIGH_LANE_Y, "#d07090", t, 1);
    drawLane(c, B.LOW_LANE_Y, "#3d9aaa", t, 0);

    const gy = sy(B.GROUND_Y);
    const ground = c.createLinearGradient(0, gy - s(18), 0, cssH);
    ground.addColorStop(0, "#3a2a1c");
    ground.addColorStop(0.12, "#24180f");
    ground.addColorStop(1, "#120e14");
    c.fillStyle = ground;
    c.fillRect(0, gy, cssW, cssH - gy);

    c.fillStyle = "rgba(255, 179, 92, 0.16)";
    c.fillRect(sx(16), gy, sx(328) - sx(16), s(3));
    for (let i = 0; i < 7; i++) {
      const lx = 30 + i * 50;
      const glow = c.createRadialGradient(sx(lx), gy, 2, sx(lx), gy, s(28));
      glow.addColorStop(0, "rgba(255, 190, 100, 0.28)");
      glow.addColorStop(1, "rgba(255, 190, 100, 0)");
      c.fillStyle = glow;
      c.beginPath();
      c.arc(sx(lx), gy, s(28), 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = "rgba(217, 162, 74, 0.08)";
    c.fillRect(sx(10), gy + s(8), sx(340) - sx(10), s(2));
  }

  function drawLane(c, y, color, t, which) {
    const yy = sy(y);
    c.save();
    c.globalAlpha = 0.22 + Math.sin(t * 1.6 + which) * 0.05 + fx.tight * 0.08;
    c.fillStyle = color;
    c.fillRect(0, yy - s(22), cssW, s(44));
    c.globalAlpha = 0.55;
    c.strokeStyle = color;
    c.lineWidth = s(2);
    c.setLineDash([s(10), s(12)]);
    c.lineDashOffset = -(t * 28 + which * 20);
    c.beginPath();
    c.moveTo(0, yy);
    c.lineTo(cssW, yy);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha = 0.35;
    c.beginPath();
    c.moveTo(0, yy - s(16));
    c.lineTo(cssW, yy - s(16));
    c.moveTo(0, yy + s(16));
    c.lineTo(cssW, yy + s(16));
    c.stroke();
    c.restore();
  }

  function drawMachine(c, m, ball, t) {
    const idle = state.phase === "ready";
    const bob = idle ? Math.sin(t * 2.2) * 1.6 : 0;
    const lean = Math.max(-0.18, Math.min(0.18, m.vx / 900));
    let sq = fx.machineSquash;
    sq += (1 - sq) * 0.18;
    fx.machineSquash = sq;
    const x = sx(m.x);
    const y = sy(m.y + bob);
    c.save();
    c.translate(x, y);
    c.rotate(lean);
    c.scale(2 - sq, sq);

    c.fillStyle = "rgba(0,0,0,0.28)";
    c.beginPath();
    c.ellipse(0, s(m.radius + 6), s(20), s(5), 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = "#5a3914";
    roundRect(c, -s(18), s(4), s(36), s(12), s(4));
    c.fill();
    c.fillStyle = "#2a1a0c";
    const tread = ((m.x * 0.35) % 8) - 4;
    for (let i = -2; i <= 2; i++) {
      c.fillRect(-s(14) + s(i * 7 + tread * 0.3), s(7), s(4), s(6));
    }

    const body = c.createLinearGradient(-s(20), -s(18), s(20), s(10));
    body.addColorStop(0, "#f0c36a");
    body.addColorStop(0.45, "#d9a24a");
    body.addColorStop(1, "#8a4e16");
    c.fillStyle = body;
    roundRect(c, -s(20), -s(16), s(40), s(28), s(10));
    c.fill();
    c.strokeStyle = "rgba(80, 40, 12, 0.45)";
    c.lineWidth = s(1.2);
    c.stroke();

    c.fillStyle = "#b8732a";
    c.beginPath();
    c.arc(s(18), 0, s(4.5), 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(s(18), 0);
    c.rotate(t * (idle ? 0.8 : 2.4) + m.x * 0.04);
    c.strokeStyle = "#6a3a10";
    c.lineWidth = s(1.6);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(s(7), 0);
    c.stroke();
    c.restore();

    c.fillStyle = "rgba(255, 244, 220, 0.7)";
    c.fillRect(-s(12), -s(10), s(8), s(2));
    c.fillStyle = "#6a3a12";
    c.beginPath();
    c.arc(-s(8), -s(2), s(1.3), 0, Math.PI * 2);
    c.arc(s(8), -s(2), s(1.3), 0, Math.PI * 2);
    c.fill();

    const visor = c.createLinearGradient(-s(10), -s(10), s(10), 0);
    visor.addColorStop(0, "#163830");
    visor.addColorStop(1, "#0c201c");
    c.fillStyle = visor;
    roundRect(c, -s(12), -s(12), s(24), s(10), s(4));
    c.fill();

    const lookX = Math.max(-3.2, Math.min(3.2, (ball.x - m.x) * 0.08));
    const lookY = Math.max(-2, Math.min(2, (m.y - ball.y) * 0.03));
    let eyeH = 3.2;
    let eyeW = 3.4;
    if (fx.face === "dismay") {
      eyeW = 4.2;
      eyeH = 2.2;
    } else if (fx.face === "deflate") {
      eyeH = 1.6;
    } else if (fx.face === "lit") {
      eyeW = 3.8;
      eyeH = 3.8;
    } else if (fx.face === "wound") {
      eyeH = 2.4;
    } else if (fx.face === "spent") {
      eyeH = 1.2;
    }
    c.fillStyle = fx.face === "lit" ? "#fff4c0" : "#7ef0d0";
    c.beginPath();
    c.ellipse(-s(5) + s(lookX), -s(7) + s(lookY), s(eyeW), s(eyeH), 0, 0, Math.PI * 2);
    c.ellipse(s(5) + s(lookX), -s(7) + s(lookY), s(eyeW), s(eyeH), 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#08221c";
    c.beginPath();
    c.arc(-s(5) + s(lookX), -s(7) + s(lookY), s(1.1), 0, Math.PI * 2);
    c.arc(s(5) + s(lookX), -s(7) + s(lookY), s(1.1), 0, Math.PI * 2);
    c.fill();

    const dish = c.createLinearGradient(-s(18), -s(26), s(18), -s(10));
    dish.addColorStop(0, "#ffe7b0");
    dish.addColorStop(0.5, "#e0b25a");
    dish.addColorStop(1, "#9a5c20");
    c.fillStyle = dish;
    c.beginPath();
    c.ellipse(0, -s(16), s(19), s(6), 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#6a3a12";
    c.beginPath();
    c.ellipse(0, -s(17), s(13), s(3.4), 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255, 230, 170, 0.7)";
    c.lineWidth = s(1.4);
    c.beginPath();
    c.ellipse(0, -s(16), s(19), s(6), 0, 0, Math.PI * 2);
    c.stroke();

    if (fx.face === "dismay" || fx.face === "deflate") {
      c.strokeStyle = "#4a2010";
      c.lineWidth = s(1.2);
      c.beginPath();
      c.arc(0, -s(4), s(4), 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
    }

    c.restore();
  }

  function drawBall(c, b, t) {
    fx.ballSquash += (1 - fx.ballSquash) * 0.2;
    fx.ballStretch += (1 - fx.ballStretch) * 0.12;
    const idle = state.phase === "ready" || b.seated;
    const bob = idle ? Math.sin(t * 2.2) * 1.6 : 0;
    const spd = Math.hypot(b.vx, b.vy);
    const ang = Math.atan2(-b.vy, b.vx);
    const stretch = fx.ballStretch * (1 + Math.min(0.28, spd / 1400));
    const squash = fx.ballSquash;
    const x = sx(b.x);
    const y = sy(b.y + bob);
    c.save();
    if (spd > 80 && state.phase === "playing") {
      c.strokeStyle = "rgba(255, 236, 190, 0.28)";
      c.lineWidth = s(6);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - s(b.vx * 0.05), y + s(b.vy * 0.05));
      c.stroke();
    }
    c.translate(x, y);
    if (spd > 40) c.rotate(ang);
    c.scale(stretch, squash / Math.max(0.72, stretch * 0.55 + 0.45));

    const g = c.createRadialGradient(-s(3), -s(4), s(2), 0, 0, s(b.radius + 2));
    g.addColorStop(0, "#fffdf4");
    g.addColorStop(0.35, "#ffe7b0");
    g.addColorStop(0.8, "#e8b15a");
    g.addColorStop(1, "#c47a30");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, s(b.radius), 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(120, 60, 20, 0.25)";
    c.lineWidth = s(1);
    c.stroke();

    c.fillStyle = "rgba(255,255,255,0.7)";
    c.beginPath();
    c.ellipse(-s(3.2), -s(4), s(3.2), s(2.2), -0.4, 0, Math.PI * 2);
    c.fill();

    let eye = 1.35;
    let brow = 0;
    let mouth = 0.9;
    if (fx.face === "wound") {
      eye = 0.9;
      brow = -1;
    } else if (fx.face === "stretch") {
      eye = 1.1;
      mouth = 1.4;
    } else if (fx.face === "lit") {
      eye = 1.7;
      mouth = 1.5;
    } else if (fx.face === "dismay") {
      eye = 1.8;
      brow = 1.4;
      mouth = -1;
    } else if (fx.face === "deflate") {
      eye = 0.7;
      mouth = -1.2;
    } else if (fx.face === "spent") {
      eye = 0.55;
      mouth = -0.6;
    } else if (state.phase === "ready") {
      eye = 1.2 + Math.sin(t * 2) * 0.08;
    }
    c.fillStyle = "#3a2010";
    c.beginPath();
    c.arc(-s(3.4), -s(1.2) + s(brow * 0.2), s(eye), 0, Math.PI * 2);
    c.arc(s(3.4), -s(1.2) + s(brow * 0.2), s(eye), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255, 170, 150, 0.45)";
    c.beginPath();
    c.ellipse(-s(5.5), s(2.2), s(2.2), s(1.4), 0, 0, Math.PI * 2);
    c.ellipse(s(5.5), s(2.2), s(2.2), s(1.4), 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#5a3018";
    c.lineWidth = s(1.1);
    c.beginPath();
    if (mouth >= 0) c.arc(0, s(2.2), s(2.4 * Math.abs(mouth)), 0.15 * Math.PI, 0.85 * Math.PI);
    else c.arc(0, s(4.4), s(2.2), 1.15 * Math.PI, 1.85 * Math.PI);
    c.stroke();
    c.restore();
  }

  function drawFlyer(c, e, t) {
    const x = sx(e.x);
    const y = sy(e.y);
    const r = s(e.visualRadius);
    const facing = e.vx >= 0 ? 1 : -1;
    const dmg = e.hitsTaken;
    const bob = Math.sin(t * 3 + e.id) * s(2.2);
    const dead = !e.active;
    c.save();
    c.translate(x, y + bob);
    c.scale(facing, 1);
    if (dead) c.globalAlpha = Math.max(0, 1 - (state.tick - e.inactiveTick) / 90);

    const belly = dmg >= 2 ? "#6a2030" : dmg === 1 ? "#3a4a48" : "#1c3a3c";
    const shell = e.type === "fastFlyer" ? "#e8c07a" : "#8ed4cc";
    const top = dmg >= 2 ? "#ff8a78" : dmg === 1 ? "#f0c14a" : "#f4e2b0";

    c.fillStyle = "rgba(0,0,0,0.18)";
    c.beginPath();
    c.ellipse(0, r * 0.9, r * 0.9, r * 0.28, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = belly;
    c.beginPath();
    c.ellipse(0, r * 0.18, r * 0.92, r * 0.7, 0, 0, Math.PI * 2);
    c.fill();

    for (let i = -2; i <= 2; i++) {
      c.strokeStyle = "rgba(10, 20, 22, 0.35)";
      c.lineWidth = s(1);
      c.beginPath();
      c.moveTo(-r * 0.7, r * 0.1 + i * r * 0.12);
      c.quadraticCurveTo(0, r * 0.22 + i * r * 0.12, r * 0.7, r * 0.1 + i * r * 0.12);
      c.stroke();
    }

    c.fillStyle = shell;
    c.beginPath();
    c.ellipse(0, -r * 0.12, r * 0.98, r * 0.62, 0, Math.PI, 0);
    c.fill();

    c.fillStyle = top;
    c.beginPath();
    c.ellipse(0, -r * 0.42, r * 0.86, r * 0.28, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.55)";
    c.lineWidth = s(1.3);
    c.beginPath();
    c.ellipse(0, -r * 0.42, r * 0.86, r * 0.28, 0, 0, Math.PI * 2);
    c.stroke();

    if (dmg >= 1) {
      c.strokeStyle = "rgba(80, 30, 20, 0.7)";
      c.lineWidth = s(1.4);
      c.beginPath();
      c.moveTo(-r * 0.3, -r * 0.5);
      c.lineTo(r * 0.1, -r * 0.2);
      c.lineTo(r * 0.4, -r * 0.45);
      c.stroke();
    }
    if (dmg >= 2) {
      c.fillStyle = "rgba(255, 120, 90, 0.55)";
      c.beginPath();
      c.arc(0, -r * 0.15, r * 0.22, 0, Math.PI * 2);
      c.fill();
    }

    c.fillStyle = "#142428";
    c.beginPath();
    c.ellipse(r * 0.42, -r * 0.05, r * 0.12, r * 0.16, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = dmg >= 2 ? "#ffb0a0" : "#f7f0d8";
    c.beginPath();
    c.arc(r * 0.46, -r * 0.08, r * 0.06, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = e.type === "fastFlyer" ? "rgba(232, 192, 122, 0.45)" : "rgba(142, 212, 204, 0.4)";
    c.beginPath();
    c.ellipse(-r * 0.2, 0, r * 0.55, r * 0.22, -0.4, 0, Math.PI * 2);
    c.fill();

    for (let k = 0; k < 3; k++) {
      const pip = k < dmg;
      c.fillStyle = pip ? "#ff8a78" : "rgba(255, 244, 220, 0.35)";
      c.beginPath();
      c.arc(-r * 0.28 + k * r * 0.22, -r * 0.42, s(2.1), 0, Math.PI * 2);
      c.fill();
    }

    c.restore();
  }

  function drawWalker(c, e, t) {
    const x = sx(e.x);
    const y = sy(e.y);
    const r = s(e.visualRadius);
    const facing = e.vx >= 0 ? 1 : -1;
    const dead = !e.active;
    c.save();
    c.translate(x, y);
    c.scale(facing, 1);
    if (dead) c.globalAlpha = Math.max(0, 1 - (state.tick - e.inactiveTick) / 90);
    const waddle = Math.sin(t * 8 + e.id) * 0.12;
    c.rotate(waddle);

    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.ellipse(0, r * 0.85, r * 1.1, r * 0.28, 0, 0, Math.PI * 2);
    c.fill();

    c.fillStyle = "#6a3e22";
    c.beginPath();
    c.ellipse(0, r * 0.15, r * 1.05, r * 0.7, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#c4a06a";
    c.beginPath();
    c.ellipse(0, -r * 0.1, r * 0.95, r * 0.55, 0, Math.PI, 0, true);
    c.fill();
    c.strokeStyle = "rgba(255, 230, 180, 0.5)";
    c.lineWidth = s(1.2);
    c.stroke();

    c.fillStyle = "#3a2010";
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(i * r * 0.45, r * 0.1);
      c.lineTo(i * r * 0.45 + r * 0.08, r * 0.55);
      c.lineTo(i * r * 0.45 - r * 0.08, r * 0.55);
      c.closePath();
      c.fill();
    }
    c.fillStyle = "#e8d0a0";
    c.beginPath();
    c.arc(r * 0.45, -r * 0.05, s(2.2), 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function drawPads(c) {
    const y0 = sy(110);
    const h = Math.max(s(70), cssH - y0 - 6);
    const x1 = sx(14);
    const w1 = sx(168) - x1;
    const x2 = sx(232);
    const w2 = sx(346) - x2;

    c.save();
    c.globalAlpha = 0.92;
    c.fillStyle = "rgba(28, 20, 34, 0.55)";
    roundRect(c, x1, y0, w1, h, s(16));
    c.fill();
    c.strokeStyle = "rgba(217, 162, 74, 0.35)";
    c.lineWidth = s(1.4);
    c.stroke();

    const cx = x1 + w1 / 2;
    const cy = y0 + h * 0.52;
    c.strokeStyle = "rgba(255, 231, 176, 0.28)";
    c.beginPath();
    c.arc(cx, cy, s(22), 0, Math.PI * 2);
    c.stroke();
    let knobX = cx;
    if (ui.moveId != null) knobX = cx + ui.axis * s(26);
    c.fillStyle = "#d9a24a";
    c.beginPath();
    c.arc(knobX, cy, s(10), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,244,220,0.5)";
    c.beginPath();
    c.arc(knobX - s(2), cy - s(2), s(3), 0, Math.PI * 2);
    c.fill();

    fx.padJumpPress += (0 - fx.padJumpPress) * 0.2;
    const press = 1 - fx.padJumpPress * 0.08;
    c.save();
    c.translate(x2 + w2 / 2, y0 + h * 0.52);
    c.scale(press, press);
    c.fillStyle = "rgba(28, 20, 34, 0.55)";
    c.beginPath();
    c.arc(0, 0, s(28), 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(217, 162, 74, 0.5)";
    c.lineWidth = s(1.6);
    c.stroke();
    c.fillStyle = "#ffe7b0";
    c.beginPath();
    c.moveTo(0, -s(12));
    c.lineTo(s(10), s(4));
    c.lineTo(s(4), s(4));
    c.lineTo(s(4), s(12));
    c.lineTo(-s(4), s(12));
    c.lineTo(-s(4), s(4));
    c.lineTo(-s(10), s(4));
    c.closePath();
    c.fill();
    c.restore();
    c.restore();
  }

  function drawHud(c, t) {
    const remain = Math.max(0, state.remainingMs);
    const sec = remain / 1000;
    const low = remain < 10000;
    const critical = remain < 4000;
    c.save();
    c.textAlign = "center";
    c.fillStyle = "rgba(217, 162, 74, 0.85)";
    c.font = "600 " + s(8) + "px 'Avenir Next', 'Segoe UI', sans-serif";
    c.letterSpacing = "0.42em";
    c.fillText("STOMP", sx(180), sy(622));

    c.fillStyle = critical ? "#ff8a90" : low ? "#ffd08a" : "#fff6e4";
    const pulse = critical ? 1 + Math.sin(t * 10) * 0.06 : 1;
    c.font = "700 " + s(18 * pulse) + "px 'Avenir Next', 'Segoe UI', sans-serif";
    const label = sec >= 10 ? sec.toFixed(0) : sec.toFixed(1);
    c.fillText(label, sx(180), sy(598));

    c.textAlign = "left";
    c.fillStyle = "rgba(242, 230, 201, 0.7)";
    c.font = "600 " + s(9) + "px 'Avenir Next', 'Segoe UI', sans-serif";
    c.fillText(String(state.score), sx(16), sy(612));
    c.textAlign = "right";
    c.fillStyle = "rgba(217, 162, 74, 0.7)";
    c.fillText(state.rank, sx(344), sy(612));

    if (state.phase === "ready") {
      const a = 0.45 + Math.sin(t * 2.4) * 0.25;
      c.globalAlpha = a;
      c.textAlign = "center";
      c.fillStyle = "#ffe7b0";
      c.font = "600 " + s(10) + "px 'Avenir Next', 'Segoe UI', sans-serif";
      c.fillText("move or jump", sx(180), sy(168));
    }
    c.restore();

    const clockW = sx(220);
    const cx = sx(70);
    const cy = sy(586);
    c.fillStyle = "rgba(255, 244, 220, 0.08)";
    roundRect(c, cx, cy, clockW, s(4), 2);
    c.fill();
    const frac = Math.max(0, Math.min(1, remain / 90000));
    c.fillStyle = critical ? "#ff6b78" : low ? "#ffb35c" : "#d9a24a";
    roundRect(c, cx, cy, clockW * frac, s(4), 2);
    c.fill();
  }

  function drawFx(c, dt) {
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.grav || 0) * dt;
      if (p.life <= 0) {
        fx.particles.splice(i, 1);
        continue;
      }
      c.globalAlpha = Math.max(0, p.life / p.max);
      c.fillStyle = p.color;
      c.beginPath();
      c.arc(sx(p.x), sy(p.y), s(p.size), 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    for (let i = fx.pops.length - 1; i >= 0; i--) {
      const p = fx.pops[i];
      p.t += dt;
      if (p.t > 0.7) {
        fx.pops.splice(i, 1);
        continue;
      }
      c.globalAlpha = 1 - p.t / 0.7;
      c.fillStyle = p.color;
      c.font = "700 " + s(11) + "px 'Avenir Next', 'Segoe UI', sans-serif";
      c.textAlign = "center";
      c.fillText(p.text, sx(p.x), sy(p.y + p.t * 28));
      c.globalAlpha = 1;
    }
  }

  function drawVignette(c) {
    const g = c.createRadialGradient(cssW / 2, cssH * 0.42, cssH * 0.1, cssW / 2, cssH * 0.45, cssH * 0.72);
    const tight = fx.tight;
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(6,4,10," + (0.38 + tight * 0.28) + ")");
    c.fillStyle = g;
    c.fillRect(0, 0, cssW, cssH);
    if (fx.dropFlash > 0) {
      c.fillStyle = "rgba(180, 40, 50," + 0.14 * fx.dropFlash + ")";
      c.fillRect(0, 0, cssW, cssH);
    }
    if (fx.hitFlash > 0) {
      c.fillStyle = "rgba(255, 230, 160," + 0.07 * fx.hitFlash + ")";
      c.fillRect(0, 0, cssW, cssH);
    }
  }

  /* ---------- frame ---------- */
  function tickFx(dt) {
    fx.t += dt;
    fx.shake = Math.max(0, fx.shake - dt * 2.2);
    fx.hitFlash = Math.max(0, fx.hitFlash - dt * 3);
    fx.dropFlash = Math.max(0, fx.dropFlash - dt * 1.8);
    fx.land = Math.max(0, fx.land - dt * 3);
    fx.jump = Math.max(0, fx.jump - dt * 3);
    fx.burst = Math.max(0, fx.burst - dt * 1.6);
    fx.clockPop = Math.max(0, fx.clockPop - dt * 2);
    fx.faceT = Math.max(0, fx.faceT - dt);
    if (fx.faceT <= 0) {
      if (state.phase === "ended") fx.face = "spent";
      else if (state.phase === "ready") fx.face = "rest";
      else if (state.ball.lastBounceKind === "power" && state.ball.vy > 80) fx.face = "stretch";
      else if (
        state.ball.vy < 0 &&
        Math.abs(state.ball.x - state.machine.x) < 50 &&
        state.ball.y < state.machine.y + 120
      )
        fx.face = "wound";
      else fx.face = "rest";
    }
    const remain = state.remainingMs;
    fx.tight = state.phase === "playing" && remain < 10000 ? (10000 - remain) / 10000 : 0;
  }

  function render(dt) {
    tickFx(dt);
    const t = fx.t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    if (fx.shake > 0) {
      const mag = fx.shake * s(5);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }
    drawStage(ctx, t);
    drawMotes(ctx, t);

    const list = state.enemies.slice().sort(function (a, b) {
      return b.y - a.y;
    });
    for (let i = 0; i < list.length; i++) {
      if (list[i].type === "walker") drawWalker(ctx, list[i], t);
      else drawFlyer(ctx, list[i], t);
    }

    drawMachine(ctx, state.machine, state.ball, t);
    drawBall(ctx, state.ball, t);
    drawPads(ctx);
    drawHud(ctx, t);
    drawFx(ctx, dt);
    drawVignette(ctx);
    ctx.restore();
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;
    Sim.advance(state, dt);
    consumeEvents();

    if (state.phase === "ended") {
      if (!endEl.classList.contains("show")) {
        updateSessionEnd();
        endEl.classList.add("show");
        endTimer = 0;
        endArmed = false;
      }
      endTimer += dt;
      if (endTimer > 380 && !state.input.jump && ui.jumpId == null) endArmed = true;
    } else {
      endEl.classList.remove("show");
      endArmed = false;
    }

    render(dt / 1000);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
