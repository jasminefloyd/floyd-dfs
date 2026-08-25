import type { AdjustmentPackage, PlayerAdjustment, ProjectionPackage, SlatePlayer, Sport, ValidatedSlate } from './contracts.js';
import { golfFinishPositionBonus } from '../dkScoring.js';
import { isPitcher, isQuarterback } from './projectionInputs.js';

const MODEL_VERSION = 'projection.deterministic.v2';
const SIMULATION_RUNS = 256;

const REQUIRED_BASKETBALL = ['expectedMinutes', 'pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute'];
const REQUIRED_NFL_SKILL = ['snaps', 'routes', 'targets', 'carries', 'catchRate', 'yardsPerTarget', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_NFL_QB = ['passAttempts', 'completionRate', 'yardsPerCompletion', 'passingTouchdownRate', 'interceptionRate', 'carries', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_MLB_HITTER = ['expectedPA', 'hitRate', 'totalBasesPerPA', 'rbiPerPA', 'runsPerPA', 'stolenBasesPerPA'];
const REQUIRED_MLB_PITCHER = ['expectedInnings', 'strikeoutsPerInning', 'walksPerInning', 'hitsAllowedPerInning', 'earnedRunsPerInning'];
const REQUIRED_GOLF = ['birdiesPerRound', 'eaglesPerRound', 'bogeysPerRound', 'parsPerRound', 'roundsRemaining'];
const MAGNITUDE: Record<string, number> = { NONE: 0, SMALL: 0.03, MODERATE: 0.08, MATERIAL: 0.15, MAJOR: 0.3 };

function requiredFieldsFor(sport: Sport, player: SlatePlayer): string[] {
  if (sport === 'NBA' || sport === 'WNBA') return REQUIRED_BASKETBALL;
  if (sport === 'MLB') return isPitcher(player) ? REQUIRED_MLB_PITCHER : REQUIRED_MLB_HITTER;
  if (sport === 'NFL') return isQuarterback(player) ? REQUIRED_NFL_QB : REQUIRED_NFL_SKILL;
  return REQUIRED_GOLF;
}

export function projectSlate(slate: ValidatedSlate, adjustmentPackage: AdjustmentPackage, now = new Date()): ProjectionPackage {
  const players: ProjectionPackage['players'] = [];
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
  const median = (player.providerFppg ?? 0) * factor;
  const components = { fantasyPoints: median };
  const rules = { fantasyPoints: { value: 1 } };
  const samples = simulateScores(components, rules, `${player.playerId}:fppg`);
  const floor = quantile(samples, 0.2);
  const ceiling = quantile(samples, 0.9);
  const confidence = adjustment?.roleCertainty ?? 'LOW';
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: { providerFppg: player.providerFppg ?? 0 }, adjustedOpportunity: { providerFppg: median }, opportunityDelta: { providerFppg: median - (player.providerFppg ?? 0) }, componentProjection: { fantasyPoints: median }, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence, uncertaintyFactors: ['Projection uses DraftKings provider FPPG because component-level opportunity inputs were unavailable.'], watchDependencies: ['Component-level opportunity inputs'], modelVersion: MODEL_VERSION };
}

function projectPlayer(slate: ValidatedSlate, player: SlatePlayer, values: Record<string, number>, adjustment: PlayerAdjustment | undefined): ProjectionPackage['players'][number] {
  const factor = adjustmentFactor(adjustment);
  const adjusted = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * factor]));
  const components = componentsFor(slate, player, adjusted);
  const rules = scoringRulesFor(slate, components);
  const median = scoreComponents(components, rules);
  const samples = simulateScores(components, rules, `${player.playerId}:${slate.sport}`);
  const floor = quantile(samples, 0.2);
  const ceiling = quantile(samples, 0.9);
  const uncertaintyFactors = adjustment?.roleCertainty === 'LOW' ? ['Role certainty is LOW.'] : [];
  if (adjustment?.adjustments.some((item) => item.confidence === 'LOW')) uncertaintyFactors.push('At least one adjustment has LOW confidence.');
  const opportunityDelta = Object.fromEntries(Object.keys(values).map((key) => [key, (adjusted[key] ?? 0) - (values[key] ?? 0)]));
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: values, adjustedOpportunity: adjusted, opportunityDelta, componentProjection: components, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence: adjustment?.roleCertainty ?? 'LOW', uncertaintyFactors, watchDependencies: adjustment?.keyDeltas ?? [], modelVersion: MODEL_VERSION };
}

