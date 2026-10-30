import type { PlayerProjection, ProjectionPackage, SlatePlayer, ValidatedSlate } from './contracts.js';

export const GAME_SIMULATION_MODEL_VERSION = 'connected-game-events.nfl-nba.v1';
export type SimulationMode = 'baseline' | 'game_simulation' | 'compare';
type Rng = () => number;
type TeamScenario = { gameId: string; team: string; opponent: string; players: SlatePlayer[]; projections: Map<string, PlayerProjection> };
type GameScenarioRecord = { gameId: string; trial: number; teamScores: Record<string, number> };

/**
 * Simulates coherent per-trial player outcomes inside each game. NBA trial scores are allocated
 * from shared team game totals and shared team-minute/pace environments. NFL trials share the
 * same play volume, passing attempts/completions, target/catch allocation, passing yards/TDs,
 * rushing volume/yards/TDs, and game-score path. These scenarios remain provisional until
 * prospective actuals validate their distributions.
 */
export function applyGameSimulation(slate: ValidatedSlate, baseline: ProjectionPackage, mode: SimulationMode): ProjectionPackage {
  if (!['NBA', 'NFL'].includes(slate.sport) || mode === 'baseline') {
    return { ...baseline, gameSimulation: { mode: 'BASELINE', modelVersion: GAME_SIMULATION_MODEL_VERSION, seed: slate.slateId, trials: baseline.simulationRuns, dependence: 'CONNECTED_GAME_EVENTS', releaseStatus: 'UNVALIDATED', gameScenarios: [] } };
  }
  const trials = baseline.simulationRuns;
  const projections = new Map(baseline.players.map((projection) => [projection.playerId, projection]));
  const scenarios = createTeamScenarios(slate, projections);
  const samples = new Map(baseline.players.map((projection) => [projection.playerId, Array.from({ length: trials }, () => 0)]));
  const simulatedPlayerIds = new Set<string>();
  const gameScores: GameScenarioRecord[] = [];
  const warnings: string[] = [];
  const games = groupBy(scenarios, (scenario) => scenario.gameId);
  for (const [gameId, teams] of games) {
    if (teams.length !== 2) warnings.push(`${gameId}: expected two team pools but found ${teams.length}; game score and opposing-team dependencies are incomplete.`);
    for (let trial = 0; trial < trials; trial += 1) {
      const random = rng(`${slate.slateId}:${GAME_SIMULATION_MODEL_VERSION}:${gameId}:${trial}`);
      const sharedPace = clamp(1 + normal(random) * (slate.sport === 'NBA' ? 0.045 : 0.055), 0.82, 1.18);
      const sharedScript = normal(random);
      const gameTotal = { [teams[0]?.team ?? 'UNKNOWN']: 0, [teams[1]?.team ?? 'UNKNOWN']: 0 } as Record<string, number>;
      if (slate.sport === 'NBA') {
        for (const team of teams) gameTotal[team.team] = simulateBasketballTeam(team, trial, samples, simulatedPlayerIds, random, sharedPace, warnings, slate.scoringRules);
      } else {
        for (const team of teams) gameTotal[team.team] = simulateFootballTeam(team, trial, samples, simulatedPlayerIds, random, sharedPace, sharedScript, warnings, slate.scoringRules);
        for (const defenseTeam of teams) {
          const opposingPoints = gameTotal[defenseTeam.opponent];
          for (const defender of defenseTeam.players.filter((player) => /^(DST|DEF)$/i.test(String(player.position)))) {
            const base = projections.get(defender.playerId);
            if (!base) continue;
            const baseline = base.simulatedFantasyPointSamples ?? [];
            const pointsAllowedAdjustment = finite(opposingPoints) ? defensePointsAllowedScore(opposingPoints, slate.scoringRules) : 0;
            samples.get(defender.playerId)![trial] = (baseline[trial] ?? base.projectedOutcomes.medianP50) + pointsAllowedAdjustment;
            simulatedPlayerIds.add(defender.playerId);
          }
        }
      }
      gameScores.push({ gameId, trial, teamScores: gameTotal });
    }
  }
  // Projection rows with no resolvable team/game are not silently replaced by zero samples.
  for (const projection of baseline.players) {
    const target = samples.get(projection.playerId)!;
    if (simulatedPlayerIds.has(projection.playerId)) continue;
    const original = projection.simulatedFantasyPointSamples ?? [];
    for (let i = 0; i < trials; i += 1) target[i] = original[i] ?? projection.projectedOutcomes.medianP50;
    warnings.push(`${projection.playerId}: no complete game/team mapping; retained the independent baseline distribution.`);
  }
  const players = baseline.players.map((projection) => {
    const values = samples.get(projection.playerId) ?? projection.simulatedFantasyPointSamples ?? [];
    const sorted = [...values].sort((a, b) => a - b);
    const median = quantile(sorted, 0.5);
    return {
      ...projection,
      modelVersion: `${projection.modelVersion}+${GAME_SIMULATION_MODEL_VERSION}`,
      baselineSimulatedFantasyPointSamples: projection.simulatedFantasyPointSamples ?? [],
      simulatedFantasyPointSamples: values,
      projectedOutcomes: { floorP20: quantile(sorted, 0.2), medianP50: median, ceilingP90: quantile(sorted, 0.9) },
      salaryEfficiency: { medianPer1k: projection.salary ? median / (projection.salary / 1000) : 0, ceilingPer1k: projection.salary ? quantile(sorted, 0.9) / (projection.salary / 1000) : 0 },
      uncertaintyFactors: [...new Set([...projection.uncertaintyFactors, 'Connected game-event scenarios are provisional and not yet calibrated against prospective actuals'])],
    };
  });
  return {
    ...baseline,
    modelVersion: `${baseline.modelVersion}+${GAME_SIMULATION_MODEL_VERSION}`,
    players,
    status: 'PARTIAL',
    gaps: [...baseline.gaps, { reason: 'Connected NBA/NFL game simulations are experimental. Prospective actual-data validation and independent model review are required before any release promotion.' }, ...warnings.map((reason) => ({ reason }))],
    gameSimulation: { mode: mode === 'compare' ? 'COMPARE' : 'GAME_SIMULATION', modelVersion: GAME_SIMULATION_MODEL_VERSION, seed: slate.slateId, trials, dependence: 'CONNECTED_GAME_EVENTS', releaseStatus: 'UNVALIDATED', gameScenarios: gameScores },
  };
}

