import type {
  LineupCandidate,
  ObjectiveProfile,
  OptimizerPackage,
  ProjectionPackage,
  SlatePlayer,
  Sport,
  ValidatedSlate,
  PortfolioConstraints,
} from './contracts.js';
import { rawCashLineProbability } from './cashLineCalibration.js';
import { salaryForRosterSlot, validateLineupCandidate } from './validation.js';
import { simulateContestField } from './contestSimulation.js';

const DEFAULT_PROFILE: ObjectiveProfile = { name: 'balanced-lineup-heuristic', medianWeight: 0.35, ceilingWeight: 0.35, leverageWeight: 0.15, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const SMALL_FIELD_PROFILE: ObjectiveProfile = { name: 'small-field', medianWeight: 0.45, ceilingWeight: 0.3, leverageWeight: 0.1, duplicationPenalty: 0.1, correlationWeight: 0.05 };
const LARGE_FIELD_PROFILE: ObjectiveProfile = { name: 'large-field-gpp', medianWeight: 0.2, ceilingWeight: 0.4, leverageWeight: 0.2, duplicationPenalty: 0.15, correlationWeight: 0.05 };
// "Max Fantasy Points" is a literal objective, not a blend -- none of the three contest-size
// profiles above are purely median-maximizing (they all weight ceiling/leverage too), so it
// gets its own profile rather than being approximated by one of the others.
const MAX_FPTS_PROFILE: ObjectiveProfile = { name: 'max-expected-fantasy-points', meanWeight: 1, medianWeight: 0, ceilingWeight: 0, leverageWeight: 0, duplicationPenalty: 0, correlationWeight: 0 };

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
  /** Hard DFS node cap. The default is conservative for request/worker execution. */
  maxSearchNodes?: number;
  fieldSimulations?: number;
  fieldMaxScoreComparisons?: number;
  objectiveProfile?: ObjectiveProfile;
  /** The UI's "Objective" selector value (max_fpts/tournament/balanced_ev/safe). Takes priority
   * over the automatic contest-size profile below when recognized; falls through otherwise. */
  lineupMode?: string;
  /** A hard salary-floor constraint (e.g. from the UI's "min salary used" setting) enforced
   * during enumeration -- never fabricated, only applied when the caller actually supplies it. */
  minSalaryUsed?: number;
  portfolioConstraints?: PortfolioConstraints;
  /** Immutable assignments used by late-swap optimization. The associated player must be in the slate and projected. */
  fixedRosterSlots?: Record<string, string>;
}

