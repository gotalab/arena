/* Boots the whole build against a mocked DOM/canvas so every render, input,
 * audio and screen path is really executed. Run: node tools/headless.js
 */
'use strict';
const path = require('path');

const calls = { unknown: new Set() };

function ctxMock() {
  const grad = { addColorStop() {} };
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      calls.unknown.add(String(prop));
      target[prop] = function () {};
      return target[prop];
    },
    set(target, prop, v) { target[prop] = v; return true; }
  };
  const base = {
    canvas: null,
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, transform() {},
    setTransform() {}, resetTransform() {},
    clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, rect() {}, clip() {},
    fill() {}, stroke() {}, fillText() {}, strokeText() {}, setLineDash() {},
    drawImage() {}, createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => ({}), measureText: () => ({ width: 24 }),
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
    lineJoin: 'miter', font: '10px sans', textAlign: 'left', textBaseline: 'top'
  };
  return new Proxy(base, handler);
}

function canvasMock(w, h) {
  const el = {
    width: w, height: h, clientWidth: w, clientHeight: h,
    style: {},
    getContext: () => ctxMock(),
    addEventListener(type, fn) { (this._h[type] || (this._h[type] = [])).push(fn); },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }),
    _h: {},
    fire(type, ev) { (this._h[type] || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); }
  };
  return el;
}

const stage = canvasMock(390, 780);
const probe = { };

const docHandlers = {};
global.window = global;
global.document = {
  readyState: 'complete',
  getElementById: (id) => (id === 'stage' ? stage : id === 'safe-probe' ? probe : null),
  createElement: (tag) => (tag === 'canvas' ? canvasMock(64, 64) : {}),
  addEventListener(type, fn) { (docHandlers[type] || (docHandlers[type] = [])).push(fn); },
  removeEventListener() {},
  fire(type, ev) { (docHandlers[type] || []).forEach(f => f(Object.assign({ preventDefault() {} }, ev))); }
};
global.getComputedStyle = () => ({ paddingTop: '44px', paddingBottom: '34px' });
global.devicePixelRatio = 2;
global.innerWidth = 390;
global.innerHeight = 780;
global.matchMedia = () => ({ matches: false });
global.location = { search: '', hash: '' };
global.URLSearchParams = URLSearchParams;

const winHandlers = {};
global.addEventListener = (t, f) => { (winHandlers[t] || (winHandlers[t] = [])).push(f); };
global.removeEventListener = () => {};

let rafQueue = [];
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
global.setTimeout = ((orig) => (fn) => { try { fn(); } catch (e) { throw e; } return 0; })(setTimeout);

// A believable-enough WebAudio graph: every node records its wiring so the
// synth code runs for real instead of being skipped.
function param() { return { value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }; }
function node(extra) {
  return Object.assign({ connect() {}, disconnect() {}, start() {}, stop() {} }, extra);
}
global.AudioContext = function () {
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', destination: node({}),
    resume() {},
    createGain: () => node({ gain: param() }),
    createOscillator: () => node({ type: 'sine', frequency: param(), detune: param() }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(), Q: param() }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param() }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) })
  };
};

// ---------------------------------------------------------------- load ----
for (const f of ['sim', 'art', 'fx', 'render', 'audio', 'input', 'main']) {
  require(path.join(__dirname, '..', 'src', f + '.js'));
}

const A = global.__ARENA_GAME__;
if (!A) { console.error('FAIL: window.__ARENA_GAME__ was never installed'); process.exit(1); }

let t = 0;
function pump(frames, stepMs) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    t += stepMs === undefined ? 16.67 : stepMs;
    q.forEach(fn => fn(t));
  }
}

const problems = [];
function phase(label, fn) {
  try { fn(); process.stdout.write(`  ok   ${label}\n`); }
  catch (e) { problems.push(label + ': ' + e.message); process.stdout.write(` FAIL  ${label}\n         ${e.stack.split('\n').slice(0, 4).join('\n         ')}\n`); }
}

