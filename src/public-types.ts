/** Closed product-facing types for arena.public-release.v1. */

export interface PublicRequirementSummary {
  passed?: number | null;
  failed?: number | null;
  notEvaluated?: number | null;
  graderErrors?: number | null;
  evaluated?: number | null;
  applicable?: number | null;
  rate?: number | null;
}

export interface PublicCheck {
  id: string;
  category: string;
  lane?: string;
  group?: string | null;
  label?: string;
  description?: string;
  outcome?: string | null;
  evidence?: string;
  reason?: string;
  error?: string;
}

export interface PublicUsage {
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_tokens?: number | null;
}

export interface PublicCostAmount { amount: number; currency?: string }

export interface PublicArtifact {
  sha256: string;
  publicBase: string;
  byteLength?: number;
}

export interface PublicPlayableBuild {
  id: string;
  taskId: string;
  status: "succeeded";
  playability: string | null;
  artifact: PublicArtifact;
}

export type PublicAgentPlayEvidenceStatus = "not_applicable" | "not_evaluated" | "failed" | "passed";

export interface PublicAgentPlayEvidence {
  status: PublicAgentPlayEvidenceStatus;
  receiptAvailable: boolean;
}

export interface PublicBuild extends PublicPlayableBuild {
  configurationId: string;
  requirementSummary: PublicRequirementSummary | null;
  checks: PublicCheck[];
  replica: number;
  runResult?: string | null;
  startedAt?: string | null;
  wallClockSeconds?: number | null;
  usage?: PublicUsage | null;
  totalReportedTokens?: number | null;
  estimatedApiCost?: PublicCostAmount | null;
  actualBilledCost?: PublicCostAmount | null;
  meterSources?: { time?: string; tokens?: string; cost?: string } | null;
  /** Added to newly generated v1 bundles; older v1 records derive it from the task manifest. */
  agentPlayEvidence?: PublicAgentPlayEvidence;
}

export interface PublicConfiguration {
  id: string;
  harnessId?: string;
  harness?: string;
  harnessVersion?: string;
  model?: string;
  effort?: string;
}

export interface PublicTaskPresentation {
  canonicalViewport: { width: number; height: number };
}

export interface PublicTask {
  id: string;
  title: string;
  version: string;
  presentation: PublicTaskPresentation;
}

export interface PublicCellScore {
  mean: number | null;
  ciHalfWidth: number | null;
  n: number;
  replicasCounted: number;
  replicasNullRate: number;
  replicasHeldInvalid: number;
  gatesPassed: boolean;
  gateFailures: string[];
  gateUnverified: string[];
}

export interface PublicOperationalMean { mean: number | null; reported: number }
export interface PublicCellOperationalMetrics {
  runs: number;
  time: PublicOperationalMean;
  tokens: PublicOperationalMean;
  estimatedCost: PublicOperationalMean;
  costAtListPrice: boolean;
}

export interface PublicCellReplica {
  buildId: string | null;
  replica: number;
  showcase: boolean;
  rate: number | null;
  countedInMean: boolean;
  passed: number;
  applicable: number;
  notEvaluated: number;
  graderErrors: number;
  gatesPassed: boolean | null;
  gateFailures: string[];
  gateUnverified: string[];
}

export interface PublicReleaseCell {
  taskId: string;
  configurationId: string;
  showcaseBuildId: string;
  score: PublicCellScore;
  operational: PublicCellOperationalMetrics;
  replicas: PublicCellReplica[];
}

export interface PublicAttempt {
  taskId: string;
  configurationId: string;
  attempted: number;
  succeeded: number;
}

export interface PublicPlayableRelease {
  releaseId: string;
  tasks: PublicTask[];
  builds: PublicPlayableBuild[];
}

export interface PublicBlindRelease extends PublicPlayableRelease {
  configurationCount: number;
}

export interface PublicRelease extends PublicPlayableRelease {
  taskCollection: string | null;
  evaluationVersion: string;
  costDisclosure?: string;
  configurations: PublicConfiguration[];
  cells: PublicReleaseCell[];
  builds: PublicBuild[];
  attempts: PublicAttempt[];
}

export interface PublicGame {
  id: string;
  slug: string;
  name: string;
  image: string;
  browseRule: string;
  rule: string;
  tension: string;
  inputSummary: string;
  controls: Array<{ keys: string; label: string }>;
  presentation: PublicTaskPresentation;
  publicNarrative: string;
}

export interface PublicTaskManifest {
  schema: "arena.game-manifest.v1";
  taskId: string;
  tools: Array<"get_game_state" | "take_game_action" | "restart_game">;
  actionSchema: Record<string, unknown>;
  stateSchema: { properties: Record<string, unknown>; additionalProperties: false };
  resultSchema: { properties: Record<string, unknown>; additionalProperties: false };
  maxMessageBytes: number;
}

export interface PublicReleaseBundle {
  schema: "arena.public-release.v1";
  release: PublicRelease;
  blind: PublicBlindRelease;
  catalog: PublicGame[];
  taskManifests: PublicTaskManifest[];
}
