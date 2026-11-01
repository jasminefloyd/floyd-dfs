import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEspnJson } from '../../src/lib/engine/espnApiClient.js';

export type NbaScheduleStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'POSTPONED' | 'CANCELLED' | 'UNKNOWN';
export interface NbaScheduleGame {
  provider: 'ESPN';
  provider_game_id: string;
  season: string | null;
  home_team_id: string;
  away_team_id: string;
  home_team_code: string;
  away_team_code: string;
  scheduled_start_at: string;
  status: NbaScheduleStatus;
  source: string;
  retrieved_at: string;
  last_confirmed_at: string;
  provider_raw_reference: Record<string, unknown>;
}

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const UPCOMING_HORIZON_DAYS = 14;
const PAGE_SIZE = 500;

export function normalizeEspnNbaSchedule(payload: unknown, retrievedAt: string, source = 'ESPN_NBA_SCOREBOARD'): NbaScheduleGame[] {
  const root = record(payload);
  if (!root || !Array.isArray(root.events)) throw new Error('ESPN NBA scoreboard response did not contain an events array.');
  const retrieved = Date.parse(retrievedAt);
  if (!Number.isFinite(retrieved)) throw new Error('NBA schedule retrieval timestamp is invalid.');
  const games = root.events.flatMap((raw) => {
    const event = record(raw);
    const competition = record(array(event?.competitions)[0]);
    const competitors = array(competition?.competitors).map(record).filter((item): item is Record<string, unknown> => Boolean(item));
    const home = competitors.find((item) => item.homeAway === 'home');
    const away = competitors.find((item) => item.homeAway === 'away');
    const homeTeam = record(home?.team);
    const awayTeam = record(away?.team);
    const eventId = scalar(event?.id);
    const start = scalar(event?.date);
    const homeId = scalar(homeTeam?.id);
    const awayId = scalar(awayTeam?.id);
    const homeCode = scalar(homeTeam?.abbreviation);
    const awayCode = scalar(awayTeam?.abbreviation);
    const startMs = Date.parse(start ?? '');
    if (!eventId || !homeId || !awayId || homeId === awayId || !homeCode || !awayCode || !Number.isFinite(startMs)) return [];
    const statusRecord = record(record(event?.status)?.type);
    const state = String(statusRecord?.state ?? '').toLowerCase();
    const statusName = String(statusRecord?.name ?? statusRecord?.description ?? '').toLowerCase();
    const status: NbaScheduleStatus = /postpon/.test(statusName) ? 'POSTPONED'
      : /cancel/.test(statusName) ? 'CANCELLED'
        : state === 'in' ? 'IN_PROGRESS' : state === 'post' ? 'FINAL' : state === 'pre' ? 'SCHEDULED' : 'UNKNOWN';
    const seasonRecord = record(event?.season) ?? record(competition?.season);
    const season = scalar(seasonRecord?.year);
    return [{
      provider: 'ESPN' as const, provider_game_id: eventId, season: season ?? null,
      home_team_id: homeId, away_team_id: awayId, home_team_code: homeCode, away_team_code: awayCode,
      scheduled_start_at: new Date(startMs).toISOString(), status, source,
      retrieved_at: new Date(retrieved).toISOString(), last_confirmed_at: new Date(retrieved).toISOString(),
      provider_raw_reference: { eventId, competitionId: scalar(competition?.id) ?? null },
    }];
  });
  if (root.events.length > 0 && games.length !== root.events.length) throw new Error(`ESPN NBA schedule contained ${root.events.length - games.length} malformed event record(s).`);
  return games;
}

export function nbaScheduleSyncIntervalMs(now: Date, nextGameAt?: string): number {
  const start = Date.parse(nextGameAt ?? '');
  return Number.isFinite(start) && start >= now.getTime() && start - now.getTime() <= 24 * 60 * 60_000
    ? 15 * 60_000
    : 12 * 60 * 60_000;
}

