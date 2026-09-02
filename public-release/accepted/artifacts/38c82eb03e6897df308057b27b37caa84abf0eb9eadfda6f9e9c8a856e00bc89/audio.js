/**
 * SHOAL - Procedural Web Audio Sound Engine
 * All audio synthesized dynamically using the Web Audio API.
 * No external audio files or network requests.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.enabled = true;
  }

  init() {
    if (typeof window === 'undefined') return;
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playTurn(distance = 0) {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const baseFreq = 480 + Math.min(distance * 35, 600);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, t + 0.08);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  playFlag() {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.05);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  playUnflag() {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(580, t + 0.04);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.06);
  }

  playSweep() {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const freqs = [350, 520, 690, 880];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.02);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.3, t + idx * 0.02 + 0.1);

      gain.gain.setValueAtTime(0.1, t + idx * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.02 + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + idx * 0.02);
      osc.stop(t + idx * 0.02 + 0.13);
    });
  }

  playSting() {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const strike = this.ctx.createOscillator();
    const strikeGain = this.ctx.createGain();
    strike.type = 'sawtooth';
    strike.frequency.setValueAtTime(160, t);
    strike.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    strikeGain.gain.setValueAtTime(0.35, t);
    strikeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    strike.connect(strikeGain);
    strikeGain.connect(this.ctx.destination);
    strike.start(t);
    strike.stop(t + 0.45);

    const clash = this.ctx.createOscillator();
    const clashGain = this.ctx.createGain();
    clash.type = 'square';
    clash.frequency.setValueAtTime(247, t);
    clash.frequency.setValueAtTime(233, t + 0.05);
    clashGain.gain.setValueAtTime(0.2, t);
    clashGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    clash.connect(clashGain);
    clashGain.connect(this.ctx.destination);
    clash.start(t);
    clash.stop(t + 0.3);
  }

  playClear() {
    if (this.muted || !this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.07);

      gain.gain.setValueAtTime(0.18, t + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.07 + 0.3);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t + idx * 0.07);
      osc.stop(t + idx * 0.07 + 0.32);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const sound = new SoundEngine();
