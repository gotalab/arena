const { GameSimulation } = require('../js/sim.js');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('=== Running Full Specification Verification ===');

// 1. Telemetry Snapshot Schema & Type Validation
const sim = new GameSimulation(42);
const snap0 = sim.snapshot();

// Fixed Geometry
assert(typeof snap0.groundY === 'number', 'groundY must be a number');
assert(typeof snap0.lowLaneY === 'number', 'lowLaneY must be a number');
assert(typeof snap0.highLaneY === 'number', 'highLaneY must be a number');
assert(typeof snap0.machineNormalApexY === 'number', 'machineNormalApexY must be a number');
assert(snap0.machineNormalApexY > snap0.lowLaneY, 'machine normal jump must stay below low lane');

// Machine Schema
assert(typeof snap0.machine.x === 'number', 'machine.x must be number');
assert(typeof snap0.machine.y === 'number', 'machine.y must be number');
assert(typeof snap0.machine.vx === 'number', 'machine.vx must be number');
assert(typeof snap0.machine.vy === 'number', 'machine.vy must be number');
assert(typeof snap0.machine.radius === 'number', 'machine.radius must be number');
assert(typeof snap0.machine.grounded === 'boolean', 'machine.grounded must be boolean');
assert(typeof snap0.machine.jumpCount === 'number', 'machine.jumpCount must be number');

// Ball Schema
assert(typeof snap0.ball.x === 'number', 'ball.x must be number');
assert(typeof snap0.ball.y === 'number', 'ball.y must be number');
assert(typeof snap0.ball.vx === 'number', 'ball.vx must be number');
assert(typeof snap0.ball.vy === 'number', 'ball.vy must be number');
assert(typeof snap0.ball.radius === 'number', 'ball.radius must be number');
assert(typeof snap0.ball.active === 'boolean', 'ball.active must be boolean');
assert(snap0.ball.lastBounceKind === null, 'initial lastBounceKind should be null');

// Counters Schema
assert(typeof snap0.counters.topHits === 'number', 'counters.topHits must be number');
assert(typeof snap0.counters.airEnemiesDefeated === 'number', 'counters.airEnemiesDefeated must be number');
assert(typeof snap0.counters.wrongSideHits === 'number', 'counters.wrongSideHits must be number');
assert(typeof snap0.counters.ballDrops === 'number', 'counters.ballDrops must be number');
assert(typeof snap0.counters.longestCleanSequence === 'number', 'counters.longestCleanSequence must be number');

console.log('Telemetry Schema: PASS');

// 2. Opening Promise Test
sim.setInput(true, false, false); // start run
let lowLaneSeen = false;
let highLaneSeen = false;
let halfClockTicks = (snap0.remainingMs / 2) / (1000 / 60);

for (let t = 0; t < halfClockTicks; t++) {
  sim.advance(16.6666);
  const snap = sim.snapshot();
  for (const e of snap.enemies) {
    if (e.type === 'slowFlyer' && e.lane === 'low') lowLaneSeen = true;
    if (e.type === 'slowFlyer' && e.lane === 'high') highLaneSeen = true;
    assert(e.type !== 'fastFlyer', 'No fast flyers should appear before first air enemy destruction');
  }
  if (lowLaneSeen && highLaneSeen) break;
}

assert(lowLaneSeen, 'Opening promise: slow target must cross low lane');
assert(highLaneSeen, 'Opening promise: slow target must cross high lane before half clock');
console.log('Opening Promise: PASS');

// 3. Bounce Bands Test
const simBounce = new GameSimulation(100);
simBounce.setInput(false, false, false);
simBounce.phase = 'playing';
simBounce.ball.active = true;

// Test power bounce (rising machine contact)
simBounce.machine.y = simBounce.groundY - 40;
simBounce.machine.vy = -300; // rising
simBounce.machine.grounded = false;
simBounce.ball.x = simBounce.machine.x;
simBounce.ball.y = simBounce.machine.y - simBounce.machine.radius - simBounce.ball.radius + 1;
simBounce.ball.vy = 200; // falling down onto machine
simBounce.step();

assert(simBounce.ball.lastBounceKind === 'power', 'Rising contact should produce power bounce');
assert(simBounce.lastEvent.kind === 'ball_bounce_power', 'Event should be ball_bounce_power');

// Test normal bounce (grounded machine contact)
simBounce.machine.y = simBounce.groundY;
simBounce.machine.vy = 0;
simBounce.machine.grounded = true;
simBounce.ball.x = simBounce.machine.x;
simBounce.ball.y = simBounce.machine.y - simBounce.machine.radius - simBounce.ball.radius + 1;
simBounce.ball.vy = 200;
simBounce.step();

assert(simBounce.ball.lastBounceKind === 'normal', 'Grounded contact should produce normal bounce');
assert(simBounce.lastEvent.kind === 'ball_bounce_normal', 'Event should be ball_bounce_normal');

// Test weak bounce (descending machine contact)
simBounce.machine.y = simBounce.groundY - 30;
simBounce.machine.vy = 200; // falling
simBounce.machine.grounded = false;
simBounce.ball.x = simBounce.machine.x;
simBounce.ball.y = simBounce.machine.y - simBounce.machine.radius - simBounce.ball.radius + 1;
simBounce.ball.vy = 200;
simBounce.step();

assert(simBounce.ball.lastBounceKind === 'weak', 'Descending contact should produce weak bounce');
assert(simBounce.lastEvent.kind === 'ball_bounce_weak', 'Event should be ball_bounce_weak');

console.log('Bounce Bands (Weak, Normal, Power): PASS');

