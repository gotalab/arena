# STOMP

A one-screen score attack about a small ground machine and the single ball it
keeps alive. Portrait, mobile first, touch and mouse complete.

Open `index.html`. No build step, no network, no assets — art and sound are
generated procedurally, so the tree works straight off the filesystem or from
any static host or iframe.

```
index.html      shell + overlay markup
styles.css      control surfaces, idle line, end card
game.js         the simulation (deterministic, headless, no DOM)
art.js          the renderer (reads the sim, never writes to it)
audio.js        procedural WebAudio cues
main.js         layout, input, frame loop, platform telemetry
tests/          node harness for the simulation contract
```

## Playing

The first press of a direction or of jump starts the clock. There is no start
button and no start screen.

| | |
|---|---|
| Bottom-left surface | plants its origin on touch-down; horizontal displacement steers until release |
| Bottom-right surface | queues one grounded jump per touch-down |
| Flick up on the move surface | also queues a jump, so a single pointer (or a mouse) can play the whole loop without releasing the steer |
| `←` `→` | move |
| `Space` / `↑` | jump |
| `R` | restart the current seeded run |
| `M` | mute |

Meeting the falling ball is simultaneously recovery and aim. Where the machine
is, and what it is doing at the moment of contact, chooses one of three returns:

| Contact | Return | Reaches |
|---|---|---|
| machine descending, or a late off-centre catch | **weak** | apex 372 — stays under the low lane |
| grounded | **normal** | apex 274 — through the low lane, under the high lane |
| machine rising | **power** | apex 134 — through the high lane |

The bands are absolute apex heights rather than impulses, so a band reads the
same in the world no matter how high off the ground the ball was met.

An airborne target takes three descending top-strikes. It survives the first
two, slows down as it takes damage, and each hit returns more clock than the
last (1.6s, 2.4s, 3.4s, plus 2.6s on the kill — 10.0s for a finished pursuit,
comfortably more than a pursuit costs). Hitting a target anywhere but the top
does no damage, costs 4.0s, and charges once per continuous overlap.

## Geometry and fairness

World Y increases **downward**. `groundY` 574, `lowLaneY` 330, `highLaneY` 196,
stage 360 wide.

- A normal machine jump apexes at y 434 — its roof reaches 414, far below the
  low lane's underside at 351. The ball owns airborne attacks.
- The machine crosses the whole stage in ~0.85s; a normal return takes ~0.91s
  to fall from apex and ~1.83s round trip. From anywhere on the ground the
  machine wins the race to any landing point, so a drop is always a misread.
- Collision never exceeds drawn size: flyers 20 against 21, walkers 14 against
  15, ball 10 against 10, machine a 22 half-width box inside a body drawn 25
  half-wide.

## The opening promise

Held on every seed, not by luck:

- a slow low-lane target enters at 0.5s and is crossing within the first couple
  of seconds of play;
- a slow high-lane target follows at ~5.3s, so both lanes have shown a slow
  target long before half the 80s clock drains;
- until the player destroys a first airborne target, no fast flyer joins the
  air, and whenever the current slow target leaves or dies another follows
  within about a second;
- ground walkers stay out of it until 20s.

A player who only keeps the ball alive still has clock left after a minute, so
a first run is long enough to learn return timing, lane height and the
three-hit pursuit.

## Platform telemetry

`window.__ARENA_GAME__` exposes `reset(seed)`, `snapshot()` and `advance(ms)`.

Rules advance on a fixed 60Hz step, driven through one shared accumulator, so
`advance(ms)` is literally the loop the player is running — same step, same
rules, same held input, same seeded patterns. Real-time frames call the same
entry point, which is why ragged frames, one big `advance`, and many small
`advance` calls all land on identical snapshots.

`advance()` is inert while the run is frozen (before the first input, after the
clock empties) and awards nothing on its own. Calling it marks the simulation
externally driven so the render loop stops adding real time underneath a scrub;
`reset()`, or the player touching a control, hands driving back.

`snapshot()` deep-copies, so reading never changes the game.

Event kinds: `machine_jump`, `machine_land`, `ball_bounce_weak`,
`ball_bounce_normal`, `ball_bounce_power`, `top_hit`, `enemy_defeated`,
`wrong_side_hit`, `ball_drop`, `ground_stomp`, plus `run_start`, `run_end` and
`walker_bite` for visible secondary rules.

## Tests

`tests/sim.test.js` is a plain node harness over `game.js` — it covers the
return bands from every contact height, plate separation, the reach guarantee,
determinism, `advance()` equivalence across framing, frozen states, snapshot
purity, the opening promise across 200 seeds, first-run length, the time and
score economy, hitbox honesty, the event contract, and escalation.

```
node tests/sim.test.js
```

> Note: this harness was written alongside the simulation but could not be
> executed in the environment the game was built in, which denied node script
> execution. The invariants it asserts were derived and checked by hand; run it
> before trusting them.
