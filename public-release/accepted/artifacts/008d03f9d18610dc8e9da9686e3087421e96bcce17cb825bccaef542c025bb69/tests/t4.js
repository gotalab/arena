const { chromium } = require('playwright');
const URL = 'http://localhost:8099/index.html';
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; }

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  // Tier profile measured on a private Sim instance (no effect on the live game)
  const tiers = await page.evaluate(() => {
    const rows = [];
    for (let tier = 0; tier <= 5; tier++) {
      let spawns = 0, fast = 0, walkers = 0, overlapTicks = 0, maxConcurrent = 0, speedSum = 0, ticks = 60 * 240;
      const s = new window.StompSim(4242);
      s.phase = 'run';
      s.airEnemiesDefeated = 1;      // past the opening
      s.difficulty = tier;
      const seen = new Set();
      for (let i = 0; i < ticks; i++) {
        s.remainingMs = 60000;        // hold the clock so only the director is measured
        s.difficulty = tier;
        s.step();
        const fly = s.enemies.filter(e => e.active && e.lane !== 'ground');
        const walk = s.enemies.filter(e => e.active && e.lane === 'ground');
        maxConcurrent = Math.max(maxConcurrent, fly.length);
        if (fly.length && walk.length) overlapTicks++;
        for (const e of s.enemies) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.lane === 'ground') walkers++;
          else { spawns++; speedSum += Math.abs(e.vx); if (e.type === 'fastFlyer') fast++; }
        }
      }
      rows.push({
        tier,
        flyersPerMin: +(spawns / (ticks / 3600)).toFixed(2),
        fastShare: +(fast / Math.max(1, spawns)).toFixed(2),
        walkersPerMin: +(walkers / (ticks / 3600)).toFixed(2),
        dividedAttentionPct: +(overlapTicks / ticks * 100).toFixed(1),
        maxConcurrentFlyers: maxConcurrent,
        avgFlyerSpeed: +(speedSum / Math.max(1, spawns)).toFixed(1)
      });
    }
    return rows;
  });
  console.log(tiers.map(r => JSON.stringify(r)).join('\n'));
  ok(tiers[5].flyersPerMin > tiers[0].flyersPerMin * 1.25, 'higher tiers send targets more often',
    tiers.map(r => r.flyersPerMin));
  ok(tiers[0].fastShare === 0 && tiers[5].fastShare > 0.35, 'fast patterns arrive with tier',
    tiers.map(r => r.fastShare));
  ok(tiers[5].avgFlyerSpeed > tiers[0].avgFlyerSpeed * 1.3, 'higher tiers cross faster',
    tiers.map(r => r.avgFlyerSpeed));
  ok(tiers[5].dividedAttentionPct > tiers[0].dividedAttentionPct + 8, 'higher tiers divide attention',
    tiers.map(r => r.dividedAttentionPct));
  ok(tiers[5].maxConcurrentFlyers <= 3 && tiers[5].walkersPerMin <= 6,
    'pressure stays bounded at the peak', { concurrent: tiers[5].maxConcurrentFlyers, walkers: tiers[5].walkersPerMin });
  ok(tiers.every((r, i) => i === 0 || r.flyersPerMin >= tiers[i - 1].flyersPerMin - 0.6),
    'escalation is monotone, not spiky', tiers.map(r => r.flyersPerMin));

  // difficulty is nondecreasing and driven by attack score only
  const nd = await page.evaluate(() => {
    const s = new window.StompSim(7);
    s.phase = 'run';
    let tiers = [], prev = 0, ok2 = true;
    for (let i = 0; i < 60 * 200; i++) {
      s.remainingMs = 60000;
      s.step();
      if (s.difficulty < prev) ok2 = false;
      prev = s.difficulty;
    }
    // pure survival with no attacks must not raise the tier
    return { nonDecreasing: ok2, passiveTier: s.difficulty, topHits: s.topHits, score: s.score };
  });
  ok(nd.nonDecreasing, 'difficulty never decreases');
  ok(nd.passiveTier === 0 || nd.score > 0, 'passive survival alone does not raise the tier', nd);

  // audio boots on a gesture without throwing
  const aud = await page.evaluate(async () => {
    const A = window.StompAudio;
    A.ensure();
    A.bounce('normal'); A.bounce('power'); A.bounce('weak');
    A.topHit(1); A.topHit(2); A.topHit(3);
    A.defeat(); A.wrongSide(); A.drop(); A.stomp(); A.jump(); A.land(); A.over(); A.tick(3);
    const state = A.ctx ? A.ctx.state : 'none';
    const m1 = A.toggle(); const m2 = A.toggle();
    return { hasCtx: !!A.ctx, state, muteToggles: [m1, m2] };
  });
  ok(aud.hasCtx && aud.muteToggles[0] === true && aud.muteToggles[1] === false,
    'procedural audio initialises and mutes cleanly', aud);

  // enemy corpses linger, then leave
  const corpse = await page.evaluate(() => {
    const s = new window.StompSim(11);
    s.phase = 'run';
    const e = s.spawn({ type: 'slowFlyer', lane: 'low', side: -1 });
    e.x = 180;
    e.hitsTaken = 2;
    s.ball.x = 180; s.ball.y = e.y - 40; s.ball.vy = 300;
    let sawInactive = 0, removedAt = null;
    for (let i = 0; i < 200; i++) {
      s.remainingMs = 60000;
      s.step();
      const found = s.enemies.find(x => x.id === e.id);
      if (found && !found.active) sawInactive++;
      if (!found && removedAt === null) removedAt = i;
      if (removedAt !== null) break;
    }
    return { defeated: s.airEnemiesDefeated, observableTicks: sawInactive, removedAtTick: removedAt };
  });
  ok(corpse.defeated === 1 && corpse.observableTicks > 20 && corpse.removedAtTick !== null,
    'defeated enemies stay observable briefly, then leave the list', corpse);

  ok(errs.length === 0, 'no errors', errs.slice(0, 4));
  await b.close();
})();
