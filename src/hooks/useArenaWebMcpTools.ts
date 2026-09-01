import { useEffect } from "react";
import { arenaToolDefinitions, type ArenaToolContext } from "../lib/arena-tools";
import { resolveModelContext } from "../platform/model-context";

/** Registers the route's exact public tool set and aborts it on every change. */
export function useArenaWebMcpTools(context: ArenaToolContext): void {
  useEffect(() => {
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    const registration = new AbortController();
    let disposed = false;
    void (async () => {
      try {
        for (const tool of arenaToolDefinitions(context)) {
          await modelContext.registerTool(tool, { signal: registration.signal });
        }
      } catch (error) {
        if (!disposed) console.warn("Arena WebMCP registration failed", error);
      }
    })();
    return () => {
      disposed = true;
      registration.abort("Arena route or identity state changed");
    };
  }, [context]);
}
