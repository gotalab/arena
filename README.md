# Playable Arena

Playable Arena shows what different coding agents create from the same game
brief. Browse the results, open the actual builds, compare two versions without
seeing who made them, and play them in the browser.

WebMCP gives agents a structured way to explore the same Arena. An agent can
find tasks and builds, compare evidence, and use game controls when the active
build exposes a trusted Agent Play contract.

**[Open Playable Arena](https://arena.gotalab.dev)**

## What you can do

- **Explore** — see the games, builds, scores, checks, and run evidence in the
  published benchmark.
- **Compare** — open an anonymous pair made from the same brief, try both, then
  reveal who made them.
- **Play** — interact with the real generated games in isolated frames.
- **Use an agent** — let an agent search Arena through WebMCP instead of
  guessing its way through the visual interface.

## Try it with WebMCP

Open the live app in ChatGPT's in-app browser. You can ask things like:

- “What tasks are available, and which ones offer Agent Play?”
- “Show me the builds for EMBER.”
- “Compare these two builds and open the stronger evidence.”
- “Open an anonymous comparison for me to play.”

The tools follow the page you are on:

- Home and Play expose task discovery.
- Benchmark and named task pages expose build search, opening, and comparison.
- Blind comparison hides builder identity until reveal.
- Game controls appear only after the active frame completes the trusted
  `arena.game.v1` handshake.

Agent Play support is reported honestly at two levels. A task says whether it
requires an Agent Play contract; each build separately reports whether that
contract passed, failed, was not evaluated, or did not apply.

## How Arena works

```text
one game brief
      ↓
multiple coding-agent configurations
      ↓
playable builds + evaluation evidence
      ↓
benchmark exploration, blind comparison, and WebMCP tools
```

The published games run inside opaque-origin frames with
`sandbox="allow-scripts"`. Arena owns the surrounding interface and WebMCP tool
descriptions, while a session-bound channel carries validated game commands to
the active frame.

## Run it locally

Install the exact reviewed dependency set without lifecycle scripts:

```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run typecheck
pnpm run build
```

Start the complete runtime, including the Main and Artifact origins and a fresh
local D1 database:

```bash
pnpm run dev:runtime
```

Open `http://127.0.0.1:8787`. Artifact content runs separately on port 8788.
The command loads the sanitized public fixture, creates fresh local secrets,
and removes its temporary state when it stops. It needs no Cloudflare account
or production credentials.

Run the bounded HTTP, D1, and lifecycle smoke with:

```bash
pnpm run dev:runtime --smoke
```

For UI-only work, a static preview is also available:

```bash
pnpm run dev --host 0.0.0.0
```

## Build the runtime

From a clean committed checkout:

```bash
pnpm run build:product-runtime --output /tmp/arena-product-runtime
```

The output contains the Main and Artifact Worker bundles, Web assets, the
content-addressed WebMCP probe, a runtime input manifest, and a build receipt.
The build verifies the public data and every published Artifact before it
produces the runtime.

## What's in this repository

- `src/` — the Arena interface and route-scoped WebMCP tools
- `runtime/` — Main and Artifact Workers plus the minimal runtime D1 schema
- `public-release/accepted/` — the sanitized, content-addressed public release
- `public-contract/` — the public bundle, Agent Play, and build receipt contracts
- `test/` — product, runtime, WebMCP, privacy, and release-boundary tests

This repository contains everything needed to run the published Arena
experience. Task authoring, private rubrics, raw evaluation runs, credentials,
and production release records are not part of the public product.

## Project history

Arena existed before the WebMCP Challenge. The work added for the challenge and
the pre-existing product boundary are described in [HACKATHON.md](./HACKATHON.md).

## License

Arena-owned source and assets are available under the [MIT License](./LICENSE).
Official vendor marks and other third-party materials remain under their
owners' terms; see [Third-party notices](./THIRD_PARTY_NOTICES.md) and the
[public license manifest](./public-license-manifest.v1.json).
