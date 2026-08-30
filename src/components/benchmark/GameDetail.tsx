import { useEffect, useRef, useState } from "react";
import { hasBlindVerdict, isTaskOpen, preferredTrialId } from "../../lib/blind";
import { configurationParts, configurationsById, operationalForCell, seriesOf } from "../../lib/configurations";
import { formatCost, formatRunDate, formatSeconds, formatTokens } from "../../lib/format";
import { cellScoreForTrial, compareByScore, scoreEvidence, scoreValue } from "../../lib/score";
import { artifactSrc, buildsForTask, trialSummary } from "../../lib/trials";
import type { ComparisonState } from "../../client-types";
import type { PublicBuild as Trial, PublicGame as Game, PublicRelease as Release } from "../../public-types";
import { ArenaIcon } from "../ArenaIcon";
import { ConfigurationName } from "../ConfigurationName";
import { Stage } from "../Stage";
import { TaskIntro } from "../TaskIntro";
import { ChecksTable } from "./ChecksTable";
import { FilterSelect, toggleFilter } from "./FilterSelect";
import { TaskPrompt } from "./TaskPrompt";

interface GameDetailProps {
  task: Game;
  comparison: ComparisonState;
  initialBuild: Trial | null;
  initialBrowse?: boolean;
  onCompare: () => void;
  onOpenBuild: (trial: Trial | null) => void;
  onBrowseHandled?: () => void;
  /** The one contextual exit to the whole record. */
  onOpenBenchmark: () => void;
  onReveal: (taskId: string) => void;
  release: Release;
}

const metricCoverage = (reported: number, runs: number) =>
  reported === runs ? null : `${reported} / ${runs} runs reported`;

/**
 * One Task page at /task/:slug, built for comparison: every build in
 * one table — identity, score, operational figures — with a Play control per
 * row and ONE stage under the table (the same Stage component the blind
 * matchup uses). The stage plays the selected build, and a "compare with"
 * picker puts a second named build on the same stage to flip between — a
 * comparison lives in your hands, never in a split screen. Rows sit in the
 * leaderboard's own order, by score. Votes still only ever
 * come from the blind flow, and the page stays masked until the reader has
 * either played blind or explicitly asked to see results.
 */
