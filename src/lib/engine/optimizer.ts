import type {
  LineupCandidate,
  ObjectiveProfile,
  OptimizerPackage,
  ProjectionPackage,
  ValidatedSlate,
} from './contracts.js';

const DEFAULT_PROFILE: ObjectiveProfile = { name: 'balanced-tournament', medianWeight: 0.35, ceilingWeight: 0.35, leverageWeight: 0.15, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const SMALL_FIELD_PROFILE: ObjectiveProfile = { name: 'small-field', medianWeight: 0.45, ceilingWeight: 0.3, leverageWeight: 0.1, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const LARGE_FIELD_PROFILE: ObjectiveProfile = { name: 'large-field-gpp', medianWeight: 0.2, ceilingWeight: 0.4, leverageWeight: 0.2, duplicationPenalty: 0.15, correlationWeight: 0.05 };

export interface OptimizerInput {
  validatedSlate: ValidatedSlate;
  projectionPackage: ProjectionPackage;
}

export interface OptimizerOptions {
  maxCandidates?: number;
  objectiveProfile?: ObjectiveProfile;
}

export function optimizeLineups(input: OptimizerInput, options: OptimizerOptions = {}, now = new Date()): OptimizerPackage {
  const profile = options.objectiveProfile ?? objectiveProfileForContest(input.validatedSlate.contest.contestSize);
  const maxCandidates = options.maxCandidates ?? 500;
  const warnings = [...input.validatedSlate.validation.warnings];
  if (input.validatedSlate.contest.contestSize === undefined) warnings.push('contest.contestSize is unavailable; optimizer used the configured fallback objective profile.');
  if (input.projectionPackage.status === 'BLOCKED') return blocked(input.validatedSlate, profile, now, ['ProjectionPackage is BLOCKED; no legal lineup can be evaluated.']);

  const projectionByPlayer = new Map(input.projectionPackage.players.map((player) => [player.playerId, player]));
  const slots = slotOrder(input.validatedSlate.rosterRules.slots);
  if (!slots.length) return blocked(input.validatedSlate, profile, now, ['No roster slots are available.']);
  const generated: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }> = [];
  enumerate(slots, 0, {}, 0, new Set(), input, generated, maxCandidates * 4);
  if (!generated.length) return blocked(input.validatedSlate, profile, now, ['No legal lineups satisfy roster eligibility, salary cap, and team constraints.']);

  const ranked = rankCandidates(generated.map((lineup) => scoreCandidate(lineup, input, projectionByPlayer, profile)), maxCandidates);
  assignTypes(ranked);
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: ranked, warnings, gaps: input.projectionPackage.gaps.map((gap) => gap.reason), status: input.projectionPackage.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE' };
}

function objectiveProfileForContest(contestSize?: number): ObjectiveProfile {
  if (contestSize === undefined) return DEFAULT_PROFILE;
  if (contestSize < 1_000) return SMALL_FIELD_PROFILE;
  if (contestSize >= 10_000) return LARGE_FIELD_PROFILE;
  return DEFAULT_PROFILE;
}

function slotOrder(slots: Record<string, { count: number }>): string[] {
  return Object.entries(slots).flatMap(([slot, rule]) => Array.from({ length: rule.count }, (_, index) => rule.count > 1 ? `${slot}_${index + 1}` : slot));
}

function enumerate(slots: string[], index: number, rosterSlots: Record<string, string>, salaryUsed: number, used: Set<string>, input: OptimizerInput, output: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }>, limit: number): void {
  if (output.length >= limit) return;
  if (index === slots.length) {
    const teams = new Set(Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)?.team).filter(Boolean));
    const minimumTeams = input.validatedSlate.rosterRules.teamConstraints?.minimumTeams;
    if (minimumTeams && teams.size < minimumTeams) return;
    output.push({ rosterSlots: { ...rosterSlots }, salaryUsed });
    return;
  }
  const slot = slots[index];
  const ruleSlot = baseSlot(slot);
  for (const player of input.validatedSlate.playerPool) {
    if (used.has(player.playerId) && input.validatedSlate.rosterRules.uniquePlayersRequired) continue;
    if (!player.eligibility[ruleSlot]) continue;
    const salary = salaryForSlot(player, ruleSlot, input.validatedSlate.rosterRules.slots[ruleSlot]);
    if (salary === undefined || salaryUsed + salary > input.validatedSlate.salaryCap) continue;
    const maxPerTeam = input.validatedSlate.rosterRules.teamConstraints?.maximumPlayersPerTeam;
    if (maxPerTeam && player.team && Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((candidate) => candidate.playerId === id)?.team).filter((team) => team === player.team).length >= maxPerTeam) continue;
    rosterSlots[slot] = player.playerId;
    used.add(player.playerId);
    enumerate(slots, index + 1, rosterSlots, salaryUsed + salary, used, input, output, limit);
    delete rosterSlots[slot];
    used.delete(player.playerId);
  }
}

