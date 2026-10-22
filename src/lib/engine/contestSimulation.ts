import type { LineupCandidate, PlayerProjection, SlatePlayer, ValidatedSlate } from './contracts.js';
import { salaryForRosterSlot, validateLineupCandidate } from './validation.js';

export interface ContestSimulationOptions { simulations?: number; fieldEntries?: number; seed?: string; maxScoreComparisons?: number; }
export interface ContestSimulationResult {
  status: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'; simulations: number; fieldEntries?: number;
  fieldModel: 'PROJECTED_OWNERSHIP' | 'UNAVAILABLE'; payoutModel: 'CONTEST_PAYOUT_STRUCTURE' | 'UNAVAILABLE';
  reason?: string;
  seed?: string; ownershipProvenance?: 'PROVIDER_SLOT_OWNERSHIP'; dependenceModel?: 'INDEPENDENT_PLAYER_SAMPLES'; rulesVersion?: string;
  metrics: Map<string, { variance: number; winFrequency: number; fractionalWinCredit: number; winFrequencyStandardError: number; topOnePercentFrequency: number; cashFrequency: number; cashFrequencyStandardError: number; positivePayoutFrequency?: number; expectedDuplicates: number; expectedPayout?: number; expectedPayoutStandardError?: number; expectedProfit?: number; roi?: number }>;
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
  if (!Number.isInteger(contestSize) || !contestSize || contestSize < 2 || contestSize > MAX_FIELD_ENTRIES + 1) return unavailable(`Independent field simulation supports integer contest sizes from 2 to ${MAX_FIELD_ENTRIES + 1}; received ${contestSize ?? 'unknown'}.`);
  if (slate.contest.userEntryCount !== 1) return unavailable('Field metrics require a single candidate entry; a multi-entry portfolio is not available to include each of the user’s other entries in the field.');
  if (!Number.isInteger(slate.contest.paidPositions) || !slate.contest.paidPositions || slate.contest.paidPositions < 1 || slate.contest.paidPositions >= contestSize) return unavailable('A valid integer paid-position count is required to estimate contest finish frequencies.');
  const paidPositions = slate.contest.paidPositions;
  const simulations = clampInteger(options.simulations ?? 64, 16, MAX_SIMULATIONS);
  const fieldEntries = Math.min(options.fieldEntries ?? contestSize - 1, contestSize - 1);
  if (fieldEntries !== contestSize - 1) return unavailable('Partial-field sampling is disabled; the contest size cannot be represented by the requested field sample.');
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.id)) return unavailable(`Candidate identity ${candidate.id} is duplicated.`);
    candidateIds.add(candidate.id);
    const errors = validateLineupCandidate(candidate, slate);
    if (errors.length) return unavailable(`Candidate ${candidate.id} is not legal: ${errors[0]}`);
  }
  const playerProjection = new Map(projections.map((projection) => [projection.playerId, projection]));
  const ownershipGaps = slate.playerPool.flatMap((player) => Object.entries(slate.rosterRules.slots).filter(([slot]) => player.eligibility[slot] && !validProviderOwnership(player, slot)).map(() => player.playerName));
  if (ownershipGaps.length) return unavailable(`Provider ownership is missing or invalid for ${new Set(ownershipGaps).size}/${slate.playerPool.length} players in eligible roster slots; ownership-weighted field results would be biased.`);
  const missingSamples = slate.playerPool.filter((player) => playerHasPositiveOwnership(player) && !playerProjection.get(player.playerId)?.simulatedFantasyPointSamples?.length).map((player) => player.playerName);
  if (missingSamples.length) return unavailable(`Player outcome samples are missing for ownership-weighted field players: ${missingSamples.slice(0, 8).join(', ')}${missingSamples.length > 8 ? ', and others' : ''}.`);
  const seed = options.seed ?? `${slate.slateId}:${slate.contest.draftKingsContestId}`;
  const field: Array<{ rosterSlots: Record<string, string>; playerIds: string[] }> = [];
  let state = hash(seed);
  const random = () => { state = next(state); return state / 0x1_0000_0000; };
  for (let index = 0; index < fieldEntries; index += 1) {
    const lineup = sampleLegalLineup(slate, random);
    if (!lineup) return unavailable(`Could not construct legal ownership-weighted opponent lineup ${index + 1}/${fieldEntries}; the field model is incomplete.`);
    field.push({ rosterSlots: lineup, playerIds: Object.values(lineup) });
  }

  // Bound work across candidate × sample × opponent comparisons. Metrics beyond the
  // deterministic candidate prefix are explicitly unavailable; they are never extrapolated.
  const maxScoreComparisons = clampInteger(options.maxScoreComparisons ?? 2_000_000, 1, 5_000_000);
  if (simulations * fieldEntries > maxScoreComparisons) return unavailable(`The configured field-comparison budget (${maxScoreComparisons}) cannot cover one candidate across ${simulations} samples and ${fieldEntries} opponent entries.`);
  const candidatesToSimulate = Math.max(1, Math.min(candidates.length, Math.floor(maxScoreComparisons / (simulations * fieldEntries))));
  const simulatedCandidates = candidates.slice(0, candidatesToSimulate);

  const metrics = new Map<string, ContestSimulationResult['metrics'] extends Map<string, infer T> ? T : never>();
  const payoutRows = slate.contest.payoutStructure ?? [];
  const payoutByRank = new Map(payoutRows.map((entry) => [entry.rank, entry.payout]));
  const payoutInputValid = payoutRows.every((entry) => Number.isInteger(entry.rank) && entry.rank > 0 && Number.isFinite(entry.payout) && entry.payout >= 0) && payoutByRank.size === payoutRows.length;
  const feeValid = Number.isFinite(slate.contest.entryFee) && slate.contest.entryFee! > 0;
  const payoutComplete = payoutInputValid && Array.from({ length: paidPositions }, (_, index) => index + 1).every((rank) => payoutByRank.has(rank)) && feeValid;
  const topOnePercentCount = Math.max(1, Math.ceil(contestSize * 0.01));
  for (const candidate of simulatedCandidates) {
    const samples = candidate.simulatedScoreSamples;
    if (!samples?.length || samples.some((score) => !Number.isFinite(score))) continue;
    const outcomes: number[] = []; const winEvents: number[] = []; const cashEvents: number[] = []; const payoutSamples: number[] = []; let wins = 0; let fractionalWinCredit = 0; let topOne = 0; let cash = 0; let positivePayouts = 0; let duplicateTotal = 0; let payoutTotal = 0;
    for (let simulation = 0; simulation < simulations; simulation += 1) {
      const sampleIndex = simulation % samples.length;
      const candidateScore = scoreRosterAtSample(candidate.rosterSlots, sampleIndex, slate, playerProjection);
      const opponentScores = field.map((lineup) => scoreRosterAtSample(lineup.rosterSlots, sampleIndex, slate, playerProjection));
      const tiedAhead = opponentScores.filter((score) => score > candidateScore).length;
      const tiedIncluding = opponentScores.filter((score) => score === candidateScore).length;
      const rank = tiedAhead + 1;
      outcomes.push(candidateScore);
      const won = rank === 1;
      const cashed = rank <= paidPositions;
      winEvents.push(won ? 1 : 0); cashEvents.push(cashed ? 1 : 0);
      if (won) { wins += 1; fractionalWinCredit += 1 / (tiedIncluding + 1); }
      if (rank <= topOnePercentCount) topOne += 1;
      if (cashed) cash += 1;
      duplicateTotal += field.filter((lineup) => sameLineup(lineup.rosterSlots, candidate.rosterSlots)).length;
      if (payoutComplete) {
        const payout = averagePayoutForTie(rank, tiedIncluding + 1, paidPositions, payoutByRank);
        payoutSamples.push(payout);
        payoutTotal += payout;
        if (payout > 0) positivePayouts += 1;
      }
    }
    const average = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
    const variance = outcomes.reduce((sum, value) => sum + (value - average) ** 2, 0) / outcomes.length;
    const expectedPayout = payoutComplete ? payoutTotal / simulations : undefined;
    const expectedProfit = expectedPayout !== undefined ? expectedPayout - slate.contest.entryFee! : undefined;
    const winFrequency = wins / simulations; const cashFrequency = cash / simulations;
    metrics.set(candidate.id, { variance, winFrequency, fractionalWinCredit: fractionalWinCredit / simulations, winFrequencyStandardError: bernoulliStandardError(winFrequency, simulations), topOnePercentFrequency: topOne / simulations, cashFrequency, cashFrequencyStandardError: bernoulliStandardError(cashFrequency, simulations), ...(payoutComplete ? { positivePayoutFrequency: positivePayouts / simulations } : {}), expectedDuplicates: duplicateTotal / simulations, ...(expectedPayout !== undefined ? { expectedPayout, expectedPayoutStandardError: meanStandardError(payoutSamples), expectedProfit, roi: expectedProfit! / slate.contest.entryFee! } : {}) });
  }
  if (metrics.size !== simulatedCandidates.length) return unavailable('One or more optimizer candidates lack joint outcome samples; field metrics were withheld.');
  const reasons = [
    ...(candidatesToSimulate < candidates.length ? [`Field-comparison budget limited metrics to the top ${candidatesToSimulate} of ${candidates.length} candidates; remaining candidate metrics are unavailable.`] : []),
    ...(!payoutComplete ? [`Payout and financial metrics are unavailable because ${!payoutInputValid ? 'payout rows are invalid' : !feeValid ? 'entry fee is missing/invalid' : 'paid ranks are incomplete'}.`] : []),
  ];
  return { status: candidatesToSimulate < candidates.length ? 'PARTIAL' : 'COMPLETE', simulations, fieldEntries, fieldModel: 'PROJECTED_OWNERSHIP', payoutModel: payoutComplete ? 'CONTEST_PAYOUT_STRUCTURE' : 'UNAVAILABLE', ...(reasons.length ? { reason: reasons.join(' ') } : {}), seed, ownershipProvenance: 'PROVIDER_SLOT_OWNERSHIP', dependenceModel: 'INDEPENDENT_PLAYER_SAMPLES', rulesVersion: stableHash(JSON.stringify({ sport: slate.sport, format: slate.contest.format, scoringRules: slate.scoringRules, rosterRules: slate.rosterRules })), metrics };
}

