export type ContestObjective = 'projection_max_v1' | 'cash_floor_v1' | 'single_entry_top20_roi_v1' | 'large_field_portfolio_top20_v1' | 'showdown_script_roi_v1';

export function contestObjective(strategy: string, lineupMode: string, showdown: boolean): ContestObjective {
  if (lineupMode === 'max_fpts') return 'projection_max_v1';
  if (lineupMode === 'safe' || strategy === 'cash') return 'cash_floor_v1';
  if (showdown || strategy === 'showdown') return 'showdown_script_roi_v1';
  return strategy === 'large_field_gpp' ? 'large_field_portfolio_top20_v1' : 'single_entry_top20_roi_v1';
}
export function duplicateAdjustedPayout(expectedPayout: number, expectedDuplicates: number): number { return expectedPayout / Math.max(1, 1 + Math.max(0, expectedDuplicates)); }
export function simulationUncertainty(topNRate: number, iterations: number): number { const p = Math.min(1, Math.max(0, topNRate)); return Math.sqrt((p * (1 - p)) / Math.max(iterations, 1)); }
export function objectiveScore(input: { objective: ContestObjective; projected: number; floor: number; confidence: number; topNRate: number; winRate: number; expectedPayout: number; expectedDuplicates: number; duplicateAdjustedExpectedPayout?: number; uncertainty: number }): number {
  const payout = input.duplicateAdjustedExpectedPayout ?? duplicateAdjustedPayout(input.expectedPayout, input.expectedDuplicates);
  if (input.objective === 'projection_max_v1') return input.projected;
  if (input.objective === 'cash_floor_v1') return input.floor * 1.6 + input.confidence * 10 + input.projected * 0.35;
  if (input.objective === 'large_field_portfolio_top20_v1') return input.topNRate * 10_000 + payout * 7_000 + input.winRate * 1_500 - input.uncertainty * 2_000;
  if (input.objective === 'showdown_script_roi_v1') return payout * 10_000 + input.topNRate * 7_500 + input.winRate * 1_800 - input.uncertainty * 2_000;
  return payout * 9_000 + input.topNRate * 8_000 + input.winRate * 1_000 - input.uncertainty * 2_000;
}
