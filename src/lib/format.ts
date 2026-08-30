/**
 * Display formatting for sealed release evidence. No React, no DOM, no state.
 *
 * Honesty rule (the evaluator's rule, kept at the last hop): a value that was
 * never reported reads "Not reported" and is never rounded into a number the
 * evidence does not support.
 */

export const NOT_REPORTED = "Not reported";

/** Turn a machine token such as `agent_error` into readable prose. */
export function humanize(value: string | null | undefined): string {
  if (!value) return NOT_REPORTED;
  const text = String(value).replaceAll("_", " ").replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatSeconds(value: number | null | undefined): string {
  if (value == null) return NOT_REPORTED;
  const total = Math.round(value);
  if (total < 90) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatTokens(value: number | null | undefined): string {
  return value == null ? NOT_REPORTED : Math.round(value).toLocaleString("en-US");
}

/** `value` is USD. */
export function formatCost(value: number | null | undefined): string {
  return value == null ? NOT_REPORTED : `$${value.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 6" from an ISO timestamp (UTC), for per-run dates in tables. */
export function formatRunDate(iso: string | null | undefined): string {
  if (!iso) return NOT_REPORTED;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_REPORTED;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Aug 6–15, 2026" (or "Aug 6, 2026" when one day) from ISO timestamps. */
export function formatRunDateRange(isos: Array<string | null | undefined>): string | null {
  const dates = isos
    .filter((iso): iso is string => typeof iso === "string")
    .map((iso) => new Date(iso))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const start = `${MONTHS[first.getUTCMonth()]} ${first.getUTCDate()}${sameYear ? "" : `, ${first.getUTCFullYear()}`}`;
  if (first.getUTCFullYear() === last.getUTCFullYear() && first.getUTCMonth() === last.getUTCMonth() && first.getUTCDate() === last.getUTCDate()) {
    return `${start}, ${first.getUTCFullYear()}`;
  }
  const end = first.getUTCMonth() === last.getUTCMonth() && first.getUTCFullYear() === last.getUTCFullYear()
    ? String(last.getUTCDate())
    : `${MONTHS[last.getUTCMonth()]} ${last.getUTCDate()}`;
  return `${start}–${end}, ${last.getUTCFullYear()}`;
}

/**
 * The one percent formatter. A null rate is a real answer — the share is not
 * reported — and never becomes a fabricated number. `rate` is 0..1.
 */
export function formatRate(rate: number | null | undefined): string {
  return rate == null ? NOT_REPORTED : `${Math.round(rate * 100)}%`;
}

/** The same value spoken aloud, for accessible descriptions. `rate` is 0..1. */
export function speakRate(rate: number | null | undefined): string {
  return rate == null ? "requirement share not reported" : `${Math.round(rate * 100)} percent`;
}

export function formatShortSha(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : NOT_REPORTED;
}

/**
 * Human label for an evaluator check. Evaluator IDs are never the default
 * explanation, so a missing label falls back to prose derived from the ID.
 *
 * It lives with the formatters rather than with the check semantics in
 * `checks.ts` so that `trials.ts`, which needs it for the missing-requirement
 * list, does not have to import the module that imports it back.
 */
export function checkLabel(check: { id?: string; label?: string } | string): string {
  if (typeof check === "string") return check;
  if (check?.label) return check.label;
  if (!check?.id) return "Unnamed requirement";
  return humanize(check.id.replace(/^[a-z0-9.-]*\./, ""));
}
