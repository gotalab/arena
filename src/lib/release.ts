/**
 * The public release evidence and the game list it covers.
 *
 * `src/data/` is the bottom layer: only `lib/` reads it, so a component never
 * imports a JSON record or a content module directly.
 */

import { publicBundle } from "./public-bundle";
import namedRelease from "virtual:arena-public-named";
import type { PublicGame, PublicRelease } from "../public-types";

export const release: PublicRelease = namedRelease;

// The catalogue keeps an entry for every game ever shown, but the site
// surfaces only the sealed release's tasks, in the release's order. A
// released task with no catalogue entry is a publishing mistake that must
// fail the build's tests, not silently drop a game.
export const games: PublicGame[] = release.tasks.map((task) => {
  const game = publicBundle.catalog.find((entry) => entry.id === task.id);
  if (!game) throw new Error(`release task ${task.id} has no entry in data/games.js`);
  return { ...game, ...(task.presentation ? { presentation: task.presentation } : {}) };
});
