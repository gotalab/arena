/**
 * Course and procedural generation for DELVE
 * Deterministic corridor geometry, safe-line solver, rock formations, and collectible spawns.
 */
class CourseGenerator {
  constructor(seed = 12345) {
    this.seed = seed;
    this.prng = new PRNG(seed);
    this.entityIdCounter = 1;
    this.formationIdCounter = 1;

    // Generated chunks / spawned entities
    this.rocks = []; // array of rock objects
    this.items = []; // array of item objects
    this.lastGeneratedDepth = 0;

    // Power item schedule
    this.powerItemDepths = [];
    this.setupCourseParams();
  }

  setupCourseParams() {
    // Generate deterministic harmonic parameters for the corridor center curve
    const p = new PRNG(this.seed);
    this.harmonics = [
      { freq: 0.00035, amp: 260 + p.range(-30, 30), phase: p.range(0, Math.PI * 2) },
      { freq: 0.0011, amp: 160 + p.range(-20, 20), phase: p.range(0, Math.PI * 2) },
      { freq: 0.0028, amp: 90 + p.range(-15, 15), phase: p.range(0, Math.PI * 2) },
      { freq: 0.0065, amp: 45 + p.range(-10, 10), phase: p.range(0, Math.PI * 2) }
    ];
    this.widthPhase = p.range(0, Math.PI * 2);

    // Guaranteed power item in first 60 seconds of digging (~12,000 depth at normal speeds)
    const firstPower = p.range(9000, 13000);
    this.powerItemDepths = [firstPower];
    let nextP = firstPower;
    for (let i = 0; i < 20; i++) {
      nextP += p.range(18000, 26000);
      this.powerItemDepths.push(nextP);
    }
  }

  getCenter(depth) {
    let x = 0;
    for (let i = 0; i < this.harmonics.length; i++) {
      const h = this.harmonics[i];
      x += Math.sin(depth * h.freq + h.phase) * h.amp;
    }
    return Math.round(x * 10) / 10;
  }

  getHalfWidth(depth) {
    // Base width starts generous (~210) and gently tightens to (~165) at deeper depths
    const depthFactor = Math.min(1, depth / 35000);
    const baseW = 210 - depthFactor * 35;
    const variation = Math.sin(depth * 0.0015 + this.widthPhase) * 20;
    return Math.max(150, Math.round((baseW + variation) * 10) / 10);
  }

  getWallsAt(depth) {
    const cx = this.getCenter(depth);
    const hw = this.getHalfWidth(depth);
    return {
      depth: Math.round(depth * 10) / 10,
      leftX: Math.round((cx - hw) * 10) / 10,
      rightX: Math.round((cx + hw) * 10) / 10
    };
  }

  // Sample walls ahead for snapshot and rendering
  sampleWalls(startDepth, horizonDistance, step = 25) {
    const samples = [];
    const endDepth = startDepth + horizonDistance;
    for (let d = startDepth; d <= endDepth; d += step) {
      samples.push(this.getWallsAt(d));
    }
    return samples;
  }

  // Safe path trajectory through the course
  getSafeX(depth) {
    const cx = this.getCenter(depth);
    const hw = this.getHalfWidth(depth);
    // Safe line drifts within corridor away from walls
    const drift = Math.sin(depth * 0.0019 + this.seed) * (hw * 0.45);
    return cx + drift;
  }

  // Ensure course generation up to requested depth
  generateUpTo(targetDepth) {
    const CHUNK_SIZE = 400;
    while (this.lastGeneratedDepth < targetDepth) {
      const chunkStart = this.lastGeneratedDepth;
      const chunkEnd = chunkStart + CHUNK_SIZE;
      this.generateChunk(chunkStart, chunkEnd);
      this.lastGeneratedDepth = chunkEnd;
    }
  }

  generateChunk(startDepth, endDepth) {
    if (startDepth < 400) {
      // Safe buffer zone at start of run
      return;
    }

    const prng = this.prng;
    const difficulty = Math.min(3.5, 1.0 + startDepth / 12000);

    // 1. Check for Power Item spawn in this chunk
    for (let i = 0; i < this.powerItemDepths.length; i++) {
      const pd = this.powerItemDepths[i];
      if (pd >= startDepth && pd < endDepth) {
        const cx = this.getCenter(pd);
        const hw = this.getHalfWidth(pd);
        const itemX = cx + prng.range(-hw * 0.4, hw * 0.4);
        this.items.push({
          id: this.entityIdCounter++,
          type: "power",
          position: {
            x: Math.round(itemX * 10) / 10,
            depth: Math.round(pd * 10) / 10
          },
          active: true,
          visualRadius: 18,
          collisionRadius: 20
        });
      }
    }

    // 2. Spawn Fragment Formations
    // Roughly 1 formation per 350-500 depth
    if (prng.chance(0.85)) {
      this.spawnFormation(startDepth + prng.range(40, 180));
    }

    // 3. Spawn Rocks (avoiding the safe path line)
    // Number of rocks scales with difficulty
    const numRocks = prng.rangeInt(1, Math.min(5, Math.floor(1.5 + difficulty * 1.1)));
    for (let r = 0; r < numRocks; r++) {
      const rockDepth = prng.range(startDepth + 30, endDepth - 30);
      const cx = this.getCenter(rockDepth);
      const hw = this.getHalfWidth(rockDepth);
      const safeX = this.getSafeX(rockDepth);

      // Varied rock radii
      const sizeRoll = prng.next();
      let vRad = 20;
      if (sizeRoll < 0.45) {
        vRad = prng.range(16, 22); // Small rock
      } else if (sizeRoll < 0.85) {
        vRad = prng.range(24, 32); // Medium rock
      } else {
        vRad = prng.range(34, 44); // Large boulder
      }
      const cRad = Math.round(vRad * 0.92);

      // Place rock in corridor with margin from walls
      const minX = cx - hw + vRad + 12;
      const maxX = cx + hw - vRad - 12;
      if (minX >= maxX) continue;

      let candidateX = prng.range(minX, maxX);

      // Safe path clearance guarantee: if rock covers safe line, push it to the side
      const minSafeClearance = vRad + 52; // player radius (18) + safe corridor buffer
      if (Math.abs(candidateX - safeX) < minSafeClearance) {
        if (candidateX < safeX) {
          candidateX = safeX - minSafeClearance;
        } else {
          candidateX = safeX + minSafeClearance;
        }
      }

      // Re-clamp to corridor boundaries
      if (candidateX >= minX && candidateX <= maxX) {
        this.rocks.push({
          id: this.entityIdCounter++,
          position: {
            x: Math.round(candidateX * 10) / 10,
            depth: Math.round(rockDepth * 10) / 10
          },
          active: true,
          visualRadius: Math.round(vRad * 10) / 10,
          collisionRadius: Math.round(cRad * 10) / 10
        });
      }
    }
  }