export function optimizeLineups(input: OptimizerInput, options: OptimizerOptions = {}, now = new Date()): OptimizerPackage {
  const startedAt = Date.now();
  const contest = input.validatedSlate.contest;
  const profile = options.objectiveProfile ?? (options.lineupMode ? OBJECTIVE_PROFILE_BY_LINEUP_MODE[options.lineupMode] : undefined) ?? objectiveProfileForContest({ contestSize: contest.contestSize, userEntryCount: contest.userEntryCount, maxEntriesAllowed: contest.maxEntriesAllowed, format: input.validatedSlate.contest.format });
  const maxCandidates = boundedInteger(options.maxCandidates, 500, 1, 5_000);
  const minSalaryUsed = options.minSalaryUsed ?? 0;
  const warnings = [...input.validatedSlate.validation.warnings];
  if (contest.contestSize === undefined) warnings.push('contest.contestSize is unavailable; optimizer used the configured fallback objective profile.');
  if (input.projectionPackage.status === 'BLOCKED') {
    const projectionReasons = input.projectionPackage.gaps.map((gap) => gap.reason).filter(Boolean).slice(0, 4);
    return blocked(input.validatedSlate, profile, now, ['ProjectionPackage is BLOCKED; no legal lineup can be evaluated.', ...projectionReasons]);
  }

  const projectionByPlayer = new Map(input.projectionPackage.players.map((player) => [player.playerId, player]));
  const fixedRosterSlots = options.fixedRosterSlots ?? {};
  const fixedSlotErrors: string[] = [];
  const fixedPlayerIds = new Set<string>();
  for (const [slot, playerId] of Object.entries(fixedRosterSlots)) {
    const base = slot.replace(/_\d+$/, '');
    const player = input.validatedSlate.playerPool.find((candidate) => candidate.playerId === playerId);
    if (!Object.prototype.hasOwnProperty.call(input.validatedSlate.rosterRules.slots, base)) fixedSlotErrors.push(`Locked assignment uses unknown slot ${slot}.`);
    if (!player) fixedSlotErrors.push(`Locked assignment player ${playerId} is not in the stored slate.`);
    else if (!player.eligibility[base]) fixedSlotErrors.push(`Locked player ${playerId} is not eligible for preserved slot ${slot}.`);
    if (!projectionByPlayer.has(playerId)) fixedSlotErrors.push(`Locked player ${playerId} has no current projection; late-swap optimization cannot score it safely.`);
    if (fixedPlayerIds.has(playerId) && input.validatedSlate.rosterRules.uniquePlayersRequired) fixedSlotErrors.push(`Locked player ${playerId} is assigned to multiple slots.`);
    fixedPlayerIds.add(playerId);
  }
  if (fixedSlotErrors.length) return blocked(input.validatedSlate, profile, now, fixedSlotErrors);
  const excludedPlayers = input.validatedSlate.playerPool.filter((player) => !projectionByPlayer.has(player.playerId));
  if (excludedPlayers.length) { const names = excludedPlayers.map((player) => player.playerName); warnings.push(`${excludedPlayers.length} player(s) have no projection and were excluded from lineup generation: ${names.slice(0, 10).join(', ')}${names.length > 10 ? `, and ${names.length - 10} more` : ''}.`); }
  const ineligiblePlayers = input.validatedSlate.playerPool.filter((player) => isExplicitlyUnavailable(player));
  if (ineligiblePlayers.length) warnings.push(`${ineligiblePlayers.length} player(s) excluded from lineup generation because availability is explicitly OUT/INACTIVE or the player was not found on the complete provider roster: ${ineligiblePlayers.map((player) => player.playerName).slice(0, 10).join(', ')}.`);
  // An MLB starting pitcher is not interchangeable with an unconfirmed player. A DraftKings
  // slate can contain eligible players before the official starters are posted, and UNKNOWN or
  // PROJECTED does not verify that the pitcher will actually take the mound. Relievers remain
  // eligible unless explicitly unavailable because they can enter the game without being the
  // confirmed starter. This prevents stale/future starter projections from producing a captain
  // who is not pitching while preserving valid bullpen options.
  const unconfirmedMlbStarters = input.validatedSlate.sport === 'MLB'
    ? input.validatedSlate.playerPool.filter((player) => /^(SP|P)$/i.test(String(player.position ?? '').trim()) && player.availability?.status !== 'CONFIRMED_STARTER')
    : [];
  if (unconfirmedMlbStarters.length) warnings.push(`${unconfirmedMlbStarters.length} MLB starting pitcher(s) excluded because they were not confirmed starters: ${unconfirmedMlbStarters.map((player) => player.playerName).slice(0, 10).join(', ')}${unconfirmedMlbStarters.length > 10 ? `, and ${unconfirmedMlbStarters.length - 10} more` : ''}.`);
  const excludedIds = new Set(unconfirmedMlbStarters.map((player) => player.playerId));
  const nonStarters = input.validatedSlate.sport === 'MLB' ? input.validatedSlate.playerPool.filter((player) => player.availability?.status === 'NOT_IN_CONFIRMED_LINEUP') : [];
  if (nonStarters.length) warnings.push(`${nonStarters.length} MLB player(s) excluded because they were not in the confirmed starting lineup: ${nonStarters.map((player) => player.playerName).slice(0, 10).join(', ')}${nonStarters.length > 10 ? `, and ${nonStarters.length - 10} more` : ''}.`);
  const workingInput: OptimizerInput = { ...input, validatedSlate: { ...input.validatedSlate, playerPool: input.validatedSlate.playerPool.filter((player) => projectionByPlayer.has(player.playerId) && (!isExplicitlyUnavailable(player) || fixedPlayerIds.has(player.playerId)) && (!excludedIds.has(player.playerId) || fixedPlayerIds.has(player.playerId))) } };

  const slots = slotOrder(workingInput.validatedSlate.rosterRules.slots);
  if (!slots.length) return blocked(input.validatedSlate, profile, now, ['No roster slots are available.']);
  // Search always continues until the node budget or the legal tree is exhausted. `maxCandidates`
  // limits only the returned shortlist, never the number of early legal leaves inspected.
  const maxFptsObjective = isMaxFptsProfile(profile);
  const searchControl = { visited: 0, budget: boundedInteger(options.maxSearchNodes, 50_000, 1_000, 100_000), truncated: false, objectiveBounded: maxFptsObjective, targetLineups: maxCandidates, bestTopK: [] as Array<{ key: string; score: number }>, seenLineups: new Set<string>(), candidatesEvaluated: 0, prunedBranches: 0, slotUpperBounds: {} as Record<string, number> };
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
  const searchValue = (player: SlatePlayer) => { const projection = projectionByPlayer.get(player.playerId); if (!projection) return 0; const mean = meanOf(projection.simulatedFantasyPointSamples ?? [], projection.projectedOutcomes.medianP50); return mean * (profile.meanWeight ?? 0) + projection.projectedOutcomes.medianP50 * profile.medianWeight + projection.projectedOutcomes.ceilingP90 * profile.ceilingWeight; };
  const playersByValue = [...workingInput.validatedSlate.playerPool].sort((a, b) => searchValue(b) - searchValue(a));
  const minSalaryBySlot = minSalaryPerSlot(playersByValue, workingInput.validatedSlate.salaryCap, workingInput.validatedSlate.rosterRules.slots);
  searchControl.slotUpperBounds = Object.fromEntries(Object.keys(workingInput.validatedSlate.rosterRules.slots).map((slot) => [slot, Math.max(0, ...playersByValue.filter((player) => player.eligibility[slot]).map((player) => { const projection = projectionByPlayer.get(player.playerId); return projection ? meanOf(projection.simulatedFantasyPointSamples ?? [], projection.projectedOutcomes.medianP50) * (workingInput.validatedSlate.rosterRules.slots[slot].fantasyMultiplier ?? 1) : Number.NEGATIVE_INFINITY; }))]));
  const generated: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }> = [];
  enumerate(slots, 0, {}, 0, 0, new Set(), workingInput, playersByValue, minSalaryBySlot, generated, Number.MAX_SAFE_INTEGER, minSalaryUsed, searchControl, fixedRosterSlots);
  const uniqueGenerated = deduplicateSlotPermutations(generated);
  const exhaustive = !searchControl.truncated;
  if (!uniqueGenerated.length) return blocked(input.validatedSlate, profile, now, minSalaryUsed ? ['No legal lineups satisfy roster eligibility, salary cap, team constraints, and the minimum salary used.'] : ['No legal lineups satisfy roster eligibility, salary cap, and team constraints.']);
  if (!exhaustive) warnings.push(`Lineup search stopped at the ${searchControl.budget}-node work budget; results are bounded and may omit better legal builds.`);
  if (exhaustive && searchControl.prunedBranches) warnings.push(`Objective bounds proved the retained top ${uniqueGenerated.length} Max FPTS lineup(s); equivalent slot permutations were removed.`);
  else if (exhaustive) warnings.push(`Exhaustive legal lineup enumeration completed (${uniqueGenerated.length} unique roster assignments after equivalent-slot permutations were removed).`);

  const marketAverages = slateMarketAverages(workingInput.validatedSlate.playerPool);
  const invalidGenerated = uniqueGenerated.flatMap((lineup) => validateLineupCandidate({ playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed }, workingInput.validatedSlate, { lockedSlotAssignments: fixedRosterSlots }));
  if (invalidGenerated.length) return blocked(input.validatedSlate, profile, now, invalidGenerated);
  const scored = uniqueGenerated.map((lineup) => scoreCandidate(lineup, workingInput, projectionByPlayer, profile, marketAverages));
  // Score and simulate the full legal search result before truncating the candidate report. This
  // prevents a deterministic pre-sort from silently excluding a lineup that wins in the contest
  // model. The final report is still bounded by maxCandidates for storage/UI consumption.
  const allRanked = rankCandidates(scored, scored.length);
  applyFieldHeuristic(allRanked); // must run before field simulation, which weights construction
  const contestSimulation = simulateContestField(input.validatedSlate, allRanked, { seed: `${input.validatedSlate.slateId}:${input.validatedSlate.contest.draftKingsContestId}`, simulations: options.fieldSimulations, maxScoreComparisons: options.fieldMaxScoreComparisons }, input.projectionPackage.players);
  applyContestMetrics(allRanked, contestSimulation);
  const ranked = rankCandidates(allRanked, maxCandidates);
  const cashLineEstimate = computeCashLineEstimate(input.validatedSlate);
  if (cashLineEstimate) for (const candidate of ranked) candidate.cashLineProbability = rawCashLineProbability({ median: candidate.median, floor: candidate.floor, ceiling: candidate.ceiling, cashLine: cashLineEstimate.value }) ?? undefined;
  applyStrategicSimilarity(ranked);
  assignTypes(ranked);
  if (contestSimulation.status === 'UNAVAILABLE') warnings.push(`Contest simulation unavailable: ${contestSimulation.reason}`);
  else if (contestSimulation.status === 'PARTIAL') warnings.push(`Contest simulation is partial: ${contestSimulation.reason}`);
  const best = allRanked[0];
  const maxFptsUpperBound = maxFptsObjective ? maxFptsUpperBoundForSlots(workingInput) : undefined;
  const objectiveGap = maxFptsUpperBound === undefined || !best ? undefined : Math.max(0, maxFptsUpperBound - (best.expectedPoints ?? best.median));
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: ranked, warnings, gaps: input.projectionPackage.gaps.map((gap) => gap.reason), status: input.projectionPackage.status === 'PARTIAL' || !exhaustive || contestSimulation.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE', engineState: 'MODEL_VALIDATION_REQUIRED', searchCompleteness: exhaustive ? 'EXHAUSTIVE' : 'BOUNDED', ...(exhaustive ? { optimalityGap: 0 } : {}), searchDiagnostics: { algorithm: maxFptsObjective ? 'DETERMINISTIC_BRANCH_AND_BOUND' : 'DETERMINISTIC_VALUE_ORDERED_DFS', terminationReason: !exhaustive ? 'NODE_BUDGET' : searchControl.prunedBranches ? 'OBJECTIVE_BOUND_PROVEN' : 'SEARCH_SPACE_EXHAUSTED', nodesVisited: searchControl.visited, elapsedMilliseconds: Math.max(0, Date.now() - startedAt), candidatesEvaluated: searchControl.candidatesEvaluated, uniqueLineups: uniqueGenerated.length, bestIncumbentObjective: best ? objectiveScore(best, profile) : undefined, ...(maxFptsUpperBound !== undefined ? { validUpperBound: maxFptsUpperBound, objectiveGap } : {}) }, ...(options.portfolioConstraints ? { portfolioConstraints: options.portfolioConstraints } : {}), contestSimulation: { status: contestSimulation.status, simulations: contestSimulation.simulations, fieldEntries: contestSimulation.fieldEntries, fieldModel: contestSimulation.fieldModel, payoutModel: contestSimulation.payoutModel, reason: contestSimulation.reason, seed: contestSimulation.seed, ownershipProvenance: contestSimulation.ownershipProvenance, dependenceModel: contestSimulation.dependenceModel, rulesVersion: contestSimulation.rulesVersion }, ...(cashLineEstimate ? { cashLineEstimate } : {}) };
}

