/* LUMEN YARD - synthesized yard voice.
   No audio files. Nothing sounds before the first player input, and the whole
   game stays readable with sound switched off. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});

  function Audio() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.humGain = null;
    this.started = false;
    this.noiseBuffer = null;
  }

  Audio.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (this.master && this.ctx) {
      var t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.enabled ? 1 : 0, t, 0.05);
    }
    if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
  };

  /* Called from the first real user gesture only. */
  Audio.prototype.start = function () {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
      return;
    }
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch (e) {
      return;
    }
    this.started = true;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.master.connect(this.ctx.destination);

    var len = Math.floor(this.ctx.sampleRate * 0.5);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    // A dormant substation hum under everything.
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0.0;
    this.humGain.connect(this.master);
    var osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;
    var osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 110.3;
    var g2 = this.ctx.createGain();
    g2.gain.value = 0.35;
    osc2.connect(g2).connect(this.humGain);
    osc.connect(this.humGain);
    osc.start();
    osc2.start();
    this.hum = osc;
    this.setHum(0.03);
  };

  Audio.prototype.setHum = function (level) {
    if (!this.ctx || !this.humGain) return;
    this.humGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.6);
  };

  Audio.prototype._ready = function () {
    if (!this.enabled || !this.ctx) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
    return true;
  };

  Audio.prototype._noise = function (when, dur, gain, type, freq, q) {
    var src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    var filt = this.ctx.createBiquadFilter();
    filt.type = type || 'bandpass';
    filt.frequency.value = freq || 1200;
    filt.Q.value = q || 1;
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(when);
    src.stop(when + dur + 0.05);
  };

  Audio.prototype._tone = function (when, dur, freq, freq2, gain, type) {
    var osc = this.ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, when);
    if (freq2 && freq2 !== freq) osc.frequency.exponentialRampToValueAtTime(freq2, when + dur);
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), when + Math.min(0.015, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(this.master);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  };

  Audio.prototype.step = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._noise(t, 0.055, 0.05, 'bandpass', 2400, 1.6);
    this._tone(t, 0.07, 150, 110, 0.05, 'triangle');
  };

  Audio.prototype.push = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.20, 96, 58, 0.13, 'sawtooth');
    this._noise(t, 0.20, 0.055, 'bandpass', 700, 0.8);
    this._tone(t + 0.02, 0.10, 220, 180, 0.03, 'triangle');
  };

  Audio.prototype.blocked = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.09, 132, 96, 0.10, 'square');
    this._tone(t + 0.005, 0.07, 98, 74, 0.07, 'square');
    this._noise(t, 0.08, 0.05, 'lowpass', 900, 0.7);
  };

  Audio.prototype.seat = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.09, 70, 52, 0.14, 'sine');
    this._noise(t, 0.05, 0.06, 'bandpass', 3000, 2);
    this._tone(t + 0.03, 0.55, 784, 784, 0.055, 'sine');
    this._tone(t + 0.03, 0.55, 1176, 1176, 0.022, 'sine');
  };

  Audio.prototype.unseat = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.18, 420, 220, 0.045, 'sine');
  };

  Audio.prototype.undo = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.20, 200, 480, 0.055, 'triangle');
    this._noise(t, 0.18, 0.03, 'bandpass', 1800, 3);
  };

  Audio.prototype.restart = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.30, 320, 150, 0.05, 'triangle');
    this._noise(t, 0.30, 0.03, 'lowpass', 1400, 0.7);
  };

  Audio.prototype.surge = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    var notes = [196, 294, 392, 588, 784];
    for (var i = 0; i < notes.length; i++) {
      var when = t + i * 0.085;
      this._tone(when, 1.5 - i * 0.12, notes[i], notes[i], 0.075, 'sine');
      this._tone(when, 0.9, notes[i] * 2, notes[i] * 2, 0.018, 'sine');
    }
    this._noise(t, 1.1, 0.05, 'highpass', 900, 0.6);
    this._tone(t, 1.8, 49, 98, 0.10, 'sine');
    this.setHum(0.055);
  };

  Audio.prototype.chapter = function () {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    var notes = [261.6, 392, 523.2, 659.3];
    for (var i = 0; i < notes.length; i++) {
      this._tone(t + i * 0.13, 1.6, notes[i], notes[i], 0.06, 'sine');
    }
  };

  Audio.prototype.ui = function (up) {
    if (!this._ready()) return;
    var t = this.ctx.currentTime;
    this._tone(t, 0.06, up ? 660 : 494, up ? 880 : 415, 0.035, 'sine');
  };

  LY.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
