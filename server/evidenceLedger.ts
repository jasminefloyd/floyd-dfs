import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveObservations } from '../src/lib/engine/factResolution.js';
import { buildRunTrust } from '../src/lib/engine/runTrust.js';
import { buildLineupDecisionTrace } from '../src/lib/engine/decisionTrace.js';
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
    // Persist the exact pre-lock projection inputs, outcomes, and model version used for
    // selection. This is the immutable forecast record required for later calibration.
    { snapshot_type: 'PRE_LOCK_PROJECTION_PACKAGE', source: 'ENGINE', payload: projection, source_retrieved_at: projection.generatedAt },
    // One content-addressed artifact captures the exact contest slate, joined provider data,
    // research evidence, adjustments, forecasts, selection and versions needed to reproduce a run.
    { snapshot_type: 'COMPLETE_RUN_EVIDENCE', source: 'ENGINE', payload: { snapshotVersion: 'complete-run-evidence.v1', capturedAt: new Date().toISOString(), timing: { generatedAt: projection.generatedAt, lockTime: slate.contest.lockTime, preLock: Date.parse(projection.generatedAt) < Date.parse(slate.contest.lockTime) }, slateId: slate.slateId, contestIdentity: { draftKingsContestId: slate.contest.draftKingsContestId, name: slate.contest.name, format: slate.contest.format, lockTime: slate.contest.lockTime, objective: slate.contest.objective, contestKind: slate.contest.contestKind, contestSize: slate.contest.contestSize, entryFee: slate.contest.entryFee, paidPositions: slate.contest.paidPositions, payoutStructure: slate.contest.payoutStructure }, rawSlate, enrichedSlate: slate, research, adjustment, projection, optimizer, selection, modelVersions: { research: research.version, adjustment: adjustment.version, projection: projection.modelVersion, optimizer: optimizer.version, selection: selection.version }, sourceTimestamps: { slate: slate.receivedAt, research: research.generatedAt, projection: projection.generatedAt, weather: slate.playerPool.flatMap((player) => player.sportContext?.mlb?.gameWeather?.retrievedAt ? [player.sportContext.mlb.gameWeather.retrievedAt] : []), availability: slate.playerPool.flatMap((player) => player.availability?.retrievedAt ? [player.availability.retrievedAt] : []) } }, source_retrieved_at: projection.generatedAt },
  ].map((snapshot) => ({ tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, ...snapshot, content_sha256: digest(snapshot.payload) }));
  const snapshotResult = await db.from('floyd_dfs_run_data_snapshots').upsert(snapshots, { onConflict: 'tenant_id,generation_run_id,snapshot_type,source,content_sha256', ignoreDuplicates: true });
  if (snapshotResult.error) throw snapshotResult.error;

  const legacyObservations = research.findings.map((finding): SourceObservation => {
    const player = slate.playerPool.find((candidate) => candidate.playerId === finding.subjectId);
    const direct = /directly fetched/i.test(finding.sourcePurpose ?? '');
    const assertion = finding.finding.toLowerCase();
    const status: SourceObservation['status'] = direct && finding.confidence === 'HIGH' && /confirmed as a starter|ruled out|inactive/.test(assertion) ? 'CONFIRMED' : finding.publishedAt ? 'REPORTED' : 'UNVERIFIED';
    const observedAt = finding.publishedAt ?? finding.retrievedAt ?? research.generatedAt;
    const observation: SourceObservation = {
      id: deterministicUuid(`${runId}:${finding.id}:${finding.retrievedAt ?? research.generatedAt}`), tenantId, slateId: slate.slateId, sport: slate.sport, eventId: slate.event.eventId,
      gameId: player?.gameId ?? slate.event.eventId,
      source: finding.sourceName, sourceRecordId: finding.id, sourceUrl: finding.sourceUrl,
      // Until predicate/entity extraction is implemented, keep unrelated prose claims in
      // distinct fact groups. Grouping all NEWS or AVAILABILITY sentences by bucket would
      // incorrectly report ordinary multi-claim articles as contradictions.
      subject: { kind: finding.subjectType === 'LEAGUE' ? 'EVENT' : finding.subjectType ?? 'EVENT', id: finding.subjectId }, factType: `research.${finding.bucket}.${digest(finding.finding.trim().toLowerCase()).slice(0, 16)}`, value: { claim: finding.finding }, valueUnit: 'text',
      publishedAt: finding.publishedAt, effectiveAt: finding.publishedAt, observedAt, retrievedAt: finding.retrievedAt ?? research.generatedAt, expiresAt: finding.expiresAt,
      status, identityConfidence: player?.identity?.confidence === 'EXACT' ? 'EXACT' : player?.identity?.confidence === 'HIGH' ? 'HIGH' : finding.subjectType === 'EVENT' ? 'HIGH' : 'LOW',
      rawPayloadRef: `research-finding:${finding.id}`, duplicateClusterId: finding.sourceUrl ? digest(`${finding.sourceName}:${finding.sourceUrl}`).slice(0, 32) : undefined,
    };
    return observation;
  });
  const observations = research.observations?.length ? [...research.observations] : legacyObservations;
  // Preserve normalized structured availability separately from editorial prose. This gives
  // the resolver a stable player/status key, so contradictory direct status records can be
  // compared instead of being split into unrelated sentence-hash fact types.
  for (const player of research.observations?.length ? [] : slate.playerPool) {
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
      tenantId, slateId: slate.slateId, sport: slate.sport, eventId: slate.event.eventId, gameId: player.gameId ?? slate.event.eventId,
      source: availability.source, sourceRecordId: availability.providerPlayerId,
      subject: { kind: 'PLAYER', id: player.playerId }, factType: 'availability.status',
      value: { status: availability.status, roleStatus: availability.roleStatus, confirmed: availability.confirmed, note: availability.note }, valueUnit: 'status',
      observedAt: retrievedAt, retrievedAt, expiresAt, status,
      identityConfidence: availability.mappedBy === 'PROVIDER_ID' ? 'EXACT' : player.identity?.confidence === 'EXACT' ? 'EXACT' : player.identity?.confidence === 'HIGH' ? 'HIGH' : 'LOW',
      rawPayloadRef: `availability:${availability.source}:${player.playerId}:${retrievedAt}`,
    });
  }
  if (observations.length) {
    const observationRows = observations.map((item) => ({
      id: item.id, tenant_id: tenantId, generation_run_id: runId, slate_id: item.slateId, sport: item.sport, event_id: item.eventId, game_id: item.gameId ?? null,
      source: item.source, source_record_id: item.sourceRecordId ?? null, source_url: item.sourceUrl ?? null,
      subject_kind: item.subject.kind, subject_id: item.subject.id, fact_type: item.factType, fact_value: item.value, value_unit: item.valueUnit ?? null,
      published_at: item.publishedAt ?? null, duplicate_cluster_id: item.duplicateClusterId ?? null,
      effective_at: item.effectiveAt ?? null, observed_at: item.observedAt, retrieved_at: item.retrievedAt, expires_at: item.expiresAt ?? null,
      observation_status: item.status, identity_confidence: item.identityConfidence, raw_payload_ref: item.rawPayloadRef,
      raw_payload: { normalized_claim: item.value, observed_time_basis: item.observedTimeBasis ?? 'SOURCE_TIMESTAMP', effective_at: item.effectiveAt ?? null }, content_sha256: digest(item),
    }));
    const inserted = await db.from('floyd_dfs_source_observations').upsert(observationRows, { onConflict: 'tenant_id,generation_run_id,content_sha256', ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    const facts = research.resolvedFacts?.length ? research.resolvedFacts : resolveObservations(observations, new Date(research.generatedAt));
    const factRows = facts.map((fact) => ({ tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, event_id: fact.eventId, subject_id: fact.subjectId, fact_type: fact.factType, fact_value: fact.value ?? null, resolution_state: fact.state, observation_ids: fact.observationIds, supporting_observation_ids: fact.supportingObservationIds ?? [], rejected_observation_ids: fact.rejectedObservationIds ?? [], canonical_fact_key: fact.canonicalFactKey ?? null, decision_at: fact.decisionAt ?? fact.resolvedAt, resolved_at: fact.resolvedAt, rule_version: fact.ruleVersion, rationale: fact.rationale, content_sha256: digest(fact) }));
    const resolved = await db.from('floyd_dfs_resolved_facts').upsert(factRows, { onConflict: 'tenant_id,generation_run_id,event_id,subject_id,fact_type,content_sha256', ignoreDuplicates: true });
    if (resolved.error) throw resolved.error;
  }

  const adjustmentByPlayer = new Map(adjustment.adjustments.map((item) => [item.playerId, item]));
  const factsByEvidenceId = new Map<string, string[]>();
  for (const fact of research.resolvedFacts ?? []) for (const observationId of fact.supportingObservationIds ?? []) {
    const findingId = research.observations?.find((observation) => observation.id === observationId)?.sourceRecordId;
    if (findingId) factsByEvidenceId.set(findingId, [...(factsByEvidenceId.get(findingId) ?? []), fact.id]);
  }
  const numericAdjustments = (projection.effectOutcomes ?? []).flatMap((effect) => {
    if (effect.state !== 'APPLIED' || !effect.dimension || !Number.isFinite(effect.finalValue)) return [];
    const projectionPlayer = projection.players.find((player) => player.playerId === effect.playerId);
    const playerAdjustment = adjustmentByPlayer.get(effect.playerId);
    const playerData = slate.playerPool.find((item) => item.playerId === effect.playerId);
    const before = projectionPlayer?.baselineOpportunity[effect.dimension];
    const after = projectionPlayer?.adjustedOpportunity[effect.dimension];
    if (!Number.isFinite(before) || !Number.isFinite(after)) return [];
    const delta = after! - before!;
    const evidenceIds = [...new Set(effect.evidenceFindingIds)];
    const factIds = [...new Set(evidenceIds.flatMap((id) => factsByEvidenceId.get(id) ?? []))];
    const row = { tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, sport: slate.sport, player_id: effect.playerId, game_id: playerData?.gameId ?? null, dimension: effect.dimension, before_value: before, delta_value: delta, after_value: after, operation: 'MULTIPLY', amount_value: effect.acceptedEffect, final_value: after, fact_ids: factIds, cap_applied: effect.capApplied === undefined ? null : { maxRelativeFraction: effect.capApplied, requestedEffect: effect.requestedEffect, acceptedEffect: effect.acceptedEffect }, outcome: 'APPLIED', outcome_reason: effect.reason, unit: effect.unit ?? unitFor(effect.dimension), evidence_ids: evidenceIds, model_version: projection.modelVersion, confidence: playerAdjustment?.roleCertainty ?? projectionPlayer?.confidence ?? 'LOW' };
    return [{ ...row, content_sha256: digest(row) }];
  });
  if (numericAdjustments.length) {
    const saved = await db.from('floyd_dfs_quantitative_adjustments').upsert(numericAdjustments, { onConflict: 'tenant_id,generation_run_id,player_id,dimension,content_sha256', ignoreDuplicates: true });
    if (saved.error) throw saved.error;
  }

  const traces = selection.selectedLineups.map((lineup, index) => {
    const tracePayload = buildLineupDecisionTrace({ slate, research, adjustment, projection, optimizer, selection: lineup, selectedRank: index + 1 });
    const row = { tenant_id: tenantId, generation_run_id: runId, slate_id: slate.slateId, lineup_candidate_key: lineup.candidateId, trace_payload: tracePayload };
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
