import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { canonicalDirectorySha256, scanPublicTree } from "../public-contract/scan-public.mjs";

const root = new URL("..", import.meta.url);
const licenseScript = new URL("../scripts/verify-public-license.mjs", import.meta.url);
const hackathonScript = new URL("../scripts/verify-hackathon.mjs", import.meta.url);

function run(script, env = {}) {
  return spawnSync(process.execPath, [script.pathname], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("checked public license and hackathon evidence pass", () => {
  assert.equal(run(licenseScript).status, 0);
  assert.equal(run(hackathonScript).status, 0);
  const workflow = readFileSync(new URL("../.github/workflows/verify.yml", import.meta.url), "utf8");
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.doesNotMatch(workflow, /\bnpm (?:ci|install|run|test|audit)\b/);
});

test("stale license manifest and an unknown package license fail closed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-license-test-"));
  const staleManifest = join(scratch, "manifest.json");
  const notices = join(scratch, "notices.md");
  writeFileSync(staleManifest, `${readFileSync(new URL("../public-license-manifest.v1.json", import.meta.url), "utf8")}\n`);
  writeFileSync(notices, readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url)));
  const stale = run(licenseScript, { ARENA_LICENSE_MANIFEST: staleManifest, ARENA_LICENSE_NOTICES: notices });
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /license_manifest:stale/);

  const manifest = JSON.parse(readFileSync(new URL("../public-license-manifest.v1.json", import.meta.url), "utf8"));
  const react = manifest.packages.find((entry) => entry.name === "react");
  react.license = "UNKNOWN";
  const badManifest = join(scratch, "bad-manifest.json");
  writeFileSync(badManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const unknown = run(licenseScript, { ARENA_LICENSE_MANIFEST: badManifest });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /license_manifest:package_license:react:UNKNOWN/);

  react.license = "GPL-3.0-only";
  writeFileSync(badManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const forbidden = run(licenseScript, { ARENA_LICENSE_MANIFEST: badManifest });
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /license_manifest:package_license:react:GPL-3\.0-only/);

  const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const badLock = join(scratch, "pnpm-lock.yaml");
  writeFileSync(badLock, lock.replace(/(react@19\.2\.0:\n    resolution: \{integrity: )sha512-/, "$1sha1-"));
  const badIntegrity = run(licenseScript, { ARENA_PNPM_LOCK: badLock });
  assert.notEqual(badIntegrity.status, 0);
  assert.match(badIntegrity.stderr, /license_manifest:pnpm_package_set/);

  writeFileSync(staleManifest, readFileSync(new URL("../public-license-manifest.v1.json", import.meta.url)));
  writeFileSync(notices, `${readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8")}stale\n`);
  const staleNotices = run(licenseScript, { ARENA_LICENSE_MANIFEST: staleManifest, ARENA_LICENSE_NOTICES: notices });
  assert.notEqual(staleNotices.status, 0);
  assert.match(staleNotices.stderr, /license_notices:stale/);

  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  packageJson.license = "ISC";
  const badPackageJson = join(scratch, "package.json");
  writeFileSync(badPackageJson, `${JSON.stringify(packageJson, null, 2)}\n`);
  const rootMetadata = run(licenseScript, { ARENA_PACKAGE_JSON: badPackageJson });
  assert.notEqual(rootMetadata.status, 0);
  assert.match(rootMetadata.stderr, /license_manifest:root_package_metadata/);

  packageJson.license = "MIT";
  packageJson.packageManager = "pnpm@10.20.1";
  writeFileSync(badPackageJson, `${JSON.stringify(packageJson, null, 2)}\n`);
  const packageManager = run(licenseScript, { ARENA_PACKAGE_JSON: badPackageJson });
  assert.notEqual(packageManager.status, 0);
  assert.match(packageManager.stderr, /license_manifest:root_package_metadata/);

  const badWorkspace = join(scratch, "pnpm-workspace.yaml");
  writeFileSync(badWorkspace, readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8").replace("minimumReleaseAge: 1440", "minimumReleaseAge: 0"));
  const policy = run(licenseScript, { ARENA_PNPM_WORKSPACE: badWorkspace });
  assert.notEqual(policy.status, 0);
  assert.match(policy.stderr, /license_manifest:pnpm_policy/);

  const attestations = JSON.parse(readFileSync(new URL("../artifact-redistribution-attestations.v1.json", import.meta.url), "utf8"));
  attestations.artifacts.pop();
  const incompleteAttestations = join(scratch, "attestations.json");
  writeFileSync(incompleteAttestations, `${JSON.stringify(attestations, null, 2)}\n`);
  const missingAttestation = run(licenseScript, { ARENA_ARTIFACT_ATTESTATIONS: incompleteAttestations });
  assert.notEqual(missingAttestation.status, 0);
  assert.match(missingAttestation.stderr, /artifact_attestation_(mismatch|set_mismatch)/);
});

