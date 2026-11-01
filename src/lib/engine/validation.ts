import { ENGINE_CONTRACT_VERSION, isSupportedEngineContractVersion } from './contracts.js';
import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, SelectionPackage, SlatePlayer, ValidatedSlate } from './contracts.js';

export class EngineContractError extends Error { constructor(stage: string, errors: string[]) { super(`${stage} contract validation failed: ${errors.join(' ')}`); this.name = 'EngineContractError'; } }

export function validateSlate(slate: ValidatedSlate): string[] {
  const errors: string[] = [];
  if (!slate.slateId || !slate.tenantId || !slate.requestId) errors.push('identity fields are required.');
  if (!slate.version || !slate.createdAt) errors.push('version and createdAt are required.');
  if (!slate.event.eventId || !slate.event.eventDate || !slate.contest.draftKingsContestId || !slate.contest.lockTime) errors.push('event and contest identity/lock fields are required.');
  if (!slate.salaryCap || slate.salaryCap <= 0) errors.push('salaryCap must be positive.');
  if (!Object.keys(slate.rosterRules.slots).length) errors.push('roster rules must contain slots.');
  if (!Number.isInteger(slate.rosterRules.rosterSize) || slate.rosterRules.rosterSize <= 0) errors.push('rosterSize must be a positive integer.');
  if (Object.values(slate.rosterRules.slots).some((rule) => !Number.isInteger(rule.count) || rule.count <= 0)) errors.push('every roster slot must have a positive integer count.');
  if (Object.values(slate.rosterRules.slots).reduce((sum, rule) => sum + rule.count, 0) !== slate.rosterRules.rosterSize) errors.push('rosterSize must equal the sum of the exact roster slot counts.');
  for (const [slot, rule] of Object.entries(slate.rosterRules.slots)) for (const [label, multiplier] of [['salaryMultiplier', rule.salaryMultiplier], ['fantasyMultiplier', rule.fantasyMultiplier]] as const) if (multiplier !== undefined && (!Number.isFinite(multiplier) || multiplier <= 0)) errors.push(`${slot} ${label} must be finite and positive.`);
  if (!Object.keys(slate.scoringRules).length) errors.push('scoring rules are required.');
  if (!slate.playerPool.length) errors.push('player pool is required.');
  if (slate.contractVersion && !isSupportedEngineContractVersion(slate.contractVersion)) errors.push(`unsupported slate contract version ${slate.contractVersion}; expected ${ENGINE_CONTRACT_VERSION} or a supported legacy version.`);
  if (slate.runMode === 'LIVE' && !slate.liveGameState) errors.push('LIVE runs require a structured liveGameState artifact; pre-lock data cannot be extrapolated as live state.');
  const ids = new Set<string>();
  for (const [key, rule] of Object.entries(slate.scoringRules)) if (!Number.isFinite(rule.value)) errors.push(`scoring rule ${key} has a non-finite value.`);
  for (const player of slate.playerPool) { if (ids.has(player.playerId)) errors.push(`duplicate playerId ${player.playerId}.`); ids.add(player.playerId); if (!player.playerName || !Number.isFinite(player.salary) || player.salary <= 0) errors.push(`player ${player.playerId} has invalid identity or salary.`); }
  if (slate.contest.maxEntriesAllowed !== undefined && slate.contest.userEntryCount > slate.contest.maxEntriesAllowed) errors.push('requested entries exceed the contest maximum.');
  return errors;
}

export function assertSupportedContractVersion(value: { contractVersion?: string }, stage: string): void {
  if (value.contractVersion && !isSupportedEngineContractVersion(value.contractVersion)) throw new EngineContractError(stage, [`unsupported contract version ${value.contractVersion}; expected ${ENGINE_CONTRACT_VERSION} or a supported legacy version.`]);
}

export function assertSlate(slate: ValidatedSlate): void {
  const errors = validateSlate(slate);
  if (slate.validation.status === 'BLOCKED') errors.push(...slate.validation.errors);
  if (errors.length) throw new EngineContractError('SLATE', [...new Set(errors)]);
}

