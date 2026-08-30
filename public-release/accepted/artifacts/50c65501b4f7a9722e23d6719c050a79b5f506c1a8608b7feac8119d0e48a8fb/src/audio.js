/* DELVE — synthesised sound identity. Everything is generated from the
 * platform's own audio synthesis; no files, no fetches, nothing to load.
 * Starts only on the player's first input. Never influences the simulation.
 *
 * The signature voice is the EDGE tone: a resonant sine whose pitch and
 * presence rise with sustained high speed and with a graze chain, and fall
 * away the instant the player eases off.
 */
(function () {
  var D = window.DELVE;

  var A = {
    ctx: null, ready: false, muted: false,
    master: null, noiseBuf: null,
    engGain: null, engFilt: null, oscA: null, oscB: null,
    rumbleGain: null, rumbleFilt: null,
    edgeOsc: null, edgeGain: null, edgeFilt: null,
    padGain: null, padA: null, padB: null,
    edgeLevel: 0, hold: 0
  };

  function now() { return A.ctx ? A.ctx.currentTime : 0; }
  function ramp(param, v, tc) {
    try { param.setTargetAtTime(v, now(), tc || 0.06); } catch (e) { param.value = v; }
  }

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A.ctx = new AC(); } catch (e) { return; }
    var ctx = A.ctx;

    A.master = ctx.createGain();
    A.master.gain.value = 0.0001;
    var comp = ctx.createDynamicsCompressor();
    try {
      comp.threshold.value = -16; comp.knee.value = 22;
      comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.22;
    } catch (e) { }
    A.master.connect(comp); comp.connect(ctx.destination);
    ramp(A.master.gain, 0.85, 0.08);   // up fast enough that the first rev lands

    // deterministic noise bed (audio never feeds the sim, but keep it tidy)
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var ch = buf.getChannelData(0);
    var s0 = 22222;
    for (var i = 0; i < len; i++) {
      s0 = (Math.imul(s0, 1664525) + 1013904223) & 0x7fffffff;
      ch[i] = (s0 / 0x40000000) - 1;
    }
    A.noiseBuf = buf;

    // ---- engine: the drill ----
    A.engFilt = ctx.createBiquadFilter();
    A.engFilt.type = 'lowpass'; A.engFilt.frequency.value = 320; A.engFilt.Q.value = 6;
    A.engGain = ctx.createGain(); A.engGain.gain.value = 0.0;
    A.oscA = ctx.createOscillator(); A.oscA.type = 'sawtooth'; A.oscA.frequency.value = 46;
    A.oscB = ctx.createOscillator(); A.oscB.type = 'square'; A.oscB.frequency.value = 23;
    var mixB = ctx.createGain(); mixB.gain.value = 0.42;
    A.oscA.connect(A.engFilt); A.oscB.connect(mixB); mixB.connect(A.engFilt);
    A.engFilt.connect(A.engGain); A.engGain.connect(A.master);
    A.oscA.start(); A.oscB.start();

    // ---- rumble: earth being chewed ----
    var nsrc = ctx.createBufferSource(); nsrc.buffer = buf; nsrc.loop = true;
    A.rumbleFilt = ctx.createBiquadFilter();
    A.rumbleFilt.type = 'bandpass'; A.rumbleFilt.frequency.value = 220; A.rumbleFilt.Q.value = 1.1;
    A.rumbleGain = ctx.createGain(); A.rumbleGain.gain.value = 0.0;
    nsrc.connect(A.rumbleFilt); A.rumbleFilt.connect(A.rumbleGain); A.rumbleGain.connect(A.master);
    nsrc.start();

    // ---- the edge ----
    A.edgeOsc = ctx.createOscillator(); A.edgeOsc.type = 'sine'; A.edgeOsc.frequency.value = 500;
    A.edgeFilt = ctx.createBiquadFilter();
    A.edgeFilt.type = 'bandpass'; A.edgeFilt.frequency.value = 900; A.edgeFilt.Q.value = 2.4;
    A.edgeGain = ctx.createGain(); A.edgeGain.gain.value = 0.0;
    A.edgeOsc.connect(A.edgeFilt); A.edgeFilt.connect(A.edgeGain); A.edgeGain.connect(A.master);
    A.edgeOsc.start();

    // ---- overdrive pad ----
    A.padGain = ctx.createGain(); A.padGain.gain.value = 0.0;
    A.padA = ctx.createOscillator(); A.padA.type = 'triangle'; A.padA.frequency.value = 174.6;
    A.padB = ctx.createOscillator(); A.padB.type = 'triangle'; A.padB.frequency.value = 262.0;
    var padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1500;
    A.padA.connect(padF); A.padB.connect(padF); padF.connect(A.padGain); A.padGain.connect(A.master);
    A.padA.start(); A.padB.start();

    A.ready = true;
  };

  function noise(dur, type, freq, q, gain, sweepTo) {
    if (!A.ready || A.muted) return;
    var ctx = A.ctx, t = now();
    var src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    if (q) f.Q.value = q;
    if (sweepTo) {
      try { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur); } catch (e) { }
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t); src.stop(t + dur + 0.03);
  }

  function tone(freq, dur, type, gain, sweepTo, delay) {
    if (!A.ready || A.muted) return;
    var ctx = A.ctx, t = now() + (delay || 0);
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) { try { o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur); } catch (e) { } }
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  var PENTA = [0, 3, 5, 7, 10, 12];

  A.sfx = function (kind, a, b) {
    if (!A.ready || A.muted) return;
    switch (kind) {
      case 'fragment': {
        var st = PENTA[(a || 0) % PENTA.length];
        var f = 587.33 * Math.pow(2, st / 12);
        tone(f, 0.20, 'triangle', 0.16);
        tone(f * 2, 0.13, 'sine', 0.09, null, 0.015);
        break;
      }
      case 'rock_hit':
        noise(0.34, 'lowpass', 1500, 1, 0.34, 180);
        tone(150, 0.30, 'sine', 0.30, 42);
        tone(92, 0.42, 'triangle', 0.18, 38, 0.02);
        break;
      case 'wall':
        noise(0.30, 'lowpass', 700, 1, 0.30, 130);
        tone(108, 0.34, 'sine', 0.26, 40);
        break;
      case 'smash':
        noise(0.22, 'bandpass', 2600, 1.4, 0.24, 900);
        tone(880, 0.16, 'square', 0.07);
        tone(1320, 0.13, 'sine', 0.07, null, 0.04);
        break;
      case 'near': {
        var c = Math.min(8, a || 1);
        noise(0.20, 'bandpass', 780 + c * 190, 5.5, 0.16, 380 + c * 120);
        tone(520 + c * 105, 0.11, 'sine', 0.055);
        break;
      }
      case 'power':
        tone(240, 0.55, 'sawtooth', 0.13, 1500);
        tone(392, 0.7, 'triangle', 0.11, null, 0.06);
        tone(587, 0.7, 'triangle', 0.11, null, 0.12);
        tone(784, 0.8, 'triangle', 0.10, null, 0.18);
        break;
      case 'start':
        tone(70, 0.45, 'sawtooth', 0.16, 220);
        noise(0.35, 'lowpass', 400, 1, 0.14, 900);
        break;
      case 'tick':
        tone(1180, 0.05, 'square', 0.055);
        break;
      case 'end':
        tone(392, 0.42, 'triangle', 0.16);
        tone(311, 0.46, 'triangle', 0.16, null, 0.20);
        tone(261, 0.52, 'triangle', 0.15, null, 0.40);
        tone(196, 1.10, 'sine', 0.17, 120, 0.62);
        noise(0.9, 'lowpass', 600, 1, 0.10, 90);
        break;
      case 'best':
        tone(784, 0.30, 'triangle', 0.13);
        tone(988, 0.30, 'triangle', 0.13, null, 0.10);
        tone(1319, 0.45, 'triangle', 0.13, null, 0.20);
        break;
    }
  };

  /* Called every rendered frame. sN = normalised speed, edge = 0..1 danger,
     powered = overdrive active, alive = run playable. */
  A.update = function (sN, edge, powered, alive, dt) {
    if (!A.ready) return;
    var m = A.muted ? 0 : 1;
    var eng = alive ? (0.020 + 0.085 * sN) : 0.004;
    ramp(A.engGain.gain, eng * m, 0.08);
    ramp(A.engFilt.frequency, 260 + 2400 * sN, 0.08);
    ramp(A.oscA.frequency, 44 + 118 * sN, 0.07);
    ramp(A.oscB.frequency, 22 + 59 * sN, 0.07);
    ramp(A.rumbleGain.gain, (alive ? 0.012 + 0.075 * sN * sN : 0.002) * m, 0.1);
    ramp(A.rumbleFilt.frequency, 170 + 520 * sN, 0.1);

    var e = alive ? edge : 0;
    ramp(A.edgeGain.gain, (0.004 + 0.062 * e * e) * m, 0.09);
    ramp(A.edgeOsc.frequency, 430 + 780 * e, 0.09);
    ramp(A.edgeFilt.frequency, 700 + 1900 * e, 0.09);

    ramp(A.padGain.gain, (powered && alive ? 0.055 : 0) * m, 0.15);
  };

  A.toggleMute = function () {
    A.muted = !A.muted;
    if (A.master) ramp(A.master.gain, A.muted ? 0.0001 : 0.85, 0.05);
    return A.muted;
  };

  D.audio = A;
})();