  spawnFormation(baseDepth) {
    const prng = this.prng;
    const formationId = this.formationIdCounter++;
    const kinds = ["line", "chevron", "triangle", "arc"];
    const kind = kinds[prng.rangeInt(0, kinds.length - 1)];

    const cx = this.getCenter(baseDepth);
    const hw = this.getHalfWidth(baseDepth);
    const safeX = this.getSafeX(baseDepth);

    // Number of fragments in formation (at least 3)
    const count = prng.rangeInt(3, 5);
    const depthStep = prng.range(42, 60);

    const offsets = [];

    if (kind === "line") {
      // Straight diagonal or vertical line
      const dir = prng.chance(0.5) ? 1 : -1;
      const slope = prng.range(0.25, 0.65) * dir;
      const startOffset = prng.range(-hw * 0.35, hw * 0.35);
      for (let i = 0; i < count; i++) {
        offsets.push({
          dDepth: i * depthStep,
          dx: startOffset + i * depthStep * slope
        });
      }
    } else if (kind === "chevron") {
      // < or > shape opening across corridor
      const dir = prng.chance(0.5) ? 1 : -1;
      const apexIdx = Math.floor(count / 2);
      const span = prng.range(45, 80) * dir;
      for (let i = 0; i < count; i++) {
        const distFromApex = Math.abs(i - apexIdx);
        const lateral = (1 - distFromApex / apexIdx) * span;
        offsets.push({
          dDepth: i * depthStep,
          dx: lateral - span * 0.5
        });
      }
    } else if (kind === "triangle") {
      // 3 items triangle sweep with strictly increasing depths
      const apexOffset = prng.range(-30, 30);
      const spread = prng.range(38, 65);
      offsets.push({ dDepth: 0, dx: apexOffset - spread });
      offsets.push({ dDepth: depthStep, dx: apexOffset + spread });
      offsets.push({ dDepth: depthStep * 2, dx: apexOffset });
      if (count >= 4) {
        offsets.push({ dDepth: depthStep * 3, dx: apexOffset - spread * 0.5 });
      }
    } else { // "arc"
      // Smooth curve sweep
      const curveDir = prng.chance(0.5) ? 1 : -1;
      const radius = prng.range(60, 100);
      for (let i = 0; i < count; i++) {
        const angle = (i / (count - 1)) * Math.PI * 0.75;
        offsets.push({
          dDepth: i * depthStep,
          dx: Math.sin(angle) * radius * curveDir
        });
      }
    }

    // Anchor formation near safe line or corridor center
    for (let idx = 0; idx < offsets.length; idx++) {
      const fDepth = baseDepth + offsets[idx].dDepth;
      const fCx = this.getCenter(fDepth);
      const fHw = this.getHalfWidth(fDepth);
      const targetX = Math.max(fCx - fHw + 25, Math.min(fCx + fHw - 25, safeX + offsets[idx].dx));

      this.items.push({
        id: this.entityIdCounter++,
        type: "fragment",
        position: {
          x: Math.round(targetX * 10) / 10,
          depth: Math.round(fDepth * 10) / 10
        },
        active: true,
        visualRadius: 13,
        collisionRadius: 15,
        formationId: formationId,
        formationKind: kind,
        formationIndex: idx // Strictly increasing depth order (0, 1, 2...)
      });
    }
  }

  // Get all entities within preview horizon
  getEntitiesInHorizon(currentDepth, horizonDistance) {
    const minD = currentDepth - 80;
    const maxD = currentDepth + horizonDistance;

    const visibleRocks = this.rocks.filter((r) => r.position.depth >= minD && r.position.depth <= maxD);
    const visibleItems = this.items.filter((i) => i.position.depth >= minD && i.position.depth <= maxD);

    // Entities must be sorted by stable ID
    visibleRocks.sort((a, b) => a.id - b.id);
    visibleItems.sort((a, b) => a.id - b.id);

    return { rocks: visibleRocks, items: visibleItems };
  }

  // Calculate safeHalfWidth within preview horizon
  calculateSafeHalfWidth(currentDepth, horizonDistance) {
    const samples = 15;
    const step = horizonDistance / samples;
    let minGap = 9999;

    for (let i = 0; i < samples; i++) {
      const d = currentDepth + i * step;
      const hw = this.getHalfWidth(d);
      // Gap considering corridor width and obstacles
      let gapAtDepth = hw * 0.75; // Baseline available room along safe path
      minGap = Math.min(minGap, gapAtDepth);
    }
    return Math.round(Math.max(45, minGap) * 10) / 10;
  }
}

window.CourseGenerator = CourseGenerator;
