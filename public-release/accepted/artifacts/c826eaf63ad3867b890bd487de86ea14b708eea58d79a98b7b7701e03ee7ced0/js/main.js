import { GameEngine, DIRS, actionsEqual } from "./engine.js";
import { LEVELS, LEVEL_IDS, CHAPTER_END_ID, FINAL_ID, hasCell } from "./levels.js";
import { loadSave, writeSave } from "./persist.js";
import { YardAudio } from "./audio.js";
import { installArenaBridge } from "./arena.js";

const engine = new GameEngine();
const audio = new YardAudio();
let save = loadSave();

/** @type {'title'|'play'|'chapter'|'boardDone'|'finale'} */
let uiMode = "title";
let renderToken = 0;

const els = {
  app: document.getElementById("app"),
  yard: document.getElementById("yard"),
  yardWrap: document.getElementById("yard-wrap"),
  boardName: document.getElementById("board-name"),
  moveCount: document.getElementById("move-count"),
  pushCount: document.getElementById("push-count"),
  powerCount: document.getElementById("power-count"),
  titleOverlay: document.getElementById("title-overlay"),
  chapterBanner: document.getElementById("chapter-banner"),
  boardBanner: document.getElementById("board-banner"),
  boardBannerKicker: document.getElementById("board-banner-kicker"),
  boardBannerTitle: document.getElementById("board-banner-title"),
  boardBannerCopy: document.getElementById("board-banner-copy"),
  finaleBanner: document.getElementById("finale-banner"),
  finaleCopy: document.getElementById("finale-copy"),
  btnUndo: document.getElementById("btn-undo"),
  btnRestart: document.getElementById("btn-restart"),
  btnBoards: document.getElementById("btn-boards"),
  btnSettings: document.getElementById("btn-settings"),
  drawer: document.getElementById("board-drawer"),
  drawerClose: document.getElementById("drawer-close"),
  drawerProgress: document.getElementById("drawer-progress"),
  boardGrid: document.getElementById("board-grid"),
  scrim: document.getElementById("scrim"),
  settings: document.getElementById("settings-panel"),
  settingsClose: document.getElementById("settings-close"),
  toggleSound: document.getElementById("toggle-sound"),
  toggleMotion: document.getElementById("toggle-motion"),
  chapterContinue: document.getElementById("chapter-continue"),
  chapterReplay: document.getElementById("chapter-replay"),
  bannerNext: document.getElementById("banner-next"),
  bannerReplay: document.getElementById("banner-replay"),
  bannerMap: document.getElementById("banner-map"),
  finaleReplay: document.getElementById("finale-replay"),
  finaleMap: document.getElementById("finale-map"),
};

function applyPrefs() {
  audio.setEnabled(save.sound);
  els.toggleSound.checked = save.sound;
  els.toggleMotion.checked = save.motion;
  els.app.classList.toggle("reduced-motion", !save.motion);
}

function persist() {
  writeSave(save);
}

function unlockAudio() {
  audio.unlock();
}

/**
 * Apply an action through the shared engine, then paint.
 * @param {import('./engine.js').Action} action
 * @param {{ silentReject?: boolean }} [opts]
 */
function commitAction(action, opts = {}) {
  unlockAudio();
  const before = engine.snapshot();
  const legal = before.legalActions.some((a) => actionsEqual(a, action));
  if (!legal) {
    if (action.type === "move" && before.phase === "playing") {
      flashBlocked(action.direction);
      audio.play("blocked");
    }
    return null;
  }

  const result = engine.applyAction(action);
  if (!result.ok) {
    if (!opts.silentReject && action.type === "move" && before.phase === "playing") {
      flashBlocked(action.direction);
      audio.play("blocked");
    }
    return null;
  }

  if (result.fx) audio.play(result.fx === "step" ? "step" : result.fx);
  afterMutation(result.state, result.fx);
  return result.state;
}

/**
 * @param {import('./engine.js').VisibleState} state
 * @param {string|null} fx
 */
function afterMutation(state, fx) {
  if (state.phase === "complete" && state.outcome === "powered") {
    markRestored(state.levelId, state.moveCount);
  }

  save.lastBoardId = state.levelId;
  persist();

  paint(state, fx);

  if (state.phase === "complete") {
    handleCompletion(state);
  }
}

