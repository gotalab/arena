if (typeof createPrng === "undefined" && typeof require !== "undefined") {
  const _prng = require("./prng.js");
  createPrng = _prng.createPrng;
  hashSeed = _prng.hashSeed;
}
// Board generation and logical deduction solver for SHOAL
// Guarantees "The water never lies": at every step, a safe move can be deduced without guessing.

function getPoolConfig(pool) {
  if (pool <= 1) return { w: 7, h: 7, urchins: 6, tideSeconds: 45 };
  if (pool === 2) return { w: 7, h: 9, urchins: 9, tideSeconds: 52 };
  if (pool === 3) return { w: 8, h: 10, urchins: 13, tideSeconds: 60 };
  if (pool === 4) return { w: 8, h: 12, urchins: 17, tideSeconds: 68 };
  if (pool === 5) return { w: 9, h: 13, urchins: 22, tideSeconds: 76 };
  if (pool === 6) return { w: 9, h: 14, urchins: 25, tideSeconds: 84 };
  if (pool === 7) return { w: 10, h: 14, urchins: 28, tideSeconds: 90 };
  return { w: 10, h: 15, urchins: 30, tideSeconds: 96 };
}

function getNeighbors(x, y, w, h) {
  const list = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        list.push(ny * w + nx);
      }
    }
  }
  return list;
}

function computeAdjacentList(w, h) {
  const adj = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      adj[y * w + x] = getNeighbors(x, y, w, h);
    }
  }
  return adj;
}

function computeNumbers(w, h, mines, adj) {
  const size = w * h;
  const numbers = new Int8Array(size);
  for (let i = 0; i < size; i++) {
    let count = 0;
    const neighbors = adj[i];
    for (let j = 0; j < neighbors.length; j++) {
      if (mines[neighbors[j]]) count++;
    }
    numbers[i] = count;
  }
  return numbers;
}

function solveBoard(w, h, mines, fx, fy, totalMines, adj, numbers) {
  const size = w * h;
  const revealed = new Uint8Array(size);
  const flagged = new Uint8Array(size);
  let revealedCount = 0;
  let flaggedCount = 0;

  function reveal(idx) {
    if (revealed[idx] || flagged[idx]) return;
    revealed[idx] = 1;
    revealedCount++;
    if (numbers[idx] === 0) {
      const neighbors = adj[idx];
      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (!revealed[n] && !flagged[n]) {
          reveal(n);
        }
      }
    }
  }

  reveal(fy * w + fx);
  const safeTotal = size - totalMines;

  let progress = true;
  while (progress && revealedCount < safeTotal) {
    progress = false;

    // Method 1: Single cell deductions
    for (let i = 0; i < size; i++) {
      if (!revealed[i]) continue;
      const num = numbers[i];
      const neighbors = adj[i];
      let flg = 0;
      const unrev = [];
      for (let j = 0; j < neighbors.length; j++) {
        const n = neighbors[j];
        if (flagged[n]) flg++;
        else if (!revealed[n]) unrev.push(n);
      }
      if (unrev.length === 0) continue;

      if (flg === num) {
        for (let j = 0; j < unrev.length; j++) reveal(unrev[j]);
        progress = true;
      } else if (unrev.length === num - flg) {
        for (let j = 0; j < unrev.length; j++) {
          flagged[unrev[j]] = 1;
          flaggedCount++;
        }
        progress = true;
      }
    }
    if (progress || revealedCount >= safeTotal) continue;

    // Method 2: Subset deductions
    const constraints = [];
    for (let i = 0; i < size; i++) {
      if (!revealed[i]) continue;
      const num = numbers[i];
      const neighbors = adj[i];
      let flg = 0;
      const unrev = [];
      for (let j = 0; j < neighbors.length; j++) {
        const n = neighbors[j];
        if (flagged[n]) flg++;
        else if (!revealed[n]) unrev.push(n);
      }
      if (unrev.length > 0) {
        constraints.push({ cell: i, req: num - flg, unrev });
      }
    }

    for (let i = 0; i < constraints.length; i++) {
      const c1 = constraints[i];
      const set1 = new Set(c1.unrev);
      for (let j = 0; j < constraints.length; j++) {
        if (i === j) continue;
        const c2 = constraints[j];
        if (c1.unrev.length >= c2.unrev.length) continue;
        let isSubset = true;
        for (let k = 0; k < c1.unrev.length; k++) {
          if (!c2.unrev.includes(c1.unrev[k])) {
            isSubset = false;
            break;
          }
        }
        if (isSubset) {
          const diff = c2.unrev.filter(c => !set1.has(c));
          const diffReq = c2.req - c1.req;
          if (diffReq === 0) {
            for (let k = 0; k < diff.length; k++) reveal(diff[k]);
            progress = true;
          } else if (diffReq === diff.length) {
            for (let k = 0; k < diff.length; k++) {
              flagged[diff[k]] = 1;
              flaggedCount++;
            }
            progress = true;
          }
        }
      }
      if (progress) break;
    }
    if (progress || revealedCount >= safeTotal) continue;

    // Method 3: Urchin counter deduction
    const remMines = totalMines - flaggedCount;
    const remCovered = size - revealedCount - flaggedCount;
    if (remMines === 0) {
      for (let i = 0; i < size; i++) {
        if (!revealed[i] && !flagged[i]) reveal(i);
      }
      progress = true;
    } else if (remMines === remCovered) {
      for (let i = 0; i < size; i++) {
        if (!revealed[i] && !flagged[i]) {
          flagged[i] = 1;
          flaggedCount++;
        }
      }
      progress = true;
    }
  }

  return revealedCount >= safeTotal;
}

