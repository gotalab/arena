if (typeof getPoolConfig === "undefined" && typeof require !== "undefined") {
  const _solver = require("./solver.js");
  getPoolConfig = _solver.getPoolConfig;
  computeAdjacentList = _solver.computeAdjacentList;
  generateSolvableBoard = _solver.generateSolvableBoard;
}
// Core game state and simulation rules for SHOAL
// Deterministic, self-contained, adheres strictly to the production brief.

const RANK_LADDER = [
  "Driftwood",
  "Sea Glass",
  "Limpet",
  "Hermit Crab",
  "Anemone",
  "Nautilus",
  "Pearl Diver",
  "Abyssal Sovereign"
];

function computeRank(pearls) {
  if (pearls >= 1800) return "Abyssal Sovereign";
  if (pearls >= 1200) return "Pearl Diver";
  if (pearls >= 800) return "Nautilus";
  if (pearls >= 500) return "Anemone";
  if (pearls >= 300) return "Hermit Crab";
  if (pearls >= 150) return "Limpet";
  if (pearls >= 50) return "Sea Glass";
  return "Driftwood";
}

class ShoalGame {
  constructor(initialSeed = 10001) {
    this.sessionBest = 0;
    this.attempt = 1;
    this.initialSeed = initialSeed;
    this.reset(initialSeed);
  }

  reset(seed = this.initialSeed) {
    this.seed = seed;
    this.phase = "ready"; // "ready", "playing", "ended"
    this.tick = 0;
    this.elapsedMs = 0;
    this.accumulatorMs = 0;
    this.revision = 0;
    this.pool = 1;
    this.pearls = 0;
    this.moves = 0;
    this.rank = null;
    this.stungAt = null;
    this.maxRipple = 0;

    // Events history
    this.events = [];
    this.lastEvent = null;
    this.eventSeq = 0;

    this.initPool(1);
  }

  restart() {
    this.attempt++;
    const currentSeed = this.seed;
    this.phase = "ready";
    this.tick = 0;
    this.elapsedMs = 0;
    this.accumulatorMs = 0;
    this.revision = 0;
    this.pool = 1;
    this.pearls = 0;
    this.moves = 0;
    this.rank = null;
    this.stungAt = null;
    this.maxRipple = 0;

    this.events = [];
    this.lastEvent = null;
    this.eventSeq = 0;

    this.initPool(1);
    return this.getVisibleState();
  }

  initPool(poolNumber) {
    this.pool = poolNumber;
    const config = getPoolConfig(poolNumber);
    this.gridWidth = config.w;
    this.gridHeight = config.h;
    this.urchinsTotal = config.urchins;
    this.tideSeconds = config.tideSeconds;
    this.flagsPlaced = 0;
    this.urchinsLeft = this.urchinsTotal;
    this.tideFraction = 1.0;
    this.firstTurnDone = false;
    this.poolElapsedTicks = 0;

    const size = this.gridWidth * this.gridHeight;
    this.mines = new Uint8Array(size);
    this.numbers = new Int8Array(size);
    this.revealed = new Uint8Array(size);
    this.flagged = new Uint8Array(size);
    this.adj = computeAdjacentList(this.gridWidth, this.gridHeight);

    this.updateRows();
  }

  pushEvent(kind, extra = {}) {
    this.eventSeq++;
    const evt = {
      seq: this.eventSeq,
      kind: kind,
      tick: this.tick,
      ...extra
    };
    this.events.push(evt);
    if (this.events.length > 250) {
      this.events.shift();
    }
    this.lastEvent = evt;
    return evt;
  }

  advance(ms) {
    if (this.phase === "ready" || this.phase === "ended") {
      return;
    }
    if (typeof ms !== "number" || ms <= 0) return;

    this.accumulatorMs += ms;
    const stepMs = 1000 / 60;
    while (this.accumulatorMs >= stepMs) {
      this.accumulatorMs -= stepMs;
      this.tick++;
      this.elapsedMs = Math.round(this.tick * (1000 / 60));
      if (this.firstTurnDone && this.phase === "playing") {
        this.poolElapsedTicks++;
        const totalTicks = this.tideSeconds * 60;
        this.tideFraction = Math.max(0, 1 - (this.poolElapsedTicks / totalTicks));
      }
    }
  }

