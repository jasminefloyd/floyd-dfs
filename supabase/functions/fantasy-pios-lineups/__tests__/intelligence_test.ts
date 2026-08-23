import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deriveFormMetrics, deriveNewsEvidence, deriveRelationships, deriveScenario, evaluateRelationship } from '../intelligence.ts';

Deno.test('PIOS form metrics are recency weighted and expose sample size', () => {
  const result = deriveFormMetrics({ games: [{ fantasy_points: 30 }, { fantasy_points: 20 }, { fantasy_points: 10 }, { fantasy_points: 10 }, { fantasy_points: 10 }] }, 'nba', 'PG');
  assertEquals(result.last_3_avg, 20);
  assertEquals(result.trend, 'up');
  assertEquals(result.sample_size, 5);
  assertEquals(result.is_synthetic, false);
});

Deno.test('PIOS calculates DraftKings fantasy points from raw game logs', () => {
  const result = deriveFormMetrics({ games: [{ date: '2026-08-02', points: 20, rebounds: 8, assists: 6, steals: 1, blocks: 0, turnovers: 2 }] }, 'nba', 'PG');
  assertEquals(result.last_3_avg, 40);
  assertEquals(result.is_synthetic, false);
});

Deno.test('PIOS news evidence does not treat an unconfirmed note as fact', () => {
  const result = deriveNewsEvidence(1, 'Rumor: minutes may increase');
  assertEquals(result.confirmed, false);
  assertEquals(result.is_speculative, true);
  assertEquals(result.impact_type, 'role');
});

Deno.test('PIOS derives sport-specific relationships without claiming validation', () => {
  const result = deriveRelationships([
    { id: 'qb', team: 'A', position: 'QB', game_id: 'g1' },
    { id: 'wr', team: 'A', position: 'WR', game_id: 'g1' },
  ], 'nfl');
  assertEquals(result[0].type, 'stack');
  assertEquals(result[0].validated, false);
  assertEquals(result[0].sample_size, 0);
});

Deno.test('PIOS scenario uses structured game environment evidence', () => {
  const result = deriveScenario([{ implied_total: 50, spread: 2 }], 'nfl');
  assertEquals(result.key, 'high_total');
  assertEquals(result.evidence.length > 0, true);
});

Deno.test('PIOS relationship evaluation requires a real paired sample', () => {
  const result = evaluateRelationship(0.25, [1, 2, 3], [1, 2, 3]);
  assertEquals(result.status, 'insufficient_sample');
  assertEquals(result.realized_correlation, null);
});
