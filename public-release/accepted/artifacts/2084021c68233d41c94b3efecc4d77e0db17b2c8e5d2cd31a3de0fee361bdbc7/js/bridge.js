/* SHOAL - the arena.game.v1 parent bridge.
   Assisted play drives the same production state a finger does. Every acted
   mutation is painted on the visible board before it is reported accepted. */
(function () {
  var S = (window.SHOAL = window.SHOAL || {});
  var PROTOCOL = 'arena.game.v1';

  S.createBridge = function (host) {
    // host: { state(), revision(), perform(action), restart(), render() }
    var port = null, sessionId = null, generation = null;

    function envelope(type, extra) {
      var msg = {
        protocol: PROTOCOL,
        type: type,
        sessionId: sessionId,
        generation: generation,
        accepted: true,
        revision: host.revision(),
        state: host.state()
      };
      if (extra) for (var k in extra) msg[k] = extra[k];
      return msg;
    }

    function reject(requestId, code, message) {
      var msg = envelope('response', {
        requestId: requestId,
        accepted: false,
        error: { code: code, message: message }
      });
      post(msg);
    }

    function post(msg) {
      if (!port) return;
      try { port.postMessage(msg); } catch (e) { /* the parent went away */ }
    }

    function onRequest(ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.protocol !== PROTOCOL) return;
      var requestId = d.requestId;
      if (d.sessionId !== sessionId || d.generation !== generation) {
        if (requestId !== undefined) reject(requestId, 'session_mismatch', 'This port is bound to another session or generation.');
        return;
      }
      if (requestId === undefined || requestId === null) return;

      var cmd = d.command;
      if (cmd === 'observe') {
        post(envelope('response', { requestId: requestId }));
        return;
      }
      if (cmd === 'act' || cmd === 'restart') {
        if (!Number.isInteger(d.expectedRevision)) {
          reject(requestId, 'bad_request', 'expectedRevision must be an integer.');
          return;
        }
        if (d.expectedRevision !== host.revision()) {
          reject(requestId, 'stale_revision', 'Expected revision ' + d.expectedRevision + ', board is at ' + host.revision() + '.');
          return;
        }
        if (cmd === 'restart') {
          host.restart();
          host.render();
          post(envelope('response', { requestId: requestId }));
          return;
        }
        var res = host.perform(d.action);
        if (!res.ok) {
          reject(requestId, res.code, res.message);
          return;
        }
        host.render();   // the board shows it before we call it accepted
        post(envelope('response', { requestId: requestId }));
        return;
      }
      reject(requestId, 'bad_command', 'Unknown command.');
    }

    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.protocol !== PROTOCOL || d.type !== 'connect') return;
      // only the embedding parent may open the bridge
      if (window.parent === window) return;
      if (ev.source !== window.parent) return;
      if (typeof d.sessionId !== 'string' || !Number.isInteger(d.generation)) return;
      var p = ev.ports && ev.ports[0];
      if (!p) return;

      if (port && port !== p) {
        try { port.close(); } catch (e) { /* already gone */ }
      }
      port = p;
      sessionId = d.sessionId;
      generation = d.generation;
      port.onmessage = onRequest;
      try { port.start(); } catch (e) { /* onmessage implies start */ }
      post(envelope('ready'));
    });
  };
})();
