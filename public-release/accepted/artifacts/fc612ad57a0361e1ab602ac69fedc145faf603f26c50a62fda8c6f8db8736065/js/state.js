/* Lumen Yard — the game engine. One shared state object for human input,
   the arena bridge, and window.__ARENA_GAME__. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;
  var LEVELS = Lumen.LEVELS;
  var LEVEL_ORDER = Lumen.LEVEL_ORDER;

  var DIRS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 },
  };

  function err(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function Game() {
    this.seed = null;
    this.revision = 0;
    this.attempt = 1;
    this.levelId = 'first-light';
    this.rows = 0;
    this.cols = 0;
    this.walls = new Set();
    this.goals = new Set();
    this.crates = new Set();
    this.player = { row: 0, col: 0 };
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = 'playing'; // 'playing' | 'complete'
    this.outcome = null;    // null | 'powered'
    this.history = [];      // snapshots of internal state before each successful move
  }

  Game.prototype.loadLevel = function (id) {
    var rows = LEVELS[id];
    if (!rows) throw err('unknown_level', 'unknown board');
    var h = rows.length;
    var w = rows[0].length;
    this.rows = h;
    this.cols = w;
    this.walls = new Set();
    this.goals = new Set();
    this.crates = new Set();
    for (var r = 0; r < h; r++) {
      var line = rows[r];
      if (line.length !== w) throw err('bad_board', 'ragged board');
      for (var c = 0; c < w; c++) {
        var ch = line.charAt(c);
        if (ch === '#') this.walls.add(r + ',' + c);
        else if (ch === 'o') this.goals.add(r + ',' + c);
        else if (ch === '$') this.crates.add(r + ',' + c);
        else if (ch === '@') this.player = { row: r, col: c };
      }
    }
    if (this.crates.size !== this.goals.size) throw err('bad_board', 'crate/goal mismatch');
    this.history = [];
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = 'playing';
    this.outcome = null;
  };

  Game.prototype.startAt = function (id) {
    if (!LEVELS[id]) id = 'first-light';
    this.levelId = id;
    this.attempt = 1;
    this.revision = 0;
    this.loadLevel(id);
    return this.snapshot();
  };

  Game.prototype.reset = function (seed) {
    this.seed = (seed === undefined || seed === null) ? null : String(seed);
    this.startAt('first-light');
    return this.snapshot();
  };

  Game.prototype.restart = function () {
    this.attempt += 1;
    this.loadLevel(this.levelId);
    this.revision += 1;
    return this.snapshot();
  };

  Game.prototype.selectLevel = function (id) {
    if (!LEVELS[id]) throw err('unknown_level', 'unknown board');
    this.levelId = id;
    this.attempt += 1;
    this.loadLevel(id);
    this.revision += 1;
    return this.snapshot();
  };

  Game.prototype.isWall = function (r, c) {
    return r < 0 || c < 0 || r >= this.rows || c >= this.cols || this.walls.has(r + ',' + c);
  };

  Game.prototype.isBlocked = function (r, c) {
    return this.isWall(r, c) || this.crates.has(r + ',' + c);
  };

  Game.prototype.moveLegal = function (dir) {
    var d = DIRS[dir];
    if (!d || this.phase !== 'playing') return false;
    var pr = this.player.row + d.dr;
    var pc = this.player.col + d.dc;
    if (this.isWall(pr, pc)) return false;
    if (this.crates.has(pr + ',' + pc)) {
      var nr = pr + d.dr;
      var nc = pc + d.dc;
      if (this.isBlocked(nr, nc)) return false;
    }
    return true;
  };

  Game.prototype.poweredCount = function () {
    var n = 0;
    var self = this;
    this.crates.forEach(function (k) {
      if (self.goals.has(k)) n++;
    });
    return n;
  };

  Game.prototype.tryMove = function (dir) {
    var d = DIRS[dir];
    if (!d) throw err('illegal_action', 'unknown direction');
    if (this.phase !== 'playing') throw err('illegal_action', 'movement is frozen after completion');
    var pr = this.player.row + d.dr;
    var pc = this.player.col + d.dc;
    if (this.isWall(pr, pc)) throw err('blocked', 'blocked by wall');
    var pkey = pr + ',' + pc;
    var pushed = false;
    var crateFrom = null;
    var crateTo = null;
    var crates = new Set(this.crates);
    if (crates.has(pkey)) {
      var nr = pr + d.dr;
      var nc = pc + d.dc;
      if (this.isBlocked(nr, nc)) throw err('blocked', 'cannot push');
      crateFrom = pkey;
      crateTo = nr + ',' + nc;
      crates.delete(pkey);
      crates.add(crateTo);
      pushed = true;
    }
    this.history.push({
      player: { row: this.player.row, col: this.player.col },
      crates: new Set(this.crates),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      phase: this.phase,
      outcome: this.outcome,
      dir: dir,
    });
    this.player = { row: pr, col: pc };
    this.crates = crates;
    this.moveCount += 1;
    if (pushed) this.pushCount += 1;
    this.revision += 1;
    var powered = this.poweredCount();
    var completed = false;
    if (powered === this.goals.size) {
      this.phase = 'complete';
      this.outcome = 'powered';
      completed = true;
    }
    return {
      dir: dir,
      pushed: pushed,
      crateFrom: crateFrom,
      crateTo: crateTo,
      seated: pushed ? this.goals.has(crateTo) : false,
      powered: powered,
      completed: completed,
    };
  };

  Game.prototype.undo = function () {
    if (!this.history.length) throw err('illegal_action', 'nothing to undo');
    var prev = this.history.pop();
    var push = prev.moveCount !== this.moveCount - 1;
    this.player = prev.player;
    this.crates = new Set(prev.crates);
    this.moveCount = prev.moveCount;
    this.pushCount = prev.pushCount;
    this.phase = prev.phase;
    this.outcome = prev.outcome;
    this.revision += 1;
    return { dir: prev.dir, push: push };
  };

  Game.prototype.legalActions = function () {
    var out = [];
    if (this.phase === 'playing') {
      for (var i = 0; i < 4; i++) {
        var d = ['up', 'down', 'left', 'right'][i];
        if (this.moveLegal(d)) out.push({ type: 'move', direction: d });
      }
    }
    if (this.history.length) out.push({ type: 'undo' });
    for (var j = 0; j < LEVEL_ORDER.length; j++) {
      out.push({ type: 'select_level', levelId: LEVEL_ORDER[j] });
    }
    return out;
  };

  Game.prototype.act = function (action) {
    if (!action || typeof action !== 'object') throw err('illegal_action', 'bad action');
    if (action.type === 'move') {
      this.tryMove(action.direction);
      return this.snapshot();
    }
    if (action.type === 'undo') {
      this.undo();
      return this.snapshot();
    }
    if (action.type === 'select_level') {
      return this.selectLevel(action.levelId);
    }
    throw err('illegal_action', 'unknown action type');
  };

  function sortedCells(set) {
    var arr = [];
    set.forEach(function (k) {
      var p = k.split(',');
      arr.push({ row: +p[0], col: +p[1] });
    });
    arr.sort(function (a, b) { return a.row - b.row || a.col - b.col; });
    return arr;
  }

  Game.prototype.snapshot = function () {
    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.levelId,
      width: this.cols,
      height: this.rows,
      walls: sortedCells(this.walls),
      goals: sortedCells(this.goals),
      crates: sortedCells(this.crates),
      player: { row: this.player.row, col: this.player.col },
      poweredGoals: this.poweredCount(),
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable: this.history.length > 0,
      legalActions: this.legalActions(),
    };
  };

  Lumen.Game = Game;
  Lumen.game = new Game();
  Lumen.game.startAt('first-light');
})(typeof window !== 'undefined' ? window : globalThis);
