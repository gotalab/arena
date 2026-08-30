import { gateBadge, scoreEvidence, scoreValue, speakScore } from "../../lib/score";
import { trialSummary } from "../../lib/trials";
import type { Series } from "../../lib/configurations";
import type { PublicBuild as Trial, PublicCellScore as CellScore } from "../../public-types";
import { ConfigurationName } from "../ConfigurationName";

interface TrialCardProps {
  buildLabel?: string;
  compact?: boolean;
  preferred?: boolean;
  /**
   * The published score of the cell this build showcases — the mean over its
   * replicas. Without it the card falls back to this one run's own share,
   * which is what a card for a build outside the published cells can honestly
   * claim.
   */
  score?: CellScore | null;
  series: Series;
  trial: Trial;
}

/**
 * One build, at a glance: identity, one big score, three operational figures.
 * The score is the configuration's score for this game — averaged over its
 * replicas, with its interval and n — while the timings and cost below belong
 * to this one showcased run, which is the run a reader can play and inspect.
 * Everything else — per-check outcomes, evidence, provenance — lives in the
 * checks table and the sealed records, not on the card. Full on the Benchmark
 * pair, compact on the Play reveal (side letters are blind-flow vocabulary).
 */
export function TrialCard({ buildLabel, compact = false, preferred = false, score = null, series, trial }: TrialCardProps) {
  const summary = trialSummary(trial);
  const namedAbove = compact && preferred;
  // The run card is an evidence surface, so a blocked build says WHY it
  // rated 0 (ADR 0015): the blocking failure is named before the number.
  const gateFailed = Boolean(score) && !score!.gatesPassed;
  const badge = gateBadge(score);
  const className = [
    "run",
    compact ? "run--compact" : "",
    preferred ? "is-preferred" : "",
    gateFailed ? "is-gate-failed" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={className}>
      <header className="run__id">
        {compact && !namedAbove ? <p className="run__build">{buildLabel}</p> : null}
        <h3>{namedAbove ? buildLabel : <ConfigurationName parts={series.parts} />}</h3>
        {preferred ? (
          <p className="run__effort">
            <span className="pill">Your pick</span>
          </p>
        ) : null}
      </header>

      <div className="run__score">
        {score ? (
          <span className="visually-hidden">
            {gateFailed ? `${badge.spoken}, ` : ""}{speakScore(score)}
          </span>
        ) : null}
        <span aria-hidden={score ? "true" : undefined} className="run__pct">
          {gateFailed ? <span className="gate-fail">{badge.glyph} {badge.label}</span> : null}
          {score ? scoreValue(score) : summary.requirements.rateLabel}
          {score ? <span className="run__ci">{scoreEvidence(score, "runs")}</span> : null}
        </span>
        <span className="run__counts">
          This build · {summary.requirements.label} checks · {summary.playable.toLowerCase()}
        </span>
      </div>

      <dl className="run__ops">
        <div><dt>Time</dt><dd>{summary.metrics.seconds}</dd></div>
        <div><dt>Tokens</dt><dd>{summary.metrics.tokens}</dd></div>
        <div>
          <dt>Cost</dt>
          <dd
            title={summary.raw.costBasis === "list-price"
              ? "Computed from sealed token counts at the model's public API list price"
              : undefined}
          >
            {summary.raw.costBasis === "list-price" ? "~" : ""}{summary.metrics.estimatedCost}
          </dd>
        </div>
      </dl>
    </article>
  );
}
