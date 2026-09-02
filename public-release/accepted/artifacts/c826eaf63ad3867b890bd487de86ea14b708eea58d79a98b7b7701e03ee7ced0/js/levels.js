/** @typedef {{ id: string, name: string, rows: string[] }} LevelDef */

/** @type {LevelDef[]} */
export const LEVELS = [
  {
    id: "first-light",
    name: "First Light",
    rows: [
      "#######",
      "#...o.#",
      "#.....#",
      "#..$..#",
      "#.@...#",
      "#.....#",
      "#######",
    ],
  },
  {
    id: "crossfeed",
    name: "Crossfeed",
    rows: [
      "########",
      "#..oo..#",
      "#......#",
      "#.$.$..#",
      "#...@..#",
      "#......#",
      "########",
    ],
  },
  {
    id: "black-start",
    name: "Black Start",
    rows: [
      "########",
      "#.o.o.o#",
      "#......#",
      "#.$.$$.#",
      "#...@..#",
      "#......#",
      "########",
    ],
  },
  {
    id: "split-bus",
    name: "Split Bus",
    rows: [
      "########",
      "#.o..o.#",
      "#......#",
      "#..##..#",
      "#.$..$.#",
      "#...@..#",
      "#......#",
      "########",
    ],
  },
  {
    id: "relay-bend",
    name: "Relay Bend",
    rows: [
      "########",
      "#..o...#",
      "#....o.#",
      "#..#...#",
      "#.$.$..#",
      "#..@...#",
      "#......#",
      "########",
    ],
  },
  {
    id: "service-loop",
    name: "Service Loop",
    rows: [
      "#########",
      "#..o.o..#",
      "#.......#",
      "#.#...#.#",
      "#.$.$...#",
      "#...@...#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "cold-iron",
    name: "Cold Iron",
    rows: [
      "#########",
      "#..o..o.#",
      "#o......#",
      "#...#...#",
      "#.$$.$..#",
      "#...@...#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "brownout",
    name: "Brownout",
    rows: [
      "#########",
      "#..ooo..#",
      "#.......#",
      "#..#.#..#",
      "#.$.$.$.#",
      "#...@...#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "dead-bus",
    name: "Dead Bus",
    rows: [
      "#########",
      "#..ooo..#",
      "#.#...#.#",
      "#.......#",
      "#.$$.$..#",
      "#....@..#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "copper-maze",
    name: "Copper Maze",
    rows: [
      "#########",
      "#o..o..o#",
      "#.......#",
      "#.#.#.#.#",
      "#.$.$.$.#",
      "#...@...#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "backfeed",
    name: "Backfeed",
    rows: [
      "#########",
      "#o.o....#",
      "#...o...#",
      "#.#...#.#",
      "#.$.$.$.#",
      "#..@....#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "load-shed",
    name: "Load Shed",
    rows: [
      "#########",
      "#..o.o..#",
      "#o......#",
      "#..##...#",
      "#.$.$.$.#",
      "#....@..#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "last-circuit",
    name: "Last Circuit",
    rows: [
      "##########",
      "#..o.oo..#",
      "#....o...#",
      "#..##....#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########",
    ],
  },
  {
    id: "switchyard",
    name: "Switchyard",
    rows: [
      "#########",
      "#..oooo.#",
      "#.......#",
      "#.#.#...#",
      "#.$.$.$.#",
      "#..$@...#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "phase-lock",
    name: "Phase Lock",
    rows: [
      "#########",
      "#o.o.o..#",
      "#.......#",
      "#..###..#",
      "#.$...$.#",
      "#...$@..#",
      "#.......#",
      "#########",
    ],
  },
  {
    id: "auxiliary",
    name: "Auxiliary",
    rows: [
      "##########",
      "#..o.oo..#",
      "#o.......#",
      "#..#..#..#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########",
    ],
  },
  {
    id: "redline",
    name: "Redline",
    rows: [
      "##########",
      "#o.o..o.o#",
      "#........#",
      "#.#....#.#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########",
    ],
  },
  {
    id: "island-mode",
    name: "Island Mode",
    rows: [
      "##########",
      "#..oooo..#",
      "#........#",
      "#..#..#..#",
      "#.$.$.$..#",
      "#..$..@..#",
      "#........#",
      "##########",
    ],
  },
  {
    id: "cascade",
    name: "Cascade",
    rows: [
      "##########",
      "#o..oo..o#",
      "#........#",
      "#.#.##.#.#",
      "#.$.$.$..#",
      "#....$@..#",
      "#........#",
      "##########",
    ],
  },
  {
    id: "dawn-sequence",
    name: "Dawn Sequence",
    rows: [
      "##########",
      "#o..oo..o#",
      "#...##...#",
      "#........#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########",
    ],
  },
];

export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
export const CHAPTER_END_ID = "black-start";
export const FINAL_ID = "dawn-sequence";

/**
 * @param {LevelDef} level
 */
export function parseLevel(level) {
  const height = level.rows.length;
  const width = level.rows[0].length;
  /** @type {{row:number,col:number}[]} */
  const walls = [];
  /** @type {{row:number,col:number}[]} */
  const goals = [];
  /** @type {{row:number,col:number}[]} */
  const crates = [];
  /** @type {{row:number,col:number}} */
  let player = { row: 0, col: 0 };

  for (let row = 0; row < height; row++) {
    const line = level.rows[row];
    for (let col = 0; col < width; col++) {
      const ch = line[col];
      if (ch === "#") walls.push({ row, col });
      else if (ch === "o") goals.push({ row, col });
      else if (ch === "$") crates.push({ row, col });
      else if (ch === "@") player = { row, col };
      else if (ch === "*") {
        goals.push({ row, col });
        crates.push({ row, col });
      } else if (ch === "+") {
        goals.push({ row, col });
        player = { row, col };
      }
    }
  }

  return {
    id: level.id,
    name: level.name,
    width,
    height,
    walls: sortCells(walls),
    goals: sortCells(goals),
    crates: sortCells(crates),
    player,
  };
}

/** @param {{row:number,col:number}[]} cells */
export function sortCells(cells) {
  return [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
}

/** @param {{row:number,col:number}[]} cells @param {number} row @param {number} col */
export function hasCell(cells, row, col) {
  return cells.some((c) => c.row === row && c.col === col);
}
