/**
 * Shoal Platform Arena Parent Bridge (arena.game.v1)
 */
(function(root) {
  function initBridge(gameInstance, renderCallback) {
    let boundPort = null;
    let boundSessionId = null;
    let boundGeneration = null;

    function handleRequest(req) {
      if (!req || typeof req !== "object") return;
      if (req.protocol !== "arena.game.v1") return;
      if (req.sessionId !== boundSessionId || req.generation !== boundGeneration) return;

      const { requestId, command, expectedRevision, action } = req;

      function sendResponse(accepted, err = null) {
        const visState = gameInstance.getVisibleState();
        const resp = {
          protocol: "arena.game.v1",
          type: "response",
          requestId,
          sessionId: boundSessionId,
          generation: boundGeneration,
          accepted,
          revision: visState.revision,
          ...visState
        };
        if (!accepted && err) {
          resp.error = err;
        }
        boundPort.postMessage(resp);
      }

      if (command === "observe") {
        sendResponse(true);
        return;
      }

      if (command === "act") {
        const curState = gameInstance.getVisibleState();
        if (typeof expectedRevision !== "number" || expectedRevision !== curState.revision) {
          sendResponse(false, { code: "STALE_REVISION", message: "Expected revision mismatch" });
          return;
        }

        const res = gameInstance.act(action);
        if (!res) {
          sendResponse(false, { code: "ILLEGAL_ACTION", message: "Action is illegal or cannot be performed" });
          return;
        }

        if (renderCallback) renderCallback();
        sendResponse(true);
        return;
      }

      if (command === "restart") {
        const curState = gameInstance.getVisibleState();
        if (typeof expectedRevision !== "number" || expectedRevision !== curState.revision) {
          sendResponse(false, { code: "STALE_REVISION", message: "Expected revision mismatch" });
          return;
        }

        gameInstance.restart();
        if (renderCallback) renderCallback();
        sendResponse(true);
        return;
      }

      sendResponse(false, { code: "UNKNOWN_COMMAND", message: `Command ${command} not recognized` });
    }

    window.addEventListener("message", (event) => {
      // Accept connection ONLY from parent
      if (event.source !== window.parent && window.parent !== window) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.protocol !== "arena.game.v1" || data.type !== "connect") return;

      const { sessionId, generation } = data;
      const port = event.ports && event.ports[0];
      if (!port) return;

      boundPort = port;
      boundSessionId = sessionId;
      boundGeneration = generation;

      boundPort.onmessage = (e) => {
        handleRequest(e.data);
      };

      // Post ready envelope
      const visState = gameInstance.getVisibleState();
      boundPort.postMessage({
        protocol: "arena.game.v1",
        type: "ready",
        sessionId: boundSessionId,
        generation: boundGeneration,
        accepted: true,
        revision: visState.revision,
        ...visState
      });
    });
  }

  root.ShoalBridge = {
    initBridge
  };
})(typeof window !== 'undefined' ? window : globalThis);
