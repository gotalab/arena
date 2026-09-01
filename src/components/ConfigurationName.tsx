import type { ConfigurationParts } from "../lib/configurations";

/**
 * Harness · model (effort). Third-party identity stays accurate text rather
 * than becoming Arena's decoration. Model and effort stay on one line.
 *
 * Mapping stays in `configurationParts`; this only paints what that helper
 * already decided.
 */
export function ConfigurationName({ parts, stacked = false }: { parts: ConfigurationParts; stacked?: boolean }) {
  // Stacked: for narrow column heads, harness, model, and effort each get a
  // centered line instead of one cramped run of text.
  if (stacked) {
    return (
      <span className="cfg-name cfg-name--stacked" title={parts.name}>
        <span className="cfg-name__part">
          {parts.harness}
        </span>
        <span className="cfg-name__model">{parts.model}</span>
        {parts.effort ? <span className="cfg-name__effort">{parts.effort}</span> : null}
      </span>
    );
  }
  return (
    <span className="cfg-name" title={parts.name}>
      <span className="cfg-name__part">
        {parts.harness}
      </span>
      <span className="cfg-name__dot">·</span>
      <span className="cfg-name__part">
        {parts.model}{parts.effort ? ` (${parts.effort})` : null}
      </span>
    </span>
  );
}
