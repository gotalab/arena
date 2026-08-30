/** Seeded mulberry32 PRNG — deterministic across platforms. */
export function createRng(seed) {
  let state = (seed >>> 0) || 1;

  function nextUnit() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    state: () => state >>> 0,
    next: nextUnit,
    int: (min, max) => {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      return Math.floor(lo + (hi - lo + 1) * nextUnit());
    },
    pick: (arr) => arr[Math.floor(nextUnit() * arr.length)],
  };
}

export function hashSeed(input) {
  let h = 2166136261 >>> 0;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
