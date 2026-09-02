// Parent bridge and window.__ARENA_GAME__ interface for Arena arcade platform

(function() {
  function setupBridge(game, ui) {
    // Expose window.__ARENA_GAME__
    window.__ARENA_GAME__ = {
      reset: function(seed) {
        game.reset(seed !== undefined ? seed : 10001);
        if (ui && ui.render) ui.render();
        return game.getVisibleState();
      },
      snapshot: function() {
        return game.snapshot();
      },
      act: function(action) {
        const result = game.act(action);
        if (ui && ui.render) ui.render();
        if (ui && ui.handleActionResult) ui.handleActionResult(action, result);
        return game.getVisibleState();
      },
      restart: function() {
        const state = game.restart();
        if (ui && ui.render) ui.render();
        if (ui && ui.onRestart) ui.onRestart();
        return state;
      },
      advance: function(ms) {
        game.advance(ms);
        if (ui && ui.render) ui.render();
      }
    };

    // Support the arena.game.v1 parent bridge
    let boundPort = null;
    let boundSessionId = null;
    let boundGeneration = null;

    window.addEventListener("message", function(event) {
      // Accept connection only from parent if in an iframe
      if (window.parent && window.parent !== window) {
        if (event.source !== window.parent) {
          return;
        }
      }

      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.protocol !== "arena.game.v1" || data.type !== "connect") return;

      const sessionId = data.sessionId;
      const generation = data.generation;
      const port = event.ports && event.ports[0];

      if (typeof sessionId !== "string" || typeof generation !== "number" || !port) {
        return;
      }

      // Bind the transferred port to that sessionId and generation
      boundPort = port;
      boundSessionId = sessionId;
      boundGeneration = generation;

      // Post ready envelope on port
      boundPort.postMessage({
        protocol: "arena.game.v1",
        type: "ready",
        sessionId: boundSessionId,
        generation: boundGeneration,
        accepted: true,
        revision: game.revision,
        state: game.getVisibleState()
      });

      // Listen for requests on port
      boundPort.onmessage = function(msgEvent) {
        const req = msgEvent.data;
        if (!req || typeof req !== "object") return;
        if (req.protocol !== "arena.game.v1" ||
            req.sessionId !== boundSessionId ||
            req.generation !== boundGeneration) {
          return;
        }

        handlePortRequest(req);
      };
    });

    function handlePortRequest(req) {
      if (!boundPort) return;
      const requestId = req.requestId;
      const command = req.command;

      if (command === "observe") {
        boundPort.postMessage({
          protocol: "arena.game.v1",
          type: "response",
          requestId: requestId,
          sessionId: boundSessionId,
          generation: boundGeneration,
          accepted: true,
          revision: game.revision,
          state: game.getVisibleState()
        });
        return;
      }

      if (command === "act") {
        const expectedRevision = req.expectedRevision;
        if (typeof expectedRevision !== "number" || expectedRevision !== game.revision) {
          boundPort.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId: requestId,
            sessionId: boundSessionId,
            generation: boundGeneration,
            accepted: false,
            revision: game.revision,
            state: game.getVisibleState(),
            error: {
              code: "STALE_REVISION",
              message: `Expected revision ${expectedRevision} but current revision is ${game.revision}`
            }
          });
          return;
        }

        const action = req.action;
        const result = game.act(action);

        if (!result.accepted) {
          boundPort.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId: requestId,
            sessionId: boundSessionId,
            generation: boundGeneration,
            accepted: false,
            revision: game.revision,
            state: game.getVisibleState(),
            error: {
              code: result.errorCode || "ILLEGAL_ACTION",
              message: result.errorMessage || "Action was rejected"
            }
          });
          return;
        }

        // Brief requirement: "Render the visible board before reporting a successful mutation."
        if (ui && ui.render) ui.render();
        if (ui && ui.handleActionResult) ui.handleActionResult(action, result);

        boundPort.postMessage({
          protocol: "arena.game.v1",
          type: "response",
          requestId: requestId,
          sessionId: boundSessionId,
          generation: boundGeneration,
          accepted: true,
          revision: game.revision,
          state: game.getVisibleState()
        });
        return;
      }

      if (command === "restart") {
        const expectedRevision = req.expectedRevision;
        if (typeof expectedRevision !== "number" || expectedRevision !== game.revision) {
          boundPort.postMessage({
            protocol: "arena.game.v1",
            type: "response",
            requestId: requestId,
            sessionId: boundSessionId,
            generation: boundGeneration,
            accepted: false,
            revision: game.revision,
            state: game.getVisibleState(),
            error: {
              code: "STALE_REVISION",
              message: `Expected revision ${expectedRevision} but current revision is ${game.revision}`
            }
          });
          return;
        }

        game.restart();

        // Render visible board before reporting
        if (ui && ui.render) ui.render();
        if (ui && ui.onRestart) ui.onRestart();

        boundPort.postMessage({
          protocol: "arena.game.v1",
          type: "response",
          requestId: requestId,
          sessionId: boundSessionId,
          generation: boundGeneration,
          accepted: true,
          revision: game.revision,
          state: game.getVisibleState()
        });
        return;
      }

      // Unrecognized command
      boundPort.postMessage({
        protocol: "arena.game.v1",
        type: "response",
        requestId: requestId,
        sessionId: boundSessionId,
        generation: boundGeneration,
        accepted: false,
        revision: game.revision,
        state: game.getVisibleState(),
        error: {
          code: "UNKNOWN_COMMAND",
          message: `Unrecognized command: ${command}`
        }
      });
    }
  }

  window.setupBridge = setupBridge;
})();
