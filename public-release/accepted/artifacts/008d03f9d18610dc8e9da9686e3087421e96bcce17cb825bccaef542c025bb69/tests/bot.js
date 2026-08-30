// Shared in-page bot used by the behaviour tests.
//
// It plays the game the way the design asks a player to: it predicts where the
// ball will come back to the deck, picks a return band that can reach the
// target's lane, and solves for the outgoing horizontal speed that carries the
// ball *past* the target on the way up and back down onto its top. When no such
// return exists from the current meeting point, it spends a bounce moving the
// next meeting point sideways instead of throwing the ball into an underside.
module.exports = `
window.__T = {
  hold: { left: false, right: false },
  key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code })); },
  setAxis(a) {
    const L = a < -0.15, R = a > 0.15;
    if (L !== this.hold.left) { this.key('ArrowLeft', L); this.hold.left = L; }
    if (R !== this.hold.right) { this.key('ArrowRight', R); this.hold.right = R; }
  },
  jump() { this.key('Space', true); this.key('Space', false); },
  releaseAll() { this.setAxis(0); this.key('Space', false); },

  K() { return window.STOMP_K; },

  foldX(x, r) {
    const W = this.K().W, span = W - 2 * r;
    let u = (x - r) % (2 * span); if (u < 0) u += 2 * span;
    return u <= span ? r + u : r + (2 * span - u);
  },

  // time for the ball to fall to a given altitude (null if it never does)
  timeToY(b, y) {
    const g = this.K().BALL_GRAV;
    const A = 0.5 * g, B = b.vy, C = b.y - y;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const t = (-B + Math.sqrt(disc)) / (2 * A);
    return t >= 0 ? t : null;
  },

  deckBallY() {
    const K = this.K();
    return K.GROUND_Y - K.MACH_HALF_H * 2 - K.BALL_R - 0.5;
  },

  // where and when the ball meets the grounded machine's deck
  meet(s) {
    const t = this.timeToY(s.ball, this.deckBallY());
    if (t === null) return { t: 9, x: s.machine.x };
    return { t, x: this.foldX(s.ball.x + s.ball.vx * t, this.K().BALL_R) };
  },

  bandSpeed(contactY, band) {
    const K = this.K();
    const rise = contactY - K.BAND_APEX[band];
    return Math.max(K.BOUNCE_MIN, rise > 0 ? Math.sqrt(2 * K.BALL_GRAV * rise) : 0);
  },

  // pick the flyer worth pursuing; stay locked on a wounded one
  lock: -1,
  target(s) {
    let best = null, bestScore = -1e9;
    for (const e of s.enemies) {
      if (!e.active || e.lane === 'ground') continue;
      const margin = Math.min(e.x, this.K().W - e.x);
      if (margin < 26) continue;
      if (e.id === this.lock) return e;
      const sc = e.hitsTaken * 1000 + margin * 0.2 + (e.lane === 'low' ? 60 : 0);
      if (sc > bestScore) { bestScore = sc; best = e; }
    }
    this.lock = best ? best.id : -1;
    return best;
  },

  // does an arc leaving meet.x with speed w keep clear of every flyer it is not
  // aiming at, at both the ascending and descending crossing of that flyer?
  clearOthers(s, meet, w, launchY, v, skipId) {
    const K = this.K(), g = K.BALL_GRAV;
    const tUp = v / g, apex = launchY - v * v / (2 * g);
    for (const e of s.enemies) {
      if (!e.active || e.lane === 'ground' || e.id === skipId) continue;
      const alt = e.y - e.collisionRadius - K.BALL_R;
      if (alt - apex < 0) continue;               // the arc never reaches it
      const tC = Math.sqrt(2 * (alt - apex) / g);
      const pad = e.collisionRadius + K.BALL_R + 4;
      for (const t of [tUp - tC, tUp + tC]) {
        if (t < 0) continue;
        const bx = meet.x + w * t, ex = e.x + e.vx * (meet.t + t);
        if (Math.abs(bx - ex) < pad) return false;
      }
    }
    return true;
  },

  // full return plan for this moment
  plan(s) {
    const K = this.K(), g = K.BALL_GRAV;
    const meet = this.meet(s);
    const grounded = this.deckBallY();
    const tgt = this.target(s);
    if (!tgt) return { meet, w: 0, jump: false, attack: false };

    const cr = tgt.collisionRadius + K.BALL_R;
    const tol = cr * 0.5;
    const strike = tgt.y - tgt.collisionRadius - K.BALL_R;
    // a power return is caught off a rising deck, so it leaves from higher up
    const launchFor = { normal: grounded, power: grounded - 62 };

    for (const band of ['normal', 'power']) {
      const launchY = launchFor[band];
      const v = this.bandSpeed(launchY, band);
      const apex = launchY - v * v / (2 * g);
      if (strike - apex < 24) continue;             // band cannot clear the lane
      const tUp = v / g, tC = Math.sqrt(2 * (strike - apex) / g);
      const tD = tUp + tC, tA = tUp - tC;
      if (tA <= 0.06) continue;
      // gap = (ball x) - (enemy x), measured from the launch instant
      const gap0 = meet.x - (tgt.x + tgt.vx * meet.t);
      // land off-centre on the far side so the ascent passes wider
      const off = (gap0 >= 0 ? 1 : -1) * tol;
      const w = tgt.vx + (off - gap0) / tD;
      if (Math.abs(w) > K.BALL_VX_MAX * 0.94) continue;
      const gapA = gap0 + (w - tgt.vx) * tA;
      if (Math.abs(gapA) < cr + 7) continue;        // the ascent would bite
      const land = meet.x + w * tD;
      if (land < 26 || land > K.W - 26) continue;
      if (!this.clearOthers(s, meet, w, launchY, v, tgt.id)) continue;
      return { meet, w, jump: band === 'power', attack: true, band };
    }

    // no attack from here: use this bounce to move the next meeting point away
    const v = this.bandSpeed(grounded, 'normal');
    const flight = 2 * v / g;
    const tx = tgt.x + tgt.vx * (meet.t + flight);
    const away = (meet.x >= tx ? 1 : -1);
    const wantX = Math.max(48, Math.min(K.W - 48, tx + away * 96));
    let w = (wantX - meet.x) / flight;
    w = Math.max(-K.BALL_VX_MAX * 0.9, Math.min(K.BALL_VX_MAX * 0.9, w));
    return { meet, w, jump: false, attack: false, band: 'normal' };
  },

  // machine speed at contact that produces outgoing w with a centred catch
  mvFor(s, w) {
    const K = this.K();
    return Math.max(-K.MACH_SPEED, Math.min(K.MACH_SPEED, (w - s.ball.vx * 0.30) / 0.62));
  },

  // one tick of play
  act(s) {
    const K = this.K();
    if (!s.ball.active) { this.setAxis(0); return; }
    const m = s.machine;
    const p = this.plan(s);
    const mv = this.mvFor(s, p.w);
    const tt = p.meet.t;
    const dxBall = s.ball.x - m.x;

    // Park just off the meeting point on the trailing side, then dash through
    // the ball so contact happens at the speed the return needs. The dash
    // distance is exactly what the machine covers while reaching that speed,
    // so it arrives centred on the ball rather than running past it.
    let mvw = mv;
    let park = (mvw * mvw) / (2 * K.MACH_ACCEL);
    if (park > 15) { park = 15; mvw = Math.sign(mvw) * Math.sqrt(2 * K.MACH_ACCEL * park); }
    const dash = Math.abs(mvw) / K.MACH_ACCEL;
    const sgn = Math.abs(mvw) > 20 ? Math.sign(mvw) : 0;
    const parkX = Math.max(K.MACH_HALF_W, Math.min(K.W - K.MACH_HALF_W, p.meet.x - sgn * park));

    let axis;
    if (sgn !== 0 && tt <= dash + 0.01) axis = sgn;
    else if (tt < 1.6) axis = Math.max(-1, Math.min(1, (parkX - m.x) / 14 - m.vx / 500));
    else axis = Math.max(-1, Math.min(1, (p.meet.x - m.x) / 40 - m.vx / 700));

    // a walker in the way of that trip: hop it while there is time
    let hop = false;
    for (const e of s.enemies) {
      if (!e.active || e.lane !== 'ground') continue;
      const d = e.x - m.x;
      if (Math.abs(d) < 54 && d * (axis || 1) > -8) hop = true;
    }

    this.setAxis(axis);
    if (m.grounded) {
      if (hop && tt > 0.5) this.jump();
      else if (p.jump && tt < 0.20 && Math.abs(dxBall) < 26) this.jump();
    }
  },

  run(seed, ticks) {
    const G = window.__ARENA_GAME__;
    this.releaseAll();
    this.lock = -1;
    G.reset(seed);
    this.jump();
    const kinds = {};
    let lastSeq = 0;
    const apexes = [];
    let watch = null;
    let interrupted = false;
    for (let i = 0; i < ticks; i++) {
      const s = G.snapshot();
      if (s.phase !== 'run') break;
      this.act(s);
      G.advance(1000 / 60);
      const s2 = G.snapshot();
      for (const e of s2.recentEvents) {
        if (e.sequence <= lastSeq) continue;
        lastSeq = e.sequence;
        kinds[e.kind] = (kinds[e.kind] || 0) + 1;
        if (e.kind.indexOf('ball_bounce_') === 0) {
          watch = { band: e.kind.slice(12), min: 9999 };
          interrupted = false;
        } else if (watch && (e.kind === 'top_hit' || e.kind === 'wrong_side_hit' || e.kind === 'ball_drop')) {
          interrupted = true;
        }
      }
      if (watch) {
        if (s2.ball.y < watch.min) watch.min = s2.ball.y;
        if (s2.ball.vy > 0 || !s2.ball.active) {
          if (!interrupted) apexes.push([watch.band, Math.round(watch.min)]);
          watch = null;
        }
      }
    }
    const fin = G.snapshot();
    this.releaseAll();
    return { kinds, apexes, fin };
  }
};
`;
