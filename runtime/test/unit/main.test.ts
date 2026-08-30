import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHref, createCsrfToken, csrfTokenSubject, handleMainRequest, injectRouteMeta, routeMeta } from "../../src/main.ts";
import { memoryRateLimiter } from "../../src/rate-limit.ts";
import { verifyArtifactToken } from "../../src/token.ts";
import { AccessDeniedError } from "../../src/access.ts";

const identity = { sub: "access-user-id", email: "owner@example.com" };
const authenticate = async () => identity;
const env = {
  MAIN_ORIGIN: "https://arena.gotalab.dev",
  ARTIFACT_ORIGIN: "https://artifacts.arena.gotalab.dev",
  CSRF_SECRET: ["arena", "unit", "csrf", "secret", "material", "v1"].join("-"),
  DB: {
    prepare() {
      return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) };
    },
  } as unknown as D1Database,
};

test("Main Worker CSP allows frames only from the Artifact origin", async () => {
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/session"), env, { authenticate });
  const csp = response.headers.get("Content-Security-Policy");
  assert.match(csp!, /frame-src https:\/\/artifacts\.arena\.gotalab\.dev/);
  assert.doesNotMatch(csp!, /frame-src \*/);
  assert.match(csp!, /frame-ancestors 'none'/);
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Strict-Transport-Security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("X-Robots-Tag"), null);
});

test("write rejects a non-exact Origin before touching D1", async () => {
  let dbCalls = 0;
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ assignmentId: "a", choice: "A" }),
  }), {
    ...env,
    DB: {
      prepare() {
        dbCalls += 1;
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) };
      },
    } as unknown as D1Database,
  }, { authenticate });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "invalid_origin" });
  assert.equal(dbCalls, 0);
});

test("write rejects invalid CSRF and accepts a bound, unexpired token", async () => {
  const rejected = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "Content-Type": "application/json", "X-Arena-CSRF": "bad" },
    body: JSON.stringify({ assignmentId: "a", choice: "A" }),
  }), env, { authenticate });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await rejected.json(), { error: "invalid_csrf" });

  const csrf = await createCsrfToken(identity, env.CSRF_SECRET);
  assert.equal(await csrfTokenSubject(csrf, env.CSRF_SECRET), identity.sub);
  const accepted = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "Content-Type": "application/json", "X-Arena-CSRF": csrf },
    body: JSON.stringify({ assignmentId: "a", choice: "TIE" }),
  }), env, { authenticate });
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json() as { id: unknown };
  assert.equal(typeof acceptedBody.id, "string");
});

test("CSRF tokens are bound to the subject and reject expiry or wrong secrets", async () => {
  const csrf = await createCsrfToken(identity, env.CSRF_SECRET);
  assert.equal(await csrfTokenSubject(csrf, "another-random-secret-with-32-characters"), null);
  const [payload, signature] = csrf.split(".", 2);
  assert.ok(payload && signature);
  const expired = `${identity.sub}.1.${signature}`;
  assert.equal(await csrfTokenSubject(expired, env.CSRF_SECRET), null);
  assert.equal(await csrfTokenSubject(null, env.CSRF_SECRET), null);
});

test("write rejects an assignment whose task is no longer published", async () => {
  let statement = "";
  const hiddenEnv = {
    ...env,
    DB: {
      prepare(sql: string) {
        statement = sql;
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }) };
      },
    } as unknown as D1Database,
  };
  const csrf = await createCsrfToken(identity, env.CSRF_SECRET);
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "Content-Type": "application/json", "X-Arena-CSRF": csrf },
    body: JSON.stringify({ assignmentId: "withdrawn", choice: "A" }),
  }), hiddenEnv, {
    authenticate,
    blindChoiceRateLimit: memoryRateLimiter({ limit: 1, windowMs: 60_000 }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "assignment_not_found" });
  assert.match(statement, /JOIN tasks AS task ON task\.id = assignment\.task_id/);
  assert.match(statement, /task\.visible = 1/);
});