/** @param {string} levelId @param {number} moves */
function markRestored(levelId, moves) {
  save.restored[levelId] = true;
  const prev = save.bestMoves[levelId];
  if (prev == null || moves < prev) save.bestMoves[levelId] = moves;
  persist();
}

/** @param {import('./engine.js').VisibleState} state */
function handleCompletion(state) {
  const allDone = LEVEL_IDS.every((id) => save.restored[id]);
  const isFinale = state.levelId === FINAL_ID && allDone;

  // Early dawn: celebrate board but not campaign
  if (state.levelId === FINAL_ID && !allDone) {
    uiMode = "boardDone";
    showBoardBanner(state, {
      kicker: "Dawn sequence live",
      title: "Circuit sealed",
      copy: unfinishedCopy(),
      showNext: true,
    });
    return;
  }

  if (isFinale) {
    uiMode = "finale";
    showFinale();
    return;
  }

  if (state.levelId === CHAPTER_END_ID) {
    uiMode = "chapter";
    els.chapterBanner.classList.remove("hidden");
    els.boardBanner.classList.add("hidden");
    els.finaleBanner.classList.add("hidden");
    els.titleOverlay.classList.add("hidden");
    return;
  }

  uiMode = "boardDone";
  const idx = LEVEL_IDS.indexOf(state.levelId);
  const hasNext = idx >= 0 && idx < LEVEL_IDS.length - 1;
  showBoardBanner(state, {
    kicker: "Circuit live",
    title: "Yard powered",
    copy: hasNext
      ? `Best: ${save.bestMoves[state.levelId] ?? state.moveCount} moves. Continue when ready.`
      : `Best: ${save.bestMoves[state.levelId] ?? state.moveCount} moves.`,
    showNext: hasNext,
  });
}

function unfinishedCopy() {
  const left = LEVEL_IDS.filter((id) => !save.restored[id]).length;
  return `Dawn is lit, but ${left} circuit${left === 1 ? "" : "s"} still sleep. Open the board map to finish the yard.`;
}

/**
 * @param {import('./engine.js').VisibleState} state
 * @param {{ kicker: string, title: string, copy: string, showNext: boolean }} cfg
 */
function showBoardBanner(state, cfg) {
  els.boardBannerKicker.textContent = cfg.kicker;
  els.boardBannerTitle.textContent = cfg.title;
  els.boardBannerCopy.textContent = cfg.copy;
  els.bannerNext.classList.toggle("hidden", !cfg.showNext);
  els.boardBanner.classList.remove("hidden");
  els.chapterBanner.classList.add("hidden");
  els.finaleBanner.classList.add("hidden");
  els.titleOverlay.classList.add("hidden");
}

function showFinale() {
  const totalBest = LEVEL_IDS.reduce((sum, id) => sum + (save.bestMoves[id] || 0), 0);
  els.finaleCopy.textContent = `20/20 restored · ${totalBest} best-move total`;
  els.finaleBanner.classList.remove("hidden");
  els.boardBanner.classList.add("hidden");
  els.chapterBanner.classList.add("hidden");
  els.titleOverlay.classList.add("hidden");
}

function hideBanners() {
  els.chapterBanner.classList.add("hidden");
  els.boardBanner.classList.add("hidden");
  els.finaleBanner.classList.add("hidden");
}

/** @param {'up'|'down'|'left'|'right'} direction */
function flashBlocked(direction) {
  const d = DIRS[direction];
  if (!d) return;
  const state = engine.snapshot();
  const r = state.player.row + d.dr;
  const c = state.player.col + d.dc;
  const cell = els.yard.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (!cell) return;
  cell.classList.remove("is-blocked-flash");
  // force reflow
  void cell.offsetWidth;
  cell.classList.add("is-blocked-flash");
  window.setTimeout(() => cell.classList.remove("is-blocked-flash"), 280);

  const robot = els.yard.querySelector(".robot");
  if (robot) {
    robot.classList.add("is-pushing");
    window.setTimeout(() => robot.classList.remove("is-pushing"), 120);
  }
}

/**
 * @param {import('./engine.js').VisibleState} [state]
 * @param {string|null} [fx]
 */
