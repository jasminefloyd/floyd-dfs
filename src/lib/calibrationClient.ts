import { supabase } from './supabaseClient';

export interface ProjectionCalibration {
  sport: string;
  sample_size: number;
  avg_projection_error: number | null;
  avg_absolute_error: number | null;
  projection_bias_multiplier: number | null;
}

export async function getProjectionCalibration(sport: string): Promise<ProjectionCalibration | null> {
  const { data, error } = await supabase.rpc('fantasy_ai_projection_calibration', {
    p_sport: sport,
    p_days: 45,
  });

  if (error) throw error;
  const rows = Array.isArray(data) ? data as ProjectionCalibration[] : [];
  return rows[0] ?? null;
}
