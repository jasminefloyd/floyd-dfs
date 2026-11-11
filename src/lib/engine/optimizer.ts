import { bestShowdownLineup, buildShowdownField, evaluateShowdownTournament, showdownLineupKey } from './showdownTournament.js';
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
import { validateLineupCandidate } from './validation.js';
import { simulateContestField } from './contestSimulation.js';

const DEFAULT_PROFILE: ObjectiveProfile = { name: 'balanced-tournament', medianWeight: 0.35, ceilingWeight: 0.35, leverageWeight: 0.15, duplicationPenalty: 0.1, correlationWeight: 0.05 };
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
  objectiveProfile?: ObjectiveProfile;
  /** The UI's "Objective" selector value (max_fpts/tournament/balanced_ev/safe). Takes priority
   * over the automatic contest-size profile below when recognized; falls through otherwise. */
  lineupMode?: string;
  /** A hard salary-floor constraint (e.g. from the UI's "min salary used" setting) enforced
   * during enumeration -- never fabricated, only applied when the caller actually supplies it. */
  minSalaryUsed?: number;
  portfolioConstraints?: PortfolioConstraints;
}

export function optimizeLineups(input: OptimizerInput, options: OptimizerOptions = {}, now = new Date()): OptimizerPackage {
  const contest = input.validatedSlate.contest;
  const profile = options.objectiveProfile ?? (options.lineupMode ? OBJECTIVE_PROFILE_BY_LINEUP_MODE[options.lineupMode] : undefined) ?? objectiveProfileForContest({ contestSize: contest.contestSize, userEntryCount: contest.userEntryCount, maxEntriesAllowed: contest.maxEntriesAllowed, format: input.validatedSlate.contest.format });
  const maxCandidates = options.maxCandidates ?? 500;
  const minSalaryUsed = options.minSalaryUsed ?? 0;
  const warnings = [...input.validatedSlate.validation.warnings];
  if (contest.contestSize === undefined) warnings.push('contest.contestSize is unavailable; optimizer used the configured fallback objective profile.');
  if (input.projectionPackage.status === 'BLOCKED') {
    const projectionReasons = input.projectionPackage.gaps.map((gap) => gap.reason).filter(Boolean).slice(0, 4);
    return blocked(input.validatedSlate, profile, now, ['ProjectionPackage is BLOCKED; no legal lineup can be evaluated.', ...projectionReasons]);
  }

  const projectionByPlayer = new Map(input.projectionPackage.players.map((player) => [player.playerId, player]));
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
  const workingInput: OptimizerInput = { ...input, validatedSlate: { ...input.validatedSlate, playerPool: input.validatedSlate.playerPool.filter((player) => projectionByPlayer.has(player.playerId) && !isExplicitlyUnavailable(player) && !excludedIds.has(player.playerId)) } };

  const slots = slotOrder(workingInput.validatedSlate.rosterRules.slots);
  if (!slots.length) return blocked(input.validatedSlate, profile, now, ['No roster slots are available.']);
  // Exact top-K branch-and-bound over the objective's per-player linear value. The previous
  // depth-first search kept the first N legal lineups it reached in value order, which locked the
  // top player into every early slot and filled the rest with minimum-salary punts; on realistic
  // NBA main slates that left ~20+ expected points per lineup unexplored. This search instead
  // proves which lineups are best: a branch is abandoned only when a valid upper bound (a
  // Lagrangian relaxation of the salary cap) shows it cannot beat the K-th best lineup found.
  // For MAX_FPTS the linear value is exactly lineup expected points, so a completed search is the
  // proven optimum. Other profiles rank by a linear surrogate (weighted mean/median/ceiling) and
  // every candidate is then rescored on the full lineup distribution below.
  const linearValue = (player: SlatePlayer) => { const projection = projectionByPlayer.get(player.playerId); if (!projection) return 0; return playerMean(projection) * (profile.meanWeight ?? 0) + projection.projectedOutcomes.medianP50 * profile.medianWeight + projection.projectedOutcomes.ceilingP90 * profile.ceilingWeight; };
  const linearObjective = (profile.meanWeight ?? 0) > 0 && profile.medianWeight === 0 && profile.ceilingWeight === 0 && profile.leverageWeight === 0 && profile.correlationWeight === 0;
  // Proving the K-th best lineup costs far more than proving the best one, so size K to what
  // selection needs (the requested entries plus room for overlap/diversity rules) unless the
  // caller asked for a specific candidate count.
  const searchK = options.maxCandidates ?? Math.min(maxCandidates, Math.max(60, 10 * Math.max(1, contest.userEntryCount)));
  const search = searchTopLineups(slots, workingInput.validatedSlate, linearValue, { topK: searchK, minSalaryUsed, nodeBudget: 2_500_000 });
  const generated = search.lineups;
  if (!generated.length) return blocked(input.validatedSlate, profile, now, minSalaryUsed ? ['No legal lineups satisfy roster eligibility, salary cap, team constraints, and the minimum salary used.'] : ['No legal lineups satisfy roster eligibility, salary cap, and team constraints.']);
  // EXHAUSTIVE means the reported candidates are provably the best for the optimized quantity:
  // either every legal lineup was enumerated, or the objective is linear and the bounded search
  // completed. A surrogate-ranked search that completed is still reported as BOUNDED.
  const exhaustive = search.completed && (search.enumeratedAll || linearObjective);
  if (!search.completed) warnings.push(`Lineup search reached its ${search.nodesVisited.toLocaleString('en-US')}-node budget before proving optimality; the best lineups found are reported, but a better legal lineup may exist.`);
  else if (search.enumeratedAll) warnings.push(`Exhaustive legal lineup enumeration completed (${generated.length} candidates).`);
  else if (linearObjective) warnings.push(`Branch-and-bound search proved these are the ${generated.length} highest expected-point legal lineups (${search.nodesVisited.toLocaleString('en-US')} nodes).`);
  else warnings.push(`Branch-and-bound search proved the top ${generated.length} lineups by the profile's linear player value; final ranking uses the full lineup distribution, which that bound does not cover.`);

  const marketAverages = slateMarketAverages(workingInput.validatedSlate.playerPool);
  const invalidGenerated = generated.flatMap((lineup) => validateLineupCandidate({ playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed }, workingInput.validatedSlate));
  if (invalidGenerated.length) return blocked(input.validatedSlate, profile, now, invalidGenerated);
  const scored = generated.map((lineup) => scoreCandidate(lineup, workingInput, projectionByPlayer, profile, marketAverages));
  // Showdown tournaments: rank by expected payout against a simulated field, which accounts for
  // duplicate lineups. Max-points and cash/safe objectives keep their own ranking.
  const showdownTournament = workingInput.validatedSlate.contest.format === 'SHOWDOWN' && profile !== MAX_FPTS_PROFILE && profile !== SMALL_FIELD_PROFILE
    ? runShowdownTournamentModel(workingInput, projectionByPlayer, slots, scored, profile, marketAverages, warnings)
    : undefined;
  // Score and simulate the full legal search result before truncating the candidate report. This
  // prevents a deterministic pre-sort from silently excluding a lineup that wins in the contest
  // model. The final report is still bounded by maxCandidates for storage/UI consumption.
  const allRanked = rankCandidates(scored, scored.length);
  applyFieldHeuristic(allRanked); // must run before field simulation, which weights construction
  const contestSimulation = simulateContestField(input.validatedSlate, allRanked, { seed: `${input.validatedSlate.slateId}:${input.validatedSlate.contest.draftKingsContestId}` }, input.projectionPackage.players);
  applyContestMetrics(allRanked, contestSimulation);
  // Guardrail: the field is modeled, not observed, so a lineup may trade away at most 3% (and
  // at least 6 points) of the best projected score to avoid duplicates. Lineups outside that
  // window keep their metrics but rank after every lineup inside it.
  const bestMean = Math.max(...allRanked.map((candidate) => candidate.expectedPoints ?? -Infinity));
  const tournamentFloor = bestMean - Math.max(SHOWDOWN_MIN_POINT_WINDOW, SHOWDOWN_POINT_WINDOW_SHARE * bestMean);
  if (showdownTournament) for (const candidate of allRanked) {
    const metrics = showdownTournament.metrics.get(candidate.id);
    if (!metrics) continue;
    const insideWindow = (candidate.expectedPoints ?? -Infinity) >= tournamentFloor;
    const fee = workingInput.validatedSlate.contest.entryFee;
    Object.assign(candidate, { expectedDuplicates: metrics.expectedDuplicates, winFrequency: metrics.winFrequency, topOnePercentFrequency: metrics.topOnePercentFrequency, cashFrequency: metrics.cashFrequency, roi: metrics.roi, ...(fee ? { expectedPayout: metrics.expectedPayoutMultiple * fee } : {}), heuristicTournamentScore: insideWindow ? metrics.expectedPayoutMultiple : metrics.expectedPayoutMultiple - 1_000, contestMetricProvenance: 'SHOWDOWN_FIELD_MODEL' });
  }
  if (showdownTournament) warnings.push(`Showdown tournament ranking kept lineups within ${(bestMean - tournamentFloor).toFixed(1)} points of the best projected score (${bestMean.toFixed(1)}) ahead of all others.`);
  if (showdownTournament) rankCandidates(allRanked, allRanked.length);
  const ranked = rankCandidates(allRanked, maxCandidates);
  const cashLineEstimate = computeCashLineEstimate(input.validatedSlate);
  if (cashLineEstimate) for (const candidate of ranked) candidate.cashLineProbability = rawCashLineProbability({ median: candidate.median, floor: candidate.floor, ceiling: candidate.ceiling, cashLine: cashLineEstimate.value }) ?? undefined;
  applyStrategicSimilarity(ranked);
  assignTypes(ranked);
  if (contestSimulation.status === 'UNAVAILABLE') warnings.push(`Contest simulation unavailable: ${contestSimulation.reason}`);
  return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: input.validatedSlate.sport, version: 1, generatedAt: now.toISOString(), objectiveProfile: profile, candidates: ranked, warnings, gaps: input.projectionPackage.gaps.map((gap) => gap.reason), status: input.projectionPackage.status === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE', engineState: 'MODEL_VALIDATION_REQUIRED', searchCompleteness: exhaustive ? 'EXHAUSTIVE' : 'BOUNDED', ...(exhaustive ? { optimalityGap: 0 } : {}), ...(options.portfolioConstraints ? { portfolioConstraints: options.portfolioConstraints } : {}), contestSimulation: { status: contestSimulation.status, simulations: contestSimulation.simulations, fieldEntries: contestSimulation.fieldEntries, fieldModel: contestSimulation.fieldModel, payoutModel: contestSimulation.payoutModel, reason: contestSimulation.reason }, ...(cashLineEstimate ? { cashLineEstimate } : {}) };
}

