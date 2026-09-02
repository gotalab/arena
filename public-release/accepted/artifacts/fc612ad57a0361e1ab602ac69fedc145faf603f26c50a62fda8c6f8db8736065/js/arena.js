/* Lumen Yard — arena.game.v1 bridge and window.__ARENA_GAME__. */
(function (root) {
  'use strict';

  var Lumen = root.Lumen;
  var PROTOCOL = 'arena.game.v1';

  var port = null;
  var sessionId = null;
  var generation = null;

  function refresh() {
    if (Lumen.main) Lumen.main.refresh();
  }

  function currentState() {
    return Lumen.game.snapshot();
  }

  function respond(requestId, accepted, error, st) {
    if (!port) return;
    var snapshot = st || currentState();
    var msg = {
      protocol: PROTOCOL,
      type: 'response',
      requestId: requestId,
      sessionId: sessionId,
      generation: generation,
      accepted: accepted,
      revision: snapshot.revision,
      state: snapshot,
    };
    if (error) msg.error = { code: error.code, message: error.message };
    port.postMessage(msg);
  }

  function handleRequest(ev) {
    var msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.protocol !== PROTOCOL) return;
    if (msg.type !== 'request') return;
    if (msg.sessionId !== sessionId || msg.generation !== generation) return;
    if (msg.requestId === undefined || msg.requestId === null) return;
    var rid = msg.requestId;

    if (msg.command === 'observe') {
      respond(rid, true, null, null);
      return;
    }
    if (msg.command === 'act' || msg.command === 'restart') {
      if (!Number.isInteger(msg.expectedRevision)) {
        respond(rid, false, { code: 'bad_request', message: 'expectedRevision must be an integer' }, null);
        return;
      }
      if (msg.expectedRevision !== Lumen.game.revision) {
        respond(rid, false, { code: 'stale_revision', message: 'expectedRevision does not match the current state' }, null);
        return;
      }
      try {
        var st;
        if (msg.command === 'act') {
          st = Lumen.game.act(msg.action);
        } else {
          st = Lumen.game.restart();
        }
        refresh(); // render the visible board before reporting success
        respond(rid, true, null, st);
      } catch (err) {
        respond(rid, false, { code: err.code || 'illegal_action', message: err.message }, null);
      }
      return;
    }
    respond(rid, false, { code: 'unknown_command', message: 'unknown command' }, null);
  }

  root.addEventListener('message', function (e) {
    if (e.source !== root.parent) return;
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.protocol !== PROTOCOL) return;
    if (msg.type !== 'connect') return;
    if (typeof msg.sessionId !== 'string' || msg.sessionId === '') return;
    if (!Number.isInteger(msg.generation)) return;
    var incomingPort = msg.port || (e.ports && e.ports[0]);
    if (!incomingPort || typeof incomingPort.postMessage !== 'function') return;
    port = incomingPort;
    sessionId = msg.sessionId;
    generation = msg.generation;
    port.onmessage = handleRequest;
    var snap = currentState();
    port.postMessage({
      protocol: PROTOCOL,
      type: 'ready',
      sessionId: sessionId,
      generation: generation,
      accepted: true,
      revision: snap.revision,
      state: snap,
    });
  });

  // window.__ARENA_GAME__ — same production state, human and agent share it.
  function arenaAct(action) {
    var st = Lumen.game.act(action);
    refresh();
    return st;
  }
  function arenaReset(seed) {
    var st = Lumen.game.reset(seed);
    refresh();
    return st;
  }
  function arenaRestart() {
    var st = Lumen.game.restart();
    refresh();
    return st;
  }

  root.__ARENA_GAME__ = {
    reset: arenaReset,
    snapshot: function () { return currentState(); },
    act: arenaAct,
    restart: arenaRestart,
  };
})(typeof window !== 'undefined' ? window : globalThis);