function isExplicitlyUnavailable(player: SlatePlayer): boolean {
  if (['OUT', 'INACTIVE', 'NOT_IN_CONFIRMED_LINEUP', 'NOT_IN_PROVIDER_ROSTER'].includes(player.availability?.status ?? '')) return true;
  return /^(IL|IR| injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim());
}

// Only an explicitly supplied score threshold can be evaluated here. Inferring a cash line
// from the optimizer's own candidates makes the prediction circular and is not a contest model.
function computeCashLineEstimate(slate: ValidatedSlate): { value: number; source: 'MANUAL' } | undefined {
  if (slate.contest.cashLine !== undefined) return { value: slate.contest.cashLine, source: 'MANUAL' };
  return undefined;
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

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number { return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value!))) : fallback; }

function deduplicateSlotPermutations(lineups: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }>): Array<{ rosterSlots: Record<string, string>; salaryUsed: number }> {
  const unique = new Map<string, { rosterSlots: Record<string, string>; salaryUsed: number }>();
  for (const lineup of lineups) {
    const canonical = canonicalRosterSlots(lineup.rosterSlots);
    const key = JSON.stringify(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)));
    if (!unique.has(key)) unique.set(key, { rosterSlots: canonical, salaryUsed: lineup.salaryUsed });
  }
  return [...unique.values()];
}

