/** Pure parsers/scorers for official MLB Stats API and WNBA Stats API data. */
import { scoreBasketballStatLine } from '../src/lib/dkBasketballScoring.cjs';
const MLB_TEAM_CODES = { 108:'LAA',109:'AZ',110:'BAL',111:'BOS',112:'CHC',113:'CIN',114:'CLE',115:'COL',116:'DET',117:'HOU',118:'KC',119:'LAD',120:'WSH',121:'NYM',133:'OAK',134:'PIT',135:'SD',136:'SEA',137:'SF',138:'STL',139:'TB',140:'TEX',141:'TOR',142:'MIN',143:'PHI',144:'ATL',145:'CWS',146:'MIA',147:'NYY',158:'MIL' };
export function mapMlbOfficialBoxScore(gamePk, boxscore) {
  const rows = [];
  for (const side of ['away', 'home']) {
    const team = boxscore?.teams?.[side];
    const teamCode = String(team?.team?.abbreviation ?? MLB_TEAM_CODES[team?.team?.id] ?? '');
    for (const player of Object.values(team?.players ?? {})) {
      const batting = player?.stats?.batting ?? {};
      const pitching = player?.stats?.pitching ?? {};
      const hits = num(batting.hits);
      const doubles = num(batting.doubles);
      const triples = num(batting.triples);
      const homeRuns = num(batting.homeRuns);
      rows.push({
        PlayerID: String(player.person?.id ?? ''), Name: String(player.person?.fullName ?? ''), Team: teamCode,
        GameID: String(gamePk), IsGameOver: true,
        AtBats: num(batting.atBats), Runs: num(batting.runs), Hits: hits,
        Singles: Math.max(0, hits - doubles - triples - homeRuns), Doubles: doubles, Triples: triples,
        HomeRuns: homeRuns, RunsBattedIn: num(batting.rbi), Strikeouts: num(batting.strikeOuts),
        Walks: num(batting.baseOnBalls), HitByPitch: num(batting.hitByPitch), StolenBases: num(batting.stolenBases),
        SacrificeFlies: num(batting.sacFlies), SacrificeHits: num(batting.sacBunts),
        InningsPitchedDecimal: inningsNotation(pitching.inningsPitched), InningsPitchedOuts: inningsOuts(pitching.inningsPitched),
        PitchingStrikeouts: num(pitching.strikeOuts), PitchingEarnedRuns: num(pitching.earnedRuns),
        PitchingHits: num(pitching.hits), PitchingWalks: num(pitching.baseOnBalls), PitchingHitBatsmen: num(pitching.hitBatsmen),
        Wins: num(pitching.wins), Saves: num(pitching.saves), CompleteGames: num(pitching.completeGames), Shutouts: num(pitching.shutouts), NoHitters: num(pitching.noHitters),
        Updated: boxscore?.gameData?.datetime?.dateTime ?? null,
        OfficialBoxScoreListed: true,
      });
    }
  }
  return rows;
}

export function mapWnbaOfficialPlayerStats(resultSet) {
  const headers = resultSet?.headers ?? [];
  const rows = resultSet?.rowSet ?? [];
  return rows.map((values) => {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const number = (key) => num(row[key]);
    const points = number('PTS'); const rebounds = number('REB'); const assists = number('AST');
    const steals = number('STL'); const blocks = number('BLK');
    const doubleDouble = [points, rebounds, assists, steals, blocks].filter((value) => value >= 10).length >= 2 ? 1 : 0;
    const tripleDouble = [points, rebounds, assists, steals, blocks].filter((value) => value >= 10).length >= 3 ? 1 : 0;
    return {
      PlayerID: String(row.PLAYER_ID ?? ''), Name: String(row.PLAYER_NAME ?? ''), Team: String(row.TEAM_ABBREVIATION ?? ''),
      GameID: String(row.GAME_ID ?? ''), IsGameOver: true, Updated: null,
      Points: points, ThreePointersMade: number('FG3M'), Rebounds: rebounds, Assists: assists,
      Steals: steals, BlockedShots: blocks, Turnovers: number('TO'), DoubleDoubles: doubleDouble,
      TripleDoubles: tripleDouble, Minutes: parseMinutes(row.MIN), Comment: String(row.COMMENT ?? ''),
    };
  });
}

export const mapNbaOfficialPlayerStats = mapWnbaOfficialPlayerStats;

