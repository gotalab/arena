/**
 * One sealed run, in display-ready form: its verdict, its operational totals,
 * its provider token categories and its provenance.
 *
 * Honesty rule (the evaluator's rule, kept at the last hop): a requirement rate
 * exists only when every applicable requirement was actually evaluated. A
 * partially evaluated run has no percentage — it reports the counts it has and
 * says the share is not reported. Unknown stays unknown.
 *
 * Vocabulary rule (see web/AGENTS.md): a trial is described with exactly three
 * terms — "Ran", "Playable", "Requirements met". "Checks" belongs to expandable
 * detail only.
 */

import { artifactUrl } from "../platform/env";
import type { PublicBuild, PublicCheck, PublicPlayableBuild, PublicPlayableRelease, PublicRelease } from "../public-types";
import {
  checkLabel,
  formatCost,
  formatRate,
  formatSeconds,
  formatTokens,
  humanize,
} from "./format";

interface RequirementBlock {
  passed: number;
  applicable: number;
  evaluated: number;
  notEvaluated: number;
  complete: boolean;
  rate: number | null;
  missing: PublicCheck[];
}

export interface TrialSummary {
  id: string;
  taskId: string;
  configurationId: string;
  ran: string;
  playable: string;
  requirements: {
    passed: number;
    applicable: number;
    evaluated: number;
    notEvaluated: number;
    complete: boolean;
    rate: number | null;
    label: string;
    rateLabel: string;
    qualifier: string;
  };
  missing: Array<{ id?: string; label: string; description?: string }>;
  checks: PublicCheck[];
  metrics: { seconds: string; tokens: string; estimatedCost: string; billedCost: string };
  raw: {
    seconds: number | null;
    tokens: number | null;
    estimatedCost: number | null;
    /** Where the dollar figure comes from: the provider CLI's own estimate, or
     * a view-time computation from sealed token counts at public API list
     * prices. Null when there is no figure. */
    costBasis: "provider" | "list-price" | null;
    playability: string | null;
  };
}

function requirementChecks(trial: PublicBuild): PublicCheck[] {
  return (trial.checks ?? []).filter((check) => check.category === "requirement");
}

/**
 * Requirements as evidence rather than as a score.
 *
 * `rate` is passed over ALL applicable requirements. The rubric is declared
 * before the run, so a requirement the verifier could not observe (a mechanic
 * the build never exhibited during driven play) counts against the share like
 * any other unmet requirement — otherwise not implementing a mechanic would
 * beat implementing it badly. The not-observed count is still disclosed
 * separately so a reader can tell unmet-by-absence from failed-by-behaviour.
 */
function requirementBlock(trial: PublicBuild): RequirementBlock {
  const checks = requirementChecks(trial);
  const summary = trial.requirementSummary;
  const missing = checks.filter((check) => check.outcome === "fail");
  if (summary?.passed != null && summary?.applicable != null) {
    const notEvaluated = (summary.notEvaluated ?? 0) + (summary.graderErrors ?? 0);
    const evaluated = summary.evaluated ?? summary.applicable - notEvaluated;
    return {
      passed: summary.passed,
      applicable: summary.applicable,
      evaluated,
      notEvaluated,
      complete: notEvaluated === 0 && evaluated === summary.applicable,
      rate: summary.applicable > 0 ? summary.passed / summary.applicable : null,
      missing,
    };
  }
  const passed = checks.filter((check) => check.outcome === "pass").length;
  const notEvaluated = checks.filter((check) => check.outcome !== "pass" && check.outcome !== "fail").length;
  const evaluated = checks.length - notEvaluated;
  return {
    passed,
    applicable: checks.length,
    evaluated,
    notEvaluated,
    complete: notEvaluated === 0,
    rate: checks.length > 0 ? passed / checks.length : null,
    missing,
  };
}

/** The one sentence that explains a partial share, or "" when nothing is missing. */
function requirementQualifier(block: RequirementBlock): string {
  if (block.complete) return "";
  if (block.notEvaluated > 0) {
    return `${block.notEvaluated} of ${block.applicable} requirements never became observable in this build and count as unmet. The rubric is fixed before the run.`;
  }
  return "Some requirements were not evaluated and count as unmet.";
}

/**
 * The sealed playability outcome on a trial record.
 *
 * Same field the trial card publishes as "Playable": a gate derivation
 * written at view generation (`generate-view.mjs` `playability`), not a
 * second judgment. Null when the record has no outcome.
 */
export function trialPlayability(trial: Pick<PublicPlayableBuild, "playability">): string | null {
  return trial.playability;
}

