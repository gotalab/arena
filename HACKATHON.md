# WebMCP Challenge work

Arena existed before the WebMCP Challenge as a private benchmark that gave multiple coding-agent configurations the same game brief, measured their builds, and let people compare playable results blind. The submitted public repository is a clean product export rather than a rewrite of that private history.

Work added during the August 25–September 3, 2026 submission period includes the clean public/evaluation repository boundary, route-scoped WebMCP exploration tools, the isolated `arena.game.v1` broker and probe, Agent Play capability evidence, an Agent-selected anonymous human review that reveals identities only after a UI choice, public schemas and leak scanners, and the complete public Worker/D1 runtime. The clean export and all subsequent commits together carry this challenge delta relative to the attested private baseline.

The private baseline identifiers below prove the cutoff without publishing the private tree. Its timestamp is August 25 at 3:42 a.m. Pacific, before the August 25 at 11:00 a.m. Pacific submission start. Before publication, the product history was consolidated to remove production identifiers. Inspect the clean export with `git show 646f9164` and its subsequent attestations with `git log 646f9164..HEAD`.

<!-- arena.hackathon.v1:start -->
```json
{
  "schema": "arena.hackathon.v1",
  "submissionPeriodStart": "2026-08-25T11:00:00-07:00",
  "preExistingBaseline": {
    "commit": "c0e9be3ecca5f4918579ae23d13af792af3dfe16",
    "gitTree": "76e94fae23a7df20e6e50e7d3ef327eb276a4074",
    "committedAt": "2026-08-25T19:42:49+09:00",
    "pathSetSha256": "f284da34cb306002c6fecfbe778c8dfaff1ebd427f79bb3d866b4b87de6b45b1",
    "attestationSha256": "7f6abca3f3abb64289aed5b973cc256c27ff154742bd72a751e99125e5bbf5a7"
  },
  "publicHistory": {
    "initialExportCommit": "646f9164405f9001266cc77e1a633404d7c89f09",
    "challengeRange": "646f9164405f9001266cc77e1a633404d7c89f09..HEAD"
  },
  "preExistingCapabilities": [
    "multi-configuration game benchmark",
    "deterministic and visual evaluation",
    "human blind play and reveal",
    "published task and build catalogue"
  ],
  "challengePaths": [
    { "path": "src/lib/arena-tools.ts", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "src/lib/game-tools.ts", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "src/platform/frame-game-channel.ts", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "src/hooks/useArenaWebMcpTools.ts", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "src/hooks/useWebMcpGameTools.ts", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "public-contract/arena.public-release.v1.schema.json", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "public-contract/validate-public-release.mjs", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" },
    { "path": "public/__webmcp_probe/index.html", "preExisting": false, "firstPublicCommit": "646f9164405f9001266cc77e1a633404d7c89f09" }
  ]
}
```
<!-- arena.hackathon.v1:end -->

The evaluation pipeline, execution harness, private briefs and rubrics, controls, raw Trials and logs, production database history, credentials, and deployment receipts are intentionally not part of the submitted project or its public history.

## Trademark note for the demo

The challenge rules separately restrict third-party trademarks in the public demo video. Repository notices do not grant video permission. Record the demo with Arena-owned visuals and text-only configuration names unless the relevant owner has authorized use of a mark.
