// DELVE — synthesized audio. Never a requirement: everything here is best-effort
// and every call is guarded so a failure or missing WebAudio never blocks play.
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var unlocked = false;
  var engineNodes = null;

  function safe(fn) {
    try { return fn(); } catch (e) { return null; }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    return safe(function () {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.62;
      master.connect(ctx.destination);
      return ctx;
    });
  }

  function unlock() {
    if (unlocked) return;
    var c = ensureCtx();
    if (!c) return;
    unlocked = true;
    safe(function () {
      if (c.state === 'suspended') c.resume();
      // silent primer buffer to fully unstick mobile Safari/Chrome
      var buf = c.createBuffer(1, 1, 22050);
      var src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    });
    startEngine();
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  function noiseBuffer(duration) {
    var c = ctx;
    var len = Math.max(1, Math.floor(c.sampleRate * duration));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.4);
    }
    return buf;
  }

  // ---- continuous engine drone -------------------------------------------
  function startEngine() {
    if (!ctx || engineNodes) return;
    safe(function () {
      var osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      var osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.7;
      var gain = ctx.createGain();
      gain.gain.value = 0.0001;
      var grit = ctx.createBufferSource();
      grit.buffer = noiseLoop();
      grit.loop = true;
      var gritFilter = ctx.createBiquadFilter();
      gritFilter.type = 'bandpass';
      gritFilter.frequency.value = 700;
      gritFilter.Q.value = 0.9;
      var gritGain = ctx.createGain();
      gritGain.gain.value = 0.0001;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(master);

      grit.connect(gritFilter);
      gritFilter.connect(gritGain);
      gritGain.connect(master);

      osc1.frequency.value = 55;
      osc2.frequency.value = 55.6;
      osc1.start();
      osc2.start();
      grit.start();

      var powerOsc = ctx.createOscillator();
      powerOsc.type = 'sine';
      powerOsc.frequency.value = 440;
      var powerGain = ctx.createGain();
      powerGain.gain.value = 0.0001;
      powerOsc.connect(powerGain);
      powerGain.connect(master);
      powerOsc.start();

      engineNodes = { osc1: osc1, osc2: osc2, filter: filter, gain: gain, gritGain: gritGain, powerOsc: powerOsc, powerGain: powerGain };
    });
  }

  var noiseLoopBuf = null;
  function noiseLoop() {
    if (noiseLoopBuf) return noiseLoopBuf;
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseLoopBuf = buf;
    return buf;
  }

  // speedFrac 0..1, powered bool
  function updateEngine(speedFrac, powered, dangerFrac) {
    if (!engineNodes || !ctx) return;
    safe(function () {
      var t = now();
      var freq = 48 + speedFrac * 210;
      engineNodes.osc1.frequency.setTargetAtTime(freq, t, 0.08);
      engineNodes.osc2.frequency.setTargetAtTime(freq * 1.012 + dangerFrac * 6, t, 0.08);
      engineNodes.filter.frequency.setTargetAtTime(240 + speedFrac * 2200, t, 0.1);
      engineNodes.gain.gain.setTargetAtTime(0.05 + speedFrac * 0.09, t, 0.15);
      engineNodes.gritGain.gain.setTargetAtTime(dangerFrac * 0.05, t, 0.2);
      engineNodes.powerGain.gain.setTargetAtTime(powered ? 0.035 : 0.0001, t, 0.2);
      engineNodes.powerOsc.frequency.setTargetAtTime(powered ? 420 + Math.sin(t * 6) * 20 : 420, t, 0.05);
    });
  }

  function tone(freq, duration, type, gainVal, opts) {
    var c = ensureCtx();
    if (!c || !unlocked) return;
    safe(function () {
      opts = opts || {};
      var t = now();
      var osc = c.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t + duration);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainVal, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    });
  }

  function impact(strength) {
    var c = ensureCtx();
    if (!c || !unlocked) return;
    safe(function () {
      var t = now();
      var src = c.createBufferSource();
      src.buffer = noiseBuffer(0.28);
      var filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900 * strength + 200;
      var g = c.createGain();
      g.gain.setValueAtTime(0.5 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t);

      var osc = c.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(90 * strength + 40, t);
      osc.frequency.exponentialRampToValueAtTime(20, t + 0.22);
      var g2 = c.createGain();
      g2.gain.setValueAtTime(0.35 * strength, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g2);
      g2.connect(master);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  function playWallHit() { impact(0.75); }
  function playRockHit() { impact(1.0); }
  function playRockBroken() {
    tone(520, 0.14, 'triangle', 0.22, { sweepTo: 880 });
    tone(200, 0.18, 'square', 0.12);
  }
  function playFragment(comboIndex) {
    var base = 660 + Math.min(comboIndex, 6) * 40;
    tone(base, 0.13, 'sine', 0.2, { sweepTo: base * 1.5 });
  }
  function playPower() {
    tone(220, 0.5, 'sawtooth', 0.18, { sweepTo: 660 });
    tone(440, 0.5, 'sine', 0.15, { sweepTo: 880 });
  }
  function playNearMiss(level) {
    var l = Math.min(level, 5);
    tone(300 + l * 90, 0.09 + l * 0.015, 'sine', 0.1 + l * 0.05, { sweepTo: 500 + l * 160 });
  }
  function playGameOver() {
    tone(320, 0.9, 'sine', 0.2, { sweepTo: 80 });
    tone(160, 0.9, 'triangle', 0.14, { sweepTo: 40 });
  }
  function playStart() {
    tone(180, 0.2, 'sine', 0.15, { sweepTo: 420 });
  }

  function stopEngine() {
    updateEngine(0, false, 0);
  }

  global.DelveAudio = {
    unlock: unlock,
    updateEngine: updateEngine,
    playWallHit: playWallHit,
    playRockHit: playRockHit,
    playRockBroken: playRockBroken,
    playFragment: playFragment,
    playPower: playPower,
    playNearMiss: playNearMiss,
    playGameOver: playGameOver,
    playStart: playStart,
    stopEngine: stopEngine
  };
})(typeof window !== 'undefined' ? window : this);
