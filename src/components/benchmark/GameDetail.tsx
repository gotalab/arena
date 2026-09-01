import { useEffect, useRef, useState } from "react";
import { hasBlindVerdict, isTaskOpen, preferredTrialId } from "../../lib/blind";
import { configurationParts, configurationsById, operationalForCell, seriesOf } from "../../lib/configurations";
import type { ConfigurationParts } from "../../lib/configurations";
import { formatCompactTokens, formatCost, formatRunDate, formatSeconds, formatTokens } from "../../lib/format";
import { cellScoreForTrial, compareByScore, scoreEvidence, scoreValue } from "../../lib/score";
import { artifactSrc, buildsForTask, trialSummary } from "../../lib/trials";
import type { ComparisonState } from "../../client-types";
import type { PublicBuild as Trial, PublicGame as Game, PublicRelease as Release, PublicTaskManifest } from "../../public-types";
import { ArenaIcon } from "../ArenaIcon";
import { ConfigurationName } from "../ConfigurationName";
import { Stage } from "../Stage";
import { TaskIntro } from "../TaskIntro";
import { ChecksTable } from "./ChecksTable";
import { FilterSelect } from "./FilterSelect";
import { TaskPrompt } from "./TaskPrompt";
import {
  createTaskCheckComparison,
  normalizeTaskComparisonState,
  selectTaskBuilds,
  TASK_CHECK_OUTCOMES,
  type TaskComparisonState,
} from "../../lib/task-comparison";

interface GameDetailProps {
  task: Game;
  gameToolsManifest: PublicTaskManifest | null;
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
  state: TaskComparisonState;
  onStateChange: (state: TaskComparisonState) => void;
}

const metricCoverage = (reported: number, runs: number) =>
  reported === runs ? null : `${reported} / ${runs} runs reported`;

