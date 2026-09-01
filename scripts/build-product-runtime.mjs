#!/usr/bin/env node
import { build, version as esbuildVersion } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { canonicalDirectorySha256, scanPublicTreeSync } from "../public-contract/scan-public.mjs";
import { validateProductBuildReceipt, validateRuntimeInputManifest } from "../public-contract/validate-product-build-receipt.mjs";

const root = resolve(import.meta.dirname, "..");
const productionArtifactOrigin = "https://artifacts.arena.gotalab.dev";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha = (path) => sha(readFileSync(path));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function filesUnder(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`product_runtime:special_file:${relative(root, path)}`);
    }
  };
  walk(directory);
  return files;
}

function inputManifest() {
  const kinds = new Map([
    ["src/lib/match-path.ts", "route"],
    ["runtime/d1/0001_runtime.sql", "migration"],
    ["runtime/d1/fixture.sql", "fixture"],
    ["scripts/generate-runtime-fixture.mjs", "generator"],
    ["runtime/wrangler.main.jsonc", "config"],
    ["runtime/wrangler.artifact.jsonc", "config"],
    ["scripts/build-product-runtime.mjs", "config"],
    ["package.json", "config"],
    ["pnpm-lock.yaml", "config"],
    ["pnpm-workspace.yaml", "config"],
  ]);
  for (const path of filesUnder(join(root, "runtime/src"))) kinds.set(relative(root, path), "source");
  const inputs = [...kinds].sort(([a], [b]) => a.localeCompare(b)).map(([path, kind]) => ({ kind, path, sha256: fileSha(join(root, path)) }));
  return validateRuntimeInputManifest({
    schema: "arena.runtime-input-manifest.v1",
    esbuild: { package: "esbuild", version: "0.28.1", bundle: true, format: "esm", platform: "browser", target: "es2022", sourcemap: false, legalComments: "none", charset: "ascii" },
    contracts: { route: "src/lib/match-path.ts", routeSha256: fileSha(join(root, "src/lib/match-path.ts")), gameProtocol: "arena.game.v1", gameManifest: "arena.game-manifest.v1", tools: ["get_game_state", "take_game_action", "restart_game"] },
    inputs,
    entryOutputPairs: [
      { entry: "runtime/src/artifact.ts", output: "worker-runtime/artifact-worker.js" },
      { entry: "runtime/src/main.ts", output: "worker-runtime/main-worker.js" },
    ],
  });
}

export function verifyProductRuntimeOutput(outputRoot) {
  const output = resolve(outputRoot);
  if (git("status", "--porcelain")) throw new Error("product_runtime:dirty_checkout");
  if (esbuildVersion !== "0.28.1") throw new Error(`product_runtime:esbuild_version:${esbuildVersion}`);
  const receipt = validateProductBuildReceipt(JSON.parse(readFileSync(join(output, "product-build-receipt.json"), "utf8")));
  const manifestBytes = readFileSync(join(output, "runtime-input-manifest.json"));
  const manifest = validateRuntimeInputManifest(JSON.parse(manifestBytes));
  const expectedManifest = inputManifest();
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw new Error("product_runtime:input_manifest_mismatch");
  const sourceTreeSha256 = sha(Buffer.from(manifest.inputs.map((entry) => `${entry.path}\0${entry.sha256}\n`).join("")));
  const checks = [
    [receipt.webDistSha256, canonicalDirectorySha256(join(output, "web-dist")), "web_dist"],
    [receipt.runtime.mainWorkerSha256, fileSha(join(output, "worker-runtime/main-worker.js")), "main_worker"],
    [receipt.runtime.artifactWorkerSha256, fileSha(join(output, "worker-runtime/artifact-worker.js")), "artifact_worker"],
    [receipt.runtime.inputManifestSha256, sha(manifestBytes), "input_manifest"],
    [receipt.runtime.sourceTreeSha256, sourceTreeSha256, "source_tree"],
    [receipt.runtime.routeContractSha256, manifest.contracts.routeSha256, "route_contract"],
    [receipt.webMcpProbe.artifactSha256, canonicalDirectorySha256(join(output, "webmcp-probe-artifact")), "probe"],
    [receipt.publicRelease.bundleSha256, fileSha(join(root, "public-release/accepted/bundle.json")), "public_bundle"],
    [receipt.publicRelease.artifactTreeSha256, canonicalDirectorySha256(join(root, "public-release/accepted/artifacts")), "artifact_tree"],
    [receipt.licenseManifestSha256, fileSha(join(root, "public-license-manifest.v1.json")), "license_manifest"],
  ];
  for (const [expected, actual, label] of checks) if (expected !== actual) throw new Error(`product_runtime:${label}_mismatch`);
  const webScripts = filesUnder(join(output, "web-dist/assets")).filter((path) => path.endsWith(".js")).map((path) => readFileSync(path, "utf8"));
  if (!webScripts.some((source) => source.includes(productionArtifactOrigin))) throw new Error("product_runtime:production_artifact_origin_missing");
  if (webScripts.some((source) => /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):8788/.test(source))) throw new Error("product_runtime:loopback_artifact_origin_present");
  for (const input of manifest.inputs) if (fileSha(join(root, input.path)) !== input.sha256) throw new Error(`product_runtime:input_mismatch:${input.path}`);
  if (receipt.product.commit !== git("rev-parse", "HEAD") || receipt.product.gitTree !== git("rev-parse", "HEAD^{tree}")) throw new Error("product_runtime:revision_mismatch");
  return receipt;
}

