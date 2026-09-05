import type { ResearchArticle, ResearchPlan, ResearchSourceProvider, Sport, ValidatedSlate } from './contracts.js';
import { normalizeTeamCode } from './availability.js';

export interface OddsResearchProviderOptions { apiKey: string; baseUrl?: string; sportKey?: string; fetcher?: typeof fetch; }
export class OddsResearchProvider implements ResearchSourceProvider {
  readonly name = 'The Odds API'; readonly tier = 1 as const;
  private readonly options: OddsResearchProviderOptions; private readonly fetcher: typeof fetch;
  constructor(options: OddsResearchProviderOptions) { this.options = options; this.fetcher = options.fetcher ?? fetch; }
  async fetch(input: { slate: ValidatedSlate; plan: ResearchPlan; signal?: AbortSignal }): Promise<ResearchArticle[]> {
    const sportKey = this.options.sportKey ?? oddsApiSportKey(input.slate.sport);
    if (!sportKey) return [];
    const baseUrl = (this.options.baseUrl ?? 'https://api.the-odds-api.com').replace(/\/+$/, '');
    const apiBase = baseUrl.endsWith('/v4') ? baseUrl : `${baseUrl}/v4`;
    const url = new URL(`sports/${sportKey}/odds`, `${apiBase}/`); url.searchParams.set('apiKey', this.options.apiKey); url.searchParams.set('regions', 'us'); url.searchParams.set('markets', 'h2h,spreads,totals');
    const response = await this.fetcher(url, { signal: input.signal, headers: { accept: 'application/json' } }); if (!response.ok) throw new Error(`The Odds API returned HTTP ${response.status}.`); const payload = await response.json() as unknown[];
    return payload.slice(0, 25).map((event, index) => ({ title: `${input.slate.sport} market context ${index + 1}`, sourceName: this.name, sourceTier: this.tier, summary: JSON.stringify(event).slice(0, 1200), tags: ['MARKET_SIGNALS', input.slate.sport] }));
  }
}

function oddsApiSportKey(sport: ValidatedSlate['sport']): string | undefined {
  return ({ MLB: 'baseball_mlb', NBA: 'basketball_nba', WNBA: 'basketball_wnba', NFL: 'americanfootball_nfl', CFB: 'americanfootball_ncaaf', GOLF: 'golf_pga' } as const)[sport];
}

export interface TeamMarketContext { team: string; opponent: string; gameTotal: number; spread: number; impliedTeamTotal: number; }

// The Odds API reports full team names ("Los Angeles Lakers"), while DraftKings' own player
// data uses short codes ("LAL"). Team names/abbreviations are stable public facts, not something
// that needs live verification -- but this table isn't exhaustive (new/expansion franchises in
// particular may be missing). A team that isn't in here is simply skipped, never force-matched,
// consistent with how every other real-data integration in this engine degrades.
const TEAM_NAME_TO_CODE: Partial<Record<Sport, Record<string, string>>> = {
  NBA: { 'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE', 'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET', 'Golden State Warriors': 'GS', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND', 'LA Clippers': 'LAC', 'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA', 'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NO', 'New York Knicks': 'NY', 'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SA', 'Toronto Raptors': 'TOR', 'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS' },
  WNBA: { 'Atlanta Dream': 'ATL', 'Chicago Sky': 'CHI', 'Connecticut Sun': 'CON', 'Dallas Wings': 'DAL', 'Golden State Valkyries': 'GS', 'Indiana Fever': 'IND', 'Las Vegas Aces': 'LV', 'Los Angeles Sparks': 'LA', 'Minnesota Lynx': 'MIN', 'New York Liberty': 'NY', 'Phoenix Mercury': 'PHX', 'Seattle Storm': 'SEA', 'Toronto Tempo': 'TOR' },
  NFL: { 'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB', 'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG', 'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS' },
  MLB: { 'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL', 'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS', 'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL', 'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC', 'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA', 'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM', 'New York Yankees': 'NYY', 'Oakland Athletics': 'ATH', 'Athletics': 'ATH', 'Philadelphia Phillies': 'PHI', 'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF', 'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'St Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB', 'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH' },
};

function averagePoint(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

/**
 * Real, structured Vegas market context (implied team total from game total + spread) -- used
 * for leverage/ownership grounding and game-stack correlation. Distinct from
 * OddsResearchProvider.fetch() above, which only dumps raw JSON into free-text research
 * findings; nothing parses it into numbers there. `impliedTeamTotal = gameTotal/2 - spread/2`
 * is standard, publicly-known sports-betting math, not a guess -- a team's own signed spread
 * already encodes favorite (negative) vs underdog (positive).
 */
export async function getTeamMarketContext(sport: Sport, apiKey: string, options: { baseUrl?: string; sportKey?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<Map<string, TeamMarketContext>> {
  const sportKey = options.sportKey ?? oddsApiSportKey(sport);
  const nameToCode = TEAM_NAME_TO_CODE[sport];
  if (!sportKey || !nameToCode) return new Map();
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.the-odds-api.com').replace(/\/+$/, '');
  const apiBase = baseUrl.endsWith('/v4') ? baseUrl : `${baseUrl}/v4`;
  const url = new URL(`sports/${sportKey}/odds`, `${apiBase}/`); url.searchParams.set('apiKey', apiKey); url.searchParams.set('regions', 'us'); url.searchParams.set('markets', 'spreads,totals');
  const response = await fetcher(url, { signal: options.signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The Odds API returned HTTP ${response.status}.`);
  const events = await response.json() as Array<{ home_team?: string; away_team?: string; bookmakers?: Array<{ markets?: Array<{ key?: string; outcomes?: Array<{ name?: string; point?: number }> }> }> }>;
  const result = new Map<string, TeamMarketContext>();
  for (const event of events) {
    const homeTeam = event.home_team; const awayTeam = event.away_team;
    if (!homeTeam || !awayTeam) continue;
    const homeCode = nameToCode[homeTeam] ? normalizeTeamCode(nameToCode[homeTeam]) : undefined;
    const awayCode = nameToCode[awayTeam] ? normalizeTeamCode(nameToCode[awayTeam]) : undefined;
    if (!homeCode || !awayCode) continue;
    const bookmakers = event.bookmakers ?? [];
    const totalPoints: number[] = []; const homeSpreads: number[] = []; const awaySpreads: number[] = [];
    for (const bookmaker of bookmakers) {
      for (const market of bookmaker.markets ?? []) {
        if (market.key === 'totals') for (const outcome of market.outcomes ?? []) if (typeof outcome.point === 'number') totalPoints.push(outcome.point);
        if (market.key === 'spreads') for (const outcome of market.outcomes ?? []) { if (typeof outcome.point !== 'number') continue; if (outcome.name === homeTeam) homeSpreads.push(outcome.point); if (outcome.name === awayTeam) awaySpreads.push(outcome.point); }
      }
    }
    const gameTotal = averagePoint(totalPoints); const homeSpread = averagePoint(homeSpreads); const awaySpread = averagePoint(awaySpreads);
    if (gameTotal === undefined) continue;
    if (homeSpread !== undefined) result.set(homeCode, { team: homeCode, opponent: awayCode, gameTotal, spread: homeSpread, impliedTeamTotal: gameTotal / 2 - homeSpread / 2 });
    if (awaySpread !== undefined) result.set(awayCode, { team: awayCode, opponent: homeCode, gameTotal, spread: awaySpread, impliedTeamTotal: gameTotal / 2 - awaySpread / 2 });
  }
  return result;
}
