/* LUMEN YARD - rules engine.
   One authority for the board rules. Human input, window.__ARENA_GAME__ and the
   arena.game.v1 bridge all drive this same object. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});

  var DIRECTIONS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };
  var DIRECTION_ORDER = ['up', 'down', 'left', 'right'];

  function GameError(code, message) {
    var err = new Error(message || code);
    err.code = code;
    err.name = 'ArenaActionError';
    return err;
  }

  function byRowCol(a, b) {
    return a.row - b.row || a.col - b.col;
  }

  function cloneCells(cells) {
    return cells.map(function (p) { return { row: p.row, col: p.col }; });
  }

  function Game() {
    this.listeners = [];
    this.seed = null;
    this.revision = 0;
    this.attempt = 1;
    this.level = LY.LEVELS[0];
    this._install(this.level, 1);
  }

  Game.prototype.on = function (fn) {
    this.listeners.push(fn);
  };

  Game.prototype._emit = function (event) {
    for (var i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](event); } catch (e) { /* a view must never break the rules */ }
    }
  };

  Game.prototype._install = function (level, attempt) {
    this.level = level;
    this.attempt = attempt;
    this.player = { row: level.startPlayer.row, col: level.startPlayer.col };
    this.crates = cloneCells(level.startCrates);
    this.moveCount = 0;
    this.pushCount = 0;
    this.history = [];
    this.phase = 'playing';
    this.outcome = null;
  };

  Game.prototype.isWall = function (row, col) {
    var g = this.level.wallGrid;
    if (row < 0 || col < 0 || row >= this.level.height || col >= this.level.width) return true;
    return !!g[row][col];
  };

  Game.prototype.crateIndexAt = function (row, col) {
    for (var i = 0; i < this.crates.length; i++) {
      if (this.crates[i].row === row && this.crates[i].col === col) return i;
    }
    return -1;
  };

  Game.prototype.isGoal = function (row, col) {
    var g = this.level.goals;
    for (var i = 0; i < g.length; i++) if (g[i].row === row && g[i].col === col) return true;
    return false;
  };

  Game.prototype.poweredGoals = function () {
    var n = 0;
    for (var i = 0; i < this.crates.length; i++) {
      if (this.isGoal(this.crates[i].row, this.crates[i].col)) n++;
    }
    return n;
  };

  Game.prototype.isComplete = function () {
    return this.poweredGoals() === this.level.goals.length;
  };

  /* Returns a description of what a move would do, or null when it is illegal. */
  Game.prototype.probeMove = function (direction) {
    if (this.phase !== 'playing') return null;
    var d = DIRECTIONS[direction];
    if (!d) return null;
    var fromRow = this.player.row;
    var fromCol = this.player.col;
    var row = fromRow + d.dr;
    var col = fromCol + d.dc;
    if (this.isWall(row, col)) return null;

    var crateIdx = this.crateIndexAt(row, col);
    if (crateIdx === -1) {
      return { direction: direction, pushed: false, from: { row: fromRow, col: fromCol }, to: { row: row, col: col } };
    }
    var beyondRow = row + d.dr;
    var beyondCol = col + d.dc;
    if (this.isWall(beyondRow, beyondCol)) return null;
    if (this.crateIndexAt(beyondRow, beyondCol) !== -1) return null;
    return {
      direction: direction,
      pushed: true,
      crateIndex: crateIdx,
      from: { row: fromRow, col: fromCol },
      to: { row: row, col: col },
      crateFrom: { row: row, col: col },
      crateTo: { row: beyondRow, col: beyondCol },
      seats: this.isGoal(beyondRow, beyondCol),
      leaves: this.isGoal(row, col)
    };
  };

  Game.prototype._snapshotForUndo = function () {
    return {
      player: { row: this.player.row, col: this.player.col },
      crates: cloneCells(this.crates),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome
    };
  };

  Game.prototype.move = function (direction, meta) {
    if (this.phase !== 'playing') {
      throw GameError('board_complete', 'The yard is powered. Undo, restart or choose another board.');
    }
    if (!DIRECTIONS[direction]) {
      throw GameError('bad_direction', 'Unknown direction: ' + direction);
    }
    var plan = this.probeMove(direction);
    if (!plan) {
      this._emit({ type: 'blocked', direction: direction, source: (meta && meta.source) || 'human' });
      throw GameError('blocked', 'That push is blocked.');
    }

    this.history.push(this._snapshotForUndo());
    this.player = { row: plan.to.row, col: plan.to.col };
    if (plan.pushed) {
      this.crates[plan.crateIndex] = { row: plan.crateTo.row, col: plan.crateTo.col };
      this.pushCount++;
    }
    this.moveCount++;

    var completed = this.isComplete();
    if (completed) {
      this.phase = 'complete';
      this.outcome = 'powered';
    }
    this.revision++;

    this._emit({
      type: 'move',
      plan: plan,
      completed: completed,
      source: (meta && meta.source) || 'human'
    });
    return plan;
  };

  Game.prototype.canUndo = function () {
    return this.history.length > 0;
  };

  Game.prototype.undo = function (meta) {
    if (!this.canUndo()) {
      throw GameError('no_history', 'There is nothing to rewind.');
    }
    var before = { player: this.player, crates: this.crates };
    var prev = this.history.pop();
    this.player = prev.player;
    this.crates = prev.crates;
    this.moveCount = prev.moveCount;
    this.pushCount = prev.pushCount;
    this.phase = prev.phase;
    this.outcome = prev.outcome;
    this.revision++;
    this._emit({ type: 'undo', from: before, source: (meta && meta.source) || 'human' });
    return true;
  };

  Game.prototype.restart = function (meta) {
    this._install(this.level, this.attempt + 1);
    this.revision++;
    this._emit({ type: 'restart', source: (meta && meta.source) || 'human' });
    return true;
  };

  Game.prototype.selectLevel = function (levelId, meta) {
    var level = LY.getLevel(levelId);
    if (!level) {
      throw GameError('unknown_level', 'No such board: ' + levelId);
    }
    this._install(level, 1);
    this.revision++;
    this._emit({ type: 'level', source: (meta && meta.source) || 'human' });
    return true;
  };

  /* reset(seed) returns the campaign to its first board deterministically. The
     seed is kept for replay identity only; the boards are authored, not generated. */
  Game.prototype.reset = function (seed) {
    this.seed = (seed === undefined ? null : seed);
    this._install(LY.LEVELS[0], 1);
    this.revision = 0;
    this._emit({ type: 'reset', source: 'arena' });
    return true;
  };

  Game.prototype.legalActions = function () {
    var out = [];
    var i;
    if (this.phase === 'playing') {
      for (i = 0; i < DIRECTION_ORDER.length; i++) {
        if (this.probeMove(DIRECTION_ORDER[i])) {
          out.push({ type: 'move', direction: DIRECTION_ORDER[i] });
        }
      }
    }
    if (this.canUndo()) out.push({ type: 'undo' });
    for (i = 0; i < LY.LEVELS.length; i++) {
      out.push({ type: 'select_level', levelId: LY.LEVELS[i].id });
    }
    return out;
  };

  /* The exact shape shared by snapshot() and every arena.game.v1 envelope. */
  Game.prototype.state = function () {
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.level.id,
      width: this.level.width,
      height: this.level.height,
      walls: cloneCells(this.level.walls).sort(byRowCol),
      goals: cloneCells(this.level.goals).sort(byRowCol),
      crates: cloneCells(this.crates).sort(byRowCol),
      player: { row: this.player.row, col: this.player.col },
      poweredGoals: this.poweredGoals(),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.canUndo(),
      legalActions: this.legalActions()
    };
  };

  Game.prototype.frozenState = function () {
    var s = this.state();
    s.walls.forEach(Object.freeze);
    s.goals.forEach(Object.freeze);
    s.crates.forEach(Object.freeze);
    s.legalActions.forEach(Object.freeze);
    Object.freeze(s.walls);
    Object.freeze(s.goals);
    Object.freeze(s.crates);
    Object.freeze(s.legalActions);
    Object.freeze(s.player);
    return Object.freeze(s);
  };

  /* Single entry point for the closed action set. Throws GameError on rejection. */
  Game.prototype.applyAction = function (action, meta) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw GameError('bad_action', 'An action must be an object.');
    }
    switch (action.type) {
      case 'move':
        return this.move(action.direction, meta);
      case 'undo':
        return this.undo(meta);
      case 'select_level':
        return this.selectLevel(action.levelId, meta);
      default:
        throw GameError('unknown_action', 'Unsupported action type: ' + String(action.type));
    }
  };

  LY.DIRECTIONS = DIRECTIONS;
  LY.DIRECTION_ORDER = DIRECTION_ORDER;
  LY.GameError = GameError;
  LY.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
