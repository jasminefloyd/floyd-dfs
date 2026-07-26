import { supabase } from './supabaseClient';

export interface LineupScoreboardRow {
  sport: string;
  contest_date: string;
  contest_type: string;
  contest_id: string | null;
  lineup_count: number;
  best_actual: number | null;
  best_projected: number | null;
  optimal_points: number | null;
  best_pct_of_optimal: number | null;
  avg_pct_of_optimal: number | null;
}

export async function getLineupScoreboard(sport: string, days = 30): Promise<LineupScoreboardRow[]> {
  const { data, error } = await supabase.rpc('fantasy_ai_get_lineup_scoreboard', {
    p_sport: sport,
    p_days: days,
  });

  if (error) throw error;
  return Array.isArray(data) ? data as LineupScoreboardRow[] : [];
}
