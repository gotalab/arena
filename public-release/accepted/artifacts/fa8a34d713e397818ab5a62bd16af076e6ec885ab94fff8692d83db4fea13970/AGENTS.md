# Lumen Yard

One-screen campaign puzzle for the arcade platform. A night-shift robot pushes relay cores onto copper sockets across twenty authored boards.

## Play

Open `index.html` in a browser (or serve the workspace root). The live yard is the title screen; the first input begins play.

- Touch: swipe, or tap an adjacent open tile
- Mouse: click an adjacent tile; use Undo / Restart / Circuits / Settings
- Keyboard: arrows or WASD, `U` / Backspace undo, `R` restart
- Gamepad: D-pad or left stick moves, A activates a focused choice, B undoes, Start opens the circuit map

## Arena

`window.__ARENA_GAME__` exposes `reset(seed)`, `snapshot()`, `act(action)`, and `restart()`. Parent frames connect with `arena.game.v1` (`connect` + transferred `MessagePort`). Human input and Arena commands share the same engine in `js/engine.js`.

Visible state fields: `revision`, `attempt`, `phase`, `outcome`, `levelId`, `width`, `height`, `walls`, `goals`, `crates`, `player`, `poweredGoals`, `moveCount`, `pushCount`, `undoAvailable`, `legalActions`.

## Layout

- `index.html` — shell
- `css/lumen.css` — HUD, sheets, focus
- `js/levels.js` — twenty canonical boards
- `js/engine.js` — rules, snapshot, actions
- `js/render.js` — canvas yard
- `js/audio.js` — synthesized cues after first input
- `js/arena.js` — parent bridge
- `js/main.js` — input, campaign chrome, persistence
- `js/persist.js` — local progress (bests, restored bays, last board, sound/motion)

## Tests

```bash
node --test test/engine.test.mjs test/arena.test.mjs
```

Progress is stored in `localStorage` key `lumen-yard-v1` when available. The game stays playable if storage is blocked.
