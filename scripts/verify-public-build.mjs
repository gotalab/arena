import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { scanPublicTreeSync, verifyHashDirectories } from "../public-contract/scan-public.mjs";

const webRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(webRoot, "src");
const distRoot = resolve(process.argv[2] ?? join(webRoot, "dist/public-client"));
const publicReleaseRoot = resolve(process.env.ARENA_PUBLIC_RELEASE_DIR ?? join(webRoot, "public-release/accepted"));
const forbiddenPath = /(?:^|\/)(?:data|engine|pool|tasks)(?:\/|$)/;

function resolveImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.json`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (!lstatSync(candidate).isDirectory()) return candidate;
    } catch {}
  }
  throw new Error(`public_build:unresolved_import:${relative(webRoot, from)}:${specifier}`);
}

const visited = new Set();
function walkModule(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const relativePath = relative(sourceRoot, path);
  if (relativePath === "types.ts" || forbiddenPath.test(relativePath)) throw new Error(`public_build:private_module:${relativePath}`);
  const source = readFileSync(path, "utf8");
  const imports = source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)/g);
  for (const match of imports) {
    const specifier = match[1] ?? match[2];
    const resolved = resolveImport(path, specifier);
    if (resolved) walkModule(resolved);
  }
}
walkModule(join(sourceRoot, "main.tsx"));

const scanned = scanPublicTreeSync(distRoot, { ignoreDirectories: [] });
const files = scanned.files.map((path) => join(distRoot, path));

const indexHtml = readFileSync(join(distRoot, "index.html"), "utf8");
const entryMatch = /<script[^>]+src="([^"]+\.js)"/.exec(indexHtml);
if (!entryMatch) throw new Error("public_build:entry_chunk_missing");
const entryChunk = readFileSync(join(distRoot, entryMatch[1].replace(/^\//, "")), "utf8");
const releaseBundle = JSON.parse(readFileSync(join(publicReleaseRoot, "bundle.json"), "utf8"));
const expectsEmbeddedArtifacts = process.env.VITE_PUBLIC_ARTIFACTS !== "false";
const artifactDirectories = expectsEmbeddedArtifacts ? verifyHashDirectories(distRoot) : [];
const expectedArtifactHashes = new Set(releaseBundle.release.builds.map((build) => build.artifact.sha256));
const actualArtifactHashes = new Set(artifactDirectories.map((directory) => directory.name));
if (expectsEmbeddedArtifacts && (expectedArtifactHashes.size !== actualArtifactHashes.size || [...expectedArtifactHashes].some((hash) => !actualArtifactHashes.has(hash)))) {
  throw new Error("public_build:artifact_hash_set_mismatch");
}
if (!expectsEmbeddedArtifacts && lstatSync(distRoot).isDirectory() && scanned.files.some((path) => path === "artifacts" || path.startsWith("artifacts/"))) {
  throw new Error("public_build:artifact_tree_unexpected");
}
const identityValues = releaseBundle.release.configurations.flatMap((configuration) => [
  configuration.id,
  configuration.model,
  configuration.harnessVersion,
]).filter((value) => typeof value === "string" && value.length >= 4);
for (const identity of identityValues) {
  if (entryChunk.includes(identity)) throw new Error(`public_build:blind_identity_in_entry:${identity}`);
}

const probeMarker = "Agent route check";
if (process.env.VITE_WEBMCP_PROBE === "true" && !entryChunk.includes(probeMarker)) {
  throw new Error("public_build:webmcp_probe_missing");
}
if (process.env.VITE_WEBMCP_PROBE !== "true" && entryChunk.includes(probeMarker)) {
  throw new Error("public_build:webmcp_probe_unexpected");
}

const packageRecord = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8"));
if (/generate-view/.test(packageRecord.scripts?.["build:public"] ?? "")) throw new Error("public_build:private_generator_in_command");
console.log(`Verified public module graph (${visited.size} modules) and output (${files.length} files, ${artifactDirectories.length} artifact trees).`);
