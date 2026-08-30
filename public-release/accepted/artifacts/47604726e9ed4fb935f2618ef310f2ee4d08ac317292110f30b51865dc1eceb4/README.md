# DELVE — a one-thumb descent

A timed, one-screen digging game. Drive the drill-pod down a winding corridor,
keep the clock fed with time-fragments, and fly as close to the rocks as your
nerve allows.

## Controls

| Action | Keyboard | Pointer |
| --- | --- | --- |
| Accelerate (dig) | hold `ArrowDown` or `Space` | press and drag **down** |
| Steer | hold `ArrowLeft` / `ArrowRight` | drag sideways from the plant point |
| Restart this vein | `R` (any moment) | tap the run-over screen for a fresh vein |

The two axes are independent: easing the finger back up releases the
accelerator while a sideways offset keeps steering. Sound starts only after
the first input (`M` mutes/unmutes). The game is fully playable in silence.

## Field semantics

- Speeds are world units per second; the idle crawl (~58 u/s) is the floor,
  top speed 520 u/s. Lateral authority falls off sharply as speed rises.
- `depth` is in world units (0.1 unit = 1 display meter).
- Contacting a rock or a wall collapses speed back to the crawl within a
  quarter second; the machine always creeps forward and never stops.
- Fragments add time (base +1.9 s, scaling down with difficulty); a powered
  rock break adds +1.15 s. Remaining time caps at 60 s and starts at 42 s.
- The power item grants ~5.4 s of invincibility to rocks (never walls) and is
  guaranteed within the first minute of corridor driving on any seed.

## Snapshot precision

All numeric values in `snapshot()` are rounded deterministically:

| Fields | Precision |
| --- | --- |
| `x`, `depth`, positions `{x, depth}`, radii, `speed`, wall samples, `courseCenterX`, `corridorHalfWidth`, `safeHalfWidth` | 2 decimal places |
| `difficulty` | 3 decimals |
| `elapsedMs`, `timeMs`, `remainingMs`, `invincibleUntilMs` | integer milliseconds (`elapsedMs === timeMs === round(tick · 1000/60)`) |
| `tick`, `score`, counters, `spawnIndex` | integers |
| `input.stick` | 3 decimals, clamped [-1, 1] |
| `seed`, `rngState` | unsigned 32-bit integers |
| `previewMs` | integer, currently 2212 (= HORIZON 1150 u / top speed 520 u/s) |

The preview horizon reported by `walls[]` and the entity windows is a fixed
world-space distance of 1150 units ahead of the player, independent of frame
size. Entity arrays are sorted by stable id (`r#`, `f#`, `p#`). Collected or
destroyed entities remain listed with `active: false` until they leave the
window behind the player (520 units).

## Determinism

Simulation runs on a fixed 60 Hz step. Rules read no clocks or random sources;
the only RNG is the seeded generator whose state is exposed as `rngState`.
`reset(seed)` followed by identical input timelines reproduces identical
snapshots, and `advance(ms)` is bit-identical to real-time stepping over the
same simulated span. View-only particles, camera shake, and all audio are
deliberately outside the rule state.

## Runtime interface

`window.__ARENA_GAME__ = { reset(seed), snapshot(), advance(ms) }`. Input
arrives as ordinary DOM events at document level. All state lives in memory;
nothing touches storage or the network. Build ships as static files with
relative paths only.
