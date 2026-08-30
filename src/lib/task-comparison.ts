/**
 * Pure state, URL and selector logic for one task's named Build comparison.
 *
 * This is deliberately separate from React and from the WebMCP adapter. The
 * task route, a visible table, and an Agent tool all ask this module for the
 * same Build columns and check rows. Build selection is never capped; only a
 * returned row/evidence page is bounded.
 */

import type { PublicBuild, PublicCheck, PublicRelease } from "../public-types";
import { checkLabel } from "./format";
import { buildsForTask } from "./trials";
import { configurationParts, configurationsById, type ConfigurationParts } from "./configurations";
import { cellScoreForTrial, compareByScore } from "./score";

export type TaskCheckOutcome = "pass" | "fail" | "not_evaluated" | "grader_error" | "missing";

export const TASK_CHECK_OUTCOMES: readonly TaskCheckOutcome[] = [
  "pass",
  "fail",
  "not_evaluated",
  "grader_error",
  "missing",
];

export interface TaskCheckFilterState {
  readonly categories: readonly string[];
  readonly groups: readonly string[];
  readonly outcomes: readonly TaskCheckOutcome[];
  readonly blockingOnly: boolean;
  readonly differencesOnly: boolean;
}

export interface TaskComparisonState {
  readonly buildIds: readonly string[];
  readonly harnesses: readonly string[];
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  readonly check: TaskCheckFilterState;
}

export interface TaskComparisonStateInput {
  readonly buildIds?: unknown;
  readonly harnesses?: unknown;
  readonly models?: unknown;
  readonly efforts?: unknown;
  readonly check?: {
    readonly categories?: unknown;
    readonly groups?: unknown;
    readonly outcomes?: unknown;
    readonly blockingOnly?: unknown;
    readonly differencesOnly?: unknown;
  } | null;
}

export const TASK_COMPARISON_QUERY_KEYS = {
  buildIds: "build",
  harnesses: "harness",
  models: "model",
  efforts: "effort",
  categories: "category",
  groups: "group",
  outcomes: "outcome",
  blockingOnly: "blocking",
  differencesOnly: "differences",
} as const;

export interface TaskComparisonBuild {
  readonly id: string;
  readonly taskId: string;
  readonly configurationId: string;
  readonly name: string;
  readonly parts: ConfigurationParts;
}

export interface TaskCheckDefinition {
  readonly id: string;
  readonly category: string;
  readonly lane: string | null;
  readonly group: string | null;
  readonly label: string;
  /** Sanitized public explanation, never the rubric body or raw evidence. */
  readonly explanation: string | null;
}

export interface TaskCheckCell {
  readonly buildId: string;
  readonly outcome: TaskCheckOutcome;
  readonly explanation: string | null;
}

export interface TaskCheckRow extends TaskCheckDefinition {
  readonly cells: readonly TaskCheckCell[];
  readonly differences: boolean;
}

export interface TaskCheckGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly TaskCheckRow[];
}

export interface TaskCheckComparison {
  readonly taskId: string;
  readonly builds: readonly TaskComparisonBuild[];
  readonly rows: readonly TaskCheckRow[];
  readonly groups: readonly TaskCheckGroup[];
  readonly total: number;
  /** Number of check definitions before category/outcome/difference filters. */
  readonly totalBeforeFilters: number;
  readonly differenceCount: number;
}

export interface TaskComparisonEvidence {
  readonly taskId: string;
  readonly buildId: string;
  readonly checkId: string;
  readonly outcome: TaskCheckOutcome;
  readonly explanation: string | null;
}

export interface TaskComparisonPageRequest {
  /** `summary` returns metadata only; `rows` is the default matrix stage. */
  readonly stage?: "summary" | "rows" | "evidence";
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: string | null;
  /** Independent page over selected Build columns. */
  readonly buildLimit?: number;
  readonly buildCursor?: string | null;
  /** Explicit check ids for the evidence stage. Empty means no evidence. */
  readonly checkIds?: readonly string[];
  /** Optional subset of the already selected Builds for evidence. */
  readonly evidenceBuildIds?: readonly string[];
}

