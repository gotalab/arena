/**
 * Configuration identity and the aggregates derived from it.
 *
 * Configuration→series identity comes from `seriesFor` / `seriesOf` here and
 * nowhere else, and supports any number of configurations.
 */

import type { PublicCellOperationalMetrics as CellOperationalMetrics, PublicCellScore as CellScore, PublicConfiguration as Configuration, PublicPlayableRelease, PublicRelease as Release } from "../public-types";
import { configurationScore } from "./score";
import { blindReadyForTask, buildsForTask, trialSummary } from "./trials";

export interface ConfigurationSummary {
  configuration: Configuration;
  /** The published aggregate score: one mean per ranked task, with task n. */
  score: CellScore;
  /** Showcase builds in this total — one per cell, not the replica count. */
  trialCount: number;
  playable: number;
  requirementsPassed: number;
  requirementsApplicable: number;
  requirementsEvaluated: number;
  requirementsNotEvaluated: number;
  requirementsComplete: boolean;
  requirementsRate: number | null;
  time: number | null;
  timeCoverage: number;
  tokens: number | null;
  tokenCoverage: number;
  estimatedCost: number | null;
  costCoverage: number;
  /** Valid succeeded replicas behind the operational means. */
  metricRunCount: number;
  /** True when any counted dollar in the total is a view-time computation from
   * sealed token counts at API list prices rather than a provider estimate. */
  costAtListPrice: boolean;
  /** How many released tasks this configuration attempted. A task with only
   * participant failures still counts as covered and contributes 0; a task
   * never attempted remains missing coverage and ranks nowhere. */
  tasksCovered: number;
  /** Reliability across the released tasks: sealed runs attempted, and runs
   * that produced a valid succeeded build. Falls back to the published trial
   * count when a release predates the attempts record. */
  runsAttempted: number;
  runsSucceeded: number;
}

export interface ConfigurationParts {
  /** Display name of the harness: "Codex", "Cursor", "Claude Code". */
  harness: string;
  model: string;
  /** The effort qualifier, lower case: "high". "" when none was sealed. */
  effort: string;
  /** Harness and model, for named rows and effort-family grouping. */
  lead: string;
  /** The one display name: "Codex · GPT-5.6 Sol (high)". */
  name: string;
}

export interface Series {
  id: string;
  index: number;
  configuration: Configuration | undefined;
  label: string;
  parts: ConfigurationParts;
}

/**
 * Aggregate one configuration across the released tasks.
 *
 * `score` is the published number — participant attempts are averaged within
 * each task, then ranked tasks are weighted equally (see `lib/score.ts`). The requirement
 * counters below it stay as raw evidence of the showcase builds: they say what
 * the reader can inspect check by check, and are not the score.
 * Coverage counters keep partial reporting visible instead of implying a total.
 */
