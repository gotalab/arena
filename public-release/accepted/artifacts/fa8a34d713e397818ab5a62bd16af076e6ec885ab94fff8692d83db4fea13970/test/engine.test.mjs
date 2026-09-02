import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, ArenaError } from "../js/engine.js";
import { LEVEL_IDS, PARSED_LEVELS, parseLevel } from "../js/levels.js";

const KEYS = [
  "revision",
  "attempt",
  "phase",
  "outcome",
  "levelId",
  "width",
  "height",
  "walls",
  "goals",
  "crates",
  "player",
  "poweredGoals",
  "moveCount",
  "pushCount",
  "undoAvailable",
  "legalActions",
];

function sorted(cells) {
  return cells.every((c, i, a) => i === 0 || a[i - 1].row < c.row || (a[i - 1].row === c.row && a[i - 1].col <= c.col));
}

test("all twenty boards parse with matching cores and sockets", () => {
  assert.equal(LEVEL_IDS.length, 20);
  for (const id of LEVEL_IDS) {
    const lv = PARSED_LEVELS[id];
    assert.ok(lv, id);
    assert.equal(lv.crates.length, lv.goals.length, id);
    assert.ok(lv.player);
    assert.equal(parseLevel(id).id, id);
  }
});

test("snapshot shape is exact and coordinates are objects", () => {
  const g = new Game();
  const s = g.snapshot();
  assert.deepEqual(Object.keys(s).sort(), [...KEYS].sort());
  assert.equal(s.levelId, "first-light");
  assert.equal(s.phase, "playing");
  assert.equal(s.outcome, null);
  assert.equal(s.revision, 0);
  assert.ok(sorted(s.walls));
  assert.ok(sorted(s.goals));
  assert.ok(sorted(s.crates));
  assert.equal(typeof s.player.row, "number");
  assert.equal(typeof s.player.col, "number");
  assert.ok(!Array.isArray(s.player));
});

test("first-light solution seats the core and freezes movement", () => {
  const g = new Game();
  const path = ["up", "right", "down", "right", "up", "up"];
  for (const direction of path) {
    g.act({ type: "move", direction });
  }
  const s = g.snapshot();
  assert.equal(s.phase, "complete");
  assert.equal(s.outcome, "powered");
  assert.equal(s.poweredGoals, 1);
  assert.equal(s.moveCount, 6);
  assert.equal(s.pushCount, 3);
  assert.throws(
    () => g.act({ type: "move", direction: "left" }),
    (err) => err instanceof ArenaError && err.code === "illegal_action",
  );
  assert.equal(g.snapshot().revision, s.revision);
  assert.ok(!s.legalActions.some((a) => a.type === "move"));
});

test("walking into a wall does not mutate", () => {
  const g = new Game();
  g.act({ type: "move", direction: "left" });
  const before = g.snapshot();
  assert.throws(() => g.act({ type: "move", direction: "left" }), ArenaError);
  const after = g.snapshot();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.player, before.player);
  assert.equal(after.moveCount, before.moveCount);
});

test("cannot push two cores together", () => {
  const g = new Game();
  g.act({ type: "select_level", levelId: "black-start" });
  g.act({ type: "move", direction: "left" });
  g.act({ type: "move", direction: "up" });
  const before = g.snapshot();
  assert.equal(before.player.row, 3);
  assert.equal(before.player.col, 3);
  assert.throws(() => g.act({ type: "move", direction: "right" }), (err) => {
    return err instanceof ArenaError && err.code === "illegal_action";
  });
  assert.equal(g.snapshot().revision, before.revision);
  assert.deepEqual(g.snapshot().crates, before.crates);
});

test("undo reverses a move and still advances revision", () => {
  const g = new Game();
  g.act({ type: "move", direction: "up" });
  const mid = g.snapshot();
  assert.equal(mid.moveCount, 1);
  assert.equal(mid.undoAvailable, true);
  g.act({ type: "undo" });
  const after = g.snapshot();
  assert.equal(after.moveCount, 0);
  assert.deepEqual(after.player, { row: 4, col: 2 });
  assert.equal(after.revision, mid.revision + 1);
  assert.equal(after.phase, "playing");
});

test("undo of the seating move restores play", () => {
  const g = new Game();
  for (const direction of ["up", "right", "down", "right", "up", "up"]) {
    g.act({ type: "move", direction });
  }
  assert.equal(g.snapshot().phase, "complete");
  g.act({ type: "undo" });
  const s = g.snapshot();
  assert.equal(s.phase, "playing");
  assert.equal(s.outcome, null);
  assert.ok(s.legalActions.some((a) => a.type === "move"));
});

test("restart is a new attempt of the same board", () => {
  const g = new Game();
  g.act({ type: "move", direction: "up" });
  const a = g.attempt;
  const r = g.revision;
  g.restart();
  const s = g.snapshot();
  assert.equal(s.levelId, "first-light");
  assert.equal(s.moveCount, 0);
  assert.equal(s.attempt, a + 1);
  assert.equal(s.revision, r + 1);
  assert.equal(s.undoAvailable, false);
});

test("select_level rejects unknown boards", () => {
  const g = new Game();
  const rev = g.revision;
  assert.throws(
    () => g.act({ type: "select_level", levelId: "warehouse" }),
    (err) => err instanceof ArenaError && err.code === "unknown_level",
  );
  assert.equal(g.revision, rev);
});

test("select_level starts a fresh attempt of an authored board", () => {
  const g = new Game();
  const s = g.act({ type: "select_level", levelId: "black-start" });
  assert.equal(s.levelId, "black-start");
  assert.equal(s.phase, "playing");
  assert.equal(s.crates.length, 3);
  assert.equal(s.goals.length, 3);
  assert.equal(s.moveCount, 0);
});

test("reset returns first-light and keeps the seed without changing layouts", () => {
  const g = new Game();
  g.act({ type: "select_level", levelId: "dawn-sequence" });
  const s = g.reset(42);
  assert.equal(s.levelId, "first-light");
  assert.equal(g.seed, 42);
  assert.equal(s.revision, 0);
  assert.equal(s.attempt, 1);
  assert.deepEqual(s.crates, PARSED_LEVELS["first-light"].crates);
});

test("legalActions includes every authored select_level", () => {
  const g = new Game();
  const ids = g.snapshot().legalActions.filter((a) => a.type === "select_level").map((a) => a.levelId);
  assert.deepEqual(ids, LEVEL_IDS);
});

test("cores may leave a socket", () => {
  const g = new Game();
  g.act({ type: "select_level", levelId: "crossfeed" });
  g.act({ type: "move", direction: "up" });
  g.act({ type: "move", direction: "up" });
  assert.equal(g.snapshot().poweredGoals, 1);
  assert.equal(g.snapshot().phase, "playing");
  g.act({ type: "move", direction: "left" });
  g.act({ type: "move", direction: "up" });
  g.act({ type: "move", direction: "right" });
  const s = g.snapshot();
  assert.equal(s.phase, "playing");
  assert.equal(s.poweredGoals, 0);
  assert.ok(s.crates.some((c) => c.row === 1 && c.col === 5));
});

test("mutating a snapshot does not change the live game", () => {
  const g = new Game();
  const s = g.snapshot();
  s.player.row = 0;
  s.crates[0].col = 0;
  s.legalActions.length = 0;
  const s2 = g.snapshot();
  assert.equal(s2.player.row, 4);
  assert.equal(s2.crates[0].col, 3);
  assert.ok(s2.legalActions.length > 0);
});
