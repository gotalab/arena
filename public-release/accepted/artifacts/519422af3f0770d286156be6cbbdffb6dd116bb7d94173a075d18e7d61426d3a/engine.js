// Level definitions
export const LEVELS_RAW = [
  {
    id: "first-light",
    name: "First Light",
    chapter: 1,
    desc: "Cornering push to close the first contact.",
    map: `
#######
#...o.#
#.....#
#..$..#
#.@...#
#.....#
#######
`
  },
  {
    id: "crossfeed",
    name: "Crossfeed",
    chapter: 1,
    desc: "Establish sequence across twin relays.",
    map: `
########
#..oo..#
#......#
#.$.$..#
#...@..#
#......#
########
`
  },
  {
    id: "black-start",
    name: "Black Start",
    chapter: 1,
    desc: "Three relays competing for access in a dark yard.",
    map: `
########
#.o.o.o#
#......#
#.$.$$.#
#...@..#
#......#
########
`
  },
  {
    id: "split-bus",
    name: "Split Bus",
    chapter: 2,
    desc: "Twin pylons divide the central channel.",
    map: `
########
#.o..o.#
#......#
#..##..#
#.$..$.#
#...@..#
#......#
########
`
  },
  {
    id: "relay-bend",
    name: "Relay Bend",
    chapter: 2,
    desc: "Single obstruction alters the return loop.",
    map: `
########
#..o...#
#....o.#
#..#...#
#.$.$..#
#..@...#
#......#
########
`
  },
  {
    id: "service-loop",
    name: "Service Loop",
    chapter: 2,
    desc: "Wide yard with dual isolators.",
    map: `
#########
#..o.o..#
#.......#
#.#...#.#
#.$.$...#
#...@...#
#.......#
#########
`
  },
  {
    id: "cold-iron",
    name: "Cold Iron",
    chapter: 2,
    desc: "Three asymmetric feeds around a core pillar.",
    map: `
#########
#..o..o.#
#o......#
#...#...#
#.$$.$..#
#...@...#
#.......#
#########
`
  },
  {
    id: "brownout",
    name: "Brownout",
    chapter: 2,
    desc: "Triple linear bank behind staggered insulators.",
    map: `
#########
#..ooo..#
#.......#
#..#.#..#
#.$.$.$.#
#...@...#
#.......#
#########
`
  },
  {
    id: "dead-bus",
    name: "Dead Bus",
    chapter: 2,
    desc: "Flanked posts demand precise staging.",
    map: `
#########
#..ooo..#
#.#...#.#
#.......#
#.$$.$..#
#....@..#
#.......#
#########
`
  },
  {
    id: "copper-maze",
    name: "Copper Maze",
    chapter: 2,
    desc: "Alternating pylons enforce strict lanes.",
    map: `
#########
#o..o..o#
#.......#
#.#.#.#.#
#.$.$.$.#
#...@...#
#.......#
#########
`
  },
  {
    id: "backfeed",
    name: "Backfeed",
    chapter: 2,
    desc: "Diagonal goal distribution requires reversing order.",
    map: `
#########
#o.o....#
#...o...#
#.#...#.#
#.$.$.$.#
#..@....#
#.......#
#########
`
  },
  {
    id: "load-shed",
    name: "Load Shed",
    chapter: 2,
    desc: "Twin central barrier with corner termination.",
    map: `
#########
#..o.o..#
#o......#
#..##...#
#.$.$.$.#
#....@..#
#.......#
#########
`
  },
  {
    id: "last-circuit",
    name: "Last Circuit",
    chapter: 3,
    desc: "Quad core network with staggered receivers.",
    map: `
##########
#..o.oo..#
#....o...#
#..##....#
#.$.$.$..#
#...$@...#
#........#
##########
`
  },
  {
    id: "switchyard",
    name: "Switchyard",
    chapter: 3,
    desc: "Dense bank feeding a consolidated terminal.",
    map: `
#########
#..oooo.#
#.......#
#.#.#...#
#.$.$.$.#
#..$@...#
#.......#
#########
`
  },
  {
    id: "phase-lock",
    name: "Phase Lock",
    chapter: 3,
    desc: "Solid barrier forcing circuit loops around perimeter.",
    map: `
#########
#o.o.o..#
#.......#
#..###..#
#.$...$.#
#...$@..#
#.......#
#########
`
  },
  {
    id: "auxiliary",
    name: "Auxiliary",
    chapter: 3,
    desc: "Spaced pillars guarding wide distribution sockets.",
    map: `
##########
#..o.oo..#
#o.......#
#..#..#..#
#.$.$.$..#
#...$@...#
#........#
##########
`
  },
  {
    id: "redline",
    name: "Redline",
    chapter: 3,
    desc: "Perimeter sockets test full traversal limits.",
    map: `
##########
#o.o..o.o#
#........#
#.#....#.#
#.$.$.$..#
#...$@...#
#........#
##########
`
  },
  {
    id: "island-mode",
    name: "Island Mode",
    chapter: 3,
    desc: "Isolated core demands early staging.",
    map: `
##########
#..oooo..#
#........#
#..#..#..#
#.$.$.$..#
#..$..@..#
#........#
##########
`
  },
  {
    id: "cascade",
    name: "Cascade",
    chapter: 3,
    desc: "Quad pillar layout with tight routing clearances.",
    map: `
##########
#o..oo..o#
#........#
#.#.##.#.#
#.$.$.$..#
#....$@..#
#........#
##########
`
  },
  {
    id: "dawn-sequence",
    name: "Dawn Sequence",
    chapter: 4,
    desc: "The final awakening of the main power grid.",
    map: `
##########
#o..oo..o#
#...##...#
#........#
#.$.$.$..#
#...$@...#
#........#
##########
`
  }
];

