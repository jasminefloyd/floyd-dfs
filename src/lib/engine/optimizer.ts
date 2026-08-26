import type {
  LineupCandidate,
  ObjectiveProfile,
  OptimizerPackage,
  ProjectionPackage,
  SlatePlayer,
  Sport,
  ValidatedSlate,
} from './contracts.js';
import { rawCashLineProbability } from './cashLineCalibration.js';

const DEFAULT_PROFILE: ObjectiveProfile = { name: 'balanced-tournament', medianWeight: 0.35, ceilingWeight: 0.35, leverageWeight: 0.15, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const SMALL_FIELD_PROFILE: ObjectiveProfile = { name: 'small-field', medianWeight: 0.45, ceilingWeight: 0.3, leverageWeight: 0.1, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const LARGE_FIELD_PROFILE: ObjectiveProfile = { name: 'large-field-gpp', medianWeight: 0.2, ceilingWeight: 0.4, leverageWeight: 0.2, duplicationPenalty: 0.15, correlationWeight: 0.05 };
// "Max Fantasy Points" is a literal objective, not a blend -- none of the three contest-size
// profiles above are purely median-maximizing (they all weight ceiling/leverage too), so it
// gets its own profile rather than being approximated by one of the others.
const MAX_FPTS_PROFILE: ObjectiveProfile = { name: 'max-fantasy-points', medianWeight: 1, ceilingWeight: 0, leverageWeight: 0, duplicationPenalty: 0, correlationWeight: 0 };

// Maps the user-facing "Objective" selector to a real objective profile. The other three reuse
// the existing contest-size profiles rather than inventing new weights for them.
const OBJECTIVE_PROFILE_BY_LINEUP_MODE: Record<string, ObjectiveProfile> = {
  max_fpts: MAX_FPTS_PROFILE,
  tournament: LARGE_FIELD_PROFILE,
  balanced_ev: DEFAULT_PROFILE,
  safe: SMALL_FIELD_PROFILE,
};

export interface OptimizerInput {
  validatedSlate: ValidatedSlate;
  projectionPackage: ProjectionPackage;
}

export interface OptimizerOptions {
  maxCandidates?: number;
  objectiveProfile?: ObjectiveProfile;
  /** The UI's "Objective" selector value (max_fpts/tournament/balanced_ev/safe). Takes priority
   * over the automatic contest-size profile below when recognized; falls through otherwise. */
  lineupMode?: string;
  /** A hard salary-floor constraint (e.g. from the UI's "min salary used" setting) enforced
   * during enumeration -- never fabricated, only applied when the caller actually supplies it. */
  minSalaryUsed?: number;
}

export function optimizeLineups(input: OptimizerInput, options: OptimizerOptions = {}, now = new Date()): OptimizerPackage {
  const contest = input.validatedSlate.contest;
  const profile = options.objectiveProfile ?? (options.lineupMode ? OBJECTIVE_PROFILE_BY_LINEUP_MODE[options.lineupMode] : undefined) ?? objectiveProfileForContest({ contestSize: contest.contestSize, userEntryCount: contest.userEntryCount, maxEntriesAllowed: contest.maxEntriesAllowed, format: input.validatedSlate.contest.format });
  const maxCandidates = options.maxCandidates ?? 500;
  const minSalaryUsed = options.minSalaryUsed ?? 0;
  const warnings = [...input.validatedSlate.validation.warnings];
  if (contest.contestSize === undefined) warnings.push('contest.contestSize is unavailable; optimizer used the configured fallback objective profile.');
  if (input.projectionPackage.status === 'BLOCKED') return blocked(input.validatedSlate, profile, now, ['ProjectionPackage is BLOCKED; no legal lineup can be evaluated.']);

  const projectionByPlayer = new Map(input.projectionPackage.players.map((player) => [player.playerId, player]));
  const excludedPlayers = input.validatedSlate.playerPool.filter((player) => !projectionByPlayer.has(player.playerId));
  if (excludedPlayers.length) { const names = excludedPlayers.map((player) => player.playerName); warnings.push(`${excludedPlayers.length} player(s) have no projection and were excluded from lineup generation: ${names.slice(0, 10).join(', ')}${names.length > 10 ? `, and ${names.length - 10} more` : ''}.`); }
  const workingInput: OptimizerInput = { ...input, validatedSlate: { ...input.validatedSlate, playerPool: input.validatedSlate.playerPool.filter((player) => projectionByPlayer.has(player.playerId)) } };

  const slots = slotOrder(workingInput.validatedSlate.rosterRules.slots);
  if (!slots.length) return blocked(input.validatedSlate, profile, now, ['No roster slots are available.']);
  const limit = maxCandidates * 4;
  // Sorts by RAW projected value aligned with the actual objective being scored (median/ceiling,
  // weighted the same way scoreCandidate() weights them below) -- not by salary efficiency
  // (points per $1k). Efficiency systematically ranks cheap, decent-production bench players
  // above expensive stars (a $2k player scoring 8 pts has HIGHER points-per-dollar than an $11k
  // player scoring 32, purely because salary doesn't scale linearly with production), which
  // means the DFS search would try the cheap player's entire subtree of UTIL combinations first
  // and can exhaust the whole node budget before ever trying the actual highest-value player at
  // any slot, including CPT -- confirmed live: an efficiency-sorted search never generated a
  // single candidate with the slate's best player (4x the next-best player's median) as captain,
  // out of 500 ranked candidates. Sorting by the same value the objective actually rewards fixes
  // this at the source, for every objective profile including the pure-median "max fantasy
  // points" one.
  const searchValue = (player: SlatePlayer) => { const projection = projectionByPlayer.get(player.playerId); return projection ? projection.projectedOutcomes.medianP50 * profile.medianWeight + projection.projectedOutcomes.ceilingP90 * profile.ceilingWeight : 0; };
  const playersByValue = [...workingInput.validatedSlate.playerPool].sort((a, b) => searchValue(b) - searchValue(a));
  const minSalaryBySlot = minSalaryPerSlot(playersByValue, workingInput.validatedSlate.salaryCap, workingInput.validatedSlate.rosterRules.slots);
  const generated: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }> = [];
  enumerate(slots, 0, {}, 0, new Set(), workingInput, playersByValue, minSalaryBySlot, generated, limit, minSalaryUsed);
  if (!generated.length) return blocked(input.validatedSlate, profile, now, minSalaryUsed ? ['No legal lineups satisfy roster eligibility, salary cap, team constraints, and the minimum salary used.'] : ['No legal lineups satisfy roster eligibility, salary cap, and team constraints.']);
  if (generated.length >= limit) warnings.push(`Lineup enumeration stopped at ${limit} candidates (a search budget, not exhaustive enumeration); results reflect the highest-value combinations found within that budget, prioritized by salary efficiency.`);

  const scored = generated.map((lineup) => scoreCandidate(lineup, workingInput, projectionByPlayer, profile));
  const ranked = rankCandidates(scored, maxCandidates);
  applyFieldHeuristic(ranked); // must run before the cash-line estimate below, which weights by the refined ownershipEstimate
  const cashLineEstimate = computeCashLineEstimate(input.validatedSlate, ranked);
  if (cashLineEstimate) for (const candidate of ranked) candidate.cashLineProbability = rawCashLineProbability({ median: candidate.median, floor: candidate.floor, ceiling: candidate.ceiling, cashLine: cashLineEstimate.value }) ?? undefined;
  applyStrategicSimilarity(ranked);
  assignTypes(ranked);
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: ranked, warnings, gaps: input.projectionPackage.gaps.map((gap) => gap.reason), status: input.projectionPackage.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE', ...(cashLineEstimate ? { cashLineEstimate } : {}) };
}

// Prefers an explicit manual cash line when one was supplied on the slate; otherwise builds a
// first-pass SIMULATED estimate from data Optimize already has (the candidate pool and its
// ownership heuristic) -- there is no real field/ownership data source in this repo, so this is
// disclosed as an estimate via `source`, never presented as a validated number. Real calibrated
// probability (once enough historical contest results exist) is applied later in Selection.
function computeCashLineEstimate(slate: ValidatedSlate, candidates: LineupCandidate[]): { value: number; source: 'MANUAL' | 'SIMULATED' } | undefined {
  if (slate.contest.cashLine !== undefined) return { value: slate.contest.cashLine, source: 'MANUAL' };
  const { paidPositions, contestSize, contestKind } = slate.contest;
  if (contestKind === 'UNKNOWN' || contestKind === undefined || paidPositions === undefined || !contestSize) return undefined;
  const paidFraction = paidPositions / contestSize;
  const value = estimateFieldCashLine(candidates, paidFraction, slate.slateId);
  return value !== undefined ? { value, source: 'SIMULATED' } : undefined;
}

// Simulates a field of entries by weighted-resampling the existing candidate pool (heavier
// ownershipEstimate = drafted more often by the simulated field, closer to a real field's
// composition than uniform-random sampling), applying the same style of seeded noise used
// elsewhere in the engine for outcome variance, then reads off the score at the percentile
// matching the contest's paid fraction. This is a heuristic-on-a-heuristic (built on the
// already-labeled ownership proxy) and must never be presented as more precise than that.
function estimateFieldCashLine(candidates: LineupCandidate[], paidFraction: number, seedText: string): number | undefined {
  if (!candidates.length || !(paidFraction > 0) || !(paidFraction < 1)) return undefined;
  const weights = candidates.map((candidate) => Math.max(0.001, candidate.ownershipEstimate));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) return undefined;
  const sampleCount = 2000;
  let seed = [...seedText].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 11);
  const scores: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    let pick = (seed / 4294967296) * totalWeight;
    let chosenIndex = candidates.length - 1;
    for (let index = 0; index < candidates.length; index += 1) { pick -= weights[index]; if (pick <= 0) { chosenIndex = index; break; } }
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = ((seed / 4294967296) - 0.5) * 0.5;
    scores.push(Math.max(0, candidates[chosenIndex].median * (1 + noise)));
  }
  scores.sort((a, b) => a - b);
  const percentile = Math.min(0.999, Math.max(0, 1 - paidFraction));
  const index = Math.min(scores.length - 1, Math.max(0, Math.floor(percentile * (scores.length - 1))));
  return scores[index];
}

