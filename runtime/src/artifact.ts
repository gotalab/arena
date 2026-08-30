import { AccessConfigurationError, AccessDeniedError, authenticateAccess, isPublicRelease } from "./access.ts";
import type { AccessEnv, AccessIdentity } from "./access.ts";
import { parseAllowedOrigin } from "./origin.ts";
import { artifactSecurityHeaders, withHeaders } from "./security.ts";
import { verifyArtifactToken } from "./token.ts";

export interface ArtifactEnv extends AccessEnv {
  MAIN_ORIGIN?: string;
  ARTIFACT_TOKEN_SECRET?: string;
  ASSETS?: Fetcher;
}

export interface ArtifactDependencies {
  authenticate?: (request: Request, env: ArtifactEnv) => Promise<AccessIdentity>;
  now?: () => number;
}

/**
 * An artifact is a sealed content-addressed file tree with index.html as its
 * entry: `/artifacts/<sha256>/` serves the entry, and any file inside the
 * tree is reachable at its relative path. Segments are allowlisted to a
 * conservative character set and dot-segments are rejected outright, so no
 * request can address anything outside its own tree.
 *
 * Two doors open onto the same store:
 * - `/artifacts/...` is the Access-gated door for a signed-in browser.
 * - `/t/<token>/artifacts/...` is the capability door: the token is a signed
 *   expiry minted by the main Worker for authenticated visitors (token.ts),
 *   verified here without any cookie. Sandboxed game documents have an
 *   opaque origin and make credentialless subresource requests, so cookie
 *   auth can never reach them; the token rides the path instead, and every
 *   relative reference inside a tree inherits it for free.
 */
const ARTIFACT_PATH = /^\/artifacts\/([a-f0-9]{64})(\/[A-Za-z0-9._/-]*)?$/;
const TOKEN_PATH = /^\/t\/([0-9]{1,12}\.[a-f0-9]{64})(\/artifacts\/[a-f0-9]{64}(?:\/[A-Za-z0-9._/-]*)?)$/;
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]+$/;
const AUTHORIZE_PATH = "/__arena_authorize";

/** Sealed asset types the trees are expected to carry; anything else ships as
 * a download-safe opaque body. Sniffing stays off (nosniff) either way. */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
};

function contentTypeFor(subpath: string): string {
  const extension = subpath.slice(subpath.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export default {
  fetch(request: Request, env: ArtifactEnv): Promise<Response> {
    return handleArtifactRequest(request, env);
  },
};

export async function handleArtifactRequest(request: Request, env: ArtifactEnv, dependencies: ArtifactDependencies = {}): Promise<Response> {
  const authenticate = dependencies.authenticate ?? authenticateAccess;
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));

  const mainOrigin = parseAllowedOrigin(env.MAIN_ORIGIN);
  if (!mainOrigin) return secured("Runtime is not configured", 503, "'none'");

  if (request.method !== "GET" && request.method !== "HEAD") return secured("Method Not Allowed", 405, mainOrigin);

  const url = new URL(request.url);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return secured("Not Found", 404, mainOrigin);
  }
  if (decodedPath !== url.pathname) return secured("Not Found", 404, mainOrigin);

  // The capability door authenticates by signature, never by cookie, so it is
  // checked before Access. An invalid or expired token is a plain 404: the
  // path neither confirms nor denies what a better token would reach.
  const tokenMatch = TOKEN_PATH.exec(decodedPath);
  if (tokenMatch) {
    const secret = env.ARTIFACT_TOKEN_SECRET;
    if (typeof secret !== "string" || secret.length < 32) return secured("Runtime is not configured", 503, mainOrigin);
    if (!await verifyArtifactToken(secret, tokenMatch[1]!, now())) return secured("Not Found", 404, mainOrigin);
    return serveTree(request, env, url, tokenMatch[2]!, mainOrigin, `${url.origin}/t/${tokenMatch[1]}`);
  }

  // In public release the sealed trees are public record; the plain door
  // opens like the capability door. Pre-release it stays owner-only.
  if (!isPublicRelease(env)) {
    try {
      await authenticate(request, env);
    } catch (error) {
      if (error instanceof AccessConfigurationError) return secured("Access is not configured", 503, "'none'");
      if (error instanceof AccessDeniedError) return secured("Unauthorized", 401, "'none'");
      throw error;
    }
  }

  if (decodedPath === AUTHORIZE_PATH) {
    // Fixed callback only. The client restores the deep link it stored; the
    // landing URL itself is intentionally the root shell.
    return withHeaders(new Response(null, {
      status: 302,
      headers: { Location: `${mainOrigin}/?artifact_access=ready` },
    }), artifactSecurityHeaders(mainOrigin));
  }
  return serveTree(request, env, url, decodedPath, mainOrigin, url.origin);
}

/** Serve one file of one sealed tree; `prefixOrigin` is the base every
 * relative reference inside the tree resolves under (the plain origin, or
 * the origin plus the capability token). */
async function serveTree(
  request: Request,
  env: ArtifactEnv,
  url: URL,
  artifactPath: string,
  mainOrigin: string,
  prefixOrigin: string,
): Promise<Response> {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return secured("Artifact assets are not configured", 503, mainOrigin);
  const match = ARTIFACT_PATH.exec(artifactPath);
  if (!match) return secured("Not Found", 404, mainOrigin);
  // Normalize `/artifacts/<sha>` and a trailing slash to the tree's entry,
  // then re-validate every segment: the regex bounds the alphabet, this
  // rejects dot-segments and empty segments, so `..` and `//` never reach
  // the asset store in any encoding (decodeURIComponent ran above, and a
  // path whose decoding differs from the raw path was already refused).
  const subpath = (match[2] ?? "/").replace(/^\//, "") || "index.html";
  const segments = subpath.split("/");
  if (!segments.every((segment) => SEGMENT.test(segment))) return secured("Not Found", 404, mainOrigin);

  const assetUrl = new URL(`/artifacts/${match[1]}/${segments.join("/")}`, url.origin);
  const object = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  if (!object.ok) return secured("Not Found", 404, mainOrigin);
  const body = request.method === "HEAD" ? null : object.body;
  return withHeaders(new Response(body, {
    status: 200,
    headers: { "Content-Type": contentTypeFor(subpath) },
  }), artifactSecurityHeaders(mainOrigin, `${prefixOrigin}/artifacts/${match[1]}/`));
}

function secured(message: string, status: number, mainOrigin: string): Response {
  return withHeaders(new Response(message, { status }), artifactSecurityHeaders(mainOrigin));
}
