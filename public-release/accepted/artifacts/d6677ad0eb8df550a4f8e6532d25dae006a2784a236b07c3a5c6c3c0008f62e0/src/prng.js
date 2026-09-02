// Deterministic 32-bit PRNG (Mulberry32)

export class PRNG {
  constructor(seed = 1337) {
    this.seed = (seed >>> 0) || 1;
    this.state = this.seed;
  }

  // Returns float in [0, 1)
  next() {
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t >>> 0) / 4294967296);
  }

  // Returns integer in [min, max] inclusive
  rangeInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Returns float in [min, max)
  rangeFloat(min, max) {
    return min + this.next() * (max - min);
  }

  // Choose random item from array
  choose(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(this.next() * arr.length)];
  }

  getState() {
    return this.state >>> 0;
  }

  setState(state) {
    this.state = state >>> 0;
  }
}
