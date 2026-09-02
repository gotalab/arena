// Comprehensive Test Suite for STOMP Game & Telemetry Contract

import { Game } from '../src/game.js';
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  GROUND_Y,
  LOW_LANE_Y,
  HIGH_LANE_Y,
  MACHINE_NORMAL_APEX_Y,
  START_CLOCK_MS
} from '../src/constants.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    failed++;
  } else {
    console.log(`✅ PASS: ${msg}`);
  }
}

console.log('--- TEST 1: Initial Snapshot Schema & Types ---');
const game = new Game(42);
let snap = game.snapshot();

assert(snap.phase === 'ready', `phase should be "ready", got ${snap.phase}`);
assert(snap.tick === 0, `tick should be 0, got ${snap.tick}`);
assert(snap.elapsedMs === 0, `elapsedMs should be 0, got ${snap.elapsedMs}`);
assert(snap.remainingMs === START_CLOCK_MS, `remainingMs should be ${START_CLOCK_MS}, got ${snap.remainingMs}`);
assert(snap.seed === 42, `seed should be 42, got ${snap.seed}`);
assert(typeof snap.rngState === 'number', `rngState should be number, got ${typeof snap.rngState}`);
assert(snap.score === 0, `score should be 0, got ${snap.score}`);
assert(snap.difficulty === 0, `difficulty should be 0, got ${snap.difficulty}`);
assert(snap.rank === 'C', `rank should be "C", got ${snap.rank}`);
assert(typeof snap.input === 'object' && !snap.input.left && !snap.input.right && !snap.input.jump, 'input should have left/right/jump false');

// Fixed geometry
assert(snap.groundY === GROUND_Y, `groundY matches ${GROUND_Y}`);
assert(snap.lowLaneY === LOW_LANE_Y, `lowLaneY matches ${LOW_LANE_Y}`);
assert(snap.highLaneY === HIGH_LANE_Y, `highLaneY matches ${HIGH_LANE_Y}`);
assert(snap.machineNormalApexY === MACHINE_NORMAL_APEX_Y, `machineNormalApexY matches ${MACHINE_NORMAL_APEX_Y}`);
assert(snap.machineNormalApexY > snap.lowLaneY, `Apex (${snap.machineNormalApexY}) must stay below lowLaneY (${snap.lowLaneY})`);

// Machine & Ball properties
assert(snap.machine.grounded === true, 'machine initially grounded');
assert(snap.machine.jumpCount === 0, 'machine jumpCount initially 0');
assert(snap.ball.active === true, 'ball active');
assert(snap.ball.lastBounceKind === null, 'ball.lastBounceKind initially null');

// Counters
assert(snap.counters.topHits === 0, 'topHits 0');
assert(snap.counters.airEnemiesDefeated === 0, 'airEnemiesDefeated 0');
assert(snap.counters.wrongSideHits === 0, 'wrongSideHits 0');
assert(snap.counters.ballDrops === 0, 'ballDrops 0');
assert(snap.counters.longestCleanSequence === 0, 'longestCleanSequence 0');

// Telemetry events
assert(Array.isArray(snap.recentEvents), 'recentEvents is array');
assert(snap.lastEvent === null, 'lastEvent initially null');

console.log('\n--- TEST 2: Frozen Ready State Before Input ---');
game.advance(1000);
snap = game.snapshot();
assert(snap.phase === 'ready', 'advance() does not advance while ready with no input');
assert(snap.tick === 0, 'tick remains 0 while frozen in ready');
assert(snap.remainingMs === START_CLOCK_MS, 'remainingMs remains untouched');

console.log('\n--- TEST 3: First Input Starts Run ---');
game.setInput('jump', true);
snap = game.snapshot();
assert(snap.phase === 'playing', 'First input starts run immediately');
assert(game.ball.vy < 0, 'Ball launched on start');

console.log('\n--- TEST 4: Advance Runs Simulation ---');
game.advance(1000); // advance 1 second (60 ticks)
snap = game.snapshot();
assert(snap.tick === 60, `advance(1000) ran 60 ticks, got ${snap.tick}`);
assert(snap.remainingMs < START_CLOCK_MS, 'Clock drained');
assert(snap.lastEvent !== null, 'Events emitted during play (jump/land/bounces)');

console.log('\n--- TEST 5: Deterministic Replay / Idempotence ---');
// Run two separate game simulations with same seed and same input sequence
const gameA = new Game(999);
const gameB = new Game(999);

gameA.setInput('right', true);
gameB.setInput('right', true);

gameA.advance(500);
gameB.advance(500);

gameA.setInput('jump', true);
gameB.setInput('jump', true);

gameA.advance(1500);
gameB.advance(1500);

const snapA = gameA.snapshot();
const snapB = gameB.snapshot();

const jsonA = JSON.stringify(snapA);
const jsonB = JSON.stringify(snapB);
assert(jsonA === jsonB, 'Snapshots from identical seeds and inputs are 100% identical');

console.log('\n--- TEST 6: Opening Promise & Enemy Progression ---');
const gameOpen = new Game(12345);
gameOpen.setInput('left', true); // start run
gameOpen.setInput('left', false);

let lowLaneSeen = false;
let highLaneSeen = false;

// Advance up to half clock (37.5s = 2250 ticks)
for (let step = 0; step < 1800; step++) {
  gameOpen.advance(16.666666666666668);
  const s = gameOpen.snapshot();
  for (const e of s.enemies) {
    assert(e.type === 'slowFlyer' || e.type === 'walker', `Only slowFlyer or walker during opening, got ${e.type}`);
    assert(e.hitsRequired === 3 || e.type === 'walker', 'Flyers must require 3 hits');
    assert(e.collisionRadius <= e.visualRadius * 1.1, 'Collision radius <= visualRadius * 1.1');
    if (e.lane === 'low') lowLaneSeen = true;
    if (e.lane === 'high') highLaneSeen = true;
  }
}

assert(lowLaneSeen, 'Slow target crossed low lane during opening');
assert(highLaneSeen, 'Slow target crossed high lane during opening');

console.log('\n--- TEST 7: 60 Seconds Survival Clock Rule ---');
// "A player who never drops the ball and never takes a wrong-side hit still has time on the clock after a minute of play, even without completing a single target."
const gameSurvival = new Game(777);
gameSurvival.setInput('left', true);
gameSurvival.setInput('left', false);

// Keep ball bouncing safely without dropping or hitting enemies
// Run for 60 seconds (60,000 ms)
gameSurvival.advance(60000);
const snapSurv = gameSurvival.snapshot();
assert(snapSurv.remainingMs > 0, `Remaining ms after 60s without hits: ${snapSurv.remainingMs} ms > 0`);

console.log(`\n============================`);
if (failed === 0) {
  console.log(`🎉 ALL TESTS PASSED!`);
} else {
  console.error(`💥 ${failed} TESTS FAILED!`);
  process.exit(1);
}
