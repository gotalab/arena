import type { BenchmarkOverviewState } from "./benchmark-view";
import type { TaskComparisonState } from "./task-comparison";

/**
 * The route-owned comparison state shared by React controls and WebMCP.
 * Selectors stay pure; this small controller is the only mutation boundary,
 * so an Agent action updates the same URL-backed state a person is viewing.
 */
export interface ArenaBenchmarkController {
  overview: {
    state: BenchmarkOverviewState;
    setState: (state: BenchmarkOverviewState) => void;
  };
  task: {
    state: TaskComparisonState;
    setState: (state: TaskComparisonState) => void;
  };
}
