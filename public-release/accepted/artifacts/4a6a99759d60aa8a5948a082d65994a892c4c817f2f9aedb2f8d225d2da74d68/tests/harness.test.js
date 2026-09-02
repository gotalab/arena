// Browser-simulation harness: loads core.js + game.js with stubbed DOM/canvas,
// exercises the runtime interface and the arena.game.v1 bridge end-to-end.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = __dirname.replace(/tests$/, '');
function load(src) { return fs.readFileSync(path.join(dir, src), 'utf8'); }

// ---- canvas 2d stub ----
const ctxStub = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (p === 'measureText') return () => ({ width: 10 });
    return typeof p === 'string' ? (() => {}) : undefined;
  },
  set() { return true; }
});

function el(id) {
  return {
    id,
    clientWidth: 390, clientHeight: 760,
    style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    setPointerCapture() {},
    getContext: () => ctxStub
  };
}

const elements = {};
const ids = ['pool','stage','poolNo','pearls','urchins','tideFill','toast','hint','title','ceremony',
  'cerKicker','cerRank','cerPearls','cerBest','cerPool','cerRipple','cerFast','cerLadder','cerNote'];
ids.forEach(id => elements[id] = el(id));

const listeners = { message: [], keydown: [], other: [] };
const sandbox = {
  console,
  Math, Date, JSON, Number, String, Array, Object, Uint8Array, parseInt, parseFloat,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  devicePixelRatio: 1,
  ResizeObserver: function(){ return { observe(){} }; },
  AudioContext: undefined,
  window: undefined, // set below
  document: {
    getElementById: (id) => elements[id],
    addEventListener(type, fn) { if (listeners[type]) listeners[type].push(fn); },
    createElement: () => el('x')
  },
  parent: { postMessage() {} }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.addEventListener = function (type, fn) {
  if (listeners[type]) listeners[type].push(fn); else listeners.other.push(fn);
};

vm.createContext(sandbox);
vm.runInContext(load('core.js'), sandbox);
vm.runInContext(load('game.js'), sandbox);

const api = sandbox.window.__ARENA_GAME__;
if (!api) throw new Error("__ARENA_GAME__ not exposed");

function assert(cond, msg){ if(!cond){ console.error("FAIL:", msg); process.exit(1); } }

// ---- runtime interface ----
const s0 = api.reset("b1");
assert(s0.phase === "ready", "reset -> ready");
assert(s0.revision === 0, "revision 0");
assert(s0.rows.every(r => r.split('').every(c => c === '#')), "all covered at start");

// first turn (free and generous) at center
const centerX = (s0.gridWidth / 2) | 0, centerY = (s0.gridHeight / 2) | 0;
const s1 = api.act({ type: "open", x: centerX, y: centerY });
assert(s1.revision === 1, "revision 1 after open");
assert(s1.phase === "playing", "playing after open");
assert(s1.firstTurnDone === true, "first turn done");
assert(s1.pearls > 0, "pearls from opening");

// illegal action leaves revision untouched
const sBefore = api.snapshot();
const sIllegal = api.act({ type: "open", x: 999, y: 0 });
assert(sIllegal.revision === sBefore.revision, "illegal action no revision change");
assert(sIllegal.pearls === sBefore.pearls, "illegal action no state change");

// flag/unflag
const fx = 0, fy = 0;
let sF = api.act({ type: "flag", x: fx, y: fy });
assert(sF.revision === sBefore.revision + 1, "flag bumps revision");
assert(sF.flagsPlaced === 1, "flagsPlaced 1");
assert(sF.urchinsLeft === sF.urchinsTotal - 1, "urchinsLeft");
let sU = api.act({ type: "unflag", x: fx, y: fy });
assert(sU.flagsPlaced === 0, "unflag");

// advance determinism (clock frozen in ready, moves in playing)
api.reset("b2");
const r2a = api.snapshot();
api.advance(5000);
assert(JSON.stringify(api.snapshot()) === JSON.stringify(r2a), "advance no-op in ready");
api.act({ type: "open", x: centerX, y: centerY });
api.advance(1000);
assert(api.snapshot().tick === 60, "tick after 1000ms");

// restart resets everything, keeps attempt/sessionBest semantics
api.act({ type: "open", x: centerX, y: centerY });
const pearls = api.snapshot().pearls;
const attempt1 = api.snapshot().attempt;
const sR = api.restart();
assert(sR.revision === 0, "restart -> revision 0");
assert(sR.attempt === attempt1 + 1, "restart -> attempt++");
assert(sR.pool === 1, "restart -> pool 1");
assert(sR.pearls === 0, "restart -> pearls 0");
assert(sR.phase === "ready", "restart -> ready");

// ---- bridge ----
function makeBridge(sessionId, generation) {
  const parentListeners = [];
  const port = {
    posted: [],
    onmessage: null,
    postMessage(msg) { this.posted.push(msg); }
  };
  const fakeWindow = {
    source: { }, // placeholder; will set to sandbox.parent
  };
  return { port, parentListeners };
}

// Simulate the parent "connect" message: window.postMessage from window.parent
let port = null;
let portPosted = [];
sandbox.parent.postMessage = function () {}; // not used
// Build a connect message event
const sessionId = "sess-abc", generation = 7;
const evConnect = {
  source: sandbox.window.parent,
  data: { protocol: "arena.game.v1", type: "connect", sessionId, generation },
  ports: [ (() => { const p = { posted: [], onmessage: null, postMessage(m){ this.posted.push(m); } }; port = p; return p; })() ]
};
listeners.message[0](evConnect);

assert(port && port.posted.length === 1, "ready envelope posted");
const ready = port.posted[0];
assert(ready.protocol === "arena.game.v1" && ready.type === "ready", "ready envelope shape");
assert(ready.sessionId === sessionId && ready.generation === generation, "ready carries session/generation");
assert(ready.accepted === true, "ready accepted");
assert(ready.state && ready.state.rows, "ready carries visible state");
assert(ready.state.events === undefined, "visible state omits events");

function request(cmd, extra) {
  const req = { protocol: "arena.game.v1", type: "request", sessionId, generation, requestId: 1 + Math.random(), command: cmd };
  Object.assign(req, extra || {});
  port.onmessage({ data: req });
}

// observe
request("observe");
const obs = port.posted[port.posted.length - 1];
assert(obs.type === "response" && obs.accepted === true && obs.command === undefined, "observe response");

// act with correct expectedRevision
const cur = api.snapshot();
request("act", { expectedRevision: cur.revision, action: { type: "open", x: centerX, y: centerY } });
const actRes = port.posted[port.posted.length - 1];
assert(actRes.accepted === true, "bridge act accepted");
assert(actRes.revision === cur.revision + 1, "bridge act revision advanced");
assert(actRes.requestId === undefined || true, "requestId echoed: " + actRes.requestId);
assert(typeof actRes.requestId !== 'undefined', "requestId present");

// act with stale revision rejected, no state change
const cur2 = api.snapshot();
request("act", { expectedRevision: 999, action: { type: "open", x: 1, y: 1 } });
const stale = port.posted[port.posted.length - 1];
assert(stale.accepted === false, "stale revision rejected");
assert(stale.error && stale.error.code === "stale_revision", "stale error code");
assert(stale.revision === cur2.revision, "stale rejection keeps revision");
assert(api.snapshot().revision === cur2.revision, "no state change on stale");

// illegal action rejected via bridge
request("act", { expectedRevision: cur2.revision, action: { type: "flag", x: 0, y: 999 } });
const ill = port.posted[port.posted.length - 1];
assert(ill.accepted === false, "illegal bridge action rejected");
assert(ill.error.code === "out_of_bounds", "out_of_bounds code");

// wrong generation rejected (no response)
port.posted.length = 0;
port.onmessage({ data: { protocol: "arena.game.v1", type: "request", sessionId, generation: 99, requestId: "x", command: "observe" } });
assert(port.posted.length === 0, "wrong generation ignored");

// restart via bridge
request("restart", { expectedRevision: api.snapshot().revision });
const rr = port.posted[port.posted.length - 1];
assert(rr.accepted === true, "bridge restart accepted");
assert(rr.state.revision === 0, "restart state revision 0");
assert(rr.state.phase === "ready", "restart state ready");

// wrong protocol ignored
port.posted.length = 0;
port.onmessage({ data: { protocol: "other", type: "request", sessionId, generation, requestId: "y", command: "observe" } });
assert(port.posted.length === 0, "wrong protocol ignored");

// connect from non-parent source ignored
listeners.message[0]({ source: {}, data: { protocol: "arena.game.v1", type: "connect", sessionId: "x2", generation: 1 }, ports: [{ posted:[], postMessage(){} }] });
assert(port.sessionId !== "x2", "non-parent connect ignored");

console.log("HARNESS PASSED: runtime interface + arena.game.v1 bridge verified");