export interface TaskComparisonSummary {
  readonly taskId: string;
  readonly selectedBuildCount: number;
  readonly totalChecks: number;
  readonly matchedChecks: number;
  readonly differenceCount: number;
  readonly outcomes: Readonly<Record<TaskCheckOutcome, number>>;
  readonly activeFilters: TaskComparisonState["check"];
}

export interface TaskComparisonResult {
  readonly taskId: string;
  /** Selected Build columns are all included; there is no 4/6 Build cap. */
  readonly builds: readonly TaskComparisonBuild[];
  readonly summary: TaskComparisonSummary;
  readonly rows: readonly TaskCheckRow[];
  readonly evidence: readonly TaskComparisonEvidence[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly nextCursor: string | null;
  readonly continuation: { readonly cursor: string; readonly offset: number; readonly limit: number } | null;
  readonly buildTotal: number;
  readonly buildOffset: number;
  readonly buildLimit: number;
  readonly buildHasMore: boolean;
  readonly buildNextCursor: string | null;
  readonly buildContinuation: { readonly cursor: string; readonly offset: number; readonly limit: number } | null;
  /** Active non-Build filters. Explicit Build ids stay URL/controller-owned. */
  readonly activeFilters: Omit<TaskComparisonState, "buildIds"> & { readonly explicitBuildSelection: boolean };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function stringValues(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim())
    .filter((candidate) => allowEmpty || candidate.length > 0);
}

function keyOf(value: string): string {
  return value.trim().toLowerCase();
}

function buildRecords(release: PublicRelease, taskId: string): PublicBuild[] {
  const seen = new Set<string>();
  return buildsForTask(release, taskId).filter((build) => {
    if (seen.has(build.id)) return false;
    seen.add(build.id);
    return true;
  });
}

function buildView(release: PublicRelease, build: PublicBuild): TaskComparisonBuild {
  const parts = configurationParts(configurationsById(release).get(build.configurationId));
  return {
    id: build.id,
    taskId: build.taskId,
    configurationId: build.configurationId,
    name: parts.name,
    parts,
  };
}

function buildFilterOptions(release: PublicRelease, builds: readonly PublicBuild[]): {
  harnesses: Map<string, string>;
  models: Map<string, string>;
  efforts: Map<string, string>;
} {
  const configurations = configurationsById(release);
  const harnesses = new Map<string, string>();
  const models = new Map<string, string>();
  const efforts = new Map<string, string>();
  for (const build of builds) {
    const configuration = configurations.get(build.configurationId);
    const parts = configurationParts(configuration);
    for (const alias of [parts.harness, configuration?.harnessId ?? "", configuration?.harness ?? ""]) {
      if (!harnesses.has(keyOf(alias))) harnesses.set(keyOf(alias), parts.harness);
    }
    for (const alias of [parts.model, configuration?.model ?? ""]) {
      if (!models.has(keyOf(alias))) models.set(keyOf(alias), parts.model);
    }
    const effortAliases = parts.effort
      ? [parts.effort, configuration?.effort ?? ""]
      : ["", "none", "no-effort", "(none)"];
    for (const alias of effortAliases) {
      if (!efforts.has(keyOf(alias))) efforts.set(keyOf(alias), parts.effort);
    }
  }
  return { harnesses, models, efforts };
}

function canonicalSelection(
  value: unknown,
  options: Map<string, string>,
  { allowEmpty = false } = {},
): string[] {
  const selected: string[] = [];
  for (const candidate of stringValues(value, allowEmpty)) {
    const canonical = options.get(keyOf(candidate));
    if (canonical === undefined || selected.includes(canonical)) continue;
    selected.push(canonical);
  }
  return sortedUnique(selected);
}

function checkShape(check: PublicCheck): TaskCheckDefinition {
  const category = typeof check.category === "string" && check.category.trim()
    ? check.category.trim()
    : "requirement";
  const group = typeof check.group === "string" && check.group.trim() ? check.group.trim() : null;
  const explanation = typeof check.explanation === "string" ? check.explanation : null;
  return {
    id: check.id,
    category,
    lane: typeof check.lane === "string" ? check.lane : null,
    group,
    label: checkLabel(check),
    explanation,
  };
}

function outcomeOf(value: unknown): TaskCheckOutcome {
  return TASK_CHECK_OUTCOMES.includes(value as TaskCheckOutcome)
    ? value as TaskCheckOutcome
    : "missing";
}

function rawCheckFor(build: PublicBuild, checkId: string): PublicCheck | undefined {
  return (build.checks ?? []).find((check) => check.id === checkId);
}

function definitionsFor(builds: readonly PublicBuild[]): TaskCheckDefinition[] {
  const seen = new Set<string>();
  const definitions: TaskCheckDefinition[] = [];
  for (const build of builds) {
    for (const check of build.checks ?? []) {
      if (typeof check.id !== "string" || !check.id || seen.has(check.id)) continue;
      seen.add(check.id);
      definitions.push(checkShape(check));
    }
  }
  return definitions;
}

function checkOptions(builds: readonly PublicBuild[]): {
  categories: Map<string, string>;
  groups: Map<string, string>;
} {
  const categories = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const definition of definitionsFor(builds)) {
    if (!categories.has(keyOf(definition.category))) categories.set(keyOf(definition.category), definition.category);
    if (definition.group && !groups.has(keyOf(definition.group))) groups.set(keyOf(definition.group), definition.group);
  }
  return { categories, groups };
}

