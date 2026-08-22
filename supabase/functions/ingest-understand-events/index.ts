type Sport = 'nba' | 'wnba' | 'mlb' | 'nfl' | 'golf';

const SPORTS: Sport[] = ['nba', 'wnba', 'mlb', 'nfl', 'golf'];
const NEWS_FEEDS: Record<Sport, string> = {
  nba: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/news',
  wnba: 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/wnba/news',
  mlb: 'https://site.web.api.espn.com/apis/site/v2/sports/baseball/mlb/news',
  nfl: 'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/news',
  golf: 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga/news',
};
const LINEUP_URLS: Record<Exclude<Sport, 'golf'>, string> = {
  nba: 'https://www.rotowire.com/basketball/nba-lineups.php',
  wnba: 'https://www.rotowire.com/wnba/lineups.php',
  mlb: 'https://www.rotowire.com/baseball/daily-lineups.php',
  nfl: 'https://www.rotowire.com/football/nfl-lineups.php',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface NewsArticle {
  id?: string | number;
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  links?: { web?: { href?: string }; mobile?: { href?: string } };
}

interface NewsItem {
  id: string;
  sport: Sport;
  title: string;
  link: string | null;
  published_at: string | null;
  category: 'injury' | 'trade' | 'transaction' | 'news';
  raw: NewsArticle;
}

interface ConfirmedLineup {
  sport: Sport;
  game_date: string;
  team: string;
  player_name: string;
  batting_order: number | null;
  lineup_status: string;
  injury_tag: string | null;
  is_starting_pitcher: boolean;
  scraped_at: string | null;
}

interface OwnershipProjection {
  player_name: string;
  ownership_pct: number;
  cpt_ownership_pct?: number | null;
  flex_ownership_pct?: number | null;
  source: string;
  scraped_at: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function supabaseUrl() {
  return Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL');
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
}

async function callRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error('Supabase service-role environment is not configured');
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) as T : ([] as T);
}

function validIsoDate(value: string | null | undefined): string | null {
  return value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}

function dateFromOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function categorize(title: string): NewsItem['category'] {
  const text = title.toLowerCase();
  if (/(injur|out\b|questionable|doubtful|probable|day-to-day|inactive|ir\b|concussion|hamstring|ankle|knee|shoulder|illness)/.test(text)) return 'injury';
  if (/(trade|traded|acquire|acquired|deal\b|swap)/.test(text)) return 'trade';
  if (/(sign|signed|waive|waived|release|released|claim|claimed|recall|option|activate|activated|transaction)/.test(text)) return 'transaction';
  return 'news';
}

function materialityForNews(category: NewsItem['category']): number {
  return category === 'injury' ? 4 : category === 'trade' || category === 'transaction' ? 3 : 1;
}

async function fetchNews(sport: Sport): Promise<NewsItem[]> {
  const response = await fetch(NEWS_FEEDS[sport], { headers: { Accept: 'application/json', 'User-Agent': 'FantasyAI-Understand/1.0' } });
  if (!response.ok) throw new Error(`ESPN ${sport} feed returned ${response.status}`);
  const payload = await response.json() as { articles?: NewsArticle[] };
  return (payload.articles ?? []).slice(0, 20).map((article, index) => {
    const title = String(article.headline ?? article.description ?? 'Untitled update').replace(/\s+/g, ' ').trim();
    const publishedAt = validIsoDate(article.published ?? article.lastModified);
    const category = categorize(title);
    return {
      id: `${sport}-${article.id ?? index}-${publishedAt ?? 'undated'}`,
      sport,
      title,
      link: article.links?.web?.href ?? article.links?.mobile?.href ?? null,
      published_at: publishedAt,
      category,
      raw: article,
    };
  });
}

async function getConfirmedLineups(sport: Exclude<Sport, 'golf'>, gameDate: string): Promise<ConfirmedLineup[]> {
  return callRpc<ConfirmedLineup[]>('fantasy_ai_get_confirmed_lineups', { p_sport: sport, p_game_date: gameDate });
}

async function getOwnership(sport: Sport, contestDate: string): Promise<OwnershipProjection[]> {
  return callRpc<OwnershipProjection[]>('fantasy_ai_get_ownership_projections_v2', {
    p_sport: sport,
    p_contest_date: contestDate,
    p_contest_type: null,
    p_contest_id: null,
    p_draft_group_id: null,
    p_game_id: null,
  });
}

