import { deriveWnbaRoleMetrics } from './wnbaModel.ts';

export type OpportunitySport = 'nba' | 'wnba';
export type OpportunityInjuryStatus = 'out' | 'doubtful' | 'questionable' | 'probable' | 'day_to_day' | 'active';

export interface OpportunityPlayer {
  id: string;
  name: string;
  team: string;
  position: string;
  injury_status: OpportunityInjuryStatus;
  projection_source?: string;
  projected_points?: number;
  model_adjusted_fantasy_pts?: number;
  minutes_projection?: number;
  depth_chart_order?: number;
  context_score?: number;
  role_stability?: number;
  minutes_volatility?: number;
  recent_fantasy_per_minute?: number;
  minutes_trend?: 'up' | 'down' | 'stable' | 'unknown';
  news_note?: string;
  last_5_stats?: {
    avg_fantasy_pts: number;
    minutes_avg?: number;
    is_synthetic?: boolean;
    games: Array<Record<string, unknown>>;
  };
}

export interface OpportunityProjectionResult<T extends OpportunityPlayer> {
  players: T[];
  projectedCount: number;
  cascadeBoostCount: number;
  missingMinutesCount: number;
  clampedCount: number;
}

const NBA_POSITION_MEAN_PPM: Record<string, number> = {
  PG: 1.05,
  SG: 0.95,
  SF: 0.95,
  PF: 1.05,
  C: 1.15,
};

const WNBA_POSITION_MEAN_PPM: Record<string, number> = {
  PG: 0.91,
  SG: 0.84,
  SF: 0.86,
  PF: 0.94,
  C: 1.03,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function appendNote(existing: string | undefined, note: string): string {
  return [existing, note].filter(Boolean).join(' | ');
}

function normalizePositionPart(position: string): string {
  const part = String(position ?? '').toUpperCase();
  if (part === 'G') return 'PG';
  if (part === 'F') return 'SF';
  return part;
}

function positionParts(position: string): string[] {
  return String(position ?? '')
    .toUpperCase()
    .split('/')
    .map(normalizePositionPart)
    .filter(Boolean);
}

function positionGroups(position: string): Set<'guard' | 'wing' | 'center'> {
  const groups = new Set<'guard' | 'wing' | 'center'>();
  for (const part of positionParts(position)) {
    if (part === 'PG' || part === 'SG') groups.add('guard');
    if (part === 'SF' || part === 'PF') groups.add('wing');
    if (part === 'C') groups.add('center');
  }
  return groups;
}

function sharesPositionGroup(left: string, right: string): boolean {
  const leftGroups = positionGroups(left);
  const rightGroups = positionGroups(right);
  return [...leftGroups].some((group) => rightGroups.has(group));
}

export function recencyWeightedAverage(values: number[]): number | null {
  if (!values.length) return null;
  const weights = [0.4, 0.25, 0.17, 0.11, 0.07];
  const selected = values.slice(0, weights.length);
  const totalWeight = selected.reduce((sum, _value, index) => sum + (weights[index] ?? 0), 0);
  if (totalWeight <= 0) return null;
  return selected.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) / totalWeight;
}

