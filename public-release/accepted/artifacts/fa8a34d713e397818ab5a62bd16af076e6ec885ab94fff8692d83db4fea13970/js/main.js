import { Game } from "./engine.js";
import { LEVEL_IDS, LEVEL_META, nextLevelId, PARSED_LEVELS } from "./levels.js";
import { YardRenderer } from "./render.js";
import { YardAudio } from "./audio.js";
import { installArena } from "./arena.js";
import {
  loadSave,
  writeSave,
  prefersReducedMotion,
  restoredCount,
  bestTotal,
} from "./persist.js";

const game = new Game();
const save = loadSave();
const audio = new YardAudio();
const canvas = document.getElementById("yard");
const renderer = new YardRenderer(canvas);

const els = {
  app: document.getElementById("app"),
  boardName: document.getElementById("board-name"),
  moves: document.getElementById("stat-moves"),
  pushes: document.getElementById("stat-pushes"),
  power: document.getElementById("stat-power"),
  undo: document.getElementById("btn-undo"),
  restart: document.getElementById("btn-restart"),
  map: document.getElementById("btn-map"),
  settings: document.getElementById("btn-settings"),
  drawer: document.getElementById("drawer"),
  mapGrid: document.getElementById("map-grid"),
  mapClose: document.getElementById("btn-map-close"),
  mapRestart: document.getElementById("btn-map-restart"),
  settingsPane: document.getElementById("settings"),
  settingsClose: document.getElementById("btn-settings-close"),
  togSound: document.getElementById("tog-sound"),
  togSoundState: document.getElementById("tog-sound-state"),
  togMotion: document.getElementById("tog-motion"),
  togMotionState: document.getElementById("tog-motion-state"),
  invite: document.getElementById("invite"),
  plaque: document.getElementById("plaque"),
  plaqueEye: document.getElementById("plaque-eye"),
  plaqueTitle: document.getElementById("plaque-title"),
  plaqueBody: document.getElementById("plaque-body"),
  plaqueMeta: document.getElementById("plaque-meta"),
  plaqueActions: document.getElementById("plaque-actions"),
};

if (save.motion == null) save.motion = !prefersReducedMotion();
audio.setEnabled(save.sound);
renderer.setMotion(save.motion);
document.documentElement.classList.toggle("reduced-motion", !save.motion);

if (save.lastLevelId && PARSED_LEVELS[save.lastLevelId] && save.lastLevelId !== "first-light") {
  game._applyBoard(save.lastLevelId, { bumpAttempt: false, resetAttempt: true });
}

if (save.seenInvite) hideInvite(true);

let swipe = null;
let gamepadPrev = { buttons: [], axes: [] };
let stickHeld = null;
let stickAt = 0;
let focusIndex = 0;

function persist() {
  writeSave(save);
}

function hideInvite(immediate) {
  if (!els.invite) return;
  els.invite.classList.add("is-gone");
  if (immediate) els.invite.hidden = true;
  else setTimeout(() => {
    els.invite.hidden = true;
  }, 360);
  save.seenInvite = true;
  persist();
}

function unlock() {
  audio.unlock();
  if (!save.seenInvite) hideInvite();
}

function present(state, fx) {
  if (fx && fx.direction) renderer.facing = fx.direction;
  renderer.apply(state, fx || null);
  renderer.draw(performance.now());
  syncHud(state);
  return state;
}

function recordProgress(state) {
  save.lastLevelId = state.levelId;
  if (state.phase === "complete") {
    save.restored[state.levelId] = true;
    const best = save.bests[state.levelId];
    if (typeof best !== "number" || state.moveCount < best) {
      save.bests[state.levelId] = state.moveCount;
    }
  }
  persist();
}

function commitAction(action) {
  const { state, fx } = game.applyWithFx(action);
  present(state, fx);
  playFx(fx);
  recordProgress(state);
  if (fx && fx.kind === "complete") {
    queueMicrotask(() => {
      const primary = els.plaqueActions.querySelector("button.primary");
      if (primary) primary.focus();
    });
  }
  return state;
}

function commitRestart() {
  const state = game.restart();
  present(state, { kind: "restart" });
  recordProgress(state);
  return state;
}

function commitReset(seed) {
  const state = game.reset(seed);
  present(state, { kind: "restart" });
  save.lastLevelId = "first-light";
  persist();
  return state;
}

function playFx(fx) {
  if (!fx) return;
  if (fx.kind === "step") audio.step();
  else if (fx.kind === "push") audio.push();
  else if (fx.kind === "seat") audio.seat();
  else if (fx.kind === "complete") {
    audio.seat();
    audio.surge();
  } else if (fx.kind === "undo") audio.undo();
}

function refuse() {
  renderer.refuse();
  audio.blocked();
}