function normalizedOutcomes(value: unknown): TaskCheckOutcome[] {
  const allowed = new Set(TASK_CHECK_OUTCOMES);
  return sortedUnique(
    stringValues(value).filter((candidate): candidate is TaskCheckOutcome => allowed.has(candidate as TaskCheckOutcome)),
  ) as TaskCheckOutcome[];
}

/** Normalize task-scoped Build/check filter state against the current release. */
export function normalizeTaskComparisonState(
  input: TaskComparisonStateInput | null | undefined,
  release: PublicRelease,
  taskId: string,
): TaskComparisonState {
  const state = input ?? {};
  const allBuilds = buildRecords(release, taskId).sort((a, b) => compareByScore(
    { score: cellScoreForTrial(release, a) },
    { score: cellScoreForTrial(release, b) },
  ));
  const knownBuildIds = new Set(allBuilds.map((build) => build.id));
  const requestedBuildIds = stringValues(state.buildIds);
  const buildIds = sortedUnique(requestedBuildIds.filter((id) => knownBuildIds.has(id)));
  const options = buildFilterOptions(release, allBuilds);
  const checkState = state.check ?? {};
  const checkValueOptions = checkOptions(allBuilds);
  return {
    buildIds,
    harnesses: canonicalSelection(state.harnesses, options.harnesses),
    models: canonicalSelection(state.models, options.models),
    efforts: canonicalSelection(state.efforts, options.efforts, { allowEmpty: true }),
    check: {
      categories: canonicalSelection(checkState.categories, checkValueOptions.categories),
      groups: canonicalSelection(checkState.groups, checkValueOptions.groups),
      outcomes: normalizedOutcomes(checkState.outcomes),
      blockingOnly: checkState.blockingOnly === true,
      differencesOnly: checkState.differencesOnly === true,
    },
  };
}

function toSearchParams(input: URLSearchParams | URL | string): URLSearchParams {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (input instanceof URL) return new URLSearchParams(input.search);
  const raw = input.includes("?") ? input.slice(input.indexOf("?") + 1) : input;
  return new URLSearchParams(raw.split("#", 1)[0]);
}

/** Parse repeated task-comparison URL values and normalize stale selections. */
export function parseTaskComparisonSearchParams(
  input: URLSearchParams | URL | string,
  release: PublicRelease,
  taskId: string,
): TaskComparisonState {
  const params = toSearchParams(input);
  const keys = TASK_COMPARISON_QUERY_KEYS;
  const truthy = (key: string) => params.getAll(key).some((value) => ["1", "true", "yes", "on"].includes(keyOf(value)));
  return normalizeTaskComparisonState({
    buildIds: params.getAll(keys.buildIds),
    harnesses: params.getAll(keys.harnesses),
    models: params.getAll(keys.models),
    efforts: params.getAll(keys.efforts),
    check: {
      categories: params.getAll(keys.categories),
      groups: params.getAll(keys.groups),
      outcomes: params.getAll(keys.outcomes),
      blockingOnly: truthy(keys.blockingOnly),
      differencesOnly: truthy(keys.differencesOnly),
    },
  }, release, taskId);
}

