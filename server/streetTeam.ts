import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENGINE_CONTRACT_VERSION, type StreetTeamSnapshot } from '../src/lib/engine/contracts.js';
import { parseStreetTeamSnapshot } from '../src/lib/engine/boundaryContracts.js';
import { SportsDataIoNbaStreetTeamProvider } from './nbaStreetTeamProvider.js';
import { SportsDataIoClient } from '../src/lib/engine/sportsDataIoProvider.js';

const LEASE_MS = 10 * 60_000;
/** The daily NBA collection cadence establishes the default current-state TTL. */
export const NBA_STREET_TEAM_SNAPSHOT_TTL_MS = 24 * 60 * 60_000;
type CollectionClaim = { status: 'CLAIMED'; runId: string } | { status: 'ALREADY_COMPLETE' | 'ALREADY_RUNNING'; snapshotId?: string; asOf?: string; providerDiagnostics?: unknown[] };

export async function collectNbaStreetTeam(db: SupabaseClient, tenantId: string, options: {
  apiKey: string;
  baseUrl?: string;
  now?: () => Date;
  fetcher?: typeof fetch;
  idempotencyKey?: string;
}): Promise<{ status: string; snapshotId?: string; asOf?: string; providerDiagnostics?: unknown[]; unknowns?: unknown[] }> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const dayKey = startedAt.toISOString().slice(0, 10);
  const idempotencyKey = options.idempotencyKey ? `street-team:nba:manual:${options.idempotencyKey}` : `street-team:nba:${dayKey}`;
  const claimed = await claimCollectionRun(db, tenantId, idempotencyKey, startedAt);
  if (claimed.status !== 'CLAIMED') return claimed;

  try {
    const client = new SportsDataIoClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetcher: options.fetcher, maxAttempts: 2 });
    const provider = new SportsDataIoNbaStreetTeamProvider(client, now);
    const providerResult = await provider.collect({ windowStart: new Date(startedAt.getTime() - NBA_STREET_TEAM_SNAPSHOT_TTL_MS) });
    const asOf = now().toISOString();
    const resolvedFacts = providerResult.resolvedFacts.map((fact) => ({
      ...fact,
      tenantId,
      sport: 'NBA' as const,
      state: 'ACCEPTED' as const,
    }));
    const observations = providerResult.observations.map((observation) => ({
      ...observation,
      tenantId,
      sport: 'NBA' as const,
      subject: { kind: observation.subjectKind, id: observation.subjectId },
      contentSha256: sha256(stableJson({ ...observation, retrievedAt: observation.retrievedAt })),
    }));
    const evidenceHash = sha256(stableJson(observations.map((observation) => observation.contentSha256).sort()));
    const hardFailure = !providerResult.rosterAvailable;
    if (hardFailure) {
      const completedAt = now().toISOString();
      const updated = await db.from('floyd_dfs_intel_collection_runs').update({ status: 'FAILED', finished_at: completedAt, lease_expires_at: null, result: { providerDiagnostics: providerResult.providerDiagnostics, unknowns: providerResult.unknowns }, error: { message: 'No usable NBA roster records were collected; latest verified snapshot was retained.' } }).eq('id', claimed.runId).eq('tenant_id', tenantId);
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
      observations,
      resolvedFacts,
      rosterState: providerResult.rosterState,
      availability: providerResult.availability,
      transactions: providerResult.transactions,
      behaviorSignals: [],
      unknowns: providerResult.unknowns,
      providerDiagnostics: providerResult.providerDiagnostics,
    };
    const snapshot = parseStreetTeamSnapshot(candidate, tenantId);
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
          classification: observation.classification,
          confidence: observation.confidence,
          published_at: observation.publishedAt ?? null,
          effective_at: observation.effectiveAt ?? null,
          observed_at: observation.observedAt,
          retrieved_at: observation.retrievedAt,
          expires_at: null,
          supersedes_observation_id: null,
          content_sha256: observation.contentSha256,
          raw_payload: observation.payload,
        }));
        const saved = await db.from('floyd_dfs_intel_observations').upsert(rows, { onConflict: 'tenant_id,sport,provider,content_sha256', ignoreDuplicates: true });
        if (saved.error) throw saved.error;
      }
    }
    const links = observations.map((observation, ordinal) => ({ observation_id: observation.id, ordinal }));
    const insertedSnapshot = await db.rpc('floyd_dfs_create_intel_snapshot_with_evidence', { p_snapshot: snapshotRow, p_evidence_links: links });
    if (insertedSnapshot.error) throw insertedSnapshot.error;
    if (String(insertedSnapshot.data) !== snapshotId) throw new Error('The database returned an unexpected Street Team snapshot ID.');
    const completedAt = now().toISOString();
    const status = hardFailure ? 'FAILED' : freshnessState === 'FRESH' ? 'COMPLETE' : 'PARTIAL';
    const updated = await db.from('floyd_dfs_intel_collection_runs').update({ status, finished_at: completedAt, lease_expires_at: null, result: { snapshotId, asOf, freshnessState, providerDiagnostics: providerResult.providerDiagnostics, unknowns: providerResult.unknowns }, error: hardFailure ? { message: 'No NBA provider feed returned a usable result.' } : null }).eq('id', claimed.runId).eq('tenant_id', tenantId);
    if (updated.error) throw updated.error;
    return { status, snapshotId, asOf, providerDiagnostics: providerResult.providerDiagnostics, unknowns: providerResult.unknowns };
  } catch (error) {
    const finishedAt = now().toISOString();
    await db.from('floyd_dfs_intel_collection_runs').update({ status: 'FAILED', finished_at: finishedAt, lease_expires_at: null, error: { message: safeFailure(error) } }).eq('id', claimed.runId).eq('tenant_id', tenantId);
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