const SHOWDOWN_POINT_WINDOW_SHARE = 0.03;
const SHOWDOWN_MIN_POINT_WINDOW = 6;
function runShowdownTournamentModel(input: OptimizerInput, projectionByPlayer: Map<string, OptimizerInput['projectionPackage']['players'][number]>, slots: string[], scored: LineupCandidate[], profile: ObjectiveProfile, marketAverages: ReturnType<typeof slateMarketAverages>, warnings: string[]) {
  const slate = input.validatedSlate;
  const means = new Map(slate.playerPool.flatMap((player) => { const projection = projectionByPlayer.get(player.playerId); return projection ? [[player.playerId, playerMean(projection)] as const] : []; }));
  const captainSlot = slots.find((slot) => /^(CPT|CAPTAIN|MVP)/i.test(baseSlot(slot)));
  const utilitySlots = slots.filter((slot) => slot !== captainSlot);
  const standardShowdown = Boolean(captainSlot) && utilitySlots.every((slot) => baseSlot(slot) === 'UTIL') && !slate.rosterRules.teamConstraints?.maximumPlayersPerTeam;
  const captainRule = captainSlot ? slate.rosterRules.slots[baseSlot(captainSlot)] : undefined;
  const solverPlayers = slate.playerPool.flatMap((player) => {
    const captainSalary = captainSlot ? salaryForSlot(player, baseSlot(captainSlot), captainRule) : undefined;
    const utilitySalary = salaryForSlot(player, 'UTIL', slate.rosterRules.slots.UTIL);
    return means.has(player.playerId) && player.eligibility.CPT !== false && player.eligibility.UTIL && captainSalary !== undefined && utilitySalary !== undefined ? [{ playerId: player.playerId, team: player.team, captainSalary, utilitySalary }] : [];
  });
  const findBest = standardShowdown
    ? (value: (playerId: string) => number) => bestShowdownLineup(solverPlayers, value, { salaryCap: slate.salaryCap, captainSlot: captainSlot!, utilitySlots, minimumTeams: slate.rosterRules.teamConstraints?.minimumTeams, captainMultiplier: captainRule?.fantasyMultiplier ?? 1.5 })
    : (value: (playerId: string) => number) => searchTopLineups(slots, slate, (player) => value(player.playerId), { topK: 1, minSalaryUsed: 0, nodeBudget: 300_000 }).lineups[0];
  const opponents = Math.max(200, Math.min(3000, (slate.contest.contestSize ?? 1000) - 1));
  const field = buildShowdownField(means, findBest, `${slate.slateId}:${slate.contest.draftKingsContestId}:field`, opponents);
  if (!field.simulatedOpponents) { warnings.push('Showdown tournament model could not build a simulated field; lineups ranked by the profile heuristic.'); return undefined; }
  // Popular field lineups are strong lineups too; add the ones the search did not return so the
  // ranking compares chalk against lower-duplicate alternatives on equal terms.
  const known = new Set(scored.map((candidate) => showdownLineupKey(candidate.rosterSlots)));
  for (const lineup of field.lineups) {
    if (known.has(lineup.key) || validateLineupCandidate({ playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed }, slate).length) continue;
    known.add(lineup.key);
    scored.push(scoreCandidate(lineup, input, projectionByPlayer, profile, marketAverages));
  }
  const contestSize = slate.contest.contestSize;
  if (!contestSize) warnings.push('Contest size is unknown; the Showdown tournament model assumed 1,000 entries.');
  const result = evaluateShowdownTournament(slate, scored, field, (rosterSlots) => buildLineupOutcomeSamples(rosterSlots, input, projectionByPlayer), contestSize ?? 1000);
  if (!result) { warnings.push('Showdown tournament model was unavailable (missing outcome samples); lineups ranked by the profile heuristic.'); return undefined; }
  const chalk = [...field.lineups].sort((a, b) => b.copies - a.copies)[0];
  warnings.push(`Showdown tournament model: ranked ${result.metrics.size} lineups by expected payout against ${result.simulatedOpponents} simulated opponents scaled to ${result.contestSize.toLocaleString('en-US')} entries (${result.payoutModel === 'CONTEST_PAYOUT_STRUCTURE' ? 'contest payout table' : `approximate payout curve, ${result.paidPositions.toLocaleString('en-US')} paid`}). The most popular simulated lineup appears about ${Math.round(chalk.copies * (result.contestSize - 1) / result.simulatedOpponents)} times. Field mix and payouts are provisional estimates, not observed entries.`);
  return result;
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

interface SearchOptions { topK: number; minSalaryUsed: number; nodeBudget: number; }
interface SearchResult { lineups: Array<{ rosterSlots: Record<string, string>; salaryUsed: number }>; completed: boolean; enumeratedAll: boolean; nodesVisited: number; }

// Exact top-K lineup search (branch and bound).
// - Slots are filled most-constrained first; each slot tries players in descending value.
// - Upper bound for the unfilled slots, valid for every lambda >= 0:
//     sum(v) = sum(v - lambda*s) + lambda*sum(s) <= sum_j max_p(v_pj - lambda*s_pj) + lambda*budget
//   The per-slot maxima ignore uniqueness, teams and the cap, so they only relax the problem,
//   and the minimum over a grid of lambdas is still a valid bound. A branch is pruned only when
//   that bound cannot beat the K-th best distinct lineup found so far.
// - Lineups that are the same players in permuted slots of equal value are kept once.
export function searchTopLineups(slotNames: string[], slate: ValidatedSlate, valueOf: (player: SlatePlayer) => number, options: SearchOptions): SearchResult {
  const { salaryCap, rosterRules } = slate;
  const topK = Math.max(1, options.topK);
  const maxPerTeam = rosterRules.teamConstraints?.maximumPlayersPerTeam;
  const minimumTeams = rosterRules.teamConstraints?.minimumTeams;
  const unique = rosterRules.uniquePlayersRequired;
  type Option = { player: SlatePlayer; salary: number; value: number };
  const slotOptions = slotNames.map((slot) => {
    const ruleSlot = baseSlot(slot);
    const rule = rosterRules.slots[ruleSlot];
    const multiplier = rule?.fantasyMultiplier ?? 1;
    return slate.playerPool.flatMap((player): Option[] => {
      if (!player.eligibility[ruleSlot]) return [];
      const salary = salaryForSlot(player, ruleSlot, rule);
      if (salary === undefined || !Number.isFinite(salary)) return [];
      return [{ player, salary, value: valueOf(player) * multiplier }];
    // Stable sort: equal-value players keep slate order, matching the previous search's tie order.
    }).sort((a, b) => b.value - a.value);
  });
  // Most constrained slot first keeps branching low at the top of the tree.
  const order = slotNames.map((_, index) => index).sort((a, b) => slotOptions[a].length - slotOptions[b].length);
  const slots = order.map((index) => slotNames[index]);
  const options_ = order.map((index) => slotOptions[index]);
  const multiplierKey = slots.map((slot) => rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier ?? 1);
  const n = slots.length;
  if (options_.some((list) => !list.length)) return { lineups: [], completed: true, enumeratedAll: true, nodesVisited: 0 };

  const minCostSuffix = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j -= 1) minCostSuffix[j] = minCostSuffix[j + 1] + Math.min(...options_[j].map((option) => option.salary));
  const maxValuePerDollar = Math.max(0, ...options_.flatMap((list) => list.map((option) => option.salary > 0 ? option.value / option.salary : 0)));
  const lambdas = Array.from({ length: 25 }, (_, index) => maxValuePerDollar * index / 24);
  // suffix[j][k] = sum over slots j..n-1 of max_p(value - lambda_k * salary)
  const suffix = Array.from({ length: n + 1 }, () => new Array<number>(lambdas.length).fill(0));
  for (let j = n - 1; j >= 0; j -= 1) for (let k = 0; k < lambdas.length; k += 1) {
    let best = -Infinity;
    for (const option of options_[j]) { const reduced = option.value - lambdas[k] * option.salary; if (reduced > best) best = reduced; }
    suffix[j][k] = suffix[j + 1][k] + best;
  }
  const upperBound = (from: number, budget: number) => { let bound = Infinity; for (let k = 0; k < lambdas.length; k += 1) { const candidate = suffix[from][k] + lambdas[k] * budget; if (candidate < bound) bound = candidate; } return bound; };

  // Kept sorted descending by value; threshold is the K-th best value once full.
  const best: Array<{ value: number; key: string; rosterSlots: Record<string, string>; salaryUsed: number }> = [];
  const seen = new Set<string>();
  const epsilon = 1e-9;
  const threshold = () => best.length >= topK ? best[best.length - 1].value : -Infinity;
  let visited = 0; let enumeratedAll = true; let completed = true;
  const chosen: Option[] = new Array(n);
  const used = new Set<string>();
  const teamCounts = new Map<string, number>();

  const record = (value: number, salaryUsed: number) => {
    if (minimumTeams && teamCounts.size < minimumTeams) return;
    if (options.minSalaryUsed && salaryUsed < options.minSalaryUsed) return;
    const key = chosen.map((option, index) => `${multiplierKey[index]}:${option.player.playerId}`).sort().join('|');
    if (seen.has(key)) return;
    if (best.length >= topK && value <= threshold() + epsilon) { enumeratedAll = false; return; }
    const rosterSlots: Record<string, string> = {};
    for (let index = 0; index < n; index += 1) rosterSlots[slots[index]] = chosen[index].player.playerId;
    let position = best.length;
    while (position > 0 && best[position - 1].value < value) position -= 1;
    best.splice(position, 0, { value, key, rosterSlots, salaryUsed });
    seen.add(key);
    if (best.length > topK) { const removed = best.pop()!; seen.delete(removed.key); enumeratedAll = false; }
  };

  const visit = (depth: number, value: number, salaryUsed: number): void => {
    if (!completed) return;
    if (++visited > options.nodeBudget) { completed = false; return; }
    if (depth === n) { record(value, salaryUsed); return; }
    const budget = salaryCap - salaryUsed;
    for (const option of options_[depth]) {
      if (option.salary + minCostSuffix[depth + 1] > budget) continue;
      if (unique && used.has(option.player.playerId)) continue;
      const team = option.player.team;
      if (maxPerTeam && team && (teamCounts.get(team) ?? 0) >= maxPerTeam) continue;
      if (best.length >= topK) {
        const floor = threshold() + epsilon;
        // lambda = 0 bound ignores salary; options are value-sorted, so once it fails every later
        // option at this slot fails too.
        if (value + option.value + suffix[depth + 1][0] <= floor) { enumeratedAll = false; break; }
        if (value + option.value + upperBound(depth + 1, budget - option.salary) <= floor) { enumeratedAll = false; continue; }
      }
      chosen[depth] = option; used.add(option.player.playerId);
      if (team) teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
      visit(depth + 1, value + option.value, salaryUsed + option.salary);
      used.delete(option.player.playerId);
      if (team) { const count = (teamCounts.get(team) ?? 1) - 1; if (count) teamCounts.set(team, count); else teamCounts.delete(team); }
      if (!completed) return;
    }
  };
  visit(0, 0, 0);
  return { lineups: best.map(({ rosterSlots, salaryUsed }) => ({ rosterSlots, salaryUsed })), completed, enumeratedAll: completed && enumeratedAll, nodesVisited: Math.min(visited, options.nodeBudget) };
}

