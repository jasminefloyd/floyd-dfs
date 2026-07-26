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
}

export interface SimRosterSlot {
  slot: string;
  eligible: string[];
}

export interface SimFieldLineup {
  playerIds: string[];
}

export interface IndexedFieldLineup {
  indexes: number[];
}

export function randomNormal(mean: number, stdDev: number): number {
  const first = Math.max(Math.random(), Number.EPSILON);
  const second = Math.max(Math.random(), Number.EPSILON);
  const z = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  return mean + z * stdDev;
}

export function sampleLognormalOutcome(mean: number, stdDev: number): number {
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  const safeStdDev = Math.max(Number.isFinite(stdDev) ? stdDev : 0, 0.001);
  const sigmaSquared = Math.log(1 + (safeStdDev / mean) ** 2);
  const sigma = Math.sqrt(sigmaSquared);
  const mu = Math.log(mean) - sigmaSquared / 2;
  return Math.exp(randomNormal(mu, sigma));
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
): void {
  if (sport === 'nba' || sport === 'wnba') {
    applyBasketballCorrelation(outcomes, means, roster, gamePairs);
  } else if (sport === 'nfl') {
    applyNflCorrelation(outcomes, means, stdDevs, roster, gamePairs);
  } else if (sport === 'mlb') {
    applyMlbCorrelation(outcomes, means, roster, gamePairs);
  }
}

function applyBasketballCorrelation(
  outcomes: Float64Array,
  means: Float64Array,
  roster: SimPlayer[],
  gamePairs: Array<[string, string]>,
) {
  const teamPulses = new Map<string, number>();
  const gamePulseByTeam = new Map<string, number>();
  for (const player of roster) {
    const team = teamKey(player);
    if (team && !teamPulses.has(team)) teamPulses.set(team, randomNormal(0, 0.06));
  }
  for (const [home, away] of gamePairs) {
    const pulse = randomNormal(0, 0.05);
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
) {
  const teamPulses = new Map<string, number>();
  for (const player of roster) {
    const team = teamKey(player);
    if (team && !teamPulses.has(team)) teamPulses.set(team, randomNormal(0, 0.09));
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

function weightedPick<T>(items: T[], weight: (item: T) => number): T | null {
  const weights = items.map((item) => Math.max(0.0001, weight(item)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = Math.random() * total;
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
): SimFieldLineup[] {
  const slots = contestType === 'showdown'
    ? Array.from({ length: 6 }, (_, index) => ({ slot: index === 0 ? 'CPT' : `FLEX${index}`, eligible: roster.map((player) => player.position) }))
    : slotsBySport[sport] ?? [];
  if (!slots.length) return [];

  const field: SimFieldLineup[] = [];
  const retryCap = fieldSize * 80;
  let attempts = 0;
  while (field.length < fieldSize && attempts < retryCap) {
    attempts += 1;
    const selected: SimPlayer[] = [];
    const usedIds = new Set<string>();
    let salaryUsed = 0;
    let failed = false;
    for (const slot of slots) {
      const remainingSlots = slots.length - selected.length - 1;
      const salaryRemaining = 50_000 - salaryUsed;
      const targetRemaining = Math.max(0, 42_500 - salaryUsed);
      const candidates = roster.filter((player) => {
        if (usedIds.has(player.player_id)) return false;
        if (!playerEligibleForSlot(player, slot) && contestType !== 'showdown') return false;
        if (salaryUsed + player.salary > 50_000) return false;
        if (remainingSlots === 0) return true;
        return salaryRemaining - player.salary >= remainingSlots * 2_000;
      });
      const pick = weightedPick(candidates, (player) => {
        const ownership = Math.max(player.ownership_projection ?? 0.08, 0.01);
        const affordability = remainingSlots > 0 && player.salary > targetRemaining / Math.max(remainingSlots + 1, 1) ? 0.65 : 1;
        return ownership ** 1.15 * affordability;
      });
      if (!pick) {
        failed = true;
        break;
      }
      selected.push(pick);
      usedIds.add(pick.player_id);
      salaryUsed += pick.salary;
    }
    if (!failed && salaryUsed <= 50_000 && salaryUsed >= 42_500) {
      field.push({ playerIds: selected.map((player) => player.player_id) });
    }
  }
  return field;
}

export function indexFieldLineups(fieldLineups: SimFieldLineup[], playerIndex: Map<string, number>): IndexedFieldLineup[] {
  return fieldLineups.map((lineup) => ({
    indexes: lineup.playerIds
      .map((playerId) => playerIndex.get(playerId))
      .filter((index): index is number => typeof index === 'number'),
  }));
}
