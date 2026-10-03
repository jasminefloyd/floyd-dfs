import type { LineupCandidate, PlayerProjection, SlatePlayer, ValidatedSlate } from './contracts.js';

export interface ContestSimulationOptions { simulations?: number; fieldEntries?: number; seed?: string; }
export interface ContestSimulationResult {
  status: 'COMPLETE' | 'UNAVAILABLE'; simulations: number; fieldEntries?: number;
  fieldModel: 'PROJECTED_OWNERSHIP' | 'UNAVAILABLE'; payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'UNAVAILABLE';
  reason?: string;
  metrics: Map<string, { variance: number; winFrequency: number; topOnePercentFrequency: number; cashFrequency: number; expectedDuplicates: number; expectedPayout?: number; roi?: number }>;
}

const MAX_FIELD_ENTRIES = 2_000;
const MAX_SIMULATIONS = 128;

/**
 * Build a separate field from the complete eligible player pool. This is an ownership-weighted
 * Monte Carlo approximation, not observed opponent entries and not a validated win probability.
 * It deliberately never samples the optimizer's candidate list as the opponent field.
 */
export function simulateContestField(slate: ValidatedSlate, candidates: LineupCandidate[], options: ContestSimulationOptions = {}, projections: PlayerProjection[] = []): ContestSimulationResult {
  const contestSize = slate.contest.contestSize;
  if (!contestSize || contestSize < 2 || contestSize > MAX_FIELD_ENTRIES + 1) return unavailable(`Independent field simulation supports contest sizes from 2 to ${MAX_FIELD_ENTRIES + 1}; received ${contestSize ?? 'unknown'}.`);
  if (!slate.contest.paidPositions || slate.contest.paidPositions < 1 || slate.contest.paidPositions >= contestSize) return unavailable('Paid-position count is required to estimate contest finish frequencies.');
  const paidPositions = slate.contest.paidPositions;
  const simulations = clampInteger(options.simulations ?? 64, 16, MAX_SIMULATIONS);
  const fieldEntries = Math.min(options.fieldEntries ?? contestSize - 1, contestSize - 1);
  if (fieldEntries !== contestSize - 1) return unavailable('Partial-field sampling is disabled; the contest size cannot be represented by the requested field sample.');
  const playerProjection = new Map(projections.map((projection) => [projection.playerId, projection]));
  const ownershipGaps = slate.playerPool.flatMap((player) => Object.entries(slate.rosterRules.slots).filter(([slot]) => player.eligibility[slot] && !validProviderOwnership(player, slot)).map(() => player.playerName));
  if (ownershipGaps.length) return unavailable(`Provider ownership is missing or invalid for ${new Set(ownershipGaps).size}/${slate.playerPool.length} players in eligible roster slots; ownership-weighted field results would be biased.`);
  const missingSamples = slate.playerPool.filter((player) => playerHasPositiveOwnership(player) && !playerProjection.get(player.playerId)?.simulatedFantasyPointSamples?.length).map((player) => player.playerName);
  if (missingSamples.length) return unavailable(`Player outcome samples are missing for ownership-weighted field players: ${missingSamples.slice(0, 8).join(', ')}${missingSamples.length > 8 ? ', and others' : ''}.`);
  const field: string[][] = [];
  let state = hash(options.seed ?? `${slate.slateId}:${slate.contest.draftKingsContestId}`);
  const random = () => { state = next(state); return state / 0x1_0000_0000; };
  for (let index = 0; index < fieldEntries; index += 1) {
    const lineup = sampleLegalLineup(slate, random);
    if (!lineup) return unavailable(`Could not construct legal ownership-weighted opponent lineup ${index + 1}/${fieldEntries}; the field model is incomplete.`);
    field.push(lineup);
  }

  const metrics = new Map<string, ContestSimulationResult['metrics'] extends Map<string, infer T> ? T : never>();
  const payoutByRank = new Map((slate.contest.payoutStructure ?? []).map((entry) => [entry.rank, entry.payout]));
  const payoutComplete = Array.from({ length: paidPositions }, (_, index) => index + 1).every((rank) => payoutByRank.has(rank)) && slate.contest.entryFee !== undefined && slate.contest.entryFee > 0;
  const topOnePercentCount = Math.max(1, Math.ceil(contestSize * 0.01));
  for (const candidate of candidates) {
    const samples = candidate.simulatedScoreSamples;
    if (!samples?.length || samples.some((score) => !Number.isFinite(score))) continue;
    const outcomes: number[] = []; let wins = 0; let topOne = 0; let cash = 0; let duplicateTotal = 0; let payoutTotal = 0;
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      const sampleIndex = simulation % samples.length;
      const candidateScore = samples[sampleIndex];
      const opponentScores = field.map((lineup) => lineup.reduce((sum, playerId) => sum + (playerProjection.get(playerId)?.simulatedFantasyPointSamples?.[sampleIndex % (playerProjection.get(playerId)?.simulatedFantasyPointSamples?.length ?? 1)] ?? 0), 0));
      const tiedAhead = opponentScores.filter((score) => score > candidateScore).length;
      const tiedIncluding = opponentScores.filter((score) => score === candidateScore).length;
      const rank = tiedAhead + 1;
      outcomes.push(candidateScore);
      if (rank === 1) wins += tiedIncluding ? 1 / (tiedIncluding + 1) : 1;
      if (rank <= topOnePercentCount) topOne += 1;
      if (rank <= paidPositions) cash += 1;
      duplicateTotal += field.filter((lineup) => sameLineup(lineup, candidate.playerIds)).length;
      if (payoutComplete) {
        const tiedRanks = Array.from({ length: tiedIncluding + 1 }, (_, offset) => rank + offset).filter((place) => place <= paidPositions);
        payoutTotal += tiedRanks.length ? tiedRanks.reduce((sum, place) => sum + (payoutByRank.get(place) ?? 0), 0) / tiedRanks.length : 0;
      }
    }
    const average = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
    const variance = outcomes.reduce((sum, value) => sum + (value - average) ** 2, 0) / outcomes.length;
    const expectedPayout = payoutComplete ? payoutTotal / simulations : undefined;
    metrics.set(candidate.id, { variance, winFrequency: wins / simulations, topOnePercentFrequency: topOne / simulations, cashFrequency: cash / simulations, expectedDuplicates: duplicateTotal / simulations, ...(expectedPayout !== undefined ? { expectedPayout, roi: (expectedPayout - slate.contest.entryFee!) / slate.contest.entryFee! } : {}) });
  }
  if (metrics.size !== candidates.length) return unavailable('One or more optimizer candidates lack joint outcome samples; field metrics were withheld.');
  return { status: 'COMPLETE', simulations, fieldEntries, fieldModel: 'PROJECTED_OWNERSHIP', payoutModel: payoutComplete ? 'CONTEST_PAYOUT_STRUCTURE' : 'UNAVAILABLE', ...(!payoutComplete ? { reason: 'Field finish frequencies are ownership-weighted estimates; ROI and payout estimates are unavailable because complete payout ranks or entry fee are missing.' } : {}), metrics };
}

