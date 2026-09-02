// Dev-only economy probe: how the tide prices hesitation.
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

function analyze(snap, known) {
  const w = snap.gridWidth, h = snap.gridHeight, n = w * h;
  const open = new Uint8Array(n), val = new Int8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = snap.rows[y][x];
    if (ch >= '0' && ch <= '8') { open[y * w + x] = 1; val[y * w + x] = ch.charCodeAt(0) - 48; }
  }
  for (let it = 0; it < n + 4; it++) {
    const r = S.gen.deduce(w, h, open, val, known, snap.urchinsTotal, { maxCells: 26, budget: 4000000 });
    const safe = r.safe.filter((c) => !open[c] && !known[c]);
    if (safe.length) return { safe, mines: r.mines.filter((c) => !open[c] && !known[c]), open, val };
    let prog = false;
    for (const m of r.mines) if (!known[m] && !open[m]) { known[m] = 1; prog = true; }
    if (!prog) break;
  }
  return { safe: [], mines: [], open, val };
}

// `flagRate` is how often the player bothers to plant a pennant before turning;
// hasty players lean on sweeps, careful players pennant everything.
function playRun(seed, msPerMove, useSweeps, maxPool) {
  G.reset(seed);
  const perPool = [];
  let known = null;
  let guard = 0;
  let poolMoves = 0;
  while (guard++ < 6000) {
    const s = G.snapshot();
    if (s.phase === 'ended') break;
    if (s.pool > maxPool) break;
    if (!s.firstTurnDone) {
      known = new Uint8Array(s.gridWidth * s.gridHeight);
      poolMoves = 0;
      G.act({ type: 'open', x: (s.gridWidth / 2) | 0, y: (s.gridHeight / 2) | 0 });
      poolMoves++;
      G.advance(msPerMove);
      continue;
    }
    const w = s.gridWidth;
    const res = analyze(s, known);
    if (!res.safe.length) break;

    let acted = false;
    for (const cell of res.mines) {
      if (s.rows[Math.floor(cell / w)][cell % w] === '#') {
        G.act({ type: 'flag', x: cell % w, y: Math.floor(cell / w) });
        acted = true;
        break;
      }
    }
    if (!acted) {
      if (useSweeps) {
        const nb = S.gen.neighbors(w, s.gridHeight);
        for (let i = 0; i < res.open.length && !acted; i++) {
          if (!res.open[i] || res.val[i] === 0) continue;
          let flags = 0, cov = 0;
          for (const m of nb[i]) {
            const ch = s.rows[Math.floor(m / w)][m % w];
            if (ch === 'F') flags++; else if (ch === '#') cov++;
          }
          if (flags === res.val[i] && cov > 0) {
            G.act({ type: 'sweep', x: i % w, y: Math.floor(i / w) });
            acted = true;
          }
        }
      }
      if (!acted) {
        const t = res.safe.find((c) => s.rows[Math.floor(c / w)][c % w] === '#');
        if (t === undefined) break;
        G.act({ type: 'open', x: t % w, y: Math.floor(t / w) });
        acted = true;
      }
    }
    poolMoves++;
    G.advance(msPerMove);
    const after = G.snapshot();
    if (after.pool !== s.pool) {
      perPool.push({ pool: s.pool, moves: poolMoves, tide: s.tideFraction, pearls: after.pearls });
      poolMoves = 0;
      known = new Uint8Array(after.gridWidth * after.gridHeight);
    }
  }
  return { perPool, final: G.snapshot() };
}

const PROFILES = [
  { name: 'careful  (2.6s/move, pennants everything)', ms: 2600, sweeps: false },
  { name: 'steady   (1.4s/move, some sweeps)        ', ms: 1400, sweeps: true },
  { name: 'hasty    (0.6s/move, sweeps hard)        ', ms: 600, sweeps: true }
];

const MAXPOOL = 9;
const TRIALS = 6;

for (const p of PROFILES) {
  const cum = [];   // cum[i] = avg pearls banked once pool i+1 is cleared
  const tide = [];
  for (let t = 0; t < TRIALS; t++) {
    const r = playRun('econ-' + t, p.ms, p.sweeps, MAXPOOL);
    r.perPool.forEach((x, i) => {
      cum[i] = (cum[i] || 0) + x.pearls / TRIALS;
      tide[i] = (tide[i] || 0) + x.tide / TRIALS;
    });
  }
  console.log('\n' + p.name);
  console.log('   pool  tide left   pearls banked   rank');
  cum.forEach((v, i) => {
    console.log(
      '   ' + String(i + 1).padEnd(6) +
      (tide[i] * 100).toFixed(0).padStart(4) + '%'.padEnd(9) +
      v.toFixed(0).padStart(9) + '       ' + G.rankFor(v)
    );
  });
}
