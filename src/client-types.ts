/** Reader-local state. None of these values belong to the public release bundle. */
export interface Assignment {
  id: string;
  /** Persisted legacy key; values are opaque public build ids. */
  trialIds: string[];
}

export type BlindChoice = string;
export type BattleVerdict = string;

export interface ComparisonState {
  assignments: Record<string, Assignment>;
  choices: Record<string, BlindChoice>;
  previews: Record<string, boolean>;
  votes: Record<string, BattleVerdict>;
}
