# What changed for the WebMCP Challenge

Arena existed before the challenge as a private playable benchmark. It already gave multiple coding-agent configurations the same game brief, evaluated the resulting builds, and let people compare two games blind.

During the August 25–September 3, 2026 submission period, I turned that benchmark into a public WebMCP product where a person and an agent can continue the evaluation together.

## Before the challenge

- Coding agents received the same game brief.
- Arena evaluated and published their playable results.
- A person could compare two builds blind and reveal their identities afterward.

## Added during the challenge

- **WebMCP benchmark exploration:** the agent can read detailed results and change the visible comparison on the page.
- **Agent Play:** the agent can open compatible games, read their live state, send validated actions, reject stale revisions, and complete a comparable run.
- **Agent-selected human review:** the agent can prepare two to four anonymous candidates, but it cannot choose or reveal them for the person.
- **Post-choice improvement loop:** after the human choice, the agent can combine the published evidence, Agent Play, and human preference into checks for the next agent run.
- **Public, reproducible delivery:** this repository adds the sanitized public data boundary, public schemas, leak scanners, tests, and the Cloudflare Worker/D1 runtime.

## The new end-to-end flow

1. The person describes what matters for their use case.
2. The agent selects the relevant benchmark evidence.
3. The agent plays the shortlisted builds under comparable conditions.
4. The person plays the same builds anonymously and chooses by feel.
5. The result becomes review stages and acceptance checks for the next coding-agent run.

<details>
<summary><strong>Technical cutoff and commit evidence</strong></summary>

The private baseline below was committed on August 25 at 3:42 a.m. Pacific, before the 11:00 a.m. submission-period start. It proves the cutoff without publishing the private evaluation tree. The clean public export begins at `646f9164`; inspect subsequent work with `git log 646f9164..HEAD`.

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

</details>

## Intentionally not included

The evaluation pipeline, execution harness, private briefs and rubrics, controls, raw Trials and logs, production database history, credentials, and deployment receipts are intentionally not part of this public product repository or its history.

## Trademark note for the demo

The challenge rules separately restrict third-party trademarks in the public demo video. Repository notices do not grant video permission. Record the demo with Arena-owned visuals and text-only configuration names unless the relevant owner has authorized use of a mark.
