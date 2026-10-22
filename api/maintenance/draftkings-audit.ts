import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { DRAFTKINGS_ENDPOINT_REGISTRY, DraftKingsApiError } from '../../src/lib/engine/draftKings.js';
import type { ContestFormat, Sport } from '../../src/lib/engine/contracts.js';
import { buildValidatedSlateFromBundle } from '../../src/lib/engine/draftKingsSlate.js';
import { cors, draftKingsClient, method, requireOperator, respondError, schedulerContext, tenantContext } from '../../server/runtime.js';

const SPORTS: Sport[] = ['WNBA', 'NBA', 'MLB', 'GOLF', 'NFL', 'CFB'];
const FORMATS: ContestFormat[] = ['CLASSIC', 'SHOWDOWN'];

type Check = { endpoint: string; version: string; sport?: Sport; format?: ContestFormat; status: 'PASS'|'DEGRADED'|'FAIL'|'ACCESS_RESTRICTED'|'RATE_LIMITED'|'TIMEOUT'|'NOT_APPLICABLE'; route?: string; schemaHash?: string; detail?: string; startedAt: string; finishedAt: string; };

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!method(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET' && String(req.query.status ?? '') === '1') {
      const context = await tenantContext(req); requireOperator(context);
      const { data, error } = await context.db.from('floyd_dfs_scheduler_runs').select('job_key,status,started_at,completed_at,lease_expires_at,attempt_count,result,error').eq('tenant_id', context.tenantId).eq('job_type', 'DRAFTKINGS_COMPATIBILITY_AUDIT').order('started_at', { ascending: false }).limit(12);
      if (error) throw error;
      cors(req, res); res.status(200).json({ schedule: '0 14 1 * * (UTC)', lastAudit: data?.[0] ?? null, recentAudits: data ?? [], expectedNextAuditAt: nextMonthlyAudit().toISOString(), independentHeartbeat: 'Not configured; configure external monitoring for a missing monthly audit.' }); return;
    }
    if (req.method === 'GET') {
      const context = await schedulerContext(req);
      const period = new Date().toISOString().slice(0, 7);
      const outcome = await executeAudit(context.db, context.tenantId, `draftkings-audit:${period}`, 'MONTHLY');
      cors(req, res); res.status(200).json(outcome); return;
    }
    const context = await tenantContext(req); requireOperator(context);
    const started = new Date();
    const jobKey = `draftkings-audit:manual:${started.toISOString()}`;
    const result = await executeAudit(context.db, context.tenantId, jobKey, 'MANUAL');
    cors(req, res); res.status(200).json(result);
  } catch (error) { respondError(req, res, error); }
}

async function executeAudit(db: any, tenantId: string, jobKey: string, mode: 'MONTHLY'|'MANUAL') {
  const existing = await db.from('floyd_dfs_scheduler_runs').select('id,status,lease_expires_at,attempt_count,result').eq('tenant_id', tenantId).eq('job_key', jobKey).maybeSingle();
  if (existing.error) throw existing.error;
  let runId = String(existing.data?.id ?? '');
  const now = new Date(); const lease = new Date(now.getTime() + 10 * 60_000).toISOString();
  if (existing.data?.status === 'SUCCEEDED') return { status: 'ALREADY_COMPLETE', result: existing.data.result };
  if (existing.data?.status === 'RUNNING' && Date.parse(String(existing.data.lease_expires_at ?? '')) > now.getTime()) return { status: 'ALREADY_RUNNING', leaseExpiresAt: existing.data.lease_expires_at };
  if (runId) {
    const reclaimed = await db.from('floyd_dfs_scheduler_runs').update({ status: 'RUNNING', started_at: now.toISOString(), completed_at: null, lease_expires_at: lease, attempt_count: Number(existing.data.attempt_count ?? 1) + 1, error: null }).eq('id', runId).eq('tenant_id', tenantId).neq('status', 'SUCCEEDED').select('id').maybeSingle();
    if (reclaimed.error) throw reclaimed.error;
    if (!reclaimed.data) return { status: 'ALREADY_RUNNING' };
  } else {
    const claim = await db.from('floyd_dfs_scheduler_runs').insert({ tenant_id: tenantId, job_key: jobKey, job_type: 'DRAFTKINGS_COMPATIBILITY_AUDIT', status: 'RUNNING', lease_expires_at: lease }).select('id').single();
    if (claim.error?.code === '23505') return { status: 'ALREADY_RUNNING' };
    if (claim.error) throw claim.error;
    runId = String(claim.data.id);
  }
  try {
    const audit = await runCompatibilityChecks(db, tenantId);
    const jobParts = jobKey.split(':');
    const payload = { mode, auditPeriod: jobParts[jobParts.length - 1], scheduleUtc: '0 14 1 * *', adapterVersion: 'draftkings-endpoint-registry.v1', checks: audit.checks, summary: audit.summary, criticalFailures: audit.criticalFailures };
    const completedAt = new Date().toISOString();
    const update = await db.from('floyd_dfs_scheduler_runs').update({ status: audit.criticalFailures ? 'FAILED' : 'SUCCEEDED', completed_at: completedAt, lease_expires_at: null, result: payload, error: audit.criticalFailures ? { message: 'One or more required DraftKings integration checks failed.' } : null }).eq('id', runId).eq('tenant_id', tenantId);
    if (update.error) throw update.error;
    if (audit.criticalFailures) await recordIncident(db, tenantId, payload);
    return { status: audit.criticalFailures ? 'DEGRADED' : 'SUCCEEDED', ...payload };
  } catch (error) {
    await db.from('floyd_dfs_scheduler_runs').update({ status: 'FAILED', completed_at: new Date().toISOString(), lease_expires_at: null, error: { message: safeError(error) } }).eq('id', runId).eq('tenant_id', tenantId);
    throw error;
  }
}

