import { useEffect } from "react";
import { blindToolDefinitions, type BlindToolContext } from "../lib/blind-tools";
import { resolveModelContext } from "../platform/model-context";

export function useBlindWebMcpTools(context: Omit<BlindToolContext, "authorized"> | null): void {
  useEffect(() => {
    if (!context) return undefined;
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    const registration = new AbortController();
    let disposed = false;
    const scoped: BlindToolContext = { ...context, authorized: () => !disposed };
    void (async () => {
      try {
        for (const tool of blindToolDefinitions(scoped)) {
          await modelContext.registerTool(tool, { signal: registration.signal });
        }
      } catch (error) {
        if (!disposed) console.warn("Arena Blind WebMCP registration failed", error);
      }
    })();
    return () => {
      disposed = true;
      registration.abort("Blind comparison changed");
    };
  }, [context]);
}
