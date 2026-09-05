import type { AdjustmentPackage, PlayerAdjustment, PlayerProjection, ProjectionPackage, SlatePlayer, Sport, ValidatedSlate } from './contracts.js';
import { golfFinishPositionBonus } from '../dkScoring.js';
import { isPitcher, isQuarterback } from './projectionInputs.js';

const MODEL_VERSION = 'projection.deterministic.v2';
const SIMULATION_RUNS = 256;

const REQUIRED_BASKETBALL = ['expectedMinutes', 'pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute'];
const REQUIRED_NFL_SKILL = ['snaps', 'routes', 'targets', 'carries', 'catchRate', 'yardsPerTarget', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_NFL_QB = ['passAttempts', 'completionRate', 'yardsPerCompletion', 'passingTouchdownRate', 'interceptionRate', 'carries', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_MLB_HITTER = ['expectedPA', 'singlesPerPA', 'doublesPerPA', 'triplesPerPA', 'homeRunsPerPA', 'walksPerPA', 'hitByPitchPerPA', 'rbiPerPA', 'runsPerPA', 'stolenBasesPerPA'];
const REQUIRED_MLB_PITCHER = ['expectedInnings', 'strikeoutsPerInning', 'walksPerInning', 'hitsAllowedPerInning', 'earnedRunsPerInning'];
const REQUIRED_GOLF = ['birdiesPerRound', 'eaglesPerRound', 'bogeysPerRound', 'parsPerRound', 'roundsRemaining'];

// Noise width feeds simulateScores' floor/ceiling band. Grounded in signals the pipeline
// already computes -- roleCertainty (evidence-backed) as a coarse tier, refined by how much
// corroborating evidence exists -- rather than a single flat width for every player and sport.
const PERFORMANCE_NOISE_WIDTH: Record<Sport | 'FPPG', number> = { NBA: 0.2, WNBA: 0.2, NFL: 0.24, CFB: 0.26, MLB: 0.28, GOLF: 0.22, FPPG: 0.2 };
function noiseWidthFor(sport: Sport | 'FPPG'): number { return PERFORMANCE_NOISE_WIDTH[sport]; }

function requiredFieldsFor(sport: Sport, player: SlatePlayer): string[] {
  if (sport === 'NBA' || sport === 'WNBA') return REQUIRED_BASKETBALL;
  if (sport === 'MLB') return isPitcher(player) ? REQUIRED_MLB_PITCHER : REQUIRED_MLB_HITTER;
  if (sport === 'NFL' || sport === 'CFB') return isQuarterback(player) ? REQUIRED_NFL_QB : REQUIRED_NFL_SKILL;
  return REQUIRED_GOLF;
}

export function projectSlate(slate: ValidatedSlate, adjustmentPackage: AdjustmentPackage, now = new Date()): ProjectionPackage {
  let players: ProjectionPackage['players'] = [];
  const gaps: ProjectionPackage['gaps'] = [];
  for (const player of slate.playerPool) {
    const values = player.projectionInputs;
    const missing = requiredFieldsFor(slate.sport, player).filter((key) => !values || !Number.isFinite(values[key]));
    if (missing.length && !Number.isFinite(player.providerFppg)) {
      gaps.push({ reason: `Missing required quantitative inputs for ${player.playerName}: ${missing.join(', ')}.` });
      continue;
    }
    const adjustment = adjustmentPackage.adjustments.find((item) => item.playerId === player.playerId);
    players.push(values && !missing.length ? projectPlayer(slate, player, values, adjustment) : projectFromProviderFppg(player, adjustment));
  }
  if (slate.sport === 'NBA' || slate.sport === 'WNBA') players = reconcileBasketballMinutes(players, slate);
  const status = players.length === 0 ? 'BLOCKED' : gaps.length || adjustmentPackage.status !== 'COMPLETE' ? 'PARTIAL' : 'COMPLETE';
  return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), modelVersion: MODEL_VERSION, simulationRuns: SIMULATION_RUNS, players, gaps, status };
}