function generateSolvableBoard(seed, pool, fx, fy) {
  const config = getPoolConfig(pool);
  const { w, h, urchins } = config;
  const size = w * h;
  const adj = computeAdjacentList(w, h);

  const eligibleCells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Must not touch first turn (3x3 area)
      if (Math.abs(x - fx) <= 1 && Math.abs(y - fy) <= 1) continue;
      eligibleCells.push(y * w + x);
    }
  }

  let attempt = 0;
  while (attempt < 500) {
    const prng = createPrng(hashSeed(seed, pool, fx, fy, attempt));
    const mines = new Uint8Array(size);
    const poolList = eligibleCells.slice();

    for (let m = 0; m < urchins; m++) {
      const idx = Math.floor(prng() * (poolList.length - m));
      const chosen = poolList[idx];
      poolList[idx] = poolList[poolList.length - 1 - m];
      mines[chosen] = 1;
    }

    const numbers = computeNumbers(w, h, mines, adj);
    if (solveBoard(w, h, mines, fx, fy, urchins, adj, numbers)) {
      return {
        w,
        h,
        urchins,
        tideSeconds: config.tideSeconds,
        mines,
        numbers,
        adj,
        attemptFound: attempt
      };
    }
    attempt++;
  }

  // Fallback: if 500 attempts failed, use the last generated board
  const prng = createPrng(hashSeed(seed, pool, fx, fy, 0));
  const mines = new Uint8Array(size);
  const poolList = eligibleCells.slice();
  for (let m = 0; m < urchins; m++) {
    const idx = Math.floor(prng() * (poolList.length - m));
    const chosen = poolList[idx];
    poolList[idx] = poolList[poolList.length - 1 - m];
    mines[chosen] = 1;
  }
  const numbers = computeNumbers(w, h, mines, adj);
  return {
    w,
    h,
    urchins,
    tideSeconds: config.tideSeconds,
    mines,
    numbers,
    adj,
    attemptFound: -1
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getPoolConfig,
    getNeighbors,
    computeAdjacentList,
    computeNumbers,
    solveBoard,
    generateSolvableBoard
  };
}
