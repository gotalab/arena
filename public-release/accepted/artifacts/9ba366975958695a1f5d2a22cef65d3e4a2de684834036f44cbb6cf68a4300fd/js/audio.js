(function (global) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.dampGain = null;
    this.dampOsc = null;
    this.dampNoise = null;
    this.started = false;
  }

  AudioEngine.prototype.ensure = function () {
    if (!this.ctx) {
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        var len = Math.floor(this.ctx.sampleRate * 1.2);
        var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
        this._initDamp();
      } catch (e) {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
    this.started = !!this.ctx;
  };

  AudioEngine.prototype._initDamp = function () {
    var c = this.ctx;
    this.dampGain = c.createGain();
    this.dampGain.gain.value = 0;
    var osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 52;
    var oG = c.createGain();
    oG.gain.value = 0.5;
    osc.connect(oG);
    oG.connect(this.dampGain);
    osc.start();
    var noise = c.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    var nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 240;
    var nG = c.createGain();
    nG.gain.value = 0.35;
    noise.connect(nf);
    nf.connect(nG);
    nG.connect(this.dampGain);
    noise.start();
    this.dampGain.connect(this.master);
    this.dampOsc = osc;
    this.dampNoise = nG;
  };

  AudioEngine.prototype.setDamp = function (prox) {
    if (!this.ctx || !this.dampGain) return;
    prox = Math.max(0, Math.min(1, prox));
    try {
      var t = this.ctx.currentTime;
      this.dampGain.gain.setTargetAtTime(0.15 * prox, t, 0.4);
      if (this.dampOsc) this.dampOsc.frequency.setTargetAtTime(50 + 16 * prox, t, 0.4);
      if (this.dampNoise) this.dampNoise.gain.setTargetAtTime(0.1 + 0.28 * prox, t, 0.4);
    } catch (e) {}
  };

  AudioEngine.prototype._tone = function (type, f0, f1, dur, gain, when, slide) {
    if (!this.ctx) return;
    try {
      var c = this.ctx;
      var t0 = c.currentTime + (when || 0);
      var o = c.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(Math.max(1, f0), t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (e) {}
  };

  AudioEngine.prototype._noise = function (dur, gain, f0, f1, when) {
    if (!this.ctx || !this.noiseBuf) return;
    try {
      var c = this.ctx;
      var t0 = c.currentTime + (when || 0);
      var s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      var f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.1;
      f.frequency.setValueAtTime(f0 || 800, t0);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f);
      f.connect(g);
      g.connect(this.master);
      s.start(t0);
      s.stop(t0 + dur + 0.03);
    } catch (e) {}
  };

  AudioEngine.prototype.launch = function (power) {
    if (!this.started) return;
    this._tone('sine', 220, 460 + power * 360, 0.16, 0.24);
    this._tone('triangle', 330, 660 + power * 300, 0.1, 0.1, 0.01);
    this._noise(0.18, 0.16 + 0.14 * power, 500, 1700 + power * 900);
  };

  AudioEngine.prototype.land = function () {
    if (!this.started) return;
    this._tone('sine', 175, 68, 0.15, 0.4);
    this._tone('triangle', 120, 90, 0.1, 0.12, 0.005);
    this._noise(0.08, 0.1, 900, 380);
  };

  AudioEngine.prototype.bounce = function (chain) {
    if (!this.started) return;
    var base = 560 + (chain || 0) * 42;
    this._tone('triangle', base, base * 1.5, 0.13, 0.3);
    this._tone('sine', base * 2, base * 2.3, 0.11, 0.12, 0.01);
    this._noise(0.12, 0.16, 1300, 2400);
  };

  AudioEngine.prototype.glimmer = function (chain) {
    if (!this.started) return;
    var notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    var n = notes[(Math.random() * notes.length) | 0];
    if (chain > 0) n *= Math.pow(1.0595, Math.min(chain, 12));
    this._tone('sine', n, null, 0.28, 0.15);
    this._tone('sine', n * 2.02, null, 0.2, 0.06, 0.03);
    this._tone('sine', n * 3.01, null, 0.16, 0.03, 0.06);
  };

  AudioEngine.prototype.chainLink = function (n) {
    if (!this.started) return;
    var f = 330 * Math.pow(2, Math.min(n, 12) / 12);
    this._tone('sine', f, f * 1.02, 0.13, 0.16);
    this._tone('triangle', f * 2, null, 0.17, 0.07, 0.02);
    this._tone('sine', f * 0.5, null, 0.12, 0.05, 0.0);
    if (n >= 4) this._noise(0.09, 0.08 * Math.min(1, n / 8), 2000, 3200);
  };

  AudioEngine.prototype.chainBank = function (len) {
    if (!this.started) return;
    var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
    var steps = Math.max(2, Math.min(len, 6));
    for (var i = 0; i < steps; i++) {
      this._tone('triangle', notes[Math.min(i, notes.length - 1)], null, 0.2, 0.13, i * 0.055);
    }
    this._tone('sine', 1046.5, null, 0.4, 0.08, steps * 0.05);
  };

  AudioEngine.prototype.gameover = function () {
    if (!this.started) return;
    this._tone('sawtooth', 340, 55, 1.4, 0.2);
    this._tone('sine', 170, 38, 1.2, 0.18, 0.06);
    this._noise(1.3, 0.1, 1600, 160, 0.1);
  };

  AudioEngine.prototype.relight = function () {
    if (!this.started) return;
    this._tone('triangle', 300, 760, 0.3, 0.14);
    this._tone('sine', 600, 1200, 0.25, 0.06, 0.04);
  };

  global.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
