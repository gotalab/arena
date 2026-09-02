import { Fragment, useEffect, useState } from "react";
import { checkOutcome } from "../../lib/checks";
import type { TaskCheckComparison } from "../../lib/task-comparison";
import { ArenaIcon } from "../ArenaIcon";
import { ConfigurationName } from "../ConfigurationName";

/** One glyph per outcome. The word stays for screen readers and tooltips. */
const GLYPHS: Record<string, string> = {
  pass: "✓",
  fail: "✕",
  not_evaluated: "?",
  grader_error: "?",
};

interface ChecksTableProps {
  focusedCheckIds?: readonly string[];
  model: TaskCheckComparison;
  open?: boolean;
  taskName: string;
}

function outcomeCounts(cells: readonly { outcome: string }[]) {
  return cells.reduce((counts, cell) => {
    if (cell.outcome === "pass") counts.pass += 1;
    else if (cell.outcome === "fail") counts.fail += 1;
    else counts.unknown += 1;
    return counts;
  }, { pass: 0, fail: 0, unknown: 0 });
}

/**
 * Every evaluator check of one game, one column per build, in the marks-only
 * grammar benchmark matrices use: a cell is ✓, ✕ or — and nothing else.
 * A sanitized result explanation is one click away — a row expands to show it —
 * instead of being printed into the grid, which buried the pattern the table
 * exists to show.
 */
