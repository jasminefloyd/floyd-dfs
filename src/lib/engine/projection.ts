import type { AdjustmentPackage, PlayerAdjustment, PlayerProjection, ProjectionPackage, Sport, ValidatedSlate } from './contracts.js';

const MODEL_VERSION = 'projection.deterministic.v1';
const SIMULATION_RUNS = 256;
const REQUIRED: Record<Sport, string[]> = {
  NBA: ['expectedMinutes', 'pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute'],
  WNBA: ['expectedMinutes', 'pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute'],
  NFL: ['snaps', 'routes', 'targets', 'carries', 'catchRate', 'yardsPerTarget', 'yardsPerCarry', 'touchdownProbability'],
  MLB: ['expectedPA', 'hitRate', 'totalBasesPerPA', 'rbiPerPA', 'runsPerPA', 'stolenBasesPerPA'],
  GOLF: ['birdiesPerRound', 'eaglesPerRound', 'bogeysPerRound', 'parsPerRound', 'roundsRemaining'],
};
const MAGNITUDE: Record<string, number> = { NONE: 0, SMALL: 0.03, MODERATE: 0.08, MATERIAL: 0.15, MAJOR: 0.3 };

export function projectSlate(slate: ValidatedSlate, adjustmentPackage: AdjustmentPackage, now = new Date()): ProjectionPackage {
  const players: PlayerProjection[] = [];
  const gaps: ProjectionPackage['gaps'] = [];
  for (const player of slate.playerPool) {
    const values = player.projectionInputs;
    const missing = REQUIRED[slate.sport].filter((key) => !values || !Number.isFinite(values[key]));
    if (missing.length && !Number.isFinite(player.providerFppg)) {
      gaps.push({ reason: `Missing required quantitative inputs for ${player.playerName}: ${missing.join(', ')}.` });
      continue;
    }
    const adjustment = adjustmentPackage.adjustments.find((item) => item.playerId === player.playerId);
    players.push(values ? projectPlayer(slate, player, values, adjustment) : projectFromProviderFppg(player, adjustment));
  }
  const status = players.length === 0 ? 'BLOCKED' : gaps.length || adjustmentPackage.status !== 'COMPLETE' ? 'PARTIAL' : 'COMPLETE';
  return { slateId: slate.slateId, tenantId: slate.tenantId, sport: slate.sport, version: 1, generatedAt: now.toISOString(), modelVersion: MODEL_VERSION, simulationRuns: SIMULATION_RUNS, players, gaps, status };
}

function projectFromProviderFppg(player: ValidatedSlate['playerPool'][number], adjustment: PlayerAdjustment | undefined): PlayerProjection {
  const factor = adjustmentFactor(adjustment);
  const median = (player.providerFppg ?? 0) * factor;
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: { providerFppg: player.providerFppg ?? 0 }, adjustedOpportunity: { providerFppg: median }, opportunityDelta: { providerFppg: median - (player.providerFppg ?? 0) }, componentProjection: { fantasyPoints: median }, projectedOutcomes: { floorP20: median * 0.85, medianP50: median, ceilingP90: median * 1.15 }, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? median * 1.15 / (player.salary / 1000) : 0 }, confidence: 'LOW', uncertaintyFactors: ['Projection uses DraftKings provider FPPG because component-level opportunity inputs were unavailable.'], watchDependencies: ['Component-level opportunity inputs'], modelVersion: MODEL_VERSION };
}

function projectPlayer(slate: ValidatedSlate, player: ValidatedSlate['playerPool'][number], values: Record<string, number>, adjustment: PlayerAdjustment | undefined): PlayerProjection {
  const factor = adjustmentFactor(adjustment);
  const adjusted = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * factor]));
  const components = componentsFor(slate.sport, adjusted);
  const median = scoreComponents(components, slate.scoringRules);
  const samples = simulateScores(components, slate.scoringRules, `${player.playerId}:${slate.sport}`);
  const floor = quantile(samples, 0.2);
  const ceiling = quantile(samples, 0.9);
  const uncertaintyFactors = adjustment?.roleCertainty === 'LOW' ? ['Role certainty is LOW.'] : [];
  if (adjustment?.adjustments.some((item) => item.confidence === 'LOW')) uncertaintyFactors.push('At least one adjustment has LOW confidence.');
  const opportunityDelta = Object.fromEntries(Object.keys(values).map((key) => [key, (adjusted[key] ?? 0) - (values[key] ?? 0)]));
  return { playerId: player.playerId, salary: player.salary, baselineOpportunity: values, adjustedOpportunity: adjusted, opportunityDelta, componentProjection: components, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence: adjustment?.roleCertainty ?? 'LOW', uncertaintyFactors, watchDependencies: adjustment?.keyDeltas ?? [], modelVersion: MODEL_VERSION };
}

function componentsFor(sport: Sport, v: Record<string, number>): Record<string, number> {
  if (sport === 'NBA' || sport === 'WNBA') return { points: v.expectedMinutes * v.pointsPerMinute, threes: v.expectedMinutes * v.threesPerMinute, rebounds: v.expectedMinutes * v.reboundsPerMinute, assists: v.expectedMinutes * v.assistsPerMinute, steals: v.expectedMinutes * v.stealsPerMinute, blocks: v.expectedMinutes * v.blocksPerMinute, turnovers: v.expectedMinutes * v.turnoversPerMinute };
  if (sport === 'NFL') return { receptions: v.targets * v.catchRate, receivingYards: v.targets * v.yardsPerTarget, rushingYards: v.carries * v.yardsPerCarry, touchdowns: v.touchdownProbability };
  if (sport === 'MLB') return { hits: v.expectedPA * v.hitRate, totalBases: v.expectedPA * v.totalBasesPerPA, rbi: v.expectedPA * v.rbiPerPA, runs: v.expectedPA * v.runsPerPA, stolenBases: v.expectedPA * v.stolenBasesPerPA };
  return { birdies: v.birdiesPerRound * v.roundsRemaining, eagles: v.eaglesPerRound * v.roundsRemaining, bogeys: v.bogeysPerRound * v.roundsRemaining, pars: v.parsPerRound * v.roundsRemaining };
}

function scoreComponents(components: Record<string, number>, rules: Record<string, { value: number }>): number { return Object.entries(components).reduce((total, [key, value]) => total + value * (rules[key]?.value ?? 0), 0); }
function simulateScores(components: Record<string, number>, rules: Record<string, { value: number }>, seedText: string): number[] { let seed = [...seedText].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7); const scores: number[] = []; for (let i = 0; i < SIMULATION_RUNS; i += 1) { const sampled = Object.fromEntries(Object.entries(components).map(([key, value]) => { seed = (1664525 * seed + 1013904223) >>> 0; const noise = ((seed / 4294967296) - 0.5) * 0.4; return [key, Math.max(0, value * (1 + noise))]; })); scores.push(scoreComponents(sampled, rules)); } return scores.sort((a, b) => a - b); }
function quantile(values: number[], q: number): number { return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)))]; }
function adjustmentFactor(adjustment: PlayerAdjustment | undefined): number { if (!adjustment) return 1; const magnitude = Math.max(...adjustment.adjustments.map((item) => MAGNITUDE[item.magnitude] ?? 0), 0); return adjustment.netOpportunityDirection.includes('UP') ? 1 + magnitude : adjustment.netOpportunityDirection.includes('DOWN') ? 1 - magnitude : 1; }
