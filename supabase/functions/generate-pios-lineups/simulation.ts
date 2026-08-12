import { selectWnbaScenario, type WnbaOutcomeScenario } from './wnbaScenarios.ts';
import { mlbProxyFieldWeight } from './mlbModel.ts';

export interface SimPlayer {
  name: string;
  team: string;
  position: string;
  salary: number;
  player_id: string;
  projected_points?: number;
  contextual_projection?: number;
  last_5_avg_pts?: number;
  ownership_projection?: number;
  salary_multiplier?: number;
  roster_slot?: string;
  golf_wave?: 'am' | 'pm';
  relationship_edges?: Array<{ related_player_id: string; direction: 'positive' | 'negative' | 'neutral'; strength: number; sample_size: number; validated: boolean }>;
  wnba_scenarios?: WnbaOutcomeScenario[];
}

export interface SimRosterSlot {
  slot: string;
  eligible: string[];
}

export interface SimFieldLineup {
  players: Array<{ playerId: string; multiplier: number }>;
}

export interface IndexedFieldLineup {
  entries: Array<{ index: number; multiplier: number }>;
}

export type RandomSource = () => number;

export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function scoreIndexedEntries(outcomes: Float64Array, entries: Array<{ index: number; multiplier: number }>): number {
  return entries.reduce((total, entry) => total + (outcomes[entry.index] ?? 0) * entry.multiplier, 0);
}

/** Maps a simulated-field rank onto the real contest field while preserving first and last place. */
export function scaleFinishRank(simulatedRank: number, simulatedFieldSize: number, realFieldSize: number): number {
  const safeSimulatedSize = Math.max(1, Math.floor(simulatedFieldSize));
  const safeRealSize = Math.max(1, Math.floor(realFieldSize));
  const safeRank = Math.min(safeSimulatedSize, Math.max(1, Math.floor(simulatedRank)));
  if (safeSimulatedSize === 1 || safeRealSize === 1) return 1;
  return Math.min(
    safeRealSize,
    Math.max(1, Math.ceil(((safeRank - 1) / (safeSimulatedSize - 1)) * (safeRealSize - 1) + 1)),
  );
}

export function randomNormal(mean: number, stdDev: number, random: RandomSource = Math.random): number {
  const first = Math.max(random(), Number.EPSILON);
  const second = Math.max(random(), Number.EPSILON);
  const z = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return mean + z * stdDev;
}

export function sampleLognormalOutcome(mean: number, stdDev: number, random: RandomSource = Math.random): number {
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const safeStdDev = Math.max(Number.isFinite(stdDev) ? stdDev : 0, 0.001);
  const sigmaSquared = Math.log(1 + (safeStdDev / mean) ** 2);
  const sigma = Math.sqrt(sigmaSquared);
  const mu = Math.log(mean) - sigmaSquared / 2;
  return Math.exp(randomNormal(mu, sigma, random));
}

export function sampleWnbaOutcome(mean: number, stdDev: number, scenarios: WnbaOutcomeScenario[] = [], random: RandomSource = Math.random): number {
  const randomValue = random();
  const scenario = selectWnbaScenario(scenarios, randomValue);
  if (!scenario) return sampleLognormalOutcome(mean, stdDev, random);
  if (scenario.state === 'inactive') return 0;
  const minutesMultiplier = scenario.minutes_multiplier ?? 1;
  const productionMultiplier = scenario.production_multiplier ?? 1;
  const scenarioMean = mean * minutesMultiplier * productionMultiplier;
  const scenarioStdDev = stdDev * (scenario.state === 'limited' ? 1.1 : 1);
  return sampleLognormalOutcome(scenarioMean, scenarioStdDev, random);
}

export function adjustedProjection(player: SimPlayer): number {
  return Number(player.contextual_projection ?? player.projected_points ?? player.last_5_avg_pts ?? 0);
}

export function playerEligibleForSlot(player: SimPlayer, slotDef: SimRosterSlot): boolean {
  return String(player.position ?? '')
    .split('/')
    .map((position) => position.trim())
    .some((position) => slotDef.eligible.includes(position));
}

export function isPitcher(player: SimPlayer): boolean {
  return /^(P|SP|RP)$/.test(String(player.position ?? '').toUpperCase());
}

export function isPassCatcher(player: SimPlayer): boolean {
  return ['WR', 'TE'].includes(String(player.position ?? '').toUpperCase());
}

