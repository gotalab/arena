const { chromium } = require('playwright');
const BOT = require('./bot.js');
const fs = require('fs');
const URL = 'http://localhost:8099/index.html';
const OUT = '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!c) process.exitCode = 1; }

const VIEWPORTS = [
  ['phone-390x844', 390, 844],
  ['phone-small-320x568', 320, 568],
  ['phone-tall-412x915', 412, 915],
  ['frame-320x480', 320, 480],
  ['frame-short-480x320', 480, 320],
  ['tablet-768x1024', 768, 1024],
  ['desktop-1280x800', 1280, 800],
  ['wide-1600x600', 1600, 600]
];

(async () => {
  const b = await chromium.launch();

  // layout integrity across viewports
  for (const [name, w, h] of VIEWPORTS) {
    const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const de = document.documentElement;
      const c = document.getElementById('stage');
      const r = c.getBoundingClientRect();
      const L = window.__LAYOUT_PROBE__ && window.__LAYOUT_PROBE__();
      return {
        scrollX: de.scrollWidth - de.clientWidth,
        scrollY: de.scrollHeight - de.clientHeight,
        canvas: { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) },
        vw: window.innerWidth, vh: window.innerHeight,
        L
      };
    });
    ok(info.scrollX <= 0 && info.scrollY <= 0, `${name}: no page scrolling`, { sx: info.scrollX, sy: info.scrollY });
    ok(info.canvas.w === info.vw && info.canvas.h === info.vh, `${name}: canvas fills viewport`, info.canvas);
    ok(errs.length === 0, `${name}: no errors`, errs.slice(0, 2));
    await page.screenshot({ path: `${OUT}/ready-${name}.png` });
    await page.close();
  }

  // gameplay screenshots
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: BOT });

  async function shot(name, prep) {
    await page.evaluate(prep);
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  // first press: the ball launches
  await shot('01-first-press', () => {
    const G = window.__ARENA_GAME__;
    window.__T.releaseAll(); window.__T.lock = -1;
    G.reset(42); window.__T.jump(); G.advance(500);
  });

  // low lane target on screen, ball descending
  await shot('02-low-lane-approach', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 6; i++) { const s = G.snapshot(); if (s.phase !== 'run') break; window.__T.act(s); G.advance(1000 / 60); }
  });

  // hunt until an enemy is damaged
  await shot('03-damaged-target', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 200; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      if (s.enemies.some(e => e.active && e.hitsTaken === 1)) break;
      window.__T.act(s); G.advance(1000 / 60);
    }
  });
  await shot('04-critical-target', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 300; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      if (s.enemies.some(e => e.active && e.hitsTaken === 2)) break;
      window.__T.act(s); G.advance(1000 / 60);
    }
  });
  await shot('05-burst', () => {
    const G = window.__ARENA_GAME__;
    const start = G.snapshot().airEnemiesDefeated;
    for (let i = 0; i < 60 * 300; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      if (s.airEnemiesDefeated > start) break;
      window.__T.act(s); G.advance(1000 / 60);
    }
  });
  await shot('06-mid-run', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 60; i++) { const s = G.snapshot(); if (s.phase !== 'run') break; window.__T.act(s); G.advance(1000 / 60); }
  });
  await shot('07-low-clock', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 400; i++) { const s = G.snapshot(); if (s.phase !== 'run' || s.remainingMs < 5000) break; window.__T.act(s); G.advance(1000 / 60); }
  });
  await shot('08-game-over', () => {
    const G = window.__ARENA_GAME__;
    for (let i = 0; i < 60 * 400; i++) { const s = G.snapshot(); if (s.phase !== 'run') break; window.__T.act(s); G.advance(1000 / 60); }
  });

  // walker + jump
  await shot('09-walker', () => {
    const G = window.__ARENA_GAME__;
    window.__T.releaseAll(); window.__T.lock = -1;
    G.reset(9); window.__T.jump();
    for (let i = 0; i < 60 * 400; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      if (s.enemies.some(e => e.active && e.lane === 'ground' && e.x > 60 && e.x < 300)) break;
      window.__T.act(s); G.advance(1000 / 60);
    }
  });

  // fast flyer (needs a kill first)
  await shot('10-fast-flyer', () => {
    const G = window.__ARENA_GAME__;
    window.__T.releaseAll(); window.__T.lock = -1;
    G.reset(31337); window.__T.jump();
    for (let i = 0; i < 60 * 400; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      if (s.enemies.some(e => e.active && e.type === 'fastFlyer' && e.x > 40 && e.x < 320)) break;
      window.__T.act(s); G.advance(1000 / 60);
    }
  });

  // pointer control surfaces
  await page.evaluate(() => { const G = window.__ARENA_GAME__; window.__T.releaseAll(); G.reset(3); });
  await page.waitForTimeout(150);
  const pads = await page.evaluate(() => window.__PADS__ ? window.__PADS__() : null);
  await page.mouse.move(80, 790);
  await page.mouse.down();
  await page.mouse.move(140, 790, { steps: 6 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/11-move-pad-active.png` });
  const moving = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  ok(moving.phase === 'run' && moving.input.moveAxis > 0.5 && moving.machine.x > 200,
    'mouse drag on the movement surface steers the machine',
    { phase: moving.phase, axis: moving.input.moveAxis, vx: Math.round(moving.machine.vx), x: Math.round(moving.machine.x), tick: moving.tick });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const released = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  ok(Math.abs(released.input.moveAxis) < 0.01, 'release returns to neutral', released.input);

  // jump surface with a single click
  const jumped = await page.evaluate(async () => {
    const before = window.__ARENA_GAME__.snapshot();
    return before.machine.jumpCount;
  });
  await page.mouse.click(340, 790);
  await page.waitForTimeout(90);
  const afterJump = await page.evaluate(() => window.__ARENA_GAME__.snapshot());
  ok(!afterJump.machine.grounded || afterJump.recentEvents.some(e => e.kind === 'machine_jump'),
    'click on the jump surface queues a grounded jump', { grounded: afterJump.machine.grounded, jumps: afterJump.recentEvents.filter(e => e.kind === 'machine_jump').length });
  await page.screenshot({ path: `${OUT}/12-jump-pad.png` });

  // simultaneous touch: move + jump
  const dual = await page.evaluate(async () => {
    const G = window.__ARENA_GAME__;
    G.reset(3);
    const c = document.getElementById('stage');
    const r = c.getBoundingClientRect();
    function pe(type, id, x, y) {
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
    }
    pe('pointerdown', 1, 70, r.height - 60);
    pe('pointermove', 1, 20, r.height - 60);
    pe('pointerdown', 2, r.width - 50, r.height - 60);
    await new Promise(res => setTimeout(res, 120));
    const s = G.snapshot();
    pe('pointerup', 1, 20, r.height - 60);
    pe('pointerup', 2, r.width - 50, r.height - 60);
    return { axis: s.input.moveAxis, jumped: s.recentEvents.some(e => e.kind === 'machine_jump'), phase: s.phase };
  });
  ok(dual.axis < -0.5 && dual.jumped, 'movement and jump touches work simultaneously', dual);

  await b.close();
  console.log('\nscreenshots in ' + OUT);
})();
