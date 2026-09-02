const PAL = {
  sky0: "#070b14",
  sky1: "#121a28",
  glass: "#1a3040",
  glassLit: "#7ec9a8",
  floor: "#18222e",
  floorAlt: "#1c2836",
  grout: "#101820",
  copper: "#c4843c",
  copperDim: "#6d4320",
  copperHot: "#ffc56a",
  steel: "#2a3342",
  steelHi: "#3d4a5c",
  steelLo: "#1a212c",
  bolt: "#8a93a3",
  amber: "#e8a23a",
  visor: "#3ad0c0",
  visorDim: "#1a6e68",
  body: "#e4d8c8",
  bodyShade: "#b7ab9c",
  tread: "#1c1a18",
  glassCore: "#2a3d48",
  night: "rgba(4, 10, 18, 0.42)",
};

function hash(r, c) {
  let x = (r + 1) * 73856093 ^ (c + 1) * 19349663;
  x = Math.imul(x ^ (x >>> 16), 2246822519);
  return (x >>> 0) / 4294967296;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function ease(t) {
  return 1 - (1 - t) * (1 - t);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class YardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = null;
    this.motion = true;
    this.facing = "right";
    this.layout = { x: 0, y: 0, cell: 32, pad: 0 };
    this.tween = null;
    this.shakeUntil = 0;
    this.surgeAt = 0;
    this.undoAt = 0;
    this.seatAt = 0;
    this.seatCell = null;
    this.stars = Array.from({ length: 48 }, (_, i) => ({
      x: hash(i, 3),
      y: hash(i, 7),
      s: 0.4 + hash(i, 11) * 1.4,
      p: hash(i, 13) * Math.PI * 2,
    }));
    this._lastNow = 0;
  }

  setMotion(on) {
    this.motion = on;
  }

  apply(state, fx = null) {
    const prev = this.state;
    this.state = state;
    if (fx && fx.direction) this.facing = fx.direction;
    if (!fx) return;
    const now = performance.now();
    if (fx.kind === "step" || fx.kind === "push" || fx.kind === "seat" || fx.kind === "complete") {
      if (this.motion && fx.from && fx.to) {
        this.tween = {
          start: now,
          dur: fx.kind === "step" ? 120 : 160,
          from: fx.from,
          to: fx.to,
          crateFrom: fx.crateFrom || null,
          crateTo: fx.crateTo || null,
        };
      } else {
        this.tween = null;
      }
      if (fx.seated || fx.kind === "seat" || fx.kind === "complete") {
        this.seatAt = now;
        this.seatCell = fx.crateTo || null;
      }
      if (fx.kind === "complete") this.surgeAt = now;
    } else if (fx.kind === "undo") {
      this.tween = null;
      this.undoAt = now;
      this.surgeAt = 0;
    } else if (fx.kind === "select" || fx.kind === "restart") {
      this.tween = null;
      this.surgeAt = state.phase === "complete" ? now : 0;
    }
    if (prev && prev.levelId !== state.levelId) {
      this.tween = null;
      this.surgeAt = 0;
    }
  }

  refuse() {
    this.shakeUntil = performance.now() + 180;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = w;
    this._cssH = h;
    this._fit();
  }

  _fit() {
    const state = this.state;
    if (!state) return;
    const w = this._cssW;
    const h = this._cssH;
    const marginX = Math.max(16, w * 0.06);
    const marginY = Math.max(18, h * 0.07);
    const cell = Math.floor(
      Math.min((w - marginX * 2) / state.width, (h - marginY * 2) / state.height),
    );
    const boardW = cell * state.width;
    const boardH = cell * state.height;
    this.layout = {
      x: Math.floor((w - boardW) / 2),
      y: Math.floor((h - boardH) / 2 + h * 0.01),
      cell,
      pad: Math.max(2, Math.floor(cell * 0.06)),
    };
  }

  cellAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { x: ox, y: oy, cell } = this.layout;
    if (!this.state || !cell) return null;
    const col = Math.floor((x - ox) / cell);
    const row = Math.floor((y - oy) / cell);
    if (row < 0 || col < 0 || row >= this.state.height || col >= this.state.width) return null;
    return { row, col };
  }

  draw(now = performance.now()) {
    this._lastNow = now;
    const ctx = this.ctx;
    const w = this._cssW;
    const h = this._cssH;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    this._drawBackdrop(ctx, w, h, now);
    if (!this.state) return;
    this._fit();

    let shakeX = 0;
    let shakeY = 0;
    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / 180;
      shakeX = Math.sin(now / 12) * 3.2 * k;
      shakeY = Math.cos(now / 11) * 2.2 * k;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this._drawYard(ctx, now);
    ctx.restore();
    this._drawVignette(ctx, w, h);
  }

  _drawBackdrop(ctx, w, h, now) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, PAL.sky0);
    g.addColorStop(1, PAL.sky1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const s of this.stars) {
      const tw = this.motion ? 0.55 + 0.45 * Math.sin(now / 700 + s.p) : 0.8;
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#dce7f5";
      ctx.fillRect(s.x * w, s.y * h * 0.55, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    this._drawGreenhouse(ctx, w, h, now);
  }

  _drawGreenhouse(ctx, w, h, now) {
    const complete = this.state && this.state.phase === "complete";
    const surge = this._surge(now);
    const lit = complete ? 0.25 + surge * 0.55 : 0.04;
    const paneH = Math.max(28, h * 0.11);
    const cols = 7;
    const pw = w / cols;
    for (let i = 0; i < cols; i += 1) {
      const x = i * pw + 4;
      const y = 8;
      ctx.fillStyle = complete
        ? `rgba(110, 190, 150, ${0.12 + lit * 0.35})`
        : "rgba(20, 40, 52, 0.55)";
      ctx.fillRect(x, y, pw - 8, paneH);
      ctx.strokeStyle = "rgba(90, 110, 120, 0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, pw - 8, paneH);
      ctx.beginPath();
      ctx.moveTo(x + (pw - 8) / 2, y);
      ctx.lineTo(x + (pw - 8) / 2, y + paneH);
      ctx.moveTo(x, y + paneH / 2);
      ctx.lineTo(x + pw - 8, y + paneH / 2);
      ctx.strokeStyle = "rgba(140, 160, 170, 0.2)";
      ctx.stroke();
      if (complete) {
        ctx.fillStyle = `rgba(180, 255, 210, ${0.08 + surge * 0.12})`;
        ctx.fillRect(x + 6, y + 6, pw - 20, paneH * 0.35);
      }
    }

    ctx.fillStyle = "rgba(12, 16, 22, 0.65)";
    ctx.fillRect(0, h - 18, w, 18);
    const pulse = this.motion ? 0.45 + 0.55 * Math.sin(now / 480) : 0.7;
    const srcX = w * 0.5;
    const srcY = h - 10;
    ctx.beginPath();
    ctx.arc(srcX, srcY, 5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 180, 70, ${0.35 + pulse * 0.4})`;
    ctx.fill();
    ctx.fillStyle = PAL.copper;
    ctx.fillRect(srcX - 28, srcY - 3, 56, 4);
  }

  _surge(now) {
    if (!this.surgeAt) return this.state && this.state.phase === "complete" ? 1 : 0;
    if (!this.motion) return 1;
    return Math.min(1, (now - this.surgeAt) / 900);
  }

  _undoFlash(now) {
    if (!this.undoAt) return 0;
    const t = (now - this.undoAt) / 280;
    if (t > 1) return 0;
    return 1 - t;
  }

  _drawYard(ctx, now) {
    const { x, y, cell } = this.layout;
    const { width, height, walls, goals, crates, player, phase } = this.state;
    const wallKeys = new Set(walls.map((c) => `${c.row},${c.col}`));
    const goalKeys = new Set(goals.map((c) => `${c.row},${c.col}`));
    const cratePos = this._cratePositions(now);
    const crateKeys = new Set(cratePos.map((c) => `${c.row},${c.col}`));
    const complete = phase === "complete";
    const surge = this._surge(now);
    const undo = this._undoFlash(now);

    ctx.save();
    ctx.translate(x, y);

    const bw = width * cell;
    const bh = height * cell;
    ctx.fillStyle = "#0c121a";
    roundRect(ctx, -cell * 0.18, -cell * 0.18, bw + cell * 0.36, bh + cell * 0.36, cell * 0.12);
    ctx.fill();

    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        if (wallKeys.has(`${r},${c}`)) continue;
        this._drawFloor(ctx, r, c, cell, now, complete, surge, undo, goalKeys.has(`${r},${c}`));
      }
    }

    for (const g of goals) {
      const occupied = crateKeys.has(`${g.row},${g.col}`);
      this._drawSocket(ctx, g.row, g.col, cell, occupied, now, surge);
    }

    this._drawTraces(ctx, width, height, wallKeys, goalKeys, crateKeys, cell, now, surge, undo);

    for (const wcell of walls) {
      this._drawWall(ctx, wcell.row, wcell.col, cell, now, complete, surge);
    }

    for (const crate of cratePos) {
      const onGoal = goalKeys.has(`${Math.round(crate.row)},${Math.round(crate.col)}`) ||
        goalKeys.has(`${crate.row | 0},${crate.col | 0}`) ||
        crate.powered;
      this._drawCore(ctx, crate.row, crate.col, cell, crate.powered || onGoal, now, complete);
    }

    const p = this._playerPos(now);
    this._drawRobot(ctx, p.row, p.col, cell, now, this.facing, this.tween && this.tween.crateFrom);

    if (complete) {
      ctx.fillStyle = `rgba(255, 210, 120, ${0.05 + surge * 0.08})`;
      ctx.fillRect(0, 0, bw, bh);
    }

    ctx.restore();
  }

  _playerPos(now) {
    const p = this.state.player;
    const tw = this.tween;
    if (!tw || !this.motion) return { row: p.row, col: p.col };
    const t = ease(Math.min(1, (now - tw.start) / tw.dur));
    if (t >= 1) return { row: p.row, col: p.col };
    return {
      row: lerp(tw.from.row, tw.to.row, t),
      col: lerp(tw.from.col, tw.to.col, t),
    };
  }

  _cratePositions(now) {
    const goalSet = new Set(this.state.goals.map((g) => `${g.row},${g.col}`));
    const tw = this.tween;
    return this.state.crates.map((c) => {
      let row = c.row;
      let col = c.col;
      if (tw && tw.crateFrom && tw.crateTo && this.motion) {
        if (c.row === tw.crateTo.row && c.col === tw.crateTo.col) {
          const t = ease(Math.min(1, (now - tw.start) / tw.dur));
          row = lerp(tw.crateFrom.row, tw.crateTo.row, t);
          col = lerp(tw.crateFrom.col, tw.crateTo.col, t);
        }
      }
      return { row, col, powered: goalSet.has(`${c.row},${c.col}`) };
    });
  }

  _drawFloor(ctx, r, c, cell, now, complete, surge, undo, isGoal) {
    const x = c * cell;
    const y = r * cell;
    const alt = (r + c) % 2 === 0;
    ctx.fillStyle = alt ? PAL.floor : PAL.floorAlt;
    ctx.fillRect(x, y, cell, cell);
    const n = hash(r, c);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fillRect(x + n * 6, y + 3, cell * 0.35, 1);
    if (complete) {
      ctx.fillStyle = `rgba(200, 160, 80, ${0.04 + surge * 0.08})`;
      ctx.fillRect(x, y, cell, cell);
    }
    if (undo > 0) {
      ctx.fillStyle = `rgba(90, 210, 220, ${undo * 0.12})`;
      ctx.fillRect(x, y, cell, cell);
    }
    ctx.strokeStyle = PAL.grout;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    if (!isGoal && n > 0.72) {
      ctx.strokeStyle = PAL.copperDim;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1, cell * 0.04);
      ctx.beginPath();
      ctx.moveTo(x + cell * 0.2, y + cell * 0.5);
      ctx.lineTo(x + cell * 0.8, y + cell * 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawTraces(ctx, width, height, wallKeys, goalKeys, crateKeys, cell, now, surge, undo) {
    const pulse = this.motion ? 0.5 + 0.5 * Math.sin(now / 520) : 0.65;
    ctx.lineCap = "round";
    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        if (wallKeys.has(`${r},${c}`)) continue;
        const poweredNear = goalKeys.has(`${r},${c}`) && crateKeys.has(`${r},${c}`);
        const glow = poweredNear ? 0.9 : 0.22 + pulse * 0.12 + surge * 0.45;
        const cx = c * cell + cell / 2;
        const cy = r * cell + cell / 2;
        ctx.strokeStyle = undo > 0
          ? `rgba(120, 220, 230, ${0.25 + undo * 0.4})`
          : `rgba(196, 132, 60, ${0.18 + glow * 0.35})`;
        ctx.lineWidth = Math.max(1.2, cell * 0.055);
        if (c + 1 < width && !wallKeys.has(`${r},${c + 1}`)) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + cell, cy);
          ctx.stroke();
        }
        if (r + 1 < height && !wallKeys.has(`${r + 1},${c}`)) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx, cy + cell);
          ctx.stroke();
        }
      }
    }
  }

  _drawSocket(ctx, r, c, cell, occupied, now, surge) {
    const cx = c * cell + cell / 2;
    const cy = r * cell + cell / 2;
    const rad = cell * 0.32;
    ctx.beginPath();
    ctx.arc(cx, cy, rad + 2, 0, Math.PI * 2);
    ctx.fillStyle = occupied ? "rgba(80, 40, 12, 0.9)" : "rgba(8, 10, 14, 0.85)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.strokeStyle = occupied ? PAL.copperHot : PAL.copper;
    ctx.lineWidth = Math.max(2, cell * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = occupied ? `rgba(255, 200, 110, ${0.7 + surge * 0.3})` : PAL.copperDim;
    ctx.lineWidth = Math.max(1.5, cell * 0.045);
    ctx.stroke();
    for (let i = 0; i < 4; i += 1) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rad * 0.78, cy + Math.sin(a) * rad * 0.78, cell * 0.045, 0, Math.PI * 2);
      ctx.fillStyle = occupied ? PAL.copperHot : PAL.copper;
      ctx.fill();
    }
    if (!occupied) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0d12";
      ctx.fill();
    } else {
      const pulse = this.motion ? 0.6 + 0.4 * Math.sin(now / 260) : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 230, 140, ${pulse})`;
      ctx.fill();
    }
  }

  _drawWall(ctx, r, c, cell, now, complete, surge) {
    const x = c * cell;
    const y = r * cell;
    const inset = Math.max(2, cell * 0.06);
    ctx.fillStyle = PAL.steelLo;
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = PAL.steel;
    ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
    ctx.fillStyle = PAL.steelHi;
    ctx.fillRect(x + inset, y + inset, cell - inset * 2, Math.max(2, cell * 0.12));
    const vents = 3;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < vents; i += 1) {
      ctx.fillRect(x + cell * 0.22, y + cell * 0.32 + i * cell * 0.14, cell * 0.56, cell * 0.045);
    }
    ctx.fillStyle = PAL.bolt;
    const b = Math.max(1.2, cell * 0.045);
    ctx.fillRect(x + inset + 2, y + inset + 2, b, b);
    ctx.fillRect(x + cell - inset - 2 - b, y + inset + 2, b, b);
    const led = hash(r, c);
    if (led > 0.55) {
      const on = complete || (this.motion ? Math.sin(now / 420 + led * 10) > 0.15 : true);
      ctx.beginPath();
      ctx.arc(x + cell * 0.78, y + cell * 0.78, cell * 0.055, 0, Math.PI * 2);
      ctx.fillStyle = on ? PAL.amber : "#3a2a12";
      ctx.fill();
      if (complete) {
        ctx.globalAlpha = 0.35 + surge * 0.3;
        ctx.beginPath();
        ctx.arc(x + cell * 0.78, y + cell * 0.78, cell * 0.12, 0, Math.PI * 2);
        ctx.fillStyle = PAL.amber;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  _drawCore(ctx, row, col, cell, powered, now, complete) {
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    const w = cell * 0.58;
    const h = cell * 0.62;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.55, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    body.addColorStop(0, powered ? "#3d5a58" : PAL.glassCore);
    body.addColorStop(0.5, powered ? "#1c3334" : "#1a2a32");
    body.addColorStop(1, "#0e161c");
    roundRect(ctx, -w / 2, -h / 2, w, h, cell * 0.08);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = powered ? PAL.copperHot : PAL.copper;
    ctx.lineWidth = Math.max(2, cell * 0.055);
    ctx.strokeRect(-w / 2, -h * 0.18, w, h * 0.14);
    ctx.strokeRect(-w / 2, h * 0.08, w, h * 0.14);
    if (powered) {
      const pulse = this.motion ? 0.55 + 0.45 * Math.sin(now / 240) : 0.85;
      ctx.fillStyle = `rgba(255, 196, 90, ${0.35 + pulse * 0.35})`;
      roundRect(ctx, -w * 0.18, -h * 0.28, w * 0.36, h * 0.55, 3);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(180, 200, 210, 0.12)";
      ctx.fillRect(-w * 0.12, -h * 0.28, w * 0.1, h * 0.5);
    }
    ctx.fillStyle = PAL.copper;
    ctx.fillRect(-w * 0.12, h / 2 - 2, w * 0.24, 4);
    if (complete && powered) {
      ctx.strokeStyle = `rgba(255, 220, 140, 0.45)`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawRobot(ctx, row, col, cell, now, facing, pushing) {
    const cx = col * cell + cell / 2;
    const idle = this.motion && !pushing ? Math.sin(now / 380) * cell * 0.035 : 0;
    const cy = row * cell + cell / 2 + idle;
    const relief = this.seatAt && now - this.seatAt < 420;
    ctx.save();
    ctx.translate(cx, cy);
    const rot = { up: -Math.PI / 2, right: 0, down: Math.PI / 2, left: Math.PI }[facing] || 0;
    ctx.rotate(rot);
    const lean = pushing && this.motion ? cell * 0.04 : 0;
    ctx.translate(lean, 0);

    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(0, cell * 0.22, cell * 0.28, cell * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PAL.tread;
    roundRect(ctx, -cell * 0.28, -cell * 0.16, cell * 0.1, cell * 0.32, 2);
    ctx.fill();
    roundRect(ctx, cell * 0.18, -cell * 0.16, cell * 0.1, cell * 0.32, 2);
    ctx.fill();

    ctx.fillStyle = PAL.bodyShade;
    roundRect(ctx, -cell * 0.2, -cell * 0.18, cell * 0.4, cell * 0.36, cell * 0.08);
    ctx.fill();
    ctx.fillStyle = PAL.body;
    roundRect(ctx, -cell * 0.18, -cell * 0.2, cell * 0.36, cell * 0.3, cell * 0.08);
    ctx.fill();

    ctx.fillStyle = PAL.copper;
    ctx.fillRect(-cell * 0.04, -cell * 0.32, cell * 0.08, cell * 0.12);
    ctx.beginPath();
    ctx.arc(0, -cell * 0.34, cell * 0.045, 0, Math.PI * 2);
    const blink = this.motion ? 0.5 + 0.5 * Math.sin(now / 320) : 0.8;
    ctx.fillStyle = `rgba(255, 180, 80, ${0.5 + blink * 0.5})`;
    ctx.fill();

    ctx.fillStyle = relief ? "#7dffd4" : PAL.visor;
    roundRect(ctx, cell * 0.02, -cell * 0.12, cell * 0.18, cell * 0.2, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cell * 0.06, -cell * 0.1, cell * 0.1, cell * 0.05);

    ctx.fillStyle = PAL.copperDim;
    ctx.fillRect(-cell * 0.08, cell * 0.08, cell * 0.16, cell * 0.05);

    ctx.restore();
  }

  _drawVignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h * 0.55, w * 0.2, w / 2, h * 0.5, w * 0.85);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, PAL.night);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
