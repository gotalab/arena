/**
 * The one-time artifact-access handshake.
 *
 * Sealed artifacts are served from a separate origin so agent-built HTML never
 * shares this document's origin. That origin hands the reader back with
 * `?artifact_access=ready`; the marker is kept for the session so the redirect
 * happens once, not on every route change. The callback URL is a fixed
 * landing path; the deep link is restored from session storage before the
 * client router reads the location. Nothing here renders.
 */

import { artifactOrigin, isLocalHost } from "../platform/env";
import {
  ARTIFACT_ACCESS_READY_KEY,
  ARTIFACT_ACCESS_RETURN_KEY,
  readSession,
  removeSession,
  writeSession,
} from "../platform/storage";
import { normalizeAccessReturnPath } from "./access-path";

const MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** Is the isolated player reachable already?
 *  When the handshake returns, restore the stored pathname *before* the
 *  caller reads `window.location` — `replaceState` does not emit popstate. */
export function readArtifactAccessReady(): boolean {
  if (isLocalHost()) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get("artifact_access") === "ready") {
    writeSession(ARTIFACT_ACCESS_READY_KEY, String(Date.now()));
    const stored = readSession(ARTIFACT_ACCESS_RETURN_KEY);
    removeSession(ARTIFACT_ACCESS_RETURN_KEY);
    const path = stored ? normalizeAccessReturnPath(stored) : "/";
    params.delete("artifact_access");
    const rest = params.toString();
    const separator = path.includes("?") ? "&" : "?";
    window.history.replaceState(null, "", rest ? `${path}${separator}${rest}` : path);
    return true;
  }
  const readyAt = Number(readSession(ARTIFACT_ACCESS_READY_KEY));
  return Number.isFinite(readyAt) && Date.now() - readyAt < MAX_AGE_MS;
}

/** Leave for the handshake, remembering the full path the reader asked for. */
export function requestArtifactAccess(pathname: string): void {
  writeSession(ARTIFACT_ACCESS_RETURN_KEY, normalizeAccessReturnPath(pathname));
  window.location.replace(`${artifactOrigin()}/__arena_authorize`);
}