export function GameDetail({ task, comparison, initialBuild, initialBrowse = false, onBrowseHandled, onCompare, onOpenBenchmark, onOpenBuild, onReveal, release }: GameDetailProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const justRevealed = useRef(false);
  const browseAfterReveal = useRef(false);
  const [activeTrialId, setActiveTrialId] = useState<string | null>(null);
  const [compareTrialId, setCompareTrialId] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState(0);
  const [copied, setCopied] = useState(false);
  // The same filter behavior as the chart: one multi-select per dimension,
  // an empty selection means "no filter". Filtering narrows the table, the
  // stage walk and the checks table together, so the page never shows two
  // different rosters at once.
  const [harnessFilter, setHarnessFilter] = useState<ReadonlySet<string>>(new Set());
  const [modelFilter, setModelFilter] = useState<ReadonlySet<string>>(new Set());
  const all = buildsForTask(release, task.id);
  const ranked: Trial[] = [...all].sort((a, b) => compareByScore(
    { score: cellScoreForTrial(release, a) },
    { score: cellScoreForTrial(release, b) },
  ));
  const configurations = configurationsById(release);
  const partsOfTrial = (trial: Trial) => configurationParts(configurations.get(trial.configurationId));
  const harnessOptions = [...new Set(ranked.map((trial) => partsOfTrial(trial).harness))].sort();
  const modelOptions = [...new Set(ranked.map((trial) => partsOfTrial(trial).model))].sort();
  const rows = ranked.filter((trial) => {
    const parts = partsOfTrial(trial);
    if (harnessFilter.size > 0 && !harnessFilter.has(parts.harness)) return false;
    if (modelFilter.size > 0 && !modelFilter.has(parts.model)) return false;
    return true;
  });
  const hiddenCount = ranked.length - rows.length;
  const open = isTaskOpen(comparison, task.id);
  const played = Boolean(comparison.choices?.[task.id]) || hasBlindVerdict(comparison, task.id);
  const preferredArtifact = preferredTrialId(comparison, task.id);
  const activeIndex = rows.findIndex((trial) => trial.id === activeTrialId);
  const active = activeIndex >= 0 ? rows[activeIndex] : null;
  // Per-row evidence collapses to one line when it repeats: while every score
  // in the table is a mean over the same number of runs with no interval to
  // disclose, the sample is said once under the table instead of on every row.
  const rowScores = rows.map((trial) => cellScoreForTrial(release, trial)).filter((score) => score != null);
  const runCounts = new Set(rowScores.map((score) => score.n));
  const anyInterval = rowScores.some((score) => scoreEvidence(score, "runs").includes("±"));
  const uniformRuns = !anyInterval && runCounts.size === 1 ? [...runCounts][0] : null;
  // A lane with a published build elsewhere in the round but none for THIS
  // game gets its absence explained under the table. A lane with no published
  // build anywhere is not part of the round's story yet and is not named.
  const publishedConfigurationIds = new Set(release.builds.map((trial) => trial.configurationId));
  const unfinished = (release.attempts ?? []).filter(
    (attempt) => attempt.taskId === task.id
      && attempt.succeeded === 0
      && publishedConfigurationIds.has(attempt.configurationId),
  );

  // Revealing removes the button that was focused, so send focus to the panel
  // that replaced it instead of dropping the keyboard user at the page top.
  useEffect(() => {
    if (justRevealed.current && open) {
      justRevealed.current = false;
      panelRef.current?.focus();
      if (browseAfterReveal.current) {
        browseAfterReveal.current = false;
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [open]);

  useEffect(() => {
    if (!initialBuild) return;
    if (!open) onReveal(task.id);
    setActiveTrialId(initialBuild.id);
    setCompareTrialId(null);
    setActiveSide(0);
  }, [initialBuild, onReveal, open, task.id]);

  useEffect(() => {
    if (!initialBrowse || !open) return;
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onBrowseHandled?.();
  }, [initialBrowse, onBrowseHandled, open]);

  // Opening a build brings its stage into view — the table stays put, and the
  // player should not have to hunt for where the game appeared.
  useEffect(() => {
    if (activeTrialId) stageRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [activeTrialId]);

  // Walking the stage follows the table's ranked order.
  const step = (delta: number) => {
    const next = rows[activeIndex + delta];
    if (next) openBuild(next.id);
  };

  const openBuild = (trialId: string | null) => {
    setActiveTrialId(trialId);
    setCompareTrialId((current) => (current === trialId ? null : current));
    setActiveSide(0);
    onOpenBuild(trialId ? rows.find((trial) => trial.id === trialId) ?? null : null);
  };

  const nameOf = (trial: Trial) => configurationParts(configurations.get(trial.configurationId)).name;

  const reveal = (taskId: string) => {
    justRevealed.current = true;
    onReveal(taskId);
  };

  const browseResults = () => {
    if (!open) {
      browseAfterReveal.current = true;
      reveal(task.id);
      return;
    }
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const copyBuildLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="doc bench" aria-labelledby="game-detail-heading">
      <div ref={panelRef} tabIndex={-1}>
        <TaskIntro
          compareLabel={comparison.previews[task.id] ? "Compare builds" : "Compare blind"}
          onBrowse={browseResults}
          onCompare={onCompare}
          task={task}
        />

        {all.length === 0 ? (
          <div className="mask">
            <h3>Benchmark for {task.name} is not final yet.</h3>
            <p>This page fills in once the round is published.</p>
          </div>
        ) : !open ? (
          <div className="mask">
            <h3>You have not played {task.name} yet.</h3>
            <p>Scores name who made each game — seeing them first would sway your vote.</p>
            <div className="mask__actions">
              <button className="link-plain" onClick={() => reveal(task.id)} type="button">
                Reveal results without playing
              </button>
            </div>
          </div>
        ) : (
          <>
            <div ref={resultsRef}>
            <div className="detail__sectionrow">
              <h2 className="detail__section">Agent results</h2>
              <a
                className="link-quiet"
                href="/benchmark"
                onClick={(event) => { event.preventDefault(); onOpenBenchmark(); }}
              >
                <span>Across all tasks</span>
              </a>
            </div>
            <div aria-label="Filters" className="filter-row" role="group">
              <FilterSelect
                label="Harness"
                onToggle={(value) => setHarnessFilter(toggleFilter(harnessFilter, value))}
                options={harnessOptions}
                selected={harnessFilter}
              />
              <FilterSelect
                label="Model"
                onToggle={(value) => setModelFilter(toggleFilter(modelFilter, value))}
                options={modelOptions}
                selected={modelFilter}
              />
            </div>
            <div className="buildtable__scroll">
              <table className="buildtable">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th className="buildtable__num" scope="col">Score</th>
                    <th className="buildtable__num" scope="col">Time avg/run</th>
                    <th className="buildtable__num" scope="col">Tokens avg/run</th>
                    <th className="buildtable__num" scope="col">Cost avg/run</th>
                    <th className="buildtable__num" scope="col">Run</th>
                    <th scope="col"><span className="visually-hidden">Play</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((trial) => {
                    const summary = trialSummary(trial);
                    const score = cellScoreForTrial(release, trial);
                    const operational = operationalForCell(release, trial.taskId, trial.configurationId);
                    const parts = seriesOf(release, trial.configurationId).parts;
                    const playing = trial.id === activeTrialId;
                    return (
                      <tr className={playing ? "is-playing" : undefined} key={trial.id}>
                        <th scope="row">
                          <b><ConfigurationName parts={parts} /></b>
                          {trial.artifact.sha256 === preferredArtifact ? (
                            <span className="buildtable__tags">
                              <span className="pill">Your pick</span>
                            </span>
                          ) : null}
                        </th>
                        <td className="buildtable__num" data-label="Score">
                          <b>{score ? scoreValue(score) : summary.requirements.rateLabel}</b>
                          {score && uniformRuns == null ? <small>{scoreEvidence(score, "runs")}</small> : null}
                        </td>
                        <td className="buildtable__num" data-label="Time avg/run">
                          {formatSeconds(operational.time.mean)}
                          {metricCoverage(operational.time.reported, operational.runs) ? (
                            <small>{metricCoverage(operational.time.reported, operational.runs)}</small>
                          ) : null}
                        </td>
                        <td className="buildtable__num" data-label="Tokens avg/run">
                          {formatTokens(operational.tokens.mean)}
                          {metricCoverage(operational.tokens.reported, operational.runs) ? (
                            <small>{metricCoverage(operational.tokens.reported, operational.runs)}</small>
                          ) : null}
                        </td>
                        <td
                          className="buildtable__num"
                          data-label="Cost avg/run"
                          title={operational.costAtListPrice
                            ? "Computed from sealed token counts at the model's public API list price"
                            : undefined}
                        >
                          {operational.costAtListPrice ? "~" : ""}{formatCost(operational.estimatedCost.mean)}
                          {metricCoverage(operational.estimatedCost.reported, operational.runs) ? (
                            <small>{metricCoverage(operational.estimatedCost.reported, operational.runs)}</small>
                          ) : null}
                        </td>
                        <td className="buildtable__num" data-label="Run" title={trial.startedAt ?? undefined}>
                          {formatRunDate(trial.startedAt)}
                        </td>
                        <td data-label="Play">
                          <button
                            className="btn-quiet"
                            onClick={() => openBuild(playing ? null : trial.id)}
                            type="button"
                          >
                            {playing ? (
                              <ArenaIcon className="btn-quiet__icon" name="close" />
                            ) : (
                              <ArenaIcon className="btn-quiet__icon" name="play" />
                            )}
                            {playing ? "Close" : "Play"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
            {!played ? (
              <p className="detail__note">You revealed these results without voting, so comparisons stay playable but no longer count as blind picks.</p>
            ) : null}
            {uniformRuns != null ? (
              <p className="detail__note">Each score is the mean over {uniformRuns} runs, failures included.</p>
            ) : null}
            {hiddenCount > 0 ? (
              <p className="detail__note">
                Filters hide {hiddenCount} {hiddenCount === 1 ? "row" : "rows"}.
              </p>
            ) : null}
            {unfinished.length > 0 ? (
              <p className="detail__note">
                {unfinished.map((attempt) => {
                  const name = configurationParts(configurations.get(attempt.configurationId)).name;
                  return `${name} finished 0 of ${attempt.attempted} attempted ${attempt.attempted === 1 ? "run" : "runs"}`;
                }).join("; ")}
                , so there is no game to play or score.
              </p>
            ) : null}

            {active ? (
              <div className="detail__stage" ref={stageRef}>
                <Stage
                  activeIndex={activeSide}
                  onSelect={setActiveSide}
                  presentation={task.presentation}
                  barLabel={<b className="deck__name">{seriesOf(release, active.configurationId).label}</b>}
                  barExtra={
                    <>
                      <select
                        aria-label="Compare with another run"
                        className="deck__compare"
                        onChange={(event) => {
                          setCompareTrialId(event.target.value || null);
                          setActiveSide(0);
                        }}
                        value={compareTrialId ?? ""}
                      >
                        <option value="">Compare with…</option>
                        {rows.filter((trial) => trial.id !== active.id).map((trial) => (
                          <option key={trial.id} value={trial.id}>{nameOf(trial)}</option>
                        ))}
                      </select>
                      {compareTrialId == null ? (
                        <>
                          <button aria-label="Previous" className="btn-icon" disabled={activeIndex <= 0} onClick={() => step(-1)} title="Previous" type="button">
                            <ArenaIcon name="previous" />
                          </button>
                          <span aria-live="polite" className="deck__count">{activeIndex + 1} / {rows.length}</span>
                          <button aria-label="Next" className="btn-icon" disabled={activeIndex >= rows.length - 1} onClick={() => step(1)} title="Next" type="button">
                            <ArenaIcon name="next" />
                          </button>
                        </>
                      ) : null}
                      {copied ? <span className="deck__copied" role="status">Copied</span> : null}
                      <button
                        aria-label={copied ? "Build link copied" : "Copy build link"}
                        className="btn-icon"
                        onClick={() => { void copyBuildLink(); }}
                        title={copied ? "Copied" : "Copy link"}
                        type="button"
                      >
                        <ArenaIcon name="copy" />
                      </button>
                      <button aria-label="Close the stage" className="btn-icon" onClick={() => openBuild(null)} title="Close" type="button">
                        <ArenaIcon name="close" />
                      </button>
                    </>
                  }
                  panes={[active, ...(compareTrialId ? rows.filter((trial) => trial.id === compareTrialId) : [])].map((trial) => ({
                    id: trial.id,
                    src: artifactSrc(trial),
                    title: `${task.name} by ${nameOf(trial)}`,
                    tabLabel: nameOf(trial),
                  }))}
                />
              </div>
            ) : null}

            <div className="detail__evidence">
              <ChecksTable release={release} taskId={task.id} taskName={task.name} trials={rows} />
              <TaskPrompt taskId={task.id} taskName={task.name} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
