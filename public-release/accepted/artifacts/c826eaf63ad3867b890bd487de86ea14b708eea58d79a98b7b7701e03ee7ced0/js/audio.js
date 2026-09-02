/** Restrained Web Audio synthesizer for Lumen Yard. Silent until unlocked. */
export class YardAudio {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.enabled = true;
    this.unlocked = false;
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this._ensure();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    return this.ctx;
  }

  /**
   * @param {string} kind
   */
  play(kind) {
    if (!this.enabled || !this.unlocked) return;
    const ctx = this._ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const t = ctx.currentTime;
    switch (kind) {
      case "step":
        this._blip(t, 180, 0.04, 0.03, "triangle");
        break;
      case "push":
        this._thud(t, 90, 0.12, 0.08);
        this._blip(t + 0.04, 220, 0.06, 0.04, "square");
        break;
      case "blocked":
        this._noiseBurst(t, 0.05, 0.04);
        this._blip(t, 110, 0.08, 0.05, "sawtooth");
        break;
      case "undo":
        this._sweep(t, 320, 140, 0.18, 0.05);
        break;
      case "seat":
        this._click(t, 0.06);
        this._blip(t + 0.02, 440, 0.1, 0.06, "sine");
        this._blip(t + 0.08, 660, 0.12, 0.05, "sine");
        break;
      case "complete":
        this._surge(t);
        break;
      case "restart":
        this._sweep(t, 200, 80, 0.15, 0.04);
        break;
      case "select":
        this._blip(t, 300, 0.05, 0.03, "triangle");
        break;
      case "ui":
        this._blip(t, 520, 0.03, 0.02, "sine");
        break;
      default:
        break;
    }
  }

  /** @param {number} t @param {number} freq @param {number} dur @param {number} gain @param {OscillatorType} type */
  _blip(t, freq, dur, gain, type) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** @param {number} t @param {number} freq @param {number} dur @param {number} gain */
  _thud(t, freq, dur, gain) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(40, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** @param {number} t @param {number} from @param {number} to @param {number} dur @param {number} gain */
  _sweep(t, from, to, dur, gain) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** @param {number} t @param {number} dur */
  _click(t, dur) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(900, t);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** @param {number} t @param {number} dur @param {number} gain */
  _noiseBurst(t, dur, gain) {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(t);
  }

  /** @param {number} t */
  _surge(t) {
    const notes = [220, 277, 330, 440, 554, 660];
    notes.forEach((f, i) => {
      this._blip(t + i * 0.07, f, 0.22, 0.045, "sine");
    });
    this._thud(t, 60, 0.35, 0.1);
  }
}
