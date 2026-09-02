/**
 * arena.game.v1 parent MessagePort bridge.
 * @param {{
 *   getState: () => object,
 *   observe: () => object,
 *   act: (action: object, expectedRevision: number) => { accepted: boolean, state: object, error?: {code:string,message:string} },
 *   restart: (expectedRevision: number) => { accepted: boolean, state: object, error?: {code:string,message:string} },
 *   getRevision: () => number,
 * }} handlers
 */
export function installArenaBridge(handlers) {
  /** @type {{ sessionId: string, generation: number, port: MessagePort } | null} */
  let binding = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.protocol !== "arena.game.v1" || data.type !== "connect") return;
    if (typeof data.sessionId !== "string") return;
    if (!Number.isInteger(data.generation)) return;
    const port = event.ports && event.ports[0];
    if (!port) return;

    binding = {
      sessionId: data.sessionId,
      generation: data.generation,
      port,
    };

    port.onmessage = (ev) => onRequest(ev.data);

    const state = handlers.getState();
    port.postMessage({
      protocol: "arena.game.v1",
      type: "ready",
      sessionId: binding.sessionId,
      generation: binding.generation,
      accepted: true,
      revision: state.revision,
      state,
    });
  });

  /** @param {any} data */
  function onRequest(data) {
    if (!binding) return;
    if (!data || data.protocol !== "arena.game.v1") return;
    if (data.sessionId !== binding.sessionId) return;
    if (data.generation !== binding.generation) return;
    if (typeof data.requestId !== "string" && typeof data.requestId !== "number") return;

    const { requestId, command } = data;
    /** @type {{ accepted: boolean, state: object, error?: {code:string,message:string} }} */
    let result;

    if (command === "observe") {
      const state = handlers.observe();
      result = { accepted: true, state };
    } else if (command === "act") {
      result = handlers.act(data.action, data.expectedRevision);
    } else if (command === "restart") {
      result = handlers.restart(data.expectedRevision);
    } else {
      result = {
        accepted: false,
        state: handlers.getState(),
        error: { code: "unknown_command", message: "Unsupported command" },
      };
    }

    /** @type {Record<string, unknown>} */
    const response = {
      protocol: "arena.game.v1",
      type: "response",
      requestId,
      sessionId: binding.sessionId,
      generation: binding.generation,
      accepted: result.accepted,
      revision: result.state.revision,
      state: result.state,
    };
    if (!result.accepted && result.error) {
      response.error = result.error;
    }
    binding.port.postMessage(response);
  }
}
