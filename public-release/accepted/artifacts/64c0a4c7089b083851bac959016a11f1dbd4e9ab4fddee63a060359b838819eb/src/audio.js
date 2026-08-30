/**
 * Procedural Audio Synthesizer for DELVE
 * Built with Web Audio API. Fully synthesized in real-time.
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.initialized = false;

    // Continuous sound nodes
    this.engineGain = null;
    this.engineOsc = null;
    this.engineFilter = null;
    this.drillNoiseNode = null;
    this.drillGain = null;

    this.powerDroneGain = null;
    this.powerDroneOsc = null;

    // Alarm timing
    this.lastAlarmTime = 0;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.setupContinuousEngines();
      this.initialized = true;
    } catch (e) {
      console.warn("AudioContext initialization failed", e);
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

  setupContinuousEngines() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Master Engine Oscillator
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.setValueAtTime(45, now);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(140, now);
    this.engineFilter.Q.setValueAtTime(2.5, now);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.0001, now);

    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();

    // Noise buffer for drill grinding/friction
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(350, now);
    noiseFilter.Q.setValueAtTime(3, now);

    this.drillGain = this.ctx.createGain();
    this.drillGain.gain.setValueAtTime(0.0001, now);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(this.drillGain);
    this.drillGain.connect(this.ctx.destination);
    whiteNoise.start();

    // Power mode pulsing drone
    this.powerDroneOsc = this.ctx.createOscillator();
    this.powerDroneOsc.type = 'triangle';
    this.powerDroneOsc.frequency.setValueAtTime(110, now);

    this.powerDroneGain = this.ctx.createGain();
    this.powerDroneGain.gain.setValueAtTime(0.0001, now);

    this.powerDroneOsc.connect(this.powerDroneGain);
    this.powerDroneGain.connect(this.ctx.destination);
    this.powerDroneOsc.start();
  }

  updateContinuous(speedRatio, isDigging, isPowered, isGameOver) {
    if (!this.ctx || !this.initialized || this.isMuted || isGameOver) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0.0001, this.ctx ? this.ctx.currentTime : 0, 0.05);
      if (this.drillGain) this.drillGain.gain.setTargetAtTime(0.0001, this.ctx ? this.ctx.currentTime : 0, 0.05);
      if (this.powerDroneGain) this.powerDroneGain.gain.setTargetAtTime(0.0001, this.ctx ? this.ctx.currentTime : 0, 0.05);
      return;
    }

    const now = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speedRatio));

    // Engine pitch & filter rise with speed
    const engineFreq = 40 + s * 110 + (isDigging ? 20 : 0);
    const filterFreq = 120 + s * 700 + (isDigging ? 150 : 0);
    const engineVol = 0.04 + s * 0.12 + (isDigging ? 0.04 : 0);

    this.engineOsc.frequency.setTargetAtTime(engineFreq, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.06);
    this.engineGain.gain.setTargetAtTime(engineVol, now, 0.06);

    // Drill grinding noise
    const drillVol = isDigging ? (0.02 + s * 0.06) : 0.005;
    this.drillGain.gain.setTargetAtTime(drillVol, now, 0.08);

    // Power drone
    if (isPowered) {
      const pPulse = 0.08 + 0.04 * Math.sin(now * 16);
      this.powerDroneGain.gain.setTargetAtTime(pPulse, now, 0.04);
      this.powerDroneOsc.frequency.setTargetAtTime(110 + s * 55 + Math.sin(now * 8) * 10, now, 0.04);
    } else {
      this.powerDroneGain.gain.setTargetAtTime(0.0001, now, 0.08);
    }
  }

  playFragmentPickup(formationIndex = 0) {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Pentatonic scale based on formation index
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5]; // C5 to E6
    const baseFreq = scale[formationIndex % scale.length];

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.18);

    // Bell shimmer overtone
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(baseFreq * 2.75, now);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    gain2.gain.setValueAtTime(0.08, now);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
    osc2.start(now);
    osc2.stop(now + 0.21);
  }

  playNearMiss(combo = 1) {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    const basePitch = Math.min(1600, 440 * Math.pow(1.15, Math.min(10, combo)));

    // Resonant whoosh / whistle
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(basePitch * 0.7, now);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 1.6, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 0.9, now + 0.28);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(basePitch * 1.2, now);
    filter.Q.setValueAtTime(6, now);

    const vol = Math.min(0.28, 0.12 + combo * 0.025);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.32);
  }

  playCollision(isWall = false) {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Heavy bass impact thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isWall ? 'triangle' : 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.28);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);

    // Crunch noise
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.05));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start(now);
  }

  playRockBroken() {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Powerful crunch & shatter chord
    const freqs = [180, 270, 420];
    freqs.forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.4, now + 0.25);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    });
  }

  playPowerPickup() {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Ascending power surge arpeggio
    const chord = [330, 440, 554.37, 659.25, 880, 1108.73];
    chord.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + idx * 0.04;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, startTime + 0.25);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.45);
    });
  }

  playWarningTick() {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;
    if (now - this.lastAlarmTime < 0.4) return;
    this.lastAlarmTime = now;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playGameOver() {
    if (!this.ctx || this.isMuted) return;
    this.ensureContext();
    const now = this.ctx.currentTime;

    // Powering down descending motif
    const notes = [587.33, 440.0, 349.23, 293.66, 146.83];
    notes.forEach((f, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const t = now + idx * 0.12;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.35);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }
}

window.SoundEngine = SoundEngine;