function salaryForSlot(player: { salary: number; captainSalary?: number; utilitySalary?: number }, slot: string, rule?: { salaryMultiplier?: number }): number | undefined {
  if (slot.toUpperCase().includes('CPT') || slot.toUpperCase().includes('CAPTAIN')) return player.captainSalary ?? (rule?.salaryMultiplier ? player.salary * rule.salaryMultiplier : undefined);
  if (slot.toUpperCase() === 'UTIL' && player.utilitySalary !== undefined) return player.utilitySalary;
  return player.salary * (rule?.salaryMultiplier ?? 1);
}

function baseSlot(slot: string): string { return slot.replace(/_\d+$/, ''); }

function scoreCandidate(lineup: { rosterSlots: Record<string, string>; salaryUsed: number }, input: OptimizerInput, projectionByPlayer: Map<string, OptimizerInput['projectionPackage']['players'][number]>, profile: ObjectiveProfile): LineupCandidate {
  const players = Object.values(lineup.rosterSlots).map((id) => projectionByPlayer.get(id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const projected = (key: 'floorP20' | 'medianP50' | 'ceilingP90') => Object.entries(lineup.rosterSlots).reduce((sum, [slot, id]) => sum + scaledProjection(projectionByPlayer.get(id)?.projectedOutcomes[key] ?? 0, input.validatedSlate.rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier), 0);
  const floor = projected('floorP20');
  const median = projected('medianP50');
  const ceiling = projected('ceilingP90');
  const playerRows = Object.values(lineup.rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const teamCounts = new Map<string, number>();
  for (const player of playerRows) if (player.team) teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
  const correlationScore = [...teamCounts.values()].reduce((score, count) => score + Math.max(0, count - 1) * 0.05, 0);
  const ownershipEstimate = players.reduce((sum, player) => sum + 1 / Math.max(1, player.salaryEfficiency.medianPer1k), 0) / Math.max(1, players.length);
  const leverageScore = Math.max(0, 1 - ownershipEstimate);
  const objective = median * profile.medianWeight + ceiling * profile.ceilingWeight + leverageScore * profile.leverageWeight + correlationScore * profile.correlationWeight;
  const id = stableId(JSON.stringify(lineup.rosterSlots));
  return { id, playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed, salaryRemaining: input.validatedSlate.salaryCap - lineup.salaryUsed, floor, median, ceiling, correlationScore, optimalLineupFrequency: objective, topOnePercentFrequency: objective, ownershipEstimate, leverageScore, duplicationRisk: ownershipEstimate > 0.5 ? 'HIGH' : ownershipEstimate > 0.25 ? 'MEDIUM' : 'LOW', estimatedDuplicates: Math.round(ownershipEstimate * 100), medianRank: 0, ceilingRank: 0, tournamentRank: 0, candidateTypes: [], gameScriptCluster: teamCounts.size > 1 ? 'MULTI_TEAM' : 'SINGLE_TEAM_OR_UNKNOWN', strategicSimilarity: 0, riskFlags: players.flatMap((player) => player.uncertaintyFactors) };
}

function scaledProjection(value: number, multiplier?: number): number { return value * (multiplier ?? 1); }
function rankCandidates(candidates: LineupCandidate[], maxCandidates: number): LineupCandidate[] { const median = [...candidates].sort((a, b) => b.median - a.median); const ceiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling); const tournament = [...candidates].sort((a, b) => b.optimalLineupFrequency - a.optimalLineupFrequency); return candidates.sort((a, b) => b.optimalLineupFrequency - a.optimalLineupFrequency).slice(0, maxCandidates).map((candidate) => ({ ...candidate, medianRank: median.findIndex((item) => item.id === candidate.id) + 1, ceilingRank: ceiling.findIndex((item) => item.id === candidate.id) + 1, tournamentRank: tournament.findIndex((item) => item.id === candidate.id) + 1 })); }
function assignTypes(candidates: LineupCandidate[]): void { if (!candidates.length) return; const highestMedian = [...candidates].sort((a, b) => b.median - a.median)[0]; const highestCeiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling)[0]; const leverage = [...candidates].sort((a, b) => b.leverageScore - a.leverageScore)[0]; const lowDup = [...candidates].sort((a, b) => a.estimatedDuplicates - b.estimatedDuplicates)[0]; for (const candidate of candidates) { if (candidate.id === highestMedian.id) candidate.candidateTypes.push('HIGHEST_MEDIAN'); if (candidate.id === highestCeiling.id) candidate.candidateTypes.push('HIGHEST_CEILING'); if (candidate.tournamentRank === 1) candidate.candidateTypes.push('BEST_TOURNAMENT_EV'); if (candidate.id === leverage.id) candidate.candidateTypes.push('LEVERAGE'); if (candidate.id === lowDup.id) candidate.candidateTypes.push('LOW_DUPLICATION'); } }
function blocked(slate: ValidatedSlate, profile: ObjectiveProfile, now: Date, gaps: string[]): OptimizerPackage { return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: [], warnings: [], gaps, status: 'BLOCKED' }; }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
