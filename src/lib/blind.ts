/**
 * The blind comparison's own vocabulary and selectors.
 *
 * Side letters belong to the **blind flow only** (the Play stage's switcher and
 * the reveal panel). After the reveal a letter names nothing a reader can use,
 * so the Benchmark surface identifies a run by its configuration instead.
 */

import type { ComparisonState } from "../client-types";
import type { PublicBuild, PublicRelease } from "../public-types";
import { configurationParts, configurationsById } from "./configurations";

/** Has the reader settled at least one battle of this task? Vote keys are
 * pair keys built from trial ids, and every trial id starts with its task. */
export function hasBlindVerdict(comparison: Partial<ComparisonState> | null | undefined, taskId: string): boolean {
  return Object.keys(comparison?.votes ?? {}).some((key) => key.startsWith(`${taskId}--`));
}

/** Side letters for a task's runs, in the reader's randomized order. */
const SIDE_LETTERS = "ABCDEFGH";

export interface RevealLines {
  kicker: string;
  headline: string;
  subject: string | null;
}

/** The letter a run is shown under in the reader's randomized side order. */
export function sideLabel(index: number): string {
  return SIDE_LETTERS[index] ?? String(index + 1);
}

/**
 * The side a blind choice refers to, or null when the answer expresses no
 * preference (a tie, or both broken).
 */
export function sideIndex(choice: string | null | undefined): number | null {
  const index = typeof choice === "string" ? SIDE_LETTERS.indexOf(choice) : -1;
  return index < 0 ? null : index;
}

/**
 * The trial the reader picked blind for a task, if any (as a trial id).
 * The letters refer to the randomized side order recorded in the assignment;
 * a tie or a both-broken answer expresses no preference.
 */
export function preferredTrialId(comparison: Partial<ComparisonState> | null | undefined, taskId: string): string | null {
  const choice = comparison?.choices?.[taskId];
  const trialIds = comparison?.assignments?.[taskId]?.trialIds;
  const side = sideIndex(choice);
  if (side == null || !Array.isArray(trialIds)) return null;
  return trialIds[side] ?? null;
}

/**
 * Has this task's detail been unlocked — by playing it blind, or by the
 * reader explicitly asking to see it without playing?
 */
export function isTaskOpen(comparison: Partial<ComparisonState> | null | undefined, taskId: string): boolean {
  return Boolean(comparison?.choices?.[taskId] || comparison?.previews?.[taskId] || hasBlindVerdict(comparison, taskId));
}

/**
 * The reveal's next game: the next published game in list order after the
 * current one, wrapping once, skipping already-judged games and the current
 * game. Null when none remain — never "first unjudged in the array".
 */
export function nextUnjudgedGame<T extends { id: string }>(
  games: readonly T[],
  currentId: string,
  judged: Readonly<Record<string, unknown>> | null | undefined,
): T | null {
  const start = games.findIndex((game) => game.id === currentId);
  if (start < 0) return null;
  for (let step = 1; step < games.length; step += 1) {
    const game = games[(start + step) % games.length];
    if (game.id !== currentId && !judged?.[game.id]) return game;
  }
  return null;
}

/**
 * Reveal headline copy after a blind choice: what the reader said, then who
 * made it. The A→0 / B→1 mapping lives in `sideIndex`, not here.
 * `trials` are in the reader's side order.
 */
export function revealLines(choice: string, trials: PublicBuild[], release: PublicRelease): RevealLines {
  const side = sideIndex(choice);
  if (side == null) {
    return {
      kicker: choice === "TIE" ? "You called it a tie" : "You called both broken",
      headline: "Here's who made each build",
      subject: null,
    };
  }
  const trial = trials[side];
  const configuration = trial ? configurationsById(release).get(trial.configurationId) : null;
  const parts = configurationParts(configuration ?? undefined);
  return {
    kicker: `You picked ${sideLabel(side)} · made by`,
    // The one display name split at its own separator: the harness is the
    // answer to "who made it" and takes the headline, the model and its effort
    // follow on the line under it. Same order as everywhere else, no second
    // vocabulary — see `lib/configurations.ts`.
    headline: parts.harness,
    subject: configuration ? (parts.effort ? `${parts.model} (${parts.effort})` : parts.model) : null,
  };
}
