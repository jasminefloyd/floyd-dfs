import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFeatureFlags } from '../../server/featureFlags.js';
import { buildOperationsSnapshot } from '../../server/operationsSnapshot.js';
import { cors, method, requireOperator, respondError, tenantContext } from '../../server/runtime.js';

/** Tenant-scoped operator dashboard; API cost, quota, and unavailable telemetry are never inferred. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(req); requireOperator(context);
    const now = new Date(); const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
    const [collections, scheduleSync, schedule, generationRuns, houseReports, evaluations, results, lineups, incidents] = await Promise.all([
      context.db.from('floyd_dfs_intel_collection_runs').select('id,status,idempotency_key,started_at,finished_at,result,error_code').eq('tenant_id', context.tenantId).eq('sport', 'NBA').eq('provider', 'SPORTSDATAIO').gte('started_at', since).order('started_at', { ascending: false }).limit(500),
      context.db.from('floyd_dfs_nba_schedule_sync_state').select('last_attempt_at,last_success_at,next_due_at,last_error,game_count').eq('provider', 'ESPN').maybeSingle(),
      context.db.from('floyd_dfs_nba_game_schedule').select('provider_game_id,home_team_code,away_team_code,scheduled_start_at,status,retrieved_at').gte('scheduled_start_at', now.toISOString()).lte('scheduled_start_at', new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString()).in('status', ['SCHEDULED','IN_PROGRESS']).order('scheduled_start_at', { ascending: true }).limit(100),
      context.db.from('generation_runs').select('id,tenant_id,created_at,state,lineage').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).limit(500),
      context.db.from('floyd_dfs_house_reports').select('id,model_version,trust_status,created_at').eq('tenant_id', context.tenantId).eq('sport', 'NBA').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
      context.db.from('floyd_dfs_model_evaluations').select('id,component,model_version,candidate_model_version,gate_decision,reviewed_at,sample_count,created_at').eq('tenant_id', context.tenantId).order('created_at', { ascending: false }).limit(100),
      context.db.from('floyd_dfs_contest_results').select('id,reconciliation_status,official_outcome,model_evaluation_eligible,measured_at').eq('tenant_id', context.tenantId).gte('measured_at', new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString()).order('measured_at', { ascending: false }).limit(500),
      context.db.from('floyd_dfs_generated_lineups').select('id,status,created_at').eq('tenant_id', context.tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
      context.db.from('floyd_dfs_runtime_health_incidents').select('id,severity,component,safe_summary,first_seen_at,last_seen_at,occurrence_count,resolved_at').eq('tenant_id', context.tenantId).is('resolved_at', null).order('last_seen_at', { ascending: false }).limit(100),
    ]);
    for (const result of [collections, scheduleSync, schedule, generationRuns, houseReports, evaluations, results, lineups, incidents]) if (result.error) throw result.error;
    const configured = String(process.env.SPORTS_DATA_IO_NBA_DAILY_CALL_BUDGET ?? '').trim();
    const numericBudget = Number(configured);
    const providerCallBudget = Number.isSafeInteger(numericBudget) && numericBudget > 0 ? numericBudget : null;
    const snapshot = buildOperationsSnapshot({ now, tenantId: context.tenantId, providerCallBudget, collections: collections.data ?? [], upcomingGames: schedule.data ?? [], scheduleSync: scheduleSync.data, generationRuns: generationRuns.data ?? [], houseReports: houseReports.data ?? [], evaluations: evaluations.data ?? [], results: results.data ?? [], lineups: lineups.data ?? [], incidents: incidents.data ?? [], featureFlags: readFeatureFlags() });
    cors(req, res); res.status(200).json({ ...snapshot, sampleLimits: { collectionRuns: 500, generationRuns: 500, houseReports: 500, evaluations: 100, contestResults: 500, generatedLineups: 1000, incidents: 100 }, dataTierVerified: String(process.env.SPORTS_DATA_IO_DATA_TIER ?? '').trim().toUpperCase() === 'PRODUCTION_VERIFIED' });
  } catch (error) { respondError(req, res, error); }
}
