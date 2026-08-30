import { createGame } from './simulation.js';
import { Renderer } from './render.js';
import { AudioEngine } from './audio.js';
import { InputManager } from './input.js';
import { TICK_MS } from './constants.js';

const canvas = document.getElementById('game');
const container = document.getElementById('container');

const game = createGame();
const renderer = new Renderer(canvas);
const audio = new AudioEngine();

let accumulator = 0;
let lastFrame = 0;
let currentSeed = (Date.now() >>> 0) || 1;
let heldInput = { steer: 0, accelerate: false };

function resetGame(seed) {
  currentSeed = seed >>> 0 || 1;
  game.reset(currentSeed);
  renderer.resetVisual();
  accumulator = 0;
  heldInput = { steer: 0, accelerate: false };
  game.sim.setInput(heldInput);
}

function handleInput(input) {
  audio.unlock();
  heldInput = input;
  game.sim.setInput(input);
}

function handleRestart() {
  audio.unlock();
  resetGame(currentSeed);
}

const inputMgr = new InputManager(canvas, handleInput, handleRestart);

canvas.addEventListener('pointerdown', (e) => {
  const snap = game.snapshot();
  if (snap.phase === 'gameover') {
    resetGame(currentSeed);
    audio.unlock();
  }
});

function resize() {
  const rect = container.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  renderer.resize(w, h);
}

window.addEventListener('resize', resize);
resize();

function stepSimulation() {
  const snap = game.snapshot();
  if (snap.phase === 'playing') {
    game.sim.setInput(heldInput);
    game.advance(TICK_MS);
  }
}

function loop(now) {
  if (!lastFrame) lastFrame = now;
  const frameDt = Math.min(50, now - lastFrame);
  lastFrame = now;

  accumulator += frameDt;
  while (accumulator >= TICK_MS) {
    stepSimulation();
    accumulator -= TICK_MS;
  }

  const snap = game.snapshot();
  renderer.processEvents(snap, audio, game.sim);
  audio.update(game.sim, renderer.nearMissStreak);
  renderer.render(snap, now);

  const ctx = renderer.ctx;
  inputMgr.drawStick(ctx, snap.phase);

  requestAnimationFrame(loop);
}

resetGame(currentSeed);
requestAnimationFrame(loop);

window.__ARENA_GAME__ = {
  reset(seed) {
    resetGame(seed);
  },
  snapshot() {
    return game.snapshot();
  },
  advance(ms) {
    game.advance(ms);
  },
};
