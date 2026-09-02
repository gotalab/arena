// Dev-only screenshot pass for eyeballing the production values.
const { chromium } = require('playwright');
const { createServer } = require('./serve');
const PORT = 8713;

// Plays a pool with pure logic, stopping partway so the frontier is interesting.
const AUTO = `(fraction, stopPool) => {
  const A = window.__ARENA_GAME__, S = window.SHOAL;
  const startPool = A.snapshot().pool;
  let steps = 0;
  while (steps++ < 4000) {
    const s = A.snapshot();
    if (s.phase === 'ended') break;
    if (stopPool && s.pool >= stopPool) break;
    if (!stopPool) {
      if (s.pool !== startPool) break;
      const opened = s.rows.join('').replace(/[^0-8]/g, '').length;
      if (opened >= fraction * (s.gridWidth * s.gridHeight - s.urchinsTotal)) break;
    }
    const w = s.gridWidth, h = s.gridHeight, n = w * h;
    const open = new Uint8Array(n), val = new Int8Array(n), known = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = s.rows[y][x];
      if (ch >= '0' && ch <= '8') { open[y*w+x] = 1; val[y*w+x] = ch.charCodeAt(0) - 48; }
    }
    let moved = false;
    for (let it = 0; it < 40 && !moved; it++) {
      const r = S.gen.deduce(w, h, open, val, known, s.urchinsTotal, { maxCells: 24, budget: 2000000 });
      const safe = r.safe.filter(c => !open[c] && !known[c]);
      if (safe.length) { const c = safe[0]; A.act({type:'open', x: c % w, y: Math.floor(c / w)}); moved = true; break; }
      let prog = false;
      for (const m of r.mines) if (!known[m] && !open[m]) {
        known[m] = 1; prog = true;
        if (s.rows[Math.floor(m/w)][m%w] === '#') A.act({type:'flag', x: m % w, y: Math.floor(m/w)});
      }
      if (!prog) break;
    }
    if (!moved) break;
  }
}`;

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();

  async function shot(name, w, h, prep, settle) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('ERROR ' + name + ': ' + e));
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForTimeout(500);
    await page.addScriptTag({ url: '/js/rng.js' });
    await page.addScriptTag({ url: '/js/generator.js' });
    if (prep) await page.evaluate('(' + prep + ')()');
    await page.waitForTimeout(settle || 800);
    await page.screenshot({ path: `tools/shot-${name}.png` });
    await ctx.close();
  }

  // A mid-pool frontier on a phone
  await shot('mid', 390, 844, `() => {
    const A = window.__ARENA_GAME__;
    A.reset('gallery-mid');
    A.act({ type: 'open', x: 2, y: 6 });
    (${AUTO})(0.5);
  }`);

  // A deep, dense pool, played to a live frontier
  await shot('deep', 390, 844, `() => {
    const A = window.__ARENA_GAME__;
    A.reset('gallery-deep');
    for (let p = 0; p < 5; p++) {
      if (A.snapshot().pool >= 5 || A.snapshot().phase === 'ended') break;
      A.act({ type: 'open', x: 2, y: 3 });
      (${AUTO})(1, 5);
    }
    A.act({ type: 'open', x: 4, y: 6 });
    (${AUTO})(0.5);
  }`, 1000);

  // A small embedded frame
  await shot('small', 300, 420, `() => {
    const A = window.__ARENA_GAME__;
    A.reset('gallery-small');
    A.act({ type: 'open', x: 3, y: 5 });
    (${AUTO})(0.5);
  }`);

  // Mid-ripple, to check the wave reads
  await shot('ripple', 390, 844, `() => {
    const A = window.__ARENA_GAME__;
    A.reset('gallery-ripple');
    A.act({ type: 'open', x: 3, y: 7 });
  }`, 160);

  // Low tide hush
  await shot('lowtide', 390, 844, `() => {
    const A = window.__ARENA_GAME__;
    A.reset('gallery-tide');
    A.act({ type: 'open', x: 2, y: 6 });
    (${AUTO})(0.45);
    A.advance(120000);
  }`);

  await browser.close();
  server.close();
  console.log('screenshots written');
})().catch((e) => { console.error(e); process.exit(1); });
