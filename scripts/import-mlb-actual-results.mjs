import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

async function loadDkScoring() {
  const source = await readFile(new URL('../src/lib/dkScoring.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`);
}

const { dkFantasyPoints } = await loadDkScoring();

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
      const battingPoints = dkFantasyPoints(batting, 'mlb', 'hitter');
      const pitchingPoints = dkFantasyPoints({
        ...pitching,
        inningsPitched: parseInnings(pitching.inningsPitched),
      }, 'mlb', 'pitcher');
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
  const rowsWithContext = rows.map((row) => ({
    ...row,
    sport: 'mlb',
    contest_date: contestDate,
    contest_type: contestType,
    contest_id: slate.contest_id,
    source: 'mlb_statsapi_boxscore',
  }));
  const count = await callRpc('fantasy_ai_upsert_projection_results', {
    p_rows: rowsWithContext,
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
