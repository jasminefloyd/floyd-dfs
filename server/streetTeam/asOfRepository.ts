import type { SupabaseClient } from '@supabase/supabase-js';
import { parseStreetTeamSnapshot } from '../../src/lib/engine/boundaryContracts.js';
import type { StreetTeamResolvedFact } from '../../src/lib/engine/contracts.js';

export interface TeamHistorySnapshot {
  asOf: string;
  rosterState: Array<{ playerId: string; teamId: string }>;
  resolvedFacts: StreetTeamResolvedFact[];
}

export interface TemporalEvidenceRow {
  effective_at: string | null;
  ingested_at: string;
  [key: string]: unknown;
}
const TEMPORAL_PAGE_SIZE = 500;
const TEMPORAL_MAX_ROWS = 100_000;

/** Apply independent valid-time and knowledge-time cutoffs; neither cutoff implies the other. */
export function selectEvidenceAsOf<T extends TemporalEvidenceRow>(rows: T[], eventCutoff: string, knowledgeCutoff: string): T[] {
  const eventTime = cutoffTime(eventCutoff, 'eventCutoff');
  const knowledgeTime = cutoffTime(knowledgeCutoff, 'knowledgeCutoff');
  return rows.filter((row) => {
    if (!row.effective_at) return false;
    const effectiveTime = Date.parse(row.effective_at);
    const ingestedTime = Date.parse(row.ingested_at);
    return Number.isFinite(effectiveTime) && Number.isFinite(ingestedTime) && effectiveTime <= eventTime && ingestedTime <= knowledgeTime;
  }).sort((left, right) => Date.parse(left.effective_at!) - Date.parse(right.effective_at!) || Date.parse(left.ingested_at) - Date.parse(right.ingested_at));
}

