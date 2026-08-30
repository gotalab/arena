import assert from "node:assert/strict";
import test from "node:test";
import { clientKey, memoryRateLimiter } from "../../src/rate-limit.ts";

test("memory limiter allows up to the window then refuses", () => {
  let now = 1_000;
  const limiter = memoryRateLimiter({ limit: 3, windowMs: 1_000, now: () => now });
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, true);
  const denied = limiter.consume("a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.consume("b").allowed, true);
  now = 2_001;
  assert.equal(limiter.consume("a").allowed, true);
});

test("new keys are refused once the map is full", () => {
  const limiter = memoryRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2 });
  assert.equal(limiter.consume("one").allowed, true);
  assert.equal(limiter.consume("two").allowed, true);
  const denied = limiter.consume("three");
  assert.equal(denied.allowed, false);
  assert.equal(limiter.consume("one").allowed, true);
});

test("expired clients release bounded map capacity", () => {
  let now = 0;
  const limiter = memoryRateLimiter({ limit: 2, windowMs: 100, maxKeys: 2, now: () => now });
  assert.equal(limiter.consume("one").allowed, true);
  assert.equal(limiter.consume("two").allowed, true);
  assert.equal(limiter.consume("three").allowed, false);
  now = 101;
  assert.equal(limiter.consume("three").allowed, true);
  assert.equal(limiter.consume("four").allowed, true);
});

test("client key prefers CF-Connecting-IP and shares a bucket when it is missing", () => {
  assert.equal(clientKey(new Request("https://arena.gotalab.dev", { headers: { "CF-Connecting-IP": "192.0.2.9" } })), "192.0.2.9");
  assert.equal(clientKey(new Request("https://arena.gotalab.dev")), "missing");
  assert.equal(clientKey(new Request("https://arena.gotalab.dev", { headers: { "X-Forwarded-For": "1.2.3.4" } })), "missing");
});
