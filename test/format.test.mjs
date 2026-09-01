import "./typescript.mjs";

import assert from "node:assert/strict";
import test from "node:test";

import { formatCompactTokens } from "../src/lib/format.ts";

test("formatCompactTokens keeps the unit visible in dense summaries", () => {
  assert.equal(formatCompactTokens(null), "Not reported");
  assert.equal(formatCompactTokens(999), "999 tok");
  assert.equal(formatCompactTokens(149_825), "150K tok");
  assert.equal(formatCompactTokens(1_414_960), "1.41M tok");
  assert.equal(formatCompactTokens(12_300_000), "12.3M tok");
});
