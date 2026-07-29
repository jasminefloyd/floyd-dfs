// Intended schedule: run per sport about 2 hours and 30 minutes before the
// typical slate lock (for example, NBA often locks around 7pm ET; other sports vary).
// This repo has no supabase/config.toml scheduling pattern, so cron wiring is documented
// here and intentionally not implemented in this change.

import { parseOwnershipRows, type OwnershipProjection } from './parser.ts';

type Sport = 'nba' | 'wnba' | 'nfl' | 'mlb';

interface ScrapeRequest {
  sport?: Sport;
  contestDate?: string;
  contestType?: string;
  contestId?: string;
  draftGroupId?: string;
  gameId?: string;
}

interface SourceAttempt {
  source: string;
  url: string;
  rows: OwnershipProjection[];
  status: 'ok' | 'failed';
  error?: string;
}

const MIN_SOURCE_ROWS = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function envSupabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function envSupabaseServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

function envFirecrawlApiKey() {
  return Deno.env.get('FIRECRAWL_API_KEY');
}

function envSerpApiKey() {
  return Deno.env.get('SERPAPI_API_KEY') ?? Deno.env.get('SERP_API_KEY');
}

function yesterdayDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('contestDate must be YYYY-MM-DD');
  return value;
}

function dailyFantasyFuelUrls(sport: Sport, contestDate: string): string[] {
  const base = `https://www.dailyfantasyfuel.com/${sport}/projections/draftkings`;
  return [`${base}/${contestDate}/`, `${base}/`];
}

async function callSupabaseRpc<T>(functionName: string, body: Record<string, unknown>): Promise<T | null> {
  const supabaseUrl = envSupabaseUrl();
  const serviceRoleKey = envSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) throw new Error(`Supabase service-role env is not configured for ${functionName}`);

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
  return text ? JSON.parse(text) as T : null;
}

async function firecrawlScrape(url: string): Promise<string> {
  const apiKey = envFirecrawlApiKey();
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not configured');

  const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
      onlyMainContent: true,
      timeout: 30000,
      removeBase64Images: true,
      blockAds: true,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firecrawl scrape failed for ${url}: ${response.status} ${message}`);
  }

  const payload = await response.json();
  const data = payload?.data ?? payload;
  return [data?.markdown, data?.html, data?.rawHtml].filter(Boolean).join('\n\n');
}

async function scrapeUrl(source: string, url: string): Promise<SourceAttempt> {
  try {
    const content = await firecrawlScrape(url);
    const rows = parseOwnershipRows(content);
    return {
      source,
      url,
      rows,
      status: rows.length >= MIN_SOURCE_ROWS ? 'ok' : 'failed',
      error: rows.length >= MIN_SOURCE_ROWS ? undefined : `parsed fewer than ${MIN_SOURCE_ROWS} ownership rows`,
    };
  } catch (error) {
    return { source, url, rows: [], status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}

async function findRotogrindersUrl(sport: Sport, contestDate: string): Promise<string | undefined> {
  const apiKey = envSerpApiKey();
  if (!apiKey) return undefined;

  const query = `site:rotogrinders.com ${sport} ownership projections ${contestDate}`;
  const params = new URLSearchParams({ engine: 'google', q: query, api_key: apiKey });
  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!response.ok) return undefined;
  const payload = await response.json();
  const result = payload?.organic_results?.find((item: any) => typeof item?.link === 'string' && item.link.includes('rotogrinders.com'));
  return result?.link;
}

async function scrapeOwnership(sport: Sport, contestDate: string): Promise<{ selected?: SourceAttempt; attempts: SourceAttempt[] }> {
  const attempts: SourceAttempt[] = [];

  for (const url of dailyFantasyFuelUrls(sport, contestDate)) {
    const attempt = await scrapeUrl('dailyfantasyfuel', url);
    attempts.push(attempt);
    if (attempt.status === 'ok') return { selected: attempt, attempts };
  }

  const rotogrindersUrl = await findRotogrindersUrl(sport, contestDate);
  if (rotogrindersUrl) {
    const attempt = await scrapeUrl('rotogrinders', rotogrindersUrl);
    attempts.push(attempt);
    if (attempt.status === 'ok') return { selected: attempt, attempts };
  }

  return { attempts };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({})) as ScrapeRequest;
    const sport = String(body.sport ?? '').toLowerCase() as Sport;
    if (!['nba', 'wnba', 'nfl', 'mlb'].includes(sport)) throw new Error('sport must be one of nba, wnba, nfl, mlb');
    const contestDate = validateDate(body.contestDate ?? yesterdayDate());

    const { selected, attempts } = await scrapeOwnership(sport, contestDate);
    if (!selected) {
      return jsonResponse({
        sport,
        contestDate,
        source: null,
        scraped: 0,
        upserted: 0,
        attempts,
      });
    }

    const upserted = await callSupabaseRpc<number>('fantasy_ai_upsert_ownership_projections_v2', {
      p_sport: sport,
      p_contest_date: contestDate,
      p_source: selected.source,
      p_contest_type: body.contestType ?? null,
      p_contest_id: body.contestId ?? null,
      p_draft_group_id: body.draftGroupId ?? null,
      p_game_id: body.gameId ?? null,
      p_rows: selected.rows,
    });

    return jsonResponse({
      sport,
      contestDate,
      source: selected.source,
      url: selected.url,
      scraped: selected.rows.length,
      upserted: upserted ?? 0,
      attempts,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
