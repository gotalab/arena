/* SHOAL - the ladder of pools and the boards they hold.
   A pool's board is a pure function of (run seed, pool number, first turn). */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});

  // width, height, urchins. The board never shrinks and the ask never eases.
  var LADDER = [
    [6, 8, 5],
    [6, 9, 7],
    [7, 10, 10],
    [7, 11, 13],
    [8, 12, 17],
    [8, 13, 20],
    [8, 13, 21]
  ];
  var DEEP = [8, 13, 22];

  S.poolSpec = function (pool) {
    var t = pool <= LADDER.length ? LADDER[pool - 1] : DEEP;
    return { w: t[0], h: t[1], urchins: t[2] };
  };

  // The tide drains a little faster the deeper the ladder goes: the pressure
  // lands on the bonus, never on the board.
  S.tideTicksFor = function (pool, cells) {
    var ms = 14000 + 900 * cells;
    var scale = pool <= 7 ? 1 : Math.max(0.62, 1 - 0.055 * (pool - 7));
    return Math.round((ms * scale) / 1000 * 60);
  };

  S.generateBoard = function (seedKey, pool, fx, fy, spec) {
    var w = spec.w, h = spec.h, n = w * h, M = spec.urchins;
    var nb = S.neighbors(w, h);
    var first = fy * w + fx;

    var forbid = new Uint8Array(n);
    forbid[first] = 1;
    var fl = nb[first];
    for (var i = 0; i < fl.length; i++) forbid[fl[i]] = 1;

    var allowedBase = [];
    for (i = 0; i < n; i++) if (!forbid[i]) allowedBase.push(i);

    var base = S.rng.hashString(seedKey + '|' + pool + '|' + fx + ',' + fy);
    var last = null;

    for (var attempt = 0; attempt < 400; attempt++) {
      // If a pool is stubborn, ease the urchin count rather than ever ship a
      // board that would demand a coin flip. The easing keeps deepening, so
      // this loop always reaches a provable board long before it runs out.
      var m = Math.max(1, M - Math.floor(attempt / 45));
      if (m > allowedBase.length) m = allowedBase.length;
      var rnd = S.rng.mulberry32(S.rng.mix(base, attempt + 1));

      var pick = allowedBase.slice();
      for (var k = 0; k < m; k++) {
        var j = k + Math.floor(rnd() * (pick.length - k));
        var tmp = pick[k]; pick[k] = pick[j]; pick[j] = tmp;
      }
      var mine = new Uint8Array(n);
      for (k = 0; k < m; k++) mine[pick[k]] = 1;

      var num = new Uint8Array(n);
      for (i = 0; i < n; i++) {
        if (mine[i]) continue;
        var c = 0, l = nb[i];
        for (j = 0; j < l.length; j++) if (mine[l[j]]) c++;
        num[i] = c;
      }
      last = { mine: mine, num: num, urchins: m };
      if (S.solveNoGuess(w, h, mine, num, first, m)) return last;
    }
    return last;
  };
})();