/** Split prizes across every rank occupied by a tie; unpaid ranks contribute zero but remain in the divisor. */
export function averagePayoutForTie(startRank: number, tieSize: number, paidPositions: number, payouts: Map<number, number>): number {
  if (!Number.isInteger(startRank) || startRank < 1 || !Number.isInteger(tieSize) || tieSize < 1 || !Number.isInteger(paidPositions) || paidPositions < 0) return 0;
  let tiedPrizeTotal = 0;
  for (let offset = 0; offset < tieSize; offset += 1) { const rank = startRank + offset; if (rank <= paidPositions) tiedPrizeTotal += payouts.get(rank) ?? 0; }
  return tiedPrizeTotal / tieSize;
}

function bernoulliStandardError(probability: number, sampleCount: number): number { return Math.sqrt(probability * (1 - probability) / Math.max(1, sampleCount)); }
function meanStandardError(values: number[]): number { if (values.length < 2) return 0; const mean = values.reduce((sum, value) => sum + value, 0) / values.length; const sampleVariance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1); return Math.sqrt(sampleVariance / values.length); }

function sampleLegalLineup(slate: ValidatedSlate, random: () => number): Record<string, string> | undefined {
  const slots = Object.entries(slate.rosterRules.slots).flatMap(([slot, rule]) => Array.from({ length: rule.count }, (_, index) => rule.count > 1 ? `${slot}_${index + 1}` : slot));
  const players = slate.playerPool.filter((player) => !['OUT', 'INACTIVE', 'NOT_IN_CONFIRMED_LINEUP', 'NOT_IN_PROVIDER_ROSTER'].includes(player.availability?.status ?? '') && !/^(IL|IR| injured|out|inactive|scratched|doubtful|suspended)/i.test(String(player.providerStatus ?? '').trim()));
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
      const weight = ownershipFor(player, slot); const cost = salaryForRosterSlot(player, slot, slate.rosterRules.slots[base]);
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
  if (!search(0, 0)) return undefined;
  const canonical = canonicalRosterSlots(chosen);
  const playerIds = Object.values(canonical);
  const salaryUsed = Object.entries(canonical).reduce((sum, [slot, playerId]) => {
    const player = players.find((item) => item.playerId === playerId)!;
    return sum + (salaryForRosterSlot(player, slot, slate.rosterRules.slots[slot.replace(/_\d+$/, '')]) ?? Number.POSITIVE_INFINITY);
  }, 0);
  const errors = validateLineupCandidate({ playerIds, rosterSlots: canonical, salaryUsed }, slate);
  return errors.length ? undefined : canonical;
}

