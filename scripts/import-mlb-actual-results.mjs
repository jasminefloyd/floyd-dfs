const contestDate = process.argv[2];
const contestType = (process.argv[3] ?? 'classic').toLowerCase();

if (!contestDate || Number.isNaN(new Date(`${contestDate}T00:00:00`).getTime())) {
  console.error('Usage: npm run import:mlb-actuals -- YYYY-MM-DD [classic|showdown]');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL/VITE_SUPABASE_URL and SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

function rpcUrl(name) {
  return `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`;
}

async function callRpc(name, body) {
  const response = await fetch(rpcUrl(name), {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeMlbTeam(value) {
  const aliases = {
    CHW: 'CWS',
    KCR: 'KC',
    SDP: 'SD',
    SFG: 'SF',
    TBR: 'TB',
    WSN: 'WSH',
    ATH: 'OAK',
  };
  const raw = String(value ?? '').toUpperCase();
  return aliases[raw] ?? raw;
}

function parseInnings(value) {
  const [whole, outs] = String(value ?? '0').split('.');
  return Number(whole || 0) + Number(outs || 0) / 3;
}

function battingDraftKingsPoints(stats) {
  const singles = Math.max(
    0,
    Number(stats.hits ?? 0) - Number(stats.doubles ?? 0) - Number(stats.triples ?? 0) - Number(stats.homeRuns ?? 0),
  );
  return (
    singles * 3 +
    Number(stats.doubles ?? 0) * 5 +
    Number(stats.triples ?? 0) * 8 +
    Number(stats.homeRuns ?? 0) * 10 +
    Number(stats.rbi ?? 0) * 2 +
    Number(stats.runs ?? 0) * 2 +
    (Number(stats.baseOnBalls ?? 0) + Number(stats.hitByPitch ?? 0)) * 2 +
    Number(stats.stolenBases ?? 0) * 5
  );
}

function pitchingDraftKingsPoints(stats) {
  return (
    parseInnings(stats.inningsPitched) * 2.25 +
    Number(stats.strikeOuts ?? 0) * 2 +
    Number(stats.wins ?? 0) * 4 -
    Number(stats.earnedRuns ?? 0) * 2 -
    (Number(stats.hits ?? 0) + Number(stats.baseOnBalls ?? 0) + Number(stats.hitBatsmen ?? 0)) * 0.6 +
    Number(stats.completeGames ?? 0) * 2.5 +
    Number(stats.shutouts ?? 0) * 2.5 +
    Number(stats.noHitters ?? 0) * 5
  );
}

async function fetchMlbScheduleGameIds(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${encodeURIComponent(date)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`MLB schedule failed: ${response.status}`);
  const data = await response.json();
  return (data?.dates ?? []).flatMap((entry) => entry?.games ?? []).map((game) => String(game.gamePk)).filter(Boolean);
}

async function fetchBoxscoreActuals(gameId) {
  const response = await fetch(`https://statsapi.mlb.com/api/v1/game/${encodeURIComponent(gameId)}/boxscore`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`MLB boxscore ${gameId} failed: ${response.status}`);
  const data = await response.json();
  const rows = [];

  for (const side of ['home', 'away']) {
    const team = normalizeMlbTeam(data?.teams?.[side]?.team?.abbreviation);
    const players = data?.teams?.[side]?.players ?? {};
    for (const player of Object.values(players)) {
      const name = player?.person?.fullName;
      if (!name) continue;
      const batting = player?.stats?.batting ?? {};
      const pitching = player?.stats?.pitching ?? {};
      const battingPoints = battingDraftKingsPoints(batting);
      const pitchingPoints = pitchingDraftKingsPoints(pitching);
      const actualPoints = Number((battingPoints + pitchingPoints).toFixed(2));
      const appeared = Number(batting.atBats ?? 0) > 0
        || Number(batting.plateAppearances ?? 0) > 0
        || String(pitching.inningsPitched ?? '') !== '';
      if (!appeared && actualPoints === 0) continue;

      rows.push({
        player_id: player?.person?.id ? String(player.person.id) : undefined,
        player_name: String(name),
        team,
        position: player?.position?.abbreviation,
        actual_points: actualPoints,
      });
    }
  }

  return rows;
}

function matchActualRowsToSlate(salaryRows, actualRows) {
  const actualById = new Map(actualRows.filter((row) => row.player_id).map((row) => [row.player_id, row]));
  const actualByNameTeam = new Map(actualRows.map((row) => [`${normalizeName(row.player_name)}:${row.team}`, row]));
  const actualByName = new Map();
  for (const row of actualRows) {
    const key = normalizeName(row.player_name);
    if (actualByName.has(key)) actualByName.set(key, null);
    else actualByName.set(key, row);
  }

  return salaryRows.map((salary) => {
    const team = normalizeMlbTeam(salary.team);
    const actual = actualById.get(String(salary.player_id ?? ''))
      ?? actualByNameTeam.get(`${normalizeName(salary.player_name)}:${team}`)
      ?? actualByName.get(normalizeName(salary.player_name));
    if (!actual) return null;
    return {
      player_id: salary.player_id ?? actual.player_id,
      player_name: salary.player_name,
      team,
      position: salary.position,
      projected_points: salary.projected_points,
      actual_points: actual.actual_points,
    };
  }).filter(Boolean);
}

const slates = await callRpc('fantasy_ai_get_draftkings_slates', {
  p_sport: 'mlb',
  p_contest_type: contestType,
});

const dateSlates = (slates ?? []).filter((slate) => String(slate.contest_date) === contestDate);
if (!dateSlates.length) {
  console.log(JSON.stringify({ imported_count: 0, message: `No MLB ${contestType} slates found for ${contestDate}` }));
  process.exit(0);
}

const gameIds = await fetchMlbScheduleGameIds(contestDate);
const actualRows = (await Promise.all(gameIds.map(fetchBoxscoreActuals))).flat();
const imported = [];

for (const slate of dateSlates) {
  const salaryRows = await callRpc('fantasy_ai_get_draftkings_salaries', {
    p_sport: 'mlb',
    p_contest_date: contestDate,
    p_contest_type: contestType,
    p_contest_id: slate.contest_id,
  });
  const rows = matchActualRowsToSlate(salaryRows ?? [], actualRows);
  if (!rows.length) continue;
  const count = await callRpc('fantasy_ai_upsert_projection_results', {
    p_sport: 'mlb',
    p_contest_date: contestDate,
    p_contest_type: contestType,
    p_contest_id: slate.contest_id,
    p_source: 'mlb_statsapi_boxscore',
    p_rows: rows,
  });
  imported.push({
    contest_id: slate.contest_id,
    slate_name: slate.slate_name,
    matched_rows: rows.length,
    upserted_rows: count,
  });
}

console.log(JSON.stringify({
  sport: 'mlb',
  contest_type: contestType,
  contest_date: contestDate,
  game_count: gameIds.length,
  actual_player_rows: actualRows.length,
  imported,
  imported_count: imported.length,
}, null, 2));
