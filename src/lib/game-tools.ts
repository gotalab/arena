import type { FrameGameChannel, GameChannelResult } from "../platform/frame-game-channel";

export const PROBE_ACTIONS = ["scan_sector", "mark_route", "commit_route"] as const;
export type ProbeActionType = (typeof PROBE_ACTIONS)[number];

export interface ProbeAction {
  type: ProbeActionType;
}

export interface PublicGameTaskManifest {
  schema: "arena.game-manifest.v1";
  taskId: string;
  tools: readonly ["get_game_state", "take_game_action"];
  actionSchema: Record<string, unknown>;
  stateSchema: { properties: Record<string, unknown>; additionalProperties: false };
  resultSchema: { properties: Record<string, unknown>; additionalProperties: false };
  maxMessageBytes: number;
}

export const WEBMCP_PROBE_MANIFEST: PublicGameTaskManifest = {
  schema: "arena.game-manifest.v1",
  taskId: "webmcp-route-probe",
  tools: ["get_game_state", "take_game_action"],
  maxMessageBytes: 32_768,
  actionSchema: {
    oneOf: PROBE_ACTIONS.map((type) => ({
      type: "object",
      properties: { type: { const: type } },
      required: ["type"],
      additionalProperties: false,
    })),
  },
  stateSchema: {
    properties: {
      revision: { type: "integer", minimum: 0 },
      phase: { enum: ["playing", "complete"] },
      outcome: { type: ["string", "null"] },
      progress: { type: "array", items: { enum: PROBE_ACTIONS } },
      legalActions: { type: "array", items: { type: "object" } },
    },
    additionalProperties: false,
  },
  resultSchema: {
    properties: {
      accepted: { type: "boolean" }, sessionId: { type: "string" }, revision: { type: "integer" },
      state: { type: "object" }, error: { type: "object" },
    },
    additionalProperties: false,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProbeAction(value: unknown): ProbeAction | null {
  if (!isObject(value) || Object.keys(value).length !== 1) return null;
  return typeof value.type === "string" && PROBE_ACTIONS.includes(value.type as ProbeActionType)
    ? { type: value.type as ProbeActionType }
    : null;
}

export function parseTakeActionInput(value: unknown): {
  sessionId: string;
  expectedRevision: number;
  action: ProbeAction;
} | null {
  if (!isObject(value) || Object.keys(value).some((key) => !["sessionId", "expectedRevision", "action"].includes(key))) return null;
  const action = parseProbeAction(value.action);
  if (typeof value.sessionId !== "string" || !value.sessionId || !Number.isSafeInteger(value.expectedRevision) || !action) return null;
  return { sessionId: value.sessionId, expectedRevision: value.expectedRevision as number, action };
}

function toolResult(result: GameChannelResult) {
  const text = JSON.stringify(result);
  return { content: [{ type: "text", text }], structuredContent: result };
}

export function gameToolDefinitions(channel: FrameGameChannel, manifest: PublicGameTaskManifest) {
  return [
    {
      name: "get_game_state",
      description: "Read the visible state, revision, and legal actions of the active Arena game.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        return toolResult(await channel.request("observe"));
      },
    },
    {
      name: "take_game_action",
      description: "Apply one legal action to the active Arena game using its current session and revision.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session returned by get_game_state." },
          expectedRevision: { type: "integer", minimum: 0 },
          action: manifest.actionSchema,
        },
        required: ["sessionId", "expectedRevision", "action"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: unknown) {
        const parsed = parseTakeActionInput(input);
        if (!parsed) throw new TypeError("invalid take_game_action input");
        if (parsed.sessionId !== channel.sessionId) throw new Error("stale or foreign game session");
        return toolResult(await channel.request("act", {
          expectedRevision: parsed.expectedRevision,
          action: parsed.action,
        }));
      },
    },
  ] as const;
}
