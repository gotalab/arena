import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { canonicalDirectorySha256 } from "../public-contract/scan-public.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(process.env.ARENA_LICENSE_MANIFEST ?? join(root, "public-license-manifest.v1.json"));
const noticesPath = resolve(process.env.ARENA_LICENSE_NOTICES ?? join(root, "THIRD_PARTY_NOTICES.md"));
const pnpmLockPath = resolve(process.env.ARENA_PNPM_LOCK ?? join(root, "pnpm-lock.yaml"));
const pnpmWorkspacePath = resolve(process.env.ARENA_PNPM_WORKSPACE ?? join(root, "pnpm-workspace.yaml"));
const packageJsonPath = resolve(process.env.ARENA_PACKAGE_JSON ?? join(root, "package.json"));
const licensePath = resolve(process.env.ARENA_LICENSE_FILE ?? join(root, "LICENSE"));
const assetsRoot = resolve(process.env.ARENA_ASSETS_ROOT ?? join(root, "public/assets"));
const acceptedArtifactsRoot = resolve(process.env.ARENA_ARTIFACTS_ROOT ?? join(root, "public-release/accepted/artifacts"));
const artifactAttestationsPath = resolve(process.env.ARENA_ARTIFACT_ATTESTATIONS ?? join(root, "artifact-redistribution-attestations.v1.json"));
const write = process.argv.includes("--write");
const ALLOWED_PACKAGE_LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
]);
const ARTIFACT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".mjs"]);
const EXTERNAL_REFERENCE = /https?:\/\/(?!localhost(?::(?:\d+|\$\{[A-Za-z_][A-Za-z0-9_]*\}))?(?:[\s/'"`]|$)|127\.0\.0\.1(?::\d+)?(?:[\s/'"]|$)|www\.w3\.org\/2000\/svg)[^\s"'`)<>]+/i;
const RIGHTS_MARKER = /\b(?:copyright|all rights reserved|licensed? under|spdx-license-identifier)\b/i;
const MIT_LICENSE = `MIT License

Copyright (c) 2026 Gota

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const PNPM_POLICY = `minimumReleaseAge: 1440
# This exact type snapshot was already reviewed and locked before the policy was
# enabled; only that version bypasses the age gate.
minimumReleaseAgeExclude:
  - "@cloudflare/workers-types@5.20260830.1"
saveExact: true
strictPeerDependencies: true
strictStorePkgContentCheck: true
verifyStoreIntegrity: true
`;

const assetPolicies = {
  "public/assets/games/delve-jacket.webp": owned("Arena DELVE jacket", "Owner-directed Arena artwork created in the private product history"),
  "public/assets/games/ember-jacket.webp": owned("Arena EMBER jacket", "Owner-directed Arena artwork created in the private product history"),
  "public/assets/games/lastwatch-jacket.webp": owned("Arena LAST WATCH jacket", "Owner-directed Arena artwork created in the private product history"),
  "public/assets/games/lumen-yard-jacket.webp": owned("Arena LUMEN YARD jacket", "Owner-directed original Arena artwork generated for the public product"),
  "public/assets/games/shoal-jacket.webp": owned("Arena SHOAL jacket", "Owner-directed original Arena artwork generated for the public product"),
  "public/assets/games/stomp-jacket.webp": owned("Arena STOMP jacket", "Owner-directed Arena artwork created in the private product history"),
  "public/assets/mark/favicon.svg": owned("Arena favicon"),
  "public/assets/mark/playable.svg": owned("Arena playable mark"),
  "public/assets/og/default.png": owned("Arena social preview"),
  "public/assets/marks/README.md": owned("Brand-asset provenance notes"),
  "public/assets/marks/cursor.svg": brand("Cursor", "https://cursor.com/brand", "Cursor 2D Cube light"),
  "public/assets/marks/cursor-on-dark.svg": brand("Cursor", "https://cursor.com/brand", "Cursor 2D Cube dark"),
  "public/assets/marks/claude.svg": brand("Anthropic", "https://www.anthropic.com/news/media-assets", "Claude Spark Clay"),
  "public/assets/marks/openai.svg": brand("OpenAI", "https://openai.com/brand/", "OpenAI Blossom black"),
  "public/assets/marks/openai-on-dark.svg": brand("OpenAI", "https://openai.com/brand/", "OpenAI Blossom white"),
  "public/assets/marks/antigravity.png": brand("Google", "https://antigravity.google/press", "Antigravity one-color icon"),
  "public/assets/marks/antigravity-on-dark.png": brand("Google", "https://antigravity.google/press", "Antigravity white icon"),
  "public/assets/marks/opencode.svg": brand("OpenCode", "https://opencode.ai/brand", "OpenCode light-surface mark"),
  "public/assets/marks/opencode-on-dark.svg": brand("OpenCode", "https://opencode.ai/brand", "OpenCode dark-surface mark"),
  "public/assets/marks/pi.svg": brand("pi.dev", "https://pi.dev/favicon.svg", "pi.dev favicon"),
};

function owned(description, basis = "Owner-authored Arena asset") {
  return { kind: "owned", owner: "Gota", source: "Created for Arena", license: "MIT", mitApplies: true, attestationBasis: basis, notice: description };
}

function brand(owner, source, notice) {
  return { kind: "brand_asset", owner, source, license: "Brand asset / trademark", mitApplies: false, notice };
}

const artifactExternalTools = [
  { package: "playwright", license: "Apache-2.0", source: "https://registry.npmjs.org/playwright", usage: "distributed author test source; not installed or required at runtime" },
  { package: "@napi-rs/canvas", license: "MIT", source: "https://registry.npmjs.org/@napi-rs/canvas", usage: "distributed author screenshot helper source; not installed or required at runtime" },
  { package: "dejavu-fonts-ttf", license: "Bitstream Vera / Arev font terms", source: "https://github.com/senotrusov/dejavu-fonts-ttf", usage: "path reference in distributed author screenshot helper; font bytes are not distributed or required at runtime" },
];

const embeddedSources = [
  { name: "@gotalab/runes subset", sourceCommit: "35e39b6084df60181133c40a04f2da4bc6c16014", subsetSha256: "2e77a1c83a0742885aedeb85affeca855bd89a286ba541385558afd545c50bf4", license: "MIT", path: "src/lib/runes.ts" },
  { name: "GitHub mark from Primer Octicons", sourceCommit: "0e21a4c2d8449102f10e533d241f04797af0914c", subsetSha256: "bce494189797623c34e39a41c2c38a132bdca23ce4e6ac06b70116ed7e91ce26", license: "GitHub logo / trademark", path: "src/components/GitHubMark.tsx" },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function filesUnder(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(directory);
  return files;
}

function yamlScalar(value) {
  const scalar = value.trim();
  if (scalar.startsWith("'") && scalar.endsWith("'")) return scalar.slice(1, -1).replaceAll("''", "'");
  if (scalar.startsWith('"') && scalar.endsWith('"')) return JSON.parse(scalar);
  return scalar;
}

function parsePackageKey(key) {
  if (key.includes("(")) throw new Error(`license_manifest:pnpm_package_key:${key}`);
  const separator = key.lastIndexOf("@");
  if (separator <= 0 || separator === key.length - 1) throw new Error(`license_manifest:pnpm_package_key:${key}`);
  return { name: key.slice(0, separator), version: key.slice(separator + 1) };
}

function parsePnpmLock(bytes) {
  const text = bytes.toString("utf8");
  if (!/^lockfileVersion: '9\.0'$/m.test(text)) throw new Error("license_manifest:pnpm_lock_version");
  const importerStart = text.indexOf("\nimporters:\n");
  const packagesStart = text.indexOf("\npackages:\n");
  const snapshotsStart = text.indexOf("\nsnapshots:\n");
  if (importerStart < 0 || packagesStart < importerStart || snapshotsStart < packagesStart) throw new Error("license_manifest:pnpm_lock_sections");

  const importerLines = text.slice(importerStart + "\nimporters:\n".length, packagesStart).split("\n");
  if (!importerLines.includes("  .:")) throw new Error("license_manifest:pnpm_root_importer");
  const importer = { dependencies: {}, devDependencies: {} };
  let group;
  let dependency;
  for (const line of importerLines.slice(importerLines.indexOf("  .:") + 1)) {
    const groupMatch = line.match(/^    (dependencies|devDependencies):$/);
    if (groupMatch) {
      group = groupMatch[1];
      dependency = undefined;
      continue;
    }
    const dependencyMatch = line.match(/^      (.+):$/);
    if (dependencyMatch && group) {
      dependency = yamlScalar(dependencyMatch[1]);
      continue;
    }
    const specifierMatch = line.match(/^        specifier: (.+)$/);
    if (specifierMatch && group && dependency) importer[group][dependency] = yamlScalar(specifierMatch[1]);
  }

  const packageLines = text.slice(packagesStart + "\npackages:\n".length, snapshotsStart).split("\n");
  const packages = [];
  let current;
  for (const line of packageLines) {
    const packageMatch = line.match(/^  (\S.*):$/);
    if (packageMatch) {
      if (current) packages.push(current);
      const key = yamlScalar(packageMatch[1]);
      current = { key, ...parsePackageKey(key) };
      continue;
    }
    const resolutionMatch = line.match(/^    resolution: \{integrity: (sha512-[^,}]+)\}$/);
    if (resolutionMatch && current) current.integrity = resolutionMatch[1];
  }
  if (current) packages.push(current);
  if (packages.length === 0 || packages.some((entry) => !entry.integrity) || new Set(packages.map((entry) => entry.key)).size !== packages.length) throw new Error("license_manifest:pnpm_package_set");
  return { importer, packages };
}

function registrySource(name, version) {
  const tarballName = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return `https://registry.npmjs.org/${name}/-/${tarballName}-${version}.tgz`;
}

function generateManifest() {
  const actualAssetPaths = filesUnder(assetsRoot).map((path) => `public/assets/${relative(assetsRoot, path)}`).sort();
  const expectedAssetPaths = Object.keys(assetPolicies).sort();
  if (JSON.stringify(actualAssetPaths) !== JSON.stringify(expectedAssetPaths)) {
    const missingPolicy = actualAssetPaths.filter((path) => !assetPolicies[path]);
    const missingFile = expectedAssetPaths.filter((path) => !actualAssetPaths.includes(path));
    throw new Error(`license_manifest:asset_set_mismatch:unlisted=${missingPolicy.join(",")}:missing=${missingFile.join(",")}`);
  }
  const assets = actualAssetPaths.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(assetsRoot, path.slice("public/assets/".length)))),
    ...assetPolicies[path],
  }));

  const artifactRoot = acceptedArtifactsRoot;
  const attestationsBytes = readFileSync(artifactAttestationsPath);
  const attestationDocument = JSON.parse(attestationsBytes);
  const attestationRootKeys = ["schema", "attestedBy", "attestedAt", "ownerDirection", "artifacts"];
  if (!attestationDocument || typeof attestationDocument !== "object" || Array.isArray(attestationDocument) || Object.keys(attestationDocument).sort().join() !== [...attestationRootKeys].sort().join()) throw new Error("license_manifest:artifact_attestation_root");
  if (attestationDocument.schema !== "arena.artifact-redistribution-attestations.v1" || attestationDocument.attestedBy !== "Gota" || !/^2026-\d{2}-\d{2}$/.test(attestationDocument.attestedAt) || typeof attestationDocument.ownerDirection !== "string" || !Array.isArray(attestationDocument.artifacts)) throw new Error("license_manifest:artifact_attestation_identity");
  const attestationByHash = new Map();
  const rowKeys = ["treeSha256", "taskId", "buildId", "configurationId", "license", "redistributionAttested", "basis"];
  for (const row of attestationDocument.artifacts) {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join() !== [...rowKeys].sort().join()) throw new Error("license_manifest:artifact_attestation_row");
    if (!/^[a-f0-9]{64}$/.test(row.treeSha256) || !row.taskId || !row.buildId || !row.configurationId || row.license !== "MIT" || row.redistributionAttested !== true || typeof row.basis !== "string" || !row.basis) throw new Error(`license_manifest:artifact_attestation_invalid:${row.treeSha256 ?? "unknown"}`);
    if (attestationByHash.has(row.treeSha256)) throw new Error(`license_manifest:artifact_attestation_duplicate:${row.treeSha256}`);
    attestationByHash.set(row.treeSha256, row);
  }
  const publicBundle = JSON.parse(readFileSync(join(root, "public-release/accepted/bundle.json"), "utf8"));
  const buildByHash = new Map(publicBundle.release.builds.map((build) => [build.artifact.sha256, build]));
  const artifactTrees = readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const tree = join(artifactRoot, entry.name);
      const digest = canonicalDirectorySha256(tree);
      if (digest !== entry.name) throw new Error(`license_manifest:artifact_hash_mismatch:${entry.name}`);
      const attestation = attestationByHash.get(digest);
      const build = buildByHash.get(digest);
      const files = filesUnder(tree);
      for (const file of files) {
        const extension = extname(file).toLowerCase();
        if (!ARTIFACT_EXTENSIONS.has(extension)) throw new Error(`license_manifest:artifact_binary_or_unknown:${entry.name}:${relative(tree, file)}`);
        const text = readFileSync(file, "utf8");
        if (build?.playability !== "not_playable" && EXTERNAL_REFERENCE.test(text)) throw new Error(`license_manifest:artifact_external_reference:${entry.name}:${relative(tree, file)}`);
        if (RIGHTS_MARKER.test(text)) throw new Error(`license_manifest:artifact_rights_marker:${entry.name}:${relative(tree, file)}`);
      }
      if (!attestation || !build || attestation.taskId !== build.taskId || attestation.buildId !== build.id || attestation.configurationId !== build.configurationId) throw new Error(`license_manifest:artifact_attestation_mismatch:${digest}`);
      return {
        treeSha256: digest,
        fileCount: files.length,
        taskId: build.taskId,
        buildId: build.id,
        configurationId: build.configurationId,
        owner: attestationDocument.attestedBy,
        source: "Arena-generated build selected into the sanitized public fixture",
        license: attestation.license,
        redistributionAttested: attestation.redistributionAttested,
        attestationBasis: attestation.basis,
      };
    });
  if (artifactTrees.length !== attestationByHash.size || artifactTrees.length !== buildByHash.size) throw new Error("license_manifest:artifact_attestation_set_mismatch");

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const lock = parsePnpmLock(readFileSync(pnpmLockPath));
  if (packageJson.license !== "MIT" || packageJson.packageManager !== "pnpm@10.20.0"
    || JSON.stringify(packageJson.dependencies ?? {}) !== JSON.stringify(lock.importer.dependencies)
    || JSON.stringify(packageJson.devDependencies ?? {}) !== JSON.stringify(lock.importer.devDependencies)) throw new Error("license_manifest:root_package_metadata");
  if (readFileSync(pnpmWorkspacePath, "utf8") !== PNPM_POLICY) throw new Error("license_manifest:pnpm_policy");
  if (readFileSync(licensePath, "utf8") !== MIT_LICENSE) throw new Error("license_manifest:mit_text");
  const checkedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const licenseByPackage = new Map((checkedManifest.packages ?? []).map((entry) => [`${entry.name}@${entry.version}`, entry.license]));
  if (licenseByPackage.size !== (checkedManifest.packages ?? []).length) throw new Error("license_manifest:package_metadata_duplicate");
  const packages = lock.packages
    .map((entry) => ({
      path: `pnpm-lock.yaml#packages/${entry.key}`,
      name: entry.name,
      version: entry.version,
      license: licenseByPackage.get(`${entry.name}@${entry.version}`) ?? "UNKNOWN",
      integrity: entry.integrity,
      source: registrySource(entry.name, entry.version),
      owner: "Package authors",
      mitApplies: false,
      notice: "Installed from the locked pnpm dependency graph under the package's own license",
      redistributionAttested: true,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const dependency of packages) {
    if (!ALLOWED_PACKAGE_LICENSES.has(dependency.license)) throw new Error(`license_manifest:package_license:${dependency.name}:${dependency.license}`);
    if (!dependency.integrity.startsWith("sha512-") || !dependency.source.startsWith("https://registry.npmjs.org/")) throw new Error(`license_manifest:package_provenance:${dependency.name}`);
  }

  const externalReferences = new Set();
  for (const tree of readdirSync(artifactRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const file of filesUnder(join(artifactRoot, tree.name))) {
      const text = readFileSync(file, "utf8");
      if (/require\(["']playwright["']\)/.test(text)) externalReferences.add("playwright");
      if (/@napi-rs\/canvas/.test(text)) externalReferences.add("@napi-rs/canvas");
      if (/dejavu-fonts-ttf/.test(text)) externalReferences.add("dejavu-fonts-ttf");
    }
  }
  if (JSON.stringify([...externalReferences].sort()) !== JSON.stringify(artifactExternalTools.map((entry) => entry.package).sort())) throw new Error("license_manifest:artifact_external_tool_set_mismatch");

  return {
    schema: "arena.public-license-manifest.v1",
    copyright: "Copyright (c) 2026 Gota",
    codeLicense: "MIT",
    assets,
    artifactTrees,
    artifactAttestationSha256: sha256(attestationsBytes),
    artifactExternalTools,
    embeddedSources,
    packages,
  };
}

function renderNotices(manifest) {
  const brands = manifest.assets.filter((asset) => asset.kind === "brand_asset");
  const licenses = new Map();
  for (const dependency of manifest.packages) {
    const rows = licenses.get(dependency.license) ?? [];
    rows.push(`${dependency.name}@${dependency.version}`);
    licenses.set(dependency.license, rows);
  }
  const lines = [
    "# Third-party notices",
    "",
    "The repository source and Arena-owned assets are licensed under MIT. The following files remain the property of their respective owners and are not granted under Arena's MIT license.",
    "",
    "## Brand assets and trademarks",
    "",
    ...brands.flatMap((asset) => ["- `" + asset.path + "`: " + asset.notice + `; owner: ${asset.owner}; source: ${asset.source}.`, ""]),
    "Product and company names are used only to identify the evaluated agent configuration. No endorsement or transfer of trademark rights is claimed.",
    "",
    "## Embedded and referenced sources",
    "",
    ...manifest.embeddedSources.flatMap((entry) => ["- " + entry.name + " in `" + entry.path + "`: " + entry.license + "; source commit `" + entry.sourceCommit + "`; subset SHA-256 `" + entry.subsetSha256 + "`.", ""]),
    ...manifest.artifactExternalTools.flatMap((entry) => [`- ${entry.package}: ${entry.license}; ${entry.usage}; source: ${entry.source}.`, ""]),
    "",
    "## Package licenses",
    "",
    ...[...licenses].sort(([a], [b]) => a.localeCompare(b)).flatMap(([license, rows]) => [
      `### ${license}`,
      "",
      rows.sort().join(", "),
      "",
    ]),
    "This inventory joins the exact pnpm-locked name, version, and integrity with its checked license classification, and is verified in CI. Each package remains under its own license; the root MIT license does not replace those terms.",
    "",
  ];
  return lines.join("\n");
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const manifest = generateManifest();
const notices = renderNotices(manifest);
if (write) {
  writeFileSync(manifestPath, canonical(manifest));
  writeFileSync(noticesPath, notices);
} else {
  if (readFileSync(manifestPath, "utf8") !== canonical(manifest)) throw new Error("license_manifest:stale");
  if (readFileSync(noticesPath, "utf8") !== notices) throw new Error("license_notices:stale");
}
console.log(`Verified public license inventory: ${manifest.assets.length} assets, ${manifest.artifactTrees.length} Artifact trees, ${manifest.packages.length} packages, 0 unknown.`);