/** Serialize state to deterministic repeated URL parameters. */
export function serializeTaskComparisonSearchParams(
  input: TaskComparisonStateInput | null | undefined,
  release: PublicRelease,
  taskId: string,
): URLSearchParams {
  const state = normalizeTaskComparisonState(input, release, taskId);
  const params = new URLSearchParams();
  const keys = TASK_COMPARISON_QUERY_KEYS;
  for (const value of sortedUnique(state.buildIds)) params.append(keys.buildIds, value);
  for (const value of sortedUnique(state.harnesses)) params.append(keys.harnesses, value);
  for (const value of sortedUnique(state.models)) params.append(keys.models, value);
  for (const value of sortedUnique(state.efforts).sort((a, b) => compareStrings(a || "none", b || "none"))) {
    params.append(keys.efforts, value || "none");
  }
  for (const value of sortedUnique(state.check.categories)) params.append(keys.categories, value);
  for (const value of sortedUnique(state.check.groups)) params.append(keys.groups, value);
  for (const value of sortedUnique(state.check.outcomes)) params.append(keys.outcomes, value);
  if (state.check.blockingOnly) params.set(keys.blockingOnly, "1");
  if (state.check.differencesOnly) params.set(keys.differencesOnly, "1");
  return params;
}

/** Build columns after task, identity and explicit Build-id filters. */
export function selectTaskBuilds(
  release: PublicRelease,
  taskId: string,
  input: TaskComparisonStateInput | TaskComparisonState | null | undefined,
): TaskComparisonBuild[] {
  const state = normalizeTaskComparisonState(input, release, taskId);
  const allBuilds = buildRecords(release, taskId);
  const selectedIds = new Set(state.buildIds);
  const hasExplicitBuildSelection = state.buildIds.length > 0;
  const configurations = configurationsById(release);
  return allBuilds
    .filter((build) => !hasExplicitBuildSelection || selectedIds.has(build.id))
    .filter((build) => {
      const parts = configurationParts(configurations.get(build.configurationId));
      return (state.harnesses.length === 0 || state.harnesses.includes(parts.harness))
        && (state.models.length === 0 || state.models.includes(parts.model))
        && (state.efforts.length === 0 || state.efforts.includes(parts.effort));
    })
    .map((build) => buildView(release, build));
}

function selectedRawBuilds(
  release: PublicRelease,
  taskId: string,
  state: TaskComparisonState,
): PublicBuild[] {
  const byId = new Map(buildRecords(release, taskId).map((build) => [build.id, build]));
  return selectTaskBuilds(release, taskId, state)
    .map((build) => byId.get(build.id))
    .filter((build): build is PublicBuild => Boolean(build));
}

function rowFromDefinition(
  definition: TaskCheckDefinition,
  builds: readonly PublicBuild[],
): TaskCheckRow {
  const cells = builds.map((build) => {
    const check = rawCheckFor(build, definition.id);
    const shape = check ? checkShape(check) : null;
    return {
      buildId: build.id,
      outcome: outcomeOf(check?.outcome),
      explanation: shape?.explanation ?? null,
    };
  });
  return {
    ...definition,
    cells,
    differences: new Set(cells.map((cell) => cell.outcome)).size > 1,
  };
}

function groupRows(rows: readonly TaskCheckRow[]): TaskCheckGroup[] {
  const groups: TaskCheckGroup[] = [];
  const byKey = new Map<string, TaskCheckRow[]>();
  for (const row of rows) {
    const key = row.group ?? row.category;
    const existing = byKey.get(key);
    if (existing) existing.push(row);
    else {
      const next = [row];
      byKey.set(key, next);
      groups.push({ key, label: key, rows: next });
    }
  }
  return groups;
}

function unfilteredRows(selectedBuilds: readonly PublicBuild[]): TaskCheckRow[] {
  return definitionsFor(selectedBuilds).map((definition) => rowFromDefinition(definition, selectedBuilds));
}

