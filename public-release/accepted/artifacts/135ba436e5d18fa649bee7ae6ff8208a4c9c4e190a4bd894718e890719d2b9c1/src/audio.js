/**
 * Shoal Procedural Audio Engine (Web Audio API)
 */
(function(root) {
  let ctx = null;
  let isMuted = false;
  let initialized = false;

  function getContext() {
    if (!ctx && typeof window !== 'undefined') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        ctx = new AudioContext();
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function initAudio() {
    if (initialized) return;
    initialized = true;
    getContext();
  }

  function playTurn() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.04);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(c.destination);

    osc.start(t);
    osc.stop(t + 0.06);
  }

  const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51];
  function playRipple(step = 0) {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();

    const freq = PENTATONIC[step % PENTATONIC.length] * (1 + Math.floor(step / PENTATONIC.length) * 0.5);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.05, t + 0.12);

    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(c.destination);

    osc.start(t);
    osc.stop(t + 0.16);
  }

  function playFlag() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(640, t + 0.03);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(c.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  function playUnflag() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.exponentialRampToValueAtTime(250, t + 0.04);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(c.destination);

    osc.start(t);
    osc.stop(t + 0.05);
  }

  function playSweep() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t + i * 0.03);
      osc.frequency.exponentialRampToValueAtTime(f * 1.2, t + i * 0.03 + 0.1);

      gain.gain.setValueAtTime(0.09, t + i * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.12);

      osc.connect(gain);
      gain.connect(c.destination);

      osc.start(t + i * 0.03);
      osc.stop(t + i * 0.03 + 0.13);
    });
  }

  function playSting() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(c.destination);

    osc.start(t);
    osc.stop(t + 0.45);
  }

  function playPoolClear() {
    const c = getContext();
    if (!c || isMuted) return;

    const t = c.currentTime;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      const osc = c.createOscillator();
      const gain = c.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.07);

      gain.gain.setValueAtTime(0.14, t + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.07 + 0.3);

      osc.connect(gain);
      gain.connect(c.destination);

      osc.start(t + idx * 0.07);
      osc.stop(t + idx * 0.07 + 0.32);
    });
  }

  root.ShoalAudio = {
    initAudio,
    playTurn,
    playRipple,
    playFlag,
    playUnflag,
    playSweep,
    playSting,
    playPoolClear
  };
})(typeof window !== 'undefined' ? window : globalThis);
