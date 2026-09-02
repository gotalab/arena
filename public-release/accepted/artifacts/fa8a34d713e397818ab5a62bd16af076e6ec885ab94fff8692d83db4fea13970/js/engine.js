import {
  LEVEL_IDS,
  PARSED_LEVELS,
  nextLevelId,
  sortCells,
} from "./levels.js";

export { LEVEL_IDS, nextLevelId };

const DIRS = Object.freeze({
  up: { row: -1, col: 0 },
  down: { row: 1, col: 0 },
  left: { row: 0, col: -1 },
  right: { row: 0, col: 1 },
});

const DIR_NAMES = Object.freeze(["up", "down", "left", "right"]);

export class ArenaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ArenaError";
    this.code = code;
  }
}

function key(row, col) {
  return `${row},${col}`;
}

function cellEq(a, b) {
  return a.row === b.row && a.col === b.col;
}

function cloneCell(c) {
  return { row: c.row, col: c.col };
}

function cloneCells(arr) {
  return arr.map(cloneCell);
}

function setOf(cells) {
  const s = new Set();
  for (const c of cells) s.add(key(c.row, c.col));
  return s;
}

function countPowered(goals, crates) {
  const crateSet = setOf(crates);
  let n = 0;
  for (const g of goals) {
    if (crateSet.has(key(g.row, g.col))) n += 1;
  }
  return n;
}

function isComplete(goals, crates) {
  if (crates.length === 0) return false;
  const goalSet = setOf(goals);
  return crates.every((c) => goalSet.has(key(c.row, c.col)));
}

function wallSet(level) {
  return setOf(level.walls);
}

function inBounds(level, row, col) {
  return row >= 0 && col >= 0 && row < level.height && col < level.width;
}

function freezeAction(action) {
  if (action.type === "move") {
    return Object.freeze({ type: "move", direction: action.direction });
  }
  if (action.type === "undo") return Object.freeze({ type: "undo" });
  if (action.type === "select_level") {
    return Object.freeze({ type: "select_level", levelId: action.levelId });
  }
  return action;
}

function actionsEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "move") return a.direction === b.direction;
  if (a.type === "undo") return true;
  if (a.type === "select_level") return a.levelId === b.levelId;
  return false;
}

function isKnownAction(action) {
  if (!action || typeof action !== "object") return false;
  if (action.type === "move") {
    return DIR_NAMES.includes(action.direction) && Object.keys(action).length === 2;
  }
  if (action.type === "undo") return Object.keys(action).length === 1;
  if (action.type === "select_level") {
    return typeof action.levelId === "string" && Object.keys(action).length === 2;
  }
  return false;
}

export class Game {
  constructor() {
    this.seed = 0;
    this.revision = 0;
    this.attempt = 1;
    this.levelId = "first-light";
    this.level = PARSED_LEVELS["first-light"];
    this.player = cloneCell(this.level.player);
    this.crates = cloneCells(this.level.crates);
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = "playing";
    this.outcome = null;
    this.undoStack = [];
    this.facing = "right";
    this._applyBoard("first-light", { bumpAttempt: false, resetAttempt: true });
  }

  reset(seed) {
    this.seed = seed == null ? 0 : seed;
    this._applyBoard("first-light", { bumpAttempt: false, resetAttempt: true });
    this.revision = 0;
    return this.snapshot();
  }

  restart() {
    this._applyBoard(this.levelId, { bumpAttempt: true });
    this.revision += 1;
    return this.snapshot();
  }

  snapshot() {
    return this._visible();
  }

  act(action) {
    const result = this._applyAction(action);
    if (!result.ok) {
      throw new ArenaError(result.code, result.message);
    }
    return this.snapshot();
  }

  /** Dry-run helper for human input. Does not mutate. */
  isLegal(action) {
    return this._legalActions().some((a) => actionsEqual(a, action));
  }

  peekMove(direction) {
    return this._simulateMove(direction);
  }

