import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createBenchmarkOverviewResult, normalizeBenchmarkOverviewState, parseBenchmarkOverviewSearchParams, selectBenchmarkOverviewRows, selectRankableTasks, selectVisibleConfigurationIds, selectVisibleTasks, serializeBenchmarkOverviewSearchParams } from "../src/lib/benchmark-view.ts";

function releaseFixture() {
  const tasks = [
    { id: "task-a", slug: "alpha" },
    { id: "task-b", slug: "beta" },
    { id: "task-c", slug: "gamma" },
  ];
  const configurations = [
    { id: "cfg-codex", harnessId: "codex-cli", harness: "Codex", model: "Model Z", effort: "High" },
    { id: "cfg-cursor", harnessId: "cursor-agent", harness: "Cursor", model: "Model A", effort: "" },
    { id: "cfg-claude", harnessId: "claude-code", harness: "Claude Code", model: "Model A", effort: "Low" },
  ];
  const score = (mean, gatesPassed = true) => ({
    mean,
    ciHalfWidth: null,
    n: mean == null ? 0 : 1,
    replicasCounted: mean == null ? 0 : 1,
    replicasNullRate: 0,
    replicasHeldInvalid: 0,
    gatesPassed,
    gateFailures: gatesPassed ? [] : ["gate.loads"],
    gateUnverified: [],
  });
  const builds = [];
  const cells = [];
  for (const task of tasks) {
    for (const configuration of configurations) {
      const playable = !(task.id === "task-b" && configuration.id === "cfg-cursor");
      builds.push({
        id: `build-${task.id}-${configuration.id}`,
        taskId: task.id,
        status: "succeeded",
        playability: playable ? "playable" : "not-playable",
        artifact: { sha256: `${task.id}-${configuration.id}`, publicBase: "/artifacts/" },
        configurationId: configuration.id,
        requirementSummary: { passed: 1, applicable: 1, evaluated: 1, notEvaluated: 0, graderErrors: 0, rate: 1 },
        checks: [],
        replica: 1,
      });
      cells.push({
        taskId: task.id,
        configurationId: configuration.id,
        showcaseBuildId: `build-${task.id}-${configuration.id}`,
        score: score(
          configuration.id === "cfg-codex" ? (task.id === "task-a" ? 0.9 : task.id === "task-b" ? 0.8 : 0.7)
            : configuration.id === "cfg-cursor" ? 0.6 : 0.5,
          playable,
        ),
        operational: {
          runs: 1,
          time: { mean: 1, reported: 1 },
          tokens: { mean: 10, reported: 1 },
          estimatedCost: { mean: 0.1, reported: 1 },
          costAtListPrice: false,
        },
        replicas: [],
      });
    }
  }
  return {
    releaseId: "fixture",
    tasks: tasks.map(({ id }) => ({ id, title: id.toUpperCase(), version: "1", presentation: { canonicalViewport: { width: 1, height: 1 } } })),
    builds,
    configurations,
    cells,
    attempts: [],
    taskCollection: null,
    evaluationVersion: "test",
  };
}

const release = releaseFixture();
const games = [
  { id: "task-a", slug: "alpha" },
  { id: "task-b", slug: "beta" },
  { id: "task-c", slug: "gamma" },
];

test("overview URL round-trips canonical repeated filters", () => {
  const state = normalizeBenchmarkOverviewState({
    taskIds: ["beta"],
    harnesses: ["codex-cli"],
    models: ["Model Z"],
    efforts: ["high"],
    playableOnly: true,
    chartTaskId: "beta",
  }, release, games);
  const query = serializeBenchmarkOverviewSearchParams(state, release, games);
  assert.equal(query.toString(), "task=task-b&harness=Codex&model=Model+Z&effort=high&playable=1&chart=task-b");
  assert.deepEqual(parseBenchmarkOverviewSearchParams(query, release, games), state);
});

test("normalization drops unknown values and stale chart tasks", () => {
  const state = normalizeBenchmarkOverviewState({
    taskIds: ["missing", "alpha"],
    harnesses: ["unknown", "Cursor"],
    models: ["missing"],
    efforts: ["not-a-real-effort"],
    chartTaskId: "missing",
  }, release, games);
  assert.deepEqual(state, {
    taskIds: ["task-a"],
    harnesses: ["Cursor"],
    models: [],
    efforts: [],
    playableOnly: false,
    chartTaskId: "combined",
  });
});

test("empty selections mean all current tasks and configurations", () => {
  assert.deepEqual(selectVisibleTasks(release, games, {}), games);
  assert.deepEqual(selectVisibleConfigurationIds(release, games, {}), ["cfg-codex", "cfg-cursor", "cfg-claude"]);
});

test("effort and task subset filters narrow the same configuration roster", () => {
  assert.deepEqual(
    selectVisibleConfigurationIds(release, games, { efforts: ["low"] }),
    ["cfg-claude"],
  );
  assert.deepEqual(
    selectVisibleTasks(release, games, { taskIds: ["task-c", "task-a"] }),
    [games[0], games[2]],
  );
  const rows = selectBenchmarkOverviewRows(release, games, { taskIds: ["task-a"] });
  assert.deepEqual(rows.map((row) => row.configurationId), ["cfg-codex", "cfg-cursor", "cfg-claude"]);
  assert.equal(rows[0].score.mean, 0.9);
});

test("playable filter uses published gate outcome without changing scores", () => {
  const allRows = selectBenchmarkOverviewRows(release, games, { taskIds: ["task-b"] });
  const playableIds = selectVisibleConfigurationIds(release, games, { taskIds: ["task-b"], playableOnly: true });
  assert.deepEqual(playableIds, ["cfg-codex", "cfg-claude"]);
  assert.equal(allRows.find((row) => row.configurationId === "cfg-cursor")?.score.mean, 0.6);
});

test("serialization order is deterministic even when state arrays are shuffled", () => {
  const first = serializeBenchmarkOverviewSearchParams({
    taskIds: ["task-c", "task-a"],
    harnesses: ["Cursor", "Codex"],
    models: ["Model Z", "Model A"],
    efforts: ["low", "high"],
    chartTaskId: "combined",
  }).toString();
  const second = serializeBenchmarkOverviewSearchParams({
    taskIds: ["task-a", "task-c"],
    harnesses: ["Codex", "Cursor"],
    models: ["Model A", "Model Z"],
    efforts: ["high", "low"],
    chartTaskId: "combined",
  }).toString();
  assert.equal(first, second);
  assert.equal(first, "task=task-a&task=task-c&harness=Codex&harness=Cursor&model=Model+A&model=Model+Z&effort=high&effort=low");
});

test("overview result pages are bounded and expose continuation metadata", () => {
  const first = createBenchmarkOverviewResult(release, games, {}, { limit: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.rows.length, 2);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.continuation, { cursor: "2", offset: 2, limit: 2 });
  const second = createBenchmarkOverviewResult(release, games, {}, { cursor: first.nextCursor });
  assert.equal(second.rows.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
});

test("a preview-only task has no combined ranking instead of ranking zero-task rows", () => {
  const preview = structuredClone(release);
  preview.builds = preview.builds.filter((build) => build.taskId !== "task-a" || build.configurationId === "cfg-codex");
  assert.deepEqual(selectRankableTasks(preview, [games[0]]), []);
});
