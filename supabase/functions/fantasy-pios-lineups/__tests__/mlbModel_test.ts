import { assert, assertEquals } from '../../_shared/testAssert.ts';
import { buildMlbProxyDistribution, buildMlbProxyStacks } from '../mlbModel.ts';
import type { MlbDecisionFeatures } from '../../_shared/mlbReasoning.ts';

const pitcherFeatures: MlbDecisionFeatures = {
  version: 'mlb-reasoning-v1' as const,
  role: 'pitcher' as const,
  season: { sample_size: 10 }, recent: { sample_size: 5 }, injury_adjusted: { sample_size: 10 }, pitch_type_edges: {},
  projected_plate_appearances: null, projected_innings: 5.2, projected_strikeouts: { p10: 3, p50: 6, p90: 10 },
  early_exit_probability: 0.15, times_through_order_risk: 0.2, home_run_probability: null, hit_probability: null,
  double_probability: null, rbi_probability: null, run_probability: null, walk_probability: null, stolen_base_probability: null,
  matchup_edge: 0.4, shrinkage_weight: 0.6, notes: [], source: 'observed_and_shrunk' as const,
};

Deno.test('MLB proxy distribution uses feature-based ceiling and workload volatility', () => {
  const distribution = buildMlbProxyDistribution({ player_id: 'p1', position: 'P', projected_points: 20, mlb_decision_features: pitcherFeatures });
  assert(distribution.p95 > distribution.p90 && distribution.p90 > distribution.mean, 'pitcher quantiles should be ordered');
  assert(distribution.stdev > 0, 'distribution should expose uncertainty');
});

Deno.test('MLB stacks include batting-order and matchup explanation inputs', () => {
  const stacks = buildMlbProxyStacks([
    { player_id: 'h1', team: 'AAA', position: 'OF', projected_points: 12, batting_order: 1, ownership_projection: 0.2, mlb_decision_features: { ...pitcherFeatures, role: 'hitter', projected_innings: null, projected_plate_appearances: 4.8, projected_strikeouts: { p10: null, p50: null, p90: null }, matchup_edge: 0.5 } },
    { player_id: 'h2', team: 'AAA', position: '1B', projected_points: 10, batting_order: 4, ownership_projection: 0.1, mlb_decision_features: { ...pitcherFeatures, role: 'hitter', projected_innings: null, projected_plate_appearances: 4.2, projected_strikeouts: { p10: null, p50: null, p90: null }, matchup_edge: 0.2 } },
  ]);
  assertEquals(stacks.length, 1);
  assert(stacks[0].stack_score > 0, 'stack score should be positive');
});
