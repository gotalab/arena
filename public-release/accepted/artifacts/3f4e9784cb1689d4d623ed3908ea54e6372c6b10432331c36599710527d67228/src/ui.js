/**
 * LUMEN YARD - User Interface, Dialogs, Modals, Touch & Gamepad Handler
 */

import { RAW_LEVELS, LEVEL_IDS, LEVEL_MAP } from './levels.js';

export class UIManager {
  constructor(engine, renderer, audio, storage) {
    this.engine = engine;
    this.renderer = renderer;
    this.audio = audio;
    this.storage = storage;

    // DOM Elements
    this.elLevelTitle = document.getElementById('level-title');
    this.elLevelSubtitle = document.getElementById('level-subtitle');
    this.elLevelBadge = document.getElementById('level-badge');
    this.elMovesCount = document.getElementById('moves-count');
    this.elPushesCount = document.getElementById('pushes-count');
    this.elPowerCount = document.getElementById('power-count');
    this.elBestRecord = document.getElementById('best-record');

    this.btnUndo = document.getElementById('btn-undo');
    this.btnRestart = document.getElementById('btn-restart');
    this.btnLevels = document.getElementById('btn-levels');
    this.btnSettings = document.getElementById('btn-settings');

    // Drawer & Modals
    this.drawerLevels = document.getElementById('drawer-levels');
    this.levelsList = document.getElementById('levels-list');
    this.btnCloseDrawer = document.getElementById('btn-close-drawer');

    this.modalSettings = document.getElementById('modal-settings');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.toggleSound = document.getElementById('toggle-sound');
    this.toggleMotion = document.getElementById('toggle-motion');

    this.modalVictory = document.getElementById('modal-victory');
    this.victoryContent = document.getElementById('victory-content');

    this.canvas = document.getElementById('game-canvas');

    this.gamepadLoopActive = false;
    this.lastGamepadMoveTime = 0;

    this._bindEvents();
    this._initSettingsState();
    this._startGamepadLoop();
    this.updateHUD();
  }

  _initSettingsState() {
    const sound = this.storage.getSoundEnabled();
    const motion = this.storage.getReducedMotion();

    this.audio.setEnabled(sound);
    this.renderer.setReducedMotion(motion);

    if (this.toggleSound) this.toggleSound.checked = sound;
    if (this.toggleMotion) this.toggleMotion.checked = motion;
  }

