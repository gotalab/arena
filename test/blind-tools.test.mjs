import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { blindToolDefinitions } from "../src/lib/blind-tools.ts";

function context(overrides = {}) {
  return {
    taskId: "task-a",
    taskName: "Task A",
    activeSide: "A",
    blindChoiceAvailable: true,
    sideStatus: { A: "ready", B: "loading" },
    openSide() {},
    authorized: () => true,
    ...overrides,
  };
}

test("Blind tools expose only anonymous state and leave the choice to the human", async () => {
  const tools = new Map(blindToolDefinitions(context()).map((tool) => [tool.name, tool]));
  const output = await tools.get("get_blind_comparison").execute({});
  assert.deepEqual(output.structuredContent, {
    taskId: "task-a",
    taskName: "Task A",
    activeSide: "A",
    blindChoiceAvailable: true,
    sides: [{ side: "A", status: "ready" }, { side: "B", status: "loading" }],
    humanChoiceRequired: true,
  });
  assert.doesNotMatch(JSON.stringify(output), /build|configuration|score|identity/i);
});

test("open_blind_side changes only the visible anonymous side", async () => {
  const opened = [];
  const tools = new Map(blindToolDefinitions(context({ openSide: (side) => opened.push(side) })).map((tool) => [tool.name, tool]));
  const output = await tools.get("open_blind_side").execute({ side: "B" });
  assert.deepEqual(opened, ["B"]);
  assert.deepEqual(output.structuredContent, {
    accepted: true,
    activeSide: "B",
    blindChoiceAvailable: true,
    humanChoiceRequired: true,
  });
  assert.throws(() => tools.get("open_blind_side").execute({ side: "C" }), /A or B/);
  assert.throws(() => tools.get("open_blind_side").execute({ side: "A", reveal: true }), /A or B/);
});

test("stale Blind handles fail after their comparison changes", () => {
  let active = true;
  const [read] = blindToolDefinitions(context({ authorized: () => active }));
  active = false;
  assert.throws(() => read.execute({}), /comparison changed/);
});
