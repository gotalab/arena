// Lumen Yard - board data
// Twenty fixed, original boards. Do not change layouts, only presentation.
// '#' wall, '.' floor, 'o' socket, '$' relay core, '@' robot.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LumenLevels = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RAW_LEVELS = [
    ['first-light', [
      '#######',
      '#...o.#',
      '#.....#',
      '#..$..#',
      '#.@...#',
      '#.....#',
      '#######'
    ]],
    ['crossfeed', [
      '########',
      '#..oo..#',
      '#......#',
      '#.$.$..#',
      '#...@..#',
      '#......#',
      '########'
    ]],
    ['black-start', [
      '########',
      '#.o.o.o#',
      '#......#',
      '#.$.$$.#',
      '#...@..#',
      '#......#',
      '########'
    ]],
    ['split-bus', [
      '########',
      '#.o..o.#',
      '#......#',
      '#..##..#',
      '#.$..$.#',
      '#...@..#',
      '#......#',
      '########'
    ]],
    ['relay-bend', [
      '########',
      '#..o...#',
      '#....o.#',
      '#..#...#',
      '#.$.$..#',
      '#..@...#',
      '#......#',
      '########'
    ]],
    ['service-loop', [
      '#########',
      '#..o.o..#',
      '#.......#',
      '#.#...#.#',
      '#.$.$...#',
      '#...@...#',
      '#.......#',
      '#########'
    ]],
    ['cold-iron', [
      '#########',
      '#..o..o.#',
      '#o......#',
      '#...#...#',
      '#.$$.$..#',
      '#...@...#',
      '#.......#',
      '#########'
    ]],
    ['brownout', [
      '#########',
      '#..ooo..#',
      '#.......#',
      '#..#.#..#',
      '#.$.$.$.#',
      '#...@...#',
      '#.......#',
      '#########'
    ]],
    ['dead-bus', [
      '#########',
      '#..ooo..#',
      '#.#...#.#',
      '#.......#',
      '#.$$.$..#',
      '#....@..#',
      '#.......#',
      '#########'
    ]],
    ['copper-maze', [
      '#########',
      '#o..o..o#',
      '#.......#',
      '#.#.#.#.#',
      '#.$.$.$.#',
      '#...@...#',
      '#.......#',
      '#########'
    ]],
    ['backfeed', [
      '#########',
      '#o.o....#',
      '#...o...#',
      '#.#...#.#',
      '#.$.$.$.#',
      '#..@....#',
      '#.......#',
      '#########'
    ]],
    ['load-shed', [
      '#########',
      '#..o.o..#',
      '#o......#',
      '#..##...#',
      '#.$.$.$.#',
      '#....@..#',
      '#.......#',
      '#########'
    ]],
    ['last-circuit', [
      '##########',
      '#..o.oo..#',
      '#....o...#',
      '#..##....#',
      '#.$.$.$..#',
      '#...$@...#',
      '#........#',
      '##########'
    ]],
    ['switchyard', [
      '#########',
      '#..oooo.#',
      '#.......#',
      '#.#.#...#',
      '#.$.$.$.#',
      '#..$@...#',
      '#.......#',
      '#########'
    ]],
    ['phase-lock', [
      '#########',
      '#o.o.o..#',
      '#.......#',
      '#..###..#',
      '#.$...$.#',
      '#...$@..#',
      '#.......#',
      '#########'
    ]],
    ['auxiliary', [
      '##########',
      '#..o.oo..#',
      '#o.......#',
      '#..#..#..#',
      '#.$.$.$..#',
      '#...$@...#',
      '#........#',
      '##########'
    ]],
    ['redline', [
      '##########',
      '#o.o..o.o#',
      '#........#',
      '#.#....#.#',
      '#.$.$.$..#',
      '#...$@...#',
      '#........#',
      '##########'
    ]],
    ['island-mode', [
      '##########',
      '#..oooo..#',
      '#........#',
      '#..#..#..#',
      '#.$.$.$..#',
      '#..$..@..#',
      '#........#',
      '##########'
    ]],
    ['cascade', [
      '##########',
      '#o..oo..o#',
      '#........#',
      '#.#.##.#.#',
      '#.$.$.$..#',
      '#....$@..#',
      '#........#',
      '##########'
    ]],
    ['dawn-sequence', [
      '##########',
      '#o..oo..o#',
      '#...##...#',
      '#........#',
      '#.$.$.$..#',
      '#...$@...#',
      '#........#',
      '##########'
    ]]
  ];

  function cellKey(row, col) {
    return row + ',' + col;
  }

  function byRowCol(a, b) {
    return a.row - b.row || a.col - b.col;
  }

  function parseLevel(id, rows) {
    var height = rows.length;
    var width = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].length > width) width = rows[i].length;
    }
    var walls = new Set();
    var wallsArray = [];
    var goals = [];
    var cratesInit = [];
    var playerInit = null;

    for (var r = 0; r < height; r++) {
      var line = rows[r];
      for (var c = 0; c < width; c++) {
        var ch = c < line.length ? line[c] : '#';
        if (ch === '#') {
          walls.add(cellKey(r, c));
          wallsArray.push({ row: r, col: c });
        } else if (ch === 'o') {
          goals.push({ row: r, col: c });
        } else if (ch === '$') {
          cratesInit.push({ row: r, col: c });
        } else if (ch === '@') {
          playerInit = { row: r, col: c };
        }
      }
    }

    goals.sort(byRowCol);
    cratesInit.sort(byRowCol);
    wallsArray.sort(byRowCol);

    if (!playerInit) {
      throw new Error('Level ' + id + ' is missing a robot start position.');
    }
    if (goals.length !== cratesInit.length) {
      throw new Error('Level ' + id + ' has mismatched relay/socket counts.');
    }

    return {
      id: id,
      width: width,
      height: height,
      walls: walls,
      wallsArray: wallsArray,
      goals: goals,
      cratesInit: cratesInit,
      playerInit: playerInit
    };
  }

  var ORDER = RAW_LEVELS.map(function (entry) { return entry[0]; });
  var LEVELS = new Map();
  RAW_LEVELS.forEach(function (entry) {
    var id = entry[0];
    var rows = entry[1];
    LEVELS.set(id, parseLevel(id, rows));
  });

  function displayName(id) {
    return id.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  return {
    order: ORDER,
    levels: LEVELS,
    displayName: displayName,
    cellKey: cellKey
  };
});
