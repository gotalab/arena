/* STOMP — procedural sound.  No assets: every cue is synthesised so the whole
 * game is one small self-contained tree.  Nothing here touches the simulation. */
(function (global) {
  'use strict';

  var Snd = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: false,
    ready: false
  };

  try {
    Snd.muted = global.localStorage && global.localStorage.getItem('stomp.muted') === '1';
  } catch (e) { /* sandboxed frame */ }

  Snd.init = function () {
    if (Snd.ready) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    try {
      Snd.ctx = new AC();
      Snd.master = Snd.ctx.createGain();
      Snd.master.gain.value = Snd.muted ? 0 : 0.62;
      Snd.master.connect(Snd.ctx.destination);

      var len = Math.floor(Snd.ctx.sampleRate * 0.5);
      Snd.noiseBuf = Snd.ctx.createBuffer(1, len, Snd.ctx.sampleRate);
      var d = Snd.noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      Snd.ready = true;
    } catch (e) { Snd.ready = false; }
  };

  Snd.resume = function () {
    if (!Snd.ready) Snd.init();
    if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  };

  Snd.setMuted = function (m) {
    Snd.muted = !!m;
    if (Snd.master) Snd.master.gain.setTargetAtTime(Snd.muted ? 0 : 0.62, Snd.ctx.currentTime, 0.02);
    try { global.localStorage && global.localStorage.setItem('stomp.muted', Snd.muted ? '1' : '0'); } catch (e) {}
  };

  function now() { return Snd.ctx.currentTime; }

  /* one enveloped oscillator */
  function tone(o) {
    if (!Snd.ready || Snd.muted) return;
    var t = now() + (o.delay || 0);
    var osc = Snd.ctx.createOscillator();
    var g = Snd.ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) {
      if (o.exp === false) osc.frequency.linearRampToValueAtTime(o.f1, t + o.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    }
    var peak = (o.gain === undefined ? 0.25 : o.gain);
    var atk = o.attack === undefined ? 0.006 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    var last = osc;
    if (o.cutoff) {
      var f = Snd.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      osc.connect(f); last = f;
    }
    last.connect(g);
    g.connect(Snd.master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  /* filtered noise burst */
  function noise(o) {
    if (!Snd.ready || Snd.muted) return;
    var t = now() + (o.delay || 0);
    var src = Snd.ctx.createBufferSource();
    src.buffer = Snd.noiseBuf;
    var f = Snd.ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 900, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f1), t + o.dur);
    f.Q.value = o.q === undefined ? 1.1 : o.q;
    var g = Snd.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain === undefined ? 0.2 : o.gain), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(Snd.master);
    src.start(t);
    src.stop(t + o.dur + 0.05);
  }

  var CUES = {
    bounce_weak: function () {
      tone({ type: 'triangle', f0: 210, f1: 138, dur: 0.13, gain: 0.16, cutoff: 900 });
      noise({ f0: 500, f1: 220, dur: 0.07, gain: 0.05 });
    },
    bounce_normal: function () {
      tone({ type: 'triangle', f0: 330, f1: 226, dur: 0.15, gain: 0.24 });
      tone({ type: 'sine', f0: 660, f1: 452, dur: 0.10, gain: 0.09 });
      noise({ f0: 1500, f1: 500, dur: 0.06, gain: 0.07 });
    },
    bounce_power: function () {
      tone({ type: 'sawtooth', f0: 200, f1: 620, dur: 0.24, gain: 0.16, cutoff: 2200, exp: true });
      tone({ type: 'square', f0: 400, f1: 1240, dur: 0.22, gain: 0.06 });
      tone({ type: 'sine', f0: 1200, f1: 1900, dur: 0.18, gain: 0.05, delay: 0.05 });
      noise({ f0: 900, f1: 3200, dur: 0.20, gain: 0.06 });
    },
    machine_jump: function () {
      tone({ type: 'square', f0: 300, f1: 560, dur: 0.10, gain: 0.10, cutoff: 1600 });
    },
    machine_land: function () {
      tone({ type: 'sine', f0: 140, f1: 70, dur: 0.11, gain: 0.13 });
      noise({ f0: 380, f1: 130, dur: 0.09, gain: 0.07, filter: 'lowpass' });
    },
    top_hit: function (n) {
      var base = [740, 932, 1180][Math.min(n, 3) - 1] || 740;
      tone({ type: 'sine', f0: base, f1: base * 1.5, dur: 0.14, gain: 0.22 });
      tone({ type: 'square', f0: base * 0.5, f1: base * 0.75, dur: 0.09, gain: 0.07, cutoff: 2600 });
      noise({ f0: 2600, f1: 1100, dur: 0.07, gain: 0.10 });
    },
    enemy_defeated: function () {
      noise({ f0: 1800, f1: 260, dur: 0.42, gain: 0.20, filter: 'lowpass' });
      [0, 0.07, 0.14, 0.21].forEach(function (d, i) {
        tone({ type: 'triangle', f0: 660 * Math.pow(1.26, i), f1: 660 * Math.pow(1.26, i) * 1.02,
               dur: 0.24, gain: 0.15, delay: d });
      });
      tone({ type: 'sine', f0: 160, f1: 60, dur: 0.35, gain: 0.18 });
    },
    wrong_side_hit: function () {
      tone({ type: 'sawtooth', f0: 168, f1: 74, dur: 0.30, gain: 0.20, cutoff: 700 });
      tone({ type: 'square', f0: 121, f1: 58, dur: 0.28, gain: 0.12, cutoff: 600 });
      noise({ f0: 300, f1: 120, dur: 0.20, gain: 0.10, filter: 'lowpass' });
    },
    ball_drop: function () {
      tone({ type: 'sine', f0: 420, f1: 52, dur: 0.50, gain: 0.22 });
      tone({ type: 'triangle', f0: 210, f1: 40, dur: 0.46, gain: 0.10 });
      noise({ f0: 700, f1: 90, dur: 0.30, gain: 0.10, filter: 'lowpass' });
    },
    ground_stomp: function () {
      tone({ type: 'sine', f0: 190, f1: 62, dur: 0.16, gain: 0.20 });
      noise({ f0: 1400, f1: 300, dur: 0.13, gain: 0.13 });
    },
    walker_bite: function () {
      tone({ type: 'square', f0: 250, f1: 96, dur: 0.18, gain: 0.14, cutoff: 800 });
      noise({ f0: 420, f1: 150, dur: 0.14, gain: 0.09, filter: 'lowpass' });
    },
    warn: function () {
      tone({ type: 'triangle', f0: 1500, f1: 1500, dur: 0.05, gain: 0.06 });
    },
    tick: function (hot) {
      tone({ type: 'square', f0: hot ? 1180 : 880, f1: hot ? 900 : 700, dur: 0.06, gain: hot ? 0.10 : 0.05 });
    },
    run_end: function () {
      [523, 415, 349, 262].forEach(function (f, i) {
        tone({ type: 'triangle', f0: f, f1: f * 0.995, dur: 0.55, gain: 0.15, delay: i * 0.11 });
      });
      noise({ f0: 900, f1: 100, dur: 0.7, gain: 0.08, filter: 'lowpass' });
    },
    tier_up: function () {
      [0, 0.06, 0.12].forEach(function (d, i) {
        tone({ type: 'square', f0: 620 * Math.pow(1.33, i), f1: 620 * Math.pow(1.33, i), dur: 0.16, gain: 0.09, delay: d, cutoff: 3000 });
      });
    }
  };

  Snd.play = function (cue, arg) {
    if (!Snd.ready || Snd.muted) return;
    var fn = CUES[cue];
    if (fn) { try { fn(arg); } catch (e) { /* never let audio break the frame */ } }
  };

  global.StompAudio = Snd;
})(typeof window !== 'undefined' ? window : globalThis);
