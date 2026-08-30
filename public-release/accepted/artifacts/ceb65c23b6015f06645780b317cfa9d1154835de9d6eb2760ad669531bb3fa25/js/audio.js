/* EMBER — synthesised sound identity.
 *
 * Everything here is generated with WebAudio primitives: no files, no network.
 * Audio never touches rule state; it only reads view events. The game is fully
 * playable in silence, and nothing starts until the player's first input.
 */
(function () {
  'use strict';
  var E = window.EMBER;

  var A = {
    ctx: null,
    ready: false,
    muted: false,
    master: null,
    wet: null,
    bus: null,
    drone: null,
    dampBed: null,
    dampFilter: null,
    dampGain: null,
    started: false
  };

  function now() { return A.ctx ? A.ctx.currentTime : 0; }

  /* --- one-off noise buffers, built once ---------------------------------- */
  function noiseBuffer(ctx, seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var s = 12345;
    for (var i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
    return buf;
  }

  function impulse(ctx, seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    var s = 99991;
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        var n = (s / 4294967296) * 2 - 1;
        d[i] = n * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  A.init = function () {
    if (A.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      var ctx = new AC();
      A.ctx = ctx;

      var master = ctx.createGain();
      master.gain.value = 0.0001;
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      master.connect(comp);
      comp.connect(ctx.destination);
      A.master = master;

      var bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      A.bus = bus;

      // short warm room
      var conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.5, 3.2);
      var wet = ctx.createGain();
      wet.gain.value = 0.22;
      bus.connect(wet);
      wet.connect(conv);
      conv.connect(master);
      A.wet = wet;

      A.noise = noiseBuffer(ctx, 2.0);

      // --- ambient drone: quiet minor bed, the flue's own breath ---
      var droneGain = ctx.createGain();
      droneGain.gain.value = 0.0;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      droneGain.connect(lp);
      lp.connect(master);
      var freqs = [55, 82.5, 110.3];
      A.droneOscs = [];
      for (var i = 0; i < freqs.length; i++) {
        var o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = freqs[i];
        o.detune.value = i * 7 - 6;
        var g = ctx.createGain();
        g.gain.value = i === 2 ? 0.06 : 0.12;
        o.connect(g);
        g.connect(droneGain);
        o.start();
        A.droneOscs.push(o);
      }
      var lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain);
      lfoGain.connect(lp.frequency);
      lfo.start();
      A.drone = droneGain;

      // --- damp bed: cold looping hiss that opens up as the damp closes in ---
      var src = ctx.createBufferSource();
      src.buffer = A.noise;
      src.loop = true;
      var df = ctx.createBiquadFilter();
      df.type = 'lowpass';
      df.frequency.value = 180;
      df.Q.value = 3;
      var dg = ctx.createGain();
      dg.gain.value = 0.0;
      src.connect(df);
      df.connect(dg);
      dg.connect(master);
      src.start();
      A.dampBed = src;
      A.dampFilter = df;
      A.dampGain = dg;

      A.ready = true;
    } catch (err) {
      A.ctx = null;
      A.ready = false;
    }
  };

  /* Called on the first pointer input. */
  A.unlock = function () {
    if (!A.ctx) A.init();
    if (!A.ctx) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    if (!A.started) {
      A.started = true;
      var t = now();
      A.master.gain.cancelScheduledValues(t);
      A.master.gain.setValueAtTime(0.0001, t);
      A.master.gain.exponentialRampToValueAtTime(A.muted ? 0.0001 : 0.85, t + 1.2);
      A.drone.gain.setValueAtTime(0.0001, t);
      A.drone.gain.linearRampToValueAtTime(0.16, t + 3.0);
    }
  };

  A.setMuted = function (m) {
    A.muted = !!m;
    if (!A.ready || !A.started) return;
    var t = now();
    A.master.gain.cancelScheduledValues(t);
    A.master.gain.setTargetAtTime(A.muted ? 0.0001 : 0.85, t, 0.05);
  };

  /* --- voices -------------------------------------------------------------- */

  function noiseVoice(dur, type, f0, f1, q, peak, dest) {
    var ctx = A.ctx, t = now();
    var src = ctx.createBufferSource();
    src.buffer = A.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + (f0 / 4000);
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || A.bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(type, f0, f1, dur, peak, delay, dest) {
    var ctx = A.ctx, t = now() + (delay || 0);
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || A.bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function bell(freq, dur, peak, delay) {
    var ctx = A.ctx, t = now() + (delay || 0);
    var car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    var mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 2.02;
    var mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 2.4, t);
    mg.gain.exponentialRampToValueAtTime(1, t + dur * 0.7);
    mod.connect(mg); mg.connect(car.frequency);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g); g.connect(A.bus);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }

  // pentatonic ladder — the chain's signature climb
  var LADDER = [0, 3, 5, 7, 10];
  function chainFreq(n) {
    var i = Math.max(0, n - 1);
    var st = LADDER[i % 5] + 12 * Math.floor(i / 5);
    return 293.66 * Math.pow(2, st / 12);
  }

  var api = {
    unlock: function () { A.unlock(); },
    isMuted: function () { return A.muted; },
    toggleMute: function () { A.setMuted(!A.muted); return A.muted; },
    ok: function () { return A.ready && A.started && !A.muted; },

    launch: function (power, chain) {
      if (!api.ok()) return;
      var p = 0.35 + 0.65 * power;
      noiseVoice(0.26, 'bandpass', 380 + 900 * p, 2600 + 1800 * p, 1.6, 0.16 * p);
      tone('triangle', 150 + 120 * p, 480 + 420 * p, 0.2, 0.16 * p);
      if (chain > 0) tone('sine', chainFreq(chain) * 0.5, chainFreq(chain), 0.24, 0.1, 0.01);
    },

    windup: function (power) {
      if (!api.ok()) return;
      // short granular tick while the sling stretches
      tone('square', 220 + 700 * power, 260 + 780 * power, 0.045, 0.022);
    },

    land: function (hard) {
      if (!api.ok()) return;
      tone('sine', 190, 62, 0.28, 0.3 * (0.7 + 0.3 * hard));
      noiseVoice(0.2, 'lowpass', 900, 180, 1, 0.12);
      tone('triangle', 392, 392, 0.16, 0.05, 0.02);
    },

    burst: function (chain) {
      if (!api.ok()) return;
      var f = chainFreq(Math.max(1, chain));
      var lvl = Math.min(0.34, 0.15 + 0.03 * chain);
      noiseVoice(0.12, 'highpass', 1400 + 220 * chain, 5200, 0.9, 0.13);
      tone('triangle', f * 0.5, f * 1.5, 0.18, lvl);
      bell(f * 2, 0.5 + 0.06 * chain, lvl * 0.6, 0.005);
    },

    glimmer: function (chain) {
      if (!api.ok()) return;
      var base = 1174.66 * Math.pow(2, (chain % 4) / 12);
      bell(base, 0.5, 0.16);
      bell(base * 1.5, 0.7, 0.11, 0.06);
      noiseVoice(0.1, 'highpass', 3200, 6800, 0.7, 0.05);
    },

    bank: function (n) {
      if (!api.ok()) return;
      var k = Math.min(n, 8);
      for (var i = 0; i < k; i++) {
        bell(chainFreq(i + 1) * 2, 0.42, 0.1 + 0.012 * i, i * 0.055);
      }
      tone('sine', 110, 220, 0.5, 0.12, 0.0);
    },

    empty: function () {
      if (!api.ok()) return;
      tone('square', 160, 96, 0.13, 0.06);
      noiseVoice(0.1, 'lowpass', 500, 200, 1, 0.05);
    },

    slip: function () {
      if (!api.ok()) return;
      noiseVoice(0.5, 'bandpass', 900, 500, 4, 0.03);
    },

    death: function () {
      if (!api.ok()) return;
      tone('sawtooth', 240, 42, 1.5, 0.22);
      tone('sine', 180, 30, 1.7, 0.16, 0.05);
      noiseVoice(1.4, 'lowpass', 2600, 120, 0.8, 0.2);
      bell(146.83, 1.8, 0.1, 0.25);
    },

    rank: function (tier) {
      if (!api.ok()) return;
      var root = 196 * Math.pow(2, Math.min(tier, 5) / 12);
      [0, 4, 7, 12].forEach(function (st, i) {
        bell(root * Math.pow(2, st / 12) * 2, 1.0, 0.11, 0.09 * i);
      });
    },

    restart: function () {
      if (!api.ok()) return;
      noiseVoice(0.5, 'bandpass', 300, 2400, 1.2, 0.1);
      tone('triangle', 110, 330, 0.4, 0.1);
    },

    /* continuous: how close the damp feels */
    setDamp: function (proximity, speedFactor) {
      if (!A.ready || !A.started) return;
      var t = now();
      var p = E.clamp(proximity, 0, 1);
      A.dampGain.gain.setTargetAtTime(A.muted ? 0 : 0.02 + 0.3 * p * p, t, 0.25);
      A.dampFilter.frequency.setTargetAtTime(150 + 900 * p + 120 * speedFactor, t, 0.35);
    },

    setTension: function (v) {
      if (!A.ready || !A.started || !A.drone) return;
      A.drone.gain.setTargetAtTime(A.muted ? 0 : 0.10 + 0.1 * E.clamp(v, 0, 1), now(), 0.4);
    }
  };

  E.Audio = api;
})();
