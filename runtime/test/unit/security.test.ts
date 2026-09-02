import assert from "node:assert/strict";
import test from "node:test";
import { artifactSecurityHeaders, mainSecurityHeaders } from "../../src/security.ts";

test("Main headers lock the shell and still allow the play iframe as frame-src", () => {
  const headers = mainSecurityHeaders("https://artifacts.arena.gotalab.dev");
  assert.match(headers["Content-Security-Policy"]!, /frame-src https:\/\/artifacts\.arena\.gotalab\.dev/);
  assert.match(headers["Content-Security-Policy"]!, /connect-src 'self' https:\/\/artifacts\.arena\.gotalab\.dev/);
  assert.match(headers["Content-Security-Policy"]!, /frame-ancestors 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  // Released: no robots gate on any Main response.
  assert.equal("X-Robots-Tag" in headers, false);
});

test("Artifact headers name Main as the only parent and omit X-Frame-Options", () => {
  const tree = "https://artifacts.arena.gotalab.dev/artifacts/" + "a".repeat(64) + "/";
  const headers = artifactSecurityHeaders("https://arena.gotalab.dev", tree);
  assert.match(headers["Content-Security-Policy"]!, /frame-ancestors https:\/\/arena\.gotalab\.dev/);
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.equal(headers["Access-Control-Allow-Methods"], "GET, HEAD");
  assert.equal(headers.Vary, undefined);
  assert.equal(headers["X-Frame-Options"], undefined);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});

test("non-tree Artifact responses keep CORS scoped to Main", () => {
  const headers = artifactSecurityHeaders("https://arena.gotalab.dev");
  assert.equal(headers["Access-Control-Allow-Origin"], "https://arena.gotalab.dev");
  assert.equal(headers.Vary, "Origin");
});

test("Artifact responses that must not be framed still send DENY", () => {
  const headers = artifactSecurityHeaders("'none'");
  assert.match(headers["Content-Security-Policy"]!, /frame-ancestors 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
});
