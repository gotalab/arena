/* DELVE — seeded RNG.
 * Rule state uses ONLY this generator (never Math.random / Date.now).
 * State is a single uint32 carried on the sim state object as `S.rng`,
 * which is what the snapshot reports as `rngState`.
 */
(function () {
  var D = (window.DELVE = window.DELVE || {});

  function next(s) {
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    var t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  D.rng = {
    next: next,
    f: function (s) { return next(s) / 4294967296; },
    range: function (s, a, b) { return a + (b - a) * (next(s) / 4294967296); },
    pick: function (s, arr) {
      var i = Math.floor((next(s) / 4294967296) * arr.length);
      if (i >= arr.length) i = arr.length - 1;
      return arr[i];
    },
    /* Stateless hash — for VIEW-ONLY art variation (rock facets, strata).
       Never touches rule state, never influences a snapshot. */
    hash: function (n) {
      var t = (n >>> 0) + 0x9e3779b9;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
      return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    }
  };
})();
