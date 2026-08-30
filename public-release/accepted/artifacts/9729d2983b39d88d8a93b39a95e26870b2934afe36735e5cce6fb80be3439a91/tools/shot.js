/* Renders real frames of the shipped build to PNG so the look can be checked
 * outside a browser. Needs node-canvas:  npm --prefix /tmp/delve-render i canvas
 * Run: node tools/shot.js [outdir]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const CANVAS = require(process.env.CANVAS_PATH || '/tmp/delve-render/node_modules/@napi-rs/canvas');
const { createCanvas, GlobalFonts } = CANVAS;
// the container has no system fonts; register one so text layout can be judged
try {
  const fdir = '/tmp/delve-render/node_modules/dejavu-fonts-ttf/ttf/';
  GlobalFonts.registerFromPath(fdir + 'DejaVuSans-Bold.ttf', 'Trebuchet MS');
  GlobalFonts.registerFromPath(fdir + 'DejaVuSans.ttf', 'DejaVu Sans');
} catch (e) { console.log('no fonts: ' + e.message); }

const OUT = process.argv[2] || '/tmp/delve-shots';
fs.mkdirSync(OUT, { recursive: true });

let W = 390, H = 844;

function makeEl(w, h) {
  const c = createCanvas(w, h);
  c.style = {};
  c.clientWidth = w;
  c.clientHeight = h;
  c.addEventListener = function (t, f) { (this._h || (this._h = {}))[t] = ((this._h && this._h[t]) || []).concat(f); };
  c.removeEventListener = function () {};
  c.setPointerCapture = function () {};
  c.releasePointerCapture = function () {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.clientWidth, height: c.clientHeight });
  c.fire = function (t, ev) { ((this._h && this._h[t]) || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); };
  return c;
}

const stage = makeEl(W, H);
const docHandlers = {};
global.window = global;
global.document = {
  readyState: 'complete',
  getElementById: id => (id === 'stage' ? stage : {}),
  createElement: tag => (tag === 'canvas' ? makeEl(64, 64) : {}),
  addEventListener(t, f) { (docHandlers[t] || (docHandlers[t] = [])).push(f); },
  removeEventListener() {},
  fire(t, ev) { (docHandlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); }
};
global.getComputedStyle = () => ({ paddingTop: '0px', paddingBottom: '0px' });
global.devicePixelRatio = 2;
global.innerWidth = W; global.innerHeight = H;
global.matchMedia = () => ({ matches: false });
global.location = { search: '', hash: '' };
const winHandlers = {};
global.addEventListener = (t, f) => { (winHandlers[t] || (winHandlers[t] = [])).push(f); };
global.removeEventListener = () => {};
let raf = [];
global.requestAnimationFrame = fn => { raf.push(fn); return raf.length; };
global.AudioContext = undefined; // silence: audio is optional by design

for (const f of ['sim', 'art', 'fx', 'render', 'audio', 'input', 'main']) {
  require(path.join(__dirname, '..', 'src', f + '.js'));
}
const A = global.__ARENA_GAME__;
const G = global.DELVE;

let t = 0;
function pump(n, ms = 16.67) {
  for (let i = 0; i < n; i++) { const q = raf; raf = []; t += ms; q.forEach(f => f(t)); }
}
function resize(w, h) {
  W = w; H = h;
  stage.width = w; stage.height = h;
  stage.clientWidth = w; stage.clientHeight = h;
  global.innerWidth = w; global.innerHeight = h;
  (winHandlers.resize || []).forEach(f => f());
}
function save(name) {
  fs.writeFileSync(path.join(OUT, name + '.png'), stage.toBuffer('image/png'));
  console.log('  ' + name + '.png  ' + stage.width + '\u00d7' + stage.height);
}
const key = (k, down = true) => global.document.fire(down ? 'keydown' : 'keyup', { key: k, code: k, repeat: false });

// ---------------------------------------------------------------- shots ---
console.log('rendering to ' + OUT);

pump(50);
save('01-ready');

key('ArrowDown');
pump(150);
save('02-digging');

function autopilot(frames, opts = {}) {
  let s = A.snapshot();
  for (let i = 0; i < frames; i++) {
    if (i % 3 === 0) s = A.snapshot();
    let target = s.courseCenterX;
    let best = null, bs = -1e9;
    for (const it of s.items) {
      if (!it.active || it.position.depth < s.depth + 6) continue;
      const dz = it.position.depth - s.depth;
      const sc = (it.type === 'power' ? 500 : 120) - dz * 0.4 - Math.abs(it.position.x - s.x) * 1.2;
      if (sc > bs) { bs = sc; best = it; }
    }
    if (best && opts.greedy !== false) target = best.position.x;
    for (const r of s.rocks) {
      if (!r.active || r.position.depth < s.depth - 5) continue;
      if (r.position.depth > s.depth + 90) continue;
      const clear = r.collisionRadius + s.playerRadius + 6;
      if (Math.abs(target - r.position.x) < clear) {
        target = (r.position.x > s.courseCenterX) ? r.position.x - clear : r.position.x + clear;
      }
    }
    const err = target - s.x;
    if (err > 3) { key('ArrowRight'); key('ArrowLeft', false); }
    else if (err < -3) { key('ArrowLeft'); key('ArrowRight', false); }
    else { key('ArrowLeft', false); key('ArrowRight', false); }
    pump(1);
    if (opts.stopOn && i % 3 === 0 && opts.stopOn(s)) return true;
  }
  return false;
}

autopilot(150, { stopOn: s => s.speed > G.C.MAX_SPEED * 0.93 });
save('03-fullthrottle');

autopilot(240, { stopOn: s => s.items.some(i => i.type === 'power' && i.active && i.position.depth - s.depth < 60) });
save('04-power-approach');

autopilot(400, { stopOn: s => s.invincibleUntilMs > s.timeMs });
pump(10);
save('05-powered');

// stop hunting: let the clock do what the clock does. Burn it through
// advance() rather than rendered frames, which keeps this script cheap.
for (let i = 0; i < 900; i++) {
  const s = A.snapshot();
  if (s.phase !== 'playing' || s.remainingMs < 3400) break;
  A.advance(50);
}
pump(3);
save('06-timer-critical');

key('ArrowDown', false);
for (let i = 0; i < 400; i++) {
  if (A.snapshot().phase !== 'playing') break;
  A.advance(50);
}
pump(30);
save('07-gameover');

pump(70);
save('08-gameover-settled');

// other frame shapes
key('ArrowLeft', false); key('ArrowRight', false);
A.reset(20260826);
resize(1280, 720);
pump(30);
save('10-desktop-ready');
key('ArrowDown');
autopilot(360);
save('11-desktop-play');

resize(320, 560);
pump(4);
autopilot(120);
save('12-small-phone');

resize(430, 932);
pump(4);
autopilot(200);
save('13-large-phone');

console.log('done');