function sourceRows(sources: Array<{ source_key: string; display_name: string; source_kind: string; reliability_score: number }>) {
  return sources.map((source) => ({ ...source, active: true }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({})) as { sports?: Sport[]; include_market?: boolean };
    const sports = (body.sports?.length ? body.sports : SPORTS).filter((sport): sport is Sport => SPORTS.includes(sport));
    const includeMarket = body.include_market !== false;
    const contestDate = dateFromOffset(0);

    const newsResults = await Promise.allSettled(sports.map(fetchNews));
    const newsItems = newsResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const sourceKeys = new Set<string>(['espn_news', 'confirmed_lineups']);
    const events: Record<string, unknown>[] = newsItems.map((item) => ({
      source_key: 'espn_news',
      source_event_id: item.id,
      dedupe_key: item.id,
      sport: item.sport,
      league: item.sport === 'golf' ? 'pga' : item.sport,
      event_type: item.category,
      title: item.title,
      source_url: item.link,
      published_at: item.published_at,
      observed_at: new Date().toISOString(),
      confidence_score: item.category === 'injury' || item.category === 'transaction' ? 0.65 : 0.5,
      materiality: materialityForNews(item.category),
      raw_payload: item.raw,
    }));

    const lineupResults = await Promise.allSettled(
      sports.filter((sport): sport is Exclude<Sport, 'golf'> => sport !== 'golf').flatMap((sport) => [
        getConfirmedLineups(sport, contestDate),
        getConfirmedLineups(sport, dateFromOffset(1)),
      ]),
    );
    const lineupRows = lineupResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    events.push(...lineupRows.map((row) => {
      const isInjury = Boolean(row.injury_tag);
      const sourceUrl = LINEUP_URLS[row.sport as Exclude<Sport, 'golf'>];
      return {
        source_key: 'confirmed_lineups',
        source_event_id: `${row.sport}:${row.game_date}:${row.team}:${row.player_name}`,
        dedupe_key: `${row.sport}:${row.game_date}:${row.team}:${row.player_name}`,
        sport: row.sport,
        league: row.sport,
        event_type: isInjury ? 'injury' : 'lineup_update',
        title: `${row.player_name} ${row.injury_tag ? `${row.injury_tag} ` : ''}${row.lineup_status} for ${row.team}`,
        summary: `${row.player_name} is listed as ${row.lineup_status} for ${row.team} on ${row.game_date}.`,
        source_url: sourceUrl,
        observed_at: validIsoDate(row.scraped_at) ?? new Date().toISOString(),
        player_name: row.player_name,
        team: row.team,
        confidence_score: row.lineup_status === 'confirmed' ? 0.9 : 0.65,
        materiality: isInjury ? 4 : row.lineup_status === 'confirmed' ? 3 : 2,
        raw_payload: row,
      };
    }));

    if (includeMarket) {
      const ownershipResults = await Promise.allSettled(sports.map((sport) => getOwnership(sport, contestDate)));
      const ownershipRows = ownershipResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
      events.push(...ownershipRows.map((row) => {
        const sourceKey = `ownership_${row.source || 'unknown'}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        sourceKeys.add(sourceKey);
        return {
          source_key: sourceKey,
          source_event_id: `${row.source}:${row.player_name}:${row.scraped_at ?? 'unknown'}`,
          dedupe_key: `${row.source}:${row.player_name}:${row.scraped_at ?? 'unknown'}`,
          sport: 'unknown',
          league: null,
          event_type: 'market_movement',
          title: `${row.player_name} ownership projection ${Number(row.ownership_pct).toFixed(1)}%`,
          summary: `Ownership projection from ${row.source} for the current slate.`,
          published_at: row.scraped_at,
          observed_at: validIsoDate(row.scraped_at) ?? new Date().toISOString(),
          confidence_score: 0.5,
          materiality: Number(row.ownership_pct) >= 20 ? 2 : 1,
          raw_payload: row,
        };
      }));
    }

    const sourcePayload = sourceRows([
      { source_key: 'espn_news', display_name: 'ESPN Sports News', source_kind: 'media', reliability_score: 0.5 },
      { source_key: 'confirmed_lineups', display_name: 'Confirmed Lineup Feed', source_kind: 'aggregator', reliability_score: 0.7 },
      ...[...sourceKeys].filter((key) => key.startsWith('ownership_')).map((source_key) => ({
        source_key, display_name: source_key.replace(/^ownership_/, 'Ownership: '), source_kind: 'market', reliability_score: 0.5,
      })),
    ]);
    await callRpc<number>('fantasy_ai_upsert_intelligence_sources', { p_sources: sourcePayload });
    const upserted = events.length ? await callRpc<number>('fantasy_ai_upsert_intelligence_events', { p_events: events }) : 0;

    return jsonResponse({
      contest_date: contestDate,
      sports,
      fetched: { news: newsItems.length, lineups: lineupRows.length, market: events.filter((event) => event.event_type === 'market_movement').length },
      upserted: upserted ?? 0,
      source_status: Object.fromEntries(sports.map((sport, index) => [sport, newsResults[index]?.status === 'fulfilled' ? 'ok' : 'unavailable'])),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
