import { CONSTANTS } from './constants.js';

export class WorldGenerator {
  constructor(rng) {
    this.rng = rng;
    this.ledges = [];
    this.items = [];
    this.nextLedgeId = 1;
    this.nextItemId = 1001;
    this.highestGeneratedY = -100;
    this.safeLedges = [];
  }

  reset() {
    this.ledges = [];
    this.items = [];
    this.nextLedgeId = 1;
    this.nextItemId = 1001;
    this.highestGeneratedY = -100;
    this.safeLedges = [];

    // 1. Initial Starting Ledge at y = 0
    const startLedge = {
      id: this.nextLedgeId++,
      position: { x: 0, y: 0 },
      halfWidth: 55,
      active: true,
      isSafe: true,
      kind: 'stone'
    };
    this.ledges.push(startLedge);
    this.safeLedges.push(startLedge);
    this.highestGeneratedY = 0;

    // Pre-generate flue up to initial lookahead
    this.generateUpTo(CONSTANTS.LAUNCH_REACH * 6);
  }

  generateUpTo(targetY) {
    while (this.highestGeneratedY < targetY) {
      this._generateNextSegment();
    }
  }

  _generateNextSegment() {
    const lastSafe = this.safeLedges[this.safeLedges.length - 1];
    const reach = CONSTANTS.LAUNCH_REACH;

    // Vertical spacing to next guaranteed safe ledge: 48% to 75% of launchReach
    const difficulty = Math.min(this.highestGeneratedY / 3000, 1.0);
    const minDy = reach * (0.46 + difficulty * 0.08); // ~115 to ~136
    const maxDy = reach * (0.68 + difficulty * 0.08); // ~170 to ~190
    const dy = this.rng.range(minDy, maxDy);
    const nextY = lastSafe.position.y + dy;

    // Horizontal placement for next safe ledge: ensure reachable lateral arc
    // Flue inner span is [-150, 150] for ledge centers
    const prevX = lastSafe.position.x;
    let nextX;
    if (Math.abs(prevX) < 40) {
      // Alternate left or right
      nextX = this.rng.chance(0.5) ? this.rng.range(-120, -50) : this.rng.range(50, 120);
    } else if (prevX < 0) {
      // Was on left, prefer moving toward center or right
      nextX = this.rng.chance(0.65) ? this.rng.range(-20, 110) : this.rng.range(-130, -50);
    } else {
      // Was on right, prefer moving toward center or left
      nextX = this.rng.chance(0.65) ? this.rng.range(-110, 20) : this.rng.range(50, 130);
    }

    // Safe ledge width tapers slightly with difficulty
    const halfWidth = Math.max(46 - difficulty * 18 + this.rng.range(-3, 3), 24);

    const safeLedge = {
      id: this.nextLedgeId++,
      position: { x: Math.round(nextX), y: Math.round(nextY) },
      halfWidth: Math.round(halfWidth),
      active: true,
      isSafe: true,
      kind: this.rng.chance(0.3) ? 'iron' : 'stone'
    };
    this.ledges.push(safeLedge);
    this.safeLedges.push(safeLedge);

    // Maybe add a secondary challenge / side ledge
    if (this.rng.chance(0.45)) {
      const sideX = nextX > 0 ? this.rng.range(-135, -70) : this.rng.range(70, 135);
      const sideY = lastSafe.position.y + dy * this.rng.range(0.3, 0.7);
      this.ledges.push({
        id: this.nextLedgeId++,
        position: { x: Math.round(sideX), y: Math.round(sideY) },
        halfWidth: Math.round(this.rng.range(22, 34)),
        active: true,
        isSafe: false,
        kind: 'stone'
      });
    }

    // Place Items (Glimmers and Soot-Moths) in this segment
    const midY = (lastSafe.position.y + nextY) * 0.5;

    // Moth placement: between perches or open flue
    if (this.rng.chance(0.7)) {
      const mothBaseX = this.rng.range(-110, 110);
      const mothY = midY + this.rng.range(-dy * 0.25, dy * 0.25);
      this.items.push({
        id: this.nextItemId++,
        type: 'moth',
        position: { x: Math.round(mothBaseX), y: Math.round(mothY) },
        baseX: mothBaseX,
        baseY: mothY,
        driftAmp: this.rng.range(16, 32),
        driftFreq: this.rng.range(0.025, 0.045),
        driftPhase: this.rng.range(0, Math.PI * 2),
        active: true,
        visualRadius: CONSTANTS.MOTH_VISUAL_RADIUS,
        collisionRadius: CONSTANTS.MOTH_COLLISION_RADIUS
      });
    }

    // Glimmer placement: tempting spots in open air
    if (this.rng.chance(0.65)) {
      const glimmerX = this.rng.chance(0.5) ? this.rng.range(-130, -30) : this.rng.range(30, 130);
      const glimmerY = midY + this.rng.range(-dy * 0.35, dy * 0.35);
      this.items.push({
        id: this.nextItemId++,
        type: 'glimmer',
        position: { x: Math.round(glimmerX), y: Math.round(glimmerY) },
        baseX: glimmerX,
        baseY: glimmerY,
        bobPhase: this.rng.range(0, Math.PI * 2),
        active: true,
        visualRadius: CONSTANTS.GLIMMER_RADIUS,
        collisionRadius: CONSTANTS.GLIMMER_COLLISION_RADIUS
      });
    }

    // Occasional high glimmer lure above safe ledge
    if (this.rng.chance(0.25)) {
      const highGlimmerY = nextY + this.rng.range(35, 70);
      const highGlimmerX = nextX + this.rng.range(-30, 30);
      this.items.push({
        id: this.nextItemId++,
        type: 'glimmer',
        position: { x: Math.round(highGlimmerX), y: Math.round(highGlimmerY) },
        baseX: highGlimmerX,
        baseY: highGlimmerY,
        bobPhase: this.rng.range(0, Math.PI * 2),
        active: true,
        visualRadius: CONSTANTS.GLIMMER_RADIUS,
        collisionRadius: CONSTANTS.GLIMMER_COLLISION_RADIUS
      });
    }

    this.highestGeneratedY = nextY;
  }

