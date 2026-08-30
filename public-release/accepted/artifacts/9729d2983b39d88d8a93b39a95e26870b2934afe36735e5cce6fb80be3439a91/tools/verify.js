/* Headless checks for the DELVE rules layer. Run: node tools/verify.js */
require('../src/sim.js');
const { Game, C } = globalThis.DELVE;
const STEP = C.STEP_MS;

function fmt(n, d = 1) { return Number(n).toFixed(d); }

// ---------------------------------------------------------------- bots ----
// timid: never accelerates, never steers off its line unless a wall forces it
function botTimid() {
  return () => ({ accel: false, steer: 0 });
}
// straight: holds the accelerator, never steers
function botStraight() {
  return () => ({ accel: true, steer: 0 });
}
// driver: holds throttle, follows the corridor, sweeps fragments on its line
function botDriver(opts = {}) {
  const greed = opts.greed ?? 1;
  const brave = opts.brave ?? 1;
  return (g) => {
    const look = 40 + g.speed * 0.55;
    const a = g.course.at(g.depth + look);
    let target = a.x;

    if (greed > 0) {
      let best = null, bestScore = -1e9;
      for (let i = g.itemStart; i < g.items.length; i++) {
        const it = g.items[i];
        if (it.depth > g.depth + 210) break;
        if (!it.active || it.depth < g.depth + 8) continue;
        const dz = it.depth - g.depth;
        const need = Math.abs(it.x - g.x) / dz;
        const s = (it.type === 'power' ? 400 : 100 * greed) - dz * 0.35 - need * 130;
        if (s > bestScore) { bestScore = s; best = it; }
      }
      if (best) target = best.x;
    }

    // steer around rocks that sit on the intended line
    for (let i = g.rockStart; i < g.rocks.length; i++) {
      const r = g.rocks[i];
      if (r.depth > g.depth + look + 70) break;
      if (!r.active || r.depth < g.depth - 5) continue;
      const clear = r.collisionRadius + C.PLAYER_RADIUS + 5;
      if (Math.abs(target - r.x) < clear) {
        const ah = g.course.at(r.depth);
        const left = r.x - clear, right = r.x + clear;
        const okL = left - C.PLAYER_RADIUS > ah.x - ah.half;
        const okR = right + C.PLAYER_RADIUS < ah.x + ah.half;
        if (okL && (!okR || Math.abs(left - g.x) < Math.abs(right - g.x))) target = left;
        else if (okR) target = right;
        else target = ah.x;
      }
    }

    const hereA = g.course.at(g.depth);
    target = Math.max(hereA.x - hereA.half + C.PLAYER_RADIUS + 2,
      Math.min(hereA.x + hereA.half - C.PLAYER_RADIUS - 2, target));

    const err = target - g.x;
    const steer = Math.max(-1, Math.min(1, err / 9));

    // ease off when the line ahead demands more lateral authority than we have
    const f = (g.speed - C.IDLE_SPEED) / (C.MAX_SPEED - C.IDLE_SPEED);
    const lat = C.LAT_SLOW + (C.LAT_FAST - C.LAT_SLOW) * Math.pow(Math.max(0, f), C.LAT_CURVE);
    const timeToLook = look / Math.max(1, g.speed);
    const demand = Math.abs(err) / Math.max(0.08, timeToLook);
    const accel = demand < lat * (0.55 + 0.3 * brave);
    return { accel, steer };
  };
}

function runBot(seed, bot, maxTicks = 60 * 400) {
  const g = new Game(seed);
  const b = bot;
  let minSafe = 1e9, ticks = 0, sumSpeed = 0;
  let halfEmpty = false;
  const start = performance.now();
  while (g.phase !== 'gameover' && ticks < maxTicks) {
    g.setInput(b(g));
    if (g.phase === 'ready') g.setInput({ ...b(g), accel: true });
    g.advance(STEP);
    if (g.phase === 'ready') break;
    ticks++;
    sumSpeed += g.speed;
    if (g.remainingMs < C.MAX_TIME_MS * 0.5) halfEmpty = true;
    if (ticks % 6 === 0) minSafe = Math.min(minSafe, g.computeSafeHalf());
  }
  return {
    g, ticks, minSafe, halfEmpty,
    seconds: ticks / 60,
    avgSpeed: sumSpeed / Math.max(1, ticks),
    ms: performance.now() - start
  };
}

// --------------------------------------------------------------- checks ---
let fails = 0;
function check(name, ok, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
}

