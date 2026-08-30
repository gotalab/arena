import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("full runtime build disables same-origin Artifacts and enables the API", () => {
  const config = read("../vite.config.mjs");
  const env = read("../src/platform/env.ts");
  const api = read("../src/lib/api.ts");
  const launcher = read("../scripts/dev-runtime.mjs");
  const wrapper = read("../scripts/dev-runtime.sh");
  const productBuilder = read("../scripts/build-product-runtime.mjs");
  assert.match(config, /VITE_PUBLIC_ARTIFACTS/);
  assert.match(config, /embedPublicArtifacts/);
  assert.match(config, /VITE_RUNTIME_API/);
  assert.match(env, /CONFIGURED_ARTIFACT_ORIGIN/);
  assert.match(env, /usesRuntimeApi/);
  assert.match(api, /if \(!usesRuntimeApi\(\)\) return/);
  for (const value of ["VITE_PUBLIC_ARTIFACTS", "VITE_ARTIFACT_ORIGIN", "VITE_RUNTIME_API", "VITE_WEBMCP_PROBE", "VITE_WEBMCP_PROBE_ARTIFACT"]) assert.match(launcher, new RegExp(value));
  assert.match(wrapper, /trap cleanup EXIT/);
  assert.match(wrapper, /ARENA_RUNTIME_SCRATCH/);
  assert.match(productBuilder, /https:\/\/artifacts\.arena\.gotalab\.dev/);
  assert.match(productBuilder, /loopback_artifact_origin_present/);
});

test("runtime launcher isolates secrets and requires exact Wrangler version", () => {
  const launcher = read("../scripts/dev-runtime.mjs");
  assert.match(launcher, /wranglerVersion = "4\.127\.1"/);
  assert.match(launcher, /randomBytes\(32\)/);
  assert.match(launcher, /allowedEnvironmentKeys/);
  assert.match(launcher, /environment_isolation_failed/);
  assert.match(launcher, /arena-runtime-/);
  assert.match(launcher, /--persist-to/);
  assert.match(launcher, /mainStateRoot/);
  assert.match(launcher, /artifactStateRoot/);
  assert.match(launcher, /--inspector-port/);
  assert.match(launcher, /foreground process group/);
  assert.match(launcher, /process\.once\("exit"/);
  assert.match(launcher, /stopForSignal/);
  assert.match(launcher, /port_in_use/);
  assert.match(launcher, /canonicalDirectorySha256\(probe\)/);
  assert.match(launcher, /artifact-assets/);
  assert.match(launcher, /smoke_choice_first/);
  assert.match(launcher, /duplicateAppend/);
  assert.match(launcher, /forgedToken/);
  assert.match(launcher, /--negative-secrets=/);
  assert.match(launcher, /d1_foreign_key/);
  assert.match(launcher, /SELECT COUNT\(\*\) AS n FROM blind_choices/);
});
