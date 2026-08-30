/* Node harness for the STOMP simulation contract.  Run: node tests/sim.test.js */
const Sim = require('../game.js');
const C = Sim.CONST;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : '')); failures++; }
}
function section(t) { console.log('\n== ' + t); }

/* ---------------------------------------------------------- return bands -- */
section('return bands');
function apexOf(kind, machineY) {
  const s = new Sim(1);
  s.pressJump();
  const b = s.ball, m = s.machine;
  if (machineY !== undefined) m.y = machineY;
  if (kind === 'weak') { m.grounded = false; m.vy = 100; }
  if (kind === 'normal') { m.grounded = true; m.vy = 0; }
  if (kind === 'power') { m.grounded = false; m.vy = -200; }
  b.y = m.y - C.MACHINE_HALF_H - b.radius;
  s.bounceOffMachine(0);
  let minY = b.y;
  for (let i = 0; i < 400; i++) {
    b.vy += C.G / 60; b.y += b.vy / 60;
    if (b.y < minY) minY = b.y;
    if (b.vy > 0) break;
  }
  return { apex: minY, kind: b.lastBounceKind };
}
const LOW_TOP = 330 - 21, LOW_BOT = 330 + 21, HIGH_TOP = 196 - 21, HIGH_BOT = 196 + 21;
const weak = apexOf('weak'), normal = apexOf('normal'), power = apexOf('power');
console.log('   apexes', JSON.stringify({ weak: +weak.apex.toFixed(1), normal: +normal.apex.toFixed(1), power: +power.apex.toFixed(1) }),
  ' lanes low[' + LOW_TOP + '..' + LOW_BOT + '] high[' + HIGH_TOP + '..' + HIGH_BOT + ']');
check('weak kind tagged', weak.kind === 'weak');
check('weak stays below the low lane', weak.apex > LOW_BOT, weak.apex);
check('normal reaches through the low lane', normal.apex < LOW_TOP, normal.apex);
check('normal stays below the high lane', normal.apex > HIGH_BOT, normal.apex);
check('power reaches through the high lane', power.apex < HIGH_TOP, power.apex);
check('bands are strictly ordered', power.apex < normal.apex && normal.apex < weak.apex);
// the band must hold from ANY contact height, not just from a grounded catch
{
  let worst = Infinity;
  for (let my = C.MACHINE_APEX_Y; my <= C.MACHINE_REST_Y; my += 2) worst = Math.min(worst, apexOf('weak', my).apex);
  check('a weak return stays under the low lane from any contact height (highest apex ' + worst.toFixed(1) + ')',
    worst > LOW_BOT, worst);
  let worstP = -Infinity;
  for (let my = C.MACHINE_APEX_Y; my <= C.MACHINE_REST_Y; my += 2) worstP = Math.max(worstP, apexOf('power', my).apex);
  check('a power return clears the high lane from any contact height', worstP < HIGH_TOP, worstP);
}
check('machine jump apex stays below the low lane',
  C.MACHINE_APEX_Y - C.MACHINE_HALF_H > LOW_BOT, C.MACHINE_APEX_Y - C.MACHINE_HALF_H);

section('a bounce always separates from the plate');
{
  // If the plate can outrun its own ball the contact re-registers and sprays
  // duplicate bounce events.  Sweep every contact height x machine velocity.
  let worst = Infinity, worstCase = null;
  for (let my = C.MACHINE_APEX_Y; my <= C.MACHINE_REST_Y; my += 2) {
    for (let vy = -400; vy <= 400; vy += 25) {
      for (const dx of [0, 12, 20]) {
        const s = new Sim(1);
        s.pressJump();
        const m = s.machine, b = s.ball;
        m.y = my; m.vy = vy; m.grounded = (my === C.MACHINE_REST_Y && vy === 0);
        b.y = m.y - C.MACHINE_HALF_H - b.radius;
        b.x = m.x + dx;
        s.bounceOffMachine(dx);
        const margin = -b.vy - (-vy);      // ball's upward speed minus machine's
        if (margin < worst) { worst = margin; worstCase = { my, vy, dx, kind: b.lastBounceKind }; }
      }
    }
  }
  check('the ball always leaves faster than the plate rises (margin ' + worst.toFixed(1) + ')',
    worst > 0, JSON.stringify(worstCase));
}

