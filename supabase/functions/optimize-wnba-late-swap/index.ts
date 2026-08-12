import { changedInputs, lockedPlayersFromState, materialSwapAdvantage, preservesLockedSlots, sourceReliability, type LiveSlatePlayerState, type SwapLineup } from '../_shared/wnbaLateSwap.ts';

interface Body {
  snapshotId?: string; contestDate: string; contestType: 'classic' | 'showdown'; contestId?: string; userId?: string;
  originalLineups: SwapLineup[]; playerRoster: unknown[]; slate?: Record<string, unknown>; liveState: LiveSlatePlayerState[];
  config?: Record<string, unknown>;
}
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const name = (player: { name?: string }) => String(player.name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function post(url: string, key: string, path: string, body: unknown) {
  const response = await fetch(`${url.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return await response.json() as unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json() as Body; const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key || !/^\d{4}-\d{2}-\d{2}$/.test(body.contestDate) || !['classic', 'showdown'].includes(body.contestType) || !body.originalLineups?.length || !body.playerRoster?.length || !body.liveState?.length) throw new Error('Original lineups, current WNBA roster, and timestamped live state are required.');
    const requestedAt = new Date().toISOString();
    const normalizedLiveState = body.liveState.map((state) => ({ ...state, source_reliability: sourceReliability(state.source, state.source_reliability) }));
    const changes = changedInputs(normalizedLiveState as LiveSlatePlayerState[]);
    const unreliable = normalizedLiveState.some((state) => state.source_reliability === undefined || state.source_reliability < 0.7);
    const maxStateAgeMinutes = Math.max(5, Number(body.config?.maxLiveStateAgeMinutes ?? 20));
    const stale = normalizedLiveState.some((state) => Date.now() - Date.parse(state.observed_at) > maxStateAgeMinutes * 60_000);
    const original = body.originalLineups[0];
    const lockedPlayers = lockedPlayersFromState(original, normalizedLiveState as LiveSlatePlayerState[]);
    const lockedState = normalizedLiveState.filter((state) => ['locked', 'started', 'final', 'postponed'].includes(state.game_state));
    const invalidLocks = lockedState.some((state) => ['inactive', 'out'].includes(state.player_state) && original.players.some((player) => name(player) === name({ name: state.player_name })));
    let status: 'recommended' | 'no_action' | 'blocked' = 'no_action';
    let recommendations: SwapLineup[] = [];
    const reasons = [...changes];
    if (unreliable || invalidLocks || stale) {
      status = 'blocked';
      reasons.push(unreliable
        ? 'Late-swap recommendation blocked: a live update does not meet the source-reliability threshold.'
        : stale
          ? `Late-swap recommendation blocked: live slate state is older than ${maxStateAgeMinutes} minutes.`
          : 'Late-swap recommendation blocked: an already locked player has conflicting availability state.');
    } else if (!changes.length) {
      reasons.push('No material, reliable live input changed; preserving the original portfolio.');
    } else {
      const excludedPlayers = normalizedLiveState.filter((state) => ['inactive', 'out', 'doubtful', 'postponed'].includes(state.player_state) && !lockedPlayers.includes(state.player_name)).map((state) => state.player_name);
      const startedByName = new Map(normalizedLiveState
        .filter((state) => ['started', 'final'].includes(state.game_state) && Number.isFinite(Number(state.accrued_points)))
        .map((state) => [name({ name: state.player_name }), Number(state.accrued_points)]));
      const remainingRoster = body.playerRoster.map((player) => {
        const draft = player as { name?: string; projected_points?: number };
        const accrued = startedByName.get(name(draft));
        return accrued === undefined ? player : { ...draft, projected_points: accrued, contextual_projection: accrued };
      });
      const generator = await post(url, key, '/functions/v1/generate-pios-lineups', {
        sport: 'wnba', contestType: body.contestType, contestDate: body.contestDate, contestId: body.contestId, snapshotId: body.snapshotId,
        slate: body.slate, playerRoster: remainingRoster, userId: body.userId ?? null,
        excludedPlayers, lockedPlayers, lateSwapMode: true, entryCount: body.originalLineups.length,
        lineupMode: body.config?.lineupMode ?? 'tournament', contestStrategy: body.config?.contestStrategy ?? 'single_entry',
        riskTolerance: body.config?.riskTolerance ?? 'balanced', fieldSize: body.config?.fieldSize ?? 1000,
        maxEntriesPerUser: body.config?.maxEntriesPerUser ?? 1, payoutShape: body.config?.payoutShape ?? 'top_heavy',
        maxPlayerExposure: body.config?.maxPlayerExposure ?? 0.8, maxTeamExposure: body.config?.maxTeamExposure ?? 0.8,
        minPrimaryStack: body.config?.minPrimaryStack ?? 0, diversifyLineups: true, ownershipWeight: body.config?.ownershipWeight ?? 1,
        correlationWeight: body.config?.correlationWeight ?? 1, maxCaptainExposure: body.config?.maxCaptainExposure ?? 0.8,
        minPerTeam: body.config?.minPerTeam ?? 1, forceUniqueCaptains: body.config?.forceUniqueCaptains ?? false,
        minSalaryUsed: body.config?.minSalaryUsed ?? 0, maxDuplication: body.config?.maxDuplication ?? 100,
        simulationIterations: body.config?.simulationIterations ?? 2000, fieldSimulationSize: body.config?.fieldSimulationSize ?? 400,
      }) as { lineups?: SwapLineup[] };
      recommendations = (generator.lineups ?? []).filter((candidate, index) => preservesLockedSlots(body.originalLineups[index] ?? original, candidate, lockedPlayers));
      if (recommendations.length && materialSwapAdvantage(original, recommendations[0])) {
        status = 'recommended'; reasons.push(`Recommended swap preserves ${lockedPlayers.length} locked player slot${lockedPlayers.length === 1 ? '' : 's'} and clears the simulation-noise threshold.`);
      } else {
        recommendations = []; reasons.push('No valid swap clears the simulated advantage threshold; preserving the original portfolio.');
      }
    }
    const expectedEffect = recommendations.length ? {
      top20_delta: Number((Number(recommendations[0].top_n_rate ?? 0) - Number(original.top_n_rate ?? 0)).toFixed(4)),
      duplicate_adjusted_payout_delta: Number((Number(recommendations[0].duplicate_adjusted_expected_payout ?? 0) - Number(original.duplicate_adjusted_expected_payout ?? 0)).toFixed(4)),
    } : {};
    await post(url, key, '/rest/v1/wnba_late_swap_decisions', [{ user_id: body.userId ?? null, snapshot_id: body.snapshotId ?? null, contest_date: body.contestDate, contest_type: body.contestType, contest_id: body.contestId ?? null, requested_at: requestedAt, decision_time: requestedAt, status, original_lineups: body.originalLineups, recommended_lineups: recommendations, live_state: normalizedLiveState, reasons, expected_effect: expectedEffect, config: body.config ?? {} }]);
    return json({ status, locked_players: lockedPlayers, recommendations, reasons, expected_effect: expectedEffect });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});
