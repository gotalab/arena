/* Lumen Yard - production rules.
   One implementation of the yard's rules. Human input, window.__ARENA_GAME__
   and the arena.game.v1 bridge all drive this same object. */
(function (global) {
  'use strict';

  var DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
  };
  var DIR_NAMES = ['up', 'down', 'left', 'right'];

  function fail(code, message) {
    var err = new Error(message || code);
    err.code = code;
    return err;
  }

  function key(row, col) { return row * 64 + col; }

  function Engine(levels) {
    this.levels = levels;
    this.seed = null;
    this.revision = 0;
    this.attempt = 0;
    this.listeners = [];
    this._load(levels[0].id);
  }

  Engine.prototype._load = function (levelId) {
    var level = null;
    for (var i = 0; i < this.levels.length; i++) {
      if (this.levels[i].id === levelId) { level = this.levels[i]; break; }
    }
    if (!level) throw fail('unknown_level', 'No board called "' + levelId + '".');
    this.level = level;
    this.player = { row: level.player.row, col: level.player.col };
    this.crates = Object.create(null);
    for (var c = 0; c < level.crates.length; c++) {
      this.crates[key(level.crates[c].row, level.crates[c].col)] = true;
    }
    this.moveCount = 0;
    this.pushCount = 0;
    this.history = [];
    this.facing = 'down';
    this.phase = 'playing';
    this.outcome = null;
    this.attempt += 1;
    this._recount();
  };

  Engine.prototype._recount = function () {
    var powered = 0;
    var goals = this.level.goals;
    for (var i = 0; i < goals.length; i++) {
      if (this.crates[key(goals[i].row, goals[i].col)]) powered++;
    }
    this.poweredGoals = powered;
  };

  Engine.prototype.crateAt = function (row, col) { return !!this.crates[key(row, col)]; };
  Engine.prototype.wallAt = function (row, col) { return this.level.wallAt(row, col); };

  /* Returns a description of what a move in `dir` would do, or null when the
     move is refused by the yard. */
  Engine.prototype.probe = function (dir) {
    if (this.phase !== 'playing') return null;
    var d = DIRS[dir];
    if (!d) return null;
    var tr = this.player.row + d.dr, tc = this.player.col + d.dc;
    if (this.wallAt(tr, tc)) return null;
    if (this.crateAt(tr, tc)) {
      var br = tr + d.dr, bc = tc + d.dc;
      if (this.wallAt(br, bc) || this.crateAt(br, bc)) return null;
      return { to: { row: tr, col: tc }, push: { from: { row: tr, col: tc }, to: { row: br, col: bc } } };
    }
    return { to: { row: tr, col: tc }, push: null };
  };

  Engine.prototype.move = function (dir) {
    if (!DIRS[dir]) throw fail('bad_action', 'Direction must be up, down, left or right.');
    if (this.phase === 'complete') throw fail('level_complete', 'The board is powered; undo, restart or pick another board.');
    var plan = this.probe(dir);
    if (!plan) throw fail('blocked', 'That push is blocked.');
    var prevFacing = this.facing;
    this.facing = dir;

    var seated = [];
    var unseated = null;
    if (plan.push) {
      delete this.crates[key(plan.push.from.row, plan.push.from.col)];
      this.crates[key(plan.push.to.row, plan.push.to.col)] = true;
      this.pushCount += 1;
      if (this.level.goalAt(plan.push.to.row, plan.push.to.col)) seated.push(plan.push.to);
      if (this.level.goalAt(plan.push.from.row, plan.push.from.col)) unseated = plan.push.from;
    }
    var prevPlayer = { row: this.player.row, col: this.player.col };
    this.player = { row: plan.to.row, col: plan.to.col };
    this.moveCount += 1;
    this.history.push({
      player: prevPlayer,
      facing: prevFacing,
      push: plan.push,
      phase: 'playing',
      outcome: null
    });
    this._recount();

    var completed = false;
    if (this.poweredGoals === this.level.crates.length) {
      this.phase = 'complete';
      this.outcome = 'powered';
      completed = true;
    }
    this.revision += 1;
    return {
      kind: 'move',
      dir: dir,
      from: prevPlayer,
      to: this.player,
      push: plan.push,
      seated: seated,
      unseated: unseated,
      completed: completed
    };
  };

  Engine.prototype.undo = function () {
    if (!this.history.length) throw fail('no_undo', 'There is nothing to rewind.');
    var step = this.history.pop();
    var undonePlayer = { row: this.player.row, col: this.player.col };
    var push = step.push;
    if (push) {
      delete this.crates[key(push.to.row, push.to.col)];
      this.crates[key(push.from.row, push.from.col)] = true;
      this.pushCount -= 1;
    }
    this.player = { row: step.player.row, col: step.player.col };
    this.facing = step.facing;
    this.moveCount -= 1;
    this.phase = step.phase;
    this.outcome = step.outcome;
    this._recount();
    this.revision += 1;
    return {
      kind: 'undo',
      from: undonePlayer,
      to: this.player,
      push: push ? { from: push.to, to: push.from } : null
    };
  };

  Engine.prototype.restart = function () {
    var id = this.level.id;
    this._load(id);
    this.revision += 1;
    return { kind: 'restart', levelId: id };
  };

  Engine.prototype.selectLevel = function (levelId) {
    if (typeof levelId !== 'string') throw fail('unknown_level', 'A board id is required.');
    this._load(levelId);
    this.revision += 1;
    return { kind: 'select_level', levelId: levelId };
  };

  Engine.prototype.reset = function (seed) {
    this.seed = (seed === undefined ? null : seed);
    this.attempt = 0;
    this._load(this.levels[0].id);
    this.revision += 1;
    return { kind: 'reset', levelId: this.level.id };
  };

  Engine.prototype.legalActions = function () {
    var actions = [];
    var i;
    for (i = 0; i < DIR_NAMES.length; i++) {
      if (this.probe(DIR_NAMES[i])) actions.push({ type: 'move', direction: DIR_NAMES[i] });
    }
    if (this.history.length) actions.push({ type: 'undo' });
    for (i = 0; i < this.levels.length; i++) {
      actions.push({ type: 'select_level', levelId: this.levels[i].id });
    }
    return actions;
  };

  function cellList(list) {
    return list.map(function (p) { return { row: p.row, col: p.col }; }).sort(function (a, b) {
      return a.row - b.row || a.col - b.col;
    });
  }

  Engine.prototype.crateList = function () {
    var out = [];
    for (var k in this.crates) {
      if (this.crates[k]) { var n = Number(k); out.push({ row: Math.floor(n / 64), col: n % 64 }); }
    }
    return cellList(out);
  };

  /* The exact, closed state contract. Nothing hidden, nothing extra. */
  Engine.prototype.state = function () {
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.level.id,
      width: this.level.width,
      height: this.level.height,
      walls: cellList(this.level.walls),
      goals: cellList(this.level.goals),
      crates: this.crateList(),
      player: { row: this.player.row, col: this.player.col },
      poweredGoals: this.poweredGoals,
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.history.length > 0,
      legalActions: this.legalActions()
    };
  };

  /* Single entry point for every accepted mutation, whoever asks. */
  Engine.prototype.apply = function (action) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw fail('bad_action', 'An action object with a type is required.');
    }
    switch (action.type) {
      case 'move':
        return this.move(action.direction);
      case 'undo':
        return this.undo();
      case 'select_level':
        return this.selectLevel(action.levelId);
      default:
        throw fail('bad_action', 'Unknown action type "' + action.type + '".');
    }
  };

  Engine.fail = fail;
  Engine.DIRS = DIRS;
  Engine.DIR_NAMES = DIR_NAMES;
  global.LumenEngine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).LumenEngine;
}
