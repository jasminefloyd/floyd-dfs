import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyAvailabilitySnapshot } from '../../../src/lib/engine/availability.js';
import { cors, method, providerSet, respondError, tenantContext } from '../../../server/runtime.js';
import { computePreLockDecision, diffAvailabilityForChangeEvents } from '../../../server/learningDiagnosis.js';

// Cheap pre-lock recheck: re-runs Research against the already-validated slate and diffs the
// fresh availability list against the research version that was actually used to generate the
// run's lineups. Real detected changes then flow through the same KEEP/ADJUST/REBUILD decision
// logic api/learning/pre-lock.ts uses manually — so the Learning page's "Run pre-lock check"
// can be backed by real data instead of an empty caller-supplied array.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET'])) return;
  try {
    const context = await tenantContext();
    const runId = String(req.query.runId ?? '');
    if (!runId) throw new Error('runId is required.');

    const stages = await context.db.from('engine_stage_runs').select('stage,version,output_payload').eq('generation_run_id', runId).in('stage', ['SLATE', 'RESEARCH']).order('version', { ascending: false });
    if (stages.error) throw stages.error;
    const latestByStage = new Map<string, { version: number; output_payload: unknown }>();
    for (const row of stages.data ?? []) if (!latestByStage.has(row.stage)) latestByStage.set(row.stage, { version: row.version, output_payload: row.output_payload });
    const slate = latestByStage.get('SLATE')?.output_payload as Record<string, unknown> | undefined;
    const previousResearch = latestByStage.get('RESEARCH')?.output_payload as Record<string, unknown> | undefined;
    if (!slate) { cors(req, res); res.status(404).json({ error: 'No SLATE stage output found for this run.' }); return; }

    const { agent, availability, espnProjection } = providerSet();
    let refreshedSlate = slate as never;
    const slateRecord = slate as Record<string, unknown>;
    const sport = String(slateRecord.sport ?? '');
    const lockTime = Date.parse(String((slateRecord.contest as Record<string, unknown> | undefined)?.lockTime ?? ''));
    if (Number.isFinite(lockTime) && lockTime <= Date.now()) { cors(req, res); res.status(409).json({ error: 'Contest lock has passed; late-news refresh can no longer create replacement lineups.', locked: true }); return; }
    if (availability) {
      const current = await availability.getAvailabilitySnapshot(refreshedSlate);
      refreshedSlate = applyAvailabilitySnapshot(refreshedSlate, current, new Date()) as never;
    }
    if (espnProjection && ['NBA','WNBA','NFL','CFB'].includes(sport)) {
      const current = await espnProjection.getAvailabilitySnapshot(refreshedSlate);
      refreshedSlate = applyAvailabilitySnapshot(refreshedSlate, current, new Date()) as never;
    }
    const freshResearch = await agent.run({ validatedSlate: refreshedSlate });
    const changes = diffAvailabilityForChangeEvents(previousResearch, freshResearch as unknown as Record<string, unknown>);
    const oldPlayers = (slate as { playerPool?: Array<Record<string, unknown>> }).playerPool ?? [];
    const newPlayers = (refreshedSlate as { playerPool?: Array<Record<string, unknown>> }).playerPool ?? [];
    const newById = new Map(newPlayers.map((player) => [String(player.playerId ?? ''), player]));
    for (const previousPlayer of oldPlayers) {
      const current = newById.get(String(previousPlayer.playerId ?? ''));
      const oldAvailability = previousPlayer.availability as Record<string, unknown> | undefined;
      const newAvailability = current?.availability as Record<string, unknown> | undefined;
      const previousRole = String(oldAvailability?.roleStatus ?? 'UNKNOWN'); const newRole = String(newAvailability?.roleStatus ?? 'UNKNOWN');
      if (newRole !== previousRole && newRole !== 'UNKNOWN') changes.push({ eventType: 'ROLE_CHANGE', materiality: newRole === 'NOT_STARTER' ? 'HIGH' : 'MEDIUM', subject: String(previousPlayer.playerId), previousState: { roleStatus: previousRole }, newState: { roleStatus: newRole }, source: { source: String(newAvailability?.source ?? 'availability feed'), retrievedAt: newAvailability?.retrievedAt } });
    }
    // Weather updates are compared as dated source records and never translated into an
    // uncalibrated points adjustment here. A changed forecast still triggers a pre-lock review.
    if (availability && sport === 'MLB') {
      const event = (refreshedSlate as { event?: { eventDate?: string; eventId?: string } }).event;
      const games = await availability.getMlbGameWeather(String(event?.eventDate ?? '').slice(0, 10));
      const changedGames = new Set<string>();
      for (const player of oldPlayers) {
        const oldWeather = (player.sportContext as Record<string, unknown> | undefined)?.mlb as Record<string, unknown> | undefined;
        const prior = oldWeather?.gameWeather as Record<string, unknown> | undefined;
        if (!prior) continue;
        const team = String(player.team ?? '').toUpperCase(); const opponent = String(player.opponent ?? '').toUpperCase();
        const currentGame = games.find((game) => [String(game.homeTeam ?? '').toUpperCase(), String(game.awayTeam ?? '').toUpperCase()].includes(team) && [String(game.homeTeam ?? '').toUpperCase(), String(game.awayTeam ?? '').toUpperCase()].includes(opponent));
        const key = String(currentGame?.gameId ?? `${team}:${opponent}`);
        if (currentGame && !changedGames.has(key) && (Number(prior.temperatureLow ?? NaN) !== Number(currentGame.temperatureLow ?? NaN) || Number(prior.temperatureHigh ?? NaN) !== Number(currentGame.temperatureHigh ?? NaN) || Number(prior.windSpeed ?? NaN) !== Number(currentGame.windSpeed ?? NaN) || String(prior.windDirection ?? '') !== String(currentGame.windDirection ?? '') || String(prior.description ?? '') !== String(currentGame.description ?? ''))) {
          changedGames.add(key); changes.push({ eventType: 'WEATHER_CHANGE', materiality: 'MEDIUM', subject: key, previousState: prior, newState: currentGame, source: { source: 'SportsDataIO MLB GamesByDate', retrievedAt: new Date().toISOString() } });
        }
      }
    }

    const selectionRuns = await context.db.from('floyd_dfs_selection_runs').select('id').eq('generation_run_id', runId);
    if (selectionRuns.error) throw selectionRuns.error;
    const selectionRunIds = (selectionRuns.data ?? []).map((row) => row.id);
    const runLineups = selectionRunIds.length ? await context.db.from('floyd_dfs_generated_lineups').select('id,status').in('selection_run_id', selectionRunIds) : { data: [], error: null };
    if (runLineups.error) throw runLineups.error;
    const immutableLineupIds = (runLineups.data ?? []).filter((row) => row.status === 'ENTERED').map((row) => String(row.id));
    const affectedLineupIds = (runLineups.data ?? []).map((row) => String(row.id));

    if (changes.length) {
      const saved = await context.db.from('floyd_dfs_change_events').insert(changes.map((event) => ({ tenant_id: context.tenantId, generation_run_id: runId, event_type: event.eventType ?? 'UNKNOWN', subject: String(event.subject ?? 'SLATE'), previous_state: event.previousState ?? {}, new_state: event.newState ?? {}, materiality: event.materiality ?? 'LOW', source: event.source ?? {}, affected_lineup_ids: affectedLineupIds })));
      if (saved.error) throw saved.error;
    }

    cors(req, res);
    res.status(200).json({ decision: computePreLockDecision(changes, immutableLineupIds), changeEvents: changes, affectedLineupIds, researchStatus: freshResearch.status, refreshedAt: new Date().toISOString(), replacementsAvailableBeforeLock: Number.isFinite(lockTime) && Date.now() < lockTime && changes.length > 0, refreshedSlate });
  } catch (error) { respondError(req, res, error); }
}
