import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EngineStage,
  GenerationRunRecord,
  OrchestrationRequest,
  StageRunRecord,
} from "@sports-engine/contracts";
import type { OrchestratorRepository } from "@sports-engine/orchestrator";

export class SupabaseOrchestratorRepository implements OrchestratorRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createRun(request: OrchestrationRequest, now: string): Promise<GenerationRunRecord> {
    const { data, error } = await this.client
      .from("generation_runs")
      .insert({
        tenant_id: request.tenantId,
        user_id: request.userId,
        request_id: request.requestId,
        requested_entry_count: request.requestedEntryCount,
        request_payload: toJson({ input: request.input }),
        state: "created",
        lineage: toJson({}),
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapGenerationRun(data);
  }

  async updateRun(run: GenerationRunRecord): Promise<void> {
    const { error } = await this.client
      .from("generation_runs")
      .update({
        state: run.state,
        current_stage: run.currentStage ?? null,
        error: run.error ? toJson(run.error) : null,
        lineage: toJson(run.lineage),
        updated_at: run.updatedAt,
      })
      .eq("id", run.id)
      .eq("tenant_id", run.tenantId);
    if (error) throw error;
  }

  async saveStageRun(stageRun: StageRunRecord): Promise<void> {
    const { error } = await this.client.from("engine_stage_runs").insert({
      tenant_id: stageRun.tenantId,
      generation_run_id: stageRun.generationRunId,
      stage: stageRun.stage,
      version: stageRun.version,
      status: stageRun.status,
      input_payload: toJson(stageRun.input),
      output_payload: stageRun.output === undefined ? null : toJson(stageRun.output),
      warnings: toJson(stageRun.warnings),
      errors: toJson(stageRun.errors),
      parent_stage_versions: toJson(stageRun.parentStageVersions),
      started_at: stageRun.startedAt,
      completed_at: stageRun.completedAt,
    });
    if (error) throw error;
  }

  async getNextStageVersion(runId: string, stage: EngineStage): Promise<number> {
    const { data, error } = await this.client
      .from("engine_stage_runs")
      .select("version")
      .eq("generation_run_id", runId)
      .eq("stage", stage)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return typeof data?.version === "number" ? data.version + 1 : 1;
  }

  async getRun(runId: string): Promise<GenerationRunRecord | undefined> {
    const { data, error } = await this.client.from("generation_runs").select("*").eq("id", runId).maybeSingle();
    if (error) throw error;
    return data ? mapGenerationRun(data) : undefined;
  }

  async getRequest(runId: string): Promise<OrchestrationRequest | undefined> {
    const { data, error } = await this.client.from("generation_runs").select("*").eq("id", runId).maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    const payload = isRecord(data.request_payload) ? data.request_payload : {};
    return {
      tenantId: String(data.tenant_id),
      userId: String(data.user_id),
      requestId: String(data.request_id),
      requestedEntryCount: Number(data.requested_entry_count),
      input: payload.input,
    };
  }

  async getLatestStageRun(runId: string, stage: EngineStage): Promise<StageRunRecord | undefined> {
    const { data, error } = await this.client
      .from("engine_stage_runs")
      .select("*")
      .eq("generation_run_id", runId)
      .eq("stage", stage)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapStageRun(data) : undefined;
  }
}

function mapGenerationRun(row: Record<string, unknown>): GenerationRunRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    requestId: String(row.request_id),
    requestedEntryCount: Number(row.requested_entry_count),
    state: row.state as GenerationRunRecord["state"],
    currentStage: row.current_stage as EngineStage | undefined,
    error: isRecord(row.error) ? { message: String(row.error.message), stage: row.error.stage as EngineStage | undefined } : undefined,
    lineage: isRecord(row.lineage) ? row.lineage as GenerationRunRecord["lineage"] : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapStageRun(row: Record<string, unknown>): StageRunRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    generationRunId: String(row.generation_run_id),
    stage: row.stage as EngineStage,
    version: Number(row.version),
    status: row.status as StageRunRecord["status"],
    input: row.input_payload,
    output: row.output_payload,
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    errors: Array.isArray(row.errors) ? row.errors.map(String) : [],
    startedAt: String(row.started_at),
    completedAt: String(row.completed_at),
    parentStageVersions: isRecord(row.parent_stage_versions) ? row.parent_stage_versions as StageRunRecord["parentStageVersions"] : {},
  };
}

function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
