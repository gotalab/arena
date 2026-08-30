import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validatePublicBundle } from "../public-contract/validate-public-release.mjs";
import { scanPublicTreeSync, verifyHashDirectories } from "../public-contract/scan-public.mjs";

const root = resolve(process.env.ARENA_PUBLIC_RELEASE_DIR ?? "public-release/accepted");
const bundlePath = join(root, "bundle.json");
const manifestPath = join(root, "manifest.json");
if (!existsSync(bundlePath) || !existsSync(manifestPath)) throw new Error(`public_release:missing:${root}`);

const bundleBytes = readFileSync(bundlePath);
const bundle = validatePublicBundle(JSON.parse(bundleBytes));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const digest = createHash("sha256").update(bundleBytes).digest("hex");
if (manifest.schema !== bundle.schema || manifest.bundleSha256 !== digest) throw new Error("public_release:manifest_mismatch");

const scanned = scanPublicTreeSync(root, { ignoreDirectories: [] });
const files = scanned.files
  .filter((path) => path.startsWith("artifacts/"))
  .map((path) => path.slice("artifacts/".length))
  .sort();
if (JSON.stringify(files) !== JSON.stringify(manifest.files)) throw new Error("public_release:file_manifest_mismatch");

const directories = verifyHashDirectories(root);
const expectedHashes = new Set(bundle.release.builds.map((build) => build.artifact.sha256));
const actualHashes = new Set(directories.map((directory) => directory.name));
if (expectedHashes.size !== actualHashes.size || [...expectedHashes].some((hash) => !actualHashes.has(hash))) {
  throw new Error("public_release:artifact_hash_set_mismatch");
}

console.log(`Verified ${bundle.schema}: ${bundle.release.builds.length} builds, ${files.length} artifact files, ${directories.length} artifact trees.`);
