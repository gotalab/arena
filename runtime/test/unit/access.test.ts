import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { AccessConfigurationError, AccessDeniedError, accessConfig, authenticateAccess, verifyAccessJwt } from "../../src/access.ts";
import type { Jwk } from "../../src/access.ts";

const env = {
  CF_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  CF_ACCESS_AUD: "0123456789abcdef0123456789abcdef",
  ALLOWED_EMAIL: "owner@example.com",
};

test("Access configuration rejects placeholders", () => {
  assert.throws(() => accessConfig({ ...env, CF_ACCESS_AUD: "REPLACE_ME" }), AccessConfigurationError);
});

test("Access authentication rejects a missing assertion", async () => {
  await assert.rejects(() => authenticateAccess(new Request("https://arena.gotalab.dev"), env), AccessDeniedError);
});

test("Access JWT rejects non-RS256 before fetching signing keys", async () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "none", kid: "x" })}.${encode({ exp: 9999999999 })}.x`;
  await assert.rejects(() => verifyAccessJwt(token, accessConfig(env), { jwks: { keys: [] } }), /algorithm/);
});

test("Access JWT accepts a valid signature and exact issuer, audience, and email", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as Jwk;
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "test-key" });
  const payload = encode({
    iss: "https://example.cloudflareaccess.com",
    aud: env.CF_ACCESS_AUD,
    email: env.ALLOWED_EMAIL,
    sub: "access-user-id",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  const identity = await verifyAccessJwt(`${header}.${payload}.${signature}`, accessConfig(env), { jwks: { keys: [publicJwk] } });
  assert.deepEqual(identity, { sub: "access-user-id", email: env.ALLOWED_EMAIL });
});

test("Access JWT rejects a tampered signature", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as Jwk;
  publicJwk.kid = "test-key";
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "test-key" });
  const payload = encode({
    iss: "https://example.cloudflareaccess.com",
    aud: env.CF_ACCESS_AUD,
    email: env.ALLOWED_EMAIL,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  await assert.rejects(
    () => verifyAccessJwt(`${header}.${payload}.${Buffer.alloc(256).toString("base64url")}`, accessConfig(env), { jwks: { keys: [publicJwk] } }),
    /signature/,
  );
});
