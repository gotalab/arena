// Lumen Yard - Visual Canvas Renderer
// A finished electrical world with atmospheric lighting, characterful robot, and dynamic current.

import { storage } from './storage.js';

export class LumenRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    this.state = null;
    this.cellSize = 48;
    this.offsetX = 0;
    this.offsetY = 0;
    
    // Animation states
    this.particles = [];
    this.refusalAnim = null; // { dir, r, c, startTime }
    this.pushAnim = null;    // { dir, r, c, isGoal, startTime }
    this.undoAnim = null;    // { startTime }
    this.surgeAnim = null;   // { startTime }
    
    this.time = 0;
    this.lastFrameTime = performance.now();
    this.animating = true;
    
    // Pre-calculated deterministic conduit paths
    this.conduitGrid = [];
    
    this.resize();
    this.startLoop();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    
    // Width and height in CSS pixels
    const w = Math.max(300, Math.floor(rect.width));
    const h = Math.max(300, Math.floor(rect.height));

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.cssWidth = w;
    this.cssHeight = h;

    this.updateLayout();
  }

  updateLayout() {
    if (!this.state) return;
    const cols = this.state.width;
    const rows = this.state.height;

    // Available space padding
    const padX = 16;
    const padY = 16;
    const availW = this.cssWidth - padX * 2;
    const availH = this.cssHeight - padY * 2;

    const maxCellW = Math.floor(availW / cols);
    const maxCellH = Math.floor(availH / rows);
    this.cellSize = Math.max(28, Math.min(maxCellW, maxCellH, 68));

    const boardW = this.cellSize * cols;
    const boardH = this.cellSize * rows;

    this.offsetX = Math.floor((this.cssWidth - boardW) / 2);
    this.offsetY = Math.floor((this.cssHeight - boardH) / 2);
  }

  setState(state) {
    const prevLevel = this.state ? this.state.levelId : null;
    const prevPhase = this.state ? this.state.phase : null;

    this.state = state;
    this.updateLayout();

    // Trigger surge animation if just transitioned to complete
    if (prevPhase === 'playing' && state.phase === 'complete') {
      this.triggerSurge();
    }

    // Reset particles on level change
    if (prevLevel !== state.levelId) {
      this.particles = [];
      this.surgeAnim = null;
    }
  }

  triggerRefusal(dir, r, c) {
    this.refusalAnim = { dir, r, c, startTime: performance.now() };
    
    // Add sparks
    const cs = this.cellSize;
    const cx = this.offsetX + c * cs + cs / 2;
    const cy = this.offsetY + r * cs + cs / 2;
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x: cx,
        y: cy,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        color: '#ff6b6b',
        alpha: 1,
        life: 0.35,
        maxLife: 0.35,
        size: 2.5
      });
    }
  }

  triggerPush(dir, r, c, isGoal) {
    this.pushAnim = { dir, r, c, isGoal, startTime: performance.now() };
    const cs = this.cellSize;
    const cx = this.offsetX + c * cs + cs / 2;
    const cy = this.offsetY + r * cs + cs / 2;
    
    const count = isGoal ? 20 : 8;
    const color = isGoal ? '#00f2fe' : '#ffd166';
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: cx,
        y: cy,
        vx: (Math.random() - 0.5) * (isGoal ? 120 : 60),
        vy: (Math.random() - 0.5) * (isGoal ? 120 : 60),
        color: color,
        alpha: 1,
        life: 0.4,
        maxLife: 0.4,
        size: isGoal ? 3 : 2
      });
    }
  }

  triggerSurge() {
    this.surgeAnim = { startTime: performance.now() };
    if (!this.state) return;
    
    // Create surge particles from every socket
    const cs = this.cellSize;
    for (const g of this.state.goals) {
      const gx = this.offsetX + g.col * cs + cs / 2;
      const gy = this.offsetY + g.row * cs + cs / 2;
      for (let i = 0; i < 25; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 140;
        this.particles.push({
          x: gx,
          y: gy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: Math.random() > 0.3 ? '#38d9a9' : '#4dabf7',
          alpha: 1,
          life: 0.8 + Math.random() * 0.4,
          maxLife: 1.2,
          size: 2 + Math.random() * 2.5
        });
      }
    }
  }

  triggerUndo() {
    this.undoAnim = { startTime: performance.now() };
    if (!this.state) return;
    const cs = this.cellSize;
    const px = this.offsetX + this.state.player.col * cs + cs / 2;
    const py = this.offsetY + this.state.player.row * cs + cs / 2;
    for (let i = 0; i < 15; i++) {
      this.particles.push({
        x: px + (Math.random() - 0.5) * 40,
        y: py + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 40,
        color: '#b197fc',
        alpha: 1,
        life: 0.4,
        maxLife: 0.4,
        size: 2.5
      });
    }
  }

  startLoop() {
    const loop = (now) => {
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;
      this.time += dt;

      this.updateParticles(dt);
      this.render();

      if (this.animating) {
        requestAnimationFrame(loop);
      }
    };
    requestAnimationFrame(loop);
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  screenToGrid(screenX, screenY) {
    if (!this.state) return null;
    const c = Math.floor((screenX - this.offsetX) / this.cellSize);
    const r = Math.floor((screenY - this.offsetY) / this.cellSize);
    if (r >= 0 && r < this.state.height && c >= 0 && c < this.state.width) {
      return { row: r, col: c };
    }
    return null;
  }

  render() {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const motion = storage.getMotionEnabled();

    // 1. Background: Deep industrial night sky with subtle generator aura
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h));
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.6, '#090d16');
    bgGrad.addColorStop(1, '#05070b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    if (!this.state) return;

    const cs = this.cellSize;
    const ox = this.offsetX;
    const oy = this.offsetY;
    const isComplete = this.state.phase === 'complete';

    // 2. Ambient Power Yard Lighting / Windows behind Yard
    this.drawAtmosphere(ctx, ox, oy, cs, isComplete, motion);

    // 3. Yard Frame / Perimeter Border
    this.drawYardPerimeter(ctx, ox, oy, cs, isComplete);

    // 4. Floor Plates & Ground Mesh
    this.drawFloor(ctx, ox, oy, cs);

    // 5. Copper Conduits & Current Pulses
    this.drawConduits(ctx, ox, oy, cs, isComplete, motion);

    // 6. Sockets (Copper Receptacles)
    this.drawSockets(ctx, ox, oy, cs, isComplete, motion);

    // 7. Walls (Substation Barriers, Insulators, Pilot Lights)
    this.drawWalls(ctx, ox, oy, cs, isComplete, motion);

    // 8. Relay Cores (Heavy Glass/Ceramic Relays)
    this.drawRelayCores(ctx, ox, oy, cs, motion);

    // 9. Maintenance Robot (Unit-7)
    this.drawRobot(ctx, ox, oy, cs, motion);

    // 10. Foreground Particles & Arc Lighting
    this.drawParticles(ctx);

    // 11. Full Grid Restoration Wave (Celebration Surge)
    if (isComplete) {
      this.drawSurgeWave(ctx, ox, oy, cs, motion);
    }
  }

  drawAtmosphere(ctx, ox, oy, cs, isComplete, motion) {
    const cols = this.state.width;
    const rows = this.state.height;
    const bw = cols * cs;
    const bh = rows * cs;

    // Distant substation lights / sleeping industrial windows above the yard
    const windowY = oy - 22;
    if (windowY > 10) {
      const winCount = 5;
      const spacing = bw / (winCount + 1);
      for (let i = 1; i <= winCount; i++) {
        const wx = ox + i * spacing - 14;
        const glow = isComplete ? 0.85 : 0.18;
        ctx.fillStyle = isComplete
          ? 'rgba(255, 190, 80, ' + glow + ')'
          : 'rgba(70, 95, 130, ' + glow + ')';
        ctx.fillRect(wx, windowY, 28, 12);
        
        // Window mullion
        ctx.strokeStyle = '#0a0e17';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(wx, windowY, 28, 12);
        ctx.beginPath();
        ctx.moveTo(wx + 14, windowY);
        ctx.lineTo(wx + 14, windowY + 12);
        ctx.stroke();
      }
    }

    // Faint ground glow when completed
    if (isComplete) {
      const glowGrad = ctx.createRadialGradient(ox + bw / 2, oy + bh / 2, 20, ox + bw / 2, oy + bh / 2, bw * 0.7);
      glowGrad.addColorStop(0, 'rgba(56, 217, 169, 0.12)');
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(ox - 30, oy - 30, bw + 60, bh + 60);
    }
  }

  drawYardPerimeter(ctx, ox, oy, cs, isComplete) {
    const bw = this.state.width * cs;
    const bh = this.state.height * cs;

    // Heavy concrete foundation shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(ox + 4, oy + 4, bw, bh);

    // Yard boundary casing
    ctx.strokeStyle = isComplete ? '#2a4365' : '#1e293b';
    ctx.lineWidth = 4;
    ctx.strokeRect(ox - 2, oy - 2, bw + 4, bh + 4);
  }

  drawFloor(ctx, ox, oy, cs) {
    const cols = this.state.width;
    const rows = this.state.height;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Skip wall positions for floor base
        if (this.state.walls.some(w => w.row === r && w.col === c)) continue;

        const x = ox + c * cs;
        const y = oy + r * cs;

        // Dark industrial steel tile
        ctx.fillStyle = ((r + c) % 2 === 0) ? '#111927' : '#141d2e';
        ctx.fillRect(x, y, cs, cs);

        // Tile inner border & rivet accents
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);

        // Subtle corner bolts
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x + 2, y + 2, 2, 2);
        ctx.fillRect(x + cs - 4, y + 2, 2, 2);
        ctx.fillRect(x + 2, y + cs - 4, 2, 2);
        ctx.fillRect(x + cs - 4, y + cs - 4, 2, 2);
      }
    }
  }

  drawConduits(ctx, ox, oy, cs, isComplete, motion) {
    const goals = this.state.goals;
    if (goals.length === 0) return;

    ctx.save();
    // Trace busbar lines along the floor connecting sockets to the yard perimeter
    for (const g of goals) {
      const gx = ox + g.col * cs + cs / 2;
      const gy = oy + g.row * cs + cs / 2;
      const edgeY = oy;

      // Conduit line
      const isPowered = this.state.crates.some(c => c.row === g.row && c.col === g.col);
      
      // Conduit metallic groove
      ctx.strokeStyle = '#0a0f18';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(gx, edgeY);
      ctx.lineTo(gx, gy);
      ctx.stroke();

      // Copper trace core
      ctx.strokeStyle = isPowered
        ? (isComplete ? '#38d9a9' : '#00f2fe')
        : '#8c532b';
      ctx.lineWidth = isPowered ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(gx, edgeY);
      ctx.lineTo(gx, gy);
      ctx.stroke();

      // Faint traveling electrical pulse along conduit
      if (motion) {
        const pulseProgress = (this.time * (isPowered ? 1.5 : 0.6) + g.col * 0.2) % 1;
        const py = edgeY + (gy - edgeY) * pulseProgress;

        ctx.fillStyle = isPowered ? '#ffffff' : '#ffd166';
        ctx.beginPath();
        ctx.arc(gx, py, isPowered ? 2.5 : 1.5, 0, Math.PI * 2);
        ctx.fill();

        if (isPowered) {
          ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(gx, py - 4);
          ctx.lineTo(gx, py + 4);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  drawSockets(ctx, ox, oy, cs, isComplete, motion) {
    for (const g of this.state.goals) {
      const cx = ox + g.col * cs + cs / 2;
      const cy = oy + g.row * cs + cs / 2;
      const isOccupied = this.state.crates.some(c => c.row === g.row && c.col === g.col);

      const rOuter = cs * 0.38;
      const rInner = cs * 0.22;

      // 1. Recessed cavity shadow
      ctx.fillStyle = '#060a12';
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
      ctx.fill();

      // 2. Copper contact ring
      ctx.strokeStyle = isOccupied
        ? (isComplete ? '#38d9a9' : '#00f2fe')
        : '#b87333';
      ctx.lineWidth = isOccupied ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter - 1.5, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Brass leaf contact pins (at 4 quadrants)
      const pinDist = rOuter - 3;
      ctx.fillStyle = isOccupied ? '#ffffff' : '#d4af37';
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
        const px = cx + Math.cos(angle) * pinDist;
        const py = cy + Math.sin(angle) * pinDist;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Center indicator
      if (isOccupied) {
        // High voltage glow
        const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, rOuter);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.4, isComplete ? '#38d9a9' : '#00f2fe');
        glow.addColorStop(1, 'rgba(0, 242, 254, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Empty socket: Standby pulsing dot
        const pulse = motion ? Math.sin(this.time * 2 + g.col) * 0.3 + 0.7 : 0.8;
        ctx.fillStyle = `rgba(255, 170, 51, ${pulse * 0.6})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Distinct mechanical cross mark inside empty socket (accessible, not color alone!)
        ctx.strokeStyle = 'rgba(184, 115, 51, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx, cy + 5);
        ctx.stroke();
      }
    }
  }

  drawWalls(ctx, ox, oy, cs, isComplete, motion) {
    for (const w of this.state.walls) {
      const x = ox + w.col * cs;
      const y = oy + w.row * cs;

      // Heavy industrial wall block with 2.5D bevel
      // Top face
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x, y, cs, cs - 4);

      // Front depth face
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x, y + cs - 4, cs, 4);

      // Highlight bevel edge
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 5);

      // Conduit or warning stripe accent
      if ((w.row + w.col) % 3 === 0) {
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(x + cs * 0.2, y + cs * 0.25, cs * 0.6, cs * 0.35);

        // Warning pilot light
        const lightX = x + cs / 2;
        const lightY = y + cs * 0.42;
        const lightOn = isComplete;
        const pulse = motion ? (Math.sin(this.time * 3 + w.col) > 0) : true;

        ctx.fillStyle = lightOn
          ? (pulse ? '#38d9a9' : '#20c997')
          : (pulse ? '#e03131' : '#781515');
        ctx.beginPath();
        ctx.arc(lightX, lightY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Ceramic insulator coils
        ctx.fillStyle = '#273449';
        ctx.fillRect(x + cs * 0.35, y + cs * 0.2, cs * 0.3, cs * 0.45);
        ctx.fillStyle = '#475569';
        ctx.fillRect(x + cs * 0.25, y + cs * 0.3, cs * 0.5, 2);
        ctx.fillRect(x + cs * 0.25, y + cs * 0.45, cs * 0.5, 2);
      }
    }
  }

  drawRelayCores(ctx, ox, oy, cs, motion) {
    for (const c of this.state.crates) {
      const cx = ox + c.col * cs + cs / 2;
      const cy = oy + c.row * cs + cs / 2;
      const isSocketed = this.state.goals.some(g => g.row === c.row && g.col === c.col);

      const size = cs * 0.74;
      const half = size / 2;
      const left = cx - half;
      const top = cy - half;

      // 1. Heavy drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + half + 2, half * 0.9, half * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Heavy steel & copper chassis
      ctx.fillStyle = isSocketed ? '#1c3d5a' : '#283347';
      this.roundRect(ctx, left, top, size, size - 3, 5);
      ctx.fill();

      // Front depth extrusion
      ctx.fillStyle = isSocketed ? '#0f2438' : '#141a24';
      this.roundRect(ctx, left, top + size - 3, size, 3, 2);
      ctx.fill();

      // Copper corner brackets
      ctx.strokeStyle = isSocketed ? '#38d9a9' : '#d4883b';
      ctx.lineWidth = 2;
      this.roundRect(ctx, left + 1, top + 1, size - 2, size - 5, 4);
      ctx.stroke();

      // 3. Central vacuum tube chamber
      const tubeW = size * 0.52;
      const tubeH = size * 0.46;
      const tubeX = cx - tubeW / 2;
      const tubeY = cy - tubeH / 2 - 1;

      ctx.fillStyle = '#0a0d14';
      this.roundRect(ctx, tubeX, tubeY, tubeW, tubeH, 3);
      ctx.fill();

      // Glowing tungsten/quartz filament inside tube
      const filamentGlow = isSocketed
        ? (motion ? Math.sin(this.time * 6) * 0.15 + 0.85 : 1)
        : 0.4;
      
      const filamentColor = isSocketed
        ? (this.state.phase === 'complete' ? '#38d9a9' : '#00f2fe')
        : '#ff922b';

      ctx.strokeStyle = filamentColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tubeX + 4, tubeY + tubeH / 2);
      ctx.lineTo(tubeX + tubeW * 0.35, tubeY + 4);
      ctx.lineTo(tubeX + tubeW * 0.65, tubeY + tubeH - 4);
      ctx.lineTo(tubeX + tubeW - 4, tubeY + tubeH / 2);
      ctx.stroke();

      // Filament glow aura
      if (isSocketed) {
        ctx.fillStyle = `rgba(0, 242, 254, ${filamentGlow * 0.35})`;
        ctx.beginPath();
        ctx.arc(cx, cy - 1, tubeW * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glass reflection specular highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tubeX + 3, tubeY + 3);
      ctx.lineTo(tubeX + tubeW - 3, tubeY + 3);
      ctx.stroke();
    }
  }

  drawRobot(ctx, ox, oy, cs, motion) {
    const p = this.state.player;
    const cx = ox + p.col * cs + cs / 2;
    const cy = oy + p.row * cs + cs / 2;

    const facing = this.state.robotFacing || 'right';

    // Idle bobbing
    let bobY = 0;
    if (motion && this.state.phase === 'playing') {
      bobY = Math.sin(this.time * 4) * 1.5;
    }

    const rSize = cs * 0.72;
    const half = rSize / 2;
    const rx = cx - half;
    const ry = cy - half + bobY;

    // 1. Robot shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + half + 1, half * 0.85, half * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Twin caterpillar tank treads
    ctx.fillStyle = '#1e293b';
    // Left/Right or Top/Bottom treads depending on facing
    if (facing === 'up' || facing === 'down') {
      // Side treads
      ctx.fillRect(rx - 3, ry + 2, 4, rSize - 4);
      ctx.fillRect(rx + rSize - 1, ry + 2, 4, rSize - 4);
    } else {
      // Horizontal treads
      ctx.fillRect(rx + 2, ry - 3, rSize - 4, 4);
      ctx.fillRect(rx + 2, ry + rSize - 1, rSize - 4, 4);
    }

    // 3. Main rounded chassis (Safety Yellow / Industrial Mustard)
    ctx.fillStyle = '#f59f00';
    this.roundRect(ctx, rx, ry, rSize, rSize - 3, 6);
    ctx.fill();

    // Chassis bottom rim
    ctx.fillStyle = '#d9480f';
    this.roundRect(ctx, rx, ry + rSize - 3, rSize, 3, 2);
    ctx.fill();

    // Top protective casing highlight
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, rx + 1, ry + 1, rSize - 2, rSize - 5, 5);
    ctx.stroke();

    // 4. Directional Visor / Eye Lens
    const visorW = rSize * 0.55;
    const visorH = rSize * 0.32;
    let vx = rx + (rSize - visorW) / 2;
    let vy = ry + (rSize - visorH) / 2 - 2;

    if (facing === 'left') vx -= 4;
    else if (facing === 'right') vx += 4;
    else if (facing === 'up') vy -= 4;
    else if (facing === 'down') vy += 3;

    ctx.fillStyle = '#0f172a';
    this.roundRect(ctx, vx, vy, visorW, visorH, 4);
    ctx.fill();

    // Visor eye glow (Cyan, changes to gold/green on victory)
    const isComplete = this.state.phase === 'complete';
    const eyeColor = isComplete ? '#38d9a9' : '#00f2fe';
    ctx.fillStyle = eyeColor;

    // Twin eye lenses
    const eyeR = 2.5;
    let eyeOffX = 5;
    if (facing === 'left') eyeOffX = 3;
    if (facing === 'right') eyeOffX = 7;

    ctx.beginPath();
    ctx.arc(vx + eyeOffX, vy + visorH / 2, eyeR, 0, Math.PI * 2);
    ctx.arc(vx + eyeOffX + 7, vy + visorH / 2, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // 5. Antenna with blinking communication tip
    const antX = cx + (facing === 'left' ? 3 : -3);
    const antY = ry;
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(antX, antY);
    ctx.lineTo(antX, antY - 7);
    ctx.stroke();

    // Antenna beacon
    const antBlink = motion ? Math.sin(this.time * 5) > 0 : true;
    ctx.fillStyle = isComplete ? '#38d9a9' : (antBlink ? '#ff6b6b' : '#c92a2a');
    ctx.beginPath();
    ctx.arc(antX, antY - 7, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSurgeWave(ctx, ox, oy, cs, motion) {
    if (!this.surgeAnim) return;
    const elapsed = (performance.now() - this.surgeAnim.startTime) / 1000;
    if (elapsed > 2.5) return;

    const cols = this.state.width;
    const rows = this.state.height;
    const cx = ox + (cols * cs) / 2;
    const cy = oy + (rows * cs) / 2;

    const maxR = Math.max(cols, rows) * cs * 0.8;
    const progress = Math.min(1, elapsed / 1.5);
    const radius = maxR * progress;
    const alpha = Math.max(0, 1 - progress);

    ctx.save();
    ctx.strokeStyle = `rgba(56, 217, 169, ${alpha * 0.6})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(0, 242, 254, ${alpha * 0.3})`;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}
