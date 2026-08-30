/**
 * Where the app is running, and where a sealed artifact is served from.
 *
 * The local-host test is written once here; three copies of it used to drift
 * across App and GameBrowser.
 *
 * The artifact origin is a per-environment fact, not a constant: preview and
 * production serve their sealed artifacts from different hosts, and the
 * one-time access handshake has to target the one this bundle was built for.
 * `VITE_ARTIFACT_ORIGIN` is threaded in at build time from the same
 * receipt-bound product build; the fallback is production, so an unset build
 * is unchanged.
 */

const CONFIGURED_ARTIFACT_ORIGIN = import.meta.env.VITE_ARTIFACT_ORIGIN;
const ARTIFACT_ORIGIN = CONFIGURED_ARTIFACT_ORIGIN ?? "https://artifacts.arena.gotalab.dev";
const RUNTIME_API = import.meta.env.VITE_RUNTIME_API === "true";

/** True on a local development host. */
export function isLocalHost(): boolean {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

/** Plain Vite development keeps local-only choices; the full local runtime
 * exercises the Worker API even on loopback. */
export function usesRuntimeApi(): boolean {
  return !isLocalHost() || RUNTIME_API;
}

/**
 * The signed delivery base for sealed games, e.g. ".../t/<token>".
 *
 * The game frames are sandboxed documents with an opaque origin, so their
 * subresource requests carry no cookies and can never pass Access; the main
 * Worker mints a signed capability path instead (runtime/src/token.ts) and
 * every relative reference inside a tree inherits it. Fetched once at boot;
 * when the fetch fails the plain Access-gated origin still serves the
 * single-file builds, so the site degrades instead of blanking.
 */
let artifactBase: string | null = null;

export async function initArtifactDelivery(): Promise<void> {
  if (isLocalHost()) return;
  try {
    const response = await fetch("/api/artifact-token");
    if (!response.ok) return;
    const body: unknown = await response.json();
    const base = (body as { base?: unknown }).base;
    if (typeof base === "string" && base.startsWith("https://")) artifactBase = base;
  } catch {
    // Offline or misconfigured: the fallback origin below still answers.
  }
}

/**
 * The URL of a content-addressed artifact. Locally the dev server serves it
 * from the sealed round directory; in production it is a separate origin, so
 * agent-built HTML never shares this document's origin.
 */
export function artifactUrl(sha256: string): string {
  if (isLocalHost()) {
    if (CONFIGURED_ARTIFACT_ORIGIN && import.meta.env.VITE_PUBLIC_ARTIFACTS !== "true") {
      return `${CONFIGURED_ARTIFACT_ORIGIN}/artifacts/${sha256}/index.html`;
    }
    return import.meta.env.VITE_PUBLIC_ARTIFACTS === "true"
      ? `/artifacts/${sha256}/index.html`
      : `/__arena_artifact/${sha256}/index.html`;
  }
  return `${artifactBase ?? ARTIFACT_ORIGIN}/artifacts/${sha256}/index.html`;
}

/** The origin that performs the one-time artifact-access handshake. */
export function artifactOrigin(): string {
  return ARTIFACT_ORIGIN;
}
