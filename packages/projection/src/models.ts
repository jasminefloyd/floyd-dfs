import type { AdjustmentPackage, PlayerProjection, ProjectionInput, ProjectionModel, ProjectionPackage, Sport, ValidatedSlate } from "@sports-engine/contracts";

const MODEL_VERSION = "projection.deterministic.v1";
const SIMULATION_RUNS = 256;
const REQUIRED: Record<Sport, string[]> = {
  NBA: ["expectedMinutes", "pointsPerMinute", "reboundsPerMinute", "assistsPerMinute", "stealsPerMinute", "blocksPerMinute", "turnoversPerMinute", "threesPerMinute"],
  WNBA: ["expectedMinutes", "pointsPerMinute", "reboundsPerMinute", "assistsPerMinute", "stealsPerMinute", "blocksPerMinute", "turnoversPerMinute", "threesPerMinute"],
  NFL: ["snaps", "routes", "targets", "carries", "catchRate", "yardsPerTarget", "yardsPerCarry", "touchdownProbability"],
  MLB: ["expectedPA", "hitRate", "totalBasesPerPA", "rbiPerPA", "runsPerPA", "stolenBasesPerPA"],
  GOLF: ["birdiesPerRound", "eaglesPerRound", "bogeysPerRound", "parsPerRound", "roundsRemaining"],
};

const MAGNITUDE: Record<string, number> = { NONE: 0, SMALL: 0.03, MODERATE: 0.08, MATERIAL: 0.15, MAJOR: 0.3 };

export class DeterministicProjectionModel implements ProjectionModel {
  constructor(readonly sport: Sport) {}

  project(input: ProjectionInput, now = new Date()): ProjectionPackage {
    const players: PlayerProjection[] = [];
    const gaps = [] as ProjectionPackage["gaps"];
    for (const player of input.validatedSlate.playerPool) {
      const values = player.projectionInputs;
      const missing = REQUIRED[this.sport].filter((key) => !values || !Number.isFinite(values[key]));
      if (missing.length && !Number.isFinite(player.providerFppg)) {
        gaps.push({ playerId: player.playerId, question: `What explicit opportunity inputs are required for ${player.playerName}?`, reason: `Missing required quantitative inputs: ${missing.join(", ")}. No projection was generated.`, importance: "CRITICAL" });
        continue;
      }
      const adjustment = input.adjustmentPackage.adjustments.find((item) => item.playerId === player.playerId);
      players.push(values ? this.projectPlayer(player, values, adjustment, input.validatedSlate.scoringRules) : this.projectFromProviderFppg(player, adjustment));
    }
    const status = players.length === 0 ? "BLOCKED" : gaps.length || input.adjustmentPackage.status !== "COMPLETE" ? "PARTIAL" : "COMPLETE";
    return { slateId: input.validatedSlate.slateId, tenantId: input.validatedSlate.tenantId, sport: this.sport, version: 1, generatedAt: now.toISOString(), modelVersion: MODEL_VERSION, simulationRuns: SIMULATION_RUNS, players, gaps, status };
  }