test("write validates content type, payload size, and choice before D1", async () => {
  let dbCalls = 0;
  const checkedEnv = {
    ...env,
    DB: {
      prepare() {
        dbCalls += 1;
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) };
      },
    } as unknown as D1Database,
  };
  const csrf = await createCsrfToken(identity, env.CSRF_SECRET);
  const request = (headers: Record<string, string>, body: unknown) => handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "X-Arena-CSRF": csrf, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), checkedEnv, { authenticate });
  assert.equal((await request({}, { assignmentId: "a", choice: "A" })).status, 415);
  assert.equal((await request({ "Content-Type": "application/json", "Content-Length": "4097" }, { assignmentId: "a", choice: "A" })).status, 413);
  assert.equal((await request({ "Content-Type": "application/json" }, { assignmentId: "a", choice: "A", padding: "x".repeat(5000) })).status, 413);
  assert.equal((await request({ "Content-Type": "application/json" }, { assignmentId: "a", choice: "NOPE" })).status, 400);
  assert.equal(dbCalls, 0);
});

test("artifact-token returns a signed capability on the configured CDN origin", async () => {
  const tokenSecret = "t".repeat(48);
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/artifact-token"), {
    ...env,
    ARTIFACT_CDN_ORIGIN: "https://cdn.arena.gotalab.dev",
    ARTIFACT_TOKEN_SECRET: tokenSecret,
  }, { authenticate });
  assert.equal(response.status, 200);
  const body = await response.json() as { base: string; expiresAt: number };
  assert.match(body.base, /^https:\/\/cdn\.arena\.gotalab\.dev\/t\/\d+\.[a-f0-9]{64}$/);
  const token = body.base.split("/t/")[1]!;
  assert.equal(await verifyArtifactToken(tokenSecret, token, Math.floor(Date.now() / 1000)), true);
  assert.equal(body.expiresAt, Number(token.split(".")[0]));
});

const SHELL_HTML = `<head><title>Playable Arena</title>
<meta name="description" content="default description" />
<link rel="canonical" href="https://arena.gotalab.dev/benchmark" />
<meta property="og:title" content="Playable Arena" />
<meta property="og:description" content="default description" />
<meta property="og:url" content="https://arena.gotalab.dev/benchmark" />
</head>`;

const RECORD_DESCRIPTION = "A playable benchmark of coding agents. You play the games they ship, you compare them, and the record is public.";

test("HTML responses carry the route's own title, description, canonical and og:url", async () => {
  const assets = {
    fetch: async () => new Response(SHELL_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Length": String(SHELL_HTML.length), ETag: '"abc"' },
    }),
  } as unknown as Fetcher;
  const response = await handleMainRequest(
    new Request("https://arena.gotalab.dev/benchmark"),
    { ...env, ASSETS: assets },
    { authenticate },
  );
  const html = await response.text();
  assert.match(html, /<title>Benchmark · Playable Arena<\/title>/);
  assert.match(html, /property="og:title" content="Benchmark · Playable Arena"/);
  assert.match(html, /property="og:url" content="https:\/\/arena\.gotalab\.dev\/benchmark"/);
  assert.match(html, /rel="canonical" href="https:\/\/arena\.gotalab\.dev\/benchmark"/);
  assert.doesNotMatch(html, /name="robots"/);
  assert.doesNotMatch(html, /default description/);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("ETag"), null);
  assert.equal(response.headers.get("X-Robots-Tag"), null);
});

