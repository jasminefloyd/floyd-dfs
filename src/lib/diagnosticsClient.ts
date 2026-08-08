import { supabase } from './supabaseClient';

export interface ScanArtifactEvaluation {
  id: string;
  snapshot_id: string;
  scorecard: Record<string, unknown>;
  player_sample_size: number;
  lineup_sample_size: number;
  evaluation_source: string;
  evaluated_at: string;
}

export interface ScanArtifact {
  snapshot: {
    id: string;
    manifest_id: string;
    sport: string;
    contest_type: string;
    contest_date: string;
    contest_id?: string | null;
    game_id?: string | null;
    model_version: string;
    readiness_status: 'ready' | 'caution' | 'blocked';
    is_fallback: boolean;
    fallback_reason?: string | null;
    collected_at: string;
    source_health: Record<string, unknown>;
    projection_recipe: Record<string, unknown>;
    manifest_data: Record<string, unknown>;
    created_at: string;
  } | null;
  evaluation: ScanArtifactEvaluation | null;
  provenance: Array<Record<string, unknown>>;
}

export interface ProjectionIngestionAudit {
  sport: string;
  row_count: number;
  projected_actual_row_count: number;
  known_position_count: number;
  unknown_position_count: number;
  known_salary_count: number;
  unknown_salary_count: number;
  known_projection_source_count: number;
  unknown_projection_source_count: number;
  fully_typed_row_count: number;
  first_contest_date: string | null;
  last_contest_date: string | null;
}

export async function getLatestScanArtifact(
  sport?: string,
  contestDate?: string,
): Promise<ScanArtifact | null> {
  const { data, error } = await supabase.rpc('fantasy_ai_get_latest_mios_scan_artifact', {
    p_sport: sport ?? null,
    p_contest_date: contestDate ?? null,
  });
  if (error) throw error;
  return (data ?? null) as ScanArtifact | null;
}

export async function getProjectionIngestionAudit(
  sport = 'wnba',
  days = 45,
): Promise<ProjectionIngestionAudit | null> {
  const { data, error } = await supabase.rpc('fantasy_ai_get_projection_ingestion_audit', {
    p_sport: sport,
    p_days: days,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data as ProjectionIngestionAudit[] : [];
  return rows[0] ?? null;
}
