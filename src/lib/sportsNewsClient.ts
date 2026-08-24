export interface SportsNewsItem {
  id: string;
  sport: string;
  title: string;
  link: string | null;
  published_at: string | null;
  category: 'injury' | 'trade' | 'transaction' | 'news';
  source_name?: string;
  source_kind?: 'espn' | 'league' | 'unknown';
}

interface SportsNewsResponse {
  items: SportsNewsItem[];
  generated_at: string;
  source_status: Record<string, 'ok' | 'unavailable'>;
}

interface SportsNewsError {
  error?: string;
}

export async function listSportsNews(signal?: AbortSignal): Promise<SportsNewsItem[]> {
  const baseUrl = import.meta.env.VITE_FLOYD_DFS_API_URL?.replace(/\/$/, '') ?? '';
  const response = await fetch(`${baseUrl}/api/news`, { method: 'GET', signal });

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Sports news ticker did not return JSON.');
  }

  const data = await response.json() as SportsNewsResponse | SportsNewsError;
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : `Sports news ticker failed: ${response.status}`);
  }

  return 'items' in data ? data.items : [];
}