export function parseLevel(raw) {
  const lines = raw.map.trim().split("\n").map(l => l.trimEnd());
  const height = lines.length;
  let width = 0;
  for (const line of lines) {
    if (line.length > width) width = line.length;
  }

  const walls = [];
  const goals = [];
  const crates = [];
  let player = null;

  for (let r = 0; r < height; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '#') {
        walls.push({ row: r, col: c });
      } else if (ch === 'o') {
        goals.push({ row: r, col: c });
      } else if (ch === '$') {
        crates.push({ row: r, col: c });
      } else if (ch === '@') {
        player = { row: r, col: c };
      }
    }
  }

  // Sort
  const sorter = (a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col;
  walls.sort(sorter);
  goals.sort(sorter);
  crates.sort(sorter);

  return {
    id: raw.id,
    name: raw.name,
    chapter: raw.chapter,
    desc: raw.desc,
    width,
    height,
    walls,
    goals,
    initialCrates: crates,
    initialPlayer: player
  };
}

export const PARSED_LEVELS = LEVELS_RAW.map(parseLevel);
export const LEVEL_MAP = new Map(PARSED_LEVELS.map(l => [l.id, l]));

export class GameEngine {
  constructor(options = {}) {
    this.seed = options.seed || null;
    this.revision = 1;
    this.attempt = 1;
    this.currentLevelIndex = 0;
    this.currentLevel = PARSED_LEVELS[0];

    this.player = { ...this.currentLevel.initialPlayer };
    this.playerFacing = "down";
    this.crates = this.currentLevel.initialCrates.map(c => ({ ...c }));
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = "playing"; // "playing" | "complete"
    this.outcome = null; // null | "powered"
    this.history = []; // stack of snapshots for undo

    this.onStateChange = options.onStateChange || null;
    this.onEvent = options.onEvent || null; // for sounds, animations, etc.
  }

  reset(seed = null) {
    if (seed !== null && seed !== undefined) {
      this.seed = seed;
    }
    this.revision++;
    this.attempt++;
    this.currentLevelIndex = 0;
    this.currentLevel = PARSED_LEVELS[0];
    this.loadLevel(this.currentLevel.id, false);
    return this.snapshot();
  }

  restart() {
    this.revision++;
    this.attempt++;
    this.loadLevel(this.currentLevel.id, false);
    return this.snapshot();
  }

