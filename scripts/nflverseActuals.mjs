/** Weekly NFL final statistics from nflverse-data (CC BY 4.0, attribution in docs). */
const BASE = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const RELEASE = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_';
const csvCache = new Map();

export async function fetchNflverseFinalPlayerRows(slate, fetcher = fetch) {
  const playerPool = Array.isArray(slate?.playerPool) ? slate.playerPool : [];
  const gamePairs = new Set(playerPool.map((player) => [normalizeTeam(player.team), normalizeTeam(player.opponent)].sort().join(':')).filter((pair) => pair.includes(':')));
  const scheduledDays = new Set((Array.isArray(slate?.games) ? slate.games : []).map((game) => String(game.scheduledStart ?? '').slice(0, 10)).filter((date) => /^\d{4}-\d\d-\d\d$/.test(date)));
  if (!scheduledDays.size) scheduledDays.add(String(slate?.event?.eventDate ?? '').slice(0, 10));
  const schedule = await loadCsv(BASE, fetcher);
  const games = schedule.filter((row) => {
    const day = String(row.gameday ?? row.game_date ?? '').slice(0, 10);
    const pair = [normalizeTeam(row.home_team), normalizeTeam(row.away_team)].sort().join(':');
    return gamePairs.has(pair) && String(row.result ?? '').trim() !== '' && [...scheduledDays].some((target) => day === target || Math.abs(Date.parse(`${day}T12:00:00Z`) - Date.parse(`${target}T12:00:00Z`)) <= 24 * 60 * 60 * 1000)
      && Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score));
  });
  if (!games.length) throw new Error('nflverse schedule has no completed slate games for the saved NFL date/team pairs.');
  const seasons = [...new Set(games.map((game) => Number(game.season)).filter(Number.isInteger))];
  const statRows = (await Promise.all(seasons.map((season) => loadCsv(`${RELEASE}${season}.csv`, fetcher)))).flat();
  const gameById = new Map(games.map((game) => [String(game.game_id), game]));
  const slateStatRows = statRows.filter((row) => gameById.has(String(row.game_id)));
  const missingGames = [...gameById.keys()].filter((gameId) => !slateStatRows.some((row) => String(row.game_id) === gameId));
  if (missingGames.length) throw new Error(`nflverse weekly player stats are not yet complete for ${missingGames.length} final slate game(s).`);
  return slateStatRows.map((row) => mapNflverseRow(row, gameById.get(String(row.game_id))));
}

export function scoreNflversePlayer(row, scoringRules) {
  const categories = {
    passingYards: number(row.PassingYards), passingTouchdown: number(row.PassingTouchdowns), interception: number(row.PassingInterceptions),
    rushingYards: number(row.RushingYards), rushingTouchdown: number(row.RushingTouchdowns), reception: number(row.Receptions),
    receivingYards: number(row.ReceivingYards), receivingTouchdown: number(row.ReceivingTouchdowns), fumbleLost: number(row.FumblesLost),
    twoPointConversion: number(row.PassingTwoPointConversions) + number(row.RushingTwoPointConversions) + number(row.ReceivingTwoPointConversions),
  };
  const components = { ...categories, passingTwoPointConversion: number(row.PassingTwoPointConversions), rushingTwoPointConversion: number(row.RushingTwoPointConversions), receivingTwoPointConversion: number(row.ReceivingTwoPointConversions) };
  const aliases = { passingTouchdown: ['passingTouchdowns'], interception: ['interceptions'], rushingTouchdown: ['rushingTouchdowns'], reception: ['receptions'], receivingTouchdown: ['receivingTouchdowns'], fumbleLost: ['fumblesLost', 'fumbles_lost'] };
  const points = Object.entries(categories).reduce((sum, [key, count]) => {
    const names = [key, ...(aliases[key] ?? [])];
    const rule = names.map((name) => scoringRules?.[name]).find((value) => Number.isFinite(Number(value?.value)));
    if (count > 0 && !rule) return NaN;
    return sum + count * Number(rule?.value ?? 0);
  }, 0);
  const passingBonus = bonusValue(scoringRules, 'passingYardBonus', ['passing300YardBonus'], categories.passingYards >= 300);
  const rushingBonus = bonusValue(scoringRules, 'rushingYardBonus', ['rushing100YardBonus'], categories.rushingYards >= 100);
  const receivingBonus = bonusValue(scoringRules, 'receivingYardBonus', ['receiving100YardBonus'], categories.receivingYards >= 100);
  return { points: Number.isFinite(points) ? round(points + passingBonus + rushingBonus + receivingBonus) : NaN, components };
}

function bonusValue(rules, name, aliases, applies) {
  if (!applies) return 0;
  const rule = [name, ...aliases].map((key) => rules?.[key]).find((value) => Number.isFinite(Number(value?.value)));
  return rule ? Number(rule.value) : NaN;
}

async function loadCsv(url, fetcher) {
  if (csvCache.has(url)) return csvCache.get(url);
  const response = await fetcher(url, { headers: { accept: 'text/csv' } });
  if (!response.ok) throw new Error(`nflverse data request failed (${response.status}).`);
  const rows = parseCsv(await response.text());
  if (!rows.length) throw new Error('nflverse returned an empty CSV file.');
  csvCache.set(url, rows);
  return rows;
}

function parseCsv(text) {
  const records = []; let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); records.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); records.push(row); }
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  return records.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}
function mapNflverseRow(row, game) {
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  return {
    PlayerID: String(row.player_id ?? ''), Name: String(row.player_display_name ?? row.player_name ?? ''), Team: normalizeTeam(row.recent_team ?? row.team ?? ''),
    GameID: String(row.game_id ?? ''), IsGameOver: true, GameDate: String(game.gameday ?? game.game_date ?? ''), Season: number(game.season), Week: number(game.week),
    Position: String(row.position ?? ''), PassingYards: number(row.passing_yards), PassingTouchdowns: number(row.passing_tds), PassingInterceptions: number(row.interceptions),
    RushingYards: number(row.rushing_yards), RushingTouchdowns: number(row.rushing_tds), Receptions: number(row.receptions), ReceivingYards: number(row.receiving_yards), ReceivingTouchdowns: number(row.receiving_tds),
    FumblesLost: number(row.sack_fumbles_lost) + number(row.rushing_fumbles_lost) + number(row.receiving_fumbles_lost),
    PassingTwoPointConversions: number(row.passing_2pt_conversions), RushingTwoPointConversions: number(row.rushing_2pt_conversions), ReceivingTwoPointConversions: number(row.receiving_2pt_conversions),
  };
}
function normalizeTeam(value) { const code = String(value ?? '').trim().toUpperCase(); return ({ JAC: 'JAX', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', WSH: 'WAS' })[code] ?? code; }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function round(value) { return Math.round((value + Number.EPSILON) * 10000) / 10000; }
