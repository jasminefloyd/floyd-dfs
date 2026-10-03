import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import WebSocket from 'ws';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DraftKingsApiError, DraftKingsClient } from '../src/lib/engine/draftKings.js';
import { adjustSlate } from '../src/lib/engine/adjustment.js';
import { projectSlate, projectionReadiness } from '../src/lib/engine/projection.js';
import { optimizeLineups } from '../src/lib/engine/optimizer.js';
import { selectLineups } from '../src/lib/engine/selection.js';
import { ResearchAgent } from '../src/lib/engine/researchAgent.js';
import { createDefaultRssProviders } from '../src/lib/engine/rssProvider.js';
import { SportsDataIoClient, SportsDataIoResearchProvider, seasonParamFor } from '../src/lib/engine/sportsDataIoProvider.js';
import { applyAvailabilitySnapshot, normalizeProviderName, normalizeTeamCode, withDegradedAvailability } from '../src/lib/engine/availability.js';
import { assertAdjustment, assertContestMetrics, assertOptimizer, assertProjection, assertResearch, assertSelection, assertSlate } from '../src/lib/engine/validation.js';
import { buildLiveStatePackage } from '../src/lib/engine/liveState.js';
import { OddsResearchProvider, getTeamMarketContext } from '../src/lib/engine/oddsProvider.js';
import { adjustWithOpenAi } from '../src/lib/engine/openAiAdjustment.js';
import { ConfiguredResearchProvider } from '../src/lib/engine/configuredResearchProvider.js';
import { OpenAiResearchSynthesizer } from '../src/lib/engine/openAiSynthesizer.js';
import { AnthropicResearchSynthesizer, FallbackResearchSynthesizer } from '../src/lib/engine/anthropicResearchSynthesizer.js';
import { adjustWithAnthropic } from '../src/lib/engine/anthropicStageFallback.js';
import { ballDontLieProvider, espnProvider } from '../src/lib/engine/structuredSportsProvider.js';
import { EspnStructuredResearchProvider } from '../src/lib/engine/espnStructuredResearchProvider.js';
import { FirecrawlResearchProvider, SerpApiResearchProvider } from '../src/lib/engine/webResearchProvider.js';
import { EspnProjectionClient } from '../src/lib/engine/espnProjectionProvider.js';
import { buildCashLineCalibration, calibratedCashLineProbability, rawCashLineProbability, CASH_LINE_CALIBRATION_VERSION, type CashLineObservation } from '../src/lib/engine/cashLineCalibration.js';
import { deriveWeightedSeasonInputs, findRow, gamesPlayedFromRow } from '../src/lib/engine/projectionInputs.js';
import type { ContestFormat, EngineStage, ValidatedSlate } from '../src/lib/engine/contracts.js';
import { persistEvidenceLedger } from './evidenceLedger.js';

type Json = Record<string, unknown>;

// Vercel loads project environment variables in production. The local Vercel
// runtime does not consistently load `.env.local`, so load it explicitly for
// local API handlers; missing files are harmless in production.
loadDotenv({ path: '.env.local' });

function env(name: string): string | undefined { const value = process.env[name]; return value?.trim() || undefined; }
function requiredEnv(name: string, ...fallbackNames: string[]): string { const value = [name, ...fallbackNames].map(env).find(Boolean); if (!value) throw new Error(`Server environment variable ${name} is not configured.`); return value; }

export function serverSupabase(): SupabaseClient { return createClient(requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { transport: WebSocket as never } }); }

export interface TenantContext { db: SupabaseClient; tenantId: string; userId: string; }
export async function tenantContext(): Promise<TenantContext> {
  const db = serverSupabase();
  const tenant = await db.from('tenants').select('id').eq('slug', 'floyd-dfs').maybeSingle();
  if (tenant.error) throw tenant.error;
  if (!tenant.data?.id) throw new Error('Tenant floyd-dfs is not configured in Supabase.');
  const membership = await db.from('tenant_memberships').select('user_id').eq('tenant_id', tenant.data.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (membership.error) throw membership.error;
  if (!membership.data?.user_id) throw new Error('No user membership exists for tenant floyd-dfs.');
  return { db, tenantId: String(tenant.data.id), userId: String(membership.data.user_id) };
}

export function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = String(req.headers.origin ?? '');
  const allowed = new Set(['https://floyd-dfs.vercel.app', 'http://127.0.0.1:5178', 'http://localhost:5178']);
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof value.message === 'string' ? value.message : 'Server request failed.';
    const details = typeof value.details === 'string' ? ` ${value.details}` : '';
    const hint = typeof value.hint === 'string' ? ` Hint: ${value.hint}` : '';
    const code = typeof value.code === 'string' ? ` [${value.code}]` : '';
    return `${message}${code}.${details}${hint}`.replace('..', '.');
  }
  return 'Server request failed.';
}
export function respondError(req: VercelRequest, res: VercelResponse, error: unknown): void {
  cors(req, res);
  if (error instanceof DraftKingsApiError && error.details.status === 403) {
    const upstreamEndpoint = (() => { try { const url = new URL(error.details.url); return `${url.host}${url.pathname}`; } catch { return undefined; } })();
    res.status(502).json({
      error: "DraftKings denied this server-side API request (HTTP 403). Contest discovery may still work, but DraftKings' detailed contest and player-pool data is currently blocked from this deployment.",
      provider: 'DRAFTKINGS',
      upstreamStatus: 403,
      ...(upstreamEndpoint ? { upstreamEndpoint } : {}),
    });
    return;
  }
  res.status(500).json({ error: errorMessage(error) });
}
export function method(req: VercelRequest, res: VercelResponse, allowed: string[]): boolean { cors(req, res); if (req.method === 'OPTIONS') { res.status(204).end(); return false; } if (!allowed.includes(req.method ?? '')) { res.status(405).json({ error: 'Method not allowed.' }); return false; } return true; }

const DRAFTKINGS_SPORTS = ['WNBA', 'NBA', 'MLB', 'GOLF', 'NFL', 'CFB'] as const;
export function draftKingsClient(sportCodes: Partial<Record<(typeof DRAFTKINGS_SPORTS)[number], string>> = {}): DraftKingsClient {
  const configured = Object.fromEntries(DRAFTKINGS_SPORTS.flatMap((sport) => {
    const code = env(`DRAFTKINGS_SPORT_CODE_${sport}`);
    return code ? [[sport, code]] : [];
  }));
  return new DraftKingsClient({ sportCodes: { ...configured, ...sportCodes } });
}
export function requestId(): string { return crypto.randomUUID(); }

