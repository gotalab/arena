/**
 * Procedural Web Audio Sound Synthesizer for DELVE.
 * Zero external audio assets. Completely synthesized in code.
 */
export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isMuted = false;
    this.initialized = false;

    // Engine sound nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineGain = null;

    // Wind/speed noise nodes
    this.windGain = null;
    this.windFilter = null;
    this.noiseNode = null;

    // Power hum nodes
    this.powerGain = null;
    this.powerOsc = null;

    // Heartbeat/low-time node state
    this.lastHeartbeatTick = 0;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this._setupContinuousSounds();
      this.initialized = true;
    } catch (e) {
      console.warn("Web Audio init skipped:", e);
    }
  }

  unlock() {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  _setupContinuousSounds() {
    if (!this.ctx) return;

    // 1. Dual-oscillator engine rumble
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.setValueAtTime(120, this.ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(3, this.ctx.currentTime);

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = "sawtooth";
    this.engineOsc1.frequency.setValueAtTime(45, this.ctx.currentTime);

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = "triangle";
    this.engineOsc2.frequency.setValueAtTime(90, this.ctx.currentTime);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // 2. Wind / high speed noise
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.noiseNode = this.ctx.createBufferSource();
    this.noiseNode.buffer = noiseBuffer;
    this.noiseNode.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.noiseNode.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.noiseNode.start();

    // 3. Power State hum
    this.powerGain = this.ctx.createGain();
    this.powerGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.powerOsc = this.ctx.createOscillator();
    this.powerOsc.type = "sawtooth";
    this.powerOsc.frequency.setValueAtTime(220, this.ctx.currentTime);

    const powerFilter = this.ctx.createBiquadFilter();
    powerFilter.type = "lowpass";
    powerFilter.frequency.setValueAtTime(800, this.ctx.currentTime);

    this.powerOsc.connect(powerFilter);
    powerFilter.connect(this.powerGain);
    this.powerGain.connect(this.masterGain);
    this.powerOsc.start();
  }

  update(speedRatio, isPowered, isPlaying, remainingMs, isNearMissStreak = 0) {
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    if (!isPlaying) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, t, 0.05);
      if (this.windGain) this.windGain.gain.setTargetAtTime(0, t, 0.05);
      if (this.powerGain) this.powerGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    // Engine pitch & volume scale with speed
    if (this.engineGain && this.engineOsc1 && this.engineFilter) {
      const targetGain = 0.15 + speedRatio * 0.25;
      const targetFreq1 = 35 + speedRatio * 85 + (isNearMissStreak > 0 ? isNearMissStreak * 6 : 0);
      const targetFilter = 100 + speedRatio * 450;

      this.engineGain.gain.setTargetAtTime(targetGain, t, 0.04);
      this.engineOsc1.frequency.setTargetAtTime(targetFreq1, t, 0.04);
      this.engineOsc2.frequency.setTargetAtTime(targetFreq1 * 2, t, 0.04);
      this.engineFilter.frequency.setTargetAtTime(targetFilter, t, 0.04);
    }

    // Wind rush audible at higher speeds (> 0.5)
    if (this.windGain && this.windFilter) {
      const windIntensity = Math.max(0, (speedRatio - 0.4) / 0.6);
      this.windGain.gain.setTargetAtTime(windIntensity * 0.28, t, 0.05);
      this.windFilter.frequency.setTargetAtTime(300 + speedRatio * 1600, t, 0.05);
    }

    // Power sound
    if (this.powerGain && this.powerOsc) {
      if (isPowered) {
        this.powerGain.gain.setTargetAtTime(0.22, t, 0.05);
        this.powerOsc.frequency.setTargetAtTime(260 + Math.sin(t * 15) * 40, t, 0.02);
      } else {
        this.powerGain.gain.setTargetAtTime(0, t, 0.08);
      }
    }

    // Low time heartbeat warning (pulse under 5s)
    if (remainingMs > 0 && remainingMs < 5500) {
      const pulseInterval = remainingMs < 2500 ? 400 : 700;
      if (!this.lastHeartbeatTime || performance.now() - this.lastHeartbeatTime > pulseInterval) {
        this.lastHeartbeatTime = performance.now();
        this.playLowTimeWarning();
      }
    }
  }

  playFragmentPickup(combo = 0) {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Ascending pentatonic notes: C5, D5, E5, G5, A5, C6, D6, E6
    const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
    const baseFreq = pentatonic[combo % pentatonic.length];

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t + 0.12);

    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.19);

    // Sub shimmer
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(baseFreq * 2, t);
    gain2.gain.setValueAtTime(0.12, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc2.connect(gain2);
    gain2.connect(this.masterGain);
    osc2.start(t);
    osc2.stop(t + 0.16);
  }

  playNearMiss(streak = 1) {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Harmonic whoosh + chime that ascends with streak
    const pitchMultiplier = Math.min(2.5, 1 + streak * 0.15);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(700 * pitchMultiplier, t);
    osc.frequency.exponentialRampToValueAtTime(1400 * pitchMultiplier, t + 0.16);

    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.23);
  }

  playRockHit() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // 1. Low pitch punch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.25);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.27);

    // 2. Crunchy noise shatter
    this._playNoiseBurst(0.18, 500, 0.35);
  }

  playWallContact() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Metallic grind
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.linearRampToValueAtTime(45, t + 0.15);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.17);

    this._playNoiseBurst(0.12, 1200, 0.25);
  }

  playRockBroken() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // High power smash explosion & crystal shatter
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.22);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.25);

    this._playNoiseBurst(0.2, 2200, 0.38);
  }

  playPowerPickup() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Grand ascending sweep chord
    const freqs = [330, 440, 554.37, 659.25, 880];
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t + i * 0.04);
      osc.frequency.exponentialRampToValueAtTime(f * 2, t + i * 0.04 + 0.35);

      gain.gain.setValueAtTime(0.18, t + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + i * 0.04);
      osc.stop(t + i * 0.04 + 0.46);
    });
  }

  playLowTimeWarning() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playGameOver() {
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;

    // Powering down mechanical glide
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.9);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.95);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 1.0);
  }

  _playNoiseBurst(duration, filterFreq, volume) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * duration;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFreq, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    whiteNoise.start(t);
    whiteNoise.stop(t + duration);
  }
}