/** Query the persistent Street Team ledger with tenant-scoped event and knowledge cutoffs. */
export async function getIntelEvidenceAsOf(db: SupabaseClient, tenantId: string, sport: string, eventCutoff: string, knowledgeCutoff: string): Promise<Record<string, unknown>[]> {
  cutoffTime(eventCutoff, 'eventCutoff'); cutoffTime(knowledgeCutoff, 'knowledgeCutoff');
  return readAllTemporalPages((from, to) => db.from('floyd_dfs_intel_observations').select('*')
    .eq('tenant_id', tenantId).eq('sport', sport)
    .lte('effective_at', new Date(Date.parse(eventCutoff)).toISOString())
    .lte('ingested_at', new Date(Date.parse(knowledgeCutoff)).toISOString())
    .not('effective_at', 'is', null)
    .order('effective_at', { ascending: true }).order('ingested_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
}

/** Query generation-run evidence with the same two-cutoff semantics as the Street Team ledger. */
export async function getRunEvidenceAsOf(db: SupabaseClient, tenantId: string, sport: string, eventCutoff: string, knowledgeCutoff: string): Promise<Record<string, unknown>[]> {
  cutoffTime(eventCutoff, 'eventCutoff'); cutoffTime(knowledgeCutoff, 'knowledgeCutoff');
  return readAllTemporalPages((from, to) => db.from('floyd_dfs_source_observations').select('*')
    .eq('tenant_id', tenantId).eq('sport', sport)
    .lte('effective_at', new Date(Date.parse(eventCutoff)).toISOString())
    .lte('ingested_at', new Date(Date.parse(knowledgeCutoff)).toISOString())
    .not('effective_at', 'is', null)
    .order('effective_at', { ascending: true }).order('ingested_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
}

/** Resolved facts use the same independent event-time and knowledge-time limits as observations. */
export async function getResolvedFactsAsOf(db: SupabaseClient, tenantId: string, eventCutoff: string, knowledgeCutoff: string): Promise<Record<string, unknown>[]> {
  cutoffTime(eventCutoff, 'eventCutoff'); cutoffTime(knowledgeCutoff, 'knowledgeCutoff');
  return readAllTemporalPages((from, to) => db.from('floyd_dfs_resolved_facts').select('*')
    .eq('tenant_id', tenantId)
    .lte('effective_at', new Date(Date.parse(eventCutoff)).toISOString())
    .lte('ingested_at', new Date(Date.parse(knowledgeCutoff)).toISOString())
    .not('effective_at', 'is', null)
    .order('effective_at', { ascending: true }).order('ingested_at', { ascending: true }).order('id', { ascending: true }).range(from, to));
}

/** Reconstruct a team at event time using only facts the system knew by knowledgeCutoff. */
export function replayPlayerTeamAsOf(snapshots: TeamHistorySnapshot[], playerId: string, eventCutoff: string, knowledgeCutoff: string): string | undefined {
  const eventTime = Date.parse(eventCutoff);
  const knowledgeTime = Date.parse(knowledgeCutoff);
  if (!Number.isFinite(eventTime) || !Number.isFinite(knowledgeTime)) throw new Error('Valid event and knowledge cutoffs are required.');
  const known = snapshots.filter((snapshot) => Date.parse(snapshot.asOf) <= knowledgeTime).sort((a, b) => Date.parse(b.asOf) - Date.parse(a.asOf));
  // Without a captured roster at or before event time, the archive cannot prove the player's
  // starting team. Do not backfill it from today's roster unless an earlier snapshot anchors it.
  const anchor = known.find((snapshot) => Date.parse(snapshot.asOf) <= eventTime && snapshot.rosterState.some((row) => row.playerId === playerId));
  if (!anchor) return undefined;
  const anchorRoster = anchor.rosterState.find((row) => row.playerId === playerId)!;
  const anchorTime = Date.parse(anchor.asOf);
  let teamId: string | undefined = anchorRoster.teamId;
  const transactions = [...new Map(known.flatMap((snapshot) => snapshot.resolvedFacts)
    .filter((fact) => fact.subject.id === playerId && fact.factType === 'transaction.record' && fact.state === 'ACCEPTED' && fact.effectiveAt && Date.parse(fact.effectiveAt) <= eventTime && Date.parse(fact.resolvedAt) <= knowledgeTime)
    .map((fact) => [fact.id, fact])).values()]
    .sort((a, b) => Date.parse(a.effectiveAt!) - Date.parse(b.effectiveAt!));
  for (const fact of transactions.filter((item) => Date.parse(item.effectiveAt!) > anchorTime && Date.parse(item.effectiveAt!) <= eventTime)) {
    const value = asRecord(fact.value);
    const from = stringValue(value?.fromTeamId);
    const to = stringValue(value?.toTeamId);
    if (!from || !to || teamId !== from) return undefined;
    teamId = to;
  }
  return teamId;
}

export async function getNbaPlayerTeamAsOf(db: SupabaseClient, tenantId: string, playerId: string, eventCutoff: string, knowledgeCutoff: string): Promise<string | undefined> {
  const knowledgeTime = Date.parse(knowledgeCutoff);
  if (!Number.isFinite(knowledgeTime) || !Number.isFinite(Date.parse(eventCutoff))) throw new Error('Invalid NBA team replay cutoffs.');
  const rows = await readAllTemporalPages((from, to) => db.from('floyd_dfs_intel_snapshots').select('as_of,snapshot_payload').eq('tenant_id', tenantId).eq('sport', 'NBA').lte('as_of', new Date(knowledgeTime).toISOString()).order('as_of', { ascending: false }).order('id', { ascending: false }).range(from, to));
  const snapshots = rows.map((row) => parseStreetTeamSnapshot(row.snapshot_payload, tenantId)).map((snapshot) => ({ asOf: snapshot.asOf, rosterState: snapshot.rosterState.map((row) => ({ playerId: row.playerId, teamId: row.teamId })), resolvedFacts: snapshot.resolvedFacts }));
  return replayPlayerTeamAsOf(snapshots, playerId, eventCutoff, knowledgeCutoff);
}

async function readAllTemporalPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < TEMPORAL_MAX_ROWS; offset += TEMPORAL_PAGE_SIZE) {
    const page = await fetchPage(offset, offset + TEMPORAL_PAGE_SIZE - 1);
    if (page.error) throw page.error;
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < TEMPORAL_PAGE_SIZE) return rows;
  }
  throw new Error('Temporal replay exceeded the 100,000-row safety bound; evidence is marked incomplete by failing the query.');
}

function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
function cutoffTime(value: string, label: string): number { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error(`${label} must be a valid timestamp.`); return time; }
