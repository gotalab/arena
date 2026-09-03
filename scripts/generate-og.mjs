#!/usr/bin/env node
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "assets", "og", "default.png");
const agentPlay = `data:image/png;base64,${readFileSync(join(root, "docs", "images", "agent-play.png")).toString("base64")}`;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="capture"><rect x="640" y="0" width="560" height="630"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#f5f2ed"/>
  <g clip-path="url(#capture)">
    <image href="${agentPlay}" x="-45" y="-70" width="1245" height="700" preserveAspectRatio="none"/>
    <rect x="640" y="0" width="560" height="630" fill="#000" fill-opacity="0.08"/>
  </g>
  <rect x="636" y="0" width="4" height="630" fill="#e64c30"/>

  <g transform="translate(152 58) scale(4.4)" fill="#e64c30">
    <path d="M1 1h14v2H1zm0 12h14v2H1zM1 3h2v10H1zm12 0h2v10h-2zM5 9h4v4H5z"/>
  </g>
  <text x="238" y="116" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="740">Playable Arena</text>

  <text x="152" y="236" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="780">Know what to</text>
  <text x="152" y="310" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="780">change next.</text>
  <text x="152" y="382" fill="#5f5c57" font-family="Inter, Arial, sans-serif" font-size="26">The agent reads the evidence</text>
  <text x="152" y="418" fill="#5f5c57" font-family="Inter, Arial, sans-serif" font-size="26">and plays the builds. You choose by feel.</text>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" font-weight="650" fill="#5f5c57">
    <text x="152" y="554">BENCHMARK  →  AGENT PLAY  →  HUMAN CHOICE  →  NEXT RUN</text>
  </g>

  <rect x="672" y="38" width="222" height="42" rx="8" fill="#11110f" fill-opacity="0.92"/>
  <circle cx="695" cy="59" r="5" fill="#e64c30"/>
  <text x="711" y="66" fill="#fffdf9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" font-weight="700">LIVE AGENT PLAY</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: { loadSystemFonts: true },
}).render().asPng();

if (process.argv.includes("--check")) {
  if (!readFileSync(output).equals(png)) throw new Error("og_preview:stale");
  console.log("Verified Arena-owned OG preview.");
} else {
  writeFileSync(output, png);
  console.log(`Wrote ${output}`);
}
