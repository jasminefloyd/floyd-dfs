import { adaptiveRankComponents, adaptiveWeight } from '../adaptiveRanking.ts';

Deno.test('adaptive ranking stays neutral below the evidence threshold', () => {
  if (adaptiveWeight(-1, 1, 29) !== 1) throw new Error('Sparse feedback must not change weights.');
});

Deno.test('adaptive ranking favors features that outperform the current rank score', () => {
  const profile = {
    sport: 'mlb', contest_type: 'showdown', sample_size: 120,
    projected_correlation: 0.1, simulation_ev_correlation: 0.8,
    ceiling_correlation: 0.9, floor_correlation: 0.1, win_rate_correlation: 0.7,
    leverage_correlation: 0.6, stack_quality_correlation: 0.8,
    context_edge_correlation: 0.7, confidence_correlation: 0.2,
    rank_score_correlation: 0.2, ready: true,
  };
  const values = adaptiveRankComponents(profile, {
    projected: 100, simulationEv: 100, ceiling: 100, floor: 100,
    winRate: 1, leverage: 10, stackQuality: 10, contextEdge: 10, confidence: 1,
  });
  if (values.ceiling <= 100 || values.simulationEv <= 100) throw new Error('Strong realized features should gain weight.');
  if (values.projected >= 100) throw new Error('Weak realized projection ordering should lose weight.');
});
