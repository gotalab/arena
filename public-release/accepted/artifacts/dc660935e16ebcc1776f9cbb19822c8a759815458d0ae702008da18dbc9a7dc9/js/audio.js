/* EMBER — the whole sound identity, synthesised in code.
 *
 * Nothing here is loaded from a file and nothing here can influence the rules.
 * The context is created on the player's first press; before that, and whenever
 * muted, every call is a no-op and the game plays perfectly in silence.
 *
 * The signature voice is the chain: each link is one step up a warm pentatonic
 * ladder, brighter and wetter than the link before it.
 */
(function (E) {
  'use strict';

  var A = {
    ctx: null,
    ready: false,
    muted: false,
    master: null,
    wet: null,
    noise: null,
    drone: null,
    droneGain: null,
    breath: null,
    breathGain: null,
    wind: null,
    windGain: null,
    proximity: 0
  };

  var PENTA = [0, 2, 4, 7, 9];

  function semi(n) {
    var oct = Math.floor(n / 5);
    return PENTA[((n % 5) + 5) % 5] + 12 * oct;
  }
  function hz(base, n) { return base * Math.pow(2, semi(n) / 12); }

  function now() { return A.ctx.currentTime; }

  function ensure() {
    if (A.ctx) {
      if (A.ctx.state === 'suspended') { A.ctx.resume(); }
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    try { A.ctx = new AC(); } catch (e) { return; }

    var c = A.ctx;
    var master = c.createGain();
    master.gain.value = A.muted ? 0 : 0.62;

    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(c.destination);

    // cheap shimmer: two feedback delays with a lowpass in the loop
    var wet = c.createGain(); wet.gain.value = 0.5;
    var d1 = c.createDelay(0.6); d1.delayTime.value = 0.113;
    var d2 = c.createDelay(0.6); d2.delayTime.value = 0.171;
    var fb = c.createGain(); fb.gain.value = 0.42;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    wet.connect(d1); wet.connect(d2);
    d1.connect(lp); d2.connect(lp);
    lp.connect(fb); fb.connect(d1); fb.connect(d2);
    lp.connect(master);

    A.master = master;
    A.wet = wet;

    // one shared noise table
    var len = Math.floor(c.sampleRate * 2);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    var seedv = 12345;
    for (var i = 0; i < len; i++) {
      seedv = (seedv * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seedv / 0x3fffffff) - 1;
    }
    A.noise = buf;

    /* ---- the flue's own voice: wind, and the damp below ---- */
    A.wind = c.createBufferSource();
    A.wind.buffer = buf; A.wind.loop = true;
    var wbp = c.createBiquadFilter(); wbp.type = 'bandpass';
    wbp.frequency.value = 460; wbp.Q.value = 0.7;
    A.windGain = c.createGain(); A.windGain.gain.value = 0.035;
    A.wind.connect(wbp); wbp.connect(A.windGain); A.windGain.connect(master);
    var wlfo = c.createOscillator(); wlfo.frequency.value = 0.07;
    var wlg = c.createGain(); wlg.gain.value = 0.022;
    wlfo.connect(wlg); wlg.connect(A.windGain.gain); wlfo.start();
    A.wind.start();

    A.droneGain = c.createGain(); A.droneGain.gain.value = 0;
    var dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 190;
    var o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 54.5;
    var o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.4;
    o1.connect(dlp); o2.connect(dlp); dlp.connect(A.droneGain); A.droneGain.connect(master);
    o1.start(); o2.start();
    A.drone = o1;

    A.breath = c.createBufferSource();
    A.breath.buffer = buf; A.breath.loop = true;
    var bbp = c.createBiquadFilter(); bbp.type = 'bandpass';
    bbp.frequency.value = 240; bbp.Q.value = 1.1;
    A.breathGain = c.createGain(); A.breathGain.gain.value = 0;
    A.breath.connect(bbp); bbp.connect(A.breathGain); A.breathGain.connect(master);
    var blfo = c.createOscillator(); blfo.frequency.value = 0.22;
    var blg = c.createGain(); blg.gain.value = 90;
    blfo.connect(blg); blg.connect(bbp.frequency); blfo.start();
    A.breath.start();

    A.ready = true;
  }

  function setMuted(m) {
    A.muted = m;
    if (A.master) {
      A.master.gain.cancelScheduledValues(now());
      A.master.gain.linearRampToValueAtTime(m ? 0 : 0.62, now() + 0.08);
    }
  }

  /* ------------------------------------------------------------- voices */

  function tone(opt) {
    if (!A.ready) { return; }
    if (!isFinite(opt.f0) || !isFinite(opt.dur) || opt.dur <= 0) { return; }
    var c = A.ctx, t = now() + (opt.delay || 0);
    var o = c.createOscillator();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(opt.f0, t);
    if (opt.f1 !== undefined) {
      if (opt.exp) { o.frequency.exponentialRampToValueAtTime(Math.max(1, opt.f1), t + opt.dur); }
      else { o.frequency.linearRampToValueAtTime(opt.f1, t + opt.dur); }
    }
    var g = c.createGain();
    var peak = opt.gain === undefined ? 0.2 : opt.gain;
    var atk = opt.atk === undefined ? 0.006 : opt.atk;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);
    var node = o;
    if (opt.cutoff) {
      var f = c.createBiquadFilter();
      f.type = opt.filterType || 'lowpass';
      f.frequency.setValueAtTime(opt.cutoff, t);
      if (opt.cutoff1) { f.frequency.linearRampToValueAtTime(opt.cutoff1, t + opt.dur); }
      f.Q.value = opt.q || 1;
      o.connect(f); node = f;
    }
    node.connect(g);
    g.connect(A.master);
    if (opt.send) { var w = c.createGain(); w.gain.value = opt.send; g.connect(w); w.connect(A.wet); }
    o.start(t);
    o.stop(t + opt.dur + 0.05);
  }

  function noiseHit(opt) {
    if (!A.ready) { return; }
    if (!isFinite(opt.f0) || !isFinite(opt.dur) || opt.dur <= 0 || !isFinite(opt.gain)) { return; }
    var c = A.ctx, t = now() + (opt.delay || 0);
    var s = c.createBufferSource();
    s.buffer = A.noise;
    s.loop = true;
    s.playbackRate.value = opt.rate || 1;
    var f = c.createBiquadFilter();
    f.type = opt.filterType || 'bandpass';
    f.frequency.setValueAtTime(opt.f0, t);
    if (opt.f1) { f.frequency.exponentialRampToValueAtTime(Math.max(30, opt.f1), t + opt.dur); }
    f.Q.value = opt.q === undefined ? 1.2 : opt.q;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opt.gain, t + (opt.atk || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);
    s.connect(f); f.connect(g); g.connect(A.master);
    if (opt.send) { var w = c.createGain(); w.gain.value = opt.send; g.connect(w); w.connect(A.wet); }
    s.start(t);
    s.stop(t + opt.dur + 0.05);
  }

  /* --------------------------------------------------------- the events */

  function launch(power) {
    noiseHit({ f0: 380, f1: 2500, dur: 0.2, gain: 0.10 + 0.06 * power, q: 0.9 });
    tone({ type: 'triangle', f0: 150 + 90 * power, f1: 420 + 300 * power, dur: 0.16, gain: 0.10, exp: true });
  }

  function land(kind) {
    tone({ type: 'sine', f0: 165, f1: 62, dur: 0.2, gain: 0.30, exp: true });
    noiseHit({ f0: kind === 'wall' ? 1500 : 620, f1: kind === 'wall' ? 700 : 260, dur: kind === 'wall' ? 0.34 : 0.11, gain: 0.07, filterType: 'lowpass', q: 0.8 });
  }

  function refill(n) {
    for (var i = 0; i < n; i++) {
      tone({ type: 'triangle', f0: hz(330, 3 + i), dur: 0.1, gain: 0.055, delay: 0.045 * i, send: 0.25 });
    }
  }

  function bounce(link) {
    noiseHit({ f0: 1900, f1: 420, dur: 0.13, gain: 0.16, q: 0.7, filterType: 'bandpass' });
    tone({ type: 'square', f0: 520, f1: 180, dur: 0.07, gain: 0.06, exp: true, cutoff: 2600 });
  }

  function glimmer(chain) {
    var n = 6 + Math.min(chain, 8);
    var f = hz(440, n);
    tone({ type: 'sine', f0: f, dur: 0.5, gain: 0.13, atk: 0.003, send: 0.5 });
    tone({ type: 'sine', f0: f * 3.02, dur: 0.24, gain: 0.05, atk: 0.002, send: 0.6 });
  }

  // the crescendo the player is conducting
  function chainLink(link) {
    var n = Math.min(link, 24);
    var f = hz(262, 2 + n);
    var bright = Math.min(1, n / 9);
    tone({
      type: 'triangle', f0: f, dur: 0.24 + 0.03 * bright, gain: 0.10 + 0.05 * bright,
      atk: 0.003, cutoff: 900 + 4200 * bright, cutoff1: 700 + 2500 * bright,
      send: 0.25 + 0.5 * bright
    });
    tone({
      type: 'sawtooth', f0: f * 2.005, dur: 0.14, gain: 0.02 + 0.045 * bright,
      atk: 0.002, cutoff: 1600 + 3600 * bright, send: 0.3 + 0.4 * bright
    });
    if (n >= 4) {
      tone({ type: 'sine', f0: f * 4, dur: 0.2, gain: 0.02 * bright, atk: 0.002, send: 0.7 });
    }
  }

  function bank(links) {
    var big = Math.min(1, links / 8);
    var chord = [0, 2, 4, 5, 7];      // pentatonic degrees, one voice per degree
    var n = 3 + Math.round(2 * big);
    for (var i = 0; i < n && i < chord.length; i++) {
      tone({
        type: 'triangle', f0: hz(131, chord[i]), dur: 0.75 + 0.5 * big,
        gain: 0.05 + 0.045 * big, atk: 0.05 + 0.02 * i, delay: 0.02 * i, send: 0.45,
        cutoff: 1800 + 2000 * big
      });
    }
    noiseHit({ f0: 3200, f1: 900, dur: 0.5, gain: 0.03 + 0.03 * big, q: 0.6, send: 0.5 });
  }

  function death() {
    tone({ type: 'sawtooth', f0: 210, f1: 34, dur: 1.5, gain: 0.16, exp: true, cutoff: 900, cutoff1: 140 });
    tone({ type: 'sine', f0: 90, f1: 40, dur: 1.2, gain: 0.18, exp: true, atk: 0.02 });
    noiseHit({ f0: 900, f1: 120, dur: 1.6, gain: 0.09, q: 0.5, filterType: 'lowpass' });
  }

  function newBest() {
    for (var i = 0; i < 5; i++) {
      tone({ type: 'triangle', f0: hz(392, 4 + i), dur: 0.5, gain: 0.075, delay: 0.075 * i, send: 0.6 });
    }
  }

  // damp proximity 0..1 — the antagonist's presence, always audible when near
  function ambience(prox, dt) {
    if (!A.ready) { return; }
    A.proximity += (prox - A.proximity) * Math.min(1, dt * 3);
    var p = A.proximity;
    var t = now();
    A.droneGain.gain.setTargetAtTime(0.02 + 0.20 * p * p, t, 0.15);
    A.breathGain.gain.setTargetAtTime(0.01 + 0.11 * p, t, 0.2);
    A.windGain.gain.setTargetAtTime(0.03 + 0.02 * (1 - p), t, 0.4);
  }

  E.Audio = {
    state: A,
    ensure: ensure,
    setMuted: setMuted,
    isMuted: function () { return A.muted; },
    launch: launch,
    land: land,
    refill: refill,
    bounce: bounce,
    glimmer: glimmer,
    chainLink: chainLink,
    bank: bank,
    death: death,
    newBest: newBest,
    ambience: ambience
  };

})(window.EMBER);
