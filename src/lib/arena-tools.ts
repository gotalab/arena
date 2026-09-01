import type { PublicBuild, PublicGame, PublicRelease, PublicTaskManifest } from "../public-types";
import type { ArenaBenchmarkController } from "./benchmark-controller";
import { createBenchmarkOverviewResult, normalizeBenchmarkOverviewState, type BenchmarkOverviewState } from "./benchmark-view";
import { configurationParts, configurationsById } from "./configurations";
import {
  createTaskComparisonResult,
  normalizeTaskComparisonState,
  type TaskComparisonPageRequest,
  type TaskComparisonState,
  type TaskCheckOutcome,
} from "./task-comparison";

export type ArenaToolRoute = "home" | "play" | "benchmark" | "task" | "build" | "compare" | "method" | "not-found";

export interface ArenaToolContext {
  route: ArenaToolRoute;
  activeTaskId: string | null;
  identityAvailable: boolean;
  games: PublicGame[];
  taskManifests: PublicTaskManifest[];
  release: PublicRelease | null;
  benchmarkController: ArenaBenchmarkController;
  openTask: (taskId: string) => void;
  openBuild: (taskId: string, buildId: string) => void;
  authorized: () => boolean;
}

const TASK_SEARCH_PAGE_SIZE = 20;
const TOOL_CELL_BUDGET = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inputObject(input: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  const value = input == null ? {} : input;
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new TypeError(`invalid ${label} input`);
  return value;
}

function stringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new TypeError(`${name} must be an array of strings`);
  return value;
}

function booleanValue(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

function stringValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

function cursorValue(value: unknown): string | undefined {
  const cursor = stringValue(value, "cursor");
  if (cursor !== undefined && !/^\d+$/.test(cursor)) throw new TypeError("cursor must be a non-negative integer string");
  return cursor;
}

function numberValue(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) throw new TypeError(`${name} must be an integer from 1 to 100`);
  return value;
}

