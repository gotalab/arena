import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arenaToolDefinitions } from "../src/lib/arena-tools.ts";

const bundle = JSON.parse(readFileSync(new URL("../public-release/accepted/bundle.json", import.meta.url), "utf8"));

function controller(overrides = {}) {
  return {
    overview: {
      state: { taskIds: [], harnesses: [], models: [], efforts: [], playableOnly: false, chartTaskId: "combined" },
      setState() {},
    },
    task: {
      state: {
        buildIds: [],
        harnesses: [],
        models: [],
        efforts: [],
        check: { categories: [], groups: [], outcomes: [], blockingOnly: false, differencesOnly: false },
      },
      setState() {},
    },
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    route: "home",
    activeTaskId: null,
    identityAvailable: false,
    games: bundle.catalog,
    taskManifests: bundle.taskManifests,
    release: null,
    benchmarkController: controller(),
    openTask() {},
    openBuild() {},
    authorized: () => true,
    ...overrides,
  };
}

test("route exposure keeps named identities out of Blind before reveal", () => {
  assert.deepEqual(arenaToolDefinitions(context()).map((tool) => tool.name), ["search_tasks", "open_task"]);
  assert.deepEqual(arenaToolDefinitions(context({ route: "play" })).map((tool) => tool.name), ["search_tasks", "open_task"]);
  assert.deepEqual(arenaToolDefinitions(context({ route: "compare" })).map((tool) => tool.name), []);
  assert.deepEqual(
    arenaToolDefinitions(context({ route: "compare", identityAvailable: true, release: bundle.release })).map((tool) => tool.name),
    ["search_tasks", "open_task", "open_build"],
  );
  assert.deepEqual(
    arenaToolDefinitions(context({ route: "benchmark", identityAvailable: true, release: bundle.release })).map((tool) => tool.name),
    ["search_tasks", "open_task", "filter_benchmark_results", "open_build"],
  );
  assert.deepEqual(
    arenaToolDefinitions(context({ route: "task", activeTaskId: bundle.release.tasks[0].id, identityAvailable: true, release: bundle.release })).map((tool) => tool.name),
    ["search_tasks", "open_task", "compare_task_builds", "open_build"],
  );
});

test("task search is identity-free, bounded and closed to extra input", async () => {
  const [search] = arenaToolDefinitions(context());
  const output = await search.execute({ query: "survival", limit: 1 });
  assert.ok(Array.isArray(output.structuredContent.tasks));
  assert.ok(output.structuredContent.tasks.every((task) => task.agentPlay.mode === "not_offered"));
  assert.equal(JSON.stringify(output).includes("configuration"), false);
  assert.throws(() => search.execute({ query: "", provider: "hidden" }), /invalid task search input/);
  assert.deepEqual((await search.execute({ agentPlay: "required" })).structuredContent.tasks, []);
});

test("task search reports Agent Play policy and open_task changes the visible route", async () => {
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
  const opened = [];
  const tools = arenaToolDefinitions(context({ taskManifests: [manifest], openTask: (id) => opened.push(id) }));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const tasks = (await byName.get("search_tasks").execute({ agentPlay: "required" })).structuredContent.tasks;
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].agentPlay, {
    mode: "required",
    protocol: "arena.game.v1",
    tools: ["get_game_state", "take_game_action"],
  });
  await byName.get("open_task").execute({ taskId });
  assert.deepEqual(opened, [taskId]);
});

test("Benchmark tool mutates the shared controller and returns a bounded compact page", async () => {
  let visibleState = null;
  const benchmarkController = controller();
  benchmarkController.overview.setState = (state) => { visibleState = state; benchmarkController.overview.state = state; };
  const tools = arenaToolDefinitions(context({
    route: "benchmark",
    identityAvailable: true,
    release: bundle.release,
    benchmarkController,
  }));
  const filter = tools.find((tool) => tool.name === "filter_benchmark_results");
  const taskId = bundle.release.tasks[0].id;
  const output = await filter.execute({ taskIds: [taskId], playableOnly: true, chartTaskId: taskId, limit: 2 });
  assert.deepEqual(visibleState.taskIds, [taskId]);
  assert.equal(visibleState.playableOnly, true);
  assert.equal(visibleState.chartTaskId, taskId);
  assert.equal(output.structuredContent.agents.length <= 2, true);
  assert.deepEqual(output.structuredContent.taskIds, [taskId]);
  assert.equal(JSON.stringify(output).includes("checks"), false);
});

