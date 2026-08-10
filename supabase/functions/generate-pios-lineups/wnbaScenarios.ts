export type WnbaScenarioState = 'active' | 'limited' | 'inactive';

export interface WnbaOutcomeScenario {
  state: WnbaScenarioState;
  probability: number;
  minutes_multiplier?: number;
  production_multiplier?: number;
  evidence?: string;
}

export function normalizeWnbaScenarios(value: unknown): WnbaOutcomeScenario[] {
  if (!Array.isArray(value)) return [];
  const scenarios = value.map((raw) => {
    const row = raw as Record<string, unknown>;
    const state = row.state;
    if (state !== 'active' && state !== 'limited' && state !== 'inactive') return null;
    const probability = Number(row.probability);
    if (!Number.isFinite(probability) || probability < 0) return null;
    const minutesMultiplier = Number(row.minutes_multiplier);
    const productionMultiplier = Number(row.production_multiplier);
    return {
      state,
      probability,
      minutes_multiplier: Number.isFinite(minutesMultiplier) && minutesMultiplier >= 0 ? minutesMultiplier : undefined,
      production_multiplier: Number.isFinite(productionMultiplier) && productionMultiplier >= 0 ? productionMultiplier : undefined,
      evidence: typeof row.evidence === 'string' ? row.evidence : undefined,
    } satisfies WnbaOutcomeScenario;
  }).filter((scenario): scenario is WnbaOutcomeScenario => scenario !== null && scenario.probability > 0);
  const total = scenarios.reduce((sum, scenario) => sum + scenario.probability, 0);
  return total > 0 ? scenarios.map((scenario) => ({ ...scenario, probability: scenario.probability / total })) : [];
}

export function selectWnbaScenario(scenarios: WnbaOutcomeScenario[], randomValue = Math.random()): WnbaOutcomeScenario | null {
  const normalized = normalizeWnbaScenarios(scenarios);
  if (!normalized.length) return null;
  let cursor = Math.min(Math.max(randomValue, 0), 0.999999999);
  for (const scenario of normalized) {
    cursor -= scenario.probability;
    if (cursor <= 0) return scenario;
  }
  return normalized[normalized.length - 1] ?? null;
}
