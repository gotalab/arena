import { PRNG } from './prng.js';

export const PREVIEW_HORIZON_DISTANCE = 1100; // Units ahead of player in preview horizon
export const PLAYER_RADIUS = 14;

export class CourseGenerator {
  constructor(seed = 123456789) {
    this.seed = seed;
    this.prng = new PRNG(seed);
    this.initCurves();

    this.nextEntityId = 1;
    this.nextFormationId = 1;

    // Generated chunks / entities
    this.generatedDepth = 0;
    this.rocks = [];
    this.items = [];

    // Track power spawn intervals
    this.nextPowerDepth = 4200; // Guaranteed within first ~25-30s of digging
  }

  initCurves() {
    // Multi-octave sinusoidal parameters
    this.prng.setSeed(this.seed);
    this.harmonic1 = {
      amp: this.prng.range(120, 160),
      len: this.prng.range(700, 1000),
      phase: this.prng.range(0, Math.PI * 2)
    };
    this.harmonic2 = {
      amp: this.prng.range(50, 80),
      len: this.prng.range(300, 500),
      phase: this.prng.range(0, Math.PI * 2)
    };
    this.harmonic3 = {
      amp: this.prng.range(20, 35),
      len: this.prng.range(150, 250),
      phase: this.prng.range(0, Math.PI * 2)
    };
  }

  reset(seed) {
    this.seed = seed;
    this.prng.setSeed(seed);
    this.initCurves();
    this.nextEntityId = 1;
    this.nextFormationId = 1;
    this.generatedDepth = 0;
    this.rocks = [];
    this.items = [];
    this.nextPowerDepth = 4200;

    // Generate initial stretch ahead (e.g. 2000 depth)
    this.generateUpTo(2000);
  }

  getCenter(depth) {
    if (depth <= 0) return 0;
    const h1 = this.harmonic1.amp * Math.sin(depth / this.harmonic1.len + this.harmonic1.phase);
    const h2 = this.harmonic2.amp * Math.sin(depth / this.harmonic2.len + this.harmonic2.phase);
    const h3 = this.harmonic3.amp * Math.sin(depth / this.harmonic3.len + this.harmonic3.phase);
    // Smooth dampening at start
    const damp = Math.min(1, depth / 400);
    return (h1 + h2 + h3) * damp;
  }

  getHalfWidth(depth) {
    // Starts at 150, slowly tightens to 118 at depth 30000
    const progress = Math.min(1, depth / 30000);
    return 150 - progress * 32;
  }

  getTangent(depth) {
    const delta = 2;
    const c1 = this.getCenter(depth - delta);
    const c2 = this.getCenter(depth + delta);
    return (c2 - c1) / (delta * 2);
  }

  sampleWalls(minDepth, maxDepth, step = 25) {
    const walls = [];
    const startD = Math.floor(minDepth / step) * step;
    for (let d = startD; d <= maxDepth + step; d += step) {
      const center = this.getCenter(d);
      const hw = this.getHalfWidth(d);
      walls.push({
        depth: Math.round(d * 100) / 100,
        leftX: Math.round((center - hw) * 100) / 100,
        rightX: Math.round((center + hw) * 100) / 100
      });
    }
    return walls;
  }

  generateUpTo(targetDepth) {
    const CHUNK_SIZE = 400;
    while (this.generatedDepth < targetDepth) {
      const chunkStart = this.generatedDepth;
      const chunkEnd = chunkStart + CHUNK_SIZE;
      this._generateChunk(chunkStart, chunkEnd);
      this.generatedDepth = chunkEnd;
    }
  }

  _generateChunk(startDepth, endDepth) {
    const chunkSize = endDepth - startDepth;
    if (startDepth < 250) {
      // First 250 units: safe introductory straight with gentle fragments
      this._spawnIntroFragments(startDepth, endDepth);
      return;
    }

    const difficulty = Math.min(3.0, 1.0 + startDepth / 10000);

    // 1. Check for power item spawn in this chunk
    if (this.nextPowerDepth >= startDepth && this.nextPowerDepth < endDepth) {
      const powerDepth = this.nextPowerDepth;
      const center = this.getCenter(powerDepth);
      this.items.push({
        id: this.nextEntityId++,
        type: 'power',
        position: {
          x: Math.round(center * 100) / 100,
          depth: Math.round(powerDepth * 100) / 100
        },
        active: true,
        visualRadius: 12,
        collisionRadius: 12
      });
      // Schedule next power item
      this.nextPowerDepth += this.prng.range(8000, 11000);
    }

    // 2. Fragment Formation
    // Place 1 or 2 fragment formations per chunk
    const formationTypes = ['line', 'chevron', 'triangle', 'arc'];
    const fCount = this.prng.chance(0.65) ? 2 : 1;
    for (let f = 0; f < fCount; f++) {
      const formKind = formationTypes[this.prng.rangeInt(0, formationTypes.length - 1)];
      const fDepth = startDepth + (f + 0.5) * (chunkSize / fCount) + this.prng.range(-30, 30);
      this._spawnFormation(formKind, fDepth);
    }

    // 3. Obstacle Rocks
    // Determine rock slices in this chunk (spaced every 70-120 units)
    let currentD = startDepth + this.prng.range(40, 70);
    while (currentD < endDepth - 30) {
      this._spawnRockPattern(currentD, difficulty);
      currentD += this.prng.range(80, 130) / Math.sqrt(difficulty);
    }
  }