test("task Build tool supports arbitrary selection, staged rows and explicit explanations", async () => {
  const taskId = bundle.release.tasks[0].id;
  const builds = bundle.release.builds.filter((build) => build.taskId === taskId);
  assert.ok(builds.length >= 6);
  let visibleState = null;
  const benchmarkController = controller();
  benchmarkController.task.setState = (state) => { visibleState = state; benchmarkController.task.state = state; };
  const tools = arenaToolDefinitions(context({
    route: "task",
    activeTaskId: taskId,
    identityAvailable: true,
    release: bundle.release,
    benchmarkController,
  }));
  const compare = tools.find((tool) => tool.name === "compare_task_builds");
  assert.throws(() => compare.execute({ buildIds: ["missing-build"] }), /active public task/);
  assert.throws(() => compare.execute({ stage: "rows", cursor: "next" }), /cursor/);
  const selected = builds.slice(0, 6).map((build) => build.id);
  const summary = await compare.execute({ buildIds: selected, check: { differencesOnly: true }, stage: "summary" });
  assert.equal(visibleState.buildIds.length, 6);
  assert.equal(summary.structuredContent.summary.selectedBuildCount, 6);
  assert.equal(summary.structuredContent.rows.length, 0);
  assert.equal(summary.structuredContent.evidence.length, 0);
  const rows = await compare.execute({ stage: "rows", limit: 2 });
  assert.equal(rows.structuredContent.rows.length <= 2, true);
  assert.ok(rows.structuredContent.rows.every((row) => row.cells.length === 6));
  assert.equal(JSON.stringify(rows.structuredContent.rows).includes("explanation"), false);
  const buildPage = await compare.execute({ stage: "rows", limit: 1, buildLimit: 2 });
  assert.equal(buildPage.structuredContent.builds.length, 2);
  assert.equal(buildPage.structuredContent.rows[0].cells.length, 2);
  assert.equal(buildPage.structuredContent.buildNextCursor, "2");
  assert.equal(Object.hasOwn(buildPage.structuredContent, "activeState"), false);
  const checkId = rows.structuredContent.rows[0]?.checkId;
  if (checkId) {
    const evidence = await compare.execute({ stage: "evidence", checkIds: [checkId], limit: 2 });
    assert.equal(evidence.structuredContent.evidence.length <= 2, true);
    assert.ok(evidence.structuredContent.evidence.every((entry) => Object.hasOwn(entry, "explanation")));
  }
});

test("open_build uses opaque public ids and rejects a different task on a task route", async () => {
  const opened = [];
  const taskId = bundle.release.tasks[0].id;
  const build = bundle.release.builds.find((candidate) => candidate.taskId === taskId);
  const other = bundle.release.builds.find((candidate) => candidate.taskId !== taskId);
  const tools = arenaToolDefinitions(context({
    route: "task",
    activeTaskId: taskId,
    identityAvailable: true,
    release: bundle.release,
    openBuild: (openedTaskId, buildId) => opened.push({ taskId: openedTaskId, buildId }),
  }));
  const open = tools.find((tool) => tool.name === "open_build");
  const accepted = await open.execute({ buildId: build.id });
  assert.match(accepted.structuredContent.buildId, /^build_[a-f0-9]{20}$/);
  assert.equal(JSON.stringify(accepted).includes("sourcePath"), false);
  assert.deepEqual(opened, [{ taskId, buildId: build.id }]);
  assert.throws(() => open.execute({ buildId: other.id }), /outside the active Arena route/);
});

test("stale route authorization rejects execution even with an old handle", () => {
  let active = true;
  const [search] = arenaToolDefinitions(context({ authorized: () => active }));
  active = false;
  assert.throws(() => search.execute({}), /route changed/);
});

test("legacy named Build search and two-Build comparison tools are removed", () => {
  const names = arenaToolDefinitions(context({ route: "benchmark", identityAvailable: true, release: bundle.release })).map((tool) => tool.name);
  assert.equal(names.includes("search_builds"), false);
  assert.equal(names.includes("compare_builds"), false);
});

test("Benchmark tool rejects unknown task selection instead of silently widening to all tasks", () => {
  const tools = arenaToolDefinitions(context({ route: "benchmark", identityAvailable: true, release: bundle.release }));
  const filter = tools.find((tool) => tool.name === "filter_benchmark_results");
  assert.throws(() => filter.execute({ taskIds: ["missing-task"] }), /public task/);
});
