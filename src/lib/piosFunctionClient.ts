import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import type { MIOS_FantasyManifest } from './MIOS_FantasyAgents';
import type { DraftLineup } from './PIOS_FantasyGenerator';

export interface PiosLineupRequest {
  manifest: MIOS_FantasyManifest;
  sport: string;
  contestType: string;
  excludedPlayers: string[];
  riskTolerance: string;
  lineupMode: string;
  contestStrategy: string;
  maxPlayerExposure: number;
  maxTeamExposure: number;
  minPrimaryStack: number;
  diversifyLineups: boolean;
  lateSwapMode: boolean;
}

interface PiosFunctionResponse {
  lineups: DraftLineup[];
  data_warnings?: string[];
  contest_id?: string | null;
  game_id?: string | null;
}

interface PiosFunctionError {
  error?: string;
}

export async function invokePiosLineupGeneration(
  params: PiosLineupRequest,
  signal?: AbortSignal
): Promise<PiosFunctionResponse> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required to call PIOS_Fantasy.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token ?? supabaseAnonKey;
  const userId = sessionData.session?.user.id;
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/generate-pios-lineups`;

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      manifestId: params.manifest.manifest_id,
      sport: params.sport,
      contestType: params.contestType,
      contestDate: params.manifest.contest_date,
      contestId: params.manifest.contest_id,
      gameId: params.manifest.game_id,
      slate: params.manifest.slate,
      playerRoster: params.manifest.player_roster,
      excludedPlayers: params.excludedPlayers,
      riskTolerance: params.riskTolerance,
      lineupMode: params.lineupMode,
      contestStrategy: params.contestStrategy,
      maxPlayerExposure: params.maxPlayerExposure,
      maxTeamExposure: params.maxTeamExposure,
      minPrimaryStack: params.minPrimaryStack,
      diversifyLineups: params.diversifyLineups,
      lateSwapMode: params.lateSwapMode,
      userId,
    }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const responseText = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(`PIOS_Fantasy Edge Function did not return JSON (${response.status}): ${responseText.slice(0, 280)}`);
  }

  const data = responseText ? JSON.parse(responseText) as PiosFunctionResponse | PiosFunctionError : {};
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : `PIOS_Fantasy generation failed: ${response.status}: ${responseText.slice(0, 280)}`);
  }

  return data as PiosFunctionResponse;
}