export function configurationSummary(
  release: Release,
  configuration: Configuration,
  taskIds: Set<string>,
): ConfigurationSummary {
  const trials = release.builds
    .filter((trial) => trial.configurationId === configuration.id && taskIds.has(trial.taskId))
    .map(trialSummary);
  const attempts = (release.attempts ?? []).filter(
    (attempt) => attempt.configurationId === configuration.id && taskIds.has(attempt.taskId),
  );
  const cells = release.cells.filter(
    (cell) => cell.configurationId === configuration.id && taskIds.has(cell.taskId),
  );
  const zeroBuildAttempts = attempts.filter(
    (attempt) => attempt.attempted > 0
      && attempt.succeeded === 0
      && !cells.some((cell) => cell.taskId === attempt.taskId),
  );
  const metricRunCount = cells.reduce((sum, cell) => sum + cell.operational.runs, 0);
  const timeCoverage = cells.reduce((sum, cell) => sum + cell.operational.time.reported, 0);
  const tokenCoverage = cells.reduce((sum, cell) => sum + cell.operational.tokens.reported, 0);
  const costCoverage = cells.reduce((sum, cell) => sum + cell.operational.estimatedCost.reported, 0);
  const completeTime = cells.length === taskIds.size && cells.every((cell) => cell.operational.time.mean != null);
  const completeTokens = cells.length === taskIds.size && cells.every((cell) => cell.operational.tokens.mean != null);
  const completeCost = cells.length === taskIds.size && cells.every((cell) => cell.operational.estimatedCost.mean != null);
  const passed = trials.reduce((sum, trial) => sum + trial.requirements.passed, 0);
  const applicable = trials.reduce((sum, trial) => sum + trial.requirements.applicable, 0);
  const notEvaluated = trials.reduce((sum, trial) => sum + trial.requirements.notEvaluated, 0);
  const evaluated = applicable - notEvaluated;
  const complete = trials.every((trial) => trial.requirements.complete);
  return {
    configuration,
    score: configurationScore(release, configuration, taskIds),
    trialCount: trials.length,
    playable: trials.filter((trial) => trial.raw.playability === "playable").length,
    requirementsPassed: passed,
    requirementsApplicable: applicable,
    requirementsEvaluated: evaluated,
    requirementsNotEvaluated: notEvaluated,
    requirementsComplete: complete,
    // The rubric is fixed before the run, so an unobservable requirement
    // counts against the share like any other unmet one; its count is
    // disclosed separately.
    requirementsRate: applicable > 0 ? passed / applicable : null,
    // Each task contributes one avg/run with equal weight. A partial mean
    // would silently favor the tasks that reported, so it is withheld unless
    // coverage is complete; the counters keep the gap on record.
    time: completeTime
      ? cells.reduce((sum, cell) => sum + (cell.operational.time.mean ?? 0), 0) / cells.length
      : null,
    timeCoverage,
    tokens: completeTokens
      ? cells.reduce((sum, cell) => sum + (cell.operational.tokens.mean ?? 0), 0) / cells.length
      : null,
    tokenCoverage,
    estimatedCost: completeCost
      ? cells.reduce((sum, cell) => sum + (cell.operational.estimatedCost.mean ?? 0), 0) / cells.length
      : null,
    costCoverage,
    metricRunCount,
    // The ~ marker qualifies a shown total; a withheld total has nothing to mark.
    costAtListPrice: completeCost && cells.some((cell) => cell.operational.costAtListPrice),
    tasksCovered: new Set([
      ...cells.map((cell) => cell.taskId),
      ...zeroBuildAttempts.map((attempt) => attempt.taskId),
    ]).size,
    runsAttempted: attempts.length > 0
      ? attempts.reduce((sum, attempt) => sum + attempt.attempted, 0)
      : trials.length,
    runsSucceeded: attempts.length > 0
      ? attempts.reduce((sum, attempt) => sum + attempt.succeeded, 0)
      : trials.length,
  };
}

export function operationalForCell(
  release: Release,
  taskId: string,
  configurationId: string,
): CellOperationalMetrics {
  const cell = release.cells.find(
    (candidate) => candidate.taskId === taskId && candidate.configurationId === configurationId,
  );
  if (!cell) throw new Error(`missing operational cell ${taskId} / ${configurationId}`);
  return cell.operational;
}

/**
 * The games the cross-game surfaces (leaderboard rank, combined chart) may
 * aggregate over. A game enters the ranked set once at least half the
 * roster's configurations have a published build for it; below that it is a
 * preview — playable, charted per game, but not allowed to flip every
 * configuration to "partial coverage" the day its first build lands. Derived
 * from the data, so a preview game graduates by itself as its round fills in.
 */
export function rankedGames<T extends { id: string }>(release: Release, tasks: T[]): T[] {
  const threshold = Math.max(2, Math.ceil(release.configurations.length / 2));
  return tasks.filter((task) => {
    const built = new Set(
      release.builds.filter((trial) => trial.taskId === task.id).map((trial) => trial.configurationId),
    );
    return built.size >= threshold;
  });
}

export function configurationSummaries(release: Release, tasks: Array<{ id: string }>): ConfigurationSummary[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  return release.configurations.map((configuration) => configurationSummary(release, configuration, taskIds));
}

/**
 * Harness kind → display name. The kind is the sealed identifier a cell
 * configuration carries (`harness.kind` in `configurations/cells/*.json`,
 * reaching the view as `provider`); an unlisted kind degrades to the name the
 * generator wrote, then to the kind itself, so a new harness is readable on
 * day one. Lower-case names are the products' own casing, not a slip.
 */
const HARNESS_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "codex-cli": "Codex",
  "cursor-agent": "Cursor",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  opencode2: "OpenCode V2",
  pi: "pi",
};

/**
 * The one display name of a configuration: harness first, then model, with
 * effort as a qualifier: "Codex · GPT-5.6 Sol (high)".
 *
 * The model alone is ambiguous: Cursor and Codex can both run GPT-5.6 Sol, and
 * this benchmark's subject is the harness × model pair, not the model. So the
 * harness leads, and every surface that names a configuration — leaderboard,
 * tooltips, run cards, checks table, reveal — reads this one formatter
 * instead of assembling its own. The score-against-cost plot uses the official
 * chip as the mark and `model` as the only on-plot word.
 */