function paint(state = engine.snapshot(), fx = null) {
  const token = ++renderToken;
  els.boardName.textContent = engine.getLevelName();
  els.moveCount.textContent = String(state.moveCount);
  els.pushCount.textContent = String(state.pushCount);
  els.powerCount.textContent = `${state.poweredGoals}/${state.goals.length}`;

  els.btnUndo.disabled = !state.undoAvailable;
  els.titleOverlay.classList.toggle("hidden", !engine.isTitlePending() || uiMode !== "title");

  els.yardWrap.style.aspectRatio = `${state.width} / ${state.height}`;

  renderBoard(state, fx);
  renderBoardGrid(state);

  if (token !== renderToken) return;
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

/**
 * @param {import('./engine.js').VisibleState} state
 * @param {string|null} fx
 */
function renderBoard(state, fx) {
  const { width, height, walls, goals, crates, player } = state;
  els.yard.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
  els.yard.style.gridTemplateRows = `repeat(${height}, 1fr)`;
  els.yard.classList.toggle("is-complete", state.phase === "complete");
  els.yard.classList.toggle("is-undoing", fx === "undo");
  if (fx === "undo") {
    window.setTimeout(() => els.yard.classList.remove("is-undoing"), save.motion ? 280 : 0);
  }

  const frag = document.createDocumentFragment();
  const legalMoves = new Set(
    state.legalActions
      .filter((a) => a.type === "move")
      .map((a) => a.direction)
  );

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      const isWall = hasCell(walls, row, col);
      if (isWall) {
        cell.classList.add("cell--wall");
      } else {
        cell.classList.add("cell--floor");
        if ((row + col) % 2 === 0) {
          const cable = document.createElement("div");
          cable.className = row % 2 === 0 ? "cable" : "cable cable--v";
          cell.appendChild(cable);
        }

        if (hasCell(goals, row, col)) {
          const sock = document.createElement("div");
          const powered = hasCell(crates, row, col);
          sock.className = `socket ${powered ? "socket--powered" : "socket--empty"}`;
          sock.setAttribute("aria-label", powered ? "Powered socket" : "Empty socket");
          cell.appendChild(sock);
        }

        if (hasCell(crates, row, col)) {
          const relay = document.createElement("div");
          relay.className = "relay";
          if (hasCell(goals, row, col)) relay.classList.add("is-seated");
          if (fx === "push" || fx === "seat" || fx === "complete") relay.classList.add("is-pushing");
          cell.appendChild(relay);
        }

        if (player.row === row && player.col === col) {
          const robot = document.createElement("div");
          robot.className = "robot";
          robot.dataset.facing = engine.getFacing();
          if (fx === "push" || fx === "seat") robot.classList.add("is-pushing");
          if (fx === "seat" || fx === "complete") robot.classList.add("is-relief");
          robot.innerHTML =
            '<div class="robot__body"></div><div class="robot__visor"><span class="robot__eye robot__eye--l"></span><span class="robot__eye robot__eye--r"></span></div><div class="robot__arm robot__arm--l"></div><div class="robot__arm robot__arm--r"></div><div class="robot__tread"></div>';
          cell.appendChild(robot);
        }

        // Click targets for adjacent legal moves
        for (const dir of legalMoves) {
          const d = DIRS[dir];
          if (player.row + d.dr === row && player.col + d.dc === col) {
            cell.classList.add("is-target");
            cell.tabIndex = 0;
            cell.setAttribute("role", "button");
            cell.setAttribute("aria-label", `Move ${dir}`);
            cell.addEventListener("click", (e) => {
              e.stopPropagation();
              beginPlay();
              commitAction({ type: "move", direction: dir });
            });
            cell.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                beginPlay();
                commitAction({ type: "move", direction: dir });
              }
            });
          }
        }
      }

      frag.appendChild(cell);
    }
  }

  const sheen = document.createElement("div");
  sheen.className = "cable-sheen";
  sheen.setAttribute("aria-hidden", "true");

  els.yard.replaceChildren(frag);
  els.yard.appendChild(sheen);
}

/** @param {import('./engine.js').VisibleState} state */
function renderBoardGrid(state) {
  const restoredCount = LEVEL_IDS.filter((id) => save.restored[id]).length;
  els.drawerProgress.textContent = `${restoredCount}/20 restored · last: ${engine.getLevelName()}`;

  const frag = document.createDocumentFragment();
  LEVELS.forEach((level, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "board-card";
    if (save.restored[level.id]) btn.classList.add("is-restored");
    if (level.id === state.levelId) btn.setAttribute("aria-current", "true");
    const best = save.bestMoves[level.id];
    btn.innerHTML = `
      <span class="board-card__idx">Board ${String(i + 1).padStart(2, "0")}</span>
      <span class="board-card__name">${level.name}</span>
      <span class="board-card__best">${best != null ? `Best ${best}` : "No best yet"}</span>
      ${save.restored[level.id] ? '<span class="board-card__badge" aria-label="Restored">Live</span>' : ""}
    `;
    btn.addEventListener("click", () => {
      closeOverlays();
      beginPlay();
      hideBanners();
      uiMode = "play";
      commitAction({ type: "select_level", levelId: level.id });
    });
    frag.appendChild(btn);
  });
  els.boardGrid.replaceChildren(frag);
}

