/**
 * Deterministic Pseudo-Random Number Generator (Mulberry32)
 */
(function(root) {
  function hashString(str) {
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
      hash = (hash << 13) | (hash >>> 19);
    }
    return hash >>> 0;
  }

  function createPRNG(seed) {
    let s;
    if (typeof seed === 'string') {
      s = hashString(seed);
    } else if (typeof seed === 'number') {
      s = (seed >>> 0) || 1337;
    } else {
      s = 1337;
    }

    function next() {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function nextInt(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    }

    function shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
      }
      return array;
    }

    return {
      next,
      nextInt,
      shuffle,
      getSeed: () => seed
    };
  }

  root.ShoalPRNG = {
    createPRNG,
    hashString
  };
})(typeof window !== 'undefined' ? window : globalThis);
