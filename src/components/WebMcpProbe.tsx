import { useState } from "react";
import probeContract from "../../public-contract/webmcp-probe.v1.json";
import { WEBMCP_PROBE_MANIFEST } from "../lib/game-tools";
import { artifactOrigin } from "../platform/env";
import { Stage } from "./Stage";

const useArtifactProbe = import.meta.env.VITE_WEBMCP_PROBE_ARTIFACT === "true";
const pane = {
  id: "webmcp-route-probe",
  src: useArtifactProbe
    ? `${artifactOrigin()}/artifacts/${probeContract.treeSha256}/index.html`
    : "/__webmcp_probe/index.html",
  title: "WebMCP route probe game",
  tabLabel: "Probe",
};

/** Explicit proof surface. It uses the same separate-origin Stage as shipped games. */
export function WebMcpProbe() {
  const [status, setStatus] = useState("loading");
  return (
    <section className="doc page" data-testid="webmcp-probe">
      <p className="eyebrow">WebMCP probe</p>
      <h1>Agent route check</h1>
      <p>Read the state, then complete Scan → Mark → Commit through the two registered game tools.</p>
      <p aria-live="polite">Frame: {status}</p>
      <Stage
        activeIndex={0}
        barLabel="Trusted parent → isolated game"
        gameToolsManifest={WEBMCP_PROBE_MANIFEST}
        onPaneStatus={(_id, next) => setStatus(next)}
        onSelect={() => {}}
        panes={[pane]}
      />
    </section>
  );
}