  loadLevel(levelId, incrementRevision = true) {
    const lvl = LEVEL_MAP.get(levelId);
    if (!lvl) {
      const err = new Error(`Unknown levelId: ${levelId}`);
      err.code = "UNKNOWN_LEVEL";
      throw err;
    }
    this.currentLevel = lvl;
    this.currentLevelIndex = PARSED_LEVELS.findIndex(l => l.id === levelId);
    this.player = { ...lvl.initialPlayer };
    this.playerFacing = "down";
    this.crates = lvl.initialCrates.map(c => ({ ...c }));
    this.moveCount = 0;
    this.pushCount = 0;
    this.phase = "playing";
    this.outcome = null;
    this.history = [];
    this.checkCompletion();

    if (incrementRevision) {
      this.revision++;
      this.attempt++;
    }

    if (this.onEvent) {
      this.onEvent({ type: "level_loaded", levelId: lvl.id });
    }
    if (this.onStateChange) {
      this.onStateChange(this.snapshot());
    }
  }

  checkCompletion() {
    const goals = this.currentLevel.goals;
    let powered = 0;
    for (const crate of this.crates) {
      if (goals.some(g => g.row === crate.row && g.col === crate.col)) {
        powered++;
      }
    }
    if (powered === goals.length && goals.length > 0) {
      this.phase = "complete";
      this.outcome = "powered";
    } else {
      this.phase = "playing";
      this.outcome = null;
    }
    return powered;
  }

  getPoweredGoalsCount() {
    const goals = this.currentLevel.goals;
    let powered = 0;
    for (const crate of this.crates) {
      if (goals.some(g => g.row === crate.row && g.col === crate.col)) {
        powered++;
      }
    }
    return powered;
  }

  isWall(r, c) {
    return this.currentLevel.walls.some(w => w.row === r && w.col === c);
  }

  findCrate(r, c) {
    return this.crates.find(cr => cr.row === r && cr.col === c);
  }

  isGoal(r, c) {
    return this.currentLevel.goals.some(g => g.row === r && g.col === c);
  }

  canMove(direction) {
    if (this.phase === "complete") return false;

    let dr = 0, dc = 0;
    if (direction === "up") dr = -1;
    else if (direction === "down") dr = 1;
    else if (direction === "left") dc = -1;
    else if (direction === "right") dc = 1;
    else return false;

    const targetR = this.player.row + dr;
    const targetC = this.player.col + dc;

    if (this.isWall(targetR, targetC)) return false;

    const crate = this.findCrate(targetR, targetC);
    if (crate) {
      const beyondR = targetR + dr;
      const beyondC = targetC + dc;
      if (this.isWall(beyondR, beyondC)) return false;
      if (this.findCrate(beyondR, beyondC)) return false;
    }

    return true;
  }

  getLegalActions() {
    const actions = [];
    if (this.phase === "playing") {
      for (const dir of ["up", "down", "left", "right"]) {
        if (this.canMove(dir)) {
          actions.push({ type: "move", direction: dir });
        }
      }
    }
    if (this.history.length > 0) {
      actions.push({ type: "undo" });
    }
    for (const lvl of PARSED_LEVELS) {
      actions.push({ type: "select_level", levelId: lvl.id });
    }
    return actions;
  }