  _spawnIntroFragments(startDepth, endDepth) {
    if (startDepth < 80) {
      // Clean intro line
      const fid = this.nextFormationId++;
      for (let i = 0; i < 4; i++) {
        const d = 100 + i * 35;
        this.items.push({
          id: this.nextEntityId++,
          type: 'fragment',
          position: {
            x: Math.round(this.getCenter(d) * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: 8,
          collisionRadius: 9,
          formationId: fid,
          formationKind: 'line',
          formationIndex: i
        });
      }
    }
  }

  _spawnFormation(kind, baseDepth) {
    const fid = this.nextFormationId++;
    const center = this.getCenter(baseDepth);
    const hw = this.getHalfWidth(baseDepth) * 0.65;

    // Strict requirements: formationIndex strictly increasing with depth, no shared depth, at least 3 fragments
    if (kind === 'line') {
      const count = this.prng.rangeInt(3, 5);
      const startX = center + this.prng.range(-hw * 0.5, hw * 0.5);
      const endX = startX + this.prng.range(-hw * 0.4, hw * 0.4);
      const spacingD = 32;

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const d = baseDepth + i * spacingD;
        const x = startX + (endX - startX) * t;
        this.items.push({
          id: this.nextEntityId++,
          type: 'fragment',
          position: {
            x: Math.round(x * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: 8,
          collisionRadius: 9,
          formationId: fid,
          formationKind: 'line',
          formationIndex: i
        });
      }
    } else if (kind === 'chevron') {
      // Chevron shape: 3 to 5 fragments forming a sweeping V/chevron
      // 0 (left), 1 (center deeper), 2 (right even deeper) or vice versa so formationIndex strictly increases with depth!
      const count = 4;
      const dir = this.prng.chance(0.5) ? 1 : -1;
      const widthSpread = this.prng.range(28, 45);
      const depthStep = 28;

      for (let i = 0; i < count; i++) {
        const d = baseDepth + i * depthStep;
        // Sweeping chevron path across the corridor
        const lateralT = i <= 2 ? i / 2 : 2 - (i / 2);
        const x = center + (lateralT - 0.5) * widthSpread * dir;
        this.items.push({
          id: this.nextEntityId++,
          type: 'fragment',
          position: {
            x: Math.round(x * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: 8,
          collisionRadius: 9,
          formationId: fid,
          formationKind: 'chevron',
          formationIndex: i
        });
      }
    } else if (kind === 'triangle') {
      // Triangle formation arranged sequentially along depth
      const count = 3;
      const depthStep = 30;
      const span = this.prng.range(25, 40);
      const side = this.prng.chance(0.5) ? 1 : -1;

      // Point 0 (apex), Point 1 (mid side), Point 2 (base side)
      const offsets = [
        { x: center, d: 0 },
        { x: center + span * 0.6 * side, d: depthStep },
        { x: center - span * 0.6 * side, d: depthStep * 2 }
      ];

      for (let i = 0; i < count; i++) {
        const d = baseDepth + offsets[i].d;
        this.items.push({
          id: this.nextEntityId++,
          type: 'fragment',
          position: {
            x: Math.round(offsets[i].x * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: 8,
          collisionRadius: 9,
          formationId: fid,
          formationKind: 'triangle',
          formationIndex: i
        });
      }
    } else {
      // Arc / curve formation (3-5 fragments)
      const count = this.prng.rangeInt(3, 4);
      const depthStep = 30;
      const curveDir = this.prng.chance(0.5) ? 1 : -1;
      const curveAmp = this.prng.range(25, 45);

      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const d = baseDepth + i * depthStep;
        const x = center + Math.sin(t * Math.PI) * curveAmp * curveDir;
        this.items.push({
          id: this.nextEntityId++,
          type: 'fragment',
          position: {
            x: Math.round(x * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: 8,
          collisionRadius: 9,
          formationId: fid,
          formationKind: 'arc',
          formationIndex: i
        });
      }
    }
  }

  _spawnRockPattern(depth, difficulty) {
    const center = this.getCenter(depth);
    const hw = this.getHalfWidth(depth);
    const safeChannelWidth = PLAYER_RADIUS * 2.8; // Guaranteed opening width for player

    // Safe path target lateral slot
    // We choose a safe clear path through this slice
    const safeSlotX = center + this.prng.range(-hw * 0.5, hw * 0.5);

    const patternType = this.prng.rangeInt(0, 3);

    if (patternType === 0) {
      // 1. Single Large Boulder on one side of corridor
      const side = this.prng.chance(0.5) ? 1 : -1;
      const rSize = this.prng.range(22, 28);
      const rockX = center + side * (hw * 0.55);

      this.rocks.push({
        id: this.nextEntityId++,
        position: {
          x: Math.round(rockX * 100) / 100,
          depth: Math.round(depth * 100) / 100
        },
        active: true,
        visualRadius: Math.round(rSize),
        collisionRadius: Math.round(rSize * 0.95)
      });
    } else if (patternType === 1) {
      // 2. Dual rock gate leaving a clear channel in between
      const r1Size = this.prng.range(14, 18);
      const r2Size = this.prng.range(14, 18);
      const gateCenter = safeSlotX;

      const rock1X = gateCenter - safeChannelWidth - r1Size;
      const rock2X = gateCenter + safeChannelWidth + r2Size;

      if (rock1X > center - hw + r1Size) {
        this.rocks.push({
          id: this.nextEntityId++,
          position: {
            x: Math.round(rock1X * 100) / 100,
            depth: Math.round(depth * 100) / 100
          },
          active: true,
          visualRadius: Math.round(r1Size),
          collisionRadius: Math.round(r1Size * 0.95)
        });
      }

      if (rock2X < center + hw - r2Size) {
        this.rocks.push({
          id: this.nextEntityId++,
          position: {
            x: Math.round(rock2X * 100) / 100,
            depth: Math.round((depth + this.prng.range(-10, 10)) * 100) / 100
          },
          active: true,
          visualRadius: Math.round(r2Size),
          collisionRadius: Math.round(r2Size * 0.95)
        });
      }
    } else if (patternType === 2) {
      // 3. Center Rock forcing a split (left or right path)
      const rSize = this.prng.range(18, 24);
      this.rocks.push({
        id: this.nextEntityId++,
        position: {
          x: Math.round(center * 100) / 100,
          depth: Math.round(depth * 100) / 100
        },
        active: true,
        visualRadius: Math.round(rSize),
        collisionRadius: Math.round(rSize * 0.95)
      });
    } else {
      // 4. Staggered mini cluster
      const count = difficulty > 1.8 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const rSize = this.prng.range(11, 15);
        const sideOffset = (i === 0 ? -1 : 1) * (hw * 0.45) + this.prng.range(-15, 15);
        const rockX = center + sideOffset;
        const d = depth + i * 25;

        this.rocks.push({
          id: this.nextEntityId++,
          position: {
            x: Math.round(rockX * 100) / 100,
            depth: Math.round(d * 100) / 100
          },
          active: true,
          visualRadius: Math.round(rSize),
          collisionRadius: Math.round(rSize * 0.95)
        });
      }
    }
  }

  getEntitiesInHorizon(playerDepth) {
    const minD = playerDepth - 100;
    const maxD = playerDepth + PREVIEW_HORIZON_DISTANCE;

    // Ensure we've generated ahead
    this.generateUpTo(maxD + 400);

    const activeRocks = [];
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (r.position.depth >= minD && r.position.depth <= maxD) {
        activeRocks.push(r);
      }
    }
    activeRocks.sort((a, b) => a.id - b.id);

    const activeItems = [];
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.position.depth >= minD && it.position.depth <= maxD) {
        activeItems.push(it);
      }
    }
    activeItems.sort((a, b) => a.id - b.id);

    return { rocks: activeRocks, items: activeItems };
  }

  computeSafeHalfWidth(playerDepth, maxD) {
    // Compute narrowest continuous clear gap ahead of player
    let minClearHalfWidth = 999;
    const step = 40;

    for (let d = playerDepth; d <= maxD; d += step) {
      const center = this.getCenter(d);
      const hw = this.getHalfWidth(d);
      const leftWall = center - hw;
      const rightWall = center + hw;

      // Find active rocks around this depth
      const rocksAtD = this.rocks.filter(
        r => r.active && Math.abs(r.position.depth - d) < 30
      );

      if (rocksAtD.length === 0) {
        minClearHalfWidth = Math.min(minClearHalfWidth, hw);
      } else {
        // Find largest gap between leftWall, rocks, and rightWall
        const obstacles = [];
        for (const r of rocksAtD) {
          obstacles.push({
            min: r.position.x - r.collisionRadius,
            max: r.position.x + r.collisionRadius
          });
        }
        obstacles.sort((a, b) => a.min - b.min);

        let maxGap = 0;
        let prevRight = leftWall;
        for (const obs of obstacles) {
          if (obs.min > prevRight) {
            maxGap = Math.max(maxGap, obs.min - prevRight);
          }
          prevRight = Math.max(prevRight, obs.max);
        }
        if (rightWall > prevRight) {
          maxGap = Math.max(maxGap, rightWall - prevRight);
        }

        const halfGap = maxGap / 2;
        minClearHalfWidth = Math.min(minClearHalfWidth, halfGap);
      }
    }

    return Math.max(PLAYER_RADIUS * 1.5, Math.round(minClearHalfWidth * 100) / 100);
  }
}
