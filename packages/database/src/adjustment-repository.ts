import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdjustmentPackage, Sport } from "@sports-engine/contracts";

export interface AdjustmentRunRecord { id: string; tenantId: string; generationRunId: string; version: number; sport: Sport; adjustmentPackage: AdjustmentPackage; status: AdjustmentPackage["status"]; modelName?: string; promptVersion?: string; createdAt: string; }
export interface AdjustmentRepository { save(run: Omit<AdjustmentRunRecord, "id">): Promise<AdjustmentRunRecord>; getLatest(generationRunId: string, tenantId: string): Promise<AdjustmentRunRecord | undefined>; }

export class SupabaseAdjustmentRepository implements AdjustmentRepository {
  constructor(private readonly client: SupabaseClient) {}
  async save(run: Omit<AdjustmentRunRecord, "id">): Promise<AdjustmentRunRecord> {
    const { data, error } = await this.client.from("floyd_dfs_adjustment_runs").insert({ tenant_id: run.tenantId, generation_run_id: run.generationRunId, version: run.version, sport: run.sport, adjustment_package: run.adjustmentPackage, status: run.status, model_name: run.modelName ?? null, prompt_version: run.promptVersion ?? null, created_at: run.createdAt }).select("*").single();
    if (error) throw error;
    const record = mapRun(data);
    const rows = run.adjustmentPackage.adjustments.flatMap((player) => player.adjustments.map((adjustment) => ({ tenant_id: run.tenantId, adjustment_run_id: record.id, player_id: player.playerId, adjustment_type: adjustment.adjustmentType, direction: adjustment.direction, magnitude: adjustment.magnitude, confidence: adjustment.confidence, rationale: adjustment.rationale, evidence_finding_ids: adjustment.evidenceFindingIds, metadata: { baselineContext: player.baselineContext, roleCertainty: player.roleCertainty, netOpportunityDirection: player.netOpportunityDirection } })));
    if (rows.length) { const result = await this.client.from("floyd_dfs_player_adjustments").insert(rows); if (result.error) throw result.error; }
    return record;
  }
  async getLatest(generationRunId: string, tenantId: string): Promise<AdjustmentRunRecord | undefined> { const { data, error } = await this.client.from("floyd_dfs_adjustment_runs").select("*").eq("generation_run_id", generationRunId).eq("tenant_id", tenantId).order("version", { ascending: false }).limit(1).maybeSingle(); if (error) throw error; return data ? mapRun(data) : undefined; }
}

function mapRun(row: Record<string, unknown>): AdjustmentRunRecord { return { id: String(row.id), tenantId: String(row.tenant_id), generationRunId: String(row.generation_run_id), version: Number(row.version), sport: row.sport as Sport, adjustmentPackage: row.adjustment_package as AdjustmentPackage, status: row.status as AdjustmentPackage["status"], modelName: row.model_name ? String(row.model_name) : undefined, promptVersion: row.prompt_version ? String(row.prompt_version) : undefined, createdAt: String(row.created_at) }; }
