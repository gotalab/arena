/**
 * Visual Renderer & Juice FX Engine for DELVE
 * Renders layered parallax caverns, character animations, lighting, particles, and HUD.
 */
class GameRenderer {
  constructor(canvas, game, inputManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.input = inputManager;

    // Camera & Viewport
    this.viewportWidth = 600;
    this.viewportHeight = 900;
    this.camX = 0;
    this.camDepth = 0;
    this.scale = 1;

    // Animation & FX states
    this.animTime = 0;
    this.drillAngle = 0;
    this.screenShake = 0;
    this.shakeX = 0;
    this.shakeY = 0;

    // View-only Particles & Floating Texts
    this.particles = [];
    this.floatingTexts = [];
    this.dustMotes = [];
    this.initDustMotes();

    // Event hooks for visual juice
    this.lastObservedEventSeq = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    // Determine virtual game coordinates (base width ~ 580)
    const aspect = rect.width / rect.height;
    if (aspect > 1) {
      // Landscape desktop
      this.viewportHeight = 850;
      this.viewportWidth = 850 * aspect;
    } else {
      // Portrait mobile
      this.viewportWidth = 560;
      this.viewportHeight = 560 / aspect;
    }

    this.scale = this.canvas.width / this.viewportWidth;
  }

  initDustMotes() {
    for (let i = 0; i < 40; i++) {
      this.dustMotes.push({
        x: (Math.random() - 0.5) * 600,
        relDepth: Math.random() * 1000,
        size: 1 + Math.random() * 2.5,
        speed: 0.2 + Math.random() * 0.8,
        alpha: 0.15 + Math.random() * 0.4
      });
    }
  }

  // Check new events to spawn juice particles/text
  processEvents() {
    const events = this.game.events;
    while (this.lastObservedEventSeq < events.length) {
      const ev = events[this.lastObservedEventSeq];
      this.lastObservedEventSeq++;

      if (ev.kind === "wall_contact") {
        this.screenShake = 9;
        this.spawnSparks(this.game.x, this.game.depth, 16, "#ffaa44");
      } else if (ev.kind === "rock_hit") {
        this.screenShake = 16;
        this.spawnRockDebris(this.game.x, this.game.depth, 24, "#8a7d75");
        this.spawnFloatingText(this.game.x, this.game.depth - 20, "STALL!", "#ff4444", 20);
      } else if (ev.kind === "rock_broken") {
        this.screenShake = 12;
        this.spawnRockDebris(this.game.x, this.game.depth, 32, "#ffdd44");
        this.spawnSparks(this.game.x, this.game.depth, 20, "#ffff88");
        this.spawnFloatingText(this.game.x, this.game.depth - 25, "+2.0s SMASH!", "#ffe135", 22);
      } else if (ev.kind === "fragment") {
        this.spawnSparks(this.game.x, this.game.depth, 14, "#00ffcc");
        this.spawnFloatingText(this.game.x, this.game.depth - 20, "+1.4s", "#00ffcc", 18);
      } else if (ev.kind === "power") {
        this.screenShake = 14;
        this.spawnSparks(this.game.x, this.game.depth, 40, "#ff00ff");
        this.spawnFloatingText(this.game.x, this.game.depth - 35, "OVERCHARGE ACTIVE!", "#ff00ff", 26);
      } else if (ev.kind === "near_miss") {
        const combo = this.game.nearMissCombo;
        const msg = combo > 1 ? `GRAZE x${combo}!` : "GRAZE!";
        this.spawnFloatingText(this.game.x + (Math.random() - 0.5) * 30, this.game.depth - 30, msg, "#38ef7d", 19);
        this.spawnSparks(this.game.x, this.game.depth, 10, "#38ef7d");
      }
    }
  }

