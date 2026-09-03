#!/usr/bin/env node
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "assets", "og", "default.png");
const overview = `data:image/png;base64,${readFileSync(join(root, "docs", "images", "overview-codex.png")).toString("base64")}`;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><clipPath id="arena"><rect x="400" width="800" height="630"/></clipPath></defs>
  <rect width="1200" height="630" fill="#151515"/>
  <g clip-path="url(#arena)">
    <image href="${overview}" x="97" y="0" width="1120" height="630" preserveAspectRatio="none"/>
  </g>
  <g font-family="Inter, Arial, sans-serif">
    <text x="150" y="118" fill="#a6a6a6" font-size="22" font-weight="650">CODEX</text>
    <text x="150" y="210" fill="#f7f7f7" font-size="27" font-weight="600">What should I</text>
    <text x="150" y="247" fill="#f7f7f7" font-size="27" font-weight="600">pay extra</text>
    <text x="150" y="284" fill="#f7f7f7" font-size="27" font-weight="600">attention to when</text>
    <text x="150" y="321" fill="#f7f7f7" font-size="27" font-weight="600">building a</text>
    <text x="150" y="358" fill="#f7f7f7" font-size="27" font-weight="600">replayable</text>
    <text x="150" y="395" fill="#f7f7f7" font-size="27" font-weight="600">strategy game?</text>
    <text x="150" y="514" fill="#8f8f8f" font-size="18" font-weight="650">WEBMCP</text>
  </g>
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