  _bindEvents() {
    // Buttons
    if (this.btnUndo) {
      this.btnUndo.addEventListener('click', () => this.handleUndo());
    }
    if (this.btnRestart) {
      this.btnRestart.addEventListener('click', () => this.handleRestart());
    }
    if (this.btnLevels) {
      this.btnLevels.addEventListener('click', () => this.openLevelsDrawer());
    }
    if (this.btnCloseDrawer) {
      this.btnCloseDrawer.addEventListener('click', () => this.closeLevelsDrawer());
    }
    if (this.btnSettings) {
      this.btnSettings.addEventListener('click', () => this.openSettingsModal());
    }
    if (this.btnCloseSettings) {
      this.btnCloseSettings.addEventListener('click', () => this.closeSettingsModal());
    }

    // Settings Toggles
    if (this.toggleSound) {
      this.toggleSound.addEventListener('change', (e) => {
        const val = e.target.checked;
        this.storage.setSoundEnabled(val);
        this.audio.setEnabled(val);
      });
    }
    if (this.toggleMotion) {
      this.toggleMotion.addEventListener('change', (e) => {
        const val = e.target.checked;
        this.storage.setReducedMotion(val);
        this.renderer.setReducedMotion(val);
      });
    }

    // Keyboard controls
    window.addEventListener('keydown', (e) => this._handleKeyDown(e));

    // Canvas Mouse & Touch controls
    this._bindTouchAndMouse();

    // Backdrop click to close modals
    [this.drawerLevels, this.modalSettings, this.modalVictory].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            this.closeAllModals();
          }
        });
      }
    });
  }

  _bindTouchAndMouse() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    this.canvas.addEventListener('touchstart', (e) => {
      this.audio.ensureContext();
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = performance.now();
      }
    }, { passive: true });

    this.canvas.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const dt = performance.now() - touchStartTime;

        if (dist > 25) {
          // Swipe detected
          if (Math.abs(dx) > Math.abs(dy)) {
            this.handleMove(dx > 0 ? 'right' : 'left');
          } else {
            this.handleMove(dy > 0 ? 'down' : 'up');
          }
        } else if (dt < 400) {
          // Tap on canvas: check cell
          const cell = this.renderer.screenToCell(touchEndX, touchEndY);
          if (cell) {
            this._handleCellClick(cell);
          }
        }
      }
    }, { passive: true });

    // Mouse click & hover
    this.canvas.addEventListener('click', (e) => {
      this.audio.ensureContext();
      const cell = this.renderer.screenToCell(e.clientX, e.clientY);
      if (cell) {
        this._handleCellClick(cell);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const cell = this.renderer.screenToCell(e.clientX, e.clientY);
      this.renderer.setHoverCell(cell);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.renderer.setHoverCell(null);
    });
  }

  _handleCellClick(cell) {
    if (this.engine.phase === 'complete') return;
    const pr = this.engine.player.row;
    const pc = this.engine.player.col;

    // Check if cell is adjacent
    if (cell.row === pr - 1 && cell.col === pc) {
      this.handleMove('up');
    } else if (cell.row === pr + 1 && cell.col === pc) {
      this.handleMove('down');
    } else if (cell.row === pr && cell.col === pc - 1) {
      this.handleMove('left');
    } else if (cell.row === pr && cell.col === pc + 1) {
      this.handleMove('right');
    }
  }

  _handleKeyDown(e) {
    // If modal is open, Escape closes it
    if (e.key === 'Escape') {
      this.closeAllModals();
      return;
    }

    // Ignore game keys if typing in an input
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      return;
    }

    this.audio.ensureContext();

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        this.handleMove('up');
        break;

      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        this.handleMove('down');
        break;

      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this.handleMove('left');
        break;

      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this.handleMove('right');
        break;

      case 'u':
      case 'U':
      case 'Backspace':
        e.preventDefault();
        this.handleUndo();
        break;

      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.handleUndo();
        }
        break;

      case 'r':
      case 'R':
        e.preventDefault();
        this.handleRestart();
        break;

      default:
        break;
    }
  }

  handleMove(direction) {
    try {
      this.engine.act({ type: 'move', direction });
      this.renderer.renderImmediate();
      this.updateHUD();
    } catch (err) {
      // Illegal move feedback
      if (err.code === 'ILLEGAL_MOVE') {
        this.audio.playBlocked();
      }
    }
  }

  handleUndo() {
    try {
      this.engine.act({ type: 'undo' });
      this.audio.playUndo();
      this.renderer.renderImmediate();
      this.updateHUD();
      this.closeVictoryModal();
    } catch (_) {}
  }

  handleRestart() {
    try {
      this.engine.restart();
      this.audio.playStep();
      this.renderer.renderImmediate();
      this.updateHUD();
      this.closeVictoryModal();
    } catch (_) {}
  }

  handleSelectLevel(levelId) {
    try {
      this.engine.act({ type: 'select_level', levelId });
      this.storage.setLastPlayed(levelId);
      this.renderer.resize();
      this.renderer.renderImmediate();
      this.updateHUD();
      this.closeAllModals();
      this.audio.playStep();
    } catch (err) {
      console.error(err);
    }
  }

  updateHUD() {
    const levelDef = LEVEL_MAP.get(this.engine.levelId);
    const levelIdx = LEVEL_IDS.indexOf(this.engine.levelId) + 1;

    if (this.elLevelTitle) {
      this.elLevelTitle.textContent = `${levelIdx}. ${levelDef.title}`;
    }
    if (this.elLevelSubtitle) {
      this.elLevelSubtitle.textContent = levelDef.subtitle;
    }
    if (this.elLevelBadge) {
      this.elLevelBadge.textContent = `CH ${levelDef.chapter}`;
    }

    if (this.elMovesCount) {
      this.elMovesCount.textContent = this.engine.moveCount;
    }
    if (this.elPushesCount) {
      this.elPushesCount.textContent = this.engine.pushCount;
    }
    if (this.elPowerCount) {
      this.elPowerCount.textContent = `${this.engine.poweredGoals}/${this.engine.goals.length}`;
      if (this.engine.phase === 'complete') {
        this.elPowerCount.classList.add('powered-full');
      } else {
        this.elPowerCount.classList.remove('powered-full');
      }
    }

    const best = this.storage.getBestMoves(this.engine.levelId);
    if (this.elBestRecord) {
      this.elBestRecord.textContent = best !== null ? `BEST: ${best}` : 'BEST: --';
    }

    if (this.btnUndo) {
      this.btnUndo.disabled = this.engine.undoStack.length === 0;
    }
  }

  onLevelCompleted(levelId, moves, pushes) {
    const { isNewRecord, best } = this.storage.recordLevelComplete(levelId, moves);
    this.updateHUD();

    const currentIdx = LEVEL_IDS.indexOf(levelId);
    const hasNext = currentIdx >= 0 && currentIdx < LEVEL_IDS.length - 1;
    const nextLevelId = hasNext ? LEVEL_IDS[currentIdx + 1] : null;

    if (levelId === 'black-start') {
      // Special Chapter 1 Clear
      this.audio.playChapterClear();
      this._showChapter1ClearModal(moves, pushes, isNewRecord, best, nextLevelId);
    } else if (levelId === 'dawn-sequence') {
      // Board 20 Final
      this.audio.playChapterClear();
      this._showDawnSequenceModal(moves, pushes, isNewRecord, best);
    } else {
      // Standard Victory
      this.audio.playGridSurge();
      this._showStandardVictoryModal(moves, pushes, isNewRecord, best, nextLevelId);
    }
  }

  _showStandardVictoryModal(moves, pushes, isNewRecord, best, nextLevelId) {
    if (!this.modalVictory || !this.victoryContent) return;

    this.victoryContent.innerHTML = `
      <div class="victory-card">
        <div class="victory-icon">⚡</div>
        <h2 class="victory-title">CIRCUIT RESTORED</h2>
        <p class="victory-desc">給電回路の導通が確認されました。</p>
        
        <div class="victory-stats">
          <div class="stat-box">
            <span class="stat-label">手数</span>
            <span class="stat-val">${moves}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">押下数</span>
            <span class="stat-val">${pushes}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">ベスト記録</span>
            <span class="stat-val ${isNewRecord ? 'record-new' : ''}">${best} ${isNewRecord ? '(NEW!)' : ''}</span>
          </div>
        </div>

        <div class="victory-actions">
          ${hasNextLevelId(nextLevelId) ? `
            <button id="btn-victory-next" class="btn btn-primary btn-large">次の回路へ ▶</button>
          ` : ''}
          <button id="btn-victory-replay" class="btn btn-secondary">再挑戦 ↺</button>
          <button id="btn-victory-map" class="btn btn-secondary">回路一覧 ☰</button>
        </div>
      </div>
    `;

    function hasNextLevelId(id) {
      return !!id;
    }

    this._bindVictoryActionEvents(nextLevelId);
    this.modalVictory.classList.add('open');
  }

  _showChapter1ClearModal(moves, pushes, isNewRecord, best, nextLevelId) {
    if (!this.modalVictory || !this.victoryContent) return;

    this.victoryContent.innerHTML = `
      <div class="victory-card chapter-clear">
        <div class="victory-badge">CHAPTER 1 CLEAR</div>
        <div class="victory-icon glow-cyan">⚡</div>
        <h2 class="victory-title text-glow">GRID RESTORED</h2>
        <p class="victory-desc">
          基幹送電網のブラックスタートに成功しました。<br>
          ヤードの主要変電区画に電力が供給され、第2区画が開通します。
        </p>
        
        <div class="victory-stats">
          <div class="stat-box">
            <span class="stat-label">手数</span>
            <span class="stat-val">${moves}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">押下数</span>
            <span class="stat-val">${pushes}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">ベスト記録</span>
            <span class="stat-val ${isNewRecord ? 'record-new' : ''}">${best} ${isNewRecord ? '(NEW!)' : ''}</span>
          </div>
        </div>

        <div class="victory-actions">
          <button id="btn-victory-next" class="btn btn-primary btn-large">第2章「母線分離」へ進む ▶</button>
          <button id="btn-victory-replay" class="btn btn-secondary">再挑戦 ↺</button>
          <button id="btn-victory-map" class="btn btn-secondary">回路一覧 ☰</button>
        </div>
      </div>
    `;

    this._bindVictoryActionEvents(nextLevelId);
    this.modalVictory.classList.add('open');
  }

  _showDawnSequenceModal(moves, pushes, isNewRecord, best) {
    if (!this.modalVictory || !this.victoryContent) return;

    const totalCompleted = this.storage.getTotalCompletedCount();
    const isFullCampaignComplete = totalCompleted === 20;
    const totalBestMoves = this.storage.getTotalBestMoves();

    if (isFullCampaignComplete) {
      this.victoryContent.innerHTML = `
        <div class="victory-card campaign-clear">
          <div class="victory-badge badge-gold">ALL 20 CIRCUITS RESTORED</div>
          <div class="victory-icon glow-gold">🌅</div>
          <h2 class="victory-title text-glow-gold">DAWN OVER LUMEN YARD</h2>
          <p class="victory-desc">
            全20系統の回路が完全同期し、ルーメン・ヤードに黎明の光が満ちました。<br>
            夜間給電復旧ミッション完了。
          </p>
          
          <div class="victory-stats full-campaign-stats">
            <div class="stat-box">
              <span class="stat-label">復旧回路</span>
              <span class="stat-val highlight">20 / 20</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">総ベスト手数</span>
              <span class="stat-val highlight">${totalBestMoves}</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">Dawn 手数</span>
              <span class="stat-val">${moves} (Best: ${best})</span>
            </div>
          </div>

          <div class="yard-credits">
            <div class="credit-title">ルーメン・ヤード保守保守班</div>
            <div class="credit-names">自律保守機「Volt-7」 & グリッドエンジニア</div>
          </div>

          <div class="victory-actions">
            <button id="btn-victory-map" class="btn btn-primary btn-large">回路マップを開く ☰</button>
            <button id="btn-victory-replay" class="btn btn-secondary">Dawn Sequence 再挑戦 ↺</button>
          </div>
        </div>
      `;
    } else {
      this.victoryContent.innerHTML = `
        <div class="victory-card">
          <div class="victory-icon">⚡</div>
          <h2 class="victory-title">DAWN SEQUENCE RESTORED</h2>
          <p class="victory-desc">
            黎明シーケンスの導通を確認しました。<br>
            ただし、ヤード内にはまだ未復旧の回路（現在 ${totalCompleted}/20）が存在します。
          </p>
          
          <div class="victory-stats">
            <div class="stat-box">
              <span class="stat-label">復旧済み</span>
              <span class="stat-val highlight">${totalCompleted} / 20</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">手数</span>
              <span class="stat-val">${moves}</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">ベスト記録</span>
              <span class="stat-val">${best}</span>
            </div>
          </div>

          <div class="victory-actions">
            <button id="btn-victory-map" class="btn btn-primary btn-large">未復旧の回路一覧へ ☰</button>
            <button id="btn-victory-replay" class="btn btn-secondary">再挑戦 ↺</button>
          </div>
        </div>
      `;
    }

    this._bindVictoryActionEvents(null);
    this.modalVictory.classList.add('open');
  }

  _bindVictoryActionEvents(nextLevelId) {
    const btnNext = document.getElementById('btn-victory-next');
    const btnReplay = document.getElementById('btn-victory-replay');
    const btnMap = document.getElementById('btn-victory-map');

    if (btnNext && nextLevelId) {
      btnNext.addEventListener('click', () => {
        this.closeVictoryModal();
        this.handleSelectLevel(nextLevelId);
      });
    }

    if (btnReplay) {
      btnReplay.addEventListener('click', () => {
        this.closeVictoryModal();
        this.handleRestart();
      });
    }

    if (btnMap) {
      btnMap.addEventListener('click', () => {
        this.closeVictoryModal();
        this.openLevelsDrawer();
      });
    }
  }

  openLevelsDrawer() {
    this._renderLevelsList();
    if (this.drawerLevels) {
      this.drawerLevels.classList.add('open');
    }
  }

  closeLevelsDrawer() {
    if (this.drawerLevels) {
      this.drawerLevels.classList.remove('open');
    }
  }

  openSettingsModal() {
    if (this.modalSettings) {
      this.modalSettings.classList.add('open');
    }
  }

  closeSettingsModal() {
    if (this.modalSettings) {
      this.modalSettings.classList.remove('open');
    }
  }

  closeVictoryModal() {
    if (this.modalVictory) {
      this.modalVictory.classList.remove('open');
    }
  }

  closeAllModals() {
    this.closeLevelsDrawer();
    this.closeSettingsModal();
    this.closeVictoryModal();
  }

  _renderLevelsList() {
    if (!this.levelsList) return;
    this.levelsList.innerHTML = '';

    const currentLevelId = this.engine.levelId;
    let currentChapter = 0;

    RAW_LEVELS.forEach((lvl, idx) => {
      if (lvl.chapter !== currentChapter) {
        currentChapter = lvl.chapter;
        const chapHeader = document.createElement('div');
        chapHeader.className = 'chapter-header';
        chapHeader.textContent = currentChapter === 1 ? 'CHAPTER 1: 基礎復旧' :
                                 currentChapter === 2 ? 'CHAPTER 2: 分離と迷路' :
                                 'CHAPTER 3: 黎明の電力網';
        this.levelsList.appendChild(chapHeader);
      }

      const isCurrent = lvl.id === currentLevelId;
      const isCompleted = this.storage.isLevelCompleted(lvl.id);
      const best = this.storage.getBestMoves(lvl.id);

      const item = document.createElement('button');
      item.className = `level-item ${isCurrent ? 'current' : ''} ${isCompleted ? 'completed' : ''}`;
      item.setAttribute('tabindex', '0');

      item.innerHTML = `
        <div class="level-num">${idx + 1}</div>
        <div class="level-info">
          <div class="level-name">${lvl.title}</div>
          <div class="level-sub">${lvl.subtitle}</div>
        </div>
        <div class="level-meta">
          ${isCompleted ? `<span class="badge-done" title="復旧完了">⚡ CLEAR</span>` : `<span class="badge-open">OPEN</span>`}
          <span class="level-best">${best !== null ? `BEST: ${best}` : '--'}</span>
        </div>
      `;

      item.addEventListener('click', () => {
        this.handleSelectLevel(lvl.id);
      });

      this.levelsList.appendChild(item);
    });
  }

  _startGamepadLoop() {
    const poll = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0] || gamepads[1];

      if (gp) {
        const now = performance.now();
        const threshold = 0.5;
        const cooldown = 180; // ms between moves

        // Directional input
        let dir = null;
        if (gp.buttons[12] && gp.buttons[12].pressed || gp.axes[1] < -threshold) dir = 'up';
        else if (gp.buttons[13] && gp.buttons[13].pressed || gp.axes[1] > threshold) dir = 'down';
        else if (gp.buttons[14] && gp.buttons[14].pressed || gp.axes[0] < -threshold) dir = 'left';
        else if (gp.buttons[15] && gp.buttons[15].pressed || gp.axes[0] > threshold) dir = 'right';

        if (dir && now - this.lastGamepadMoveTime > cooldown) {
          this.lastGamepadMoveTime = now;
          this.handleMove(dir);
        }

        // Action buttons
        // Button 0 (A / Cross): confirm / move / interact
        // Button 1 (B / Circle): undo
        if (gp.buttons[1] && gp.buttons[1].pressed && now - this.lastGamepadMoveTime > 300) {
          this.lastGamepadMoveTime = now;
          this.handleUndo();
        }

        // Button 9 (Start / Menu): restart
        if (gp.buttons[9] && gp.buttons[9].pressed && now - this.lastGamepadMoveTime > 400) {
          this.lastGamepadMoveTime = now;
          this.handleRestart();
        }
      }

      requestAnimationFrame(poll);
    };

    requestAnimationFrame(poll);
  }
}
