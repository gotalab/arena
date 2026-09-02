/**
 * Shoal Main Application, View Rendering, & Controls Controller
 */
(function() {
  const game = window.ShoalGame.createGame(Date.now() ^ (Math.random() * 1000000));
  let host = null;
  let bgCanvas, bgCtx;

  // DOM Elements
  const hudPool = document.getElementById("hud-pool");
  const hudUrchins = document.getElementById("hud-urchins");
  const hudPearls = document.getElementById("hud-pearls");
  const btnRestartHud = document.getElementById("btn-restart-hud");
  const tideBarFill = document.getElementById("tide-bar-fill");
  const gridEl = document.getElementById("grid");
  const gridScaler = document.getElementById("grid-scaler");
  const statusText = document.getElementById("status-text");
  const ceremonyOverlay = document.getElementById("ceremony-overlay");
  const ceremonyTitle = document.getElementById("ceremony-title");
  const ceremonySubtitle = document.getElementById("ceremony-subtitle");
  const ceremonyRank = document.getElementById("ceremony-rank");
  const ceremonyPearls = document.getElementById("ceremony-pearls");
  const ceremonyBest = document.getElementById("ceremony-best");
  const ceremonySigLabel = document.getElementById("ceremony-sig-label");
  const ceremonySigVal = document.getElementById("ceremony-sig-val");
  const ceremonyLadder = document.getElementById("ceremony-ladder");
  const postMortemInfo = document.getElementById("post-mortem-info");
  const btnCeremonyRestart = document.getElementById("btn-ceremony-restart");
  const poolClearBanner = document.getElementById("pool-clear-banner");
  const clearBonusText = document.getElementById("clear-bonus-text");

  // Interaction tracking for press-and-hold (flag)
  let holdTimer = null;
  let activeHoldCell = null;
  let holdFired = false;
  let touchStartX = 0;
  let touchStartY = 0;

  let lastPool = 1;
  let lastPhase = "ready";
  let lastPearls = 0;

  function renderGrid() {
    const state = game.getVisibleState();
    const { gridWidth, gridHeight, rows, phase, stungAt } = state;

    // Adjust grid CSS
    gridEl.style.gridTemplateColumns = `repeat(${gridWidth}, 1fr)`;
    gridEl.style.gridTemplateRows = `repeat(${gridHeight}, 1fr)`;

    // Calculate optimal cell size
    const containerW = gridScaler.clientWidth - 16;
    const containerH = gridScaler.clientHeight - 16;
    const cellW = Math.floor(containerW / gridWidth);
    const cellH = Math.floor(containerH / gridHeight);
    const size = Math.min(cellW, cellH, 48);

    gridEl.style.width = `${size * gridWidth + (gridWidth - 1) * 4 + 16}px`;
    gridEl.style.height = `${size * gridHeight + (gridHeight - 1) * 4 + 16}px`;

    gridEl.innerHTML = "";

    for (let y = 0; y < gridHeight; y++) {
      const rowStr = rows[y];
      for (let x = 0; x < gridWidth; x++) {
        const char = rowStr[x];
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.style.width = `${size}px`;
        cell.style.height = `${size}px`;
        cell.style.fontSize = `${Math.max(14, Math.floor(size * 0.52))}px`;

        if (char === "#") {
          cell.classList.add("covered");
        } else if (char === "F") {
          cell.classList.add("flagged");
          cell.innerHTML = `<span class="pennant-icon" aria-label="Pennant">⚑</span>`;
        } else if (char === "X") {
          cell.classList.add("fatal-stung");
          cell.innerHTML = `<span class="fatal-icon">✕</span>`;
        } else if (char === "*") {
          cell.classList.add("revealed-urchin");
          cell.innerHTML = `<span class="urchin-sprite">✹</span>`;
        } else if (char === "+") {
          cell.classList.add("flag-correct");
          cell.innerHTML = `<span class="pennant-icon" style="color: #57cc99;">⚑</span>`;
        } else if (char === "-") {
          cell.classList.add("flag-wrong");
          cell.innerHTML = `<span class="pennant-icon" style="color: #ff6b6b; opacity: 0.8;">⚑</span>`;
        } else {
          // Number 0-8
          cell.classList.add("open");
          const num = parseInt(char, 10);
          if (num > 0) {
            cell.classList.add(`num-${num}`);
            cell.textContent = num;
            cell.classList.add("clickable-number");
          }
        }

        gridEl.appendChild(cell);
      }
    }
  }

  function updateHUD() {
    const state = game.getVisibleState();
    hudPool.textContent = state.pool;
    hudUrchins.textContent = state.urchinsLeft;
    hudPearls.textContent = state.pearls;

    const tidePercent = Math.max(0, Math.min(100, state.tideFraction * 100));
    tideBarFill.style.width = `${tidePercent}%`;

    if (tidePercent < 25) {
      tideBarFill.style.background = "linear-gradient(90deg, #e63946, #ff9f1c)";
    } else if (tidePercent < 55) {
      tideBarFill.style.background = "linear-gradient(90deg, #ff9f1c, #ffd166)";
    } else {
      tideBarFill.style.background = "linear-gradient(90deg, #11998e, #38ef7d)";
    }

    if (state.phase === "ended") {
      showCeremony(state);
    } else {
      ceremonyOverlay.classList.add("hidden");
    }

    // Host reactions
    if (host) {
      if (state.phase === "ended") {
        if (state.stungAt) host.setMood("stung");
        else host.setMood("proud");
      } else if (state.urchinsLeft <= 3 && state.firstTurnDone) {
        host.setMood("nervous");
      }
    }
  }

  function showCeremony(state) {
    ceremonyOverlay.classList.remove("hidden");
    const isStung = !!state.stungAt;

    if (isStung) {
      ceremonyTitle.textContent = "STUNG BY URCHIN";
      ceremonyTitle.style.color = "#ff6b6b";
      ceremonySubtitle.textContent = `A quiet lesson in Pool ${state.pool}. Every urchin lay in reach.`;
      postMortemInfo.textContent = `Fatal step at (${state.stungAt.x + 1}, ${state.stungAt.y + 1}). Pennants graded on board.`;
    } else {
      ceremonyTitle.textContent = "RUN CONCLUDED";
      ceremonyTitle.style.color = "#38ef7d";
      ceremonySubtitle.textContent = "The tides have settled in harmony.";
      postMortemInfo.textContent = "";
    }

    ceremonyRank.textContent = state.rank;
    ceremonyPearls.textContent = state.pearls;
    ceremonyBest.textContent = state.sessionBest;

    const stats = game.getStats();
    if (stats.maxRipple > 8) {
      ceremonySigLabel.textContent = "BIGGEST RIPPLE";
      ceremonySigVal.textContent = `${stats.maxRipple} shells`;
    } else if (stats.fastestPoolMs !== null) {
      ceremonySigLabel.textContent = "FASTEST POOL";
      ceremonySigVal.textContent = `${(stats.fastestPoolMs / 1000).toFixed(1)}s`;
    } else {
      ceremonySigLabel.textContent = "DEEPEST POOL";
      ceremonySigVal.textContent = `Pool ${stats.maxPoolReached}`;
    }

    // Populate Rank Ladder
    ceremonyLadder.innerHTML = "";
    const ranks = state.rankLadder;
    const curRankIdx = ranks.indexOf(state.rank);

    ranks.forEach((r, idx) => {
      const item = document.createElement("div");
      item.className = "ladder-item";
      item.textContent = r;
      if (idx === curRankIdx) {
        item.classList.add("active");
      } else if (idx < curRankIdx) {
        item.classList.add("passed");
      }
      ceremonyLadder.appendChild(item);
    });
  }

  function showClearBanner(poolNum, bonus) {
    clearBonusText.textContent = `+${bonus} Pearls`;
    poolClearBanner.classList.remove("hidden");
    if (host) host.setMood("proud", 90);
    window.ShoalAudio.playPoolClear();

    setTimeout(() => {
      poolClearBanner.classList.add("hidden");
    }, 1200);
  }

  function render() {
    renderGrid();
    updateHUD();
  }

  function handleCellAction(x, y, isLongPressOrRightClick) {
    window.ShoalAudio.initAudio();
    const state = game.getVisibleState();
    if (state.phase === "ended") return;

    const char = state.rows[y][x];

    if (isLongPressOrRightClick) {
      if (char === "#") {
        const res = game.act({ type: "flag", x, y });
        if (res) {
          window.ShoalAudio.playFlag();
          render();
        }
      } else if (char === "F") {
        const res = game.act({ type: "unflag", x, y });
        if (res) {
          window.ShoalAudio.playUnflag();
          render();
        }
      }
    } else {
      // Normal Tap / Left Click
      if (char === "#") {
        const prevPearls = state.pearls;
        const prevPool = state.pool;
        const res = game.act({ type: "open", x, y });
        if (res) {
          const newState = game.getVisibleState();
          if (newState.phase === "ended" && newState.stungAt) {
            window.ShoalAudio.playSting();
          } else if (newState.pool > prevPool) {
            showClearBanner(prevPool, newState.pearls - prevPearls);
          } else {
            const opened = newState.pearls - prevPearls;
            if (opened > 1) {
              window.ShoalAudio.playRipple(Math.min(8, opened));
              if (host) host.setMood("delighted", 60);
            } else {
              window.ShoalAudio.playTurn();
            }
          }
          render();
        }
      } else if (!isNaN(parseInt(char, 10))) {
        // Sweep attempt on open number
        const prevPearls = state.pearls;
        const prevPool = state.pool;
        const res = game.act({ type: "sweep", x, y });
        if (res) {
          const newState = game.getVisibleState();
          if (newState.phase === "ended" && newState.stungAt) {
            window.ShoalAudio.playSting();
          } else if (newState.pool > prevPool) {
            showClearBanner(prevPool, newState.pearls - prevPearls);
          } else {
            window.ShoalAudio.playSweep();
          }
          render();
        }
      }
    }
  }

  function setupControls() {
    // Mouse events
    gridEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const x = parseInt(cell.dataset.x, 10);
      const y = parseInt(cell.dataset.y, 10);
      handleCellAction(x, y, true);
    });

    // Touch and Mouse unified pointer handling
    gridEl.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return; // Right click handled by contextmenu
      const cell = e.target.closest(".cell");
      if (!cell) return;

      const x = parseInt(cell.dataset.x, 10);
      const y = parseInt(cell.dataset.y, 10);

      activeHoldCell = { x, y, el: cell };
      holdFired = false;
      touchStartX = e.clientX;
      touchStartY = e.clientY;

      cell.classList.add("pressing");

      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        if (activeHoldCell) {
          holdFired = true;
          cell.classList.remove("pressing");
          if (navigator.vibrate) navigator.vibrate(25);
          handleCellAction(x, y, true);
        }
      }, 420);
    });

    window.addEventListener("pointermove", (e) => {
      if (activeHoldCell) {
        const dist = Math.hypot(e.clientX - touchStartX, e.clientY - touchStartY);
        if (dist > 15) {
          clearTimeout(holdTimer);
          if (activeHoldCell.el) activeHoldCell.el.classList.remove("pressing");
          activeHoldCell = null;
        }
      }
    });

    window.addEventListener("pointerup", (e) => {
      if (activeHoldCell) {
        clearTimeout(holdTimer);
        const { x, y, el } = activeHoldCell;
        if (el) el.classList.remove("pressing");
        activeHoldCell = null;

        if (!holdFired && e.button !== 2) {
          handleCellAction(x, y, false);
        }
      }
    });

    window.addEventListener("pointercancel", () => {
      clearTimeout(holdTimer);
      if (activeHoldCell && activeHoldCell.el) activeHoldCell.el.classList.remove("pressing");
      activeHoldCell = null;
    });

    // Keyboard support: R restarts
    window.addEventListener("keydown", (e) => {
      if (e.key === "r" || e.key === "R") {
        window.ShoalAudio.initAudio();
        game.restart();
        render();
      }
    });

    btnRestartHud.addEventListener("click", () => {
      window.ShoalAudio.initAudio();
      game.restart();
      render();
    });

    btnCeremonyRestart.addEventListener("click", () => {
      window.ShoalAudio.initAudio();
      game.restart();
      render();
    });

    window.addEventListener("resize", () => {
      render();
      resizeBg();
    });
  }

  // Background ocean caustics animation
  function initBackground() {
    bgCanvas = document.getElementById("bg-canvas");
    bgCtx = bgCanvas.getContext("2d");
    resizeBg();
  }

  function resizeBg() {
    if (!bgCanvas) return;
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }

  let bgTime = 0;
  function drawBackground() {
    if (!bgCtx) return;
    bgTime += 0.015;
    const w = bgCanvas.width;
    const h = bgCanvas.height;

    bgCtx.clearRect(0, 0, w, h);

    // Subtle gentle caustics / light waves
    bgCtx.fillStyle = "rgba(76, 201, 240, 0.03)";
    for (let i = 0; i < 4; i++) {
      bgCtx.beginPath();
      const waveY = h * 0.2 + i * 140 + Math.sin(bgTime + i) * 30;
      bgCtx.moveTo(0, waveY);
      for (let x = 0; x < w; x += 40) {
        const y = waveY + Math.sin(x * 0.01 + bgTime * 1.5 + i) * 20;
        bgCtx.lineTo(x, y);
      }
      bgCtx.lineTo(w, h);
      bgCtx.lineTo(0, h);
      bgCtx.closePath();
      bgCtx.fill();
    }
  }

  // Main 60Hz tick animation loop
  let lastFrameTime = performance.now();
  function animationLoop(now) {
    const deltaMs = now - lastFrameTime;
    lastFrameTime = now;

    // Advance 60Hz game clock when playing
    game.advance(deltaMs);

    // Update background & host
    drawBackground();
    if (host) {
      host.update();
      host.draw();
    }

    // Periodic HUD update for smooth tide meter
    const state = game.getVisibleState();
    const tidePercent = Math.max(0, Math.min(100, state.tideFraction * 100));
    tideBarFill.style.width = `${tidePercent}%`;

    requestAnimationFrame(animationLoop);
  }

  function init() {
    initBackground();
    const hostCanvas = document.getElementById("host-canvas");
    host = window.ShoalHost.createHost(hostCanvas);

    setupControls();
    render();

    // Expose window.__ARENA_GAME__
    window.__ARENA_GAME__ = {
      reset: (seed) => {
        const snap = game.reset(seed);
        render();
        return snap;
      },
      snapshot: () => game.snapshot(),
      act: (action) => {
        const res = game.act(action);
        render();
        return res;
      },
      restart: () => {
        const snap = game.restart();
        render();
        return snap;
      },
      advance: (ms) => {
        game.advance(ms);
        updateHUD();
      }
    };

    // Initialize Parent Bridge
    window.ShoalBridge.initBridge(game, render);

    requestAnimationFrame(animationLoop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
