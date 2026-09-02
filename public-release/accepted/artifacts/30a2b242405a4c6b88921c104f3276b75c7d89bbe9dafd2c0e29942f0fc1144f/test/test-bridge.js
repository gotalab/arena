// Test suite for Arena bridge parent MessagePort protocol
import { MessageChannel } from 'node:worker_threads';
import { LumenGame } from '../js/game.js';
import { ArenaBridge } from '../js/bridge.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Mock window environment for testing
const messageListeners = [];
const mockWindow = {
  addEventListener: (type, fn) => {
    if (type === 'message') messageListeners.push(fn);
  },
  parent: {} // distinct object reference for parent
};
mockWindow.parent = { isParent: true };

// Attach to global
global.window = mockWindow;

console.log('--- 1. Testing Bridge Connection & Ready Envelope ---');
const game = new LumenGame();
const bridge = new ArenaBridge(game);

assert(global.window.__ARENA_GAME__, 'window.__ARENA_GAME__ must be exposed');
assert(typeof global.window.__ARENA_GAME__.snapshot === 'function', 'snapshot() exists');
assert(typeof global.window.__ARENA_GAME__.act === 'function', 'act() exists');
assert(typeof global.window.__ARENA_GAME__.restart === 'function', 'restart() exists');
assert(typeof global.window.__ARENA_GAME__.reset === 'function', 'reset() exists');

// Create MessageChannel
const channel = new MessageChannel();
const parentPort = channel.port1;
const gamePort = channel.port2;

// Simulate parent sending connect message
const connectEvent = {
  source: mockWindow.parent,
  data: {
    protocol: 'arena.game.v1',
    type: 'connect',
    sessionId: 'sess-12345',
    generation: 1
  },
  ports: [gamePort]
};

let readyEnvelope = null;
parentPort.on('message', (data) => {
  if (data.type === 'ready') {
    readyEnvelope = data;
  }
});

// Trigger connect
for (const listener of messageListeners) {
  listener(connectEvent);
}

// Wait for ready envelope
await new Promise(r => setTimeout(r, 50));

assert(readyEnvelope !== null, 'Parent must receive ready envelope');
assert(readyEnvelope.protocol === 'arena.game.v1', 'Protocol is arena.game.v1');
assert(readyEnvelope.type === 'ready', 'Type is ready');
assert(readyEnvelope.sessionId === 'sess-12345', 'SessionId matches');
assert(readyEnvelope.generation === 1, 'Generation matches');
assert(readyEnvelope.accepted === true, 'Accepted is true');
assert(typeof readyEnvelope.revision === 'number', 'Revision is a number');
assert(readyEnvelope.state, 'State is included');
assert(readyEnvelope.state.levelId === 'first-light', 'Initial state is first-light');

console.log('✓ Connect handshake and ready envelope validated.');

console.log('--- 2. Testing observe command ---');
let observeResponse = null;
const reqHandler = (data) => {
  if (data.requestId === 'req-obs') observeResponse = data;
};
parentPort.on('message', reqHandler);

parentPort.postMessage({
  protocol: 'arena.game.v1',
  command: 'observe',
  requestId: 'req-obs',
  sessionId: 'sess-12345',
  generation: 1
});

await new Promise(r => setTimeout(r, 50));

assert(observeResponse !== null, 'Observe response received');
assert(observeResponse.accepted === true, 'Observe accepted');
assert(observeResponse.revision === readyEnvelope.revision, 'Revision matches');
assert(observeResponse.state.phase === 'playing', 'Observe phase playing');

console.log('✓ observe command validated.');

console.log('--- 3. Testing act command with legal & illegal actions ---');
let actResponse1 = null;
let actResponse2 = null;

parentPort.on('message', (data) => {
  if (data.requestId === 'req-act-1') actResponse1 = data;
  if (data.requestId === 'req-act-2') actResponse2 = data;
});

// Legal move: player moves up
parentPort.postMessage({
  protocol: 'arena.game.v1',
  command: 'act',
  requestId: 'req-act-1',
  sessionId: 'sess-12345',
  generation: 1,
  expectedRevision: observeResponse.revision,
  action: { type: 'move', direction: 'up' }
});

await new Promise(r => setTimeout(r, 50));

assert(actResponse1 !== null, 'Act 1 response received');
assert(actResponse1.accepted === true, 'Act 1 accepted');
assert(actResponse1.revision === observeResponse.revision + 1, 'Revision incremented');
assert(actResponse1.state.player.row === 3, 'Player moved up to row 3');

// Stale revision test: try sending with old revision
parentPort.postMessage({
  protocol: 'arena.game.v1',
  command: 'act',
  requestId: 'req-act-2',
  sessionId: 'sess-12345',
  generation: 1,
  expectedRevision: observeResponse.revision, // Stale!
  action: { type: 'move', direction: 'down' }
});

await new Promise(r => setTimeout(r, 50));

assert(actResponse2 !== null, 'Act 2 response received');
assert(actResponse2.accepted === false, 'Act 2 rejected due to stale revision');
assert(actResponse2.error && actResponse2.error.code === 'STALE_REVISION', 'Error code is STALE_REVISION');

console.log('✓ act command and stale revision rejection validated.');

console.log('--- 4. Testing restart command ---');
let restartResponse = null;
parentPort.on('message', (data) => {
  if (data.requestId === 'req-restart') restartResponse = data;
});

parentPort.postMessage({
  protocol: 'arena.game.v1',
  command: 'restart',
  requestId: 'req-restart',
  sessionId: 'sess-12345',
  generation: 1,
  expectedRevision: actResponse1.revision
});

await new Promise(r => setTimeout(r, 50));

assert(restartResponse !== null, 'Restart response received');
assert(restartResponse.accepted === true, 'Restart accepted');
assert(restartResponse.state.attempt === 2, 'Attempt is 2');
assert(restartResponse.state.moveCount === 0, 'moveCount reset to 0');
assert(restartResponse.revision === actResponse1.revision + 1, 'Revision incremented');

console.log('✓ restart command validated.');

parentPort.close();
gamePort.close();
console.log('\nALL ARENA BRIDGE TESTS PASSED! 🎉');
process.exit(0);
