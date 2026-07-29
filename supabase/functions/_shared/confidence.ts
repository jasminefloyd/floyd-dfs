export interface ConfidencePlayer {
  confidence_score?: number;
  injury_status?: string;
}

/** Confidence is based on data confidence and injury status, never salary utilization. */
export function calculateLineupConfidence(players: ReadonlyArray<ConfidencePlayer>): number {
  if (!players.length) return 0;
  const avgConfidence = players.reduce((sum, player) => sum + (player.confidence_score ?? 0.5), 0) / players.length;
  const injuryCount = players.filter((player) => player.injury_status !== 'active').length;
  return Math.min(Math.max(avgConfidence - injuryCount * 0.05, 0), 1);
}
