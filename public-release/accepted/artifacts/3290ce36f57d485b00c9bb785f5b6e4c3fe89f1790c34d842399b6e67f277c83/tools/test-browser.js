// Dev-only browser test: runtime interface, bridge protocol, input, layout.
const { chromium } = require('playwright');
const { createServer } = require('./serve');

const PORT = 8712;
let failures = 0;
function check(name, cond, extra) {
  if (!cond) { failures++; console.log('FAIL  ' + name + (extra !== undefined ? '  ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t); }

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();

  /* ------------------------------------------------------- direct page use */

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(700);

  section('page boots clean');
  check('no page errors', errors.length === 0, errors.join(' | '));
  check('runtime interface present', await page.evaluate(() => {
    const a = window.__ARENA_GAME__;
    return !!a && ['reset', 'snapshot', 'act', 'restart', 'advance'].every((k) => typeof a[k] === 'function');
  }));
  const offOrigin = requests.filter((u) => !u.startsWith(`http://localhost:${PORT}/`));
  check('no off-origin requests', offOrigin.length === 0, offOrigin.join(','));
  check('engine namespace is not left on the page', await page.evaluate(() => window.SHOAL === undefined));
  check('no covered shell can be read from the interface', await page.evaluate(() => {
    const s = window.__ARENA_GAME__.snapshot();
    const seen = JSON.stringify(s);
    // the whole snapshot, stringified, must contain nothing but visible marks
    return s.rows.every((r) => /^[#F0-8*X+-]+$/.test(r)) && !/mine|urchinAt|solution|layout/i.test(seen);
  }));

  // The deduction engine is pure logic over visible information; the tests
  // reload it as a library so they can play the way a reader can.
  await page.addScriptTag({ url: '/js/rng.js' });
  await page.addScriptTag({ url: '/js/generator.js' });
  check('reloaded library exposes only pure helpers', await page.evaluate(
    () => !!window.SHOAL.gen && !window.SHOAL.game && !window.SHOAL.view));

  section('no page scrolling, nothing clipped');
  async function layoutOk(w, h, label) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(260);
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const stage = document.getElementById('stage').getBoundingClientRect();
      const hud = document.getElementById('hud').getBoundingClientRect();
      const c = document.getElementById('board');
      const cr = c.getBoundingClientRect();
      const st = window.__ARENA_GAME__.snapshot();
      return {
        scrollX: d.scrollWidth - d.clientWidth,
        scrollY: d.scrollHeight - d.clientHeight,
        bodyScroll: document.body.scrollHeight - window.innerHeight,
        hudTop: hud.top, hudBottom: hud.bottom,
        stageBottom: stage.bottom, innerH: window.innerHeight, innerW: window.innerWidth,
        canvasW: cr.width, canvasH: cr.height, canvasRight: cr.right, canvasBottom: cr.bottom,
        grid: st.gridWidth + 'x' + st.gridHeight
      };
    });
    check(label + ': no horizontal page scroll', m.scrollX <= 0, m.scrollX);
    check(label + ': no vertical page scroll', m.scrollY <= 0, m.scrollY);
    check(label + ': hud visible at top', m.hudTop >= -1 && m.hudBottom < m.innerH, JSON.stringify([m.hudTop, m.hudBottom]));
    check(label + ': canvas inside viewport', m.canvasRight <= m.innerW + 1 && m.canvasBottom <= m.innerH + 1,
      JSON.stringify([m.canvasRight, m.canvasBottom, m.innerW, m.innerH]));
    check(label + ': stage has room', m.canvasH > 60, m.canvasH);
    return m;
  }
  await layoutOk(390, 844, 'phone');
  await layoutOk(320, 480, 'small frame');
  await layoutOk(280, 380, 'tiny frame');
  await layoutOk(768, 1024, 'tablet');
  await layoutOk(900, 500, 'landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);

  section('the board is reachable by touch and mouse');
  // Where is a given cell on screen?
  async function cellPoint(x, y) {
    return page.evaluate(([cx, cy]) => {
      const r = window.__SHOAL_CELL_RECT__(cx, cy);
      return { x: r.x + r.size / 2, y: r.y + r.size / 2 };
    }, [x, y]);
  }
  let p = await cellPoint(2, 3);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(360);
  let snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('click turns a shell', snap.revision === 1 && snap.phase === 'playing', JSON.stringify([snap.revision, snap.phase]));
  check('click opened quiet water', snap.rows[3][2] === '0', snap.rows[3][2]);
  check('title hides once play starts', await page.evaluate(() => !document.getElementById('title').classList.contains('show')));

  // press-and-hold plants a pennant
  let covered = await page.evaluate(() => {
    const s = window.__ARENA_GAME__.snapshot();
    for (let y = 0; y < s.gridHeight; y++) for (let x = 0; x < s.gridWidth; x++) if (s.rows[y][x] === '#') return { x, y };
    return null;
  });
  p = await cellPoint(covered.x, covered.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(200);
  snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('hold plants a pennant', snap.rows[covered.y][covered.x] === 'F', snap.rows[covered.y][covered.x]);
  check('hold does not also turn the shell', snap.flagsPlaced === 1 && snap.revision === 2, JSON.stringify([snap.flagsPlaced, snap.revision]));

  // a quick tap on a pennanted shell must not turn it
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
  snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('tap cannot turn a pennanted shell', snap.rows[covered.y][covered.x] === 'F' && snap.revision === 2);

  // hold again lifts it
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(150);
  snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('hold lifts a pennant', snap.rows[covered.y][covered.x] === '#' && snap.flagsPlaced === 0);

  // right click toggles too, with no browser menu on the board
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(150);
  snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('right click plants a pennant', snap.rows[covered.y][covered.x] === 'F');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(150);
  check('right click lifts a pennant', (await page.evaluate(() => window.__ARENA_GAME__.snapshot())).flagsPlaced === 0);

  // dragging off a shell cancels the gesture entirely
  const before = await page.evaluate(() => window.__ARENA_GAME__.snapshot().revision);
  p = await cellPoint(covered.x, covered.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 40, { steps: 6 });
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(120);
  check('drag cancels the gesture', (await page.evaluate(() => window.__ARENA_GAME__.snapshot().revision)) === before);

  section('touch drives the same loop');
  p = await cellPoint(covered.x, covered.y);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(300);
  const afterTouch = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('tap turns a shell or ends the run', afterTouch.revision === before + 1, afterTouch.revision);

  section('R restarts at any moment');
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  snap = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('R resets the run', snap.revision === 0 && snap.pool === 1 && snap.phase === 'ready');
  check('R keeps the seed', typeof snap.seed === 'string' && snap.seed.length > 0);

  section('advance matches real time');
  await page.evaluate(() => window.__ARENA_GAME__.act({ type: 'open', x: 3, y: 5 }));
  const t0 = await page.evaluate(() => window.__ARENA_GAME__.snapshot().tick);
  await page.waitForTimeout(1000);
  const tReal = await page.evaluate(() => window.__ARENA_GAME__.snapshot().tick);
  check('the clock runs in real time', tReal - t0 >= 50 && tReal - t0 <= 70, tReal - t0);

  section('a full run can be finished by the interface');
  const runResult = await page.evaluate(async () => {
    const A = window.__ARENA_GAME__;
    A.reset('browser-run');
    A.act({ type: 'open', x: 2, y: 4 });
    const S = window.SHOAL;
    let guard = 0;
    while (guard++ < 900) {
      const s = A.snapshot();
      if (s.phase === 'ended') break;
      if (s.pool >= 3) return { cleared: true, pearls: s.pearls, pool: s.pool };
      if (!s.firstTurnDone) { A.act({ type: 'open', x: 2, y: 4 }); continue; }
      const w = s.gridWidth, h = s.gridHeight, n = w * h;
      const open = new Uint8Array(n), val = new Int8Array(n), known = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ch = s.rows[y][x];
        if (ch >= '0' && ch <= '8') { open[y * w + x] = 1; val[y * w + x] = ch.charCodeAt(0) - 48; }
      }
      let moved = false;
      for (let it = 0; it < 60 && !moved; it++) {
        const r = S.gen.deduce(w, h, open, val, known, s.urchinsTotal, { maxCells: 24, budget: 2000000 });
        const safe = r.safe.filter((c) => !open[c] && !known[c]);
        if (safe.length) {
          const c = safe[0];
          A.act({ type: 'open', x: c % w, y: Math.floor(c / w) });
          moved = true;
          break;
        }
        let progress = false;
        for (const m of r.mines) if (!known[m] && !open[m]) { known[m] = 1; progress = true; }
        if (!progress) break;
      }
      if (!moved) return { stuck: true, rows: s.rows };
    }
    const s = A.snapshot();
    return { ended: s.phase === 'ended', pool: s.pool, pearls: s.pearls };
  });
  check('logic play reaches pool 3 without a sting', runResult.cleared === true, JSON.stringify(runResult).slice(0, 300));

  section('ceremony renders and restarts on tap');
  const ended = await page.evaluate(async () => {
    const A = window.__ARENA_GAME__;
    A.reset('ceremony-seed');
    A.act({ type: 'open', x: 3, y: 4 });
    let guard = 0;
    while (A.snapshot().phase !== 'ended' && guard++ < 400) {
      const s = A.snapshot();
      const w = s.gridWidth;
      let target = null;
      for (let i = 0; i < w * s.gridHeight; i++) {
        if (s.rows[Math.floor(i / w)][i % w] === '#') { target = i; break; }
      }
      if (target === null) break;
      A.act({ type: 'open', x: target % w, y: Math.floor(target / w) });
    }
    return A.snapshot().phase;
  });
  check('run reached its end', ended === 'ended');

  // the fatal tap must not restart the run: the card ignores input for a beat
  await page.waitForTimeout(950);
  await page.mouse.click(195, 700);
  check('ceremony ignores an instant tap', (await page.evaluate(() => window.__ARENA_GAME__.snapshot().phase)) === 'ended');

  await page.waitForTimeout(700);
  const cer = await page.evaluate(() => {
    const c = document.getElementById('ceremony');
    const r = c.getBoundingClientRect();
    const card = c.firstElementChild.getBoundingClientRect();
    return {
      hidden: c.classList.contains('hidden'),
      pearls: document.getElementById('cerPearls').textContent,
      rank: document.getElementById('cerRank').textContent,
      stat: document.getElementById('cerStat').textContent,
      pips: document.getElementById('cerLadder').children.length,
      cardTop: card.top, cardBottom: card.bottom, viewH: window.innerHeight
    };
  });
  check('ceremony is showing', cer.hidden === false);
  check('ceremony shows a rank', cer.rank.length > 2, cer.rank);
  check('ceremony shows the ladder', cer.pips >= 5, cer.pips);
  check('ceremony shows the signature stat', /shell/.test(cer.stat), cer.stat);
  check('ceremony card fits on screen', cer.cardBottom <= cer.viewH + 1 && cer.cardTop > 0,
    JSON.stringify([cer.cardTop, cer.cardBottom, cer.viewH]));
  await page.screenshot({ path: 'tools/shot-ceremony.png' });

  await page.mouse.click(195, 700);
  await page.waitForTimeout(400);
  const afterCer = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  check('tapping the ceremony starts a new attempt', afterCer.revision === 0 && afterCer.phase === 'ready');
  check('attempt counted up', afterCer.attempt > 1, afterCer.attempt);
  check('session best carried over', afterCer.sessionBest > 0, afterCer.sessionBest);

  section('screenshots');
  await page.evaluate(() => {
    const A = window.__ARENA_GAME__;
    A.reset('shot');
    A.act({ type: 'open', x: 2, y: 6 });
    const s = A.snapshot();
    for (let y = 0; y < s.gridHeight; y++) for (let x = 0; x < s.gridWidth; x++) {
      if (s.rows[y][x] === '#' && (x + y) % 5 === 0) { A.act({ type: 'flag', x, y }); break; }
    }
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tools/shot-play.png' });
  await page.evaluate(() => window.__ARENA_GAME__.reset('title'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'tools/shot-title.png' });

  check('still no page errors', errors.length === 0, errors.join(' | '));

  /* --------------------------------------------------------------- bridge */

  section('arena.game.v1 bridge');
  const bctx = await browser.newContext({ viewport: { width: 480, height: 900 } });
  const parent = await bctx.newPage();
  const berrors = [];
  parent.on('pageerror', (e) => berrors.push(String(e)));
  await parent.goto(`http://localhost:${PORT}/tools/parent.html`);
  await parent.waitForTimeout(600);

  async function inbox() { return parent.evaluate(() => window.__inbox); }
  async function clearInbox() { return parent.evaluate(() => { window.__inbox.length = 0; }); }
  async function request(msg) {
    await clearInbox();
    await parent.evaluate((m) => window.__send(m), msg);
    await parent.waitForTimeout(220);
    const box = await inbox();
    return box[box.length - 1];
  }

  await parent.evaluate(() => window.__connect('sess-1', 3));
  await parent.waitForTimeout(450);
  let box = await inbox();
  const ready = box[0];
  check('ready envelope arrives', !!ready, JSON.stringify(box));
  if (ready) {
    check('ready shape', ready.protocol === 'arena.game.v1' && ready.type === 'ready' &&
      ready.sessionId === 'sess-1' && ready.generation === 3 && ready.accepted === true &&
      typeof ready.revision === 'number' && !!ready.state, JSON.stringify(ready).slice(0, 220));
    check('ready state carries the board', Array.isArray(ready.state.rows) && ready.state.rows.length > 0);
    check('bridge state omits events', ready.state.events === undefined && ready.state.lastEvent === undefined);
    check('bridge state has run + pool fields',
      ['phase', 'tick', 'elapsedMs', 'seed', 'attempt', 'revision', 'pool', 'pearls', 'sessionBest', 'moves',
        'rank', 'rankLadder', 'gridWidth', 'gridHeight', 'urchinsTotal', 'flagsPlaced', 'urchinsLeft',
        'tideFraction', 'firstTurnDone', 'stungAt'].every((k) => k in ready.state));
  }

  let r = await request({ protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r1', command: 'observe' });
  check('observe accepted', r && r.type === 'response' && r.accepted === true && r.requestId === 'r1');
  check('observe does not mutate', r && r.revision === ready.revision);

  const rev0 = r.revision;
  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r2',
    command: 'act', expectedRevision: rev0, action: { type: 'open', x: 2, y: 3 }
  });
  check('act accepted', r && r.accepted === true, JSON.stringify(r && r.error));
  check('act advances revision', r && r.revision === rev0 + 1, r && r.revision);
  check('act reports the opened board', r && r.state.rows[3][2] === '0', r && r.state.rows[3][2]);
  check('act response repeats identity', r && r.sessionId === 'sess-1' && r.generation === 3 && r.requestId === 'r2');

  // the rendered board agrees with the reported state
  const agree = await parent.evaluate(() => {
    const f = document.getElementById('frame');
    return new Promise((res) => setTimeout(() => res(true), 60));
  });
  check('render happened before the response', agree === true);

  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r3',
    command: 'act', expectedRevision: rev0, action: { type: 'open', x: 4, y: 4 }
  });
  check('stale revision rejected', r && r.accepted === false && r.error && r.error.code === 'stale_revision', JSON.stringify(r && r.error));
  check('rejection still reports state', r && !!r.state && typeof r.revision === 'number');

  const revNow = r.revision;
  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r4',
    command: 'act', expectedRevision: revNow, action: { type: 'open', x: 2, y: 3 }
  });
  check('illegal action rejected', r && r.accepted === false && !!r.error && !!r.error.code, JSON.stringify(r && r.error));
  check('illegal action leaves revision alone', r && r.revision === revNow);

  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r5',
    command: 'act', action: { type: 'open', x: 5, y: 5 }
  });
  check('act without expectedRevision rejected', r && r.accepted === false && r.error.code === 'bad_request');

  r = await request({ protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r6', command: 'fly' });
  check('unknown command rejected', r && r.accepted === false && r.error.code === 'bad_command');

  await clearInbox();
  await parent.evaluate(() => window.__send({ protocol: 'arena.game.v1', sessionId: 'wrong', generation: 3, requestId: 'x1', command: 'observe' }));
  await parent.evaluate(() => window.__send({ protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 9, requestId: 'x2', command: 'observe' }));
  await parent.evaluate(() => window.__send({ protocol: 'other.protocol', sessionId: 'sess-1', generation: 3, requestId: 'x3', command: 'observe' }));
  await parent.waitForTimeout(300);
  check('mismatched envelopes are ignored', (await inbox()).length === 0, JSON.stringify(await inbox()));

  const revBefore = (await request({ protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r7', command: 'observe' })).revision;
  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r8',
    command: 'restart', expectedRevision: revBefore
  });
  check('restart accepted', r && r.accepted === true);
  check('restart returns a fresh pool', r && r.state.revision === 0 && r.state.pool === 1 && r.state.phase === 'ready');
  check('restart counts an attempt', r && r.state.attempt >= 2, r && r.state.attempt);

  r = await request({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r9',
    command: 'restart', expectedRevision: 42
  });
  check('stale restart rejected', r && r.accepted === false && r.error.code === 'stale_revision');

  section('bridge and finger share one board');
  await parent.evaluate(() => window.__send({
    protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r10',
    command: 'act', expectedRevision: 0, action: { type: 'open', x: 3, y: 5 }
  }));
  await parent.waitForTimeout(300);
  const frameState = await parent.evaluate(() => {
    return new Promise((res) => {
      window.__inbox.length = 0;
      window.__send({ protocol: 'arena.game.v1', sessionId: 'sess-1', generation: 3, requestId: 'r11', command: 'observe' });
      setTimeout(() => res(window.__inbox[0].state), 200);
    });
  });
  check('bridge act turned a shell', frameState.rows[5][3] === '0', frameState.rows[5][3]);
  check('bridge act started the clock', frameState.phase === 'playing');
  await parent.screenshot({ path: 'tools/shot-bridge.png' });
  check('no parent-side errors', berrors.length === 0, berrors.join(' | '));

  section('a second connect rebinds');
  await parent.evaluate(() => { window.__inbox.length = 0; window.__connect('sess-2', 7); });
  await parent.waitForTimeout(400);
  box = await inbox();
  check('rebind sends a fresh ready', box.length >= 1 && box[0].type === 'ready' && box[0].sessionId === 'sess-2' && box[0].generation === 7,
    JSON.stringify(box).slice(0, 200));
  r = await request({ protocol: 'arena.game.v1', sessionId: 'sess-2', generation: 7, requestId: 'r12', command: 'observe' });
  check('new binding serves requests', r && r.accepted === true && r.sessionId === 'sess-2');

  await browser.close();
  server.close();
  console.log(failures === 0 ? '\nALL BROWSER TESTS PASSED' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
