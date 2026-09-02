import { useMemo, useState } from "react";
import { useSelectedReviewWebMcpTools } from "../hooks/useSelectedReviewWebMcpTools";
import { seriesOf } from "../lib/configurations";
import type { PublicGameTaskManifest } from "../lib/game-tools";
import { cellScoreForTrial } from "../lib/score";
import type { SelectedReviewPaneStatus } from "../lib/selected-review-tools";
import { artifactSrc } from "../lib/trials";
import type { PublicBuild, PublicGame, PublicRelease } from "../public-types";
import { Stage } from "./Stage";
import { TrialCard } from "./benchmark/TrialCard";

interface SelectedReviewProps {
  task: PublicGame;
  release: PublicRelease;
  builds: readonly PublicBuild[];
  selectedCriteria: readonly string[];
  totalBuilds: number;
  gameToolsManifest: PublicGameTaskManifest | null;
  onClose: () => void;
}

function shuffled<T>(values: readonly T[]): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const random = globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 2 ** 32);
    const target = random % (index + 1);
    [next[index], next[target]] = [next[target]!, next[index]!];
  }
  return next;
}

export function SelectedReview({ task, release, builds, selectedCriteria, totalBuilds, gameToolsManifest, onClose }: SelectedReviewProps) {
  const [candidates] = useState(() => shuffled(builds));
  const [activeIndex, setActiveIndex] = useState(0);
  const [statuses, setStatuses] = useState<SelectedReviewPaneStatus[]>(() => candidates.map(() => "idle"));
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  // undefined means no choice yet; null is the human's explicit "none" choice.
  const [humanChoice, setHumanChoice] = useState<number | null | undefined>(undefined);

  const openCandidate = (candidate: number) => {
    const index = candidate - 1;
    setActiveIndex(index);
    setVisited((current) => current.has(index) ? current : new Set([...current, index]));
  };
  const allReady = candidates.every((_, index) => visited.has(index) && statuses[index] === "ready");
  const revealedCandidates = useMemo(() => humanChoice === undefined ? null : candidates.map((build, index) => ({
    candidate: index + 1,
    buildId: build.id,
    configuration: seriesOf(release, build.configurationId).parts.name,
    score: cellScoreForTrial(release, build).mean,
  })), [candidates, humanChoice, release]);
  const toolContext = useMemo(() => ({
    taskId: task.id,
    taskName: task.name,
    activeCandidate: activeIndex + 1,
    candidateCount: candidates.length,
    selectedCriteria,
    candidateStatus: statuses,
    humanChoiceAvailable: allReady && humanChoice === undefined,
    humanChoice,
    revealedCandidates,
    openCandidate,
  }), [activeIndex, allReady, candidates.length, humanChoice, revealedCandidates, selectedCriteria, statuses, task.id, task.name]);
  useSelectedReviewWebMcpTools(toolContext);

  const updateStatus = (id: string, status: SelectedReviewPaneStatus) => {
    const index = candidates.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    setStatuses((current) => current[index] === status ? current : current.map((value, candidateIndex) => candidateIndex === index ? status : value));
  };

  return (
    <section className="arena arena--review" aria-labelledby="selected-review-title">
      <div className="arena__bar">
        <button className="btn-quiet" onClick={onClose} type="button">← Results</button>
        <div className="arena__title">
          <p className="review__eyebrow">Agent-selected anonymous review</p>
          <h1 id="selected-review-title">{task.name}</h1>
        </div>
        <p className="review__selection">{candidates.length} selected from {totalBuilds}</p>
      </div>

      <div className="review__brief" aria-label="Review basis">
        <p>The Agent narrowed the published evidence. Play its shortlist before seeing names or scores.</p>
        {selectedCriteria.length > 0 ? (
          <ul>{selectedCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>
        ) : <p className="review__criteria-empty">No criteria filter — the selected Builds are the review basis.</p>}
      </div>

      <div className="arena__floor">
        <Stage
          activeIndex={activeIndex}
          gameToolsManifest={gameToolsManifest ?? undefined}
          onPaneStatus={updateStatus}
          onSelect={(index) => openCandidate(index + 1)}
          panes={candidates.map((build, index) => ({
            id: build.id,
            src: artifactSrc(build),
            title: `${task.name} anonymous candidate ${index + 1}`,
            tabLabel: String(index + 1),
          }))}
          presentation={task.presentation}
          tablistLabel="Review candidates"
        />
        {humanChoice === undefined ? (
          <section className="verdict" aria-labelledby="review-choice-heading">
            <h2 id="review-choice-heading">Which one feels right?</h2>
            {allReady ? (
              <>
                <div className="verdict__options review__options">
                  <button className="verdict__beat" onClick={() => setHumanChoice(activeIndex + 1)} type="button">Keep candidate {activeIndex + 1}</button>
                  <button className="verdict__side" onClick={() => setHumanChoice(null)} type="button">None of these</button>
                </div>
                <p className="verdict__note">This is your choice. The Agent cannot make it for you.</p>
              </>
            ) : (
              <p className="verdict__locked">Open every candidate before choosing · {visited.size} of {candidates.length} opened</p>
            )}
          </section>
        ) : null}
      </div>

      {humanChoice !== undefined ? (
        <section className="reveal review__reveal" aria-live="polite">
          <p className="reveal__kicker">{humanChoice == null ? "None selected" : `You kept candidate ${humanChoice}`}</p>
          <h2 className="reveal__headline reveal__headline--sentence">Now compare your feel with the published evidence.</h2>
          <div className="pair review__cards">
            {candidates.map((build, index) => (
              <TrialCard
                buildLabel={`Candidate ${index + 1}`}
                compact
                key={build.id}
                preferred={humanChoice === index + 1}
                score={cellScoreForTrial(release, build)}
                series={seriesOf(release, build.configurationId)}
                showIdentityWhenPreferred
                trial={build}
              />
            ))}
          </div>
          <p className="review__provenance">Agent-selected anonymous review. This choice does not affect the public benchmark or Blind record.</p>
        </section>
      ) : null}
    </section>
  );
}