function canonicalRosterSlots(rosterSlots: Record<string, string>): Record<string, string> {
  const groups = new Map<string, Array<[string, string]>>();
  for (const entry of Object.entries(rosterSlots)) { const base = baseSlot(entry[0]); groups.set(base, [...(groups.get(base) ?? []), entry]); }
  const canonical: Record<string, string> = {};
  for (const entries of groups.values()) {
    entries.sort(([a], [b]) => a.localeCompare(b));
    const playerIds = entries.map(([, playerId]) => playerId).sort((a, b) => a.localeCompare(b));
    entries.forEach(([slot], index) => { canonical[slot] = playerIds[index]; });
  }
  return canonical;
}

function maxFptsUpperBoundForSlots(input: OptimizerInput): number {
  const projectionByPlayer = new Map(input.projectionPackage.players.map((player) => [player.playerId, player]));
  let upperBound = 0;
  for (const [slot, rule] of Object.entries(input.validatedSlate.rosterRules.slots)) {
    const multiplier = rule.fantasyMultiplier ?? 1;
    const best = input.validatedSlate.playerPool.filter((player) => player.eligibility[slot] && !isExplicitlyUnavailable(player)).map((player) => {
      const projection = projectionByPlayer.get(player.playerId);
      return projection ? meanOf(projection.simulatedFantasyPointSamples ?? [], projection.projectedOutcomes.medianP50) * multiplier : Number.NEGATIVE_INFINITY;
    }).reduce((maximum, value) => Math.max(maximum, value), Number.NEGATIVE_INFINITY);
    upperBound += Math.max(0, best) * rule.count;
  }
  return upperBound;
}

function objectiveScore(candidate: LineupCandidate, profile: ObjectiveProfile): number {
  return (candidate.expectedPoints ?? candidate.median) * (profile.meanWeight ?? 0) + candidate.median * profile.medianWeight + candidate.ceiling * profile.ceilingWeight + (candidate.heuristicLeverageScore ?? 0) * profile.leverageWeight + candidate.correlationScore * profile.correlationWeight - (candidate.heuristicOwnershipProxy ?? 0) * profile.duplicationPenalty;
}

function isMaxFptsProfile(profile: ObjectiveProfile): boolean { return (profile.meanWeight ?? 0) === 1 && profile.medianWeight === 0 && profile.ceilingWeight === 0 && profile.leverageWeight === 0 && profile.duplicationPenalty === 0 && profile.correlationWeight === 0; }

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

