import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';

export interface PrelockPassRequest {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  userId?: string;
  lockTime?: string;
  slate?: Record<string, unknown>;
  previousDossier?: Record<string, unknown> | null;
  priorLineupIds?: string[];
  piosConfig?: Record<string, unknown>;
  runNow?: boolean;
}

export async function runFantasyPrelockPass(input: PrelockPassRequest) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase URL and anon key are required for the pre-lock pass.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? supabaseAnonKey;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/fantasy-prelock-pass`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, userId: input.userId ?? data.session?.user.id }),
  });
  const payload = await response.json() as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(payload.error ?? `Pre-lock pass failed: ${response.status}`);
  return payload;
}
