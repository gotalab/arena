"use strict";

const Sim = require("../js/sim.js");
const assert = require("assert");

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
  passed += 1;
}

function deep(a) {
  return JSON.parse(JSON.stringify(a));
}

function startLeft(state) {
  state.input.left = true;
}

function chase(state) {
  const m = state.machine;
  const b = state.ball;
  if (state.phase === "ready") {
    state.input.left = true;
    return;
  }
  state.input.left = b.x < m.x - 6;
  state.input.right = b.x > m.x + 6;
  state.input.axis = 0;
}

function run(seed, ms, drive) {
  const state = Sim.create(seed);
  const step = 1000 / 60;
  let t = 0;
  while (t < ms) {
    if (drive) drive(state, t);
    Sim.advance(state, step);
    t += step;
  }
  return state;
}

function eventsOf(state, kind) {
  return state.recentEvents.filter(function (e) {
    return e.kind === kind;
  });
}

{
  const a = Sim.create(7);
  const s0 = Sim.snapshot(a);
  ok(s0.phase === "ready", "starts ready");
  ok(s0.tick === 0, "tick frozen");
  ok(s0.elapsedMs === 0, "elapsed frozen");
  ok(s0.remainingMs === 90000, "clock full");
  ok(s0.lastEvent === null, "no events yet");
  ok(s0.ball.lastBounceKind === null, "no bounce yet");
  ok(s0.groundY < s0.lowLaneY && s0.lowLaneY < s0.highLaneY, "Y-up lanes");
  ok(s0.machine.y > s0.groundY, "machine above ground");
  ok(s0.ball.y > s0.machine.y, "ball on top");
  ok(s0.machineNormalApexY < s0.lowLaneY, "jump below low lane");
  Sim.advance(a, 5000);
  const s1 = Sim.snapshot(a);
  ok(s1.tick === 0 && s1.phase === "ready", "advance does nothing while ready");
  ok(s1.remainingMs === s0.remainingMs, "clock frozen in ready");
  ok(s1.enemies.length === 0, "no spawns before start");
}

{
  const a = Sim.create(3);
  const b = Sim.create(3);
  startLeft(a);
  startLeft(b);
  Sim.advance(a, 2400);
  Sim.advance(b, 800);
  Sim.advance(b, 1600);
  const sa = Sim.snapshot(a);
  const sb = Sim.snapshot(b);
  ok(JSON.stringify(sa) === JSON.stringify(sb), "advance splits are deterministic");
}

{
  const a = Sim.create(11);
  const b = Sim.create(11);
  function script(st, t) {
    st.input.left = Math.floor(t / 180) % 2 === 0;
    st.input.right = !st.input.left;
    if (Math.floor(t / 400) % 5 === 0) Sim.queueJump(st);
    else st.input.jump = false;
  }
  const step = 1000 / 60;
  for (let t = 0; t < 8000; t += step) {
    script(a, t);
    script(b, t);
    Sim.advance(a, step);
    Sim.advance(b, step);
  }
  ok(JSON.stringify(Sim.snapshot(a)) === JSON.stringify(Sim.snapshot(b)), "same seed+input same snapshot");
}

{
  const state = Sim.create(1);
  Sim.queueJump(state);
  Sim.advance(state, Sim.STEP_MS);
  const s = Sim.snapshot(state);
  ok(s.phase === "playing", "jump starts run");
  ok(s.tick === 1, "first tick");
  ok(s.ball.lastBounceKind === "power", "rising contact is power");
  ok(eventsOf(state, "ball_bounce_power").length >= 1, "power event");
  ok(eventsOf(state, "machine_jump").length >= 1, "jump event");
}

{
  const state = Sim.create(1);
  startLeft(state);
  Sim.advance(state, Sim.STEP_MS);
  const s = Sim.snapshot(state);
  ok(s.ball.lastBounceKind === "normal", "grounded contact is normal");
  ok(eventsOf(state, "ball_bounce_normal").length >= 1, "normal event");
}