  updateRows() {
    const rows = [];
    const w = this.gridWidth;
    const h = this.gridHeight;

    for (let y = 0; y < h; y++) {
      let rowStr = "";
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (this.phase === "ended") {
          if (this.stungAt && this.stungAt.x === x && this.stungAt.y === y) {
            rowStr += "X";
          } else if (this.mines[idx] === 1) {
            if (this.flagged[idx] === 1) {
              rowStr += "+";
            } else {
              rowStr += "*";
            }
          } else {
            // safe cell
            if (this.flagged[idx] === 1) {
              rowStr += "-";
            } else if (this.revealed[idx] === 1) {
              rowStr += String(this.numbers[idx]);
            } else {
              rowStr += "#";
            }
          }
        } else {
          // Playable / Ready phase
          if (this.flagged[idx] === 1) {
            rowStr += "F";
          } else if (this.revealed[idx] === 1) {
            rowStr += String(this.numbers[idx]);
          } else {
            rowStr += "#";
          }
        }
      }
      rows.push(rowStr);
    }
    this.rows = rows;
  }

  act(action) {
    if (!action || typeof action !== "object") {
      return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Invalid action object" };
    }
    if (this.phase === "ended") {
      return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Run has already ended" };
    }

    const { type, x, y } = action;
    if (typeof x !== "number" || typeof y !== "number" ||
        x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) {
      return { accepted: false, errorCode: "OUT_OF_BOUNDS", errorMessage: `Coordinates (${x}, ${y}) out of bounds` };
    }

    const idx = y * this.gridWidth + x;

    if (type === "open") {
      if (this.revealed[idx] === 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Shell is already turned" };
      }
      if (this.flagged[idx] === 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Cannot turn a pennanted shell" };
      }

      // First turn of the pool
      if (this.phase === "ready") {
        this.phase = "playing";
      }

      if (!this.firstTurnDone) {
        const generated = generateSolvableBoard(this.seed, this.pool, x, y);
        this.mines = generated.mines;
        this.numbers = generated.numbers;
        this.adj = generated.adj;
        this.firstTurnDone = true;
      }

      this.revision++;
      this.moves++;

      if (this.mines[idx] === 1) {
        // Urchin hit: sting!
        this.phase = "ended";
        this.stungAt = { x, y };
        this.rank = computeRank(this.pearls);
        this.updateRows();
        this.pushEvent("sting");
        this.pushEvent("run_end");
        return { accepted: true, state: this.getVisibleState() };
      }

      // Safe turn
      const newlyOpened = this.performReveal(idx);
      this.pearls += newlyOpened;
      if (this.pearls > this.sessionBest) {
        this.sessionBest = this.pearls;
      }
      if (newlyOpened > this.maxRipple) {
        this.maxRipple = newlyOpened;
      }
      this.pushEvent("open", { opened: newlyOpened });

      // Check pool clear
      this.checkPoolClear();
      this.updateRows();
      return { accepted: true, state: this.getVisibleState(), opened: newlyOpened };
    }

    if (type === "flag") {
      if (this.revealed[idx] === 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Cannot plant a pennant on an open shell" };
      }
      if (this.flagged[idx] === 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Shell already has a pennant" };
      }

      this.flagged[idx] = 1;
      this.flagsPlaced++;
      this.urchinsLeft = this.urchinsTotal - this.flagsPlaced;
      this.revision++;
      this.moves++;
      this.updateRows();
      this.pushEvent("flag");
      return { accepted: true, state: this.getVisibleState() };
    }

    if (type === "unflag") {
      if (this.flagged[idx] !== 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "No pennant stands here to lift" };
      }

      this.flagged[idx] = 0;
      this.flagsPlaced--;
      this.urchinsLeft = this.urchinsTotal - this.flagsPlaced;
      this.revision++;
      this.moves++;
      this.updateRows();
      this.pushEvent("unflag");
      return { accepted: true, state: this.getVisibleState() };
    }

    if (type === "sweep") {
      if (this.revealed[idx] !== 1) {
        return { accepted: false, errorCode: "ILLEGAL_ACTION", errorMessage: "Sweeping a covered shell is illegal" };
      }

      const num = this.numbers[idx];
      const neighbors = this.adj[idx];
      let flgCount = 0;
      const unflaggedCovered = [];

      for (let i = 0; i < neighbors.length; i++) {
        const n = neighbors[i];
        if (this.flagged[n] === 1) {
          flgCount++;
        } else if (this.revealed[n] === 0) {
          unflaggedCovered.push(n);
        }
      }

      if (flgCount !== num) {
        return { accepted: false, errorCode: "UNSATISFIED_SWEEP", errorMessage: `Pennant count ${flgCount} does not match shell number ${num}` };
      }

      this.revision++;
      this.moves++;

      if (unflaggedCovered.length === 0) {
        this.pushEvent("sweep", { opened: 0 });
        this.updateRows();
        return { accepted: true, state: this.getVisibleState(), opened: 0 };
      }

      // Check if any covered neighbor hides an urchin
      let fatalIdx = -1;
      for (let i = 0; i < unflaggedCovered.length; i++) {
        const c = unflaggedCovered[i];
        if (this.mines[c] === 1) {
          fatalIdx = c;
          break;
        }
      }

      if (fatalIdx !== -1) {
        // Sting!
        this.phase = "ended";
        this.stungAt = {
          x: fatalIdx % this.gridWidth,
          y: Math.floor(fatalIdx / this.gridWidth)
        };
        this.rank = computeRank(this.pearls);
        this.updateRows();
        this.pushEvent("sting");
        this.pushEvent("run_end");
        return { accepted: true, state: this.getVisibleState() };
      }

      // Safe sweep
      let newlyOpened = 0;
      for (let i = 0; i < unflaggedCovered.length; i++) {
        newlyOpened += this.performReveal(unflaggedCovered[i]);
      }

      this.pearls += newlyOpened;
      if (this.pearls > this.sessionBest) {
        this.sessionBest = this.pearls;
      }
      if (newlyOpened > this.maxRipple) {
        this.maxRipple = newlyOpened;
      }
      this.pushEvent("sweep", { opened: newlyOpened });

      this.checkPoolClear();
      this.updateRows();
      return { accepted: true, state: this.getVisibleState(), opened: newlyOpened };
    }

    return { accepted: false, errorCode: "UNKNOWN_ACTION", errorMessage: `Unknown action type: ${type}` };
  }

  performReveal(startIdx) {
    if (this.revealed[startIdx] === 1 || this.flagged[startIdx] === 1) return 0;

    let count = 0;
    const queue = [startIdx];
    this.revealed[startIdx] = 1;
    count++;

    while (queue.length > 0) {
      const curr = queue.shift();
      if (this.numbers[curr] === 0) {
        const neighbors = this.adj[curr];
        for (let i = 0; i < neighbors.length; i++) {
          const n = neighbors[i];
          // Brief: Spreading water flows around a standing pennant and never turns a pennanted shell
          if (this.revealed[n] === 0 && this.flagged[n] === 0) {
            this.revealed[n] = 1;
            count++;
            if (this.numbers[n] === 0) {
              queue.push(n);
            }
          }
        }
      }
    }
    return count;
  }

  checkPoolClear() {
    const totalSafe = this.gridWidth * this.gridHeight - this.urchinsTotal;
    let revealedCount = 0;
    for (let i = 0; i < this.revealed.length; i++) {
      if (this.revealed[i] === 1) revealedCount++;
    }

    if (revealedCount >= totalSafe) {
      // Pool cleared!
      const clearedPool = this.pool;
      const baseBonus = clearedPool * 50;
      const tideBonus = Math.round(this.tideFraction * clearedPool * 50);
      const poolBonus = baseBonus + tideBonus;
      this.pearls += poolBonus;
      if (this.pearls > this.sessionBest) {
        this.sessionBest = this.pearls;
      }

      this.pushEvent("pool_clear", { pool: clearedPool });

      // Flow directly into the next bigger pool
      this.initPool(clearedPool + 1);
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      seed: this.seed,
      attempt: this.attempt,
      revision: this.revision,
      pool: this.pool,
      pearls: this.pearls,
      sessionBest: this.sessionBest,
      moves: this.moves,
      rank: this.rank,
      rankLadder: RANK_LADDER.slice(),

      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      urchinsTotal: this.urchinsTotal,
      flagsPlaced: this.flagsPlaced,
      urchinsLeft: this.urchinsLeft,
      tideFraction: Number(this.tideFraction.toFixed(4)),
      firstTurnDone: this.firstTurnDone,
      stungAt: this.stungAt ? { ...this.stungAt } : null,

      rows: this.rows.slice(),
      events: this.events.map(e => ({ ...e })),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null
    };
  }

  getVisibleState() {
    const snap = this.snapshot();
    const { events, lastEvent, ...visible } = snap;
    return visible;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShoalGame, RANK_LADDER, computeRank };
}