export function isRunningBack(player: SimPlayer): boolean {
  return String(player.position ?? '').toUpperCase() === 'RB';
}

export function isQuarterback(player: SimPlayer): boolean {
  return String(player.position ?? '').toUpperCase() === 'QB';
}

export function isDefense(player: SimPlayer): boolean {
  return ['DST', 'DEF'].includes(String(player.position ?? '').toUpperCase());
}

export function teamKey(player: SimPlayer): string {
  return String(player.team ?? '').toUpperCase();
}

export function correlateOutcomes(
  outcomes: Float64Array,
  means: Float64Array,
  stdDevs: Float64Array,
  roster: SimPlayer[],
  sport: string,
  gamePairs: Array<[string, string]> = [],
  contestType = '',
  random: RandomSource = Math.random,
): void {
  if (sport === 'nba' || sport === 'wnba') {
    applyBasketballCorrelation(outcomes, means, roster, gamePairs, contestType, random);
  } else if (sport === 'nfl') {
    applyNflCorrelation(outcomes, means, stdDevs, roster, gamePairs);
  } else if (sport === 'mlb') {
    applyMlbCorrelation(outcomes, means, roster, gamePairs, random);
  } else if (sport === 'golf') {
    applyGolfWaveCorrelation(outcomes, roster, random);
  }
  applyShrunkRelationshipCorrelation(outcomes, means, roster);
}

// Golf has no teams, so there's no team-pulse or game-pulse signal to correlate on.
// The closest equivalent is the AM/PM tee-time wave: golfers in the same wave play in
// the same weather/course-firmness window. This is a single shared multiplier applied to
// every golfer in a wave at once (not a pairwise nudge), so it's inherently symmetric --
// there's no ordering dependency to get wrong the way a pairwise adjustment would have.
// Kept deliberately small: shared conditions are a much weaker signal than a real
// team's shared play-by-play dependency (e.g. a QB-to-WR connection).
function applyGolfWaveCorrelation(outcomes: Float64Array, roster: SimPlayer[], random: RandomSource): void {
  const wavePulses = new Map<string, number>();
  roster.forEach((player, index) => {
    const wave = player.golf_wave;
    if (!wave) return;
    if (!wavePulses.has(wave)) wavePulses.set(wave, randomNormal(0, 0.04, random));
    const multiplier = 1 + (wavePulses.get(wave) ?? 0);
    outcomes[index] = Math.max(0, outcomes[index] * multiplier);
  });
}

function applyShrunkRelationshipCorrelation(outcomes: Float64Array, means: Float64Array, roster: SimPlayer[]): void {
  const indexById = new Map(roster.map((player, index) => [player.player_id, index]));
  roster.forEach((player, index) => {
    for (const edge of player.relationship_edges ?? []) {
      const relatedIndex = indexById.get(edge.related_player_id);
      if (relatedIndex === undefined || relatedIndex <= index) continue;
      // Derived relationships are intentionally shrunk until historical pair outcomes
      // are supplied. This adds structure without pretending the edge is validated.
      const shrinkage = edge.validated && edge.sample_size >= 20 ? 1 : 0.35;
      const coefficient = Math.max(-0.18, Math.min(0.18, edge.strength * shrinkage)) * (edge.direction === 'negative' ? -1 : 1);
      // Capture both deviations before mutating either outcome, so relatedIndex's nudge is
      // based on index's pre-adjustment deviation, not a value that already includes the
      // adjustment just applied to it (which would compound the correlation one-directionally).
      const relatedDeviation = outcomes[relatedIndex] - means[relatedIndex];
      const indexDeviation = outcomes[index] - means[index];
      outcomes[index] = Math.max(0, outcomes[index] + relatedDeviation * coefficient);
      outcomes[relatedIndex] = Math.max(0, outcomes[relatedIndex] + indexDeviation * coefficient * 0.35);
    }
  });
}

