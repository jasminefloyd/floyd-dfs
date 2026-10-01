import { ENGINE_CONTRACT_VERSION } from './contracts.js';
import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, SelectionPackage, ValidatedSlate } from './contracts.js';

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
  if (slate.contractVersion && slate.contractVersion !== ENGINE_CONTRACT_VERSION) errors.push(`unsupported slate contract version ${slate.contractVersion}; expected ${ENGINE_CONTRACT_VERSION}.`);
  if (slate.runMode === 'LIVE' && !slate.liveGameState) errors.push('LIVE runs require a structured liveGameState artifact; pre-lock data cannot be extrapolated as live state.');
  const ids = new Set<string>();
  for (const [key, rule] of Object.entries(slate.scoringRules)) if (!Number.isFinite(rule.value)) errors.push(`scoring rule ${key} has a non-finite value.`);
  for (const player of slate.playerPool) { if (ids.has(player.playerId)) errors.push(`duplicate playerId ${player.playerId}.`); ids.add(player.playerId); if (!player.playerName || !Number.isFinite(player.salary) || player.salary <= 0) errors.push(`player ${player.playerId} has invalid identity or salary.`); }
  if (slate.contest.maxEntriesAllowed !== undefined && slate.contest.userEntryCount > slate.contest.maxEntriesAllowed) errors.push('requested entries exceed the contest maximum.');
  return errors;
}

export function assertSupportedContractVersion(value: { contractVersion?: string }, stage: string): void {
  if (value.contractVersion && value.contractVersion !== ENGINE_CONTRACT_VERSION) throw new EngineContractError(stage, [`unsupported contract version ${value.contractVersion}; expected ${ENGINE_CONTRACT_VERSION}.`]);
}

