export interface AdaptiveRankingProfile {
  sport: string;
  contest_type: string;
  sample_size: number;
  projected_correlation: number | null;
  simulation_ev_correlation: number | null;
  ceiling_correlation: number | null;
  floor_correlation: number | null;
  win_rate_correlation: number | null;
  leverage_correlation: number | null;
  stack_quality_correlation: number | null;
  context_edge_correlation: number | null;
  confidence_correlation: number | null;
  rank_score_correlation: number | null;
  ready: boolean;
}

export function clampCorrelation(value: number | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(-1, Math.min(1, parsed)) : fallback;
}

/**
 * Converts realized feature correlations into a deliberately small adjustment.
 * The profile is only used after the SQL RPC has met its sample threshold.
 * Keeping the adjustment bounded protects the optimizer from sparse/noisy slates.
 */
export function adaptiveWeight(
  featureCorrelation: number | null | undefined,
  rankCorrelation: number | null | undefined,
  sampleSize: number,
): number {
  if (sampleSize < 30) return 1;
  const strength = Math.min(0.35, Math.max(0, sampleSize - 30) / 300);
  const delta = clampCorrelation(featureCorrelation) - clampCorrelation(rankCorrelation);
  return Math.max(0.8, Math.min(1.2, 1 + delta * strength));
}

export function adaptiveRankComponents(
  profile: AdaptiveRankingProfile | null | undefined,
  values: {
    projected: number;
    simulationEv: number;
    ceiling: number;
    floor: number;
    winRate: number;
    leverage: number;
    stackQuality: number;
    contextEdge: number;
    confidence: number;
  },
) {
  if (!profile?.ready) return values;
  const rank = profile.rank_score_correlation;
  return {
    projected: values.projected * adaptiveWeight(profile.projected_correlation, rank, profile.sample_size),
    simulationEv: values.simulationEv * adaptiveWeight(profile.simulation_ev_correlation, rank, profile.sample_size),
    ceiling: values.ceiling * adaptiveWeight(profile.ceiling_correlation, rank, profile.sample_size),
    floor: values.floor * adaptiveWeight(profile.floor_correlation, rank, profile.sample_size),
    winRate: values.winRate * adaptiveWeight(profile.win_rate_correlation, rank, profile.sample_size),
    leverage: values.leverage * adaptiveWeight(profile.leverage_correlation, rank, profile.sample_size),
    stackQuality: values.stackQuality * adaptiveWeight(profile.stack_quality_correlation, rank, profile.sample_size),
    contextEdge: values.contextEdge * adaptiveWeight(profile.context_edge_correlation, rank, profile.sample_size),
    confidence: values.confidence * adaptiveWeight(profile.confidence_correlation, rank, profile.sample_size),
  };
}
