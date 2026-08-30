/* EMBER renderer: all view-only. Never mutates sim state, never influences it.
 * Reads a snapshot() each frame and draws a composed scene + HUD.
 */
(function (root) {
  'use strict';

  var WORLD_WIDTH = 280;
  var VIEW_HEIGHT = 500; // world units of vertical view window

  var PAL = {
    bgTop: '#0a0714',
    bgMid: '#160f28',
    bgNearPlayer: '#241a3a',
    wall: '#33254a',
    wallDeep: '#221934',
    wallHighlight: '#5a3f74',
    ledgeBody: '#443257',
    ledgeTop: '#e8b874',
    ledgeCrack: '#ff8a3d',
    damp0: '#0c332c',
    damp1: '#155447',
    damp2: '#7be0c4',
    dampWarn: '#ff5a4d',
    sparkCore: '#ffe08a',
    sparkMid: '#ff9d4d',
    sparkEdge: '#c9502f',
    glimmer: '#ffd23f',
    glimmerCore: '#fff6cf',
    moth: '#cdb9e6',
    mothWing: '#a487c9',
    text: '#ffedd2',
    textDim: 'rgba(255,237,210,0.62)'
  };

  function fract(x) { return x - Math.floor(x); }
  function hash1(n) { return fract(Math.sin(n * 12.9898) * 43758.5453); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function createRenderer(canvas) {
    var ctx = canvas.getContext('2d');
    var camera = { y: -60, ready: false };
    var particles = [];
    var seenEventTick = -1;
    var flashBurst = 0, flashLand = 0, flashGlimmer = 0, flashChain = 0, flashGameOver = 0;
    var chainFlashCount = 0;
    var breathT = 0;
    var idleBlink = 0;
    var readyPulseT = 0;
    var hasEverDragged = false;
    var lastRankSeen = null;
    var prevItemActive = Object.create(null);

    function worldScale() { return canvas.width / WORLD_WIDTH; }

    function toScreen(scale, wx, wy) {
      return {
        x: wx * scale,
        y: canvas.height - (wy - camera.y) * scale
      };
    }

    function spawnParticles(list) {
      for (var i = 0; i < list.length; i++) particles.push(list[i]);
      if (particles.length > 260) particles.splice(0, particles.length - 260);
    }

    function burstParticles(wx, wy, opts) {
      var n = opts.n || 10;
      var out = [];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = lerp(opts.minSpeed || 20, opts.maxSpeed || 120, Math.random());
        out.push({
          x: wx, y: wy,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: lerp(opts.minLife || 0.3, opts.maxLife || 0.7, Math.random()),
          size: lerp(opts.minSize || 1.5, opts.maxSize || 4, Math.random()),
          color: opts.color || '#ffd23f',
          grav: opts.grav != null ? opts.grav : -180,
          fade: true
        });
      }
      spawnParticles(out);
    }

    function updateParticles(dt) {
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
        p.vy += (p.grav || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    function drawParticles(scale) {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        var t = p.life / p.maxLife;
        var alpha = p.fade ? (1 - t) : 1;
        var pos = toScreen(scale, p.x, p.y);
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, Math.max(0.4, p.size * (1 - t * 0.4)) * scale * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---------- background ----------
    function drawBackground(scale, snap, tSec) {
      var g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, PAL.bgTop);
      g.addColorStop(0.55, PAL.bgMid);
      g.addColorStop(1, PAL.bgNearPlayer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // distant depth bands (parallax, procedural, infinite via hashed cells)
      var bandH = 46;
      var topWorld = camera.y + VIEW_HEIGHT + 40;
      var botWorld = camera.y - 40;
      var startCell = Math.floor(botWorld / bandH);
      var endCell = Math.ceil(topWorld / bandH);
      for (var c = startCell; c <= endCell; c++) {
        var h1 = hash1(c * 3.1 + 0.7);
        var wy = c * bandH + h1 * bandH * 0.5;
        var depth = 0.4 + hash1(c * 7.7) * 0.6;
        var wx = hash1(c * 1.9) * WORLD_WIDTH;
        var pos = toScreen(scale, wx, wy - (tSec * 3 * depth) % bandH);
        var r = (1.2 + hash1(c * 5.3) * 2.2) * scale * 0.16 * depth;
        ctx.globalAlpha = 0.10 + depth * 0.10;
        ctx.fillStyle = '#caa8ff';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // soft warm vignette glow tracking player height (sells "living" depth)
      var centerPos = toScreen(scale, WORLD_WIDTH / 2, snap.player.y + 40);
      var rg = ctx.createRadialGradient(centerPos.x, centerPos.y, 10, centerPos.x, centerPos.y, canvas.height * 0.75);
      rg.addColorStop(0, 'rgba(255,150,80,0.10)');
      rg.addColorStop(1, 'rgba(255,150,80,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ---------- walls ----------
    function drawWalls(scale, snap, tSec) {
      var leftPx = snap.wallLeftX * scale;
      var rightPx = snap.wallRightX * scale;

      var lg = ctx.createLinearGradient(0, 0, leftPx, 0);
      lg.addColorStop(0, PAL.wallDeep);
      lg.addColorStop(1, PAL.wall);
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, leftPx, canvas.height);

      var rg = ctx.createLinearGradient(rightPx, 0, canvas.width, 0);
      rg.addColorStop(0, PAL.wall);
      rg.addColorStop(1, PAL.wallDeep);
      ctx.fillStyle = rg;
      ctx.fillRect(rightPx, 0, canvas.width - rightPx, canvas.height);

      // inner face highlight (rim light, sells depth of the shaft)
      ctx.fillStyle = 'rgba(255,190,130,0.10)';
      ctx.fillRect(leftPx - 2 * scale * 0.14, 0, 2 * scale * 0.14, canvas.height);
      ctx.fillRect(rightPx, 0, 2 * scale * 0.14, canvas.height);

      // soot streaks texture (hashed, parallax-stable per world band)
      var bandH = 34;
      var startCell = Math.floor((camera.y - 20) / bandH);
      var endCell = Math.ceil((camera.y + VIEW_HEIGHT + 20) / bandH);
      for (var side = 0; side < 2; side++) {
        for (var c = startCell; c <= endCell; c++) {
          var h = hash1(c * 4.2 + side * 91.3);
          if (h > 0.62) continue;
          var wy = c * bandH + hash1(c * 2.2 + side) * bandH;
          var pos = toScreen(scale, 0, wy);
          var len = (10 + hash1(c * 9.1) * 22) * scale * 0.14;
          var xBase = side === 0 ? leftPx * (0.25 + hash1(c) * 0.5) : rightPx + (canvas.width - rightPx) * (0.25 + hash1(c + 3) * 0.5);
          ctx.strokeStyle = 'rgba(10,6,18,0.35)';
          ctx.lineWidth = Math.max(1, scale * 0.02);
          ctx.beginPath();
          ctx.moveTo(xBase, pos.y);
          ctx.lineTo(xBase, pos.y + len);
          ctx.stroke();
        }
      }
    }

    // ---------- ledges ----------
    function drawLedge(scale, ledge, tSec) {
      var cx = toScreen(scale, ledge.position.x, ledge.position.y);
      var w = ledge.halfWidth * 2 * scale;
      var h = 12 * scale * 0.16 + 6;
      var x0 = cx.x - ledge.halfWidth * scale;

      ctx.fillStyle = PAL.ledgeBody;
      roundRect(x0, cx.y, w, h, 6);
      ctx.fill();

      ctx.fillStyle = PAL.ledgeTop;
      ctx.globalAlpha = 0.85;
      roundRect(x0, cx.y, w, Math.max(2, h * 0.28), 4);
      ctx.fill();
      ctx.globalAlpha = 1;

      // ember cracks glow, gentle pulse
      var pulse = 0.5 + 0.5 * Math.sin(tSec * 1.6 + ledge.id * 1.7);
      ctx.fillStyle = PAL.ledgeCrack;
      ctx.globalAlpha = 0.18 + pulse * 0.22;
      var crackX = x0 + w * (0.3 + hash1(ledge.id * 3.3) * 0.4);
      ctx.beginPath();
      ctx.arc(crackX, cx.y + h * 0.5, Math.max(1.5, h * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // ---------- glimmer ----------
    function drawGlimmer(scale, item, tSec) {
      if (!item.active) return;
      var pos = toScreen(scale, item.position.x, item.position.y);
      var r = item.visualRadius * scale * 0.16;
      var spin = tSec * 1.8 + item.id;
      var pulse = 0.75 + 0.25 * Math.sin(tSec * 3 + item.id * 2.1);

      var glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 3.2);
      glow.addColorStop(0, 'rgba(255,210,63,' + (0.35 * pulse) + ')');
      glow.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(spin);
      ctx.fillStyle = PAL.glimmer;
      drawFacetStar(r * pulse, 4);
      ctx.rotate(-spin * 2);
      ctx.fillStyle = PAL.glimmerCore;
      drawFacetStar(r * 0.5 * pulse, 4);
      ctx.restore();
    }

    function drawFacetStar(r, points) {
      ctx.beginPath();
      for (var i = 0; i < points * 2; i++) {
        var ang = (Math.PI / points) * i;
        var rad = i % 2 === 0 ? r : r * 0.42;
        var x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }

    // ---------- moth ----------
    function drawMoth(scale, item, tSec) {
      if (!item.active) return;
      var pos = toScreen(scale, item.position.x, item.position.y);
      var r = item.visualRadius * scale * 0.16;
      var wingPhase = Math.sin(tSec * 11 + item.id * 3.3);
      var wingSpread = 0.4 + 0.6 * Math.abs(wingPhase);

      ctx.save();
      ctx.translate(pos.x, pos.y);

      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
      glow.addColorStop(0, 'rgba(205,185,230,0.22)');
      glow.addColorStop(1, 'rgba(205,185,230,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
      ctx.fill();

      // wings
      ctx.fillStyle = PAL.mothWing;
      ctx.globalAlpha = 0.85;
      drawWing(r, wingSpread, 1);
      drawWing(r, wingSpread, -1);
      ctx.globalAlpha = 1;

      // body
      ctx.fillStyle = PAL.moth;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.34, r * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();

      // antennae
      ctx.strokeStyle = PAL.mothWing;
      ctx.lineWidth = Math.max(0.6, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, -r * 0.5);
      ctx.quadraticCurveTo(-r * 0.4, -r * 0.9, -r * 0.5, -r * 1.1);
      ctx.moveTo(r * 0.12, -r * 0.5);
      ctx.quadraticCurveTo(r * 0.4, -r * 0.9, r * 0.5, -r * 1.1);
      ctx.stroke();

      ctx.restore();
    }

    function drawWing(r, spread, side) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1);
      ctx.quadraticCurveTo(r * (0.9 + spread * 0.6), -r * (0.7 + spread * 0.5), r * (0.3 + spread * 0.3), r * 0.4);
      ctx.quadraticCurveTo(r * 0.2, r * 0.1, 0, r * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ---------- damp ----------
    function drawDamp(scale, snap, tSec) {
      var topScreenY = toScreen(scale, 0, snap.dampY).y;
      if (topScreenY > canvas.height + 60) return; // far below view, skip

      var waveH = 10 * scale * 0.16;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, canvas.height + 20);
      var steps = 24;
      for (var i = 0; i <= steps; i++) {
        var wx = (i / steps) * canvas.width;
        var w1 = Math.sin(wx * 0.02 + tSec * 1.3) * waveH;
        var w2 = Math.sin(wx * 0.045 - tSec * 2.1) * waveH * 0.5;
        var y = topScreenY + w1 + w2;
        ctx.lineTo(wx, y);
      }
      ctx.lineTo(canvas.width, canvas.height + 20);
      ctx.closePath();

      var dg = ctx.createLinearGradient(0, topScreenY - 20, 0, canvas.height + 20);
      dg.addColorStop(0, PAL.damp2);
      dg.addColorStop(0.15, PAL.damp1);
      dg.addColorStop(1, PAL.damp0);
      ctx.fillStyle = dg;
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;

      // hazard rim
      ctx.strokeStyle = 'rgba(123,224,196,0.55)';
      ctx.lineWidth = Math.max(1, scale * 0.03);
      ctx.stroke();

      // reaching tendrils
      for (var t = 0; t < 4; t++) {
        var tx = ((hash1(t * 5.5 + Math.floor(tSec * 0.4)) + tSec * 0.05) % 1) * canvas.width;
        var reach = (6 + 10 * Math.abs(Math.sin(tSec * 0.9 + t * 2))) * scale * 0.16;
        ctx.fillStyle = 'rgba(123,224,196,0.25)';
        ctx.beginPath();
        ctx.ellipse(tx, topScreenY - reach * 0.4, reach * 0.5, reach, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---------- player (the spark) ----------
    function computeExpression(snap, tSec) {
      if (snap.phase === 'gameover') return 'gone';
      if (flashBurst > 0) return 'burst';
      if (snap.input.dragging) return 'aim';
      if (snap.player.anchored && snap.player.anchorKind === 'wall') return 'cling';
      if (!snap.player.anchored && snap.jumpsLeft <= 0) return 'fallEmpty';
      if (!snap.player.anchored) return 'flight';
      return 'rest';
    }

    function drawPlayer(scale, snap, tSec, dt) {
      var p = snap.player;
      var pos = toScreen(scale, p.x, p.y);
      var r = p.playerRadius * scale * 0.16;
      var expr = computeExpression(snap, tSec);

      var speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      var stretch = expr === 'flight' ? clamp(speed / 800, 0, 1) : 0;
      var ang = Math.atan2(-p.vy, p.vx);

      breathT += dt;
      idleBlink += dt;
      var blink = (idleBlink % 3.2) > 3.05 ? 0.15 : 1;
      var bob = expr === 'rest' ? Math.sin(breathT * 2.1) * 1.4 : 0;

      ctx.save();
      ctx.translate(pos.x, pos.y - bob * scale * 0.16);

      if (expr === 'gone') {
        var fadeT = clamp(flashGameOver / 0.9, 0, 1);
        ctx.globalAlpha = 1 - fadeT;
        ctx.scale(1 + fadeT * 0.6, 1 + fadeT * 0.6);
      }

      if (stretch > 0.02) {
        ctx.rotate(ang);
        ctx.scale(1 + stretch * 0.55, 1 - stretch * 0.32);
        ctx.rotate(-ang);
      }
      if (expr === 'cling') {
        ctx.scale(1.12, 0.88);
      }
      if (expr === 'aim') {
        var pull = Math.min(1, Math.sqrt(snap.input.dx * snap.input.dx + snap.input.dy * snap.input.dy) / 140);
        ctx.scale(1 - pull * 0.18, 1 + pull * 0.22);
      }
      if (expr === 'burst') {
        var bt = 1 - clamp(flashBurst / 0.18, 0, 1);
        ctx.scale(1.35 - bt * 0.35, 1.35 - bt * 0.35);
      }

      // trailing motion streak during flight
      if (expr === 'flight' && speed > 60) {
        ctx.save();
        ctx.rotate(ang);
        var glowTrail = ctx.createLinearGradient(-r * (2 + stretch * 3), 0, 0, 0);
        glowTrail.addColorStop(0, 'rgba(255,157,77,0)');
        glowTrail.addColorStop(1, 'rgba(255,157,77,0.45)');
        ctx.fillStyle = glowTrail;
        ctx.beginPath();
        ctx.ellipse(-r * (1 + stretch * 1.4), 0, r * (1.6 + stretch * 2.2), r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // outer glow
      var glowR = r * (expr === 'burst' ? 3.4 : 2.4);
      var glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
      var glowColor = expr === 'gone' ? '150,150,160' : '255,157,77';
      glow.addColorStop(0, 'rgba(' + glowColor + ',0.5)');
      glow.addColorStop(1, 'rgba(' + glowColor + ',0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, glowR, 0, Math.PI * 2);
      ctx.fill();

      // core body
      var core = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
      if (expr === 'gone') {
        core.addColorStop(0, '#8a8a96');
        core.addColorStop(1, '#3c3c46');
      } else {
        core.addColorStop(0, PAL.sparkCore);
        core.addColorStop(0.55, PAL.sparkMid);
        core.addColorStop(1, PAL.sparkEdge);
      }
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // flicker spikes on top (alive, flame-like)
      if (expr !== 'gone') {
        ctx.fillStyle = PAL.sparkCore;
        ctx.globalAlpha = 0.85;
        for (var i = -1; i <= 1; i++) {
          var fx = i * r * 0.42;
          var fh = r * (0.55 + 0.25 * Math.sin(tSec * 6 + i * 2));
          ctx.beginPath();
          ctx.moveTo(fx - r * 0.16, -r * 0.7);
          ctx.quadraticCurveTo(fx, -r * 0.7 - fh, fx + r * 0.16, -r * 0.7);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // face
      if (expr !== 'gone') drawFace(r, expr, blink, tSec);
      else drawFaceGone(r);

      ctx.restore();
    }

    function drawFace(r, expr, blink, tSec) {
      ctx.fillStyle = '#2a1408';
      var eyeDX = r * 0.32, eyeDY = -r * 0.08;
      var eyeR = r * 0.16;

      if (expr === 'aim') {
        eyeR *= 1.15;
      } else if (expr === 'fallEmpty') {
        eyeR *= 1.4;
      } else if (expr === 'burst') {
        eyeR *= 1.3;
      } else if (expr === 'cling') {
        eyeDY += r * 0.05;
      }

      // eyes
      ctx.beginPath();
      ctx.ellipse(-eyeDX, eyeDY, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      ctx.ellipse(eyeDX, eyeDY, eyeR, eyeR * blink, 0, 0, Math.PI * 2);
      ctx.fill();

      // brows (only visible in some states, subtle)
      if (expr === 'cling' || expr === 'fallEmpty') {
        ctx.strokeStyle = '#2a1408';
        ctx.lineWidth = Math.max(0.6, r * 0.08);
        ctx.beginPath();
        var bAng = expr === 'cling' ? 0.35 : -0.15;
        ctx.moveTo(-eyeDX - eyeR, eyeDY - eyeR * 1.6);
        ctx.lineTo(-eyeDX + eyeR * 0.5, eyeDY - eyeR * (1.6 + bAng));
        ctx.moveTo(eyeDX + eyeR, eyeDY - eyeR * 1.6);
        ctx.lineTo(eyeDX - eyeR * 0.5, eyeDY - eyeR * (1.6 + bAng));
        ctx.stroke();
      }

      // mouth
      ctx.strokeStyle = '#2a1408';
      ctx.lineWidth = Math.max(0.7, r * 0.1);
      ctx.beginPath();
      var mY = r * 0.32;
      if (expr === 'rest') {
        ctx.arc(0, mY - r * 0.12, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
      } else if (expr === 'aim') {
        ctx.arc(0, mY, r * 0.16, 0, Math.PI * 2);
      } else if (expr === 'flight') {
        ctx.ellipse(0, mY, r * 0.14, r * 0.2, 0, 0, Math.PI * 2);
      } else if (expr === 'burst') {
        ctx.arc(0, mY - r * 0.15, r * 0.26, 0.1 * Math.PI, 0.9 * Math.PI);
      } else if (expr === 'cling') {
        ctx.moveTo(-r * 0.16, mY);
        ctx.lineTo(r * 0.16, mY);
      } else if (expr === 'fallEmpty') {
        ctx.ellipse(0, mY + r * 0.05, r * 0.12, r * 0.22, 0, 0, Math.PI * 2);
      }
      if (expr === 'aim' || expr === 'flight' || expr === 'fallEmpty') ctx.fill();
      else ctx.stroke();
    }

    function drawFaceGone(r) {
      ctx.strokeStyle = '#4a4a54';
      ctx.lineWidth = Math.max(0.7, r * 0.1);
      var d = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -d); ctx.lineTo(-r * 0.4 + d * 1.4, d);
      ctx.moveTo(-r * 0.4 + d * 1.4, -d); ctx.lineTo(-r * 0.4, d);
      ctx.moveTo(r * 0.16, -d); ctx.lineTo(r * 0.16 + d * 1.4, d);
      ctx.moveTo(r * 0.16 + d * 1.4, -d); ctx.lineTo(r * 0.16, d);
      ctx.stroke();
    }

    // ---------- aim / sling visualization ----------
    function drawSling(scale, snap, worldDx, worldDy) {
      if (!snap.input.dragging) return;
      var p = snap.player;
      var dist = Math.sqrt(worldDx * worldDx + worldDy * worldDy);
      var dead = 10;
      if (dist < dead) return;
      var pull = Math.min(1, (dist - dead) / (118 - dead));
      var pos = toScreen(scale, p.x, p.y);
      var dirX = -worldDx / dist, dirY = -worldDy / dist;
      var len = (18 + pull * 46) * scale * 0.16;
      var endX = pos.x + dirX * len;
      var endY = pos.y - dirY * len;

      ctx.save();
      ctx.strokeStyle = snap.jumpsLeft > 0 ? 'rgba(255,209,102,' + (0.35 + pull * 0.45) + ')' : 'rgba(150,150,160,0.4)';
      ctx.lineWidth = Math.max(1.5, scale * 0.05) * (1 - pull * 0.3);
      ctx.setLineDash([scale * 0.06, scale * 0.05]);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,209,102,' + (0.5 + pull * 0.5) + ')';
      ctx.beginPath();
      ctx.arc(endX, endY, Math.max(2, scale * 0.045 * (0.6 + pull)), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---------- HUD ----------
    function drawHud(scale, snap, tSec) {
      var pad = Math.min(canvas.width, canvas.height) * 0.035;

      // glow pips (top-left)
      var pipR = canvas.width * 0.028;
      for (var i = 0; i < snap.jumpCapacity; i++) {
        var cx = pad + pipR + i * (pipR * 2.35);
        var cy = pad + pipR;
        var filled = i < snap.jumpsLeft;
        ctx.beginPath();
        ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
        if (filled) {
          var g = ctx.createRadialGradient(cx - pipR * 0.3, cy - pipR * 0.3, 1, cx, cy, pipR);
          g.addColorStop(0, PAL.sparkCore);
          g.addColorStop(1, PAL.sparkEdge);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
        }
        ctx.fill();
        ctx.lineWidth = Math.max(1, pipR * 0.12);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();
      }

      // score / height (top-right)
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = flashGlimmer > 0 ? PAL.glimmer : PAL.text;
      ctx.font = '700 ' + Math.round(canvas.width * (flashGlimmer > 0 ? 0.07 : 0.062)) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillText(String(snap.score), canvas.width - pad, pad * 0.6);
      ctx.fillStyle = PAL.textDim;
      ctx.font = '600 ' + Math.round(canvas.width * 0.03) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillText('height ' + Math.max(0, Math.round(snap.height)), canvas.width - pad, pad * 0.6 + canvas.width * 0.068);

      // chain badge
      if (snap.chainCount > 0 || flashChain > 0) {
        var n = snap.chainCount > 0 ? snap.chainCount : chainFlashCount;
        var scalePulse = 1 + Math.min(0.5, n * 0.045) + (flashChain > 0 ? (flashChain / 0.22) * 0.35 : 0);
        var hue = clamp(38 - n * 2.4, -10, 38);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.translate(canvas.width / 2, pad * 1.4);
        ctx.scale(scalePulse, scalePulse);
        ctx.fillStyle = 'hsl(' + hue + ',95%,64%)';
        ctx.font = '800 ' + Math.round(canvas.width * 0.075) + 'px system-ui,-apple-system,sans-serif';
        ctx.fillText('×' + n, 0, 0);
        ctx.restore();
      }

      // damp proximity vignette
      var gap = clamp((p_lastY - snap.dampY) / 260, 0, 1);
      var danger = 1 - gap;
      if (danger > 0.15) {
        var vg = ctx.createRadialGradient(canvas.width / 2, canvas.height, canvas.height * 0.15, canvas.width / 2, canvas.height, canvas.height * 0.85);
        vg.addColorStop(0, 'rgba(255,60,50,' + (danger * 0.4) + ')');
        vg.addColorStop(1, 'rgba(255,60,50,0)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // ready-state affordance (no text tutorial — a soft inviting pulse)
      if (snap.phase === 'ready' && !hasEverDragged) {
        readyPulseT += 0;
        var pos = toScreen(scale, snap.player.x, snap.player.y);
        var pr = (18 + 6 * Math.sin(tSec * 2.4)) * scale * 0.16;
        ctx.strokeStyle = 'rgba(255,224,138,' + (0.28 + 0.14 * Math.sin(tSec * 2.4)) + ')';
        ctx.lineWidth = Math.max(1, scale * 0.03);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, pr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    var p_lastY = 0;

    function rankColor(grade) {
      switch (grade) {
        case 'Starfall': return '#9ad7ff';
        case 'Aurora': return '#c9a4ff';
        case 'Wildfire': return '#ff8a3d';
        case 'Blaze': return '#ff5a4d';
        case 'Ember': return '#ffcf6b';
        default: return '#d8c9ff';
      }
    }

    function drawEndScreen(scale, snap, tSec) {
      ctx.fillStyle = 'rgba(6,4,12,0.62)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      var cw = canvas.width * 0.84;
      var ch = canvas.height * 0.52;
      var cx = (canvas.width - cw) / 2;
      var cy = (canvas.height - ch) / 2 - canvas.height * 0.02;

      ctx.save();
      ctx.shadowColor = 'rgba(255,150,80,0.25)';
      ctx.shadowBlur = canvas.width * 0.05;
      ctx.fillStyle = 'rgba(28,19,44,0.92)';
      roundRect(cx, cy, cw, ch, cw * 0.045);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,190,130,0.22)';
      ctx.lineWidth = 1.5;
      roundRect(cx, cy, cw, ch, cw * 0.045);
      ctx.stroke();

      var midX = cx + cw / 2;
      var yWalk = cy + ch * 0.14;

      ctx.textAlign = 'center';
      ctx.fillStyle = PAL.textDim;
      ctx.font = '600 ' + Math.round(cw * 0.045) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillText('the damp took the spark', midX, yWalk);

      yWalk += ch * 0.13;
      ctx.fillStyle = PAL.text;
      ctx.font = '800 ' + Math.round(cw * 0.16) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillText(String(snap.score), midX, yWalk);

      yWalk += ch * 0.155;
      ctx.font = '600 ' + Math.round(cw * 0.042) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillStyle = PAL.textDim;
      ctx.fillText('session best ' + snap.sessionBest + '   ·   best chain ×' + snap.chainBest, midX, yWalk);

      yWalk += ch * 0.14;
      var grade = snap.rank || 'Cinder';
      ctx.font = '800 ' + Math.round(cw * 0.09) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillStyle = rankColor(grade);
      ctx.fillText(grade, midX, yWalk);

      var promptY = cy + ch - ch * 0.13;
      var pulse = 0.55 + 0.45 * Math.sin(tSec * 3);
      ctx.font = '600 ' + Math.round(cw * 0.036) + 'px system-ui,-apple-system,sans-serif';
      ctx.fillStyle = 'rgba(255,237,210,' + pulse + ')';
      ctx.fillText('tap to climb again', midX, promptY);
    }

    // ---------- main draw ----------
    function draw(snap, dtMs, worldDx, worldDy) {
      var dt = Math.min(0.05, dtMs / 1000);
      var scale = worldScale();
      var tSec = snap.elapsedMs / 1000;

      if (!camera.ready) { camera.y = snap.player.y - VIEW_HEIGHT * 0.36; camera.ready = true; }
      var targetCamY = Math.max(-150, snap.player.y - VIEW_HEIGHT * 0.36);
      camera.y += (targetCamY - camera.y) * Math.min(1, dt * 5.2);
      p_lastY = snap.player.y;

      if (snap.input.dragging) hasEverDragged = true;

      // event-driven transient flashes + particle bursts.
      // Note: per spec, 'chain' always overwrites a same-tick 'bounce'/midair 'launch' in
      // lastEvent, and 'chainBank' always overwrites a same-tick 'land'. So bounce/land are
      // detected robustly via each item's own active flag and via chainBank implying a land,
      // rather than by trusting lastEvent.kind to ever equal 'bounce' after a chained burst.
      var pp = snap.player;
      for (var ii = 0; ii < snap.items.length; ii++) {
        var it = snap.items[ii];
        var was = prevItemActive[it.id];
        if (was === true && it.active === false) {
          if (it.type === 'moth') {
            flashBurst = 0.18;
            burstParticles(it.position.x, it.position.y, { n: 14, color: PAL.moth, minSpeed: 40, maxSpeed: 160, maxLife: 0.5, minSize: 1.5, maxSize: 3.5 });
          } else {
            flashGlimmer = 0.3;
            burstParticles(it.position.x, it.position.y, { n: 16, color: PAL.glimmer, minSpeed: 30, maxSpeed: 140, maxLife: 0.55, minSize: 1.5, maxSize: 3.2, grav: -40 });
          }
        }
        prevItemActive[it.id] = it.active;
      }

      if (snap.lastEvent && snap.lastEvent.tick !== seenEventTick) {
        seenEventTick = snap.lastEvent.tick;
        if (snap.lastEvent.kind === 'land' || snap.lastEvent.kind === 'chainBank') {
          flashLand = 0.3;
          burstParticles(pp.x, pp.y - pp.playerRadius * 0.6, { n: 10, color: '#cbb28f', minSpeed: 10, maxSpeed: 60, maxLife: 0.4, grav: 60 });
        }
        if (snap.lastEvent.kind === 'chainBank') {
          burstParticles(pp.x, pp.y, { n: Math.min(40, 12 + snap.chainBest * 3), color: '#ffcf6b', minSpeed: 50, maxSpeed: 180, maxLife: 0.6, minSize: 2, maxSize: 4 });
        }
        if (snap.lastEvent.kind === 'chain') {
          flashChain = 0.22;
          chainFlashCount = snap.chainCount;
          var n = Math.min(30, 6 + snap.chainCount * 3);
          burstParticles(pp.x, pp.y, { n: n, color: 'hsl(' + clamp(38 - snap.chainCount * 2.4, -10, 38) + ',95%,64%)', minSpeed: 40, maxSpeed: 90 + snap.chainCount * 12, maxLife: 0.4 + snap.chainCount * 0.02, minSize: 1.5, maxSize: 2.6 + snap.chainCount * 0.25 });
        }
      }
      if (snap.phase === 'gameover' && lastRankSeen !== snap.rank) {
        lastRankSeen = snap.rank;
        flashGameOver = 0.001; // start the fade
        burstParticles(snap.player.x, snap.player.y, { n: 22, color: '#7a7a86', minSpeed: 10, maxSpeed: 70, maxLife: 1.1, grav: -20, minSize: 1.5, maxSize: 3.4 });
      }
      if (snap.phase !== 'gameover') { flashGameOver = 0; lastRankSeen = null; }
      else if (flashGameOver > 0) flashGameOver = Math.min(0.95, flashGameOver + dt);

      flashBurst = Math.max(0, flashBurst - dt);
      flashLand = Math.max(0, flashLand - dt);
      flashGlimmer = Math.max(0, flashGlimmer - dt);
      flashChain = Math.max(0, flashChain - dt);

      updateParticles(dt);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(scale, snap, tSec);
      drawWalls(scale, snap, tSec);

      for (var i = 0; i < snap.ledges.length; i++) drawLedge(scale, snap.ledges[i], tSec);
      for (var j = 0; j < snap.items.length; j++) {
        var it = snap.items[j];
        if (!it.active) continue;
        if (it.type === 'glimmer') drawGlimmer(scale, it, tSec);
        else drawMoth(scale, it, tSec);
      }

      drawDamp(scale, snap, tSec);
      drawParticles(scale);
      drawSling(scale, snap, worldDx || 0, worldDy || 0);
      drawPlayer(scale, snap, tSec, dt);

      drawHud(scale, snap, tSec);

      if (snap.phase === 'gameover') drawEndScreen(scale, snap, tSec);
    }

    function getCameraY() { return camera.y; }

    function resetView() {
      particles.length = 0;
      camera.ready = false;
      flashBurst = 0; flashLand = 0; flashGlimmer = 0; flashChain = 0; flashGameOver = 0;
      seenEventTick = -1;
      lastRankSeen = null;
      hasEverDragged = false;
      prevItemActive = Object.create(null);
    }

    return { draw: draw, getCameraY: getCameraY, resetView: resetView };
  }

  root.Ember = root.Ember || {};
  root.Ember.createRenderer = createRenderer;
  root.Ember.VIEW_HEIGHT = VIEW_HEIGHT;
  root.Ember.WORLD_WIDTH = WORLD_WIDTH;
})(typeof window !== 'undefined' ? window : this);