async function runCompatibilityChecks(db: any, tenantId: string) {
  const dk = draftKingsClient(); const checks: Check[] = []; const environment = process.env.VERCEL_ENV ?? 'local';
  await check(checks, 'sports', undefined, undefined, async () => { const sports = await dk.listSports(); if (!Array.isArray(sports)) throw new Error('Response did not contain sports.'); return { detail: `Parsed ${sports.length} sports.` }; });
  for (const sport of SPORTS) {
    let listing: Awaited<ReturnType<typeof dk.listContestsAndGroups>> | undefined;
    await check(checks, 'contests', sport, undefined, async () => { listing = await dk.listContestsAndGroups(sport, 'CLASSIC'); if (!listing.contests || !listing.groups) throw new Error('Lobby response failed to parse contests/groups.'); return { detail: `${listing.contests.length} contests; ${listing.groups.length} draft groups.` }; });
    for (const format of FORMATS) {
      const active = listing?.contests.find((contest) => contest.format === format && contest.draftGroupId && Date.parse(contest.lockTime) > Date.now());
      if (!active) { checks.push({ endpoint: 'contest', version: DRAFTKINGS_ENDPOINT_REGISTRY.contest.parserVersion, sport, format, status: 'NOT_APPLICABLE', detail: 'No active contest/draft group for this sport and format.', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }); continue; }
      await check(checks, 'contest', sport, format, async () => { const detail = await dk.getContest(active.draftKingsContestId); if (!detail.data || detail.status < 200 || detail.status >= 300) throw new Error('Contest detail response was invalid.'); return { route: safeRoute(detail.url), detail: 'Contest detail returned.' }; });
      await check(checks, 'draftGroup', sport, format, async () => { const group = await dk.getDraftGroup(active.draftGroupId!); if (!group.data || group.status < 200 || group.status >= 300) throw new Error('Draft group response was invalid.'); return { route: safeRoute(group.url), detail: 'Draft group returned.' }; });
      let activeBundle: Awaited<ReturnType<typeof dk.getSlateBundleForDraftGroup>> | undefined;
      await check(checks, 'gameTypeRules', sport, format, async () => { activeBundle = await dk.getSlateBundleForDraftGroup({ contestId: active.draftKingsContestId, draftGroupId: active.draftGroupId!, sport, format, contestName: active.name, contestLockTime: active.lockTime }); const slate = buildValidatedSlateFromBundle(activeBundle, { tenantId, userId: 'provider-audit', requestId: randomUUID(), sport, league: sport, contestId: active.draftKingsContestId, contestFormat: format, userEntryCount: 1, contestName: active.name, contestLockTime: active.lockTime }); if (slate.validation.status === 'BLOCKED') throw new Error(`Live slate canary validation blocked: ${slate.validation.errors.slice(0, 3).join(' ')}`); return { route: safeRoute(activeBundle.gameTypeRules.url), schemaHash: schemaHash({ contest: activeBundle.contest.data, group: activeBundle.draftGroup.data, rules: activeBundle.gameTypeRules.data, players: activeBundle.draftables.data }), detail: `Live non-submitting slate canary passed with ${slate.playerPool.length} players and ${slate.games?.length ?? 0} mapped games; validation ${slate.validation.status}.` }; });
      if (activeBundle?.accessFallback) checks.push({ endpoint: 'availablePlayersCsv', version: DRAFTKINGS_ENDPOINT_REGISTRY.availablePlayersCsv.parserVersion, sport, format, status: 'DEGRADED', route: safeRoute(activeBundle.draftables.url), detail: `Primary draftables access returned ${activeBundle.accessFallback.status}; approved CSV fallback parsed ${Object.keys(activeBundle.draftables.data as object).length} response fields.`, startedAt: activeBundle.accessFallback.retrievedAt, finishedAt: activeBundle.draftables.retrievedAt });
      else checks.push({ endpoint: 'availablePlayersCsv', version: DRAFTKINGS_ENDPOINT_REGISTRY.availablePlayersCsv.parserVersion, sport, format, status: 'NOT_APPLICABLE', detail: 'CSV fallback is exercised only when the primary draftables endpoint returns an access 403.', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
      await check(checks, 'draftables', sport, format, async () => { if (activeBundle?.accessFallback) throw new DraftKingsApiError('Primary draftables endpoint required a restricted-access CSV fallback.', { url: activeBundle.draftables.url, status: 403 }); const response = await dk.getDraftables(active.draftGroupId!); if (!response.data || response.status < 200 || response.status >= 300) throw new Error('Draftables response was invalid.'); return { route: safeRoute(response.url), detail: 'Draftables endpoint returned a response.' }; });
    }
  }
  const criticalFailures = checks.filter((item) => ['FAIL','ACCESS_RESTRICTED','RATE_LIMITED','TIMEOUT'].includes(item.status)).length;
  for (const item of checks) {
    const mapped = item.status === 'PASS' ? 'HEALTHY' : item.status === 'NOT_APPLICABLE' ? 'EMPTY' : item.status === 'ACCESS_RESTRICTED' ? 'AUTH_BLOCKED' : item.status === 'RATE_LIMITED' ? 'RATE_LIMITED' : item.status === 'FAIL' ? 'INVALID_SCHEMA' : 'UNAVAILABLE';
    const { error } = await db.from('floyd_dfs_provider_health_checks').upsert({ tenant_id: tenantId, endpoint_key: item.endpoint, endpoint_version: item.version, environment, sport: item.sport ?? null, contest_format: item.format ?? null, resolved_route: item.route ?? DRAFTKINGS_ENDPOINT_REGISTRY[item.endpoint as keyof typeof DRAFTKINGS_ENDPOINT_REGISTRY].routeTemplate, started_at: item.startedAt, finished_at: item.finishedAt, status: mapped, schema_version: item.version, schema_sha256: item.schemaHash ?? null, freshness_check: item.status === 'PASS' || item.status === 'NOT_APPLICABLE' ? 'PASS' : 'UNKNOWN', identity_check: item.status === 'PASS' || item.status === 'NOT_APPLICABLE' ? 'PASS' : 'UNKNOWN', failure_detail: item.detail ?? null, retry_count: 0, idempotency_key: `dk-audit:${item.endpoint}:${item.sport ?? 'ALL'}:${item.format ?? 'ALL'}:${item.finishedAt}` }, { onConflict: 'tenant_id,idempotency_key' });
    if (error) throw error;
  }
  const summary = Object.fromEntries(['PASS','DEGRADED','FAIL','ACCESS_RESTRICTED','RATE_LIMITED','TIMEOUT','NOT_APPLICABLE'].map((status) => [status, checks.filter((item) => item.status === status).length]));
  return { checks, summary, criticalFailures };
}

async function check(checks: Check[], endpoint: keyof typeof DRAFTKINGS_ENDPOINT_REGISTRY, sport: Sport|undefined, format: ContestFormat|undefined, operation: () => Promise<{ route?: string; detail?: string }>) {
  const startedAt = new Date().toISOString();
  try { const result = await operation(); checks.push({ endpoint, version: DRAFTKINGS_ENDPOINT_REGISTRY[endpoint].parserVersion, sport, format, status: 'PASS', ...result, startedAt, finishedAt: new Date().toISOString() }); }
  catch (error) { const status = classify(error); checks.push({ endpoint, version: DRAFTKINGS_ENDPOINT_REGISTRY[endpoint].parserVersion, sport, format, status, detail: safeError(error), startedAt, finishedAt: new Date().toISOString() }); }
}
function classify(error: unknown): Check['status'] { const status = error instanceof DraftKingsApiError ? error.details.status : undefined; if (status === 403) return 'ACCESS_RESTRICTED'; if (status === 429) return 'RATE_LIMITED'; if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) return 'TIMEOUT'; return 'FAIL'; }
function safeError(error: unknown): string { const value = error instanceof Error ? error.message : 'Provider check failed.'; return value.replace(/https?:\/\/[^\s?]+\?[^\s]+/g, '[provider URL]').slice(0, 300); }
function safeRoute(value: string): string { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return '[unresolved route]'; } }
function schemaHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(schemaShape(value))).digest('hex'); }
function schemaShape(value: unknown): unknown { if (Array.isArray(value)) return { type: 'array', sample: value.slice(0, 3).map(schemaShape) }; if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, schemaShape(item)])); return value === null ? 'null' : typeof value; }
async function recordIncident(db: any, tenantId: string, payload: unknown) { const now = new Date().toISOString(); const key = 'draftkings-compatibility-audit:critical'; const current = await db.from('floyd_dfs_runtime_health_incidents').select('id,occurrence_count,first_seen_at').eq('tenant_id', tenantId).eq('incident_key', key).maybeSingle(); if (current.error) throw current.error; const row = { tenant_id: tenantId, incident_key: key, severity: 'CRITICAL', component: 'DRAFTKINGS_COMPATIBILITY', safe_summary: 'Monthly DraftKings compatibility audit detected required integration failures.', details_redacted: payload, first_seen_at: current.data?.first_seen_at ?? now, last_seen_at: now, occurrence_count: Number(current.data?.occurrence_count ?? 0) + 1, resolved_at: null }; const result = await db.from('floyd_dfs_runtime_health_incidents').upsert(row, { onConflict: 'tenant_id,incident_key' }); if (result.error) throw result.error; }
function nextMonthlyAudit() { const now = new Date(); const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 14)); if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1); return next; }
