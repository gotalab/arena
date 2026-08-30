/**
 * The reviewed public narrative for one game. Raw reconstructed prompts and
 * evaluator instructions are intentionally not product inputs.
 */

import { publicBundle } from "./public-bundle";

const narrativeByTask = new Map(publicBundle.catalog.map((task) => [task.id, task.publicNarrative]));

export function promptFor(taskId: string): { text: string } | null {
  const text = narrativeByTask.get(taskId);
  return text ? { text } : null;
}
