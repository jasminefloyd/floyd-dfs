import type { AdjustmentPackage, PlayerAdjustment, PlayerProjection, ProjectionPackage, SlatePlayer, Sport, ValidatedSlate } from './contracts.js';
import { golfFinishPositionBonus } from '../dkScoring.js';
import { isPitcher, isQuarterback } from './projectionInputs.js';

const MODEL_VERSION = 'projection.deterministic.v3';
const SIMULATION_RUNS = 256;

const REQUIRED_BASKETBALL = ['expectedMinutes', 'pointsPerMinute', 'reboundsPerMinute', 'assistsPerMinute', 'stealsPerMinute', 'blocksPerMinute', 'turnoversPerMinute', 'threesPerMinute'];
const REQUIRED_NFL_SKILL = ['snaps', 'routes', 'targets', 'carries', 'catchRate', 'yardsPerTarget', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_NFL_QB = ['passAttempts', 'completionRate', 'yardsPerCompletion', 'passingTouchdownRate', 'interceptionRate', 'carries', 'yardsPerCarry', 'touchdownProbability'];
const REQUIRED_MLB_HITTER = ['expectedPA', 'singlesPerPA', 'doublesPerPA', 'triplesPerPA', 'homeRunsPerPA', 'walksPerPA', 'hitByPitchPerPA', 'rbiPerPA', 'runsPerPA', 'stolenBasesPerPA'];
const REQUIRED_MLB_PITCHER = ['expectedInnings', 'strikeoutsPerInning', 'walksPerInning', 'hitsAllowedPerInning', 'earnedRunsPerInning'];
const REQUIRED_GOLF_CLASSIC = ['birdiesPerRound', 'eaglesPerRound', 'bogeysPerRound', 'parsPerRound', 'roundsRemaining', 'projectedFinishPosition'];
// Golf Showdown scores one round and has no tournament finish-position bonus. Requiring
// Classic-only placement data made every otherwise-projected Showdown golfer unprojectable.
const REQUIRED_GOLF_SHOWDOWN = ['birdiesPerRound', 'eaglesPerRound', 'bogeysPerRound', 'parsPerRound', 'roundsRemaining'];

// Noise width feeds simulateScores' floor/ceiling band. Grounded in signals the pipeline
// already computes -- roleCertainty (evidence-backed) as a coarse tier, refined by how much
// corroborating evidence exists -- rather than a single flat width for every player and sport.
const PERFORMANCE_NOISE_WIDTH: Record<Sport | 'FPPG', number> = { NBA: 0.2, WNBA: 0.2, NFL: 0.24, CFB: 0.26, MLB: 0.28, GOLF: 0.22, FPPG: 0.2 };
function noiseWidthFor(sport: Sport | 'FPPG'): number { return PERFORMANCE_NOISE_WIDTH[sport]; }

export function requiredProjectionFields(sport: Sport, player: SlatePlayer, format?: ValidatedSlate['contest']['format']): string[] {
  if (sport === 'NBA' || sport === 'WNBA') return REQUIRED_BASKETBALL;
  if (sport === 'MLB') return isPitcher(player) ? REQUIRED_MLB_PITCHER : REQUIRED_MLB_HITTER;
  if (sport === 'NFL' || sport === 'CFB') return isQuarterback(player) ? REQUIRED_NFL_QB : REQUIRED_NFL_SKILL;
  return format === 'SHOWDOWN' ? REQUIRED_GOLF_SHOWDOWN : REQUIRED_GOLF_CLASSIC;
}

export function projectionReadiness(sport: Sport, player: SlatePlayer, format?: ValidatedSlate['contest']['format']): { ready: boolean; missing: string[] } {
  const missing = requiredProjectionFields(sport, player, format).filter((key) => !player.projectionInputs || !Number.isFinite(player.projectionInputs[key]));
  return { ready: missing.length === 0 || Number.isFinite(player.providerFppg), missing };
}

export function projectSlate(slate: ValidatedSlate, adjustmentPackage: AdjustmentPackage, now = new Date()): ProjectionPackage {
  let players: ProjectionPackage['players'] = [];
  const gaps: ProjectionPackage['gaps'] = [];
  const prepared: Array<{ player: SlatePlayer; values: Record<string, number>; adjustment?: PlayerAdjustment }> = [];
  let golfFallbackCount = 0;
  const golfMissing: Array<{ name: string; fields: string[] }> = [];
  for (const player of slate.playerPool) {
    const values = player.projectionInputs;
    const missing = requiredProjectionFields(slate.sport, player, slate.contest.format).filter((key) => !values || !Number.isFinite(values[key]));
    if (missing.length && !Number.isFinite(player.providerFppg)) {
      if (slate.sport === 'GOLF') golfMissing.push({ name: player.playerName, fields: missing });
      else gaps.push({ reason: `Missing required quantitative inputs for ${player.playerName}: ${missing.join(', ')}.` });
      continue;
    }
    const adjustment = adjustmentPackage.adjustments.find((item) => item.playerId === player.playerId);
    if (values && !missing.length) {
      let adjustedValues = applySportContext(slate, player, applyTypedAdjustments(values, adjustment));
      // A DraftKings RP slot is not a starter workload. Keep the model from turning a bad
      // provider role match into a five-inning projection; long-relief scenarios still need
      // explicit, event-specific evidence before they can exceed this conservative bound.
      if (slate.sport === 'MLB' && /^RP$/i.test(String(player.position ?? '')) && adjustedValues.expectedInnings > 3) {
        gaps.push({ reason: `${player.playerName} is listed as a reliever but had ${adjustedValues.expectedInnings.toFixed(1)} expected innings; workload was capped at 3.0 pending verified long-relief/opening-role evidence.` });
        adjustedValues = { ...adjustedValues, expectedInnings: 3 };
      }
      prepared.push({ player, values: adjustedValues, adjustment });
    }
    else { players.push(projectFromProviderFppg(player, adjustment)); if (slate.sport === 'GOLF') golfFallbackCount += 1; }
  }
  if (golfMissing.length) {
    const sample = golfMissing.slice(0, 5).map(({ name }) => name).join(', ');
    const fields = [...new Set(golfMissing.flatMap(({ fields: missing }) => missing))].join(', ');
    gaps.push({ reason: `Golf structured projections are missing required inputs for ${golfMissing.length}/${slate.playerPool.length} golfers (${fields}). Sample: ${sample}${golfMissing.length > 5 ? ', and others' : ''}. Check SportsDataIO Golf tournament lookup, feed access, and golfer-name matching; lineups remain blocked until inputs are available.` });
  }
  if (slate.sport === 'NBA' || slate.sport === 'WNBA') reconcileBasketballOpportunities(prepared, slate, gaps);
  players.push(...prepared.map(({ player, values, adjustment }) => projectPlayer(slate, player, values, adjustment, true)));
  if (golfFallbackCount) gaps.push({ reason: `Golf structured projection is unavailable for ${golfFallbackCount} player(s); any candidate uses DraftKings provider FPPG only and is provisional. Verified skill, course, weather, and finish/cut inputs are still required before entry.` });
  // DK's own FPPG is enough to produce a clearly provisional research candidate, but not an
  // entry-ready Golf projection. Keep the candidate path available for QA and comparison while
  // the run trust gate continues to require model validation and complete sport context.
  const status = players.length === 0 ? 'BLOCKED' : gaps.length || adjustmentPackage.status !== 'COMPLETE' || golfFallbackCount > 0 ? 'PARTIAL' : 'COMPLETE';
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
  return { playerId: player.playerId, salary: player.salary, ...(Number.isFinite(player.providerFppg) ? { baselineFppg: player.providerFppg } : {}), baselineOpportunity: { providerFppg: player.providerFppg ?? 0 }, adjustedOpportunity: { providerFppg: median }, opportunityDelta: { providerFppg: median - (player.providerFppg ?? 0) }, componentProjection: { fantasyPoints: median }, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, simulatedFantasyPointSamples: samples, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence, uncertaintyFactors, watchDependencies: ['Component-level opportunity inputs'], modelVersion: MODEL_VERSION, modelPath: 'PROVIDER_FPPG_FALLBACK', distribution: { family: 'AGGREGATE_FPPG', drivers: ['provider FPPG', 'aggregate performance variance'] } };
}

function projectPlayer(slate: ValidatedSlate, player: SlatePlayer, values: Record<string, number>, adjustment: PlayerAdjustment | undefined, valuesArePrepared = false): ProjectionPackage['players'][number] {
  const adjusted = valuesArePrepared ? values : applySportContext(slate, player, applyTypedAdjustments(values, adjustment));
  const components = componentsFor(slate, player, adjusted);
  const rules = scoringRulesFor(slate, components);
  const analyticalMedian = scoreComponents(components, rules);
  const noiseWidth = noiseWidthFor(slate.sport);
  const samples = simulateSportScores(slate.sport, player, components, rules, `${player.playerId}:${slate.sport}`, noiseWidth, adjusted);
  const orderedSamples = [...samples].sort((a, b) => a - b);
  const floor = quantile(orderedSamples, 0.2);
  // Report all outcome quantiles from the same simulated distribution. The analytical
  // score can sit outside the sampled band when scoring includes asymmetric negative
  // components (for example CFB interceptions), which would violate floor <= median <= ceiling.
  const median = quantile(orderedSamples, 0.5);
  const ceiling = quantile(orderedSamples, 0.9);
  const uncertaintyFactors = adjustment?.roleCertainty === 'LOW' ? ['Role certainty is LOW.'] : [];
  if (slate.sport === 'WNBA' && (adjusted.expectedMinutes ?? 99) <= 8 && player.availability?.roleStatus !== 'CONFIRMED_STARTER') uncertaintyFactors.push('Low-minute WNBA role is not confirmed; the current event distribution does not model a separate DNP probability.');
  if (Math.abs(median - analyticalMedian) > 0.000001) uncertaintyFactors.push('Median is the simulated P50; analytical expectation is retained in component projections.');
  uncertaintyFactors.push(`Floor/ceiling use the deterministic ${distributionFor(slate.sport, player)?.family ?? 'SPORT_EVENT'} sampler; its event-rate dispersion is provisional and not outcome-calibrated.`);
  if (adjustment?.adjustments.some((item) => item.confidence === 'LOW')) uncertaintyFactors.push('At least one adjustment has LOW confidence.');
  const opportunityDelta = Object.fromEntries(Object.keys(values).map((key) => [key, (adjusted[key] ?? 0) - (values[key] ?? 0)]));
  return { playerId: player.playerId, salary: player.salary, ...(Number.isFinite(player.providerFppg) ? { baselineFppg: player.providerFppg } : {}), baselineOpportunity: values, adjustedOpportunity: adjusted, opportunityDelta, componentProjection: components, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, simulatedFantasyPointSamples: samples, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence: adjustment?.roleCertainty ?? 'LOW', uncertaintyFactors, watchDependencies: adjustment?.keyDeltas ?? [], modelVersion: MODEL_VERSION, modelPath: 'SPORT_STRUCTURED', distribution: distributionFor(slate.sport, player) };
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
        // This component is the probability of triggering the bonus. The scoring rule
        // supplies its point value (3); storing points here would multiply it twice.
        ...(slate.scoringRules.passingYardBonus ? { passingYardBonus: thresholdProbability(passingYards, Math.max(1, passingYards * 0.25), 300) } : {}),
        interception: v.passAttempts * v.interceptionRate,
        rushingYards,
        rushingTouchdown: v.touchdownProbability,
        ...(slate.scoringRules.rushingYardBonus ? { rushingYardBonus: thresholdProbability(rushingYards, Math.max(1, rushingYards * 0.3), 100) } : {}),
      };
    }
    const receivingYards = v.targets * v.yardsPerTarget;
    const rushingYards = v.carries * v.yardsPerCarry;
    return {
      reception: v.targets * v.catchRate,
      receivingYards,
      receivingTouchdown: v.touchdownProbability,
      ...(slate.scoringRules.receivingYardBonus ? { receivingYardBonus: thresholdProbability(receivingYards, Math.max(1, receivingYards * 0.3), 100) } : {}),
      rushingYards,
      ...(slate.scoringRules.rushingYardBonus ? { rushingYardBonus: thresholdProbability(rushingYards, Math.max(1, rushingYards * 0.3), 100) } : {}),
    };
  }
  if (sport === 'MLB') {
    if (isPitcher(player)) return { inningPitched: v.expectedInnings, strikeout: v.expectedInnings * v.strikeoutsPerInning, walkAgainst: v.expectedInnings * v.walksPerInning, hitAgainst: v.expectedInnings * v.hitsAllowedPerInning, earnedRun: v.expectedInnings * v.earnedRunsPerInning, ...(Number.isFinite(v.winProbability) ? { win: clampRate(v.winProbability) } : {}) };
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
  const aliases: Record<string, string[]> = { threePointersMade: ['threes', 'threePointers', 'threePointFieldGoalsMade'], doubleDouble: ['doubleDoubleBonus', 'double-double'], tripleDouble: ['tripleDoubleBonus', 'triple-double'], reception: ['receptions'], receivingTouchdown: ['receivingTouchdowns', 'touchdowns'], passingTouchdown: ['passingTouchdowns'], rushingTouchdown: ['rushingTouchdowns'], single: ['singles'], double: ['doubles'], triple: ['triples'], homeRun: ['homeRuns'], run: ['runs'], walk: ['walks'], hitByPitch: ['hitByPitches'], stolenBase: ['stolenBases'], inningPitched: ['inningsPitched'], strikeout: ['strikeouts', 'strikeOuts'], earnedRun: ['earnedRuns'], hitAgainst: ['hitsAllowed'], walkAgainst: ['walksAllowed'], win: ['pitcherWin', 'wins'] };
  const normalized = { ...slate.scoringRules };
  for (const key of Object.keys(components)) if (!normalized[key]) for (const alias of aliases[key] ?? []) if (slate.scoringRules[alias]) { normalized[key] = slate.scoringRules[alias]; break; }
  if (slate.sport !== 'GOLF' || !('finishPositionBonus' in components)) return normalized;
  return { ...normalized, finishPositionBonus: { value: 1 } };
}

