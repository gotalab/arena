# SHOAL

A one-screen deduction game set in a tide pool at low tide. Turn shells, read
the numbers the water gives back, and reason out where every urchin sleeps.

## The shipped tree

Everything the game needs is here; nothing is fetched at runtime.

```
index.html        entry point
styles.css        HUD, title, ceremony chrome
js/rng.js         deterministic hash + mulberry32; the only source of chance
js/generator.js   pool ladder, board generation, and the deduction engine
js/game.js        rules, clock, pearls, events, snapshot - the one truth
js/audio.js       WebAudio synthesis; no audio files
js/view.js        canvas: water, shells, numbers, ripples, the host
js/input.js       touch, mouse, and keyboard, all producing the same actions
js/bridge.js      the arena.game.v1 parent bridge
js/main.js        app shell, HUD sync, ceremony, window.__ARENA_GAME__
```

`tools/` is a development harness (a static server, the test suites, a
generator benchmark, an economy probe). None of it is loaded by the game.

## How it plays

Tap a covered shell to turn it. Press and hold for half a second to plant or
lift a pennant. Tap a turned number whose pennants already match its value to
sweep its remaining neighbours in one gesture. On desktop, left click turns,
right click pennants, and the hold works on a trackpad too. `R` restarts at
any moment; arrow keys, Space and `F` supplement the pointer but are never
required.

## The promise

At every moment of a correctly played run, at least one covered shell is
provably safe from what is on screen. This is enforced at generation time:
`js/generator.js` plays each candidate board with a logic-only solver
(counting, subset elimination, the public urchin counter, and exhaustive
enumeration over frontier components) and rejects any board that would ever
demand a guess. The first turn of a pool is always quiet water, and it never
clears the whole pool by itself.

`tools/test-rules.js` re-derives that promise from the outside: it replays
whole runs and, at every position, reconstructs what a reader can legitimately
know from `snapshot().rows` alone and checks a certain move exists. The
auditor reasons strictly harder than the generator's own solver, so a pass is
a statement about the position rather than about a search cap.

## Determinism

The board of pool *n* is a pure function of the run seed, the pool number, and
that pool's first turn. The clock is a fixed 60 Hz step; `advance(ms)` moves
it exactly as waiting would. `js/game.js` and `js/generator.js` never read
`Date.now()` or `Math.random()` - randomness there comes only from the seeded
generator in `js/rng.js`. View animation, audio, and gesture timing use the
wall clock and never touch rule state.

## Verifying

```
npm install          # playwright, for the browser suite only
npm test             # rules + promise audit, then browser + bridge
npm run economy      # pearl outcomes for careful / steady / hasty play
npm run bench        # board generation timings
npm run serve        # http://localhost:8712
```
