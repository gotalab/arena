/**
 * The published score: replica aggregation, and the one way it is written.
 *
 * A cell (one task × one configuration) is scored by running it several times
 * and publishing the mean of the replica rates with a 95% confidence interval —
 * the practice public agent benchmarks settled on in 2026 (Terminal-Bench 2
 * runs k=5 and reports a 95% CI; METR publishes intervals rather than point
 * estimates). `web/scripts/generate-view.mjs` computes the per-cell block into
 * `release.json`; this module reads it, aggregates across tasks for the
 * leaderboard, and formats it.
 *
 * Honesty rules, unchanged at this hop: a mean that does not exist reads "Not
 * reported" and never becomes 0, and `n` is always printed, because "72% ± 4
 * over 5 runs" and "72% from 1 run" are different claims.
 *
 * Blocking criteria fold into the score (ADR 0015): the generator rates a
 * replica 0 when it fails — or cannot verify — a blocking (unplayability)
 * item, so the mean this module reads already carries the penalty and
 * ranking is a plain score sort. The blocking metadata (`gatesPassed`,
 * `gateFailures`, `gateUnverified`) still arrives per cell; evidence
 * surfaces use it to say WHY a build rated 0. Ranking surfaces do not
 * re-encode it.
 *
 * The t table, the comparator and the gate short names below mirror
 * `web/scripts/score.mjs`. Two copies exist because the generator is plain Node
 * and this layer is the app's; they must stay in step, and
 * `web/test/{score,gate}.test.mjs` pin what both rely on.
 */

import type { PublicCellScore as CellScore, PublicConfiguration as Configuration, PublicRelease as Release } from "../public-types";
import { NOT_REPORTED } from "./format";

/** Two-sided 95% t quantiles, df 1..9 (index 0 is df 1). */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262];

/** df >= 10 reuses the df=9 value: t shrinks with df, so this only widens. */
function tQuantile95(df: number): number | null {
  if (!Number.isFinite(df) || df < 1) return null;
  return T95[Math.min(df, T95.length) - 1];
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Mean and 95% half-width over replica rates. See `scripts/score.mjs`. */
export function aggregateRates(rates: number[]): { mean: number | null; ciHalfWidth: number | null; n: number } {
  const n = rates.length;
  if (n === 0) return { mean: null, ciHalfWidth: null, n: 0 };
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / n;
  if (n === 1) return { mean: round6(mean), ciHalfWidth: null, n: 1 };
  const variance = rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance) / Math.sqrt(n);
  return { mean: round6(mean), ciHalfWidth: round6((tQuantile95(n - 1) ?? 0) * standardError), n };
}

const EMPTY_SCORE: CellScore = {
  mean: null,
  ciHalfWidth: null,
  n: 0,
  replicasCounted: 0,
  replicasNullRate: 0,
  replicasHeldInvalid: 0,
  gatesPassed: false,
  gateFailures: [],
  gateUnverified: [],
};

/**
 * The terse name a leaderboard row shows for a failed gate: "loads", "restart".
 *
 * A failing row reads "✗ loads — 90%", not a paragraph. The map covers the six
 * platform gates both DELVE rubrics declare; an unmapped id degrades to its own
 * last segment with underscores opened up, so a new gate is readable on day one
 * without a code change.
 */
const GATE_SHORT_NAMES: Record<string, string> = {
  "gate.valid_build": "valid build",
  "gate.artifact_valid": "artifact",
  "gate.loads": "loads",
  "gate.no_blocking_uncaught_error": "blocking error",
  "gate.input_liveness": "controls",
  "gate.canonical_input_changes_state": "controls",
  "gate.progress_changes": "progress",
  "gate.restart_works": "restart",
};

export function gateShortName(itemId: string): string {
  return GATE_SHORT_NAMES[itemId] ?? itemId.split(".").pop()!.replaceAll("_", " ");
}

/**
 * The one gate failure a row names — the first, because the row has space for
 * one and the first is the earliest thing that broke. "" when nothing failed or
 * nothing named it.
 */
export function gateFailureLabel(score: CellScore | null | undefined): string {
  const [first] = score?.gateFailures ?? [];
  return first ? gateShortName(first) : "";
}

/**
 * The one unverified gate a row names when nothing measurably failed: the
 * scenario never ran, so the claim is "could not be verified", not "broken".
 * "" when a measured failure exists (that is the louder, truer claim) or when
 * every gate has a verdict.
 */