export async function createRun(db: SupabaseClient, input: { tenantId: string; userId: string; requestId: string; entries: number; payload: unknown }): Promise<Json> {
  const result = await db.from('generation_runs').insert({ tenant_id: input.tenantId, user_id: input.userId, request_id: input.requestId, requested_entry_count: input.entries, request_payload: { input: input.payload }, state: 'created', lineage: {} }).select('*').single();
  if (result.error) throw result.error;
  return result.data as Json;
}

export async function saveStage(db: SupabaseClient, run: Json, stage: EngineStage, input: unknown, output: unknown, status: string, warnings: string[] = [], errors: string[] = [], parentStageVersions: Json = {}): Promise<Json> {
  const prior = await db.from('engine_stage_runs').select('version').eq('generation_run_id', run.id).eq('stage', stage).order('version', { ascending: false }).limit(1).maybeSingle();
  if (prior.error) throw prior.error;
  const version = Number(prior.data?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const result = await db.from('engine_stage_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, stage, version, status, input_payload: input ?? {}, output_payload: output ?? null, warnings, errors, parent_stage_versions: parentStageVersions, started_at: now, completed_at: now }).select('*').single();
  if (result.error) throw result.error;
  await recordEvent(db, { tenant_id: String(run.tenant_id), generation_run_id: String(run.id), event_type: 'STAGE_COMPLETED', stage, payload: { version, status, warnings, errors } });
  await db.from('generation_runs').update({ current_stage: stage, state: stateForStage(stage), lineage: { ...(run.lineage as Json ?? {}), [stage]: version } }).eq('id', run.id);
  return result.data as Json;
}
export async function recordEvent(db: SupabaseClient, event: { tenant_id: string; generation_run_id?: string; event_type: string; stage?: string; payload?: unknown }): Promise<void> { const result = await db.from('engine_events').insert({ ...event, payload: event.payload ?? {} }); if (result.error) throw result.error; }
async function nextVersion(db: SupabaseClient, table: string, generationRunId: string): Promise<number> {
  const result = await db.from(table).select('version').eq('generation_run_id', generationRunId).order('version', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return Number(result.data?.version ?? 0) + 1;
}
function stateForStage(stage: EngineStage): string { return ({ SLATE: 'slate_validated', RESEARCH: 'researching', SPORT_ADJUSTMENT: 'adjusting', PROJECTION: 'projecting', OPTIMIZE: 'optimizing', SELECTION: 'selecting' } as Record<string, string>)[stage] ?? 'created'; }

export function providerSet(): { agent: ResearchAgent; availability?: SportsDataIoClient; espnProjection?: EspnProjectionClient; anthropicKey?: string; anthropicModel?: string } {
  const providers = [...createDefaultRssProviders() as import('../src/lib/engine/contracts.js').ResearchSourceProvider[]];
  const sportsKey = env('SPORTS_DATA_IO_KEY');
  let availability: SportsDataIoClient | undefined;
  if (sportsKey) { availability = new SportsDataIoClient({ apiKey: sportsKey, baseUrl: env('SPORTS_DATA_IO_BASE_URL') }); providers.push(new SportsDataIoResearchProvider({ client: availability })); }
  const oddsKey = env('THE_ODDS_API_KEY') ?? env('ODDS_API_KEY');
  if (oddsKey) providers.push(new OddsResearchProvider({ apiKey: oddsKey, baseUrl: env('ODDS_API_BASE_URL') }));
  const sentimentUrl = env('FIELD_SENTIMENT_URL');
  if (sentimentUrl) providers.push(new ConfiguredResearchProvider({ name: 'Configured Field Sentiment', url: sentimentUrl, tier: 4 }));
  const espnBaseUrl = env('ESPN_BASE_URL');
  // SportsDataIO is the authoritative MLB slate/lineup source. ESPN's MLB
  // scoreboard endpoint is edge-blocked from the production server runtime
  // (HTTP 403), so do not make that optional enrichment request for MLB. This
  // keeps an ESPN access-policy failure out of the MLB research contract while
  // retaining ESPN structured research for the other supported sports.
  if (espnBaseUrl) {
    providers.push(espnProvider(espnBaseUrl, undefined, { excludeSports: ['MLB'] }));
    providers.push(new EspnStructuredResearchProvider(espnBaseUrl));
  }
  const ballDontLieKey = env('BALLDONTLIE_KEY');
  if (ballDontLieKey && env('BALLDONTLIE_BASE_URL')) providers.push(ballDontLieProvider(env('BALLDONTLIE_BASE_URL') as string, ballDontLieKey));
  const serpApiKey = env('SERPAPI_API_KEY');
  const firecrawlKey = env('FIRECRAWL_API_KEY');
  if (serpApiKey) {
    const serp = new SerpApiResearchProvider(serpApiKey);
    providers.push(serp);
    if (firecrawlKey) providers.push(new FirecrawlResearchProvider(firecrawlKey, serp));
  }
  const openAiKey = env('OPENAI_API_KEY') ?? env('VITE_OPENAI_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const openAiSynthesizer = openAiKey ? new OpenAiResearchSynthesizer({ apiKey: openAiKey, model: env('OPENAI_MODEL') ?? env('AI_MODEL') }) : undefined;
  const anthropicSynthesizer = anthropicKey ? new AnthropicResearchSynthesizer({ apiKey: anthropicKey, model: env('ANTHROPIC_MODEL') }) : undefined;
  const synthesizer = anthropicSynthesizer ? new FallbackResearchSynthesizer({ primary: openAiSynthesizer, fallback: anthropicSynthesizer }) : openAiSynthesizer;
  return { agent: new ResearchAgent({ providers, synthesizer }), availability, espnProjection: espnBaseUrl ? new EspnProjectionClient(espnBaseUrl) : undefined, anthropicKey, anthropicModel: env('ANTHROPIC_MODEL') };
}

export interface RunOptions { lineupMode?: string; minSalaryUsed?: number; maxSharedPlayers?: number; }

export async function processRun(db: SupabaseClient, run: Json, slate: ValidatedSlate, runOptions: RunOptions = {}): Promise<Json> {
  assertSlate(slate);
  // LIVE is an explicit mode, never inferred from an old slate or wall-clock time. Keep the
  // validated facts in stage diagnostics so downstream stages can audit exactly what was used.
  const liveState = buildLiveStatePackage(slate);
  await persistConfiguration(db, String(run.tenant_id));
  const { agent, availability, espnProjection, anthropicKey, anthropicModel } = providerSet();
  const stages: Record<string, unknown> = {};
  if (liveState) stages.liveState = { status: liveState.status, source: liveState.source, observedAt: liveState.observedAt, warnings: liveState.warnings };
  let workingSlate = slate;
  let cfbSportsDataRosterAvailable = false;
  if (availability) {
    try {
      const availabilitySnapshot = await availability.getAvailabilitySnapshot(workingSlate);
      cfbSportsDataRosterAvailable = workingSlate.sport === 'CFB' && availabilitySnapshot.rosterComplete === true;
      workingSlate = applyAvailabilitySnapshot(workingSlate, availabilitySnapshot, new Date());
    }
    catch (error) { const message = error instanceof Error ? error.message : 'Availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `Availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
    if (workingSlate.sport === 'GOLF') {
      try {
        const refresh = await availability.getGolfTournamentProjectionInputs(workingSlate);
        const byName = new Map<string, Record<string, unknown> | null>();
        const byDraftKingsId = new Map<string, Record<string, unknown> | null>();
        for (const row of refresh.rows) {
          const names = [row.DraftKingsName, row.Name, row.name].map((value) => normalizeProviderName(String(value ?? ''))).filter(Boolean);
          for (const name of names) byName.set(name, byName.has(name) ? null : row);
          const dkId = String(row.DraftKingsPlayerID ?? row.DraftKingsPlayerId ?? '').trim();
          if (dkId) byDraftKingsId.set(dkId, byDraftKingsId.has(dkId) ? null : row);
        }
        const missing: string[] = [];
        const refreshedPlayers = workingSlate.playerPool.map((player) => {
          const dkId = player.identity?.draftKingsId ?? player.playerId;
          const idMatch = byDraftKingsId.get(dkId);
          const row = idMatch || byName.get(normalizeProviderName(player.playerName));
          if (!row) { missing.push(player.playerName); return player; }
          const providerId = String(row.PlayerID ?? row.PlayerId ?? row.playerId ?? '').trim();
          const identity = providerId ? { ...player.identity, sportsDataIoId: providerId, confidence: idMatch ? 'EXACT' as const : 'HIGH' as const, matchedBy: idMatch ? 'PROVIDER_ID' as const : 'NAME_ONLY' as const } : player.identity;
          return { ...player, ...(identity ? { identity } : {}), projectionInputs: { birdiesPerRound: Number(row.birdiesPerRound), eaglesPerRound: Number(row.eaglesPerRound), bogeysPerRound: Number(row.bogeysPerRound), parsPerRound: Number(row.parsPerRound), roundsRemaining: Number(row.roundsRemaining) } };
        });
        workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
        const warnings = [refresh.warning ?? 'SportsDataIO Golf projection refresh completed.'];
        if (missing.length) warnings.push(`SportsDataIO Golf projections did not match ${missing.length} DraftKings player(s) by DraftKings player ID or normalized provider name: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? `, and ${missing.length - 12} more` : ''}.`);
        stages.projectionDataSourceWarnings = [...((stages.projectionDataSourceWarnings as string[] | undefined) ?? []), ...warnings];
      } catch (error) { stages.projectionDataSourceWarnings = [...((stages.projectionDataSourceWarnings as string[] | undefined) ?? []), error instanceof Error ? error.message : 'SportsDataIO Golf projection refresh failed.']; }
    }
    // Providers may not return a matching row for every player. That no longer removes the
    // player from the slate here — projectSlate's own gap logic (which also checks
    // projectionInputs, populated below) is the single source of truth for whether a player
    // is quantitatively projectable; excluding them upstream would silently drop a player who
    // could still be projected from rate stats even without a raw FPPG number.
    //
    // MLB/NBA/WNBA/NFL/CFB use real season-to-date stats (PlayerSeasonStats) rather than SportsDataIO's
    // PlayerGameProjectionStatsByDate -- verified live that the latter is obfuscated/scaled down
    // on this account's free trial tier (every text field literally reads "Scrambled", and a real
    // game's combined plate-appearance total came back at ~1/3 of a plausible value), while
    // PlayerSeasonStats' numeric totals check out as real. WNBA's PlayerSeasonStats route is
    // under the scores subfeed (not stats); SportsDataIoClient selects that documented route.
    if (['MLB', 'NBA', 'WNBA', 'NFL', 'CFB'].includes(workingSlate.sport)) {
      try {
        let seasonParam = seasonParamFor(workingSlate.sport, workingSlate.event.eventDate);
        let seasonRows = await availability.getSeasonStats(workingSlate.sport, seasonParam);
        let seasonFallbackNote = '';
        // NFL/CFB specifically: early in a season, the current year may have no usable rows for
        // the selected players. Fall back to the most recently completed season rather than
        // projecting from an empty data set.
        if ((workingSlate.sport === 'NFL' || workingSlate.sport === 'CFB') && !seasonRows.some((row) => gamesPlayedFromRow(row) > 0)) {
          seasonParam = seasonParamFor(workingSlate.sport, workingSlate.event.eventDate, -1);
          seasonRows = await availability.getSeasonStats(workingSlate.sport, seasonParam);
          seasonFallbackNote = ` (current season not yet underway; using ${seasonParam} instead)`;
        }
        let priorSeasonRows: Record<string, unknown>[] = [];
        let priorSeasonParam = '';
        if (['MLB', 'NFL', 'CFB'].includes(workingSlate.sport)) {
          const currentSeasonMissing = workingSlate.playerPool.some((player) => { const row = findRow(player, seasonRows, workingSlate.sport === 'MLB'); return !row || gamesPlayedFromRow(row) <= 0; });
          if (currentSeasonMissing) {
            priorSeasonParam = seasonParamFor(workingSlate.sport, workingSlate.event.eventDate, -1);
            priorSeasonRows = await availability.getSeasonStats(workingSlate.sport, priorSeasonParam);
          }
          // Fetch the prior season whenever current-season data exists too, so the projection
          // stage can blend both verified samples instead of switching abruptly at a row-level
          // cutoff. The blend weights are explicit provisional model policy (not calibration).
          if (!priorSeasonRows.length) {
            priorSeasonParam = seasonParamFor(workingSlate.sport, workingSlate.event.eventDate, -1);
            priorSeasonRows = await availability.getSeasonStats(workingSlate.sport, priorSeasonParam);
          }
        }
        const missingPlayers: string[] = [];
        const priorSeasonPlayers: string[] = [];
        const blendedPlayers: string[] = [];
        const teamMismatchPlayers: string[] = [];
        const refreshedPlayers = workingSlate.playerPool.map((player) => {
          // Historical team changes are a permitted fallback for MLB only. NFL/CFB
          // same-name cross-team matches can attach another player's production.
          const allowTeamMismatch = workingSlate.sport === 'MLB';
          const currentRow = findRow(player, seasonRows, allowTeamMismatch);
          const currentGames = currentRow ? gamesPlayedFromRow(currentRow) : 0;
          const priorRow = findRow(player, priorSeasonRows, allowTeamMismatch);
          const row = currentRow && currentGames > 0 ? currentRow : priorRow;
          const games = row ? gamesPlayedFromRow(row) : 0;
          if (!row || games <= 0) { missingPlayers.push(player.playerName); return player; }
          if (row !== currentRow) priorSeasonPlayers.push(player.playerName);
          const providerTeam = normalizeTeamCode(String(row.Team ?? row.team ?? row.TeamAbbreviation ?? ''));
          const slateTeam = normalizeTeamCode(String(player.team ?? ''));
          if (providerTeam && slateTeam && providerTeam !== slateTeam) teamMismatchPlayers.push(`${player.playerName} (${slateTeam} slate / ${providerTeam} stats)`);
          const dkPoints = Number(row.FantasyPointsDraftKings ?? NaN);
          const currentWeight = workingSlate.sport === 'CFB' || workingSlate.sport === 'NFL' ? (currentGames >= 4 ? 0.7 : 0.5) : 0.7;
          const weighted = deriveWeightedSeasonInputs(workingSlate.sport, player, seasonRows, priorSeasonRows, currentWeight, { allowTeamMismatch });
          const inputs = weighted.inputs;
          if (weighted.usedPrior && currentRow && currentGames > 0 && priorRow) blendedPlayers.push(player.playerName);
          const providerId = String(row.PlayerID ?? row.PlayerId ?? row.playerId ?? row.PlayerKey ?? row.playerKey ?? '').trim();
          const identity = providerId ? { ...player.identity, sportsDataIoId: providerId, confidence: 'HIGH' as const, matchedBy: player.identity?.matchedBy === 'DRAFTKINGS' ? 'NAME_AND_TEAM' as const : player.identity?.matchedBy ?? 'NAME_AND_TEAM' as const } : player.identity;
          return { ...player, ...(identity ? { identity } : {}), ...(Number.isFinite(dkPoints) ? { providerFppg: dkPoints / games } : {}), ...(inputs ? { projectionInputs: inputs } : {}) };
        });
        workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
        const dataSourceNote = `Projected from ${seasonParam} season-to-date stats (SportsDataIO)${seasonFallbackNote}, not a live day-of projection.`;
        const warnings = [dataSourceNote];
        if (priorSeasonPlayers.length) warnings.push(`Used ${priorSeasonParam} season baseline for ${priorSeasonPlayers.length} ${workingSlate.sport} players without current-season stats: ${priorSeasonPlayers.join(', ')}.`);
        if (blendedPlayers.length) warnings.push(`Blended current and ${priorSeasonParam} season SportsDataIO rates for ${blendedPlayers.length} ${workingSlate.sport} players using provisional current-season weights; this weighting is not outcome-calibrated.`);
        if (teamMismatchPlayers.length) warnings.push(`Matched unique player-name stats across a team change for ${teamMismatchPlayers.length} ${workingSlate.sport} players: ${teamMismatchPlayers.join(', ')}.`);
        if (missingPlayers.length) warnings.push(`No current or ${priorSeasonParam || 'prior'} season stats found for ${missingPlayers.length} ${workingSlate.sport} players: ${missingPlayers.join(', ')}.`);
        stages.projectionDataSourceWarnings = warnings;
      } catch (error) { stages.projectionDataSourceWarnings = [error instanceof Error ? error.message : 'SportsDataIO season-stats refresh failed.']; }
    }
    if (workingSlate.sport === 'MLB') {
      try {
        const date = new Date(workingSlate.event.eventDate).toISOString().slice(0, 10);
        const games = await availability.getMlbGameWeather(date);
        const teams = new Set(workingSlate.playerPool.map((player) => normalizeTeamCode(String(player.team ?? ''))));
        const game = games.find((row) => teams.has(normalizeTeamCode(row.homeTeam ?? '')) && teams.has(normalizeTeamCode(row.awayTeam ?? '')));
        const retrievedAt = new Date().toISOString();
        const players = await Promise.all(workingSlate.playerPool.map(async (player) => {
          const isPitcher = /^(SP|RP|P)$/i.test(String(player.position ?? ''));
          const id = player.identity?.sportsDataIoId;
          let projectionInputs = player.projectionInputs;
          if (isPitcher && id) {
            try {
              const logs = await availability.getMlbPlayerGameLogs(seasonParamFor('MLB', workingSlate.event.eventDate), id, 10);
              const lock = new Date(workingSlate.contest.lockTime).getTime();
              const preLockLogs = logs.filter((row) => {
                const timestamp = Date.parse(String(row.DateTime ?? row.Day ?? row.Date ?? ''));
                return Number.isFinite(timestamp) && timestamp < lock;
              });
              const starts = preLockLogs.filter((row) => row.Started === true || Number(row.Started) === 1 || Number(row.PitchingGamesStarted ?? row.GamesStarted ?? 0) > 0);
              const innings = starts.flatMap((row) => {
                const value = Number(row.InningsPitchedDecimal ?? row.InningsPitched ?? NaN);
                return Number.isFinite(value) && value > 0 ? [value] : [];
              }).slice(0, 5);
              if (innings.length && projectionInputs?.expectedInnings !== undefined) {
                const recentAverage = innings.reduce((sum, value) => sum + value, 0) / innings.length;
                projectionInputs = { ...projectionInputs, expectedInnings: projectionInputs.expectedInnings * 0.5 + recentAverage * 0.5 };
              }
            } catch (error) {
              stages.workloadWarnings = [...((stages.workloadWarnings as string[] | undefined) ?? []), `Recent MLB workload unavailable for ${player.playerName}: ${error instanceof Error ? error.message : 'feed request failed'}.`];
            }
          }
          const team = normalizeTeamCode(String(player.team ?? ''));
          const gameWeather = game && [game.homeTeam, game.awayTeam].some((value) => normalizeTeamCode(value ?? '') === team) ? {
            ...(game.temperatureLow !== undefined ? { temperatureLow: game.temperatureLow } : {}),
            ...(game.temperatureHigh !== undefined ? { temperatureHigh: game.temperatureHigh } : {}),
            ...(game.windSpeed !== undefined ? { windSpeed: game.windSpeed } : {}),
            ...(game.windDirection ? { windDirection: game.windDirection } : {}),
            ...(game.description ? { description: game.description } : {}), retrievedAt,
          } : undefined;
          return { ...player, ...(projectionInputs ? { projectionInputs } : {}), ...(gameWeather ? { sportContext: { ...player.sportContext, mlb: { ...player.sportContext?.mlb, gameWeather } } } : {}) };
        }));
        workingSlate = { ...workingSlate, playerPool: players };
        if (!game) stages.weatherWarning = `SportsDataIO returned no matching MLB game weather record for ${date}; no weather adjustment was applied.`;
        else stages.weatherWarning = 'SportsDataIO game-day forecast fields were attached to MLB player context. No unvalidated numeric weather multiplier was applied.';
      } catch (error) {
        stages.weatherWarning = `MLB game-day forecast lookup failed: ${error instanceof Error ? error.message : 'provider request failed'}.`;
      }
    }
    if (workingSlate.sport === 'WNBA') {
      try {
        const recentRows = await availability.getWnbaRecentMinutes(workingSlate.event.eventDate, 28);
        const byId = new Map(recentRows.flatMap((row) => row.playerId ? [[row.playerId, row.minutes] as const] : []));
        const byNameTeam = new Map(recentRows.flatMap((row) => row.name ? [[`${normalizeProviderName(row.name)}|${normalizeTeamCode(row.team ?? '')}`, row.minutes] as const] : []));
        let matched = 0;
        const playerPool = workingSlate.playerPool.map((player) => {
          const samples = (player.identity?.sportsDataIoId ? byId.get(player.identity.sportsDataIoId) : undefined)
            ?? byNameTeam.get(`${normalizeProviderName(player.playerName)}|${normalizeTeamCode(String(player.team ?? ''))}`);
          if (!samples?.length) return player;
          matched += 1;
          const ordered = [...samples].sort((a, b) => a - b);
          const quantile = (q: number) => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * q))];
          const recentMedian = quantile(0.5);
          const expectedMinutes = player.projectionInputs?.expectedMinutes;
          const minutesP50 = expectedMinutes !== undefined ? expectedMinutes * 0.5 + recentMedian * 0.5 : recentMedian;
          const minutesP10 = Math.min(quantile(0.1), minutesP50);
          const minutesP90 = Math.max(quantile(0.9), minutesP50);
          return { ...player, projectionInputs: { ...player.projectionInputs, expectedMinutes: minutesP50, minutesP10, minutesP90 }, sportContext: { ...player.sportContext, nba: { ...player.sportContext?.nba, minutesP10, minutesP50, minutesP90 } } };
        });
        workingSlate = { ...workingSlate, playerPool };
        stages.wnbaMinutesHistory = { source: 'SportsDataIO final BoxScores', lookbackDays: 28, playersMatched: matched, playerPoolSize: playerPool.length, retrievedAt: new Date().toISOString() };
        if (matched < playerPool.length) stages.wnbaMinutesWarning = `Recent WNBA minutes were available for ${matched}/${playerPool.length} players. Missing histories retain season-based minutes; role uncertainty remains provisional.`;
      } catch (error) {
        stages.wnbaMinutesWarning = `Recent WNBA game minutes lookup failed: ${error instanceof Error ? error.message : 'provider request failed'}.`;
      }
    }
  }
  // SportsDataIO is authoritative for CFB roster membership and injury status when its complete
  // team rosters resolve. It intentionally cannot confirm college starters. ESPN remains a
  // fallback only when SportsDataIO could not resolve a complete CFB roster.
  if (espnProjection && ['NBA', 'WNBA', 'NFL', 'CFB'].includes(workingSlate.sport)) {
    if (workingSlate.sport !== 'CFB' || !cfbSportsDataRosterAvailable) try { workingSlate = applyAvailabilitySnapshot(workingSlate, await espnProjection.getAvailabilitySnapshot(workingSlate), new Date()); }
    catch (error) { const message = error instanceof Error ? error.message : 'ESPN availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `ESPN availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
  }
  if (['NFL', 'CFB'].includes(workingSlate.sport)) {
    const notReady = workingSlate.playerPool.flatMap((player) => {
      const readiness = projectionReadiness(workingSlate.sport, player);
      return readiness.ready ? [] : [{ player, missing: readiness.missing }];
    });
    if (notReady.length) {
      const names = notReady.map(({ player }) => player.playerName);
      const warning = `${notReady.length} ${workingSlate.sport} player(s) removed from the primary slate because neither complete structured projection inputs nor an explicit provider FPPG fallback was available: ${names.slice(0, 12).join(', ')}${names.length > 12 ? `, and ${names.length - 12} more` : ''}.`;
      stages.projectionDataSourceWarnings = [...((stages.projectionDataSourceWarnings as string[] | undefined) ?? []), warning];
      workingSlate = { ...workingSlate, playerPool: workingSlate.playerPool.filter((player) => !notReady.some((item) => item.player.playerId === player.playerId)) };
    }
  }
  if (espnProjection && (workingSlate.sport === 'NBA' || workingSlate.sport === 'WNBA')) {
    try {
      const projections = await espnProjection.getBasketballProjectionSnapshot(workingSlate);
      const byNameAndTeam = new Map(projections.map((projection) => [`${normalizeProjectionName(projection.name)}:${normalizeProjectionTeam(projection.team)}`, projection]));
      const missingProjectionPlayers: string[] = [];
      const refreshedPlayers = workingSlate.playerPool.map((player) => { const projection = byNameAndTeam.get(`${normalizeProjectionName(player.playerName)}:${normalizeProjectionTeam(String(player.team ?? ''))}`); if (!projection) { missingProjectionPlayers.push(player.playerName); return player; } return { ...player, providerFppg: projection.providerFppg }; });
      workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
      if (missingProjectionPlayers.length) stages.projectionWarning = `ESPN did not return season-average projections for ${missingProjectionPlayers.length} ${workingSlate.sport} players: ${missingProjectionPlayers.join(', ')}.`;
    } catch (error) { stages.projectionWarning = error instanceof Error ? error.message : 'ESPN projection refresh failed.'; }
  }
  // Real Vegas market context (implied team total from game total + spread) -- feeds the
  // ownership-leverage nudge (optimizer.ts) and real game-stack correlation (optimizer.ts).
  // Non-blocking like every other enrichment step above: no key, no sport support, or a fetch
  // failure just means players keep their existing (undefined) marketContext, never fabricated.
  const oddsKey = env('THE_ODDS_API_KEY') ?? env('ODDS_API_KEY');
  if (oddsKey && ['MLB', 'NBA', 'WNBA', 'NFL'].includes(workingSlate.sport)) {
    try {
      const marketContextBySport = await getTeamMarketContext(workingSlate.sport, oddsKey, { baseUrl: env('ODDS_API_BASE_URL') });
      if (marketContextBySport.size) {
        const refreshedPlayers = workingSlate.playerPool.map((player) => {
          const context = player.team ? marketContextBySport.get(normalizeTeamCode(player.team)) : undefined;
          return context ? { ...player, marketContext: { impliedTeamTotal: context.impliedTeamTotal, spread: context.spread, gameTotal: context.gameTotal } } : player;
        });
        workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
      } else {
        stages.marketContextWarning = 'The Odds API returned no matching market data for this slate\'s teams.';
      }
    } catch (error) { stages.marketContextWarning = error instanceof Error ? error.message : 'Vegas market-context refresh failed.'; }
  }
  await saveStage(db, run, 'SLATE', { rawSlate: slate, enrichedSlate: workingSlate }, workingSlate, workingSlate.validation.status, workingSlate.validation.warnings, workingSlate.validation.errors);
  let research = await agent.run({ validatedSlate: workingSlate });
  const criticalGaps = (research.unknowns ?? []).filter((unknown) => unknown.importance === 'CRITICAL');
  if (criticalGaps.length) research = await agent.run({ validatedSlate: workingSlate, researchGaps: criticalGaps });
  assertResearch(research);
  stages.research = research;
  await saveStage(db, run, 'RESEARCH', { slate: workingSlate }, research, research.status, [], []);
  const researchVersion = await nextVersion(db, 'floyd_dfs_research_runs', String(run.id));
  const researchRun = await db.from('floyd_dfs_research_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: researchVersion, research_plan: { slateId: workingSlate.slateId }, research_package: research, status: research.status, model_name: openAiModel(), prompt_version: 'research.v1' }).select('id').single();
  if (researchRun.error) throw researchRun.error;
  if (research.findings.length) { const findings = await db.from('floyd_dfs_research_findings').insert(research.findings.map((finding) => ({ tenant_id: run.tenant_id, research_run_id: researchRun.data.id, bucket: finding.bucket, subject_type: finding.subjectType ?? 'EVENT', subject_id: finding.subjectId, finding: finding.finding, source_name: finding.sourceName, source_url: finding.sourceUrl ?? null, source_tier: finding.sourceTier ?? 4, source_purpose: finding.sourcePurpose ?? null, published_at: finding.publishedAt ?? null, retrieved_at: finding.retrievedAt ?? research.generatedAt, confidence: finding.confidence, metadata: finding.metadata ?? {} }))); if (findings.error) throw findings.error; }
  if ((research.unknowns ?? []).length) { const watchItems = await db.from('floyd_dfs_watch_items').insert((research.unknowns ?? []).map((unknown) => ({ tenant_id: run.tenant_id, generation_run_id: run.id, subject: unknown.question, importance: unknown.importance, current_state: { reason: unknown.reason }, trigger_condition: { expectedChangeBeforeLock: true }, affected_player_ids: workingSlate.playerPool.map((player) => player.playerId), affected_lineup_ids: [], expected_update_at: workingSlate.contest.lockTime, status: 'active' }))); if (watchItems.error) throw watchItems.error; }
  let adjustment = adjustSlate(workingSlate, research);
  const adjustmentKey = env('OPENAI_API_KEY');
  if ((adjustmentKey || anthropicKey) && adjustment.status !== 'BLOCKED') {
    try {
      if (adjustmentKey) adjustment = await adjustWithOpenAi({ slate: workingSlate, research, baseline: adjustment }, { apiKey: adjustmentKey, model: openAiModel() });
      else adjustment = await adjustWithAnthropic({ slate: workingSlate, research, baseline: adjustment }, { apiKey: anthropicKey!, model: anthropicModel });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI Sport Adjustment failed.';
      if (anthropicKey) {
        try { adjustment = await adjustWithAnthropic({ slate: workingSlate, research, baseline: adjustment }, { apiKey: anthropicKey, model: anthropicModel }); stages.adjustmentWarning = `${message} Anthropic fallback used successfully.`; }
        catch (fallbackError) { const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Anthropic Sport Adjustment fallback failed.'; stages.adjustmentWarning = `${message} Anthropic fallback failed: ${fallbackMessage} Deterministic specialist retained.`; adjustment = { ...adjustment, warnings: [...(adjustment.warnings ?? []), stages.adjustmentWarning as string] }; }
      } else { stages.adjustmentWarning = `${message} Anthropic fallback unavailable because ANTHROPIC_API_KEY is not configured.`; adjustment = { ...adjustment, warnings: [...(adjustment.warnings ?? []), stages.adjustmentWarning as string] }; }
    }
  }
  assertAdjustment(adjustment, research);
  stages.adjustment = adjustment;
  await saveStage(db, run, 'SPORT_ADJUSTMENT', { slate: workingSlate, research }, adjustment, adjustment.status, [...(adjustment.warnings ?? []), ...((stages.adjustmentWarning as string | undefined) ? [stages.adjustmentWarning as string] : [])]);
  const adjustmentVersion = await nextVersion(db, 'floyd_dfs_adjustment_runs', String(run.id));
  const adjustmentRun = await db.from('floyd_dfs_adjustment_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: adjustmentVersion, sport: adjustment.sport, adjustment_package: adjustment, status: adjustment.status, model_name: openAiModel(), prompt_version: 'sport-adjustment.deterministic.v1' }).select('id').single();
  if (adjustmentRun.error) throw adjustmentRun.error;
  const adjustmentRows = await db.from('floyd_dfs_player_adjustments').insert(adjustment.adjustments.flatMap((player) => player.adjustments.map((item) => ({ tenant_id: run.tenant_id, adjustment_run_id: adjustmentRun.data.id, player_id: player.playerId, adjustment_type: item.adjustmentType ?? 'CONTEXT', direction: item.direction ?? 'NEUTRAL', magnitude: item.magnitude, confidence: item.confidence, rationale: item.rationale ?? player.projectionNotes[0] ?? 'No additional rationale.', evidence_finding_ids: item.evidenceFindingIds ?? [], metadata: { roleCertainty: player.roleCertainty } }))));
  if (adjustmentRows.error) throw adjustmentRows.error;
  const projection = projectSlate(workingSlate, adjustment);
  const projectionWarnings = (stages.projectionDataSourceWarnings as string[] | undefined) ?? [];
  if (workingSlate.sport === 'GOLF' && projection.status === 'BLOCKED' && projectionWarnings.length) {
    projection.gaps.push({ reason: `Golf provider diagnostics: ${projectionWarnings.join(' ')}` });
  }
  assertProjection(projection);
  stages.projection = projection;
  await saveStage(db, run, 'PROJECTION', { slate: workingSlate, adjustment }, projection, projection.status, (stages.projectionDataSourceWarnings as string[] | undefined) ?? []);
  const projectionVersion = await nextVersion(db, 'floyd_dfs_projection_runs', String(run.id));
  const projectionRun = await db.from('floyd_dfs_projection_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: projectionVersion, sport: projection.sport, model_version: projection.modelVersion, simulation_runs: projection.simulationRuns, projection_package: projection, status: projection.status }).select('id').single();
  if (projectionRun.error) throw projectionRun.error;
  const projectionRows = await db.from('floyd_dfs_player_projections').insert(projection.players.map((player) => ({ tenant_id: run.tenant_id, projection_run_id: projectionRun.data.id, player_id: player.playerId, baseline_opportunity: player.baselineOpportunity, adjusted_opportunity: player.adjustedOpportunity, opportunity_delta: player.opportunityDelta, component_projection: player.componentProjection, simulated_fantasy_point_samples: player.simulatedFantasyPointSamples ?? [], distribution: player.distribution ?? {}, model_path: player.modelPath ?? 'UNKNOWN_LEGACY', floor_p20: player.projectedOutcomes.floorP20, median_p50: player.projectedOutcomes.medianP50, ceiling_p90: player.projectedOutcomes.ceilingP90, median_per_1k: player.salaryEfficiency.medianPer1k, ceiling_per_1k: player.salaryEfficiency.ceilingPer1k, confidence: player.confidence, uncertainty_factors: player.uncertaintyFactors, watch_dependencies: player.watchDependencies, model_version: player.modelVersion })));
  if (projectionRows.error) throw projectionRows.error;
  const rosterSize = workingSlate.rosterRules.rosterSize;
  const multiEntryGpp = workingSlate.contest.contestKind === 'GPP' && workingSlate.contest.userEntryCount > 1;
  const maxLineupOverlap = runOptions.maxSharedPlayers !== undefined && rosterSize > 0
    ? Math.min(1, runOptions.maxSharedPlayers / rosterSize)
    : multiEntryGpp ? 0.6 : undefined;
  const portfolioConstraints = multiEntryGpp
    ? { ...(maxLineupOverlap !== undefined ? { maxLineupOverlap } : {}), ...(workingSlate.contest.format === 'SHOWDOWN' ? { maxCaptainExposure: 0.5 } : {}) }
    : maxLineupOverlap !== undefined ? { maxLineupOverlap } : undefined;
  const optimizer = optimizeLineups({ validatedSlate: workingSlate, projectionPackage: projection }, { lineupMode: runOptions.lineupMode, minSalaryUsed: runOptions.minSalaryUsed, ...(portfolioConstraints ? { portfolioConstraints } : {}) });
  assertOptimizer(optimizer, workingSlate);
  assertContestMetrics(optimizer);
  stages.optimizer = optimizer;
  await saveStage(db, run, 'OPTIMIZE', { slate: workingSlate, projection }, optimizer, optimizer.status);
  const optimizationVersion = await nextVersion(db, 'floyd_dfs_optimization_runs', String(run.id));
  const optimizationRun = await db.from('floyd_dfs_optimization_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: optimizationVersion, objective_profile: optimizer.objectiveProfile, optimizer_package: optimizer, status: optimizer.status }).select('id').single();
  if (optimizationRun.error) throw optimizationRun.error;
  const candidateRows = await db.from('floyd_dfs_lineup_candidates').insert(optimizer.candidates.map((candidate) => ({ tenant_id: run.tenant_id, optimization_run_id: optimizationRun.data.id, candidate_key: candidate.id, salary_used: candidate.salaryUsed, salary_remaining: candidate.salaryRemaining, floor: candidate.floor, median: candidate.median, ceiling: candidate.ceiling, correlation_score: candidate.correlationScore, median_rank: candidate.medianRank, ceiling_rank: candidate.ceilingRank, candidate_types: candidate.candidateTypes, roster_slots: candidate.rosterSlots, game_script_cluster: candidate.gameScriptCluster, strategic_similarity: candidate.strategicSimilarity, risk_flags: candidate.riskFlags, ...(candidate.variance !== undefined ? { variance: candidate.variance } : {}), ...(candidate.winFrequency !== undefined ? { win_frequency: candidate.winFrequency } : {}), ...(candidate.topOnePercentFrequency !== undefined ? { top_one_percent_frequency: candidate.topOnePercentFrequency } : {}), ...(candidate.cashFrequency !== undefined ? { cash_frequency: candidate.cashFrequency } : {}), ...(candidate.expectedDuplicates !== undefined ? { expected_duplicates: candidate.expectedDuplicates } : {}), ...(candidate.expectedPayout !== undefined ? { expected_payout: candidate.expectedPayout } : {}), ...(candidate.roi !== undefined ? { roi: candidate.roi } : {}), contest_metric_provenance: candidate.contestMetricProvenance ?? 'UNAVAILABLE' })));
  if (candidateRows.error) throw candidateRows.error;
  const calibration = await loadCashLineCalibration(db, String(run.tenant_id));
  const selection = selectLineups({ validatedSlate: workingSlate, researchPackage: research, optimizerPackage: optimizer, cashLineCalibration: calibration });
  assertSelection(selection, optimizer);
  stages.selection = selection;
  await saveStage(db, run, 'SELECTION', { slate: workingSlate, research, optimizer }, selection, selection.status, selection.warnings ?? []);
  const selectionVersion = await nextVersion(db, 'floyd_dfs_selection_runs', String(run.id));
  const selectionRun = await db.from('floyd_dfs_selection_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: selectionVersion, selection_package: selection, status: selection.status }).select('id').single();
  if (selectionRun.error) throw selectionRun.error;
  if (selection.selectedLineups.length) {
    const cashLine = optimizer.cashLineEstimate?.value ?? workingSlate.contest.cashLine;
    const lineups = selection.selectedLineups.map((lineup) => {
      const rawProbability = cashLine ? rawCashLineProbability({ median: lineup.median, floor: lineup.floor, ceiling: lineup.ceiling, cashLine }) : null;
      const calibratedProbability = calibratedCashLineProbability(rawProbability, calibration);
      return { tenant_id: run.tenant_id, selection_run_id: selectionRun.data.id, candidate_key: lineup.candidateId, bullet_number: lineup.bulletNumber, selection_type: lineup.selectionType, lineup_payload: lineup, status: 'GENERATED', cash_line: cashLine ?? null, raw_cash_line_probability: rawProbability, cash_line_probability: calibratedProbability, cash_line_calibration_status: calibration.status, cash_line_calibration_version: CASH_LINE_CALIBRATION_VERSION };
    });
    const inserted = await db.from('floyd_dfs_generated_lineups').insert(lineups);
    if (inserted.error) throw inserted.error;
  }
  await persistEvidenceLedger(db, { tenantId: String(run.tenant_id), runId: String(run.id), slate: workingSlate, rawSlate: slate, research, adjustment, projection, optimizer, selection });
  const blockedReason = selection.status === 'BLOCKED'
    ? [...(optimizer.gaps ?? []), ...(projection.gaps ?? []).map((gap) => gap.reason), ...(selection.optimizerGap ? [selection.optimizerGap] : [])].filter(Boolean).join(' ')
    : undefined;
  const finalState = selection.status === 'BLOCKED' ? 'blocked' : 'complete';
  const finalError = blockedReason ? { message: blockedReason, stage: 'SELECTION' as const } : null;
  await db.from('generation_runs').update({ state: finalState, current_stage: 'SELECTION', error: finalError }).eq('id', run.id);
  return { ...run, state: finalState, error: finalError, current_stage: 'SELECTION', stages, lineups: selection.selectedLineups };
}

async function loadCashLineCalibration(db: SupabaseClient, tenantId: string) {
  const lineups = await db.from('floyd_dfs_generated_lineups').select('id,raw_cash_line_probability').eq('tenant_id', tenantId).not('raw_cash_line_probability', 'is', null).limit(5000);
  if (lineups.error) throw lineups.error;
  const results = await db.from('floyd_dfs_contest_results').select('generated_lineup_id,beat_cash_line').eq('tenant_id', tenantId).not('beat_cash_line', 'is', null).limit(5000);
  if (results.error) throw results.error;
  const rawById = new Map((lineups.data ?? []).map((row) => [String(row.id), Number(row.raw_cash_line_probability)]));
  const observations: CashLineObservation[] = (results.data ?? []).flatMap((row) => {
    const raw = rawById.get(String(row.generated_lineup_id));
    return raw === undefined ? [] : [{ rawProbability: raw, beatCashLine: row.beat_cash_line === true }];
  });
  return buildCashLineCalibration(observations);
}
async function persistConfiguration(db: SupabaseClient, tenantId: string): Promise<void> {
  const models = [
    { tenant_id: tenantId, stage: 'RESEARCH', provider: 'OPENAI', model: openAiModel() ?? 'disabled', version: 1, parameters: { structuredOutput: true }, active: true },
    { tenant_id: tenantId, stage: 'SELECTION', provider: 'OPENAI', model: openAiModel() ?? 'deterministic-fallback', version: 1, parameters: { candidateOnly: true }, active: true },
    { tenant_id: tenantId, stage: 'PROJECTION', provider: 'DETERMINISTIC', model: 'projection.deterministic.v1', version: 1, parameters: { simulationRuns: 256 }, active: true },
  ];
  const modelResult = await db.from('model_configs').upsert(models, { onConflict: 'tenant_id,stage,provider,model,version' }); if (modelResult.error) throw modelResult.error;
  const templates = [
    { tenant_id: tenantId, stage: 'RESEARCH', name: 'research.v1', version: 1, template: 'DraftKings research evidence extraction with seven buckets and source-tier conflict handling.', active: true },
    { tenant_id: tenantId, stage: 'SELECTION', name: 'selection.v1', version: 1, template: 'Select only optimizer candidates using contest context; never create or modify lineups.', active: true },
  ];
  const templateResult = await db.from('prompt_templates').upsert(templates, { onConflict: 'tenant_id,stage,name,version' }); if (templateResult.error) throw templateResult.error;
}

export function parseBody(req: VercelRequest): Json { if (!req.body) return {}; if (typeof req.body === 'string') return JSON.parse(req.body) as Json; return req.body as Json; }
function openAiModel(): string | undefined { return env('OPENAI_MODEL') ?? env('AI_MODEL') ?? ((env('OPENAI_API_KEY') ?? env('VITE_OPENAI_API_KEY')) ? 'gpt-5' : undefined); }
function normalizeProjectionName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeProjectionTeam(value: string): string { return normalizeTeamCode(value); }
export function asFormat(value: unknown): ContestFormat { return String(value ?? 'SHOWDOWN').toUpperCase() === 'CLASSIC' ? 'CLASSIC' : 'SHOWDOWN'; }
export function asSport(value: unknown): 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' | 'CFB' { const sport = String(value ?? '').toUpperCase(); if (['WNBA', 'NBA', 'MLB', 'GOLF', 'NFL', 'CFB'].includes(sport)) return sport as 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' | 'CFB'; throw new Error(`Unsupported sport: ${sport}.`); }
export type { Json };
