/* SHOAL - sound, synthesised in the page.

   One family: soft sine bells over filtered water noise, tuned to a pentatonic
   scale. Sound starts only after the player's first input, and the game plays
   perfectly with it switched off. Audio never touches the rules or the clock. */
(function (g) {
  'use strict';

  var S = g.SHOAL;

  var ctx = null;
  var master = null;
  var ambientGain = null;
  var hushFilter = null;
  var enabled = true;
  var started = false;
  var hushing = false;

  // C minor pentatonic, the pool's voice
  var SCALE = [261.63, 311.13, 349.23, 392.0, 466.16, 523.25, 622.25, 698.46, 784.0, 932.33];

  function now() { return ctx ? ctx.currentTime : 0; }

  var sharedNoise = null;

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  function start() {
    if (started) {
      // Autoplay policies can leave the context suspended until a gesture.
      if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
      return;
    }
    if (!enabled) return;
    var AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      sharedNoise = noiseBuffer(2.5);
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      // water at rest
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(3);
      src.loop = true;
      hushFilter = ctx.createBiquadFilter();
      hushFilter.type = 'lowpass';
      hushFilter.frequency.value = 900;
      hushFilter.Q.value = 0.6;
      ambientGain = ctx.createGain();
      ambientGain.gain.value = 0.0;
      src.connect(hushFilter);
      hushFilter.connect(ambientGain);
      ambientGain.connect(master);
      src.start();
      ambientGain.gain.linearRampToValueAtTime(0.09, now() + 2.2);

      // a slow swell, like water breathing
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain);
      lfoGain.connect(hushFilter.frequency);
      lfo.start();

      started = true;
    } catch (e) {
      ctx = null;
    }
  }

  function bell(freq, when, dur, gain, type, detune) {
    if (!ctx || !enabled) return;
    try {
      var t = now() + (when || 0);
      var osc = ctx.createOscillator();
      var g1 = ctx.createGain();
      var filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(Math.min(9000, freq * 6), t);
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (detune) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * detune), t + dur);
      g1.gain.setValueAtTime(0.0001, t);
      g1.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
      g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(filt);
      filt.connect(g1);
      g1.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    } catch (e) { /* sound is seasoning */ }
  }

  function splash(when, dur, gain, freq, q) {
    if (!ctx || !enabled) return;
    try {
      var t = now() + (when || 0);
      var src = ctx.createBufferSource();
      src.buffer = sharedNoise;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, t);
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.45), t + dur);
      bp.Q.value = q || 1.1;
      var g1 = ctx.createGain();
      g1.gain.setValueAtTime(gain, t);
      g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp);
      bp.connect(g1);
      g1.connect(master);
      // A random window into one shared noise buffer keeps every splash
      // distinct without allocating a buffer per sound.
      src.start(t, Math.random() * 1.6, dur + 0.05);
    } catch (e) { /* ignore */ }
  }

  var api = {
    start: start,
    isOn: function () { return enabled; },
    setEnabled: function (v) {
      enabled = !!v;
      if (!ctx) { if (enabled) start(); return; }
      try {
        master.gain.cancelScheduledValues(now());
        master.gain.linearRampToValueAtTime(enabled ? 0.9 : 0.0001, now() + 0.15);
      } catch (e) { /* ignore */ }
    },

    // one shell turning over
    tick: function (value) {
      splash(0, 0.16, 0.16, 1500, 1.4);
      bell(SCALE[3 + Math.min(5, value | 0)] * 0.5, 0, 0.22, 0.05, 'sine');
    },

    // the ripple: a run up the scale as the water travels
    ripple: function (count) {
      var n = Math.min(11, Math.max(2, count));
      for (var i = 0; i < n; i++) {
        var d = i * 0.045;
        bell(SCALE[Math.min(SCALE.length - 1, i)], d, 0.34, 0.055, 'sine');
        if (i % 3 === 0) splash(d, 0.22, 0.09, 1100 + i * 220, 0.9);
      }
      if (count >= 10) bell(SCALE[0] * 2, 0.12, 0.9, 0.05, 'triangle');
    },

    flag: function (on) {
      splash(0, 0.07, 0.13, on ? 2600 : 1500, 3.2);
      bell(on ? 880 : 560, 0, 0.1, 0.06, 'triangle', on ? 1.25 : 0.8);
    },

    sweep: function () {
      splash(0, 0.3, 0.16, 2400, 0.8);
      bell(SCALE[2], 0, 0.3, 0.05, 'sine', 1.6);
    },

    sting: function () {
      splash(0, 0.55, 0.3, 900, 0.7);
      bell(180, 0, 0.7, 0.16, 'sawtooth', 0.25);
      bell(90, 0.02, 1.0, 0.13, 'triangle', 0.4);
      bell(1200, 0, 0.18, 0.07, 'square', 0.2);
    },

    clear: function () {
      for (var i = 0; i < 5; i++) bell(SCALE[i + 2], i * 0.075, 0.6, 0.07, 'sine');
      bell(SCALE[0] * 2, 0.3, 1.4, 0.05, 'triangle');
    },

    ceremony: function () {
      bell(SCALE[0], 0, 2.2, 0.05, 'sine');
      bell(SCALE[2], 0.05, 2.0, 0.04, 'sine');
      bell(SCALE[4], 0.1, 1.8, 0.035, 'sine');
    },

    // the tide running low pulls the water down into a hush
    hush: function (on) {
      if (!ctx || hushing === on) return;
      hushing = on;
      try {
        hushFilter.frequency.cancelScheduledValues(now());
        hushFilter.frequency.linearRampToValueAtTime(on ? 320 : 900, now() + 1.2);
        ambientGain.gain.linearRampToValueAtTime(on ? 0.055 : 0.09, now() + 1.2);
        if (on) bell(SCALE[0] * 0.5, 0, 2.6, 0.045, 'sine');
      } catch (e) { /* ignore */ }
    },

    poolStart: function () {
      bell(SCALE[5], 0, 0.5, 0.05, 'sine');
      bell(SCALE[7], 0.08, 0.7, 0.035, 'sine');
    }
  };

  S.audio = api;
})(window);
