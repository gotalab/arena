/* Renders just the end-of-run ceremony, fast-forwarding the clock through
 * advance() instead of through rendered frames. Run: node tools/shot-end.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const CANVAS = require('/tmp/delve-render/node_modules/@napi-rs/canvas');
const { createCanvas, GlobalFonts } = CANVAS;
try {
  const f = '/tmp/delve-render/node_modules/dejavu-fonts-ttf/ttf/';
  GlobalFonts.registerFromPath(f + 'DejaVuSans-Bold.ttf', 'Trebuchet MS');
} catch (e) { /* layout check only */ }

const OUT = '/tmp/delve-shots';
fs.mkdirSync(OUT, { recursive: true });

function makeEl(w, h) {
  const c = createCanvas(w, h);
  c.style = {}; c.clientWidth = w; c.clientHeight = h;
  c.addEventListener = function (t, f) { (this._h || (this._h = {}))[t] = ((this._h && this._h[t]) || []).concat(f); };
  c.removeEventListener = () => {};
  c.setPointerCapture = () => {}; c.releasePointerCapture = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.clientWidth, height: c.clientHeight });
  c.fire = function (t, ev) { ((this._h && this._h[t]) || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); };
  return c;
}
const stage = makeEl(390, 844);
const dh = {};
global.window = global;
global.document = {
  readyState: 'complete',
  getElementById: id => (id === 'stage' ? stage : {}),
  createElement: t => (t === 'canvas' ? makeEl(64, 64) : {}),
  addEventListener(t, f) { (dh[t] || (dh[t] = [])).push(f); },
  removeEventListener() {},
  fire(t, ev) { (dh[t] || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); }
};
global.getComputedStyle = () => ({ paddingTop: '0px', paddingBottom: '0px' });
global.devicePixelRatio = 2;
global.innerWidth = 390; global.innerHeight = 844;
global.matchMedia = () => ({ matches: false });
global.location = { search: '', hash: '' };
const wh = {};
global.addEventListener = (t, f) => { (wh[t] || (wh[t] = [])).push(f); };
global.removeEventListener = () => {};
let raf = [];
global.requestAnimationFrame = fn => { raf.push(fn); return raf.length; };
global.AudioContext = undefined;

for (const f of ['sim', 'art', 'fx', 'render', 'audio', 'input', 'main']) {
  require(path.join(__dirname, '..', 'src', f + '.js'));
}
const A = global.__ARENA_GAME__;
let t = 0;
const pump = (n) => { for (let i = 0; i < n; i++) { const q = raf; raf = []; t += 16.67; q.forEach(f => f(t)); } };
const key = (k, d = true) => global.document.fire(d ? 'keydown' : 'keyup', { key: k, code: k, repeat: false });
const save = (n) => { fs.writeFileSync(path.join(OUT, n + '.png'), stage.toBuffer('image/png')); console.log('  ' + n + '.png'); };
function resize(w, h) {
  stage.width = w; stage.height = h; stage.clientWidth = w; stage.clientHeight = h;
  global.innerWidth = w; global.innerHeight = h;
  (wh.resize || []).forEach(f => f());
}

// Fast-forward through advance() with a crude greedy driver so the ceremony
// has a real run behind it, then render only the frames we want to look at.
function fastRun() {
  key('ArrowDown');
  for (let i = 0; i < 4000 && A.snapshot().phase !== 'gameover'; i++) {
    const s = A.snapshot();
    let target = s.courseCenterX, best = null, bs = -1e9;
    for (const it of s.items) {
      if (!it.active || it.position.depth < s.depth + 6) continue;
      const dz = it.position.depth - s.depth;
      const sc = (it.type === 'power' ? 500 : 130) - dz * 0.4 - Math.abs(it.position.x - s.x) * 1.1;
      if (sc > bs) { bs = sc; best = it; }
    }
    if (best) target = best.position.x;
    for (const r of s.rocks) {
      if (!r.active || r.position.depth < s.depth - 5 || r.position.depth > s.depth + 90) continue;
      const clear = r.collisionRadius + s.playerRadius + 6;
      if (Math.abs(target - r.position.x) < clear) {
        target = r.position.x > s.courseCenterX ? r.position.x - clear : r.position.x + clear;
      }
    }
    const err = target - s.x;
    if (err > 3) { key('ArrowRight'); key('ArrowLeft', false); }
    else if (err < -3) { key('ArrowLeft'); key('ArrowRight', false); }
    else { key('ArrowLeft', false); key('ArrowRight', false); }
    A.advance(16.67 * 3);
  }
}

pump(4);
fastRun();
console.log('run ended: ' + JSON.stringify({
  score: A.snapshot().score, rank: A.snapshot().rank, depth: A.snapshot().depth
}));
pump(26);
save('20-over-early');
pump(40);
save('21-over-settled');

resize(1280, 720);
pump(8);
save('22-over-desktop');

resize(320, 520);
pump(8);
save('23-over-small');

// a second, weaker run so the lower grades and a different signature show
resize(390, 844);
A.reset(777);
key('ArrowDown', false); key('ArrowLeft', false); key('ArrowRight', false);
pump(4);
key('ArrowDown');
A.advance(2500);
key('ArrowDown', false);
A.advance(40000);
pump(40);
save('24-over-weak-run');
console.log('weak run: ' + JSON.stringify({ score: A.snapshot().score, rank: A.snapshot().rank }));
