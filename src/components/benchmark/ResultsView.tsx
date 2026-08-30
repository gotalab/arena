import { configurationParts, configurationSummaries, releaseReady } from "../../lib/configurations";
import { formatRunDateRange } from "../../lib/format";
import { compareByScore, scoreValue } from "../../lib/score";
import type { PublicGame as Game, PublicRelease as Release } from "../../public-types";
import { ConfigurationName } from "../ConfigurationName";
import { ComplianceChart } from "./ComplianceChart";
import { Leaderboard } from "./Leaderboard";

interface ResultsViewProps {
  tasks: Game[];
  /** Open that game's Benchmark detail. */
  onOpenGame: (taskId: string) => void;
  release: Release;
}

/**
 * The record at /benchmark: eyebrow, room name, the one About sentence,
 * then score against cost and the leaderboard. Nothing personal sits above
 * the ranking; the reader's own pick lives on that game's detail page and
 * the Play reveal.
 */
export function ResultsView({ tasks, onOpenGame, release }: ResultsViewProps) {
  const ready = releaseReady(release, tasks);
  // A stock harness's strength is a dated claim: the scope line says when
  // these runs actually executed.
  const runDates = formatRunDateRange(release.builds.map((trial) => trial.startedAt));

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

      {ready ? (
        <>
          {/* The ranking is the page's answer and reads first; the scatter
              is the analysis under it. */}
          <Leaderboard release={release} tasks={tasks} />
          <section className="answer" aria-labelledby="chart-heading">
            <div className="answer__head">
              <h2 id="chart-heading">Score against cost</h2>
            </div>
            <ComplianceChart release={release} tasks={tasks} />
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
        {tasks.map((task) => {
          const top = configurationSummaries(release, [task])
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