// No projectionInputs are available for this player (either the sport has no rate-stat
// provider integrated — Golf has no strokes-gained data source in this repo — or the
// provider didn't return a matching row). We still avoid a fabricated fixed-percentage
// floor/ceiling by simulating around the single aggregate FPPG component with the same
// seeded-noise machinery used for the granular model, so floor/ceiling remain real quantiles
// of a (coarser) distribution rather than a flat +-15% guess.
function projectFromProviderFppg(player: SlatePlayer, adjustment: PlayerAdjustment | undefined): ProjectionPackage['players'][number] {
  const factor = adjustmentFactor(adjustment);
  const rawMedian = (player.providerFppg ?? 0) * factor;
  // FPPG fallback samples are non-negative by construction (the simulated fantasy-point
  // component is clamped at zero). Derive the reported median from that same distribution so a
  // negative provider value cannot make P50 fall below P20 and violate the projection contract.
  const median = Math.max(0, rawMedian);
  const components = { fantasyPoints: median };
  const rules = { fantasyPoints: { value: 1 } };
  const noiseWidth = noiseWidthFor('FPPG');
  const samples = simulateSportScores('FPPG', player, components, rules, `${player.playerId}:fppg`, noiseWidth);
  const orderedSamples = [...samples].sort((a, b) => a - b);
  const floor = quantile(orderedSamples, 0.2);
  const ceiling = quantile(orderedSamples, 0.9);
  const confidence = adjustment?.roleCertainty ?? 'LOW';
  const uncertaintyFactors = ['Projection uses DraftKings provider FPPG because component-level opportunity inputs were unavailable.', `Floor/ceiling reflect aggregate performance variance (noise band ±${Math.round(noiseWidth * 50)}%); role certainty is reported separately.`, ...(rawMedian < 0 ? ['Provider FPPG was negative and was clamped to zero for the non-negative fallback distribution.'] : [])];
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: { providerFppg: player.providerFppg ?? 0 }, adjustedOpportunity: { providerFppg: median }, opportunityDelta: { providerFppg: median - (player.providerFppg ?? 0) }, componentProjection: { fantasyPoints: median }, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, simulatedFantasyPointSamples: samples, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence, uncertaintyFactors, watchDependencies: ['Component-level opportunity inputs'], modelVersion: MODEL_VERSION, modelPath: 'PROVIDER_FPPG_FALLBACK', distribution: { family: 'AGGREGATE_FPPG', drivers: ['provider FPPG', 'aggregate performance variance'] } };
}

function projectPlayer(slate: ValidatedSlate, player: SlatePlayer, values: Record<string, number>, adjustment: PlayerAdjustment | undefined): ProjectionPackage['players'][number] {
  const adjusted = applySportContext(slate, player, applyTypedAdjustments(values, adjustment));
  const components = componentsFor(slate, player, adjusted);
  const rules = scoringRulesFor(slate, components);
  const analyticalMedian = scoreComponents(components, rules);
  const noiseWidth = noiseWidthFor(slate.sport);
  const samples = simulateSportScores(slate.sport, player, components, rules, `${player.playerId}:${slate.sport}`, noiseWidth);
  const orderedSamples = [...samples].sort((a, b) => a - b);
  const floor = quantile(orderedSamples, 0.2);
  // Report all outcome quantiles from the same simulated distribution. The analytical
  // score can sit outside the sampled band when scoring includes asymmetric negative
  // components (for example CFB interceptions), which would violate floor <= median <= ceiling.
  const median = quantile(orderedSamples, 0.5);
  const ceiling = quantile(orderedSamples, 0.9);
  const uncertaintyFactors = adjustment?.roleCertainty === 'LOW' ? ['Role certainty is LOW.'] : [];
  if (Math.abs(median - analyticalMedian) > 0.000001) uncertaintyFactors.push('Median is the simulated P50; analytical expectation is retained in component projections.');
  uncertaintyFactors.push(`Floor/ceiling reflect sport performance variance (noise band ±${Math.round(noiseWidth * 50)}%); role certainty is reported separately.`);
  if (adjustment?.adjustments.some((item) => item.confidence === 'LOW')) uncertaintyFactors.push('At least one adjustment has LOW confidence.');
  const opportunityDelta = Object.fromEntries(Object.keys(values).map((key) => [key, (adjusted[key] ?? 0) - (values[key] ?? 0)]));
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: values, adjustedOpportunity: adjusted, opportunityDelta, componentProjection: components, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, simulatedFantasyPointSamples: samples, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence: adjustment?.roleCertainty ?? 'LOW', uncertaintyFactors, watchDependencies: adjustment?.keyDeltas ?? [], modelVersion: MODEL_VERSION, modelPath: 'SPORT_STRUCTURED', distribution: distributionFor(slate.sport, player) };
}

