// Detailed verification of combat rules, 3-hit pursuit, events, and telemetry

import { Game } from '../src/game.js';
import {
  LOW_LANE_Y,
  HIGH_LANE_Y,
  GROUND_Y,
  TIME_REWARD_HIT_1,
  TIME_REWARD_HIT_2,
  TIME_REWARD_HIT_3,
  TIME_REWARD_STOMP,
  TIME_PENALTY_WRONG_SIDE,
  TIME_PENALTY_BALL_DROP,
  TIME_PENALTY_BODY_HIT,
  SCORE_HIT_1,
  SCORE_HIT_2,
  SCORE_HIT_3,
  SCORE_STOMP
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

console.log('--- TEST 8: 3-Hit Pursuit Mechanics ---');
const game = new Game(100);
game.setInput('jump', true);
game.setInput('jump', false);

// Wait until first flyer spawns and moves well inside the stage
while (game.enemies.length === 0) {
  game.tick();
}

const flyer = game.enemies[0];
// Move flyer to center of screen for clean test
flyer.x = 200;
flyer.y = LOW_LANE_Y;
game.machine.x = 50; // Move machine away so it doesn't interfere

assert(flyer.hitsRequired === 3, 'Flyer requires 3 hits');
assert(flyer.hitsTaken === 0, 'Flyer starts with 0 hits');

const clockBeforeHit1 = game.remainingMs;
const scoreBeforeHit1 = game.score;

// Simulate top hit 1: descending ball contacting top of flyer
game.ball.x = flyer.x;
// Ball slightly above flyer top so after updatePhysics it contacts top
game.ball.y = flyer.y - flyer.collisionRadius - game.ball.radius + 2;
game.ball.vy = 4; // descending
game.ball.vx = 0;

game.tick();

assert(flyer.hitsTaken === 1, `Flyer hitsTaken should be 1, got ${flyer.hitsTaken}`);
assert(game.counters.topHits === 1, `topHits count 1, got ${game.counters.topHits}`);
assert(game.currentCleanSequence === 1, `currentCleanSequence 1, got ${game.currentCleanSequence}`);
assert(game.score === scoreBeforeHit1 + SCORE_HIT_1, `Score increased by ${SCORE_HIT_1}`);
// Clock should have gained 3000ms minus 1 tick of drain
const expectedClock1 = clockBeforeHit1 + TIME_REWARD_HIT_1 - (1000 / 60);
assert(Math.abs(game.remainingMs - expectedClock1) < 1.0, `Clock gained +3000ms reward`);
assert(game.ball.vy < 0, `Ball rebounded upward (${game.ball.vy})`);

// Event check
let lastEv = game.events.lastEvent;
assert(lastEv.kind === 'top_hit', `Event kind top_hit, got ${lastEv.kind}`);
assert(lastEv.amountMs === TIME_REWARD_HIT_1, `Event amountMs matches reward`);
assert(lastEv.source === 'ball', `Event source ball`);
assert(lastEv.contact === 'top', `Event contact top`);

// Simulate top hit 2
const clockBeforeHit2 = game.remainingMs;
game.ball.x = flyer.x;
game.ball.y = flyer.y - flyer.collisionRadius - game.ball.radius + 2;
game.ball.vy = 4;
game.tick();

assert(flyer.hitsTaken === 2, `Flyer hitsTaken should be 2, got ${flyer.hitsTaken}`);
assert(game.counters.topHits === 2, `topHits count 2, got ${game.counters.topHits}`);
assert(game.currentCleanSequence === 2, `currentCleanSequence 2, got ${game.currentCleanSequence}`);
assert(game.score === scoreBeforeHit1 + SCORE_HIT_1 + SCORE_HIT_2, `Score increased by ${SCORE_HIT_2}`);
const expectedClock2 = clockBeforeHit2 + TIME_REWARD_HIT_2 - (1000 / 60);
assert(Math.abs(game.remainingMs - expectedClock2) < 1.0, `Clock gained +6000ms reward`);

// Simulate top hit 3 (target defeated)
const clockBeforeHit3 = game.remainingMs;
game.ball.x = flyer.x;
game.ball.y = flyer.y - flyer.collisionRadius - game.ball.radius + 2;
game.ball.vy = 4;
game.tick();

assert(flyer.hitsTaken === 3, `Flyer hitsTaken should be 3, got ${flyer.hitsTaken}`);
assert(flyer.active === false, `Flyer defeated, active = false`);
assert(flyer.defeatTimer > 0, `Flyer remains observable briefly after defeat (${flyer.defeatTimer} ticks)`);
assert(game.counters.airEnemiesDefeated === 1, `airEnemiesDefeated 1, got ${game.counters.airEnemiesDefeated}`);
assert(game.score === scoreBeforeHit1 + SCORE_HIT_1 + SCORE_HIT_2 + SCORE_HIT_3, `Score gained ${SCORE_HIT_3}`);
const expectedClock3 = clockBeforeHit3 + TIME_REWARD_HIT_3 - (1000 / 60);
assert(Math.abs(game.remainingMs - expectedClock3) < 1.0, `Clock gained +12000ms reward`);

// Event check: enemy_defeated
lastEv = game.events.lastEvent;
assert(lastEv.kind === 'enemy_defeated', `Event kind enemy_defeated, got ${lastEv.kind}`);
assert(lastEv.amountMs === TIME_REWARD_HIT_3, `Event amountMs matches hit 3 reward`);

console.log('\n--- TEST 9: Strictly Increasing Time Rewards ---');
assert(TIME_REWARD_HIT_1 < TIME_REWARD_HIT_2, 'Hit 2 reward > Hit 1 reward');
assert(TIME_REWARD_HIT_2 < TIME_REWARD_HIT_3, 'Hit 3 reward > Hit 2 reward');

console.log('\n--- TEST 10: Wrong-Side Hit Penalty & Continuous Overlap ---');
// Wait for next flyer to spawn and move inside stage
while (game.enemies.filter(e => e.active && (e.type === 'slowFlyer' || e.type === 'fastFlyer')).length === 0) {
  game.tick();
}
const activeFlyer = game.enemies.find(e => e.active && (e.type === 'slowFlyer' || e.type === 'fastFlyer'));
activeFlyer.x = 200;
activeFlyer.y = LOW_LANE_Y;

const wrongSideHitsBefore = game.counters.wrongSideHits;
const clockBeforeWrong = game.remainingMs;

// Position ball under flyer (ascending into underside)
game.ball.x = activeFlyer.x;
game.ball.y = activeFlyer.y + activeFlyer.collisionRadius * 0.4;
game.ball.vy = -3; // ascending into bottom

game.tick();

assert(game.counters.wrongSideHits === wrongSideHitsBefore + 1, 'wrongSideHits incremented');
assert(game.currentCleanSequence === 0, 'Clean streak broken on wrong-side hit');
const expectedClockWrong = clockBeforeWrong + TIME_PENALTY_WRONG_SIDE - (1000 / 60);
assert(Math.abs(game.remainingMs - expectedClockWrong) < 1.0, `Wrong side penalty of -4000ms deducted`);

let evWrong = game.events.lastEvent;
assert(evWrong.kind === 'wrong_side_hit', `Event kind wrong_side_hit, got ${evWrong.kind}`);
assert(evWrong.contact === 'non_top', `Event contact non_top, got ${evWrong.contact}`);
assert(evWrong.amountMs === TIME_PENALTY_WRONG_SIDE, 'Event amountMs matches penalty');

// Check that continuous overlap does NOT charge again
const clockDuringOverlap = game.remainingMs;
// Keep ball in overlapping area
game.ball.x = activeFlyer.x;
game.ball.y = activeFlyer.y;
game.tick();
// Only normal tick drain should have occurred, no extra 4000ms penalty
assert(game.counters.wrongSideHits === wrongSideHitsBefore + 1, 'No additional penalty during continuous overlap');
assert(Math.abs(game.remainingMs - (clockDuringOverlap - (1000 / 60))) < 1.0, 'No extra time penalty charged during overlap');

console.log('\n--- TEST 11: Ball Drop Penalty & Recovery ---');
const ballDropsBefore = game.counters.ballDrops;
const clockBeforeDrop = game.remainingMs;

// Put ball at ground
game.ball.x = 200;
game.ball.y = GROUND_Y - game.ball.radius - 2;
game.ball.vy = 4;
game.tick();

assert(game.counters.ballDrops === ballDropsBefore + 1, 'ballDrops incremented');
assert(game.currentCleanSequence === 0, 'Clean sequence reset on ball drop');
const expectedClockDrop = clockBeforeDrop + TIME_PENALTY_BALL_DROP - (1000 / 60);
assert(Math.abs(game.remainingMs - expectedClockDrop) < 1.0, 'Penalty of -6000ms deducted for drop');
assert(TIME_PENALTY_BALL_DROP < TIME_PENALTY_WRONG_SIDE, 'Drop penalty (-6s) removes more time than wrong-side hit (-4s)');

// Check ball recovery position
assert(game.ball.y < game.machine.y, 'Ball returned cleanly above machine');
assert(game.ball.vy < 0, 'Ball launched softly upward into readable recovery');

let evDrop = game.events.lastEvent;
assert(evDrop.kind === 'ball_drop', `Event kind ball_drop, got ${evDrop.kind}`);
assert(evDrop.amountMs === TIME_PENALTY_BALL_DROP, 'Event amountMs matches drop penalty');

console.log('\n--- TEST 12: Ground Walker Stomp vs Body Hit ---');
// Spawn a walker
game.nextWalkerSpawnTick = game.tickCount;
game.tick();
const walker = game.enemies.find(e => e.type === 'walker' && e.active);
assert(!!walker, 'Walker spawned');
walker.x = 200;
walker.y = GROUND_Y - walker.collisionRadius;

// Keep ball safely high in sky so it doesn't interfere
game.ball.x = 50;
game.ball.y = 50;
game.ball.vy = -1;

// Test Stomp: machine descending from above onto walker
game.machine.x = walker.x;
game.machine.y = walker.y - game.machine.radius - 4;
game.machine.vy = 5; // descending onto walker
game.machine.grounded = false;

const clockBeforeStomp = game.remainingMs;
const scoreBeforeStomp = game.score;

game.tick();

assert(!walker.active, 'Walker defeated by stomp');
assert(game.machine.vy < 0, 'Machine bounced upward from stomp hop');
assert(game.score === scoreBeforeStomp + SCORE_STOMP, 'Score gained for stomp');
let evStomp = game.events.lastEvent;
assert(evStomp.kind === 'ground_stomp', `Event kind ground_stomp, got ${evStomp.kind}`);
assert(evStomp.contact === 'top', `Event contact top`);
assert(evStomp.amountMs === TIME_REWARD_STOMP, `Event amountMs +2000`);

console.log('\n--- TEST 13: Event Sequence Monotonicity & LastEvent Invariant ---');
let prevSeq = 0;
for (const ev of game.events.recentEvents) {
  assert(ev.sequence === prevSeq + 1, `Sequence must increase by 1: ${ev.sequence} === ${prevSeq + 1}`);
  prevSeq = ev.sequence;
  assert(typeof ev.kind === 'string', 'Event kind is string');
  assert(typeof ev.tick === 'number', 'Event tick is number');
  assert(ev.source === 'ball' || ev.source === 'machine' || ev.source === 'system', `Source is valid: ${ev.source}`);
  assert(ev.contact === 'top' || ev.contact === 'non_top' || ev.contact === 'body' || ev.contact === null, `Contact is valid: ${ev.contact}`);
}
assert(game.events.lastEvent === game.events.recentEvents[game.events.recentEvents.length - 1], 'lastEvent equals latest history entry');

console.log(`\n============================`);
if (failed === 0) {
  console.log(`🎉 ALL DEEP RULE TESTS PASSED!`);
} else {
  console.error(`💥 ${failed} TESTS FAILED!`);
  process.exit(1);
}