function enumerate(slots: string[], index: number, rosterSlots: Record<string, string>, salaryUsed: number, currentExpectedPoints: number, used: Set<string>, input: OptimizerInput, playersByValue: SlatePlayer[], minSalaryBySlot: Record<string, number>, output: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }>, limit: number, minSalaryUsed: number, control: { visited: number; budget: number; truncated: boolean; objectiveBounded: boolean; targetLineups: number; bestTopK: Array<{ key: string; score: number }>; seenLineups: Set<string>; candidatesEvaluated: number; prunedBranches: number; slotUpperBounds: Record<string, number> }, fixedRosterSlots: Record<string, string>): void {
  if (output.length >= limit && !control.objectiveBounded) return;
  if (control.visited >= control.budget) { control.truncated = true; return; }
  control.visited += 1;
  if (control.objectiveBounded && control.bestTopK.length >= control.targetLineups) {
    const remainingUpperBound = currentExpectedPoints + slots.slice(index).reduce((sum, slot) => sum + (control.slotUpperBounds[baseSlot(slot)] ?? 0), 0);
    const weakestRetained = control.bestTopK[control.bestTopK.length - 1].score;
    if (remainingUpperBound < weakestRetained - 1e-9) { control.prunedBranches += 1; return; }
  }
  if (index === slots.length) {
    const teams = new Set(Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)?.team).filter(Boolean));
    const minimumTeams = input.validatedSlate.rosterRules.teamConstraints?.minimumTeams;
    if (minimumTeams && teams.size < minimumTeams) return;
    const maxHittersPerTeam = input.validatedSlate.rosterRules.teamConstraints?.maximumHittersPerTeam;
    if (maxHittersPerTeam && input.validatedSlate.sport === 'MLB') {
      const hittersByTeam = new Map<string, number>();
      for (const playerId of Object.values(rosterSlots)) {
        const player = input.validatedSlate.playerPool.find((candidate) => candidate.playerId === playerId);
        if (player?.team && !['P', 'SP', 'RP'].includes(String(player.position ?? '').toUpperCase())) hittersByTeam.set(player.team, (hittersByTeam.get(player.team) ?? 0) + 1);
      }
      if ([...hittersByTeam.values()].some((count) => count > maxHittersPerTeam)) return;
    }
    if (minSalaryUsed && salaryUsed < minSalaryUsed) return;
    control.candidatesEvaluated += 1;
    const canonical = canonicalRosterSlots(rosterSlots);
    const key = JSON.stringify(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)));
    if (control.seenLineups.has(key)) return;
    control.seenLineups.add(key);
    if (!control.objectiveBounded) { output.push({ rosterSlots: canonical, salaryUsed }); return; }
    const existingWorst = control.bestTopK.length >= control.targetLineups ? control.bestTopK[control.bestTopK.length - 1] : undefined;
    const better = !existingWorst || currentExpectedPoints > existingWorst.score + 1e-9 || (Math.abs(currentExpectedPoints - existingWorst.score) <= 1e-9 && key.localeCompare(existingWorst.key) < 0);
    if (!better) return;
    if (existingWorst) {
      control.bestTopK.pop();
      const outputIndex = output.findIndex((lineup) => JSON.stringify(Object.entries(lineup.rosterSlots).sort(([a], [b]) => a.localeCompare(b))) === existingWorst.key);
      if (outputIndex >= 0) output.splice(outputIndex, 1);
    }
    control.bestTopK.push({ key, score: currentExpectedPoints });
    control.bestTopK.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    output.push({ rosterSlots: canonical, salaryUsed });
    return;
  }
  const slot = slots[index];
  const ruleSlot = baseSlot(slot);
  const minimumTeams = input.validatedSlate.rosterRules.teamConstraints?.minimumTeams;
  const selectedTeams = new Set(Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)?.team).filter(Boolean));
  const remainingMinCost = slots.slice(index + 1).reduce((sum, remainingSlot) => sum + (minSalaryBySlot[baseSlot(remainingSlot)] ?? 0), 0);
  for (const player of playersByValue) {
    if (output.length >= limit && !control.objectiveBounded) return;
    if (control.visited >= control.budget) { control.truncated = true; return; }
    if (used.has(player.playerId) && input.validatedSlate.rosterRules.uniquePlayersRequired) continue;
    if (fixedRosterSlots[slot] && fixedRosterSlots[slot] !== player.playerId) continue;
    if (!player.eligibility[ruleSlot]) continue;
    // Identical slots are interchangeable. A stable player-ID ordering emits one assignment
    // per player set while distinct roster slots (for example CPT versus UTIL) remain distinct.
    const previousEquivalent = slots.slice(0, index).filter((prior) => baseSlot(prior) === ruleSlot).map((prior) => rosterSlots[prior]).filter(Boolean);
    if (previousEquivalent.some((priorId) => priorId.localeCompare(player.playerId) > 0)) continue;
    const salary = salaryForSlot(player, ruleSlot, input.validatedSlate.rosterRules.slots[ruleSlot]);
    if (salary === undefined || salaryUsed + salary + remainingMinCost > input.validatedSlate.salaryCap) continue;
    const maxPerTeam = input.validatedSlate.rosterRules.teamConstraints?.maximumPlayersPerTeam;
    if (maxPerTeam && player.team && Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((candidate) => candidate.playerId === id)?.team).filter((team) => team === player.team).length >= maxPerTeam) continue;
    const maxHittersPerTeam = input.validatedSlate.rosterRules.teamConstraints?.maximumHittersPerTeam;
    if (maxHittersPerTeam && input.validatedSlate.sport === 'MLB' && player.team && !['P', 'SP', 'RP'].includes(String(player.position ?? '').toUpperCase())) {
      const existingHitters = Object.values(rosterSlots).map((id) => input.validatedSlate.playerPool.find((candidate) => candidate.playerId === id)).filter((candidate) => candidate !== undefined && candidate.team === player.team && !['P', 'SP', 'RP'].includes(String(candidate.position ?? '').toUpperCase())).length;
      if (existingHitters >= maxHittersPerTeam) continue;
    }
    if (minimumTeams && index === slots.length - 1 && selectedTeams.size < minimumTeams && player.team && selectedTeams.has(player.team)) continue;
    rosterSlots[slot] = player.playerId;
    used.add(player.playerId);
    const projection = input.projectionPackage.players.find((row) => row.playerId === player.playerId);
    const expectedPlayerPoints = projection ? meanOf(projection.simulatedFantasyPointSamples ?? [], projection.projectedOutcomes.medianP50) * (input.validatedSlate.rosterRules.slots[ruleSlot]?.fantasyMultiplier ?? 1) : 0;
    enumerate(slots, index + 1, rosterSlots, salaryUsed + salary, currentExpectedPoints + expectedPlayerPoints, used, input, playersByValue, minSalaryBySlot, output, limit, minSalaryUsed, control, fixedRosterSlots);
    delete rosterSlots[slot];
    used.delete(player.playerId);
  }
}

function salaryForSlot(player: SlatePlayer, slot: string, rule?: { salaryMultiplier?: number }): number | undefined { return salaryForRosterSlot(player, slot, rule); }

function baseSlot(slot: string): string { return slot.replace(/_\d+$/, ''); }