interface ContestObjectiveContext { contestSize?: number; userEntryCount: number; maxEntriesAllowed?: number; format: string; }
function objectiveProfileForContest(context: ContestObjectiveContext): ObjectiveProfile {
  const singleEntrySmallField = context.userEntryCount <= 1 && (context.contestSize === undefined || context.contestSize < 1_000);
  if (singleEntrySmallField) return SMALL_FIELD_PROFILE;
  const largeField = (context.contestSize ?? 0) >= 10_000 || (context.maxEntriesAllowed ?? 0) > 20 || context.userEntryCount > 20;
  if (largeField) return LARGE_FIELD_PROFILE;
  return DEFAULT_PROFILE;
}

function slotOrder(slots: Record<string, { count: number }>): string[] {
  return Object.entries(slots).flatMap(([slot, rule]) => Array.from({ length: rule.count }, (_, index) => rule.count > 1 ? `${slot}_${index + 1}` : slot));
}

// An optimistic (lowest-possible) salary needed to fill every OTHER slot besides the one
// currently being assigned, used to prune branches that can never fit under the cap instead
// of only discovering that at the leaf.
function minSalaryPerSlot(players: SlatePlayer[], cap: number, slots: Record<string, { salaryMultiplier?: number }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [slot, rule] of Object.entries(slots)) {
    const salaries = players.map((player) => salaryForSlot(player, slot, rule)).filter((value): value is number => value !== undefined);
    result[slot] = salaries.length ? Math.min(...salaries) : cap;
  }
  return result;
}

