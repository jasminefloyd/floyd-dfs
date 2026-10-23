import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isOperator, parseBearer, secretMatches, tenantHeaderAllowed } from './authPolicy.mjs';
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
import { currentSeasonWeight, deriveWeightedSeasonInputs, findRow, gamesPlayedFromRow } from '../src/lib/engine/projectionInputs.js';
import type { ContestFormat, EngineStage, ValidatedSlate } from '../src/lib/engine/contracts.js';
import { parseValidatedSlate } from '../src/lib/engine/boundaryContracts.js';
import { persistEvidenceLedger } from './evidenceLedger.js';

type Json = Record<string, unknown>;

// Vercel loads project environment variables in production. The local Vercel
// runtime does not consistently load `.env.local`, so load it explicitly for
// local API handlers; missing files are harmless in production.
loadDotenv({ path: '.env.local' });

function env(name: string): string | undefined { const value = process.env[name]; return value?.trim() || undefined; }
function photoHostsFromEnv(): string[] { return (env('FDS_PLAYER_PHOTO_ALLOWED_HOSTS') ?? '').split(',').map((host) => host.trim()).filter(Boolean); }
function boundedIntegerEnv(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(env(name)); return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback; }
function requiredEnv(name: string, ...fallbackNames: string[]): string { const value = [name, ...fallbackNames].map(env).find(Boolean); if (!value) throw new Error(`Server environment variable ${name} is not configured.`); return value; }