function sampleLegalLineup(slate: ValidatedSlate, random: () => number): string[] | undefined {
  const slots = Object.entries(slate.rosterRules.slots).flatMap(([slot, rule]) => Array.from({ length: rule.count }, (_, index) => rule.count > 1 ? `${slot}_${index + 1}` : slot));
  const players = slate.playerPool.filter((player) => !['OUT', 'INACTIVE', 'NOT_IN_CONFIRMED_LINEUP', 'NOT_IN_PROVIDER_ROSTER'].includes(player.availability?.status ?? '') && !/^(IL|IR| injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim()));
  const salaryFor = (player: SlatePlayer, slot: string): number | undefined => {
    const base = slot.replace(/_\d+$/, ''); const rule = slate.rosterRules.slots[base];
    if (/CPT|CAPTAIN/i.test(base)) return player.captainSalary ?? (rule?.salaryMultiplier ? player.salary * rule.salaryMultiplier : undefined);
    if (base.toUpperCase() === 'UTIL' && player.utilitySalary !== undefined) return player.utilitySalary;
    return player.salary * (rule?.salaryMultiplier ?? 1);
  };
  const ownershipFor = (player: SlatePlayer, slot: string): number => {
    const ownership = player.projectedOwnership;
    if (!ownership || ownership.source !== 'PROVIDER') return -1;
    const base = slot.replace(/_\d+$/, '').toUpperCase();
    const value = base.includes('CPT') || base.includes('CAPTAIN') ? ownership.captain : base === 'UTIL' ? ownership.utility ?? ownership.classic : ownership.classic;
    return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1 ? value : -1;
  };
  // Constrained positions first makes weighted backtracking more reliable and repeatable.
  slots.sort((a, b) => players.filter((player) => player.eligibility[b.replace(/_\d+$/, '')] && ownershipFor(player, b) > 0).length - players.filter((player) => player.eligibility[a.replace(/_\d+$/, '')] && ownershipFor(player, a) > 0).length);
  const chosen: Record<string, string> = {}; const used = new Set<string>();
  const search = (index: number, salary: number): boolean => {
    if (index === slots.length) {
      const teams = new Set(Object.values(chosen).map((id) => players.find((player) => player.playerId === id)?.team).filter(Boolean));
      return (!slate.rosterRules.teamConstraints?.minimumTeams || teams.size >= slate.rosterRules.teamConstraints.minimumTeams);
    }
    const slot = slots[index]; const base = slot.replace(/_\d+$/, '');
    const maxTeam = slate.rosterRules.teamConstraints?.maximumPlayersPerTeam;
    const pool = players.flatMap((player) => {
      const weight = ownershipFor(player, slot); const cost = salaryFor(player, base);
      if (weight <= 0 || !player.eligibility[base] || cost === undefined || salary + cost > slate.salaryCap || (slate.rosterRules.uniquePlayersRequired && used.has(player.playerId))) return [];
      if (maxTeam && player.team && Object.values(chosen).filter((id) => players.find((entry) => entry.playerId === id)?.team === player.team).length >= maxTeam) return [];
      return [{ player, weight, cost }];
    }).sort((a, b) => b.weight - a.weight);
    // Randomized weighted ordering with backtracking preserves ownership preference without
    // letting a high-owned player make all downstream salary/eligibility combinations fail.
    const ordered: typeof pool = []; const remaining = [...pool];
    while (remaining.length) {
      const total = remaining.reduce((sum, item) => sum + item.weight, 0); let draw = random() * total;
      let selected = remaining.findIndex((item) => (draw -= item.weight) <= 0);
      if (selected < 0) selected = remaining.length - 1;
      ordered.push(remaining.splice(selected, 1)[0]);
    }
    for (const item of ordered) {
      chosen[slot] = item.player.playerId; used.add(item.player.playerId);
      if (search(index + 1, salary + item.cost)) return true;
      delete chosen[slot]; used.delete(item.player.playerId);
    }
    return false;
  };
  return search(0, 0) ? Object.values(chosen) : undefined;
}