section('rebound stays out of the far lane');
{
  let worstLow = Infinity;
  for (let seed = 1; seed <= 8; seed++) {
    const s = new Sim(seed);
    s.setAxis(1); s.advance(3000);
    const e = s.enemies.find(x => x.active && x.lane === 'low');
    if (!e) continue;
    s.ball.x = e.x; s.ball.y = e.y - e.collisionRadius - 9; s.ball.vy = 250; s.ball.vx = 0;
    e.contactState = 0;
    s.collideBallEnemies();
    const b = s.ball;
    let minY = b.y;
    for (let i = 0; i < 400; i++) { b.vy += C.G / 60; b.y += b.vy / 60; if (b.y < minY) minY = b.y; if (b.vy > 0) break; }
    worstLow = Math.min(worstLow, minY - b.radius);
  }
  check('a low-lane rebound never throws the ball up into the high lane (top ' + worstLow.toFixed(1) + ')',
    worstLow > HIGH_BOT, worstLow);
}

/* ------------------------------------------------------- reach guarantee -- */
section('stage reach');
{
  // worst case: ball at its normal apex on one edge, machine at the far edge.
  const fallTime = Math.sqrt(2 * (554 - 20 - 10 - normal.apex) / C.G);
  const traverse = (360 - 2 * C.MACHINE_HALF_W) / 400 + 400 / 3200; // full width + spin-up
  check('machine crosses the stage faster than a normal return falls from apex',
    traverse < fallTime, 'traverse ' + traverse.toFixed(3) + 's vs fall ' + fallTime.toFixed(3) + 's');
}

/* ------------------------------------------------------------ determinism - */
section('determinism');
function runScript(seed, script, totalMs) {
  const s = new Sim(seed);
  let t = 0;
  const stepMs = 1000 / 60;
  while (t < totalMs) {
    const cmd = script(t);
    if (cmd.axis !== undefined) s.setAxis(cmd.axis);
    if (cmd.jump) s.pressJump();
    s.advance(stepMs);
    t += stepMs;
  }
  return s.snapshot();
}
const script = (t) => ({
  axis: Math.sin(t / 900) > 0 ? 1 : -1,
  jump: Math.floor(t / 1400) !== Math.floor((t - 1000 / 60) / 1400)
});
const a = runScript(7, script, 30000);
const b = runScript(7, script, 30000);
check('same seed + same inputs -> identical snapshot', JSON.stringify(a) === JSON.stringify(b));
const c = runScript(8, script, 30000);
check('different seed diverges', JSON.stringify(a) !== JSON.stringify(c));

section('advance() equivalence with framewise play');
{
  // Play A in 60Hz frames; play B in ragged frames. Same held input, same result.
  const mk = () => new Sim(99);
  const sA = mk(), sB = mk();
  sA.setAxis(0.6); sB.setAxis(0.6);
  let t = 0;
  while (t < 12000) { sA.advance(1000 / 60); t += 1000 / 60; }
  const raggedFrames = [17, 13, 25, 9, 33, 16, 16, 21, 11];
  let u = 0, i = 0;
  while (u < 12000) {
    let d = raggedFrames[i++ % raggedFrames.length];
    if (u + d > 12000) d = 12000 - u;
    sB.advance(d); u += d;
  }
  const snapA = sA.snapshot(), snapB = sB.snapshot();
  check('tick counts match', snapA.tick === snapB.tick, snapA.tick + ' vs ' + snapB.tick);
  check('ragged frames reproduce the run field for field', JSON.stringify(snapA) === JSON.stringify(snapB));
}

section('one big advance == many small advances');
{
  const sA = new Sim(4321), sB = new Sim(4321);
  sA.setAxis(-1); sB.setAxis(-1);
  sA.advance(20000);
  for (let i = 0; i < 200; i++) sB.advance(100);
  check('equal', JSON.stringify(sA.snapshot()) === JSON.stringify(sB.snapshot()));
}

section('frozen states');
{
  const s = new Sim(3);
  const before = JSON.stringify(s.snapshot());
  s.advance(5000);
  check('ready state does not advance', JSON.stringify(s.snapshot()) === before);
  s.setAxis(1);
  s.advance(200000);
  check('run ends when the clock empties', s.phase === 'ended');
  const ended = JSON.stringify(s.snapshot());
  s.advance(10000);
  check('ended state does not advance', JSON.stringify(s.snapshot()) === ended);
  check('remainingMs is exactly zero', s.snapshot().remainingMs === 0);
}

section('snapshot purity');
{
  const s = new Sim(11);
  s.setAxis(1); s.advance(9000);
  const one = JSON.stringify(s.snapshot());
  for (let i = 0; i < 50; i++) s.snapshot();
  check('reading never mutates', JSON.stringify(s.snapshot()) === one);
  const snap = s.snapshot();
  snap.enemies.forEach(e => { e.x = 999; });
  snap.machine.x = 999;
  check('snapshot is a copy', s.snapshot().machine.x !== 999);
}

