// Renderer for STOMP Game
class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Visual particles & effects (view-only dressing)
    this.particles = [];
    this.floatingTexts = [];
    this.screenShake = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;

    // Animation timers
    this.animTime = 0;
    this.treadPhase = 0;
    this.blinkTimer = 0;
    this.isBlinking = false;

    // Track previous states for juice triggers
    this.lastProcessedEventSeq = 0;

    // Touch control visuals
    this.touchSteerActive = false;
    this.touchSteerAnchorX = 0;
    this.touchSteerAnchorY = 0;
    this.touchSteerCurrentX = 0;
    this.touchSteerCurrentY = 0;
    this.touchJumpActive = false;
  }

  triggerScreenShake(amount) {
    this.screenShake = Math.max(this.screenShake, amount);
  }

  addTextPop(x, y, text, color = '#38bdf8', size = 18) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      vy: -1.8,
      alpha: 1.0,
      life: 50,
      maxLife: 50,
    });
  }

  addSparkBurst(x, y, color = '#38bdf8', count = 16, speed = 4) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = speed * (0.6 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        radius: 2 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 0.03 + Math.random() * 0.03,
        gravity: 0.1,
      });
    }
  }

  addDebrisBurst(x, y, color = '#f59e0b', count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 2,
        color,
        radius: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 0.02,
        gravity: 0.2,
      });
    }
  }

  addLandingDust(x, y) {
    for (let i = -1; i <= 1; i += 2) {
      for (let j = 0; j < 4; j++) {
        this.particles.push({
          x: x + i * 15,
          y: y - 2,
          vx: i * (1.5 + Math.random() * 2),
          vy: -0.5 - Math.random() * 1.5,
          color: '#94a3b8',
          radius: 2.5 + Math.random() * 2.5,
          alpha: 0.7,
          decay: 0.04,
          gravity: 0.05,
        });
      }
    }
  }

  processEvents(recentEvents, sim) {
    for (const ev of recentEvents) {
      if (ev.sequence > this.lastProcessedEventSeq) {
        this.lastProcessedEventSeq = ev.sequence;

        if (ev.kind === 'machine_jump') {
          this.addLandingDust(sim.machine.x, sim.groundY);
        } else if (ev.kind === 'machine_land') {
          this.triggerScreenShake(3);
          this.addLandingDust(sim.machine.x, sim.groundY);
        } else if (ev.kind === 'ball_bounce_power') {
          this.triggerScreenShake(5);
          this.addSparkBurst(sim.machine.x, sim.machine.y - sim.machine.radius, '#c084fc', 18, 5);
          this.addTextPop(sim.machine.x, sim.machine.y - 45, 'HIGH LAUNCH!', '#c084fc', 16);
        } else if (ev.kind === 'ball_bounce_normal') {
          this.addSparkBurst(sim.machine.x, sim.machine.y - sim.machine.radius, '#38bdf8', 12, 3.5);
        } else if (ev.kind === 'ball_bounce_weak') {
          this.addSparkBurst(sim.machine.x, sim.machine.y - sim.machine.radius, '#94a3b8', 8, 2);
        } else if (ev.kind === 'top_hit') {
          const hitTarget = sim.enemies.find((e) => e.id === ev.enemyId);
          const tx = hitTarget ? hitTarget.x : sim.ball.x;
          const ty = hitTarget ? hitTarget.y : sim.ball.y;

          if (ev.amountMs === 10000) {
            // 3rd hit defeat
            this.triggerScreenShake(10);
            this.addSparkBurst(tx, ty, '#fbbf24', 28, 6.5);
            this.addDebrisBurst(tx, ty, '#f97316', 16);
            this.addTextPop(tx, ty - 25, '+10.0s BURST!', '#fbbf24', 22);
          } else if (ev.amountMs === 5000) {
            // 2nd hit
            this.triggerScreenShake(4);
            this.addSparkBurst(tx, ty, '#38bdf8', 16, 4.5);
            this.addTextPop(tx, ty - 20, '+5.0s HIT 2', '#38bdf8', 18);
          } else {
            // 1st hit
            this.triggerScreenShake(2);
            this.addSparkBurst(tx, ty, '#4ade80', 12, 3.5);
            this.addTextPop(tx, ty - 20, '+3.0s HIT 1', '#4ade80', 16);
          }
        } else if (ev.kind === 'ground_stomp') {
          this.triggerScreenShake(5);
          const walker = sim.enemies.find((e) => e.id === ev.enemyId);
          const tx = walker ? walker.x : sim.machine.x;
          this.addSparkBurst(tx, sim.groundY - 10, '#fbbf24', 16, 4);
          this.addTextPop(tx, sim.groundY - 35, 'STOMP! +1.0s', '#fbbf24', 16);
        } else if (ev.kind === 'wrong_side_hit') {
          this.triggerScreenShake(6);
          const tx = ev.source === 'ball' ? sim.ball.x : sim.machine.x;
          const ty = ev.source === 'ball' ? sim.ball.y : sim.machine.y;
          this.addSparkBurst(tx, ty, '#ef4444', 14, 4);
          this.addTextPop(tx, ty - 20, `${(ev.amountMs / 1000).toFixed(1)}s WRONG HIT!`, '#ef4444', 16);
        } else if (ev.kind === 'ball_drop') {
          this.triggerScreenShake(8);
          this.addSparkBurst(sim.ball.x, sim.groundY, '#ef4444', 20, 5);
          this.addTextPop(sim.machine.x, sim.groundY - 50, '-5.0s BALL DROPPED!', '#ef4444', 18);
        }
      }
    }
  }

  updateVisuals() {
    this.animTime += 1;

    // Screen shake decay
    if (this.screenShake > 0) {
      this.shakeOffsetX = (Math.random() - 0.5) * this.screenShake * 1.5;
      this.shakeOffsetY = (Math.random() - 0.5) * this.screenShake * 1.5;
      this.screenShake *= 0.88;
      if (this.screenShake < 0.2) this.screenShake = 0;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // Blinking eye animation
    this.blinkTimer += 1;
    if (this.blinkTimer > 160) {
      this.isBlinking = true;
      if (this.blinkTimer > 170) {
        this.blinkTimer = 0;
        this.isBlinking = false;
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity || 0;
      p.alpha -= p.decay;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y += t.vy;
      t.life -= 1;
      t.alpha = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  render(sim) {
    this.updateVisuals();
    this.processEvents(sim.recentEvents, sim);

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply screen shake
    ctx.translate(this.shakeOffsetX, this.shakeOffsetY);

    // 1. Background & Atmosphere
    this.drawBackground(ctx, w, h);

    // 2. Air Lanes & Ground
    this.drawLanes(ctx, w, sim);

    // 3. Enemies
    this.drawEnemies(ctx, sim);

    // 4. Machine & Ball
    this.drawMachine(ctx, sim);
    this.drawBall(ctx, sim);

    // 5. Particles & Juice
    this.drawParticles(ctx);
    this.drawFloatingTexts(ctx);

    // 6. HUD
    this.drawHUD(ctx, w, sim);

    // 7. On-Screen Touch Controls
    this.drawTouchControls(ctx, w, h, sim);

    // 8. Opening Stage Anticipation or Game Over Screen
    if (sim.phase === 'ready') {
      this.drawReadyOverlay(ctx, w, h);
    } else if (sim.phase === 'gameover') {
      this.drawGameOverOverlay(ctx, w, h, sim);
    }

    ctx.restore();
  }

  drawBackground(ctx, w, h) {
    // Deep gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Ambient tech grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Ambient floating dust particles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 15; i++) {
      const px = (i * 27 + this.animTime * 0.2) % w;
      const py = (i * 47 + Math.sin(this.animTime * 0.02 + i) * 20 + 300) % 600;
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawLanes(ctx, w, sim) {
    const pulse = Math.sin(this.animTime * 0.06) * 0.15 + 0.85;

    // HIGH LANE (Y = 200)
    const highY = sim.highLaneY;
    ctx.save();
    ctx.strokeStyle = `rgba(192, 132, 252, ${0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, highY);
    ctx.lineTo(w, highY);
    ctx.stroke();

    // High Lane Glow Band
    const highGlow = ctx.createLinearGradient(0, highY - 12, 0, highY + 12);
    highGlow.addColorStop(0, 'rgba(192, 132, 252, 0)');
    highGlow.addColorStop(0.5, `rgba(192, 132, 252, ${0.08 * pulse})`);
    highGlow.addColorStop(1, 'rgba(192, 132, 252, 0)');
    ctx.fillStyle = highGlow;
    ctx.fillRect(0, highY - 12, w, 24);

    // Label
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(192, 132, 252, 0.6)';
    ctx.font = '9px monospace';
    ctx.fillText('HIGH LANE // POWER BOUNCE', 12, highY - 6);
    ctx.restore();

    // LOW LANE (Y = 380)
    const lowY = sim.lowLaneY;
    ctx.save();
    ctx.strokeStyle = `rgba(56, 189, 248, ${0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, lowY);
    ctx.lineTo(w, lowY);
    ctx.stroke();

    // Low Lane Glow Band
    const lowGlow = ctx.createLinearGradient(0, lowY - 12, 0, lowY + 12);
    lowGlow.addColorStop(0, 'rgba(56, 189, 248, 0)');
    lowGlow.addColorStop(0.5, `rgba(56, 189, 248, ${0.08 * pulse})`);
    lowGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = lowGlow;
    ctx.fillRect(0, lowY - 12, w, 24);

    // Label
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.font = '9px monospace';
    ctx.fillText('LOW LANE // NORMAL BOUNCE', 12, lowY - 6);
    ctx.restore();

    // GROUND PLATFORM (Y = 600)
    const groundY = sim.groundY;
    ctx.save();
    // Solid floor
    const floorGrad = ctx.createLinearGradient(0, groundY, 0, groundY + 100);
    floorGrad.addColorStop(0, '#1e293b');
    floorGrad.addColorStop(0.3, '#0f172a');
    floorGrad.addColorStop(1, '#020617');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, groundY, w, 100);

    // Top border rail
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // Hazard stripes
    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    for (let x = -50; x < w + 50; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, groundY + 2);
      ctx.lineTo(x + 15, groundY + 2);
      ctx.lineTo(x + 5, groundY + 18);
      ctx.lineTo(x - 10, groundY + 18);
      ctx.fill();
    }
    ctx.restore();
  }

  drawEnemies(ctx, sim) {
    for (const enemy of sim.enemies) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      if (!enemy.active) {
        // Exploding / dying state
        const progress = enemy.deathTicks / 30;
        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.scale(1 + progress * 0.5, 1 + progress * 0.5);
      }

      if (enemy.lane === 'ground') {
        this.drawWalker(ctx, enemy);
      } else {
        this.drawFlyer(ctx, enemy);
      }

      ctx.restore();
    }
  }

  drawFlyer(ctx, enemy) {
    const isFast = enemy.type === 'fastFlyer';
    const isHigh = enemy.lane === 'high';
    const mainColor = isFast ? '#f43f5e' : '#38bdf8';
    const wingHover = Math.sin(this.animTime * 0.2 + enemy.id) * 3;

    // Wing thrusters
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-22, -6 + wingHover, 8, 12);
    ctx.fillRect(14, -6 - wingHover, 8, 12);

    // Thruster exhaust flame
    const flameH = 4 + Math.random() * 4;
    ctx.fillStyle = isFast ? '#fb7185' : '#38bdf8';
    ctx.fillRect(-20, 6 + wingHover, 4, flameH);
    ctx.fillRect(16, 6 - wingHover, 4, flameH);

    // Main Chassis
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-18, -12, 36, 24, 6);
    ctx.fill();
    ctx.stroke();

    // Dangerous Underside Spikes (Red/Orange warning)
    ctx.fillStyle = '#ef4444';
    for (let sx = -14; sx <= 10; sx += 8) {
      ctx.beginPath();
      ctx.moveTo(sx, 12);
      ctx.lineTo(sx + 4, 18);
      ctx.lineTo(sx + 8, 12);
      ctx.fill();
    }

    // TOP TARGET BUMPER (Cyan / Emerald Green Shield - Hit Here!)
    ctx.fillStyle = '#22c55e';
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-16, -18, 32, 8, 3);
    ctx.fill();
    ctx.stroke();

    // Top chevron indicator
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.lineTo(0, -16);
    ctx.lineTo(6, -12);
    ctx.stroke();

    // Central Visor & Damage state
    ctx.fillStyle = enemy.hitsTaken === 2 ? '#f59e0b' : enemy.hitsTaken === 1 ? '#38bdf8' : '#10b981';
    ctx.fillRect(-10, -5, 20, 8);

    // 3 Damage Pip Indicators on hull
    for (let p = 0; p < 3; p++) {
      const px = -8 + p * 8;
      ctx.fillStyle = p < enemy.hitsTaken ? '#ef4444' : '#334155';
      ctx.beginPath();
      ctx.arc(px, 7, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Damage effects (Smoke & sparks on 1 or 2 hits)
    if (enemy.hitsTaken >= 1 && enemy.active) {
      if (Math.random() < 0.3) {
        this.particles.push({
          x: enemy.x + (Math.random() - 0.5) * 16,
          y: enemy.y - 10,
          vx: (Math.random() - 0.5) * 1,
          vy: -1.5,
          color: '#64748b',
          radius: 3,
          alpha: 0.6,
          decay: 0.04,
          gravity: -0.02,
        });
      }
    }
    if (enemy.hitsTaken >= 2 && enemy.active) {
      if (Math.random() < 0.4) {
        this.particles.push({
          x: enemy.x + (Math.random() - 0.5) * 20,
          y: enemy.y + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          color: '#fbbf24',
          radius: 2,
          alpha: 0.9,
          decay: 0.08,
          gravity: 0,
        });
      }
    }
  }

  drawWalker(ctx, enemy) {
    // Mechanical Ground Walker
    const legWobble = Math.sin(this.animTime * 0.3 + enemy.id) * 3;

    // Tread Legs
    ctx.fillStyle = '#475569';
    ctx.fillRect(-16 + legWobble, 6, 8, 8);
    ctx.fillRect(8 - legWobble, 6, 8, 8);

    // Main Body
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-16, -6, 32, 14, 4);
    ctx.fill();
    ctx.stroke();

    // Glowing eye
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(enemy.vx > 0 ? 4 : -12, -2, 8, 5);

    // Stomp Button on Top
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(-12, -12, 24, 6);
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 1;
    ctx.strokeRect(-12, -12, 24, 6);

    // Stomp downward arrow
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-4, -10);
    ctx.lineTo(0, -7);
    ctx.lineTo(4, -10);
    ctx.stroke();
  }

  drawMachine(ctx, sim) {
    const m = sim.machine;
    const b = sim.ball;
    ctx.save();
    ctx.translate(m.x, m.y);

    // Tread movement animation
    if (m.vx !== 0) {
      this.treadPhase = (this.treadPhase + (m.vx > 0 ? 0.3 : -0.3)) % (Math.PI * 2);
    }

    // Squash and stretch calculations
    let scaleX = 1.0;
    let scaleY = 1.0;
    if (!m.grounded) {
      if (m.vy < -100) {
        // Jumping up (stretch)
        scaleX = 0.9;
        scaleY = 1.15;
      } else if (m.vy > 100) {
        // Falling (slight narrow)
        scaleX = 0.95;
        scaleY = 1.05;
      }
    } else {
      // Grounded idle breathing
      scaleY = 1.0 + Math.sin(this.animTime * 0.08) * 0.03;
      scaleX = 1.0 / scaleY;
    }

    ctx.scale(scaleX, scaleY);

    // 1. Treads / Wheels Base
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -10, 44, 10, 4);
    ctx.fill();
    ctx.stroke();

    // Tread wheels
    ctx.fillStyle = '#475569';
    for (let wx = -15; wx <= 15; wx += 10) {
      ctx.beginPath();
      ctx.arc(wx, -5, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Wheel spokes
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wx - Math.cos(this.treadPhase) * 3, -5 - Math.sin(this.treadPhase) * 3);
      ctx.lineTo(wx + Math.cos(this.treadPhase) * 3, -5 + Math.sin(this.treadPhase) * 3);
      ctx.stroke();
    }

    // 2. Robot Hull / Body
    const bodyGrad = ctx.createLinearGradient(0, -40, 0, -10);
    bodyGrad.addColorStop(0, '#38bdf8');
    bodyGrad.addColorStop(0.6, '#0284c7');
    bodyGrad.addColorStop(1, '#0369a1');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-20, -38, 40, 30, 8);
    ctx.fill();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 3. Digital Screen Face
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-14, -32, 28, 16, 4);
    ctx.fill();

    // 4. Expressive Eyes on Visor
    ctx.fillStyle = '#38bdf8';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;

    if (sim.phase === 'gameover') {
      // Dead eyes (X X)
      ctx.strokeStyle = '#ef4444';
      [-7, 7].forEach((ex) => {
        ctx.beginPath();
        ctx.moveTo(ex - 3, -27);
        ctx.lineTo(ex + 3, -21);
        ctx.moveTo(ex + 3, -27);
        ctx.lineTo(ex - 3, -21);
        ctx.stroke();
      });
    } else if (this.isBlinking) {
      // Blinking lines
      ctx.beginPath();
      ctx.moveTo(-10, -24);
      ctx.lineTo(-4, -24);
      ctx.moveTo(4, -24);
      ctx.lineTo(10, -24);
      ctx.stroke();
    } else if (b.lastBounceKind === 'power' && !m.grounded) {
      // Excited wide eyes on power launch
      ctx.beginPath();
      ctx.arc(-7, -24, 3.5, 0, Math.PI * 2);
      ctx.arc(7, -24, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal cute eyes looking slightly toward ball
      const lookOffsetX = Math.max(-2, Math.min(2, (b.x - m.x) * 0.04));
      const lookOffsetY = Math.max(-2, Math.min(1, (b.y - m.y) * 0.03));
      ctx.beginPath();
      ctx.arc(-7 + lookOffsetX, -24 + lookOffsetY, 2.5, 0, Math.PI * 2);
      ctx.arc(7 + lookOffsetX, -24 + lookOffsetY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. TOP BOUNCE SURFACE (Clear authored target pad)
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-22, -44, 44, 7, 3);
    ctx.fill();
    ctx.stroke();

    // Top Pad Light Indicator
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -41, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawBall(ctx, sim) {
    const b = sim.ball;
    const m = sim.machine;
    ctx.save();

    let ballX = b.x;
    let ballY = b.y;

    if (sim.phase === 'ready') {
      // Resting on machine top
      ballX = m.x;
      ballY = m.y - m.radius - b.radius;
    }

    ctx.translate(ballX, ballY);

    // Ball squash and stretch based on velocity
    if (b.active) {
      const spd = Math.hypot(b.vx, b.vy);
      const angle = Math.atan2(b.vy, b.vx);
      ctx.rotate(angle);
      const stretch = Math.min(1.4, 1.0 + spd * 0.0006);
      const squash = 1.0 / stretch;
      ctx.scale(stretch, squash);
    }

    // Glowing Aura
    const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, b.radius * 2);
    aura.addColorStop(0, 'rgba(251, 191, 36, 1)');
    aura.addColorStop(0.4, 'rgba(245, 158, 11, 0.6)');
    aura.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Solid Ball Core
    const coreGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, b.radius);
    coreGrad.addColorStop(0, '#ffffff');
    coreGrad.addColorStop(0.3, '#fef08a');
    coreGrad.addColorStop(0.8, '#f59e0b');
    coreGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawFloatingTexts(ctx) {
    for (const t of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, t.alpha);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.font = `bold ${t.size}px monospace, sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }

  drawHUD(ctx, w, sim) {
    ctx.save();

    // Top Header Banner
    const barGrad = ctx.createLinearGradient(0, 0, 0, 56);
    barGrad.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
    barGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, w, 60);

    // Time Clock
    const sec = (sim.remainingMs / 1000).toFixed(1);
    const isLowTime = sim.remainingMs < 10000 && sim.phase === 'playing';
    const timeColor = isLowTime ? (Math.floor(this.animTime / 10) % 2 === 0 ? '#ef4444' : '#fbbf24') : '#38bdf8';

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('TIME', 16, 20);

    ctx.fillStyle = timeColor;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${sec}s`, 16, 42);

    // Score
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText('SCORE', w / 2, 20);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(String(sim.score).padStart(5, '0'), w / 2, 42);

    // Rank Badge
    ctx.textAlign = 'right';
    const rank = sim.getRank();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`TIER ${sim.difficulty}`, w - 16, 20);

    ctx.fillStyle = rank.includes('S') ? '#fbbf24' : '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`RANK ${rank}`, w - 16, 42);

    // Clean Streak indicator if > 1
    if (sim.currentCleanSequence > 1 && sim.phase === 'playing') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`⚡ ${sim.currentCleanSequence}x CLEAN PURSUIT`, w / 2, 60);
    }

    ctx.restore();
  }

  drawTouchControls(ctx, w, h, sim) {
    const controlsY = 615;

    // LEFT ZONE: STEER / MOVE
    ctx.save();
    const leftPadW = w * 0.48;
    const leftPadH = h - controlsY - 10;

    // Subtle outline
    ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(10, controlsY, leftPadW - 10, leftPadH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('◀ STEER / MOVE ▶', leftPadW / 2 + 5, controlsY + leftPadH / 2 + 4);

    // If active touch/drag on steer pad, draw dynamic thumbstick
    if (this.touchSteerActive) {
      // Anchor Base
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.touchSteerAnchorX, this.touchSteerAnchorY, 26, 0, Math.PI * 2);
      ctx.stroke();

      // Dynamic Knob
      ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.beginPath();
      ctx.arc(this.touchSteerCurrentX, this.touchSteerAnchorY, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // RIGHT ZONE: JUMP BUTTON
    ctx.save();
    const rightPadX = w * 0.52;
    const rightPadW = w * 0.48 - 10;
    const rightPadH = h - controlsY - 10;

    ctx.fillStyle = this.touchJumpActive ? 'rgba(56, 189, 248, 0.4)' : 'rgba(30, 41, 59, 0.5)';
    ctx.strokeStyle = this.touchJumpActive ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rightPadX, controlsY, rightPadW, rightPadH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.touchJumpActive ? '#ffffff' : '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('JUMP ⬆', rightPadX + rightPadW / 2, controlsY + rightPadH / 2 + 5);
    ctx.restore();
  }

  drawReadyOverlay(ctx, w, h) {
    // Stage in anticipation: at most one short line instruction
    ctx.save();
    const pulse = Math.sin(this.animTime * 0.08) * 0.2 + 0.8;
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TOUCH / ARROWS TO MOVE • TAP / SPACE TO JUMP', w / 2, 550);
    ctx.restore();
  }

  drawGameOverOverlay(ctx, w, h, sim) {
    ctx.save();
    // Glass dim backdrop
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(0, 0, w, h);

    // Box Container
    const boxW = w - 40;
    const boxH = 340;
    const boxX = 20;
    const boxY = 120;

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 24px monospace';
    ctx.fillText('TIME UP', w / 2, boxY + 40);

    // Final Score
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText('FINAL SCORE', w / 2, boxY + 75);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(String(sim.score), w / 2, boxY + 115);

    // Rank Badge
    const rank = sim.getRank();
    ctx.fillStyle = rank.includes('S') ? '#fbbf24' : '#38bdf8';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`FINAL RANK: ${rank}`, w / 2, boxY + 150);

    // Stats Grid
    ctx.textAlign = 'left';
    ctx.font = '12px monospace';
    ctx.fillStyle = '#94a3b8';

    const statLeft = boxX + 30;
    const statRight = boxX + boxW - 30;

    ctx.fillText('Targets Defeated:', statLeft, boxY + 190);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(String(sim.airEnemiesDefeated), statRight, boxY + 190);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Clean Top Hits:', statLeft, boxY + 215);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(String(sim.topHits), statRight, boxY + 215);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Longest Clean Streak:', statLeft, boxY + 240);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(String(sim.longestCleanSequence), statRight, boxY + 240);

    // Restart prompt
    ctx.textAlign = 'center';
    const pulse = Math.sin(this.animTime * 0.1) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
    ctx.font = 'bold 15px monospace';
    ctx.fillText('TAP OR PRESS R TO PLAY AGAIN', w / 2, boxY + 295);

    ctx.restore();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GameRenderer };
}
