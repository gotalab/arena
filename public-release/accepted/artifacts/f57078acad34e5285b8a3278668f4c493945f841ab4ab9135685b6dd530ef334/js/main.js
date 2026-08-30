(function () {
  var Sim = window.EmberSim;
  var View = window.EmberView;
  var canvas = document.getElementById("stage");
  var wrap = document.getElementById("wrap");
  var ctx = canvas.getContext("2d", { alpha: false });
  var audio = new window.EmberAudio();
  var view = View.create();
  View.init(view);

  var st = null;
  var layout = View.layout(canvas, wrap);
  var acc = 0;
  var lastT = 0;
  var running = false;
  var pointerId = null;
  var goDownX = 0;
  var goDownY = 0;
  var prevSnap = null;

  function defaultSeed() {
    return 0xE3BE0001;
  }

  function reset(seed) {
    var s = seed == null ? defaultSeed() : seed >>> 0;
    var best = st ? st.sessionBest : 0;
    st = Sim.create(s, best);
    view.particles.length = 0;
    view.trail.length = 0;
    view.rings.length = 0;
    view.lastEventKey = "";
    view.burstT = 0;
    view.camY = st.y;
    view.titleA = 1;
    view.hintA = 1;
    view.ceremony = 0;
    view.outT = 0;
    view.shake = 0;
    prevSnap = {
      launches: 0,
      landings: 0,
      refunds: 0,
      glimmersCollected: 0,
      chainCount: 0,
      phase: "ready"
    };
    return st;
  }

  function toStageDelta(pageDx, pageDy) {
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return { dx: 0, dy: 0 };
    return {
      dx: (pageDx / rect.width) * layout.stageW,
      dy: (pageDy / rect.height) * layout.stageH
    };
  }

  function onPointerDown(ev) {
    ev.preventDefault();
    if (pointerId !== null && pointerId !== ev.pointerId) return;
    pointerId = ev.pointerId;
    try {
      wrap.setPointerCapture(ev.pointerId);
    } catch (e) {}
    audio.ensure();
    if (st.phase === "gameover") {
      goDownX = ev.pageX;
      goDownY = ev.pageY;
      return;
    }
    Sim.pointerDown(st, ev.pageX, ev.pageY, 0, 0);
  }

  function onPointerMove(ev) {
    if (pointerId !== ev.pointerId) return;
    ev.preventDefault();
    if (st.phase === "gameover") return;
    if (!st.input.dragging) return;
    var d = toStageDelta(ev.pageX - st.input.originX, ev.pageY - st.input.originY);
    Sim.pointerMove(st, ev.pageX, ev.pageY, d.dx, d.dy);
  }

  function onPointerUp(ev) {
    if (pointerId !== ev.pointerId) return;
    ev.preventDefault();
    pointerId = null;
    try {
      wrap.releasePointerCapture(ev.pointerId);
    } catch (e) {}
    if (st.phase === "gameover") {
      var dist = Math.hypot(ev.pageX - goDownX, ev.pageY - goDownY);
      if (dist < 28) reset(st.seed);
      return;
    }
    if (st.input.dragging || st.releaseQueued) {
      var d = toStageDelta(ev.pageX - st.input.originX, ev.pageY - st.input.originY);
      st.input.stageDx = d.dx;
      st.input.stageDy = d.dy;
      st.input.dx = ev.pageX - st.input.originX;
      st.input.dy = ev.pageY - st.input.originY;
    }
    Sim.pointerUp(st);
  }

  function onPointerCancel(ev) {
    if (pointerId !== ev.pointerId) return;
    pointerId = null;
    if (st.phase === "gameover") return;
    st.input.dragging = false;
    st.releaseQueued = false;
    st.input.originX = 0;
    st.input.originY = 0;
    st.input.dx = 0;
    st.input.dy = 0;
    st.input.stageDx = 0;
    st.input.stageDy = 0;
  }

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointermove", onPointerMove);
  wrap.addEventListener("pointerup", onPointerUp);
  wrap.addEventListener("pointercancel", onPointerCancel);
  wrap.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });
  document.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("resize", function () {
    layout = View.layout(canvas, wrap);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      layout = View.layout(canvas, wrap);
    });
  }

  function feedAudio() {
    if (st.launches > prevSnap.launches) {
      var pull = Math.hypot(st.vx, st.vy) / Sim.MAX_SPEED;
      audio.launch(Math.max(0.25, Math.min(1, pull)));
    }
    if (st.refunds > prevSnap.refunds) audio.bounce();
    if (st.glimmersCollected > prevSnap.glimmersCollected) audio.glimmer(st.chainCount);
    if (st.landings > prevSnap.landings) audio.land(st.anchorKind === "wall");
    if (st.chainCount > prevSnap.chainCount) audio.chain(st.chainCount);
    if (st.landings > prevSnap.landings && prevSnap.chainCount > 0) {
      audio.chainBank(st.chainBest);
    }
    if (st.phase === "gameover" && prevSnap.phase !== "gameover") audio.extinguish();
    var gap = st.y - st.dampY;
    audio.setDampProximity(st.phase === "playing" ? Math.max(0, 1 - gap / 160) : 0);
    prevSnap = {
      launches: st.launches,
      landings: st.landings,
      refunds: st.refunds,
      glimmersCollected: st.glimmersCollected,
      chainCount: st.chainCount,
      phase: st.phase
    };
  }

  function frame(now) {
    if (!lastT) lastT = now;
    var dt = Math.min(100, now - lastT);
    lastT = now;
    acc += dt;
    var stepMs = 1000 / 60;
    var guard = 0;
    while (acc >= stepMs && guard < 5) {
      var before = st.lastEvent;
      Sim.step(st);
      View.react(view, st, before);
      feedAudio();
      acc -= stepMs;
      guard += 1;
    }
    if (guard === 5) acc = 0;
    layout = View.layout(canvas, wrap);
    View.step(view, st, dt / 1000);
    View.draw(ctx, canvas, layout, view, st);
    requestAnimationFrame(frame);
  }

  reset(defaultSeed());
  running = true;
  requestAnimationFrame(frame);

  window.__ARENA_GAME__ = {
    reset: function (seed) {
      reset(seed);
      return true;
    },
    snapshot: function () {
      return Sim.snapshot(st);
    }
  };
})();
