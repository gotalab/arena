// Procedural Web Audio API Sound Synthesizer for EMBER
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.aimOsc = null;
    this.aimGain = null;
    this.unlocked = false;
  }

  unlock() {
    if (this.unlocked && this.ctx && this.ctx.state === 'running') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.unlocked = true;
    } catch (e) {
      // Audio might fail in non-interactive tests or restricted sandboxes; keep running silently
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.35, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  // --- Aim Tension Sound (Rubber/spring stretch drone) ---
  startAimTone(intensity = 0) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    if (this.aimOsc) return;

    try {
      const t = this.ctx.currentTime;
      this.aimOsc = this.ctx.createOscillator();
      this.aimOsc.type = 'triangle';
      this.aimOsc.frequency.setValueAtTime(80 + intensity * 140, t);

      this.aimGain = this.ctx.createGain();
      this.aimGain.gain.setValueAtTime(0.001, t);
      this.aimGain.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.08, t + 0.05);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(250 + intensity * 500, t);

      this.aimOsc.connect(filter);
      filter.connect(this.aimGain);
      this.aimGain.connect(this.masterGain);

      this.aimOsc.start(t);
    } catch (e) {}
  }

  updateAimTone(intensity) {
    if (!this.aimOsc || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      this.aimOsc.frequency.setTargetAtTime(90 + intensity * 180, t, 0.03);
      if (this.aimGain) {
        this.aimGain.gain.setTargetAtTime(0.04 + intensity * 0.1, t, 0.03);
      }
    } catch (e) {}
  }

  stopAimTone() {
    if (!this.aimOsc || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      if (this.aimGain) {
        this.aimGain.gain.linearRampToValueAtTime(0.0001, t + 0.05);
      }
      this.aimOsc.stop(t + 0.06);
      setTimeout(() => {
        if (this.aimOsc) {
          try { this.aimOsc.disconnect(); } catch (e) {}
          this.aimOsc = null;
          this.aimGain = null;
        }
      }, 70);
    } catch (e) {
      this.aimOsc = null;
      this.aimGain = null;
    }
  }

  // --- Launch Sound (Whoosh + Fire Ignition) ---
  playLaunch(isMidair = false, chainCount = 0) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // 1. Noise burst (whoosh/ignition)
      const bufferSize = this.ctx.sampleRate * 0.18;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(isMidair ? 600 : 350, t);
      filter.frequency.exponentialRampToValueAtTime(1400 + chainCount * 200, t + 0.15);
      filter.Q.setValueAtTime(2.5, t);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.3, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.masterGain);
      noise.start(t);

      // 2. Pitch chirp (energy release)
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = isMidair ? 'triangle' : 'sine';
      const baseFreq = isMidair ? 220 + Math.min(chainCount, 8) * 45 : 160;
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, t + 0.14);

      oscGain.gain.setValueAtTime(0.22, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.15);
    } catch (e) {}
  }

  // --- Landing / Anchor Sound (Warm Hearth Thud & Crackle) ---
  playLand(isWall = false) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // Deep reassuring thud
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isWall ? 140 : 110, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);

      oscGain.gain.setValueAtTime(0.3, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(oscGain);
      oscGain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.19);

      // Ember sizzle / dust settling
      const bufferSize = this.ctx.sampleRate * 0.12;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = isWall ? 'highpass' : 'bandpass';
      filter.frequency.setValueAtTime(isWall ? 1200 : 700, t);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.12, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(t);
    } catch (e) {}
  }

  // --- Soot Moth Burst Sound (Pop + Kick + Harmonic Glissando) ---
  playMothBurst(chainCount = 0) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // Pop / Punch
      const kick = this.ctx.createOscillator();
      const kickGain = this.ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(260, t);
      kick.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      kickGain.gain.setValueAtTime(0.35, t);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      kick.connect(kickGain);
      kickGain.connect(this.masterGain);
      kick.start(t);
      kick.stop(t + 0.13);

      // Bright sparkle chime
      const bell = this.ctx.createOscillator();
      const bellGain = this.ctx.createGain();
      bell.type = 'triangle';
      const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // C5, E5, G5, C6, E6, G6
      const freq = notes[Math.min(chainCount, notes.length - 1)];
      bell.frequency.setValueAtTime(freq, t);
      bell.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.25);

      bellGain.gain.setValueAtTime(0.25, t);
      bellGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      bell.connect(bellGain);
      bellGain.connect(this.masterGain);
      bell.start(t);
      bell.stop(t + 0.26);
    } catch (e) {}
  }

  // --- Glimmer Pickup Sound (Harmonic Crystal Chime) ---
  playGlimmer(chainCount = 0) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const baseFreq = 880; // A5
      const freqs = [baseFreq, baseFreq * 1.25, baseFreq * 1.5]; // Major triad

      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f * (1 + Math.min(chainCount, 5) * 0.1), t + idx * 0.04);

        gain.gain.setValueAtTime(0.001, t + idx * 0.04);
        gain.gain.linearRampToValueAtTime(0.2, t + idx * 0.04 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.04 + 0.3);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + idx * 0.04);
        osc.stop(t + idx * 0.04 + 0.32);
      });
    } catch (e) {}
  }

  // --- Chain Escalation Sound (Ascending Pentatonic Fanfare) ---
  playChainEscalation(chainCount) {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      // Pentatonic scale: C5, D5, E5, G5, A5, C6, D6, E6, G6, A6, C7
      const scale = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98, 1760.00, 2093.00];
      const pitchIdx = Math.min(Math.max(chainCount - 1, 0), scale.length - 1);
      const noteFreq = scale[pitchIdx];

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = chainCount >= 4 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(noteFreq, t);

      // Add a touch of filter brightness
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(noteFreq * (chainCount >= 4 ? 3 : 2), t);

      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.36);
    } catch (e) {}
  }

  // --- Chain Bank Sound (Resolving Major Chord upon Landing) ---
  playChainBank(bankedChain) {
    if (!this.unlocked || !this.ctx || this.isMuted || bankedChain < 1) return;
    try {
      const t = this.ctx.currentTime;
      // Warm chord: C4, G4, E5, C6
      const chord = [261.63, 392.00, 659.25, 1046.50];

      chord.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.03);

        const intensity = Math.min(bankedChain * 0.05, 0.25);
        gain.gain.setValueAtTime(0.001, t + i * 0.03);
        gain.gain.linearRampToValueAtTime(0.15 + intensity, t + i * 0.03 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.5);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(t + i * 0.03);
        osc.stop(t + i * 0.03 + 0.55);
      });
    } catch (e) {}
  }

  // --- Empty Stock Launch Attempt (Hollow click / fizzle) ---
  playEmptyLaunch() {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.08);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch (e) {}
  }

  // --- Game Over / Damp Extinguish ---
  playGameOver() {
    if (!this.unlocked || !this.ctx || this.isMuted) return;
    try {
      const t = this.ctx.currentTime;

      // Heavy sub drop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.8);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.85);

      // Steam hiss
      const bufferSize = this.ctx.sampleRate * 0.7;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.frequency.exponentialRampToValueAtTime(400, t + 0.7);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.25, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(t);
    } catch (e) {}
  }
}
