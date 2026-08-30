# Playable Arena

Playable Arena is a public product surface for exploring coding-agent game builds, playing them blind, and operating the site through route-scoped WebMCP tools.

This tree is intentionally one-way: it consumes the closed `arena.public-release.v1` bundle in `public-release/accepted/`. It contains no evaluator, task authoring source, raw run pool, reconstructed prompt, judge instruction, or private generator.

## Run locally

Install exactly the reviewed lockfile without lifecycle scripts:

```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run typecheck
pnpm run build
```

For the complete public runtime, including the real API, runtime-only D1, and
the separate Artifact origin:

```bash
pnpm run dev:runtime
```

Open `http://127.0.0.1:8787`. Main runs on port 8787 and Artifact on port 8788.
The command creates an isolated temporary D1 store and fresh per-run secrets,
loads the sanitized public fixture, verifies the content-addressed WebMCP probe,
and removes the temporary state when it stops. It needs no Cloudflare account or
credential. A bounded lifecycle and HTTP/D1 negative smoke is available as:

```bash
pnpm run dev:runtime --smoke
```

The static, embedded-Artifact preview remains available for UI-only work:

```bash
pnpm run dev --host 0.0.0.0
```

From a clean committed checkout, produce the credential-free release input:

```bash
pnpm run build:product-runtime --output /tmp/arena-product-runtime
```

The output contains the Main and Artifact ESM bundles, separate Web dist and
probe tree, a canonical runtime input manifest, and the closed v2 build receipt.

The public build verifies the bundle and every published Artifact before compiling. The Web app never invokes or reaches a private evaluation checkout.

## WebMCP surface

- Home and Play: `search_tasks`, including each task's Agent Play policy
- Named Benchmark/task views: `search_tasks`, `search_builds`, `open_build`,
  `compare_builds`, including Build-level Agent Play evidence status
- Blind before reveal: no identity-bearing exploration tools
- Fixed local protocol probe: `get_game_state`, `take_game_action`

Agent Play policy and Build evidence are separate facts. A task-owned manifest
marks the task `required`; no manifest means `not_offered`. Named Build evidence
is `not_applicable`, `not_evaluated`, `failed`, or `passed`. Older v1 fixtures
without the evidence field derive the first two states from manifest presence.
Only an active frame that completes the trusted manifest handshake receives
game tools; metadata alone never registers them.

Generated games remain opaque-origin `sandbox="allow-scripts"` frames. The trusted Arena parent owns tool descriptions and brokers game commands over a session- and generation-bound `MessageChannel`.

## License

Arena-owned source and assets are available under the [MIT License](./LICENSE).
Official vendor marks and other third-party materials remain under their
owners' terms; see [Third-party notices](./THIRD_PARTY_NOTICES.md) and the
checked [public license manifest](./public-license-manifest.v1.json).

The repository remains Private until the submission-readiness checkpoint.
Third-party marks in this repository are separately noticed and are not
automatically cleared for the challenge demo video; see [HACKATHON.md](./HACKATHON.md).
