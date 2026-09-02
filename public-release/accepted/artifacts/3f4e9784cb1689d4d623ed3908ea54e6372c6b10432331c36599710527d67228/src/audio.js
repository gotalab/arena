/**
 * LUMEN YARD - Procedural Web Audio Synthesizer
 * Restrained industrial & electrical synthesized soundscape.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.enabled ? 0.35 : 0.0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      console.warn('AudioContext failed to initialize:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.35 : 0.0, this.ctx.currentTime, 0.03);
    }
  }

  playStep() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.04);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.045);
  }

  playPush() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Heavy mechanical low thud + metallic friction
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(110, t);
    osc1.frequency.exponentialRampToValueAtTime(45, t + 0.12);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(65, t);
    osc2.frequency.exponentialRampToValueAtTime(30, t + 0.14);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(200, t + 0.14);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.15);
    osc2.stop(t + 0.15);
  }

  playBlocked() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Low metallic rejection clank / buzz
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.linearRampToValueAtTime(55, t + 0.08);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.085);
  }

  playUndo() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Rewind swirl
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(480, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.14);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, t);
    filter.Q.setValueAtTime(2, t);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.15);
  }

  playSocketLock() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Crisp electrical chime + heavy latch
    const oscLow = this.ctx.createOscillator();
    const oscHigh = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    oscLow.type = 'sine';
    oscLow.frequency.setValueAtTime(120, t);
    oscLow.frequency.exponentialRampToValueAtTime(60, t + 0.1);

    oscHigh.type = 'triangle';
    oscHigh.frequency.setValueAtTime(523.25, t); // C5
    oscHigh.frequency.exponentialRampToValueAtTime(659.25, t + 0.08); // E5

    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    oscLow.connect(gain);
    oscHigh.connect(gain);
    gain.connect(this.masterGain);

    oscLow.start(t);
    oscHigh.start(t);
    oscLow.stop(t + 0.2);
    oscHigh.stop(t + 0.2);
  }

  playGridSurge() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Harmonic major chord surge: C4, G4, C5, E5, G5 with rich filter opening
    const freqs = [261.63, 392.00, 523.25, 659.25, 783.99];

    freqs.forEach((freq, idx) => {
      const startTime = t + idx * 0.06;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq * 0.95, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.05);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, startTime);
      filter.frequency.exponentialRampToValueAtTime(3000, startTime + 0.4);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.18 / (idx * 0.3 + 1), startTime + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.9);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + 0.95);
    });
  }

  playChapterClear() {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    // Heroic power sequence
    const notes = [
      { f: 261.63, time: 0.0 }, // C4
      { f: 329.63, time: 0.12 }, // E4
      { f: 392.00, time: 0.24 }, // G4
      { f: 523.25, time: 0.36 }, // C5
      { f: 659.25, time: 0.52 }, // E5
      { f: 783.99, time: 0.70 }  // G5
    ];

    notes.forEach(note => {
      const st = t + note.time;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, st);

      gain.gain.setValueAtTime(0.001, st);
      gain.gain.linearRampToValueAtTime(0.2, st + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.6);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(st);
      osc.stop(st + 0.65);
    });
  }
}
