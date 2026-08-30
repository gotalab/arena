// Deterministic PRNG using Mulberry32 algorithm
export class SeededRNG {
  constructor(seed = 1337) {
    this.initialSeed = seed;
    this.state = this._hashSeed(seed);
  }

  _hashSeed(seed) {
    if (typeof seed === 'string') {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
      }
      return h >>> 0;
    }
    return (seed >>> 0) || 1337;
  }

  reset(seed) {
    if (seed !== undefined) {
      this.initialSeed = seed;
    }
    this.state = this._hashSeed(this.initialSeed);
  }

  getState() {
    return this.state;
  }

  setState(state) {
    this.state = state >>> 0;
  }

  // Returns float in [0, 1)
  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Returns float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Returns integer in [min, max]
  rangeInt(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  // Returns boolean with probability p (default 0.5)
  chance(p = 0.5) {
    return this.next() < p;
  }
}
