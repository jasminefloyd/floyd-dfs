import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, method, respondError, tenantContext } from '../../server/runtime.js';

/** Compares actual DraftKings ownership and outcomes with archived pre-lock inputs. */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext(); const contestId = String(req.query.contestId ?? '').trim();
    if (!contestId) throw new Error('contestId is required.');
    const entriesResult = await context.db.from('floyd_dfs_contest_field_entries').select('external_entry_id,sport,contest_format,field_size,entry_fee,paid_positions,finish_position,actual_dk_points,payout,player_ids,finality_status').eq('tenant_id', context.tenantId).eq('contest_id', contestId).in('finality_status', ['FINAL','CORRECTED']);
    if (entriesResult.error) throw entriesResult.error;
    const entries = entriesResult.data ?? [];
    if (!entries.length) { cors(req,res); res.status(200).json({ contestId, status: 'NO_FIELD_DATA', independentContests: 0, probabilityRelease: 'DISABLED' }); return; }
    const snapshotResult = await context.db.from('floyd_dfs_run_data_snapshots').select('payload,content_sha256,source_retrieved_at').eq('tenant_id', context.tenantId).eq('snapshot_type', 'COMPLETE_RUN_EVIDENCE').limit(1000);
    if (snapshotResult.error) throw snapshotResult.error;
    const snapshot = (snapshotResult.data ?? []).map((row) => row.payload as Record<string, unknown>).find((payload) => String((payload.contestIdentity as Record<string, unknown> | undefined)?.draftKingsContestId ?? '') === contestId && (payload.timing as Record<string, unknown> | undefined)?.preLock === true);
    const slate = snapshot?.enrichedSlate as Record<string, unknown> | undefined;
    const playerPool = Array.isArray(slate?.playerPool) ? slate.playerPool as Array<Record<string, unknown>> : [];
    const counts = new Map<string,number>();
    for (const entry of entries) for (const id of new Set(Array.isArray(entry.player_ids) ? entry.player_ids.map(String) : [])) counts.set(id,(counts.get(id) ?? 0)+1);
    const fieldSize = Math.max(...entries.map((entry) => Number(entry.field_size) || 0));
    const archivedOwnership = new Map(playerPool.map((player) => { const identity = player.identity as Record<string,unknown> | undefined; const id = String(identity?.draftKingsId ?? player.playerId ?? ''); const ownership = player.projectedOwnership as Record<string,unknown> | undefined; const value = Number(ownership?.classic ?? ownership?.utility ?? ownership?.captain); return [id,Number.isFinite(value) ? value : null] as const; }));
    const ownershipPairs = [...counts].flatMap(([id,count]) => { const projected = archivedOwnership.get(id); return projected === undefined || projected === null ? [] : [{ playerId: id, actual: count / fieldSize, projected }]; });
    const actualCashRate = entries.filter((entry) => Number(entry.payout) > 0).length / entries.length;
    const meanPayout = entries.reduce((sum,entry) => sum + Number(entry.payout || 0),0) / entries.length;
    const userOutcomes = await actualCandidateOutcomes(context.db, context.tenantId, contestId);
    cors(req,res); res.status(200).json({ contestId, sport: entries[0].sport, contestFormat: entries[0].contest_format, fieldEntries: entries.length, declaredFieldSize: fieldSize, independentContests: 1, archivedPreLockSnapshotFound: Boolean(snapshot), ownership: { matchedPlayers: ownershipPairs.length, meanAbsoluteError: ownershipPairs.length ? ownershipPairs.reduce((sum,pair) => sum + Math.abs(pair.projected - pair.actual),0) / ownershipPairs.length : null, meanBias: ownershipPairs.length ? ownershipPairs.reduce((sum,pair) => sum + pair.projected - pair.actual,0) / ownershipPairs.length : null, comparisons: ownershipPairs }, outcomes: { fieldCashRate: actualCashRate, averagePayout: meanPayout, paidPositions: entries[0].paid_positions, entryFee: entries[0].entry_fee }, simulatedOutcomeCheck: userOutcomes, simulatorValidation: 'DIAGNOSTIC_ONLY', probabilityRelease: 'DISABLED_PENDING_CHRONOLOGICAL_MULTI_CONTEST_HOLDOUT', note: 'A single contest cannot validate win probability. Ownership metrics compare only player IDs with archived pre-lock ownership estimates; candidate cash/top-one frequencies are compared with official results only when the result reconciles to verified final player actuals.' });
  } catch (error) { respondError(req,res,error); }
}

