/* EMBER — deterministic random. One stream drives all rule-state generation. */
(function () {
  'use strict';
  var E = (window.EMBER = window.EMBER || {});

  function Rng(seed) {
    this.s = (seed >>> 0) || 1;
  }
  Rng.prototype.next = function () {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  Rng.prototype.int = function (a, b) { return a + Math.floor(this.next() * (b - a + 1)); };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; };

  E.Rng = Rng;

  /* Stable integer hash — used for view-only art variation keyed on entity id. */
  E.hash = function (n) {
    n = (n | 0) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    return (n ^ (n >>> 16)) >>> 0;
  };
  E.hashf = function (n, k) {
    return (E.hash(n * 2654435761 + (k || 0) * 40503) % 100000) / 100000;
  };

  E.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  E.lerp = function (a, b, t) { return a + (b - a) * t; };
})();
