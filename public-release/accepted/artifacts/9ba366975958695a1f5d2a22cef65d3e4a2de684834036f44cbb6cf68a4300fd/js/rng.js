(function (global) {
  'use strict';

  function mulberry32(seed) {
    var s = seed >>> 0;
    function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      state: function () { return s >>> 0; }
    };
  }

  function SeededRng(seed) {
    var r = mulberry32(seed);
    this.state = r.state;
    this.next = r.next;
    this.range = function (a, b) { return a + (b - a) * r.next(); };
    this.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
    this.chance = function (p) { return r.next() < p; };
  }

  global.SeededRng = SeededRng;
})(typeof window !== 'undefined' ? window : globalThis);
