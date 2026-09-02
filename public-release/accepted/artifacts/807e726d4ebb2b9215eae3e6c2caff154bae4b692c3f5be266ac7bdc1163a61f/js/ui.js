// SHOAL - User Interface, Viewport Responsive Grid, Input Handling, Effects

class ShoalUI {
  constructor(game) {
    this.game = game;

    // DOM references
    this.appContainer = document.getElementById("app-container");
    this.boardWrap = document.getElementById("board-wrap");
    this.boardEl = document.getElementById("board");
    this.urchinCountEl = document.getElementById("urchin-count");
    this.pearlCountEl = document.getElementById("pearl-count");
    this.bestCountEl = document.getElementById("best-count");
    this.poolBadgeEl = document.getElementById("pool-badge");
    this.tideFillEl = document.getElementById("tide-fill");
    this.hintTextEl = document.getElementById("hint-text");
    this.ceremonyOverlay = document.getElementById("ceremony-overlay");
    this.clearToastEl = document.getElementById("clear-toast");
    this.holdRingSvg = document.getElementById("hold-ring-svg");
    this.holdRingCircle = document.getElementById("hold-ring-circle");
    this.audioBtn = document.getElementById("audio-btn");
    this.restartBtn = document.getElementById("restart-btn");

    // Canvas hosts
    this.hostCanvas = document.getElementById("host-canvas");
    this.host = new PoolHost(this.hostCanvas);

    this.causticCanvas = document.getElementById("caustic-canvas");
    this.causticCtx = this.causticCanvas.getContext("2d");

    // Input state
    this.pointerDownTarget = null;
    this.pointerStartTime = 0;
    this.pointerStartX = 0;
    this.pointerStartY = 0;
    this.holdTimer = null;
    this.holdTriggered = false;
    this.selectedCell = { x: 0, y: 0 };

    // Water animation parameters
    this.causticTime = 0;
    this.particles = [];
    this.initWaterParticles();

    // Setup events
    this.setupResize();
    this.setupInputs();
    this.setupButtons();
    this.setupAudioTrigger();

    // Start render loops
    this.lastFrameTime = performance.now();
    this.startAnimationLoop();

    // Initial render
    this.render();
  }

  setupResize() {
    const handleResize = () => {
      this.causticCanvas.width = window.innerWidth;
      this.causticCanvas.height = window.innerHeight;
      this.updateCellSize();
    };
    window.addEventListener("resize", handleResize);
    handleResize();
  }

  updateCellSize() {
    const w = this.game.gridWidth;
    const h = this.game.gridHeight;

    const availWidth = Math.min(window.innerWidth - 28, 480);
    const availHeight = window.innerHeight - 175;

    const cellW = (availWidth - (w - 1) * 3) / w;
    const cellH = (availHeight - (h - 1) * 3) / h;
    const size = Math.floor(Math.max(26, Math.min(cellW, cellH, 50)));

    document.documentElement.style.setProperty("--cell-size", `${size}px`);
    this.boardEl.style.gridTemplateColumns = `repeat(${w}, ${size}px)`;
    this.boardEl.style.gridTemplateRows = `repeat(${h}, ${size}px)`;
  }