export function configurationName(configuration: Configuration | undefined): string {
  return configurationParts(configuration).name;
}

/**
 * The same identity in its pieces. Named rows paint `name` on one line. The
 * chart uses an Arena-owned series dot and `model` as the short label, with
 * `effort` as an optional suffix. Missing pieces are named here once instead
 * of in every component; a configuration with no sealed effort simply carries
 * no qualifier.
 */
export function configurationParts(configuration: Configuration | undefined): ConfigurationParts {
  const kind = configuration?.harnessId ?? "";
  const harness = HARNESS_NAMES[kind] || configuration?.harness || kind || "Unknown harness";
  const model = configuration?.model ?? "Unknown model";
  const effort = (configuration?.effort ?? "").toLowerCase();
  const lead = `${harness} · ${model}`;
  return {
    harness,
    model,
    effort,
    lead,
    name: effort ? `${lead} (${effort})` : lead,
  };
}

/**
 * Model → vendor series token, the suffix of the `--series-*` custom
 * properties in base.css. Hue follows the model's vendor and the numbered
 * step is the tier within it (a higher number is the stronger model), so two
 * harnesses running Opus 5 share one color and a vendor's ramp reads as
 * strength. Matching is on the sealed model display name; an unmatched model
 * degrades to the neutral token — a visible gray mark, never a vanished or
 * borrowed-identity one.
 */
const MODEL_SERIES: Array<[RegExp, string]> = [
  [/fable/i, "anthropic-3"],
  [/opus/i, "anthropic-2"],
  [/sonnet|haiku/i, "anthropic-1"],
  [/\bsol\b/i, "openai-3"],
  [/terra/i, "openai-2"],
  [/luna/i, "openai-1"],
  [/grok/i, "xai"],
  [/deepseek/i, "deepseek"],
];

export function seriesTokenOf(configuration: Configuration | undefined): string {
  const model = configuration?.model ?? "";
  return MODEL_SERIES.find(([pattern]) => pattern.test(model))?.[1] ?? "neutral";
}

/** Configuration lookup for the whole app. */
export function configurationsById(release: Release): Map<string, Configuration> {
  return new Map(release.configurations.map((configuration) => [configuration.id, configuration]));
}

/**
 * The one configuration-to-series identity: index, configuration, and names,
 * in release order. Everything that draws or names a configuration, including
 * chart marks, aggregate tables, and trial cards, reads it from here, so a third
 * configuration is a data change and not a code change.
 *
 * It deliberately carries no hue. Named rows keep identity in the assembled
 * name; the chart applies its series color at render time.
 */
export function seriesFor(release: Release): Series[] {
  return release.configurations.map((configuration, index) => ({
    id: configuration.id,
    index,
    configuration,
    label: configurationName(configuration),
    parts: configurationParts(configuration),
  }));
}

/** The same identity keyed by configuration id. */
export function seriesById(release: Release): Map<string, Series> {
  return new Map(seriesFor(release).map((item) => [item.id, item]));
}

/**
 * The series identity of one configuration, with a neutral fallback so an
 * unknown id degrades to a visible, unstyled mark instead of vanishing.
 */
export function seriesOf(release: Release, configurationId: string | null | undefined): Series {
  return seriesById(release).get(configurationId ?? "") ?? {
    id: configurationId ?? "unknown",
    index: -1,
    configuration: undefined,
    label: configurationName(undefined),
    parts: configurationParts(undefined),
  };
}

/**
 * Is the aggregate evidence complete — one run per configuration, for every
 * task? This is the Benchmark surface's gate. It asks only that every game
 * has published runs — a configuration that covered part of the round must
 * not blank the whole leaderboard; it is shown unranked instead (the
 * leaderboard and the combined chart both know how).
 */
export function releaseReady(release: Release, tasks: Array<{ id: string }>): boolean {
  return release.configurations.length > 0
    && tasks.length > 0
    && tasks.every((task) => buildsForTask(release, task.id).length > 0);
}

/**
 * Can the blind comparison run for THIS task? The flow is a two-sided stage —
 * one build at a time, an A/B switcher, an A/Tie/B/Both-broken answer — so it
 * needs two playable published builds to sample a pair from. Per task on
 * purpose: a game with fewer than two playable replicas keeps its own stage
 * closed and gates nothing else. Stricter than `releaseReady`, which only
 * asks whether the numbers are complete.
 */
export function blindPairReady(release: PublicPlayableRelease, taskId: string): boolean {
  return blindReadyForTask(release, taskId);
}
