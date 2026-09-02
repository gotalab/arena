/**
 * LUMEN YARD - Pure Core Game Engine
 * Implements deterministic rules, undo history, legal actions, and snapshot generation.
 */

import { LEVEL_IDS, LEVEL_MAP, PARSED_LEVELS } from './levels.js';

const DIRECTIONS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 }
};

const SORT_COORDS = (a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col);

function cloneCoord(c) {
  return { row: c.row, col: c.col };
}

function cloneCoords(arr) {
  return arr.map(cloneCoord);
}

function isSameCoord(a, b) {
  return a.row === b.row && a.col === b.col;
}

export class GameEngine {
  constructor(initialLevelId = 'first-light', seed = 0) {
    this.seed = seed;
    this.revision = 0;
    this.attempt = 1;
    this.levelId = initialLevelId;
    this.eventListeners = [];

    this._initLevel(this.levelId);
  }

  addEventListener(listener) {
    this.eventListeners.push(listener);
  }

  removeEventListener(listener) {
    this.eventListeners = this.eventListeners.filter(l => l !== listener);
  }

  _emit(event) {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in game event listener:', err);
      }
    }
  }

  _initLevel(levelId) {
    const levelDef = LEVEL_MAP.get(levelId);
    if (!levelDef) {
      throw new Error(`Unknown level: ${levelId}`);
    }

    this.levelId = levelId;
    this.width = levelDef.width;
    this.height = levelDef.height;

    // Static structures (sorted)
    this.walls = cloneCoords(levelDef.walls).sort(SORT_COORDS);
    this.goals = cloneCoords(levelDef.goals).sort(SORT_COORDS);

    // Fast lookup sets
    this.wallSet = new Set(this.walls.map(w => `${w.row},${w.col}`));
    this.goalSet = new Set(this.goals.map(g => `${g.row},${g.col}`));

    // Dynamic state
    this.player = cloneCoord(levelDef.player);
    this.playerFacing = 'down'; // visual helper: up, down, left, right
    this.crates = cloneCoords(levelDef.crates).sort(SORT_COORDS);
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = 'playing';
    this.outcome = null;
    this.undoStack = [];

    this._updatePoweredGoals();
  }

  _updatePoweredGoals() {
    let count = 0;
    for (const crate of this.crates) {
      if (this.goalSet.has(`${crate.row},${crate.col}`)) {
        count++;
      }
    }
    this.poweredGoals = count;

    if (this.goals.length > 0 && this.poweredGoals === this.goals.length) {
      this.phase = 'complete';
      this.outcome = 'powered';
    } else {
      this.phase = 'playing';
      this.outcome = null;
    }
  }

  isWall(r, c) {
    return this.wallSet.has(`${r},${c}`);
  }

  findCrateIndex(r, c) {
    return this.crates.findIndex(crate => crate.row === r && crate.col === c);
  }

  isGoal(r, c) {
    return this.goalSet.has(`${r},${c}`);
  }

  isLegalMove(direction) {
    if (this.phase === 'complete') return false;
    const delta = DIRECTIONS[direction];
    if (!delta) return false;

    const targetRow = this.player.row + delta.dr;
    const targetCol = this.player.col + delta.dc;

    if (this.isWall(targetRow, targetCol)) return false;

    const crateIdx = this.findCrateIndex(targetRow, targetCol);
    if (crateIdx === -1) {
      return true; // Empty floor or goal
    }

    // Crate push check
    const beyondRow = targetRow + delta.dr;
    const beyondCol = targetCol + delta.dc;

    if (this.isWall(beyondRow, beyondCol)) return false;
    if (this.findCrateIndex(beyondRow, beyondCol) !== -1) return false; // Cannot push two crates

    return true;
  }

  getLegalActions() {
    const actions = [];

    if (this.phase === 'playing') {
      for (const dir of ['up', 'down', 'left', 'right']) {
        if (this.isLegalMove(dir)) {
          actions.push({ type: 'move', direction: dir });
        }
      }
    }

    if (this.undoStack.length > 0) {
      actions.push({ type: 'undo' });
    }

    for (const id of LEVEL_IDS) {
      actions.push({ type: 'select_level', levelId: id });
    }

    return actions;
  }

  snapshot() {
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.levelId,
      width: this.width,
      height: this.height,
      walls: cloneCoords(this.walls).sort(SORT_COORDS),
      goals: cloneCoords(this.goals).sort(SORT_COORDS),
      crates: cloneCoords(this.crates).sort(SORT_COORDS),
      player: cloneCoord(this.player),
      poweredGoals: this.poweredGoals,
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.undoStack.length > 0,
      legalActions: this.getLegalActions()
    };
  }

  act(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      const err = new Error('Invalid action shape');
      err.code = 'INVALID_ACTION';
      throw err;
    }

    switch (action.type) {
      case 'move': {
        if (this.phase === 'complete') {
          const err = new Error('Board is already complete. Movement frozen.');
          err.code = 'POST_COMPLETION_MOVE';
          throw err;
        }

        const dir = action.direction;
        if (!['up', 'down', 'left', 'right'].includes(dir)) {
          const err = new Error(`Unknown direction: ${dir}`);
          err.code = 'UNKNOWN_DIRECTION';
          throw err;
        }

        if (!this.isLegalMove(dir)) {
          this._emit({ type: 'blocked', direction: dir, player: cloneCoord(this.player) });
          const err = new Error(`Illegal move: ${dir}`);
          err.code = 'ILLEGAL_MOVE';
          throw err;
        }

        this._performMove(dir);
        break;
      }

      case 'undo': {
        if (this.undoStack.length === 0) {
          const err = new Error('No moves available to undo');
          err.code = 'NO_UNDO_AVAILABLE';
          throw err;
        }
        this._performUndo();
        break;
      }

      case 'select_level': {
        const levelId = action.levelId;
        if (!LEVEL_MAP.has(levelId)) {
          const err = new Error(`Unknown levelId: ${levelId}`);
          err.code = 'UNKNOWN_LEVEL';
          throw err;
        }
        this._performSelectLevel(levelId);
        break;
      }

      default: {
        const err = new Error(`Unknown action type: ${action.type}`);
        err.code = 'UNKNOWN_ACTION_TYPE';
        throw err;
      }
    }

    return this.snapshot();
  }

  _performMove(dir) {
    const delta = DIRECTIONS[dir];
    this.playerFacing = dir;

    // Save previous state for undo
    const previousState = {
      player: cloneCoord(this.player),
      playerFacing: this.playerFacing,
      crates: cloneCoords(this.crates),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome,
      poweredGoals: this.poweredGoals
    };

    const targetRow = this.player.row + delta.dr;
    const targetCol = this.player.col + delta.dc;
    const crateIdx = this.findCrateIndex(targetRow, targetCol);

    let isPush = false;
    let pushedCrateFrom = null;
    let pushedCrateTo = null;
    let isGoalContact = false;

    if (crateIdx !== -1) {
      // Pushing a crate
      isPush = true;
      const crate = this.crates[crateIdx];
      pushedCrateFrom = cloneCoord(crate);
      crate.row += delta.dr;
      crate.col += delta.dc;
      pushedCrateTo = cloneCoord(crate);
      this.pushCount++;
      isGoalContact = this.isGoal(crate.row, crate.col);
    }

    const prevPlayer = cloneCoord(this.player);
    this.player.row = targetRow;
    this.player.col = targetCol;
    this.moveCount++;
    this.revision++;

    this.undoStack.push(previousState);
    this._updatePoweredGoals();

    if (isPush) {
      this._emit({
        type: 'push',
        direction: dir,
        from: prevPlayer,
        to: cloneCoord(this.player),
        crateFrom: pushedCrateFrom,
        crateTo: pushedCrateTo,
        isGoal: isGoalContact,
        poweredGoals: this.poweredGoals,
        totalGoals: this.goals.length
      });
    } else {
      this._emit({
        type: 'step',
        direction: dir,
        from: prevPlayer,
        to: cloneCoord(this.player)
      });
    }

    if (this.phase === 'complete') {
      this._emit({
        type: 'complete',
        levelId: this.levelId,
        moveCount: this.moveCount,
        pushCount: this.pushCount
      });
    }
  }

  _performUndo() {
    const prev = this.undoStack.pop();
    this.player = cloneCoord(prev.player);
    this.playerFacing = prev.playerFacing || 'down';
    this.crates = cloneCoords(prev.crates);
    this.moveCount = prev.moveCount;
    this.pushCount = prev.pushCount;
    this.phase = prev.phase;
    this.outcome = prev.outcome;
    this.poweredGoals = prev.poweredGoals;
    this.revision++; // Revision still advances

    this._emit({
      type: 'undo',
      player: cloneCoord(this.player),
      poweredGoals: this.poweredGoals
    });
  }

  _performSelectLevel(levelId) {
    this.levelId = levelId;
    this.attempt++;
    this.revision++;
    this._initLevel(levelId);

    this._emit({
      type: 'select_level',
      levelId: this.levelId,
      attempt: this.attempt
    });
  }

  restart() {
    this.attempt++;
    this.revision++;
    this._initLevel(this.levelId);

    this._emit({
      type: 'restart',
      levelId: this.levelId,
      attempt: this.attempt
    });

    return this.snapshot();
  }

  reset(seed = 0) {
    this.seed = seed;
    this.attempt = 1;
    this.revision++;
    this._initLevel('first-light');

    this._emit({
      type: 'reset',
      seed: this.seed,
      levelId: 'first-light'
    });

    return this.snapshot();
  }
}
