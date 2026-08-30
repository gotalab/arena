(function () {
  function makeRng(seed) {
    var a = seed | 0;
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (lo, hi) { return lo + (hi - lo) * next(); },
      int: function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * next()); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
      get state() { return a >>> 0; }
    };
  }
  window.DELVE = window.DELVE || {};
  window.DELVE.rng = { makeRng: makeRng };
})();