  spawnSparks(x, depth, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 240;
      this.particles.push({
        x: x,
        depth: depth,
        vx: Math.cos(angle) * speed,
        vDepth: Math.sin(angle) * speed,
        size: 2 + Math.random() * 3.5,
        color: color,
        life: 1.0,
        decay: 1.5 + Math.random() * 2.5
      });
    }
  }

  spawnRockDebris(x, depth, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 320;
      this.particles.push({
        x: x,
        depth: depth,
        vx: Math.cos(angle) * speed,
        vDepth: Math.sin(angle) * speed,
        size: 4 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 12,
        color: color,
        life: 1.0,
        decay: 1.0 + Math.random() * 1.5
      });
    }
  }

  spawnFloatingText(x, depth, text, color, fontSize = 18) {
    this.floatingTexts.push({
      x: x,
      depth: depth,
      text: text,
      color: color,
      fontSize: fontSize,
      life: 1.0,
      decay: 1.2
    });
  }

  updateFX(dt) {
    this.animTime += dt;
    const speedRatio = (this.game.speed - this.game.CRAWL_SPEED) / (this.game.maxSpeed - this.game.CRAWL_SPEED);

    // Drill spinning speed
    this.drillAngle += (15 + speedRatio * 45) * dt;

    // Screen Shake decay
    if (this.screenShake > 0) {
      this.shakeX = (Math.random() - 0.5) * this.screenShake;
      this.shakeY = (Math.random() - 0.5) * this.screenShake;
      this.screenShake = Math.max(0, this.screenShake - dt * 35);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.depth += p.vDepth * dt;
      if (p.vRot) p.rot += p.vRot * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update Floating Text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.depth -= 60 * dt; // Float upward in world
      ft.life -= ft.decay * dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // Drilling exhaust particles when digging
    if (this.game.phase === "playing") {
      // Exhaust fire behind machine
      const isPowered = this.game.timeMs < this.game.invincibleUntilMs;
      const exColor = isPowered ? "#ff00ff" : (this.game.input.down ? "#00e5ff" : "#ffaa44");
      this.particles.push({
        x: this.game.x + (Math.random() - 0.5) * 12,
        depth: this.game.depth - 16,
        vx: (Math.random() - 0.5) * 30,
        vDepth: -this.game.speed * 0.4 - Math.random() * 80,
        size: 3 + Math.random() * 4,
        color: exColor,
        life: 0.6,
        decay: 2.2
      });
    }

    // Smooth Camera Follow with forward lookahead
    const targetCamX = this.game.x;
    const targetCamDepth = this.game.depth + 140 + speedRatio * 80;
    this.camX += (targetCamX - this.camX) * 0.12;
    this.camDepth += (targetCamDepth - this.camDepth) * 0.14;
  }

  render(dt) {
    this.processEvents();
    this.updateFX(dt);

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply scale and camera transform
    ctx.scale(this.scale, this.scale);
    ctx.translate(
      this.viewportWidth * 0.5 - this.camX + this.shakeX,
      this.viewportHeight * 0.35 - this.camDepth + this.shakeY
    );

    // 1. Render Layered Underground Background & Parallax
    this.renderCavernBackground(ctx);

    // 2. Render Corridor Walls & Terrain
    this.renderCorridorWalls(ctx);

    // 3. Render Collectibles (Fragments & Power Core)
    this.renderItems(ctx);

    // 4. Render Rocks & Obstacles
    this.renderRocks(ctx);

    // 5. Render Particle FX
    this.renderParticles(ctx);

    // 6. Render Player Character (The Drill-Pod)
    this.renderPlayer(ctx);

    // 7. Render Floating Text
    this.renderFloatingTexts(ctx);

    // 8. Restore camera transform and Render Screen-space HUD & Overlays
    ctx.restore();

    this.renderScreenEffects(ctx);
    this.renderHUD(ctx);
    this.renderVirtualJoystick(ctx);

    if (this.game.phase === "ready") {
      this.renderReadyScreen(ctx);
    } else if (this.game.phase === "gameover") {
      this.renderGameOverScreen(ctx);
    }
  }

  getBiomeColor(depth) {
    if (depth < 6000) {
      return { bg: "#0d0a14", wall: "#2e2133", wallTrim: "#e08d3c", wallAcc: "#7a483a" };
    } else if (depth < 16000) {
      return { bg: "#080b18", wall: "#1e2247", wallTrim: "#9d4edd", wallAcc: "#3a0ca3" };
    } else if (depth < 30000) {
      return { bg: "#140608", wall: "#3d131a", wallTrim: "#ff4d6d", wallAcc: "#800f2f" };
    } else {
      return { bg: "#041416", wall: "#0e343b", wallTrim: "#00f5d4", wallAcc: "#05668d" };
    }
  }

  renderCavernBackground(ctx) {
    const biome = this.getBiomeColor(this.camDepth);
    const viewTop = this.camDepth - this.viewportHeight * 0.5;
    const viewBottom = this.camDepth + this.viewportHeight * 1.2;

    // Background base
    ctx.fillStyle = biome.bg;
    ctx.fillRect(this.camX - this.viewportWidth, viewTop, this.viewportWidth * 2, viewBottom - viewTop);

    // Ambient Headlight beam from player
    const isPowered = this.game.timeMs < this.game.invincibleUntilMs;
    const grad = ctx.createRadialGradient(
      this.game.x, this.game.depth, 10,
      this.game.x, this.game.depth + 300, 420
    );
    grad.addColorStop(0, isPowered ? "rgba(255, 0, 255, 0.35)" : "rgba(255, 240, 180, 0.28)");
    grad.addColorStop(0.5, isPowered ? "rgba(180, 0, 255, 0.12)" : "rgba(255, 200, 100, 0.08)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(this.game.x - 30, this.game.depth);
    ctx.lineTo(this.game.x - 220, this.game.depth + 500);
    ctx.lineTo(this.game.x + 220, this.game.depth + 500);
    ctx.lineTo(this.game.x + 30, this.game.depth);
    ctx.closePath();
    ctx.fill();

    // Floating Dust Motes
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < this.dustMotes.length; i++) {
      const m = this.dustMotes[i];
      const myDepth = viewTop + ((m.relDepth + this.animTime * m.speed * 40) % (viewBottom - viewTop));
      const mx = this.camX + m.x;
      ctx.globalAlpha = m.alpha;
      ctx.beginPath();
      ctx.arc(mx, myDepth, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  renderCorridorWalls(ctx) {
    const biome = this.getBiomeColor(this.camDepth);
    const horizon = this.game.PREVIEW_HORIZON + 300;
    const startD = Math.max(0, Math.floor((this.camDepth - 300) / 20) * 20);
    const endD = this.camDepth + horizon;
    const step = 20;

    const leftPoints = [];
    const rightPoints = [];

    for (let d = startD; d <= endD; d += step) {
      const w = this.game.course.getWallsAt(d);
      leftPoints.push({ x: w.leftX, depth: d });
      rightPoints.push({ x: w.rightX, depth: d });
    }

    if (leftPoints.length < 2) return;

    // Outer Left Solid Cavern Rock
    ctx.fillStyle = biome.wall;
    ctx.beginPath();
    ctx.moveTo(this.camX - this.viewportWidth * 1.5, startD);
    for (let i = 0; i < leftPoints.length; i++) {
      ctx.lineTo(leftPoints[i].x, leftPoints[i].depth);
    }
    ctx.lineTo(this.camX - this.viewportWidth * 1.5, endD);
    ctx.closePath();
    ctx.fill();

    // Outer Right Solid Cavern Rock
    ctx.beginPath();
    ctx.moveTo(this.camX + this.viewportWidth * 1.5, startD);
    for (let i = 0; i < rightPoints.length; i++) {
      ctx.lineTo(rightPoints[i].x, rightPoints[i].depth);
    }
    ctx.lineTo(this.camX + this.viewportWidth * 1.5, endD);
    ctx.closePath();
    ctx.fill();

    // Glowing Corridor Rim Wall Highlights
    ctx.strokeStyle = biome.wallTrim;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Left Rim
    ctx.beginPath();
    ctx.moveTo(leftPoints[0].x, leftPoints[0].depth);
    for (let i = 1; i < leftPoints.length; i++) {
      ctx.lineTo(leftPoints[i].x, leftPoints[i].depth);
    }
    ctx.stroke();

    // Right Rim
    ctx.beginPath();
    ctx.moveTo(rightPoints[0].x, rightPoints[0].depth);
    for (let i = 1; i < rightPoints.length; i++) {
      ctx.lineTo(rightPoints[i].x, rightPoints[i].depth);
    }
    ctx.stroke();

    // Internal Strata Accent Lines
    ctx.strokeStyle = biome.wallAcc;
    ctx.lineWidth = 2;
    for (let i = 0; i < leftPoints.length; i += 4) {
      const p = leftPoints[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.depth);
      ctx.lineTo(p.x - 50, p.depth + 15);
      ctx.stroke();
    }
    for (let i = 0; i < rightPoints.length; i += 4) {
      const p = rightPoints[i];
      ctx.beginPath();
      ctx.moveTo(p.x, p.depth);
      ctx.lineTo(p.x + 50, p.depth + 15);
      ctx.stroke();
    }
  }

  renderItems(ctx) {
    const horizon = this.game.course.getEntitiesInHorizon(this.camDepth, this.game.PREVIEW_HORIZON + 200);
    const items = horizon.items;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.active) continue;

      const px = item.position.x;
      const pd = item.position.depth;

      if (item.type === "fragment") {
        // Time Fragment: Pulsing crystalline hourglass / rhomboid shard
        const pulse = Math.sin(this.animTime * 6 + item.id) * 0.15 + 1.0;
        const rad = item.visualRadius * pulse;

        // Glow halo
        ctx.fillStyle = "rgba(0, 255, 204, 0.25)";
        ctx.beginPath();
        ctx.arc(px, pd, rad * 1.8, 0, Math.PI * 2);
        ctx.fill();

        // Crystal body
        ctx.save();
        ctx.translate(px, pd);
        ctx.rotate(this.animTime * 2 + item.formationIndex * 0.5);

        ctx.fillStyle = "#00ffcc";
        ctx.beginPath();
        ctx.moveTo(0, -rad * 1.2);
        ctx.lineTo(rad * 0.8, 0);
        ctx.lineTo(0, rad * 1.2);
        ctx.lineTo(-rad * 0.8, 0);
        ctx.closePath();
        ctx.fill();

        // Inner bright core
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(0, -rad * 0.6);
        ctx.lineTo(rad * 0.4, 0);
        ctx.lineTo(0, rad * 0.6);
        ctx.lineTo(-rad * 0.4, 0);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      } else if (item.type === "power") {
        // Rare Overcharge Core: Blazing spherical plasma orb with revolving rings
        const pulse = Math.sin(this.animTime * 10) * 0.2 + 1.0;
        const rad = item.visualRadius * pulse;

        // Pulsing power aura
        const pGlow = ctx.createRadialGradient(px, pd, 5, px, pd, rad * 2.5);
        pGlow.addColorStop(0, "rgba(255, 0, 255, 0.8)");
        pGlow.addColorStop(0.5, "rgba(255, 100, 255, 0.3)");
        pGlow.addColorStop(1, "rgba(255, 0, 255, 0)");
        ctx.fillStyle = pGlow;
        ctx.beginPath();
        ctx.arc(px, pd, rad * 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Central Orb
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, pd, rad * 0.6, 0, Math.PI * 2);
        ctx.fill();

        // Revolving energy rings
        ctx.save();
        ctx.translate(px, pd);
        ctx.rotate(this.animTime * 4);
        ctx.strokeStyle = "#ff00ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * 1.3, rad * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.rotate(Math.PI / 2);
        ctx.strokeStyle = "#00ffff";
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * 1.3, rad * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  renderRocks(ctx) {
    const horizon = this.game.course.getEntitiesInHorizon(this.camDepth, this.game.PREVIEW_HORIZON + 200);
    const rocks = horizon.rocks;

    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      if (!r.active) continue;

      const rx = r.position.x;
      const rd = r.position.depth;
      const rad = r.visualRadius;

      // Draw multi-faceted rocky boulder with jagged vertices
      ctx.save();
      ctx.translate(rx, rd);

      // Deterministic rock shape based on id
      const pr = new PRNG(r.id * 7919);
      const sides = 8;
      ctx.beginPath();
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const radVar = rad * (0.85 + pr.range(0, 0.3));
        const vx = Math.cos(ang) * radVar;
        const vy = Math.sin(ang) * radVar;
        if (s === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();

      // Rock gradient shading
      const isInvincible = this.game.timeMs < this.game.invincibleUntilMs;
      if (isInvincible) {
        // In power mode, rocks glow as smashable targets!
        ctx.fillStyle = "#5c2a42";
        ctx.fill();
        ctx.strokeStyle = "#ff5599";
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Target reticle
        ctx.strokeStyle = "rgba(255, 85, 153, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, rad * 1.3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#3f363c";
        ctx.fill();
        ctx.strokeStyle = "#6b5e67";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Inner rock facet highlights
        ctx.fillStyle = "#52464e";
        ctx.beginPath();
        ctx.moveTo(-rad * 0.4, -rad * 0.4);
        ctx.lineTo(rad * 0.3, -rad * 0.6);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  renderParticles(ctx) {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;

      if (p.rot !== undefined) {
        ctx.translate(p.x, p.depth);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.depth, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1.0;
  }

  renderPlayer(ctx) {
    const px = this.game.x;
    const pDepth = this.game.depth;
    const speed = this.game.speed;
    const maxSpeed = this.game.maxSpeed;
    const speedRatio = (speed - this.game.CRAWL_SPEED) / (maxSpeed - this.game.CRAWL_SPEED);
    const isPowered = this.game.timeMs < this.game.invincibleUntilMs;
    const isStalled = this.game.stallTimeRemaining > 0;
    const isGameOver = this.game.phase === "gameover";

    // Squish & Stretch deformation along motion
    let stretchY = 1.0 + speedRatio * 0.28;
    let squishX = 1.0 / Math.sqrt(stretchY);

    if (isStalled) {
      squishX = 1.25;
      stretchY = 0.75;
    }

    ctx.save();
    ctx.translate(px, pDepth);
    ctx.scale(squishX, stretchY);

    // Lateral tilt based on steering
    let tilt = 0;
    if (this.game.input.left) tilt = -0.22;
    else if (this.game.input.right) tilt = 0.22;
    ctx.rotate(tilt);

    // Power Supercharge Aura
    if (isPowered) {
      ctx.strokeStyle = "#ff00ff";
      ctx.lineWidth = 4;
      ctx.shadowColor = "#ff00ff";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 1. Dual Side Thrusters
    ctx.fillStyle = "#2c3038";
    ctx.fillRect(-22, -14, 8, 22);
    ctx.fillRect(14, -14, 8, 22);

    // Thruster exhaust flames
    if (!isGameOver) {
      const flameH = 12 + speedRatio * 25 + Math.sin(this.animTime * 30) * 4;
      ctx.fillStyle = isPowered ? "#ff00ff" : "#00ffff";
      ctx.beginPath();
      ctx.moveTo(-22, -14);
      ctx.lineTo(-18, -14 - flameH);
      ctx.lineTo(-14, -14);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(14, -14);
      ctx.lineTo(18, -14 - flameH);
      ctx.lineTo(22, -14);
      ctx.closePath();
      ctx.fill();
    }

    // 2. Machine Main Chassis Body
    const bodyGrad = ctx.createLinearGradient(-18, 0, 18, 0);
    bodyGrad.addColorStop(0, "#d97706");
    bodyGrad.addColorStop(0.5, "#fbbf24");
    bodyGrad.addColorStop(1, "#b45309");

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(-16, -16, 32, 28, 8);
    ctx.fill();

    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 3. Rotating Front Drill Cone
    ctx.save();
    ctx.translate(0, 14);

    const drillGrad = ctx.createLinearGradient(-14, 0, 14, 0);
    drillGrad.addColorStop(0, "#94a3b8");
    drillGrad.addColorStop(0.5, "#f1f5f9");
    drillGrad.addColorStop(1, "#64748b");

    ctx.fillStyle = drillGrad;
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(0, 26);
    ctx.lineTo(15, 0);
    ctx.closePath();
    ctx.fill();

    // Drill Teeth / Spiral Groove Animation
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2.5;
    const spiralOffset = (this.drillAngle % (Math.PI * 2)) / (Math.PI * 2);
    for (let s = 0; s < 3; s++) {
      const dy = ((s + spiralOffset) % 3) * 8;
      const w = 14 * (1 - dy / 26);
      ctx.beginPath();
      ctx.moveTo(-w, dy);
      ctx.lineTo(w, dy + 3);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Cockpit Dome & Animated Expressive Pilot Eye
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(0, -3, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Eye expression
    let eyeColor = "#00ffcc";
    let pupilX = (this.game.input.right ? 3 : 0) + (this.game.input.left ? -3 : 0);
    let pupilY = 1 + speedRatio * 3;
    let eyeScaleY = 1.0;

    if (isGameOver) {
      // Spent / dazed X eye
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, -7); ctx.lineTo(4, 1);
      ctx.moveTo(4, -7); ctx.lineTo(-4, 1);
      ctx.stroke();
    } else if (isStalled) {
      // Dazed spiral / startled eye
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(0, -3, 6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Living expressive robotic pupil
      if (speedRatio > 0.85) {
        eyeColor = "#ff0055"; // High-speed thrill / adrenaline!
      }
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.arc(pupilX, -3 + pupilY, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Eye glint
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pupilX - 1.5, -4.5 + pupilY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  renderFloatingTexts(ctx) {
    for (let i = 0; i < this.floatingTexts.length; i++) {
      const ft = this.floatingTexts[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.life));
      ctx.font = `bold ${ft.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = ft.color;
      ctx.shadowColor = "#000000";
      ctx.shadowBlur = 6;
      ctx.fillText(ft.text, ft.x, ft.depth);
      ctx.restore();
    }
  }

  renderScreenEffects(ctx) {
    const speedRatio = (this.game.speed - this.game.CRAWL_SPEED) / (this.game.maxSpeed - this.game.CRAWL_SPEED);

    // High Speed Tunnel Vignette & Speed Streaks
    if (speedRatio > 0.65 && this.game.phase === "playing") {
      const alpha = (speedRatio - 0.65) / 0.35 * 0.45;
      const w = this.canvas.width;
      const h = this.canvas.height;

      const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.25, w * 0.5, h * 0.5, w * 0.65);
      grad.addColorStop(0, "rgba(0, 0, 0, 0)");
      grad.addColorStop(1, `rgba(255, 100, 0, ${alpha})`);

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  renderHUD(ctx) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const pad = Math.max(16, w * 0.04);

    // 1. Top Center: Countdown Timer Bar & Gauge
    const timeSec = Math.max(0, (this.game.remainingMs / 1000)).toFixed(1);
    const timeRatio = Math.max(0, Math.min(1, this.game.remainingMs / this.game.MAX_TIME_MS));
    const isCritical = this.game.remainingMs < 5000;

    const barW = Math.min(320, w * 0.6);
    const barH = 14;
    const barX = (w - barW) * 0.5;
    const barY = pad + 10;

    // Timer Bar Background
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.beginPath();
    ctx.roundRect(barX - 4, barY - 4, barW + 8, barH + 8, 8);
    ctx.fill();
    ctx.strokeStyle = isCritical ? "#ff3344" : "#334155";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Timer Fill
    const fillW = barW * timeRatio;
    let barColor = "#00ffcc";
    if (timeRatio < 0.25) barColor = "#ff3344";
    else if (timeRatio < 0.5) barColor = "#ffbb00";

    if (isCritical && Math.sin(this.animTime * 14) > 0) {
      barColor = "#ffffff";
    }

    ctx.fillStyle = barColor;
    ctx.beginPath();
    ctx.roundRect(barX, barY, Math.max(4, fillW), barH, 4);
    ctx.fill();

    // Digital Time Text
    ctx.font = `900 ${Math.max(22, w * 0.045)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = isCritical ? "#ff4444" : "#f8fafc";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 8;
    ctx.fillText(`${timeSec}s`, w * 0.5, barY + barH + 28);
    ctx.shadowBlur = 0;

    // 2. Top Left: Depth & Score
    ctx.textAlign = "left";
    ctx.font = `bold ${Math.max(13, w * 0.028)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("DEPTH", pad, pad + 14);

    ctx.font = `900 ${Math.max(20, w * 0.042)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(`${Math.floor(this.game.depth)}m`, pad, pad + 38);

    ctx.font = `bold ${Math.max(12, w * 0.025)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`SCORE ${Math.floor(this.game.score)}`, pad, pad + 58);

    // 3. Top Right: Speedometer & Power Gauge
    ctx.textAlign = "right";
    const speedRatio = (this.game.speed - this.game.CRAWL_SPEED) / (this.game.maxSpeed - this.game.CRAWL_SPEED);
    const speedPct = Math.round(speedRatio * 100);

    ctx.font = `bold ${Math.max(13, w * 0.028)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("SPEED", w - pad, pad + 14);

    ctx.font = `900 ${Math.max(20, w * 0.042)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = speedPct >= 90 ? "#ff5500" : "#f8fafc";
    ctx.fillText(`${speedPct}%`, w - pad, pad + 38);

    // Power Supercharge Banner
    const isPowered = this.game.timeMs < this.game.invincibleUntilMs;
    if (isPowered) {
      const powRemSec = Math.max(0, (this.game.invincibleUntilMs - this.game.timeMs) / 1000).toFixed(1);
      ctx.textAlign = "right";
      ctx.font = `bold ${Math.max(13, w * 0.028)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = "#ff00ff";
      ctx.fillText(`⚡ OVERCHARGE ${powRemSec}s`, w - pad, pad + 60);
    }

    // Near-Miss Combo Streak Badge
    if (this.game.nearMissCombo > 1) {
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(15, w * 0.032)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = "#38ef7d";
      ctx.fillText(`STREAK x${this.game.nearMissCombo}`, w * 0.5, barY + barH + 52);
    }
  }

  renderVirtualJoystick(ctx) {
    const pt = this.input.getPointerVisual();
    if (!pt) return;

    const dpr = window.devicePixelRatio || 1;
    const ax = pt.anchorX * dpr;
    const ay = pt.anchorY * dpr;
    const cx = pt.currentX * dpr;
    const cy = pt.currentY * dpr;

    // Anchor Ring
    ctx.save();
    ctx.strokeStyle = "rgba(0, 255, 204, 0.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ax, ay, 42, 0, Math.PI * 2);
    ctx.stroke();

    // Connecting line
    ctx.strokeStyle = "rgba(0, 255, 204, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Active Knob
    ctx.fillStyle = "#00ffcc";
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  renderReadyScreen(ctx) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    // Dark translucent backdrop
    ctx.fillStyle = "rgba(8, 7, 13, 0.65)";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 12;

    // Title
    ctx.font = `900 ${Math.max(38, w * 0.09)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText("DELVE", w * 0.5, h * 0.35);

    ctx.font = `bold ${Math.max(15, w * 0.034)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#00ffcc";
    ctx.fillText("DEEP EXCAVATION PROTOCOL", w * 0.5, h * 0.40);

    // Call to Action
    const pulse = Math.sin(this.animTime * 6) * 0.15 + 0.85;
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${Math.max(16, w * 0.038)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#fbbf24";
    ctx.fillText("HOLD [DOWN] / [SPACE] OR DRAG DOWN TO DRILL", w * 0.5, h * 0.62);

    ctx.globalAlpha = 0.8;
    ctx.font = `${Math.max(13, w * 0.028)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("Steer with Left/Right or drag thumb • Collect fragments for time", w * 0.5, h * 0.67);

    ctx.restore();
  }

  renderGameOverScreen(ctx) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const rank = this.game.rank || "D";
    const score = Math.floor(this.game.score);
    const depth = Math.floor(this.game.depth);
    const bestScore = this.game.sessionBestScore;

    ctx.save();
    ctx.fillStyle = "rgba(8, 7, 13, 0.82)";
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = "center";
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 14;

    // Game Over Header
    ctx.font = `900 ${Math.max(28, w * 0.065)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#ff4444";
    ctx.fillText("POWER DEPLETED", w * 0.5, h * 0.22);

    // Rank Badge
    let rankColor = "#94a3b8";
    if (rank === "S+" || rank === "S") rankColor = "#ffd700";
    else if (rank === "A") rankColor = "#ff00ff";
    else if (rank === "B") rankColor = "#00ffcc";
    else if (rank === "C") rankColor = "#38ef7d";

    ctx.font = `900 ${Math.max(52, w * 0.12)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = rankColor;
    ctx.fillText(`GRADE ${rank}`, w * 0.5, h * 0.32);

    // Score & Depth Cards
    const cardW = Math.min(360, w * 0.82);
    const cardH = 175;
    const cardX = (w - cardW) * 0.5;
    const cardY = h * 0.38;

    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Score details
    ctx.font = `bold ${Math.max(14, w * 0.03)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("FINAL SCORE", w * 0.5, cardY + 28);

    ctx.font = `900 ${Math.max(24, w * 0.052)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(`${score.toLocaleString()}`, w * 0.5, cardY + 56);

    ctx.font = `bold ${Math.max(13, w * 0.026)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#64748b";
    ctx.fillText(`SESSION BEST: ${bestScore.toLocaleString()}  •  DEPTH: ${depth}m`, w * 0.5, cardY + 84);

    // Signature Stat
    const statMs = (this.game.stats.longestFullThrottleMs / 1000).toFixed(1);
    const nearMissCount = this.game.stats.nearMissCount;
    const shave = this.game.stats.closestShave < 900 ? `${this.game.stats.closestShave}u` : "None";

    let statTitle = "FULL THROTTLE STREAK";
    let statVal = `${statMs}s`;
    if (this.game.rocksBroken > 0) {
      statTitle = "ROCKS SMASHED";
      statVal = `${this.game.rocksBroken}`;
    } else if (nearMissCount >= 3) {
      statTitle = "CLOSEST SHAVE";
      statVal = `${shave} (${nearMissCount} grazes)`;
    }

    ctx.font = `bold ${Math.max(12, w * 0.025)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#38ef7d";
    ctx.fillText(`★ SIGNATURE STAT: ${statTitle} : ${statVal}`, w * 0.5, cardY + 124);

    ctx.font = `${Math.max(12, w * 0.024)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`FRAGMENTS: ${this.game.fragmentsCollected}  •  WALL CONTACTS: ${this.game.wallContacts}`, w * 0.5, cardY + 152);

    // Restart Call to Action
    const pulse = Math.sin(this.animTime * 6) * 0.15 + 0.85;
    ctx.globalAlpha = pulse;
    ctx.font = `bold ${Math.max(16, w * 0.038)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#00ffcc";
    ctx.fillText("TAP OR PRESS [R] TO DIVE AGAIN", w * 0.5, h * 0.72);

    ctx.restore();
  }
}

window.GameRenderer = GameRenderer;
