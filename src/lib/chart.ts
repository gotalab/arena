/**
 * The compliance × cost scatter's whole model, derived per view.
 *
 * A point without a requirement share cannot be placed on the y axis and is
 * returned in `unplotted`. A scored point without a cost has an honest y and
 * is returned in `costless`, so the view can sit it on a labelled slot after
 * the last cost tick instead of inventing an x.
 */

import type { PublicCellScore as CellScore, PublicGame as Game, PublicRelease as Release } from "../public-types";
import {
  configurationParts,
  configurationSummaries,
  configurationsById,
  operationalForCell,
  rankedGames,
  type ConfigurationParts,
} from "./configurations";
import { cellScore, compareByScore } from "./score";
import { trialSummary } from "./trials";

export interface ChartPoint {
  trialId: string;
  taskId: string | null;
  name: string;
  /** On-plot text: harness and model. */
  label: string;
  /** Effort, shown beside the model when it still fits. */
  labelSuffix: string;
  /** The full display name, for the hover receipt and the data table. */
  configurationName: string;
  configurationId: string;
  /** The harness kind, for the fixed per-harness series color. */
  provider: string | null;
  cost: number | null;
  /** Provider CLI estimate, or a view-time computation at API list prices. */
  costBasis: "provider" | "list-price" | null;
  /** The plotted value: the mean of the cell's replica rates, or null. */
  rate: number | null;
  /** The same value with its interval and sample size, for labels and tables. */
  score: CellScore;
  requirementLabel: string;
  trialCount: number;
}

/** A point with both coordinates reported, so it has an honest position. */
export type PlottedPoint = ChartPoint & { cost: number; rate: number };

/** A scored point whose cost was not reported: it has an honest y position
 * and no x position, so the view draws it on a labelled rail beside the
 * cost axis instead of inventing a coordinate or hiding the score. */
export type CostlessPoint = ChartPoint & { rate: number; cost: null };

export interface ChartViewModel {
  combined: boolean;
  activeTask: Game | null;
  points: PlottedPoint[];
  /** Scored but cost-unreported: drawn on the "cost n/a" rail. */
  costless: CostlessPoint[];
  /** No score at all: named under the chart, never drawn. */
  unplotted: ChartPoint[];
  /** Combined view only: configurations whose totals cover only some of the
   * round's games. A partial total compares with nothing, so it is not drawn
   * as a combined mark; it is named under the chart and its marks stand in
   * the per-game views. */
  partialCoverage: Array<{ label: string; covered: number; total: number }>;
  maxCost: number;
}

/**
 * One point per cell of a single task, for the per-game view of the scatter.
 * A mark is the configuration's score for that game — the mean over its
 * replicas — positioned at the mean cost of those same valid succeeded runs.
 * Showcase selection never moves the point.
 * Aggregate evidence is public by design, so unopened tasks are included.
 *
 * Inside one game every mark shares the game, so the game name would label all
 * of them identically. What separates two marks here is the configuration: the
 * Arena's series dot is the point, and the on-plot text names harness and model, with
 * effort as an optional suffix. `name` stays the game, because the receipt,
 * the unplotted note and the spoken description still need to say which game.
 */
function trialPoints(release: Release, task: { id: string; name: string }): ChartPoint[] {
  const configurations = configurationsById(release);
  return release.builds
    .filter((trial) => trial.taskId === task.id)
    .map((trial) => {
      const summary = trialSummary(trial);
      const parts = configurationParts(configurations.get(trial.configurationId));
      const score = cellScore(release, trial.taskId, trial.configurationId);
      const operational = operationalForCell(release, trial.taskId, trial.configurationId);
      const chartCost = operational.estimatedCost.reported === operational.runs
        ? operational.estimatedCost.mean
        : null;
      return {
        trialId: trial.id,
        taskId: trial.taskId,
        name: task.name,
        label: parts.lead,
        labelSuffix: parts.effort,
        configurationName: parts.name,
        configurationId: trial.configurationId,
        provider: configurations.get(trial.configurationId)?.harnessId ?? null,
        // The result table may show a reported-run average. A chart position
        // implies full comparability, so partial cost coverage stays off-axis.
        cost: chartCost,
        costBasis: chartCost == null
          ? null
          : operational.costAtListPrice ? "list-price" : "provider",
        rate: score.mean,
        score,
        requirementLabel: summary.requirements.label,
        trialCount: score.n,
      };
    });
}

