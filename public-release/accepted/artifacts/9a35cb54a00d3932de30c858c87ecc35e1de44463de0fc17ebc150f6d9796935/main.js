(function () {
  'use strict';

  var C = window.StompSim.constants;
  var W = C.W, H = C.H;
  var GROUND_Y = C.GROUND_Y, LOW_LANE_Y = C.LOW_LANE_Y, HIGH_LANE_Y = C.HIGH_LANE_Y;
  var MACHINE_RADIUS = C.MACHINE_RADIUS, BALL_RADIUS = C.BALL_RADIUS;
  var START_CLOCK_MS = C.START_CLOCK_MS;

  var game = window.StompSim.create();

  // ---------------------------------------------------------------------
  // canvas + scaling
  // ---------------------------------------------------------------------
  var wrapper = document.getElementById('stage-wrapper');
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var currentScale = 1;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  function viewportSize() {
    if (window.visualViewport) {
      return { w: window.visualViewport.width, h: window.visualViewport.height };
    }
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function resize() {
    var vp = viewportSize();
    var scale = Math.min(vp.w / W, vp.h / H);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    currentScale = scale;
    wrapper.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
    window.visualViewport.addEventListener('scroll', resize);
  }
  resize();

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function approach(cur, target, dt, speed) {
    var k = 1 - Math.exp(-speed * dt / 1000);
    return cur + (target - cur) * k;
  }

  // ---------------------------------------------------------------------
  // seed + telemetry wiring
  // ---------------------------------------------------------------------
  var currentSeed = Date.now() % 2147483647;
  game.reset(currentSeed);

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      currentSeed = seed;
      resetVisualState();
      return game.reset(seed);
    },
    snapshot: function () { return game.snapshot(); },
    advance: function (ms) { return game.advance(ms); }
  };

  function restartSameSeed() {
    resetVisualState();
    game.reset(currentSeed);
  }
  function restartNewRun() {
    currentSeed = Date.now() % 2147483647;
    resetVisualState();
    game.reset(currentSeed);
  }

  // ---------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------
  var CTRL_Y0 = H - 198, CTRL_Y1 = H - 28;
  var MOVE_X0 = 16, MOVE_X1 = 166;
  var JUMP_X0 = 224, JUMP_X1 = 374;
  var DRAG_RANGE = 68;

  var pointers = {}; // id -> {kind:'move'|'jump', ox, oy}
  var moveTouchActive = false;
  var jumpZonePressed = 0;

  function canvasLogicalPoint(evt) {
    var rect = canvas.getBoundingClientRect();
    var x = (evt.clientX - rect.left) * (W / rect.width);
    var y = (evt.clientY - rect.top) * (H / rect.height);
    return { x: x, y: y };
  }

  canvas.addEventListener('pointerdown', function (evt) {
    var snap = game.snapshot();
    if (snap.phase === 'ended') {
      restartNewRun();
      evt.preventDefault();
      return;
    }
    var p = canvasLogicalPoint(evt);
    if (p.y < CTRL_Y0) { evt.preventDefault(); return; }
    if (p.x < W / 2) {
      pointers[evt.pointerId] = { kind: 'move', ox: p.x, oy: p.y };
      moveTouchActive = true;
      canvas.setPointerCapture(evt.pointerId);
      game.setAxis(0);
    } else {
      pointers[evt.pointerId] = { kind: 'jump' };
      jumpZonePressed = 220;
      game.queueJump();
      canvas.setPointerCapture(evt.pointerId);
    }
    evt.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', function (evt) {
    var rec = pointers[evt.pointerId];
    if (!rec || rec.kind !== 'move') return;
    var p = canvasLogicalPoint(evt);
    var dx = p.x - rec.ox;
    var axis = clamp(dx / DRAG_RANGE, -1, 1);
    game.setAxis(axis);
    evt.preventDefault();
  }, { passive: false });

  function releasePointer(evt) {
    var rec = pointers[evt.pointerId];
    if (!rec) return;
    if (rec.kind === 'move') { moveTouchActive = false; game.setAxis(0); }
    delete pointers[evt.pointerId];
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', function (evt) {
    if (evt.pointerType === 'mouse') releasePointer(evt);
  });

  window.addEventListener('keydown', function (evt) {
    if (evt.key === 'r' || evt.key === 'R') {
      restartSameSeed();
      evt.preventDefault();
      return;
    }
    var relevant = evt.key === 'ArrowLeft' || evt.key === 'ArrowRight' || evt.code === 'Space';
    if (!relevant) return;

    var snap = game.snapshot();
    if (snap.phase === 'ended') {
      restartNewRun();
      evt.preventDefault();
      return;
    }
    if (evt.key === 'ArrowLeft') { game.setKey('left', true); }
    else if (evt.key === 'ArrowRight') { game.setKey('right', true); }
    else if (evt.code === 'Space' && !evt.repeat) { game.queueJump(); }
    evt.preventDefault();
  });
  window.addEventListener('keyup', function (evt) {
    if (evt.key === 'ArrowLeft') { game.setKey('left', false); }
    else if (evt.key === 'ArrowRight') { game.setKey('right', false); }
  });

  // ---------------------------------------------------------------------
  // visual / juice state (view-only, never touches the simulation)
  // ---------------------------------------------------------------------
  var presentationClock = 0;
  var lastProcessedSeq = 0;
  var particles = [];
  var popups = [];
  var shake = { time: 0, mag: 0 };
  var flashOverlay = 0;

  var machineV = { sx: 1, sy: 1, mood: 'idle', moodTimer: 0, flashT: 0, flashColor: '#ffffff' };
  var ballV = { sx: 1, sy: 1, trail: [], flashT: 0 };

  var sessionBest = 0;
  try {
    var stored = localStorage.getItem('stomp.sessionBest');
    if (stored) sessionBest = parseInt(stored, 10) || 0;
  } catch (e) { /* ignore storage errors */ }

  function resetVisualState() {
    lastProcessedSeq = 0;
    particles.length = 0;
    popups.length = 0;
    shake.time = 0; shake.mag = 0;
    flashOverlay = 0;
    machineV.mood = 'idle'; machineV.moodTimer = 0; machineV.sx = 1; machineV.sy = 1;
    ballV.trail.length = 0; ballV.sx = 1; ballV.sy = 1;
    Object.keys(pointers).forEach(function (k) { delete pointers[k]; });
    moveTouchActive = false;
    game.setAxis(0);
  }

  function spawnBurst(x, y, color, count, speed, life) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = speed * (0.4 + Math.random() * 0.6);
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - s * 0.2,
        life: life, maxLife: life, color: color, size: 3 + Math.random() * 4
      });
    }
  }

  function spawnPopup(x, y, text, color) {
    popups.push({ x: x, y: y, text: text, color: color, life: 900, maxLife: 900, vy: -38 });
  }

  function setMachineMood(mood, ms, flashColor) {
    machineV.mood = mood;
    machineV.moodTimer = ms;
    if (flashColor) { machineV.flashT = 220; machineV.flashColor = flashColor; }
  }

  function addShake(mag, time) {
    shake.mag = Math.max(shake.mag, mag);
    shake.time = Math.max(shake.time, time);
  }

  function findEnemyInSnap(snap, id) {
    for (var i = 0; i < snap.enemies.length; i++) if (snap.enemies[i].id === id) return snap.enemies[i];
    return null;
  }

  function processNewEvents(snap) {
    var events = snap.recentEvents;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.sequence <= lastProcessedSeq) continue;
      lastProcessedSeq = ev.sequence;
      handleEvent(ev, snap);
    }
  }

  function handleEvent(ev, snap) {
    var enemy = ev.enemyId != null ? findEnemyInSnap(snap, ev.enemyId) : null;
    switch (ev.kind) {
      case 'machine_jump':
        machineV.sy = 0.78; machineV.sx = 1.18;
        spawnBurst(snap.machine.x, GROUND_Y, 'rgba(255,255,255,0.5)', 6, 60, 260);
        break;
      case 'machine_land':
        machineV.sy = 0.7; machineV.sx = 1.22;
        spawnBurst(snap.machine.x, GROUND_Y, 'rgba(255,255,255,0.4)', 8, 70, 300);
        break;
      case 'ball_bounce_weak':
        ballV.sy = 0.6; ballV.sx = 1.35;
        break;
      case 'ball_bounce_normal':
        ballV.sy = 0.55; ballV.sx = 1.4;
        break;
      case 'ball_bounce_power':
        ballV.sy = 0.45; ballV.sx = 1.55;
        setMachineMood('stretched', 260, null);
        addShake(2, 120);
        break;
      case 'top_hit': {
        var ex = enemy ? enemy.x : snap.ball.x, ey = enemy ? enemy.y : snap.ball.y;
        spawnBurst(ex, ey, '#ffe066', 10, 130, 420);
        spawnPopup(ex, ey - 20, '+' + ev.amountMs + 'ms', '#ffe066');
        setMachineMood('happy', 480, null);
        ballV.sx = 1.35; ballV.sy = 1.35;
        addShake(3, 140);
        break;
      }
      case 'enemy_defeated': {
        var ex2 = enemy ? enemy.x : snap.ball.x, ey2 = enemy ? enemy.y : snap.ball.y;
        spawnBurst(ex2, ey2, '#ff8fd6', 26, 210, 620);
        spawnBurst(ex2, ey2, '#ffffff', 14, 140, 500);
        spawnPopup(ex2, ey2 - 34, 'DEFEATED', '#ff8fd6');
        setMachineMood('happy', 700, null);
        addShake(7, 260);
        break;
      }
      case 'wrong_side_hit': {
        var ex3 = enemy ? enemy.x : snap.machine.x, ey3 = enemy ? enemy.y : snap.machine.y;
        spawnBurst(ex3, ey3, '#ff5a5a', 8, 90, 340);
        spawnPopup(ex3, ey3 - 18, ev.amountMs + 'ms', '#ff5a5a');
        setMachineMood('dismayed', 480, '#ff5a5a');
        addShake(4, 180);
        break;
      }
      case 'ball_drop':
        setMachineMood('deflated', 900, '#ff5a5a');
        ballV.sx = 1.7; ballV.sy = 0.25;
        spawnBurst(snap.machine.x, GROUND_Y, '#9a8bff', 16, 120, 500);
        spawnPopup(snap.machine.x, GROUND_Y - 40, ev.amountMs + 'ms', '#ff8080');
        addShake(9, 340);
        flashOverlay = 0.35;
        break;
      case 'ground_stomp': {
        var ex4 = enemy ? enemy.x : snap.machine.x, ey4 = enemy ? enemy.y : snap.machine.y;
        spawnBurst(ex4, ey4, '#8fffb0', 16, 150, 460);
        spawnPopup(ex4, ey4 - 20, '+' + ev.amountMs + 'ms', '#8fffb0');
        setMachineMood('happy', 400, null);
        addShake(4, 160);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // update (visual-only easing)
  // ---------------------------------------------------------------------
  function updateVisuals(snap, dt) {
    presentationClock += dt;

    machineV.sx = approach(machineV.sx, 1, dt, 9);
    machineV.sy = approach(machineV.sy, 1, dt, 9);
    ballV.sx = approach(ballV.sx, 1, dt, 10);
    ballV.sy = approach(ballV.sy, 1, dt, 10);

    if (machineV.moodTimer > 0) { machineV.moodTimer -= dt; if (machineV.moodTimer <= 0) machineV.mood = 'idle'; }
    if (machineV.flashT > 0) machineV.flashT -= dt;
    if (jumpZonePressed > 0) jumpZonePressed -= dt;

    if (machineV.moodTimer <= 0 && snap.phase !== 'ended') {
      var dy = snap.machine.y - snap.ball.y;
      var dx = Math.abs(snap.machine.x - snap.ball.x);
      var incoming = snap.ball.active && snap.ball.vy > 0 && dy > 36 && dy < 170 && dx < 90;
      machineV.mood = incoming ? 'windup' : 'idle';
    }

    if (snap.phase === 'ended') machineV.mood = 'spent';

    if (shake.time > 0) { shake.time -= dt; if (shake.time <= 0) shake.mag = 0; }
    if (flashOverlay > 0) flashOverlay = Math.max(0, flashOverlay - dt / 500);

    if (snap.ball.active && snap.phase === 'playing') {
      ballV.trail.push({ x: snap.ball.x, y: snap.ball.y });
      if (ballV.trail.length > 7) ballV.trail.shift();
    } else if (ballV.trail.length) {
      ballV.trail.shift();
    }

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 260 * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
    }
    for (var j = popups.length - 1; j >= 0; j--) {
      var pu = popups[j];
      pu.life -= dt;
      if (pu.life <= 0) { popups.splice(j, 1); continue; }
      pu.y += pu.vy * dt / 1000;
    }
  }

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBackground(snap) {
    var tier = snap.difficulty;
    var hueShift = (tier - 1) * 6;
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'hsl(' + (256 + hueShift) + ',48%,14%)');
    grad.addColorStop(0.62, 'hsl(' + (262 + hueShift) + ',44%,10%)');
    grad.addColorStop(1, 'hsl(' + (268 + hueShift) + ',40%,7%)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // soft drifting glow orbs for depth
    for (var i = 0; i < 3; i++) {
      var ox = (Math.sin(presentationClock * 0.00012 + i * 2.1) * 0.5 + 0.5) * W;
      var oy = 90 + i * 190 + Math.sin(presentationClock * 0.00019 + i) * 18;
      var rg = ctx.createRadialGradient(ox, oy, 0, ox, oy, 130);
      rg.addColorStop(0, 'rgba(150,120,255,0.07)');
      rg.addColorStop(1, 'rgba(150,120,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(ox, oy, 130, 0, Math.PI * 2); ctx.fill();
    }

    // ground platform
    var groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    groundGrad.addColorStop(0, '#241a38');
    groundGrad.addColorStop(1, '#120c1e');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, GROUND_Y, W, 3);
  }

  function drawLane(y, label, color, occupied) {
    var pulse = 0.5 + 0.5 * Math.sin(presentationClock * 0.0026 + y);
    var alpha = occupied ? 0.22 + 0.10 * pulse : 0.08 + 0.05 * pulse;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, y - 16, W, 32);
    ctx.globalAlpha = occupied ? 0.75 : 0.35;
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function laneOccupied(snap, lane) {
    for (var i = 0; i < snap.enemies.length; i++) {
      var e = snap.enemies[i];
      if (e.active && e.lane === lane) return true;
    }
    return false;
  }

  function drawMachine(snap) {
    var m = snap.machine;
    var bob = snap.phase === 'ready' ? Math.sin(presentationClock * 0.003) * 3 : 0;
    var lean = clamp(m.vx / 360, -1, 1);

    ctx.save();
    ctx.translate(m.x, m.y + bob);
    ctx.rotate(lean * 0.08);
    ctx.scale(machineV.sx, machineV.sy);

    var bodyW = MACHINE_RADIUS * 2.05, bodyH = MACHINE_RADIUS * 1.7;
    var flashMix = machineV.flashT > 0 ? clamp(machineV.flashT / 220, 0, 1) : 0;

    // treads
    ctx.fillStyle = '#1b1428';
    roundRect(ctx, -bodyW / 2 - 4, bodyH * 0.30, bodyW + 8, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#332752';
    for (var t = -bodyW / 2 + 6; t < bodyW / 2 - 4; t += 12) {
      roundRect(ctx, t, bodyH * 0.30 + 3, 6, 10, 2); ctx.fill();
    }

    // body
    var grad = ctx.createLinearGradient(0, -bodyH / 2, 0, bodyH * 0.3);
    grad.addColorStop(0, shadeColor('#ffd24d', 18));
    grad.addColorStop(1, shadeColor('#ffd24d', -14));
    ctx.fillStyle = grad;
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH * 0.82, 14);
    ctx.fill();
    if (flashMix > 0) {
      ctx.globalAlpha = flashMix * 0.55;
      ctx.fillStyle = machineV.flashColor;
      roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH * 0.82, 14);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, -bodyW / 2, -bodyH / 2, bodyW, bodyH * 0.82, 14);
    ctx.stroke();

    // antenna
    ctx.strokeStyle = '#2a2140';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bodyW * 0.22, -bodyH / 2);
    ctx.lineTo(bodyW * 0.30, -bodyH / 2 - 16 - Math.sin(presentationClock * 0.006) * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff5a8a';
    ctx.beginPath(); ctx.arc(bodyW * 0.30, -bodyH / 2 - 18, 4, 0, Math.PI * 2); ctx.fill();

    // face plate
    var plateW = bodyW * 0.62, plateH = bodyH * 0.5;
    ctx.fillStyle = '#241a38';
    roundRect(ctx, -plateW / 2, -bodyH / 2 + 8, plateW, plateH, 10);
    ctx.fill();

    drawMachineEye(0, -bodyH / 2 + 8 + plateH / 2, plateH * 0.62, m);

    ctx.restore();
  }

  function drawMachineEye(cx, cy, r, m) {
    var mood = machineV.mood;
    ctx.save();
    ctx.translate(cx, cy);

    var lidClose = 0;
    var pupilShiftY = 0;
    var pupilShiftX = clamp((m ? m.vx : 0) / 400, -1, 1) * r * 0.28;
    var glow = '#8fe3ff';

    if (mood === 'happy') { lidClose = 0.15; glow = '#ffe066'; }
    else if (mood === 'dismayed') { lidClose = 0.45; glow = '#ff8f8f'; pupilShiftY = r * 0.15; }
    else if (mood === 'deflated') { lidClose = 0.7; glow = '#b39dff'; pupilShiftY = r * 0.3; }
    else if (mood === 'stretched') { lidClose = 0; glow = '#ffffff'; }
    else if (mood === 'spent') { lidClose = 0.55; glow = '#8a7fae'; }
    else if (mood === 'windup') { lidClose = 0.3; glow = '#8fe3ff'; pupilShiftY = -r * 0.1; }
    else {
      var blink = (presentationClock % 3400);
      if (blink > 3250) lidClose = (blink - 3250) / 150;
    }

    ctx.fillStyle = '#0c0916';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, Math.PI * 2); ctx.clip();
    var eg = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 1, 0, 0, r);
    eg.addColorStop(0, '#ffffff');
    eg.addColorStop(1, glow);
    ctx.fillStyle = eg;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.fillStyle = '#241a38';
    var pr = r * (mood === 'stretched' ? 0.3 : 0.42);
    ctx.beginPath(); ctx.arc(pupilShiftX, pupilShiftY, pr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(pupilShiftX - pr * 0.3, pupilShiftY - pr * 0.3, pr * 0.28, 0, Math.PI * 2); ctx.fill();

    if (lidClose > 0) {
      ctx.fillStyle = '#0c0916';
      ctx.fillRect(-r, -r, r * 2, r * 2 * lidClose);
    }
    ctx.restore();

    if (mood === 'dismayed') {
      ctx.strokeStyle = '#ff8f8f'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 1.25); ctx.quadraticCurveTo(0, r * 1.0, r * 0.5, r * 1.25); ctx.stroke();
    } else if (mood === 'happy') {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 1.15); ctx.quadraticCurveTo(0, r * 1.5, r * 0.5, r * 1.15); ctx.stroke();
    }

    ctx.restore();
  }

  function drawBall(snap) {
    var b = snap.ball;
    if (!b.active) return;

    for (var i = 0; i < ballV.trail.length; i++) {
      var tp = ballV.trail[i];
      var a = (i / ballV.trail.length) * 0.28;
      ctx.fillStyle = 'rgba(255,214,102,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, b.radius * (0.4 + 0.5 * (i / ballV.trail.length)), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    var stretchDir = Math.atan2(b.vy, b.vx);
    ctx.rotate(stretchDir);
    ctx.scale(ballV.sx, ballV.sy);
    ctx.rotate(-stretchDir);

    var grad = ctx.createRadialGradient(-b.radius * 0.3, -b.radius * 0.3, 1, 0, 0, b.radius);
    grad.addColorStop(0, '#fff6d8');
    grad.addColorStop(0.55, '#ffd24d');
    grad.addColorStop(1, '#ff9b3d');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function drawFlyer(e) {
    var r = e.visualRadius;
    var flap = Math.sin(presentationClock * 0.012 + e.bobSeed_) * 0.5 + 0.5;
    var color = e.type === 'fastFlyer' ? '#ff6f6f' : '#5fd9c7';
    var dark = shadeColor(color, -30);

    ctx.save();
    ctx.translate(e.x, e.y);
    var facing = e.vx < 0 ? -1 : 1;
    ctx.scale(facing, 1);

    // wings
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.save();
    ctx.rotate(-0.5 - flap * 0.35);
    ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.rotate(0.5 + flap * 0.35);
    ctx.beginPath(); ctx.ellipse(r * 0.2, 0, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // body
    var grad = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r);
    grad.addColorStop(0, shadeColor(color, 25));
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // top marker (readability: distinct top surface)
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(0, -r * 0.25, r * 0.72, Math.PI, 0); ctx.fill();

    // face
    ctx.fillStyle = '#12233a';
    ctx.beginPath(); ctx.arc(-r * 0.28, r * 0.05, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.28, r * 0.05, r * 0.14, 0, Math.PI * 2); ctx.fill();

    // damage pips (three-state)
    ctx.restore();
    for (var i = 0; i < e.hitsRequired; i++) {
      var px = e.x - (e.hitsRequired - 1) * 7 + i * 14;
      var py = e.y + r + 11;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = i < e.hitsTaken ? '#ffe066' : 'rgba(255,255,255,0.25)';
      ctx.fill();
    }
  }

  function drawWalker(e) {
    var r = e.visualRadius;
    var waddle = Math.sin(presentationClock * 0.014 + e.bobSeed_);
    ctx.save();
    ctx.translate(e.x, e.y + Math.abs(waddle) * 2);
    var facing = e.vx < 0 ? -1 : 1;
    ctx.scale(facing, 1);

    ctx.fillStyle = '#2a2140';
    roundRect(ctx, -r * 0.5, r * 0.55, r * 0.35, r * 0.55, 4); ctx.fill();
    roundRect(ctx, r * 0.15, r * 0.55, r * 0.35, r * 0.55, 4); ctx.fill();

    var grad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, 1, 0, 0, r);
    grad.addColorStop(0, '#c98bff');
    grad.addColorStop(1, '#7c4fd6');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#12233a';
    ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.1, r * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(r * 0.36, -r * 0.14, r * 0.05, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawEnemies(snap) {
    for (var i = 0; i < snap.enemies.length; i++) {
      var e = snap.enemies[i];
      if (e.bobSeed_ === undefined) e.bobSeed_ = (e.id * 137) % 1000;
      ctx.save();
      ctx.globalAlpha = e.active ? 1 : 0.35;
      if (e.type === 'walker') drawWalker(e); else drawFlyer(e);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (var j = 0; j < popups.length; j++) {
      var pu = popups[j];
      var a2 = clamp(pu.life / pu.maxLife, 0, 1);
      ctx.globalAlpha = a2;
      ctx.fillStyle = pu.color;
      ctx.fillText(pu.text, pu.x, pu.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawControls(snap) {
    var ready = snap.phase !== 'ended';
    if (!ready) return;
    ctx.save();
    ctx.globalAlpha = moveTouchActive ? 0.28 : 0.16;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, MOVE_X0, CTRL_Y0, MOVE_X1 - MOVE_X0, CTRL_Y1 - CTRL_Y0, 22);
    ctx.fill();
    ctx.globalAlpha = jumpZonePressed > 0 ? 0.32 : 0.16;
    roundRect(ctx, JUMP_X0, CTRL_Y0, JUMP_X1 - JUMP_X0, CTRL_Y1 - CTRL_Y0, 22);
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    var mcx = (MOVE_X0 + MOVE_X1) / 2, mcy = (CTRL_Y0 + CTRL_Y1) / 2;
    ctx.beginPath(); ctx.moveTo(mcx - 22, mcy); ctx.lineTo(mcx + 22, mcy); ctx.stroke();
    arrowHead(mcx - 22, mcy, -1); arrowHead(mcx + 22, mcy, 1);

    var jcx = (JUMP_X0 + JUMP_X1) / 2, jcy = (CTRL_Y0 + CTRL_Y1) / 2;
    ctx.beginPath(); ctx.moveTo(jcx, jcy + 16); ctx.lineTo(jcx, jcy - 16); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(jcx - 10, jcy - 6); ctx.lineTo(jcx, jcy - 18); ctx.lineTo(jcx + 10, jcy - 6);
    ctx.stroke();
    ctx.restore();
  }

  function arrowHead(x, y, dir) {
    ctx.beginPath();
    ctx.moveTo(x - dir * 9, y - 7);
    ctx.lineTo(x, y);
    ctx.lineTo(x - dir * 9, y + 7);
    ctx.stroke();
  }

  function formatTime(ms) {
    var s = Math.ceil(ms / 100) / 10;
    if (s < 0) s = 0;
    return s.toFixed(1) + 's';
  }

  function drawHud(snap) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';

    var frac = clamp(snap.remainingMs / START_CLOCK_MS, 0, 1);
    var bonus = snap.remainingMs > START_CLOCK_MS;
    var barW = W - 32, barH = 16, barX = 16, barY = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, barX, barY, barW, barH, 8); ctx.fill();
    var low = snap.remainingMs < 10000 && snap.phase === 'playing';
    var pulse = low ? (0.6 + 0.4 * Math.sin(presentationClock * 0.012)) : 1;
    ctx.fillStyle = bonus ? '#ffe066' : (low ? 'rgba(255,90,90,' + pulse + ')' : '#8fe3ff');
    roundRect(ctx, barX, barY, barW * frac, barH, 8); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(formatTime(snap.remainingMs), barX + 6, barY + barH - 4);

    ctx.textAlign = 'right';
    ctx.font = '700 20px system-ui, sans-serif';
    ctx.fillStyle = '#ffe066';
    ctx.fillText('' + snap.score, W - 16, 54);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('SCORE', W - 16, 68);

    ctx.textAlign = 'left';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = '#c98bff';
    ctx.fillText('RANK ' + snap.rank, 16, 54);

    for (var i = 0; i < 4; i++) {
      ctx.fillStyle = i < snap.difficulty ? '#ff8fd6' : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(20 + i * 14, 68, 4, 0, Math.PI * 2); ctx.fill();
    }

    if (low) {
      ctx.fillStyle = 'rgba(255,40,40,' + (0.08 * pulse).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  function drawReadyHint(snap) {
    if (snap.phase !== 'ready') return;
    var a = 0.55 + 0.35 * Math.sin(presentationClock * 0.0022);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('drag left to move · tap right to jump', W / 2, CTRL_Y0 - 20);
    ctx.restore();
  }

  function drawEndScreen(snap) {
    if (snap.phase !== 'ended') return;
    ctx.save();
    ctx.fillStyle = 'rgba(8,5,14,0.72)';
    ctx.fillRect(0, 0, W, H);

    var cx = W / 2, cy = H / 2 - 40;
    ctx.textAlign = 'center';

    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillStyle = '#ffe066';
    ctx.fillText('OUT OF TIME', cx, cy - 150);

    ctx.font = '800 54px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('' + snap.score, cx, cy - 90);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('SCORE', cx, cy - 70);

    var best = Math.max(sessionBest, snap.score);
    if (snap.score > sessionBest) {
      try { localStorage.setItem('stomp.sessionBest', String(snap.score)); } catch (e) {}
      sessionBest = snap.score;
    }

    var lines = [
      ['SESSION BEST', best],
      ['TARGETS DEFEATED', snap.airEnemiesDefeated],
      ['LONGEST PURSUIT', snap.longestCleanSequence],
      ['RANK', snap.rank]
    ];
    ctx.font = '600 15px system-ui, sans-serif';
    for (var i = 0; i < lines.length; i++) {
      var ly = cy - 20 + i * 28;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(lines[i][0], cx - 110, ly);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('' + lines[i][1], cx + 110, ly);
    }

    var a = 0.6 + 0.4 * Math.sin(presentationClock * 0.005);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.fillStyle = '#8fe3ff';
    ctx.fillText('tap to try again · R to replay this run', cx, cy + 120);
    ctx.restore();
  }

  function shadeColor(hex, amt) {
    var c = hex.replace('#', '');
    var num = parseInt(c, 16);
    var r = clamp((num >> 16) + amt, 0, 255);
    var g = clamp(((num >> 8) & 0xff) + amt, 0, 255);
    var b = clamp((num & 0xff) + amt, 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function render(snap, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (shake.time > 0 && shake.mag > 0) {
      var mag = shake.mag * clamp(shake.time / 260, 0, 1);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    drawBackground(snap);
    drawLane(HIGH_LANE_Y, 'HIGH', '#c98bff', laneOccupied(snap, 'high'));
    drawLane(LOW_LANE_Y, 'LOW', '#5fd9c7', laneOccupied(snap, 'low'));
    drawEnemies(snap);
    drawBall(snap);
    drawMachine(snap);
    drawParticles();
    drawControls(snap);
    drawHud(snap);
    drawReadyHint(snap);

    if (flashOverlay > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flashOverlay * 0.4).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();

    drawEndScreen(snap);
  }

  // ---------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------
  var lastT = null;
  function frame(t) {
    requestAnimationFrame(frame);
    if (lastT == null) lastT = t;
    var dt = t - lastT;
    lastT = t;
    if (dt > 250) dt = 250;

    game.advance(dt);
    var snap = game.snapshot();
    processNewEvents(snap);
    updateVisuals(snap, dt);
    render(snap, dt);
  }
  requestAnimationFrame(frame);
})();
