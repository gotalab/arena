(() => {
  "use strict";

  const PROTOCOL = "arena.game.v1";
  const SAVE_KEY = "lumen-yard-save-v1";
  const LEVELS = [
    ["first-light", "First Light", ["#######", "#...o.#", "#.....#", "#..$..#", "#.@...#", "#.....#", "#######"]],
    ["crossfeed", "Crossfeed", ["########", "#..oo..#", "#......#", "#.$.$..#", "#...@..#", "#......#", "########"]],
    ["black-start", "Black Start", ["########", "#.o.o.o#", "#......#", "#.$.$$.#", "#...@..#", "#......#", "########"]],
    ["split-bus", "Split Bus", ["########", "#.o..o.#", "#......#", "#..##..#", "#.$..$.#", "#...@..#", "#......#", "########"]],
    ["relay-bend", "Relay Bend", ["########", "#..o...#", "#....o.#", "#..#...#", "#.$.$..#", "#..@...#", "#......#", "########"]],
    ["service-loop", "Service Loop", ["#########", "#..o.o..#", "#.......#", "#.#...#.#", "#.$.$...#", "#...@...#", "#.......#", "#########"]],
    ["cold-iron", "Cold Iron", ["#########", "#..o..o.#", "#o......#", "#...#...#", "#.$$.$..#", "#...@...#", "#.......#", "#########"]],
    ["brownout", "Brownout", ["#########", "#..ooo..#", "#.......#", "#..#.#..#", "#.$.$.$.#", "#...@...#", "#.......#", "#########"]],
    ["dead-bus", "Dead Bus", ["#########", "#..ooo..#", "#.#...#.#", "#.......#", "#.$$.$..#", "#....@..#", "#.......#", "#########"]],
    ["copper-maze", "Copper Maze", ["#########", "#o..o..o#", "#.......#", "#.#.#.#.#", "#.$.$.$.#", "#...@...#", "#.......#", "#########"]],
    ["backfeed", "Backfeed", ["#########", "#o.o....#", "#...o...#", "#.#...#.#", "#.$.$.$.#", "#..@....#", "#.......#", "#########"]],
    ["load-shed", "Load Shed", ["#########", "#..o.o..#", "#o......#", "#..##...#", "#.$.$.$.#", "#....@..#", "#.......#", "#########"]],
    ["last-circuit", "Last Circuit", ["##########", "#..o.oo..#", "#....o...#", "#..##....#", "#.$.$.$..#", "#...$@...#", "#........#", "##########"]],
    ["switchyard", "Switchyard", ["#########", "#..oooo.#", "#.......#", "#.#.#...#", "#.$.$.$.#", "#..$@...#", "#.......#", "#########"]],
    ["phase-lock", "Phase Lock", ["#########", "#o.o.o..#", "#.......#", "#..###..#", "#.$...$.#", "#...$@..#", "#.......#", "#########"]],
    ["auxiliary", "Auxiliary", ["##########", "#..o.oo..#", "#o.......#", "#..#..#..#", "#.$.$.$..#", "#...$@...#", "#........#", "##########"]],
    ["redline", "Redline", ["##########", "#o.o..o.o#", "#........#", "#.#....#.#", "#.$.$.$..#", "#...$@...#", "#........#", "##########"]],
    ["island-mode", "Island Mode", ["##########", "#..oooo..#", "#........#", "#..#..#..#", "#.$.$.$..#", "#..$..@..#", "#........#", "##########"]],
    ["cascade", "Cascade", ["##########", "#o..oo..o#", "#........#", "#.#.##.#.#", "#.$.$.$..#", "#....$@..#", "#........#", "##########"]],
    ["dawn-sequence", "Dawn Sequence", ["##########", "#o..oo..o#", "#...##...#", "#........#", "#.$.$.$..#", "#...$@...#", "#........#", "##########"]]
  ];
  const LEVEL_BY_ID = new Map(LEVELS.map((level, index) => [level[0], { id: level[0], name: level[1], rows: level[2], index }]));
  const DIRS = {
    up: { row: -1, col: 0, angle: "0deg" },
    right: { row: 0, col: 1, angle: "90deg" },
    down: { row: 1, col: 0, angle: "180deg" },
    left: { row: 0, col: -1, angle: "270deg" }
  };
  const $ = (id) => document.getElementById(id);
  const els = {
    board: $("board"), boardWrap: $("boardWrap"), invitation: $("invitation"), levelName: $("levelName"),
    levelIndex: $("levelIndex"), moves: $("moves"), pushes: $("pushes"), power: $("power"), signal: $("signal"),
    undo: $("undoButton"), restart: $("restartButton"), map: $("mapDialog"), settings: $("settingsDialog"),
    levelGrid: $("levelGrid"), progress: $("campaignProgress"), mapProgress: $("mapProgress"), mapBar: $("mapBar"),
    sound: $("soundToggle"), motion: $("motionToggle"), complete: $("completeDialog"), completeKicker: $("completeKicker"),
    completeTitle: $("completeTitle"), completeCopy: $("completeCopy"), completeStats: $("completeStats"),
    next: $("nextButton"), replay: $("replayButton"), endingMap: $("endingMapButton"), toast: $("toast"), surge: $("surge")
  };

  function loadSave() {
    const fallback = {
      completed: {}, bests: {}, lastLevel: "first-light", sound: true,
      motion: !matchMedia("(prefers-reduced-motion: reduce)").matches
    };
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved || typeof saved !== "object") return fallback;
      return {
        completed: saved.completed && typeof saved.completed === "object" ? saved.completed : {},
        bests: saved.bests && typeof saved.bests === "object" ? saved.bests : {},
        lastLevel: LEVEL_BY_ID.has(saved.lastLevel) ? saved.lastLevel : fallback.lastLevel,
        sound: typeof saved.sound === "boolean" ? saved.sound : fallback.sound,
        motion: typeof saved.motion === "boolean" ? saved.motion : fallback.motion
      };
    } catch (_) { return fallback; }
  }
  let save = loadSave();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) {}
  }

  let revision = 0;
  let attempt = 1;
  let seed = null;
  let current;
  let history = [];
  let facing = "down";
  let invited = true;
  let completionTimer = 0;
  let toastTimer = 0;
  let audioCtx = null;
  let soundArmed = false;

  function coordKey(row, col) { return `${row},${col}`; }
  function sortedCoords(coords) {
    return [...coords].sort((a, b) => a.row - b.row || a.col - b.col).map(({ row, col }) => ({ row, col }));
  }
  function parseLevel(levelId) {
    const level = LEVEL_BY_ID.get(levelId);
    const walls = [], goals = [], crates = [];
    let player = null;
    level.rows.forEach((row, r) => [...row].forEach((symbol, c) => {
      if (symbol === "#") walls.push({ row: r, col: c });
      else if (symbol === "o") goals.push({ row: r, col: c });
      else if (symbol === "$") crates.push({ row: r, col: c });
      else if (symbol === "@") player = { row: r, col: c };
    }));
    return {
      levelId, width: level.rows[0].length, height: level.rows.length,
      walls, goals, crates, player, moveCount: 0, pushCount: 0, phase: "playing", outcome: null
    };
  }
  function isAt(list, row, col) { return list.some((p) => p.row === row && p.col === col); }
  function canMove(direction) {
    if (current.phase !== "playing" || !DIRS[direction]) return false;
    const delta = DIRS[direction];
    const nr = current.player.row + delta.row, nc = current.player.col + delta.col;
    if (isAt(current.walls, nr, nc)) return false;
    if (!isAt(current.crates, nr, nc)) return true;
    const br = nr + delta.row, bc = nc + delta.col;
    return !isAt(current.walls, br, bc) && !isAt(current.crates, br, bc);
  }
  function legalActions() {
    const actions = [];
    for (const direction of ["up", "down", "left", "right"]) {
      if (canMove(direction)) actions.push({ type: "move", direction });
    }
    if (history.length) actions.push({ type: "undo" });
    for (const [levelId] of LEVELS) actions.push({ type: "select_level", levelId });
    return actions;
  }
  function publicState() {
    const poweredGoals = current.goals.filter((goal) => isAt(current.crates, goal.row, goal.col)).length;
    return {
      revision, attempt, phase: current.phase, outcome: current.outcome, levelId: current.levelId,
      width: current.width, height: current.height,
      walls: sortedCoords(current.walls), goals: sortedCoords(current.goals), crates: sortedCoords(current.crates),
      player: { row: current.player.row, col: current.player.col },
      poweredGoals, moveCount: current.moveCount, pushCount: current.pushCount,
      undoAvailable: history.length > 0, legalActions: legalActions()
    };
  }
  function snapshot() { return structuredClone(publicState()); }
  function gameError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  function actionIsExact(action) {
    if (!action || typeof action !== "object" || Array.isArray(action)) return false;
    const keys = Object.keys(action).sort().join(",");
    if (action.type === "move") return keys === "direction,type" && Object.hasOwn(DIRS, action.direction);
    if (action.type === "undo") return keys === "type";
    if (action.type === "select_level") return keys === "levelId,type" && typeof action.levelId === "string";
    return false;
  }

  function applyAction(action, source = "api") {
    if (!actionIsExact(action)) throw gameError("INVALID_ACTION", "Action does not match the task action schema.");
    if (action.type === "move") {
      if (current.phase === "complete") throw gameError("PHASE_COMPLETE", "Movement is frozen after completion.");
      if (!canMove(action.direction)) throw gameError("ILLEGAL_ACTION", "That direction is blocked.");
      const before = {
        player: { ...current.player }, crates: current.crates.map((p) => ({ ...p })),
        moveCount: current.moveCount, pushCount: current.pushCount, phase: current.phase, outcome: current.outcome,
        facing
      };
      history.push(before);
      const delta = DIRS[action.direction];
      const nr = current.player.row + delta.row, nc = current.player.col + delta.col;
      const crate = current.crates.find((p) => p.row === nr && p.col === nc);
      let seated = false;
      if (crate) {
        crate.row += delta.row;
        crate.col += delta.col;
        current.pushCount++;
        seated = isAt(current.goals, crate.row, crate.col);
      }
      current.player = { row: nr, col: nc };
      current.moveCount++;
      facing = action.direction;
      const powered = current.goals.filter((goal) => isAt(current.crates, goal.row, goal.col)).length;
      if (powered === current.goals.length) {
        current.phase = "complete";
        current.outcome = "powered";
        recordCompletion();
      }
      revision++;
      render({ kind: crate ? "push" : "step", seated, source });
      return snapshot();
    }
    if (action.type === "undo") {
      if (!history.length) throw gameError("ILLEGAL_ACTION", "There is no move to undo.");
      const previous = history.pop();
      current.player = previous.player;
      current.crates = previous.crates;
      current.moveCount = previous.moveCount;
      current.pushCount = previous.pushCount;
      current.phase = previous.phase;
      current.outcome = previous.outcome;
      facing = previous.facing;
      revision++;
      clearTimeout(completionTimer);
      if (els.complete.open) els.complete.close();
      render({ kind: "undo", source });
      return snapshot();
    }
    if (!LEVEL_BY_ID.has(action.levelId)) throw gameError("UNKNOWN_LEVEL", "Unknown board ID.");
    startLevel(action.levelId, true);
    return snapshot();
  }

  function startLevel(levelId, advanceRevision = true) {
    current = parseLevel(levelId);
    history = [];
    attempt++;
    facing = "down";
    save.lastLevel = levelId;
    persist();
    if (advanceRevision) revision++;
    clearTimeout(completionTimer);
    if (els.complete.open) els.complete.close();
    if (els.map.open) els.map.close();
    render({ kind: "start" });
  }
  function restartCurrent() {
    startLevel(current.levelId, true);
    return snapshot();
  }
  function resetGame(newSeed) {
    seed = newSeed;
    revision++;
    attempt++;
    current = parseLevel("first-light");
    history = [];
    facing = "down";
    save.lastLevel = "first-light";
    persist();
    if (els.complete.open) els.complete.close();
    if (els.map.open) els.map.close();
    render({ kind: "start" });
    return snapshot();
  }
  function recordCompletion() {
    save.completed[current.levelId] = true;
    const oldBest = save.bests[current.levelId];
    if (!Number.isInteger(oldBest) || current.moveCount < oldBest) save.bests[current.levelId] = current.moveCount;
    persist();
  }

  function render(effect = {}) {
    const state = publicState();
    const level = LEVEL_BY_ID.get(current.levelId);
    els.levelName.textContent = level.name;
    els.levelIndex.textContent = `Circuit ${String(level.index + 1).padStart(2, "0")}`;
    els.moves.textContent = state.moveCount;
    els.pushes.textContent = state.pushCount;
    els.power.textContent = `${state.poweredGoals}/${current.goals.length}`;
    els.undo.disabled = !state.undoAvailable;
    els.signal.classList.toggle("powered", state.poweredGoals > 0);
    els.signal.querySelector("span").textContent = current.phase === "complete" ? "Grid singing" : state.poweredGoals ? "Current holding" : "Source idling";
    const completedCount = Object.keys(save.completed).filter((id) => LEVEL_BY_ID.has(id) && save.completed[id]).length;
    els.progress.textContent = `${completedCount} of 20 circuits`;
    els.mapProgress.textContent = `${completedCount}/20`;
    els.mapBar.style.width = `${completedCount * 5}%`;
    document.body.classList.toggle("no-motion", !save.motion);
    els.sound.checked = save.sound;
    els.motion.checked = save.motion;
    els.board.style.setProperty("--cols", current.width);
    els.board.style.setProperty("--rows", current.height);
    els.board.classList.toggle("complete", current.phase === "complete");
    const goalKeys = new Set(current.goals.map((p) => coordKey(p.row, p.col)));
    const crateKeys = new Set(current.crates.map((p) => coordKey(p.row, p.col)));
    els.board.replaceChildren();
    for (let row = 0; row < current.height; row++) {
      for (let col = 0; col < current.width; col++) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `tile ${isAt(current.walls, row, col) ? "wall" : "floor"}`;
        tile.setAttribute("role", "gridcell");
        tile.tabIndex = -1;
        tile.dataset.row = row;
        tile.dataset.col = col;
        if (isAt(current.walls, row, col)) {
          tile.disabled = true;
          tile.innerHTML = '<i class="wall-bolt"></i>';
        } else {
          tile.setAttribute("aria-label", tileLabel(row, col, goalKeys, crateKeys));
          tile.innerHTML = '<i class="cable"></i>';
          if (goalKeys.has(coordKey(row, col))) {
            const socket = document.createElement("i");
            socket.className = `socket ${crateKeys.has(coordKey(row, col)) ? "powered" : ""}`;
            tile.append(socket);
          }
          if (crateKeys.has(coordKey(row, col))) {
            const crate = document.createElement("i");
            crate.className = `crate ${goalKeys.has(coordKey(row, col)) ? "powered" : ""}`;
            tile.append(crate);
          }
          if (current.player.row === row && current.player.col === col) {
            const robot = document.createElement("i");
            robot.className = "robot idle";
            robot.style.setProperty("--facing", DIRS[facing].angle);
            robot.innerHTML = '<i class="robot-antenna"></i><i class="robot-head"></i><i class="robot-body"></i>';
            tile.append(robot);
          }
        }
        els.board.append(tile);
      }
    }
    renderMap();
    if (effect.kind === "push") {
      requestAnimationFrame(() => {
        els.board.querySelector(".robot")?.classList.add("pushing");
        if (effect.seated) els.board.querySelector(".robot")?.classList.add("relief");
      });
      playSound(effect.seated ? "seat" : "push");
    } else if (effect.kind === "step") playSound("step");
    else if (effect.kind === "undo") playSound("undo");
    if (current.phase === "complete" && effect.kind === "push") {
      els.surge.classList.remove("active");
      void els.surge.offsetWidth;
      els.surge.classList.add("active");
      playSound("complete");
      completionTimer = setTimeout(showCompletion, save.motion ? 700 : 120);
    }
  }
  function tileLabel(row, col, goalKeys, crateKeys) {
    const key = coordKey(row, col);
    const parts = [`Row ${row + 1}, column ${col + 1}`];
    if (current.player.row === row && current.player.col === col) parts.push("Pip the maintenance robot");
    if (crateKeys.has(key)) parts.push(goalKeys.has(key) ? "powered relay core" : "relay core");
    else if (goalKeys.has(key)) parts.push("empty copper socket");
    else parts.push("yard floor");
    return parts.join(", ");
  }
  function renderMap() {
    els.levelGrid.replaceChildren();
    LEVELS.forEach(([id, name], index) => {
      const button = document.createElement("button");
      const done = !!save.completed[id], best = save.bests[id];
      button.type = "button";
      button.className = `level-card ${done ? "done" : ""} ${id === current.levelId ? "current" : ""}`;
      button.dataset.level = id;
      button.setAttribute("aria-label", `${index + 1}. ${name}${done ? `, restored, best ${best} moves` : ""}${id === current.levelId ? ", current board" : ""}`);
      button.innerHTML = `<span class="num">${done ? "✓" : String(index + 1).padStart(2, "0")}</span><span><span class="name">${name}</span><span class="best">${done ? `BEST · ${best} MOVES` : "UNRESTORED"}</span></span><span class="state-mark">${id === current.levelId ? "◆" : ""}</span>`;
      els.levelGrid.append(button);
    });
  }

  function showCompletion() {
    const level = LEVEL_BY_ID.get(current.levelId);
    const doneCount = Object.values(save.completed).filter(Boolean).length;
    const chapter = level.index === 2;
    const final = level.index === 19 && doneCount === 20;
    const earlyDawn = level.index === 19 && !final;
    els.complete.classList.toggle("final", final);
    els.completeKicker.textContent = chapter ? "GRID RESTORED" : final ? "FINAL DAWN" : "CIRCUIT RESTORED";
    els.completeTitle.textContent = chapter ? "The east grid wakes." : final ? "The whole yard is alive." : earlyDawn ? "Dawn circuit online." : "Current is flowing.";
    els.completeCopy.textContent = chapter
      ? "Opening restoration complete. New yards are ready beyond the gate."
      : final ? "Twenty circuits carry the morning beyond the yard."
      : earlyDawn ? "This circuit shines, but unfinished circuits still wait on the board map."
      : "The relay seats with a heavy click. The yard hums a little brighter.";
    const totalBest = LEVELS.reduce((sum, [id]) => sum + (save.bests[id] || 0), 0);
    els.completeStats.innerHTML = final
      ? `<div><strong>20/20</strong><span>Restored</span></div><div><strong>${totalBest}</strong><span>Total best moves</span></div>`
      : `<div><strong>${current.moveCount}</strong><span>Moves</span></div><div><strong>${current.pushCount}</strong><span>Pushes</span></div><div><strong>${save.bests[current.levelId]}</strong><span>Best</span></div>`;
    if (final) {
      els.next.textContent = "Replay the dawn";
      els.next.dataset.action = "replay";
    } else if (earlyDawn) {
      els.next.textContent = "Find unfinished circuits →";
      els.next.dataset.action = "map";
    } else {
      els.next.innerHTML = level.index === 2 ? "Continue beyond the gate <span>→</span>" : "Next circuit <span>→</span>";
      els.next.dataset.action = "next";
    }
    els.endingMap.hidden = !final;
    if (!els.complete.open) els.complete.showModal();
    els.next.focus();
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1100);
  }
  function armSound() {
    soundArmed = true;
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
    }
    audioCtx?.resume();
  }
  function playSound(kind) {
    if (!save.sound || !soundArmed || !audioCtx) return;
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    const osc = audioCtx.createOscillator();
    const config = {
      step: [120, 85, .045, .035, "sine"], push: [74, 46, .12, .11, "triangle"],
      blocked: [92, 70, .06, .06, "square"], undo: [240, 110, .16, .07, "sine"],
      seat: [110, 260, .22, .12, "triangle"], complete: [75, 520, .75, .13, "sawtooth"]
    }[kind];
    if (!config) return;
    osc.type = config[4];
    osc.frequency.setValueAtTime(config[0], now);
    osc.frequency.exponentialRampToValueAtTime(config[1], now + config[2]);
    gain.gain.setValueAtTime(config[3], now);
    gain.gain.exponentialRampToValueAtTime(.001, now + config[2]);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now); osc.stop(now + config[2]);
    if (kind === "complete") {
      [196, 294, 392].forEach((frequency, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine"; o.frequency.value = frequency;
        g.gain.setValueAtTime(.001, now + .16 + i * .06);
        g.gain.exponentialRampToValueAtTime(.045, now + .25 + i * .06);
        g.gain.exponentialRampToValueAtTime(.001, now + .8);
        o.connect(g).connect(audioCtx.destination); o.start(now); o.stop(now + .82);
      });
    }
  }
  function humanMove(direction) {
    armSound();
    if (invited) { invited = false; els.invitation.classList.add("hidden"); }
    try { applyAction({ type: "move", direction }, "human"); }
    catch (error) {
      if (error.code === "ILLEGAL_ACTION" || error.code === "PHASE_COMPLETE") {
        playSound("blocked");
        const robot = els.board.querySelector(".robot");
        robot?.classList.remove("idle");
        robot?.classList.add("blocked");
        toast(current.phase === "complete" ? "Circuit complete — undo or continue" : "Path blocked");
      }
    }
  }

  let suppressClickUntil = 0;
  els.board.addEventListener("click", (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    const tile = event.target.closest(".tile");
    if (!tile || tile.disabled) return;
    const dr = Number(tile.dataset.row) - current.player.row;
    const dc = Number(tile.dataset.col) - current.player.col;
    if (Math.abs(dr) + Math.abs(dc) !== 1) { toast("Tap a tile beside Pip"); return; }
    humanMove(dr === -1 ? "up" : dr === 1 ? "down" : dc === -1 ? "left" : "right");
  });
  let pointerStart = null;
  els.boardWrap.addEventListener("pointerdown", (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
  });
  els.boardWrap.addEventListener("pointerup", (event) => {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    event.preventDefault();
    suppressClickUntil = Date.now() + 400;
    humanMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  els.boardWrap.addEventListener("pointercancel", () => { pointerStart = null; });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]")) return;
    const direction = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right"
    }[event.code];
    if (direction) { event.preventDefault(); humanMove(direction); return; }
    if (event.code === "KeyU" || event.code === "Backspace") {
      event.preventDefault(); armSound();
      try { applyAction({ type: "undo" }, "human"); } catch (_) { toast("Nothing to undo"); }
    } else if (event.code === "KeyR") {
      event.preventDefault(); armSound(); restartCurrent(); playSound("undo");
    }
  });
  els.undo.addEventListener("click", () => {
    armSound();
    try { applyAction({ type: "undo" }, "human"); } catch (_) { toast("Nothing to undo"); }
  });
  els.restart.addEventListener("click", () => { armSound(); restartCurrent(); playSound("undo"); });
  function openMap() { renderMap(); if (!els.map.open) els.map.showModal(); }
  $("mapButton").addEventListener("click", openMap);
  $("campaignButton").addEventListener("click", openMap);
  $("settingsButton").addEventListener("click", () => els.settings.showModal());
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
  [els.map, els.settings, els.complete].forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  els.levelGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (!button) return;
    armSound(); applyAction({ type: "select_level", levelId: button.dataset.level }, "human");
  });
  els.sound.addEventListener("change", () => {
    save.sound = els.sound.checked; persist(); if (save.sound) { armSound(); playSound("seat"); }
  });
  els.motion.addEventListener("change", () => { save.motion = els.motion.checked; persist(); render(); });
  els.replay.addEventListener("click", () => { armSound(); els.complete.close(); restartCurrent(); });
  els.next.addEventListener("click", () => {
    armSound();
    const action = els.next.dataset.action;
    els.complete.close();
    if (action === "map") openMap();
    else if (action === "replay") restartCurrent();
    else {
      const nextIndex = Math.min(LEVEL_BY_ID.get(current.levelId).index + 1, LEVELS.length - 1);
      applyAction({ type: "select_level", levelId: LEVELS[nextIndex][0] }, "human");
    }
  });
  els.endingMap.addEventListener("click", () => { els.complete.close(); openMap(); });

  let previousPad = {};
  function pollGamepad() {
    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const pressed = {
        up: pad.buttons[12]?.pressed || pad.axes[1] < -.55,
        down: pad.buttons[13]?.pressed || pad.axes[1] > .55,
        left: pad.buttons[14]?.pressed || pad.axes[0] < -.55,
        right: pad.buttons[15]?.pressed || pad.axes[0] > .55,
        primary: pad.buttons[0]?.pressed, secondary: pad.buttons[1]?.pressed, start: pad.buttons[9]?.pressed
      };
      for (const direction of ["up", "down", "left", "right"]) {
        if (pressed[direction] && !previousPad[direction] && !document.querySelector("dialog[open]")) humanMove(direction);
      }
      if (pressed.primary && !previousPad.primary) {
        armSound();
        if (document.activeElement instanceof HTMLElement && document.activeElement.matches("button:not(:disabled)")) document.activeElement.click();
      }
      if (pressed.secondary && !previousPad.secondary && !els.complete.open) {
        armSound(); try { applyAction({ type: "undo" }, "human"); } catch (_) { toast("Nothing to undo"); }
      }
      if (pressed.start && !previousPad.start) {
        armSound();
        if (document.querySelector("dialog[open]")) document.querySelector("dialog[open]").close();
        else openMap();
      }
      previousPad = pressed;
    } else previousPad = {};
    requestAnimationFrame(pollGamepad);
  }

  const seenRequests = new Set();
  let activePort = null;
  function responseEnvelope(requestId, accepted, error) {
    const envelope = {
      protocol: PROTOCOL, type: "response", requestId,
      sessionId: bridgeSession, generation: bridgeGeneration, accepted, revision,
      state: snapshot()
    };
    if (error) envelope.error = { code: error.code || "REQUEST_REJECTED", message: error.message || "Request rejected." };
    return envelope;
  }
  let bridgeSession = null, bridgeGeneration = null;
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.protocol !== PROTOCOL || data.type !== "connect") return;
    if (typeof data.sessionId !== "string" || !Number.isInteger(data.generation) || event.ports.length !== 1) return;
    activePort?.close();
    activePort = event.ports[0];
    bridgeSession = data.sessionId;
    bridgeGeneration = data.generation;
    seenRequests.clear();
    activePort.onmessage = handleBridgeRequest;
    activePort.start();
    activePort.postMessage({
      protocol: PROTOCOL, type: "ready", sessionId: bridgeSession, generation: bridgeGeneration,
      accepted: true, revision, state: snapshot()
    });
  });
  function handleBridgeRequest(event) {
    const request = event.data;
    if (!request || request.protocol !== PROTOCOL || request.sessionId !== bridgeSession || request.generation !== bridgeGeneration) return;
    const requestId = request.requestId;
    if ((typeof requestId !== "string" && typeof requestId !== "number") || !["observe", "act", "restart"].includes(request.command)) {
      activePort.postMessage(responseEnvelope(requestId, false, gameError("INVALID_REQUEST", "Malformed request envelope.")));
      return;
    }
    if (seenRequests.has(requestId)) {
      activePort.postMessage(responseEnvelope(requestId, false, gameError("DUPLICATE_REQUEST", "That requestId was already used.")));
      return;
    }
    seenRequests.add(requestId);
    if (request.command === "observe") {
      activePort.postMessage(responseEnvelope(requestId, true));
      return;
    }
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== revision) {
      activePort.postMessage(responseEnvelope(requestId, false, gameError("STALE_REVISION", "expectedRevision does not match current revision.")));
      return;
    }
    try {
      if (request.command === "act") applyAction(request.action, "bridge");
      else restartCurrent();
      activePort.postMessage(responseEnvelope(requestId, true));
    } catch (error) {
      activePort.postMessage(responseEnvelope(requestId, false, error));
    }
  }

  window.__ARENA_GAME__ = Object.freeze({
    reset: (newSeed) => resetGame(newSeed),
    snapshot,
    act: (action) => applyAction(action, "api"),
    restart: restartCurrent
  });

  current = parseLevel(save.lastLevel);
  attempt = 1;
  render({ kind: "start" });
  requestAnimationFrame(pollGamepad);
})();