function tryMove(direction) {
  unlock();
  const action = { type: "move", direction };
  if (!game.isLegal(action)) {
    refuse();
    return false;
  }
  commitAction(action);
  return true;
}

function tryUndo() {
  unlock();
  const action = { type: "undo" };
  if (!game.isLegal(action)) return false;
  commitAction(action);
  return true;
}

function tryRestart() {
  unlock();
  commitRestart();
  return true;
}

function trySelect(levelId) {
  unlock();
  closeSheets();
  commitAction({ type: "select_level", levelId });
  return true;
}

function syncHud(state) {
  const meta = LEVEL_META[state.levelId];
  els.boardName.textContent = meta ? meta.title : state.levelId;
  els.moves.textContent = String(state.moveCount);
  els.pushes.textContent = String(state.pushCount);
  els.power.textContent = `${state.poweredGoals}/${state.goals.length}`;
  els.undo.disabled = !state.undoAvailable;
  document.title = `Lumen Yard — ${meta ? meta.title : state.levelId}`;
  renderMap(state);
  renderPlaque(state);
  syncToggles();
}

function syncToggles() {
  els.togSound.setAttribute("aria-pressed", save.sound ? "true" : "false");
  els.togSoundState.textContent = save.sound ? "On" : "Off";
  els.togMotion.setAttribute("aria-pressed", save.motion ? "true" : "false");
  els.togMotionState.textContent = save.motion ? "On" : "Off";
}

function renderMap(state) {
  els.mapGrid.replaceChildren();
  LEVEL_IDS.forEach((id, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-cell";
    btn.dataset.levelId = id;
    const live = !!save.restored[id];
    const current = id === state.levelId;
    if (live) btn.classList.add("is-live");
    if (current) {
      btn.classList.add("is-current");
      btn.setAttribute("aria-current", "true");
    }
    btn.setAttribute(
      "aria-label",
      `${i + 1}. ${LEVEL_META[id].title}. ${live ? "Restored" : "Dark"}${current ? ". Current board" : ""}`,
    );
    const best = save.bests[id];
    const title = LEVEL_META[id].title;
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = String(i + 1).padStart(2, "0");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = title;
    const detail = document.createElement("span");
    detail.className = "detail";
    const bits = [];
    if (current) bits.push("Now");
    if (live) bits.push("Restored");
    else bits.push("Dark");
    if (typeof best === "number") bits.push(`Best ${best}`);
    detail.textContent = bits.join(" · ");
    btn.append(num, name, detail);
    btn.addEventListener("click", () => trySelect(id));
    els.mapGrid.append(btn);
  });
}

function button(label, className, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener("click", onClick);
  return b;
}

function renderPlaque(state) {
  const complete = state.phase === "complete";
  if (!complete) {
    els.plaque.hidden = true;
    els.plaque.classList.remove("chapter", "finale");
    return;
  }

  const all = restoredCount(save) >= 20 && !!save.restored["dawn-sequence"];
  const isFinaleBoard = state.levelId === "dawn-sequence";
  const isChapter = state.levelId === "black-start";
  const next = nextLevelId(state.levelId);
  const best = save.bests[state.levelId];
  const metaBits = [
    `${state.moveCount} moves`,
    `${state.pushCount} pushes`,
  ];
  if (typeof best === "number") metaBits.push(`best ${best}`);

  els.plaque.hidden = false;
  els.plaque.classList.toggle("chapter", isChapter && !all);
  els.plaque.classList.toggle("finale", all && isFinaleBoard);
  els.plaqueActions.replaceChildren();

  if (all && isFinaleBoard) {
    els.plaqueEye.textContent = "Campaign";
    els.plaqueTitle.textContent = "The yard wakes";
    els.plaqueBody.textContent =
      "Twenty circuits hold. Dawn takes the copper. Yard crew: Night Shift Three, Lumen Municipal.";
    els.plaqueMeta.textContent = `20/20 restored · best-path total ${bestTotal(save)} · ${metaBits.join(" · ")}`;
    els.plaqueActions.append(
      button("Replay dawn", "primary", () => tryRestart()),
      button("Board map", "", () => openDrawer()),
    );
    return;
  }

  if (isFinaleBoard) {
    const n = restoredCount(save);
    els.plaqueEye.textContent = "Dawn Sequence";
    els.plaqueTitle.textContent = "This bay holds";
    els.plaqueBody.textContent =
      `Dawn is seated here, but ${20 - n} circuit${20 - n === 1 ? "" : "s"} still sleep. Finish the unfinished bays before the yard can wake.`;
    els.plaqueMeta.textContent = `${n}/20 restored · ${metaBits.join(" · ")}`;
    els.plaqueActions.append(
      button("Board map", "primary", () => openDrawer()),
      button("Replay", "", () => tryRestart()),
    );
    return;
  }

  if (isChapter) {
    els.plaqueEye.textContent = "Opening restoration";
    els.plaqueTitle.textContent = "GRID RESTORED";
    els.plaqueBody.textContent =
      "The first bay answers. Three relays lock, and the service road beyond the glass finds a pulse.";
    els.plaqueMeta.textContent = metaBits.join(" · ");
    els.plaqueActions.append(
      button("Continue", "primary", () => trySelect("split-bus")),
      button("Replay", "", () => tryRestart()),
    );
    return;
  }

  els.plaqueEye.textContent = "Circuit live";
  els.plaqueTitle.textContent = `${LEVEL_META[state.levelId].title} holds`;
  els.plaqueBody.textContent = "The last core seats with a heavy click. Current runs the copper.";
  els.plaqueMeta.textContent = metaBits.join(" · ");
  if (next) {
    els.plaqueActions.append(
      button(`Next: ${LEVEL_META[next].title}`, "primary", () => trySelect(next)),
      button("Replay", "", () => tryRestart()),
    );
  } else {
    els.plaqueActions.append(
      button("Board map", "primary", () => openDrawer()),
      button("Replay", "", () => tryRestart()),
    );
  }
}

