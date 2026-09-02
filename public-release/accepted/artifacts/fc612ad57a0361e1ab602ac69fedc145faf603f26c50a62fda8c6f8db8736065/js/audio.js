/* Lumen Yard — restrained synthesized sound. Nothing plays before first input. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;

  var ctx = null;
  var master = null;
  var amb = null;
  var ambGain = null;
  var enabled = true;
  var started = false;

  function ensure() {
    if (!ctx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) {}
    }
    return ctx;
  }

  function tone(o) {
    if (!ctx || !enabled || !started) return;
    var t0 = ctx.currentTime + (o.t || 0);
    var dur = o.dur || 0.1;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
    if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq), t0 + dur);
    var a = o.a != null ? o.a : 0.008;
    var vol = o.vol != null ? o.vol : 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  function noise(o) {
    if (!ctx || !enabled || !started) return;
    var t0 = ctx.currentTime + (o.t || 0);
    var dur = o.dur || 0.1;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var g = ctx.createGain();
    var vol = o.vol != null ? o.vol : 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var node = src;
    if (o.freq) {
      var f = ctx.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.value = o.freq;
      f.Q.value = o.q || 1;
      src.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  function startAmbient() {
    if (!ctx || amb || !master) return;
    ambGain = ctx.createGain();
    ambGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    ambGain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 2.5);
    var o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 55;
    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 55.7;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 130;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(ambGain);
    ambGain.connect(master);
    o1.start();
    o2.start();
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    var lfoG = ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG);
    lfoG.connect(ambGain.gain);
    lfo.start();
    amb = { o1: o1, o2: o2, lfo: lfo };
  }

  function stopAmbient() {
    if (!amb) return;
    try {
      amb.o1.stop();
      amb.o2.stop();
      amb.lfo.stop();
    } catch (e) {}
    amb = null;
    ambGain = null;
  }

  var Audio = {
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = !!v;
      if (!enabled) stopAmbient();
    },
    start: function () {
      started = true;
      ensure();
      if (enabled) startAmbient();
    },
    ensure: ensure,
    play: function (name) {
      switch (name) {
        case 'step':
          tone({ freq: 330, toFreq: 215, dur: 0.06, vol: 0.05, type: 'sine' });
          noise({ dur: 0.05, vol: 0.035, freq: 2100, q: 1.5 });
          break;
        case 'push':
          tone({ freq: 140, toFreq: 52, dur: 0.18, vol: 0.26, type: 'sine' });
          noise({ dur: 0.16, vol: 0.06, freq: 520, q: 0.7 });
          break;
        case 'seat':
          tone({ freq: 760, dur: 0.05, vol: 0.10, type: 'square' });
          tone({ freq: 1200, dur: 0.1, vol: 0.06, type: 'sine', t: 0.02 });
          noise({ dur: 0.06, vol: 0.05, freq: 3400, q: 2, filter: 'highpass' });
          break;
        case 'seatPush':
          tone({ freq: 130, toFreq: 55, dur: 0.16, vol: 0.24, type: 'sine' });
          tone({ freq: 770, dur: 0.06, vol: 0.10, type: 'square', t: 0.11 });
          tone({ freq: 1210, dur: 0.12, vol: 0.07, type: 'sine', t: 0.13 });
          noise({ dur: 0.08, vol: 0.05, freq: 3000, q: 2, filter: 'highpass', t: 0.11 });
          break;
        case 'block':
          tone({ freq: 165, toFreq: 95, dur: 0.09, vol: 0.19, type: 'sine' });
          noise({ dur: 0.07, vol: 0.055, freq: 320, q: 1 });
          break;
        case 'undo':
          tone({ freq: 480, toFreq: 185, dur: 0.17, vol: 0.085, type: 'sine' });
          noise({ dur: 0.2, vol: 0.025, freq: 1100, q: 0.6 });
          tone({ freq: 300, toFreq: 600, dur: 0.08, vol: 0.045, type: 'sine', t: 0.02 });
          break;
        case 'surge':
          tone({ freq: 110, toFreq: 740, dur: 1.3, vol: 0.12, type: 'sine' });
          tone({ freq: 220, toFreq: 880, dur: 1.3, vol: 0.06, type: 'triangle' });
          noise({ dur: 1.3, vol: 0.035, freq: 1500, q: 0.5 });
          break;
        case 'powered':
          tone({ freq: 523.25, dur: 0.8, vol: 0.075, type: 'sine' });
          tone({ freq: 659.25, dur: 0.8, vol: 0.075, type: 'sine', t: 0.12 });
          tone({ freq: 783.99, dur: 0.9, vol: 0.075, type: 'sine', t: 0.24 });
          tone({ freq: 1046.5, dur: 1.1, vol: 0.05, type: 'sine', t: 0.38 });
          break;
        case 'ui':
          tone({ freq: 620, dur: 0.045, vol: 0.06 });
          break;
        case 'select':
          tone({ freq: 540, dur: 0.05, vol: 0.07 });
          tone({ freq: 720, dur: 0.06, vol: 0.06, t: 0.05 });
          break;
        case 'restart':
          tone({ freq: 520, toFreq: 300, dur: 0.13, vol: 0.09, type: 'sine' });
          break;
        default:
          break;
      }
    },
  };

  Lumen.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
