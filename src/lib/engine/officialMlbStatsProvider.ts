/** Read-only season totals from MLB Stats API. These are descriptive season rates,
 * not day-of projections; callers must retain that provenance in run diagnostics. */
export type OfficialMlbSeasonRows = { hitting: Record<string, unknown>[]; pitching: Record<string, unknown>[]; retrievedAt: string; season: number };

const BASE = 'https://statsapi.mlb.com/api/v1';
const TEAM_CODES: Record<number, string> = {
  108: 'LAA', 109: 'AZ', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD', 120: 'WSH',
  121: 'NYM', 133: 'ATH', 134: 'PIT', 135: 'SD', 136: 'SEA', 137: 'SF', 138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

type Split = { stat?: Record<string, unknown>; player?: { id?: number; fullName?: string }; team?: { id?: number } };
function inningsFromBaseballNotation(value: unknown): number | undefined {
  const text = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d))?$/.exec(text);
  if (!match) return undefined;
  const outs = Number(match[2] ?? 0);
  if (outs > 2) return undefined;
  return Number(match[1]) + outs / 3;
}
function rowsFrom(payload: unknown, group: 'hitting' | 'pitching'): Record<string, unknown>[] {
  const stats = (payload as { stats?: Array<{ splits?: Split[] }> })?.stats;
  const splits = stats?.flatMap((item) => item.splits ?? []) ?? [];
  return splits.flatMap((split): Record<string, unknown>[] => {
    const stat = split.stat;
    const name = split.player?.fullName;
    const team = split.team?.id === undefined ? undefined : TEAM_CODES[split.team.id];
    if (!stat || !name || !team) return [];
    const common = { Name: name, Team: team, Games: stat.gamesPlayed, PlayerID: String(split.player?.id ?? '') };
    if (group === 'hitting') return [{ ...common, PlateAppearances: stat.plateAppearances, AtBats: stat.atBats, Hits: stat.hits, Doubles: stat.doubles, Triples: stat.triples, HomeRuns: stat.homeRuns, Walks: stat.baseOnBalls, HitByPitch: stat.hitByPitch, SacrificeFlies: stat.sacFlies, RBI: stat.rbi, Runs: stat.runs, StolenBases: stat.stolenBases, TotalBases: stat.totalBases }];
    const innings = inningsFromBaseballNotation(stat.inningsPitched);
    if (innings === undefined) return [];
    return [{ ...common, Games: stat.gamesPlayed, PitchingGamesStarted: stat.gamesStarted, InningsPitchedDecimal: innings, PitchingStrikeouts: stat.strikeOuts, PitchingWalks: stat.baseOnBalls, PitchingHits: stat.hits, PitchingEarnedRuns: stat.earnedRuns, PitchingWins: stat.wins }];
  });
}

export async function fetchOfficialMlbSeasonRows(season: number, fetcher: typeof fetch = fetch): Promise<OfficialMlbSeasonRows> {
  if (!Number.isInteger(season) || season < 2000 || season > new Date().getUTCFullYear()) throw new Error('MLB Stats API season is outside the supported range.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const load = async (group: 'hitting' | 'pitching') => {
      const url = `${BASE}/stats?stats=season&group=${group}&season=${season}&sportIds=1&playerPool=ALL&limit=1000`;
      const response = await fetcher(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`MLB Stats API ${group} request failed (${response.status}).`);
      const payload: unknown = await response.json();
      const rows = rowsFrom(payload, group);
      if (!rows.length) throw new Error(`MLB Stats API returned no usable ${group} season rows.`);
      return rows;
    };
    const [hitting, pitching] = await Promise.all([load('hitting'), load('pitching')]);
    return { hitting, pitching, season, retrievedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