function openDrawer() {
  unlock();
  els.settingsPane.hidden = true;
  els.settings.setAttribute("aria-expanded", "false");
  els.drawer.hidden = false;
  els.map.setAttribute("aria-expanded", "true");
  const current = els.mapGrid.querySelector(".is-current");
  (current || els.mapClose).focus();
}

function closeDrawer() {
  els.drawer.hidden = true;
  els.map.setAttribute("aria-expanded", "false");
}

function openSettings() {
  unlock();
  els.drawer.hidden = true;
  els.map.setAttribute("aria-expanded", "false");
  els.settingsPane.hidden = false;
  els.settings.setAttribute("aria-expanded", "true");
  els.togSound.focus();
}

function closeSettings() {
  els.settingsPane.hidden = true;
  els.settings.setAttribute("aria-expanded", "false");
}

function closeSheets() {
  closeDrawer();
  closeSettings();
}

function adjacentDir(from, to) {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return null;
  if (dr === -1) return "up";
  if (dr === 1) return "down";
  if (dc === -1) return "left";
  if (dc === 1) return "right";
  return null;
}

function onYardPointerDown(ev) {
  if (ev.button != null && ev.button !== 0) return;
  unlock();
  const cell = renderer.cellAt(ev.clientX, ev.clientY);
  swipe = {
    x: ev.clientX,
    y: ev.clientY,
    id: ev.pointerId,
    cell,
    moved: false,
  };
  canvas.setPointerCapture?.(ev.pointerId);
}

function onYardPointerMove(ev) {
  if (!swipe || ev.pointerId !== swipe.id) return;
  const dx = ev.clientX - swipe.x;
  const dy = ev.clientY - swipe.y;
  if (Math.hypot(dx, dy) > 12) swipe.moved = true;
}

function onYardPointerUp(ev) {
  if (!swipe || ev.pointerId !== swipe.id) {
    swipe = null;
    return;
  }
  const dx = ev.clientX - swipe.x;
  const dy = ev.clientY - swipe.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= 28) {
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    tryMove(dir);
  } else if (!swipe.moved) {
    const cell = renderer.cellAt(ev.clientX, ev.clientY) || swipe.cell;
    if (cell) {
      const dir = adjacentDir(game.player, cell);
      if (dir) tryMove(dir);
    }
  }
  swipe = null;
}

const KEY_DIR = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
  W: "up",
  A: "left",
  S: "down",
  D: "right",
};

function overlayOpen() {
  return !els.drawer.hidden || !els.settingsPane.hidden;
}

function plaqueOpen() {
  return !els.plaque.hidden;
}

function collectFocusables() {
  const root = !els.drawer.hidden
    ? els.drawer
    : !els.settingsPane.hidden
      ? els.settingsPane
      : plaqueOpen()
        ? els.plaque
        : els.app;
  return [...root.querySelectorAll("button:not([disabled])")];
}

function activateFocused() {
  const list = collectFocusables();
  if (!list.length) return;
  const el = list[Math.max(0, Math.min(focusIndex, list.length - 1))];
  el.click();
}

function moveFocus(delta) {
  const list = collectFocusables();
  if (!list.length) return;
  focusIndex = (focusIndex + delta + list.length) % list.length;
  list[focusIndex].focus();
}

