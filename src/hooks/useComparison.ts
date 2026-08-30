/**
 * The reader's blind comparison state: which side order they were given, what
 * they answered, every battle they have settled, and which tasks they asked
 * to see without playing.
 *
 * Shape invariant: `{assignments, choices, previews, votes}` — the first three
 * keyed by task id (the CURRENT battle), `votes` keyed by unordered pair key —
 * persisted under one per-release localStorage key. The reducer owns every
 * transition, so no component mutates the shape ad hoc.
 */

import { useCallback, useEffect, useMemo, useReducer } from "react";
import { postBlindChoice } from "../lib/api";
import { sideIndex } from "../lib/blind";
import { playableTrialsForTask } from "../lib/trials";
import { comparisonKey, readLocalJson, writeLocalJson } from "../platform/storage";
import type { Assignment, ComparisonState } from "../client-types";
import type { PublicPlayableBuild, PublicPlayableRelease } from "../public-types";

const EMPTY: ComparisonState = { assignments: {}, choices: {}, previews: {}, votes: {} };

type ComparisonAction =
  | { type: "assign"; taskId: string; assignment: Assignment }
  | { type: "choose"; taskId: string; choice: string; pairKey: string; verdict: string }
  | { type: "nextBattle"; taskId: string }
  | { type: "preview"; taskId: string };

export interface UseComparisonResult {
  comparison: ComparisonState;
  assignmentFor: (taskId: string) => Assignment | null;
  battlesRemaining: (taskId: string) => number;
  nextBattle: (taskId: string) => void;
  saveChoice: (taskId: string, choice: string, assignmentId: string) => Promise<void>;
  revealWithoutPlaying: (taskId: string) => void;
}

export function readComparisonState(releaseId: string): ComparisonState {
  const saved = readLocalJson(comparisonKey(releaseId), null);
  if (!saved || typeof saved !== "object") return EMPTY;
  const record = saved as Partial<ComparisonState>;
  return {
    assignments: record.assignments ?? {},
    choices: record.choices ?? {},
    previews: record.previews ?? {},
    votes: record.votes ?? {},
  };
}

/** The unordered identity of a battle: the two trial ids, sorted. */
export function pairKeyOf(trialIds: string[], taskId = ""): string {
  const pair = [...trialIds].sort().join("+");
  return taskId ? `${taskId}--${pair}` : pair;
}

/** A choice resolved out of its side order: winner trial id, or the answer. */
function resolveVerdict(choice: string, buildIds: string[]): string {
  const side = sideIndex(choice);
  return side == null ? choice : buildIds[side] ?? choice;
}

