// Test suite for Lumen Yard game engine, rules, and bridge

import { RAW_LEVELS, LEVEL_IDS, PARSED_LEVELS, LEVEL_MAP } from '../js/levels.js';
import { LumenGame } from '../js/game.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('--- 1. Testing Level Parsing ---');
assert(RAW_LEVELS.length === 20, 'Must have exactly 20 levels');
assert(LEVEL_IDS.length === 20, 'Must have exactly 20 level IDs');
assert(LEVEL_IDS[0] === 'first-light', 'Level 1 is first-light');
assert(LEVEL_IDS[1] === 'crossfeed', 'Level 2 is crossfeed');
assert(LEVEL_IDS[2] === 'black-start', 'Level 3 is black-start');
assert(LEVEL_IDS[3] === 'split-bus', 'Level 4 is split-bus');
assert(LEVEL_IDS[19] === 'dawn-sequence', 'Level 20 is dawn-sequence');

for (const id of LEVEL_IDS) {
  const lvl = LEVEL_MAP.get(id);
  assert(lvl, `Level ${id} exists in LEVEL_MAP`);
  assert(lvl.walls.length > 0, `${id} has walls`);
  assert(lvl.goals.length > 0, `${id} has goals`);
  assert(lvl.initialCrates.length === lvl.goals.length, `${id} crates count equals goals count`);
  assert(lvl.initialPlayer, `${id} has initial player`);

  // Verify sorting
  for (let i = 1; i < lvl.walls.length; i++) {
    const prev = lvl.walls[i - 1];
    const cur = lvl.walls[i];
    assert(prev.row < cur.row || (prev.row === cur.row && prev.col <= cur.col), `${id} walls are sorted by row then col`);
  }
  for (let i = 1; i < lvl.goals.length; i++) {
    const prev = lvl.goals[i - 1];
    const cur = lvl.goals[i];
    assert(prev.row < cur.row || (prev.row === cur.row && prev.col <= cur.col), `${id} goals are sorted by row then col`);
  }
}
console.log('✓ All 20 levels parsed and sorted correctly.');

console.log('--- 2. Testing Game Engine Snapshot and Rules ---');
const game = new LumenGame();
game.reset();

const snap = game.snapshot();
const REQUIRED_KEYS = [
  'revision', 'attempt', 'phase', 'outcome', 'levelId',
  'width', 'height', 'walls', 'goals', 'crates',
  'player', 'poweredGoals', 'moveCount', 'pushCount',
  'undoAvailable', 'legalActions'
];

assert(Object.keys(snap).length === REQUIRED_KEYS.length, `Snapshot must have exactly ${REQUIRED_KEYS.length} keys, got ${Object.keys(snap).length}`);
for (const k of REQUIRED_KEYS) {
  assert(snap[k] !== undefined, `Snapshot key ${k} is defined`);
}

assert(snap.levelId === 'first-light', 'Reset sets first-light');
assert(snap.phase === 'playing', 'Phase is playing');
assert(snap.outcome === null, 'Outcome is null');
assert(snap.moveCount === 0, 'moveCount is 0');
assert(snap.pushCount === 0, 'pushCount is 0');
assert(snap.undoAvailable === false, 'undoAvailable is false initially');

// In first-light:
// player starts at row 4, col 2
// crate is at row 3, col 3
// goal is at row 1, col 4
assert(snap.player.row === 4 && snap.player.col === 2, `Player at (4, 2), got (${snap.player.row}, ${snap.player.col})`);
assert(snap.crates[0].row === 3 && snap.crates[0].col === 3, 'Crate at (3, 3)');
assert(snap.goals[0].row === 1 && snap.goals[0].col === 4, 'Goal at (1, 4)');

console.log('✓ Initial snapshot validated.');

console.log('--- 3. Testing Moves and Rejection ---');
// From (4, 2):
// up is (3, 2) - empty floor
// down is (5, 2) - empty floor
// left is (4, 1) - empty floor
// right is (4, 3) - empty floor
// None of these are walls or crates, all 4 directions should be legal
const legalMoves = snap.legalActions.filter(a => a.type === 'move').map(a => a.direction);
assert(legalMoves.length === 4, `All 4 moves legal from center, got ${legalMoves.length}`);

// Step up to (3, 2)
const rev0 = snap.revision;
const state1 = game.act({ type: 'move', direction: 'up' });
assert(state1.revision === rev0 + 1, 'Revision advances on move');
assert(state1.player.row === 3 && state1.player.col === 2, 'Player at (3, 2)');
assert(state1.moveCount === 1, 'moveCount is 1');
assert(state1.pushCount === 0, 'pushCount is 0');
assert(state1.undoAvailable === true, 'undoAvailable is now true');

// Now player is at (3, 2). Crate is at (3, 3).
// Moving right pushes crate from (3, 3) to (3, 4). (3, 4) is empty floor, so push is legal!
const state2 = game.act({ type: 'move', direction: 'right' });
assert(state2.player.row === 3 && state2.player.col === 3, 'Player moved to (3, 3)');
assert(state2.crates[0].row === 3 && state2.crates[0].col === 4, 'Crate pushed to (3, 4)');
assert(state2.moveCount === 2, 'moveCount is 2');
assert(state2.pushCount === 1, 'pushCount is 1');

