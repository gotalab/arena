import assert from "node:assert/strict";
import test from "node:test";
import { handleArtifactRequest } from "../../src/artifact.ts";
import { AccessDeniedError } from "../../src/access.ts";
import { mintArtifactToken } from "../../src/token.ts";

const hash = "a".repeat(64);
const authenticate = async () => ({ sub: "owner", email: "owner@example.com" });

const tree: Record<string, string> = {
  [`/artifacts/${hash}/index.html`]: "<h1>game</h1>",
  [`/artifacts/${hash}/assets/sprites.png`]: "png-bytes",
  [`/artifacts/${hash}/main.js`]: "console.log(1)",
};

function artifactEnv() {
  return {
    MAIN_ORIGIN: "https://arena.gotalab.dev",
    ASSETS: {
      fetch: async (request: Request) => {
        const body = tree[new URL(request.url).pathname];
        return body === undefined ? new Response("Not Found", { status: 404 }) : new Response(body);
      },
    } as unknown as Fetcher,
  };
}

test("Artifact Worker serves only an exact SHA-256 allowlisted path", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/index.html`),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /game/);
});

test("Artifact Access bootstrap returns only to the configured Main origin", async () => {
  let assetCalls = 0;
  const env = artifactEnv();
  env.ASSETS.fetch = async () => {
    assetCalls += 1;
    return new Response("unexpected");
  };
  const response = await handleArtifactRequest(
    new Request("https://artifacts.arena.gotalab.dev/__arena_authorize?return=https://evil.example"),
    env,
    { authenticate },
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://arena.gotalab.dev/?artifact_access=ready");
  assert.equal(assetCalls, 0);
});

test("Artifact Worker serves the tree's own files with their content types", async () => {
  const image = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/assets/sprites.png`),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("Content-Type"), "image/png");
  const script = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/main.js`),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("Content-Type"), "text/javascript; charset=utf-8");
});

test("Dot segments are resolved by URL parsing before the Worker routes, never against the store", async () => {
  // `/artifacts/A/../B/x` reaches the Worker already normalized to
  // `/artifacts/B/x`; any literal dot segment that survives parsing arrives
  // encoded and is refused by the decode-mismatch check. Nothing composes a
  // store path from un-normalized input.
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${"b".repeat(64)}/../${hash}/index.html`),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(response.status, 200);
});

test("Artifact Worker serves the entry for the bare tree path", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/`),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.match(await response.text(), /game/);
});

for (const path of [
  "/artifacts/../index.html",
  "/artifacts/%2e%2e/index.html",
  `/artifacts/${hash}/%2e%2e/index.html`,
  `/artifacts/${hash}/..`,
  `/artifacts/${hash}//main.js`,
  `/artifacts/${hash}/a%00.js`,
  `/artifacts/${hash.toUpperCase()}/index.html`,
  "/artifacts/not-a-hash/index.html",
  `/artifacts/${hash}/missing.js`,
]) {
  test(`Artifact Worker rejects non-allowlisted path: ${path}`, async () => {
    const response = await handleArtifactRequest(
      new Request(`https://artifacts.arena.gotalab.dev${path}`),
      artifactEnv(),
      { authenticate },
    );
    assert.equal(response.status, 404);
  });
}

test("Artifact CSP removes network, forms, workers, and parent-origin privileges", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/index.html`),
    artifactEnv(),
    { authenticate },
  );
  const csp = response.headers.get("Content-Security-Policy");
  assert.match(csp!, /sandbox allow-scripts/);
  assert.match(csp!, /connect-src 'none'/);
  assert.match(csp!, /form-action 'none'/);
  assert.match(csp!, /worker-src 'none'/);
  assert.match(csp!, /frame-ancestors https:\/\/arena\.gotalab\.dev/);
  assert.doesNotMatch(csp!, /preview\.arena\.gotalab\.dev/);
  assert.doesNotMatch(csp!, /allow-same-origin/);
  // Tree assets load through tags, admitted by the tree's own base URL —
  // never by 'self', which the sandbox's opaque origin makes match nothing,
  // and never through active network channels: connect stays 'none' even
  // with a multi-file artifact. The URL is path-scoped to this one sha, so
  // one artifact cannot include another artifact's files.
  const treeBase = `https://artifacts.arena.gotalab.dev/artifacts/${"a".repeat(64)}/`;
  assert.match(csp!, new RegExp(`script-src 'unsafe-inline' ${treeBase.replaceAll("/", "\\/").replaceAll(".", "\\.")}`));
  assert.match(csp!, new RegExp(`img-src data: blob: ${treeBase.replaceAll("/", "\\/").replaceAll(".", "\\.")}`));
  assert.doesNotMatch(csp!, /'self'/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  // SAMEORIGIN/DENY would block the play iframe; CSP frame-ancestors names Main.
  assert.equal(response.headers.get("X-Frame-Options"), null);
});

