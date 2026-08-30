/**
 * The Access handshake lands on a fixed callback URL. The path the reader
 * asked for is stored separately and must be a same-origin site path, never
 * an open redirect.
 */

const ACCESS_RETURN_PATH = /^\/(?:|play|benchmark|method|task\/[a-z0-9-]{1,32}(?:\/compare|\/build\/[a-f0-9]{12})?)$/;

/** Drop unsafe query/hash input and refuse anything that is not a site path.
 * The one explicit production probe flag survives only on `/play`; every
 * other query is discarded. Unknown input becomes `/`, never `/play`. */
export function normalizeAccessReturnPath(pathname: string): string {
  const [raw = "", rawQuery = ""] = pathname.split("?", 2);
  const trimmed = raw.replace(/\/+$/, "") || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (ACCESS_RETURN_PATH.test(withSlash)) {
    const query = new URLSearchParams(rawQuery.split("#")[0]);
    return withSlash === "/play" && query.get("webmcp-probe") === "1"
      ? "/play?webmcp-probe=1"
      : withSlash;
  }
  return "/";
}
