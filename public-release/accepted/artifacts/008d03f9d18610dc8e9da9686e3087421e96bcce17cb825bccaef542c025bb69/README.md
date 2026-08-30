# STOMP

A one-screen score attack about a small ground machine and the single ball it
keeps alive. Move under the falling ball, meet it at the right height, and turn
every return into an aimed attack on the targets crossing the two air lanes.
Three clean top hits burst a target and throw the clock back upward.

Phone portrait is the primary stage. No build step, no dependencies: open
`index.html`.

## Artifact tree

```
index.html      shell, viewport + safe-area meta, script order
styles.css      full-bleed no-scroll canvas shell
js/sim.js       deterministic 60 Hz simulation (rules, physics, director)
js/render.js    procedural art, effects, HUD, overlays (view-only)
js/audio.js     procedural WebAudio, no asset files
js/main.js      layout, input, frame loop, window.__ARENA_GAME__
```

`sim.js` never reads the renderer, and `render.js` never writes simulation
state. Effects, moods, shake, and particles live entirely in the view.

## Controls

| Action | Keyboard | Pointer / touch |
| --- | --- | --- |
| Move | `ArrowLeft` / `ArrowRight` | Press and drag the left surface; displacement from the touch-down origin sets the axis |
| Jump | `Space` | Tap the right surface (one grounded jump per press) |
| Restart | `R` | Tap anywhere on the end screen |
| Mute | — | Tap the speaker badge |

The first movement or jump starts the clock; there is no start button and no
start screen. Movement and jump pointers work at the same time on touch, and
mouse play never needs two pointers at once.

## Return bands

Contact timing, not a button, picks the attack:

| Band | Contact | Reach |
| --- | --- | --- |
| `weak` | machine descending, or a contact caught on the deck edge | below the low lane |
| `normal` | grounded contact | through the low lane, under the high lane |
| `power` | machine rising out of a jump | through the high lane |

Each band is declared as the altitude the return must reach and the launch speed
is solved from the contact height, so the ordering holds even though the deck
sits 88px higher at the machine's jump apex than on the ground. A fixed launch
speed would let a late airborne catch overshoot the lane it belongs to.

Horizontal machine speed at contact steers the outgoing ball, so positioning is
recovery and aim in the same motion. A normal jump apex stays below the low
lane, so the ball owns every airborne attack. Because the ball's ascent crosses
the lane it will strike, a return sent straight up into a target bites the
underside; the aimed return passes beside the target going up and lands on its
top coming down.

## Economy

- Three ordered top hits per airborne target, each returning more time than the
  last; the third bursts it for the largest time and score reward. One finished
  pursuit returns more time than the clock drains across it.
- A side or underside collision does no damage, costs time, and charges at most
  once per continuous overlap.
- A ball that reaches the ground costs more than one wrong-side hit and returns
  the same ball above the machine, playable again inside about a second.
- Attack score alone raises the nondecreasing `difficulty` tier, which sends
  targets more often, faster, and increasingly overlapped with a ground walker,
  before settling into a bounded peak. Recovery beats follow each burst.

The stage is never wider than the machine can cover: from any ground position
the machine reaches the landing point of any normal return before the ball
arrives, so a drop is always a misread. `STOMP_audit()` in the console prints
that fairness margin plus the collision/visual size ratios.

## Layout

`main.js` recomputes the layout on resize, orientation change, and
`visualViewport` changes, then hands the renderer a stage rect and two control
rects.

- **Tall frames** get the portrait stage on top with the two control surfaces
  clustered directly under it.
- **Wide frames** keep the portrait stage at full height and move the control
  surfaces into the letterbox columns beside it, so the lanes never stretch and
  the controls stay in reach.

Both modes are sized inside `100dvh` minus the safe-area inset, so nothing
scrolls and nothing is clipped in an embedded frame or at the phone's full
visible viewport.

## Platform telemetry

`window.__ARENA_GAME__`:

- `reset(seed)` — restores the complete initial state and replays the same
  seeded sequence.
- `snapshot()` — a fresh plain object each call; reading never mutates.
- `advance(ms)` — runs the production update loop forward through the same fixed
  60 Hz step with the same held input and the same seeded patterns, then
  returns. It advances nothing while the run is frozen before the first input or
  after the clock has emptied, awards nothing on its own, and is the only
  external way to move the simulation. Any split of the same total (one call or
  six hundred) lands on the same tick.

World Y increases downward: `groundY` is the largest value, `lowLaneY` sits
above it, `highLaneY` above that, and `machineNormalApexY` is the machine
centre's apex height on a normal jump.

`recentEvents` is an append-ordered bounded history since reset, with
`sequence` starting at one and increasing exactly once per event. Emitted kinds:
`machine_jump`, `machine_land`, `ball_bounce_weak`, `ball_bounce_normal`,
`ball_bounce_power`, `top_hit`, `enemy_defeated`, `wrong_side_hit`, `ball_drop`,
`ground_stomp`, plus `run_start`, `enemy_spawn`, and `run_over` for visible
secondary rules.

## Verification

`tests/` holds Playwright scripts (the only dev dependency) run against a
static server on the tree:

```
python3 -m http.server 8099      # from the artifact root
node tests/t1.js                 # API, determinism, granularity, hitbox ratios
node tests/t2.js                 # opening promise, bands, economy, event contract
node tests/t3.js                 # layouts, no-scroll, pointer paths, screenshots
node tests/t4.js                 # difficulty profile, audio, enemy observability
```

`tests/bot.js` is the scripted player used by the gameplay suites: it predicts
the ball's rendezvous point, aims returns at a locked target, and hops walkers.

They cover the fairness invariant, the three return bands landing in their
lanes, pursuit economy, `reset` + identical inputs producing identical
snapshots, real-time play matching `advance()` field for field, and every
contract event kind appearing in ordinary play.
