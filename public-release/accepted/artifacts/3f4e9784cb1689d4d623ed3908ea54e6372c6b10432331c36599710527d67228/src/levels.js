/**
 * LUMEN YARD - Level Definitions
 * 20 authored boards exactly as specified in the production brief.
 */

export const RAW_LEVELS = [
  {
    id: "first-light",
    title: "First Light",
    subtitle: "回路の初期化",
    chapter: 1,
    raw: `#######
#...o.#
#.....#
#..$..#
#.@...#
#.....#
#######`
  },
  {
    id: "crossfeed",
    title: "Crossfeed",
    subtitle: "並行給電ライン",
    chapter: 1,
    raw: `########
#..oo..#
#......#
#.$.$..#
#...@..#
#......#
########`
  },
  {
    id: "black-start",
    title: "Black Start",
    subtitle: "全系停電からの復旧",
    chapter: 1,
    raw: `########
#.o.o.o#
#......#
#.$.$$.#
#...@..#
#......#
########`
  },
  {
    id: "split-bus",
    title: "Split Bus",
    subtitle: "母線分離",
    chapter: 2,
    raw: `########
#.o..o.#
#......#
#..##..#
#.$..$.#
#...@..#
#......#
########`
  },
  {
    id: "relay-bend",
    title: "Relay Bend",
    subtitle: "迂回リレー",
    chapter: 2,
    raw: `########
#..o...#
#....o.#
#..#...#
#.$.$..#
#..@...#
#......#
########`
  },
  {
    id: "service-loop",
    title: "Service Loop",
    subtitle: "サービスループ",
    chapter: 2,
    raw: `#########
#..o.o..#
#.......#
#.#...#.#
#.$.$...#
#...@...#
#.......#
#########`
  },
  {
    id: "cold-iron",
    title: "Cold Iron",
    subtitle: "冷却鉄心",
    chapter: 2,
    raw: `#########
#..o..o.#
#o......#
#...#...#
#.$$.$..#
#...@...#
#.......#
#########`
  },
  {
    id: "brownout",
    title: "Brownout",
    subtitle: "電圧低下警告",
    chapter: 2,
    raw: `#########
#..ooo..#
#.......#
#..#.#..#
#.$.$.$.#
#...@...#
#.......#
#########`
  },
  {
    id: "dead-bus",
    title: "Dead Bus",
    subtitle: "無加圧母線",
    chapter: 2,
    raw: `#########
#..ooo..#
#.#...#.#
#.......#
#.$$.$..#
#....@..#
#.......#
#########`
  },
  {
    id: "copper-maze",
    title: "Copper Maze",
    subtitle: "銅線迷路",
    chapter: 2,
    raw: `#########
#o..o..o#
#.......#
#.#.#.#.#
#.$.$.$.#
#...@...#
#.......#
#########`
  },
  {
    id: "backfeed",
    title: "Backfeed",
    subtitle: "逆送電保護",
    chapter: 2,
    raw: `#########
#o.o....#
#...o...#
#.#...#.#
#.$.$.$.#
#..@....#
#.......#
#########`
  },
  {
    id: "load-shed",
    title: "Load Shed",
    subtitle: "負荷遮断",
    chapter: 2,
    raw: `#########
#..o.o..#
#o......#
#..##...#
#.$.$.$.#
#....@..#
#.......#
#########`
  },
  {
    id: "last-circuit",
    title: "Last Circuit",
    subtitle: "最終回路接続",
    chapter: 3,
    raw: `##########
#..o.oo..#
#....o...#
#..##....#
#.$.$.$..#
#...$@...#
#........#
##########`
  },
  {
    id: "switchyard",
    title: "Switchyard",
    subtitle: "変電開閉所",
    chapter: 3,
    raw: `#########
#..oooo.#
#.......#
#.#.#...#
#.$.$.$.#
#..$@...#
#.......#
#########`
  },
  {
    id: "phase-lock",
    title: "Phase Lock",
    subtitle: "位相同期",
    chapter: 3,
    raw: `#########
#o.o.o..#
#.......#
#..###..#
#.$...$.#
#...$@..#
#.......#
#########`
  },
  {
    id: "auxiliary",
    title: "Auxiliary",
    subtitle: "所内補助電源",
    chapter: 3,
    raw: `##########
#..o.oo..#
#o.......#
#..#..#..#
#.$.$.$..#
#...$@...#
#........#
##########`
  },
  {
    id: "redline",
    title: "Redline",
    subtitle: "限界過負荷",
    chapter: 3,
    raw: `##########
#o.o..o.o#
#........#
#.#....#.#
#.$.$.$..#
#...$@...#
#........#
##########`
  },
  {
    id: "island-mode",
    title: "Island Mode",
    subtitle: "単独系統運転",
    chapter: 3,
    raw: `##########
#..oooo..#
#........#
#..#..#..#
#.$.$.$..#
#..$..@..#
#........#
##########`
  },
  {
    id: "cascade",
    title: "Cascade",
    subtitle: "連鎖励磁",
    chapter: 3,
    raw: `##########
#o..oo..o#
#........#
#.#.##.#.#
#.$.$.$..#
#....$@..#
#........#
##########`
  },
  {
    id: "dawn-sequence",
    title: "Dawn Sequence",
    subtitle: "黎明シーケンス",
    chapter: 3,
    raw: `##########
#o..oo..o#
#...##...#
#........#
#.$.$.$..#
#...$@...#
#........#
##########`
  }
];

export const LEVEL_IDS = RAW_LEVELS.map(l => l.id);

/**
 * Parses a raw board text into structured level data.
 */
export function parseLevel(levelDef) {
  const lines = levelDef.raw.trim().split('\n').map(l => l.trimEnd());
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
      const char = line[c];
      if (char === '#') {
        walls.push({ row: r, col: c });
      } else if (char === 'o') {
        goals.push({ row: r, col: c });
      } else if (char === '$') {
        crates.push({ row: r, col: c });
      } else if (char === '@') {
        player = { row: r, col: c };
      }
    }
  }

  // Sort coordinate arrays by row then col
  const sortCoords = (a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col);
  walls.sort(sortCoords);
  goals.sort(sortCoords);
  crates.sort(sortCoords);

  return {
    id: levelDef.id,
    title: levelDef.title,
    subtitle: levelDef.subtitle,
    chapter: levelDef.chapter,
    width,
    height,
    walls,
    goals,
    crates,
    player
  };
}

export const PARSED_LEVELS = RAW_LEVELS.map(parseLevel);
export const LEVEL_MAP = new Map(PARSED_LEVELS.map(l => [l.id, l]));