function beginPlay() {
  if (uiMode === "title") {
    uiMode = "play";
    els.titleOverlay.classList.add("hidden");
  }
}

function openDrawer() {
  closeSettings();
  els.drawer.classList.remove("hidden");
  els.scrim.classList.remove("hidden");
  els.scrim.hidden = false;
  els.btnBoards.setAttribute("aria-expanded", "true");
  audio.play("ui");
  renderBoardGrid(engine.snapshot());
}

function closeDrawer() {
  els.drawer.classList.add("hidden");
  els.btnBoards.setAttribute("aria-expanded", "false");
  maybeClearScrim();
}

function openSettings() {
  closeDrawer();
  els.settings.classList.remove("hidden");
  els.scrim.classList.remove("hidden");
  els.scrim.hidden = false;
  els.btnSettings.setAttribute("aria-expanded", "true");
  audio.play("ui");
}

function closeSettings() {
  els.settings.classList.add("hidden");
  els.btnSettings.setAttribute("aria-expanded", "false");
  maybeClearScrim();
}

function closeOverlays() {
  closeDrawer();
  closeSettings();
}

function maybeClearScrim() {
  if (els.drawer.classList.contains("hidden") && els.settings.classList.contains("hidden")) {
    els.scrim.classList.add("hidden");
    els.scrim.hidden = true;
  }
}

function nextLevel() {
  const idx = engine.getLevelIndex();
  if (idx < 0 || idx >= LEVEL_IDS.length - 1) return;
  hideBanners();
  uiMode = "play";
  commitAction({ type: "select_level", levelId: LEVEL_IDS[idx + 1] });
}

function replayLevel() {
  hideBanners();
  uiMode = "play";
  doRestart();
}

function doRestart() {
  unlockAudio();
  engine.restart();
  audio.play("restart");
  save.lastBoardId = engine.snapshot().levelId;
  persist();
  paint(engine.snapshot(), "restart");
}

function doUndo() {
  commitAction({ type: "undo" });
}

// ——— Input ———

/** @param {'up'|'down'|'left'|'right'} dir */
function tryMove(dir) {
  beginPlay();
  commitAction({ type: "move", direction: dir });
}

const KEY_DIRS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  W: "up",
  s: "down",
  S: "down",
  a: "left",
  A: "left",
  d: "right",
  D: "right",
};

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  if (e.key === "Escape") {
    closeOverlays();
    return;
  }

  const dir = KEY_DIRS[e.key];
  if (dir) {
    e.preventDefault();
    tryMove(dir);
    return;
  }
  if (e.key === "u" || e.key === "U" || e.key === "Backspace") {
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    doRestart();
  }
});

// Touch swipe + pointer
let pointerStart = null;
let didSwipe = false;

