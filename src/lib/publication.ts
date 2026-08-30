import { publicBundle } from "./public-bundle";
import type { PublicBlindRelease, PublicGame } from "../public-types";

export const publication = publicBundle.blind;
export const taskManifests = publicBundle.taskManifests;

export const games: PublicGame[] = publication.tasks.map((task) => {
  const game = publicBundle.catalog.find((entry) => entry.id === task.id);
  if (!game) throw new Error(`publication task ${task.id} has no entry in data/games.js`);
  return { ...game, ...(task.presentation ? { presentation: task.presentation } : {}) };
});

export const blindRelease: PublicBlindRelease = publication;