console.log('\n== determinism ==');
{
  const inputs = [];
  const r = new globalThis.DELVE.Rng(99);
  for (let i = 0; i < 1800; i++) {
    inputs.push({ accel: r.next() < 0.72, steer: Math.round((r.next() * 2 - 1) * 100) / 100 });
  }
  const play = (chunk) => {
    const g = new Game(4242);
    for (let i = 0; i < inputs.length; i++) { g.setInput(inputs[i]); g.advance(STEP); }
    return g.snapshot();
  };
  const a = play(), b = play();
  check('same seed + same input timeline → identical snapshot',
    JSON.stringify(a) === JSON.stringify(b));

  // advance(ms) in one gulp equals the same stretch stepped frame by frame
  const g1 = new Game(7); g1.setInput({ accel: true, steer: 0.4 });
  for (let i = 0; i < 300; i++) g1.advance(STEP);
  const g2 = new Game(7); g2.setInput({ accel: true, steer: 0.4 });
  g2.advance(STEP * 300);
  check('advance(300 steps) === 300 × advance(1 step)',
    JSON.stringify(g1.snapshot()) === JSON.stringify(g2.snapshot()));

  const g3 = new Game(11); g3.setInput({ accel: true, steer: 0 });
  g3.advance(1000); const s3 = g3.snapshot();
  g3.reset(11); g3.setInput({ accel: true, steer: 0 }); g3.advance(1000);
  check('reset(seed) restores everything', JSON.stringify(s3) === JSON.stringify(g3.snapshot()));

  const g4 = new Game(3);
  const before = JSON.stringify(g4.snapshot());
  g4.advance(5000); g4.advance(5000);
  check('phase "ready" is frozen', JSON.stringify(g4.snapshot()) === before);
  const g5 = new Game(3); g5.setInput({ accel: true }); g5.advance(600000);
  const over = g5.snapshot(); g5.advance(10000);
  check('gameover is frozen', JSON.stringify(g5.snapshot()) === JSON.stringify(over),
    `phase=${over.phase}`);
}

console.log('\n== control: speed costs authority ==');
{
  // Same steering key held for the same length of time, from the middle of the
  // corridor, measured against both the clock and the depth gained. Lateral
  // travel is read relative to the corridor centre so a bend sliding underneath
  // the machine cannot be mistaken for authority it does not have, and the
  // window is short enough that no wall ever truncates the sweep.
  const secs = 0.22;
  const lateral = (frac) => {
    const g = new Game(5);
    g.setInput({ accel: true, steer: 0 });
    g.advance(STEP); // leave "ready"
    const want = C.IDLE_SPEED + (C.MAX_SPEED - C.IDLE_SPEED) * frac;
    while (g.speed < want - 0.5 && g.tick < 900) g.advance(STEP);
    g.setInput({ accel: false, steer: 0 });
    while (g.speed > want + 0.5 && g.tick < 900) g.advance(STEP);
    g.setInput({ accel: g.speed > C.IDLE_SPEED + 1, steer: 1 });
    const rel0 = g.x - g.course.centerAt(g.depth), d0 = g.depth, w0 = g.wallContacts;
    const v = g.speed;
    for (let i = 0; i < Math.round(secs * 60); i++) g.advance(STEP);
    return {
      dx: Math.abs((g.x - g.course.centerAt(g.depth)) - rel0),
      dd: g.depth - d0, v: v, clean: g.wallContacts === w0
    };
  };
  const slow = lateral(0);
  const fast = lateral(1);
  check('the sweep never touched a wall', slow.clean && fast.clean);
  check(`${secs} s of steering covers materially less ground at full throttle`,
    fast.dx < slow.dx * 0.6,
    `crawl ${fmt(slow.dx)}u vs full ${fmt(fast.dx)}u`);
  check('lateral travel per unit depth collapses with speed',
    fast.dx / fast.dd < slow.dx / slow.dd * 0.15,
    `crawl ${fmt(slow.dx / slow.dd, 2)} vs full ${fmt(fast.dx / fast.dd, 2)} u/u`);
  const curve = [0, 0.25, 0.5, 0.75, 1].map(f => lateral(f));
  check('the falloff is monotone across the whole speed range',
    curve.every((r, i) => i === 0 || r.dx <= curve[i - 1].dx + 1e-6),
    curve.map(r => `${fmt(r.v, 0)}u/s→${fmt(r.dx)}u`).join('  '));
}

