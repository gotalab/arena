/* SHOAL — synthesized tide-pool audio. Never touches game state. */
(function (global) {
  "use strict";

  function createAudio() {
    var ctx = null;
    var master = null;
    var ambientGain = null;
    var filter = null;
    var started = false;
    var noiseBuf = null;

    function ensure() {
      if (started) {
        if (ctx && ctx.state === "suspended") ctx.resume();
        return started;
      }
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      noiseBuf = makeNoise(ctx, 1.5);
      filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 420;
      filter.Q.value = 0.7;
      ambientGain = ctx.createGain();
      ambientGain.gain.value = 0;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      src.connect(lp);
      lp.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(master);
      src.start();
      ambientGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 1.2);
      started = true;
      return true;
    }

    function makeNoise(ac, sec) {
      var n = Math.floor(ac.sampleRate * sec);
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var d = buf.getChannelData(0);
      var acc = 0;
      for (var i = 0; i < n; i++) {
        acc = acc * 0.98 + (Math.random() * 2 - 1) * 0.02;
        d[i] = acc * 3;
      }
      return buf;
    }

    function tone(freq, dur, type, gain, at, slide) {
      if (!started) return;
      var t = ctx.currentTime + (at || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
      f.type = "lowpass";
      f.frequency.value = Math.min(2200, freq * 4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f);
      f.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    function click(freq, gain, at) {
      tone(freq, 0.07, "triangle", gain, at, freq * 0.6);
    }

    function snap(at) {
      if (!started) return;
      var t = ctx.currentTime + (at || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(980, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.08);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.12);
    }

    function burst(dur, gain, at) {
      if (!started) return;
      var t = ctx.currentTime + (at || 0);
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      var g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 600;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t);
      src.stop(t + dur);
    }

    var SCALE = [146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63];

    return {
      unlock: ensure,
      hush: function (low) {
        if (!started) return;
        var t = ctx.currentTime;
        filter.frequency.cancelScheduledValues(t);
        filter.frequency.linearRampToValueAtTime(low ? 180 : 420, t + 0.4);
        ambientGain.gain.cancelScheduledValues(t);
        ambientGain.gain.linearRampToValueAtTime(low ? 0.05 : 0.12, t + 0.4);
      },
      turn: function () {
        if (!ensure()) return;
        click(392, 0.09, 0);
      },
      ripple: function (n) {
        if (!ensure()) return;
        var count = Math.min(12, n);
        for (var i = 0; i < count; i++) {
          var note = SCALE[Math.min(SCALE.length - 1, 2 + (i % 5))];
          tone(note * (1 + i * 0.03), 0.11, "sine", 0.045, i * 0.028, note * 1.4);
        }
      },
      flag: function () {
        if (!ensure()) return;
        snap(0);
      },
      unflag: function () {
        if (!ensure()) return;
        click(240, 0.05, 0);
      },
      sweep: function (n) {
        if (!ensure()) return;
        tone(330, 0.16, "triangle", 0.07, 0, 520);
        this.ripple(Math.max(3, n));
      },
      sting: function () {
        if (!ensure()) return;
        burst(0.35, 0.2, 0);
        tone(110, 0.5, "sawtooth", 0.12, 0, 55);
        tone(165, 0.4, "square", 0.05, 0.02, 70);
      },
      clear: function () {
        if (!ensure()) return;
        tone(392, 0.25, "sine", 0.08, 0, 784);
        tone(494, 0.3, "sine", 0.07, 0.08, 988);
        tone(587, 0.4, "triangle", 0.06, 0.16);
      },
      ceremony: function () {
        if (!ensure()) return;
        tone(196, 0.6, "sine", 0.07, 0);
        tone(247, 0.7, "sine", 0.05, 0.12);
        tone(311, 0.9, "triangle", 0.04, 0.28);
      },
    };
  }

  global.createShoalAudio = createAudio;
})(typeof window !== "undefined" ? window : globalThis);
