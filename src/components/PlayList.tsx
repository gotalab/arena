import { taskPath } from "../lib/paths";
import type { PublicGame as Game } from "../public-types";

interface PlayListProps {
  tasks: Game[];
  onOpenGame: (taskId: string) => void;
}

/**
 * `/play`: see the published games, then tap one to play it blind.
 * A jacket-forward grid: square face, name, one line, whole-card tap.
 * itch.io grammar, not itch.io chrome: no prices, stars, Download, or tags.
 * Each card opens the task's one detail page; blind comparison is a clear
 * action there instead of a hidden meaning of the card.
 */
export function PlayList({ tasks, onOpenGame }: PlayListProps) {
  return (
    <section aria-labelledby="play-heading" className="play">
      <h1 className="play__title" id="play-heading">Play</h1>
      <ul className="play-grid">
        {tasks.map((task) => (
          <li key={task.id}>
            <a
              className="play-card"
              href={taskPath(task.slug)}
              onClick={(event) => { event.preventDefault(); onOpenGame(task.id); }}
            >
              <span className="play-card__still">
                <img alt="" className="play-card__art" decoding="async" loading="lazy" src={task.image} />
              </span>
              <span className="play-card__copy">
                <strong className="play-card__name">{task.name}</strong>
                <span className="play-card__rule">{task.browseRule}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
