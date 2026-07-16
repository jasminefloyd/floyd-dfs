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
  projection_source?: 'last_5' | 'position_baseline';
  projected_points?: number;
  last_5_stats?: {
    avg_points: number;
    avg_fantasy_pts: number;
    trend: 'up' | 'down' | 'stable';
    confidence: number;
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
  vegas_context: { game_id: string; spread: number; over_under: number; implied_total: number }[];
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

  // Sentiment (10%)
  score += ((sentiment + 1) / 2) * 0.1; // Convert -1 to 1 scale to 0-1

  return Math.min(Math.max(score, 0), 1); // Clamp 0-1
}
