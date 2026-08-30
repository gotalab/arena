#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";

import { canonicalDirectorySha256 } from "../public-contract/scan-public.mjs";

const root = resolve(import.meta.dirname, "..");
const smokeOnly = process.argv.includes("--smoke");
const prepareOnly = process.argv.includes("--prepare-only");
const negativeSecretMode = process.argv.find((argument) => argument.startsWith("--negative-secrets="))?.split("=", 2)[1] ?? null;
if (negativeSecretMode && !["missing", "short"].includes(negativeSecretMode)) throw new Error("runtime_dev:invalid_negative_secret_mode");
const mainOrigin = "http://127.0.0.1:8787";
const artifactOrigin = "http://127.0.0.1:8788";
const wranglerVersion = "4.127.1";
const scratch = process.env.ARENA_RUNTIME_SCRATCH ?? mkdtempSync(join(tmpdir(), "arena-runtime-"));
const stateRoot = join(scratch, "state");
const mainStateRoot = join(stateRoot, "main");
const artifactStateRoot = join(stateRoot, "artifact");
const homeRoot = join(scratch, "home");
mkdirSync(mainStateRoot, { recursive: true });
mkdirSync(artifactStateRoot, { recursive: true });
mkdirSync(homeRoot);

const allowedEnvironmentKeys = new Set(["PATH", "LANG", "TERM", "NO_COLOR", "FORCE_COLOR", "CI", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]);
function isolatedEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowedEnvironmentKeys.has(key) || key.startsWith("LC_")));
}
const environment = {
  ...isolatedEnvironment({
    ...process.env,
    OPENAI_API_KEY: ["must", "not", "cross"].join("-"),
    HTTP_PROXY: ["http://user", "pass@example.invalid"].join(":"),
  }),
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: homeRoot,
  USERPROFILE: homeRoot,
  TMPDIR: scratch,
  TMP: scratch,
  TEMP: scratch,
  LANG: process.env.LANG ?? "C.UTF-8",
  WRANGLER_SEND_METRICS: "false",
};

let children = [];
let stopping = false;

