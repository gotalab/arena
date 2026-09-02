const HSTS = "max-age=31536000; includeSubDomains";

export function mainSecurityHeaders(artifactOrigin: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      artifactOrigin === "'none'" ? "connect-src 'self'" : `connect-src 'self' ${artifactOrigin}`,
      `frame-src ${artifactOrigin}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": HSTS,
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

export function artifactSecurityHeaders(mainOrigin: string, treeBase?: string): Record<string, string> {
  // The sandbox directive gives the document an opaque origin, and an opaque
  // origin makes the 'self' keyword match nothing — external files inside the
  // tree would be blocked while inline code ran. URL matching does not depend
  // on the document's origin, so file responses pass their own tree's base
  // URL (".../artifacts/<sha256>/") and the source list admits exactly that
  // sealed tree: not another artifact's files, and no other host.
  const tree = treeBase ? ` ${treeBase}` : "";
  const csp = [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline'${tree}`,
    `style-src 'unsafe-inline'${tree}`,
    `img-src data: blob:${tree}`,
    `media-src data: blob:${tree}`,
    `font-src data:${tree}`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "worker-src 'none'",
    `frame-ancestors ${mainOrigin}`,
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": HSTS,
    // X-Frame-Options cannot name a foreign parent. DENY or SAMEORIGIN would
    // break the play iframe (artifacts are a separate origin). Clickjacking
    // of the game document is CSP frame-ancestors. DENY is only a legacy
    // complement when this response must not be framed at all.
    ...framingHeaders(mainOrigin),
    // The consumers of these responses are the sandboxed game documents
    // themselves, whose opaque origin belongs to no site — `same-site`
    // would block every subresource a tree loads (status 0, no violation).
    // Embedding is the purpose; access control is the capability token.
    "Cross-Origin-Resource-Policy": "cross-origin",
    // A sandboxed Artifact document has an opaque `null` origin. JavaScript
    // modules are CORS fetches even when their URL sits beside index.html, so
    // successful files from an already-authorized sealed tree must be readable
    // from that opaque document. Authentication, capability-token validation,
    // and the content-addressed tree allowlist happen before these headers are
    // applied. Non-tree responses stay readable only by the trusted Main.
    ...(mainOrigin === "'none'" ? {} : {
      "Access-Control-Allow-Origin": treeBase ? "*" : mainOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD",
      ...(treeBase ? {} : { Vary: "Origin" }),
    }),
  };
}

export function withHeaders(response: Response, headers: Record<string, string>): Response {
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
  return result;
}

function framingHeaders(ancestors: string): Record<string, string> {
  if (ancestors === "'none'") return { "X-Frame-Options": "DENY" };
  return {};
}
