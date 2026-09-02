/**
 * LUMEN YARD - Main Application Bootstrap
 */

import { GameEngine } from './game.js';
import { Renderer } from './renderer.js';
import { AudioManager } from './audio.js';
import { StorageManager } from './storage.js';
import { ArenaBridge } from './arena-bridge.js';
import { UIManager } from './ui.js';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas');
  const storage = new StorageManager();
  const initialLevelId = storage.getLastPlayed() || 'first-light';

  const audio = new AudioManager();
  const engine = new GameEngine(initialLevelId);
  const renderer = new Renderer(canvas, engine);

  // Synchronous render callback for Arena / window.__ARENA_GAME__
  const onRenderSync = () => {
    renderer.renderImmediate();
    if (ui) ui.updateHUD();
  };

  // Arena Bridge setup
  const arenaBridge = new ArenaBridge(engine, onRenderSync);

  // UI Setup
  const ui = new UIManager(engine, renderer, audio, storage);

  // Connect Engine Events to Audio, Renderer, UI
  engine.addEventListener((event) => {
    // Audio trigger
    if (event.type === 'step') {
      audio.playStep();
    } else if (event.type === 'push') {
      audio.playPush();
      if (event.isGoal) {
        audio.playSocketLock();
      }
    } else if (event.type === 'blocked') {
      audio.playBlocked();
    } else if (event.type === 'undo') {
      // Audio handled in UI
    } else if (event.type === 'complete') {
      ui.onLevelCompleted(event.levelId, event.moveCount, event.pushCount);
    }

    // Renderer FX trigger
    renderer.onGameEvent(event);

    // Update HUD
    ui.updateHUD();
  });

  // Responsive resize handler
  const handleResize = () => {
    renderer.resize();
  };

  window.addEventListener('resize', handleResize);
  const resizeObserver = new ResizeObserver(() => {
    handleResize();
  });
  if (canvas.parentElement) {
    resizeObserver.observe(canvas.parentElement);
  }

  // Initial sizing & render
  handleResize();
});
