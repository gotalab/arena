/**
 * Deterministic Pseudo-Random Number Generator (Mulberry32)
 */
class PRNG {
  constructor(seed = 12345) {
    this.setSeed(seed);
  }

  setSeed(seed) {
    if (typeof seed === 'string') {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
      }
      this.state = h >>> 0;
    } else {
      this.state = (seed >>> 0) || 1337;
    }
  }

  getState() {
    return this.state;
  }

  setState(state) {
    this.state = (state >>> 0);
  }

  // Returns float in [0, 1)
  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Float in [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Int in [min, max]
  rangeInt(min, max) {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  // Boolean with probability p
  chance(p) {
    return this.next() < p;
  }
}

window.PRNG = PRNG;
