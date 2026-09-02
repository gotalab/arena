/** Logical deduction solver — mirrors what a human can prove from visible info. */

const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function neighbors(x, y, w, h) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const nx = x + DX[i];
    const ny = y + DY[i];
    if (nx >= 0 && nx < w && ny >= 0 && ny < h) out.push([nx, ny]);
  }
  return out;
}

/** @returns {{ safe: Set<string>, urchins: Set<string> }} */
export function deduce(visible, w, h, urchinsTotal, flagsPlaced) {
  const safe = new Set();
  const urchins = new Set();
  let changed = true;

  while (changed) {
    changed = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = visible[y][x];
        if (c < '0' || c > '8') continue;
        const num = c.charCodeAt(0) - 48;
        const nbrs = neighbors(x, y, w, h);
        let hidden = [];
        let flagged = 0;
        for (const [nx, ny] of nbrs) {
          const nc = visible[ny][nx];
          if (nc === '#') hidden.push([nx, ny]);
          else if (nc === 'F') flagged++;
        }
        const remaining = num - flagged;
        if (remaining < 0) continue;
        if (hidden.length === 0) continue;

        if (remaining === 0) {
          for (const [nx, ny] of hidden) {
            const k = `${nx},${ny}`;
            if (!safe.has(k)) {
              safe.add(k);
              changed = true;
            }
          }
        } else if (remaining === hidden.length) {
          for (const [nx, ny] of hidden) {
            const k = `${nx},${ny}`;
            if (!urchins.has(k)) {
              urchins.add(k);
              changed = true;
            }
          }
        }
      }
    }

    // Global counter clue: urchinsLeft vs hidden unflagged cells
    const urchinsLeft = urchinsTotal - flagsPlaced;
    let hiddenUnflagged = 0;
    const hiddenCells = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = visible[y][x];
        if (c === '#') {
          hiddenUnflagged++;
          hiddenCells.push([x, y]);
        }
      }
    }
    const knownUrchins = flagsPlaced + urchins.size;
    const knownSafe = safe.size;
    const unknown = hiddenUnflagged - knownSafe - urchins.size;

    if (unknown > 0 && urchinsLeft === unknown) {
      for (const [x, y] of hiddenCells) {
        const k = `${x},${y}`;
        if (!safe.has(k) && !urchins.has(k)) {
          urchins.add(k);
          changed = true;
        }
      }
    }
    if (unknown > 0 && urchinsLeft === 0) {
      for (const [x, y] of hiddenCells) {
        const k = `${x},${y}`;
        if (!safe.has(k) && !urchins.has(k)) {
          safe.add(k);
          changed = true;
        }
      }
    }
    // Subset constraint subtraction between numbered cells
    const constraints = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = visible[y][x];
        if (c < '0' || c > '8') continue;
        const num = c.charCodeAt(0) - 48;
        const hidden = new Set();
        let flagged = 0;
        for (const [nx, ny] of neighbors(x, y, w, h)) {
          const nc = visible[ny][nx];
          if (nc === '#') hidden.add(`${nx},${ny}`);
          else if (nc === 'F') flagged++;
        }
        const need = num - flagged;
        if (need >= 0 && hidden.size > 0) {
          constraints.push({ hidden, need });
        }
      }
    }
    for (let i = 0; i < constraints.length; i++) {
      for (let j = 0; j < constraints.length; j++) {
        if (i === j) continue;
        const a = constraints[i];
        const b = constraints[j];
        let subset = true;
        for (const k of a.hidden) {
          if (!b.hidden.has(k)) {
            subset = false;
            break;
          }
        }
        if (!subset || a.hidden.size === b.hidden.size) continue;
        const diff = new Set();
        for (const k of b.hidden) {
          if (!a.hidden.has(k)) diff.add(k);
        }
        const need = b.need - a.need;
        if (need === 0) {
          for (const k of diff) {
            if (!safe.has(k)) {
              safe.add(k);
              changed = true;
            }
          }
        } else if (need === diff.size) {
          for (const k of diff) {
            if (!urchins.has(k)) {
              urchins.add(k);
              changed = true;
            }
          }
        }
      }
    }
  }

  return { safe, urchins };
}

function visToRows(vis) {
  return vis.map((r) => (Array.isArray(r) ? r.join('') : r));
}

function openSafeCell(vis, x, y, w, h, solution) {
  if (vis[y][x] !== '#') return;
  if (solution[y][x] === -1) return;
  if (solution[y][x] === 0) floodZero(vis, x, y, w, h, solution);
  else vis[y][x] = String(solution[y][x]);
}

/** BFS verify: every non-death reachable state has a provably safe move. */
export function verifyWaterNeverLies(visible, w, h, urchinsTotal, solution) {
  const start = visible.map((r) => r.split(''));
  const queue = [start];
  const seen = new Set();
  seen.add(JSON.stringify(start));

  while (queue.length) {
    const vis = queue.shift();
    const rows = visToRows(vis);
    let flags = 0;
    let hiddenSafe = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (vis[y][x] === 'F') flags++;
        if (vis[y][x] === '#') hiddenSafe++;
      }
    }

    let complete = true;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solution[y][x] !== -1 && vis[y][x] === '#') complete = false;
      }
    }
    if (complete) continue;

    const { safe } = deduce(rows, w, h, urchinsTotal, flags);
    if (safe.size === 0) return false;

    for (const k of safe) {
      const [x, y] = k.split(',').map(Number);
      const next = vis.map((r) => r.slice());
      openSafeCell(next, x, y, w, h, solution);
      const sig = JSON.stringify(next);
      if (!seen.has(sig)) {
        seen.add(sig);
        queue.push(next);
      }
    }
  }
  return true;
}

function floodZero(vis, x, y, w, h, solution) {
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (vis[cy][cx] !== '#') continue;
    if (solution[cy][cx] === -1) continue;
    vis[cy][cx] = String(solution[cy][cx]);
    if (solution[cy][cx] === 0) {
      for (const [nx, ny] of neighbors(cx, cy, w, h)) {
        if (vis[ny][nx] === '#') stack.push([nx, ny]);
      }
    }
  }
}

/** Check if board is fully logically solvable from a given visible state. */
export function isSolvable(visible, w, h, urchinsTotal, solution) {
  const vis = visible.map((r) => r.split(''));
  let flags = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (vis[y][x] === 'F') flags++;
    }
  }

  let progress = true;
  while (progress) {
    progress = false;
    const { safe, urchins } = deduce(vis.map((r) => r.join('')), w, h, urchinsTotal, flags);

    for (const k of safe) {
      const [x, y] = k.split(',').map(Number);
      if (vis[y][x] === '#') {
        if (solution[y][x] === 0) floodZero(vis, x, y, w, h, solution);
        else vis[y][x] = String(solution[y][x]);
        progress = true;
      }
    }
    for (const k of urchins) {
      const [x, y] = k.split(',').map(Number);
      if (vis[y][x] === '#') {
        vis[y][x] = 'F';
        flags++;
        progress = true;
      }
    }

    let done = true;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solution[y][x] === -1) continue;
        const c = vis[y][x];
        if (c === '#' || c === 'F') done = false;
      }
    }
    if (done) return true;
  }

  return false;
}

/** Verify at least one safe move exists from current visible state. */
export function hasSafeMove(visible, w, h, urchinsTotal, flagsPlaced) {
  const { safe } = deduce(visible, w, h, urchinsTotal, flagsPlaced);
  return safe.size > 0;
}
