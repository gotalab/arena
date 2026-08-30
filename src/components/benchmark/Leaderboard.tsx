import { configurationParts, configurationSummaries } from "../../lib/configurations";
import { selectRankableTasks } from "../../lib/benchmark-view";
import type { ConfigurationSummary } from "../../lib/configurations";
import { formatCost, formatSeconds, formatTokens } from "../../lib/format";
import { compareByScore, scoreEvidence, scoreValue, speakScore } from "../../lib/score";
import type { PublicGame as Game, PublicRelease as Release } from "../../public-types";
import { ConfigurationName } from "../ConfigurationName";

/**
 * The ranked answer, in the grammar public agent leaderboards settled on:
 * rank, configuration identity, one big score, then the operational columns.
 * Nothing explanatory lives in a cell — reasons, evidence and caveats belong
 * to the per-game evidence and the methodology footer.
 *
 * The order is the score, plain (ADR 0015). Blocking failures are already in
 * the number: the generator rates a blocked replica 0, so an unplayable
 * build sinks by arithmetic and the table needs no second tier, no badge and
 * no muted percentage. Why a build rated 0 is evidence, and lives on the
 * evidence surfaces.
 *
 * The score is the mean over replicas with its 95% interval, so the rank is
 * a rank of means. Two configurations whose intervals overlap are not
 * separated by the evidence, and the table does not yet say so: CI-overlap
 * tie handling (a shared rank, or a "not separated" mark) is future work, and
 * needs the five-replica cohort before it would show anything.
 */
export function Leaderboard({ tasks, release, configurationIds }: { tasks: Game[]; release: Release; configurationIds: readonly string[] }) {
  // Preview games (built by less than half the roster) stay out of the
  // aggregate: one early build must not flip every configuration to partial.
  const ranked = selectRankableTasks(release, tasks);
  if (ranked.length === 0) {
    return (
      <section className="board" aria-labelledby="leaderboard-heading">
        <h2 id="leaderboard-heading">Leaderboard</h2>
        <div className="mask">
          <p>This task is published as a preview and does not yet have enough roster coverage for a combined ranking.</p>
        </div>
      </section>
    );
  }
  const allowedConfigurations = new Set(configurationIds);
  const all = configurationSummaries(release, ranked)
    .filter((summary) => allowedConfigurations.has(summary.configuration.id))
    .slice()
    .sort(compareByScore);
  // Only a configuration that ran every game has a total the ranking can
  // compare; ranking a one-game total against two-game totals would reward
  // skipping games. Partial rows are still shown — unranked, coverage named —
  // never hidden, and never allowed to blank the whole table.
  const summaries = all.filter((summary) => summary.tasksCovered === ranked.length);
  // A lane with published builds for only some games is shown unranked. A lane
  // with no published build at all is not a result yet — it returns to the
  // table when a run of it finishes, and until then it is not listed.
  const partial = all.filter((summary) => summary.tasksCovered !== ranked.length && summary.runsSucceeded > 0);
  const shown = [...summaries, ...partial];
  const anyListPriceCost = shown.some((summary) => summary.costAtListPrice);
  // The per-row evidence label earns its ink only when it says more than the
  // column-wide fact. While every ranked total covers the same tasks and no
  // interval needs disclosing, one legend line replaces the same words on
  // every row; the spoken score still carries the full claim per row.
  const rowEvidence = shown.some((summary) => scoreEvidence(summary.score, "tasks").includes("±"));

  return (
    <section className="board" aria-labelledby="leaderboard-heading">
      <h2 id="leaderboard-heading">
        Leaderboard
      </h2>
      {/* A real <table>: column alignment is structural, not a grid contract a
          markup change can silently break. The wrapper owns the sticky-header
          scroll region, so a long table keeps its top rows in view. */}
      <div className="board__scroll">
        <table className="board__table" aria-label="Agents ranked by requirements met">
          <thead>
            <tr className="board__row">
              <th scope="col" className="board__rank">#</th>
              <th scope="col" className="board__lead">Agent</th>
              <th scope="col" className="board__score">Score</th>
              <th scope="col" className="board__num">Avg time / task</th>
              <th scope="col" className="board__num">Avg tokens / task</th>
              <th scope="col" className="board__num">Avg cost / task</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary, index) => (
              <BoardRow key={summary.configuration.id} rank={index + 1} showEvidence={rowEvidence} summary={summary} />
            ))}
            {partial.map((summary) => (
              <BoardRow
                coverage={`${summary.tasksCovered} / ${ranked.length} tasks`}
                key={summary.configuration.id}
                rank={null}
                showEvidence={rowEvidence}
                summary={summary}
              />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="board__legend" aria-label="Table legend">
        {!rowEvidence ? (
          <li><b>Score</b> mean over {ranked.length} tasks, every run counted</li>
        ) : null}
        <li><b>Task averages</b> runs are averaged within each task, then tasks are weighted equally; a missing run meter withholds the mean</li>
        {partial.length > 0 ? (
          <li><b>–</b> unranked: builds for only some tasks</li>
        ) : null}
        {anyListPriceCost ? (
          <li><b>~</b> cost estimated at API list prices</li>
        ) : null}
      </ul>
    </section>
  );
}

function BoardRow({
  coverage,
  rank,
  showEvidence,
  summary,
}: {
  coverage?: string;
  rank: number | null;
  showEvidence: boolean;
  summary: ConfigurationSummary;
}) {
  const parts = configurationParts(summary.configuration);
  const rate = summary.score.mean;
  const metricCoverage = (reported: number) => reported === summary.metricRunCount
    ? null
    : `${reported} / ${summary.metricRunCount} runs reported`;

  return (
    <tr className="board__row">
      <td className="board__rank" aria-label={rank == null ? "Unranked" : `Rank ${String(rank)}`}>
        {rank == null ? "–" : rank}
      </td>
      <td className="board__name">
        <b><ConfigurationName parts={parts} /></b>
        {coverage ? <small>{coverage}</small> : null}
      </td>
      <td className="board__score">
        {/* The value and its Task count are one claim and are spoken together. */}
        <span className="visually-hidden">
          {speakScore(summary.score, "tasks")}
        </span>
        {/* The number is the answer; when an interval exists it is disclosed
            beside the value, otherwise the sample lives once in the legend. */}
        <span aria-hidden="true" className={rate == null ? "board__pct board__pct--empty" : "board__pct"}>
          {scoreValue(summary.score)}
          {showEvidence ? <span className="board__ci">{scoreEvidence(summary.score, "tasks")}</span> : null}
        </span>
      </td>
      {/* Desktop: three table columns. Phone: the cells collapse to one quiet
          labelled meta line under the score, because a ranking must stay
          scannable — three stacked labelled blocks per row turn a table into
          cards (see the responsive block in benchmark.css). */}
      <td className="board__num" data-label="Avg time / task">
        {formatSeconds(summary.time)}
        {metricCoverage(summary.timeCoverage) ? <small>{metricCoverage(summary.timeCoverage)}</small> : null}
      </td>
      <td className="board__num" data-label="Avg tokens / task">
        {formatTokens(summary.tokens)}
        {metricCoverage(summary.tokenCoverage) ? <small>{metricCoverage(summary.tokenCoverage)}</small> : null}
      </td>
      <td className="board__num" data-label="Avg cost / task">
        {summary.costAtListPrice ? "~" : ""}{formatCost(summary.estimatedCost)}
        {metricCoverage(summary.costCoverage) ? <small>{metricCoverage(summary.costCoverage)}</small> : null}
      </td>
    </tr>
  );
}