export function serverSupabase(): SupabaseClient { return createClient(requiredEnv('SUPABASE_URL', 'VITE_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { transport: WebSocket as never } }); }

export class ApiError extends Error { readonly status: number; readonly code: string; constructor(status: number, message: string, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; } }
export interface TenantContext { db: SupabaseClient; tenantId: string; userId: string; role: 'member' | 'operator'; }
async function configuredTenantId(db: SupabaseClient): Promise<string> { const slug = requiredEnv('FDS_TENANT_SLUG'); const result = await db.from('tenants').select('id').eq('slug', slug).maybeSingle(); if (result.error) throw result.error; if (!result.data?.id) throw new ApiError(503, 'The configured application tenant is unavailable.', 'TENANT_NOT_CONFIGURED'); return String(result.data.id); }
function bearer(req: VercelRequest): string { const token = parseBearer(req.headers.authorization); if (!token) throw new ApiError(401, 'A valid bearer access token is required.', 'UNAUTHENTICATED'); return token; }
export async function tenantContext(req: VercelRequest): Promise<TenantContext> {
  const db = serverSupabase();
  const verified = await db.auth.getUser(bearer(req));
  if (verified.error || !verified.data.user) throw new ApiError(401, 'The access token is invalid or expired.', 'INVALID_TOKEN');
  const userId = verified.data.user.id;
  const tenantId = await configuredTenantId(db);
  const memberships = await db.from('tenant_memberships').select('tenant_id').eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle();
  if (memberships.error) throw memberships.error;
  if (!memberships.data) throw new ApiError(403, 'This account is not a member of the configured Floyd DFS tenant.', 'TENANT_FORBIDDEN');
  if (!tenantHeaderAllowed(tenantId, req.headers['x-tenant-id'])) throw new ApiError(403, 'This deployment is isolated to its configured tenant.', 'TENANT_FORBIDDEN');
  return { db, tenantId, userId, role: isOperator(userId, env('FDS_OPERATOR_USER_IDS')) ? 'operator' : 'member' };
}
export async function schedulerContext(req: VercelRequest): Promise<{ db: SupabaseClient; tenantId: string }> { const provided = parseBearer(req.headers.authorization); const expected = [env('FDS_SCHEDULER_BEARER_SECRET'), env('CRON_SECRET')].filter((value): value is string => Boolean(value)); if (!expected.length) throw new ApiError(503, 'FDS_SCHEDULER_BEARER_SECRET or CRON_SECRET must be configured.', 'AUTH_NOT_CONFIGURED'); if (!expected.some((secret) => secretMatches(provided, secret))) throw new ApiError(401, 'Invalid service authorization.', 'UNAUTHENTICATED'); const db = serverSupabase(); return { db, tenantId: await configuredTenantId(db) }; }
export async function workerTenantContext(req: VercelRequest): Promise<{ db: SupabaseClient; tenantId: string; worker: boolean }> { authorizeSecret(req, 'FDS_WORKER_BEARER_SECRET'); const db = serverSupabase(); const tenantId = await configuredTenantId(db); if (!tenantHeaderAllowed(tenantId, req.headers['x-tenant-id'])) throw new ApiError(403, 'This worker is isolated to its configured tenant.', 'TENANT_FORBIDDEN'); return { db, tenantId, worker: true }; }
export function hasWorkerAuthorization(req: VercelRequest): boolean { const expected = env('FDS_WORKER_BEARER_SECRET'); return Boolean(expected && secretMatches(parseBearer(req.headers.authorization), expected)); }
function authorizeSecret(req: VercelRequest, name: string): void { const expected = env(name); if (!expected) throw new ApiError(503, `${name} is not configured.`, 'AUTH_NOT_CONFIGURED'); const provided = parseBearer(req.headers.authorization); if (!secretMatches(provided, expected)) throw new ApiError(401, 'Invalid service authorization.', 'UNAUTHENTICATED'); }
export function requireOperator(context: TenantContext): void { if (context.role !== 'operator') throw new ApiError(403, 'Operator access is required.', 'FORBIDDEN'); }
export async function requireOwnedRun(context: TenantContext, runId: string): Promise<Json> { if (!runId || runId.length > 128) throw new ApiError(400, 'A valid run ID is required.', 'INVALID_ID'); const result = await context.db.from('generation_runs').select('*').eq('id', runId).eq('tenant_id', context.tenantId).eq('user_id', context.userId).maybeSingle(); if (result.error) throw result.error; if (!result.data) throw new ApiError(404, 'Run not found.', 'NOT_FOUND'); return result.data as Json; }
export async function requireOwnedLineup(context: TenantContext, lineupId: string): Promise<Json> { if (!lineupId || lineupId.length > 128) throw new ApiError(400, 'A valid lineup ID is required.', 'INVALID_ID'); const lineup = await context.db.from('floyd_dfs_generated_lineups').select('id,tenant_id,selection_run_id').eq('id', lineupId).eq('tenant_id', context.tenantId).maybeSingle(); if (lineup.error) throw lineup.error; if (!lineup.data) throw new ApiError(404, 'Lineup not found.', 'NOT_FOUND'); const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id').eq('id', lineup.data.selection_run_id).eq('tenant_id', context.tenantId).maybeSingle(); if (selection.error) throw selection.error; if (!selection.data) throw new ApiError(404, 'Lineup not found.', 'NOT_FOUND'); await requireOwnedRun(context, String(selection.data.generation_run_id)); return lineup.data as Json; }
export async function getOwnedLineupSlate(context: TenantContext, lineupId: string): Promise<ValidatedSlate | undefined> {
  const lineup = await requireOwnedLineup(context, lineupId);
  const selection = await context.db.from('floyd_dfs_selection_runs').select('generation_run_id').eq('id', String(lineup.selection_run_id)).eq('tenant_id', context.tenantId).maybeSingle();
  if (selection.error) throw selection.error;
  const run = await context.db.from('generation_runs').select('request_payload').eq('id', String(selection.data?.generation_run_id ?? '')).eq('tenant_id', context.tenantId).eq('user_id', context.userId).maybeSingle();
  if (run.error) throw run.error;
  const request = run.data?.request_payload as Json | undefined;
  const input = request?.input as Json | undefined;
  const slate = input?.validatedSlate;
  if (!slate || typeof slate !== 'object' || Array.isArray(slate)) return undefined;
  return parseValidatedSlate(slate as ValidatedSlate, context.tenantId);
}
export async function ownedSelectionRunIds(context: TenantContext): Promise<string[]> { const runs = await context.db.from('generation_runs').select('id').eq('tenant_id', context.tenantId).eq('user_id', context.userId); if (runs.error) throw runs.error; const ids = (runs.data ?? []).map((row) => String(row.id)); if (!ids.length) return []; const selections = await context.db.from('floyd_dfs_selection_runs').select('id').eq('tenant_id', context.tenantId).in('generation_run_id', ids); if (selections.error) throw selections.error; return (selections.data ?? []).map((row) => String(row.id)); }

export function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = String(req.headers.origin ?? '');
  const allowed = new Set(['https://floyd-dfs.vercel.app', 'http://127.0.0.1:5178', 'http://localhost:5178']);
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID');
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
    const safeMessage = "DraftKings denied this server-side API request (HTTP 403). Contest discovery may still work, but detailed contest and player-pool data is currently blocked from this deployment.";
    res.status(502).json({
      error: safeMessage,
      safeMessage,
      code: 'PROVIDER_UNAVAILABLE',
      requestId: responseRequestId(req),
      retriable: false,
      stage: 'SLATE',
      reasons: [{ code: 'UPSTREAM_ACCESS_BLOCKED', message: 'The provider denied this request.' }],
      provider: 'DRAFTKINGS',
      upstreamStatus: 403,
      ...(upstreamEndpoint ? { upstreamEndpoint } : {}),
    });
    return;
  }
  const status = error instanceof ApiError ? error.status : 500;
  const safeMessage = errorMessage(error).replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]').replace(/((?:api[_-]?key|service[_-]?role[_-]?key|access[_-]?token|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  const legacyCode = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  res.status(status).json({ error: safeMessage, safeMessage, code: apiErrorCode(legacyCode, status), requestId: responseRequestId(req), retriable: status === 408 || status === 429 || status >= 500, reasons: [{ code: legacyCode, message: safeMessage }] });
}
function responseRequestId(req: VercelRequest): string { const value = String(req.headers['x-request-id'] ?? '').trim(); return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : requestId(); }
function apiErrorCode(code: string, status: number): import('../src/lib/engine/contracts.js').FdsApiError['code'] {
  if (['EMPTY_PLAYER_POOL','NO_LEGAL_LINEUP','PROVIDER_UNAVAILABLE','STALE_DATA','BOUNDED_SEARCH','UNAUTHORIZED','TENANT_MISMATCH','CONFLICT','VALIDATION_FAILED'].includes(code)) return code as import('../src/lib/engine/contracts.js').FdsApiError['code'];
  if (status === 401 || status === 403) return code.includes('TENANT') ? 'TENANT_MISMATCH' : 'UNAUTHORIZED';
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION_FAILED';
  if (status === 502 || status === 503 || status === 504) return 'PROVIDER_UNAVAILABLE';
  return 'INTERNAL_ERROR';
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
  const prior = await db.from('engine_stage_runs').select('version').eq('tenant_id', run.tenant_id).eq('generation_run_id', run.id).eq('stage', stage).order('version', { ascending: false }).limit(1).maybeSingle();
  if (prior.error) throw prior.error;
  const version = Number(prior.data?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const result = await db.from('engine_stage_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, stage, version, status, input_payload: input ?? {}, output_payload: output ?? null, warnings, errors, parent_stage_versions: parentStageVersions, started_at: now, completed_at: now }).select('*').single();
  if (result.error) throw result.error;
  await recordEvent(db, { tenant_id: String(run.tenant_id), generation_run_id: String(run.id), event_type: 'STAGE_COMPLETED', stage, payload: { version, status, warnings, errors } });
  await db.from('generation_runs').update({ current_stage: stage, state: stateForStage(stage), lineage: { ...(run.lineage as Json ?? {}), [stage]: version } }).eq('tenant_id', run.tenant_id).eq('id', run.id);
  return result.data as Json;
}
export async function recordEvent(db: SupabaseClient, event: { tenant_id: string; generation_run_id?: string; event_type: string; stage?: string; payload?: unknown }): Promise<void> { const result = await db.from('engine_events').insert({ ...event, payload: event.payload ?? {} }); if (result.error) throw result.error; }
async function nextVersion(db: SupabaseClient, table: string, tenantId: string, generationRunId: string): Promise<number> {
  const result = await db.from(table).select('version').eq('tenant_id', tenantId).eq('generation_run_id', generationRunId).order('version', { ascending: false }).limit(1).maybeSingle();
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
    const serp = new SerpApiResearchProvider(serpApiKey, fetch, undefined, { queryBudget: boundedIntegerEnv('FDS_RESEARCH_QUERY_BUDGET', 8, 1, 20), batchSize: boundedIntegerEnv('FDS_RESEARCH_BATCH_SIZE', 5, 1, 10) });
    providers.push(serp);
    if (firecrawlKey) providers.push(new FirecrawlResearchProvider(firecrawlKey, serp));
  }
  const openAiKey = env('OPENAI_API_KEY') ?? env('VITE_OPENAI_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const openAiSynthesizer = openAiKey ? new OpenAiResearchSynthesizer({ apiKey: openAiKey, model: env('OPENAI_MODEL') ?? env('AI_MODEL') }) : undefined;
  const anthropicSynthesizer = anthropicKey ? new AnthropicResearchSynthesizer({ apiKey: anthropicKey, model: env('ANTHROPIC_MODEL') }) : undefined;
  const synthesizer = anthropicSynthesizer ? new FallbackResearchSynthesizer({ primary: openAiSynthesizer, fallback: anthropicSynthesizer }) : openAiSynthesizer;
  return { agent: new ResearchAgent({ providers, synthesizer, freshness: { availabilityMinutes: boundedIntegerEnv('FDS_AVAILABILITY_FRESHNESS_MINUTES', 5, 1, 60), contextMinutes: boundedIntegerEnv('FDS_CONTEXT_FRESHNESS_MINUTES', 1440, 5, 10080) }, experimentalContextEffectsEnabled: env('FDS_ENABLE_EXPERIMENTAL_CONTEXT_EFFECTS')?.toLowerCase() === 'true' }), availability, espnProjection: espnBaseUrl ? new EspnProjectionClient(espnBaseUrl) : undefined, anthropicKey, anthropicModel: env('ANTHROPIC_MODEL') };
}

export interface RunOptions { lineupMode?: string; minSalaryUsed?: number; maxSharedPlayers?: number; fixedRosterSlots?: Record<string, string>; }

export async function processRun(db: SupabaseClient, run: Json, slate: ValidatedSlate, runOptions: RunOptions = {}): Promise<Json> {
  slate = parseValidatedSlate(slate, String(run.tenant_id));
  assertSlate(slate);
  // LIVE is an explicit mode, never inferred from an old slate or wall-clock time. Keep the
  // validated facts in stage diagnostics so downstream stages can audit exactly what was used.
  const liveState = buildLiveStatePackage(slate);
  await persistConfiguration(db, String(run.tenant_id));
  const { agent, availability, espnProjection, anthropicKey, anthropicModel } = providerSet();
  const stages: Record<string, unknown> = {};
  // SportsDataIO's free-trial numeric statistics are intentionally scrambled. Require
  // an explicit operator attestation before they can drive projections or workloads.
  const sportsDataIoProductionVerified = env('SPORTS_DATA_IO_DATA_TIER')?.toUpperCase() === 'PRODUCTION_VERIFIED';
  if (availability && !sportsDataIoProductionVerified) stages.projectionDataSourceWarnings = ['SportsDataIO numeric stats are disabled because this deployment is not attested as PRODUCTION_VERIFIED; scrambled trial statistics must not drive projections, workload estimates, or recent-minutes inputs.'];
  if (liveState) stages.liveState = { status: liveState.status, source: liveState.source, observedAt: liveState.observedAt, warnings: liveState.warnings };
  let workingSlate = slate;
  let cfbSportsDataRosterAvailable = false;
  if (availability) {
    try {
      const availabilitySnapshot = await availability.getAvailabilitySnapshot(workingSlate);
      cfbSportsDataRosterAvailable = workingSlate.sport === 'CFB' && availabilitySnapshot.rosterComplete === true;
      workingSlate = applyAvailabilitySnapshot(workingSlate, availabilitySnapshot, new Date(), photoHostsFromEnv());
    }
    catch (error) { const message = error instanceof Error ? error.message : 'Availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `Availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
    if (workingSlate.sport === 'GOLF' && sportsDataIoProductionVerified) {
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
    // Season totals, player-game logs, and historical minutes are numeric projections inputs.
    // They stay disabled unless the configured account tier has been independently verified;
    // the known free-trial entitlement scrambles numeric SportsDataIO values.
    if (['MLB', 'NBA', 'WNBA', 'NFL', 'CFB'].includes(workingSlate.sport) && sportsDataIoProductionVerified) {
      try {
        let seasonParam = seasonParamFor(workingSlate.sport, workingSlate.event.eventDate);
        let seasonRows = await availability.getSeasonStats(workingSlate.sport, seasonParam);
        // Keep current/prior seasons separate. Missing current rows flow through the explicit
        // prior-season fallback below, avoiding accidental double weighting of the same season.
        let priorSeasonRows: Record<string, unknown>[] = [];
        let priorSeasonParam = '';
        if (['MLB', 'NBA', 'NFL', 'CFB'].includes(workingSlate.sport)) {
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
        const identityConflictPlayers: string[] = [];
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
          const providerId = String(row.PlayerID ?? row.PlayerId ?? row.playerId ?? row.PlayerKey ?? row.playerKey ?? '').trim();
          if (player.identity?.sportsDataIoId && providerId && player.identity.sportsDataIoId !== providerId) { identityConflictPlayers.push(player.playerName); return player; }
          if (row !== currentRow) priorSeasonPlayers.push(player.playerName);
          const providerTeam = normalizeTeamCode(String(row.Team ?? row.team ?? row.TeamAbbreviation ?? ''));
          const slateTeam = normalizeTeamCode(String(player.team ?? ''));
          if (providerTeam && slateTeam && providerTeam !== slateTeam) teamMismatchPlayers.push(`${player.playerName} (${slateTeam} slate / ${providerTeam} stats)`);
          const dkPoints = Number(row.FantasyPointsDraftKings ?? NaN);
          const currentWeight = currentSeasonWeight(workingSlate.sport, currentGames);
          const weighted = deriveWeightedSeasonInputs(workingSlate.sport, player, seasonRows, priorSeasonRows, currentWeight, { allowTeamMismatch });
          const inputs = weighted.inputs;
          if (weighted.usedPrior && currentRow && currentGames > 0 && priorRow) blendedPlayers.push(player.playerName);
          const identity = providerId ? { ...player.identity, sportsDataIoId: providerId, confidence: 'HIGH' as const, matchedBy: player.identity?.matchedBy === 'DRAFTKINGS' ? 'NAME_AND_TEAM' as const : player.identity?.matchedBy ?? 'NAME_AND_TEAM' as const } : player.identity;
          return { ...player, ...(identity ? { identity } : {}), ...(Number.isFinite(dkPoints) && !Number.isFinite(player.providerFppg) ? { providerFppg: dkPoints / games } : {}), ...(inputs && !player.projectionInputs ? { projectionInputs: inputs } : {}) };
        });
        workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
        const dataSourceNote = `Projected from ${seasonParam} season-to-date stats (SportsDataIO), with explicit prior-season fallback where current samples are missing; not a live day-of projection.`;
        const warnings = [dataSourceNote];
        if (priorSeasonPlayers.length) warnings.push(`Used ${priorSeasonParam} season baseline for ${priorSeasonPlayers.length} ${workingSlate.sport} players without current-season stats: ${priorSeasonPlayers.join(', ')}.`);
        if (blendedPlayers.length) warnings.push(`Blended current and ${priorSeasonParam} season SportsDataIO rates for ${blendedPlayers.length} ${workingSlate.sport} players using provisional current-season weights; this weighting is not outcome-calibrated.`);
        if (teamMismatchPlayers.length) warnings.push(`Matched unique player-name stats across a team change for ${teamMismatchPlayers.length} ${workingSlate.sport} players: ${teamMismatchPlayers.join(', ')}.`);
        if (identityConflictPlayers.length) warnings.push(`SportsDataIO identity conflicts were rejected for ${identityConflictPlayers.length} ${workingSlate.sport} players; no mismatched player rates were applied: ${identityConflictPlayers.join(', ')}.`);
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
          const team = normalizeTeamCode(String(player.team ?? ''));
          const opponent = normalizeTeamCode(String(player.opponent ?? ''));
          const playerGame = games.find((row) => [normalizeTeamCode(row.homeTeam ?? ''), normalizeTeamCode(row.awayTeam ?? '')].includes(team) && [normalizeTeamCode(row.homeTeam ?? ''), normalizeTeamCode(row.awayTeam ?? '')].includes(opponent));
          const isPitcher = /^(SP|RP|P)$/i.test(String(player.position ?? ''));
          const id = player.identity?.sportsDataIoId;
          const homePitcher = playerGame && normalizeTeamCode(playerGame.homeTeam ?? '') === team;
          const probablePitcherId = playerGame ? homePitcher ? playerGame.homeProbablePitcherId : playerGame.awayProbablePitcherId : undefined;
          const probablePitcherName = playerGame ? homePitcher ? playerGame.homeProbablePitcher : playerGame.awayProbablePitcher : undefined;
          const probableStarter = Boolean(playerGame && ((id && probablePitcherId && id === probablePitcherId) || (probablePitcherName && normalizeProviderName(probablePitcherName) === normalizeProviderName(player.playerName))));
          const scheduledOpener = Boolean(probableStarter && playerGame && (homePitcher ? playerGame.homeOpener : playerGame.awayOpener));
          let projectionInputs = player.projectionInputs;
          if (isPitcher && id && sportsDataIoProductionVerified) {
            try {
              const logs = await availability.getMlbPlayerGameLogs(seasonParamFor('MLB', workingSlate.event.eventDate), id, 10);
              const lock = new Date(workingSlate.contest.lockTime).getTime();
              const preLockLogs = logs.filter((row) => {
                const timestamp = Date.parse(String(row.DateTime ?? row.Day ?? row.Date ?? ''));
                return Number.isFinite(timestamp) && timestamp < lock;
              });
              const isStarted = (row: Record<string, unknown>) => row.Started === true || Number(row.Started) === 1 || Number(row.PitchingGamesStarted ?? row.GamesStarted ?? 0) > 0;
              const starts = preLockLogs.filter(isStarted);
              const relief = preLockLogs.filter((row) => !isStarted(row));
              const declaredRole = probableStarter || String(player.position ?? '').toUpperCase() === 'SP' || player.availability?.status === 'CONFIRMED_STARTER' ? 'STARTER' : String(player.position ?? '').toUpperCase() === 'RP' ? 'RELIEVER' : 'UNKNOWN';
              const starterInnings = starts.flatMap((row) => {
                const value = Number(row.InningsPitchedDecimal ?? row.InningsPitched ?? NaN);
                return Number.isFinite(value) && value > 0 ? [value] : [];
              }).slice(0, 5);
              const reliefInnings = relief.flatMap((row) => {
                const value = Number(row.InningsPitchedDecimal ?? row.InningsPitched ?? NaN);
                return Number.isFinite(value) && value >= 0 ? [value] : [];
              }).slice(0, 5);
              const role = declaredRole === 'UNKNOWN' ? starts.length >= 3 && starts.length / Math.max(1, preLockLogs.length) >= 0.6 ? 'STARTER' : relief.length >= 3 ? 'RELIEVER' : 'UNKNOWN' : declaredRole;
              const recentShortStarter = role === 'STARTER' && starterInnings.length >= 3 && starterInnings.filter((value) => value <= 2).length / starterInnings.length >= 0.5;
              const opener = scheduledOpener || recentShortStarter;
              const workloadRole = opener ? 'RELIEVER' : role;
              const innings = workloadRole === 'STARTER' ? starterInnings : workloadRole === 'RELIEVER' ? reliefInnings : [];
              if (innings.length && projectionInputs?.expectedInnings !== undefined) {
                const recentAverage = innings.reduce((sum, value) => sum + value, 0) / innings.length;
                projectionInputs = { ...projectionInputs, expectedInnings: projectionInputs.expectedInnings * 0.5 + recentAverage * 0.5 };
              }
              const workload = innings.length ? innings.reduce((sum, value) => sum + value, 0) / innings.length : undefined;
              const recentPitches = preLockLogs.flatMap((row) => { const value = Number(row.PitchesThrown ?? NaN); const dateValue = Date.parse(String(row.DateTime ?? row.Day ?? row.Date ?? '')); return Number.isFinite(value) && value >= 0 && Number.isFinite(dateValue) && Number.isFinite(lock) && dateValue >= lock - 72 * 60 * 60 * 1000 ? [value] : []; });
              const pitchValues = innings.map((_, index) => Number((role === 'STARTER' ? starts : relief)[index]?.PitchesThrown ?? NaN)).filter((value) => Number.isFinite(value) && value >= 0);
              const expectedPitchesP50 = pitchValues.length ? [...pitchValues].sort((a,b) => a-b)[Math.floor((pitchValues.length - 1) * 0.5)] : undefined;
              const workloadWarning = role === 'UNKNOWN' ? 'Pitcher role is unresolved; no starter workload was assumed.' : opener ? innings.length ? 'Opener/short-outing role uses the player’s recent relief innings; verify any explicit pitch limit.' : 'Opener plan detected, but no recent relief workload sample exists; expected innings remain provisional.' : role === 'RELIEVER' ? 'Recent pitcher logs are available, but team bullpen availability is not included in this projection.' : !probableStarter && player.availability?.status !== 'CONFIRMED_STARTER' ? 'Historical starter workload is modeled, but the current probable starter is not matched to this player.' : undefined;
              const pitchRestWarning = recentPitches.length ? 'Pitcher threw pitches within 72 hours before lock; workload impact is surfaced but no unvalidated numeric penalty is applied.' : undefined;
              const completeWorkloadWarning = [workloadWarning, pitchRestWarning].filter(Boolean).join(' ');
              player = { ...player, sportContext: { ...player.sportContext, mlb: { ...player.sportContext?.mlb, pitcherRole: opener ? 'OPENER' : role, probableStarter, ...(probablePitcherId ? { probablePitcherId } : {}), ...(workload === undefined ? {} : { expectedInningsP10: Math.max(0, Math.min(...innings)), expectedInningsP50: workload, expectedInningsP90: Math.max(...innings) }), ...(expectedPitchesP50 === undefined ? {} : { expectedPitchesP50 }), ...(recentPitches.length ? { recentPitchesLast3Days: recentPitches.reduce((sum,value) => sum + value, 0) } : {}), workloadSampleCount: innings.length, workloadRetrievedAt: new Date().toISOString(), bullpenAvailability: 'UNKNOWN', ...(completeWorkloadWarning ? { workloadWarning: completeWorkloadWarning } : {}) } } };
              if (workloadWarning || pitchRestWarning) stages.workloadWarnings = [...((stages.workloadWarnings as string[] | undefined) ?? []), `${player.playerName}: ${[workloadWarning, pitchRestWarning].filter(Boolean).join(' ')}`];
            } catch (error) {
              stages.workloadWarnings = [...((stages.workloadWarnings as string[] | undefined) ?? []), `Recent MLB workload unavailable for ${player.playerName}: ${error instanceof Error ? error.message : 'feed request failed'}.`];
            }
          }
          else if (isPitcher && id && !sportsDataIoProductionVerified) stages.workloadWarnings = [...((stages.workloadWarnings as string[] | undefined) ?? []), `${player.playerName}: SportsDataIO game logs were not used because this deployment is not attested as PRODUCTION_VERIFIED; starter/reliever workload remains provisional.`];
          const gameWeather = playerGame ? {
            ...(playerGame.temperatureLow !== undefined ? { temperatureLow: playerGame.temperatureLow } : {}),
            ...(playerGame.temperatureHigh !== undefined ? { temperatureHigh: playerGame.temperatureHigh } : {}),
            ...(playerGame.windSpeed !== undefined ? { windSpeed: playerGame.windSpeed } : {}),
            ...(playerGame.windDirection ? { windDirection: playerGame.windDirection } : {}),
            ...(playerGame.description ? { description: playerGame.description } : {}), retrievedAt,
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
    if (workingSlate.sport === 'WNBA' && sportsDataIoProductionVerified) {
      try {
        const recentRows = await availability.getWnbaRecentMinutes(workingSlate.event.eventDate, 28);
        const byId = new Map(recentRows.flatMap((row) => row.playerId ? [[row.playerId, row.minutes] as const] : []));
        const byNameTeam = new Map(recentRows.flatMap((row) => row.name ? [[`${normalizeProviderName(row.name)}|${normalizeTeamCode(row.team ?? '')}`, row.minutes] as const] : []));
        let matched = 0;
        const playerPool = workingSlate.playerPool.map((player) => {
          const samples = player.identity?.sportsDataIoId
            ? byId.get(player.identity.sportsDataIoId)
            : byNameTeam.get(`${normalizeProviderName(player.playerName)}|${normalizeTeamCode(String(player.team ?? ''))}`);
          if (!samples?.length) return player;
          matched += 1;
          const ordered = [...samples].sort((a, b) => a - b);
          const quantile = (q: number) => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * q))];
          const recentMedian = quantile(0.5);
          const limitedMinutesRisk = ordered.length >= 5 ? ordered.filter((minutes) => minutes <= 10).length / ordered.length : 0;
          const expectedMinutes = player.projectionInputs?.expectedMinutes;
          const minutesP50 = expectedMinutes !== undefined ? expectedMinutes * 0.5 + recentMedian * 0.5 : recentMedian;
          const minutesP10 = Math.min(quantile(0.1), minutesP50);
          const minutesP90 = Math.max(quantile(0.9), minutesP50);
          return { ...player, projectionInputs: { ...player.projectionInputs, expectedMinutes: minutesP50, minutesP10, minutesP90, limitedMinutesRisk }, sportContext: { ...player.sportContext, nba: { ...player.sportContext?.nba, minutesP10, minutesP50, minutesP90, limitedMinutesRisk, minutesSampleCount: ordered.length, minutesRetrievedAt: new Date().toISOString() } } };
        });
        workingSlate = { ...workingSlate, playerPool };
        stages.wnbaMinutesHistory = { source: 'SportsDataIO final BoxScores', lookbackDays: 28, playersMatched: matched, playerPoolSize: playerPool.length, retrievedAt: new Date().toISOString() };
        if (matched < playerPool.length) stages.wnbaMinutesWarning = `Recent WNBA minutes were available for ${matched}/${playerPool.length} players. Missing histories retain season-based minutes; role uncertainty remains provisional.`;
      } catch (error) {
        stages.wnbaMinutesWarning = `Recent WNBA game minutes lookup failed: ${error instanceof Error ? error.message : 'provider request failed'}.`;
      }
    }
    else if (workingSlate.sport === 'WNBA' && !sportsDataIoProductionVerified) stages.wnbaMinutesWarning = 'Recent WNBA minutes from SportsDataIO were not applied because this deployment is not attested as PRODUCTION_VERIFIED; use only separately verified role evidence.';
    if (workingSlate.sport === 'NBA' && sportsDataIoProductionVerified && availability) {
      try {
        const lockTime = Date.parse(workingSlate.contest.lockTime);
        const season = seasonParamFor('NBA', workingSlate.event.eventDate);
        const targets = workingSlate.playerPool.filter((player) => player.identity?.sportsDataIoId);
        const recentByPlayer = new Map<string, Array<{ minutes: number; started?: boolean; date?: string; team?: string }>>();
        const rows = await mapWithConcurrency(targets, 4, async (player) => {
          try { return { player, rows: await availability.getNbaRecentPlayerGameLogs(season, player.identity!.sportsDataIoId!, 10) }; }
          catch (error) { return { player, rows: [], error: error instanceof Error ? error.message : 'provider request failed' }; }
        });
        const requestFailures = rows.filter((result) => result.error).length;
        for (const { player, rows: playerRows } of rows) {
          const valid = playerRows.filter((row) => {
            const gameTime = Date.parse(row.date ?? '');
            if (!Number.isFinite(gameTime) || !Number.isFinite(lockTime) || gameTime >= lockTime || row.minutes < 0 || row.minutes > 70) return false;
            if (row.playerId && row.playerId !== player.identity?.sportsDataIoId) return false;
            return !row.team || !player.team || normalizeTeamCode(row.team) === normalizeTeamCode(player.team);
          });
          if (valid.length) recentByPlayer.set(player.playerId, valid.slice(0, 10));
        }
        let matched = 0;
        const playerPool = workingSlate.playerPool.map((player) => {
          const logs = recentByPlayer.get(player.playerId);
          if (!logs?.length) return player;
          matched += 1;
          const ordered = logs.map((row) => row.minutes).sort((left, right) => left - right);
          const quantile = (q: number) => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * q))];
          const recentMedian = quantile(0.5);
          const expectedMinutes = player.projectionInputs?.expectedMinutes;
          const minutesP50 = expectedMinutes !== undefined ? expectedMinutes * 0.5 + recentMedian * 0.5 : recentMedian;
          const minutesP10 = Math.min(quantile(0.1), minutesP50);
          const minutesP90 = Math.max(quantile(0.9), minutesP50);
          const limitedMinutesRisk = ordered.length >= 5 ? ordered.filter((minutes) => minutes <= 10).length / ordered.length : 0;
          const startCount = logs.filter((row) => row.started).length;
          return { ...player, projectionInputs: { ...player.projectionInputs, expectedMinutes: minutesP50, minutesP10, minutesP90, limitedMinutesRisk }, sportContext: { ...player.sportContext, nba: { ...player.sportContext?.nba, starter: logs.length >= 3 ? startCount / logs.length >= 0.5 : undefined, activeRotation: ordered.some((minutes) => minutes > 0), minutesP10, minutesP50, minutesP90, limitedMinutesRisk, minutesSampleCount: ordered.length, minutesRetrievedAt: new Date().toISOString() } } };
        });
        workingSlate = { ...workingSlate, playerPool };
        stages.nbaMinutesHistory = { source: 'SportsDataIO NBA PlayerGameStatsBySeason', season, lookbackGames: 10, playersMatched: matched, playerPoolSize: playerPool.length, retrievedAt: new Date().toISOString() };
        if (matched < playerPool.length || requestFailures) stages.nbaMinutesWarning = `Recent NBA minutes/starts history matched ${matched}/${playerPool.length} slate players by exact SportsDataIO player ID and current team; ${requestFailures} player feed request(s) failed. Missing histories retain other available inputs and remain unresolved.`;
      } catch (error) { stages.nbaMinutesWarning = `Recent NBA minutes lookup failed: ${error instanceof Error ? error.message : 'provider request failed'}.`; }
    } else if (workingSlate.sport === 'NBA') stages.nbaMinutesWarning = 'NBA recent-game minutes were not applied because the SportsDataIO deployment is not configured as PRODUCTION_VERIFIED; endpoint entitlement and data integrity must be confirmed first.';
  }
  // SportsDataIO is authoritative for CFB roster membership and injury status when its complete
  // team rosters resolve. It intentionally cannot confirm college starters. ESPN remains a
  // fallback only when SportsDataIO could not resolve a complete CFB roster.
  if (espnProjection && ['NBA', 'WNBA', 'NFL', 'CFB'].includes(workingSlate.sport)) {
    if (workingSlate.sport !== 'CFB' || !cfbSportsDataRosterAvailable) try { workingSlate = applyAvailabilitySnapshot(workingSlate, await espnProjection.getAvailabilitySnapshot(workingSlate), new Date(), photoHostsFromEnv()); }
    catch (error) { const message = error instanceof Error ? error.message : 'ESPN availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `ESPN availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
  }
  if (['NFL', 'CFB', 'NBA', 'WNBA'].includes(workingSlate.sport)) {
    const covered = workingSlate.playerPool.filter((player) => Boolean(player.imageUrl)).length;
    stages.playerPhotoCoverage = { source: 'ESPN roster headshots', covered, total: workingSlate.playerPool.length, allowlistedHostsConfigured: photoHostsFromEnv().length > 0 };
    if (!covered) {
      const warning = photoHostsFromEnv().length
      ? 'No slate players received a verified ESPN headshot URL. The UI will show its initials fallback.'
      : 'ESPN headshots were returned only when their HTTPS host was explicitly configured in FDS_PLAYER_PHOTO_ALLOWED_HOSTS; configure the reviewed host a.espncdn.com to display them.';
      stages.playerPhotoWarning = warning;
      workingSlate = { ...workingSlate, validation: { ...workingSlate.validation, warnings: [...workingSlate.validation.warnings, warning] } };
    }
  }
  if (workingSlate.sport === 'WNBA') {
    const now = Date.now();
    const stale = workingSlate.playerPool.filter((player) => { const retrieved = Date.parse(player.availability?.retrievedAt ?? ''); return !Number.isFinite(retrieved) || now - retrieved > 12 * 60 * 60 * 1000; });
    if (stale.length) stages.wnbaAvailabilityFreshnessWarning = `Current structured injury/role evidence is missing or older than 12 hours for ${stale.length}/${workingSlate.playerPool.length} WNBA players. SportsDataIO does not confirm pregame lineups; treat role and DNP risk as unresolved for these players.`;
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
      const projectionMatches = new Map<string, typeof projections>();
      for (const projection of projections) {
        const key = `${normalizeProjectionName(projection.name)}:${normalizeProjectionTeam(projection.team)}:${normalizeProjectionTeam(projection.opponent ?? '')}`;
        projectionMatches.set(key, [...(projectionMatches.get(key) ?? []), projection]);
      }
      const ambiguousProjectionPlayers: string[] = [];
      const retainedProviderFppgPlayers: string[] = [];
      const missingProjectionPlayers: string[] = [];
      const refreshedPlayers = workingSlate.playerPool.map((player) => {
        const key = `${normalizeProjectionName(player.playerName)}:${normalizeProjectionTeam(String(player.team ?? ''))}:${normalizeProjectionTeam(String(player.opponent ?? ''))}`;
        const matches = projectionMatches.get(key) ?? [];
        if (matches.length > 1) { ambiguousProjectionPlayers.push(player.playerName); return player; }
        const projection = matches[0];
        if (!projection) { missingProjectionPlayers.push(player.playerName); return player; }
        if (Number.isFinite(player.providerFppg)) { retainedProviderFppgPlayers.push(player.playerName); return player; }
        return { ...player, providerFppg: projection.providerFppg };
      });
      workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
      const warnings: string[] = [];
      const resolvedGameCount = new Set(projections.map((projection) => projection.gameId).filter(Boolean)).size;
      const expectedGameCount = workingSlate.games?.length ?? 0;
      if (expectedGameCount > 0 && resolvedGameCount < expectedGameCount) warnings.push(`ESPN basketball game coverage is incomplete: ${resolvedGameCount}/${expectedGameCount} slate games resolved; unmatched games and their players were left without this provider projection.`);
      if (missingProjectionPlayers.length) warnings.push(`ESPN did not return season-average projections for ${missingProjectionPlayers.length} ${workingSlate.sport} players: ${missingProjectionPlayers.join(', ')}.`);
      if (ambiguousProjectionPlayers.length) warnings.push(`ESPN returned ambiguous multi-game projection identities for ${ambiguousProjectionPlayers.length} players; existing projections were retained: ${ambiguousProjectionPlayers.join(', ')}.`);
      if (retainedProviderFppgPlayers.length) warnings.push(`Existing DraftKings/provider FPPG values were retained for ${retainedProviderFppgPlayers.length} players; the later ESPN season-average result did not replace them.`);
      if (warnings.length) stages.projectionWarning = warnings.join(' ');
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
  const researchVersion = await nextVersion(db, 'floyd_dfs_research_runs', String(run.tenant_id), String(run.id));
  const researchRun = await db.from('floyd_dfs_research_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: researchVersion, research_plan: { slateId: workingSlate.slateId }, research_package: research, status: research.status, model_name: openAiModel(), prompt_version: 'research.v1' }).select('id').single();
  if (researchRun.error) throw researchRun.error;
  if (research.findings.length) { const findings = await db.from('floyd_dfs_research_findings').insert(research.findings.map((finding) => ({ tenant_id: run.tenant_id, research_run_id: researchRun.data.id, bucket: finding.bucket, subject_type: finding.subjectType ?? 'EVENT', subject_id: finding.subjectId, finding: finding.finding, source_name: finding.sourceName, source_url: finding.sourceUrl ?? null, source_tier: finding.sourceTier ?? 4, source_purpose: finding.sourcePurpose ?? null, published_at: finding.publishedAt ?? null, retrieved_at: finding.retrievedAt ?? research.generatedAt, confidence: finding.confidence, metadata: finding.metadata ?? {} }))); if (findings.error) throw findings.error; }
  if ((research.unknowns ?? []).length) { const watchItems = await db.from('floyd_dfs_watch_items').insert((research.unknowns ?? []).map((unknown) => ({ tenant_id: run.tenant_id, generation_run_id: run.id, subject: unknown.question, importance: unknown.importance, current_state: { reason: unknown.reason }, trigger_condition: { expectedChangeBeforeLock: true }, affected_player_ids: workingSlate.playerPool.map((player) => player.playerId), affected_lineup_ids: [], expected_update_at: workingSlate.contest.lockTime, status: 'active' }))); if (watchItems.error) throw watchItems.error; }
  const acceptedFactEvidenceIds = research.resolvedFacts
    ? new Set(research.resolvedFacts.filter((fact) => fact.state === 'ACCEPTED').flatMap((fact) => fact.supportingObservationIds ?? []))
    : undefined;
  const observationIdByFindingId = new Map((research.observations ?? []).map((observation) => [observation.sourceRecordId, observation.id]));
  const adjustmentResearch = acceptedFactEvidenceIds
    ? { ...research, findings: research.findings.filter((finding) => {
      const observationId = observationIdByFindingId.get(finding.id);
      return observationId ? acceptedFactEvidenceIds.has(observationId) : false;
    }) }
    : research;
  let adjustment = adjustSlate(workingSlate, adjustmentResearch);
  const adjustmentKey = env('OPENAI_API_KEY');
  if ((adjustmentKey || anthropicKey) && adjustment.status !== 'BLOCKED') {
    try {
      if (adjustmentKey) adjustment = await adjustWithOpenAi({ slate: workingSlate, research: adjustmentResearch, baseline: adjustment }, { apiKey: adjustmentKey, model: openAiModel() });
      else adjustment = await adjustWithAnthropic({ slate: workingSlate, research: adjustmentResearch, baseline: adjustment }, { apiKey: anthropicKey!, model: anthropicModel });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI Sport Adjustment failed.';
      if (anthropicKey) {
        try { adjustment = await adjustWithAnthropic({ slate: workingSlate, research: adjustmentResearch, baseline: adjustment }, { apiKey: anthropicKey, model: anthropicModel }); stages.adjustmentWarning = `${message} Anthropic fallback used successfully.`; }
        catch (fallbackError) { const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'Anthropic Sport Adjustment fallback failed.'; stages.adjustmentWarning = `${message} Anthropic fallback failed: ${fallbackMessage} Deterministic specialist retained.`; adjustment = { ...adjustment, warnings: [...(adjustment.warnings ?? []), stages.adjustmentWarning as string] }; }
      } else { stages.adjustmentWarning = `${message} Anthropic fallback unavailable because ANTHROPIC_API_KEY is not configured.`; adjustment = { ...adjustment, warnings: [...(adjustment.warnings ?? []), stages.adjustmentWarning as string] }; }
    }
  }
  assertAdjustment(adjustment, research);
  stages.adjustment = adjustment;
  await saveStage(db, run, 'SPORT_ADJUSTMENT', { slate: workingSlate, research }, adjustment, adjustment.status, [...(adjustment.warnings ?? []), ...((stages.adjustmentWarning as string | undefined) ? [stages.adjustmentWarning as string] : [])]);
  const adjustmentVersion = await nextVersion(db, 'floyd_dfs_adjustment_runs', String(run.tenant_id), String(run.id));
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
  const projectionVersion = await nextVersion(db, 'floyd_dfs_projection_runs', String(run.tenant_id), String(run.id));
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
  const optimizer = optimizeLineups({ validatedSlate: workingSlate, projectionPackage: projection }, { lineupMode: runOptions.lineupMode, minSalaryUsed: runOptions.minSalaryUsed, maxSearchNodes: boundedIntegerEnv('FDS_OPTIMIZER_MAX_SEARCH_NODES', 50_000, 1_000, 100_000), fieldSimulations: boundedIntegerEnv('FDS_FIELD_SIMULATIONS', 64, 16, 128), fieldMaxScoreComparisons: boundedIntegerEnv('FDS_FIELD_SIMULATION_MAX_COMPARISONS', 2_000_000, 100_000, 5_000_000), ...(runOptions.fixedRosterSlots ? { fixedRosterSlots: runOptions.fixedRosterSlots } : {}), ...(portfolioConstraints ? { portfolioConstraints } : {}) });
  assertOptimizer(optimizer, workingSlate);
  assertContestMetrics(optimizer);
  stages.optimizer = optimizer;
  await saveStage(db, run, 'OPTIMIZE', { slate: workingSlate, projection }, optimizer, optimizer.status);
  const optimizationVersion = await nextVersion(db, 'floyd_dfs_optimization_runs', String(run.tenant_id), String(run.id));
  const optimizationRun = await db.from('floyd_dfs_optimization_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: optimizationVersion, objective_profile: optimizer.objectiveProfile, optimizer_package: optimizer, status: optimizer.status }).select('id').single();
  if (optimizationRun.error) throw optimizationRun.error;
  const candidateRows = await db.from('floyd_dfs_lineup_candidates').insert(optimizer.candidates.map((candidate) => ({ tenant_id: run.tenant_id, optimization_run_id: optimizationRun.data.id, candidate_key: candidate.id, salary_used: candidate.salaryUsed, salary_remaining: candidate.salaryRemaining, floor: candidate.floor, expected_points: candidate.expectedPoints ?? null, median: candidate.median, ceiling: candidate.ceiling, correlation_score: candidate.correlationScore, median_rank: candidate.medianRank, ceiling_rank: candidate.ceilingRank, candidate_types: candidate.candidateTypes, roster_slots: candidate.rosterSlots, game_script_cluster: candidate.gameScriptCluster, strategic_similarity: candidate.strategicSimilarity, risk_flags: candidate.riskFlags, ...(candidate.variance !== undefined ? { variance: candidate.variance } : {}), ...(candidate.winFrequency !== undefined ? { win_frequency: candidate.winFrequency } : {}), ...(candidate.fractionalWinCredit !== undefined ? { fractional_win_credit: candidate.fractionalWinCredit } : {}), ...(candidate.winFrequencyStandardError !== undefined ? { win_frequency_standard_error: candidate.winFrequencyStandardError } : {}), ...(candidate.topOnePercentFrequency !== undefined ? { top_one_percent_frequency: candidate.topOnePercentFrequency } : {}), ...(candidate.cashFrequency !== undefined ? { cash_frequency: candidate.cashFrequency } : {}), ...(candidate.cashFrequencyStandardError !== undefined ? { cash_frequency_standard_error: candidate.cashFrequencyStandardError } : {}), ...(candidate.positivePayoutFrequency !== undefined ? { positive_payout_frequency: candidate.positivePayoutFrequency } : {}), ...(candidate.expectedDuplicates !== undefined ? { expected_duplicates: candidate.expectedDuplicates } : {}), ...(candidate.expectedPayout !== undefined ? { expected_payout: candidate.expectedPayout } : {}), ...(candidate.expectedPayoutStandardError !== undefined ? { expected_payout_standard_error: candidate.expectedPayoutStandardError } : {}), ...(candidate.expectedProfit !== undefined ? { expected_profit: candidate.expectedProfit } : {}), ...(candidate.roi !== undefined ? { roi: candidate.roi } : {}), contest_metric_provenance: candidate.contestMetricProvenance ?? 'UNAVAILABLE' })));
  if (candidateRows.error) throw candidateRows.error;
  const calibration = await loadCashLineCalibration(db, String(run.tenant_id));
  const selection = selectLineups({ validatedSlate: workingSlate, researchPackage: research, optimizerPackage: optimizer, cashLineCalibration: calibration, ...(runOptions.fixedRosterSlots ? { lockedRosterSlots: runOptions.fixedRosterSlots } : {}) });
  assertSelection(selection, optimizer);
  stages.selection = selection;
  await saveStage(db, run, 'SELECTION', { slate: workingSlate, research, optimizer }, selection, selection.status, selection.warnings ?? []);
  const selectionVersion = await nextVersion(db, 'floyd_dfs_selection_runs', String(run.tenant_id), String(run.id));
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
  await db.from('generation_runs').update({ state: finalState, current_stage: 'SELECTION', error: finalError }).eq('tenant_id', run.tenant_id).eq('id', run.id);
  return { ...run, state: finalState, error: finalError, current_stage: 'SELECTION', stages, lineups: selection.selectedLineups };
}

export async function loadCashLineCalibration(db: SupabaseClient, tenantId: string) {
  const results: Record<string, any>[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await db.from('floyd_dfs_contest_results').select('generated_lineup_id,contest_id,external_entry_id,beat_cash_line,reconciliation_status,model_evaluation_eligible,official_outcome,measured_at').eq('tenant_id', tenantId).eq('reconciliation_status', 'MATCHED').eq('model_evaluation_eligible', true).eq('official_outcome', true).not('beat_cash_line', 'is', null).not('contest_id', 'is', null).not('external_entry_id', 'is', null).order('measured_at', { ascending: false }).range(offset, offset + 499);
    if (page.error) throw page.error;
    results.push(...(page.data ?? []));
    if ((page.data ?? []).length < 500) break;
  }
  const lineupIds = [...new Set(results.map((row) => String(row.generated_lineup_id)).filter(Boolean))];
  const lineupById = new Map<string, Record<string, any>>();
  for (let offset = 0; offset < lineupIds.length; offset += 300) {
    const page = await db.from('floyd_dfs_generated_lineups').select('id,raw_cash_line_probability,selection_run_id').eq('tenant_id', tenantId).in('id', lineupIds.slice(offset, offset + 300)).not('raw_cash_line_probability', 'is', null);
    if (page.error) throw page.error;
    for (const row of page.data ?? []) lineupById.set(String(row.id), row);
  }
  const linkedIds = [...new Set(results.map((row) => String(row.generated_lineup_id)).filter(Boolean))];
  const linksByKey = new Set<string>();
  for (let offset = 0; offset < linkedIds.length; offset += 300) {
    const page = await db.from('floyd_dfs_entry_links').select('generated_lineup_id,contest_id,external_entry_id').eq('tenant_id', tenantId).in('generated_lineup_id', linkedIds.slice(offset, offset + 300));
    if (page.error) throw page.error;
    for (const link of page.data ?? []) linksByKey.add(`${link.generated_lineup_id}:${link.contest_id}:${link.external_entry_id}`);
  }
  const selectionIds = [...new Set([...lineupById.values()].map((row) => String(row.selection_run_id)))];
  const generationRunBySelection = new Map<string, string>();
  for (let offset = 0; offset < selectionIds.length; offset += 300) {
    const page = await db.from('floyd_dfs_selection_runs').select('id,generation_run_id').eq('tenant_id', tenantId).in('id', selectionIds.slice(offset, offset + 300));
    if (page.error) throw page.error;
    for (const row of page.data ?? []) generationRunBySelection.set(String(row.id), String(row.generation_run_id));
  }
  const generationIds = [...new Set([...generationRunBySelection.values()])];
  const generationRuns = new Map<string, Record<string, any>>();
  for (let offset = 0; offset < generationIds.length; offset += 300) {
    const page = await db.from('generation_runs').select('id,request_payload,created_at').eq('tenant_id', tenantId).in('id', generationIds.slice(offset, offset + 300));
    if (page.error) throw page.error;
    for (const row of page.data ?? []) generationRuns.set(String(row.id), row);
  }
  const projectionTimestamps = new Map<string, string>();
  for (let offset = 0; offset < generationIds.length; offset += 300) {
    const page = await db.from('engine_stage_runs').select('generation_run_id,output_payload,created_at').eq('tenant_id', tenantId).eq('stage', 'PROJECTION').in('generation_run_id', generationIds.slice(offset, offset + 300)).order('version', { ascending: false });
    if (page.error) throw page.error;
    for (const row of page.data ?? []) if (!projectionTimestamps.has(String(row.generation_run_id))) { const generatedAt = (row.output_payload as Record<string, unknown> | null)?.generatedAt; if (typeof generatedAt === 'string') projectionTimestamps.set(String(row.generation_run_id), generatedAt); }
  }
  const observations: CashLineObservation[] = results.flatMap((row) => {
    const lineup = lineupById.get(String(row.generated_lineup_id));
    const runId = lineup ? generationRunBySelection.get(String(lineup.selection_run_id)) : undefined;
    const run = runId ? generationRuns.get(runId) : undefined;
    const input = (run?.request_payload as Record<string, any> | undefined)?.input;
    const slate = input?.validatedSlate;
    const lock = Date.parse(String(slate?.contest?.lockTime ?? ''));
    const generated = Date.parse(projectionTimestamps.get(String(runId)) ?? '');
    const raw = Number(lineup?.raw_cash_line_probability);
    const linked = linksByKey.has(`${row.generated_lineup_id}:${row.contest_id}:${row.external_entry_id}`);
    if (!linked || !Number.isFinite(raw) || !Number.isFinite(lock) || !Number.isFinite(generated) || generated >= lock || !row.contest_id || !slate?.slateId || typeof row.beat_cash_line !== 'boolean') return [];
    return [{ contestId: String(row.contest_id), independenceKey: String(slate.slateId), rawProbability: raw, beatCashLine: row.beat_cash_line }];
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

export function parseBody(req: VercelRequest): Json { if (!req.body) return {}; let value: unknown = req.body; if (typeof req.body === 'string') { if (Buffer.byteLength(req.body, 'utf8') > 10_000_000) throw new ApiError(413, 'Request body exceeds the 10 MB limit.', 'BODY_TOO_LARGE'); try { value = JSON.parse(req.body) as unknown; } catch { throw new ApiError(400, 'Request body must contain valid JSON.', 'INVALID_JSON'); } } else if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 10_000_000) throw new ApiError(413, 'Request body exceeds the 10 MB limit.', 'BODY_TOO_LARGE'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Request body must be a JSON object.', 'INVALID_BODY'); return value as Json; }
function openAiModel(): string | undefined { return env('OPENAI_MODEL') ?? env('AI_MODEL') ?? ((env('OPENAI_API_KEY') ?? env('VITE_OPENAI_API_KEY')) ? 'gpt-5' : undefined); }
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(items.length || 1, concurrency)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
function normalizeProjectionName(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeProjectionTeam(value: string): string { return normalizeTeamCode(value); }
export function asFormat(value: unknown): ContestFormat { const format = String(value ?? 'SHOWDOWN').toUpperCase(); if (format !== 'CLASSIC' && format !== 'SHOWDOWN') throw new ApiError(400, `Unsupported contest format: ${format}.`, 'INVALID_CONTEST_FORMAT'); return format; }
export function asSport(value: unknown): 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' | 'CFB' { const sport = String(value ?? '').toUpperCase(); if (['WNBA', 'NBA', 'MLB', 'GOLF', 'NFL', 'CFB'].includes(sport)) return sport as 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' | 'CFB'; throw new Error(`Unsupported sport: ${sport}.`); }
export type { Json };
