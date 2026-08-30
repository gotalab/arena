/* DELVE — sound, synthesised in code. No files, no fetches, always in tune
 * with the tuning. Starts only after the player's first input; the game plays
 * perfectly in silence and nothing here can ever influence a rule.
 *
 * One voice family: a dark drone engine, mineral bell pickups, and the signature
 * "edge" tone that climbs while the machine is flown at its limit.
 */
(function (root) {
  'use strict';
  var DELVE = (root.DELVE = root.DELVE || {});

  // D minor pentatonic, so every one-shot lands in the same key
  var ROOT = 73.416; // D2
  var SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  function note(step) { return ROOT * Math.pow(2, SCALE[Math.max(0, Math.min(SCALE.length - 1, step))] / 12); }

  function Audio() {
    this.ctx = null;
    this.ok = false;
    this.muted = false;
    this.edge = 0;
    this.sustain = 0;
    this.tickAt = 99;
    this.started = false;
  }

  Audio.prototype.start = function () {
    if (this.started) { this.resume(); return; }
    this.started = true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var c = new AC();
      this.ctx = c;

      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 9;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;

      var master = c.createGain();
      master.gain.value = this.muted ? 0 : 0.85;
      comp.connect(master);
      master.connect(c.destination);
      this.master = master;
      this.bus = comp;

      // ---- noise source, shared
      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // ---- engine: two detuned saws under a moving lowpass
      var eg = c.createGain(); eg.gain.value = 0;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 240; lp.Q.value = 6;
      var o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      var o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.9;
      var sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = 27.5;
      var subG = c.createGain(); subG.gain.value = 0.5;
      o1.connect(lp); o2.connect(lp); sub.connect(subG); subG.connect(lp);
      lp.connect(eg); eg.connect(comp);
      o1.start(); o2.start(); sub.start();
      this.eng = { g: eg, lp: lp, o1: o1, o2: o2, sub: sub };

      // ---- drill grind: filtered noise
      var ns = c.createBufferSource();
      ns.buffer = buf; ns.loop = true;
      var nf = c.createBiquadFilter(); nf.type = 'bandpass';
      nf.frequency.value = 900; nf.Q.value = 1.1;
      var ng = c.createGain(); ng.gain.value = 0;
      ns.connect(nf); nf.connect(ng); ng.connect(comp);
      ns.start();
      this.grind = { g: ng, f: nf };

      // ---- the edge: the signature voice of flying at the limit
      var xo = c.createOscillator(); xo.type = 'triangle'; xo.frequency.value = 440;
      var xo2 = c.createOscillator(); xo2.type = 'sine'; xo2.frequency.value = 660;
      var xg = c.createGain(); xg.gain.value = 0;
      var xf = c.createBiquadFilter(); xf.type = 'bandpass'; xf.frequency.value = 900; xf.Q.value = 3;
      xo.connect(xf); xo2.connect(xf); xf.connect(xg); xg.connect(comp);
      xo.start(); xo2.start();
      this.edgeV = { g: xg, o: xo, o2: xo2, f: xf };

      // ---- powered shimmer
      var pg = c.createGain(); pg.gain.value = 0;
      var po = c.createOscillator(); po.type = 'square'; po.frequency.value = note(7);
      var pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 1400;
      var plfo = c.createOscillator(); plfo.type = 'sine'; plfo.frequency.value = 6.5;
      var plg = c.createGain(); plg.gain.value = 340;
      plfo.connect(plg); plg.connect(pf.frequency);
      po.connect(pf); pf.connect(pg); pg.connect(comp);
      po.start(); plfo.start();
      this.pow = { g: pg, o: po };

      this.ok = true;
    } catch (e) { this.ok = false; }
  };

  Audio.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
  };

  Audio.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.02);
  };

  // Continuous voices follow the machine every frame.
  Audio.prototype.drive = function (dt, s) {
    if (!this.ok) return;
    var c = this.ctx, now = c.currentTime;
    var sf = s.speedFrac;
    var playing = s.phase === 'playing';

    var over = Math.max(0, sf - 0.62) / 0.38;
    this.sustain += (over > 0.15 ? dt * 0.55 : -dt * 1.5);
    this.sustain = Math.max(0, Math.min(1, this.sustain));
    var comboK = Math.min(1, s.combo / 7);
    var target = playing ? Math.min(1, over * 0.75 + this.sustain * 0.35 + comboK * 0.75) : 0;
    this.edge += (target - this.edge) * Math.min(1, dt * 5);

    var k = 0.05;
    // engine
    var f = 44 + sf * 116;
    this.eng.o1.frequency.setTargetAtTime(f, now, k);
    this.eng.o2.frequency.setTargetAtTime(f * 1.012, now, k);
    this.eng.sub.frequency.setTargetAtTime(f * 0.5, now, k);
    this.eng.lp.frequency.setTargetAtTime(200 + sf * 1500 + (s.throttle ? 260 : 0), now, k);
    this.eng.g.gain.setTargetAtTime(playing || s.phase === 'ready' ? (0.055 + 0.14 * sf) : 0, now, 0.12);

    // drill grind
    this.grind.f.frequency.setTargetAtTime(620 + sf * 2600, now, k);
    this.grind.g.gain.setTargetAtTime(playing ? (0.012 + 0.055 * sf) * (s.throttle ? 1.35 : 0.7) : 0, now, 0.1);

    // the edge
    this.edgeV.o.frequency.setTargetAtTime(note(4) * 2 * (1 + this.edge * 0.75 + comboK * 0.5), now, 0.06);
    this.edgeV.o2.frequency.setTargetAtTime(note(7) * 3 * (1 + this.edge * 0.5), now, 0.06);
    this.edgeV.f.frequency.setTargetAtTime(700 + this.edge * 2600, now, 0.08);
    this.edgeV.g.gain.setTargetAtTime(this.edge * 0.075, now, 0.07);

    // powered shimmer
    this.pow.g.gain.setTargetAtTime(s.powered ? 0.035 : 0, now, 0.08);
    if (s.powered) this.pow.o.frequency.setTargetAtTime(note(7) * 2, now, 0.1);

    // the clock, heard
    if (playing && s.remainingMs < 8000) {
      var period = s.remainingMs < 4000 ? 0.32 : 0.62;
      this.tickAt -= dt;
      if (this.tickAt <= 0) {
        this.tickAt = period;
        this.blip(s.remainingMs < 4000 ? note(3) * 4 : note(2) * 4, 0.05, 0.045, 'square');
      }
    } else this.tickAt = 0.1;
  };

  // ------------------------------------------------------------- one-shots --
  Audio.prototype.blip = function (freq, dur, gain, type, slide) {
    if (!this.ok) return;
    var c = this.ctx, now = c.currentTime;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.bus);
    o.start(now); o.stop(now + dur + 0.03);
  };

  Audio.prototype.noise = function (dur, gain, type, f0, f1, q) {
    if (!this.ok) return;
    var c = this.ctx, now = c.currentTime;
    var s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.5;
    var f = c.createBiquadFilter();
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), now + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f); f.connect(g); g.connect(this.bus);
    s.start(now); s.stop(now + dur + 0.02);
  };

  Audio.prototype.event = function (kind, data, state) {
    if (!this.ok) return;
    if (kind === 'fragment') {
      var step = 3 + Math.min(6, (data.chain || 1) - 1);
      this.blip(note(step) * 4, 0.2, 0.10, 'triangle');
      this.blip(note(step) * 8, 0.12, 0.045, 'sine');
    } else if (kind === 'rock_hit') {
      this.noise(0.3, 0.4, 'lowpass', 1600, 90, 1);
      this.blip(96, 0.34, 0.28, 'sine', 0.34);
    } else if (kind === 'wall_contact') {
      this.noise(0.34, 0.32, 'bandpass', 900, 140, 1.4);
      this.blip(74, 0.3, 0.22, 'sine', 0.4);
    } else if (kind === 'rock_broken') {
      if (data.powered) {
        this.noise(0.16, 0.24, 'highpass', 1400, 3600, 0.8);
        this.blip(note(5 + Math.floor(Math.random() * 4)) * 4, 0.16, 0.09, 'square');
      } else {
        this.noise(0.2, 0.16, 'bandpass', 2200, 500, 1.2);
      }
    } else if (kind === 'near_miss') {
      var c2 = Math.min(8, data.combo || 1);
      var close = 1 - Math.min(1, data.gap / DELVE.C.NEAR_MISS_WINDOW);
      this.noise(0.2 + 0.1 * close, 0.1 + 0.14 * close, 'bandpass',
        700 + 900 * close + c2 * 260, 2600 + c2 * 420, 2.2);
      this.blip(note(2 + c2) * 2, 0.13, 0.035 + 0.02 * close, 'sine');
    } else if (kind === 'power') {
      for (var i = 0; i < 5; i++) {
        var self = this, s2 = i;
        setTimeout(function () { self.blip(note(3 + s2 * 2) * 2, 0.28, 0.1, 'square'); }, i * 62);
      }
      this.noise(0.6, 0.2, 'highpass', 500, 5200, 0.7);
    } else if (kind === 'run_end') {
      var seq = [7, 5, 3, 0];
      for (var j = 0; j < seq.length; j++) {
        (function (self, n, delay) {
          setTimeout(function () {
            self.blip(note(n) * 2, 0.5, 0.11, 'triangle');
            self.blip(note(n), 0.7, 0.07, 'sine');
          }, delay);
        })(this, seq[j], j * 155);
      }
      this.noise(1.1, 0.14, 'lowpass', 900, 70, 1);
    } else if (kind === 'start') {
      this.blip(note(0) * 2, 0.24, 0.09, 'triangle', 2.2);
      this.noise(0.3, 0.12, 'lowpass', 400, 2400, 0.8);
    }
    void state;
  };

  DELVE.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