function createTeamScenarios(slate: ValidatedSlate, projections: Map<string, PlayerProjection>): TeamScenario[] {
  const map = new Map<string, TeamScenario>();
  for (const player of slate.playerPool) {
    const team = normalize(player.team); const opponent = normalize(player.opponent);
    if (!team || !opponent) continue;
    const gameId = [team, opponent].sort().join(':');
    const key = `${gameId}:${team}`;
    const scenario = map.get(key) ?? { gameId, team, opponent, players: [], projections };
    scenario.players.push(player);
    map.set(key, scenario);
  }
  return [...map.values()].sort((a, b) => a.gameId.localeCompare(b.gameId) || a.team.localeCompare(b.team));
}

function simulateBasketballTeam(team: TeamScenario, trial: number, output: Map<string, number[]>, simulatedPlayerIds: Set<string>, random: Rng, pace: number, warnings: string[], scoringRules: ValidatedSlate['scoringRules']): number {
  const eligible = team.players.filter((player) => !['OUT', 'INACTIVE', 'NOT_IN_PROVIDER_ROSTER'].includes(String(player.availability?.status)));
  const structured = eligible.filter((player) => team.projections.get(player.playerId)?.modelPath === 'SPORT_STRUCTURED');
  if (structured.length !== eligible.length) warnings.push(`${team.gameId}/${team.team}: one or more NBA player projections use fallback distributions, so player-stat totals are only partially reconciled to the simulated team score.`);
  if (structured.length < 5) warnings.push(`${team.gameId}/${team.team}: fewer than five structured player projections; the game score and player stat allocation may be incomplete.`);
  const minutes = sampleTeamMinutes(eligible, team.projections, random, warnings, `${team.gameId}/${team.team}`);
  const pointWeights = eligible.map((player) => {
    const projection = team.projections.get(player.playerId);
    const rate = projection?.adjustedOpportunity.pointsPerMinute ?? 0;
    const fallback = mean(projection?.simulatedFantasyPointSamples ?? []);
    const expectedMinutes = minutes.get(player.playerId) ?? 0;
    return Math.max(0.01, expectedMinutes * (rate || fallback / 32));
  });
  const expectedPoints = eligible.reduce((sum, player) => sum + Math.max(0, (minutes.get(player.playerId) ?? 0) * (team.projections.get(player.playerId)?.adjustedOpportunity.pointsPerMinute ?? 0)), 0);
  const market = eligible.map((player) => player.marketContext?.impliedTeamTotal).find((value) => Number.isFinite(value) && value! > 60 && value! < 170);
  const teamPointsMean = market ?? clamp(expectedPoints, 75, 150);
  const teamPoints = Math.max(50, Math.round(normalAround(teamPointsMean * pace, Math.max(7, teamPointsMean * 0.095), random)));
  const allocatedPoints = multinomial(teamPoints, pointWeights, random);
  const expectedByStat = new Map<string, number[]>();
  for (const stat of ['threePointersMade', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers']) {
    const weights = eligible.map((player) => (minutes.get(player.playerId) ?? 0) * Math.max(0, team.projections.get(player.playerId)?.adjustedOpportunity[`${stat}PerMinute`] ?? 0) * pace);
    expectedByStat.set(stat, weights);
  }
  const statAllocations = new Map<string, number[]>();
  for (const [stat, weights] of expectedByStat) statAllocations.set(stat, multinomial(poisson(weights.reduce((a, b) => a + b, 0), random), weights, random));
  const teamPointsByPlayer = allocatedPoints;
  let teamFantasyScore = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    const player = eligible[index];
    const projection = team.projections.get(player.playerId);
    if (!projection) continue;
    if (projection.modelPath !== 'SPORT_STRUCTURED') {
      const raw = projection.simulatedFantasyPointSamples?.[trial] ?? projection.projectedOutcomes.medianP50;
      const base = [...(projection.simulatedFantasyPointSamples ?? [])].reduce((a, b) => a + b, 0) / Math.max(1, projection.simulatedFantasyPointSamples?.length ?? 1);
      const value = Math.max(0, raw * (base ? teamPointsMean / Math.max(1, expectedPoints) : 1) * pace);
      output.get(player.playerId)![trial] = value;
      simulatedPlayerIds.add(player.playerId);
      teamFantasyScore += value;
      continue;
    }
    const points = teamPointsByPlayer[index];
    const threes = Math.min(Math.floor(points / 3), statAllocations.get('threePointersMade')![index]);
    const stats: Record<string, number> = { points, threePointersMade: threes, rebounds: statAllocations.get('rebounds')![index], assists: statAllocations.get('assists')![index], steals: statAllocations.get('steals')![index], blocks: statAllocations.get('blocks')![index], turnovers: statAllocations.get('turnovers')![index] };
    const tens = [stats.points, stats.rebounds, stats.assists, stats.steals, stats.blocks].filter((value) => value >= 10).length;
    stats.doubleDouble = tens >= 2 ? 1 : 0;
    stats.tripleDouble = tens >= 3 ? 1 : 0;
    const score = scoreStatLine(stats, scoringRules);
    output.get(player.playerId)![trial] = score;
    simulatedPlayerIds.add(player.playerId);
    teamFantasyScore += score;
  }
  return teamPoints || Math.round(teamFantasyScore / Math.max(1, eligible.length));
}

