import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arenaToolDefinitions } from "../src/lib/arena-tools.ts";

const bundle = JSON.parse(readFileSync(new URL("../public-release/accepted/bundle.json", import.meta.url), "utf8"));

function context(overrides = {}) {
  return {
    route: "home",
    activeTaskId: null,
    identityAvailable: false,
    games: bundle.catalog,
    taskManifests: bundle.taskManifests,
    release: null,
    openBuild() {},
    authorized: () => true,
    ...overrides,
  };
}

test("route exposure keeps named identities out of Blind before reveal", () => {
  assert.deepEqual(arenaToolDefinitions(context()).map((tool) => tool.name), ["search_tasks"]);
  assert.deepEqual(arenaToolDefinitions(context({ route: "play" })).map((tool) => tool.name), ["search_tasks"]);
  assert.deepEqual(arenaToolDefinitions(context({ route: "compare" })).map((tool) => tool.name), []);
  assert.deepEqual(
    arenaToolDefinitions(context({ route: "compare", identityAvailable: true, release: bundle.release })).map((tool) => tool.name),
    ["search_tasks", "search_builds", "open_build", "compare_builds"],
  );
});

test("task search is identity-free and closed to extra input", async () => {
  const [search] = arenaToolDefinitions(context());
  const output = await search.execute({ query: "survival" });
  assert.ok(Array.isArray(output.structuredContent.tasks));
  assert.ok(output.structuredContent.tasks.every((task) => task.agentPlay.mode === "not_offered"));
  assert.equal(JSON.stringify(output).includes("configuration"), false);
  assert.throws(() => search.execute({ query: "", provider: "hidden" }), /invalid search input/);
  assert.deepEqual((await search.execute({ agentPlay: "required" })).structuredContent.tasks, []);
});

test("task and named-build search distinguish policy from build evidence", async () => {
  const taskId = bundle.release.tasks[0].id;
  const manifest = {
    schema: "arena.game-manifest.v1",
    taskId,
    tools: ["get_game_state", "take_game_action"],
    actionSchema: { type: "object" },
    stateSchema: { properties: {}, additionalProperties: false },
    resultSchema: { properties: {}, additionalProperties: false },
    maxMessageBytes: 32768,
  };
  const release = structuredClone(bundle.release);
  release.builds = release.builds.map((build, index) => ({
    ...build,
    agentPlayEvidence: index === 0
      ? { status: "passed", receiptAvailable: true }
      : { status: "not_evaluated", receiptAvailable: false },
  }));
  const tools = arenaToolDefinitions(context({
    route: "benchmark",
    identityAvailable: true,
    release,
    taskManifests: [manifest],
  }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const tasks = (await byName.get("search_tasks").execute({ agentPlay: "required" })).structuredContent.tasks;
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].agentPlay, {
    mode: "required",
    protocol: "arena.game.v1",
    tools: ["get_game_state", "take_game_action"],
  });
  const passed = (await byName.get("search_builds").execute({ taskId, agentPlayStatus: "passed" })).structuredContent.builds;
  assert.equal(passed.length, 1);
  assert.deepEqual(passed[0].agentPlayEvidence, { status: "passed", receiptAvailable: true });
});

test("named build tools use only opaque public ids after reveal", async () => {
  const opened = [];
  const tools = arenaToolDefinitions(context({
    route: "benchmark",
    identityAvailable: true,
    release: bundle.release,
    openBuild: (taskId, buildId) => opened.push({ taskId, buildId }),
  }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const taskId = bundle.release.tasks[0].id;
  const found = await byName.get("search_builds").execute({ taskId });
  const builds = found.structuredContent.builds;
  assert.ok(builds.length >= 2);
  assert.ok(builds.every((build) => /^build_[a-f0-9]{20}$/.test(build.buildId)));
  assert.ok(builds.every((build) => build.agentPlayEvidence.status === "not_applicable"));
  assert.equal(JSON.stringify(found).includes("sourcePath"), false);
  const openedResult = await byName.get("open_build").execute({ buildId: builds[0].buildId });
  assert.deepEqual(openedResult.structuredContent.agentPlayEvidence, { status: "not_applicable", receiptAvailable: false });
  assert.deepEqual(opened, [{ taskId, buildId: builds[0].buildId }]);
  const compared = await byName.get("compare_builds").execute({ taskId, buildIds: [builds[0].buildId, builds[1].buildId] });
  assert.equal(compared.structuredContent.builds.length, 2);
});

test("stale route authorization rejects execution even with an old handle", async () => {
  let active = true;
  const [search] = arenaToolDefinitions(context({ authorized: () => active }));
  active = false;
  assert.throws(() => search.execute({}), /route changed/);
});

test("named task routes cannot query another task's identities", () => {
  const tools = arenaToolDefinitions(context({
    route: "task",
    activeTaskId: bundle.release.tasks[0].id,
    identityAvailable: true,
    release: bundle.release,
  }));
  const search = tools.find((tool) => tool.name === "search_builds");
  assert.throws(() => search.execute({ taskId: bundle.release.tasks[1].id }), /outside the active Arena route/);
});