  initWaterParticles() {
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        radius: 1 + Math.random() * 2.5,
        speedY: -0.2 - Math.random() * 0.4,
        speedX: (Math.random() - 0.5) * 0.3,
        alpha: 0.15 + Math.random() * 0.3
      });
    }
  }

  setupAudioTrigger() {
    const initOnce = () => {
      AudioEngine.init();
      window.removeEventListener("pointerdown", initOnce);
      window.removeEventListener("keydown", initOnce);
    };
    window.addEventListener("pointerdown", initOnce);
    window.addEventListener("keydown", initOnce);
  }

  setupButtons() {
    if (this.audioBtn) {
      this.audioBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        AudioEngine.init();
        const muted = AudioEngine.toggleMute();
        this.audioBtn.textContent = muted ? "🔇" : "🔊";
      });
    }

    if (this.restartBtn) {
      this.restartBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.restartGame();
      });
    }

    this.ceremonyOverlay.addEventListener("click", () => {
      this.restartGame();
    });
  }

  restartGame() {
    AudioEngine.init();
    AudioEngine.playShellTick();
    this.ceremonyOverlay.classList.remove("active");
    if (window.__ARENA_GAME__) {
      window.__ARENA_GAME__.restart();
    } else {
      this.game.restart();
      this.render();
    }
  }

  setupInputs() {
    // Prevent default context menu on playfield
    this.boardEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Touch & Pointer handling with press-and-hold radial ring
    this.boardEl.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell || this.game.phase === "ended") return;

      const x = parseInt(cell.dataset.x, 10);
      const y = parseInt(cell.dataset.y, 10);

      this.pointerDownTarget = { x, y, el: cell };
      this.pointerStartTime = performance.now();
      this.pointerStartX = e.clientX;
      this.pointerStartY = e.clientY;
      this.holdTriggered = false;

      // Handle Right Click immediately (Desktop)
      if (e.button === 2) {
        e.preventDefault();
        this.handleRightClick(x, y);
        return;
      }

      // Start hold timer for touch / trackpad hold
      const idx = y * this.game.gridWidth + x;
      const isCoveredOrFlagged = this.game.revealed[idx] === 0;

      if (isCoveredOrFlagged) {
        this.startHoldIndicator(cell);
        this.holdTimer = setTimeout(() => {
          this.holdTriggered = true;
          this.stopHoldIndicator();
          this.toggleFlag(x, y);
        }, 420);
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (!this.pointerDownTarget) return;
      const dx = e.clientX - this.pointerStartX;
      const dy = e.clientY - this.pointerStartY;
      // Cancel-by-drag: guard against stray thumb
      if (Math.hypot(dx, dy) > 12) {
        this.cancelHold();
      }
    });

    window.addEventListener("pointerup", (e) => {
      if (!this.pointerDownTarget) return;
      this.stopHoldIndicator();

      if (!this.holdTriggered && e.button !== 2) {
        const { x, y } = this.pointerDownTarget;
        this.handleTap(x, y);
      }

      this.pointerDownTarget = null;
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    });

    window.addEventListener("pointercancel", () => {
      this.cancelHold();
    });

    // Keyboard support: R restarts, Arrows navigate, Space/Enter turns, F flags, S sweeps
    window.addEventListener("keydown", (e) => {
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        this.restartGame();
        return;
      }

      if (this.game.phase === "ended") return;

      const w = this.game.gridWidth;
      const h = this.game.gridHeight;

      if (e.key === "ArrowUp") {
        this.selectedCell.y = Math.max(0, this.selectedCell.y - 1);
        this.highlightFocusedCell();
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        this.selectedCell.y = Math.min(h - 1, this.selectedCell.y + 1);
        this.highlightFocusedCell();
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        this.selectedCell.x = Math.max(0, this.selectedCell.x - 1);
        this.highlightFocusedCell();
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        this.selectedCell.x = Math.min(w - 1, this.selectedCell.x + 1);
        this.highlightFocusedCell();
        e.preventDefault();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        this.handleTap(this.selectedCell.x, this.selectedCell.y);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        this.toggleFlag(this.selectedCell.x, this.selectedCell.y);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        this.handleSweep(this.selectedCell.x, this.selectedCell.y);
      }
    });
  }

  startHoldIndicator(cell) {
    if (!this.holdRingSvg) return;
    const rect = cell.getBoundingClientRect();
    this.holdRingSvg.style.display = "block";
    this.holdRingSvg.style.left = `${rect.left + rect.width / 2}px`;
    this.holdRingSvg.style.top = `${rect.top + rect.height / 2}px`;
    this.holdRingCircle.style.transition = "stroke-dashoffset 0.42s linear";
    this.holdRingCircle.style.strokeDashoffset = "0";
  }

  stopHoldIndicator() {
    if (!this.holdRingSvg) return;
    this.holdRingCircle.style.transition = "none";
    this.holdRingCircle.style.strokeDashoffset = "126";
    this.holdRingSvg.style.display = "none";
  }

  cancelHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.pointerDownTarget = null;
    this.stopHoldIndicator();
  }

  highlightFocusedCell() {
    const all = this.boardEl.querySelectorAll(".cell");
    all.forEach(c => c.style.outline = "none");
    const target = this.boardEl.querySelector(`.cell[data-x="${this.selectedCell.x}"][data-y="${this.selectedCell.y}"]`);
    if (target) {
      target.style.outline = "2px solid #38bdf8";
    }
  }

  handleTap(x, y) {
    const idx = y * this.game.gridWidth + x;
    const isRevealed = this.game.revealed[idx] === 1;

    if (isRevealed) {
      // Tap on a turned number to sweep
      this.handleSweep(x, y);
    } else {
      // Tap on covered shell to turn
      if (this.game.flagged[idx] === 1) {
        // Pennanted shell cannot be turned
        return;
      }
      this.executeAction({ type: "open", x, y });
    }
  }

  handleRightClick(x, y) {
    this.toggleFlag(x, y);
  }

  toggleFlag(x, y) {
    const idx = y * this.game.gridWidth + x;
    if (this.game.revealed[idx] === 1) return;

    if (this.game.flagged[idx] === 1) {
      this.executeAction({ type: "unflag", x, y });
    } else {
      this.executeAction({ type: "flag", x, y });
    }
  }

  handleSweep(x, y) {
    this.executeAction({ type: "sweep", x, y });
  }

  executeAction(action) {
    if (window.__ARENA_GAME__) {
      window.__ARENA_GAME__.act(action);
    } else {
      const res = this.game.act(action);
      this.render();
      this.handleActionResult(action, res);
    }
  }

  handleActionResult(action, result) {
    if (!result || !result.accepted) return;

    // Check sting
    if (this.game.phase === "ended") {
      AudioEngine.playSting();
      this.host.onStung();
      this.appContainer.classList.add("screen-shake");
      setTimeout(() => this.appContainer.classList.remove("screen-shake"), 400);
      this.showCeremony();
      return;
    }

    // Check pool cleared
    const lastEvent = this.game.lastEvent;
    if (lastEvent && lastEvent.kind === "pool_clear") {
      AudioEngine.playPoolClear();
      this.host.onClear();
      this.showClearToast(lastEvent.pool);
      return;
    }

    if (action.type === "open") {
      if (result.opened && result.opened > 1) {
        AudioEngine.playRipple(Math.min(result.opened, 8));
        this.host.onRipple(result.opened);
      } else {
        AudioEngine.playShellTick();
      }
    } else if (action.type === "sweep") {
      AudioEngine.playSweep();
      if (result.opened && result.opened > 3) {
        this.host.onRipple(result.opened);
      }
    } else if (action.type === "flag") {
      AudioEngine.playFlagPlant();
    } else if (action.type === "unflag") {
      AudioEngine.playFlagLift();
    }

    // Check if remaining shells are low (tense mood)
    const unrevealedSafe = this.game.gridWidth * this.game.gridHeight - this.game.urchinsTotal - this.countRevealed();
    if (unrevealedSafe <= 4 && unrevealedSafe > 0) {
      this.host.onTense();
    }
  }

  countRevealed() {
    let count = 0;
    for (let i = 0; i < this.game.revealed.length; i++) {
      if (this.game.revealed[i] === 1) count++;
    }
    return count;
  }

  showClearToast(pool) {
    this.clearToastEl.textContent = `🌊 Tide ${pool} Cleared! Rising deeper...`;
    this.clearToastEl.classList.add("show");
    setTimeout(() => {
      this.clearToastEl.classList.remove("show");
    }, 1800);
  }

  showCeremony() {
    const ceremonyRank = document.getElementById("ceremony-rank");
    const ceremonyPearls = document.getElementById("ceremony-pearls");
    const ceremonyBest = document.getElementById("ceremony-best");
    const ceremonySigVal = document.getElementById("ceremony-sig-val");

    if (ceremonyRank) ceremonyRank.textContent = this.game.rank || "Driftwood";
    if (ceremonyPearls) ceremonyPearls.textContent = `⚪ ${this.game.pearls}`;
    if (ceremonyBest) ceremonyBest.textContent = `⚪ ${this.game.sessionBest}`;
    if (ceremonySigVal) {
      ceremonySigVal.textContent = `🌊 ${this.game.maxRipple || 1} Shells`;
    }

    setTimeout(() => {
      this.ceremonyOverlay.classList.add("active");
    }, 600);
  }

  onRestart() {
    this.ceremonyOverlay.classList.remove("active");
    this.host.setMood("idle");
    this.render();
  }

  render() {
    const snap = this.game.snapshot();

    // Update Header counters
    this.urchinCountEl.textContent = snap.urchinsLeft;
    this.pearlCountEl.textContent = snap.pearls;
    this.bestCountEl.textContent = snap.sessionBest;
    this.poolBadgeEl.textContent = `TIDE ${snap.pool}`;

    // Tide Meter
    const pct = Math.max(0, Math.min(100, snap.tideFraction * 100));
    this.tideFillEl.style.width = `${pct}%`;
    if (snap.tideFraction < 0.25) {
      this.tideFillEl.classList.add("low");
    } else {
      this.tideFillEl.classList.remove("low");
    }

    // Hint text on title/ready phase
    if (snap.phase === "ready") {
      this.hintTextEl.textContent = "Turn a shell to begin";
      this.hintTextEl.style.opacity = "1";
    } else if (snap.phase === "playing") {
      this.hintTextEl.textContent = "Hold to pennant • Tap number to sweep";
      this.hintTextEl.style.opacity = "0.7";
    } else {
      this.hintTextEl.textContent = "The pool remembers. Tap to begin another tide.";
      this.hintTextEl.style.opacity = "1";
    }

    // Ensure cell sizes match grid dimensions
    this.updateCellSize();

    // Reconstruct board DOM if size changed or first render
    const totalCells = snap.gridWidth * snap.gridHeight;
    if (this.boardEl.children.length !== totalCells) {
      this.boardEl.innerHTML = "";
      for (let y = 0; y < snap.gridHeight; y++) {
        for (let x = 0; x < snap.gridWidth; x++) {
          const div = document.createElement("div");
          div.className = "cell";
          div.dataset.x = x;
          div.dataset.y = y;
          this.boardEl.appendChild(div);
        }
      }
    }

    // Render cells based on rows
    const cells = this.boardEl.children;
    for (let y = 0; y < snap.gridHeight; y++) {
      const row = snap.rows[y];
      for (let x = 0; x < snap.gridWidth; x++) {
        const idx = y * snap.gridWidth + x;
        const cell = cells[idx];
        const ch = row[x];

        // Reset classes
        cell.className = "cell";
        cell.removeAttribute("data-num");
        cell.textContent = "";

        if (ch === "#") {
          cell.classList.add("covered");
        } else if (ch === "F") {
          cell.classList.add("flagged");
          cell.innerHTML = `<span class="pennant-icon">🚩</span>`;
        } else if (ch >= "0" && ch <= "8") {
          cell.classList.add("turned");
          if (ch === "0") {
            cell.classList.add("empty");
          } else {
            cell.dataset.num = ch;
            cell.textContent = ch;
          }
        } else if (ch === "*") {
          cell.classList.add("urchin-unflagged");
          cell.textContent = "🦔";
        } else if (ch === "X") {
          cell.classList.add("fatal-sting");
          cell.textContent = "💥";
        } else if (ch === "+") {
          cell.classList.add("flag-correct");
          cell.textContent = "🚩";
        } else if (ch === "-") {
          cell.classList.add("flag-wrong");
          cell.textContent = "✕";
        }
      }
    }
  }

  startAnimationLoop() {
    const loop = (now) => {
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;

      // Advance real-time clock if playing and not paused
      if (this.game.phase === "playing") {
        this.game.advance(dt * 1000);
        const pct = Math.max(0, Math.min(100, this.game.tideFraction * 100));
        this.tideFillEl.style.width = `${pct}%`;
        if (this.game.tideFraction < 0.25) {
          this.tideFillEl.classList.add("low");
        } else {
          this.tideFillEl.classList.remove("low");
        }
      }

      // Update and render host creature Barnaby
      this.host.update(dt);

      // Render water caustics
      this.renderWaterCaustics(dt);

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  renderWaterCaustics(dt) {
    const ctx = this.causticCtx;
    const w = this.causticCanvas.width;
    const h = this.causticCanvas.height;

    ctx.clearRect(0, 0, w, h);
    this.causticTime += dt * 0.8;

    // Gentle sunbeam caustics
    const grad = ctx.createRadialGradient(
      w * 0.5 + Math.sin(this.causticTime * 0.5) * 60,
      h * 0.3 + Math.cos(this.causticTime * 0.4) * 40,
      40,
      w * 0.5,
      h * 0.4,
      Math.max(w, h) * 0.7
    );
    grad.addColorStop(0, "rgba(56, 189, 248, 0.08)");
    grad.addColorStop(0.5, "rgba(45, 212, 191, 0.03)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Drifting bioluminescent plankton motes
    ctx.fillStyle = "rgba(200, 245, 255, 0.4)";
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y += p.speedY;
      p.x += p.speedX + Math.sin(this.causticTime + i) * 0.2;

      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

window.ShoalUI = ShoalUI;
