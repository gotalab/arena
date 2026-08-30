(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var renderer = DelveRender.createRenderer(canvas);

  function pickInitialSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  var state = DelveSim.create(pickInitialSeed());
  var sessionBest = 0;
  var isNewBest = false;
  var lastPhase = state.phase;
  var lastProcessedSeq = 0;
  var externalDrive = false;
  var audioComboLevel = 0;
  var audioComboTimer = 0;
  var lastFrameTs = null;

  function doReset(seed) {
    DelveSim.reset(state, seed);
    renderer.reset();
    lastProcessedSeq = 0;
    lastPhase = state.phase;
    isNewBest = false;
    audioComboLevel = 0;
    audioComboTimer = 0;
    DelveAudio.stopEngine();
  }

  var input = DelveInput.create({
    canvas: canvas,
    onRestart: function () { doReset(state.seed); },
    onFirstInput: function () { DelveAudio.unlock(); },
    isGameOver: function () { return state.phase === 'gameover'; }
  });

  function processEvents(snapshot, dtSec) {
    var events = snapshot.events;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.seq <= lastProcessedSeq) continue;
      lastProcessedSeq = ev.seq;
      dispatchEvent(ev, snapshot);
    }
    audioComboTimer = Math.max(0, audioComboTimer - dtSec);
    if (audioComboTimer <= 0) audioComboLevel = 0;
  }

  function dispatchEvent(ev, snapshot) {
    renderer.trigger(ev.kind, ev, snapshot, currentMap);

    switch (ev.kind) {
      case 'wall_contact': DelveAudio.playWallHit(); break;
      case 'rock_hit': DelveAudio.playRockHit(); break;
      case 'rock_broken': DelveAudio.playRockBroken(); break;
      case 'fragment': DelveAudio.playFragment(snapshot.fragmentsCollected); break;
      case 'power': DelveAudio.playPower(); break;
      case 'near_miss':
        audioComboLevel = Math.min(6, audioComboLevel + 1);
        audioComboTimer = 1.4;
        DelveAudio.playNearMiss(audioComboLevel);
        break;
    }
  }

  var currentMap = null;

  function frame(ts) {
    requestAnimationFrame(frame);
    if (lastFrameTs === null) lastFrameTs = ts;
    var dtMs = Math.min(80, ts - lastFrameTs);
    lastFrameTs = ts;
    var dtSec = dtMs / 1000;

    DelveSim.setInput(state, input.getInput());

    if (!externalDrive) {
      DelveSim.advance(state, dtMs);
    }

    var snapshot = DelveSim.snapshot(state);

    // build a screen mapper matching what render.js uses internally, so
    // event-triggered particle bursts land at the machine's actual position.
    var playRect = renderer.getPlayRect();
    currentMap = makeExternalMapper(snapshot, playRect);

    processEvents(snapshot, dtSec);

    if (lastPhase === 'ready' && snapshot.phase === 'playing') {
      DelveAudio.playStart();
    }
    if (lastPhase !== 'gameover' && snapshot.phase === 'gameover') {
      if (snapshot.score > sessionBest) { sessionBest = snapshot.score; isNewBest = true; }
      else { isNewBest = false; }
      DelveAudio.playGameOver();
    }
    lastPhase = snapshot.phase;

    var speedFrac = clamp((snapshot.speed - DelveSim.CRAWL_SPEED) / (DelveSim.MAX_SPEED - DelveSim.CRAWL_SPEED), 0, 1);
    var powered = snapshot.timeMs < snapshot.invincibleUntilMs;
    var dangerFrac = clamp((speedFrac - 0.55) / 0.45 + audioComboLevel * 0.09, 0, 1);
    if (snapshot.phase === 'playing') {
      DelveAudio.updateEngine(speedFrac, powered, dangerFrac);
    } else if (snapshot.phase === 'gameover') {
      DelveAudio.updateEngine(0, false, 0);
    }

    renderer.setStickVisual(input.getStickVisual());
    renderer.draw(snapshot, sessionBest, isNewBest, dtSec);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function makeExternalMapper(snapshot, playRect) {
    var ppu = playRect.width / renderer.worldViewWidth;
    var machineScreenY = playRect.y + playRect.height * renderer.machineYFrac;
    var centerScreenX = playRect.x + playRect.width / 2;
    var camX = snapshot.courseCenterX;
    return {
      ppu: ppu,
      toScreen: function (x, depth) {
        return { x: centerScreenX + (x - camX) * ppu, y: machineScreenY + (depth - snapshot.depth) * ppu };
      },
      machineScreen: { x: centerScreenX + (snapshot.x - camX) * ppu, y: machineScreenY }
    };
  }

  window.addEventListener('resize', function () { renderer.resize(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () { renderer.resize(); });
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function () { renderer.resize(); }).observe(document.body);
  }

  requestAnimationFrame(frame);

  // ---- Arena runtime interface -------------------------------------------
  window.__ARENA_GAME__ = {
    reset: function (seed) {
      doReset(seed);
      return DelveSim.snapshot(state);
    },
    snapshot: function () {
      return DelveSim.snapshot(state);
    },
    advance: function (ms) {
      externalDrive = true;
      DelveSim.advance(state, ms);
      return DelveSim.snapshot(state);
    }
  };
})();