function sampleTeamMinutes(players: SlatePlayer[], projections: Map<string, PlayerProjection>, random: Rng, warnings: string[], label: string): Map<string, number> {
  const active = players.filter((player) => projections.get(player.playerId)?.modelPath === 'SPORT_STRUCTURED');
  const raw = active.map((player) => {
    const inputs = projections.get(player.playerId)?.adjustedOpportunity ?? {};
    const expected = inputs.expectedMinutes ?? 0;
    const p10 = inputs.minutesP10; const p90 = inputs.minutesP90;
    const sd = Number.isFinite(p10) && Number.isFinite(p90) ? Math.max(1, (p90! - p10!) / 2.563) : Math.max(1, expected * 0.14);
    const restrictedRisk = inputs.limitedMinutesRisk ?? 0;
    return { id: player.playerId, value: Math.max(0, Math.min(48, random() < restrictedRisk ? (p10 ?? expected * 0.25) : normalAround(expected, sd, random))) };
  });
  const minutesTotal = raw.reduce((sum, value) => sum + value.value, 0);
  if (active.length >= 8 && minutesTotal > 200) {
    const scaledTotal = raw.reduce((sum, value) => sum + value.value, 0);
    if (scaledTotal > 0) for (const value of raw) value.value = Math.min(48, value.value * 240 / scaledTotal);
  } else if (active.length && minutesTotal < 200) warnings.push(`${label}: rotation pool does not cover 200 expected minutes; minutes are not forced to 240.`);
  return new Map(raw.map(({ id, value }) => [id, value]));
}