function componentsFor(slate: ValidatedSlate, player: SlatePlayer, v: Record<string, number>): Record<string, number> {
  const sport = slate.sport;
  if (sport === 'NBA' || sport === 'WNBA') return { points: v.expectedMinutes * v.pointsPerMinute, threePointersMade: v.expectedMinutes * v.threesPerMinute, rebounds: v.expectedMinutes * v.reboundsPerMinute, assists: v.expectedMinutes * v.assistsPerMinute, steals: v.expectedMinutes * v.stealsPerMinute, blocks: v.expectedMinutes * v.blocksPerMinute, turnovers: v.expectedMinutes * v.turnoversPerMinute };
  if (sport === 'NFL' || sport === 'CFB') {
    if (isQuarterback(player)) {
      const completions = v.passAttempts * v.completionRate;
      const passingYards = completions * v.yardsPerCompletion;
      const rushingYards = v.carries * v.yardsPerCarry;
      return {
        passingYards,
        passingTouchdown: v.passAttempts * v.passingTouchdownRate,
        passingYardBonus: sport === 'CFB' && passingYards >= 300 ? 3 : 0,
        interception: v.passAttempts * v.interceptionRate,
        rushingYards,
        rushingTouchdown: v.touchdownProbability,
        ...(sport === 'CFB' ? { rushingYardBonus: rushingYards >= 100 ? 3 : 0 } : {}),
      };
    }
    const receivingYards = v.targets * v.yardsPerTarget;
    const rushingYards = v.carries * v.yardsPerCarry;
    return {
      reception: v.targets * v.catchRate,
      receivingYards,
      receivingTouchdown: v.touchdownProbability,
      ...(sport === 'CFB' ? { receivingYardBonus: receivingYards >= 100 ? 3 : 0 } : {}),
      rushingYards,
      ...(sport === 'CFB' ? { rushingYardBonus: rushingYards >= 100 ? 3 : 0 } : {}),
    };
  }
  if (sport === 'MLB') {
    if (isPitcher(player)) return { inningPitched: v.expectedInnings, strikeout: v.expectedInnings * v.strikeoutsPerInning, walkAgainst: v.expectedInnings * v.walksPerInning, hitAgainst: v.expectedInnings * v.hitsAllowedPerInning, earnedRun: v.expectedInnings * v.earnedRunsPerInning };
    return { single: v.expectedPA * v.singlesPerPA, double: v.expectedPA * v.doublesPerPA, triple: v.expectedPA * v.triplesPerPA, homeRun: v.expectedPA * v.homeRunsPerPA, rbi: v.expectedPA * v.rbiPerPA, run: v.expectedPA * v.runsPerPA, walk: v.expectedPA * v.walksPerPA, hitByPitch: v.expectedPA * v.hitByPitchPerPA, stolenBase: v.expectedPA * v.stolenBasesPerPA };
  }
  // Golf: no strokes-gained provider is integrated in this repo, so projectedFinishPosition is
  // never populated today and finishPositionBonus resolves to 0 until that data source exists.
  const finishPositionBonus = slate.contest.format === 'SHOWDOWN' ? 0 : golfFinishPositionBonus(v.projectedFinishPosition ?? 0);
  return { birdies: v.birdiesPerRound * v.roundsRemaining, eagles: v.eaglesPerRound * v.roundsRemaining, bogeys: v.bogeysPerRound * v.roundsRemaining, pars: v.parsPerRound * v.roundsRemaining, finishPositionBonus };
}

// DraftKings golf finish-position payouts are a fixed placement lookup, not a per-stat rate,
// so it can't be scored by multiplying against slate.scoringRules like every other component.
// It's folded in here as an implicit weight-1 "rule" alongside the slate's real scoring rules.
function scoringRulesFor(slate: ValidatedSlate, components: Record<string, number>): Record<string, { value: number }> {
  const aliases: Record<string, string[]> = { threePointersMade: ['threes', 'threePointers', 'threePointFieldGoalsMade'], reception: ['receptions'], receivingTouchdown: ['receivingTouchdowns', 'touchdowns'], passingTouchdown: ['passingTouchdowns'], rushingTouchdown: ['rushingTouchdowns'], single: ['singles'], double: ['doubles'], triple: ['triples'], homeRun: ['homeRuns'], run: ['runs'], walk: ['walks'], hitByPitch: ['hitByPitches'], stolenBase: ['stolenBases'], inningPitched: ['inningsPitched'], strikeout: ['strikeouts', 'strikeOuts'], earnedRun: ['earnedRuns'], hitAgainst: ['hitsAllowed'], walkAgainst: ['walksAllowed'] };
  const normalized = { ...slate.scoringRules };
  for (const key of Object.keys(components)) if (!normalized[key]) for (const alias of aliases[key] ?? []) if (slate.scoringRules[alias]) { normalized[key] = slate.scoringRules[alias]; break; }
  if (slate.sport !== 'GOLF' || !('finishPositionBonus' in components)) return normalized;
  return { ...normalized, finishPositionBonus: { value: 1 } };
}

