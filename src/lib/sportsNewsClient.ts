import { supabaseAnonKey, supabaseUrl } from './supabaseClient';

export interface SportsNewsItem {
  id: string;
  sport: string;
  title: string;
  link: string | null;
  published_at: string | null;
  category: 'injury' | 'trade' | 'transaction' | 'news';
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
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL and anon key are required to load sports news.');
  }

  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/sports-news-ticker`, {
    method: 'GET',
    signal,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });

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
