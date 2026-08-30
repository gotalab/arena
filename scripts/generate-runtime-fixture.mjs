#!/usr/bin/env node

/**
 * Project the public catalog and Blind builds into the small local runtime
 * database.  The source bundle is deliberately treated as two public
 * projections: `catalog` supplies task names and `blind` supplies playable
 * Artifact hashes.  Nothing else in the bundle is read.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_SCHEMA = "arena.runtime-d1.v1";
export const ASSIGNMENT_PREFIX_LENGTH = 12;
export const FIXTURE_CREATED_AT = "1970-01-01T00:00:00.000Z";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
export const DEFAULT_BUNDLE_PATH = path.join(REPOSITORY_ROOT, "public-release", "accepted", "bundle.json");
export const DEFAULT_OUTPUT_DIR = path.join(REPOSITORY_ROOT, "runtime", "d1");
export const MIGRATION_PATH = path.join(DEFAULT_OUTPUT_DIR, "0001_runtime.sql");
export const FIXTURE_PATH = path.join(DEFAULT_OUTPUT_DIR, "fixture.sql");
export const MANIFEST_PATH = path.join(DEFAULT_OUTPUT_DIR, "manifest.json");

const CATALOG_KEYS = new Set([
  "id",
  "slug",
  "name",
  "image",
  "browseRule",
  "rule",
  "tension",
  "inputSummary",
  "controls",
  "presentation",
  "publicNarrative",
]);
const TASK_KEYS = new Set(["id", "title", "version", "presentation"]);
const BUILD_KEYS = new Set(["id", "taskId", "status", "playability", "artifact"]);
const ARTIFACT_KEYS = new Set(["sha256", "publicBase", "byteLength"]);
const BUNDLE_KEYS = new Set(["schema", "release", "blind", "catalog", "taskManifests"]);
const BLIND_KEYS = new Set(["releaseId", "configurationCount", "tasks", "builds"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stringSetSha256(values) {
  return sha256([...new Set(values)].sort().map((value) => `${value}\n`).join(""));
}

function assertObject(value, at) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`runtime_fixture:${at}:object_required`);
  }
}

function assertClosed(value, allowed, at) {
  assertObject(value, at);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`runtime_fixture:${at}:protected_field:${unexpected.sort().join(",")}`);
  }
}

function assertText(value, at) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`runtime_fixture:${at}:text_required`);
  }
}

function assertTaskId(value, at) {
  assertText(value, at);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(value)) {
    throw new Error(`runtime_fixture:${at}:invalid`);
  }
}

function assertHash(value, at) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`runtime_fixture:${at}:sha256_required`);
  }
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error("runtime_fixture:catalog:non_empty_array_required");
  }
  const seen = new Set();
  return catalog.map((task, index) => {
    const at = `catalog[${index}]`;
    assertClosed(task, CATALOG_KEYS, at);
    assertTaskId(task.id, `${at}.id`);
    assertText(task.name, `${at}.name`);
    if (seen.has(task.id)) throw new Error(`runtime_fixture:catalog:duplicate_task:${task.id}`);
    seen.add(task.id);
    return { id: task.id, title: task.name };
  });
}

function validateBlind(blind) {
  assertClosed(blind, BLIND_KEYS, "blind");
  if (!Array.isArray(blind.tasks)) throw new Error("runtime_fixture:blind.tasks:array_required");
  if (!Array.isArray(blind.builds)) throw new Error("runtime_fixture:blind.builds:array_required");

  const taskIds = new Set();
  const tasks = blind.tasks.map((task, index) => {
    const at = `blind.tasks[${index}]`;
    assertClosed(task, TASK_KEYS, at);
    assertTaskId(task.id, `${at}.id`);
    assertText(task.title, `${at}.title`);
    if (taskIds.has(task.id)) throw new Error(`runtime_fixture:blind:duplicate_task:${task.id}`);
    taskIds.add(task.id);
    return { id: task.id, title: task.title };
  });

  const builds = blind.builds.map((build, index) => {
    const at = `blind.builds[${index}]`;
    assertClosed(build, BUILD_KEYS, at);
    assertText(build.id, `${at}.id`);
    assertTaskId(build.taskId, `${at}.taskId`);
    assertText(build.status, `${at}.status`);
    assertText(build.playability, `${at}.playability`);
    assertClosed(build.artifact, ARTIFACT_KEYS, `${at}.artifact`);
    assertHash(build.artifact.sha256, `${at}.artifact.sha256`);
    return {
      id: build.id,
      taskId: build.taskId,
      status: build.status,
      playability: build.playability,
      sha256: build.artifact.sha256,
    };
  });

  return { tasks, builds };
}

function validateBundleShape(bundle) {
  assertClosed(bundle, BUNDLE_KEYS, "bundle");
  if (bundle.schema !== "arena.public-release.v1") {
    throw new Error("runtime_fixture:bundle.schema:invalid");
  }
  const catalogTasks = validateCatalog(bundle.catalog);
  const blind = validateBlind(bundle.blind);
  const catalogIds = new Set(catalogTasks.map((task) => task.id));
  const blindIds = new Set(blind.tasks.map((task) => task.id));
  if (catalogIds.size !== blindIds.size || [...catalogIds].some((id) => !blindIds.has(id))) {
    throw new Error("runtime_fixture:task_set_mismatch");
  }
  const blindTitleById = new Map(blind.tasks.map((task) => [task.id, task.title]));
  for (const task of catalogTasks) {
    if (blindTitleById.get(task.id) !== task.title) {
      throw new Error(`runtime_fixture:task_title_mismatch:${task.id}`);
    }
  }
  for (const build of blind.builds) {
    if (!catalogIds.has(build.taskId)) {
      throw new Error(`runtime_fixture:build_task_not_public:${build.taskId}`);
    }
  }
  return { catalogTasks, builds: blind.builds };
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function playableArtifactsByTask(tasks, builds) {
  const buildsByTask = new Map(tasks.map((task) => [task.id, []]));
  for (const build of builds) {
    if (build.status !== "succeeded" || build.playability !== "playable") continue;
    buildsByTask.get(build.taskId).push(build.sha256);
  }

  const artifactsByTask = new Map();
  for (const task of tasks) {
    const hashes = buildsByTask.get(task.id);
    const unique = new Set();
    for (const hash of hashes) {
      if (unique.has(hash)) throw new Error(`runtime_fixture:duplicate_artifact:${task.id}:${hash}`);
      unique.add(hash);
    }
    const sorted = [...unique].sort();
    const prefixOwners = new Map();
    for (const hash of sorted) {
      const prefix = hash.slice(0, ASSIGNMENT_PREFIX_LENGTH);
      const owner = prefixOwners.get(prefix);
      if (owner !== undefined && owner !== hash) {
        throw new Error(`runtime_fixture:prefix_collision:${task.id}:${prefix}`);
      }
      prefixOwners.set(prefix, hash);
    }
    artifactsByTask.set(task.id, sorted);
  }
  return artifactsByTask;
}

export function assignmentId(taskId, artifactA, artifactB) {
  assertTaskId(taskId, "assignment.taskId");
  assertHash(artifactA, "assignment.artifactA");
  assertHash(artifactB, "assignment.artifactB");
  if (artifactA === artifactB) throw new Error("runtime_fixture:assignment:same_artifact");
  return `${taskId}--${artifactA.slice(0, ASSIGNMENT_PREFIX_LENGTH)}--${artifactB.slice(0, ASSIGNMENT_PREFIX_LENGTH)}`;
}

export function expectedAssignments(tasks, builds) {
  const artifactsByTask = playableArtifactsByTask(tasks, builds);
  const assignments = [];
  const seen = new Map();
  for (const task of tasks) {
    const hashes = artifactsByTask.get(task.id);
    for (const artifactA of hashes) {
      for (const artifactB of hashes) {
        if (artifactA === artifactB) continue;
        const id = assignmentId(task.id, artifactA, artifactB);
        if (seen.has(id)) throw new Error(`runtime_fixture:duplicate_assignment:${id}`);
        const row = {
          id,
          taskId: task.id,
          artifactA,
          artifactB,
          createdAt: FIXTURE_CREATED_AT,
        };
        seen.set(id, row);
        assignments.push(row);
      }
    }
  }

  const expectedCount = [...artifactsByTask.values()].reduce((total, hashes) => total + hashes.length * (hashes.length - 1), 0);
  if (assignments.length !== expectedCount) {
    throw new Error(`runtime_fixture:cardinality_mismatch:${assignments.length}:${expectedCount}`);
  }
  const expectedIds = new Set(assignments.map((assignment) => assignment.id));
  if (expectedIds.size !== assignments.length) throw new Error("runtime_fixture:assignment_set_mismatch");
  return { assignments, artifactsByTask, expectedCount };
}

export function assertAssignmentSet(assignments, expected) {
  const actualIds = assignments.map((assignment) => assignment.id);
  const expectedIds = expected.map((assignment) => assignment.id);
  if (actualIds.length !== expectedIds.length) {
    throw new Error(`runtime_fixture:cardinality_mismatch:${actualIds.length}:${expectedIds.length}`);
  }
  if (new Set(actualIds).size !== actualIds.length) {
    throw new Error("runtime_fixture:duplicate_assignment");
  }
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(expectedIds);
  if (actualSet.size !== expectedSet.size || [...expectedSet].some((id) => !actualSet.has(id))) {
    throw new Error("runtime_fixture:assignment_set_mismatch");
  }
}

function fixtureSql(tasks, artifacts, assignments) {
  const lines = [
    "-- arena.runtime-d1.v1 public data fixture; generated, deterministic, and idempotent.",
    "PRAGMA foreign_keys = ON;",
  ];
  for (const task of tasks) {
    lines.push(
      `INSERT OR IGNORE INTO tasks (id, title, visible) VALUES (${sqlText(task.id)}, ${sqlText(task.title)}, 1);`,
    );
  }
  for (const artifact of artifacts) {
    lines.push(`INSERT OR IGNORE INTO artifacts (sha256) VALUES (${sqlText(artifact)});`);
  }
  for (const assignment of assignments) {
    lines.push(
      "INSERT OR IGNORE INTO blind_assignments (id, task_id, artifact_a_sha256, artifact_b_sha256, created_at) VALUES "
      + `(${sqlText(assignment.id)}, ${sqlText(assignment.taskId)}, ${sqlText(assignment.artifactA)}, ${sqlText(assignment.artifactB)}, ${sqlText(assignment.createdAt)});`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function readMigration() {
  try {
    return readFileSync(MIGRATION_PATH);
  } catch (error) {
    throw new Error(`runtime_fixture:migration:unreadable:${error.code ?? "unknown"}`);
  }
}

export function projectRuntimeFixture(bundle) {
  const { catalogTasks, builds } = validateBundleShape(bundle);
  const { assignments, artifactsByTask, expectedCount } = expectedAssignments(catalogTasks, builds);
  const artifacts = [...new Set([...artifactsByTask.values()].flat())].sort();

  const fixture = fixtureSql(catalogTasks, artifacts, assignments);
  const migration = readMigration();
  const manifest = {
    schema: RUNTIME_SCHEMA,
    schemaSha256: sha256(migration),
    fixtureSha256: sha256(fixture),
    taskCount: catalogTasks.length,
    artifactCount: artifacts.length,
    assignmentCount: assignments.length,
    assignmentSetSha256: stringSetSha256(assignments.map((assignment) => assignment.id)),
  };
  if (assignments.length !== expectedCount) {
    throw new Error(`runtime_fixture:cardinality_mismatch:${assignments.length}:${expectedCount}`);
  }
  return { migration, fixture, manifest, tasks: catalogTasks, artifacts, assignments };
}

export function generateRuntimeFixture({
  bundlePath = DEFAULT_BUNDLE_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const output = projectRuntimeFixture(bundle);
  mkdirSync(outputDir, { recursive: true });
  const fixturePath = path.join(outputDir, "fixture.sql");
  const manifestPath = path.join(outputDir, "manifest.json");
  writeFileSync(fixturePath, output.fixture);
  writeFileSync(manifestPath, `${JSON.stringify(output.manifest, null, 2)}\n`);
  return {
    ...output,
    bundlePath: path.resolve(bundlePath),
    outputDir: path.resolve(outputDir),
    fixturePath,
    manifestPath,
  };
}

export function checkRuntimeFixture({
  bundlePath = DEFAULT_BUNDLE_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
  const output = projectRuntimeFixture(bundle);
  const fixturePath = path.join(outputDir, "fixture.sql");
  const manifestPath = path.join(outputDir, "manifest.json");
  let actualFixture;
  let actualManifest;
  try {
    actualFixture = readFileSync(fixturePath, "utf8");
    actualManifest = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`runtime_fixture:checked_in_missing:${error.code ?? "unknown"}`);
  }
  if (actualFixture !== output.fixture) throw new Error("runtime_fixture:checked_in_fixture_stale");
  if (actualManifest !== `${JSON.stringify(output.manifest, null, 2)}\n`) throw new Error("runtime_fixture:checked_in_manifest_stale");
  return {
    ...output,
    bundlePath: path.resolve(bundlePath),
    outputDir: path.resolve(outputDir),
    fixturePath,
    manifestPath,
  };
}

function parseCli(argv) {
  const options = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--bundle" || argument === "--bundle-path") {
      options.bundlePath = argv[++index];
    } else if (argument === "--out" || argument === "--output-dir") {
      options.outputDir = argv[++index];
    } else if (argument === "--check") {
      options.check = true;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/generate-runtime-fixture.mjs [--bundle PATH] [--out DIR] [--check]\n");
      return null;
    } else {
      throw new Error(`runtime_fixture:unknown_argument:${argument}`);
    }
  }
  return options;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const options = parseCli(process.argv.slice(2));
  if (options !== null) {
    const operation = options.check ? checkRuntimeFixture : generateRuntimeFixture;
    const result = operation({
      bundlePath: options.bundlePath ?? process.env.ARENA_RUNTIME_BUNDLE_PATH ?? DEFAULT_BUNDLE_PATH,
      outputDir: options.outputDir ?? process.env.ARENA_RUNTIME_D1_DIR ?? DEFAULT_OUTPUT_DIR,
    });
    process.stdout.write(`${JSON.stringify({
      schema: result.manifest.schema,
      schemaSha256: result.manifest.schemaSha256,
      fixtureSha256: result.manifest.fixtureSha256,
      taskCount: result.manifest.taskCount,
      artifactCount: result.manifest.artifactCount,
      assignmentCount: result.manifest.assignmentCount,
      assignmentSetSha256: result.manifest.assignmentSetSha256,
      fixturePath: result.fixturePath,
      manifestPath: result.manifestPath,
    })}\n`);
  }
}
