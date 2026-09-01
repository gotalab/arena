import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allPanesPlayable, type PaneStatus } from "../lib/artifact-frame";
import type { BlindPaneStatus, BlindSide } from "../lib/blind-tools";
import { revealLines, sideIndex, sideLabel } from "../lib/blind";
import { blindPairReady as isReleaseReady, seriesOf } from "../lib/configurations";
import { cellScoreForTrial } from "../lib/score";
import { artifactSrc, trialsByIds } from "../lib/trials";
import { useBlindWebMcpTools } from "../hooks/useBlindWebMcpTools";
import type { Assignment } from "../client-types";
import type { PublicBuild, PublicGame, PublicPlayableBuild, PublicPlayableRelease, PublicRelease, PublicTaskManifest } from "../public-types";
import { ArenaIcon } from "./ArenaIcon";
import { Stage } from "./Stage";
import { TrialCard } from "./benchmark/TrialCard";

const choiceOptions: Array<[string, string]> = [
  ["A", "A"],
  ["TIE", "Tie"],
  ["B", "B"],
  ["BOTH_BROKEN", "Both broken"],
];

function recordUrl(slug: string): string {
  return `${window.location.origin}/task/${slug}`;
}

function recordTitle(name: string): string {
  return `${name} · Playable Arena`;
}

/**
 * The reveal's share affordance: the only share prompt on the site
 * (site-design.md flow rule 4). Share is SNS. The primary control opens
 * X compose for this Task's evidence page, not the blind comparison URL.
 * Copy-link is the quiet second control. Not
 * navigator.share (desktop OS sheets are Mail/Notes, not SNS), not a
 * row of brand buttons.
 */
function ShareLink({ name, slug }: { name: string; slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = recordUrl(slug);
  const title = recordTitle(name);
  const xHref = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions, http); the control stays quiet.
    }
  };

  return (
    <div className="share">
      <a
        aria-label="Share on X"
        className="btn-quiet"
        href={xHref}
        rel="noopener noreferrer"
        target="_blank"
      >
        <ArenaIcon className="btn-quiet__icon" name="share" />
        Share
      </a>
      <button
        aria-live="polite"
        className="link-quiet"
        onClick={() => { void copyLink(); }}
        type="button"
      >
        <ArenaIcon className="btn-quiet__icon" name="copy" />
        <span>{copied ? "Copied" : "Copy link"}</span>
      </button>
    </div>
  );
}

interface GameBrowserProps {
  selectedTask: PublicGame;
  gameToolsManifest: PublicTaskManifest | null;
  /** The next unjudged game in list order after this one, or null when none remain. */
  nextTask: PublicGame | null;
  identitySeen: boolean;
  onOpenStage: (taskId: string) => void;
  /** Open this game's Benchmark detail. */
  onOpenBenchmark: (taskId: string) => void;
  /** Leave this stage back to the Play list. Omit when already there. */
  onCloseStage?: () => void;
  /** Named evidence is loaded only after a choice; null keeps Blind data clean. */
  revealRelease: PublicRelease | null;
  release: PublicPlayableRelease;
  assignmentFor: (taskId: string) => Assignment | null;
  /** Unvoted unordered pairs still open for this game. Hide same-game next at 0. */
  battlesRemaining: number;
  /** Drop the current pair so assignmentFor mints a new unvoted A/B. */
  onNextBattle: () => void;
  choice: string | undefined;
  onChoice: (taskId: string, choice: string, assignmentId: string) => Promise<void>;
}

