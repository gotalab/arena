const { chromium } = require('playwright');
const BOT = require('./bot.js');
const URL = 'http://localhost:8099/index.html';
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; }

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: BOT });
  const S = await page.evaluate(() => window.STOMP_K);

  // --- opening promise across many seeds
  const opening = await page.evaluate(() => {
    const out = [];
    const G = window.__ARENA_GAME__;
    for (const seed of [0, 1, 2, 3, 7, 13, 42, 99, 555, 12345, 987654, 2 ** 31]) {
      window.__T.releaseAll();
      G.reset(seed);
      window.__T.jump();
      let firstLow = null, firstHigh = null, fastEarly = 0, worstGap = 0, gap = 0, killed = false;
      for (let i = 0; i < 60 * 40; i++) {
        G.advance(1000 / 60);
        const s = G.snapshot();
        if (s.phase !== 'run') break;
        if (s.airEnemiesDefeated > 0) killed = true;
        const fly = s.enemies.filter(e => e.active && e.lane !== 'ground');
        if (!killed) { if (fly.length === 0) { gap++; worstGap = Math.max(worstGap, gap); } else gap = 0; }
        for (const e of fly) {
          if (e.x < -5 || e.x > 365) continue;
          if (e.type === 'slowFlyer' && e.lane === 'low' && firstLow === null) firstLow = s.elapsedMs;
          if (e.type === 'slowFlyer' && e.lane === 'high' && firstHigh === null) firstHigh = s.elapsedMs;
          if (e.type === 'fastFlyer' && !killed) fastEarly++;
        }
      }
      window.__T.releaseAll();
      out.push({ seed, firstLow, firstHigh, fastEarly, worstGapMs: Math.round(worstGap * 1000 / 60) });
    }
    return out;
  });
  ok(opening.every(o => o.firstLow !== null && o.firstLow <= 3000), 'slow LOW flyer crossing within first seconds, every seed', opening.map(o => o.firstLow));
  ok(opening.every(o => o.firstHigh !== null && o.firstHigh < 39000), 'slow HIGH flyer before half the starting clock, every seed', opening.map(o => o.firstHigh));
  ok(opening.every(o => o.fastEarly === 0), 'no fast flyer before the first air kill, every seed');
  ok(opening.every(o => o.worstGapMs <= 2200), 'air refilled within ~2s while learning', opening.map(o => o.worstGapMs));

  // --- bounce bands, measured from clean uninterrupted arcs
  const bands = await page.evaluate(() => {
    const acc = { weak: [], normal: [], power: [] };
    const kinds = {};
    for (const seed of [31, 77, 404]) {
      const r = window.__T.run(seed, 60 * 80);
      r.apexes.forEach(([k, y]) => acc[k].push(y));
      Object.keys(r.kinds).forEach(k => kinds[k] = (kinds[k] || 0) + r.kinds[k]);
    }
    return { acc, kinds };
  });
  const A = bands.acc;
  ok(A.normal.length > 4 && A.power.length > 2, 'observed normal and power arcs', { n: A.normal.length, p: A.power.length, w: A.weak.length });
  ok(A.normal.every(y => y < S.LOW_LANE_Y && y > S.HIGH_LANE_Y), 'normal arc crosses LOW lane, never reaches HIGH', A.normal.slice(0, 8));
  ok(A.power.every(y => y < S.HIGH_LANE_Y), 'power arc reaches above HIGH lane', A.power.slice(0, 8));
  ok(A.weak.length === 0 || A.weak.every(y => y > S.LOW_LANE_Y), 'weak arc stays below LOW lane', A.weak.slice(0, 8));

  // --- pursuits actually complete
  const runs = await page.evaluate(() => {
    const out = [];
    for (const seed of [1, 7, 42, 777, 2024, 31337]) {
      const r = window.__T.run(seed, 60 * 400);
      out.push({
        seed, phase: r.fin.phase, elapsed: r.fin.elapsedMs, score: r.fin.score,
        defeats: r.fin.airEnemiesDefeated, tops: r.fin.topHits, wrong: r.fin.wrongSideHits,
        drops: r.fin.ballDrops, longest: r.fin.longestCleanSequence, tier: r.fin.difficulty,
        rank: r.fin.rank, kinds: r.kinds
      });
    }
    return out;
  });
  console.log('    runs:', runs.map(r => `seed${r.seed}: ${Math.round(r.elapsed / 1000)}s score${r.score} kills${r.defeats} tops${r.tops} wrong${r.wrong} drops${r.drops} tier${r.tier} ${r.rank}`).join('\n           '));
  ok(runs.every(r => r.defeats >= 1), 'every seed yields completed pursuits', runs.map(r => r.defeats));
  ok(runs.some(r => r.tier >= 2), 'attack score drives the difficulty tier up', runs.map(r => r.tier));
  ok(runs.every(r => r.longest >= 2) && runs.filter(r => r.longest >= 3).length >= runs.length - 1,
    'clean pursuit chains of three or more are routine', runs.map(r => r.longest));

  // deliberate drop: abandon the ball at a wall
  const drop = await page.evaluate(() => {
    const G = window.__ARENA_GAME__;
    window.__T.releaseAll();
    G.reset(5);
    window.__T.jump();
    window.__T.key('ArrowRight', true);
    let dropTick = null, backTick = null, kinds = {};
    let lastSeq = 0;
    for (let i = 0; i < 60 * 30; i++) {
      G.advance(1000 / 60);
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      for (const e of s.recentEvents) {
        if (e.sequence <= lastSeq) continue;
        lastSeq = e.sequence;
        kinds[e.kind] = (kinds[e.kind] || 0) + 1;
        if (e.kind === 'ball_drop' && dropTick === null) dropTick = e.tick;
      }
      if (dropTick !== null && s.ball.active && backTick === null) backTick = s.tick;
      if (backTick !== null) break;
    }
    window.__T.releaseAll();
    return { kinds, recoverMs: dropTick !== null && backTick !== null ? Math.round((backTick - dropTick) * 1000 / 60) : null };
  });
  ok(drop.kinds.ball_drop >= 1 && drop.recoverMs !== null && drop.recoverMs <= 700,
    'dropped ball returns to a readable recovery within about a second', drop);

  const allKinds = new Set(Object.keys(drop.kinds));
  runs.forEach(r => Object.keys(r.kinds).forEach(k => allKinds.add(k)));
  Object.keys(bands.kinds).forEach(k => allKinds.add(k));
  const need = ['machine_jump', 'machine_land', 'ball_bounce_weak', 'ball_bounce_normal', 'ball_bounce_power',
    'top_hit', 'enemy_defeated', 'wrong_side_hit', 'ball_drop', 'ground_stomp'];
  const missing = need.filter(k => !allKinds.has(k));
  ok(missing.length === 0, 'all contract event kinds observed in play', { missing, seen: [...allKinds] });

  // --- pursuit pays for itself
  const econ = await page.evaluate(() => {
    // measure real pursuits: clock delta from first top_hit on an enemy to its defeat
    const G = window.__ARENA_GAME__;
    const results = [];
    for (const seed of [7, 42, 777, 2024, 31337, 555]) {
      window.__T.releaseAll();
      G.reset(seed);
      window.__T.jump();
      const first = {};
      let lastSeq = 0;
      for (let i = 0; i < 60 * 400; i++) {
        const s = G.snapshot();
        if (s.phase !== 'run') break;
        window.__T.act(s);
        G.advance(1000 / 60);
        const s2 = G.snapshot();
        for (const e of s2.recentEvents) {
          if (e.sequence <= lastSeq) continue;
          lastSeq = e.sequence;
          if (e.kind === 'top_hit' && first[e.enemyId] === undefined) first[e.enemyId] = { tick: e.tick, gained: 0 };
          if (e.kind === 'top_hit') first[e.enemyId].gained += e.amountMs;
          if (e.kind === 'enemy_defeated' && first[e.enemyId]) {
            const drained = (e.tick - first[e.enemyId].tick) * 1000 / 60;
            results.push({ drained: Math.round(drained), gained: first[e.enemyId].gained });
          }
        }
      }
      window.__T.releaseAll();
    }
    return results;
  });
  const netPositive = econ.filter(r => r.gained > r.drained).length;
  ok(econ.length > 0 && netPositive === econ.length,
    'every completed pursuit returns more clock than it drained',
    { pursuits: econ.length, netPositive, sample: econ.slice(0, 6) });

  // --- the clock has no hidden drains
  const ledger = await page.evaluate(() => {
    const G = window.__ARENA_GAME__;
    const K = window.STOMP_K;
    const out = [];
    for (const seed of [1, 42, 31337]) {
      window.__T.releaseAll(); window.__T.lock = -1;
      G.reset(seed); window.__T.jump();
      let sum = 0, lastSeq = 0;
      for (let i = 0; i < 60 * 300; i++) {
        const s = G.snapshot();
        if (s.phase !== 'run') break;
        window.__T.act(s);
        G.advance(1000 / 60);
        for (const e of G.snapshot().recentEvents) {
          if (e.sequence <= lastSeq) continue;
          lastSeq = e.sequence;
          sum += e.amountMs;
        }
      }
      const f = G.snapshot();
      out.push({ seed, remaining: f.remainingMs, expect: Math.round(Math.max(0, K.START_MS - f.elapsedMs + sum)), phase: f.phase });
      window.__T.releaseAll();
    }
    return out;
  });
  ok(ledger.every(l => Math.abs(l.remaining - l.expect) <= 2),
    'clock = start - elapsed + event awards, no hidden drain', ledger);

  // --- restart restores the seeded run exactly
  const rs = await page.evaluate(() => {
    const G = window.__ARENA_GAME__;
    window.__T.releaseAll(); window.__T.lock = -1;
    G.reset(1234); window.__T.jump();
    window.__T.key('ArrowRight', true);
    G.advance(4000);
    window.__T.key('ArrowRight', false);
    const mid = JSON.stringify(G.snapshot());
    // R restarts the same seeded run
    window.__T.key('KeyR', true); window.__T.key('KeyR', false);
    const fresh = G.snapshot();
    window.__T.jump();
    window.__T.key('ArrowRight', true);
    G.advance(4000);
    window.__T.key('ArrowRight', false);
    const again = JSON.stringify(G.snapshot());
    window.__T.releaseAll();
    return { freshIsInitial: fresh.tick === 0 && fresh.phase === 'ready' && fresh.score === 0 && fresh.enemies.length === 0 && fresh.recentEvents.length === 0, same: mid === again, seed: fresh.seed };
  });
  ok(rs.freshIsInitial, 'R restores the complete initial state', rs);
  ok(rs.same, 'R replays the same seeded sequence', rs);

  // --- real time equals advance, field for field
  const rt = await page.evaluate(async () => {
    const G = window.__ARENA_GAME__;
    const STEP = 1000 / 60;
    window.__T.releaseAll();
    G.reset(31337);
    window.__T.jump();
    window.__T.key('ArrowRight', true);
    await new Promise(r => setTimeout(r, 2600));
    const live = G.snapshot();
    G.reset(31337);
    window.__T.jump();
    G.advance(live.tick * STEP);
    const rep = G.snapshot();
    window.__T.key('ArrowRight', false);
    window.__T.releaseAll();
    const a = JSON.stringify(live), b = JSON.stringify(rep);
    return { equal: a === b, tick: live.tick, liveScore: live.score };
  });
  ok(rt.equal, 'a real-time stretch is reproduced field-for-field by advance()', rt);

  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
})();