test("Access-denied artifact responses deny framing", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/index.html`),
    artifactEnv(),
    { authenticate: async () => { throw new AccessDeniedError("no cookie"); } },
  );
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("artifact 200 and 404 tell Main the status so a blank frame is not judged", async () => {
  const found = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/index.html`, { method: "HEAD" }),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(found.status, 200);
  assert.equal(found.headers.get("Access-Control-Allow-Origin"), "https://arena.gotalab.dev");
  const missing = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${"b".repeat(64)}/index.html`, { method: "HEAD" }),
    artifactEnv(),
    { authenticate },
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("Access-Control-Allow-Origin"), "https://arena.gotalab.dev");
});

const tokenSecret = "s".repeat(48);

function tokenEnv() {
  return { ...artifactEnv(), ARTIFACT_TOKEN_SECRET: tokenSecret };
}

const denyAll = async () => { throw new Error("token paths must never consult Access"); };

test("a valid token serves the tree without any Access identity", async () => {
  const token = await mintArtifactToken(tokenSecret, 2_000_000_000);
  const response = await handleArtifactRequest(
    new Request(`https://cdn.arena.gotalab.dev/t/${token}/artifacts/${hash}/main.js`),
    tokenEnv(),
    { authenticate: denyAll, now: () => 1_900_000_000 },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/javascript; charset=utf-8");
  // The CSP admits exactly this token-prefixed tree, so relative references
  // inside the sealed files keep working under the capability path.
  assert.match(
    response.headers.get("Content-Security-Policy")!,
    new RegExp(`script-src 'unsafe-inline' https://cdn\\.arena\\.gotalab\\.dev/t/${token.replace(".", "\\.")}/artifacts/${hash}/`),
  );
});

test("an expired token is refused as a plain 404", async () => {
  const token = await mintArtifactToken(tokenSecret, 1_000);
  const response = await handleArtifactRequest(
    new Request(`https://cdn.arena.gotalab.dev/t/${token}/artifacts/${hash}/index.html`),
    tokenEnv(),
    { authenticate: denyAll, now: () => 1_900_000_000 },
  );
  assert.equal(response.status, 404);
});

test("a forged signature is refused without touching the asset store", async () => {
  let assetCalls = 0;
  const env = tokenEnv();
  env.ASSETS.fetch = async () => { assetCalls += 1; return new Response("unexpected"); };
  const response = await handleArtifactRequest(
    new Request(`https://cdn.arena.gotalab.dev/t/2000000000.${"f".repeat(64)}/artifacts/${hash}/index.html`),
    env,
    { authenticate: denyAll, now: () => 1_900_000_000 },
  );
  assert.equal(response.status, 404);
  assert.equal(assetCalls, 0);
});

test("token paths still reject traversal, and a tokenless path on the door needs Access it cannot have", async () => {
  const token = await mintArtifactToken(tokenSecret, 2_000_000_000);
  const denied = async () => { throw new AccessDeniedError("no cookie"); };
  for (const [path, status] of [
    [`/t/${token}/artifacts/${hash}/..%2fother`, 404],
    // Anything that is not exactly a token path — a malformed sha, a foreign
    // prefix — falls through to Access, and the door host has no Access
    // cookie to offer, so nothing tokenless is ever served there.
    [`/t/${token}/artifacts/short/index.html`, 401],
    [`/t/${token}/other/${hash}/index.html`, 401],
  ] as const) {
    const response = await handleArtifactRequest(
      new Request(`https://cdn.arena.gotalab.dev${path}`),
      tokenEnv(),
      { authenticate: denied, now: () => 1_900_000_000 },
    );
    assert.equal(response.status, status, path);
  }
});

test("a token path with no configured secret is a configuration error, never open", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://cdn.arena.gotalab.dev/t/2000000000.${"f".repeat(64)}/artifacts/${hash}/index.html`),
    artifactEnv(),
    { authenticate: denyAll, now: () => 1_900_000_000 },
  );
  assert.equal(response.status, 503);
});

test("public release opens the plain artifact door without Access", async () => {
  const env = { ...artifactEnv(), PUBLIC_RELEASE: "true" };
  const denyAuthenticate = async (): Promise<{ sub: string; email: string }> => {
    throw new Error("authenticate must not be called in public release");
  };
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/`),
    env,
    { authenticate: denyAuthenticate },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<h1>game</h1>");
});

test("Artifact runtime permits HTTP only when Main is an exact loopback origin", async () => {
  for (const mainOrigin of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
    const response = await handleArtifactRequest(
      new Request(`http://127.0.0.1:8788/artifacts/${hash}/index.html`),
      { ...artifactEnv(), MAIN_ORIGIN: mainOrigin },
      { authenticate },
    );
    assert.equal(response.status, 200, mainOrigin);
  }
});

test("Artifact runtime rejects a non-loopback HTTP Main origin", async () => {
  const response = await handleArtifactRequest(
    new Request(`https://artifacts.arena.gotalab.dev/artifacts/${hash}/index.html`),
    { ...artifactEnv(), MAIN_ORIGIN: "http://arena.gotalab.dev" },
    { authenticate },
  );
  assert.equal(response.status, 503);
});
