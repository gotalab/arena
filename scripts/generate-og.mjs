#!/usr/bin/env node
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "assets", "og", "default.png");
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f5f2ed"/>
  <rect x="56" y="56" width="1088" height="518" rx="34" fill="#fffdf9" stroke="#d9d4cc" stroke-width="2"/>
  <g transform="translate(100 105) scale(6)" fill="#e64c30">
    <path d="M1 1h14v2H1zm0 12h14v2H1zM1 3h2v10H1zm12 0h2v10h-2zM5 9h4v4H5z"/>
  </g>
  <text x="220" y="168" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="54" font-weight="750">Playable Arena</text>
  <rect x="100" y="214" width="86" height="5" rx="2.5" fill="#e64c30"/>
  <text x="100" y="315" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="70" font-weight="760">Continue the benchmark.</text>
  <text x="100" y="384" fill="#5f5c57" font-family="Inter, Arial, sans-serif" font-size="31">Agents run the follow-up. People judge what remains.</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="650" fill="#5f5c57">
    <text x="100" y="500">EXPLORE</text>
    <text x="260" y="500">PLAY</text>
    <text x="370" y="500">COMPARE</text>
  </g>
  <circle cx="88" cy="493" r="5" fill="#e64c30"/>
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
