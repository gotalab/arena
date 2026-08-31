import { useEffect, useState } from "react";
import { gameToolDefinitions, type PublicGameTaskManifest } from "../lib/game-tools";
import { FrameGameChannel } from "../platform/frame-game-channel";

export type WebMcpGameToolStatus = "waiting" | "unsupported" | "connecting" | "ready" | "error";

interface UseWebMcpGameToolsOptions {
  frame: HTMLIFrameElement | null;
  generation: number;
  manifest: PublicGameTaskManifest | null;
}

/** Owns tool registration for exactly one active frame generation. */
export function useWebMcpGameTools({ frame, generation, manifest }: UseWebMcpGameToolsOptions): WebMcpGameToolStatus {
  const [status, setStatus] = useState<WebMcpGameToolStatus>("waiting");

  useEffect(() => {
    if (!frame || !manifest) {
      setStatus("waiting");
      return undefined;
    }
    const modelContext = document.modelContext;
    if (!modelContext) {
      setStatus("unsupported");
      return undefined;
    }
    const frameWindow = frame.contentWindow;
    if (!frameWindow) {
      setStatus("error");
      return undefined;
    }

    let disposed = false;
    const registration = new AbortController();
    const channel = new FrameGameChannel(frameWindow, generation, undefined, manifest.stateSchema);
    setStatus("connecting");
    void (async () => {
      try {
        await channel.ready();
        if (disposed) return;
        for (const tool of gameToolDefinitions(channel, manifest)) {
          await modelContext.registerTool(tool, { signal: registration.signal });
        }
        if (!disposed) setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    })();

    return () => {
      disposed = true;
      registration.abort("Arena route or active game changed");
      channel.close();
    };
  }, [frame, generation, manifest]);

  return status;
}