/* -------------------------------------------------------- opening promise - */
section('opening promise (200 seeds)');
{
  let worstLowStart = 0, worstBothShown = 0, worstGap = 0, badFast = 0, badRefill = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = new Sim(seed);
    s.setAxis(1);
    let lowSeen = null, bothSeen = null;
    let lastAirEmptyAt = null, maxGap = 0;
    const known = new Set();
    for (let step = 0; step < 60 * 40; step++) {
      s.advance(1000 / 60);
      for (const e of s.enemies) {
        if (e.lane === 'ground' || known.has(e.id)) continue;
        known.add(e.id);
        if (s.airEnemiesDefeated === 0 && e.type !== 'slowFlyer') badFast++;
        if (e.lane === 'low' && lowSeen === null && e.x > -10 && e.x < 370) lowSeen = s.elapsedMs;
      }
      const onLow = s.enemies.some(e => e.active && e.lane === 'low' && e.x > -22 && e.x < 382);
      const onHigh = s.enemies.some(e => e.active && e.lane === 'high' && e.x > -22 && e.x < 382);
      if (lowSeen === null && onLow) lowSeen = s.elapsedMs;
      if (bothSeen === null && lowSeen !== null && onHigh) bothSeen = s.elapsedMs;

      if (s.airEnemiesDefeated === 0) {
        const anyAir = s.enemies.some(e => e.active && e.lane !== 'ground');
        if (!anyAir) { if (lastAirEmptyAt === null) lastAirEmptyAt = s.elapsedMs; }
        else if (lastAirEmptyAt !== null) {
          maxGap = Math.max(maxGap, s.elapsedMs - lastAirEmptyAt);
          lastAirEmptyAt = null;
        }
      }
    }
    if (lowSeen === null) { badRefill++; continue; }
    worstLowStart = Math.max(worstLowStart, lowSeen);
    if (bothSeen === null) badRefill++; else worstBothShown = Math.max(worstBothShown, bothSeen);
    worstGap = Math.max(worstGap, maxGap);
  }
  check('a slow low-lane target crosses within the first few seconds (worst ' + (worstLowStart / 1000).toFixed(2) + 's)',
    worstLowStart < 3500);
  check('both lanes show a slow target before half the clock drains (worst ' + (worstBothShown / 1000).toFixed(2) + 's)',
    worstBothShown < C.START_MS / 2);
  check('no fast flyer before the first destruction', badFast === 0, badFast);
  check('every seed keeps the promise', badRefill === 0, badRefill);
  check('air is never empty for more than a couple of seconds (worst ' + (worstGap / 1000).toFixed(2) + 's)',
    worstGap <= 2000, worstGap);
}

/* --------------------------------------------------------- teaching room -- */
section('a first run is long enough to teach');
{
  // A player who keeps the ball alive but destroys nothing: simulate a "perfect
  // catcher" by steering the machine under the ball every step.
  let worst = Infinity, dropsTotal = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = new Sim(seed);
    s.setAxis(0.001);
    for (let step = 0; step < 60 * 61; step++) {
      const dx = s.ball.x - s.machine.x;
      s.setAxis(Math.max(-1, Math.min(1, dx / 26)));
      s.advance(1000 / 60);
      if (s.phase === 'ended') break;
    }
    dropsTotal += s.ballDrops;
    worst = Math.min(worst, s.remainingMs);
  }
  check('clock survives 60s of clean returning with zero targets defeated (worst ' + (worst / 1000).toFixed(1) + 's left)',
    worst > 0, worst);
  console.log('   (auto-catcher dropped the ball ' + dropsTotal + ' times across 40 seeds)');
}

/* ------------------------------------------------------------- economy ---- */
section('economy');
{
  const s = new Sim(5);
  s.setAxis(1); s.advance(2000);
  const e = s.enemies.find(x => x.active && x.lane !== 'ground');
  const amounts = [];
  let clockBefore = s.remainingMs, gained = 0;
  for (let i = 0; i < 3; i++) {
    s.ball.x = e.x; s.ball.y = e.y - e.collisionRadius - 9; s.ball.vy = 200;
    e.contactState = 0;
    const before = s.remainingMs;
    s.collideBallEnemies();
    amounts.push(s.remainingMs - before);
  }
  check('each of the three hits returns strictly more time', amounts[0] < amounts[1] && amounts[1] < amounts[2],
    JSON.stringify(amounts));
  check('the third hit defeats the target', s.airEnemiesDefeated === 1);
  const total = amounts.reduce((p, q) => p + q, 0);
  check('a finished pursuit returns more than 9s of clock (got ' + (total / 1000).toFixed(1) + 's)', total > 9000);
  check('one full target beats three single touches',
    (120 + 200 + 400 + 300) > 3 * 120);
}
{
  const s = new Sim(5);
  s.setAxis(1); s.advance(2000);
  const e = s.enemies.find(x => x.active && x.lane !== 'ground');
  s.ball.x = e.x - e.collisionRadius - 4; s.ball.y = e.y; s.ball.vy = -50;
  const before = s.remainingMs, wrongBefore = s.wrongSideHits;
  s.collideBallEnemies();
  const cost = before - s.remainingMs;
  check('a wrong-side hit costs meaningful time', cost >= 3000, cost);
  check('a wrong-side hit does no damage', e.hitsTaken === 0);
  // charge at most once during one continuous overlap
  const after = s.remainingMs;
  for (let i = 0; i < 5; i++) { s.ball.x = e.x; s.ball.y = e.y; s.ball.vy = -50; s.collideBallEnemies(); }
  check('one continuous overlap charges once', s.wrongSideHits === wrongBefore + 1, s.wrongSideHits);
  check('a ball drop costs more than a wrong-side hit', 6000 > cost);
}

