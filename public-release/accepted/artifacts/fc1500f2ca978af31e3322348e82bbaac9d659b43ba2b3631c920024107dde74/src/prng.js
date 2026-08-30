/**
 * Deterministic PRNG using Mulberry32.
 */
export class PRNG {
  constructor(seed = 123456789) {
    this.seed = (seed >>> 0) || 1;
    this.state = this.seed;
  }

  setSeed(seed) {
    this.seed = (seed >>> 0) || 1;
    this.state = this.seed;
  }

  getState() {
    return this.state;
  }

  setState(state) {
    this.state = state >>> 0;
  }

  /**
   * Returns float in [0, 1)
   */
  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  rangeInt(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p) {
    return this.next() < p;
  }
}
