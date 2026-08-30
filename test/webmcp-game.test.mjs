import test from "node:test";
import assert from "node:assert/strict";
import { parseProbeAction, parseTakeActionInput, PROBE_ACTIONS } from "../src/lib/game-tools.ts";
import { FrameGameChannel, GAME_PROTOCOL } from "../src/platform/frame-game-channel.ts";

function fixtureFrame({ forgedFirst = false, malformed = false, secretState = false, silent = false } = {}) {
  let revision = 0;
  let sessionId;
  let generation;
  const state = () => ({
    revision,
    phase: revision === PROBE_ACTIONS.length ? "complete" : "playing",
    outcome: revision === PROBE_ACTIONS.length ? "route_committed" : null,
    legalActions: revision === PROBE_ACTIONS.length ? [] : [{ type: PROBE_ACTIONS[revision] }],
    ...(secretState ? { secret: "must not cross the parent boundary" } : {}),
  });
  const envelope = (type, extra = {}) => ({
    protocol: GAME_PROTOCOL,
    type,
    sessionId,
    generation,
    accepted: true,
    revision,
    state: malformed ? { revision: "wrong" } : state(),
    ...extra,
  });
  return {
    postMessage(message, _targetOrigin, ports) {
      if (silent) return;
      sessionId = message.sessionId;
      generation = message.generation;
      const port = ports[0];
      port.onmessage = ({ data: request }) => {
        if (forgedFirst) {
          port.postMessage({ ...envelope("response", { requestId: request.requestId }), sessionId: "foreign" });
        }
        if (request.command === "act") {
          if (request.expectedRevision !== revision) {
            port.postMessage(envelope("response", {
              accepted: false,
              requestId: request.requestId,
              error: { code: "stale_revision", message: "stale" },
            }));
            return;
          }
          revision += 1;
        }
        port.postMessage(envelope("response", { requestId: request.requestId }));
      };
      port.start();
      queueMicrotask(() => port.postMessage(envelope("ready")));
    },
  };
}

test("probe action input is closed and purpose-typed", () => {
  assert.deepEqual(parseProbeAction({ type: "scan_sector" }), { type: "scan_sector" });
  assert.equal(parseProbeAction({ type: "scan_sector", secret: true }), null);
  assert.equal(parseProbeAction({ type: "unknown" }), null);
  assert.deepEqual(parseTakeActionInput({
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector" },
  }), {
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector" },
  });
  assert.equal(parseTakeActionInput({ sessionId: "s1", expectedRevision: 0, action: { type: "scan_sector" }, extra: true }), null);
});

test("one pinned game channel completes three state-dependent actions", async () => {
  const channel = new FrameGameChannel(fixtureFrame(), 7, 100);
  const initial = await channel.ready();
  assert.equal(initial.sessionId, channel.sessionId);
  assert.equal(initial.revision, 0);
  for (let revision = 0; revision < PROBE_ACTIONS.length; revision += 1) {
    const result = await channel.request("act", {
      expectedRevision: revision,
      action: { type: PROBE_ACTIONS[revision] },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.revision, revision + 1);
  }
  const final = await channel.request("observe");
  assert.equal(final.state.outcome, "route_committed");
  channel.close();
});

test("stale revision is an explicit rejection without state change", async () => {
  const channel = new FrameGameChannel(fixtureFrame(), 2, 100);
  await channel.ready();
  const stale = await channel.request("act", { expectedRevision: 9, action: { type: "scan_sector" } });
  assert.equal(stale.accepted, false);
  assert.equal(stale.error?.code, "stale_revision");
  assert.equal(stale.revision, 0);
  channel.close();
});

test("foreign-session response is ignored while the pinned response wins", async () => {
  const channel = new FrameGameChannel(fixtureFrame({ forgedFirst: true }), 3, 100);
  await channel.ready();
  const observed = await channel.request("observe");
  assert.equal(observed.sessionId, channel.sessionId);
  assert.equal(observed.revision, 0);
  channel.close();
});

test("malformed and silent frames fail by bounded timeout", async () => {
  const malformed = new FrameGameChannel(fixtureFrame({ malformed: true }), 4, 20);
  await assert.rejects(malformed.ready(), /timed out/);
  malformed.close();

  const silent = new FrameGameChannel(fixtureFrame({ silent: true }), 5, 20);
  await assert.rejects(silent.ready(), /timed out/);
  silent.close();
});

test("unmanifested state keys are rejected instead of reaching tool output", async () => {
  const secret = new FrameGameChannel(fixtureFrame({ secretState: true }), 8, 20);
  await assert.rejects(secret.ready(), /timed out/);
  secret.close();
});

test("closing a pane generation rejects pending work", async () => {
  const channel = new FrameGameChannel(fixtureFrame(), 6, 100);
  await channel.ready();
  channel.close("active pane changed");
  await assert.rejects(channel.request("observe"), /closed/);
});
