# EMBER

A one-finger vertical climbing game for portrait phones. You are a living spark
in a dark flue: pull back anywhere on screen, let go, fly. Every launch spends a
glow, landing refills the stock, bursting a soot-moth hands one back, and a cold
damp is always rising behind you.

## Tree

```
index.html          entry point, everything relative
css/ember.css       shell only — the game is drawn on one canvas
js/rng.js           seeded mulberry32 + view-only hashes
js/audio.js         synthesised sound identity (no audio files)
js/sim.js           the rules: physics, economy, chains, flue, damp, scoring
js/art.js           baked textures and character drawing
js/render.js        camera, scene, particles, HUD, ceremony
js/main.js          layout, pointer input, 60 Hz driver, Arena interface
```

No network access is used or needed: no fetch/XHR/WebSocket, no CDN, no fonts or
images pulled in, no storage or cookie access. Every asset is generated in code.

## Controls

One pointer, touch or mouse, identical behaviour. Press anywhere to plant the aim
origin, drag to draw the sling, release to launch opposite the drag. A pull
shorter than the dead zone cancels. The same gesture works at rest and in mid-air.
On the end-of-run screen, a tap starts the next run.

## Tuning (world units, y up)

| | |
|---|---|
| stage | 360 wide, walls at x = 30 / 330 |
| gravity | 1500 u/s² |
| launch speed | 400 (dead zone) → 800 (full) |
| `launchReach` | 213.33 (full launch, straight up, from rest) |
| glow stock | 3, refilled by any landing, +1 per moth burst |
| wall slip | 44 u/s downward while clinging |
| moth kick | 700 u/s upward |
| damp speed | (26 + 12·difficulty) u/s, up to 2.7× while it is far behind |
| difficulty | height / 1600, capped at 6 |
| score | height × 0.5 + glimmers + banked chains |
| glimmer | 60 × (1 + 0.6 × chain links), chain capped at 6 |
| chain bank | 6·n·(n+1) at the landing that ends a chain of n |
| ranks | EMBER · CINDER 900 · FLICKER 2000 · BLAZE 3600 · WILDFIRE 5800 · STARFIRE 9000 |

**Safe road.** A full launch clears a vertical gap `dy` at lateral distance `dx`
whenever `dy <= REACH - dx²/(4·REACH)`. Generation applies that envelope from the
previous ledge *and* from both wall faces, with an 0.88 margin, so every anchor in
the flue has a perch it can reach in one launch. Prizes never spawn inside a perch
or on the spark.

## Arena interface

`window.__ARENA_GAME__` exposes `reset(seed)` and `snapshot()`. The simulation
steps at a fixed 60 Hz, reads only its seeded RNG, and never touches `Date.now()`
or `Math.random()`; `reset(seed)` plus the same time-stepped input sequence
reproduces the run exactly. View particles, camera smoothing, screen shake and all
audio are downstream of the snapshot and can never influence it.

Snapshot precision: positions, velocities, height, damp values, `launchReach`,
`halfWidth` and input are rounded to 2 decimals; `difficulty` to 3; scores,
counters, `tick` and `elapsedMs` are integers; radii and wall faces are exact
integer constants. Entities are reported from one `launchReach` below the spark to
2.6 above it, sorted by stable id, and stay in their array with `active: false`
until they leave that span.
