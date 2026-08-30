/**
 * The route-independent state and selectors for the cross-task Benchmark
 * view.
 *
 * This module deliberately does not own React state or browser history. The
 * route controller can keep the state in React, the URL, or a WebMCP handle;
 * all three callers use these same pure functions to turn a release into the
 * visible roster. In particular, a filter narrows tasks and configurations and
 * reads the published cell scores. It never derives a score from checks or
 * replaces a published score with a view-specific number.
 */

import type {
  PublicGame,
  PublicRelease,
  PublicTask,
} from "../public-types";
import {
  configurationParts,
  configurationSummary,
  rankedGames,
  type ConfigurationSummary,
} from "./configurations";
import { compareByScore } from "./score";

/** The non-task chart tab used by `lib/chart.ts`. */
export const BENCHMARK_CHART_COMBINED = "combined";

/**
 * Query keys are intentionally singular: each selected value is one repeated
 * parameter, which keeps copied URLs readable and avoids a JSON blob in the
 * address bar.
 */
export const BENCHMARK_OVERVIEW_QUERY_KEYS = {
  taskIds: "task",
  harnesses: "harness",
  models: "model",
  efforts: "effort",
  playableOnly: "playable",
  chartTaskId: "chart",
} as const;

/** A task reference is enough for selectors; the UI may pass a full game. */
export type BenchmarkTaskRef = Pick<PublicTask, "id"> | Pick<PublicGame, "id" | "slug">;

/**
 * State shared by the Benchmark leaderboard, chart, data table, URL and
 * WebMCP controller. Empty selection arrays mean "all values".
 */
export interface BenchmarkOverviewState {
  readonly taskIds: readonly string[];
  readonly harnesses: readonly string[];
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  readonly playableOnly: boolean;
  readonly chartTaskId: string;
}

export type BenchmarkOverviewStateInput = Partial<BenchmarkOverviewState> | null | undefined;

/** A bounded page request. Selection itself has no configuration-count cap. */
export interface BenchmarkOverviewPageRequest {
  /** Number of rows to return. The selector may return fewer on the last page. */
  readonly limit?: number;
  /** Zero-based row offset. Ignored when a valid cursor is supplied. */
  readonly offset?: number;
  /** The `nextCursor` from an earlier result. */
  readonly cursor?: string | null;
}

export interface BenchmarkOverviewContinuation {
  readonly cursor: string;
  readonly offset: number;
  readonly limit: number;
}

/**
 * One configuration row in the overview. It extends the existing summary so
 * Leaderboard can consume the same published score/coverage fields while the
 * plain identity fields make a compact WebMCP response possible.
 */
export interface BenchmarkOverviewResultRow extends ConfigurationSummary {
  readonly configurationId: string;
  readonly identity: {
    readonly name: string;
    readonly harness: string;
    readonly model: string;
    readonly effort: string;
  };
  /** `score.gatesPassed`, using the same gate semantics as the chart. */
  readonly isPlayable: boolean;
  /** The task set used to derive this row's aggregate. */
  readonly taskIds: readonly string[];
}

export interface BenchmarkOverviewResult {
  /** Only this page is materialized for a bounded Agent response. */
  readonly rows: readonly BenchmarkOverviewResultRow[];
  /** Number of matching rows before pagination. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly nextCursor: string | null;
  readonly continuation: BenchmarkOverviewContinuation | null;
  /** Explicit visible task ids, after the empty-means-all rule is applied. */
  readonly taskIds: readonly string[];
  readonly configurationCount: number;
  readonly activeFilters: BenchmarkOverviewState;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Stable, locale-independent ordering for URL values and ties. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function stringValues(value: unknown, { allowEmpty = false } = {}): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim())
    .filter((candidate) => allowEmpty || candidate.length > 0);
}

function lookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function availableTasks(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
): BenchmarkTaskRef[] {
  const released = new Set((release.tasks ?? []).map((task) => task.id));
  const source = tasks ?? release.tasks ?? [];
  const seen = new Set<string>();
  return source.filter((task): task is BenchmarkTaskRef => {
    if (!task || typeof task.id !== "string" || !released.has(task.id) || seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

interface TaskOption {
  value: string;
  aliases: string[];
}

function taskOptions(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
): { tasks: BenchmarkTaskRef[]; byAlias: Map<string, string> } {
  const current = availableTasks(release, tasks);
  const byAlias = new Map<string, string>();
  for (const task of current) {
    byAlias.set(lookupKey(task.id), task.id);
    if ("slug" in task && typeof task.slug === "string") {
      byAlias.set(lookupKey(task.slug), task.id);
    }
  }
  return { tasks: current, byAlias };
}

interface FilterOption {
  value: string;
  aliases: string[];
}

function addFilterOption(
  byAlias: Map<string, string>,
  option: FilterOption,
): void {
  for (const alias of option.aliases) {
    const key = lookupKey(alias);
    if (!byAlias.has(key)) byAlias.set(key, option.value);
  }
}

function filterOptions(release: PublicRelease): {
  harnesses: Map<string, string>;
  models: Map<string, string>;
  efforts: Map<string, string>;
} {
  const harnesses = new Map<string, string>();
  const models = new Map<string, string>();
  const efforts = new Map<string, string>();

  for (const configuration of release.configurations ?? []) {
    const parts = configurationParts(configuration);
    addFilterOption(harnesses, {
      value: parts.harness,
      aliases: [parts.harness, configuration.harnessId ?? "", configuration.harness ?? ""],
    });
    addFilterOption(models, {
      value: parts.model,
      aliases: [parts.model, configuration.model ?? ""],
    });
    addFilterOption(efforts, {
      value: parts.effort,
      // `none` is a readable URL token for a sealed configuration with no
      // effort qualifier. The state itself keeps the canonical empty string.
      aliases: parts.effort ? [parts.effort, configuration.effort ?? ""] : ["", "none", "no-effort", "(none)"],
    });
  }
  return { harnesses, models, efforts };
}

function canonicalSelection(
  value: unknown,
  byAlias: Map<string, string>,
  options: { allowEmpty?: boolean } = {},
): string[] {
  const raw = stringValues(value, options);
  const selected: string[] = [];
  for (const candidate of raw) {
    const canonical = byAlias.get(lookupKey(candidate));
    if (canonical === undefined || selected.includes(canonical)) continue;
    selected.push(canonical);
  }
  return sortedUnique(selected);
}

function canonicalChartTaskId(
  value: unknown,
  taskByAlias: Map<string, string>,
  selectedTaskIds: readonly string[],
): string {
  if (typeof value !== "string") return BENCHMARK_CHART_COMBINED;
  const raw = value.trim();
  if (!raw || lookupKey(raw) === BENCHMARK_CHART_COMBINED) return BENCHMARK_CHART_COMBINED;
  const taskId = taskByAlias.get(lookupKey(raw));
  if (!taskId) return BENCHMARK_CHART_COMBINED;
  // A chart for a task excluded by the task filter would make the chart and
  // table disagree. Degrade that stale URL to the combined tab.
  if (selectedTaskIds.length > 0 && !selectedTaskIds.includes(taskId)) return BENCHMARK_CHART_COMBINED;
  return taskId;
}

/**
 * Drop stale values from a state and canonicalize aliases against the current
 * published release/catalogue. Empty selections intentionally remain empty:
 * they mean all current values, including values added in a later release.
 */
export function normalizeBenchmarkOverviewState(
  input: BenchmarkOverviewStateInput,
  release: PublicRelease,
  tasks?: readonly BenchmarkTaskRef[],
): BenchmarkOverviewState {
  const state = input ?? {};
  const taskCatalog = taskOptions(release, tasks);
  const selectedTaskIds = canonicalSelection(state.taskIds, taskCatalog.byAlias);
  const options = filterOptions(release);
  const normalized = {
    taskIds: selectedTaskIds,
    harnesses: canonicalSelection(state.harnesses, options.harnesses),
    models: canonicalSelection(state.models, options.models),
    efforts: canonicalSelection(state.efforts, options.efforts, { allowEmpty: true }),
    playableOnly: state.playableOnly === true,
    chartTaskId: BENCHMARK_CHART_COMBINED,
  } satisfies BenchmarkOverviewState;
  normalized.chartTaskId = canonicalChartTaskId(
    state.chartTaskId,
    taskCatalog.byAlias,
    normalized.taskIds,
  );
  return normalized;
}

function aliasesForParams(
  params: URLSearchParams,
  names: readonly string[],
): string[] {
  return names.flatMap((name) => params.getAll(name));
}

function toSearchParams(input: URLSearchParams | URL | string): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (input instanceof URL) return new URLSearchParams(input.search);
  const raw = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
  return new URLSearchParams(raw.split("#", 1)[0]);
}

/**
 * Parse repeated overview query parameters and normalize them against the
 * current release/catalogue. Legacy plural spellings are accepted on input
 * so a copied URL can survive a client rollout; serialization always emits
 * the singular canonical form above.
 */
export function parseBenchmarkOverviewSearchParams(
  input: URLSearchParams | URL | string,
  release: PublicRelease,
  tasks?: readonly BenchmarkTaskRef[],
): BenchmarkOverviewState {
  const params = toSearchParams(input);
  const keys = BENCHMARK_OVERVIEW_QUERY_KEYS;
  const state: BenchmarkOverviewStateInput = {
    taskIds: aliasesForParams(params, [keys.taskIds, "tasks"]),
    harnesses: aliasesForParams(params, [keys.harnesses, "harnesses"]),
    models: aliasesForParams(params, [keys.models, "models"]),
    efforts: aliasesForParams(params, [keys.efforts, "efforts"]),
    playableOnly: aliasesForParams(params, [keys.playableOnly, "playableOnly"])
      .some((value) => ["1", "true", "yes", "on"].includes(lookupKey(value))),
    chartTaskId: params.get(keys.chartTaskId) ?? params.get("chartTaskId") ?? BENCHMARK_CHART_COMBINED,
  };
  return normalizeBenchmarkOverviewState(state, release, tasks);
}

function stateWithoutRelease(input: BenchmarkOverviewStateInput): BenchmarkOverviewState {
  const state = input ?? {};
  const efforts = stringValues(state.efforts, { allowEmpty: true }).map((value) => {
    const key = lookupKey(value);
    return key === "none" || key === "no-effort" || key === "(none)" ? "" : key;
  });
  return {
    taskIds: sortedUnique(stringValues(state.taskIds)),
    harnesses: sortedUnique(stringValues(state.harnesses)),
    models: sortedUnique(stringValues(state.models)),
    efforts: sortedUnique(efforts),
    playableOnly: state.playableOnly === true,
    chartTaskId: typeof state.chartTaskId === "string" && state.chartTaskId.trim()
      ? state.chartTaskId.trim()
      : BENCHMARK_CHART_COMBINED,
  };
}

/**
 * Serialize a canonical URLSearchParams object. When a release is supplied,
 * stale values are removed first; without one, values are still trimmed and
 * deterministically ordered so a controller can serialize before data loads.
 */
export function serializeBenchmarkOverviewSearchParams(
  input: BenchmarkOverviewStateInput,
  release?: PublicRelease,
  tasks?: readonly BenchmarkTaskRef[],
): URLSearchParams {
  const state = release
    ? normalizeBenchmarkOverviewState(input, release, tasks)
    : stateWithoutRelease(input);
  const params = new URLSearchParams();
  const keys = BENCHMARK_OVERVIEW_QUERY_KEYS;
  for (const value of sortedUnique(state.taskIds)) params.append(keys.taskIds, value);
  for (const value of sortedUnique(state.harnesses)) params.append(keys.harnesses, value);
  for (const value of sortedUnique(state.models)) params.append(keys.models, value);
  for (const value of sortedUnique(state.efforts)) params.append(keys.efforts, value || "none");
  if (state.playableOnly) params.set(keys.playableOnly, "1");
  if (state.chartTaskId !== BENCHMARK_CHART_COMBINED) params.set(keys.chartTaskId, state.chartTaskId);
  return params;
}

/** Convenience for history APIs that need the query string rather than the object. */
export function benchmarkOverviewQueryString(
  input: BenchmarkOverviewStateInput,
  release?: PublicRelease,
  tasks?: readonly BenchmarkTaskRef[],
): string {
  return serializeBenchmarkOverviewSearchParams(input, release, tasks).toString();
}

/** The tasks that the current overview state allows the shared surfaces to see. */
export function selectVisibleTasks(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
  state: BenchmarkOverviewStateInput,
): BenchmarkTaskRef[] {
  const catalog = taskOptions(release, tasks);
  const normalized = normalizeBenchmarkOverviewState(state, release, tasks);
  if (normalized.taskIds.length === 0) return [...catalog.tasks];
  const selected = new Set(normalized.taskIds);
  return catalog.tasks.filter((task) => selected.has(task.id));
}

/** Tasks with enough roster coverage to support a combined ranking. */
export function selectRankableTasks<T extends { id: string }>(release: PublicRelease, tasks: readonly T[]): T[] {
  return rankedGames(release, [...tasks]);
}

function selectedTaskIds(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
  state: BenchmarkOverviewStateInput,
): string[] {
  return selectVisibleTasks(release, tasks, state).map((task) => task.id);
}

/**
 * Select configuration identities without imposing a build/configuration
 * count cap. `playableOnly` uses the published cell gate result, matching the
 * chart's existing meaning of playable and leaving the score untouched.
 */
export function selectVisibleConfigurationIds(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
  state: BenchmarkOverviewStateInput,
): string[] {
  const normalized = normalizeBenchmarkOverviewState(state, release, tasks);
  const taskIds = new Set(selectedTaskIds(release, tasks, normalized));
  return (release.configurations ?? [])
    .filter((configuration) => {
      const parts = configurationParts(configuration);
      if (normalized.harnesses.length > 0 && !normalized.harnesses.includes(parts.harness)) return false;
      if (normalized.models.length > 0 && !normalized.models.includes(parts.model)) return false;
      if (normalized.efforts.length > 0 && !normalized.efforts.includes(parts.effort)) return false;
      if (!normalized.playableOnly) return true;
      // Read the same aggregate gate semantics as the score/chart layer. The
      // selector does not inspect checks or invent a second playable rule.
      const summary = configurationSummary(release, configuration, taskIds);
      return summary.score.gatesPassed;
    })
    .map((configuration) => configuration.id);
}

function overviewRow(
  summary: ConfigurationSummary,
  taskIds: readonly string[],
): BenchmarkOverviewResultRow {
  const parts = configurationParts(summary.configuration);
  return {
    ...summary,
    configurationId: summary.configuration.id,
    identity: {
      name: parts.name,
      harness: parts.harness,
      model: parts.model,
      effort: parts.effort,
    },
    isPlayable: summary.score.gatesPassed,
    taskIds: [...taskIds],
  };
}

/** All matching rows, unbounded by configuration count; page at the boundary. */
export function selectBenchmarkOverviewRows(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
  state: BenchmarkOverviewStateInput,
): BenchmarkOverviewResultRow[] {
  const normalized = normalizeBenchmarkOverviewState(state, release, tasks);
  const visibleTasks = selectVisibleTasks(release, tasks, normalized);
  const taskIds = new Set(visibleTasks.map((task) => task.id));
  const visibleConfigurationIds = new Set(selectVisibleConfigurationIds(release, tasks, normalized));
  return (release.configurations ?? [])
    .filter((configuration) => visibleConfigurationIds.has(configuration.id))
    .map((configuration) => overviewRow(configurationSummary(release, configuration, taskIds), [...taskIds]))
    .sort((a, b) => compareByScore(a, b) || compareStrings(a.configurationId, b.configurationId));
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer < 0) return fallback;
  return Math.min(integer, max);
}

function pageLimit(request: BenchmarkOverviewPageRequest | undefined): number {
  return pageNumber(request?.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
}

function pageOffset(request: BenchmarkOverviewPageRequest | undefined, total: number, limit: number): number {
  if (request?.cursor != null && /^\d+$/.test(request.cursor)) {
    return Math.min(Number(request.cursor), total);
  }
  return Math.min(pageNumber(request?.offset, 0, Number.MAX_SAFE_INTEGER), total);
}

/**
 * Create the bounded summary consumed by UI/WebMCP. The full matching roster
 * is selected first, then only one page of rows is returned. `nextCursor`
 * makes the next disclosure explicit and is stable for an unchanged release,
 * state and sort order.
 */
export function createBenchmarkOverviewResult(
  release: PublicRelease,
  tasks: readonly BenchmarkTaskRef[] | undefined,
  state: BenchmarkOverviewStateInput,
  request?: BenchmarkOverviewPageRequest,
): BenchmarkOverviewResult {
  const activeFilters = normalizeBenchmarkOverviewState(state, release, tasks);
  const visibleTasks = selectVisibleTasks(release, tasks, activeFilters);
  const allRows = selectBenchmarkOverviewRows(release, tasks, activeFilters);
  const limit = pageLimit(request);
  const offset = pageOffset(request, allRows.length, limit);
  const rows = allRows.slice(offset, offset + limit);
  const nextOffset = offset + rows.length < allRows.length ? offset + rows.length : null;
  const nextCursor = nextOffset == null ? null : String(nextOffset);
  return {
    rows,
    total: allRows.length,
    offset,
    limit,
    hasMore: nextOffset != null,
    nextOffset,
    nextCursor,
    continuation: nextCursor == null ? null : { cursor: nextCursor, offset: nextOffset!, limit },
    taskIds: visibleTasks.map((task) => task.id),
    configurationCount: allRows.length,
    activeFilters,
  };
}

// Short aliases keep call sites readable while the full names remain useful
// in tests and documentation.
export const parseOverviewSearchParams = parseBenchmarkOverviewSearchParams;
export const serializeOverviewSearchParams = serializeBenchmarkOverviewSearchParams;
export const selectOverviewRows = selectBenchmarkOverviewRows;
export const pageOverviewResult = createBenchmarkOverviewResult;
