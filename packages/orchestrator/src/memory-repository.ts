import type {
  EngineStage,
  GenerationRunRecord,
  OrchestrationRequest,
  StageRunRecord,
} from "@sports-engine/contracts";
import type { OrchestratorRepository } from "./types";

export class InMemoryOrchestratorRepository implements OrchestratorRepository {
  readonly runs = new Map<string, GenerationRunRecord>();
  readonly requests = new Map<string, OrchestrationRequest>();
  readonly stageRuns: StageRunRecord[] = [];

  async createRun(request: OrchestrationRequest, now: string): Promise<GenerationRunRecord> {
    const run: GenerationRunRecord = {
      id: `run-${this.runs.size + 1}`,
      tenantId: request.tenantId,
      userId: request.userId,
      requestId: request.requestId,
      requestedEntryCount: request.requestedEntryCount,
      state: "created",
      lineage: {},
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    this.requests.set(run.id, request);
    return run;
  }

  async updateRun(run: GenerationRunRecord): Promise<void> {
    this.runs.set(run.id, { ...run, lineage: { ...run.lineage } });
  }

  async saveStageRun(stageRun: StageRunRecord): Promise<void> {
    this.stageRuns.push({ ...stageRun, parentStageVersions: { ...stageRun.parentStageVersions } });
  }

  async getNextStageVersion(runId: string, stage: EngineStage): Promise<number> {
    return this.stageRuns.filter((record) => record.generationRunId === runId && record.stage === stage).length + 1;
  }

  async getRun(runId: string): Promise<GenerationRunRecord | undefined> {
    const run = this.runs.get(runId);
    return run ? { ...run, lineage: { ...run.lineage } } : undefined;
  }

  async getRequest(runId: string): Promise<OrchestrationRequest | undefined> {
    return this.requests.get(runId);
  }

  async getLatestStageRun(runId: string, stage: EngineStage): Promise<StageRunRecord | undefined> {
    return [...this.stageRuns].reverse().find((record) => record.generationRunId === runId && record.stage === stage);
  }
}