function applyBasketballCorrelation(
  outcomes: Float64Array,
  means: Float64Array,
  roster: SimPlayer[],
  gamePairs: Array<[string, string]>,
  contestType: string,
  random: RandomSource,
) {
  const teamPulses = new Map<string, number>();
  const gamePulseByTeam = new Map<string, number>();
  for (const player of roster) {
    const team = teamKey(player);
    if (team && !teamPulses.has(team)) teamPulses.set(team, randomNormal(0, 0.06, random));
  }
  for (const [home, away] of gamePairs) {
    const pulse = randomNormal(0, contestType === 'showdown' ? 0.11 : 0.06, random);
    gamePulseByTeam.set(home, pulse);
    gamePulseByTeam.set(away, pulse);
  }

  const indexesByTeam = new Map<string, number[]>();
  roster.forEach((player, index) => {
    const team = teamKey(player);
    if (!team) return;
    indexesByTeam.set(team, [...(indexesByTeam.get(team) ?? []), index]);
    const multiplier = 1 + (teamPulses.get(team) ?? 0) + (gamePulseByTeam.get(team) ?? 0);
    outcomes[index] = Math.max(0, outcomes[index] * multiplier);
  });

  for (const indexes of indexesByTeam.values()) {
    const actualDeviation = indexes.reduce((sum, index) => sum + (outcomes[index] - means[index]), 0);
    const expectedTotal = indexes.reduce((sum, index) => sum + means[index], 0);
    const teamMeanDeviationRate = expectedTotal > 0 ? actualDeviation / expectedTotal : 0;
    for (const index of indexes) {
      const individualDeviation = outcomes[index] - means[index];
      const targetDeviation = means[index] * teamMeanDeviationRate;
      outcomes[index] = Math.max(0, means[index] + individualDeviation * 0.9 + targetDeviation * 0.1);
    }
    const highUsageIndexes = indexes
      .filter((index) => means[index] >= 18)
      .sort((a, b) => (outcomes[b] - means[b]) - (outcomes[a] - means[a]));
    const leadIndex = highUsageIndexes[0];
    if (leadIndex !== undefined && outcomes[leadIndex] > means[leadIndex]) {
      const leadExcess = outcomes[leadIndex] - means[leadIndex];
      for (const index of highUsageIndexes.slice(1)) {
        outcomes[index] = Math.max(0, outcomes[index] - leadExcess * 0.08);
      }
    }
  }
}

function applyNflCorrelation(
  outcomes: Float64Array,
  means: Float64Array,
  stdDevs: Float64Array,
  roster: SimPlayer[],
  gamePairs: Array<[string, string]>,
) {
  const qbZByTeam = new Map<string, number>();
  const offenseDeviationByTeam = new Map<string, number>();
  roster.forEach((player, index) => {
    const team = teamKey(player);
    if (!team || isDefense(player)) return;
    offenseDeviationByTeam.set(team, (offenseDeviationByTeam.get(team) ?? 0) + (outcomes[index] - means[index]));
    if (isQuarterback(player)) qbZByTeam.set(team, (outcomes[index] - means[index]) / Math.max(stdDevs[index], 1));
  });

  roster.forEach((player, index) => {
    const team = teamKey(player);
    const qbZ = qbZByTeam.get(team) ?? 0;
    if (isPassCatcher(player)) {
      outcomes[index] = Math.max(0, outcomes[index] + qbZ * 0.45 * stdDevs[index]);
    } else if (isRunningBack(player)) {
      outcomes[index] = Math.max(0, outcomes[index] - qbZ * 0.15 * stdDevs[index]);
    } else if (isDefense(player)) {
      const game = gamePairs.find(([home, away]) => home === team || away === team);
      const opponentTeam = game ? (game[0] === team ? game[1] : game[0]) : '';
      const opponentDeviation = opponentTeam
        ? offenseDeviationByTeam.get(opponentTeam) ?? 0
        : [...offenseDeviationByTeam.entries()]
          .filter(([opponent]) => opponent !== team)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[1] ?? 0;
      outcomes[index] = Math.max(0, outcomes[index] - opponentDeviation * 0.3);
    }
  });
}

function applyMlbCorrelation(
  outcomes: Float64Array,
  means: Float64Array,
  roster: SimPlayer[],
  gamePairs: Array<[string, string]>,
  random: RandomSource,
) {
  const teamPulses = new Map<string, number>();
  for (const player of roster) {
    const team = teamKey(player);
    if (team && !teamPulses.has(team)) teamPulses.set(team, randomNormal(0, 0.09, random));
  }
  roster.forEach((player, index) => {
    const team = teamKey(player);
    if (!team) return;
    if (isPitcher(player)) {
      const opponent = gamePairs.find(([home, away]) => home === team || away === team);
      const opponentTeam = opponent ? (opponent[0] === team ? opponent[1] : opponent[0]) : '';
      const opponentPulse = teamPulses.get(opponentTeam) ?? 0;
      outcomes[index] = Math.max(0, outcomes[index] * (1 - opponentPulse * 0.5));
    } else {
      outcomes[index] = Math.max(0, outcomes[index] * (1 + (teamPulses.get(team) ?? 0)));
    }
  });
}

