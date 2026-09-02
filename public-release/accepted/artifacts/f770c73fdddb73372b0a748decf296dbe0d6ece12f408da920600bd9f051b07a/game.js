(() => {
  "use strict";

  const PROTOCOL = "arena.game.v1";
  const STEP = 1000 / 60;
  const RANKS = ["DRIFTWOOD", "SEA GLASS", "MOON SHELL", "DEEP PEARL", "TIDEKEEPER"];
  const RANK_AT = [0, 120, 350, 750, 1400];
  const MAX_EVENTS = 240;
  const $ = (id) => document.getElementById(id);
  const ui = {
    game: $("game"), board: $("board"), pearls: $("pearls"), pool: $("pool-label"),
    tide: $("tide-fill"), tideText: $("tide-text"), left: $("urchins-left"),
    hint: $("hint"), toast: $("toast"), host: $("host"), bubble: $("host-bubble"),
    ceremony: $("ceremony"), rank: $("rank"), final: $("final-pearls"),
    best: $("best-pearls"), deepest: $("deepest"), ladder: $("rank-ladder"),
    sound: $("sound"), ripple: $("ripple-layer")
  };

  let sessionBest = 0;
  let attempt = 0;
  let state;
  let mines = null;
  let numbers = null;
  let open = null;
  let flags = null;
  let poolStartTick = null;
  let timeCarry = 0;
  let eventSeq = 0;
  let largestRipple = 0;
  let lastRowsKey = "";
  let toastTimer = 0;
  let bubbleTimer = 0;
  let bridgePort = null;
  let bridgeSession = null;
  let bridgeGeneration = null;

  function poolConfig(pool) {
    if (pool === 1) return { w: 5, h: 6, n: 4, seconds: 74 };
    if (pool === 2) return { w: 6, h: 7, n: 7, seconds: 98 };
    if (pool === 3) return { w: 7, h: 8, n: 10, seconds: 122 };
    return { w: 7, h: 9, n: Math.min(10 + (pool - 3) * 2, 18), seconds: 138 + Math.min(pool, 8) * 5 };
  }

  function hashText(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rngFor(text) {
    let a = hashText(text) || 1;
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function neighbors(index, w, h) {
    const x = index % w, y = Math.floor(index / w), result = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) result.push(ny * w + nx);
    }
    return result;
  }

  function makeNumbers(layout, w, h) {
    return layout.map((_, i) => neighbors(i, w, h).reduce((n, j) => n + (layout[j] ? 1 : 0), 0));
  }

  function floodInto(revealed, layout, nums, start, blocked, w, h) {
    if (layout[start] || blocked[start] || revealed[start]) return 0;
    const queue = [start];
    let count = 0;
    while (queue.length) {
      const i = queue.shift();
      if (revealed[i] || blocked[i] || layout[i]) continue;
      revealed[i] = true;
      count++;
      if (nums[i] === 0) {
        for (const j of neighbors(i, w, h)) {
          if (!revealed[j] && !blocked[j] && !layout[j]) queue.push(j);
        }
      }
    }
    return count;
  }

  function testSolvable(layout, nums, first, w, h, totalMines) {
    const seen = Array(layout.length).fill(false);
    const known = Array(layout.length).fill(false);
    const noneBlocked = Array(layout.length).fill(false);
    const initial = floodInto(seen, layout, nums, first, noneBlocked, w, h);
    let rounds = 0, changed = true;
    while (changed && rounds < 100) {
      changed = false;
      rounds++;
      for (let i = 0; i < layout.length; i++) {
        if (!seen[i]) continue;
        const around = neighbors(i, w, h);
        const marked = around.filter(j => known[j]).length;
        const unknown = around.filter(j => !seen[j] && !known[j]);
        if (unknown.length && nums[i] - marked === 0) {
          for (const j of unknown) if (!seen[j]) {
            floodInto(seen, layout, nums, j, known, w, h);
            changed = true;
          }
        } else if (unknown.length && nums[i] - marked === unknown.length) {
          for (const j of unknown) if (!known[j]) { known[j] = true; changed = true; }
        }
      }
      const markedTotal = known.filter(Boolean).length;
      const unknownAll = layout.map((_, i) => i).filter(i => !seen[i] && !known[i]);
      if (unknownAll.length && markedTotal === totalMines) {
        for (const j of unknownAll) {
          floodInto(seen, layout, nums, j, known, w, h);
          changed = true;
        }
      } else if (unknownAll.length && totalMines - markedTotal === unknownAll.length) {
        for (const j of unknownAll) if (!known[j]) { known[j] = true; changed = true; }
      }
    }
    const solved = layout.every((mine, i) => mine || seen[i]);
    return { solved, initial, rounds };
  }

  function generateBoard(firstX, firstY) {
    const { w, h, n } = poolConfig(state.pool);
    const first = firstY * w + firstX;
    const candidates = [];
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = Math.floor(i / w);
      if (Math.max(Math.abs(x - firstX), Math.abs(y - firstY)) > 1) candidates.push(i);
    }
    const random = rngFor(`${String(state.seed)}|pool:${state.pool}|first:${firstX},${firstY}`);
    let fallback = null;
    for (let pass = 0; pass < 4500; pass++) {
      const order = candidates.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const layout = Array(w * h).fill(false);
      for (let i = 0; i < n; i++) layout[order[i]] = true;
      const nums = makeNumbers(layout, w, h);
      const check = testSolvable(layout, nums, first, w, h, n);
      if (check.solved) {
        fallback ||= { layout, nums };
        const safeCount = w * h - n;
        if (check.initial < safeCount * .72 && check.rounds >= 2) return { layout, nums };
      }
    }
    if (fallback) return fallback;

    // Deterministic emergency layout: a sparse far edge always leaves the first turn safe.
    const layout = Array(w * h).fill(false);
    candidates.sort((a, b) => {
      const ax = a % w, ay = Math.floor(a / w), bx = b % w, by = Math.floor(b / w);
      return (Math.abs(bx - firstX) + Math.abs(by - firstY)) - (Math.abs(ax - firstX) + Math.abs(ay - firstY)) || a - b;
    });
    for (let i = 0; i < n; i++) layout[candidates[i]] = true;
    return { layout, nums: makeNumbers(layout, w, h) };
  }

  function setupPool() {
    const c = poolConfig(state.pool);
    state.gridWidth = c.w;
    state.gridHeight = c.h;
    state.urchinsTotal = c.n;
    state.firstTurnDone = false;
    state.stungAt = null;
    mines = null;
    numbers = null;
    open = Array(c.w * c.h).fill(false);
    flags = Array(c.w * c.h).fill(false);
    poolStartTick = null;
    lastRowsKey = "";
  }

  function reset(seed) {
    attempt++;
    state = {
      phase: "ready", tick: 0, seed: seed === undefined ? "shoal" : seed,
      attempt, revision: 0, pool: 1, pearls: 0, moves: 0, rank: null,
      events: [], stungAt: null
    };
    timeCarry = 0;
    eventSeq = 0;
    largestRipple = 0;
    setupPool();
    render(true);
    return snapshot();
  }

  function addEvent(kind, extra) {
    const event = Object.assign({ seq: ++eventSeq, kind, tick: state.tick }, extra || {});
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    return event;
  }

  function tideFraction() {
    if (poolStartTick === null) return 1;
    const durationTicks = poolConfig(state.pool).seconds * 60;
    return Math.max(0, 1 - (state.tick - poolStartTick) / durationTicks);
  }

  function rankFor(score) {
    let rank = RANKS[0];
    for (let i = 0; i < RANKS.length; i++) if (score >= RANK_AT[i]) rank = RANKS[i];
    return rank;
  }

  function visibleRows() {
    const rows = [];
    for (let y = 0; y < state.gridHeight; y++) {
      let row = "";
      for (let x = 0; x < state.gridWidth; x++) {
        const i = y * state.gridWidth + x;
        if (state.phase === "ended") {
          if (state.stungAt && state.stungAt.x === x && state.stungAt.y === y) row += "X";
          else if (flags[i]) row += mines[i] ? "+" : "-";
          else if (mines[i]) row += "*";
          else if (open[i]) row += String(numbers[i]);
          else row += "#";
        } else if (flags[i]) row += "F";
        else if (open[i]) row += String(numbers[i]);
        else row += "#";
      }
      rows.push(row);
    }
    return rows;
  }

  function snapshot(includeEvents = true) {
    const placed = flags.filter(Boolean).length;
    const result = {
      phase: state.phase,
      tick: state.tick,
      elapsedMs: state.tick * STEP,
      seed: state.seed,
      attempt: state.attempt,
      revision: state.revision,
      pool: state.pool,
      pearls: state.pearls,
      sessionBest,
      moves: state.moves,
      rank: state.rank,
      rankLadder: RANKS.slice(),
      gridWidth: state.gridWidth,
      gridHeight: state.gridHeight,
      urchinsTotal: state.urchinsTotal,
      flagsPlaced: placed,
      urchinsLeft: state.urchinsTotal - placed,
      tideFraction: tideFraction(),
      firstTurnDone: state.firstTurnDone,
      stungAt: state.stungAt ? { x: state.stungAt.x, y: state.stungAt.y } : null,
      rows: visibleRows()
    };
    if (includeEvents) {
      result.events = state.events.map(e => Object.assign({}, e));
      result.lastEvent = result.events.length ? Object.assign({}, result.events[result.events.length - 1]) : null;
    }
    return result;
  }

  function validCoord(action) {
    return action && Number.isInteger(action.x) && Number.isInteger(action.y) &&
      action.x >= 0 && action.y >= 0 && action.x < state.gridWidth && action.y < state.gridHeight;
  }

  function stingAt(index) {
    const x = index % state.gridWidth, y = Math.floor(index / state.gridWidth);
    state.stungAt = { x, y };
    state.phase = "ended";
    sound("sting");
    ui.game.classList.remove("shake");
    void ui.game.offsetWidth;
    ui.game.classList.add("shake");
  }

  function finishSting() {
    state.rank = rankFor(state.pearls);
    addEvent("sting");
    addEvent("run_end");
    sessionBest = Math.max(sessionBest, state.pearls);
  }

  function openOne(index) {
    if (mines[index]) {
      stingAt(index);
      return 0;
    }
    return floodInto(open, mines, numbers, index, flags, state.gridWidth, state.gridHeight);
  }

  function checkClear() {
    if (state.phase === "ended") return false;
    const safe = state.gridWidth * state.gridHeight - state.urchinsTotal;
    if (open.filter(Boolean).length !== safe) return false;
    const clearedPool = state.pool;
    const bonus = Math.round(38 * Math.pow(clearedPool, 1.38) * tideFraction());
    state.pearls += bonus;
    addEvent("pool_clear", { pool: clearedPool });
    sound("clear");
    showToast(`POOL CLEAR  +${bonus}`);
    reactHost("delighted", "The whole shoal is singing!");
    state.pool++;
    setupPool();
    return true;
  }

  function perform(action) {
    if (state.phase === "ended" || !validCoord(action)) return false;
    const i = action.y * state.gridWidth + action.x;
    let opened = 0;

    if (action.type === "open") {
      if (open[i] || flags[i]) return false;
      if (!state.firstTurnDone) {
        const board = generateBoard(action.x, action.y);
        mines = board.layout;
        numbers = board.nums;
        state.firstTurnDone = true;
        poolStartTick = state.tick;
        state.phase = "playing";
      }
      opened = openOne(i);
      state.pearls += opened * state.pool;
      largestRipple = Math.max(largestRipple, opened);
      addEvent("open", { opened });
      if (state.phase === "ended") finishSting();
      sound(opened > 3 ? "ripple" : "open", opened);
      if (opened > 3) makeRipple(action.x, action.y);
    } else if (action.type === "flag") {
      if (open[i] || flags[i]) return false;
      flags[i] = true;
      addEvent("flag");
      sound("flag");
      reactHost("curious", "A brave little pennant.");
    } else if (action.type === "unflag") {
      if (!flags[i] || open[i]) return false;
      flags[i] = false;
      addEvent("unflag");
      sound("unflag");
    } else if (action.type === "sweep") {
      if (!open[i]) return false;
      const around = neighbors(i, state.gridWidth, state.gridHeight);
      const marked = around.filter(j => flags[j]).length;
      if (marked !== numbers[i]) return false;
      const targets = around.filter(j => !flags[j] && !open[j]);
      if (!targets.length) return false;
      for (const j of targets) {
        const n = openOne(j);
        opened += n;
        if (state.phase === "ended") break;
      }
      state.pearls += opened * state.pool;
      largestRipple = Math.max(largestRipple, opened);
      addEvent("sweep", { opened });
      if (state.phase === "ended") finishSting();
      sound("sweep", opened);
      makeRipple(action.x, action.y);
    } else return false;

    state.moves++;
    state.revision++;
    if (state.phase !== "ended") checkClear();
    render(true);
    return true;
  }

  function act(action) {
    perform(action);
    return snapshot();
  }

  function restart() {
    return reset(state.seed);
  }

  function advance(ms) {
    if (!Number.isFinite(ms) || ms <= 0 || state.phase !== "playing") return snapshot();
    timeCarry += ms;
    const steps = Math.floor((timeCarry + 1e-9) / STEP);
    if (steps > 0) {
      state.tick += steps;
      timeCarry -= steps * STEP;
      render(false);
    }
    return snapshot();
  }

  function roman(n) {
    const values = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
    let out = "";
    for (const [v, s] of values) while (n >= v) { out += s; n -= v; }
    return out;
  }

  function renderBoard(rows, force) {
    const key = rows.join("|");
    if (!force && key === lastRowsKey) return;
    lastRowsKey = key;
    ui.board.style.setProperty("--cols", state.gridWidth);
    ui.board.style.setProperty("--rows", state.gridHeight);
    ui.board.innerHTML = "";
    rows.forEach((row, y) => [...row].forEach((char, x) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.x = x;
      button.dataset.y = y;
      button.setAttribute("role", "gridcell");
      if (char === "#") {
        button.classList.add("covered");
        button.setAttribute("aria-label", `Covered shell, column ${x + 1}, row ${y + 1}`);
      } else if (char === "F") {
        button.classList.add("covered", "flagged");
        button.innerHTML = '<span class="flag-shape"></span>';
        button.setAttribute("aria-label", `Pennanted shell, column ${x + 1}, row ${y + 1}`);
      } else if (char >= "0" && char <= "8") {
        button.classList.add("open", `n${char}`);
        button.textContent = char === "0" ? "·" : char;
        button.setAttribute("aria-label", `Open shell, ${char} neighboring urchins`);
      } else if (char === "X" || char === "*") {
        button.classList.add("mine");
        if (char === "X") button.classList.add("fatal");
        button.setAttribute("aria-label", char === "X" ? "Fatal urchin" : "Revealed urchin");
      } else {
        button.classList.add("covered", char === "+" ? "correct" : "wrong");
        button.setAttribute("aria-label", char === "+" ? "Correct pennant" : "Wrong pennant");
      }
      ui.board.appendChild(button);
    }));
  }

  function render(force) {
    const s = snapshot(false);
    renderBoard(s.rows, force);
    ui.pearls.textContent = s.pearls;
    ui.pool.textContent = `POOL ${roman(s.pool)}`;
    ui.left.textContent = s.urchinsLeft;
    ui.tide.style.transform = `scaleX(${s.tideFraction})`;
    ui.tide.classList.toggle("low", s.tideFraction < .22);
    ui.tideText.textContent = !s.firstTurnDone ? "WAITING" : s.tideFraction > 0 ? `${Math.ceil(s.tideFraction * 100)}%` : "LOW WATER";
    const covered = s.rows.join("").split("").filter(c => c === "#" || c === "F").length;
    if (s.phase === "ready") ui.hint.textContent = "Tap a shell to begin";
    else if (s.phase === "ended") ui.hint.textContent = "See where the water spoke";
    else if (s.moves < 2) ui.hint.textContent = "Hold a shell to plant a pennant";
    else ui.hint.textContent = "Tap a satisfied number to sweep";
    if (s.phase === "playing" && covered <= s.urchinsTotal + 4) {
      ui.host.className = "host breath";
    } else if (!ui.host.classList.contains("delighted")) {
      ui.host.className = `host ${s.phase === "ended" ? "stung" : "curious"}`;
    }
    if (s.phase === "ended") {
      ui.rank.textContent = s.rank;
      ui.final.textContent = s.pearls;
      ui.best.textContent = s.sessionBest;
      ui.deepest.textContent = `POOL ${roman(s.pool)}`;
      ui.ladder.innerHTML = RANKS.map((r, i) =>
        `<i class="${s.pearls >= RANK_AT[i] ? "earned" : ""}" title="${r}">${i + 1}</i>`).join("");
      ui.ceremony.classList.add("visible");
      ui.ceremony.setAttribute("aria-hidden", "false");
    } else {
      ui.ceremony.classList.remove("visible");
      ui.ceremony.setAttribute("aria-hidden", "true");
    }
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.classList.add("show");
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1500);
  }

  function reactHost(mood, words) {
    clearTimeout(bubbleTimer);
    ui.host.className = `host ${mood}`;
    ui.bubble.textContent = words;
    ui.bubble.classList.add("show");
    bubbleTimer = setTimeout(() => {
      ui.bubble.classList.remove("show");
      if (state.phase !== "ended") ui.host.className = "host curious";
    }, 1450);
  }

  function makeRipple(x, y) {
    const cell = ui.board.querySelector(`[data-x="${x}"][data-y="${y}"]`);
    if (!cell) return;
    const a = cell.getBoundingClientRect(), b = ui.ripple.getBoundingClientRect();
    const ring = document.createElement("i");
    ring.className = "ripple-ring";
    ring.style.left = `${a.left - b.left + a.width / 2}px`;
    ring.style.top = `${a.top - b.top + a.height / 2}px`;
    ui.ripple.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
    reactHost("delighted", "Listen to that ripple!");
  }

  let audio = null;
  let muted = false;
  function ensureAudio() {
    if (!audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audio = new AudioContext();
    }
    if (audio && audio.state === "suspended") audio.resume();
  }

  function sound(kind, amount = 1) {
    if (muted) return;
    ensureAudio();
    if (!audio) return;
    const now = audio.currentTime;
    const recipes = {
      open: [330, .045, "sine"], flag: [650, .055, "triangle"], unflag: [430, .05, "triangle"],
      sweep: [460, .14, "sine"], clear: [540, .34, "sine"], sting: [105, .45, "sawtooth"],
      ripple: [390, .18, "sine"]
    };
    const [freq, length, type] = recipes[kind] || recipes.open;
    const notes = kind === "clear" ? [1, 1.25, 1.5, 2] : kind === "ripple" || kind === "sweep" ? [1, 1.16, 1.34] : [1];
    notes.forEach((ratio, index) => {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * ratio + Math.min(amount, 12) * 2, now + index * .045);
      gain.gain.setValueAtTime(.0001, now + index * .045);
      gain.gain.exponentialRampToValueAtTime(kind === "sting" ? .11 : .055, now + index * .045 + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, now + index * .045 + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + index * .045);
      osc.stop(now + index * .045 + length + .02);
    });
  }

  let press = null;
  ui.board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const cell = event.target.closest(".cell");
    if (!cell || state.phase === "ended") return;
    ensureAudio();
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    press = { id: event.pointerId, x, y, sx: event.clientX, sy: event.clientY, held: false, timer: 0 };
    cell.setPointerCapture?.(event.pointerId);
    press.timer = setTimeout(() => {
      if (!press) return;
      const char = visibleRows()[y][x];
      if (char === "#") press.held = perform({ type: "flag", x, y });
      else if (char === "F") press.held = perform({ type: "unflag", x, y });
      if (press.held && navigator.vibrate) navigator.vibrate(18);
    }, 480);
  });

  ui.board.addEventListener("pointermove", (event) => {
    if (press && (Math.abs(event.clientX - press.sx) > 12 || Math.abs(event.clientY - press.sy) > 12)) {
      clearTimeout(press.timer);
      press = null;
    }
  });

  ui.board.addEventListener("pointerup", (event) => {
    if (!press || press.id !== event.pointerId) return;
    clearTimeout(press.timer);
    const current = press;
    press = null;
    if (current.held) return;
    const char = visibleRows()[current.y][current.x];
    if (char === "#") perform({ type: "open", x: current.x, y: current.y });
    else if (char >= "0" && char <= "8") perform({ type: "sweep", x: current.x, y: current.y });
  });

  ui.board.addEventListener("pointercancel", () => {
    if (press) clearTimeout(press.timer);
    press = null;
  });

  ui.board.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const cell = event.target.closest(".cell");
    if (!cell || state.phase === "ended") return;
    const x = Number(cell.dataset.x), y = Number(cell.dataset.y);
    const char = visibleRows()[y][x];
    if (char === "#") perform({ type: "flag", x, y });
    else if (char === "F") perform({ type: "unflag", x, y });
  });

  ui.ceremony.addEventListener("click", () => {
    if (state.phase === "ended") { ensureAudio(); restart(); }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "r") restart();
  });
  ui.sound.addEventListener("click", (event) => {
    event.stopPropagation();
    muted = !muted;
    ui.sound.classList.toggle("muted", muted);
    ui.sound.textContent = muted ? "×" : "♪";
    if (!muted) sound("open");
  });

  function bridgeState() {
    return snapshot(false);
  }

  function respond(request, accepted, error) {
    const envelope = {
      protocol: PROTOCOL, type: "response", requestId: request && request.requestId,
      sessionId: bridgeSession, generation: bridgeGeneration, accepted,
      revision: state.revision, state: bridgeState()
    };
    if (error) envelope.error = error;
    bridgePort.postMessage(envelope);
  }

  function reject(request, code, message) {
    respond(request, false, { code, message });
  }

  function onBridgeRequest(event) {
    const request = event.data;
    if (!request || request.protocol !== PROTOCOL ||
        request.sessionId !== bridgeSession || request.generation !== bridgeGeneration) {
      reject(request, "BAD_ENVELOPE", "Session or protocol mismatch.");
      return;
    }
    if (!("requestId" in request)) {
      reject(request, "BAD_REQUEST", "A requestId is required.");
      return;
    }
    if (request.command === "observe") {
      respond(request, true);
    } else if (request.command === "act") {
      if (request.expectedRevision !== state.revision) {
        reject(request, "STALE_REVISION", "The visible state has changed.");
      } else if (!request.action || !perform(request.action)) {
        reject(request, "ILLEGAL_ACTION", "That action is not legal now.");
      } else {
        respond(request, true);
      }
    } else if (request.command === "restart") {
      if (request.expectedRevision !== state.revision) {
        reject(request, "STALE_REVISION", "The visible state has changed.");
      } else {
        restart();
        respond(request, true);
      }
    } else {
      reject(request, "BAD_COMMAND", "Unknown command.");
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window.parent || !msg || msg.protocol !== PROTOCOL ||
        msg.type !== "connect" || typeof msg.sessionId !== "string" ||
        !Number.isInteger(msg.generation) || event.ports.length !== 1) return;
    if (bridgePort) bridgePort.close();
    bridgePort = event.ports[0];
    bridgeSession = msg.sessionId;
    bridgeGeneration = msg.generation;
    bridgePort.onmessage = onBridgeRequest;
    bridgePort.start?.();
    bridgePort.postMessage({
      protocol: PROTOCOL, type: "ready", sessionId: bridgeSession,
      generation: bridgeGeneration, accepted: true, revision: state.revision,
      state: bridgeState()
    });
  });

  window.__ARENA_GAME__ = Object.freeze({ reset, snapshot, act, restart, advance });

  let lastFrame = performance.now();
  function frame(now) {
    const delta = Math.min(250, Math.max(0, now - lastFrame));
    lastFrame = now;
    if (state.phase === "playing") advance(delta);
    requestAnimationFrame(frame);
  }

  reset("shoal");
  setTimeout(() => ui.bubble.classList.add("show"), 500);
  setTimeout(() => ui.bubble.classList.remove("show"), 3500);
  requestAnimationFrame(frame);
})();
