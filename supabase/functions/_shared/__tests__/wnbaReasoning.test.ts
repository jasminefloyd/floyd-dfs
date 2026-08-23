import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildWnbaDecisionFeatures, buildWnbaGameScripts, explainWnbaRole } from '../wnbaReasoning.ts';

Deno.test('WNBA reasoning identifies injury-contingent replacement opportunity', () => {
  const player = {
    name: 'Replacement Guard', team: 'NYL', position: 'PG', confirmed_starter: true,
    minutes_projection: 28, role_stability: 0.72, usage_rate: 0.25,
    minutes_distribution: { p10: 22, p50: 28, p90: 34, standardDeviation: 3.5, didNotPlayProbability: 0.02 },
    wnba_role_prior: { cohort: 'elevated', replacementMinutesGain: 7, didNotPlayProbability: 0.02 },
    role_counterfactual: ['replaces Starting Guard'],
    implied_total: 86, spread: -2,
    wnba_component_projection: { assists: 5, rebounds: 4 },
  };
  const features = buildWnbaDecisionFeatures(player, [player]);
  assertEquals(features.role, 'replacement');
  assert(features.injury_replacement.is_contingent);
  assertEquals(features.injury_replacement.minutes_gain, 7);
  assert(explainWnbaRole(player, features).includes('injury-contingent'));
});

Deno.test('WNBA scripts include replacement and overtime branches', () => {
  const scripts = buildWnbaGameScripts([{ game_id: 'g1', home_team: 'NYL', away_team: 'LVA', total: 86, spread: -3 }], [{ role_counterfactual: ['replaces Starter'], wnba_role_prior: { cohort: 'elevated' } }], ['source:vegas']);
  assert(scripts.some((script) => script.script_key === 'wnba_injury_replacement'));
  assert(scripts.some((script) => script.script_key === 'wnba_overtime_ceiling'));
  assert(Math.abs(scripts.reduce((sum, script) => sum + script.probability, 0) - 1) < 0.001);
});