  act(action) {
    if (!action || typeof action !== "object") {
      const err = new Error("Action must be an object");
      err.code = "INVALID_ACTION";
      throw err;
    }

    if (action.type === "move") {
      if (this.phase === "complete") {
        const err = new Error("Movement frozen after completion");
        err.code = "ILLEGAL_ACTION";
        throw err;
      }

      const dir = action.direction;
      let dr = 0, dc = 0;
      if (dir === "up") dr = -1;
      else if (dir === "down") dr = 1;
      else if (dir === "left") dc = -1;
      else if (dir === "right") dc = 1;
      else {
        const err = new Error(`Invalid direction: ${dir}`);
        err.code = "INVALID_DIRECTION";
        throw err;
      }

      this.playerFacing = dir;

      const targetR = this.player.row + dr;
      const targetC = this.player.col + dc;

      if (this.isWall(targetR, targetC)) {
        if (this.onEvent) this.onEvent({ type: "move_blocked", direction: dir, target: { row: targetR, col: targetC } });
        const err = new Error("Cannot move into wall");
        err.code = "ILLEGAL_ACTION";
        throw err;
      }

      const crate = this.findCrate(targetR, targetC);
      if (crate) {
        const beyondR = targetR + dr;
        const beyondC = targetC + dc;
        if (this.isWall(beyondR, beyondC) || this.findCrate(beyondR, beyondC)) {
          if (this.onEvent) this.onEvent({ type: "push_blocked", direction: dir, cratePos: { row: targetR, col: targetC } });
          const err = new Error("Cannot push crate into wall or crate");
          err.code = "ILLEGAL_ACTION";
          throw err;
        }

        // Legal push! Save history before mutating
        this.history.push({
          player: { ...this.player },
          playerFacing: this.playerFacing,
          crates: this.crates.map(c => ({ ...c })),
          moveCount: this.moveCount,
          pushCount: this.pushCount,
          phase: this.phase,
          outcome: this.outcome
        });

        // Mutate
        crate.row = beyondR;
        crate.col = beyondC;
        this.player.row = targetR;
        this.player.col = targetC;
        this.pushCount++;
        this.moveCount++;
        this.revision++;

        const isCrateOnGoal = this.isGoal(beyondR, beyondC);
        const wasComplete = this.phase === "complete";
        const powered = this.checkCompletion();

        if (this.onEvent) {
          this.onEvent({
            type: "push",
            direction: dir,
            crate,
            onGoal: isCrateOnGoal,
            poweredCount: powered,
            completed: this.phase === "complete"
          });
          if (this.phase === "complete" && !wasComplete) {
            this.onEvent({ type: "board_completed", levelId: this.currentLevel.id, moves: this.moveCount, pushes: this.pushCount });
          }
        }
      } else {
        // Simple step
        this.history.push({
          player: { ...this.player },
          playerFacing: this.playerFacing,
          crates: this.crates.map(c => ({ ...c })),
          moveCount: this.moveCount,
          pushCount: this.pushCount,
          phase: this.phase,
          outcome: this.outcome
        });

        this.player.row = targetR;
        this.player.col = targetC;
        this.moveCount++;
        this.revision++;

        if (this.onEvent) {
          this.onEvent({ type: "step", direction: dir });
        }
      }

      if (this.onStateChange) this.onStateChange(this.snapshot());
      return this.snapshot();
    }

    if (action.type === "undo") {
      if (this.history.length === 0) {
        const err = new Error("No moves to undo");
        err.code = "NO_UNDO";
        throw err;
      }

      const prev = this.history.pop();
      this.player = { ...prev.player };
      this.playerFacing = prev.playerFacing;
      this.crates = prev.crates.map(c => ({ ...c }));
      this.moveCount = prev.moveCount;
      this.pushCount = prev.pushCount;
      this.phase = prev.phase;
      this.outcome = prev.outcome;
      this.revision++; // Revision still advances on undo

      if (this.onEvent) {
        this.onEvent({ type: "undo" });
      }
      if (this.onStateChange) this.onStateChange(this.snapshot());
      return this.snapshot();
    }

    if (action.type === "select_level") {
      const lvlId = action.levelId;
      if (!LEVEL_MAP.has(lvlId)) {
        const err = new Error(`Unknown level: ${lvlId}`);
        err.code = "UNKNOWN_LEVEL";
        throw err;
      }
      this.loadLevel(lvlId, true);
      return this.snapshot();
    }

    const err = new Error(`Unknown action type: ${action.type}`);
    err.code = "UNKNOWN_ACTION";
    throw err;
  }

  snapshot() {
    const sorter = (a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col;

    // Walls sorted
    const walls = this.currentLevel.walls.map(w => ({ row: w.row, col: w.col })).sort(sorter);
    // Goals sorted
    const goals = this.currentLevel.goals.map(g => ({ row: g.row, col: g.col })).sort(sorter);
    // Crates sorted
    const crates = this.crates.map(c => ({ row: c.row, col: c.col })).sort(sorter);

    const player = { row: this.player.row, col: this.player.col };
    const poweredGoals = this.getPoweredGoalsCount();
    const undoAvailable = this.history.length > 0;
    const legalActions = this.getLegalActions();

    return {
      revision: this.revision,
      attempt: this.attempt,
      phase: this.phase,
      outcome: this.outcome,
      levelId: this.currentLevel.id,
      width: this.currentLevel.width,
      height: this.currentLevel.height,
      walls,
      goals,
      crates,
      player,
      poweredGoals,
      moveCount: this.moveCount,
      pushCount: this.pushCount,
      undoAvailable,
      legalActions
    };
  }
}
