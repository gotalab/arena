// Dev-only rules + promise audit. Not part of the shipped game.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, console, JSON, Object, Array, String, Number, isFinite };
vm.createContext(sandbox);
for (const f of ['js/rng.js', 'js/generator.js', 'js/game.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const S = sandbox.window.SHOAL;
const G = S.game;

let failures = 0;
function check(name, cond, extra) {
  if (!cond) { failures++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t); }

/* ------------------------------------------------- visible-information view */

// Rebuilds what a reader can legitimately know from a snapshot, then drives
// the deduction engine to a fixpoint. Pennants are beliefs, not evidence, so
// they are deliberately treated as plain covered shells here.
function analyze(snap) {
  const w = snap.gridWidth, h = snap.gridHeight, n = w * h;
  const open = new Uint8Array(n);
  const val = new Int8Array(n);
  const known = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = snap.rows[y][x];
      if (ch >= '0' && ch <= '8') { open[y * w + x] = 1; val[y * w + x] = ch.charCodeAt(0) - 48; }
    }
  }
  // The auditor reasons strictly harder than the generator's solver, so a
  // pass here is a genuine statement about the position, not about the cap.
  const opts = { maxCells: 28, budget: 8000000 };
  for (let iter = 0; iter < n + 4; iter++) {
    const res = S.gen.deduce(w, h, open, val, known, snap.urchinsTotal, opts);
    const safe = res.safe.filter((c) => !open[c] && !known[c]);
    if (safe.length) return { safe, mines: res.mines.filter((c) => !open[c]), open, val };
    let progress = false;
    for (const m of res.mines) if (!known[m] && !open[m]) { known[m] = 1; progress = true; }
    if (!progress) break;
  }
  const mines = [];
  for (let i = 0; i < n; i++) if (known[i]) mines.push(i);
  return { safe: [], mines, open, val };
}

function provablySafe(snap) { return analyze(snap).safe; }

/* ------------------------------------------------------------ shape + rules */

