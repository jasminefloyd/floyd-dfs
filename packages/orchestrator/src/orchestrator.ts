import type {
  EngineStage,
  GenerationRunRecord,
  OrchestrationRequest,
  OrchestrationResult,
  ResearchGap,
  StageExecutionResult,
  StageRunRecord,
} from "@sports-engine/contracts";
import {
  GENERATION_STAGES,
  OrchestrationError,
  type OrchestratorOptions,
  type StageExecutionContext,
} from "./types";

const STATE_BY_STAGE: Record<EngineStage, GenerationRunRecord["state"]> = {
  SLATE: "created",
  RESEARCH: "researching",
  SPORT_ADJUSTMENT: "adjusting",
  PROJECTION: "projecting",
  OPTIMIZE: "optimizing",
  SELECTION: "selecting",
  LEARNING_LOOP: "complete",
};

export class SportsEngineOrchestrator {
  private readonly options: Required<Pick<OrchestratorOptions, "maxResearchGapReruns">> & OrchestratorOptions;
  private readonly now: () => Date;

  constructor(options: OrchestratorOptions) {
    this.options = { maxResearchGapReruns: 3, ...options };
    this.now = options.now ?? (() => new Date());
  }

  async startGeneration(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const now = this.now().toISOString();
    const run = await this.options.repository.createRun(request, now);
    return this.executeGeneration(run, request);
  }

  async runExistingGeneration(run: GenerationRunRecord, request: OrchestrationRequest): Promise<OrchestrationResult> {
    return this.executeGeneration(run, request);
  }

  private async executeGeneration(initialRun: GenerationRunRecord, request: OrchestrationRequest): Promise<OrchestrationResult> {
    let run = initialRun;
    const packages = new Map<EngineStage, unknown>();
    let selectionOutput: unknown;
    let researchGapReruns = 0;
    let startIndex = 0;
    let pendingResearchGaps: ResearchGap[] | undefined;

    try {
      while (startIndex < GENERATION_STAGES.length) {
        const result = await this.executeFrom(run, request, packages, startIndex, pendingResearchGaps);
        run = result.run;
        if (result.selectionOutput !== undefined) selectionOutput = result.selectionOutput;
        if (result.researchGaps?.length) {
          researchGapReruns += 1;
          if (researchGapReruns > this.options.maxResearchGapReruns) {
            return this.failRun(run, "Maximum ResearchGap reruns exceeded.", result.stage);
          }
          pendingResearchGaps = result.researchGaps;
          startIndex = GENERATION_STAGES.indexOf("RESEARCH");
          continue;
        }
        if (result.blocked) return { run, selectionOutput };
        break;
      }

      run = this.transition(run, "ready");
      await this.options.repository.updateRun(run);
      return { run, selectionOutput };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown orchestration failure.";
      return this.failRun(run, message, error instanceof OrchestrationError ? error.stage : undefined);
    }
  }

  async rerunFrom(runId: string, fromStage: Exclude<EngineStage, "LEARNING_LOOP">): Promise<OrchestrationResult> {
    let run = await this.options.repository.getRun(runId);
    if (!run) throw new OrchestrationError(`Generation run ${runId} was not found.`);
    const request = await this.options.repository.getRequest(runId);
    if (!request) throw new OrchestrationError(`Generation request for ${runId} was not found.`);

    const packages = new Map<EngineStage, unknown>();
    for (const stage of GENERATION_STAGES.slice(0, GENERATION_STAGES.indexOf(fromStage))) {
      const artifact = await this.options.repository.getLatestStageRun(runId, stage);
      if (!artifact || artifact.output === undefined) throw new OrchestrationError(`Cannot rerun from ${fromStage}; persisted output for ${stage} is missing.`, stage);
      packages.set(stage, artifact.output);
    }

    const retainedLineage = Object.fromEntries(
      Object.entries(run.lineage).filter(([stage]) => GENERATION_STAGES.indexOf(stage as EngineStage) < GENERATION_STAGES.indexOf(fromStage)),
    );
    run = { ...run, lineage: retainedLineage, error: undefined, updatedAt: this.now().toISOString() };
    await this.options.repository.updateRun(run);

    let pendingResearchGaps: ResearchGap[] | undefined;
    let result: Awaited<ReturnType<SportsEngineOrchestrator["executeFrom"]>>;
    let attempts = 0;
    do {
      result = await this.executeFrom(run, request, packages, pendingResearchGaps ? GENERATION_STAGES.indexOf("RESEARCH") : GENERATION_STAGES.indexOf(fromStage), pendingResearchGaps);
      run = result.run;
      if (result.blocked) return { run };
      pendingResearchGaps = result.researchGaps;
      attempts += 1;
      if (pendingResearchGaps && attempts > this.options.maxResearchGapReruns) return this.failRun(run, "Maximum ResearchGap reruns exceeded.", result.stage);
    } while (pendingResearchGaps?.length);

    run = this.transition(run, "ready");
    await this.options.repository.updateRun(run);
    return { run, selectionOutput: result.selectionOutput };
  }

