const PROTOCOL = "arena.game.v1";

function hostWindow() {
  return globalThis.window || globalThis;
}

/**
 * @param {{
 *   snapshot: () => object,
 *   getRevision: () => number,
 *   act: (action: object) => object,
 *   restart: () => object,
 *   reset: (seed: unknown) => object,
 * }} controller
 */
export function installArena(controller) {
  const win = hostWindow();
  /** @type {{ port: MessagePort, sessionId: string, generation: number } | null} */
  let conn = null;

  function pack(extra) {
    const state = controller.snapshot();
    return {
      protocol: PROTOCOL,
      sessionId: conn.sessionId,
      generation: conn.generation,
      revision: state.revision,
      state,
      ...extra,
    };
  }

  function onRequest(event) {
    const msg = event.data;
    if (!msg || msg.protocol !== PROTOCOL || !conn) return;
    if (msg.sessionId !== conn.sessionId || msg.generation !== conn.generation) return;
    if (msg.requestId == null) return;

    const requestId = msg.requestId;
    const command = msg.command;

    if (command === "observe") {
      conn.port.postMessage(pack({ type: "response", requestId, accepted: true }));
      return;
    }

    if (command === "act" || command === "restart") {
      if (msg.expectedRevision !== controller.getRevision()) {
        conn.port.postMessage(
          pack({
            type: "response",
            requestId,
            accepted: false,
            error: { code: "stale_revision", message: "Stale revision" },
          }),
        );
        return;
      }
      try {
        if (command === "restart") controller.restart();
        else controller.act(msg.action);
        conn.port.postMessage(pack({ type: "response", requestId, accepted: true }));
      } catch (err) {
        const code = err && err.code ? String(err.code) : "illegal_action";
        const message = err && err.message ? String(err.message) : "Illegal action";
        conn.port.postMessage(
          pack({
            type: "response",
            requestId,
            accepted: false,
            error: { code, message },
          }),
        );
      }
      return;
    }

    conn.port.postMessage(
      pack({
        type: "response",
        requestId,
        accepted: false,
        error: { code: "bad_request", message: "Unknown command" },
      }),
    );
  }

  win.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.protocol !== PROTOCOL || msg.type !== "connect") return;
    if (event.source !== win.parent) return;
    const port = event.ports && event.ports[0];
    if (!port) return;
    if (typeof msg.sessionId !== "string") return;
    if (!Number.isInteger(msg.generation)) return;

    if (conn && conn.port) {
      try {
        conn.port.onmessage = null;
        conn.port.close();
      } catch {
        /* ignore */
      }
    }

    conn = { port, sessionId: msg.sessionId, generation: msg.generation };
    port.onmessage = onRequest;
    if (typeof port.start === "function") port.start();
    const state = controller.snapshot();
    port.postMessage({
      protocol: PROTOCOL,
      type: "ready",
      sessionId: conn.sessionId,
      generation: conn.generation,
      accepted: true,
      revision: state.revision,
      state,
    });
  });

  const api = {
    reset(seed) {
      return controller.reset(seed);
    },
    snapshot() {
      return controller.snapshot();
    },
    act(action) {
      return controller.act(action);
    },
    restart() {
      return controller.restart();
    },
  };

  Object.defineProperty(win, "__ARENA_GAME__", {
    value: api,
    writable: false,
    configurable: true,
  });

  return api;
}
