export type EngineStage =
  | "SLATE"
  | "RESEARCH"
  | "SPORT_ADJUSTMENT"
  | "PROJECTION"
  | "OPTIMIZE"
  | "SELECTION"
  | "LEARNING_LOOP";

export type GenerationRunState =
  | "created"
  | "slate_validated"
  | "researching"
  | "adjusting"
  | "projecting"
  | "optimizing"
  | "selecting"
  | "ready"
  | "blocked"
  | "failed"
  | "complete";

export type StageExecutionStatus = "COMPLETE" | "PARTIAL" | "VALID" | "WARNING" | "BLOCKED";

export interface OrchestrationRequest {
  tenantId: string;
  userId: string;
  requestId: string;
  requestedEntryCount: number;
  input: unknown;
}

export interface ResearchGap {
  question: string;
  importance: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reason: string;
  affectedPlayerIds: string[];
}

export interface StageExecutionResult<T = unknown> {
  status: StageExecutionStatus;
  output?: T;
  warnings?: string[];
  errors?: string[];
  researchGaps?: ResearchGap[];
}

export interface StageRunRecord {
  id: string;
  tenantId: string;
  generationRunId: string;
  stage: EngineStage;
  version: number;
  status: StageExecutionStatus | "FAILED";
  input: unknown;
  output?: unknown;
  warnings: string[];
  errors: string[];
  startedAt: string;
  completedAt: string;
  parentStageVersions: Partial<Record<EngineStage, number>>;
}

export interface GenerationRunRecord {
  id: string;
  tenantId: string;
  userId: string;
  requestId: string;
  requestedEntryCount: number;
  state: GenerationRunState;
  currentStage?: EngineStage;
  error?: { message: string; stage?: EngineStage };
  lineage: Partial<Record<EngineStage, number>>;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationResult {
  run: GenerationRunRecord;
  selectionOutput?: unknown;
}
