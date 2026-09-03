import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { selectedReviewToolDefinitions } from "../src/lib/selected-review-tools.ts";

function context(overrides = {}) {
  return {
    taskId: "lumenyard",
    taskName: "LUMEN YARD",
    activeCandidate: 1,
    candidateCount: 3,
    selectedCriteria: ["Gate progress changes", "Board states read at a glance"],
    candidateStatus: ["ready", "idle", "idle"],
    humanChoiceAvailable: false,
    humanChoice: undefined,
    revealedCandidates: null,
    openCandidate() {},
    authorized: () => true,
    ...overrides,
  };
}

test("selected review is anonymous and cannot make the human choice", async () => {
  const opened = [];
  const tools = selectedReviewToolDefinitions(context({ openCandidate: (candidate) => opened.push(candidate) }));
  assert.deepEqual(tools.map((tool) => tool.name), ["get_selected_review", "open_review_candidate"]);
  const state = (await tools[0].execute({})).structuredContent;
  assert.equal(state.activeCandidate, 1);
  assert.equal(state.candidates.length, 3);
  assert.equal(state.humanChoiceRequired, true);
  assert.doesNotMatch(JSON.stringify(state), /buildId|configuration|score/i);
  await tools[1].execute({ candidate: 3 });
  assert.deepEqual(opened, [3]);
  assert.throws(() => tools[1].execute({ candidate: 4 }), /between 1 and 3/);
});

test("review result becomes readable only after the human choice", async () => {
  const revealedCandidates = [
    { candidate: 1, buildId: "build-1", configuration: "Codex · Model A", score: 0.9 },
    { candidate: 2, buildId: "build-2", configuration: "Cursor · Model B", score: 0.8 },
  ];
  const tools = selectedReviewToolDefinitions(context({
    candidateCount: 2,
    candidateStatus: ["ready", "ready"],
    humanChoiceAvailable: false,
    humanChoice: 2,
    revealedCandidates,
  }));
  assert.deepEqual(tools.map((tool) => tool.name), ["get_selected_review", "open_review_candidate", "get_selected_review_result"]);
  const output = (await tools[2].execute({})).structuredContent;
  assert.equal(output.humanChoice, 2);
  assert.deepEqual(output.selectedCriteria, ["Gate progress changes", "Board states read at a glance"]);
  assert.deepEqual(output.candidates, revealedCandidates);
  assert.equal(output.affectsPublicBenchmark, false);
  assert.equal(output.affectsBlindRecord, false);
});

test("stale selected review handles fail closed", () => {
  const [read] = selectedReviewToolDefinitions(context({ authorized: () => false }));
  assert.throws(() => read.execute({}), /Selected review changed/);
});