/** SportsDataIO NBA feed dates use US Eastern Time. Reject mixed-date slates. */
export function nbaOfficialGameDate(slate) {
  const games = Array.isArray(slate?.games) ? slate.games : [];
  let timestamps;
  if (games.length) {
    timestamps = games.map((game) => Date.parse(String(game?.scheduledStart ?? '')));
    if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) throw new Error('NBA slate has a game without a valid scheduled start.');
  } else {
    const eventDate = String(slate?.event?.eventDate ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      const dateTimestamp = Date.parse(`${eventDate}T00:00:00.000Z`);
      if (Number.isFinite(dateTimestamp) && new Date(dateTimestamp).toISOString().slice(0, 10) === eventDate) return eventDate;
      throw new Error('NBA slate has an invalid calendar event date.');
    }
    const eventTimestamp = Date.parse(eventDate);
    if (!Number.isFinite(eventTimestamp)) throw new Error('NBA slate has no verified game date or scheduled start.');
    timestamps = [eventTimestamp];
  }
  const dates = new Set(timestamps.map((timestamp) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp))));
  if (dates.size !== 1) throw new Error('NBA slate spans multiple Eastern game dates; multi-date actual backfill is not supported for this saved run.');
  return [...dates][0];
}

/** Resolve only a unique SportsDataIO provider ID for a DraftKings player ID. */
export function resolveSportsDataIoDraftKingsPlayerId(draftKingsPlayerId, rosterRows) {
  const draftKingsId = String(draftKingsPlayerId ?? '').trim();
  if (!draftKingsId) return null;
  const ids = [...new Set(rosterRows.flatMap((row) => String(row.DraftKingsPlayerID ?? row.DraftKingsPlayerId ?? '').trim() === draftKingsId
    ? [String(row.PlayerID ?? row.PlayerId ?? '').trim()]
    : []).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * Match an archived NBA slate player to an official NBA box-score row.
 * Provider IDs take precedence when an explicit mapping exists. If there is no
 * mapping, accept only one exact normalized full-name + team match; ambiguous
 * or missing matches remain quarantined by the caller.
 */
export function matchNbaOfficialPlayer(slatePlayer, rows, providerPlayerId = '') {
  const providerId = String(providerPlayerId ?? '').trim();
  if (providerId) {
    const team = normalizeIdentityTeam(slatePlayer?.team);
    if (!team) return null;
    const matches = rows.filter((row) => String(row.PlayerID ?? row.PlayerId ?? '').trim() === providerId && normalizeIdentityTeam(row.Team ?? row.TeamAbbreviation) === team);
    return matches.length === 1 ? { row: matches[0], matchType: 'PROVIDER_ID' } : null;
  }
  const name = normalizeIdentityName(slatePlayer?.playerName ?? slatePlayer?.name);
  const team = normalizeIdentityTeam(slatePlayer?.team);
  if (!name || !team) return null;
  const matches = rows.filter((row) => normalizeIdentityName(row.Name ?? row.PlayerName) === name && normalizeIdentityTeam(row.Team ?? row.TeamAbbreviation) === team);
  return matches.length === 1 ? { row: matches[0], matchType: 'NAME_AND_TEAM' } : null;
}

function normalizeIdentityName(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function normalizeIdentityTeam(value) { return String(value ?? '').trim().toUpperCase(); }

export function scoreMlbOfficial(row, scoringRules) {
  const rules = ruleMap(scoringRules);
  const stats = [
    ['single', num(row.Singles)], ['double', num(row.Doubles)], ['triple', num(row.Triples)],
    ['homeRun', num(row.HomeRuns)], ['run', num(row.Runs)], ['rbi', num(row.RunsBattedIn)],
    ['stolenBase', num(row.StolenBases)], ['walk', num(row.Walks)], ['hitByPitch', num(row.HitByPitch)],
    ['sacrificeFly', num(row.SacrificeFlies)], ['sacrificeHit', num(row.SacrificeHits)],
    ['inningPitched', inningsOuts(row.InningsPitchedDecimal) / 3], ['strikeout', num(row.PitchingStrikeouts)],
    ['earnedRun', num(row.PitchingEarnedRuns)], ['win', num(row.Wins)], ['save', num(row.Saves)],
    ['hitAgainst', num(row.PitchingHits)], ['walkAgainst', num(row.PitchingWalks)], ['hitBatsman', num(row.PitchingHitBatsmen)],
    ['completeGame', num(row.CompleteGames)], ['completeGameShutout', num(row.Shutouts)], ['noHitter', num(row.NoHitters)],
  ];
  let points = 0;
  for (const [name, count] of stats) {
    if (!count) continue;
    const rule = rules.get(name);
    if (rule === undefined) return { points: NaN, components: row, reason: `The saved scoring rules omit ${name}, which occurred in the official box score.` };
    points += count * rule;
  }
  return { points: round(points), components: Object.fromEntries(['AtBats','Runs','Hits','Singles','Doubles','Triples','HomeRuns','RunsBattedIn','Strikeouts','Walks','HitByPitch','StolenBases','SacrificeFlies','SacrificeHits','InningsPitchedDecimal','PitchingStrikeouts','PitchingEarnedRuns','PitchingHits','PitchingWalks','PitchingHitBatsmen','Wins','Saves','CompleteGames','Shutouts','NoHitters'].map((key) => [key, num(row[key])])) };
}

export function scoreWnbaOfficial(row, scoringRules) {
  const result = scoreBasketballStatLine({ points: num(row.Points), threePointersMade: num(row.ThreePointersMade), rebounds: num(row.Rebounds), assists: num(row.Assists), steals: num(row.Steals), blocks: num(row.BlockedShots), turnovers: num(row.Turnovers) }, scoringRules);
  return { ...result, components: { ...result.components, minutes: num(row.Minutes) } };
}

export const scoreNbaOfficial = scoreWnbaOfficial;

export function actualPointIncrement(sport, scoringRules) {
  const values = Object.values(scoringRules ?? {}).map((value) => Number(typeof value === 'number' ? value : value?.value)).filter(Number.isFinite).map(Math.abs);
  if (sport === 'MLB') {
    const inningsRule = valuesForRule(scoringRules, ['inningPitched','inningsPitched']);
    if (inningsRule !== undefined) values.push(inningsRule / 3); // one out is one third of an inning
  }
  if (!values.length) return sport === 'NFL' || sport === 'CFB' ? 0.1 : sport === 'GOLF' ? 0.5 : 0.25;
  const decimalPlaces = Math.min(6, Math.max(...values.map((value) => (String(value).split('.')[1] ?? '').length)));
  const scale = 10 ** decimalPlaces;
  const ints = values.map((value) => Math.round(value * scale)).filter((value) => value > 0);
  const divisor = ints.reduce(gcd);
  return divisor > 0 ? divisor / scale : 0.25;
}

export function inningsOuts(value) {
  const raw = String(value ?? '0');
  const match = raw.match(/^(\d+)(?:\.(\d))?$/);
  if (!match) return 0;
  const outs = Number(match[2] ?? 0);
  if (outs > 2) return NaN;
  return Number(match[1]) * 3 + outs;
}

export function mlbTeamCode(team) { return String(team?.abbreviation ?? MLB_TEAM_CODES[team?.id] ?? ''); }

function inningsNotation(value) {
  const outs = inningsOuts(value);
  if (!Number.isFinite(outs)) return null;
  return Math.floor(outs / 3) + (outs % 3) / 10;
}
function parseMinutes(value) { const match = String(value ?? '').match(/^(\d+):(\d{2})$/); return match ? Number(match[1]) + Number(match[2]) / 60 : Number.isFinite(Number(value)) ? Number(value) : 0; }
function ruleMap(scoringRules) { return new Map(Object.entries(scoringRules ?? {}).map(([name, value]) => [canonical(name), Number(typeof value === 'number' ? value : value?.value)]).filter(([, value]) => Number.isFinite(value))); }
function valuesForRule(scoringRules, names) { const entry = Object.entries(scoringRules ?? {}).find(([name]) => names.includes(canonical(name))); return entry ? Number(typeof entry[1] === 'number' ? entry[1] : entry[1]?.value) : undefined; }
function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function canonical(name) { const key = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase(); const aliases = { singles: 'single', doubles: 'double', triples: 'triple', homeruns: 'homeRun', runs: 'run', runsbattedin: 'rbi', stolenbases: 'stolenBase', walks: 'walk', hitbypitches: 'hitByPitch', inningspitched: 'inningPitched', strikeouts: 'strikeout', strikeoutspitching: 'strikeout', earnedruns: 'earnedRun', earnedrunsallowed: 'earnedRun', hitsallowed: 'hitAgainst', walksallowed: 'walkAgainst', pitcherwin: 'win', wins: 'win', pitcherloss: 'loss', saves: 'save', completegames: 'completeGame', shutouts: 'completeGameShutout', nohitter: 'noHitter', nohitterbonus: 'noHitter', threepointersmade: 'threePointersMade', threes: 'threePointersMade', blockedshots: 'blocks', turnovers: 'turnovers', doubledoublebonus: 'doubleDouble', tripledoublebonus: 'tripleDouble' }; return aliases[key] ?? name; }
function num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round(value) { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