function simulateFootballTeam(team: TeamScenario, trial: number, output: Map<string, number[]>, simulatedPlayerIds: Set<string>, random: Rng, pace: number, sharedScript: number, warnings: string[], scoringRules: ValidatedSlate['scoringRules']): number {
  const players = team.players.filter((player) => !['OUT', 'INACTIVE', 'NOT_IN_PROVIDER_ROSTER'].includes(String(player.availability?.status)));
  const structured = players.filter((player) => team.projections.get(player.playerId)?.modelPath === 'SPORT_STRUCTURED');
  const qbs = structured.filter((player) => /^QB$/i.test(String(player.position)));
  const skills = structured.filter((player) => !/^QB$/i.test(String(player.position)) && !/^(DST|DEF)$/i.test(String(player.position)));
  if (!qbs.length || !skills.length) warnings.push(`${team.gameId}/${team.team}: complete structured QB and skill-player inputs are missing; affected player samples fall back to baseline where no connected events can be generated.`);
  const expectedPlays = average(players.map((player) => player.sportContext?.nfl?.expectedPlays).filter(finite)) || 64;
  const passRate = average(players.map((player) => player.sportContext?.nfl?.passRate).filter(finite)) || inferPassRate(qbs, team.projections);
  const script = sharedScript * (team.team === [...team.gameId.split(':')].sort()[0] ? 1 : -1);
  for (const player of players.filter((item) => team.projections.get(item.playerId)?.modelPath !== 'SPORT_STRUCTURED')) {
    const projection = team.projections.get(player.playerId);
    if (!projection) continue;
    const baseline = projection.simulatedFantasyPointSamples ?? [];
    output.get(player.playerId)![trial] = Math.max(0, (baseline[trial] ?? projection.projectedOutcomes.medianP50) * clamp(pace * (1 + script * 0.025), 0.75, 1.25));
    simulatedPlayerIds.add(player.playerId);
  }
  const plays = Math.max(35, Math.min(90, Math.round(poisson(expectedPlays * pace * clamp(1 + script * 0.035, 0.88, 1.12), random))));
  const passAttempts = binomial(plays, clamp(passRate + script * 0.025, 0.25, 0.8), random);
  const runAttempts = Math.max(0, plays - passAttempts);
  if (!qbs.length) return 20;
  const qbInputs = qbs.map((player) => team.projections.get(player.playerId)!.adjustedOpportunity);
  const qbWeights = qbInputs.map((input) => Math.max(0, input.passAttempts ?? 0));
  if (qbWeights.every((weight) => weight === 0)) qbWeights[0] = 1;
  const qbAttempts = multinomial(passAttempts, qbWeights, random);
  const completionRate = weighted(qbInputs.map((input) => input.completionRate ?? 0.62), qbWeights);
  const completions = binomial(passAttempts, clamp(completionRate, 0.3, 0.85), random);
  const yardsPerCompletion = weighted(qbInputs.map((input) => input.yardsPerCompletion ?? 10.5), qbWeights);
  const totalPassYards = Math.max(0, Math.round(normalAround(completions * yardsPerCompletion, Math.max(4, Math.sqrt(completions) * 6), random)));
  const passTdRate = weighted(qbInputs.map((input) => input.passingTouchdownRate ?? 0.04), qbWeights);
  const passTds = binomial(passAttempts, clamp(passTdRate * clamp(1 + script * 0.08, 0.7, 1.3), 0, 0.2), random);
  const targetsWeights = skills.map((player) => Math.max(0, team.projections.get(player.playerId)!.adjustedOpportunity.targets ?? 0));
  const targetResidual = Math.max(0, passAttempts - targetsWeights.reduce((sum, value) => sum + value, 0));
  const targets = multinomial(passAttempts, [...targetsWeights, targetResidual], random).slice(0, skills.length);
  const catchRates = skills.map((player) => clamp(team.projections.get(player.playerId)!.adjustedOpportunity.catchRate ?? 0.65, 0, 1));
  const rawCatches = targets.map((count, index) => binomial(count, catchRates[index], random));
  const catches = capAllocations(rawCatches, completions, rawCatches.map((value) => value + 0.01), random);
  const expectedRecYards = skills.map((player, index) => catches[index] * (team.projections.get(player.playerId)!.adjustedOpportunity.yardsPerTarget ?? 8) / Math.max(0.2, catchRates[index]));
  const recSum = expectedRecYards.reduce((sum, value) => sum + value, 0);
  const recScale = recSum > totalPassYards && recSum > 0 ? totalPassYards / recSum : 1;
  const receivingYards = expectedRecYards.map((value) => Math.max(0, Math.round(value * recScale * clamp(1 + normal(random) * 0.08, 0.7, 1.3))));
  const passTdWeights = skills.map((player, index) => targets[index] * Math.max(0.001, team.projections.get(player.playerId)!.adjustedOpportunity.touchdownProbability ?? 0.03));
  const receiverTds = multinomial(passTds, [...passTdWeights, 0.3], random).slice(0, skills.length);
  const carryPlayers = structured.filter((player) => !/^(WR|TE|DST|DEF)$/i.test(String(player.position)));
  const carryWeights = carryPlayers.map((player) => Math.max(0, team.projections.get(player.playerId)!.adjustedOpportunity.carries ?? 0));
  if (carryWeights.every((weight) => weight === 0)) carryWeights[0] = 1;
  const carryResidual = Math.max(0, runAttempts - carryWeights.reduce((sum, value) => sum + value, 0));
  const carries = multinomial(runAttempts, [...carryWeights, carryResidual], random).slice(0, carryPlayers.length);
  const rushYards = carryPlayers.map((player, index) => Math.max(0, Math.round(normalAround(carries[index] * (team.projections.get(player.playerId)!.adjustedOpportunity.yardsPerCarry ?? 4), Math.max(1, Math.sqrt(carries[index]) * 2.2), random))));
  const rushTdMean = carryPlayers.reduce((sum, player) => sum + (team.projections.get(player.playerId)!.adjustedOpportunity.touchdownProbability ?? 0), 0) * clamp(1 + script * 0.1, 0.6, 1.4);
  const rushTds = poisson(rushTdMean, random);
  const rushTdWeights = carryPlayers.map((player, index) => Math.max(0.001, carries[index] * (team.projections.get(player.playerId)!.adjustedOpportunity.touchdownProbability ?? 0.02)));
  const carrierTds = multinomial(rushTds, [...rushTdWeights, 0.25], random).slice(0, carryPlayers.length);
  const qbCompletions = multinomial(completions, qbAttempts, random);
  const qbPassTds = multinomial(passTds, qbAttempts, random);
  const qbPassYards = qbs.map((player, index) => Math.max(0, Math.round(normalAround(qbCompletions[index] * (team.projections.get(player.playerId)!.adjustedOpportunity.yardsPerCompletion ?? yardsPerCompletion), Math.max(2, Math.sqrt(qbCompletions[index]) * 6), random))));
  const finalTeamPassingYards = qbPassYards.reduce((sum, value) => sum + value, 0);
  const receiverYardScale = recSum > finalTeamPassingYards && recSum > 0 ? finalTeamPassingYards / recSum : 1;
  for (let index = 0; index < receivingYards.length; index += 1) receivingYards[index] = Math.max(0, Math.round(expectedRecYards[index] * receiverYardScale * clamp(1 + normal(random) * 0.08, 0.7, 1.3)));
  const totalTd = passTds + rushTds;
  const twoPointAttempts = binomial(totalTd, 0.055, random);
  const twoPointMade = binomial(twoPointAttempts, 0.5, random);
  const passingTwoPointMade = binomial(twoPointMade, (passTds + 0.25) / (totalTd + 0.5), random);
  const qbTwoPoints = multinomial(passingTwoPointMade, qbPassTds.map((value) => value + 0.01), random);
  const receiverTwoPoints = multinomial(passingTwoPointMade, passTdWeights, random);
  const rushingTwoPoints = multinomial(twoPointMade - passingTwoPointMade, rushTdWeights, random);
  for (let index = 0; index < qbs.length; index += 1) {
    const projection = team.projections.get(qbs[index].playerId)!;
    const components = { passingYards: qbPassYards[index], passingTouchdown: qbPassTds[index], interception: binomial(qbAttempts[index], clamp(projection.adjustedOpportunity.interceptionRate ?? 0.02, 0, 0.2), random), rushingYards: 0, rushingTouchdown: 0, fumbleLost: 0, twoPointConversion: qbTwoPoints[index] };
    output.get(qbs[index].playerId)![trial] = scoreFootballLine(components, scoringRules, 'QB');
    simulatedPlayerIds.add(qbs[index].playerId);
  }
  for (let index = 0; index < skills.length; index += 1) {
    const player = skills[index];
    output.get(player.playerId)![trial] = scoreFootballLine({ reception: catches[index], receivingYards: receivingYards[index], receivingTouchdown: receiverTds[index], rushingYards: 0, rushingTouchdown: 0, fumbleLost: binomial(catches[index], 0.006, random), twoPointConversion: receiverTwoPoints[index] }, scoringRules, 'SKILL');
    simulatedPlayerIds.add(player.playerId);
  }
  for (let index = 0; index < carryPlayers.length; index += 1) {
    const player = carryPlayers[index];
    const previous = output.get(player.playerId)![trial];
    const rushScore = scoreFootballLine({ rushingYards: rushYards[index], rushingTouchdown: carrierTds[index], fumbleLost: binomial(carries[index], 0.006, random), twoPointConversion: rushingTwoPoints[index] }, scoringRules, 'SKILL');
    output.get(player.playerId)![trial] = previous + rushScore;
    simulatedPlayerIds.add(player.playerId);
  }
  const expectedPoints = players.map((player) => player.marketContext?.impliedTeamTotal).find((value) => finite(value) && value! > 0) ?? 21;
  const extraPointsMade = binomial(Math.max(0, totalTd - twoPointAttempts), 0.94, random);
  const fieldGoals = poisson(Math.max(0, (expectedPoints - totalTd * 7) / 3) * clamp(pace, 0.8, 1.2), random);
  return totalTd * 6 + extraPointsMade + twoPointMade + fieldGoals * 3;
}