function enumerate(slots: string[], index: number, rosterSlots: Record<string, string>, salaryUsed: number, used: Set<string>, input: OptimizerInput, playersByValue: SlatePlayer[], minSalaryBySlot: Record<string, number>, output: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }>, limit: number, minSalaryUsed: number): void {
  if (output.length >= limit) return;
  if (index === slots.length) {
    const teams = new Set(Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)?.team).filter(Boolean));
    const minimumTeams = input.validatedSlate.rosterRules.teamConstraints?.minimumTeams;
    if (minimumTeams && teams.size < minimumTeams) return;
    if (minSalaryUsed && salaryUsed < minSalaryUsed) return;
    output.push({ rosterSlots: { ...rosterSlots }, salaryUsed });
    return;
  }
  const slot = slots[index];
  const ruleSlot = baseSlot(slot);
  const minimumTeams = input.validatedSlate.rosterRules.teamConstraints?.minimumTeams;
  const selectedTeams = new Set(Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)?.team).filter(Boolean));
  const remainingMinCost = slots.slice(index + 1).reduce((sum, remainingSlot) => sum + (minSalaryBySlot[baseSlot(remainingSlot)] ?? 0), 0);
  for (const player of playersByValue) {
    if (output.length >= limit) return;
    if (used.has(player.playerId) && input.validatedSlate.rosterRules.uniquePlayersRequired) continue;
    if (!player.eligibility[ruleSlot]) continue;
    const salary = salaryForSlot(player, ruleSlot, input.validatedSlate.rosterRules.slots[ruleSlot]);
    if (salary === undefined || salaryUsed + salary + remainingMinCost > input.validatedSlate.salaryCap) continue;
    const maxPerTeam = input.validatedSlate.rosterRules.teamConstraints?.maximumPlayersPerTeam;
    if (maxPerTeam && player.team && Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((candidate) => candidate.playerId === id)?.team).filter((team) => team === player.team).length >= maxPerTeam) continue;
    if (minimumTeams && index === slots.length - 1 && selectedTeams.size < minimumTeams && player.team && selectedTeams.has(player.team)) continue;
    if (minimumTeams && minimumTeams > 1 && slots.length === 6 && index === 1 && selectedTeams.size === 1 && player.team && selectedTeams.has(player.team)) continue;
    rosterSlots[slot] = player.playerId;
    used.add(player.playerId);
    enumerate(slots, index + 1, rosterSlots, salaryUsed + salary, used, input, playersByValue, minSalaryBySlot, output, limit, minSalaryUsed);
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

