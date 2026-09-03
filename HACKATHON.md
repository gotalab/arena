# What changed for the WebMCP Challenge

Arena existed before the challenge as a private playable benchmark. It already gave multiple coding-agent configurations the same brief, evaluated the resulting builds with fixed checks, kept those outputs playable, and let people compare two games blind.

During the August 25–September 3, 2026 submission period, I built or substantially rebuilt the public product around that foundation. The private agent/evaluation pipeline and the original human blind comparison remained the starting point. The WebMCP workflow, Agent Play, agent-to-human handoff, next-run checks, public UI, expanded benchmark content, and production runtime were challenge-period work.

## Before the challenge

- Coding-agent configurations received the same brief.
- Arena evaluated their builds with fixed checks and kept the results playable.
- A person could compare two builds blind and reveal their identities afterward.
- There were no WebMCP tools, no agent-operated evidence review, no validated Agent Play, and no path from the human choice to checks for the next run.

## Added during the challenge

- **WebMCP follow-up evaluation:** route-scoped tools let the agent read detailed evidence, change the visible comparison, and continue evaluating the published benchmark on the same page as the person.
- **Validated Agent Play:** the agent can open compatible games, read their live state, send task-owned actions, reject stale revisions without mutation, and complete the same comparable run across a shortlist.
- **Agent-to-human handoff:** the agent can prepare two to four anonymous candidates, but Arena exposes no tool that can choose or reveal them for the person.
- **Next-run checks:** after the human choice, Arena can combine the fixed benchmark, live verification, and human preference into review stages and acceptance checks for the next agent run.
- **Public, reproducible delivery:** I added the sanitized public repository boundary, public schemas, leak scanners, tests, sandboxed Artifact boundary, and Cloudflare Worker/D1 runtime.
- **A rebuilt public product experience:** the Benchmark, task detail, comparison, responsive/mobile layouts, navigation, evidence disclosure, and shared UI controls were redesigned for public exploration and agent operation.
- **A larger public benchmark:** the public challenge history grew from 3 tasks, 39 builds, and 13 Agent configurations to 5 tasks, 70 builds, and 15 configurations.
- **Two new playable tasks:** LUMEN YARD and SHOAL were added to make stateful strategy, recovery, visual feedback, and Agent Play directly inspectable.
- **New Agent configurations:** Antigravity + Gemini 3.8 Flash and fx + GPT-5.6 Sol were added alongside the existing harness/model combinations.

## The new end-to-end flow

1. The person describes what matters for their use case.
2. The agent selects the relevant benchmark evidence.
3. The agent plays the shortlisted builds under comparable conditions.
4. The person plays the same builds anonymously and chooses by feel.
5. The result becomes review stages and acceptance checks for the next agent run.

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
