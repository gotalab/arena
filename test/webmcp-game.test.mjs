import test from "node:test";
import assert from "node:assert/strict";
import {
  gameToolDefinitions,
  parseRestartInput,
  parseTakeActionInput,
  PROBE_ACTIONS,
  WEBMCP_PROBE_MANIFEST,
} from "../src/lib/game-tools.ts";
import { FrameGameChannel, GAME_PROTOCOL } from "../src/platform/frame-game-channel.ts";

function fixtureFrame({ forgedFirst = false, malformed = false, secretState = false, silent = false, stateShape = "probe" } = {}) {
  let revision = 0;
  let sessionId;
  let generation;
  const state = () => stateShape === "task-owned"
    ? { revision, phase: "playing", pool: 1, rows: ["##", "##"] }
    : {
        revision,
        phase: revision === PROBE_ACTIONS.length ? "complete" : "playing",
        outcome: revision === PROBE_ACTIONS.length ? "route_committed" : null,
        legalActions: revision === PROBE_ACTIONS.length ? [] : [{ type: PROBE_ACTIONS[revision] }],
        ...(secretState ? { secret: "must not cross the parent boundary" } : {}),
      };
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
        if (request.command === "act" || request.command === "restart") {
          if (request.expectedRevision !== revision) {
            port.postMessage(envelope("response", {
              accepted: false,
              requestId: request.requestId,
              error: { code: "stale_revision", message: "stale" },
            }));
            return;
          }
          revision = request.command === "restart" ? 0 : revision + 1;
        }
        port.postMessage(envelope("response", { requestId: request.requestId }));
      };
      port.start();
      queueMicrotask(() => port.postMessage(envelope("ready")));
    },
  };
}

test("probe action input is closed and purpose-typed", () => {
  assert.deepEqual(parseTakeActionInput({
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector" },
  }, WEBMCP_PROBE_MANIFEST.actionSchema), {
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector" },
  });
  assert.equal(parseTakeActionInput({
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector", secret: true },
  }, WEBMCP_PROBE_MANIFEST.actionSchema), null);
  assert.equal(parseTakeActionInput({
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "unknown" },
  }, WEBMCP_PROBE_MANIFEST.actionSchema), null);
  assert.equal(parseTakeActionInput({
    sessionId: "s1",
    expectedRevision: 0,
    action: { type: "scan_sector" },
    extra: true,
  }, WEBMCP_PROBE_MANIFEST.actionSchema), null);
});

test("task-specific move and undo actions validate from the trusted manifest", () => {
  const actionSchema = {
    oneOf: [
      {
        type: "object",
        properties: { type: { const: "move" }, direction: { enum: ["up", "down", "left", "right"] } },
        required: ["type", "direction"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { type: { const: "undo" } },
        required: ["type"],
        additionalProperties: false,
      },
    ],
  };
  assert.deepEqual(parseTakeActionInput({
    sessionId: "s1", expectedRevision: 3, action: { type: "move", direction: "left" },
  }, actionSchema)?.action, { type: "move", direction: "left" });
  assert.deepEqual(parseTakeActionInput({
    sessionId: "s1", expectedRevision: 3, action: { type: "undo" },
  }, actionSchema)?.action, { type: "undo" });
  assert.equal(parseTakeActionInput({
    sessionId: "s1", expectedRevision: 3, action: { type: "move", direction: "diagonal" },
  }, actionSchema), null);
});

test("restart is a separate tool only when the manifest offers it", async () => {
  const channel = new FrameGameChannel(fixtureFrame(), 9, 100);
  await channel.ready();
  const manifest = { ...WEBMCP_PROBE_MANIFEST, tools: [...WEBMCP_PROBE_MANIFEST.tools, "restart_game"] };
  const tools = gameToolDefinitions(channel, manifest);
  assert.deepEqual(tools.map((tool) => tool.name), ["get_game_state", "take_game_action", "restart_game"]);
  assert.deepEqual(parseRestartInput({ sessionId: channel.sessionId, expectedRevision: 0 }), {
    sessionId: channel.sessionId,
    expectedRevision: 0,
  });
  const restarted = await tools[2].execute({ sessionId: channel.sessionId, expectedRevision: 0 });
  assert.equal(restarted.structuredContent.revision, 0);
  channel.close();
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

test("task manifest owns state fields beyond revision and phase", async () => {
  const stateSchema = {
    type: "object",
    properties: {
      revision: { type: "integer", minimum: 0 },
      phase: { enum: ["playing"] },
      pool: { type: "integer", minimum: 1 },
      rows: { type: "array", items: { type: "string", pattern: "^[#]*$" } },
    },
    required: ["revision", "phase", "pool", "rows"],
    additionalProperties: false,
  };
  const channel = new FrameGameChannel(fixtureFrame({ stateShape: "task-owned" }), 10, 100, stateSchema);
  const ready = await channel.ready();
  assert.deepEqual(ready.state, { revision: 0, phase: "playing", pool: 1, rows: ["##", "##"] });
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
