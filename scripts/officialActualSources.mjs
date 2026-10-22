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
