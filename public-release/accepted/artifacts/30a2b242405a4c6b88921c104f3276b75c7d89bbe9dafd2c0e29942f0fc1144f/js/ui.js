// Lumen Yard - User Interface Controller
// HUD, Board Map, Chapter Milestone, Grand Dawn Summary, Settings

import { RAW_LEVELS, LEVEL_IDS, LEVEL_MAP } from './levels.js';
import { storage } from './storage.js';

export class UIController {
  constructor(game, renderer, audio) {
    this.game = game;
    this.renderer = renderer;
    this.audio = audio;

    this.activeModal = null; // 'board-map' | 'victory' | 'chapter' | 'dawn' | 'settings' | null

    this.cacheElements();
    this.bindEvents();
    this.updateHUD(this.game.snapshot());
  }

  cacheElements() {
    // HUD
    this.hudLevel = document.getElementById('hud-level');
    this.hudMoves = document.getElementById('hud-moves');
    this.hudBest = document.getElementById('hud-best');
    this.hudPushes = document.getElementById('hud-pushes');
    this.hudSockets = document.getElementById('hud-sockets');
    this.btnUndo = document.getElementById('btn-undo');
    this.btnRestart = document.getElementById('btn-restart');
    this.btnMap = document.getElementById('btn-map');
    this.btnSettings = document.getElementById('btn-settings');
    this.invitation = document.getElementById('invitation-badge');

    // Modals
    this.modalOverlay = document.getElementById('modal-overlay');
    this.boardMapModal = document.getElementById('board-map-modal');
    this.victoryModal = document.getElementById('victory-modal');
    this.chapterModal = document.getElementById('chapter-modal');
    this.dawnModal = document.getElementById('dawn-modal');
    this.settingsModal = document.getElementById('settings-modal');

    // Victory elements
    this.victoryTitle = document.getElementById('victory-title');
    this.victoryStats = document.getElementById('victory-stats');
    this.btnNextLevel = document.getElementById('btn-next-level');
    this.btnReplay = document.getElementById('btn-replay');
    this.btnVictoryMap = document.getElementById('btn-victory-map');

    // Chapter elements
    this.btnChapterContinue = document.getElementById('btn-chapter-continue');
    this.btnChapterReplay = document.getElementById('btn-chapter-replay');
    this.btnChapterMap = document.getElementById('btn-chapter-map');

    // Dawn elements
    this.dawnSummary = document.getElementById('dawn-summary');
    this.btnDawnReplay = document.getElementById('btn-dawn-replay');
    this.btnDawnMap = document.getElementById('btn-dawn-map');

    // Settings elements
    this.toggleSound = document.getElementById('toggle-sound');
    this.toggleMotion = document.getElementById('toggle-motion');
    this.btnCloseSettings = document.getElementById('btn-close-settings');

    // On-screen D-pad
    this.dpadUp = document.getElementById('dpad-up');
    this.dpadDown = document.getElementById('dpad-down');
    this.dpadLeft = document.getElementById('dpad-left');
    this.dpadRight = document.getElementById('dpad-right');
  }

