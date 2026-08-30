import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createTaskCheckComparison,
  createTaskComparisonResult,
  normalizeTaskComparisonState,
  parseTaskComparisonSearchParams,
  selectTaskBuilds,
  selectTaskComparisonEvidence,
  serializeTaskComparisonSearchParams,
} from "../src/lib/task-comparison.ts";

function fixture() {
  const configurations = [
    { id: "cfg-a", harnessId: "codex-cli", harness: "Codex", model: "Model A", effort: "High" },
    { id: "cfg-b", harnessId: "cursor-agent", harness: "Cursor", model: "Model B", effort: "" },
    { id: "cfg-c", harnessId: "claude-code", harness: "Claude Code", model: "Model C", effort: "Low" },
    { id: "cfg-d", harnessId: "opencode", harness: "OpenCode", model: "Model D", effort: "Medium" },
    { id: "cfg-e", harnessId: "pi", harness: "pi", model: "Model E", effort: "High" },
    { id: "cfg-f", harnessId: "codex-cli", harness: "Codex", model: "Model F", effort: "Low" },
  ];
  const check = (id, category, group, outcome, extra = {}) => ({
    id,
    category,
    group,
    label: id,
    outcome,
    explanation: `what ${id} means`,
    ...extra,
  });
  const builds = configurations.map((configuration, index) => {
    const checks = [
      check("gate.loads", "gate", "Blocking", index === 1 ? "fail" : "pass"),
      check("req.controls", "requirement", "Controls", index % 2 === 0 ? "pass" : "not_evaluated"),
    ];
    if (index !== 2) checks.push(check("req.optional", "requirement", "Optional", index === 4 ? "grader_error" : "pass"));
    return {
      id: `build-${index + 1}`,
      taskId: "task-a",
      status: "succeeded",
      playability: index === 1 ? "not-playable" : "playable",
      artifact: { sha256: `sha-${index}`, publicBase: "/artifacts/" },
      configurationId: configuration.id,
      requirementSummary: { passed: 1, applicable: 1, evaluated: 1, notEvaluated: 0, graderErrors: 0 },
      checks,
      replica: 1,
    };
  });
  // A different-task Build must never become a column on task-a.
  builds.push({
    id: "build-other-task",
    taskId: "task-b",
    status: "succeeded",
    playability: "playable",
    artifact: { sha256: "sha-other", publicBase: "/artifacts/" },
    configurationId: "cfg-a",
    requirementSummary: null,
    checks: [check("other", "gate", "Other", "pass")],
    replica: 1,
  });
  const cells = builds
    .filter((build) => build.taskId === "task-a")
    .map((build) => ({
      taskId: build.taskId,
      configurationId: build.configurationId,
      showcaseBuildId: build.id,
      score: {
        mean: 0.5,
        ciHalfWidth: null,
        n: 1,
        replicasCounted: 1,
        replicasNullRate: 0,
        replicasHeldInvalid: 0,
        gatesPassed: true,
        gateFailures: [],
        gateUnverified: [],
      },
      operational: {
        runs: 1,
        time: { mean: 1, reported: 1 },
        tokens: { mean: 1, reported: 1 },
        estimatedCost: { mean: 0.01, reported: 1 },
        costAtListPrice: false,
      },
      replicas: [],
    }));
  return {
    releaseId: "test",
    tasks: [
      { id: "task-a", title: "A", version: "1", presentation: { canonicalViewport: { width: 1, height: 1 } } },
      { id: "task-b", title: "B", version: "1", presentation: { canonicalViewport: { width: 1, height: 1 } } },
    ],
    builds,
    configurations,
    cells,
    attempts: [],
    taskCollection: null,
    evaluationVersion: "test",
  };
}

const release = fixture();

test("selects arbitrary 2, 4 and 6 Build columns, never another task", () => {
  for (const count of [2, 4, 6]) {
    const selected = selectTaskBuilds(release, "task-a", {
      buildIds: Array.from({ length: count }, (_, index) => `build-${index + 1}`),
    });
    assert.equal(selected.length, count);
    assert.ok(selected.every((build) => build.taskId === "task-a"));
  }
  const all = selectTaskBuilds(release, "task-a", { buildIds: ["build-other-task", "missing"] });
  assert.equal(all.length, 6, "unknown/other-task ids are removed, and an empty selection means all task Builds");
});

test("normalizes identity and check filters, retaining outcome distinctions", () => {
  const state = normalizeTaskComparisonState({
    buildIds: ["build-3", "missing", "build-other-task"],
    harnesses: ["cursor-agent"],
    models: ["not real"],
    efforts: ["none"],
    check: {
      categories: ["gate", "not-real"],
      groups: ["Blocking"],
      outcomes: ["missing", "grader_error", "unknown"],
      blockingOnly: true,
      differencesOnly: true,
    },
  }, release, "task-a");
  assert.deepEqual(state, {
    buildIds: ["build-3"],
    harnesses: ["Cursor"],
    models: [],
    efforts: [""],
    check: {
      categories: ["gate"],
      groups: ["Blocking"],
      outcomes: ["grader_error", "missing"],
      blockingOnly: true,
      differencesOnly: true,
    },
  });
});

