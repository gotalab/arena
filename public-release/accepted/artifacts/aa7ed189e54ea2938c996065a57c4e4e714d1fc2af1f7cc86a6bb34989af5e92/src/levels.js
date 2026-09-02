/* Lumen Yard - authored campaign data.
   Twenty fixed boards. The glyphs are load-bearing rules only; the yard is
   drawn as an electrical world, never as this text. */
(function (global) {
  'use strict';

  var SOURCE = [
    ['first-light', 'First Light', 'One core, one socket. Start the night.',
      '#######\n' +
      '#...o.#\n' +
      '#.....#\n' +
      '#..$..#\n' +
      '#.@...#\n' +
      '#.....#\n' +
      '#######'],
    ['crossfeed', 'Crossfeed', 'Two feeds share a single aisle.',
      '########\n' +
      '#..oo..#\n' +
      '#......#\n' +
      '#.$.$..#\n' +
      '#...@..#\n' +
      '#......#\n' +
      '########'],
    ['black-start', 'Black Start', 'Wake the whole yard from nothing.',
      '########\n' +
      '#.o.o.o#\n' +
      '#......#\n' +
      '#.$.$$.#\n' +
      '#...@..#\n' +
      '#......#\n' +
      '########'],
    ['split-bus', 'Split Bus', 'The bus splits around a cold island.',
      '########\n' +
      '#.o..o.#\n' +
      '#......#\n' +
      '#..##..#\n' +
      '#.$..$.#\n' +
      '#...@..#\n' +
      '#......#\n' +
      '########'],
    ['relay-bend', 'Relay Bend', 'The route bends before it connects.',
      '########\n' +
      '#..o...#\n' +
      '#....o.#\n' +
      '#..#...#\n' +
      '#.$.$..#\n' +
      '#..@...#\n' +
      '#......#\n' +
      '########'],
    ['service-loop', 'Service Loop', 'Walk the loop, mind the pillars.',
      '#########\n' +
      '#..o.o..#\n' +
      '#.......#\n' +
      '#.#...#.#\n' +
      '#.$.$...#\n' +
      '#...@...#\n' +
      '#.......#\n' +
      '#########'],
    ['cold-iron', 'Cold Iron', 'Three cores and one stubborn corner.',
      '#########\n' +
      '#..o..o.#\n' +
      '#o......#\n' +
      '#...#...#\n' +
      '#.$$.$..#\n' +
      '#...@...#\n' +
      '#.......#\n' +
      '#########'],
    ['brownout', 'Brownout', 'Thin lanes between dark stacks.',
      '#########\n' +
      '#..ooo..#\n' +
      '#.......#\n' +
      '#..#.#..#\n' +
      '#.$.$.$.#\n' +
      '#...@...#\n' +
      '#.......#\n' +
      '#########'],
    ['dead-bus', 'Dead Bus', 'The upper bus is fenced off.',
      '#########\n' +
      '#..ooo..#\n' +
      '#.#...#.#\n' +
      '#.......#\n' +
      '#.$$.$..#\n' +
      '#....@..#\n' +
      '#.......#\n' +
      '#########'],
    ['copper-maze', 'Copper Maze', 'Copper columns, narrow gaps.',
      '#########\n' +
      '#o..o..o#\n' +
      '#.......#\n' +
      '#.#.#.#.#\n' +
      '#.$.$.$.#\n' +
      '#...@...#\n' +
      '#.......#\n' +
      '#########'],
    ['backfeed', 'Backfeed', 'Feed it from the wrong side first.',
      '#########\n' +
      '#o.o....#\n' +
      '#...o...#\n' +
      '#.#...#.#\n' +
      '#.$.$.$.#\n' +
      '#..@....#\n' +
      '#.......#\n' +
      '#########'],
    ['load-shed', 'Load Shed', 'Something has to move out of the way.',
      '#########\n' +
      '#..o.o..#\n' +
      '#o......#\n' +
      '#..##...#\n' +
      '#.$.$.$.#\n' +
      '#....@..#\n' +
      '#.......#\n' +
      '#########'],
    ['last-circuit', 'Last Circuit', 'Four cores on one crowded floor.',
      '##########\n' +
      '#..o.oo..#\n' +
      '#....o...#\n' +
      '#..##....#\n' +
      '#.$.$.$..#\n' +
      '#...$@...#\n' +
      '#........#\n' +
      '##########'],
    ['switchyard', 'Switchyard', 'A full rank of sockets is waiting.',
      '#########\n' +
      '#..oooo.#\n' +
      '#.......#\n' +
      '#.#.#...#\n' +
      '#.$.$.$.#\n' +
      '#..$@...#\n' +
      '#.......#\n' +
      '#########'],
    ['phase-lock', 'Phase Lock', 'The centre block holds the phase.',
      '#########\n' +
      '#o.o.o..#\n' +
      '#.......#\n' +
      '#..###..#\n' +
      '#.$...$.#\n' +
      '#...$@..#\n' +
      '#.......#\n' +
      '#########'],
    ['auxiliary', 'Auxiliary', 'The auxiliary line runs the long way.',
      '##########\n' +
      '#..o.oo..#\n' +
      '#o.......#\n' +
      '#..#..#..#\n' +
      '#.$.$.$..#\n' +
      '#...$@...#\n' +
      '#........#\n' +
      '##########'],
    ['redline', 'Redline', 'Corners on both sides of the yard.',
      '##########\n' +
      '#o.o..o.o#\n' +
      '#........#\n' +
      '#.#....#.#\n' +
      '#.$.$.$..#\n' +
      '#...$@...#\n' +
      '#........#\n' +
      '##########'],
    ['island-mode', 'Island Mode', 'Two islands, four sockets.',
      '##########\n' +
      '#..oooo..#\n' +
      '#........#\n' +
      '#..#..#..#\n' +
      '#.$.$.$..#\n' +
      '#..$..@..#\n' +
      '#........#\n' +
      '##########'],
    ['cascade', 'Cascade', 'Let the lights fall in order.',
      '##########\n' +
      '#o..oo..o#\n' +
      '#........#\n' +
      '#.#.##.#.#\n' +
      '#.$.$.$..#\n' +
      '#....$@..#\n' +
      '#........#\n' +
      '##########'],
    ['dawn-sequence', 'Dawn Sequence', 'The last circuit before morning.',
      '##########\n' +
      '#o..oo..o#\n' +
      '#...##...#\n' +
      '#........#\n' +
      '#.$.$.$..#\n' +
      '#...$@...#\n' +
      '#........#\n' +
      '##########']
  ];

  function parse(entry) {
    var id = entry[0], name = entry[1], line = entry[2];
    var rows = entry[3].split('\n');
    var height = rows.length;
    var width = 0;
    var r, c;
    for (r = 0; r < height; r++) width = Math.max(width, rows[r].length);

    var walls = [], goals = [], crates = [], player = null;
    var wallSet = Object.create(null);
    var goalSet = Object.create(null);
    for (r = 0; r < height; r++) {
      for (c = 0; c < width; c++) {
        var ch = rows[r].charAt(c) || '#';
        if (ch === '#') { walls.push({ row: r, col: c }); wallSet[r + ',' + c] = true; continue; }
        if (ch === 'o' || ch === '*' || ch === '+') { goals.push({ row: r, col: c }); goalSet[r + ',' + c] = true; }
        if (ch === '$' || ch === '*') crates.push({ row: r, col: c });
        if (ch === '@' || ch === '+') player = { row: r, col: c };
      }
    }
    return {
      id: id, name: name, line: line,
      width: width, height: height,
      walls: walls, goals: goals, crates: crates, player: player,
      wallAt: function (row, col) {
        return row < 0 || col < 0 || row >= height || col >= width || !!wallSet[row + ',' + col];
      },
      goalAt: function (row, col) { return !!goalSet[row + ',' + col]; }
    };
  }

  var LEVELS = SOURCE.map(parse);
  var BY_ID = Object.create(null);
  LEVELS.forEach(function (l, i) { l.index = i; BY_ID[l.id] = l; });

  global.LumenLevels = {
    all: LEVELS,
    ids: LEVELS.map(function (l) { return l.id; }),
    byId: function (id) { return BY_ID[id] || null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).LumenLevels;
}
