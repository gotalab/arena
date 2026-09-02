import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import accepted from "../public-release/accepted/bundle.json" with { type: "json" };
import { scanPublicTreeSync } from "../public-contract/scan-public.mjs";
import {
  checkRuntimeFixture,
  FIXTURE_CREATED_AT,
  FIXTURE_PATH,
  generateRuntimeFixture,
  MANIFEST_PATH,
  projectRuntimeFixture,
  RUNTIME_SCHEMA,
} from "../scripts/generate-runtime-fixture.mjs";

const ASSIGNMENT_LINE = /^INSERT OR IGNORE INTO blind_assignments \(id, task_id, artifact_a_sha256, artifact_b_sha256, created_at\) VALUES \('([^']+)', '([^']+)', '([a-f0-9]{64})', '([a-f0-9]{64})', '([^']+)'\);$/;

function assignmentRows(sql) {
  return sql
    .split("\n")
    .filter((line) => line.startsWith("INSERT OR IGNORE INTO blind_assignments"))
    .map((line) => {
      const match = line.match(ASSIGNMENT_LINE);
      assert.ok(match, `unparseable assignment row: ${line}`);
      return {
        id: match[1],
        taskId: match[2],
        artifactA: match[3],
        artifactB: match[4],
        createdAt: match[5],
      };
    });
}

function setDigest(values) {
  return createHash("sha256")
    .update([...new Set(values)].sort().map((value) => `${value}\n`).join(""))
    .digest("hex");
}

test("current public projection has five tasks and the complete ordered assignment set", () => {
  const output = projectRuntimeFixture(accepted);
  const rows = assignmentRows(output.fixture);
  const playableByTask = new Map();
  for (const task of accepted.catalog) {
    playableByTask.set(
      task.id,
      accepted.blind.builds
        .filter((build) => build.taskId === task.id && build.status === "succeeded" && build.playability === "playable")
        .map((build) => build.artifact.sha256)
        .sort(),
    );
  }
  const expectedIds = [];
  for (const task of accepted.catalog) {
    const hashes = playableByTask.get(task.id);
    for (const artifactA of hashes) {
      for (const artifactB of hashes) {
        if (artifactA !== artifactB) expectedIds.push(`${task.id}--${artifactA.slice(0, 12)}--${artifactB.slice(0, 12)}`);
      }
    }
  }

  assert.equal(output.tasks.length, 5);
  assert.deepEqual(output.tasks.map((task) => task.id), accepted.catalog.map((task) => task.id));
  assert.equal(rows.length, 732);
  assert.equal(output.manifest.assignmentCount, 732);
  assert.equal(output.manifest.artifactCount, 63);
  assert.deepEqual(rows.map((row) => row.id), expectedIds);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(output.manifest.assignmentSetSha256, setDigest(expectedIds));
  assert.ok(rows.every((row) => row.artifactA !== row.artifactB && row.createdAt === FIXTURE_CREATED_AT));
  assert.ok(!output.fixture.includes("310c33af7f2e7cc88cb71e9221cb00a53524b1b3f70232d1df81042eda865d8a"));
});

