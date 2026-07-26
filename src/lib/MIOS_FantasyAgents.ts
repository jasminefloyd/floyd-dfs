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
  // F1 specific
  position?: number;
  qualifying_pos?: number;
  dnf_reason?: string;
  fastest_lap?: boolean;
  f1_points?: number;
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
  ownership_projection?: number;
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
  minutes_projection?: number;
  usage_rate?: number;
  pace_metric?: number;
  depth_chart_order?: number;
  context_score?: number;
  news_score?: number;
  news_note?: string;
  last_5_stats?: {
    avg_points: number;
    avg_fantasy_pts: number;
    trend: 'up' | 'down' | 'stable';
    confidence: number;
    minutes_avg?: number;
    is_synthetic?: boolean;
    games: Last5Game[];
  };
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
  data_warnings: string[];
  collected_at: string;
}

// Confidence Scorer
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
