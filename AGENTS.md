# AGENTS.md

- This repository is the publishable Arena product. Keep non-public evaluation,
  execution, credential, and release-authority material out of it.
- Use the pinned `pnpm@10.20.0` toolchain only. Do not add npm fallbacks or a
  `package-lock.json`; install with `--frozen-lockfile --ignore-scripts`.
- `public-release/accepted/` and `runtime/d1/{fixture.sql,manifest.json}` are one
  generated release projection. Update them through the eval-to-product publish
  workflow, never by hand or independently.
- Preserve Blind identity hiding, separate Main/Artifact origins, opaque
  `sandbox="allow-scripts"` frames, route-scoped WebMCP tools, and the trusted
  `arena.game.v1` handshake.
- Keep public docs factual: `README.md` describes behavior that works now, and
  `HACKATHON.md` records Challenge-period work after it ships. Do not present a
  private eval plan as a public product feature.
- Before completion run `pnpm test`, `pnpm run typecheck`, and `pnpm run build`.
  Runtime or Agent Play changes also require `pnpm run dev:runtime --smoke` and
  the product-runtime receipt/tamper checks.
