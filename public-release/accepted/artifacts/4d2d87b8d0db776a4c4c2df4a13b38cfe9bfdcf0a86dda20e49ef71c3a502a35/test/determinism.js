#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'js/rng.js',
  'js/world.js',
  'js/particles.js',
  'js/simulation.js',
];

const sandbox = {
  window: {},
  Math,
  console,
  Particles: {
    clear() {},
  },
};
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);

for (const f of files) {
  const code = fs.readFileSync(path.join(root, f), 'utf8');
  vm.runInContext(code, ctx);
}

const Simulation = sandbox.Simulation;
const ArenaRng = sandbox.ArenaRng;
const WorldGen = sandbox.WorldGen;

function runSteps(seed, steps) {
  Simulation.reset(seed);
  for (let i = 0; i < steps; i++) Simulation.step();
  return Simulation.snapshot();
}

const seed = 12345;
const a = Simulation.reset(seed);
const snap0a = Simulation.snapshot();
Simulation.reset(seed);
const snap0b = Simulation.snapshot();

const checks = [];
checks.push(['reset identical', JSON.stringify(snap0a) === JSON.stringify(snap0b)]);
checks.push(['phase ready', snap0a.phase === 'ready']);
checks.push(['tick zero', snap0a.tick === 0]);
checks.push(['rank null', snap0a.rank === null]);
checks.push(['jumps full', snap0a.jumpsLeft === snap0a.jumpCapacity]);
checks.push(['has arena fields', snap0a.launchReach > 0 && snap0a.wallLeftX < snap0a.wallRightX]);

const s1 = runSteps(seed, 120);
const s2 = runSteps(seed, 120);
checks.push(['deterministic steps', JSON.stringify(s1) === JSON.stringify(s2)]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}

process.exit(failed > 0 ? 1 : 0);
