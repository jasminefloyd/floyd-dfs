// Intended schedule:
// - NBA/WNBA: every 30 minutes from 3pm-8pm ET on slate days.
// - MLB: hourly from 11am ET on slate days.
// - NFL: Sundays every 30 minutes from 10:30am-1pm ET.
// Supabase config in this repo does not currently define scheduled functions, so
// cron/pg_cron wiring is documented here and intentionally not implemented.

import { parseRotowireLineups, type LineupSport } from './parser.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROTOWIRE_URLS: Record<LineupSport, string> = {
  nba: 'https://www.rotowire.com/basketball/nba-lineups.php',
  wnba: 'https://www.rotowire.com/basketball/wnba-lineups.php',
  mlb: 'https://www.rotowire.com/baseball/daily-lineups.php',
  nfl: 'https://www.rotowire.com/football/nfl-lineups.php',
};

interface ScrapeRequest {
  sport?: LineupSport;
  game_date?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envFirecrawlKey() {
  return Deno.env.get('FIRECRAWL_API_KEY');
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envSupabaseServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

async function callSupabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T | null> {
  const supabaseUrl = envSupabaseUrl();
  const serviceRoleKey = envSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`Supabase service-role environment is not configured for ${functionName}`);
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${functionName} failed: ${response.status} ${message}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

async function scrapeRotowireHtml(sport: LineupSport): Promise<{ html: string; markdown?: string }> {
  const firecrawlKey = envFirecrawlKey();
  if (!firecrawlKey) throw new Error('FIRECRAWL_API_KEY is required');

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: ROTOWIRE_URLS[sport],
      formats: ['markdown', 'html'],
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firecrawl scrape failed: ${response.status} ${message}`);
  }

  const payload = await response.json() as any;
  const data = payload?.data ?? payload;
  return {
    html: String(data?.html ?? data?.content ?? ''),
    markdown: data?.markdown ? String(data.markdown) : undefined,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let payload: ScrapeRequest;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const sport = String(payload.sport ?? '').toLowerCase() as LineupSport;
  if (!ROTOWIRE_URLS[sport]) return jsonResponse({ error: 'sport must be one of nba, wnba, mlb, nfl' }, 400);
  if (!envFirecrawlKey()) return jsonResponse({ error: 'FIRECRAWL_API_KEY is required to scrape Rotowire lineups' }, 400);

  const gameDate = payload.game_date && !Number.isNaN(new Date(`${payload.game_date}T00:00:00`).getTime())
    ? payload.game_date
    : new Date().toISOString().slice(0, 10);

  try {
    const scraped = await scrapeRotowireHtml(sport);
    const rows = parseRotowireLineups(scraped.html, sport, gameDate);
    const warning = rows.length
      ? null
      : 'Rotowire page scraped successfully, but zero lineup rows parsed; page structure may have changed.';
    const upserted = rows.length
      ? await callSupabaseRpc<number>('fantasy_ai_upsert_confirmed_lineups', { p_rows: rows })
      : 0;

    return jsonResponse({
      sport,
      game_date: gameDate,
      source_url: ROTOWIRE_URLS[sport],
      parsed_count: rows.length,
      upserted_count: upserted ?? 0,
      warning,
      sample: rows.slice(0, 8),
    });
  } catch (error) {
    return jsonResponse({
      sport,
      game_date: gameDate,
      parsed_count: 0,
      upserted_count: 0,
      warning: error instanceof Error ? error.message : String(error),
      sample: [],
    });
  }
});
