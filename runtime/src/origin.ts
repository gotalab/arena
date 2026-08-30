/**
 * Validate a configured origin shared by the Main and Artifact Workers.
 *
 * Production origins must use HTTPS. Local development uses two plain HTTP
 * Workers, so HTTP is accepted only for the exact loopback hostnames that
 * browsers and local servers use: 127.0.0.1, localhost, and ::1.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Return the canonical origin, or null when the value is not allowed. */
export function parseAllowedOrigin(value: string | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || /replace[-_ ]?me/i.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.pathname !== "/") return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(normalizeHostname(url.hostname))) return url.origin;
  return null;
}

/** Whether a configured value is an allowed Main/Artifact origin. */
export function isAllowedOrigin(value: string | undefined): boolean {
  return parseAllowedOrigin(value) !== null;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}
