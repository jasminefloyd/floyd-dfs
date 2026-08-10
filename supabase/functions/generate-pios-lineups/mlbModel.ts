export interface MlbProxyPlayer {
  player_id: string;
  name?: string;
  team?: string;
  opponent_team?: string;
  position?: string;
  projected_points?: number;
  ownership_projection?: number;
  batting_order?: number;
  confirmed_starter?: boolean;
  own_probable_starter?: boolean;
  stdev_fantasy_pts?: number;
  p90_projection?: number;
  p95_projection?: number;
  implied_total?: number;
  run_factor?: number;
  context_score?: number;
}

export interface MlbProxyDistribution {
  mean: number;
  floor: number;
  p90: number;
  p95: number;
  stdev: number;
  ceiling_probability: number;
  bust_probability: number;
  source: 'proxy_public_inputs';
}

export interface MlbProxyStack {
  team: string;
  hitter_count: number;
  average_projection: number;
  implied_total: number | null;
  ownership_sum: number;
  stack_score: number;
  source: 'proxy_public_inputs';
}

export function isMlbPitcher(player: Pick<MlbProxyPlayer, 'position'>): boolean {
  return /^(P|SP|RP)$/i.test(String(player.position ?? ''));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function buildMlbProxyDistribution(player: MlbProxyPlayer): MlbProxyDistribution {
  const mean = Math.max(0, Number(player.projected_points ?? 0));
  const pitcher = isMlbPitcher(player);
  const baseStdev = finite(player.stdev_fantasy_pts) && player.stdev_fantasy_pts > 0
    ? player.stdev_fantasy_pts
    : mean * (pitcher ? 0.42 : 0.62);
  const contextVolatility = Math.abs(Number(player.context_score ?? 0)) * mean * 0.08;
  const stdev = Math.max(1, baseStdev + contextVolatility);
  const floor = Math.max(0, mean - stdev * (pitcher ? 1.15 : 1.35));
  const p90 = Math.max(mean, finite(player.p90_projection) ? player.p90_projection : mean + stdev * (pitcher ? 1.25 : 1.55));
  const p95 = Math.max(p90, finite(player.p95_projection) ? player.p95_projection : mean + stdev * (pitcher ? 1.7 : 2.1));
  return {
    mean: Number(mean.toFixed(3)),
    floor: Number(floor.toFixed(3)),
    p90: Number(p90.toFixed(3)),
    p95: Number(p95.toFixed(3)),
    stdev: Number(stdev.toFixed(3)),
    ceiling_probability: Number(clamp((p95 - mean) / Math.max(p95, 1), 0.01, 0.35).toFixed(4)),
    bust_probability: Number(clamp((mean - floor) / Math.max(mean * 2, 1), 0.05, 0.65).toFixed(4)),
    source: 'proxy_public_inputs',
  };
}

export function buildMlbProxyStacks(players: MlbProxyPlayer[]): MlbProxyStack[] {
  const byTeam = new Map<string, MlbProxyPlayer[]>();
  for (const player of players) {
    if (isMlbPitcher(player)) continue;
    const team = String(player.team ?? '').toUpperCase();
    if (team) byTeam.set(team, [...(byTeam.get(team) ?? []), player]);
  }
  return [...byTeam.entries()].map(([team, hitters]) => {
    const projections = hitters.map((player) => Number(player.projected_points ?? 0));
    const ownership = hitters.reduce((sum, player) => sum + Number(player.ownership_projection ?? 0.08), 0);
    const impliedTotals = hitters.map((player) => player.implied_total).filter(finite);
    const orderBonus = hitters.reduce((sum, player) => {
      const order = Number(player.batting_order);
      return sum + (order >= 1 && order <= 5 ? 0.12 : order >= 6 && order <= 9 ? 0.04 : 0);
    }, 0);
    const runFactor = hitters.reduce((sum, player) => sum + Number(player.run_factor ?? 1), 0) / Math.max(hitters.length, 1);
    return {
      team,
      hitter_count: hitters.length,
      average_projection: projections.reduce((sum, value) => sum + value, 0) / Math.max(projections.length, 1),
      implied_total: impliedTotals.length ? impliedTotals.reduce((sum, value) => sum + value, 0) / impliedTotals.length : null,
      ownership_sum: ownership,
      stack_score: Number((projections.reduce((sum, value) => sum + value, 0) * (1 + orderBonus) * runFactor / Math.max(ownership, 0.25)).toFixed(4)),
      source: 'proxy_public_inputs' as const,
    };
  }).sort((a, b) => b.stack_score - a.stack_score);
}

export function mlbProxyFieldWeight(player: MlbProxyPlayer, mode: 'chalk' | 'random' | 'leverage'): number {
  const projection = Math.max(Number(player.projected_points ?? 0), 0.1);
  const ownership = clamp(Number(player.ownership_projection ?? 0.08), 0.01, 0.95);
  if (mode === 'chalk') return projection * (0.65 + ownership * 0.9);
  if (mode === 'leverage') return projection / Math.sqrt(ownership);
  return Math.max(0.01, projection * (0.35 + Math.random() * 0.65));
}
