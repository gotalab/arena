/**
 * LUMEN YARD - Canvas Visual & Particle Renderer
 * Renders the night-time electrical yard, maintenance automaton, relay cores, and grid surges.
 */

export class Renderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;

    this.reducedMotion = false;
    this.tileSize = 64;
    this.offsetX = 0;
    this.offsetY = 0;

    // Visual animated positions (interpolated)
    this.animPlayer = { x: 0, y: 0, facing: 'down', pushAnim: 0, idleTime: 0 };
    this.animCrates = new Map(); // key: crate index -> { x, y, energized }

    // Particles & FX
    this.particles = [];
    this.conduitSurges = []; // line pulses on victory
    this.shakeAmount = 0;
    this.lastTime = performance.now();
    this.isVictorySurge = false;
    this.victoryTime = 0;

    this.hoverCell = null; // { row, col }

    this._syncVisualPositions(true);
    this._startLoop();
  }

  setReducedMotion(val) {
    this.reducedMotion = !!val;
  }

  setHoverCell(cell) {
    this.hoverCell = cell;
  }

  triggerShake(intensity = 4) {
    if (this.reducedMotion) return;
    this.shakeAmount = Math.max(this.shakeAmount, intensity);
  }

  addSparks(x, y, count = 12, color = '#38bdf8') {
    if (this.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.7,
        color,
        size: 2 + Math.random() * 3
      });
    }
  }

  triggerVictorySurge() {
    this.isVictorySurge = true;
    this.victoryTime = 0;
    this.triggerShake(6);

    // Create electrical conduit lines to the edges
    const center = {
      x: this.offsetX + (this.engine.width * this.tileSize) / 2,
      y: this.offsetY + (this.engine.height * this.tileSize) / 2
    };

    for (let i = 0; i < 30; i++) {
      this.addSparks(
        this.offsetX + Math.random() * (this.engine.width * this.tileSize),
        this.offsetY + Math.random() * (this.engine.height * this.tileSize),
        4,
        Math.random() > 0.4 ? '#38bdf8' : '#f59e0b'
      );
    }
  }

  _syncVisualPositions(instant = false) {
    if (instant || this.reducedMotion) {
      this.animPlayer.x = this.engine.player.col;
      this.animPlayer.y = this.engine.player.row;
      this.animPlayer.facing = this.engine.playerFacing || 'down';

      this.animCrates.clear();
      this.engine.crates.forEach((c, idx) => {
        this.animCrates.set(idx, {
          x: c.col,
          y: c.row,
          targetX: c.col,
          targetY: c.row,
          energized: this.engine.isGoal(c.row, c.col)
        });
      });
    } else {
      this.animPlayer.facing = this.engine.playerFacing || 'down';
      // Sync crates target
      this.engine.crates.forEach((c, idx) => {
        let existing = this.animCrates.get(idx);
        if (!existing) {
          this.animCrates.set(idx, {
            x: c.col,
            y: c.row,
            targetX: c.col,
            targetY: c.row,
            energized: this.engine.isGoal(c.row, c.col)
          });
        } else {
          existing.targetX = c.col;
          existing.targetY = c.row;
          existing.energized = this.engine.isGoal(c.row, c.col);
        }
      });
    }
  }

  onGameEvent(event) {
    if (event.type === 'step') {
      if (this.reducedMotion) {
        this._syncVisualPositions(true);
      }
    } else if (event.type === 'push') {
      this.animPlayer.pushAnim = 0.2;
      this.triggerShake(2);
      if (event.isGoal) {
        const px = this.offsetX + (event.crateTo.col + 0.5) * this.tileSize;
        const py = this.offsetY + (event.crateTo.row + 0.5) * this.tileSize;
        this.addSparks(px, py, 16, '#38bdf8');
      }
      if (this.reducedMotion) {
        this._syncVisualPositions(true);
      }
    } else if (event.type === 'blocked') {
      this.triggerShake(3);
    } else if (event.type === 'undo') {
      this._syncVisualPositions(true);
      this.isVictorySurge = false;
    } else if (event.type === 'restart' || event.type === 'select_level' || event.type === 'reset') {
      this._syncVisualPositions(true);
      this.isVictorySurge = false;
    } else if (event.type === 'complete') {
      this.triggerVictorySurge();
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
    }

    // Calculate tile size and centering
    const boardW = this.engine.width;
    const boardH = this.engine.height;

    // Available space with margins
    const margin = 16;
    const availW = Math.max(100, width - margin * 2);
    const availH = Math.max(100, height - margin * 2);

    const fitTileW = Math.floor(availW / boardW);
    const fitTileH = Math.floor(availH / boardH);
    this.tileSize = Math.max(28, Math.min(76, Math.min(fitTileW, fitTileH)));

    this.offsetX = Math.floor((width - boardW * this.tileSize) / 2);
    this.offsetY = Math.floor((height - boardH * this.tileSize) / 2);

    this.renderImmediate();
  }

  screenToCell(screenX, screenY) {
    const parent = this.canvas.parentElement;
    if (!parent) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;

    const col = Math.floor((x - this.offsetX) / this.tileSize);
    const row = Math.floor((y - this.offsetY) / this.tileSize);

    if (row >= 0 && row < this.engine.height && col >= 0 && col < this.engine.width) {
      return { row, col };
    }
    return null;
  }

  _startLoop() {
    const frame = (time) => {
      const dt = Math.min(0.1, (time - this.lastTime) / 1000);
      this.lastTime = time;

      this._update(dt);
      this._draw();

      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  _update(dt) {
    this.animPlayer.idleTime += dt;
    if (this.animPlayer.pushAnim > 0) {
      this.animPlayer.pushAnim = Math.max(0, this.animPlayer.pushAnim - dt);
    }

    if (this.shakeAmount > 0) {
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 15);
    }

    if (this.isVictorySurge) {
      this.victoryTime += dt;
      if (Math.random() < 0.25) {
        this.addSparks(
          this.offsetX + Math.random() * (this.engine.width * this.tileSize),
          this.offsetY + Math.random() * (this.engine.height * this.tileSize),
          2,
          '#38bdf8'
        );
      }
    }

    // Interpolate player position
    if (!this.reducedMotion) {
      const lerpSpeed = 22 * dt;
      this.animPlayer.x += (this.engine.player.col - this.animPlayer.x) * Math.min(1, lerpSpeed);
      this.animPlayer.y += (this.engine.player.row - this.animPlayer.y) * Math.min(1, lerpSpeed);

      // Interpolate crates
      this.engine.crates.forEach((c, idx) => {
        let ac = this.animCrates.get(idx);
        if (ac) {
          ac.x += (c.col - ac.x) * Math.min(1, lerpSpeed);
          ac.y += (c.row - ac.y) * Math.min(1, lerpSpeed);
          ac.energized = this.engine.isGoal(c.row, c.col);
        }
      });
    } else {
      this.animPlayer.x = this.engine.player.col;
      this.animPlayer.y = this.engine.player.row;
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  renderImmediate() {
    this._syncVisualPositions(true);
    this._draw();
  }

  _draw() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Apply screen shake
    if (this.shakeAmount > 0 && !this.reducedMotion) {
      const sx = (Math.random() - 0.5) * this.shakeAmount * 2;
      const sy = (Math.random() - 0.5) * this.shakeAmount * 2;
      ctx.translate(sx, sy);
    }

    const tSize = this.tileSize;
    const offX = this.offsetX;
    const offY = this.offsetY;

    // 1. Draw Ambient Background & Grid Conduits
    this._drawYardFloor(ctx, offX, offY, tSize);

    // 2. Draw Sockets (Goals)
    this._drawSockets(ctx, offX, offY, tSize);

    // 3. Draw Reachable / Hover Tile Indicators
    this._drawInteractionAids(ctx, offX, offY, tSize);

    // 4. Draw Walls
    this._drawWalls(ctx, offX, offY, tSize);

    // 5. Draw Relay Cores (Crates)
    this._drawRelayCores(ctx, offX, offY, tSize);

    // 6. Draw Robot (Player)
    this._drawRobot(ctx, offX, offY, tSize);

    // 7. Draw Particles & Victory Surge
    this._drawParticlesAndEffects(ctx, offX, offY, tSize);

    ctx.restore();
  }

  _drawYardFloor(ctx, offX, offY, tSize) {
    const bw = this.engine.width;
    const bh = this.engine.height;

    // Yard board boundary backdrop
    const pad = 12;
    ctx.fillStyle = '#080c14';
    ctx.beginPath();
    ctx.roundRect(offX - pad, offY - pad, bw * tSize + pad * 2, bh * tSize + pad * 2, 12);
    ctx.fill();

    // Metallic outer rim
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Draw individual floor tiles
    for (let r = 0; r < bh; r++) {
      for (let c = 0; c < bw; c++) {
        const px = offX + c * tSize;
        const py = offY + r * tSize;

        if (!this.engine.isWall(r, c)) {
          // Dark steel plate
          ctx.fillStyle = (r + c) % 2 === 0 ? '#0f172a' : '#111c33';
          ctx.fillRect(px, py, tSize, tSize);

          // Subtle diamond pattern or seam
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, tSize - 1, tSize - 1);

          // Subtle corner rivets
          ctx.fillStyle = '#334155';
          const dot = 1.5;
          ctx.fillRect(px + 3, py + 3, dot, dot);
          ctx.fillRect(px + tSize - 4, py + 3, dot, dot);
          ctx.fillRect(px + 3, py + tSize - 4, dot, dot);
          ctx.fillRect(px + tSize - 4, py + tSize - 4, dot, dot);
        }
      }
    }

    // Electrical conduits on floor connecting to sockets
    this.engine.goals.forEach(goal => {
      const gx = offX + (goal.col + 0.5) * tSize;
      const gy = offY + (goal.row + 0.5) * tSize;

      // Conduit to bottom or side
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, offY + bh * tSize);
      ctx.lineWidth = 3;
      const isComplete = this.engine.phase === 'complete';
      ctx.strokeStyle = isComplete ? '#38bdf8' : '#1e3a5f';
      ctx.stroke();

      if (isComplete) {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });
  }

  _drawSockets(ctx, offX, offY, tSize) {
    this.engine.goals.forEach(goal => {
      const px = offX + goal.col * tSize;
      const py = offY + goal.row * tSize;
      const cx = px + tSize / 2;
      const cy = py + tSize / 2;
      const r = tSize * 0.38;

      const isOccupied = this.engine.crates.some(c => c.row === goal.row && c.col === goal.col);

      // Base copper ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = isOccupied ? '#1e293b' : '#172554';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = isOccupied ? '#38bdf8' : '#b45309';
      ctx.stroke();

      // Copper terminal teeth (4 contacts)
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2 + Math.PI / 4;
        const tx = cx + Math.cos(ang) * (r + 1);
        const ty = cy + Math.sin(ang) * (r + 1);
        ctx.fillStyle = isOccupied ? '#38bdf8' : '#d97706';
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Center glow / icon
      if (isOccupied) {
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Hollow copper socket indicator
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();

        // Pulsing spark ring
        const pulse = 0.5 + 0.5 * Math.sin(this.animPlayer.idleTime * 4);
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.3 + pulse * 0.4})`;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  _drawInteractionAids(ctx, offX, offY, tSize) {
    if (this.engine.phase === 'complete') return;

    // Draw reachability hints on 4 adjacent legal cells
    const dirs = [
      { dir: 'up', dr: -1, dc: 0 },
      { dir: 'down', dr: 1, dc: 0 },
      { dir: 'left', dr: 0, dc: -1 },
      { dir: 'right', dr: 0, dc: 1 }
    ];

    dirs.forEach(({ dir, dr, dc }) => {
      if (this.engine.isLegalMove(dir)) {
        const tr = this.engine.player.row + dr;
        const tc = this.engine.player.col + dc;
        const px = offX + tc * tSize;
        const py = offY + tr * tSize;

        const isHover = this.hoverCell && this.hoverCell.row === tr && this.hoverCell.col === tc;

        ctx.save();
        ctx.strokeStyle = isHover ? 'rgba(56, 189, 248, 0.75)' : 'rgba(56, 189, 248, 0.2)';
        ctx.lineWidth = isHover ? 2 : 1;
        ctx.strokeRect(px + 4, py + 4, tSize - 8, tSize - 8);

        if (isHover) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
          ctx.fillRect(px + 4, py + 4, tSize - 8, tSize - 8);
        }
        ctx.restore();
      }
    });
  }

  _drawWalls(ctx, offX, offY, tSize) {
    this.engine.walls.forEach(wall => {
      const px = offX + wall.col * tSize;
      const py = offY + wall.row * tSize;

      // Heavy substation blast wall block
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(px, py, tSize, tSize);

      // Top bevel highlight
      ctx.fillStyle = '#334155';
      ctx.fillRect(px, py, tSize, 4);

      // Side shadow
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(px, py + tSize - 4, tSize, 4);
      ctx.fillRect(px + tSize - 4, py, 4, tSize);

      // Inner industrial texture: hazard stripe or reinforcement cross
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + 6, py + 6, tSize - 12, tSize - 12);

      // Bolt fasteners
      ctx.fillStyle = '#64748b';
      ctx.fillRect(px + 8, py + 8, 2, 2);
      ctx.fillRect(px + tSize - 10, py + 8, 2, 2);
      ctx.fillRect(px + 8, py + tSize - 10, 2, 2);
      ctx.fillRect(px + tSize - 10, py + tSize - 10, 2, 2);
    });
  }

  _drawRelayCores(ctx, offX, offY, tSize) {
    this.engine.crates.forEach((crate, idx) => {
      const anim = this.animCrates.get(idx) || { x: crate.col, y: crate.row, energized: false };
      const px = offX + anim.x * tSize;
      const py = offY + anim.y * tSize;

      const isGoal = this.engine.isGoal(crate.row, crate.col);
      const pad = 6;
      const coreW = tSize - pad * 2;
      const coreH = tSize - pad * 2;
      const cx = px + pad + coreW / 2;
      const cy = py + pad + coreH / 2;

      ctx.save();

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.roundRect(px + pad + 2, py + pad + 4, coreW, coreH, 8);
      ctx.fill();

      // Reactor casing
      ctx.fillStyle = isGoal ? '#0f172a' : '#1e1b4b';
      ctx.beginPath();
      ctx.roundRect(px + pad, py + pad, coreW, coreH, 8);
      ctx.fill();

      // Copper / Brass frame
      ctx.lineWidth = isGoal ? 3 : 2;
      ctx.strokeStyle = isGoal ? '#38bdf8' : '#d97706';
      ctx.stroke();

      if (isGoal) {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Cooling fins on sides
      ctx.fillStyle = isGoal ? '#38bdf8' : '#b45309';
      for (let i = 0; i < 3; i++) {
        const fy = py + pad + 6 + i * 8;
        ctx.fillRect(px + pad - 2, fy, 3, 4);
        ctx.fillRect(px + pad + coreW - 1, fy, 3, 4);
      }

      // Central glowing glass vacuum cylinder
      const coreR = coreW * 0.28;
      const coreGlow = isGoal ? '#38bdf8' : '#f59e0b';
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, coreR);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, coreGlow);
      grad.addColorStop(1, isGoal ? '#0369a1' : '#b45309');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Energy core symbol
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(coreW * 0.32)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡', cx, cy + 1);

      ctx.restore();
    });
  }

  _drawRobot(ctx, offX, offY, tSize) {
    const rx = this.animPlayer.x;
    const ry = this.animPlayer.y;
    const px = offX + rx * tSize;
    const py = offY + ry * tSize;

    const pad = 6;
    const robotW = tSize - pad * 2;
    const robotH = tSize - pad * 2;
    const cx = px + pad + robotW / 2;
    const cy = py + pad + robotH / 2;

    // Small idle breathing offset
    const idleBob = this.reducedMotion ? 0 : Math.sin(this.animPlayer.idleTime * 4) * 1.5;

    ctx.save();
    ctx.translate(cx, cy + idleBob);

    // Drop shadow under robot
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, robotH * 0.38, robotW * 0.42, robotH * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Robot Treads / Base
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-robotW * 0.42, -robotH * 0.38, robotW * 0.84, robotH * 0.76, 10);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // Chassis body
    const isComplete = this.engine.phase === 'complete';
    ctx.fillStyle = isComplete ? '#047857' : '#1e293b';
    ctx.beginPath();
    ctx.roundRect(-robotW * 0.35, -robotH * 0.32, robotW * 0.7, robotH * 0.64, 8);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isComplete ? '#10b981' : '#0284c7';
    ctx.stroke();

    // Antenna & glowing tip
    const antX = 0;
    const antY = -robotH * 0.38;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(antX, antY);
    ctx.lineTo(antX, antY - 7);
    ctx.stroke();

    // Antenna LED
    ctx.fillStyle = isComplete ? '#10b981' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(antX, antY - 8, 3, 0, Math.PI * 2);
    ctx.fill();

    // Optical Eye & Headlight based on facing direction
    let eyeOffsetX = 0;
    let eyeOffsetY = 0;
    const facing = this.animPlayer.facing;
    if (facing === 'up') eyeOffsetY = -robotH * 0.15;
    if (facing === 'down') eyeOffsetY = robotH * 0.08;
    if (facing === 'left') eyeOffsetX = -robotW * 0.15;
    if (facing === 'right') eyeOffsetX = robotW * 0.15;

    // Glowing Optical Visor
    const eyeR = robotW * 0.2;
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(eyeOffsetX, eyeOffsetY, eyeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isComplete ? '#6ee7b7' : '#e0f2fe';
    ctx.beginPath();
    ctx.arc(eyeOffsetX + eyeOffsetX * 0.3, eyeOffsetY + eyeOffsetY * 0.3, eyeR * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Eye glow halo
    if (!this.reducedMotion) {
      ctx.shadowColor = isComplete ? '#10b981' : '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.fillStyle = isComplete ? '#34d399' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(eyeOffsetX, eyeOffsetY, eyeR * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  _drawParticlesAndEffects(ctx, offX, offY, tSize) {
    // Draw active particles
    this.particles.forEach(p => {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Board clear celebratory border pulse
    if (this.isVictorySurge) {
      const bw = this.engine.width;
      const bh = this.engine.height;
      const surgePulse = 0.5 + 0.5 * Math.sin(this.victoryTime * 10);

      ctx.strokeStyle = `rgba(56, 189, 248, ${0.4 + surgePulse * 0.5})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(offX - 4, offY - 4, bw * tSize + 8, bh * tSize + 8, 14);
      ctx.stroke();
    }
  }
}
