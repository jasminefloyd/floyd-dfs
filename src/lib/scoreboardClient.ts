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
  total_entry_fees: number | null;
  total_payout: number | null;
  roi: number | null;
  best_finish_percentile: number | null;
  median_finish_percentile: number | null;
}

export interface ContestResultInput {
  sport: string;
  contestDate: string;
  contestType: string;
  contestId?: string | null;
  optimizerRank: number;
  fieldSize: number;
  entryFee: number;
  finishRank: number;
  payout: number;
  entryCount?: number;
  actualDuplicates?: number;
}

export async function getLineupScoreboard(sport: string, days = 30): Promise<LineupScoreboardRow[]> {
  const { data, error } = await supabase.rpc('fantasy_ai_get_lineup_scoreboard', {
    p_sport: sport,
    p_days: days,
  });

  if (error) throw error;
  return Array.isArray(data) ? data as LineupScoreboardRow[] : [];
}

export async function recordContestResult(input: ContestResultInput): Promise<number> {
  const { data, error } = await supabase.rpc('fantasy_ai_record_contest_result', {
    p_sport: input.sport,
    p_contest_date: input.contestDate,
    p_contest_type: input.contestType,
    p_contest_id: input.contestId ?? '',
    p_optimizer_rank: input.optimizerRank,
    p_field_size: input.fieldSize,
    p_entry_fee: input.entryFee,
    p_finish_rank: input.finishRank,
    p_payout: input.payout,
    p_entry_count: input.entryCount ?? null,
    p_actual_duplicates: input.actualDuplicates ?? null,
  });

  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
