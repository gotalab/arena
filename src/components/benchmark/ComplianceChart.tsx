import { useEffect, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, PointerEvent, RefObject, SetStateAction } from "react";
import {
  CHART_CHIP_R,
  CHART_COMBINED,
  chartShareModel,
  chartView,
  formatCostTick,
  plotX,
  plotY,
  type ChartPoint,
} from "../../lib/chart";
import {
  configurationParts,
  configurationsById,
  seriesTokenOf,
  type ConfigurationParts,
} from "../../lib/configurations";
import { formatCost } from "../../lib/format";
import { formatScore, gateBadge, speakScore, type ScoreEvidenceUnit } from "../../lib/score";
import type { PublicGame as Game, PublicRelease as Release } from "../../public-types";

type ScoredPoint = ChartPoint & { rate: number };

function useMeasuredWidth(fallback: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface ComplianceChartProps {
  tasks: Game[];
  release: Release;
  configurationIds: readonly string[];
  view: string;
  onViewChange: (view: string) => void;
}

/**
 * Score against estimated cost, on a square plot area. Two kinds of
 * view share the square: the combined totals (one mark per configuration, the
 * default) and a single game's runs.
 *
 * Identity is accurate text plus an Arena-owned series dot. On-plot text is
 * the model, then effort if it still fits. When labels collide, the compact
 * number and key path resolves them. Color supports identity but is never the
 * only name of a point. A blocked build's penalty already sits in its y value,
 * and the reason lives in the hover receipt, data table, and evidence page.
 * Pointer or keyboard focus on a mark opens that receipt.
 *
 * The y value is the cell's score — the mean over its replicas — so a mark is
 * not one run's luck. A cell with no scorable replica has no honest y position
 * and is never plotted: it is named under the chart and kept in the data table
 * with its counts.
 */
export function ComplianceChart({ tasks, release, configurationIds, view, onViewChange }: ComplianceChartProps) {
  const [ref, width] = useMeasuredWidth(560);
  // Hover / keyboard focus only. Never a click-to-open, never a tap modal.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const activeId = focusedId ?? hoveredId;
  const model = chartView(release, tasks, view);
  const { activeTask, combined, partialCoverage } = model;
  const scoreUnit: ScoreEvidenceUnit = combined ? "tasks" : "runs";

  const byId = configurationsById(release);
  const partsOf = (point: ChartPoint) => configurationParts(byId.get(point.configurationId));
  // Quiet series color follows the model family. Text still names each point.
  const tokenOf = (point: ChartPoint) => seriesTokenOf(byId.get(point.configurationId));
  const allowedConfigurations = new Set(configurationIds);
  const visible = (point: ChartPoint) => allowedConfigurations.has(point.configurationId);
  const points = model.points.filter(visible);
  const costless = model.costless.filter(visible);
  const unplotted = model.unplotted.filter(visible);
  const hiddenCount = model.points.length + model.costless.length - points.length - costless.length;

  // A labelled slot after the last cost tick holds scored marks whose cost
  // was not reported: their y is real, their x honestly does not exist. The
  // slot is one 24px mark wide, not a grey slab, and it sits past the costed
  // fan so "$70" and "cost n/a" never share pixels. Geometry is shared with
  // the OG still so a share image cannot invent a second Combined layout.
  const share = chartShareModel({
    points,
    costless,
    maxCost: model.maxCost,
    width,
    partsOf,
  });
  const {
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
  } = share;
  const {
    compact,
    pad,
    plot,
    plotH,
    bandCx,
    svgWidth,
    svgHeight,
    xTicks,
    naLabel,
    tickY,
    axisTitleX,
    axisTitleY,
  } = layout;
  // Compact has no hover: the numbered key names the marks. Do not invent a
  // tap modal. Wide viewports open a site receipt on pointer/focus.
  const hoverable = !compact;
  useEffect(() => {
    setHoveredId(null);
    setFocusedId(null);
  }, [view, configurationIds, hoverable]);
  const x = (cost: number) => plotX(layout, cost);
  // The score axis trims to the data: when every mark sits high, a 0-anchored
  // axis crushes them into a band and the differences the chart exists to show
  // become unreadable. The floor snaps to the 25-grid a comfortable margin
  // below the lowest mark, never above 75, and the trim is declared in the
  // caption — a cut axis is honest only when it says so.
  const y = (rate: number) => plotY(layout, rate, yMin);
  const describe = (point: ChartPoint) => (combined
    ? `${point.configurationName}: ${speakScore(point.score, "tasks")} of requirements met at an average cost per task of ${formatCost(point.cost)}`
    : `${point.configurationName}: ${speakScore(point.score, "runs")} of ${point.name} requirements met at an average of ${formatCost(point.cost)} per run`);
  // Every sequence the chart emits reads in the leaderboard's score order:
  // scoreOrdered merges the costed and cost-n/a marks, and the unscored
  // builds close the list.
  const description = [...scoreOrdered, ...unplotted].map(describe).join("; ");
  // `activeTask` is non-null exactly when the view is not the combined totals.
  const chartLabel = combined
    ? `Scatter chart of total requirements met against task-balanced average cost per task on a logarithmic cost axis, one series dot per agent across all ${tasks.length} tasks, named by model or numbered in the key.`
    : `Scatter chart of requirements met against average cost per run on a logarithmic cost axis, showing the ${activeTask!.name} cells, each series dot named by model or numbered in the key.`;
  // Compact keeps the enumeration on the image. Hoverable marks speak for
  // themselves, so the group name stays the chart, not every receipt twice.
  const ariaLabel = hoverable ? chartLabel : `${chartLabel} ${description}.`;
  const activeMark = activeId
    ? drawnMarks.find((mark) => mark.point.trialId === activeId) ?? null
    : null;
  const tableCaption = combined
    ? `Total requirements met and task-balanced average cost per task for each agent across all ${tasks.length} tasks`
    : `Requirements met and average cost per run for ${activeTask!.name}, one cell per agent`;
  // The only sentences under the plot, and each earns its place: what is
  // missing from the plot (unplotted, partial coverage) and what the axis
  // does (trim). The cost-n/a band and the ~ marks are labelled where they
  // stand, and the list-price rule lives with the leaderboard's note.
  const unplottedNote = unplotted.length === 0 ? null : combined
    ? `${unplotted.length} agent total${unplotted.length === 1 ? " is" : "s are"} not plotted: ${unplotted.map((point) => point.configurationName).join(", ")}. No replica produced a score.`
    : `${unplotted.length} mark${unplotted.length === 1 ? " is" : "s are"} not plotted: ${unplotted.map((point) => point.configurationName).join(", ")}. No score was reported.`;
  const trimNote = yMinPct > 0 ? `Score axis starts at ${yMinPct}%.` : null;
  const partialNote = partialCoverage.length === 0 ? null
    : `Shown per game only (no combined total yet): ${partialCoverage.map((entry) => entry.label).join(", ")}.`;
  const filterNote = hiddenCount > 0
    ? `Filters hide ${hiddenCount} scored mark${hiddenCount === 1 ? "" : "s"}.`
    : null;
  const notes = [filterNote, unplottedNote, partialNote, trimNote].filter(Boolean).join(" ");

  const options = [
    { id: CHART_COMBINED, label: "Combined" },
    ...tasks.map((task) => ({ id: task.id, label: task.name })),
  ];

  return (
    <figure className="chart">
      <div aria-label="Chart view" className="tabs chart__views" role="group">
        {options.map((option) => (
          <button
            aria-pressed={view === option.id}
            key={option.id}
            onClick={() => onViewChange(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="chart__plot" ref={ref}>
      <div className="chart__canvas" style={{ maxWidth: `${svgWidth}px` }}>
      <svg
        aria-label={ariaLabel}
        className={compact ? "chart__svg chart__svg--compact" : "chart__svg"}
        height={svgHeight}
        role={hoverable ? "group" : "img"}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className={tick === yMinPct ? "chart-base" : "chart-grid"}
              x1={pad.left}
              x2={pad.left + plot}
              y1={y(tick / 100)}
              y2={y(tick / 100)}
            />
            <text className="chart-tick" textAnchor="end" x={pad.left - (compact ? 6 : 12)} y={y(tick / 100) + 4}>{tick}%</text>
          </g>
        ))}
        {xTicks.map((tick, index) => (
          <text
            className="chart-tick"
            key={`x-${tick}`}
            textAnchor="middle"
            x={x(tick)}
            y={tickY}
          >
            {compact && index % 2 === 1 && index !== xTicks.length - 1 ? "" : formatCostTick(tick)}
          </text>
        ))}
        <text className="chart-axis-title" textAnchor="middle" x={axisTitleX} y={axisTitleY}>
          {combined ? "Average cost per task (USD, log scale) →" : "Average cost per run (USD, log scale) →"}
        </text>
        {naLabel != null ? (
          <g>
            {/* A thin rail, not a grey slab: one labelled slot for a real
                score that has no x. The mark sits on the rail; the label
                names why it is off the cost axis. The slot is past the last
                cost tick, so the label does not sit on "$70". */}
            <line
              className="chart-band-rail"
              x1={bandCx}
              x2={bandCx}
              y1={pad.top}
              y2={pad.top + plotH}
            />
            <text
              className="chart-tick"
              textAnchor="middle"
              x={bandCx}
              y={tickY}
            >
              {naLabel}
            </text>
          </g>
        ) : null}
        {/* A rotated title needs a gutter the phone does not have: at 375px it
            lands on the tick labels. Compact writes it horizontally above the
            plot instead, where the top padding already holds room. */}
        {compact ? (
          <text className="chart-axis-title" textAnchor="start" x={pad.left} y={12}>
            Requirements met ↑
          </text>
        ) : (
          <text
            className="chart-axis-title"
            textAnchor="middle"
            transform={`rotate(-90 16 ${pad.top + plotH / 2})`}
            x={16}
            y={pad.top + plotH / 2}
          >
            Requirements met →
          </text>
        )}

        {/* The effort walk: one line through a family whose members differ
            only in effort, drawn under the marks. The line carries no
            identity of its own — its endpoints are labelled marks. */}
        {effortLines.map(({ lead, point, points: line }) => (
          <polyline
            className="chart-effort-line"
            key={`effort-${lead}`}
            points={line.map((member) => `${member.px},${member.py}`).join(" ")}
            style={{ stroke: `var(--series-${tokenOf(point)}, var(--ink-2))` }}
          />
        ))}

        {drawnMarks.map(({ point, px, py }) => {
          const n = numberOf.get(point.trialId);
          return (
            <g
              aria-label={hoverable ? describe(point) : undefined}
              className="chart-point"
              key={point.trialId}
              role={hoverable ? "img" : undefined}
              {...markHoverHandlers(point.trialId, hoverable, setHoveredId, setFocusedId)}
            >
              {/* The halo preserves the generous hit area while the solid dot
                  matches the text-first benchmark language. */}
              <circle
                className="chart-point__halo"
                cx={px}
                cy={py}
                r={CHART_CHIP_R + 2}
                style={{ fill: `var(--series-${tokenOf(point)}, var(--ink))` }}
              />
              <circle
                className="chart-point__mark"
                cx={px}
                cy={py}
                r={6}
                style={{ fill: `var(--series-${tokenOf(point)}, var(--ink))` }}
              />
              {/* Invisible hit target so hover and focus still find the point. */}
              <circle className="chart-point__hit" cx={px} cy={py} r={CHART_CHIP_R + 2} />
              {n != null ? (
                <text
                  className="chart-point__num"
                  textAnchor="middle"
                  x={px}
                  y={py + CHART_CHIP_R + 11}
                >
                  {n}
                </text>
              ) : null}
            </g>
          );
        })}
        {named.map(({ point, flip, labelY, showEffort, x0, x1 }) => (
          <g key={`label-${point.trialId}`}>
            <text
              className="chart-point__label"
              textAnchor={flip ? "end" : "start"}
              x={flip ? x1 : x0}
              y={labelY}
            >
              {point.label}
            </text>
            {showEffort ? (
              <text
                className="chart-point__effort"
                textAnchor={flip ? "end" : "start"}
                x={flip ? x1 : x0}
                y={labelY + 13}
              >
                {point.labelSuffix}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {hoverable && activeMark ? (
        <ChartReceipt
          parts={partsOf(activeMark.point)}
          point={activeMark.point}
          scoreUnit={scoreUnit}
          px={activeMark.px}
          py={activeMark.py}
          svgHeight={svgHeight}
          svgWidth={svgWidth}
        />
      ) : null}
      </div>
      </div>

      {/* Numbers in the same score order the leaderboard ranks in, so the
          list under the plot and the table below it never disagree about
          who comes first. The key names only the numbered marks — the ones
          whose word could not stand on the plot. */}
      {numbered.length > 0 ? (
        <ol className="chart__key" aria-label="Chart marks by number">
          {numbered.map((point) => (
            <li key={point.trialId}>
              <b>{numberOf.get(point.trialId)}</b>
              <span>
                {point.label}
                {point.labelSuffix ? <small> {point.labelSuffix}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      <ol className={`chart__list${numbered.length > 0 ? " chart__list--numbered" : ""}`} aria-label="Score against cost">
        {scoreOrdered.map((point) => (
          <li key={point.trialId}>
            {numbered.length > 0 ? <b className="chart__list-n">{numberOf.get(point.trialId) ?? ""}</b> : null}
            <b>{point.configurationName}</b>
            <span>{formatScore(point.score, scoreUnit)}</span>
            <span>
              {point.cost == null
                ? "cost not reported"
                : `${point.costBasis === "list-price" ? "~" : ""}${formatCost(point.cost)}`}
            </span>
          </li>
        ))}
      </ol>

      {notes ? <figcaption className="chart__unplotted">{notes}</figcaption> : null}

      <div className="chart__data visually-hidden">
      <table>
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">{combined ? "Tasks scored" : "Task"}</th>
            <th scope="col">Showcase build checks</th>
            <th scope="col">Blocking</th>
            <th scope="col">Score</th>
            <th scope="col">{combined ? "Average cost per task" : "Average cost per run"}</th>
          </tr>
        </thead>
        <tbody>
          {[...scoreOrdered, ...unplotted].map((point) => (
            <tr key={point.trialId}>
              <td>{point.configurationName}</td>
              <td>{combined ? point.score.n : point.name}</td>
              <td>{point.requirementLabel}</td>
              <td>{point.score.gatesPassed ? "Clear" : `Blocked (rated 0): ${gateBadge(point.score).label}`}</td>
              <td>{formatScore(point.score, scoreUnit)}</td>
              <td>{point.costBasis === "list-price" ? `~${formatCost(point.cost)}` : formatCost(point.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

function markHoverHandlers(
  trialId: string,
  hoverable: boolean,
  setHoveredId: Dispatch<SetStateAction<string | null>>,
  setFocusedId: Dispatch<SetStateAction<string | null>>,
) {
  if (!hoverable) return {};
  return {
    tabIndex: 0,
    focusable: true,
    onPointerEnter: (event: PointerEvent<SVGGElement>) => {
      if (event.pointerType === "touch") return;
      setHoveredId(trialId);
    },
    onPointerLeave: (event: PointerEvent<SVGGElement>) => {
      if (event.pointerType === "touch") return;
      setHoveredId((current) => (current === trialId ? null : current));
    },
    onFocus: () => setFocusedId(trialId),
    onBlur: () => setFocusedId((current) => (current === trialId ? null : current)),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key !== "Escape") return;
      event.currentTarget.blur();
      setFocusedId((current) => (current === trialId ? null : current));
    },
  };
}

function ChartReceipt({
  parts,
  point,
  px,
  py,
  scoreUnit,
  svgHeight,
  svgWidth,
}: {
  parts: ConfigurationParts;
  point: ScoredPoint;
  px: number;
  py: number;
  scoreUnit: ScoreEvidenceUnit;
  svgHeight: number;
  svgWidth: number;
}) {
  const flipX = px / svgWidth > 0.62;
  const flipY = py / svgHeight < 0.22;
  const cost = point.cost == null
    ? "cost not reported"
    : `${point.costBasis === "list-price" ? "~" : ""}${formatCost(point.cost)}`;
  const gateFailed = !point.score.gatesPassed;
  const badge = gateFailed ? gateBadge(point.score) : null;
  // A flipped receipt anchors by `right`, not `left` + translate: an
  // absolutely positioned box laid out from `left` near the edge has almost
  // no width to shrink-to-fit into, so its lines wrap — the transform moves
  // it after layout and cannot give the width back.
  const anchor = flipX
    ? { right: `${(1 - px / svgWidth) * 100}%` }
    : { left: `${(px / svgWidth) * 100}%` };
  return (
    <div
      aria-hidden="true"
      className="chart-receipt"
      style={{
        ...anchor,
        top: `${(py / svgHeight) * 100}%`,
        transform: `translate(${flipX ? "-10px" : "10px"}, ${flipY ? "10px" : "calc(-100% - 10px)"})`,
      }}
    >
      <div className="chart-receipt__copy">
        <p className="chart-receipt__harness">{parts.harness}</p>
        <p className="chart-receipt__model">{parts.model}</p>
        {parts.effort ? <p className="chart-receipt__effort">{parts.effort}</p> : null}
        <p className="chart-receipt__score">{formatScore(point.score, scoreUnit)}</p>
        <p className="chart-receipt__cost">{cost}</p>
        {badge ? <p className="chart-receipt__gate">blocked · {badge.label}</p> : null}
      </div>
    </div>
  );
}
