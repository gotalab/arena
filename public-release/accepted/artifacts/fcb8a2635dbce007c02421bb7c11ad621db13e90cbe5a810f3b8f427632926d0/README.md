# Lumen Yard

A one-screen puzzle about restoring a sleeping power yard, one deliberate push
at a time. You are the yard's maintenance robot. Heavy relay cores have to be
walked into copper sockets. You can push a core, never pull it, and never two
at once — so every push decides which sides of the yard stay reachable. Fill
the last socket and current runs the whole grid.

Twenty fixed boards, no accounts, no network, no build step. Open
`index.html` and play.

## Running it

Any static host works, and so does the filesystem:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

Everything is plain ES5-compatible JavaScript, CSS and HTML with no
dependencies, so `file://` works too.

## Artifact tree

```
index.html      markup, HUD, board map, settings, endings
styles.css      mobile-first portrait layout, no page scroll at any frame size
src/levels.js   the twenty authored boards and the plan parser
src/game.js     rules engine: moves, pushes, undo, restart, level selection
src/render.js   canvas yard: robot, cores, sockets, copper network, effects
src/audio.js    synthesized sound identity (WebAudio, created on first input)
src/ui.js       HUD, input (touch/mouse/keyboard/gamepad), persistence, endings
src/arena.js    window.__ARENA_GAME__ and the arena.game.v1 port bridge
```

`src/game.js` is the single source of truth. Human input, `__ARENA_GAME__` and
the Arena bridge all drive that one engine; none of them has a private path.

## Playing

| Input | Action |
| --- | --- |
| Swipe, or tap an adjacent tile | Move one cell |
| Click an adjacent tile | Move one cell |
| Arrows / WASD | Move one cell |
| `U`, Backspace, or the Undo control | Reverse the last move |
| `R` or the Restart control | New attempt of this board |
| `B` or the Boards control | Open the board map |
| Gamepad D-pad or stick, A, B, Start | Move, activate, undo, restart |

Undo reverses exactly one successful move, including its counters. Restart is
the clean escape. Selecting a board from the map starts a new attempt of it.

Progress, per-board best move counts, the last board played and the sound and
motion settings are stored in `localStorage` under `lumen-yard.save.v1`. If storage
is unavailable the game just plays on without saving.

Motion starts from `prefers-reduced-motion` and can be overridden in Settings.
Reduced motion keeps every state change readable and only calms decoration —
seating, refusal and completion still read clearly. Nothing is signalled by
colour alone: sockets change shape when powered, board tiles in the map carry
glyphs and text, and the HUD counts powered sockets numerically.

## Arena integration

`window.__ARENA_GAME__` exposes `reset(seed)`, `snapshot()`, `act(action)` and
`restart()`. `snapshot()` returns a frozen deep copy. `act()` returns the new
state or throws an error carrying a short `code`. `reset(seed)` returns to
`first-light`; the seed is kept for replay identity and does not alter the
authored boards.

State contains exactly `revision`, `attempt`, `phase`, `outcome`, `levelId`,
`width`, `height`, `walls`, `goals`, `crates`, `player`, `poweredGoals`,
`moveCount`, `pushCount`, `undoAvailable` and `legalActions`. Cell lists are
`{ row, col }` objects sorted by row then column.

The `arena.game.v1` bridge accepts a `connect` message from the parent window
only, with a `sessionId`, an integer `generation` and one transferred
`MessagePort`. It answers with a `ready` envelope, then serves `observe`,
`act` and `restart` requests whose protocol, session and generation match.
`act` and `restart` require `expectedRevision`; a stale revision, an unknown
board, a malformed or illegal action, or a repeated `requestId` is rejected
with `accepted: false` and an error code, leaving revision and state untouched.
The visible board is painted before any successful mutation is reported.

Rejection codes: `bad_action`, `unknown_action`, `bad_direction`,
`unknown_level`, `blocked`, `board_complete`, `no_history`, `stale_revision`,
`expected_revision_required`, `action_required`, `duplicate_request`,
`unknown_command`, `session_mismatch`.

## Credits

Lumen Yard — original design, code, art, writing and sound for this brief.
Built by the yard crew: night shift engineering, copper and glass.
