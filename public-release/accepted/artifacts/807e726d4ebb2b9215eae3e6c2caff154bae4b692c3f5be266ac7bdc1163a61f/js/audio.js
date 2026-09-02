// Procedural Web Audio engine for SHOAL
// Pure synthesis: no external audio files, no network requests.

const AudioEngine = (function() {
  let ctx = null;
  let muted = false;
  let masterGain = null;
  let ambientNoiseNode = null;
  let ambientGain = null;
  let isAmbientPlaying = false;

  function initAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(muted ? 0 : 0.35, ctx.currentTime);
      masterGain.connect(ctx.destination);
      startGentleWaterAmbient();
    } catch (e) {
      // Audio not supported or blocked
    }
  }

  function toggleMute() {
    muted = !muted;
    if (masterGain && ctx) {
      masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, ctx.currentTime, 0.05);
    }
    return muted;
  }

  function isMuted() {
    return muted;
  }

  function startGentleWaterAmbient() {
    if (!ctx || isAmbientPlaying) return;
    try {
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.03;
        b6 = white * 0.115926;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(320, ctx.currentTime);

      ambientGain = ctx.createGain();
      ambientGain.gain.setValueAtTime(0.04, ctx.currentTime);

      // Slow LFO for gentle tidal breathing
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.12, ctx.currentTime);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(120, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      whiteNoise.connect(filter);
      filter.connect(ambientGain);
      ambientGain.connect(masterGain);

      whiteNoise.start();
      lfo.start();
      ambientNoiseNode = whiteNoise;
      isAmbientPlaying = true;
    } catch (e) {}
  }

  // Shell tick: crisp calcite click
  function playShellTick() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.04);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(3, now);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Pentatonic ripple chime
  const PENTATONIC_FREQS = [
    311.13, // Eb4
    349.23, // F4
    392.00, // G4
    466.16, // Bb4
    523.25, // C5
    622.25, // Eb5
    698.46, // F5
    783.99, // G5
    932.33, // Bb5
    1046.50 // C6
  ];

  function playRipple(step = 0) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const freq = PENTATONIC_FREQS[Math.min(step, PENTATONIC_FREQS.length - 1)];

    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.015, now + 0.12);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, now);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.19);
    osc2.stop(now + 0.19);
  }

  // Pennant snap: crisp bamboo stake in sand
  function playFlagPlant() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(840, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.05);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.065);
  }

  // Pennant lift: subtle water pull
  function playFlagLift() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.06);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.075);
  }

  // Sweep: rapid multi-note water chord
  function playSweep() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const chord = [466.16, 622.25, 783.99]; // Bb4, Eb5, G5
    chord.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.035;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.17);
    });
  }

  // Sting: dramatic underwater impact, cracked shell, deep thud
  function playSting() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;

    // 1. Sharp transient crack
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.15);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // 2. Low hollow thud
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(35, now + 0.45);
    subGain.gain.setValueAtTime(0.4, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    sub.connect(subGain);
    subGain.connect(masterGain);
    sub.start(now);
    sub.stop(now + 0.52);
  }

  // Pool clear: triumphant oceanic chime arpeggio
  function playPoolClear() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const notes = [311.13, 392.00, 466.16, 622.25, 783.99, 932.33];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.06;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);

      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  // Low tide hush
  function playLowTideHush() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.4);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, now);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(now + 0.48);
  }

  return {
    init: initAudio,
    toggleMute,
    isMuted,
    playShellTick,
    playRipple,
    playFlagPlant,
    playFlagLift,
    playSweep,
    playSting,
    playPoolClear,
    playLowTideHush
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioEngine;
}
