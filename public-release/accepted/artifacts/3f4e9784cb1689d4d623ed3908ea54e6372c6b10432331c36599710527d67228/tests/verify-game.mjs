/**
 * Verification Test Suite for LUMEN YARD
 */

import { RAW_LEVELS, LEVEL_IDS, LEVEL_MAP, PARSED_LEVELS } from '../src/levels.js';
import { GameEngine } from '../src/game.js';
import { ArenaBridge } from '../src/arena-bridge.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

console.log('--- 1. Testing Level Layouts & Parsing ---');
assert(RAW_LEVELS.length === 20, 'Must have 20 levels');
assert(LEVEL_IDS.length === 20, 'Must have 20 level IDs');
assert(PARSED_LEVELS.length === 20, 'Must parse 20 levels');

PARSED_LEVELS.forEach((level, idx) => {
  assert(level.id === LEVEL_IDS[idx], `Level ${idx} id match`);
  assert(level.width >= 7, `Level ${level.id} width >= 7`);
  assert(level.height >= 7, `Level ${level.id} height >= 7`);
  assert(level.player !== null, `Level ${level.id} has player`);
  assert(level.goals.length > 0, `Level ${level.id} has goals`);
  assert(level.crates.length === level.goals.length, `Level ${level.id} crates count equals goals count`);
  console.log(`✓ Level ${idx + 1} [${level.id}] valid (${level.width}x${level.height}, ${level.crates.length} cores/sockets)`);
});

console.log('\n--- 2. Testing Game Engine Rules on first-light ---');
const engine = new GameEngine('first-light');
let snap = engine.snapshot();

assert(snap.levelId === 'first-light', 'Initial level is first-light');
assert(snap.revision === 0, 'Initial revision is 0');
assert(snap.attempt === 1, 'Initial attempt is 1');
assert(snap.phase === 'playing', 'Initial phase is playing');
assert(snap.outcome === null, 'Initial outcome is null');
assert(snap.moveCount === 0, 'Initial moveCount is 0');
assert(snap.pushCount === 0, 'Initial pushCount is 0');
assert(snap.poweredGoals === 0, 'Initial poweredGoals is 0');
assert(snap.undoAvailable === false, 'Initial undoAvailable is false');

// Verify initial player position: row 4, col 2
assert(snap.player.row === 4 && snap.player.col === 2, 'Player position is (4, 2)');
// Crate position: row 3, col 3
assert(snap.crates[0].row === 3 && snap.crates[0].col === 3, 'Crate is (3, 3)');
// Goal position: row 1, col 4
assert(snap.goals[0].row === 1 && snap.goals[0].col === 4, 'Goal is (1, 4)');

// Check legal actions
const legal = snap.legalActions;
console.log('Legal actions in initial state:', legal.map(a => a.type === 'move' ? `move:${a.direction}` : a.type).join(', '));
assert(legal.some(a => a.type === 'move' && a.direction === 'up'), 'Move up is legal');
assert(legal.some(a => a.type === 'move' && a.direction === 'right'), 'Move right is legal');
assert(!legal.some(a => a.type === 'undo'), 'Undo is not legal in initial state');
assert(legal.filter(a => a.type === 'select_level').length === 20, 'All 20 select_level actions are legal');

// Try moving right: from (4,2) to (4,3)
snap = engine.act({ type: 'move', direction: 'right' });
assert(snap.revision === 1, 'Revision is 1 after move');
assert(snap.moveCount === 1, 'moveCount is 1');
assert(snap.player.row === 4 && snap.player.col === 3, 'Player moved to (4, 3)');
assert(snap.undoAvailable === true, 'Undo is available after move');

// Move up: pushes crate at (3,3) to (2,3)
snap = engine.act({ type: 'move', direction: 'up' });
assert(snap.revision === 2, 'Revision is 2 after push');
assert(snap.moveCount === 2, 'moveCount is 2');
assert(snap.pushCount === 1, 'pushCount is 1');
assert(snap.player.row === 3 && snap.player.col === 3, 'Player moved to (3, 3)');
assert(snap.crates[0].row === 2 && snap.crates[0].col === 3, 'Crate pushed to (2, 3)');

