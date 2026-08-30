# STOMP

Portrait one-screen score attack for the arcade platform. A brass hopper and its porcelain ball share one body of play: move under the falling ball, time the return, and stomp airborne lanterns from above.

## Artifact

- `index.html` — shell, canvas, touch pads, curtain card
- `game.css` — viewport lock, portrait stage, overlay
- `js/sim.js` — deterministic 60 Hz rules, seeded director, `STOMP_SIM`
- `js/game.js` — render, audio, input, `window.__ARENA_GAME__`
- `test/sim.test.js` — contract checks (determinism, opening, bounce bands, pursuit)

Open `index.html` (or any static server at the repo root). No build step.

## Play

There is no start screen. The first direction or jump starts the clock.

- Keyboard: `←` `→` move, `Space` jump, `R` restart the seeded run
- Touch / mouse: left pad is analog steer (origin on press), right pad queues one jump
- Three returns: late/falling contact is weak, grounded is normal (low lane), rising is power (high lane)
- Airborne targets take three descending top hits; the third is the big clock and score reward
- Underside/side hits and ball drops cost time; the same ball returns after a short recovery

## Arena API

`window.__ARENA_GAME__` exposes `reset(seed)`, `snapshot()`, and `advance(ms)`.

- Rules step at 60 Hz. Ready state (before first input) and the ended curtain do not simulate.
- `advance` is the same loop the live game uses. Snapshot is a deep copy and does not mutate play.
- World Y increases upward. `groundY` < `lowLaneY` < `highLaneY`.

## Tests

```bash
node test/sim.test.js
```
