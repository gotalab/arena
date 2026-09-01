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
