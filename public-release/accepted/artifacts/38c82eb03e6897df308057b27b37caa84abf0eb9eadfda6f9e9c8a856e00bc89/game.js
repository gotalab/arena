/**
 * SHOAL - Production Game Engine & Arena Bridge
 */

import { generateSolvableBoard, getPoolConfig, getNeighbors } from './solver.js';
import { sound } from './audio.js';

export const RANK_LADDER = [
  "Driftwood",
  "Sea Glass",
  "Sand Dollar",
  "Ambergris",
  "Conch",
  "Nautilus",
  "Black Pearl",
  "Abyssal Crown"
];

export function computeRank(pearls) {
  if (pearls >= 750) return RANK_LADDER[7];
  if (pearls >= 500) return RANK_LADDER[6];
  if (pearls >= 320) return RANK_LADDER[5];
  if (pearls >= 200) return RANK_LADDER[4];
  if (pearls >= 120) return RANK_LADDER[3];
  if (pearls >= 60) return RANK_LADDER[2];
  if (pearls >= 25) return RANK_LADDER[1];
  return RANK_LADDER[0];
}

export class ShoalGame {
  constructor(initialSeed = null) {
    this.sessionBest = 0;
    this.attempt = 0;
    this.defaultSeed = initialSeed || Math.floor(Math.random() * 1000000);
    this.currentSeed = this.defaultSeed;

    this.onStateChangeCallbacks = [];
    this.onVisualEventCallbacks = [];

    this.reset(this.defaultSeed, true);
  }

  onStateChange(cb) {
    this.onStateChangeCallbacks.push(cb);
  }

  onVisualEvent(cb) {
    this.onVisualEventCallbacks.push(cb);
  }

  notifyStateChange() {
    for (const cb of this.onStateChangeCallbacks) cb(this.getSnapshot());
  }

  notifyVisualEvent(evt) {
    for (const cb of this.onVisualEventCallbacks) cb(evt);
  }

  reset(seed = null, isFirstInit = false) {
    if (seed !== null && seed !== undefined) {
      this.currentSeed = seed;
    }
    this.attempt++;
    this.revision = 0;
    this.phase = "ready"; // "ready" | "playing" | "ended"
    this.tick = 0;
    this.elapsedMs = 0;
    this.pool = 1;
    this.pearls = 0;
    this.moves = 0;
    this.rank = null;
    this.stungAt = null;
    this.firstTurnDone = false;
    this.events = [];
    this.eventSeq = 0;

    // Statistics for post-mortem bragging right
    this.stats = {
      greatestRipple: 0,
      deepestPool: 1,
      totalUrchinsPennanted: 0,
      fastestClearSeconds: null,
      poolStartTick: 0
    };

    this.setupPool(this.pool);
    this.notifyStateChange();
    return this.getSnapshot();
  }

  restart() {
    return this.reset(this.currentSeed);
  }

  setupPool(poolNum) {
    this.pool = poolNum;
    this.stats.deepestPool = Math.max(this.stats.deepestPool, poolNum);
    const config = getPoolConfig(poolNum);
    this.gridWidth = config.width;
    this.gridHeight = config.height;
    this.urchinsTotal = config.urchins;
    this.tideSeconds = config.tideSeconds;
    this.tideFraction = 1.0;
    this.flagsPlaced = 0;
    this.firstTurnDone = false;
    this.boardGenerated = false;
    this.generatedBoard = null;

    // Cell state:
    // status: 'covered' | 'flagged' | 'open'
    // count: 0-8
    // isMine: boolean
    this.cells = Array.from({ length: this.gridHeight }, (_, y) =>
      Array.from({ length: this.gridWidth }, (_, x) => ({
        x,
        y,
        status: 'covered',
        isMine: false,
        count: 0
      }))
    );

    this.poolStartTick = this.tick;
  }

  addEvent(kind, extra = {}) {
    this.eventSeq++;
    const evt = {
      seq: this.eventSeq,
      kind,
      tick: this.tick,
      ...extra
    };
    this.events.push(evt);
    if (this.events.length > 250) {
      this.events.shift();
    }
    return evt;
  }

  getLastEvent() {
    return this.events.length > 0 ? this.events[this.events.length - 1] : null;
  }

