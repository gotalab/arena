/**
 * Shoal Game Logic Engine & Production State
 */
(function(root) {
  const RANK_LADDER = [
    "Driftwood",
    "Pebble",
    "Sea Glass",
    "Shell",
    "Anemone",
    "Coral",
    "Pearl",
    "Tide Master",
    "Abyssal Sovereign"
  ];

  function getPoolConfig(poolIndex) {
    if (poolIndex === 1) return { w: 7, h: 8, urchins: 6, tideTicks: 45 * 60 };
    if (poolIndex === 2) return { w: 8, h: 10, urchins: 11, tideTicks: 55 * 60 };
    if (poolIndex === 3) return { w: 9, h: 11, urchins: 16, tideTicks: 65 * 60 };
    if (poolIndex === 4) return { w: 9, h: 13, urchins: 21, tideTicks: 75 * 60 };
    if (poolIndex === 5) return { w: 10, h: 14, urchins: 26, tideTicks: 85 * 60 };
    if (poolIndex === 6) return { w: 10, h: 15, urchins: 30, tideTicks: 95 * 60 };

    const extra = poolIndex - 6;
    const w = Math.min(12, 10 + Math.floor(extra / 3));
    const h = Math.min(16, 15 + Math.floor(extra / 2));
    const total = w * h;
    const urchins = Math.min(Math.floor(total * 0.22), 30 + extra * 4);
    const tideTicks = (95 + extra * 10) * 60;
    return { w, h, urchins, tideTicks };
  }

  function calculateRank(pearls) {
    if (pearls >= 2500) return "Abyssal Sovereign";
    if (pearls >= 1700) return "Tide Master";
    if (pearls >= 1100) return "Pearl";
    if (pearls >= 700) return "Coral";
    if (pearls >= 450) return "Anemone";
    if (pearls >= 250) return "Shell";
    if (pearls >= 120) return "Sea Glass";
    if (pearls >= 50) return "Pebble";
    return "Driftwood";
  }

  function createGame(initialSeed = 1337) {
    let seed = initialSeed;
    let attempt = 1;
    let sessionBest = 0;

    let phase = "ready"; // "ready", "playing", "ended"
    let tick = 0;
    let revision = 0;
    let pool = 1;
    let pearls = 0;
    let moves = 0;
    let rank = null;

    // Signature stats
    let maxRipple = 0;
    let poolStartTick = 0;
    let fastestPoolMs = null;

    // Pool specific state
    let gridWidth = 7;
    let gridHeight = 8;
    let urchinsTotal = 6;
    let tideTicks = 45 * 60;
    let poolElapsedTicks = 0;
    let firstTurnDone = false;
    let stungAt = null;

    // Internal board representations
    // 0: covered, 1: open, 2: flagged
    let cellStates = [];
    let urchinGrid = null;
    let numbers = null;
    let openCount = 0;
    let flagsPlaced = 0;

    let timeAccumulator = 0;
    const TICK_MS = 1000 / 60;

    // Events history
    let events = [];
    let eventSeq = 0;

    function emitEvent(kind, extra = {}) {
      eventSeq++;
      const ev = {
        seq: eventSeq,
        kind,
        tick,
        ...extra
      };
      events.push(ev);
      if (events.length > 200) {
        events.shift();
      }
      return ev;
    }

    function initPool(p) {
      const cfg = getPoolConfig(p);
      gridWidth = cfg.w;
      gridHeight = cfg.h;
      urchinsTotal = cfg.urchins;
      tideTicks = cfg.tideTicks;
      poolElapsedTicks = 0;
      firstTurnDone = false;
      stungAt = null;
      openCount = 0;
      flagsPlaced = 0;
      poolStartTick = tick;

      cellStates = new Uint8Array(gridWidth * gridHeight);
      urchinGrid = null;
      numbers = null;
    }

    function reset(newSeed) {
      if (newSeed !== undefined && newSeed !== null) {
        seed = newSeed;
      }
      phase = "ready";
      tick = 0;
      timeAccumulator = 0;
      revision = 0;
      pool = 1;
      pearls = 0;
      moves = 0;
      rank = null;
      maxRipple = 0;
      fastestPoolMs = null;
      events = [];
      eventSeq = 0;

      initPool(1);
      return snapshot();
    }

    function restart() {
      attempt++;
      return reset(seed);
    }

    function advance(ms) {
      if (phase !== "playing" || ms <= 0) return;
      timeAccumulator += ms;
      while (timeAccumulator >= TICK_MS - 1e-6) {
        tick++;
        if (firstTurnDone && phase === "playing") {
          poolElapsedTicks++;
        }
        timeAccumulator -= TICK_MS;
        if (timeAccumulator < 0) timeAccumulator = 0;
      }
    }

    function generateBoard(firstX, firstY) {
      const prng = root.ShoalPRNG.createPRNG(
        root.ShoalPRNG.hashString(`${seed}_pool${pool}_${firstX}_${firstY}`)
      );
      const generated = root.ShoalSolver.generateSolvableBoard(
        gridWidth, gridHeight, urchinsTotal, firstX, firstY, prng
      );
      urchinGrid = generated.urchinGrid;
      numbers = generated.numbers;
      firstTurnDone = true;
    }

    function openRecursive(x, y) {
      const idx = y * gridWidth + x;
      if (cellStates[idx] !== 0) return 0;

      cellStates[idx] = 1;
      openCount++;
      let count = 1;

      if (numbers[idx] === 0) {
        const queue = [[x, y]];
        while (queue.length > 0) {
          const [cx, cy] = queue.shift();
          const nbs = root.ShoalSolver.getNeighbors(cx, cy, gridWidth, gridHeight);
          for (let i = 0; i < nbs.length; i++) {
            const [nx, ny] = nbs[i];
            const nidx = ny * gridWidth + nx;
            // Spreading water flows around standing pennants and never turns them
            if (cellStates[nidx] === 0) {
              cellStates[nidx] = 1;
              openCount++;
              count++;
              if (numbers[nidx] === 0) {
                queue.push([nx, ny]);
              }
            }
          }
        }
      }
      return count;
    }

    function checkPoolClear() {
      const totalSafe = gridWidth * gridHeight - urchinsTotal;
      if (openCount >= totalSafe && phase === "playing") {
        const tideFrac = Math.max(0, 1 - poolElapsedTicks / tideTicks);
        const poolClearBonus = pool * 50 + Math.round(pool * 100 * tideFrac);
        pearls += poolClearBonus;

        const poolDurationMs = Math.round((tick - poolStartTick) * (1000 / 60));
        if (fastestPoolMs === null || poolDurationMs < fastestPoolMs) {
          fastestPoolMs = poolDurationMs;
        }

        emitEvent("pool_clear", { pool });

        // Advance to next pool
        pool++;
        initPool(pool);
        return true;
      }
      return false;
    }

    function endRun(fatalPos = null) {
      phase = "ended";
      stungAt = fatalPos;
      if (pearls > sessionBest) {
        sessionBest = pearls;
      }
      rank = calculateRank(pearls);
      if (fatalPos) {
        emitEvent("sting");
      }
      emitEvent("run_end");
    }

    function act(action) {
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return null; // illegal
      }

      if (phase === "ended") {
        return null;
      }

      const { type, x, y } = action;
      if (typeof x !== "number" || typeof y !== "number" ||
          x < 0 || x >= gridWidth || y < 0 || y >= gridHeight ||
          !Number.isInteger(x) || !Number.isInteger(y)) {
        return null;
      }

      const idx = y * gridWidth + x;

      if (type === "open") {
        if (cellStates[idx] !== 0) {
          return null; // cannot open open or flagged
        }

        if (phase === "ready") {
          phase = "playing";
        }

        if (!firstTurnDone) {
          generateBoard(x, y);
        }

        moves++;
        revision++;

        // Urchin hit
        if (urchinGrid[idx] === 1) {
          emitEvent("open", { opened: 0 });
          endRun({ x, y });
          return getVisibleState();
        }

        const opened = openRecursive(x, y);
        pearls += opened;
        if (opened > maxRipple) {
          maxRipple = opened;
        }

        emitEvent("open", { opened });
        checkPoolClear();
        return getVisibleState();
      }

      if (type === "flag") {
        if (cellStates[idx] !== 0) {
          return null; // can only flag covered unflagged
        }
        if (phase === "ready") {
          phase = "playing";
        }
        cellStates[idx] = 2;
        flagsPlaced++;
        moves++;
        revision++;
        emitEvent("flag");
        return getVisibleState();
      }

      if (type === "unflag") {
        if (cellStates[idx] !== 2) {
          return null; // can only unflag flagged
        }
        cellStates[idx] = 0;
        flagsPlaced--;
        moves++;
        revision++;
        emitEvent("unflag");
        return getVisibleState();
      }

      if (type === "sweep") {
        if (cellStates[idx] !== 1) {
          return null; // can only sweep open number
        }

        const nbs = root.ShoalSolver.getNeighbors(x, y, gridWidth, gridHeight);
        let flagCount = 0;
        const unflaggedCovered = [];

        for (let i = 0; i < nbs.length; i++) {
          const [nx, ny] = nbs[i];
          const nidx = ny * gridWidth + nx;
          if (cellStates[nidx] === 2) flagCount++;
          else if (cellStates[nidx] === 0) unflaggedCovered.push([nx, ny, nidx]);
        }

        if (flagCount !== numbers[idx]) {
          return null; // sweep unsatisfied
        }

        moves++;
        revision++;

        // Check if any hit urchin
        let hitFatal = null;
        let totalOpened = 0;

        for (let i = 0; i < unflaggedCovered.length; i++) {
          const [nx, ny, nidx] = unflaggedCovered[i];
          if (urchinGrid[nidx] === 1) {
            if (!hitFatal) hitFatal = { x: nx, y: ny };
          }
        }

        if (hitFatal) {
          emitEvent("sweep", { opened: 0 });
          endRun(hitFatal);
          return getVisibleState();
        }

        for (let i = 0; i < unflaggedCovered.length; i++) {
          const [nx, ny] = unflaggedCovered[i];
          const op = openRecursive(nx, ny);
          totalOpened += op;
        }

        pearls += totalOpened;
        if (totalOpened > maxRipple) {
          maxRipple = totalOpened;
        }

        emitEvent("sweep", { opened: totalOpened });
        checkPoolClear();
        return getVisibleState();
      }

      return null;
    }

    function getRows() {
      const rows = [];
      const isEnded = phase === "ended";

      for (let y = 0; y < gridHeight; y++) {
        let rowStr = "";
        for (let x = 0; x < gridWidth; x++) {
          const idx = y * gridWidth + x;
          const st = cellStates[idx];

          if (isEnded) {
            if (stungAt && stungAt.x === x && stungAt.y === y) {
              rowStr += "X";
            } else if (st === 2) {
              // Pennanted cell
              if (urchinGrid && urchinGrid[idx] === 1) {
                rowStr += "+";
              } else {
                rowStr += "-";
              }
            } else if (st === 0 && urchinGrid && urchinGrid[idx] === 1) {
              rowStr += "*";
            } else if (st === 1) {
              rowStr += String(numbers[idx]);
            } else {
              rowStr += "#";
            }
          } else {
            if (st === 0) {
              rowStr += "#";
            } else if (st === 2) {
              rowStr += "F";
            } else {
              rowStr += String(numbers ? numbers[idx] : 0);
            }
          }
        }
        rows.push(rowStr);
      }
      return rows;
    }

    function getTideFraction() {
      if (!firstTurnDone || phase === "ready") return 1;
      return Math.max(0, 1 - poolElapsedTicks / tideTicks);
    }

    function getVisibleState() {
      return {
        phase,
        tick,
        elapsedMs: Math.round(tick * (1000 / 60)),
        seed,
        attempt,
        revision,
        pool,
        pearls,
        sessionBest,
        moves,
        rank,
        rankLadder: RANK_LADDER,
        gridWidth,
        gridHeight,
        urchinsTotal,
        flagsPlaced,
        urchinsLeft: urchinsTotal - flagsPlaced,
        tideFraction: getTideFraction(),
        firstTurnDone,
        stungAt,
        rows: getRows()
      };
    }

    function snapshot() {
      const vis = getVisibleState();
      return {
        ...vis,
        events: [...events],
        lastEvent: events.length > 0 ? events[events.length - 1] : null
      };
    }

    function getStats() {
      return {
        maxRipple,
        fastestPoolMs,
        maxPoolReached: pool
      };
    }

    // Initialize
    initPool(1);

    return {
      reset,
      restart,
      act,
      advance,
      snapshot,
      getVisibleState,
      getStats
    };
  }

  root.ShoalGame = {
    createGame,
    RANK_LADDER
  };
})(typeof window !== 'undefined' ? window : globalThis);