function componentsFor(slate: ValidatedSlate, player: SlatePlayer, v: Record<string, number>): Record<string, number> {
  const sport = slate.sport;
  if (sport === 'NBA' || sport === 'WNBA') return { points: v.expectedMinutes * v.pointsPerMinute, threes: v.expectedMinutes * v.threesPerMinute, rebounds: v.expectedMinutes * v.reboundsPerMinute, assists: v.expectedMinutes * v.assistsPerMinute, steals: v.expectedMinutes * v.stealsPerMinute, blocks: v.expectedMinutes * v.blocksPerMinute, turnovers: v.expectedMinutes * v.turnoversPerMinute };
  if (sport === 'NFL') {
    if (isQuarterback(player)) { const completions = v.passAttempts * v.completionRate; return { passingYards: completions * v.yardsPerCompletion, passingTouchdown: v.passAttempts * v.passingTouchdownRate, interception: v.passAttempts * v.interceptionRate, rushingYards: v.carries * v.yardsPerCarry, rushingTouchdown: v.touchdownProbability }; }
    return { receptions: v.targets * v.catchRate, receivingYards: v.targets * v.yardsPerTarget, rushingYards: v.carries * v.yardsPerCarry, touchdowns: v.touchdownProbability };
  }
  if (sport === 'MLB') {
    if (isPitcher(player)) return { inningPitched: v.expectedInnings, strikeout: v.expectedInnings * v.strikeoutsPerInning, walkAgainst: v.expectedInnings * v.walksPerInning, hitAgainst: v.expectedInnings * v.hitsAllowedPerInning, earnedRun: v.expectedInnings * v.earnedRunsPerInning };
    return { hits: v.expectedPA * v.hitRate, totalBases: v.expectedPA * v.totalBasesPerPA, rbi: v.expectedPA * v.rbiPerPA, runs: v.expectedPA * v.runsPerPA, stolenBases: v.expectedPA * v.stolenBasesPerPA };
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
  if (slate.sport !== 'GOLF' || !('finishPositionBonus' in components)) return slate.scoringRules;
  return { ...slate.scoringRules, finishPositionBonus: { value: 1 } };
}

function scoreComponents(components: Record<string, number>, rules: Record<string, { value: number }>): number { return Object.entries(components).reduce((total, [key, value]) => total + value * (rules[key]?.value ?? 0), 0); }
function simulateScores(components: Record<string, number>, rules: Record<string, { value: number }>, seedText: string): number[] { let seed = [...seedText].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7); const scores: number[] = []; for (let i = 0; i < SIMULATION_RUNS; i += 1) { const sampled = Object.fromEntries(Object.entries(components).map(([key, value]) => { seed = (1664525 * seed + 1013904223) >>> 0; const noise = ((seed / 4294967296) - 0.5) * 0.4; return [key, Math.max(0, value * (1 + noise))]; })); scores.push(scoreComponents(sampled, rules)); } return scores.sort((a, b) => a - b); }
function quantile(values: number[], q: number): number { return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)))]; }
function adjustmentFactor(adjustment: PlayerAdjustment | undefined): number { if (!adjustment) return 1; const magnitude = Math.max(...adjustment.adjustments.map((item) => MAGNITUDE[item.magnitude] ?? 0), 0); return adjustment.netOpportunityDirection.includes('UP') ? 1 + magnitude : adjustment.netOpportunityDirection.includes('DOWN') ? 1 - magnitude : 1; }
