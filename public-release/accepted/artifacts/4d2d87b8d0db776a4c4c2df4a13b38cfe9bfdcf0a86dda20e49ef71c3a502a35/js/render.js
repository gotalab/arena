'use strict';

const Renderer = (() => {
  const PORTRAIT_W = 360;
  const PORTRAIT_H = 640;

  const PAL = {
    bgDeep: '#0c0a14',
    bgMid: '#16101f',
    wall: '#2a1f35',
    wallEdge: '#4a3560',
    ledge: '#3d2e4a',
    ledgeTop: '#6b4f7a',
    ledgeGlow: '#ff8c42',
    sparkCore: '#ffe566',
    sparkHot: '#ff6b2b',
    sparkEye: '#2a1020',
    mothBody: '#8a7a90',
    mothWing: '#b8a0c8',
    glimmer: '#7ee8ff',
    glimmerCore: '#ffffff',
    damp: '#1a3048',
    dampFoam: '#3a6888',
    dampMist: '#5a98b8',
    uiText: '#f0e6d8',
    uiDim: '#9a8a9a',
    chain: '#ffaa44',
  };

  let canvas, ctx;
  let viewW = 0;
  let viewH = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let chainFlash = 0;
  let landFlash = 0;
  let time = 0;

  function init(cvs) {
    canvas = cvs;
    ctx = canvas.getContext('2d');
  }

  function resize() {
    const shell = canvas.parentElement;
    const sw = shell.clientWidth;
    const sh = shell.clientHeight;
    const aspect = PORTRAIT_W / PORTRAIT_H;
    let dw, dh;
    if (sw / sh < aspect) {
      dw = sw;
      dh = sw / aspect;
    } else {
      dh = sh;
      dw = sh * aspect;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(dw * dpr);
    canvas.height = Math.floor(dh * dpr);
    canvas.style.width = `${dw}px`;
    canvas.style.height = `${dh}px`;
    viewW = dw;
    viewH = dh;
    scale = dw / PORTRAIT_W;
    offsetX = 0;
    offsetY = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function worldToScreen(wx, wy, camY) {
    const sx = (wx / PORTRAIT_W) * viewW;
    const sy = viewH * 0.62 - (wy - camY) * (viewH / PORTRAIT_H) * 0.95;
    return { x: sx, y: sy };
  }

  function screenToWorld(sx, sy, camY) {
    const wx = (sx / viewW) * PORTRAIT_W;
    const wy = camY + (viewH * 0.62 - sy) / ((viewH / PORTRAIT_H) * 0.95);
    return { x: wx, y: wy };
  }

  function drawBackground(camY) {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, '#0a1428');
    g.addColorStop(0.35, PAL.bgMid);
    g.addColorStop(1, PAL.bgDeep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);

    // Stars through chimney opening
    ctx.save();
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 97) % 1000) / 1000 * viewW;
      const sy = ((i * 53) % 300) / 300 * viewH * 0.35;
      const tw = 0.4 + 0.6 * Math.sin(time * 1.5 + i);
      ctx.globalAlpha = 0.15 + tw * 0.25;
      ctx.fillStyle = '#dde8ff';
      ctx.beginPath();
      ctx.arc(sx, sy, 0.5 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Depth bricks
    ctx.save();
    ctx.globalAlpha = 0.08;
    const brickH = 28 * scale;
    const startRow = Math.floor((camY - 200) / 30);
    for (let row = startRow; row < startRow + 30; row++) {
      const wy = row * 30;
      const s = worldToScreen(PORTRAIT_W / 2, wy, camY);
      const offset = (row % 2) * 18;
      for (let col = 0; col < 8; col++) {
        ctx.strokeStyle = '#3a2848';
        ctx.strokeRect(
          offset + col * 48 * (viewW / PORTRAIT_W) - 20,
          s.y - brickH / 2,
          44 * (viewW / PORTRAIT_W),
          brickH - 2,
        );
      }
    }
    ctx.restore();
  }

  function drawWalls(camY) {
    const left = worldToScreen(WorldGen.WALL_LEFT, 0, camY);
    const right = worldToScreen(WorldGen.WALL_RIGHT, 0, camY);

    const wg = ctx.createLinearGradient(left.x - 20, 0, left.x + 10, 0);
    wg.addColorStop(0, '#1a1020');
    wg.addColorStop(0.5, PAL.wall);
    wg.addColorStop(1, PAL.wallEdge);
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, left.x + 6, viewH);

    const wg2 = ctx.createLinearGradient(right.x - 10, 0, right.x + 20, 0);
    wg2.addColorStop(0, PAL.wallEdge);
    wg2.addColorStop(0.5, PAL.wall);
    wg2.addColorStop(1, '#1a1020');
    ctx.fillStyle = wg2;
    ctx.fillRect(right.x - 6, 0, viewW - right.x + 6, viewH);

    // Soot streaks
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const wx = WorldGen.WALL_LEFT + 4 + i * 3;
      const s1 = worldToScreen(wx, camY - 100, camY);
      const s2 = worldToScreen(wx + 8, camY + 400, camY);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDamp(state, camY) {
    const breath = Math.sin(state.dampBreath * 2) * 6;
    const front = state.dampY + breath;
    const s = worldToScreen(PORTRAIT_W / 2, front, camY);
    const y = s.y;

    const g = ctx.createLinearGradient(0, y - 60, 0, viewH);
    g.addColorStop(0, 'rgba(90,152,184,0.0)');
    g.addColorStop(0.15, 'rgba(58,104,136,0.55)');
    g.addColorStop(0.5, 'rgba(26,48,72,0.85)');
    g.addColorStop(1, 'rgba(10,20,32,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 20, viewW, viewH - y + 40);

    // Reaching tendrils
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 7; i++) {
      const tx = (i / 6) * viewW;
      const wave = Math.sin(time * 1.2 + i * 1.1) * 18;
      ctx.fillStyle = PAL.dampMist;
      ctx.beginPath();
      ctx.moveTo(tx - 30, y + 30);
      ctx.quadraticCurveTo(tx + wave, y - 10 - Math.sin(time + i) * 12, tx + 30, y + 30);
      ctx.fill();
    }
    ctx.restore();

    // Foam line
    ctx.strokeStyle = PAL.dampFoam;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= viewW; x += 8) {
      const wobble = Math.sin(x * 0.04 + time * 2.5) * 4 + Math.sin(x * 0.02 - time) * 3;
      if (x === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }

  function drawLedge(ledge, camY) {
    const left = worldToScreen(ledge.position.x - ledge.halfWidth, ledge.position.y, camY);
    const right = worldToScreen(ledge.position.x + ledge.halfWidth, ledge.position.y, camY);
    const w = right.x - left.x;
    const h = 10 * scale;

    const g = ctx.createLinearGradient(left.x, left.y, left.x, left.y + h);
    g.addColorStop(0, PAL.ledgeTop);
    g.addColorStop(1, PAL.ledge);
    ctx.fillStyle = g;
    ctx.beginPath();
    const rx = left.x;
    const ry = left.y - h / 2;
    const rr = 3;
    ctx.moveTo(rx + rr, ry);
    ctx.lineTo(rx + w - rr, ry);
    ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + rr);
    ctx.lineTo(rx + w, ry + h - rr);
    ctx.quadraticCurveTo(rx + w, ry + h, rx + w - rr, ry + h);
    ctx.lineTo(rx + rr, ry + h);
    ctx.quadraticCurveTo(rx, ry + h, rx, ry + h - rr);
    ctx.lineTo(rx, ry + rr);
    ctx.quadraticCurveTo(rx, ry, rx + rr, ry);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = PAL.ledgeGlow;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(left.x + 4, left.y - h / 2 - 1, w - 8, 2);
    ctx.globalAlpha = 1;
  }

  function drawGlimmer(item, camY) {
    const s = worldToScreen(item.position.x, item.position.y, camY);
    const pulse = 0.8 + 0.2 * Math.sin(time * 4 + item.phase);
    const r = item.visualRadius * scale * pulse;

    ctx.save();
    ctx.shadowColor = PAL.glimmer;
    ctx.shadowBlur = 12;
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    g.addColorStop(0, PAL.glimmerCore);
    g.addColorStop(0.4, PAL.glimmer);
    g.addColorStop(1, 'rgba(126,232,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Diamond shape
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r * 0.8);
    ctx.lineTo(s.x + r * 0.5, s.y);
    ctx.lineTo(s.x, s.y + r * 0.8);
    ctx.lineTo(s.x - r * 0.5, s.y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawMoth(item, camY) {
    const s = worldToScreen(item.position.x, item.position.y, camY);
    const flap = Math.sin(time * 8 + item.phase) * 0.4;
    const r = item.visualRadius * scale;

    ctx.save();
    ctx.translate(s.x, s.y);

    // Wings
    ctx.fillStyle = PAL.mothWing;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(-r * 0.7, -flap * 4, r * 0.9, r * 0.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.7, -flap * 4, r * 0.9, r * 0.5, 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.mothBody;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.35, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#ffe8aa';
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.15, r * 0.12, 0, Math.PI * 2);
    ctx.arc(r * 0.15, -r * 0.15, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpark(p, camY, input) {
    const s = worldToScreen(p.x, p.y, camY);
    const r = Simulation.PLAYER_RADIUS * scale * p.squash;
    const ry = Simulation.PLAYER_RADIUS * scale * p.stretch;

    ctx.save();
    ctx.translate(s.x, s.y);

    // Outer glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.5);
    glow.addColorStop(0, 'rgba(255,180,60,0.5)');
    glow.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const bg = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
    bg.addColorStop(0, PAL.sparkCore);
    bg.addColorStop(0.7, PAL.sparkHot);
    bg.addColorStop(1, '#cc4010');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Face
    drawFace(p.expression, r, time);

    // Trail when flying
    if (!p.anchored && (Math.abs(p.vx) > 50 || Math.abs(p.vy) > 50)) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = PAL.sparkHot;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(-p.vx * 0.008 * i, -p.vy * 0.008 * i, r * (1 - i * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    // Aiming expression
    if (input.dragging && p.anchored) {
      drawAimLine(p, camY, input);
    } else if (input.dragging && !p.anchored) {
      drawAimLine(p, camY, input);
    }
  }

  function drawFace(expression, r, t) {
    const eyeY = -r * 0.15;
    const eyeSp = r * 0.28;
    let eyeScale = 1;
    let mouthY = r * 0.2;
    let mouthW = r * 0.3;

    switch (expression) {
      case 'rest':
        eyeScale = 1 + Math.sin(t * 3) * 0.05;
        break;
      case 'aim':
        eyeScale = 1.15;
        mouthY = r * 0.25;
        mouthW = r * 0.2;
        break;
      case 'flight':
        eyeScale = 1.2;
        mouthY = r * 0.1;
        mouthW = r * 0.45;
        break;
      case 'burst':
        eyeScale = 0.6;
        mouthW = r * 0.5;
        break;
      case 'cling':
        eyeScale = 0.85;
        mouthW = r * 0.15;
        break;
      case 'falling':
        eyeScale = 1.5;
        mouthY = r * 0.35;
        mouthW = r * 0.15;
        break;
      case 'damp':
        eyeScale = 0.3;
        break;
      default:
        break;
    }

    // Eyes
    ctx.fillStyle = PAL.sparkEye;
    ctx.beginPath();
    ctx.ellipse(-eyeSp, eyeY, r * 0.14 * eyeScale, r * 0.18 * eyeScale, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeSp, eyeY, r * 0.14 * eyeScale, r * 0.18 * eyeScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-eyeSp + r * 0.05, eyeY - r * 0.04, r * 0.05, 0, Math.PI * 2);
    ctx.arc(eyeSp + r * 0.05, eyeY - r * 0.04, r * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = PAL.sparkEye;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (expression === 'flight' || expression === 'burst') {
      ctx.arc(0, mouthY, mouthW, 0.1, Math.PI - 0.1);
    } else if (expression === 'falling') {
      ctx.arc(0, mouthY + r * 0.1, mouthW, Math.PI + 0.2, -0.2);
    } else {
      ctx.arc(0, mouthY, mouthW * 0.7, 0.2, Math.PI - 0.2);
    }
    ctx.stroke();
  }

  function drawAimLine(p, camY, input) {
    const originX = input.originX;
    const originY = input.originY;
    const pullLen = Math.sqrt(input.dx * input.dx + input.dy * input.dy);
    if (pullLen < 2) return;

    const maxPull = Simulation.MAX_PULL_PX * (viewW / PORTRAIT_W);
    const clampedLen = Math.min(pullLen, maxPull);
    const nx = input.dx / pullLen;
    const ny = input.dy / pullLen;
    const endX = originX + nx * clampedLen;
    const endY = originY + ny * clampedLen;
    const strength = clampedLen / maxPull;

    const sparkS = worldToScreen(p.x, p.y, camY);

    // Rubber band
    ctx.save();
    ctx.strokeStyle = `rgba(255,160,60,${0.3 + strength * 0.5})`;
    ctx.lineWidth = 2 + strength * 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sparkS.x, sparkS.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Launch direction hint
    ctx.strokeStyle = `rgba(255,220,100,${0.2 + strength * 0.4})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sparkS.x, sparkS.y);
    const hintLen = 30 + strength * 60;
    ctx.lineTo(sparkS.x - nx * hintLen, sparkS.y - ny * hintLen);
    ctx.stroke();

    // Pull dot
    ctx.fillStyle = `rgba(255,200,80,${0.5 + strength * 0.5})`;
    ctx.beginPath();
    ctx.arc(endX, endY, 6 + strength * 4, 0, Math.PI * 2);
    ctx.fill();

    // Origin marker
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(originX, originY, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGlowStock(state) {
    const cap = state.jumpCapacity;
    const left = state.jumpsLeft;
    const x0 = viewW * 0.12;
    const y0 = viewH * 0.08;
    const spacing = 22 * scale;

    ctx.font = `${11 * scale}px sans-serif`;
    ctx.fillStyle = PAL.uiDim;
    ctx.textAlign = 'left';
    ctx.fillText('GLOW', x0, y0 - 8);

    for (let i = 0; i < cap; i++) {
      const filled = i < left;
      const cx = x0 + i * spacing;
      const cy = y0 + 4;

      ctx.save();
      if (filled) {
        ctx.shadowColor = PAL.sparkHot;
        ctx.shadowBlur = 8;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9);
        g.addColorStop(0, PAL.sparkCore);
        g.addColorStop(1, PAL.sparkHot);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = 'rgba(60,40,50,0.6)';
        ctx.strokeStyle = 'rgba(120,80,60,0.4)';
        ctx.lineWidth = 1;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      if (!filled) ctx.stroke();
      ctx.restore();
    }
  }

  function drawHUD(state) {
    drawGlowStock(state);

    // Score
    ctx.textAlign = 'right';
    ctx.font = `bold ${18 * scale}px sans-serif`;
    ctx.fillStyle = PAL.uiText;
    ctx.fillText(`${Math.floor(state.score)}`, viewW * 0.92, viewH * 0.08);

    ctx.font = `${10 * scale}px sans-serif`;
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText(`H ${Math.floor(state.height - 90)}`, viewW * 0.92, viewH * 0.08 + 16 * scale);

    // Chain indicator
    if (state.chainCount > 0) {
      const alpha = 0.6 + chainFlash * 0.4;
      ctx.textAlign = 'center';
      ctx.font = `bold ${14 + state.chainCount * 2 * scale}px sans-serif`;
      ctx.fillStyle = `rgba(255,170,68,${alpha})`;
      ctx.fillText(`CHAIN x${state.chainCount}`, viewW / 2, viewH * 0.14);
    }
  }

  function drawGameOver(state) {
    ctx.fillStyle = 'rgba(8,6,16,0.75)';
    ctx.fillRect(0, 0, viewW, viewH);

    const cx = viewW / 2;
    let y = viewH * 0.28;

    ctx.textAlign = 'center';
    ctx.font = `bold ${28 * scale}px serif`;
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText('extinguished', cx, y);

    y += 50 * scale;
    ctx.font = `bold ${42 * scale}px sans-serif`;
    ctx.fillStyle = PAL.sparkCore;
    ctx.fillText(`${Math.floor(state.score)}`, cx, y);

    y += 30 * scale;
    ctx.font = `${14 * scale}px sans-serif`;
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText(`best ${Math.floor(state.sessionBest)}`, cx, y);

    y += 40 * scale;
    ctx.font = `bold ${22 * scale}px serif`;
    ctx.fillStyle = PAL.ledgeTop;
    ctx.fillText(state.rank || '', cx, y);

    y += 36 * scale;
    ctx.font = `${13 * scale}px sans-serif`;
    ctx.fillStyle = PAL.chain;
    ctx.fillText(`best chain: ${state.chainBest}`, cx, y);

    y += 50 * scale;
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.fillStyle = PAL.uiDim;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3);
    ctx.globalAlpha = 0.5 + pulse * 0.5;
    ctx.fillText('tap to climb again', cx, y);
    ctx.globalAlpha = 1;
  }

  function drawHint(state) {
    if (state.phase === 'ready') {
      ctx.textAlign = 'center';
      ctx.font = `bold ${26 * scale}px serif`;
      ctx.fillStyle = PAL.sparkCore;
      ctx.globalAlpha = 0.85;
      ctx.fillText('EMBER', viewW / 2, viewH * 0.2);
      ctx.globalAlpha = 1;

      ctx.font = `${12 * scale}px sans-serif`;
      ctx.fillStyle = PAL.uiDim;
      const pulse = 0.4 + 0.4 * Math.sin(time * 2);
      ctx.globalAlpha = pulse;
      ctx.fillText('pull anywhere · release to launch', viewW / 2, viewH * 0.88);
      ctx.globalAlpha = 1;
      return;
    }
    if (state.phase !== 'playing') return;
  }

  function render(state, input) {
    if (!state) return;
    time += 1 / 60;
    const camY = state.cameraY;

    drawBackground(camY);
    drawWalls(camY);
    drawDamp(state, camY);

    const spanLow = state.player.y - WorldGen.LAUNCH_REACH * 1.5;
    const spanHigh = state.player.y + WorldGen.LAUNCH_REACH * 2;

    for (const ledge of state.world.ledges) {
      if (!ledge.active) continue;
      if (ledge.position.y < spanLow || ledge.position.y > spanHigh) continue;
      drawLedge(ledge, camY);
    }

    for (const item of state.world.items) {
      if (!item.active) continue;
      if (item.position.y < spanLow || item.position.y > spanHigh) continue;
      if (item.type === 'glimmer') drawGlimmer(item, camY);
      else drawMoth(item, camY);
    }

    Particles.draw(ctx, camY, (wx, wy) => worldToScreen(wx, wy, camY));

    if (state.input.dragging) {
      state.player.expression = 'aim';
    }

    drawSpark(state.player, camY, input || state.input);
    drawHUD(state);
    drawHint(state);

    if (state.phase === 'gameover') {
      drawGameOver(state);
    }
  }

  function flashChain(n) {
    chainFlash = Math.min(1, 0.3 + n * 0.15);
  }

  function flashLand() {
    landFlash = 1;
  }

  function updateFlashes(dt) {
    chainFlash = Math.max(0, chainFlash - dt * 2);
    landFlash = Math.max(0, landFlash - dt * 3);
  }

  function getViewMetrics() {
    return { viewW, viewH, scale, PORTRAIT_W, PORTRAIT_H };
  }

  return {
    init,
    resize,
    render,
    worldToScreen,
    screenToWorld,
    flashChain,
    flashLand,
    updateFlashes,
    getViewMetrics,
    PAL,
  };
})();

window.Renderer = Renderer;
