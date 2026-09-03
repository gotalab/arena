export type SelectedReviewPaneStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface SelectedReviewResultCandidate {
  candidate: number;
  buildId: string;
  configuration: string;
  score: number | null;
}

export interface SelectedReviewToolContext {
  taskId: string;
  taskName: string;
  activeCandidate: number;
  candidateCount: number;
  selectedCriteria: readonly string[];
  candidateStatus: readonly SelectedReviewPaneStatus[];
  humanChoiceAvailable: boolean;
  humanChoice: number | null | undefined;
  revealedCandidates: readonly SelectedReviewResultCandidate[] | null;
  openCandidate: (candidate: number) => void;
  authorized: () => boolean;
}

function result(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function assertCurrent(context: SelectedReviewToolContext) {
  if (!context.authorized()) throw new Error("Selected review changed");
}

function emptyInput(input: unknown) {
  if (input != null && (typeof input !== "object" || Array.isArray(input) || Object.keys(input as object).length > 0)) {
    throw new TypeError("invalid selected review input");
  }
}

function candidateInput(input: unknown, count: number): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("invalid candidate input");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "candidate") || !Number.isInteger(value.candidate)) {
    throw new TypeError("candidate must be an integer");
  }
  const candidate = value.candidate as number;
  if (candidate < 1 || candidate > count) throw new RangeError(`candidate must be between 1 and ${count}`);
  return candidate;
}

export function selectedReviewToolDefinitions(context: SelectedReviewToolContext): WebMcpTool[] {
  const tools: WebMcpTool[] = [
    {
      name: "get_selected_review",
      description: "Read the visible anonymous review state. Builder identity, scores and Build ids stay hidden until the human chooses.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        assertCurrent(context);
        emptyInput(input);
        return result({
          taskId: context.taskId,
          taskName: context.taskName,
          activeCandidate: context.activeCandidate,
          candidateCount: context.candidateCount,
          selectedCriteria: context.selectedCriteria,
          candidates: context.candidateStatus.map((status, index) => ({ candidate: index + 1, status })),
          humanChoiceAvailable: context.humanChoiceAvailable,
          humanChoiceRequired: true,
        });
      },
    },
    {
      name: "open_review_candidate",
      description: "Show one anonymous candidate in the visible Arena Stage. This cannot choose a favorite or reveal identity and scores.",
      inputSchema: {
        type: "object",
        properties: { candidate: { type: "integer", minimum: 1, maximum: context.candidateCount } },
        required: ["candidate"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        assertCurrent(context);
        const candidate = candidateInput(input, context.candidateCount);
        context.openCandidate(candidate);
        return result({ accepted: true, activeCandidate: candidate, humanChoiceRequired: true });
      },
    },
  ];

  if (context.humanChoice !== undefined && context.revealedCandidates) {
    tools.push({
      name: "get_selected_review_result",
      description: "Read identities and published scores after the human has made the visible review choice.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        assertCurrent(context);
        emptyInput(input);
        return result({
          taskId: context.taskId,
          taskName: context.taskName,
          humanChoice: context.humanChoice,
          outcome: context.humanChoice == null ? "none" : "candidate",
          selectedCriteria: context.selectedCriteria,
          candidates: context.revealedCandidates,
          provenance: "agent_selected_anonymous_review",
          affectsPublicBenchmark: false,
          affectsBlindRecord: false,
        });
      },
    });
  }
  return tools;
}
