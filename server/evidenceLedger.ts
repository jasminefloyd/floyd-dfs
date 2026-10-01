import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveObservations } from '../src/lib/engine/factResolution.js';
import { buildRunTrust } from '../src/lib/engine/runTrust.js';
import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, SelectionPackage, SourceObservation, ValidatedSlate } from '../src/lib/engine/contracts.js';

export async function persistEvidenceLedger(db: SupabaseClient, input: {
  tenantId: string;
  runId: string;
  slate: ValidatedSlate;
  rawSlate: ValidatedSlate;
  research: ResearchPackage;
  adjustment: AdjustmentPackage;
  projection: ProjectionPackage;
  optimizer: OptimizerPackage;
  selection: SelectionPackage;
}): Promise<void> {
  const { tenantId, runId, slate, rawSlate, research, adjustment, projection, optimizer, selection } = input;
  const snapshots = [
    { snapshot_type: 'VALIDATED_DRAFTKINGS_SLATE', source: 'DRAFTKINGS', payload: rawSlate, source_retrieved_at: rawSlate.receivedAt },
    { snapshot_type: 'ENRICHED_RUN_SLATE', source: 'ENGINE', payload: slate, source_retrieved_at: slate.receivedAt },
  ].map((snapshot) => ({ tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, ...snapshot, content_sha256: digest(snapshot.payload) }));
  const snapshotResult = await db.from('floyd_dfs_run_data_snapshots').upsert(snapshots, { onConflict: 'tenant_id,generation_run_id,snapshot_type,source,content_sha256', ignoreDuplicates: true });
  if (snapshotResult.error) throw snapshotResult.error;

  const observations = research.findings.map((finding): SourceObservation => {
    const player = slate.playerPool.find((candidate) => candidate.playerId === finding.subjectId);
    const direct = /directly fetched/i.test(finding.sourcePurpose ?? '');
    const assertion = finding.finding.toLowerCase();
    const status: SourceObservation['status'] = direct && finding.confidence === 'HIGH' && /confirmed as a starter|ruled out|inactive/.test(assertion) ? 'CONFIRMED' : finding.publishedAt ? 'REPORTED' : 'UNVERIFIED';
    const observedAt = finding.publishedAt ?? finding.retrievedAt ?? research.generatedAt;
    const observation: SourceObservation = {
      id: deterministicUuid(`${runId}:${finding.id}:${finding.retrievedAt ?? research.generatedAt}`), tenantId, slateId: slate.slateId, sport: slate.sport, eventId: slate.event.eventId,
      source: finding.sourceName, sourceRecordId: finding.id, sourceUrl: finding.sourceUrl,
      // Until predicate/entity extraction is implemented, keep unrelated prose claims in
      // distinct fact groups. Grouping all NEWS or AVAILABILITY sentences by bucket would
      // incorrectly report ordinary multi-claim articles as contradictions.
      subject: { kind: finding.subjectType === 'LEAGUE' ? 'EVENT' : finding.subjectType ?? 'EVENT', id: finding.subjectId }, factType: `research.${finding.bucket}.${digest(finding.finding.trim().toLowerCase()).slice(0, 16)}`, value: finding.finding,
      effectiveAt: finding.publishedAt, observedAt, retrievedAt: finding.retrievedAt ?? research.generatedAt, expiresAt: finding.expiresAt,
      status, identityConfidence: player?.identity?.confidence === 'EXACT' ? 'EXACT' : player?.identity?.confidence === 'HIGH' ? 'HIGH' : finding.subjectType === 'EVENT' ? 'HIGH' : 'LOW',
      rawPayloadRef: `research-finding:${finding.id}`,
    };
    return observation;
  });
  // Preserve normalized structured availability separately from editorial prose. This gives
  // the resolver a stable player/status key, so contradictory direct status records can be
  // compared instead of being split into unrelated sentence-hash fact types.
  for (const player of slate.playerPool) {
    const availability = player.availability;
    if (!availability || availability.mappedBy === 'UNMAPPED' || availability.status === 'NOT_IN_PROVIDER_ROSTER') continue;
    const retrievedAt = availability.retrievedAt;
    const retrievedMs = Date.parse(retrievedAt);
    if (!Number.isFinite(retrievedMs)) continue;
    const ttlMs = availability.confirmed ? 30 * 60_000 : 10 * 60_000;
    const lockMs = Date.parse(slate.contest.lockTime);
    const expiresAt = new Date(Math.min(retrievedMs + ttlMs, Number.isFinite(lockMs) ? lockMs : retrievedMs + ttlMs)).toISOString();
    const status = availability.status === 'OUT' || availability.status === 'INACTIVE' || availability.status === 'CONFIRMED_STARTER' || availability.confirmed
      ? 'CONFIRMED' as const
      : availability.status === 'PROJECTED' || availability.status === 'ACTIVE' ? 'PROJECTED' as const : 'UNVERIFIED' as const;
    observations.push({
      id: deterministicUuid(`${runId}:availability:${player.playerId}:${retrievedAt}:${availability.status}`),
      tenantId, slateId: slate.slateId, sport: slate.sport, eventId: slate.event.eventId,
      source: availability.source, sourceRecordId: availability.providerPlayerId,
      subject: { kind: 'PLAYER', id: player.playerId }, factType: 'availability.status',
      value: { status: availability.status, roleStatus: availability.roleStatus, confirmed: availability.confirmed, note: availability.note },
      observedAt: retrievedAt, retrievedAt, expiresAt, status,
      identityConfidence: availability.mappedBy === 'PROVIDER_ID' ? 'EXACT' : player.identity?.confidence === 'EXACT' ? 'EXACT' : player.identity?.confidence === 'HIGH' ? 'HIGH' : 'LOW',
      rawPayloadRef: `availability:${availability.source}:${player.playerId}:${retrievedAt}`,
    });
  }
  if (observations.length) {
    const observationRows = observations.map((item) => ({
      id: item.id, tenant_id: tenantId, generation_run_id: runId, slate_id: item.slateId, sport: item.sport, event_id: item.eventId,
      source: item.source, source_record_id: item.sourceRecordId ?? null, source_url: item.sourceUrl ?? null,
      subject_kind: item.subject.kind, subject_id: item.subject.id, fact_type: item.factType, fact_value: item.value,
      effective_at: item.effectiveAt ?? null, observed_at: item.observedAt, retrieved_at: item.retrievedAt, expires_at: item.expiresAt ?? null,
      observation_status: item.status, identity_confidence: item.identityConfidence, raw_payload_ref: item.rawPayloadRef,
      raw_payload: { normalized_claim: item.value }, content_sha256: digest(item),
    }));
    const inserted = await db.from('floyd_dfs_source_observations').upsert(observationRows, { onConflict: 'tenant_id,generation_run_id,content_sha256', ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    const facts = resolveObservations(observations, new Date(research.generatedAt));
    const factRows = facts.map((fact) => ({ tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, event_id: fact.eventId, subject_id: fact.subjectId, fact_type: fact.factType, fact_value: fact.value ?? null, resolution_state: fact.state, observation_ids: fact.observationIds, resolved_at: fact.resolvedAt, rule_version: fact.ruleVersion, rationale: fact.rationale, content_sha256: digest(fact) }));
    const resolved = await db.from('floyd_dfs_resolved_facts').upsert(factRows, { onConflict: 'tenant_id,generation_run_id,event_id,subject_id,fact_type,content_sha256', ignoreDuplicates: true });
    if (resolved.error) throw resolved.error;
  }

  const adjustmentByPlayer = new Map(adjustment.adjustments.map((item) => [item.playerId, item]));
  const numericAdjustments = projection.players.flatMap((player) => Object.entries(player.opportunityDelta).flatMap(([dimension, delta]) => {
    const before = player.baselineOpportunity[dimension]; const after = player.adjustedOpportunity[dimension];
    if (!Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(delta) || Math.abs(delta) < 1e-9) return [];
    const playerAdjustment = adjustmentByPlayer.get(player.playerId);
    const row = { tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, sport: slate.sport, player_id: player.playerId, dimension, before_value: before, delta_value: delta, after_value: after, unit: unitFor(dimension), evidence_ids: [...new Set((playerAdjustment?.adjustments ?? []).flatMap((item) => item.evidenceFindingIds ?? []))], model_version: projection.modelVersion, confidence: playerAdjustment?.roleCertainty ?? player.confidence };
    return [{ ...row, content_sha256: digest(row) }];
  }));
  if (numericAdjustments.length) {
    const saved = await db.from('floyd_dfs_quantitative_adjustments').upsert(numericAdjustments, { onConflict: 'tenant_id,generation_run_id,player_id,dimension,content_sha256', ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }

  const candidates = new Map(optimizer.candidates.map((candidate) => [candidate.id, candidate]));
  const traces = selection.selectedLineups.map((lineup) => {
    const candidate = candidates.get(lineup.candidateId);
    const row = { tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, lineup_candidate_key: lineup.candidateId, trace_payload: { lineup, candidate, objective: optimizer.objectiveProfile, searchCompleteness: optimizer.searchCompleteness, engineState: optimizer.engineState, researchFreshThrough: research.freshThrough, missingFacts: research.unknowns ?? [], projectionGaps: projection.gaps, sourceFindingIds: research.findings.filter((finding) => lineup.playerIds.includes(finding.subjectId)).map((finding) => finding.id) } };
    return { ...row, content_sha256: digest(row.trace_payload) };
  });
  if (traces.length) {
    const saved = await db.from('floyd_dfs_lineup_decision_traces').upsert(traces, { onConflict: 'tenant_id,generation_run_id,lineup_candidate_key,content_sha256', ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }

  const revisionResult = await db.from('floyd_dfs_run_trust').select('revision').eq('tenant_id', tenantId).eq('generation_run_id', runId).order('revision', { ascending: false }).limit(1).maybeSingle();
  if (revisionResult.error) throw revisionResult.error;
  const expired = research.findings.filter((finding) => finding.expiresAt && Date.parse(finding.expiresAt) <= Date.parse(research.generatedAt)).map((finding) => finding.id);
  const trust = buildRunTrust({ slate, research, projection, optimizer, selection, expiredFindingIds: expired });
  const trustSaved = await db.from('floyd_dfs_run_trust').insert({ tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, revision: Number(revisionResult.data?.revision ?? 0) + 1, trust_payload: trust });
  if (trustSaved.error) throw trustSaved.error;
}

function unitFor(dimension: string): string { return dimension === 'expectedMinutes' ? 'minutes/game' : dimension === 'expectedPA' ? 'plate appearances/game' : dimension.toLowerCase().includes('per') ? 'rate' : 'opportunities/game'; }
function digest(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function deterministicUuid(value: string): string { const hex = digest(value).slice(0, 32).split(''); hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); const id = hex.join(''); return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`; }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }
