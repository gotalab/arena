import { useEffect } from "react";
import { selectedReviewToolDefinitions, type SelectedReviewToolContext } from "../lib/selected-review-tools";
import { resolveModelContext } from "../platform/model-context";

export function useSelectedReviewWebMcpTools(context: Omit<SelectedReviewToolContext, "authorized">): void {
  useEffect(() => {
    const modelContext = resolveModelContext();
    if (!modelContext) return undefined;
    const registration = new AbortController();
    let disposed = false;
    const scoped: SelectedReviewToolContext = { ...context, authorized: () => !disposed };
    void (async () => {
      try {
        for (const tool of selectedReviewToolDefinitions(scoped)) {
          await modelContext.registerTool(tool, { signal: registration.signal });
        }
      } catch (error) {
        if (!disposed) console.warn("Arena selected review WebMCP registration failed", error);
      }
    })();
    return () => {
      disposed = true;
      registration.abort("Selected review changed");
    };
  }, [context]);
}
