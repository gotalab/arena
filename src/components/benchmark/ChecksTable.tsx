import { Fragment, useState } from "react";
import { checkOutcome } from "../../lib/checks";
import type { TaskCheckComparison } from "../../lib/task-comparison";
import { ConfigurationName } from "../ConfigurationName";

/** One glyph per outcome. The word stays for screen readers and tooltips. */
const GLYPHS: Record<string, string> = {
  pass: "✓",
  fail: "✕",
};

interface ChecksTableProps {
  model: TaskCheckComparison;
  taskName: string;
}

/**
 * Every evaluator check of one game, one column per build, in the marks-only
 * grammar benchmark matrices use: a cell is ✓, ✕ or — and nothing else.
 * A sanitized result explanation is one click away — a row expands to show it —
 * instead of being printed into the grid, which buried the pattern the table
 * exists to show.
 */
export function ChecksTable({ model, taskName }: ChecksTableProps) {
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  if (model.totalBeforeFilters === 0) return null;

  const toggle = (id: string) => {
    setOpenRows((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const columns = 2 + model.builds.length;

  return (
    <details className="checks">
      <summary>
        <span className="checks__title">Evaluator checks, side by side</span>
        <span className="checks__hint">{model.total} of {model.totalBeforeFilters} checks</span>
      </summary>
      <p className="checks__legend" aria-hidden="true">
        <span className="checks__cell--pass">✓ pass</span>
        <span className="checks__cell--fail">✕ fail</span>
        <span className="checks__cell--unknown">— not observed</span>
        <span>Select a check to read the published result note.</span>
      </p>
      {model.total === 0 ? (
        <p className="checks__empty">No evaluator checks match these filters.</p>
      ) : null}
      <div className="checks__stack">
        {model.groups.map((group) => (
          <section className="checks__stackGroup" key={group.key}>
            <h3>{group.label}</h3>
            {group.rows.map((row) => (
              <details className="checks__stackItem" key={row.id}>
                <summary>
                  <span className="checks__stackName">{row.label}</span>
                  <span className="checks__stackMarks" aria-hidden="true">
                    {row.cells.map((cell, index) => {
                      const view = checkOutcome(cell.outcome);
                      return (
                      <span className={`checks__cell--${view.tone}`} key={model.builds[index].id}>
                        {GLYPHS[cell.outcome] ?? "—"}
                      </span>
                      );
                    })}
                  </span>
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
            ))}
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
                      <tr className={row.differences ? "is-different" : undefined}>
                        {categoryCell}
                        <th scope="row">
                          <button
                            aria-expanded={open}
                            className="checks__expand"
                            onClick={() => toggle(row.id)}
                            title={row.id}
                            type="button"
                          >
                            <span aria-hidden="true" className="checks__chevron">{open ? "▾" : "▸"}</span>
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
                            <span aria-hidden="true">{GLYPHS[cell.outcome] ?? "—"}</span>
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
