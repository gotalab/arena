'use strict';

const AudioEngine = (() => {
  let ctx = null;
  let unlocked = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    return ctx;
  }

  function unlock() {
    if (unlocked) return;
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  }

  function tone(freq, dur, type, vol, ramp) {
    const c = ensure();
    if (!c || !unlocked) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (ramp) osc.frequency.exponentialRampToValueAtTime(ramp, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, vol, filterFreq) {
    const c = ensure();
    if (!c || !unlocked) return;
    const bufferSize = c.sampleRate * dur;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 800;
    const gain = c.createGain();
    gain.gain.setValueAtTime(vol, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start();
  }

  return {
    unlock,
    launch(strength) {
      tone(180 + strength * 120, 0.18, 'triangle', 0.12 + strength * 0.08, 420 + strength * 200);
      noiseBurst(0.06, 0.04, 600);
    },
    land(kind) {
      if (kind === 'ledge') {
        tone(320, 0.22, 'sine', 0.14, 180);
      } else {
        tone(240, 0.15, 'triangle', 0.1, 120);
      }
    },
    mothBurst() {
      tone(520, 0.12, 'square', 0.1, 880);
      noiseBurst(0.08, 0.06, 1200);
    },
    glimmer() {
      tone(880, 0.25, 'sine', 0.1, 1320);
      tone(1100, 0.2, 'triangle', 0.06, 1760);
    },
    chain(link) {
      const base = 400 + link * 80;
      tone(base, 0.14 + link * 0.02, 'sine', 0.08 + link * 0.015, base * 1.5);
    },
    chainBank(length) {
      tone(300, 0.3, 'sine', 0.12, 600);
      setTimeout(() => tone(500 + length * 40, 0.35, 'triangle', 0.1, 900), 80);
    },
    dampHum(intensity) {
      if (intensity < 0.3) return;
      tone(60 + intensity * 30, 0.4, 'sine', 0.02 * intensity, 40);
    },
    gameOver() {
      tone(200, 0.5, 'sine', 0.12, 60);
      noiseBurst(0.3, 0.05, 200);
    },
  };
})();

window.AudioEngine = AudioEngine;
