import { StompSim, createGameApi, TICK_MS } from './sim.js';
import { Renderer, syncEffects } from './render.js';
import { AudioEngine } from './audio.js';

const canvas = document.getElementById('game-canvas');
const movePad = document.getElementById('move-pad');
const jumpPad = document.getElementById('jump-pad');
const moveHint = document.getElementById('move-hint');
const jumpHint = document.getElementById('jump-hint');
const moveIndicator = document.getElementById('move-indicator');

const sim = new StompSim();
const renderer = new Renderer(canvas);
const audio = new AudioEngine();

window.__ARENA_GAME__ = createGameApi(sim);

const input = { left: false, right: false, jumpQueued: false };
let prevEventSeq = 0;
let accumulator = 0;
let lastFrame = performance.now();
let currentSeed = Date.now();

function applyInput() {
  sim.setInput({ ...input });
}

function resetGame(seed) {
  currentSeed = seed ?? Date.now();
  sim.reset(currentSeed);
  input.left = false;
  input.right = false;
  input.jumpQueued = false;
  applyInput();
  prevEventSeq = 0;
  moveHint.classList.remove('hidden');
  jumpHint.classList.remove('hidden');
}

resetGame(currentSeed);

function updateMoveFromPointer(clientX, originX, threshold = 14) {
  const dx = clientX - originX;
  input.left = dx < -threshold;
  input.right = dx > threshold;
  if (input.left || input.right) {
    moveHint.classList.add('hidden');
    audio.resume();
  }
  applyInput();
}

let moveOriginX = 0;
let moveActive = false;

function onMoveStart(e) {
  e.preventDefault();
  const pt = e.touches ? e.touches[0] : e;
  moveOriginX = pt.clientX;
  moveActive = true;
  moveIndicator.classList.add('visible');
  moveIndicator.style.left = `${pt.clientX - movePad.getBoundingClientRect().left}px`;
  moveIndicator.style.top = `${pt.clientY - movePad.getBoundingClientRect().top}px`;
  updateMoveFromPointer(pt.clientX, moveOriginX, 8);
}

function onMoveMove(e) {
  if (!moveActive) return;
  e.preventDefault();
  const pt = e.touches ? e.touches[0] : e;
  moveIndicator.style.left = `${pt.clientX - movePad.getBoundingClientRect().left}px`;
  moveIndicator.style.top = `${pt.clientY - movePad.getBoundingClientRect().top}px`;
  updateMoveFromPointer(pt.clientX, moveOriginX);
}

function onMoveEnd() {
  moveActive = false;
  input.left = false;
  input.right = false;
  moveIndicator.classList.remove('visible');
  applyInput();
}

movePad.addEventListener('mousedown', onMoveStart);
movePad.addEventListener('mousemove', onMoveMove);
window.addEventListener('mouseup', onMoveEnd);
movePad.addEventListener('touchstart', onMoveStart, { passive: false });
movePad.addEventListener('touchmove', onMoveMove, { passive: false });
movePad.addEventListener('touchend', onMoveEnd);
movePad.addEventListener('touchcancel', onMoveEnd);

function onJumpStart(e) {
  e.preventDefault();
  input.jumpQueued = true;
  jumpHint.classList.add('hidden');
  audio.resume();
  applyInput();
}

jumpPad.addEventListener('mousedown', onJumpStart);
jumpPad.addEventListener('touchstart', onJumpStart, { passive: false });

const keys = { ArrowLeft: 'left', ArrowRight: 'right' };

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    input.jumpQueued = true;
    jumpHint.classList.add('hidden');
    audio.resume();
    applyInput();
    return;
  }
  if (e.code === 'KeyR') {
    e.preventDefault();
    resetGame(currentSeed);
    return;
  }
  if (keys[e.code]) {
    e.preventDefault();
    input[keys[e.code]] = true;
    moveHint.classList.add('hidden');
    audio.resume();
    applyInput();
  }
});

window.addEventListener('keyup', (e) => {
  if (keys[e.code]) {
    e.preventDefault();
    input[keys[e.code]] = false;
    applyInput();
  }
});

canvas.addEventListener('click', () => audio.resume());

function handleRestartTap() {
  if (sim.phase === 'ended') {
    resetGame(currentSeed);
  }
}

jumpPad.addEventListener('mouseup', handleRestartTap);
jumpPad.addEventListener('touchend', handleRestartTap);

window.addEventListener('resize', () => renderer.resize());

function gameLoop(now) {
  const dt = Math.min(now - lastFrame, 100);
  lastFrame = now;

  if (sim.phase === 'playing' || sim.phase === 'ready') {
    accumulator += dt;
    while (accumulator >= TICK_MS) {
      applyInput();
      sim.step();
      accumulator -= TICK_MS;

      const snap = sim.snapshot();
      if (snap.lastEvent && snap.lastEvent.sequence !== prevEventSeq) {
        audio.onEvent(snap.lastEvent);
        syncEffects(renderer, sim, { _lastSeq: prevEventSeq });
        prevEventSeq = snap.lastEvent.sequence;
      }
    }
  }

  const state = sim.getPresentationState();
  renderer.draw(state);
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