/**
 * One point per configuration: the task-balanced average cost per task (the
 * mean of each task's avg/run) against total requirements passed over applicable.
 *
 * This is the same aggregate the leaderboard prints — it reuses
 * `configurationSummary` rather than scoring anything new, so a configuration
 * that ran three tasks appears once, not three times. The y value is the mean
 * over every counted replica of the configuration, null when none was scorable.
 */
function combinedPoints(release: Release, tasks: Array<{ id: string }>): {
  points: ChartPoint[];
  partialCoverage: Array<{ label: string; covered: number; total: number }>;
} {
  // Combined totals aggregate over the ranked games only; a preview game
  // (built by less than half the roster) keeps its own per-game view.
  const ranked = rankedGames(release, tasks);
  const summaries = configurationSummaries(release, ranked);
  // A total over one game beside totals over two is not the same measurement;
  // partial-coverage configurations leave the combined plot entirely and are
  // named under it instead (their per-game marks are untouched).
  const partial = summaries.filter(
    (summary) => summary.trialCount > 0 && summary.tasksCovered !== ranked.length,
  );
  const points: ChartPoint[] = summaries.filter((summary) => summary.tasksCovered === ranked.length).map((summary) => ({
    trialId: `combined-${summary.configuration.id}`,
    taskId: null,
    // A total belongs to no single game; the view it comes from names it.
    name: "Combined",
    // On-plot identity uses the series dot plus harness and model text.
    label: configurationParts(summary.configuration).lead,
    labelSuffix: configurationParts(summary.configuration).effort,
    configurationName: configurationParts(summary.configuration).name,
    configurationId: summary.configuration.id,
    provider: summary.configuration.harnessId ?? null,
    // Tables may show a reported-run average; the combined plot still needs
    // every included run to report cost before assigning an x coordinate.
    cost: summary.costCoverage === summary.metricRunCount ? summary.estimatedCost : null,
    costBasis: summary.costCoverage === summary.metricRunCount && summary.estimatedCost != null
      ? (summary.costAtListPrice ? "list-price" : "provider")
      : null,
    rate: summary.score.mean,
    score: summary.score,
    requirementLabel: `${summary.requirementsPassed} / ${summary.requirementsApplicable}`,
    trialCount: summary.score.n,
  }));
  return {
    points,
    partialCoverage: partial.map((summary) => ({
      label: configurationParts(summary.configuration).name,
      covered: summary.tasksCovered,
      total: ranked.length,
    })),
  };
}

/**
 * The default chart view, and the id of the only non-task view.
 *
 * The combined totals are the landing impression: two marks answering "which
 * configuration met more requirements, for what" in one read.
 */
export const CHART_COMBINED = "combined";

/**
 * The chart's whole model for one view: which marks are plottable, which are
 * not and why, the cost domain of the visible marks, and the point labels this
 * view needs, in gate-then-score order.
 *
 * Any view id that is not a released task id is the combined totals, so an
 * unknown or stale id degrades to the default instead of drawing nothing.
 * `view` is `combined` or a task id.
 */
