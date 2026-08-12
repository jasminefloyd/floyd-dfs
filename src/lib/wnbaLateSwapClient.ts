import { supabase, supabaseAnonKey, supabaseUrl } from './supabaseClient';
import type { DraftLineup } from './PIOS_FantasyGenerator';
import type { MIOS_FantasyManifest } from './MIOS_FantasyAgents';

export interface WnbaLiveState {
  player_name: string; player_id?: string; team?: string; game_id?: string;
  game_state: 'unlocked' | 'locked' | 'started' | 'final' | 'postponed';
  player_state: 'active' | 'inactive' | 'out' | 'doubtful' | 'questionable' | 'started' | 'final' | 'postponed';
  accrued_points?: number; source: string; source_reliability: number; observed_at: string;
}

export async function optimizeWnbaLateSwap(input: { manifest: MIOS_FantasyManifest; originalLineups: DraftLineup[]; liveState: WnbaLiveState[]; config: Record<string, unknown> }) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase URL and anon key are required for late swap.');
  const { data } = await supabase.auth.getSession(); const token = data.session?.access_token ?? supabaseAnonKey;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/optimize-wnba-late-swap`, { method: 'POST', headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: input.manifest.snapshot_id, contestDate: input.manifest.contest_date, contestType: input.manifest.contest_type, contestId: input.manifest.contest_id, userId: data.session?.user.id, originalLineups: input.originalLineups, playerRoster: input.manifest.player_roster, slate: input.manifest.slate, liveState: input.liveState, config: input.config }) });
  const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? `Late-swap request failed: ${response.status}`); return payload;
}
