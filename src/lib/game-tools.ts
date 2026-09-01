import type { FrameGameChannel, GameChannelResult } from "../platform/frame-game-channel";
import { matchesClosedJsonSchema } from "../platform/closed-json-schema";

export const PROBE_ACTIONS = ["scan_sector", "mark_route", "commit_route"] as const;
export type ProbeActionType = (typeof PROBE_ACTIONS)[number];

export interface ProbeAction {
  type: ProbeActionType;
}

export interface PublicGameTaskManifest {
  schema: "arena.game-manifest.v1";
  taskId: string;
  tools: readonly ("get_game_state" | "take_game_action" | "restart_game")[];
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

export function parseTakeActionInput(value: unknown, actionSchema: Record<string, unknown>): {
  sessionId: string;
  expectedRevision: number;
  action: Record<string, unknown>;
} | null {
  if (!isObject(value) || Object.keys(value).some((key) => !["sessionId", "expectedRevision", "action"].includes(key))) return null;
  if (typeof value.sessionId !== "string" || !value.sessionId || !Number.isSafeInteger(value.expectedRevision)) return null;
  if (!isObject(value.action) || !matchesClosedJsonSchema(value.action, actionSchema)) return null;
  return { sessionId: value.sessionId, expectedRevision: value.expectedRevision as number, action: value.action };
}

export function parseRestartInput(value: unknown): { sessionId: string; expectedRevision: number } | null {
  if (!isObject(value) || Object.keys(value).some((key) => !["sessionId", "expectedRevision"].includes(key))) return null;
  if (typeof value.sessionId !== "string" || !value.sessionId || !Number.isSafeInteger(value.expectedRevision)) return null;
  return { sessionId: value.sessionId, expectedRevision: value.expectedRevision as number };
}

function toolResult(result: GameChannelResult) {
  const text = JSON.stringify(result);
  return { content: [{ type: "text", text }], structuredContent: result };
}

export function gameToolDefinitions(channel: FrameGameChannel, manifest: PublicGameTaskManifest) {
  // Promise only what this game's state actually carries: some games list
  // their legal actions, others make legality deducible from the visible
  // board, which is part of the game.
  const statesLegalActions = "legalActions" in manifest.stateSchema.properties;
  const tools: WebMcpTool[] = [
    {
      name: "get_game_state",
      description: statesLegalActions
        ? "Read the visible state of the active Arena game, including its currently legal actions. Returns the sessionId and revision the other game tools require."
        : "Read the visible state of the active Arena game. Returns the sessionId and revision the other game tools require; legality follows from the visible state.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        return toolResult(await channel.request("observe"));
      },
    },
    {
      name: "take_game_action",
      description: "Apply one legal action to the active Arena game using the sessionId and revision from get_game_state. If the game rejects a stale revision, read the state again and retry with the fresh revision.",
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
        const parsed = parseTakeActionInput(input, manifest.actionSchema);
        if (!parsed) throw new TypeError("invalid take_game_action input");
        if (parsed.sessionId !== channel.sessionId) throw new Error("stale or foreign game session");
        return toolResult(await channel.request("act", {
          expectedRevision: parsed.expectedRevision,
          action: parsed.action,
        }));
      },
    },
  ];
  if (manifest.tools.includes("restart_game")) {
    tools.push({
      name: "restart_game",
      description: "Start a new attempt of the active Arena game from its declared initial state. Requires the sessionId and current revision from get_game_state; a stale revision is rejected without restarting.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session returned by get_game_state." },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        required: ["sessionId", "expectedRevision"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: unknown) {
        const parsed = parseRestartInput(input);
        if (!parsed) throw new TypeError("invalid restart_game input");
        if (parsed.sessionId !== channel.sessionId) throw new Error("stale or foreign game session");
        return toolResult(await channel.request("restart", { expectedRevision: parsed.expectedRevision }));
      },
    });
  }
  return tools;
}
