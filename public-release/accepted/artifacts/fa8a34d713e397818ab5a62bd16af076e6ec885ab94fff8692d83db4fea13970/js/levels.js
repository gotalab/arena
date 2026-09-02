/** Authored campaign boards. Layouts are canonical; do not edit glyphs. */

export const LEVEL_IDS = Object.freeze([
  "first-light",
  "crossfeed",
  "black-start",
  "split-bus",
  "relay-bend",
  "service-loop",
  "cold-iron",
  "brownout",
  "dead-bus",
  "copper-maze",
  "backfeed",
  "load-shed",
  "last-circuit",
  "switchyard",
  "phase-lock",
  "auxiliary",
  "redline",
  "island-mode",
  "cascade",
  "dawn-sequence",
]);

export const LEVEL_META = Object.freeze({
  "first-light": { title: "First Light", chapter: 1 },
  crossfeed: { title: "Crossfeed", chapter: 1 },
  "black-start": { title: "Black Start", chapter: 1, chapterEnd: true },
  "split-bus": { title: "Split Bus", chapter: 2 },
  "relay-bend": { title: "Relay Bend", chapter: 2 },
  "service-loop": { title: "Service Loop", chapter: 2 },
  "cold-iron": { title: "Cold Iron", chapter: 2 },
  brownout: { title: "Brownout", chapter: 2 },
  "dead-bus": { title: "Dead Bus", chapter: 2 },
  "copper-maze": { title: "Copper Maze", chapter: 2 },
  backfeed: { title: "Backfeed", chapter: 2 },
  "load-shed": { title: "Load Shed", chapter: 2 },
  "last-circuit": { title: "Last Circuit", chapter: 2 },
  switchyard: { title: "Switchyard", chapter: 2 },
  "phase-lock": { title: "Phase Lock", chapter: 2 },
  auxiliary: { title: "Auxiliary", chapter: 2 },
  redline: { title: "Redline", chapter: 2 },
  "island-mode": { title: "Island Mode", chapter: 2 },
  cascade: { title: "Cascade", chapter: 2 },
  "dawn-sequence": { title: "Dawn Sequence", chapter: 2, finale: true },
});

const RAW = {
  "first-light": `
#######
#...o.#
#.....#
#..$..#
#.@...#
#.....#
#######`,
  crossfeed: `
########
#..oo..#
#......#
#.$.$..#
#...@..#
#......#
########`,
  "black-start": `
########
#.o.o.o#
#......#
#.$.$$.#
#...@..#
#......#
########`,
  "split-bus": `
########
#.o..o.#
#......#
#..##..#
#.$..$.#
#...@..#
#......#
########`,
  "relay-bend": `
########
#..o...#
#....o.#
#..#...#
#.$.$..#
#..@...#
#......#
########`,
  "service-loop": `
#########
#..o.o..#
#.......#
#.#...#.#
#.$.$...#
#...@...#
#.......#
#########`,
  "cold-iron": `
#########
#..o..o.#
#o......#
#...#...#
#.$$.$..#
#...@...#
#.......#
#########`,
  brownout: `
#########
#..ooo..#
#.......#
#..#.#..#
#.$.$.$.#
#...@...#
#.......#
#########`,
  "dead-bus": `
#########
#..ooo..#
#.#...#.#
#.......#
#.$$.$..#
#....@..#
#.......#
#########`,
  "copper-maze": `
#########
#o..o..o#
#.......#
#.#.#.#.#
#.$.$.$.#
#...@...#
#.......#
#########`,
  backfeed: `
#########
#o.o....#
#...o...#
#.#...#.#
#.$.$.$.#
#..@....#
#.......#
#########`,
  "load-shed": `
#########
#..o.o..#
#o......#
#..##...#
#.$.$.$.#
#....@..#
#.......#
#########`,
  "last-circuit": `
##########
#..o.oo..#
#....o...#
#..##....#
#.$.$.$..#
#...$@...#
#........#
##########`,
  switchyard: `
#########
#..oooo.#
#.......#
#.#.#...#
#.$.$.$.#
#..$@...#
#.......#
#########`,
  "phase-lock": `
#########
#o.o.o..#
#.......#
#..###..#
#.$...$.#
#...$@..#
#.......#
#########`,
  auxiliary: `
##########
#..o.oo..#
#o.......#
#..#..#..#
#.$.$.$..#
#...$@...#
#........#
##########`,
  redline: `
##########
#o.o..o.o#
#........#
#.#....#.#
#.$.$.$..#
#...$@...#
#........#
##########`,
  "island-mode": `
##########
#..oooo..#
#........#
#..#..#..#
#.$.$.$..#
#..$..@..#
#........#
##########`,
  cascade: `
##########
#o..oo..o#
#........#
#.#.##.#.#
#.$.$.$..#
#....$@..#
#........#
##########`,
  "dawn-sequence": `
##########
#o..oo..o#
#...##...#
#........#
#.$.$.$..#
#...$@...#
#........#
##########`,
};

export function parseLevel(id) {
  const raw = RAW[id];
  if (!raw) return null;
  const rows = raw.trim().split("\n").map((line) => line.trimEnd());
  const height = rows.length;
  const width = rows[0].length;
  const walls = [];
  const goals = [];
  const crates = [];
  let player = null;

  for (let row = 0; row < height; row += 1) {
    const line = rows[row];
    if (line.length !== width) {
      throw new Error(`Level ${id} row ${row} has uneven width`);
    }
    for (let col = 0; col < width; col += 1) {
      const ch = line[col];
      if (ch === "#") walls.push({ row, col });
      else if (ch === "o") goals.push({ row, col });
      else if (ch === "$") crates.push({ row, col });
      else if (ch === "@") player = { row, col };
      else if (ch === ".") {
        /* floor */
      } else if (ch === "*") {
        goals.push({ row, col });
        crates.push({ row, col });
      } else if (ch === "+") {
        goals.push({ row, col });
        player = { row, col };
      } else {
        throw new Error(`Level ${id} unknown glyph '${ch}' at ${row},${col}`);
      }
    }
  }

  if (!player) throw new Error(`Level ${id} is missing the robot`);
  return {
    id,
    width,
    height,
    walls: sortCells(walls),
    goals: sortCells(goals),
    crates: sortCells(crates),
    player: { row: player.row, col: player.col },
  };
}

export function sortCells(cells) {
  return cells
    .slice()
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((c) => ({ row: c.row, col: c.col }));
}

export const PARSED_LEVELS = Object.freeze(
  Object.fromEntries(LEVEL_IDS.map((id) => [id, Object.freeze(parseLevel(id))])),
);

export function nextLevelId(id) {
  const i = LEVEL_IDS.indexOf(id);
  if (i < 0 || i === LEVEL_IDS.length - 1) return null;
  return LEVEL_IDS[i + 1];
}

export function levelIndex(id) {
  return LEVEL_IDS.indexOf(id);
}
