/* Node-only harness: not part of the shipped page, but kept in the tree so the
   guarantee can be re-checked. Run: node tests/gen.test.js */
global.window = {};
require('../js/rng.js');
require('../js/solver.js');
require('../js/board.js');
const S = global.window.SHOAL;

let worst = 0, totalT = 0, cases = 0, reduced = 0;
for (let seedN = 0; seedN < 12; seedN++) {
  for (let pool = 1; pool <= 9; pool++) {
    const spec = S.poolSpec(pool);
    const firsts = [[0, 0], [Math.floor(spec.w / 2), Math.floor(spec.h / 2)], [spec.w - 1, spec.h - 1], [1, spec.h - 3]];
    for (const fxy of firsts) {
      const fx = fxy[0], fy = fxy[1];
      const t0 = process.hrtime.bigint();
      const b = S.generateBoard('seed-' + seedN, pool, fx, fy, spec);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      totalT += ms; cases++;
      if (ms > worst) worst = ms;
      if (b.urchins !== spec.urchins) reduced++;
      const first = fy * spec.w + fx;
      if (b.mine[first]) { console.log('FATAL first turn', seedN, pool, fx, fy); process.exit(1); }
      if (b.num[first] !== 0) { console.log('first turn not quiet water', seedN, pool, fx, fy); process.exit(1); }
      if (!S.solveNoGuess(spec.w, spec.h, b.mine, b.num, first, b.urchins)) {
        console.log('UNSOLVABLE SHIPPED', seedN, pool, fx, fy); process.exit(1);
      }
    }
  }
}
console.log('cases', cases, 'avg ms', (totalT / cases).toFixed(1), 'worst ms', worst.toFixed(1), 'eased boards', reduced);