test("fixture and manifest bytes are deterministic across repeated generation", () => {
  const first = projectRuntimeFixture(accepted);
  const second = projectRuntimeFixture(structuredClone(accepted));
  assert.equal(first.fixture, second.fixture);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(readFileSync(FIXTURE_PATH, "utf8"), first.fixture);
  assert.equal(readFileSync(MANIFEST_PATH, "utf8"), `${JSON.stringify(first.manifest, null, 2)}\n`);
  assert.doesNotThrow(() => checkRuntimeFixture());

  const root = mkdtempSync(join(tmpdir(), "arena-runtime-fixture-"));
  try {
    const firstGenerated = generateRuntimeFixture({ outputDir: join(root, "first") });
    const secondGenerated = generateRuntimeFixture({ outputDir: join(root, "second") });
    assert.equal(readFileSync(firstGenerated.fixturePath, "utf8"), readFileSync(secondGenerated.fixturePath, "utf8"));
    assert.equal(readFileSync(firstGenerated.manifestPath, "utf8"), readFileSync(secondGenerated.manifestPath, "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private root data is ignored while malformed or protected public projections fail closed", () => {
  const hidden = structuredClone(accepted);
  hidden.release.configurations[0].privateToken = "do-not-copy";
  hidden.release.cells[0].internalLineage = "do-not-copy";
  hidden.release.attempts[0].rawRecord = "do-not-copy";
  const baseline = projectRuntimeFixture(accepted);
  const projected = projectRuntimeFixture(hidden);
  assert.equal(projected.fixture, baseline.fixture);
  assert.deepEqual(projected.manifest, baseline.manifest);
  assert.ok(!projected.fixture.includes("do-not-copy"));

  const invalidHash = structuredClone(accepted);
  invalidHash.blind.builds[0].artifact.sha256 = "not-a-hash";
  assert.throws(() => projectRuntimeFixture(invalidHash), /artifact\.sha256:sha256_required/);

  const protectedBuild = structuredClone(accepted);
  protectedBuild.blind.builds[0]["trial" + "Id"] = "private-lineage";
  assert.throws(() => projectRuntimeFixture(protectedBuild), /protected_field:trialId/);

  const protectedCatalog = structuredClone(accepted);
  protectedCatalog.catalog[0].prompt = "private-instruction";
  assert.throws(() => projectRuntimeFixture(protectedCatalog), /protected_field:prompt/);

  const spacedDisplayTitle = structuredClone(accepted);
  spacedDisplayTitle.catalog[0].name = spacedDisplayTitle.catalog[0].name.split("").join(" ");
  assert.doesNotThrow(() => projectRuntimeFixture(spacedDisplayTitle));

  const mismatchedTitle = structuredClone(accepted);
  mismatchedTitle.catalog[0].name = "Different game";
  assert.throws(() => projectRuntimeFixture(mismatchedTitle), /task_title_mismatch/);
});

test("a twelve-hex prefix collision stops generation before SQL is produced", () => {
  const collision = structuredClone(accepted);
  const first = collision.blind.builds.find((build) => build.taskId === "ember@1.3.0");
  const second = collision.blind.builds.find((build) => build.taskId === "ember@1.3.0" && build !== first);
  second.artifact.sha256 = `${first.artifact.sha256.slice(0, 12)}${"f".repeat(52)}`;
  assert.throws(() => projectRuntimeFixture(collision), /prefix_collision:ember@1\.3\.0/);
});

test("source scan permits only the public assignment-id shape in the generated fixture", () => {
  const root = mkdtempSync(join(tmpdir(), "arena-runtime-scan-"));
  const fixturePath = join(root, "fixture.sql");
  const options = { allowedRuleCodesByFile: { "fixture.sql": ["internal_id"] } };
  try {
    writeFileSync(fixturePath, projectRuntimeFixture(accepted).fixture);
    assert.doesNotThrow(() => scanPublicTreeSync(root, options));
    writeFileSync(fixturePath, `${projectRuntimeFixture(accepted).fixture}\ncsrf_token = "${"a".repeat(32)}";\n`);
    assert.throws(() => scanPublicTreeSync(root, options), /public_scan:credential:fixture\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration is closed to the runtime tables and does not carry workshop vocabulary", () => {
  const migration = projectRuntimeFixture(accepted).migration.toString("utf8");
  const tableNames = [...migration.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(tableNames, ["tasks", "artifacts", "blind_assignments", "blind_choices"]);
  assert.deepEqual(
    [...migration.matchAll(/CREATE INDEX (\w+) ON (\w+)\(([^)]+)\)/g)].map((match) => [match[1], match[2], match[3]]),
    [["idx_runtime_choices_assignment", "blind_choices", "assignment_id"]],
  );
  assert.match(migration, /tasks \([\s\S]*?id TEXT PRIMARY KEY,[\s\S]*?title TEXT NOT NULL,[\s\S]*?visible INTEGER/);
  assert.match(migration, /artifacts \([\s\S]*?sha256 TEXT PRIMARY KEY/);
  assert.match(migration, /blind_assignments \([\s\S]*?id TEXT PRIMARY KEY,[\s\S]*?task_id TEXT NOT NULL[\s\S]*?artifact_a_sha256 TEXT NOT NULL[\s\S]*?artifact_b_sha256 TEXT NOT NULL[\s\S]*?created_at TEXT NOT NULL/);
  assert.match(migration, /blind_choices \([\s\S]*?id TEXT PRIMARY KEY,[\s\S]*?assignment_id TEXT NOT NULL[\s\S]*?task_id TEXT NOT NULL[\s\S]*?choice TEXT NOT NULL[\s\S]*?actor_sub TEXT NOT NULL[\s\S]*?created_at TEXT NOT NULL/);
  for (const forbidden of ["collections", "agent_configurations", "trials", "evaluations", "check_results", "trial_id", "evaluation_id", "trace_sha256", "prompt", "rubric", "control", "raw" + "_log", "production"]) {
    assert.doesNotMatch(migration.toLowerCase(), new RegExp(`\\b${forbidden}\\b`), `forbidden term: ${forbidden}`);
  }
  const manifest = projectRuntimeFixture(accepted).manifest;
  assert.equal(manifest.schema, RUNTIME_SCHEMA);
  assert.match(manifest.schemaSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.fixtureSha256, /^[a-f0-9]{64}$/);
});
