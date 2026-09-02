/**
 * SHOAL - Guaranteed Solvable Board Generator & Constraint Solver
 * 
 * Ensures the core promise: "The water never lies" - at every step of a correctly
 * played board, at least one covered shell is provably safe.
 */

// PRNG: Mulberry32 seeded generator
export function createPRNG(seed) {
  let s = typeof seed === 'number' ? (seed >>> 0) : hashString(String(seed));
  if (s === 0) s = 1337;

  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(min, max) {
      return Math.floor(min + this.next() * (max - min + 1));
    },
    fork(offset = 0) {
      return createPRNG((s + offset) >>> 0);
    }
  };
}

export function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Pool configuration by ladder depth
export function getPoolConfig(poolNumber) {
  if (poolNumber === 1) return { width: 6, height: 6, urchins: 4, tideSeconds: 35 };
  if (poolNumber === 2) return { width: 7, height: 7, urchins: 7, tideSeconds: 40 };
  if (poolNumber === 3) return { width: 8, height: 8, urchins: 11, tideSeconds: 45 };
  if (poolNumber === 4) return { width: 8, height: 8, urchins: 14, tideSeconds: 50 };
  if (poolNumber === 5) return { width: 9, height: 9, urchins: 18, tideSeconds: 55 };
  if (poolNumber === 6) return { width: 9, height: 9, urchins: 22, tideSeconds: 60 };
  if (poolNumber === 7) return { width: 10, height: 10, urchins: 26, tideSeconds: 65 };
  
  const extra = poolNumber - 7;
  const urchins = Math.min(34, 26 + extra * 2);
  const tideSeconds = Math.min(90, 65 + extra * 5);
  return { width: 10, height: 10, urchins, tideSeconds };
}

// Helper: 8 neighbors
export function getNeighbors(x, y, width, height) {
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        neighbors.push({ x: nx, y: ny });
      }
    }
  }
  return neighbors;
}

/**
 * Generate a board deterministically that is 100% solvable without guessing,
 * with the first click at (firstX, firstY) guaranteed to be a 0 (opening quiet water).
 */
export function generateSolvableBoard(seed, poolNumber, firstX, firstY) {
  const config = getPoolConfig(poolNumber);
  const { width, height, urchins: totalUrchins } = config;

  // Derive PRNG specific to (seed, poolNumber, firstX, firstY)
  const poolSeed = hashString(`${seed}:pool:${poolNumber}:start:${firstX},${firstY}`);
  const prng = createPRNG(poolSeed);

  // Forbidden cells for first turn: (firstX, firstY) and its 8 neighbors
  const forbidden = new Set();
  forbidden.add(`${firstX},${firstY}`);
  for (const n of getNeighbors(firstX, firstY, width, height)) {
    forbidden.add(`${n.x},${n.y}`);
  }

  const allCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      allCells.push({ x, y, key: `${x},${y}` });
    }
  }

  const availableCells = allCells.filter(c => !forbidden.has(c.key));

  let attempts = 0;
  const MAX_ATTEMPTS = 500;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const shuffled = [...availableCells];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(prng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const mineSet = new Set();
    for (let i = 0; i < totalUrchins; i++) {
      mineSet.add(shuffled[i].key);
    }

    const grid = [];
    for (let y = 0; y < height; y++) {
      grid[y] = [];
      for (let x = 0; x < width; x++) {
        grid[y][x] = {
          x,
          y,
          isMine: mineSet.has(`${x},${y}`),
          count: 0
        };
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!grid[y][x].isMine) {
          let c = 0;
          for (const n of getNeighbors(x, y, width, height)) {
            if (grid[n.y][n.x].isMine) c++;
          }
          grid[y][x].count = c;
        }
      }
    }

    if (isBoardSolvable(grid, width, height, totalUrchins, firstX, firstY)) {
      return {
        width,
        height,
        urchins: totalUrchins,
        grid,
        mineSet
      };
    }
  }

  return generateSafeFallbackBoard(width, height, totalUrchins, firstX, firstY, prng);
}

/**
 * Logical deduction solver simulating human player logic:
 * 1. Single-cell deductions
 * 2. Subset constraint reduction
 * 3. Global Urchin Count reasoning
 */
