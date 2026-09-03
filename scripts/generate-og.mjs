#!/usr/bin/env node
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "assets", "og", "default.png");
const evidence = `data:image/png;base64,${readFileSync(join(root, "docs", "images", "read-evidence.png")).toString("base64")}`;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><clipPath id="screen"><rect width="1200" height="492"/></clipPath></defs>
  <g clip-path="url(#screen)">
    <image href="${evidence}" x="0" y="0" width="1200" height="675" preserveAspectRatio="xMidYMid slice"/>
  </g>
  <rect y="492" width="1200" height="138" fill="#f5f2ed"/>
  <g transform="translate(54 522) scale(3.1)" fill="#e64c30">
    <path d="M1 1h14v2H1zm0 12h14v2H1zM1 3h2v10H1zm12 0h2v10h-2zM5 9h4v4H5z"/>
  </g>
  <text x="116" y="563" fill="#1b1b19" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="750">Playable Arena</text>
  <text x="1146" y="553" text-anchor="end" fill="#5f5c57" font-family="Inter, Arial, sans-serif" font-size="24">Turn benchmark evidence</text>
  <text x="1146" y="586" text-anchor="end" fill="#5f5c57" font-family="Inter, Arial, sans-serif" font-size="24">into the next agent run.</text>
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
