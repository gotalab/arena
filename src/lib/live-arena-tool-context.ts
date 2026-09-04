import type { ArenaToolContext } from "./arena-tools";

/**
 * Keep one registered tool set live while same-route UI state changes.
 * Capability-boundary changes still invalidate the registration immediately.
 */
export function createLiveArenaToolContext(
  readContext: () => ArenaToolContext,
  authorized: () => boolean,
): ArenaToolContext {
  return new Proxy({} as ArenaToolContext, {
    get(_target, property: keyof ArenaToolContext) {
      if (property === "authorized") {
        return () => authorized() && readContext().authorized();
      }
      const context = readContext();
      const value = context[property];
      return typeof value === "function" ? value.bind(context) : value;
    },
  });
}