export async function buildProductRuntime(outputRoot) {
  const output = resolve(outputRoot);
  if (existsSync(output)) throw new Error("product_runtime:output_exists");
  if (git("status", "--porcelain")) throw new Error("product_runtime:dirty_checkout");
  const commit = git("rev-parse", "HEAD");
  const gitTree = git("rev-parse", "HEAD^{tree}");
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, `.${basename(output)}-`));
  try {
    const manifest = inputManifest();
    const workerRoot = join(stage, "worker-runtime");
    mkdirSync(workerRoot);
    const { package: _package, version: _version, ...buildConfiguration } = manifest.esbuild;
    const common = { ...buildConfiguration, logLevel: "silent" };
    await build({ ...common, entryPoints: [join(root, "runtime/src/main.ts")], outfile: join(workerRoot, "main-worker.js") });
    await build({ ...common, entryPoints: [join(root, "runtime/src/artifact.ts")], outfile: join(workerRoot, "artifact-worker.js") });
    for (const name of ["main-worker.js", "artifact-worker.js"]) {
      if (statSync(join(workerRoot, name)).size === 0) throw new Error(`product_runtime:empty_worker:${name}`);
    }
    execFileSync(process.execPath, ["scripts/build-runtime.mjs"], {
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        VITE_ARTIFACT_ORIGIN: productionArtifactOrigin,
        VITE_WEBMCP_PROBE: "false",
        VITE_WEBMCP_PROBE_ARTIFACT: "false",
      },
      stdio: "inherit",
    });
    cpSync(join(root, "dist/public-client"), join(stage, "web-dist"), { recursive: true });
    cpSync(join(root, "public/__webmcp_probe"), join(stage, "webmcp-probe-artifact"), { recursive: true });
    const manifestBytes = json(manifest);
    writeFileSync(join(stage, "runtime-input-manifest.json"), manifestBytes);
    const bundle = JSON.parse(readFileSync(join(root, "public-release/accepted/bundle.json"), "utf8"));
    const sourceTreeSha256 = sha(Buffer.from(manifest.inputs.map((entry) => `${entry.path}\0${entry.sha256}\n`).join("")));
    const receipt = validateProductBuildReceipt({
      schema: "arena.product-build-receipt.v2",
      product: { repository: "gotalab/arena", commit, gitTree },
      publicRelease: { schema: bundle.schema, bundleSha256: fileSha(join(root, "public-release/accepted/bundle.json")), artifactTreeSha256: canonicalDirectorySha256(join(root, "public-release/accepted/artifacts")) },
      webDistSha256: canonicalDirectorySha256(join(stage, "web-dist")),
      runtime: { routeContractSha256: manifest.contracts.routeSha256, mainWorkerSha256: fileSha(join(workerRoot, "main-worker.js")), artifactWorkerSha256: fileSha(join(workerRoot, "artifact-worker.js")), sourceTreeSha256, inputManifestSha256: sha(Buffer.from(manifestBytes)) },
      webMcpProbe: { enabled: true, artifactSha256: canonicalDirectorySha256(join(stage, "webmcp-probe-artifact")) },
      licenseManifestSha256: fileSha(join(root, "public-license-manifest.v1.json")),
      status: "built",
    });
    writeFileSync(join(stage, "product-build-receipt.json"), json(receipt));
    scanPublicTreeSync(stage, { ignoreDirectories: [], trustedPolicyFiles: ["product-build-receipt.json"] });
    verifyProductRuntimeOutput(stage);
    if (git("rev-parse", "HEAD") !== commit || git("rev-parse", "HEAD^{tree}") !== gitTree || git("status", "--porcelain")) throw new Error("product_runtime:checkout_moved");
    renameSync(stage, output);
    return receipt;
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const verifyIndex = process.argv.indexOf("--verify");
  if (verifyIndex >= 0 && process.argv[verifyIndex + 1]) {
    console.log(JSON.stringify(verifyProductRuntimeOutput(process.argv[verifyIndex + 1])));
    process.exit(0);
  }
  const index = process.argv.indexOf("--output");
  if (index < 0 || !process.argv[index + 1]) throw new Error("product_runtime:output_required");
  const receipt = await buildProductRuntime(process.argv[index + 1]);
  console.log(JSON.stringify(receipt));
}
