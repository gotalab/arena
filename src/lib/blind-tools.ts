export type BlindSide = "A" | "B";
export type BlindPaneStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface BlindToolContext {
  taskId: string;
  taskName: string;
  activeSide: BlindSide;
  blindChoiceAvailable: boolean;
  sideStatus: Readonly<Record<BlindSide, BlindPaneStatus>>;
  openSide: (side: BlindSide) => void;
  authorized: () => boolean;
}

function result(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function assertCurrent(context: BlindToolContext) {
  if (!context.authorized()) throw new Error("Blind comparison changed");
}

function sideValue(input: unknown): BlindSide {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("invalid side input");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "side") || (value.side !== "A" && value.side !== "B")) {
    throw new TypeError("side must be A or B");
  }
  return value.side;
}

export function blindToolDefinitions(context: BlindToolContext): WebMcpTool[] {
  return [
    {
      name: "get_blind_comparison",
      description: "Read the anonymous A/B comparison state without revealing Builder identity, score, or Build ids. The human owns the final choice.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        assertCurrent(context);
        if (input != null && (typeof input !== "object" || Array.isArray(input) || Object.keys(input as object).length > 0)) {
          throw new TypeError("invalid Blind comparison input");
        }
        return result({
          taskId: context.taskId,
          taskName: context.taskName,
          activeSide: context.activeSide,
          blindChoiceAvailable: context.blindChoiceAvailable,
          sides: (["A", "B"] as const).map((side) => ({ side, status: context.sideStatus[side] })),
          humanChoiceRequired: true,
        });
      },
    },
    {
      name: "open_blind_side",
      description: "Show anonymous side A or B in the visible Arena Stage. This cannot vote, reveal identity, or read scores.",
      inputSchema: {
        type: "object",
        properties: { side: { enum: ["A", "B"] } },
        required: ["side"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        assertCurrent(context);
        const side = sideValue(input);
        context.openSide(side);
        return result({ accepted: true, activeSide: side, blindChoiceAvailable: context.blindChoiceAvailable, humanChoiceRequired: true });
      },
    },
  ];
}
