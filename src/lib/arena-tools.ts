import type { PublicAgentPlayEvidenceStatus, PublicBuild, PublicGame, PublicRelease, PublicTaskManifest } from "../public-types";
import { configurationParts, configurationsById } from "./configurations";

export type ArenaToolRoute = "home" | "play" | "benchmark" | "task" | "build" | "compare" | "method" | "not-found";

export interface ArenaToolContext {
  route: ArenaToolRoute;
  activeTaskId: string | null;
  identityAvailable: boolean;
  games: PublicGame[];
  taskManifests: PublicTaskManifest[];
  release: PublicRelease | null;
  openBuild: (taskId: string, buildId: string) => void;
  authorized: () => boolean;
}

function assertActiveTask(context: ArenaToolContext, taskId: string): void {
  if (context.route !== "benchmark" && context.activeTaskId !== taskId) throw new Error("task is outside the active Arena route");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function taskIdOf(input: unknown): string {
  if (!isObject(input) || Object.keys(input).some((key) => !["taskId", "query", "agentPlayStatus"].includes(key))) throw new TypeError("invalid build search input");
  if (typeof input.taskId !== "string") throw new TypeError("taskId is required");
  if (input.query != null && typeof input.query !== "string") throw new TypeError("query must be a string");
  if (input.agentPlayStatus != null && !["not_applicable", "not_evaluated", "failed", "passed"].includes(String(input.agentPlayStatus))) throw new TypeError("invalid Agent Play status filter");
  return input.taskId;
}

function buildAgentPlayEvidence(context: ArenaToolContext, build: PublicBuild) {
  return build.agentPlayEvidence ?? (context.taskManifests.some((manifest) => manifest.taskId === build.taskId)
    ? { status: "not_evaluated" as const, receiptAvailable: false }
    : { status: "not_applicable" as const, receiptAvailable: false });
}

function namedBuild(context: ArenaToolContext, build: PublicBuild) {
  const release = context.release!;
  const configuration = configurationsById(release).get(build.configurationId);
  const cell = release.cells.find((candidate) => candidate.taskId === build.taskId && candidate.configurationId === build.configurationId);
  return {
    buildId: build.id,
    taskId: build.taskId,
    configuration: configurationParts(configuration).name,
    score: cell?.score.mean ?? null,
    estimatedCost: cell?.operational.estimatedCost.mean ?? null,
    playable: build.playability === "playable",
    agentPlayEvidence: buildAgentPlayEvidence(context, build),
  };
}

const TASK_SEARCH_INPUT = {
  type: "object",
  properties: {
    query: { type: "string", description: "Optional words to match." },
    agentPlay: { enum: ["any", "required", "not_offered"], description: "Optional Agent Play policy filter." },
  },
  additionalProperties: false,
} as const;

function taskSearchOf(input: unknown): { query: string; agentPlay: "any" | "required" | "not_offered" } {
  if (!isObject(input) || Object.keys(input).some((key) => !["query", "agentPlay"].includes(key))) throw new TypeError("invalid search input");
  if (input.query != null && typeof input.query !== "string") throw new TypeError("query must be a string");
  if (input.agentPlay != null && !["any", "required", "not_offered"].includes(String(input.agentPlay))) throw new TypeError("invalid Agent Play filter");
  return {
    query: typeof input.query === "string" ? input.query.trim().toLowerCase() : "",
    agentPlay: (input.agentPlay as "any" | "required" | "not_offered" | undefined) ?? "any",
  };
}

function taskAgentPlay(context: ArenaToolContext, taskId: string) {
  const manifest = context.taskManifests.find((candidate) => candidate.taskId === taskId);
  return manifest
    ? { mode: "required" as const, protocol: "arena.game.v1" as const, tools: [...manifest.tools] }
    : { mode: "not_offered" as const, protocol: null, tools: [] };
}

export function arenaToolDefinitions(context: ArenaToolContext): WebMcpTool[] {
  const searchTasks: WebMcpTool = {
    name: "search_tasks",
    description: "Find public Arena game tasks by title, rule, or interaction summary.",
    inputSchema: TASK_SEARCH_INPUT,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      if (!context.authorized()) throw new Error("Arena route changed");
      const { query, agentPlay } = taskSearchOf(input);
      const tasks = context.games
        .map((game) => ({ game, agentPlay: taskAgentPlay(context, game.id) }))
        .filter((entry) => agentPlay === "any" || entry.agentPlay.mode === agentPlay)
        .filter(({ game }) => !query || [game.name, game.rule, game.tension, game.inputSummary].join(" ").toLowerCase().includes(query))
        .map(({ game, agentPlay: support }) => ({ taskId: game.id, name: game.name, slug: game.slug, rule: game.rule, inputSummary: game.inputSummary, agentPlay: support }));
      return result({ tasks });
    },
  };
  if (["home", "play"].includes(context.route)) return [searchTasks];
  if (!context.identityAvailable || !context.release || !["benchmark", "task", "build", "compare"].includes(context.route)) return [];

  const searchBuilds: WebMcpTool = {
    name: "search_builds",
    description: "Find named public builds for one Arena task after identities are visible.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        query: { type: "string" },
        agentPlayStatus: { enum: ["not_applicable", "not_evaluated", "failed", "passed"] },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      if (!context.authorized()) throw new Error("Arena route changed");
      const taskId = taskIdOf(input);
      assertActiveTask(context, taskId);
      const query = isObject(input) && typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      const agentPlayStatus = isObject(input) && typeof input.agentPlayStatus === "string"
        ? input.agentPlayStatus as PublicAgentPlayEvidenceStatus
        : null;
      const builds = context.release!.builds
        .filter((build) => build.taskId === taskId)
        .map((build) => namedBuild(context, build))
        .filter((build) => !query || build.configuration.toLowerCase().includes(query))
        .filter((build) => !agentPlayStatus || build.agentPlayEvidence.status === agentPlayStatus);
      return result({ builds });
    },
  };

  const openBuild: WebMcpTool = {
    name: "open_build",
    description: "Open one named public Arena build that is already available on this route.",
    inputSchema: {
      type: "object",
      properties: { buildId: { type: "string" } },
      required: ["buildId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!context.authorized()) throw new Error("Arena route changed");
      if (!isObject(input) || Object.keys(input).some((key) => key !== "buildId") || typeof input.buildId !== "string") throw new TypeError("buildId is required");
      const build = context.release!.builds.find((candidate) => candidate.id === input.buildId);
      if (!build) throw new Error("public build not found");
      assertActiveTask(context, build.taskId);
      context.openBuild(build.taskId, build.id);
      return result({ accepted: true, buildId: build.id, taskId: build.taskId, agentPlayEvidence: buildAgentPlayEvidence(context, build) });
    },
  };

  const compareBuilds: WebMcpTool = {
    name: "compare_builds",
    description: "Compare two named public Arena builds from the same task by published score and cost.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        buildIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
      },
      required: ["taskId", "buildIds"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      if (!context.authorized()) throw new Error("Arena route changed");
      if (!isObject(input) || Object.keys(input).some((key) => !["taskId", "buildIds"].includes(key)) || typeof input.taskId !== "string" || !Array.isArray(input.buildIds) || input.buildIds.length !== 2 || !input.buildIds.every((id) => typeof id === "string")) throw new TypeError("taskId and two buildIds are required");
      assertActiveTask(context, input.taskId);
      const builds = input.buildIds.map((id) => context.release!.builds.find((build) => build.id === id && build.taskId === input.taskId));
      if (builds.some((build) => !build)) throw new Error("builds must exist in the same public task");
      return result({ taskId: input.taskId, builds: builds.map((build) => namedBuild(context, build!)) });
    },
  };

  return [searchTasks, searchBuilds, openBuild, compareBuilds];
}
