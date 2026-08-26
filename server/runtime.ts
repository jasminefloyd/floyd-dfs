import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import WebSocket from 'ws';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DraftKingsClient } from '../src/lib/engine/draftKings.js';
import { adjustSlate } from '../src/lib/engine/adjustment.js';
import { projectSlate } from '../src/lib/engine/projection.js';
import { optimizeLineups } from '../src/lib/engine/optimizer.js';
import { selectLineups } from '../src/lib/engine/selection.js';
import { ResearchAgent } from '../src/lib/engine/researchAgent.js';
import { createDefaultRssProviders } from '../src/lib/engine/rssProvider.js';
import { SportsDataIoClient, SportsDataIoResearchProvider } from '../src/lib/engine/sportsDataIoProvider.js';
import { applyAvailabilitySnapshot, normalizeTeamCode, withDegradedAvailability } from '../src/lib/engine/availability.js';
import { assertAdjustment, assertOptimizer, assertProjection, assertResearch, assertSelection, assertSlate } from '../src/lib/engine/validation.js';
import { selectWithOpenAi } from '../src/lib/engine/openAiSelection.js';
import { OddsResearchProvider } from '../src/lib/engine/oddsProvider.js';
import { adjustWithOpenAi } from '../src/lib/engine/openAiAdjustment.js';
import { ConfiguredResearchProvider } from '../src/lib/engine/configuredResearchProvider.js';
import { OpenAiResearchSynthesizer } from '../src/lib/engine/openAiSynthesizer.js';
import { ballDontLieProvider, espnProvider } from '../src/lib/engine/structuredSportsProvider.js';
import { FirecrawlResearchProvider, SerpApiResearchProvider } from '../src/lib/engine/webResearchProvider.js';
import { EspnProjectionClient } from '../src/lib/engine/espnProjectionProvider.js';
import { buildCashLineCalibration, calibratedCashLineProbability, rawCashLineProbability, CASH_LINE_CALIBRATION_VERSION, type CashLineObservation } from '../src/lib/engine/cashLineCalibration.js';
import { deriveProjectionInputs } from '../src/lib/engine/projectionInputs.js';
import type { ContestFormat, EngineStage, ValidatedSlate } from '../src/lib/engine/contracts.js';

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
export function respondError(req: VercelRequest, res: VercelResponse, error: unknown): void { cors(req, res); const message = error instanceof Error ? error.message : 'Server request failed.'; res.status(500).json({ error: message }); }
export function method(req: VercelRequest, res: VercelResponse, allowed: string[]): boolean { cors(req, res); if (req.method === 'OPTIONS') { res.status(204).end(); return false; } if (!allowed.includes(req.method ?? '')) { res.status(405).json({ error: 'Method not allowed.' }); return false; } return true; }

export function draftKingsClient(sportCodes: Partial<Record<'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL', string>> = {}): DraftKingsClient { return new DraftKingsClient({ sportCodes }); }
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
function stateForStage(stage: EngineStage): string { return ({ SLATE: 'slate_validated', RESEARCH: 'researching', SPORT_ADJUSTMENT: 'adjusting', PROJECTION: 'projecting', OPTIMIZE: 'optimizing', SELECTION: 'selecting' } as Record<string, string>)[stage] ?? 'created'; }

export function providerSet(): { agent: ResearchAgent; availability?: SportsDataIoClient; espnProjection?: EspnProjectionClient } {
  const providers = [...createDefaultRssProviders() as import('../src/lib/engine/contracts.js').ResearchSourceProvider[]];
  const sportsKey = env('SPORTS_DATA_IO_KEY');
  let availability: SportsDataIoClient | undefined;
  if (sportsKey) { availability = new SportsDataIoClient({ apiKey: sportsKey, baseUrl: env('SPORTS_DATA_IO_BASE_URL') }); providers.push(new SportsDataIoResearchProvider({ client: availability })); }
  const oddsKey = env('THE_ODDS_API_KEY') ?? env('ODDS_API_KEY');
  if (oddsKey) providers.push(new OddsResearchProvider({ apiKey: oddsKey, baseUrl: env('ODDS_API_BASE_URL') }));
  const sentimentUrl = env('FIELD_SENTIMENT_URL');
  if (sentimentUrl) providers.push(new ConfiguredResearchProvider({ name: 'Configured Field Sentiment', url: sentimentUrl, tier: 4 }));
  const espnBaseUrl = env('ESPN_BASE_URL');
  if (espnBaseUrl) providers.push(espnProvider(espnBaseUrl));
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
  const synthesizer = openAiKey ? new OpenAiResearchSynthesizer({ apiKey: openAiKey, model: env('OPENAI_MODEL') ?? env('AI_MODEL') }) : undefined;
  return { agent: new ResearchAgent({ providers, synthesizer }), availability, espnProjection: espnBaseUrl ? new EspnProjectionClient(espnBaseUrl) : undefined };
}

