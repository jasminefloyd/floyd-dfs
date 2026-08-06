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
  playerImage160?: string;
  playerImage50?: string;
  altPlayerImage160?: string;
  altPlayerImage50?: string;
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
  playerGameAttributes?: Array<{
    id?: number;
    value?: string;
  }>;
  isDisabled?: boolean;
}

interface DraftKingsDraftablesResponse {
  draftables?: DraftKingsDraftable[];
  competitions?: Array<{
    competitionId?: number;
    name?: string;
    startTime?: string;
    homeTeam?: { abbreviation?: string; teamName?: string; city?: string; teamImageUrl?: string; darkModeImageUrl?: string };
    awayTeam?: { abbreviation?: string; teamName?: string; city?: string; teamImageUrl?: string; darkModeImageUrl?: string };
  }>;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'golf']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);
const SLATE_LOOKAHEAD_HOURS = 48;
const DRAFTKINGS_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; fantasy-ai/1.0; +https://floyd-dfs.vercel.app)',
  Referer: 'https://www.draftkings.com/',
};

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
    golf: 'GOLF',
  };
  return codes[sport] ?? null;
}

async function fetchDraftKingsLiveSlates(sport: string, contestType: string): Promise<DraftKingsSlate[]> {
  if (sport === 'wnba') return fetchDraftKingsWnbaSlates(contestType);

  const sportCode = draftKingsSportCode(sport);
  if (!sportCode) return [];

  const response = await fetch(`https://www.draftkings.com/lobby/getcontests?sport=${encodeURIComponent(sportCode)}`, {
    headers: DRAFTKINGS_HEADERS,
  });
  if (!response.ok) throw new Error(`DraftKings lobby fetch failed: ${response.status}`);

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
    headers: DRAFTKINGS_HEADERS,
  });
  if (!response.ok) throw new Error(`DraftKings lobby fetch failed: ${response.status}`);

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
  if (text.includes('snake') || text.includes('single stat') || text.includes('best ball')) return false;
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
    headers: DRAFTKINGS_HEADERS,
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

  const rosterSize = draftKingsRosterSize(contest) ?? (contestType === 'showdown' ? 6 : null);
  const normalizedSalaries = normalizeDraftKingsSalaries(draftables, sport, contestType, rosterSize);
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
      roster_size: rosterSize,
      team_abbreviations: teams,
      competitions,
      salaries: normalizedSalaries,
    },
    updated_at: new Date().toISOString(),
  };
}

function normalizeDraftKingsSalaries(draftables: DraftKingsDraftable[], sport: string, contestType: string, rosterSize: number | null) {
  const activeDraftables = draftables.filter((draftable) => {
    const playerName = draftable.displayName ?? `${draftable.firstName ?? ''} ${draftable.lastName ?? ''}`.trim();
    const position = draftable.position ?? '';
    const salary = Number(draftable.salary);
    if (!playerName || !position || !Number.isFinite(salary) || salary <= 0) return false;
    if (draftable.isDisabled) return false;
    if (String(draftable.status ?? '').toLowerCase() === 'il') return false;
    return true;
  });
  const starterDraftables = activeDraftables.filter(hasDraftKingsStarterSignal);
  const minimumRows = rosterSize ?? (contestType === 'showdown' ? 6 : 1);
  const shouldUseStarterOnly = sport === 'mlb' && contestType === 'classic' && starterDraftables.length >= minimumRows;
  const byPlayerPosition = new Map<string, {
    player_id: string | null;
    player_name: string;
    team: string | null;
    position: string;
    salary: number;
    game_id: string | null;
    projected_points?: number;
    status?: string | null;
    is_disabled?: boolean;
    is_confirmed_starter?: boolean;
    image_url?: string | null;
    team_logo_url?: string | null;
    tee_time?: string | null;
    starting_hole?: string | null;
  }>();
  const teamLogos = teamLogoMap(draftables);
  // DraftKings' FPPG attribute id differs by sport; golf uses 795 ("FPPG"), everything
  // else in this repo uses 90. Confirmed live against both a classic and showdown golf
  // draftgroup's draftStats dictionary.
  const fppgAttributeId = sport === 'golf' ? 795 : 90;

  for (const draftable of shouldUseStarterOnly ? starterDraftables : activeDraftables) {
    const playerName = draftable.displayName ?? `${draftable.firstName ?? ''} ${draftable.lastName ?? ''}`.trim();
    const position = draftable.position ?? '';
    const salary = Number(draftable.salary);

    const key = `${draftable.playerId ?? draftable.playerDkId ?? playerName}:${position}`;
    // DraftKings attribute 90 is retained as a labeled historical FPPG feature.
    // It is not a forward-looking projection and must not populate projected_points.
    const dkFppg = Number(draftable.draftStatAttributes?.find((attr) => attr.id === fppgAttributeId)?.value);
    const row = {
      player_id: draftable.playerId ? String(draftable.playerId) : draftable.playerDkId ? String(draftable.playerDkId) : null,
      player_name: playerName,
      team: draftable.teamAbbreviation ?? null,
      position,
      salary: contestType === 'showdown' && isCaptainSlot(draftable.rosterSlotId) ? Math.round(salary / 1.5) : salary,
      game_id: draftable.competition?.competitionId ? String(draftable.competition.competitionId) : null,
      dk_fppg: Number.isFinite(dkFppg) ? dkFppg : undefined,
      status: draftable.status ?? null,
      is_disabled: draftable.isDisabled ?? false,
      is_confirmed_starter: hasDraftKingsStarterSignal(draftable),
      image_url: draftable.playerImage160 || draftable.playerImage50 || draftable.altPlayerImage160 || draftable.altPlayerImage50 || null,
      team_logo_url: teamLogos.get(String(draftable.teamAbbreviation ?? '').toUpperCase()) ?? null,
      ...(sport === 'golf' ? {
        tee_time: golfPlayerGameAttribute(draftable, 102),
        starting_hole: golfPlayerGameAttribute(draftable, 103),
      } : {}),
    };

    const existing = byPlayerPosition.get(key);
    if (!existing || row.salary < existing.salary) byPlayerPosition.set(key, row);
  }

  return [...byPlayerPosition.values()];
}

