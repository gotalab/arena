import { createArenaGame, TICK_MS } from './game.js';
import { initBridge, exposeArenaGame } from './arena.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { unlockAudio, sfx } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas);
const gameApi = createArenaGame();

let audioEnabled = false;

function render(state) {
  renderer.setState(state);
  renderer.draw(state, 16);
}

function handleAction(action) {
  if (action.type === 'snapshot') {
    return gameApi.snapshot();
  }

  if (!audioEnabled) {
    unlockAudio();
    audioEnabled = true;
  }

  if (action.type === 'restart') {
    const state = gameApi.restart();
    render(state);
    sfx.ceremony();
    return state;
  }

  const g = gameApi._game;
  const before = g.snapshot();
  const result = g.act(action);

  if (!result.ok) return before;

  const state = result.state;
  const ev = state.lastEvent;

  if (ev) {
    switch (ev.kind) {
      case 'open':
        sfx.open();
        if (ev.opened > 1) {
          for (let i = 0; i < Math.min(ev.opened, 8); i++) {
            setTimeout(() => sfx.ripple(i), i * 60);
          }
        }
        break;
      case 'flag':
        sfx.flag();
        break;
      case 'unflag':
        sfx.unflag();
        break;
      case 'sweep':
        sfx.sweep();
        break;
      case 'sting':
        sfx.sting();
        break;
      case 'pool_clear':
        sfx.poolClear();
        break;
      case 'run_end':
        setTimeout(() => sfx.ceremony(), 300);
        break;
    }
  }

  render(state);
  return state;
}

function onMutate(fn) {
  fn();
  render(gameApi.snapshot());
}

exposeArenaGame(gameApi, render);
initBridge(
  {
    snapshot: () => gameApi.snapshot(),
    bridgeSnapshot: () => gameApi.bridgeSnapshot(),
    restart: () => gameApi.restart(),
    _game: gameApi._game,
  },
  onMutate
);

new Input(canvas, renderer, handleAction);

function resize() {
  renderer.resize();
}

window.addEventListener('resize', resize);
resize();

let lastFrame = 0;
let lastTick = 0;

function loop(now) {
  if (!lastFrame) lastFrame = now;
  if (!lastTick) lastTick = now;
  const frameDt = now - lastFrame;
  lastFrame = now;

  const elapsed = now - lastTick;
  if (elapsed >= TICK_MS) {
    const steps = Math.floor(elapsed / TICK_MS);
    gameApi.advance(steps * TICK_MS);
    lastTick += steps * TICK_MS;
  }

  renderer.draw(gameApi.snapshot(), frameDt);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Ambient water sounds occasionally
setInterval(() => {
  if (audioEnabled && gameApi.snapshot().phase !== 'ended') {
    sfx.ambient();
  }
}, 4000);

// Initial render
render(gameApi.snapshot());
