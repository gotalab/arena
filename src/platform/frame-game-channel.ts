export const GAME_PROTOCOL = "arena.game.v1" as const;

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_MESSAGE_BYTES = 32_768;

export interface GameChannelState {
  revision: number;
  phase: string;
  outcome: string | null;
  legalActions: unknown[];
  [key: string]: unknown;
}

export interface GameChannelResult {
  accepted: boolean;
  sessionId: string;
  revision: number;
  state: GameChannelState;
  error?: { code: string; message: string };
}

interface PendingRequest {
  resolve: (result: GameChannelResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: Transferable[]): void;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function encodedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseState(value: unknown, allowedKeys: ReadonlySet<string>): GameChannelState | null {
  if (!isObject(value)) return null;
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return null;
  if (typeof value.phase !== "string") return null;
  if (value.outcome !== null && typeof value.outcome !== "string") return null;
  if (!Array.isArray(value.legalActions)) return null;
  return value as GameChannelState;
}

/**
 * One request lane to one sandboxed frame generation. MessageChannel keeps
 * sibling opaque frames off the lane; session and generation reject late data.
 */
export class FrameGameChannel {
  readonly sessionId = randomId();
  readonly generation: number;

  private readonly channel = new MessageChannel();
  private readonly pending = new Map<string, PendingRequest>();
  private readyPromise: Promise<GameChannelResult>;
  private readyResolve!: (result: GameChannelResult) => void;
  private readyReject!: (error: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly allowedStateKeys: ReadonlySet<string>;

  constructor(
    frameWindow: FrameWindow,
    generation: number,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    allowedStateKeys: readonly string[] = ["revision", "phase", "outcome", "legalActions"],
  ) {
    this.generation = generation;
    this.timeoutMs = timeoutMs;
    this.allowedStateKeys = new Set(allowedStateKeys);
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(() => this.failReady("game frame handshake timed out"), timeoutMs);
    this.channel.port1.onmessage = (event) => this.receive(event.data);
    this.channel.port1.start();
    frameWindow.postMessage({
      protocol: GAME_PROTOCOL,
      type: "connect",
      sessionId: this.sessionId,
      generation,
      maxMessageBytes: MAX_MESSAGE_BYTES,
    }, "*", [this.channel.port2]);
  }

  ready(): Promise<GameChannelResult> {
    return this.readyPromise;
  }

  async request(command: "observe" | "act", payload: Record<string, unknown> = {}): Promise<GameChannelResult> {
    if (this.closed) throw new Error("game frame channel is closed");
    await this.readyPromise;
    const requestId = randomId();
    const message = {
      protocol: GAME_PROTOCOL,
      type: "request",
      command,
      requestId,
      sessionId: this.sessionId,
      generation: this.generation,
      ...payload,
    };
    if (encodedSize(message) > MAX_MESSAGE_BYTES) throw new Error("game request is too large");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("game frame request timed out"));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.channel.port1.postMessage(message);
    });
  }

  close(reason = "game frame changed"): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer);
    this.readyReject(new Error(reason));
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    this.channel.port1.close();
  }

  private failReady(message: string): void {
    if (this.closed) return;
    this.readyReject(new Error(message));
  }

  private receive(value: unknown): void {
    if (this.closed || encodedSize(value) > MAX_MESSAGE_BYTES || !isObject(value)) return;
    if (value.protocol !== GAME_PROTOCOL) return;
    if (value.sessionId !== this.sessionId || value.generation !== this.generation) return;
    const state = parseState(value.state, this.allowedStateKeys);
    if (!state || typeof value.accepted !== "boolean" || value.revision !== state.revision) return;
    const result: GameChannelResult = {
      accepted: value.accepted,
      sessionId: this.sessionId,
      revision: state.revision,
      state,
      ...(isObject(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string"
        ? { error: { code: value.error.code, message: value.error.message } }
        : {}),
    };
    if (value.type === "ready") {
      clearTimeout(this.readyTimer);
      this.readyResolve(result);
      return;
    }
    if (value.type !== "response" || typeof value.requestId !== "string") return;
    const pending = this.pending.get(value.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(value.requestId);
    pending.resolve(result);
  }
}
