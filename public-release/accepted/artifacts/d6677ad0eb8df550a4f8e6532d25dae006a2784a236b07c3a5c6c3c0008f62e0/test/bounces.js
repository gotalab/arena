// Verification of Three Ordered Bounce Bands & Apex Heights

import { Game } from '../src/game.js';
import {
  LOW_LANE_Y,
  HIGH_LANE_Y,
  BOUNCE_WEAK_VY,
  BOUNCE_NORMAL_VY,
  BOUNCE_POWER_VY,
  BALL_GRAVITY
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

console.log('--- TEST 14: Three Bounce Bands & Apex Heights ---');

// Calculate theoretical apexes starting from machine top (y ~ 520)
// Apex Y = StartY - (vy^2) / (2 * g)
const startY = 520;

// 1. Weak bounce:
// "A late or descending-machine contact produces a weak recovery below the low lane."
const apexWeak = startY - (BOUNCE_WEAK_VY * BOUNCE_WEAK_VY) / (2 * BALL_GRAVITY);
assert(apexWeak > LOW_LANE_Y, `Weak apex (${apexWeak.toFixed(1)}) is BELOW low lane (${LOW_LANE_Y})`);

// 2. Normal bounce:
// "A grounded contact produces the dependable normal return through the low lane but below the high lane."
const apexNormal = startY - (BOUNCE_NORMAL_VY * BOUNCE_NORMAL_VY) / (2 * BALL_GRAVITY);
assert(apexNormal < LOW_LANE_Y, `Normal apex (${apexNormal.toFixed(1)}) is THROUGH low lane (${LOW_LANE_Y})`);
assert(apexNormal > HIGH_LANE_Y, `Normal apex (${apexNormal.toFixed(1)}) is BELOW high lane (${HIGH_LANE_Y})`);

// 3. Power bounce:
// "A contact while the machine is rising produces the higher, longer return through the high lane."
const apexPower = startY - (BOUNCE_POWER_VY * BOUNCE_POWER_VY) / (2 * BALL_GRAVITY);
assert(apexPower < HIGH_LANE_Y, `Power apex (${apexPower.toFixed(1)}) is THROUGH high lane (${HIGH_LANE_Y})`);

// 4. Test in simulated game physics
const game = new Game(55);
game.setInput('left', true);
game.setInput('left', false);

// Test grounded bounce
game.machine.grounded = true;
game.machine.vy = 0;
game.machine.x = 200;
game.ball.x = 200;
game.ball.y = game.machine.y - game.machine.radius - 1;
game.ball.vy = 3;
game.tick();

assert(game.ball.lastBounceKind === 'normal', `Grounded contact produced 'normal', got ${game.ball.lastBounceKind}`);
assert(game.events.lastEvent.kind === 'ball_bounce_normal', `Event is ball_bounce_normal`);

// Test rising machine contact (Power bounce)
game.machine.grounded = false;
game.machine.vy = -6; // rising!
game.machine.x = 200;
game.ball.x = 200;
game.ball.y = game.machine.y - game.machine.radius - 1;
game.ball.vy = 3;
game.tick();

assert(game.ball.lastBounceKind === 'power', `Rising contact produced 'power', got ${game.ball.lastBounceKind}`);
assert(game.events.lastEvent.kind === 'ball_bounce_power', `Event is ball_bounce_power`);

// Test descending machine contact (Weak bounce)
game.machine.grounded = false;
game.machine.vy = 2; // descending in mid-air
game.machine.x = 200;
game.ball.x = 200;
game.ball.y = game.machine.y - game.machine.radius - 1;
game.ball.vy = 4;
game.tick();

assert(game.ball.lastBounceKind === 'weak', `Descending contact produced 'weak', got ${game.ball.lastBounceKind}`);
assert(game.events.lastEvent.kind === 'ball_bounce_weak', `Event is ball_bounce_weak`);

console.log(`\n============================`);
if (failed === 0) {
  console.log(`🎉 ALL BOUNCE TESTS PASSED!`);
} else {
  console.error(`💥 ${failed} TESTS FAILED!`);
  process.exit(1);
}