function scoreComponents(components: Record<string, number>, rules: Record<string, { value: number }>): number { for (const [key, value] of Object.entries(components)) { if (!Number.isFinite(value)) throw new Error(`Projection produced a non-finite scoring component: ${key}.`); if (!rules[key] || !Number.isFinite(rules[key].value)) throw new Error(`Projection scoring component ${key} is missing from the DraftKings scoring contract.`); } return Object.entries(components).reduce((total, [key, value]) => total + value * rules[key].value, 0); }
function simulateSportScores(sport: Sport | 'FPPG', player: SlatePlayer, components: Record<string, number>, rules: Record<string, { value: number }>, seedText: string, noiseWidth: number): number[] { let seed = hash(seedText); let environmentSeed = hash(`${sport}:${gameGroup(player)}`); const scores: number[] = []; for (let i = 0; i < SIMULATION_RUNS; i += 1) { environmentSeed = next(environmentSeed); const gameNoise = (environmentSeed / 4294967296 - 0.5) * sportEnvironmentWidth(sport); const sampled = Object.fromEntries(Object.entries(components).map(([key, value]) => { seed = next(seed); const playerNoise = (seed / 4294967296 - 0.5) * noiseWidth; const totalNoise = sport === 'FPPG' ? playerNoise : gameNoise * 0.7 + playerNoise * 0.3; return [key, Math.max(0, value * (1 + totalNoise))]; })); scores.push(scoreComponents(sampled, rules)); } return scores; }
function distributionFor(sport: Sport, player: SlatePlayer): PlayerProjection['distribution'] { if (sport === 'NBA' || sport === 'WNBA') return { family: 'SPORT_CORRELATED', correlationGroup: `${sport}:${gameGroup(player)}`, drivers: ['active rotation', 'minutes conservation', 'shared game environment', 'role-rate variance'] }; if (sport === 'NFL' || sport === 'CFB') return { family: 'SPORT_CORRELATED', correlationGroup: `${sport}:${gameGroup(player)}`, drivers: ['play volume', 'game script', 'role share', 'efficiency and touchdown variance'] }; if (sport === 'MLB') return { family: 'SPORT_CORRELATED', correlationGroup: `MLB:${gameGroup(player)}`, drivers: ['plate appearances or innings', 'team run environment', 'matchup outcome variance', 'shared team outcomes'] }; return { family: 'SPORT_CORRELATED', correlationGroup: `GOLF:${player.playerId}`, drivers: ['component-rate variance'] }; }
function sportEnvironmentWidth(sport: Sport | 'FPPG'): number { return sport === 'NBA' || sport === 'WNBA' ? 0.22 : sport === 'NFL' ? 0.26 : sport === 'CFB' ? 0.3 : sport === 'MLB' ? 0.3 : 0.2; }
function hash(value: string): number { return [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7); }
function next(seed: number): number { return (1664525 * seed + 1013904223) >>> 0; }
function gameGroup(player: SlatePlayer): string { return [player.team ?? 'UNKNOWN', player.opponent ?? 'UNKNOWN'].sort().join(':'); }
function quantile(values: number[], q: number): number { return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)))]; }
function adjustmentFactor(adjustment: PlayerAdjustment | undefined): number { return (adjustment?.adjustments ?? []).some((item) => item.adjustmentType === 'AVAILABILITY' && item.direction === 'DOWN') ? 1 + Math.max(-0.4, Math.min(0.4, adjustment?.netSignedMagnitude ?? 0)) : 1; }

function applyTypedAdjustments(values: Record<string, number>, adjustment: PlayerAdjustment | undefined): Record<string, number> {
  const adjusted = { ...values };
  for (const item of adjustment?.adjustments ?? []) {
    const factor = 1 + (item.direction === 'UP' ? 1 : item.direction === 'DOWN' ? -1 : 0) * (item.magnitude === 'MAJOR' ? 0.3 : item.magnitude === 'MATERIAL' ? 0.15 : item.magnitude === 'MODERATE' ? 0.08 : item.magnitude === 'SMALL' ? 0.03 : 0);
    const fields = adjustmentFields(item.adjustmentType);
    for (const field of fields) if (Number.isFinite(adjusted[field])) adjusted[field] *= factor;
  }
  return adjusted;
}

