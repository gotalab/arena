// Lumen Yard - tiny synthesized sound identity. No external assets.
(function (root) {
  'use strict';

  function LumenAudio() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.unlocked = false;
  }

  LumenAudio.prototype.setEnabled = function (enabled) {
    this.enabled = enabled;
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.85 : 0, this._now(), 0.02);
    }
  };

  LumenAudio.prototype._now = function () {
    return this.ctx ? this.ctx.currentTime : 0;
  };

  // Must be called from a user gesture handler (touch/click/key).
  LumenAudio.prototype.unlock = function () {
    if (this.unlocked) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    this.master.connect(this.ctx.destination);
    this.unlocked = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };

  LumenAudio.prototype._env = function (gainNode, t0, attack, hold, decay, peak) {
    var g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    g.setValueAtTime(peak, t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
  };

  LumenAudio.prototype._tone = function (freq, opts) {
    if (!this.unlocked || !this.enabled) return;
    opts = opts || {};
    var ctx = this.ctx;
    var t0 = ctx.currentTime + (opts.delay || 0);
    var osc = ctx.createOscillator();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + (opts.dur || 0.2));
    }
    var gain = ctx.createGain();
    this._env(gain, t0, opts.attack || 0.005, opts.hold || 0.02, opts.decay || 0.16, opts.peak || 0.35);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + (opts.attack || 0.005) + (opts.hold || 0.02) + (opts.decay || 0.16) + 0.05);
  };

  LumenAudio.prototype._noiseBurst = function (opts) {
    if (!this.unlocked || !this.enabled) return;
    opts = opts || {};
    var ctx = this.ctx;
    var dur = opts.dur || 0.12;
    var buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.value = opts.filterFreq || 900;
    var gain = ctx.createGain();
    gain.gain.value = opts.peak || 0.25;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(ctx.currentTime + (opts.delay || 0));
  };

  LumenAudio.prototype.step = function () {
    this._tone(340, { type: 'triangle', peak: 0.12, attack: 0.003, hold: 0.01, decay: 0.06 });
  };

  LumenAudio.prototype.push = function () {
    this._tone(120, { type: 'square', peak: 0.28, attack: 0.005, hold: 0.03, decay: 0.16, sweepTo: 90, dur: 0.16 });
    this._noiseBurst({ dur: 0.08, peak: 0.12, filterFreq: 500 });
  };

  LumenAudio.prototype.blocked = function () {
    this._tone(90, { type: 'sawtooth', peak: 0.18, attack: 0.001, hold: 0.02, decay: 0.1, sweepTo: 60, dur: 0.1 });
  };

  LumenAudio.prototype.undo = function () {
    this._tone(260, { type: 'triangle', peak: 0.22, attack: 0.005, hold: 0.02, decay: 0.14, sweepTo: 460, dur: 0.16 });
  };

  LumenAudio.prototype.socket = function () {
    this._tone(660, { type: 'sine', peak: 0.3, attack: 0.004, hold: 0.03, decay: 0.22, sweepTo: 880, dur: 0.2 });
    this._tone(990, { type: 'sine', peak: 0.14, attack: 0.004, hold: 0.02, decay: 0.18, delay: 0.03 });
  };

  LumenAudio.prototype.surge = function (big) {
    var self = this;
    if (!this.unlocked || !this.enabled) return;
    var notes = big ? [440, 554, 659, 880, 1108] : [440, 659, 880];
    notes.forEach(function (f, i) {
      self._tone(f, {
        type: 'sine', peak: big ? 0.28 : 0.22, attack: 0.01, hold: 0.08,
        decay: big ? 0.9 : 0.5, delay: i * 0.05
      });
    });
    this._noiseBurst({ dur: big ? 0.5 : 0.25, peak: big ? 0.18 : 0.1, filterFreq: 1400, delay: 0.02 });
  };

  LumenAudio.prototype.selectLevel = function () {
    this._tone(220, { type: 'triangle', peak: 0.16, attack: 0.004, hold: 0.02, decay: 0.12, sweepTo: 330, dur: 0.14 });
  };

  root.LumenAudio = LumenAudio;
})(typeof window !== 'undefined' ? window : this);
