interface SlateRequest {
  sport: string;
  contestType: string;
}

interface DraftKingsSlate {
  contest_id: string;
  external_contest_id: string | null;
  sport: string;
  contest_type: string;
  contest_date: string;
  slate_name: string;
  game_ids: string[];
  salary_cap: number;
  status: string | null;
  start_time: string | null;
  salary_count: number;
  data: Record<string, unknown>;
  updated_at: string;
}

interface DraftKingsContest {
  id: number;
  n: string;
  dg: number;
  gameType?: string;
  gameTypeId?: number;
  sd?: string;
  sdstring?: string;
}

interface DraftKingsContestResponse {
  Contests?: DraftKingsContest[];
}

interface DraftKingsDraftable {
  playerId?: number;
  playerDkId?: number;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  salary?: number;
  status?: string;
  teamAbbreviation?: string;
  rosterSlotId?: number;
  competition?: {
    competitionId?: number;
    name?: string;
    startTime?: string;
  };
  competitions?: Array<{
    competitionId?: number;
    name?: string;
    startTime?: string;
  }>;
  draftStatAttributes?: Array<{
    id?: number;
    value?: string;
  }>;
}

interface DraftKingsDraftablesResponse {
  draftables?: DraftKingsDraftable[];
  competitions?: Array<{
    competitionId?: number;
    name?: string;
    startTime?: string;
    homeTeam?: { abbreviation?: string; teamName?: string; city?: string };
    awayTeam?: { abbreviation?: string; teamName?: string; city?: string };
  }>;
}

interface EspnEvent {
  id: string;
  date: string;
  name: string;
  shortName?: string;
  competitions?: Array<{
    odds?: Array<{
      provider?: { name?: string; displayName?: string };
      details?: string;
      overUnder?: number;
      spread?: number;
    }>;
    competitors?: Array<{
      homeAway?: string;
      team?: {
        abbreviation?: string;
        displayName?: string;
        shortDisplayName?: string;
      };
    }>;
  }>;
}

interface EspnScoreboardResponse {
  events?: EspnEvent[];
  week?: { number?: number };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'f1']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const SCHEDULE_FALLBACK_LOOKAHEAD_DAYS = 10;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function supabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function supabaseAnonKey() {
  return Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY');
}

async function callSupabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T> {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) throw new Error('Supabase RPC environment is not configured.');

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${functionName} failed: ${response.status} ${message}`);
  }

  return await response.json() as T;
}

function draftKingsSportCode(sport: string): string | null {
  const codes: Record<string, string> = {
    nba: 'NBA',
    nfl: 'NFL',
    mlb: 'MLB',
    f1: 'F1',
  };
  return codes[sport] ?? null;
}

async function fetchDraftKingsLiveSlates(sport: string, contestType: string): Promise<DraftKingsSlate[]> {
  if (sport === 'wnba') return fetchDraftKingsWnbaSlates(contestType);

  const sportCode = draftKingsSportCode(sport);
  if (!sportCode) return [];

  const response = await fetch(`https://www.draftkings.com/lobby/getcontests?sport=${encodeURIComponent(sportCode)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return [];

  const data = await response.json() as DraftKingsContestResponse;
  const contests = data.Contests ?? [];
  const byDraftGroup = new Map<number, DraftKingsContest>();

  for (const contest of contests) {
    if (!contest.dg || !contestMatchesSport(contest, sport) || !contestMatchesType(contest, sport, contestType)) continue;
    if (isSimulatedContest(contest)) continue;
    if (!byDraftGroup.has(contest.dg)) byDraftGroup.set(contest.dg, contest);
  }

  const slates: DraftKingsSlate[] = [];
  for (const contest of [...byDraftGroup.values()].slice(0, 12)) {
    const slate = await fetchDraftKingsDraftGroupSlate(sport, contestType, contest).catch(() => null);
    if (slate) slates.push(slate);
  }

  return slates;
}

