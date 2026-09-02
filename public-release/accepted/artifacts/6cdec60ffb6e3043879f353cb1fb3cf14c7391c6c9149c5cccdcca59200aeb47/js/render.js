/** Canvas renderer — tide pool, shells, host, HUD, ceremony */

const NUM_COLORS = [
  null,
  '#4fc3f7',
  '#26a69a',
  '#ef5350',
  '#7e57c2',
  '#ff7043',
  '#5c6bc0',
  '#ec407a',
  '#78909c',
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.animRipple = [];
    this.rippleWaves = [];
    this.animTime = 0;
    this.hostMood = 'curious';
    this.hostBlink = 0;
    this.shake = 0;
    this.poolClearFlash = 0;
    this.lastState = null;
    this.waterPhase = Math.random() * 1000;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(400, rect.height);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
  }

  setState(state) {
    if (state.lastEvent) {
      const ev = state.lastEvent;
      if (ev.kind === 'open' || ev.kind === 'sweep') {
        if (ev.opened > 1) {
          this.rippleWaves.push({ t: 0, strength: ev.opened });
        }
        if (ev.opened >= 5) this.hostMood = 'delighted';
      }
      if (ev.kind === 'flag') this.hostMood = 'curious';
      if (ev.kind === 'sting') {
        this.shake = 20;
        this.hostMood = 'stung';
      }
      if (ev.kind === 'pool_clear') {
        this.poolClearFlash = 1;
        this.hostMood = 'proud';
      }
      if (ev.kind === 'run_end') this.hostMood = 'stung';
    }

    if (state.phase === 'ready') this.hostMood = 'curious';
    if (state.phase === 'playing') {
      const covered = state.rows.join('').split('').filter((c) => c === '#').length;
      if (covered <= 3 && covered > 0) this.hostMood = 'tense';
    }

    this.lastState = state;
  }

  draw(state, dt) {
    this.animTime += dt;
    this.waterPhase += dt * 0.001;
    if (this.shake > 0) this.shake *= 0.85;
    if (this.poolClearFlash > 0) this.poolClearFlash -= dt * 0.002;

    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;

    ctx.save();
    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this._drawWater(ctx, W, H);
    this._drawHUD(ctx, state, W);

    const layout = this._layout(state);
    this._drawGrid(ctx, state, layout);
    this._drawRippleWaves(ctx, layout, dt);
    this._drawHost(ctx, state, layout, dt);

    if (state.phase === 'ended') {
      this._drawCeremony(ctx, state, W, H);
    } else if (state.phase === 'ready') {
      this._drawTitle(ctx, W, H);
    }

    if (this.poolClearFlash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.poolClearFlash * 0.3})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  _layout(state) {
    const pad = 12;
    const hudH = 56;
    const hostH = 48;
    const availW = this.W - pad * 2;
    const availH = this.H - pad * 2 - hudH - hostH;
    const cell = Math.floor(Math.min(availW / state.gridWidth, availH / state.gridHeight));
    const gridW = cell * state.gridWidth;
    const gridH = cell * state.gridHeight;
    const ox = (this.W - gridW) / 2;
    const oy = pad + hudH + (availH - gridH) / 2;
    return { cell, ox, oy, gridW, gridH, hostY: oy + gridH + 8 };
  }

  _drawWater(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a4a5e');
    g.addColorStop(0.4, '#1e5f6b');
    g.addColorStop(1, '#0d3340');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 6; i++) {
      const y = ((this.waterPhase * 30 + i * 80) % (H + 40)) - 20;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= W; x += 20) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + this.waterPhase * 2 + i) * 6);
      }
      ctx.strokeStyle = '#7ec8e3';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawHUD(ctx, state, W) {
    const y = 14;
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#e0f7fa';
    ctx.textAlign = 'left';
    ctx.fillText(`Pearls ${state.pearls}`, 14, y + 14);

    ctx.textAlign = 'center';
    ctx.fillText(`Pool ${state.pool}`, W / 2, y + 14);

    ctx.textAlign = 'right';
    ctx.fillText(`Urchins ${state.urchinsLeft}`, W - 14, y + 14);

    const barW = W - 28;
    const barX = 14;
    const barY = y + 26;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(barX, barY, barW, 8);
    const tide = state.tideFraction;
    const tg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    tg.addColorStop(0, '#4dd0e1');
    tg.addColorStop(1, '#80deea');
    ctx.fillStyle = tg;
    ctx.fillRect(barX, barY, barW * tide, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(barX, barY, barW, 8);
  }

  _drawGrid(ctx, state, layout) {
    const { cell, ox, oy } = layout;
    for (let y = 0; y < state.gridHeight; y++) {
      for (let x = 0; x < state.gridWidth; x++) {
        const c = state.rows[y][x];
        const px = ox + x * cell;
        const py = oy + y * cell;
        this._drawCell(ctx, c, px, py, cell - 2, x, y, state);
      }
    }
  }

  _drawCell(ctx, c, x, y, size, gx, gy, state) {
    const r = size * 0.12;
    ctx.save();

    if (c === '#') {
      const g = ctx.createRadialGradient(x + size / 2, y + size / 2, 2, x + size / 2, y + size / 2, size / 2);
      g.addColorStop(0, '#f5e6d3');
      g.addColorStop(0.7, '#d4b896');
      g.addColorStop(1, '#a08060');
      ctx.fillStyle = g;
      this._roundRect(ctx, x, y, size, size, r);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + size * 0.35, y + size * 0.3, size * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fill();
    } else if (c === 'F') {
      this._drawShellBase(ctx, x, y, size, r, '#c9b896');
      this._drawPennant(ctx, x + size / 2, y + size / 2, size * 0.35);
    } else if (c >= '0' && c <= '8') {
      this._drawShellBase(ctx, x, y, size, r, '#b8d4e8');
      const n = c.charCodeAt(0) - 48;
      if (n > 0) {
        ctx.font = `bold ${Math.floor(size * 0.45)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = NUM_COLORS[n] || '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowBlur = 3;
        ctx.fillText(c, x + size / 2, y + size / 2 + 1);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = 'rgba(174,224,255,0.3)';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (c === '*') {
      this._drawUrchin(ctx, x, y, size, '#8e24aa');
    } else if (c === 'X') {
      this._drawUrchin(ctx, x, y, size, '#d32f2f');
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + size - 4, y + size - 4);
      ctx.moveTo(x + size - 4, y + 4);
      ctx.lineTo(x + 4, y + size - 4);
      ctx.stroke();
    } else if (c === '+') {
      this._drawUrchin(ctx, x, y, size, '#6a1b9a');
      this._drawPennant(ctx, x + size / 2, y + size / 2, size * 0.3, true);
    } else if (c === '-') {
      this._drawShellBase(ctx, x, y, size, r, '#90caf9');
      this._drawPennant(ctx, x + size / 2, y + size / 2, size * 0.3, false);
    }

    ctx.restore();
  }

  _drawShellBase(ctx, x, y, size, r, color) {
    ctx.fillStyle = color;
    this._roundRect(ctx, x, y, size, size, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawPennant(ctx, cx, cy, size, correct) {
    ctx.fillStyle = correct !== false ? '#ef5350' : '#ef9a9a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.6, cy - size * 0.3);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b71c1c';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy + size * 0.3);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawUrchin(ctx, x, y, size, color) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * size * 0.2, cy + Math.sin(a) * size * 0.2);
      ctx.lineTo(cx + Math.cos(a) * size * 0.45, cy + Math.sin(a) * size * 0.45);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _drawRippleWaves(ctx, layout, dt) {
    this.rippleWaves = this.rippleWaves.filter((w) => {
      w.t += dt;
      return w.t < 800;
    });
    for (const w of this.rippleWaves) {
      const r = (w.t / 800) * Math.max(layout.gridW, layout.gridH);
      ctx.strokeStyle = `rgba(128, 222, 234, ${0.4 * (1 - w.t / 800)})`;
      ctx.lineWidth = 2 + w.strength * 0.2;
      ctx.beginPath();
      ctx.arc(
        layout.ox + layout.gridW / 2,
        layout.oy + layout.gridH / 2,
        r * 0.4,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }

  _drawHost(ctx, state, layout, dt) {
    const hx = this.W / 2;
    const hy = layout.hostY + 20;
    this.hostBlink += dt;
    const blink = this.hostBlink > 3000 && this.hostBlink < 3100;

    ctx.save();
    ctx.translate(hx, hy);

    const mood = this.hostMood;
    const bounce = mood === 'delighted' ? Math.sin(this.animTime * 0.01) * 4 : 0;
    ctx.translate(0, bounce);

    // Body — small hermit crab
    ctx.fillStyle = '#ff8a65';
    ctx.beginPath();
    ctx.ellipse(0, 4, 18, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shell on back
    ctx.fillStyle = '#bcaaa4';
    ctx.beginPath();
    ctx.arc(-6, -2, 14, Math.PI, 0);
    ctx.fill();

    // Eyes on stalks
    const eyeY = mood === 'stung' ? 2 : -6;
    [-8, 4].forEach((ex) => {
      ctx.strokeStyle = '#ff8a65';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex, 0);
      ctx.lineTo(ex, eyeY);
      ctx.stroke();
      ctx.fillStyle = blink ? '#ff8a65' : '#fff';
      ctx.beginPath();
      ctx.arc(ex, eyeY - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      if (!blink) {
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(ex + (mood === 'curious' ? 1 : 0), eyeY - 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Claws
    ctx.fillStyle = '#ff7043';
    if (mood === 'delighted') {
      ctx.beginPath();
      ctx.arc(-16, 2, 6, 0, Math.PI * 2);
      ctx.arc(16, 2, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === 'tense') {
      ctx.fillRect(-20, -2, 8, 6);
      ctx.fillRect(12, -2, 8, 6);
    } else {
      ctx.beginPath();
      ctx.arc(-14, 6, 5, 0, Math.PI * 2);
      ctx.arc(14, 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawTitle(ctx, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.font = '700 28px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e0f7fa';
    ctx.fillText('SHOAL', W / 2, H * 0.78);
    ctx.font = '400 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(224,247,250,0.7)';
    ctx.fillText('Tap a shell to begin', W / 2, H * 0.86);
  }

  _drawCeremony(ctx, state, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, H * 0.55, W, H * 0.45);

    const cx = W / 2;
    let y = H * 0.6;
    ctx.textAlign = 'center';

    let biggestRipple = 0;
    let fastestPool = null;
    if (state.events) {
      for (const e of state.events) {
        if ((e.kind === 'open' || e.kind === 'sweep') && e.opened > biggestRipple) {
          biggestRipple = e.opened;
        }
        if (e.kind === 'pool_clear' && e.poolMs != null) {
          if (fastestPool == null || e.poolMs < fastestPool) fastestPool = e.poolMs;
        }
      }
    }

    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = state.stungAt ? '#ef9a9a' : '#80deea';
    ctx.fillText(state.stungAt ? 'Stung!' : 'Run Complete', cx, y);
    y += 32;

    ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${state.pearls} Pearls`, cx, y);
    y += 24;

    ctx.font = '400 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`Best: ${state.sessionBest}`, cx, y);
    y += 22;

    if (state.rank) {
      ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(state.rank, cx, y);
      y += 24;
    }

    ctx.font = '400 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`Biggest ripple: ${biggestRipple} shells`, cx, y);
    y += 20;
    if (fastestPool != null) {
      ctx.fillText(`Fastest pool: ${(fastestPool / 1000).toFixed(1)}s`, cx, y);
      y += 20;
    }

    ctx.font = '400 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(224,247,250,0.8)';
    ctx.fillText('Tap to try again', cx, H * 0.92);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  cellAt(state, layout, clientX, clientY, rect) {
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { cell, ox, oy } = layout;
    const gx = Math.floor((x - ox) / cell);
    const gy = Math.floor((y - oy) / cell);
    if (gx < 0 || gy < 0 || gx >= state.gridWidth || gy >= state.gridHeight) return null;
    return { x: gx, y: gy, cell: state.rows[gy][gx] };
  }

  isCeremonyTap(state, clientY, rect) {
    if (state.phase !== 'ended') return false;
    const y = clientY - rect.top;
    return y > this.H * 0.55;
  }
}
