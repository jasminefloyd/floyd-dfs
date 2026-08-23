export const LEARNING_MINIMUM_SAMPLE_SIZE = 30;

export interface LearningPlayerRow {
  player_id?: string;
  player_name?: string;
  team?: string;
  roster_slot?: string;
  projected_points?: number | null;
  actual_points?: number | null;
  ownership_projection?: number | null;
  actual_ownership?: number | null;
  leverage_score?: number | null;
  script_key?: string | null;
  position?: string;
  salary?: number | null;
  opponent_team?: string;
}

export interface LearningLineupRow {
  id: string;
  sport: string;
  contest_date: string;
  contest_type: string;
  contest_strategy?: string | null;
  players: LearningPlayerRow[];
  projected_points?: number | null;
  actual_points?: number | null;
  payout?: number | null;
  config?: Record<string, unknown>;
}

const numeric = (value: unknown): number | null => Number.isFinite(Number(value)) ? Number(value) : null;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

export function comparePlayers(lineups: LearningLineupRow[]) {
  const groups = new Map<string, Array<{ sport: string; player: LearningPlayerRow }>>();
  lineups.flatMap((lineup) => lineup.players).forEach((player) => {
    const key = String(player.player_id ?? player.player_name ?? '').trim().toLowerCase();
    const sport = lineups.find((lineup) => lineup.players.includes(player))?.sport ?? 'unknown';
    if (key) groups.set(`${sport}:${key}`, [...(groups.get(`${sport}:${key}`) ?? []), { sport, player }]);
  });
  return [...groups.entries()].map(([player_key, entries]) => {
    const rows = entries.map((entry) => entry.player);
    const errors = rows.flatMap((row) => { const projected = numeric(row.projected_points); const actual = numeric(row.actual_points); return projected !== null && actual !== null ? [actual - projected] : []; });
    const ownershipErrors = rows.flatMap((row) => { const projected = numeric(row.ownership_projection); const actual = numeric(row.actual_ownership); return projected !== null && actual !== null ? [actual - projected] : []; });
    const salaries = rows.map((row) => numeric(row.salary)).filter((value): value is number => value !== null);
    return {
      player_key,
      player_name: rows[0].player_name ?? player_key,
      sport: entries[0].sport,
      roles: [...new Set(rows.map((row) => row.position).filter(Boolean))],
      matchup_context: [...new Set(rows.map((row) => row.opponent_team).filter(Boolean))],
      salary_tier: average(salaries) === null ? null : average(salaries)! >= 7000 ? 'high' : average(salaries)! >= 4500 ? 'mid' : 'value',
      samples: rows.length,
      average_projection_error: average(errors),
      average_ownership_error: average(ownershipErrors),
      average_actual_points: average(rows.map((row) => numeric(row.actual_points)).filter((value): value is number => value !== null)),
      minimum_sample_size: LEARNING_MINIMUM_SAMPLE_SIZE,
      eligible_for_rule: rows.length >= LEARNING_MINIMUM_SAMPLE_SIZE,
    };
  });
}

export function compareCaptains(lineups: LearningLineupRow[]) {
  const captainRows = lineups.flatMap((lineup) => lineup.players.filter((player) => /^(cpt|captain)$/i.test(String(player.roster_slot ?? ''))).map((player) => ({ lineup, player })));
  const actual = captainRows.map(({ player }) => numeric(player.actual_points)).filter((value): value is number => value !== null);
  const projected = captainRows.map(({ player }) => numeric(player.projected_points)).filter((value): value is number => value !== null);
  const optimal = lineups.map((lineup) => Math.max(...lineup.players.map((player) => numeric(player.actual_points) ?? -Infinity))).filter(Number.isFinite);
  return {
    samples: captainRows.length,
    captain_selection_rate: lineups.length ? captainRows.length / lineups.length : 0,
    average_projected_captain_points: average(projected),
    average_actual_captain_points: average(actual),
    actual_optimal_captain_frequency: actual.length && optimal.length ? actual.filter((value, index) => value >= (optimal[index] ?? value)).length / actual.length : null,
    minimum_sample_size: LEARNING_MINIMUM_SAMPLE_SIZE,
    eligible_for_rule: captainRows.length >= LEARNING_MINIMUM_SAMPLE_SIZE,
  };
}

export function comparePortfolios(lineups: LearningLineupRow[]) {
  const groups = new Map<string, LearningLineupRow[]>();
  lineups.forEach((lineup) => {
    const key = `${lineup.contest_date}:${lineup.contest_type}:${lineup.contest_strategy ?? 'unknown'}`;
    groups.set(key, [...(groups.get(key) ?? []), lineup]);
  });
  return [...groups.entries()].map(([portfolio_key, rows]) => {
    const playerSets = rows.map((row) => new Set(row.players.map((player) => String(player.player_id ?? player.player_name ?? ''))));
    const shared = playerSets.length > 1 ? playerSets.slice(1).reduce((sum, set) => sum + [...set].filter((player) => playerSets[0].has(player)).length, 0) / (playerSets[0].size || 1) : 0;
    const scripts = rows.map((row) => String(row.config?.script_key ?? row.config?.scenarioKey ?? 'unknown'));
    return {
      portfolio_key,
      lineups: rows.length,
      script_count: new Set(scripts).size,
      max_shared_player_rate: shared,
      average_projected_points: average(rows.map((row) => numeric(row.projected_points)).filter((value): value is number => value !== null)),
      average_actual_points: average(rows.map((row) => numeric(row.actual_points)).filter((value): value is number => value !== null)),
      total_payout: rows.reduce((sum, row) => sum + (numeric(row.payout) ?? 0), 0),
    };
  });
}

export function compareScripts(lineups: LearningLineupRow[]) {
  const groups = new Map<string, LearningLineupRow[]>();
  lineups.forEach((lineup) => {
    const script = String(lineup.config?.script_key ?? lineup.config?.scenarioKey ?? 'unknown');
    groups.set(`${lineup.sport}:${script}`, [...(groups.get(`${lineup.sport}:${script}`) ?? []), lineup]);
  });
  return [...groups.entries()].map(([script_key, rows]) => ({
    script_key,
    samples: rows.length,
    average_projected_points: average(rows.map((row) => numeric(row.projected_points)).filter((value): value is number => value !== null)),
    average_actual_points: average(rows.map((row) => numeric(row.actual_points)).filter((value): value is number => value !== null)),
    average_payout: average(rows.map((row) => numeric(row.payout)).filter((value): value is number => value !== null)),
    minimum_sample_size: LEARNING_MINIMUM_SAMPLE_SIZE,
    eligible_for_rule: rows.length >= LEARNING_MINIMUM_SAMPLE_SIZE,
  }));
}

export function shadowPromotionGate(args: { candidateSamples: number; candidateScore: number; baselineScore: number; minimumSamples?: number }) {
  const minimumSamples = args.minimumSamples ?? LEARNING_MINIMUM_SAMPLE_SIZE;
  const improvement = args.candidateScore - args.baselineScore;
  return {
    status: args.candidateSamples >= minimumSamples && improvement >= 0.02 ? 'eligible' : 'shadow_only',
    minimum_samples: minimumSamples,
    candidate_samples: args.candidateSamples,
    improvement,
    reason: args.candidateSamples < minimumSamples ? 'Minimum settled-outcome sample has not been reached.' : improvement < 0.02 ? 'Candidate has not cleared the required improvement margin.' : 'Candidate cleared the sample and improvement gates; human promotion approval remains required.',
  } as const;
}
