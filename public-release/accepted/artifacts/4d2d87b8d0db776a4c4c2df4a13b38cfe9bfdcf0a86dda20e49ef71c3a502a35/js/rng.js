'use strict';

/** Deterministic mulberry32 PRNG for simulation and world generation. */
function createRng(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    state: () => state >>> 0,
    next,
    nextInt: (min, max) => Math.floor(min + (max - min + 1) * next()),
    range: (min, max) => min + (max - min) * next(),
  };
}

window.ArenaRng = { createRng };
