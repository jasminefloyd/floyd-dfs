import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, SelectedLineup, ValidatedSlate } from './contracts.js';
import { salaryForRosterSlot } from './validation.js';

export interface DecisionTraceInput {
  slate: ValidatedSlate;
  research: ResearchPackage;
  adjustment: AdjustmentPackage;
  projection: ProjectionPackage;
  optimizer: OptimizerPackage;
  selection: SelectedLineup;
  selectedRank: number;
  lineupId?: string;
}

/** A deterministic, per-lineup account of the exact inputs and effects behind a selection. */
export function buildLineupDecisionTrace(input: DecisionTraceInput): Record<string, unknown> {
  const { slate, research, adjustment, projection, optimizer, selection } = input;
  const candidate = optimizer.candidates.find((item) => item.id === selection.candidateId);
  if (!candidate) throw new Error(`Cannot persist decision trace: optimizer candidate ${selection.candidateId} is missing.`);
  const playerById = new Map(slate.playerPool.map((player) => [player.playerId, player]));
  const projectionById = new Map(projection.players.map((player) => [player.playerId, player]));
  const observationById = new Map((research.observations ?? []).map((observation) => [observation.id, observation]));
  const factIdsByFinding = new Map<string, string[]>();
  for (const fact of research.resolvedFacts ?? []) {
    for (const observationId of fact.supportingObservationIds ?? []) {
      const sourceId = observationById.get(observationId)?.sourceRecordId;
      if (sourceId) factIdsByFinding.set(sourceId, [...(factIdsByFinding.get(sourceId) ?? []), fact.id]);
    }
  }
  const appliedEffectsByPlayer = new Map<string, NonNullable<ProjectionPackage['effectOutcomes']>>();
  for (const effect of projection.effectOutcomes ?? []) {
    if (effect.state !== 'APPLIED') continue;
    appliedEffectsByPlayer.set(effect.playerId, [...(appliedEffectsByPlayer.get(effect.playerId) ?? []), effect]);
  }
  const selectedPlayers = selection.playerIds.map((playerId) => {
    const player = playerById.get(playerId);
    const playerProjection = projectionById.get(playerId);
    if (!player || !playerProjection) return { playerId, missingInput: true };
    const slot = Object.entries(selection.rosterSlots).find(([, assigned]) => assigned === playerId)?.[0];
    const effects = appliedEffectsByPlayer.get(playerId) ?? [];
    const acceptedFacts = (research.resolvedFacts ?? []).filter((fact) => fact.subjectId === playerId && fact.state === 'ACCEPTED');
    const supportedFindingIds = new Set(acceptedFacts.flatMap((fact) => (fact.supportingObservationIds ?? []).flatMap((id) => {
      const sourceRecordId = observationById.get(id)?.sourceRecordId;
      return sourceRecordId ? [sourceRecordId] : [];
    })));
    const evidence = research.findings.filter((finding) => finding.subjectId === playerId).map((finding) => ({
      findingId: finding.id,
      factIds: factIdsByFinding.get(finding.id) ?? [],
      source: finding.sourceName,
      url: finding.sourceUrl,
      publishedAt: finding.publishedAt,
      effectiveAt: finding.publishedAt,
      retrievedAt: finding.retrievedAt ?? research.generatedAt,
      expiresAt: finding.expiresAt,
      confidence: finding.confidence,
      acceptedAsSupport: supportedFindingIds.has(finding.id),
      claim: finding.finding,
    }));
    const contextualFacts = acceptedFacts.filter((fact) => !effects.some((effect) => effect.evidenceFindingIds.some((id) => (factIdsByFinding.get(id) ?? []).includes(fact.id))));
    const salary = slot ? salaryForRosterSlot(player, slot, slate.rosterRules.slots[slot.replace(/_\d+$/, '')]) : undefined;
    return {
      playerId,
      playerName: player.playerName,
      slot,
      team: player.team,
      opponent: player.opponent,
      gameId: player.gameId,
      salary: salary ?? null,
      salaryValuePerThousand: salary && playerProjection.simulatedFantasyPointSamples?.length ? Number((mean(playerProjection.simulatedFantasyPointSamples) / (salary / 1000)).toFixed(3)) : null,
      projectedPoints: { mean: playerProjection.simulatedFantasyPointSamples?.length ? mean(playerProjection.simulatedFantasyPointSamples) : null, p20: playerProjection.projectedOutcomes.floorP20, p50: playerProjection.projectedOutcomes.medianP50, p90: playerProjection.projectedOutcomes.ceilingP90 },
      roleAndOpportunity: { position: player.position, availability: player.availability ?? null, baseline: playerProjection.baselineOpportunity, final: playerProjection.adjustedOpportunity },
      appliedEffects: effects.map((effect) => ({ effectId: `${playerId}:${effect.dimension ?? 'context'}:${projection.modelVersion}`, dimension: effect.dimension, requested: effect.requestedEffect, accepted: effect.acceptedEffect, finalValue: effect.finalValue, state: effect.state, evidenceFindingIds: effect.evidenceFindingIds, reason: effect.reason })),
      contextualFacts: contextualFacts.map((fact) => ({ factId: fact.id, factType: fact.factType, value: fact.value, explanation: 'Verified context; no validated numerical adjustment was applied.' })),
      evidence,
      uncertainty: playerProjection.uncertaintyFactors,
      modelVersion: playerProjection.modelVersion,
    };
  });
  const alternatives = optimizer.candidates.filter((item) => item.id !== candidate.id).slice(0, 3).map((item, index) => ({
    candidateId: item.id,
    evaluatedRank: optimizer.candidates.findIndex((value) => value.id === item.id) + 1,
    expectedPoints: item.expectedPoints ?? null,
    median: item.median,
    salaryUsed: item.salaryUsed,
    sharedPlayers: item.playerIds.filter((id) => candidate.playerIds.includes(id)),
    objectiveScore: item.heuristicTournamentScore ?? null,
    tradeoff: `${item.playerIds.filter((id) => !candidate.playerIds.includes(id)).length} player change(s); ${optimizer.searchCompleteness === 'BOUNDED' ? 'best evaluated alternative' : 'next ranked legal alternative'}.`,
    alternativeIndex: index + 1,
  }));
  const firstLock = slate.games?.map((game) => game.lockTime ?? game.scheduledStart).filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return {
    traceVersion: 'fds.lineup-decision.v1',
    lineupId: input.lineupId ?? null,
    lineupCandidateId: candidate.id,
    sourceRevision: 0,
    selectedRank: input.selectedRank,
    generatedAt: optimizer.generatedAt,
    slate: { id: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, contestId: slate.contest.draftKingsContestId, format: slate.contest.format, lockTime: slate.contest.lockTime, rosterRules: slate.rosterRules, scoringRules: slate.scoringRules },
    objective: { name: optimizer.objectiveProfile.name, terms: optimizer.objectiveProfile, score: candidate.heuristicTournamentScore ?? null },
    search: { completeness: optimizer.searchCompleteness === 'BOUNDED' ? 'GAP_BOUNDED' : 'EXHAUSTIVE', algorithm: optimizer.searchDiagnostics?.algorithm ?? 'UNKNOWN', terminationReason: optimizer.searchDiagnostics?.terminationReason ?? 'UNKNOWN', diagnostics: optimizer.searchDiagnostics ?? null, boundedDisclaimer: optimizer.searchCompleteness === 'BOUNDED' ? 'These are the best evaluated lineups, not a proven global optimum.' : null },
    portfolioConstraints: optimizer.portfolioConstraints ?? null,
    roster: { slots: selection.rosterSlots, playerIds: selection.playerIds, salaryUsed: selection.salaryUsed, salaryRemaining: selection.salaryRemaining, salaryCap: slate.salaryCap, mean: candidate.expectedPoints ?? null, p20: candidate.floor ?? null, p50: candidate.median, p90: candidate.ceiling },
    playerReasons: selectedPlayers,
    alternatives,
    risks: [...new Set([...candidate.riskFlags, ...selection.watchItems])],
    missingInputs: [...projection.gaps.map((gap) => gap.reason), ...(research.unknowns ?? []).map((unknown) => unknown.question)],
    whatWouldChangeThisLineup: [
      ...selection.watchItems,
      ...selectedPlayers.flatMap((item) => {
        if (!item || typeof item !== 'object' || !('playerId' in item)) return [];
        const player = item as { playerId: string; playerName?: string; roleAndOpportunity?: { availability?: { status?: string; roleStatus?: string; note?: string } } };
        const availability = player.roleAndOpportunity?.availability;
        const status = availability?.status ? `current status is ${availability.status}` : 'availability is unknown';
        const role = availability?.roleStatus ? `role is ${availability.roleStatus}` : 'role can change';
        const triggers = [`Recheck ${player.playerName ?? player.playerId} if ${status} changes, ${role} changes, or a provider reports conflicting availability.`];
        if (slate.sport === 'MLB') triggers.push(`Recheck ${player.playerName ?? player.playerId} if the confirmed batting order, starting pitcher, or game weather changes.`);
        if (availability?.note) triggers.push(`Availability note for ${player.playerName ?? player.playerId}: ${availability.note}`);
        return triggers;
      }),
      'Recheck selected players for scratches, new minutes/workload restrictions, and postponed or rescheduled games before making a lineup change.',
      ...(firstLock ? [`Recheck before next relevant game lock at ${firstLock}.`] : ['Game-level lock time is unavailable; recheck provider status before any change.']),
    ],
    dataTimestamps: { slateRetrievedAt: slate.receivedAt, researchGeneratedAt: research.generatedAt, projectionsGeneratedAt: projection.generatedAt, adjustmentsGeneratedAt: adjustment.generatedAt, optimizerGeneratedAt: optimizer.generatedAt, firstRelevantLock: firstLock ?? null },
    unsupportedOrUnusedContext: research.resolvedFacts?.filter((fact) => fact.state !== 'ACCEPTED').map((fact) => `${fact.factType}: ${fact.state} (${fact.rationale})`) ?? [],
  };
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