/**
 * Can this replica be judged on the stage?
 *
 * This is the data-side of the same claim the live room already uses:
 * a side that did not load cannot be judged (`paneIsPlayable` /
 * "Play both before judging"). The sealed record marks that claim as
 * `playability === "playable"` when the blocking gates passed. Weak
 * playable replicas stay; unknown and not-playable do not become a
 * pair opponent.
 */
export function trialIsPlayable(trial: Pick<PublicPlayableBuild, "playability">): boolean {
  return trialPlayability(trial) === "playable";
}

/** The published runs of one task that can actually be judged. */
export function playableTrialsForTask(release: PublicPlayableRelease, taskId: string): PublicPlayableBuild[] {
  return trialsForTask(release, taskId).filter(trialIsPlayable);
}

/** Everything one trial card needs, in display-ready form. */
export function trialSummary(trial: PublicBuild): TrialSummary {
  const requirements = requirementBlock(trial);
  const playability = trialPlayability(trial);
  return {
    id: trial.id,
    taskId: trial.taskId,
    configurationId: trial.configurationId,
    ran: trial.runResult ? humanize(trial.runResult) : (trial.status === "succeeded" ? "Finished" : humanize(trial.status)),
    playable: playability ? humanize(playability) : "Not evaluated",
    requirements: {
      passed: requirements.passed,
      applicable: requirements.applicable,
      evaluated: requirements.evaluated,
      notEvaluated: requirements.notEvaluated,
      complete: requirements.complete,
      rate: requirements.rate,
      label: `${requirements.passed} / ${requirements.applicable}`,
      rateLabel: formatRate(requirements.rate),
      qualifier: requirementQualifier(requirements),
    },
    missing: requirements.missing.map((check) => ({
      id: check.id,
      label: checkLabel(check),
      description: check.description,
    })),
    checks: trial.checks ?? [],
    metrics: {
      seconds: formatSeconds(trial.wallClockSeconds),
      tokens: formatTokens(trial.totalReportedTokens),
      estimatedCost: formatCost(trial.estimatedApiCost?.amount),
      billedCost: formatCost(trial.actualBilledCost?.amount),
    },
    raw: {
      seconds: trial.wallClockSeconds ?? null,
      tokens: trial.totalReportedTokens ?? null,
      estimatedCost: trial.estimatedApiCost?.amount ?? null,
      costBasis: trial.estimatedApiCost?.amount == null
        ? null
        : trial.meterSources?.cost?.startsWith("computed from sealed token usage")
          ? "list-price"
          : "provider",
      playability: playability ?? null,
    },
  };
}

/**
 * Where one run's sealed artifact is served from. The origin rules live in
 * `platform/env.ts`; a component asks for a trial, never for a URL scheme.
 */
export function artifactSrc(trial: PublicPlayableBuild): string {
  return artifactUrl(trial.artifact.sha256);
}

/** How many runs this release holds for the given tasks. */
export function runCountFor(release: PublicPlayableRelease, tasks: Array<{ id: string }>): number {
  const taskIds = new Set(tasks.map((task) => task.id));
  return release.builds.filter((trial) => taskIds.has(trial.taskId)).length;
}

/** The runs a release holds for one task, in release order. */
export function trialsForTask(release: PublicPlayableRelease, taskId: string): PublicPlayableBuild[] {
  return release.builds.filter((trial) => trial.taskId === taskId);
}

/** Named public builds for evidence surfaces. */
export function buildsForTask(release: PublicRelease, taskId: string): PublicBuild[] {
  return release.builds.filter((build) => build.taskId === taskId);
}

/**
 * Whether a task can open the blind stage: two playable published builds
 * make a pair. Unplayable replicas are not opponents. There is no
 * operator-declared matchup — every unordered pair of playable builds is a
 * battle and the reader's session samples them at random, so readiness is
 * derived from the data. A game with fewer than two playable replicas
 * keeps the stage closed (empty / no pair) without gating any other task.
 */
export function blindReadyForTask(release: PublicPlayableRelease, taskId: string): boolean {
  return playableTrialsForTask(release, taskId).length >= 2;
}

/** Resolve trial ids against the release, in the order given. */
export function trialsByIds(release: PublicPlayableRelease, ids: string[] | undefined): PublicPlayableBuild[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => release.builds.find((trial) => trial.id === id))
    .filter((trial): trial is PublicPlayableBuild => Boolean(trial));
}

/** Resolve opaque public build ids for named evidence surfaces. */
export function buildsByIds(release: PublicRelease, ids: string[] | undefined): PublicBuild[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => release.builds.find((build) => build.id === id))
    .filter((build): build is PublicBuild => Boolean(build));
}
