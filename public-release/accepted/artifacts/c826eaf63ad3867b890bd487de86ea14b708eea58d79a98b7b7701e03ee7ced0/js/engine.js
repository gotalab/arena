import {
  LEVELS,
  LEVEL_BY_ID,
  LEVEL_IDS,
  parseLevel,
  sortCells,
  hasCell,
} from "./levels.js";

const DIRS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

const DIR_KEYS = Object.keys(DIRS);

/**
 * @typedef {{ type: 'move', direction: 'up'|'down'|'left'|'right' }
 *   | { type: 'undo' }
 *   | { type: 'select_level', levelId: string }} Action
 */

/**
 * @typedef {{
 *   revision: number,
 *   attempt: number,
 *   phase: 'playing'|'complete',
 *   outcome: null|'powered',
 *   levelId: string,
 *   width: number,
 *   height: number,
 *   walls: {row:number,col:number}[],
 *   goals: {row:number,col:number}[],
 *   crates: {row:number,col:number}[],
 *   player: {row:number,col:number},
 *   poweredGoals: number,
 *   moveCount: number,
 *   pushCount: number,
 *   undoAvailable: boolean,
 *   legalActions: Action[],
 * }} VisibleState
 */

/**
 * @typedef {{
 *   player: {row:number,col:number},
 *   crates: {row:number,col:number}[],
 *   moveCount: number,
 *   pushCount: number,
 *   phase: 'playing'|'complete',
 *   outcome: null|'powered',
 *   facing: 'up'|'down'|'left'|'right',
 * }} HistoryFrame
 */

export class GameEngine {
  constructor() {
    /** @type {number} */
    this.seed = 0;
    /** @type {number} */
    this.revision = 0;
    /** @type {number} */
    this.attempt = 1;
    /** @type {string} */
    this.levelId = "first-light";
    /** @type {ReturnType<typeof parseLevel>} */
    this.board = parseLevel(LEVEL_BY_ID["first-light"]);
    /** @type {{row:number,col:number}} */
    this.player = { ...this.board.player };
    /** @type {{row:number,col:number}[]} */
    this.crates = this.board.crates.map((c) => ({ ...c }));
    /** @type {number} */
    this.moveCount = 0;
    /** @type {number} */
    this.pushCount = 0;
    /** @type {'playing'|'complete'} */
    this.phase = "playing";
    /** @type {null|'powered'} */
    this.outcome = null;
    /** @type {'up'|'down'|'left'|'right'} */
    this.facing = "up";
    /** @type {HistoryFrame[]} */
    this.history = [];
    /** @type {boolean} */
    this.titlePending = true;
    /** @type {'idle'|'push'|'blocked'|'seat'|'complete'|'undo'|null} */
    this.lastFx = null;
    /** @type {Action|null} */
    this.lastAction = null;
  }

  /** @returns {VisibleState} */
  snapshot() {
    return this._buildState();
  }

  /**
   * @param {unknown} seed
   * @returns {VisibleState}
   */
  reset(seed) {
    const n = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
    this.seed = n | 0;
    this.revision = 0;
    this.attempt = 1;
    this.titlePending = true;
    this.lastFx = null;
    this.lastAction = null;
    this._loadLevel("first-light", { keepAttempt: true, resetAttempt: true });
    return this.snapshot();
  }

  /** @returns {VisibleState} */
  restart() {
    this._restartCurrent();
    return this.snapshot();
  }

  /**
   * @param {Action} action
   * @returns {VisibleState}
   */
  act(action) {
    const result = this._tryAct(action, { fromArena: true });
    if (!result.ok) {
      const err = new Error(result.error.message);
      // @ts-ignore
      err.code = result.error.code;
      throw err;
    }
    return this.snapshot();
  }

