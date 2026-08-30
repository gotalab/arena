/**
 * Whether a sealed build on the stage is actually there to play.
 *
 * The blind vote used to unlock when a tab had been selected, even if the
 * iframe was still the floor colour, a 404, or a canvas that never painted
 * because it booted while `visibility: hidden`. A side is playable only
 * after its document has loaded; missing and failed frames stay unjudged.
 */

export type ArtifactProbe = "ok" | "missing" | "error" | "unknown";

export type PaneStatus = "loading" | "ready" | "missing" | "error";

/** Map an HTTP status from a HEAD/GET of the artifact URL to a probe result. */
export function classifyArtifactResponse(status: number): ArtifactProbe {
  if (status === 404) return "missing";
  if (status >= 200 && status < 300) return "ok";
  // Some hosts refuse HEAD; the iframe GET is then the real signal.
  if (status === 405 || status === 501) return "unknown";
  return "error";
}

/**
 * Ask whether the sealed tree is reachable. `unknown` means the probe could
 * not tell (CORS, abort, HEAD refused) and the iframe load must decide.
 * Fetch is injected so the Node tests can drive the classifier without a
 * network.
 */
export async function probeArtifact(
  src: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArtifactProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(src, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
    return classifyArtifactResponse(response.status);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** A blank, missing, or broken frame is not a playable side. */
export function paneIsPlayable(status: PaneStatus | undefined): boolean {
  return status === "ready";
}

/** True only when every mounted side has painted a real document. */
export function allPanesPlayable(
  statuses: Readonly<Record<string, PaneStatus | undefined>>,
  paneIds: readonly string[],
): boolean {
  if (paneIds.length === 0) return false;
  return paneIds.every((id) => paneIsPlayable(statuses[id]));
}
