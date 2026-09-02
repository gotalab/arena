/**
 * LUMEN YARD - Arena Game Bridge (arena.game.v1 & window.__ARENA_GAME__)
 */

export class ArenaBridge {
  constructor(engine, onRenderSync) {
    this.engine = engine;
    this.onRenderSync = onRenderSync || (() => {});
    this.currentPort = null;
    this.currentSessionId = null;
    this.currentGeneration = null;

    this._setupWindowBridge();
    this._setupMessagePortListener();
  }

  _setupWindowBridge() {
    window.__ARENA_GAME__ = {
      reset: (seed = 0) => {
        const state = this.engine.reset(seed);
        this.onRenderSync();
        return state;
      },
      snapshot: () => {
        return this.engine.snapshot();
      },
      act: (action) => {
        const state = this.engine.act(action);
        this.onRenderSync();
        return state;
      },
      restart: () => {
        const state = this.engine.restart();
        this.onRenderSync();
        return state;
      }
    };
  }

  _setupMessagePortListener() {
    window.addEventListener('message', (event) => {
      // Accept connection only from parent if parent is distinct, or allow same window in tests
      if (window.parent && window.parent !== window) {
        if (event.source !== window.parent) {
          return;
        }
      }

      const data = event.data;
      if (!data || data.protocol !== 'arena.game.v1' || data.type !== 'connect') {
        return;
      }

      if (typeof data.sessionId !== 'string' || typeof data.generation !== 'number') {
        return;
      }

      if (!event.ports || !event.ports[0]) {
        return;
      }

      const port = event.ports[0];
      this._bindPort(port, data.sessionId, data.generation);
    });
  }

  _bindPort(port, sessionId, generation) {
    if (this.currentPort) {
      try {
        this.currentPort.close();
      } catch (_) {}
    }

    this.currentPort = port;
    this.currentSessionId = sessionId;
    this.currentGeneration = generation;

    // Post ready message
    const currentState = this.engine.snapshot();
    this.onRenderSync();

    port.postMessage({
      protocol: 'arena.game.v1',
      type: 'ready',
      sessionId: sessionId,
      generation: generation,
      accepted: true,
      revision: currentState.revision,
      state: currentState
    });

    port.onmessage = (event) => {
      this._handlePortRequest(event.data);
    };
  }

  _handlePortRequest(data) {
    if (!data || data.protocol !== 'arena.game.v1') return;
    if (data.sessionId !== this.currentSessionId || data.generation !== this.currentGeneration) {
      return;
    }

    const { requestId, command } = data;
    if (!requestId || !command) return;

    if (command === 'observe') {
      const state = this.engine.snapshot();
      this.currentPort.postMessage({
        protocol: 'arena.game.v1',
        type: 'response',
        requestId,
        sessionId: this.currentSessionId,
        generation: this.currentGeneration,
        accepted: true,
        revision: state.revision,
        state
      });
      return;
    }

    if (command === 'act') {
      const currentState = this.engine.snapshot();

      // Check revision
      if (typeof data.expectedRevision !== 'number' || data.expectedRevision !== currentState.revision) {
        this.currentPort.postMessage({
          protocol: 'arena.game.v1',
          type: 'response',
          requestId,
          sessionId: this.currentSessionId,
          generation: this.currentGeneration,
          accepted: false,
          revision: currentState.revision,
          state: currentState,
          error: {
            code: 'STALE_REVISION',
            message: `Expected revision ${data.expectedRevision} but current revision is ${currentState.revision}`
          }
        });
        return;
      }

      try {
        const nextState = this.engine.act(data.action);
        // Render visible board before reporting successful mutation
        this.onRenderSync();

        this.currentPort.postMessage({
          protocol: 'arena.game.v1',
          type: 'response',
          requestId,
          sessionId: this.currentSessionId,
          generation: this.currentGeneration,
          accepted: true,
          revision: nextState.revision,
          state: nextState
        });
      } catch (err) {
        const stateNow = this.engine.snapshot();
        this.currentPort.postMessage({
          protocol: 'arena.game.v1',
          type: 'response',
          requestId,
          sessionId: this.currentSessionId,
          generation: this.currentGeneration,
          accepted: false,
          revision: stateNow.revision,
          state: stateNow,
          error: {
            code: err.code || 'ILLEGAL_ACTION',
            message: err.message || 'Action rejected'
          }
        });
      }
      return;
    }

    if (command === 'restart') {
      const currentState = this.engine.snapshot();

      if (typeof data.expectedRevision !== 'number' || data.expectedRevision !== currentState.revision) {
        this.currentPort.postMessage({
          protocol: 'arena.game.v1',
          type: 'response',
          requestId,
          sessionId: this.currentSessionId,
          generation: this.currentGeneration,
          accepted: false,
          revision: currentState.revision,
          state: currentState,
          error: {
            code: 'STALE_REVISION',
            message: `Expected revision ${data.expectedRevision} but current revision is ${currentState.revision}`
          }
        });
        return;
      }

      const nextState = this.engine.restart();
      this.onRenderSync();

      this.currentPort.postMessage({
        protocol: 'arena.game.v1',
        type: 'response',
        requestId,
        sessionId: this.currentSessionId,
        generation: this.currentGeneration,
        accepted: true,
        revision: nextState.revision,
        state: nextState
      });
      return;
    }

    // Unknown command
    const stateNow = this.engine.snapshot();
    this.currentPort.postMessage({
      protocol: 'arena.game.v1',
      type: 'response',
      requestId,
      sessionId: this.currentSessionId,
      generation: this.currentGeneration,
      accepted: false,
      revision: stateNow.revision,
      state: stateNow,
      error: {
        code: 'UNKNOWN_COMMAND',
        message: `Unknown command: ${command}`
      }
    });
  }
}
