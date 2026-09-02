// Lumen Yard - Arena Platform Integration Bridge
// Implements window.__ARENA_GAME__ and arena.game.v1 MessagePort protocol

export class ArenaBridge {
  constructor(game) {
    this.game = game;
    this.port = null;
    this.sessionId = null;
    this.generation = null;
    this.processedRequests = new Set();

    this.exposeGlobalGame();
    this.listenForParentConnection();
  }

  exposeGlobalGame() {
    window.__ARENA_GAME__ = {
      reset: (seed) => this.game.reset(seed),
      snapshot: () => this.game.snapshot(),
      act: (action) => this.game.act(action),
      restart: () => this.game.restart()
    };
  }

  listenForParentConnection() {
    window.addEventListener('message', (event) => {
      // Accept connection only from parent
      if (event.source !== window.parent) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.protocol !== 'arena.game.v1' || data.type !== 'connect') return;

      const port = event.ports && event.ports[0];
      if (!port) return;

      this.sessionId = String(data.sessionId);
      this.generation = Number(data.generation);

      // Clean up previous port if any
      if (this.port) {
        this.port.onmessage = null;
        try { this.port.close(); } catch (e) {}
      }

      this.port = port;
      this.bindPort();
    });
  }

  bindPort() {
    const port = this.port;
    const currentState = this.game.snapshot();

    // 1. Post ready envelope
    const readyEnvelope = {
      protocol: 'arena.game.v1',
      type: 'ready',
      sessionId: this.sessionId,
      generation: this.generation,
      accepted: true,
      revision: currentState.revision,
      state: currentState,
      ...currentState
    };
    port.postMessage(readyEnvelope);

    // 2. Listen for requests
    port.onmessage = (msgEvent) => {
      const req = msgEvent.data;
      if (!req || typeof req !== 'object') return;

      // Filter by protocol, sessionId, and generation
      if (req.protocol !== 'arena.game.v1') return;
      if (req.sessionId !== this.sessionId || req.generation !== this.generation) {
        port.postMessage({
          protocol: 'arena.game.v1',
          type: 'response',
          requestId: req.requestId,
          sessionId: req.sessionId,
          generation: req.generation,
          accepted: false,
          error: { code: 'SESSION_MISMATCH', message: 'Session ID or generation mismatch' },
          revision: this.game.revision,
          state: this.game.snapshot(),
          ...this.game.snapshot()
        });
        return;
      }

      this.handleRequest(req);
    };
  }

  handleRequest(req) {
    const requestId = req.requestId;
    const command = req.command;

    // Check duplicate request
    if (requestId && this.processedRequests.has(requestId)) {
      this.sendResponse(requestId, false, {
        code: 'DUPLICATE_ACTION',
        message: `Duplicate requestId: ${requestId}`
      });
      return;
    }

    if (command === 'observe') {
      const state = this.game.snapshot();
      this.sendResponse(requestId, true, null, state);
      return;
    }

    if (command === 'act') {
      // Check expectedRevision
      if (typeof req.expectedRevision !== 'number' || req.expectedRevision !== this.game.revision) {
        this.sendResponse(requestId, false, {
          code: 'STALE_REVISION',
          message: `Stale revision: expected ${req.expectedRevision} but current is ${this.game.revision}`
        });
        return;
      }

      // Extract action
      const action = req.action || (req.type ? { type: req.type, direction: req.direction, levelId: req.levelId } : null);
      if (!action) {
        this.sendResponse(requestId, false, {
          code: 'ILLEGAL_ACTION',
          message: 'Missing task action in act command'
        });
        return;
      }

      try {
        const newState = this.game.act(action);
        if (requestId) this.processedRequests.add(requestId);
        this.sendResponse(requestId, true, null, newState);
      } catch (err) {
        this.sendResponse(requestId, false, {
          code: err.code || 'ILLEGAL_ACTION',
          message: err.message
        });
      }
      return;
    }

    if (command === 'restart') {
      // Check expectedRevision
      if (typeof req.expectedRevision === 'number' && req.expectedRevision !== this.game.revision) {
        this.sendResponse(requestId, false, {
          code: 'STALE_REVISION',
          message: `Stale revision on restart: expected ${req.expectedRevision} but current is ${this.game.revision}`
        });
        return;
      }

      try {
        const newState = this.game.restart();
        if (requestId) this.processedRequests.add(requestId);
        this.sendResponse(requestId, true, null, newState);
      } catch (err) {
        this.sendResponse(requestId, false, {
          code: err.code || 'ILLEGAL_ACTION',
          message: err.message
        });
      }
      return;
    }

    // Unknown command
    this.sendResponse(requestId, false, {
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command: ${command}`
    });
  }

  sendResponse(requestId, accepted, error = null, state = null) {
    if (!this.port) return;

    const visibleState = state || this.game.snapshot();
    const response = {
      protocol: 'arena.game.v1',
      type: 'response',
      requestId: requestId,
      sessionId: this.sessionId,
      generation: this.generation,
      accepted: accepted,
      revision: visibleState.revision,
      state: visibleState,
      ...visibleState
    };

    if (!accepted && error) {
      response.error = {
        code: error.code || 'ILLEGAL_ACTION',
        message: error.message || 'Action rejected'
      };
    }

    this.port.postMessage(response);
  }
}