test("unknown paths are 404; non-HTML assets pass through", async () => {
  assert.equal(routeMeta("/nope").title, "Not found · Playable Arena");
  assert.equal(routeMeta("/play/").title, "Play · Playable Arena");

  const htmlAssets = {
    fetch: async () => new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
  } as unknown as Fetcher;
  const missing = await handleMainRequest(
    new Request("https://arena.gotalab.dev/nope"),
    { ...env, ASSETS: htmlAssets },
    { authenticate },
  );
  assert.equal(missing.status, 404);
  const html = await missing.text();
  assert.match(html, /<title>Not found · Playable Arena<\/title>/);
  assert.doesNotMatch(html, /rel="canonical" href="https:\/\/arena\.gotalab\.dev\/nope"/);
  assert.equal(missing.headers.get("X-Robots-Tag"), null);

  const assets = {
    fetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  } as unknown as Fetcher;
  const response = await handleMainRequest(
    new Request("https://arena.gotalab.dev/data.json"),
    { ...env, ASSETS: assets },
    { authenticate },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
});

test("known HTML routes stay 200; junk HTML from the SPA fallback is not", async () => {
  let fetched = 0;
  const assets = {
    fetch: async () => {
      fetched += 1;
      return new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  } as unknown as Fetcher;
  const deps = { authenticate };
  const envWithAssets = { ...env, ASSETS: assets };

  for (const path of ["/", "/play", "/benchmark", "/task/delve", "/task/delve/compare", "/task/delve/build/0123456789ab", "/method"]) {
    const response = await handleMainRequest(new Request(`https://arena.gotalab.dev${path}`), envWithAssets, deps);
    assert.equal(response.status, 200, path);
  }
  const junk = await handleMainRequest(new Request("https://arena.gotalab.dev/privacy"), envWithAssets, deps);
  assert.equal(junk.status, 404);
  assert.ok(fetched > 0);
});

test("/robots.txt opens the released site and names the sitemap, never the SPA shell", async () => {
  let fetched = 0;
  const assets = {
    fetch: async () => {
      fetched += 1;
      return new Response(SHELL_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  } as unknown as Fetcher;
  const response = await handleMainRequest(
    new Request("https://arena.gotalab.dev/robots.txt"),
    { ...env, ASSETS: assets },
    { authenticate },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/plain/);
  const body = await response.text();
  assert.equal(body, "User-agent: *\nAllow: /\n\nSitemap: https://arena.gotalab.dev/sitemap.xml\n");
  assert.doesNotMatch(body, /<!doctype html>/i);
  assert.doesNotMatch(body, /Playable Arena/);
  assert.equal(fetched, 0);
});

test("task paths carry the task's own metadata", () => {
  assert.equal(routeMeta("/benchmark").title, "Benchmark · Playable Arena");
  assert.equal(routeMeta("/task/delve").title, "DELVE · Playable Arena");
  assert.equal(routeMeta("/task/delve/compare").title, "DELVE blind comparison · Playable Arena");
  assert.equal(routeMeta("/task/delve/build/0123456789ab").title, "DELVE · Playable Arena");
  assert.equal(routeMeta("/task/../etc").title, "Not found · Playable Arena");
});

test("/method carries its own metadata; /about is gone", () => {
  assert.equal(routeMeta("/method").title, "How we evaluate · Playable Arena");
  assert.equal(routeMeta("/about").title, "Not found · Playable Arena");
  assert.equal(routeMeta("/").description, "Play what coding agents ship, compare their work blind, then inspect the evidence.");
  assert.equal(routeMeta("/benchmark").description, RECORD_DESCRIPTION);
  assert.doesNotMatch(routeMeta("/").description, /You play both, then pick/);
  assert.doesNotMatch(routeMeta("/benchmark").description, /You play both, then pick/);
});

test("route meta stays concise and drops implementation vocabulary", () => {
  assert.equal(routeMeta("/play").description, "Play the games they ship, then pick the one you would keep playing.");
  assert.equal(routeMeta("/method").title, "How we evaluate · Playable Arena");
  for (const path of ["/", "/benchmark", "/play", "/method", "/task/delve", "/task/delve/compare"]) {
    assert.doesNotMatch(routeMeta(path).description, /\b(configuration|brief)\b/i, path);
    assert.doesNotMatch(routeMeta(path).title, /\b(configuration|brief)\b/i, path);
  }
});

test("known HTML routes get their own absolute canonical", () => {
  const origin = "https://arena.gotalab.dev";
  assert.equal(canonicalHref("/", origin), `${origin}/`);
  assert.equal(canonicalHref("/benchmark", origin), `${origin}/benchmark`);
  assert.equal(canonicalHref("/play", origin), `${origin}/play`);
  assert.equal(canonicalHref("/task/delve/", origin), `${origin}/task/delve`);
  assert.equal(canonicalHref("/task/delve/compare", origin), `${origin}/task/delve/compare`);
  assert.equal(canonicalHref("/task/delve/build/0123456789ab", origin), `${origin}/task/delve/build/0123456789ab`);
  assert.equal(canonicalHref("/about", origin), null);
  assert.equal(canonicalHref("/method", origin), `${origin}/method`);
  assert.equal(canonicalHref("/nope", origin), null);
  const stamped = injectRouteMeta(SHELL_HTML, "/", origin);
  assert.match(stamped, /rel="canonical" href="https:\/\/arena\.gotalab\.dev\/"/);
  assert.match(stamped, /property="og:url" content="https:\/\/arena\.gotalab\.dev\/"/);
});

test("the home, Play and task routes stay; obsolete routes are 404", async () => {
  let fetched = 0;
  const assets = {
    fetch: async () => {
      fetched += 1;
      return new Response("nope", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  } as unknown as Fetcher;
  const deps = { authenticate };
  const envWithAssets = { ...env, ASSETS: assets };

  const root = await handleMainRequest(new Request("https://arena.gotalab.dev/"), envWithAssets, deps);
  assert.equal(root.status, 200);
  assert.equal(await root.text(), "nope");
  assert.equal(fetched, 1);

  const about = await handleMainRequest(new Request("https://arena.gotalab.dev/about"), envWithAssets, deps);
  assert.equal(about.status, 404);
  assert.equal(fetched, 2);

  const play = await handleMainRequest(new Request("https://arena.gotalab.dev/play?ref=share"), envWithAssets, deps);
  assert.equal(play.status, 200);
  assert.equal(await play.text(), "nope");
  assert.equal(play.headers.get("Location"), null);
  assert.equal(fetched, 3);

  const trailing = await handleMainRequest(new Request("https://arena.gotalab.dev/play/"), envWithAssets, deps);
  assert.equal(trailing.status, 200);
  assert.equal(trailing.headers.get("Location"), null);
  assert.equal(fetched, 4);

  const match = await handleMainRequest(new Request("https://arena.gotalab.dev/task/ember"), envWithAssets, deps);
  assert.equal(match.status, 200);
  assert.equal(await match.text(), "nope");
  assert.equal(fetched, 5);
  assert.equal(match.headers.get("Location"), null);

  const results = await handleMainRequest(new Request("https://arena.gotalab.dev/results?ref=share"), envWithAssets, deps);
  assert.equal(results.status, 404);
  assert.equal(results.headers.get("Location"), null);
  assert.equal(fetched, 6);
});

test("session rate limiting is fail-closed per client IP", async () => {
  const sessionRateLimit = memoryRateLimiter({ limit: 2, windowMs: 60_000 });
  const deps = { authenticate, sessionRateLimit };
  const hit = (ip: string) => handleMainRequest(
    new Request("https://arena.gotalab.dev/api/session", { headers: { "CF-Connecting-IP": ip } }),
    env,
    deps,
  );
  assert.equal((await hit("203.0.113.10")).status, 200);
  assert.equal((await hit("203.0.113.10")).status, 200);
  const blocked = await hit("203.0.113.10");
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "rate_limited" });
  assert.equal(blocked.headers.get("Retry-After"), "60");
  assert.equal(blocked.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(blocked.headers.get("X-Frame-Options"), "DENY");
  assert.equal((await hit("203.0.113.11")).status, 200);
});

test("blind-choice rate limiting trips before D1", async () => {
  let dbCalls = 0;
  const limitedEnv = {
    ...env,
    DB: {
      prepare() {
        dbCalls += 1;
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }) }) };
      },
    } as unknown as D1Database,
  };
  const csrf = await createCsrfToken(identity, env.CSRF_SECRET);
  const deps = { authenticate, blindChoiceRateLimit: memoryRateLimiter({ limit: 1, windowMs: 60_000 }) };
  const post = () => handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: {
      Origin: env.MAIN_ORIGIN,
      "Content-Type": "application/json",
      "X-Arena-CSRF": csrf,
      "CF-Connecting-IP": "198.51.100.8",
    },
    body: JSON.stringify({ assignmentId: "a", choice: "A" }),
  }), limitedEnv, deps);
  assert.equal((await post()).status, 201);
  assert.equal(dbCalls, 1);
  const blocked = await post();
  assert.equal(blocked.status, 429);
  assert.equal(dbCalls, 1);
  assert.equal(blocked.headers.get("Retry-After"), "60");
});

