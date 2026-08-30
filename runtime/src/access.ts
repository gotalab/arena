export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ALLOWED_EMAIL?: string;
  /** "true" once the site is publicly released: visitors are anonymous and
   * no Access application stands in front of the workers. Any other value
   * keeps the pre-release owner-only gate. */
  PUBLIC_RELEASE?: string;
}

/** The released site serves anonymous visitors; the Access JWT gate applies
 * only while this is off. */
export function isPublicRelease(env: AccessEnv): boolean {
  return env.PUBLIC_RELEASE === "true";
}

/** One anonymous visitor identity per authenticated exchange: the random
 * subject is minted at /api/session time and rides the CSRF token, so a
 * blind vote still names a stable per-session actor without any account. */
export function anonymousIdentity(): AccessIdentity {
  return Object.freeze({ sub: `anon-${crypto.randomUUID()}`, email: "" });
}

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  allowedEmail: string;
}

export interface AccessIdentity {
  readonly sub: string;
  readonly email: string;
}

export interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  [claim: string]: unknown;
}

export interface Jwks {
  keys?: Jwk[];
}

export interface VerifyOptions {
  now?: number;
  jwks?: Jwks;
  fetchImpl?: typeof fetch;
}

const jwksCache = new Map<string, { value: Jwks; expiresAt: number }>();
const encoder = new TextEncoder();

export class AccessConfigurationError extends Error {}
export class AccessDeniedError extends Error {}

export function accessConfig(env: AccessEnv): AccessConfig {
  const teamDomain = required(env.CF_ACCESS_TEAM_DOMAIN, "CF_ACCESS_TEAM_DOMAIN");
  const audience = required(env.CF_ACCESS_AUD, "CF_ACCESS_AUD");
  const allowedEmail = required(env.ALLOWED_EMAIL, "ALLOWED_EMAIL").toLowerCase();

  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    throw new AccessConfigurationError("CF_ACCESS_TEAM_DOMAIN must be a cloudflareaccess.com hostname");
  }
  if (!/^[a-f0-9]{32,128}$/i.test(audience)) {
    throw new AccessConfigurationError("CF_ACCESS_AUD is not a valid Access application audience");
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(allowedEmail)) {
    throw new AccessConfigurationError("ALLOWED_EMAIL must be an email address");
  }

  return { teamDomain: teamDomain.toLowerCase(), audience, allowedEmail };
}

export async function authenticateAccess(request: Request, env: AccessEnv, options: VerifyOptions = {}): Promise<AccessIdentity> {
  const config = accessConfig(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AccessDeniedError("Missing Cloudflare Access assertion");
  return verifyAccessJwt(token, config, options);
}

export async function verifyAccessJwt(token: string, config: AccessConfig, options: VerifyOptions = {}): Promise<AccessIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AccessDeniedError("Malformed Access assertion");

  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new AccessDeniedError("Unsupported Access assertion algorithm");
  }

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= now) {
    throw new AccessDeniedError("Expired Access assertion");
  }
  const nbf = payload.nbf;
  if (typeof nbf === "number" && Number.isFinite(nbf) && nbf > now + 30) {
    throw new AccessDeniedError("Access assertion is not active");
  }
  const expectedIssuer = `https://${config.teamDomain}`;
  if (stripTrailingSlash(payload.iss) !== expectedIssuer) {
    throw new AccessDeniedError("Unexpected Access assertion issuer");
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.audience)) {
    throw new AccessDeniedError("Unexpected Access assertion audience");
  }
  if (typeof payload.email !== "string" || payload.email.toLowerCase() !== config.allowedEmail) {
    throw new AccessDeniedError("Access assertion email is not allowed");
  }

  const jwks = options.jwks ?? await fetchJwks(config.teamDomain, options.fetchImpl ?? fetch);
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!jwk || jwk.kty !== "RSA") throw new AccessDeniedError("Unknown Access signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    Uint8Array.from(decodeBase64Url(parts[2])),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new AccessDeniedError("Invalid Access assertion signature");

  return Object.freeze({ sub: payload.sub as string, email: payload.email.toLowerCase() });
}

async function fetchJwks(teamDomain: string, fetchImpl: typeof fetch): Promise<Jwks> {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new AccessDeniedError("Unable to load Access signing keys");
  const value = await response.json() as Jwks;
  if (!Array.isArray(value.keys)) throw new AccessDeniedError("Invalid Access signing key response");
  jwksCache.set(teamDomain, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0 || /replace[-_ ]?me/i.test(value)) {
    throw new AccessConfigurationError(`Missing ${name}`);
  }
  return value;
}

function decodeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
  } catch {
    throw new AccessDeniedError("Malformed Access assertion encoding");
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function stripTrailingSlash(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\/$/, "") : value;
}