  getSnapshot() {
    const rows = [];
    for (let y = 0; y < this.gridHeight; y++) {
      let rowStr = '';
      for (let x = 0; x < this.gridWidth; x++) {
        const cell = this.cells[y][x];
        if (this.phase === "ended" && this.stungAt) {
          // Post-mortem display
          if (cell.x === this.stungAt.x && cell.y === this.stungAt.y) {
            rowStr += 'X';
          } else if (cell.status === 'open') {
            rowStr += String(cell.count);
          } else if (cell.status === 'flagged') {
            rowStr += cell.isMine ? '+' : '-';
          } else if (cell.isMine) {
            rowStr += '*';
          } else {
            rowStr += '#';
          }
        } else {
          // Normal playable / ready snapshot
          if (cell.status === 'covered') {
            rowStr += '#';
          } else if (cell.status === 'flagged') {
            rowStr += 'F';
          } else if (cell.status === 'open') {
            rowStr += String(cell.count);
          }
        }
      }
      rows.push(rowStr);
    }

    return {
      phase: this.phase,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      seed: this.currentSeed,
      attempt: this.attempt,
      revision: this.revision,
      pool: this.pool,
      pearls: this.pearls,
      sessionBest: this.sessionBest,
      moves: this.moves,
      rank: this.rank,
      rankLadder: RANK_LADDER,
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      urchinsTotal: this.urchinsTotal,
      flagsPlaced: this.flagsPlaced,
      urchinsLeft: this.urchinsTotal - this.flagsPlaced,
      tideFraction: Number(this.tideFraction.toFixed(4)),
      firstTurnDone: this.firstTurnDone,
      stungAt: this.stungAt ? { x: this.stungAt.x, y: this.stungAt.y } : null,
      rows,
      events: [...this.events],
      lastEvent: this.getLastEvent()
    };
  }

  getBridgeState() {
    const snap = this.getSnapshot();
    const { events, lastEvent, ...bridgeState } = snap;
    return bridgeState;
  }

  /**
   * fixed 60Hz advance simulation clock
   */
  advance(ms) {
    if (this.phase !== "playing" || !this.firstTurnDone) return this.getSnapshot();
    if (ms <= 0) return this.getSnapshot();

    const dtTick = Math.max(1, Math.round(ms * 0.06));
    this.tick += dtTick;
    this.elapsedMs = Math.round(this.tick * (1000 / 60));

    // Update tide fraction for current pool
    const poolTicks = this.tick - this.poolStartTick;
    const totalPoolTicks = this.tideSeconds * 60;
    this.tideFraction = Math.max(0, 1 - (poolTicks / totalPoolTicks));

    this.notifyStateChange();
    return this.getSnapshot();
  }

  stepSimTick() {
    if (this.phase === "playing" && this.firstTurnDone) {
      this.tick++;
      this.elapsedMs = Math.round(this.tick * (1000 / 60));
      const poolTicks = this.tick - this.poolStartTick;
      const totalPoolTicks = this.tideSeconds * 60;
      this.tideFraction = Math.max(0, 1 - (poolTicks / totalPoolTicks));
    }
  }

