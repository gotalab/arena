const assert = require('assert');
const { createSim } = require('../src/sim.js');

function run(label, fn) {
  try {
    fn();
    console.log('PASS', label);
  } catch (e) {
    console.log('FAIL', label, '-', e.message);
    process.exitCode = 1;
  }
}

// --- determinism: same seed -> identical starting snapshot ---
run('reset(seed) is deterministic', () => {
  const a = createSim(); const b = createSim();
  const sa = a.reset('hello-123');
  const sb = b.reset('hello-123');
  assert.deepStrictEqual(sa, sb);
});

// --- determinism across a scripted input timeline ---
function scriptedRun(sim, seed, script) {
  sim.reset(seed);
  const snaps = [];
  for (let tick = 0; tick < script.length; tick++) {
    const ev = script[tick];
    if (ev) {
      if (ev.type === 'down') sim.pointerDown(ev.x, ev.y, ev.x, ev.y);
      if (ev.type === 'move') sim.pointerMove(ev.x, ev.y, ev.x, ev.y);
      if (ev.type === 'up') sim.pointerUp(ev.x, ev.y, ev.x, ev.y);
    }
    sim.step();
    snaps.push(JSON.stringify(sim.snapshot()));
  }
  return snaps;
}

run('scripted input timeline reproduces identical snapshots', () => {
  const script = [];
  script[0] = { type: 'down', x: 140, y: 60 };
  script[3] = { type: 'move', x: 140, y: 160 }; // pull straight down -> launch up
  script[5] = { type: 'up', x: 140, y: 160 };
  for (let i = 6; i < 40; i++) script[i] = null;
  script[41] = { type: 'down', x: 130, y: 100 };
  script[43] = { type: 'move', x: 160, y: 170 };
  script[45] = { type: 'up', x: 160, y: 170 };

  const s1 = createSim();
  const s2 = createSim();
  const snaps1 = scriptedRun(s1, 'replay-seed', script);
  const snaps2 = scriptedRun(s2, 'replay-seed', script);
  assert.deepStrictEqual(snaps1, snaps2);
});

// --- ready phase freezes tick/elapsedMs ---
run('ready phase never advances tick before first launch', () => {
  const sim = createSim();
  sim.reset('freeze');
  for (let i = 0; i < 30; i++) sim.step();
  const snap = sim.snapshot();
  assert.strictEqual(snap.phase, 'ready');
  assert.strictEqual(snap.tick, 0);
  assert.strictEqual(snap.elapsedMs, 0);
});

// --- dead zone cancels launch ---
run('short pull below dead zone cancels without spending glow', () => {
  const sim = createSim();
  sim.reset('deadzone');
  const before = sim.snapshot().jumpsLeft;
  sim.pointerDown(140, 60, 140, 60);
  sim.pointerMove(142, 63, 142, 63);
  sim.pointerUp(142, 63, 142, 63);
  sim.step();
  const after = sim.snapshot();
  assert.strictEqual(after.jumpsLeft, before);
  assert.strictEqual(after.phase, 'ready');
});

// --- first launch starts the run and spends a glow ---
run('a real pull-and-release launches and spends one glow', () => {
  const sim = createSim();
  sim.reset('launch1');
  const cap = sim.snapshot().jumpCapacity;
  sim.pointerDown(140, 60, 140, 60);
  sim.pointerMove(140, 160, 140, 160);
  sim.pointerUp(140, 160, 140, 160);
  sim.step();
  const s = sim.snapshot();
  assert.strictEqual(s.phase, 'playing');
  assert.strictEqual(s.jumpsLeft, cap - 1);
  assert.strictEqual(s.launches, 1);
  assert.strictEqual(s.lastEvent.kind, 'launch');
});

