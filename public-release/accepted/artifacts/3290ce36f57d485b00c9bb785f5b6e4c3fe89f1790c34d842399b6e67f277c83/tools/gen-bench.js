// Dev-only benchmark for the pool generator. Not part of the shipped game.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, Math, console };
sandbox.window.SHOAL = {};
vm.createContext(sandbox);
for (const f of ['js/rng.js', 'js/generator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const S = sandbox.window.SHOAL;

let worstMs = 0, totalMs = 0, runs = 0, reduced = 0;
for (let pool = 1; pool <= 12; pool++) {
  const cfg = S.gen.poolConfig(pool);
  let poolWorst = 0, poolTotal = 0, count = 0, poolReduced = 0;
  for (let trial = 0; trial < 25; trial++) {
    const seedHash = S.rng.hashSeed('bench-' + trial);
    const fx = (trial * 3) % cfg.w;
    const fy = (trial * 5) % cfg.h;
    const t0 = process.hrtime.bigint();
    const b = S.gen.generate(seedHash, pool, fx, fy);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    poolWorst = Math.max(poolWorst, ms);
    poolTotal += ms; count++;
    if (b.mines !== cfg.mines) poolReduced++;
    // sanity: first turn opens quiet water
    if (b.val[fy * b.w + fx] !== 0) throw new Error('first turn not zero at pool ' + pool);
    if (!S.gen.solvable(b.w, b.h, b.mine, fy * b.w + fx, b.mines)) {
      throw new Error('shipped an unsolvable board at pool ' + pool);
    }
  }
  worstMs = Math.max(worstMs, poolWorst);
  totalMs += poolTotal; runs += count; reduced += poolReduced;
  console.log(
    `pool ${String(pool).padStart(2)} ${cfg.w}x${cfg.h} mines=${cfg.mines} ` +
    `(${((cfg.mines / (cfg.w * cfg.h)) * 100).toFixed(1)}%) ` +
    `avg=${(poolTotal / count).toFixed(1)}ms worst=${poolWorst.toFixed(1)}ms reduced=${poolReduced}`
  );
}
console.log(`\noverall avg=${(totalMs / runs).toFixed(1)}ms worst=${worstMs.toFixed(1)}ms reduced=${reduced}/${runs}`);