  private projectFromProviderFppg(player: ValidatedSlate["playerPool"][number], adjustment: AdjustmentPackage["adjustments"][number] | undefined): PlayerProjection {
    const factor = adjustmentFactor(adjustment);
    const median = (player.providerFppg ?? 0) * factor;
    return {
      playerId: player.playerId,
      salary: player.salary,
      baselineOpportunity: { providerFppg: player.providerFppg ?? 0 },
      adjustedOpportunity: { providerFppg: median },
      opportunityDelta: { providerFppg: median - (player.providerFppg ?? 0) },
      componentProjection: { providerFppg: median },
      projectedOutcomes: { floorP20: median * 0.85, medianP50: median, ceilingP90: median * 1.15 },
      salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? median * 1.15 / (player.salary / 1000) : 0 },
      confidence: "LOW",
      uncertaintyFactors: ["Projection uses DraftKings provider FPPG because component-level opportunity inputs were unavailable."],
      watchDependencies: adjustment?.projectionNotes ?? [],
      modelVersion: `${MODEL_VERSION}.provider-fppg-fallback`,
    };
  }

  private projectPlayer(player: ValidatedSlate["playerPool"][number], values: Record<string, number>, adjustment: AdjustmentPackage["adjustments"][number] | undefined, scoringRules: ValidatedSlate["scoringRules"]): PlayerProjection {
    const factor = adjustmentFactor(adjustment);
    const baselineOpportunity = { ...values };
    const adjustedOpportunity = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * factor]));
    const opportunityDelta = Object.fromEntries(Object.entries(adjustedOpportunity).map(([key, value]) => [key, value - values[key]]));
    const components = componentsFor(this.sport, adjustedOpportunity);
    const median = scoreComponents(components, scoringRules);
    const samples = simulateScores(components, scoringRules, `${player.playerId}:${this.sport}`);
    const floor = quantile(samples, 0.2);
    const ceiling = quantile(samples, 0.9);
    const uncertaintyFactors = adjustment?.roleCertainty === "LOW" ? ["Role certainty is LOW."] : [];
    if (adjustment?.adjustments.some((item) => item.confidence === "LOW")) uncertaintyFactors.push("At least one adjustment has LOW confidence.");
    return { playerId: player.playerId, salary: player.salary, baselineOpportunity, adjustedOpportunity, opportunityDelta, componentProjection: components, projectedOutcomes: { floorP20: floor, medianP50: median, ceilingP90: ceiling }, salaryEfficiency: { medianPer1k: player.salary ? median / (player.salary / 1000) : 0, ceilingPer1k: player.salary ? ceiling / (player.salary / 1000) : 0 }, confidence: uncertaintyFactors.length ? "LOW" : adjustment ? "MEDIUM" : "LOW", uncertaintyFactors, watchDependencies: inputWatch(adjustment), modelVersion: MODEL_VERSION };
  }
}

function componentsFor(sport: Sport, v: Record<string, number>): Record<string, number> {
  if (sport === "NBA" || sport === "WNBA") return { points: v.expectedMinutes * v.pointsPerMinute, threes: v.expectedMinutes * v.threesPerMinute, rebounds: v.expectedMinutes * v.reboundsPerMinute, assists: v.expectedMinutes * v.assistsPerMinute, steals: v.expectedMinutes * v.stealsPerMinute, blocks: v.expectedMinutes * v.blocksPerMinute, turnovers: v.expectedMinutes * v.turnoversPerMinute };
  if (sport === "NFL") return { receptions: v.targets * v.catchRate, receivingYards: v.targets * v.yardsPerTarget, rushingYards: v.carries * v.yardsPerCarry, touchdowns: v.touchdownProbability };
  if (sport === "MLB") return { hits: v.expectedPA * v.hitRate, totalBases: v.expectedPA * v.totalBasesPerPA, rbi: v.expectedPA * v.rbiPerPA, runs: v.expectedPA * v.runsPerPA, stolenBases: v.expectedPA * v.stolenBasesPerPA };
  return { birdies: v.birdiesPerRound * v.roundsRemaining, eagles: v.eaglesPerRound * v.roundsRemaining, bogeys: v.bogeysPerRound * v.roundsRemaining, pars: v.parsPerRound * v.roundsRemaining };
}

function scoreComponents(components: Record<string, number>, rules: ValidatedSlate["scoringRules"]): number { return Object.entries(components).reduce((total, [key, value]) => total + value * (rules[key]?.value ?? 0), 0); }

function simulateScores(components: Record<string, number>, rules: ValidatedSlate["scoringRules"], seedText: string): number[] { let seed = [...seedText].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7); const scores: number[] = []; for (let i = 0; i < SIMULATION_RUNS; i += 1) { const sampled = Object.fromEntries(Object.entries(components).map(([key, value]) => { seed = (1664525 * seed + 1013904223) >>> 0; const noise = ((seed / 4294967296) - 0.5) * 0.4; return [key, Math.max(0, value * (1 + noise))]; })); scores.push(scoreComponents(sampled, rules)); } return scores.sort((a, b) => a - b); }
function quantile(values: number[], q: number): number { return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * q)))]; }
function adjustmentFactor(adjustment: AdjustmentPackage["adjustments"][number] | undefined): number { if (!adjustment) return 1; const magnitude = Math.max(...adjustment.adjustments.map((item) => MAGNITUDE[item.magnitude] ?? 0), 0); return adjustment.netOpportunityDirection.includes("UP") ? 1 + magnitude : adjustment.netOpportunityDirection.includes("DOWN") ? 1 - magnitude : 1; }
function inputWatch(adjustment: AdjustmentPackage["adjustments"][number] | undefined): string[] { return adjustment?.projectionNotes ?? []; }

export function createProjectionModel(sport: Sport): DeterministicProjectionModel { return new DeterministicProjectionModel(sport); }