  _visible() {
    const poweredGoals = countPowered(this.level.goals, this.crates);
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.levelId,
      width: this.level.width,
      height: this.level.height,
      walls: cloneCells(this.level.walls),
      goals: cloneCells(this.level.goals),
      crates: sortCells(this.crates),
      player: cloneCell(this.player),
      poweredGoals,
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.undoStack.length > 0,
      legalActions: this._legalActions(),
    };
  }

  _legalActions() {
    const actions = [];
    if (this.phase === "playing") {
      for (const dir of DIR_NAMES) {
        const sim = this._simulateMove(dir);
        if (sim.ok) actions.push(freezeAction({ type: "move", direction: dir }));
      }
    }
    if (this.undoStack.length > 0) {
      actions.push(freezeAction({ type: "undo" }));
    }
    for (const id of LEVEL_IDS) {
      actions.push(freezeAction({ type: "select_level", levelId: id }));
    }
    return actions;
  }

  _simulateMove(direction) {
    if (this.phase !== "playing") {
      return { ok: false, code: "illegal_action", message: "Movement is frozen" };
    }
    const delta = DIRS[direction];
    if (!delta) {
      return { ok: false, code: "illegal_action", message: "Unknown direction" };
    }
    const nr = this.player.row + delta.row;
    const nc = this.player.col + delta.col;
    const walls = wallSet(this.level);
    if (!inBounds(this.level, nr, nc) || walls.has(key(nr, nc))) {
      return { ok: false, code: "illegal_action", message: "Blocked by wall", blocked: true };
    }
    const crates = this.crates;
    const crateIndex = crates.findIndex((c) => c.row === nr && c.col === nc);
    if (crateIndex >= 0) {
      const br = nr + delta.row;
      const bc = nc + delta.col;
      if (!inBounds(this.level, br, bc) || walls.has(key(br, bc))) {
        return { ok: false, code: "illegal_action", message: "Relay has no path", blocked: true };
      }
      if (crates.some((c) => c.row === br && c.col === bc)) {
        return { ok: false, code: "illegal_action", message: "Cannot push two relays", blocked: true };
      }
      const nextCrates = crates.map((c, i) =>
        i === crateIndex ? { row: br, col: bc } : cloneCell(c),
      );
      const goalSet = setOf(this.level.goals);
      const seated = goalSet.has(key(br, bc)) && !goalSet.has(key(nr, nc));
      const completed = isComplete(this.level.goals, nextCrates);
      return {
        ok: true,
        pushed: true,
        seated,
        completed,
        player: { row: nr, col: nc },
        crates: nextCrates,
        from: cloneCell(this.player),
        crateFrom: { row: nr, col: nc },
        crateTo: { row: br, col: bc },
      };
    }
    return {
      ok: true,
      pushed: false,
      seated: false,
      completed: false,
      player: { row: nr, col: nc },
      crates: cloneCells(crates),
      from: cloneCell(this.player),
    };
  }

  _applyAction(action) {
    if (!isKnownAction(action)) {
      if (action && action.type === "select_level") {
        return { ok: false, code: "unknown_level", message: "Unknown board" };
      }
      if (action && action.type === "move") {
        return { ok: false, code: "illegal_action", message: "Illegal action" };
      }
      return { ok: false, code: "illegal_action", message: "Illegal action" };
    }

    if (action.type === "select_level") {
      if (!PARSED_LEVELS[action.levelId]) {
        return { ok: false, code: "unknown_level", message: "Unknown board" };
      }
      this._applyBoard(action.levelId, { bumpAttempt: true });
      this.revision += 1;
      return { ok: true, fx: { kind: "select", levelId: action.levelId } };
    }

    if (action.type === "undo") {
      if (this.undoStack.length === 0) {
        return { ok: false, code: "illegal_action", message: "Nothing to undo" };
      }
      const prev = this.undoStack.pop();
      this.player = cloneCell(prev.player);
      this.crates = cloneCells(prev.crates);
      this.moveCount = prev.moveCount;
      this.pushCount = prev.pushCount;
      this.phase = prev.phase;
      this.outcome = prev.outcome;
      this.facing = prev.facing;
      this.revision += 1;
      return { ok: true, fx: { kind: "undo", player: cloneCell(this.player) } };
    }

    if (action.type === "move") {
      const sim = this._simulateMove(action.direction);
      if (!sim.ok) return sim;
      this.undoStack.push({
        player: cloneCell(this.player),
        crates: cloneCells(this.crates),
        moveCount: this.moveCount,
        pushCount: this.pushCount,
        phase: this.phase,
        outcome: this.outcome,
        facing: this.facing,
      });
      this.player = cloneCell(sim.player);
      this.crates = sortCells(sim.crates);
      this.moveCount += 1;
      if (sim.pushed) this.pushCount += 1;
      this.facing = action.direction;
      if (sim.completed) {
        this.phase = "complete";
        this.outcome = "powered";
      }
      this.revision += 1;
      return {
        ok: true,
        fx: {
          kind: sim.completed ? "complete" : sim.seated ? "seat" : sim.pushed ? "push" : "step",
          direction: action.direction,
          pushed: sim.pushed,
          seated: sim.seated,
          from: sim.from,
          to: sim.player,
          crateFrom: sim.crateFrom,
          crateTo: sim.crateTo,
        },
      };
    }

    return { ok: false, code: "illegal_action", message: "Illegal action" };
  }

  applyWithFx(action) {
    const result = this._applyAction(action);
    if (!result.ok) {
      throw new ArenaError(result.code, result.message);
    }
    return { state: this.snapshot(), fx: result.fx };
  }

  _applyBoard(levelId, { bumpAttempt = false, resetAttempt = false } = {}) {
    const level = PARSED_LEVELS[levelId];
    this.levelId = levelId;
    this.level = level;
    this.player = cloneCell(level.player);
    this.crates = cloneCells(level.crates);
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = "playing";
    this.outcome = null;
    this.undoStack = [];
    this.facing = "right";
    if (resetAttempt) this.attempt = 1;
    else if (bumpAttempt) this.attempt += 1;
  }
}

export function createGame() {
  return new Game();
}
