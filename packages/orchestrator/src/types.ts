import type {
  EngineStage,
  GenerationRunRecord,
  OrchestrationRequest,
  StageExecutionResult,
  StageRunRecord,
} from "@sports-engine/contracts";

export interface StageExecutionContext {
  run: GenerationRunRecord;
  stage: EngineStage;
  attempt: number;
  lineage: GenerationRunRecord["lineage"];
}

export type StageHandler = (
  input: unknown,
  context: StageExecutionContext,
) => Promise<StageExecutionResult>;

export interface StageContract {
  parse(output: unknown): unknown;
}

export interface OrchestratorRepository {
  createRun(request: OrchestrationRequest, now: string): Promise<GenerationRunRecord>;
  updateRun(run: GenerationRunRecord): Promise<void>;
  saveStageRun(stageRun: StageRunRecord): Promise<void>;
  getNextStageVersion(runId: string, stage: EngineStage): Promise<number>;
  getRun(runId: string): Promise<GenerationRunRecord | undefined>;
  getRequest(runId: string): Promise<OrchestrationRequest | undefined>;
  getLatestStageRun(runId: string, stage: EngineStage): Promise<StageRunRecord | undefined>;
}

export interface OrchestratorOptions {
  repository: OrchestratorRepository;
  handlers: Partial<Record<EngineStage, StageHandler>>;
  contracts: Partial<Record<EngineStage, StageContract>>;
  now?: () => Date;
  maxResearchGapReruns?: number;
  enteredLineupGuard?: (selectionOutput: unknown, context: StageExecutionContext) => Promise<void> | void;
}

export const GENERATION_STAGES: readonly EngineStage[] = [
  "SLATE",
  "RESEARCH",
  "SPORT_ADJUSTMENT",
  "PROJECTION",
  "OPTIMIZE",
  "SELECTION",
];

export class OrchestrationError extends Error {
  constructor(message: string, readonly stage?: EngineStage) {
    super(message);
    this.name = "OrchestrationError";
  }
}
