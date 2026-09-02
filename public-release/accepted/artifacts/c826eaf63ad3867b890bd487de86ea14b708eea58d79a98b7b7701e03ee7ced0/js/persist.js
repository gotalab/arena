const STORAGE_KEY = "lumen-yard.v1";

/**
 * @typedef {{
 *   restored: Record<string, boolean>,
 *   bestMoves: Record<string, number>,
 *   lastBoardId: string,
 *   sound: boolean,
 *   motion: boolean,
 * }} SaveData
 */

/** @returns {SaveData} */
export function defaultSave() {
  const prefersReduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    restored: {},
    bestMoves: {},
    lastBoardId: "first-light",
    sound: true,
    motion: !prefersReduced,
  };
}

/** @returns {SaveData} */
export function loadSave() {
  const base = defaultSave();
  try {
    if (typeof localStorage === "undefined") return base;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    return {
      restored: { ...base.restored, ...(data.restored || {}) },
      bestMoves: { ...base.bestMoves, ...(data.bestMoves || {}) },
      lastBoardId: typeof data.lastBoardId === "string" ? data.lastBoardId : base.lastBoardId,
      sound: typeof data.sound === "boolean" ? data.sound : base.sound,
      motion: typeof data.motion === "boolean" ? data.motion : base.motion,
    };
  } catch {
    return base;
  }
}

/** @param {SaveData} save */
export function writeSave(save) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}
