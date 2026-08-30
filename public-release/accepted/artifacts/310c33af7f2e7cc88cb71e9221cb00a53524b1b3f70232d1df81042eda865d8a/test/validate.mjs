import { StompSim, TICK_MS, STAGE_W, GROUND_Y, LOW_LANE_Y, HIGH_LANE_Y, createGameApi } from '../js/sim.js';

const sim = new StompSim();
const api = createGameApi(sim);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    console.error('  ✗', msg);
  }
}

console.log('=== STOMP validation ===\n');

api.reset(42);
let snap = api.snapshot();
assert(snap.run.phase === 'ready', 'starts in ready phase');
assert(snap.run.tick === 0, 'tick starts at 0');
assert(snap.geometry.groundY === GROUND_Y, 'groundY exported');
assert(snap.geometry.lowLaneY === LOW_LANE_Y, 'lowLaneY exported');
assert(snap.geometry.highLaneY === HIGH_LANE_Y, 'highLaneY exported');

api.advance(5000);
snap = api.snapshot();
assert(snap.run.phase === 'ready', 'advance does nothing before first input');
assert(snap.run.tick === 0, 'tick unchanged while ready');

sim.setInput({ left: true, right: false, jumpQueued: false });
sim.step();
snap = api.snapshot();
assert(snap.run.phase === 'playing', 'first input starts play');
assert(snap.run.tick === 1, 'tick advances after start');

const seed = 12345;
api.reset(seed);
sim.setInput({ left: false, right: false, jumpQueued: false });

const inputs = [];
for (let i = 0; i < 300; i++) {
  if (i === 10) sim.setInput({ left: true, right: false, jumpQueued: false });
  if (i === 80) sim.setInput({ left: false, right: true, jumpQueued: false });
  if (i === 120) sim.setInput({ left: false, right: false, jumpQueued: true });
  sim.step();
  if (i % 30 === 0) inputs.push(sim.snapshot());
}

api.reset(seed);
sim.setInput({ left: false, right: false, jumpQueued: false });
const inputs2 = [];
for (let i = 0; i < 300; i++) {
  if (i === 10) sim.setInput({ left: true, right: false, jumpQueued: false });
  if (i === 80) sim.setInput({ left: false, right: true, jumpQueued: false });
  if (i === 120) sim.setInput({ left: false, right: false, jumpQueued: true });
  sim.step();
  if (i % 30 === 0) inputs2.push(sim.snapshot());
}

assert(JSON.stringify(inputs) === JSON.stringify(inputs2), 'deterministic replay with same seed');

api.reset(999);
sim.setInput({ left: true, right: false, jumpQueued: false });
for (let i = 0; i < 120; i++) sim.step();
snap = api.snapshot();
const lowSeen = snap.enemies.some((e) => e.lane === 'low' && e.type === 'slowFlyer');
assert(lowSeen, 'slow low-lane target within opening seconds');

api.reset(999);
sim.setInput({ left: false, right: false, jumpQueued: true });
for (let i = 0; i < 240; i++) sim.step();
snap = api.snapshot();
const highSeen = snap.enemies.some((e) => e.lane === 'high' && e.type === 'slowFlyer');
assert(highSeen, 'slow high-lane target before half clock on opening');

api.reset(777);
sim.setInput({ left: false, right: false, jumpQueued: false });
for (let i = 0; i < 60; i++) {
  sim.setInput({ left: true, right: false, jumpQueued: false });
  sim.step();
}
const beforeAdvance = sim.snapshot();
sim.setInput({ left: true, right: false, jumpQueued: false });
for (let i = 0; i < 60; i++) sim.step();
const realtime = sim.snapshot();

api.reset(777);
sim.setInput({ left: false, right: false, jumpQueued: false });
for (let i = 0; i < 60; i++) {
  sim.setInput({ left: true, right: false, jumpQueued: false });
  sim.step();
}
sim.setInput({ left: true, right: false, jumpQueued: false });
api.advance(60 * TICK_MS);
const advanced = sim.snapshot();

assert(realtime.run.tick === advanced.run.tick, 'advance matches realtime tick');
assert(Math.abs(realtime.run.remainingMs - advanced.run.remainingMs) < 1, 'advance matches realtime clock');

for (const e of snap.enemies) {
  assert(e.collisionRadius <= e.visualRadius * 1.1 + 0.001, `enemy ${e.id} hitbox within 10% of visual`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