  private async executeFrom(
    initialRun: GenerationRunRecord,
    request: OrchestrationRequest,
    packages: Map<EngineStage, unknown>,
    startIndex: number,
    researchGaps?: ResearchGap[],
  ): Promise<{ run: GenerationRunRecord; blocked: boolean; selectionOutput?: unknown; researchGaps?: ResearchGap[]; stage?: EngineStage }> {
    let run = initialRun;

    for (let index = startIndex; index < GENERATION_STAGES.length; index += 1) {
      const stage = GENERATION_STAGES[index];
      const handler = this.options.handlers[stage];
      const contract = this.options.contracts[stage];
      if (!handler) throw new OrchestrationError(`No handler registered for ${stage}.`, stage);
      if (!contract) throw new OrchestrationError(`No output contract registered for ${stage}.`, stage);

      run = this.transition(run, STATE_BY_STAGE[stage], stage);
      await this.options.repository.updateRun(run);

      const stageInput = buildStageInput(stage, request, packages, researchGaps);
      const stageVersion = await this.options.repository.getNextStageVersion(run.id, stage);
      const startedAt = this.now().toISOString();
      const context: StageExecutionContext = { run, stage, attempt: stageVersion, lineage: { ...run.lineage } };
      let execution: StageExecutionResult;

      try {
        execution = await handler(stageInput, context);
      } catch (error) {
        throw new OrchestrationError(error instanceof Error ? error.message : `Stage ${stage} failed.`, stage);
      }

      const warnings = execution.warnings ?? [];
      const errors = execution.errors ?? [];
      const completedAt = this.now().toISOString();
      if (execution.status === "BLOCKED") {
        await this.persistStage(run, stage, stageVersion, execution, stageInput, startedAt, completedAt);
        run = this.transition(run, "blocked", stage, errors[0] ?? `${stage} returned BLOCKED.`);
        await this.options.repository.updateRun(run);
        return { run, blocked: true, stage };
      }
      if (execution.output === undefined) throw new OrchestrationError(`${stage} returned ${execution.status} without output.`, stage);

      let output: unknown;
      try {
        output = contract.parse(execution.output);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Output contract validation failed for ${stage}.`;
        await this.persistStage(run, stage, stageVersion, { status: "BLOCKED", errors: [message] }, stageInput, startedAt, completedAt);
        throw new OrchestrationError(message, stage);
      }
      await this.persistStage(run, stage, stageVersion, { ...execution, output }, stageInput, startedAt, completedAt);
      packages.set(stage, output);
      run = { ...run, lineage: { ...run.lineage, [stage]: stageVersion }, updatedAt: completedAt };
      await this.options.repository.updateRun(run);

      if (stage === "SLATE") {
        run = this.transition(run, "slate_validated", stage);
        await this.options.repository.updateRun(run);
      }

      if (stage === "SELECTION") {
        if (this.options.enteredLineupGuard) await this.options.enteredLineupGuard(output, context);
        return { run, blocked: false, selectionOutput: output };
      }
      if (execution.researchGaps?.length) return { run, blocked: false, researchGaps: execution.researchGaps, stage };
    }

    return { run, blocked: false };
  }

  private async persistStage(
    run: GenerationRunRecord,
    stage: EngineStage,
    version: number,
    execution: StageExecutionResult,
    input: unknown,
    startedAt: string,
    completedAt: string,
  ): Promise<void> {
    const record: StageRunRecord = {
      id: `${run.id}:${stage}:${version}`,
      tenantId: run.tenantId,
      generationRunId: run.id,
      stage,
      version,
      status: execution.status,
      input,
      output: execution.output,
      warnings: execution.warnings ?? [],
      errors: execution.errors ?? [],
      startedAt,
      completedAt,
      parentStageVersions: { ...run.lineage },
    };
    await this.options.repository.saveStageRun(record);
  }

  private transition(run: GenerationRunRecord, state: GenerationRunRecord["state"], stage?: EngineStage, error?: string): GenerationRunRecord {
    return {
      ...run,
      state,
      currentStage: stage,
      error: error ? { message: error, stage } : run.error,
      updatedAt: this.now().toISOString(),
    };
  }

  private async failRun(run: GenerationRunRecord, message: string, stage?: EngineStage): Promise<OrchestrationResult> {
    const failed = this.transition(run, "failed", stage, message);
    await this.options.repository.updateRun(failed);
    return { run: failed };
  }
}

function buildStageInput(stage: EngineStage, request: OrchestrationRequest, packages: Map<EngineStage, unknown>, researchGaps?: ResearchGap[]): unknown {
  switch (stage) {
    case "SLATE": return request.input;
    case "RESEARCH": return { validatedSlate: packages.get("SLATE"), researchGaps };
    case "SPORT_ADJUSTMENT": return { validatedSlate: packages.get("SLATE"), researchPackage: packages.get("RESEARCH") };
    case "PROJECTION": return { validatedSlate: packages.get("SLATE"), researchPackage: packages.get("RESEARCH"), adjustmentPackage: packages.get("SPORT_ADJUSTMENT") };
    case "OPTIMIZE": return { validatedSlate: packages.get("SLATE"), researchPackage: packages.get("RESEARCH"), adjustmentPackage: packages.get("SPORT_ADJUSTMENT"), projectionPackage: packages.get("PROJECTION") };
    case "SELECTION": return { validatedSlate: packages.get("SLATE"), researchPackage: packages.get("RESEARCH"), adjustmentPackage: packages.get("SPORT_ADJUSTMENT"), projectionPackage: packages.get("PROJECTION"), optimizerPackage: packages.get("OPTIMIZE") };
    case "LEARNING_LOOP": return { request, packages: Object.fromEntries(packages) };
  }
}
