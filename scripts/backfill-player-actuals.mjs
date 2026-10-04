import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sportsKey = process.env.SPORTS_DATA_IO_KEY;
const apiRoot = (process.env.SPORTS_DATA_IO_BASE_URL || 'https://api.sportsdata.io/v3').replace(/\/+$/, '');
if (!url || !key || !sportsKey) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SPORTS_DATA_IO_KEY must be configured.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } });

const { data: tenant, error: tenantError } = await db.from('tenants').select('id').eq('slug', 'floyd-dfs').single();
if (tenantError) throw tenantError;
const { data: projections, error: projectionError } = await db.from('floyd_dfs_projection_runs').select('id,generation_run_id,sport,model_version,projection_package').eq('tenant_id', tenant.id).order('created_at').limit(5000);
if (projectionError) throw projectionError;
const runIds = [...new Set((projections ?? []).map((row) => row.generation_run_id))];
const runById = new Map();
for (let index = 0; index < runIds.length; index += 200) {
  const { data, error } = await db.from('generation_runs').select('id,request_payload').eq('tenant_id', tenant.id).in('id', runIds.slice(index, index + 200));
  if (error) throw error;
  for (const row of data ?? []) runById.set(row.id, row);
}
const stageByRun = new Map();
for (let index = 0; index < runIds.length; index += 200) {
  const { data, error } = await db.from('engine_stage_runs').select('generation_run_id,input_payload,output_payload,version').eq('tenant_id', tenant.id).eq('stage', 'SLATE').in('generation_run_id', runIds.slice(index, index + 200)).order('version', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) if (!stageByRun.has(row.generation_run_id)) stageByRun.set(row.generation_run_id, row);
}
const eligible = (projections ?? []).flatMap((projection) => {
  if (!['MLB', 'WNBA', 'NFL', 'CFB', 'GOLF'].includes(projection.sport)) return [];
  const run = runById.get(projection.generation_run_id);
  const rawSlate = run?.request_payload?.input?.validatedSlate;
  const stage = stageByRun.get(projection.generation_run_id);
  const enrichedSlate = stage?.input_payload?.enrichedSlate ?? stage?.output_payload;
  const enrichedPlayers = new Map(array(enrichedSlate?.playerPool).map((player) => [String(player.playerId), player]));
  const slate = rawSlate ? { ...rawSlate, playerPool: array(rawSlate.playerPool).map((player) => ({ ...player, ...(enrichedPlayers.get(String(player.playerId)) ?? {}) })) } : null;
  const lock = Date.parse(slate?.contest?.lockTime ?? '');
  const generated = Date.parse(projection.projection_package?.generatedAt ?? '');
  const eventDate = String(slate?.event?.eventDate ?? '').slice(0, 10);
  if (!Number.isFinite(lock) || !Number.isFinite(generated) || generated >= lock || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate >= new Date().toISOString().slice(0, 10)) return [];
  return [{ projection, run, slate, lock: new Date(lock).toISOString(), generated: new Date(generated).toISOString(), eventDate }];
});

