import { CRAWL_SPEED, MAX_SPEED, PLAYER_RADIUS, MAX_REMAINING_MS } from './game.js';

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Visual particles (view-only)
    this.particles = [];
    this.floatingTexts = [];
    this.speedLines = [];

    // Animation & eye state
    this.animTime = 0;
    this.drillAngle = 0;
    this.blinkTimer = 0;
    this.eyeBlinking = false;
    this.shakeAmount = 0;
    this.crumpleAmount = 0;
    this.grazeReactionTimer = 0;

    // Initialize speed lines
    for (let i = 0; i < 25; i++) {
      this.speedLines.push({
        x: (Math.random() - 0.5) * 400,
        y: Math.random() * 800,
        len: 20 + Math.random() * 40,
        speed: 1 + Math.random() * 1.5,
        alpha: 0.2 + Math.random() * 0.5
      });
    }
  }

  triggerNearMissEffect(x, y, combo) {
    this.grazeReactionTimer = 20;
    this.addFloatingText(x, y - 20, combo > 1 ? `GRAZE x${combo}!` : 'GRAZE!', '#38ef7d');
    // Spark burst
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5);
      const spd = 2 + Math.random() * 4;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 0.04 + Math.random() * 0.03,
        size: 3 + Math.random() * 3,
        color: '#38ef7d'
      });
    }
  }

  triggerRockShatter(x, y, radius, isPowerDestroy = false) {
    this.shakeAmount = isPowerDestroy ? 8 : 12;
    this.crumpleAmount = isPowerDestroy ? 2 : 10;

    const count = isPowerDestroy ? 24 : 16;
    const baseColor = isPowerDestroy ? '#00f2fe' : '#e09f67';

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (1 + Math.random() * 5) * (isPowerDestroy ? 1.5 : 1);
      this.particles.push({
        x: x + (Math.random() - 0.5) * radius,
        y: y + (Math.random() - 0.5) * radius,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.03,
        size: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        color: baseColor
      });
    }

    if (isPowerDestroy) {
      this.addFloatingText(x, y - 15, '+1.8s CRUSH!', '#00f2fe');
    }
  }

  triggerFragmentPickup(x, y) {
    this.addFloatingText(x, y - 15, '+1.8s', '#4facfe');
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 3;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 0.04,
        size: 3 + Math.random() * 3,
        color: '#4facfe'
      });
    }
  }

  triggerPowerPickup(x, y) {
    this.shakeAmount = 6;
    this.addFloatingText(x, y - 25, 'HYPER DRIVE!', '#ffd200');
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 3 + Math.random() * 6;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 0.025,
        size: 4 + Math.random() * 4,
        color: i % 2 === 0 ? '#ffd200' : '#ff0844'
      });
    }
  }

  addFloatingText(x, y, text, color) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 1.0,
      decay: 0.025
    });
  }

  render(game, touchStick = null) {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    this.animTime += 0.016;
    if (this.shakeAmount > 0) this.shakeAmount *= 0.88;
    if (this.crumpleAmount > 0) this.crumpleAmount *= 0.9;
    if (this.grazeReactionTimer > 0) this.grazeReactionTimer--;

    // Blinking logic
    this.blinkTimer++;
    if (this.blinkTimer > 180) {
      this.eyeBlinking = true;
      if (this.blinkTimer > 192) {
        this.eyeBlinking = false;
        this.blinkTimer = 0;
      }
    }

    // Drill rotation speed based on game speed
    const speedRatio = (game.speed - CRAWL_SPEED) / (MAX_SPEED - CRAWL_SPEED);
    this.drillAngle += 0.2 + speedRatio * 0.8;

    // Screen shake offset
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeAmount > 0.1) {
      shakeX = (Math.random() - 0.5) * this.shakeAmount * 2;
      shakeY = (Math.random() - 0.5) * this.shakeAmount * 2;
    }

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Camera transform: player sits around 35% from top of screen
    const cameraY = game.depth - height * 0.35;
    const cameraX = game.course.getCenter(game.depth);

    // Apply shake & camera center
    ctx.translate(width / 2 + shakeX, -cameraY + shakeY);

    // 1. Draw Deep Parallax Background Strata
    this._drawBackground(ctx, game, cameraY, width, height);

    // 2. Draw Corridor Walls & Lighting
    this._drawCorridor(ctx, game, cameraY, height);

    // 3. Draw Collectible Items & Obstacle Rocks
    this._drawEntities(ctx, game, cameraY, height);

    // 4. Draw Speed Streaks
    if (speedRatio > 0.2) {
      this._drawSpeedLines(ctx, game, cameraY, speedRatio);
    }

    // 5. Draw Particles & Floating Text
    this._drawParticles(ctx);

    // 6. Draw Player Character (Drill-Pod "DELVER")
    this._drawPlayer(ctx, game, speedRatio);

    ctx.restore();

    // 7. Draw HUD Overlay
    this._drawHUD(ctx, game, width, height, touchStick);

    // 8. Draw Ready / End-of-Run Overlays
    if (game.phase === 'ready') {
      this._drawReadyOverlay(ctx, width, height);
    } else if (game.phase === 'gameover') {
      this._drawGameOverOverlay(ctx, game, width, height);
    }
  }

  _drawBackground(ctx, game, cameraY, width, height) {
    const startD = Math.floor(cameraY / 100) * 100;
    const endD = cameraY + height + 100;

    // Gradient cave atmosphere changing with depth
    const depthTier = Math.min(1, game.depth / 25000);
    const bgGrad = ctx.createLinearGradient(0, cameraY, 0, cameraY + height);
    bgGrad.addColorStop(0, '#0c0d14');
    bgGrad.addColorStop(0.5, depthTier > 0.5 ? '#1a0d18' : '#0e141f');
    bgGrad.addColorStop(1, depthTier > 0.7 ? '#240d12' : '#090d16');

    ctx.fillStyle = bgGrad;
    ctx.fillRect(-width * 1.5, cameraY, width * 3, height);

    // Parallax strata lines & rock crust details
    ctx.lineWidth = 1;
    for (let d = startD; d < endD; d += 80) {
      const c = game.course.getCenter(d);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.beginPath();
      ctx.moveTo(-width, d);
      ctx.lineTo(width, d);
      ctx.stroke();

      // Depth markers on side
      if (d % 200 === 0 && d > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.font = '10px monospace';
        ctx.fillText(`${d}m`, c - 240, d);
        ctx.fillText(`${d}m`, c + 210, d);
      }
    }
  }

  _drawCorridor(ctx, game, cameraY, height) {
    const minD = cameraY - 50;
    const maxD = cameraY + height + 80;
    const step = 20;

    const leftWallPts = [];
    const rightWallPts = [];

    for (let d = minD; d <= maxD; d += step) {
      const c = game.course.getCenter(d);
      const hw = game.course.getHalfWidth(d);
      leftWallPts.push({ x: c - hw, y: d });
      rightWallPts.push({ x: c + hw, y: d });
    }

    // 1. Draw Left Wall Carved Rock Mass
    ctx.fillStyle = '#161924';
    ctx.beginPath();
    ctx.moveTo(-800, minD);
    for (const pt of leftWallPts) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineTo(-800, maxD);
    ctx.closePath();
    ctx.fill();

    // 2. Draw Right Wall Carved Rock Mass
    ctx.fillStyle = '#161924';
    ctx.beginPath();
    ctx.moveTo(800, minD);
    for (const pt of rightWallPts) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineTo(800, maxD);
    ctx.closePath();
    ctx.fill();

    // 3. Glowing Wall Neon Edges / Crust
    const isPowered = game.timeMs < game.invincibleUntilMs;
    const wallColor = isPowered ? '#00f2fe' : '#4facfe';

    ctx.strokeStyle = wallColor;
    ctx.lineWidth = 3;
    ctx.shadowColor = wallColor;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    for (let i = 0; i < leftWallPts.length; i++) {
      if (i === 0) ctx.moveTo(leftWallPts[i].x, leftWallPts[i].y);
      else ctx.lineTo(leftWallPts[i].x, leftWallPts[i].y);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < rightWallPts.length; i++) {
      if (i === 0) ctx.moveTo(rightWallPts[i].x, rightWallPts[i].y);
      else ctx.lineTo(rightWallPts[i].x, rightWallPts[i].y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  _drawEntities(ctx, game, cameraY, height) {
    const minD = cameraY - 60;
    const maxD = cameraY + height + 60;
    const { rocks, items } = game.course.getEntitiesInHorizon(game.depth);

    // 1. Draw Obstacle Rocks
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (!rock.active || rock.position.depth < minD || rock.position.depth > maxD) continue;

      const rx = rock.position.x;
      const ry = rock.position.depth;
      const rad = rock.visualRadius;

      ctx.save();
      ctx.translate(rx, ry);

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.arc(2, 4, rad, 0, Math.PI * 2);
      ctx.fill();

      // Rock body - faceted polygon
      const grad = ctx.createRadialGradient(-rad * 0.3, -rad * 0.3, rad * 0.1, 0, 0, rad);
      grad.addColorStop(0, '#5a4d41');
      grad.addColorStop(0.6, '#3a2f26');
      grad.addColorStop(1, '#1e1814');

      ctx.fillStyle = grad;
      ctx.strokeStyle = '#7d6b5b';
      ctx.lineWidth = 2;

      ctx.beginPath();
      const numSides = 7;
      for (let s = 0; s < numSides; s++) {
        const a = (s / numSides) * Math.PI * 2 + (rock.id * 0.7);
        const r = rad * (0.85 + Math.sin(s * 3.7 + rock.id) * 0.15);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Internal cracks & highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-rad * 0.3, -rad * 0.2);
      ctx.lineTo(rad * 0.1, rad * 0.3);
      ctx.stroke();

      ctx.restore();
    }

    // 2. Draw Collectibles (Fragments & Power Items)
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.active || it.position.depth < minD || it.position.depth > maxD) continue;

      const ix = it.position.x;
      const iy = it.position.depth;

      if (it.type === 'fragment') {
        // Time Fragment: Pulsing multifaceted diamond crystal
        ctx.save();
        ctx.translate(ix, iy);

        const pulse = 1 + Math.sin(this.animTime * 6 + it.id) * 0.15;
        const spin = this.animTime * 2 + it.id;

        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 10;

        // Outer glow diamond
        ctx.fillStyle = 'rgba(0, 242, 254, 0.25)';
        ctx.beginPath();
        ctx.arc(0, 0, it.visualRadius * 1.5 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Crystal diamond core
        ctx.rotate(spin);
        ctx.fillStyle = '#4facfe';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(0, -it.visualRadius * pulse);
        ctx.lineTo(it.visualRadius * 0.8 * pulse, 0);
        ctx.lineTo(0, it.visualRadius * pulse);
        ctx.lineTo(-it.visualRadius * 0.8 * pulse, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      } else if (it.type === 'power') {
        // Power Orb: Radiant rainbow energy core with orbiting rings
        ctx.save();
        ctx.translate(ix, iy);

        const pulse = 1 + Math.sin(this.animTime * 8) * 0.2;
        ctx.shadowColor = '#ffd200';
        ctx.shadowBlur = 18;

        // Orbiting energy ring
        ctx.strokeStyle = 'rgba(255, 210, 0, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, it.visualRadius * 1.6 * pulse, it.visualRadius * 0.7 * pulse, this.animTime * 3, 0, Math.PI * 2);
        ctx.stroke();

        // Core Orb
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, it.visualRadius * pulse);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.5, '#ffd200');
        grad.addColorStop(1, '#ff0844');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, it.visualRadius * pulse, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  }

  _drawSpeedLines(ctx, game, cameraY, speedRatio) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${speedRatio * 0.35})`;
    ctx.lineWidth = 1.5;

    for (const sl of this.speedLines) {
      sl.y += (game.speed * 0.05 + 8) * sl.speed;
      if (sl.y > cameraY + 800) {
        sl.y = cameraY - 100;
        sl.x = game.course.getCenter(game.depth) + (Math.random() - 0.5) * 220;
      }
      ctx.beginPath();
      ctx.moveTo(sl.x, sl.y);
      ctx.lineTo(sl.x, sl.y + sl.len * (1 + speedRatio * 1.5));
      ctx.stroke();
    }
  }

  _drawParticles(ctx) {
    // 1. Physics particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Floating text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 0.8;
      ft.life -= ft.decay;

      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 6;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  _drawPlayer(ctx, game, speedRatio) {
    const px = game.x;
    const py = game.depth;
    const isPowered = game.timeMs < game.invincibleUntilMs;

    ctx.save();
    ctx.translate(px, py);

    // Lateral tilt based on steering
    let tilt = 0;
    if (game.input.left) tilt = -0.18;
    if (game.input.right) tilt = 0.18;
    if (this.grazeReactionTimer > 0) {
      tilt += Math.sin(this.grazeReactionTimer * 0.8) * 0.2;
    }
    ctx.rotate(tilt);

    // Speed stretch & collision crumple
    let stretchY = 1.0 + speedRatio * 0.25;
    let stretchX = 1.0 - speedRatio * 0.15;
    if (this.crumpleAmount > 0.5) {
      stretchY -= this.crumpleAmount * 0.03;
      stretchX += this.crumpleAmount * 0.03;
    }
    ctx.scale(stretchX, stretchY);

    // 1. Dynamic Headlight Cone
    const lightGrad = ctx.createRadialGradient(0, 10, 5, 0, 180, 200);
    lightGrad.addColorStop(0, isPowered ? 'rgba(0, 242, 254, 0.45)' : 'rgba(255, 240, 180, 0.35)');
    lightGrad.addColorStop(1, 'rgba(255, 240, 180, 0.0)');

    ctx.fillStyle = lightGrad;
    ctx.beginPath();
    ctx.moveTo(-10, 5);
    ctx.lineTo(-80, 220);
    ctx.lineTo(80, 220);
    ctx.lineTo(10, 5);
    ctx.closePath();
    ctx.fill();

    // 2. Thruster Flame / Exhaust Trail
    if (game.phase === 'playing' && (game.input.down || speedRatio > 0.3)) {
      const flameLen = 15 + speedRatio * 25 + Math.random() * 8;
      const flameGrad = ctx.createLinearGradient(0, -10, 0, -10 - flameLen);
      flameGrad.addColorStop(0, '#ffffff');
      flameGrad.addColorStop(0.4, isPowered ? '#00f2fe' : '#ff9900');
      flameGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');

      ctx.fillStyle = flameGrad;
      ctx.beginPath();
      ctx.moveTo(-8, -12);
      ctx.lineTo(0, -12 - flameLen);
      ctx.lineTo(8, -12);
      ctx.closePath();
      ctx.fill();
    }

    // 3. Drill-Pod Chassis Body
    const bodyGrad = ctx.createLinearGradient(-PLAYER_RADIUS, 0, PLAYER_RADIUS, 0);
    if (isPowered) {
      bodyGrad.addColorStop(0, '#00f2fe');
      bodyGrad.addColorStop(0.5, '#ffffff');
      bodyGrad.addColorStop(1, '#4facfe');
    } else {
      bodyGrad.addColorStop(0, '#e65c00');
      bodyGrad.addColorStop(0.5, '#f9d423');
      bodyGrad.addColorStop(1, '#e65c00');
    }

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#22222b';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.roundRect(-PLAYER_RADIUS, -PLAYER_RADIUS, PLAYER_RADIUS * 2, PLAYER_RADIUS * 1.8, 8);
    ctx.fill();
    ctx.stroke();

    // 4. Front Rotating Drill Cone
    ctx.save();
    ctx.translate(0, PLAYER_RADIUS * 0.8);
    const drillGrad = ctx.createLinearGradient(-10, 0, 10, 0);
    drillGrad.addColorStop(0, '#8892b0');
    drillGrad.addColorStop(0.5, '#ffffff');
    drillGrad.addColorStop(1, '#4a5568');

    ctx.fillStyle = drillGrad;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(10, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Drill spiral grooves
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 1.5;
    const drillOffset = Math.sin(this.drillAngle) * 4;
    ctx.beginPath();
    ctx.moveTo(-6 + drillOffset, 4);
    ctx.lineTo(6 - drillOffset, 8);
    ctx.stroke();
    ctx.restore();

    // 5. Expressive Optical Visor (The Machine's Face!)
    ctx.fillStyle = '#11131c';
    ctx.beginPath();
    ctx.roundRect(-PLAYER_RADIUS * 0.75, -PLAYER_RADIUS * 0.6, PLAYER_RADIUS * 1.5, PLAYER_RADIUS * 0.8, 4);
    ctx.fill();

    // Expressive glowing eye
    let eyeColor = '#00f2fe';
    if (game.phase === 'gameover') {
      eyeColor = '#4a5568'; // Spent / dimmed
    } else if (this.grazeReactionTimer > 0) {
      eyeColor = '#38ef7d'; // Near miss thrill
    } else if (speedRatio > 0.7) {
      eyeColor = '#ff0844'; // Extreme speed focus
    }

    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = 6;

    if (game.phase === 'gameover') {
      // Slanted tired eyes - -
      ctx.fillRect(-6, -PLAYER_RADIUS * 0.25, 4, 1.5);
      ctx.fillRect(2, -PLAYER_RADIUS * 0.25, 4, 1.5);
    } else if (this.eyeBlinking) {
      // Blink line
      ctx.fillRect(-6, -PLAYER_RADIUS * 0.25, 12, 1.5);
    } else if (this.grazeReactionTimer > 0) {
      // Wide open shocked / thrilled eyes O O
      ctx.beginPath();
      ctx.arc(-4, -PLAYER_RADIUS * 0.25, 3.5, 0, Math.PI * 2);
      ctx.arc(4, -PLAYER_RADIUS * 0.25, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal / focused visor pupil
      const lookX = tilt * 15;
      ctx.beginPath();
      ctx.arc(-3.5 + lookX, -PLAYER_RADIUS * 0.25, 2.5, 0, Math.PI * 2);
      ctx.arc(3.5 + lookX, -PLAYER_RADIUS * 0.25, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawHUD(ctx, game, width, height, touchStick) {
    ctx.save();

    // 1. Top Bar: Chrono-Timer (Remaining Time)
    const barWidth = Math.min(280, width * 0.7);
    const barHeight = 12;
    const barX = (width - barWidth) / 2;
    const barY = 24;

    const timeRatio = Math.max(0, Math.min(1, game.remainingMs / MAX_REMAINING_MS));
    const isCritical = game.remainingMs < 5000 && game.phase === 'playing';

    // Timer background
    ctx.fillStyle = 'rgba(12, 15, 25, 0.8)';
    ctx.strokeStyle = isCritical ? '#ff0844' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 6);
    ctx.fill();
    ctx.stroke();

    // Timer Fill
    const fillWidth = barWidth * timeRatio;
    let timerColor = '#00f2fe';
    if (isCritical) {
      const flash = Math.sin(this.animTime * 15) > 0;
      timerColor = flash ? '#ff0844' : '#ff7e5f';
    } else if (timeRatio < 0.4) {
      timerColor = '#f9d423';
    }

    ctx.fillStyle = timerColor;
    ctx.shadowColor = timerColor;
    ctx.shadowBlur = isCritical ? 10 : 4;
    ctx.beginPath();
    ctx.roundRect(barX + 2, barY + 2, Math.max(0, fillWidth - 4), barHeight - 4, 4);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Remaining seconds text
    const secs = (game.remainingMs / 1000).toFixed(1);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${secs}s`, width / 2, barY - 6);

    // 2. Depth & Speed (Top Left)
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${Math.floor(game.depth)}m`, 20, 32);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('DEPTH', 20, 46);

    // Speedometer
    const speedRatio = (game.speed - CRAWL_SPEED) / (MAX_SPEED - CRAWL_SPEED);
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = speedRatio > 0.8 ? '#ff0844' : '#38ef7d';
    ctx.fillText(`${Math.round(game.speed)} km/h`, 20, 68);

    // 3. Score & Combo (Top Right)
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#ffd200';
    ctx.fillText(`${game.score}`, width - 20, 32);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('SCORE', width - 20, 46);

    if (game.nearMissStreak > 1) {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#38ef7d';
      ctx.fillText(`GRAZE x${game.nearMissStreak}`, width - 20, 68);
    }

    // 4. Power Item Active Bar
    if (game.timeMs < game.invincibleUntilMs) {
      const powerLeftMs = game.invincibleUntilMs - game.timeMs;
      const pRatio = powerLeftMs / 7000;
      const pBarW = 160;
      const pBarX = (width - pBarW) / 2;
      const pBarY = barY + barHeight + 8;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(pBarX, pBarY, pBarW, 6);

      ctx.fillStyle = '#ffd200';
      ctx.shadowColor = '#ffd200';
      ctx.shadowBlur = 8;
      ctx.fillRect(pBarX, pBarY, pBarW * pRatio, 6);
      ctx.shadowBlur = 0;

      ctx.font = 'bold 9px sans-serif';
      ctx.fillStyle = '#ffd200';
      ctx.textAlign = 'center';
      ctx.fillText('HYPER DRIVE ACTIVE', width / 2, pBarY + 16);
    }

    // 5. Virtual Touch Joystick Graphic
    if (touchStick && touchStick.active) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(touchStick.startX, touchStick.startY, 45, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0, 242, 254, 0.6)';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(touchStick.currentX, touchStick.currentY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  _drawReadyOverlay(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 20, 0.4)';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';

    // Title
    ctx.font = '900 36px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 16;
    ctx.fillText('D E L V E', width / 2, height * 0.65);
    ctx.shadowBlur = 0;

    // Subtitle / instructions
    const pulse = 0.7 + Math.sin(this.animTime * 5) * 0.3;
    ctx.fillStyle = `rgba(0, 242, 254, ${pulse})`;
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('HOLD [↓] / [SPACE] OR DRAG DOWN TO DIG', width / 2, height * 0.72);

    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('Steer with [←] [→] or Drag Sideways', width / 2, height * 0.76);

    ctx.restore();
  }

  _drawGameOverOverlay(ctx, game, width, height) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 18, 0.85)';
    ctx.fillRect(0, 0, width, height);

    const cardW = Math.min(320, width * 0.88);
    const cardH = 340;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;

    // Card background
    ctx.fillStyle = '#131624';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';

    // Header
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillStyle = '#ff7e5f';
    ctx.fillText('RUN COMPLETE', width / 2, cardY + 36);

    // Rank Badge
    const rankColors = {
      S: '#ffd200',
      A: '#ff0844',
      B: '#00f2fe',
      C: '#38ef7d',
      D: '#a0aec0'
    };
    const rColor = rankColors[game.rank] || '#ffffff';

    ctx.shadowColor = rColor;
    ctx.shadowBlur = 14;
    ctx.font = '900 52px system-ui, sans-serif';
    ctx.fillStyle = rColor;
    ctx.fillText(game.rank || 'D', width / 2, cardY + 98);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText('GRADE', width / 2, cardY + 116);

    // Stats Grid
    ctx.textAlign = 'left';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('Score', cardX + 30, cardY + 150);
    ctx.fillText('Session Best', cardX + 30, cardY + 175);
    ctx.fillText('Depth Delved', cardX + 30, cardY + 200);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#ffd200';
    ctx.fillText(`${game.score}`, cardX + cardW - 30, cardY + 150);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${game.sessionBestScore}`, cardX + cardW - 30, cardY + 175);
    ctx.fillText(`${Math.floor(game.depth)}m`, cardX + cardW - 30, cardY + 200);

    // Signature Stat Callout
    const sig = game.getSignatureStat();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.roundRect(cardX + 20, cardY + 218, cardW - 40, 42, 8);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillText(sig.label.toUpperCase(), width / 2, cardY + 234);

    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = '#38ef7d';
    ctx.fillText(sig.value, width / 2, cardY + 251);

    // Restart button / prompt
    const pulse = 0.8 + Math.sin(this.animTime * 6) * 0.2;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = `rgba(0, 242, 254, ${pulse})`;
    ctx.fillText('PRESS [R] OR TAP TO DELVE AGAIN', width / 2, cardY + 295);

    ctx.restore();
  }
}
