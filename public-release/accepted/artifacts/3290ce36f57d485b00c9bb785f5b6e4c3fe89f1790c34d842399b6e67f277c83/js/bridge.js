/* SHOAL - the arena.game.v1 parent bridge.

   Assisted play drives the same production state a finger does. A bridge
   action and a tap leave behind exactly the same board. */
(function (g) {
  'use strict';

  var S = g.SHOAL;
  var PROTOCOL = 'arena.game.v1';
  var bound = null;

  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function render() {
    if (S.app && S.app.renderNow) S.app.renderNow();
    else if (S.view && S.view.drawNow) S.view.drawNow();
  }

  function envelope(type, extra) {
    var snap = S.game.visibleState();
    var msg = {
      protocol: PROTOCOL,
      type: type,
      sessionId: bound.sessionId,
      generation: bound.generation,
      accepted: true,
      revision: snap.revision,
      state: snap
    };
    if (extra) for (var k in extra) msg[k] = extra[k];
    return msg;
  }

  function send(msg) {
    if (!bound) return;
    try { bound.port.postMessage(msg); } catch (e) { /* the port went away */ }
  }

  function respond(requestId, accepted, error) {
    var msg = envelope('response', { requestId: requestId, accepted: accepted });
    if (error) msg.error = { code: error.code, message: error.message };
    send(msg);
  }

  function handleRequest(ev) {
    if (!bound) return;
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.protocol !== PROTOCOL) return;
    if (d.sessionId !== bound.sessionId || d.generation !== bound.generation) return;
    var requestId = d.requestId;
    if (requestId === undefined || requestId === null) return;
    var command = d.command;

    if (command === 'observe') {
      respond(requestId, true, null);
      return;
    }

    if (command === 'act' || command === 'restart') {
      if (!isInt(d.expectedRevision)) {
        respond(requestId, false, { code: 'bad_request', message: 'expectedRevision is required' });
        return;
      }
      var current = S.game.state().revision;
      if (d.expectedRevision !== current) {
        respond(requestId, false, {
          code: 'stale_revision',
          message: 'Expected revision ' + d.expectedRevision + ', board is at ' + current
        });
        return;
      }
      if (command === 'restart') {
        S.game.restart();
        if (S.app && S.app.onRestart) S.app.onRestart();
        render();
        respond(requestId, true, null);
        return;
      }
      var res = S.game.act(d.action);
      if (!res.ok) {
        respond(requestId, false, res.error);
        return;
      }
      if (S.app && S.app.afterAction) S.app.afterAction(d.action, 'bridge');
      render(); // the board is on screen before the mutation is reported
      respond(requestId, true, null);
      return;
    }

    respond(requestId, false, { code: 'bad_command', message: 'Unknown command' });
  }

  function bind(port, sessionId, generation) {
    if (bound && bound.port && bound.port !== port) {
      try { bound.port.close(); } catch (e) { /* ignore */ }
    }
    bound = { port: port, sessionId: sessionId, generation: generation };
    port.onmessage = handleRequest;
    try { port.start(); } catch (e) { /* ignore */ }
    render();
    send(envelope('ready'));
  }

  g.addEventListener('message', function (ev) {
    if (ev.source !== g.parent) return; // only the parent may connect
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.protocol !== PROTOCOL || d.type !== 'connect') return;
    if (typeof d.sessionId !== 'string' || !d.sessionId) return;
    if (!isInt(d.generation)) return;
    var port = ev.ports && ev.ports.length ? ev.ports[0] : null;
    if (!port) return;
    bind(port, d.sessionId, d.generation);
  });

  S.bridge = {
    protocol: PROTOCOL,
    isConnected: function () { return !!bound; }
  };
})(window);