  act(action) {
    if (!action || typeof action !== 'object') {
      return { success: false, error: 'Invalid action object' };
    }

    if (this.phase === "ended") {
      return { success: false, error: 'Run has already ended' };
    }

    const { type, x, y } = action;

    if (typeof x !== 'number' || typeof y !== 'number' ||
        x < 0 || x >= this.gridWidth || y < 0 || y >= this.gridHeight) {
      return { success: false, error: 'Coordinates out of bounds' };
    }

    const cell = this.cells[y][x];

    if (type === "open") {
      if (cell.status !== 'covered') {
        return { success: false, error: 'Cannot open non-covered cell' };
      }

      // First turn generation
      if (!this.firstTurnDone) {
        const gen = generateSolvableBoard(this.currentSeed, this.pool, x, y);
        this.applyGeneratedBoard(gen);
        this.firstTurnDone = true;
        this.phase = "playing";
        this.poolStartTick = this.tick;
      }

      // Check sting
      if (cell.isMine) {
        return this.triggerSting(x, y);
      }

      // Safe open + ripple
      const openedCells = this.revealCellCascade(x, y);
      const openedCount = openedCells.length;
      this.pearls += openedCount;
      this.sessionBest = Math.max(this.sessionBest, this.pearls);
      this.moves++;
      this.revision++;

      this.stats.greatestRipple = Math.max(this.stats.greatestRipple, openedCount);

      this.addEvent('open', { opened: openedCount });
      this.notifyVisualEvent({ type: 'open_cascade', cells: openedCells, origin: { x, y } });

      sound.playTurn(0);

      // Check pool clear
      this.checkPoolClear();
      this.notifyStateChange();
      return { success: true, snapshot: this.getSnapshot() };
    }

    if (type === "flag") {
      if (cell.status !== 'covered') {
        return { success: false, error: 'Can only flag covered cells' };
      }
      cell.status = 'flagged';
      this.flagsPlaced++;
      this.moves++;
      this.revision++;
      this.addEvent('flag');
      sound.playFlag();
      this.notifyVisualEvent({ type: 'flag', x, y });
      this.notifyStateChange();
      return { success: true, snapshot: this.getSnapshot() };
    }

    if (type === "unflag") {
      if (cell.status !== 'flagged') {
        return { success: false, error: 'Can only unflag flagged cells' };
      }
      cell.status = 'covered';
      this.flagsPlaced--;
      this.moves++;
      this.revision++;
      this.addEvent('unflag');
      sound.playUnflag();
      this.notifyVisualEvent({ type: 'unflag', x, y });
      this.notifyStateChange();
      return { success: true, snapshot: this.getSnapshot() };
    }

    if (type === "sweep") {
      if (cell.status !== 'open') {
        return { success: false, error: 'Can only sweep open numbered cells' };
      }

      const neighbors = getNeighbors(x, y, this.gridWidth, this.gridHeight);
      let flagCount = 0;
      const unflaggedNeighbors = [];

      for (const n of neighbors) {
        const nc = this.cells[n.y][n.x];
        if (nc.status === 'flagged') {
          flagCount++;
        } else if (nc.status === 'covered') {
          unflaggedNeighbors.push(nc);
        }
      }

      if (flagCount !== cell.count || unflaggedNeighbors.length === 0) {
        return { success: false, error: 'Sweep condition not met: flag count does not match cell number' };
      }

      // Check if any swept cell is an urchin
      for (const nc of unflaggedNeighbors) {
        if (nc.isMine) {
          return this.triggerSting(nc.x, nc.y);
        }
      }

      // All unflagged neighbors are safe!
      let totalOpened = [];
      for (const nc of unflaggedNeighbors) {
        if (nc.status === 'covered') {
          const opened = this.revealCellCascade(nc.x, nc.y);
          totalOpened.push(...opened);
        }
      }

      // Unique opened
      const uniqueMap = new Map();
      for (const c of totalOpened) {
        uniqueMap.set(`${c.x},${c.y}`, c);
      }
      const uniqueOpened = Array.from(uniqueMap.values());
      const openedCount = uniqueOpened.length;

      this.pearls += openedCount;
      this.sessionBest = Math.max(this.sessionBest, this.pearls);
      this.moves++;
      this.revision++;

      this.stats.greatestRipple = Math.max(this.stats.greatestRipple, openedCount);

      this.addEvent('sweep', { opened: openedCount });
      sound.playSweep();
      this.notifyVisualEvent({ type: 'sweep', cells: uniqueOpened, origin: { x, y } });

      this.checkPoolClear();
      this.notifyStateChange();
      return { success: true, snapshot: this.getSnapshot() };
    }

    return { success: false, error: `Unknown action type: ${type}` };
  }

  applyGeneratedBoard(gen) {
    this.boardGenerated = true;
    this.generatedBoard = gen;
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        this.cells[y][x].isMine = gen.grid[y][x].isMine;
        this.cells[y][x].count = gen.grid[y][x].count;
      }
    }
  }

  revealCellCascade(startX, startY) {
    const revealed = [];
    const queue = [{ x: startX, y: startY, dist: 0 }];
    const visited = new Set();
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const { x, y, dist } = queue.shift();
      const cell = this.cells[y][x];

      if (cell.status === 'covered') {
        cell.status = 'open';
        revealed.push({ x, y, count: cell.count, dist });
      }

      if (cell.count === 0) {
        for (const n of getNeighbors(x, y, this.gridWidth, this.gridHeight)) {
          const key = `${n.x},${n.y}`;
          const nc = this.cells[n.y][n.x];
          if (!visited.has(key) && nc.status === 'covered' && !nc.isMine) {
            visited.add(key);
            queue.push({ x: n.x, y: n.y, dist: dist + 1 });
          }
        }
      }
    }

    return revealed;
  }

  triggerSting(x, y) {
    this.stungAt = { x, y };
    this.phase = "ended";
    this.rank = computeRank(this.pearls);
    this.sessionBest = Math.max(this.sessionBest, this.pearls);
    this.moves++;
    this.revision++;

    sound.playSting();
    this.addEvent('sting');
    this.addEvent('run_end');
    this.notifyVisualEvent({ type: 'sting', fatalCell: { x, y } });
    this.notifyStateChange();

    return { success: true, snapshot: this.getSnapshot() };
  }

  checkPoolClear() {
    let unrevealedSafe = 0;
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const c = this.cells[y][x];
        if (!c.isMine && c.status !== 'open') {
          unrevealedSafe++;
        }
      }
    }

    if (unrevealedSafe === 0) {
      // Pool cleared!
      const clearBonus = (this.pool * 25) + Math.round(this.pool * 50 * this.tideFraction);
      this.pearls += clearBonus;
      this.sessionBest = Math.max(this.sessionBest, this.pearls);

      const clearedPoolNum = this.pool;
      this.addEvent('pool_clear', { pool: clearedPoolNum });
      sound.playClear();
      this.notifyVisualEvent({ type: 'pool_clear', pool: clearedPoolNum, bonus: clearBonus });

      // Flow directly to next pool
      this.setupPool(clearedPoolNum + 1);
    }
  }
}
