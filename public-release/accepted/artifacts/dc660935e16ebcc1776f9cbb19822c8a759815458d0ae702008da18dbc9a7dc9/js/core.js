/* EMBER — core constants and deterministic math.
 *
 * Rule state uses only +,-,*,/ , Math.sqrt, Math.floor and the polynomial sine
 * below, so a run is bit-reproducible from (seed, tick-aligned input) without
 * ever touching Date.now() or Math.random().
 */
window.EMBER = window.EMBER || {};

(function (E) {
  'use strict';

  var C = {
    /* --- stage -------------------------------------------------------- */
    WORLD_W: 100,          // flue box width in world units
    VIEW_H: 180,           // deterministic camera window height (portrait 5:9)
    WALL_L: 6,             // inner face of the left wall
    WALL_R: 94,            // inner face of the right wall

    /* --- spark -------------------------------------------------------- */
    G: 300,                // gravity, world units / s^2
    LAUNCH_V: 190,         // full-strength launch speed, world units / s
    PLAYER_R: 3.4,
    MAX_FALL: 330,
    AIR_DRAG: 0.5,         // horizontal only, per second
    WALL_SLIDE: 15,        // soot slip while clinging, world units / s
    BOUNCE_V: 158,         // upward kick from bursting a soot-moth
    MIN_POWER: 0.38,       // a dead-zone-length pull still launches this hard

    /* --- glow economy ------------------------------------------------- */
    JUMP_CAP: 3,

    /* --- aim ---------------------------------------------------------- */
    DEAD_ZONE: 3.2,        // pull shorter than this cancels (world units)
    MAX_PULL: 26,          // pull length for full strength (world units)
    AIM_TIME_SCALE: 0.45,  // the world slows while a pull is held, never stops

    /* --- run ---------------------------------------------------------- */
    START_Y: 14,
    LEDGE_HT: 2.3,         // half thickness of a ledge slab
    DAMP_START_GAP: 150,
    DAMP_MAX_GAP: 190,     // beyond this the damp starts closing the distance
    DAMP_CHASE: 0.7,
    DAMP_CAP: 130,

    /* --- prizes ------------------------------------------------------- */
    GLIMMER_R: 4.3,
    GLIMMER_CR: 4.1,
    MOTH_R: 5.0,
    MOTH_CR: 4.7,
    GLIMMER_BASE: 45,
    GLIMMER_CHAIN: 0.30,   // + this share of base per live chain link
    GLIMMER_CHAIN_CAP: 5,
    CHAIN_LINK_VALUE: 12,  // link i of a banked chain pays i * this
    CHAIN_LINK_CAP: 12,    // ...with the per-link value levelling off here
    HEIGHT_SCORE: 3,       // score per world unit climbed — the main engine

    DT: 1 / 60
  };

  // Height gained by a full launch fired straight up. The safe-road guarantee
  // is measured against this.
  C.REACH = (C.LAUNCH_V * C.LAUNCH_V) / (2 * C.G);

  C.RANKS = [
    { min: 0, name: 'Cinder' },
    { min: 1200, name: 'Spark' },
    { min: 2700, name: 'Flicker' },
    { min: 4600, name: 'Flare' },
    { min: 6800, name: 'Blaze' },
    { min: 10200, name: 'Beacon' },
    { min: 14500, name: 'Firebrand' }
  ];

  E.C = C;

  /* ---------------------------------------------------------------- math */

  E.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  E.lerp = function (a, b, t) { return a + (b - a) * t; };

  // sin(2*PI*turns) to ~1e-7, built from multiplies and adds only so that the
  // rules never depend on an engine's transcendental implementation.
  E.psin = function (turns) {
    var f = turns - Math.floor(turns);      // [0,1)
    var x = f * 4;                          // [0,4)
    var s = 1;
    if (x >= 2) { x -= 2; s = -1; }
    if (x > 1) { x = 2 - x; }               // fold to a [0,1] quarter wave
    var x2 = x * x;
    return s * x * (1.5707963267948966 + x2 * (-0.6459640975062462 +
      x2 * (0.07969262624616703 + x2 * -0.004681754135318688)));
  };
  E.pcos = function (turns) { return E.psin(turns + 0.25); };

  E.round3 = function (v) { return Math.round(v * 1000) / 1000; };
  E.round4 = function (v) { return Math.round(v * 10000) / 10000; };

  // Small integer hash — used for view-only procedural detail (brick soot,
  // ash motes, cinder flicker). Never touches rule state.
  E.hash32 = function (n) {
    n = (n | 0) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0);
  };
  E.hashf = function (n) { return E.hash32(n) / 4294967296; };

  /* ----------------------------------------------------------------- rng */

  // mulberry32. State is a single uint32 so it can be reported in snapshots.
  E.Rng = function (seed) {
    this.s = (seed | 0) >>> 0;
  };
  E.Rng.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    var t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  E.Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
  E.Rng.prototype.int = function (n) { return Math.floor(this.next() * n) % n; };
  E.Rng.prototype.chance = function (p) { return this.next() < p; };
  E.Rng.prototype.pick = function (arr) { return arr[this.int(arr.length)]; };

  E.rankFor = function (score) {
    var r = C.RANKS[0].name;
    for (var i = 0; i < C.RANKS.length; i++) {
      if (score >= C.RANKS[i].min) { r = C.RANKS[i].name; }
    }
    return r;
  };
  E.rankIndexFor = function (score) {
    var k = 0;
    for (var i = 0; i < C.RANKS.length; i++) {
      if (score >= C.RANKS[i].min) { k = i; }
    }
    return k;
  };

})(window.EMBER);
