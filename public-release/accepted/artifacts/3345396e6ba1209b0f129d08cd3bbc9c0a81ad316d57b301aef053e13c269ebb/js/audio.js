/**
 * DELVE — synthesised audio. Starts only after first user input.
 * Never touches simulation state.
 */
(function (root) {
  "use strict";

  function DelveAudio() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.engine = null;
    this.edge = null;
    this.powerGain = null;
    this.powerOsc = [];
    this.master = null;
  }

  DelveAudio.prototype._boot = function () {
    if (this.ctx) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    var ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(ctx.destination);

    var eg = ctx.createGain();
    eg.gain.value = 0;
    var oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    oscA.frequency.value = 48;
    var oscB = ctx.createOscillator();
    oscB.type = "triangle";
    oscB.frequency.value = 96;
    var filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 280;
    filt.Q.value = 0.7;
    oscA.connect(filt);
    oscB.connect(filt);
    filt.connect(eg);
    eg.connect(this.master);
    oscA.start();
    oscB.start();
    this.engine = { eg: eg, oscA: oscA, oscB: oscB, filt: filt };

    var edgeG = ctx.createGain();
    edgeG.gain.value = 0;
    var edgeO = ctx.createOscillator();
    edgeO.type = "sine";
    edgeO.frequency.value = 220;
    var edgeF = ctx.createBiquadFilter();
    edgeF.type = "highpass";
    edgeF.frequency.value = 180;
    edgeO.connect(edgeF);
    edgeF.connect(edgeG);
    edgeG.connect(this.master);
    edgeO.start();
    this.edge = { g: edgeG, o: edgeO };

    var pg = ctx.createGain();
    pg.gain.value = 0;
    pg.connect(this.master);
    this.powerGain = pg;
    var freqs = [196, 247, 311];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freqs[i];
      var g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g);
      g.connect(pg);
      o.start();
      this.powerOsc.push(o);
    }
  };

  DelveAudio.prototype.unlock = function () {
    this._boot();
    if (!this.ctx) return;
    this.started = true;
    if (this.ctx.state === "suspended") this.ctx.resume();
  };

  DelveAudio.prototype.toggleMute = function () {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  };

  DelveAudio.prototype._now = function () {
    return this.ctx ? this.ctx.currentTime : 0;
  };

  DelveAudio.prototype.beep = function (freq, dur, type, gain, slide) {
    if (!this.started || this.muted || !this.ctx) return;
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    o.type = type || "sine";
    var g = ctx.createGain();
    var t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };

  DelveAudio.prototype.noiseBurst = function (dur, gain, hp) {
    if (!this.started || this.muted || !this.ctx) return;
    var ctx = this.ctx;
    var n = 0.25 * ctx.sampleRate;
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = hp || 400;
    var g = ctx.createGain();
    var t = ctx.currentTime;
    g.gain.setValueAtTime(gain || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  };

  DelveAudio.prototype.fragment = function () {
    this.beep(720, 0.12, "sine", 0.1, 1440);
    this.beep(1080, 0.16, "triangle", 0.06, 540);
  };

  DelveAudio.prototype.power = function () {
    this.beep(196, 0.4, "sine", 0.1, 392);
    this.beep(247, 0.45, "triangle", 0.07, 494);
    this.beep(311, 0.5, "sine", 0.05, 622);
  };

  DelveAudio.prototype.collision = function (heavy) {
    this.noiseBurst(heavy ? 0.28 : 0.18, heavy ? 0.28 : 0.18, 180);
    this.beep(heavy ? 70 : 90, 0.22, "sine", 0.18, 32);
  };

  DelveAudio.prototype.nearMiss = function (streak) {
    var s = Math.min(6, streak || 1);
    this.beep(440 + s * 90, 0.09, "sine", 0.05 + s * 0.012, 880 + s * 80);
    this.noiseBurst(0.08 + s * 0.015, 0.06 + s * 0.02, 900);
  };

  DelveAudio.prototype.gameover = function () {
    this.beep(220, 0.7, "sine", 0.12, 55);
    this.beep(165, 0.9, "triangle", 0.08, 40);
  };

  DelveAudio.prototype.rockBreak = function (powered) {
    this.noiseBurst(0.12, powered ? 0.14 : 0.1, powered ? 700 : 500);
    if (powered) this.beep(520, 0.1, "square", 0.04, 180);
  };

  DelveAudio.prototype.tick = function (snap, combo) {
    if (!this.started || this.muted || !this.engine) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    var t = this.ctx.currentTime;
    var span = 0;
    if (snap.maxSpeed) span = Math.max(0, Math.min(1, (snap.speed - 90) / (snap.maxSpeed - 90)));
    var playing = snap.phase === "playing";
    var targetGain = playing ? 0.03 + span * 0.07 : snap.phase === "ready" ? 0.012 : 0.004;
    this.engine.eg.gain.setTargetAtTime(targetGain, t, 0.08);
    this.engine.oscA.frequency.setTargetAtTime(42 + span * 88, t, 0.06);
    this.engine.oscB.frequency.setTargetAtTime(84 + span * 140, t, 0.06);
    this.engine.filt.frequency.setTargetAtTime(220 + span * 1600 + (combo || 0) * 120, t, 0.08);
    var edge = playing ? span * span * 0.045 + Math.min(5, combo || 0) * 0.012 : 0;
    this.edge.g.gain.setTargetAtTime(edge, t, 0.1);
    this.edge.o.frequency.setTargetAtTime(180 + span * 420 + (combo || 0) * 70, t, 0.08);
    var powered = snap.invincibleUntilMs > snap.timeMs;
    this.powerGain.gain.setTargetAtTime(powered && playing ? 0.045 : 0, t, 0.12);
    if (powered) {
      for (var i = 0; i < this.powerOsc.length; i++) {
        this.powerOsc[i].frequency.setTargetAtTime(196 * (i + 1) * (1 + span * 0.04), t, 0.2);
      }
    }
  };

  root.DelveAudio = DelveAudio;
})(typeof window !== "undefined" ? window : globalThis);
