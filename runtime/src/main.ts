import { AccessConfigurationError, AccessDeniedError, anonymousIdentity, authenticateAccess, isPublicRelease } from "./access.ts";
import type { AccessEnv, AccessIdentity } from "./access.ts";
import { parseAllowedOrigin } from "./origin.ts";
import { BLIND_CHOICE_RATE, SESSION_RATE, clientKey, memoryRateLimiter } from "./rate-limit.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { mainSecurityHeaders, withHeaders } from "./security.ts";
import { mintArtifactToken } from "./token.ts";
import { knownHtmlPath } from "../../src/lib/match-path.ts";

const sessionLimiter = memoryRateLimiter(SESSION_RATE);
const blindChoiceLimiter = memoryRateLimiter(BLIND_CHOICE_RATE);

export interface MainEnv extends AccessEnv {
  MAIN_ORIGIN?: string;
  ARTIFACT_ORIGIN?: string;
  /** The cookieless capability-door origin for sealed games (see token.ts).
   * Falls back to ARTIFACT_ORIGIN where the door is not yet configured. */
  ARTIFACT_CDN_ORIGIN?: string;
  ARTIFACT_TOKEN_SECRET?: string;
  CSRF_SECRET?: string;
  DB?: D1Database;
  ASSETS?: Fetcher;
}

export interface MainDependencies {
  authenticate?: (request: Request, env: MainEnv) => Promise<AccessIdentity>;
  sessionRateLimit?: RateLimiter;
  blindChoiceRateLimit?: RateLimiter;
}

type BlindChoice = {
  assignmentId: string;
  choice: "A" | "B" | "TIE" | "BOTH_BROKEN";
};

export default {
  fetch(request: Request, env: MainEnv): Promise<Response> {
    return handleMainRequest(request, env);
  },
};

