/* SHOAL — input, frame loop, runtime wiring */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var canvas = document.getElementById("stage");
  var ceremony = document.getElementById("ceremony");
  var hintEl = document.getElementById("hint");
  var game = createShoalGame();
  var view = createShoalView(canvas);
  var audio = createShoalAudio();

  var hover = null;
  var press = null;
  var ptr = null;
  var holdTimer = 0;
  var lastTs = 0;
  var hintedFlag = false;
  var hintedSweep = false;
  var hushLow = false;

  function viewport() {
    var vv = window.visualViewport;
    if (vv) {
      return { w: vv.width, h: vv.height, x: vv.offsetLeft, y: vv.offsetTop };
    }
    return { w: window.innerWidth, h: window.innerHeight, x: 0, y: 0 };
  }

  function fit() {
    var v = viewport();
    app.style.left = v.x + "px";
    app.style.top = v.y + "px";
    app.style.width = v.w + "px";
    app.style.height = v.h + "px";
    view.fit(v.w, v.h);
  }

  function renderNow() {
    var snap = game.snapshot();
    view.draw(snap, performance.now(), {
      hover: hover,
      press: press,
      now: performance.now(),
    });
  }

  function showHint(text) {
    hintEl.textContent = text || "";
    hintEl.classList.toggle("out", !text);
  }

  function updateHint(snap) {
    if (snap.phase === "ended" || snap.phase === "ready") {
      showHint("");
      return;
    }
    var joined = snap.rows.join("");
    var hasNum = /[1-8]/.test(joined);
    if (!hintedFlag && hasNum && snap.flagsPlaced === 0) {
      showHint("hold a shell to plant a pennant");
      return;
    }
    if (hintedFlag && !hintedSweep && snap.flagsPlaced > 0) {
      showHint("tap a matching number to sweep");
      return;
    }
    showHint("");
  }

  function fillCeremony(snap) {
    var stats = game.runStats();
    document.getElementById("cer-pearls").textContent = String(snap.pearls);
    document.getElementById("cer-best").textContent = String(snap.sessionBest);
    document.getElementById("cer-title").textContent = "the urchin woke";
    document.getElementById("cer-sub").textContent = snap.stungAt
      ? "the pool shows every spine"
      : "the tide remembers";
    var sig = "a wake of " + stats.maxRipple;
    document.getElementById("cer-sig").textContent = sig;
    var ladder = document.getElementById("cer-ladder");
    while (ladder.firstChild) ladder.removeChild(ladder.firstChild);
    snap.rankLadder.forEach(function (name) {
      var i = document.createElement("i");
      i.textContent = name;
      if (name === snap.rank) i.className = "on";
      ladder.appendChild(i);
    });
  }

  function syncChrome(snap) {
    if (snap.phase === "ended") {
      fillCeremony(snap);
      ceremony.classList.remove("hidden");
      ceremony.classList.add("show");
      showHint("");
    } else {
      ceremony.classList.add("hidden");
      ceremony.classList.remove("show");
    }
    updateHint(snap);
    var low = snap.phase === "playing" && snap.firstTurnDone && snap.tideFraction < 0.22;
    if (low !== hushLow) {
      hushLow = low;
      audio.hush(low);
    }
  }

  function playJuice(juice) {
    if (!juice || !juice.kind) {
      if (juice && juice.sting) audio.sting();
      return;
    }
    if (juice.sting) audio.sting();
    else if (juice.clear) audio.clear();
    else if (juice.kind === "open") {
      if (juice.opened && juice.opened.length > 1) audio.ripple(juice.opened.length);
      else audio.turn();
    } else if (juice.kind === "sweep") audio.sweep(juice.opened ? juice.opened.length : 3);
    else if (juice.kind === "flag") audio.flag();
    else if (juice.kind === "unflag") audio.unflag();
  }

  function applyAction(action) {
    var before = game.snapshot();
    var snap = game.act(action);
    if (snap.revision === before.revision) return snap;
    var juice = game.lastJuice();
    view.applyJuice(juice, performance.now(), snap.gridWidth);
    playJuice(juice);
    if (juice && juice.kind === "flag") hintedFlag = true;
    if (juice && juice.kind === "sweep") hintedSweep = true;
    syncChrome(snap);
    renderNow();
    return snap;
  }

  function doRestart() {
    var snap = game.restart();
    hover = null;
    press = null;
    hintedFlag = false;
    hintedSweep = false;
    hushLow = false;
    audio.hush(false);
    syncChrome(snap);
    renderNow();
    return snap;
  }

  function cellFromEvent(e) {
    var r = canvas.getBoundingClientRect();
    return view.cellAt(e.clientX - r.left, e.clientY - r.top);
  }

  function toggleFlag(cell) {
    if (!cell) return;
    var snap = game.snapshot();
    if (snap.phase === "ended") return;
    var ch = snap.rows[cell.y][cell.x];
    if (ch === "F") applyAction({ type: "unflag", x: cell.x, y: cell.y });
    else if (ch === "#") applyAction({ type: "flag", x: cell.x, y: cell.y });
  }

  function activateCell(cell) {
    if (!cell) return;
    var snap = game.snapshot();
    if (snap.phase === "ended") {
      doRestart();
      return;
    }
    var ch = snap.rows[cell.y][cell.x];
    if (ch === "#") applyAction({ type: "open", x: cell.x, y: cell.y });
    else if (ch >= "0" && ch <= "8") applyAction({ type: "sweep", x: cell.x, y: cell.y });
  }

  function clearHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  }

  function onDown(e) {
    if (e.button === 1) return;
    e.preventDefault();
    audio.unlock();
    if (game.snapshot().phase === "ended") {
      ptr = { restart: true, id: e.pointerId };
      return;
    }
    var cell = cellFromEvent(e);
    if (!cell) return;
    press = cell;
    hover = cell;
    ptr = {
      id: e.pointerId,
      cell: cell,
      x: e.clientX,
      y: e.clientY,
      holdFired: false,
      cancelled: false,
      button: e.button,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
    if (e.button === 2) {
      toggleFlag(cell);
      ptr.holdFired = true;
      return;
    }
    var onCell = cell;
    holdTimer = setTimeout(function () {
      if (!ptr || ptr.cancelled || ptr.holdFired) return;
      var snap = game.snapshot();
      var ch = snap.rows[onCell.y][onCell.x];
      if (ch === "#" || ch === "F") {
        toggleFlag(onCell);
        ptr.holdFired = true;
      }
    }, 480);
  }

  function onMove(e) {
    var cell = cellFromEvent(e);
    if (e.pointerType !== "touch") hover = cell;
    if (!ptr || e.pointerId !== ptr.id) return;
    var dx = e.clientX - ptr.x;
    var dy = e.clientY - ptr.y;
    if (dx * dx + dy * dy > 256) {
      ptr.cancelled = true;
      press = null;
      clearHold();
    }
    if (cell && ptr.cell && (cell.x !== ptr.cell.x || cell.y !== ptr.cell.y)) {
      ptr.cancelled = true;
      press = null;
      clearHold();
    }
  }

  function onUp(e) {
    if (!ptr || e.pointerId !== ptr.id) {
      press = null;
      return;
    }
    e.preventDefault();
    clearHold();
    var restarting = ptr.restart;
    var cell = ptr.cell;
    var fired = ptr.holdFired;
    var cancelled = ptr.cancelled;
    ptr = null;
    press = null;
    if (restarting || game.snapshot().phase === "ended") {
      doRestart();
      return;
    }
    if (!cancelled && !fired) activateCell(cell);
  }

  function onCancel() {
    clearHold();
    ptr = null;
    press = null;
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });
  ceremony.addEventListener("pointerup", function (e) {
    e.preventDefault();
    if (game.snapshot().phase === "ended") doRestart();
  });
  ceremony.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      audio.unlock();
      doRestart();
    } else if ((e.key === "f" || e.key === "F") && hover) {
      e.preventDefault();
      audio.unlock();
      toggleFlag(hover);
    }
  });

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt > 100) dt = 100;
    game.advance(dt);
    view.draw(game.snapshot(), ts, { hover: hover, press: press, now: ts });
    requestAnimationFrame(loop);
  }

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      var snap = game.reset(seed);
      hintedFlag = false;
      hintedSweep = false;
      hushLow = false;
      syncChrome(snap);
      renderNow();
      return snap;
    },
    snapshot: function () {
      return game.snapshot();
    },
    act: function (action) {
      return applyAction(action);
    },
    restart: function () {
      return doRestart();
    },
    advance: function (ms) {
      game.advance(ms);
    },
  };

  attachArenaBridge({
    snapshot: function () {
      return game.snapshot();
    },
    act: function (action) {
      return applyAction(action);
    },
    restart: function () {
      return doRestart();
    },
    render: renderNow,
  });

  fit();
  window.addEventListener("resize", fit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fit);
    window.visualViewport.addEventListener("scroll", fit);
  }
  syncChrome(game.snapshot());
  renderNow();
  requestAnimationFrame(loop);
})();