export function chartView(release: Release, tasks: Game[], view: string): ChartViewModel {
  const activeTask = tasks.find((task) => task.id === view) ?? null;
  const combined = activeTask == null;
  // Gate-first, then mean — the leaderboard's order. The plot itself is a
  // scatter and ranks nothing by position, but everything the chart emits as a
  // sequence (the spoken description, the data table, the unplotted note) is
  // read as one, so a build that never loads is never listed above one that
  // works.
  const source = combined ? combinedPoints(release, tasks) : { points: trialPoints(release, activeTask), partialCoverage: [] };
  const scoped = source.points.sort(compareByScore);
  const points = scoped.filter((point): point is PlottedPoint => point.cost != null && point.rate != null);
  const costless = scoped.filter((point): point is CostlessPoint => point.cost == null && point.rate != null);
  const unplotted = scoped.filter((point) => point.rate == null);
  return {
    combined,
    activeTask,
    points,
    costless,
    unplotted,
    partialCoverage: source.partialCoverage,
    // Each view auto-scales x from $0 to its own visible domain: one game's
    // pair keeps the room its small costs need, and the combined totals — the
    // landing view — get the room their larger sums need.
    maxCost: points.reduce((max, point) => Math.max(max, point.cost), 0),
  };
}

/** Arena-owned chart mark box. */
export const CHART_CHIP = 24;
export const CHART_CHIP_R = CHART_CHIP / 2;
/** Centre gap between the last cost mark and the missing-cost rail. */
export const CHART_MARK_DX = CHART_CHIP + 10;
/** The square's desktop ceiling; it grows to the panel and stops here. */
export const CHART_MAX_PLOT = 520;
/** 13px axis ticks (`--t-xs`). Matches the on-plot word estimate. */
const AXIS_FONT = 13;
const AXIS_CHAR = AXIS_FONT * 0.62;
const TICK_NA_GAP = 8;
const COST_TICK_FACTORS = [1, 2, 5];

export function measureAxisText(text: string): number {
  return text.length * AXIS_CHAR;
}

export function logCostDomain(minCost: number, maxCost: number): { min: number; max: number; ticks: number[] } {
  const safeMin = minCost > 0 ? minCost : 0.1;
  const safeMax = maxCost > 0 ? Math.max(maxCost, safeMin) : 1;
  const minExponent = Math.floor(Math.log10(safeMin));
  const paddedMax = safeMax * 1.05;
  const candidates: number[] = [];
  for (let exponent = minExponent; exponent <= Math.ceil(Math.log10(paddedMax)) + 1; exponent += 1) {
    for (const factor of COST_TICK_FACTORS) candidates.push(factor * (10 ** exponent));
  }
  const min = 10 ** minExponent;
  const max = candidates.find((candidate) => candidate >= paddedMax) ?? 10 ** (minExponent + 1);
  return { min, max, ticks: candidates.filter((candidate) => candidate >= min && candidate <= max) };
}