function playerHasPositiveOwnership(player: SlatePlayer): boolean {
  return Object.keys(player.eligibility).some((slot) => validProviderOwnership(player, slot) && (ownershipValue(player, slot) ?? 0) > 0);
}
function ownershipValue(player: SlatePlayer, slot: string): number | undefined { const ownership = player.projectedOwnership; if (!ownership || ownership.source !== 'PROVIDER') return undefined; const base = slot.replace(/_\d+$/, '').toUpperCase(); return base.includes('CPT') || base.includes('CAPTAIN') ? ownership.captain : base === 'UTIL' ? ownership.utility ?? ownership.classic : ownership.classic; }
function validProviderOwnership(player: SlatePlayer, slot: string): boolean { const value = ownershipValue(player, slot); return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1; }
function sameLineup(a: string[], b: string[]): boolean { return a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]); }
function clampInteger(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.floor(Number.isFinite(value) ? value : minimum))); }
function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; }
function next(value: number): number { let result = value; result ^= result << 13; result ^= result >>> 17; result ^= result << 5; return result >>> 0; }
function unavailable(reason: string): ContestSimulationResult { return { status: 'UNAVAILABLE', simulations: 0, fieldModel: 'UNAVAILABLE', payoutModel: 'UNAVAILABLE', reason, metrics: new Map() }; }