function filteredRows(
  rows: readonly TaskCheckRow[],
  filter: TaskCheckFilterState,
): TaskCheckRow[] {
  return rows.filter((row) => {
    if (filter.blockingOnly && row.category !== "gate") return false;
    if (filter.categories.length > 0 && !filter.categories.includes(row.category)) return false;
    if (filter.groups.length > 0 && (row.group == null || !filter.groups.includes(row.group))) return false;
    if (filter.outcomes.length > 0 && !row.cells.some((cell) => filter.outcomes.includes(cell.outcome))) return false;
    if (filter.differencesOnly && !row.differences) return false;
    return true;
  });
}

/** Create the filtered Build-column × check-row comparison matrix. */
export function createTaskCheckComparison(
  release: PublicRelease,
  taskId: string,
  input: TaskComparisonStateInput | TaskComparisonState | null | undefined,
): TaskCheckComparison {
  const state = normalizeTaskComparisonState(input, release, taskId);
  const selectedBuilds = selectTaskBuilds(release, taskId, state);
  const selectedRaw = selectedRawBuilds(release, taskId, state);
  const allRows = unfilteredRows(selectedRaw);
  const rows = filteredRows(allRows, state.check);
  const differenceCount = allRows.filter((row) => row.differences).length;
  return {
    taskId,
    builds: selectedBuilds,
    rows,
    groups: groupRows(rows),
    total: rows.length,
    totalBeforeFilters: allRows.length,
    differenceCount,
  };
}

function evidenceFor(
  taskId: string,
  builds: readonly PublicBuild[],
  checkIds: readonly string[],
): TaskComparisonEvidence[] {
  const wanted = new Set(checkIds);
  if (wanted.size === 0) return [];
  const evidence: TaskComparisonEvidence[] = [];
  for (const build of builds) {
    for (const check of build.checks ?? []) {
      if (!wanted.has(check.id)) continue;
      const shape = checkShape(check);
      evidence.push({
        taskId,
        buildId: build.id,
        checkId: check.id,
        outcome: outcomeOf(check.outcome),
        explanation: shape.explanation,
      });
    }
    for (const checkId of wanted) {
      if ((build.checks ?? []).some((check) => check.id === checkId)) continue;
      evidence.push({
        taskId,
        buildId: build.id,
        checkId,
        outcome: "missing",
        explanation: null,
      });
    }
  }
  return evidence;
}

/** Explicit, staged evidence retrieval; no evidence is embedded in rows. */
export function selectTaskComparisonEvidence(
  release: PublicRelease,
  taskId: string,
  input: TaskComparisonStateInput | TaskComparisonState | null | undefined,
  checkIds: readonly string[],
  evidenceBuildIds?: readonly string[],
): TaskComparisonEvidence[] {
  const state = normalizeTaskComparisonState(input, release, taskId);
  const selected = selectedRawBuilds(release, taskId, state);
  const wantedBuildIds = new Set(stringValues(evidenceBuildIds));
  const builds = wantedBuildIds.size === 0
    ? selected
    : selected.filter((build) => wantedBuildIds.has(build.id));
  const knownCheckIds = new Set(definitionsFor(selected).map((definition) => definition.id));
  const wantedCheckIds = sortedUnique(stringValues(checkIds).filter((id) => knownCheckIds.has(id)));
  return evidenceFor(taskId, builds, wantedCheckIds);
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer < 0) return fallback;
  return Math.min(integer, max);
}