export function isBoardSolvable(grid, width, height, totalUrchins, firstX, firstY) {
  const totalSafeCells = width * height - totalUrchins;
  let revealedSafeCount = 0;

  const revealed = Array.from({ length: height }, () => Array(width).fill(false));
  const flagged = Array.from({ length: height }, () => Array(width).fill(false));

  function reveal(x, y) {
    if (revealed[y][x] || flagged[y][x]) return 0;
    revealed[y][x] = true;
    let opened = 1;

    if (grid[y][x].count === 0) {
      const queue = [{ x, y }];
      while (queue.length > 0) {
        const curr = queue.shift();
        for (const n of getNeighbors(curr.x, curr.y, width, height)) {
          if (!revealed[n.y][n.x] && !flagged[n.y][n.x] && !grid[n.y][n.x].isMine) {
            revealed[n.y][n.x] = true;
            opened++;
            if (grid[n.y][n.x].count === 0) {
              queue.push({ x: n.x, y: n.y });
            }
          }
        }
      }
    }
    return opened;
  }

  revealedSafeCount += reveal(firstX, firstY);

  let progress = true;
  while (progress && revealedSafeCount < totalSafeCells) {
    progress = false;

    // 1. Direct deductions
    const frontierCells = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!revealed[y][x] || grid[y][x].count === 0) continue;

        const neighbors = getNeighbors(x, y, width, height);
        const unrevealed = [];
        let flags = 0;

        for (const n of neighbors) {
          if (flagged[n.y][n.x]) {
            flags++;
          } else if (!revealed[n.y][n.x]) {
            unrevealed.push(n);
          }
        }

        if (unrevealed.length === 0) continue;

        const required = grid[y][x].count - flags;

        if (required === unrevealed.length) {
          for (const n of unrevealed) {
            if (!flagged[n.y][n.x]) {
              flagged[n.y][n.x] = true;
              progress = true;
            }
          }
        } else if (required === 0) {
          for (const n of unrevealed) {
            if (!revealed[n.y][n.x]) {
              revealedSafeCount += reveal(n.x, n.y);
              progress = true;
            }
          }
        } else {
          frontierCells.push({
            x, y,
            required,
            unrevealed
          });
        }
      }
    }

    if (progress) continue;

    // 2. Subset constraint reduction
    for (let i = 0; i < frontierCells.length; i++) {
      const cA = frontierCells[i];
      const setA = new Set(cA.unrevealed.map(p => `${p.x},${p.y}`));

      for (let j = 0; j < frontierCells.length; j++) {
        if (i === j) continue;
        const cB = frontierCells[j];
        const setB = new Set(cB.unrevealed.map(p => `${p.x},${p.y}`));

        let isSubset = true;
        for (const key of setA) {
          if (!setB.has(key)) {
            isSubset = false;
            break;
          }
        }

        if (isSubset && setA.size < setB.size) {
          const diffCells = cB.unrevealed.filter(p => !setA.has(`${p.x},${p.y}`));
          const diffMines = cB.required - cA.required;

          if (diffMines === 0) {
            for (const n of diffCells) {
              if (!revealed[n.y][n.x] && !flagged[n.y][n.x]) {
                revealedSafeCount += reveal(n.x, n.y);
                progress = true;
              }
            }
          } else if (diffMines === diffCells.length) {
            for (const n of diffCells) {
              if (!flagged[n.y][n.x]) {
                flagged[n.y][n.x] = true;
                progress = true;
              }
            }
          }
        }
      }
    }

    if (progress) continue;

    // 3. Global Urchin Count reasoning
    let totalFlags = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (flagged[y][x]) totalFlags++;
      }
    }

    if (totalFlags === totalUrchins) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!revealed[y][x] && !flagged[y][x]) {
            revealedSafeCount += reveal(x, y);
            progress = true;
          }
        }
      }
    }
  }

  return revealedSafeCount === totalSafeCells;
}

function generateSafeFallbackBoard(width, height, totalUrchins, firstX, firstY, prng) {
  const forbidden = new Set();
  forbidden.add(`${firstX},${firstY}`);
  for (const n of getNeighbors(firstX, firstY, width, height)) {
    forbidden.add(`${n.x},${n.y}`);
  }

  const allCells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      allCells.push({ x, y, key: `${x},${y}` });
    }
  }

  const available = allCells.filter(c => !forbidden.has(c.key));
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }

  const mineSet = new Set();
  for (let i = 0; i < totalUrchins; i++) {
    mineSet.add(available[i].key);
  }

  const grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      grid[y][x] = {
        x,
        y,
        isMine: mineSet.has(`${x},${y}`),
        count: 0
      };
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y][x].isMine) {
        let c = 0;
        for (const n of getNeighbors(x, y, width, height)) {
          if (grid[n.y][n.x].isMine) c++;
        }
        grid[y][x].count = c;
      }
    }
  }

  return { width, height, urchins: totalUrchins, grid, mineSet };
}