function reducer(state: ComparisonState, action: ComparisonAction): ComparisonState {
  switch (action.type) {
    case "assign":
      return { ...state, assignments: { ...state.assignments, [action.taskId]: action.assignment } };
    case "choose":
      return {
        ...state,
        choices: { ...state.choices, [action.taskId]: action.choice },
        votes: { ...state.votes, [action.pairKey]: action.verdict },
      };
    case "nextBattle":
      return withoutCurrentBattle(state, action.taskId);
    case "preview":
      return { ...state, previews: { ...state.previews, [action.taskId]: true } };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Drop this task's current assignment and choice so the next `resolveBattle`
 * can mint a new pair. Votes stay: a settled pair is never a future battle.
 */
export function withoutCurrentBattle(state: ComparisonState, taskId: string): ComparisonState {
  const assignments = { ...state.assignments };
  const choices = { ...state.choices };
  delete assignments[taskId];
  delete choices[taskId];
  return { ...state, assignments, choices };
}

/** Every unordered pair of a task's playable published builds. */
function allPairs(release: PublicPlayableRelease, taskId: string): PublicPlayableBuild[][] {
  const trials = playableTrialsForTask(release, taskId);
  const pairs: PublicPlayableBuild[][] = [];
  for (let i = 0; i < trials.length; i += 1) {
    for (let j = i + 1; j < trials.length; j += 1) pairs.push([trials[i], trials[j]]);
  }
  return pairs;
}

/** The pairs this reader has not yet settled. */
function unvotedPairs(release: PublicPlayableRelease, taskId: string, votes: Record<string, string>): PublicPlayableBuild[][] {
  return allPairs(release, taskId)
    .filter((pair) => !votes[pairKeyOf(pair.map((trial) => trial.id), taskId)]);
}

/**
 * A fresh randomized battle for a task: a uniformly sampled unsettled pair
 * of playable builds. Unplayable replicas are dropped, not paired against
 * a working opponent. No further curation — every playable build meets
 * every other playable build across sessions, which is also what makes
 * the votes usable as pairwise preference data. Weak playable replicas
 * stay. The side order is a coin flip per reader, so the letters carry
 * no identity.
 *
 * The assignment id is derived from the presented artifact pair, matching the
 * rows seedSql generates (web/scripts/generate-view.mjs): every unordered
 * pair of playable published builds is seeded in both orders.
 */
function createAssignment(release: PublicPlayableRelease, taskId: string, votes: Record<string, string>): Assignment | null {
  const open = unvotedPairs(release, taskId, votes);
  if (open.length === 0) return null;
  const pair = open[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * open.length)];
  const isForward = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0;
  const ordered = isForward ? pair : [...pair].reverse();
  return {
    id: `${taskId}--${ordered.map((trial) => trial.artifact.sha256.slice(0, 12)).join("--")}`,
    trialIds: ordered.map((trial) => trial.id),
  };
}

/**
 * A remembered assignment is only usable while its pair is still unsettled
 * and both builds are still published and playable; otherwise a fresh
 * battle is minted. An unplayable opponent is never kept on deck.
 */
function isUsable(assignment: Assignment | undefined, release: PublicPlayableRelease, taskId: string, votes: Record<string, string>): boolean {
  if (!assignment?.id || !Array.isArray(assignment.trialIds) || assignment.trialIds.length !== 2) return false;
  const playable = new Set(playableTrialsForTask(release, taskId).map((trial) => trial.id));
  if (!assignment.trialIds.every((id) => playable.has(id))) return false;
  return !votes[pairKeyOf(assignment.trialIds, taskId)];
}

/**
 * The current battle for a task: a remembered unvoted assignment, a just-
 * answered assignment (held for the reveal until `withoutCurrentBattle`),
 * or a freshly sampled unvoted pair. Null when every playable pair is
 * settled, or when fewer than two playable replicas exist.
 *
 * A voted pair is never a future battle. The `choices[taskId]` freeze only
 * keeps the just-answered pair on screen; once that freeze is cleared, this
 * samples from the remaining unvoted pairs and will not re-serve the one
 * already in `votes`.
 */
export function resolveBattle(state: ComparisonState, release: PublicPlayableRelease, taskId: string): Assignment | null {
  const existing = state.assignments[taskId];
  const answered = Boolean(state.choices[taskId]);
  if (existing && (answered || isUsable(existing, release, taskId, state.votes))) return existing;
  return createAssignment(release, taskId, state.votes);
}

/** The blind comparison state and the transitions the UI can make. */
export function useComparison(release: PublicPlayableRelease): UseComparisonResult {
  const [comparison, dispatch] = useReducer(reducer, release.releaseId, readComparisonState);

  useEffect(() => {
    writeLocalJson(comparisonKey(release.releaseId), comparison);
  }, [comparison, release.releaseId]);

  /** The reader's current battle for a task, minted on first use; null when
   * every playable pair is settled or fewer than two playable replicas
   * exist. A just-answered battle stays current (its reveal is on screen)
   * until `nextBattle` clears it. */
  const assignmentFor = useCallback((taskId: string): Assignment | null => {
    const current = comparison.assignments[taskId];
    const assignment = resolveBattle(comparison, release, taskId);
    if (assignment && assignment !== current) dispatch({ type: "assign", taskId, assignment });
    return assignment;
  }, [comparison, release]);

  const battlesRemaining = useCallback(
    (taskId: string) => unvotedPairs(release, taskId, comparison.votes).length,
    [comparison.votes, release],
  );

  /** Settle the current battle's reveal and put the next pair on deck. */
  const nextBattle = useCallback((taskId: string) => {
    dispatch({ type: "nextBattle", taskId });
  }, []);

  /** Record the answer: server first when there is one, then locally. */
  const saveChoice = useCallback(async (taskId: string, choice: string, assignmentId: string) => {
    await postBlindChoice({ assignmentId, choice });
    const buildIds = comparison.assignments[taskId]?.trialIds ?? [];
    dispatch({
      type: "choose",
      taskId,
      choice,
      pairKey: pairKeyOf(buildIds, taskId),
      verdict: resolveVerdict(choice, buildIds),
    });
  }, [comparison.assignments]);

  /** Open a task's evidence without playing it — a mask, not a lock. */
  const revealWithoutPlaying = useCallback((taskId: string) => {
    dispatch({ type: "preview", taskId });
  }, []);

  return useMemo(
    () => ({ comparison, assignmentFor, battlesRemaining, nextBattle, saveChoice, revealWithoutPlaying }),
    [comparison, assignmentFor, battlesRemaining, nextBattle, saveChoice, revealWithoutPlaying],
  );
}
