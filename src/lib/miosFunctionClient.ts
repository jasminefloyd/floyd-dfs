import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import type { DraftKingsSlate } from './draftkingsSlateClient';
import type { MIOS_FantasyManifest } from './MIOS_FantasyAgents';

export interface MiosScanRequest {
  sport: string;
  contestType: string;
  contestDate: string;
  contestId?: string;
  gameId?: string;
  slate?: DraftKingsSlate;
}

interface MiosFunctionError {
  error?: string;
}

export async function invokeMiosFantasyScan(
  params: MiosScanRequest,
  signal?: AbortSignal
): Promise<MIOS_FantasyManifest> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required to call MIOS_Fantasy.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? supabaseAnonKey;
  const userId = sessionData.session?.user.id;
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mios-fantasy-scan`;

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
      contestDate: params.contestDate,
      contestId: params.contestId,
      gameId: params.gameId,
      slate: params.slate,
      userId,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('MIOS_Fantasy Edge Function did not return JSON.');
  }

  const data = await response.json() as MIOS_FantasyManifest | MiosFunctionError;
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : `MIOS_Fantasy scan failed: ${response.status}`);
  }

  return data as MIOS_FantasyManifest;
}
