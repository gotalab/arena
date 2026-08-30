const PALETTE = {
  bg0: '#0a0e1a',
  bg1: '#12182b',
  wall: '#2a3f5f',
  wallHi: '#3d5a80',
  wallGlow: '#4a6fa5',
  floor: '#1a2540',
  rock: '#5c4a3a',
  rockHi: '#8b7355',
  fragment: '#5eead4',
  fragmentCore: '#a7f3d0',
  power: '#fbbf24',
  powerCore: '#fef08a',
  machine: '#e8a87c',
  machineDark: '#c38d6a',
  machineLight: '#ffd4b8',
  eye: '#1e293b',
  eyeHi: '#38bdf8',
  exhaust: '#fb923c',
  danger: '#f87171',
  ui: '#e2e8f0',
  uiDim: '#94a3b8',
  timer: '#34d399',
  timerWarn: '#fbbf24',
  timerCrit: '#f87171',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.debris = [];
    this.shake = 0;
    this.flash = 0;
    this.nearMissStreak = 0;
    this.mood = 'ready';
    this.streakDecay = 0;
    this.lastEventSeq = 0;
    this.closestShave = Infinity;
    this.dpr = 1;
    this.viewW = 360;
    this.viewH = 640;
    this.playerScreenY = 0.38;
    this.scale = 1;
    this.bestScore = 0;
  }

  resize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scale = Math.min(w / 360, h / 640);
    this.playerScreenY = h * 0.38;
  }

  _worldToScreen(x, depth, playerDepth, playerX, cx) {
    const screenX = this.viewW / 2 + (x - playerX) * this.scale;
    const screenY = this.playerScreenY + (depth - playerDepth) * this.scale * 0.55;
    return { x: screenX, y: screenY };
  }

  _drawBackground(ctx, time) {
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, PALETTE.bg1);
    g.addColorStop(0.5, PALETTE.bg0);
    g.addColorStop(1, '#060810');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 30; i++) {
      const x = ((i * 137 + Math.floor(time * 0.02)) % this.viewW);
      const y = ((i * 89 + depthOffset(time, i)) % this.viewH);
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawCorridor(ctx, snap, playerDepth, playerX) {
    const walls = snap.walls;
    if (!walls.length) return;

    ctx.save();
    ctx.beginPath();
    const leftPts = [];
    const rightPts = [];
    for (const w of walls) {
      const l = this._worldToScreen(w.leftX, w.depth, playerDepth, playerX, snap.courseCenterX);
      const r = this._worldToScreen(w.rightX, w.depth, playerDepth, playerX, snap.courseCenterX);
      if (l.y > this.viewH + 50) break;
      leftPts.push(l);
      rightPts.push(r);
    }

    if (leftPts.length < 2) {
      ctx.restore();
      return;
    }

    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    for (let i = 1; i < leftPts.length; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
    for (let i = rightPts.length - 1; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
    ctx.closePath();

    const cg = ctx.createLinearGradient(0, 0, 0, this.viewH);
    cg.addColorStop(0, PALETTE.floor);
    cg.addColorStop(1, '#0f172a');
    ctx.fillStyle = cg;
    ctx.fill();

    ctx.strokeStyle = PALETTE.wallGlow;
    ctx.lineWidth = 3 * this.scale;
    ctx.shadowColor = PALETTE.wallGlow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    for (let i = 1; i < leftPts.length; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rightPts[0].x, rightPts[0].y);
    for (let i = 1; i < rightPts.length; i++) ctx.lineTo(rightPts[i].x, rightPts[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = PALETTE.wallHi;
    ctx.lineWidth = 1.5 * this.scale;
    ctx.beginPath();
    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    for (let i = 1; i < leftPts.length; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rightPts[0].x, rightPts[0].y);
    for (let i = 1; i < rightPts.length; i++) ctx.lineTo(rightPts[i].x, rightPts[i].y);
    ctx.stroke();

    ctx.restore();
  }

  _drawRock(ctx, rock, playerDepth, playerX) {
    if (!rock.active) return;
    const p = this._worldToScreen(rock.position.x, rock.position.depth, playerDepth, playerX, 0);
    if (p.y < -40 || p.y > this.viewH + 40) return;
    const r = rock.visualRadius * this.scale;

    ctx.save();
    ctx.translate(p.x, p.y);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, PALETTE.rockHi);
    g.addColorStop(0.6, PALETTE.rock);
    g.addColorStop(1, '#3d3228');
    ctx.fillStyle = g;
    ctx.beginPath();
    const facets = 7;
    for (let i = 0; i < facets; i++) {
      const a = (i / facets) * Math.PI * 2 + rock.id * 0.3;
      const rad = r * (0.85 + (i % 3) * 0.06);
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  _drawFragment(ctx, item, playerDepth, playerX, time) {
    if (!item.active) return;
    const p = this._worldToScreen(item.position.x, item.position.depth, playerDepth, playerX, 0);
    if (p.y < -30 || p.y > this.viewH + 30) return;
    const pulse = 1 + Math.sin(time * 0.008 + item.id) * 0.15;
    const r = item.visualRadius * this.scale * pulse;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = PALETTE.fragment;
    ctx.shadowBlur = 12;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, PALETTE.fragmentCore);
    g.addColorStop(0.5, PALETTE.fragment);
    g.addColorStop(1, 'rgba(94,234,212,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.6, 0);
    ctx.lineTo(0, r);
    ctx.lineTo(-r * 0.6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawPower(ctx, item, playerDepth, playerX, time) {
    if (!item.active) return;
    const p = this._worldToScreen(item.position.x, item.position.depth, playerDepth, playerX, 0);
    if (p.y < -30 || p.y > this.viewH + 30) return;
    const r = item.visualRadius * this.scale * (1 + Math.sin(time * 0.01) * 0.2);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(time * 0.003);
    ctx.shadowColor = PALETTE.power;
    ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, PALETTE.powerCore);
    g.addColorStop(0.6, PALETTE.power);
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rad = i % 2 === 0 ? r : r * 0.55;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawMachine(ctx, snap, time, mood) {
    const px = this.viewW / 2;
    const py = this.playerScreenY;
    const s = this.scale;
    const speedRatio = (snap.speed - 42) / (420 - 42);
    const invincible = snap.timeMs < snap.invincibleUntilMs;
    const accel = snap.input.accelerate;

    ctx.save();
    ctx.translate(px, py);

    const lean = snap.input.steer * 0.12 + speedRatio * snap.input.steer * 0.08;
    ctx.rotate(lean);

    const stretch = 1 + speedRatio * 0.18;
    ctx.scale(1, stretch);

    if (invincible) {
      ctx.shadowColor = PALETTE.power;
      ctx.shadowBlur = 20 + Math.sin(time * 0.02) * 8;
    }

    const bodyW = 28 * s;
    const bodyH = 34 * s;

    if (mood === 'collision') {
      ctx.rotate(0.15);
      ctx.scale(0.92, 0.85);
    } else if (mood === 'near_miss') {
      ctx.scale(1.05, 0.95);
    }

    const bg = ctx.createLinearGradient(-bodyW, -bodyH, bodyW, bodyH);
    bg.addColorStop(0, PALETTE.machineLight);
    bg.addColorStop(0.5, PALETTE.machine);
    bg.addColorStop(1, PALETTE.machineDark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(-bodyW * 0.5, -bodyH * 0.35, bodyW, bodyH, 8 * s);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(-4 * s, -bodyH * 0.55);
    ctx.lineTo(4 * s, -bodyH * 0.55);
    ctx.lineTo(2 * s, -bodyH * 0.85);
    ctx.lineTo(-2 * s, -bodyH * 0.85);
    ctx.closePath();
    ctx.fill();

    const drillSpin = time * (0.02 + speedRatio * 0.08);
    ctx.save();
    ctx.translate(0, -bodyH * 0.7);
    ctx.rotate(drillSpin);
    ctx.fillStyle = '#cbd5e1';
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(3 * s, -10 * s);
      ctx.lineTo(-3 * s, -10 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    const eyeY = -bodyH * 0.1;
    const eyeOpen = mood === 'spent' ? 0.3 : mood === 'collision' ? 0.5 : 1;
    const eyeScale = eyeOpen * (1 + speedRatio * 0.15);
    ctx.fillStyle = PALETTE.eye;
    ctx.beginPath();
    ctx.ellipse(-7 * s, eyeY, 5 * s * eyeScale, 6 * s * eyeScale, 0, 0, Math.PI * 2);
    ctx.ellipse(7 * s, eyeY, 5 * s * eyeScale, 6 * s * eyeScale, 0, 0, Math.PI * 2);
    ctx.fill();

    const eyeColor = invincible ? PALETTE.power : speedRatio > 0.75 ? PALETTE.danger : PALETTE.eyeHi;
    ctx.fillStyle = eyeColor;
    const pupilOff = snap.input.steer * 2 * s;
    ctx.beginPath();
    ctx.arc(-7 * s + pupilOff, eyeY, 2.5 * s, 0, Math.PI * 2);
    ctx.arc(7 * s + pupilOff, eyeY, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();

    if (accel && snap.phase === 'playing') {
      ctx.fillStyle = PALETTE.exhaust;
      const exLen = (8 + speedRatio * 20) * s;
      ctx.globalAlpha = 0.5 + speedRatio * 0.4;
      ctx.beginPath();
      ctx.moveTo(-6 * s, bodyH * 0.45);
      ctx.lineTo(0, bodyH * 0.45 + exLen);
      ctx.lineTo(6 * s, bodyH * 0.45);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (speedRatio > 0.6) {
      ctx.strokeStyle = `rgba(251,146,60,${0.2 + speedRatio * 0.3})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.3 + i * 8 * s, bodyH * 0.5);
        ctx.lineTo(-bodyW * 0.3 + i * 8 * s, bodyH * 0.5 + (15 + speedRatio * 25) * s);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawHUD(ctx, snap, time) {
    const pad = 14 * this.scale;
    const timerRatio = snap.remainingMs / 48000;
    let timerColor = PALETTE.timer;
    if (timerRatio < 0.25) timerColor = PALETTE.timerCrit;
    else if (timerRatio < 0.5) timerColor = PALETTE.timerWarn;

    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.beginPath();
    ctx.roundRect(pad, pad, this.viewW - pad * 2, 28 * this.scale, 8);
    ctx.fill();

    const barW = (this.viewW - pad * 2 - 8) * Math.max(0, Math.min(1, timerRatio));
    const bg = ctx.createLinearGradient(pad + 4, 0, pad + 4 + barW, 0);
    bg.addColorStop(0, timerColor);
    bg.addColorStop(1, timerColor + '88');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(pad + 4, pad + 4, barW, 20 * this.scale, 5);
    ctx.fill();

    ctx.fillStyle = PALETTE.ui;
    ctx.font = `bold ${13 * this.scale}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(`DEPTH ${Math.floor(snap.depth)}m`, pad, pad + 48 * this.scale);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(snap.score)}`, this.viewW - pad, pad + 48 * this.scale);

    if (snap.timeMs < snap.invincibleUntilMs) {
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.power;
      ctx.font = `bold ${11 * this.scale}px system-ui`;
      const rem = ((snap.invincibleUntilMs - snap.timeMs) / 1000).toFixed(1);
      ctx.fillText(`⚡ POWER ${rem}s`, this.viewW / 2, pad + 48 * this.scale);
    }
  }

  _drawReady(ctx, snap, time) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = PALETTE.ui;
    ctx.textAlign = 'center';
    ctx.font = `bold ${28 * this.scale}px system-ui`;
    ctx.fillText('DELVE', this.viewW / 2, this.viewH * 0.28);
    ctx.font = `${14 * this.scale}px system-ui`;
    ctx.fillStyle = PALETTE.uiDim;
    const bounce = Math.sin(time * 0.004) * 4;
    ctx.fillText('Hold ↓ or drag down to dig', this.viewW / 2, this.viewH * 0.55 + bounce);
    ctx.font = `${12 * this.scale}px system-ui`;
    ctx.fillText('← → to steer', this.viewW / 2, this.viewH * 0.62 + bounce);
  }

  _drawGameOver(ctx, snap) {
    ctx.fillStyle = 'rgba(6,8,16,0.82)';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const cx = this.viewW / 2;
    let cy = this.viewH * 0.3;

    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.uiDim;
    ctx.font = `${13 * this.scale}px system-ui`;
    ctx.fillText('RUN COMPLETE', cx, cy);
    cy += 36 * this.scale;

    ctx.fillStyle = PALETTE.ui;
    ctx.font = `bold ${42 * this.scale}px system-ui`;
    ctx.fillText(snap.rank || 'D', cx, cy);
    cy += 50 * this.scale;

    ctx.font = `bold ${22 * this.scale}px system-ui`;
    ctx.fillText(`${Math.floor(snap.score)} pts`, cx, cy);
    cy += 30 * this.scale;

    ctx.font = `${14 * this.scale}px system-ui`;
    ctx.fillStyle = PALETTE.uiDim;
    ctx.fillText(`Best: ${Math.floor(this.bestScore)}`, cx, cy);
    cy += 36 * this.scale;

    const sig = this._signatureStat(snap);
    ctx.fillStyle = PALETTE.fragment;
    ctx.font = `${13 * this.scale}px system-ui`;
    ctx.fillText(sig.label, cx, cy);
    cy += 22 * this.scale;
    ctx.fillStyle = PALETTE.ui;
    ctx.font = `bold ${18 * this.scale}px system-ui`;
    ctx.fillText(sig.value, cx, cy);
    cy += 50 * this.scale;

    ctx.fillStyle = PALETTE.uiDim;
    ctx.font = `${13 * this.scale}px system-ui`;
    ctx.fillText('Tap or press R to dig again', cx, cy);
  }

  _signatureStat(snap) {
    const depth = Math.floor(snap.depth);
    if (this.closestShave < 12 && this.closestShave !== Infinity) {
      return { label: 'Closest shave', value: `${this.closestShave.toFixed(1)} units` };
    }
    if (snap.fragmentsCollected >= 4) {
      return { label: 'Fragments swept', value: `${snap.fragmentsCollected}` };
    }
    if (snap.rocksBroken > 0) {
      return { label: 'Rocks shattered', value: `${snap.rocksBroken}` };
    }
    return { label: 'Deepest point', value: `${depth}m` };
  }

  _spawnDebris(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      this.debris.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6 - 2,
        life: 0.4 + Math.random() * 0.3,
        r: 2 + Math.random() * 4,
        color,
      });
    }
  }

  _spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: -2 - Math.random() * 3,
        life: 0.5 + Math.random() * 0.3,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }

  processEvents(snap, audio, sim) {
    const events = snap.events || [];
    for (const ev of events) {
      if (ev.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = ev.seq;
      const px = this.viewW / 2;
      const py = this.playerScreenY;
      switch (ev.kind) {
        case 'near_miss':
          this.nearMissStreak += 1;
          this.streakDecay = 60;
          this.shake = 3 + this.nearMissStreak * 1.5;
          this.mood = 'near_miss';
          if (sim?.stats?.closestShave < this.closestShave) {
            this.closestShave = sim.stats.closestShave;
          }
          audio?.play('near_miss', Math.min(this.nearMissStreak, 5));
          break;
        case 'rock_hit':
        case 'wall_contact':
          this.mood = 'collision';
          this.shake = 12;
          this.flash = 0.4;
          this.nearMissStreak = 0;
          this._spawnDebris(px, py, 12, PALETTE.rock);
          audio?.play(ev.kind === 'wall_contact' ? 'wall_contact' : 'rock_hit');
          break;
        case 'fragment':
          this._spawnParticles(px, py - 20, PALETTE.fragment, 8);
          audio?.play('fragment');
          break;
        case 'power':
          this._spawnParticles(px, py, PALETTE.power, 14);
          audio?.play('power');
          break;
        case 'rock_broken':
          this._spawnDebris(px, py, 8, PALETTE.rockHi);
          audio?.play('fragment', 1.2);
          break;
      }
    }
    if (snap.phase === 'gameover' && this.mood !== 'spent') {
      this.mood = 'spent';
      audio?.play('gameover');
    }
  }

  updateMood(snap) {
    if (snap.phase === 'ready') this.mood = 'ready';
    else if (snap.phase === 'gameover') this.mood = 'spent';
    else if (this.streakDecay > 0) {
      this.streakDecay -= 1;
    } else if (this.mood === 'near_miss' || this.mood === 'collision') {
      this.mood = snap.input.accelerate ? 'digging' : 'coasting';
    } else {
      const speedRatio = (snap.speed - 42) / (420 - 42);
      if (speedRatio > 0.75) this.mood = 'thrilled';
      else if (snap.input.accelerate) this.mood = 'digging';
      else this.mood = 'coasting';
    }
  }

  render(snap, time) {
    const ctx = this.ctx;
    if (snap.score > this.bestScore && snap.phase !== 'ready') {
      this.bestScore = Math.max(this.bestScore, snap.score);
    }
    if (snap.phase === 'gameover') {
      this.bestScore = Math.max(this.bestScore, snap.score);
    }

    this.updateMood(snap);

    let ox = 0;
    let oy = 0;
    if (this.shake > 0.1) {
      ox = (Math.random() - 0.5) * this.shake;
      oy = (Math.random() - 0.5) * this.shake;
      this.shake *= 0.88;
    }

    ctx.save();
    ctx.translate(ox, oy);

    this._drawBackground(ctx, time);

    const speedRatio = (snap.speed - 42) / (420 - 42);
    if (speedRatio > 0.5 && snap.phase === 'playing') {
      ctx.save();
      ctx.globalAlpha = (speedRatio - 0.5) * 0.25;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const lx = (i * 47 + time * 0.5) % this.viewW;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx - 20, this.viewH);
        ctx.stroke();
      }
      ctx.restore();
    }

    this._drawCorridor(ctx, snap, snap.depth, snap.x);

    const sorted = [
      ...snap.rocks.map((r) => ({ ...r, kind: 'rock' })),
      ...snap.items.map((i) => ({ ...i, kind: i.type })),
    ].sort((a, b) => a.position.depth - b.position.depth);

    for (const ent of sorted) {
      if (ent.kind === 'rock') this._drawRock(ctx, ent, snap.depth, snap.x);
      else if (ent.kind === 'fragment') this._drawFragment(ctx, ent, snap.depth, snap.x, time);
      else if (ent.kind === 'power') this._drawPower(ctx, ent, snap.depth, snap.x, time);
    }

    this._drawMachine(ctx, snap, time, this.mood);

    this._updateParticles(ctx);
    this._drawHUD(ctx, snap, time);

    if (snap.phase === 'ready') this._drawReady(ctx, snap, time);
    if (snap.phase === 'gameover') this._drawGameOver(ctx, snap);

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      this.flash *= 0.85;
    }
  }

  _updateParticles(ctx) {
    const dt = 1 / 60;
    for (const arr of [this.particles, this.debris]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.15;
        p.life -= dt;
        if (p.life <= 0) {
          arr.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  resetVisual() {
    this.particles = [];
    this.debris = [];
    this.shake = 0;
    this.flash = 0;
    this.nearMissStreak = 0;
    this.mood = 'ready';
    this.lastEventSeq = 0;
    this.closestShave = Infinity;
  }
}

function depthOffset(time, i) {
  return (time * 0.3 + i * 50) % 640;
}
