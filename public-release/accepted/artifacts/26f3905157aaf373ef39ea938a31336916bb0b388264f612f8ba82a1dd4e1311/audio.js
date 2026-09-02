// EMBER - Synthesized Procedural Audio Engine (Web Audio API)
// Zero external files, fully deterministic-safe (audio is view-only, never affects simulation)

class EmberAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.initialized = false;
    this.lastAimSoundTime = 0;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(40, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(8, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.55, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported or blocked:', e);
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

  // Pentatonic musical scale for chain links
  static CHAIN_NOTES = [
    261.63, // C4
    293.66, // D4
    329.63, // E4
    392.00, // G4
    440.00, // A4
    523.25, // C5
    587.33, // D5
    659.25, // E5
    783.99, // G5
    880.00, // A5
    1046.50 // C6
  ];

  playAimStretch(power) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - this.lastAimSoundTime < 0.08) return;
    this.lastAimSoundTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    const baseFreq = 80 + power * 160;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq + 40, now + 0.06);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400 + power * 600, now);

    gain.gain.setValueAtTime(0.04 + power * 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.07);
  }

  playLaunch(isMidair, chainCount) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Whoosh + transient click
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    const startFreq = isMidair ? 320 + Math.min(chainCount * 40, 300) : 240;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);

    // Noise burst for flame thrust
    this.playNoiseBurst(0.12, 600, 180, 0.2);
  }

  playLedgeLand() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Deep solid stone thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // Gentle settling click
    this.playTone(480, 0.08, 'sine', 0.12, 0.01);
  }

  playWallCling() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Soot scratch / latch sound
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, now);
    filter.Q.setValueAtTime(4, now);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  playMothBurst(chainCount) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Sharp acoustic pop
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(580, now);
    popOsc.frequency.exponentialRampToValueAtTime(120, now + 0.07);
    popGain.gain.setValueAtTime(0.4, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    popOsc.connect(popGain);
    popGain.connect(this.masterGain);
    popOsc.start(now);
    popOsc.stop(now + 0.09);

    // Musical upward kick tone
    const noteIdx = Math.min(chainCount, EmberAudio.CHAIN_NOTES.length - 1);
    const freq = EmberAudio.CHAIN_NOTES[noteIdx];
    this.playTone(freq, 0.28, 'triangle', 0.3, 0.01);
    this.playTone(freq * 1.5, 0.22, 'sine', 0.15, 0.02);

    // Flutter dust hiss
    this.playNoiseBurst(0.09, 2200, 800, 0.15);
  }

  playGlimmer(chainCount) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Sparkling two-tone chime
    const baseFreq = 880 + Math.min(chainCount * 60, 400);
    this.playTone(baseFreq, 0.35, 'sine', 0.25, 0.00);
    this.playTone(baseFreq * 1.334, 0.32, 'sine', 0.2, 0.04);
    this.playTone(baseFreq * 2.0, 0.4, 'triangle', 0.15, 0.08);
  }

  playChainLink(chainCount) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Escalating musical celebration link!
    const noteIdx = Math.min(chainCount - 1, EmberAudio.CHAIN_NOTES.length - 1);
    const freq = EmberAudio.CHAIN_NOTES[Math.max(0, noteIdx)];
    
    // Primary chime
    this.playTone(freq, 0.32, 'triangle', 0.28, 0.00);
    // Upper harmonic shimmer
    this.playTone(freq * 2.0, 0.35, 'sine', 0.18 + Math.min(chainCount * 0.03, 0.2), 0.02);

    if (chainCount >= 3) {
      // Third fifth harmonic for chord warmth
      this.playTone(freq * 1.5, 0.38, 'sine', 0.15, 0.04);
    }
  }

  playChainBank(chainCount) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Triumphant chord fanfare for banking a long chain!
    const root = 392.0; // G4
    const chord = [root, root * 1.25, root * 1.5, root * 2.0]; // G Major
    chord.forEach((freq, idx) => {
      this.playTone(freq, 0.5 + idx * 0.1, 'triangle', 0.22, idx * 0.04);
    });

    // Deep warm gong
    this.playTone(130.8, 0.7, 'sine', 0.35, 0.0);
  }

  playEmptyStock() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Dry empty click
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.05);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playGameOver() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Extinguishing water sizzle
    this.playNoiseBurst(0.65, 1400, 300, 0.35);

    // Descending melancholy cello-like drone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.8);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.8);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.88);
  }

  playTone(freq, duration, type = 'sine', volume = 0.2, delay = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  playNoiseBurst(duration, highFreq = 1200, lowFreq = 200, volume = 0.2) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(highFreq, now);
    filter.frequency.exponentialRampToValueAtTime(lowFreq, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + duration + 0.01);
  }
}

window.emberAudio = new EmberAudio();
