// Procedural host creature: Barnaby the Tide Pool Hermit Crab
// Expressive, reactive, charming, drawn purely on canvas.

class PoolHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle'; // 'idle', 'ripple', 'tense', 'stung', 'clear'
    this.stateTimer = 0;

    // Eyestalk and look targets
    this.lookX = 0;
    this.lookY = 0;
    this.currLookX = 0;
    this.currLookY = 0;
    this.blinkProgress = 0; // 0 (open) to 1 (closed)
    this.blinkTimer = 2.5;

    // Body animation parameters
    this.breathTime = 0;
    this.hopOffset = 0;
    this.clawAngle = 0;
    this.spinAngle = 0;

    // Bubbles / particles
    this.particles = [];

    // Emotion bubble
    this.bubbleIcon = null;
    this.bubbleTimer = 0;

    this.setupTracking();
  }

  setupTracking() {
    window.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      this.lookX = Math.max(-1, Math.min(1, dx / Math.max(120, dist)));
      this.lookY = Math.max(-1, Math.min(1, dy / Math.max(120, dist)));
    });

    this.canvas.addEventListener('click', () => {
      this.triggerReaction('curious');
    });
  }

  setMood(mood, icon = null) {
    this.state = mood;
    this.stateTimer = 0;
    if (icon) {
      this.bubbleIcon = icon;
      this.bubbleTimer = 1.8;
    }
  }

  onRipple(count) {
    this.setMood('ripple', '✨');
    this.spawnBubbles(count > 10 ? 8 : 4);
  }

  onTense() {
    if (this.state !== 'tense') {
      this.setMood('tense', '💦');
    }
  }

  onStung() {
    this.setMood('stung', '💫');
    this.spawnBubbles(6);
  }

  onClear() {
    this.setMood('clear', '⭐');
    this.spawnBubbles(10);
  }

  triggerReaction(type) {
    if (type === 'curious') {
      this.bubbleIcon = '❓';
      this.bubbleTimer = 1.2;
      this.hopOffset = -8;
    }
  }

  spawnBubbles(count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: this.canvas.width / 2 + (Math.random() - 0.5) * 40,
        y: this.canvas.height / 2 + 10,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1.2 - Math.random() * 2,
        radius: 2 + Math.random() * 4,
        alpha: 0.8
      });
    }
  }

  update(dt) {
    this.breathTime += dt * 2.5;

    // Smooth eye looking
    this.currLookX += (this.lookX - this.currLookX) * 0.1;
    this.currLookY += (this.lookY - this.currLookY) * 0.1;

    // Blink timer
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkProgress += dt * 10;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
        this.blinkTimer = 2 + Math.random() * 3;
      }
    }

    // Emotion bubble
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleIcon = null;
      }
    }

    // Hop physics
    if (this.hopOffset < 0) {
      this.hopOffset += dt * 30;
      if (this.hopOffset > 0) this.hopOffset = 0;
    }

    // Mood timer and transitions
    this.stateTimer += dt;
    if (this.state === 'ripple' && this.stateTimer > 1.2) {
      this.state = 'idle';
    } else if (this.state === 'clear' && this.stateTimer > 2.0) {
      this.state = 'idle';
    }

    // Update bubbles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= dt * 0.7;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    this.render();
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();

    const cx = w / 2;
    const cy = h / 2 + 10 + this.hopOffset;

    // Base rock / sandy mound
    ctx.fillStyle = '#2d4a45';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 24, 48, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1e3833';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 26, 42, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    // Little barnacles on rock
    ctx.fillStyle = '#dfd3c3';
    ctx.beginPath();
    ctx.arc(cx - 32, cy + 22, 3, 0, Math.PI * 2);
    ctx.arc(cx + 28, cy + 20, 2.5, 0, Math.PI * 2);
    ctx.arc(cx - 22, cy + 26, 2, 0, Math.PI * 2);
    ctx.fill();

    // Barnaby's Shell (Warm spiral snail shell)
    ctx.save();
    let shellTilt = 0;
    if (this.state === 'stung') {
      shellTilt = 0.55;
    } else if (this.state === 'tense') {
      shellTilt = -0.15;
    } else if (this.state === 'clear') {
      shellTilt = Math.sin(this.stateTimer * 8) * 0.15;
    }

    ctx.translate(cx, cy);
    ctx.rotate(shellTilt);

    // Shell shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(6, 12, 22, 14, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Snail shell outer coil
    const shellGrad = ctx.createLinearGradient(-26, -18, 20, 18);
    shellGrad.addColorStop(0, '#f9e4b7');
    shellGrad.addColorStop(0.5, '#e89e7d');
    shellGrad.addColorStop(1, '#a3485e');

    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.ellipse(4, 2, 24, 19, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Shell swirl stripes
    ctx.strokeStyle = '#c46262';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(8, 2, 14, 0.3, 3.8);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(12, 3, 7, 0.5, 4.0);
    ctx.stroke();

    // Shell apex pearl tip
    ctx.fillStyle = '#fff4db';
    ctx.beginPath();
    ctx.arc(14, 3, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Crab body peeking out of shell aperture
    const breath = Math.sin(this.breathTime) * 1.5;
    const bodyX = -12;
    const bodyY = 6 + (this.state === 'tense' ? 3 : 0);

    // Crab head
    ctx.fillStyle = '#ff7b54';
    ctx.beginPath();
    ctx.ellipse(bodyX, bodyY + breath * 0.5, 14, 11, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Rosy cheeks
    ctx.fillStyle = 'rgba(255, 90, 95, 0.4)';
    ctx.beginPath();
    ctx.arc(bodyX - 8, bodyY + 3, 3, 0, Math.PI * 2);
    ctx.arc(bodyX + 6, bodyY + 4, 3, 0, Math.PI * 2);
    ctx.fill();

    // Antennae
    ctx.strokeStyle = '#ff9f68';
    ctx.lineWidth = 1.5;
    const antWave = Math.sin(this.breathTime * 2) * 2;
    ctx.beginPath();
    ctx.moveTo(bodyX - 4, bodyY - 8);
    ctx.quadraticCurveTo(bodyX - 8 + antWave, bodyY - 18, bodyX - 12 + antWave, bodyY - 22);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bodyX + 2, bodyY - 8);
    ctx.quadraticCurveTo(bodyX + 4 - antWave, bodyY - 18, bodyX + 8 - antWave, bodyY - 22);
    ctx.stroke();

    // Eyestalks & Eyes
    const eyeOffsetX = this.currLookX * 2.5;
    const eyeOffsetY = this.currLookY * 2.5;

    // Left eye stalk
    ctx.strokeStyle = '#ff7b54';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bodyX - 6, bodyY - 7);
    ctx.lineTo(bodyX - 8, bodyY - 15);
    ctx.stroke();

    // Right eye stalk
    ctx.beginPath();
    ctx.moveTo(bodyX + 2, bodyY - 7);
    ctx.lineTo(bodyX + 4, bodyY - 15);
    ctx.stroke();

    // Eye globes
    const drawEye = (ex, ey) => {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e06040';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (this.state === 'stung') {
        // Spiral dizzy eye
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const t = this.stateTimer * 8;
        ctx.arc(ex, ey, 2.5, t, t + 4.5);
        ctx.stroke();
      } else if (this.state === 'ripple') {
        // Happy arch eye
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(ex, ey + 1, 3.5, 3.4, 6.0);
        ctx.stroke();
      } else if (this.blinkProgress > 0.5) {
        // Blinking shut
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(ex - 4, ey);
        ctx.lineTo(ex + 4, ey);
        ctx.stroke();
      } else {
        // Normal shiny pupil
        const pupilRadius = this.state === 'tense' ? 2 : 3;
        ctx.fillStyle = '#1c2826';
        ctx.beginPath();
        ctx.arc(ex + eyeOffsetX, ey + eyeOffsetY, pupilRadius, 0, Math.PI * 2);
        ctx.fill();

        // White sparkle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex + eyeOffsetX - 1, ey + eyeOffsetY - 1, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    drawEye(bodyX - 8, bodyY - 16);
    drawEye(bodyX + 4, bodyY - 16);

    // Crab claws
    const drawClaw = (clawX, clawY, flip, isHappy) => {
      ctx.save();
      ctx.translate(clawX, clawY);
      let angle = (flip ? 0.3 : -0.3) + Math.sin(this.breathTime * 1.5) * 0.1;
      if (isHappy) angle += (flip ? 0.6 : -0.6);
      if (this.state === 'tense') angle *= 0.4;
      if (this.state === 'stung') angle = flip ? 0.9 : -0.9;
      ctx.rotate(angle);

      ctx.fillStyle = '#ff6b4a';
      // Arm
      ctx.fillRect(-2, -6, 4, 7);
      // Pincer base
      ctx.beginPath();
      ctx.ellipse(0, -9, 5.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pincer tip
      ctx.beginPath();
      ctx.arc(flip ? 2 : -2, -12, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const happyClaws = this.state === 'ripple' || this.state === 'clear';
    drawClaw(bodyX - 14, bodyY + 4, false, happyClaws);
    drawClaw(bodyX + 8, bodyY + 6, true, happyClaws);

    ctx.restore(); // restore rotation & translation

    // Render bubbles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.strokeStyle = 'rgba(180, 240, 255, 0.8)';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Emotion bubble
    if (this.bubbleIcon) {
      ctx.save();
      const bx = cx - 32;
      const by = cy - 24;

      // Speech bubble background
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, 12, 0, Math.PI * 2);
      ctx.fill();

      // Small tail dot
      ctx.beginPath();
      ctx.arc(bx + 8, by + 12, 3, 0, Math.PI * 2);
      ctx.fill();

      // Icon text
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.bubbleIcon, bx, by + 1);

      ctx.restore();
    }

    ctx.restore();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PoolHost;
}
