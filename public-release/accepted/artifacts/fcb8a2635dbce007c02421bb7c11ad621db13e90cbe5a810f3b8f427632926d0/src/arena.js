/* LUMEN YARD - Arena integration.
   window.__ARENA_GAME__ and the arena.game.v1 parent bridge both drive the one
   production state used by human input. No solution, state jump or agent-only
   view is exposed here. */
(function (root) {
  'use strict';
  var LY = root.LY || (root.LY = {});
  var PROTOCOL = 'arena.game.v1';
  var REVISION_UNSET = -1;

  LY.installArena = function (game, hooks) {
    hooks = hooks || {};

    function renderNow() {
      // The visible board must be up to date before a mutation is reported.
      if (typeof hooks.renderNow === 'function') {
        try { hooks.renderNow(); } catch (e) { /* presentation must not break the contract */ }
      }
    }

    function stateFrozen() { return game.frozenState(); }
    function statePlain() { return game.state(); }

    root.__ARENA_GAME__ = {
      reset: function (seed) {
        game.reset(seed);
        renderNow();
        return stateFrozen();
      },
      snapshot: function () {
        return stateFrozen();
      },
      act: function (action) {
        game.applyAction(action, { source: 'arena' });
        renderNow();
        return stateFrozen();
      },
      restart: function () {
        game.restart({ source: 'arena' });
        renderNow();
        return stateFrozen();
      }
    };

    /* ------------------------------------------------------------ bridge */

    var conn = null;

    function envelope(type, extra) {
      var out = {
        protocol: PROTOCOL,
        type: type,
        sessionId: extra.sessionId,
        generation: extra.generation,
        accepted: extra.accepted,
        revision: game.revision,
        state: statePlain()
      };
      if (type === 'response') out.requestId = extra.requestId;
      if (extra.error) out.error = extra.error;
      return out;
    }

    function post(port, msg) {
      try { port.postMessage(msg); } catch (e) { /* port closed */ }
    }

    function respond(port, requestId, sessionId, generation, accepted, error) {
      post(port, envelope('response', {
        requestId: requestId,
        sessionId: sessionId,
        generation: generation,
        accepted: accepted,
        error: error || null
      }));
    }

    function fail(code, message) {
      return { code: code, message: message };
    }

    function readExpectedRevision(req) {
      if (Number.isInteger(req.expectedRevision)) return req.expectedRevision;
      if (req.payload && Number.isInteger(req.payload.expectedRevision)) return req.payload.expectedRevision;
      return REVISION_UNSET;
    }

    function readAction(req) {
      if (req.action && typeof req.action === 'object') return req.action;
      if (req.payload && req.payload.action && typeof req.payload.action === 'object') return req.payload.action;
      return null;
    }

    function handleRequest(req) {
      if (!conn) return;
      var port = conn.port;
      var requestId = req && req.requestId;

      if (!req || req.protocol !== PROTOCOL) return;
      if (req.type && req.type !== 'request') return;
      if (typeof requestId !== 'string' && typeof requestId !== 'number') return;

      if (req.sessionId !== conn.sessionId || req.generation !== conn.generation) {
        respond(port, requestId, req.sessionId, req.generation, false,
          fail('session_mismatch', 'This port is bound to another session or generation.'));
        return;
      }
      if (conn.seen[requestId]) {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail('duplicate_request', 'This requestId has already been handled.'));
        return;
      }
      conn.seen[requestId] = true;

      var command = req.command;
      if (command === 'observe') {
        respond(port, requestId, conn.sessionId, conn.generation, true, null);
        return;
      }

      if (command !== 'act' && command !== 'restart') {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail('unknown_command', 'Unsupported command: ' + String(command)));
        return;
      }

      var expected = readExpectedRevision(req);
      if (expected === REVISION_UNSET) {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail('expected_revision_required', 'This command requires an integer expectedRevision.'));
        return;
      }
      if (expected !== game.revision) {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail('stale_revision', 'Expected revision ' + expected + ' but the board is at ' + game.revision + '.'));
        return;
      }

      if (command === 'restart') {
        game.restart({ source: 'arena' });
        renderNow();
        respond(port, requestId, conn.sessionId, conn.generation, true, null);
        return;
      }

      var action = readAction(req);
      if (!action) {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail('action_required', 'An act command requires an action object.'));
        return;
      }
      try {
        game.applyAction(action, { source: 'arena' });
      } catch (err) {
        respond(port, requestId, conn.sessionId, conn.generation, false,
          fail(err && err.code ? err.code : 'illegal_action', err && err.message ? err.message : 'Rejected.'));
        return;
      }
      renderNow();
      respond(port, requestId, conn.sessionId, conn.generation, true, null);
    }

    function bind(port, sessionId, generation) {
      if (conn && conn.port && conn.port !== port) {
        try { conn.port.close(); } catch (e) { /* already gone */ }
      }
      conn = { port: port, sessionId: sessionId, generation: generation, seen: Object.create(null) };
      port.onmessage = function (ev) { handleRequest(ev.data); };
      try { port.start(); } catch (e) { /* implicit start via onmessage */ }
      post(port, envelope('ready', {
        sessionId: sessionId,
        generation: generation,
        accepted: true
      }));
    }

    root.addEventListener('message', function (event) {
      // Only the embedding parent may open the control channel.
      if (event.source !== root.parent) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.protocol !== PROTOCOL || data.type !== 'connect') return;
      if (typeof data.sessionId !== 'string') return;
      if (!Number.isInteger(data.generation)) return;
      var port = event.ports && event.ports[0];
      if (!port) return;
      if (conn && data.generation < conn.generation) return;
      bind(port, data.sessionId, data.generation);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
