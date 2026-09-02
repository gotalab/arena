/** Restrained synthesized yard identity. Silent until unlocked. */

export class YardAudio {
  constructor() {
    this.enabled = true;
    this.unlocked = false;
    this.ctx = null;
    this.master = null;
    this.hum = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this._stopHum();
    else if (this.unlocked) this._startHum();
  }

  unlock() {
    if (this.unlocked) {
      this._ensure();
      return;
    }
    this.unlocked = true;
    this._ensure();
    if (this.enabled) this._startHum();
  }

  step() {
    this._blip(180, 90, 0.045, 0.07, "square");
    this._noise(0.03, 0.04, 900, 0.18);
  }

  push() {
    this._thud(140, 42, 0.16, 0.22);
    this._noise(0.05, 0.08, 400, 0.25);
  }

  blocked() {
    this._blip(90, 70, 0.07, 0.09, "sawtooth");
    this._noise(0.04, 0.06, 600, 0.3);
  }

  undo() {
    this._blip(320, 520, 0.1, 0.08, "sine");
    this._blip(220, 410, 0.12, 0.06, "triangle", 0.04);
  }

  seat() {
    this._blip(420, 280, 0.08, 0.12, "triangle");
    this._blip(840, 620, 0.1, 0.07, "sine", 0.03);
    this._thud(90, 55, 0.1, 0.12);
  }

  surge() {
    this._blip(180, 720, 0.55, 0.1, "sawtooth");
    this._blip(220, 880, 0.6, 0.07, "triangle", 0.05);
    this._thud(70, 40, 0.3, 0.16);
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
    return true;
  }

  _now() {
    if (!this._ensure() || !this.enabled || !this.unlocked) return null;
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx.currentTime;
  }

  _blip(f0, f1, dur, gain, type, delay = 0) {
    const t0 = this._now();
    if (t0 == null) return;
    const t = t0 + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _thud(f0, f1, dur, gain) {
    this._blip(f0, f1, dur, gain, "sine");
  }

  _noise(dur, gain, cutoff, delay = 0) {
    const t0 = this._now();
    if (t0 == null) return;
    const t = t0 + delay;
    const n = 0.12 * this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _startHum() {
    if (!this._ensure() || !this.enabled || this.hum) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 52;
    g.gain.value = 0.018;
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    this.hum = { osc, g };
  }

  _stopHum() {
    if (!this.hum) return;
    try {
      this.hum.osc.stop();
    } catch {
      /* already stopped */
    }
    this.hum = null;
  }
}