/** Reject an impossible player pool before running research/projection work. This answers only
 * whether one legal roster can be assembled; projections still determine the best roster later. */
export function assertRosterFeasible(slate: ValidatedSlate, nodeLimit = 250_000, minSalaryUsed = 0): void {
  const slots = Object.entries(slate.rosterRules.slots).flatMap(([slot, rule]) => Array.from({ length: rule.count }, (_, index) => `${slot}_${index + 1}`));
  const available = slate.playerPool.filter((player) => {
    const status = player.availability?.status;
    if (['OUT', 'INACTIVE', 'NOT_IN_CONFIRMED_LINEUP', 'NOT_IN_PROVIDER_ROSTER'].includes(String(status))) return false;
    if (/^(IL|IR|injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim())) return false;
    return slate.sport !== 'MLB' || status === 'CONFIRMED_STARTER';
  });
  const salaryCap = slate.salaryCap;
  const rules = slate.rosterRules.slots;
  const candidatesBySlot = new Map(slots.map((slot) => {
    const base = slot.replace(/_\d+$/, '');
    const rule = rules[base];
    const candidates = available.flatMap((player) => {
      if (!player.eligibility[slot] && !player.eligibility[base]) return [];
      const salary = salaryForRosterSlot(player, slot, rule);
      return salary !== undefined && Number.isFinite(salary) && salary >= 0 && salary <= salaryCap ? [{ player, salary }] : [];
    }).sort((a, b) => a.salary - b.salary || a.player.playerId.localeCompare(b.player.playerId));
    return [slot, candidates] as const;
  }));
  // Search the most constrained roster slots first. DraftKings player pools arrive in salary
  // order (most expensive first); walking that order made this feasibility-only check spend its
  // node budget proving that many expensive partial rosters exceeded the cap before reaching a
  // legal low-cost roster. Candidate order here affects only proof of existence, never projection
  // or optimizer ranking.
  const searchSlots = [...slots].sort((a, b) => (candidatesBySlot.get(a)!.length - candidatesBySlot.get(b)!.length) || a.localeCompare(b));
  const used = new Set<string>();
  const roster: Record<string, string> = {};
  const teamCounts = new Map<string, number>();
  let visited = 0;
  const visit = (index: number, salary: number): boolean => {
    visited += 1;
    if (visited > nodeLimit) return false;
    if (salary > salaryCap) return false;
    const remaining = searchSlots.slice(index);
    if (index === searchSlots.length) {
      if (salary < minSalaryUsed) return false;
      const playerIds = Object.values(roster);
      return validateLineupCandidate({ playerIds, rosterSlots: roster, salaryUsed: salary }, slate).length === 0;
    }
    let minimumRemainingSalary = 0;
    let maximumRemainingSalary = 0;
    for (const remainingSlot of remaining) {
      const options = candidatesBySlot.get(remainingSlot)!;
      const eligible = slate.rosterRules.uniquePlayersRequired ? options.filter(({ player }) => !used.has(player.playerId)) : options;
      if (!eligible.length) return false;
      minimumRemainingSalary += eligible[0]!.salary;
      maximumRemainingSalary += eligible[eligible.length - 1]!.salary;
    }
    if (salary + minimumRemainingSalary > salaryCap || salary + maximumRemainingSalary < minSalaryUsed) return false;

    const teamConstraints = slate.rosterRules.teamConstraints;
    const maximumPlayersPerTeam = teamConstraints?.maximumPlayersPerTeam;
    if (maximumPlayersPerTeam !== undefined && [...teamCounts.values()].some((count) => count > maximumPlayersPerTeam)) return false;
    const minimumTeams = teamConstraints?.minimumTeams;
    if (minimumTeams !== undefined) {
      const possibleNewTeams = new Set(remaining.flatMap((remainingSlot) => candidatesBySlot.get(remainingSlot)!
        .filter(({ player }) => !used.has(player.playerId) && player.team && !teamCounts.has(player.team))
        .map(({ player }) => player.team!)));
      if (teamCounts.size + possibleNewTeams.size < minimumTeams) return false;
    }

    const slot = searchSlots[index]!;
    const options = candidatesBySlot.get(slot)!;
    for (const { player, salary: slotSalary } of options) {
      if (slate.rosterRules.uniquePlayersRequired && used.has(player.playerId)) continue;
      if (salary + slotSalary > salaryCap) break;
      roster[slot] = player.playerId;
      used.add(player.playerId);
      if (player.team) teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
      if (visit(index + 1, salary + slotSalary)) return true;
      if (player.team) {
        const count = (teamCounts.get(player.team) ?? 1) - 1;
        if (count) teamCounts.set(player.team, count);
        else teamCounts.delete(player.team);
      }
      used.delete(player.playerId);
      delete roster[slot];
    }
    return false;
  };
  if (!visit(0, 0)) {
    const reason = visited > nodeLimit ? 'Feasibility search reached its bounded node limit before finding a legal lineup.' : 'No legal lineup can be assembled from the available slate player pool, roster eligibility, and salary cap.';
    throw new EngineContractError('SLATE', [reason]);
  }
}
export function assertResearch(value: ResearchPackage): void {
  const errors = !value.slateId || !value.tenantId || !value.version || !Array.isArray(value.findings) ? ['identity, version, and findings are required.'] : [];
  if (!['COMPLETE', 'PARTIAL', 'BLOCKED'].includes(value.status)) errors.push('invalid status.');
  const observationIds = new Set<string>();
  for (const observation of value.observations ?? []) {
    if (!observation.id || observationIds.has(observation.id)) errors.push(`observation ID ${observation.id || '(empty)'} is missing or duplicated.`);
    observationIds.add(observation.id);
    if (observation.tenantId !== value.tenantId || observation.slateId !== value.slateId) errors.push(`observation ${observation.id} crossed its research tenant/slate boundary.`);
    for (const [field, timestamp] of [['observedAt', observation.observedAt], ['retrievedAt', observation.retrievedAt], ['publishedAt', observation.publishedAt], ['effectiveAt', observation.effectiveAt], ['expiresAt', observation.expiresAt]] as const) if (timestamp && !Number.isFinite(Date.parse(timestamp))) errors.push(`observation ${observation.id} has invalid ${field}.`);
    if (observation.publishedAt && Date.parse(observation.publishedAt) > Date.parse(value.generatedAt)) errors.push(`observation ${observation.id} was published after the forecast cutoff.`);
    if (Date.parse(observation.retrievedAt) > Date.parse(value.generatedAt) + 5 * 60_000) errors.push(`observation ${observation.id} was retrieved after the forecast cutoff.`);
  }
  const factIds = new Set<string>();
  for (const fact of value.resolvedFacts ?? []) {
    if (!fact.id || factIds.has(fact.id)) errors.push(`resolved fact ID ${fact.id || '(empty)'} is missing or duplicated.`);
    factIds.add(fact.id);
    if (fact.tenantId !== value.tenantId || fact.slateId !== value.slateId) errors.push(`resolved fact ${fact.id} crossed its research tenant/slate boundary.`);
    if (fact.observationIds.some((id) => !observationIds.has(id))) errors.push(`resolved fact ${fact.id} references an observation outside this package.`);
    if ((fact.supportingObservationIds ?? []).some((id) => !fact.observationIds.includes(id))) errors.push(`resolved fact ${fact.id} has a supporting observation outside its observation set.`);
    if (fact.state === 'ACCEPTED' && !(fact.supportingObservationIds?.length)) errors.push(`accepted fact ${fact.id} has no supporting source.`);
    if (fact.state !== 'ACCEPTED' && fact.supportingObservationIds?.length) errors.push(`non-accepted fact ${fact.id} cannot expose supporting observations as accepted.`);
    if (Date.parse(fact.decisionAt ?? fact.resolvedAt) > Date.parse(value.generatedAt) + 5 * 60_000) errors.push(`resolved fact ${fact.id} was decided after the forecast cutoff.`);
  }
  if (errors.length) throw new EngineContractError('RESEARCH', errors);
}
export function assertAdjustment(value: AdjustmentPackage, research: ResearchPackage): void { const findingIds = new Set(research.findings.map((finding) => finding.id)); const errors: string[] = []; for (const adjustment of value.adjustments) for (const item of adjustment.adjustments) for (const id of item.evidenceFindingIds ?? []) if (!findingIds.has(id)) errors.push(`adjustment ${adjustment.playerId} cites missing finding ${id}.`); if (errors.length) throw new EngineContractError('SPORT_ADJUSTMENT', errors); }
export function assertProjection(value: ProjectionPackage): void { const errors: string[] = []; for (const player of value.players) { if (!Object.keys(player.baselineOpportunity).length || !Object.keys(player.adjustedOpportunity).length) errors.push(`projection ${player.playerId} lacks explicit opportunity assumptions.`); if (!player.modelVersion) errors.push(`projection ${player.playerId} lacks modelVersion.`); if (player.modelPath === 'SPORT_STRUCTURED' && !player.distribution) errors.push(`projection ${player.playerId} lacks distribution provenance.`); if (player.simulatedFantasyPointSamples?.some((sample) => !Number.isFinite(sample)) || player.baselineSimulatedFantasyPointSamples?.some((sample) => !Number.isFinite(sample))) errors.push(`projection ${player.playerId} contains a non-finite simulation sample.`); if (player.projectedOutcomes.floorP20 > player.projectedOutcomes.medianP50 || player.projectedOutcomes.medianP50 > player.projectedOutcomes.ceilingP90) errors.push(`projection ${player.playerId} has unordered outcome quantiles.`); if (player.simulatedFantasyPointSamples && player.simulatedFantasyPointSamples.length !== value.simulationRuns) errors.push(`projection ${player.playerId} sample count does not match simulationRuns.`); if (player.baselineSimulatedFantasyPointSamples && player.baselineSimulatedFantasyPointSamples.length !== value.simulationRuns) errors.push(`projection ${player.playerId} baseline comparison sample count does not match simulationRuns.`); } if (value.gameSimulation && (value.gameSimulation.trials !== value.simulationRuns || value.gameSimulation.gameScenarios.some((scenario) => !Number.isInteger(scenario.trial) || scenario.trial < 0 || scenario.trial >= value.simulationRuns || Object.values(scenario.teamScores).some((score) => !Number.isFinite(score) || score < 0)))) errors.push('game simulation scenario metadata contains invalid trial or score data.'); for (const effect of value.effectOutcomes ?? []) { if (![effect.requestedEffect, effect.acceptedEffect].every(Number.isFinite)) errors.push(`projection effect for ${effect.playerId}/${effect.adjustmentType} has a non-finite effect.`); if (effect.state === 'APPLIED' && (!effect.dimension || !Number.isFinite(effect.finalValue))) errors.push(`applied projection effect for ${effect.playerId}/${effect.adjustmentType} lacks a final dimension/value.`); if (effect.state !== 'APPLIED' && effect.acceptedEffect !== 0) errors.push(`non-applied projection effect for ${effect.playerId}/${effect.adjustmentType} must have zero accepted effect.`); } if (errors.length) throw new EngineContractError('PROJECTION', errors); }
export function assertContestMetrics(value: OptimizerPackage): void { const errors: string[] = []; for (const candidate of value.candidates) { for (const [name, metric] of [['winFrequency', candidate.winFrequency], ['fractionalWinCredit', candidate.fractionalWinCredit], ['topOnePercentFrequency', candidate.topOnePercentFrequency], ['cashFrequency', candidate.cashFrequency], ['positivePayoutFrequency', candidate.positivePayoutFrequency]] as const) if (metric !== undefined && (!Number.isFinite(metric) || metric < 0 || metric > 1)) errors.push(`candidate ${candidate.id} has invalid ${name}.`); for (const [name, metric] of [['expectedDuplicates', candidate.expectedDuplicates], ['expectedPayout', candidate.expectedPayout], ['expectedProfit', candidate.expectedProfit], ['roi', candidate.roi], ['winFrequencyStandardError', candidate.winFrequencyStandardError], ['cashFrequencyStandardError', candidate.cashFrequencyStandardError], ['expectedPayoutStandardError', candidate.expectedPayoutStandardError]] as const) if (metric !== undefined && (!Number.isFinite(metric) || (name.endsWith('StandardError') && metric < 0))) errors.push(`candidate ${candidate.id} has invalid ${name}.`); if (candidate.expectedDuplicates !== undefined && candidate.expectedDuplicates < 0) errors.push(`candidate ${candidate.id} has invalid expected duplicate count.`); if (candidate.contestMetricProvenance === 'JOINT_FIELD_SIMULATION' && candidate.simulatedScoreSamples?.some((sample) => !Number.isFinite(sample))) errors.push(`candidate ${candidate.id} has a non-finite joint score sample.`); } if (errors.length) throw new EngineContractError('OPTIMIZE', errors); }
export function assertOptimizer(value: OptimizerPackage, slate: ValidatedSlate): void { const errors: string[] = []; for (const candidate of value.candidates) errors.push(...validateLineupCandidate(candidate, slate)); if (value.optimalityGap !== undefined && (!Number.isFinite(value.optimalityGap) || value.optimalityGap < 0 || value.optimalityGap > 1)) errors.push('optimizer optimalityGap must be between 0 and 1.'); const search = value.searchDiagnostics; if (search && (![search.nodesVisited, search.elapsedMilliseconds, search.candidatesEvaluated, search.uniqueLineups].every((item) => Number.isFinite(item) && item >= 0) || (search.objectiveGap !== undefined && (!Number.isFinite(search.objectiveGap) || search.objectiveGap < 0)) || (search.validUpperBound !== undefined && !Number.isFinite(search.validUpperBound)))) errors.push('optimizer search diagnostics contain invalid counts or bounds.'); if (errors.length) throw new EngineContractError('OPTIMIZE', errors); }
export function validateLineupCandidate(candidate: Pick<OptimizerPackage['candidates'][number], 'playerIds' | 'rosterSlots' | 'salaryUsed'>, slate: ValidatedSlate, options: { lockedSlotAssignments?: Record<string, string> } = {}): string[] {
  const errors: string[] = [];
  const players = new Map(slate.playerPool.map((player) => [player.playerId, player]));
  const slots = Object.entries(candidate.rosterSlots);
  const expectedSize = Object.values(slate.rosterRules.slots).reduce((sum, slot) => sum + slot.count, 0);
  if (slots.length !== expectedSize) errors.push('lineup does not fill every required roster slot.');
  const assignedIds = slots.map(([, playerId]) => playerId);
  const candidateIds = [...candidate.playerIds].sort();
  if (JSON.stringify([...assignedIds].sort()) !== JSON.stringify(candidateIds)) errors.push('candidate player IDs do not match its roster assignments.');
  if (slate.rosterRules.uniquePlayersRequired && new Set(assignedIds).size !== assignedIds.length) errors.push('lineup rosters a duplicate player.');
  const expectedSlots = new Map(Object.entries(slate.rosterRules.slots));
  const observedCounts = new Map<string, number>();
  let recomputedSalary = 0;
  for (const [slot] of slots) {
    const base = slot.replace(/_\d+$/, '');
    const rule = expectedSlots.get(base);
    if (!rule) { errors.push(`lineup contains unknown roster slot ${slot}.`); continue; }
    observedCounts.set(base, (observedCounts.get(base) ?? 0) + 1);
  }
  for (const [slot, rule] of expectedSlots) if ((observedCounts.get(slot) ?? 0) !== rule.count) errors.push(`lineup has ${(observedCounts.get(slot) ?? 0)} ${slot} slot(s); expected ${rule.count}.`);
  const teamCounts = new Map<string, number>();
  const hitterCounts = new Map<string, number>();
  for (const [slot, playerId] of slots) {
    const player = players.get(playerId);
    if (!player) { errors.push(`lineup references player ${playerId} outside the slate.`); continue; }
    const eligibilitySlot = slot.replace(/_\d+$/, '');
    const rule = expectedSlots.get(eligibilitySlot);
    if (!player.eligibility[slot] && !player.eligibility[eligibilitySlot]) errors.push(`player ${playerId} is not eligible for roster slot ${slot}.`);
    const preservedLockedAssignment = options.lockedSlotAssignments?.[slot] === playerId;
    if (!preservedLockedAssignment && (player.availability?.status === 'OUT' || player.availability?.status === 'INACTIVE' || player.availability?.status === 'NOT_IN_CONFIRMED_LINEUP' || player.availability?.status === 'NOT_IN_PROVIDER_ROSTER' || /^(IL|IR| injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim()))) errors.push(`player ${playerId} is unavailable for lineup selection.`);
    const salary = salaryForRosterSlot(player, slot, rule);
    if (salary === undefined || !Number.isFinite(salary) || salary < 0) errors.push(`player ${playerId} has no valid salary for slot ${slot}.`);
    else recomputedSalary += salary;
    if (player.team) {
      teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
      if (slate.sport === 'MLB' && !['P', 'SP', 'RP'].includes(String(player.position ?? '').toUpperCase())) hitterCounts.set(player.team, (hitterCounts.get(player.team) ?? 0) + 1);
    }
  }
  if (!Number.isFinite(candidate.salaryUsed) || Math.abs(candidate.salaryUsed - recomputedSalary) > 0.01) errors.push(`reported salary ${candidate.salaryUsed} does not match recomputed salary ${recomputedSalary}.`);
  if (recomputedSalary > slate.salaryCap) errors.push(`recomputed salary ${recomputedSalary} exceeds salary cap ${slate.salaryCap}.`);
  const constraints = slate.rosterRules.teamConstraints;
  if (constraints?.minimumTeams !== undefined && teamCounts.size < constraints.minimumTeams) errors.push('lineup does not satisfy minimum team constraint.');
  if (constraints?.maximumPlayersPerTeam !== undefined && [...teamCounts.values()].some((count) => count > constraints.maximumPlayersPerTeam!)) errors.push('lineup exceeds maximum players per team constraint.');
  if (constraints?.maximumHittersPerTeam !== undefined && [...hitterCounts.values()].some((count) => count > constraints.maximumHittersPerTeam!)) errors.push('lineup exceeds maximum hitters per team constraint.');
  return errors.map((error) => `candidate ${candidate.playerIds.join(',')} ${error}`);
}