const cache = new Map();
const golfCatalog = new Map();
async function requestJson(base, route) {
  const response = await fetch(`${base}/${route}`, { headers: { accept: 'application/json', 'Ocp-Apim-Subscription-Key': sportsKey } });
  if (!response.ok) throw new Error(`SportsDataIO ${route} returned HTTP ${response.status}.`);
  return response.json();
}
async function feed(sport, date, slate) {
  const cacheKey = `${sport}|${date}|${(slate.playerPool ?? []).map((player) => player.team).sort().join(',')}|${slate.contest?.format}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let rows = [];
  if (sport === 'MLB') rows = array(await requestJson(apiRoot, `mlb/stats/json/PlayerGameStatsByDate/${date}`));
  else if (sport === 'WNBA') rows = array(await requestJson(apiRoot, `wnba/scores/json/BoxScores/${date}`)).flatMap((box) => array(box?.PlayerGames));
  else if (sport === 'NFL' || sport === 'CFB') {
    const teams = new Set((slate.playerPool ?? []).map((player) => normalizeTeam(player.team)));
    const scheduleRoute = sport === 'NFL' ? `nfl/scores/json/ScoresByDate/${date}` : `cfb/scores/json/GamesByDate/${date}`;
    const schedule = array(await requestJson(apiRoot, scheduleRoute));
    const games = schedule.filter((game) => teams.has(normalizeTeam(game.HomeTeam)) && teams.has(normalizeTeam(game.AwayTeam)));
    const gameIds = new Set(games.map((game) => String(game.GameKey ?? game.GameID ?? game.GameId ?? '')).filter(Boolean));
    const game = games[0];
    if (game && game.Week !== undefined) {
      const season = sport === 'NFL' ? `${game.Season}${normalizeNflSeasonType(game.SeasonType)}` : String(game.Season);
      const statRoute = sport === 'NFL' ? `nfl/stats/json/PlayerGameStatsByWeekFinal/${season}/${game.Week}` : `cfb/stats/json/PlayerGameStatsByWeekFinal/${season}/${game.Week}`;
      rows = array(await requestJson(apiRoot, statRoute)).filter((row) => gameIds.has(String(row.GameKey ?? row.GameID ?? row.GameId ?? '')));
    }
  } else if (sport === 'GOLF' && slate.contest?.format === 'CLASSIC') {
    const golfRoot = apiRoot.replace(/\/v3$/, '');
    const tournaments = array(await requestJson(golfRoot, `golf/v2/json/Tournaments/${new Date(date).getUTCFullYear()}`));
    const tournament = tournaments.find((row) => String(row.StartDate ?? '').slice(0, 10) <= date && String(row.EndDate ?? '').slice(0, 10) >= date);
    if (tournament?.TournamentID) {
      rows = array(await requestJson(golfRoot, `golf/v2/json/FantasyGameStatsByTournament/${tournament.TournamentID}`));
      if (!golfCatalog.has('players')) golfCatalog.set('players', array(await requestJson(golfRoot, 'golf/v2/json/Players')));
      const byId = new Map(golfCatalog.get('players').map((player) => [String(player.PlayerID), player]));
      rows = rows.map((row) => ({ ...row, ...(byId.get(String(row.PlayerID)) ?? {}) }));
    }
  }
  rows = rows.filter((row) => row?.IsGameOver === true || row?.IsGameOver === 1 || String(row?.IsGameOver).toLowerCase() === 'true' || sport === 'GOLF');
  cache.set(cacheKey, rows);
  return rows;
}

const report = { eligibleProjectionRuns: eligible.length, importedRows: 0, verifiedRows: 0, quarantinedRows: 0, unmatchedPlayers: 0, unavailableFeedRuns: 0, unsupportedFormatRuns: 0, unsupportedScoringRuns: 0, bySport: {} };
for (const item of eligible) {
  const { projection, slate, eventDate, lock, generated } = item;
  const sport = projection.sport;
  report.bySport[sport] ??= { eligibleRuns: 0, providerRows: 0, matchedPlayers: 0, unscorableMatches: 0, importedRows: 0, unmatchedPlayers: 0, missingProjection: 0, feedFailures: 0 };
  report.bySport[sport].eligibleRuns += 1;
  if (sport === 'GOLF' && slate.contest?.format !== 'CLASSIC') { report.unsupportedFormatRuns += 1; continue; }
  if (sport === 'CFB') { report.unsupportedScoringRuns += 1; continue; }
  let actualRows;
  try { actualRows = await feed(sport, eventDate, slate); }
  catch { report.unavailableFeedRuns += 1; report.bySport[sport].feedFailures += 1; continue; }
  report.bySport[sport].providerRows += actualRows.length;
  const slatePlayers = array(slate.playerPool);
  const packagePlayers = array(projection.projection_package?.players);
  const projectionsById = new Map(packagePlayers.map((player) => [String(player.playerId), player]));
  const projectionsByName = new Map();
  for (const projected of packagePlayers) {
    const key = normalizeName(projected.playerName ?? projected.name);
    if (!key) continue;
    projectionsByName.set(key, [...(projectionsByName.get(key) ?? []), projected]);
  }
  const prepared = [];
  for (const player of slatePlayers) {
    let projected = projectionsById.get(String(player.playerId));
    if (!projected) {
      const namedProjections = projectionsByName.get(normalizeName(player.playerName ?? player.name)) ?? [];
      if (namedProjections.length === 1) projected = namedProjections[0];
    }
    if (!projected) { report.bySport[sport].missingProjection += 1; continue; }
    const providerId = String(player.identity?.sportsDataIoId ?? '');
    let matches = providerId ? actualRows.filter((row) => String(row.PlayerID ?? row.PlayerId ?? '') === providerId) : [];
    let matchType = 'PROVIDER_ID';
    const draftKingsId = String(player.identity?.draftKingsId ?? player.playerId ?? '');
    if (!matches.length && sport === 'GOLF' && draftKingsId) {
      matches = actualRows.filter((row) => String(row.DraftKingsPlayerID ?? row.DraftKingsPlayerId ?? '') === draftKingsId);
      if (matches.length) matchType = 'PROVIDER_ID';
    }
    if (!matches.length) {
      const name = normalizeName(player.playerName);
      const team = normalizeTeam(player.team);
      matches = actualRows.filter((row) => {
        const providerName = normalizeName(row.DraftKingsName ?? row.Name ?? row.PlayerName ?? '');
        if (providerName !== name) return false;
        return sport === 'GOLF' ? true : normalizeTeam(row.Team) === team;
      });
      matchType = sport === 'GOLF' ? 'NAME_ONLY' : 'NAME_AND_TEAM';
    }
    if (matches.length !== 1) { report.unmatchedPlayers += 1; report.bySport[sport].unmatchedPlayers += 1; continue; }
    report.bySport[sport].matchedPlayers += 1;
    if (sport === 'GOLF' && slate.contest?.format !== 'CLASSIC') continue;
    const actual = scoreActual(sport, matches[0], slate.contest?.scoringRules);
    if (!Number.isFinite(actual.points)) { report.bySport[sport].unscorableMatches += 1; continue; }
    const integrity = validateActual(sport, matches[0], actual);
    const actualRow = { tenant_id: tenant.id, generation_run_id: projection.generation_run_id, projection_run_id: projection.id, slate_id: `${sport}:${slate.event?.eventId ?? eventDate}:${eventDate}:${slate.contest?.format ?? 'UNKNOWN'}`, sport, contest_format: slate.contest?.format ?? 'UNKNOWN', event_date: eventDate, player_id: String(player.playerId), provider_player_id: providerId || String(matches[0].PlayerID ?? ''), player_name: String(player.playerName), team: player.team ?? null, position: player.position ?? null, model_version: projection.model_version, projection_generated_at: generated, lock_time: lock, projected_floor: projected.floor, projected_median: projected.median, projected_ceiling: projected.ceiling, baseline_fppg: projected.baselineFppg ?? (Number.isFinite(Number(player.providerFppg)) ? Number(player.providerFppg) : null), actual_dk_points: actual.points, actual_components: actual.components, provider: 'SPORTSDATAIO_FINAL', identity_match: matchType, source_validation_status: integrity.valid ? 'VERIFIED' : 'INVALID_SOURCE', source_validation_reason: integrity.reason ?? null, source_retrieved_at: new Date().toISOString(), finality_status: 'FINAL' };
    actualRow.content_sha256 = createHash('sha256').update(stableJson({ points: actualRow.actual_dk_points, components: actualRow.actual_components, provider: actualRow.provider })).digest('hex');
    prepared.push(actualRow);
  }
  for (let offset = 0; offset < prepared.length; offset += 500) {
    const batch = prepared.slice(offset, offset + 500);
    const projectionRunId = batch[0]?.projection_run_id;
    const playerIds = batch.map((row) => row.player_id);
    if (projectionRunId && playerIds.length) {
      const prior = await db.from('floyd_dfs_player_actual_revisions').select('player_id,actual_dk_points,actual_components').eq('tenant_id', tenant.id).eq('projection_run_id', projectionRunId).in('player_id', playerIds).order('imported_at', { ascending: false });
      if (prior.error) throw prior.error;
      const priorByPlayer = new Map();
      for (const revision of prior.data ?? []) if (!priorByPlayer.has(String(revision.player_id))) priorByPlayer.set(String(revision.player_id), { points: Number(revision.actual_dk_points), components: revision.actual_components });
      for (const row of batch) {
        const previous = priorByPlayer.get(row.player_id);
        if (previous && (previous.points !== row.actual_dk_points || stableJson(scoringComponents(previous.components)) !== stableJson(scoringComponents(row.actual_components)))) row.finality_status = 'CORRECTED';
      }
    }
    const historicalRows = batch.map(({ content_sha256: _contentSha, ...row }) => row);
    const { error } = await db.from('floyd_dfs_historical_player_actuals').upsert(historicalRows, { onConflict: 'tenant_id,projection_run_id,player_id' });
    if (error) throw error;
    const revisions = batch.map((row) => ({ tenant_id: row.tenant_id, generation_run_id: row.generation_run_id, projection_run_id: row.projection_run_id, sport: row.sport, event_date: row.event_date, player_id: row.player_id, actual_dk_points: row.actual_dk_points, actual_components: row.actual_components, source: row.provider, source_validation_status: row.source_validation_status, source_validation_reason: row.source_validation_reason, finality_status: row.finality_status, source_retrieved_at: row.source_retrieved_at, content_sha256: row.content_sha256 }));
    const revisionResult = await db.from('floyd_dfs_player_actual_revisions').upsert(revisions, { onConflict: 'tenant_id,projection_run_id,player_id,content_sha256', ignoreDuplicates: true });
    if (revisionResult.error) throw revisionResult.error;
    report.verifiedRows += batch.filter((row) => row.source_validation_status === 'VERIFIED').length;
    report.quarantinedRows += batch.filter((row) => row.source_validation_status !== 'VERIFIED').length;
  }
  report.importedRows += prepared.length;
  report.bySport[sport].importedRows += prepared.length;
}
report.resultReconciliation = await reconcileExistingResults();
console.log(JSON.stringify(report, null, 2));

async function reconcileExistingResults() {
  const { data: results, error } = await db.from('floyd_dfs_contest_results').select('id,generated_lineup_id,actual_dk_points,result_payload,official_outcome').eq('tenant_id', tenant.id).limit(5000);
  if (error) throw error;
  const summary = { total: results?.length ?? 0, matched: 0, scoreMismatch: 0, sourceInvalid: 0, unavailable: 0 };
  for (const result of results ?? []) {
    const { data: lineup, error: lineupError } = await db.from('floyd_dfs_generated_lineups').select('id,lineup_payload,selection_run_id').eq('tenant_id', tenant.id).eq('id', result.generated_lineup_id).maybeSingle();
    if (lineupError) throw lineupError;
    const { data: selection, error: selectionError } = await db.from('floyd_dfs_selection_runs').select('generation_run_id,selection_package').eq('tenant_id', tenant.id).eq('id', lineup?.selection_run_id).maybeSingle();
    if (selectionError) throw selectionError;
    const generationRunId = selection?.generation_run_id;
    const run = generationRunId ? runById.get(generationRunId) : null;
    const slate = run?.request_payload?.input?.validatedSlate;
    const ids = [...new Set(array(lineup?.lineup_payload?.playerIds).map(String))];
    if (!generationRunId || !slate || !ids.length) { summary.unavailable += 1; continue; }
    const { data: actuals, error: actualError } = await db.from('floyd_dfs_historical_player_actuals').select('player_id,actual_dk_points,source_validation_status,source_validation_reason').eq('tenant_id', tenant.id).eq('generation_run_id', generationRunId).in('player_id', ids);
    if (actualError) throw actualError;
    const byPlayer = new Map((actuals ?? []).map((row) => [String(row.player_id), Number(row.actual_dk_points)]));
    if (ids.some((id) => !Number.isFinite(byPlayer.get(id)))) { summary.unavailable += 1; await saveReconciliation(result, 'UNAVAILABLE', null, null, ids.length, false); continue; }
    const invalid = (actuals ?? []).filter((row) => ids.includes(String(row.player_id)) && row.source_validation_status !== 'VERIFIED');
    if (invalid.length) { summary.sourceInvalid += 1; await saveReconciliation(result, 'SOURCE_INVALID', null, null, ids.length, false, invalid.map((row) => row.source_validation_reason).filter(Boolean)); continue; }
    const slots = lineup?.lineup_payload?.rosterSlots ?? {};
    const multiplierForPlayer = (playerId) => {
      const slot = Object.entries(slots).find(([, assigned]) => String(assigned) === playerId)?.[0];
      if (!slot) return 1;
      const rule = slate.rosterRules?.slots?.[slot];
      return Number.isFinite(Number(rule?.fantasyMultiplier)) ? Number(rule.fantasyMultiplier) : 1;
    };
    const computed = ids.reduce((sum, playerId) => sum + byPlayer.get(playerId) * multiplierForPlayer(playerId), 0);
    const entered = Number(result.actual_dk_points);
    const difference = Number.isFinite(entered) ? Number((computed - entered).toFixed(4)) : null;
    const status = difference !== null && Math.abs(difference) <= 0.05 ? 'MATCHED' : 'SCORE_MISMATCH';
    await saveReconciliation(result, status === 'SCORE_MISMATCH' ? 'MISMATCH' : status, Number(computed.toFixed(4)), difference, ids.length, status === 'MATCHED' && result.official_outcome === true);
    if (status === 'MATCHED') summary.matched += 1; else summary.scoreMismatch += 1;
  }
  return summary;
}

async function saveReconciliation(result, status, computed, difference, playerCount, eligible, reasons = []) {
  const priorPayload = result.result_payload && typeof result.result_payload === 'object' ? result.result_payload : {};
  const reconciliation = { status, computedPlayerActualScore: computed, recordedActualScore: Number.isFinite(Number(result.actual_dk_points)) ? Number(result.actual_dk_points) : null, difference, playerCount, source: 'SPORTSDATAIO_FINAL', scoring: 'saved DraftKings scoring and roster multipliers', reasons, reconciledAt: new Date().toISOString() };
  const { error } = await db.from('floyd_dfs_contest_results').update({ reconciliation_status: status, model_evaluation_eligible: eligible, result_payload: { ...priorPayload, reconciliation } }).eq('tenant_id', tenant.id).eq('id', result.id);
  if (error) throw error;
}

function array(value) { return Array.isArray(value) ? value : []; }
function normalizeName(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeTeam(value) { const code = String(value ?? '').trim().toUpperCase(); return ({ LV: 'LVA', LAS: 'LVA', IN: 'IND', NY: 'NYL', LA: 'LAS' })[code] ?? code; }
function scoreActual(sport, row, scoring) {
  if (sport === 'MLB') {
    const points = Number(row.FantasyPointsDraftKings);
    return Number.isFinite(points) ? { points, components: pick(row, ['AtBats','Runs','Hits','Singles','Doubles','Triples','HomeRuns','RunsBattedIn','Strikeouts','Walks','HitByPitch','StolenBases','InningsPitchedDecimal','PitchingStrikeouts','PitchingEarnedRuns','Wins','Saves','FantasyPointsDraftKings']) } : { points: NaN, components: {} };
  }
  if (sport === 'NFL' || sport === 'GOLF') {
    const points = Number(row.FantasyPointsDraftKings);
    return Number.isFinite(points) ? { points, components: pick(row, ['FantasyPointsDraftKings']) } : { points: NaN, components: {} };
  }
  if (sport === 'CFB') return { points: NaN, components: {} };
  const suppliedRules = Object.fromEntries(Object.entries(scoring ?? {}).map(([name, rule]) => [name, Number(typeof rule === 'number' ? rule : rule?.value)]));
  const wnbaProfile = { points: 1, threePointersMade: 0.5, rebounds: 1.25, assists: 1.5, steals: 2, blocks: 2, turnovers: -0.5, doubleDouble: 1.5, tripleDouble: 3 };
  const wnbaConflicts = sport === 'WNBA' && Object.entries(suppliedRules).some(([key, value]) => wnbaProfile[key] !== undefined && Number.isFinite(value) && Math.abs(value - wnbaProfile[key]) > 1e-9);
  const rules = sport === 'WNBA' ? { ...wnbaProfile, ...suppliedRules } : suppliedRules;
  const components = { points: Number(row.Points ?? 0), threePointersMade: Number(row.ThreePointersMade ?? 0), rebounds: Number(row.Rebounds ?? 0), assists: Number(row.Assists ?? 0), steals: Number(row.Steals ?? 0), blocks: Number(row.BlockedShots ?? 0), turnovers: Number(row.Turnovers ?? 0), doubleDouble: Number(row.DoubleDoubles ?? 0), tripleDouble: Number(row.TripleDoubles ?? 0) };
  const required = Object.keys(components);
  if (wnbaConflicts || required.some((key) => !Number.isFinite(rules[key]))) return { points: NaN, components };
  return { points: required.reduce((sum, key) => sum + components[key] * rules[key], 0), components: { ...components, ...(Number.isFinite(Number(row.Minutes)) ? { minutes: Number(row.Minutes) } : {}) } };
}
function pick(row, keys) { return Object.fromEntries(keys.flatMap((key) => Number.isFinite(Number(row[key])) ? [[key, Number(row[key])]] : [])); }
function validateActual(sport, row, actual) {
  const increment = sport === 'MLB' || sport === 'WNBA' ? 0.25 : sport === 'NFL' || sport === 'CFB' ? 0.1 : 0.5;
  if (!Number.isFinite(actual.points) || Math.abs(actual.points / increment - Math.round(actual.points / increment)) > 1e-6) return { valid: false, reason: `Fantasy points are missing or not on a valid ${increment}-point increment.` };
  if (sport === 'MLB') {
    const whole = ['AtBats','Runs','Hits','Singles','Doubles','Triples','HomeRuns','RunsBattedIn','Strikeouts','Walks','HitByPitch','StolenBases','PitchingStrikeouts','PitchingEarnedRuns','Wins','Saves'];
    for (const field of whole) if (row[field] !== null && row[field] !== undefined && (!Number.isInteger(Number(row[field])) || Number(row[field]) < 0)) return { valid: false, reason: `MLB component ${field} must be a nonnegative integer.` };
    const ip = Number(row.InningsPitchedDecimal);
    if (Number.isFinite(ip) && Math.abs(ip * 10 - Math.round(ip * 10)) < 1e-6 && ![0,1,2].includes(Math.round(ip * 10) % 10)) return { valid: false, reason: 'MLB innings pitched must use .0, .1, or .2 notation.' };
  }
  if (sport === 'WNBA') for (const [field, value] of Object.entries(actual.components)) if (field !== 'minutes' && (!Number.isInteger(value) || value < 0)) return { valid: false, reason: `WNBA component ${field} must be a nonnegative integer.` };
  return { valid: true };
}
function normalizeNflSeasonType(value) { const code = String(value ?? '').toUpperCase(); if (code === '2' || code === 'PRE') return 'PRE'; if (code === '3' || code === 'POST') return 'POST'; return 'REG'; }
function scoringComponents(value) { return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key]) => !['minutes','pitchesthrown','pitchesthrownstrikes'].includes(key.toLowerCase()))); }
function stableJson(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
