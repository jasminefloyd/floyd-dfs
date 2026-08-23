import { compareCaptains, comparePlayers, comparePortfolios, compareScripts, shadowPromotionGate } from '../learningAnalysis.ts';

const lineups = [
  { id: 'l1', sport: 'wnba', contest_date: '2026-08-22', contest_type: 'showdown', contest_strategy: 'tournament', players: [{ player_id: 'p1', player_name: 'A', roster_slot: 'CPT', projected_points: 30, actual_points: 36, ownership_projection: 0.2, actual_ownership: 0.25 }], projected_points: 30, actual_points: 36, payout: 20, config: { script_key: 'close_game' } },
  { id: 'l2', sport: 'wnba', contest_date: '2026-08-22', contest_type: 'showdown', contest_strategy: 'tournament', players: [{ player_id: 'p1', player_name: 'A', roster_slot: 'FLEX', projected_points: 20, actual_points: 18, ownership_projection: 0.2, actual_ownership: 0.25 }], projected_points: 20, actual_points: 18, payout: 0, config: { script_key: 'favorite_control' } },
];

Deno.test('learning analysis compares players, Captains, and portfolios', () => {
  if (comparePlayers(lineups).length !== 1) throw new Error('Expected one player comparison');
  if (compareCaptains(lineups).samples !== 1) throw new Error('Expected one Captain sample');
  if (comparePortfolios(lineups)[0]?.script_count !== 2) throw new Error('Expected two portfolio scripts');
  if (compareScripts(lineups).length !== 2) throw new Error('Expected two script comparisons');
});

Deno.test('shadow promotion requires sample and improvement gates', () => {
  if (shadowPromotionGate({ candidateSamples: 10, candidateScore: 0.9, baselineScore: 0.8 }).status !== 'shadow_only') throw new Error('Insufficient samples should remain shadow-only');
  if (shadowPromotionGate({ candidateSamples: 30, candidateScore: 0.83, baselineScore: 0.8 }).status !== 'eligible') throw new Error('Qualified candidate should be eligible');
});
