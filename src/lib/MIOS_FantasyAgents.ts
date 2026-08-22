// Type definitions for MIOS_Fantasy pipeline
import type { DraftKingsSlate } from './draftkingsSlateClient';
export interface Last5Game {
  date: string;
  opponent: string;
  minutes?: number;
  points?: number;
  rebounds?: number;
  assists?: number;
  steals?: number;
  blocks?: number;
  turnovers?: number;
  threePointFieldGoalsMade?: number;
  three_pointers?: number;
  fg3m?: number;
  fg_pct?: number;
  usage_rate?: number;
  // NFL specific
  passing_yards?: number;
  passing_tds?: number;
  interceptions?: number;
  rushing_yards?: number;
  rushing_tds?: number;
  receiving_yards?: number;
  receiving_tds?: number;
  receptions?: number;
  snap_count?: number;
  targets?: number;
  air_yards?: number;
  // MLB specific
  at_bats?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  home_runs?: number;
  rbis?: number;
  runs?: number;
  strikeouts?: number;
  walks?: number;
  stolen_bases?: number;
}

export interface Player {
  id: string;
  name: string;
  team: string;
  image_url?: string;
  team_logo_url?: string;
  position: string;
  salary: number;
  salary_source?: 'draftkings_import' | 'estimated';
  injury_status: 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';
  injury_note?: string;
  projection_source?: 'draftkings' | 'draftkings_last5_blend' | 'last_5' | 'position_baseline' | 'calibrated' | 'props_blend' | 'opportunity_blend';
  projected_points?: number;
  p10_projection?: number;
  p25_projection?: number;
  p50_projection?: number;
  p75_projection?: number;
  p90_projection?: number;
  p95_projection?: number;
  stdev_fantasy_pts?: number;
  boom_probability?: number;
  bust_probability?: number;
  ownership_projection?: number;
  cpt_ownership_projection?: number;
  flex_ownership_projection?: number;
  prop_projection?: number;
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
  batting_order?: number;
  run_factor?: number;
  opponent_team?: string;
  opposing_probable_pitcher_id?: string;
  opposing_probable_pitcher_name?: string;
  own_probable_starter?: boolean;
  game_id?: string;
  tee_time?: string | null;
  minutes_projection?: number;
  minutes_distribution?: {
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    standardDeviation: number | null;
    didNotPlayProbability: number | null;
    sampleSize: number;
    drivers: string[];
  };
  wnba_role_prior?: {
    sampleSize: number;
    historicalMinutes: number | null;
    historicalMinutesStddev: number | null;
    replacementMinutesGain: number | null;
    didNotPlayProbability: number | null;
    cohort: 'starter' | 'stable_bench' | 'volatile_bench' | 'returning' | 'elevated' | 'unknown';
  };
  role_counterfactual?: string[];
  wnba_component_projection?: {
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    threes: number;
    fantasyPoints: number;
    fantasyStdDev: number;
    sampleSize: number;
    source: 'role_filtered_history' | 'position_hierarchical_prior';
    blendVersion: 'wnba-components-v1';
  };
  candidate_fantasy_projection?: number;
  role_stability?: number;
  minutes_volatility?: number;
  recent_fantasy_per_minute?: number;
  usage_rate?: number;
  pace_metric?: number;
  depth_chart_order?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  news_events?: Array<{ headline: string; source: string; published_at?: string; impact_type: string; confirmed: boolean; is_speculative: boolean }>;
  last_5_stats?: {
    avg_points: number;
    avg_fantasy_pts: number;
    stdev_fantasy_pts?: number;
    games_sample_size?: number;
    minutes_stdev?: number;
    trend: 'up' | 'down' | 'stable';
    confidence: number;
    minutes_avg?: number;
    is_synthetic?: boolean;
    games: Last5Game[];
    source?: string;
    last_updated_at?: string;
  };
  field_provenance?: Record<string, FieldProvenance>;
  confidence_breakdown?: ConfidenceBreakdown;
  projection_trace?: ProjectionTrace;
}

