export type LiveGameState = 'unlocked' | 'locked' | 'started' | 'final' | 'postponed';
export interface LiveSlatePlayerState {
  player_id?: string; player_name: string; team?: string; game_id?: string;
  game_state: LiveGameState; player_state: 'active' | 'inactive' | 'out' | 'doubtful' | 'questionable' | 'started' | 'final' | 'postponed';
  accrued_points?: number; source: string; source_reliability: number; observed_at: string;
}
export interface SwapLineup { players: Array<{ player_id?: string; name?: string; roster_slot?: string }>; top_n_rate?: number; duplicate_adjusted_expected_payout?: number; simulation_uncertainty?: number; }

// Only these provenance tiers may enter a WNBA late-swap decision. The caller can
// report a lower confidence, but never elevate a source above its assigned tier.
export const WNBA_LIVE_SOURCE_RELIABILITY: Record<string, number> = {
  'official_team': 1,
  'official_league': 1,
  'draftkings': 0.95,
  'confirmed_lineup_provider': 0.9,
  'reputable_news': 0.75,
};

export function sourceReliability(source: string, reported: number): number | undefined {
  const ceiling = WNBA_LIVE_SOURCE_RELIABILITY[source];
  if (ceiling === undefined || !Number.isFinite(reported) || reported < 0 || reported > 1) return undefined;
  return Math.min(ceiling, reported);
}

export function normalizedPlayerName(value: string | undefined): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function lockedPlayersFromState(lineup: SwapLineup, states: LiveSlatePlayerState[]): string[] {
  const byName = new Map(states.map((state) => [normalizedPlayerName(state.player_name), state]));
  return lineup.players.filter((player) => {
    const state = byName.get(normalizedPlayerName(player.name));
    return state && ['locked', 'started', 'final', 'postponed'].includes(state.game_state);
  }).map((player) => String(player.name));
}

export function changedInputs(states: LiveSlatePlayerState[]): string[] {
  return states.flatMap((state) => {
    if (state.source_reliability < 0.7) return [`${state.player_name}: update source is not sufficiently reliable`];
    if (['inactive', 'out', 'doubtful', 'postponed'].includes(state.player_state)) return [`${state.player_name}: ${state.player_state} update`];
    if (state.player_state === 'questionable') return [`${state.player_name}: availability uncertainty changed`];
    return [];
  });
}

export function materialSwapAdvantage(original: SwapLineup, candidate: SwapLineup): boolean {
  const originalValue = Number(original.duplicate_adjusted_expected_payout ?? 0) + Number(original.top_n_rate ?? 0);
  const candidateValue = Number(candidate.duplicate_adjusted_expected_payout ?? 0) + Number(candidate.top_n_rate ?? 0);
  const noise = Math.max(Number(original.simulation_uncertainty ?? 0), Number(candidate.simulation_uncertainty ?? 0)) * 2;
  return candidateValue - originalValue > noise;
}

export function preservesLockedSlots(original: SwapLineup, candidate: SwapLineup, lockedNames: string[]): boolean {
  const originalSlots = new Map(original.players.map((player) => [normalizedPlayerName(player.name), player.roster_slot]));
  const candidateSlots = new Map(candidate.players.map((player) => [normalizedPlayerName(player.name), player.roster_slot]));
  return lockedNames.every((name) => originalSlots.get(normalizedPlayerName(name)) === candidateSlots.get(normalizedPlayerName(name)));
}