export function gateUnverifiedLabel(score: CellScore | null | undefined): string {
  if ((score?.gateFailures ?? []).length > 0) return "";
  const [first] = score?.gateUnverified ?? [];
  return first ? gateShortName(first) : "";
}

/**
 * The one gate claim a non-passing score displays, in every surface's three
 * registers: the glyph ("✗" measured, "?" unobserved), the terse label, and
 * the spoken sentence fragment. A measured failure always wins the slot —
 * "broken" is the louder, truer claim than "could not be verified".
 */
export function gateBadge(score: CellScore | null | undefined): { glyph: string; label: string; spoken: string } {
  const failure = gateFailureLabel(score);
  if (failure) return { glyph: "✗", label: failure, spoken: `failed the ${failure} gate` };
  const unverified = gateUnverifiedLabel(score);
  if (unverified) return { glyph: "?", label: unverified, spoken: `the ${unverified} gate could not be verified` };
  return { glyph: "✗", label: "gate", spoken: "failed a platform gate" };
}

/**
 * Rank order: plain score, descending (ADR 0015).
 *
 * There is no gate tier — a blocked replica already rated 0, so a cell of
 * blocked builds sinks by arithmetic. A missing mean sorts last. Negative
 * when `a` outranks `b`, for Array#sort.
 */
export function compareByScore(
  a: { score: CellScore },
  b: { score: CellScore },
): number {
  return (b.score.mean ?? -1) - (a.score.mean ?? -1);
}

/** The cells of one task, in release order. */
export function cellsForTask(release: Release, taskId: string) {
  return (release.cells ?? []).filter((cell) => cell.taskId === taskId);
}

/** The published score of one cell, or an empty score when it has none. */
export function cellScore(release: Release, taskId: string, configurationId: string): CellScore {
  const cell = (release.cells ?? []).find(
    (candidate) => candidate.taskId === taskId && candidate.configurationId === configurationId,
  );
  return cell?.score ?? EMPTY_SCORE;
}

/** The cell a showcase trial belongs to, so a run card can show its cell's score. */
export function cellScoreForTrial(release: Release, trial: { taskId: string; configurationId: string }): CellScore {
  return cellScore(release, trial.taskId, trial.configurationId);
}

/**
 * One configuration's score across the released tasks.
 *
 * Each ranked task contributes one value. A published cell contributes its
 * participant-attempt mean; a task with participant attempts but no valid
 * Build contributes 0 from its Attempt record. A task never attempted remains
 * absent so coverage logic can keep the configuration unranked.
 */
export function configurationScore(release: Release, configuration: Configuration, taskIds: Set<string>): CellScore {
  const cells = (release.cells ?? []).filter(
    (cell) => cell.configurationId === configuration.id && taskIds.has(cell.taskId),
  );
  const zeroBuildAttempts = (release.attempts ?? []).filter(
    (attempt) => attempt.configurationId === configuration.id
      && taskIds.has(attempt.taskId)
      && attempt.attempted > 0
      && attempt.succeeded === 0
      && !cells.some((cell) => cell.taskId === attempt.taskId),
  );
  // One game, one vote: the cross-task mean averages each task's own mean,
  // so a game that ran extra replicas refines its cell without outweighing
  // the other games. Pooling replicas across tasks would let n=2 on one game
  // count double against n=1 on another, which is a weighting no benchmark
  // reader expects.
  const taskMeans = cells
    .map((cell) => cell.score.mean)
    .filter((mean): mean is number => mean != null)
    .concat(zeroBuildAttempts.map(() => 0));
  const zeroBuildRuns = zeroBuildAttempts.reduce((sum, attempt) => sum + attempt.attempted, 0);
  const replicasCounted = cells.reduce((sum, cell) => sum + cell.score.replicasCounted, 0) + zeroBuildRuns;
  return {
    ...aggregateRates(taskMeans),
    replicasCounted,
    replicasNullRate: cells.reduce((sum, cell) => sum + cell.score.replicasNullRate, 0),
    replicasHeldInvalid: cells.reduce((sum, cell) => sum + cell.score.replicasHeldInvalid, 0) + zeroBuildRuns,
    // AND all the way up: a configuration passes the gate only where every one
    // of its cells did. One task that never loads is not averaged away.
    gatesPassed: cells.length > 0
      && zeroBuildAttempts.length === 0
      && cells.every((cell) => cell.score.gatesPassed),
    gateFailures: [...new Set([
      ...cells.flatMap((cell) => cell.score.gateFailures),
      ...(zeroBuildAttempts.length > 0 ? ["gate.valid_build"] : []),
    ])],
    gateUnverified: [...new Set(cells.flatMap((cell) => cell.score.gateUnverified ?? []))],
  };
}