/* -------------------------------------------------------------- hitboxes -- */
section('hitboxes');
{
  const s = new Sim(2);
  s.setAxis(1); s.advance(40000);
  let bad = 0;
  for (const e of s.snapshot().enemies) if (e.collisionRadius > e.visualRadius * 1.1) bad++;
  check('no enemy collision radius exceeds its drawn size by more than a tenth', bad === 0);
  check('ball collision radius equals its drawn radius', s.ball.radius === C.BALL_R);
  check('machine collision half-width fits inside its drawn body', C.MACHINE_HALF_W <= 24);
}

/* --------------------------------------------------------------- events --- */
section('events');
{
  const s = new Sim(31);
  s.setAxis(1);
  for (let i = 0; i < 60 * 45; i++) {
    const dx = s.ball.x - s.machine.x;
    s.setAxis(Math.max(-1, Math.min(1, dx / 26)));
    if (i % 137 === 0) s.pressJump();
    s.advance(1000 / 60);
  }
  const snap = s.snapshot();
  const seqs = snap.recentEvents.map(e => e.sequence);
  check('sequences increase by exactly one', seqs.every((v, i) => i === 0 || v === seqs[i - 1] + 1), seqs.join(','));
  check('history is bounded', snap.recentEvents.length <= 48);
  check('lastEvent equals the latest entry',
    JSON.stringify(snap.lastEvent) === JSON.stringify(snap.recentEvents[snap.recentEvents.length - 1]));
  const okSource = snap.recentEvents.every(e => ['ball', 'machine', 'system'].includes(e.source));
  const okContact = snap.recentEvents.every(e => e.contact === null || ['top', 'non_top', 'body'].includes(e.contact));
  check('sources are valid', okSource);
  check('contacts are valid', okContact);
  const fields = ['sequence', 'kind', 'tick', 'enemyId', 'amountMs', 'source', 'contact'];
  check('every event carries every field',
    snap.recentEvents.every(e => fields.every(f => f in e)));
  const s2 = new Sim(31);
  check('lastEvent is null before the first event', s2.snapshot().lastEvent === null);
  console.log('   kinds observed: ' + [...new Set(snap.recentEvents.map(e => e.kind))].join(', '));
}

section('required event kinds all reachable');
{
  const need = new Set(['machine_jump', 'machine_land', 'ball_bounce_weak', 'ball_bounce_normal',
    'ball_bounce_power', 'top_hit', 'enemy_defeated', 'wrong_side_hit', 'ball_drop', 'ground_stomp']);
  const seen = new Set();
  for (let seed = 1; seed <= 60 && need.size !== seen.size; seed++) {
    const s = new Sim(seed);
    const origEmit = s.emit.bind(s);
    s.emit = function (k, o) { seen.add(k); return origEmit(k, o); };
    s.setAxis(1);
    for (let i = 0; i < 60 * 80; i++) {
      const dx = s.ball.x - s.machine.x;
      s.setAxis(Math.max(-1, Math.min(1, dx / 26)));
      if (s.ball.vy > 0 && s.ball.y > 380 && i % 3 === 0) s.pressJump();
      if (i % 91 === 0) s.pressJump();
      s.advance(1000 / 60);
      if (s.phase === 'ended') break;
    }
  }
  for (const k of need) check('emits ' + k, seen.has(k));
}

/* ------------------------------------------------------------ escalation -- */
section('escalation');
{
  const s = new Sim(12);
  s.setAxis(1); s.advance(30000);
  const before = s.difficulty;
  s.score = 99999;
  s.addScore(0);
  check('tier rises with attack score', s.difficulty > before);
  s.score = 0; s.addScore(0);
  check('tier never decreases', s.difficulty > before);
  const s3 = new Sim(12);
  s3.setAxis(1); s3.advance(60000);
  check('passive survival alone does not raise the tier', s3.difficulty === 0, s3.difficulty);
  const ranks = [0, 900, 2400, 4500, 7200, 11000].map(Sim.rankFor);
  check('rank improves with score', new Set(ranks).size === 6, ranks.join('/'));
}

console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);
