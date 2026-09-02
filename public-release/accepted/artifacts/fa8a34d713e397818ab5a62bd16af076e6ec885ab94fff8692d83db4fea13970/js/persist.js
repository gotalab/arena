const KEY = "lumen-yard-v1";

const defaults = () => ({
  restored: {},
  bests: {},
  lastLevelId: "first-light",
  sound: true,
  motion: null,
  seenInvite: false,
});

export function loadSave() {
  const base = defaults();
  try {
    if (typeof localStorage === "undefined") return base;
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    return {
      restored: parsed.restored && typeof parsed.restored === "object" ? parsed.restored : {},
      bests: parsed.bests && typeof parsed.bests === "object" ? parsed.bests : {},
      lastLevelId: typeof parsed.lastLevelId === "string" ? parsed.lastLevelId : "first-light",
      sound: parsed.sound !== false,
      motion: typeof parsed.motion === "boolean" ? parsed.motion : null,
      seenInvite: parsed.seenInvite === true,
    };
  } catch {
    return base;
  }
}

export function writeSave(data) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function restoredCount(save) {
  return Object.keys(save.restored).filter((k) => save.restored[k]).length;
}

export function bestTotal(save) {
  let n = 0;
  for (const v of Object.values(save.bests)) {
    if (typeof v === "number") n += v;
  }
  return n;
}
