/* SHOAL - deterministic pseudo-random source.
   Every board in the game comes out of this file; nothing here reads the wall
   clock or Math.random. */
(function (g) {
  'use strict';

  function hashSeed(seed) {
    var s = String(seed);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mix(a, b) {
    var h = (a ^ Math.imul(b ^ (b >>> 15), 0x2545f491)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  g.SHOAL = g.SHOAL || {};
  g.SHOAL.rng = { hashSeed: hashSeed, mix: mix, mulberry32: mulberry32 };
})(window);
