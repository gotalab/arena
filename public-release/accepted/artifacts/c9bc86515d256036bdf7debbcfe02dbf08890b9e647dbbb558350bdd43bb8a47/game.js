(() => {
  "use strict";

  // Simulation values are exposed at 1/1000 precision. Rules run at a fixed 60 Hz.
  const STEP = 1 / 60;
  const WORLD_W = 360;
  const WORLD_H = 640;
  const WALL_L = 25;
  const WALL_R = 335;
  const GRAVITY = 900;
  const LAUNCH_SPEED = 620;
  const LAUNCH_REACH = LAUNCH_SPEED * LAUNCH_SPEED / (2 * GRAVITY);
  const PLAYER_R = 11;
  const JUMP_CAPACITY = 4;
  const DEAD_ZONE = 12;
  const MAX_PULL = 112;
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const shell = document.querySelector("#game-shell");
  const over = document.querySelector("#game-over");
  const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let state;
  let ledges = [];
  let items = [];
  let particles = [];
  let rings = [];
  let accumulator = 0;
  let previousTime = performance.now();
  let cameraBottom = 0;
  let shake = 0;
  let audio = null;
  let activePointer = null;

  const input = { dragging: false, originX: 0, originY: 0, dx: 0, dy: 0 };

  class Rng {
    constructor(seed) { this.state = (Number(seed) >>> 0) || 0x8f3a2d91; }
    next() {
      let x = this.state;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.state = x >>> 0;
      return this.state / 4294967296;
    }
    range(a, b) { return a + (b - a) * this.next(); }
  }

  function generate(seed) {
    const rng = new Rng(seed);
    const generatedLedges = [{
      id: "ledge-0000", position: { x: 180, y: 25 }, halfWidth: 72, active: true
    }];
    const generatedItems = [];
    let y = 25;
    let x = 180;
    let itemId = 0;

    for (let i = 1; i < 240; i++) {
      const difficulty = Math.min(1, y / 9000);
      const gap = rng.range(104 + difficulty * 15, 137 + difficulty * 24);
      y += Math.min(gap, LAUNCH_REACH * .76);
      const sideBias = i % 2 ? rng.range(-1, .25) : rng.range(-.25, 1);
      x = Math.max(79, Math.min(281, x + sideBias * rng.range(45, 108)));
      const halfWidth = rng.range(39 - difficulty * 5, 57 - difficulty * 8);
      generatedLedges.push({
        id: `ledge-${String(i).padStart(4, "0")}`,
        position: { x, y },
        halfWidth,
        active: true
      });

      const previous = generatedLedges[i - 1];
      const midY = previous.position.y + gap * rng.range(.45, .67);
      const centerSide = x < 180 ? 1 : -1;
      const temptationX = Math.max(92, Math.min(268,
        (previous.position.x + x) * .5 + centerSide * rng.range(35, 76)));

      if (i > 1) {
        generatedItems.push({
          id: `item-${String(itemId++).padStart(4, "0")}`,
          type: "glimmer",
          position: { x: temptationX, y: midY + rng.range(3, 22) },
          baseX: temptationX,
          phase: rng.range(0, Math.PI * 2),
          active: true,
          visualRadius: 9,
          collisionRadius: 8
        });
      }
      if (i % 2 === 0 || rng.next() > .46) {
        const mothX = Math.max(73, Math.min(287,
          temptationX + centerSide * rng.range(-18, 34)));
        generatedItems.push({
          id: `item-${String(itemId++).padStart(4, "0")}`,
          type: "moth",
          position: { x: mothX, y: midY + rng.range(34, 72) },
          baseX: mothX,
          phase: rng.range(0, Math.PI * 2),
          active: true,
          visualRadius: 13,
          collisionRadius: 10
        });
      }
    }
    return { ledges: generatedLedges, items: generatedItems, rngState: rng.state, spawnIndex: itemId };
  }

  function reset(seed = 1337) {
    const sessionBest = state ? state.sessionBest : 0;
    const world = generate(seed);
    ledges = world.ledges;
    items = world.items;
    particles = [];
    rings = [];
    cameraBottom = 0;
    shake = 0;
    activePointer = null;
    clearInput();
    state = {
      phase: "ready", tick: 0, elapsedMs: 0, seed: Number(seed) >>> 0,
      rngState: world.rngState, spawnIndex: world.spawnIndex,
      difficulty: 0, score: 0, height: 0, sessionBest, rank: null,
      x: 180, y: 37, vx: 0, vy: 0, anchored: true, anchorKind: "ledge",
      anchorId: "ledge-0000", jumpsLeft: JUMP_CAPACITY, launches: 0,
      midairLaunches: 0, landings: 0, refunds: 0, glimmersCollected: 0,
      chainCount: 0, chainBest: 0, chainBonus: 0, glimmerScore: 0,
      dampY: -118, dampSpeed: 9.4, lastEvent: null,
      expression: "rest", expressionTicks: 0
    };
    over.hidden = true;
    document.querySelector("#final-rank").textContent = "";
    accumulator = 0;
    previousTime = performance.now();
  }

  function clearInput() {
    input.dragging = false;
    input.originX = input.originY = input.dx = input.dy = 0;
  }

  function event(kind) { state.lastEvent = { kind, tick: state.tick }; }

  function startAudio() {
    if (audio) {
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const master = ac.createGain();
    master.gain.value = .13;
    master.connect(ac.destination);
    const dampHum = ac.createOscillator();
    const dampGain = ac.createGain();
    const dampLfo = ac.createOscillator();
    const dampLfoGain = ac.createGain();
    dampHum.type = "sine";
    dampHum.frequency.value = 48;
    dampGain.gain.value = .025;
    dampLfo.frequency.value = .19;
    dampLfoGain.gain.value = .012;
    dampLfo.connect(dampLfoGain);
    dampLfoGain.connect(dampGain.gain);
    dampHum.connect(dampGain);
    dampGain.connect(master);
    dampHum.start();
    dampLfo.start();
    audio = { ctx: ac, master, dampHum, dampGain };
  }

  function tone(freq, duration, type = "sine", gain = .18, slide = 1) {
    if (!audio) return;
    const t = audio.ctx.currentTime;
    const osc = audio.ctx.createOscillator();
    const amp = audio.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + duration);
    amp.gain.setValueAtTime(.001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + .012);
    amp.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(amp); amp.connect(audio.master);
    osc.start(t); osc.stop(t + duration + .02);
  }

  function sound(kind, chain = 0) {
    if (kind === "launch") tone(180, .16, "triangle", .2, 2.1);
    if (kind === "land") { tone(120, .18, "sine", .25, .65); tone(240, .23, "triangle", .1, 1.3); }
    if (kind === "bounce") { tone(380 + chain * 42, .19, "square", .13, 1.75); tone(760, .1, "sine", .08, 1.25); }
    if (kind === "glimmer") { tone(700, .11, "sine", .12, 1.3); tone(1040, .2, "sine", .08, 1.12); }
    if (kind === "chain") tone(330 * Math.pow(1.105, Math.min(chain, 9)), .18, "triangle", .12 + Math.min(chain, 6) * .012, 1.35);
    if (kind === "death") tone(190, .9, "sawtooth", .1, .3);
  }

  function launch() {
    if (!input.dragging || state.phase === "gameover") return;
    const rect = canvas.getBoundingClientRect();
    const dx = input.dx * WORLD_W / rect.width;
    const dy = input.dy * WORLD_H / rect.height;
    const length = Math.hypot(dx, dy);
    if (length < DEAD_ZONE || state.jumpsLeft <= 0) {
      clearInput();
      return;
    }
    const wasAnchored = state.anchored;
    const power = Math.min(1, length / MAX_PULL);
    const speed = LAUNCH_SPEED * (.34 + .66 * power);
    state.vx = -dx / length * speed;
    state.vy = dy / length * speed;
    state.anchored = false;
    state.anchorKind = null;
    state.anchorId = null;
    state.jumpsLeft--;
    state.launches++;
    state.expression = "flight";
    state.expressionTicks = 13;
    if (state.phase === "ready") state.phase = "playing";
    event("launch");
    sound("launch");
    burst(state.x, state.y - 6, "#ffbc55", 9, .8);
    if (!wasAnchored) {
      state.midairLaunches++;
      addChain();
    }
    clearInput();
  }

  function addChain() {
    state.chainCount++;
    event("chain");
    sound("chain", state.chainCount);
    rings.push({ x: state.x, y: state.y, life: 1, color: "#ffbb58", size: 18 + state.chainCount * 4 });
    shake = Math.min(7, 1 + state.chainCount * .65);
  }

  function land(kind, anchorId = null) {
    const endedChain = state.chainCount;
    state.anchored = true;
    state.anchorKind = kind;
    state.anchorId = anchorId;
    state.vx = state.vy = 0;
    state.jumpsLeft = JUMP_CAPACITY;
    state.landings++;
    state.expression = kind === "wall" ? "cling" : "rest";
    state.expressionTicks = 20;
    event("land");
    sound("land");
    burst(state.x, state.y - PLAYER_R, "#f6d49a", 12, 1.3);
    shake = Math.max(shake, endedChain > 2 ? 5 : 2);
    if (endedChain > 0) {
      state.chainBest = Math.max(state.chainBest, endedChain);
      state.chainBonus += endedChain * endedChain * 24;
      state.chainCount = 0;
      event("chainBank");
      if (endedChain >= 2) {
        rings.push({ x: state.x, y: state.y, life: 1.4, color: "#fff1aa", size: 28 + endedChain * 8 });
      }
    }
    updateScore();
  }

  function burst(x, y, color, count, force = 1) {
    if (prefersReduced) count = Math.ceil(count / 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (25 + Math.random() * 75) * force;
      particles.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: .35 + Math.random() * .4, max: .75, color,
        size: 1.5 + Math.random() * 3
      });
    }
  }

  function updateScore() {
    state.score = Math.max(0, Math.floor(state.height * 1.72 + state.chainBonus + state.glimmerScore));
  }

  function step() {
    if (state.phase !== "playing") return;
    state.tick++;
    state.elapsedMs = state.tick * (1000 / 60);
    state.difficulty = 1 + Math.min(2.6, state.height / 2600);
    state.dampSpeed = 9.4 + state.height * .0055;
    state.dampY += state.dampSpeed * STEP;

    for (const item of items) {
      if (item.type === "moth" && item.active) {
        item.position.x = item.baseX + Math.sin(state.tick * .026 + item.phase) * 12;
      }
    }

    if (state.anchored) {
      if (state.anchorKind === "wall") {
        state.y -= (8 + state.difficulty * 1.6) * STEP;
        state.expression = "cling";
      } else if (state.anchorId) {
        const ledge = ledges.find(l => l.id === state.anchorId);
        if (ledge) {
          state.x = ledge.position.x;
          state.y = ledge.position.y + PLAYER_R + 1;
        }
      }
    } else {
      const oldY = state.y;
      state.vy -= GRAVITY * STEP;
      state.x += state.vx * STEP;
      state.y += state.vy * STEP;

      if (state.x - PLAYER_R <= WALL_L && state.vx < 0) {
        state.x = WALL_L + PLAYER_R;
        land("wall");
      } else if (state.x + PLAYER_R >= WALL_R && state.vx > 0) {
        state.x = WALL_R - PLAYER_R;
        land("wall");
      } else if (state.vy <= 0) {
        for (const ledge of ledges) {
          const top = ledge.position.y + PLAYER_R + 1;
          if (oldY >= top && state.y <= top &&
              Math.abs(state.x - ledge.position.x) <= ledge.halfWidth + PLAYER_R * .35) {
            state.y = top;
            land("ledge", ledge.id);
            break;
          }
        }
      }
    }

    if (!state.anchored) {
      for (const item of items) {
        if (!item.active || Math.abs(item.position.y - state.y) > 30) continue;
        const d = Math.hypot(item.position.x - state.x, item.position.y - state.y);
        if (d <= PLAYER_R + item.collisionRadius) collect(item);
      }
    }

    state.height = Math.max(state.height, state.y - 37);
    updateScore();
    if (state.expressionTicks > 0) state.expressionTicks--;
    if (!state.anchored && state.jumpsLeft === 0 && state.vy < 20) state.expression = "empty";
    else if (!state.anchored && state.expressionTicks <= 0) state.expression = "flight";

    if (state.dampY >= state.y - PLAYER_R * .25) gameOver();
  }

  function collect(item) {
    item.active = false;
    if (item.type === "glimmer") {
      state.glimmersCollected++;
      state.glimmerScore += Math.floor(115 * (1 + Math.min(1.6, state.chainCount * .22)));
      event("glimmer");
      sound("glimmer");
      burst(item.position.x, item.position.y, "#bfffe8", 18, 1.2);
      rings.push({ x: item.position.x, y: item.position.y, life: 1, color: "#bfffe8", size: 20 });
    } else {
      state.refunds++;
      state.jumpsLeft = Math.min(JUMP_CAPACITY, state.jumpsLeft + 1);
      state.vy = Math.max(state.vy, 330) + 90;
      state.expression = "burst";
      state.expressionTicks = 18;
      event("bounce");
      sound("bounce", state.chainCount);
      burst(item.position.x, item.position.y, "#ff8b4d", 24, 1.55);
      addChain();
    }
    updateScore();
  }

  function grade(score) {
    if (score >= 9000) return "INFERNO";
    if (score >= 5200) return "BLAZE";
    if (score >= 2700) return "FLAME";
    if (score >= 1100) return "EMBER";
    if (score >= 350) return "SPARK";
    return "CINDER";
  }

  function gameOver() {
    state.phase = "gameover";
    state.rank = grade(state.score);
    state.sessionBest = Math.max(state.sessionBest, state.score);
    state.expression = "doused";
    clearInput();
    sound("death");
    shake = 8;
    document.querySelector("#final-rank").textContent = state.rank;
    document.querySelector("#final-score").textContent = state.score.toLocaleString("en-US");
    document.querySelector("#final-best").textContent = state.sessionBest.toLocaleString("en-US");
    document.querySelector("#final-chain").textContent = `${state.chainBest} LINKS`;
    setTimeout(() => { if (state.phase === "gameover") over.hidden = false; }, 620);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }

  function worldToScreen(x, y) {
    return { x, y: WORLD_H - (y - cameraBottom) };
  }

  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function render(time) {
    resize();
    const sx = canvas.width / WORLD_W;
    const sy = canvas.height / WORLD_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    const target = Math.max(0, state.y - 220);
    cameraBottom += (target - cameraBottom) * .075;
    const joltX = shake > .1 ? (Math.random() - .5) * shake : 0;
    const joltY = shake > .1 ? (Math.random() - .5) * shake : 0;
    shake *= .86;

    ctx.save();
    ctx.translate(joltX, joltY);
    drawFlue(time);
    drawWorld(time);
    drawDamp(time);
    drawEffects();
    drawPlayer(time);
    if (input.dragging && state.phase !== "gameover") drawAim();
    ctx.restore();
    drawHud(time);
  }

  function drawFlue(time) {
    const grad = ctx.createLinearGradient(0, 0, WORLD_W, 0);
    grad.addColorStop(0, "#090713");
    grad.addColorStop(.16, "#171326");
    grad.addColorStop(.5, "#211b30");
    grad.addColorStop(.84, "#171326");
    grad.addColorStop(1, "#090713");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.globalAlpha = .23;
    for (let i = 0; i < 7; i++) {
      const x = 45 + i * 47 + Math.sin(i * 19) * 9;
      const offset = ((cameraBottom * (.08 + i * .012)) + i * 83) % 170;
      ctx.strokeStyle = i % 2 ? "#6e5366" : "#312e50";
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, -40);
      for (let y = -40; y < 700; y += 50) {
        ctx.lineTo(x + Math.sin(y * .023 + i + time * .0001) * 7, y + offset - 170);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const wall = ctx.createLinearGradient(0, 0, 34, 0);
    wall.addColorStop(0, "#05050c"); wall.addColorStop(1, "#30233a");
    ctx.fillStyle = wall; ctx.fillRect(0, 0, WALL_L, WORLD_H);
    const wallR = ctx.createLinearGradient(WORLD_W, 0, WORLD_W - 34, 0);
    wallR.addColorStop(0, "#05050c"); wallR.addColorStop(1, "#30233a");
    ctx.fillStyle = wallR; ctx.fillRect(WALL_R, 0, WORLD_W - WALL_R, WORLD_H);

    ctx.strokeStyle = "#7b50604a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(WALL_L, 0); ctx.lineTo(WALL_L, WORLD_H);
    ctx.moveTo(WALL_R, 0); ctx.lineTo(WALL_R, WORLD_H); ctx.stroke();
    for (let y = -30; y < 700; y += 58) {
      const yy = y + (cameraBottom * .6 % 58);
      ctx.fillStyle = "#0a0812aa";
      ctx.beginPath(); ctx.ellipse(13, yy, 8, 18, -.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(347, yy + 25, 7, 16, .2, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawWorld(time) {
    for (const ledge of ledges) {
      const p = worldToScreen(ledge.position.x, ledge.position.y);
      if (p.y < -30 || p.y > WORLD_H + 30) continue;
      const w = ledge.halfWidth * 2;
      ctx.fillStyle = "#080711";
      ctx.beginPath();
      ctx.moveTo(p.x - ledge.halfWidth, p.y);
      ctx.quadraticCurveTo(p.x, p.y + 19, p.x + ledge.halfWidth, p.y);
      ctx.lineTo(p.x + ledge.halfWidth - 7, p.y + 9);
      ctx.quadraticCurveTo(p.x, p.y + 28, p.x - ledge.halfWidth + 5, p.y + 8);
      ctx.closePath(); ctx.fill();
      const top = ctx.createLinearGradient(0, p.y - 4, 0, p.y + 7);
      top.addColorStop(0, "#b58972"); top.addColorStop(.35, "#594056"); top.addColorStop(1, "#21172b");
      ctx.fillStyle = top;
      roundedRect(p.x - ledge.halfWidth, p.y - 4, w, 9, 5); ctx.fill();
      ctx.strokeStyle = "#e5b58c44"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x - ledge.halfWidth + 7, p.y - 2);
      ctx.lineTo(p.x + ledge.halfWidth - 8, p.y - 2); ctx.stroke();
    }

    for (const item of items) {
      if (!item.active) continue;
      const p = worldToScreen(item.position.x, item.position.y);
      if (p.y < -30 || p.y > WORLD_H + 30) continue;
      if (item.type === "glimmer") drawGlimmer(p.x, p.y, time + item.phase * 1000);
      else drawMoth(p.x, p.y, time, item.phase);
    }
  }

  function drawGlimmer(x, y, time) {
    const pulse = 1 + Math.sin(time * .005) * .12;
    ctx.save(); ctx.translate(x, y); ctx.rotate(time * .0008);
    ctx.shadowColor = "#9dffe1"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#d8fff0";
    ctx.beginPath();
    ctx.moveTo(0, -10 * pulse); ctx.quadraticCurveTo(3, -3, 8 * pulse, 0);
    ctx.quadraticCurveTo(3, 3, 0, 10 * pulse);
    ctx.quadraticCurveTo(-3, 3, -8 * pulse, 0);
    ctx.quadraticCurveTo(-3, -3, 0, -10 * pulse); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-1, -2, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawMoth(x, y, time, phase) {
    const flap = Math.sin(time * .014 + phase) * .65;
    ctx.save(); ctx.translate(x, y + Math.sin(time * .002 + phase) * 2);
    ctx.shadowColor = "#ff8240"; ctx.shadowBlur = 8;
    ctx.fillStyle = "#382535";
    ctx.beginPath();
    ctx.ellipse(-7, 0, 7, 11 * Math.abs(flap) + 3, -.55, 0, Math.PI * 2);
    ctx.ellipse(7, 0, 7, 11 * Math.abs(flap) + 3, .55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ef8552";
    ctx.beginPath(); ctx.ellipse(0, 1, 3.5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#eab389"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-1, -5); ctx.quadraticCurveTo(-7, -12, -9, -8);
    ctx.moveTo(1, -5); ctx.quadraticCurveTo(7, -12, 9, -8); ctx.stroke();
    ctx.fillStyle = "#fff3d0";
    ctx.beginPath(); ctx.arc(-1.3, -1, .8, 0, Math.PI * 2); ctx.arc(1.3, -1, .8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawDamp(time) {
    const front = worldToScreen(0, state.dampY).y;
    if (front > WORLD_H + 50) return;
    const g = ctx.createLinearGradient(0, front - 20, 0, WORLD_H);
    g.addColorStop(0, "#b5cbd144"); g.addColorStop(.08, "#637d8ecf");
    g.addColorStop(.35, "#293b58ed"); g.addColorStop(1, "#11162b");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, WORLD_H);
    ctx.lineTo(0, front);
    for (let x = 0; x <= WORLD_W; x += 9) {
      const reach = Math.sin(x * .057 + time * .002) * 7 +
        Math.sin(x * .021 - time * .0013) * 5;
      const finger = Math.pow(Math.max(0, Math.sin(x * .11 + time * .001)), 8) * 16;
      ctx.lineTo(x, front + reach - finger);
    }
    ctx.lineTo(WORLD_W, WORLD_H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#c4e2df88"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 5) {
      const y = front + Math.sin(x * .057 + time * .002) * 7 +
        Math.sin(x * .021 - time * .0013) * 5 -
        Math.pow(Math.max(0, Math.sin(x * .11 + time * .001)), 8) * 16;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#d7efea66";
    for (let i = 0; i < 9; i++) {
      const x = (i * 47 + time * .012) % 390 - 15;
      const y = front + 19 + (i * 31 % 80);
      ctx.beginPath(); ctx.arc(x, y, 1.5 + i % 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPlayer(time) {
    const p = worldToScreen(state.x, state.y);
    let stretchX = 1, stretchY = 1, rotation = 0;
    if (input.dragging) { stretchX = .88; stretchY = 1.18; }
    if (!state.anchored) {
      const speed = Math.hypot(state.vx, state.vy);
      stretchY = 1 + Math.min(.42, speed / 1300);
      stretchX = 1 / Math.sqrt(stretchY);
      rotation = Math.atan2(state.vx, state.vy) * -.35;
    }
    if (state.expression === "burst") { stretchX = 1.35; stretchY = 1.35; }
    if (state.expression === "doused") { stretchX = 1.2; stretchY = .5; }

    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rotation); ctx.scale(stretchX, stretchY);
    if (state.expression !== "doused") {
      ctx.globalAlpha = .28;
      ctx.fillStyle = "#ff7a30";
      ctx.beginPath();
      ctx.moveTo(0, 12); ctx.quadraticCurveTo(-10, 22 + Math.sin(time * .018) * 3, -3, 28);
      ctx.quadraticCurveTo(1, 20, 7, 16); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = state.expression === "doused" ? "#6d7682" : "#ff7a2f";
    ctx.shadowBlur = state.expression === "burst" ? 34 : 19;
    const body = ctx.createRadialGradient(-4, -6, 1, 0, 0, 17);
    body.addColorStop(0, "#fffbe5");
    body.addColorStop(.32, state.expression === "doused" ? "#9aa3a4" : "#ffd05a");
    body.addColorStop(.75, state.expression === "doused" ? "#4f5761" : "#ff7135");
    body.addColorStop(1, state.expression === "doused" ? "#252c39" : "#bd2c32");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.bezierCurveTo(7, -12, 13, -4, 11, 6);
    ctx.bezierCurveTo(7, 15, -7, 15, -11, 6);
    ctx.bezierCurveTo(-14, -3, -6, -12, 0, -16);
    ctx.fill();

    drawFace(time);
    ctx.restore();
  }

  function drawFace(time) {
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#4b2232"; ctx.fillStyle = "#4b2232"; ctx.lineWidth = 1.8;
    const blink = state.expression === "rest" && Math.sin(time * .0017) > .985;
    if (state.expression === "cling") {
      ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-2, -5);
      ctx.moveTo(6, -3); ctx.lineTo(2, -5); ctx.stroke();
      ctx.beginPath(); ctx.arc(-4, -1, 1.5, 0, Math.PI * 2); ctx.arc(4, -1, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 5, 3, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (state.expression === "empty") {
      ctx.fillStyle = "#fff8de"; ctx.beginPath();
      ctx.ellipse(-4, -2, 3.2, 4.4, 0, 0, Math.PI * 2);
      ctx.ellipse(4, -2, 3.2, 4.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4b2232"; ctx.beginPath();
      ctx.arc(-4, -1, 1.4, 0, Math.PI * 2); ctx.arc(4, -1, 1.4, 0, Math.PI * 2);
      ctx.arc(0, 6, 2.3, 0, Math.PI * 2); ctx.fill();
    } else if (state.expression === "doused") {
      ctx.strokeStyle = "#252b36";
      ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-2, 1); ctx.moveTo(-2, -3); ctx.lineTo(-7, 1);
      ctx.moveTo(2, -3); ctx.lineTo(7, 1); ctx.moveTo(7, -3); ctx.lineTo(2, 1); ctx.stroke();
    } else if (input.dragging) {
      ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(-2, -2);
      ctx.moveTo(7, -4); ctx.lineTo(2, -2); ctx.stroke();
      ctx.beginPath(); ctx.arc(-4, 0, 1.5, 0, Math.PI * 2); ctx.arc(4, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 6, 3, .1, Math.PI - .1); ctx.stroke();
    } else if (blink) {
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-2, 0); ctx.moveTo(2, 0); ctx.lineTo(7, 0); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(-4, -1, 1.7, 0, Math.PI * 2); ctx.arc(4, -1, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, 3, 5, .22, Math.PI - .22); ctx.stroke();
    }
  }

  function drawEffects() {
    ctx.save();
    for (const ring of rings) {
      const p = worldToScreen(ring.x, ring.y);
      ctx.globalAlpha = Math.min(1, ring.life);
      ctx.strokeStyle = ring.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, ring.size * (1.6 - ring.life * .5), 0, Math.PI * 2); ctx.stroke();
    }
    for (const pt of particles) {
      const p = worldToScreen(pt.x, pt.y);
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, pt.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function updateEffects(dt) {
    for (const pt of particles) {
      pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy -= 120 * dt;
    }
    for (const ring of rings) ring.life -= dt * 1.8;
    particles = particles.filter(p => p.life > 0);
    rings = rings.filter(r => r.life > 0);
  }

  function drawAim() {
    const rect = canvas.getBoundingClientRect();
    const ox = (input.originX - rect.left) * WORLD_W / rect.width;
    const oy = (input.originY - rect.top) * WORLD_H / rect.height;
    const dx = input.dx * WORLD_W / rect.width;
    const dy = input.dy * WORLD_H / rect.height;
    const pull = Math.min(MAX_PULL, Math.hypot(dx, dy));
    if (pull < 2) return;
    const nx = dx / Math.hypot(dx, dy), ny = dy / Math.hypot(dx, dy);
    const tipX = ox + nx * pull, tipY = oy + ny * pull;
    const power = Math.min(1, pull / MAX_PULL);

    ctx.strokeStyle = state.jumpsLeft ? `rgba(255,190,91,${.5 + power * .4})` : "#77808a88";
    ctx.lineWidth = 2 + power * 2; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff0bc"; ctx.beginPath(); ctx.arc(tipX, tipY, 5 + power * 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff2c7aa"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox, oy, 10, 0, Math.PI * 2); ctx.stroke();

    const player = worldToScreen(state.x, state.y);
    const dirX = -nx, dirY = -ny;
    ctx.strokeStyle = "#ffd27b"; ctx.lineWidth = 2; ctx.globalAlpha = .8;
    ctx.beginPath(); ctx.moveTo(player.x, player.y);
    for (let i = 1; i <= 5; i++) {
      const d = i * (12 + power * 9);
      ctx.lineTo(player.x + dirX * d, player.y + dirY * d);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function drawHud(time) {
    const top = 18;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#eadcc4"; ctx.font = "700 10px Trebuchet MS, sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText("HEIGHT", 27, top);
    ctx.font = "700 18px Trebuchet MS, sans-serif";
    ctx.fillStyle = "#fff3d6"; ctx.fillText(`${Math.floor(state.height)}m`, 27, top + 18);

    ctx.textAlign = "right"; ctx.font = "700 10px Trebuchet MS, sans-serif";
    ctx.fillStyle = "#eadcc4"; ctx.fillText("SCORE", 333, top);
    ctx.font = "700 18px Trebuchet MS, sans-serif"; ctx.fillStyle = "#fff3d6";
    ctx.fillText(state.score.toLocaleString("en-US"), 333, top + 18); ctx.textAlign = "left";

    ctx.save(); ctx.translate(180, 29);
    for (let i = 0; i < JUMP_CAPACITY; i++) {
      const x = (i - 1.5) * 17;
      const lit = i < state.jumpsLeft;
      ctx.shadowColor = "#ff7b2e"; ctx.shadowBlur = lit ? 9 : 0;
      ctx.fillStyle = lit ? "#ffc45e" : "#332b3c";
      ctx.beginPath();
      ctx.moveTo(x, -8); ctx.quadraticCurveTo(x + 7, 0, x, 8);
      ctx.quadraticCurveTo(x - 7, 0, x, -8); ctx.fill();
    }
    ctx.restore();

    if (state.chainCount > 0) {
      const pulse = 1 + Math.sin(time * .012) * .04;
      ctx.save(); ctx.translate(180, 76); ctx.scale(pulse, pulse);
      ctx.textAlign = "center"; ctx.fillStyle = "#ffcb6d";
      ctx.font = `900 ${18 + Math.min(10, state.chainCount)}px Trebuchet MS, sans-serif`;
      ctx.shadowColor = "#ff662f"; ctx.shadowBlur = 12;
      ctx.fillText(`CHAIN ×${state.chainCount}`, 0, 0); ctx.restore();
    }

    if (state.phase === "ready") {
      const alpha = .66 + Math.sin(time * .003) * .2;
      ctx.textAlign = "center"; ctx.fillStyle = `rgba(255,239,202,${alpha})`;
      ctx.font = "700 11px Trebuchet MS, sans-serif";
      ctx.fillText("TOUCH • PULL BACK • RELEASE", 180, 548);
      ctx.fillStyle = "#c69d7caa"; ctx.font = "700 9px Trebuchet MS, sans-serif";
      ctx.fillText("CLIMB BEFORE THE COLD FINDS YOU", 180, 569);
      ctx.textAlign = "left";
    } else if (state.jumpsLeft === 0 && !state.anchored) {
      ctx.textAlign = "center"; ctx.fillStyle = "#dbe7e7";
      ctx.font = "700 10px Trebuchet MS, sans-serif";
      ctx.fillText("HOLD YOUR BREATH…", 180, 118); ctx.textAlign = "left";
    }
  }

  function frame(now) {
    const dt = Math.min(.1, (now - previousTime) / 1000);
    previousTime = now;
    if (state.phase === "playing") {
      accumulator += dt;
      while (accumulator >= STEP) { step(); accumulator -= STEP; }
    } else accumulator = 0;
    updateEffects(dt);
    render(now);
    requestAnimationFrame(frame);
  }

  function pointerDown(e) {
    e.preventDefault();
    startAudio();
    if (state.phase === "gameover") {
      over.hidden = true;
      reset(state.seed);
      return;
    }
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    input.dragging = true;
    input.originX = e.clientX;
    input.originY = e.clientY;
    input.dx = input.dy = 0;
    state.expression = "aim";
  }

  function pointerMove(e) {
    if (e.pointerId !== activePointer || !input.dragging) return;
    e.preventDefault();
    input.dx = e.clientX - input.originX;
    input.dy = e.clientY - input.originY;
  }

  function pointerUp(e) {
    if (e.pointerId !== activePointer) return;
    e.preventDefault();
    activePointer = null;
    launch();
  }

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", e => {
    if (e.pointerId === activePointer) { activePointer = null; clearInput(); }
  });
  over.addEventListener("pointerdown", pointerDown);
  window.addEventListener("resize", resize);

  function rounded(n) { return Math.round(n * 1000) / 1000; }
  function snapshot() {
    const low = state.y - LAUNCH_REACH;
    const high = state.y + LAUNCH_REACH * 2;
    const visibleLedges = ledges
      .filter(l => l.position.y >= low && l.position.y <= high)
      .map(l => ({
        id: l.id, position: { x: rounded(l.position.x), y: rounded(l.position.y) },
        halfWidth: rounded(l.halfWidth), active: l.active
      }));
    const visibleItems = items
      .filter(i => i.position.y >= low && i.position.y <= high)
      .map(i => ({
        id: i.id, type: i.type,
        position: { x: rounded(i.position.x), y: rounded(i.position.y) },
        active: i.active, visualRadius: i.visualRadius, collisionRadius: i.collisionRadius
      }));
    return {
      phase: state.phase, tick: state.tick, elapsedMs: rounded(state.elapsedMs),
      seed: state.seed, rngState: state.rngState, spawnIndex: state.spawnIndex,
      input: {
        dragging: input.dragging,
        originX: rounded(input.originX), originY: rounded(input.originY),
        dx: rounded(input.dx), dy: rounded(input.dy)
      },
      difficulty: rounded(state.difficulty),
      score: state.score, height: rounded(state.height), sessionBest: state.sessionBest, rank: state.rank,
      x: rounded(state.x), y: rounded(state.y), vx: rounded(state.vx), vy: rounded(state.vy),
      playerRadius: PLAYER_R, anchored: state.anchored, anchorKind: state.anchorKind,
      jumpCapacity: JUMP_CAPACITY, jumpsLeft: state.jumpsLeft,
      launches: state.launches, midairLaunches: state.midairLaunches,
      landings: state.landings, refunds: state.refunds, glimmersCollected: state.glimmersCollected,
      chainCount: state.chainCount, chainBest: state.chainBest,
      dampY: rounded(state.dampY), dampSpeed: rounded(state.dampSpeed),
      wallLeftX: WALL_L, wallRightX: WALL_R, launchReach: rounded(LAUNCH_REACH),
      ledges: visibleLedges, items: visibleItems,
      lastEvent: state.lastEvent ? { ...state.lastEvent } : null
    };
  }

  window.__ARENA_GAME__ = { reset, snapshot };
  reset(1337);
  requestAnimationFrame(frame);
})();
