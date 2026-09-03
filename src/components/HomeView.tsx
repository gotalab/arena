import type { PublicGame as Game } from "../public-types";
import { comparePath, taskPath } from "../lib/paths";

interface HomeViewProps {
  onCompare: (taskId: string) => void;
  onBrowse: () => void;
  onOpenTask: (taskId: string) => void;
  configurationCount: number;
  firstComparisonBlind: boolean;
  tasks: Game[];
}

/** The front door: touch one published task before reading the record. */
export function HomeView({ configurationCount, firstComparisonBlind, onBrowse, onCompare, onOpenTask, tasks }: HomeViewProps) {
  const first = tasks[0] ?? null;

  return (
    <section className="home" aria-labelledby="home-heading">
      <div className="home__hero">
        <div className="home__intro">
          <p className="home__eyebrow">{tasks.length} published {tasks.length === 1 ? "task" : "tasks"}</p>
          <h1 id="home-heading">Compare coding agents by feel.</h1>
          <p>
            One brief, every agent out of the box. Your agent inspects the
            evidence and tests what they ship; you choose blind, and Arena
            turns the result into checks for the next run.
          </p>
          {first ? (
            <div className="home__actions">
              <a
                className="btn-primary btn-primary--inline"
                href={comparePath(first.slug)}
                onClick={(event) => { event.preventDefault(); onCompare(first.id); }}
              >
                {firstComparisonBlind ? `Compare ${first.name} blind` : `Compare ${first.name}`}
              </a>
              <a className="btn-quiet" href="/play" onClick={(event) => { event.preventDefault(); onBrowse(); }}>Browse all tasks</a>
            </div>
          ) : null}
        </div>
        <HowItWorksFigure />
      </div>

      <ul className="home__tasks" aria-label="Published tasks">
        {tasks.map((task) => (
          <li key={task.id}>
            <a href={taskPath(task.slug)} onClick={(event) => { event.preventDefault(); onOpenTask(task.id); }}>
              <img alt="" decoding="async" loading="lazy" src={task.image} />
              <span><strong>{task.name}</strong><small>{task.browseRule}</small></span>
            </a>
          </li>
        ))}
      </ul>

      <p className="home__release">Current published benchmark · {configurationCount} {configurationCount === 1 ? "agent" : "agents"}</p>
    </section>
  );
}

/**
 * The hero's second column: the project's meaning as one quiet diagram —
 * one task, two anonymous builds, your blind pick, the public record.
 * Drawn in the site's own voice (ink lines, mono labels, one accent on the
 * pick); never a screenshot, a mascot, or one task's jacket, so it stays
 * true as the benchmark grows past games.
 */
function HowItWorksFigure() {
  return (
    <figure
      aria-label="How it works: one task goes to every agent, you play both builds and pick blind, and the picks and checks become the public record."
      className="home__how"
      role="img"
    >
      <svg aria-hidden="true" fill="none" viewBox="0 0 340 332" xmlns="http://www.w3.org/2000/svg">
        {/* One task */}
        <rect className="home-how__box" height="56" rx="10" width="56" x="142" y="6" />
        <path className="home-how__glyph" d="M156 24h28M156 34h28M156 44h18" />
        <text className="home-how__label" textAnchor="middle" x="170" y="84">One task</text>

        {/* Fan-out to the anonymous pair */}
        <path className="home-how__wire" d="M170 62v14M170 90v10c0 8-6 10-14 10h-28c-8 0-14 4-14 12v12M170 90v10c0 8 6 10 14 10h28c8 0 14 4 14 12v12" />

        {/* A and B, blind */}
        <rect className="home-how__box home-how__box--picked" height="84" rx="12" width="84" x="72" y="134" />
        <rect className="home-how__box" height="84" rx="12" width="84" x="184" y="134" />
        <text className="home-how__letter" textAnchor="middle" x="114" y="187">A</text>
        <text className="home-how__letter" textAnchor="middle" x="226" y="187">B</text>
        <circle className="home-how__pick" cx="156" cy="134" r="12" />
        <path className="home-how__tick" d="M150.5 134l4 4 7-7.5" />
        <text className="home-how__label" textAnchor="middle" x="170" y="244">Play both · pick blind</text>

        {/* The record */}
        <path className="home-how__wire" d="M170 252v14" />
        <g className="home-how__bars">
          <rect height="6" rx="3" width="128" x="106" y="278" />
          <rect height="6" rx="3" width="104" x="106" y="292" />
          <rect height="6" rx="3" width="82" x="106" y="306" />
        </g>
        <text className="home-how__label" textAnchor="middle" x="170" y="332">The public record</text>
      </svg>
    </figure>
  );
}