// Small, honest correlation model: same-team pairings, plus (below) opposing same-game
// "bring-back" pairings. Sport-specific position pairings get a stronger weight (e.g. NFL QB +
// pass-catcher); any other same-team pairing gets a modest default. This is not a simulated
// joint distribution — it's a directional heuristic, same spirit as the rest of the
// deterministic engine.
const POSITION_CORRELATION: Partial<Record<Sport, Array<{ a: RegExp; b: RegExp; weight: number }>>> = {
  NFL: [{ a: /^QB$/i, b: /^(WR|TE)$/i, weight: 0.18 }, { a: /^RB$/i, b: /^DST$/i, weight: -0.05 }],
  CFB: [{ a: /^QB$/i, b: /^(WR|TE)$/i, weight: 0.18 }],
  NBA: [{ a: /^PG$/i, b: /^(SG|SF)$/i, weight: 0.08 }],
  WNBA: [{ a: /^PG$/i, b: /^(SG|SF)$/i, weight: 0.08 }],
  // A team's own pitcher and its hitters are largely independent outcomes (not a real stack),
  // so that pairing is explicitly neutralized to 0 rather than falling through to the generic
  // same-team default below. Two same-team hitters is the standard MLB GPP stack.
  MLB: [{ a: /^P$/i, b: /^(C|1B|2B|3B|SS|OF)$/i, weight: 0 }, { a: /^(C|1B|2B|3B|SS|OF)$/i, b: /^(C|1B|2B|3B|SS|OF)$/i, weight: 0.08 }],
};
// Opposing players in the same game ("bring-back" correlation): real in a shootout-projected
// game script (NFL: a QB and the opposing team's pass-catcher both benefit from a
// back-and-forth scoring game), roughly neutral for NBA/WNBA (small positive from pace/blowout
// avoidance), and genuinely negative for an MLB pitcher against the opposing lineup he's
// actually facing (strikeouts/quality starts directly suppress those hitters' output).
const BRING_BACK_CORRELATION: Partial<Record<Sport, Array<{ a: RegExp; b: RegExp; weight: number }>>> = {
  NFL: [{ a: /^QB$/i, b: /^(WR|TE)$/i, weight: 0.08 }],
  CFB: [{ a: /^QB$/i, b: /^(WR|TE)$/i, weight: 0.08 }],
  NBA: [{ a: /^(PG|SG|SF|PF|C)$/i, b: /^(PG|SG|SF|PF|C)$/i, weight: 0.02 }],
  WNBA: [{ a: /^(PG|SG|SF|PF|C)$/i, b: /^(PG|SG|SF|PF|C)$/i, weight: 0.02 }],
  MLB: [{ a: /^P$/i, b: /^(C|1B|2B|3B|SS|OF)$/i, weight: -0.05 }],
};
// Real Vegas game total relative to the slate average scales the correlation bonus -- a stack
// in a genuinely high-total, shootout-projected game earns more credit than an identical stack
// in a low-total game. Capped to a modest range so it nudges, never inverts, the base weight.
// Falls back to a neutral 1x when no market data is available for this game (unchanged behavior).
function gameTotalScale(gameTotal: number | undefined, avgGameTotal: number | undefined): number {
  if (gameTotal === undefined || !avgGameTotal) return 1;
  return Math.max(0.7, Math.min(1.3, gameTotal / avgGameTotal));
}
function pairCorrelation(sport: Sport, a: SlatePlayer, b: SlatePlayer, avgGameTotal?: number): number {
  if (a.team && a.team === b.team) {
    const rules = POSITION_CORRELATION[sport] ?? [];
    const scale = gameTotalScale(a.marketContext?.gameTotal, avgGameTotal);
    for (const rule of rules) if ((rule.a.test(a.position ?? '') && rule.b.test(b.position ?? '')) || (rule.a.test(b.position ?? '') && rule.b.test(a.position ?? ''))) return rule.weight * scale;
    return 0.03 * scale;
  }
  if (a.team && b.team && (a.opponent === b.team || b.opponent === a.team)) {
    const rules = BRING_BACK_CORRELATION[sport] ?? [];
    const scale = gameTotalScale(a.marketContext?.gameTotal ?? b.marketContext?.gameTotal, avgGameTotal);
    for (const rule of rules) if ((rule.a.test(a.position ?? '') && rule.b.test(b.position ?? '')) || (rule.a.test(b.position ?? '') && rule.b.test(a.position ?? ''))) return rule.weight * scale;
  }
  return 0;
}
// Averages real Vegas market data across the slate's distinct teams (players on the same team
// share identical marketContext, so dedupe by team rather than double-counting). Empty/absent
// when no players have marketContext (fetch failed, key missing, or GOLF) -- callers treat an
// undefined average as "no market signal available" and fall back to unchanged behavior.
function slateMarketAverages(players: SlatePlayer[]): { avgImpliedTeamTotal?: number; avgGameTotal?: number } {
  const byTeam = new Map<string, NonNullable<SlatePlayer['marketContext']>>();
  for (const player of players) if (player.team && player.marketContext && !byTeam.has(player.team)) byTeam.set(player.team, player.marketContext);
  const contexts = [...byTeam.values()];
  if (!contexts.length) return {};
  return {
    avgImpliedTeamTotal: contexts.reduce((sum, context) => sum + context.impliedTeamTotal, 0) / contexts.length,
    avgGameTotal: contexts.reduce((sum, context) => sum + context.gameTotal, 0) / contexts.length,
  };
}

