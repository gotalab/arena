import { STAGE_W, STAGE_H, GROUND_Y, LOW_LANE_Y, HIGH_LANE_Y } from './sim.js';

const PAL = {
  bgTop: '#141028',
  bgBot: '#0a0618',
  laneLow: 'rgba(90, 200, 180, 0.08)',
  laneHigh: 'rgba(255, 180, 90, 0.08)',
  laneLineLow: 'rgba(90, 220, 200, 0.25)',
  laneLineHigh: 'rgba(255, 200, 100, 0.25)',
  ground: '#1e1638',
  groundLine: '#3d2d6b',
  machineBody: '#5a4aff',
  machineDark: '#2e2488',
  machineAccent: '#ff6ec8',
  machineEye: '#fff8ff',
  ball: '#ffe566',
  ballShine: '#fff9c0',
  slowFlyer: '#6ef0c8',
  slowFlyerDark: '#2a9a78',
  fastFlyer: '#ff8866',
  fastFlyerDark: '#cc4433',
  walker: '#b088ff',
  walkerDark: '#6040aa',
  danger: '#ff4466',
  ui: '#e8dcff',
  uiDim: 'rgba(232, 220, 255, 0.5)',
  clockWarn: '#ff6688',
  particle: '#ffffff',
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.effects = [];
    this.ballTrail = [];
    this.shake = 0;
    this.clockPulse = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.displayW = rect.width;
    this.displayH = rect.height;
  }

  addEffect(type, x, y, opts = {}) {
    this.effects.push({ type, x, y, life: opts.life ?? 30, ...opts });
  }

  triggerShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  draw(state) {
    const ctx = this.ctx;
    const scaleX = this.canvas.width / STAGE_W;
    const scaleY = this.canvas.height / STAGE_H;
    const scale = Math.min(scaleX, scaleY);
    const ox = (this.canvas.width - STAGE_W * scale) / 2;
    const oy = (this.canvas.height - STAGE_H * scale) / 2;

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * scale;
      sy = (Math.random() - 0.5) * this.shake * scale;
      this.shake *= 0.85;
      if (this.shake < 0.3) this.shake = 0;
    }

    ctx.setTransform(scale, 0, 0, scale, ox + sx, oy + sy);
    ctx.clearRect(-ox / scale, -oy / scale, this.canvas.width / scale, this.canvas.height / scale);

    this._drawBackground(ctx, state);
    this._drawLanes(ctx, state);
    this._drawGround(ctx);
    this._drawEnemies(ctx, state.enemies);
    this._updateBallTrail(state.ball);
    this._drawBallTrail(ctx);
    this._drawMachine(ctx, state.machine, state.phase);
    this._drawBall(ctx, state.ball, state.machine);
    this._drawEffects(ctx);
    this._drawHUD(ctx, state);

    if (state.phase === 'ready') {
      this._drawReadyOverlay(ctx, state);
    } else if (state.phase === 'ended') {
      this._drawEndOverlay(ctx, state);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _drawBackground(ctx, state) {
    const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
    g.addColorStop(0, PAL.bgTop);
    g.addColorStop(1, PAL.bgBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    const t = state.tick * 0.02;
    ctx.globalAlpha = 0.04 + Math.sin(t) * 0.01;
    for (let i = 0; i < 8; i++) {
      const px = (Math.sin(t * 0.7 + i * 1.3) * 0.5 + 0.5) * STAGE_W;
      const py = (Math.cos(t * 0.5 + i * 0.9) * 0.5 + 0.5) * STAGE_H * 0.6;
      const rg = ctx.createRadialGradient(px, py, 0, px, py, 80);
      rg.addColorStop(0, i % 2 ? '#6ef0c8' : '#ff8866');
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.fillRect(px - 80, py - 80, 160, 160);
    }
    ctx.globalAlpha = 1;
  }

  _drawLanes(ctx, state) {
    const breathe = Math.sin(state.tick * 0.04) * 0.015 + 1;

    ctx.fillStyle = PAL.laneHigh;
    ctx.fillRect(0, HIGH_LANE_Y - 28 * breathe, STAGE_W, 56 * breathe);

    ctx.fillStyle = PAL.laneLow;
    ctx.fillRect(0, LOW_LANE_Y - 24 * breathe, STAGE_W, 48 * breathe);

    ctx.strokeStyle = PAL.laneLineHigh;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 12]);
    ctx.beginPath();
    ctx.moveTo(0, HIGH_LANE_Y);
    ctx.lineTo(STAGE_W, HIGH_LANE_Y);
    ctx.stroke();

    ctx.strokeStyle = PAL.laneLineLow;
    ctx.beginPath();
    ctx.moveTo(0, LOW_LANE_Y);
    ctx.lineTo(STAGE_W, LOW_LANE_Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawGround(ctx) {
    ctx.fillStyle = PAL.ground;
    ctx.fillRect(0, GROUND_Y, STAGE_W, STAGE_H - GROUND_Y);
    ctx.strokeStyle = PAL.groundLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(STAGE_W, GROUND_Y);
    ctx.stroke();

    for (let x = 0; x < STAGE_W; x += 24) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(x, GROUND_Y + 8, 12, 3);
    }
  }

  _drawEnemies(ctx, enemies) {
    for (const e of enemies) {
      if (!e.active && e.defeatTimer <= 0) continue;
      if (e.type === 'walker') {
        this._drawWalker(ctx, e);
      } else {
        this._drawFlyer(ctx, e);
      }
    }
  }

  _drawFlyer(ctx, e) {
    const isFast = e.type === 'fastFlyer';
    const body = isFast ? PAL.fastFlyer : PAL.slowFlyer;
    const dark = isFast ? PAL.fastFlyerDark : PAL.slowFlyerDark;
    const r = e.visualRadius;
    const alpha = e.active ? 1 : e.defeatTimer / 45;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);

    const wobble = Math.sin(e.x * 0.1) * 2;
    ctx.translate(0, wobble);

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 1.1, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fill();

    const dmg = e.hitsTaken;
    for (let i = 0; i < 3; i++) {
      const cx = -r * 0.5 + i * r * 0.5;
      const cy = -r * 0.85;
      ctx.fillStyle = i < dmg ? PAL.danger : 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,80,100,0.6)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.75, r * 0.7, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!e.active && e.defeatTimer > 0) {
      const burst = 1 - e.defeatTimer / 45;
      ctx.globalAlpha = 1 - burst;
      ctx.strokeStyle = body;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + burst * 30, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawWalker(ctx, e) {
    const r = e.visualRadius;
    const alpha = e.active ? 1 : e.defeatTimer / 30;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(e.x, e.y);

    ctx.fillStyle = PAL.walkerDark;
    drawRoundedRect(ctx, -r, -r * 0.4, r * 2, r * 0.9, 4);
    ctx.fill();

    ctx.fillStyle = PAL.walker;
    ctx.beginPath();
    ctx.arc(0, -r * 0.1, r * 0.75, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.2, 3, 0, Math.PI * 2);
    ctx.arc(r * 0.25, -r * 0.2, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,100,120,0.5)';
    ctx.fillRect(-r * 0.5, r * 0.35, r, 4);

    ctx.restore();
  }

  _updateBallTrail(b) {
    if (b.onMachine || !b.active) {
      if (this.ballTrail.length > 0) this.ballTrail.length = 0;
      return;
    }
    this.ballTrail.push({ x: b.x, y: b.y, life: 12 });
    if (this.ballTrail.length > 14) this.ballTrail.shift();
    for (let i = this.ballTrail.length - 1; i >= 0; i--) {
      this.ballTrail[i].life -= 1;
      if (this.ballTrail[i].life <= 0) this.ballTrail.splice(i, 1);
    }
  }

  _drawBallTrail(ctx) {
    for (let i = 0; i < this.ballTrail.length; i++) {
      const p = this.ballTrail[i];
      const a = (p.life / 12) * 0.35;
      ctx.fillStyle = `rgba(255, 229, 102, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * (p.life / 12), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawMachine(ctx, m, phase) {
    ctx.save();
    ctx.translate(m.x, m.y);

    const squashY = 1 - m.squash * 0.15;
    const squashX = 1 + m.squash * 0.1;
    ctx.scale(squashX, squashY);

    const idleBob = phase === 'ready' ? Math.sin(m.x * 0.05) * 0.5 + Math.sin(performance.now() * 0.003) * 1.5 : 0;
    ctx.translate(0, idleBob);

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, m.radius * 0.85, m.radius * 0.9, m.radius * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PAL.machineDark;
    drawRoundedRect(ctx, -m.radius, -m.radius * 0.5, m.radius * 2, m.radius * 1.2, 6);
    ctx.fill();

    ctx.fillStyle = PAL.machineBody;
    drawRoundedRect(ctx, -m.radius + 3, -m.radius * 0.65, m.radius * 2 - 6, m.radius * 0.95, 5);
    ctx.fill();

    ctx.fillStyle = PAL.machineAccent;
    ctx.fillRect(-m.radius + 8, -m.radius * 0.3, m.radius * 2 - 16, 4);

    this._drawMachineFace(ctx, m);

    if (phase === 'ready') {
      ctx.globalAlpha = 0.4 + Math.sin(performance.now() * 0.005) * 0.2;
      ctx.fillStyle = PAL.machineAccent;
      ctx.beginPath();
      ctx.arc(0, -m.radius * 0.75, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  _drawMachineFace(ctx, m) {
    const expr = m.expression;
    const eyeY = -m.radius * 0.35;
    const eyeOff = 7 * m.facing;

    ctx.fillStyle = PAL.machineEye;
    if (expr === 'drop' || expr === 'spent' || expr === 'bite') {
      ctx.strokeStyle = PAL.machineEye;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8, eyeY + 2);
      ctx.lineTo(-4, eyeY - 2);
      ctx.moveTo(4, eyeY - 2);
      ctx.lineTo(8, eyeY + 2);
      ctx.stroke();
    } else if (expr === 'hit' || expr === 'power') {
      ctx.beginPath();
      ctx.arc(-6, eyeY, 4, 0, Math.PI * 2);
      ctx.arc(6, eyeY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(-6 + eyeOff * 0.3, eyeY - 1, 2, 0, Math.PI * 2);
      ctx.arc(6 + eyeOff * 0.3, eyeY - 1, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(-6, eyeY, 3.5, 0, Math.PI * 2);
      ctx.arc(6, eyeY, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(-6 + eyeOff * 0.2, eyeY, 1.5, 0, Math.PI * 2);
      ctx.arc(6 + eyeOff * 0.2, eyeY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = PAL.machineEye;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (expr === 'hit') {
      ctx.arc(0, eyeY + 10, 6, 0.2, Math.PI - 0.2);
    } else if (expr === 'bite' || expr === 'drop') {
      ctx.moveTo(-5, eyeY + 12);
      ctx.lineTo(0, eyeY + 8);
      ctx.lineTo(5, eyeY + 12);
    } else if (expr === 'power' || expr === 'ready') {
      ctx.arc(0, eyeY + 10, 5, 0.1, Math.PI - 0.1);
    } else {
      ctx.moveTo(-4, eyeY + 10);
      ctx.lineTo(4, eyeY + 10);
    }
    ctx.stroke();
  }

  _drawBall(ctx, b, m) {
    if (!b.active) return;
    ctx.save();
    ctx.translate(b.x, b.y);

    const stretch = b.onMachine ? 1 : 1 + Math.abs(b.vy) * 0.015;
    const squish = b.onMachine ? 1 + Math.sin(performance.now() * 0.008) * 0.05 : 1 / stretch;
    ctx.scale(squish, stretch);

    ctx.fillStyle = 'rgba(255, 220, 80, 0.25)';
    ctx.beginPath();
    ctx.arc(2, 3, b.radius + 2, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(-3, -3, 1, 0, 0, b.radius);
    grad.addColorStop(0, PAL.ballShine);
    grad.addColorStop(0.6, PAL.ball);
    grad.addColorStop(1, '#d4a820');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(-3, -3, 3, 0, Math.PI * 2);
    ctx.fill();

    if (b.onMachine && m.expression === 'ready') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, b.radius + 4 + Math.sin(performance.now() * 0.01) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawEffects(ctx) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const ef = this.effects[i];
      ef.life -= 1;
      if (ef.life <= 0) {
        this.effects.splice(i, 1);
        continue;
      }
      const t = ef.life / (ef.maxLife ?? 30);
      ctx.globalAlpha = t;
      ctx.fillStyle = ef.color ?? PAL.particle;
      ctx.beginPath();
      ctx.arc(ef.x + (ef.vx ?? 0) * (30 - ef.life), ef.y + (ef.vy ?? 0) * (30 - ef.life), ef.size ?? 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  _drawHUD(ctx, state) {
    const secs = Math.ceil(state.remainingMs / 1000);
    const urgent = state.remainingMs < 10000;

    ctx.fillStyle = 'rgba(10, 6, 24, 0.55)';
    drawRoundedRect(ctx, 12, 12, STAGE_W - 24, 36, 8);
    ctx.fill();

    ctx.fillStyle = urgent ? PAL.clockWarn : PAL.ui;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${secs}`, 24, 37);

    ctx.fillStyle = PAL.uiDim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('TIME', 24, 22);

    ctx.textAlign = 'right';
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(String(state.score), STAGE_W - 24, 37);

    ctx.fillStyle = PAL.uiDim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('SCORE', STAGE_W - 24, 22);

    if (urgent) {
      const pulse = 0.5 + Math.sin(state.tick * 0.3) * 0.5;
      ctx.strokeStyle = `rgba(255, 100, 120, ${pulse * 0.6})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 8, STAGE_W - 16, STAGE_H - 16);
    }
  }

  _drawReadyOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(10, 6, 24, 0.15)';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    ctx.fillStyle = PAL.uiDim;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('move or jump to start', STAGE_W / 2, STAGE_H - 100);
  }

  _drawEndOverlay(ctx, state) {
    ctx.fillStyle = 'rgba(10, 6, 24, 0.75)';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    const cx = STAGE_W / 2;
    let y = 180;

    ctx.textAlign = 'center';
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('RUN OVER', cx, y);
    y += 36;

    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.fillText(String(state.score), cx, y);
    y += 20;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText('SCORE', cx, y);
    y += 40;

    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = PAL.machineAccent;
    ctx.fillText(`RANK ${state.rank}`, cx, y);
    y += 44;

    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = PAL.ui;
    const lines = [
      `Best  ${state.sessionBest}`,
      `Targets  ${state.airEnemiesDefeated}`,
      `Best streak  ${state.longestCleanSequence}`,
    ];
    for (const line of lines) {
      ctx.fillText(line, cx, y);
      y += 24;
    }

    y += 16;
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '13px system-ui, sans-serif';
    const blink = Math.sin(state.tick * 0.08) > 0;
    ctx.globalAlpha = blink ? 1 : 0.4;
    ctx.fillText('tap jump or press R to retry', cx, y);
    ctx.globalAlpha = 1;
  }
}

export function syncEffects(renderer, sim, prevSnap) {
  const snap = sim.snapshot();
  const last = snap.lastEvent;
  if (!last || !prevSnap || last.sequence === prevSnap._lastSeq) return snap;

  if (last.kind === 'top_hit') {
    const enemy = snap.enemies.find((e) => e.id === last.enemyId);
    if (enemy) {
      renderer.triggerShake(last.enemyId && snap.enemies.find((e) => e.id === last.enemyId)?.hitsTaken === 3 ? 8 : 4);
      for (let i = 0; i < 8; i++) {
        renderer.addEffect('spark', enemy.x, enemy.y, {
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 0.5) * 4,
          life: 20 + Math.random() * 15,
          maxLife: 35,
          color: PAL.slowFlyer,
        });
      }
    }
  }
  if (last.kind === 'enemy_defeated') {
    renderer.triggerShake(10);
    const enemy = snap.enemies.find((e) => e.id === last.enemyId);
    if (enemy) {
      for (let i = 0; i < 24; i++) {
        const ang = (Math.PI * 2 * i) / 24;
        renderer.addEffect('burst', enemy.x, enemy.y, {
          vx: Math.cos(ang) * 5,
          vy: Math.sin(ang) * 5,
          life: 25 + Math.random() * 20,
          maxLife: 45,
          size: 4 + Math.random() * 3,
          color: i % 2 ? PAL.fastFlyer : PAL.slowFlyer,
        });
      }
    }
  }
  if (last.kind === 'ball_drop') {
    renderer.triggerShake(6);
  }

  snap._lastSeq = last.sequence;
  return snap;
}
