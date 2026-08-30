/** Lightweight procedural audio — no external assets. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._lastEventSeq = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
    }
    return this.ctx;
  }

  resume() {
    const c = this.ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  tone(freq, dur, type = 'sine', vol = 0.08, detune = 0) {
    if (!this.enabled) return;
    const c = this.ensure();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(detune, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, vol = 0.04) {
    if (!this.enabled) return;
    const c = this.ensure();
    if (!c) return;
    const bufferSize = c.sampleRate * dur;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(gain);
    gain.connect(c.destination);
    src.start();
  }

  onEvent(ev) {
    if (!ev || ev.sequence === this._lastEventSeq) return;
    this._lastEventSeq = ev.sequence;

    switch (ev.kind) {
      case 'ball_bounce_weak':
        this.tone(220, 0.08, 'triangle', 0.06);
        break;
      case 'ball_bounce_normal':
        this.tone(330, 0.1, 'triangle', 0.08);
        break;
      case 'ball_bounce_power':
        this.tone(440, 0.14, 'square', 0.07);
        this.tone(660, 0.1, 'sine', 0.04);
        break;
      case 'top_hit':
        this.tone(520 + ev.amountMs * 0.05, 0.12, 'sine', 0.09);
        break;
      case 'enemy_defeated':
        this.tone(880, 0.2, 'square', 0.1);
        this.tone(1100, 0.25, 'sine', 0.07);
        this.noise(0.15, 0.05);
        break;
      case 'wrong_side_hit':
        this.tone(120, 0.2, 'sawtooth', 0.07);
        break;
      case 'ball_drop':
        this.tone(90, 0.25, 'sawtooth', 0.08);
        break;
      case 'machine_jump':
        this.tone(280, 0.08, 'triangle', 0.05);
        break;
      case 'ground_stomp':
        this.tone(180, 0.1, 'square', 0.07);
        this.noise(0.06, 0.04);
        break;
      default:
        break;
    }
  }
}