function result(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function assertCurrent(context: ArenaToolContext): void {
  if (!context.authorized()) throw new Error("Arena route changed");
}

function assertActiveTask(context: ArenaToolContext, taskId: string): void {
  if (context.route !== "benchmark" && context.activeTaskId !== taskId) throw new Error("task is outside the active Arena route");
}

function taskAgentPlay(context: ArenaToolContext, taskId: string) {
  const manifest = context.taskManifests.find((candidate) => candidate.taskId === taskId);
  return manifest
    ? { status: "supported" as const, protocol: "arena.game.v1" as const, tools: [...manifest.tools] }
    : { status: "human_only" as const, protocol: null, tools: [] };
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

const STRING_ARRAY = { type: "array", items: { type: "string" } } as const;

function searchTasksTool(context: ArenaToolContext): WebMcpTool {
  return {
    name: "search_tasks",
    description: "Find public Arena game tasks and see whether each task supports Agent Play.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional words to match." },
        agentPlay: { enum: ["supported", "human_only"], description: "Filter by whether the task can be played by an agent. Omit to include all tasks." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        cursor: { type: "string", pattern: "^[0-9]+$" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input) {
      assertCurrent(context);
      const value = inputObject(input, ["query", "agentPlay", "limit", "cursor"], "task search");
      const query = (stringValue(value.query, "query") ?? "").trim().toLowerCase();
      const agentPlayFilter = stringValue(value.agentPlay, "agentPlay");
      if (agentPlayFilter != null && !["supported", "human_only"].includes(agentPlayFilter)) throw new TypeError("invalid Agent Play filter");
      const limit = Math.min(numberValue(value.limit, "limit") ?? TASK_SEARCH_PAGE_SIZE, 50);
      const cursor = cursorValue(value.cursor);
      const offset = cursor == null ? 0 : Number(cursor);
      if (!Number.isInteger(offset) || offset < 0) throw new TypeError("cursor must be a non-negative integer string");
      const matches = context.games
        .map((game) => ({ game, agentPlay: taskAgentPlay(context, game.id) }))
        .filter((entry) => agentPlayFilter == null || entry.agentPlay.status === agentPlayFilter)
        .filter(({ game }) => !query || [game.name, game.rule, game.tension, game.inputSummary].join(" ").toLowerCase().includes(query));
      const page = matches.slice(offset, offset + limit);
      const nextOffset = offset + page.length < matches.length ? offset + page.length : null;
      return result({
        tasks: page.map(({ game, agentPlay: support }) => ({ taskId: game.id, name: game.name, slug: game.slug, rule: game.rule, inputSummary: game.inputSummary, agentPlay: support })),
        total: matches.length,
        nextCursor: nextOffset == null ? null : String(nextOffset),
      });
    },
  };
}

function openTaskTool(context: ArenaToolContext): WebMcpTool {
  return {
    name: "open_task",
    description: "Open one Arena task so its game and, when allowed, its named Build results are visible.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertCurrent(context);
      const value = inputObject(input, ["taskId"], "open task");
      const taskId = stringValue(value.taskId, "taskId");
      if (!taskId || !context.games.some((game) => game.id === taskId)) throw new Error("public task not found");
      context.openTask(taskId);
      return result({ accepted: true, taskId });
    },
  };
}

function filterBenchmarkTool(context: ArenaToolContext): WebMcpTool {
  return {
    name: "filter_benchmark_results",
    description: "Change the visible Benchmark task and agent filters. The Leaderboard, score-cost chart, task list and URL update together.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: STRING_ARRAY,
        harnesses: STRING_ARRAY,
        models: STRING_ARRAY,
        efforts: STRING_ARRAY,
        playableOnly: { type: "boolean" },
        chartTaskId: { type: "string", description: "combined or one visible task id/slug" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string", pattern: "^[0-9]+$" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertCurrent(context);
      if (context.route !== "benchmark" || !context.release) throw new Error("Benchmark filters are available only on /benchmark");
      const value = inputObject(input, ["taskIds", "harnesses", "models", "efforts", "playableOnly", "chartTaskId", "limit", "cursor"], "Benchmark filter");
      const current = context.benchmarkController.overview.state;
      const playableOnly = booleanValue(value.playableOnly, "playableOnly");
      const chartTaskId = stringValue(value.chartTaskId, "chartTaskId");
      const taskIds = stringArray(value.taskIds, "taskIds");
      if (taskIds?.some((candidate) => !context.games.some((game) => game.id === candidate || game.slug === candidate))) {
        throw new Error("taskIds must name public tasks by id or slug");
      }
      const stateInput: BenchmarkOverviewState = {
        taskIds: taskIds ?? current.taskIds,
        harnesses: stringArray(value.harnesses, "harnesses") ?? current.harnesses,
        models: stringArray(value.models, "models") ?? current.models,
        efforts: stringArray(value.efforts, "efforts") ?? current.efforts,
        playableOnly: playableOnly ?? current.playableOnly,
        chartTaskId: chartTaskId ?? current.chartTaskId,
      };
      const next = normalizeBenchmarkOverviewState(stateInput, context.release, context.games);
      context.benchmarkController.overview.setState(next);
      const page = createBenchmarkOverviewResult(context.release, context.games, next, {
        limit: numberValue(value.limit, "limit"),
        cursor: cursorValue(value.cursor),
      });
      return result({
        activeFilters: page.activeFilters,
        taskIds: page.taskIds,
        totalAgents: page.total,
        agents: page.rows.map((row) => ({
          configurationId: row.configurationId,
          name: row.identity.name,
          harness: row.identity.harness,
          model: row.identity.model,
          effort: row.identity.effort,
          score: row.score.mean,
          playable: row.isPlayable,
          tasksCovered: row.tasksCovered,
          estimatedCostPerTask: row.estimatedCost,
        })),
        nextCursor: page.nextCursor,
        continuation: page.continuation,
      });
    },
  };
}

function compareTaskBuildsTool(context: ArenaToolContext): WebMcpTool {
  return {
    name: "compare_task_builds",
    description: "Select any number of visible Builds and filter this task's published evaluator checks. The Build table, check matrix and URL update together; request evidence only for specific check ids.",
    inputSchema: {
      type: "object",
      properties: {
        buildIds: STRING_ARRAY,
        harnesses: STRING_ARRAY,
        models: STRING_ARRAY,
        efforts: STRING_ARRAY,
        check: {
          type: "object",
          properties: {
            categories: STRING_ARRAY,
            groups: STRING_ARRAY,
            outcomes: { type: "array", items: { enum: ["pass", "fail", "not_evaluated", "grader_error", "missing"] } },
            blockingOnly: { type: "boolean" },
            differencesOnly: { type: "boolean" },
          },
          additionalProperties: false,
        },
        stage: { enum: ["summary", "rows", "evidence"] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string", pattern: "^[0-9]+$" },
        buildLimit: { type: "integer", minimum: 1, maximum: 100 },
        buildCursor: { type: "string", pattern: "^[0-9]+$" },
        checkIds: STRING_ARRAY,
        evidenceBuildIds: STRING_ARRAY,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertCurrent(context);
      if (!context.release || !context.activeTaskId || !["task", "build"].includes(context.route)) throw new Error("Build comparison is available only on a named task route");
      const value = inputObject(input, ["buildIds", "harnesses", "models", "efforts", "check", "stage", "limit", "cursor", "buildLimit", "buildCursor", "checkIds", "evidenceBuildIds"], "task Build comparison");
      const current = context.benchmarkController.task.state;
      const requestedBuildIds = stringArray(value.buildIds, "buildIds");
      const taskBuildIds = new Set(context.release.builds.filter((build) => build.taskId === context.activeTaskId).map((build) => build.id));
      if (requestedBuildIds?.some((buildId) => !taskBuildIds.has(buildId))) throw new Error("buildIds must belong to the active public task");
      let nextCheck = current.check;
      if (value.check !== undefined) {
        const check = inputObject(value.check, ["categories", "groups", "outcomes", "blockingOnly", "differencesOnly"], "check filter");
        const outcomes = stringArray(check.outcomes, "outcomes");
        const allowedOutcomes = new Set(["pass", "fail", "not_evaluated", "grader_error", "missing"]);
        if (outcomes?.some((outcome) => !allowedOutcomes.has(outcome))) throw new TypeError("invalid check outcome");
        nextCheck = {
          categories: stringArray(check.categories, "categories") ?? current.check.categories,
          groups: stringArray(check.groups, "groups") ?? current.check.groups,
          outcomes: (outcomes as TaskCheckOutcome[] | undefined) ?? current.check.outcomes,
          blockingOnly: booleanValue(check.blockingOnly, "blockingOnly") ?? current.check.blockingOnly,
          differencesOnly: booleanValue(check.differencesOnly, "differencesOnly") ?? current.check.differencesOnly,
        };
      }
      const stateInput: TaskComparisonState = {
        buildIds: requestedBuildIds ?? current.buildIds,
        harnesses: stringArray(value.harnesses, "harnesses") ?? current.harnesses,
        models: stringArray(value.models, "models") ?? current.models,
        efforts: stringArray(value.efforts, "efforts") ?? current.efforts,
        check: nextCheck,
      };
      const taskId = context.activeTaskId;
      const next = normalizeTaskComparisonState(stateInput, context.release, taskId);
      context.benchmarkController.task.setState(next);
      const requestedLimit = numberValue(value.limit, "limit") ?? 20;
      const requestedBuildLimit = numberValue(value.buildLimit, "buildLimit") ?? 20;
      const cellBoundedLimit = Math.max(1, Math.min(requestedLimit, Math.floor(TOOL_CELL_BUDGET / requestedBuildLimit)));
      const stageValue = stringValue(value.stage, "stage");
      if (stageValue !== undefined && !["summary", "rows", "evidence"].includes(stageValue)) throw new TypeError("invalid comparison stage");
      const stage = stageValue as TaskComparisonPageRequest["stage"] | undefined;
      const requestedCheckIds = stringArray(value.checkIds, "checkIds");
      const knownCheckIds = new Set(context.release.builds.filter((build) => build.taskId === taskId).flatMap((build) => build.checks.map((check) => check.id)));
      if (requestedCheckIds?.some((checkId) => !knownCheckIds.has(checkId))) throw new Error("checkIds must name published checks for the active task");
      const evidenceBuildIds = stringArray(value.evidenceBuildIds, "evidenceBuildIds");
      if (evidenceBuildIds?.some((buildId) => !taskBuildIds.has(buildId))) throw new Error("evidenceBuildIds must belong to the active public task");
      const page = createTaskComparisonResult(context.release, taskId, next, {
        stage: stage ?? "summary",
        limit: cellBoundedLimit,
        cursor: cursorValue(value.cursor),
        buildLimit: requestedBuildLimit,
        buildCursor: cursorValue(value.buildCursor),
        checkIds: requestedCheckIds,
        evidenceBuildIds,
      });
      return result({
        taskId,
        activeFilters: page.activeFilters,
        summary: page.summary,
        builds: page.builds.map((build) => ({ buildId: build.id, configurationId: build.configurationId, name: build.name })),
        rows: page.rows.map((row) => ({
          checkId: row.id,
          label: row.label,
          category: row.category,
          group: row.group,
          lane: row.lane,
          differences: row.differences,
          cells: row.cells.map((cell) => ({ buildId: cell.buildId, outcome: cell.outcome })),
        })),
        evidence: page.evidence,
        total: page.total,
        nextCursor: page.nextCursor,
        continuation: page.continuation,
        buildTotal: page.buildTotal,
        buildNextCursor: page.buildNextCursor,
        buildContinuation: page.buildContinuation,
        outputCellBudget: TOOL_CELL_BUDGET,
      });
    },
  };
}

function openBuildTool(context: ArenaToolContext): WebMcpTool {
  return {
    name: "open_build",
    description: "Open one named public Arena Build that is already available on this route.",
    inputSchema: {
      type: "object",
      properties: { buildId: { type: "string" } },
      required: ["buildId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      assertCurrent(context);
      if (!context.release) throw new Error("named release is unavailable");
      const value = inputObject(input, ["buildId"], "open Build");
      const buildId = stringValue(value.buildId, "buildId");
      const build = context.release.builds.find((candidate) => candidate.id === buildId);
      if (!build) throw new Error("public build not found");
      assertActiveTask(context, build.taskId);
      context.openBuild(build.taskId, build.id);
      return result({ accepted: true, ...namedBuild(context, build) });
    },
  };
}

export function arenaToolDefinitions(context: ArenaToolContext): WebMcpTool[] {
  const searchTasks = searchTasksTool(context);
  const openTask = openTaskTool(context);
  if (["home", "play"].includes(context.route)) return [searchTasks, openTask];
  if (!context.identityAvailable || !context.release || !["benchmark", "task", "build", "compare"].includes(context.route)) return [];
  if (context.route === "benchmark") return [searchTasks, openTask, filterBenchmarkTool(context), openBuildTool(context)];
  if (["task", "build"].includes(context.route)) return [searchTasks, openTask, compareTaskBuildsTool(context), openBuildTool(context)];
  // A revealed Blind comparison keeps identity tools intentionally smaller;
  // the vote/reveal flow remains human-owned.
  return [searchTasks, openTask, openBuildTool(context)];
}
