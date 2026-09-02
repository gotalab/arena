/**
 * SHOAL - Main Entrypoint & UI Controller
 */

import { ShoalGame, RANK_LADDER } from './game.js';
import { sound } from './audio.js';

// SVG Assets inlined
const SVG_URCHIN = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-icon">
  <circle cx="16" cy="16" r="7" fill="#a855f7" stroke="#e9d5ff" stroke-width="1.5"/>
  <path d="M16 2V7 M16 25V30 M2 16H7 M25 16H30 M6 6L9.5 9.5 M22.5 22.5L26 26 M6 26L9.5 22.5 M22.5 9.5L26 6" stroke="#c084fc" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const SVG_PEARL = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="stat-icon">
  <circle cx="16" cy="16" r="9" fill="url(#pearlGrad)" stroke="#ffffff" stroke-width="1.5"/>
  <circle cx="13" cy="12" r="3" fill="#ffffff" fill-opacity="0.8"/>
  <defs>
    <radialGradient id="pearlGrad" cx="0.4" cy="0.4" r="0.6">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#eab308"/>
    </radialGradient>
  </defs>
</svg>`;

const SVG_FLAG = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="pennant-icon">
  <path d="M9 4V28" stroke="#fef08a" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M9 5L24 10L9 16V5Z" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="9" cy="4" r="2" fill="#ffffff"/>
</svg>`;

const SVG_FLAG_WRONG = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="pennant-icon">
  <path d="M9 4V28" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
  <path d="M9 5L24 10L9 16V5Z" fill="#64748b" stroke="#475569" stroke-width="1.5"/>
  <path d="M6 6L26 26 M26 6L6 26" stroke="#f43f5e" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const SVG_FLAG_CORRECT = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="pennant-icon">
  <path d="M9 4V28" stroke="#a7f3d0" stroke-width="2" stroke-linecap="round"/>
  <path d="M9 5L24 10L9 16V5Z" fill="#10b981" stroke="#059669" stroke-width="1.5"/>
  <circle cx="16" cy="16" r="10" stroke="#34d399" stroke-width="2.5" stroke-dasharray="2 2"/>
</svg>`;

const SVG_FATAL_URCHIN = `
<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" class="pennant-icon">
  <circle cx="16" cy="16" r="8" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
  <path d="M16 1V7 M16 25V31 M1 16H7 M25 16H31 M5 5L9.5 9.5 M22.5 22.5L27 27 M5 27L9.5 22.5 M22.5 9.5L27 5" stroke="#fca5a5" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M11 11L21 21 M21 11L11 21" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