async function fetchDraftKingsWnbaSlates(contestType: string): Promise<DraftKingsSlate[]> {
  const response = await fetch('https://www.draftkings.com/lobby/getcontests?sport=NBA', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return [];

  const data = await response.json() as DraftKingsContestResponse;
  const contests = data.Contests ?? [];
  const byDraftGroup = new Map<number, DraftKingsContest>();

  for (const contest of contests) {
    const text = `${contest.gameType ?? ''} ${contest.n ?? ''}`.toLowerCase();
    const isWnba = text.includes('wnba');
    const isShowdown = text.includes('showdown') || text.includes('captain');
    const isClassic = !isShowdown && !text.includes('single stat') && !text.includes('snake') && !text.includes('best ball');
    if (!contest.dg || !isWnba) continue;
    if (contestType === 'showdown' && !isShowdown) continue;
    if (contestType === 'classic' && !isClassic) continue;
    if (!byDraftGroup.has(contest.dg)) byDraftGroup.set(contest.dg, contest);
  }

  const slates: DraftKingsSlate[] = [];
  for (const contest of [...byDraftGroup.values()].slice(0, 12)) {
    const slate = await fetchDraftKingsDraftGroupSlate('wnba', contestType, contest).catch(() => null);
    if (slate) slates.push(slate);
  }

  return slates;
}

function contestMatchesSport(contest: DraftKingsContest, sport: string): boolean {
  const text = `${contest.gameType ?? ''} ${contest.n ?? ''}`.toLowerCase();
  if (sport === 'wnba') return text.includes('wnba');
  if (sport === 'nba') return !text.includes('wnba');
  return true;
}

function contestMatchesType(contest: DraftKingsContest, sport: string, contestType: string): boolean {
  const text = `${contest.gameType ?? ''} ${contest.n ?? ''}`.toLowerCase();
  if (contestType === 'showdown') return text.includes('showdown') || text.includes('captain');
  if (sport === 'wnba') return text.includes('wnba') && !text.includes('showdown') && !text.includes('captain');
  return text.includes('classic') && !text.includes('showdown') && !text.includes('captain');
}

function isSimulatedContest(contest: DraftKingsContest): boolean {
  const text = `${contest.gameType ?? ''} ${contest.n ?? ''}`.toLowerCase();
  return text.includes('madden') || text.includes('simulated');
}

async function fetchDraftKingsDraftGroupSlate(
  sport: string,
  contestType: string,
  contest: DraftKingsContest,
): Promise<DraftKingsSlate | null> {
  const response = await fetch(`https://api.draftkings.com/draftgroups/v1/draftgroups/${contest.dg}/draftables?format=json`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;

  const data = await response.json() as DraftKingsDraftablesResponse;
  const draftables = data.draftables ?? [];
  if (!draftables.length) return null;

  const competitions = data.competitions ?? [];
  const startTime = competitions[0]?.startTime ?? draftables[0]?.competition?.startTime ?? parseDraftKingsDate(contest.sd);
  const contestDate = startTime ? toDateOnly(startTime) : toDateOnly(new Date().toISOString());
  const gameIds = unique(competitions
    .map((competition) => competition.competitionId)
    .filter((id): id is number => typeof id === 'number')
    .map(String));
  const teams = unique(competitions.flatMap((competition) => [
    competition.homeTeam?.abbreviation,
    competition.awayTeam?.abbreviation,
  ].filter((value): value is string => Boolean(value))));

  const normalizedSalaries = normalizeDraftKingsSalaries(draftables, contestType);
  if (!normalizedSalaries.length) return null;

  return {
    contest_id: `dk-${sport}-${contestType}-${contest.dg}`,
    external_contest_id: String(contest.dg),
    sport,
    contest_type: contestType,
    contest_date: contestDate,
    slate_name: contest.gameType ? `${contest.gameType} - Draft Group ${contest.dg}` : contest.n,
    game_ids: gameIds,
    salary_cap: 50_000,
    status: 'draftkings_live',
    start_time: startTime ?? null,
    salary_count: normalizedSalaries.length,
    data: {
      source: 'draftkings_unofficial_json',
      draft_group_id: contest.dg,
      contest_id: contest.id,
      contest_name: contest.n,
      game_type: contest.gameType ?? null,
      game_type_id: contest.gameTypeId ?? null,
      roster_size: draftKingsRosterSize(contest),
      team_abbreviations: teams,
      competitions,
      salaries: normalizedSalaries,
    },
    updated_at: new Date().toISOString(),
  };
}

function normalizeDraftKingsSalaries(draftables: DraftKingsDraftable[], contestType: string) {
  const byPlayerPosition = new Map<string, {
    player_id: string | null;
    player_name: string;
    team: string | null;
    position: string;
    salary: number;
    game_id: string | null;
    projected_points?: number;
  }>();

  for (const draftable of draftables) {
    const playerName = draftable.displayName ?? `${draftable.firstName ?? ''} ${draftable.lastName ?? ''}`.trim();
    const position = draftable.position ?? '';
    const salary = Number(draftable.salary);
    if (!playerName || !position || !Number.isFinite(salary) || salary <= 0) continue;

    const key = `${draftable.playerId ?? draftable.playerDkId ?? playerName}:${position}`;
    const projectedPoints = Number(draftable.draftStatAttributes?.find((attr) => attr.id === 90)?.value);
    const row = {
      player_id: draftable.playerId ? String(draftable.playerId) : draftable.playerDkId ? String(draftable.playerDkId) : null,
      player_name: playerName,
      team: draftable.teamAbbreviation ?? null,
      position,
      salary: contestType === 'showdown' && isCaptainSlot(draftable.rosterSlotId) ? Math.round(salary / 1.5) : salary,
      game_id: draftable.competition?.competitionId ? String(draftable.competition.competitionId) : null,
      projected_points: Number.isFinite(projectedPoints) ? projectedPoints : undefined,
    };

    const existing = byPlayerPosition.get(key);
    if (!existing || row.salary < existing.salary) byPlayerPosition.set(key, row);
  }

  return [...byPlayerPosition.values()];
}

function isCaptainSlot(rosterSlotId?: number): boolean {
  return rosterSlotId === 511;
}

function draftKingsRosterSize(contest: DraftKingsContest): number | null {
  const text = `${contest.gameType ?? ''} ${contest.n ?? ''}`.toLowerCase();
  const match = text.match(/(\d+)[-\s]?player/);
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function parseDraftKingsDate(value?: string): string | null {
  const match = String(value ?? '').match(/\/Date\((\d+)\)\//);
  if (!match) return null;
  return new Date(Number(match[1])).toISOString();
}

function espnSportPath(sport: string): string | null {
  const paths: Record<string, string> = {
    nba: 'basketball/nba',
    wnba: 'basketball/wnba',
    nfl: 'football/nfl',
    mlb: 'baseball/mlb',
    f1: 'racing/f1',
  };
  return paths[sport] ?? null;
}

async function fetchEspnScheduleSlates(sport: string, contestType: string): Promise<DraftKingsSlate[]> {
  const path = espnSportPath(sport);
  if (!path) return [];

  const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDatesRange()}`);
  if (!response.ok) return [];

  const data = await response.json() as EspnScoreboardResponse;
  const events = (data.events ?? []).filter((event) => isNearTermEvent(event.date));
  if (!events.length) return [];

  if (contestType === 'classic') {
    return [...groupEventsByDate(events).entries()].map(([contestDate, dateEvents]) => ({
      contest_id: `espn-${sport}-classic-${contestDate}`,
      external_contest_id: null,
      sport,
      contest_type: contestType,
      contest_date: contestDate,
      slate_name: `${sport.toUpperCase()} Classic Schedule Slate - ${contestDate}${data.week?.number ? ` - Week ${data.week.number}` : ''}`,
      game_ids: dateEvents.map((event) => event.id),
      salary_cap: 50_000,
      status: 'schedule_derived',
      start_time: dateEvents[0]?.date ?? null,
      salary_count: 0,
      data: {
        source: 'espn_scoreboard',
        salary_source: 'estimated',
        availability_window_days: SCHEDULE_FALLBACK_LOOKAHEAD_DAYS,
        event_count: dateEvents.length,
        events: dateEvents.map(toSlateEvent),
        team_abbreviations: unique(dateEvents.flatMap(teamAbbreviations)),
      },
      updated_at: new Date().toISOString(),
    }));
  }

  return events.map((event) => {
    const teams = teamAbbreviations(event);
    return {
      contest_id: `espn-${sport}-showdown-${event.id}`,
      external_contest_id: event.id,
      sport,
      contest_type: contestType,
      contest_date: toDateOnly(event.date),
      slate_name: event.shortName ? `${event.shortName} Schedule Slate` : `${event.name} Schedule Slate`,
      game_ids: [event.id],
      salary_cap: 50_000,
      status: 'schedule_derived',
      start_time: event.date,
      salary_count: 0,
      data: {
        source: 'espn_scoreboard',
        salary_source: 'estimated',
        availability_window_days: SCHEDULE_FALLBACK_LOOKAHEAD_DAYS,
        event: toSlateEvent(event),
        team_abbreviations: teams,
      },
      updated_at: new Date().toISOString(),
    };
  });
}

function toDateOnly(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysDateOnly(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function espnDatesRange(): string {
  const start = todayDateOnly().replaceAll('-', '');
  const end = addDaysDateOnly(todayDateOnly(), SCHEDULE_FALLBACK_LOOKAHEAD_DAYS).replaceAll('-', '');
  return `${start}-${end}`;
}

function isNearTermEvent(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const eventDate = toDateOnly(value);
  const today = todayDateOnly();
  const lookahead = addDaysDateOnly(today, SCHEDULE_FALLBACK_LOOKAHEAD_DAYS);

  return eventDate >= today && eventDate <= lookahead;
}

function groupEventsByDate(events: EspnEvent[]): Map<string, EspnEvent[]> {
  const byDate = new Map<string, EspnEvent[]>();
  for (const event of events) {
    const date = toDateOnly(event.date);
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }
  return byDate;
}

function slateDate(slate: DraftKingsSlate): string | null {
  if (slate.start_time) return toDateOnly(slate.start_time);
  if (slate.contest_date) return slate.contest_date;
  return null;
}

function slateMatchesRequest(slate: DraftKingsSlate, sport: string, contestType: string): boolean {
  const date = slateDate(slate);
  if (!date || date < todayDateOnly()) return false;
  if (String(slate.sport).toLowerCase() !== sport) return false;
  if (String(slate.contest_type).toLowerCase() !== contestType) return false;
  if (contestType === 'showdown' && slate.game_ids.length > 1) return false;
  return true;
}

function filterSlatesForRequest(slates: DraftKingsSlate[], sport: string, contestType: string): DraftKingsSlate[] {
  return slates
    .filter((slate) => slateMatchesRequest(slate, sport, contestType))
    .sort((left, right) => String(left.start_time ?? left.contest_date).localeCompare(String(right.start_time ?? right.contest_date)));
}

function teamAbbreviations(event: EspnEvent): string[] {
  return event.competitions?.[0]?.competitors
    ?.map((competitor) => competitor.team?.abbreviation)
    .filter((value): value is string => Boolean(value)) ?? [];
}

function toSlateEvent(event: EspnEvent) {
  const competition = event.competitions?.[0];
  const odds = competition?.odds?.find((item) => {
    const provider = `${item.provider?.name ?? ''} ${item.provider?.displayName ?? ''}`.toLowerCase();
    return provider.includes('draft');
  }) ?? competition?.odds?.[0];

  return {
    id: event.id,
    name: event.name,
    short_name: event.shortName ?? null,
    start_time: event.date,
    teams: competition?.competitors?.map((competitor) => ({
      home_away: competitor.homeAway ?? null,
      abbreviation: competitor.team?.abbreviation ?? null,
      display_name: competitor.team?.displayName ?? competitor.team?.shortDisplayName ?? null,
    })) ?? [],
    odds: odds ? {
      provider: odds.provider?.displayName ?? odds.provider?.name ?? null,
      details: odds.details ?? null,
      over_under: odds.overUnder ?? null,
      spread: odds.spread ?? null,
    } : null,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: SlateRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const sport = String(payload.sport ?? '').toLowerCase();
  const contestType = String(payload.contestType ?? '').toLowerCase();

  try {
    if (!VALID_SPORTS.has(sport)) throw new Error(`Unsupported sport: ${sport}`);
    if (!VALID_CONTEST_TYPES.has(contestType)) throw new Error(`Unsupported contest type: ${contestType}`);

    const slates = await callSupabaseRpc<DraftKingsSlate[]>('fantasy_ai_get_draftkings_slates', {
      p_sport: sport,
      p_contest_type: contestType,
    });
    const storedSlates = filterSlatesForRequest(slates, sport, contestType);
    const liveDraftKingsSlates = storedSlates.length ? [] : filterSlatesForRequest(await fetchDraftKingsLiveSlates(sport, contestType), sport, contestType);
    const discoveredSlates = storedSlates.length
      ? storedSlates
      : liveDraftKingsSlates.length
        ? liveDraftKingsSlates
        : filterSlatesForRequest(await fetchEspnScheduleSlates(sport, contestType), sport, contestType);

    return jsonResponse({
      slates: discoveredSlates,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
