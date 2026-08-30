import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(process.env.ARENA_HACKATHON_FILE ?? resolve(root, "HACKATHON.md")), "utf8");
const match = /<!-- arena\.hackathon\.v1:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- arena\.hackathon\.v1:end -->/.exec(source);
if (!match) throw new Error("hackathon_evidence:block_missing");
const evidence = JSON.parse(match[1]);

function closed(value, keys, at) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`hackathon_evidence:${at}:object_required`);
  const extras = Object.keys(value).filter((key) => !keys.includes(key));
  if (extras.length) throw new Error(`hackathon_evidence:${at}:extra:${extras.join(",")}`);
  for (const key of keys) if (!(key in value)) throw new Error(`hackathon_evidence:${at}:missing:${key}`);
}

function git(args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

closed(evidence, ["schema", "submissionPeriodStart", "preExistingBaseline", "publicHistory", "preExistingCapabilities", "challengePaths"], "root");
closed(evidence.preExistingBaseline, ["commit", "gitTree", "committedAt", "pathSetSha256", "attestationSha256"], "preExistingBaseline");
closed(evidence.publicHistory, ["initialExportCommit", "challengeRange"], "publicHistory");
if (evidence.schema !== "arena.hackathon.v1") throw new Error("hackathon_evidence:schema");
const commit = /^[a-f0-9]{40}$/;
if (!commit.test(evidence.preExistingBaseline.commit) || !commit.test(evidence.preExistingBaseline.gitTree) || !commit.test(evidence.publicHistory.initialExportCommit)) throw new Error("hackathon_evidence:git_identity");
const attestationInput = JSON.stringify({
  commit: evidence.preExistingBaseline.commit,
  committedAt: evidence.preExistingBaseline.committedAt,
  gitTree: evidence.preExistingBaseline.gitTree,
  pathSetSha256: evidence.preExistingBaseline.pathSetSha256,
});
if (createHash("sha256").update(attestationInput).digest("hex") !== evidence.preExistingBaseline.attestationSha256) throw new Error("hackathon_evidence:baseline_attestation");
const start = Date.parse(evidence.submissionPeriodStart);
const baselineDate = Date.parse(evidence.preExistingBaseline.committedAt);
if (!Number.isFinite(start) || !Number.isFinite(baselineDate) || baselineDate >= start) throw new Error("hackathon_evidence:baseline_date");
if (evidence.publicHistory.challengeRange !== `${evidence.publicHistory.initialExportCommit}..HEAD`) throw new Error("hackathon_evidence:range");
git(["cat-file", "-e", `${evidence.publicHistory.initialExportCommit}^{commit}`]);
if (git(["rev-list", "--parents", "-n", "1", evidence.publicHistory.initialExportCommit]).split(" ").length !== 1) throw new Error("hackathon_evidence:initial_export_not_root");
const challengeCommits = git(["rev-list", "--reverse", evidence.publicHistory.challengeRange]).split("\n").filter(Boolean);
if (challengeCommits.length === 0) throw new Error("hackathon_evidence:no_challenge_commits");
for (const hash of challengeCommits) {
  const committedAt = Date.parse(git(["show", "-s", "--format=%cI", hash]));
  if (!Number.isFinite(committedAt) || committedAt < start) throw new Error(`hackathon_evidence:commit_before_start:${hash}`);
}
for (const key of ["preExistingCapabilities"]) {
  if (!Array.isArray(evidence[key]) || evidence[key].length === 0 || evidence[key].some((value) => typeof value !== "string" || !value.trim())) throw new Error(`hackathon_evidence:${key}`);
}
if (!Array.isArray(evidence.challengePaths) || evidence.challengePaths.length === 0) throw new Error("hackathon_evidence:challengePaths");
const paths = new Set();
for (const [index, entry] of evidence.challengePaths.entries()) {
  closed(entry, ["path", "preExisting", "firstPublicCommit"], `challengePaths[${index}]`);
  if (typeof entry.path !== "string" || !entry.path || entry.path.startsWith("/") || entry.path.includes("..") || paths.has(entry.path)) throw new Error("hackathon_evidence:challenge_path");
  if (entry.preExisting !== false || entry.firstPublicCommit !== evidence.publicHistory.initialExportCommit) throw new Error("hackathon_evidence:challenge_path_preexisting");
  if (!existsSync(resolve(root, entry.path))) throw new Error(`hackathon_evidence:challenge_path_missing:${entry.path}`);
  git(["cat-file", "-e", `${entry.firstPublicCommit}:${entry.path}`]);
  const firstPublicCommit = git(["log", "--reverse", "--diff-filter=A", "--format=%H", "--", entry.path]).split("\n")[0];
  if (firstPublicCommit !== entry.firstPublicCommit) throw new Error(`hackathon_evidence:challenge_path_history:${entry.path}`);
  paths.add(entry.path);
}
const pathSetSha256 = createHash("sha256").update([...paths].sort().map((path) => `${path}\0absent\n`).join("")).digest("hex");
if (pathSetSha256 !== evidence.preExistingBaseline.pathSetSha256) throw new Error("hackathon_evidence:baseline_path_set");
if (/\/(?:Users|home)\/|BEGIN [A-Z ]*PRIVATE KEY|\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/i.test(source)) throw new Error("hackathon_evidence:protected_text");
console.log(`Verified hackathon boundary: baseline ${evidence.preExistingBaseline.commit.slice(0, 8)}, ${challengeCommits.length} public challenge commits through HEAD.`);