export async function handleMainRequest(request: Request, env: MainEnv, dependencies: MainDependencies = {}): Promise<Response> {
  const authenticate = dependencies.authenticate ?? authenticateAccess;
  let identity;
  if (isPublicRelease(env)) {
    identity = anonymousIdentity();
  } else {
    try {
      identity = await authenticate(request, env);
    } catch (error) {
      if (error instanceof AccessConfigurationError) {
        return withHeaders(json({ error: "access_not_configured" }, 503), mainSecurityHeaders("'none'"));
      }
      if (error instanceof AccessDeniedError) {
        return withHeaders(json({ error: "access_denied" }, 401), mainSecurityHeaders("'none'"));
      }
      throw error;
    }
  }

  let expectedOrigin;
  let artifactOrigin;
  let cdnOrigin;
  try {
    expectedOrigin = requireUrl(env.MAIN_ORIGIN, "MAIN_ORIGIN");
    artifactOrigin = requireUrl(env.ARTIFACT_ORIGIN, "ARTIFACT_ORIGIN");
    cdnOrigin = env.ARTIFACT_CDN_ORIGIN ? requireUrl(env.ARTIFACT_CDN_ORIGIN, "ARTIFACT_CDN_ORIGIN") : artifactOrigin;
    requireSecret(env.CSRF_SECRET);
  } catch (error) {
    if (error instanceof AccessConfigurationError) {
      return withHeaders(json({ error: "runtime_not_configured" }, 503), mainSecurityHeaders("'none'"));
    }
    throw error;
  }
  // Both artifact doors may host a game frame, so both are frame sources.
  const frameSources = cdnOrigin === artifactOrigin ? artifactOrigin : `${artifactOrigin} ${cdnOrigin}`;
  const url = new URL(request.url);

  if (url.pathname === "/api/session" && request.method === "GET") {
    const limited = rateLimited(dependencies.sessionRateLimit ?? sessionLimiter, request, frameSources);
    if (limited) return limited;
    const csrfToken = await createCsrfToken(identity, env.CSRF_SECRET);
    return secure(json({ email: identity.email || null, csrfToken }), frameSources);
  }

  // A delivery capability for the sealed games (see runtime/src/token.ts):
  // only an Access-authenticated visitor reaches this handler, and the token
  // it mints is what lets that visitor's sandboxed game frames — which make
  // credentialless requests — load their trees. Short-lived by design; the
  // app fetches a fresh one per page load.
  if (url.pathname === "/api/artifact-token" && request.method === "GET") {
    const secret = env.ARTIFACT_TOKEN_SECRET;
    if (typeof secret !== "string" || secret.length < 32) return secure(json({ error: "runtime_not_configured" }, 503), frameSources);
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const token = await mintArtifactToken(secret, expiresAt);
    return secure(json({ base: `${cdnOrigin}/t/${token}`, expiresAt }), frameSources);
  }

  if (url.pathname === "/api/blind-choices" && request.method === "POST") {
    const limited = rateLimited(dependencies.blindChoiceRateLimit ?? blindChoiceLimiter, request, frameSources);
    if (limited) return limited;
    if (request.headers.get("Origin") !== expectedOrigin) {
      return secure(json({ error: "invalid_origin" }, 403), frameSources);
    }
    if (request.headers.get("Content-Type")?.split(";", 1)[0] !== "application/json") {
      return secure(json({ error: "content_type_required" }, 415), frameSources);
    }
    const csrfToken = request.headers.get("X-Arena-CSRF");
    // The vote's actor is the CSRF token's own subject: in public release the
    // per-request identity is a fresh anonymous id, so the token minted at
    // /api/session is what carries the visitor's stable session subject.
    const actorSub = isPublicRelease(env)
      ? await csrfTokenSubject(csrfToken, env.CSRF_SECRET)
      : (await verifyCsrfToken(csrfToken, identity, env.CSRF_SECRET) ? identity.sub : null);
    if (!actorSub) {
      return secure(json({ error: "invalid_csrf" }, 403), frameSources);
    }
    if (!env.DB) return secure(json({ error: "database_not_configured" }, 503), frameSources);

    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return secure(json({ error: "payload_too_large" }, 413), frameSources);
    }
    const body = await readJson(request, 4096);
    if (body === BODY_TOO_LARGE) return secure(json({ error: "payload_too_large" }, 413), frameSources);
    if (!body || !validChoice(body)) return secure(json({ error: "invalid_choice" }, 400), frameSources);
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      "INSERT INTO blind_choices (id, assignment_id, task_id, choice, actor_sub, created_at) "
      + "SELECT ?, assignment.id, assignment.task_id, ?, ?, datetime('now') "
      + "FROM blind_assignments AS assignment "
      + "JOIN tasks AS task ON task.id = assignment.task_id "
      + "WHERE assignment.id = ? AND task.visible = 1",
    ).bind(id, body.choice, actorSub, body.assignmentId).run();
    if (result.meta?.changes === 0) return secure(json({ error: "assignment_not_found" }, 404), frameSources);
    return secure(json({ id }, 201), frameSources);
  }

  if (url.pathname.startsWith("/api/")) return secure(json({ error: "not_found" }, 404), frameSources);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return secure(new Response("Method Not Allowed", { status: 405 }), frameSources);
  }
  if (url.pathname === "/robots.txt") {
    return secure(new Response("User-agent: *\nAllow: /\n\nSitemap: https://arena.gotalab.dev/sitemap.xml\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }), frameSources);
  }
  if (!env.ASSETS) return secure(json({ error: "assets_not_configured" }, 503), frameSources);
  const asset = await env.ASSETS.fetch(request);
  const unknownHtml = asset.status === 200
    && asset.headers.get("Content-Type")?.includes("text/html")
    && !knownHtmlPath(url.pathname);
  return secure(await withRouteMeta(asset, url, expectedOrigin, unknownHtml ? 404 : undefined), frameSources);
}

interface RouteMeta {
  title: string;
  description: string;
}

const RECORD_DESCRIPTION = "A playable benchmark of coding agents. You play the games they ship, you compare them, and the record is public.";

const NOT_FOUND_META: RouteMeta = {
  title: "Not found · Playable Arena",
  description: RECORD_DESCRIPTION,
};

const BENCHMARK_META: RouteMeta = {
  title: "Benchmark · Playable Arena",
  description: RECORD_DESCRIPTION,
};

const HOME_META: RouteMeta = {
  title: "Playable Arena",
  description: "Play what coding agents ship, compare their work blind, then inspect the evidence.",
};

const ROUTE_META: Record<string, RouteMeta> = {
  "/play": {
    title: "Play · Playable Arena",
    description: "Play the games they ship, then pick the one you would keep playing.",
  },
  "/benchmark": BENCHMARK_META,
  "/method": {
    title: "How we evaluate · Playable Arena",
    description: "The same assignment for every agent, three kinds of evidence kept apart, and an honesty contract for the public record.",
  },
};

/** The document metadata a route is shared under; unknown paths are 404. */
export function routeMeta(pathname: string): RouteMeta {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return HOME_META;
  const exact = ROUTE_META[path];
  if (exact) return exact;
  const task = /^\/task\/([a-z0-9-]{1,32})(?:\/(compare|review)|\/build\/[a-f0-9]{12})?$/.exec(path);
  if (task) {
    const name = task[1].toUpperCase();
    if (task[2] === "compare") {
      return { title: `${name} blind comparison · Playable Arena`, description: "Play two builds without names, then choose which one you would keep playing." };
    }
    if (task[2] === "review") {
      return { title: `${name} selected review · Playable Arena`, description: `Review the ${name} builds selected from detailed benchmark evidence, then make your own choice.` };
    }
    return { title: `${name} · Playable Arena`, description: `Play ${name} builds and inspect the benchmark evidence.` };
  }
  return NOT_FOUND_META;
}

/** Absolute canonical for a known HTML route. */
export function canonicalHref(pathname: string, origin: string): string | null {
  if (!knownHtmlPath(pathname)) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  return `${origin}${path}`;
}

/**
 * Stamp the SPA shell with the route's own title/description/og:url and
 * rel=canonical so a shared link previews as its page, not as the generic
 * shell. Pure string replacement over tags the shell is known to contain
 * (web/index.html). Unknown paths keep the shell canonical and are 404s.
 */
export function injectRouteMeta(html: string, pathname: string, origin: string): string {
  const meta = routeMeta(pathname);
  const href = canonicalHref(pathname, origin);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${meta.description}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${meta.title}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${meta.description}$2`);
  if (href) {
    out = out
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${href}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${href}$2`);
  }
  return out;
}