  /**
   * Internal act used by UI and bridge.
   * @param {Action} action
   * @param {{ fromArena?: boolean, expectedRevision?: number|null }} [opts]
   * @returns {{ ok: true, state: VisibleState, fx: string|null } | { ok: false, error: { code: string, message: string }, state: VisibleState }}
   */
  applyAction(action, opts = {}) {
    if (opts.expectedRevision != null && opts.expectedRevision !== this.revision) {
      return {
        ok: false,
        error: { code: "stale_revision", message: "Revision mismatch" },
        state: this.snapshot(),
      };
    }
    return this._tryAct(action, { fromArena: !!opts.fromArena });
  }

  /**
   * @param {Action} action
   * @param {{ fromArena?: boolean }} opts
   */
  _tryAct(action, opts) {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      return {
        ok: false,
        error: { code: "invalid_action", message: "Malformed action" },
        state: this.snapshot(),
      };
    }

    const legal = this._legalActions();
    if (!legal.some((a) => actionsEqual(a, action))) {
      return {
        ok: false,
        error: { code: "illegal_action", message: "Action not legal in this state" },
        state: this.snapshot(),
      };
    }

    this.titlePending = false;
    let fx = null;

    if (action.type === "undo") {
      fx = this._undo();
    } else if (action.type === "select_level") {
      this._loadLevel(action.levelId, { keepAttempt: false });
      fx = "select";
    } else if (action.type === "move") {
      const moveResult = this._move(action.direction);
      if (!moveResult.ok) {
        // Should not happen if legalActions is correct; treat as blocked refuse without mutation
        return {
          ok: false,
          error: { code: "illegal_action", message: "Move blocked" },
          state: this.snapshot(),
        };
      }
      fx = moveResult.fx;
    } else {
      return {
        ok: false,
        error: { code: "invalid_action", message: "Unknown action type" },
        state: this.snapshot(),
      };
    }

