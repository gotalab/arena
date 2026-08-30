import { configurationParts, configurationSummaries, releaseReady } from "../../lib/configurations";
import { formatRunDateRange } from "../../lib/format";
import { compareByScore, scoreValue } from "../../lib/score";
import {
  normalizeBenchmarkOverviewState,
  selectVisibleConfigurationIds,
  selectVisibleTasks,
  type BenchmarkOverviewState,
} from "../../lib/benchmark-view";
import type { PublicGame as Game, PublicRelease as Release } from "../../public-types";
import { ConfigurationName } from "../ConfigurationName";
import { ComplianceChart } from "./ComplianceChart";
import { FilterSelect } from "./FilterSelect";
import { Leaderboard } from "./Leaderboard";

interface ResultsViewProps {
  tasks: Game[];
  /** Open that game's Benchmark detail. */
  onOpenGame: (taskId: string) => void;
  release: Release;
  state: BenchmarkOverviewState;
  onStateChange: (state: BenchmarkOverviewState) => void;
}

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/**
 * The record at /benchmark: eyebrow, room name, the one About sentence,
 * then score against cost and the leaderboard. Nothing personal sits above
 * the ranking; the reader's own pick lives on that game's detail page and
 * the Play reveal.
 */
export function ResultsView({ tasks, onOpenGame, release, state, onStateChange }: ResultsViewProps) {
  // A stock harness's strength is a dated claim: the scope line says when
  // these runs actually executed.
  const runDates = formatRunDateRange(release.builds.map((trial) => trial.startedAt));
  const normalized = normalizeBenchmarkOverviewState(state, release, tasks);
  const visibleTaskIds = new Set(selectVisibleTasks(release, tasks, normalized).map((task) => task.id));
  const visibleTasks = tasks.filter((task) => visibleTaskIds.has(task.id));
  const ready = releaseReady(release, visibleTasks);
  const configurationIds = selectVisibleConfigurationIds(release, tasks, normalized);
  const configurations = release.configurations.map((configuration) => configurationParts(configuration));
  const harnessOptions = [...new Set(configurations.map((parts) => parts.harness))].sort();
  const modelOptions = [...new Set(configurations.map((parts) => parts.model))].sort();
  const effortOptions = [...new Set(configurations.map((parts) => parts.effort))]
    .sort()
    .map((value) => ({ value, label: value || "No effort setting" }));
  const update = (patch: Partial<BenchmarkOverviewState>) => {
    onStateChange(normalizeBenchmarkOverviewState({ ...normalized, ...patch }, release, tasks));
  };
  const activeFilterCount = normalized.taskIds.length
    + normalized.harnesses.length
    + normalized.models.length
    + normalized.efforts.length
    + (normalized.playableOnly ? 1 : 0);

  return (
    <section className="doc bench" aria-labelledby="record-heading">
      <header className="bench__head">
        <p className="bench__scope">
          Current published benchmark · {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          {runDates ? ` · runs ${runDates}` : ""}
        </p>
        <h1 className="bench__title" id="record-heading">Benchmark</h1>
        <p className="bench__lede">
          A playable benchmark of coding agents. You play the games they ship,
          you compare them, and the record is public.
          Taste and spec live in the same match.
        </p>
      </header>

      <div aria-label="Benchmark filters" className="filter-row benchmark-filters" role="group">
        <FilterSelect
          label="Task"
          onToggle={(value) => update({ taskIds: toggleValue(normalized.taskIds, value) })}
          options={tasks.map((task) => ({ value: task.id, label: task.name }))}
          selected={new Set(normalized.taskIds)}
        />
        <FilterSelect
          label="Harness"
          onToggle={(value) => update({ harnesses: toggleValue(normalized.harnesses, value) })}
          options={harnessOptions}
          selected={new Set(normalized.harnesses)}
        />
        <FilterSelect
          label="Model"
          onToggle={(value) => update({ models: toggleValue(normalized.models, value) })}
          options={modelOptions}
          selected={new Set(normalized.models)}
        />
        <FilterSelect
          label="Effort"
          onToggle={(value) => update({ efforts: toggleValue(normalized.efforts, value) })}
          options={effortOptions}
          selected={new Set(normalized.efforts)}
        />
        <label className="check-toggle">
          <input checked={normalized.playableOnly} onChange={(event) => update({ playableOnly: event.target.checked })} type="checkbox" />
          Playable builds only
        </label>
        {activeFilterCount > 0 ? (
          <button className="link-plain" onClick={() => update({ taskIds: [], harnesses: [], models: [], efforts: [], playableOnly: false, chartTaskId: "combined" })} type="button">
            Clear filters
          </button>
        ) : null}
      </div>
      <p aria-live="polite" className="benchmark-filter-summary">
        Showing {configurationIds.length} {configurationIds.length === 1 ? "agent" : "agents"} across {visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}.
      </p>

      {ready ? (
        <>
          {/* The ranking is the page's answer and reads first; the scatter
              is the analysis under it. */}
          <Leaderboard configurationIds={configurationIds} release={release} tasks={visibleTasks} />
          <section className="answer" aria-labelledby="chart-heading">
            <div className="answer__head">
              <h2 id="chart-heading">Score against cost</h2>
            </div>
            <ComplianceChart
              configurationIds={configurationIds}
              onViewChange={(chartTaskId) => update({ chartTaskId })}
              release={release}
              tasks={visibleTasks}
              view={normalized.chartTaskId}
            />
          </section>
        </>
      ) : (
        <div className="mask">
          <h2>Benchmark is not final yet.</h2>
          <p>The leaderboard and chart appear once every game has a run from every agent.</p>
        </div>
      )}

      <section className="detail" aria-labelledby="game-list-heading">
        <h2 id="game-list-heading">Task by task</h2>
        {visibleTasks.map((task) => {
          const top = configurationSummaries(release, [task])
            .filter((summary) => configurationIds.includes(summary.configuration.id))
            .filter((summary) => summary.score.replicasCounted > 0)
            .sort(compareByScore)[0];
          const topParts = top ? configurationParts(top.configuration) : null;
          return (
            <a
              className="ledger"
              href={`/task/${task.slug}`}
              key={task.id}
              onClick={(event) => { event.preventDefault(); onOpenGame(task.id); }}
            >
              <span className="ledger__name">
                <strong>{task.name}</strong>
              </span>
              {top && topParts ? (
                <span className="ledger__lead">
                  <ConfigurationName parts={topParts} />
                  {" leads · "}
                  {scoreValue(top.score)}
                </span>
              ) : null}
              <span aria-hidden="true" className="ledger__go">→</span>
            </a>
          );
        })}
      </section>
    </section>
  );
}
