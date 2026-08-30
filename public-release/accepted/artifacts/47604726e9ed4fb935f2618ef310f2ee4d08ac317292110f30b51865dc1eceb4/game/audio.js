(function (root) {
'use strict';

function createAudio() {
  var ctx = null, master = null, sfxBus = null, engineBus = null;
  var started = false, muted = false;
  var engine = null;

  function ensure() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = 0.85;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.knee.value = 8;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
    engineBus = ctx.createGain(); engineBus.gain.value = 0; engineBus.connect(master);
    buildEngine();
    return true;
  }

  function now() { return ctx.currentTime; }
  function env(gainNode, t0, a, peak, d, sus) {
    var g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sus || peak * 0.4), t0 + a + d);
  }

  function noiseBuffer() {
    var len = ctx.sampleRate | 0;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
  var noiseBuf = null;
  function noise() {
    if (!noiseBuf) noiseBuf = noiseBuffer();
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    return src;
  }

  function buildEngine() {
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 48;
    var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 24.3;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2.2;
    var rumbleSrc = noise();
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 150; bp.Q.value = 0.7;
    var rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.16;
    o1.connect(lp); o2.connect(lp); lp.connect(engineBus);
    rumbleSrc.connect(bp); bp.connect(rumbleGain); rumbleGain.connect(engineBus);
    o1.start(); o2.start(); rumbleSrc.start();
    engine = { o1: o1, o2: o2, lp: lp, bp: bp, rumbleGain: rumbleGain };
  }

  /* ---------- one-shot voices ---------- */

  function blip(freq, dur, type, vol, when) {
    var t0 = when || now();
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    var g = ctx.createGain();
    env(g, t0, 0.006, vol || 0.22, dur || 0.12, 0.0001);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + (dur || 0.12) + 0.08);
    return o;
  }

  function whoosh(vol, sweep) {
    var t0 = now();
    var src = noise();
    var hp = ctx.createBiquadFilter(); hp.type = 'bandpass';
    hp.Q.value = 1.4;
    hp.frequency.setValueAtTime(sweep[0], t0);
    hp.frequency.exponentialRampToValueAtTime(sweep[1], t0 + 0.18);
    var g = ctx.createGain();
    env(g, t0, 0.01, vol, 0.17, 0.0001);
    src.connect(hp); hp.connect(g); g.connect(sfxBus);
    src.start(t0); src.stop(t0 + 0.3);
  }

  function impact(big) {
    var t0 = now();
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(big ? 130 : 110, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.22);
    var g = ctx.createGain();
    env(g, t0, 0.005, big ? 0.6 : 0.42, 0.26, 0.0001);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + 0.32);

    var src = noise();
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = big ? 900 : 500; bp.Q.value = 0.8;
    var ng = ctx.createGain();
    env(ng, t0, 0.004, big ? 0.34 : 0.24, 0.13, 0.0001);
    src.connect(bp); bp.connect(ng); ng.connect(sfxBus);
    src.start(t0); src.stop(t0 + 0.2);
  }

  function crunchShatter(pitch) {
    var t0 = now();
    for (var i = 0; i < 5; i++) {
      var dt = i * 0.03;
      var src = noise();
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = pitch * (1 + i * 0.35) + 700; bp.Q.value = 3.2;
      var g = ctx.createGain();
      env(g, t0 + dt, 0.004, 0.16 / (i * 0.5 + 1), 0.09, 0.0001);
      src.connect(bp); bp.connect(g); g.connect(sfxBus);
      src.start(t0 + dt); src.stop(t0 + dt + 0.16);
    }
  }

  var PENTA = [392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  function fragmentSound(combo) {
    var idx = Math.min(PENTA.length - 1, combo % PENTA.length);
    var f = PENTA[idx];
    blip(f, 0.14, 'triangle', 0.2);
    blip(f * 2, 0.09, 'sine', 0.07, now() + 0.02);
  }

  function powerSound() {
    var base = 523.25;
    var steps = [0, 4, 7, 12];
    for (var i = 0; i < steps.length; i++) {
      var f = base * Math.pow(2, steps[i] / 12);
      blip(f, 0.16, 'square', 0.11, now() + i * 0.06);
    }
    whoosh(0.14, [600, 3800]);
  }

  function grazeSound(combo) {
    whoosh(0.1 + Math.min(0.16, combo * 0.028), [1400 + combo * 220, 520]);
    blip(720 + combo * 66, 0.1, 'sine', 0.1 + combo * 0.02);
  }

  function gameoverSound() {
    var seq = [330, 262, 196, 131];
    for (var i = 0; i < seq.length; i++) {
      blip(seq[i], 0.4, 'triangle', 0.2, now() + i * 0.19);
    }
    var t0 = now() + 0.75;
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(30, t0 + 0.9);
    var g = ctx.createGain();
    env(g, t0, 0.05, 0.14, 0.9, 0.0001);
    o.connect(g); g.connect(sfxBus);
    o.start(t0); o.stop(t0 + 1.1);
  }

  function bestSound() {
    var seq = [659.25, 783.99, 987.77, 1318.5];
    for (var i = 0; i < seq.length; i++)
      blip(seq[i], 0.22, 'triangle', 0.16, now() + 0.45 + i * 0.07);
  }

  function tickLow() { blip(1180, 0.05, 'square', 0.09); }

  function uiTap() { blip(340, 0.06, 'triangle', 0.13); blip(510, 0.05, 'sine', 0.1, now() + 0.03); }

  /* ---------- continuous layer ---------- */

  function update(dtS, s) {
    if (!ctx || !engine) return;
    var sn = Math.max(0, Math.min(1, s.sn));
    var target = started && !muted ? 0.16 + sn * 0.3 : 0;
    engineBus.gain.setTargetAtTime(target, now(), 0.09);
    if (!started || muted) return;
    var rev = 42 + sn * 138 + (s.accel ? 9 : 0);
    engine.o1.frequency.setTargetAtTime(rev, now(), 0.06);
    engine.o2.frequency.setTargetAtTime(rev * 0.502, now(), 0.08);
    engine.lp.frequency.setTargetAtTime(210 + sn * sn * 2600, now(), 0.1);
    engine.bp.frequency.setTargetAtTime(120 + sn * 420, now(), 0.15);
    engine.rumbleGain.gain.setTargetAtTime(0.1 + sn * 0.25, now(), 0.12);
  }

  function init() { started = ensure(); if (started && ctx.state === 'suspended') ctx.resume(); }
  function play(name, opt) {
    if (!ensure() || !started || muted) return;
    opt = opt || {};
    switch (name) {
      case 'fragment': fragmentSound(opt.combo || 0); break;
      case 'power': powerSound(); break;
      case 'graze': grazeSound(opt.combo || 0); break;
      case 'impact': impact(opt.big); break;
      case 'shatter': crunchShatter(300); break;
      case 'gameover': gameoverSound(); break;
      case 'best': bestSound(); break;
      case 'tick': tickLow(); break;
      case 'tap': uiTap(); break;
      default: break;
    }
  }

  return {
    init: init,
    play: play,
    update: update,
    get muted() { return muted; },
    toggleMute: function () { muted = !muted; return muted; },
    get ready() { return !!ctx; }
  };
}

var rootObj = typeof self !== 'undefined' ? self : root;
rootObj.DelveAudio = createAudio;
if (typeof module !== 'undefined' && module.exports) module.exports = { createAudio: createAudio };

})(typeof self !== 'undefined' ? self : this);