{
  const state = run(5, 2000, function (st) {
    st.input.left = true;
  });
  const s = Sim.snapshot(state);
  let maxY = s.ball.y;
  const probe = Sim.create(5);
  startLeft(probe);
  let apex = 0;
  for (let i = 0; i < 120; i++) {
    Sim.advance(probe, Sim.STEP_MS);
    if (probe.ball.y > apex) apex = probe.ball.y;
    if (probe.ball.vy < 0 && i > 10) break;
  }
  ok(apex > s.lowLaneY, "normal return through low lane");
  ok(apex < s.highLaneY, "normal return below high lane");
}

{
  const state = Sim.create(2);
  Sim.queueJump(state);
  let apex = 0;
  for (let i = 0; i < 180; i++) {
    Sim.advance(state, Sim.STEP_MS);
    if (state.ball.y > apex) apex = state.ball.y;
  }
  const s = Sim.snapshot(state);
  ok(apex > s.highLaneY, "power return through high lane");
}

{
  const state = Sim.create(4);
  startLeft(state);
  Sim.advance(state, 200);
  Sim.queueJump(state);
  let jumped = false;
  let apexM = 0;
  for (let i = 0; i < 90; i++) {
    Sim.advance(state, Sim.STEP_MS);
    if (!state.machine.grounded) jumped = true;
    if (state.machine.y > apexM) apexM = state.machine.y;
  }
  ok(jumped, "jump leaves ground");
  ok(apexM < Sim.snapshot(state).lowLaneY - state.machine.radius, "machine jump stays below low lane");
}

{
  const state = Sim.create(9);
  startLeft(state);
  let sawLow = false;
  let sawHigh = false;
  const half = 45000;
  let t = 0;
  while (t < 8000) {
    chase(state);
    Sim.advance(state, Sim.STEP_MS);
    t += Sim.STEP_MS;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active) continue;
      if (e.type === "slowFlyer" && e.lane === "low") sawLow = true;
      if (e.type === "slowFlyer" && e.lane === "high") sawHigh = true;
      ok(e.type !== "fastFlyer", "no fast flyers before first kill");
      ok(e.collisionRadius <= e.visualRadius * 1.1, "hitbox not oversized");
    }
  }
  ok(sawLow, "slow low in opening");
  ok(sawHigh, "slow high in opening");
  ok(t < half, "both lanes before half clock");
}

{
  const state = Sim.create(13);
  startLeft(state);
  Sim.advance(state, 2000);
  ok(state.enemies.some(function (e) {
    return e.active && e.type === "slowFlyer" && e.lane === "low";
  }), "low slow within first few seconds");
}

{
  const state = Sim.create(8);
  let t = 0;
  while (t < 60000) {
    chase(state);
    Sim.advance(state, Sim.STEP_MS);
    t += Sim.STEP_MS;
  }
  const s = Sim.snapshot(state);
  ok(s.phase === "playing" || s.remainingMs > 0, "still alive after a minute of chasing");
  ok(s.remainingMs > 0, "clock remains after 60s of play");
}

{
  const state = Sim.create(21);
  startLeft(state);
  Sim.advance(state, Sim.STEP_MS);
  const before = deep(Sim.snapshot(state));
  const snap = Sim.snapshot(state);
  snap.score = 9999;
  snap.machine.x = 0;
  snap.ball.y = 0;
  snap.remainingMs = 1;
  snap.enemies.push({ id: 99 });
  const after = Sim.snapshot(state);
  ok(after.score === before.score, "snapshot is inert");
  ok(after.machine.x === before.machine.x, "snapshot does not move machine");
  ok(after.remainingMs === before.remainingMs, "snapshot does not drain clock");
}

{
  const a = Sim.create(42);
  startLeft(a);
  Sim.advance(a, 4000);
  const mid = deep(Sim.snapshot(a));
  Sim.advance(a, 4000);
  const a2 = Sim.create(42);
  startLeft(a2);
  Sim.advance(a2, 4000);
  ok(Math.abs(Sim.snapshot(a2).ball.x - mid.ball.x) < 1e-6, "reset replays seed");
  ok(Sim.snapshot(a2).tick === mid.tick, "same tick after same advance");
}

