const { GameSimulation } = require('../js/sim.js');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('--- Testing Simulation & Telemetry Contract ---');

const sim = new GameSimulation(12345);
let snap = sim.snapshot();

assert(snap.phase === 'ready', 'Initial phase should be ready');
assert(snap.tick === 0, 'Initial tick should be 0');
assert(snap.groundY === 600, 'groundY should be 600');
assert(snap.lowLaneY === 380, 'lowLaneY should be 380');
assert(snap.highLaneY === 200, 'highLaneY should be 200');
assert(snap.machineNormalApexY > snap.lowLaneY, 'machine normal apex must stay below lowLaneY');
assert(snap.machine.grounded === true, 'machine should start grounded');
assert(snap.ball.active === false, 'ball should start inactive in ready state');
assert(snap.enemies.length === 0, 'no initial enemies');
assert(snap.recentEvents.length === 0, 'recentEvents empty at start');
assert(snap.lastEvent === null, 'lastEvent null at start');

// Test frozen advance in ready
sim.advance(500);
snap = sim.snapshot();
assert(snap.tick === 0, 'Tick should remain 0 when advanced in ready state with no input');

// Test unfreezing on input
sim.setInput(true, false, false); // Left
sim.advance(100);
snap = sim.snapshot();
assert(snap.phase === 'playing', 'Phase should become playing');
assert(snap.tick > 0, 'Tick should advance');
assert(snap.ball.active === true, 'Ball should be active');
assert(snap.ball.lastBounceKind === 'normal', 'Ball should launch with normal bounce');
assert(snap.recentEvents.length >= 1, 'Event should be recorded');
assert(snap.recentEvents[0].kind === 'ball_bounce_normal', 'First event should be ball_bounce_normal');

// Advance a few seconds and check opening promise
for (let i = 0; i < 300; i++) {
  sim.advance(16.6666);
}
snap = sim.snapshot();
assert(snap.enemies.length > 0, 'Enemies should spawn in opening');
const flyer = snap.enemies.find(e => e.type === 'slowFlyer');
assert(flyer !== undefined, 'Slow flyer should spawn in opening');
assert(flyer.collisionRadius <= flyer.visualRadius * 1.1, 'Collision radius must not exceed visual by > 10%');

// Test determinism
const simA = new GameSimulation(999);
const simB = new GameSimulation(999);

simA.setInput(false, true, true);
simB.setInput(false, true, true);

simA.advance(2000);
simB.advance(2000);

const snapA = simA.snapshot();
const snapB = simB.snapshot();

assert(JSON.stringify(snapA) === JSON.stringify(snapB), 'Deterministic execution failed!');
console.log('Determinism check: PASS');

console.log('All Simulation Unit Tests PASSED!');