function salaryForSlot(player: { salary: number; captainSalary?: number; utilitySalary?: number }, slot: string, rule?: { salaryMultiplier?: number }): number | undefined {
  if (slot.toUpperCase().includes('CPT') || slot.toUpperCase().includes('CAPTAIN')) return player.captainSalary ?? (rule?.salaryMultiplier ? player.salary * rule.salaryMultiplier : undefined);
  if (slot.toUpperCase() === 'UTIL' && player.utilitySalary !== undefined) return player.utilitySalary;
  return player.salary * (rule?.salaryMultiplier ?? 1);
}

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
  const expectedPoints = meanOf(lineupOutcomeSamples, median);
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
  const objective = expectedPoints * (profile.meanWeight ?? 0) + median * profile.medianWeight + ceiling * profile.ceilingWeight + leverageScore * profile.leverageWeight + correlationScore * profile.correlationWeight;
  const id = stableId(JSON.stringify(lineup.rosterSlots));
  const dominantTeam = [...teamCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const gameScriptCluster = teamCounts.size > 1 ? (dominantTeam ? `MULTI_TEAM_${dominantTeam}_LEAN` : 'MULTI_TEAM') : (dominantTeam ? `${dominantTeam}_HEAVY` : 'SINGLE_TEAM_OR_UNKNOWN');
  const heuristicDuplicationRisk = ownershipEstimate > 0.5 ? 'HIGH' : ownershipEstimate > 0.25 ? 'MEDIUM' : 'LOW';
  return { id, playerIds: Object.values(lineup.rosterSlots), rosterSlots: lineup.rosterSlots, salaryUsed: lineup.salaryUsed, salaryRemaining: input.validatedSlate.salaryCap - lineup.salaryUsed, floor, expectedPoints, median, ceiling, correlationScore, simulatedScoreSamples: lineupOutcomeSamples, heuristicTournamentScore: objective, heuristicOwnershipProxy: ownershipEstimate, heuristicLeverageScore: leverageScore, heuristicDuplicationRisk, heuristicDuplicationRiskScore: ownershipEstimate, medianRank: 0, ceilingRank: 0, heuristicTournamentRank: 0, candidateTypes: [], gameScriptCluster, strategicSimilarity: 0, riskFlags: players.flatMap((player) => player.uncertaintyFactors) };
}

