import { CONSTANTS, getRank } from './constants.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Camera state
    this.cameraY = 0;
    this.targetCameraY = 0;
    this.viewportWidth = 360;
    this.viewportHeight = 640;
    this.scale = 1.0;

    // Character animation state
    this.blinkTimer = 2.0;
    this.isBlinking = false;
    this.flamePhase = 0;
    this.stretchX = 1.0;
    this.stretchY = 1.0;
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;

    // Game stage has a fixed aspect ratio of 9:16 (standard mobile portrait, 380x675 base)
    const baseW = 380;
    const baseH = 675;

    const scaleX = width / baseW;
    const scaleY = height / baseH;
    this.scale = Math.min(scaleX, scaleY);

    this.stageW = baseW * this.scale;
    this.stageH = baseH * this.scale;
    this.stageX = (width - this.stageW) * 0.5;
    this.stageY = (height - this.stageH) * 0.5;
  }

  // World to Screen coordinates conversion
  worldToScreen(x, y) {
    // Center of stage is x = 0
    const screenX = this.stageX + this.stageW * 0.5 + x * this.scale;
    // Stage bottom is y = 0 when camera is at 0
    const screenY = this.stageY + this.stageH * 0.65 - (y - this.cameraY) * this.scale;
    return { x: screenX, y: screenY };
  }

  screenToWorld(screenX, screenY) {
    const worldX = (screenX - (this.stageX + this.stageW * 0.5)) / this.scale;
    const worldY = this.cameraY + ((this.stageY + this.stageH * 0.65) - screenY) / this.scale;
    return { x: worldX, y: worldY };
  }

  render(gameState, dt) {
    const ctx = this.ctx;
    const { spark, world, vfx, dampY, dampSpeed, phase, input, score, height, sessionBest, rank, jumpCapacity, jumpsLeft, chainCount, chainBest } = gameState;

    // Update Camera (smooth track spark with upward look-ahead)
    const targetY = spark.y + (spark.vy > 50 ? spark.vy * 0.25 : 0);
    this.targetCameraY = Math.max(0, targetY);
    this.cameraY += (this.targetCameraY - this.cameraY) * Math.min(dt * 8, 0.4);

    // Character animation timers
    this.flamePhase += dt * 8;
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.isBlinking = true;
      if (this.blinkTimer <= -0.15) {
        this.isBlinking = false;
        this.blinkTimer = 2.5 + Math.random() * 3.0;
      }
    }

    // Squash / Stretch spring physics
    const targetStretchX = spark.stretchX || 1.0;
    const targetStretchY = spark.stretchY || 1.0;
    this.stretchX += (targetStretchX - this.stretchX) * Math.min(dt * 18, 0.5);
    this.stretchY += (targetStretchY - this.stretchY) * Math.min(dt * 18, 0.5);

    // 1. Clear Screen & Letterboxing
    ctx.save();
    ctx.fillStyle = '#06070a';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // Apply Screen Shake
    const shakeX = vfx.shakeOffsetX * this.scale;
    const shakeY = vfx.shakeOffsetY * this.scale;

    // Clip to Stage Rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.stageX, this.stageY, this.stageW, this.stageH);
    ctx.clip();
    ctx.translate(this.stageX + shakeX, this.stageY + shakeY);

    // 2. Draw Layered Parallax Chimney Flue
    this.drawBackground(ctx, this.cameraY);

    // 3. Draw Ambient Flue Sparks & Specks
    this.drawAmbientSparks(ctx, vfx.ambientSparks);

    // 4. Draw Chimney Walls
    this.drawWalls(ctx, this.cameraY);

    // 5. Draw Ledges
    const { ledges, items } = world.getEntitiesInSpan(spark.y);
    this.drawLedges(ctx, ledges);

    // 6. Draw Items (Glimmers & Soot-Moths)
    this.drawItems(ctx, items);

    // 7. Draw Visual Particles & Trails
    this.drawParticles(ctx, vfx.particles);

    // 8. Draw Sling Aim Trajectory
    if (input.dragging && jumpsLeft > 0 && phase !== 'gameover') {
      this.drawSlingAim(ctx, spark, input);
    }

    // 9. Draw The Spark (Character)
    this.drawSpark(ctx, spark, jumpsLeft, input.dragging, phase);

    // 10. Draw The Rising Damp Menace
    this.drawDamp(ctx, dampY, spark.y);

    // 11. Draw Floating Score / Chain Texts
    this.drawFloatingTexts(ctx, vfx.floatingTexts);

    // 12. Danger Vignette if Damp is close
    const dampDist = spark.y - dampY;
    if (dampDist < 160 && phase === 'playing') {
      const danger = Math.max(0, 1.0 - dampDist / 160);
      const grad = ctx.createLinearGradient(0, this.stageH, 0, this.stageH - 180 * this.scale);
      grad.addColorStop(0, `rgba(16, 180, 200, ${danger * 0.35 + Math.sin(this.flamePhase * 3) * 0.1})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, this.stageH - 180 * this.scale, this.stageW, 180 * this.scale);
    }

    // 13. Draw In-Game HUD
    this.drawHUD(ctx, gameState);

    // 14. Draw End-of-Run Ceremony Screen (if gameover)
    if (phase === 'gameover') {
      this.drawGameOverScreen(ctx, gameState);
    }

    ctx.restore(); // Stage clip
    ctx.restore(); // Master save
  }

  // --- Background Chimney Parallax ---
  drawBackground(ctx, cameraY) {
    const w = this.stageW;
    const h = this.stageH;

    // Atmospheric Gradient from deep soot to night sky
    const skyProgress = Math.min(cameraY / 4000, 1.0);
    const bgGrad = ctx.createLinearGradient(0, h, 0, 0);
    bgGrad.addColorStop(0, '#090a0f');
    bgGrad.addColorStop(0.5, '#0d1017');
    bgGrad.addColorStop(1, skyProgress > 0.3 ? '#121826' : '#0e121a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Distant brick patterns in chimney
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const brickH = 30 * this.scale;
    const brickW = 60 * this.scale;
    const offsetY = ((cameraY * 0.3) % 60) * this.scale;

    for (let y = -brickH; y < h + brickH; y += brickH) {
      const row = Math.floor((y + offsetY) / brickH);
      const shiftX = (row % 2 === 0 ? 0 : brickW * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, y + offsetY);
      ctx.lineTo(w, y + offsetY);
      ctx.stroke();

      for (let x = shiftX; x < w; x += brickW) {
        ctx.beginPath();
        ctx.moveTo(x, y + offsetY);
        ctx.lineTo(x, y + offsetY + brickH);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --- Ambient Sparks ---
  drawAmbientSparks(ctx, sparks) {
    ctx.save();
    for (let i = 0; i < sparks.length; i++) {
      const sp = sparks[i];
      const pos = this.worldToScreen(sp.x, sp.y);
      const alpha = Math.max(0, sp.alpha + Math.sin(sp.phase) * 0.2);
      ctx.fillStyle = `rgba(255, 170, 60, ${alpha})`;
      ctx.beginPath();
      ctx.arc(pos.x - this.stageX, pos.y - this.stageY, sp.size * this.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Chimney Walls ---
  drawWalls(ctx, cameraY) {
    const leftWallPos = this.worldToScreen(CONSTANTS.WALL_LEFT_X, cameraY);
    const rightWallPos = this.worldToScreen(CONSTANTS.WALL_RIGHT_X, cameraY);
    const lx = leftWallPos.x - this.stageX;
    const rx = rightWallPos.x - this.stageX;
    const h = this.stageH;

    ctx.save();
    // Left Wall
    const lGrad = ctx.createLinearGradient(0, 0, lx, 0);
    lGrad.addColorStop(0, '#040508');
    lGrad.addColorStop(0.85, '#12141c');
    lGrad.addColorStop(1, '#262938');
    ctx.fillStyle = lGrad;
    ctx.fillRect(0, 0, lx, h);

    // Left Wall Soot Edge Highlight
    ctx.strokeStyle = 'rgba(255, 180, 80, 0.15)';
    ctx.lineWidth = 2 * this.scale;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, h);
    ctx.stroke();

    // Right Wall
    const rGrad = ctx.createLinearGradient(this.stageW, 0, rx, 0);
    rGrad.addColorStop(0, '#040508');
    rGrad.addColorStop(0.85, '#12141c');
    rGrad.addColorStop(1, '#262938');
    ctx.fillStyle = rGrad;
    ctx.fillRect(rx, 0, this.stageW - rx, h);

    // Right Wall Soot Edge Highlight
    ctx.strokeStyle = 'rgba(255, 180, 80, 0.15)';
    ctx.lineWidth = 2 * this.scale;
    ctx.beginPath();
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, h);
    ctx.stroke();

    ctx.restore();
  }

  // --- Ledges ---
  drawLedges(ctx, ledges) {
    ctx.save();
    for (let i = 0; i < ledges.length; i++) {
      const ledge = ledges[i];
      if (!ledge.active) continue;

      const pos = this.worldToScreen(ledge.position.x, ledge.position.y);
      const px = pos.x - this.stageX;
      const py = pos.y - this.stageY;
      const hw = ledge.halfWidth * this.scale;
      const lh = 12 * this.scale;

      // Drop Shadow / Glow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(px - hw - 2, py + 2, hw * 2 + 4, lh + 4);

      // Main Ledge Body
      const ledgeGrad = ctx.createLinearGradient(0, py, 0, py + lh);
      ledgeGrad.addColorStop(0, '#434a5e');
      ledgeGrad.addColorStop(0.4, '#2d3242');
      ledgeGrad.addColorStop(1, '#1b1d28');
      ctx.fillStyle = ledgeGrad;

      // Rounded rectangular stone ledge
      ctx.beginPath();
      ctx.roundRect(px - hw, py, hw * 2, lh, 4 * this.scale);
      ctx.fill();

      // Top warm rim glow
      ctx.strokeStyle = 'rgba(255, 210, 120, 0.6)';
      ctx.lineWidth = 2 * this.scale;
      ctx.beginPath();
      ctx.moveTo(px - hw + 2, py + 1);
      ctx.lineTo(px + hw - 2, py + 1);
      ctx.stroke();

      // Iron mounting bracket below
      ctx.fillStyle = '#161822';
      ctx.beginPath();
      ctx.moveTo(px - hw * 0.5, py + lh);
      ctx.lineTo(px - hw * 0.25, py + lh + 10 * this.scale);
      ctx.lineTo(px - hw * 0.1, py + lh);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(px + hw * 0.5, py + lh);
      ctx.lineTo(px + hw * 0.25, py + lh + 10 * this.scale);
      ctx.lineTo(px + hw * 0.1, py + lh);
      ctx.fill();
    }
    ctx.restore();
  }

  // --- Items (Glimmers and Soot-Moths) ---
  drawItems(ctx, items) {
    ctx.save();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.active) continue;

      const pos = this.worldToScreen(item.position.x, item.position.y);
      const px = pos.x - this.stageX;
      const py = pos.y - this.stageY;

      if (item.type === 'glimmer') {
        this.drawGlimmer(ctx, px, py);
      } else if (item.type === 'moth') {
        this.drawMoth(ctx, px, py, item);
      }
    }
    ctx.restore();
  }

  drawGlimmer(ctx, x, y) {
    const s = this.scale;
    const rot = this.flamePhase * 1.5;
    const pulse = 1.0 + Math.sin(this.flamePhase * 4) * 0.15;

    ctx.save();
    ctx.translate(x, y);

    // Glowing Aura
    const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 24 * s * pulse);
    aura.addColorStop(0, 'rgba(255, 235, 120, 0.8)');
    aura.addColorStop(0.5, 'rgba(255, 170, 30, 0.3)');
    aura.addColorStop(1, 'rgba(255, 150, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 24 * s * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Diamond Star Crystals
    ctx.rotate(rot);
    ctx.fillStyle = '#fff4a3';
    ctx.beginPath();
    ctx.moveTo(0, -11 * s * pulse);
    ctx.lineTo(8 * s * pulse, 0);
    ctx.lineTo(0, 11 * s * pulse);
    ctx.lineTo(-8 * s * pulse, 0);
    ctx.closePath();
    ctx.fill();

    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffa726';
    ctx.beginPath();
    ctx.moveTo(0, -7 * s * pulse);
    ctx.lineTo(5 * s * pulse, 0);
    ctx.lineTo(0, 7 * s * pulse);
    ctx.lineTo(-5 * s * pulse, 0);
    ctx.closePath();
    ctx.fill();

    // Bright Center Spark
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawMoth(ctx, x, y, moth) {
    const s = this.scale;
    const wingFlap = Math.sin(this.flamePhase * 16); // 12-16Hz rapid flutter
    const wingAngle = wingFlap * 0.55;

    ctx.save();
    ctx.translate(x, y);

    // Golden dust glow aura
    const mothGlow = ctx.createRadialGradient(0, 0, 2, 0, 0, 20 * s);
    mothGlow.addColorStop(0, 'rgba(255, 215, 100, 0.4)');
    mothGlow.addColorStop(1, 'rgba(255, 180, 50, 0)');
    ctx.fillStyle = mothGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 20 * s, 0, Math.PI * 2);
    ctx.fill();

    // Left Wing
    ctx.save();
    ctx.translate(-2 * s, -1 * s);
    ctx.rotate(-0.4 + wingAngle);
    ctx.fillStyle = 'rgba(240, 225, 180, 0.75)';
    ctx.beginPath();
    ctx.ellipse(-8 * s, -4 * s, 10 * s, 6 * s, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.9)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.restore();

    // Right Wing
    ctx.save();
    ctx.translate(2 * s, -1 * s);
    ctx.rotate(0.4 - wingAngle);
    ctx.fillStyle = 'rgba(240, 225, 180, 0.75)';
    ctx.beginPath();
    ctx.ellipse(8 * s, -4 * s, 10 * s, 6 * s, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.9)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();
    ctx.restore();

    // Fuzzy Soot Body
    ctx.fillStyle = '#26201e';
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.5 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cute Glowing Eyes
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(-2 * s, -3 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.arc(2 * s, -3 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();

    // Antennae
    ctx.strokeStyle = '#a69076';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(-1 * s, -6 * s);
    ctx.quadraticCurveTo(-4 * s, -11 * s, -7 * s, -12 * s);
    ctx.moveTo(1 * s, -6 * s);
    ctx.quadraticCurveTo(4 * s, -11 * s, 7 * s, -12 * s);
    ctx.stroke();

    ctx.restore();
  }

  // --- Particles & VFX ---
  drawParticles(ctx, particles) {
    ctx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const pos = this.worldToScreen(p.x, p.y);
      const px = pos.x - this.stageX;
      const py = pos.y - this.stageY;
      const progress = p.life / p.maxLife;
      const alpha = Math.max(0, 1.0 - progress);
      const radius = Math.max(0.5, p.size * (1.0 - progress * 0.4)) * this.scale;

      if (p.color === 'fire') {
        const fireGrad = ctx.createRadialGradient(px, py, 0, px, py, radius * 1.5);
        if (progress < 0.3) {
          fireGrad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
          fireGrad.addColorStop(0.5, `rgba(255, 200, 50, ${alpha * 0.8})`);
          fireGrad.addColorStop(1, `rgba(255, 80, 10, 0)`);
        } else {
          fireGrad.addColorStop(0, `rgba(255, 140, 20, ${alpha})`);
          fireGrad.addColorStop(0.6, `rgba(220, 40, 0, ${alpha * 0.6})`);
          fireGrad.addColorStop(1, `rgba(40, 20, 20, 0)`);
        }
        ctx.fillStyle = fireGrad;
        ctx.beginPath();
        ctx.arc(px, py, radius * 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.color === 'gold' || p.color === 'star') {
        ctx.fillStyle = `rgba(255, 220, 80, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.color === 'crystal') {
        ctx.fillStyle = `rgba(180, 240, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.color === 'smoke' || p.color === 'soot') {
        ctx.fillStyle = `rgba(50, 45, 55, ${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(px, py, radius * 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.color === 'steam') {
        ctx.fillStyle = `rgba(100, 180, 210, ${alpha * 0.5})`;
        ctx.beginPath();
        ctx.arc(px, py, radius * 1.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255, 180, 60, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // --- Sling Aim Line & Trajectory Arc ---
  drawSlingAim(ctx, spark, input) {
    const s = this.scale;
    const sparkScreen = this.worldToScreen(spark.x, spark.y);
    const sx = sparkScreen.x - this.stageX;
    const sy = sparkScreen.y - this.stageY;

    // Drag vector in screen space
    const dx = input.dx;
    const dy = input.dy;
    const dragDist = Math.hypot(dx, dy);
    if (dragDist < CONSTANTS.DRAG_DEADZONE_PX) return;

    const dragNorm = Math.min(
      (dragDist - CONSTANTS.DRAG_DEADZONE_PX) / (CONSTANTS.DRAG_MAX_PX - CONSTANTS.DRAG_DEADZONE_PX),
      1.0
    );

    // Aim launch vector: pull down (dy > 0) launches up (vy > 0)
    const angle = Math.atan2(dy, -dx);
    const speed = CONSTANTS.MIN_LAUNCH_SPEED + (CONSTANTS.MAX_LAUNCH_SPEED - CONSTANTS.MIN_LAUNCH_SPEED) * dragNorm;
    const launchVx = Math.cos(angle) * speed;
    const launchVy = Math.sin(angle) * speed;

    ctx.save();

    // 1. Elastic Sling Line from touch origin to touch point
    const originStageX = input.originX - this.stageX;
    const originStageY = input.originY - this.stageY;
    const currentTouchX = originStageX + dx;
    const currentTouchY = originStageY + dy;

    // Origin Reticle
    ctx.strokeStyle = `rgba(255, 200, 80, ${0.4 + dragNorm * 0.4})`;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.arc(originStageX, originStageY, 14 * s, 0, Math.PI * 2);
    ctx.stroke();

    // Elastic Band
    ctx.strokeStyle = `rgba(255, 180, 60, ${0.6 + dragNorm * 0.4})`;
    ctx.lineWidth = (2 + dragNorm * 2.5) * s;
    ctx.beginPath();
    ctx.moveTo(originStageX, originStageY);
    ctx.lineTo(currentTouchX, currentTouchY);
    ctx.stroke();

    // Touch handle point
    ctx.fillStyle = dragNorm > 0.9 ? '#ffffff' : '#ffb74d';
    ctx.beginPath();
    ctx.arc(currentTouchX, currentTouchY, (5 + dragNorm * 3) * s, 0, Math.PI * 2);
    ctx.fill();

    // 2. Trajectory Arc Prediction Dots (simulating gravity parabola)
    const dtSim = 0.035;
    let simX = spark.x;
    let simY = spark.y;
    let simVx = launchVx;
    let simVy = launchVy;

    for (let step = 1; step <= 20; step++) {
      simX += simVx * dtSim;
      simY += simVy * dtSim;
      simVy += CONSTANTS.GRAVITY * dtSim;

      // Bounce off walls in simulation arc
      if (simX <= CONSTANTS.WALL_LEFT_X + CONSTANTS.PLAYER_RADIUS) {
        simX = CONSTANTS.WALL_LEFT_X + CONSTANTS.PLAYER_RADIUS;
        simVx = -simVx * 0.4;
      } else if (simX >= CONSTANTS.WALL_RIGHT_X - CONSTANTS.PLAYER_RADIUS) {
        simX = CONSTANTS.WALL_RIGHT_X - CONSTANTS.PLAYER_RADIUS;
        simVx = -simVx * 0.4;
      }

      const pPos = this.worldToScreen(simX, simY);
      const px = pPos.x - this.stageX;
      const py = pPos.y - this.stageY;
      const dotAlpha = Math.max(0.1, 1.0 - (step / 22));
      const dotRadius = Math.max(1.2, (3.8 - step * 0.12) * s);

      // Dot color shifts from gold to white with power
      ctx.fillStyle = dragNorm > 0.8
        ? `rgba(255, 255, 255, ${dotAlpha})`
        : `rgba(255, 210, 80, ${dotAlpha})`;

      ctx.beginPath();
      ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // --- The Spark (Protagonist Character) ---
  drawSpark(ctx, spark, jumpsLeft, isAiming, phase) {
    const s = this.scale;
    const pos = this.worldToScreen(spark.x, spark.y);
    const px = pos.x - this.stageX;
    const py = pos.y - this.stageY;

    ctx.save();
    ctx.translate(px, py);

    // Determine Character State
    let state = 'idle';
    let rot = 0;

    if (phase === 'gameover') {
      state = 'dead';
    } else if (isAiming && jumpsLeft > 0) {
      state = 'aiming';
    } else if (!spark.anchored) {
      if (jumpsLeft === 0 && spark.vy < -50) {
        state = 'panic';
      } else {
        state = 'flying';
        const speed = Math.hypot(spark.vx, spark.vy);
        if (speed > 40) {
          // Point flame tip backwards (opposite velocity vector)
          rot = Math.atan2(-spark.vy, spark.vx) - Math.PI / 2;
        }
      }
    } else if (spark.anchored && spark.anchorKind === 'wall') {
      state = 'wall';
    }

    ctx.rotate(rot);

    // Character Scale with dynamic squash & stretch
    const scaleX = this.stretchX * s;
    const scaleY = this.stretchY * s;
    ctx.scale(scaleX, scaleY);

    const r = CONSTANTS.PLAYER_RADIUS;
    const isPanic = state === 'panic';
    const isDead = state === 'dead';

    // 1. Ambient Glow Halo
    const haloRadius = (isPanic ? 18 : (isDead ? 8 : 34)) * (1.0 + Math.sin(this.flamePhase * 3) * 0.08);
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, haloRadius);
    if (isDead) {
      halo.addColorStop(0, 'rgba(100, 140, 160, 0.3)');
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else if (isPanic) {
      halo.addColorStop(0, 'rgba(230, 80, 20, 0.4)');
      halo.addColorStop(1, 'rgba(120, 20, 0, 0)');
    } else {
      halo.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
      halo.addColorStop(0.4, 'rgba(255, 160, 40, 0.5)');
      halo.addColorStop(1, 'rgba(255, 70, 10, 0)');
    }
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // 2. Teardrop Flame Body
    const flameWobble = Math.sin(this.flamePhase * 6) * 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, r * 0.2);
    // Left flame curve
    ctx.bezierCurveTo(-r * 0.9, -r * 0.6, -r * 0.4, -r * 1.3, 0 + flameWobble, -r * 1.8);
    // Right flame curve
    ctx.bezierCurveTo(r * 0.4, -r * 1.3, r * 0.9, -r * 0.6, r * 0.9, r * 0.2);
    // Bottom round base
    ctx.bezierCurveTo(r * 0.9, r * 1.1, -r * 0.9, r * 1.1, -r * 0.9, r * 0.2);
    ctx.closePath();

    const bodyGrad = ctx.createLinearGradient(0, -r * 1.8, 0, r);
    if (isDead) {
      bodyGrad.addColorStop(0, '#3a444d');
      bodyGrad.addColorStop(1, '#1e2429');
    } else if (isPanic) {
      bodyGrad.addColorStop(0, '#ff7043');
      bodyGrad.addColorStop(0.5, '#d84315');
      bodyGrad.addColorStop(1, '#4e1402');
    } else {
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.3, '#ffeb3b');
      bodyGrad.addColorStop(0.7, '#ff9800');
      bodyGrad.addColorStop(1, '#f44336');
    }
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 3. Inner White Core
    if (!isDead && !isPanic) {
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.45, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }

    // 4. Expressive Character Face
    if (state === 'dead') {
      // Closed / extinguished "x x" eyes
      ctx.strokeStyle = '#607d8b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-4, -1); ctx.lineTo(-1, 2);
      ctx.moveTo(-1, -1); ctx.lineTo(-4, 2);
      ctx.moveTo(1, -1); ctx.lineTo(4, 2);
      ctx.moveTo(4, -1); ctx.lineTo(1, 2);
      ctx.stroke();
    } else if (state === 'panic') {
      // Wide-eyed terror "O_O" with trembling pupils
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-4, -1, 3.5, 0, Math.PI * 2);
      ctx.arc(4, -1, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#110000';
      const tremX = (Math.random() - 0.5) * 1.2;
      const tremY = (Math.random() - 0.5) * 1.2;
      ctx.beginPath();
      ctx.arc(-4 + tremX, -1 + tremY, 1.4, 0, Math.PI * 2);
      ctx.arc(4 + tremX, -1 + tremY, 1.4, 0, Math.PI * 2);
      ctx.fill();

      // Open small screaming mouth
      ctx.fillStyle = '#3e0000';
      ctx.beginPath();
      ctx.ellipse(0, 5, 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'aiming') {
      // Focused eyes looking up/forward with determination
      ctx.fillStyle = '#1a0c00';
      ctx.beginPath();
      ctx.arc(-3.5, -3, 2.2, 0, Math.PI * 2);
      ctx.arc(3.5, -3, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Little eye glints
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-4.2, -3.8, 0.9, 0, Math.PI * 2);
      ctx.arc(2.8, -3.8, 0.9, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'flying') {
      // Excited happy squinty eyes (^.^)
      ctx.strokeStyle = '#1a0c00';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(-3.5, -1, 2.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.arc(3.5, -1, 2.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();

      // Cute blush
      ctx.fillStyle = 'rgba(255, 100, 50, 0.5)';
      ctx.beginPath();
      ctx.arc(-5.5, 2.5, 1.8, 0, Math.PI * 2);
      ctx.arc(5.5, 2.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'wall') {
      // Straining / holding on expression
      ctx.fillStyle = '#1a0c00';
      ctx.beginPath();
      ctx.arc(-3.5, -1, 1.8, 0, Math.PI * 2);
      ctx.arc(3.5, -1, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Sweat drop / strain mark
      ctx.fillStyle = '#80d8ff';
      ctx.beginPath();
      ctx.arc(5.5, -5, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Idle at rest: cute blinking eyes
      if (this.isBlinking) {
        ctx.strokeStyle = '#1a0c00';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-5, 0); ctx.lineTo(-2, 0);
        ctx.moveTo(2, 0); ctx.lineTo(5, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#1a0c00';
        ctx.beginPath();
        ctx.arc(-3.5, 0, 2.2, 0, Math.PI * 2);
        ctx.arc(3.5, 0, 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Eye highlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-4.2, -0.8, 0.9, 0, Math.PI * 2);
        ctx.arc(2.8, -0.8, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // --- The Rising Damp (Antagonist) ---
  drawDamp(ctx, dampY, sparkY) {
    const s = this.scale;
    const dampScreen = this.worldToScreen(0, dampY);
    const dampScreenY = dampScreen.y - this.stageY;
    const w = this.stageW;
    const h = this.stageH;

    // If damp is far below view, render nothing
    if (dampScreenY > h + 100) return;

    ctx.save();

    // 1. Viscous Murky Body Below Damp Front
    const dampBodyH = Math.max(0, h - dampScreenY + 20);
    const bodyGrad = ctx.createLinearGradient(0, dampScreenY, 0, h);
    bodyGrad.addColorStop(0, 'rgba(8, 28, 38, 0.94)');
    bodyGrad.addColorStop(0.3, 'rgba(4, 18, 25, 0.98)');
    bodyGrad.addColorStop(1, '#02080c');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(0, dampScreenY, w, dampBodyH);

    // 2. Multi-layered Undulating Mist Waves
    const waveCount = 3;
    const time = this.flamePhase;

    for (let layer = 0; layer < waveCount; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, h);

      const amp = (8 + layer * 4) * s;
      const freq = 0.015 + layer * 0.008;
      const speed = (layer + 1) * 0.8;
      const layerOffset = (layer * 6 - 8) * s;

      for (let x = 0; x <= w; x += 10) {
        const wave = Math.sin(x * freq + time * speed) * amp +
                     Math.cos(x * freq * 0.5 - time * speed * 0.7) * (amp * 0.5);
        ctx.lineTo(x, dampScreenY + layerOffset + wave);
      }
      ctx.lineTo(w, h);
      ctx.closePath();

      if (layer === 0) {
        ctx.fillStyle = 'rgba(24, 75, 95, 0.65)';
      } else if (layer === 1) {
        ctx.fillStyle = 'rgba(14, 50, 68, 0.78)';
      } else {
        ctx.fillStyle = 'rgba(8, 30, 42, 0.9)';
      }
      ctx.fill();
    }

    // 3. Bio-luminescent Foaming Mist Crest
    ctx.strokeStyle = 'rgba(64, 210, 230, 0.45)';
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const wave = Math.sin(x * 0.02 + time * 1.5) * 8 * s +
                   Math.cos(x * 0.01 - time * 0.8) * 4 * s;
      const wy = dampScreenY - 6 * s + wave;
      if (x === 0) ctx.moveTo(x, wy);
      else ctx.lineTo(x, wy);
    }
    ctx.stroke();

    ctx.restore();
  }

  // --- Floating Texts ---
  drawFloatingTexts(ctx, floatingTexts) {
    ctx.save();
    for (let i = 0; i < floatingTexts.length; i++) {
      const ft = floatingTexts[i];
      const pos = this.worldToScreen(ft.x, ft.y);
      const px = pos.x - this.stageX;
      const py = pos.y - this.stageY;
      const alpha = Math.max(0, 1.0 - (ft.life / ft.maxLife));
      const scale = (ft.scale || 1.0) * this.scale;

      ctx.save();
      ctx.translate(px, py);
      ctx.scale(scale, scale);

      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Text Shadow
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
      ctx.fillText(ft.text, 1, 1);

      ctx.fillStyle = ft.color.startsWith('#')
        ? ft.color
        : `rgba(255, 220, 80, ${alpha})`;
      ctx.globalAlpha = alpha;
      ctx.fillText(ft.text, 0, 0);

      ctx.restore();
    }
    ctx.restore();
  }

  // --- HUD ---
  drawHUD(ctx, gameState) {
    const s = this.scale;
    const { score, height, jumpsLeft, jumpCapacity, chainCount, phase } = gameState;

    ctx.save();

    // 1. Top Status Bar Container
    const topY = 16 * s;

    // Score (Top Left)
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(22 * s)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(Math.floor(score).toLocaleString(), 20 * s, topY + 18 * s);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `bold ${Math.round(10 * s)}px sans-serif`;
    ctx.fillText('SCORE', 20 * s, topY);

    // Height (Top Center)
    ctx.fillStyle = '#ffd54f';
    ctx.font = `bold ${Math.round(18 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(height)}m`, this.stageW * 0.5, topY + 18 * s);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `bold ${Math.round(10 * s)}px sans-serif`;
    ctx.fillText('HEIGHT', this.stageW * 0.5, topY);

    // Glow Stock Meter (Top Right: 3 radiant ember icons)
    const stockStartX = this.stageW - 20 * s;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `bold ${Math.round(10 * s)}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('GLOW', stockStartX, topY);

    for (let i = 0; i < jumpCapacity; i++) {
      const emberX = stockStartX - (jumpCapacity - 1 - i) * 18 * s - 6 * s;
      const emberY = topY + 14 * s;
      const isFilled = i < jumpsLeft;

      if (isFilled) {
        // Glowing active ember
        const emberGlow = ctx.createRadialGradient(emberX, emberY, 1, emberX, emberY, 9 * s);
        emberGlow.addColorStop(0, '#ffffff');
        emberGlow.addColorStop(0.4, '#ffb74d');
        emberGlow.addColorStop(1, 'rgba(245, 124, 0, 0)');
        ctx.fillStyle = emberGlow;
        ctx.beginPath();
        ctx.arc(emberX, emberY, 9 * s, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ff9800';
        ctx.beginPath();
        ctx.arc(emberX, emberY, 4 * s, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Spent extinguished ember slot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(emberX, emberY, 3.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Chain Badge (if chainCount >= 1)
    if (chainCount >= 1 && phase === 'playing') {
      const chainY = topY + 54 * s;
      const badgeW = 120 * s;
      const badgeH = 26 * s;
      const badgeX = (this.stageW - badgeW) * 0.5;

      ctx.save();
      // Badge background
      const badgeGrad = ctx.createLinearGradient(badgeX, chainY, badgeX + badgeW, chainY);
      badgeGrad.addColorStop(0, 'rgba(255, 87, 34, 0.85)');
      badgeGrad.addColorStop(0.5, 'rgba(255, 171, 0, 0.95)');
      badgeGrad.addColorStop(1, 'rgba(255, 87, 34, 0.85)');
      ctx.fillStyle = badgeGrad;

      ctx.beginPath();
      ctx.roundRect(badgeX, chainY, badgeW, badgeH, 13 * s);
      ctx.fill();

      // Flame border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      // Chain text
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(13 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = chainCount >= 4 ? `🔥 BLAZE x${chainCount}! 🔥` : `CHAIN x${chainCount}`;
      ctx.fillText(label, this.stageW * 0.5, chainY + badgeH * 0.5);
      ctx.restore();
    }

    // 3. Ready Tutorial Prompt
    if (phase === 'ready') {
      const hintY = this.stageH * 0.78;
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${0.7 + Math.sin(this.flamePhase * 4) * 0.3})`;
      ctx.font = `bold ${Math.round(15 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('PULL & RELEASE TO LAUNCH', this.stageW * 0.5, hintY);

      ctx.font = `${Math.round(12 * s)}px sans-serif`;
      ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
      ctx.fillText('Touch anywhere to aim • Climb before damp rises', this.stageW * 0.5, hintY + 22 * s);
      ctx.restore();
    }

    ctx.restore();
  }

  // --- End-of-Run Ceremony Screen ---
  drawGameOverScreen(ctx, gameState) {
    const s = this.scale;
    const { score, height, sessionBest, chainBest, glimmersCollected } = gameState;
    const rankTitle = getRank(score);
    const isNewBest = score >= sessionBest && score > 0;

    const w = this.stageW;
    const h = this.stageH;

    ctx.save();

    // Dark backdrop overlay
    ctx.fillStyle = 'rgba(5, 7, 12, 0.82)';
    ctx.fillRect(0, 0, w, h);

    // Modal Card
    const cardW = Math.min(320 * s, w * 0.88);
    const cardH = 370 * s;
    const cardX = (w - cardW) * 0.5;
    const cardY = (h - cardH) * 0.45;

    // Card background
    const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
    cardGrad.addColorStop(0, '#1c202d');
    cardGrad.addColorStop(1, '#0e1017');
    ctx.fillStyle = cardGrad;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 18 * s);
    ctx.fill();

    // Card border
    ctx.strokeStyle = 'rgba(255, 180, 70, 0.4)';
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    // Header: Rank Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `bold ${Math.round(11 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('FINAL GRADE', w * 0.5, cardY + 28 * s);

    ctx.fillStyle = '#ffca28';
    ctx.font = `bold ${Math.round(28 * s)}px sans-serif`;
    ctx.fillText(rankTitle.toUpperCase(), w * 0.5, cardY + 62 * s);

    // Final Score
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(36 * s)}px sans-serif`;
    ctx.fillText(Math.floor(score).toLocaleString(), w * 0.5, cardY + 115 * s);

    if (isNewBest) {
      ctx.fillStyle = '#ff7043';
      ctx.font = `bold ${Math.round(11 * s)}px sans-serif`;
      ctx.fillText('★ NEW SESSION BEST! ★', w * 0.5, cardY + 135 * s);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = `${Math.round(11 * s)}px sans-serif`;
      ctx.fillText(`SESSION BEST: ${Math.floor(sessionBest).toLocaleString()}`, w * 0.5, cardY + 135 * s);
    }

    // Horizontal Divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 24 * s, cardY + 152 * s);
    ctx.lineTo(cardX + cardW - 24 * s, cardY + 152 * s);
    ctx.stroke();

    // Stats Grid
    const statY1 = cardY + 185 * s;
    const statY2 = cardY + 235 * s;
    const colLeft = cardX + cardW * 0.3;
    const colRight = cardX + cardW * 0.7;

    // Stat 1: Height
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${Math.round(10 * s)}px sans-serif`;
    ctx.fillText('HEIGHT REACHED', colLeft, statY1);
    ctx.fillStyle = '#ffd54f';
    ctx.font = `bold ${Math.round(16 * s)}px sans-serif`;
    ctx.fillText(`${Math.floor(height)}m`, colLeft, statY1 + 18 * s);

    // Stat 2: Longest Chain
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${Math.round(10 * s)}px sans-serif`;
    ctx.fillText('BEST CHAIN', colRight, statY1);
    ctx.fillStyle = '#ff7043';
    ctx.font = `bold ${Math.round(16 * s)}px sans-serif`;
    ctx.fillText(`${chainBest}x`, colRight, statY1 + 18 * s);

    // Stat 3: Glimmers Collected
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${Math.round(10 * s)}px sans-serif`;
    ctx.fillText('GLIMMERS FOUND', w * 0.5, statY2);
    ctx.fillStyle = '#4dd0e1';
    ctx.font = `bold ${Math.round(16 * s)}px sans-serif`;
    ctx.fillText(`${glimmersCollected}`, w * 0.5, statY2 + 18 * s);

    // Tap to Restart Button Prompt
    const btnY = cardY + cardH - 52 * s;
    const btnW = cardW - 48 * s;
    const btnH = 38 * s;
    const btnX = (w - btnW) * 0.5;

    const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
    btnGrad.addColorStop(0, '#ff9800');
    btnGrad.addColorStop(1, '#f57c00');
    ctx.fillStyle = btnGrad;
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, btnW, btnH, 19 * s);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(13 * s)}px sans-serif`;
    ctx.fillText('TAP TO CLIMB AGAIN', w * 0.5, btnY + btnH * 0.5 + 4 * s);

    ctx.restore();
  }
}
