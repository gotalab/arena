// Procedural Canvas Renderer with Rich Character Animation and Feedback

import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  GROUND_Y,
  LOW_LANE_Y,
  HIGH_LANE_Y,
  MACHINE_NORMAL_APEX_Y,
  MACHINE_RADIUS,
  BALL_RADIUS
} from './constants.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.time = 0;
  }

  render(game) {
    this.time += 0.025;
    const ctx = this.ctx;

    ctx.save();

    // Screen Shake
    if (game.screenShake > 0) {
      const sx = (Math.sin(this.time * 45) * game.screenShake);
      const sy = (Math.cos(this.time * 38) * game.screenShake);
      ctx.translate(sx, sy);
    }

    // 1. Background
    this.drawBackground(ctx, game);

    // 2. Air Lanes & Geometry Guides
    this.drawLanes(ctx, game);

    // 3. Ground Walkers & Airborne Enemies
    this.drawEnemies(ctx, game);

    // 4. Machine
    this.drawMachine(ctx, game);

    // 5. Ball
    this.drawBall(ctx, game);

    // 6. Particles
    this.drawParticles(ctx, game);

    // 7. Floating Texts
    this.drawFloatingTexts(ctx, game);

    // 8. Ground Platform Deck
    this.drawGround(ctx, game);

    // 9. HUD (Clock, Score, Rank, Clean Streak)
    this.drawHUD(ctx, game);

    // 10. Overlays: Ready Prompt or Game Over
    if (game.phase === 'ready') {
      this.drawReadyPrompt(ctx, game);
    } else if (game.phase === 'game_over') {
      this.drawGameOver(ctx, game);
    }

    ctx.restore();
  }

  drawBackground(ctx, game) {
    // Cyberpunk twilight gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, STAGE_HEIGHT);
    bgGrad.addColorStop(0, '#0a0e1a');
    bgGrad.addColorStop(0.5, '#10172c');
    bgGrad.addColorStop(1, '#0e1424');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    // Subtle background grid lines
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 20; x < STAGE_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GROUND_Y);
      ctx.stroke();
    }
    for (let y = 40; y < GROUND_Y; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(STAGE_WIDTH, y);
      ctx.stroke();
    }

    // Distant soft atmospheric dust motes
    ctx.fillStyle = 'rgba(0, 220, 255, 0.15)';
    for (let i = 0; i < 8; i++) {
      const mx = (Math.sin(this.time * 0.4 + i * 2.3) * 0.5 + 0.5) * STAGE_WIDTH;
      const my = (Math.cos(this.time * 0.3 + i * 1.7) * 0.5 + 0.5) * (GROUND_Y - 80) + 40;
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawLanes(ctx, game) {
    const pulseHigh = 0.5 + 0.5 * Math.sin(this.time * 3);
    const pulseLow = 0.5 + 0.5 * Math.sin(this.time * 3 + 1.5);

    // High Lane (Y = 140)
    ctx.save();
    ctx.strokeStyle = `rgba(0, 230, 255, ${0.35 + pulseHigh * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = -this.time * 15;
    ctx.beginPath();
    ctx.moveTo(10, HIGH_LANE_Y);
    ctx.lineTo(STAGE_WIDTH - 10, HIGH_LANE_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // High Lane subtle badge
    ctx.fillStyle = 'rgba(0, 230, 255, 0.55)';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('HIGH LANE 2', 12, HIGH_LANE_Y - 5);
    ctx.restore();

    // Low Lane (Y = 280)
    ctx.save();
    ctx.strokeStyle = `rgba(255, 195, 0, ${0.4 + pulseLow * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.lineDashOffset = this.time * 15;
    ctx.beginPath();
    ctx.moveTo(10, LOW_LANE_Y);
    ctx.lineTo(STAGE_WIDTH - 10, LOW_LANE_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Low Lane subtle badge
    ctx.fillStyle = 'rgba(255, 195, 0, 0.65)';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('LOW LANE 1', 12, LOW_LANE_Y - 5);
    ctx.restore();

    // Normal Machine Apex Marker (Y = 402) - subtle cue
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 12]);
    ctx.beginPath();
    ctx.moveTo(25, MACHINE_NORMAL_APEX_Y);
    ctx.lineTo(STAGE_WIDTH - 25, MACHINE_NORMAL_APEX_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.font = '8px monospace';
    ctx.fillText('JUMP CEILING', 28, MACHINE_NORMAL_APEX_Y - 3);
    ctx.restore();
  }

  drawGround(ctx, game) {
    // Heavy metallic platform deck
    const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, STAGE_HEIGHT);
    groundGrad.addColorStop(0, '#151d2f');
    groundGrad.addColorStop(0.2, '#0c1220');
    groundGrad.addColorStop(1, '#060911');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, GROUND_Y, STAGE_WIDTH, STAGE_HEIGHT - GROUND_Y);

    // Neon edge highlight line
    ctx.save();
    ctx.strokeStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(STAGE_WIDTH, GROUND_Y);
    ctx.stroke();
    ctx.restore();

    // Hazard stripes along ground edge
    ctx.save();
    ctx.fillStyle = 'rgba(0, 255, 204, 0.08)';
    for (let x = 0; x < STAGE_WIDTH; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x + 12, GROUND_Y);
      ctx.lineTo(x + 2, GROUND_Y + 12);
      ctx.lineTo(x - 10, GROUND_Y + 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawMachine(ctx, game) {
    const m = game.machine;
    const isReady = (game.phase === 'ready');
    const isOver = (game.phase === 'game_over');

    ctx.save();
    ctx.translate(m.x, m.y + m.suspensionY);

    // Idle bobbing when in ready or waiting
    const idleBob = (isReady || m.expression === 'ready') ? Math.sin(this.time * 6) * 1.5 : 0;
    ctx.translate(0, idleBob);

    // 1. Treads / Base Wheels
    const treadWidth = m.radius * 2.2;
    const treadHeight = 9;
    const treadY = m.radius - 8;

    // Tread housing
    ctx.fillStyle = '#1e2838';
    ctx.strokeStyle = '#0f1724';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-treadWidth / 2, treadY, treadWidth, treadHeight, 4);
    ctx.fill();
    ctx.stroke();

    // Rotating tread segments
    ctx.fillStyle = '#4a5b78';
    for (let i = -3; i <= 3; i++) {
      const toothX = i * 6 + ((m.treadPhase % 6 + 6) % 6) - 3;
      if (toothX > -treadWidth / 2 + 2 && toothX < treadWidth / 2 - 2) {
        ctx.fillRect(toothX - 1, treadY + 1, 2, treadHeight - 2);
      }
    }

    // 2. Suspension Coils
    ctx.strokeStyle = '#8a9bb8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-10, treadY);
    ctx.lineTo(-6, -2);
    ctx.lineTo(-12, -8);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(10, treadY);
    ctx.lineTo(6, -2);
    ctx.lineTo(12, -8);
    ctx.stroke();

    // 3. Main Chassis Body
    const bodyWidth = m.radius * 1.8;
    const bodyHeight = m.radius * 1.3;
    const bodyGrad = ctx.createLinearGradient(-bodyWidth / 2, -bodyHeight, bodyWidth / 2, 5);
    bodyGrad.addColorStop(0, '#2d3d57');
    bodyGrad.addColorStop(0.5, '#1e2b40');
    bodyGrad.addColorStop(1, '#151e2d');

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#3df2ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-bodyWidth / 2, -bodyHeight / 2 - 2, bodyWidth, bodyHeight, 7);
    ctx.fill();
    ctx.stroke();

    // Glowing Power Core (heart)
    let coreColor = '#00ffcc';
    if (m.expression === 'bounce') coreColor = '#ffeb3b';
    if (m.expression === 'sparkle') coreColor = '#ffdd00';
    if (m.expression === 'dismay') coreColor = '#ff3366';
    if (m.expression === 'deflated' || isOver) coreColor = '#4a5b78';

    ctx.save();
    ctx.fillStyle = coreColor;
    ctx.shadowColor = coreColor;
    ctx.shadowBlur = (isOver ? 0 : 8);
    ctx.beginPath();
    ctx.arc(0, 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 4. Flat Top Bumper Launch Platform (Clear flat landing zone)
    const bumperWidth = m.radius * 2.3;
    const bumperHeight = 7;
    const bumperY = -m.radius;

    const bumperGrad = ctx.createLinearGradient(-bumperWidth / 2, bumperY, bumperWidth / 2, bumperY + bumperHeight);
    bumperGrad.addColorStop(0, '#5a7396');
    bumperGrad.addColorStop(0.5, '#7b98c2');
    bumperGrad.addColorStop(1, '#4a6080');

    ctx.fillStyle = bumperGrad;
    ctx.strokeStyle = (m.expression === 'windup' || m.expression === 'bounce') ? '#fff' : '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-bumperWidth / 2, bumperY - bumperHeight / 2, bumperWidth, bumperHeight, 3);
    ctx.fill();
    ctx.stroke();

    // Chevrons / pads on top bumper
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(-12, bumperY - 2, 5, 3);
    ctx.fillRect(-2, bumperY - 2, 4, 3);
    ctx.fillRect(7, bumperY - 2, 5, 3);

    // 5. Digital Expressive Face
    this.drawMachineFace(ctx, m, isReady, isOver);

    ctx.restore();
  }

  drawMachineFace(ctx, m, isReady, isOver) {
    const eyeY = -m.radius / 2 - 1;
    const eyeSpacing = 8;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (isOver || m.expression === 'spent') {
      // Sleeping / spent shut eyes: -- --
      ctx.strokeStyle = 'rgba(100, 140, 180, 0.6)';
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 4, eyeY);
      ctx.lineTo(-eyeSpacing + 4, eyeY);
      ctx.moveTo(eyeSpacing - 4, eyeY);
      ctx.lineTo(eyeSpacing + 4, eyeY);
      ctx.stroke();
    } else if (m.expression === 'deflated') {
      // Droopy sad eyes: v v
      ctx.strokeStyle = '#3df2ff';
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 4, eyeY - 2);
      ctx.lineTo(-eyeSpacing, eyeY + 3);
      ctx.lineTo(-eyeSpacing + 4, eyeY - 2);
      ctx.moveTo(eyeSpacing - 4, eyeY - 2);
      ctx.lineTo(eyeSpacing, eyeY + 3);
      ctx.lineTo(eyeSpacing + 4, eyeY - 2);
      ctx.stroke();
    } else if (m.expression === 'dismay') {
      // Dismayed zigzag / spiral eyes: > <
      ctx.strokeStyle = '#ff3366';
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 4, eyeY - 3);
      ctx.lineTo(-eyeSpacing + 3, eyeY);
      ctx.lineTo(-eyeSpacing - 4, eyeY + 3);
      ctx.moveTo(eyeSpacing + 4, eyeY - 3);
      ctx.lineTo(eyeSpacing - 3, eyeY);
      ctx.lineTo(eyeSpacing + 4, eyeY + 3);
      ctx.stroke();
    } else if (m.expression === 'sparkle') {
      // Star eyes: ★ ★
      ctx.fillStyle = '#ffeb3b';
      ctx.shadowColor = '#ffeb3b';
      ctx.shadowBlur = 6;
      [-eyeSpacing, eyeSpacing].forEach(ex => {
        ctx.beginPath();
        ctx.arc(ex, eyeY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(ex - 1, eyeY - 4, 2, 8);
        ctx.fillRect(ex - 4, eyeY - 1, 8, 2);
      });
    } else if (m.expression === 'bounce') {
      // Joyful arched eyes: ^ ^
      ctx.strokeStyle = '#00ffcc';
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY + 2, 4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(eyeSpacing, eyeY + 2, 4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else if (m.expression === 'windup') {
      // Tense focused squint
      ctx.strokeStyle = '#ffeb3b';
      ctx.beginPath();
      ctx.moveTo(-eyeSpacing - 4, eyeY);
      ctx.lineTo(-eyeSpacing + 4, eyeY - 2);
      ctx.moveTo(eyeSpacing - 4, eyeY - 2);
      ctx.lineTo(eyeSpacing + 4, eyeY);
      ctx.stroke();
    } else {
      // Normal / Ready: Large glowing turquoise eyes looking upward
      ctx.fillStyle = '#00ffcc';
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY, 3.5, 0, Math.PI * 2);
      ctx.arc(eyeSpacing, eyeY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Pupil looking up
      ctx.fillStyle = '#0a101d';
      ctx.beginPath();
      ctx.arc(-eyeSpacing, eyeY - 1, 1.6, 0, Math.PI * 2);
      ctx.arc(eyeSpacing, eyeY - 1, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBall(ctx, game) {
    const b = game.ball;
    if (!b.active && game.phase !== 'ready') return;

    ctx.save();
    ctx.translate(b.x, b.y);

    // Idle bobbing in ready state
    if (game.phase === 'ready') {
      const idleBob = Math.sin(this.time * 6) * 1.5;
      ctx.translate(0, idleBob);
    }

    // Velocity-aligned squash and stretch
    const angle = Math.atan2(b.vy, b.vx);
    ctx.rotate(angle);
    ctx.scale(b.scaleY, b.scaleX); // elongate along trajectory

    // Glowing aura
    let ballColor = '#00ffcc';
    if (b.lastBounceKind === 'power') ballColor = '#ffeb3b';
    if (b.expression === 'dizzy') ballColor = '#ff3366';

    const ballGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, b.radius);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.4, ballColor);
    ballGrad.addColorStop(1, '#0088aa');

    ctx.save();
    ctx.fillStyle = ballGrad;
    ctx.shadowColor = ballColor;
    ctx.shadowBlur = (b.lastBounceKind === 'power' ? 14 : 8);
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Outer rim
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Cute animated eyes on the ball
    ctx.rotate(-angle); // Keep eyes upright

    if (b.expression === 'dizzy') {
      ctx.strokeStyle = '#331111';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(-3, -1, 2, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(3, -1, 2, 0, Math.PI * 1.5);
      ctx.stroke();
    } else {
      // Normal / Excited eyes
      ctx.fillStyle = '#0a101d';
      const lookX = Math.sign(b.vx || 0) * 1.2;
      const lookY = Math.sign(b.vy || 0) * 1.2;

      ctx.beginPath();
      ctx.arc(-3 + lookX, -1 + lookY, 1.8, 0, Math.PI * 2);
      ctx.arc(3 + lookX, -1 + lookY, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Eye glint
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-3.5 + lookX, -1.8 + lookY, 0.7, 0, Math.PI * 2);
      ctx.arc(2.5 + lookX, -1.8 + lookY, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawEnemies(ctx, game) {
    for (const enemy of game.enemies) {
      if (enemy.type === 'slowFlyer' || enemy.type === 'fastFlyer') {
        this.drawFlyer(ctx, enemy);
      } else if (enemy.type === 'walker') {
        this.drawWalker(ctx, enemy);
      }
    }
  }

  drawFlyer(ctx, flyer) {
    const isDefeated = !flyer.active;
    const r = flyer.visualRadius;

    ctx.save();
    ctx.translate(flyer.x, flyer.y);

    if (isDefeated) {
      // Fade out and shrink during defeat timer
      const alpha = Math.max(0, flyer.defeatTimer / 35);
      ctx.globalAlpha = alpha;
      ctx.scale(1 + (1 - alpha) * 0.4, 1 + (1 - alpha) * 0.4);
    }

    // Damage flash
    if (flyer.flashTimer > 0) {
      ctx.filter = 'brightness(1.6) saturate(1.8)';
    }

    // Facing direction
    const facing = flyer.vx >= 0 ? 1 : -1;
    ctx.scale(facing, 1);

    // Subtle flight hover wave
    const hoverY = Math.sin(this.time * 8 + flyer.id) * 2;
    ctx.translate(0, hoverY);

    // 1. UNDERSIDE DANGER SPIKES / THRUSTERS (Clearly signals: DO NOT HIT UNDERNEATH!)
    ctx.save();
    ctx.fillStyle = '#ff2a55';
    ctx.shadowColor = '#ff2a55';
    ctx.shadowBlur = 6;
    for (let i = -1; i <= 1; i++) {
      const sx = i * (r * 0.55);
      ctx.beginPath();
      ctx.moveTo(sx - 4, r * 0.45);
      ctx.lineTo(sx + 4, r * 0.45);
      ctx.lineTo(sx, r * 0.95);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 2. Twin Aerodynamic Wings / Rotors
    const wingColor = flyer.type === 'fastFlyer' ? '#8a2be2' : '#3d5a80';
    ctx.fillStyle = wingColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.ellipse(-r * 0.65, 0, r * 0.55, r * 0.25, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(r * 0.65, 0, r * 0.55, r * 0.25, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Main Armored Drone Fuselage
    const bodyGrad = ctx.createLinearGradient(0, -r, 0, r * 0.6);
    if (flyer.hitsTaken === 0) {
      bodyGrad.addColorStop(0, '#2d4059');
      bodyGrad.addColorStop(1, '#1b263b');
    } else if (flyer.hitsTaken === 1) {
      bodyGrad.addColorStop(0, '#4a3f35');
      bodyGrad.addColorStop(1, '#2c221b');
    } else {
      // 2 hits taken: heavily damaged hazard styling
      bodyGrad.addColorStop(0, '#662222');
      bodyGrad.addColorStop(1, '#331111');
    }

    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = (flyer.type === 'fastFlyer' ? '#d946ef' : '#00ffcc');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 2, r * 0.85, r * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Damage cracks on hull
    if (flyer.hitsTaken >= 1) {
      ctx.strokeStyle = '#ff9900';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.lineTo(-1, 4);
      ctx.lineTo(4, 1);
      ctx.stroke();
    }
    if (flyer.hitsTaken >= 2) {
      ctx.strokeStyle = '#ff3300';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(3, -5);
      ctx.lineTo(8, 2);
      ctx.lineTo(2, 6);
      ctx.stroke();
    }

    // 4. TOP TARGET WEAK SPOT (Clearly signals: HIT FROM TOP!)
    // Bright glowing dome with concentric landing rings & down chevron
    ctx.save();
    const targetGrad = ctx.createRadialGradient(0, -r * 0.6, 2, 0, -r * 0.6, r * 0.5);
    targetGrad.addColorStop(0, '#ffffff');
    targetGrad.addColorStop(0.5, '#39ff14');
    targetGrad.addColorStop(1, '#00aa33');

    ctx.fillStyle = targetGrad;
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.42, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Target Down Chevron on top
    ctx.strokeStyle = '#003300';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -r * 0.72);
    ctx.lineTo(0, -r * 0.55);
    ctx.lineTo(5, -r * 0.72);
    ctx.stroke();

    // 5. Damage State Pips HUD: [● ○ ○]
    ctx.save();
    const pipSpacing = 8;
    const pipY = r * 0.75;
    for (let p = 0; p < flyer.hitsRequired; p++) {
      const px = (p - 1) * pipSpacing;
      const filled = p < flyer.hitsTaken;
      ctx.beginPath();
      ctx.arc(px, pipY, 3, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = '#ff3366';
        ctx.shadowColor = '#ff3366';
        ctx.shadowBlur = 4;
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.restore();
  }

  drawWalker(ctx, walker) {
    const isDefeated = !walker.active;
    const r = walker.visualRadius;

    ctx.save();
    ctx.translate(walker.x, walker.y);

    if (isDefeated) {
      const alpha = Math.max(0, walker.defeatTimer / 25);
      ctx.globalAlpha = alpha;
      ctx.scale(1, 0.3); // squashed flat
    }

    // Walking legs animation
    const legPhase = Math.sin(this.time * 16) * 4;
    ctx.strokeStyle = '#ff9900';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.4);
    ctx.lineTo(-r * 0.5 + legPhase, r);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(r * 0.5, r * 0.4);
    ctx.lineTo(r * 0.5 - legPhase, r);
    ctx.stroke();

    // Body
    ctx.fillStyle = '#3a2e39';
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 0.5, r * 1.6, r, 5);
    ctx.fill();
    ctx.stroke();

    // Stomp Button on Top
    ctx.fillStyle = '#39ff14';
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 6;
    ctx.fillRect(-r * 0.4, -r * 0.8, r * 0.8, r * 0.35);
    ctx.shadowBlur = 0;

    // Red forward warning spike
    const facing = walker.vx >= 0 ? 1 : -1;
    ctx.fillStyle = '#ff3366';
    ctx.beginPath();
    ctx.moveTo(facing * r * 0.8, -r * 0.2);
    ctx.lineTo(facing * (r * 0.8 + 6), 0);
    ctx.lineTo(facing * r * 0.8, r * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  drawParticles(ctx, game) {
    for (const p of game.particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);

      if (p.shape === 'star') {
        ctx.fillRect(-p.size, -1, p.size * 2, 2);
        ctx.fillRect(-1, -p.size, 2, p.size * 2);
      } else if (p.shape === 'spark') {
        ctx.fillRect(-p.size * 1.5, -0.8, p.size * 3, 1.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawFloatingTexts(ctx, game) {
    for (const f of game.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 6;
      ctx.font = `bold ${f.size}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  drawHUD(ctx, game) {
    ctx.save();

    // 1. Clock Display (Top Center)
    const remSec = (Math.max(0, game.remainingMs) / 1000).toFixed(1);
    const isUrgent = game.remainingMs <= 10000 && game.phase === 'playing';

    ctx.textAlign = 'center';
    if (isUrgent) {
      const pulse = 1.0 + Math.sin(this.time * 12) * 0.08;
      ctx.save();
      ctx.translate(STAGE_WIDTH / 2, 32);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#ff2255';
      ctx.shadowColor = '#ff2255';
      ctx.shadowBlur = 12;
      ctx.font = 'bold 30px monospace';
      ctx.fillText(`${remSec}s`, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00ffcc';
      ctx.shadowBlur = 6;
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`${remSec}s`, STAGE_WIDTH / 2, 32);
    }

    // Subtitle clock bar
    const clockFrac = Math.min(1.0, game.remainingMs / 75000);
    const barWidth = 140;
    const barX = (STAGE_WIDTH - barWidth) / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(barX, 40, barWidth, 4);
    ctx.fillStyle = isUrgent ? '#ff2255' : '#00ffcc';
    ctx.fillRect(barX, 40, barWidth * clockFrac, 4);

    // 2. Score & Rank (Top Left)
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.fillText('SCORE', 16, 20);

    ctx.fillStyle = '#ffeb3b';
    ctx.shadowColor = '#ffeb3b';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`${game.score}`, 16, 38);

    // 3. Rank & Air Targets Defeated (Top Right)
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '10px monospace';
    ctx.fillText(`DEFEATED: ${game.counters.airEnemiesDefeated}`, STAGE_WIDTH - 16, 20);

    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`RANK ${game.rank}`, STAGE_WIDTH - 16, 38);

    // 4. Clean Pursuit Streak
    if (game.currentCleanSequence > 1 && game.phase === 'playing') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#39ff14';
      ctx.shadowColor = '#39ff14';
      ctx.shadowBlur = 8;
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`STREAK x${game.currentCleanSequence}!`, STAGE_WIDTH / 2, 60);
    }

    ctx.restore();
  }

  drawReadyPrompt(ctx, game) {
    ctx.save();
    // One short line on the idle stage as specified by brief
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
    ctx.fillStyle = `rgba(0, 255, 204, ${pulse})`;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MOVE OR JUMP TO START', STAGE_WIDTH / 2, 485);
    ctx.restore();
  }

  drawGameOver(ctx, game) {
    ctx.save();

    // Dark semi-transparent backdrop
    ctx.fillStyle = 'rgba(8, 12, 22, 0.88)';
    ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    const boxWidth = 320;
    const boxHeight = 340;
    const boxX = (STAGE_WIDTH - boxWidth) / 2;
    const boxY = 120;

    // Card frame
    ctx.fillStyle = '#111827';
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 12);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff2255';
    ctx.shadowColor = '#ff2255';
    ctx.shadowBlur = 10;
    ctx.font = 'bold 26px monospace';
    ctx.fillText('TIME OVER', STAGE_WIDTH / 2, boxY + 45);

    // Rank Badge
    ctx.fillStyle = '#00ffcc';
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`RANK ${game.rank}`, STAGE_WIDTH / 2, boxY + 95);

    // Stats List
    ctx.textAlign = 'left';
    ctx.font = '13px monospace';
    ctx.shadowBlur = 0;

    const stats = [
      { label: 'FINAL SCORE', value: `${game.score}` },
      { label: 'SESSION BEST', value: `${game.sessionBestScore}` },
      { label: 'TARGETS DEFEATED', value: `${game.counters.airEnemiesDefeated}` },
      { label: 'CLEAN TOP HITS', value: `${game.counters.topHits}` },
      { label: 'LONGEST PURSUIT', value: `${game.counters.longestCleanSequence}` }
    ];

    let startY = boxY + 135;
    stats.forEach(s => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillText(s.label, boxX + 24, startY);

      ctx.fillStyle = '#ffeb3b';
      ctx.textAlign = 'right';
      ctx.fillText(s.value, boxX + boxWidth - 24, startY);
      ctx.textAlign = 'left';

      startY += 26;
    });

    // Play again call-to-action
    const pulse = 0.7 + 0.3 * Math.sin(this.time * 6);
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(0, 255, 204, ${pulse})`;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 15px monospace';
    ctx.fillText('TAP OR PRESS [R] TO PLAY AGAIN', STAGE_WIDTH / 2, boxY + boxHeight - 25);

    ctx.restore();
  }
}
