/* arena.game.v1 parent bridge */
(function (global) {
  "use strict";

  function publicState(snap) {
    return {
      phase: snap.phase,
      tick: snap.tick,
      elapsedMs: snap.elapsedMs,
      seed: snap.seed,
      attempt: snap.attempt,
      revision: snap.revision,
      pool: snap.pool,
      pearls: snap.pearls,
      sessionBest: snap.sessionBest,
      moves: snap.moves,
      rank: snap.rank,
      rankLadder: snap.rankLadder.slice(),
      gridWidth: snap.gridWidth,
      gridHeight: snap.gridHeight,
      urchinsTotal: snap.urchinsTotal,
      flagsPlaced: snap.flagsPlaced,
      urchinsLeft: snap.urchinsLeft,
      tideFraction: snap.tideFraction,
      firstTurnDone: snap.firstTurnDone,
      stungAt: snap.stungAt ? { x: snap.stungAt.x, y: snap.stungAt.y } : null,
      rows: snap.rows.slice(),
    };
  }

  function attachArenaBridge(api) {
    var bound = null;

    function envelope(type, sessionId, generation, extra) {
      var snap = api.snapshot();
      var msg = {
        protocol: "arena.game.v1",
        type: type,
        sessionId: sessionId,
        generation: generation,
        accepted: extra.accepted,
        revision: snap.revision,
        state: publicState(snap),
      };
      if (extra.requestId != null) msg.requestId = extra.requestId;
      if (extra.error) msg.error = extra.error;
      return msg;
    }

    function handle(port, sessionId, generation, ev) {
      var data = ev && ev.data;
      if (!data || typeof data !== "object") return;
      if (data.protocol !== "arena.game.v1") return;
      if (data.sessionId !== sessionId) return;
      if (data.generation !== generation) return;
      if (data.type && data.type !== "request") return;
      var requestId = data.requestId;
      var command = data.command;
      if (requestId == null || typeof command !== "string") {
        port.postMessage(
          envelope("response", sessionId, generation, {
            accepted: false,
            requestId: requestId,
            error: { code: "bad_request", message: "missing command" },
          })
        );
        return;
      }
      if (command === "observe") {
        port.postMessage(
          envelope("response", sessionId, generation, { accepted: true, requestId: requestId })
        );
        return;
      }
      if (command === "act" || command === "restart") {
        var snap = api.snapshot();
        if (!Number.isInteger(data.expectedRevision)) {
          port.postMessage(
            envelope("response", sessionId, generation, {
              accepted: false,
              requestId: requestId,
              error: { code: "bad_request", message: "expectedRevision required" },
            })
          );
          return;
        }
        if (data.expectedRevision !== snap.revision) {
          port.postMessage(
            envelope("response", sessionId, generation, {
              accepted: false,
              requestId: requestId,
              error: { code: "stale", message: "stale revision" },
            })
          );
          return;
        }
        if (command === "restart") {
          api.restart();
          api.render();
          port.postMessage(
            envelope("response", sessionId, generation, { accepted: true, requestId: requestId })
          );
          return;
        }
        var action = data.action;
        if (!action || typeof action !== "object") {
          port.postMessage(
            envelope("response", sessionId, generation, {
              accepted: false,
              requestId: requestId,
              error: { code: "illegal", message: "missing action" },
            })
          );
          return;
        }
        var before = snap.revision;
        api.act(action);
        var after = api.snapshot();
        if (after.revision === before) {
          port.postMessage(
            envelope("response", sessionId, generation, {
              accepted: false,
              requestId: requestId,
              error: { code: "illegal", message: "illegal action" },
            })
          );
          return;
        }
        api.render();
        port.postMessage(
          envelope("response", sessionId, generation, { accepted: true, requestId: requestId })
        );
        return;
      }
      port.postMessage(
        envelope("response", sessionId, generation, {
          accepted: false,
          requestId: requestId,
          error: { code: "bad_request", message: "unknown command" },
        })
      );
    }

    global.addEventListener("message", function (ev) {
      if (ev.source !== global.parent) return;
      var d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.protocol !== "arena.game.v1" || d.type !== "connect") return;
      if (typeof d.sessionId !== "string") return;
      if (!Number.isInteger(d.generation)) return;
      var port = ev.ports && ev.ports[0];
      if (!port) return;
      bound = { port: port, sessionId: d.sessionId, generation: d.generation };
      port.onmessage = function (msg) {
        handle(port, d.sessionId, d.generation, msg);
      };
      port.start();
      port.postMessage(
        envelope("ready", d.sessionId, d.generation, { accepted: true })
      );
    });
  }

  global.attachArenaBridge = attachArenaBridge;
  global.shoalPublicState = publicState;
})(typeof window !== "undefined" ? window : globalThis);