window.addEventListener("keydown", (ev) => {
  unlock();
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(ev.key)) {
    ev.preventDefault();
  }
  if (ev.key === "Escape") {
    closeSheets();
    return;
  }
  if (overlayOpen()) {
    if (ev.key === "ArrowDown" || ev.key === "ArrowRight" || ev.key === "s" || ev.key === "d") {
      moveFocus(1);
      return;
    }
    if (ev.key === "ArrowUp" || ev.key === "ArrowLeft" || ev.key === "w" || ev.key === "a") {
      moveFocus(-1);
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      activateFocused();
      return;
    }
  }
  const dir = KEY_DIR[ev.key];
  if (dir) {
    if (game.phase === "playing") tryMove(dir);
    return;
  }
  if (ev.key === "u" || ev.key === "U" || ev.key === "Backspace") {
    ev.preventDefault();
    tryUndo();
    return;
  }
  if (ev.key === "r" || ev.key === "R") {
    tryRestart();
  }
});

canvas.addEventListener("pointerdown", onYardPointerDown);
canvas.addEventListener("pointermove", onYardPointerMove);
canvas.addEventListener("pointerup", onYardPointerUp);
canvas.addEventListener("pointercancel", () => {
  swipe = null;
});
canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

els.undo.addEventListener("click", () => tryUndo());
els.restart.addEventListener("click", () => tryRestart());
els.map.addEventListener("click", () => {
  if (els.drawer.hidden) openDrawer();
  else closeDrawer();
});
els.mapClose.addEventListener("click", () => closeDrawer());
els.mapRestart.addEventListener("click", () => {
  closeDrawer();
  tryRestart();
});
els.settings.addEventListener("click", () => {
  if (els.settingsPane.hidden) openSettings();
  else closeSettings();
});
els.settingsClose.addEventListener("click", () => closeSettings());
els.togSound.addEventListener("click", () => {
  save.sound = !save.sound;
  audio.setEnabled(save.sound);
  if (save.sound) audio.unlock();
  persist();
  syncToggles();
});
els.togMotion.addEventListener("click", () => {
  save.motion = !save.motion;
  renderer.setMotion(save.motion);
  document.documentElement.classList.toggle("reduced-motion", !save.motion);
  persist();
  syncToggles();
});

function layout() {
  renderer.resize();
  renderer.draw(performance.now());
}

window.addEventListener("resize", layout);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", layout);
}

function loop(now) {
  renderer.draw(now);
  pollGamepad(now);
  requestAnimationFrame(loop);
}

function padPressed(gp, i, prev) {
  return gp.buttons[i] && gp.buttons[i].pressed && !(prev.buttons[i] && prev.buttons[i].pressed);
}

function pollGamepad(now) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
  if (!gp) return;
  const prev = gamepadPrev;
  if (padPressed(gp, 1, prev)) tryUndo();
  if (padPressed(gp, 8, prev)) tryRestart();
  if (padPressed(gp, 9, prev)) {
    if (overlayOpen()) closeSheets();
    else openDrawer();
  }
  if (padPressed(gp, 0, prev)) {
    if (overlayOpen() || plaqueOpen()) activateFocused();
  }
  const dpad = [
    [12, "up"],
    [13, "down"],
    [14, "left"],
    [15, "right"],
  ];
  for (const [i, dir] of dpad) {
    if (padPressed(gp, i, prev)) {
      if (overlayOpen() || plaqueOpen()) moveFocus(dir === "down" || dir === "right" ? 1 : -1);
      else tryMove(dir);
    }
  }
  const axX = gp.axes[0] || 0;
  const axY = gp.axes[1] || 0;
  let stickDir = null;
  if (Math.abs(axX) > 0.55 || Math.abs(axY) > 0.55) {
    stickDir = Math.abs(axX) > Math.abs(axY)
      ? (axX > 0 ? "right" : "left")
      : (axY > 0 ? "down" : "up");
  }
  if (stickDir) {
    if (overlayOpen() || plaqueOpen()) {
      if (stickDir !== stickHeld || now - stickAt > 220) {
        moveFocus(stickDir === "down" || stickDir === "right" ? 1 : -1);
        stickHeld = stickDir;
        stickAt = now;
      }
    } else if (stickDir !== stickHeld || now - stickAt > 200) {
      tryMove(stickDir);
      stickHeld = stickDir;
      stickAt = now;
    }
  } else {
    stickHeld = null;
  }
  gamepadPrev = {
    buttons: gp.buttons.map((b) => ({ pressed: !!b.pressed })),
    axes: gp.axes.slice(),
  };
}

window.addEventListener("gamepadconnected", () => {
  /* polling handles it */
});

installArena({
  snapshot: () => game.snapshot(),
  getRevision: () => game.revision,
  act(action) {
    const state = commitAction(action);
    return state;
  },
  restart: () => commitRestart(),
  reset: (seed) => commitReset(seed),
});

present(game.snapshot(), null);
layout();
requestAnimationFrame(loop);
