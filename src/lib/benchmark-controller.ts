import type { BenchmarkOverviewState } from "./benchmark-view";
import type { TaskComparisonState } from "./task-comparison";

export type TaskComparisonFocusTarget = "results" | "criteria" | "rows" | "evidence";

export interface BenchmarkFocusRequest {
  sequence: number;
  target: "filters";
}

export interface TaskComparisonFocusRequest {
  sequence: number;
  taskId: string;
  target: TaskComparisonFocusTarget;
  checkIds: string[];
}

/**
 * The route-owned comparison state shared by React controls and WebMCP.
 * Selectors stay pure; this small controller is the only mutation boundary,
 * so an Agent action updates the same URL-backed state a person is viewing.
 */
export interface ArenaBenchmarkController {
  overview: {
    state: BenchmarkOverviewState;
    setState: (state: BenchmarkOverviewState) => void;
    focusRequest: BenchmarkFocusRequest | null;
    requestFocus: () => void;
  };
  task: {
    state: TaskComparisonState;
    setState: (state: TaskComparisonState) => void;
    focusRequest: TaskComparisonFocusRequest | null;
    requestFocus: (taskId: string, target: TaskComparisonFocusTarget, checkIds?: readonly string[]) => void;
  };
}
