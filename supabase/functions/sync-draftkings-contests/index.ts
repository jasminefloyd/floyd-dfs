interface DraftKingsSalaryImport {
  player_id?: string;
  player_name: string;
  team?: string;
  position: string;
  salary: number;
  projected_points?: number;
  game_id?: string;
}

interface DraftKingsSlateImport {
  sport: string;
  contestType: string;
  contestDate: string;
  slateName: string;
  externalContestId?: string;
  gameIds?: string[];
  salaryCap?: number;
  status?: string;
  startTime?: string;
  data?: Record<string, unknown>;
  salaries?: DraftKingsSalaryImport[];
}

interface ImportRequest {
  slates?: DraftKingsSlateImport[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VALID_SPORTS = new Set(['nba', 'wnba', 'nfl', 'mlb', 'golf']);
const VALID_CONTEST_TYPES = new Set(['showdown', 'classic']);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function supabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

function validateServiceRole(req: Request) {
  const configuredKey = serviceRoleKey();
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  const tokenRole = decodeJwtRole(token);

  if (configuredKey && token === configuredKey) return;
  if (tokenRole === 'service_role') return;

  throw new Error('DraftKings import requires service-role authorization.');
}

function decodeJwtRole(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    const decoded = JSON.parse(atob(padded)) as { role?: string };
    return decoded.role ?? null;
  } catch {
    return null;
  }
}

function validateSlate(slate: DraftKingsSlateImport) {
  const sport = String(slate.sport ?? '').toLowerCase();
  const contestType = String(slate.contestType ?? '').toLowerCase();
  if (!VALID_SPORTS.has(sport)) throw new Error(`Unsupported sport: ${slate.sport}`);
  if (!VALID_CONTEST_TYPES.has(contestType)) throw new Error(`Unsupported contest type: ${slate.contestType}`);
  if (!slate.contestDate || Number.isNaN(new Date(`${slate.contestDate}T00:00:00`).getTime())) {
    throw new Error('contestDate must be a valid YYYY-MM-DD date.');
  }
  if (!String(slate.slateName ?? '').trim()) throw new Error('slateName is required.');
  if (slate.salaries && !Array.isArray(slate.salaries)) throw new Error('salaries must be an array.');

  for (const salary of slate.salaries ?? []) {
    if (!salary.player_name || !salary.position || !Number.isFinite(Number(salary.salary)) || Number(salary.salary) <= 0) {
      throw new Error('Each salary row requires player_name, position, and positive salary.');
    }
    if (salary.projected_points !== undefined && !Number.isFinite(Number(salary.projected_points))) {
      throw new Error('projected_points must be numeric when provided.');
    }
  }
}

async function callImportRpc(slate: DraftKingsSlateImport): Promise<Record<string, unknown>> {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('Supabase environment is not configured for DraftKings imports.');

  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/fantasy_ai_import_draftkings_slate`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_sport: slate.sport.toLowerCase(),
      p_contest_type: slate.contestType.toLowerCase(),
      p_contest_date: slate.contestDate,
      p_slate_name: slate.slateName,
      p_external_contest_id: slate.externalContestId ?? null,
      p_game_ids: slate.gameIds ?? [],
      p_salary_cap: slate.salaryCap ?? 50_000,
      p_status: slate.status ?? 'imported',
      p_start_time: slate.startTime ?? null,
      p_data: slate.data ?? {},
      p_salaries: slate.salaries ?? [],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`DraftKings slate import failed: ${response.status} ${message}`);
  }

  return await response.json() as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    validateServiceRole(req);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 401);
  }

  let payload: ImportRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const slates = payload.slates ?? [];
    if (!slates.length) throw new Error('At least one slate is required.');

    const imported = [];
    for (const slate of slates) {
      validateSlate(slate);
      const result = await callImportRpc(slate);
      imported.push({
        ...result,
        sport: slate.sport.toLowerCase(),
        contest_type: slate.contestType.toLowerCase(),
        contest_date: slate.contestDate,
        slate_name: slate.slateName,
      });
    }

    return jsonResponse({
      imported,
      imported_count: imported.length,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
