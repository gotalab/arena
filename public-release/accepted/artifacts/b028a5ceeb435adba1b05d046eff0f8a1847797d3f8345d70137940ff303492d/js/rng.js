/** Seeded deterministic PRNG (Mulberry32). */
export function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return {
    get state() {
      return state >>> 0;
    },
    set state(v) {
      state = v >>> 0;
    },
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    float(min, max) {
      return min + this.next() * (max - min);
    },
    pick(arr) {
      return arr[this.int(0, arr.length - 1)];
    },
  };
}

export function roundStable(n, decimals = 3) {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}