export function formatCostTick(value: number): string {
  if (value < 0.1) return `$${value.toFixed(2)}`;
  if (value < 1) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(0)}`;
}

export interface ChartBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function boxesOverlap(a: ChartBox, b: ChartBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Ink box for a middle-anchored 13px tick. */
export function axisLabelBox(text: string, cx: number, baselineY: number): ChartBox {
  const width = measureAxisText(text);
  return { x0: cx - width / 2, x1: cx + width / 2, y0: baselineY - 11, y1: baselineY + 2 };
}

export function chipBox(px: number, py: number): ChartBox {
  return {
    x0: px - CHART_CHIP_R,
    x1: px + CHART_CHIP_R,
    y0: py - CHART_CHIP_R,
    y1: py + CHART_CHIP_R,
  };
}

/** Number drawn under a numbered mark. */
export function chipNumberBox(px: number, py: number): ChartBox {
  return { x0: px - 7, x1: px + 7, y0: py + CHART_CHIP_R + 4, y1: py + CHART_CHIP_R + 13 };
}

export interface ChartPlotLayout {
  compact: boolean;
  pad: { top: number; right: number; bottom: number; left: number };
  plot: number;
  plotH: number;
  bandGap: number;
  bandWidth: number;
  bandX: number;
  /** Centre of the cost-n/a rail. */
  bandCx: number;
  svgWidth: number;
  svgHeight: number;
  xMin: number;
  xMax: number;
  xTicks: number[];
  lastTickX: number;
  lastTickText: string;
  naLabel: string | null;
  tickY: number;
  axisTitleX: number;
  axisTitleY: number;
}

/**
 * The scatter's x geometry. A scored mark with no cost sits in a labelled
 * slot after the last cost tick — not on an invented x, and not on the last
 * tick. Positive reported costs use a logarithmic axis because the released
 * values span roughly two orders of magnitude.
 */
export function chartPlotLayout(
  width: number,
  minCost: number,
  maxCost: number,
  costlessCount: number,
): ChartPlotLayout {
  const compact = width < 460;
  const hasCostless = costlessCount > 0;
  const pad = {
    top: compact ? 34 : 28,
    right: compact ? 10 : 36,
    // A mark on the score floor writes its number immediately below the dot.
    // Keep the cost-n/a tick below that number instead of sharing its pixels.
    bottom: hasCostless ? 74 : 58,
    left: compact ? 36 : 62,
  };
  const { min: xMin, max: xMax, ticks: xTicks } = logCostDomain(minCost, maxCost);
  const lastTickText = formatCostTick(xMax);
  // The rail's label speaks the site's own vocabulary for a missing value.
  const naLabel = hasCostless ? (compact ? "no $" : "cost not reported") : null;
  const bandWidth = hasCostless ? CHART_CHIP + 4 : 0;
  // Last cost tick is on the plot's right edge. The n/a column starts after
  // that edge by enough that the tick text, a 24px mark on the edge, and
  // "cost n/a" do not share pixels.
  const labelClearance = naLabel == null
    ? 0
    : measureAxisText(lastTickText) / 2 + measureAxisText(naLabel) / 2 + TICK_NA_GAP;
  const chipClearance = CHART_MARK_DX - CHART_CHIP_R;
  const centerPastPlot = naLabel == null ? 0 : Math.max(labelClearance, chipClearance);
  const bandGap = naLabel == null ? 0 : Math.max(compact ? 6 : 8, centerPastPlot - bandWidth / 2);
  const plot = Math.max(Math.min(width - pad.left - pad.right - bandGap - bandWidth, CHART_MAX_PLOT), 180);
  const plotH = compact ? Math.round(plot * 1.35) : plot;
  const bandX = pad.left + plot + bandGap;
  const bandCx = bandX + bandWidth / 2;
  const svgWidth = pad.left + plot + bandGap + bandWidth + pad.right;
  const svgHeight = pad.top + plotH + pad.bottom;
  const lastTickX = pad.left + plot;
  const tickY = pad.top + plotH + (hasCostless ? 40 : 24);
  return {
    compact,
    pad,
    plot,
    plotH,
    bandGap,
    bandWidth,
    bandX,
    bandCx,
    svgWidth,
    svgHeight,
    xMin,
    xMax,
    xTicks,
    lastTickX,
    lastTickText,
    naLabel,
    tickY,
    axisTitleX: pad.left + plot / 2,
    axisTitleY: svgHeight - 12,
  };
}

export function plotX(layout: ChartPlotLayout, cost: number): number {
  if (cost <= 0) throw new Error(`cost must be positive on a logarithmic axis, got ${cost}`);
  const span = Math.log10(layout.xMax) - Math.log10(layout.xMin);
  return layout.pad.left + ((Math.log10(cost) - Math.log10(layout.xMin)) / span) * layout.plot;
}

/** Score-axis floor as a 0–1 rate, snapped to the 25-grid. */
export function scoreAxisMin(rates: readonly number[]): { yMin: number; yMinPct: number } {
  const yMinPct = rates.length > 0
    ? Math.min(75, Math.max(0, Math.floor((Math.min(...rates) * 100 - 5) / 25) * 25))
    : 0;
  return { yMin: yMinPct / 100, yMinPct };
}

export function plotY(layout: ChartPlotLayout, rate: number, yMin: number): number {
  return layout.pad.top + ((1 - rate) / (1 - yMin)) * layout.plotH;
}

/** A scored mark: honest y, whether or not it has an x. */
export type ScoredChartPoint = ChartPoint & { rate: number };

/** Effort rank for the connecting line: the axis a model walks when only its
 * effort changes. Unknown efforts (router "default") never join a line. */
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

const LABEL_FONT = 13;
const LABEL_GAP = CHART_CHIP_R + 8;

export interface ChartShareMark {
  point: ScoredChartPoint;
  px: number;
  py: number;
}

export interface ChartShareLabel {
  point: ScoredChartPoint;
  px: number;
  py: number;
  flip: boolean;
  labelY: number;
  showEffort: boolean;
  /** Left edge of the on-plot word; text x is x0 when start-anchored. */
  x0: number;
  /** Right edge of the on-plot word; text x is x1 when end-anchored. */
  x1: number;
  y0: number;
  y1: number;
}

export interface ChartShareEffortLine {
  lead: string;
  /** First member, so the view can take the quiet series tint from it. */
  point: ScoredChartPoint;
  points: Array<{ px: number; py: number }>;
}

export interface ChartShareModel {
  layout: ChartPlotLayout;
  yMin: number;
  yMinPct: number;
  yTicks: number[];
  drawnMarks: ChartShareMark[];
  named: ChartShareLabel[];
  numbered: ScoredChartPoint[];
  numberOf: Map<string, number>;
  effortLines: ChartShareEffortLine[];
  scoreOrdered: ScoredChartPoint[];
}

interface LabelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  flip: boolean;
  labelY: number;
}

function measureLabel(text: string): number {
  return text.length * LABEL_FONT * 0.62;
}

function labelBox(
  px: number,
  py: number,
  text: string,
  opts: { inBand: boolean; svgWidth: number; crowdedRight: boolean; extraLine: boolean },
): LabelBox {
  const width = measureLabel(text);
  const fits = px + LABEL_GAP + width <= opts.svgWidth - 2;
  const flip = opts.inBand || !fits || opts.crowdedRight;
  const x0 = flip ? px - LABEL_GAP - width : px + LABEL_GAP;
  const x1 = flip ? px - LABEL_GAP : px + LABEL_GAP + width;
  const labelY = py + 4;
  const height = opts.extraLine ? 26 : 14;
  return { x0, x1, y0: labelY - 10, y1: labelY - 10 + height, flip, labelY };
}

function labelsOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 + 6 && b.x0 < a.x1 + 6 && a.y0 < b.y1 + 4 && b.y0 < a.y1 + 4;
}

function boxHitsChip(box: LabelBox, px: number, py: number): boolean {
  return box.x0 < px + CHART_CHIP_R + 4
    && px - CHART_CHIP_R < box.x1 + 4
    && box.y0 < py + CHART_CHIP_R + 4
    && py - CHART_CHIP_R < box.y1 + 4;
}

/**
 * Plot geometry, mark positions, numbers, and on-plot words for one scatter
 * view. The live chart and the OG still share this so a share image cannot
 * invent a second Combined layout.
 */
export function chartShareModel(input: {
  points: PlottedPoint[];
  costless: CostlessPoint[];
  maxCost: number;
  width: number;
  partsOf: (point: ChartPoint) => ConfigurationParts;
}): ChartShareModel {
  const { points, costless, maxCost, width, partsOf } = input;
  const minCost = points.length > 0
    ? points.reduce((min, point) => Math.min(min, point.cost), Number.POSITIVE_INFINITY)
    : 0.1;
  const layout = chartPlotLayout(width, minCost, maxCost, costless.length);
  const { compact, pad, plot, svgWidth, bandCx } = layout;
  const rates = [...points, ...costless].map((point) => point.rate);
  const { yMin, yMinPct } = scoreAxisMin(rates);
  const y = (rate: number) => plotY(layout, rate, yMin);
  const x = (cost: number) => plotX(layout, cost);
  const yStep = 100 - yMinPct <= 25 ? 5 : 25;
  const yTicks: number[] = [];
  for (let tick = yMinPct; tick <= 100; tick += yStep) yTicks.push(tick);

  const effortRank = (point: ChartPoint) => EFFORT_ORDER.indexOf(partsOf(point).effort);
  const families = new Map<string, PlottedPoint[]>();
  for (const point of points) {
    if (effortRank(point) < 0) continue;
    const lead = partsOf(point).lead;
    families.set(lead, [...(families.get(lead) ?? []), point]);
  }

  const scoredMarks: ScoredChartPoint[] = [...points, ...costless];
  const scoreOrdered = [...scoredMarks].sort(compareByScore);
  const harnessKeyOf = (point: ChartPoint) => partsOf(point).harness;

  // A scatter mark is data, not decoration: never move it to make labels fit.
  // Close marks are resolved by numbering, the exact-value list and filters.
  const drawnMarks: ChartShareMark[] = [
    ...points.map((point) => ({ point: point as ScoredChartPoint, px: x(point.cost), py: y(point.rate) })),
    ...costless.map((point) => ({
      point: point as ScoredChartPoint,
      px: bandCx,
      py: y(point.rate),
    })),
  ];

  const byTrial = new Map(drawnMarks.map((mark) => [mark.point.trialId, mark]));
  const effortLines: ChartShareEffortLine[] = [...families.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([lead, members]) => {
      const ordered = [...members].sort((a, b) => effortRank(a) - effortRank(b));
      return {
        lead,
        point: ordered[0],
        points: ordered.map((member) => {
          const placed = byTrial.get(member.trialId);
          return { px: placed?.px ?? x(member.cost), py: placed?.py ?? y(member.rate) };
        }),
      };
    });

  const boxOpts = (point: ScoredChartPoint, px: number, extraLine: boolean) => ({
    inBand: point.cost == null,
    svgWidth,
    crowdedRight: !compact && px > pad.left + plot * 0.82,
    extraLine,
  });
  const hitsExisting = (box: LabelBox, ownId: string, existing: LabelBox[]) =>
    existing.some((done) => labelsOverlap(done, box))
    || drawnMarks.some((mark) => mark.point.trialId !== ownId && boxHitsChip(box, mark.px, mark.py));

  // Label what fits, number only the rest. The chart is a share face: a
  // reader of the image cannot hover, so every mark that has room for its
  // word gets it, and only the marks whose word genuinely collides fall
  // back to a number resolved in the key. Compact plots stay fully
  // numbered — phone width has no room for on-plot words.
  // Effort is part of the word only when it separates two marks that would
  // otherwise read identically (same harness and model). Everywhere else the
  // word is the model alone — a suffix that appears only where it happens
  // to fit reads as an inconsistency, not as information.
  const wordKeyOf = (point: ScoredChartPoint) => `${harnessKeyOf(point)}|${point.label}`;
  const wordCounts = new Map<string, number>();
  for (const point of scoredMarks) {
    const key = wordKeyOf(point);
    wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
  }
  const needsEffort = (point: ScoredChartPoint) =>
    point.labelSuffix.length > 0 && (wordCounts.get(wordKeyOf(point)) ?? 0) > 1;

  const named: ChartShareLabel[] = [];
  if (!compact) {
    const tryPlace = (point: ScoredChartPoint, px: number, py: number) => {
      const showEffort = needsEffort(point);
      const candidate = labelBox(px, py, point.label, boxOpts(point, px, showEffort));
      if (hitsExisting(candidate, point.trialId, named)) return;
      named.push({ point, px, py, showEffort, ...candidate });
    };
    for (const item of [...drawnMarks].sort((a, b) => a.py - b.py)) tryPlace(item.point, item.px, item.py);
  }
  const namedIds = new Set(named.map((label) => label.point.trialId));
  // Numbers walk the same score order the leaderboard ranks in, skipping the
  // marks whose word already stands.
  const numbered = scoreOrdered.filter((point) => !namedIds.has(point.trialId));
  const numberOf = new Map(numbered.map((point, index) => [point.trialId, index + 1]));

  return {
    layout,
    yMin,
    yMinPct,
    yTicks,
    drawnMarks,
    named,
    numbered,
    numberOf,
    effortLines,
    scoreOrdered,
  };
}
