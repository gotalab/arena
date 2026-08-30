# EMBER

Portrait one-finger climbing game for the Arena platform.

## Run

Open `index.html` (no build step, no network). The game is a sealed file tree:

- `index.html`
- `css/ember.css`
- `js/sim.js` — 60 Hz seeded simulation, snapshot, `reset`
- `js/audio.js` — Web Audio synthesis
- `js/render.js` — canvas view, particles, layout
- `js/main.js` — pointer loop and `window.__ARENA_GAME__`

## Play

Pull back and release to slingshot. Landing refills glow. Moths refund a glow and kick upward. The damp rises; it ends the run.

## Platform

`window.__ARENA_GAME__.reset(seed)` and `.snapshot()`. Snapshot precision is documented at the top of `js/sim.js`.
