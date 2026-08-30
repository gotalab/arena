/* EMBER sound: synthesised entirely with WebAudio. No files, no network.
 * Starts only after the player's first input. Silence must never block play,
 * so every call here is defensive (no-ops if audio is unavailable/blocked).
 */
(function (root) {
  'use strict';

  function createAudio() {
    var ctx = null;
    var master = null;
    var dampGain = null;
    var dampOsc = null;
    var dampFilter = null;
    var started = false;
    var chainScale = [0, 3, 5, 7, 10, 12, 15, 19]; // pentatonic-ish rising steps (semitones)

    function ensureContext() {
      if (ctx) return ctx;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);

        // ambient damp drone, always on once started, modulated by proximity
        dampOsc = ctx.createOscillator();
        dampOsc.type = 'sawtooth';
        dampOsc.frequency.value = 42;
        dampFilter = ctx.createBiquadFilter();
        dampFilter.type = 'lowpass';
        dampFilter.frequency.value = 120;
        dampGain = ctx.createGain();
        dampGain.gain.value = 0;
        dampOsc.connect(dampFilter);
        dampFilter.connect(dampGain);
        dampGain.connect(master);
        dampOsc.start();
      } catch (e) {
        ctx = null;
      }
      return ctx;
    }

    function start() {
      if (started) return;
      started = true;
      var c = ensureContext();
      if (c && c.state === 'suspended') {
        c.resume().catch(function () {});
      }
    }

    function now() {
      return ctx ? ctx.currentTime : 0;
    }

    function noiseBuffer(duration) {
      var c = ctx;
      var len = Math.max(1, Math.floor(c.sampleRate * duration));
      var buf = c.createBuffer(1, len, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    function tone(opts) {
      if (!ctx) return;
      var t0 = now();
      var freq = opts.freq || 440;
      var type = opts.type || 'sine';
      var dur = opts.dur || 0.2;
      var gainPeak = opts.gain != null ? opts.gain : 0.4;
      var attack = opts.attack != null ? opts.attack : 0.005;
      var glideTo = opts.glideTo;

      var osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gainPeak), t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    function noiseHit(opts) {
      if (!ctx) return;
      var t0 = now();
      var dur = opts.dur || 0.12;
      var gainPeak = opts.gain != null ? opts.gain : 0.3;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur);
      var filt = ctx.createBiquadFilter();
      filt.type = opts.filterType || 'bandpass';
      filt.frequency.value = opts.filterFreq || 900;
      filt.Q.value = opts.q || 0.9;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gainPeak), t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt);
      filt.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    function launch() {
      if (!ctx) return;
      tone({ freq: 260, glideTo: 520, type: 'triangle', dur: 0.14, gain: 0.3, attack: 0.004 });
    }

    function land() {
      if (!ctx) return;
      noiseHit({ dur: 0.09, gain: 0.28, filterType: 'lowpass', filterFreq: 400, q: 0.6 });
      tone({ freq: 130, type: 'sine', dur: 0.12, gain: 0.2 });
    }

    function bounce() {
      if (!ctx) return;
      tone({ freq: 620, glideTo: 900, type: 'square', dur: 0.1, gain: 0.22 });
      noiseHit({ dur: 0.06, gain: 0.15, filterType: 'highpass', filterFreq: 2200, q: 0.5 });
    }

    function glimmer() {
      if (!ctx) return;
      tone({ freq: 880, type: 'sine', dur: 0.22, gain: 0.28 });
      tone({ freq: 1320, type: 'sine', dur: 0.28, gain: 0.16, attack: 0.03 });
    }

    function chainLink(linkIndex) {
      if (!ctx) return;
      var degree = chainScale[Math.min(linkIndex - 1, chainScale.length - 1)];
      var octave = Math.floor((linkIndex - 1) / chainScale.length);
      var freq = 300 * Math.pow(2, (degree + octave * 12) / 12);
      var gain = Math.min(0.5, 0.18 + linkIndex * 0.03);
      tone({ freq: freq, type: 'sawtooth', dur: 0.16, gain: gain, attack: 0.003 });
    }

    function chainBank(chainLen) {
      if (!ctx || chainLen <= 0) return;
      for (var i = 0; i < 3; i++) {
        (function (idx) {
          setTimeout(function () {
            tone({ freq: 700 + idx * 220, type: 'triangle', dur: 0.16, gain: 0.22 - idx * 0.03 });
          }, idx * 55);
        })(i);
      }
    }

    function gameOver() {
      if (!ctx) return;
      tone({ freq: 300, glideTo: 60, type: 'sawtooth', dur: 0.9, gain: 0.3, attack: 0.01 });
    }

    function updateDampPressure(proximity01) {
      if (!ctx || !dampGain) return;
      var p = Math.max(0, Math.min(1, proximity01));
      var g = 0.02 + p * p * 0.22;
      var f = 120 + p * 520;
      var t = now();
      dampGain.gain.setTargetAtTime(g, t, 0.25);
      dampFilter.frequency.setTargetAtTime(f, t, 0.3);
    }

    return {
      start: start,
      launch: launch,
      land: land,
      bounce: bounce,
      glimmer: glimmer,
      chainLink: chainLink,
      chainBank: chainBank,
      gameOver: gameOver,
      updateDampPressure: updateDampPressure
    };
  }

  root.Ember = root.Ember || {};
  root.Ember.createAudio = createAudio;
})(typeof window !== 'undefined' ? window : this);