section('snapshot shape and initial state');
let s = G.reset('shape-seed');
s = G.snapshot();
check('phase ready', s.phase === 'ready', s.phase);
check('tick zero', s.tick === 0 && s.elapsedMs === 0);
check('revision zero', s.revision === 0);
check('pool 1', s.pool === 1);
check('rows sized', s.rows.length === s.gridHeight && s.rows.every((r) => r.length === s.gridWidth));
check('rows all covered', s.rows.every((r) => /^#+$/.test(r)));
check('urchinsLeft consistent', s.urchinsLeft === s.urchinsTotal - s.flagsPlaced);
check('tide full', s.tideFraction === 1);
check('rank null while playable', s.rank === null);
check('ladder present', Array.isArray(s.rankLadder) && s.rankLadder.length >= 3);
check('events empty', s.events.length === 0 && s.lastEvent === null);
check('stungAt null', s.stungAt === null);
check('snapshot frozen', Object.isFrozen(s) && Object.isFrozen(s.rows));

section('clock frozen while ready');
G.advance(5000);
check('advance does nothing in ready', G.snapshot().tick === 0);

section('illegal actions are rejected without changing state');
const before = G.snapshot();
const illegal = [
  { type: 'open', x: -1, y: 0 },
  { type: 'open', x: 999, y: 0 },
  { type: 'unflag', x: 0, y: 0 },
  { type: 'sweep', x: 0, y: 0 },
  { type: 'nonsense', x: 0, y: 0 },
  { type: 'open', x: 1.5, y: 0 },
  null
];
for (const a of illegal) {
  const r = G.act(a);
  check('rejects ' + JSON.stringify(a), r.ok === false && !!r.error && !!r.error.code);
}
const after = G.snapshot();
check('revision untouched by rejects', after.revision === before.revision);
check('rows untouched by rejects', after.rows.join('') === before.rows.join(''));

section('first turn is free and generous');
for (let trial = 0; trial < 40; trial++) {
  G.reset('generous-' + trial);
  const snap0 = G.snapshot();
  const x = trial % snap0.gridWidth;
  const y = (trial * 7) % snap0.gridHeight;
  const r = G.act({ type: 'open', x, y });
  const snap1 = G.snapshot();
  check('first turn accepted', r.ok === true);
  check('first turn opens quiet water', snap1.rows[y][x] === '0', `seed generous-${trial} at ${x},${y} -> ${snap1.rows[y][x]}`);
  check('first turn ripples', snap1.pearls > 1);
  check('first turn leaves a pool to deduce', snap1.pool === 1 && /#/.test(snap1.rows.join('')));
  check('phase becomes playing', snap1.phase === 'playing');
  check('revision is 1', snap1.revision === 1);
}

section('flag / unflag bookkeeping');
G.reset('flags');
G.act({ type: 'open', x: 2, y: 2 });
let sf = G.snapshot();
let covered = null;
for (let y = 0; y < sf.gridHeight && !covered; y++) {
  for (let x = 0; x < sf.gridWidth; x++) if (sf.rows[y][x] === '#') { covered = { x, y }; break; }
}
check('flag accepted', G.act({ type: 'flag', x: covered.x, y: covered.y }).ok === true);
sf = G.snapshot();
check('flag shows F', sf.rows[covered.y][covered.x] === 'F');
check('flagsPlaced 1', sf.flagsPlaced === 1 && sf.urchinsLeft === sf.urchinsTotal - 1);
check('cannot open a pennanted shell', G.act({ type: 'open', x: covered.x, y: covered.y }).ok === false);
check('cannot double-flag', G.act({ type: 'flag', x: covered.x, y: covered.y }).ok === false);
check('unflag accepted', G.act({ type: 'unflag', x: covered.x, y: covered.y }).ok === true);
check('flagsPlaced back to 0', G.snapshot().flagsPlaced === 0);

section('tide drains only while a pool is being played');
G.reset('tide');
G.advance(10000);
check('no drain before first turn', G.snapshot().tideFraction === 1);
G.act({ type: 'open', x: 2, y: 3 });
G.advance(6000);
const td = G.snapshot();
check('tick advanced 360', td.tick === 360, 'tick=' + td.tick);
check('elapsedMs matches tick', Math.abs(td.elapsedMs - 6000) < 0.5, 'elapsed=' + td.elapsedMs);
check('tide dropped', td.tideFraction < 1 && td.tideFraction > 0, 'tide=' + td.tideFraction);
const beforeIdle = G.snapshot();
G.advance(10 * 60 * 1000);
const afterIdle = G.snapshot();
check('tide floors at zero', afterIdle.tideFraction === 0);
check('tide never ends the run', afterIdle.phase === 'playing');
check('nothing pays for idle time', afterIdle.pearls === beforeIdle.pearls);
check('idling never touches the board', afterIdle.rows.join('') === beforeIdle.rows.join(''));
check('idling never counts as a move', afterIdle.moves === beforeIdle.moves && afterIdle.revision === beforeIdle.revision);

section('an empty tide pays no clear bonus');
// Clear pool 1 twice from the same first turn: once at once, once after the
// tide has run dry. The shells pay the same; only the bonus differs.
function clearPoolOne(seed, drainMs) {
  G.reset(seed);
  G.act({ type: 'open', x: 2, y: 3 });
  const started = G.snapshot();
  // How many shells pool 1 pays for, fixed the moment its board is fixed.
  const shells = started.gridWidth * started.gridHeight - started.urchinsTotal;
  if (drainMs) G.advance(drainMs);
  for (let guard = 0; guard < 400; guard++) {
    const s = G.snapshot();
    if (s.phase === 'ended') return null;
    if (s.pool !== 1) return { shells, pearls: s.pearls, pool: s.pool, tide: 0 };
    const t = analyze(s).safe.find((c) => s.rows[Math.floor(c / s.gridWidth)][c % s.gridWidth] === '#');
    if (t === undefined) return null;
    G.act({ type: 'open', x: t % s.gridWidth, y: Math.floor(t / s.gridWidth) });
  }
  return null;
}
const fast = clearPoolOne('bonus', 0);
const dry = clearPoolOne('bonus', 60 * 60 * 1000);
if (fast && dry) {
  check('a full tide pays a real bonus', fast.pearls > fast.shells, `${fast.pearls} vs ${fast.shells} shells`);
  check('an empty tide pays no bonus', dry.pearls === dry.shells, `${dry.pearls} vs ${dry.shells} shells`);
  check('the dry run still banked its shells', dry.pearls > 0 && dry.pool === 2);
  check('the same board pays the same shells', fast.shells === dry.shells);
} else {
  check('bonus comparison ran', false, 'could not clear pool 1 by logic alone');
}

section('advance in slices equals advance in one call');
G.reset('slices');
G.act({ type: 'open', x: 3, y: 4 });
for (let i = 0; i < 120; i++) G.advance(25);
const sliced = G.snapshot();
G.reset('slices');
G.act({ type: 'open', x: 3, y: 4 });
G.advance(3000);
const whole = G.snapshot();
check('sliced clock equals whole clock', sliced.tick === whole.tick && sliced.tideFraction === whole.tideFraction,
  `${sliced.tick} vs ${whole.tick}`);

/* --------------------------------------------------- the water never lies */

section('promise audit: a certain move always exists');
let auditedStates = 0, poolsCleared = 0, stings = 0, sweepsUsed = 0;
for (let trial = 0; trial < 24; trial++) {
  G.reset('audit-' + trial);
  let rand = S.rng.mulberry32(S.rng.hashSeed('play-' + trial));
  let guard = 0;
  while (guard++ < 4000) {
    let snap = G.snapshot();
    if (snap.phase === 'ended') { stings++; break; }
    if (poolsCleared >= 60 && snap.pool > 4) break;
    if (!snap.firstTurnDone) {
      const x = Math.floor(rand() * snap.gridWidth);
      const y = Math.floor(rand() * snap.gridHeight);
      G.act({ type: 'open', x, y });
      continue;
    }
    const res = analyze(snap);
    const safe = res.safe;
    check('a provably safe shell exists', safe.length > 0,
      `seed audit-${trial} pool ${snap.pool} rev ${snap.revision}\n` + snap.rows.join('\n'));
    auditedStates++;
    if (!safe.length) break;

    // Pennant everything provable, then prefer a sweep, else turn a safe shell.
    const w = snap.gridWidth;
    const open = res.open;
    const val = res.val;
    let acted = false;
    for (const cell of res.mines) {
      if (snap.rows[Math.floor(cell / w)][cell % w] === '#') {
        const r = G.act({ type: 'flag', x: cell % w, y: Math.floor(cell / w) });
        check('deduced pennant accepted', r.ok === true);
        acted = true;
        break;
      }
    }
    if (acted) continue;

    if (rand() < 0.45) {
      // Try a sweep off a satisfied number.
      const nb = S.gen.neighbors(w, snap.gridHeight);
      for (let i = 0; i < open.length; i++) {
        if (!open[i] || val[i] === 0) continue;
        let flags = 0, cov = 0;
        for (const m of nb[i]) {
          const ch = snap.rows[Math.floor(m / w)][m % w];
          if (ch === 'F') flags++;
          else if (ch === '#') cov++;
        }
        if (flags === val[i] && cov > 0) {
          const r = G.act({ type: 'sweep', x: i % w, y: Math.floor(i / w) });
          check('satisfied sweep accepted', r.ok === true, JSON.stringify(r.error));
          sweepsUsed++;
          acted = true;
          break;
        }
      }
    }
    if (acted) {
      check('sweep on proven pennants never stings', G.snapshot().phase !== 'ended');
      continue;
    }

    const target = safe.find((c) => snap.rows[Math.floor(c / w)][c % w] === '#');
    if (target === undefined) {
      // Only pennanted shells are provable; lift one, as a player would.
      const c = safe[0];
      G.act({ type: 'unflag', x: c % w, y: Math.floor(c / w) });
      continue;
    }
    const rr = G.act({ type: 'open', x: target % w, y: Math.floor(target / w) });
    check('proven turn accepted', rr.ok === true);
    const post = G.snapshot();
    check('a proven turn never stings', post.phase !== 'ended',
      `seed audit-${trial}\n` + post.rows.join('\n'));
    if (post.phase === 'ended') break;
    if (post.pool > snap.pool) poolsCleared++;
    G.advance(700);
  }
}
console.log(`audited ${auditedStates} positions, cleared ${poolsCleared} pools, ${sweepsUsed} sweeps, ${stings} stings`);
check('logic-only play never stings', stings === 0);
check('audit reached deeper pools', poolsCleared >= 24, 'cleared=' + poolsCleared);

/* ----------------------------------------------------------- pool clearing */

section('pool clear flows into a bigger pool');
G.reset('clear-flow');
let cleared = false;
{
  let guard = 0;
  G.act({ type: 'open', x: 2, y: 2 });
  while (guard++ < 500) {
    const snap = G.snapshot();
    if (snap.pool > 1) { cleared = true; break; }
    const safe = provablySafe(snap);
    if (!safe.length) break;
    const w = snap.gridWidth;
    const c = safe.find((cc) => snap.rows[Math.floor(cc / w)][cc % w] === '#');
    if (c === undefined) break;
    G.act({ type: 'open', x: c % w, y: Math.floor(c / w) });
  }
}
check('pool 1 cleared', cleared);
if (cleared) {
  const s2 = G.snapshot();
  check('pool 2 board is bigger', s2.gridWidth * s2.gridHeight > 6 * 9);
  check('pool 2 has more urchins', s2.urchinsTotal > 7);
  check('pool 2 starts covered', s2.rows.every((r) => /^[#F]+$/.test(r)));
  check('pool 2 tide is full', s2.tideFraction === 1 && s2.firstTurnDone === false);
  check('clear paid a bonus', s2.pearls > 47);
  const ev = s2.events.filter((e) => e.kind === 'pool_clear');
  check('pool_clear event recorded', ev.length === 1 && ev[0].pool === 1);
  check('phase still playing between pools', s2.phase === 'playing');
}

/* ------------------------------------------------------------- post-mortem */

section('sting post-mortem');
G.reset('sting-seed');
G.act({ type: 'open', x: 3, y: 4 });
{
  // Find an urchin the honest way: try covered shells until one stings.
  let snap = G.snapshot();
  const w = snap.gridWidth;
  // pennant one covered shell first so the ceremony can grade it
  let firstCovered = null;
  for (let i = 0; i < w * snap.gridHeight && !firstCovered; i++) {
    if (snap.rows[Math.floor(i / w)][i % w] === '#') firstCovered = i;
  }
  G.act({ type: 'flag', x: firstCovered % w, y: Math.floor(firstCovered / w) });
  let guard = 0;
  while (G.snapshot().phase !== 'ended' && guard++ < 400) {
    snap = G.snapshot();
    let cell = null;
    for (let i = 0; i < w * snap.gridHeight; i++) {
      if (snap.rows[Math.floor(i / w)][i % w] === '#') { cell = i; break; }
    }
    if (cell === null) break;
    G.act({ type: 'open', x: cell % w, y: Math.floor(cell / w) });
  }
  const end = G.snapshot();
  check('run ended', end.phase === 'ended');
  check('stungAt recorded', end.stungAt && end.rows[end.stungAt.y][end.stungAt.x] === 'X');
  const flat = end.rows.join('');
  const revealed = (flat.match(/[*X+]/g) || []).length;
  check('every urchin accounted for', revealed === end.urchinsTotal, `${revealed} vs ${end.urchinsTotal}`);
  check('pennants graded', /[+-]/.test(flat) || end.flagsPlaced === 0);
  check('rank awarded', typeof end.rank === 'string' && end.rankLadder.indexOf(end.rank) >= 0);
  check('sessionBest at least pearls', end.sessionBest >= end.pearls);
  const kinds = end.events.map((e) => e.kind);
  check('sting then run_end', kinds[kinds.length - 2] === 'sting' && kinds[kinds.length - 1] === 'run_end', kinds.slice(-3).join(','));
  check('no actions after the run ends', G.act({ type: 'open', x: 0, y: 0 }).ok === false);
  check('clock frozen after end', (G.advance(4000), G.snapshot().tick === end.tick));
  check('revision frozen after end', G.snapshot().revision === end.revision);
}

section('rank ladder is monotone');
{
  let last = -1, ok = true;
  for (let p = 0; p <= 4000; p += 7) {
    const idx = G.RANK_LADDER.indexOf(G.rankFor(p));
    if (idx < last) ok = false;
    last = Math.max(last, idx);
  }
  check('more pearls never lowers the grade', ok);
  check('lowest grade at zero', G.rankFor(0) === G.RANK_LADDER[0]);
  check('top grade reachable', G.rankFor(999999) === G.RANK_LADDER[G.RANK_LADDER.length - 1]);
}

/* ----------------------------------------------------------- determinism */

section('determinism');
function scriptedRun(seed) {
  G.reset(seed);
  const rand = S.rng.mulberry32(S.rng.hashSeed('script-' + seed));
  const trace = [];
  G.act({ type: 'open', x: 3, y: 5 });
  for (let i = 0; i < 60; i++) {
    const snap = G.snapshot();
    if (snap.phase === 'ended') break;
    const w = snap.gridWidth;
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * snap.gridHeight);
    const roll = rand();
    G.act({ type: roll < 0.2 ? 'flag' : roll < 0.3 ? 'unflag' : roll < 0.85 ? 'open' : 'sweep', x, y });
    G.advance(250);
    trace.push(JSON.stringify(G.snapshot()));
  }
  return trace;
}
{
  const a = scriptedRun('determinism-1');
  const b = scriptedRun('determinism-1');
  let mismatch = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      // attempt is the one documented session-scoped exception
      const pa = JSON.parse(a[i]), pb = JSON.parse(b[i]);
      delete pa.attempt; delete pb.attempt;
      delete pa.sessionBest; delete pb.sessionBest;
      if (JSON.stringify(pa) !== JSON.stringify(pb)) { mismatch = i; break; }
    }
  }
  check('same seed and actions replay identically', mismatch === -1, 'first mismatch at step ' + mismatch);
  const c = scriptedRun('determinism-2');
  check('different seeds diverge', JSON.stringify(c) !== JSON.stringify(a));
}

section('attempt and sessionBest are the only session carry-over');
{
  const first = G.snapshot().attempt;
  G.restart();
  check('restart bumps attempt', G.snapshot().attempt === first + 1);
  check('restart clears the board', G.snapshot().revision === 0 && G.snapshot().pool === 1);
  check('restart keeps the seed', G.snapshot().seed === 'determinism-2');
  check('restart empties the timeline', G.snapshot().events.length === 0);
  check('sessionBest survives restart', G.snapshot().sessionBest >= 0);
}

section('event log');
{
  G.reset('events');
  G.act({ type: 'open', x: 2, y: 2 });
  const snap = G.snapshot();
  check('seq starts at 1', snap.events[0].seq === 1);
  check('open carries opened', snap.events[0].kind === 'open' && snap.events[0].opened > 0);
  check('lastEvent aliases newest', snap.lastEvent.seq === snap.events[snap.events.length - 1].seq);
  let n = 0;
  while (n++ < 260 && G.snapshot().phase !== 'ended') {
    const sn = G.snapshot();
    const w = sn.gridWidth;
    let c = null;
    for (let i = 0; i < w * sn.gridHeight; i++) if (sn.rows[Math.floor(i / w)][i % w] === '#') { c = i; break; }
    if (c === null) break;
    G.act({ type: 'flag', x: c % w, y: Math.floor(c / w) });
    G.act({ type: 'unflag', x: c % w, y: Math.floor(c / w) });
  }
  const big = G.snapshot();
  check('event log is bounded', big.events.length <= 200, 'len=' + big.events.length);
  check('seq keeps counting past the cap', big.events[big.events.length - 1].seq > 200);
  check('seq is contiguous', big.events.every((e, i) => i === 0 || e.seq === big.events[i - 1].seq + 1));
}

console.log(failures === 0 ? '\nALL RULES TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