/**
 * Below this sample size the t-interval is arithmetic, not information: at
 * n=2 the multiplier is 12.7 and the half-width can exceed 100 points, which
 * reads as noise beside the value it qualifies. Until a cell has this many
 * replicas the displays say only "n=…" — the sample size is the caveat.
 */
const MIN_INTERVAL_N = 5;

/** The half-width the displays may show, or null when n is too small to mean anything. */
function displayHalfWidth(score: CellScore): number | null {
  return score.ciHalfWidth != null && score.n >= MIN_INTERVAL_N ? score.ciHalfWidth : null;
}

/**
 * The one score formatter: "72% ± 4, n=5", or "63%, n=2" while the sample is
 * too small to interval, or "Not reported" when no replica was scorable.
 * The half-width is in percentage points, on the same scale as the value.
 */
export type ScoreEvidenceUnit = "runs" | "tasks";

function evidenceCount(score: CellScore, unit: ScoreEvidenceUnit): string {
  const singular = unit === "runs" ? "run" : "task";
  return `${score.n} ${score.n === 1 ? singular : unit}`;
}

export function formatScore(score: CellScore | null | undefined, unit: ScoreEvidenceUnit = "runs"): string {
  if (!score || score.mean == null) return NOT_REPORTED;
  const value = `${Math.round(score.mean * 100)}%`;
  const half = displayHalfWidth(score);
  const interval = half == null ? "" : ` ± ${Math.round(half * 100)}`;
  return `${value}${interval} · ${evidenceCount(score, unit)}`;
}

/**
 * The same claim in two pieces, for the layouts that set the value loud and the
 * interval at reading weight (run cards, leaderboard): "63%" and "± 4, n=3".
 * The interval piece is never empty when a mean exists — a score without its
 * sample size would read as a measurement.
 */
export function scoreValue(score: CellScore | null | undefined): string {
  return !score || score.mean == null ? NOT_REPORTED : `${Math.round(score.mean * 100)}%`;
}

export function scoreInterval(score: CellScore | null | undefined): string {
  if (!score || score.mean == null) return "";
  const half = displayHalfWidth(score);
  return `${half == null ? "" : `± ${Math.round(half * 100)}, `}n=${score.n}`;
}

/** Plain-language evidence label for a visible table score. */
export function scoreEvidence(score: CellScore | null | undefined, unit: ScoreEvidenceUnit): string {
  if (!score || score.mean == null) return "";
  const half = displayHalfWidth(score);
  return `${half == null ? "" : `± ${Math.round(half * 100)} · `}${evidenceCount(score, unit)}`;
}

/** The same claim spoken aloud, for accessible descriptions. */
export function speakScore(score: CellScore | null | undefined, unit: ScoreEvidenceUnit = "runs"): string {
  if (!score || score.mean == null) return "score not reported";
  const value = `${Math.round(score.mean * 100)} percent`;
  const evidence = `over ${score.n} ${score.n === 1 ? (unit === "runs" ? "run" : "task") : unit}`;
  if (score.n === 1) return `${value} from a single ${unit === "runs" ? "run" : "task"}`;
  const half = displayHalfWidth(score);
  if (half == null) return `${value} ${evidence}`;
  return `${value} plus or minus ${Math.round(half * 100)} ${evidence}`;
}

/**
 * The sentence that qualifies a score whose sample is thin or incomplete, or
 * "" when the score needs no caveat.
 */
export function scoreQualifier(score: CellScore | null | undefined): string {
  if (!score) return "";
  const notes: string[] = [];
  if (score.n === 1) notes.push("A single run has no interval; a rerun can land elsewhere.");
  else if (score.n < 5) notes.push(`A mean of ${score.n} runs is shown without an interval; below n=5 the interval would be wider than the scale.`);
  if (score.replicasNullRate > 0) {
    notes.push(`${score.replicasNullRate} ${score.replicasNullRate === 1 ? "replica" : "replicas"} could not be scored and stayed out of the mean.`);
  }
  if (score.replicasHeldInvalid > 0) {
    notes.push(`${score.replicasHeldInvalid} ${score.replicasHeldInvalid === 1 ? "replica" : "replicas"} never produced a valid build and counted as zero.`);
  }
  return notes.join(" ");
}
