// DELVE — canvas renderer. Purely view-layer: reads snapshots, never writes
// simulation state. All randomness here is either seeded-by-id (stable across
// frames) or explicitly cosmetic (particles) and never touches collisions.
(function (global) {
  'use strict';

  var WORLD_VIEW_WIDTH = 340;
  var MACHINE_Y_FRAC = 0.34;
  var MAX_PLAY_ASPECT = 0.66; // width/height ceiling before pillarboxing

  var PALETTE = {
    bgTop: '#120826',
    bgMid: '#1a0f36',
    bgDeep: '#050311',
    rock: '#3a2a52',
    rockDark: '#241a38',
    rockLine: '#57406f',
    wallEdge: '#8a6bd6',
    wallGlow: 'rgba(138,107,214,0.35)',
    floorNear: '#2a1c48',
    floorFar: '#0a0618',
    machineBody: '#ff9a4a',
    machineBodyDark: '#d9702a',
    machineGlass: '#7ef0ff',
    machineAccent: '#ffd166',
    fragment: '#5ff2e0',
    fragmentCore: '#e8fffb',
    power: '#ffcf3f',
    powerCore: '#fff3c9',
    danger: '#ff5d73',
    text: '#f1ecff',
    textDim: 'rgba(241,236,255,0.62)',
    timerGood: '#5ff2b0',
    timerWarn: '#ffcf3f',
    timerBad: '#ff5d73'
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function hashId(id) {
    var h = (id * 2654435761) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 2246822519); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function polygonPoints(cx, cy, radius, segments, seed, jitter) {
    var pts = [];
    for (var i = 0; i < segments; i++) {
      var a = (i / segments) * Math.PI * 2;
      var n = Math.sin(a * 3.1 + seed * 11.7) * 0.5 + Math.sin(a * 5.3 + seed * 4.1) * 0.5;
      var r = radius * (1 + n * jitter);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function drawPolygon(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i <= pts.length; i++) {
      var p = pts[i % pts.length];
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  function createRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var dpr = Math.max(1, Math.min(2.5, global.devicePixelRatio || 1));
    var cssW = 0, cssH = 0;
    var playRect = { x: 0, y: 0, width: 0, height: 0 };

    var particles = [];
    var shake = 0;
    var flash = 0;
    var flashColor = PALETTE.danger;
    var stickVisual = null; // {x,y,dx,dy}
    var animTime = 0;
    var comboLevel = 0;
    var comboTimer = 0;
    var machineFlinch = 0;
    var machineCrumple = 0;
    var readyPulse = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = Math.max(1, Math.min(2.5, global.devicePixelRatio || 1));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var aspect = cssW / cssH;
      var playW, playH, ox, oy;
      if (aspect > MAX_PLAY_ASPECT) {
        playH = cssH;
        playW = playH * MAX_PLAY_ASPECT;
        ox = (cssW - playW) / 2;
        oy = 0;
      } else {
        playW = cssW; playH = cssH; ox = 0; oy = 0;
      }
      playRect = { x: ox, y: oy, width: playW, height: playH };
    }

    function setStickVisual(v) { stickVisual = v; }

    function mapper(snapshot) {
      var ppu = playRect.width / WORLD_VIEW_WIDTH;
      var machineScreenY = playRect.y + playRect.height * MACHINE_Y_FRAC;
      var centerScreenX = playRect.x + playRect.width / 2;
      var camX = snapshot.courseCenterX;
      var playerDepth = snapshot.depth;
      return {
        ppu: ppu,
        toScreen: function (x, depth) {
          return {
            x: centerScreenX + (x - camX) * ppu,
            y: machineScreenY + (depth - playerDepth) * ppu
          };
        },
        machineScreen: { x: centerScreenX + (snapshot.x - camX) * ppu, y: machineScreenY }
      };
    }

    // ---- background -------------------------------------------------------
    function drawBackground(snapshot) {
      ctx.fillStyle = '#020108';
      ctx.fillRect(0, 0, cssW, cssH);

      if (playRect.x > 0) {
        var sideGrad = ctx.createLinearGradient(0, 0, 0, cssH);
        sideGrad.addColorStop(0, '#0c0620');
        sideGrad.addColorStop(1, '#020108');
        ctx.fillStyle = sideGrad;
        ctx.fillRect(0, 0, playRect.x, cssH);
        ctx.fillRect(playRect.x + playRect.width, 0, cssW - playRect.x - playRect.width, cssH);
      }

      var g = ctx.createLinearGradient(0, playRect.y, 0, playRect.y + playRect.height);
      g.addColorStop(0, PALETTE.bgTop);
      g.addColorStop(0.55, PALETTE.bgMid);
      g.addColorStop(1, PALETTE.bgDeep);
      ctx.fillStyle = g;
      ctx.fillRect(playRect.x, playRect.y, playRect.width, playRect.height);

      // parallax strata layers, pure function of depth (deterministic, view-only)
      ctx.save();
      ctx.beginPath();
      ctx.rect(playRect.x, playRect.y, playRect.width, playRect.height);
      ctx.clip();
      for (var layer = 0; layer < 3; layer++) {
        var speed = 0.15 + layer * 0.22;
        var alpha = 0.05 + layer * 0.035;
        ctx.strokeStyle = 'rgba(180,150,255,' + alpha + ')';
        ctx.lineWidth = 1.4 + layer;
        var spacing = 70 - layer * 12;
        var offset = (snapshot.depth * speed) % spacing;
        for (var y = -spacing; y < playRect.height + spacing; y += spacing) {
          var yy = playRect.y + ((y - offset) % (playRect.height + spacing * 2) + playRect.height + spacing * 2) % (playRect.height + spacing * 2) - spacing;
          ctx.beginPath();
          var wob = Math.sin(yy * 0.02 + layer) * 14;
          ctx.moveTo(playRect.x, yy + wob);
          ctx.bezierCurveTo(
            playRect.x + playRect.width * 0.33, yy - wob,
            playRect.x + playRect.width * 0.66, yy + wob,
            playRect.x + playRect.width, yy - wob
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ---- corridor -----------------------------------------------------------
    function drawCorridor(snapshot, map) {
      var walls = snapshot.walls;
      var left = walls.map(function (w) { return map.toScreen(w.leftX, w.depth); });
      var right = walls.map(function (w) { return map.toScreen(w.rightX, w.depth); });

      ctx.save();
      ctx.beginPath();
      ctx.rect(playRect.x, playRect.y, playRect.width, playRect.height);
      ctx.clip();

      // rock mass outside the corridor
      ctx.fillStyle = PALETTE.rockDark;
      ctx.fillRect(playRect.x, playRect.y, playRect.width, playRect.height);

      // open floor
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (var i = 1; i < left.length; i++) {
        var mx1 = (left[i - 1].x + left[i].x) / 2, my1 = (left[i - 1].y + left[i].y) / 2;
        ctx.quadraticCurveTo(left[i - 1].x, left[i - 1].y, mx1, my1);
      }
      ctx.lineTo(left[left.length - 1].x, left[left.length - 1].y);
      for (i = right.length - 1; i >= 0; i--) {
        ctx.lineTo(right[i].x, right[i].y);
      }
      ctx.closePath();
      var floorGrad = ctx.createLinearGradient(0, playRect.y, 0, playRect.y + playRect.height);
      floorGrad.addColorStop(0, PALETTE.floorNear);
      floorGrad.addColorStop(1, PALETTE.floorFar);
      ctx.fillStyle = floorGrad;
      ctx.fill();

      // rock texture strokes on the dirt mass (deterministic pseudo-noise by depth)
      ctx.strokeStyle = PALETTE.rockLine;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      for (var d = 0; d < walls.length; d++) {
        var w = walls[d];
        var p = map.toScreen(w.leftX, w.depth);
        for (var k = 0; k < 2; k++) {
          var nx = p.x - 10 - k * 16 - (Math.sin(w.depth * 0.05 + k) * 8);
          ctx.beginPath();
          ctx.moveTo(nx, p.y - 6);
          ctx.lineTo(nx - 5, p.y + 14);
          ctx.stroke();
        }
        var pr = map.toScreen(w.rightX, w.depth);
        for (var k2 = 0; k2 < 2; k2++) {
          var nx2 = pr.x + 10 + k2 * 16 + (Math.sin(w.depth * 0.05 + k2 + 2) * 8);
          ctx.beginPath();
          ctx.moveTo(nx2, pr.y - 6);
          ctx.lineTo(nx2 + 5, pr.y + 14);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // wall edge glow lines
      [left, right].forEach(function (side) {
        ctx.beginPath();
        ctx.moveTo(side[0].x, side[0].y);
        for (var i2 = 1; i2 < side.length; i2++) {
          var mx2 = (side[i2 - 1].x + side[i2].x) / 2, my2 = (side[i2 - 1].y + side[i2].y) / 2;
          ctx.quadraticCurveTo(side[i2 - 1].x, side[i2 - 1].y, mx2, my2);
        }
        ctx.strokeStyle = PALETTE.wallGlow;
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.strokeStyle = PALETTE.wallEdge;
        ctx.lineWidth = 2.4;
        ctx.stroke();
      });

      ctx.restore();
    }

    // ---- entities -----------------------------------------------------------
    function drawRocks(snapshot, map) {
      snapshot.rocks.forEach(function (r) {
        if (!r.active) return;
        var p = map.toScreen(r.position.x, r.position.depth);
        var rad = r.visualRadius * map.ppu;
        if (p.y < playRect.y - rad * 2 || p.y > playRect.y + playRect.height + rad * 2) return;
        var seed = hashId(r.id);
        var pts = polygonPoints(p.x, p.y, rad, 9, seed, 0.22);
        var grad = ctx.createRadialGradient(p.x - rad * 0.3, p.y - rad * 0.3, rad * 0.1, p.x, p.y, rad);
        grad.addColorStop(0, PALETTE.rock);
        grad.addColorStop(1, PALETTE.rockDark);
        drawPolygon(ctx, pts);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(87,64,111,0.9)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.moveTo(p.x - rad * 0.3, p.y - rad * 0.4);
        ctx.lineTo(p.x + rad * 0.1, p.y - rad * 0.1);
        ctx.stroke();
      });
    }

    function drawItems(snapshot, map) {
      snapshot.items.forEach(function (it) {
        if (!it.active) return;
        var p = map.toScreen(it.position.x, it.position.depth);
        var rad = it.visualRadius * map.ppu;
        if (p.y < playRect.y - rad * 2 || p.y > playRect.y + playRect.height + rad * 2) return;
        var pulse = 0.85 + Math.sin(animTime * 4 + it.id) * 0.15;
        if (it.type === 'fragment') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.PI / 4 + Math.sin(animTime * 1.5 + it.id) * 0.15);
          var s = rad * pulse;
          ctx.beginPath();
          ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.7, 0);
          ctx.closePath();
          ctx.fillStyle = PALETTE.fragment;
          ctx.shadowColor = PALETTE.fragment;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.45); ctx.lineTo(s * 0.3, 0); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s * 0.3, 0);
          ctx.closePath();
          ctx.fillStyle = PALETTE.fragmentCore;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          var rr = rad * (0.9 + Math.sin(animTime * 5) * 0.12);
          ctx.rotate(animTime * 1.8);
          for (var ring = 0; ring < 2; ring++) {
            ctx.beginPath();
            ctx.strokeStyle = ring === 0 ? PALETTE.power : PALETTE.powerCore;
            ctx.lineWidth = 2;
            ctx.arc(0, 0, rr + ring * 5, ring * 0.5, ring * 0.5 + Math.PI * 1.4);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(0, 0, rr * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = PALETTE.powerCore;
          ctx.shadowColor = PALETTE.power;
          ctx.shadowBlur = 16;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      });
    }

    // ---- the machine, our protagonist ---------------------------------------
    function drawMachine(snapshot, map) {
      var p = map.machineScreen;
      var ppu = map.ppu;
      var r = snapshot.playerRadius * ppu;
      var normSpeed = clamp((snapshot.speed - 42) / (232 - 42), 0, 1);
      var powered = snapshot.timeMs < snapshot.invincibleUntilMs;
      var gameover = snapshot.phase === 'gameover';
      var ready = snapshot.phase === 'ready';

      var lean = clamp(snapshot.input.steer, -1, 1) * (0.18 + normSpeed * 0.22);
      var stretch = 1 + normSpeed * 0.28 - machineCrumple * 0.55;
      var squash = 1 - normSpeed * 0.12 + machineCrumple * 0.75;
      var bob = ready ? Math.sin(animTime * 2.2) * 2.4 : Math.sin(animTime * (8 + normSpeed * 10)) * (1.2 + normSpeed * 1.4);

      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.rotate(lean * 0.5 + machineFlinch * (Math.sin(animTime * 40) * 0.12));
      ctx.scale(squash, stretch);

      // exhaust trail (behind = above, since we descend)
      if (!gameover && (snapshot.input.accel || normSpeed > 0.05)) {
        var flameLen = r * (0.9 + normSpeed * 2.2);
        var fg = ctx.createLinearGradient(0, -r * 0.6, 0, -r * 0.6 - flameLen);
        var flameColor = powered ? PALETTE.power : PALETTE.machineAccent;
        fg.addColorStop(0, flameColor);
        fg.addColorStop(1, 'rgba(255,150,50,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-r * 0.42, -r * 0.55);
        ctx.lineTo(0, -r * 0.55 - flameLen * (0.8 + Math.sin(animTime * 30) * 0.15));
        ctx.lineTo(r * 0.42, -r * 0.55);
        ctx.closePath();
        ctx.fill();
      }

      // body
      var bodyGrad = ctx.createLinearGradient(-r, -r, r, r);
      bodyGrad.addColorStop(0, powered ? PALETTE.power : PALETTE.machineBody);
      bodyGrad.addColorStop(1, PALETTE.machineBodyDark);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.15);
      ctx.bezierCurveTo(r * 1.05, -r * 1.0, r * 1.05, r * 0.4, r * 0.55, r * 0.95);
      ctx.quadraticCurveTo(0, r * 1.35, -r * 0.55, r * 0.95);
      ctx.bezierCurveTo(-r * 1.05, r * 0.4, -r * 1.05, -r * 1.0, 0, -r * 1.15);
      ctx.closePath();
      ctx.fillStyle = gameover ? PALETTE.rock : bodyGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();

      if (powered) {
        ctx.strokeStyle = 'rgba(255,207,63,0.7)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // drill nose (points down = direction of travel)
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, r * 0.75);
      ctx.lineTo(r * 0.5, r * 0.75);
      ctx.lineTo(0, r * 1.5 + Math.sin(animTime * 25) * r * 0.05);
      ctx.closePath();
      ctx.fillStyle = PALETTE.machineAccent;
      ctx.fill();
      for (var s2 = 0; s2 < 3; s2++) {
        ctx.save();
        ctx.translate(0, r * 1.0);
        ctx.rotate(animTime * (10 + normSpeed * 25) + s2 * (Math.PI * 2 / 3));
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, r * 0.4);
        ctx.stroke();
        ctx.restore();
      }

      // face dome
      var eyeY = -r * 0.15;
      var eyeDX = r * 0.38;
      ctx.fillStyle = 'rgba(10,6,20,0.55)';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.1, r * 0.72, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();

      function eyeShape(ex) {
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.fillStyle = gameover ? 'rgba(126,240,255,0.25)' : PALETTE.machineGlass;
        ctx.shadowColor = PALETTE.machineGlass;
        ctx.shadowBlur = gameover ? 0 : 8;
        if (gameover) {
          ctx.strokeStyle = 'rgba(126,240,255,0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(4, 4); ctx.moveTo(4, -4); ctx.lineTo(-4, 4); ctx.stroke();
        } else if (machineCrumple > 0.15) {
          ctx.beginPath();
          ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
        } else if (machineFlinch > 0.15) {
          ctx.fillRect(-5, -1.4, 10, 2.8); // squeezed shut
        } else if (ready) {
          ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
        } else if (normSpeed > 0.72) {
          ctx.beginPath(); ctx.ellipse(0, 0, r * 0.15, r * 0.2, 0, 0, Math.PI * 2); ctx.fill(); // wide thrilled eyes
        } else if (snapshot.input.accel) {
          ctx.beginPath(); ctx.ellipse(0, 1, r * 0.15, r * 0.09, 0, 0, Math.PI * 2); ctx.fill(); // narrowed determined
        } else {
          ctx.beginPath(); ctx.ellipse(0, 2, r * 0.14, r * 0.07, 0, 0, Math.PI * 2); ctx.fill(); // relaxed half-lid
        }
        ctx.restore();
      }
      eyeShape(-eyeDX * 0.55);
      eyeShape(eyeDX * 0.55);

      // side fins
      ctx.fillStyle = PALETTE.machineBodyDark;
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, -r * 0.2); ctx.lineTo(-r * 1.4, r * 0.05); ctx.lineTo(-r * 0.95, r * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 1.0, -r * 0.2); ctx.lineTo(r * 1.4, r * 0.05); ctx.lineTo(r * 0.95, r * 0.3);
      ctx.closePath(); ctx.fill();

      ctx.restore();

      // near-miss flinch flash ring
      if (machineFlinch > 0.02) {
        ctx.save();
        ctx.globalAlpha = machineFlinch;
        ctx.strokeStyle = PALETTE.machineGlass;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- particles & juice ---------------------------------------------------
    function spawnBurst(x, y, color, count, speed, life) {
      for (var i = 0; i < count; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = speed * (0.4 + Math.random() * 0.6);
        particles.push({
          x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - sp * 0.2,
          life: life, maxLife: life, color: color, size: 2 + Math.random() * 3
        });
      }
    }

    function updateParticles(dt) {
      shake = Math.max(0, shake - dt * 3.4);
      flash = Math.max(0, flash - dt * 2.6);
      comboTimer = Math.max(0, comboTimer - dt);
      if (comboTimer <= 0) comboLevel = 0;
      machineFlinch = Math.max(0, machineFlinch - dt * 3.2);
      machineCrumple = Math.max(0, machineCrumple - dt * 2.2);
      for (var i = particles.length - 1; i >= 0; i--) {
        var pt = particles[i];
        pt.life -= dt;
        if (pt.life <= 0) { particles.splice(i, 1); continue; }
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.vy += 90 * dt;
        pt.vx *= 0.98;
      }
    }

    function drawParticles() {
      particles.forEach(function (pt) {
        var t = pt.life / pt.maxLife;
        ctx.globalAlpha = clamp(t, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * t, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function drawSpeedLines(snapshot, map) {
      var normSpeed = clamp((snapshot.speed - 42) / (232 - 42), 0, 1);
      if (normSpeed < 0.55) return;
      var intensity = (normSpeed - 0.55) / 0.45;
      ctx.save();
      ctx.beginPath();
      ctx.rect(playRect.x, playRect.y, playRect.width, playRect.height);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + intensity * 0.12) + ')';
      ctx.lineWidth = 1.5;
      var n = Math.floor(6 + intensity * 10);
      for (var i = 0; i < n; i++) {
        var seedx = (i * 137.5) % playRect.width;
        var yOff = (animTime * (400 + intensity * 700) + i * 90) % (playRect.height + 200) - 100;
        ctx.beginPath();
        ctx.moveTo(playRect.x + seedx, playRect.y + yOff);
        ctx.lineTo(playRect.x + seedx, playRect.y + yOff - 40 - intensity * 60);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawStick() {
      if (!stickVisual) return;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = PALETTE.machineGlass;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(stickVisual.x, stickVisual.y, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = PALETTE.machineGlass;
      ctx.beginPath();
      ctx.arc(stickVisual.x + stickVisual.dx, stickVisual.y + stickVisual.dy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- HUD -----------------------------------------------------------------
    function formatDepth(d) { return Math.floor(d / 4) + 'm'; }

    function drawHUD(snapshot, sessionBest) {
      var pad = playRect.width * 0.045;
      var top = playRect.y + pad * 0.8;

      // timer bar
      var barW = playRect.width - pad * 2;
      var barH = Math.max(10, playRect.height * 0.018);
      var frac = clamp(snapshot.remainingMs / 24000, 0, 1);
      var color = frac > 0.5 ? PALETTE.timerGood : frac > 0.22 ? PALETTE.timerWarn : PALETTE.timerBad;
      ctx.save();
      var lowPulse = frac <= 0.22 ? (0.7 + Math.sin(animTime * 10) * 0.3) : 1;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#000';
      roundRect(playRect.x + pad, top, barW, barH, barH / 2);
      ctx.fill();
      ctx.globalAlpha = lowPulse;
      ctx.fillStyle = color;
      roundRect(playRect.x + pad, top, barW * frac, barH, barH / 2);
      ctx.fill();
      ctx.restore();

      ctx.font = '600 ' + Math.round(playRect.width * 0.042) + 'px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.text;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(formatDepth(snapshot.depth), playRect.x + pad, top + barH + playRect.width * 0.075);

      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE.textDim;
      ctx.font = '500 ' + Math.round(playRect.width * 0.032) + 'px system-ui, sans-serif';
      ctx.fillText('score ' + Math.floor(snapshot.score), playRect.x + playRect.width - pad, top + barH + playRect.width * 0.07);
      if (sessionBest > 0) {
        ctx.fillText('best ' + Math.floor(sessionBest), playRect.x + playRect.width - pad, top + barH + playRect.width * 0.07 + playRect.width * 0.045);
      }

      var powered = snapshot.timeMs < snapshot.invincibleUntilMs;
      if (powered) {
        var remain = clamp((snapshot.invincibleUntilMs - snapshot.timeMs) / 6000, 0, 1);
        ctx.textAlign = 'center';
        ctx.fillStyle = PALETTE.power;
        ctx.font = '700 ' + Math.round(playRect.width * 0.038) + 'px system-ui, sans-serif';
        ctx.fillText('POWER', playRect.x + playRect.width / 2, top + barH + playRect.width * 0.075);
        ctx.globalAlpha = 0.9;
        roundRect(playRect.x + playRect.width / 2 - 30, top + barH + playRect.width * 0.09, 60 * remain, 4, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function roundRect(x, y, w, h, r) {
      w = Math.max(w, 0);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function drawReadyPrompt(snapshot, map) {
      readyPulse += 1 / 60;
      var p = map.machineScreen;
      var alpha = 0.35 + Math.sin(readyPulse * 3) * 0.25;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0.1, 0.7);
      ctx.strokeStyle = PALETTE.machineGlass;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      var yy = p.y + snapshot.playerRadius * map.ppu * 2.4 + Math.sin(readyPulse * 3) * 4;
      ctx.beginPath();
      ctx.moveTo(p.x - 10, yy - 6);
      ctx.lineTo(p.x, yy + 6);
      ctx.lineTo(p.x + 10, yy - 6);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = PALETTE.textDim;
      ctx.textAlign = 'center';
      ctx.font = '500 ' + Math.round(playRect.width * 0.034) + 'px system-ui, sans-serif';
      ctx.fillText('hold to dig', playRect.x + playRect.width / 2, playRect.y + playRect.height * 0.62);
      ctx.restore();
    }

    function drawGameOver(snapshot, sessionBest, isNewBest) {
      ctx.save();
      ctx.fillStyle = 'rgba(3,1,10,0.72)';
      ctx.fillRect(playRect.x, playRect.y, playRect.width, playRect.height);

      var cx = playRect.x + playRect.width / 2;
      var cy = playRect.y + playRect.height * 0.36;
      ctx.textAlign = 'center';

      ctx.fillStyle = PALETTE.textDim;
      ctx.font = '600 ' + Math.round(playRect.width * 0.05) + 'px system-ui, sans-serif';
      ctx.fillText('DIG COMPLETE', cx, cy - playRect.height * 0.1);

      ctx.fillStyle = PALETTE.text;
      ctx.font = '700 ' + Math.round(playRect.width * 0.15) + 'px system-ui, sans-serif';
      ctx.fillText(Math.floor(snapshot.score), cx, cy + playRect.height * 0.02);

      ctx.font = '500 ' + Math.round(playRect.width * 0.038) + 'px system-ui, sans-serif';
      ctx.fillStyle = isNewBest ? PALETTE.power : PALETTE.textDim;
      ctx.fillText(isNewBest ? 'new session best!' : ('best ' + Math.floor(sessionBest)), cx, cy + playRect.height * 0.08);

      // rank badge
      var badgeY = cy + playRect.height * 0.2;
      var badgeR = playRect.width * 0.12;
      var rankColors = { D: '#8a7ea6', C: '#5ff2b0', B: '#5fb8f2', A: '#ffcf3f', S: '#ff5d9e' };
      ctx.beginPath();
      ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = rankColors[snapshot.rank] || '#8a7ea6';
      ctx.shadowColor = rankColors[snapshot.rank] || '#8a7ea6';
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a0618';
      ctx.font = '800 ' + Math.round(badgeR * 1.1) + 'px system-ui, sans-serif';
      ctx.fillText(snapshot.rank || '-', cx, badgeY + badgeR * 0.35);

      var sig = snapshot.signature || {};
      var sigText;
      if (sig.closestShaveGap !== null && sig.closestShaveGap !== undefined) {
        sigText = 'closest shave: ' + sig.closestShaveGap.toFixed(1) + 'u clearance';
      } else if (sig.longestFullThrottleMs > 400) {
        sigText = 'longest full throttle: ' + (sig.longestFullThrottleMs / 1000).toFixed(1) + 's';
      } else {
        sigText = 'deepest reach: ' + formatDepth(sig.deepestDepth || snapshot.depth);
      }
      ctx.font = '500 ' + Math.round(playRect.width * 0.036) + 'px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.textDim;
      ctx.fillText(sigText, cx, badgeY + badgeR + playRect.height * 0.06);

      ctx.font = '500 ' + Math.round(playRect.width * 0.034) + 'px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.textDim;
      var t = 0.6 + Math.sin(animTime * 3) * 0.4;
      ctx.globalAlpha = clamp(t, 0.3, 1);
      ctx.fillText('tap or press R to dig again', cx, playRect.y + playRect.height * 0.88);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- event reactions -------------------------------------------------
    function trigger(kind, ev, snapshot, map) {
      var p = map.machineScreen;
      if (kind === 'wall_contact') {
        shake = Math.max(shake, 0.55); flash = 0.5; flashColor = PALETTE.wallEdge;
        machineCrumple = 1; machineFlinch = 0;
        spawnBurst(p.x, p.y, PALETTE.rock, 14, 130, 0.5);
      } else if (kind === 'rock_hit') {
        shake = Math.max(shake, 0.85); flash = 0.7; flashColor = PALETTE.danger;
        machineCrumple = 1; machineFlinch = 0;
        spawnBurst(p.x, p.y, PALETTE.rock, 22, 170, 0.6);
      } else if (kind === 'rock_broken') {
        shake = Math.max(shake, 0.25);
        spawnBurst(p.x, p.y, PALETTE.power, 18, 150, 0.5);
      } else if (kind === 'fragment') {
        spawnBurst(p.x, p.y, PALETTE.fragment, 12, 90, 0.45);
      } else if (kind === 'power') {
        spawnBurst(p.x, p.y, PALETTE.power, 30, 160, 0.7);
        flash = 0.4; flashColor = PALETTE.power;
      } else if (kind === 'near_miss') {
        comboLevel = clamp(comboLevel + 1, 0, 6);
        comboTimer = 1.4;
        machineFlinch = 1;
        spawnBurst(p.x, p.y, PALETTE.machineGlass, 6 + comboLevel * 2, 80 + comboLevel * 20, 0.35);
      }
    }

    function drawFlash() {
      if (flash <= 0) return;
      ctx.save();
      ctx.globalAlpha = flash * 0.35;
      ctx.fillStyle = flashColor;
      ctx.fillRect(playRect.x, playRect.y, playRect.width, playRect.height);
      ctx.restore();
    }

    function draw(snapshot, sessionBest, isNewBest, dt) {
      animTime += dt;
      updateParticles(dt);
      var map = mapper(snapshot);

      ctx.save();
      if (shake > 0.001) {
        ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
      }
      drawBackground(snapshot);
      drawCorridor(snapshot, map);
      drawRocks(snapshot, map);
      drawItems(snapshot, map);
      drawSpeedLines(snapshot, map);
      drawMachine(snapshot, map);
      drawParticles();
      drawFlash();
      ctx.restore();

      if (snapshot.phase === 'ready') drawReadyPrompt(snapshot, map);
      drawHUD(snapshot, sessionBest);
      drawStick();

      if (snapshot.phase === 'gameover') drawGameOver(snapshot, sessionBest, isNewBest);

      // low-time vignette
      if (snapshot.phase === 'playing' && snapshot.remainingMs < 24000 * 0.22) {
        var pulse = 0.15 + Math.sin(animTime * 9) * 0.1;
        ctx.save();
        var vg = ctx.createRadialGradient(
          playRect.x + playRect.width / 2, playRect.y + playRect.height / 2, playRect.height * 0.3,
          playRect.x + playRect.width / 2, playRect.y + playRect.height / 2, playRect.height * 0.75
        );
        vg.addColorStop(0, 'rgba(255,93,115,0)');
        vg.addColorStop(1, 'rgba(255,93,115,' + clamp(pulse, 0, 0.4) + ')');
        ctx.fillStyle = vg;
        ctx.fillRect(playRect.x, playRect.y, playRect.width, playRect.height);
        ctx.restore();
      }
    }

    function reset() {
      particles = []; shake = 0; flash = 0; comboLevel = 0; comboTimer = 0;
      machineFlinch = 0; machineCrumple = 0; readyPulse = 0;
    }

    function getPlayRect() { return playRect; }

    resize();

    return {
      resize: resize,
      draw: draw,
      trigger: trigger,
      reset: reset,
      setStickVisual: setStickVisual,
      getPlayRect: getPlayRect,
      worldViewWidth: WORLD_VIEW_WIDTH,
      machineYFrac: MACHINE_Y_FRAC
    };
  }

  global.DelveRender = { createRenderer: createRenderer };
})(typeof window !== 'undefined' ? window : this);