function weightedPick<T>(items: T[], weight: (item: T) => number, random: RandomSource): T | null {
  const weights = items.map((item) => Math.max(0.0001, weight(item)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return items[index];
  }
  return items[items.length - 1] ?? null;
}

export function generateFieldLineups(
  roster: SimPlayer[],
  sport: string,
  contestType: string,
  fieldSize = 800,
  slotsBySport: Record<string, SimRosterSlot[]>,
  random: RandomSource = Math.random,
): SimFieldLineup[] {
  const slots = contestType === 'showdown'
    ? Array.from({ length: 6 }, (_, index) => ({ slot: index === 0 ? 'CPT' : `FLEX${index}`, eligible: roster.map((player) => player.position) }))
    : slotsBySport[sport] ?? [];
  if (!slots.length) return [];

  const field: SimFieldLineup[] = [];
  const chalkTarget = Math.floor(fieldSize * 0.4);
  const leverageTarget = Math.floor(fieldSize * 0.2);
  const randomTarget = fieldSize - chalkTarget - leverageTarget;
  const retryCap = fieldSize * 100;
  let attempts = 0;
  const fieldWeight = (mode: 'chalk' | 'random' | 'leverage', fallback: (player: SimPlayer) => number) => (
    sport === 'mlb' ? (player: SimPlayer) => mlbProxyFieldWeight(player, mode) : fallback
  );
  while (field.length < chalkTarget && attempts < retryCap) {
    attempts += 1;
    const lineup = buildFieldLineup(roster, slots, contestType, fieldWeight('chalk', (player) => adjustedProjection(player) + (player.ownership_projection ?? 0.08) * 8), random);
    if (lineup) field.push(lineup);
  }
  while (field.length < chalkTarget + randomTarget && attempts < retryCap) {
    attempts += 1;
    const lineup = buildFieldLineup(roster, slots, contestType, fieldWeight('random', (player) => Math.max(player.ownership_projection ?? 0.08, 0.01) ** 1.15), random);
    if (lineup) field.push(lineup);
  }
  while (field.length < fieldSize && attempts < retryCap) {
    attempts += 1;
    const lineup = buildFieldLineup(roster, slots, contestType, fieldWeight('leverage', (player) => adjustedProjection(player) / Math.max(player.ownership_projection ?? 0.08, 0.01)), random);
    if (lineup) field.push(lineup);
  }
  return field;
}

export function buildFieldLineup(
  roster: SimPlayer[],
  slots: SimRosterSlot[],
  contestType: string,
  weight: (player: SimPlayer) => number,
  random: RandomSource = Math.random,
): SimFieldLineup | null {
  const selected: SimPlayer[] = [];
  const usedIds = new Set<string>();
  let salaryUsed = 0;
  for (const slot of slots) {
    const candidates = roster.filter((player) => {
      const salaryMultiplier = contestType === 'showdown' && slot.slot === 'CPT' ? 1.5 : 1;
      const slotSalary = Math.floor(player.salary * salaryMultiplier);
      if (usedIds.has(player.player_id)) return false;
      if (!playerEligibleForSlot(player, slot)) return false;
      if (salaryUsed + slotSalary > 50_000) return false;
      return true;
    });
    const pick = weightedPick(candidates, (player) => {
      return weight(player);
    }, random);
    if (!pick) return null;
    selected.push(pick);
    usedIds.add(pick.player_id);
    salaryUsed += Math.floor(pick.salary * (contestType === 'showdown' && slot.slot === 'CPT' ? 1.5 : 1));
  }
  if (salaryUsed > 50_000) return null;
  if (contestType === 'showdown' && new Set(selected.map((player) => teamKey(player))).size < 2) return null;
  return {
    players: selected.map((player, index) => ({
      playerId: player.player_id,
      multiplier: contestType === 'showdown' && index === 0 ? 1.5 : 1,
    })),
  };
}

export function indexFieldLineups(fieldLineups: SimFieldLineup[], playerIndex: Map<string, number>): IndexedFieldLineup[] {
  return fieldLineups.map((lineup) => ({
    entries: lineup.players
      .map((player) => {
        const index = playerIndex.get(player.playerId);
        return typeof index === 'number' ? { index, multiplier: player.multiplier } : null;
      })
      .filter((entry): entry is { index: number; multiplier: number } => entry !== null),
  }));
}