// 4. Three-hit pursuit progression & rewards
const simPursuit = new GameSimulation(200);
simPursuit.setInput(true, false, false);
simPursuit.step();

const target = simPursuit.spawnEnemy('slowFlyer', 'low');
target.x = 200;
target.y = simPursuit.lowLaneY;

// Hit 1
const timeBefore1 = simPursuit.remainingMs;
simPursuit.ball.x = 200;
simPursuit.ball.y = target.y - 10;
simPursuit.ball.vy = 300;
simPursuit.step();

assert(target.hitsTaken === 1, 'Target should have 1 hit');
const gain1 = Math.round(simPursuit.remainingMs - timeBefore1 + (1000/60));
assert(gain1 === 3000, `Hit 1 should award 3000ms (got ${gain1})`);
assert(simPursuit.lastEvent.kind === 'top_hit', 'Event should be top_hit');
assert(simPursuit.lastEvent.source === 'ball', 'Source should be ball');
assert(simPursuit.lastEvent.contact === 'top', 'Contact should be top');

// Hit 2
const timeBefore2 = simPursuit.remainingMs;
simPursuit.ball.x = 200;
simPursuit.ball.y = target.y - 10;
simPursuit.ball.vy = 300;
simPursuit.step();

assert(target.hitsTaken === 2, 'Target should have 2 hits');
const gain2 = Math.round(simPursuit.remainingMs - timeBefore2 + (1000/60));
assert(gain2 === 5000, `Hit 2 should award 5000ms (got ${gain2})`);
assert(gain2 > gain1, 'Hit 2 time must be strictly greater than Hit 1 time');

// Hit 3 (Defeat)
const timeBefore3 = simPursuit.remainingMs;
simPursuit.ball.x = 200;
simPursuit.ball.y = target.y - 10;
simPursuit.ball.vy = 300;
simPursuit.step();

assert(target.hitsTaken === 3, 'Target should have 3 hits');
assert(target.active === false, 'Target should become inactive on 3rd hit');
assert(simPursuit.airEnemiesDefeated === 1, 'airEnemiesDefeated should be 1');
const gain3 = Math.round(simPursuit.remainingMs - timeBefore3 + (1000/60));
assert(gain3 === 10000, `Hit 3 should award 10000ms (got ${gain3})`);
assert(gain3 > gain2, 'Hit 3 time must be strictly greater than Hit 2 time');
assert(simPursuit.lastEvent.kind === 'enemy_defeated', 'Defeat event should be recorded');

console.log('3-Hit Pursuit & Reward Escalation: PASS');

// 5. Wrong-side hit & overlap deduplication
const simWrong = new GameSimulation(300);
simWrong.setInput(true, false, false);
simWrong.step();

const targetWrong = simWrong.spawnEnemy('slowFlyer', 'low');
targetWrong.x = 200;
targetWrong.y = simWrong.lowLaneY;

// Upward collision (wrong side)
simWrong.ball.x = 200;
simWrong.ball.y = targetWrong.y + 10;
simWrong.ball.vy = -300;
const timeBeforeWrong = simWrong.remainingMs;
simWrong.step();

assert(simWrong.wrongSideHits === 1, 'Wrong side hit counter should increment');
const penaltyWrong = Math.round(simWrong.remainingMs - timeBeforeWrong + (1000/60));
assert(penaltyWrong === -3000, `Wrong side penalty should be -3000ms (got ${penaltyWrong})`);
assert(simWrong.lastEvent.kind === 'wrong_side_hit', 'Event should be wrong_side_hit');

// Continuous overlap should not charge again
simWrong.step();
assert(simWrong.wrongSideHits === 1, 'Continuous overlap should not charge second penalty');

console.log('Wrong-Side Hit & Single Overlap Charging: PASS');

// 6. Ball Drop & Recovery
const simDrop = new GameSimulation(400);
simDrop.setInput(true, false, false);
simDrop.step();

simDrop.machine.x = 300;
simDrop.ball.x = 50;
simDrop.ball.y = simDrop.groundY - simDrop.ball.radius + 1;
simDrop.ball.vy = 200;
const timeBeforeDrop = simDrop.remainingMs;
simDrop.step();

assert(simDrop.ballDrops === 1, 'ballDrops counter should increment');
const dropPenalty = Math.round(simDrop.remainingMs - timeBeforeDrop + (1000/60));
assert(dropPenalty === -5000, 'Ball drop penalty should be -5000ms');
assert(Math.abs(dropPenalty) > Math.abs(penaltyWrong), 'Ball drop must remove more time than wrong-side hit');
assert(simDrop.ball.active === false, 'Ball enters recovery state');
assert(simDrop.ball.recoveryTicks > 0, 'Ball recoveryTicks initialized');

console.log('Ball Drop & Recovery: PASS');

// 7. Ground Walker Stomp vs Body Hit
const simWalker = new GameSimulation(500);
simWalker.setInput(true, false, false);
simWalker.step();

const walker = simWalker.spawnEnemy('walker', 'ground');
walker.x = simWalker.machine.x;
walker.y = simWalker.groundY - 14;

// Machine stomps walker from above
simWalker.machine.y = walker.y - 10;
simWalker.machine.vy = 200; // falling onto walker
simWalker.step();

assert(walker.active === false, 'Walker should be stomped and deactivated');
assert(simWalker.lastEvent.kind === 'ground_stomp', 'Event should be ground_stomp');
assert(simWalker.lastEvent.source === 'machine', 'Source should be machine');

console.log('Ground Walker Stomp: PASS');

console.log('=== ALL SPECIFICATION CHECKS SUCCESSFULLY PASSED! ===');
