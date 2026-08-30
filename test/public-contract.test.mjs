import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validatePublicBundle } from "../public-contract/validate-public-release.mjs";

const accepted = JSON.parse(readFileSync(new URL("../public-release/accepted/bundle.json", import.meta.url), "utf8"));

function manifest(taskId) {
  return {
    schema: "arena.game-manifest.v1",
    taskId,
    tools: ["get_game_state", "take_game_action"],
    actionSchema: { type: "object" },
    stateSchema: { properties: {}, additionalProperties: false },
    resultSchema: { properties: {}, additionalProperties: false },
    maxMessageBytes: 32768,
  };
}

test("task policy and named-Build evidence agree", () => {
  const value = structuredClone(accepted);
  const taskId = value.release.tasks[0].id;
  value.taskManifests = [manifest(taskId)];
  for (const candidate of value.release.builds.filter((item) => item.taskId === taskId)) {
    candidate.agentPlayEvidence = { status: "not_evaluated", receiptAvailable: false };
  }
  const build = value.release.builds.find((candidate) => candidate.taskId === taskId);
  build.agentPlayEvidence = { status: "passed", receiptAvailable: true };
  assert.equal(validatePublicBundle(value).release.builds.find((candidate) => candidate.id === build.id).agentPlayEvidence.status, "passed");

  build.agentPlayEvidence = { status: "failed", receiptAvailable: true };
  assert.equal(validatePublicBundle(value).release.builds.find((candidate) => candidate.id === build.id).agentPlayEvidence.status, "failed");
});

test("invalid manifests and false evidence fail closed", () => {
  const taskId = accepted.release.tasks[0].id;

  const missingTool = structuredClone(accepted);
  missingTool.taskManifests = [{ ...manifest(taskId), tools: ["get_game_state"] }];
  assert.throws(() => validatePublicBundle(missingTool), /core_tools_required/);

  const openState = structuredClone(accepted);
  openState.taskManifests = [{ ...manifest(taskId), stateSchema: { properties: {}, additionalProperties: true } }];
  assert.throws(() => validatePublicBundle(openState), /must_be_false/);

  const unknownTask = structuredClone(accepted);
  unknownTask.taskManifests = [manifest("private-task@1")];
  assert.throws(() => validatePublicBundle(unknownTask), /taskId:not_public/);

  const falseEvidence = structuredClone(accepted);
  falseEvidence.release.builds[0].agentPlayEvidence = { status: "passed", receiptAvailable: true };
  assert.throws(() => validatePublicBundle(falseEvidence), /manifest_status_mismatch/);
});