</svg>`;

class GameApp {
  constructor() {
    this.game = new ShoalGame();
    this.cursorX = 0;
    this.cursorY = 0;
    this.holdTimer = null;
    this.holdThreshold = 360; // ms for long press
    this.touchMoved = false;
    this.touchStartX = 0;
    this.touchStartY = 0;

    // Barnaby host creature state
    this.hostMood = 'curious'; // curious | delighted | tense | stung | celebrate
    this.hostMoodTimer = 0;
    this.hostLookTarget = { x: 0.5, y: 0.5 };

    this.initDOM();
    this.initCaustics();
    this.initHostCanvas();
    this.bindEvents();
    this.bindArenaBridge();

    // Hook game changes
    this.game.onStateChange((snap) => this.render(snap));
    this.game.onVisualEvent((evt) => this.handleVisualEvent(evt));

    // Expose runtime interface
    this.exposeRuntimeInterface();

    // Initial render
    this.render(this.game.getSnapshot());

    // Start 60Hz loop for clock & animation
    this.startMainLoop();
  }

  initDOM() {
    this.appEl = document.getElementById('app');
    this.boardEl = document.getElementById('board');
    this.poolBadgeEl = document.getElementById('pool-badge');
    this.urchinValEl = document.getElementById('urchin-val');
    this.pearlValEl = document.getElementById('pearl-val');
    this.tideFillEl = document.getElementById('tide-fill');
    this.titlePromptEl = document.getElementById('title-prompt');
    this.ceremonyOverlayEl = document.getElementById('ceremony-overlay');
    this.soundToggleBtn = document.getElementById('sound-toggle');

    // Ceremony elements
    this.ceremonyRankEl = document.getElementById('ceremony-rank');
    this.ceremonyPearlsEl = document.getElementById('ceremony-pearls');
    this.ceremonyBestEl = document.getElementById('ceremony-best');
    this.ceremonySignatureValEl = document.getElementById('signature-val');
    this.ceremonySignatureLabelEl = document.getElementById('signature-label');
  }

  initCaustics() {
    this.causticsCanvas = document.getElementById('caustics-canvas');
    this.causticsCtx = this.causticsCanvas.getContext('2d');
    this.resizeCaustics();
    window.addEventListener('resize', () => this.resizeCaustics());
  }

  resizeCaustics() {
    if (!this.causticsCanvas) return;
    this.causticsCanvas.width = window.innerWidth;
    this.causticsCanvas.height = window.innerHeight;
  }

  initHostCanvas() {
    this.hostCanvas = document.getElementById('host-canvas');
    this.hostCtx = this.hostCanvas.getContext('2d');
    this.hostCanvas.width = 160;
    this.hostCanvas.height = 160;
  }

  exposeRuntimeInterface() {
    window.__ARENA_GAME__ = {
      reset: (seed) => this.game.reset(seed),
      snapshot: () => this.game.getSnapshot(),
      act: (action) => {
        const res = this.game.act(action);
        return this.game.getSnapshot();
      },
      restart: () => this.game.restart(),
      advance: (ms) => this.game.advance(ms)
    };
  }

  bindArenaBridge() {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.protocol !== 'arena.game.v1' || data.type !== 'connect') return;

      const { sessionId, generation } = data;
      const port = event.ports && event.ports[0];
      if (!port) return;

      // Post ready envelope
      port.postMessage({
        protocol: 'arena.game.v1',
        type: 'ready',
        sessionId,
        generation,
        accepted: true,
        revision: this.game.getSnapshot().revision,
        state: this.game.getBridgeState()
      });

      port.onmessage = (msgEvent) => {
        const req = msgEvent.data;
        if (!req || req.protocol !== 'arena.game.v1') return;
        if (req.sessionId !== sessionId || req.generation !== generation) return;

        const { requestId, command, expectedRevision, action } = req;

        if (command === 'observe') {
          port.postMessage({
            protocol: 'arena.game.v1',
            type: 'response',
            requestId,
            sessionId,
            generation,
            accepted: true,
            revision: this.game.getSnapshot().revision,
            state: this.game.getBridgeState()
          });
        } else if (command === 'act') {
          const curRev = this.game.getSnapshot().revision;
          if (expectedRevision !== curRev) {
            port.postMessage({
              protocol: 'arena.game.v1',
              type: 'response',
              requestId,
              sessionId,
              generation,
              accepted: false,
              revision: curRev,
              state: this.game.getBridgeState(),
              error: { code: 'STALE_REVISION', message: `Expected revision ${expectedRevision}, got ${curRev}` }
            });
            return;
          }

          const res = this.game.act(action);
          if (!res.success) {
            port.postMessage({
              protocol: 'arena.game.v1',
              type: 'response',
              requestId,
              sessionId,
              generation,
              accepted: false,
              revision: this.game.getSnapshot().revision,
              state: this.game.getBridgeState(),
              error: { code: 'ILLEGAL_ACTION', message: res.error || 'Action rejected' }
            });
            return;
          }

          port.postMessage({
            protocol: 'arena.game.v1',
            type: 'response',
            requestId,
            sessionId,
            generation,
            accepted: true,
            revision: this.game.getSnapshot().revision,
            state: this.game.getBridgeState()
          });
        } else if (command === 'restart') {
          const curRev = this.game.getSnapshot().revision;
          if (expectedRevision !== curRev) {
            port.postMessage({
              protocol: 'arena.game.v1',
              type: 'response',
              requestId,
              sessionId,
              generation,
              accepted: false,
              revision: curRev,
              state: this.game.getBridgeState(),
              error: { code: 'STALE_REVISION', message: `Expected revision ${expectedRevision}, got ${curRev}` }
            });
            return;
          }

          this.game.restart();
          port.postMessage({
            protocol: 'arena.game.v1',
            type: 'response',
            requestId,
            sessionId,
            generation,
            accepted: true,
            revision: this.game.getSnapshot().revision,
            state: this.game.getBridgeState()
          });
        }
      };
    });
  }

  bindEvents() {
    // Sound toggle
    this.soundToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isMuted = sound.toggleMute();
      this.soundToggleBtn.style.opacity = isMuted ? '0.35' : '0.85';
    });

    // Keyboard support
    window.addEventListener('keydown', (e) => {
      sound.init();
      if (e.key === 'r' || e.key === 'R') {
        this.game.restart();
        return;
      }

      const snap = this.game.getSnapshot();
      if (snap.phase === 'ended') {
        if (e.key === ' ' || e.key === 'Enter') {
          this.game.restart();
        }
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        this.cursorY = Math.max(0, this.cursorY - 1);
        this.updateKeyboardFocus();
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        this.cursorY = Math.min(snap.gridHeight - 1, this.cursorY + 1);
        this.updateKeyboardFocus();
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        this.cursorX = Math.max(0, this.cursorX - 1);
        this.updateKeyboardFocus();
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        this.cursorX = Math.min(snap.gridWidth - 1, this.cursorX + 1);
        this.updateKeyboardFocus();
      } else if (e.key === ' ' || e.key === 'Enter') {
        const cell = this.game.cells[this.cursorY][this.cursorX];
        if (cell.status === 'covered') {
          this.game.act({ type: 'open', x: this.cursorX, y: this.cursorY });
        } else if (cell.status === 'open') {
          this.game.act({ type: 'sweep', x: this.cursorX, y: this.cursorY });
        }
      } else if (e.key === 'f' || e.key === 'F') {
        const cell = this.game.cells[this.cursorY][this.cursorX];
        if (cell.status === 'covered') {
          this.game.act({ type: 'flag', x: this.cursorX, y: this.cursorY });
        } else if (cell.status === 'flagged') {
          this.game.act({ type: 'unflag', x: this.cursorX, y: this.cursorY });
        }
      }
    });

    // Ceremony click to restart
    this.ceremonyOverlayEl.addEventListener('click', () => {
      sound.init();
      this.game.restart();
    });

    // Suppress context menu on board
    this.boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  updateKeyboardFocus() {
    const cells = this.boardEl.querySelectorAll('.shell-cell');
    cells.forEach((cell) => {
      const cx = parseInt(cell.dataset.x, 10);
      const cy = parseInt(cell.dataset.y, 10);
      if (cx === this.cursorX && cy === this.cursorY) {
        cell.classList.add('focused');
      } else {
        cell.classList.remove('focused');
      }
    });
  }

  handleCellInteraction(x, y, isRightClick = false, isLongPress = false) {
    sound.init();
    const cell = this.game.cells[y][x];
    const snap = this.game.getSnapshot();

    if (snap.phase === 'ended') return;

    if (isRightClick || isLongPress) {
      if (cell.status === 'covered') {
        this.game.act({ type: 'flag', x, y });
      } else if (cell.status === 'flagged') {
        this.game.act({ type: 'unflag', x, y });
      }
      return;
    }

    // Normal tap / left click
    if (cell.status === 'covered') {
      this.game.act({ type: 'open', x, y });
    } else if (cell.status === 'open') {
      this.game.act({ type: 'sweep', x, y });
    }
  }

  render(snap) {
    // Top Bar HUD
    this.poolBadgeEl.textContent = `Pool ${snap.pool}`;
    this.urchinValEl.textContent = `${snap.urchinsLeft}`;
    this.pearlValEl.textContent = `${snap.pearls}`;

    // Tide Meter
    const tidePct = Math.max(0, Math.min(100, snap.tideFraction * 100));
    this.tideFillEl.style.width = `${tidePct}%`;
    if (snap.tideFraction < 0.25) {
      this.tideFillEl.classList.add('tide-low');
    } else {
      this.tideFillEl.classList.remove('tide-low');
    }

    // Title Prompt
    if (snap.firstTurnDone || snap.phase !== 'ready') {
      this.titlePromptEl.classList.add('hidden');
    } else {
      this.titlePromptEl.classList.remove('hidden');
    }

    // Board Grid
    this.boardEl.style.gridTemplateColumns = `repeat(${snap.gridWidth}, 1fr)`;
    this.boardEl.style.gridTemplateRows = `repeat(${snap.gridHeight}, 1fr)`;
    this.boardEl.innerHTML = '';

    for (let y = 0; y < snap.gridHeight; y++) {
      for (let x = 0; x < snap.gridWidth; x++) {
        const char = snap.rows[y][x];
        const cellEl = document.createElement('div');
        cellEl.className = 'shell-cell';
        cellEl.dataset.x = x;
        cellEl.dataset.y = y;

        if (x === this.cursorX && y === this.cursorY) {
          cellEl.classList.add('focused');
        }

        if (char === '#') {
          cellEl.classList.add('covered');
        } else if (char === 'F') {
          cellEl.classList.add('flagged');
          cellEl.innerHTML = SVG_FLAG;
        } else if (char === '*') {
          cellEl.classList.add('urchin-revealed');
          cellEl.innerHTML = SVG_URCHIN;
        } else if (char === 'X') {
          cellEl.classList.add('fatal-sting');
          cellEl.innerHTML = SVG_FATAL_URCHIN;
        } else if (char === '+') {
          cellEl.classList.add('flag-correct');
          cellEl.innerHTML = SVG_FLAG_CORRECT;
        } else if (char === '-') {
          cellEl.classList.add('flag-wrong');
          cellEl.innerHTML = SVG_FLAG_WRONG;
        } else {
          // Open number '0' - '8'
          cellEl.classList.add('open');
          const num = parseInt(char, 10);
          if (num > 0) {
            cellEl.innerHTML = `<span class="num num-${num}">${num}</span>`;
            // Check sweepable
            const neighbors = this.game.cells ? this.game.cells[y][x] : null;
            cellEl.classList.add('sweepable');
          }
        }

        this.bindCellTouchEvents(cellEl, x, y);
        this.boardEl.appendChild(cellEl);
      }
    }

    // Host mood updates
    this.updateHostMood(snap);

    // Ceremony Overlay
    if (snap.phase === 'ended') {
      this.ceremonyRankEl.textContent = snap.rank || 'Driftwood';
      this.ceremonyPearlsEl.textContent = snap.pearls;
      this.ceremonyBestEl.textContent = snap.sessionBest;

      // Select signature stat
      if (this.game.stats.greatestRipple > 8) {
        this.ceremonySignatureLabelEl.textContent = 'Greatest Ripple';
        this.ceremonySignatureValEl.textContent = `${this.game.stats.greatestRipple} shells`;
      } else {
        this.ceremonySignatureLabelEl.textContent = 'Deepest Pool';
        this.ceremonySignatureValEl.textContent = `Pool ${this.game.stats.deepestPool}`;
      }

      this.ceremonyOverlayEl.style.display = 'flex';
    } else {
      this.ceremonyOverlayEl.style.display = 'none';
    }
  }

  bindCellTouchEvents(cellEl, x, y) {
    let chargeIndicator = null;
    let holdTimeout = null;

    const startCharge = () => {
      if (chargeIndicator) chargeIndicator.remove();
      chargeIndicator = document.createElement('div');
      chargeIndicator.className = 'charge-indicator';
      cellEl.appendChild(chargeIndicator);
    };

    const clearCharge = () => {
      if (chargeIndicator) {
        chargeIndicator.remove();
        chargeIndicator = null;
      }
      if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
      }
    };

    // Pointer Down
    cellEl.addEventListener('pointerdown', (e) => {
      this.cursorX = x;
      this.cursorY = y;
      this.touchStartX = e.clientX;
      this.touchStartY = e.clientY;
      this.touchMoved = false;

      this.hostLookTarget = {
        x: x / (this.game.gridWidth || 1),
        y: y / (this.game.gridHeight || 1)
      };

      if (e.button === 2) {
        // Right click
        e.preventDefault();
        this.handleCellInteraction(x, y, true, false);
        return;
      }

      // Start hold timer for long press
      startCharge();
      holdTimeout = setTimeout(() => {
        if (!this.touchMoved) {
          clearCharge();
          this.handleCellInteraction(x, y, false, true);
        }
      }, this.holdThreshold);
    });

    cellEl.addEventListener('pointermove', (e) => {
      const dx = Math.abs(e.clientX - this.touchStartX);
      const dy = Math.abs(e.clientY - this.touchStartY);
      if (dx > 10 || dy > 10) {
        this.touchMoved = true;
        clearCharge();
      }
    });

    cellEl.addEventListener('pointerup', (e) => {
      if (e.button === 2) return;
      if (!this.touchMoved && holdTimeout) {
        clearCharge();
        this.handleCellInteraction(x, y, false, false);
      } else {
        clearCharge();
      }
    });

    cellEl.addEventListener('pointercancel', () => clearCharge());
    cellEl.addEventListener('pointerleave', () => clearCharge());
  }

  handleVisualEvent(evt) {
    if (evt.type === 'open_cascade' || evt.type === 'sweep') {
      const { origin } = evt;
      if (origin) {
        const originEl = this.boardEl.querySelector(`[data-x="${origin.x}"][data-y="${origin.y}"]`);
        if (originEl) {
          const rect = originEl.getBoundingClientRect();
          const boardRect = this.boardEl.getBoundingClientRect();
          const wave = document.createElement('div');
          wave.className = 'ripple-wave';
          wave.style.left = `${rect.left - boardRect.left + rect.width / 2}px`;
          wave.style.top = `${rect.top - boardRect.top + rect.height / 2}px`;
          this.boardEl.appendChild(wave);
          setTimeout(() => wave.remove(), 600);
        }
      }

      if (evt.cells && evt.cells.length > 5) {
        this.setHostMood('delighted', 120);
      }
    } else if (evt.type === 'sting') {
      this.setHostMood('stung', 300);
    } else if (evt.type === 'pool_clear') {
      this.setHostMood('celebrate', 150);
    }
  }

  setHostMood(mood, durationFrames = 90) {
    this.hostMood = mood;
    this.hostMoodTimer = durationFrames;
  }

  updateHostMood(snap) {
    if (this.hostMoodTimer > 0) {
      this.hostMoodTimer--;
      return;
    }

    if (snap.phase === 'ended') {
      this.hostMood = 'stung';
      return;
    }

    // Check how many safe shells remain
    let unrevealedSafe = 0;
    for (let y = 0; y < snap.gridHeight; y++) {
      for (let x = 0; x < snap.gridWidth; x++) {
        const c = this.game.cells[y][x];
        if (!c.isMine && c.status !== 'open') unrevealedSafe++;
      }
    }

    if (unrevealedSafe <= 4 && snap.firstTurnDone) {
      this.hostMood = 'tense';
    } else {
      this.hostMood = 'curious';
    }
  }

  startMainLoop() {
    let lastTime = performance.now();
    let tickAccumulator = 0;
    const TICK_MS = 1000 / 60;

    const frame = (time) => {
      const dt = time - lastTime;
      lastTime = time;

      tickAccumulator += dt;
      while (tickAccumulator >= TICK_MS) {
        this.game.stepSimTick();
        tickAccumulator -= TICK_MS;
      }

      this.renderCaustics(time);
      this.renderHostCreature(time);

      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);
  }

  renderCaustics(time) {
    const ctx = this.causticsCtx;
    const w = this.causticsCanvas.width;
    const h = this.causticsCanvas.height;
    if (!ctx || w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.15)';
    ctx.lineWidth = 1.5;

    const t = time * 0.001;
    ctx.beginPath();
    for (let y = 0; y < h; y += 40) {
      ctx.moveTo(0, y);
      for (let x = 0; x < w; x += 20) {
        const wave = Math.sin(x * 0.015 + t) * Math.cos(y * 0.015 + t * 0.8) * 12;
        ctx.lineTo(x, y + wave);
      }
    }
    ctx.stroke();
  }

  renderHostCreature(time) {
    const ctx = this.hostCtx;
    const w = this.hostCanvas.width;
    const h = this.hostCanvas.height;
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    const t = time * 0.003;
    const cx = w / 2;
    const cy = h / 2 + 10;

    // Gentle breathing bob
    const bob = Math.sin(t * 2) * 3;

    ctx.save();
    ctx.translate(cx, cy + bob);

    // Shell (Coral Nautilus shell)
    const shellGrad = ctx.createRadialGradient(-10, -10, 5, 0, 0, 38);
    shellGrad.addColorStop(0, '#fda4af');
    shellGrad.addColorStop(0.6, '#f43f5e');
    shellGrad.addColorStop(1, '#9f1239');

    ctx.fillStyle = shellGrad;
    ctx.beginPath();
    ctx.arc(0, -6, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffe4e6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shell spiral ridges
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.arc(0, -6, 20, 0.2, Math.PI * 1.5);
    ctx.stroke();

    // Crab body & legs
    ctx.fillStyle = '#fb923c';
    // Left leg
    ctx.beginPath();
    ctx.ellipse(-24, 16, 6, 12, -0.4 + Math.sin(t * 4) * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // Right leg
    ctx.beginPath();
    ctx.ellipse(24, 16, 6, 12, 0.4 - Math.sin(t * 4) * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Claws
    let clawL_Y = 2;
    let clawR_Y = 2;
    let clawAngle = 0;

    if (this.hostMood === 'delighted' || this.hostMood === 'celebrate') {
      clawL_Y = -18 + Math.sin(t * 8) * 4;
      clawR_Y = -18 - Math.sin(t * 8) * 4;
      clawAngle = 0.5;
    } else if (this.hostMood === 'tense') {
      clawL_Y = -6;
      clawR_Y = -6;
      clawAngle = -0.3;
    } else if (this.hostMood === 'stung') {
      clawL_Y = 14;
      clawR_Y = 14;
    }

    // Left Claw
    ctx.save();
    ctx.translate(-26, clawL_Y);
    ctx.rotate(-0.4 - clawAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Right Claw
    ctx.save();
    ctx.translate(26, clawR_Y);
    ctx.rotate(0.4 + clawAngle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eye stalks
    ctx.fillStyle = '#fdba74';
    ctx.fillRect(-14, -28, 6, 16);
    ctx.fillRect(8, -28, 6, 16);

    // Eyes
    const eyePupilShiftX = (this.hostLookTarget.x - 0.5) * 4;
    const eyePupilShiftY = (this.hostLookTarget.y - 0.5) * 4;

    // Eye whites
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-11, -30, 9, 0, Math.PI * 2);
    ctx.arc(11, -30, 9, 0, Math.PI * 2);
    ctx.fill();

    if (this.hostMood === 'stung') {
      // Swirly dizzy eyes
      ctx.strokeStyle = '#9f1239';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-11, -30, 5, 0, Math.PI * 1.6);
      ctx.arc(11, -30, 5, 0, Math.PI * 1.6);
      ctx.stroke();
    } else if (this.hostMood === 'tense') {
      // Wide tiny pupils
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-11, -30, 3, 0, Math.PI * 2);
      ctx.arc(11, -30, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal cute eyes
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-11 + eyePupilShiftX, -30 + eyePupilShiftY, 4.5, 0, Math.PI * 2);
      ctx.arc(11 + eyePupilShiftX, -30 + eyePupilShiftY, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Eye glint
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-13 + eyePupilShiftX, -32 + eyePupilShiftY, 1.8, 0, Math.PI * 2);
      ctx.arc(9 + eyePupilShiftX, -32 + eyePupilShiftY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// Start on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new GameApp();
});