// Undo test
snap = engine.act({ type: 'undo' });
assert(snap.revision === 3, 'Revision advances on undo to 3');
assert(snap.moveCount === 1, 'moveCount restored to 1');
assert(snap.pushCount === 0, 'pushCount restored to 0');
assert(snap.player.row === 4 && snap.player.col === 3, 'Player restored to (4, 3)');
assert(snap.crates[0].row === 3 && snap.crates[0].col === 3, 'Crate restored to (3, 3)');

console.log('✓ Basic movement, push, and undo test passed');

console.log('\n--- 3. Testing Puzzle Solution & Phase Transition ---');
// Let's solve first-light:
// Current state: player at (4,3), crate at (3,3), goal at (1,4)
// Step 1: push crate up to (2,3)
engine.act({ type: 'move', direction: 'up' }); // Player at (3,3), crate at (2,3)
// Step 2: walk around: left -> up -> up -> right
engine.act({ type: 'move', direction: 'left' });  // (3,2)
engine.act({ type: 'move', direction: 'up' });    // (2,2)
engine.act({ type: 'move', direction: 'up' });    // (1,2)
engine.act({ type: 'move', direction: 'right' }); // (1,3)
// Step 3: push crate down from (2,3) to (3,3)? Or push crate right to (2,4) then up to (1,4)
// Let's see: from (1,3), move down -> player at (2,3)? No, crate is at (2,3) so moving down pushes crate to (3,3).
// Let's push right: walk to (2,2), then push right:
engine.act({ type: 'move', direction: 'left' });  // (1,2)
engine.act({ type: 'move', direction: 'down' });  // (2,2)
engine.act({ type: 'move', direction: 'right' }); // player at (2,2) moves right -> pushes crate at (2,3) to (2,4)! Player at (2,3).
// Now crate is at (2,4). Walk to (3,4) and push up into goal at (1,4):
engine.act({ type: 'move', direction: 'down' });  // (3,3)
engine.act({ type: 'move', direction: 'right' }); // (3,4)
snap = engine.act({ type: 'move', direction: 'up' }); // pushes crate from (2,4) to (1,4) (Goal!)

assert(snap.phase === 'complete', 'Phase must be complete');
assert(snap.outcome === 'powered', 'Outcome must be powered');
assert(snap.poweredGoals === 1, 'poweredGoals is 1');
console.log('✓ Puzzle solved! Phase is complete, outcome is powered.');

// When complete, moves are frozen:
try {
  engine.act({ type: 'move', direction: 'left' });
  assert(false, 'Should throw POST_COMPLETION_MOVE');
} catch (err) {
  assert(err.code === 'POST_COMPLETION_MOVE', 'Correctly rejected move when complete');
  console.log('✓ Movement correctly rejected after completion');
}

console.log('\n--- 4. Testing Window / Arena Bridge ---');
// Mock window and MessagePort
global.window = {
  parent: null,
  addEventListener: () => {}
};

let rendered = false;
const bridge = new ArenaBridge(engine, () => { rendered = true; });
assert(window.__ARENA_GAME__ !== undefined, 'window.__ARENA_GAME__ exposed');

// Test window.__ARENA_GAME__.reset(42)
const resetState = window.__ARENA_GAME__.reset(42);
assert(resetState.levelId === 'first-light', 'reset returns first-light');
assert(resetState.attempt === 1, 'attempt reset to 1');
assert(resetState.phase === 'playing', 'phase is playing');

// Test window.__ARENA_GAME__.snapshot()
const readState = window.__ARENA_GAME__.snapshot();
assert(readState.revision === resetState.revision, 'snapshot matches state');

