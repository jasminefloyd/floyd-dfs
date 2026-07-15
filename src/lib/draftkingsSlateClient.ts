import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';

export interface DraftKingsSlate {
  contest_id: string;
  external_contest_id: string | null;
  sport: string;
  contest_type: string;
  contest_date: string;
  slate_name: string;
  game_ids: string[];
  salary_cap: number;
  status: string | null;
  start_time: string | null;
  salary_count: number;
  data: Record<string, unknown>;
  updated_at: string;
}

interface SlateDiscoveryResponse {
  slates: DraftKingsSlate[];
  generated_at: string;
}

interface SlateDiscoveryError {
  error?: string;
}

export async function listDraftKingsSlates(
  params: { sport: string; contestType: string },
  signal?: AbortSignal,
): Promise<DraftKingsSlate[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required to discover DraftKings slates.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? supabaseAnonKey;
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/draftkings-slates`;

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sport: params.sport,
      contestType: params.contestType,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('DraftKings slate discovery did not return JSON.');
  }

  const data = await response.json() as SlateDiscoveryResponse | SlateDiscoveryError;
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : `DraftKings slate discovery failed: ${response.status}`);
  }

  return 'slates' in data ? data.slates : [];
}
