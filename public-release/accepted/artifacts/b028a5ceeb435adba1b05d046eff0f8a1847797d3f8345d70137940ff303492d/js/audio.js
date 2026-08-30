export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.masterGain = null;
    this.edgeGain = null;
    this.lastNearMiss = 0;
  }

  unlock() {
    if (this.enabled) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.35;
      this.masterGain.connect(this.ctx.destination);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 400;
      this.engineOsc.connect(filt);
      filt.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);
      this.engineOsc.start();

      this.edgeGain = this.ctx.createGain();
      this.edgeGain.gain.value = 0;
      this.edgeGain.connect(this.masterGain);

      this.enabled = true;
    } catch (_) {
      /* silent ok */
    }
  }

  update(sim, nearMissStreak) {
    if (!this.enabled || !this.ctx) return;
    const s = sim.snapshot();
    const speedRatio = (s.speed - 42) / (420 - 42);
    const t = this.ctx.currentTime;

    if (this.engineOsc) {
      this.engineOsc.frequency.setTargetAtTime(48 + speedRatio * 90, t, 0.05);
      const vol = s.phase === 'playing' ? 0.08 + speedRatio * 0.14 : 0.02;
      this.engineGain.gain.setTargetAtTime(vol, t, 0.08);
    }

  }

  play(kind, intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.connect(g);
    g.connect(this.masterGain);

    switch (kind) {
      case 'fragment':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
        g.gain.setValueAtTime(0.2 * intensity, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.22);
        break;
      case 'power':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.3);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t);
        osc.stop(t + 0.5);
        break;
      case 'rock_hit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.2);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t);
        osc.stop(t + 0.3);
        break;
      case 'wall_contact':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, t);
        g.gain.setValueAtTime(0.28, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      case 'near_miss':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300 + intensity * 80, t);
        g.gain.setValueAtTime(0.12 + intensity * 0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.12);
        break;
      case 'gameover':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.6);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        osc.start(t);
        osc.stop(t + 0.75);
        break;
      default:
        osc.stop(t);
    }
  }
}