export async function syncNbaSchedule(db: SupabaseClient, options: { now?: Date; horizonDays?: number; fetcher?: typeof fetch; force?: boolean } = {}): Promise<{ status: 'SYNCED' | 'NOT_DUE' | 'LOCKED'; games: number; retrievedAt?: string; nextSyncAt?: string }> {
  const now = options.now ?? new Date();
  const latest = await db.from('floyd_dfs_nba_schedule_sync_state').select('last_success_at').eq('provider', 'ESPN').maybeSingle();
  if (latest.error) throw latest.error;
  const upcoming = await listUpcomingNbaSchedule(db, now, options.horizonDays ?? UPCOMING_HORIZON_DAYS);
  const interval = nbaScheduleSyncIntervalMs(now, upcoming[0]?.scheduled_start_at);
  const lastSuccess = Date.parse(String(latest.data?.last_success_at ?? ''));
  if (!options.force && Number.isFinite(lastSuccess) && now.getTime() - lastSuccess < interval) {
    return { status: 'NOT_DUE', games: upcoming.length, nextSyncAt: new Date(lastSuccess + interval).toISOString() };
  }

  const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
  const claim = await db.rpc('floyd_dfs_claim_nba_schedule_sync', { p_now: now.toISOString(), p_lease_until: leaseUntil });
  if (claim.error) throw claim.error;
  if (claim.data !== true) return { status: 'LOCKED', games: upcoming.length, nextSyncAt: leaseUntil };

  const retrievedAt = now.toISOString();
  try {
    const dates: string[] = [];
    for (let offset = 0; offset <= (options.horizonDays ?? UPCOMING_HORIZON_DAYS); offset += 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
      dates.push(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`);
    }
    const rows: NbaScheduleGame[] = [];
    for (let offset = 0; offset < dates.length; offset += 4) {
      const payloads = await Promise.all(dates.slice(offset, offset + 4).map((dateKey) => fetchEspnJson(`${ESPN_BASE}?dates=${dateKey}`, { fetcher: options.fetcher, cacheTtlMs: 0, maxAttempts: 2 })));
      for (const { payload } of payloads) rows.push(...normalizeEspnNbaSchedule(payload, retrievedAt));
    }
    const uniqueRows = [...new Map(rows.map((row) => [`${row.provider}:${row.provider_game_id}`, row])).values()];
    if (uniqueRows.length) {
      const versionRows = uniqueRows.map((row) => ({ ...row, observed_at: retrievedAt }));
      const history = await db.from('floyd_dfs_nba_game_schedule_versions').upsert(versionRows, { onConflict: 'provider,provider_game_id,observed_at', ignoreDuplicates: true });
      if (history.error) throw history.error;
      const current = await db.from('floyd_dfs_nba_game_schedule').upsert(uniqueRows.map((row) => ({ ...row, last_refresh_at: retrievedAt, last_error: null })), { onConflict: 'provider,provider_game_id' });
      if (current.error) throw current.error;
    }
    const syncState = await db.from('floyd_dfs_nba_schedule_sync_state').update({ last_attempt_at: retrievedAt, last_success_at: retrievedAt, next_due_at: new Date(Date.parse(retrievedAt) + interval).toISOString(), last_error: null, game_count: uniqueRows.length, lease_expires_at: null, updated_at: retrievedAt }).eq('provider', 'ESPN');
    if (syncState.error) throw syncState.error;
    return { status: 'SYNCED', games: uniqueRows.length, retrievedAt, nextSyncAt: new Date(Date.parse(retrievedAt) + interval).toISOString() };
  } catch (error) {
    await db.from('floyd_dfs_nba_schedule_sync_state').update({ last_attempt_at: retrievedAt, last_error: safeError(error), lease_expires_at: null, updated_at: retrievedAt }).eq('provider', 'ESPN');
    throw error;
  }
}

export async function listUpcomingNbaSchedule(db: SupabaseClient, now: Date, horizonDays = UPCOMING_HORIZON_DAYS): Promise<NbaScheduleGame[]> {
  const end = new Date(now.getTime() + horizonDays * 24 * 60 * 60_000).toISOString();
  const rows = await readAllPages((from, to) => db.from('floyd_dfs_nba_game_schedule').select('*')
    .gte('scheduled_start_at', now.toISOString()).lte('scheduled_start_at', end).in('status', ['SCHEDULED', 'IN_PROGRESS'])
    .order('scheduled_start_at', { ascending: true }).order('provider_game_id', { ascending: true }).range(from, to));
  return rows as unknown as NbaScheduleGame[];
}

async function readAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const output: T[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE_SIZE) {
    const page = await query(offset, offset + PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    output.push(...rows);
    if (rows.length < PAGE_SIZE) return output;
  }
  throw new Error('NBA schedule result exceeded the 100,000-row safety bound; results were not treated as complete.');
}

function safeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : 'NBA schedule provider request failed.'; }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function scalar(value: unknown): string | undefined { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
