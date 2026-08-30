/**
 * Signed artifact-delivery tokens.
 *
 * The sealed games are sandboxed documents with an opaque origin, and opaque
 * origins make credentialless subresource requests — cookie auth (Cloudflare
 * Access) can never reach them. Delivery therefore moves to a capability
 * path: `/t/<exp>.<sig>/artifacts/<sha256>/<file>`, where every relative
 * reference inside a tree resolves under the same token prefix for free.
 *
 * The token is `exp` (unix seconds) and hex HMAC-SHA256 over `v1:<exp>`,
 * minted by the main Worker for Access-authenticated visitors only and
 * verified here without any cookie. The scope is the whole artifact store:
 * every authenticated visitor can already reach every artifact through the
 * site, so a narrower scope would add length, not security. Rotating the
 * secret revokes everything outstanding.
 */

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time equality via digest comparison, so a sig can't be probed byte by byte. */
async function digestsEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < x.length; index += 1) diff |= x[index]! ^ y[index]!;
  return diff === 0;
}

export async function mintArtifactToken(secret: string, expiresAtSeconds: number): Promise<string> {
  return `${expiresAtSeconds}.${await hmacHex(secret, `v1:${expiresAtSeconds}`)}`;
}

export const ARTIFACT_TOKEN = /^([0-9]{1,12})\.([a-f0-9]{64})$/;

export async function verifyArtifactToken(secret: string, token: string, nowSeconds: number): Promise<boolean> {
  const match = ARTIFACT_TOKEN.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) return false;
  return digestsEqual(match[2]!, await hmacHex(secret, `v1:${expiresAt}`));
}
