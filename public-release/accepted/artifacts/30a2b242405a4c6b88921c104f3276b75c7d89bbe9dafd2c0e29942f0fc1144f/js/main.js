// Lumen Yard - Main Application Entrypoint
import { LumenGame } from './game.js';
import { LumenRenderer } from './renderer.js';
import { audio } from './audio.js';
import { UIController } from './ui.js';
import { InputController } from './controls.js';
import { ArenaBridge } from './bridge.js';

function initApp() {
  const canvas = document.getElementById('game-canvas');

  // Initialize renderer first
  const renderer = new LumenRenderer(canvas);

  let ui = null;

  // Initialize game
  const game = new LumenGame({
    onStateChange: (state) => {
      renderer.setState(state);
      if (ui) ui.updateHUD(state);
    },
    onSoundEvent: (evt) => {
      audio.playEvent(evt);
    },
    onRefusal: (dir, r, c) => {
      renderer.triggerRefusal(dir, r, c);
    },
    onPushEffect: (dir, r, c, isGoal) => {
      renderer.triggerPush(dir, r, c, isGoal);
    }
  });

  // Initialize UI & Controls
  ui = new UIController(game, renderer, audio);
  const controls = new InputController(game, renderer, audio, ui);

  // Initialize Arena Bridge
  const bridge = new ArenaBridge(game);

  // Pass initial state to renderer and UI
  renderer.setState(game.snapshot());
  ui.updateHUD(game.snapshot());

  // Window resize handler
  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      renderer.resize();
    }, 50);
  });

  // Expose helpful debug info without cheating
  window.__LUMEN_VERSION__ = '1.0.0';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

