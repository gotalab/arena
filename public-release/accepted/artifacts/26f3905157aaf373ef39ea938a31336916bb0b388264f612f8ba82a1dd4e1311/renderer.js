// EMBER - Visual Production & Character Rendering Engine
// Expressive character animation, living damp, procedural flue atmosphere, zero external assets.

(function() {
  'use strict';

  class EmberRenderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;

      // Virtual world coordinate mapping
      this.worldWidth = 360; // total virtual view width
      this.cameraY = 0;
      this.cameraTargetY = 0;

      // Visual / animation timers & states (view-only)
      this.animTime = 0;
      this.blinkTimer = 2.0;
      this.isBlinking = false;
      this.mothBurstAnim = 0; // timer for moth hit reaction
      this.landSquash = 0;    // squash factor on landing
      this.launchStretch = 0; // stretch factor on launch
      this.wallStrainTimer = 0;

      // View-only visual particles
      this.particles = [];
      this.floatingTexts = [];

      // DOM UI Elements
      this.scoreEl = document.getElementById('score-val');
      this.bestEl = document.getElementById('session-best-val');
      this.chainBanner = document.getElementById('chain-banner');
      this.tutorialHint = document.getElementById('tutorial-hint');
      this.pips = [
        document.getElementById('pip-1'),
        document.getElementById('pip-2'),
        document.getElementById('pip-3')
      ];

      // End of run overlay elements
      this.ceremonyOverlay = document.getElementById('ceremony-overlay');
      this.rankBadge = document.getElementById('rank-badge');
      this.rankTitle = document.getElementById('rank-title');
      this.finalScoreEl = document.getElementById('final-score');
      this.finalBestEl = document.getElementById('final-best');
      this.finalChainEl = document.getElementById('final-chain');
      this.finalHeightEl = document.getElementById('final-height');

      // Hook game visual listeners
      this.game.visualListener = {
        onReset: () => this.handleReset(),
        onLaunch: (vx, vy, isMidair, chain) => this.handleLaunch(vx, vy, isMidair, chain),
        onLand: (kind) => this.handleLand(kind),
        onChainBank: (chain, bonus, kind) => this.handleChainBank(chain, bonus, kind),
        onMothBurst: (moth, chain) => this.handleMothBurst(moth, chain),
        onGlimmer: (glimmer, pts, chain) => this.handleGlimmer(glimmer, pts, chain),
        onGameOver: () => this.handleGameOver(),
        onDryLaunch: () => this.handleDryLaunch()
      };

      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.scale = this.canvas.width / this.worldWidth;
    }

    handleReset() {
      this.particles = [];
      this.floatingTexts = [];
      this.cameraY = this.game.y;
      this.cameraTargetY = this.game.y;
      this.mothBurstAnim = 0;
      this.landSquash = 0;
      this.launchStretch = 0;

      if (this.ceremonyOverlay) {
        this.ceremonyOverlay.classList.remove('active');
      }
      if (this.chainBanner) {
        this.chainBanner.classList.remove('visible');
      }
      if (this.tutorialHint) {
        this.tutorialHint.classList.remove('hidden');
      }
    }

    handleLaunch(vx, vy, isMidair, chain) {
      this.launchStretch = 1.0;
      this.landSquash = 0;

      if (this.tutorialHint) {
        this.tutorialHint.classList.add('hidden');
      }

      // Spawn launch flame puff particles
      const count = isMidair ? 16 : 10;
      for (let i = 0; i < count; i++) {
        const speed = 40 + Math.random() * 120;
        const angle = Math.atan2(-vy, -vx) + (Math.random() - 0.5) * 0.9;
        this.particles.push({
          x: this.game.x,
          y: this.game.y - 4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
          radius: 2.5 + Math.random() * 3.5,
          color: Math.random() < 0.6 ? '#ffaa00' : '#ff4400'
        });
      }
    }

    handleLand(kind) {
      this.landSquash = 0.8;
      this.launchStretch = 0;

      // Landing dust/spark particles
      const count = kind === 'ledge' ? 10 : 6;
      for (let i = 0; i < count; i++) {
        const spread = (Math.random() - 0.5) * 60;
        this.particles.push({
          x: this.game.x + (Math.random() - 0.5) * 10,
          y: this.game.y,
          vx: spread,
          vy: 20 + Math.random() * 40,
          life: 0.25 + Math.random() * 0.2,
          maxLife: 0.45,
          radius: 1.5 + Math.random() * 2,
          color: kind === 'ledge' ? '#d4d4d8' : '#71717a'
        });
      }
    }

    handleChainBank(chain, bonus, kind) {
      this.handleLand(kind);

      // Flash chain banked message
      this.floatingTexts.push({
        text: `+${bonus} BANKED!`,
        x: this.game.x,
        y: this.game.y + 24,
        color: '#ffcc00',
        life: 0.9,
        maxLife: 0.9,
        scale: 1.2
      });

      if (window.emberAudio) {
        window.emberAudio.playChainBank(chain);
      }

      // Celebratory golden spark explosion
      for (let i = 0; i < 22; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 60 + Math.random() * 140;
        this.particles.push({
          x: this.game.x,
          y: this.game.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          life: 0.5 + Math.random() * 0.3,
          maxLife: 0.8,
          radius: 2 + Math.random() * 3,
          color: '#fbbf24'
        });
      }
    }

    handleMothBurst(moth, chain) {
      this.mothBurstAnim = 0.45; // flash character expression

      // Sound
      if (window.emberAudio) {
        window.emberAudio.playMothBurst(chain);
      }

      // Burst particles (soot fluff + ember refund glow)
      for (let i = 0; i < 18; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 110;
        this.particles.push({
          x: moth.currentX,
          y: moth.currentY,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          life: 0.4 + Math.random() * 0.3,
          maxLife: 0.7,
          radius: 2 + Math.random() * 3.5,
          color: Math.random() < 0.5 ? '#3f3f46' : '#ffaa00'
        });
      }

      // Upward kinetic shock ring
      this.particles.push({
        x: moth.currentX,
        y: moth.currentY,
        radius: 6,
        maxRadius: 36,
        life: 0.28,
        maxLife: 0.28,
        isRing: true,
        color: '#ffcc00'
      });
    }

    handleGlimmer(glimmer, pts, chain) {
      if (window.emberAudio) {
        window.emberAudio.playGlimmer(chain);
      }

      this.floatingTexts.push({
        text: `+${pts}`,
        x: glimmer.currentX,
        y: glimmer.currentY + 16,
        color: '#fef08a',
        life: 0.75,
        maxLife: 0.75,
        scale: 1.0
      });

      // Golden diamond sparkles
      for (let i = 0; i < 14; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 50 + Math.random() * 90;
        this.particles.push({
          x: glimmer.currentX,
          y: glimmer.currentY,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          life: 0.35 + Math.random() * 0.25,
          maxLife: 0.6,
          radius: 2 + Math.random() * 2.5,
          color: '#fbbf24'
        });
      }
    }

    handleDryLaunch() {
      // Dry shiver
      this.floatingTexts.push({
        text: 'NO GLOW',
        x: this.game.x,
        y: this.game.y + 20,
        color: '#94a3b8',
        life: 0.5,
        maxLife: 0.5,
        scale: 0.9
      });
    }

    handleGameOver() {
      if (window.emberAudio) {
        window.emberAudio.playGameOver();
      }

      // Dark blue steam extinguishing burst
      for (let i = 0; i < 24; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 30 + Math.random() * 80;
        this.particles.push({
          x: this.game.x,
          y: this.game.y,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd + 30,
          life: 0.7 + Math.random() * 0.5,
          maxLife: 1.2,
          radius: 3 + Math.random() * 4,
          color: Math.random() < 0.6 ? '#1c3552' : '#64748b'
        });
      }

      // Populate end-of-run ceremony overlay
      const rankTitles = {
        'S+': 'Solar Prominence',
        'S': 'Wildfire Apex',
        'A': 'Roaring Hearth',
        'B': 'Rising Blaze',
        'C': 'Flickering Flame',
        'D': 'Faint Ember'
      };

      if (this.rankBadge) this.rankBadge.textContent = this.game.rank || 'D';
      if (this.rankTitle) this.rankTitle.textContent = rankTitles[this.game.rank] || 'Ember';
      if (this.finalScoreEl) this.finalScoreEl.textContent = this.game.score.toLocaleString();
      if (this.finalBestEl) this.finalBestEl.textContent = this.game.sessionBest.toLocaleString();
      if (this.finalChainEl) this.finalChainEl.textContent = `x${this.game.chainBest}`;
      if (this.finalHeightEl) this.finalHeightEl.textContent = `${Math.round(this.game.height)}m`;

      if (this.ceremonyOverlay) {
        setTimeout(() => {
          this.ceremonyOverlay.classList.add('active');
        }, 400);
      }
    }

    // World to Screen Transformations
    toScreenX(worldX) {
      return this.canvas.width / 2 + worldX * this.scale;
    }

    toScreenY(worldY) {
      // Spark sits near 66% down the viewport, allowing view of flue above
      return this.canvas.height * 0.66 - (worldY - this.cameraY) * this.scale;
    }

    toWorldX(screenX) {
      return (screenX - this.canvas.width / 2) / this.scale;
    }

    toWorldY(screenY) {
      return this.cameraY - (screenY - this.canvas.height * 0.66) / this.scale;
    }

    // Main render frame
    render(dt) {
      this.animTime += dt;

      // Update camera smoothly
      const targetY = Math.max(0, this.game.y);
      this.cameraTargetY = targetY;
      this.cameraY += (this.cameraTargetY - this.cameraY) * Math.min(1.0, dt * 6.5);

      // Character facial / emotional timers
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.isBlinking = true;
        if (this.blinkTimer <= -0.15) {
          this.isBlinking = false;
          this.blinkTimer = 2.0 + Math.random() * 2.5;
        }
      }
      if (this.mothBurstAnim > 0) this.mothBurstAnim -= dt;
      if (this.landSquash > 0) this.landSquash -= dt * 3.5;
      if (this.launchStretch > 0) this.launchStretch -= dt * 3.5;

      // Clear Canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      // Render layers
      this.drawFlueBackground();
      this.drawLedges();
      this.drawItems();
      this.drawSlingshotAim();
      this.drawSparkCharacter();
      this.drawParticles(dt);
      this.drawDamp();
      this.drawFlueWalls();
      this.drawFloatingTexts(dt);

      // Update DOM HUD
      this.updateHud();
    }

    drawFlueBackground() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      // Deep chimney flue gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#090b10');
      bgGrad.addColorStop(0.5, '#0d1017');
      bgGrad.addColorStop(1, '#06070a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Parallax soot bricks / flue ribs
      ctx.save();
      const brickH = 50 * this.scale;
      const brickW = 75 * this.scale;
      const startY = (this.cameraY * 0.3 * this.scale) % brickH;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = 1;

      for (let y = -brickH + startY; y < h + brickH; y += brickH) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();

        const offset = (Math.floor((y - startY) / brickH) % 2) * (brickW / 2);
        for (let x = offset; x < w; x += brickW) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + brickH);
          ctx.stroke();
        }
      }

      // Distant chimney ribs
      const ribH = 320 * this.scale;
      const ribStartY = (this.cameraY * 0.5 * this.scale) % ribH;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 4 * this.scale;
      for (let y = -ribH + ribStartY; y < h + ribH; y += ribH) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.restore();
    }

    drawFlueWalls() {
      const ctx = this.ctx;
      const h = this.canvas.height;
      const leftEdge = this.toScreenX(this.game.wallLeftX);
      const rightEdge = this.toScreenX(this.game.wallRightX);

      // Left Wall
      const leftGrad = ctx.createLinearGradient(0, 0, leftEdge, 0);
      leftGrad.addColorStop(0, '#040508');
      leftGrad.addColorStop(0.85, '#0f131a');
      leftGrad.addColorStop(1, '#1b202a');
      ctx.fillStyle = leftGrad;
      ctx.fillRect(0, 0, leftEdge, h);

      // Right Wall
      const rightGrad = ctx.createLinearGradient(rightEdge, 0, this.canvas.width, 0);
      rightGrad.addColorStop(0, '#1b202a');
      rightGrad.addColorStop(0.15, '#0f131a');
      rightGrad.addColorStop(1, '#040508');
      ctx.fillStyle = rightGrad;
      ctx.fillRect(rightEdge, 0, this.canvas.width - rightEdge, h);

      // Soot highlights & rim light from spark
      ctx.save();
      const sparkScreenY = this.toScreenY(this.game.y);

      // Left rim light
      const leftLightGrad = ctx.createRadialGradient(leftEdge, sparkScreenY, 5, leftEdge, sparkScreenY, 180 * this.scale);
      leftLightGrad.addColorStop(0, 'rgba(255, 120, 30, 0.35)');
      leftLightGrad.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.fillStyle = leftLightGrad;
      ctx.fillRect(leftEdge - 20, sparkScreenY - 180 * this.scale, 20, 360 * this.scale);

      // Right rim light
      const rightLightGrad = ctx.createRadialGradient(rightEdge, sparkScreenY, 5, rightEdge, sparkScreenY, 180 * this.scale);
      rightLightGrad.addColorStop(0, 'rgba(255, 120, 30, 0.35)');
      rightLightGrad.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.fillStyle = rightLightGrad;
      ctx.fillRect(rightEdge, sparkScreenY - 180 * this.scale, 20, 360 * this.scale);

      // Inner wall borders
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(leftEdge, 0);
      ctx.lineTo(leftEdge, h);
      ctx.moveTo(rightEdge, 0);
      ctx.lineTo(rightEdge, h);
      ctx.stroke();

      ctx.restore();
    }

    drawLedges() {
      const ctx = this.ctx;
      const ledges = this.game.ledges;

      for (let i = 0; i < ledges.length; i++) {
        const l = ledges[i];
        if (!l.active) continue;

        const sx = this.toScreenX(l.x);
        const sy = this.toScreenY(l.y);
        const hw = l.halfWidth * this.scale;
        const th = 8 * this.scale;

        // Culling
        if (sy < -40 || sy > this.canvas.height + 40) continue;

        ctx.save();
        // Ledge Body (soot-stained cast stone)
        const ledgeGrad = ctx.createLinearGradient(0, sy, 0, sy + th + 6);
        ledgeGrad.addColorStop(0, '#2b303d');
        ledgeGrad.addColorStop(0.3, '#1e222c');
        ledgeGrad.addColorStop(1, '#0e1017');

        ctx.fillStyle = ledgeGrad;
        ctx.beginPath();
        ctx.roundRect(sx - hw, sy, hw * 2, th, [3, 3, 4, 4]);
        ctx.fill();

        // Top soot frost highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - hw + 2, sy);
        ctx.lineTo(sx + hw - 2, sy);
        ctx.stroke();

        // Warm underside bounce light if spark is below
        if (this.game.y < l.y && l.y - this.game.y < 160) {
          const prox = 1 - (l.y - this.game.y) / 160;
          ctx.strokeStyle = `rgba(255, 106, 26, ${0.4 * prox})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx - hw + 4, sy + th);
          ctx.lineTo(sx + hw - 4, sy + th);
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    drawItems() {
      const ctx = this.ctx;
      const items = this.game.items;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.active) continue;

        const sx = this.toScreenX(it.currentX);
        const sy = this.toScreenY(it.currentY);

        // Culling
        if (sy < -40 || sy > this.canvas.height + 40) continue;

        if (it.type === 'moth') {
          this.drawSootMoth(sx, sy, it);
        } else if (it.type === 'glimmer') {
          this.drawGlimmer(sx, sy, it);
        }
      }
    }

    drawSootMoth(sx, sy, it) {
      const ctx = this.ctx;
      const flap = Math.sin(this.animTime * 18 + it.phaseX);
      const wingW = (13 + flap * 3) * this.scale;
      const wingH = 10 * this.scale;

      ctx.save();
      ctx.translate(sx, sy);

      // Soft amber ambient dust aura
      const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 20 * this.scale);
      aura.addColorStop(0, 'rgba(255, 180, 50, 0.25)');
      aura.addColorStop(1, 'rgba(255, 180, 50, 0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(0, 0, 20 * this.scale, 0, Math.PI * 2);
      ctx.fill();

      // Delicate fluttering wings
      ctx.fillStyle = 'rgba(60, 55, 65, 0.85)';
      ctx.strokeStyle = 'rgba(255, 200, 80, 0.7)';
      ctx.lineWidth = 1;

      // Left Wing
      ctx.save();
      ctx.scale(Math.cos(this.animTime * 18 + it.phaseX), 1);
      ctx.beginPath();
      ctx.ellipse(-8 * this.scale, -2 * this.scale, wingW, wingH, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Right Wing
      ctx.save();
      ctx.scale(Math.cos(this.animTime * 18 + it.phaseX), 1);
      ctx.beginPath();
      ctx.ellipse(8 * this.scale, -2 * this.scale, wingW, wingH, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Fuzzy charcoal body
      ctx.fillStyle = '#222026';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5 * this.scale, 8 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Glowing cute antennae
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-2 * this.scale, -6 * this.scale);
      ctx.quadraticCurveTo(-6 * this.scale, -12 * this.scale, -9 * this.scale, -10 * this.scale);
      ctx.moveTo(2 * this.scale, -6 * this.scale);
      ctx.quadraticCurveTo(6 * this.scale, -12 * this.scale, 9 * this.scale, -10 * this.scale);
      ctx.stroke();

      // Big friendly moth eyes
      ctx.fillStyle = '#fff4d0';
      ctx.beginPath();
      ctx.arc(-2 * this.scale, -3 * this.scale, 1.4 * this.scale, 0, Math.PI * 2);
      ctx.arc(2 * this.scale, -3 * this.scale, 1.4 * this.scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    drawGlimmer(sx, sy, it) {
      const ctx = this.ctx;
      const rot = this.animTime * 2.2 + it.phase;
      const r = it.visualRadius * this.scale;

      ctx.save();
      ctx.translate(sx, sy);

      // Outer golden radiance
      const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.2);
      halo.addColorStop(0, 'rgba(255, 215, 0, 0.45)');
      halo.addColorStop(0.5, 'rgba(255, 140, 0, 0.2)');
      halo.addColorStop(1, 'rgba(255, 140, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Rotating faceted octahedron crystal
      ctx.rotate(rot);
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.75, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.75, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner brilliant white core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    drawSlingshotAim() {
      if (!this.game.input.dragging) return;

      const ctx = this.ctx;
      const sx = this.toScreenX(this.game.x);
      const sy = this.toScreenY(this.game.y);

      // Pointer drag coordinates
      const rect = this.canvas.getBoundingClientRect();
      const originScreenX = (this.game.input.originX - rect.left) * (this.canvas.width / rect.width);
      const originScreenY = (this.game.input.originY - rect.top) * (this.canvas.height / rect.height);
      const currentDragX = originScreenX + this.game.input.dx * (this.canvas.width / rect.width);
      const currentDragY = originScreenY + this.game.input.dy * (this.canvas.height / rect.height);

      const pullDist = Math.hypot(this.game.input.dx, this.game.input.dy);
      const power = Math.min(1.0, Math.max(0, (pullDist - this.game.DEAD_ZONE) / (this.game.MAX_DRAG_DIST - this.game.DEAD_ZONE)));

      ctx.save();

      // 1. Tension Sling Line from Touch Anchor
      ctx.strokeStyle = `rgba(255, 204, 0, ${0.3 + power * 0.5})`;
      ctx.lineWidth = 2 * this.scale;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(originScreenX, originScreenY);
      ctx.lineTo(currentDragX, currentDragY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Anchor dot
      ctx.fillStyle = '#ffaa00';
      ctx.beginPath();
      ctx.arc(originScreenX, originScreenY, 4 * this.scale, 0, Math.PI * 2);
      ctx.fill();

      // 2. Trajectory Arc Preview from Spark
      if (pullDist >= this.game.DEAD_ZONE && this.game.jumpsLeft > 0) {
        const angle = Math.atan2(this.game.input.dy, -this.game.input.dx);
        const launchSpeed = this.game.MIN_LAUNCH_SPEED + (this.game.MAX_LAUNCH_SPEED - this.game.MIN_LAUNCH_SPEED) * power;
        const initialVx = Math.cos(angle) * launchSpeed;
        const initialVy = Math.sin(angle) * launchSpeed;

        // Draw parabolic arc dots
        const steps = 14;
        const dtStep = 0.045;
        let simX = this.game.x;
        let simY = this.game.y;
        let simVy = initialVy;

        for (let s = 1; s <= steps; s++) {
          simX += initialVx * dtStep;
          simVy -= this.game.GRAVITY * dtStep;
          simY += simVy * dtStep;

          // Stop at walls
          if (simX <= this.game.wallLeftX || simX >= this.game.wallRightX) break;

          const dotScreenX = this.toScreenX(simX);
          const dotScreenY = this.toScreenY(simY);
          const alpha = (1 - s / (steps + 1)) * (0.4 + power * 0.5);
          const dotRadius = Math.max(1.5, (4 - s * 0.18) * this.scale);

          ctx.fillStyle = `rgba(255, 204, 0, ${alpha})`;
          ctx.beginPath();
          ctx.arc(dotScreenX, dotScreenY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    drawSparkCharacter() {
      const ctx = this.ctx;
      const sx = this.toScreenX(this.game.x);
      const sy = this.toScreenY(this.game.y);
      const r = this.game.playerRadius * this.scale;

      ctx.save();
      ctx.translate(sx, sy);

      // Determine emotional state
      let state = 'rest';
      if (this.game.phase === 'gameover') {
        state = 'extinguished';
      } else if (this.game.input.dragging) {
        state = 'aiming';
      } else if (this.mothBurstAnim > 0) {
        state = 'burst';
      } else if (this.game.anchored && this.game.anchorKind === 'wall') {
        state = 'wallCling';
      } else if (!this.game.anchored) {
        if (this.game.jumpsLeft === 0 && this.game.vy < 0) {
          state = 'emptyFall';
        } else {
          state = 'flight';
        }
      }

      // Calculate orientation, squash and stretch
      let scaleX = 1;
      let scaleY = 1;
      let rot = 0;

      if (state === 'aiming') {
        // Coiled squash along aim vector
        const angle = Math.atan2(this.game.input.dy, -this.game.input.dx);
        rot = angle - Math.PI / 2;
        scaleX = 1.35;
        scaleY = 0.75;
      } else if (state === 'flight') {
        const speed = Math.hypot(this.game.vx, this.game.vy);
        rot = Math.atan2(-this.game.vx, this.game.vy);
        const stretch = Math.min(0.5, speed / 800);
        scaleX = 1 - stretch * 0.5;
        scaleY = 1 + stretch;
      } else if (this.landSquash > 0) {
        scaleX = 1 + this.landSquash * 0.5;
        scaleY = 1 - this.landSquash * 0.4;
      } else if (state === 'wallCling') {
        scaleX = 0.85;
        scaleY = 1.15;
      } else {
        // Breathing bob at rest
        const breath = Math.sin(this.animTime * 4) * 0.06;
        scaleX = 1 - breath;
        scaleY = 1 + breath;
      }

      ctx.rotate(rot);
      ctx.scale(scaleX, scaleY);

      // 1. Warm Radiant Light Halo
      const haloR = r * (state === 'burst' ? 3.5 : 2.5);
      const halo = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, haloR);
      if (state === 'extinguished') {
        halo.addColorStop(0, 'rgba(50, 60, 80, 0.2)');
        halo.addColorStop(1, 'rgba(50, 60, 80, 0)');
      } else if (state === 'emptyFall') {
        halo.addColorStop(0, 'rgba(239, 68, 68, 0.3)');
        halo.addColorStop(1, 'rgba(239, 68, 68, 0)');
      } else {
        halo.addColorStop(0, 'rgba(255, 170, 0, 0.5)');
        halo.addColorStop(0.5, 'rgba(255, 68, 0, 0.2)');
        halo.addColorStop(1, 'rgba(255, 68, 0, 0)');
      }
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();

      // 2. Flame Teardrop Body
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.5); // teardrop flame tip
      ctx.quadraticCurveTo(r * 1.2, -r * 0.4, r * 1.1, r * 0.6);
      ctx.quadraticCurveTo(r * 0.9, r * 1.3, 0, r * 1.3);
      ctx.quadraticCurveTo(-r * 0.9, r * 1.3, -r * 1.1, r * 0.6);
      ctx.quadraticCurveTo(-r * 1.2, -r * 0.4, 0, -r * 1.5);
      ctx.closePath();

      const bodyGrad = ctx.createRadialGradient(0, r * 0.2, 1, 0, r * 0.2, r * 1.4);
      if (state === 'extinguished') {
        bodyGrad.addColorStop(0, '#64748b');
        bodyGrad.addColorStop(1, '#1e293b');
      } else if (state === 'emptyFall') {
        bodyGrad.addColorStop(0, '#f87171');
        bodyGrad.addColorStop(0.6, '#dc2626');
        bodyGrad.addColorStop(1, '#7f1d1d');
      } else if (state === 'burst') {
        bodyGrad.addColorStop(0, '#ffffff');
        bodyGrad.addColorStop(0.4, '#fef08a');
        bodyGrad.addColorStop(1, '#ea580c');
      } else {
        bodyGrad.addColorStop(0, '#fffbeb');
        bodyGrad.addColorStop(0.35, '#facc15');
        bodyGrad.addColorStop(0.7, '#ea580c');
        bodyGrad.addColorStop(1, '#b91c1c');
      }
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // 3. Expressive Character Eyes & Face
      this.drawSparkFace(ctx, r, state);

      ctx.restore();

      // 4. Orbiting Glow Stock Wisps (Current jumps left)
      if (state !== 'extinguished') {
        this.drawOrbitingGlows(sx, sy, r);
      }
    }

    drawSparkFace(ctx, r, state) {
      const eyeY = r * 0.2;
      const eyeSpacing = r * 0.45;
      const eyeR = r * 0.26;

      if (state === 'extinguished') {
        // Eyes closed in defeat (crosses or gentle arcs)
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR, Math.PI, 0);
        ctx.arc(eyeSpacing, eyeY, eyeR, Math.PI, 0);
        ctx.stroke();
        return;
      }

      if (state === 'burst') {
        // Ecstatic wide star eyes!
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR * 1.4, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY, eyeR * 1.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ca8a04';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR * 0.8, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY, eyeR * 0.8, 0, Math.PI * 2);
        ctx.fill();

        // Cheerful smile
        ctx.strokeStyle = '#713f12';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, eyeY + r * 0.35, r * 0.3, 0.2, Math.PI - 0.2);
        ctx.stroke();
        return;
      }

      if (state === 'emptyFall') {
        // Terrified wide eyes + quivering pupils
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR * 1.35, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY, eyeR * 1.35, 0, Math.PI * 2);
        ctx.fill();

        const quiver = Math.sin(this.animTime * 30) * 0.8;
        ctx.fillStyle = '#1e1b4b';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + quiver, eyeY + 1, eyeR * 0.4, 0, Math.PI * 2);
        ctx.arc(eyeSpacing + quiver, eyeY + 1, eyeR * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // Gasping mouth :O
        ctx.fillStyle = '#1e1b4b';
        ctx.beginPath();
        ctx.ellipse(0, eyeY + r * 0.4, r * 0.18, r * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      if (state === 'aiming') {
        // Determined, focused squint looking in launch direction
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(-eyeSpacing, eyeY, eyeR * 1.1, eyeR * 0.65, 0.15, 0, Math.PI * 2);
        ctx.ellipse(eyeSpacing, eyeY, eyeR * 1.1, eyeR * 0.65, -0.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY - 1, eyeR * 0.45, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY - 1, eyeR * 0.45, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      if (state === 'wallCling') {
        // Straining / nervous expression
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + 1, eyeY - 1, eyeR * 0.5, 0, Math.PI * 2);
        ctx.arc(eyeSpacing + 1, eyeY - 1, eyeR * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Strained mouth
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.2, eyeY + r * 0.35);
        ctx.lineTo(r * 0.2, eyeY + r * 0.35);
        ctx.stroke();
        return;
      }

      // Normal resting / flying face
      if (this.isBlinking) {
        // Blinking
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-eyeSpacing - eyeR, eyeY);
        ctx.lineTo(-eyeSpacing + eyeR, eyeY);
        ctx.moveTo(eyeSpacing - eyeR, eyeY);
        ctx.lineTo(eyeSpacing + eyeR, eyeY);
        ctx.stroke();
      } else {
        // Bright open eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();

        // Pupils looking slightly up
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(-eyeSpacing, eyeY - 1, eyeR * 0.55, 0, Math.PI * 2);
        ctx.arc(eyeSpacing, eyeY - 1, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();

        // Cute eye catchlights
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-eyeSpacing - 1, eyeY - 2, eyeR * 0.25, 0, Math.PI * 2);
        ctx.arc(eyeSpacing - 1, eyeY - 2, eyeR * 0.25, 0, Math.PI * 2);
        ctx.fill();

        // Small happy mouth
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, eyeY + r * 0.32, r * 0.18, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
    }

    drawOrbitingGlows(sx, sy, r) {
      const ctx = this.ctx;
      const count = this.game.jumpsLeft;
      if (count <= 0) return;

      const orbitR = r * 1.85;
      const speed = this.animTime * 3.5;

      for (let i = 0; i < count; i++) {
        const angle = speed + (i * Math.PI * 2) / count;
        const ox = sx + Math.cos(angle) * orbitR;
        const oy = sy + Math.sin(angle) * (orbitR * 0.55); // tilted orbit

        // Glowing orb
        const glow = ctx.createRadialGradient(ox, oy, 1, ox, oy, 6 * this.scale);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.4, '#ffcc00');
        glow.addColorStop(1, 'rgba(255, 106, 26, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ox, oy, 6 * this.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawDamp() {
      const ctx = this.ctx;
      const dampScreenY = this.toScreenY(this.game.dampY);
      const h = this.canvas.height;
      const w = this.canvas.width;

      if (dampScreenY > h + 100) return; // below screen

      ctx.save();

      // Multi-layered living damp waves
      const waves = [
        { amp: 14, freq: 0.02, speed: 2.2, color: 'rgba(28, 53, 82, 0.75)' },
        { amp: 18, freq: 0.03, speed: -1.6, color: 'rgba(15, 23, 42, 0.9)' },
        { amp: 10, freq: 0.04, speed: 3.0, color: 'rgba(6, 9, 15, 0.98)' }
      ];

      waves.forEach((wv, idx) => {
        ctx.fillStyle = wv.color;
        ctx.beginPath();
        ctx.moveTo(0, h);

        for (let x = 0; x <= w; x += 8) {
          const waveY = dampScreenY + Math.sin(x * wv.freq + this.animTime * wv.speed) * wv.amp * this.scale;
          ctx.lineTo(x, waveY);
        }

        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      });

      // Crest bioluminescent cyan/blue glow line
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
      ctx.lineWidth = 2 * this.scale;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = dampScreenY + Math.sin(x * 0.025 + this.animTime * 2) * 12 * this.scale;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Cold rising mist vignettes if damp is within screen
      const distToSpark = (this.game.y - this.game.dampY);
      if (distToSpark < 180) {
        const fear = 1 - Math.max(0, distToSpark) / 180;
        const fearGrad = ctx.createLinearGradient(0, h - 140 * this.scale, 0, h);
        fearGrad.addColorStop(0, 'rgba(34, 211, 238, 0)');
        fearGrad.addColorStop(1, `rgba(34, 211, 238, ${0.35 * fear})`);
        ctx.fillStyle = fearGrad;
        ctx.fillRect(0, h - 140 * this.scale, w, 140 * this.scale);
      }

      ctx.restore();
    }

    drawParticles(dt) {
      const ctx = this.ctx;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        if (p.isRing) {
          // Expanding shockwave ring
          const progress = 1 - p.life / p.maxLife;
          const currentR = p.radius + (p.maxRadius - p.radius) * progress;
          const sx = this.toScreenX(p.x);
          const sy = this.toScreenY(p.y);

          ctx.strokeStyle = `rgba(255, 204, 0, ${(1 - progress) * 0.7})`;
          ctx.lineWidth = (3 - progress * 2) * this.scale;
          ctx.beginPath();
          ctx.arc(sx, sy, currentR * this.scale, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;

          const sx = this.toScreenX(p.x);
          const sy = this.toScreenY(p.y);
          const alpha = p.life / p.maxLife;

          ctx.fillStyle = p.color;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(sx, sy, p.radius * this.scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }
    }

    drawFloatingTexts(dt) {
      const ctx = this.ctx;
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        ft.life -= dt;
        if (ft.life <= 0) {
          this.floatingTexts.splice(i, 1);
          continue;
        }

        ft.y += 24 * dt; // float upward
        const sx = this.toScreenX(ft.x);
        const sy = this.toScreenY(ft.y);
        const alpha = ft.life / ft.maxLife;

        ctx.save();
        ctx.font = `900 ${Math.round(14 * ft.scale * this.scale)}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 6;
        ctx.fillText(ft.text, sx, sy);
        ctx.restore();
      }
    }

    updateHud() {
      if (this.scoreEl) {
        this.scoreEl.textContent = this.game.score.toLocaleString();
      }
      if (this.bestEl) {
        this.bestEl.textContent = `BEST: ${this.game.sessionBest.toLocaleString()}`;
      }

      // Update glow pips
      for (let i = 0; i < 3; i++) {
        if (this.pips[i]) {
          if (i < this.game.jumpsLeft) {
            this.pips[i].classList.add('active');
          } else {
            this.pips[i].classList.remove('active');
          }
        }
      }

      // Chain Banner
      if (this.chainBanner) {
        if (this.game.chainCount > 0) {
          this.chainBanner.textContent = `CHAIN x${this.game.chainCount}!`;
          this.chainBanner.classList.add('visible');
          if (this.game.chainCount >= 3) {
            this.chainBanner.classList.add('high-chain');
          } else {
            this.chainBanner.classList.remove('high-chain');
          }
        } else {
          this.chainBanner.classList.remove('visible');
        }
      }
    }
  }

  window.EmberRenderer = EmberRenderer;
})();
