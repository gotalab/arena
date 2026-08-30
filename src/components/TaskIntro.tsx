import type { PublicGame as Game } from "../public-types";

/**
 * The task's front face, in selling order: art first, one hook line, then
 * the actions. The hero reuses the arena-floor surface — the same
 * permanently dark slab the blind stage plays on — so the page gets its
 * one saturated moment without inventing a second dark language. The full
 * brief follows as a labelled spec sheet, not an essay.
 *
 * No back control here: readers arrive from Play, Benchmark and shared
 * links, so one arrow cannot tell the truth about where "back" is. The
 * persistent nav is the way out.
 */
export function TaskIntro({
  onBrowse,
  onCompare,
  task,
  compareLabel = "Compare blind",
}: {
  onBrowse: () => void;
  onCompare: () => void;
  task: Game;
  compareLabel?: string;
}) {
  return (
    <>
      <header className="taskhero">
        <img alt="" className="taskhero__art" decoding="async" src={task.image} />
        <div className="taskhero__body">
          <h1 className="taskhero__title" id="game-detail-heading">{task.name}</h1>
          <p className="taskhero__hook">{task.browseRule}</p>
          <div className="taskhero__actions">
            <button className="btn-primary btn-primary--inline" onClick={onCompare} type="button">{compareLabel}</button>
            <button className="btn-quiet btn-quiet--floor" onClick={onBrowse} type="button">Browse results</button>
          </div>
        </div>
      </header>
      <dl className="taskspec">
        <div>
          <dt>Rule</dt>
          <dd>{task.rule}</dd>
        </div>
        <div>
          <dt>The catch</dt>
          <dd>{task.tension}</dd>
        </div>
        <div>
          <dt>Controls</dt>
          <dd>{task.inputSummary}</dd>
        </div>
      </dl>
    </>
  );
}