{
  const state = Sim.create(1);
  Sim.queueJump(state);
  Sim.advance(state, 30000);
  state.remainingMs = 0;
  state.phase = "ended";
  const tick = state.tick;
  Sim.advance(state, 5000);
  ok(state.tick === tick, "ended run does not advance");
}

{
  const state = Sim.create(6);
  startLeft(state);
  Sim.advance(state, 5000);
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    ok(e.collisionRadius <= e.visualRadius * 1.1 + 1e-9, "enemy hitbox");
    if (e.lane !== "ground") ok(e.hitsRequired === 3, "flyers take 3");
  }
  const s = Sim.snapshot(state);
  ok(s.machine.radius <= 16 * 1.1, "machine radius");
  ok(s.ball.radius <= 11 * 1.1, "ball radius");
}

{
  const state = Sim.create(1);
  startLeft(state);
  Sim.advance(state, Sim.STEP_MS);
  state.input.left = false;
  let weak = false;
  for (let i = 0; i < 200; i++) {
    chase(state);
    if (state.machine.grounded && state.ball.vy < 0 && state.ball.y > 330) {
      Sim.queueJump(state);
    }
    Sim.advance(state, Sim.STEP_MS);
    if (state.ball.lastBounceKind === "weak") weak = true;
  }
  ok(weak, "descending-machine contact is weak");
}

{
  const state = Sim.create(17);
  startLeft(state);
  Sim.advance(state, 3000);
  const flyer = state.enemies.find(function (e) {
    return e.active && e.type === "slowFlyer";
  });
  ok(flyer, "opening flyer exists");
  ok(Math.abs(flyer.y - Sim.BOUNDS.LOW_LANE_Y) < 1 || Math.abs(flyer.y - Sim.BOUNDS.HIGH_LANE_Y) < 1, "locked to a lane");
}

{
  const state = Sim.create(1);
  const s = Sim.snapshot(state);
  ok(s.input.left === false && s.input.jump === false, "input reported");
  ok(typeof s.rngState === "number", "rngState is a number");
  ok(s.difficulty === 0, "difficulty starts at 0");
  ok(s.rank === "D", "rank starts at D");
}

{
  const state = Sim.create(9);
  function hunt() {
    if (state.phase === "ready") {
      state.input.left = true;
      return;
    }
    state.input.left = state.ball.x < state.machine.x - 5;
    state.input.right = state.ball.x > state.machine.x + 5;
  }
  for (let i = 0; i < 60 * 25; i++) {
    hunt();
    Sim.advance(state, Sim.STEP_MS);
    if (state.airEnemiesDefeated > 0) break;
  }
  const tops = state.recentEvents.filter(function (e) {
    return e.kind === "top_hit";
  });
  const kill = state.recentEvents.filter(function (e) {
    return e.kind === "enemy_defeated";
  });
  ok(state.airEnemiesDefeated >= 1, "three-hit pursuit can finish a target");
  ok(tops.length >= 3, "at least three top hits");
  ok(tops[0].amountMs < tops[1].amountMs && tops[1].amountMs < tops[2].amountMs, "hit time strictly increases");
  ok(kill.length >= 1, "defeat event");
  ok(state.difficulty >= 1, "attack score raises difficulty");
  let seq = 0;
  for (let i = 0; i < state.recentEvents.length; i++) {
    ok(state.recentEvents[i].sequence === seq + 1, "event sequence is dense");
    seq = state.recentEvents[i].sequence;
  }
}

{
  const state = Sim.create(12);
  for (let i = 0; i < 60 * 16; i++) {
    chase(state);
    Sim.advance(state, Sim.STEP_MS);
    if (state.airEnemiesDefeated > 0) break;
    for (let j = 0; j < state.enemies.length; j++) {
      ok(state.enemies[j].type !== "fastFlyer", "fast flyers gated on first kill");
    }
  }
}

console.log("ok", passed, "assertions");