export function ChecksTable({ focusedCheckIds = [], model, open = false, taskName }: ChecksTableProps) {
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  const focusedChecks = new Set(focusedCheckIds);
  const focusedKey = focusedCheckIds.join("\0");
  useEffect(() => {
    if (!focusedKey) return;
    setOpenRows((open) => new Set([...open, ...focusedKey.split("\0")]));
  }, [focusedKey]);
  if (model.totalBeforeFilters === 0) return null;

  const toggle = (id: string) => {
    setOpenRows((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const columns = 2 + model.builds.length;
  const differenceCount = model.groups.reduce(
    (total, group) => total + group.rows.filter((row) => row.differences).length,
    0,
  );

  return (
    <details className="checks" open={open || undefined}>
      <summary>
        <span className="checks__title">Evaluator checks, side by side</span>
        <span className="checks__hint">
          {model.total} of {model.totalBeforeFilters} checks
          {differenceCount > 0 ? ` · ${differenceCount} differ` : ""}
        </span>
      </summary>
      <p className="checks__legend" aria-hidden="true">
        <span className="checks__cell--pass">✓ pass</span>
        <span className="checks__cell--fail">✕ fail</span>
        <span className="checks__cell--unknown">? not observed</span>
        <span>Select a check to read the published result note.</span>
      </p>
      {model.total === 0 ? (
        <p className="checks__empty">No evaluator checks match these filters.</p>
      ) : null}
      <div className="checks__stack">
        {model.groups.map((group) => (
          <section className="checks__stackGroup" key={group.key}>
            <h3>{group.label}</h3>
            {group.rows.map((row) => {
              const counts = outcomeCounts(row.cells);
              return (
                <details
                  className={focusedChecks.has(row.id) ? "checks__stackItem is-webmcp-focus" : "checks__stackItem"}
                  data-check-id={row.id}
                  key={row.id}
                  open={focusedChecks.has(row.id) || undefined}
                >
                  <summary>
                    <span className="checks__stackName">{row.label}</span>
                    <span className="checks__stackMarks">
                      {counts.pass > 0 ? (
                        <span aria-label={`${counts.pass} pass`} className="checks__cell--pass">✓ {counts.pass}</span>
                      ) : null}
                      {counts.fail > 0 ? (
                        <span aria-label={`${counts.fail} fail`} className="checks__cell--fail">✕ {counts.fail}</span>
                      ) : null}
                      {counts.unknown > 0 ? (
                        <span aria-label={`${counts.unknown} not observed`} className="checks__cell--unknown">? {counts.unknown}</span>
                      ) : null}
                    </span>
                    <ArenaIcon className="checks__stackChevron" name="next" />
                  </summary>
                  <dl className="checks__stackEvidence">
                    <div>
                      <dt>Check</dt>
                      <dd><code>{row.id}</code></dd>
                    </div>
                    {row.cells.map((cell, index) => {
                      const view = checkOutcome(cell.outcome);
                      return (
                        <div key={model.builds[index].id}>
                          <dt>
                            <ConfigurationName parts={model.builds[index].parts} />
                          </dt>
                          <dd>
                            <span className={`checks__cell--${view.tone}`}>{view.label}</span>
                            {cell.explanation ? `: ${cell.explanation}` : ": no public explanation recorded"}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </details>
              );
            })}
          </section>
        ))}
      </div>
      <div className="checks__scroll checks__matrix" tabIndex={0} role="region" aria-label={`All evaluator checks for ${taskName}`}>
        <table className="checks__table">
          <caption className="visually-hidden">
            Every evaluator check for {taskName}, grouped by category, with the outcome of each agent
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Check</th>
              {model.builds.map((build) => (
                <th className="checks__outcomeHead" key={build.id} scope="col">
                  <ConfigurationName parts={build.parts} stacked />
                </th>
              ))}
            </tr>
          </thead>
          {model.groups.map((group) => {
            // Expanded evidence rows are extra <tr>s, so the category cell's
            // rowspan is counted against the rows actually rendered.
            const rendered = group.rows.length + group.rows.filter((row) => openRows.has(row.id)).length;
            let first = true;
            return (
              <tbody key={group.key}>
                {group.rows.map((row) => {
                  const open = openRows.has(row.id);
                  const categoryCell = first ? (
                    <th className="checks__category" scope="rowgroup" rowSpan={rendered}>
                      <span className="checks__categoryLabel">{group.label}</span>
                    </th>
                  ) : null;
                  first = false;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={[row.differences ? "is-different" : "", focusedChecks.has(row.id) ? "is-webmcp-focus" : ""].filter(Boolean).join(" ") || undefined}
                        data-check-id={row.id}
                      >
                        {categoryCell}
                        <th scope="row">
                          <button
                            aria-expanded={open}
                            className="checks__expand"
                            onClick={() => toggle(row.id)}
                            title={row.id}
                            type="button"
                          >
                            <ArenaIcon className={open ? "checks__chevron is-open" : "checks__chevron"} name="next" />
                            <span className="checks__label">{row.label}</span>
                            {row.lane === "judged" ? <span className="checks__lane">judged</span> : null}
                          </button>
                        </th>
                        {row.cells.map((cell, index) => {
                          const view = checkOutcome(cell.outcome);
                          return (
                          <td
                            className={`checks__cell checks__cell--${view.tone}`}
                            key={model.builds[index].id}
                            title={cell.explanation ? `${view.label}: ${cell.explanation}` : view.label}
                          >
                            <span aria-hidden="true">{GLYPHS[cell.outcome] ?? "?"}</span>
                            <span className="visually-hidden">{view.label}</span>
                          </td>
                          );
                        })}
                      </tr>
                      {open ? (
                        <tr className="checks__evidenceRow">
                          <td colSpan={columns - 1}>
                            <dl className="checks__evidence">
                              <div className="checks__evidenceMeta">
                                <dt>Check</dt>
                                <dd><code>{row.id}</code></dd>
                              </div>
                              {row.cells.map((cell, index) => {
                                const view = checkOutcome(cell.outcome);
                                return (
                                <div key={model.builds[index].id}>
                                  <dt>{model.builds[index].name}</dt>
                                  <dd>
                                    <span className={`checks__cell--${view.tone}`}>{view.label}</span>
                                    {cell.explanation ? `: ${cell.explanation}` : ": no public explanation recorded"}
                                  </dd>
                                </div>
                                );
                              })}
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </details>
  );
}
