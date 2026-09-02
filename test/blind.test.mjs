import "./typescript.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { canRecordBlindChoice } from "../src/lib/blind.ts";

test("only a choice made before identity exposure can be recorded as Blind", () => {
  assert.equal(canRecordBlindChoice(false), true);
  assert.equal(canRecordBlindChoice(true), false);
});