test("task comparison URL round-trips deterministic repeated params", () => {
  const state = normalizeTaskComparisonState({
    buildIds: ["build-4", "build-2"],
    harnesses: ["Codex", "Cursor"],
    models: ["Model B", "Model A"],
    efforts: ["high", "none"],
    check: {
      categories: ["requirement", "gate"],
      groups: ["Controls", "Blocking"],
      outcomes: ["fail", "pass"],
      blockingOnly: true,
      differencesOnly: true,
    },
  }, release, "task-a");
  const query = serializeTaskComparisonSearchParams(state, release, "task-a");
  assert.equal(query.toString(), "build=build-2&build=build-4&harness=Codex&harness=Cursor&model=Model+A&model=Model+B&effort=high&effort=none&category=gate&category=requirement&group=Blocking&group=Controls&outcome=fail&outcome=pass&blocking=1&differences=1");
  assert.deepEqual(parseTaskComparisonSearchParams(query, release, "task-a"), state);
});

test("missing cells remain missing and count as differences", () => {
  const comparison = createTaskCheckComparison(release, "task-a", {
    buildIds: ["build-1", "build-3"],
    check: { differencesOnly: true },
  });
  const optional = comparison.rows.find((row) => row.id === "req.optional");
  assert.ok(optional);
  assert.deepEqual(optional.cells.map((cell) => cell.outcome), ["pass", "missing"]);
  assert.equal(optional.differences, true);
  assert.ok(comparison.rows.every((row) => row.differences));
});

test("outcome and blocking filters preserve pass/fail/not-evaluated/grader-error/missing", () => {
  const comparison = createTaskCheckComparison(release, "task-a", {
    buildIds: ["build-1", "build-2", "build-3", "build-5"],
    check: { outcomes: ["fail", "not_evaluated", "grader_error", "missing"] },
  });
  assert.deepEqual(comparison.rows.map((row) => row.id), ["gate.loads", "req.controls", "req.optional"]);
  assert.equal(comparison.rows.find((row) => row.id === "gate.loads")?.cells[1].outcome, "fail");
  assert.equal(comparison.rows.find((row) => row.id === "req.controls")?.cells[1].outcome, "not_evaluated");
  assert.equal(comparison.rows.find((row) => row.id === "req.optional")?.cells[2].outcome, "missing");
  assert.equal(comparison.rows.find((row) => row.id === "req.optional")?.cells[3].outcome, "grader_error");
  const gates = createTaskCheckComparison(release, "task-a", {
    check: { blockingOnly: true },
  });
  assert.deepEqual(gates.rows.map((row) => row.category), ["gate"]);
});

test("rows and evidence are bounded independently with continuation metadata", () => {
  const first = createTaskComparisonResult(release, "task-a", {}, { limit: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.rows.length, 1);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.continuation, { cursor: "1", offset: 1, limit: 1 });
  const second = createTaskComparisonResult(release, "task-a", {}, { cursor: first.nextCursor, limit: 1 });
  assert.equal(second.rows.length, 1);
  const evidence = createTaskComparisonResult(release, "task-a", {}, {
    stage: "evidence",
    checkIds: ["gate.loads"],
    limit: 2,
  });
  assert.equal(evidence.rows.length, 0);
  assert.equal(evidence.evidence.length, 2);
  assert.equal(evidence.evidence[0].checkId, "gate.loads");
  assert.equal(evidence.evidence[0].outcome, "pass");
  assert.ok(selectTaskComparisonEvidence(release, "task-a", {}, ["gate.loads"]).length >= 6);
});

test("Build columns page independently so large selections never widen row cells", () => {
  const many = structuredClone(release);
  many.configurations = [];
  many.builds = many.builds.filter((build) => build.taskId === "task-b");
  many.cells = [];
  for (let index = 0; index < 600; index += 1) {
    const configurationId = `cfg-many-${index}`;
    const buildId = `build-many-${index}`;
    many.configurations.push({ id: configurationId, harness: "Harness", model: `Model ${index}`, effort: "" });
    many.builds.push({
      id: buildId,
      taskId: "task-a",
      status: "succeeded",
      playability: "playable",
      artifact: { sha256: `sha-many-${index}`, publicBase: "/artifacts/" },
      configurationId,
      requirementSummary: { passed: 1, applicable: 1, evaluated: 1, notEvaluated: 0, graderErrors: 0 },
      checks: [{ id: "req.shared", category: "requirement", group: "Shared", label: "Shared", outcome: index % 2 ? "pass" : "fail", explanation: "published result" }],
      replica: 1,
    });
    many.cells.push({
      taskId: "task-a",
      configurationId,
      showcaseBuildId: buildId,
      score: { mean: 0.5, ciHalfWidth: null, n: 1, replicasCounted: 1, replicasNullRate: 0, replicasHeldInvalid: 0, gatesPassed: true, gateFailures: [], gateUnverified: [] },
      operational: { runs: 1, time: { mean: 1, reported: 1 }, tokens: { mean: 1, reported: 1 }, estimatedCost: { mean: 0.01, reported: 1 }, costAtListPrice: false },
      replicas: [],
    });
  }
  const first = createTaskComparisonResult(many, "task-a", {}, { stage: "rows", limit: 1, buildLimit: 25 });
  assert.equal(first.summary.selectedBuildCount, 600);
  assert.equal(first.builds.length, 25);
  assert.equal(first.rows[0].cells.length, 25);
  assert.deepEqual(first.buildContinuation, { cursor: "25", offset: 25, limit: 25 });
  assert.equal(Object.hasOwn(first.summary, "selectedBuildIds"), false);
  assert.equal(Object.hasOwn(first.activeFilters, "buildIds"), false);
  const second = createTaskComparisonResult(many, "task-a", {}, { stage: "rows", limit: 1, buildLimit: 25, buildCursor: first.buildNextCursor });
  assert.equal(second.buildOffset, 25);
  assert.equal(second.builds.length, 25);
  assert.equal(second.rows[0].cells.length, 25);
});
