import { GameEngine, PARSED_LEVELS, LEVEL_MAP } from './engine.js';
import { Renderer } from './renderer.js';
import { soundSystem } from './audio.js';

// Persistence Manager
class StorageManager {
  constructor() {
    this.storageAvailable = this.checkStorage();
    this.keyPrefix = "lumen_yard_";
  }

  checkStorage() {
    try {
      const test = "__storage_test__";
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }

  get(key, defaultValue) {
    if (!this.storageAvailable) return defaultValue;
    try {
      const val = localStorage.getItem(this.keyPrefix + key);
      return val !== null ? JSON.parse(val) : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  set(key, value) {
    if (!this.storageAvailable) return;
    try {
      localStorage.setItem(this.keyPrefix + key, JSON.stringify(value));
    } catch (e) {
      // Ignore quota or private mode errors
    }
  }
}

export class LumenYardGame {
  constructor() {
    this.storage = new StorageManager();

    // Sound & Motion settings
    const systemPrefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.soundEnabled = this.storage.get("sound_enabled", true);
    this.motionEnabled = this.storage.get("motion_enabled", !systemPrefersReducedMotion);

    soundSystem.setEnabled(this.soundEnabled);

    // Records & Progress
    this.completedLevels = new Set(this.storage.get("completed_levels", []));
    this.bestMoves = this.storage.get("best_moves", {}); // { [levelId]: number }

    const savedLastLevel = this.storage.get("last_level", "first-light");
    const initialLevelId = LEVEL_MAP.has(savedLastLevel) ? savedLastLevel : "first-light";

    // Engine
    this.engine = new GameEngine({
      onStateChange: (snap) => this.onEngineStateChange(snap),
      onEvent: (evt) => this.onEngineEvent(evt)
    });

    if (initialLevelId !== "first-light") {
      try {
        this.engine.loadLevel(initialLevelId, false);
      } catch (e) {
        this.engine.loadLevel("first-light", false);
      }
    }

    // Canvas & Renderer
    this.canvas = document.getElementById("game-canvas");
    this.renderer = new Renderer(this.canvas, this.engine, { motionEnabled: this.motionEnabled });
    this.renderer.start();

    // UI Elements
    this.initDomReferences();
    this.bindUiEvents();
    this.bindInputEvents();
    this.initGamepad();

    // Invitation banner state
    this.hasInteracted = false;

    // Update Initial UI
    this.updateHud();
    this.renderBoardBrowser();

    // Arena Bridge
    this.initArenaBridge();
    this.exportArenaGlobal();
  }

  initDomReferences() {
    this.dom = {
      levelBtn: document.getElementById("btn-level-select"),
      levelNameText: document.getElementById("current-level-name"),
      socketsStat: document.getElementById("stat-sockets"),
      movesStat: document.getElementById("stat-moves"),
      bestStat: document.getElementById("stat-best"),
      pushesStat: document.getElementById("stat-pushes"),
      undoBtn: document.getElementById("btn-undo"),
      restartBtn: document.getElementById("btn-restart"),
      mapBtn: document.getElementById("btn-map"),
      settingsBtn: document.getElementById("btn-settings"),
      nextBtn: document.getElementById("btn-next-level"),
      invitationOverlay: document.getElementById("invitation-overlay"),

      // Modals
      mapModal: document.getElementById("map-modal"),
      closeMapBtn: document.getElementById("btn-close-map"),
      circuitGrid: document.getElementById("circuit-grid-container"),

      settingsModal: document.getElementById("settings-modal"),
      closeSettingsBtn: document.getElementById("btn-close-settings"),
      soundToggle: document.getElementById("toggle-sound"),
      motionToggle: document.getElementById("toggle-motion"),

      chapterModal: document.getElementById("chapter-modal"),
      chapterContinueBtn: document.getElementById("btn-chapter-continue"),
      chapterReplayBtn: document.getElementById("btn-chapter-replay"),

      campaignModal: document.getElementById("campaign-modal"),
      campaignReplayBtn: document.getElementById("btn-campaign-replay"),
      campaignMapBtn: document.getElementById("btn-campaign-map"),
      campaignTotalMoves: document.getElementById("campaign-total-moves"),
      campaignRestoredCount: document.getElementById("campaign-restored-count"),

      levelWinModal: document.getElementById("level-win-modal"),
      levelWinTitle: document.getElementById("level-win-title"),
      levelWinMoves: document.getElementById("level-win-moves"),
      levelWinBest: document.getElementById("level-win-best"),
      levelWinNextBtn: document.getElementById("btn-win-next"),
      levelWinReplayBtn: document.getElementById("btn-win-replay"),

      // D-Pad buttons for touch
      dpadUp: document.getElementById("dpad-up"),
      dpadDown: document.getElementById("dpad-down"),
      dpadLeft: document.getElementById("dpad-left"),
      dpadRight: document.getElementById("dpad-right")
    };

    if (this.dom.soundToggle) this.dom.soundToggle.checked = this.soundEnabled;
    if (this.dom.motionToggle) this.dom.motionToggle.checked = this.motionEnabled;
  }

  onFirstInteraction() {
    if (!this.hasInteracted) {
      this.hasInteracted = true;
      soundSystem.ensureContext();
      if (this.dom.invitationOverlay) {
        this.dom.invitationOverlay.classList.add("fade-out");
      }
    }
  }

  bindUiEvents() {
    this.dom.levelBtn.addEventListener("click", () => {
      this.onFirstInteraction();
      soundSystem.playUiClick();
      this.openModal(this.dom.mapModal);
    });

    this.dom.mapBtn.addEventListener("click", () => {
      this.onFirstInteraction();
      soundSystem.playUiClick();
      this.openModal(this.dom.mapModal);
    });

    this.dom.closeMapBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.mapModal);
    });

    this.dom.settingsBtn.addEventListener("click", () => {
      this.onFirstInteraction();
      soundSystem.playUiClick();
      this.openModal(this.dom.settingsModal);
    });

    this.dom.closeSettingsBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.settingsModal);
    });

    this.dom.undoBtn.addEventListener("click", () => {
      this.onFirstInteraction();
      this.performAction({ type: "undo" });
    });

    this.dom.restartBtn.addEventListener("click", () => {
      this.onFirstInteraction();
      this.restartGame();
    });

    if (this.dom.nextBtn) {
      this.dom.nextBtn.addEventListener("click", () => {
        this.onFirstInteraction();
        this.goToNextLevel();
      });
    }

    // Sound toggle
    this.dom.soundToggle.addEventListener("change", (e) => {
      this.soundEnabled = e.target.checked;
      soundSystem.setEnabled(this.soundEnabled);
      this.storage.set("sound_enabled", this.soundEnabled);
      if (this.soundEnabled) soundSystem.playUiClick();
    });

    // Motion toggle
    this.dom.motionToggle.addEventListener("change", (e) => {
      this.motionEnabled = e.target.checked;
      this.renderer.setMotion(this.motionEnabled);
      this.storage.set("motion_enabled", this.motionEnabled);
    });

    // Chapter 1 Celebration Buttons
    this.dom.chapterContinueBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.chapterModal);
      this.selectLevel("split-bus");
    });

    this.dom.chapterReplayBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.chapterModal);
      this.restartGame();
    });

    // Campaign Celebration Buttons
    this.dom.campaignReplayBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.campaignModal);
      this.restartGame();
    });

    this.dom.campaignMapBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.campaignModal);
      this.openModal(this.dom.mapModal);
    });

    // Level Win Modal Buttons
    this.dom.levelWinNextBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.levelWinModal);
      this.goToNextLevel();
    });

    this.dom.levelWinReplayBtn.addEventListener("click", () => {
      soundSystem.playUiClick();
      this.closeModal(this.dom.levelWinModal);
      this.restartGame();
    });

    // Close modals on backdrop click
    [this.dom.mapModal, this.dom.settingsModal, this.dom.chapterModal, this.dom.campaignModal, this.dom.levelWinModal].forEach(modal => {
      if (modal) {
        modal.addEventListener("click", (e) => {
          if (e.target === modal) {
            this.closeModal(modal);
          }
        });
      }
    });

    // Touch D-Pad buttons
    const bindDpad = (btn, dir) => {
      if (!btn) return;
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.onFirstInteraction();
        this.performAction({ type: "move", direction: dir });
      });
    };
    bindDpad(this.dom.dpadUp, "up");
    bindDpad(this.dom.dpadDown, "down");
    bindDpad(this.dom.dpadLeft, "left");
    bindDpad(this.dom.dpadRight, "right");
  }

  bindInputEvents() {
    // Keyboard Navigation
    window.addEventListener("keydown", (e) => {
      // If modal is open and key is Escape, close it
      if (e.key === "Escape") {
        this.closeAllModals();
        return;
      }

      // If user is inside modal, let normal modal keyboard navigation work
      if (this.isAnyModalOpen()) {
        return;
      }

      let handled = false;
      const key = e.key.toLowerCase();

      if (e.key === "ArrowUp" || key === "w") {
        this.performAction({ type: "move", direction: "up" });
        handled = true;
      } else if (e.key === "ArrowDown" || key === "s") {
        this.performAction({ type: "move", direction: "down" });
        handled = true;
      } else if (e.key === "ArrowLeft" || key === "a") {
        this.performAction({ type: "move", direction: "left" });
        handled = true;
      } else if (e.key === "ArrowRight" || key === "d") {
        this.performAction({ type: "move", direction: "right" });
        handled = true;
      } else if (key === "u" || key === "backspace" || (e.ctrlKey && key === "z") || (e.metaKey && key === "z")) {
        this.performAction({ type: "undo" });
        handled = true;
      } else if (key === "r") {
        this.restartGame();
        handled = true;
      } else if (key === "m") {
        this.openModal(this.dom.mapModal);
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        this.onFirstInteraction();
      }
    });

    // Canvas Mouse Click on adjacent tile
    this.canvas.addEventListener("pointerdown", (e) => {
      this.onFirstInteraction();
      if (this.isAnyModalOpen()) return;

      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left - this.renderer.offsetX;
      const clickY = e.clientY - rect.top - this.renderer.offsetY;
      const cs = this.renderer.cellSize;

      const clickedCol = Math.floor(clickX / cs);
      const clickedRow = Math.floor(clickY / cs);

      const pr = this.engine.player.row;
      const pc = this.engine.player.col;

      const dr = clickedRow - pr;
      const dc = clickedCol - pc;

      // Check if adjacent orthogonal cell clicked
      if (dr === -1 && dc === 0) {
        this.performAction({ type: "move", direction: "up" });
      } else if (dr === 1 && dc === 0) {
        this.performAction({ type: "move", direction: "down" });
      } else if (dr === 0 && dc === -1) {
        this.performAction({ type: "move", direction: "left" });
      } else if (dr === 0 && dc === 1) {
        this.performAction({ type: "move", direction: "right" });
      }
    });

    // Touch Swipe Detection
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const touchSurface = this.canvas.parentElement;
    touchSurface.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = performance.now();
      }
    }, { passive: true });

    touchSurface.addEventListener("touchend", (e) => {
      if (this.isAnyModalOpen()) return;
      if (e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const dt = performance.now() - touchStartTime;
        const dist = Math.hypot(dx, dy);

        if (dist > 25 && dt < 450) {
          // Swipe detected
          this.onFirstInteraction();
          if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) this.performAction({ type: "move", direction: "right" });
            else this.performAction({ type: "move", direction: "left" });
          } else {
            if (dy > 0) this.performAction({ type: "move", direction: "down" });
            else this.performAction({ type: "move", direction: "up" });
          }
        }
      }
    }, { passive: true });
  }

  initGamepad() {
    let lastGamepadTime = 0;
    let lastButtons = new Map();

    const checkGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads[0] || gamepads[1];
      if (gp && gp.connected) {
        const now = performance.now();
        const debounce = now - lastGamepadTime > 180;

        const isPressed = (btnIdx) => gp.buttons[btnIdx] && gp.buttons[btnIdx].pressed;

        // D-Pad or Left Stick
        const stickX = gp.axes[0] || 0;
        const stickY = gp.axes[1] || 0;

        if (debounce) {
          if (isPressed(12) || stickY < -0.5) { // Up
            this.onFirstInteraction();
            this.performAction({ type: "move", direction: "up" });
            lastGamepadTime = now;
          } else if (isPressed(13) || stickY > 0.5) { // Down
            this.onFirstInteraction();
            this.performAction({ type: "move", direction: "down" });
            lastGamepadTime = now;
          } else if (isPressed(14) || stickX < -0.5) { // Left
            this.onFirstInteraction();
            this.performAction({ type: "move", direction: "left" });
            lastGamepadTime = now;
          } else if (isPressed(15) || stickX > 0.5) { // Right
            this.onFirstInteraction();
            this.performAction({ type: "move", direction: "right" });
            lastGamepadTime = now;
          }
        }

        // Secondary / B Button (1) or X (2) -> Undo
        if ((isPressed(1) || isPressed(2)) && !lastButtons.get("undo")) {
          this.onFirstInteraction();
          this.performAction({ type: "undo" });
          lastButtons.set("undo", true);
        } else if (!isPressed(1) && !isPressed(2)) {
          lastButtons.set("undo", false);
        }

        // Start (9) or Select (8) -> Restart / Map
        if (isPressed(9) && !lastButtons.get("start")) {
          this.onFirstInteraction();
          this.restartGame();
          lastButtons.set("start", true);
        } else if (!isPressed(9)) {
          lastButtons.set("start", false);
        }

        if (isPressed(8) && !lastButtons.get("select")) {
          this.onFirstInteraction();
          this.openModal(this.dom.mapModal);
          lastButtons.set("select", true);
        } else if (!isPressed(8)) {
          lastButtons.set("select", false);
        }
      }
      requestAnimationFrame(checkGamepad);
    };

    requestAnimationFrame(checkGamepad);
  }

  isAnyModalOpen() {
    return [
      this.dom.mapModal,
      this.dom.settingsModal,
      this.dom.chapterModal,
      this.dom.campaignModal,
      this.dom.levelWinModal
    ].some(m => m && m.classList.contains("open"));
  }

  openModal(modal) {
    if (!modal) return;
    modal.classList.add("open");
    const focusable = modal.querySelector("button, [tabindex='0']");
    if (focusable) focusable.focus();
  }

  closeModal(modal) {
    if (!modal) return;
    modal.classList.remove("open");
    this.canvas.focus();
  }

  closeAllModals() {
    [
      this.dom.mapModal,
      this.dom.settingsModal,
      this.dom.chapterModal,
      this.dom.campaignModal,
      this.dom.levelWinModal
    ].forEach(m => {
      if (m) m.classList.remove("open");
    });
    this.canvas.focus();
  }

  performAction(action) {
    try {
      const snap = this.engine.act(action);
      this.renderer.renderImmediate();
      return snap;
    } catch (e) {
      // Ignored or handled by event
      return null;
    }
  }

  restartGame() {
    const snap = this.engine.restart();
    soundSystem.playUndo();
    this.renderer.renderImmediate();
    this.updateHud();
    return snap;
  }

  selectLevel(levelId) {
    try {
      const snap = this.engine.act({ type: "select_level", levelId });
      this.storage.set("last_level", levelId);
      this.closeAllModals();
      this.updateHud();
      this.renderBoardBrowser();
      this.renderer.renderImmediate();
      return snap;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  goToNextLevel() {
    const currentIndex = this.engine.currentLevelIndex;
    if (currentIndex < PARSED_LEVELS.length - 1) {
      const nextId = PARSED_LEVELS[currentIndex + 1].id;
      this.selectLevel(nextId);
    } else {
      // Reached end of levels, open map
      this.openModal(this.dom.mapModal);
    }
  }

  onEngineStateChange(snap) {
    this.updateHud();
  }

  onEngineEvent(event) {
    if (event.type === "step") {
      soundSystem.playStep();
    } else if (event.type === "push") {
      soundSystem.playPush();
      if (event.onGoal) {
        soundSystem.playSocketContact();
      }
    } else if (event.type === "move_blocked" || event.type === "push_blocked") {
      soundSystem.playBlocked();
    } else if (event.type === "undo") {
      soundSystem.playUndo();
    } else if (event.type === "board_completed") {
      soundSystem.playGridSurge();
      this.handleBoardCompleted(event.levelId, event.moves);
    }

    this.renderer.onGameEvent(event);
  }

  handleBoardCompleted(levelId, moves) {
    // Record completion
    this.completedLevels.add(levelId);
    this.storage.set("completed_levels", Array.from(this.completedLevels));

    // Update best moves
    const prevBest = this.bestMoves[levelId];
    if (prevBest === undefined || moves < prevBest) {
      this.bestMoves[levelId] = moves;
      this.storage.set("best_moves", this.bestMoves);
    }

    this.updateHud();
    this.renderBoardBrowser();

    // Check Chapter or Final Endings
    if (levelId === "black-start") {
      // Chapter 1 Celebration Ending!
      setTimeout(() => {
        this.openModal(this.dom.chapterModal);
      }, 700);
    } else if (levelId === "dawn-sequence") {
      // Level 20 Dawn Sequence Ending!
      setTimeout(() => {
        this.showDawnSequenceSummary();
      }, 700);
    } else {
      // Standard Level Victory
      setTimeout(() => {
        this.showLevelWinModal(levelId, moves);
      }, 700);
    }
  }

  showLevelWinModal(levelId, moves) {
    const lvl = LEVEL_MAP.get(levelId);
    const best = this.bestMoves[levelId] || moves;
    this.dom.levelWinTitle.textContent = `${lvl.name.toUpperCase()} RESTORED`;
    this.dom.levelWinMoves.textContent = moves;
    this.dom.levelWinBest.textContent = best;
    this.openModal(this.dom.levelWinModal);
  }

  showDawnSequenceSummary() {
    const totalCompleted = this.completedLevels.size;
    let totalBestMoves = 0;
    for (const lvl of PARSED_LEVELS) {
      if (this.bestMoves[lvl.id]) {
        totalBestMoves += this.bestMoves[lvl.id];
      }
    }

    this.dom.campaignRestoredCount.textContent = `${totalCompleted}/20`;
    this.dom.campaignTotalMoves.textContent = totalBestMoves > 0 ? totalBestMoves : "—";

    const descEl = document.getElementById("campaign-desc-text");
    if (descEl) {
      if (totalCompleted === 20) {
        descEl.textContent = "The whole substation is alive. Current hums across all twenty sectors in harmonic synchrony.";
      } else {
        descEl.textContent = `Dawn Sequence is restored, but ${20 - totalCompleted} circuits remain asleep in the yard. Return to complete the full grid!`;
      }
    }

    this.openModal(this.dom.campaignModal);
  }

  updateHud() {
    const snap = this.engine.snapshot();
    const lvl = this.engine.currentLevel;

    this.dom.levelNameText.textContent = `${String(this.engine.currentLevelIndex + 1).padStart(2, '0')} : ${lvl.name.toUpperCase()}`;
    this.dom.socketsStat.textContent = `${snap.poweredGoals}/${lvl.goals.length}`;
    if (snap.poweredGoals === lvl.goals.length) {
      this.dom.socketsStat.classList.add("powered");
    } else {
      this.dom.socketsStat.classList.remove("powered");
    }

    this.dom.movesStat.textContent = snap.moveCount;
    this.dom.pushesStat.textContent = snap.pushCount;

    const best = this.bestMoves[lvl.id];
    this.dom.bestStat.textContent = best !== undefined ? best : "—";

    this.dom.undoBtn.disabled = !snap.undoAvailable;
  }

  renderBoardBrowser() {
    const container = this.dom.circuitGrid;
    if (!container) return;

    container.innerHTML = "";

    const chapters = [
      { num: 1, title: "Chapter 1 : Initial Ignition", levels: PARSED_LEVELS.slice(0, 3) },
      { num: 2, title: "Chapter 2 : Substation Grid", levels: PARSED_LEVELS.slice(3, 12) },
      { num: 3, title: "Chapter 3 : High Voltage Relays", levels: PARSED_LEVELS.slice(12, 19) },
      { num: 4, title: "Final Chapter : Dawn Sequence", levels: PARSED_LEVELS.slice(19, 20) }
    ];

    chapters.forEach(ch => {
      const heading = document.createElement("div");
      heading.className = "chapter-heading";
      heading.textContent = ch.title;
      container.appendChild(heading);

      const grid = document.createElement("div");
      grid.className = "circuit-grid";

      ch.levels.forEach((lvl, idx) => {
        const globalIdx = PARSED_LEVELS.findIndex(l => l.id === lvl.id);
        const isCompleted = this.completedLevels.has(lvl.id);
        const isActive = this.engine.currentLevel.id === lvl.id;
        const best = this.bestMoves[lvl.id];

        const card = document.createElement("button");
        card.className = `circuit-card ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
        card.setAttribute("tabindex", "0");
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `Select circuit ${lvl.name}`);

        card.innerHTML = `
          <div class="circuit-card-header">
            <span class="circuit-num">CIRCUIT ${String(globalIdx + 1).padStart(2, '0')}</span>
            <span class="circuit-status">${isCompleted ? '⚡ RESTORED' : '○ ASLEEP'}</span>
          </div>
          <div class="circuit-name">${lvl.name}</div>
          <div class="circuit-best">Best: ${best !== undefined ? `${best} moves` : '—'}</div>
        `;

        card.addEventListener("click", () => {
          soundSystem.playUiClick();
          this.selectLevel(lvl.id);
        });

        grid.appendChild(card);
      });

      container.appendChild(grid);
    });
  }

  // Export Arena global window.__ARENA_GAME__
  exportArenaGlobal() {
    window.__ARENA_GAME__ = {
      reset: (seed) => {
        const snap = this.engine.reset(seed);
        this.renderer.renderImmediate();
        this.updateHud();
        return snap;
      },
      snapshot: () => {
        return this.engine.snapshot();
      },
      act: (action) => {
        const snap = this.engine.act(action);
        this.renderer.renderImmediate();
        this.updateHud();
        return snap;
      },
      restart: () => {
        const snap = this.engine.restart();
        this.renderer.renderImmediate();
        this.updateHud();
        return snap;
      }
    };
  }

  // Parent Bridge protocol arena.game.v1
  initArenaBridge() {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.protocol !== "arena.game.v1") return;

      if (data.type === "connect") {
        const { sessionId, generation } = data;
        const port = event.ports && event.ports[0];
        if (!port) return;

        this.bindBridgePort(port, sessionId, generation);
      }
    });
  }

  bindBridgePort(port, sessionId, generation) {
    const snap = this.engine.snapshot();
    this.renderer.renderImmediate();

    // Send ready envelope
    port.postMessage({
      protocol: "arena.game.v1",
      type: "ready",
      sessionId,
      generation,
      accepted: true,
      revision: snap.revision,
      ...snap
    });

    port.onmessage = (event) => {
      const req = event.data;
      if (!req || req.protocol !== "arena.game.v1" || req.sessionId !== sessionId || req.generation !== generation) {
        return;
      }

      const { requestId, command } = req;

      if (command === "observe") {
        const curSnap = this.engine.snapshot();
        port.postMessage({
          protocol: "arena.game.v1",
          type: "response",
          requestId,
          sessionId,
          generation,
          accepted: true,
          revision: curSnap.revision,
          ...curSnap
        });
      } else if (command === "act") {
        if (req.expectedRevision !== undefined && req.expectedRevision !== this.engine.revision) {
          const curSnap = this.engine.snapshot();
          port.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId,
            sessionId,
            generation,
            accepted: false,
            revision: curSnap.revision,
            ...curSnap,
            error: { code: "STALE_REVISION", message: `Expected revision ${req.expectedRevision}, got ${this.engine.revision}` }
          });
          return;
        }

        try {
          const newSnap = this.engine.act(req.action);
          this.renderer.renderImmediate();
          this.updateHud();
          port.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId,
            sessionId,
            generation,
            accepted: true,
            revision: newSnap.revision,
            ...newSnap
          });
        } catch (err) {
          const curSnap = this.engine.snapshot();
          port.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId,
            sessionId,
            generation,
            accepted: false,
            revision: curSnap.revision,
            ...curSnap,
            error: { code: err.code || "ILLEGAL_ACTION", message: err.message || "Action failed" }
          });
        }
      } else if (command === "restart") {
        if (req.expectedRevision !== undefined && req.expectedRevision !== this.engine.revision) {
          const curSnap = this.engine.snapshot();
          port.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId,
            sessionId,
            generation,
            accepted: false,
            revision: curSnap.revision,
            ...curSnap,
            error: { code: "STALE_REVISION", message: `Expected revision ${req.expectedRevision}, got ${this.engine.revision}` }
          });
          return;
        }

        const newSnap = this.engine.restart();
        this.renderer.renderImmediate();
        this.updateHud();
        port.postMessage({
          protocol: "arena.game.v1",
          type: "response",
          requestId,
          sessionId,
          generation,
          accepted: true,
          revision: newSnap.revision,
          ...newSnap
        });
      }
    };
  }
}

// Instantiate on window load
window.addEventListener("DOMContentLoaded", () => {
  window.__lumen_game_instance__ = new LumenYardGame();
});
