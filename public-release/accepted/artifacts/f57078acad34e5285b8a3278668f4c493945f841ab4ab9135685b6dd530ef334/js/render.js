(function (root) {
  var Sim = null;

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }
  function hypot(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  var PAL = {
    night: "#0b0a14",
    flue: "#14111b",
    brick: "#2a2228",
    brickDark: "#1a151c",
    soot: "#0e0c12",
    ember: "#ff8a3a",
    emberHot: "#ffe7a3",
    emberDeep: "#d94a1e",
    core: "#fff6d8",
    moth: "#3a342f",
    mothWing: "#2a241f",
    glimmer: "#9ee7ff",
    glimmer2: "#fff1c2",
    damp: "#17352f",
    dampDeep: "#061412",
    dampGlow: "#3ec7a4",
    cream: "#f4e6c8",
    ink: "#100e14"
  };

  function seededRand(n) {
    var s = (n * 374761393 + 668265263) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 1274126177);
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  }

  function makeBricks(w, h, seed) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    g.fillStyle = PAL.brickDark;
    g.fillRect(0, 0, w, h);
    var rows = 14;
    var rh = h / rows;
    for (var r = 0; r < rows; r++) {
      var off = r % 2 ? 0.5 : 0;
      var cols = 6;
      var cw = w / cols;
      for (var col = -1; col <= cols; col++) {
        var u = seededRand(seed + r * 31 + col * 17);
        var x = (col + off) * cw + 1;
        var y = r * rh + 1;
        var rw = cw - 2;
        var rh2 = rh - 2;
        var shade = 18 + u * 22;
        g.fillStyle = "rgb(" + (28 + shade * 0.4) + "," + (20 + shade * 0.25) + "," + (24 + shade * 0.2) + ")";
        g.fillRect(x, y, rw, rh2);
        g.strokeStyle = "rgba(0,0,0," + (0.25 + u * 0.25) + ")";
        g.strokeRect(x + 0.5, y + 0.5, rw, rh2);
        if (u > 0.7) {
          g.fillStyle = "rgba(0,0,0,0.28)";
          g.beginPath();
          g.ellipse(x + rw * u, y + rh2 * 0.6, 4 + u * 6, 2, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.fillStyle = "rgba(8,6,10,0.35)";
    g.fillRect(0, 0, w, h);
    return c;
  }

  function makeSoot(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    for (var i = 0; i < 220; i++) {
      var u = seededRand(90 + i);
      var v = seededRand(190 + i);
      g.fillStyle = "rgba(0,0,0," + (0.04 + u * 0.12) + ")";
      g.beginPath();
      g.ellipse(u * w, v * h, 8 + u * 30, 4 + v * 12, u * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  function createView() {
    return {
      camY: 100,
      particles: [],
      sparks: [],
      burstT: 0,
      landT: 0,
      chainPop: 0,
      shake: 0,
      titleA: 1,
      hintA: 1,
      outT: 0,
      bricksL: null,
      bricksR: null,
      soot: null,
      stars: [],
      flick: 0,
      lastEventKey: "",
      trail: [],
      ceremony: 0,
      idleLook: 0,
      blink: 0,
      readyBob: 0,
      pullHint: 0,
      rings: []
    };
  }

  function initView(view) {
    view.bricksL = makeBricks(96, 420, 11);
    view.bricksR = makeBricks(96, 420, 29);
    view.soot = makeSoot(160, 256);
    view.stars = [];
    for (var i = 0; i < 48; i++) {
      view.stars.push({
        x: seededRand(i * 3 + 4),
        y: seededRand(i * 7 + 9),
        r: 0.4 + seededRand(i * 13) * 1.4,
        a: 0.25 + seededRand(i * 17) * 0.6
      });
    }
  }

  function layout(canvas, wrap) {
    var vv = window.visualViewport;
    var W = Math.max(1, vv ? vv.width : window.innerWidth);
    var H = Math.max(1, vv ? vv.height : window.innerHeight);
    if (wrap) {
      wrap.style.top = (vv && vv.offsetTop ? vv.offsetTop : 0) + "px";
      wrap.style.left = (vv && vv.offsetLeft ? vv.offsetLeft : 0) + "px";
      wrap.style.width = W + "px";
      wrap.style.height = H + "px";
    }
    var aspect = 9 / 16;
    var sw;
    var sh;
    if (W / H > aspect) {
      sh = H;
      sw = H * aspect;
    } else {
      sw = W;
      sh = W / aspect;
    }
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var cssW = Math.floor(sw);
    var cssH = Math.floor(sh);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    var pw = Math.max(2, Math.round(cssW * dpr));
    var ph = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    return {
      cssW: cssW,
      cssH: cssH,
      dpr: dpr,
      stageW: 390,
      stageH: 693
    };
  }

  function spawnParticles(view, x, y, n, opts) {
    opts = opts || {};
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = (opts.speed || 40) * (0.3 + Math.random());
      view.particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * s + (opts.vx || 0),
        vy: Math.sin(a) * s + (opts.vy || 0),
        life: 1,
        decay: 0.8 + Math.random() * 1.4,
        size: (opts.size || 2.4) * (0.5 + Math.random()),
        color: opts.color || PAL.ember,
        g: opts.g == null ? -30 : opts.g
      });
    }
  }

  function react(view, st, prev) {
    var ev = st.lastEvent;
    if (!ev) return;
    var key = ev.kind + ":" + ev.tick;
    if (key === view.lastEventKey) return;
    view.lastEventKey = key;
    var chain = st.chainCount;
    if (ev.kind === "launch") {
      spawnParticles(view, st.x, st.y, 8, {
        color: PAL.ember,
        speed: 50,
        size: 2.2,
        vy: 20
      });
      view.shake = Math.max(view.shake, 2.2);
    } else if (ev.kind === "land") {
      spawnParticles(view, st.x, st.y - 8, 10, {
        color: "#c4a07a",
        speed: 36,
        size: 2,
        g: -80
      });
      view.landT = 1;
      view.shake = Math.max(view.shake, 1.6);
    } else if (ev.kind === "bounce") {
      view.burstT = 1;
      var n = 14 + Math.min(chain, 8) * 2;
      spawnParticles(view, st.x, st.y, n, {
        color: PAL.emberHot,
        speed: 70 + chain * 8,
        size: 2.6
      });
      spawnParticles(view, st.x, st.y, 6, {
        color: "#6b5b52",
        speed: 55,
        size: 3.2,
        g: -40
      });
      view.shake = Math.max(view.shake, 3 + Math.min(chain, 6) * 0.4);
    } else if (ev.kind === "glimmer") {
      spawnParticles(view, st.x, st.y, 12, {
        color: PAL.glimmer,
        speed: 48,
        size: 2.1,
        g: 10
      });
    } else if (ev.kind === "chain") {
      view.chainPop = 1;
      var extra = 4 + Math.min(st.chainCount, 10) * 3;
      spawnParticles(view, st.x, st.y, extra, {
        color: st.chainCount >= 4 ? PAL.glimmer2 : PAL.ember,
        speed: 30 + st.chainCount * 10,
        size: 1.8 + st.chainCount * 0.15
      });
      view.rings.push({
        x: st.x,
        y: st.y,
        r: 14,
        a: 0.75,
        vr: 160 + Math.min(st.chainCount, 10) * 28,
        w: 1.6 + Math.min(st.chainCount, 8) * 0.4
      });
    } else if (ev.kind === "chainBank") {
      spawnParticles(view, st.x, st.y, 16, {
        color: PAL.glimmer2,
        speed: 60,
        size: 2.4
      });
      view.landT = 1;
    }
  }

  function stepView(view, st, dt) {
    var target = st.y;
    var gap = st.y - st.dampY;
    var threat = clamp(1 - gap / 200, 0, 1);
    view.camY += (target - view.camY) * Math.min(1, dt * 5.5);
    if (st.phase === "ready") view.camY = st.y;
    view.burstT = Math.max(0, view.burstT - dt * 3.2);
    view.landT = Math.max(0, view.landT - dt * 2.4);
    view.chainPop = Math.max(0, view.chainPop - dt * 2.1);
    view.shake *= Math.pow(0.04, dt);
    view.flick += dt;
    view.readyBob += dt;
    view.pullHint += dt;
    view.idleLook += dt;
    view.blink += dt;
    if (st.phase === "playing" || st.input.dragging) {
      view.titleA += (0 - view.titleA) * Math.min(1, dt * 3);
      view.hintA += (0 - view.hintA) * Math.min(1, dt * 4);
    } else if (st.phase === "ready") {
      view.titleA += (1 - view.titleA) * Math.min(1, dt * 2);
      view.hintA += (1 - view.hintA) * Math.min(1, dt * 2);
    }
    if (st.phase === "gameover") {
      view.outT += dt;
      view.ceremony = Math.min(1, view.ceremony + dt * 1.6);
    } else {
      view.outT = 0;
      view.ceremony = 0;
    }
    view.threat = threat;
    view.sparkFrac = mix(0.6, 0.5, threat);

    if (!st.anchored && st.phase === "playing") {
      view.trail.push({ x: st.x, y: st.y, a: 0.55 });
      if (view.trail.length > 18) view.trail.shift();
    } else if (view.trail.length) {
      for (var t = 0; t < view.trail.length; t++) view.trail[t].a *= 0.86;
      if (view.trail[0] && view.trail[0].a < 0.04) view.trail.shift();
    }

    for (var i = view.particles.length - 1; i >= 0; i--) {
      var p = view.particles[i];
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) view.particles.splice(i, 1);
    }
    if (view.particles.length > 180) view.particles.splice(0, view.particles.length - 180);

    for (var r = view.rings.length - 1; r >= 0; r--) {
      var rg = view.rings[r];
      rg.r += rg.vr * dt;
      rg.a -= dt * 1.8;
      if (rg.a <= 0) view.rings.splice(r, 1);
    }

    if (st.face === "rest" && Math.random() < dt * 8) {
      spawnParticles(view, st.x + (Math.random() - 0.5) * 6, st.y + 6, 1, {
        color: PAL.ember,
        speed: 8,
        size: 1.4,
        vy: 12,
        g: -20
      });
    }
  }

  function worldScreen(layout, view, st, x, y) {
    var Sim = root.EmberSim;
    var W = layout.stageW;
    var H = layout.stageH;
    var wall = 48;
    var inner = W - wall * 2;
    var scale = inner / (Sim.WALL_RIGHT - Sim.WALL_LEFT);
    var sx = wall + (x - Sim.WALL_LEFT) * scale;
    var sy = H * view.sparkFrac - (y - view.camY) * scale;
    return { x: sx, y: sy, scale: scale, wall: wall, inner: inner };
  }

  function roundRect(g, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawBackground(g, L, view, st) {
    var W = L.stageW;
    var H = L.stageH;
    var grd = g.createLinearGradient(0, 0, 0, H);
    var climb = clamp((st.height - st.startY) / 1400, 0, 1);
    grd.addColorStop(0, mixColor("#15122a", "#1a2450", climb * 0.55));
    grd.addColorStop(0.35, "#100e18");
    grd.addColorStop(1, "#07060c");
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    g.save();
    g.globalAlpha = 0.35 + climb * 0.45;
    for (var i = 0; i < view.stars.length; i++) {
      var s = view.stars[i];
      var tw = 0.65 + Math.sin(view.flick * (1.2 + s.a) + i) * 0.35;
      g.fillStyle = "rgba(244,230,200," + s.a * tw + ")";
      g.beginPath();
      g.arc(s.x * W, s.y * H * 0.45, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    var mouth = g.createRadialGradient(W * 0.5, -H * 0.05, 10, W * 0.5, H * 0.1, H * 0.55);
    mouth.addColorStop(0, "rgba(40,55,110," + (0.18 + climb * 0.25) + ")");
    mouth.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = mouth;
    g.fillRect(0, 0, W, H);
  }

  function mixColor(a, b, t) {
    function hex(h) {
      return [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16)
      ];
    }
    var A = hex(a);
    var B = hex(b);
    var r = Math.round(mix(A[0], B[0], t));
    var g = Math.round(mix(A[1], B[1], t));
    var b2 = Math.round(mix(A[2], B[2], t));
    return "rgb(" + r + "," + g + "," + b2 + ")";
  }

  function drawWalls(g, L, view, st) {
    var Sim = root.EmberSim;
    var p0 = worldScreen(L, view, st, Sim.WALL_LEFT, view.camY);
    var wall = p0.wall;
    var W = L.stageW;
    var H = L.stageH;
    var scroll = -(view.camY * p0.scale) % 420;

    g.save();
    g.beginPath();
    g.rect(0, 0, wall, H);
    g.clip();
    g.drawImage(view.bricksL, 0, scroll - 420, wall, 420);
    g.drawImage(view.bricksL, 0, scroll, wall, 420);
    g.drawImage(view.bricksL, 0, scroll + 420, wall, 420);
    g.restore();

    g.save();
    g.beginPath();
    g.rect(W - wall, 0, wall, H);
    g.clip();
    g.drawImage(view.bricksR, W - wall, scroll - 420, wall, 420);
    g.drawImage(view.bricksR, W - wall, scroll, wall, 420);
    g.drawImage(view.bricksR, W - wall, scroll + 420, wall, 420);
    g.restore();

    g.drawImage(view.soot, 0, scroll * 0.4, wall, H);
    g.drawImage(view.soot, W - wall, scroll * 0.4, wall, H);

    var innerG = g.createLinearGradient(wall, 0, W - wall, 0);
    innerG.addColorStop(0, "rgba(0,0,0,0.45)");
    innerG.addColorStop(0.12, "rgba(0,0,0,0)");
    innerG.addColorStop(0.88, "rgba(0,0,0,0)");
    innerG.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = innerG;
    g.fillRect(wall, 0, W - wall * 2, H);

    g.fillStyle = "rgba(255,120,50,0.04)";
    var glow = worldScreen(L, view, st, st.x, st.y);
    var lg = g.createRadialGradient(glow.x, glow.y, 8, glow.x, glow.y, 160);
    lg.addColorStop(0, "rgba(255,140,60,0.16)");
    lg.addColorStop(1, "rgba(255,140,60,0)");
    g.fillStyle = lg;
    g.fillRect(wall, 0, W - wall * 2, H);

    g.save();
    g.globalAlpha = 0.14;
    var flueScroll = (view.camY * 0.35) % 80;
    for (var fy = -80; fy < H + 80; fy += 28) {
      g.strokeStyle = "rgba(255,180,120,0.07)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(wall + 8, fy - flueScroll);
      g.lineTo(W - wall - 8, fy - flueScroll);
      g.stroke();
    }
    g.restore();

    g.strokeStyle = "rgba(0,0,0,0.65)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(wall + 1.5, 0);
    g.lineTo(wall + 1.5, H);
    g.moveTo(W - wall - 1.5, 0);
    g.lineTo(W - wall - 1.5, H);
    g.stroke();
    g.strokeStyle = "rgba(255,160,90,0.08)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(wall + 3, 0);
    g.lineTo(wall + 3, H);
    g.moveTo(W - wall - 3, 0);
    g.lineTo(W - wall - 3, H);
    g.stroke();
  }

  function drawLedge(g, L, view, st, ledge) {
    var c = worldScreen(L, view, st, ledge.x, ledge.y);
    var sc = c.scale;
    var hw = ledge.halfWidth * sc;
    var th = 14 * sc * 0.5;
    var x = c.x - hw;
    var y = c.y - th;
    var w = hw * 2;
    var h = th * 2 + 3;
    g.save();
    g.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(g, x + 3, y + 5, w, h, 5);
    g.fill();
    var grd = g.createLinearGradient(x, y, x, y + h);
    grd.addColorStop(0, "#4a3b36");
    grd.addColorStop(0.45, "#2e2522");
    grd.addColorStop(1, "#1a1514");
    g.fillStyle = grd;
    roundRect(g, x, y, w, h, 6);
    g.fill();
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.stroke();
    g.fillStyle = "rgba(255,170,110,0.12)";
    roundRect(g, x + 4, y + 2, w - 8, 4, 2);
    g.fill();
    g.fillStyle = "rgba(210,90,40,0.35)";
    g.beginPath();
    g.ellipse(c.x - hw * 0.35, y + 3, 5, 2.2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,200,90,0.2)";
    g.beginPath();
    g.ellipse(c.x + hw * 0.25, y + 2.5, 3.5, 1.6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawMoth(g, L, view, st, it) {
    var p = worldScreen(L, view, st, it.x, it.y);
    var flap = Math.sin(view.flick * 9 + it.phase) * 0.55;
    var sc = (it.visualRadius / 13) * p.scale * 1.15;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.sin(view.flick * it.freq + it.phase) * 0.2);
    g.scale(sc, sc);
    function wing(side) {
      g.save();
      g.scale(side, 1);
      g.rotate(-0.35 - flap * 0.5);
      g.fillStyle = PAL.mothWing;
      g.beginPath();
      g.ellipse(7, -1, 8.5, 5.5, -0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#4a3c32";
      g.beginPath();
      g.ellipse(6, -1, 5, 3.2, -0.3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(220,90,40,0.45)";
      g.beginPath();
      g.ellipse(5.5, -0.8, 1.6, 1.6, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    wing(-1);
    wing(1);
    g.fillStyle = "#2a241f";
    g.beginPath();
    g.ellipse(0, 0, 3.2, 5.2, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#1a1612";
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(-1, -5);
    g.quadraticCurveTo(-4, -10, -5, -12);
    g.moveTo(1, -5);
    g.quadraticCurveTo(4, -10, 5, -12);
    g.stroke();
    g.fillStyle = "#e8c37a";
    g.beginPath();
    g.arc(-1.1, -1.5, 0.7, 0, Math.PI * 2);
    g.arc(1.1, -1.5, 0.7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawGlimmer(g, L, view, st, it) {
    var p = worldScreen(L, view, st, it.x, it.y);
    var tw = 0.75 + Math.sin(view.flick * 5 + it.phase) * 0.25;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(view.flick * 0.8 + it.phase);
    var R = it.visualRadius * p.scale * 1.1;
    var glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 3);
    glow.addColorStop(0, "rgba(255,241,194," + 0.55 * tw + ")");
    glow.addColorStop(0.4, "rgba(158,231,255," + 0.2 * tw + ")");
    glow.addColorStop(1, "rgba(158,231,255,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, R * 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = PAL.glimmer2;
    g.beginPath();
    g.moveTo(0, -R);
    g.lineTo(R * 0.35, 0);
    g.lineTo(0, R);
    g.lineTo(-R * 0.35, 0);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.globalAlpha = 0.8;
    g.beginPath();
    g.arc(0, 0, R * 0.28, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawSpark(g, L, view, st) {
    var p = worldScreen(L, view, st, st.x, st.y);
    var face = st.face;
    if (view.burstT > 0.15) face = "burst";
    var sc = p.scale;
    var r = st.playerRadius * sc;
    var speed = hypot(st.vx, st.vy);
    g.save();
    g.translate(p.x, p.y);

    if (st.anchorKind === "wall") {
      var left = st.x < (root.EmberSim.WALL_RIGHT + root.EmberSim.WALL_LEFT) * 0.5;
      g.translate(left ? -2 : 2, 0);
    }

    var sx = 1;
    var sy = 1;
    var rot = 0;
    if (face === "aim") {
      var pull = hypot(st.input.stageDx, st.input.stageDy);
      var pt = clamp(pull / root.EmberSim.FULL_PULL, 0, 1);
      sx = 1 + pt * 0.22;
      sy = 1 - pt * 0.3;
      rot = Math.atan2(st.input.stageDx, -st.input.stageDy) * 0.25;
    } else if (face === "fly" || face === "burst") {
      var stretch = clamp(speed / 520, 0, 0.5);
      sx = 1 - stretch * 0.38;
      sy = 1 + stretch * 0.62;
      rot = Math.atan2(st.vx, st.vy);
    } else if (face === "cling") {
      sx = 0.82;
      sy = 1.12;
      var left = st.x < (root.EmberSim.WALL_RIGHT + root.EmberSim.WALL_LEFT) * 0.5;
      rot = left ? -0.25 : 0.25;
    } else if (face === "fall") {
      sx = 0.9;
      sy = 1.18;
    } else if (face === "out") {
      var k = clamp(view.outT * 1.4, 0, 1);
      sx = mix(1, 0.55, k);
      sy = mix(1, 0.55, k);
    } else if (face === "rest") {
      var bob = Math.sin(view.readyBob * 3.2) * 0.04;
      sy = 1 + bob;
      sx = 1 - bob * 0.5;
      if (Math.sin(view.readyBob * 1.7) > 0.92) sy *= 0.9;
    }
    if (view.landT > 0) {
      sy *= 1 - view.landT * 0.18;
      sx *= 1 + view.landT * 0.16;
    }
    g.rotate(rot);
    g.scale(sx, sy);

    var hot = face === "burst" ? 1 : face === "fly" ? 0.45 : face === "out" ? 0 : 0.2;
    var outer = g.createRadialGradient(0, r * 0.2, r * 0.1, 0, 0, r * 2.4);
    var oa = face === "out" ? 0.05 : 0.55;
    outer.addColorStop(0, "rgba(255,230,160," + oa + ")");
    outer.addColorStop(0.35, "rgba(255,110,40," + oa * 0.45 + ")");
    outer.addColorStop(1, "rgba(255,80,20,0)");
    g.fillStyle = outer;
    g.beginPath();
    g.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    g.fill();

    var flick = 1 + Math.sin(view.flick * 17) * 0.04;
    g.save();
    g.scale(flick, 1 / flick);
    var body = g.createLinearGradient(0, r * 1.1, 0, -r * 1.3);
    if (face === "out") {
      body.addColorStop(0, "#3a2a28");
      body.addColorStop(1, "#1a1210");
    } else if (face === "burst") {
      body.addColorStop(0, "#ff9a3a");
      body.addColorStop(0.5, "#ffe9b0");
      body.addColorStop(1, "#fff");
    } else {
      body.addColorStop(0, "#d63b14");
      body.addColorStop(0.45, "#ff7a32");
      body.addColorStop(1, "#ffe7a8");
    }
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0, r * 1.15);
    g.bezierCurveTo(r * 1.05, r * 0.5, r * 0.95, -r * 0.2, 0, -r * 1.35);
    g.bezierCurveTo(-r * 0.95, -r * 0.2, -r * 1.05, r * 0.5, 0, r * 1.15);
    g.closePath();
    g.fill();
    g.restore();

    if (face !== "out") {
      g.fillStyle = "rgba(255,255,230,0.85)";
      g.beginPath();
      g.ellipse(0, -r * 0.15, r * 0.32, r * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }

    drawFace(g, r, face, view, st);
    g.restore();
  }

  function drawFace(g, r, face, view, st) {
    var blink = 1;
    if (face === "rest" && (view.blink % 3.8 > 3.55)) blink = 0.15;
    if (face === "out") blink = 0.12;
    var eyeY = -r * 0.15;
    var eyeD = r * 0.32;
    var ew = r * 0.16;
    var eh = r * 0.2 * blink;
    var lookX = 0;
    var lookY = 0;
    if (face === "rest") {
      lookX = Math.sin(view.idleLook * 0.7) * r * 0.06;
      lookY = Math.cos(view.idleLook * 0.5) * r * 0.03;
    } else if (face === "aim") {
      lookY = r * 0.08;
      eh *= 0.75;
    } else if (face === "fly") {
      ew *= 1.15;
      eh = r * 0.22;
    } else if (face === "burst") {
      ew *= 1.1;
    } else if (face === "cling") {
      lookY = r * 0.1;
      eh *= 0.65;
    } else if (face === "fall") {
      ew *= 1.35;
      eh = r * 0.28;
    }

    function eye(ox) {
      g.fillStyle = "#fff6d8";
      g.beginPath();
      g.ellipse(ox, eyeY, ew, Math.max(0.4, eh), 0, 0, Math.PI * 2);
      g.fill();
      if (blink > 0.3) {
        g.fillStyle = "#1a0e0a";
        var pr = face === "fall" ? ew * 0.72 : ew * 0.55;
        g.beginPath();
        g.arc(ox + lookX, eyeY + lookY, pr, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.beginPath();
        g.arc(ox + lookX - pr * 0.3, eyeY + lookY - pr * 0.3, pr * 0.28, 0, Math.PI * 2);
        g.fill();
      }
      if (face === "burst") {
        g.strokeStyle = "#1a0e0a";
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(ox - ew, eyeY);
        g.lineTo(ox, eyeY - eh * 1.2);
        g.lineTo(ox + ew, eyeY);
        g.stroke();
      }
    }
    if (face !== "burst") {
      eye(-eyeD);
      eye(eyeD);
    } else {
      g.strokeStyle = "#1a0e0a";
      g.lineWidth = 1.2;
      g.lineCap = "round";
      [-eyeD, eyeD].forEach(function (ox) {
        g.beginPath();
        g.moveTo(ox - ew, eyeY - 1);
        g.lineTo(ox + ew, eyeY + 1);
        g.moveTo(ox - ew, eyeY + 2);
        g.lineTo(ox + ew, eyeY - 2);
        g.stroke();
      });
    }

    g.strokeStyle = "rgba(80,20,10,0.7)";
    g.lineWidth = 1.15;
    g.lineCap = "round";
    g.beginPath();
    if (face === "fall") {
      g.arc(0, r * 0.28, r * 0.12, 0, Math.PI * 2);
      g.stroke();
    } else if (face === "cling") {
      g.moveTo(-r * 0.14, r * 0.32);
      g.lineTo(r * 0.14, r * 0.32);
      g.stroke();
    } else if (face === "aim") {
      g.arc(0, r * 0.3, r * 0.1, 0.15, Math.PI - 0.15);
      g.stroke();
    } else if (face === "out") {
      g.moveTo(-r * 0.1, r * 0.28);
      g.quadraticCurveTo(0, r * 0.22, r * 0.1, r * 0.28);
      g.stroke();
    } else {
      g.arc(0, r * 0.26, r * 0.14, 0.2, Math.PI - 0.2);
      g.stroke();
    }
  }

  function drawDamp(g, L, view, st) {
    var Sim = root.EmberSim;
    var a = worldScreen(L, view, st, Sim.WALL_LEFT, st.dampY);
    var b = worldScreen(L, view, st, Sim.WALL_RIGHT, st.dampY);
    var H = L.stageH;
    var W = L.stageW;
    var t = view.flick;
    g.save();
    g.beginPath();
    g.moveTo(0, H + 20);
    g.lineTo(0, a.y);
    var steps = 28;
    for (var i = 0; i <= steps; i++) {
      var u = i / steps;
      var x = mix(a.x, b.x, u);
      var wave =
        Math.sin(u * 7 + t * 1.6) * 10 +
        Math.sin(u * 13 + t * 2.4) * 5 +
        Math.sin(u * 3.5 + t * 0.7) * 14;
      var reach = Math.sin(u * Math.PI) * (8 + view.threat * 18);
      g.lineTo(x, a.y + wave - reach);
    }
    g.lineTo(W, b.y);
    g.lineTo(W, H + 20);
    g.closePath();
    var grd = g.createLinearGradient(0, a.y - 40, 0, H);
    grd.addColorStop(0, "rgba(62,199,164,0.0)");
    grd.addColorStop(0.08, "rgba(40,120,100,0.45)");
    grd.addColorStop(0.22, "rgba(12,40,38,0.82)");
    grd.addColorStop(1, "#030806");
    g.fillStyle = grd;
    g.fill();

    g.strokeStyle = "rgba(110,230,190,0.35)";
    g.lineWidth = 2;
    g.beginPath();
    for (var j = 0; j <= steps; j++) {
      var u2 = j / steps;
      var x2 = mix(a.x, b.x, u2);
      var wave2 =
        Math.sin(u2 * 7 + t * 1.6) * 10 +
        Math.sin(u2 * 13 + t * 2.4) * 5 +
        Math.sin(u2 * 3.5 + t * 0.7) * 14;
      var reach2 = Math.sin(u2 * Math.PI) * (8 + view.threat * 18);
      var yy = a.y + wave2 - reach2;
      if (j === 0) g.moveTo(x2, yy);
      else g.lineTo(x2, yy);
    }
    g.stroke();

    var tendrils = 5;
    g.strokeStyle = "rgba(80,200,160,0.22)";
    g.lineWidth = 2;
    for (var k = 0; k < tendrils; k++) {
      var tx = mix(a.x, b.x, (k + 0.5) / tendrils);
      var up = 18 + Math.sin(t * 1.3 + k) * 10 + view.threat * 26;
      g.beginPath();
      g.moveTo(tx, a.y);
      g.quadraticCurveTo(
        tx + Math.sin(t * 2 + k * 2) * 16,
        a.y - up * 0.55,
        tx + Math.sin(t + k) * 8,
        a.y - up
      );
      g.stroke();
    }
    g.restore();
  }

  function drawAim(g, L, view, st) {
    if (!st.input.dragging) return;
    if (st.jumpsLeft <= 0 && st.phase !== "ready") return;
    var pull = hypot(st.input.stageDx, st.input.stageDy);
    if (pull < 2) return;
    var origin = worldScreen(L, view, st, st.x, st.y);
    var ang = Math.atan2(st.input.stageDx, -st.input.stageDy);
    var t = clamp((pull - 8) / (root.EmberSim.FULL_PULL - 8), 0, 1);
    var power = t * root.EmberSim.MAX_SPEED;
    var vx = - (st.input.stageDx / Math.max(pull, 1)) * power;
    var vy = (st.input.stageDy / Math.max(pull, 1)) * power;

    g.save();
    g.strokeStyle = "rgba(244,230,200," + (0.25 + t * 0.45) + ")";
    g.lineWidth = 2;
    g.setLineDash([5, 6]);
    g.beginPath();
    var px = origin.x;
    var py = origin.y;
    g.moveTo(px, py);
    var gx = 0;
    var gy = root.EmberSim.GRAVITY;
    var sc = origin.scale;
    var dt = 1 / 50;
    for (var i = 0; i < 18; i++) {
      vy -= gy * dt;
      px += vx * dt * sc;
      py -= vy * dt * sc;
      g.lineTo(px, py);
    }
    g.stroke();
    g.setLineDash([]);

    var ox = L.stageW * 0.5 + (st.input.originX ? 0 : 0);
    var canvas = g.canvas;
    var rectW = canvas.clientWidth || L.cssW;
    var sx = (st.input.originX / (rectW || 1)) * L.stageW;
    var sy = (st.input.originY / ((canvas.clientHeight || L.cssH) || 1)) * L.stageH;

    sx = L.stageW / 2;
    sy = L.stageH * 0.72;
    var p1x = origin.x;
    var p1y = origin.y;
    var backX = p1x + (st.input.stageDx / root.EmberSim.FULL_PULL) * 70;
    var backY = p1y + (st.input.stageDy / root.EmberSim.FULL_PULL) * 70;

    g.strokeStyle = "rgba(255,170,90," + (0.4 + t * 0.5) + ")";
    g.lineWidth = 3.2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(p1x, p1y);
    g.lineTo(backX, backY);
    g.stroke();
    g.fillStyle = "rgba(255,230,180,0.9)";
    g.beginPath();
    g.arc(backX, backY, 5 + t * 3, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "rgba(244,230,200,0.35)";
    g.beginPath();
    g.arc(p1x, p1y, 16 + t * 10, 0, Math.PI * 2);
    g.fill();
    g.restore();
    void ang;
    void ox;
    void sx;
    void sy;
  }

  function drawAimFromPointer(g, L, st, canvas) {
    if (!st.input.dragging) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1) return;
    var ox = ((st.input.originX - rect.left) / rect.width) * L.stageW;
    var oy = ((st.input.originY - rect.top) / rect.height) * L.stageH;
    var cx = ox + st.input.stageDx;
    var cy = oy + st.input.stageDy;
    var pull = hypot(st.input.stageDx, st.input.stageDy);
    var t = clamp(pull / root.EmberSim.FULL_PULL, 0, 1);
    g.save();
    g.strokeStyle = "rgba(255,186,110,0.55)";
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(ox, oy, 11, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "rgba(244,230,200," + (0.35 + t * 0.45) + ")";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(ox, oy);
    g.lineTo(cx, cy);
    g.stroke();
    g.fillStyle = PAL.emberHot;
    g.beginPath();
    g.arc(cx, cy, 4.5 + t * 2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawHud(g, L, view, st) {
    var W = L.stageW;
    g.save();
    g.fillStyle = "rgba(16,14,20,0.35)";
    roundRect(g, 12, 10, 118, 36, 10);
    g.fill();
    var cap = st.jumpCapacity;
    for (var i = 0; i < cap; i++) {
      var x = 28 + i * 28;
      var y = 28;
      var on = i < st.jumpsLeft;
      g.beginPath();
      var grd = g.createRadialGradient(x, y, 1, x, y, 10);
      if (on) {
        grd.addColorStop(0, "#fff6d2");
        grd.addColorStop(0.45, "#ff8a3a");
        grd.addColorStop(1, "rgba(255,80,20,0)");
      } else {
        grd.addColorStop(0, "rgba(80,60,50,0.5)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
      }
      g.fillStyle = grd;
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = on ? "#ffe7a3" : "rgba(80,70,65,0.7)";
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fill();
    }

    g.textAlign = "right";
    g.font = "600 15px Georgia, serif";
    g.fillStyle = "rgba(244,230,200,0.85)";
    g.fillText(String(Math.floor(st.score)), W - 18, 28);
    g.font = "11px Georgia, serif";
    g.fillStyle = "rgba(244,230,200,0.4)";
    g.fillText("height " + String(Math.max(0, Math.floor(st.height - st.startY))), W - 18, 44);

    if (st.chainCount > 0 && st.phase === "playing") {
      var pop = 1 + view.chainPop * (0.12 + Math.min(st.chainCount, 8) * 0.04);
      g.save();
      g.translate(W * 0.5, 70);
      g.scale(pop, pop);
      g.textAlign = "center";
      var glowA = 0.35 + Math.min(st.chainCount, 10) * 0.05;
      g.fillStyle = "rgba(255,200,110," + glowA + ")";
      g.font = "700 " + (18 + Math.min(st.chainCount, 8) * 2) + "px Georgia, serif";
      g.fillText("chain " + st.chainCount, 0, 0);
      g.restore();
    }

    if (view.titleA > 0.02 && st.phase === "ready") {
      g.globalAlpha = view.titleA;
      g.textAlign = "center";
      g.fillStyle = PAL.cream;
      g.font = "700 44px Georgia, serif";
      g.fillText("EMBER", W * 0.5, 120);
      g.font = "13px Georgia, serif";
      g.fillStyle = "rgba(244,230,200,0.55)";
      g.fillText("a living spark", W * 0.5, 142);
    }

    if (view.hintA > 0.02 && st.phase === "ready" && !st.input.dragging) {
      g.globalAlpha = view.hintA * (0.45 + Math.sin(view.pullHint * 2.4) * 0.25);
      var sp = worldScreen(L, view, st, st.x, st.y);
      g.strokeStyle = "rgba(244,230,200,0.7)";
      g.lineWidth = 2;
      g.lineCap = "round";
      var hy = sp.y + 36 + Math.sin(view.pullHint * 2.4) * 8;
      g.beginPath();
      g.moveTo(sp.x, sp.y + 22);
      g.lineTo(sp.x, hy);
      g.moveTo(sp.x - 6, hy - 8);
      g.lineTo(sp.x, hy);
      g.lineTo(sp.x + 6, hy - 8);
      g.stroke();
    }
    g.restore();
  }

  function drawCeremony(g, L, view, st) {
    if (st.phase !== "gameover") return;
    var W = L.stageW;
    var H = L.stageH;
    var a = view.ceremony;
    g.save();
    g.fillStyle = "rgba(6,5,10," + 0.55 * a + ")";
    g.fillRect(0, 0, W, H);
    var cardW = 270;
    var cardH = 292;
    var x = (W - cardW) / 2;
    var y = (H - cardH) / 2 + 10;
    g.globalAlpha = a;
    g.fillStyle = "rgba(18,14,20,0.92)";
    roundRect(g, x, y, cardW, cardH, 18);
    g.fill();
    g.strokeStyle = "rgba(255,140,70,0.35)";
    g.stroke();

    g.textAlign = "center";
    g.fillStyle = "rgba(244,230,200,0.5)";
    g.font = "13px Georgia, serif";
    g.fillText("the damp takes the spark", W * 0.5, y + 36);

    g.fillStyle = PAL.cream;
    g.font = "700 42px Georgia, serif";
    g.fillText(String(Math.floor(st.score)), W * 0.5, y + 88);

    g.font = "12px Georgia, serif";
    g.fillStyle = "rgba(244,230,200,0.45)";
    g.fillText("best  " + String(Math.floor(st.sessionBest)), W * 0.5, y + 110);

    var rank = st.rank || "CINDER";
    g.fillStyle = PAL.ember;
    g.font = "700 22px Georgia, serif";
    g.fillText(rank, W * 0.5, y + 148);
    g.font = "12px Georgia, serif";
    g.fillStyle = "rgba(244,230,200,0.5)";
    g.fillText("grade", W * 0.5, y + 128);

    g.fillStyle = PAL.glimmer2;
    g.font = "16px Georgia, serif";
    var ch = st.chainBest;
    g.fillText(ch > 0 ? "best chain  ×" + ch : "no chain banked", W * 0.5, y + 186);

    g.fillStyle = "rgba(244,230,200," + (0.4 + Math.sin(view.flick * 3) * 0.2) + ")";
    g.font = "13px Georgia, serif";
    g.fillText("tap to kindle again", W * 0.5, y + 248);
    g.restore();
  }

  function drawParticles(g, L, view, st) {
    for (var i = 0; i < view.particles.length; i++) {
      var p = view.particles[i];
      var s = worldScreen(L, view, st, p.x, p.y);
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(s.x, s.y, p.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    for (var ri = 0; ri < view.rings.length; ri++) {
      var rg = view.rings[ri];
      var rs = worldScreen(L, view, st, rg.x, rg.y);
      g.strokeStyle = "rgba(255,210,140," + Math.max(0, rg.a) + ")";
      g.lineWidth = rg.w;
      g.beginPath();
      g.arc(rs.x, rs.y, rg.r * rs.scale, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (var j = 0; j < view.trail.length; j++) {
      var tr = view.trail[j];
      var ts = worldScreen(L, view, st, tr.x, tr.y);
      g.fillStyle = "rgba(255,160,70," + tr.a * 0.35 + ")";
      g.beginPath();
      g.arc(ts.x, ts.y, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  function draw(ctx, canvas, layout, view, st) {
    Sim = root.EmberSim;
    var sx = canvas.width / layout.stageW;
    var sy = canvas.height / layout.stageH;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.imageSmoothingEnabled = true;

    var shake = view.shake;
    ctx.save();
    if (shake > 0.05) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawBackground(ctx, layout, view, st);
    drawWalls(ctx, layout, view, st);

    var reach = Sim.LAUNCH_REACH;
    for (var i = 0; i < st.ledges.length; i++) {
      var lg = st.ledges[i];
      if (lg.y > view.camY + reach * 3 || lg.y < view.camY - reach * 2) continue;
      drawLedge(ctx, layout, view, st, lg);
    }
    for (var j = 0; j < st.items.length; j++) {
      var it = st.items[j];
      if (!it.active) continue;
      if (it.y > view.camY + reach * 3 || it.y < view.camY - reach * 2) continue;
      if (it.type === "moth") drawMoth(ctx, layout, view, st, it);
      else drawGlimmer(ctx, layout, view, st, it);
    }

    drawParticles(ctx, layout, view, st);
    drawSpark(ctx, layout, view, st);
    drawAim(ctx, layout, view, st);
    drawDamp(ctx, layout, view, st);
    drawAimFromPointer(ctx, layout, st, canvas);
    drawHud(ctx, layout, view, st);
    drawCeremony(ctx, layout, view, st);

    ctx.restore();
  }

  root.EmberView = {
    create: createView,
    init: initView,
    layout: layout,
    step: stepView,
    react: react,
    draw: draw,
    worldScreen: worldScreen
  };
})(typeof window !== "undefined" ? window : globalThis);
