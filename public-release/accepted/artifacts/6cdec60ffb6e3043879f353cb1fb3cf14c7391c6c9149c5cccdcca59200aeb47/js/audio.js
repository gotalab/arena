/** Procedural audio via Web Audio API */

let ctx = null;
let unlocked = false;

export function unlockAudio() {
  if (unlocked) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
  } catch (_) {}
}

function tone(freq, dur, type = 'sine', vol = 0.08, ramp = 0.02) {
  if (!ctx || !unlocked) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + ramp);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, vol = 0.04) {
  if (!ctx || !unlocked) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 800;
  src.connect(f);
  f.connect(g);
  g.connect(ctx.destination);
  src.start(t);
}

export const sfx = {
  open() {
    tone(520, 0.12, 'sine', 0.06);
  },
  ripple(step) {
    tone(300 + step * 40, 0.08, 'triangle', 0.04);
  },
  flag() {
    tone(880, 0.06, 'square', 0.05);
    setTimeout(() => tone(1100, 0.05, 'square', 0.04), 30);
  },
  unflag() {
    tone(660, 0.08, 'sine', 0.04);
  },
  sweep() {
    tone(440, 0.15, 'sawtooth', 0.05);
    noise(0.2, 0.03);
  },
  sting() {
    tone(120, 0.5, 'sawtooth', 0.12);
    tone(80, 0.6, 'square', 0.08);
    noise(0.4, 0.06);
  },
  poolClear() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => tone(f, 0.25, 'sine', 0.07), i * 80)
    );
  },
  ceremony() {
    tone(392, 0.4, 'sine', 0.06);
    setTimeout(() => tone(494, 0.5, 'sine', 0.05), 200);
  },
  ambient() {
    if (!ctx || !unlocked) return;
    noise(0.15, 0.008);
  },
};
