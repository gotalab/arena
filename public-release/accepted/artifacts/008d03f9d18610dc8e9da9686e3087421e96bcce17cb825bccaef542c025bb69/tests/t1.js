const { chromium } = require('playwright');
const URL = 'http://localhost:8099/index.html';

function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; }

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  ok(errs.length === 0, 'no runtime errors', errs.slice(0, 5));

  const api = await page.evaluate(() => {
    const g = window.__ARENA_GAME__;
    return { has: !!g, fns: g ? Object.keys(g) : [], types: g ? Object.keys(g).map(k => typeof g[k]) : [] };
  });
  ok(api.has && api.fns.includes('reset') && api.fns.includes('snapshot') && api.fns.includes('advance'), 'telemetry api present', api);

  // frozen ready state
  const frozen = await page.evaluate(() => {
    const g = window.__ARENA_GAME__;
    g.reset(7);
    const a = g.snapshot();
    g.advance(5000);
    const c = g.snapshot();
    return { a, c };
  });
  ok(frozen.a.phase === 'ready' && frozen.c.tick === 0 && frozen.c.remainingMs === frozen.a.remainingMs,
    'ready state frozen: advance() does nothing', { phase: frozen.a.phase, tick: frozen.c.tick });

  const geo = frozen.a;
  ok(geo.groundY > geo.lowLaneY && geo.lowLaneY > geo.highLaneY, 'lane orientation consistent',
    { groundY: geo.groundY, lowLaneY: geo.lowLaneY, highLaneY: geo.highLaneY });
  ok(geo.machineNormalApexY - geo.machine.radius > geo.lowLaneY || geo.machineNormalApexY > geo.lowLaneY,
    'normal jump apex stays below low lane', { apex: geo.machineNormalApexY, low: geo.lowLaneY });
  ok(geo.lastEvent === null, 'lastEvent null before first event');
  ok(Array.isArray(geo.recentEvents) && geo.recentEvents.length === 0, 'recentEvents empty at reset');
  ok(geo.ball.lastBounceKind === null, 'lastBounceKind null at reset');

  // snapshot purity
  const pure = await page.evaluate(() => {
    const g = window.__ARENA_GAME__;
    g.reset(11);
    // start via DOM key
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    g.advance(2000);
    const a = JSON.stringify(g.snapshot());
    for (let i = 0; i < 20; i++) g.snapshot();
    const b2 = JSON.stringify(g.snapshot());
    return a === b2;
  });
  ok(pure, 'snapshot() is pure');

  // determinism: same seed + same held input -> identical snapshots
  const det = await page.evaluate(() => {
    const g = window.__ARENA_GAME__;
    function run() {
      g.reset(4242);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
      g.advance(3000);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      g.advance(500);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
      g.advance(9000);
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
      return JSON.stringify(g.snapshot());
    }
    const a = run(), b2 = run(), c = run();
    return { same: a === b2 && b2 === c, len: a.length };
  });
  ok(det.same, 'deterministic across identical replays', det);

  // advance granularity equivalence: 1x6000ms == 6x1000ms == 600x10ms
  const gran = await page.evaluate(() => {
    const g = window.__ARENA_GAME__;
    function run(chunks) {
      g.reset(99);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
      chunks.forEach(c => g.advance(c));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }));
      return JSON.stringify(g.snapshot());
    }
    const a = run([6000]);
    const b2 = run(new Array(6).fill(1000));
    const c = run(new Array(600).fill(10));
    return { ab: a === b2, ac: a === c };
  });
  ok(gran.ab && gran.ac, 'advance() granularity-invariant', gran);

  // hitbox ratios
  const audit = await page.evaluate(() => window.STOMP_audit());
  const ratios = audit.hitboxRatios;
  ok(Object.values(ratios).every(r => r <= 1.1), 'no hitbox exceeds drawn size by >10%', ratios);
  ok(audit.bands.every(b => b.fair), 'machine outruns ball drift in every band', audit.bands.map(b => [b.kind, b.machineReach, b.maxBallDrift]));
  ok(audit.jumpStaysBelowLowLane, 'jump apex below low lane');

  await b.close();
})();