async function actualCandidateOutcomes(db: Awaited<ReturnType<typeof tenantContext>>['db'], tenantId: string, contestId: string) {
  const results = await db.from('floyd_dfs_contest_results').select('generated_lineup_id,beat_cash_line,finish_position,field_size,payout,entry_fee').eq('tenant_id', tenantId).eq('contest_id', contestId).eq('official_outcome', true).eq('model_evaluation_eligible', true).eq('reconciliation_status', 'MATCHED');
  if (results.error) throw results.error;
  const resultRows = results.data ?? []; const lineupIds = resultRows.map((row) => String(row.generated_lineup_id));
  if (!lineupIds.length) return { status: 'NO_RECONCILED_USER_OUTCOMES', sampleSize: 0, brierCash: null, brierTopOne: null, rows: [] };
  const lineups = await db.from('floyd_dfs_generated_lineups').select('id,candidate_key,selection_run_id').eq('tenant_id', tenantId).in('id', lineupIds);
  if (lineups.error) throw lineups.error;
  const selectionIds = [...new Set((lineups.data ?? []).map((row) => String(row.selection_run_id)))];
  const selections = selectionIds.length ? await db.from('floyd_dfs_selection_runs').select('id,generation_run_id').eq('tenant_id', tenantId).in('id', selectionIds) : { data: [], error: null };
  if (selections.error) throw selections.error;
  const generationIds = [...new Set((selections.data ?? []).map((row) => String(row.generation_run_id)))];
  const optimizations = generationIds.length ? await db.from('floyd_dfs_optimization_runs').select('id,generation_run_id').eq('tenant_id', tenantId).in('generation_run_id', generationIds) : { data: [], error: null };
  if (optimizations.error) throw optimizations.error;
  const candidateKeys = [...new Set((lineups.data ?? []).map((row) => String(row.candidate_key)))];
  const optimizationIds = [...new Set((optimizations.data ?? []).map((row) => String(row.id)))];
  const candidateRows = optimizationIds.length && candidateKeys.length ? await db.from('floyd_dfs_lineup_candidates').select('optimization_run_id,candidate_key,cash_frequency,win_frequency,top_one_percent_frequency,expected_payout,contest_metric_provenance').eq('tenant_id', tenantId).in('optimization_run_id', optimizationIds).in('candidate_key', candidateKeys) : { data: [], error: null };
  if (candidateRows.error) throw candidateRows.error;
  const optimizationByRun = new Map((optimizations.data ?? []).map((row) => [String(row.generation_run_id), String(row.id)]));
  const generationBySelection = new Map((selections.data ?? []).map((row) => [String(row.id), String(row.generation_run_id)]));
  const candidateMap = new Map((candidateRows.data ?? []).map((row) => [`${row.optimization_run_id}:${row.candidate_key}`, row]));
  const lineupMap = new Map((lineups.data ?? []).map((row) => [String(row.id), row]));
  const observations = resultRows.flatMap((outcome) => {
    const lineup = lineupMap.get(String(outcome.generated_lineup_id)); if (!lineup) return [];
    const generationId = generationBySelection.get(String(lineup.selection_run_id)); const optimizationId = generationId ? optimizationByRun.get(generationId) : undefined;
    const candidate = optimizationId ? candidateMap.get(`${optimizationId}:${lineup.candidate_key}`) : undefined;
    return candidate ? [{ predictedCash: finite(candidate.cash_frequency), cash: outcome.beat_cash_line === true, predictedTopOne: finite(candidate.win_frequency), topOne: Number(outcome.finish_position) === 1, predictedTopOnePercent: finite(candidate.top_one_percent_frequency), actualTopOnePercent: Number(outcome.finish_position) / Math.max(1, Number(outcome.field_size)) <= 0.01, expectedPayout: finite(candidate.expected_payout), actualPayout: Number(outcome.payout), provenance: candidate.contest_metric_provenance }] : [];
  });
  const cashPairs = observations.filter((row) => row.predictedCash !== null);
  const topPairs = observations.filter((row) => row.predictedTopOne !== null);
  const brier = (rows: typeof observations, predicted: (row: typeof observations[number]) => number | null, actual: (row: typeof observations[number]) => boolean) => rows.length ? rows.reduce((sum,row) => sum + ((predicted(row) ?? 0) - (actual(row) ? 1 : 0)) ** 2,0) / rows.length : null;
  return { status: observations.length ? 'DIAGNOSTIC_ONLY' : 'NO_MATCHED_CANDIDATE_METRICS', sampleSize: observations.length, independentContests: new Set(observations.map(() => contestId)).size, brierCash: brier(cashPairs,row => row.predictedCash,row => row.cash), brierTopOne: brier(topPairs,row => row.predictedTopOne,row => row.topOne), candidateMetricProvenance: [...new Set(observations.map((row) => row.provenance))], outcomes: observations };
}
function finite(value: unknown): number | null { const parsed = Number(value); return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null; }
