import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINE_CONTRACT_VERSION, type StreetTeamSnapshot } from '../src/lib/engine/contracts.js';
import { parseStreetTeamSnapshot } from '../src/lib/engine/boundaryContracts.js';
import { SportsDataIoNbaStreetTeamProvider } from './nbaStreetTeamProvider.js';
import { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';
import { deriveStreetTeamBehaviorSignals, toStreetTeamBehaviorSignalRows } from './streetTeam/behavior.js';
import { meaningfulEvidenceHash } from './streetTeam/changeDetection.js';
import { detectStreetTeamMaterialChanges, markUnlockedLineupsForRecheck } from './streetTeam/recheck.js';
import { mergeStreetTeamRefresh } from './streetTeam/refreshMerge.js';
import type { NbaRefreshKind } from './streetTeam/scheduler.js';

const LEASE_MS = 10 * 60_000;
/** The daily NBA collection cadence establishes the default current-state TTL. */
export const NBA_STREET_TEAM_SNAPSHOT_TTL_MS = 24 * 60 * 60_000;
type CollectionClaim = { status: 'CLAIMED'; runId: string } | { status: 'ALREADY_COMPLETE' | 'ALREADY_RUNNING'; snapshotId?: string; asOf?: string; providerDiagnostics?: unknown[] };

export function isSportsDataIoProductionVerifiedDataTier(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'PRODUCTION_VERIFIED';
}

export async function collectNbaStreetTeam(db: SupabaseClient, tenantId: string, options: {
  apiKey: string;
  dataTier?: string;
  baseUrl?: string;
  now?: () => Date;
  fetcher?: typeof fetch;
  idempotencyKey?: string;
  refreshKind?: NbaRefreshKind;
  providerCallBudget?: number;
  scheduleContext?: { gameIds?: string[]; slateIds?: string[] };
}): Promise<{ status: string; snapshotId?: string; asOf?: string; providerDiagnostics?: unknown[]; providerCallCount?: number; providerQuotaState?: unknown; unknowns?: unknown[] }> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const dayKey = startedAt.toISOString().slice(0, 10);
  const idempotencyKey = options.idempotencyKey
    ? options.refreshKind ? `street-team:nba:${options.refreshKind}:${options.idempotencyKey}` : `street-team:nba:manual:${options.idempotencyKey}`
    : `street-team:nba:${dayKey}`;
  const claimed = await claimCollectionRun(db, tenantId, idempotencyKey, startedAt);
  if (claimed.status !== 'CLAIMED') return claimed;

  try {
    if (!isSportsDataIoProductionVerifiedDataTier(options.dataTier)) {
      const finishedAt = now().toISOString();
      const reason = 'Verified SportsDataIO production NBA data tier is not configured; no provider request was made.';
      const blocked = await db.from('floyd_dfs_intel_collection_runs').update({
        status: 'FAILED', finished_at: finishedAt, lease_expires_at: null,
        source_count: 0, changed_count: 0, error_code: 'DATA_TIER_UNVERIFIED', retry_count: 0, provider_request_id: null,
        result: { providerDiagnostics: [{ provider: 'SportsDataIO NBA', status: 'FAILED', retrievedAt: finishedAt, freshness: 'UNKNOWN', error: 'Production NBA data tier is not verified.' }], unknowns: [{ subject: { kind: 'LEAGUE', id: 'nba:league' }, question: 'Verified NBA roster and availability data source is unavailable.', reason }] },
        error: { message: reason },
      }).eq('id', claimed.runId).eq('tenant_id', tenantId);
      if (blocked.error) throw blocked.error;
      return { status: 'FAILED', providerDiagnostics: [{ provider: 'SportsDataIO NBA', status: 'FAILED', retrievedAt: finishedAt, freshness: 'UNKNOWN', error: 'Production NBA data tier is not verified.' }], unknowns: [{ reason }] };
    }
    const client = new SportsDataIoClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetcher: options.fetcher, maxAttempts: 2, requestBudget: options.providerCallBudget });
    const provider = new SportsDataIoNbaStreetTeamProvider(client, now, options.fetcher);
    const previousSnapshot = await db.from('floyd_dfs_intel_snapshots').select('id,as_of,evidence_hash,snapshot_payload')
      .eq('tenant_id', tenantId).eq('sport', 'NBA').order('as_of', { ascending: false }).limit(1).maybeSingle();
    if (previousSnapshot.error) throw previousSnapshot.error;
    const previousPayload = previousSnapshot.data?.snapshot_payload ? parseStreetTeamSnapshot(previousSnapshot.data.snapshot_payload, tenantId) : null;
    const freshProviderResult = await provider.collect({ windowStart: new Date(startedAt.getTime() - NBA_STREET_TEAM_SNAPSHOT_TTL_MS), refreshKind: options.refreshKind ?? 'FULL' });
    const providerResult = mergeStreetTeamRefresh(previousPayload, freshProviderResult, options.refreshKind ?? 'FULL', startedAt);
    const asOf = now().toISOString();
    const resolvedFacts = providerResult.resolvedFacts.map((fact) => ({
      ...fact,
      tenantId,
      sport: 'NBA' as const,
      state: fact.state ?? 'ACCEPTED',
    }));
    const observations = providerResult.observations.map((observation) => ({
      ...observation,
      tenantId,
      sport: 'NBA' as const,
      source: observation.provider,
      subject: { kind: observation.subjectKind, id: observation.subjectId },
      contentSha256: sha256(stableJson({ ...observation, retrievedAt: observation.retrievedAt })),
    }));
    const retainedObservations = providerResult.retainedObservations.map((observation) => {
      const raw = observation as unknown as Record<string, unknown>;
      return { id: observation.id, provider: String(raw.provider ?? observation.source), sourceRecordId: observation.sourceRecordId, sourceUrl: observation.sourceUrl ?? '', subjectKind: observation.subject.kind, subjectId: observation.subject.id, claim: observation.claim, classification: observation.classification, confidence: observation.confidence, publishedAt: observation.publishedAt, effectiveAt: observation.effectiveAt, observedAt: observation.observedAt, retrievedAt: observation.retrievedAt, payload: asRecord(raw.payload) ?? {} };
    });
    const snapshotObservations = [...retainedObservations, ...observations];
    const evidenceHash = meaningfulEvidenceHash(snapshotObservations);
    const hardFailure = !providerResult.rosterAvailable;
    if (hardFailure) {
      const completedAt = now().toISOString();
      const updated = await db.from('floyd_dfs_intel_collection_runs').update({ status: 'FAILED', finished_at: completedAt, lease_expires_at: null, source_count: providerResult.providerDiagnostics.length, changed_count: 0, error_code: 'NO_USABLE_ROSTER', retry_count: 1, provider_request_id: null, result: { providerDiagnostics: providerResult.providerDiagnostics, providerCallCount: providerResult.providerCallCount ?? 0, providerQuotaState: providerResult.providerQuotaState ?? null, unknowns: providerResult.unknowns, retainedLastKnownGood: true }, error: { message: 'No usable NBA roster records were collected; latest verified snapshot was retained.' } }).eq('id', claimed.runId).eq('tenant_id', tenantId);
      if (updated.error) throw updated.error;
      return { status: 'FAILED', providerDiagnostics: providerResult.providerDiagnostics, unknowns: providerResult.unknowns };
    }
    const freshnessState = hardFailure ? 'UNKNOWN' : providerResult.providerDiagnostics.some((diagnostic) => diagnostic.status === 'FAILED' || diagnostic.status === 'RATE_LIMITED') || providerResult.unknowns.length ? 'PARTIAL' : 'FRESH';
    const snapshotId = randomUUID();
    const candidate = {
      contractVersion: ENGINE_CONTRACT_VERSION,
      snapshotId,
      tenantId,
      sport: 'NBA',
      asOf,
      createdAt: now().toISOString(),
      evidenceHash,
      observations: snapshotObservations,
      resolvedFacts,
      rosterState: providerResult.rosterState,
      availability: providerResult.availability,
      transactions: providerResult.transactions,
      behaviorSignals: deriveStreetTeamBehaviorSignals(tenantId, snapshotObservations),
      unknowns: providerResult.unknowns,
      providerDiagnostics: providerResult.providerDiagnostics,
    };
    const snapshot = parseStreetTeamSnapshot(candidate, tenantId);
    const changed = previousSnapshot.data?.evidence_hash !== evidenceHash;
    const snapshotRow = {
      id: snapshotId,
      tenant_id: tenantId,
      sport: 'NBA',
      as_of: snapshot.asOf,
      evidence_hash: snapshot.evidenceHash,
      freshness_state: freshnessState,
      resolved_facts: snapshot.resolvedFacts,
      snapshot_payload: snapshot,
    };
    if (observations.length) {
      const ingestedAt = now().toISOString();
      for (const batch of chunks(observations, 250)) {
        const rows = batch.map((observation) => ({
          id: observation.id,
          tenant_id: tenantId,
          collection_run_id: claimed.runId,
          sport: 'NBA',
          provider: observation.provider,
          source_record_id: observation.sourceRecordId ?? null,
          source_url: observation.sourceUrl,
          subject_kind: observation.subject.kind,
          subject_id: observation.subject.id,
          claim: observation.claim,
          normalized_claim: typeof observation.payload.normalizedClaim === 'string' ? observation.payload.normalizedClaim : observation.claim,
          source_tier: typeof observation.payload.sourceTier === 'string' ? observation.payload.sourceTier : 'UNKNOWN',
          quantifiable: observation.payload.quantifiable === true,
          classification: observation.classification,
          confidence: observation.confidence,
          published_at: observation.publishedAt ?? null,
          effective_at: observation.effectiveAt ?? null,
          observed_at: observation.observedAt,
          retrieved_at: observation.retrievedAt,
          ingested_at: ingestedAt,
          expires_at: null,
          supersedes_observation_id: null,
          content_sha256: observation.contentSha256,
          raw_payload: observation.payload,
          raw_payload_sha256: sha256(stableJson(observation.payload)),
          schema_version: 2,
        }));
        const saved = await db.from('floyd_dfs_intel_observations').upsert(rows, { onConflict: 'tenant_id,sport,provider,content_sha256', ignoreDuplicates: true });
        if (saved.error) throw saved.error;
      }
    }
    if (snapshot.behaviorSignals.length) {
      const rows = toStreetTeamBehaviorSignalRows(tenantId, snapshot.behaviorSignals, snapshot.observations);
      for (const batch of chunks(rows, 250)) {
        const saved = await db.from('floyd_dfs_behavior_signals').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (saved.error) throw saved.error;
      }
    }
    const links = snapshotObservations.map((observation, ordinal) => ({ observation_id: observation.id, ordinal }));
    let canonicalSnapshotId: string | undefined = snapshotId;
    let recheckRequiredLineupCount = 0;
    const identityFeedsCurrent = ['SportsDataIO NBA Players', 'SportsDataIO NBA InjuredPlayers'].every((provider) => {
      const diagnostic = providerResult.providerDiagnostics.find((item) => item.provider === provider);
      // An empty InjuredPlayers array is a valid current response (no listed injuries).
      return Boolean(diagnostic && diagnostic.status !== 'FAILED' && diagnostic.status !== 'RATE_LIMITED' && diagnostic.freshness === 'FRESH');
    });
    const previousAgeMs = previousSnapshot.data?.as_of ? now().getTime() - Date.parse(String(previousSnapshot.data.as_of)) : Number.POSITIVE_INFINITY;
    const previousSnapshotStale = !Number.isFinite(previousAgeMs) || previousAgeMs < 0 || previousAgeMs > NBA_STREET_TEAM_SNAPSHOT_TTL_MS;
    const mayPersistPartial = freshnessState === 'PARTIAL' && identityFeedsCurrent;
    if (freshnessState === 'PARTIAL' && previousSnapshot.data?.id && !mayPersistPartial) {
      canonicalSnapshotId = previousSnapshot.data?.id ? String(previousSnapshot.data.id) : undefined;
    } else if (changed || previousSnapshotStale) {
      // A successful current roster and injury response is enough to refresh the
      // identity snapshot even when unrelated feeds/questions leave the collection
      // PARTIAL. The snapshot remains marked PARTIAL and the identity gate still
      // independently excludes unmapped, conflicted, or explicitly unavailable players.
      // If either identity feed failed, retain the last known good snapshot instead.
      const materialChanges = detectStreetTeamMaterialChanges(snapshot, previousPayload ?? undefined);
      recheckRequiredLineupCount = await markUnlockedLineupsForRecheck(db, tenantId, materialChanges, snapshotId, now());
      const insertedSnapshot = await db.rpc('floyd_dfs_create_intel_snapshot_with_evidence', { p_snapshot: snapshotRow, p_evidence_links: links });
      if (insertedSnapshot.error) throw insertedSnapshot.error;
      if (String(insertedSnapshot.data) !== snapshotId) throw new Error('The database returned an unexpected Street Team snapshot ID.');
    } else {
      canonicalSnapshotId = String(previousSnapshot.data!.id);
    }
    const completedAt = now().toISOString();
    const status = hardFailure ? 'FAILED' : freshnessState === 'FRESH' ? 'COMPLETE' : 'PARTIAL';
    const hasProviderFailure = providerResult.providerDiagnostics.some((item) => item.status === 'FAILED' || item.status === 'RATE_LIMITED');
    const partialMessage = hasProviderFailure ? 'A provider feed was incomplete; the latest verified snapshot was retained.' : 'Unresolved evidence was found; the latest verified snapshot was retained.';
    const updated = await db.from('floyd_dfs_intel_collection_runs').update({ status, finished_at: completedAt, lease_expires_at: null, source_count: providerResult.providerDiagnostics.length, changed_count: freshnessState === 'FRESH' && changed ? observations.length : 0, error_code: hardFailure ? 'NO_USABLE_ROSTER' : hasProviderFailure ? providerResult.providerDiagnostics.some((item) => item.status === 'RATE_LIMITED') ? 'RATE_LIMITED' : 'PARTIAL_SOURCE_FAILURE' : freshnessState === 'PARTIAL' ? 'UNRESOLVED_EVIDENCE' : null, retry_count: hasProviderFailure ? 1 : 0, provider_request_id: null, result: { snapshotId: canonicalSnapshotId ?? null, asOf, freshnessState, changed, recheckRequiredLineupCount, retainedLastKnownGood: freshnessState === 'PARTIAL', scheduleContext: normalizeScheduleContext(options.scheduleContext), providerDiagnostics: providerResult.providerDiagnostics, providerCallCount: providerResult.providerCallCount ?? 0, providerQuotaState: providerResult.providerQuotaState ?? null, unknowns: providerResult.unknowns }, error: freshnessState === 'PARTIAL' ? { message: partialMessage } : null }).eq('id', claimed.runId).eq('tenant_id', tenantId);
    if (updated.error) throw updated.error;
    return { status, snapshotId: canonicalSnapshotId, asOf, providerDiagnostics: providerResult.providerDiagnostics, providerCallCount: providerResult.providerCallCount ?? 0, providerQuotaState: providerResult.providerQuotaState, unknowns: providerResult.unknowns };
  } catch (error) {
    const finishedAt = now().toISOString();
    await db.from('floyd_dfs_intel_collection_runs').update({ status: 'FAILED', finished_at: finishedAt, lease_expires_at: null, error_code: errorCode(error), retry_count: 1, error: { message: safeFailure(error) } }).eq('id', claimed.runId).eq('tenant_id', tenantId);
    throw error;
  }
}

