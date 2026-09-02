// Lumen Yard - Core Game State and Rules Engine
import { LEVEL_IDS, LEVEL_MAP, PARSED_LEVELS } from './levels.js';
import { storage } from './storage.js';

const DIRS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 }
};

export class LumenGame {
  constructor(options = {}) {
    this.seed = null;
    this.revision = 0;
    this.attempt = 1;
    this.levelId = 'first-light';
    this.currentLevel = LEVEL_MAP.get(this.levelId);
    
    // Board entities
    this.player = { row: 0, col: 0 };
    this.crates = [];
    this.robotFacing = 'right';
    this.phase = 'playing'; // 'playing' | 'complete'
    this.outcome = null;    // null | 'powered'
    
    // Counts
    this.moveCount = 0;
    this.pushCount = 0;
    
    // Undo history
    this.undoStack = [];
    
    // Event listeners
    this.onStateChange = options.onStateChange || (() => {});
    this.onSoundEvent = options.onSoundEvent || (() => {});
    this.onRefusal = options.onRefusal || (() => {});
    this.onPushEffect = options.onPushEffect || (() => {});
    
    // Initialize starting level
    const savedLast = storage.getLastLevel('first-light');
    const initialId = LEVEL_MAP.has(savedLast) ? savedLast : 'first-light';
    this.loadLevel(initialId, false);
  }

  loadLevel(levelId, incrementRevision = true) {
    if (!LEVEL_MAP.has(levelId)) {
      const err = new Error(`Unknown level: ${levelId}`);
      err.code = 'UNKNOWN_BOARD';
      throw err;
    }

    this.levelId = levelId;
    this.currentLevel = LEVEL_MAP.get(levelId);
    storage.setLastLevel(levelId);

    // Initial positioning
    this.player = { row: this.currentLevel.initialPlayer.row, col: this.currentLevel.initialPlayer.col };
    this.crates = this.currentLevel.initialCrates.map(c => ({ row: c.row, col: c.col }));
    this.robotFacing = 'right';
    this.phase = 'playing';
    this.outcome = null;
    this.moveCount = 0;
    this.pushCount = 0;
    this.undoStack = [];
    this.attempt = 1;

    if (incrementRevision) {
      this.revision++;
    }

    this.render();
  }

  restart() {
    this.attempt++;
    this.revision++;
    this.player = { row: this.currentLevel.initialPlayer.row, col: this.currentLevel.initialPlayer.col };
    this.crates = this.currentLevel.initialCrates.map(c => ({ row: c.row, col: c.col }));
    this.phase = 'playing';
    this.outcome = null;
    this.moveCount = 0;
    this.pushCount = 0;
    this.undoStack = [];

    this.render();
    return this.snapshot();
  }

  reset(seed = null) {
    this.seed = seed;
    this.revision++;
    this.attempt = 1;
    this.levelId = 'first-light';
    this.currentLevel = LEVEL_MAP.get('first-light');
    storage.setLastLevel('first-light');

    this.player = { row: this.currentLevel.initialPlayer.row, col: this.currentLevel.initialPlayer.col };
    this.crates = this.currentLevel.initialCrates.map(c => ({ row: c.row, col: c.col }));
    this.robotFacing = 'right';
    this.phase = 'playing';
    this.outcome = null;
    this.moveCount = 0;
    this.pushCount = 0;
    this.undoStack = [];

    this.render();
    return this.snapshot();
  }

  countPoweredGoals() {
    let count = 0;
    for (const g of this.currentLevel.goals) {
      if (this.crates.some(c => c.row === g.row && c.col === g.col)) {
        count++;
      }
    }
    return count;
  }

  isWall(r, c) {
    return this.currentLevel.walls.some(w => w.row === r && w.col === c);
  }

  isCrate(r, c) {
    return this.crates.some(c2 => c2.row === r && c2.col === c);
  }

  getCrateAt(r, c) {
    return this.crates.find(c2 => c2.row === r && c2.col === c);
  }

  isGoal(r, c) {
    return this.currentLevel.goals.some(g => g.row === r && g.col === c);
  }

  getLegalActions() {
    const actions = [];

    if (this.phase === 'playing') {
      // Moves
      for (const [dir, delta] of Object.entries(DIRS)) {
        const nr = this.player.row + delta.dr;
        const nc = this.player.col + delta.dc;

        if (this.isWall(nr, nc)) continue;

        if (this.isCrate(nr, nc)) {
          // Push destination
          const nnr = nr + delta.dr;
          const nnc = nc + delta.dc;
          if (this.isWall(nnr, nnc)) continue;
          if (this.isCrate(nnr, nnc)) continue;
          actions.push({ type: 'move', direction: dir });
        } else {
          actions.push({ type: 'move', direction: dir });
        }
      }
    }

    // Undo
    if (this.undoStack.length > 0) {
      actions.push({ type: 'undo' });
    }

    // Select level (all 20 levels)
    for (const id of LEVEL_IDS) {
      actions.push({ type: 'select_level', levelId: id });
    }

    return actions;
  }