test("missing assets and invalid Artifact trees fail closed", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-license-tree-test-"));
  const assets = join(scratch, "assets");
  cpSync(new URL("../public/assets", import.meta.url), assets, { recursive: true });
  rmSync(join(assets, "mark/favicon.svg"));
  const missingAsset = run(licenseScript, { ARENA_ASSETS_ROOT: assets });
  assert.notEqual(missingAsset.status, 0);
  assert.match(missingAsset.stderr, /license_manifest:asset_set_mismatch/);

  const mismatchedRoot = join(scratch, "bad-artifacts");
  mkdirSync(join(mismatchedRoot, "a".repeat(64)), { recursive: true });
  writeFileSync(join(mismatchedRoot, "a".repeat(64), "index.html"), "<!doctype html>");
  const badHash = run(licenseScript, { ARENA_ARTIFACTS_ROOT: mismatchedRoot });
  assert.notEqual(badHash.status, 0);
  assert.match(badHash.stderr, /license_manifest:artifact_hash_mismatch/);

  const externalRoot = join(scratch, "external-artifacts");
  const stage = join(externalRoot, "stage");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "index.html"), "<!doctype html><script src='https://example.com/game.js'></script>");
  const digest = canonicalDirectorySha256(stage);
  renameSync(stage, join(externalRoot, digest));
  const external = run(licenseScript, { ARENA_ARTIFACTS_ROOT: externalRoot });
  assert.notEqual(external.status, 0);
  assert.match(external.stderr, /license_manifest:artifact_external_reference/);
});

test("hackathon evidence rejects protected text and a false cutoff", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-hackathon-test-"));
  const original = readFileSync(new URL("../HACKATHON.md", import.meta.url), "utf8");
  const protectedFile = join(scratch, "protected.md");
  writeFileSync(protectedFile, `${original}\n/Users/private/evidence`);
  const protectedResult = run(hackathonScript, { ARENA_HACKATHON_FILE: protectedFile });
  assert.notEqual(protectedResult.status, 0);
  assert.match(protectedResult.stderr, /hackathon_evidence:protected_text/);

  const badDateFile = join(scratch, "bad-date.md");
  const badCommittedAt = "2026-08-27T19:42:49+09:00";
  const badAttestation = createHash("sha256").update(JSON.stringify({
    commit: "c0e9be3ecca5f4918579ae23d13af792af3dfe16",
    committedAt: badCommittedAt,
    gitTree: "76e94fae23a7df20e6e50e7d3ef327eb276a4074",
    pathSetSha256: "f284da34cb306002c6fecfbe778c8dfaff1ebd427f79bb3d866b4b87de6b45b1",
  })).digest("hex");
  writeFileSync(badDateFile, original
    .replace("2026-08-25T19:42:49+09:00", badCommittedAt)
    .replace("7f6abca3f3abb64289aed5b973cc256c27ff154742bd72a751e99125e5bbf5a7", badAttestation));
  const badDate = run(hackathonScript, { ARENA_HACKATHON_FILE: badDateFile });
  assert.notEqual(badDate.status, 0);
  assert.match(badDate.stderr, /hackathon_evidence:baseline_date/);

  const falseHistoryFile = join(scratch, "false-history.md");
  writeFileSync(falseHistoryFile, original.replace(/"firstPublicCommit": "[a-f0-9]{40}"/, '"firstPublicCommit": "ffffffffffffffffffffffffffffffffffffffff"'));
  const falseHistory = run(hackathonScript, { ARENA_HACKATHON_FILE: falseHistoryFile });
  assert.notEqual(falseHistory.status, 0);
  assert.match(falseHistory.stderr, /challenge_path_preexisting|challenge_path_history/);
});

test("reachable Git history containing a private path is rejected", async () => {
  const repository = mkdtempSync(join(tmpdir(), "arena-license-history-"));
  execFileSync("git", ["-C", repository, "init", "-q"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "fixture"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.com"]);
  const privateValue = ["", "Users", "secret", "eval.json"].join("/");
  writeFileSync(join(repository, "leak.txt"), privateValue);
  execFileSync("git", ["-C", repository, "add", "leak.txt"]);
  execFileSync("git", ["-C", repository, "commit", "-qm", "plant leak"]);
  rmSync(join(repository, "leak.txt"));
  execFileSync("git", ["-C", repository, "add", "-u"]);
  execFileSync("git", ["-C", repository, "commit", "-qm", "hide leak"]);
  await assert.rejects(scanPublicTree(repository, { includeGitBlobs: true }), /private_path/);
});

test("Access fixtures use reserved example identifiers", () => {
  const accessSource = readFileSync(new URL("../runtime/test/unit/access.test.ts", import.meta.url), "utf8");
  assert.match(accessSource, /owner@example\.com/);
  assert.match(accessSource, /example\.cloudflareaccess\.com/);
});
