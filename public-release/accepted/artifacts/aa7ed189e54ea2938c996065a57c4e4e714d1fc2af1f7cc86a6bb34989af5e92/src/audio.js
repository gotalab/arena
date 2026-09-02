/* Lumen Yard - a restrained synthesized identity.
   Nothing is created or heard until the player's first input. The game is
   fully understandable in silence. */
(function (global) {
  'use strict';

  function Audio() {
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.enabled = true;
    this.started = false;
  }

  Audio.prototype.start = function () {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch (e) {
      this.ctx = null;
      return;
    }
    this.started = true;
    var ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Yard hum: the current already trembling at the source.
    var humGain = ctx.createGain();
    humGain.gain.value = 0.0;
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 54;
    var osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 81.5;
    var o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.13;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(humGain.gain);
    osc.connect(humGain);
    osc2.connect(o2g);
    o2g.connect(humGain);
    humGain.connect(this.master);
    osc.start(); osc2.start(); lfo.start();
    humGain.gain.setTargetAtTime(0.05, ctx.currentTime, 1.6);
    this.hum = humGain;

    if (ctx.state === 'suspended') ctx.resume();
  };

  Audio.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }
  };

  Audio.prototype._noise = function (dur) {
    var ctx = this.ctx;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var seed = 22222;
    for (var i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      d[i] = ((seed >>> 8) / 8388608 - 1);
    }
    var src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  };

  Audio.prototype._env = function (peak, attack, decay, at) {
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  };

  Audio.prototype._tone = function (type, f0, f1, peak, attack, decay, at, dest) {
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + attack + decay);
    var g = this._env(peak, attack, decay, at);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
    return o;
  };

  Audio.prototype.play = function (name) {
    if (!this.enabled || !this.ctx) return;
    var ctx = this.ctx;
    var t = ctx.currentTime + 0.001;
    var g, src, filt;

    switch (name) {
      case 'step': {
        src = this._noise(0.06);
        filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 1500;
        filt.Q.value = 1.1;
        g = this._env(0.075, 0.004, 0.05, t);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.09);
        this._tone('sine', 190, 130, 0.09, 0.004, 0.06, t);
        break;
      }
      case 'push': {
        // Heavy: a low body under a copper scrape.
        this._tone('sine', 120, 62, 0.3, 0.01, 0.22, t);
        this._tone('triangle', 240, 150, 0.09, 0.008, 0.16, t);
        src = this._noise(0.24);
        filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(2400, t);
        filt.frequency.exponentialRampToValueAtTime(500, t + 0.22);
        g = this._env(0.12, 0.012, 0.2, t);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.28);
        break;
      }
      case 'blocked': {
        this._tone('square', 96, 82, 0.11, 0.006, 0.1, t);
        this._tone('square', 101, 86, 0.07, 0.006, 0.1, t);
        src = this._noise(0.07);
        filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 380;
        filt.Q.value = 3;
        g = this._env(0.1, 0.004, 0.06, t);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.1);
        break;
      }
      case 'undo': {
        // Current running backwards up the cable.
        var o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(300, t);
        o.frequency.exponentialRampToValueAtTime(760, t + 0.19);
        g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(this.master);
        o.start(t); o.stop(t + 0.26);
        break;
      }
      case 'seat': {
        // The heavy click of a relay locking home.
        src = this._noise(0.05);
        filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 900;
        filt.Q.value = 0.9;
        g = this._env(0.16, 0.002, 0.04, t);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.07);
        this._tone('sine', 110, 88, 0.22, 0.003, 0.09, t);
        this._tone('triangle', 880, 880, 0.075, 0.006, 0.36, t + 0.02);
        this._tone('sine', 1320, 1320, 0.045, 0.006, 0.3, t + 0.03);
        break;
      }
      case 'unseat': {
        this._tone('triangle', 520, 320, 0.06, 0.005, 0.12, t);
        this._tone('sine', 120, 90, 0.1, 0.005, 0.1, t);
        break;
      }
      case 'surge': {
        // The wave that wakes the world beyond the yard.
        var chord = [130.8, 196, 261.6, 392, 523.3];
        for (var i = 0; i < chord.length; i++) {
          this._tone('triangle', chord[i], chord[i], 0.075, 0.05 + i * 0.05, 1.5 - i * 0.08, t + i * 0.055);
        }
        src = this._noise(1.4);
        filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(280, t);
        filt.frequency.exponentialRampToValueAtTime(4200, t + 0.75);
        filt.Q.value = 1.4;
        g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.13, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 1.45);
        if (this.hum) {
          this.hum.gain.setTargetAtTime(0.085, t, 0.6);
        }
        break;
      }
      case 'chapter': {
        var motif = [261.6, 392, 523.3];
        for (var m = 0; m < motif.length; m++) {
          this._tone('triangle', motif[m], motif[m], 0.1, 0.02, 0.55, t + m * 0.13);
        }
        break;
      }
      case 'ui': {
        this._tone('triangle', 620, 620, 0.05, 0.004, 0.05, t);
        break;
      }
      case 'open': {
        this._tone('triangle', 420, 700, 0.055, 0.01, 0.1, t);
        break;
      }
      case 'restart': {
        this._tone('sine', 420, 180, 0.09, 0.01, 0.22, t);
        src = this._noise(0.2);
        filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 1200;
        g = this._env(0.06, 0.01, 0.18, t);
        src.connect(filt); filt.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.22);
        break;
      }
    }
  };

  global.LumenAudio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
