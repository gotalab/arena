import type { CSSProperties } from "react";
import type { ConfigurationParts, OfficialMark } from "../lib/configurations";

/**
 * Harness · model (effort). When we have an official chip, the chip is the
 * harness: the word stays in the hover title and a visually-hidden name,
 * not beside the mark. Without a mark, the harness word stays. Model and
 * effort stay on one line.
 *
 * Mapping stays in `configurationParts`; this only paints what that helper
 * already decided.
 */
export function ConfigurationName({ parts, stacked = false }: { parts: ConfigurationParts; stacked?: boolean }) {
  // Stacked: for narrow column heads — chip, model and effort centred on
  // their own lines instead of one cramped run of text.
  if (stacked) {
    return (
      <span className="cfg-name cfg-name--stacked" title={parts.name}>
        <span className="cfg-name__part">
          <MarkChip mark={parts.harnessMark} />
          {parts.harnessMark ? (
            <span className="visually-hidden">{parts.harness}</span>
          ) : (
            parts.harness
          )}
        </span>
        <span className="cfg-name__model">{parts.model}</span>
        {parts.effort ? <span className="cfg-name__effort">{parts.effort}</span> : null}
      </span>
    );
  }
  return (
    <span className="cfg-name" title={parts.name}>
      <span className="cfg-name__part">
        <MarkChip mark={parts.harnessMark} />
        {parts.harnessMark ? (
          <span className="visually-hidden">{parts.harness}</span>
        ) : (
          parts.harness
        )}
      </span>
      <span className="cfg-name__dot">·</span>
      <span className="cfg-name__part">
        {parts.model}{parts.effort ? ` (${parts.effort})` : null}
      </span>
    </span>
  );
}

/** Official 24×24 harness chip. Null when we have no official file. */
export function MarkChip({ mark }: { mark: OfficialMark | null }) {
  if (!mark) return null;
  const style = {
    "--cfg-mark-scale": String(mark.opticalScale),
    "--cfg-mark-src": `url("${mark.src}")`,
    "--cfg-mark-src-dark": `url("${mark.srcOnDark}")`,
  } as CSSProperties;
  return (
    <span aria-hidden="true" className="cfg-mark" data-mark={mark.id} style={style}>
      <span className="cfg-mark__art cfg-mark__light">
        <img alt="" src={mark.src} />
      </span>
      <span className="cfg-mark__art cfg-mark__dark">
        <img alt="" src={mark.srcOnDark} />
      </span>
    </span>
  );
}