interface BuildResultRow {
  compactTokens: string;
  cost: string;
  costAtListPrice: boolean;
  costCoverage: string | null;
  evidence: string | null;
  parts: ConfigurationParts;
  playing: boolean;
  preferred: boolean;
  runDate: string;
  runTimestamp: string | null;
  score: string;
  time: string;
  timeCoverage: string | null;
  tokenCoverage: string | null;
  tokens: string;
  trial: Trial;
}

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
export function GameDetail({ task, gameToolsManifest, comparison, initialBuild, initialBrowse = false, onBrowseHandled, onCompare, onOpenBenchmark, onOpenBuild, onReveal, release, state, onStateChange }: GameDetailProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const evidenceRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const criterionTrackingReady = useRef(false);
  const previousCriterionKey = useRef("");
  const justRevealed = useRef(false);
  const browseAfterReveal = useRef(false);
  const [activeTrialId, setActiveTrialId] = useState<string | null>(null);
  const [compareTrialId, setCompareTrialId] = useState<string | null>(null);
  const [activeSide, setActiveSide] = useState(0);
  const [copied, setCopied] = useState(false);
  const all = buildsForTask(release, task.id);
  const ranked: Trial[] = [...all].sort((a, b) => compareByScore(
    { score: cellScoreForTrial(release, a) },
    { score: cellScoreForTrial(release, b) },
  ));
  const configurations = configurationsById(release);
  const partsOfTrial = (trial: Trial) => configurationParts(configurations.get(trial.configurationId));
  const harnessOptions = [...new Set(ranked.map((trial) => partsOfTrial(trial).harness))].sort();
  const modelOptions = [...new Set(ranked.map((trial) => partsOfTrial(trial).model))].sort();
  const effortOptions = [...new Set(ranked.map((trial) => partsOfTrial(trial).effort))]
    .sort()
    .map((value) => ({ value, label: value || "No effort setting" }));
  const normalizedState = normalizeTaskComparisonState(state, release, task.id);
  const criterionKey = normalizedState.check.ids.join("\0");
  const selectedBuildIds = new Set(selectTaskBuilds(release, task.id, normalizedState).map((build) => build.id));
  const rows = ranked.filter((trial) => selectedBuildIds.has(trial.id));
  const checkModel = createTaskCheckComparison(release, task.id, normalizedState);
  const allCheckDefinitions = all.flatMap((trial) => trial.checks ?? []);
  const categoryOptions = [...new Set(allCheckDefinitions.map((check) => check.category))].sort();
  const groupOptions = [...new Set(allCheckDefinitions.map((check) => check.group).filter((value): value is string => Boolean(value)))].sort();
  const criterionOptions = [...new Map(allCheckDefinitions.map((check) => [
    check.id,
    { value: check.id, label: check.label?.trim() || check.id },
  ])).values()];
  const updateState = (patch: Partial<TaskComparisonState>) => {
    onStateChange(normalizeTaskComparisonState({ ...normalizedState, ...patch }, release, task.id));
  };
  const updateCheck = (patch: Partial<TaskComparisonState["check"]>) => {
    updateState({ check: { ...normalizedState.check, ...patch } });
  };
  const toggleValue = (values: readonly string[], value: string): string[] => (
    values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
  );
  const explicitOrAllBuildIds = normalizedState.buildIds.length > 0
    ? normalizedState.buildIds
    : ranked.map((trial) => trial.id);
  const hasActiveFilters = normalizedState.buildIds.length > 0
    || normalizedState.harnesses.length > 0
    || normalizedState.models.length > 0
    || normalizedState.efforts.length > 0
    || normalizedState.check.ids.length > 0
    || normalizedState.check.categories.length > 0
    || normalizedState.check.groups.length > 0
    || normalizedState.check.outcomes.length > 0
    || normalizedState.check.blockingOnly
    || normalizedState.check.differencesOnly;
  const toggleBuild = (buildId: string) => {
    const next = toggleValue(explicitOrAllBuildIds, buildId);
    if (next.length === 0) return;
    updateState({ buildIds: next.length === ranked.length ? [] : next });
  };
  const hiddenCount = ranked.length - rows.length;
  const open = isTaskOpen(comparison, task.id);
  const played = Boolean(comparison.choices?.[task.id]) || hasBlindVerdict(comparison, task.id);
  const preferredTrialIdValue = preferredTrialId(comparison, task.id);
  const activeIndex = rows.findIndex((trial) => trial.id === activeTrialId);
  const active = activeIndex >= 0 ? rows[activeIndex] : null;
  // Per-row evidence collapses to one line when it repeats: while every score
  // in the table is a mean over the same number of runs with no interval to
  // disclose, the sample is said once under the table instead of on every row.
  const rowScores = rows.map((trial) => cellScoreForTrial(release, trial)).filter((score) => score != null);
  const runCounts = new Set(rowScores.map((score) => score.n));
  const anyInterval = rowScores.some((score) => scoreEvidence(score, "runs").includes("±"));
  const uniformRuns = !anyInterval && runCounts.size === 1 ? [...runCounts][0] : null;
  const resultRows: BuildResultRow[] = rows.map((trial) => {
    const summary = trialSummary(trial);
    const score = cellScoreForTrial(release, trial);
    const operational = operationalForCell(release, trial.taskId, trial.configurationId);
    return {
      compactTokens: formatCompactTokens(operational.tokens.mean),
      cost: `${operational.costAtListPrice ? "~" : ""}${formatCost(operational.estimatedCost.mean)}`,
      costAtListPrice: operational.costAtListPrice,
      costCoverage: metricCoverage(operational.estimatedCost.reported, operational.runs),
      evidence: score && uniformRuns == null ? scoreEvidence(score, "runs") : null,
      parts: seriesOf(release, trial.configurationId).parts,
      playing: trial.id === activeTrialId,
      preferred: trial.id === preferredTrialIdValue,
      runDate: formatRunDate(trial.startedAt),
      runTimestamp: trial.startedAt ?? null,
      score: score ? scoreValue(score) : summary.requirements.rateLabel,
      time: formatSeconds(operational.time.mean),
      timeCoverage: metricCoverage(operational.time.reported, operational.runs),
      tokenCoverage: metricCoverage(operational.tokens.reported, operational.runs),
      tokens: formatTokens(operational.tokens.mean),
      trial,
    };
  });
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

  useEffect(() => {
    if (!criterionTrackingReady.current) {
      criterionTrackingReady.current = true;
      previousCriterionKey.current = criterionKey;
      return;
    }
    const previous = previousCriterionKey.current;
    previousCriterionKey.current = criterionKey;
    if (previous && previous !== criterionKey && criterionKey) {
      evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [criterionKey]);

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
  const comparisonCandidates = active ? [
    ...rows.filter((trial) => trial.id === preferredTrialIdValue && trial.id !== active.id),
    ...rows.filter((trial) => trial.id !== preferredTrialIdValue && trial.id !== active.id),
  ] : [];

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
            <p>Scores name who made each game. Seeing them first would sway your vote.</p>
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
                label="Builds"
                onToggle={toggleBuild}
                options={ranked.map((trial) => ({ value: trial.id, label: nameOf(trial) }))}
                selected={new Set(explicitOrAllBuildIds)}
              />
              <FilterSelect
                label="Harness"
                onToggle={(value) => updateState({ harnesses: toggleValue(normalizedState.harnesses, value) })}
                options={harnessOptions}
                selected={new Set(normalizedState.harnesses)}
              />
              <FilterSelect
                label="Model"
                onToggle={(value) => updateState({ models: toggleValue(normalizedState.models, value) })}
                options={modelOptions}
                selected={new Set(normalizedState.models)}
              />
              <FilterSelect
                label="Effort"
                onToggle={(value) => updateState({ efforts: toggleValue(normalizedState.efforts, value) })}
                options={effortOptions}
                selected={new Set(normalizedState.efforts)}
              />
              {hasActiveFilters ? (
                <button
                  className="link-plain"
                  onClick={() => onStateChange(normalizeTaskComparisonState({}, release, task.id))}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
            <p className="buildresults__metric-note">Time, tokens, and cost are averages per run.</p>
            <BuildResults rows={resultRows} onToggle={openBuild} />
            </div>
            {normalizedState.check.ids.length > 0 ? (
              <section aria-live="polite" className="evaluation-lens">
                <p className="eyebrow">Selected criteria</p>
                <h3>Comparing {rows.length} of {ranked.length} Builds on {normalizedState.check.ids.length} criteria</h3>
                <ul>
                  {criterionOptions
                    .filter((option) => normalizedState.check.ids.includes(option.value))
                    .map((option) => <li key={option.value}>{option.label}</li>)}
                </ul>
                <button
                  className="link-plain evaluation-lens__jump"
                  onClick={() => evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  type="button"
                >
                  View results for these criteria
                </button>
              </section>
            ) : null}
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
                  gameToolsManifest={gameToolsManifest ?? undefined}
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
                        {comparisonCandidates.map((trial) => (
                          <option key={trial.id} value={trial.id}>
                            {trial.id === preferredTrialIdValue ? `Your pick · ${nameOf(trial)}` : nameOf(trial)}
                          </option>
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

            <div className="detail__evidence" ref={evidenceRef}>
              <div aria-label="Evaluator check filters" className="filter-row check-filters" role="group">
                <FilterSelect
                  label="Criteria"
                  onToggle={(value) => updateCheck({ ids: toggleValue(normalizedState.check.ids, value) })}
                  options={criterionOptions}
                  selected={new Set(normalizedState.check.ids)}
                />
                <FilterSelect
                  label="Check category"
                  onToggle={(value) => updateCheck({ categories: toggleValue(normalizedState.check.categories, value) })}
                  options={categoryOptions}
                  selected={new Set(normalizedState.check.categories)}
                />
                <FilterSelect
                  label="Check group"
                  onToggle={(value) => updateCheck({ groups: toggleValue(normalizedState.check.groups, value) })}
                  options={groupOptions}
                  selected={new Set(normalizedState.check.groups)}
                />
                <FilterSelect
                  label="Outcome"
                  onToggle={(value) => updateCheck({ outcomes: toggleValue(normalizedState.check.outcomes, value) as TaskComparisonState["check"]["outcomes"] })}
                  options={TASK_CHECK_OUTCOMES.map((value) => ({ value, label: value === "not_evaluated" ? "Not evaluated" : value === "grader_error" ? "Grader error" : value === "missing" ? "Not reported" : value[0].toUpperCase() + value.slice(1) }))}
                  selected={new Set(normalizedState.check.outcomes)}
                />
                <label className="check-toggle">
                  <input checked={normalizedState.check.blockingOnly} onChange={(event) => updateCheck({ blockingOnly: event.target.checked })} type="checkbox" />
                  Blocking only
                </label>
                <label className="check-toggle">
                  <input checked={normalizedState.check.differencesOnly} onChange={(event) => updateCheck({ differencesOnly: event.target.checked })} type="checkbox" />
                  Differences only
                </label>
              </div>
              <p aria-live="polite" className="benchmark-filter-summary">
                Comparing {rows.length} {rows.length === 1 ? "Build" : "Builds"}; showing {checkModel.total} of {checkModel.totalBeforeFilters} evaluator checks.
              </p>
              <ChecksTable model={checkModel} open={normalizedState.check.ids.length > 0} taskName={task.name} />
              <TaskPrompt taskId={task.id} taskName={task.name} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function BuildResults({ rows, onToggle }: { rows: BuildResultRow[]; onToggle: (trialId: string | null) => void }) {
  return (
    <>
      <div className="buildtable__scroll">
        <table className="buildtable">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th className="buildtable__num" scope="col">Score</th>
              <th className="buildtable__num" scope="col" title="Average time per run">Time</th>
              <th className="buildtable__num" scope="col" title="Average tokens per run">Tokens</th>
              <th className="buildtable__num" scope="col" title="Average cost per run">Cost</th>
              <th className="buildtable__num" scope="col">Run</th>
              <th scope="col"><span className="visually-hidden">Play</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.playing ? "is-playing" : undefined} key={row.trial.id}>
                <th scope="row">
                  <b><ConfigurationName parts={row.parts} /></b>
                  {row.preferred ? (
                    <span className="buildtable__tags"><span className="pill">Your pick</span></span>
                  ) : null}
                </th>
                <td className="buildtable__num">
                  <b>{row.score}</b>
                  {row.evidence ? <small>{row.evidence}</small> : null}
                </td>
                <td className="buildtable__num">
                  {row.time}
                  {row.timeCoverage ? <small>{row.timeCoverage}</small> : null}
                </td>
                <td className="buildtable__num">
                  {row.tokens}
                  {row.tokenCoverage ? <small>{row.tokenCoverage}</small> : null}
                </td>
                <td
                  className="buildtable__num"
                  title={row.costAtListPrice
                    ? "Computed from sealed token counts at the model's public API list price"
                    : undefined}
                >
                  {row.cost}
                  {row.costCoverage ? <small>{row.costCoverage}</small> : null}
                </td>
                <td className="buildtable__num" title={row.runTimestamp ?? undefined}>{row.runDate}</td>
                <td><BuildPlayButton onClick={() => onToggle(row.playing ? null : row.trial.id)} playing={row.playing} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol className="buildresults__compact" aria-label="Agent results">
        {rows.map((row, index) => {
          const coverage = [row.timeCoverage, row.tokenCoverage, row.costCoverage]
            .filter((value): value is string => value != null);
          return (
            <li className={row.playing ? "buildresult is-playing" : "buildresult"} key={row.trial.id}>
              <span className="buildresult__rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
              <span className="buildresult__name">
                <b><ConfigurationName parts={row.parts} /></b>
                {row.preferred ? <small>Your pick</small> : null}
              </span>
              <span className="buildresult__score">
                <b>{row.score}</b>
                {row.evidence ? <small>{row.evidence}</small> : null}
              </span>
              <span
                className="buildresult__metrics"
                aria-label={`Average per run: ${row.time}, ${row.tokens}, ${row.cost}. Run ${row.runDate}.`}
              >
                <span>{row.time}</span>
                <span>{row.compactTokens}</span>
                <span>{row.cost}</span>
                <span>{row.runDate}</span>
              </span>
              <BuildPlayButton
                className="buildresult__play"
                onClick={() => onToggle(row.playing ? null : row.trial.id)}
                playing={row.playing}
              />
              {coverage.length > 0 ? (
                <small className="buildresult__coverage">{coverage.join("; ")}</small>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function BuildPlayButton({ className, onClick, playing }: { className?: string; onClick: () => void; playing: boolean }) {
  return (
    <button
      aria-pressed={playing}
      className={["btn-quiet", "buildplay", className].filter(Boolean).join(" ")}
      onClick={onClick}
      type="button"
    >
      <ArenaIcon className="btn-quiet__icon" name={playing ? "close" : "play"} />
      {playing ? "Close" : "Play"}
    </button>
  );
}
