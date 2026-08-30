/**
 * Theme preference.
 *
 * Light is the product's intended first impression, so a reader with no stored
 * preference sees light regardless of what their operating system prefers. The
 * default is not decided here — `:root { color-scheme: light }` in `styles/base.css`
 * already resolves every `light-dark()` token on the very first paint, so there
 * is no flash of dark before React runs and nothing to synchronise.
 *
 * Only an explicit toggle is stored, and a stored preference wins from then on
 * via `:root[data-theme]`. This hook therefore just mirrors localStorage.
 */

import { useCallback, useEffect, useState } from "react";
import { readLocal, writeLocal, THEME_KEY } from "../platform/storage";

type Theme = "light" | "dark";

/** What a reader who has never touched the switch sees. Matches `:root`. */
export const DEFAULT_THEME: Theme = "light";

function readStoredTheme(): Theme | null {
  const saved = readLocal(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : null;
}

/** `theme` is what the reader currently sees. */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [stored, setStored] = useState<Theme | null>(readStoredTheme);

  useEffect(() => {
    if (stored) document.documentElement.dataset.theme = stored;
    else delete document.documentElement.dataset.theme;
  }, [stored]);

  const theme = stored ?? DEFAULT_THEME;

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    writeLocal(THEME_KEY, next);
    setStored(next);
  }, [theme]);

  return { theme, toggleTheme };
}