async function claimCollectionRun(db: SupabaseClient, tenantId: string, idempotencyKey: string, now: Date): Promise<CollectionClaim> {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  const inserted = await db.from('floyd_dfs_intel_collection_runs').insert({ tenant_id: tenantId, sport: 'NBA', provider: 'SPORTSDATAIO', window_start: new Date(now.getTime() - NBA_STREET_TEAM_SNAPSHOT_TTL_MS).toISOString(), window_end: now.toISOString(), status: 'RUNNING', idempotency_key: idempotencyKey, started_at: now.toISOString(), lease_expires_at: leaseExpiresAt }).select('id').single();
  if (!inserted.error) return { status: 'CLAIMED', runId: String(inserted.data.id) };
  if (inserted.error.code !== '23505') throw inserted.error;
  const existing = await db.from('floyd_dfs_intel_collection_runs').select('id,status,lease_expires_at,attempt_count,result').eq('tenant_id', tenantId).eq('sport', 'NBA').eq('provider', 'SPORTSDATAIO').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error('Collection idempotency conflict could not be resolved.');
  const priorResult = asRecord(existing.data.result);
  if (existing.data.status === 'COMPLETE') return { status: 'ALREADY_COMPLETE', snapshotId: stringValue(priorResult?.snapshotId), asOf: stringValue(priorResult?.asOf), providerDiagnostics: Array.isArray(priorResult?.providerDiagnostics) ? priorResult.providerDiagnostics : [] };
  if (existing.data.status === 'RUNNING' && Date.parse(String(existing.data.lease_expires_at ?? '')) > now.getTime()) return { status: 'ALREADY_RUNNING' };
  const reclaimed = await db.from('floyd_dfs_intel_collection_runs').update({ status: 'RUNNING', started_at: now.toISOString(), finished_at: null, lease_expires_at: leaseExpiresAt, attempt_count: Number(existing.data.attempt_count ?? 1) + 1, error: null }).eq('id', existing.data.id).eq('tenant_id', tenantId).eq('status', existing.data.status).select('id').maybeSingle();
  if (reclaimed.error) throw reclaimed.error;
  if (!reclaimed.data) return { status: 'ALREADY_RUNNING' };
  return { status: 'CLAIMED', runId: String(reclaimed.data.id) };
}

