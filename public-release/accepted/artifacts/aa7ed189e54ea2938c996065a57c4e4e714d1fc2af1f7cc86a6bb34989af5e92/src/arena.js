/* Lumen Yard - arena.game.v1 parent bridge.
   Connects only to the parent frame, binds the transferred port to one
   sessionId and generation, and drives exactly the same production state the
   player sees. */
(function (global) {
  'use strict';

  var PROTOCOL = 'arena.game.v1';

  function install(api) {
    var port = null;
    var sessionId = null;
    var generation = null;
    var handled = Object.create(null);

    function envelope(extra) {
      var base = {
        protocol: PROTOCOL,
        sessionId: sessionId,
        generation: generation,
        revision: api.revision(),
        state: api.state()
      };
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
      return base;
    }

    function respond(requestId, accepted, error) {
      if (!port) return;
      var msg = envelope({ type: 'response', requestId: requestId, accepted: accepted });
      if (!accepted) {
        msg.error = {
          code: (error && error.code) || 'rejected',
          message: (error && error.message) || 'Rejected.'
        };
      }
      port.postMessage(msg);
    }

    function isTaskAction(action) {
      if (!action || typeof action !== 'object') return false;
      if (action.type === 'move') return typeof action.direction === 'string';
      if (action.type === 'undo') return true;
      if (action.type === 'select_level') return typeof action.levelId === 'string';
      return false;
    }

    function handleRequest(data) {
      if (!data || typeof data !== 'object') return;
      if (data.protocol !== PROTOCOL) return;
      var requestId = data.requestId;
      if (typeof requestId !== 'string' && typeof requestId !== 'number') return;

      if (data.sessionId !== sessionId || data.generation !== generation) {
        respond(requestId, false, { code: 'session_mismatch', message: 'This port is bound to another session or generation.' });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(handled, String(requestId))) {
        respond(requestId, false, { code: 'duplicate_request', message: 'That requestId was already handled.' });
        return;
      }

      var command = data.command;
      if (command !== 'observe' && command !== 'act' && command !== 'restart') {
        handled[String(requestId)] = true;
        respond(requestId, false, { code: 'bad_command', message: 'Command must be observe, act or restart.' });
        return;
      }

      handled[String(requestId)] = true;

      if (command === 'observe') {
        respond(requestId, true);
        return;
      }

      if (!Number.isInteger(data.expectedRevision)) {
        respond(requestId, false, { code: 'missing_revision', message: 'expectedRevision (integer) is required.' });
        return;
      }
      if (data.expectedRevision !== api.revision()) {
        respond(requestId, false, { code: 'stale_revision', message: 'Expected revision ' + data.expectedRevision + ', current is ' + api.revision() + '.' });
        return;
      }

      if (command === 'restart') {
        try {
          api.restart('arena');
          respond(requestId, true);
        } catch (err) {
          respond(requestId, false, err);
        }
        return;
      }

      if (!isTaskAction(data.action)) {
        respond(requestId, false, { code: 'bad_action', message: 'A task action object is required.' });
        return;
      }
      try {
        api.act(data.action, 'arena');
        respond(requestId, true);
      } catch (err) {
        respond(requestId, false, err);
      }
    }

    global.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.protocol !== PROTOCOL || data.type !== 'connect') return;
      // Accept a connection only from the parent frame.
      if (global.parent === global || event.source !== global.parent) return;
      if (typeof data.sessionId !== 'string' || !Number.isInteger(data.generation)) return;
      var incoming = event.ports && event.ports[0];
      if (!incoming) return;

      if (port) {
        try { port.close(); } catch (e) { /* the old port is already gone */ }
      }
      port = incoming;
      sessionId = data.sessionId;
      generation = data.generation;
      handled = Object.create(null);

      port.onmessage = function (ev) { handleRequest(ev.data); };
      if (port.start) port.start();
      port.postMessage(envelope({ type: 'ready', accepted: true }));
    });
  }

  global.LumenArena = { install: install, PROTOCOL: PROTOCOL };
})(typeof window !== 'undefined' ? window : globalThis);
