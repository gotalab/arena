// Lumen Yard - Level Definitions
// Authored 20 fixed boards from the production brief

export const RAW_LEVELS = [
  {
    id: "first-light",
    title: "First Light",
    chapter: 1,
    description: "Opening restoration: learn the cornering push.",
    map: [
      "#######",
      "#...o.#",
      "#.....#",
      "#..$..#",
      "#.@...#",
      "#.....#",
      "#######"
    ]
  },
  {
    id: "crossfeed",
    title: "Crossfeed",
    chapter: 1,
    description: "Introduce order across two relays.",
    map: [
      "########",
      "#..oo..#",
      "#......#",
      "#.$.$..#",
      "#...@..#",
      "#......#",
      "########"
    ]
  },
  {
    id: "black-start",
    title: "Black Start",
    chapter: 1,
    description: "Three relays compete for access across one shared yard.",
    map: [
      "########",
      "#.o.o.o#",
      "#......#",
      "#.$.$$.#",
      "#...@..#",
      "#......#",
      "########"
    ]
  },
  {
    id: "split-bus",
    title: "Split Bus",
    chapter: 2,
    description: "Substation busbars divide the yard.",
    map: [
      "########",
      "#.o..o.#",
      "#......#",
      "#..##..#",
      "#.$..$.#",
      "#...@..#",
      "#......#",
      "########"
    ]
  },
  {
    id: "relay-bend",
    title: "Relay Bend",
    chapter: 2,
    description: "Navigate heavy cores around central baffles.",
    map: [
      "########",
      "#..o...#",
      "#....o.#",
      "#..#...#",
      "#.$.$..#",
      "#..@...#",
      "#......#",
      "########"
    ]
  },
  {
    id: "service-loop",
    title: "Service Loop",
    chapter: 2,
    description: "Circulate through the maintenance corridors.",
    map: [
      "#########",
      "#..o.o..#",
      "#.......#",
      "#.#...#.#",
      "#.$.$...#",
      "#...@...#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "cold-iron",
    title: "Cold Iron",
    chapter: 2,
    description: "Awaken dormant primary transformers.",
    map: [
      "#########",
      "#..o..o.#",
      "#o......#",
      "#...#...#",
      "#.$$.$..#",
      "#...@...#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "brownout",
    title: "Brownout",
    chapter: 2,
    description: "Tight margins require meticulous ordering.",
    map: [
      "#########",
      "#..ooo..#",
      "#.......#",
      "#..#.#..#",
      "#.$.$.$.#",
      "#...@...#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "dead-bus",
    title: "Dead Bus",
    chapter: 2,
    description: "Clear paths before committing heavy relays.",
    map: [
      "#########",
      "#..ooo..#",
      "#.#...#.#",
      "#.......#",
      "#.$$.$..#",
      "#....@..#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "copper-maze",
    title: "Copper Maze",
    chapter: 2,
    description: "High-density ground pillars challenge alignment.",
    map: [
      "#########",
      "#o..o..o#",
      "#.......#",
      "#.#.#.#.#",
      "#.$.$.$.#",
      "#...@...#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "backfeed",
    title: "Backfeed",
    chapter: 3,
    description: "Feed auxiliary lines to unlock secondary corridors.",
    map: [
      "#########",
      "#o.o....#",
      "#...o...#",
      "#.#...#.#",
      "#.$.$.$.#",
      "#..@....#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "load-shed",
    title: "Load Shed",
    chapter: 3,
    description: "Steer clear of dead-end feeder lines.",
    map: [
      "#########",
      "#..o.o..#",
      "#o......#",
      "#..##...#",
      "#.$.$.$.#",
      "#....@..#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "last-circuit",
    title: "Last Circuit",
    chapter: 3,
    description: "Four cores demand sequenced positioning.",
    map: [
      "##########",
      "#..o.oo..#",
      "#....o...#",
      "#..##....#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########"
    ]
  },
  {
    id: "switchyard",
    title: "Switchyard",
    chapter: 3,
    description: "Central marshalling yard for high-voltage circuits.",
    map: [
      "#########",
      "#..oooo.#",
      "#.......#",
      "#.#.#...#",
      "#.$.$.$.#",
      "#..$@...#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "phase-lock",
    title: "Phase Lock",
    chapter: 3,
    description: "Synchronize relay frequencies through narrow channels.",
    map: [
      "#########",
      "#o.o.o..#",
      "#.......#",
      "#..###..#",
      "#.$...$.#",
      "#...$@..#",
      "#.......#",
      "#########"
    ]
  },
  {
    id: "auxiliary",
    title: "Auxiliary",
    chapter: 3,
    description: "Backup generators online; four lines await.",
    map: [
      "##########",
      "#..o.oo..#",
      "#o.......#",
      "#..#..#..#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########"
    ]
  },
  {
    id: "redline",
    title: "Redline",
    chapter: 4,
    description: "Peak load configuration across perimeter sockets.",
    map: [
      "##########",
      "#o.o..o.o#",
      "#........#",
      "#.#....#.#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########"
    ]
  },
  {
    id: "island-mode",
    title: "Island Mode",
    chapter: 4,
    description: "Isolated operation requiring careful power routing.",
    map: [
      "##########",
      "#..oooo..#",
      "#........#",
      "#..#..#..#",
      "#.$.$.$..#",
      "#..$..@..#",
      "#........#",
      "##########"
    ]
  },
  {
    id: "cascade",
    title: "Cascade",
    chapter: 4,
    description: "Complex conduit layout before the final dawn.",
    map: [
      "##########",
      "#o..oo..o#",
      "#........#",
      "#.#.##.#.#",
      "#.$.$.$..#",
      "#....$@..#",
      "#........#",
      "##########"
    ]
  },
  {
    id: "dawn-sequence",
    title: "Dawn Sequence",
    chapter: 4,
    description: "The final dawn only when the whole yard has been restored.",
    map: [
      "##########",
      "#o..oo..o#",
      "#...##...#",
      "#........#",
      "#.$.$.$..#",
      "#...$@...#",
      "#........#",
      "##########"
    ]
  }
];

export const LEVEL_IDS = RAW_LEVELS.map(lvl => lvl.id);

/**
 * Parses raw map array into structured coordinates.
 * Coordinates are sorted row-then-col for contract compliance.
 */
export function parseLevel(rawDef) {
  const height = rawDef.map.length;
  const width = rawDef.map[0].length;
  const walls = [];
  const goals = [];
  const crates = [];
  let player = null;

  for (let r = 0; r < height; r++) {
    const rowStr = rawDef.map[r];
    for (let c = 0; c < width; c++) {
      const ch = rowStr[c];
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

  const sortCoords = (arr) => arr.slice().sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

  return {
    id: rawDef.id,
    title: rawDef.title,
    chapter: rawDef.chapter,
    description: rawDef.description,
    width,
    height,
    walls: sortCoords(walls),
    goals: sortCoords(goals),
    initialCrates: sortCoords(crates),
    initialPlayer: player ? { row: player.row, col: player.col } : { row: 0, col: 0 }
  };
}

export const PARSED_LEVELS = RAW_LEVELS.map(parseLevel);
export const LEVEL_MAP = new Map(PARSED_LEVELS.map(lvl => [lvl.id, lvl]));
