import { GameEngine } from '../src/game.js';
import { LEVEL_IDS } from '../src/levels.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ CONTRACT VIOLATION: ${message}`);
    process.exit(1);
  }
}

const engine = new GameEngine();
const snap = engine.snapshot();

const expectedKeys = [
  'revision', 'attempt', 'phase', 'outcome', 'levelId',
  'width', 'height', 'walls', 'goals', 'crates', 'player',
  'poweredGoals', 'moveCount', 'pushCount', 'undoAvailable', 'legalActions'
];

for (const key of expectedKeys) {
  assert(key in snap, `Missing required key: ${key}`);
}

assert(typeof snap.revision === 'number', 'revision is number');
assert(typeof snap.attempt === 'number', 'attempt is number');
assert(typeof snap.phase === 'string', 'phase is string');
assert(snap.outcome === null || typeof snap.outcome === 'string', 'outcome is null or string');
assert(typeof snap.levelId === 'string', 'levelId is string');
assert(typeof snap.width === 'number', 'width is number');
assert(typeof snap.height === 'number', 'height is number');
assert(Array.isArray(snap.walls), 'walls is array');
assert(Array.isArray(snap.goals), 'goals is array');
assert(Array.isArray(snap.crates), 'crates is array');
assert(typeof snap.player === 'object' && snap.player !== null, 'player is object');
assert(typeof snap.player.row === 'number' && typeof snap.player.col === 'number', 'player has row & col');
assert(typeof snap.poweredGoals === 'number', 'poweredGoals is number');
assert(typeof snap.moveCount === 'number', 'moveCount is number');
assert(typeof snap.pushCount === 'number', 'pushCount is number');
assert(typeof snap.undoAvailable === 'boolean', 'undoAvailable is boolean');
assert(Array.isArray(snap.legalActions), 'legalActions is array');

// Check coordinate object sorting
function checkSorted(arr, name) {
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    assert(typeof a.row === 'number' && typeof a.col === 'number', `${name}[${i}] format`);
    assert(a.row < b.row || (a.row === b.row && a.col <= b.col), `${name} must be sorted by row then col`);
  }
}

checkSorted(snap.walls, 'walls');
checkSorted(snap.goals, 'goals');
checkSorted(snap.crates, 'crates');

// Test selecting all 20 levels
for (const id of LEVEL_IDS) {
  const s = engine.act({ type: 'select_level', levelId: id });
  assert(s.levelId === id, `Select level ${id}`);
  checkSorted(s.walls, `walls (${id})`);
  checkSorted(s.goals, `goals (${id})`);
  checkSorted(s.crates, `crates (${id})`);
}

// Test reset(seed)
const r = engine.reset(12345);
assert(r.levelId === 'first-light', 'reset to first-light');
assert(engine.seed === 12345, 'seed saved');

console.log('✅ API CONTRACT & SHAPE STRICTLY SATISFIED!');
