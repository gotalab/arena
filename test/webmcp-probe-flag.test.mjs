import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalDirectorySha256 } from "../public-contract/scan-public.mjs";

test("WebMCP probe UI is local/CI-only while production keeps its sealed Artifact", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src/App.tsx"), "utf8");
  assert.match(source, /import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_WEBMCP_PROBE === "true"/);
  assert.match(source, /webmcp-probe/);
  assert.match(source, /requestArtifactAccess\(`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
  const productBuild = readFileSync(resolve(import.meta.dirname, "../scripts/build-product-runtime.mjs"), "utf8");
  assert.match(productBuild, /VITE_WEBMCP_PROBE: "false"/);
  assert.match(productBuild, /VITE_WEBMCP_PROBE_ARTIFACT: "false"/);
});

test("production WebMCP probe is a declared content-addressed Artifact", () => {
  const component = readFileSync(resolve(import.meta.dirname, "../src/components/WebMcpProbe.tsx"), "utf8");
  const contract = JSON.parse(readFileSync(resolve(import.meta.dirname, "../public-contract/webmcp-probe.v1.json"), "utf8"));
  assert.deepEqual(Object.keys(contract).sort(), ["schema", "treeSha256"]);
  assert.equal(contract.schema, "arena.webmcp-probe.v1");
  assert.equal(canonicalDirectorySha256(resolve(import.meta.dirname, "../public/__webmcp_probe")), contract.treeSha256);
  assert.match(component, /VITE_WEBMCP_PROBE_ARTIFACT/);
  assert.match(component, /artifactOrigin\(\).*probeContract\.treeSha256/s);
});
