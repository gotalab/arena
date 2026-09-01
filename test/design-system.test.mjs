import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styleFiles = ["base.css", "components.css", "play.css", "benchmark.css", "doc.css"];
const styles = Object.fromEntries(styleFiles.map((name) => [
  name,
  readFileSync(new URL(`../src/styles/${name}`, import.meta.url), "utf8"),
]));
const allStyles = Object.values(styles).join("\n");

test("the public UI uses one local system type stack and standard weights", () => {
  assert.match(styles["base.css"], /--sans: ui-sans-serif, system-ui/);
  assert.doesNotMatch(allStyles, /@font-face|fonts\.googleapis\.com/);
  assert.doesNotMatch(allStyles, /font(?:-weight)?: (?:650|750|780)\b/);
});

test("shared controls use the same rounded rectangle geometry", () => {
  assert.match(styles["base.css"], /\.btn-quiet\s*\{[^}]*border-radius: var\(--r-md\)/s);
  assert.match(styles["base.css"], /\.btn-icon\s*\{[^}]*border-radius: var\(--r-md\)/s);
  assert.match(styles["play.css"], /\.deck__fs\s*\{[^}]*border-radius: var\(--r-md\)/s);
  assert.doesNotMatch(allStyles, /border-radius: (?:6|8|10|999)px/);
});

test("every static CSS token reference resolves", () => {
  const defined = new Set([...allStyles.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  const used = new Set([...allStyles.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
  const runtimeTokens = new Set(["--stage-h", "--stage-w"]);
  const unresolved = [...used].filter((token) => !defined.has(token) && !runtimeTokens.has(token)).sort();

  assert.deepEqual(unresolved, []);
});