function pageLimit(request: TaskComparisonPageRequest | undefined): number {
  return pageNumber(request?.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
}

function pageOffset(request: TaskComparisonPageRequest | undefined, total: number): number {
  if (request?.cursor != null && /^\d+$/.test(request.cursor)) return Math.min(Number(request.cursor), total);
  return Math.min(pageNumber(request?.offset, 0, Number.MAX_SAFE_INTEGER), total);
}

function buildPageLimit(request: TaskComparisonPageRequest | undefined): number {
  return pageNumber(request?.buildLimit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE) || DEFAULT_PAGE_SIZE;
}

function buildPageOffset(request: TaskComparisonPageRequest | undefined, total: number): number {
  if (request?.buildCursor != null && /^\d+$/.test(request.buildCursor)) return Math.min(Number(request.buildCursor), total);
  return 0;
}

function outcomeCounts(rows: readonly TaskCheckRow[]): Record<TaskCheckOutcome, number> {
  const counts: Record<TaskCheckOutcome, number> = {
    pass: 0,
    fail: 0,
    not_evaluated: 0,
    grader_error: 0,
    missing: 0,
  };
  for (const row of rows) for (const cell of row.cells) counts[cell.outcome] += 1;
  return counts;
}

/**
 * Bounded result for a route-scoped tool or UI controller. Rows and evidence
 * are disclosed independently; the selected Build columns remain arbitrary
 * in number and are never silently truncated.
 */
export function createTaskComparisonResult(
  release: PublicRelease,
  taskId: string,
  input: TaskComparisonStateInput | TaskComparisonState | null | undefined,
  request?: TaskComparisonPageRequest,
): TaskComparisonResult {
  const activeState = normalizeTaskComparisonState(input, release, taskId);
  const comparison = createTaskCheckComparison(release, taskId, activeState);
  const selectedRaw = selectedRawBuilds(release, taskId, activeState);
  const allRows = unfilteredRows(selectedRaw);
  const summary: TaskComparisonSummary = {
    taskId,
    selectedBuildCount: comparison.builds.length,
    totalChecks: allRows.length,
    matchedChecks: comparison.rows.length,
    differenceCount: allRows.filter((row) => row.differences).length,
    outcomes: outcomeCounts(allRows),
    activeFilters: activeState.check,
  };
  const buildLimit = buildPageLimit(request);
  const buildOffset = buildPageOffset(request, comparison.builds.length);
  const builds = comparison.builds.slice(buildOffset, buildOffset + buildLimit);
  const visibleBuildIds = new Set(builds.map((build) => build.id));
  const rowsForBuildPage = comparison.rows.map((row) => ({
    ...row,
    cells: row.cells.filter((cell) => visibleBuildIds.has(cell.buildId)),
  }));
  const buildNextOffset = buildOffset + builds.length < comparison.builds.length ? buildOffset + builds.length : null;
  const buildNextCursor = buildNextOffset == null ? null : String(buildNextOffset);
  const stage = request?.stage ?? "rows";
  const limit = pageLimit(request);
  const source = stage === "evidence"
    ? selectTaskComparisonEvidence(release, taskId, activeState, request?.checkIds ?? [], request?.evidenceBuildIds)
    : rowsForBuildPage;
  const total = source.length;
  const offset = stage === "summary" ? 0 : pageOffset(request, total);
  const page = stage === "summary" ? [] : source.slice(offset, offset + limit);
  const nextOffset = stage === "summary" || offset + page.length >= total ? null : offset + page.length;
  const nextCursor = nextOffset == null ? null : String(nextOffset);
  return {
    taskId,
    builds,
    summary,
    rows: stage === "rows" ? page as TaskCheckRow[] : [],
    evidence: stage === "evidence" ? page as TaskComparisonEvidence[] : [],
    total: stage === "summary" ? 0 : total,
    offset,
    limit,
    hasMore: nextCursor != null,
    nextOffset,
    nextCursor,
    continuation: nextCursor == null ? null : { cursor: nextCursor, offset: nextOffset!, limit },
    buildTotal: comparison.builds.length,
    buildOffset,
    buildLimit,
    buildHasMore: buildNextCursor != null,
    buildNextCursor,
    buildContinuation: buildNextCursor == null ? null : { cursor: buildNextCursor, offset: buildNextOffset!, limit: buildLimit },
    activeFilters: {
      harnesses: activeState.harnesses,
      models: activeState.models,
      efforts: activeState.efforts,
      check: activeState.check,
      explicitBuildSelection: activeState.buildIds.length > 0,
    },
  };
}

export const parseTaskComparisonUrl = parseTaskComparisonSearchParams;
export const serializeTaskComparisonUrl = serializeTaskComparisonSearchParams;
export const selectTaskComparisonBuilds = selectTaskBuilds;
export const taskCheckComparison = createTaskCheckComparison;
