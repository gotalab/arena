import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { once } from "node:events";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Public release files are data and executable content at the same time. This
 * scanner is deliberately independent of the release generator so an accepted
 * output can be checked again from its bytes (and, optionally, its Git
 * history). It never includes matched content in an error message.
 */

export const PUBLIC_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsonl",
  ".less",
  ".markdown",
  ".md",
  ".mjs",
  ".scss",
  ".sh",
  ".svg",
  ".sass",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const DEFAULT_IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const HASH_DIRECTORY = /^[a-f0-9]{64}$/;
const SOURCE_MAP_MARKER = /(?:^|[\s/])(?:\/\/|\/\*#?)#?\s*sourceMappingURL\s*=/i;
const SOURCE_MAP_JSON = /["']version["']\s*:\s*3[\s\S]{0,8192}["']sources["']\s*:[\s\S]{0,8192}["']mappings["']\s*:/i;

/**
 * Keep these patterns narrow enough that normal public words such as
 * "task", "control", and "token" do not fail a release. Field-shaped
 * internal names and known credential formats remain protected.
 */
const PROTECTED_RULES = [
  {
    code: "private_path",
    pattern: /(?:^|[^A-Za-z0-9_])\/(?:Users|home)\/[A-Za-z0-9._~-]+(?:[\\/][^\s"'`<>)]*)?/i,
  },
  {
    code: "private_path",
    pattern: /(?:^|[^A-Za-z0-9_])[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._~-]+(?:[\\/][^\s"'`<>)]*)?/i,
  },
  {
    code: "private_path",
    pattern: /(?:^|[\s"'`=(])(?:\.?[\\/]?)(?:pool|tasks|jobs)[\\/][A-Za-z_.-][^\s"'`<>)]*/i,
  },
  {
    code: "private_path",
    pattern: /(?:^|[\s"'`=(])(?:\.?[\\/]?)engine[\\/]dist[\\/][^\s"'`<>)]*/i,
  },
  {
    code: "evaluation_control",
    pattern: /["'`](?:sourcePath|promptSha256|trialId|configurationRef|configurationDigest|artifactSha256|evaluatorControl|privateSourcePath|rawLog|rubric)["'`]\s*[:=]/i,
  },
  {
    code: "evaluation_control",
    pattern: /\b(?:sourcePath|promptSha256|configurationRef|configurationDigest|artifactSha256|evaluatorControl|privateSourcePath|rawLog)\b\s*[:=]/i,
  },
  {
    code: "evaluation_control",
    pattern: /\b(?:judge\s+prompt|system\s+prompt|developer\s+prompt|rubric\.(?:ya?ml|json)|raw[\s_-]?log|evaluation\s+control)\b/i,
  },
  {
    code: "internal_id",
    pattern: /\b[A-Za-z][A-Za-z0-9_-]*@\d+\.\d+\.\d+--[A-Za-z0-9._-]+--[a-f0-9]{8,}(?:--r\d+)?\b/i,
  },
  {
    code: "credential",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/i,
  },
  {
    code: "credential",
    pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/i,
  },
  {
    code: "credential",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/i,
  },
  {
    code: "credential",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i,
  },
  {
    code: "credential",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    code: "credential",
    pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/,
  },
  {
    code: "credential",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    code: "credential",
    pattern: /(?:["'`]?(?:api[_-]?key|client[_-]?secret|access[_-]?token|private[_-]?key|secret(?:[_-]?key)?|(?:auth|refresh|csrf|artifact)[_-]?token)["'`]?)\s*[:=]\s*["'`]?([A-Za-z0-9+/_=-]{16,})/i,
  },
];

const ASCII_OR_UTF8 = new TextDecoder("utf-8", { fatal: true });
const LATIN1 = new TextDecoder("iso-8859-1");

export class PublicScanError extends Error {
  constructor(code, path, detail = undefined) {
    const suffix = detail ? `:${detail}` : "";
    super(`public_scan:${code}:${path}${suffix}`);
    this.name = "PublicScanError";
    this.code = code;
    this.path = path;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function relativePath(root, path) {
  const value = posixPath(relative(root, path));
  return value || ".";
}

function errorPath(root, path) {
  if (path.startsWith("git:")) return path;
  return relativePath(root, path);
}

function fail(code, root, path, detail = undefined) {
  throw new PublicScanError(code, errorPath(root, path), detail);
}

function optionSet(value, fallback) {
  if (value == null) return new Set(fallback);
  return new Set(value);
}

function likelyText(bytes, path) {
  if (PUBLIC_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return true;
  if (bytes.includes(0)) return false;
  try {
    ASCII_OR_UTF8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function decodePercentRuns(value) {
  if (!value.includes("%")) return value;
  return value.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function decodeBase64Candidate(candidate) {
  if (candidate.length > 4096 || candidate.length < 16) return null;
  const normalized = candidate.replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length % 4 === 1) return null;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let decoded;
  try {
    decoded = Buffer.from(padded, "base64");
  } catch {
    return null;
  }
  if (decoded.length < 8) return null;
  let text;
  try {
    text = ASCII_OR_UTF8.decode(decoded);
  } catch {
    return null;
  }
  const printable = [...text].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code < 127) || code > 159;
  }).length;
  return printable / Math.max(1, text.length) >= 0.75 ? text : null;
}

function inspectText(text, path, { encoded = false, ignoredCodes = new Set() } = {}) {
  for (const rule of PROTECTED_RULES) {
    if (ignoredCodes.has(rule.code)) continue;
    if (rule.pattern.test(text)) {
      throw new PublicScanError(encoded ? `encoded_${rule.code}` : rule.code, path);
    }
  }
  if (SOURCE_MAP_MARKER.test(text) || SOURCE_MAP_JSON.test(text)) {
    throw new PublicScanError("source_map", path);
  }
}

function inspectEncodedText(text, path, ignoredCodes = new Set()) {
  let decoded = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodePercentRuns(decoded);
    if (next === decoded) break;
    decoded = next;
    inspectText(decoded, path, { encoded: true, ignoredCodes });
  }

  const candidates = /(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{16,}={0,2})(?=$|[^A-Za-z0-9+/_-])/g;
  for (const match of text.matchAll(candidates)) {
    const candidate = match[1];
    if (!candidate) continue;
    const base64Text = decodeBase64Candidate(candidate);
    if (base64Text) inspectText(base64Text, path, { encoded: true, ignoredCodes });
  }
}

function ignoredRuleCodes(options, path) {
  const codes = options.allowedRuleCodesByFile?.[path];
  return new Set(Array.isArray(codes) ? codes : []);
}

function inspectRelativePath(normalized, label) {
  if (normalized === ".") return;
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new PublicScanError("path_segment", label);
  }
  if (/(?:^|\/)(?:pool|tasks|jobs)(?:\/|$)/i.test(normalized) || /(?:^|\/)engine\/dist(?:\/|$)/i.test(normalized)) {
    throw new PublicScanError("private_path", label);
  }
  if (extname(normalized).toLowerCase() === ".map") throw new PublicScanError("source_map", label);
}

function inspectPathName(root, path) {
  const rel = errorPath(root, path);
  inspectRelativePath(posixPath(rel), rel);
}

function inspectFile(root, path, options) {
  const rel = relativePath(root, path);
  inspectPathName(root, path);
  const size = statSync(path).size;
  if (options.maxFileBytes != null && size > options.maxFileBytes) {
    fail("file_too_large", root, path);
  }
  const bytes = readFileSync(path);
  if (optionSet(options.trustedPolicyFiles, []).has(rel)) {
    return { path: rel, byteLength: bytes.length, sha256: sha256(bytes) };
  }
  if (likelyText(bytes, path)) {
    let text;
    try {
      text = ASCII_OR_UTF8.decode(bytes);
    } catch {
      fail("invalid_text", root, path);
    }
    const ignoredCodes = ignoredRuleCodes(options, rel);
    inspectText(text, rel, { ignoredCodes });
    inspectEncodedText(text, rel, ignoredCodes);
  } else {
    // Credential and private-path signatures are ASCII. Check binary files
    // without treating arbitrary binary bytes as a text document.
    inspectText(LATIN1.decode(bytes), rel, { ignoredCodes: ignoredRuleCodes(options, rel) });
  }
  return { path: rel, byteLength: bytes.length, sha256: sha256(bytes) };
}

function walkFiles(root, options) {
  const ignored = optionSet(options.ignoreDirectories, DEFAULT_IGNORED_DIRECTORIES);
  const files = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      fail("read_error", root, directory);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail("symlink", root, path);
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        fail("special_file", root, path);
      }
    }
  };
  walk(root);
  files.sort((left, right) => relativePath(root, left).localeCompare(relativePath(root, right)));
  return files;
}

function assertDirectory(root) {
  const absolute = resolve(root);
  let info;
  try {
    info = lstatSync(absolute);
  } catch {
    throw new PublicScanError("missing", ".");
  }
  if (info.isSymbolicLink()) throw new PublicScanError("symlink", ".");
  if (!info.isDirectory()) throw new PublicScanError("directory_required", ".");
  return absolute;
}

/**
 * Scan one filesystem tree synchronously. `.git` and `node_modules` are
 * ignored by default; pass `ignoreDirectories: []` when they are part of the
 * public input contract. Use `includeGitBlobs` through scanPublicTree (the
 * async API) to inspect Git history without walking `.git` internals.
 */
export function scanPublicTreeSync(root, options = {}) {
  const absolute = assertDirectory(root);
  const files = walkFiles(absolute, options);
  const entries = files.map((path) => inspectFile(absolute, path, options));
  const byteLength = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (options.maxTreeBytes != null && byteLength > options.maxTreeBytes) {
    throw new PublicScanError("tree_too_large", ".");
  }
  return {
    root: absolute,
    files: entries.map((entry) => entry.path),
    entries,
    fileCount: entries.length,
    byteLength,
    gitBlobCount: 0,
  };
}

function readGitObjectList(root) {
  let output;
  try {
    output = execFileSync("git", ["-C", root, "rev-list", "--objects", "--all"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new PublicScanError("git_unavailable", ".");
  }
  const byObject = new Map();
  for (const record of output.split(/\r?\n/)) {
    if (!record) continue;
    const match = /^([a-f0-9]{40,64})(?: (.*))?$/.exec(record);
    if (!match) continue;
    const object = match[1];
    const path = match[2] ?? null;
    if (!byObject.has(object)) byObject.set(object, new Set());
    if (path) byObject.get(object).add(path);
  }
  return byObject;
}

async function scanGitObjectBytes(root, byObject, options) {
  if (byObject.size === 0) return 0;
  const child = spawn("git", ["-C", root, "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = (async () => {
    const chunks = [];
    for await (const chunk of child.stderr) chunks.push(chunk);
    return Buffer.concat(chunks);
  })();
  const close = once(child, "close");
  let pending = Buffer.alloc(0);
  let cursor = 0;
  let blobCount = 0;

  const consume = (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (true) {
      const headerEnd = pending.indexOf(10);
      if (headerEnd < 0) return;
      const header = pending.subarray(0, headerEnd).toString("ascii");
      const match = /^([a-f0-9]{40,64}) ([^ ]+) (\d+)$/.exec(header);
      if (!match) throw new PublicScanError("git_batch", `git:${cursor}`);
      const size = Number(match[3]);
      const bodyStart = headerEnd + 1;
      const bodyEnd = bodyStart + size;
      if (pending.length < bodyEnd + 1) return;
      const body = pending.subarray(bodyStart, bodyEnd);
      if (pending[bodyEnd] !== 10) throw new PublicScanError("git_batch", `git:${match[1]}`);
      pending = pending.subarray(bodyEnd + 1);
      cursor += 1;
      if (match[2] !== "blob") continue;
      blobCount += 1;
      const paths = byObject.get(match[1]) ?? new Set([match[1]]);
      for (const path of paths) {
        const normalizedPath = posixPath(path);
        const label = `git:${normalizedPath}`;
        inspectRelativePath(normalizedPath, label);
        if (optionSet(options.trustedPolicyFiles, []).has(normalizedPath)) continue;
        if (extname(path).toLowerCase() === ".map") throw new PublicScanError("source_map", label);
        const ignoredCodes = ignoredRuleCodes(options, normalizedPath);
        if (likelyText(body, path)) {
          let text;
          try {
            text = ASCII_OR_UTF8.decode(body);
          } catch {
            throw new PublicScanError("invalid_text", label);
          }
          inspectText(text, label, { ignoredCodes });
          inspectEncodedText(text, label, ignoredCodes);
        } else {
          inspectText(LATIN1.decode(body), label, { ignoredCodes });
        }
      }
    }
  };

  const read = (async () => {
    for await (const chunk of child.stdout) consume(chunk);
  })();
  try {
    for (const object of byObject.keys()) {
      if (!child.stdin.write(`${object}\n`)) await once(child.stdin, "drain");
    }
    child.stdin.end();
    await read;
    const [code] = await close;
    await stderr;
    if (code !== 0) throw new PublicScanError("git_batch", `git:${root}`);
    if (pending.length !== 0) throw new PublicScanError("git_batch", `git:${root}`);
    return blobCount;
  } catch (error) {
    child.kill();
    await Promise.allSettled([read, close, stderr]);
    throw error;
  }
}

/** Scan all reachable Git blobs through git rev-list/cat-file plumbing. */
export async function scanGitBlobs(root, options = {}) {
  const absolute = assertDirectory(root);
  const byObject = readGitObjectList(absolute);
  const blobCount = await scanGitObjectBytes(absolute, byObject, options);
  return { root: absolute, objectCount: byObject.size, blobCount };
}

/**
 * Async wrapper used when history scanning is requested. Without Git scanning
 * it still returns a Promise so callers can use one API for both tiers.
 */
export async function scanPublicTree(root, options = {}) {
  const report = scanPublicTreeSync(root, options);
  if (options.includeGitBlobs) {
    const history = await scanGitBlobs(report.root, options);
    return { ...report, gitBlobCount: history.blobCount, gitObjectCount: history.objectCount };
  }
  return report;
}

export const scanPublicPath = scanPublicTree;
export const assertPublicTree = scanPublicTree;

/** Canonical digest shared by artifact publication and independent verifiers. */
export function canonicalDirectorySha256(directory) {
  const absolute = assertDirectory(directory);
  const files = walkFiles(absolute, { ignoreDirectories: [] });
  const records = files.map((path) => {
    const bytes = readFileSync(path);
    return `${relativePath(absolute, path)}\0${sha256(bytes)}\n`;
  });
  return sha256(Buffer.from(records.sort().join(""), "utf8"));
}

export const canonicalTreeSha256 = canonicalDirectorySha256;

/** Recompute every content-addressed directory under `<root>/<prefix>`. */
export function verifyHashDirectories(root, prefix = "artifacts") {
  const absolute = resolve(root, prefix);
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true });
  } catch {
    throw new PublicScanError("missing_directory", posixPath(prefix));
  }
  const directories = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(absolute, entry.name);
    if (entry.isSymbolicLink()) throw new PublicScanError("symlink", `${posixPath(prefix)}/${entry.name}`);
    if (!entry.isDirectory()) throw new PublicScanError("artifact_entry", `${posixPath(prefix)}/${entry.name}`);
    if (!HASH_DIRECTORY.test(entry.name)) throw new PublicScanError("artifact_directory_name", `${posixPath(prefix)}/${entry.name}`);
    const digest = canonicalDirectorySha256(path);
    if (digest !== entry.name) {
      throw new PublicScanError("artifact_hash_mismatch", `${posixPath(prefix)}/${entry.name}`);
    }
    directories.push({ name: entry.name, sha256: digest });
  }
  return directories;
}

function usage() {
  console.error("usage: node scan-public.mjs [--git-blobs] DIRECTORY [...]");
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const includeGitBlobs = args.includes("--git-blobs");
  const roots = args.filter((argument) => argument !== "--git-blobs");
  if (roots.length === 0) {
    usage();
  } else {
    for (const root of roots) {
      const report = await scanPublicTree(root, { includeGitBlobs });
      console.log(JSON.stringify({
        root: report.root,
        files: report.fileCount,
        bytes: report.byteLength,
        gitBlobs: report.gitBlobCount,
      }));
    }
  }
}
