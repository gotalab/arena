// Lumen Yard - pure game engine (no DOM dependency, safe to unit test in Node)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./levels.js'));
  } else {
    root.LumenEngine = factory(root.LumenLevels);
  }
})(typeof self !== 'undefined' ? self : this, function (LumenLevels) {
  'use strict';

  var DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };
  var DIR_NAMES = ['up', 'down', 'left', 'right'];

  function byRowCol(a, b) {
    return a.row - b.row || a.col - b.col;
  }

  function cloneCells(arr) {
    return arr.map(function (c) { return { row: c.row, col: c.col }; });
  }

  function fail(code, message) {
    return { ok: false, code: code, message: message };
  }

  function noopPersist() {}
  function noopLoad() { return null; }

  function GameEngine(options) {
    options = options || {};
    this.levels = LumenLevels.levels;
    this.order = LumenLevels.order.slice();
    this._persistFn = options.persist || noopPersist;
    this._loadFn = options.load || noopLoad;

    var saved = this._loadFn() || {};
    this.campaign = {
      completed: new Set(saved.completed || []),
      bestMoves: new Map(Object.entries(saved.bestMoves || {})),
      lastLevelId: saved.lastLevelId && this.levels.has(saved.lastLevelId) ? saved.lastLevelId : null,
      settings: {
        sound: saved.settings && typeof saved.settings.sound === 'boolean' ? saved.settings.sound : true,
        motion: saved.settings && typeof saved.settings.motion === 'boolean' ? saved.settings.motion : true
      }
    };

    this.revision = 0;
    this.attempt = 0;
    this.seed = options.seed !== undefined ? options.seed : null;
    this.history = [];

    this._loadLevel(this.campaign.lastLevelId || 'first-light');
  }

  GameEngine.prototype._persist = function () {
    this._persistFn({
      completed: Array.from(this.campaign.completed),
      bestMoves: Object.fromEntries(this.campaign.bestMoves),
      lastLevelId: this.campaign.lastLevelId,
      settings: this.campaign.settings
    });
  };

  GameEngine.prototype._loadLevel = function (id) {
    var level = this.levels.get(id);
    this.currentId = id;
    this.level = level;
    this.player = { row: level.playerInit.row, col: level.playerInit.col };
    this.crates = cloneCells(level.cratesInit);
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = 'playing';
    this.outcome = null;
    this.history = [];
    this.attempt += 1;
  };

  GameEngine.prototype._isWall = function (pos) {
    if (pos.row < 0 || pos.row >= this.level.height) return true;
    if (pos.col < 0 || pos.col >= this.level.width) return true;
    return this.level.walls.has(LumenLevels.cellKey(pos.row, pos.col));
  };

  GameEngine.prototype._crateIndexAt = function (pos) {
    for (var i = 0; i < this.crates.length; i++) {
      if (this.crates[i].row === pos.row && this.crates[i].col === pos.col) return i;
    }
    return -1;
  };

  GameEngine.prototype._tryMove = function (dir) {
    var np = { row: this.player.row + dir.dr, col: this.player.col + dir.dc };
    if (this._isWall(np)) return { legal: false };
    var crateIdx = this._crateIndexAt(np);
    if (crateIdx === -1) {
      return { legal: true, pushes: false, newPlayer: np };
    }
    var beyond = { row: np.row + dir.dr, col: np.col + dir.dc };
    if (this._isWall(beyond)) return { legal: false };
    if (this._crateIndexAt(beyond) !== -1) return { legal: false };
    return { legal: true, pushes: true, newPlayer: np, crateIndex: crateIdx, newCratePos: beyond };
  };

  GameEngine.prototype._goalSet = function () {
    if (!this._goalSetCache || this._goalSetCache.level !== this.level) {
      var set = new Set();
      this.level.goals.forEach(function (g) { set.add(LumenLevels.cellKey(g.row, g.col)); });
      this._goalSetCache = { level: this.level, set: set };
    }
    return this._goalSetCache.set;
  };

  GameEngine.prototype._poweredGoals = function () {
    var goalSet = this._goalSet();
    var count = 0;
    for (var i = 0; i < this.crates.length; i++) {
      if (goalSet.has(LumenLevels.cellKey(this.crates[i].row, this.crates[i].col))) count++;
    }
    return count;
  };

  GameEngine.prototype._legalMoveDirections = function () {
    var out = [];
    if (this.phase !== 'playing') return out;
    for (var i = 0; i < DIR_NAMES.length; i++) {
      var name = DIR_NAMES[i];
      if (this._tryMove(DIRS[name]).legal) out.push(name);
    }
    return out;
  };

  GameEngine.prototype._legalActions = function () {
    var actions = [];
    this._legalMoveDirections().forEach(function (dir) {
      actions.push({ type: 'move', direction: dir });
    });
    if (this.history.length > 0) actions.push({ type: 'undo' });
    this.order.forEach(function (id) {
      actions.push({ type: 'select_level', levelId: id });
    });
    return actions;
  };

  GameEngine.prototype.getState = function () {
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.currentId,
      width: this.level.width,
      height: this.level.height,
      walls: cloneCells(this.level.wallsArray),
      goals: cloneCells(this.level.goals),
      crates: cloneCells(this.crates).sort(byRowCol),
      player: { row: this.player.row, col: this.player.col },
      poweredGoals: this._poweredGoals(),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.history.length > 0,
      legalActions: this._legalActions()
    };
  };

  GameEngine.prototype._snapshotHistoryEntry = function () {
    return {
      player: { row: this.player.row, col: this.player.col },
      crates: cloneCells(this.crates),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome
    };
  };

  GameEngine.prototype._registerCompletionIfNeeded = function (wasPlaying) {
    var powered = this._poweredGoals();
    if (powered === this.level.goals.length) {
      this.phase = 'complete';
      this.outcome = 'powered';
      if (wasPlaying) {
        this.campaign.completed.add(this.currentId);
        var prevBest = this.campaign.bestMoves.get(this.currentId);
        if (prevBest === undefined || this.moveCount < prevBest) {
          this.campaign.bestMoves.set(this.currentId, this.moveCount);
        }
      }
    } else {
      this.phase = 'playing';
      this.outcome = null;
    }
  };

  GameEngine.prototype.attemptAction = function (action) {
    if (!action || typeof action.type !== 'string') {
      return fail('invalid_action', 'Action must have a type.');
    }

    if (action.type === 'move') {
      if (this.phase !== 'playing') return fail('phase_locked', 'The board is already complete.');
      var dir = DIRS[action.direction];
      if (!dir) return fail('invalid_action', 'Unknown direction.');
      var res = this._tryMove(dir);
      if (!res.legal) return fail('blocked', 'That push is blocked.');

      this.history.push(this._snapshotHistoryEntry());
      this.player = res.newPlayer;
      if (res.pushes) {
        this.crates[res.crateIndex] = res.newCratePos;
        this.pushCount += 1;
      }
      this.moveCount += 1;
      this._registerCompletionIfNeeded(true);
      this.revision += 1;
      this._persist();
      return { ok: true };
    }

    if (action.type === 'undo') {
      if (this.history.length === 0) return fail('no_history', 'Nothing to undo.');
      var prev = this.history.pop();
      this.player = prev.player;
      this.crates = prev.crates;
      this.moveCount = prev.moveCount;
      this.pushCount = prev.pushCount;
      this.phase = prev.phase;
      this.outcome = prev.outcome;
      this.revision += 1;
      this._persist();
      return { ok: true };
    }

    if (action.type === 'select_level') {
      if (typeof action.levelId !== 'string' || !this.levels.has(action.levelId)) {
        return fail('unknown_level', 'Unknown board id.');
      }
      this._loadLevel(action.levelId);
      this.revision += 1;
      this.campaign.lastLevelId = action.levelId;
      this._persist();
      return { ok: true };
    }

    return fail('invalid_action', 'Unknown action type.');
  };

  GameEngine.prototype.doRestart = function () {
    this._loadLevel(this.currentId);
    this.revision += 1;
    this.campaign.lastLevelId = this.currentId;
    this._persist();
    return { ok: true };
  };

  GameEngine.prototype.doReset = function (seed) {
    this.seed = seed !== undefined ? seed : null;
    this._loadLevel('first-light');
    this.revision = 0;
    this.campaign.lastLevelId = 'first-light';
    this._persist();
    return { ok: true };
  };

  GameEngine.prototype.setSettings = function (partial) {
    if (typeof partial.sound === 'boolean') this.campaign.settings.sound = partial.sound;
    if (typeof partial.motion === 'boolean') this.campaign.settings.motion = partial.motion;
    this._persist();
  };

  GameEngine.prototype.campaignSummary = function () {
    var totalBest = 0;
    this.campaign.bestMoves.forEach(function (v) { totalBest += v; });
    return {
      restoredCount: this.campaign.completed.size,
      totalBoards: this.order.length,
      totalBestMoves: totalBest,
      allRestored: this.campaign.completed.size === this.order.length
    };
  };

  return GameEngine;
});