export function minutesAverage(player: OpportunityPlayer, sport?: OpportunitySport): number | null {
  const direct = Number(player.last_5_stats?.minutes_avg);

  const games = player.last_5_stats?.games ?? [];
  const values = games.flatMap((game) => {
    const minutes = Number(game.minutes ?? game.avgMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? [minutes] : [];
  });
  if (sport === 'wnba' && values.length) return recencyWeightedAverage(values);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function positionMeanPpm(position: string, sport: OpportunitySport): number {
  const positionMeans = sport === 'wnba' ? WNBA_POSITION_MEAN_PPM : NBA_POSITION_MEAN_PPM;
  const parts = positionParts(position);
  const means = parts.flatMap((part) => {
    const mean = positionMeans[part];
    return typeof mean === 'number' ? [mean] : [];
  });
  const mean = means.length
    ? means.reduce((sum, value) => sum + value, 0) / means.length
    : sport === 'wnba' ? 0.88 : 1;
  return mean;
}

export function redistributeMinutes<T extends OpportunityPlayer>(players: T[]): {
  players: T[];
  cascadeBoostCount: number;
} {
  const byTeam = new Map<string, T[]>();
  for (const player of players) {
    byTeam.set(player.team, [...(byTeam.get(player.team) ?? []), player]);
  }

  const addedByPlayer = new Map<string, { minutes: number; notes: string[] }>();

  for (const teamPlayers of byTeam.values()) {
    const injured = teamPlayers.filter((player) => (
      (player.injury_status === 'out' || player.injury_status === 'doubtful')
      && (player.minutes_projection ?? 0) >= 15
    ));

    for (const outPlayer of injured) {
      const minutesToRedistribute = (outPlayer.minutes_projection ?? 0) * 0.7;
      if (minutesToRedistribute <= 0) continue;

      const candidates = teamPlayers.filter((candidate) => (
        candidate.id !== outPlayer.id
        && candidate.injury_status === 'active'
        && sharesPositionGroup(candidate.position, outPlayer.position)
        && (candidate.minutes_projection ?? 0) < 38
      ));
      if (!candidates.length) continue;

      const weights = candidates.map((candidate) => {
        const minutesWeight = Math.max(candidate.minutes_projection ?? 0, 1);
        const depth = Number(candidate.depth_chart_order);
        const depthWeight = Number.isFinite(depth) && depth > 0 ? 1 / depth : 1;
        return { candidate, weight: minutesWeight * depthWeight };
      });
      const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight <= 0) continue;

      for (const { candidate, weight } of weights) {
        const currentMinutes = candidate.minutes_projection ?? 0;
        const rawAdded = minutesToRedistribute * (weight / totalWeight);
        const added = Math.max(0, Math.min(rawAdded, 38 - currentMinutes));
        if (added <= 0) continue;
        const existing = addedByPlayer.get(candidate.id) ?? { minutes: 0, notes: [] };
        existing.minutes += added;
        existing.notes.push(`+${added.toFixed(1)} min projected (${outPlayer.name} out)`);
        addedByPlayer.set(candidate.id, existing);
        candidate.minutes_projection = currentMinutes + added;
      }
    }
  }

  let cascadeBoostCount = 0;
  const updatedPlayers = players.map((player) => {
    const added = addedByPlayer.get(player.id);
    const rawMinutes = player.minutes_projection ?? minutesAverage(player) ?? 0;
    const projectedMinutes = Number(clamp(rawMinutes, 4, 40).toFixed(2));
    if (!added) {
      return { ...player, minutes_projection: projectedMinutes };
    }
    cascadeBoostCount += 1;
    return {
      ...player,
      minutes_projection: projectedMinutes,
      context_score: Number(((player.context_score ?? 0) + (added.minutes / 36) * 0.5).toFixed(3)),
      news_note: appendNote(player.news_note, added.notes.join('; ')),
    };
  });

  return { players: updatedPlayers, cascadeBoostCount };
}

export function computeOpportunityProjection<T extends OpportunityPlayer>(
  players: T[],
  sport: OpportunitySport,
): OpportunityProjectionResult<T> {
  let missingMinutesCount = 0;
  const preparedPlayers = players.map((player) => {
    const games = player.last_5_stats?.games ?? [];
    const realGames = games.length > 0 && !player.last_5_stats?.is_synthetic;
    const avgMinutes = realGames ? minutesAverage(player, sport) : null;
    if (realGames && avgMinutes === null) missingMinutesCount += 1;
    return {
      ...player,
      minutes_projection: avgMinutes !== null ? clamp(avgMinutes, 4, 40) : player.minutes_projection,
    };
  });

  const redistributed = redistributeMinutes(preparedPlayers);
  let projectedCount = 0;
  let clampedCount = 0;

  const projectedPlayers = redistributed.players.map((player) => {
    const games = player.last_5_stats?.games ?? [];
    if (!games.length || player.last_5_stats?.is_synthetic) return player;
    if (player.injury_status === 'out' || player.injury_status === 'doubtful') return player;
    const baseProjection = Number(player.projected_points);
    const avgFantasyPts = Number(player.last_5_stats?.avg_fantasy_pts);
    const projectedMinutes = Number(player.minutes_projection);
    if (!Number.isFinite(baseProjection) || baseProjection <= 0 || !Number.isFinite(avgFantasyPts) || !Number.isFinite(projectedMinutes)) {
      return player;
    }

    const gamesPlayed = games.length;
    const minutesAvg = Math.max(minutesAverage(player, sport) ?? projectedMinutes, 1);
    const roleMetrics = sport === 'wnba' ? deriveWnbaRoleMetrics(games) : null;
    const ppm = roleMetrics?.recentFantasyPerMinute ?? avgFantasyPts / minutesAvg;
    const meanPpm = positionMeanPpm(player.position, sport);
    const ppmRegressed = ppm * (gamesPlayed / (gamesPlayed + 3)) + meanPpm * (3 / (gamesPlayed + 3));
    const opportunityProjection = projectedMinutes * ppmRegressed;
    // WNBA's opportunity projection already uses the same recent games to derive
    // both projected minutes and role-adjusted FPPM. Blending it back into the
    // same last-five total would count that sample twice. NBA retains the prior
    // blend until it has an equivalent role model.
    const opportunityWeight = sport === 'wnba' ? 1 : player.projection_source === 'props_blend' ? 0.3 : 0.5;
    const rawBlended = opportunityProjection * opportunityWeight + baseProjection * (1 - opportunityWeight);
    const confirmedCascade = /\bout\)/i.test(player.news_note ?? '') || /\bprojected \(.+ out\)/i.test(player.news_note ?? '');
    const clampWidth = confirmedCascade ? 0.55 : player.injury_status === 'questionable' ? 0.22 : 0.35;
    const minProjection = baseProjection * (1 - clampWidth);
    const maxProjection = baseProjection * (1 + clampWidth);
    const clampedProjection = clamp(rawBlended, minProjection, maxProjection);
    const wasClamped = Math.abs(clampedProjection - rawBlended) > 0.01;
    if (wasClamped) clampedCount += 1;
    projectedCount += 1;

    const roleNote = roleMetrics?.roleStability !== null && roleMetrics?.roleStability !== undefined
      ? `WNBA role stability ${Math.round(roleMetrics.roleStability * 100)}% (${roleMetrics.minutes_trend ?? 'unknown'} minutes)`
      : '';
    return {
      ...player,
      projection_source: 'opportunity_blend',
      projected_points: Number(clampedProjection.toFixed(2)),
      model_adjusted_fantasy_pts: Number(clampedProjection.toFixed(2)),
      role_stability: roleMetrics?.roleStability ?? player.role_stability,
      minutes_volatility: roleMetrics?.minutesVolatility ?? player.minutes_volatility,
      recent_fantasy_per_minute: roleMetrics?.recentFantasyPerMinute ?? player.recent_fantasy_per_minute,
      minutes_trend: roleMetrics?.minutesTrend ?? player.minutes_trend,
      news_note: [
        player.news_note,
        roleNote,
        wasClamped ? `opportunity projection clamped to ${Math.round(clampWidth * 100)}% move` : '',
      ].filter(Boolean).join(' | ') || undefined,
    };
  });

  return {
    players: projectedPlayers,
    projectedCount,
    cascadeBoostCount: redistributed.cascadeBoostCount,
    missingMinutesCount,
    clampedCount,
  };
}
