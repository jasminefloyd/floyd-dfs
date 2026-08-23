import { buildPrelockPassDecision, compareSourceEvidence } from '../prelockPass.ts';
import type { EvidenceRef, SlateResearchDossier } from '../../decisionContracts.ts';

const evidence = (source: string, fact: string, playerId: string): EvidenceRef => ({
  evidence_id: `${source}:${playerId}`,
  source,
  fact,
  normalized_fact: { fact_key: playerId, player_id: playerId },
  is_modeled: false,
});

const dossier = (sourceEvidence: EvidenceRef[]): SlateResearchDossier => ({
  dossier_version: 'dossier-v1', sport: 'mlb', contest_type: 'showdown', contest_date: '2026-08-22',
  generated_at: '2026-08-22T16:00:00.000Z', freshness_deadline: '2026-08-22T18:00:00.000Z',
  readiness_status: 'ready', game_environment: {}, market_context: {}, player_hierarchy: {}, game_scripts: [],
  source_evidence: sourceEvidence, data_gaps: [], confidence_summary: {}, observability: {
    request_id: 'test', generated_at: '2026-08-22T16:00:00.000Z', stages: [], source_counts: {}, fallbacks: [], candidate_counts: {}, rejection_counts: {},
  },
});

Deno.test('compareSourceEvidence reports updated and added facts', () => {
  const changes = compareSourceEvidence([evidence('lineups', 'Player active', 'p1')], [evidence('lineups', 'Player scratched', 'p1'), evidence('weather', 'Wind up', 'p2')]);
  if (changes.length !== 2 || !changes.some((change) => change.change_type === 'updated') || !changes.some((change) => change.change_type === 'added')) throw new Error('Expected source changes');
});

Deno.test('buildPrelockPassDecision schedules twelve minutes before lock and scopes rebuild', () => {
  const decision = buildPrelockPassDecision({
    previousDossier: dossier([evidence('lineups', 'Player active', 'p1')]),
    currentDossier: dossier([evidence('lineups', 'Player scratched', 'p1')]),
    lockTime: '2026-08-22T18:00:00.000Z',
    now: '2026-08-22T17:30:00.000Z',
  });
  if (decision.status !== 'ready' || decision.scheduled_for !== '2026-08-22T17:48:00.000Z' || decision.rebuild_scope !== 'affected_players_scripts_lineups' || !decision.affected_player_ids.includes('p1')) throw new Error('Unexpected pre-lock decision');
});