export async function processRun(db: SupabaseClient, run: Json, slate: ValidatedSlate): Promise<Json> {
  assertSlate(slate);
  await persistConfiguration(db, String(run.tenant_id));
  const { agent, availability, espnProjection } = providerSet();
  const stages: Record<string, unknown> = {};
  let workingSlate = slate;
  if (availability) {
    try { workingSlate = applyAvailabilitySnapshot(workingSlate, await availability.getAvailabilitySnapshot(workingSlate)); }
    catch (error) { const message = error instanceof Error ? error.message : 'Availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `Availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
    // Providers may not return a matching row for every player. That no longer removes the
    // player from the slate here — projectSlate's own gap logic (which also checks
    // projectionInputs, populated below) is the single source of truth for whether a player
    // is quantitatively projectable; excluding them upstream would silently drop a player who
    // could still be projected from rate stats even without a raw FPPG number.
    if (workingSlate.sport === 'MLB') {
      try {
        const projections = await availability.getProjectionSnapshot(workingSlate);
        const byNameAndTeam = new Map(projections.map((projection) => [`${normalizeProjectionName(projection.name)}:${String(projection.team ?? '').toUpperCase()}`, projection]));
        const missingProjectionPlayers: string[] = [];
        const refreshedPlayers = workingSlate.playerPool.map((player) => { const projection = byNameAndTeam.get(`${normalizeProjectionName(player.playerName)}:${String(player.team ?? '').toUpperCase()}`); if (!projection || projection.fantasyPointsDraftKings === undefined) { missingProjectionPlayers.push(player.playerName); return player; } return { ...player, providerFppg: projection.fantasyPointsDraftKings }; });
        workingSlate = { ...workingSlate, playerPool: refreshedPlayers };
        if (missingProjectionPlayers.length) stages.projectionWarning = `SportsDataIO did not return a DraftKings projection for ${missingProjectionPlayers.length} MLB players: ${missingProjectionPlayers.join(', ')}.`;
      } catch (error) { stages.projectionWarning = error instanceof Error ? error.message : 'SportsDataIO projection refresh failed.'; }
    }
    if (workingSlate.sport === 'NFL') {
      const missingProjectionPlayers = workingSlate.playerPool.filter((player) => !Number.isFinite(player.providerFppg)).map((player) => player.playerName);
      if (missingProjectionPlayers.length) stages.projectionWarning = `DraftKings did not provide native FPPG projections for ${missingProjectionPlayers.length} NFL players: ${missingProjectionPlayers.join(', ')}.`;
    }
    if (['NBA', 'WNBA', 'MLB', 'NFL'].includes(workingSlate.sport)) {
      try {
        const rows = await availability.getPlayerGameProjectionStats(workingSlate);
        if (rows.length) workingSlate = { ...workingSlate, playerPool: workingSlate.playerPool.map((player) => { const inputs = deriveProjectionInputs(workingSlate.sport, player, rows); return inputs ? { ...player, projectionInputs: inputs } : player; }) };
      } catch (error) { stages.projectionInputsWarning = error instanceof Error ? error.message : 'SportsDataIO projection-stats refresh failed.'; }
    }
  }
  // No dedicated confirmed-lineup feed exists for NBA/WNBA/NFL (SportsDataIO's is MLB-only on
  // this plan), so ESPN's roster status/injuries endpoint is the availability source for these
  // sports -- applied after the SportsDataIO pass above so it overwrites that pass's empty,
  // "no configured feed" result for these sports with real per-player status.
  if (espnProjection && ['NBA', 'WNBA', 'NFL'].includes(workingSlate.sport)) {
    try { workingSlate = applyAvailabilitySnapshot(workingSlate, await espnProjection.getAvailabilitySnapshot(workingSlate)); }
    catch (error) { const message = error instanceof Error ? error.message : 'ESPN availability refresh failed.'; stages.availabilityWarnings = [...((stages.availabilityWarnings as string[] | undefined) ?? []), message]; workingSlate = withDegradedAvailability(workingSlate, `ESPN availability refresh failed; players were not filtered for injury/inactive status: ${message}`); }
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
  await saveStage(db, run, 'SLATE', { contestId: workingSlate.contest.draftKingsContestId }, workingSlate, workingSlate.validation.status, workingSlate.validation.warnings, workingSlate.validation.errors);
  let research = await agent.run({ validatedSlate: workingSlate });
  const criticalGaps = (research.unknowns ?? []).filter((unknown) => unknown.importance === 'CRITICAL');
  if (criticalGaps.length) research = await agent.run({ validatedSlate: workingSlate, researchGaps: criticalGaps });
  assertResearch(research);
  stages.research = research;
  await saveStage(db, run, 'RESEARCH', workingSlate, research, research.status, [], []);
  const researchRun = await db.from('floyd_dfs_research_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: research.version, research_plan: { slateId: workingSlate.slateId }, research_package: research, status: research.status, model_name: openAiModel(), prompt_version: 'research.v1' }).select('id').single();
  if (researchRun.error) throw researchRun.error;
  if (research.findings.length) { const findings = await db.from('floyd_dfs_research_findings').insert(research.findings.map((finding) => ({ tenant_id: run.tenant_id, research_run_id: researchRun.data.id, bucket: finding.bucket, subject_type: finding.subjectType ?? 'EVENT', subject_id: finding.subjectId, finding: finding.finding, source_name: finding.sourceName, source_url: finding.sourceUrl ?? null, source_tier: finding.sourceTier ?? 4, source_purpose: finding.sourcePurpose ?? null, published_at: finding.publishedAt ?? null, retrieved_at: finding.retrievedAt ?? research.generatedAt, confidence: finding.confidence, metadata: finding.metadata ?? {} }))); if (findings.error) throw findings.error; }
  if ((research.unknowns ?? []).length) { const watchItems = await db.from('floyd_dfs_watch_items').insert((research.unknowns ?? []).map((unknown) => ({ tenant_id: run.tenant_id, generation_run_id: run.id, subject: unknown.question, importance: unknown.importance, current_state: { reason: unknown.reason }, trigger_condition: { expectedChangeBeforeLock: true }, affected_player_ids: workingSlate.playerPool.map((player) => player.playerId), affected_lineup_ids: [], expected_update_at: workingSlate.contest.lockTime, status: 'active' }))); if (watchItems.error) throw watchItems.error; }
  let adjustment = adjustSlate(workingSlate, research);
  const adjustmentKey = env('OPENAI_API_KEY');
  if (adjustmentKey && adjustment.status !== 'BLOCKED') { try { adjustment = await adjustWithOpenAi({ slate: workingSlate, research, baseline: adjustment }, { apiKey: adjustmentKey, model: openAiModel() }); } catch (error) { const message = error instanceof Error ? error.message : 'OpenAI Sport Adjustment failed; deterministic specialist retained.'; stages.adjustmentWarning = message; adjustment = { ...adjustment, warnings: [...(adjustment.warnings ?? []), message] }; } }
  assertAdjustment(adjustment, research);
  stages.adjustment = adjustment;
  await saveStage(db, run, 'SPORT_ADJUSTMENT', research, adjustment, adjustment.status, adjustment.warnings ?? []);
  const adjustmentRun = await db.from('floyd_dfs_adjustment_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: adjustment.version, sport: adjustment.sport, adjustment_package: adjustment, status: adjustment.status, model_name: openAiModel(), prompt_version: 'sport-adjustment.deterministic.v1' }).select('id').single();
  if (adjustmentRun.error) throw adjustmentRun.error;
  const adjustmentRows = await db.from('floyd_dfs_player_adjustments').insert(adjustment.adjustments.flatMap((player) => player.adjustments.map((item) => ({ tenant_id: run.tenant_id, adjustment_run_id: adjustmentRun.data.id, player_id: player.playerId, adjustment_type: item.adjustmentType ?? 'CONTEXT', direction: item.direction ?? 'NEUTRAL', magnitude: item.magnitude, confidence: item.confidence, rationale: item.rationale ?? player.projectionNotes[0] ?? 'No additional rationale.', evidence_finding_ids: item.evidenceFindingIds ?? [], metadata: { roleCertainty: player.roleCertainty } }))));
  if (adjustmentRows.error) throw adjustmentRows.error;
  const projection = projectSlate(workingSlate, adjustment);
  assertProjection(projection);
  stages.projection = projection;
  await saveStage(db, run, 'PROJECTION', adjustment, projection, projection.status);
  const projectionRun = await db.from('floyd_dfs_projection_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: projection.version, sport: projection.sport, model_version: projection.modelVersion, simulation_runs: projection.simulationRuns, projection_package: projection, status: projection.status }).select('id').single();
  if (projectionRun.error) throw projectionRun.error;
  const projectionRows = await db.from('floyd_dfs_player_projections').insert(projection.players.map((player) => ({ tenant_id: run.tenant_id, projection_run_id: projectionRun.data.id, player_id: player.playerId, baseline_opportunity: player.baselineOpportunity, adjusted_opportunity: player.adjustedOpportunity, opportunity_delta: player.opportunityDelta, component_projection: player.componentProjection, floor_p20: player.projectedOutcomes.floorP20, median_p50: player.projectedOutcomes.medianP50, ceiling_p90: player.projectedOutcomes.ceilingP90, median_per_1k: player.salaryEfficiency.medianPer1k, ceiling_per_1k: player.salaryEfficiency.ceilingPer1k, confidence: player.confidence, uncertainty_factors: player.uncertaintyFactors, watch_dependencies: player.watchDependencies, model_version: player.modelVersion })));
  if (projectionRows.error) throw projectionRows.error;
  const optimizer = optimizeLineups({ validatedSlate: workingSlate, projectionPackage: projection });
  assertOptimizer(optimizer, workingSlate);
  stages.optimizer = optimizer;
  await saveStage(db, run, 'OPTIMIZE', projection, optimizer, optimizer.status);
  const optimizationRun = await db.from('floyd_dfs_optimization_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: optimizer.version, objective_profile: optimizer.objectiveProfile, optimizer_package: optimizer, status: optimizer.status }).select('id').single();
  if (optimizationRun.error) throw optimizationRun.error;
  const candidateRows = await db.from('floyd_dfs_lineup_candidates').insert(optimizer.candidates.map((candidate) => ({ tenant_id: run.tenant_id, optimization_run_id: optimizationRun.data.id, candidate_key: candidate.id, salary_used: candidate.salaryUsed, salary_remaining: candidate.salaryRemaining, floor: candidate.floor, median: candidate.median, ceiling: candidate.ceiling, correlation_score: candidate.correlationScore, optimal_lineup_frequency: candidate.optimalLineupFrequency, top_one_percent_frequency: candidate.topOnePercentFrequency, ownership_estimate: candidate.ownershipEstimate, leverage_score: candidate.leverageScore, duplication_risk: candidate.duplicationRisk, estimated_duplicates: candidate.estimatedDuplicates, median_rank: candidate.medianRank, ceiling_rank: candidate.ceilingRank, tournament_rank: candidate.tournamentRank, candidate_types: candidate.candidateTypes, roster_slots: candidate.rosterSlots, game_script_cluster: candidate.gameScriptCluster, strategic_similarity: candidate.strategicSimilarity, risk_flags: candidate.riskFlags })));
  if (candidateRows.error) throw candidateRows.error;
  const calibration = await loadCashLineCalibration(db, String(run.tenant_id));
  let selection = selectLineups({ validatedSlate: workingSlate, researchPackage: research, optimizerPackage: optimizer, cashLineCalibration: calibration });
  const openAiKey = env('OPENAI_API_KEY') ?? env('VITE_OPENAI_API_KEY');
  if (openAiKey && selection.status === 'COMPLETE' && selection.selectedLineups.length) {
    try { selection = await selectWithOpenAi({ slate: workingSlate, research, candidates: optimizer.candidates, selection, cashLineCalibration: calibration }, { apiKey: openAiKey, model: env('OPENAI_MODEL') ?? env('AI_MODEL') }); } catch (error) { const message = error instanceof Error ? error.message : 'OpenAI Selection failed; deterministic selection retained.'; stages.selectionWarning = message; selection = { ...selection, warnings: [...(selection.warnings ?? []), message] }; }
  }
  assertSelection(selection, optimizer);
  stages.selection = selection;
  await saveStage(db, run, 'SELECTION', optimizer, selection, selection.status, selection.warnings ?? []);
  const selectionRun = await db.from('floyd_dfs_selection_runs').insert({ tenant_id: run.tenant_id, generation_run_id: run.id, version: 1, selection_package: selection, status: selection.status }).select('id').single();
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
  await db.from('generation_runs').update({ state: selection.status === 'BLOCKED' ? 'blocked' : 'complete', current_stage: 'SELECTION' }).eq('id', run.id);
  return { ...run, state: selection.status === 'BLOCKED' ? 'blocked' : 'complete', stages, lineups: selection.selectedLineups };
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
export function asSport(value: unknown): 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL' { const sport = String(value ?? '').toUpperCase(); if (['WNBA', 'NBA', 'MLB', 'GOLF', 'NFL'].includes(sport)) return sport as 'WNBA' | 'NBA' | 'MLB' | 'GOLF' | 'NFL'; throw new Error(`Unsupported sport: ${sport}.`); }
export type { Json };
