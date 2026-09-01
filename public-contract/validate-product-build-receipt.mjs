const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40}$/;
const RECEIPT_KEYS = new Set([
  "schema",
  "product",
  "publicRelease",
  "webDistSha256",
  "runtime",
  "webMcpProbe",
  "licenseManifestSha256",
  "status",
]);

function fail(path, code) {
  throw new Error(`product_build_receipt:${path}:${code}`);
}

function object(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "object_required");
  return value;
}

function closed(value, keys, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${path}.${key}`, "unexpected");
  for (const key of keys) if (!(key in value)) fail(`${path}.${key}`, "required");
}

function digest(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(path, "sha256_required");
}

function gitObject(value, path) {
  if (typeof value !== "string" || !GIT_OBJECT.test(value)) fail(path, "git_object_required");
}

/** Hand-written closed validator used by both product CI and the private consumer. */
export function validateProductBuildReceipt(value) {
  closed(value, RECEIPT_KEYS, "root");
  if (value.schema !== "arena.product-build-receipt.v2") fail("schema", "unsupported");

  closed(value.product, new Set(["repository", "commit", "gitTree"]), "product");
  if (value.product.repository !== "gotalab/arena") fail("product.repository", "unsupported");
  gitObject(value.product.commit, "product.commit");
  gitObject(value.product.gitTree, "product.gitTree");

  closed(value.publicRelease, new Set(["schema", "bundleSha256", "artifactTreeSha256"]), "publicRelease");
  if (value.publicRelease.schema !== "arena.public-release.v1") fail("publicRelease.schema", "unsupported");
  digest(value.publicRelease.bundleSha256, "publicRelease.bundleSha256");
  digest(value.publicRelease.artifactTreeSha256, "publicRelease.artifactTreeSha256");

  digest(value.webDistSha256, "webDistSha256");
  closed(value.runtime, new Set(["routeContractSha256", "mainWorkerSha256", "artifactWorkerSha256", "sourceTreeSha256", "inputManifestSha256"]), "runtime");
  for (const key of ["routeContractSha256", "mainWorkerSha256", "artifactWorkerSha256", "sourceTreeSha256", "inputManifestSha256"]) {
    digest(value.runtime[key], `runtime.${key}`);
  }

  closed(value.webMcpProbe, new Set(["enabled", "artifactSha256"]), "webMcpProbe");
  if (value.webMcpProbe.enabled !== true) fail("webMcpProbe.enabled", "must_be_true");
  digest(value.webMcpProbe.artifactSha256, "webMcpProbe.artifactSha256");
  digest(value.licenseManifestSha256, "licenseManifestSha256");
  if (value.status !== "built") fail("status", "must_be_built");
  return value;
}

const INPUT_KEYS = new Set(["schema", "esbuild", "contracts", "inputs", "entryOutputPairs"]);

export function validateRuntimeInputManifest(value) {
  closed(value, INPUT_KEYS, "inputManifest");
  if (value.schema !== "arena.runtime-input-manifest.v1") fail("inputManifest.schema", "unsupported");
  closed(value.esbuild, new Set(["package", "version", "bundle", "format", "platform", "target", "sourcemap", "legalComments", "charset"]), "inputManifest.esbuild");
  if (value.esbuild.package !== "esbuild" || value.esbuild.version !== "0.28.1" || value.esbuild.format !== "esm"
    || value.esbuild.bundle !== true || value.esbuild.platform !== "browser" || value.esbuild.target !== "es2022"
    || value.esbuild.sourcemap !== false || value.esbuild.legalComments !== "none" || value.esbuild.charset !== "ascii") {
    fail("inputManifest.esbuild", "unsupported_configuration");
  }
  closed(value.contracts, new Set(["route", "routeSha256", "gameProtocol", "gameManifest", "tools"]), "inputManifest.contracts");
  if (value.contracts.route !== "src/lib/match-path.ts") fail("inputManifest.contracts.route", "unsupported");
  digest(value.contracts.routeSha256, "inputManifest.contracts.routeSha256");
  if (value.contracts.gameProtocol !== "arena.game.v1" || value.contracts.gameManifest !== "arena.game-manifest.v1") fail("inputManifest.contracts", "unsupported_version");
  if (JSON.stringify(value.contracts.tools) !== JSON.stringify(["get_game_state", "take_game_action", "restart_game"])) fail("inputManifest.contracts.tools", "unsupported");
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) fail("inputManifest.inputs", "nonempty_array_required");
  let previous = "";
  for (const [index, input] of value.inputs.entries()) {
    closed(input, new Set(["kind", "path", "sha256"]), `inputManifest.inputs[${index}]`);
    if (!['source', 'config', 'migration', 'fixture', 'generator', 'route'].includes(input.kind)) fail(`inputManifest.inputs[${index}].kind`, "unsupported");
    if (typeof input.path !== "string" || !/^[A-Za-z0-9._/-]+$/.test(input.path) || input.path.startsWith("/") || input.path.includes("..")) fail(`inputManifest.inputs[${index}].path`, "relative_path_required");
    if (input.path <= previous) fail("inputManifest.inputs", "paths_must_be_unique_and_sorted");
    previous = input.path;
    digest(input.sha256, `inputManifest.inputs[${index}].sha256`);
  }
  const expectedPairs = [
    { entry: "runtime/src/artifact.ts", output: "worker-runtime/artifact-worker.js" },
    { entry: "runtime/src/main.ts", output: "worker-runtime/main-worker.js" },
  ];
  if (JSON.stringify(value.entryOutputPairs) !== JSON.stringify(expectedPairs)) fail("inputManifest.entryOutputPairs", "unsupported");
  return value;
}