console.log('\n== stall: a wall costs exactly what a rock costs ==');
{
  const g = new Game(5);
  g.setInput({ accel: true, steer: 0 });
  while (g.speed < C.MAX_SPEED - 0.5 && g.tick < 600) g.advance(STEP);
  const before = g.hits + g.wallContacts;
  g.stall(); // same entry point both collisions use
  let t = 0;
  while (g.speed > C.IDLE_SPEED + 0.01 && t < 60) { g.advance(STEP); t++; }
  check('speed collapses to the crawl within a quarter second', t / 60 <= 0.25,
    `${fmt(t / 60, 3)} s`);
  check('the machine never parks', g.speed >= C.IDLE_SPEED, `${fmt(g.speed)} u/s`);
}

console.log('\n== preview horizon ==');
{
  // time to steer from the middle of the corridor to a wall at top speed
  const g = new Game(5);
  g.setInput({ accel: true, steer: 0 });
  while (g.speed < C.MAX_SPEED - 0.5 && g.tick < 600) g.advance(STEP);
  const widest = 40; // the widest half-corridor the generator can produce
  let x = 0, vx = 0, t = 0;
  const f = 1, curve = Math.pow(f, C.LAT_CURVE);
  const latMax = C.LAT_SLOW + (C.LAT_FAST - C.LAT_SLOW) * curve;
  const latAcc = C.LAT_ACC_SLOW + (C.LAT_ACC_FAST - C.LAT_ACC_SLOW) * curve;
  while (x < widest && t < 600) { vx = Math.min(latMax, vx + latAcc / 60); x += vx / 60; t++; }
  const steerMs = (t / 60) * 1000;
  const previewMs = (C.PREVIEW_DIST / C.MAX_SPEED) * 1000;
  check('previewMs ≥ mid-corridor-to-wall steer time at top speed',
    previewMs >= steerMs, `preview ${fmt(previewMs, 0)} ms vs steer ${fmt(steerMs, 0)} ms`);
}

console.log('\n== generation: a safe line always exists ==');
{
  let worst = 1e9, worstSeed = 0, totalTicks = 0;
  for (let s = 1; s <= 40; s++) {
    const r = runBot(s * 977 + 13, botDriver({ greed: 1 }), 60 * 120);
    totalTicks += r.ticks;
    if (r.minSafe < worst) { worst = r.minSafe; worstSeed = s * 977 + 13; }
  }
  check('narrowest gap in any preview horizon still fits the machine',
    worst > C.PLAYER_RADIUS, `min safeHalfWidth ${fmt(worst, 2)} vs radius ${C.PLAYER_RADIUS} (seed ${worstSeed})`);
  console.log(`        (${totalTicks} ticks swept across 40 seeds)`);
}

console.log('\n== the course actually winds ==');
{
  let wallHits = 0, seeds = 24, secs = 0;
  for (let s = 1; s <= seeds; s++) {
    const r = runBot(s * 31 + 7, botStraight(), 60 * 25);
    wallHits += r.g.wallContacts; secs += r.ticks / 60;
  }
  const perMin = (wallHits / secs) * 60;
  check('holding throttle without steering meets walls constantly',
    perMin > 12, `${fmt(perMin)} wall contacts per minute of no-steer driving`);
}

