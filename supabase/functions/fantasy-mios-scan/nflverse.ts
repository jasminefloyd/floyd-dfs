import { dkFantasyPoints, type DkSport } from '../_shared/dkScoring.ts';

export interface NflversePlayer {
  name: string;
  team?: string;
  position?: string;
}

export interface NflverseStatsResult {
  games_data: Record<string, unknown>[];
  aggregated_stats: Record<string, number>;
  confidence_score: number;
  last_updated_at: string;
  source: 'nflverse_player_stats';
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function first(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

function number(row: Record<string, string>, keys: string[]): number {
  const value = Number(first(row, keys));
  return Number.isFinite(value) ? value : 0;
}

function positionRole(position: string): 'dst' | undefined {
  return /^(DST|DEF|D\/ST)$/i.test(position) ? 'dst' : undefined;
}

function aggregate(games: Record<string, unknown>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of games) {
    for (const [key, value] of Object.entries(game)) {
      if (typeof value === 'number' && Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  const averages = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number((value / games.length).toFixed(2))]));
  const fantasyPoints = games.map((game) => Number(game.fantasy_points ?? dkFantasyPoints(game as Record<string, number>, 'nfl' as DkSport, positionRole(String(game.position ?? '')))));
  const averageFantasyPoints = fantasyPoints.reduce((sum, value) => sum + value, 0) / games.length;
  const variance = fantasyPoints.reduce((sum, value) => sum + (value - averageFantasyPoints) ** 2, 0) / Math.max(games.length - 1, 1);
  return {
    ...averages,
    avg_fantasy_pts: Number(averageFantasyPoints.toFixed(2)),
    fantasy_points: Number(averageFantasyPoints.toFixed(2)),
    stdev_fantasy_pts: Number(Math.sqrt(variance).toFixed(2)),
    games_sample_size: games.length,
  };
}

export function parseNflverseWeeklyStats(csv: string, player: NflversePlayer, now = new Date().toISOString()): NflverseStatsResult | null {
  const playerName = normalize(player.name);
  if (!playerName) return null;
  const team = normalize(player.team);
  const position = String(player.position ?? '').toUpperCase();
  const rows = parseCsv(csv)
    .filter((row) => normalize(first(row, ['player_display_name', 'player_name', 'full_name'])) === playerName)
    .filter((row) => !team || !first(row, ['recent_team', 'team', 'fantasy_team']) || normalize(first(row, ['recent_team', 'team', 'fantasy_team'])) === team)
    .filter((row) => !first(row, ['season_type', 'season_type_name']) || /reg|regular|post|playoff/i.test(first(row, ['season_type', 'season_type_name'])))
    .sort((left, right) => {
      const leftDate = first(left, ['game_date', 'date']);
      const rightDate = first(right, ['game_date', 'date']);
      if (leftDate || rightDate) return rightDate.localeCompare(leftDate);
      return number(right, ['season']) - number(left, ['season']) || number(right, ['week']) - number(left, ['week']);
    })
    .slice(0, 5);
  if (!rows.length) return null;

  const games = rows.map((row) => {
    const statLine: Record<string, unknown> = {
      position,
      date: first(row, ['game_date', 'date']) || `${first(row, ['season'])}-W${first(row, ['week'])}`,
      opponent: first(row, ['opponent_team', 'opponent']) || 'N/A',
      game_id: first(row, ['game_id', 'gsis_id']),
      passing_yards: number(row, ['passing_yards', 'pass_yards']),
      passing_tds: number(row, ['passing_tds', 'pass_touchdowns']),
      interceptions: number(row, ['interceptions', 'passing_interceptions', 'int']),
      rushing_yards: number(row, ['rushing_yards', 'rush_yards']),
      rushing_tds: number(row, ['rushing_tds', 'rush_touchdowns']),
      receiving_yards: number(row, ['receiving_yards', 'rec_yards']),
      receptions: number(row, ['receptions', 'rec']),
      receiving_tds: number(row, ['receiving_tds', 'rec_touchdowns']),
      fumble_lost: number(row, ['sack_fumbles_lost', 'rushing_fumbles_lost', 'receiving_fumbles_lost', 'fumbles_lost_total', 'fumbles_lost']),
      two_point_conversions: number(row, ['passing_2pt_conversions', 'rushing_2pt_conversions', 'receiving_2pt_conversions', 'two_point_conversions']),
      return_tds: number(row, ['return_tds', 'kick_return_tds', 'punt_return_tds', 'pt_return_tds']),
      offensive_fumble_recovery_touchdowns: number(row, ['offensive_fumble_recovery_touchdowns', 'fumble_recovery_tds']),
      sacks: number(row, ['def_sacks', 'sacks']),
      fumblesRecovered: number(row, ['def_fumble_recoveries', 'fumble_recoveries', 'fumble_recovery_opp']),
      defensiveTouchdowns: number(row, ['def_tds', 'defensive_tds']),
      safeties: number(row, ['def_safeties', 'safeties']),
      blockedKicks: number(row, ['def_blocked_kicks', 'blocked_kicks']),
      pointsAllowed: number(row, ['def_points_allowed', 'points_allowed']),
      targets: number(row, ['targets']),
      carries: number(row, ['carries', 'rushing_attempts']),
      minutes: number(row, ['offense_snaps', 'snaps']) || undefined,
    };
    return {
      ...statLine,
      fantasy_points: Number(dkFantasyPoints(statLine as Record<string, number>, 'nfl' as DkSport, positionRole(position)).toFixed(2)),
    };
  });

  return {
    games_data: games,
    aggregated_stats: aggregate(games),
    confidence_score: games.length === 5 ? 0.92 : 0.72,
    last_updated_at: now,
    source: 'nflverse_player_stats',
  };
}
