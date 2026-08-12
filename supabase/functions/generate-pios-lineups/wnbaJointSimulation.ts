import { randomNormal, type RandomSource, type SimPlayer } from './simulation.ts';
import { selectWnbaScenario } from './wnbaScenarios.ts';

export interface WnbaJointPlayer extends SimPlayer {
  minutes_projection?: number;
  minutes_distribution?: { p10: number | null; p50: number | null; p90: number | null; standardDeviation: number | null; didNotPlayProbability: number | null };
  wnba_component_projection?: { points: number; rebounds: number; assists: number; steals: number; blocks: number; turnovers: number; threes: number };
  implied_total?: number;
  spread?: number;
  confirmed_starter?: boolean;
}

export interface WnbaJointSimulationResult { outcomes: Float64Array; gameStateByTeam: Map<string, string>; }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const team = (player: SimPlayer) => String(player.team ?? '').toUpperCase();
const normalCdf = (value: number) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (value + 0.044715 * value ** 3)));

export function sampleWnbaJointOutcomes(roster: WnbaJointPlayer[], gamePairs: Array<[string, string]>, random: RandomSource): WnbaJointSimulationResult {
  const outcomes = new Float64Array(roster.length);
  const stateByTeam = new Map<string, { pace: number; margin: number; overtime: boolean; blowout: boolean }>();
  for (const [home, away] of gamePairs) {
    const homePlayers = roster.filter((player) => team(player) === home);
    const implied = homePlayers.map((player) => Number(player.implied_total)).find(Number.isFinite) ?? 81;
    const spread = homePlayers.map((player) => Number(player.spread)).find(Number.isFinite) ?? 0;
    const pace = randomNormal(1, 0.055, random);
    const margin = randomNormal(spread, 8.5, random);
    const overtime = random() < clamp(0.055 + (Math.abs(spread) < 3 ? 0.025 : 0), 0.03, 0.1);
    const blowout = Math.abs(margin) >= 13;
    stateByTeam.set(home, { pace: pace * (implied / 81), margin, overtime, blowout });
    stateByTeam.set(away, { pace: pace * ((162 - implied) / 81), margin: -margin, overtime, blowout });
  }
  const teamIndexes = new Map<string, number[]>();
  roster.forEach((player, index) => teamIndexes.set(team(player), [...(teamIndexes.get(team(player)) ?? []), index]));
  for (const [teamName, indexes] of teamIndexes) {
    const state = stateByTeam.get(teamName) ?? { pace: 1, margin: 0, overtime: false, blowout: false };
    const rawMinutes: Array<{ index: number; minutes: number; active: boolean }> = indexes.map((index) => {
      const player = roster[index];
      const scenario = selectWnbaScenario(player.wnba_scenarios ?? [], random());
      const distribution = player.minutes_distribution;
      const dnp = Number(distribution?.didNotPlayProbability);
      const inactive = scenario?.state === 'inactive' || (scenario === null && Number.isFinite(dnp) && random() < dnp);
      const center = Number(distribution?.p50 ?? player.minutes_projection ?? 22);
      const stdDev = Math.max(2.5, Number(distribution?.standardDeviation) || center * 0.1);
      const scenarioMultiplier = scenario?.state === 'limited' ? scenario.minutes_multiplier ?? 0.62 : scenario?.minutes_multiplier ?? 1;
      const blowoutMultiplier = state.blowout ? (state.margin > 0 && player.confirmed_starter ? 0.86 : state.margin < 0 && player.confirmed_starter ? 0.9 : 1.08) : 1;
      const overtimeMultiplier = state.overtime ? 1.06 : 1;
      return { index, active: !inactive, minutes: inactive ? 0 : clamp(randomNormal(center, stdDev, random) * scenarioMultiplier * blowoutMultiplier * overtimeMultiplier, 0, 40) };
    });
    // Team minutes are constrained jointly; scale active players to a plausible 200 (+OT) total.
    const total = rawMinutes.reduce((sum, row) => sum + row.minutes, 0);
    const target = state.overtime ? 225 : 200;
    const scale = total > 0 ? clamp(target / total, 0.72, 1.3) : 1;
    for (const row of rawMinutes) {
      if (!row.active) { outcomes[row.index] = 0; continue; }
      const player = roster[row.index];
      const components = player.wnba_component_projection;
      const baselineMinutes = Number(player.minutes_projection ?? 24);
      const minuteRatio = row.minutes / Math.max(Number.isFinite(baselineMinutes) && baselineMinutes > 0 ? baselineMinutes : 24, 1);
      const usageShock = randomNormal(0, 0.13, random);
      const teamPace = state.pace;
      if (components) {
        const points = Math.max(0, components.points * minuteRatio * teamPace * (1 + usageShock));
        const rebounds = Math.max(0, components.rebounds * minuteRatio * teamPace * (1 + randomNormal(0, 0.18, random)));
        const assists = Math.max(0, components.assists * minuteRatio * teamPace * (1 - usageShock * 0.35 + randomNormal(0, 0.14, random)));
        const steals = Math.max(0, components.steals * minuteRatio * (1 + randomNormal(0, 0.45, random)));
        const blocks = Math.max(0, components.blocks * minuteRatio * (1 + randomNormal(0, 0.5, random)));
        const turnovers = Math.max(0, components.turnovers * minuteRatio * (1 + usageShock * 0.3));
        const threes = Math.max(0, components.threes * minuteRatio * (1 + usageShock * 0.6));
        const doubleDouble = normalCdf((Math.max(points, rebounds, assists) - 8) / 3) * normalCdf(([points, rebounds, assists].sort((a, b) => b - a)[1] - 8) / 3);
        outcomes[row.index] = Math.max(0, (points + rebounds * 1.2 + assists * 1.5 + steals * 3 + blocks * 3 - turnovers * 0.5 + threes * 0.5 + doubleDouble * 1.5) * scale);
      } else outcomes[row.index] = Math.max(0, Number(player.projected_points ?? 0) * minuteRatio * teamPace * (1 + usageShock) * scale);
    }
  }
  return { outcomes, gameStateByTeam: new Map([...stateByTeam.entries()].map(([key, state]) => [key, state.overtime ? 'overtime' : state.blowout ? 'blowout' : 'competitive'])) };
}