// Small, honest correlation model: only same-team pairings can correlate. Sport-specific
// position pairings get a stronger weight (e.g. NFL QB + pass-catcher); any other same-team
// pairing gets a modest default. This is not a simulated joint distribution — it's a
// directional heuristic, same spirit as the rest of the deterministic engine.
const POSITION_CORRELATION: Partial<Record<Sport, Array<{ a: RegExp; b: RegExp; weight: number }>>> = {
  NFL: [{ a: /^QB$/i, b: /^(WR|TE)$/i, weight: 0.18 }, { a: /^RB$/i, b: /^DST$/i, weight: -0.05 }],
  NBA: [{ a: /^PG$/i, b: /^(SG|SF)$/i, weight: 0.08 }],
  WNBA: [{ a: /^PG$/i, b: /^(SG|SF)$/i, weight: 0.08 }],
};
function pairCorrelation(sport: Sport, a: SlatePlayer, b: SlatePlayer): number {
  if (!a.team || a.team !== b.team) return 0;
  const rules = POSITION_CORRELATION[sport] ?? [];
  for (const rule of rules) if ((rule.a.test(a.position ?? '') && rule.b.test(b.position ?? '')) || (rule.a.test(b.position ?? '') && rule.b.test(a.position ?? ''))) return rule.weight;
  return 0.03;
}