function signalChild(child, name) {
  try {
    child.kill(name);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function fail(message) {
  throw new Error(`runtime_dev:${message}`);
}

function commandOfWrangler() {
  const configured = process.env.WRANGLER_BIN ? resolve(process.env.WRANGLER_BIN) : null;
  const local = resolve(root, "node_modules/.bin/wrangler");
  const candidates = [configured, existsSync(local) ? local : null, "wrangler"].filter(Boolean);
  for (const path of candidates) {
    const version = spawnSync(path, ["--version"], { encoding: "utf8", env: environment });
    if (version.status === 0 && `${version.stdout}\n${version.stderr}`.includes(wranglerVersion)) return path;
  }
  fail(`wrangler_missing_or_wrong_version: install pinned wrangler@${wranglerVersion} or set WRANGLER_BIN`);
}

function verifyChildEnvironment() {
  const keys = ["OPENAI_API_KEY", "HTTP_PROXY", "ARENA_PARENT_SECRET"];
  const probe = spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(${JSON.stringify(keys)}.filter((key) => process.env[key] != null)))`], {
    encoding: "utf8",
    env: environment,
  });
  if (probe.status !== 0 || probe.stdout !== "[]") fail("environment_isolation_failed");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? environment,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    fail(`${options.label ?? command}_failed:${result.status}`);
  }
  return result.stdout ?? "";
}

function expectCommandFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? environment,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 || (options.pattern && !options.pattern.test(output))) {
    fail(`${options.label ?? command}_did_not_fail_as_expected`);
  }
}

function materializeConfig(sourceName, outputName, assetDirectory = null) {
  const source = JSON.parse(readFileSync(resolve(root, "runtime", sourceName), "utf8"));
  delete source.$schema;
  source.main = resolve(root, "runtime", source.main);
  source.assets.directory = assetDirectory ?? resolve(root, "runtime", source.assets.directory);
  if (source.d1_databases) source.d1_databases[0].migrations_dir = resolve(root, "runtime/d1");
  const target = join(scratch, outputName);
  writeFileSync(target, `${JSON.stringify(source, null, 2)}\n`);
  return target;
}

function prepareArtifactAssets() {
  const accepted = resolve(root, "public-release/accepted");
  const destination = join(scratch, "artifact-assets");
  cpSync(accepted, destination, { recursive: true });
  const contract = JSON.parse(readFileSync(resolve(root, "public-contract/webmcp-probe.v1.json"), "utf8"));
  const probe = resolve(root, "public/__webmcp_probe");
  const digest = canonicalDirectorySha256(probe);
  if (contract.treeSha256 !== digest) fail("webmcp_probe_hash_mismatch");
  cpSync(probe, join(destination, "artifacts", digest), { recursive: true, errorOnExist: true });
  return { destination, probeSha256: digest };
}

function startWrangler(wrangler, name, config, persistRoot, port, inspectorPort) {
  const child = spawn(wrangler, ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-ip", "127.0.0.1", "--inspector-port", String(inspectorPort), "--persist-to", persistRoot, "--config", config], {
    cwd: scratch,
    // Keep Wrangler in the terminal's foreground process group. `pnpm run`
    // receives Ctrl-C before this script on some hosts; sharing the group
    // ensures Wrangler and workerd receive it too instead of becoming orphans.
    detached: false,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (stream, output) => stream.on("data", (chunk) => output.write(`[${name}] ${chunk}`));
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.stderr.write(`${name} exited unexpectedly (${signal ?? code})\n`);
      void stop(1);
    }
  });
  children.push(child);
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.once("error", () => rejectPromise(new Error(`runtime_dev:port_in_use:${port}`)));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolvePromise));
  });
}

async function waitFor(url, init = {}, expectedStatus = 200) {
  const deadline = Date.now() + 20_000;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      lastStatus = String(response.status);
      if (response.status === expectedStatus) return response;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  fail(`readiness_timeout:${url}:${lastStatus}:expected_${expectedStatus}`);
}

async function expectStatus(url, status, init = {}) {
  const response = await fetch(url, init);
  if (response.status !== status) fail(`unexpected_status:${new URL(url).pathname}:${response.status}:expected_${status}`);
  return response;
}

function requireHeader(response, name, pattern) {
  const value = response.headers.get(name) ?? "";
  if (!pattern.test(value)) fail(`header_mismatch:${name}`);
}

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) signalChild(child, "SIGTERM");
  await Promise.all(children.map((child) => new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
    child.once("exit", resolvePromise);
    setTimeout(resolvePromise, 1_500);
  })));
  for (const child of children) signalChild(child, "SIGKILL");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  rmSync(scratch, { recursive: true, force: true });
  process.exitCode = exitCode;
}

function stopForSignal(exitCode) {
  void stop(exitCode).finally(() => process.exit(exitCode));
}
process.once("SIGHUP", () => stopForSignal(129));
process.once("SIGINT", () => stopForSignal(130));
process.once("SIGTERM", () => stopForSignal(143));
process.once("exit", () => {
  for (const child of children) {
    try { signalChild(child, "SIGKILL"); } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
});

try {
  verifyChildEnvironment();
  const wrangler = commandOfWrangler();
  const buildEnvironment = {
    ...environment,
    VITE_PUBLIC_ARTIFACTS: "false",
    VITE_ARTIFACT_ORIGIN: artifactOrigin,
    VITE_RUNTIME_API: "true",
    VITE_WEBMCP_PROBE: "true",
    VITE_WEBMCP_PROBE_ARTIFACT: "true",
  };
  run(process.execPath, ["scripts/generate-runtime-fixture.mjs", "--check"], { env: buildEnvironment, label: "runtime_fixture" });
  run(process.execPath, ["scripts/build-runtime.mjs"], { env: buildEnvironment, label: "web_build" });
  const mainConfig = materializeConfig("wrangler.main.jsonc", "wrangler.main.json");
  const artifactAssets = prepareArtifactAssets();
  const artifactConfig = materializeConfig("wrangler.artifact.jsonc", "wrangler.artifact.json", artifactAssets.destination);
  if (negativeSecretMode === "short") {
    writeFileSync(join(scratch, ".dev.vars"), "CSRF_SECRET=short\nARTIFACT_TOKEN_SECRET=short\n", { mode: 0o600 });
  } else if (negativeSecretMode !== "missing") {
    writeFileSync(join(scratch, ".dev.vars"), `CSRF_SECRET=${randomBytes(32).toString("hex")}\nARTIFACT_TOKEN_SECRET=${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  }
  run(wrangler, ["d1", "migrations", "apply", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig], { cwd: scratch, label: "d1_migrate" });
  run(wrangler, ["d1", "execute", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig, "--file", resolve(root, "runtime/d1/fixture.sql")], { cwd: scratch, label: "d1_fixture" });
  if (prepareOnly) {
    console.log("Prepared isolated Arena runtime configuration and local D1 fixture.");
    await stop(0);
  } else {
    await Promise.all([8787, 8788, 9787, 9788].map(assertPortAvailable));
    startWrangler(wrangler, "artifact", artifactConfig, artifactStateRoot, 8788, 9788);
    startWrangler(wrangler, "main", mainConfig, mainStateRoot, 8787, 9787);
    if (negativeSecretMode) {
      await waitFor(`${mainOrigin}/api/session`, {}, 503);
      const firstArtifact = readdirSync(resolve(root, "public-release/accepted/artifacts"), { withFileTypes: true }).find((entry) => entry.isDirectory())?.name;
      if (!firstArtifact) fail("fixture_artifact_missing");
      await waitFor(`${artifactOrigin}/artifacts/${firstArtifact}/index.html`, { method: "HEAD" });
      await expectStatus(`${mainOrigin}/api/artifact-token`, 503);
      await expectStatus(`${artifactOrigin}/t/1.${"0".repeat(64)}/artifacts/${firstArtifact}/index.html`, 503, { method: "HEAD" });
      console.log(JSON.stringify({ schema: "arena.local-runtime-negative.v1", mode: negativeSecretMode, session: 503, mainToken: 503, artifactToken: 503, directArtifact: 200 }));
      await stop(0);
    } else {
      const sessionResponse = await waitFor(`${mainOrigin}/api/session`);
      const session = await sessionResponse.json();
      const firstArtifact = readdirSync(resolve(root, "public-release/accepted/artifacts"), { withFileTypes: true }).find((entry) => entry.isDirectory())?.name;
      if (!firstArtifact) fail("fixture_artifact_missing");
      await waitFor(`${artifactOrigin}/artifacts/${firstArtifact}/index.html`, { method: "HEAD" });
      console.log(`Arena runtime ready: Main ${mainOrigin} · Artifact ${artifactOrigin}`);
      if (smokeOnly) {
        const fixture = readFileSync(resolve(root, "runtime/d1/fixture.sql"), "utf8");
        const assignmentId = /blind_assignments \(id,[^\n]*?VALUES \('([^']+)'/.exec(fixture)?.[1];
        if (!assignmentId || typeof session.csrfToken !== "string") fail("smoke_fixture_identity");
        const taskId = assignmentId.split("--", 1)[0];
        if (!taskId) fail("smoke_task_identity");
        const mainPage = await expectStatus(`${mainOrigin}/play`, 200);
        requireHeader(mainPage, "Content-Security-Policy", /frame-src http:\/\/127\.0\.0\.1:8788/);
        await expectStatus(`${mainOrigin}/not-a-route`, 404);
        const directArtifact = await expectStatus(`${artifactOrigin}/artifacts/${firstArtifact}/index.html`, 200);
        requireHeader(directArtifact, "Content-Security-Policy", /frame-ancestors http:\/\/127\.0\.0\.1:8787/);
        await expectStatus(`${artifactOrigin}/artifacts/${artifactAssets.probeSha256}/index.html`, 200, { method: "HEAD" });
        await expectStatus(`${artifactOrigin}/artifacts/${firstArtifact}/missing.js`, 404);
        await expectStatus(`${artifactOrigin}/artifacts/${firstArtifact}/%252e%252e/index.html`, 404);
        const tokenResponse = await expectStatus(`${mainOrigin}/api/artifact-token`, 200);
        const token = await tokenResponse.json();
        if (typeof token.base !== "string" || !token.base.startsWith(`${artifactOrigin}/t/`)) fail("artifact_token_base");
        await expectStatus(`${token.base}/artifacts/${firstArtifact}/index.html`, 200, { method: "HEAD" });
        await expectStatus(`${artifactOrigin}/t/1.${"0".repeat(64)}/artifacts/${firstArtifact}/index.html`, 404, { method: "HEAD" });

        const choiceRequest = (body, headers = {}) => fetch(`${mainOrigin}/api/blind-choices`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Origin": mainOrigin, "X-Arena-CSRF": session.csrfToken, ...headers },
          body: JSON.stringify(body),
        });
        if ((await choiceRequest({ assignmentId, choice: "A" })).status !== 201) fail("smoke_choice_first");
        if ((await choiceRequest({ assignmentId, choice: "B" })).status !== 201) fail("smoke_choice_append");
        run(wrangler, ["d1", "execute", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig, "--command", `UPDATE tasks SET visible = 0 WHERE id = '${taskId}'`], { cwd: scratch, label: "d1_hide_task" });
        if ((await choiceRequest({ assignmentId, choice: "A" })).status !== 404) fail("smoke_hidden_assignment");
        run(wrangler, ["d1", "execute", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig, "--command", `UPDATE tasks SET visible = 1 WHERE id = '${taskId}'`], { cwd: scratch, label: "d1_show_task" });
        expectCommandFailure(wrangler, ["d1", "execute", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig, "--command", "PRAGMA foreign_keys = ON; INSERT INTO blind_choices (id, assignment_id, task_id, choice, actor_sub, created_at) VALUES ('fk-negative', 'missing', 'missing', 'A', 'smoke', datetime('now'))"], { cwd: scratch, label: "d1_foreign_key", pattern: /FOREIGN KEY constraint failed/i });
        if ((await choiceRequest({ assignmentId, choice: "A" }, { Origin: "http://localhost:8787" })).status !== 403) fail("smoke_origin_negative");
        if ((await choiceRequest({ assignmentId, choice: "NOPE" })).status !== 400) fail("smoke_choice_negative");
        if ((await choiceRequest({ assignmentId, choice: "A" }, { "X-Arena-CSRF": "invalid" })).status !== 403) fail("smoke_csrf_negative");
        const noType = await fetch(`${mainOrigin}/api/blind-choices`, {
          method: "POST", headers: { Origin: mainOrigin, "X-Arena-CSRF": session.csrfToken }, body: "{}",
        });
        if (noType.status !== 415) fail("smoke_content_type_negative");
        const oversizedBytes = new TextEncoder().encode(JSON.stringify({ assignmentId, choice: "A", padding: "x".repeat(5000) }));
        const oversized = await fetch(`${mainOrigin}/api/blind-choices`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Origin": mainOrigin, "X-Arena-CSRF": session.csrfToken },
          body: new ReadableStream({ start(controller) { controller.enqueue(oversizedBytes); controller.close(); } }),
          duplex: "half",
        });
        if (oversized.status !== 413) fail("smoke_payload_negative");
        const query = run(wrangler, ["d1", "execute", "arena-runtime-local", "--local", "--persist-to", mainStateRoot, "--config", mainConfig, "--json", "--command", "SELECT COUNT(*) AS n FROM blind_choices"], { cwd: scratch, label: "d1_readback" });
        if (!/"n"\s*:\s*2\b/.test(query)) fail("smoke_choice_readback");
        console.log(JSON.stringify({
          schema: "arena.local-runtime-smoke.v1",
          mainOrigin,
          artifactOrigin,
          knownArtifactTree: firstArtifact,
          routeStatuses: { play: 200, missing: 404 },
          artifactStatuses: { directGet: 200, probeHead: 200, tokenHead: 200, missing: 404, traversal: 404, forgedToken: 404 },
          choiceStatuses: { first: 201, duplicateAppend: 201, hiddenTask: 404, foreignKey: "rejected", origin: 403, invalidChoice: 400, csrf: 403, contentType: 415, payload: 413 },
          choiceRows: 2,
        }));
        await stop(0);
      }
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await stop(1);
}
