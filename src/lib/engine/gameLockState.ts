import type { SlateGame, Sport } from './contracts.js';
import { normalizeTeamCode } from './availability.js';

export interface ProviderGameState {
  providerGameId: string;
  homeTeam: string;
  awayTeam: string;
  scheduledStart: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL' | 'POSTPONED' | 'CANCELLED' | 'UNKNOWN';
}

export interface GameLockAssessment {
  gameId: string;
  providerGameId?: string;
  source: string;
  retrievedAt: string;
  scheduledStart?: string;
  lockTime: string | null;
  status: ProviderGameState['status'];
  locked: boolean | null;
  reason?: string;
}

/** Match each slate game to exactly one provider game; ambiguous or stale feeds fail closed. */
export function assessGameLocks(input: {
  sport: Sport;
  games: SlateGame[];
  providerGames: ProviderGameState[];
  source: string;
  retrievedAt: string;
  now?: Date;
  maxAgeMs?: number;
}): GameLockAssessment[] {
  const now = input.now ?? new Date();
  const retrievedMs = Date.parse(input.retrievedAt);
  const stale = !Number.isFinite(retrievedMs) || now.getTime() < retrievedMs || now.getTime() - retrievedMs > (input.maxAgeMs ?? 120_000);
  return input.games.map((game) => {
    if (stale) return { gameId: game.gameId, source: input.source, retrievedAt: input.retrievedAt, lockTime: null, status: 'UNKNOWN', locked: null, reason: 'Provider game state is stale or has an invalid retrieval timestamp.' };
    const teams = new Set(game.teamIds.map(normalizeTeamCode).filter(Boolean));
    if (teams.size !== 2) return { gameId: game.gameId, source: input.source, retrievedAt: input.retrievedAt, lockTime: null, status: 'UNKNOWN', locked: null, reason: 'Slate game does not have exactly two identifiable teams.' };
    const matches = input.providerGames.filter((candidate) => {
      const candidateTeams = [normalizeTeamCode(candidate.homeTeam), normalizeTeamCode(candidate.awayTeam)].filter(Boolean);
      return candidateTeams.length === 2 && candidateTeams.every((team) => teams.has(team));
    });
    if (matches.length !== 1) return { gameId: game.gameId, source: input.source, retrievedAt: input.retrievedAt, lockTime: null, status: 'UNKNOWN', locked: null, reason: matches.length ? 'More than one provider game matches the slate teams.' : 'No provider game matched both slate teams.' };
    const match = matches[0];
    const startMs = Date.parse(match.scheduledStart);
    if (!Number.isFinite(startMs) || !match.providerGameId) return { gameId: game.gameId, source: input.source, retrievedAt: input.retrievedAt, providerGameId: match.providerGameId, lockTime: null, status: 'UNKNOWN', locked: null, reason: 'Matched provider record is missing a stable game ID or valid start time.' };
    if (match.status === 'POSTPONED' || match.status === 'CANCELLED' || match.status === 'UNKNOWN') return { gameId: game.gameId, providerGameId: match.providerGameId, source: input.source, retrievedAt: input.retrievedAt, lockTime: match.scheduledStart, status: match.status, locked: null, reason: `Provider game status is ${match.status}; its DraftKings edit cutoff cannot be inferred safely.` };
    // DraftKings rules allow the contest cutoff to be 5–15 minutes before scheduled game
    // start. Use the earliest documented cutoff so we never recommend swapping inside that
    // uncertain window. Early-start LIVE/FINAL status locks immediately.
    const safeLockTime = new Date(startMs - 15 * 60_000).toISOString();
    const locked = match.status === 'LIVE' || match.status === 'FINAL' || now.getTime() >= Date.parse(safeLockTime);
    return { gameId: game.gameId, providerGameId: match.providerGameId, source: input.source, retrievedAt: input.retrievedAt, scheduledStart: match.scheduledStart, lockTime: safeLockTime, status: match.status, locked };
  });
}

/** Parse only structured scoreboard event fields; prose summaries are never lock evidence. */
export function parseEspnScoreboard(payload: unknown): ProviderGameState[] {
  const root = record(payload);
  const events = Array.isArray(root?.events) ? root.events : [];
  return events.flatMap((value) => {
    const event = record(value);
    const competition = record(array(event?.competitions)[0]);
    const competitors = array(competition?.competitors).map(record).filter((item): item is Record<string, unknown> => Boolean(item));
    const home = competitors.find((team) => team.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((team) => team.homeAway === 'away') ?? competitors[1];
    const homeTeam = record(home?.team);
    const awayTeam = record(away?.team);
    const status = record(record(event?.status)?.type);
    const state = String(status?.state ?? '').toLowerCase();
    const name = String(status?.name ?? '').toLowerCase();
    const mappedStatus: ProviderGameState['status'] = /postpon/.test(name) ? 'POSTPONED' : /cancel/.test(name) ? 'CANCELLED' : state === 'in' ? 'LIVE' : state === 'post' ? 'FINAL' : state === 'pre' ? 'SCHEDULED' : 'UNKNOWN';
    const providerGameId = string(event?.id);
    const scheduledStart = string(event?.date);
    const homeCode = string(homeTeam?.abbreviation);
    const awayCode = string(awayTeam?.abbreviation);
    if (!providerGameId || !scheduledStart || !homeCode || !awayCode) return [];
    return [{ providerGameId, scheduledStart, homeTeam: homeCode, awayTeam: awayCode, status: mappedStatus }];
  });
}

/** SportsDataIO league score rows use structured game/team/status fields. */
export function parseSportsDataIoGames(payload: unknown): ProviderGameState[] {
  return (Array.isArray(payload) ? payload : []).flatMap((value) => {
    const row = record(value);
    const providerGameId = string(row?.GameID) ?? string(row?.GameId) ?? string(row?.GlobalGameID);
    const scheduledStart = string(row?.DateTime) ?? string(row?.Day);
    const homeTeam = string(row?.HomeTeam);
    const awayTeam = string(row?.AwayTeam);
    const rawStatus = String(row?.Status ?? '').toLowerCase();
    const status: ProviderGameState['status'] = /postpon/.test(rawStatus) ? 'POSTPONED' : /cancel/.test(rawStatus) ? 'CANCELLED' : /final|complete/.test(rawStatus) ? 'FINAL' : /progress|live|in.?game/.test(rawStatus) ? 'LIVE' : /scheduled|pregame|time.?tbd/.test(rawStatus) ? 'SCHEDULED' : 'UNKNOWN';
    if (!providerGameId || !scheduledStart || !homeTeam || !awayTeam) return [];
    return [{ providerGameId, scheduledStart, homeTeam, awayTeam, status }];
  });
}

function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function string(value: unknown): string | undefined { return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined; }