    this.revision += 1;
    this.lastFx = fx;
    this.lastAction = action;
    return { ok: true, state: this.snapshot(), fx };
  }

  _restartCurrent() {
    this.titlePending = false;
    this._loadLevel(this.levelId, { keepAttempt: false, bumpAttempt: true });
    this.revision += 1;
    this.lastFx = "restart";
    this.lastAction = null;
  }

  /**
   * @param {string} levelId
   * @param {{ keepAttempt?: boolean, resetAttempt?: boolean, bumpAttempt?: boolean }} opts
   */
  _loadLevel(levelId, opts = {}) {
    const def = LEVEL_BY_ID[levelId];
    if (!def) throw new Error("Unknown level");
    this.levelId = levelId;
    this.board = parseLevel(def);
    this.player = { ...this.board.player };
    this.crates = this.board.crates.map((c) => ({ ...c }));
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = "playing";
    this.outcome = null;
    this.facing = "up";
    this.history = [];
    if (opts.resetAttempt) this.attempt = 1;
    else if (opts.bumpAttempt) this.attempt += 1;
    else if (!opts.keepAttempt) this.attempt += 1;
  }

  /** @param {'up'|'down'|'left'|'right'} direction */
  _move(direction) {
    const d = DIRS[direction];
    if (!d) return { ok: false, fx: null };

    const nr = this.player.row + d.dr;
    const nc = this.player.col + d.dc;

    if (hasCell(this.board.walls, nr, nc)) {
      return { ok: false, fx: "blocked" };
    }

    const crateIdx = this.crates.findIndex((c) => c.row === nr && c.col === nc);
    /** @type {HistoryFrame} */
    const frame = {
      player: { ...this.player },
      crates: this.crates.map((c) => ({ ...c })),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome,
      facing: this.facing,
    };

    let pushed = false;
    if (crateIdx >= 0) {
      const cr = nr + d.dr;
      const cc = nc + d.dc;
      if (hasCell(this.board.walls, cr, cc)) return { ok: false, fx: "blocked" };
      if (hasCell(this.crates, cr, cc)) return { ok: false, fx: "blocked" };
      // Destination must be free floor or socket (both are non-wall non-crate)
      this.crates[crateIdx] = { row: cr, col: cc };
      this.crates = sortCells(this.crates);
      pushed = true;
    }

    this.history.push(frame);
    this.player = { row: nr, col: nc };
    this.facing = direction;
    this.moveCount += 1;
    if (pushed) this.pushCount += 1;

    const powered = this._poweredCount();
    const complete = powered === this.board.goals.length;
    let fx = pushed ? "push" : "step";
    if (pushed && hasCell(this.board.goals, nr + d.dr, nc + d.dc)) {
      fx = "seat";
    }

    if (complete) {
      this.phase = "complete";
      this.outcome = "powered";
      fx = "complete";
    }

    return { ok: true, fx };
  }

  _undo() {
    const frame = this.history.pop();
    if (!frame) return null;
    this.player = { ...frame.player };
    this.crates = frame.crates.map((c) => ({ ...c }));
    this.moveCount = frame.moveCount;
    this.pushCount = frame.pushCount;
    this.phase = frame.phase;
    this.outcome = frame.outcome;
    this.facing = frame.facing;
    return "undo";
  }

  _poweredCount() {
    let n = 0;
    for (const g of this.board.goals) {
      if (hasCell(this.crates, g.row, g.col)) n += 1;
    }
    return n;
  }

  /** @returns {Action[]} */
  _legalActions() {
    /** @type {Action[]} */
    const actions = [];

    // select_level always available for all twenty boards
    for (const id of LEVEL_IDS) {
      actions.push({ type: "select_level", levelId: id });
    }

    if (this.history.length > 0) {
      actions.push({ type: "undo" });
    }

    if (this.phase === "playing") {
      for (const direction of DIR_KEYS) {
        if (this._canMove(/** @type {any} */ (direction))) {
          actions.push({ type: "move", direction: /** @type {any} */ (direction) });
        }
      }
    }

    return actions;
  }

  /** @param {'up'|'down'|'left'|'right'} direction */
  _canMove(direction) {
    const d = DIRS[direction];
    const nr = this.player.row + d.dr;
    const nc = this.player.col + d.dc;
    if (hasCell(this.board.walls, nr, nc)) return false;
    const crateIdx = this.crates.findIndex((c) => c.row === nr && c.col === nc);
    if (crateIdx < 0) return true;
    const cr = nr + d.dr;
    const cc = nc + d.dc;
    if (hasCell(this.board.walls, cr, cc)) return false;
    if (hasCell(this.crates, cr, cc)) return false;
    return true;
  }

  /** @returns {VisibleState} */
  _buildState() {
    const poweredGoals = this._poweredCount();
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.levelId,
      width: this.board.width,
      height: this.board.height,
      walls: this.board.walls.map((c) => ({ ...c })),
      goals: this.board.goals.map((c) => ({ ...c })),
      crates: this.crates.map((c) => ({ ...c })),
      player: { ...this.player },
      poweredGoals,
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.history.length > 0,
      legalActions: this._legalActions(),
    };
  }

  getLevelIndex() {
    return LEVEL_IDS.indexOf(this.levelId);
  }

  getLevelName() {
    return this.board.name;
  }

  getFacing() {
    return this.facing;
  }

  isTitlePending() {
    return this.titlePending;
  }

  getLastFx() {
    return this.lastFx;
  }

  /**
   * Resume a board without advancing revision (human campaign return).
   * @param {string} levelId
   */
  resumeLevel(levelId) {
    if (!LEVEL_BY_ID[levelId]) return;
    this._loadLevel(levelId, { keepAttempt: true, resetAttempt: true });
    this.revision = 0;
    this.titlePending = true;
  }
}

/** @param {Action} a @param {Action} b */
export function actionsEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "move" && b.type === "move") return a.direction === b.direction;
  if (a.type === "select_level" && b.type === "select_level") return a.levelId === b.levelId;
  if (a.type === "undo" && b.type === "undo") return true;
  return false;
}

export { DIRS, DIR_KEYS, LEVELS };
