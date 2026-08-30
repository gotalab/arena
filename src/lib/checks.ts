/**
 * Evaluator check semantics: how one outcome is spoken, how a game's checks are
 * grouped for reading, and the paired comparison the checks table renders.
 */

import type { PublicCheck as Check, PublicRelease as Release } from "../public-types";
import { humanize, checkLabel } from "./format";
import { configurationParts, configurationsById, type ConfigurationParts } from "./configurations";
import { buildsByIds, buildsForTask } from "./trials";

export interface CheckOutcomeView {
  outcome: string;
  label: string;
  tone: string;
}

interface CheckRow {
  id: string;
  label: string;
  description: null;
  category: string;
  lane: string | null;
  group: string | null;
  cells: Array<CheckOutcomeView & { detail: string | null }>;
}

export interface CheckComparison {
  builds: Array<{ trialId: string; configurationId: string; name: string; parts: ConfigurationParts }>;
  groups: Array<{ key: string; label: string; rows: CheckRow[] }>;
  total: number;
}

/**
 * How one evaluator outcome is spoken. A check is scope first, status second:
 * "fail" is named plainly as something this run did not demonstrate, never as a
 * bare FAIL, and an unevaluated check stays unevaluated rather than becoming a
 * silent zero (see web/AGENTS.md).
 */
const CHECK_OUTCOMES: Record<string, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "pass" },
  fail: { label: "Fail", tone: "fail" },
  not_evaluated: { label: "Not evaluated", tone: "unknown" },
  grader_error: { label: "Grader error", tone: "unknown" },
};

/** The display form of one check outcome. */
export function checkOutcome(outcome: string | null | undefined): CheckOutcomeView {
  const known = outcome ? CHECK_OUTCOMES[outcome] : null;
  return {
    outcome: outcome ?? "missing",
    label: known?.label ?? (outcome ? humanize(outcome) : "Not reported"),
    tone: known?.tone ?? "unknown",
  };
}

/** Gates come before requirements; within a group, release order is kept. */

const CHECK_CATEGORY_LABELS: Record<string, string> = {
  gate: "Blocking checks",
  requirement: "Game requirements",
};

/**
 * Ordered group keys for a set of check rows, plus the lookup that assigns one.
 *
 * v0.3 rubrics carry a `group` field natively (the section of the game's brief
 * a check belongs to), so grouping is read straight off the rows in first-
 * appearance order. A row without a group falls back to its machine category,
 * so a new check is never silently dropped.
 */
function checkGrouping(rows: CheckRow[]): {
  order: Array<{ key: string; label: string }>;
  keyOf: (row: CheckRow) => string;
} {
  const keyOf = (row: CheckRow) => row.group ?? CHECK_CATEGORY_LABELS[row.category] ?? humanize(row.category);
  const order: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    order.push({ key, label: key });
  }
  return { order, keyOf };
}

/**
 * Every evaluator check of one task, paired across that task's runs.
 *
 * The pairing key is the check id, so the same check always sits on one row
 * even if two runs report their checks in different orders or one run is
 * missing a check entirely (that cell reads "Not reported" rather than being
 * assumed to have passed). Gates come first because a gate explains the scope
 * of everything under it.
 *
 * Rows are grouped by the rubric's native `group` field, so the table can be
 * read category-first and only then check-by-check.
 *
 * `trialIds` lists runs in the reader's side order; defaults to release order.
 * Builds are identified by their configuration, never by a side letter: the
 * letters are blind-flow vocabulary and this table is only ever read after the
 * reveal.
 */
export function checkComparison(release: Release, taskId: string, trialIds: string[] | undefined): CheckComparison {
  const trials = Array.isArray(trialIds) && trialIds.length > 0
    ? buildsByIds(release, trialIds)
    : buildsForTask(release, taskId);
  const configurations = configurationsById(release);
  const parts = trials.map((trial) => configurationParts(configurations.get(trial.configurationId)));
  const builds = trials.map((trial, index) => ({
    trialId: trial.id,
    configurationId: trial.configurationId,
    parts: parts[index],
    // The one display name (`lib/configurations.ts`): harness, model, effort.
    // Two runs can share a model and differ only by harness, so no view
    // shortens the name on its own.
    name: parts[index].name,
  }));

  const byTrial = trials.map((trial) => new Map((trial.checks ?? []).map((check) => [check.id, check])));
  const order: Check[] = [];
  const seen = new Set<string>();
  for (const trial of trials) {
    for (const check of trial.checks ?? []) {
      if (seen.has(check.id)) continue;
      seen.add(check.id);
      order.push(check);
    }
  }

  const rows: CheckRow[] = order.map((reference) => ({
    id: reference.id,
    label: checkLabel(reference),
    description: null,
    category: reference.category ?? "requirement",
    lane: reference.lane ?? null,
    group: reference.group ?? null,
    cells: byTrial.map((checks) => {
      const check = checks.get(reference.id);
      const outcome = checkOutcome(check?.outcome);
      return {
        ...outcome,
        detail: check?.explanation ?? null,
      };
    }),
  }));

  const grouping = checkGrouping(rows);
  const assigned = rows.map((row) => ({ row, key: grouping.keyOf(row) }));
  const keys = grouping.order.slice();
  for (const { key } of assigned) {
    if (!keys.some((entry) => entry.key === key)) keys.push({ key, label: key });
  }

  const groups = keys
    .map(({ key, label }) => {
      const groupRows = assigned.filter((entry) => entry.key === key).map((entry) => entry.row);
      return { key, label, rows: groupRows };
    })
    .filter((group) => group.rows.length > 0);

  return { builds, groups, total: rows.length };
}