function applySportContext(slate: ValidatedSlate, player: SlatePlayer, values: Record<string, number>): Record<string, number> {
  const adjusted = { ...values };
  if (slate.sport === 'NBA' || slate.sport === 'WNBA') {
    const context = player.sportContext?.nba;
    if (context?.minutesP50 !== undefined && Number.isFinite(context.minutesP50)) adjusted.expectedMinutes = context.minutesP50;
    if (context?.paceMultiplier !== undefined) for (const field of ['pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute']) if (Number.isFinite(adjusted[field])) adjusted[field] *= context.paceMultiplier;
    if (context?.usageMultiplier !== undefined && Number.isFinite(adjusted.pointsPerMinute)) adjusted.pointsPerMinute *= context.usageMultiplier;
  }
  if (slate.sport === 'MLB') {
    const context = player.sportContext?.mlb;
    if (context?.expectedPA !== undefined && Number.isFinite(context.expectedPA)) adjusted.expectedPA = context.expectedPA;
    const environment = [context?.platoonMultiplier, context?.parkRunMultiplier, context?.weatherRunMultiplier].filter((value): value is number => value !== undefined && Number.isFinite(value)).reduce((product, value) => product * value, 1);
    for (const field of ['singlesPerPA', 'doublesPerPA', 'triplesPerPA', 'homeRunsPerPA', 'walksPerPA', 'hitByPitchPerPA', 'rbiPerPA', 'runsPerPA', 'stolenBasesPerPA']) if (Number.isFinite(adjusted[field])) adjusted[field] *= environment;
  }
  if (slate.sport === 'NFL' || slate.sport === 'CFB') {
    const context = slate.sport === 'CFB' ? player.sportContext?.cfb : player.sportContext?.nfl;
    if (context?.expectedPlays !== undefined && Number.isFinite(context.expectedPlays)) { if (isQuarterback(player)) adjusted.passAttempts = context.expectedPlays * (context.passRate ?? 0); else { adjusted.targets = context.expectedPlays * (context.passRate ?? 0) * (context.targetShare ?? 0); adjusted.carries = context.expectedPlays * (1 - (context.passRate ?? 0)) * (context.carryShare ?? 0); } }
    if (context?.touchdownRateMultiplier !== undefined && Number.isFinite(adjusted.touchdownProbability)) adjusted.touchdownProbability *= context.touchdownRateMultiplier;
  }
  return adjusted;
}

function adjustmentFields(type?: string): string[] {
  switch (type) {
    case 'MINUTES': return ['expectedMinutes'];
    case 'USAGE': return ['pointsPerMinute'];
    case 'BALL_HANDLING': return ['assistsPerMinute'];
    case 'REBOUNDING': return ['reboundsPerMinute'];
    case 'SNAP_SHARE': return ['snaps', 'routes'];
    case 'TARGET_SHARE': return ['targets'];
    case 'CARRY_SHARE': return ['carries'];
    case 'BATTING_ORDER':
    case 'PLATE_APPEARANCES': return ['expectedPA'];
    default: return [];
  }
}

function reconcileBasketballMinutes(players: ProjectionPackage['players'], slate: ValidatedSlate): ProjectionPackage['players'] {
  const teamByPlayer = new Map(slate.playerPool.map((player) => [player.playerId, player.team]));
  const byTeam = new Map<string, ProjectionPackage['players']>();
  for (const player of players) { const team = teamByPlayer.get(player.playerId); if (team) byTeam.set(team, [...(byTeam.get(team) ?? []), player]); }
  for (const teamPlayers of byTeam.values()) {
    const total = teamPlayers.reduce((sum, player) => sum + (player.adjustedOpportunity.expectedMinutes ?? 0), 0);
    if (!(total > 0)) continue;
    const factor = 240 / total;
    for (const player of teamPlayers) {
      const before = player.adjustedOpportunity.expectedMinutes;
      const adjustedOpportunity = { ...player.adjustedOpportunity, expectedMinutes: before * factor };
      const opportunityDelta = { ...player.opportunityDelta, expectedMinutes: adjustedOpportunity.expectedMinutes - (player.baselineOpportunity.expectedMinutes ?? 0) };
      const componentProjection = Object.fromEntries(Object.entries(player.componentProjection).map(([key, value]) => [key, value * factor]));
      const samples = (player.simulatedFantasyPointSamples ?? []).map((sample) => sample * factor);
      const sorted = [...samples].sort((a, b) => a - b);
      player.adjustedOpportunity = adjustedOpportunity;
      player.opportunityDelta = opportunityDelta;
      player.componentProjection = componentProjection;
      if (sorted.length) { player.simulatedFantasyPointSamples = samples; player.projectedOutcomes = { floorP20: quantile(sorted, 0.2), medianP50: quantile(sorted, 0.5), ceilingP90: quantile(sorted, 0.9) }; }
      player.salaryEfficiency = { medianPer1k: player.salary ? player.projectedOutcomes.medianP50 / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? player.projectedOutcomes.ceilingP90 / (player.salary / 1000) : 0 };
    }
  }
  return players;
}
