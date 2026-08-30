(function (root) {
'use strict';

var STEP_MS = 1000 / 60;
var DT = STEP_MS / 1000;

var PR = 13;
var CRAWL = 58, TOP = 520;
var ACC_K = 2.05, COAST_K = 1.02;
var STALL_T = 0.235;
var LAT_CRAWL = 305, LAT_TOP = 92, STEER_K = 9.5;
var HORIZON = 1150;
var WALL_AHEAD = 2800, GEN_AHEAD = 2400, REAR_KEEP = 520;
var SAMPLE_N = 13;
var TIME_START = 42000, TIME_CAP = 60000;
var FRAG_TIME = 1900, POWHIT_TIME = 1150, POWER_MS = 5400;
var DIFF_SPAN = 19500;
var CX_BOUND = 228, WALL_MIN = 82, BASE_W = 134;
var CHAN_MARGIN = 46;
var MAX_WALL_SLOPE = 1.02;
var EVENT_CAP = 240, EVENT_KEEP = 200;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

function mix32(x) {
  x |= 0; x ^= x >>> 16; x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15; x = Math.imul(x, 0x735a2d97); return (x ^ x >>> 15) >>> 0;
}
function Rng(seed) { this.s = mix32((seed >>> 0) || 1); }
Rng.prototype.n = function () {
  var a = this.s = this.s + 0x6D2B79F5 | 0;
  var t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
Rng.prototype.rf = function (a, b) { return a + (b - a) * this.n(); };
Rng.prototype.ri = function (a, b) { return Math.floor(this.rf(a, b + 1)); };
Rng.prototype.chance = function (p) { return this.n() < p; };
Rng.prototype.pickw = function (w) {
  var s = 0, i;
  for (i = 0; i < w.length; i++) s += w[i][1];
  var r = this.n() * s;
  for (i = 0; i < w.length; i++) { r -= w[i][1]; if (r <= 0) return w[i][0]; }
  return w[w.length - 1][0];
};

var GRADES = [
  ['SCRUFF', 0], ['GRUBBER', 2600], ['BORER', 7000],
  ['STRIDER', 13500], ['VEINBARON', 24000], ['COREWRIGHT', 42000]
];
function gradeFor(score) {
  var name = GRADES[0][0];
  for (var i = 0; i < GRADES.length; i++) if (score >= GRADES[i][1]) name = GRADES[i][0];
  return name;
}

function diffAt(d) { return clamp((d - 200) / DIFF_SPAN, 0, 1); }

function segC(seg, d) {
  var t = d <= seg.d0 ? 0 : d >= seg.d1 ? 1 : (d - seg.d0) / (seg.d1 - seg.d0);
  return lerp(seg.c0, seg.c1, smooth(t));
}
function segW(seg, d) {
  var t = d <= seg.d0 ? 0 : d >= seg.d1 ? 1 : (d - seg.d0) / (seg.d1 - seg.d0);
  return lerp(seg.w0, seg.w1, smooth(t));
}

function createGame(startSeed) {
  var seedV = (typeof startSeed === 'number') ? (startSeed >>> 0)
            : (((Math.random() * 4294967296) >>> 0));
  var rng;
  var segs, ckps, bands, rocks, items;
  var wallD, bandD, chanPh;
  var px, pd, speed, latV;
  var stall, stallT, stallV0, wallCd, prevCL, prevCR;
  var tickN, timeMs, remainingMs, invUntilMs;
  var scoreB, fragC, rockBrk, hitsC, wallC;
  var phase, rankStr;
  var evSeq, evList, lastEv;
  var spawnIdx, nextPowerD, fKindSeq;
  var lastDir;
  var stats;

  var KB = { accel: false, left: false, right: false };
  var PT = { accel: false, stickX: 0 };

  function freshStats() {
    return { shave: Infinity, bestDepth: 0, streakMaxMs: 0, streakMs: 0, grazes: 0 };
  }

  function pushEvent(kind) {
    evSeq++;
    lastEv = { seq: evSeq, kind: kind, tick: tickN };
    evList.push(lastEv);
    if (evList.length > EVENT_CAP) evList.splice(0, evList.length - EVENT_KEEP);
  }

  /* ---------------- course generation ---------------- */

  function pushSeg(s) { segs.push(s); wallD = s.d1; }

  function addStraight(d0, c0, w0, diff) {
    var L = rng.ri(430, 800);
    var c1 = clamp(c0 + rng.rf(-40, 40), -CX_BOUND, CX_BOUND);
    var w1 = clamp(BASE_W - 30 * diff + rng.rf(-4, 8), WALL_MIN, 150);
    pushSeg({ d0: d0, d1: d0 + L, c0: c0, c1: c1, w0: w0, w1: w1 });
  }
  function addBend(d0, c0, w0, diff) {
    var L = rng.ri(680, 1550);
    var sharp = L < 950 || diff > 0.35;
    var dir = (lastDir !== 0 && rng.chance(sharp ? 0.8 : 0.62)) ? -lastDir : (rng.chance(0.5) ? 1 : -1);
    var A = sharp ? Math.min(rng.rf(240, 330) + 80 * diff, MAX_WALL_SLOPE * L)
                  : Math.min(rng.rf(150, 250) + 110 * diff, MAX_WALL_SLOPE * L);
    var c1 = clamp(c0 + dir * A, -CX_BOUND, CX_BOUND);
    var w1 = clamp(BASE_W - (sharp ? 32 : 28) * diff + rng.rf(-4, 6), WALL_MIN, 148);
    if (Math.abs(c1 - c0) > MAX_WALL_SLOPE * L) c1 = c0 + Math.sign(c1 - c0) * MAX_WALL_SLOPE * L;
    if (Math.abs(w1 - w0) > 26) w1 = w0 + Math.sign(w1 - w0) * 26;
    lastDir = Math.sign(c1 - c0) || dir;
    pushSeg({ d0: d0, d1: d0 + L, c0: c0, c1: c1, w0: w0, w1: w1 });
  }
  function addThroat(d0, c0, w0, diff) {
    var L = rng.ri(520, 860);
    var narrow = clamp(WALL_MIN + 6 - 10 * diff + rng.rf(0, 10), WALL_MIN, 108);
    var cm = clamp(c0 + rng.rf(-24, 24), -CX_BOUND, CX_BOUND);
    var Lm = Math.round(L * 0.45);
    pushSeg({ d0: d0, d1: d0 + Lm, c0: c0, c1: cm, w0: w0, w1: narrow });
    var wEnd = clamp(BASE_W - 30 * diff + rng.rf(-4, 6), WALL_MIN, 148);
    if (Math.abs(wEnd - narrow) > 26) wEnd = narrow + Math.sign(wEnd - narrow) * 26;
    pushSeg({ d0: wallD, d1: wallD + (L - Lm), c0: cm, c1: clamp(cm + rng.rf(-20, 20), -CX_BOUND, CX_BOUND), w0: narrow, w1: wEnd });
  }

  function genSeg() {
    var d0 = wallD;
    var c0 = segs.length ? segs[segs.length - 1].c1 : 0;
    var w0 = segs.length ? segs[segs.length - 1].w1 : BASE_W;
    var diff = diffAt(d0);
    var type = rng.pickw([
      ['straight', Math.max(0.06, 0.16 - 0.07 * diff)],
      ['bend', Math.max(0.24, 0.48 - 0.14 * diff)],
      ['throat', Math.max(0.05, 0.15 - 0.08 * diff)]
    ]);
    if (type === 'straight') addStraight(d0, c0, w0, diff);
    else if (type === 'bend') addBend(d0, c0, w0, diff);
    else addThroat(d0, c0, w0, diff);
  }

  function ensureWalls(toD) { while (wallD < toD) genSeg(); }

  function findIdx(list, d, keyD0, keyD1) {
    var lo = 0, hi = list.length - 1;
    if (!list.length) return -1;
    if (d >= list[hi][keyD1]) return hi;
    if (d <= list[0][keyD0]) return 0;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (d < list[mid][keyD0]) hi = mid;
      else if (d >= list[mid][keyD0] && d <= list[mid][keyD1]) { lo = mid; break; }
      else lo = mid + 1;
    }
    return lo;
  }

  function cOf(d) {
    var i = findIdx(segs, d, 'd0', 'd1');
    return i < 0 ? 0 : segC(segs[i], d);
  }
  function wOf(d) {
    var i = findIdx(segs, d, 'd0', 'd1');
    return i < 0 ? BASE_W : segW(segs[i], d);
  }

  function pushChan(d0, d1, x0, x1) { ckps.push({ d0: d0, d1: d1, x0: x0, x1: x1 }); }
  function chanX(d) {
    if (!ckps.length) return cOf(d);
    var i = findIdx(ckps, d, 'd0', 'd1');
    var k = ckps[i];
    var t = k.d1 === k.d0 ? 1 : clamp((d - k.d0) / (k.d1 - k.d0), 0, 1);
    return lerp(k.x0, k.x1, t);
  }

  function spawnRock(x, d, rc, lumpSeed, shade) {
    spawnIdx++;
    var r = { id: 'r' + spawnIdx, x: x, d: d, rc: rc, vr: rc + 4, active: true, passed: false, shade: shade, lump: lumpSeed };
    rocks.push(r);
    return r;
  }

  function tryRock(d, clearOff, rc) {
    var cx = chanX(d);
    var x = cx + clearOff;
    var cc = cOf(d), ww = wOf(d);
    if (Math.abs(x - cc) + rc > ww - 8) return null;
    return spawnRock(x, d, rc, rng.ri(0, 65535), rng.n());
  }

  function placeRocks(d0, d1) {
    var diff = diffAt(d0);
    var span = d1 - d0;
    var pat = rng.pickw([
      ['none', Math.max(0.08, 0.32 - 0.18 * diff)],
      ['guard', 1.05 + 0.55 * diff],
      ['slalom', 0.85 + 0.6 * diff],
      ['gate', 0.65 + 0.45 * diff],
      ['clutter', 0.5 + 0.9 * diff],
      ['lone', 0.95]
    ]);
    var i, k, dd;
    if (pat === 'none') return;
    if (pat === 'guard') {
      dd = d0 + span * rng.rf(0.35, 0.75);
      tryRock(dd, (rng.chance(0.5) ? 1 : -1) * (rng.rf(36, 52) + rng.rf(30, 44)), rng.rf(30, 44));
    } else if (pat === 'slalom') {
      k = rng.ri(2, 3);
      for (i = 0; i < k; i++) {
        dd = d0 + span * (0.22 + 0.56 * i / Math.max(1, k - 1)) + rng.rf(-20, 20);
        tryRock(dd, (i % 2 === 0 ? 1 : -1) * (rng.rf(42, 72) + rng.rf(17, 27)), rng.rf(17, 27));
      }
    } else if (pat === 'gate') {
      var gd = d0 + span * rng.rf(0.3, 0.65);
      var gapC = rng.rf(-18, 18);
      var gw = rng.rf(92, 122) - 14 * diff;
      var rr = rng.rf(24, 38);
      tryRock(gd, gapC + gw / 2 + rr, rr);
      tryRock(gd, -(gw / 2 - gapC) - rr, rr);
    } else if (pat === 'clutter') {
      k = rng.ri(2, 4);
      for (i = 0; i < k; i++) {
        dd = d0 + span * rng.rf(0.15, 0.85);
        tryRock(dd, (rng.chance(0.5) ? 1 : -1) * (rng.rf(34, 110)), rng.rf(13, 21));
      }
    } else {
      dd = d0 + span * rng.rf(0.25, 0.75);
      tryRock(dd, (rng.chance(0.5) ? 1 : -1) * rng.rf(30, 90), rng.rf(16, 30));
    }
  }

  function placeFragments(d0, d1) {
    var diff = diffAt(d0);
    if (!rng.chance(0.52 - 0.1 * diff)) return;
    var kind = rng.pickw([
      ['line', 1.1], ['chevron', 1.0], ['vron', 0.85], ['sweep', 0.95], ['slalom', 0.8]
    ]);
    var n = rng.ri(4, 7);
    var vd = rng.rf(50, 63);
    var step = rng.rf(26, 34);
    var side = rng.chance(0.5) ? 1 : -1;
    var offs = [], i, o, apex;
    for (i = 0; i < n; i++) {
      o = 0;
      if (kind === 'line') o = side * rng.rf(22, 48) + Math.sin(i * 0.9) * 6;
      else if (kind === 'chevron') {
        apex = (n - 1) / 2;
        o = side * (Math.abs(i - apex) + 0.35) * step * 1.45;
      } else if (kind === 'vron') {
        apex = Math.floor(n / 2);
        o = side * (i < apex ? i * step * 1.5 : (n - 1 - i) * step * 1.65);
      } else if (kind === 'sweep') {
        o = side * Math.sin(i / (n - 1) * Math.PI) * step * rng.rf(2.4, 3.2);
      } else {
        o = (i % 2 === 0 ? 1 : -1) * side * step * rng.rf(1.15, 1.8);
      }
      offs.push(o);
    }
    fKindSeq++;
    var pad = rng.rf(70, 120);
    for (i = 0; i < n; i++) {
      var di = d0 + pad + i * vd;
      if (di > d1 - 30) break;
      var cx = chanX(di);
      var lim = Math.max(0, wOf(di) - 16);
      spawnItem('fragment', clamp(cx + offs[i], cx - lim, cx + lim), di, 19, 16,
        'fm' + fKindSeq, kind, i);
    }
  }

  function spawnItem(kind, x, d, vr, cr, fid, fkind, fidx) {
    spawnIdx++;
    var it = {
      id: (kind === 'fragment' ? 'f' : 'p') + spawnIdx,
      kind: kind, x: x, d: d, vr: vr, cr: cr, active: true
    };
    if (kind === 'fragment') { it.fid = fid; it.fkind = fkind; it.fidx = fidx; }
    items.push(it);
    return it;
  }

  function placePower(d0, d1) {
    if (nextPowerD > d1) return;
    var dp = Math.max(nextPowerD, d0 + 60);
    if (dp > d1 - 40) return;
    spawnItem('power', chanX(dp), dp, 23, 19, null, null, 0);
    nextPowerD = dp + rng.rf(6200, 9800);
  }

  function genBand() {
    var d0 = bandD;
    var len = rng.rf(430, 650) * (1 + 0.22 * diffAt(d0));
    var d1 = d0 + len;
    ensureWalls(d1 + HORIZON + 400);

    var F = rng.rf(0.004, 0.0095);
    var ph = chanPh;
    var phNext = chanPh + F * len;
    chanPh = phNext;
    var amp = Math.min(rng.rf(12, 34) * (1 - 0.45 * diffAt(d0)),
                       Math.max(0, wOf(d0 + len * 0.5) - CHAN_MARGIN));
    var prevX = ckps.length ? ckps[ckps.length - 1].x1 : 0;
    var xA = clamp(prevX + Math.sin(ph) * amp,
                   cOf(d0) - wOf(d0) + CHAN_MARGIN, cOf(d0) + wOf(d0) - CHAN_MARGIN);
    var xEnd = clamp(cOf(d1) + Math.sin(phNext) * amp,
                     cOf(d1) - wOf(d1) + CHAN_MARGIN, cOf(d1) + wOf(d1) - CHAN_MARGIN);
    pushChan(d0, d1, ckps.length ? prevX : 0, xEnd);
    bands.push({ d0: d0, d1: d1 });

    placeFragments(d0, d1);
    placeRocks(d0, d1);
    placePower(d0, d1);

    bandD = d1;
  }

  function pumpGen() {
    ensureWalls(pd + WALL_AHEAD);
    while (bandD < pd + GEN_AHEAD) genBand();
  }

  function pruneWorlds() {
    var cut = pd - REAR_KEEP, i;
    for (i = 0; i < rocks.length && rocks[i].d < cut; i++);
    if (i > 0) rocks.splice(0, i);
    for (i = 0; i < items.length && items[i].d < cut; i++);
    if (i > 0) items.splice(0, i);
    for (i = 0; i < bands.length && bands[i].d1 < cut; i++);
    if (i > 0) bands.splice(0, i);
    for (i = 0; i < ckps.length && ckps[i].d1 < cut; i++);
    if (i > 0) ckps.splice(0, i);
  }

  /* ---------------- run rules ---------------- */

  function applyStall() {
    if (!stall) { stallV0 = Math.max(speed, CRAWL); stallT = STALL_T; }
    else stallT = Math.max(stallT, STALL_T * 0.7);
    stall = true;
  }

  function doWallHit() {
    wallC++;
    pushEvent('wall_contact');
    applyStall();
    wallCd = 0.85;
  }

  function hitRock(r) {
    r.active = false;
    if (timeMs < invUntilMs) {
      rockBrk++;
      scoreB += 240;
      remainingMs = Math.min(TIME_CAP, remainingMs + POWHIT_TIME);
      pushEvent('rock_broken');
    } else {
      hitsC++;
      pushEvent('rock_hit');
      applyStall();
      var dx = px - r.x, dz = pd - r.d;
      var dist = Math.sqrt(dx * dx + dz * dz) || 1;
      px = r.x + dx / dist * (PR + r.rc);
      latV *= 0.25;
    }
    wallCd = Math.max(wallCd, 0.3);
  }

  function collect(it) {
    it.active = false;
    if (it.kind === 'fragment') {
      fragC++;
      scoreB += 160;
      remainingMs = Math.min(TIME_CAP, remainingMs + FRAG_TIME * (1 - 0.3 * diffAt(pd)));
      pushEvent('fragment');
    } else {
      invUntilMs = timeMs + POWER_MS;
      pushEvent('power');
    }
  }

  function endRun() {
    remainingMs = 0;
    phase = 'gameover';
    rankStr = gradeFor(Math.floor(pd + scoreB));
  }

  function mergedInput() {
    var steer = (KB.left ? -1 : 0) + (KB.right ? 1 : 0) + PT.stickX;
    return { accel: !!(KB.accel || PT.accel), steer: clamp(steer, -1, 1) };
  }

  function stepPlay(inp) {
    tickN++;
    timeMs = Math.round(tickN * STEP_MS);

    var v = speed;
    if (stall) {
      stallT -= DT;
      var u = Math.max(0, stallT / STALL_T);
      v = CRAWL + (stallV0 - CRAWL) * u * u;
      if (stallT <= 0) stall = false;
    } else if (inp.accel) {
      v += (TOP - v) * (1 - Math.exp(-ACC_K * DT));
    } else {
      v -= (v - CRAWL) * (1 - Math.exp(-COAST_K * DT));
    }
    v = clamp(v, CRAWL, TOP);
    speed = v;

    var sn = clamp((TOP - v) / (TOP - CRAWL), 0, 1);
    var latMax = LAT_TOP + (LAT_CRAWL - LAT_TOP) * Math.pow(sn, 1.25);
    latV += (inp.steer * latMax - latV) * (1 - Math.exp(-STEER_K * DT));

    var dPrev = pd, xPrev = px;
    var clPrev = prevCL, crPrev = prevCR;
    pd += speed * DT;
    px += latV * DT;

    if (speed >= TOP * 0.985 && inp.accel && !stall) stats.streakMs += STEP_MS;
    else { if (stats.streakMs > stats.streakMaxMs) stats.streakMaxMs = stats.streakMs; stats.streakMs = 0; }
    if (pd > stats.bestDepth) stats.bestDepth = pd;

    pumpGen();

    wallCd -= DT;
    var cl = cOf(pd) - wOf(pd), cr = cOf(pd) + wOf(pd);
    if (px - PR < cl) {
      px = cl + PR;
      var vRelL = latV - (cl - clPrev) / DT;
      if ((latV < -34 || vRelL < -34) && wallCd <= 0) doWallHit();
      if (latV < 0) latV = 0;
    } else if (px + PR > cr) {
      px = cr - PR;
      var vRelR = latV - (cr - crPrev) / DT;
      if ((latV > 34 || vRelR > 34) && wallCd <= 0) doWallHit();
      if (latV > 0) latV = 0;
    }
    prevCL = cl; prevCR = cr;

    var i, r, it, dx, dz, rr;
    for (i = 0; i < rocks.length; i++) {
      r = rocks[i];
      dz = r.d - pd;
      if (dz > 150 || dz < -150) continue;
      if (r.active) {
        dx = px - r.x;
        rr = PR + r.rc;
        if (dx * dx + dz * dz < rr * rr) { hitRock(r); continue; }
      }
      if (!r.passed && r.d <= pd) {
        r.passed = true;
        if (r.active) {
          var tt = pd === dPrev ? 1 : (r.d - dPrev) / (pd - dPrev);
          var xa = lerp(xPrev, px, clamp(tt, 0, 1));
          var gap = Math.abs(xa - r.x) - (PR + r.rc);
          if (gap < PR * 2) {
            stats.grazes++;
            if (gap < stats.shave) stats.shave = gap;
            pushEvent('near_miss');
          }
        }
      }
    }

    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!it.active) continue;
      dz = it.d - pd;
      if (dz > 64 || dz < -64) continue;
      dx = px - it.x;
      rr = PR + it.cr;
      if (dx * dx + dz * dz < rr * rr) collect(it);
    }

    remainingMs -= STEP_MS;
    if (remainingMs <= 0) { endRun(); return; }

    if ((tickN & 31) === 0) pruneWorlds();
  }

  /* ---------------- accessors ---------------- */

  function computeSafeHalfWidth() {
    var minAvail = 999, step = 40;
    var top = Math.min(pd + HORIZON, bandD);
    for (var d = pd; d <= top; d += step) {
      var c = cOf(d), ch = chanX(d);
      var avail = wOf(d) - Math.abs(ch - c);
      for (var i = 0; i < rocks.length; i++) {
        var r = rocks[i];
        if (!r.active) continue;
        if (r.d < d - 55 || r.d > d + 55) continue;
        var clearance = Math.abs(r.x - ch) - r.rc;
        if (clearance < avail) avail = clearance;
      }
      if (avail < minAvail) minAvail = avail;
    }
    return Math.max(0, minAvail);
  }

  var seenSeqFx = 0;
  function consumeFx() {
    var out = [];
    for (var i = 0; i < evList.length; i++)
      if (evList[i].seq > seenSeqFx) { out.push(evList[i]); seenSeqFx = evList[i].seq; }
    return out;
  }

  function sampleWalls(fromD, toD, n, cb) {
    for (var i = 0; i <= n; i++) {
      var d = fromD + (toD - fromD) * i / n;
      cb(d, cOf(d), wOf(d), chanX(d));
    }
  }

  function countCombo() {
    var c = 0;
    for (var i = evList.length - 1; i >= 0; i--) {
      var e = evList[i];
      if (e.tick < tickN - 300) break;
      if (e.kind === 'near_miss') c++;
      else if (e.kind === 'rock_hit' || e.kind === 'wall_contact') break;
    }
    return c;
  }

  var CONSTS = {
    crawl: CRAWL, top: TOP, pr: PR, horizon: HORIZON,
    crawlLat: LAT_CRAWL, topLat: LAT_TOP,
    fragTime: FRAG_TIME, powerHitTime: POWHIT_TIME, powerMs: POWER_MS,
    timeStart: TIME_START, timeCap: TIME_CAP, unitsToMeters: 0.1
  };

  var api = {};

  api.reset = function (seed) {
    seedV = (seed === undefined || seed === null) ? (((Math.random() * 4294967296) >>> 0)) : (seed >>> 0);
    rng = new Rng(seedV);
    segs = []; ckps = []; bands = []; rocks = []; items = [];
    wallD = 0; bandD = 260; chanPh = rng.rf(0, 6.28);
    spawnIdx = 0; fKindSeq = 0;
    px = 0; pd = 0; speed = CRAWL; latV = 0;
    stall = false; stallT = 0; stallV0 = CRAWL; wallCd = 0; prevCL = -BASE_W; prevCR = BASE_W;
    tickN = 0; timeMs = 0; remainingMs = TIME_START; invUntilMs = 0;
    scoreB = 0; fragC = 0; rockBrk = 0; hitsC = 0; wallC = 0;
    phase = 'ready'; rankStr = null;
    evSeq = 0; evList = []; lastEv = null; seenSeqFx = 0;
    nextPowerD = 5200 + rng.rf(0, 2200);
    lastDir = 0;
    stats = freshStats();
    pumpGen();
    evList = []; evSeq = 0; lastEv = null;
  };

  var advAcc = 0;
  api.stepOnce = function () {
    if (phase !== 'playing') return;
    stepPlay(mergedInput());
  };
  api.pumpStart = function () {
    if (phase !== 'ready') return false;
    if (!mergedInput().accel) return false;
    phase = 'playing';
    return true;
  };
  api.advance = function (ms) {
    if (phase !== 'playing') { advAcc = 0; return; }
    ms = Number(ms);
    if (!isFinite(ms) || ms <= 0) return;
    advAcc += ms;
    var guard = 0;
    while (advAcc >= STEP_MS && guard++ < 20000) {
      advAcc -= STEP_MS;
      stepPlay(mergedInput());
    }
    if (advAcc >= STEP_MS) advAcc = 0;
  };
  api.getSeed = function () { return seedV; };
  api.input = { kb: KB, pt: PT };
  api.hooks = {};
  api.consts = CONSTS;

  api.restart = function (mode) {
    if (mode === 'new') {
      var ns = api.hooks.newSeed ? api.hooks.newSeed() : ((Math.random() * 4294967296) >>> 0);
      api.reset(ns);
    } else {
      api.reset(seedV);
    }
  };

  api.viewState = function () {
    return {
      phase: phase,
      seed: seedV,
      rank: rankStr,
      player: { x: px, d: pd, speed: speed, r: PR, latV: latV, stall: stall },
      invincible: timeMs < invUntilMs,
      invRemain: Math.max(0, invUntilMs - timeMs),
      remaining: Math.max(0, remainingMs),
      difficulty: diffAt(pd),
      score: Math.floor(pd + scoreB),
      fragmentsCollected: fragC,
      rocksBroken: rockBrk,
      hits: hitsC,
      wallContacts: wallC,
      stats: stats,
      combo: countCombo(),
      grades: GRADES,
      consts: CONSTS
    };
  };

  api.geometryAt = sampleWalls;
  api.consumeFx = consumeFx;
  api.getRocks = function () { return rocks; };
  api.getItems = function () { return items; };

  api.snapshot = function () {
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var walls = [];
    for (var i = 0; i < SAMPLE_N; i++) {
      var d = pd + HORIZON * i / (SAMPLE_N - 1);
      walls.push({ depth: r2(d), leftX: r2(cOf(d) - wOf(d)), rightX: r2(cOf(d) + wOf(d)) });
    }
    var loD = pd - REAR_KEEP, hiD = pd + HORIZON;
    var rl = [], il = [];
    var ri2, rk, im;
    for (ri2 = 0; ri2 < rocks.length; ri2++) {
      rk = rocks[ri2];
      if (rk.d >= loD && rk.d <= hiD)
        rl.push({ id: rk.id, position: { x: r2(rk.x), depth: r2(rk.d) }, active: rk.active,
                  visualRadius: r2(rk.vr), collisionRadius: r2(rk.rc) });
    }
    for (ri2 = 0; ri2 < items.length; ri2++) {
      im = items[ri2];
      if (im.d >= loD && im.d <= hiD) {
        var io = { id: im.id, type: im.kind === 'fragment' ? 'fragment' : 'power',
                   position: { x: r2(im.x), depth: r2(im.d) }, active: im.active,
                   visualRadius: r2(im.vr), collisionRadius: r2(im.cr) };
        if (im.kind === 'fragment') {
          io.formationId = im.fid; io.formationKind = im.fkind; io.formationIndex = im.fidx;
        }
        il.push(io);
      }
    }
    rl.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    il.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var evs = [];
    for (i = 0; i < evList.length; i++)
      evs.push({ seq: evList[i].seq, kind: evList[i].kind, tick: evList[i].tick });
    return {
      phase: phase,
      tick: tickN,
      elapsedMs: timeMs,
      timeMs: timeMs,
      seed: seedV,
      rngState: rng.s >>> 0,
      spawnIndex: spawnIdx,
      input: { accel: !!(KB.accel || PT.accel), left: !!KB.left, right: !!KB.right,
               stick: Math.round(clamp(PT.stickX, -1, 1) * 1000) / 1000 },
      difficulty: Math.round(diffAt(pd) * 1000) / 1000,
      score: Math.floor(pd + scoreB),
      depth: r2(pd),
      x: r2(px),
      playerRadius: PR,
      speed: r2(speed),
      maxSpeed: TOP,
      hits: hitsC,
      wallContacts: wallC,
      fragmentsCollected: fragC,
      rocksBroken: rockBrk,
      invincibleUntilMs: Math.round(invUntilMs),
      rank: rankStr,
      remainingMs: Math.round(Math.max(0, remainingMs)),
      courseCenterX: r2(cOf(pd)),
      corridorHalfWidth: r2(wOf(pd)),
      previewMs: Math.round(HORIZON / TOP * 1000),
      safeHalfWidth: r2(computeSafeHalfWidth()),
      walls: walls,
      rocks: rl,
      items: il,
      events: evs,
      lastEvent: lastEv ? { seq: lastEv.seq, kind: lastEv.kind, tick: lastEv.tick } : null
    };
  };

  api.reset(seedV);
  return api;
}

var rootObj = typeof self !== 'undefined' ? self : root;
rootObj.DelveCore = { createGame: createGame };
if (typeof module !== 'undefined' && module.exports) module.exports = { createGame: createGame };

})(typeof self !== 'undefined' ? self : this);
