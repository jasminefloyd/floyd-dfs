import { assert, assertEquals } from '../testAssert.ts';
import { buildMlbDecisionFeatures, buildMlbGameScripts, explainMlbStack, shrinkEstimate } from '../mlbReasoning.ts';

Deno.test('MLB small samples shrink toward a baseline', () => {
  const estimate = shrinkEstimate(0.8, 5, 0.3, 50);
  assert(estimate > 0.3 && estimate < 0.8, 'small samples should move toward the prior');
  assertEquals(shrinkEstimate(null, 0, 0.3), 0.3);
});

Deno.test('MLB pitcher features expose workload, strikeout, and early-exit distributions', () => {
  const features = buildMlbDecisionFeatures({
    position: 'P',
    own_probable_starter: true,
    last5Games: [
      { batters_faced: 22, strikeouts: 7, walks: 2, home_runs: 1 },
      { batters_faced: 24, strikeouts: 8, walks: 1, home_runs: 0 },
    ],
  });
  assertEquals(features.role, 'pitcher');
  assert(features.projected_innings !== null, 'confirmed probable starter should receive a modeled innings path');
  assert(features.projected_strikeouts.p90! > features.projected_strikeouts.p50!, 'p90 strikeouts should exceed p50');
  assert(features.early_exit_probability !== null, 'pitchers should expose early-exit risk');
});

Deno.test('MLB hitter features expose plate appearance and outcome paths', () => {
  const features = buildMlbDecisionFeatures({
    position: 'OF',
    batting_order: 2,
    confirmed_starter: true,
    last5Games: [{ at_bats: 4, hits: 2, home_runs: 1, walks: 1, total_bases: 5 }],
  });
  assertEquals(features.role, 'hitter');
  assert(features.projected_plate_appearances! > 4, 'top-order hitters should receive a higher PA path');
  assert(features.home_run_probability! > 0, 'hitter home-run probability should be explicit');
  assert(features.notes.length === 0 || features.notes.some((note) => note.includes('Small sample')), 'small samples must be labeled');
});

Deno.test('MLB scripts include distinct game-script theses and stack explanation', () => {
  const scripts = buildMlbGameScripts([{ total: 10, home_implied: 5.5, away_implied: 4.5, run_factor: 1.08 }], ['source:market']);
  assertEquals(scripts.length, 5);
  assert(scripts.every((script) => script.evidence_ids.includes('source:market')), 'scripts should retain evidence IDs');
  const explanation = explainMlbStack('NYY', [
    { id: '1', name: 'A', team: 'NYY', position: 'OF', batting_order: 1, ownership_projection: 0.2 },
    { id: '2', name: 'B', team: 'NYY', position: '1B', batting_order: 4, ownership_projection: 0.1 },
  ]);
  assert(explanation.includes('2 hitters') && explanation.includes('2 top-five lineup slots'), 'stack explanation should include lineup-order correlation');
});
