# EMBER

A one-finger vertical climbing game. You are a living spark in a tall dark flue,
climbing toward the night sky on slingshot launches while a cold damp rises
below you and never stops.

Open `index.html`. No build step, no dependencies, no network access.

## How it plays

- **Press anywhere** to plant the aim origin, **drag away** to draw the sling,
  **release** to launch. The spark flies *opposite* the drag: pull down to fly
  up. A longer pull launches harder. A pull shorter than the dead zone cancels,
  so a stray tap never costs anything.
- **Every launch spends one glow.** The stock is three, shown as flames in the
  top-left corner.
- **Landing on a ledge or a wall refills the stock.** Ledges hold you forever;
  walls are slick with soot and you slide while you cling.
- **Soot-moths burst on contact**, kick you upward and hand back one glow. They
  are the only way to keep climbing once the stock runs low in open air.
- **Glimmers** are the treasure. They sit off the safe road, and they are worth
  more when collected during a chain.
- **A chain** counts every mid-air launch and every moth burst since you last
  touched down. Landing banks it: later links pay more than earlier ones, so a
  chain of five is worth far more than five chains of one. Landing never costs
  you anything.
- **The damp kills.** It rises always, faster the higher you climb, and it
  closes in if you get too far ahead. Standing still is not an option.

Tap the speaker in the top-right to mute. Sound starts only after the first
press, and the game is fully playable in silence.

Append `?seed=<base36>` to the URL to play a specific flue.

## The tree

```
index.html          entry point, loads the modules in dependency order
css/ember.css       full-bleed canvas, no page scroll, safe-area probe
js/core.js          constants, deterministic math, seeded RNG, rank ladder
js/gen.js           flue generation: ledges with a reachability guarantee,
                    motif-driven glimmer and moth placement
js/sim.js           the rules: fixed 60 Hz step, glow economy, chains, damp,
                    scoring, and the Arena snapshot
js/audio.js         the whole sound identity, synthesised in code
js/fx.js            view-only particles, rings, banners, shake, flashes
js/art.js           character and prop drawing: spark, moths, glimmers, ledges
js/render.js        camera, layered background, walls, damp, HUD, screens
js/main.js          loop, pointer input, event dispatch, runtime interface
```

Everything is drawn at runtime from code: there are no image, font or audio
files, and nothing is fetched.

## Rules, view and sound are separate on purpose

- `js/sim.js` is the only source of truth. It never reads `Date.now()`,
  `Math.random()`, the renderer or the audio, and it advances only in fixed
  1/60 s steps. Two `reset(seed)` calls produce byte-identical starting states,
  including the generated flue.
- `js/fx.js` and `js/render.js` may use real time and `Math.random()` freely:
  nothing they do can reach the simulation, the snapshot or a collision.
- `js/audio.js` is a pure consumer of events. A failing voice is swallowed and
  the run carries on.

## Arena runtime interface

`window.__ARENA_GAME__` exposes:

- `reset(seed)` — restart from a seed. Equivalent to a tap on the end-of-run
  screen when passed the current run's seed. The session best survives a reset.
- `snapshot()` — a read-only view of the current simulation state: run state,
  player, glow economy, chain, world, entities in the reported span, and
  `lastEvent`. Positions, velocities, `dampY`, `dampSpeed`, `height` and
  `launchReach` are rounded to 3 decimals, `difficulty` to 4; scores, counters
  and ticks are integers.

`phase` is `"ready"` until the first launch, and `tick` and `elapsedMs` stay at
zero while it is, so idle time before the first input can never change a
snapshot.
