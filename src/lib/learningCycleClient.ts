import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';

export interface LearningCycleRequest {
  start_date?: string;
  end_date?: string;
  sport?: string;
  include_weekly?: boolean;
  send_email?: boolean;
  shadow_evaluation?: Record<string, unknown>;
}

export async function runFantasyLearningCycle(input: LearningCycleRequest = {}) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase URL and anon key are required for the learning cycle.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? supabaseAnonKey;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/fantasy-learning-cycle`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(payload.error ?? `Learning cycle failed: ${response.status}`);
  return payload;
}
