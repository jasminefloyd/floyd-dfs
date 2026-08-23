import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildSportDecisionFeatures, buildSportGameScripts } from '../sportReasoning.ts';

Deno.test('NBA reasoning creates replacement, uncertainty, and distribution features', () => {
  const features = buildSportDecisionFeatures('nba', {
    name: 'Creator', position: 'PG', team: 'AAA', projected_points: 38, stdev_fantasy_pts: 8,
    injury_status: 'questionable', confirmed_starter: true, usage_rate: 0.28, spread: -10, implied_total: 118,
  }, [{ name: 'Absent Star', team: 'AAA', injury_status: 'out' }]);
  assertEquals(features.role, 'injury_replacement');
  assert(features.distribution.p90! > features.distribution.p50!);
  assert(features.uncertainty.length >= 1);
  assert(features.correlation_tags.includes('injury_on_off_contingency'));
});

Deno.test('NFL and golf scripts expose sport-specific branches', () => {
  const nfl = buildSportGameScripts('nfl', [{ total: 51, spread: 3 }], [{ injury_status: 'active' }], ['source:market']);
  const golf = buildSportGameScripts('golf', [], [{ tee_time: '2026-08-22T12:00:00Z', golf_wave: 'pm' }], ['source:field']);
  assert(nfl.some((script) => script.script_key === 'nfl_shootout_stack'));
  assert(nfl.some((script) => script.script_key === 'nfl_weather_rushing'));
  assert(golf.some((script) => script.script_key === 'golf_windy_wave'));
  assert(Math.abs(golf.reduce((sum, script) => sum + script.probability, 0) - 1) < 0.001);
});
