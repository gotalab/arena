import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../js/engine.js";
import { installArena } from "../js/arena.js";

function installWindow() {
  const parent = { id: "parent" };
  const listeners = [];
  const window = {
    parent,
    addEventListener(type, fn) {
      if (type === "message") listeners.push(fn);
    },
  };
  globalThis.window = window;
  return {
    parent,
    emit(event) {
      for (const fn of listeners) fn(event);
    },
  };
}

function waitMessage(port, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), timeout);
    port.onmessage = (ev) => {
      clearTimeout(t);
      resolve(ev.data);
    };
    if (typeof port.start === "function") port.start();
  });
}

test("arena.game.v1 connect, observe, act, stale, illegal, restart", async () => {
  const { parent, emit } = installWindow();
  const game = new Game();
  installArena({
    snapshot: () => game.snapshot(),
    getRevision: () => game.revision,
    act: (action) => game.act(action),
    restart: () => game.restart(),
    reset: (seed) => game.reset(seed),
  });

  const channel = new MessageChannel();
  try {
  const readyP = waitMessage(channel.port1);
  emit({
    source: parent,
    data: {
      protocol: "arena.game.v1",
      type: "connect",
      sessionId: "sess-1",
      generation: 3,
    },
    ports: [channel.port2],
  });
  const ready = await readyP;
  assert.equal(ready.type, "ready");
  assert.equal(ready.accepted, true);
  assert.equal(ready.sessionId, "sess-1");
  assert.equal(ready.generation, 3);
  assert.equal(ready.protocol, "arena.game.v1");
  assert.equal(ready.state.levelId, "first-light");
  assert.equal(ready.revision, 0);

  const obsP = waitMessage(channel.port1);
  channel.port1.postMessage({
    protocol: "arena.game.v1",
    sessionId: "sess-1",
    generation: 3,
    requestId: "r1",
    command: "observe",
  });
  const obs = await obsP;
  assert.equal(obs.type, "response");
  assert.equal(obs.accepted, true);
  assert.equal(obs.requestId, "r1");
  assert.equal(obs.state.moveCount, 0);

  const actP = waitMessage(channel.port1);
  channel.port1.postMessage({
    protocol: "arena.game.v1",
    sessionId: "sess-1",
    generation: 3,
    requestId: "r2",
    command: "act",
    expectedRevision: 0,
    action: { type: "move", direction: "up" },
  });
  const acted = await actP;
  assert.equal(acted.accepted, true);
  assert.equal(acted.state.moveCount, 1);
  assert.equal(acted.revision, 1);
  assert.equal(acted.state.player.row, 3);

  const staleP = waitMessage(channel.port1);
  channel.port1.postMessage({
    protocol: "arena.game.v1",
    sessionId: "sess-1",
    generation: 3,
    requestId: "r3",
    command: "act",
    expectedRevision: 0,
    action: { type: "move", direction: "up" },
  });
  const stale = await staleP;
  assert.equal(stale.accepted, false);
  assert.equal(stale.error.code, "stale_revision");
  assert.equal(stale.revision, 1);

  const badP = waitMessage(channel.port1);
  channel.port1.postMessage({
    protocol: "arena.game.v1",
    sessionId: "sess-1",
    generation: 3,
    requestId: "r4",
    command: "act",
    expectedRevision: 1,
    action: { type: "move", direction: "forward" },
  });
  const bad = await badP;
  assert.equal(bad.accepted, false);
  assert.equal(bad.error.code, "illegal_action");
  assert.equal(bad.state.moveCount, 1);

  const rstP = waitMessage(channel.port1);
  channel.port1.postMessage({
    protocol: "arena.game.v1",
    sessionId: "sess-1",
    generation: 3,
    requestId: "r5",
    command: "restart",
    expectedRevision: 1,
  });
  const rst = await rstP;
  assert.equal(rst.accepted, true);
  assert.equal(rst.state.moveCount, 0);
  assert.equal(rst.state.attempt, 2);

  assert.equal(typeof globalThis.window.__ARENA_GAME__.snapshot, "function");
  globalThis.window.__ARENA_GAME__.act({ type: "move", direction: "left" });
  let thrown = null;
  try {
    globalThis.window.__ARENA_GAME__.act({ type: "move", direction: "left" });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown && thrown.code === "illegal_action");
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});

test("connect from non-parent is ignored", async () => {
  const { emit } = installWindow();
  const game = new Game();
  installArena({
    snapshot: () => game.snapshot(),
    getRevision: () => game.revision,
    act: (a) => game.act(a),
    restart: () => game.restart(),
    reset: (s) => game.reset(s),
  });
  const channel = new MessageChannel();
  try {
    let got = false;
    channel.port1.onmessage = () => {
      got = true;
    };
    channel.port1.start();
    emit({
      source: { id: "stranger" },
      data: {
        protocol: "arena.game.v1",
        type: "connect",
        sessionId: "x",
        generation: 1,
      },
      ports: [channel.port2],
    });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(got, false);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
});
