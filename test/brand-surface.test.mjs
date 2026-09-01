import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

test("third-party marks stay available but are not product UI dependencies", () => {
  const references = sourceFiles(join(root, "src"))
    .filter((path) => [".ts", ".tsx", ".css"].includes(extname(path)))
    .filter((path) => readFileSync(path, "utf8").includes("/assets/marks/"));
  assert.deepEqual(references, []);

  for (const name of [
    "antigravity-on-dark.png",
    "antigravity.png",
    "claude.svg",
    "cursor-on-dark.svg",
    "cursor.svg",
    "openai-on-dark.svg",
    "openai.svg",
    "opencode-on-dark.svg",
    "opencode.svg",
    "pi.svg",
  ]) {
    assert.equal(existsSync(join(root, "public", "assets", "marks", name)), true, name);
  }
});

test("the product header links to the canonical Arena repository", () => {
  const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
  const mark = readFileSync(join(root, "src", "components", "GitHubMark.tsx"), "utf8");

  assert.match(app, /href="https:\/\/github\.com\/gotalab\/arena"/);
  assert.match(app, /aria-label="Arena on GitHub"/);
  assert.match(mark, /Primer Octicons `mark-github-24`/);
  assert.match(mark, /viewBox="0 0 24 24"/);
});
