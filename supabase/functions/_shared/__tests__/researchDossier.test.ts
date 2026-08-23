import { assertEquals } from '../testAssert.ts';
import { buildDataGaps, buildGenericScripts, buildMatchupEdges, buildPrelockChecklist, buildPlayerHierarchy, buildSlateRisks, corroborationGaps, detectContradictions, enrichGameScripts, evidenceForSourceHealth, sourcePolicy } from '../researchDossier.ts';

Deno.test('source policy is data-type aware', () => {
  assertEquals(sourcePolicy('draftkings_salaries').kind, 'official');
  assertEquals(sourcePolicy('reddit_sentiment').kind, 'community');
  assertEquals(sourcePolicy('reddit_sentiment').reliability, 0.25);
});

Deno.test('source evidence captures freshness and coverage', () => {
  const evidence = evidenceForSourceHealth({
    ownership_projections: { status: 'partial', observed_at: '2026-08-22T12:00:00.000Z', freshness_seconds: 60, coverage: { matched: 8, total: 10, percent: 80 }, data_class: 'live' },
  });
  assertEquals(evidence.length, 1);
  assertEquals(evidence[0].normalized_fact?.freshness, 'fresh');
  assertEquals(evidence[0].normalized_fact?.coverage, { matched: 8, total: 10, percent: 80 });
});

Deno.test('hierarchy and generic scripts are deterministic', () => {
  const hierarchy = buildPlayerHierarchy([
    { player_id: 'star', player_name: 'Star', median: 25, p75: 30, p90: 38, p95: 42, floor: 15, boom_probability: 0.3, bust_probability: 0.1, salary_efficiency: 0.004, eligibility: ['UTIL'], expected_opportunity: {}, matchup_edge: 0.2, news_role_edge: 0.1, ownership: 0.2, leverage: 0.8, evidence_ids: ['a'], freshness_seconds: 60 },
    { player_id: 'value', player_name: 'Value', median: 12, p75: 18, p90: 24, p95: 28, floor: 5, boom_probability: 0.2, bust_probability: 0.2, salary_efficiency: 0.005, eligibility: ['UTIL'], expected_opportunity: {}, matchup_edge: 0, news_role_edge: 0, ownership: 0.1, leverage: 0.9, evidence_ids: ['b'], freshness_seconds: 60 },
  ]);
  assertEquals(hierarchy['A+'], ['star']);
  assertEquals(hierarchy.value, ['value']);
  assertEquals(buildGenericScripts({ sport: 'mlb', contest_type: 'classic', market_context: { total: 8 }, observability: {} as never }, ['source:a']).length, 3);
});

Deno.test('data gaps and contradictions are explicit', () => {
  const gaps = buildDataGaps({ salaries: { status: 'unavailable', observed_at: null, freshness_seconds: null }, odds: { status: 'partial', observed_at: null, freshness_seconds: null } }, ['salaries']);
  assertEquals(gaps.map((gap) => gap.required), [true, false]);
  const contradictions = detectContradictions([
    { evidence_id: 'a', source: 'draftkings_salaries', fact: 'Player active', normalized_fact: { fact_key: 'player-1:status', status: 'active' }, is_modeled: false },
    { evidence_id: 'b', source: 'espn_news', fact: 'Player out', normalized_fact: { fact_key: 'player-1:status', status: 'out' }, is_modeled: false },
  ]);
  assertEquals(contradictions.length, 1);
  assertEquals(contradictions[0].severity, 'high');
});

Deno.test('research presentation exposes matchup edges, risks, corroboration, and pre-lock checklist', () => {
  const profiles = [{ player_id: 'p1', player_name: 'Player', median: 20, p75: 25, p90: 30, p95: 32, floor: 10, boom_probability: 0.2, bust_probability: 0.1, salary_efficiency: 0.004, eligibility: ['UTIL'], expected_opportunity: {}, matchup_edge: 0.4, news_role_edge: 0, ownership: 0.2, leverage: 0.8, evidence_ids: ['e1'], freshness_seconds: 60 }];
  const scripts = enrichGameScripts(buildGenericScripts({ sport: 'mlb', contest_type: 'showdown', market_context: { odds: true }, observability: {} as never }, ['e1']), 'mlb');
  const gaps = buildDataGaps({ ownership: { status: 'unavailable', observed_at: null, freshness_seconds: null } }, ['ownership']);
  if (buildMatchupEdges(profiles).length !== 1 || !buildSlateRisks({ data_gaps: gaps, contradictions: [], game_scripts: scripts }).length || !buildPrelockChecklist(gaps).length) throw new Error('Expected research presentation metadata');
  if (!corroborationGaps([{ evidence_id: 'e1', source: 'news', normalized_fact: { fact_key: 'p1', impact_type: 'injury' }, is_modeled: false }]).length) throw new Error('Expected corroboration gap');
});