els.yardWrap.addEventListener(
  "pointerdown",
  (e) => {
    if (e.button != null && e.button !== 0) return;
    didSwipe = false;
    pointerStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try {
      els.yardWrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  },
  { passive: true }
);

els.yardWrap.addEventListener("pointerup", (e) => {
  if (!pointerStart || pointerStart.id !== e.pointerId) return;
  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  pointerStart = null;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const thresh = 24;
  if (Math.max(absX, absY) < thresh) return;
  didSwipe = true;
  if (absX > absY) tryMove(dx > 0 ? "right" : "left");
  else tryMove(dy > 0 ? "down" : "up");
});

els.yardWrap.addEventListener("pointercancel", () => {
  pointerStart = null;
});

els.yard.addEventListener(
  "click",
  (e) => {
    if (didSwipe) {
      e.stopPropagation();
      e.preventDefault();
      didSwipe = false;
    }
  },
  true
);

// Dock controls
els.btnUndo.addEventListener("click", () => doUndo());
els.btnRestart.addEventListener("click", () => doRestart());
els.btnBoards.addEventListener("click", () => {
  if (els.drawer.classList.contains("hidden")) openDrawer();
  else closeDrawer();
});
els.btnSettings.addEventListener("click", () => {
  if (els.settings.classList.contains("hidden")) openSettings();
  else closeSettings();
});
els.drawerClose.addEventListener("click", () => closeDrawer());
els.settingsClose.addEventListener("click", () => closeSettings());
els.scrim.addEventListener("click", () => closeOverlays());

els.toggleSound.addEventListener("change", () => {
  save.sound = els.toggleSound.checked;
  audio.setEnabled(save.sound);
  persist();
  unlockAudio();
  audio.play("ui");
});

els.toggleMotion.addEventListener("change", () => {
  save.motion = els.toggleMotion.checked;
  els.app.classList.toggle("reduced-motion", !save.motion);
  persist();
});

els.chapterContinue.addEventListener("click", () => {
  hideBanners();
  uiMode = "play";
  commitAction({ type: "select_level", levelId: "split-bus" });
});
els.chapterReplay.addEventListener("click", () => replayLevel());
els.bannerNext.addEventListener("click", () => nextLevel());
els.bannerReplay.addEventListener("click", () => replayLevel());
els.bannerMap.addEventListener("click", () => {
  hideBanners();
  uiMode = "play";
  openDrawer();
});
els.finaleReplay.addEventListener("click", () => replayLevel());
els.finaleMap.addEventListener("click", () => {
  hideBanners();
  uiMode = "play";
  openDrawer();
});

// Gamepad
const padState = { x: 0, y: 0, cool: 0, a: false, b: false, start: false };

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && (pads[0] || pads[1]);
  if (!pad) {
    requestAnimationFrame(pollGamepad);
    return;
  }
  const now = performance.now();
  const ax = pad.axes[0] || 0;
  const ay = pad.axes[1] || 0;
  const dx =
    (pad.buttons[14] && pad.buttons[14].pressed) || ax < -0.5
      ? -1
      : (pad.buttons[15] && pad.buttons[15].pressed) || ax > 0.5
        ? 1
        : 0;
  const dy =
    (pad.buttons[12] && pad.buttons[12].pressed) || ay < -0.5
      ? -1
      : (pad.buttons[13] && pad.buttons[13].pressed) || ay > 0.5
        ? 1
        : 0;

  if (now > padState.cool) {
    if (dx || dy) {
      if (dx === -1) tryMove("left");
      else if (dx === 1) tryMove("right");
      else if (dy === -1) tryMove("up");
      else if (dy === 1) tryMove("down");
      padState.cool = now + 180;
    }
  }

  const a = !!(pad.buttons[0] && pad.buttons[0].pressed);
  const b = !!(pad.buttons[1] && pad.buttons[1].pressed);
  const start = !!(pad.buttons[9] && pad.buttons[9].pressed);

  if (a && !padState.a) {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && typeof focused.click === "function") focused.click();
  }
  if (b && !padState.b) doUndo();
  if (start && !padState.start) {
    if (els.drawer.classList.contains("hidden")) openDrawer();
    else closeDrawer();
  }

  padState.a = a;
  padState.b = b;
  padState.start = start;
  requestAnimationFrame(pollGamepad);
}
requestAnimationFrame(pollGamepad);

// ——— Arena API ———

function snapshotClone() {
  return engine.snapshot();
}

