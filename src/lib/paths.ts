import type { PublicBuild as Trial, PublicRelease as Release } from "../public-types";

export function taskPath(slug: string): string {
  return `/task/${slug}`;
}

export function comparePath(slug: string): string {
  return `${taskPath(slug)}/compare`;
}

/** A stable, neutral public name for one published showcase build. */
export function buildSlug(trial: Trial): string {
  return trial.artifact.sha256.slice(0, 12);
}

export function buildBySlug(release: Release, taskId: string, slug: string | null | undefined): Trial | null {
  if (!slug) return null;
  const matches = release.builds.filter((trial) => trial.taskId === taskId && buildSlug(trial) === slug);
  return matches.length === 1 ? matches[0]! : null;
}
