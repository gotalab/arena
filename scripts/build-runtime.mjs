#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { scanPublicTreeSync } from "../public-contract/scan-public.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactOrigin = process.env.VITE_ARTIFACT_ORIGIN;
const productionArtifactOrigin = "https://artifacts.arena.gotalab.dev";
const loopbackArtifactOrigin = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(artifactOrigin ?? "");
if (artifactOrigin !== productionArtifactOrigin && !loopbackArtifactOrigin) throw new Error("runtime_build:artifact_origin_not_allowed");
const env = {
  ...process.env,
  VITE_PUBLIC_ARTIFACTS: "false",
  VITE_ARTIFACT_ORIGIN: artifactOrigin,
  VITE_RUNTIME_API: "true",
  VITE_WEBMCP_PROBE: process.env.VITE_WEBMCP_PROBE ?? "true",
  VITE_WEBMCP_PROBE_ARTIFACT: process.env.VITE_WEBMCP_PROBE_ARTIFACT ?? "true",
};
function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`runtime_build:${label}_failed:${result.status}`);
  }
}
run(process.execPath, ["scripts/verify-public-release.mjs"], "release_verify");
run(resolve(root, "node_modules/.bin/tsc"), ["--noEmit"], "typecheck");
run(resolve(root, "node_modules/.bin/vite"), ["build"], "vite");
run(process.execPath, ["scripts/verify-public-build.mjs"], "build_verify");
const dist = join(root, "dist/public-client");
for (const path of [join(dist, "artifacts"), join(dist, "__webmcp_probe")]) {
  if (existsSync(path)) rmSync(path, { recursive: true });
}
const scripts = readdirSync(join(dist, "assets")).filter((name) => name.endsWith(".js")).map((name) => readFileSync(join(dist, "assets", name), "utf8"));
if (!scripts.some((source) => source.includes(artifactOrigin))) throw new Error("runtime_build:artifact_origin_missing");
if (env.VITE_WEBMCP_PROBE !== "true" && scripts.some((source) => source.includes("Agent route check") || source.includes("Run the three-action contract"))) {
  throw new Error("runtime_build:main_contains_probe_ui");
}
if (existsSync(join(dist, "artifacts")) || existsSync(join(dist, "__webmcp_probe"))) throw new Error("runtime_build:main_contains_artifact_or_probe");
scanPublicTreeSync(dist, { ignoreDirectories: [], maxFileBytes: 4 * 1024 * 1024, maxTreeBytes: 32 * 1024 * 1024 });
console.log(`Built isolated Main assets for ${artifactOrigin}.`);
