import { useEffect, useRef } from "react";
import { arenaToolDefinitions, type ArenaToolContext } from "../lib/arena-tools";
import { createLiveArenaToolContext } from "../lib/live-arena-tool-context";
import { resolveModelContext } from "../platform/model-context";

/** Registers the route's exact public tool set until its capability scope changes. */
export function useArenaWebMcpTools(context: ArenaToolContext, scopeKey: string): void {
  const contextRef = useRef(context);
  const scopeKeyRef = useRef(scopeKey);
  contextRef.current = context;
  scopeKeyRef.current = scopeKey;

  useEffect(() => {
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    const registration = new AbortController();
    let disposed = false;
    const registeredScopeKey = scopeKey;
    const liveContext = createLiveArenaToolContext(
      () => contextRef.current,
      () => !disposed && scopeKeyRef.current === registeredScopeKey,
    );
    void (async () => {
      try {
        for (const tool of arenaToolDefinitions(liveContext)) {
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
  }, [scopeKey]);
}
