/** Arena bridge protocol + window.__ARENA_GAME__ wiring */

const PROTOCOL = 'arena.game.v1';
const REVISION = 1;

export function initBridge(game, onMutate) {
  const ports = new Map();

  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return;
    const data = ev.data;
    if (!data || data.protocol !== PROTOCOL || data.type !== 'connect') return;
    if (typeof data.sessionId !== 'string') return;
    if (typeof data.generation !== 'number') return;
    if (!ev.ports || !ev.ports[0]) return;

    const port = ev.ports[0];
    const sessionId = data.sessionId;
    const generation = data.generation;
    const bindKey = `${sessionId}:${generation}`;

    port.start();
    ports.set(bindKey, port);

    port.postMessage({
      protocol: PROTOCOL,
      type: 'ready',
      sessionId,
      generation,
      accepted: true,
      revision: REVISION,
      state: game.bridgeSnapshot(),
    });

    port.onmessage = (msgEv) => {
      const req = msgEv.data;
      if (!req || req.protocol !== PROTOCOL) return;
      if (req.sessionId !== sessionId || req.generation !== generation) return;

      handleRequest(req, game, onMutate, (resp) => {
        port.postMessage(resp);
      });
    };
  });
}

function handleRequest(req, game, onMutate, respond) {
  const base = {
    protocol: PROTOCOL,
    type: 'response',
    requestId: req.requestId,
    sessionId: req.sessionId,
    generation: req.generation,
    revision: REVISION,
  };

  const reject = (code, message) => {
    respond({
      ...base,
      accepted: false,
      error: { code, message },
      state: game.bridgeSnapshot(),
    });
  };

  const accept = () => {
    respond({
      ...base,
      accepted: true,
      state: game.bridgeSnapshot(),
    });
  };

  if (!req.requestId || !req.command) {
    return;
  }

  const snap = game.snapshot();

  if (req.command === 'observe') {
    accept();
    return;
  }

  if (typeof req.expectedRevision !== 'number') {
    reject('missing_revision', 'expectedRevision required');
    return;
  }

  if (req.expectedRevision !== snap.revision) {
    reject('stale_revision', 'revision mismatch');
    return;
  }

  if (snap.phase === 'ended' && req.command !== 'restart') {
    reject('run_ended', 'run has ended');
    return;
  }

  if (req.command === 'restart') {
    onMutate(() => game.restart());
    accept();
    return;
  }

  if (req.command === 'act') {
    if (!req.action) {
      reject('missing_action', 'action required');
      return;
    }
    let result;
    onMutate(() => {
      result = game._game.act(req.action);
    });
    if (result && result.ok) {
      accept();
    } else {
      reject(result?.error || 'rejected', result?.error || 'action rejected');
    }
    return;
  }

  reject('unknown_command', 'unknown command');
}

export function exposeArenaGame(gameApi, renderFn) {
  const api = {
    reset(seed) {
      const state = gameApi.reset(seed);
      renderFn(state);
      return state;
    },
    snapshot() {
      return gameApi.snapshot();
    },
    act(action) {
      const g = gameApi._game;
      const result = g.act(action);
      if (!result.ok) {
        const err = new Error(result.error || 'rejected');
        err.code = result.error;
        throw err;
      }
      renderFn(result.state);
      return result.state;
    },
    restart() {
      const state = gameApi.restart();
      renderFn(state);
      return state;
    },
    advance(ms) {
      gameApi.advance(ms);
      renderFn(gameApi.snapshot());
    },
  };

  window.__ARENA_GAME__ = api;
  return api;
}
