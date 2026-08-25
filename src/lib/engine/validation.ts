import type { AdjustmentPackage, OptimizerPackage, ProjectionPackage, ResearchPackage, SelectionPackage, ValidatedSlate } from './contracts.js';

export class EngineContractError extends Error { constructor(stage: string, errors: string[]) { super(`${stage} contract validation failed: ${errors.join(' ')}`); this.name = 'EngineContractError'; } }

export function validateSlate(slate: ValidatedSlate): string[] {
  const errors: string[] = [];
  if (!slate.slateId || !slate.tenantId || !slate.requestId) errors.push('identity fields are required.');
  if (!slate.version || !slate.createdAt) errors.push('version and createdAt are required.');
  if (!slate.event.eventId || !slate.event.eventDate || !slate.contest.draftKingsContestId || !slate.contest.lockTime) errors.push('event and contest identity/lock fields are required.');
  if (!slate.salaryCap || slate.salaryCap <= 0) errors.push('salaryCap must be positive.');
  if (!Object.keys(slate.rosterRules.slots).length) errors.push('roster rules must contain slots.');
  if (!Object.keys(slate.scoringRules).length) errors.push('scoring rules are required.');
  if (!slate.playerPool.length) errors.push('player pool is required.');
  const ids = new Set<string>();
  for (const player of slate.playerPool) { if (ids.has(player.playerId)) errors.push(`duplicate playerId ${player.playerId}.`); ids.add(player.playerId); if (!player.playerName || !Number.isFinite(player.salary) || player.salary <= 0) errors.push(`player ${player.playerId} has invalid identity or salary.`); }
  if (slate.contest.maxEntriesAllowed !== undefined && slate.contest.userEntryCount > slate.contest.maxEntriesAllowed) errors.push('requested entries exceed the contest maximum.');
  return errors;
}

export function assertSlate(slate: ValidatedSlate): void { const errors = validateSlate(slate); if (errors.length) throw new EngineContractError('SLATE', errors); }
export function assertResearch(value: ResearchPackage): void { const errors = !value.slateId || !value.tenantId || !value.version || !Array.isArray(value.findings) ? ['identity, version, and findings are required.'] : []; if (!['COMPLETE', 'PARTIAL', 'BLOCKED'].includes(value.status)) errors.push('invalid status.'); if (errors.length) throw new EngineContractError('RESEARCH', errors); }
export function assertAdjustment(value: AdjustmentPackage, research: ResearchPackage): void { const findingIds = new Set(research.findings.map((finding) => finding.id)); const errors: string[] = []; for (const adjustment of value.adjustments) for (const item of adjustment.adjustments) for (const id of item.evidenceFindingIds ?? []) if (!findingIds.has(id)) errors.push(`adjustment ${adjustment.playerId} cites missing finding ${id}.`); if (errors.length) throw new EngineContractError('SPORT_ADJUSTMENT', errors); }
export function assertProjection(value: ProjectionPackage): void { const errors: string[] = []; for (const player of value.players) { if (!Object.keys(player.baselineOpportunity).length || !Object.keys(player.adjustedOpportunity).length) errors.push(`projection ${player.playerId} lacks explicit opportunity assumptions.`); if (!player.modelVersion) errors.push(`projection ${player.playerId} lacks modelVersion.`); } if (errors.length) throw new EngineContractError('PROJECTION', errors); }
export function assertOptimizer(value: OptimizerPackage, slate: ValidatedSlate): void { const errors: string[] = []; const ids = new Set(slate.playerPool.map((player) => player.playerId)); for (const candidate of value.candidates) { if (candidate.playerIds.some((id) => !ids.has(id))) errors.push(`candidate ${candidate.id} references a player outside the slate.`); if (candidate.salaryUsed > slate.salaryCap) errors.push(`candidate ${candidate.id} exceeds salary cap.`); } if (errors.length) throw new EngineContractError('OPTIMIZE', errors); }
export function assertSelection(value: SelectionPackage, optimizer: OptimizerPackage): void { const ids = new Set(optimizer.candidates.map((candidate) => candidate.id)); const errors = value.selectedLineups.filter((lineup) => !ids.has(lineup.candidateId)).map((lineup) => `selection references missing optimizer candidate ${lineup.candidateId}.`); if (errors.length) throw new EngineContractError('SELECTION', errors); }
