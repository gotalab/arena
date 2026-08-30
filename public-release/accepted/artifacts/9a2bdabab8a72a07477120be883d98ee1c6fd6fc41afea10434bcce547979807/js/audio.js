(function () {
  var D = window.DELVE;

  function createAudio() {
    var ctx = null, master = null;
    var engineO = null, engineOF = null, engineN = null, engineNF = null, engineG = null;
    var edgeO = null, edgeG = null;
    var noiseBuf = null;
    var started = false, muted = false;
    var noteIdx = 0, lastNoteT = 0, lastTickS = -1;

    function ensure() {
      if (ctx) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
      } catch (e) { return; }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = makeNoise();

      engineO = ctx.createOscillator();
      engineO.type = 'sawtooth';
      engineO.frequency.value = 45;
      engineOF = ctx.createBiquadFilter();
      engineOF.type = 'lowpass';
      engineOF.frequency.value = 180;
      engineOF.Q.value = 1.2;
      engineO.connect(engineOF);

      engineN = ctx.createBufferSource();
      engineN.buffer = noiseBuf;
      engineN.loop = true;
      engineNF = ctx.createBiquadFilter();
      engineNF.type = 'bandpass';
      engineNF.frequency.value = 220;
      engineNF.Q.value = 0.9;
      engineN.connect(engineNF);

      engineG = ctx.createGain();
      engineG.gain.value = 0;
      engineOF.connect(engineG);
      engineNF.connect(engineG);
      engineG.connect(master);
      engineO.start();
      engineN.start();

      edgeO = ctx.createOscillator();
      edgeO.type = 'sine';
      edgeO.frequency.value = 420;
      edgeG = ctx.createGain();
      edgeG.gain.value = 0;
      edgeO.connect(edgeG);
      edgeG.connect(master);
      edgeO.start();
    }

    function makeNoise() {
      var len = ctx.sampleRate * 1;
      var b = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    function blip(freq, type, dur, vol, slideTo) {
      if (!ctx || muted) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(t + dur + 0.03);
    }

    function noiseBurst(dur, vol, fromF, toF, type) {
      if (!ctx || muted) return;
      var t = ctx.currentTime;
      var n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.setValueAtTime(fromF, t);
      if (toF !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, toF), t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start();
      n.stop(t + dur + 0.03);
    }

    return {
      firstInput: function () {
        started = true;
        ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume();
      },
      toggleMute: function () {
        muted = !muted;
        if (master && ctx) master.gain.value = muted ? 0 : 0.5;
        return muted;
      },
      get muted() { return muted; },
      reset: function () { noteIdx = 0; lastNoteT = 0; lastTickS = -1; },
      update: function (sim, dt) {
        if (!ctx) return;
        var sf = (sim.speed - 90) / 550;
        var ph = sim.phase;
        var eg = 0;
        if (started && !muted) {
          if (ph === 'playing') eg = 0.04 + sf * 0.5;
          else if (ph === 'ready') eg = 0.02;
          else eg = 0;
        }
        if (engineG) engineG.gain.value += (eg - engineG.gain.value) * Math.min(1, dt * 8);
        if (engineO) engineO.frequency.value += ((45 + sf * 150) - engineO.frequency.value) * Math.min(1, dt * 6);
        if (engineOF) engineOF.frequency.value = 160 + sf * 520;
        if (engineNF) engineNF.frequency.value = 200 + sf * 900;
        var near = sim.nearStreak || 0;
        if (edgeO) edgeO.frequency.value += ((420 + sf * 1000 + near * 280) - edgeO.frequency.value) * Math.min(1, dt * 5);
        if (edgeG) edgeG.gain.value = (started && !muted) ? ((sf > 0.55 ? (sf - 0.55) * 0.45 : 0) + near * 0.05) : 0;
        if (ph === 'playing' && started && !muted) {
          var rem = sim.remainingMs;
          if (rem < 5000) {
            var s = Math.floor(sim.timeMs / 1000);
            if (s !== lastTickS) {
              lastTickS = s;
              blip(rem < 2500 ? 880 : 660, 'square', 0.08, 0.05);
            }
          }
        }
      },
      event: function (kind, sim) {
        if (!ctx || muted) return;
        switch (kind) {
          case 'wall_contact':
            blip(100, 'sine', 0.18, 0.5, 38);
            noiseBurst(0.2, 0.4, 300, 80, 'lowpass');
            break;
          case 'rock_hit':
            blip(120, 'triangle', 0.15, 0.5, 50);
            noiseBurst(0.18, 0.5, 700, 120);
            break;
          case 'rock_broken':
            noiseBurst(0.15, 0.35, 900, 200);
            blip(660, 'triangle', 0.2, 0.25);
            blip(990, 'sine', 0.3, 0.15, 1400);
            break;
          case 'fragment':
            {
              var now = ctx.currentTime;
              if (now - lastNoteT > 0.45) noteIdx = 0;
              lastNoteT = now;
              var notes = [523, 587, 659, 784, 880, 1046];
              var f = notes[Math.min(noteIdx, notes.length - 1)];
              noteIdx++;
              blip(f, 'triangle', 0.22, 0.22);
              blip(f * 2, 'sine', 0.15, 0.06);
            }
            break;
          case 'power':
            [523, 659, 784, 1046].forEach(function (f, i) {
              setTimeout(function () { if (!muted) blip(f, 'triangle', 0.3, 0.18); }, i * 70);
            });
            break;
          case 'near_miss':
            {
              var s = Math.min(5, sim.nearStreak || 1);
              noiseBurst(0.25, 0.16 + s * 0.05, 500 + s * 400, 1600 + s * 500);
              blip(300 + s * 220, 'sine', 0.14, 0.08, 600 + s * 300);
            }
            break;
        }
      },
      gameOver: function () {
        if (!ctx || muted) return;
        blip(392, 'triangle', 0.35, 0.2);
        setTimeout(function () { if (!muted) blip(330, 'triangle', 0.35, 0.2); }, 180);
        setTimeout(function () { if (!muted) blip(262, 'triangle', 0.5, 0.22); }, 360);
        noiseBurst(0.5, 0.12, 400, 80, 'lowpass');
      },
      startRun: function () {
        if (!ctx || muted) return;
        blip(130, 'sawtooth', 0.25, 0.12, 220);
        noiseBurst(0.3, 0.2, 200, 700, 'bandpass');
      }
    };
  }

  D.audio = { createAudio: createAudio };
})();