// Lumen Yard - Synthesized Web Audio Identity
// Operates without external audio assets. Unlocks on first user interaction.
import { storage } from './storage.js';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = storage.getSoundEnabled(true);
    this.unlocked = false;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    } catch (e) {
      console.warn('Web Audio API not supported', e);
    }
  }

  unlock() {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.unlocked = true;
      }).catch(() => {});
    } else if (this.ctx) {
      this.unlocked = true;
    }
  }

  setEnabled(val) {
    this.enabled = !!val;
    storage.setSoundEnabled(this.enabled);
  }

  isSoundActive() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  // --- SOUND EFFECTS ---

  playStep() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;
    
    // Tiny servo click + low rubber/metal contact
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.04);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  playPush() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;

    // Heavy metallic thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.14);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    // Subtle electrical friction sizzle
    const oscFriction = this.ctx.createOscillator();
    const gainFriction = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();

    oscFriction.type = 'sawtooth';
    oscFriction.frequency.setValueAtTime(320, now);
    oscFriction.frequency.linearRampToValueAtTime(240, now + 0.1);

    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200, now);
    bp.Q.setValueAtTime(3.0, now);

    gainFriction.gain.setValueAtTime(0.06, now);
    gainFriction.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    oscFriction.connect(bp);
    bp.connect(gainFriction);
    gainFriction.connect(this.ctx.destination);

    oscFriction.start(now);
    oscFriction.stop(now + 0.1);
  }

  playBlock() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;

    // Immediate readable refusal: square wave buzz + dull thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.setValueAtTime(60, now + 0.05);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playSocketContact() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;

    // Heavy relay seating: snap + resonant copper chime
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.06); // E5

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);

    // Contact spark click
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'square';
    clickOsc.frequency.setValueAtTime(1800, now);
    clickGain.gain.setValueAtTime(0.15, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    clickOsc.connect(clickGain);
    clickGain.connect(this.ctx.destination);
    clickOsc.start(now);
    clickOsc.stop(now + 0.04);
  }

  playUndo() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;

    // Current rewinding through cable: rising reverse shimmer
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.12);

    gain.gain.setValueAtTime(0.02, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  playSurge() {
    if (!this.isSoundActive()) return;
    const now = this.ctx.currentTime;

    // Power yard waking up: rising electrical arpeggio and deep transformer hum
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C major pentatonic
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + idx * 0.06;
      const dur = 0.5;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + dur);
    });

    // Deep transformer bass bloom
    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(65.41, now); // C2
    bassOsc.frequency.linearRampToValueAtTime(130.81, now + 0.4);

    bassGain.gain.setValueAtTime(0.001, now);
    bassGain.gain.linearRampToValueAtTime(0.28, now + 0.15);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    bassOsc.connect(bassGain);
    bassGain.connect(this.ctx.destination);
    bassOsc.start(now);
    bassOsc.stop(now + 0.9);
  }

  playEvent(name) {
    switch (name) {
      case 'step': this.playStep(); break;
      case 'push': this.playPush(); break;
      case 'block': this.playBlock(); break;
      case 'socket': this.playSocketContact(); break;
      case 'undo': this.playUndo(); break;
      case 'surge': this.playSurge(); break;
    }
  }
}

export const audio = new AudioManager();
