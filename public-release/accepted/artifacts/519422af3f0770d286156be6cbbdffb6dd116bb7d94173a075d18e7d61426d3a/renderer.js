// Canvas Renderer for LUMEN YARD
export class Renderer {
  constructor(canvas, engine, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.engine = engine;

    this.motionEnabled = options.motionEnabled ?? true;

    // Viewport & layout
    this.dpr = window.devicePixelRatio || 1;
    this.cellSize = 48;
    this.offsetX = 0;
    this.offsetY = 0;
    this.boardWidthPx = 0;
    this.boardHeightPx = 0;

    // Visual animated states
    this.playerVisual = {
      r: engine.player.row,
      c: engine.player.col,
      facing: engine.playerFacing || "down",
      pushing: false,
      blockedAnim: 0
    };

    this.cratesVisual = new Map();
    this.updateVisualCrates(true);

    // FX & Particles
    this.particles = [];
    this.ambientMotes = [];
    this.initAmbientMotes();
    this.surgeWave = null; // { cx, cy, radius, maxRadius, alpha }
    this.shake = 0;

    this.lastTime = performance.now();
    this.animId = null;

    this.bindEvents();
    this.resize();
  }

  setMotion(enabled) {
    this.motionEnabled = enabled;
  }

  initAmbientMotes() {
    this.ambientMotes = [];
    for (let i = 0; i < 24; i++) {
      this.ambientMotes.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0003,
        vy: -0.0002 - Math.random() * 0.0004,
        size: 1 + Math.random() * 2,
        alpha: 0.15 + Math.random() * 0.35,
        pulse: Math.random() * Math.PI * 2
      });
    }
  }

  updateVisualCrates(snapImmediately = false) {
    const currentCrates = this.engine.crates;
    const newMap = new Map();

    for (let i = 0; i < currentCrates.length; i++) {
      const c = currentCrates[i];
      const key = i;
      const existing = this.cratesVisual.get(key);
      if (existing && !snapImmediately && this.motionEnabled) {
        newMap.set(key, {
          r: existing.r,
          c: existing.c,
          targetR: c.row,
          targetC: c.col,
          glow: existing.glow || 0
        });
      } else {
        newMap.set(key, {
          r: c.row,
          c: c.col,
          targetR: c.row,
          targetC: c.col,
          glow: 0
        });
      }
    }
    this.cratesVisual = newMap;
  }

  bindEvents() {
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // Compute cell size to fit board inside container with margins
    const cols = this.engine.currentLevel.width;
    const rows = this.engine.currentLevel.height;

    const maxCellW = Math.floor((w - 24) / cols);
    const maxCellH = Math.floor((h - 24) / rows);
    this.cellSize = Math.max(28, Math.min(maxCellW, maxCellH, 72));

    this.boardWidthPx = cols * this.cellSize;
    this.boardHeightPx = rows * this.cellSize;
    this.offsetX = Math.floor((w - this.boardWidthPx) / 2);
    this.offsetY = Math.floor((h - this.boardHeightPx) / 2);

    this.renderImmediate();
  }

  onGameEvent(event) {
    if (event.type === "level_loaded") {
      this.playerVisual.r = this.engine.player.row;
      this.playerVisual.c = this.engine.player.col;
      this.playerVisual.facing = this.engine.playerFacing;
      this.updateVisualCrates(true);
      this.surgeWave = null;
      this.resize();
    } else if (event.type === "step") {
      this.playerVisual.facing = event.direction;
      this.playerVisual.pushing = false;
      if (!this.motionEnabled) {
        this.playerVisual.r = this.engine.player.row;
        this.playerVisual.c = this.engine.player.col;
      }
    } else if (event.type === "push") {
      this.playerVisual.facing = event.direction;
      this.playerVisual.pushing = true;
      if (this.motionEnabled) {
        this.shake = 3.5;
      }
      this.updateVisualCrates(false);
      if (!this.motionEnabled) {
        this.playerVisual.r = this.engine.player.row;
        this.playerVisual.c = this.engine.player.col;
        this.updateVisualCrates(true);
      }

      if (event.onGoal) {
        // Spawn sparks on goal contact
        const gx = (event.crate.col + 0.5) * this.cellSize;
        const gy = (event.crate.row + 0.5) * this.cellSize;
        this.spawnSparks(gx, gy, 14, "#00ffcc");
      }
    } else if (event.type === "move_blocked" || event.type === "push_blocked") {
      this.playerVisual.facing = event.direction;
      this.playerVisual.blockedAnim = 1.0;
      if (this.motionEnabled) {
        this.shake = 2.0;
      }
    } else if (event.type === "undo") {
      this.playerVisual.r = this.engine.player.row;
      this.playerVisual.c = this.engine.player.col;
      this.playerVisual.facing = this.engine.playerFacing;
      this.updateVisualCrates(true);
      this.spawnSparks(
        (this.engine.player.col + 0.5) * this.cellSize,
        (this.engine.player.row + 0.5) * this.cellSize,
        10,
        "#ffaa33"
      );
    } else if (event.type === "board_completed") {
      const cx = this.boardWidthPx / 2;
      const cy = this.boardHeightPx / 2;
      this.surgeWave = {
        cx,
        cy,
        radius: 0,
        maxRadius: Math.hypot(this.boardWidthPx, this.boardHeightPx) * 0.8,
        alpha: 1.0
      };
      if (this.motionEnabled) {
        this.shake = 6.0;
      }
      for (const g of this.engine.currentLevel.goals) {
        this.spawnSparks((g.col + 0.5) * this.cellSize, (g.row + 0.5) * this.cellSize, 18, "#00f0ff");
      }
    }
    this.renderImmediate();
  }

  spawnSparks(x, y, count, color = "#00ffff") {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.04,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  start() {
    if (!this.animId) {
      this.lastTime = performance.now();
      const loop = (now) => {
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;
        this.update(dt);
        this.draw();
        this.animId = requestAnimationFrame(loop);
      };
      this.animId = requestAnimationFrame(loop);
    }
  }

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  update(dt) {
    const targetPlayerR = this.engine.player.row;
    const targetPlayerC = this.engine.player.col;

    if (!this.motionEnabled) {
      this.playerVisual.r = targetPlayerR;
      this.playerVisual.c = targetPlayerC;
      this.playerVisual.blockedAnim = 0;
      this.shake = 0;
    } else {
      // Smooth lerp
      const speed = 16 * dt;
      this.playerVisual.r += (targetPlayerR - this.playerVisual.r) * Math.min(speed, 1);
      this.playerVisual.c += (targetPlayerC - this.playerVisual.c) * Math.min(speed, 1);

      if (this.playerVisual.blockedAnim > 0) {
        this.playerVisual.blockedAnim = Math.max(0, this.playerVisual.blockedAnim - 8 * dt);
      }

      if (this.shake > 0) {
        this.shake = Math.max(0, this.shake - 12 * dt);
      }
    }

    // Update crates
    let idx = 0;
    for (const [, v] of this.cratesVisual) {
      if (!this.motionEnabled) {
        v.r = v.targetR;
        v.c = v.targetC;
      } else {
        const speed = 16 * dt;
        v.r += (v.targetR - v.r) * Math.min(speed, 1);
        v.c += (v.targetC - v.c) * Math.min(speed, 1);
      }
      idx++;
    }

    // Update surge wave
    if (this.surgeWave) {
      this.surgeWave.radius += 350 * dt;
      this.surgeWave.alpha -= 0.6 * dt;
      if (this.surgeWave.alpha <= 0 || this.surgeWave.radius >= this.surgeWave.maxRadius) {
        this.surgeWave = null;
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update ambient motes
    for (const m of this.ambientMotes) {
      m.x += m.vx;
      m.y += m.vy;
      m.pulse += 2 * dt;
      if (m.y < 0) m.y = 1;
      if (m.x < 0) m.x = 1;
      if (m.x > 1) m.x = 0;
    }
  }

  renderImmediate() {
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Clear background: Substation dark slate
    ctx.fillStyle = "#0c1017";
    ctx.fillRect(0, 0, w, h);

    // Apply shake if any
    ctx.save();
    if (this.shake > 0 && this.motionEnabled) {
      const sx = (Math.random() - 0.5) * this.shake * 2;
      const sy = (Math.random() - 0.5) * this.shake * 2;
      ctx.translate(sx, sy);
    }

    ctx.translate(this.offsetX, this.offsetY);

    const cs = this.cellSize;
    const level = this.engine.currentLevel;
    const isComplete = this.engine.phase === "complete";
    const now = performance.now() / 1000;

    // 1. Draw Substation Floor Tiles
    for (let r = 0; r < level.height; r++) {
      for (let c = 0; c < level.width; c++) {
        const x = c * cs;
        const y = r * cs;
        const isW = this.engine.isWall(r, c);

        if (!isW) {
          // Floor tile
          ctx.fillStyle = (r + c) % 2 === 0 ? "#141a24" : "#171e29";
          ctx.fillRect(x, y, cs, cs);

          // Tile borders / panel rivets
          ctx.strokeStyle = "#1e2635";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);

          // Subtle corner rivets
          ctx.fillStyle = "#253042";
          ctx.fillRect(x + 2, y + 2, 2, 2);
          ctx.fillRect(x + cs - 4, y + 2, 2, 2);
          ctx.fillRect(x + 2, y + cs - 4, 2, 2);
          ctx.fillRect(x + cs - 4, y + cs - 4, 2, 2);
        }
      }
    }

    // 2. Draw Floor Circuit Conduits (connecting goals to edges)
    this.drawCircuitConduits(ctx, level, cs, isComplete, now);

    // 3. Draw Sockets (Goals)
    for (const goal of level.goals) {
      const gx = goal.col * cs;
      const gy = goal.row * cs;
      const isOccupied = this.engine.crates.some(c => c.row === goal.row && c.col === goal.col);
      this.drawSocket(ctx, gx, gy, cs, isOccupied, isComplete, now);
    }

    // 4. Draw Walls (Heavy reinforced industrial bulkhead)
    for (const wall of level.walls) {
      const wx = wall.col * cs;
      const wy = wall.row * cs;
      this.drawWall(ctx, wx, wy, cs, wall, level, now);
    }

    // 5. Draw Relay Cores (Crates)
    for (let i = 0; i < this.engine.crates.length; i++) {
      const v = this.cratesVisual.get(i) || { r: this.engine.crates[i].row, c: this.engine.crates[i].col };
      const cx = v.c * cs;
      const cy = v.r * cs;
      const onGoal = level.goals.some(g => g.row === Math.round(v.r) && g.col === Math.round(v.c));
      this.drawRelayCore(ctx, cx, cy, cs, onGoal, isComplete, now);
    }

    // 6. Draw Robot (Player)
    let pr = this.playerVisual.r;
    let pc = this.playerVisual.c;
    if (this.playerVisual.blockedAnim > 0) {
      let bdr = 0, bdc = 0;
      if (this.playerVisual.facing === "up") bdr = -0.15;
      else if (this.playerVisual.facing === "down") bdr = 0.15;
      else if (this.playerVisual.facing === "left") bdc = -0.15;
      else if (this.playerVisual.facing === "right") bdc = 0.15;
      pr += bdr * this.playerVisual.blockedAnim;
      pc += bdc * this.playerVisual.blockedAnim;
    }
    const px = pc * cs;
    const py = pr * cs;
    this.drawRobot(ctx, px, py, cs, this.playerVisual.facing, this.playerVisual.pushing, isComplete, now);

    // 7. Draw Ambient Floating Energy Motes
    this.drawAmbientMotes(ctx, level.width * cs, level.height * cs);

    // 8. Draw Particles & Lightning Arcs
    this.drawParticles(ctx);

    // 9. Draw Power Surge Shockwave
    if (this.surgeWave) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.surgeWave.cx, this.surgeWave.cy, this.surgeWave.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${this.surgeWave.alpha})`;
      ctx.lineWidth = 4;
      ctx.shadowColor = "#00f0ff";
      ctx.shadowBlur = 16;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(this.surgeWave.cx, this.surgeWave.cy, Math.max(0, this.surgeWave.radius - 12), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.surgeWave.alpha * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore(); // board translate & shake
    ctx.restore(); // dpr
  }

  drawCircuitConduits(ctx, level, cs, isComplete, now) {
    ctx.save();
    for (const goal of level.goals) {
      const gx = (goal.col + 0.5) * cs;
      const gy = (goal.row + 0.5) * cs;
      const isOccupied = this.engine.crates.some(c => c.row === goal.row && c.col === goal.col);

      // Bus line extending to top or adjacent
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, 0.5 * cs);
      ctx.strokeStyle = isOccupied || isComplete ? "#00e5ff" : "#3b3020";
      ctx.lineWidth = isOccupied ? 3 : 2;
      if (isOccupied || isComplete) {
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 8;
      }
      ctx.stroke();

      // Energy pulses traveling along the circuit line
      if (isOccupied || isComplete) {
        const pulseProgress = (now * 2 + goal.col * 0.3) % 1;
        const py = gy - (gy - 0.5 * cs) * pulseProgress;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(gx, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawSocket(ctx, x, y, cs, isOccupied, isComplete, now) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const r = cs * 0.38;

    ctx.save();

    // Outer copper ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = isOccupied ? "#0d2b2c" : "#1a1612";
    ctx.fill();
    ctx.strokeStyle = isOccupied ? "#00ffcc" : "#b87333";
    ctx.lineWidth = 2.5;
    if (isOccupied || isComplete) {
      ctx.shadowColor = "#00ffcc";
      ctx.shadowBlur = 10;
    }
    ctx.stroke();

    // Inner contact socket cup
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.65, 0, Math.PI * 2);
    ctx.fillStyle = isOccupied ? "#00474b" : "#2a221b";
    ctx.fill();
    ctx.strokeStyle = isOccupied ? "#00f0ff" : "#8c5828";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4 Corner Copper Latch Pins
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const px = cx + Math.cos(angle) * (r * 0.85);
      const py = cy + Math.sin(angle) * (r * 0.85);
      ctx.fillStyle = isOccupied ? "#38ef7d" : "#e08a3c";
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!isOccupied) {
      // Idle pulsing pilot indicator
      const pulse = 0.5 + 0.5 * Math.sin(now * 3 + x + y);
      ctx.fillStyle = `rgba(255, 170, 50, ${0.4 + pulse * 0.5})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Small central copper dot
      ctx.fillStyle = "#ffcc66";
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Powered active plasma vortex
      const pulse = 0.8 + 0.2 * Math.sin(now * 6);
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 0.7);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.4, "#00ffcc");
      grad.addColorStop(1, "rgba(0, 229, 255, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawWall(ctx, x, y, cs, wall, level, now) {
    ctx.save();

    // Wall 3D block
    const depth = 4;
    ctx.fillStyle = "#0f131a";
    ctx.fillRect(x, y, cs, cs);

    // Front face
    ctx.fillStyle = "#1b2330";
    ctx.fillRect(x + 1, y + 1, cs - 2, cs - depth - 2);

    // Wall top highlight
    ctx.fillStyle = "#2d3748";
    ctx.fillRect(x + 1, y + 1, cs - 2, 3);

    // Industrial diagonal hazard stripes on selected key bulkhead blocks
    if ((wall.row * 7 + wall.col) % 5 === 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 4, cs - 4, cs - depth - 6);
      ctx.clip();
      ctx.strokeStyle = "#384556";
      ctx.lineWidth = 3;
      for (let i = -cs; i < cs * 2; i += 8) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + cs, y + cs);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Status conduit indicator lamp on random wall faces
    if ((wall.row * 13 + wall.col * 17) % 7 === 1) {
      const lx = x + cs / 2;
      const ly = y + (cs - depth) / 2;
      const blink = Math.sin(now * 2 + wall.row + wall.col) > 0.3;
      ctx.fillStyle = blink ? "#00e5ff" : "#1a3b45";
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (blink) {
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 6;
        ctx.stroke();
      }
    }

    // Wall borders
    ctx.strokeStyle = "#080b10";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);

    ctx.restore();
  }

  drawRelayCore(ctx, x, y, cs, onGoal, isComplete, now) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const size = cs * 0.74;
    const hs = size / 2;

    ctx.save();

    // Drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + hs * 0.8, hs * 0.9, hs * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main transformer body (chunky beveled cylinder/cube)
    const bx = cx - hs;
    const by = cy - hs;
    const radius = 6;

    // Outer metal casing
    ctx.beginPath();
    ctx.roundRect(bx, by, size, size, radius);
    ctx.fillStyle = onGoal ? "#152a2b" : "#222a36";
    ctx.fill();
    ctx.strokeStyle = onGoal ? "#00ffcc" : "#4a5568";
    ctx.lineWidth = onGoal ? 2 : 1.5;
    if (onGoal) {
      ctx.shadowColor = "#00ffcc";
      ctx.shadowBlur = 12;
    }
    ctx.stroke();

    // Copper induction coils (horizontal bands)
    ctx.fillStyle = onGoal ? "#ffaa33" : "#9e6129";
    ctx.fillRect(bx + 3, by + hs * 0.3, size - 6, 3);
    ctx.fillRect(bx + 3, by + hs * 1.4, size - 6, 3);

    // Central Glass Plasma Tube
    const tubeW = size * 0.55;
    const tubeH = size * 0.45;
    const tx = cx - tubeW / 2;
    const ty = cy - tubeH / 2;

    ctx.beginPath();
    ctx.roundRect(tx, ty, tubeW, tubeH, 4);
    ctx.fillStyle = onGoal ? "#001a1c" : "#0d131a";
    ctx.fill();
    ctx.strokeStyle = onGoal ? "#00e5ff" : "#2d3748";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Glowing plasma filament core
    if (onGoal || isComplete) {
      const pulse = 0.8 + 0.2 * Math.sin(now * 8 + x);
      const filamentGrad = ctx.createRadialGradient(cx, cy, 1, cx, cy, tubeW * 0.6);
      filamentGrad.addColorStop(0, "#ffffff");
      filamentGrad.addColorStop(0.5, "#00ffcc");
      filamentGrad.addColorStop(1, "rgba(0, 255, 204, 0)");
      ctx.fillStyle = filamentGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, (tubeW * 0.4) * pulse, 0, Math.PI * 2);
      ctx.fill();

      // High voltage core lightning filament line
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tx + 4, cy);
      ctx.lineTo(cx - 3, cy - 2);
      ctx.lineTo(cx + 3, cy + 2);
      ctx.lineTo(tx + tubeW - 4, cy);
      ctx.stroke();
    } else {
      // Unseated faint amber energy pilot filament
      ctx.fillStyle = "#ff9933";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Corner lock bolts
    ctx.fillStyle = onGoal ? "#00ffcc" : "#718096";
    ctx.fillRect(bx + 3, by + 3, 3, 3);
    ctx.fillRect(bx + size - 6, by + 3, 3, 3);
    ctx.fillRect(bx + 3, by + size - 6, 3, 3);
    ctx.fillRect(bx + size - 6, by + size - 6, 3, 3);

    ctx.restore();
  }

  drawRobot(ctx, x, y, cs, facing, pushing, isComplete, now) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const size = cs * 0.76;
    const hs = size / 2;

    ctx.save();

    // Idle subtle vertical bobbing
    const idleBob = this.motionEnabled ? Math.sin(now * 4) * 1.2 : 0;

    // Drop shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + hs * 0.85, hs * 0.85, hs * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(cx, cy + idleBob);

    // Tread feet (left and right or top and bottom depending on facing)
    const treadColor = "#1a202c";
    ctx.fillStyle = treadColor;
    if (facing === "up" || facing === "down") {
      // Treads on sides
      ctx.beginPath();
      ctx.roundRect(-hs * 0.95, -hs * 0.65, hs * 0.35, hs * 1.3, 3);
      ctx.roundRect(hs * 0.6, -hs * 0.65, hs * 0.35, hs * 1.3, 3);
      ctx.fill();
    } else {
      // Treads top/bottom
      ctx.beginPath();
      ctx.roundRect(-hs * 0.65, -hs * 0.95, hs * 1.3, hs * 0.35, 3);
      ctx.roundRect(-hs * 0.65, hs * 0.6, hs * 1.3, hs * 0.35, 3);
      ctx.fill();
    }

    // Main Chassis
    const bodyW = hs * 1.4;
    const bodyH = hs * 1.4;
    ctx.beginPath();
    ctx.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, 7);
    ctx.fillStyle = "#2c3e50";
    ctx.fill();
    ctx.strokeStyle = pushing ? "#f39c12" : isComplete ? "#2ecc71" : "#3498db";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Chassis top dome
    ctx.beginPath();
    ctx.arc(0, 0, hs * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#34495e";
    ctx.fill();

    // Antenna on head
    ctx.strokeStyle = "#7f8c8d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -bodyH / 2);
    ctx.lineTo(0, -bodyH / 2 - 5);
    ctx.stroke();

    // Antenna tip bulb
    const antennaGlow = isComplete ? "#2ecc71" : pushing ? "#f39c12" : "#00ffff";
    ctx.fillStyle = antennaGlow;
    ctx.beginPath();
    ctx.arc(0, -bodyH / 2 - 6, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = antennaGlow;
    ctx.shadowBlur = 6;
    ctx.stroke();

    // Visor & Eyes based on facing direction
    let eyeOffsetX = 0;
    let eyeOffsetY = 0;
    if (facing === "up") eyeOffsetY = -hs * 0.35;
    else if (facing === "down") eyeOffsetY = hs * 0.35;
    else if (facing === "left") eyeOffsetX = -hs * 0.35;
    else if (facing === "right") eyeOffsetX = hs * 0.35;

    // Visor dark strip
    ctx.save();
    ctx.fillStyle = "#11171f";
    if (facing === "up" || facing === "down") {
      ctx.beginPath();
      ctx.roundRect(-hs * 0.5, eyeOffsetY - 4, hs * 1.0, 8, 3);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(eyeOffsetX - 4, -hs * 0.5, 8, hs * 1.0, 3);
      ctx.fill();
    }

    // Glowing Eyes / Headlights
    const eyeColor = isComplete ? "#00ff88" : pushing ? "#ffaa00" : "#00f0ff";
    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = 8;

    if (facing === "down") {
      ctx.beginPath();
      ctx.arc(-hs * 0.25, eyeOffsetY, 2.5, 0, Math.PI * 2);
      ctx.arc(hs * 0.25, eyeOffsetY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (facing === "up") {
      ctx.beginPath();
      ctx.arc(-hs * 0.25, eyeOffsetY, 2, 0, Math.PI * 2);
      ctx.arc(hs * 0.25, eyeOffsetY, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (facing === "left") {
      ctx.beginPath();
      ctx.arc(eyeOffsetX, -hs * 0.2, 2.5, 0, Math.PI * 2);
      ctx.arc(eyeOffsetX, hs * 0.2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (facing === "right") {
      ctx.beginPath();
      ctx.arc(eyeOffsetX, -hs * 0.2, 2.5, 0, Math.PI * 2);
      ctx.arc(eyeOffsetX, hs * 0.2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Push boost thruster flare behind robot when pushing
    if (pushing) {
      let bx = 0, by = 0;
      if (facing === "up") by = hs * 0.8;
      else if (facing === "down") by = -hs * 0.8;
      else if (facing === "left") bx = hs * 0.8;
      else if (facing === "right") bx = -hs * 0.8;

      ctx.fillStyle = "#ff6600";
      ctx.shadowColor = "#ffaa00";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(bx, by, 4 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    ctx.restore();
  }

  drawAmbientMotes(ctx, bw, bh) {
    ctx.save();
    for (const m of this.ambientMotes) {
      const px = m.x * bw;
      const py = m.y * bh;
      const alpha = m.alpha * (0.6 + 0.4 * Math.sin(m.pulse));
      ctx.fillStyle = `rgba(0, 229, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