// DraftKings golf draftgroups carry each round's tee time / starting hole as
// playerGameAttributes ids 102/104 (round 1/round 2 tee time) and 103/105 (round 1/round 2
// starting hole) -- confirmed live against a real PGA classic draftgroup. Only round 1 is
// captured for now since that's what the wave-correlation grouping needs.
function golfPlayerGameAttribute(draftable: DraftKingsDraftable, attributeId: number): string | null {
  const attribute = draftable.playerGameAttributes?.find((entry) => entry.id === attributeId);
  return attribute?.value ?? null;
}

function teamLogoMap(draftables: DraftKingsDraftable[]): Map<string, string> {
  const logos = new Map<string, string>();
  for (const draftable of draftables) {
    for (const competition of draftable.competitions ?? [draftable.competition].filter(Boolean)) {
      const teams = [
        (competition as any)?.homeTeam,
        (competition as any)?.awayTeam,
      ];
      for (const team of teams) {
        const abbreviation = String(team?.abbreviation ?? '').toUpperCase();
        const logoUrl = team?.teamImageUrl ?? team?.darkModeImageUrl;
        if (abbreviation && typeof logoUrl === 'string') logos.set(abbreviation, logoUrl);
      }
    }
  }
  return logos;
}

function hasDraftKingsStarterSignal(draftable: DraftKingsDraftable): boolean {
  const truthyAttributeIds = new Set([1, 100, 110, 130, 137]);
  return draftable.playerGameAttributes?.some((attribute) => (
    attribute.id !== undefined &&
    truthyAttributeIds.has(attribute.id) &&
    String(attribute.value).toLowerCase() === 'true'
  )) ?? false;
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

function toDateOnly(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function slateStartTime(slate: DraftKingsSlate): Date | null {
  const rawValue = slate.start_time ?? (slate.contest_date ? `${slate.contest_date}T00:00:00.000Z` : null);
  if (!rawValue) return null;
  const date = new Date(rawValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

function slateMatchesRequest(slate: DraftKingsSlate, sport: string, contestType: string): boolean {
  const startTime = slateStartTime(slate);
  const now = new Date();
  const latestAllowedTime = new Date(now.getTime() + SLATE_LOOKAHEAD_HOURS * 60 * 60 * 1000);
  if (!startTime || startTime < now || startTime > latestAllowedTime) return false;
  if (slate.salary_count <= 0) return false;
  if (slate.status === 'schedule_derived' || slate.status === 'estimated') return false;
  if (String(slate.sport).toLowerCase() !== sport) return false;
  if (String(slate.contest_type).toLowerCase() !== contestType) return false;
  if (contestType === 'showdown' && slate.game_ids.length > 1) return false;
  if (contestType === 'showdown' && !showdownSlateHasFeasibleRoster(slate)) return false;
  return true;
}

function showdownSlateHasFeasibleRoster(slate: DraftKingsSlate): boolean {
  const data = slate.data as { salaries?: Array<{ player_id?: string | null; player_name?: string; team?: string | null; salary?: number }>; roster_size?: number } | undefined;
  const salaries = (data?.salaries ?? [])
    .map((row, index) => ({
      id: String(row.player_id ?? row.player_name ?? index),
      team: String(row.team ?? '').toUpperCase(),
      salary: Number(row.salary),
    }))
    .filter((row) => row.team && Number.isFinite(row.salary) && row.salary > 0);
  const rosterSize = Number.isFinite(Number(data?.roster_size)) ? Number(data?.roster_size) : 6;
  if (salaries.length < rosterSize) return false;
  if (new Set(salaries.map((row) => row.team)).size < 2) return false;

  for (const captain of salaries) {
    const captainSalary = Math.floor(captain.salary * 1.5);
    const remaining = salaries.filter((row) => row.id !== captain.id);
    const otherTeamOptions = remaining.filter((row) => row.team !== captain.team).sort((a, b) => a.salary - b.salary);
    for (const runback of otherTeamOptions) {
      const filler = remaining
        .filter((row) => row.id !== runback.id)
        .sort((a, b) => a.salary - b.salary)
        .slice(0, rosterSize - 2);
      if (filler.length !== rosterSize - 2) continue;
      const salaryUsed = captainSalary + runback.salary + filler.reduce((sum, row) => sum + row.salary, 0);
      if (salaryUsed <= 50_000) return true;
    }
  }

  return false;
}

function filterSlatesForRequest(slates: DraftKingsSlate[], sport: string, contestType: string): DraftKingsSlate[] {
  return slates
    .filter((slate) => slateMatchesRequest(slate, sport, contestType))
    .sort((left, right) => String(left.start_time ?? left.contest_date).localeCompare(String(right.start_time ?? right.contest_date)));
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
      : liveDraftKingsSlates;

    return jsonResponse({
      slates: discoveredSlates,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