async function withRouteMeta(response: Response, url: URL, origin: string, status?: number): Promise<Response> {
  if (response.status !== 200 || !response.headers.get("Content-Type")?.includes("text/html")) return response;
  const html = injectRouteMeta(await response.text(), url.pathname, origin);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html, { status: status ?? response.status, headers });
}

export async function createCsrfToken(identity: AccessIdentity, secret: string | undefined): Promise<string> {
  requireSecret(secret);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const payload = `${identity.sub}.${expiresAt}`;
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

/** The verified subject a CSRF token was minted for, or null when the token
 * is missing, expired, or not ours. */
export async function csrfTokenSubject(token: string | null, secret: string | undefined): Promise<string | null> {
  try {
    requireSecret(secret);
    if (typeof token !== "string") return null;
    const separator = token.lastIndexOf(".");
    if (separator < 0) return null;
    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const payloadSeparator = payload.lastIndexOf(".");
    const sub = payload.slice(0, payloadSeparator);
    const expiresAt = Number(payload.slice(payloadSeparator + 1));
    if (sub.length === 0 || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
    const expected = await hmac(payload, secret);
    return timingSafeEqual(signature, expected) ? sub : null;
  } catch {
    return null;
  }
}

export async function verifyCsrfToken(token: string | null, identity: AccessIdentity, secret: string | undefined): Promise<boolean> {
  const sub = await csrfTokenSubject(token, secret);
  return sub !== null && sub === identity.sub;
}

function rateLimited(limiter: RateLimiter, request: Request, artifactOrigin: string): Response | null {
  const decision = limiter.consume(clientKey(request));
  if (decision.allowed) return null;
  const response = json({ error: "rate_limited" }, 429);
  response.headers.set("Retry-After", String(decision.retryAfterSeconds));
  return secure(response, artifactOrigin);
}

function secure(response: Response, artifactOrigin: string): Response {
  return withHeaders(response, mainSecurityHeaders(artifactOrigin));
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function requireUrl(value: string | undefined, name: string): string {
  const origin = parseAllowedOrigin(value);
  if (origin) return origin;
  if (typeof value !== "string" || value.length === 0 || /replace[-_ ]?me/i.test(value)) {
    throw new AccessConfigurationError(`Missing ${name}`);
  }
  throw new AccessConfigurationError(`${name} must be an HTTPS origin or an exact loopback HTTP origin`);
}

function requireSecret(value: string | undefined): asserts value is string {
  if (typeof value !== "string" || value.length < 32 || /replace[-_ ]?me/i.test(value)) {
    throw new AccessConfigurationError("Missing CSRF_SECRET");
  }
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

const BODY_TOO_LARGE = Symbol("body_too_large");

async function readJson(request: Request, maxBytes: number): Promise<unknown | typeof BODY_TOO_LARGE> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("payload_too_large");
        return BODY_TOO_LARGE;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function validChoice(body: unknown): body is BlindChoice {
  if (typeof body !== "object" || body === null) return false;
  const { assignmentId, choice } = body as { assignmentId?: unknown; choice?: unknown };
  return typeof assignmentId === "string"
    && assignmentId.length <= 128
    && typeof choice === "string"
    && ["A", "B", "TIE", "BOTH_BROKEN"].includes(choice);
}
