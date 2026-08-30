(() => {
  "use strict";

  const STEP = 1000 / 60;
  const PREVIEW = 520;
  const WORLD_WIDTH = 100;
  const MAX_TIME = 22000;
  const canvas = document.querySelector("#stage");
  const ctx = canvas.getContext("2d");
  const ui = {
    ready: document.querySelector("#ready"), end: document.querySelector("#gameover"),
    depth: document.querySelector("#depth"), time: document.querySelector("#time"),
    fill: document.querySelector("#time-fill"), clock: document.querySelector("#clock"),
    rank: document.querySelector("#rank"), final: document.querySelector("#final-score"),
    best: document.querySelector("#best-score"), signature: document.querySelector("#signature"),
    restart: document.querySelector("#restart"), toast: document.querySelector("#toast"),
    stick: document.querySelector("#stick"), sound: document.querySelector("#sound")
  };

  let dpr = 1, W = 0, H = 0, scale = 1;
  let state, accumulator = 0, lastFrame = 0, bestScore = 0;
  let pointer = null;
  let muted = false;
  const particles = [];
  const view = { shake: 0, flash: 0, graze: 0, grazeSide: 0 };

  class RNG {
    constructor(seed) { this.s = (Number(seed) >>> 0) || 0x6d2b79f5; }
    next() {
      let t = this.s += 0x6d2b79f5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
    pick(a) { return a[Math.floor(this.next() * a.length)]; }
  }

  const audio = {
    ctx: null, engine: null, gain: null, edge: null,
    start() {
      if (muted || this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.gain.value = .16;
      master.connect(this.ctx.destination);
      this.master = master;
      this.engine = this.ctx.createOscillator();
      this.engine.type = "sawtooth";
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass"; filter.frequency.value = 220;
      this.engine.connect(filter).connect(this.gain).connect(master);
      this.engine.start();
      this.edge = this.ctx.createOscillator();
      this.edge.type = "sine";
      this.edgeGain = this.ctx.createGain();
      this.edgeGain.gain.value = 0;
      this.edge.connect(this.edgeGain).connect(master);
      this.edge.start();
    },
    update() {
      if (!this.ctx || !state) return;
      const now = this.ctx.currentTime;
      const p = state.speed / state.maxSpeed;
      this.engine.frequency.setTargetAtTime(42 + p * 76, now, .05);
      this.gain.gain.setTargetAtTime(state.phase === "playing" ? .18 + p * .17 : 0, now, .08);
      this.edge.frequency.setTargetAtTime(420 + p * 310 + state.nearChain * 65, now, .04);
      this.edgeGain.gain.setTargetAtTime(p > .76 ? .025 + state.nearChain * .014 : 0, now, .1);
    },
    tone(freq, duration, type = "sine", volume = .18, slide = 1) {
      if (!this.ctx || muted) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
      o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + duration);
      g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(.001, t + duration);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + duration);
    },
    event(kind) {
      if (kind === "fragment") { this.tone(620, .12, "sine", .17, 1.5); this.tone(930, .16, "triangle", .09, 1.12); }
      if (kind === "power") { [0, 1, 2].forEach((n) => setTimeout(() => this.tone(260 * (1 + n * .5), .23, "square", .1, 1.7), n * 65)); }
      if (kind === "rock_hit" || kind === "wall_contact") this.tone(95, .32, "sawtooth", .28, .35);
      if (kind === "rock_broken") this.tone(140, .17, "square", .16, .6);
      if (kind === "near_miss") this.tone(480 + state.nearChain * 70, .13, "sine", .1, 1.7);
      if (kind === "gameover") { this.tone(210, .7, "triangle", .2, .42); this.tone(105, .9, "sine", .12, .5); }
    }
  };

  function newState(seed) {
    const rng = new RNG(seed);
    const s = {
      phase: "ready", tick: 0, elapsedMs: 0, timeMs: 0, remainingMs: 18000,
      seed: Number(seed) >>> 0, rng, spawnIndex: 0, difficulty: 1, score: 0, scoreExact: 0, depth: 0,
      x: 50, playerRadius: 3.2, speed: 0, maxSpeed: 46, minSpeed: 8.5, lateralV: 0,
      input: { accelerate: false, left: false, right: false, steer: 0 },
      hits: 0, wallContacts: 0, fragmentsCollected: 0, rocksBroken: 0,
      invincibleUntilMs: 0, rank: null, rocks: [], items: [], events: [], eventSeq: 0,
      course: [{ depth: -100, x: 50 }, { depth: 0, x: 50 }, { depth: 82, x: 48 }],
      generatedTo: 0, nextEntityDepth: 105, id: 1, formationId: 1,
      wallCooldown: 0, hitCooldown: 0, nearChain: 0, lastNearMs: -9999,
      fullThrottleMs: 0, longestThrottleMs: 0, closestShave: null, endDelay: 0
    };
    return s;
  }

  function reset(seed = state ? state.seed : 73421) {
    state = newState(seed);
    accumulator = 0; particles.length = 0;
    view.shake = view.flash = view.graze = 0;
    ensureCourse(PREVIEW + 200);
    ensureEntities(PREVIEW);
    ui.ready.hidden = false; ui.end.hidden = true; ui.toast.className = "toast";
    updateUI();
    return snapshot();
  }

  function ensureCourse(target) {
    while (state.course[state.course.length - 1].depth < target) {
      const prev = state.course[state.course.length - 1];
      const difficulty = 1 + prev.depth / 1500;
      const spacing = Math.max(58, 84 - difficulty * 4);
      let delta;
      if (state.rng.next() < .2) delta = state.rng.range(-4, 4);
      else delta = state.rng.range(-17, 17) * Math.min(1.15, .72 + difficulty * .16);
      const x = clamp(prev.x + delta, 31, 69);
      state.course.push({ depth: prev.depth + spacing, x });
    }
  }

  function centerAt(depth) {
    ensureCourse(depth + 90);
    let i = 0;
    while (i < state.course.length - 2 && state.course[i + 1].depth < depth) i++;
    const a = state.course[i], b = state.course[i + 1];
    const t = clamp((depth - a.depth) / (b.depth - a.depth), 0, 1);
    const smooth = t * t * (3 - 2 * t);
    return a.x + (b.x - a.x) * smooth;
  }

  function halfWidthAt(depth) {
    return 27 - Math.min(3.5, depth / 1700) + Math.sin(depth * .013 + state.seed) * 1.1;
  }

  function addRock(x, depth, r) {
    state.rocks.push({ id: state.id++, x, depth, visualRadius: r, collisionRadius: r * .84, active: true, passed: false });
    state.spawnIndex++;
  }

  function addItem(type, x, depth, formationId = null, kind = null, index = null) {
    state.items.push({ id: state.id++, type, x, depth, visualRadius: type === "power" ? 4.1 : 2.35, collisionRadius: type === "power" ? 3.2 : 2.15, active: true, formationId, formationKind: kind, formationIndex: index });
    state.spawnIndex++;
  }

  function ensureEntities(target) {
    ensureCourse(target + 180);
    while (state.nextEntityDepth < target + 150) {
      const base = state.nextEntityDepth;
      const c = centerAt(base), hw = halfWidthAt(base);
      const laneOffset = state.rng.range(-9, 9);
      const safeX = clamp(c + laneOffset, c - hw + 7, c + hw - 7);
      const kind = state.rng.pick(["line", "chevron", "sweep", "triangle"]);
      const fid = state.formationId++;
      const count = kind === "triangle" ? 5 : 4 + (state.rng.next() < .35 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const d = base + 12 + i * 9;
        let off = 0;
        if (kind === "line") off = (i - (count - 1) / 2) * 1.2;
        if (kind === "chevron") off = -Math.abs(i - (count - 1) / 2) * 3.1 + 5;
        if (kind === "sweep") off = (i - (count - 1) / 2) * 3.2;
        if (kind === "triangle") off = [0, -2.8, 2.8, -1.4, 1.4][i];
        addItem("fragment", clamp(safeX + off, centerAt(d) - halfWidthAt(d) + 5, centerAt(d) + halfWidthAt(d) - 5), d, fid, kind, i);
      }
      const pressure = Math.min(3, 1 + base / 1000);
      const rocks = 1 + (state.rng.next() < .45 + pressure * .08 ? 1 : 0);
      for (let i = 0; i < rocks; i++) {
        const d = base + state.rng.range(3, 58);
        const cc = centerAt(d), hh = halfWidthAt(d);
        const side = state.rng.next() < .5 ? -1 : 1;
        const r = state.rng.range(4.2, 7.3 + Math.min(2, base / 1200));
        let x = cc + side * state.rng.range(9.5, hh - r - 1);
        if (Math.abs(x - safeX) < r + 6.5) x = cc - side * Math.min(hh - r - 1, 14);
        addRock(x, d, r);
      }
      if ((base > 610 && !state.items.some(i => i.type === "power")) || (base > 610 && state.rng.next() < .055)) {
        addItem("power", safeX, base + 39);
      }
      state.nextEntityDepth += state.rng.range(103, 132);
      state.generatedTo = state.nextEntityDepth;
    }
    state.rocks.sort((a, b) => a.id - b.id);
    state.items.sort((a, b) => a.id - b.id);
  }

  function emit(kind) {
    const e = { seq: ++state.eventSeq, kind, tick: state.tick };
    state.events.push(e);
    if (state.events.length > 160) state.events.shift();
    audio.event(kind);
    return e;
  }

  function startIfNeeded() {
    if (state.phase === "ready" && state.input.accelerate) {
      state.phase = "playing"; state.speed = state.minSpeed;
      ui.ready.hidden = true;
    }
  }

  function impact(kind, x, powered = false) {
    if (!powered) {
      state.speed = state.minSpeed;
      state.lateralV *= -.25;
      view.shake = kind === "wall_contact" ? 9 : 13;
      view.flash = .8;
      if (kind === "rock_hit") state.hits++; else state.wallContacts++;
    } else {
      view.shake = 5; view.flash = .35;
    }
    emit(kind);
    burst(x, state.depth + 3, powered ? "#72f1c2" : "#ffba49", powered ? 12 : 18);
  }

  function updateStep() {
    if (state.phase !== "playing") return;
    const dt = STEP / 1000;
    state.tick++; state.elapsedMs = state.tick * STEP; state.timeMs = state.elapsedMs;
    state.remainingMs -= STEP;
    state.difficulty = 1 + state.depth / 1300;
    state.wallCooldown = Math.max(0, state.wallCooldown - STEP);
    state.hitCooldown = Math.max(0, state.hitCooldown - STEP);
    if (state.timeMs - state.lastNearMs > 2600) state.nearChain = 0;

    const accel = state.input.accelerate;
    if (accel) state.speed = Math.min(state.maxSpeed, state.speed + 29 * dt);
    else state.speed = Math.max(state.minSpeed, state.speed - 12.5 * dt);
    const speedP = state.speed / state.maxSpeed;
    const steer = state.input.steer || ((state.input.right ? 1 : 0) - (state.input.left ? 1 : 0));
    const authority = 1 - .7 * Math.pow(speedP, 1.25);
    const lateralTarget = steer * 35 * authority;
    state.lateralV += (lateralTarget - state.lateralV) * Math.min(1, dt * (accel ? 3.4 : 6.5));
    state.x += state.lateralV * dt;
    const depthStep = state.speed * dt;
    state.depth += depthStep;
    state.scoreExact += depthStep * (6.5 + Math.min(2.5, speedP * 2.5));
    state.score = Math.floor(state.scoreExact);

    if (accel && speedP > .965) {
      state.fullThrottleMs += STEP;
      state.longestThrottleMs = Math.max(state.longestThrottleMs, state.fullThrottleMs);
    } else state.fullThrottleMs = 0;

    ensureEntities(state.depth + PREVIEW);
    const c = centerAt(state.depth), hw = halfWidthAt(state.depth);
    const left = c - hw + state.playerRadius, right = c + hw - state.playerRadius;
    if (state.x < left || state.x > right) {
      state.x = clamp(state.x, left, right);
      if (!state.wallCooldown) {
        impact("wall_contact", state.x); state.wallCooldown = 430;
      }
    }

    const powered = state.timeMs < state.invincibleUntilMs;
    for (const rock of state.rocks) {
      if (!rock.active || Math.abs(rock.depth - state.depth) > 14) continue;
      const dx = rock.x - state.x, dd = rock.depth - state.depth;
      const dist = Math.hypot(dx, dd), hit = rock.collisionRadius + state.playerRadius;
      if (dist <= hit && !state.hitCooldown) {
        rock.active = false; rock.passed = true; state.rocksBroken++;
        if (powered) {
          state.remainingMs = Math.min(MAX_TIME, state.remainingMs + 1050);
          impact("rock_broken", rock.x, true); showToast("CRUSH +1.0");
        } else {
          impact("rock_hit", rock.x); state.hitCooldown = 250;
        }
      }
    }
    for (const rock of state.rocks) {
      if (!rock.active || rock.passed || rock.depth >= state.depth - state.playerRadius) continue;
      rock.passed = true;
      const gap = Math.abs(rock.x - state.x) - rock.collisionRadius - state.playerRadius;
      if (gap >= 0 && gap < state.playerRadius * 2) {
        state.closestShave = state.closestShave == null ? gap : Math.min(state.closestShave, gap);
        state.nearChain = state.timeMs - state.lastNearMs < 2500 ? state.nearChain + 1 : 1;
        state.lastNearMs = state.timeMs; view.graze = Math.min(1.6, .5 + state.nearChain * .2);
        view.grazeSide = Math.sign(state.x - rock.x); view.shake = Math.max(view.shake, 2 + state.nearChain);
        emit("near_miss"); showToast(state.nearChain > 1 ? `EDGE x${state.nearChain}` : "CLOSE SHAVE");
      }
    }
    for (const item of state.items) {
      if (!item.active || Math.abs(item.depth - state.depth) > 11) continue;
      if (Math.hypot(item.x - state.x, item.depth - state.depth) <= item.collisionRadius + state.playerRadius) {
        item.active = false;
        if (item.type === "fragment") {
          state.fragmentsCollected++; state.remainingMs = Math.min(MAX_TIME, state.remainingMs + 2200);
          emit("fragment"); burst(item.x, item.depth, "#72f1c2", 9); showToast("+2.2 SECONDS");
        } else {
          state.invincibleUntilMs = state.timeMs + 6200; emit("power");
          burst(item.x, item.depth, "#ffba49", 24); showToast("STARDRILL ONLINE");
        }
      }
    }
    state.remainingMs = Math.max(0, state.remainingMs);
    if (state.remainingMs <= 0) gameOver();
    pruneEntities();
  }

  function gameOver() {
    state.phase = "gameover"; state.rank = rankFor(state.score);
    state.speed = 0; state.lateralV = 0;
    bestScore = Math.max(bestScore, state.score);
    audio.event("gameover");
    setTimeout(() => {
      if (state.phase !== "gameover") return;
      ui.rank.textContent = state.rank; ui.final.textContent = state.score.toLocaleString();
      ui.best.textContent = bestScore.toLocaleString();
      ui.signature.textContent = state.closestShave == null ? "NO GRAZES" : `${state.closestShave.toFixed(2)}m`;
      ui.end.hidden = false;
    }, 480);
  }

  function rankFor(score) {
    if (score >= 30000) return "S";
    if (score >= 18500) return "A";
    if (score >= 10500) return "B";
    if (score >= 5000) return "C";
    return "D";
  }

  function pruneEntities() {
    const cutoff = state.depth - 90;
    state.rocks = state.rocks.filter(e => e.depth > cutoff);
    state.items = state.items.filter(e => e.depth > cutoff);
    while (state.course.length > 4 && state.course[2].depth < cutoff) state.course.shift();
  }

  function advance(ms) {
    if (state.phase !== "playing" || !Number.isFinite(ms) || ms <= 0) return snapshot();
    let total = accumulator + ms;
    const steps = Math.floor((total + 1e-8) / STEP);
    accumulator = total - steps * STEP;
    for (let i = 0; i < steps && state.phase === "playing"; i++) updateStep();
    return snapshot();
  }

  function round(n) { return Math.round(n * 1000) / 1000; }
  function snapshot() {
    const from = state.depth - 10, to = state.depth + PREVIEW;
    const walls = [];
    for (let d = Math.floor(from / 26) * 26; d <= to + 26; d += 26) {
      const c = centerAt(d), h = halfWidthAt(d);
      walls.push({ depth: round(d), leftX: round(c - h), rightX: round(c + h) });
    }
    const visibleRocks = state.rocks.filter(e => e.depth >= from && e.depth <= to).map(e => ({
      id: e.id, position: { x: round(e.x), depth: round(e.depth) }, active: e.active,
      visualRadius: round(e.visualRadius), collisionRadius: round(e.collisionRadius)
    })).sort((a, b) => a.id - b.id);
    const visibleItems = state.items.filter(e => e.depth >= from && e.depth <= to).map(e => {
      const out = { id: e.id, type: e.type, position: { x: round(e.x), depth: round(e.depth) }, active: e.active, visualRadius: round(e.visualRadius), collisionRadius: round(e.collisionRadius) };
      if (e.type === "fragment") Object.assign(out, { formationId: e.formationId, formationKind: e.formationKind, formationIndex: e.formationIndex });
      return out;
    }).sort((a, b) => a.id - b.id);
    let safe = Infinity;
    for (let d = state.depth; d <= to; d += 24) safe = Math.min(safe, halfWidthAt(d));
    for (const r of visibleRocks.filter(r => r.active)) safe = Math.min(safe, halfWidthAt(r.position.depth) - r.visualRadius);
    safe = Math.max(state.playerRadius + 1, safe);
    const lastEvent = state.events.length ? state.events[state.events.length - 1] : null;
    return {
      phase: state.phase, tick: state.tick, elapsedMs: round(state.elapsedMs), timeMs: round(state.timeMs),
      remainingMs: round(state.remainingMs), seed: state.seed, rngState: state.rng.s >>> 0,
      spawnIndex: state.spawnIndex, input: { ...state.input }, difficulty: round(state.difficulty),
      score: state.score, depth: round(state.depth), x: round(state.x), playerRadius: state.playerRadius,
      speed: round(state.speed), maxSpeed: state.maxSpeed, hits: state.hits, wallContacts: state.wallContacts,
      fragmentsCollected: state.fragmentsCollected, rocksBroken: state.rocksBroken,
      invincibleUntilMs: round(state.invincibleUntilMs), rank: state.rank,
      courseCenterX: round(centerAt(state.depth)), corridorHalfWidth: round(halfWidthAt(state.depth)),
      walls, safeHalfWidth: round(safe), previewMs: round(PREVIEW / state.maxSpeed * 1000),
      rocks: visibleRocks, items: visibleItems, events: state.events.map(e => ({ ...e })),
      lastEvent: lastEvent ? { ...lastEvent } : null
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, innerWidth); H = Math.max(1, innerHeight);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = W / WORLD_WIDTH;
  }

  function worldToScreen(x, depth) {
    const horizonY = Math.min(H * .29, 180);
    const playerY = H * .72;
    const ahead = depth - state.depth;
    const visibleDepth = Math.max(250, H / Math.max(1, scale) * 2.6);
    const y = playerY - ahead / visibleDepth * (playerY - horizonY);
    const perspective = .72 + .28 * clamp((y - horizonY) / Math.max(1, playerY - horizonY), 0, 1);
    return { x: W / 2 + (x - centerAt(state.depth)) * scale * perspective, y, p: perspective };
  }

  function draw() {
    ctx.save();
    const shake = view.shake;
    if (shake > .1) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    drawCorridor();
    drawEntities();
    drawPlayer();
    drawEffects();
    ctx.restore();
    view.shake *= .84; view.flash *= .87; view.graze *= .9;
    updateUI(); audio.update();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#02080d"); g.addColorStop(.42, "#07171d"); g.addColorStop(1, "#10282b");
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    const t = state ? state.depth : 0;
    for (let layer = 0; layer < 3; layer++) {
      ctx.globalAlpha = .08 + layer * .025; ctx.fillStyle = layer === 2 ? "#72f1c2" : "#83a49b";
      for (let i = 0; i < 14; i++) {
        const x = ((i * 79 + layer * 43 + state.seed) % (W + 80)) - 40;
        const y = ((i * 137 + t * (.15 + layer * .12)) % (H + 100)) - 50;
        ctx.beginPath(); ctx.arc(x, y, 1 + layer, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function wallPath(side) {
    const playerY = H * .72, far = state.depth + Math.max(PREVIEW, 700);
    const pts = [];
    for (let d = far; d >= state.depth - 50; d -= 12) {
      const c = centerAt(d), h = halfWidthAt(d);
      pts.push(worldToScreen(c + side * h, d));
    }
    ctx.beginPath();
    ctx.moveTo(side < 0 ? -30 : W + 30, -30);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(side < 0 ? -30 : W + 30, H + 30);
    ctx.closePath();
  }

  function drawCorridor() {
    for (const side of [-1, 1]) {
      wallPath(side);
      const g = ctx.createLinearGradient(side < 0 ? 0 : W, 0, W / 2, 0);
      g.addColorStop(0, "#132a2d"); g.addColorStop(.72, "#1c3636"); g.addColorStop(1, "#314b42");
      ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = "#496156"; ctx.lineWidth = 1.4; ctx.globalAlpha = .45;
      const drift = state.depth * .75;
      for (let y = -80 + (drift % 52); y < H + 80; y += 52) {
        ctx.beginPath();
        for (let x = -40; x < W + 40; x += 30) {
          const yy = y + Math.sin(x * .045 + y) * 8;
          x === -40 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
      const far = state.depth + 650;
      ctx.beginPath();
      for (let d = far, first = true; d >= state.depth - 25; d -= 10) {
        const c = centerAt(d), h = halfWidthAt(d), p = worldToScreen(c + side * h, d);
        first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); first = false;
      }
      ctx.strokeStyle = "#8cb493"; ctx.lineWidth = 2; ctx.globalAlpha = .7; ctx.stroke(); ctx.globalAlpha = 1;
    }
    const speedP = state.speed / state.maxSpeed;
    if (speedP > .68 && state.phase === "playing") {
      ctx.strokeStyle = `rgba(114,241,194,${(speedP - .68) * .45})`; ctx.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const x = (i * 97 + state.tick * 11) % W;
        const y = (i * 71 + state.tick * state.speed * .18) % H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18 - speedP * 38); ctx.stroke();
      }
    }
  }

  function drawEntities() {
    const list = [];
    for (const r of state.rocks) if (r.active && r.depth > state.depth - 15 && r.depth < state.depth + PREVIEW) list.push({ e: r, type: "rock" });
    for (const i of state.items) if (i.active && i.depth > state.depth - 15 && i.depth < state.depth + PREVIEW) list.push({ e: i, type: i.type });
    list.sort((a, b) => b.e.depth - a.e.depth);
    for (const { e, type } of list) {
      const p = worldToScreen(e.x, e.depth), r = e.visualRadius * scale * p.p;
      if (p.y < -30 || p.y > H + 30) continue;
      if (type === "rock") drawRock(p.x, p.y, r, e.id);
      else if (type === "fragment") drawFragment(p.x, p.y, r, e.id);
      else drawPower(p.x, p.y, r);
    }
  }

  function drawRock(x, y, r, id) {
    ctx.save(); ctx.translate(x, y); ctx.rotate((id * 2.17 + state.depth * .004) % 6.28);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, rr = r * (.78 + ((id * (i + 3) * 17) % 19) / 70);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * .35, -r * .4, 0, 0, 0, r);
    g.addColorStop(0, "#9b8967"); g.addColorStop(.42, "#5c5948"); g.addColorStop(1, "#292f2d");
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = "#b9a477"; ctx.lineWidth = Math.max(1, r * .07); ctx.stroke();
    ctx.fillStyle = "#202826"; ctx.globalAlpha = .7;
    ctx.beginPath(); ctx.arc(r * .18, -r * .12, r * .18, 0, 6.28); ctx.arc(-r * .28, r * .23, r * .1, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function drawFragment(x, y, r, id) {
    const pulse = 1 + Math.sin(state.tick * .12 + id) * .09;
    ctx.save(); ctx.translate(x, y); ctx.rotate(state.tick * .018 + id); ctx.scale(pulse, pulse);
    ctx.shadowColor = "#72f1c2"; ctx.shadowBlur = r * 1.8; ctx.fillStyle = "#72f1c2";
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .67, 0); ctx.lineTo(0, r); ctx.lineTo(-r * .67, 0); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = "#e6ffe8";
    ctx.beginPath(); ctx.moveTo(0, -r * .62); ctx.lineTo(r * .24, 0); ctx.lineTo(0, r * .22); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawPower(x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-state.tick * .025);
    ctx.shadowColor = "#ffba49"; ctx.shadowBlur = r * 2.8; ctx.strokeStyle = "#ffba49"; ctx.lineWidth = Math.max(2, r * .18);
    for (let i = 0; i < 3; i++) {
      ctx.rotate(Math.PI * 2 / 3); ctx.beginPath(); ctx.moveTo(0, -r * 1.15); ctx.quadraticCurveTo(r * .85, -r * .4, 0, r * .25); ctx.stroke();
    }
    ctx.fillStyle = "#fff4bd"; ctx.beginPath(); ctx.arc(0, 0, r * .34, 0, 6.28); ctx.fill(); ctx.restore();
  }

  function drawPlayer() {
    const p = worldToScreen(state.x, state.depth), speedP = state.speed / state.maxSpeed;
    const powered = state.timeMs < state.invincibleUntilMs;
    const size = clamp(W * .055, 19, 29);
    const readyBob = state.phase === "ready" ? Math.sin(performance.now() * .005) * 2.5 : 0;
    ctx.save(); ctx.translate(p.x, p.y + readyBob);
    const tilt = clamp(state.lateralV / 30, -1, 1) * .28 + view.grazeSide * view.graze * .09;
    ctx.rotate(tilt);
    if (powered) {
      ctx.strokeStyle = `rgba(255,186,73,${.45 + Math.sin(state.tick * .2) * .2})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, size * 1.35 + Math.sin(state.tick * .18) * 3, 0, 6.28); ctx.stroke();
    }
    if (state.phase === "playing") {
      const flame = 9 + speedP * 25;
      const fg = ctx.createLinearGradient(0, -size, 0, -size - flame);
      fg.addColorStop(0, powered ? "#ffba49" : "#72f1c2"); fg.addColorStop(1, "transparent");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(-size * .38, -size * .52); ctx.quadraticCurveTo(0, -size - flame * (1 + Math.sin(state.tick * .6) * .12), size * .38, -size * .52); ctx.closePath(); ctx.fill();
    }
    const squash = view.flash * .22;
    ctx.scale(1 + squash, 1 - squash);
    ctx.fillStyle = "#173c41"; ctx.strokeStyle = powered ? "#ffcf63" : "#9bd8be"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, size * 1.12); ctx.bezierCurveTo(size * .75, size * .62, size * .78, -size * .52, 0, -size * .86); ctx.bezierCurveTo(-size * .78, -size * .52, -size * .75, size * .62, 0, size * 1.12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#254f51"; ctx.beginPath(); ctx.ellipse(0, -size * .28, size * .57, size * .39, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = state.phase === "gameover" ? "#506d68" : powered ? "#ffd65b" : speedP > .78 ? "#ffba49" : "#72f1c2";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.ellipse(0, -size * .28, size * .39, size * .25, 0, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "#07191e";
    let eyeY = -size * .28, eyeX = size * .13;
    if (state.phase === "gameover") { eyeY += 3; eyeX = size * .15; }
    if (view.graze > .2) eyeX += view.grazeSide * size * .08;
    ctx.beginPath(); ctx.arc(-eyeX, eyeY, size * .055, 0, 6.28); ctx.arc(eyeX, eyeY, size * .055, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "#ffba49"; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const x = i * size * .22, y = size * (.63 + Math.abs(i) * .12);
      i === -2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function burst(x, depth, color, count) {
    const p = worldToScreen(x, depth);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 4;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color, r: 1 + Math.random() * 3 });
    }
  }

  function drawEffects() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.x += p.vx; p.y += p.vy; p.vy += .05; p.life -= .035;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
    if (view.flash > .02) {
      ctx.fillStyle = `rgba(255,186,73,${view.flash * .13})`; ctx.fillRect(0, 0, W, H);
    }
    if (state.timeMs < state.invincibleUntilMs) {
      const left = Math.max(0, (state.invincibleUntilMs - state.timeMs) / 6200);
      ctx.strokeStyle = `rgba(255,186,73,${.15 + left * .2})`; ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, W - 5, H - 5);
    }
  }

  function updateUI() {
    ui.depth.textContent = String(Math.floor(state.depth)).padStart(4, "0");
    ui.time.textContent = (state.remainingMs / 1000).toFixed(1);
    ui.fill.style.width = `${clamp(state.remainingMs / MAX_TIME * 100, 0, 100)}%`;
    ui.clock.classList.toggle("danger", state.phase === "playing" && state.remainingMs < 5000);
  }

  function showToast(text) {
    ui.toast.textContent = text; ui.toast.className = "toast";
    void ui.toast.offsetWidth; ui.toast.className = "toast show";
  }

  function setKey(code, down) {
    if (["ArrowDown", "Space", "ArrowLeft", "ArrowRight"].includes(code)) {
      if (code === "ArrowDown" || code === "Space") state.input.accelerate = down;
      if (code === "ArrowLeft") state.input.left = down;
      if (code === "ArrowRight") state.input.right = down;
      state.input.steer = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
      if (down) { audio.start(); startIfNeeded(); }
    }
  }

  document.addEventListener("keydown", e => {
    if (["ArrowDown", "Space", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "KeyR") { e.preventDefault(); audio.start(); reset(state.seed); return; }
    setKey(e.code, true);
  }, { passive: false });
  document.addEventListener("keyup", e => { setKey(e.code, false); }, { passive: false });
  window.addEventListener("blur", () => {
    if (!state) return;
    Object.assign(state.input, { accelerate: false, left: false, right: false, steer: 0 });
  });

  function pointerDown(e) {
    if (e.target === ui.sound || e.target === ui.restart) return;
    e.preventDefault(); audio.start();
    if (state.phase === "gameover") { reset(state.seed); return; }
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    ui.stick.hidden = false; ui.stick.style.left = e.clientX + "px"; ui.stick.style.top = e.clientY + "px";
  }
  function pointerMove(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    state.input.steer = clamp(dx / 42, -1, 1);
    state.input.left = state.input.steer < -.12; state.input.right = state.input.steer > .12;
    state.input.accelerate = dy > 18;
    const knob = ui.stick.firstElementChild;
    knob.style.transform = `translate(${clamp(dx, -28, 28)}px,${clamp(dy, -28, 28)}px)`;
    startIfNeeded();
  }
  function pointerUp(e) {
    if (!pointer || pointer.id !== e.pointerId) return;
    pointer = null; Object.assign(state.input, { accelerate: false, left: false, right: false, steer: 0 });
    ui.stick.hidden = true; ui.stick.firstElementChild.style.transform = "";
  }
  canvas.addEventListener("pointerdown", pointerDown, { passive: false });
  canvas.addEventListener("pointermove", pointerMove, { passive: false });
  canvas.addEventListener("pointerup", pointerUp, { passive: false });
  canvas.addEventListener("pointercancel", pointerUp, { passive: false });
  ui.restart.addEventListener("click", e => { e.stopPropagation(); audio.start(); reset(state.seed); });
  ui.end.addEventListener("click", () => { audio.start(); reset(state.seed); });
  ui.sound.addEventListener("click", e => {
    e.stopPropagation(); muted = !muted; ui.sound.classList.toggle("muted", muted);
    if (!muted) audio.start();
    if (audio.master) audio.master.gain.value = muted ? 0 : .16;
  });

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    const delta = Math.min(100, now - lastFrame); lastFrame = now;
    if (state.phase === "playing") advance(delta);
    draw();
    requestAnimationFrame(frame);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  window.__ARENA_GAME__ = { reset, snapshot, advance };
  window.addEventListener("resize", resize);
  resize(); reset(73421); requestAnimationFrame(frame);
})();
