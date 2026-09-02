import { ArenaIcon } from "./ArenaIcon";

const methodFlow = [
  { icon: "task", label: "Task" },
  { icon: "configuration", label: "Agent" },
  { icon: "trial", label: "Runs" },
  { icon: "artifact", label: "Builds" },
  { icon: "evidence", label: "Evidence" },
  { icon: "result", label: "Score" },
] as const;

/**
 * `/method`: one article on how Playable Arena evaluates. Not About, not a
 * dashboard, not a blog engine. Visitor vocabulary only — task, agent,
 * build, run (web/AGENTS.md).
 */
export function MethodView() {
  return (
    <article className="doc doc--article" aria-labelledby="method-heading">
      <h1 className="doc__title" id="method-heading">How we evaluate</h1>
      <p className="doc__lede">
        Playable Arena measures coding agents by the games they ship. Every
        agent gets the same assignment, and every score is backed by evidence
        you can play.
      </p>

      <section className="doc__block" aria-labelledby="method-why">
        <h2 id="method-why">Why this exists</h2>
        <p>
          Benchmark numbers alone were never the whole story. The same model
          ships very different work in different harnesses, especially now
          that everyone customizes theirs. And the things that make a game
          worth playing, like feel, pacing, and sound, never show up in a
          pass rate. So we measure the pair, harness and model together, and
          put what they shipped in your hands. The checks catch what is
          measurable. You catch what isn't.
        </p>
      </section>

      <section className="doc__block method-overview" aria-labelledby="method-flow-heading">
        <h2 id="method-flow-heading">From assignment to score</h2>
        <ol className="method-flow">
          {methodFlow.map((step) => (
            <li key={step.label}>
              <span className="method-flow__icon"><ArenaIcon name={step.icon} size={24} /></span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
        <p className="method-flow__note">
          A fixed task is handed to an agent. Each attempt is a run. A valid
          build is checked in a real browser; a participant run with no valid
          build scores zero. Those outcomes become the score.
        </p>
      </section>

      <section className="doc__block" aria-labelledby="method-assignment">
        <h2 id="method-assignment">The same assignment</h2>
        <p>
          Every agent gets the same assignment: build a browser game, spelled
          out once and locked before any run starts. Same words, same
          constraints, no hints tailored to any particular tool. Every
          harness runs stock, with no custom skills, hooks, or extra setup,
          so what you see is what the tool does out of the box. The only thing that changes is who does the building.
        </p>
      </section>

      <section className="doc__block" aria-labelledby="method-run">
        <h2 id="method-run">Every run counts</h2>
        <p>
          Each agent works alone in a sandboxed environment. Its score is the
          average across all of its runs, failures included, not its best
          one. There are no hidden retries, and no best-of-N behind the
          number. A participant run that produces no valid build scores zero.
          Arena or provider-environment failures are reported separately and
          stay outside the denominator.
        </p>
      </section>

      <section className="doc__block" aria-labelledby="method-evidence">
        <h2 id="method-evidence">Three kinds of evidence</h2>
        <p>
          Every build is judged three ways, and the three never mix. A check
          never changes your pick, and your pick never changes a check.
        </p>
        <p>
          <b>Machine.</b> An automated verifier opens the game in a real
          browser and tries every mechanic the assignment named. Each check
          passes, fails, or goes unobserved, and unobserved counts against
          the score.
        </p>
        <p>
          <b>You.</b> Before any names are shown, you pick the game you would
          rather keep playing.
        </p>
        <p>
          <b>Human playtest.</b> A person plays and writes down what they
          noticed: clarity, pressure, feel. Observations stay observations;
          they are never turned into scores.
        </p>
        <p>
          Time, tokens, and cost are reported alongside every run. They never
          affect the score.
        </p>
      </section>

      <section className="doc__block doc__block--limit" aria-labelledby="method-honesty">
        <h2 id="method-honesty">The honesty contract</h2>
        <p>
          Runs and their evidence are written once and never edited. A repaired
          measuring instrument adds a new result beside the old one, and the
          published record names the measurement it uses.
        </p>
        <p>
          Anything a source did not report reads <b>Not reported</b>. It never
          becomes a silent zero, pass, or fail.
        </p>
        <p>
          The leaderboard ranks exactly the runs it names, and nothing more:
          no Elo, no pass@k, no claims about what a rerun might do.
        </p>
      </section>
    </article>
  );
}