function scoreComponents(components: Record<string, number>, rules: Record<string, { value: number }>): number { for (const [key, value] of Object.entries(components)) { if (!Number.isFinite(value)) throw new Error(`Projection produced a non-finite scoring component: ${key}.`); if (!rules[key] || !Number.isFinite(rules[key].value)) throw new Error(`Projection scoring component ${key} is missing from the DraftKings scoring contract.`); } return Object.entries(components).reduce((total, [key, value]) => total + value * rules[key].value, 0); }
function simulateSportScores(sport: Sport | 'FPPG', player: SlatePlayer, components: Record<string, number>, rules: Record<string, { value: number }>, seedText: string, noiseWidth: number, inputs: Record<string, number> = components): number[] {
  let seed = hash(seedText); let environmentSeed = hash(`${sport}:${gameGroup(player)}`); const scores: number[] = [];
  for (let i = 0; i < SIMULATION_RUNS; i += 1) {
    environmentSeed = next(environmentSeed); const gameNoise = (environmentSeed / 4294967296 - 0.5) * sportEnvironmentWidth(sport);
    const random = () => { seed = next(seed); return seed / 4294967296; };
    const sampled = sport === 'FPPG' ? sampleAggregate(components, random, noiseWidth) : sport === 'MLB' ? sampleMlb(player, inputs, random) : sport === 'NFL' || sport === 'CFB' ? sampleFootball(player, inputs, rules, random, gameNoise) : sport === 'GOLF' ? sampleGolf(components, random) : sampleBasketball(player, components, inputs, rules, random, gameNoise);
    scores.push(scoreComponents(sampled, rules));
  }
  return scores;
}
function sampleAggregate(components: Record<string, number>, random: () => number, width: number): Record<string, number> { return Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Math.max(0, value * (1 + (random() - 0.5) * width))])); }
function sampleBasketball(player: SlatePlayer, components: Record<string, number>, inputs: Record<string, number>, rules: Record<string, { value: number }>, random: () => number, gameNoise: number): Record<string, number> {
  const minutesMean = inputs.expectedMinutes ?? 0;
  const sourcedP10 = inputs.minutesP10;
  const sourcedP90 = inputs.minutesP90;
  const sourcedMinutesBand = Number.isFinite(sourcedP10) && Number.isFinite(sourcedP90) && sourcedP10! >= 0 && sourcedP90! >= sourcedP10!;
  // Prefer provider-supplied role quantiles. Until game-log-derived minutes are available,
  // unconfirmed WNBA roles get a wider provisional minutes distribution; this widens risk but
  // does not pretend to know a calibrated DNP probability.
  const roleUnconfirmed = player.availability?.roleStatus !== 'CONFIRMED_STARTER' && player.availability?.roleStatus !== 'EXPECTED_STARTER';
  const minutesDeviation = sourcedMinutesBand ? Math.max(1, (sourcedP90! - sourcedP10!) / 2.563) : Math.max(1, minutesMean * (roleUnconfirmed ? 0.25 : 0.12));
  const minutes = positiveNormal(minutesMean, minutesDeviation, random);
  const minuteRatio = inputs.expectedMinutes ? minutes / inputs.expectedMinutes : 1;
  const sampled = Object.fromEntries(Object.entries(components).map(([key, value]) => {
    const environment = 1 + gameNoise * 0.35;
    const result = key === 'points' ? positiveNormal(value * minuteRatio * environment, Math.max(1, value * 0.25), random) : poisson(Math.max(0, value * minuteRatio * environment), random);
    return [key, result];
  }));
  const categoriesAtTen = ['points', 'rebounds', 'assists', 'steals', 'blocks'].filter((key) => (sampled[key] ?? 0) >= 10).length;
  if (rules.doubleDouble) sampled.doubleDouble = categoriesAtTen >= 2 ? 1 : 0;
  if (rules.tripleDouble) sampled.tripleDouble = categoriesAtTen >= 3 ? 1 : 0;
  return sampled;
}
function sampleFootball(player: SlatePlayer, inputs: Record<string, number>, rules: Record<string, { value: number }>, random: () => number, gameNoise: number): Record<string, number> {
  const sampled: Record<string, number> = {};
  const scale = 1 + gameNoise * 0.35;
  if (isQuarterback(player)) {
    const attempts = poisson(Math.max(0, inputs.passAttempts ?? 0) * scale, random);
    const completions = binomial(attempts, clampRate(inputs.completionRate ?? 0.65), random);
    const passingYards = positiveNormal(completions * (inputs.yardsPerCompletion ?? 0), Math.max(1, completions * (inputs.yardsPerCompletion ?? 0) * 0.28), random);
    const carries = poisson(Math.max(0, inputs.carries ?? 0) * scale, random);
    const rushingYards = positiveNormal(carries * (inputs.yardsPerCarry ?? 0), Math.max(1, carries * (inputs.yardsPerCarry ?? 0) * 0.35), random);
    Object.assign(sampled, { passingYards, passingTouchdown: poisson(Math.max(0, inputs.passAttempts ?? 0) * (inputs.passingTouchdownRate ?? 0) * scale, random), interception: binomial(attempts, clampRate(inputs.interceptionRate ?? 0), random), rushingYards, rushingTouchdown: poisson(Math.max(0, inputs.touchdownProbability ?? 0) * scale, random) });
    if (rules.passingYardBonus) sampled.passingYardBonus = passingYards >= 300 ? 1 : 0;
    if (rules.rushingYardBonus) sampled.rushingYardBonus = rushingYards >= 100 ? 1 : 0;
    return sampled;
  }
  const targets = poisson(Math.max(0, inputs.targets ?? 0) * scale, random); const carries = poisson(Math.max(0, inputs.carries ?? 0) * scale, random);
  const receptions = binomial(targets, clampRate(inputs.catchRate ?? 0.65), random);
  // yardsPerTarget is already measured per target. Conditional yards per catch
  // therefore divide by catch rate so the unconditional mean stays targets * YPT.
  const catchRate = clampRate(inputs.catchRate ?? 0.65);
  const yardsPerCatch = catchRate > 0 ? (inputs.yardsPerTarget ?? 0) / catchRate : 0;
  const receivingYards = positiveNormal(receptions * yardsPerCatch, Math.max(1, receptions * yardsPerCatch * 0.32), random);
  const rushingYards = positiveNormal(carries * (inputs.yardsPerCarry ?? 0), Math.max(1, carries * (inputs.yardsPerCarry ?? 0) * 0.35), random);
  Object.assign(sampled, { reception: receptions, receivingYards, receivingTouchdown: poisson(Math.max(0, inputs.touchdownProbability ?? 0) * scale, random), rushingYards });
  if (rules.receivingYardBonus) sampled.receivingYardBonus = receivingYards >= 100 ? 1 : 0;
  if (rules.rushingYardBonus) sampled.rushingYardBonus = rushingYards >= 100 ? 1 : 0;
  return sampled;
}
function sampleMlb(player: SlatePlayer, inputs: Record<string, number>, random: () => number): Record<string, number> {
  if (isPitcher(player)) { const innings = Math.round(positiveNormal(inputs.expectedInnings ?? 0, Math.max(0.25, (inputs.expectedInnings ?? 0) * 0.25), random) * 3) / 3; return { inningPitched: innings, strikeout: poisson(innings * (inputs.strikeoutsPerInning ?? 0), random), walkAgainst: poisson(innings * (inputs.walksPerInning ?? 0), random), hitAgainst: poisson(innings * (inputs.hitsAllowedPerInning ?? 0), random), earnedRun: poisson(innings * (inputs.earnedRunsPerInning ?? 0), random), ...(Number.isFinite(inputs.winProbability) ? { win: random() < clampRate(inputs.winProbability) ? 1 : 0 } : {}) }; }
  const pa = poisson(inputs.expectedPA ?? 0, random); const rates = ['single', 'double', 'triple', 'homeRun', 'walk', 'hitByPitch']; const raw = [inputs.singlesPerPA, inputs.doublesPerPA, inputs.triplesPerPA, inputs.homeRunsPerPA, inputs.walksPerPA, inputs.hitByPitchPerPA].map((value) => Math.max(0, value ?? 0)); const total = raw.reduce((sum, value) => sum + value, 0); const scale = total > 0.95 ? 0.95 / total : 1; const result: Record<string, number> = Object.fromEntries(rates.map((key) => [key, 0]));
  for (let i = 0; i < pa; i += 1) { let draw = random(); for (let j = 0; j < rates.length; j += 1) { draw -= raw[j] * scale; if (draw <= 0) { result[rates[j]] += 1; break; } } }
  result.rbi = poisson(pa * (inputs.rbiPerPA ?? 0), random); result.run = poisson(pa * (inputs.runsPerPA ?? 0), random); result.stolenBase = poisson(pa * (inputs.stolenBasesPerPA ?? 0), random); return result;
}
function sampleGolf(components: Record<string, number>, random: () => number): Record<string, number> { return { birdies: poisson(components.birdies ?? 0, random), eagles: poisson(components.eagles ?? 0, random), bogeys: poisson(components.bogeys ?? 0, random), pars: poisson(components.pars ?? 0, random), finishPositionBonus: components.finishPositionBonus ?? 0 }; }
function poisson(lambda: number, random: () => number): number { if (lambda <= 0) return 0; if (lambda > 30) return Math.max(0, Math.round(positiveNormal(lambda, Math.sqrt(lambda), random))); const threshold = Math.exp(-lambda); let product = 1; let count = 0; do { product *= Math.max(Number.EPSILON, random()); count += 1; } while (product > threshold); return count - 1; }
function binomial(trials: number, probability: number, random: () => number): number { let successes = 0; for (let i = 0; i < trials; i += 1) if (random() < probability) successes += 1; return successes; }
function positiveNormal(mean: number, deviation: number, random: () => number): number { const u1 = Math.max(Number.EPSILON, random()); const u2 = Math.max(Number.EPSILON, random()); return Math.max(0, mean + deviation * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)); }
function clampRate(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function thresholdProbability(mean: number, deviation: number, threshold: number): number { return 1 - normalCdf((threshold - mean) / deviation); }
function normalCdf(value: number): number { return 0.5 * (1 + erf(value / Math.SQRT2)); }
function erf(value: number): number { const sign = value < 0 ? -1 : 1; const x = Math.abs(value); const t = 1 / (1 + 0.3275911 * x); return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
function distributionFor(sport: Sport, player: SlatePlayer): PlayerProjection['distribution'] { if (sport === 'NBA' || sport === 'WNBA') return { family: 'SPORT_EVENT', correlationGroup: `${sport}:${gameGroup(player)}`, drivers: ['sampled minutes and stat counts', 'shared game environment', 'role-rate variance'] }; if (sport === 'NFL' || sport === 'CFB') return { family: 'SPORT_EVENT', correlationGroup: `${sport}:${gameGroup(player)}`, drivers: ['sampled play volume', 'sampled receptions and touchdowns', 'game environment', 'yardage threshold events'] }; if (sport === 'MLB') return { family: 'SPORT_EVENT', correlationGroup: `MLB:${gameGroup(player)}`, drivers: ['sampled plate appearances or innings', 'mutually exclusive batted-ball events', 'count-event variance'] }; return { family: 'GOLF_ROUND', correlationGroup: `GOLF:${player.playerId}`, drivers: ['sampled round scoring events', 'finish-position input when available'] }; }
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
    if (context?.minutesP10 !== undefined && Number.isFinite(context.minutesP10)) adjusted.minutesP10 = context.minutesP10;
    if (context?.minutesP90 !== undefined && Number.isFinite(context.minutesP90)) adjusted.minutesP90 = context.minutesP90;
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

function reconcileBasketballOpportunities(prepared: Array<{ player: SlatePlayer; values: Record<string, number>; adjustment?: PlayerAdjustment }>, slate: ValidatedSlate, gaps: ProjectionPackage['gaps']): void {
  const byTeam = new Map<string, typeof prepared>();
  for (const item of prepared) {
    const team = item.player.team;
    if (!team || !Number.isFinite(item.values.expectedMinutes)) continue;
    if (['OUT', 'INACTIVE', 'NOT_IN_PROVIDER_ROSTER'].includes(item.player.availability?.status ?? '')) continue;
    byTeam.set(team, [...(byTeam.get(team) ?? []), item]);
  }
  for (const [team, teamPlayers] of byTeam.entries()) {
    const total = teamPlayers.reduce((sum, player) => sum + (player.values.expectedMinutes ?? 0), 0);
    if (!(total > 0)) continue;
    const targetMinutes = slate.sport === 'WNBA' ? 200 : 240;
    if (total < targetMinutes - 1) gaps.push({ reason: `${team} ${slate.sport} projected player pool accounts for ${total.toFixed(1)} of ${targetMinutes} regulation minutes; incomplete rotation coverage is not inflated into the missing minutes.` });
    // Partial provider pools must not be inflated to a full team's minutes. Reconcile only
    // over-allocation; missing rotation minutes remain a visible coverage problem.
    if (total <= targetMinutes) continue;
    const factor = targetMinutes / total;
    for (const player of teamPlayers) {
      player.values = { ...player.values, expectedMinutes: (player.values.expectedMinutes ?? 0) * factor };
    }
  }
}
