/** Shared Phase 0 decision contracts. Keep these JSON-serializable: they are
 * persisted in immutable scan snapshots and attached to generated lineups. */
export type ReadinessStatus = 'ready' | 'caution' | 'blocked';

export interface DataGap {
  key: string;
  message: string;
  required: boolean;
  source?: string;
  observed_at?: string | null;
}

export interface EvidenceRef {
  evidence_id: string;
  source: string;
  source_kind?: 'official' | 'league' | 'media' | 'market' | 'aggregator' | 'community' | 'internal' | 'modeled' | 'unknown';
  url?: string | null;
  published_at?: string | null;
  observed_at?: string | null;
  freshness_seconds?: number | null;
  fact?: string;
  normalized_fact?: Record<string, unknown>;
  raw_payload?: unknown;
  is_modeled: boolean;
  confidence?: number;
}

export interface GameScript {
  script_key: string;
  thesis: string;
  required_conditions: string[];
  opposing_conditions: string[];
  team_exposure_targets: Record<string, number>;
  player_inclusion_rules: string[];
  player_exclusion_rules: string[];
  probability: number;
  evidence_ids: string[];
  confidence: number;
  uncertainty: string[];
  expected_score_range?: { low: number | null; high: number | null; unit: string };
  team_run_distribution?: Record<string, number | null>;
  starter_assumptions?: string[];
  preferred_stacks?: string[];
  bring_backs?: string[];
  captain_candidates?: string[];
  fade_rules?: string[];
  ownership_expectation?: string[];
  pace_range?: { low: number | null; high: number | null; unit: string };
  failure_conditions?: string[];
}

export interface PlayerDecisionProfile {
  player_id: string;
  player_name: string;
  median: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  floor: number | null;
  boom_probability: number | null;
  bust_probability: number | null;
  salary_efficiency: number | null;
  eligibility: string[];
  expected_opportunity: Record<string, number | string | null>;
  matchup_edge: number | null;
  news_role_edge: number | null;
  ownership: number | null;
  leverage: number | null;
  evidence_ids: string[];
  freshness_seconds: number | null;
}

export interface StageTelemetry {
  stage: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  input_count?: number;
  output_count?: number;
  fallback_count?: number;
  rejected_count?: number;
  metadata?: Record<string, unknown>;
}

export interface Phase0Observability {
  request_id: string;
  generated_at: string;
  stages: StageTelemetry[];
  source_counts: Record<string, number>;
  fallbacks: Array<{ stage: string; reason: string }>;
  candidate_counts: Record<string, number>;
  rejection_counts: Record<string, number>;
}

export interface SlateResearchDossier {
  dossier_version: string;
  sport: string;
  contest_type: string;
  contest_id?: string | null;
  contest_date: string;
  lock_time?: string | null;
  generated_at: string;
  freshness_deadline: string;
  readiness_status: ReadinessStatus;
  game_environment: Record<string, unknown>;
  market_context: Record<string, unknown>;
  player_hierarchy: Record<string, string[]>;
  game_scripts: GameScript[];
  source_evidence: EvidenceRef[];
  data_gaps: DataGap[];
  confidence_summary: Record<string, number | string | null>;
  observability: Phase0Observability;
  what_changed?: string[];
  contradictions?: Array<{ fact_key: string; sources: string[]; summaries: string[]; severity: 'low' | 'medium' | 'high' }>;
  prelock_pass?: PrelockPassContract;
  matchup_edges?: Array<{ player_id: string; summary: string; edge: number | null; evidence_ids: string[] }>;
  slate_risks?: Array<{ risk: string; severity: 'low' | 'medium' | 'high'; evidence_ids: string[]; assumption?: string }>;
  prelock_checklist?: Array<{ item: string; status: 'resolved' | 'unresolved' | 'caution'; source?: string }>;
}

export interface PrelockPassContract {
  pass_id: string;
  status: 'scheduled' | 'ready' | 'stale' | 'blocked';
  scheduled_for: string;
  executed_at: string | null;
  changed_sources: string[];
  affected_player_ids: string[];
  affected_script_keys: string[];
  rebuild_scope: 'none' | 'affected_players_scripts_lineups';
  supersede_lineup_ids: string[];
  what_changed: string[];
  blocked_reasons: string[];
}

export interface PortfolioDecision {
  selected_lineup_ids: string[];
  script_assignment: Record<string, string>;
  player_exposure: Record<string, number>;
  team_exposure: Record<string, number>;
  script_exposure: Record<string, number>;
  similarity_estimates: Record<string, number>;
  why_selected: Record<string, string>;
  rejected_alternatives: Array<{ lineup_key: string; reason: string }>;
}

export const PHASE0_DOSSIER_VERSION = 'dossier-v1';

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function withStage<T>(
  telemetry: Phase0Observability,
  stage: string,
  operation: () => Promise<T> | T,
  metadata: Omit<StageTelemetry, 'stage' | 'started_at' | 'finished_at' | 'duration_ms'> = {},
): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  return Promise.resolve(operation()).then((result) => {
    const finishedAt = new Date().toISOString();
    telemetry.stages.push({ stage, started_at: startedAt, finished_at: finishedAt, duration_ms: Date.now() - started, ...metadata });
    return result;
  }, (error) => {
    const finishedAt = new Date().toISOString();
    telemetry.stages.push({ stage, started_at: startedAt, finished_at: finishedAt, duration_ms: Date.now() - started, ...metadata });
    throw error;
  });
}