function scoreStatLine(stats: Record<string, number>, rules: ValidatedSlate['scoringRules']): number {
  return Object.entries(stats).reduce((sum, [key, value]) => sum + value * ruleValue(rules, key, 'NBA'), 0);
}
function scoreFootballLine(stats: Record<string, number>, rules: ValidatedSlate['scoringRules'], position: 'QB' | 'SKILL'): number {
  let score = Object.entries(stats).reduce((sum, [key, value]) => sum + value * ruleValue(rules, key, 'NFL'), 0);
  if (position === 'QB' && stats.passingYards >= 300) score += ruleValue(rules, 'passingYardBonus', 'NFL');
  if (position === 'SKILL' && stats.rushingYards >= 100) score += ruleValue(rules, 'rushingYardBonus', 'NFL');
  if (position === 'SKILL' && stats.receivingYards >= 100) score += ruleValue(rules, 'receivingYardBonus', 'NFL');
  return score;
}
function ruleValue(rules: ValidatedSlate['scoringRules'], key: string, sport: 'NBA' | 'NFL'): number {
  const aliases: Record<string, string[]> = { threePointersMade: ['threes', 'threePointers', 'threePointFieldGoalsMade'], passingTouchdown: ['passingTouchdowns'], interception: ['interceptions'], rushingTouchdown: ['rushingTouchdowns'], reception: ['receptions'], receivingTouchdown: ['receivingTouchdowns'], fumbleLost: ['fumblesLost', 'lostFumbles'], twoPointConversion: ['twoPointConversions'], doubleDouble: ['doubleDoubleBonus', 'double-double'], tripleDouble: ['tripleDoubleBonus', 'triple-double'], passingYardBonus: ['passing300YardBonus'], rushingYardBonus: ['rushing100YardBonus'], receivingYardBonus: ['receiving100YardBonus'] };
  for (const candidate of [key, ...(aliases[key] ?? [])]) { const value = rules[candidate]?.value; if (finite(value)) return value; }
  return defaultScoring(sport, key);
}
function defensePointsAllowedScore(pointsAllowed: number, rules: ValidatedSlate['scoringRules']): number {
  const value = (rules.pointsAllowed?.value ?? rules.defensivePointsAllowed?.value);
  if (!finite(value)) return 0;
  if (pointsAllowed === 0) return value * 10;
  if (pointsAllowed <= 6) return value * 7;
  if (pointsAllowed <= 13) return value * 4;
  if (pointsAllowed <= 20) return value;
  if (pointsAllowed <= 27) return 0;
  if (pointsAllowed <= 34) return -value;
  return -value * 4;
}
function defaultScoring(sport: 'NBA' | 'NFL', key: string): number {
  const nba: Record<string, number> = { points: 1, threePointersMade: 0.5, rebounds: 1.25, assists: 1.5, steals: 2, blocks: 2, turnovers: -0.5, doubleDouble: 1.5, tripleDouble: 3 };
  const nfl: Record<string, number> = { passingYards: 0.04, passingTouchdown: 4, interception: -1, rushingYards: 0.1, rushingTouchdown: 6, reception: 1, receivingYards: 0.1, receivingTouchdown: 6, fumbleLost: -1, twoPointConversion: 2, passingYardBonus: 3, rushingYardBonus: 3, receivingYardBonus: 3 };
  return (sport === 'NBA' ? nba : nfl)[key] ?? 0;
}

