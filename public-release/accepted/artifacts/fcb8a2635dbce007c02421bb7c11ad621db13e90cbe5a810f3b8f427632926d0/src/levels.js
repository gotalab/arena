/* LUMEN YARD - campaign data.
   Twenty authored yards. Layout strings are fixed and must not be edited:
   they define the pacing of the whole restoration. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});

  var RAW = [
    {
      id: 'first-light',
      name: 'First Light',
      note: 'One core, one socket.',
      plan: [
        '#######',
        '#...o.#',
        '#.....#',
        '#..$..#',
        '#.@...#',
        '#.....#',
        '#######'
      ]
    },
    {
      id: 'crossfeed',
      name: 'Crossfeed',
      note: 'Two relays, one aisle.',
      plan: [
        '########',
        '#..oo..#',
        '#......#',
        '#.$.$..#',
        '#...@..#',
        '#......#',
        '########'
      ]
    },
    {
      id: 'black-start',
      name: 'Black Start',
      note: 'Three relays compete.',
      plan: [
        '########',
        '#.o.o.o#',
        '#......#',
        '#.$.$$.#',
        '#...@..#',
        '#......#',
        '########'
      ]
    },
    {
      id: 'split-bus',
      name: 'Split Bus',
      note: 'A pillar splits the run.',
      plan: [
        '########',
        '#.o..o.#',
        '#......#',
        '#..##..#',
        '#.$..$.#',
        '#...@..#',
        '#......#',
        '########'
      ]
    },
    {
      id: 'relay-bend',
      name: 'Relay Bend',
      note: 'Sockets off the line.',
      plan: [
        '########',
        '#..o...#',
        '#....o.#',
        '#..#...#',
        '#.$.$..#',
        '#..@...#',
        '#......#',
        '########'
      ]
    },
    {
      id: 'service-loop',
      name: 'Service Loop',
      note: 'A loop to walk around.',
      plan: [
        '#########',
        '#..o.o..#',
        '#.......#',
        '#.#...#.#',
        '#.$.$...#',
        '#...@...#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'cold-iron',
      name: 'Cold Iron',
      note: 'Two cores, shoulder to shoulder.',
      plan: [
        '#########',
        '#..o..o.#',
        '#o......#',
        '#...#...#',
        '#.$$.$..#',
        '#...@...#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'brownout',
      name: 'Brownout',
      note: 'Three lanes, three sockets.',
      plan: [
        '#########',
        '#..ooo..#',
        '#.......#',
        '#..#.#..#',
        '#.$.$.$.#',
        '#...@...#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'dead-bus',
      name: 'Dead Bus',
      note: 'The upper aisle is fenced.',
      plan: [
        '#########',
        '#..ooo..#',
        '#.#...#.#',
        '#.......#',
        '#.$$.$..#',
        '#....@..#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'copper-maze',
      name: 'Copper Maze',
      note: 'Four posts, three lanes.',
      plan: [
        '#########',
        '#o..o..o#',
        '#.......#',
        '#.#.#.#.#',
        '#.$.$.$.#',
        '#...@...#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'backfeed',
      name: 'Backfeed',
      note: 'One socket hangs back.',
      plan: [
        '#########',
        '#o.o....#',
        '#...o...#',
        '#.#...#.#',
        '#.$.$.$.#',
        '#..@....#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'load-shed',
      name: 'Load Shed',
      note: 'A twin block leans left.',
      plan: [
        '#########',
        '#..o.o..#',
        '#o......#',
        '#..##...#',
        '#.$.$.$.#',
        '#....@..#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'last-circuit',
      name: 'Last Circuit',
      note: 'Four relays. One behind you.',
      plan: [
        '##########',
        '#..o.oo..#',
        '#....o...#',
        '#..##....#',
        '#.$.$.$..#',
        '#...$@...#',
        '#........#',
        '##########'
      ]
    },
    {
      id: 'switchyard',
      name: 'Switchyard',
      note: 'A full header bank.',
      plan: [
        '#########',
        '#..oooo.#',
        '#.......#',
        '#.#.#...#',
        '#.$.$.$.#',
        '#..$@...#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'phase-lock',
      name: 'Phase Lock',
      note: 'A long wall sets the timing.',
      plan: [
        '#########',
        '#o.o.o..#',
        '#.......#',
        '#..###..#',
        '#.$...$.#',
        '#...$@..#',
        '#.......#',
        '#########'
      ]
    },
    {
      id: 'auxiliary',
      name: 'Auxiliary',
      note: 'The far socket strands easily.',
      plan: [
        '##########',
        '#..o.oo..#',
        '#o.......#',
        '#..#..#..#',
        '#.$.$.$..#',
        '#...$@...#',
        '#........#',
        '##########'
      ]
    },
    {
      id: 'redline',
      name: 'Redline',
      note: 'Both far corners are live.',
      plan: [
        '##########',
        '#o.o..o.o#',
        '#........#',
        '#.#....#.#',
        '#.$.$.$..#',
        '#...$@...#',
        '#........#',
        '##########'
      ]
    },
    {
      id: 'island-mode',
      name: 'Island Mode',
      note: 'Clean bank, awkward approach.',
      plan: [
        '##########',
        '#..oooo..#',
        '#........#',
        '#..#..#..#',
        '#.$.$.$..#',
        '#..$..@..#',
        '#........#',
        '##########'
      ]
    },
    {
      id: 'cascade',
      name: 'Cascade',
      note: 'Corners behind a broken fence.',
      plan: [
        '##########',
        '#o..oo..o#',
        '#........#',
        '#.#.##.#.#',
        '#.$.$.$..#',
        '#....$@..#',
        '#........#',
        '##########'
      ]
    },
    {
      id: 'dawn-sequence',
      name: 'Dawn Sequence',
      note: 'The last four. Then the sun.',
      plan: [
        '##########',
        '#o..oo..o#',
        '#...##...#',
        '#........#',
        '#.$.$.$..#',
        '#...$@...#',
        '#........#',
        '##########'
      ]
    }
  ];

  function parse(entry, index) {
    var plan = entry.plan;
    var height = plan.length;
    var width = 0;
    var r, c;
    for (r = 0; r < height; r++) width = Math.max(width, plan[r].length);

    var walls = [];
    var goals = [];
    var crates = [];
    var player = null;
    var wallGrid = [];

    for (r = 0; r < height; r++) {
      wallGrid[r] = [];
      for (c = 0; c < width; c++) {
        var ch = plan[r][c] || '#';
        var isWall = ch === '#';
        wallGrid[r][c] = isWall;
        if (isWall) walls.push({ row: r, col: c });
        if (ch === 'o') goals.push({ row: r, col: c });
        if (ch === '$') crates.push({ row: r, col: c });
        if (ch === '@') player = { row: r, col: c };
      }
    }

    return {
      id: entry.id,
      name: entry.name,
      note: entry.note,
      index: index,
      number: index + 1,
      width: width,
      height: height,
      wallGrid: wallGrid,
      walls: walls,
      goals: goals,
      startCrates: crates,
      startPlayer: player
    };
  }

  var LEVELS = RAW.map(parse);
  var BY_ID = Object.create(null);
  LEVELS.forEach(function (lv) { BY_ID[lv.id] = lv; });

  LY.LEVELS = LEVELS;
  LY.LEVEL_IDS = LEVELS.map(function (lv) { return lv.id; });
  LY.getLevel = function (id) { return BY_ID[id] || null; };
  LY.CHAPTER_ONE_END = 'black-start';
  LY.FINAL_LEVEL = 'dawn-sequence';
})(typeof window !== 'undefined' ? window : globalThis);