// Test window.__ARENA_GAME__.restart()
const restartState = window.__ARENA_GAME__.restart();
assert(restartState.attempt === 2, 'restart increments attempt');
assert(restartState.revision === resetState.revision + 1, 'restart increments revision');

console.log('✓ window.__ARENA_GAME__ bridge functions passed');

console.log('\n--- 5. Testing Arena MessagePort Protocol (arena.game.v1) ---');

class MockPort {
  constructor() {
    this.messages = [];
    this.onmessage = null;
  }
  postMessage(msg) {
    this.messages.push(msg);
  }
  simulateIncoming(msg) {
    if (this.onmessage) {
      this.onmessage({ data: msg });
    }
  }
}

const mockPort = new MockPort();
bridge._bindPort(mockPort, 'test-session-123', 1);

assert(mockPort.messages.length === 1, 'Sent ready message on connect');
const readyMsg = mockPort.messages[0];
assert(readyMsg.protocol === 'arena.game.v1', 'Protocol matches');
assert(readyMsg.type === 'ready', 'Type is ready');
assert(readyMsg.sessionId === 'test-session-123', 'SessionId matches');
assert(readyMsg.generation === 1, 'Generation matches');
assert(readyMsg.accepted === true, 'Accepted is true');
assert(readyMsg.state !== undefined, 'State is present');
console.log('✓ Ready envelope verified');

// Test Observe request
mockPort.simulateIncoming({
  protocol: 'arena.game.v1',
  sessionId: 'test-session-123',
  generation: 1,
  requestId: 'req-obs-1',
  command: 'observe'
});

const obsResp = mockPort.messages[1];
assert(obsResp.requestId === 'req-obs-1', 'Observe response requestId match');
assert(obsResp.accepted === true, 'Observe accepted');
assert(obsResp.state.revision === readyMsg.revision, 'Observe does not mutate revision');
console.log('✓ Observe request verified');

// Test Act request with valid expectedRevision
mockPort.simulateIncoming({
  protocol: 'arena.game.v1',
  sessionId: 'test-session-123',
  generation: 1,
  requestId: 'req-act-1',
  command: 'act',
  expectedRevision: obsResp.revision,
  action: { type: 'move', direction: 'right' }
});

const actResp = mockPort.messages[2];
assert(actResp.requestId === 'req-act-1', 'Act response requestId match');
assert(actResp.accepted === true, 'Act accepted');
assert(actResp.revision === obsResp.revision + 1, 'Revision incremented');
console.log('✓ Act request verified');

// Test Act request with STALE revision
mockPort.simulateIncoming({
  protocol: 'arena.game.v1',
  sessionId: 'test-session-123',
  generation: 1,
  requestId: 'req-act-stale',
  command: 'act',
  expectedRevision: 9999, // Stale
  action: { type: 'move', direction: 'right' }
});

const staleResp = mockPort.messages[3];
assert(staleResp.requestId === 'req-act-stale', 'Stale response requestId match');
assert(staleResp.accepted === false, 'Stale act rejected');
assert(staleResp.error.code === 'STALE_REVISION', 'Error code STALE_REVISION');
assert(staleResp.revision === actResp.revision, 'Revision unchanged on rejection');
console.log('✓ Stale revision rejection verified');

// Test Restart request
mockPort.simulateIncoming({
  protocol: 'arena.game.v1',
  sessionId: 'test-session-123',
  generation: 1,
  requestId: 'req-restart-1',
  command: 'restart',
  expectedRevision: actResp.revision
});

const restartResp = mockPort.messages[4];
assert(restartResp.requestId === 'req-restart-1', 'Restart response requestId match');
assert(restartResp.accepted === true, 'Restart accepted');
assert(restartResp.state.attempt === 3, 'Attempt incremented on restart');
console.log('✓ Restart request verified');

console.log('\n========================================');
console.log('🎉 ALL INTEGRATION & ARENA TESTS PASSED!');
console.log('========================================');