function inferPassRate(qbs: SlatePlayer[], projections: Map<string, PlayerProjection>): number {
  const attempts = qbs.reduce((sum, player) => sum + (projections.get(player.playerId)?.adjustedOpportunity.passAttempts ?? 0), 0);
  return clamp(attempts / 64, 0.3, 0.8);
}
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> { const groups = new Map<string, T[]>(); for (const item of items) { const id = key(item); groups.set(id, [...(groups.get(id) ?? []), item]); } return groups; }
function normalize(value: unknown): string { return String(value ?? '').trim().toUpperCase(); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function weighted(values: number[], weights: number[]): number { const total = weights.reduce((sum, value) => sum + value, 0); return total ? values.reduce((sum, value, index) => sum + value * weights[index], 0) / total : mean(values); }
function normalAround(meanValue: number, sd: number, random: Rng): number { return Math.max(0, meanValue + normal(random) * sd); }
function normal(random: Rng): number { const u1 = Math.max(Number.EPSILON, random()); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random()); }
function poisson(lambda: number, random: Rng): number { if (lambda <= 0) return 0; if (lambda > 28) return Math.max(0, Math.round(normalAround(lambda, Math.sqrt(lambda), random))); const limit = Math.exp(-lambda); let product = 1; let count = 0; do { product *= Math.max(Number.EPSILON, random()); count += 1; } while (product > limit); return count - 1; }
function binomial(count: number, probability: number, random: Rng): number { let hits = 0; for (let index = 0; index < count; index += 1) if (random() < probability) hits += 1; return hits; }
function multinomial(total: number, weights: number[], random: Rng): number[] { const output = Array(weights.length).fill(0) as number[]; const sum = weights.reduce((value, weight) => value + Math.max(0, weight), 0); if (!weights.length || sum <= 0) return output; for (let count = 0; count < total; count += 1) { let draw = random() * sum; for (let index = 0; index < weights.length; index += 1) { draw -= Math.max(0, weights[index]); if (draw <= 0) { output[index] += 1; break; } } } return output; }
function capAllocations(values: number[], cap: number, weights: number[], random: Rng): number[] { const result = [...values]; while (result.reduce((sum, value) => sum + value, 0) > cap) { const index = choose(weights, random); if (result[index] > 0) result[index] -= 1; } return result; }
function choose(weights: number[], random: Rng): number { const sum = weights.reduce((value, weight) => value + Math.max(0, weight), 0); let draw = random() * (sum || weights.length); for (let index = 0; index < weights.length; index += 1) { draw -= sum ? Math.max(0, weights[index]) : 1; if (draw <= 0) return index; } return Math.max(0, weights.length - 1); }
function rng(seedText: string): Rng { let state = hash(seedText) || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; }
function hash(value: string): number { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return result >>> 0; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function quantile(values: number[], probability: number): number { if (!values.length) return 0; const index = (values.length - 1) * probability; const lower = Math.floor(index); const upper = Math.ceil(index); return values[lower] + (values[upper] - values[lower]) * (index - lower); }