function scoreRosterAtSample(rosterSlots: Record<string, string>, sampleIndex: number, slate: ValidatedSlate, projections: Map<string, PlayerProjection>): number {
  return Object.entries(rosterSlots).reduce((total, [slot, playerId]) => {
    const projection = projections.get(playerId);
    if (!projection) return Number.NaN;
    const samples = projection.simulatedFantasyPointSamples?.length ? projection.simulatedFantasyPointSamples : syntheticSamples(projection.projectedOutcomes);
    const multiplier = slate.rosterRules.slots[slot.replace(/_\d+$/, '')]?.fantasyMultiplier ?? 1;
    return total + samples[sampleIndex % samples.length] * multiplier;
  }, 0);
}

function syntheticSamples(outcomes: PlayerProjection['projectedOutcomes']): number[] {
  return Array.from({ length: 256 }, (_, index) => { const q = index / 255; if (q <= 0.5) return outcomes.floorP20 + (outcomes.medianP50 - outcomes.floorP20) * (q / 0.5); if (q <= 0.9) return outcomes.medianP50 + (outcomes.ceilingP90 - outcomes.medianP50) * ((q - 0.5) / 0.4); return outcomes.ceilingP90; });
}

function playerHasPositiveOwnership(player: SlatePlayer): boolean {
  return Object.keys(player.eligibility).some((slot) => validProviderOwnership(player, slot) && (ownershipValue(player, slot) ?? 0) > 0);
}
function ownershipValue(player: SlatePlayer, slot: string): number | undefined { const ownership = player.projectedOwnership; if (!ownership || ownership.source !== 'PROVIDER') return undefined; const base = slot.replace(/_\d+$/, '').toUpperCase(); return base.includes('CPT') || base.includes('CAPTAIN') ? ownership.captain : base === 'UTIL' ? ownership.utility ?? ownership.classic : ownership.classic; }
function validProviderOwnership(player: SlatePlayer, slot: string): boolean { const value = ownershipValue(player, slot); return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1; }
function canonicalRosterSlots(rosterSlots: Record<string, string>): Record<string, string> { const groups = new Map<string, Array<[string, string]>>(); for (const entry of Object.entries(rosterSlots)) { const base = entry[0].replace(/_\d+$/, ''); groups.set(base, [...(groups.get(base) ?? []), entry]); } const canonical: Record<string, string> = {}; for (const entries of groups.values()) { entries.sort(([a], [b]) => a.localeCompare(b)); const players = entries.map(([, playerId]) => playerId).sort((a, b) => a.localeCompare(b)); entries.forEach(([slot], index) => { canonical[slot] = players[index]; }); } return canonical; }
function sameLineup(a: Record<string, string>, b: Record<string, string>): boolean { return JSON.stringify(Object.entries(canonicalRosterSlots(a)).sort(([left], [right]) => left.localeCompare(right))) === JSON.stringify(Object.entries(canonicalRosterSlots(b)).sort(([left], [right]) => left.localeCompare(right))); }
function stableHash(value: string): string { let hashValue = 2166136261; for (let index = 0; index < value.length; index += 1) { hashValue ^= value.charCodeAt(index); hashValue = Math.imul(hashValue, 16777619); } return (hashValue >>> 0).toString(16).padStart(8, '0'); }
function clampInteger(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.floor(Number.isFinite(value) ? value : minimum))); }
function hash(text: string): number { let value = 2166136261; for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619); return value >>> 0; }
function next(value: number): number { let result = value; result ^= result << 13; result ^= result >>> 17; result ^= result << 5; return result >>> 0; }
function unavailable(reason: string): ContestSimulationResult { return { status: 'UNAVAILABLE', simulations: 0, fieldModel: 'UNAVAILABLE', payoutModel: 'UNAVAILABLE', reason, metrics: new Map() }; }
