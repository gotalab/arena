import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOrigin, parseAllowedOrigin } from "../../src/origin.ts";

test("origin validator accepts HTTPS origins", () => {
  assert.equal(parseAllowedOrigin("https://arena.gotalab.dev"), "https://arena.gotalab.dev");
  assert.equal(parseAllowedOrigin("https://artifacts.arena.gotalab.dev:8443/"), "https://artifacts.arena.gotalab.dev:8443");
  assert.equal(isAllowedOrigin("https://example.com/"), true);
});

test("origin validator accepts HTTP only on exact loopback hosts", () => {
  for (const value of [
    "http://127.0.0.1:8787",
    "http://localhost:8788/",
    "http://[::1]:8789/",
  ]) {
    assert.equal(isAllowedOrigin(value), true, value);
  }
});

test("origin validator rejects non-loopback HTTP origins", () => {
  for (const value of [
    "http://arena.gotalab.dev",
    "http://example.com:8787/",
    "http://127.0.0.2:8787/",
    "http://localhost.example:8787/",
    "http://127.0.0.1.evil.example/",
  ]) {
    assert.equal(parseAllowedOrigin(value), null, value);
    assert.equal(isAllowedOrigin(value), false, value);
  }
});

test("origin validator rejects malformed, placeholder, and non-root values", () => {
  for (const value of [
    undefined,
    "",
    "REPLACE_ME",
    "https://arena.gotalab.dev/path",
    "ftp://localhost:8788/",
    "not an origin",
  ]) {
    assert.equal(parseAllowedOrigin(value), null, String(value));
  }
});
