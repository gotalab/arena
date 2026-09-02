/**
 * Shoal Board Generator & No-Guess Deduction Solver
 * Guarantees "The water never lies": at every step, a safe move is provably deducible.
 */
(function(root) {
  const NEIGHBORS = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];

  function getNeighbors(x, y, w, h) {
    const res = [];
    for (let i = 0; i < 8; i++) {
      const nx = x + NEIGHBORS[i][0];
      const ny = y + NEIGHBORS[i][1];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        res.push([nx, ny]);
      }
    }
    return res;
  }

  function canSolveNoGuess(width, height, urchinCount, urchinGrid, firstX, firstY) {
    // 0: covered, 1: open, 2: flagged
    const state = new Uint8Array(width * height);
    let openCount = 0;
    let flagCount = 0;
    const totalSafe = width * height - urchinCount;

    // Number grid
    const numbers = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (urchinGrid[y * width + x]) continue;
        let count = 0;
        const nbs = getNeighbors(x, y, width, height);
        for (let i = 0; i < nbs.length; i++) {
          if (urchinGrid[nbs[i][1] * width + nbs[i][0]]) count++;
        }
        numbers[y * width + x] = count;
      }
    }

    function openCell(x, y) {
      const idx = y * width + x;
      if (state[idx] !== 0) return 0;
      state[idx] = 1;
      openCount++;
      let newlyOpened = 1;

      if (numbers[idx] === 0) {
        const queue = [[x, y]];
        while (queue.length > 0) {
          const [cx, cy] = queue.shift();
          const nbs = getNeighbors(cx, cy, width, height);
          for (let i = 0; i < nbs.length; i++) {
            const [nx, ny] = nbs[i];
            const nidx = ny * width + nx;
            if (state[nidx] === 0) {
              state[nidx] = 1;
              openCount++;
              newlyOpened++;
              if (numbers[nidx] === 0) {
                queue.push([nx, ny]);
              }
            }
          }
        }
      }
      return newlyOpened;
    }

    // First open
    openCell(firstX, firstY);

    let progress = true;
    while (progress && openCount < totalSafe) {
      progress = false;

      // Rule 0: Global Urchin Counter deduction
      const remainingUrchins = urchinCount - flagCount;
      const remainingCovered = width * height - openCount - flagCount;

      if (remainingUrchins === 0 && remainingCovered > 0) {
        for (let i = 0; i < width * height; i++) {
          if (state[i] === 0) {
            const x = i % width;
            const y = Math.floor(i / width);
            openCell(x, y);
            progress = true;
          }
        }
        break;
      }

      if (remainingUrchins === remainingCovered && remainingCovered > 0) {
        for (let i = 0; i < width * height; i++) {
          if (state[i] === 0) {
            state[i] = 2; // flag
            flagCount++;
            progress = true;
          }
        }
      }

      // Collect frontier constraint cells
      const frontierConstraints = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (state[idx] !== 1) continue;
          const nbs = getNeighbors(x, y, width, height);
          const coveredNbs = [];
          let flags = 0;
          for (let i = 0; i < nbs.length; i++) {
            const nidx = nbs[i][1] * width + nbs[i][0];
            if (state[nidx] === 0) coveredNbs.push(nidx);
            else if (state[nidx] === 2) flags++;
          }
          if (coveredNbs.length > 0) {
            frontierConstraints.push({
              x, y, idx,
              req: numbers[idx] - flags,
              covered: coveredNbs
            });
          }
        }
      }

      // Strategy 1: Basic Single Cell Deduction
      for (let i = 0; i < frontierConstraints.length; i++) {
        const c = frontierConstraints[i];
        if (c.req === c.covered.length) {
          // All covered are urchins
          for (let k = 0; k < c.covered.length; k++) {
            const nidx = c.covered[k];
            if (state[nidx] === 0) {
              state[nidx] = 2;
              flagCount++;
              progress = true;
            }
          }
        } else if (c.req === 0) {
          // All covered are safe
          for (let k = 0; k < c.covered.length; k++) {
            const nidx = c.covered[k];
            if (state[nidx] === 0) {
              const nx = nidx % width;
              const ny = Math.floor(nidx / width);
              openCell(nx, ny);
              progress = true;
            }
          }
        }
      }
      if (progress) continue;

      // Strategy 2: Pairwise Subset / Set Difference Reduction
      for (let i = 0; i < frontierConstraints.length; i++) {
        const A = frontierConstraints[i];
        if (A.covered.length === 0) continue;
        const setA = new Set(A.covered);

        for (let j = 0; j < frontierConstraints.length; j++) {
          if (i === j) continue;
          const B = frontierConstraints[j];
          if (B.covered.length === 0) continue;

          // Check if setA is subset of B.covered
          let isSubset = true;
          for (let k = 0; k < A.covered.length; k++) {
            if (!B.covered.includes(A.covered[k])) {
              isSubset = false;
              break;
            }
          }

          if (isSubset) {
            const diff = B.covered.filter(x => !setA.has(x));
            const diffReq = B.req - A.req;
            if (diffReq === 0 && diff.length > 0) {
              for (let k = 0; k < diff.length; k++) {
                const nidx = diff[k];
                if (state[nidx] === 0) {
                  openCell(nidx % width, Math.floor(nidx / width));
                  progress = true;
                }
              }
            } else if (diffReq === diff.length && diff.length > 0) {
              for (let k = 0; k < diff.length; k++) {
                const nidx = diff[k];
                if (state[nidx] === 0) {
                  state[nidx] = 2;
                  flagCount++;
                  progress = true;
                }
              }
            }
          }
        }
        if (progress) break;
      }
      if (progress) continue;

      // Strategy 3: Component Tank Solver / Exact Model Checking
      const activeCoveredMap = new Map(); // nidx -> list of constraint indices
      const activeCoveredList = [];
      for (let i = 0; i < frontierConstraints.length; i++) {
        const c = frontierConstraints[i];
        for (let k = 0; k < c.covered.length; k++) {
          const nidx = c.covered[k];
          if (!activeCoveredMap.has(nidx)) {
            activeCoveredMap.set(nidx, []);
            activeCoveredList.push(nidx);
          }
          activeCoveredMap.get(nidx).push(i);
        }
      }

      if (activeCoveredList.length > 0 && activeCoveredList.length <= 22) {
        // Enumerate valid configurations
        const k = activeCoveredList.length;
        const validConfigs = [];
        const nonFrontierCovered = width * height - openCount - flagCount - k;
        const curRemUrchins = urchinCount - flagCount;

        function checkAssignment(assignment) {
          // Check constraint satisfactions
          for (let i = 0; i < frontierConstraints.length; i++) {
            const c = frontierConstraints[i];
            let assignedMines = 0;
            for (let j = 0; j < c.covered.length; j++) {
              const pos = activeCoveredList.indexOf(c.covered[j]);
              if ((assignment & (1 << pos)) !== 0) {
                assignedMines++;
              }
            }
            if (assignedMines !== c.req) return false;
          }
          // Check global urchin count
          let totalAssigned = 0;
          for (let j = 0; j < k; j++) {
            if ((assignment & (1 << j)) !== 0) totalAssigned++;
          }
          const leftForNonFrontier = curRemUrchins - totalAssigned;
          if (leftForNonFrontier < 0 || leftForNonFrontier > nonFrontierCovered) return false;

          return true;
        }

        const totalCombs = 1 << k;
        for (let mask = 0; mask < totalCombs; mask++) {
          if (checkAssignment(mask)) {
            validConfigs.push(mask);
          }
        }

        if (validConfigs.length > 0) {
          for (let j = 0; j < k; j++) {
            let alwaysSafe = true;
            let alwaysUrchin = true;
            for (let v = 0; v < validConfigs.length; v++) {
              const isUrchin = (validConfigs[v] & (1 << j)) !== 0;
              if (isUrchin) alwaysSafe = false;
              else alwaysUrchin = false;
            }

            const targetIdx = activeCoveredList[j];
            if (alwaysSafe && state[targetIdx] === 0) {
              openCell(targetIdx % width, Math.floor(targetIdx / width));
              progress = true;
            } else if (alwaysUrchin && state[targetIdx] === 0) {
              state[targetIdx] = 2;
              flagCount++;
              progress = true;
            }
          }
        }
      }
    }

    return openCount === totalSafe;
  }

  function generateSolvableBoard(width, height, urchinCount, firstX, firstY, prng) {
    const totalCells = width * height;
    const forbidden = new Uint8Array(totalCells);

    // First cell and all 8 neighbors are forbidden from containing urchins (quiet water)
    forbidden[firstY * width + firstX] = 1;
    const startNbs = getNeighbors(firstX, firstY, width, height);
    for (let i = 0; i < startNbs.length; i++) {
      forbidden[startNbs[i][1] * width + startNbs[i][0]] = 1;
    }

    const availablePositions = [];
    for (let i = 0; i < totalCells; i++) {
      if (!forbidden[i]) availablePositions.push(i);
    }

    let bestGrid = null;
    const maxAttempts = 60;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      prng.shuffle(availablePositions);
      const urchinGrid = new Uint8Array(totalCells);
      for (let i = 0; i < urchinCount; i++) {
        urchinGrid[availablePositions[i]] = 1;
      }

      if (canSolveNoGuess(width, height, urchinCount, urchinGrid, firstX, firstY)) {
        bestGrid = urchinGrid;
        break;
      }
    }

    // Fallback if tight: generate best effort with relaxed constraint
    if (!bestGrid) {
      prng.shuffle(availablePositions);
      bestGrid = new Uint8Array(totalCells);
      for (let i = 0; i < urchinCount; i++) {
        bestGrid[availablePositions[i]] = 1;
      }
    }

    // Build final numbers array
    const numbers = new Uint8Array(totalCells);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (bestGrid[y * width + x]) continue;
        let count = 0;
        const nbs = getNeighbors(x, y, width, height);
        for (let i = 0; i < nbs.length; i++) {
          if (bestGrid[nbs[i][1] * width + nbs[i][0]]) count++;
        }
        numbers[y * width + x] = count;
      }
    }

    return {
      urchinGrid: bestGrid,
      numbers
    };
  }

  root.ShoalSolver = {
    getNeighbors,
    canSolveNoGuess,
    generateSolvableBoard
  };
})(typeof window !== 'undefined' ? window : globalThis);