function scoreCandidate(lineup: { rosterSlots: Record<string, string>; salaryUsed: number }, input: OptimizerInput, projectionByPlayer: Map<string, OptimizerInput['projectionPackage']['players'][number]>, profile: ObjectiveProfile, marketAverages: { avgImpliedTeamTotal?: number; avgGameTotal?: number } = {}): LineupCandidate {
  const players = Object.values(lineup.rosterSlots).map((id) => projectionByPlayer.get(id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const lineupOutcomeSamples = buildLineupOutcomeSamples(lineup.rosterSlots, input, projectionByPlayer);
  const floor = quantile(lineupOutcomeSamples, 0.2);
  const median = quantile(lineupOutcomeSamples, 0.5);
  const ceiling = quantile(lineupOutcomeSamples, 0.9);
  const expectedPoints = Object.entries(lineup.rosterSlots).reduce((sum, [slot, playerId]) => { const playerProjection = projectionByPlayer.get(playerId); const values = playerProjection?.simulatedFantasyPointSamples; const expectedPlayerPoints = meanOf(values ?? [], playerProjection?.projectedOutcomes.medianP50 ?? 0); return sum + expectedPlayerPoints * (input.validatedSlate.rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier ?? 1); }, 0);
  const playerRows = Object.values(lineup.rosterSlots).map((id) => input.validatedSlate.playerPool.find((player) => player.playerId === id)).filter((player): player is NonNullable<typeof player> => Boolean(player));
  const teamCounts = new Map<string, number>();
  for (const player of playerRows) if (player.team) teamCounts.set(player.team, (teamCounts.get(player.team) ?? 0) + 1);
  let correlationScore = 0;
  for (let i = 0; i < playerRows.length; i += 1) for (let j = i + 1; j < playerRows.length; j += 1) correlationScore += pairCorrelation(input.validatedSlate.sport, playerRows[i], playerRows[j], marketAverages.avgGameTotal);
  const baseOwnershipEstimate = players.reduce((sum, player) => sum + 1 / Math.max(1, player.salaryEfficiency.medianPer1k), 0) / Math.max(1, players.length);
  // Nudges ownership down (leverage up) for lineups built from higher-relative-variance players --
  // still a heuristic proxy, not real field data, but one that now uses the real per-player
  // floor/ceiling spread Projection computes instead of ignoring it entirely. Bounded so it can
  // only ever discount the base salary-efficiency signal, never dominate it.
  const relativeSpread = players.reduce((sum, player) => sum + (player.projectedOutcomes.ceilingP90 - player.projectedOutcomes.floorP20) / Math.max(1, player.projectedOutcomes.medianP50), 0) / Math.max(1, players.length);
  // Grounds part of the ownership proxy in real Vegas data: a lineup leaning on teams with an
  // implied total above the slate average (the field chases high-scoring environments) nudges
  // ownership up; below-average teams nudge it down (more leverage). Bounded the same way as the
  // variance nudge above -- can only ever adjust the base signal by a capped amount, never
  // dominate or invert it. Players/lineups with no marketContext leave this at 0 (no nudge),
  // exactly today's behavior.
  const marketNudges = playerRows.filter((player) => player.marketContext).map((player) => marketAverages.avgImpliedTeamTotal ? (player.marketContext!.impliedTeamTotal - marketAverages.avgImpliedTeamTotal) / marketAverages.avgImpliedTeamTotal : 0);
  const avgMarketNudge = marketNudges.length ? marketNudges.reduce((sum, value) => sum + value, 0) / marketNudges.length : 0;
  const ownershipEstimate = baseOwnershipEstimate * (1 - Math.min(0.2, relativeSpread * 0.1)) * (1 + Math.max(-0.15, Math.min(0.15, avgMarketNudge * 0.3)));
  const leverageScore = Math.max(0, 1 - ownershipEstimate);
  const objective = expectedPoints * (profile.meanWeight ?? 0) + median * profile.medianWeight + ceiling * profile.ceilingWeight + leverageScore * profile.leverageWeight + correlationScore * profile.correlationWeight - ownershipEstimate * profile.duplicationPenalty;
  const canonicalSlots = canonicalRosterSlots(lineup.rosterSlots);
  const id = stableId(JSON.stringify(Object.entries(canonicalSlots).sort(([a], [b]) => a.localeCompare(b))));
  const dominantTeam = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const gameScriptCluster = teamCounts.size > 1 ? (dominantTeam ? `MULTI_TEAM_${dominantTeam}_LEAN` : 'MULTI_TEAM') : (dominantTeam ? `${dominantTeam}_HEAVY` : 'SINGLE_TEAM_OR_UNKNOWN');
  const heuristicDuplicationRisk = ownershipEstimate > 0.5 ? 'HIGH' : ownershipEstimate > 0.25 ? 'MEDIUM' : 'LOW';
  return { id, playerIds: Object.values(canonicalSlots), rosterSlots: canonicalSlots, salaryUsed: lineup.salaryUsed, salaryRemaining: input.validatedSlate.salaryCap - lineup.salaryUsed, floor, expectedPoints, median, ceiling, correlationScore, simulatedScoreSamples: lineupOutcomeSamples, heuristicTournamentScore: objective, heuristicOwnershipProxy: ownershipEstimate, heuristicLeverageScore: leverageScore, heuristicDuplicationRisk, heuristicDuplicationRiskScore: ownershipEstimate, medianRank: 0, ceilingRank: 0, heuristicTournamentRank: 0, candidateTypes: [], gameScriptCluster, strategicSimilarity: 0, riskFlags: players.flatMap((player) => player.uncertaintyFactors) };
}

function meanOf(values: number[], fallback: number): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback; }

function applyContestMetrics(candidates: LineupCandidate[], simulation: ReturnType<typeof simulateContestField>): void {
  for (const candidate of candidates) {
    const metrics = simulation.metrics.get(candidate.id);
    if (!metrics) { candidate.contestMetricProvenance = 'UNAVAILABLE'; continue; }
    Object.assign(candidate, metrics, { contestMetricProvenance: 'JOINT_FIELD_SIMULATION' });
  }
}

// No real field-ownership data source exists in this repo (no historical contest-entry feed),
// so this remains a heuristic proxy, not a simulated/trained field model.
function applyFieldHeuristic(candidates: LineupCandidate[]): void {
  const total = candidates.length;
  if (total <= 1) return;
  for (const candidate of candidates) {
    const medianPercentile = 1 - (candidate.medianRank - 1) / (total - 1);
    const chalkProxy = (candidate.heuristicOwnershipProxy ?? 0) * 0.6 + medianPercentile * 0.4;
    // Preserve the direct ownership proxy as a slate/team signal. Rank blend only adjusts the
    // construction leverage score; mutating the ownership proxy made market-signal diagnostics
    // non-monotonic when a profile's duplication penalty changed candidate ordering.
    candidate.heuristicLeverageScore = Math.max(0, 1 - chalkProxy);
    const duplicationRiskScore = candidate.heuristicDuplicationRiskScore ?? candidate.heuristicOwnershipProxy ?? 0;
    candidate.heuristicDuplicationRisk = duplicationRiskScore > 0.5 ? 'HIGH' : duplicationRiskScore > 0.25 ? 'MEDIUM' : 'LOW';
    candidate.heuristicDuplicationRiskScore = duplicationRiskScore;
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
function buildLineupOutcomeSamples(rosterSlots: Record<string, string>, input: OptimizerInput, projections: Map<string, OptimizerInput['projectionPackage']['players'][number]>): number[] {
  const rows = Object.entries(rosterSlots).map(([slot, id]) => ({ slot, projection: projections.get(id) })).filter((row): row is { slot: string; projection: NonNullable<typeof row.projection> } => Boolean(row.projection));
  const lengths = rows.map(({ projection }) => projection.simulatedFantasyPointSamples?.length || 256);
  const sampleCount = alignedSampleCount(lengths);
  const samples = Array.from({ length: sampleCount }, () => 0);
  for (const { slot, projection } of rows) {
    const values = projection.simulatedFantasyPointSamples?.length ? projection.simulatedFantasyPointSamples : syntheticSamples(projection.projectedOutcomes);
    const multiplier = input.validatedSlate.rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier;
    for (let index = 0; index < sampleCount; index += 1) samples[index] += scaledProjection(values[index % values.length], multiplier);
  }
  return samples;
}
function alignedSampleCount(lengths: number[]): number {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const lcm = (a: number, b: number): number => a / gcd(a, b) * b;
  let count = 1;
  for (const length of lengths) { count = lcm(count, Math.max(1, length)); if (count > 4096) return Math.min(4096, Math.max(256, ...lengths)); }
  return count;
}
function syntheticSamples(outcomes: { floorP20: number; medianP50: number; ceilingP90: number }): number[] {
  return Array.from({ length: 256 }, (_, index) => { const q = index / 255; if (q <= 0.5) return outcomes.floorP20 + (outcomes.medianP50 - outcomes.floorP20) * (q / 0.5); if (q <= 0.9) return outcomes.medianP50 + (outcomes.ceilingP90 - outcomes.medianP50) * ((q - 0.5) / 0.4); return outcomes.ceilingP90; });
}
function quantile(values: number[], q: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))] ?? 0; }
function rankCandidates(candidates: LineupCandidate[], maxCandidates: number): LineupCandidate[] { const byScore = (a: LineupCandidate, b: LineupCandidate) => heuristicScoreOf(b) - heuristicScoreOf(a) || a.id.localeCompare(b.id); const median = [...candidates].sort((a, b) => b.median - a.median || a.id.localeCompare(b.id)); const ceiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling || a.id.localeCompare(b.id)); const tournament = [...candidates].sort(byScore); return candidates.sort(byScore).slice(0, maxCandidates).map((candidate) => ({ ...candidate, medianRank: median.findIndex((item) => item.id === candidate.id) + 1, ceilingRank: ceiling.findIndex((item) => item.id === candidate.id) + 1, heuristicTournamentRank: tournament.findIndex((item) => item.id === candidate.id) + 1 })); }
function assignTypes(candidates: LineupCandidate[]): void {
  if (!candidates.length) return;
  const highestMedian = [...candidates].sort((a, b) => b.median - a.median)[0];
  const highestCeiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling)[0];
  const leverage = [...candidates].sort((a, b) => (b.heuristicLeverageScore ?? b.leverageScore ?? 0) - (a.heuristicLeverageScore ?? a.leverageScore ?? 0))[0];
  const lowDup = [...candidates].sort((a, b) => (a.heuristicDuplicationRiskScore ?? a.estimatedDuplicates ?? 0) - (b.heuristicDuplicationRiskScore ?? b.estimatedDuplicates ?? 0))[0];
  const alternateScript = [...candidates].filter((candidate) => candidate.gameScriptCluster !== highestMedian.gameScriptCluster).sort((a, b) => heuristicScoreOf(b) - heuristicScoreOf(a))[0];
  for (const candidate of candidates) {
    if (candidate.id === highestMedian.id) candidate.candidateTypes.push('HIGHEST_MEDIAN');
    if (candidate.id === highestCeiling.id) candidate.candidateTypes.push('HIGHEST_CEILING');
    if ((candidate.heuristicTournamentRank ?? candidate.tournamentRank) === 1) candidate.candidateTypes.push('HEURISTIC_TOURNAMENT_RANK');
    if (candidate.id === leverage.id) candidate.candidateTypes.push('LEVERAGE');
    if (candidate.id === lowDup.id) candidate.candidateTypes.push('LOW_DUPLICATION');
    if (alternateScript && candidate.id === alternateScript.id) candidate.candidateTypes.push('ALTERNATE_GAME_SCRIPT');
  }
}
function blocked(slate: ValidatedSlate, profile: ObjectiveProfile, now: Date, gaps: string[]): OptimizerPackage { return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: [], warnings: [], gaps, status: 'BLOCKED', engineState: 'MODEL_VALIDATION_REQUIRED' }; }
function heuristicScoreOf(candidate: LineupCandidate): number { return candidate.heuristicTournamentScore ?? candidate.optimalLineupFrequency ?? Number.NEGATIVE_INFINITY; }
function stableId(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32); }