export async function getStreetTeamSnapshot(db: SupabaseClient, tenantId: string, snapshotId?: string): Promise<StreetTeamSnapshot | null> {
  let query = db.from('floyd_dfs_intel_snapshots').select('id,snapshot_payload').eq('tenant_id', tenantId).eq('sport', 'NBA');
  if (snapshotId) query = query.eq('id', snapshotId);
  else query = query.order('as_of', { ascending: false }).limit(1);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return parseStreetTeamSnapshot(result.data.snapshot_payload, tenantId);
}

export async function getStreetTeamSnapshotAsOf(db: SupabaseClient, tenantId: string, asOf: string): Promise<StreetTeamSnapshot | null> {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('asOf must be a valid timestamp.');
  const result = await db.from('floyd_dfs_intel_snapshots').select('id,snapshot_payload').eq('tenant_id', tenantId).eq('sport', 'NBA').lte('as_of', new Date(cutoff).toISOString()).order('as_of', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return null;
  return parseStreetTeamSnapshot(result.data.snapshot_payload, tenantId);
}

export function streetTeamSnapshotFreshness(snapshot: StreetTeamSnapshot, now = new Date()): 'FRESH' | 'PARTIAL' | 'STALE' {
  const ageMs = now.getTime() - Date.parse(snapshot.asOf);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > NBA_STREET_TEAM_SNAPSHOT_TTL_MS) return 'STALE';
  return snapshot.unknowns.length || snapshot.providerDiagnostics.some((diagnostic) => diagnostic.status === 'FAILED' || diagnostic.status === 'RATE_LIMITED' || diagnostic.freshness !== 'FRESH')
    ? 'PARTIAL'
    : 'FRESH';
}