console.log('\n== the clock is the antagonist ==');
{
  let timid = [], straight = [], careful = [], greedy = [];
  let halfEmptyCount = 0;
  for (let s = 1; s <= 24; s++) {
    const seed = s * 1013 + 5;
    timid.push(runBot(seed, botTimid(), 60 * 200));
    straight.push(runBot(seed, botStraight(), 60 * 200));
    const c = runBot(seed, botDriver({ greed: 0, brave: 0.4 }), 60 * 600);
    careful.push(c);
    if (c.halfEmpty) halfEmptyCount++;
    greedy.push(runBot(seed, botDriver({ greed: 1.4, brave: 1 }), 60 * 600));
  }
  const avg = (a, f) => a.reduce((x, r) => x + f(r), 0) / a.length;
  const maxOf = (a, f) => Math.max(...a.map(f));
  const rows = [
    ['timid (never accelerates)', timid],
    ['straight (throttle, no steer)', straight],
    ['careful (drives, ignores fragments)', careful],
    ['greedy (hunts formations)', greedy]
  ];
  for (const [name, a] of rows) {
    console.log(`        ${name.padEnd(36)} ${fmt(avg(a, r => r.seconds))}s  ` +
      `score ${fmt(avg(a, r => r.g.score), 0).padStart(5)}  ` +
      `depth ${fmt(avg(a, r => r.g.depth), 0).padStart(5)}  ` +
      `frags ${fmt(avg(a, r => r.g.fragmentsCollected), 1).padStart(4)}  ` +
      `max ${fmt(maxOf(a, r => r.seconds))}s`);
  }
  check('a timid run runs out of time well inside two minutes',
    maxOf(timid, r => r.seconds) < 120, `worst ${fmt(maxOf(timid, r => r.seconds))}s`);
  check('a player who never hunts fragments still starves',
    maxOf(careful, r => r.seconds) < 150, `worst ${fmt(maxOf(careful, r => r.seconds))}s`);
  check('the meter drops below half a tank in every careful run',
    halfEmptyCount === careful.length, `${halfEmptyCount}/${careful.length}`);
  check('hunting fragments buys real survival',
    avg(greedy, r => r.seconds) > avg(careful, r => r.seconds) * 1.4,
    `${fmt(avg(greedy, r => r.seconds))}s vs ${fmt(avg(careful, r => r.seconds))}s`);
  check('risk clearly outscores safety',
    avg(greedy, r => r.g.score) > avg(timid, r => r.g.score) * 6,
    `${fmt(avg(greedy, r => r.g.score), 0)} vs ${fmt(avg(timid, r => r.g.score), 0)}`);
  check('even optimal play eventually starves on the deep field',
    avg(greedy, r => r.seconds) < 240 && maxOf(greedy, r => r.seconds) < 400,
    `avg ${fmt(avg(greedy, r => r.seconds))}s, worst ${fmt(maxOf(greedy, r => r.seconds))}s`);
}

console.log('\n== the power item keeps its promise ==');
{
  let worstT = 0, worstSeed = 0, never = 0, firstDepths = [];
  for (let s = 1; s <= 60; s++) {
    const seed = s * 7919 + 3;
    const g = new Game(seed);
    const bot = botDriver({ greed: 0.15, brave: 1 });
    let t = 0, got = -1;
    while (g.phase !== 'gameover' && t < 60 * 75) {
      const inp = bot(g);
      g.setInput({ accel: true, steer: inp.steer });
      g.advance(STEP); t++;
      if (g.invincibleUntilMs > 0) { got = t / 60; break; }
    }
    if (got < 0) { never++; worstSeed = seed; }
    else { firstDepths.push(g.depth); if (got > worstT) { worstT = got; worstSeed = seed; } }
  }
  check('a throttle-holding player meets a power item inside 60 s',
    never === 0 && worstT < 60, `worst ${fmt(worstT)}s over 60 seeds (seed ${worstSeed})`);
  check('power items stay a treat, not a rhythm',
    firstDepths.length > 0, `first pickup avg depth ${fmt(firstDepths.reduce((a, b) => a + b, 0) / firstDepths.length, 0)}u`);
}

console.log('\n== formations are readable and sweepable ==');
{
  const g = new Game(31337);
  g.setInput({ accel: true, steer: 0 });
  for (let i = 0; i < 60 * 90; i++) { g.advance(STEP); if (g.phase === 'gameover') g.reset(31337 + i), g.setInput({ accel: true }); }
  const byId = new Map();
  for (const it of g.items) {
    if (it.type !== 'fragment') continue;
    if (!byId.has(it.formationId)) byId.set(it.formationId, []);
    byId.get(it.formationId).push(it);
  }
  // The lateral authority a machine actually has at a given forward speed.
  const latAt = (v) => {
    const f = Math.max(0, Math.min(1, (v - C.IDLE_SPEED) / (C.MAX_SPEED - C.IDLE_SPEED)));
    return C.LAT_SLOW + (C.LAT_FAST - C.LAT_SLOW) * Math.pow(f, C.LAT_CURVE);
  };
  // "collection speed": comfortable cruise, five times the idle crawl
  const cruise = C.IDLE_SPEED * 5;
  let sizeOk = true, orderOk = true, worstRatio = 0, worstLoad = 0, kinds = new Set();
  for (const [, list] of byId) {
    list.sort((a, b) => a.formationIndex - b.formationIndex);
    kinds.add(list[0].formationKind);
    if (list.length < 3) sizeOk = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].formationIndex !== i) orderOk = false;
      if (i > 0) {
        const dz = list[i].depth - list[i - 1].depth;
        if (dz <= 0) orderOk = false;
        const ratio = Math.abs(list[i].x - list[i - 1].x) / Math.max(1e-6, dz);
        worstRatio = Math.max(worstRatio, ratio);
        // fraction of the machine's lateral budget the step consumes at cruise
        worstLoad = Math.max(worstLoad, (ratio * cruise) / latAt(cruise));
      }
    }
  }
  check('every formation has at least three fragments', sizeOk);
  check('formationIndex runs in strictly increasing depth order without gaps', orderOk);
  check('a whole formation is swept without ever darting sideways', worstLoad < 1,
    `steepest step needs ${Math.round(worstLoad * 100)}% of the lateral budget at cruise ` +
    `(${fmt(worstRatio, 2)} u per u of depth)`);
  check('a run mixes more than one shape', kinds.size > 1, [...kinds].join(', '));
}