console.log('\n== headless boot ==');
phase('boots and renders the ready screen', () => pump(40));
phase('keyboard starts the run', () => {
  global.document.fire('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: false });
  pump(120);
  if (A.snapshot().phase !== 'playing') throw new Error('phase is ' + A.snapshot().phase);
});
phase('steering, grazing and colliding all render', () => {
  for (let i = 0; i < 26; i++) {
    global.document.fire('keydown', { key: i % 2 ? 'ArrowLeft' : 'ArrowRight', code: 'Arrow', repeat: false });
    pump(20);
    global.document.fire('keyup', { key: i % 2 ? 'ArrowLeft' : 'ArrowRight', code: 'Arrow' });
    pump(10);
  }
  const s = A.snapshot();
  if (s.wallContacts + s.hits === 0) throw new Error('expected the bot to hit something');
});
phase('powered state renders', () => {
  // drive until a power item is actually collected
  let guard = 0;
  while (A.snapshot().invincibleUntilMs < 0 && guard++ < 400) pump(10);
  if (A.snapshot().invincibleUntilMs < 0) throw new Error('never found a power item');
  pump(60);
});
phase('touch stick drives the machine', () => {
  global.document.fire('keyup', { key: 'ArrowDown', code: 'ArrowDown' });
  stage.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 180, clientY: 500 });
  stage.fire('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 230, clientY: 570 });
  pump(60);
  const s = A.snapshot();
  if (!s.input.accel || s.input.steer <= 0) throw new Error('stick did not register: ' + JSON.stringify(s.input));
  stage.fire('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 230, clientY: 495 });
  pump(6);
  const s2 = A.snapshot();
  if (s2.input.accel) throw new Error('easing up did not release the throttle');
  if (s2.input.steer <= 0) throw new Error('the axes are not independent');
  stage.fire('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 230, clientY: 495 });
  pump(6);
  if (A.snapshot().input.steer !== 0) throw new Error('release did not let go');
});
phase('run reaches game over and renders the ceremony', () => {
  let guard = 0;
  while (A.snapshot().phase !== 'gameover' && guard++ < 3000) pump(6);
  if (A.snapshot().phase !== 'gameover') throw new Error('never ended');
  pump(90);
  const s = A.snapshot();
  if (!s.rank) throw new Error('no rank awarded');
});
phase('a tap on the end screen starts the next run', () => {
  stage.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 190, clientY: 400 });
  stage.fire('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 190, clientY: 470 });
  pump(30);
  const s = A.snapshot();
  if (s.phase !== 'playing' || s.tick > 40) throw new Error('phase=' + s.phase + ' tick=' + s.tick);
  stage.fire('pointerup', { pointerId: 2, pointerType: 'touch', clientX: 190, clientY: 470 });
});
phase('R restarts mid-run with the same seed', () => {
  pump(60);
  const before = A.snapshot().seed;
  global.document.fire('keydown', { key: 'r', code: 'KeyR', repeat: false });
  pump(4);
  const s = A.snapshot();
  if (s.seed !== before) throw new Error('seed changed');
  if (s.tick > 6 || s.score !== 0 || s.depth > 5) throw new Error('state not reset: ' + JSON.stringify({ t: s.tick, sc: s.score, d: s.depth }));
});
phase('mute toggle renders both states', () => {
  stage.fire('pointerdown', { pointerId: 3, pointerType: 'mouse', clientX: 360, clientY: 730 });
  pump(10);
  stage.fire('pointerdown', { pointerId: 4, pointerType: 'mouse', clientX: 360, clientY: 730 });
  pump(10);
});

console.log('\n== resizing ==');
const sizes = [
  [320, 480, 'small phone'], [390, 844, 'tall phone'], [430, 932, 'large phone'],
  [844, 390, 'phone landscape'], [1280, 720, 'desktop frame'], [520, 300, 'short wide frame'],
  [280, 900, 'very narrow column'], [1000, 1400, 'big portrait']
];
for (const [w, h, label] of sizes) {
  phase(`renders at ${w}\u00d7${h} (${label})`, () => {
    stage.clientWidth = w; stage.clientHeight = h;
    global.innerWidth = w; global.innerHeight = h;
    (winHandlers.resize || []).forEach(f => f());
    global.document.fire('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: false });
    pump(50);
    const s = A.snapshot();
    // the guaranteed world box must survive every frame shape
    const u = Math.min(Math.min(w, h * 0.70) / global.DELVE.C.VIEW_W, h / global.DELVE.C.VIEW_H);
    const visW = Math.min(w, h * 0.70) / u, visH = h / u;
    if (visW < global.DELVE.C.VIEW_W - 0.01) throw new Error('view too narrow: ' + visW.toFixed(1));
    if (visH < global.DELVE.C.VIEW_H - 0.01) throw new Error('view too short: ' + visH.toFixed(1));
    // the preview horizon must stay on screen below the machine
    const ahead = (1 - global.DELVE.C.PLAYER_SCREEN_Y) * visH;
    if (ahead < global.DELVE.C.PREVIEW_DIST - 0.01) throw new Error('preview clipped: ' + ahead.toFixed(1));
    if (s.previewMs !== 1190.48) throw new Error('previewMs moved with the frame size: ' + s.previewMs);
  });
}

console.log('\n== snapshot is frame-size independent ==');
phase('resizing changes no snapshot value', () => {
  A.reset(4242);
  global.document.fire('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: false });
  A.advance(7000);
  const a = JSON.stringify(A.snapshot());
  stage.clientWidth = 1400; stage.clientHeight = 500;
  (winHandlers.resize || []).forEach(f => f());
  pump(1, 0);
  const b = JSON.stringify(A.snapshot());
  if (a !== b) throw new Error('snapshot moved when the frame did');
});

console.log('\n== interface ==');
phase('advance() is the only door and the phases gate it', () => {
  global.document.fire('keyup', { key: 'ArrowDown', code: 'ArrowDown' });
  A.reset(7);
  const before = JSON.stringify(A.snapshot());
  A.advance(5000);
  if (JSON.stringify(A.snapshot()) !== before) throw new Error('ready phase advanced');
  global.document.fire('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: false });
  A.advance(1000);
  if (A.snapshot().tick !== 60) throw new Error('tick=' + A.snapshot().tick);
});

if (calls.unknown.size) {
  console.log('\nnote: context members auto-stubbed: ' + [...calls.unknown].join(', '));
}
console.log(`\n${problems.length === 0 ? 'HEADLESS BOOT CLEAN' : problems.length + ' PROBLEM(S)'}\n`);
process.exit(problems.length ? 1 : 0);