test("public release serves anonymous visitors: no Access call, null email, votes carry the session subject", async () => {
  const publicEnv = { ...env, PUBLIC_RELEASE: "true" };
  const denyAuthenticate = async (): Promise<{ sub: string; email: string }> => {
    throw new Error("authenticate must not be called in public release");
  };

  const session = await handleMainRequest(
    new Request("https://arena.gotalab.dev/api/session"),
    publicEnv,
    { authenticate: denyAuthenticate },
  );
  assert.equal(session.status, 200);
  const body = await session.json() as { email: unknown; csrfToken: string };
  assert.equal(body.email, null);
  assert.match(body.csrfToken, /^anon-[0-9a-f-]{36}\.\d+\./);

  let boundActor: unknown;
  const db = {
    prepare() {
      return {
        bind: (...args: unknown[]) => {
          boundActor = args[2];
          return { run: async () => ({ success: true, meta: { changes: 1 } }) };
        },
      };
    },
  } as unknown as D1Database;
  const vote = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "Content-Type": "application/json", "X-Arena-CSRF": body.csrfToken },
    body: JSON.stringify({ assignmentId: "a", choice: "A" }),
  }), { ...publicEnv, DB: db }, { authenticate: denyAuthenticate });
  assert.equal(vote.status, 201);
  assert.match(String(boundActor), /^anon-[0-9a-f-]{36}$/);

  const forged = await handleMainRequest(new Request("https://arena.gotalab.dev/api/blind-choices", {
    method: "POST",
    headers: { Origin: env.MAIN_ORIGIN, "Content-Type": "application/json", "X-Arena-CSRF": "anon-x.9999999999.forged" },
    body: JSON.stringify({ assignmentId: "a", choice: "A" }),
  }), { ...publicEnv, DB: db }, { authenticate: denyAuthenticate });
  assert.equal(forged.status, 403);
});

test("Main runtime permits HTTP only for exact loopback origins", async () => {
  for (const origin of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) {
    const response = await handleMainRequest(new Request(`${origin}/api/session`), {
      ...env,
      MAIN_ORIGIN: origin,
      ARTIFACT_ORIGIN: "http://127.0.0.1:8788",
    }, { authenticate });
    assert.equal(response.status, 200, origin);
  }
});

test("Main runtime rejects a non-loopback HTTP configured origin", async () => {
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/session"), {
    ...env,
    MAIN_ORIGIN: "http://arena.gotalab.dev",
  }, { authenticate });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "runtime_not_configured" });
});

test("Access-denied requests retain their 401 boundary", async () => {
  const response = await handleMainRequest(new Request("https://arena.gotalab.dev/api/session"), env, {
    authenticate: async () => { throw new AccessDeniedError("no assertion"); },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "access_denied" });
});