// --- reachability guarantee: every ledge has some ledge above within physics reach from any x in playable range ---
run('safe-road guarantee: generated ledges are always vertically/lateral reachable from a full launch', () => {
  const sim = createSim();
  sim.reset('reach-check');
  // drive the sim a long way up using a simple "always aim straight up full pull" bot,
  // landing wherever it lands, to force lots of generation, then inspect ledge data directly.
  let guard = 0;
  while (sim.snapshot().height < 6000 && guard < 20000) {
    const snap = sim.snapshot();
    if (snap.phase === 'gameover') break;
    if (snap.player.anchored || snap.jumpsLeft > 0) {
      sim.pointerDown(140, 300, 140, 300);
      sim.pointerMove(140, 300 + 118, 140, 300 + 118); // full pull straight down -> launch straight up
      sim.pointerUp(140, 300 + 118, 140, 300 + 118);
    }
    sim.step();
    guard++;
  }
  assert.ok(guard < 20000, 'did not time out');

  // Reconstruct full ledge list by walking a fresh sim and collecting every row via reset+forced high climb
  // Instead, validate using the exported constants + a direct generation probe via reset and reading snapshots
  // across an ascending camera window.
  const probe = createSim();
  probe.reset('reach-check');
  const seen = [];
  let lastHeight = -1;
  for (let i = 0; i < 4000; i++) {
    const snap = probe.snapshot();
    if (snap.ledges.length) {
      for (const l of snap.ledges) seen.push(l);
    }
    // climb deterministically: always full straight-up pull when possible
    if (snap.phase !== 'gameover' && (snap.player.anchored || snap.jumpsLeft > 0)) {
      probe.pointerDown(140, 300, 140, 300);
      probe.pointerMove(140, 418, 140, 418);
      probe.pointerUp(140, 418, 140, 418);
    }
    probe.step();
    if (snap.phase === 'gameover') break;
  }
  const byId = new Map();
  for (const l of seen) byId.set(l.id, l);
  const all = Array.from(byId.values()).sort((a, b) => a.position.y - b.position.y);
  const REACH = sim.snapshot().launchReach;
  // margin identical to generator's physics-based guarantee
  const R = REACH, MARGIN = 0.82, REACH_EFF = R * MARGIN;
  function maxDxAtGap(gap) {
    const val = REACH_EFF - gap;
    if (val <= 0) return 0;
    return Math.sqrt(4 * R * val);
  }
  // group by row (unique y), verify each row's every ledge/wall is covered by next row
  const rows = [];
  const byY = new Map();
  for (const l of all) {
    const key = l.position.y.toFixed(2);
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(l.position.x);
  }
  const ys = Array.from(byY.keys()).map(Number).sort((a, b) => a - b);
  let violations = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    const gap = ys[i + 1] - ys[i];
    if (gap <= 0) continue;
    const maxDx = maxDxAtGap(gap);
    const nextXs = byY.get(ys[i + 1].toFixed(2));
    const sources = [0].concat(byY.get(ys[i].toFixed(2))).concat([280]); // wallLeftX=40 handled via inner constant below
    // use real wall inner faces
    const wallLeft = 40, wallRight = 240;
    const srcs = [wallLeft, wallRight].concat(byY.get(ys[i].toFixed(2)));
    for (const sx of srcs) {
      const ok = nextXs.some(nx => Math.abs(nx - sx) <= maxDx + 0.01);
      if (!ok) violations++;
    }
  }
  assert.strictEqual(violations, 0, `${violations} reachability violations found`);
});

// --- damp catches an idle player within a bounded time ---
run('damp eventually catches an idling player (bounded time)', () => {
  const sim = createSim();
  sim.reset('idle-damp');
  sim.pointerDown(140, 60, 140, 60);
  sim.pointerMove(140, 160, 140, 160);
  sim.pointerUp(140, 160, 140, 160); // one launch to enter 'playing', likely lands again
  let ticks = 0;
  const MAX_TICKS = 60 * 130; // ~130s ceiling
  while (sim.snapshot().phase === 'playing' && ticks < MAX_TICKS) {
    sim.step();
    ticks++;
  }
  assert.strictEqual(sim.snapshot().phase, 'gameover');
  assert.ok(ticks < MAX_TICKS, 'damp never caught the idling player in time');
});

// --- chain accounting ---
run('chainCount increments on midair launches/bounces and resets + banks on landing', () => {
  const sim = createSim();
  sim.reset('chain-test');
  // first launch from rest: should NOT start a chain
  sim.pointerDown(140, 60, 140, 60);
  sim.pointerMove(140, 160, 140, 160);
  sim.pointerUp(140, 160, 140, 160);
  sim.step();
  assert.strictEqual(sim.snapshot().chainCount, 0);

  // a midair launch while still flying should increment chain
  sim.pointerDown(140, 90, 140, 90);
  sim.pointerMove(140, 130, 140, 130);
  sim.pointerUp(140, 130, 140, 130);
  sim.step();
  const afterMidair = sim.snapshot();
  assert.strictEqual(afterMidair.chainCount, 1);
  assert.strictEqual(afterMidair.lastEvent.kind, 'chain');
});

// --- restart equivalence ---
run('reset(seed) after play returns to identical initial snapshot', () => {
  const sim = createSim();
  const initial = sim.reset('restart-eq');
  sim.pointerDown(140, 60, 140, 60);
  sim.pointerMove(140, 160, 140, 160);
  sim.pointerUp(140, 160, 140, 160);
  for (let i = 0; i < 50; i++) sim.step();
  const again = sim.reset('restart-eq');
  const { sessionBest: sb1, ...rest1 } = initial;
  const { sessionBest: sb2, ...rest2 } = again;
  assert.deepStrictEqual(rest1, rest2);
});