// Test undo
const state3 = game.act({ type: 'undo' });
assert(state3.player.row === 3 && state3.player.col === 2, 'Undo restored player to (3, 2)');
assert(state3.crates[0].row === 3 && state3.crates[0].col === 3, 'Undo restored crate to (3, 3)');
assert(state3.moveCount === 1, 'Undo restored moveCount to 1');
assert(state3.pushCount === 0, 'Undo restored pushCount to 0');
assert(state3.revision === state2.revision + 1, 'Revision advanced on undo');

// Test illegal move: move into wall
// Player is at (3, 2). Let us move left to (3, 1).
game.act({ type: 'move', direction: 'left' }); // at (3, 1)
// Moving left from (3, 1) would hit wall at (3, 0)
let blockedThrown = false;
try {
  game.act({ type: 'move', direction: 'left' });
} catch (err) {
  blockedThrown = true;
  assert(err.code === 'ILLEGAL_ACTION', `Expected ILLEGAL_ACTION, got ${err.code}`);
}
assert(blockedThrown, 'Moving into wall must throw error');
assert(game.player.row === 3 && game.player.col === 1, 'Player position unchanged on rejection');

console.log('✓ Moves, pushes, undos, and rejection validated.');

console.log('--- 4. Testing Board Completion and Post-Completion Rules ---');
// Let us solve first-light:
// Board:
// ####### (0)
// #...o.# (1)  o is at (1, 4)
// #.....# (2)
// #..$..# (3)  $ is at (3, 3)
// #.@...# (4)  @ is at (4, 2)
// #.....# (5)
// ####### (6)
game.loadLevel('first-light');

// Plan to push $ from (3, 3) to (1, 4):
// 1. Move to (3, 2): up -> player at (3, 2)
game.act({ type: 'move', direction: 'up' });
// 2. Push crate right to (3, 4): right -> player at (3, 3), crate at (3, 4)
game.act({ type: 'move', direction: 'right' });
// 3. Move around crate to be below it at (4, 4):
//    - move down to (4, 3)
game.act({ type: 'move', direction: 'down' });
//    - move right to (4, 4)
game.act({ type: 'move', direction: 'right' });
// 4. Push crate up from (3, 4) to (2, 4):
//    - move up to (3, 4), crate pushed to (2, 4)
game.act({ type: 'move', direction: 'up' });
// 5. Push crate up from (2, 4) to (1, 4):
//    - move up to (2, 4), crate pushed to (1, 4) [GOAL!]
const winState = game.act({ type: 'move', direction: 'up' });

assert(winState.phase === 'complete', 'Phase must be complete');
assert(winState.outcome === 'powered', 'Outcome must be powered');
assert(winState.poweredGoals === 1, 'poweredGoals must be 1');

// Verify legalActions when complete: no moves allowed!
const postMoves = winState.legalActions.filter(a => a.type === 'move');
assert(postMoves.length === 0, 'No moves in legalActions when phase is complete');

// Post-completion move attempt must throw POST_COMPLETION_MOVE
let postMoveThrown = false;
try {
  game.act({ type: 'move', direction: 'down' });
} catch (err) {
  postMoveThrown = true;
  assert(err.code === 'POST_COMPLETION_MOVE', `Expected POST_COMPLETION_MOVE, got ${err.code}`);
}
assert(postMoveThrown, 'Move after completion must throw POST_COMPLETION_MOVE');

// Undo should be allowed after completion!
const uncompleteState = game.act({ type: 'undo' });
assert(uncompleteState.phase === 'playing', 'Undo reverts phase to playing');
assert(uncompleteState.outcome === null, 'Undo reverts outcome to null');
assert(uncompleteState.poweredGoals === 0, 'poweredGoals is 0 after undo');

console.log('✓ Completion and post-completion rules validated.');

console.log('--- 5. Testing restart and reset ---');
const restartState = game.restart();
assert(restartState.attempt === 2, 'Attempt incremented to 2');
assert(restartState.moveCount === 0, 'moveCount reset to 0');
assert(restartState.pushCount === 0, 'pushCount reset to 0');
assert(restartState.undoAvailable === false, 'undoAvailable reset to false');
assert(restartState.phase === 'playing', 'phase is playing');

const resetState = game.reset('test-seed');
assert(resetState.levelId === 'first-light', 'reset resets to first-light');
assert(game.seed === 'test-seed', 'seed retained');
assert(resetState.attempt === 1, 'attempt reset to 1');
assert(resetState.moveCount === 0, 'moveCount reset to 0');

console.log('✓ restart and reset validated.');

console.log('--- 6. Testing select_level for all 20 levels ---');
for (const id of LEVEL_IDS) {
  const s = game.act({ type: 'select_level', levelId: id });
  assert(s.levelId === id, `Successfully selected ${id}`);
}

let unknownLevelThrown = false;
try {
  game.act({ type: 'select_level', levelId: 'invalid-id' });
} catch (err) {
  unknownLevelThrown = true;
  assert(err.code === 'UNKNOWN_BOARD', `Expected UNKNOWN_BOARD, got ${err.code}`);
}
assert(unknownLevelThrown, 'Selecting unknown level throws UNKNOWN_BOARD');

console.log('✓ All 20 select_level actions validated.');
console.log('\nALL ENGINE TESTS PASSED! 🎉');
