import { contestObjective, duplicateAdjustedPayout, objectiveScore, simulationUncertainty } from '../contestObjective.ts';
function assert(value: boolean, message: string) { if (!value) throw new Error(message); }
Deno.test('contest objectives are explicit and projection max remains separate', () => {
  assert(contestObjective('cash', 'safe', false) === 'cash_floor_v1', 'cash objective mismatch');
  assert(contestObjective('large_field_gpp', 'tournament', false) === 'large_field_portfolio_top20_v1', 'large field objective mismatch');
  assert(contestObjective('showdown', 'tournament', true) === 'showdown_script_roi_v1', 'showdown objective mismatch');
  assert(contestObjective('cash', 'max_fpts', false) === 'projection_max_v1', 'projection max must stay separate');
});
Deno.test('duplicate-adjusted objective penalizes common lineups and exposes uncertainty', () => {
  assert(duplicateAdjustedPayout(1, 4) === 0.2, 'payout should split over expected duplicates');
  assert(simulationUncertainty(0.1, 1000) > 0, 'uncertainty should be positive');
  const rare = objectiveScore({ objective: 'single_entry_top20_roi_v1', projected: 100, floor: 70, confidence: 0.8, topNRate: 0.15, winRate: 0.03, expectedPayout: 1, expectedDuplicates: 0, uncertainty: 0.01 });
  const duplicated = objectiveScore({ objective: 'single_entry_top20_roi_v1', projected: 100, floor: 70, confidence: 0.8, topNRate: 0.15, winRate: 0.03, expectedPayout: 1, expectedDuplicates: 8, uncertainty: 0.01 });
  assert(rare > duplicated, 'duplicate risk must lower the tournament objective');
});