export type ReadinessStatus = 'ready' | 'caution' | 'blocked';

export interface ConfidenceBreakdown {
  data_completeness: number;
  data_freshness: number;
  lineup_certainty: number;
  projection_reliability: number;
  outcome_uncertainty: number;
  label: 'projection_reliability';
}

export interface ProjectionTrace {
  model_version: string;
  base_projection: number | null;
  final_projection: number | null;
  total_adjustment: number;
  applied_models: string[];
  stages: Array<{ name: string; projection: number | null; delta: number }>;
  note: string;
}

export interface FieldProvenance {
  source: string;
  observed_at?: string | null;
  freshness_seconds?: number | null;
  is_modeled: boolean;
  is_fallback: boolean;
}

export interface SourceHealth {
  status: 'ok' | 'partial' | 'unavailable';
  provider?: string;
  coverage?: { matched: number; total: number; percent: number };
  collected_at?: string;
  freshness_seconds?: number | null;
  fallback_used?: boolean;
  failure_reason?: string;
  observed_at?: string | null;
  data_class?: 'live' | 'cached' | 'modeled' | 'unknown';
}

export interface Readiness {
  status: ReadinessStatus;
  eligible_for_lineups: boolean;
  eligible_for_tournament: boolean;
  hard_blocks: string[];
  cautions: string[];
}

export interface MIOS_FantasyManifest {
  manifest_id: string;
  sport: string;
  contest_type: string;
  contest_date: string;
  contest_id?: string;
  game_id?: string;
  slate?: DraftKingsSlate;
  player_roster: Player[];
  injury_updates: { player_id: string; status: string; confidence: number }[];
  vegas_context: {
    game_id: string;
    spread: number;
    over_under: number;
    implied_total: number;
    home_team?: string;
    away_team?: string;
    home_implied?: number;
    away_implied?: number;
  }[];
  social_sentiment: { player_id: string; mentions: number; sentiment_score: number; themes: string[] }[];
  catalysts: { type: string; player_id?: string; description: string }[];
  narrative_seeds: string[];
  source_status: Record<string, 'ok' | 'partial' | 'unavailable'>;
  source_health?: Record<string, SourceHealth>;
  readiness?: Readiness;
  model_version?: string;
  is_fallback?: boolean;
  fallback_reason?: string;
  projection_recipe?: {
    base_projection: string;
    adjustments: string[];
    confidence_definition: string;
  };
  understand_context?: {
    captured_at: string;
    lookback_hours: number;
    event_count: number;
    events: Array<Record<string, unknown>>;
  };
  snapshot_id?: string;
  data_warnings: string[];
  collected_at: string;
}

/**
 * @deprecated The active MIOS edge pipeline uses confidence_breakdown and
 * labels it projection reliability. Keep this compatibility helper only for
 * older callers; its result must not be presented as a win probability.
 */
export function scorePlayerConfidence(
  stats: any,
  injuryStatus: string,
  vegasExpectation: number,
  sentiment: number
): number {
  void sentiment;
  let score = 0.5; // Start at 0.5

  // Injury weight (40%)
  const injuryWeights: Record<string, number> = {
    active: 1.0,
    day_to_day: 0.7,
    probable: 0.6,
    questionable: 0.4,
    doubtful: 0.2,
    out: 0
  };
  score += (injuryWeights[injuryStatus] ?? 0.5) * 0.4;

  // Stats consistency (30%)
  const consistency = stats?.confidence ?? 0.5;
  score += consistency * 0.3;

  // Vegas alignment (20%)
  score += (vegasExpectation * 0.1) * 0.2; // Normalize Vegas to 0-1

  // Reddit sentiment is display-only and does not affect confidence.

  return Math.min(Math.max(score, 0), 1); // Clamp 0-1
}
