interface NewsItem {
  id: string;
  sport: string;
  title: string;
  link: string | null;
  published_at: string | null;
  category: 'injury' | 'trade' | 'transaction' | 'news';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface EspnNewsArticle {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  links?: {
    web?: { href?: string };
    mobile?: { href?: string };
  };
}

interface EspnNewsResponse {
  articles?: EspnNewsArticle[];
}

const FEEDS: Record<string, string> = {
  wnba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/news',
  nba: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news',
  mlb: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news',
  nfl: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function categorize(title: string): NewsItem['category'] {
  const text = title.toLowerCase();
  if (/(injur|out\b|questionable|doubtful|probable|day-to-day|inactive|ir\b|concussion|hamstring|ankle|knee|shoulder|illness)/.test(text)) {
    return 'injury';
  }
  if (/(trade|traded|acquire|acquired|deal\b|swap)/.test(text)) return 'trade';
  if (/(sign|signed|waive|waived|release|released|claim|claimed|recall|option|activate|activated|transaction)/.test(text)) {
    return 'transaction';
  }
  return 'news';
}

function parseArticles(data: EspnNewsResponse, sport: string): NewsItem[] {
  return (data.articles ?? []).slice(0, 12).map((article, index) => {
    const title = String(article.headline ?? article.description ?? 'Untitled update').replace(/\s+/g, ' ').trim();
    const link = article.links?.web?.href ?? article.links?.mobile?.href ?? null;
    const published = article.published ?? article.lastModified;
    const publishedAt = published && !Number.isNaN(new Date(published).getTime()) ? new Date(published).toISOString() : null;
    return {
      id: `${sport}-${article.id ?? index}-${publishedAt ?? 'undated'}`,
      sport,
      title,
      link,
      published_at: publishedAt,
      category: categorize(title),
    };
  });
}

async function fetchSportFeed(sport: string, url: string): Promise<NewsItem[]> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FantasyAI-NewsTicker/1.0',
    },
  });
  if (!response.ok) throw new Error(`${sport} feed returned ${response.status}`);
  return parseArticles(await response.json() as EspnNewsResponse, sport);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  const results = await Promise.allSettled(
    Object.entries(FEEDS).map(async ([sport, url]) => fetchSportFeed(sport, url)),
  );
  const items = results
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => {
      const left = a.published_at ? new Date(a.published_at).getTime() : 0;
      const right = b.published_at ? new Date(b.published_at).getTime() : 0;
      return right - left;
    })
    .slice(0, 40);

  const sourceStatus = Object.keys(FEEDS).reduce<Record<string, 'ok' | 'unavailable'>>((acc, sport, index) => {
    acc[sport] = results[index]?.status === 'fulfilled' ? 'ok' : 'unavailable';
    return acc;
  }, {});

  return jsonResponse({
    items,
    source_status: sourceStatus,
    generated_at: new Date().toISOString(),
  });
});
