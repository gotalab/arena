// PRNG and hashing utilities for deterministic replay in SHOAL

function createPrng(seed) {
  let s = (typeof seed === 'number' ? seed : hashStringToUint32(String(seed))) >>> 0;
  if (s === 0) s = 1;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToUint32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hashSeed(seed, pool, fx, fy, attempt = 0) {
  const str = `${seed}:${pool}:${fx},${fy}:${attempt}`;
  return hashStringToUint32(str);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPrng, hashStringToUint32, hashSeed };
}
