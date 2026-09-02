/* SHOAL - the voice of the pool.
   One family: filtered water noise underneath, a D-minor-pentatonic set of
   soft sine/triangle voices on top. Everything is synthesised here; nothing
   is fetched. Sound never touches rule state and the game plays perfectly in
   silence. */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});

  // D minor pentatonic, two and a half octaves of it
  var SCALE = [146.83, 174.61, 196.00, 220.00, 261.63,
               293.66, 349.23, 392.00, 440.00, 523.25,
               587.33, 698.46, 784.00, 880.00, 1046.50];

  S.createAudio = function () {
    var ctx = null, master = null, wet = null, noiseBuf = null;
    var ambGain = null, hushGain = null, started = false, muted = false;

    function makeNoise() {
      var len = Math.floor(ctx.sampleRate * 2.2);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0, seed = 12345;
      for (var i = 0; i < len; i++) {
        // deterministic-ish brown noise; audio never feeds back into the game
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        var white = (seed / 4294967296) * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.2;
      }
      return buf;
    }

    function start() {
      if (started) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      started = true;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);

      var conv = ctx.createGain();          // a cheap "space" bus
      conv.gain.value = 0.5;
      conv.connect(master);
      wet = conv;

      noiseBuf = makeNoise();

      // water at rest
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
      ambGain = ctx.createGain(); ambGain.gain.value = 0.10;
      src.connect(lp); lp.connect(ambGain); ambGain.connect(master);
      src.start();

      // slow swell on the water
      var lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 0.07; lfoG.gain.value = 180;
      lfo.connect(lfoG); lfoG.connect(lp.frequency);
      lfo.start();

      // the hush that rises as the tide runs low (silent until asked for)
      var hs = ctx.createBufferSource();
      hs.buffer = noiseBuf; hs.loop = true;
      var hf = ctx.createBiquadFilter();
      hf.type = 'bandpass'; hf.frequency.value = 180; hf.Q.value = 1.4;
      hushGain = ctx.createGain(); hushGain.gain.value = 0;
      hs.connect(hf); hf.connect(hushGain); hushGain.connect(master);
      hs.start();
    }

    function now() { return ctx.currentTime; }
    function ready() { return started && ctx && ctx.state !== 'closed'; }

    function resume() {
      if (ready() && ctx.state === 'suspended') ctx.resume();
    }

    function voice(freq, t0, dur, type, peak, detune) {
      var o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (detune) o.detune.setValueAtTime(detune, t0);
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(master);
      var send = ctx.createGain(); send.gain.value = 0.35;
      gn.connect(send); send.connect(wet);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }

    function noise(t0, dur, type, freq, Q, peak, sweepTo) {
      var s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.playbackRate.value = 1;
      var f = ctx.createBiquadFilter();
      f.type = type; f.frequency.setValueAtTime(freq, t0);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
      f.Q.value = Q;
      var gn = ctx.createGain();
      gn.gain.setValueAtTime(0.0001, t0);
      gn.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(gn); gn.connect(master);
      s.start(t0, (s.buffer.duration - dur - 0.05) * 0.5);
      s.stop(t0 + dur + 0.05);
    }

    var api = {
      start: function () { start(); resume(); },
      isMuted: function () { return muted; },
      toggle: function () {
        muted = !muted;
        if (ready()) master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.05);
        return muted;
      },
      // the tick of a turned shell; pitch carries the number
      tick: function (value) {
        if (!ready() || muted) return;
        var t = now();
        var f = SCALE[Math.min(SCALE.length - 1, 4 + (value | 0))];
        voice(f, t, 0.16, 'sine', 0.16);
        noise(t, 0.05, 'bandpass', 900, 2.0, 0.05);
      },
      // the spreading ripple, rising in pitch as it travels
      ripple: function (steps) {
        if (!ready() || muted) return;
        var t = now(), k = Math.min(steps, 14);
        for (var i = 0; i < k; i++) {
          var f = SCALE[Math.min(SCALE.length - 1, 3 + i)];
          voice(f, t + i * 0.045, 0.22 + i * 0.01, 'sine', 0.09);
        }
        noise(t, 0.28 + k * 0.02, 'lowpass', 300, 0.7, 0.06, 1400);
      },
      flag: function () {
        if (!ready() || muted) return;
        var t = now();
        noise(t, 0.06, 'bandpass', 1800, 3.0, 0.10);
        voice(880, t, 0.09, 'triangle', 0.10);
      },
      unflag: function () {
        if (!ready() || muted) return;
        var t = now();
        voice(392, t, 0.10, 'triangle', 0.07);
      },
      sweep: function () {
        if (!ready() || muted) return;
        var t = now();
        noise(t, 0.30, 'bandpass', 500, 1.2, 0.12, 2600);
      },
      sting: function () {
        if (!ready() || muted) return;
        var t = now();
        noise(t, 0.55, 'lowpass', 2600, 0.9, 0.30, 90);
        var o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(41, t + 0.85);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900;
        o.connect(lp); lp.connect(gn); gn.connect(master);
        o.start(t); o.stop(t + 0.95);
        if (hushGain) hushGain.gain.setTargetAtTime(0, t, 0.2);
      },
      clear: function () {
        if (!ready() || muted) return;
        var t = now();
        var notes = [5, 7, 9, 11, 13];
        for (var i = 0; i < notes.length; i++) {
          voice(SCALE[notes[i]], t + i * 0.075, 0.5, 'sine', 0.13);
          voice(SCALE[notes[i]] * 1.005, t + i * 0.075, 0.5, 'sine', 0.06);
        }
      },
      ceremony: function () {
        if (!ready() || muted) return;
        var t = now() + 0.15;
        var chord = [0, 2, 4, 7];
        for (var i = 0; i < chord.length; i++) {
          var o = ctx.createOscillator(), gn = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = SCALE[chord[i]];
          gn.gain.setValueAtTime(0.0001, t);
          gn.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
          o.connect(gn); gn.connect(master);
          o.start(t); o.stop(t + 3.3);
        }
      },
      // the pool holds its breath as the tide runs out
      tide: function (fraction, playing) {
        if (!ready() || !hushGain) return;
        var want = (playing && fraction < 0.3) ? (0.3 - fraction) * 0.28 : 0;
        hushGain.gain.setTargetAtTime(want, now(), 0.4);
        if (ambGain) ambGain.gain.setTargetAtTime(playing ? 0.10 : 0.07, now(), 0.8);
      }
    };
    return api;
  };
})();