window.__ARENA_GAME__ = {
  /**
   * @param {unknown} seed
   */
  reset(seed) {
    uiMode = "title";
    hideBanners();
    closeOverlays();
    const state = engine.reset(seed);
    paint(state, null);
    return state;
  },
  snapshot() {
    return snapshotClone();
  },
  /**
   * @param {import('./engine.js').Action} action
   */
  act(action) {
    const beforeRev = engine.revision;
    const result = engine.applyAction(action, { fromArena: true });
    if (!result.ok) {
      const err = new Error(result.error.message);
      // @ts-ignore
      err.code = result.error.code;
      throw err;
    }
    // Synchronous paint first so visible board updates before return
    if (result.state.phase === "complete" && result.state.outcome === "powered") {
      markRestored(result.state.levelId, result.state.moveCount);
    }
    save.lastBoardId = result.state.levelId;
    persist();

    // Force synchronous DOM update
    els.yardWrap.style.aspectRatio = `${result.state.width} / ${result.state.height}`;
    renderBoard(result.state, result.fx);
    els.boardName.textContent = engine.getLevelName();
    els.moveCount.textContent = String(result.state.moveCount);
    els.pushCount.textContent = String(result.state.pushCount);
    els.powerCount.textContent = `${result.state.poweredGoals}/${result.state.goals.length}`;
    els.btnUndo.disabled = !result.state.undoAvailable;
    els.titleOverlay.classList.add("hidden");
    engine.titlePending = false;
    uiMode = result.state.phase === "complete" ? uiMode : "play";

    if (result.state.phase === "complete") {
      handleCompletion(result.state);
    } else {
      hideBanners();
    }
    renderBoardGrid(result.state);

    if (result.fx && save.sound) {
      unlockAudio();
      audio.play(result.fx === "step" ? "step" : result.fx);
    }

    void beforeRev;
    return result.state;
  },
  restart() {
    engine.restart();
    hideBanners();
    uiMode = "play";
    engine.titlePending = false;
    const state = engine.snapshot();
    els.yardWrap.style.aspectRatio = `${state.width} / ${state.height}`;
    renderBoard(state, "restart");
    els.boardName.textContent = engine.getLevelName();
    els.moveCount.textContent = String(state.moveCount);
    els.pushCount.textContent = String(state.pushCount);
    els.powerCount.textContent = `${state.poweredGoals}/${state.goals.length}`;
    els.btnUndo.disabled = !state.undoAvailable;
    els.titleOverlay.classList.add("hidden");
    save.lastBoardId = state.levelId;
    persist();
    renderBoardGrid(state);
    return state;
  },
};

installArenaBridge({
  getState: () => engine.snapshot(),
  observe: () => engine.snapshot(),
  act(action, expectedRevision) {
    if (expectedRevision !== engine.revision) {
      return {
        accepted: false,
        state: engine.snapshot(),
        error: { code: "stale_revision", message: "Revision mismatch" },
      };
    }
    const result = engine.applyAction(action, { expectedRevision, fromArena: true });
    if (!result.ok) {
      return { accepted: false, state: result.state, error: result.error };
    }
    if (result.state.phase === "complete" && result.state.outcome === "powered") {
      markRestored(result.state.levelId, result.state.moveCount);
    }
    save.lastBoardId = result.state.levelId;
    persist();
    els.yardWrap.style.aspectRatio = `${result.state.width} / ${result.state.height}`;
    renderBoard(result.state, result.fx);
    els.boardName.textContent = engine.getLevelName();
    els.moveCount.textContent = String(result.state.moveCount);
    els.pushCount.textContent = String(result.state.pushCount);
    els.powerCount.textContent = `${result.state.poweredGoals}/${result.state.goals.length}`;
    els.btnUndo.disabled = !result.state.undoAvailable;
    els.titleOverlay.classList.add("hidden");
    engine.titlePending = false;
    if (result.state.phase === "complete") handleCompletion(result.state);
    else hideBanners();
    renderBoardGrid(result.state);
    return { accepted: true, state: result.state };
  },
  restart(expectedRevision) {
    if (expectedRevision !== engine.revision) {
      return {
        accepted: false,
        state: engine.snapshot(),
        error: { code: "stale_revision", message: "Revision mismatch" },
      };
    }
    engine.restart();
    hideBanners();
    uiMode = "play";
    engine.titlePending = false;
    const state = engine.snapshot();
    els.yardWrap.style.aspectRatio = `${state.width} / ${state.height}`;
    renderBoard(state, "restart");
    els.boardName.textContent = engine.getLevelName();
    els.moveCount.textContent = String(state.moveCount);
    els.pushCount.textContent = String(state.pushCount);
    els.powerCount.textContent = `${state.poweredGoals}/${state.goals.length}`;
    els.btnUndo.disabled = !state.undoAvailable;
    els.titleOverlay.classList.add("hidden");
    save.lastBoardId = state.levelId;
    persist();
    renderBoardGrid(state);
    return { accepted: true, state };
  },
  getRevision: () => engine.revision,
});

// Boot: restore last board preference for human play; Arena reset owns seed path
applyPrefs();
if (save.lastBoardId && LEVEL_IDS.includes(save.lastBoardId)) {
  engine.resumeLevel(save.lastBoardId);
  uiMode = "title";
}
paint(engine.snapshot(), null);

// Prevent browser swipe navigation / scroll
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.target instanceof Element && e.target.closest(".drawer, .settings")) return;
    e.preventDefault();
  },
  { passive: false }
);