export function GameBrowser({
  selectedTask,
  gameToolsManifest,
  nextTask,
  identitySeen,
  onOpenStage,
  onOpenBenchmark,
  onCloseStage,
  revealRelease,
  release,
  assignmentFor,
  battlesRemaining,
  onNextBattle,
  choice,
  onChoice,
}: GameBrowserProps) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [choiceError, setChoiceError] = useState("");
  const [choicePending, setChoicePending] = useState(false);
  const [activeSide, setActiveSide] = useState(0);
  // A side is judged only after its iframe has painted. Tabbing onto a blank
  // or 404 frame used to unlock the vote; pane status is the real gate.
  const [paneStatus, setPaneStatus] = useState<Readonly<Record<string, PaneStatus>>>({});
  const playerHeading = useRef<HTMLHeadingElement | null>(null);
  const releaseReady = isReleaseReady(release, selectedTask.id);

  useEffect(() => {
    setAssignment(null);
    setActiveSide(0);
    setPaneStatus({});
    setChoiceError("");
    // Re-entering a game whose last pair is already answered must not
    // resurrect that pair as the only Play. Clear the freeze so the next
    // assignmentFor mints a new unvoted pair. A vote in this sitting does
    // not change selectedTask.id, so the reveal stays until Play another pair.
    if (choice && battlesRemaining > 0) onNextBattle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTask.id]);

  useEffect(() => {
    if (!releaseReady || assignment) return;
    // Wait until nextBattle has dropped the leftover choice; otherwise
    // assignmentFor would still serve the voted pair as the freeze.
    if (choice && battlesRemaining > 0) return;
    setAssignment(assignmentFor(selectedTask.id));
    setActiveSide(0);
    setPaneStatus({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseReady, assignment, selectedTask.id, choice, battlesRemaining]);

  const playerOpen = assignment != null;

  useEffect(() => {
    if (playerOpen) playerHeading.current?.focus();
  }, [playerOpen]);

  const trials = useMemo(() => trialsByIds(release, assignment?.trialIds), [assignment, release]);
  const revealedTrials = useMemo(() => {
    if (!choice || !revealRelease) return [];
    return trials.map((blindTrial) => (
      revealRelease.builds.find((trial) => trial.artifact.sha256 === blindTrial.artifact.sha256)
    )).filter((trial): trial is PublicBuild => Boolean(trial));
  }, [choice, revealRelease, trials]);

  const showSide = useCallback((index: number) => {
    setActiveSide(index);
  }, []);

  const blindToolContext = useMemo(() => {
    if (!assignment || choice || trials.length !== 2) return null;
    const statusFor = (index: number): BlindPaneStatus => paneStatus[trials[index].id] ?? "idle";
    return {
      taskId: selectedTask.id,
      taskName: selectedTask.name,
      activeSide: sideLabel(activeSide) as BlindSide,
      blindChoiceAvailable: !identitySeen,
      sideStatus: { A: statusFor(0), B: statusFor(1) },
      openSide: (side: BlindSide) => showSide(side === "A" ? 0 : 1),
    };
  }, [activeSide, assignment, choice, identitySeen, paneStatus, selectedTask.id, selectedTask.name, showSide, trials]);
  useBlindWebMcpTools(blindToolContext);

  const onPaneStatus = useCallback((id: string, status: PaneStatus) => {
    setPaneStatus((current) => (current[id] === status ? current : { ...current, [id]: status }));
  }, []);

  const submitChoice = async (value: string) => {
    setChoicePending(true);
    setChoiceError("");
    try {
      await onChoice(selectedTask.id, value, assignment!.id);
    } catch (error) {
      setChoiceError(error instanceof Error ? error.message : String(error));
    } finally {
      setChoicePending(false);
    }
  };

  const playNextPair = () => {
    onNextBattle();
    setAssignment(null);
    setActiveSide(0);
    setPaneStatus({});
    setChoiceError("");
  };

  const closeControl = onCloseStage ? (
    <button aria-label="Close" className="btn-icon" onClick={onCloseStage} title="Close" type="button">
      <ArenaIcon name="back" />
    </button>
  ) : null;

  const openBenchmark = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onOpenBenchmark(selectedTask.id);
  };
  const benchmarkHref = `/task/${selectedTask.slug}`;
  const benchmarkLink = (
    <a className="link-quiet" href={benchmarkHref} onClick={openBenchmark}>
      Results
    </a>
  );

  if (playerOpen) {
    const reveal = choice && revealRelease && revealedTrials.length === trials.length
      ? revealLines(choice, revealedTrials, revealRelease)
      : null;
    const pickedSide = sideIndex(choice);
    const bothReady = allPanesPlayable(paneStatus, trials.map((trial) => trial.id));
    const aSideFailed = trials.some((trial) => {
      const status = paneStatus[trial.id];
      return status === "missing" || status === "error";
    });
    return (
      <section className={choice ? "arena" : "arena arena--live"} aria-labelledby="comparison-title">
        <div className="arena__bar">
          {closeControl}
          <div className="arena__title">
            <h1 id="comparison-title" ref={playerHeading} tabIndex={-1}>{selectedTask.name}</h1>
            {benchmarkLink}
          </div>
          <div className="keys" aria-label={`${selectedTask.name} controls`}>
            {selectedTask.controls.map((control) => (
              <span className="key" key={control.label}>
                <kbd>{control.keys}</kbd>
                <span>{control.label}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="arena__floor">
          <Stage
            activeIndex={activeSide}
            gameToolsManifest={gameToolsManifest ?? undefined}
            key={assignment!.id}
            onPaneStatus={onPaneStatus}
            onSelect={showSide}
            presentation={selectedTask.presentation}
            panes={trials.map((trial, index) => ({
              id: trial.id,
              src: artifactSrc(trial),
              title: `${selectedTask.name} anonymous ${sideLabel(index)}`,
              tabLabel: sideLabel(index),
            }))}
          />
          {!choice ? (
            <section className="verdict" aria-labelledby="choice-heading">
              {/* The question is asked only where it can be answered. A
                  reader who has already seen the results gets a statement,
                  not a question with no controls under it. */}
              <h2 id="choice-heading">
                {identitySeen ? "You've seen the results" : "Which would you keep playing?"}
              </h2>
              {identitySeen ? (
                <p className="verdict__locked">Both builds stay playable, but a pick here can't count as blind. Compare them by name from the results page.</p>
              ) : bothReady ? (
                <>
                  <div className="verdict__options">
                    {choiceOptions.map(([value, label]) => (
                      <button
                        className={value === "A" || value === "B" ? "verdict__beat" : "verdict__side"}
                        disabled={choicePending}
                        key={value}
                        onClick={() => submitChoice(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {choiceError && <p className="verdict__error" role="alert">{choiceError}</p>}
                  <p className="verdict__note">Names and scores appear after you choose.</p>
                </>
              ) : (
                <p className="verdict__locked" data-testid="verdict-locked">
                  {aSideFailed
                    ? "A side that didn't load can't be judged. Retry it, then play both."
                    : "Play both before judging. Switch with A and B."}
                </p>
              )}
            </section>
          ) : null}
        </div>

        {choice && !reveal ? <p className="reveal__loading">Loading published results.</p> : null}
        {choice && reveal && revealRelease ? (
          <section className="reveal" aria-live="polite">
            <p className="reveal__kicker">{reveal.kicker}</p>
            <h2 className={reveal.subject ? "reveal__headline" : "reveal__headline reveal__headline--sentence"}>
              {reveal.headline}
            </h2>
            {reveal.subject ? <p className="reveal__subject">{reveal.subject}</p> : null}
            <div className="pair pair--compact">
              {revealedTrials.map((trial, index) => (
                <TrialCard
                  buildLabel={sideLabel(index)}
                  compact
                  key={trial.id}
                  preferred={pickedSide === index}
                  score={cellScoreForTrial(revealRelease, trial)}
                  series={seriesOf(revealRelease, trial.configurationId)}
                  trial={trial}
                />
              ))}
            </div>
            <div className="reveal__actions">
              {battlesRemaining > 0 ? (
                <button className="btn-primary btn-primary--inline" onClick={playNextPair} type="button">
                  Play another pair
                </button>
              ) : null}
              {nextTask ? (
                <button
                  className={battlesRemaining > 0 ? "btn-quiet" : "btn-primary btn-primary--inline"}
                  onClick={() => onOpenStage(nextTask.id)}
                  type="button"
                >
                  Next game: {nextTask.name} <span aria-hidden="true">→</span>
                </button>
              ) : null}
              <a className="btn-quiet" href={benchmarkHref} onClick={openBenchmark}>
                {selectedTask.name} results
              </a>
              <ShareLink name={selectedTask.name} slug={selectedTask.slug} />
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  return (
    <section className="arena" aria-labelledby="comparison-title">
      <div className="arena__bar">
        {closeControl}
        <div className="arena__title">
          <h1 id="comparison-title">{selectedTask.name}</h1>
          {benchmarkLink}
        </div>
      </div>
      {releaseReady ? null : (
        <p>Not ready yet.</p>
      )}
    </section>
  );
}