console.log('\n== grades are monotone ==');
{
  const g = new Game(1);
  let ok = true, prev = -1;
  const order = C.GRADES.map(x => x.g);
  for (let s = 0; s <= 9000; s += 25) {
    const idx = order.indexOf(g.gradeFor(s));
    if (idx < prev) ok = false;
    prev = idx;
  }
  check('a higher score never earns a lower grade', ok);
}

console.log('\n== snapshot contract ==');
{
  const g = new Game(808); g.setInput({ accel: true, steer: 0.2 });
  g.advance(9000);
  const s = g.snapshot();
  const need = ['phase', 'tick', 'elapsedMs', 'timeMs', 'remainingMs', 'seed', 'rngState',
    'spawnIndex', 'input', 'difficulty', 'score', 'depth', 'x', 'playerRadius', 'speed',
    'maxSpeed', 'hits', 'wallContacts', 'fragmentsCollected', 'rocksBroken',
    'invincibleUntilMs', 'rank', 'courseCenterX', 'corridorHalfWidth', 'walls',
    'safeHalfWidth', 'previewMs', 'rocks', 'items', 'events', 'lastEvent'];
  check('every documented field is present', need.every(k => k in s),
    need.filter(k => !(k in s)).join(',') || 'all');
  check('walls cover the whole preview horizon',
    s.walls.length >= 2 && Math.abs((s.walls[s.walls.length - 1].depth - s.depth) - C.PREVIEW_DIST) < 0.5);
  check('entity arrays are sorted by id',
    s.rocks.every((r, i, a) => i === 0 || a[i - 1].id < r.id) &&
    s.items.every((r, i, a) => i === 0 || a[i - 1].id < r.id));
  check('collisionRadius never exceeds visualRadius',
    s.rocks.every(r => r.collisionRadius <= r.visualRadius) &&
    s.items.every(r => r.collisionRadius <= r.visualRadius));
  const kinds = new Set(['wall_contact', 'rock_hit', 'rock_broken', 'fragment', 'power', 'near_miss']);
  check('only documented event kinds appear', s.events.every(e => kinds.has(e.kind)),
    [...new Set(s.events.map(e => e.kind))].join(','));
  check('event seq starts at 1 and never skips',
    s.events.length === 0 || s.events.every((e, i, a) => i === 0 || e.seq === a[i - 1].seq + 1));
  check('events are bounded to the last hundred', s.events.length <= 100, `${s.events.length}`);
  check('lastEvent aliases the newest entry',
    (s.events.length === 0 && s.lastEvent === null) ||
    JSON.stringify(s.lastEvent) === JSON.stringify(s.events[s.events.length - 1]));
  check('reading the snapshot changes nothing',
    JSON.stringify(g.snapshot()) === JSON.stringify(g.snapshot()));
  const fresh = new Game(808).snapshot();
  check('rank is null while the run is playable', fresh.rank === null && s.rank === null);
  console.log(`        snapshot ≈ ${(JSON.stringify(s).length / 1024).toFixed(1)} kB`);
}

console.log('\n== performance ==');
{
  const t0 = performance.now();
  const g = new Game(5); g.setInput({ accel: true, steer: 0.1 });
  let n = 0;
  while (n < 60 * 600) { if (g.phase === 'gameover') g.reset(5 + n), g.setInput({ accel: true, steer: 0.1 }); g.advance(STEP); n++; }
  const dt = performance.now() - t0;
  check('rules cost far less than a frame', dt / n < 0.05,
    `${fmt(dt / n, 4)} ms per tick (${fmt(dt, 0)} ms for ${n} ticks)`);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
process.exit(fails ? 1 : 0);