  snapshot() {
    const sortCoords = (arr) => arr.slice().sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.levelId,
      width: this.currentLevel.width,
      height: this.currentLevel.height,
      walls: this.currentLevel.walls.map(w => ({ row: w.row, col: w.col })),
      goals: this.currentLevel.goals.map(g => ({ row: g.row, col: g.col })),
      crates: sortCoords(this.crates).map(c => ({ row: c.row, col: c.col })),
      player: { row: this.player.row, col: this.player.col },
      poweredGoals: this.countPoweredGoals(),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.undoStack.length > 0,
      legalActions: this.getLegalActions()
    };
  }

  act(action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      const err = new Error('Action must be an object with a string type');
      err.code = 'ILLEGAL_ACTION';
      throw err;
    }

    if (action.type === 'move') {
      return this.handleMove(action.direction);
    } else if (action.type === 'undo') {
      return this.handleUndo();
    } else if (action.type === 'select_level') {
      return this.handleSelectLevel(action.levelId);
    } else {
      const err = new Error(`Unknown action type: ${action.type}`);
      err.code = 'ILLEGAL_ACTION';
      throw err;
    }
  }

  handleMove(direction) {
    if (this.phase === 'complete') {
      const err = new Error('Movement is frozen after completion. Restart, undo, or select another level.');
      err.code = 'POST_COMPLETION_MOVE';
      throw err;
    }

    const delta = DIRS[direction];
    if (!delta) {
      const err = new Error(`Invalid move direction: ${direction}`);
      err.code = 'ILLEGAL_ACTION';
      throw err;
    }

    this.robotFacing = direction;

    const targetRow = this.player.row + delta.dr;
    const targetCol = this.player.col + delta.dc;

    // Check wall
    if (this.isWall(targetRow, targetCol)) {
      this.onRefusal(direction, this.player.row, this.player.col);
      this.onSoundEvent('block');
      const err = new Error(`Move blocked by wall at (${targetRow}, ${targetCol})`);
      err.code = 'ILLEGAL_ACTION';
      throw err;
    }

    // Check crate push
    const crate = this.getCrateAt(targetRow, targetCol);
    if (crate) {
      const pushDestRow = targetRow + delta.dr;
      const pushDestCol = targetCol + delta.dc;

      // Push blocked by wall or another crate?
      if (this.isWall(pushDestRow, pushDestCol) || this.isCrate(pushDestRow, pushDestCol)) {
        this.onRefusal(direction, targetRow, targetCol);
        this.onSoundEvent('block');
        const err = new Error(`Cannot push relay core to (${pushDestRow}, ${pushDestCol})`);
        err.code = 'ILLEGAL_ACTION';
        throw err;
      }

      // Legal push! Save undo frame
      this.saveUndoState();

      // Move crate
      crate.row = pushDestRow;
      crate.col = pushDestCol;
      this.pushCount++;

      // Move player
      this.player.row = targetRow;
      this.player.col = targetCol;
      this.moveCount++;

      // Push effects
      const destIsGoal = this.isGoal(pushDestRow, pushDestCol);
      this.onPushEffect(direction, pushDestRow, pushDestCol, destIsGoal);

      if (destIsGoal) {
        this.onSoundEvent('socket');
      } else {
        this.onSoundEvent('push');
      }
    } else {
      // Free step
      this.saveUndoState();
      this.player.row = targetRow;
      this.player.col = targetCol;
      this.moveCount++;
      this.onSoundEvent('step');
    }

    // Check board completion
    const totalGoals = this.currentLevel.goals.length;
    const powered = this.countPoweredGoals();
    if (powered === totalGoals) {
      this.phase = 'complete';
      this.outcome = 'powered';
      storage.markLevelRestored(this.levelId);
      storage.recordBest(this.levelId, this.moveCount);
      this.onSoundEvent('surge');
    }

    this.revision++;
    this.render();
    return this.snapshot();
  }

  saveUndoState() {
    this.undoStack.push({
      player: { row: this.player.row, col: this.player.col },
      crates: this.crates.map(c => ({ row: c.row, col: c.col })),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome,
      robotFacing: this.robotFacing
    });
  }

  handleUndo() {
    if (this.undoStack.length === 0) {
      const err = new Error('No undo available');
      err.code = 'ILLEGAL_ACTION';
      throw err;
    }

    const previous = this.undoStack.pop();
    this.player = { row: previous.player.row, col: previous.player.col };
    this.crates = previous.crates.map(c => ({ row: c.row, col: c.col }));
    this.moveCount = previous.moveCount;
    this.pushCount = previous.pushCount;
    this.phase = previous.phase;
    this.outcome = previous.outcome;
    this.robotFacing = previous.robotFacing;

    this.revision++; // Revision advances because undo is a new action
    this.onSoundEvent('undo');
    this.render();
    return this.snapshot();
  }

  handleSelectLevel(levelId) {
    if (!LEVEL_MAP.has(levelId)) {
      const err = new Error(`Unknown level: ${levelId}`);
      err.code = 'UNKNOWN_BOARD';
      throw err;
    }

    this.loadLevel(levelId, true);
    return this.snapshot();
  }

  render() {
    // Notify listeners to update visible board and HUD
    this.onStateChange(this.snapshot());
  }
}
