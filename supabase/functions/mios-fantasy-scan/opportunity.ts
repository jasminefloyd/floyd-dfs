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
  minutes_projection?: number;
  depth_chart_order?: number;
  context_score?: number;
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

export function minutesAverage(player: OpportunityPlayer): number | null {
  const direct = Number(player.last_5_stats?.minutes_avg);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const games = player.last_5_stats?.games ?? [];
  const values = games.flatMap((game) => {
    const minutes = Number(game.minutes ?? game.avgMinutes);
    return Number.isFinite(minutes) && minutes > 0 ? [minutes] : [];
  });
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function positionMeanPpm(position: string, sport: OpportunitySport): number {
  const parts = positionParts(position);
  const means = parts.flatMap((part) => {
    const mean = NBA_POSITION_MEAN_PPM[part];
    return typeof mean === 'number' ? [mean] : [];
  });
  const nbaMean = means.length
    ? means.reduce((sum, value) => sum + value, 0) / means.length
    : 1;
  // Tunable baseline priors: NBA means are approximate DK points/minute by position;
  // WNBA uses the same shape scaled by 0.85 until enough local calibration exists.
  return sport === 'wnba' ? nbaMean * 0.85 : nbaMean;
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
    const avgMinutes = realGames ? minutesAverage(player) : null;
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
    const minutesAvg = Math.max(minutesAverage(player) ?? projectedMinutes, 1);
    const ppm = avgFantasyPts / minutesAvg;
    const meanPpm = positionMeanPpm(player.position, sport);
    const ppmRegressed = ppm * (gamesPlayed / (gamesPlayed + 3)) + meanPpm * (3 / (gamesPlayed + 3));
    const opportunityProjection = projectedMinutes * ppmRegressed;
    const opportunityWeight = player.projection_source === 'props_blend' ? 0.3 : 0.5;
    const rawBlended = opportunityProjection * opportunityWeight + baseProjection * (1 - opportunityWeight);
    const minProjection = baseProjection * 0.65;
    const maxProjection = baseProjection * 1.35;
    const clampedProjection = clamp(rawBlended, minProjection, maxProjection);
    const wasClamped = Math.abs(clampedProjection - rawBlended) > 0.01;
    if (wasClamped) clampedCount += 1;
    projectedCount += 1;

    return {
      ...player,
      projection_source: 'opportunity_blend',
      projected_points: Number(clampedProjection.toFixed(2)),
      news_note: wasClamped
        ? appendNote(player.news_note, 'opportunity projection clamped to 35% move')
        : player.news_note,
      last_5_stats: player.last_5_stats ? {
        ...player.last_5_stats,
        avg_fantasy_pts: Number(clampedProjection.toFixed(2)),
      } : player.last_5_stats,
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
