/* STOMP - procedural audio. No samples; everything is synthesised so the
 * artifact stays self-contained. The context is created on the first gesture
 * to respect autoplay policy. */
(function (global) {
  'use strict';

  function Audio() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.hum = null;
    this.lastTick = -1;
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch (e) { return null; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    var comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    this.master.connect(comp).connect(this.ctx.destination);
    this.startHum();
    return this.ctx;
  };

  Audio.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  };
  Audio.prototype.toggle = function () { this.ensure(); this.setMuted(!this.muted); return this.muted; };

  Audio.prototype.startHum = function () {
    var c = this.ctx;
    var g = c.createGain(); g.gain.value = 0.035;
    var o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
    var o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 82.5;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    var lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    var lfoG = c.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(lp.frequency);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master);
    o1.start(); o2.start(); lfo.start();
    this.hum = g;
  };

  Audio.prototype.env = function (node, t0, a, d, peak) {
    var g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  };

  Audio.prototype.tone = function (opt) {
    var c = this.ensure();
    if (!c) return;
    var t0 = c.currentTime + (opt.delay || 0);
    var o = c.createOscillator();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t0 + (opt.sweep || opt.d || 0.2));
    var g = c.createGain();
    var chain = o;
    if (opt.filter) {
      var bp = c.createBiquadFilter();
      bp.type = opt.filter;
      bp.frequency.value = opt.fc || 900;
      bp.Q.value = opt.q || 1;
      o.connect(bp); chain = bp;
    }
    chain.connect(g).connect(this.master);
    this.env(g, t0, opt.a || 0.005, opt.d || 0.18, opt.v || 0.25);
    o.start(t0);
    o.stop(t0 + (opt.a || 0.005) + (opt.d || 0.18) + 0.05);
  };

  Audio.prototype.noise = function (opt) {
    var c = this.ensure();
    if (!c) return;
    var t0 = c.currentTime + (opt.delay || 0);
    var dur = (opt.d || 0.2) + 0.05;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = opt.filter || 'bandpass';
    bp.frequency.setValueAtTime(opt.fc || 1200, t0);
    if (opt.fc1) bp.frequency.exponentialRampToValueAtTime(Math.max(60, opt.fc1), t0 + (opt.d || 0.2));
    bp.Q.value = opt.q || 1.2;
    var g = c.createGain();
    src.connect(bp).connect(g).connect(this.master);
    this.env(g, t0, opt.a || 0.004, opt.d || 0.2, opt.v || 0.2);
    src.start(t0);
  };

  Audio.prototype.bounce = function (kind) {
    if (kind === 'weak') {
      this.tone({ type: 'triangle', f0: 200, f1: 150, d: 0.13, v: 0.16 });
      this.noise({ fc: 700, d: 0.06, v: 0.05 });
    } else if (kind === 'power') {
      this.tone({ type: 'square', f0: 300, f1: 760, sweep: 0.1, d: 0.2, v: 0.16, filter: 'lowpass', fc: 2400 });
      this.tone({ type: 'sine', f0: 150, f1: 420, sweep: 0.12, d: 0.24, v: 0.22 });
      this.noise({ fc: 2600, fc1: 900, d: 0.16, v: 0.1 });
    } else {
      this.tone({ type: 'triangle', f0: 300, f1: 470, sweep: 0.07, d: 0.16, v: 0.2 });
      this.noise({ fc: 1500, d: 0.07, v: 0.06 });
    }
  };

  Audio.prototype.jump = function () {
    this.tone({ type: 'square', f0: 180, f1: 520, sweep: 0.13, d: 0.16, v: 0.09, filter: 'lowpass', fc: 1800 });
  };
  Audio.prototype.land = function () {
    this.noise({ filter: 'lowpass', fc: 420, d: 0.1, v: 0.13 });
  };

  Audio.prototype.topHit = function (n) {
    var base = 420 + (n - 1) * 150;
    this.tone({ type: 'square', f0: base, f1: base * 1.5, sweep: 0.04, d: 0.1, v: 0.16, filter: 'bandpass', fc: base * 2, q: 2 });
    this.tone({ type: 'sine', f0: base * 2.2, d: 0.13, v: 0.1 });
    this.noise({ fc: 3200 + n * 800, fc1: 1200, d: 0.12, v: 0.13, q: 0.8 });
  };

  Audio.prototype.defeat = function () {
    var self = this;
    [0, 4, 7, 12].forEach(function (semi, i) {
      var fq = 330 * Math.pow(2, semi / 12);
      self.tone({ type: 'triangle', f0: fq, d: 0.5, v: 0.15, delay: i * 0.045 });
      self.tone({ type: 'square', f0: fq * 2, d: 0.2, v: 0.05, delay: i * 0.045, filter: 'lowpass', fc: 3000 });
    });
    this.noise({ fc: 3600, fc1: 260, d: 0.5, v: 0.2, q: 0.6 });
    this.tone({ type: 'sine', f0: 110, f1: 44, sweep: 0.35, d: 0.45, v: 0.24 });
  };

  Audio.prototype.wrongSide = function () {
    this.tone({ type: 'sawtooth', f0: 190, f1: 92, sweep: 0.2, d: 0.3, v: 0.2, filter: 'lowpass', fc: 900 });
    this.tone({ type: 'square', f0: 96, d: 0.28, v: 0.14 });
    this.noise({ fc: 420, d: 0.22, v: 0.1 });
  };

  Audio.prototype.drop = function () {
    this.tone({ type: 'sine', f0: 210, f1: 46, sweep: 0.42, d: 0.5, v: 0.3 });
    this.noise({ filter: 'lowpass', fc: 500, fc1: 120, d: 0.38, v: 0.2 });
  };

  Audio.prototype.stomp = function () {
    this.noise({ filter: 'lowpass', fc: 900, fc1: 200, d: 0.16, v: 0.2 });
    this.tone({ type: 'square', f0: 130, f1: 78, sweep: 0.1, d: 0.14, v: 0.14 });
  };

  Audio.prototype.tick = function (sec) {
    if (sec === this.lastTick) return;
    this.lastTick = sec;
    this.tone({ type: 'square', f0: 1250, d: 0.05, v: 0.12, filter: 'bandpass', fc: 1400, q: 4 });
  };

  Audio.prototype.over = function () {
    var self = this;
    [0, -3, -7, -12].forEach(function (s, i) {
      self.tone({ type: 'triangle', f0: 300 * Math.pow(2, s / 12), d: 0.6, v: 0.14, delay: i * 0.11 });
    });
    this.noise({ filter: 'lowpass', fc: 700, fc1: 100, d: 0.7, v: 0.12 });
  };

  global.StompAudio = new Audio();
})(window);