/** One salary interpretation shared by generation, validation, and diagnostic field sampling. */
export function salaryForRosterSlot(player: Pick<SlatePlayer, 'salary' | 'captainSalary' | 'utilitySalary'>, slot: string, rule?: { salaryMultiplier?: number }): number | undefined {
  const base = slot.replace(/_\d+$/, '').toUpperCase();
  if (/(^|_)(CPT|CAPTAIN|MVP)(_|$)/i.test(base)) return player.captainSalary ?? (rule?.salaryMultiplier ? Math.round(player.salary * rule.salaryMultiplier) : undefined);
  if (base === 'UTIL') return player.utilitySalary ?? player.salary;
  return rule?.salaryMultiplier ? Math.round(player.salary * rule.salaryMultiplier) : player.salary;
}
export function assertSelection(value: SelectionPackage, optimizer: OptimizerPackage, slate?: ValidatedSlate, lockedRosterSlots?: Record<string, string>): void {
  const ids = new Set(optimizer.candidates.map((candidate) => candidate.id));
  const errors = value.selectedLineups.flatMap((lineup) => {
    const issues = ids.has(lineup.candidateId) ? [] : [`selection references missing optimizer candidate ${lineup.candidateId}.`];
    if (slate) issues.push(...validateLineupCandidate({ playerIds: lineup.playerIds, rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed }, slate, { lockedSlotAssignments: lockedRosterSlots }).map((error) => `${lineup.candidateId}: ${error}`));
    return issues;
  });
  if (errors.length) throw new EngineContractError('SELECTION', errors);
}
