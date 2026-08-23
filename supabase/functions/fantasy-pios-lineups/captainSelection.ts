export interface CaptainCandidate {
  player_id: string;
  name: string;
  confidence_score: number;
}

// A captain's projection gets amplified 1.5x -- exactly where an unreliable projection
// does the most damage. 0.45 is the hardcoded confidence value used elsewhere in this
// codebase for a player with no real recent-game data (synthetic fallback only), so this
// floor excludes exactly that tier while still allowing anything backed by real signal.
export const MIN_CAPTAIN_CONFIDENCE = 0.5;

// Skip the confidence floor entirely when the user gave an explicit captain pool -- that's
// a deliberate override and should win. Otherwise, fall back to the full player list if
// the floor would leave zero eligible captains (a slate with uniformly poor data
// shouldn't produce zero lineups) rather than silently degrading quality.
export function selectCaptainCandidates<T extends CaptainCandidate>(
  players: T[],
  hasExplicitCaptainPool: boolean,
  minConfidence: number = MIN_CAPTAIN_CONFIDENCE,
): T[] {
  if (hasExplicitCaptainPool) return players;
  const confidentPlayers = players.filter((player) => player.confidence_score >= minConfidence);
  return confidentPlayers.length ? confidentPlayers : players;
}