function scoreCandidate(lineup: { rosterSlots: Record<string, string>; salaryUsed: number }, input: OptimizerInput, projectionByPlayer: Map<string, OptimizerInput['projectionPackage']['players'][number]>, profile: ObjectiveProfile): LineupCandidate {
  const players = Object.values(lineup.rosterSlots).map((id) => projectionByPlayer.get(id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const projected = (key: 'floorP20' | 'medianP50' | 'ceilingP90') => Object.entries(lineup.rosterSlots).reduce((sum, [slot, id]) => sum + scaledProjection(projectionByPlayer.get(id)?.projectedOutcomes[key] ?? 0, input.validatedSlate.rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier), 0);
  const floor = projected('floorP20');
  const median = projected('medianP50');
  const ceiling = projected('ceilingP90');
  const playerRows = Object.values(lineup.rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const teamCounts = new Map<string, number>();
  for (const player of playerRows) if (player.team) teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
  let correlationScore = 0;
  for (let i = 0; i < playerRows.length; i += 1) for (let j = i + 1; j < playerRows.length; j += 1) correlationScore += pairCorrelation(input.validatedSlate.sport, playerRows[i], playerRows[j]);
  const baseOwnershipEstimate = players.reduce((sum, player) => sum + 1 / Math.max(1, player.salaryEfficiency.medianPer1k), 0) / Math.max(1, players.length);
  // Nudges ownership down (leverage up) for lineups built from higher-relative-variance players --
  // still a heuristic proxy, not real field data, but one that now uses the real per-player
  // floor/ceiling spread Projection computes instead of ignoring it entirely. Bounded so it can
  // only ever discount the base salary-efficiency signal, never dominate it.
  const relativeSpread = players.reduce((sum, player) => sum + (player.projectedOutcomes.ceilingP90 - player.projectedOutcomes.floorP20) / Math.max(1, player.projectedOutcomes.medianP50), 0) / Math.max(1, players.length);
  const ownershipEstimate = baseOwnershipEstimate * (1 - Math.min(0.2, relativeSpread * 0.1));
  const leverageScore = Math.max(0, 1 - ownershipEstimate);
  const objective = median * profile.medianWeight + ceiling * profile.ceilingWeight + leverageScore * profile.leverageWeight + correlationScore * profile.correlationWeight;
  const id = stableId(JSON.stringify(lineup.rosterSlots));
  const dominantTeam = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const gameScriptCluster = teamCounts.size > 1 ? (dominantTeam ? `MULTI_TEAM_${dominantTeam}_LEAN` : 'MULTI_TEAM') : (dominantTeam ? `${dominantTeam}_HEAVY` : 'SINGLE_TEAM_OR_UNKNOWN');
  return { id, playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed, salaryRemaining: input.validatedSlate.salaryCap - lineup.salaryUsed, floor, median, ceiling, correlationScore, optimalLineupFrequency: objective, topOnePercentFrequency: objective, ownershipEstimate, leverageScore, duplicationRisk: ownershipEstimate > 0.5 ? 'HIGH' : ownershipEstimate > 0.25 ? 'MEDIUM' : 'LOW', estimatedDuplicates: Math.round(ownershipEstimate * 100), medianRank: 0, ceilingRank: 0, tournamentRank: 0, candidateTypes: [], gameScriptCluster, strategicSimilarity: 0, riskFlags: players.flatMap((player) => player.uncertaintyFactors) };
}

// No real field-ownership data source exists in this repo (no historical contest-entry feed),
// so this remains a heuristic proxy, not a simulated/trained field model: lineups ranked
// near the top on median/ceiling are assumed more likely to be widely drafted ("chalk").
function applyFieldHeuristic(candidates: LineupCandidate[]): void {
  const total = candidates.length;
  if (total <= 1) return;
  for (const candidate of candidates) {
    const medianPercentile = 1 - (candidate.medianRank - 1) / (total - 1);
    const chalkProxy = candidate.ownershipEstimate * 0.6 + medianPercentile * 0.4;
    candidate.ownershipEstimate = Math.max(0, Math.min(1, chalkProxy));
    candidate.leverageScore = Math.max(0, 1 - candidate.ownershipEstimate);
    candidate.duplicationRisk = candidate.ownershipEstimate > 0.5 ? 'HIGH' : candidate.ownershipEstimate > 0.25 ? 'MEDIUM' : 'LOW';
    candidate.estimatedDuplicates = Math.round(candidate.ownershipEstimate * 100);
  }
}

function applyStrategicSimilarity(candidates: LineupCandidate[]): void {
  for (const candidate of candidates) {
    const others = candidates.filter((other) => other.id !== candidate.id);
    candidate.strategicSimilarity = others.length ? others.reduce((sum, other) => sum + overlapRatio(candidate.playerIds, other.playerIds), 0) / others.length : 0;
  }
}
function overlapRatio(a: string[], b: string[]): number { const set = new Set(a); return b.filter((id) => set.has(id)).length / Math.max(a.length, b.length, 1); }

function scaledProjection(value: number, multiplier?: number): number { return value * (multiplier ?? 1); }
function rankCandidates(candidates: LineupCandidate[], maxCandidates: number): LineupCandidate[] { const median = [...candidates].sort((a, b) => b.median - a.median); const ceiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling); const tournament = [...candidates].sort((a, b) => b.optimalLineupFrequency - a.optimalLineupFrequency); return candidates.sort((a, b) => b.optimalLineupFrequency - a.optimalLineupFrequency).slice(0, maxCandidates).map((candidate) => ({ ...candidate, medianRank: median.findIndex((item) => item.id === candidate.id) + 1, ceilingRank: ceiling.findIndex((item) => item.id === candidate.id) + 1, tournamentRank: tournament.findIndex((item) => item.id === candidate.id) + 1 })); }
function assignTypes(candidates: LineupCandidate[]): void {
  if (!candidates.length) return;
  const highestMedian = [...candidates].sort((a, b) => b.median - a.median)[0];
  const highestCeiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling)[0];
  const leverage = [...candidates].sort((a, b) => b.leverageScore - a.leverageScore)[0];
  const lowDup = [...candidates].sort((a, b) => a.estimatedDuplicates - b.estimatedDuplicates)[0];
  const alternateScript = [...candidates].filter((candidate) => candidate.gameScriptCluster !== highestMedian.gameScriptCluster).sort((a, b) => b.optimalLineupFrequency - a.optimalLineupFrequency)[0];
  for (const candidate of candidates) {
    if (candidate.id === highestMedian.id) candidate.candidateTypes.push('HIGHEST_MEDIAN');
    if (candidate.id === highestCeiling.id) candidate.candidateTypes.push('HIGHEST_CEILING');
    if (candidate.tournamentRank === 1) candidate.candidateTypes.push('BEST_TOURNAMENT_EV');
    if (candidate.id === leverage.id) candidate.candidateTypes.push('LEVERAGE');
    if (candidate.id === lowDup.id) candidate.candidateTypes.push('LOW_DUPLICATION');
    if (alternateScript && candidate.id === alternateScript.id) candidate.candidateTypes.push('ALTERNATE_GAME_SCRIPT');
  }
}
function blocked(slate: ValidatedSlate, profile: ObjectiveProfile, now: Date, gaps: string[]): OptimizerPackage { return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: [], warnings: [], gaps, status: 'BLOCKED' }; }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
