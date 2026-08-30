/**
 * Every browser-storage key the app owns, and the only code that touches
 * localStorage or sessionStorage.
 *
 * Storage is a preference store, never a source of truth: a corrupt or
 * unavailable value must not block the playable path, so every read falls back
 * and every write is best-effort.
 */

export const THEME_KEY = "arena-theme";
export const ARTIFACT_ACCESS_READY_KEY = "arena-artifact-access-ready-at";
export const ARTIFACT_ACCESS_RETURN_KEY = "arena-artifact-access-return";

/** The per-release blind comparison key. */
export function comparisonKey(releaseId: string): string {
  return `arena-comparison-${releaseId}`;
}

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A full or blocked store must not break the page.
  }
}

export function readLocalJson(key: string, fallback: unknown): unknown {
  const raw = readLocal(key);
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key: string, value: unknown): void {
  writeLocal(key, JSON.stringify(value));
}

export function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignored, see readLocal
  }
}

export function removeSession(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignored, see readLocal
  }
}
