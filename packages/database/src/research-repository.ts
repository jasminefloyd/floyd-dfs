import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchPackage, ResearchPlan, ResearchRunRecord } from "@sports-engine/contracts";

export interface ResearchRepository {
  save(run: Omit<ResearchRunRecord, "id">): Promise<ResearchRunRecord>;
  getLatest(generationRunId: string, tenantId: string): Promise<ResearchRunRecord | undefined>;
}

export class SupabaseResearchRepository implements ResearchRepository {
  constructor(private readonly client: SupabaseClient) {}

  async save(run: Omit<ResearchRunRecord, "id">): Promise<ResearchRunRecord> {
    const { data, error } = await this.client.from("floyd_dfs_research_runs").insert({
      tenant_id: run.tenantId, generation_run_id: run.generationRunId, version: run.version,
      research_plan: run.plan, research_package: run.researchPackage, status: run.status,
      model_name: run.modelName ?? null, prompt_version: run.promptVersion ?? null, created_at: run.createdAt,
    }).select("*").single();
    if (error) throw error;
    const record = mapRun(data);
    const findings = run.researchPackage.findings.map((finding) => ({
      id: finding.id, tenant_id: run.tenantId, research_run_id: record.id, bucket: finding.bucket,
      subject_type: finding.subjectType, subject_id: finding.subjectId, finding: finding.finding,
      source_name: finding.sourceName, source_url: finding.sourceUrl ?? null, source_tier: finding.sourceTier,
      source_purpose: finding.sourcePurpose, published_at: finding.publishedAt ?? null, retrieved_at: finding.retrievedAt,
      confidence: finding.confidence, metadata: finding.metadata ?? {},
    }));
    if (findings.length) {
      const result = await this.client.from("floyd_dfs_research_findings").insert(findings);
      if (result.error) throw result.error;
    }
    return record;
  }

  async getLatest(generationRunId: string, tenantId: string): Promise<ResearchRunRecord | undefined> {
    const { data, error } = await this.client.from("floyd_dfs_research_runs").select("*").eq("generation_run_id", generationRunId).eq("tenant_id", tenantId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? mapRun(data) : undefined;
  }
}

function mapRun(row: Record<string, unknown>): ResearchRunRecord {
  return { id: String(row.id), tenantId: String(row.tenant_id), generationRunId: String(row.generation_run_id), version: Number(row.version), plan: row.research_plan as ResearchPlan, researchPackage: row.research_package as ResearchPackage, status: row.status as ResearchPackage["status"], modelName: row.model_name ? String(row.model_name) : undefined, promptVersion: row.prompt_version ? String(row.prompt_version) : undefined, createdAt: String(row.created_at) };
}