export function assertSlate(slate: ValidatedSlate): void {
  const errors = validateSlate(slate);
  if (slate.validation.status === 'BLOCKED') errors.push(...slate.validation.errors);
  if (errors.length) throw new EngineContractError('SLATE', [...new Set(errors)]);
}
export function assertResearch(value: ResearchPackage): void { const errors = !value.slateId || !value.tenantId || !value.version || !Array.isArray(value.findings) ? ['identity, version, and findings are required.'] : []; if (!['COMPLETE', 'PARTIAL', 'BLOCKED'].includes(value.status)) errors.push('invalid status.'); if (errors.length) throw new EngineContractError('RESEARCH', errors); }
export function assertAdjustment(value: AdjustmentPackage, research: ResearchPackage): void { const findingIds = new Set(research.findings.map((finding) => finding.id)); const errors: string[] = []; for (const adjustment of value.adjustments) for (const item of adjustment.adjustments) for (const id of item.evidenceFindingIds ?? []) if (!findingIds.has(id)) errors.push(`adjustment ${adjustment.playerId} cites missing finding ${id}.`); if (errors.length) throw new EngineContractError('SPORT_ADJUSTMENT', errors); }
export function assertProjection(value: ProjectionPackage): void { const errors: string[] = []; for (const player of value.players) { if (!Object.keys(player.baselineOpportunity).length || !Object.keys(player.adjustedOpportunity).length) errors.push(`projection ${player.playerId} lacks explicit opportunity assumptions.`); if (!player.modelVersion) errors.push(`projection ${player.playerId} lacks modelVersion.`); if (player.modelPath === 'SPORT_STRUCTURED' && !player.distribution) errors.push(`projection ${player.playerId} lacks distribution provenance.`); if (player.simulatedFantasyPointSamples?.some((sample) => !Number.isFinite(sample))) errors.push(`projection ${player.playerId} contains a non-finite simulation sample.`); if (player.projectedOutcomes.floorP20 > player.projectedOutcomes.medianP50 || player.projectedOutcomes.medianP50 > player.projectedOutcomes.ceilingP90) errors.push(`projection ${player.playerId} has unordered outcome quantiles.`); } if (errors.length) throw new EngineContractError('PROJECTION', errors); }
export function assertContestMetrics(value: OptimizerPackage): void { const errors: string[] = []; for (const candidate of value.candidates) { for (const [name, metric] of [['winFrequency', candidate.winFrequency], ['topOnePercentFrequency', candidate.topOnePercentFrequency], ['cashFrequency', candidate.cashFrequency]] as const) if (metric !== undefined && (!Number.isFinite(metric) || metric < 0 || metric > 1)) errors.push(`candidate ${candidate.id} has invalid ${name}.`); if (candidate.expectedDuplicates !== undefined && (!Number.isFinite(candidate.expectedDuplicates) || candidate.expectedDuplicates < 0)) errors.push(`candidate ${candidate.id} has invalid expected duplicate count.`); if (candidate.contestMetricProvenance === 'JOINT_FIELD_SIMULATION' && candidate.simulatedScoreSamples?.some((sample) => !Number.isFinite(sample))) errors.push(`candidate ${candidate.id} has a non-finite joint score sample.`); } if (errors.length) throw new EngineContractError('OPTIMIZE', errors); }
export function assertOptimizer(value: OptimizerPackage, slate: ValidatedSlate): void { const errors: string[] = []; for (const candidate of value.candidates) errors.push(...validateLineupCandidate(candidate, slate)); if (value.optimalityGap !== undefined && (!Number.isFinite(value.optimalityGap) || value.optimalityGap < 0 || value.optimalityGap > 1)) errors.push('optimizer optimalityGap must be between 0 and 1.'); if (errors.length) throw new EngineContractError('OPTIMIZE', errors); }
export function validateLineupCandidate(candidate: Pick<OptimizerPackage['candidates'][number], 'playerIds' | 'rosterSlots' | 'salaryUsed'>, slate: ValidatedSlate): string[] {
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
  for (const [slot, playerId] of slots) {
    const player = players.get(playerId);
    if (!player) { errors.push(`lineup references player ${playerId} outside the slate.`); continue; }
    const eligibilitySlot = slot.replace(/_\d+$/, '');
    const rule = expectedSlots.get(eligibilitySlot);
    if (!player.eligibility[slot] && !player.eligibility[eligibilitySlot]) errors.push(`player ${playerId} is not eligible for roster slot ${slot}.`);
    if (player.availability?.status === 'OUT' || player.availability?.status === 'INACTIVE' || player.availability?.status === 'NOT_IN_CONFIRMED_LINEUP' || player.availability?.status === 'NOT_IN_PROVIDER_ROSTER' || /^(IL|IR| injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim())) errors.push(`player ${playerId} is unavailable for lineup selection.`);
    const isCaptain = /(^|_)(CPT|CAPTAIN|MVP)(_|$)/i.test(slot);
    const salary = isCaptain
      ? player.captainSalary ?? (rule?.salaryMultiplier ? Math.round(player.salary * rule.salaryMultiplier) : undefined)
      : eligibilitySlot === 'UTIL' ? player.utilitySalary ?? player.salary : player.salary;
    if (salary === undefined || !Number.isFinite(salary) || salary < 0) errors.push(`player ${playerId} has no valid salary for slot ${slot}.`);
    else recomputedSalary += salary;
    if (player.team) teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
  }
  if (!Number.isFinite(candidate.salaryUsed) || Math.abs(candidate.salaryUsed - recomputedSalary) > 0.01) errors.push(`reported salary ${candidate.salaryUsed} does not match recomputed salary ${recomputedSalary}.`);
  if (recomputedSalary > slate.salaryCap) errors.push(`recomputed salary ${recomputedSalary} exceeds salary cap ${slate.salaryCap}.`);
  const constraints = slate.rosterRules.teamConstraints;
  if (constraints?.minimumTeams !== undefined && teamCounts.size < constraints.minimumTeams) errors.push('lineup does not satisfy minimum team constraint.');
  if (constraints?.maximumPlayersPerTeam !== undefined && [...teamCounts.values()].some((count) => count > constraints.maximumPlayersPerTeam!)) errors.push('lineup exceeds maximum players per team constraint.');
  return errors.map((error) => `candidate ${candidate.playerIds.join(',')} ${error}`);
}
export function assertSelection(value: SelectionPackage, optimizer: OptimizerPackage): void { const ids = new Set(optimizer.candidates.map((candidate) => candidate.id)); const errors = value.selectedLineups.filter((lineup) => !ids.has(lineup.candidateId)).map((lineup) => `selection references missing optimizer candidate ${lineup.candidateId}.`); if (errors.length) throw new EngineContractError('SELECTION', errors); }