  bindEvents() {
    // Action buttons
    this.btnUndo.addEventListener('click', () => {
      this.dismissInvitation();
      this.audio.unlock();
      try {
        this.game.act({ type: 'undo' });
        this.renderer.triggerUndo();
      } catch (e) {}
    });

    this.btnRestart.addEventListener('click', () => {
      this.dismissInvitation();
      this.audio.unlock();
      this.game.restart();
    });

    this.btnMap.addEventListener('click', () => {
      this.dismissInvitation();
      this.audio.unlock();
      this.toggleBoardMap();
    });

    this.btnSettings.addEventListener('click', () => {
      this.dismissInvitation();
      this.audio.unlock();
      this.openSettings();
    });

    // Close modals on overlay backdrop click
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) {
        this.closeModals();
      }
    });

    // Victory modal buttons
    this.btnNextLevel.addEventListener('click', () => {
      this.closeModals();
      const currentIdx = LEVEL_IDS.indexOf(this.game.levelId);
      if (currentIdx >= 0 && currentIdx < LEVEL_IDS.length - 1) {
        const nextId = LEVEL_IDS[currentIdx + 1];
        this.game.act({ type: 'select_level', levelId: nextId });
      }
    });

    this.btnReplay.addEventListener('click', () => {
      this.closeModals();
      this.game.restart();
    });

    this.btnVictoryMap.addEventListener('click', () => {
      this.closeModals();
      this.openBoardMap();
    });

    // Chapter modal buttons
    this.btnChapterContinue.addEventListener('click', () => {
      this.closeModals();
      this.game.act({ type: 'select_level', levelId: 'split-bus' });
    });

    this.btnChapterReplay.addEventListener('click', () => {
      this.closeModals();
      this.game.restart();
    });

    this.btnChapterMap.addEventListener('click', () => {
      this.closeModals();
      this.openBoardMap();
    });

    // Dawn modal buttons
    this.btnDawnReplay.addEventListener('click', () => {
      this.closeModals();
      this.game.restart();
    });

    this.btnDawnMap.addEventListener('click', () => {
      this.closeModals();
      this.openBoardMap();
    });

    // Settings controls
    this.toggleSound.checked = storage.getSoundEnabled(true);
    this.toggleSound.addEventListener('change', (e) => {
      this.audio.setEnabled(e.target.checked);
    });

    this.toggleMotion.checked = storage.getMotionEnabled();
    this.toggleMotion.addEventListener('change', (e) => {
      storage.setMotionEnabled(e.target.checked);
    });

    this.btnCloseSettings.addEventListener('click', () => {
      this.closeModals();
    });

    // Virtual D-pad
    const addDpad = (btn, dir) => {
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.dismissInvitation();
        this.audio.unlock();
        try {
          this.game.act({ type: 'move', direction: dir });
        } catch (err) {}
      });
    };
    addDpad(this.dpadUp, 'up');
    addDpad(this.dpadDown, 'down');
    addDpad(this.dpadLeft, 'left');
    addDpad(this.dpadRight, 'right');
  }

  dismissInvitation() {
    if (this.invitation) {
      this.invitation.classList.add('hidden');
    }
  }

  isModalOpen() {
    return this.activeModal !== null;
  }

  closeModals() {
    this.modalOverlay.classList.add('hidden');
    this.boardMapModal.classList.add('hidden');
    this.victoryModal.classList.add('hidden');
    this.chapterModal.classList.add('hidden');
    this.dawnModal.classList.add('hidden');
    this.settingsModal.classList.add('hidden');
    this.activeModal = null;
  }

  toggleBoardMap() {
    if (this.activeModal === 'board-map') {
      this.closeModals();
    } else {
      this.openBoardMap();
    }
  }

  openBoardMap() {
    this.closeModals();
    this.renderBoardMapList();
    this.modalOverlay.classList.remove('hidden');
    this.boardMapModal.classList.remove('hidden');
    this.activeModal = 'board-map';

    // Focus active board item for accessibility
    const activeItem = this.boardMapModal.querySelector('.board-item.active');
    if (activeItem) {
      activeItem.focus();
    }
  }

  renderBoardMapList() {
    const listContainer = document.getElementById('board-list-items');
    listContainer.innerHTML = '';

    const restoredSet = storage.getRestoredLevels();
    const bests = storage.getBests();

    document.getElementById('map-progress-counter').textContent = 
      `${restoredSet.size} / ${RAW_LEVELS.length} RESTORED`;

    RAW_LEVELS.forEach((raw, idx) => {
      const isCurrent = raw.id === this.game.levelId;
      const isRestored = restoredSet.has(raw.id);
      const bestScore = bests[raw.id];

      const item = document.createElement('button');
      item.type = 'button';
      item.className = `board-item ${isCurrent ? 'active' : ''} ${isRestored ? 'restored' : ''}`;
      item.setAttribute('data-id', raw.id);
      item.setAttribute('aria-label', `Circuit ${idx + 1}: ${raw.title}. ${isRestored ? 'Restored' : 'Unfinished'}`);

      const numStr = String(idx + 1).padStart(2, '0');
      const statusGlyph = isRestored ? '⚡' : (isCurrent ? '▶' : '○');
      const statusText = isRestored ? 'RESTORED' : (isCurrent ? 'ACTIVE' : 'STANDBY');
      const bestText = bestScore !== undefined ? `Best: ${bestScore} moves` : 'Best: —';

      item.innerHTML = `
        <div class="item-left">
          <span class="item-glyph" aria-hidden="true">${statusGlyph}</span>
          <span class="item-num">${numStr}.</span>
          <span class="item-title">${raw.title}</span>
        </div>
        <div class="item-right">
          <span class="item-best">${bestText}</span>
          <span class="item-status">${statusText}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        this.closeModals();
        try {
          this.game.act({ type: 'select_level', levelId: raw.id });
        } catch (e) {
          this.game.loadLevel(raw.id);
        }
      });

      listContainer.appendChild(item);
    });
  }

  openSettings() {
    this.closeModals();
    this.modalOverlay.classList.remove('hidden');
    this.settingsModal.classList.remove('hidden');
    this.activeModal = 'settings';
    this.btnCloseSettings.focus();
  }

  updateHUD(state) {
    // Level Title
    const lvl = LEVEL_MAP.get(state.levelId);
    const lvlIdx = LEVEL_IDS.indexOf(state.levelId);
    const numStr = String(lvlIdx + 1).padStart(2, '0');
    this.hudLevel.textContent = `${numStr}. ${lvl ? lvl.title : state.levelId}`;

    // Moves & Best
    this.hudMoves.textContent = state.moveCount;
    const bests = storage.getBests();
    const best = bests[state.levelId];
    this.hudBest.textContent = best !== undefined ? `Best: ${best}` : 'Best: —';

    // Pushes
    this.hudPushes.textContent = state.pushCount;

    // Sockets (not color alone: filled vs empty dots + fraction + lightning icon)
    const total = state.goals.length;
    const filled = state.poweredGoals;
    let dots = '';
    for (let i = 0; i < total; i++) {
      dots += (i < filled ? '●' : '○');
    }
    this.hudSockets.textContent = `⚡ ${dots} ${filled}/${total}`;

    // Undo button state
    this.btnUndo.disabled = !state.undoAvailable;
    this.btnUndo.setAttribute('aria-disabled', !state.undoAvailable);

    // Handle Completion celebration
    if (state.phase === 'complete') {
      this.handleCompletion(state);
    }
  }

  handleCompletion(state) {
    const isNewBest = storage.recordBest(state.levelId, state.moveCount);
    storage.markLevelRestored(state.levelId);

    // Delay celebration card slightly to let power surge animation shine
    setTimeout(() => {
      if (this.game.phase !== 'complete') return; // Cancel if undone

      if (state.levelId === 'black-start') {
        // Chapter 1 Celebration: "GRID RESTORED"
        this.openChapterCelebration(state);
      } else if (state.levelId === 'dawn-sequence') {
        // Board 20: Dawn Sequence
        this.openDawnCelebration(state);
      } else {
        // Standard Level Victory
        this.openStandardVictory(state, isNewBest);
      }
    }, 600);
  }

  openStandardVictory(state, isNewBest) {
    this.closeModals();
    const lvl = LEVEL_MAP.get(state.levelId);
    const lvlIdx = LEVEL_IDS.indexOf(state.levelId);

    this.victoryTitle.textContent = `${lvl.title} Restored`;
    this.victoryStats.innerHTML = `
      <div class="stat-row">
        <span>Moves Taken:</span>
        <strong>${state.moveCount}</strong>
      </div>
      <div class="stat-row">
        <span>Pushes Made:</span>
        <strong>${state.pushCount}</strong>
      </div>
      ${isNewBest ? '<div class="new-best-badge">★ NEW RECORD!</div>' : ''}
    `;

    // If last level, hide next button
    if (lvlIdx === LEVEL_IDS.length - 1) {
      this.btnNextLevel.classList.add('hidden');
    } else {
      this.btnNextLevel.classList.remove('hidden');
      const nextLvl = RAW_LEVELS[lvlIdx + 1];
      this.btnNextLevel.textContent = `Next: ${nextLvl.title} →`;
    }

    this.modalOverlay.classList.remove('hidden');
    this.victoryModal.classList.remove('hidden');
    this.activeModal = 'victory';
    this.btnNextLevel.focus();
  }

  openChapterCelebration(state) {
    this.closeModals();
    this.modalOverlay.classList.remove('hidden');
    this.chapterModal.classList.remove('hidden');
    this.activeModal = 'chapter';
    this.btnChapterContinue.focus();
  }

  openDawnCelebration(state) {
    this.closeModals();
    const restored = storage.getRestoredLevels();
    const totalLevels = RAW_LEVELS.length;
    const isFullCampaignRestored = restored.size >= totalLevels;

    const bests = storage.getBests();
    let totalMoves = 0;
    for (const id of LEVEL_IDS) {
      if (bests[id] !== undefined) {
        totalMoves += bests[id];
      }
    }

    if (isFullCampaignRestored) {
      // Full campaign completion celebration
      this.dawnSummary.innerHTML = `
        <div class="dawn-badge">★ FULL GRID RESTORED ★</div>
        <h2>THE FINAL DAWN</h2>
        <p class="dawn-desc">The sleeping yard has fully awakened. Current hums through all twenty sectors, illuminating the horizon.</p>
        <div class="campaign-stats">
          <div class="stat-box">
            <span class="lbl">Restored</span>
            <span class="val">20 / 20</span>
          </div>
          <div class="stat-box">
            <span class="lbl">Cumulative Best</span>
            <span class="val">${totalMoves} moves</span>
          </div>
        </div>
        <div class="crew-credit">
          <strong>Yard Crew:</strong> Unit-7, Substation 4B, Central Grid Operations.
        </div>
      `;
    } else {
      // Early arrival at dawn-sequence via board browser
      const remaining = totalLevels - restored.size;
      this.dawnSummary.innerHTML = `
        <div class="dawn-badge">CIRCUIT 20 ONLINE</div>
        <h2>DAWN SEQUENCE RESTORED</h2>
        <p class="dawn-desc">Circuit 20 is energized! However, <strong>${remaining} offline sector${remaining > 1 ? 's' : ''}</strong> still remain sleeping in the yard.</p>
        <p class="dawn-subtext">Return to the Board Map to awaken the entire grid and trigger the true Final Dawn.</p>
        <div class="campaign-stats">
          <div class="stat-box">
            <span class="lbl">Sectors Restored</span>
            <span class="val">${restored.size} / 20</span>
          </div>
        </div>
      `;
    }

    this.modalOverlay.classList.remove('hidden');
    this.dawnModal.classList.remove('hidden');
    this.activeModal = 'dawn';
    this.btnDawnMap.focus();
  }
}