  updateEntities(tick) {
    // Update deterministic moth drift and glimmer gentle hover
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item.active) continue;

      if (item.type === 'moth') {
        const drift = item.driftAmp * Math.sin(tick * item.driftFreq + item.driftPhase);
        item.position.x = item.baseX + drift;
        // Subtle vertical wobble
        item.position.y = item.baseY + Math.cos(tick * item.driftFreq * 1.5 + item.driftPhase) * 4;
      } else if (item.type === 'glimmer') {
        item.position.y = item.baseY + Math.sin(tick * 0.05 + item.bobPhase) * 3;
      }
    }
  }

  // Query entities in span [sparkY - reach, sparkY + 2 * reach] sorted by stable id
  getEntitiesInSpan(sparkY) {
    const reach = CONSTANTS.LAUNCH_REACH;
    const minY = sparkY - reach;
    const maxY = sparkY + 2.5 * reach;

    // Ensure generated high enough
    this.generateUpTo(sparkY + 4 * reach);

    const visibleLedges = [];
    for (let i = 0; i < this.ledges.length; i++) {
      const l = this.ledges[i];
      if (l.position.y >= minY && l.position.y <= maxY) {
        visibleLedges.push({
          id: l.id,
          position: { x: l.position.x, y: l.position.y },
          halfWidth: l.halfWidth,
          active: l.active
        });
      }
    }
    visibleLedges.sort((a, b) => a.id - b.id);

    const visibleItems = [];
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.position.y >= minY && it.position.y <= maxY) {
        visibleItems.push({
          id: it.id,
          type: it.type,
          position: { x: it.position.x, y: it.position.y },
          active: it.active,
          visualRadius: it.visualRadius,
          collisionRadius: it.collisionRadius
        });
      }
    }
    visibleItems.sort((a, b) => a.id - b.id);

    return {
      ledges: visibleLedges,
      items: visibleItems
    };
  }
}
