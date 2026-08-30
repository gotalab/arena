(function (root) {
  function Synth() {
    this.ctx = null;
    this.master = null;
    this.dampGain = null;
    this.dampSrc = null;
    this.started = false;
    this.lastKind = null;
    this.lastTick = -1;
  }

  Synth.prototype.ensure = function () {
    if (this.started && this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    this.started = true;
    this._startDampDrone();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  };

  Synth.prototype._env = function (gain, t, a, peak, d, sustain, rel) {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustain), t + a + d);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d + rel);
  };

  Synth.prototype._tone = function (type, freq, dur, peak, g) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var gn = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    gn.gain.value = 0;
    o.connect(gn);
    gn.connect(this.master);
    this._env(gn, t, 0.012, peak * (g || 1), 0.04, peak * 0.25, dur);
    o.start(t);
    o.stop(t + dur + 0.08);
  };

  Synth.prototype._noise = function (dur, peak, hpFreq) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    var n = 0.12 * this.ctx.sampleRate;
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    var hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = hpFreq || 400;
    var gn = this.ctx.createGain();
    src.connect(hp);
    hp.connect(gn);
    gn.connect(this.master);
    this._env(gn, t, 0.006, peak, 0.03, peak * 0.2, dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  };

  Synth.prototype._startDampDrone = function () {
    if (!this.ctx) return;
    var t = this.ctx.currentTime;
    var o1 = this.ctx.createOscillator();
    var o2 = this.ctx.createOscillator();
    o1.type = "sine";
    o2.type = "triangle";
    o1.frequency.value = 46;
    o2.frequency.value = 52.5;
    var g = this.ctx.createGain();
    g.gain.value = 0.0001;
    o1.connect(g);
    o2.connect(g);
    g.connect(this.master);
    o1.start(t);
    o2.start(t);
    this.dampGain = g;
    this.dampSrc = [o1, o2];
  };

  Synth.prototype.setDampProximity = function (amount) {
    if (!this.dampGain || !this.ctx) return;
    var t = this.ctx.currentTime;
    var v = 0.0001 + Math.max(0, Math.min(1, amount)) * 0.18;
    this.dampGain.gain.linearRampToValueAtTime(v, t + 0.08);
  };

  Synth.prototype.launch = function (strength) {
    if (!this.ensure()) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var o2 = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = "sine";
    o2.type = "sawtooth";
    var f = 180 + strength * 220;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    o2.frequency.setValueAtTime(f * 0.5, t);
    o2.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    var g2 = this.ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.master);
    this._env(g, t, 0.008, 0.9, 0.05, 0.2, 0.18);
    o.start(t);
    o2.start(t);
    o.stop(t + 0.32);
    o2.stop(t + 0.28);
    this._noise(0.1, 0.18, 800);
  };

  Synth.prototype.land = function (onWall) {
    if (!this.ensure()) return;
    this._noise(onWall ? 0.08 : 0.12, onWall ? 0.12 : 0.22, onWall ? 300 : 180);
    this._tone("sine", onWall ? 240 : 196, 0.16, 0.35);
    this._tone("triangle", onWall ? 360 : 392, 0.2, 0.12);
  };

  Synth.prototype.bounce = function () {
    if (!this.ensure()) return;
    this._noise(0.07, 0.28, 900);
    this._tone("square", 520, 0.09, 0.16);
    this._tone("sine", 880, 0.14, 0.22);
  };

  Synth.prototype.glimmer = function (chain) {
    if (!this.ensure()) return;
    var f = 660 + Math.min(8, chain) * 40;
    this._tone("sine", f, 0.22, 0.28);
    this._tone("triangle", f * 1.5, 0.28, 0.12);
    this._tone("sine", f * 2, 0.18, 0.08);
  };

  Synth.prototype.chain = function (n) {
    if (!this.ensure()) return;
    var f = 320 * Math.pow(1.12, Math.min(n, 14));
    var peak = 0.18 + Math.min(n, 12) * 0.035;
    this._tone("sine", f, 0.16 + n * 0.012, peak);
    this._tone("triangle", f * 2.01, 0.12, peak * 0.4);
    if (n >= 3) this._tone("sine", f * 0.5, 0.2, peak * 0.25);
    if (n >= 6) this._noise(0.06, 0.12, 1200);
  };

  Synth.prototype.chainBank = function (n) {
    if (!this.ensure()) return;
    this._tone("sine", 262, 0.28, 0.3);
    this._tone("triangle", 330, 0.32, 0.18);
    this._tone("sine", 392, 0.4, 0.14);
    if (n >= 3) this._tone("sine", 523, 0.45, 0.12);
  };

  Synth.prototype.extinguish = function () {
    if (!this.ensure()) return;
    var t = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.7);
    o.connect(g);
    g.connect(this.master);
    this._env(g, t, 0.02, 0.4, 0.2, 0.12, 0.55);
    o.start(t);
    o.stop(t + 0.9);
    this._noise(0.4, 0.1, 120);
    if (this.dampGain) {
      this.dampGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    }
  };

  Synth.prototype.onEvent = function (ev, extras) {
    if (!ev) return;
    if (ev.kind === this.lastKind && ev.tick === this.lastTick) return;
    this.lastKind = ev.kind;
    this.lastTick = ev.tick;
    extras = extras || {};
    if (ev.kind === "launch") this.launch(extras.strength || 0.7);
    else if (ev.kind === "land") this.land(!!extras.onWall);
    else if (ev.kind === "bounce") this.bounce();
    else if (ev.kind === "glimmer") this.glimmer(extras.chain || 0);
    else if (ev.kind === "chain") this.chain(extras.chain || 1);
    else if (ev.kind === "chainBank") this.chainBank(extras.chainBest || 1);
  };

  root.EmberAudio = Synth;
})(typeof window !== "undefined" ? window : globalThis);
