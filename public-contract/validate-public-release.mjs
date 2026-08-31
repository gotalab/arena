export const PUBLIC_SCHEMA = "arena.public-release.v1";
export const MAX_CHECK_EXPLANATION_CHARS = 1024;
export const MAX_CHECK_METADATA_CHARS = 256;
const RUNTIME_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".mp3", ".ogg", ".wav", ".woff", ".woff2"]);
const OMIT_PATH_PARTS = new Set(["test", "tests", "__tests__"]);
const OMIT_BASENAMES = new Set(["README.md", "AGENTS.md"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
export const PROTECTED_TEXT = [
  { code: "private_path", pattern: /(?:\/Users\/|[A-Za-z]:\\Users\\|(?:pool|tasks|engine\/dist)\/)/i },
  { code: "credential", pattern: /(?:BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{16,}|\bapi[_-]?key\s*[:=])/i },
  { code: "evaluation_control", pattern: /(?:judge prompt|system prompt|promptSha256|rubric\.ya?ml|raw[_-]?log)/i },
];

// Check explanations are result-derived prose, not a second channel for the
// evaluator's structured record. These markers are checked on the projected
// string only; public catalogue controls and other legitimate contract fields
// are intentionally outside this boundary.
export const CHECK_EXPLANATION_PROTECTED_TEXT = [
  ...PROTECTED_TEXT,
  { code: "private_path", pattern: /(?:^|[\s"'`(])(?:shots|evidence|verdicts?|logs?|fixtures?|artifacts?)[\\/][^\s"'`<>)]*/i },
  { code: "evaluation_control", pattern: /(?:^|[\s"'`{,])(?:raw[_ -]?(?:evidence|reason|error|log)|reason|evidence|error|prompt|judgePrompt|systemPrompt|developerPrompt|rubric|verifier|seed|control)s?\s*["'`]?\s*[:=]/i },
  { code: "evaluation_control", pattern: /(?:^|[\s"'`{,])(?:sourcePath|privateSourcePath|trialId|configurationRef|configurationDigest|artifactSha256|promptSha256|evaluatorControl|rawLog)\s*["'`]?\s*[:=]/i },
  { code: "evaluation_control", pattern: /\bseed(?:ed|ing|s)?\b/i },
];

// Labels and groups can name a public behavior such as deterministic seeding,
// but cannot carry a concrete seed, a path, an internal field, or evaluator
// instructions. This is deliberately narrower than explanation scanning.
export const CHECK_METADATA_PROTECTED_TEXT = [
  ...PROTECTED_TEXT,
  { code: "private_path", pattern: /(?:^|[\s"'`(])(?:shots|evidence|verdicts?|logs?|fixtures?|artifacts?)[\\/][^\s"'`<>)]*/i },
  { code: "evaluation_control", pattern: /(?:^|[\s"'`{,])(?:raw[_ -]?(?:evidence|reason|error|log)|reason|evidence|error|prompt|judgePrompt|systemPrompt|developerPrompt|rubric|verifier|seed|control)s?\s*["'`]?\s*[:=]/i },
  { code: "evaluation_control", pattern: /(?:^|[\s"'`{,])(?:sourcePath|privateSourcePath|trialId|configurationRef|configurationDigest|artifactSha256|promptSha256|evaluatorControl|rawLog)\s*["'`]?\s*[:=]/i },
  { code: "evaluation_control", pattern: /\bseed(?:s)?(?:\(\s*s\s*\))?\s*(?:\(\s*\d+(?:\s*,\s*\d+)*\s*\)|[:=]?\s*\d+)/i },
];

const ALLOWED_KEYS = {
  root: new Set(["schema", "release", "blind", "catalog", "taskManifests"]),
  release: new Set(["releaseId", "taskCollection", "evaluationVersion", "costDisclosure", "tasks", "configurations", "cells", "builds", "attempts"]),
  blind: new Set(["releaseId", "configurationCount", "tasks", "builds"]),
  artifact: new Set(["sha256", "publicBase", "byteLength"]),
  task: new Set(["id", "title", "version", "presentation"]),
  blindBuild: new Set(["id", "taskId", "status", "playability", "artifact"]),
  namedBuild: new Set(["id", "taskId", "configurationId", "status", "playability", "artifact", "requirementSummary", "checks", "replica", "startedAt", "wallClockSeconds", "usage", "totalReportedTokens", "estimatedApiCost", "actualBilledCost", "meterSources", "runResult", "agentPlayEvidence"]),
  catalog: new Set(["id", "slug", "name", "image", "browseRule", "rule", "tension", "inputSummary", "controls", "presentation", "publicNarrative"]),
  manifest: new Set(["schema", "taskId", "tools", "actionSchema", "stateSchema", "resultSchema", "maxMessageBytes"]),
  agentPlayEvidence: new Set(["status", "receiptAvailable"]),
  presentation: new Set(["canonicalViewport"]),
  viewport: new Set(["width", "height"]),
  control: new Set(["keys", "label"]),
  configuration: new Set(["id", "harnessId", "harness", "harnessVersion", "model", "effort"]),
  summary: new Set(["passed", "failed", "notEvaluated", "graderErrors", "evaluated", "applicable", "rate"]),
  check: new Set(["id", "category", "lane", "group", "label", "outcome", "explanation"]),
  usage: new Set(["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_tokens"]),
  cost: new Set(["amount", "currency"]),
  meterSources: new Set(["time", "tokens", "cost"]),
  cell: new Set(["taskId", "configurationId", "showcaseBuildId", "score", "operational", "replicas"]),
  score: new Set(["mean", "ciHalfWidth", "n", "replicasCounted", "replicasNullRate", "replicasHeldInvalid", "gatesPassed", "gateFailures", "gateUnverified"]),
  operational: new Set(["runs", "time", "tokens", "estimatedCost", "costAtListPrice"]),
  mean: new Set(["mean", "reported"]),
  replica: new Set(["buildId", "replica", "showcase", "rate", "countedInMean", "passed", "applicable", "notEvaluated", "graderErrors", "gatesPassed", "gateFailures", "gateUnverified"]),
  attempt: new Set(["taskId", "configurationId", "attempted", "succeeded"]),
};

function assertClosed(record, allowed, at) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`public_schema:${at}:object_required`);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`public_schema:${at}:forbidden_field:${unexpected.sort().join(",")}`);
}

function assertObject(record, at) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`public_schema:${at}:object_required`);
}

const GAME_SCHEMA_KEYS = new Set([
  "type", "const", "enum", "oneOf", "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems", "minimum", "maximum",
  "minLength", "maxLength", "pattern",
]);

function validateGameValueSchema(record, at, depth = 0) {
  if (depth > 8) throw new Error(`public_schema:${at}:too_deep`);
  assertClosed(record, GAME_SCHEMA_KEYS, at);
  if (record.type !== undefined) {
    const types = Array.isArray(record.type) ? record.type : [record.type];
    if (!types.length || types.some((type) => !["null", "boolean", "integer", "number", "string", "array", "object"].includes(type))) {
      throw new Error(`public_schema:${at}.type:invalid`);
    }
  }
  if (record.enum !== undefined && (!Array.isArray(record.enum) || !record.enum.length)) throw new Error(`public_schema:${at}.enum:nonempty_array_required`);
  if (record.oneOf !== undefined) {
    if (!Array.isArray(record.oneOf) || !record.oneOf.length) throw new Error(`public_schema:${at}.oneOf:nonempty_array_required`);
    record.oneOf.forEach((branch, index) => validateGameValueSchema(branch, `${at}.oneOf[${index}]`, depth + 1));
  }
  if (record.properties !== undefined) {
    assertObject(record.properties, `${at}.properties`);
    for (const [key, field] of Object.entries(record.properties)) validateGameValueSchema(field, `${at}.properties.${key}`, depth + 1);
  }
  if (record.required !== undefined) {
    if (!Array.isArray(record.required) || new Set(record.required).size !== record.required.length || record.required.some((key) => typeof key !== "string")) {
      throw new Error(`public_schema:${at}.required:unique_string_array_required`);
    }
    if (record.properties && record.required.some((key) => !Object.hasOwn(record.properties, key))) throw new Error(`public_schema:${at}.required:unknown_property`);
  }
  if (record.items !== undefined) validateGameValueSchema(record.items, `${at}.items`, depth + 1);
  if (record.additionalProperties !== undefined && record.additionalProperties !== false) throw new Error(`public_schema:${at}.additionalProperties:must_be_false`);
}

function validateActionSchema(record, at) {
  assertClosed(record, new Set(["oneOf"]), at);
  if (!Array.isArray(record.oneOf) || !record.oneOf.length) throw new Error(`public_schema:${at}.oneOf:nonempty_array_required`);
  const actionTypes = new Set();
  record.oneOf.forEach((branch, index) => {
    const branchAt = `${at}.oneOf[${index}]`;
    validateGameValueSchema(branch, branchAt);
    if (branch.type !== "object" || branch.additionalProperties !== false || !branch.properties || !Array.isArray(branch.required)) {
      throw new Error(`public_schema:${branchAt}:closed_object_required`);
    }
    const actionType = branch.properties.type?.const;
    if (typeof actionType !== "string" || !branch.required.includes("type")) throw new Error(`public_schema:${branchAt}.properties.type:required_const`);
    if (actionTypes.has(actionType)) throw new Error(`public_schema:${at}:duplicate_action_type`);
    actionTypes.add(actionType);
  });
}

function validateClosedGameObjectSchema(record, at) {
  assertClosed(record, new Set(["type", "properties", "required", "additionalProperties"]), at);
  if (record.type !== undefined && record.type !== "object") throw new Error(`public_schema:${at}.type:must_be_object`);
  assertObject(record.properties, `${at}.properties`);
  if (record.additionalProperties !== false) throw new Error(`public_schema:${at}.additionalProperties:must_be_false`);
  if (record.required !== undefined) {
    if (!Array.isArray(record.required) || new Set(record.required).size !== record.required.length || record.required.some((key) => typeof key !== "string" || !Object.hasOwn(record.properties, key))) {
      throw new Error(`public_schema:${at}.required:known_unique_string_array_required`);
    }
  }
  for (const [key, field] of Object.entries(record.properties)) validateGameValueSchema(field, `${at}.properties.${key}`, 1);
}

function assertString(value, at) {
  if (typeof value !== "string" || !value) throw new Error(`public_schema:${at}:string_required`);
}

function assertEnum(value, allowed, at) {
  if (!allowed.has(value)) throw new Error(`public_schema:${at}:invalid`);
}

export function validateCheckExplanation(value, at = "check.explanation") {
  assertString(value, at);
  if (!value.trim()) throw new Error(`public_schema:${at}:string_required`);
  if ([...value].length > MAX_CHECK_EXPLANATION_CHARS) throw new Error(`public_schema:${at}:too_long`);
  for (const protectedPattern of CHECK_EXPLANATION_PROTECTED_TEXT) {
    protectedPattern.pattern.lastIndex = 0;
    if (protectedPattern.pattern.test(value)) throw new Error(`public_schema:${at}:${protectedPattern.code}`);
  }
}

export function validateCheckMetadata(value, at = "check.label") {
  assertString(value, at);
  if (!value.trim()) throw new Error(`public_schema:${at}:string_required`);
  if ([...value].length > MAX_CHECK_METADATA_CHARS) throw new Error(`public_schema:${at}:too_long`);
  for (const protectedPattern of CHECK_METADATA_PROTECTED_TEXT) {
    protectedPattern.pattern.lastIndex = 0;
    if (protectedPattern.pattern.test(value)) throw new Error(`public_schema:${at}:${protectedPattern.code}`);
  }
}

function validateArtifact(artifact, at) {
  assertClosed(artifact, ALLOWED_KEYS.artifact, at);
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) throw new Error(`public_schema:${at}.sha256:invalid`);
  if (artifact.publicBase !== `/artifacts/${artifact.sha256}/`) throw new Error(`public_schema:${at}.publicBase:invalid`);
}

function validateTask(task, at) {
  assertClosed(task, ALLOWED_KEYS.task, at);
  for (const key of ["id", "title", "version"]) assertString(task[key], `${at}.${key}`);
  assertClosed(task.presentation, ALLOWED_KEYS.presentation, `${at}.presentation`);
  assertClosed(task.presentation.canonicalViewport, ALLOWED_KEYS.viewport, `${at}.presentation.canonicalViewport`);
}

function validateOptionalClosed(record, allowed, at) {
  if (record == null) return;
  assertClosed(record, allowed, at);
}

function validateCheck(check, at) {
  assertClosed(check, ALLOWED_KEYS.check, at);
  assertString(check.id, `${at}.id`);
  assertEnum(check.category, new Set(["gate", "requirement"]), `${at}.category`);
  if (check.lane !== undefined) assertEnum(check.lane, new Set(["measured", "judged"]), `${at}.lane`);
  for (const key of ["group", "label"]) if (check[key] !== undefined) validateCheckMetadata(check[key], `${at}.${key}`);
  assertEnum(check.outcome, new Set(["pass", "fail", "not_evaluated", "grader_error"]), `${at}.outcome`);
  if (check.explanation !== undefined) validateCheckExplanation(check.explanation, `${at}.explanation`);
}

function validateBuild(build, at, named) {
  assertClosed(build, named ? ALLOWED_KEYS.namedBuild : ALLOWED_KEYS.blindBuild, at);
  if (!/^build_[a-f0-9]{20}$/.test(build.id ?? "")) throw new Error(`public_schema:${at}.id:invalid`);
  assertString(build.taskId, `${at}.taskId`);
  if (build.status !== "succeeded") throw new Error(`public_schema:${at}.status:invalid`);
  validateArtifact(build.artifact, `${at}.artifact`);
  if (named) {
    assertString(build.configurationId, `${at}.configurationId`);
    if (!Array.isArray(build.checks)) throw new Error(`public_schema:${at}.checks:array_required`);
    const checkIds = new Set();
    build.checks.forEach((check, index) => {
      validateCheck(check, `${at}.checks[${index}]`);
      if (checkIds.has(check.id)) throw new Error(`public_schema:${at}.checks:duplicate_id`);
      checkIds.add(check.id);
    });
    validateOptionalClosed(build.requirementSummary, ALLOWED_KEYS.summary, `${at}.requirementSummary`);
    validateOptionalClosed(build.usage, ALLOWED_KEYS.usage, `${at}.usage`);
    validateOptionalClosed(build.estimatedApiCost, ALLOWED_KEYS.cost, `${at}.estimatedApiCost`);
    validateOptionalClosed(build.actualBilledCost, ALLOWED_KEYS.cost, `${at}.actualBilledCost`);
    validateOptionalClosed(build.meterSources, ALLOWED_KEYS.meterSources, `${at}.meterSources`);
    if (build.agentPlayEvidence != null) {
      assertClosed(build.agentPlayEvidence, ALLOWED_KEYS.agentPlayEvidence, `${at}.agentPlayEvidence`);
      if (!["not_applicable", "not_evaluated", "failed", "passed"].includes(build.agentPlayEvidence.status)) throw new Error(`public_schema:${at}.agentPlayEvidence.status:invalid`);
      if (typeof build.agentPlayEvidence.receiptAvailable !== "boolean") throw new Error(`public_schema:${at}.agentPlayEvidence.receiptAvailable:boolean_required`);
      const shouldHaveReceipt = build.agentPlayEvidence.status === "failed" || build.agentPlayEvidence.status === "passed";
      if (build.agentPlayEvidence.receiptAvailable !== shouldHaveReceipt) throw new Error(`public_schema:${at}.agentPlayEvidence.receiptAvailable:status_mismatch`);
    }
  }
}

function validateCell(cell, at) {
  assertClosed(cell, ALLOWED_KEYS.cell, at);
  assertClosed(cell.score, ALLOWED_KEYS.score, `${at}.score`);
  assertClosed(cell.operational, ALLOWED_KEYS.operational, `${at}.operational`);
  for (const key of ["time", "tokens", "estimatedCost"]) assertClosed(cell.operational[key], ALLOWED_KEYS.mean, `${at}.operational.${key}`);
  if (!Array.isArray(cell.replicas)) throw new Error(`public_schema:${at}.replicas:array_required`);
  cell.replicas.forEach((replica, index) => assertClosed(replica, ALLOWED_KEYS.replica, `${at}.replicas[${index}]`));
}

export function validatePublicBundle(bundle) {
  assertClosed(bundle, ALLOWED_KEYS.root, "root");
  if (bundle.schema !== PUBLIC_SCHEMA) throw new Error("public_schema:root.schema:invalid");
  assertClosed(bundle.release, ALLOWED_KEYS.release, "release");
  assertClosed(bundle.blind, ALLOWED_KEYS.blind, "blind");
  for (const key of ["releaseId", "evaluationVersion"]) assertString(bundle.release[key], `release.${key}`);
  assertString(bundle.blind.releaseId, "blind.releaseId");
  if (bundle.release.releaseId !== bundle.blind.releaseId) throw new Error("public_schema:release_id:mismatch");
  for (const [at, tasks] of [["release.tasks", bundle.release.tasks], ["blind.tasks", bundle.blind.tasks]]) {
    if (!Array.isArray(tasks)) throw new Error(`public_schema:${at}:array_required`);
    tasks.forEach((task, index) => validateTask(task, `${at}[${index}]`));
  }
  if (!Array.isArray(bundle.release.builds) || !Array.isArray(bundle.blind.builds)) throw new Error("public_schema:builds:array_required");
  bundle.release.builds.forEach((build, index) => validateBuild(build, `release.builds[${index}]`, true));
  bundle.blind.builds.forEach((build, index) => validateBuild(build, `blind.builds[${index}]`, false));
  if (!Array.isArray(bundle.release.configurations) || !Array.isArray(bundle.release.cells) || !Array.isArray(bundle.release.attempts)) throw new Error("public_schema:release_arrays:required");
  bundle.release.configurations.forEach((configuration, index) => assertClosed(configuration, ALLOWED_KEYS.configuration, `release.configurations[${index}]`));
  bundle.release.cells.forEach((cell, index) => validateCell(cell, `release.cells[${index}]`));
  bundle.release.attempts.forEach((attempt, index) => assertClosed(attempt, ALLOWED_KEYS.attempt, `release.attempts[${index}]`));
  if (!Array.isArray(bundle.catalog)) throw new Error("public_schema:catalog:array_required");
  bundle.catalog.forEach((task, index) => {
    assertClosed(task, ALLOWED_KEYS.catalog, `catalog[${index}]`);
    for (const key of ["id", "slug", "name", "image", "browseRule", "rule", "tension", "inputSummary", "publicNarrative"]) assertString(task[key], `catalog[${index}].${key}`);
    validateTask({ id: task.id, title: task.name, version: "public", presentation: task.presentation }, `catalog[${index}]`);
    if (!Array.isArray(task.controls)) throw new Error(`public_schema:catalog[${index}].controls:array_required`);
    task.controls.forEach((control, controlIndex) => assertClosed(control, ALLOWED_KEYS.control, `catalog[${index}].controls[${controlIndex}]`));
  });
  if (!Array.isArray(bundle.taskManifests)) throw new Error("public_schema:taskManifests:array_required");
  const publicTaskIds = new Set(bundle.release.tasks.map((task) => task.id));
  const manifestTaskIds = new Set();
  bundle.taskManifests.forEach((manifest, index) => {
    assertClosed(manifest, ALLOWED_KEYS.manifest, `taskManifests[${index}]`);
    if (manifest.schema !== "arena.game-manifest.v1") throw new Error(`public_schema:taskManifests[${index}].schema:invalid`);
    assertString(manifest.taskId, `taskManifests[${index}].taskId`);
    if (!publicTaskIds.has(manifest.taskId)) throw new Error(`public_schema:taskManifests[${index}].taskId:not_public`);
    if (manifestTaskIds.has(manifest.taskId)) throw new Error(`public_schema:taskManifests[${index}].taskId:duplicate`);
    manifestTaskIds.add(manifest.taskId);
    if (!Array.isArray(manifest.tools) || new Set(manifest.tools).size !== manifest.tools.length) throw new Error(`public_schema:taskManifests[${index}].tools:unique_array_required`);
    if (!manifest.tools.includes("get_game_state") || !manifest.tools.includes("take_game_action")) throw new Error(`public_schema:taskManifests[${index}].tools:core_tools_required`);
    if (manifest.tools.some((tool) => !["get_game_state", "take_game_action", "restart_game"].includes(tool))) throw new Error(`public_schema:taskManifests[${index}].tools:invalid`);
    validateActionSchema(manifest.actionSchema, `taskManifests[${index}].actionSchema`);
    validateClosedGameObjectSchema(manifest.stateSchema, `taskManifests[${index}].stateSchema`);
    validateClosedGameObjectSchema(manifest.resultSchema, `taskManifests[${index}].resultSchema`);
    if (!Number.isSafeInteger(manifest.maxMessageBytes) || manifest.maxMessageBytes < 1024 || manifest.maxMessageBytes > 65536) throw new Error(`public_schema:taskManifests[${index}].maxMessageBytes:invalid`);
  });
  bundle.release.builds.forEach((build, index) => {
    const hasManifest = manifestTaskIds.has(build.taskId);
    const status = build.agentPlayEvidence?.status ?? (hasManifest ? "not_evaluated" : "not_applicable");
    if (hasManifest && status === "not_applicable") throw new Error(`public_schema:release.builds[${index}].agentPlayEvidence:manifest_status_mismatch`);
    if (!hasManifest && status !== "not_applicable") throw new Error(`public_schema:release.builds[${index}].agentPlayEvidence:manifest_status_mismatch`);
  });
  const serialized = JSON.stringify(bundle);
  for (const protectedPattern of PROTECTED_TEXT) {
    if (protectedPattern.pattern.test(serialized)) throw new Error(`public_schema:bundle:${protectedPattern.code}`);
  }
  return bundle;
}