export async function listStreetTeamSnapshots(db: SupabaseClient, tenantId: string, limit: number): Promise<unknown[]> {
  const result = await db.from('floyd_dfs_intel_snapshots').select('id,as_of,freshness_state,evidence_hash,created_at').eq('tenant_id', tenantId).eq('sport', 'NBA').order('as_of', { ascending: false }).limit(limit);
  if (result.error) throw result.error;
  return result.data ?? [];
}

export async function getLatestStreetTeamCollectionRun(db: SupabaseClient, tenantId: string): Promise<Record<string, unknown> | null> {
  const result = await db.from('floyd_dfs_intel_collection_runs')
    .select('id,status,started_at,finished_at,attempt_count,result,error')
    .eq('tenant_id', tenantId)
    .eq('sport', 'NBA')
    .eq('provider', 'SPORTSDATAIO')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as Record<string, unknown> | null;
}

function chunks<T>(items: T[], size: number): T[][] { const batches: T[][] = []; for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size)); return batches; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function safeFailure(error: unknown): string { const message = error instanceof Error ? error.message : 'Street Team collection failed.'; return message.replace(/https?:\/\/[^\s?]+\?[^\s]+/g, '[provider URL]').slice(0, 300); }
function normalizeScheduleContext(value: { gameIds?: string[]; slateIds?: string[] } | undefined): { gameIds: string[]; slateIds: string[] } { return { gameIds: [...new Set((value?.gameIds ?? []).filter((item) => typeof item === 'string' && item.length <= 128))].sort(), slateIds: [...new Set((value?.slateIds ?? []).filter((item) => typeof item === 'string' && item.length <= 128))].sort() }; }
function errorCode(error: unknown): string { const message = error instanceof Error ? error.message : ''; const status = /HTTP (\d{3})/.exec(message)?.[1]; return status ? `HTTP_${status}` : /timed? ?out|abort/i.test(message) ? 'TIMEOUT' : 'COLLECTION_FAILED'; }