// Mean of the same per-player distribution scoreCandidate sums, so the search value and the
// scored lineup expectation agree exactly (including synthetic samples when none were stored).
function playerMean(projection: OptimizerInput['projectionPackage']['players'][number]): number { const values = projection.simulatedFantasyPointSamples?.length ? projection.simulatedFantasyPointSamples : syntheticSamples(projection.projectedOutcomes); return meanOf(values, projection.projectedOutcomes.medianP50); }
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
    candidate.heuristicOwnershipProxy = Math.max(0, Math.min(1, chalkProxy));
    candidate.heuristicLeverageScore = Math.max(0, 1 - (candidate.heuristicOwnershipProxy ?? 0));
    candidate.heuristicDuplicationRisk = (candidate.heuristicOwnershipProxy ?? 0) > 0.5 ? 'HIGH' : (candidate.heuristicOwnershipProxy ?? 0) > 0.25 ? 'MEDIUM' : 'LOW';
    candidate.heuristicDuplicationRiskScore = candidate.heuristicOwnershipProxy ?? 0;
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
  const sampleCount = Math.max(1, ...rows.map(({ projection }) => projection.simulatedFantasyPointSamples?.length ?? 256));
  const samples = Array.from({ length: sampleCount }, () => 0);
  for (const { slot, projection } of rows) {
    const values = projection.simulatedFantasyPointSamples?.length ? projection.simulatedFantasyPointSamples : syntheticSamples(projection.projectedOutcomes);
    const multiplier = input.validatedSlate.rosterRules.slots[baseSlot(slot)]?.fantasyMultiplier;
    for (let index = 0; index < sampleCount; index += 1) samples[index] += scaledProjection(values[index % values.length], multiplier);
  }
  return samples;
}
function syntheticSamples(outcomes: { floorP20: number; medianP50: number; ceilingP90: number }): number[] {
  return Array.from({ length: 256 }, (_, index) => { const q = index / 255; if (q <= 0.5) return outcomes.floorP20 + (outcomes.medianP50 - outcomes.floorP20) * (q / 0.5); if (q <= 0.9) return outcomes.medianP50 + (outcomes.ceilingP90 - outcomes.medianP50) * ((q - 0.5) / 0.4); return outcomes.ceilingP90; });
}
function quantile(values: number[], q: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))] ?? 0; }
function rankCandidates(candidates: LineupCandidate[], maxCandidates: number): LineupCandidate[] { const median = [...candidates].sort((a, b) => b.median - a.median); const ceiling = [...candidates].sort((a, b) => b.ceiling - a.ceiling); const tournament = [...candidates].sort((a, b) => heuristicScoreOf(b) - heuristicScoreOf(a)); return candidates.sort((a, b) => heuristicScoreOf(b) - heuristicScoreOf(a)).slice(0, maxCandidates).map((candidate) => ({ ...candidate, medianRank: median.findIndex((item) => item.id === candidate.id) + 1, ceilingRank: ceiling.findIndex((item) => item.id === candidate.id) + 1, heuristicTournamentRank: tournament.findIndex((item) => item.id === candidate.id) + 1 })); }
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
