export interface WnbaComponentProjection {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  threes: number;
  fantasyPoints: number;
  fantasyStdDev: number;
  sampleSize: number;
  source: 'role_filtered_history' | 'position_hierarchical_prior';
  blendVersion: 'wnba-components-v1';
}

type Component = keyof Pick<WnbaComponentProjection, 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers' | 'threes'>;
const POSITION_PRIORS: Record<string, Record<Component, number>> = {
  PG: { points: 12.5, rebounds: 3.5, assists: 5.1, steals: 1.2, blocks: 0.3, turnovers: 2.1, threes: 1.5 },
  SG: { points: 12.1, rebounds: 3.7, assists: 2.7, steals: 1.1, blocks: 0.3, turnovers: 1.7, threes: 1.7 },
  SF: { points: 11.6, rebounds: 5.0, assists: 2.5, steals: 1.0, blocks: 0.5, turnovers: 1.6, threes: 1.1 },
  PF: { points: 11.8, rebounds: 6.5, assists: 2.1, steals: 0.9, blocks: 0.8, turnovers: 1.7, threes: 0.7 },
  C: { points: 12.4, rebounds: 7.4, assists: 1.8, steals: 0.7, blocks: 1.3, turnovers: 1.8, threes: 0.3 },
};
const COMPONENT_KEYS: Record<Component, string[]> = {
  points: ['points', 'pts'], rebounds: ['totalRebounds', 'rebounds', 'reb'], assists: ['assists', 'ast'],
  steals: ['steals', 'stl'], blocks: ['blocks', 'blk'], turnovers: ['turnovers', 'tov', 'to'], threes: ['threePointFieldGoalsMade', 'fg3m', 'threes'],
};

function numberFrom(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}
function positionPrior(position: string, component: Component): number {
  const parts = String(position).toUpperCase().split('/');
  const values = parts.map((part) => POSITION_PRIORS[part]?.[component]).filter((value): value is number => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : POSITION_PRIORS.SF[component];
}
function mean(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

export function deriveWnbaComponentProjection(
  games: Array<Record<string, unknown>>,
  options: { position: string; projectedMinutes?: number; roleStability?: number; propComponents?: Partial<Record<Component, number>> } ,
): WnbaComponentProjection {
  const minutes = games.map((game) => numberFrom(game, ['minutes', 'avgMinutes'])).filter((value): value is number => value !== null && value > 0);
  const projectedMinutes = Number(options.projectedMinutes);
  const minuteScale = Number.isFinite(projectedMinutes) && projectedMinutes > 0 && minutes.length
    ? projectedMinutes / Math.max(mean(minutes) ?? projectedMinutes, 1) : 1;
  const sampleSize = minutes.length;
  const reliability = Math.min(0.72, sampleSize / 12) * (0.65 + 0.35 * Math.max(0, Math.min(1, Number(options.roleStability) || 0.45)));
  const componentValues = (component: Component) => games
    .map((game) => numberFrom(game, COMPONENT_KEYS[component]))
    .filter((value): value is number => value !== null && value >= 0);
  const values = {} as Record<Component, number>;
  (Object.keys(COMPONENT_KEYS) as Component[]).forEach((component) => {
    const history = mean(componentValues(component));
    const prop = Number(options.propComponents?.[component]);
    const historical = history === null ? positionPrior(options.position, component) : history;
    const baseline = historical * minuteScale;
    // Props are a bounded external signal, never an untraceable replacement for role history.
    const marketBlend = Number.isFinite(prop) && prop >= 0 ? baseline * 0.72 + prop * 0.28 : baseline;
    values[component] = Math.max(0, marketBlend * reliability + positionPrior(options.position, component) * minuteScale * (1 - reliability));
  });
  const categories = [values.points, values.rebounds, values.assists, values.steals, values.blocks];
  const doubleDoubleChance = categories.filter((value) => value >= 8).length >= 2 ? 0.34 : categories.filter((value) => value >= 6).length >= 2 ? 0.12 : 0.03;
  const fantasyPoints = values.points + values.rebounds * 1.2 + values.assists * 1.5 + values.steals * 3 + values.blocks * 3 - values.turnovers * 0.5 + values.threes * 0.5 + doubleDoubleChance * 1.5;
  return {
    ...Object.fromEntries((Object.keys(COMPONENT_KEYS) as Component[]).map((component) => [component, Number(values[component].toFixed(2))])) as Record<Component, number>,
    fantasyPoints: Number(fantasyPoints.toFixed(2)), fantasyStdDev: Number(Math.max(4, fantasyPoints * (0.22 + (1 - reliability) * 0.16)).toFixed(2)),
    sampleSize, source: sampleSize >= 4 ? 'role_filtered_history' : 'position_hierarchical_prior', blendVersion: 'wnba-components-v1',
  };
}
